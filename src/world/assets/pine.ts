import type { BufferGeometry } from 'three'
import { Color, Vector3 } from 'three'
import { C } from '../art/palette'
import { paintWindWeight, type Ring, tubeGeometry } from '../geometry/build'
import { blendNormalsToCylinder, blendNormalsToSphere } from '../geometry/normals'
import { makeRng } from '../geometry/rng'
import { bakeVertexAO } from '../geometry/vertexAO'
import {
  applyVertexAO,
  ensureColorAttribute,
  jitterColor,
  paintByHeight,
  paintByUpness,
  paintUniform
} from '../geometry/vertexColor'
import { createOutlineMaterial } from '../shading/outlineMaterial'
import { getFoliageRamp } from '../shading/ramp'
import { createToonMaterial } from '../shading/toonMaterial'
import { mergeParts, partRanges } from './common'
import {
  buildRingList,
  finishTier,
  loftGeometry,
  makeSection,
  profileVolumeInflate,
  sectionAreaInflate,
  smootherstep
} from './plateau'
import type { WorldAsset } from './types'

/**
 * ─── Conifer ────────────────────────────────────────────────────────────────
 *
 * The counterweight to `tree.ts`. A broadleaf is a ball of clumps on a stick and
 * reads as a horizontal blob; this one has to read as a **vertical stroke** —
 * 7–9 m tall and only ~2.4 m across at the skirt, so a stand of them draws a
 * comb against the horizon instead of a hedge.
 *
 * ── Why one loft, not a stack of skirts ─────────────────────────────────────
 *
 * The obvious build is 4–6 separate cones threaded up the trunk, one per whorl.
 * Three things kill it. Each skirt needs its own closed surface, so the budget
 * pays for five tips and five rims instead of one silhouette. Every skirt is an
 * independent shape, so a coarse tier has to *drop* whorls rather than resolve
 * fewer of them — a silhouette change the crossfade cannot hide (§4.3). And
 * stacked cones read exactly as what they are: discrete lampshades, with a
 * visible gap of trunk between each.
 *
 * So the canopy is **one** lofted surface of revolution and the whorls are
 * *bumps in its profile*: `r(u) = cone(u) · (1 + Σ aₖ·bumpₖ(u)) · foot(u)`.
 * Each bump is a smootherstep rising over a long span above its rim and falling
 * over a short one below it, so the radius reaches a local maximum at the rim
 * and then **tucks back in underneath** — a genuine undercut, which is what
 * makes the lip droop rather than merely slope. Overlapping bumps never let the
 * radius return to the bare cone between two whorls, so the silhouette is one
 * ragged cone rather than a stack of discs, and every tier is that same
 * continuous function at a different ring count.
 *
 * That undercut is also the whole read of the snow variant: a white top face
 * directly above a dark green ceiling. A skirt that merely sloped would give
 * both faces the same normal and the contrast would collapse.
 *
 * ── The section ─────────────────────────────────────────────────────────────
 *
 * A perfect circle is what makes a procedural conifer read as a Christmas-tree
 * cone, so the section is the cliff family's fused-column bundle (`makeSection`)
 * at four lobes — the flute multiplies the radius, so the scallop is deepest
 * exactly where the radius is largest, i.e. on the whorl rims, and vanishes into
 * the tucks where nobody can see it. Lobes stay uniform and the irregularity is
 * multiplicative for the reason `plateau.ts` measured: only a multiplicative
 * wobble leaves the arrises nailed to the sample grid.
 *
 * ── Normals ─────────────────────────────────────────────────────────────────
 *
 * `blendNormalsToSphere` toward a point **on the axis, 42 % of the way up the
 * canopy** — not `blendNormalsToCylinder` toward the trunk, and not the clump
 * centre `tree.ts` uses. Cylindrical normals shade a cone like a length of pipe:
 * the terminator is a vertical line, the tip goes the same value as the base and
 * the tree flattens into cardboard. A sphere centre placed low on the axis keeps
 * the apex pointing up into the light band while the flanks still sweep one
 * continuous arc, which is GDD R3's whole point — without it the analytic
 * normals oscillate once per whorl and the toon bands stack into horizontal
 * rings, one per skirt.
 *
 * Strength is 0.62 rather than foliage's 0.85. Above ~0.7 the whorl rims stop
 * lifting a band above their own undersides and the tree resolves to a plain
 * green cone; below ~0.5 the four tiers' normal fields visibly disagree, because
 * a tier that smoothed a whorl away has nothing to blend and the crossfade shows
 * two different shading solutions.
 *
 * The paint passes run on the **analytic** normals, before that blend, and the
 * snow mask is taken from them too (captured per vertex, see `CanopyPart`).
 * Sun-bleaching and snow settle by real surface orientation; only the toon
 * shading uses the idealised field.
 *
 * ── Trunk ───────────────────────────────────────────────────────────────────
 *
 * Bark is a 6-sided tube over the bottom 21 % of the tree only. The canopy
 * surface crosses the trunk's radius at ~1.35 m, so that is exactly how much
 * bark is ever visible; carrying the tube up inside the canopy would spend a
 * fifth of LOD2's entire budget on geometry nothing can see. The spike at the
 * top is the canopy's own leader — the profile holds under 4 % of full radius
 * for the first sixth of its length — which is both cheaper and correct: a
 * spruce leader is needled, and a bark-coloured spike above the last whorl reads
 * as a dead top.
 *
 * The canopy's bottom ring tucks to ~10 % of skirt radius, well *inside* the
 * trunk, so the loft's open bottom is plugged by the tube rather than showing
 * daylight through a back-face-culled shell.
 *
 * Budget ladder (GDD §4.1): 200 / 110 / 56 / 16 → 176 / 98 / 52 / 15.
 *
 * Unlike the cliff family, this one holds its **rings** from LOD1 to LOD2 and
 * spends the reduction on segments. The trade is stated the other way round in
 * §4.1 and it is form-specific, not doctrine: a plateau is identified by its
 * section and a conifer by its profile. LOD1 and LOD2 therefore share a ring
 * list exactly and differ only in how finely the section is sampled.
 *
 * LOD3 is the same loft at 3 rings and 3 segments plus a 6-triangle bark stub.
 * The stub is not optional — see the note on `buildImpostor` in `tree.ts`; a
 * canopy-only impostor makes every tree hop upward at the tier boundary. A
 * 3-gon section runs ~18 % wide even after `sectionAreaInflate`, which is
 * knowingly spent: at `distanceScale: 2` LOD3 begins at 220 m, where exp² fog
 * (`FOG_DENSITY`) has already erased 97 % of the object, so the tier exists to
 * hold the silhouette's mass and not its shape.
 */

