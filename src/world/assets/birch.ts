import type { BufferGeometry } from 'three'
import { Vector3 } from 'three'
import { C } from '../art/palette'
import { blobGeometry, type Lump, makeLumps, paintWindWeight, type Ring, tubeGeometry } from '../geometry/build'
import { blendNormalsToCylinder, blendNormalsToSphere } from '../geometry/normals'
import { makeRng, type Rng } from '../geometry/rng'
import { bakeVertexAO } from '../geometry/vertexAO'
import {
  applyVertexAO,
  ensureColorAttribute,
  jitterColor,
  paintByHeight,
  paintByUpness,
  paintRadial,
  paintUniform
} from '../geometry/vertexColor'
import { createOutlineMaterial } from '../shading/outlineMaterial'
import { getFoliageRamp } from '../shading/ramp'
import { createToonMaterial } from '../shading/toonMaterial'
import { mergeParts, partRanges } from './common'
import { finishTier, smootherstep } from './plateau'
import type { WorldAsset } from './types'

/**
 * ─── Birch ──────────────────────────────────────────────────────────────────
 *
 * The oak in `tree.ts` is a canopy with a trunk underneath it. A birch is the
 * other way round: ~70 % of the height is bare stem, the crown is small, high
 * and loosely packed, and what identifies the species at 40 m is a pale vertical
 * line rather than a green mass. Every decision below follows from that.
 *
 *   • **Two stems out of one root flare** (the default). Unequal heights,
 *     splayed 15–25°, and their base rings deliberately overlap so the two
 *     flares fuse into a single root instead of reading as two saplings planted
 *     in the same hole. A stem is a 5-sided tube, so the second one costs 50
 *     triangles at LOD0 and buys the entire "not an oak" silhouette.
 *   • **The bark is the asset.** A value ramp plus dark lenticel bands, painted
 *     as a function of object-space Y and bearing *only* — no per-vertex noise,
 *     no texture — so the marks land at the same heights in all four tiers and
 *     the crossfade has nothing to reveal (GDD §4.3), exactly the argument that
 *     makes `StoneBand` a per-shape list rather than a per-tier one.
 *   • **The canopy is what the LOD ladder gives up first**, which is the reverse
 *     of every other foliage asset here. See the tier table below.
 *
 * ── Dashes, not rings ───────────────────────────────────────────────────────
 *
 * A band that runs the full circumference reads as a bamboo joint, so each band
 * carries an angular gate as well as a vertical one: the bearing is folded by an
 * **integer** harmonic `k` and wrapped into [−π, π], which makes the gate exactly
 * 2π-periodic — no seam, and no dependence on where a tier happens to put its
 * vertices.
 *
 * `k` is 1 in practice, and that is a sampling result rather than an art
 * preference. The trunk has 5 columns of vertices at fixed bearings (a tube's
 * vertices sit at `s·2π/5` in its own frame, on every ring), so the only
 * harmonics whose dashes all land on the grid are the divisors of 5 — and 5
 * itself is a ring. At k=2 the two dashes are 180° apart, which is not a
 * multiple of 72°, so one of them always falls into a gap: evaluating the gate
 * across the phase range puts the second dash anywhere between **0.02 and 1.0**
 * of its authored strength depending purely on the seed, and widening the arc
 * until that stops being true closes the band into the ring it was supposed to
 * avoid. A single dash with a 57–74° half-arc covers 32–41 % of the
 * circumference and never drops below 0.84 of full strength wherever its phase
 * lands — the nearest column is at most 36° away. `k = 0` means "no gate", which
 * is how the dirty foot — genuinely a full ring — reuses the same band loop.
 *
 * ── Why the ring heights come from the band list ────────────────────────────
 *
 * A vertex-painted stripe only exists where there is a vertex. With 6 rings over
 * a 4.5 m stem, a band placed anywhere else than on a ring is a 1 m-tall smear
 * between two rings, which is neither a dash nor anything else. So the ring list
 * is *derived* from the bands — a **pair** of rings straddling each band at
 * ±45 % of its half-height, i.e. exactly at the edge of the band's solid core,
 * so both rings take full strength and the quad row between them is a genuinely
 * flat dark band. Same reasoning as `buildRingList` in `plateau.ts`: a tier only
 * shows a feature if its rings resolve it.
 *
 * ── What survives each tier ─────────────────────────────────────────────────
 *
 *   LOD0  6 rings/stem — both bands resolved, plus the foot.
 *   LOD1  4 rings/stem — the lower (stronger) band plus the foot. The upper band
 *         fades out; it is a vertex-colour feature, and colour is the one thing
 *         a dithered crossfade blends cleanly.
 *   LOD2  2 rings/stem — **no dashes at all.** At 90 m+ (distanceScale 2) the
 *         trunk is one to two pixels wide, so a 0.15 m dash is sub-pixel and the
 *         only thing left to get right is the value: pale stem, dark foot. The
 *         foot ramp does stretch over the whole stem at this tier because there
 *         is no ring to end it at — visible on a 1 px line only in principle.
 *         Radial segments stay at **5** in all three tiers regardless: dropping
 *         to 4 would change the section, and any gate wide enough to survive 4
 *         columns is wide enough to close into a ring.
 *   LOD3  a canopy blob plus a 6-triangle stem stub, per the note in `tree.ts` —
 *         and it matters more here, because for a birch the trunk *is* the
 *         silhouette. A canopy-only impostor deletes 70 % of the object.
 *
 * Budget ladder (GDD §4.1): 180 / 100 / 50 / 14 → 172 / 90 / 44 / 14 (2 stems).
 */

