import type { BufferGeometry } from 'three'
import { Matrix4, Vector3 } from 'three'
import { C } from '../art/palette'
import { paintWindWeight } from '../geometry/build'
import { makeRng } from '../geometry/rng'
import { bakeVertexAO } from '../geometry/vertexAO'
import { applyVertexAO, jitterColor, paintByHeight, paintByUpness, paintUniform } from '../geometry/vertexColor'
import { createOutlineMaterial } from '../shading/outlineMaterial'
import { BARK_RIM, createToonMaterial } from '../shading/toonMaterial'
import { measuredRadius, mergeParts, partRanges } from './common'
import {
  branchFrame,
  DEADWOOD_DARK,
  DEADWOOD_LIT,
  HEARTWOOD,
  makeWoodGrain,
  paintCutFace,
  paintMoss,
  paintWoodGrain
} from './deadwood'
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
 * ─── The tree stump ─────────────────────────────────────────────────────────
 *
 * The strongest "humans were here" prop in the set, and the cheapest. A wood
 * with stumps in it has been *worked*; a wood without them is scenery. Nothing
 * else in the catalogue says that for 102 triangles.
 *
 * ── The cut face is the whole prop ──────────────────────────────────────────
 *
 * Seen in silhouette a stump is a boulder: a squat mass on the ground, roughly
 * as wide as it is tall. Everything that separates the two is *on top of it* and
 * is therefore invisible from the side — which sounds like a reason not to
 * bother and is the opposite. The player looks **down** at this prop. It is
 * knee-high, it sits on the ground the camera is orbiting above, and its top
 * face is the largest thing about it on screen at every distance the eye reads
 * it from.
 *
 * So the budget goes there: 30 of 102 triangles are the cut face alone, in four
 * concentric rings, and the growth rings and the pale sapwood band are painted
 * on it as a continuous function of radius (`deadwood.ts::ringsAt`). Zero
 * triangles of the read are modelled — GDD R1 in its purest form — and because
 * the paint is a function of *radius* rather than of vertex index, a 4-ring cut
 * face and a 2-ring one agree everywhere they overlap and the crossfade has
 * nothing to reveal.
 *
 * A flat cap was the first attempt and is wrong twice: `loftGeometry`'s `capTop`
 * is a fan of one centre vertex and `segments` rim vertices, which has **two**
 * radial samples — enough for a gradient and not for a ring pattern — and a dead
 * flat disc takes the toon ramp's top band across its whole area with no
 * falloff, exactly the way the grass caps did before GDD §3 dulled them. The
 * face is therefore a shallow dome, 6 % of the radius, flush with the bark at
 * the rim: the band edge crosses it and the rings have something to sit on.
 *
 * ── Roots are lofts in a rotated frame ──────────────────────────────────────
 *
 * Three flares leaving the bole below the waist at ~100° from vertical — past
 * horizontal, so they dive into the ground rather than resting on it. Built
 * through `deadwood.ts::branchFrame` for the reason recorded there:
 * `tubeGeometry`'s rings are horizontal circles, so a root at 80° comes out
 * `1/cos τ` = **5.8×** too wide, which is a flat ribbon and not a root.
 *
 * They matter more than their 36 triangles suggest. A bole with no flare is a
 * fence post pushed into the ground; the flare is what says the thing grew.
 * `tree.ts` makes the same point about its exponential root flare and buys it
 * for nothing, but a *cut* trunk has no canopy to draw the eye up and away, so
 * the base is where this prop is actually looked at.
 *
 * ── The axe notch is a radial function, not a cut plane ─────────────────────
 *
 * `makeCutPlanes` (the rock kit) works on `blobGeometry`, which is not what
 * builds this bole. The notch is instead a multiplicative dent in
 * `radiusAt(u, θ)` — one bearing, one height, both smooth — which costs zero
 * triangles, keeps the surface C¹ so the bevel rule (GDD R2) is satisfied by
 * construction, and is **total**: every term is an integer power or a clamped
 * smootherstep, so the loft's central differences can sample it at `u = -0.0025`
 * without producing the NaN that once shipped eight solid black cliff tiers.
 *
 * Budgets (GDD §4.1): 120 / 66 / 34 / 12.
 */