export type PineForm = 'spruce' | 'fir'

export interface PineOptions {
  seed?: number
  /** Overall height in metres, leader tip included. */
  height?: number
  form?: PineForm
  /** Winter dress. A paint pass only — identical geometry, tier for tier. */
  snow?: boolean
}

// ─── Shape constants ────────────────────────────────────────────────────────

const TAU = Math.PI * 2

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t)

/** Profile parameter of the canopy's lowest ring. `u` runs 0 at the tip. */
const U_BOTTOM = 1

/** Ring pinned on the leader, so the spike survives every tier that can pay. */
const LEADER_U = 0.17

/** Span over which the leader lifts off zero radius. */
const LEADER_SPAN = 0.1

/** How far the profile tucks back in under the lowest whorl, 0–1. */
const FOOT_TUCK = 0.92

/** Fractions of overall height. */
const CANOPY_BOTTOM = 0.166
const TRUNK_TOP = 0.21
const TRUNK_RADIUS = 0.0465

/** Where the shading sphere's centre sits inside the canopy. */
const CENTER_FRACTION = 0.42
const NORMAL_BLEND = 0.62

/** Lobes in the section. Every tier's segment count is 2×, 1× or (LOD3) under. */
const LOBES = 4

/**
 * Sub-column offset. 0.40 puts the valleys 19 % in from the crests, matching the
 * cliff family's depth. The plateau's 0.56 is tuned for six lobes; at four it
 * cuts 39 % and the skirt reads as a clover leaf rather than as branch fans.
 */
