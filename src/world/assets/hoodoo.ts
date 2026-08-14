import type { BufferGeometry } from 'three'
import { Vector3 } from 'three'
import { makeRng } from '../geometry/rng'
import { bakeVertexAO } from '../geometry/vertexAO'
import { applyVertexAO } from '../geometry/vertexColor'
import { createOutlineMaterial } from '../shading/outlineMaterial'
import { mergeParts } from './common'
import {
  buildRingList,
  createCliffMaterial,
  finishTier,
  loftGeometry,
  makeSection,
  makeStrata,
  profileVolumeInflate,
  sectionAreaInflate,
  smootherstep,
  strataAt,
  type Stratum,
  strataOffsetAt
} from './plateau'
import {
  DESERT_STONE,
  makeStoneBands,
  paintSedimentaryBands,
  paintStoneBody,
  type StoneBand,
  type StonePalette
} from './stone'
import type { WorldAsset } from './types'

/**
 * ─── Hoodoo: the desert mushroom-rock spire ─────────────────────────────────
 *
 * A wide flat-topped cap on a waisted stem that flares back out into a broad
 * foot. The plateau undercuts **once** and reads as a floating anvil; a hoodoo
 * undercuts two or three times up its height — cap, pinch, bulge, pinch, foot —
 * so it reads as a column erosion has been chewing on rather than as one
 * balanced block. Everything else is the cliff family's kit: the same loft, the
 * same fused-column section, the same two size corrections, the same material,
 * so a hoodoo and a plateau standing together are one rock language in two
 * climates.
 *
 * ── The profile is a product of clamped smootherstep terms ──────────────────
 *
 * Same construction as `plateauBase`, and for the same non-negotiable reason:
 * the loft's central differences sample `u = -0.0025` at the crown, and the
 * obvious readable spelling of a waist — a fractional power of `u` — is NaN
 * there for every non-integer exponent. That shipped a solid black cap to a
 * screenshot once (`plateau.ts` carries the full post-mortem). Every term here
 * is a clamped smootherstep, so the profile is **total**: finite below 0, finite
 * past the buried tip, C² in between.
 *
 * The terms multiply rather than add because each break is a *proportion* of
 * whatever the profile has already come down to. A hoodoo's stem is half the
 * cap's radius, so an additive 0.2 pinch means two different things at the two
 * ends of the same prop; a 0.72 multiplier means one thing everywhere and lets
 * the same table describe a 4 m toadstool and an 11 m landmark.
 *
 * ── Ring placement is the whole game ────────────────────────────────────────
 *
 * `buildRingList`'s greedy refinement finds inflections, but it spends its rings
 * on the *largest* chord error first, and on this profile that is always the
 * foot flare: it is the biggest single radius change and it is half buried. Left
 * to itself, a 4-ring tier came out cap → straight cone → tip, with the undercut
 * — the one feature that makes this asset identifiable at all — gone. So the cap
 * rim and the first waist are seeded on **every** tier including LOD3, and
 * `pinned` adds the rest of the features in prominence order on tiers that can
 * still afford to describe the rock between them (`cliff.ts` records what
 * happens when a tier's whole ring budget goes on pinned features).
 *
 * A waist takes **one** ring, at the extremum, not the straddling pair
 * `strataSeeds` gives a stratum. A stratum is a step and needs both its edges
 * pinned or it shades as a ramp; a waist is a smooth minimum, and the chord
 * error over it is largest exactly at the minimum.
 *
 * ── Banding ─────────────────────────────────────────────────────────────────
 *
 * The stripes are the single most identifiable feature of the desert reference
 * and they cost zero triangles (GDD R1). Built once per shape and shared by all
 * four tiers — see the header of `stone.ts` for why per-tier bands make the
 * dithered crossfade show two different rocks.
 *
 * Budgets (GDD §4.1): 250 / 145 / 80 / 36.
 */

const TAU = Math.PI * 2

export type HoodooForm = 'squat' | 'tall'