export type StumpForm = 'sawn' | 'notched'

export interface StumpOptions {
  seed?: number
  /** `'notched'` adds an axe notch on one bearing. Defaults to `'sawn'`. */
  form?: StumpForm
  /** Height of the cut, in metres. The dome sits ~6 % of the radius above it. */
  height?: number
  /** Radius at the cut. The flare below it is ~1.5× this. */
  radius?: number
}

const TAU = Math.PI * 2

/**
 * Buttresses in the bole. Every tier's segment count is `2 × LOBES` or `LOBES`,
 * never a number coprime with it — at 6 the mesh lands on all three crests *and*
 * all three valley arrises, at 3 it still lands on every crest. A stump at 5 or
 * 7 segments renders the same section as a smooth polygon and the flutes never
 * reach a triangle at all (`plateau.ts::makeSection`).
 *
 * Three rather than the ancient oak's four: this is a young trunk, ~0.45 m
 * across, and four buttresses at that size read as a machined cog.
 */
const LOBES = 3

/**
 * Valleys 20 % in from the crests — the same relief the ancient oak's bole
 * carries, and reached at a **different number**, which is the point of writing
 * it down. `oldOak.ts` gets 20 % from 0.42 at four lobes; at three the
 * neighbours are 120° apart rather than 90°, so the same offset leaves the
 * sub-columns overlapping far less and the section measured **37 % deep** — a
 * three-pointed star rather than fused wood, and a collider radius less than
 * half the visible bole. Solving `d·cos∆ + √(ρ² − d²sin²∆)` for 0.8 at ∆ = 60°
 * gives 0.30.
 */
const SECTION_OFFSET = 0.3

const UNIT_SECTION = (): number => 1

/**
 * Bole radius by height. `u` runs 0 at the cut to 1 at the ground.
 *
 * A product of clamped smoothersteps rather than a taper plus an exponential
 * flare (`tree.ts`'s form), because a product of clamped smoothersteps is C²
 * *and* total — see the header on why totality is not optional here.
 *
 *   1.00 at the cut → 1.06 by the waist → 1.52 at the root flare
 */
const stumpProfile = (u: number): number => {
  const bole = 1 + 0.06 * smootherstep(0, 0.62, u)
  const flare = 1 + 0.44 * smootherstep(0.58, 1, u)
  return bole * flare
}

interface StumpRoot {
  /** Local → object. Local +Y is the direction the root leaves the bole in. */
  frame: Matrix4
  bearing: number
  length: number
  radius: number
  /** Local −X droop at the tip, which points down — see `branchFrame`. */
  droop: number
  /** Local +Z drift, so no two roots of a seed sweep the same plane. */
  twist: number
}

interface StumpShape {
  height: number
  radius: number
  /** Rise of the cut face's dome above `height`, at the axis. */
  dome: number
  sectionAt: (theta: number) => number
  /** Normalises `stumpProfile` so `radius` means the radius at the cut. */
  profileScale: number
  grooveAt: (theta: number) => number
  /** Multiplicative dent for the axe notch. 1 everywhere on a sawn stump. */
  notchAt: (u: number, theta: number) => number
  roots: StumpRoot[]
  mossBearing: Vector3
  /** Integer, so every tier of the cut face samples the same ring pattern. */
  ringHarmonics: number
  seed: number
}