const SECTION_OFFSET = 0.4

/** A conifer sways far less than a broadleaf — `tree.ts` runs 0.075. */
const WIND_STRENGTH = 0.045
const WIND_TIP = 0.6

/**
 * Bottom of the needle ramp. Not `needleDeep` itself: the deep colour is the AO
 * resolve target, and starting the height ramp there stacks two darkenings on
 * the lowest skirt and puts it in the ramp's floor band as a black hem (GDD R4).
 */
const NEEDLE_LOW = C.needleDeep.clone().lerp(C.needleBase, 0.5)

/**
 * Snow settles by upness — but through a **threshold**, not `upness ^ power`.
 *
 * A power is the right tool on a boulder and the wrong one here, and the mesh
 * says so: on a 7.5 m cone 2.4 m across, the only vertex with `n.y > 0.3` is the
 * apex. Every skirt top is a 13° slope (analytic `n.y ≈ 0.23`) because the cone's
 * own taper dominates the whorl bumps, so `n.y ^ 3.4` returns 0.006 and a first
 * pass at this put snow on exactly eight vertices — the tip ring — and nowhere
 * else.
 *
 * What actually separates a snowed surface from an unsnowed one on this shape is
 * not how flat it is but which way it faces: the undercut beneath every rim runs
 * `n.y ≈ -0.7`. So the mask is a smootherstep across that sign change. It
 * saturates well below the 0.23 that a skirt top delivers, and it is still zero
 * on anything vertical or overhanging — the underside of each whorl and the
 * trunk stay needle-dark, which is the entire read.
 */
const SNOW_EDGE0 = 0.01
const SNOW_EDGE1 = 0.2
/** Floor of the rim weighting — snow lands off the rims too, just far less. */
const SNOW_FLOOR = 0.3
const SNOW_COVER = 0.92
/** How far shaded snow resolves toward `snowDeep`. Blue, never grey. */
const SNOW_AO = 0.85

const AXIS_ORIGIN = new Vector3(0, 0, 0)
const AXIS_UP = new Vector3(0, 1, 0)

// ─── Form ───────────────────────────────────────────────────────────────────

interface FormSpec {
  whorlCount: number
  /** Skirt radius as a fraction of overall height. */
  spread: number
  amp: [number, number]
  /** u-span above a rim: the skirt's long upper slope. */
  rise: number
  /** u-span below a rim: the short steep tuck that makes the lip droop. */
  fall: number
  /** `u` of the topmost and lowest rims. */
  span: [number, number]
}

/**
 * One shape function, two sets of constants.
 *
 * A spruce is narrow and steep with an extra whorl, so its flank reads as steps.
 * A fir is broader and softer: longer upper slopes, but a *shorter* tuck under
 * each rim — the lip therefore hangs further past the branch carrying it, which
 * is what "droops more" is geometrically.
 */
const FORMS: Record<PineForm, FormSpec> = {
  spruce: { whorlCount: 5, spread: 0.15, amp: [0.27, 0.37], rise: 0.115, fall: 0.042, span: [0.34, 0.9] },
  fir: { whorlCount: 4, spread: 0.17, amp: [0.34, 0.44], rise: 0.15, fall: 0.034, span: [0.3, 0.9] }
}

// ─── Profile ────────────────────────────────────────────────────────────────

interface Whorl {
  /** Profile parameter of the rim — this skirt's widest point. */
  u: number
  /** Radius gain at the rim, as a fraction of the bare cone. */
  amp: number
  rise: number
  fall: number
}