export interface HoodooOptions {
  seed?: number
  form?: HoodooForm
  /** Full prop height in metres, cap top to ground. Defaults per form. */
  height?: number
  stone?: StonePalette
  /** Sedimentary banding strength. 0 leaves bare rock, 1 is the reference. */
  banding?: number
}

interface FormSpec {
  /** Radius at the cap rim — the widest point of the whole prop. */
  radius: number
  height: number
  /** Pale/dark stripes. The tall form is layered more finely, not more strongly. */
  bands: number
  distanceScale: number
}

/**
 * Distance scales stay at or under 2.6, where the global 320 m cull clamp puts
 * the LOD2→LOD3 switch inside the visible range (`plateau.ts` has the arithmetic).
 * The squat form is scattered in numbers and is a third of the tall one's height,
 * so it holds detail over a proportionally shorter range.
 */
const FORMS: Record<HoodooForm, FormSpec> = {
  // The toadstool. Reads at a glance, scatters well in numbers, and at 4.5 m the
  // cap is above head height — the player walks *under* the undercut, which is
  // the whole point of the silhouette.
  squat: { radius: 1.9, height: 4.5, bands: 5, distanceScale: 2.2 },
  // A landmark, navigated by rather than walked past.
  tall: { radius: 1.6, height: 11, bands: 9, distanceScale: 2.6 }
}

/** Where the buried tip lands. The profile is exactly 0 here, which is what lets
 *  `dropDegenerateFaces` collapse the last band to `segments` triangles. */
const PROFILE_BOTTOM = 1.12

/** Where the foot starts tucking in. `yAt` puts this 6 % of the height above 0,
 *  so the flare's widest point is just above ground and the tuck below it. */
const FOOT_START = 0.94

/** Profile parameter of the cap rim — the prop's maximum radius. */
const RIM_U = 0.06

const CROWN_ROLL = 0.13

const LOBES = 6

/**
 * The cap's rolled rim: 0.87 of the maximum at the flat top, full width at
 * `RIM_U`. That shoulder is the bevel R2 demands — a cap whose widest point is
 * its own top edge meets `capTop`'s disc at 90° and reads as a stamped coin.
 *
 * The lower edge is `-0.02` rather than 0 on purpose. A smootherstep's
 * derivative vanishes at its ends, so anchored at 0 the top ring's radius is
 * momentarily constant, its analytic normal comes out exactly horizontal, and
 * the chamfer loses the up-facing band that is the only thing distinguishing it
 * from a seam. Two hundredths of `u` earlier and the top ring is still changing.
 */
const crownAt = (u: number): number => 1 - CROWN_ROLL * (1 - smootherstep(-0.02, RIM_U, u))

const footAt = (u: number): number => 1 - smootherstep(FOOT_START, PROFILE_BOTTOM, u)

/**
 * One erosion break in the profile: the shoulder from wherever the profile
 * currently is to `scale` × that, finishing at `u`.
 */
interface Cinch {
  /** Profile parameter where the break has completed — the waist or bulge itself. */
  u: number
  /** Length in `u` of the shoulder leading into it. */
  width: number
  /** Multiplier across the break. Below 1 pinches, above 1 bulges. */
  scale: number
  /** Ring-seeding priority. Tiers pin the lowest values first. */
  pin: number
}

/**
 * The two silhouettes, as running products. Reading down a column gives the
 * profile at each feature:
 *
 *   squat  1.00 → 0.55 → 0.75 → 0.54 → 0.89   (one full pinch/bulge cycle)
 *   tall   1.00 → 0.52 → 0.70 → 0.52 → 0.67 → 0.88   (two)
 *
 * `pin` ranks the waists above the bulges and the foot last. The foot flare is
 * the biggest radius change in either table and the refinement finds it unaided
 * every time; the undercut under the cap is what a coarse tier loses, so it is
 * the one that gets pinned first.
 */