const buildShape = (options: StumpOptions): StumpShape => {
  const { seed = 1, form = 'sawn', height = 0.74, radius = 0.44 } = options
  const rng = makeRng(seed)

  const sectionAt = makeSection(rng, LOBES, SECTION_OFFSET, [0.04, 0.09])

  // `stumpProfile` peaks at the ground; normalising by that peak would make
  // `radius` mean the flare. It means the radius **at the cut**, which is the
  // number a level editor can see, so the scale is pinned at `u = 0` instead.
  const profileScale = 1 / stumpProfile(0)

  const notchBearing = rng.range(0, TAU)
  const notchDepth = form === 'notched' ? rng.range(0.26, 0.36) : 0
  const notchAt = (u: number, theta: number): number => {
    if (notchDepth === 0) {
      return 1
    }
    // `cos^6` rather than a gaussian: an integer power is exactly 2π-periodic,
    // so every tier finds the notch on the same bearing, and it is total, so the
    // loft may difference it outside the ring range.
    const around = Math.max(0, Math.cos(theta - notchBearing))
    const along = Math.max(0, 1 - ((u - 0.1) / 0.3) ** 2)
    return 1 - notchDepth * around ** 6 * along * along
  }

  // Three flares on a golden-angle spread, exactly as `tree.ts` places its
  // clumps: no seed can put two roots on the same side of the bole.
  const roots: StumpRoot[] = []
  const rootCount = 3
  const originY = height * 0.24
  for (let i = 0; i < rootCount; i++) {
    const bearing = (i / rootCount) * TAU + rng.spread(0.34) + seed * 2.39996
    const length = radius * rng.range(1.25, 1.7)
    roots.push({
      // Past π/2, so the root descends. The origin sits **on the axis** rather
      // than on the bole's surface: a root that starts on the surface leaves a
      // crescent of daylight the moment the section's wobble moves the surface a
      // couple of centimetres, and the swollen base is meant to be buried in the
      // bole anyway (`oldOak.ts` records the same trap for its limbs).
      frame: branchFrame(new Vector3(0, originY, 0), bearing, rng.range(1.68, 1.86), new Matrix4()),
      bearing,
      length,
      radius: radius * rng.range(0.34, 0.44),
      droop: length * rng.range(0.18, 0.32),
      twist: rng.spread(length * 0.1)
    })
  }

  const mossAngle = -Math.PI / 2 + rng.spread(0.9)

  return {
    height,
    radius,
    dome: radius * 0.06,
    sectionAt,
    profileScale,
    grooveAt: makeWoodGrain(rng, sectionAt),
    notchAt,
    roots,
    mossBearing: new Vector3(Math.cos(mossAngle), 0, Math.sin(mossAngle)),
    // 2 or 3, never more: the cut face carries at most four radial samples, and
    // a fourth ring would alias into a different pattern on the coarse tiers —
    // the same rule the bark grain's harmonics follow.
    ringHarmonics: rng.int(2, 3),
    seed
  }
}

// ─── Parts ──────────────────────────────────────────────────────────────────

/**
 * Scale that takes `sectionAt`/`stumpProfile` (both normalised to 1) to metres,
 * with both inscribed-polygon corrections applied (GDD §4.3).
 *
 * Computed here rather than inside `buildBole` because the cut face has to use
 * the **bole's** number, not its own. Sizing each part to its own ideal area
 * leaves them out of register by the difference between the two corrections,
 * which at LOD2's three segments is 6 % of the radius — a visible slot between
 * the bark and the wood, seen from directly above, which is exactly where this
 * prop is looked at.
 */
const boleScale = (shape: StumpShape, segments: number, us: readonly number[]): number =>
  shape.radius *
  shape.profileScale *
  sectionAreaInflate(segments, 0, shape.sectionAt) *
  profileVolumeInflate(us, stumpProfile, u => shape.height * (1 - u))

const buildBole = (shape: StumpShape, segments: number, us: readonly number[]): BufferGeometry => {
  const yAt = (u: number): number => shape.height * (1 - u)
  const scale = boleScale(shape, segments, us)
  const radiusAt = (u: number, theta: number): number =>
    scale * stumpProfile(u) * shape.sectionAt(theta) * shape.notchAt(u, theta)

  const geometry = loftGeometry({ us, segments, yAt, radiusAt })

  paintUniform(geometry, DEADWOOD_LIT)
  // Dark at the ground, bleached at the cut. Steeper than the ancient oak's 0.55
  // because a stump is 0.74 m tall: the whole ramp has to happen inside a knee's
  // worth of height or it reads as one flat colour.
  paintByHeight(geometry, DEADWOOD_DARK, DEADWOOD_LIT, { min: 0, max: shape.height, curve: 0.7 })
  paintByUpness(geometry, C.barkBase, 0.28, 2)
  paintWoodGrain(geometry, (_y, out) => out.set(0, 0, 0), shape.grooveAt, 0.55)
  return paintMoss(geometry, shape.mossBearing, shape.height * 0.72, 0.34)
}

