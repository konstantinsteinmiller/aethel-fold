import type { BufferGeometry } from 'three'
import { Color, Matrix4, Vector3 } from 'three'
import { C } from '../art/palette'
import { paintWindWeight } from '../geometry/build'
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
import { BARK_RIM, createToonMaterial } from '../shading/toonMaterial'
import { measuredRadius, mergeParts, partRanges } from './common'
import {
  branchFrame,
  DEADWOOD_DARK,
  DEADWOOD_LIT,
  HEARTWOOD,
  makeWoodGrain,
  paintMoss,
  paintWoodGrain,
  SAPWOOD
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
 * ─── Dead wood: the standing snag and the fallen log ────────────────────────
 *
 * Two forms out of one generator, for the reason `tree.ts` keeps two species in
 * one table: they are the same object in two poses. A snag is a trunk with no
 * canopy standing up; a log is the same trunk lying down. `FORMS` is the whole
 * difference between them, and sharing the generator is what guarantees the two
 * carry the same brown — which matters here more than usual, because in the
 * world they are the *before and after* of the same event and are scattered
 * within metres of each other.
 *
 * ── Why a bare trunk earns a species at all ─────────────────────────────────
 *
 * It is the cheapest way to break a canopy line, and a canopy line is the thing
 * that makes a procedural forest read as procedural. Every other tree in the
 * catalogue is a trunk plus a green mass at roughly the same height; a stand of
 * them is a continuous band of foliage with a continuous band of shadow under
 * it, and no amount of reseeding the trees changes that, because the mass is
 * where the eye reads the *stand* rather than the tree.
 *
 * A snag puts a vertical bar through the band for 90 triangles. It is the same
 * argument the GDD makes for the palisade's stakes — the gaps are the read — and
 * it is why this asset gets a species of its own rather than being folded into
 * the scatter as a rare seed of something else.
 *
 * ── The log is a loft in a rotated frame, and the paint runs before the ──────
 * ── rotation ───────────────────────────────────────────────────────────────
 *
 * `loftGeometry` builds a surface of revolution about **+Y**; a log is one about
 * an axis that is nearly horizontal. So the trunk is lofted upright and rotated
 * into place with `applyMatrix4`, exactly as `oldOak.ts` does for its limbs and
 * for the reason recorded in `deadwood.ts::branchFrame` — a tube tilted 85° from
 * vertical and built from horizontal rings comes out **11×** too wide.
 *
 * What that forces is the order of the paint passes, and it is not obvious:
 *
 *   • the **grain** is a function of bearing around the trunk's own axis, so it
 *     has to run *before* the rotation, while that axis is still +Y. After the
 *     rotation, `atan2(z, x)` about the object origin is a bearing around a line
 *     the log lies across, and the fissures spiral.
 *   • the **broken ends** are found by their normal being along the trunk's
 *     axis, so they too have to be found before the rotation — the log's ends
 *     face ±X in object space, where `paintByUpness` cannot see them.
 *   • the **sun bleaching** and the **moss** are functions of world up, so they
 *     have to run *after* it.
 *
 * Getting that order wrong does not throw and does not fail a budget: it ships a
 * log with its fissures wrapped the wrong way and its moss on one end.
 *
 * Budgets (GDD §4.1): 110 / 56 / 30 / 14, one ladder for both forms.
 */

export type DeadTreeForm = 'snag' | 'log'

export interface DeadTreeOptions {
  seed?: number
  /** Defaults to `'snag'` — the standing form. */
  form?: DeadTreeForm
  /** Trunk length in metres: height for a snag, length for a log. */
  length?: number
  /** Radius at the butt, before the flare. */
  radius?: number
}

const TAU = Math.PI * 2

/**
 * Buttresses in the bole. Three, and every tier samples `2 × LOBES` or `LOBES`
 * so the mesh lands on the arrises — see `stump.ts::LOBES` and
 * `plateau.ts::makeSection` for why a coprime segment count renders the section
 * as a smooth polygon and loses the flutes entirely.
 */
const LOBES = 3

/** 20 % valley relief at three lobes. Solved, not guessed — see `stump.ts`. */
const SECTION_OFFSET = 0.3

const UNIT_SECTION = (): number => 1

interface FormSpec {
  length: number
  radius: number
  limbCount: number
  /** Limb length as a fraction of the trunk's. */
  limbLength: [number, number]
  limbRadius: [number, number]
  /** Tilt of a limb from the trunk's own axis, in radians. */
  limbTilt: [number, number]
  /** Where limbs leave the trunk, as a fraction from the butt. */
  limbFrom: [number, number]
  /** Trunk radius at the far end, as a fraction of the butt's. */
  tipFraction: number
  /** Extra radius at the butt flare. A log's butt is torn, not flared. */
  flare: number
  /** Tilt of the whole trunk from vertical. `0` stands it up. */
  trunkTilt: number
  capButt: boolean
  moss: number
  /** Fraction of the trunk's length that the moss ramp fades over. */
  mossReach: number
  distanceScale: number
}

const FORMS: Record<DeadTreeForm, FormSpec> = {
  // The standing snag: 5.4 m of bare trunk, snapped off at the top rather than
  // tapering to a point. The snap is the species cue — a trunk that tapers to
  // nothing reads as a young tree that lost its leaves, while a 0.34-fraction
  // stub at 5 m up reads as one that broke.
  snag: {
    length: 5.4,
    radius: 0.34,
    limbCount: 3,
    limbLength: [0.14, 0.24],
    limbRadius: [0.3, 0.42],
    // Well up from horizontal: a dead limb that has not fallen off yet is one
    // that grew steeply enough to still be wedged on. The near-horizontal ones
    // are the first to go, which is why a real snag is a spike with stubs.
    limbTilt: [0.72, 1.12],
    limbFrom: [0.48, 0.86],
    tipFraction: 0.34,
    flare: 0.42,
    trunkTilt: 0,
    capButt: false,
    moss: 0.26,
    mossReach: 0.3,
    // 5.4 m tall and 0.5 m wide: it holds detail further out than a boulder and
    // nothing like as far as a tree, whose canopy is the thing that carries.
    distanceScale: 1.7
  },
  // The fallen log: 3.6 m lying nearly flat, both ends torn open, mossed along
  // its whole upper flank. `trunkTilt` just under π/2 lifts the far end ~4°, so
  // it reads as having come down across something rather than as a cylinder
  // laid on a table.
  log: {
    length: 3.6,
    radius: 0.3,
    limbCount: 2,
    limbLength: [0.16, 0.26],
    limbRadius: [0.32, 0.44],
    limbTilt: [0.85, 1.3],
    limbFrom: [0.35, 0.8],
    tipFraction: 0.62,
    // No flare. The butt of a fallen trunk is where it broke, and a root flare
    // there would say it was uprooted whole — a different, much larger prop.
    flare: 0.08,
    trunkTilt: Math.PI / 2 - 0.07,
    capButt: true,
    // The strongest cue after the horizontal silhouette that this is *fallen*
    // rather than felled: it has been lying in the damp.
    moss: 0.52,
    mossReach: 1,
    distanceScale: 1.2
  }
}

interface DeadLimb {
  /** Local → object, rotation of the trunk included. */
  frame: Matrix4
  length: number
  radius: number
  /** Local −X droop at the tip. */
  droop: number
  twist: number
}

interface DeadShape {
  spec: FormSpec
  length: number
  radius: number
  sectionAt: (theta: number) => number
  /** Normalises the profile so `radius` is the radius at the butt. */
  profileScale: number
  profileAt: (u: number) => number
  grooveAt: (theta: number) => number
  /** Trunk local → object. Identity for a snag. */
  trunkFrame: Matrix4
  limbs: DeadLimb[]
  mossBearing: Vector3
  mossTop: number
  seed: number
}

/**
 * Trunk radius along the bole. `u` runs 0 at the far end (the break, or the
 * log's tip) to 1 at the butt, matching `loftGeometry`'s top-first convention.
 *
 * Clamped smoothersteps only, so the function is C² **and total** — the loft's
 * central differences sample `u = -0.0025` at the break and `u = 1.0025` under
 * the ground, and a fractional power at either is NaN. That arithmetic is what
 * shipped a solid black cap on eight cliff tiers; `plateau.ts::assertFiniteGeometry`
 * exists because of it.
 */
const makeProfile =
  (tipFraction: number, flare: number) =>
  (u: number): number => {
    const bole = tipFraction + (1 - tipFraction) * smootherstep(0, 0.62, u)
    return bole * (1 + flare * smootherstep(0.74, 1, u))
  }

const buildShape = (options: DeadTreeOptions): DeadShape => {
  const spec = FORMS[options.form ?? 'snag']
  const { seed = 1, length = spec.length, radius = spec.radius } = options
  const rng = makeRng(seed)

  const sectionAt = makeSection(rng, LOBES, SECTION_OFFSET, [0.05, 0.11])
  const profileAt = makeProfile(spec.tipFraction, spec.flare)
  // Pinned at the butt rather than at the peak, so `radius` means the radius of
  // the thing a collider is sized to rather than the widest point of a flare
  // that is ankle-high.
  const profileScale = 1 / profileAt(1)

  // A snag stands up; a log lies down. One matrix covers both, which is what
  // lets every part below be built in one upright local frame and rotated once.
  const trunkFrame =
    spec.trunkTilt === 0
      ? new Matrix4()
      : branchFrame(new Vector3(-length * 0.5, radius * 0.92, 0), 0, spec.trunkTilt, new Matrix4())

  const limbs: DeadLimb[] = []
  for (let i = 0; i < spec.limbCount; i++) {
    // Golden-angle offset on top of the even spread, as everything else in the
    // catalogue does it: no seed can put two limbs on the same side.
    const bearing = (i / spec.limbCount) * TAU + rng.spread(0.5) + seed * 2.39996
    const from = rng.range(spec.limbFrom[0], spec.limbFrom[1])
    const limbLength = length * rng.range(spec.limbLength[0], spec.limbLength[1])
    // Built in the trunk's own local frame and then carried into object space by
    // the trunk's matrix, so a log's stubs point out of the log rather than
    // straight up out of the ground.
    const local = branchFrame(
      new Vector3(0, length * from, 0),
      bearing,
      rng.range(spec.limbTilt[0], spec.limbTilt[1]),
      new Matrix4()
    )
    limbs.push({
      frame: trunkFrame.clone().multiply(local),
      length: limbLength,
      radius: radius * rng.range(spec.limbRadius[0], spec.limbRadius[1]),
      droop: limbLength * rng.range(0.1, 0.26),
      twist: rng.spread(limbLength * 0.12)
    })
  }

  const mossAngle = -Math.PI / 2 + rng.spread(0.85)

  return {
    spec,
    length,
    radius,
    sectionAt,
    profileScale,
    profileAt,
    grooveAt: makeWoodGrain(rng, sectionAt),
    trunkFrame,
    limbs,
    mossBearing: new Vector3(Math.cos(mossAngle), 0, Math.sin(mossAngle)),
    mossTop: Math.max(0.35, length * spec.mossReach),
    seed
  }
}

// ─── Paint ──────────────────────────────────────────────────────────────────

const _break = new Color()

/**
 * Paints the torn wood of a break, found by the vertex normal pointing along the
 * trunk's **local** axis.
 *
 * Run before the trunk is rotated, so a log's two end caps are found by the same
 * test that finds a snag's snapped top — see the header. The 0.86 threshold sits
 * above the steepest side normal the profile produces (measured at 0.41 on the
 * snag's taper), so it selects the caps and nothing else at every tier.
 *
 * The colour is `SAPWOOD` pulled halfway back to weathered grey, not `SAPWOOD`
 * itself: a break is years old and has greyed, while a saw cut on a stump is
 * days old and has not. That difference is the only thing separating a felled
 * stump from a snapped one at distance, and it costs a `lerp`.
 */
const BREAK = SAPWOOD.clone().lerp(DEADWOOD_LIT, 0.5)

const paintBreak = (geometry: BufferGeometry): BufferGeometry => {
  const normal = geometry.getAttribute('normal')
  const attribute = ensureColorAttribute(geometry)
  const array = attribute.array as Float32Array
  for (let i = 0; i < normal.count; i++) {
    const along = Math.abs(normal.getY(i))
    if (along < 0.86) {
      continue
    }
    const t = (along - 0.86) / 0.14
    _break.setRGB(array[i * 3]!, array[i * 3 + 1]!, array[i * 3 + 2]!).lerp(BREAK, t)
    array[i * 3] = _break.r
    array[i * 3 + 1] = _break.g
    array[i * 3 + 2] = _break.b
  }
  attribute.needsUpdate = true
  return geometry
}

// ─── Parts ──────────────────────────────────────────────────────────────────

const buildTrunk = (shape: DeadShape, segments: number, rings: number): BufferGeometry => {
  const { spec } = shape
  const yAt = (u: number): number => shape.length * (1 - u)
  const profileAt = (u: number): number => shape.profileAt(u) * shape.profileScale
  const us = buildRingList([0, 1], rings, (u, out) => out.set(profileAt(u), 0, 0))

  const scale =
    shape.radius * sectionAreaInflate(segments, 0, shape.sectionAt) * profileVolumeInflate(us, profileAt, yAt)
  const radiusAt = (u: number, theta: number): number => scale * profileAt(u) * shape.sectionAt(theta)

  const geometry = loftGeometry({ us, segments, yAt, radiusAt, capTop: true, capBottom: spec.capButt })

  // ── Local space: everything keyed to the trunk's own axis ────────────────
  paintUniform(geometry, DEADWOOD_LIT)
  paintByHeight(geometry, DEADWOOD_DARK, DEADWOOD_LIT, { min: 0, max: shape.length, curve: 0.5 })
  paintWoodGrain(geometry, (_y, out) => out.set(0, 0, 0), shape.grooveAt, 0.5)
  paintBreak(geometry)

  // Rotation only — `applyMatrix4` carries the analytic normals through the
  // normal matrix, so they stay exact and stay unit length.
  geometry.applyMatrix4(shape.trunkFrame)

  // ── Object space: everything keyed to world up ───────────────────────────
  paintByUpness(geometry, C.barkBase, 0.24, 2)
  return paintMoss(geometry, shape.mossBearing, shape.mossTop, spec.moss)
}

/**
 * Radius along one limb stub. `u` runs 0 at the tip to 1 at the trunk.
 *
 * `u(0.4 + 0.6u)` rather than a fractional power, for the totality reason above.
 * The haunch at the base is what makes the join read as grown rather than
 * drilled, and `buildRingList` finds the swelling on its own.
 */
const limbProfile = (u: number): number => u * (0.4 + 0.6 * u) * (1 + 0.4 * smootherstep(0.76, 1, u))

const LIMB_PROFILE_PEAK = ((): number => {
  let peak = 0
  for (let i = 0; i <= 64; i++) {
    peak = Math.max(peak, limbProfile(i / 64))
  }
  return peak
})()

const buildLimb = (shape: DeadShape, limb: DeadLimb, segments: number, rings: number): BufferGeometry => {
  const yAt = (u: number): number => limb.length * (1 - u)
  const offsetAt = (u: number, out: Vector3): Vector3 => {
    const s = 1 - u
    return out.set(-limb.droop * s * s, 0, limb.twist * s * s)
  }
  const profileAt = (u: number): number => limbProfile(u) / LIMB_PROFILE_PEAK

  const us = buildRingList([0, 1], rings, (u, out) => {
    offsetAt(u, out)
    const jogX = out.x
    const jogZ = out.z
    return out.set(limb.radius * profileAt(u), jogX, jogZ)
  })

  const scale = limb.radius * sectionAreaInflate(segments, 0, UNIT_SECTION) * profileVolumeInflate(us, profileAt, yAt)
  const radiusAt = (u: number): number => scale * profileAt(u)

  const geometry = loftGeometry({ us, segments, yAt, radiusAt, offsetAt })
  geometry.applyMatrix4(limb.frame)

  paintUniform(geometry, DEADWOOD_DARK)
  paintByUpness(geometry, DEADWOOD_LIT, 0.4, 2)
  return paintMoss(geometry, shape.mossBearing, shape.mossTop, shape.spec.moss * 0.7)
}

// ─── Tiers ──────────────────────────────────────────────────────────────────

interface DeadTier {
  segments: number
  trunkRings: number
  limbSegments: number
  /** 0 drops the limbs — LOD3 only. */
  limbRings: number
  budget: number
  aoSamples: number
}

/**
 * Triangles = segments × (trunkRings − 1) × 2 + segments × (caps)
 *           + limbs × (limbSegments × (limbRings − 2) × 2 + limbSegments)
 *
 * Segments hold at `2 × LOBES` to LOD1 and the reduction goes on rings, which is
 * the cliff family's rule: the section is what makes the bole recognisable, the
 * profile is only its pose.
 *
 * **LOD3 drops the limbs**, the one tier boundary here that changes the
 * silhouette. At the snag's LOD2→LOD3 switch (187 m at `distanceScale` 1.7) a
 * 1 m stub is a third of a pixel, and the tier that keeps it spends a third of
 * its triangles on nothing. Everything above LOD3 keeps all of them, because a
 * stub is exactly the feature that separates a snag from a fence post.
 */
const TIERS: DeadTier[] = [
  { segments: LOBES * 2, trunkRings: 5, limbSegments: 4, limbRings: 3, budget: 110, aoSamples: 12 },
  { segments: LOBES * 2, trunkRings: 3, limbSegments: 4, limbRings: 2, budget: 56, aoSamples: 10 },
  { segments: LOBES, trunkRings: 3, limbSegments: 3, limbRings: 2, budget: 30, aoSamples: 8 },
  { segments: LOBES, trunkRings: 2, limbSegments: 3, limbRings: 0, budget: 14, aoSamples: 6 }
]

const buildTier = (shape: DeadShape, tier: DeadTier, name: string): BufferGeometry => {
  const parts: BufferGeometry[] = [buildTrunk(shape, tier.segments, tier.trunkRings)]
  if (tier.limbRings >= 2) {
    for (const limb of shape.limbs) {
      parts.push(buildLimb(shape, limb, tier.limbSegments, tier.limbRings))
    }
  }

  const ranges = partRanges(parts)
  const merged = mergeParts(parts, name)

  // Baked on the merged trunk, so the stubs darken the bark under them. The
  // trunk resolves toward `HEARTWOOD` rather than toward the fissure dark: its
  // range includes the break, which is the palest surface on the prop, and
  // pulling *that* toward `DEADWOOD_DARK` closes the one feature the top of a
  // snag has.
  const ao = bakeVertexAO(merged, {
    samples: tier.aoSamples,
    maxDistance: shape.radius * 3.2,
    strength: 0.95,
    power: 1.2
  })
  for (let i = 0; i < ranges.length; i++) {
    applyVertexAO(merged, ao, i === 0 ? HEARTWOOD : DEADWOOD_DARK, i === 0 ? 0.5 : 0.7, ranges[i])
  }

  // A fresh generator per tier: drawing from a shared stream would make tier N's
  // jitter depend on how many vertices tier N−1 happened to have, so adding a
  // ring to LOD0 would silently repaint LOD2.
  jitterColor(merged, makeRng(shape.seed * 6151 + 907), 0.035)
  // Dead wood does not move, and the material is built with `wind: false`.
  paintWindWeight(merged, 0)

  return finishTier(merged, tier.budget, name)
}

export const createDeadTreeAsset = (options: DeadTreeOptions = {}): WorldAsset => {
  const shape = buildShape(options)
  const form = options.form ?? 'snag'
  const name = `dead-${form}-${options.seed ?? 1}`

  const tiers = TIERS.map((tier, i) => buildTier(shape, tier, `${name}/LOD${i}`))

  return {
    name,
    // One bucket for both forms *and* for the stump, so the ablation profiler
    // prices "the dead wood in this wood" as one line. Splitting it three ways
    // would put every row inside the profiler's noise floor, which this project
    // has already been caught by once (`AAA-graphics.md` §10: a tag that draws
    // nothing priced at 2.24 ms).
    perfTag: 'deadwood',
    tiers,
    material: createToonMaterial({
      name: 'deadwood',
      // The default ramp, not the foliage one: there is no leaf on this prop and
      // the harder terminator is what makes bare wood read as solid. Same call
      // `rock.ts` makes for mineral, and the opposite of `tree.ts`, which takes
      // the foliage ramp only because its bark shares a draw call with leaves.
      // Matte wood rim — see `BARK_RIM`. The thin dead branches are the one
      // place a fresnel band is as wide as the whole prop.
      ...BARK_RIM,
      shadowTintMix: 0.3
    }),
    outline: createOutlineMaterial({ pixelWidth: 1.6, name: 'deadwood-outline' }),
    outlineMaxTier: 1,
    radius: measuredRadius(tiers),
    distanceScale: shape.spec.distanceScale
  }
}

/**
 * Collider proxy, in metres.
 *
 * A snag reports a **cylinder** at chest height; a log reports a **box**, for
 * the reason `shard-wall` does — it is a *line* rather than a surface of
 * revolution, and a cylinder around a 3.6 m trunk lying on its side would be
 * mostly thin air with the player stopped a metre and a half from the wood.
 * The log's axis is fixed to object +X by `buildShape` so the box means
 * something before the placement's Y-rotation.
 *
 * Both are measured at the **narrowest** bearing and then opened to 1.15×: the
 * inscribed rule protects a player standing on a top, and this is a blocker,
 * where the failure to avoid is walking into visible wood.
 */
export const deadTreeMetrics = (
  options: DeadTreeOptions = {}
): { radius: number; height: number; halfX: number; halfZ: number } => {
  const shape = buildShape(options)
  let narrowest = Number.POSITIVE_INFINITY
  for (let i = 0; i < 128; i++) {
    narrowest = Math.min(narrowest, shape.sectionAt((i / 128) * TAU))
  }
  // At `u = 0.78` — chest height on the snag, and the fat third of a log.
  const stem = shape.radius * shape.profileScale * shape.profileAt(0.78) * narrowest * 1.15

  return {
    radius: stem,
    // A snag's collider stops just under the lowest limb stub, which is geometry
    // the cylinder does not describe and must therefore never stop the player.
    // A log's is its own diameter — it is a thing you step over, not around, and
    // the height is what tells the controller so.
    height: shape.spec.trunkTilt === 0 ? shape.length * shape.spec.limbFrom[0] * 0.95 : stem * 2,
    halfX: shape.length * 0.5 * Math.sin(shape.spec.trunkTilt || Math.PI / 2),
    halfZ: stem
  }
}