const CINCHES: Record<HoodooForm, Cinch[]> = {
  squat: [
    { u: 0.3, width: 0.24, scale: 0.55, pin: 0 },
    { u: 0.5, width: 0.16, scale: 1.36, pin: 2 },
    { u: 0.68, width: 0.16, scale: 0.72, pin: 1 },
    { u: 0.92, width: 0.24, scale: 1.66, pin: 3 }
  ],
  tall: [
    { u: 0.24, width: 0.18, scale: 0.52, pin: 0 },
    { u: 0.4, width: 0.13, scale: 1.34, pin: 2 },
    { u: 0.56, width: 0.13, scale: 0.74, pin: 1 },
    { u: 0.72, width: 0.13, scale: 1.3, pin: 3 },
    { u: 0.92, width: 0.17, scale: 1.32, pin: 4 }
  ]
}

const cinchAt = (u: number, cinches: readonly Cinch[]): number => {
  let r = crownAt(u)
  for (let i = 0; i < cinches.length; i++) {
    const cinch = cinches[i]!
    r *= 1 + (cinch.scale - 1) * smootherstep(cinch.u - cinch.width, cinch.u, u)
  }
  return r
}

interface HoodooShape {
  radius: number
  height: number
  stone: StonePalette
  banding: number
  cinches: readonly Cinch[]
  strata: Stratum[]
  sectionAt: (theta: number) => number
  /** Radius fraction at `u`, normalised so `radius` is the true maximum. */
  profileAt: (u: number) => number
  /** Cinch extrema in `pin` order, for seeding a tier's ring list. */
  pinUs: number[]
  bands: StoneBand[]
  /** Widest bearing of the narrowest waist, as a fraction of `radius`. */
  waist: number
  extent: number
  paintSeed: number
}

interface HoodooTier {
  rings: number
  segments: number
  /** How many cinches (pin order) this tier seeds as real features. */
  pinned: number
  budget: number
  aoSamples: number
}

/**
 * Segments hold at `2 × LOBES` down to LOD2 and halve to `LOBES` only at LOD3,
 * never a count coprime with the bundle — at 12 the mesh lands on all six crests
 * and all six valley arrises, at 6 on every crest. Rings are what each tier
 * spends instead. That split is the family's (GDD §4.1) and it is the right way
 * round even here, where the profile carries more of the identity than usual:
 * a tier that samples the section off its arrises renders a smooth polygon and
 * the flutes stop existing, while a tier short a ring renders a chord that
 * `profileVolumeInflate` has already size-matched.
 *
 * Triangles = 2 × segments × (rings − 1): the last band is half degenerate
 * because the tip closes to a point, and the cap fan costs exactly the segments
 * that band gave back.
 *
 * LOD3 gets 4 rings, not the 5 a profile with this much inflection wants. A
 * fifth ring at 6 segments is 48 triangles against a 36 ceiling — 33 % over —
 * and the alternative, buying it back by dropping to 4 segments, samples a
 * 6-lobe bundle at 0°/90°/180°/270°, alternating crest and valley into a rotated
 * square. So LOD2 and LOD3 share a ring list and differ only in their section,
 * which also means the crossfade between them has only one thing to hide.
 */
const TIERS: HoodooTier[] = [
  { rings: 11, segments: LOBES * 2, pinned: 5, budget: 250, aoSamples: 12 },
  { rings: 6, segments: LOBES * 2, pinned: 2, budget: 145, aoSamples: 10 },
  { rings: 4, segments: LOBES * 2, pinned: 1, budget: 80, aoSamples: 8 },
  { rings: 4, segments: LOBES, pinned: 1, budget: 36, aoSamples: 6 }
]