export interface BirchOptions {
  seed?: number
  height?: number
  /** 2 = a slender pair sharing a root, 1 = a single stem. Default 2. */
  stems?: number
}

const TAU = Math.PI * 2
const DEG = Math.PI / 180

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t)

/** Band profiles are solid out to this fraction of their half-extent, then fall. */
const MARK_CORE = 0.45

/** Root flare as a fraction of the trunk's straight radius. */
const FLARE = 0.42

/** Wind weight reached at the top of the bare stem. See `paintBirchWind`. */
const TRUNK_WIND = 0.15

/**
 * One dark band, in object-space Y and bearing. Generated once per stem and
 * shared by every tier — a band is a function of position, so sharing the list
 * is what guarantees LOD0 and LOD2 mark the same trunk.
 */
interface BirchBand {
  y: number
  /** Half-height at which the band reaches zero. */
  halfHeight: number
  /** Bearing of the first dash, in the stem's own frame. */
  bearing: number
  /** Dashes around the circumference. Integer (see the header); 0 = full ring. */
  harmonic: number
  /** Angular half-width at which the gate reaches zero, radians. */
  arcHalf: number
  /** Peak mix toward `C.birchMark`. */
  strength: number
}

interface BirchStem {
  /** Top of the bare stem; the canopy sits above this. */
  top: number
  baseRadius: number
  /** Splay direction in XZ (unit). */
  outX: number
  outZ: number
  /** Lateral offset at the root — small, so the two flares still overlap. */
  rootOffset: number
  /** tan of the splay angle; lateral offset at the top is this × `top`. */
  splay: number
  /** S-curve amplitude, perpendicular to the splay. */
  swayAmp: number
  swayPhase: number
  /** The dirty foot. Full-circumference, so it is a band with `harmonic: 0`. */
  foot: BirchBand
  /** Lenticel bands, ascending. Index 0 is the strongest — see `stemRingHeights`. */
  bands: BirchBand[]
}

interface BirchClump {
  center: Vector3
  radius: number
  lumps: Lump[]
  squash: number
}

interface BirchShape {
  seed: number
  height: number
  stems: BirchStem[]
  clumps: BirchClump[]
  canopyCenter: Vector3
  canopyRadius: number
  canopyLow: number
  canopyHigh: number
  /** Tallest stem's top. */
  trunkTop: number
}

// ─── The shape function ─────────────────────────────────────────────────────

/**
 * Centreline offset at height fraction `t`. Continuous and defined for t ≥ 0
 * only — `clamp01` first, because a fractional exponent of a negative number is
 * NaN and that failure has already cost this repo a black asset (see the note on
 * `assertFiniteGeometry`).
 */