/**
 * The bare cone the whorls ride on.
 *
 * Built from smootherstep products rather than the `u^p` a taper wants to be
 * written as, and that is not fussiness: the loft's central differences evaluate
 * this at `u = -0.0025`, where every non-integer power is NaN. `plateau.ts`
 * documents what that shipped.
 *
 * `body` is deliberately a smootherstep whose shoulders sit **outside** `[0, 1]`,
 * so the profile only ever uses its near-linear middle. A shoulder landing on
 * the domain's end flattens the taper there, and the version that ended at
 * `u = 1` cost the tree its lowest skirt: the envelope stopped widening over the
 * bottom fifth, so the widest rim on the tree came out with a nearly horizontal
 * normal. Measured, that rim caught **1 %** of the snow the rims above it did —
 * a snowed pine with a bare bottom skirt — and the same flat normal was why the
 * base read as a cylinder rather than a cone.
 *
 * `leader × spike` then thins the top: under 5 % of full radius through the top
 * fifth, which is the spike, and the reason the trunk does not have to supply
 * one.
 */
const coneEnvelope = (u: number): number => {
  const leader = smootherstep(0, LEADER_SPAN, u)
  const spike = 0.14 + 0.86 * smootherstep(0.06, 0.42, u)
  const body = smootherstep(-0.18, 1.35, u)
  return leader * spike * body
}

/**
 * One whorl's contribution, 0–1, peaking at its rim.
 *
 * Both factors have zero derivative at `u = w.u`, so the crest is a rounded
 * maximum rather than a corner — GDD R2's bevel, produced by the shape function
 * instead of applied to it.
 */
const bumpAt = (u: number, w: Whorl): number =>
  smootherstep(w.u - w.rise, w.u, u) * (1 - smootherstep(w.u, w.u + w.fall, u))

const whorlGainAt = (u: number, whorls: readonly Whorl[]): number => {
  let gain = 1
  for (let i = 0; i < whorls.length; i++) {
    gain += whorls[i]!.amp * bumpAt(u, whorls[i]!)
  }
  return gain
}

/** Rim proximity: 1 on a rim, 0 in a tuck. Drives where snow settles. */
const whorlPeakAt = (u: number, whorls: readonly Whorl[]): number => {
  let peak = 0
  for (let i = 0; i < whorls.length; i++) {
    const bump = bumpAt(u, whorls[i]!)
    if (bump > peak) {
      peak = bump
    }
  }
  return peak
}

const rawProfileAt = (u: number, whorls: readonly Whorl[], footStart: number, footEnd: number): number =>
  coneEnvelope(u) * whorlGainAt(u, whorls) * (1 - FOOT_TUCK * smootherstep(footStart, footEnd, u))

/**
 * Trunk radius at a fraction of the visible bark's height.
 *
 * Same split as `tree.ts` — linear taper plus an exponential root flare — but
 * the flare is stronger and tighter. A conifer's buttress is most of what says
 * "this is planted in the hillside" when the bottom metre is the only bark the
 * player ever sees.
 */
const trunkProfile = (t: number, baseRadius: number): number =>
  baseRadius * (1 - 0.18 * t) + baseRadius * 0.42 * Math.exp(-t * 7)

/** Where the collider's radius is measured. Absolute, not a fraction of height. */
const CHEST_HEIGHT = 1.3

// ─── Shape ──────────────────────────────────────────────────────────────────

interface PineShape {
  height: number
  /** Maximum horizontal radius, reached at the lowest whorl's rim. */
  skirtRadius: number
  canopyBottom: number
  trunkTop: number
  trunkBaseRadius: number
  /** Prominence-first — the order the tiers drop them in. */
  whorls: Whorl[]
  footStart: number
  footEnd: number
  /** Normalises the profile so `skirtRadius` is the true maximum radius. */
  profileScale: number
  sectionAt: (theta: number) => number
  lean: Vector3
  /** Virtual centre for the shading blend, on the axis. */
  center: Vector3
  snow: boolean
  seed: number
}