/**
 * The saw cut: a shallow dome closed to a point at the axis.
 *
 * `us[0] = 0` gives a ring of radius zero, which `loftGeometry` closes into a
 * point for free — the second triangle of each quad in that band is degenerate
 * and `dropDegenerateFaces` prunes it, so the centre costs `segments` triangles
 * rather than `2 × segments`. The remaining rings are placed by hand rather than
 * by `buildRingList`: the radii are what the growth-ring paint samples, and a
 * greedy error refinement on a linear profile would put them wherever the widest
 * gap happened to be.
 */
const CAP_RINGS: Record<number, number[]> = {
  4: [0, 0.42, 0.74, 1],
  3: [0, 0.56, 1],
  2: [0, 1]
}

const buildCutFace = (
  shape: StumpShape,
  segments: number,
  rings: number,
  boleUs: readonly number[]
): BufferGeometry => {
  const us = CAP_RINGS[rings] ?? CAP_RINGS[2]!
  const scale = boleScale(shape, segments, boleUs)
  // Flush with the bark at the rim and doming up toward the axis, so `yAt` is
  // monotonically decreasing in `u` as `loftGeometry` requires and the bole's
  // top ring meets the cut face's outer ring exactly.
  const yAt = (u: number): number => shape.height + shape.dome * (1 - u * u)
  // 0.985 of the bark, which is the bark's own thickness. Not a gap: at LOD0
  // that is 6 mm on a 0.44 m stump, under a pixel at any distance the prop is
  // read from, and it stops the cut face's rim z-fighting the bole's top ring.
  const rimAt = (theta: number): number =>
    scale * stumpProfile(0) * shape.sectionAt(theta) * shape.notchAt(0, theta) * 0.985
  const radiusAt = (u: number, theta: number): number => rimAt(theta) * u

  const geometry = loftGeometry({ us, segments, yAt, radiusAt })

  let rim = 0
  for (let i = 0; i < 64; i++) {
    rim = Math.max(rim, rimAt((i / 64) * TAU))
  }
  return paintCutFace(geometry, new Vector3(0, 0, 0), rim, shape.ringHarmonics)
}

/**
 * Radius along one root. `u` runs 0 at the tip to 1 at the bole, matching
 * `loftGeometry`'s top-first convention (`yAt` must decrease in `u`).
 *
 * `u(0.45 + 0.55u)` rather than `u^1.6`: both taper to nothing at the tip, only
 * one of them is finite at `u = -0.0025`. The haunch at the base is what makes
 * the join look grown rather than drilled — the same 42 % the ancient oak's
 * limbs carry, and it costs nothing because `buildRingList` finds the swelling
 * on its own.
 */
const rootProfile = (u: number): number => u * (0.45 + 0.55 * u) * (1 + 0.36 * smootherstep(0.74, 1, u))

const ROOT_PROFILE_PEAK = ((): number => {
  let peak = 0
  for (let i = 0; i <= 64; i++) {
    peak = Math.max(peak, rootProfile(i / 64))
  }
  return peak
})()

