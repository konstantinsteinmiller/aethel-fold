import type { BufferGeometry, Color } from 'three'
import { Vector3 } from 'three'
import { C } from '../art/palette'
import {
  blobGeometry,
  type Lump,
  lumpRadius,
  makeLumps,
  paintWindWeight,
  type Ring,
  tubeGeometry
} from '../geometry/build'
import { blendNormalsToCylinder, blendNormalsToSphere } from '../geometry/normals'
import { makeRng, type Rng } from '../geometry/rng'
import { bakeVertexAO } from '../geometry/vertexAO'
import {
  applyVertexAO,
  jitterColor,
  paintByHeight,
  paintByUpness,
  paintRadial,
  paintUniform
} from '../geometry/vertexColor'
import { createOutlineMaterial } from '../shading/outlineMaterial'
import { getFoliageRamp } from '../shading/ramp'
import { FOLIAGE_RIM, createToonMaterial } from '../shading/toonMaterial'
import { measuredRadius, mergeParts, partRanges } from './common'
import { finishTier } from './plateau'
import type { WorldAsset } from './types'

/**
 * ─── The understorey: shrub, sapling, thicket ───────────────────────────────
 *
 * Three forms out of one generator and one material, exactly as `tree.ts` keeps
 * its two species in one table — and here the sharing is worth more than there,
 * because these are the props that appear in the *greatest numbers* and every
 * separate generator is a separate `InstancedLodField` and ten more draw calls
 * (four tiers, two outline hulls, two shadow-casting tiers into two cascades).
 *
 * ── Why the understorey is a species and not a detail ───────────────────────
 *
 * **A forest with nothing under four metres tall is a park.** That is the whole
 * argument. Every tree in the catalogue puts its mass between 3 m and 9 m, and a
 * stand of them — however many species, however varied the crowns — is a canopy
 * floating over mown grass. What is missing is not variety at eye level, it is
 * *anything* at eye level: the layer the player actually walks through.
 *
 * It is also the cheapest layer to add. A shrub is three lumps of the same blob
 * the tree canopies are made of, 72 triangles, no trunk, and it reads from two
 * metres — where the tree above it is a trunk and the boulder beside it is a
 * silhouette. There is no other prop in the catalogue with that ratio.
 *
 * ── The forms differ in what holds the mass up, not in the mass ─────────────
 *
 * | form | clumps | stems | reads as |
 * |---|---|---|---|
 * | `shrub` | 3, low, flat-bottomed | — | a bush |
 * | `sapling` | 2, high, small | 1 whip | a young tree |
 * | `thicket` | 3, low | 1 whip through them | both |
 *
 * `thicket` exists because the scatter can only afford one understorey field
 * and a wood needs both reads. It is deliberately *not* a fourth mass shape: it
 * is `shrub` with a whip pushed up through it, so one seeded field gives a bush
 * from one angle and a young tree from another for six extra triangles.
 *
 * ── Colour separates the layer, not the shape ───────────────────────────────
 *
 * `shrub` and `thicket` take the **warm** foliage set and the sapling takes the
 * cool one. That is not decoration. Understorey sits *under* the canopy, in the
 * canopy's own shadow, in the same green — and two masses of one colour at two
 * heights read as one mass with a dark middle. The warm set is what makes the
 * lower layer a layer. The sapling is a young oak and keeps the oak's green, so
 * it reads as a small tree rather than as a bush of a different species.
 *
 * Budgets (GDD §4.1): 100 / 60 / 32 / 18, one ladder for all three forms.
 */

export type ShrubForm = 'shrub' | 'sapling' | 'thicket'

export interface ShrubOptions {
  seed?: number
  /** Defaults to `'shrub'`. */
  form?: ShrubForm
  /** Overall height in metres, foliage top included. Defaults per form. */
  height?: number
}

const TAU = Math.PI * 2

const _up = new Vector3(0, 1, 0)

/**
 * `blobGeometry` scales every tier by `1/cos(π/W)^0.6` so a coarse tier is not a
 * genuinely smaller object (GDD §4.3), which means a clump's pole sits 4 % above
 * its nominal radius at LOD0's six segments. Predicting the top without it
 * leaves the `height` option reading short — and `height` is what a level editor
 * types to stand a bush against a wall of a known size.
 */