const buildShape = (options: PineOptions): PineShape => {
  const spec = FORMS[options.form ?? 'spruce']
  const seed = options.seed ?? 1
  const rng = makeRng(seed)

  const height = options.height ?? 7.5 * rng.range(0.93, 1.16)
  const skirtRadius = height * spec.spread * rng.range(0.94, 1.08)

  const whorls: Whorl[] = []
  const step = spec.whorlCount > 1 ? (spec.span[1] - spec.span[0]) / (spec.whorlCount - 1) : 0
  for (let i = 0; i < spec.whorlCount; i++) {
    whorls.push({
      // Jitter stays under a seventh of the spacing. Beyond that two whorls
      // merge into one fat skirt and the tree loses a step from its flank.
      u: spec.span[0] + step * i + rng.spread(step * 0.14),
      amp: rng.range(spec.amp[0], spec.amp[1]),
      rise: spec.rise,
      fall: spec.fall
    })
  }

  // Read before the sort — the lowest whorl is the last one placed, and where
  // the profile stops flaring and starts tucking toward the trunk.
  const lowest = whorls[whorls.length - 1]!
  const footStart = lowest.u + lowest.fall * 0.6
  const footEnd = footStart + 0.09

  let peak = 0
  for (let i = 0; i <= 256; i++) {
    const u = (i / 256) * U_BOTTOM
    peak = Math.max(peak, rawProfileAt(u, whorls, footStart, footEnd))
  }

  // Prominence-first, as `makeStrata` orders its breaks. Prominence is amplitude
  // *times the cone's radius there*, not amplitude alone: a coarse tier spends
  // its one whorl ring on the widest skirt, and a tier that pinned the topmost
  // one instead would report a needle for a silhouette.
  whorls.sort((a, b) => b.amp * coneEnvelope(b.u) - a.amp * coneEnvelope(a.u))

  const leanAngle = rng.range(0, TAU)
  // Held to ~1.5 % of height. Enough that a stand of pines is not a row of
  // clones; more than that and a conifer reads as dying rather than as grown.
  const leanAmount = height * rng.range(0.006, 0.018)

  const canopyBottom = height * CANOPY_BOTTOM

  return {
    height,
    skirtRadius,
    canopyBottom,
    trunkTop: height * TRUNK_TOP,
    trunkBaseRadius: height * TRUNK_RADIUS,
    whorls,
    footStart,
    footEnd,
    profileScale: peak > 1e-6 ? 1 / peak : 1,
    sectionAt: makeSection(rng, LOBES, SECTION_OFFSET, [0.04, 0.08]),
    lean: new Vector3(Math.cos(leanAngle) * leanAmount, 0, Math.sin(leanAngle) * leanAmount),
    center: new Vector3(0, canopyBottom + (height - canopyBottom) * CENTER_FRACTION, 0),
    snow: options.snow ?? false,
    seed
  }
}

// ─── Tiers ──────────────────────────────────────────────────────────────────

interface PineTier {
  segments: number
  rings: number
  /** Pin a ring on the leader. Dropped on the impostor, which cannot afford it. */
  leader: boolean
  /** Whorl rims (prominence-first) that get a ring of their own. */
  rims: number
  /** Of those, how many also get a ring inside the tuck beneath them. */
  tucks: number
  trunkRadial: number
  trunkRings: number
  budget: number
  aoSamples: number
}

/**
 * Canopy triangles = `segments × (2·rings − 3)` — the tip ring has zero radius,
 * so half of its band is degenerate and gets pruned, and a closed apex costs
 * `segments` rather than `2 × segments`.
 * Trunk triangles = `trunkRadial × (trunkRings − 1) × 2`.
 *
 * Seed count must never exceed `rings`: `buildRingList` only ever *adds*, so an
 * over-seeded tier silently ships more rings than it budgeted for. Both forms
 * are checked — spruce seeds 11/7/7/3, fir 10/7/7/3.
 */