const stemAxis = (stem: BirchStem, t: number, out: Vector3): Vector3 => {
  const u = clamp01(t)
  const lateral = stem.rootOffset + stem.splay * stem.top * u ** 1.25
  // The S-curve. Subtracting sin(phase) is what pins f(0) = 0, so the stem still
  // starts inside the shared flare whatever phase it drew.
  const sway = stem.swayAmp * (Math.sin(stem.swayPhase + u * TAU * 0.85) - Math.sin(stem.swayPhase))
  return out.set(stem.outX * lateral - stem.outZ * sway, u * stem.top, stem.outZ * lateral + stem.outX * sway)
}

/**
 * Radius at height fraction `t`, normalised so `stemProfile(0) === baseRadius`.
 * A birch tapers harder than the oak (0.32 of its base by the crown) — that
 * taper plus a tight flare is most of why it reads as slender rather than thin.
 */
const stemProfile = (t: number, baseRadius: number): number => {
  const u = clamp01(t)
  return (baseRadius / (1 + FLARE)) * (1 - 0.55 * u + FLARE * Math.exp(-u * 8))
}

/** Splay frame, drawn once for the pair and handed to both stems. */
interface StemAxis {
  outX: number
  outZ: number
  splay: number
}

const makeStem = (
  rng: Rng,
  height: number,
  scale: number,
  index: number,
  stemCount: number,
  axis: StemAxis
): BirchStem => {
  const tall = index === 0
  const top = height * 0.7 * (tall ? 1 : rng.range(0.74, 0.88))
  const baseRadius = 0.16 * scale * (tall ? 1 : rng.range(0.78, 0.92))
  const bands: BirchBand[] = []

  for (let i = 0; i < 2; i++) {
    bands.push({
      y: top * (0.32 + i * 0.39 + rng.spread(0.045)),
      halfHeight: top * rng.range(0.075, 0.105),
      // Consecutive bands sit on opposite sides ± a wide jitter. Two dashes
      // stacked on the same bearing read as one long stripe.
      bearing: rng.range(0, TAU) + i * Math.PI,
      harmonic: 1,
      arcHalf: rng.range(1.0, 1.3),
      // The lower band is always the stronger one — old bark is more marked, and
      // it means the tier that can only afford one band resolves the one worth
      // having (`stemRingHeights` takes them in order, so the ranges must not
      // overlap or that guarantee turns into a coin flip).
      strength: i === 0 ? rng.range(0.62, 0.86) : rng.range(0.4, 0.6)
    })
  }

  return {
    top,
    baseRadius,
    outX: axis.outX,
    outZ: axis.outZ,
    rootOffset: stemCount === 1 ? 0 : baseRadius * 0.55,
    splay: axis.splay,
    // Small on purpose. The reference reads as pale vertical *lines*, so the
    // S-curve is there to stop the stem being a CAD cylinder, not to bend it —
    // and it is also what the trunk collider has to be wide enough to contain,
    // so every centimetre of wobble is a centimetre of invisible collision.
    swayAmp: height * rng.range(0.014, 0.03),
    swayPhase: rng.range(0, TAU),
    foot: {
      y: 0,
      // A fixed metric height, not a fraction: real birches are dirty for the
      // bottom half-metre whether they are 5 m or 9 m tall.
      halfHeight: Math.min(0.95 * scale, top * 0.28),
      bearing: 0,
      harmonic: 0,
      arcHalf: 0,
      strength: 0.82
    },
    bands
  }
}