const CLUMP_INFLATE = 1 / Math.cos(Math.PI / 6) ** 0.6

interface FormSpec {
  /**
   * Default overall height. A constant rather than an rng draw, for the reason
   * `tree.ts::FormSpec.height` records: a draw here happens before the clump
   * loop, and every draw after a new one shifts, which silently re-rolls every
   * shrub standing in a saved level. Per-instance variation comes from the
   * scatter's `scaleRange`.
   */
  height: number
  clumpCount: number
  /** Clump centre height, as a fraction of the whole. */
  rise: [number, number]
  /** Clump centre distance from the axis, as a fraction of the whole. */
  spread: [number, number]
  /** Clump radius, as a fraction of the whole. */
  clumpRadius: [number, number]
  squash: [number, number]
  lumpAmp: [number, number]
  /** A whip stem, or none. Height fraction it reaches. */
  stem: number
  stemRadius: number
  foliage: { lit: Color; base: Color; deep: Color }
}

const FORMS: Record<ShrubForm, FormSpec> = {
  // A bush: three low clumps in a ring, wider than tall, sitting on the ground
  // with no visible stem. Under the player's shoulder at 1.5 m, which is the
  // whole point — it is the only prop in the catalogue the player looks *level*
  // at from two metres away.
  shrub: {
    height: 1.5,
    clumpCount: 3,
    rise: [0.32, 0.54],
    spread: [0.13, 0.28],
    clumpRadius: [0.3, 0.4],
    // Flatter than a tree canopy's 0.72–0.9. A bush spreads sideways because
    // nothing is holding it up, and a spherical one reads as topiary.
    squash: [0.62, 0.78],
    // Knucklier than a canopy's [0.1, 0.26]: this mass is a third the radius of
    // a tree clump, so the same *relative* lump covers three times the arc and a
    // canopy's gentle swelling flattens out to a ball at this size.
    lumpAmp: [0.16, 0.34],
    stem: 0,
    stemRadius: 0,
    foliage: { lit: C.foliageWarmLit, base: C.foliageWarmBase, deep: C.foliageWarmDeep }
  },
  // A young tree: a whip with two small clumps at the top. Taller than the bush
  // and mostly empty, which is what a sapling's silhouette is.
  sapling: {
    height: 2.4,
    clumpCount: 2,
    rise: [0.72, 0.9],
    spread: [0.08, 0.2],
    clumpRadius: [0.22, 0.32],
    squash: [0.8, 0.98],
    lumpAmp: [0.14, 0.3],
    stem: 0.78,
    stemRadius: 0.024,
    foliage: { lit: C.foliageLit, base: C.foliageBase, deep: C.foliageDeep }
  },
  // The bush with a whip through it. Same three clumps as `shrub` — the stem is
  // the only difference, and it is what lets one scattered field read as both
  // layers of undergrowth. See the header.
  thicket: {
    height: 1.9,
    clumpCount: 3,
    rise: [0.26, 0.48],
    spread: [0.14, 0.3],
    clumpRadius: [0.28, 0.38],
    squash: [0.62, 0.8],
    lumpAmp: [0.16, 0.34],
    stem: 0.92,
    stemRadius: 0.022,
    foliage: { lit: C.foliageWarmLit, base: C.foliageWarmBase, deep: C.foliageWarmDeep }
  }
}

interface ShrubClump {
  center: Vector3
  radius: number
  squash: number
  lumps: Lump[]
}

interface ShrubShape {
  spec: FormSpec
  height: number
  clumps: ShrubClump[]
  /** Lateral offset of the whip's tip. A dead-straight whip reads as a stake. */
  stemLean: Vector3
  /** Peak of the foliage mass, for AO scale and the wind ramp. */
  massRadius: number
  massBottom: number
  rng: Rng
  seed: number
}