const TIERS: PineTier[] = [
  { segments: 8, rings: 12, leader: true, rims: 5, tucks: 4, trunkRadial: 6, trunkRings: 3, budget: 200, aoSamples: 14 },
  { segments: 8, rings: 7, leader: true, rims: 2, tucks: 1, trunkRadial: 5, trunkRings: 2, budget: 110, aoSamples: 10 },
  { segments: 4, rings: 7, leader: true, rims: 2, tucks: 1, trunkRadial: 4, trunkRings: 2, budget: 56, aoSamples: 8 },
  { segments: 3, rings: 3, leader: false, rims: 1, tucks: 0, trunkRadial: 3, trunkRings: 2, budget: 16, aoSamples: 6 }
]

const whorlSeeds = (whorls: readonly Whorl[], rims: number, tucks: number): number[] => {
  const seeds: number[] = []
  for (let i = 0; i < Math.min(rims, whorls.length); i++) {
    seeds.push(whorls[i]!.u)
  }
  for (let i = 0; i < Math.min(tucks, whorls.length); i++) {
    // 80 % of the way down the tuck, not at its end: a smootherstep's derivative
    // is zero where it lands, so a ring on the end would sit where the undercut
    // has already flattened and the tier would render the lip as a ramp.
    seeds.push(whorls[i]!.u + whorls[i]!.fall * 0.8)
  }
  return seeds
}

// ─── Parts ──────────────────────────────────────────────────────────────────

interface CanopyPart {
  geometry: BufferGeometry
  /** Analytic upness per vertex, captured *before* the shading blend. */
  up: Float32Array
  /** Rim proximity per vertex. */
  rim: Float32Array
}

const buildCanopy = (shape: PineShape, tier: PineTier): CanopyPart => {
  const { segments } = tier
  const span = shape.height - shape.canopyBottom

  const yAt = (u: number): number => shape.height - span * u
  const profileAt = (u: number): number =>
    rawProfileAt(u, shape.whorls, shape.footStart, shape.footEnd) * shape.profileScale
  // Anchored at the root: the tip drifts, the base stays over the placement
  // point, so the trunk tube (which is straight) never pokes out of the canopy.
  const offsetAt = (u: number, out: Vector3): Vector3 => {
    const t = 1 - smootherstep(0, 1, u)
    return out.set(shape.lean.x * t, 0, shape.lean.z * t)
  }

  const seeds = [0, U_BOTTOM, ...whorlSeeds(shape.whorls, tier.rims, tier.tucks)]
  if (tier.leader) {
    seeds.push(LEADER_U)
  }

  const us = buildRingList(seeds, tier.rings, (u, out) => {
    offsetAt(u, out)
    const jogX = out.x
    const jogZ = out.z
    return out.set(shape.skirtRadius * profileAt(u), jogX, jogZ)
  })

  // Both corrections, as GDD §4.1 requires: one for the polygon approximating
  // the section, one for the chords approximating the profile. On this shape
  // they pull opposite ways — a coarse section is too thin, a coarse profile too
  // fat across the concave leader — so dropping either leaves a tier the wrong
  // size in a crossfade band.
  const scale =
    shape.skirtRadius *
    sectionAreaInflate(segments, 0, shape.sectionAt) *
    profileVolumeInflate(us, profileAt, yAt)
  const radiusAt = (u: number, theta: number): number => scale * profileAt(u) * shape.sectionAt(theta)

  const geometry = loftGeometry({ us, segments, yAt, radiusAt, offsetAt })

  // `loftGeometry` writes `ringCount × segments` vertices in ring-major order and
  // no caps, so a vertex index maps straight back to the ring it came from —
  // which is how the snow mask learns it is standing on a rim.
  const normal = geometry.getAttribute('normal')
  const up = new Float32Array(normal.count)
  const rim = new Float32Array(normal.count)
  for (let i = 0; i < normal.count; i++) {
    up[i] = Math.max(0, normal.getY(i))
    rim[i] = whorlPeakAt(us[Math.floor(i / segments)]!, shape.whorls)
  }

  // Range given explicitly rather than taken from the bounding box: LOD3's
  // canopy stops short of the others and would otherwise remap the whole ramp.
  paintByHeight(geometry, NEEDLE_LOW, C.needleBase, { min: shape.canopyBottom, max: shape.height, curve: 0.85 })
  paintByUpness(geometry, C.needleLit, 0.6, 2)

  // Last, so every pass above reads the analytic normals.
  blendNormalsToSphere(geometry, shape.center, NORMAL_BLEND)

  return { geometry, up, rim }
}