const buildShape = (options: BirchOptions): BirchShape => {
  const { seed = 1, height = 6.4, stems = 2 } = options
  // Clamped rather than trusted: the triangle ladder is sized for two tubes, and
  // a third stem would blow LOD2 by 10 triangles with no way to pay for it.
  const stemCount = stems >= 2 ? 2 : 1
  const rng = makeRng(seed)
  const scale = height / 6.4

  const splayAxis = rng.range(0, TAU)
  const outX = Math.cos(splayAxis)
  const outZ = Math.sin(splayAxis)
  // 15–25° between the pair, so half that per stem either side of vertical.
  const halfSplay = Math.tan(rng.range(7.5, 12.5) * DEG)

  const stemList: BirchStem[] = []
  for (let i = 0; i < stemCount; i++) {
    const sign = i === 0 ? 1 : -1
    stemList.push(
      makeStem(rng, height, scale, i, stemCount, {
        outX: outX * sign,
        outZ: outZ * sign,
        // A lone birch still leans — dead vertical reads as a pole — but it
        // leans a third as far, because with no partner the splay has nothing to
        // open away from and a big lean just looks like a mistake.
        splay: halfSplay * (stemCount === 1 ? 0.35 : 1)
      })
    )
  }

  // 2 clumps on the tall stem, 1 on the short one. Three is the low end of the
  // range the crown wants, and it is what the ladder can carry while keeping the
  // trunk at 5 columns — for this species that is the right way to spend it.
  const clumps: BirchClump[] = []
  const axis = new Vector3()
  for (let i = 0; i < stemList.length; i++) {
    const stem = stemList[i]!
    const count = stemCount === 1 ? 3 : i === 0 ? 2 : 1
    stemAxis(stem, 1, axis)
    for (let c = 0; c < count; c++) {
      // Golden-angle spread off the stem top, so no seed stacks two clumps on
      // the same side and closes the gaps the crown is supposed to have.
      const angle = (c / count) * TAU + rng.spread(0.6) + i * 2.39996
      const spread = rng.range(0.25, 0.62) * scale
      clumps.push({
        center: new Vector3(
          axis.x + Math.cos(angle) * spread,
          stem.top + rng.range(0.15, 0.9) * scale,
          axis.z + Math.sin(angle) * spread
        ),
        radius: rng.range(0.7, 1.0) * scale * (i === 0 ? 1 : 0.86),
        // Fewer, broader lobes than the oak: a birch crown is airy, and knuckly
        // lumps on a 0.8 m clump just fill in the sky the silhouette needs.
        lumps: makeLumps(rng, 3, [0.1, 0.26], [1.2, 2.6]),
        squash: rng.range(0.78, 0.95)
      })
    }
  }

  const canopyCenter = new Vector3()
  for (const clump of clumps) {
    canopyCenter.addScaledVector(clump.center, 1 / clumps.length)
  }

  let canopyRadius = 0
  let canopyLow = Number.POSITIVE_INFINITY
  let canopyHigh = 0
  for (const clump of clumps) {
    canopyRadius = Math.max(canopyRadius, clump.center.distanceTo(canopyCenter) + clump.radius)
    canopyLow = Math.min(canopyLow, clump.center.y - clump.radius * clump.squash)
    canopyHigh = Math.max(canopyHigh, clump.center.y + clump.radius * clump.squash)
  }

  let trunkTop = 0
  for (const stem of stemList) {
    trunkTop = Math.max(trunkTop, stem.top)
  }

  return {
    seed,
    height,
    stems: stemList,
    clumps,
    canopyCenter,
    canopyRadius,
    canopyLow,
    canopyHigh,
    trunkTop
  }
}

// ─── Bark ───────────────────────────────────────────────────────────────────

/**
 * The value ramp and the dark bands, evaluated per vertex from object-space Y
 * and bearing.
 *
 * Called on the stem **in its own frame** — rings centred on the Y axis, before
 * the lateral offset is applied — so `atan2(z, x)` is the bearing about the
 * stem's own axis rather than about the world origin. On a stem whose top is
 * 1.1 m off-centre those are not remotely the same angle, and measuring from the
 * origin would rotate every dash by a different amount up the trunk.
 *
 * The band profile is `1 − smootherstep(core, 1, d)` on both axes, not a cosine,
 * for the reason `paintSedimentaryBands` records: a cosine has no flat middle,
 * so a narrow band never reaches its own colour and the whole pass mutes itself.
 * A solid core with a shoulder is also the only profile that survives a ring pair
 * placed at the edge of that core.
 */