const buildShape = (options: ShrubOptions): ShrubShape => {
  const spec = FORMS[options.form ?? 'shrub']
  const { seed = 1, height = spec.height } = options
  const rng = makeRng(seed)

  const leanAngle = rng.range(0, TAU)
  const stemLean = new Vector3(
    Math.cos(leanAngle) * height * rng.range(0.02, 0.07),
    0,
    Math.sin(leanAngle) * height * rng.range(0.02, 0.07)
  )

  const clumps: ShrubClump[] = []
  let massRadius = 0
  let massBottom = Number.POSITIVE_INFINITY

  for (let i = 0; i < spec.clumpCount; i++) {
    // Golden-angle spread on top of the even one, as everything else in the
    // catalogue does it: no seed can stack two clumps on the same side.
    const angle = (i / spec.clumpCount) * TAU + rng.spread(0.6) + seed * 2.39996
    const spread = height * rng.range(spec.spread[0], spec.spread[1])
    const radius = height * rng.range(spec.clumpRadius[0], spec.clumpRadius[1])
    const squash = rng.range(spec.squash[0], spec.squash[1])
    const center = new Vector3(
      Math.cos(angle) * spread,
      height * rng.range(spec.rise[0], spec.rise[1]),
      Math.sin(angle) * spread
    )
    clumps.push({
      center,
      radius,
      squash,
      lumps: makeLumps(rng, 4, spec.lumpAmp, [1.3, 2.8])
    })
  }

  // ── Rescale so the foliage top lands exactly on `height` ─────────────────
  //
  // Every length above is linear in one factor and no angle depends on it, so
  // measuring the true top once and multiplying through is exact. Solving the
  // proportions so the top comes out right is not possible in closed form with
  // the lump field in the way, and guessing leaves `height` meaning "about that
  // tall" — which the ancient oak already found to be useless to a level editor
  // placing the thing next to something of a known size. Measured before this:
  // a `height: 2.4` sapling stood 2.93 m, 22 % over.
  let top = 0
  for (const clump of clumps) {
    top = Math.max(top, clump.center.y + clump.radius * clump.squash * CLUMP_INFLATE * lumpRadius(_up, clump.lumps))
  }
  const k = top > 1e-6 ? height / top : 1

  stemLean.multiplyScalar(k)
  for (const clump of clumps) {
    clump.center.multiplyScalar(k)
    clump.radius *= k
    massRadius = Math.max(massRadius, Math.hypot(clump.center.x, clump.center.z) + clump.radius)
    massBottom = Math.min(massBottom, clump.center.y - clump.radius * clump.squash)
  }

  return {
    spec,
    height,
    clumps,
    stemLean,
    massRadius,
    massBottom: Math.max(0, massBottom),
    rng,
    seed
  }
}

// ─── Parts ──────────────────────────────────────────────────────────────────

const buildClump = (
  shape: ShrubShape,
  clump: ShrubClump,
  widthSegments: number,
  heightSegments: number
): BufferGeometry => {
  const { foliage } = shape.spec
  const geometry = blobGeometry({
    radius: clump.radius,
    widthSegments,
    heightSegments,
    lumps: clump.lumps,
    scale: new Vector3(1, clump.squash, 1),
    // Cut flush with the ground rather than letting the clump hang below it.
    // A bush is the one piece of foliage in the world whose underside is at the
    // player's ankle, so the usual answer — bury it and never look — spends a
    // third of the mass underground where the eye can still see the seam.
    flatBottom: -clump.center.y,
    flatBottomBevel: clump.radius * 0.22
  })

  // The foliage law (GDD R3) at the mandated 0.85. A shrub is a *foliage clump*,
  // not ground scatter, so it takes the spherical blend rather than the 0.6
  // blend toward world up that grass gets — its mass is what has to shade in one
  // arc, and blending a 0.4 m ball toward up flattens it into a green mat.
  blendNormalsToSphere(geometry, new Vector3(0, 0, 0), 0.85, clump.radius * 0.16)

  // `paintRadial` replaces the colour; the other two blend into what is there.
  paintUniform(geometry, foliage.base)
  paintRadial(geometry, new Vector3(0, clump.radius * 0.5, 0), foliage.base, foliage.deep, clump.radius * 1.9)
  paintByUpness(geometry, foliage.lit, 0.6, 2)

  geometry.translate(clump.center.x, clump.center.y, clump.center.z)
  return geometry
}

/**
 * The whip: a straight-ish stem, thin enough that it is one or two pixels wide
 * at any distance the player reads this prop from.
 *
 * `tubeGeometry` rather than `loftGeometry` because the stem is genuinely
 * vertical — the rotated-frame machinery the dead wood needs buys nothing here
 * and costs a matrix per tier.
 */