const buildTrunk = (shape: PineShape, radialSegments: number, ringCount: number): BufferGeometry => {
  const rings: Ring[] = []
  for (let i = 0; i < ringCount; i++) {
    // Squared spacing. The flare is an exponential over the bottom fifth, so an
    // evenly spaced middle ring lands above it and the buttress renders straight.
    const t = (i / (ringCount - 1)) ** 2
    rings.push({ center: new Vector3(0, t * shape.trunkTop, 0), radius: trunkProfile(t, shape.trunkBaseRadius) })
  }

  const geometry = tubeGeometry(rings, radialSegments)
  blendNormalsToCylinder(geometry, AXIS_ORIGIN, AXIS_UP, 0.85)

  paintUniform(geometry, C.barkBase)
  paintByHeight(geometry, C.barkDark, C.barkBase, { curve: 0.55 })
  return geometry
}

// ─── Snow ───────────────────────────────────────────────────────────────────

const _snow = new Color()

/**
 * The winter dress, and **not one vertex moves** (GDD R1).
 *
 * Snow is mixed in by upness with a high power, weighted toward the whorl rims
 * where it would actually settle and gated to zero on anything facing down, so
 * the underside of every skirt and the whole trunk stay needle-dark. That
 * contrast — white top face directly above a dark green ceiling — is the entire
 * read; snow applied evenly gives a white cone and loses the tree.
 *
 * Shaded snow resolves toward `snowDeep`, not `needleDeep`. Running the needle
 * resolve under white turns the occluded half grey, and grey snow reads as
 * dirty; blue snow reads as snow in shadow.
 *
 * The mix never reaches 1, and `snowLit` is already held ~13 % below white, so no
 * vertex on the tree can clip to paper and take the rim light with it.
 */
const paintSnow = (
  geometry: BufferGeometry,
  range: { start: number; count: number },
  ao: Float32Array,
  up: Float32Array,
  rim: Float32Array
): void => {
  const attribute = ensureColorAttribute(geometry)
  const array = attribute.array as Float32Array

  for (let k = 0; k < range.count; k++) {
    const facing = up[k]!
    if (facing <= 0) {
      continue
    }
    const mask =
      smootherstep(SNOW_EDGE0, SNOW_EDGE1, facing) * (SNOW_FLOOR + (1 - SNOW_FLOOR) * rim[k]!) * SNOW_COVER
    if (mask <= 1e-3) {
      continue
    }

    const i = range.start + k
    // Lit by depth rather than by upness, for the same reason the mask is: the
    // upness range on a cone is too narrow to drive a colour split with.
    _snow.copy(C.snowBase).lerp(C.snowLit, mask)
    _snow.lerp(C.snowDeep, (1 - ao[i]!) * SNOW_AO)

    const r = array[i * 3]!
    const g = array[i * 3 + 1]!
    const b = array[i * 3 + 2]!
    array[i * 3] = r + (_snow.r - r) * mask
    array[i * 3 + 1] = g + (_snow.g - g) * mask
    array[i * 3 + 2] = b + (_snow.b - b) * mask
  }
  attribute.needsUpdate = true
}

// ─── Tier assembly ──────────────────────────────────────────────────────────