const buildShape = (options: HoodooOptions): HoodooShape => {
  const form = options.form ?? 'squat'
  const spec = FORMS[form]
  const rng = makeRng(options.seed ?? 1)

  const radius = spec.radius * rng.range(0.9, 1.12)
  const height = options.height ?? spec.height * rng.range(0.88, 1.15)
  const stone = options.stone ?? DESERT_STONE
  const cinches = CINCHES[form]

  // The cap and the stem share one section function, so the flutes run
  // continuously from the rim to the foot. That vertical continuity is what
  // makes an hourglass read as one eroded rock rather than as two stacked
  // pieces — a cap with its own section is a mushroom model, not a hoodoo.
  const sectionAt = makeSection(rng, LOBES, 0.5, [0.03, 0.06])

  // Two wide, shallow breaks. Wide is deliberate: `strataSeeds` exists because a
  // *narrow* break needs both its edges pinned to shade as a ledge, and this
  // prop's rings are already spoken for by the waists. Authored as bends rather
  // than steps they need no seeds at all, and what they are really here for is
  // the **axis jog** — a profile that only changes width still reads as
  // lathe-turned however interesting it is, because the axis is straight and the
  // eye finds that (`cliff.ts`).
  const strata = makeStrata(rng, 2, [0.15, 0.9], [0.1, 0.18], [0.05, 0.1], radius * 0.1)

  // Applied multiplicatively, unlike `plateau.ts`'s additive juts: this profile
  // runs 2:1 from cap to waist, so an additive jut sized for the cap is a fifth
  // of the waist's radius and the break would swallow the feature it decorates.
  const rawAt = (u: number): number => cinchAt(u, cinches) * (1 + strataAt(u, strata)) * footAt(u)

  let peak = 0
  for (let i = 0; i <= 128; i++) {
    peak = Math.max(peak, rawAt((i / 128) * PROFILE_BOTTOM))
  }
  const profileScale = peak > 1e-6 ? 1 / peak : 1
  const profileAt = (u: number): number => rawAt(u) * profileScale

  let waist = Number.POSITIVE_INFINITY
  for (const cinch of cinches) {
    if (cinch.scale < 1) {
      waist = Math.min(waist, profileAt(cinch.u))
    }
  }

  // Thickness scales with the count so the stripes keep their gaps: nine bands
  // over 11 m sit 1.2 m apart, and at the squat form's thickness they would
  // overlap into a gradient with ripples in it rather than layers to count.
  const bands = makeStoneBands(rng, spec.bands, 0, height, [0.25 / spec.bands, 0.6 / spec.bands])

  // One dark seam per waist, and this is the pass that makes the shape and the
  // colour agree: a hoodoo's waist *is* the soft layer that eroded, so a stripe
  // there is not decoration, it is the explanation. It also does real work at
  // range — past LOD2 the pinch is only a couple of pixels deep, and the seam
  // keeps saying "waist" after the geometry has stopped. Strength is a shade
  // above `makeStoneBands`'s pale maximum (0.7) because `paintSedimentaryBands`
  // resolves overlaps by taking the strongest band, and a pale stripe landing on
  // the waist would say the opposite of the truth.
  for (const cinch of cinches) {
    if (cinch.scale < 1) {
      bands.push({ y: height * (1 - cinch.u), halfHeight: height * 0.03, strength: -0.72 })
    }
  }

  let jog = 0
  for (const stratum of strata) {
    jog += Math.hypot(stratum.jogX, stratum.jogZ)
  }

  return {
    radius,
    height,
    stone,
    banding: options.banding ?? 1,
    cinches,
    strata,
    sectionAt,
    profileAt,
    pinUs: [...cinches].sort((a, b) => a.pin - b.pin).map(cinch => cinch.u),
    bands,
    waist,
    extent: radius + jog,
    // Colour jitter runs off its own stream so a tier's noise cannot depend on
    // how many vertices the tier above it painted.
    paintSeed: (options.seed ?? 1) * 7919 + 17
  }
}