const buildStem = (shape: ShrubShape, radialSegments: number, ringCount: number): BufferGeometry => {
  const { spec } = shape
  const top = shape.height * spec.stem
  const rings: Ring[] = []
  for (let i = 0; i < ringCount; i++) {
    const t = i / (ringCount - 1)
    rings.push({
      center: new Vector3(shape.stemLean.x * t * t, t * top, shape.stemLean.z * t * t),
      // Tapers to 45 % and flares at the root, the same shape `tree.ts` gives a
      // trunk — at 24 mm the taper is invisible and the flare is not, because it
      // is the only thing saying the whip grew rather than being pushed in.
      radius: shape.height * spec.stemRadius * (1 - 0.55 * t + 0.4 * Math.exp(-t * 9))
    })
  }

  const geometry = tubeGeometry(rings, radialSegments)
  blendNormalsToCylinder(geometry, new Vector3(0, 0, 0), new Vector3(0, 1, 0), 0.9)
  paintUniform(geometry, C.barkBase)
  paintByHeight(geometry, C.barkDark, C.barkBase, { min: 0, max: top, curve: 0.6 })
  return geometry
}

// ─── Tiers ──────────────────────────────────────────────────────────────────

interface ShrubTier {
  clumpW: number
  clumpH: number
  stemRadial: number
  stemRings: number
  /** Clumps drawn at this tier. Below the count, the largest are kept. */
  clumps: number
  budget: number
  aoSamples: number
}

/**
 * Triangles = clumps × clumpW × (2·clumpH − 2)
 *           + stemRadial × (stemRings − 1) × 2
 *
 * All three forms share one ladder, so a mixed patch of undergrowth switches
 * tiers on the same distance table and one field can hold any of them.
 *
 * **LOD3 drops to a single clump**, which is the only tier here that changes the
 * count of parts. At this asset's LOD2→LOD3 switch (82 m at `distanceScale`
 * 0.75) a 1.5 m bush is under two pixels tall and three clumps inside it are one
 * blob whatever the geometry says; keeping them is three times the vertex work
 * for a silhouette that is already a dot. The clump kept is the **largest**, and
 * it is scaled up to the mass's own reach so the impostor is not a smaller
 * object than the tier it crossfades with (GDD §4.3).
 */
const TIERS: ShrubTier[] = [
  { clumpW: 6, clumpH: 3, stemRadial: 4, stemRings: 3, clumps: 3, budget: 100, aoSamples: 12 },
  { clumpW: 4, clumpH: 3, stemRadial: 4, stemRings: 2, clumps: 3, budget: 60, aoSamples: 8 },
  { clumpW: 4, clumpH: 2, stemRadial: 3, stemRings: 2, clumps: 3, budget: 32, aoSamples: 6 },
  { clumpW: 5, clumpH: 2, stemRadial: 3, stemRings: 2, clumps: 1, budget: 18, aoSamples: 6 }
]

/**
 * `blobGeometry` scales every tier by `1/cos(π/W)^0.6` (GDD §4.3), so an
 * impostor sampled at 5 segments already stands 8 % proud of its nominal
 * radius. The LOD3 clump has to grow to the whole mass's reach *and* not
 * overshoot it, so the inflate is divided back out rather than guessed at.
 */
const IMPOSTOR_INFLATE = 1 / Math.cos(Math.PI / 5) ** 0.6