const buildTier = (shape: PineShape, tier: PineTier, index: number, name: string): BufferGeometry => {
  const trunk = buildTrunk(shape, tier.trunkRadial, tier.trunkRings)
  const canopy = buildCanopy(shape, tier)

  const parts = [trunk, canopy.geometry]
  const ranges = partRanges(parts)
  const merged = mergeParts(parts, name)

  // Baked on the merged tree so each whorl genuinely darkens the one beneath it
  // and the canopy darkens the bark. `maxDistance` is set above the whorl
  // spacing (~0.9 m) or an underside sees no blocker at all and the skirts stop
  // reading as layers.
  const ao = bakeVertexAO(merged, {
    samples: tier.aoSamples,
    maxDistance: shape.skirtRadius * 1.15,
    strength: 0.95,
    power: 1.15
  })
  applyVertexAO(merged, ao, C.barkDark, 0.7, ranges[0])
  applyVertexAO(merged, ao, C.needleDeep, 0.9, ranges[1])

  if (shape.snow) {
    paintSnow(merged, ranges[1]!, ao, canopy.up, canopy.rim)
  }

  // A jitter stream of its own per tier rather than the shape's. Drawing from
  // the shared one would make LOD2's speckle depend on how many vertices LOD1
  // happened to have, so a tier generated in isolation would not reproduce.
  jitterColor(merged, makeRng(shape.seed * 7919 + index + 1), 0.035)

  // Continuous in `y`, not derived from part membership: a step at the bark/
  // needle join would tear the mesh open in a gust. The tip reaches 0.6, well
  // under the broadleaf's 1.0 — a conifer's mass is close to its trunk.
  const windStart = shape.trunkTop * 0.5
  paintWindWeight(merged, (_x, y) => {
    const t = clamp01((y - windStart) / (shape.height - windStart))
    return WIND_TIP * t ** 1.6
  })

  return finishTier(merged, tier.budget, name)
}

export const createPineAsset = (options: PineOptions = {}): WorldAsset => {
  const form = options.form ?? 'spruce'
  const shape = buildShape(options)
  const name = `pine-${form}${shape.snow ? '-snow' : ''}-${options.seed ?? 1}`

  const tiers = TIERS.map((tier, i) => buildTier(shape, tier, i, `${name}/LOD${i}`))

  return {
    name,
    perfTag: 'pines',
    tiers,
    material: createToonMaterial({
      name: 'pine',
      // Foliage ramp for the whole tree, bark included — one draw call, and the
      // softer terminator costs a metre and a half of trunk nothing.
      ramp: getFoliageRamp(),
      wind: true,
      windStrength: WIND_STRENGTH,
      rimStrength: 0.4
    }),
    outline: createOutlineMaterial({
      pixelWidth: 1.6,
      // Must match the base material's wind exactly or the hull detaches from
      // the silhouette it is outlining every time a gust passes.
      wind: true,
      windStrength: WIND_STRENGTH,
      name: 'pine-outline'
    }),
    outlineMaxTier: 1,
    // Measured from the origin at the foot, so the tip is the farthest point —
    // a radius taken from the skirt alone pops the whole tree out of the frustum
    // when the player walks under it.
    radius: Math.hypot(shape.skirtRadius + shape.lean.length(), shape.height),
    // Pines are large scatter props, same as the broadleaf: they hold detail
    // roughly twice as far out as the base table assumes.
    distanceScale: 2
  }
}

/**
 * Collider dimensions: the **trunk**, not the tree.
 *
 * The canopy starts above head height and reaches 1.2 m from the axis, so a
 * collider sized to the skirt would stop the player dead in what looks like open
 * ground — the same trap `assets/index.ts` records against `tree-oak`. Height is
 * held to 40 % of the tree for the same reason: the cylinder only has to be tall
 * enough that the player cannot walk over it.
 *
 * The radius is the trunk's true circular radius at chest height, not the
 * inscribed radius of its 6-gon. A trunk is a blocker rather than a floor, so
 * the asymmetry that makes ledges under-report runs the other way here: a
 * collider a couple of centimetres proud costs nothing, one that lets the camera
 * clip into bark is a bug.
 */
export const pineMetrics = (options: PineOptions = {}): { radius: number; height: number } => {
  const shape = buildShape(options)
  const chest = Math.min(CHEST_HEIGHT, shape.trunkTop * 0.85)
  return {
    radius: trunkProfile(chest / shape.trunkTop, shape.trunkBaseRadius),
    height: shape.height * 0.4
  }
}