const paintBirchBark = (geometry: BufferGeometry, stem: BirchStem): BufferGeometry => {
  // Dull and slightly warm at the swollen root, papery toward the crown.
  paintByHeight(geometry, C.birchBase, C.birchLit, { min: 0, max: stem.top, curve: 0.55 })

  const position = geometry.getAttribute('position')
  const attribute = ensureColorAttribute(geometry)
  const array = attribute.array as Float32Array
  const bands = stem.bands
  const foot = stem.foot

  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i)
    const bearing = Math.atan2(position.getZ(i), position.getX(i))

    // The foot is just a band with no angular gate, so it runs through the same
    // max() as the dashes and a low dash can't stack into it and go black.
    let mix = 0
    for (let b = -1; b < bands.length; b++) {
      const band = b < 0 ? foot : bands[b]!
      const dy = Math.abs(y - band.y) / (band.halfHeight || 1e-6)
      if (dy >= 1) {
        continue
      }
      let gate = 1 - smootherstep(MARK_CORE, 1, dy)
      if (band.harmonic > 0) {
        // Folding by an integer harmonic and wrapping into [−π, π] gives the
        // signed distance to the nearest dash, exactly 2π-periodic — which is
        // what lets four differently-sampled tiers agree about where a dash is.
        const folded = band.harmonic * (bearing - band.bearing)
        const wrapped = (folded - TAU * Math.round(folded / TAU)) / band.harmonic
        gate *= 1 - smootherstep(band.arcHalf * MARK_CORE, band.arcHalf, Math.abs(wrapped))
      }
      const contribution = band.strength * gate
      if (contribution > mix) {
        mix = contribution
      }
    }

    if (mix <= 0) {
      continue
    }
    const r = array[i * 3]!
    const g = array[i * 3 + 1]!
    const b = array[i * 3 + 2]!
    array[i * 3] = r + (C.birchMark.r - r) * mix
    array[i * 3 + 1] = g + (C.birchMark.g - g) * mix
    array[i * 3 + 2] = b + (C.birchMark.b - b) * mix
  }

  attribute.needsUpdate = true
  return geometry
}

// ─── Parts ──────────────────────────────────────────────────────────────────

/**
 * Ring heights for one stem: the base, a **pair** straddling each resolved
 * band's core, and the top. Ascending by construction (`bands` are, and the
 * pairs are narrower than the gap between them).
 */
const stemRingHeights = (stem: BirchStem, resolved: number): number[] => {
  const heights: number[] = [0]
  for (let i = 0; i < resolved; i++) {
    const band = stem.bands[i]!
    heights.push(band.y - band.halfHeight * MARK_CORE, band.y + band.halfHeight * MARK_CORE)
  }
  heights.push(stem.top)
  return heights
}

const _center = new Vector3()
const _offset = new Vector3()

/**
 * A stem, built straight and then sheared.
 *
 * Lofting the rings on the axis first means `blendNormalsToCylinder` is *exact*
 * rather than approximate — a curved centreline has no single (origin, axis)
 * line to blend toward, and passing the world Y axis (which is what a copy of
 * `tree.ts` would do) points the radial direction away from the world origin
 * instead of away from the stem, which on a stem splayed 1.1 m off-centre is a
 * different vector entirely. Shearing afterwards moves positions only: the
 * authored cylindrical normals are what we want the trunk to shade like anyway,
 * and the shear never exceeds ~14°.
 *
 * Triangles = radialSegments × (heights − 1) × 2.
 */
const buildStem = (stem: BirchStem, radialSegments: number, heights: number[]): BufferGeometry => {
  const rings: Ring[] = []
  for (let i = 0; i < heights.length; i++) {
    const y = heights[i]!
    rings.push({ center: new Vector3(0, y, 0), radius: stemProfile(y / stem.top, stem.baseRadius) })
  }

  const geometry = tubeGeometry(rings, radialSegments)
  // 0.9 rather than the oak's 0.85: five columns meet at 72°, and the extra
  // 0.05 is what keeps the toon band sweeping round the stem instead of
  // stepping from facet to facet on a trunk that is the whole silhouette.
  blendNormalsToCylinder(geometry, new Vector3(0, 0, 0), new Vector3(0, 1, 0), 0.9)
  paintBirchBark(geometry, stem)

  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i)
    stemAxis(stem, y / stem.top, _offset)
    position.setXYZ(i, position.getX(i) + _offset.x, y, position.getZ(i) + _offset.z)
  }
  position.needsUpdate = true
  return geometry
}

const buildClump = (clump: BirchClump, widthSegments: number, heightSegments: number): BufferGeometry => {
  const geometry = blobGeometry({
    radius: clump.radius,
    widthSegments,
    heightSegments,
    lumps: clump.lumps,
    scale: new Vector3(1, clump.squash, 1)
  })

  // The foliage law (GDD R3) at the mandated 0.85, on top of already-analytic
  // normals — without it three separated clumps read as three separate balls
  // instead of as one airy crown.
  blendNormalsToSphere(geometry, _center.set(0, 0, 0), 0.85, clump.radius * 0.16)

  paintUniform(geometry, C.foliageWarmBase)
  paintRadial(
    geometry,
    _center.set(0, clump.radius * 0.55, 0),
    C.foliageWarmBase,
    C.foliageWarmDeep,
    clump.radius * 1.9
  )
  paintByUpness(geometry, C.foliageWarmLit, 0.62, 2)

  geometry.translate(clump.center.x, clump.center.y, clump.center.z)
  return geometry
}