const buildTier = (shape: ShrubShape, tier: ShrubTier, name: string): BufferGeometry => {
  const parts: BufferGeometry[] = []

  if (tier.clumps >= shape.clumps.length) {
    for (const clump of shape.clumps) {
      parts.push(buildClump(shape, clump, tier.clumpW, tier.clumpH))
    }
  } else {
    // One clump standing in for the mass. Solved against the mass's measured
    // reach and centred on the axis: the support function is measured from the
    // origin, so an off-axis impostor overhangs on one side and falls short by
    // the same amount on the other.
    let widest = shape.clumps[0]!
    for (const clump of shape.clumps) {
      if (clump.radius > widest.radius) {
        widest = clump
      }
    }
    let top = 0
    for (const clump of shape.clumps) {
      top = Math.max(top, clump.center.y + clump.radius * clump.squash)
    }
    const radius = shape.massRadius / IMPOSTOR_INFLATE
    const centerY = (shape.massBottom + top) * 0.5
    parts.push(
      buildClump(
        shape,
        {
          center: new Vector3(0, centerY, 0),
          radius,
          squash: Math.min(1.1, Math.max(0.4, (top - centerY) / (radius * IMPOSTOR_INFLATE))),
          lumps: widest.lumps
        },
        tier.clumpW,
        tier.clumpH
      )
    )
  }

  const foliageParts = parts.length
  if (shape.spec.stem > 0) {
    parts.push(buildStem(shape, tier.stemRadial, tier.stemRings))
  }

  const ranges = partRanges(parts)
  const merged = mergeParts(parts, name)

  // Baked on the merged shrub, so the clumps shade each other and the stem
  // darkens where it passes through them. Range-split on apply so the stem
  // resolves toward bark and the leaves toward the form's own deep green — one
  // shared deep colour greens the stem's crevices, and the warm forms would drag
  // them olive (`tree.ts` records the same trap).
  const ao = bakeVertexAO(merged, {
    samples: tier.aoSamples,
    maxDistance: shape.massRadius * 1.3,
    strength: 0.95,
    power: 1.15
  })
  for (let i = 0; i < ranges.length; i++) {
    const leaf = i < foliageParts
    applyVertexAO(merged, ao, leaf ? shape.spec.foliage.deep : C.barkDark, leaf ? 0.9 : 0.7, ranges[i])
  }

  // A fresh generator per tier rather than `shape.rng`: drawing from a shared
  // stream would make tier N's jitter depend on how many vertices tier N−1
  // happened to have, so adding a segment to LOD0 would silently repaint LOD2.
  jitterColor(merged, makeRng(shape.seed * 5381 + 613), 0.045)

  // Wind ramps from still at the ground to full at the top. Derived from height
  // rather than from part membership so it is continuous — a step at the
  // stem/foliage join tears the mesh open in a gust.
  const windEnd = shape.height
  paintWindWeight(merged, (_x, y) => {
    const t = Math.min(1, Math.max(0, y / windEnd))
    return t ** 1.3
  })

  return finishTier(merged, tier.budget, name)
}

export const createShrubAsset = (options: ShrubOptions = {}): WorldAsset => {
  const shape = buildShape(options)
  const form = options.form ?? 'shrub'
  const name = `${form}-${options.seed ?? 1}`

  const tiers = TIERS.map((tier, i) => buildTier(shape, tier, `${name}/LOD${i}`))

  return {
    name,
    // One bucket for all three forms, so the ablation profiler prices "the
    // undergrowth" as one line rather than three rows inside its own noise floor
    // (`AAA-graphics.md` §10 — it once billed a tag that draws nothing at
    // 2.24 ms).
    perfTag: 'undergrowth',
    tiers,
    material: createToonMaterial({
      name: 'shrub',
      ramp: getFoliageRamp(),
      wind: true,
      // Stronger than the tree's 0.075 and near the birch's 0.11. A bush has no
      // mass to speak of and it is the prop the player stands closest to, so it
      // is where wind is actually legible — a still understorey under a moving
      // canopy is the tell that the wind is a shader rather than weather.
      windStrength: 0.115,
      // Matte foliage rim (GDD R5 kept, gloss removed): tinted toward leaf,
      // tightened, and gated by the sun so it stops wrapping the whole clump.
      // See `FOLIAGE_RIM`.
      ...FOLIAGE_RIM
    }),
    outline: createOutlineMaterial({
      pixelWidth: 1.6,
      wind: true,
      windStrength: 0.115,
      name: 'shrub-outline'
    }),
    outlineMaxTier: 1,
    radius: measuredRadius(tiers),
    // Well under the tree's 2.0 and near the stone's 0.55. This is a 1.5 m mass
    // with no interior structure: past ~60 m it is a green dot, and holding a
    // fine tier out to a tree's range would spend the near field's vertex budget
    // on the one prop that has nothing to show at distance.
    distanceScale: 0.75
  }
}