const buildRoot = (shape: StumpShape, root: StumpRoot, segments: number, rings: number): BufferGeometry => {
  const yAt = (u: number): number => root.length * (1 - u)
  const offsetAt = (u: number, out: Vector3): Vector3 => {
    // `s` is 1 at the tip and 0 at the bole. Squared, so the droop is nothing at
    // the join — a root that leaves the bole already bending reads as broken.
    const s = 1 - u
    return out.set(-root.droop * s * s, 0, root.twist * s * s)
  }
  const profileAt = (u: number): number => rootProfile(u) / ROOT_PROFILE_PEAK

  // Signature is `(radius, jogX, jogZ)`, per `buildRingList` — a droop moves the
  // silhouette exactly as much as a radius change does, and a metric blind to it
  // spends every ring on the taper and none on the curve.
  const us = buildRingList([0, 1], rings, (u, out) => {
    offsetAt(u, out)
    const jogX = out.x
    const jogZ = out.z
    return out.set(root.radius * profileAt(u), jogX, jogZ)
  })

  const scale = root.radius * sectionAreaInflate(segments, 0, UNIT_SECTION) * profileVolumeInflate(us, profileAt, yAt)
  const radiusAt = (u: number): number => scale * profileAt(u)

  const geometry = loftGeometry({ us, segments, yAt, radiusAt, offsetAt })
  // Rotation only — `applyMatrix4` carries the analytic normals through the
  // normal matrix, so they stay exact and stay unit length.
  geometry.applyMatrix4(root.frame)

  paintUniform(geometry, DEADWOOD_DARK)
  paintByUpness(geometry, DEADWOOD_LIT, 0.34, 2)
  return paintMoss(geometry, shape.mossBearing, shape.height * 0.6, 0.4)
}

// ─── Tiers ──────────────────────────────────────────────────────────────────

interface StumpTier {
  segments: number
  boleRings: number
  capRings: number
  rootSegments: number
  /** 0 drops the roots entirely — LOD3 only. */
  rootRings: number
  budget: number
  aoSamples: number
}

/**
 * Triangles = segments × (boleRings − 1) × 2
 *           + segments × (capRings − 2) × 2 + segments
 *           + roots × (rootSegments × (rootRings − 2) × 2 + rootSegments)
 *
 * Segments are held at `2 × LOBES` down to LOD1 and the reduction is spent on
 * rings, which is the cliff family's rule for the reason it gives: the fused
 * section is what makes the bole recognisable, the profile is only its pose.
 *
 * **The cut face keeps its rings the longest** and that is the one ordering
 * worth stating. LOD2 drops the bole to a triangle in section while the cut face
 * still carries three radial rings, because at this asset's LOD1→LOD2 switch
 * (36 m at `distanceScale` 0.8) the bole is two pixels of bark and the cut face
 * is the entire prop.
 *
 * **LOD3 drops the roots**, which is the only tier boundary here that changes
 * the silhouette. At 88 m a 0.7 m flare is a third of a pixel, and the tier that
 * keeps it is spending a quarter of its triangles on nothing.
 */
const TIERS: StumpTier[] = [
  { segments: LOBES * 2, boleRings: 4, capRings: 4, rootSegments: 4, rootRings: 3, budget: 120, aoSamples: 14 },
  { segments: LOBES * 2, boleRings: 3, capRings: 3, rootSegments: 4, rootRings: 2, budget: 66, aoSamples: 10 },
  { segments: LOBES, boleRings: 3, capRings: 3, rootSegments: 3, rootRings: 2, budget: 34, aoSamples: 8 },
  { segments: LOBES, boleRings: 2, capRings: 2, rootSegments: 3, rootRings: 0, budget: 12, aoSamples: 6 }
]

const buildTier = (shape: StumpShape, tier: StumpTier, name: string): BufferGeometry => {
  const boleUs = buildRingList([0, 1], tier.boleRings, (u, out) => out.set(stumpProfile(u), 0, 0))

  const parts: BufferGeometry[] = [
    buildBole(shape, tier.segments, boleUs),
    buildCutFace(shape, tier.segments, tier.capRings, boleUs)
  ]
  if (tier.rootRings >= 2) {
    for (const root of shape.roots) {
      parts.push(buildRoot(shape, root, tier.rootSegments, tier.rootRings))
    }
  }

  const ranges = partRanges(parts)
  const merged = mergeParts(parts, name)

  // Baked on the merged stump, so the roots genuinely darken the bark between
  // them and the bole shades its own flutes. Range-split on apply: the cut face
  // resolves toward `HEARTWOOD` rather than toward the bark's dark, because the
  // pale sapwood ring is the entire read of this prop and one shared deep colour
  // drags it brown at exactly the rim where it matters.
  const ao = bakeVertexAO(merged, {
    samples: tier.aoSamples,
    maxDistance: shape.radius * 1.6,
    strength: 0.95,
    power: 1.2
  })
  for (let i = 0; i < ranges.length; i++) {
    const cut = i === 1
    applyVertexAO(merged, ao, cut ? HEARTWOOD : DEADWOOD_DARK, cut ? 0.45 : 0.7, ranges[i])
  }

  // A fresh generator per tier rather than the shape's own: drawing from a
  // shared stream here would make tier N's jitter depend on how many vertices
  // tier N−1 happened to have, so adding a ring to LOD0 would silently repaint
  // LOD2.
  jitterColor(merged, makeRng(shape.seed * 7919 + 311), 0.035)

  // Dead wood does not move. Painted explicitly rather than left to
  // `normalizeAssetGeometry`'s zero fill so the intent is in the file: a stump
  // swaying is the single most obviously wrong thing this prop could do, and the
  // material is built with `wind: false` for the same reason.
  paintWindWeight(merged, 0)

  return finishTier(merged, tier.budget, name)
}