/**
 * Wind weight. Continuous in Y across the whole tree — a step anywhere would
 * tear the mesh open in a gust — and deliberately non-zero on the **trunk**:
 * a 0.06 m-thick stem genuinely bends, and 0.15 at the crown join is the
 * cheapest signal that separates a birch from the oak standing next to it.
 */
const paintBirchWind = (geometry: BufferGeometry, shape: BirchShape): BufferGeometry =>
  paintWindWeight(geometry, (_x, y) => {
    const stem = TRUNK_WIND * clamp01(y / shape.trunkTop) ** 1.6
    const canopy = clamp01((y - shape.canopyLow) / (shape.canopyHigh - shape.canopyLow || 1)) ** 1.3
    return stem + (1 - stem) * canopy
  })

// ─── Tiers ──────────────────────────────────────────────────────────────────

interface TierSpec {
  radialSegments: number
  /** Lenticel bands given a ring pair. The rest still paint, they just smear. */
  resolvedBands: number
  clumpW: number
  clumpH: number
  budget: number
  aoSamples: number
}

// Triangles = stems × radial × (2·resolvedBands + 1) × 2 + clumps × W × (2H − 2)
const TIERS: TierSpec[] = [
  { radialSegments: 5, resolvedBands: 2, clumpW: 6, clumpH: 3, budget: 180, aoSamples: 14 }, // 100 + 72 = 172
  { radialSegments: 5, resolvedBands: 1, clumpW: 5, clumpH: 2, budget: 100, aoSamples: 10 }, //  60 + 30 =  90
  { radialSegments: 5, resolvedBands: 0, clumpW: 4, clumpH: 2, budget: 50, aoSamples: 6 } //     20 + 24 =  44
]

const buildTier = (shape: BirchShape, spec: TierSpec, name: string): BufferGeometry => {
  const parts: BufferGeometry[] = []
  for (const stem of shape.stems) {
    parts.push(buildStem(stem, spec.radialSegments, stemRingHeights(stem, spec.resolvedBands)))
  }
  const stemParts = parts.length
  for (const clump of shape.clumps) {
    parts.push(buildClump(clump, spec.clumpW, spec.clumpH))
  }

  const ranges = partRanges(parts)
  const merged = mergeParts(parts, name)

  // Baked on the merged birch so the crown darkens the stem tops and the two
  // stems shade each other where they cross. Range-split on apply, or the pale
  // bark picks up the canopy's green in its own shading.
  const ao = bakeVertexAO(merged, {
    samples: spec.aoSamples,
    maxDistance: shape.canopyRadius * 0.8,
    strength: 0.9,
    power: 1.2
  })
  for (let i = 0; i < stemParts; i++) {
    // Half strength: this bark is the brightest albedo in the tree and full AO
    // turns a birch grey, which is the one thing it must never be.
    applyVertexAO(merged, ao, C.birchMark, 0.5, ranges[i]!)
  }
  for (let i = stemParts; i < ranges.length; i++) {
    applyVertexAO(merged, ao, C.foliageWarmDeep, 0.9, ranges[i]!)
  }

  // A tier-local Rng, seeded from the shape rather than drawn from its stream:
  // `jitterColor` consumes one draw per vertex, so sharing the shape's Rng would
  // make tier N's jitter depend on tier N−1's vertex count.
  jitterColor(merged, makeRng(shape.seed * 31 + 7), 0.035)
  paintBirchWind(merged, shape)

  return finishTier(merged, spec.budget, name)
}

/**
 * LOD3: one canopy blob and one stem stub, 14 triangles.
 *
 * The pair collapses to a single stub here. At 220 m+ the two stems are a
 * fraction of a pixel apart, so the stub instead carries their *combined* width
 * — dropping one stem and keeping the other's radius would make the pale line
 * visibly thin at the tier boundary, which is the same pop the trunk stub exists
 * to prevent in `tree.ts`.
 */