const buildTier = (shape: HoodooShape, tier: HoodooTier, index: number, name: string): BufferGeometry => {
  const { segments } = tier
  const inflate = sectionAreaInflate(segments, 0, shape.sectionAt)

  const yAt = (u: number): number => shape.height * (1 - u)
  // Anchored at the crown, exactly as the plateau anchors its walkable top: the
  // cap stays over the placement point — it is the collider's centre and the
  // surface an integrator may mark walkable — and the stem drifts below it.
  const offsetAt = (u: number, out: Vector3): Vector3 => strataOffsetAt(u, shape.strata, out)

  // `RIM_U` and the first waist are seeded on every tier, LOD3 included. See the
  // header: without them the refinement spends a 4-ring tier on the foot flare
  // and the undercut — the identity of the whole asset — disappears at the one
  // LOD boundary the crossfade cannot hide.
  const us = buildRingList(
    [0, RIM_U, PROFILE_BOTTOM, ...shape.pinUs.slice(0, tier.pinned)],
    tier.rings,
    (u, out) => {
      offsetAt(u, out)
      const jogX = out.x
      const jogZ = out.z
      return out.set(shape.radius * shape.profileAt(u), jogX, jogZ)
    }
  )

  // Both corrections together: one for the section polygon, one for the ring
  // chords. Neither is optional — each fixes a bias the other cannot see.
  const scale = shape.radius * inflate * profileVolumeInflate(us, shape.profileAt, yAt)
  const radiusAt = (u: number, theta: number): number => scale * shape.profileAt(u) * shape.sectionAt(theta)

  const body = loftGeometry({ us, segments, yAt, radiusAt, offsetAt, capTop: true })

  const rng = makeRng(shape.paintSeed + index)
  paintStoneBody(body, rng, shape.stone)
  // After the height ramp, before the AO — the stripes have to sit on the ramp
  // and then be occluded along with everything else (`stone.ts`).
  paintSedimentaryBands(body, shape.stone, shape.bands, shape.banding)

  const merged = mergeParts([body], name)

  // Rays are scaled to the **cap**, not to the prop. Every gram of AO value in
  // this shape is in the undersides — the cap's overhang and each bulge's — and
  // those are all within a cap radius of the surface that shades them. Scaled to
  // the height instead, an 11 m tall form spends its whole ray budget crossing
  // open air (`cliff.ts` has the same trade on a spire).
  const ao = bakeVertexAO(merged, {
    samples: tier.aoSamples,
    maxDistance: shape.radius,
    strength: 0.9,
    power: 1.15
  })
  applyVertexAO(merged, ao, shape.stone.shadow, 0.85)

  return finishTier(merged, tier.budget, name)
}

export const createHoodooAsset = (options: HoodooOptions = {}): WorldAsset => {
  const form = options.form ?? 'squat'
  const shape = buildShape(options)
  const name = `hoodoo-${form}-${options.seed ?? 1}`

  const tiers = TIERS.map((tier, i) => buildTier(shape, tier, i, `${name}/LOD${i}`))

  return {
    name,
    perfTag: 'hoodoos',
    tiers,
    material: createCliffMaterial('hoodoo'),
    outline: createOutlineMaterial({ pixelWidth: 1.6, name: 'hoodoo-outline' }),
    outlineMaxTier: 1,
    // Corner of the bounding box rather than the cap radius: the rim is the
    // farthest point from the origin, and a radius that misses it pops the prop
    // out of the frustum from underneath the very overhang it is known for.
    radius: Math.hypot(shape.extent, shape.height),
    distanceScale: FORMS[form].distanceScale
  }
}

/**
 * Collider dimensions. **The radius is the waist, not the cap.**
 *
 * The collider is a cylinder around the placement point spanning the whole prop,
 * so one radius has to answer for a silhouette that halves between its ends.
 * Sized to the cap it would put an invisible wall the better part of a metre out
 * from a stem the player can plainly see is thin, and the overhang the asset
 * exists for would be unreachable. Sized to the waist the player walks under the
 * cap, which is what the shape promises; clipping the flare of the foot on the
 * way is the cheaper error by far.
 *
 * Shaved to the narrowest *bearing* of that waist as well, for the reason the
 * rest of the family shaves its colliders: the flutes run about 15 % deep, and a
 * collider on the crests leaves arcs of thin air over the valleys.
 *
 * `height` is the full prop height — the cap top, which is the walkable surface
 * if the integrator marks it so.
 */
export const hoodooMetrics = (options: HoodooOptions = {}): { radius: number; height: number } => {
  const shape = buildShape(options)
  let narrowest = Number.POSITIVE_INFINITY
  for (let i = 0; i < 128; i++) {
    narrowest = Math.min(narrowest, shape.sectionAt((i / 128) * TAU))
  }
  return { radius: shape.radius * shape.waist * narrowest, height: shape.height }
}