export const createStumpAsset = (options: StumpOptions = {}): WorldAsset => {
  const shape = buildShape(options)
  const name = `stump-${options.form ?? 'sawn'}-${options.seed ?? 1}`

  const tiers = TIERS.map((tier, i) => buildTier(shape, tier, `${name}/LOD${i}`))

  return {
    name,
    perfTag: 'stumps',
    tiers,
    material: createToonMaterial({
      name: 'stump',
      // The **default** ramp, not the foliage one. `tree.ts` takes the foliage
      // ramp because bark and leaves share one draw call there and the softer
      // terminator costs the bark almost nothing; nothing here is a leaf, and
      // the harder terminator is what makes cut wood read as solid rather than
      // as a soft mass — the same argument `rock.ts` makes for mineral.
      // Matte wood rim — see `BARK_RIM`. A cut face is flat and fully lit, so
      // it takes the fresnel across its whole area the way a grass cap takes
      // the ramp's top band; the near-white additive turned it into wet resin.
      ...BARK_RIM,
      shadowTintMix: 0.3
    }),
    outline: createOutlineMaterial({ pixelWidth: 1.6, name: 'stump-outline' }),
    outlineMaxTier: 1,
    radius: measuredRadius(tiers),
    // Between the stone's 0.55 and the boulder's 1.15, and nearer the boulder:
    // this is a 0.9 m object whose read is a *pattern* on its top face rather
    // than a silhouette, and a pattern needs more pixels than an outline does.
    distanceScale: 0.8
  }
}

/**
 * Cylinder collider for the bole, in metres.
 *
 * `radius` is measured at the **narrowest** bearing of the fused section, for
 * the reason `plateauMetrics` and `oldOakMetrics` both give: the valleys sit
 * ~22 % in from the crests, and a collider sized on the crests claims solid wood
 * where there is a flute. `height` is the cut, dome excluded — the dome is
 * 26 mm and rounding a collider up to it buys nothing.
 */
export const stumpMetrics = (options: StumpOptions = {}): { radius: number; height: number } => {
  const shape = buildShape(options)
  let narrowest = Number.POSITIVE_INFINITY
  for (let i = 0; i < 128; i++) {
    const theta = (i / 128) * TAU
    narrowest = Math.min(narrowest, shape.sectionAt(theta) * shape.notchAt(0.1, theta))
  }
  return {
    // At `u = 0.55`, i.e. the waist rather than the flare: the flare is a skirt
    // that is ankle-high, and colliding on it would stop the player a hand's
    // width off the bark all the way up.
    //
    // Opened to 1.2× the inscribed bearing, exactly as `oldOakMetrics` is. The
    // inscribed rule protects a player standing on a *top*; this is a blocker,
    // where the failure to avoid is walking into visible wood, so the two go
    // opposite ways — and at a 20 %-deep section the gap between the inscribed
    // and circumscribed bearings is wide enough to notice.
    radius: shape.radius * shape.profileScale * stumpProfile(0.55) * narrowest * 1.2,
    height: shape.height
  }
}