const buildImpostor = (shape: BirchShape, name: string): BufferGeometry => {
  const canopy = blobGeometry({
    radius: shape.canopyRadius * 0.94,
    widthSegments: 4,
    heightSegments: 2,
    lumps: shape.clumps[0]!.lumps,
    scale: new Vector3(1, 0.82, 1)
  })
  blendNormalsToSphere(canopy, _center.set(0, 0, 0), 0.9)
  paintUniform(canopy, C.foliageWarmBase)
  paintRadial(
    canopy,
    _center.set(0, shape.canopyRadius * 0.5, 0),
    C.foliageWarmBase,
    C.foliageWarmDeep,
    shape.canopyRadius * 1.9
  )
  paintByUpness(canopy, C.foliageWarmLit, 0.5, 2)
  canopy.translate(shape.canopyCenter.x, shape.canopyCenter.y, shape.canopyCenter.z)

  const tall = shape.stems[0]!
  const stub = buildStem(
    {
      ...tall,
      baseRadius: tall.baseRadius * (shape.stems.length > 1 ? 1.4 : 1.05),
      splay: tall.splay * 0.5
    },
    3,
    [0, tall.top]
  )

  const merged = mergeParts([canopy, stub], name)
  paintBirchWind(merged, shape)
  return finishTier(merged, 14, name)
}

export const createBirchAsset = (options: BirchOptions = {}): WorldAsset => {
  const shape = buildShape(options)
  const name = `birch-${options.seed ?? 1}`

  const tiers: BufferGeometry[] = TIERS.map((spec, i) => buildTier(shape, spec, `${name}/LOD${i}`))
  tiers.push(buildImpostor(shape, `${name}/LOD3`))

  // Measured off the built tiers rather than derived from the shape description.
  // A clump's *nominal* radius is not its extent: `blobGeometry` inflates by
  // 1/cos(π/W)^0.6 and the lump field adds up to another 40 %, so the obvious
  // `centre.length() + radius` under-reports by ~7 % here — enough to pop a
  // birch out of existence when its crown is still on screen at the frame edge.
  let radius = 0
  for (const tier of tiers) {
    const sphere = tier.boundingSphere!
    radius = Math.max(radius, sphere.center.length() + sphere.radius)
  }

  return {
    name,
    perfTag: 'birches',
    tiers,
    material: createToonMaterial({
      name: 'birch',
      ramp: getFoliageRamp(),
      wind: true,
      // The most mobile tree in the world, and the only one whose trunk moves.
      windStrength: 0.11,
      rimStrength: 0.42
    }),
    outline: createOutlineMaterial({ pixelWidth: 1.6, wind: true, windStrength: 0.11, name: 'birch-outline' }),
    outlineMaxTier: 1,
    radius,
    distanceScale: 2
  }
}

/**
 * Collider dimensions: a trunk-only cylinder.
 *
 * The radius is the **circumscribed** width of the widest section the collider
 * spans, which is the opposite of the rule for a walkable top and is right for
 * the same reason — err toward the side that costs nothing. A trunk collider a
 * few centimetres wide keeps the player off a stem they can plainly see; one a
 * few centimetres narrow lets them walk into the bark.
 *
 * Height is 45 % of the tree, which on the default shape stops ~1.1 m below the
 * lowest leaf. The canopy must not collide: a birch crown is mostly gaps, and a
 * capsule that included it would block a path the player can see straight
 * through.
 */
export const birchMetrics = (options: BirchOptions = {}): { radius: number; height: number } => {
  const shape = buildShape(options)
  const chest = Math.min(1.2, shape.trunkTop * 0.45)
  const axis = new Vector3()

  let radius = 0
  for (const stem of shape.stems) {
    // The splay grows with height while the taper shrinks, so the widest section
    // is not necessarily at either end — sample across the collider's span.
    for (let i = 0; i <= 4; i++) {
      const t = (chest * (i / 4)) / stem.top
      stemAxis(stem, t, axis)
      radius = Math.max(radius, Math.hypot(axis.x, axis.z) + stemProfile(t, stem.baseRadius))
    }
  }

  return { radius, height: shape.height * 0.45 }
}
