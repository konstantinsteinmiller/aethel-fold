import type { BufferGeometry } from 'three'
import { Color, Matrix4, Vector3 } from 'three'
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
 * ─── The ancient oak ────────────────────────────────────────────────────────
 *
 * A landmark, not scatter. It is placed by hand in ones and twos and it is what
 * a player navigates by, so it gets the **hero budget** — 340 / 190 / 95 / 26
 * against the scatter tree's 200 / 110 / 56 / 16.
 *
 * That is the same trade the GDD already documents for the cliff family ("a
 * boulder is scatter, so its budget is really a per-*field* budget; a plateau is
 * placed by hand, in tens, and is usually the thing the player is standing on").
 * A tree the level designer puts down once, at a crossroads, is seen from four
 * metres for a long time and never appears forty times in one frame. What it
 * buys with the extra triangles is **branch structure**: the scatter tree is a
 * trunk with a canopy on top, and an oak that reads as centuries old has to show
 * where the trunk stops being a trunk.
 *
 * ── The trunk is a loft, not a tube, and that is the whole silhouette ───────
 *
 * `tree.ts` builds a 6-sided `tubeGeometry` and blends cylindrical normals onto
 * it, which is exactly right for a young broadleaf: a lathe-turned dowel *is*
 * what a 30-year-old trunk looks like. An old oak's bole is not that. It is a
 * bundle of fused buttresses with real arrises down the valleys, and the kit for
 * that already exists in `plateau.ts` — `makeSection(rng, lobes, offset, wobble)`
 * builds the pointwise **max** of overlapping off-axis circles, and a max of
 * smooth functions has a corner wherever the winner changes.
 *
 * The two rules that come with it apply here unchanged:
 *
 *   • **max, not sum.** A sum of the same circles is smooth everywhere and
 *     renders as the dowel this file exists to avoid.
 *   • **sample on the arris.** Segment counts are `2 × LOBES` at LOD0 and LOD1
 *     and `LOBES` at LOD2 — never a number coprime with the bundle. At 8 the
 *     mesh lands on all four crests *and* all four valley arrises; at 4 it still
 *     lands on every crest. A trunk at 7 or 9 segments renders the same section
 *     as a smooth polygon and the flutes never reach a triangle at all.
 *
 * ── Limbs are lofts in a rotated frame, not `tubeGeometry` ──────────────────
 *
 * `tubeGeometry`'s rings are horizontal circles by construction (it writes
 * `y = ring.center.y` for the whole ring). That is fine for a vertical trunk and
 * wrong for a limb: the horizontal section of a cylinder tilted `τ` from
 * vertical is an ellipse `1 / cos τ` wide, so a limb leaving at 35° renders 22 %
 * too fat across and one bending to 65° renders **2.4×** too fat — a flat ribbon
 * exactly where the branch structure is supposed to read.
 *
 * So each limb is built by `loftGeometry` in a **local frame whose +Y is the
 * direction the limb leaves the trunk in**, then rotated into place with
 * `applyMatrix4` (which carries the normals through the normal matrix). Rings
 * are then perpendicular to the limb at its base, where it is thick, and drift
 * off by the bend angle toward the tip, where it is 27 % of that radius and the
 * error is worth nothing. The bend itself rides in the loft's `offsetAt`, which
 * is what the plateau's strata jog already does — a gnarled limb is a jogged
 * axis, not a different primitive.
 *
 * ── Everything else is colour ───────────────────────────────────────────────
 *
 * The deep fissures are a bearing-driven paint pass (`makeBarkGroove`), built
 * from the section's own valley depth plus low **integer** harmonics so it closes
 * at 2π and every tier agrees on where the grooves are. Harmonics stay at or
 * below the 4th on purpose: the trunk is sampled at 8 bearings, and a 7th
 * harmonic would alias into a different pattern on every tier — the colour
 * equivalent of the flute jitter `makeFlutes` was written to avoid. It costs
 * zero triangles, which is GDD R1 in its purest form.
 *
 * Budgets (GDD §4.1): 340 / 190 / 95 / 26.
 */

export interface OldOakOptions {
  seed?: number
  /** Finished height in metres, canopy top included. The shape is rescaled to
   *  hit it exactly — see `buildShape`. */
  height?: number
}

// ─── Small maths ────────────────────────────────────────────────────────────

const TAU = Math.PI * 2

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t)

/** Buttresses in the bole. Every tier's segment count is 2× or 1× this. */
const LOBES = 4

/**
 * `offset` 0.42 puts the valleys 20 % in from the crests — the same relief the
 * plateau's 6-lobe bundle carries. The number is not transferable between lobe
 * counts: at 4 lobes the neighbours are 90° apart rather than 60°, so the
 * plateau's 0.56 would cut the valleys to 38 % deep and the trunk would read as
 * a four-pointed star rather than as fused wood.
 */
const SECTION_OFFSET = 0.42

const UNIT_SECTION = (): number => 1

const _up = new Vector3(0, 1, 0)

/** Longitudinal segments of a canopy clump at LOD0. See `TIERS`. */
const LOD0_CLUMP_W = 5

/**
 * `blobGeometry` scales every tier by `1/cos(π/W)^0.6` so a coarse tier is not a
 * genuinely smaller object (GDD §4.3), which means a clump's pole sits 14 % above
 * its nominal radius. Predicting the canopy top without it leaves the `height`
 * option reading 2.3 % short — small, but `height` is what a level editor types
 * to stand a tree against a cliff of a known size.
 */
const CANOPY_INFLATE = 1 / Math.cos(Math.PI / LOD0_CLUMP_W) ** 0.6

/** The same factor for the LOD3 impostor, which is sampled at 4 segments. */
const IMPOSTOR_INFLATE = 1 / Math.cos(Math.PI / 4) ** 0.6

/** Bearings used to sample the canopy's support function. */
const BEARINGS = 64

const _bearing = new Vector3()

/** Average push of the lump field around a clump's equator, ×radius. */
const meanEquatorialLump = (lumps: readonly Lump[]): number => {
  let sum = 0
  for (let i = 0; i < BEARINGS; i++) {
    const theta = (i / BEARINGS) * TAU
    _bearing.set(Math.cos(theta), 0, Math.sin(theta))
    sum += lumpRadius(_bearing, lumps)
  }
  return sum / BEARINGS
}

// ─── Trunk profile ──────────────────────────────────────────────────────────

/** Where the root flare's skirt begins. Above this the bole is the collider. */
const FLARE_TOP = 0.76

/**
 * `u` runs 0 at the top of the bole to 1 at the ground.
 *
 * Two multiplied smootherstep terms rather than a taper plus an exponential
 * flare (which is what `tree.ts` uses). A product of clamped smoothersteps is C²
 * *and* **total**: the loft's central differences sample `u = -0.0025` at the
 * crown and `u = 1.0025` under the ground, and `exp(-9u)` there is finite but a
 * fractional power is not — that is the arithmetic that shipped a solid black
 * cap on eight cliff tiers (see `assertFiniteGeometry`).
 *
 *   0.56 at the split → 1.00 by the waist → 1.40 at the root flare
 *
 * The flare is the shape's signature: 40 % of extra radius packed into the
 * bottom 24 % of the bole, which is what makes an oak look like it grew out of
 * the ground rather than being pushed into it.
 */
const oakTrunkProfile = (u: number): number => {
  const bole = 0.56 + 0.44 * smootherstep(0, 0.7, u)
  const flare = 1 + 0.4 * smootherstep(FLARE_TOP, 1, u)
  return bole * flare
}

// ─── Limb profile ───────────────────────────────────────────────────────────

/**
 * Radius along one limb. `s` runs 0 at the trunk to 1 at the tip.
 *
 * The haunch matters more than the taper. A limb that leaves the trunk at its
 * own nominal radius reads as a pipe pushed into a hole; swelling it 42 % over
 * the last quarter-metre is what makes the join look grown, and it costs nothing
 * because the rings are placed by `buildRingList`, which finds the swelling on
 * its own.
 */
const limbProfile = (u: number): number => {
  const s = 1 - u
  const taper = 1 - 0.62 * smootherstep(0, 1, s)
  const haunch = 1 + 0.42 * smootherstep(0.24, 0, s)
  return taper * haunch
}

/** Normaliser, so a limb's `radius` means its true maximum. */
const LIMB_PROFILE_PEAK = ((): number => {
  let peak = 0
  for (let i = 0; i <= 64; i++) {
    peak = Math.max(peak, limbProfile(i / 64))
  }
  return peak
})()

// ─── Shape ──────────────────────────────────────────────────────────────────

interface OakLimb {
  origin: Vector3
  /** Local → object. Local +Y is the direction the limb leaves the trunk in. */
  frame: Matrix4
  bearing: number
  /** Tilt from vertical at the trunk, in radians. */
  tilt: number
  length: number
  radius: number
  /** Local +X swing at the tip — how far the limb bends back toward horizontal. */
  bend: number
  /** Reverse curl near the base, so the limb is an S rather than an arc. */
  gnarl: number
  /** Local +Z drift, so no two limbs of a seed sweep the same plane. */
  twist: number
}

interface OakClump {
  center: Vector3
  radius: number
  squash: number
  lumps: Lump[]
}

interface OldOakShape {
  height: number
  trunkTop: number
  splitY: number
  flareRadius: number
  lean: Vector3
  sectionAt: (theta: number) => number
  /** Normalises the profile so `flareRadius` is the true maximum radius. */
  profileScale: number
  grooveAt: (theta: number) => number
  mossBearing: Vector3
  mossTop: number
  limbs: OakLimb[]
  clumps: OakClump[]
  /** Peak of the canopy's support function — the cull radius and AO scale. */
  canopyRadius: number
  /** Its mean over bearings — what the LOD3 impostor is solved against. */
  canopyMeanRadius: number
  canopyBottom: number
  seed: number
}

/**
 * Bearing → groove depth, 0 on a crest and 1 in the deepest fissure.
 *
 * Driven by the section itself rather than by a free noise field, so the dark
 * lines land in the valleys of the fused bundle instead of wandering across the
 * crests. The `0.2` floor is not decoration: LOD2 samples only the four crests,
 * where the valley term is exactly 0, and without a floor the trunk would jump a
 * whole shade lighter across the LOD1→LOD2 crossfade.
 */
const makeBarkGroove = (rng: Rng, sectionAt: (theta: number) => number): ((theta: number) => number) => {
  let low = Number.POSITIVE_INFINITY
  for (let i = 0; i < 256; i++) {
    low = Math.min(low, sectionAt((i / 256) * TAU))
  }
  const span = Math.max(1e-3, 1 - low)

  // At or below the 4th harmonic. The trunk carries 8 bearings at its finest
  // tier, so anything above that aliases into a different pattern per tier.
  const f1 = rng.int(1, 2)
  const f2 = rng.int(3, 4)
  const p1 = rng.range(0, TAU)
  const p2 = rng.range(0, TAU)

  return theta => {
    const valley = clamp01((1 - sectionAt(theta)) / span)
    const grain = 0.5 + 0.5 * Math.cos(f1 * theta + p1)
    const cross = 0.5 + 0.5 * Math.cos(f2 * theta + p2)
    return clamp01(0.2 + 0.5 * valley + 0.18 * grain + 0.12 * cross)
  }
}

const _limbX = new Vector3()
const _limbY = new Vector3()
const _limbZ = new Vector3()

/**
 * Local → object for one limb: +Y is the limb's launch direction, +X is the
 * outward horizontal bearing orthogonalised against it — which, because the
 * launch direction tilts up, points outward **and down**. That is what lets the
 * bend term (a plain `+X` offset) curl the limb toward the horizontal.
 */
const makeLimbFrame = (origin: Vector3, bearing: number, tilt: number, out: Matrix4): Matrix4 => {
  const sin = Math.sin(tilt)
  _limbY.set(sin * Math.cos(bearing), Math.cos(tilt), sin * Math.sin(bearing))
  _limbX.set(Math.cos(bearing), 0, Math.sin(bearing)).addScaledVector(_limbY, -sin).normalize()
  _limbZ.crossVectors(_limbX, _limbY)
  out.makeBasis(_limbX, _limbY, _limbZ)
  out.setPosition(origin.x, origin.y, origin.z)
  return out
}

const _localTip = new Vector3()
const _outward = new Vector3()

const buildShape = (options: OldOakOptions): OldOakShape => {
  const { seed = 1, height = 11 } = options
  const rng = makeRng(seed)

  // Nominal proportions, as fractions of the requested height. The finished
  // shape is rescaled at the end of this function so the canopy top lands on
  // `height` exactly, so these are ratios to a first approximation rather than
  // to the metre.
  let trunkTop = height * 0.345
  let splitY = height * 0.285
  let flareRadius = height * 0.0735
  const limbOriginY = height * 0.225

  const leanAngle = rng.range(0, TAU)
  const leanAmount = height * rng.range(0.006, 0.018)
  const lean = new Vector3(Math.cos(leanAngle) * leanAmount, 0, Math.sin(leanAngle) * leanAmount)

  const sectionAt = makeSection(rng, LOBES, SECTION_OFFSET, [0.04, 0.09])

  let profilePeak = 0
  for (let i = 0; i <= 128; i++) {
    profilePeak = Math.max(profilePeak, oakTrunkProfile(i / 128))
  }
  const profileScale = profilePeak > 1e-6 ? 1 / profilePeak : 1

  // ── Limbs ────────────────────────────────────────────────────────────────
  const limbCount = rng.int(3, 4)
  const limbLength = height * rng.range(0.42, 0.48)
  const limbRadius = flareRadius * rng.range(0.36, 0.44)

  // The origin sits *below* the visible split and on the axis, so the swollen
  // haunch is buried inside the bole. A limb that starts on the trunk's surface
  // leaves a crescent of daylight the moment the section's wobble moves the
  // surface a few centimetres.
  const originJog = (limbOriginY / trunkTop) ** 2
  const origin = new Vector3(lean.x * originJog, limbOriginY, lean.z * originJog)

  const limbs: OakLimb[] = []
  for (let i = 0; i < limbCount; i++) {
    // Golden-angle offset on top of the even spread, exactly as `tree.ts` does
    // it: no seed can put two limbs on the same side of the trunk.
    const bearing = (i / limbCount) * TAU + rng.spread(0.42) + seed * 2.39996
    const tilt = rng.range(0.53, 0.66)
    const sweep = rng.range(0.26, 0.42)
    const length = limbLength * rng.range(0.88, 1.08)
    limbs.push({
      origin: origin.clone(),
      frame: makeLimbFrame(origin, bearing, tilt, new Matrix4()),
      bearing,
      tilt,
      length,
      radius: limbRadius * rng.range(0.86, 1.12),
      // `bend = L·tan(sweep)/2` is what a quadratic offset needs for its tip
      // tangent to sit `sweep` radians off the launch direction.
      bend: (length * Math.tan(sweep)) / 2,
      gnarl: length * rng.range(0.05, 0.13),
      twist: rng.spread(length * 0.08)
    })
  }

  // ── Canopy ───────────────────────────────────────────────────────────────
  //
  // One clump per limb, centred just *inboard* of the tip: foliage grows along
  // the outer half of a limb, and hanging it off the very end pushes the canopy
  // a full clump-radius wider than the branch structure that supports it.
  const clumpSquash = rng.range(0.56, 0.64)
  const outerRadius = height * rng.range(0.148, 0.168)
  const clumps: OakClump[] = []

  for (const limb of limbs) {
    _localTip.set(limb.bend, limb.length, limb.twist).applyMatrix4(limb.frame)
    _outward.set(Math.cos(limb.bearing), 0, Math.sin(limb.bearing))
    const radius = outerRadius * rng.range(0.92, 1.08)
    clumps.push({
      // Inboard along the bearing and up by half the clump's own squashed
      // half-height, which puts the tip a bit past half way to the clump's
      // surface — buried at every seed (measured worst case 0.54), but not so
      // deep that the limb stops looking like it carries the canopy.
      center: _localTip
        .clone()
        .addScaledVector(_outward, -radius * 0.4)
        .setY(_localTip.y + radius * clumpSquash * 0.5),
      radius,
      squash: clumpSquash,
      // Broad, gentle lumps: a canopy wants a soft irregular mass, not knuckles.
      lumps: makeLumps(rng, 4, [0.08, 0.22], [1.2, 2.6])
    })
  }

  // Two crown clumps close to the axis and higher, which is what turns a ring of
  // blobs into an umbrella. Their height above the outer ring is held to
  // `0.175 × height` because that is roughly the vertical reach of two squashed
  // spheroids: push them further and the crown floats free of the canopy it is
  // supposed to cap, which reads as a second, smaller tree.
  let outerMeanY = 0
  for (const clump of clumps) {
    outerMeanY += clump.center.y / clumps.length
  }
  const crownRadius = height * rng.range(0.215, 0.235)
  const crownDistance = height * 0.135
  const crownBearing = rng.range(0, TAU)
  for (let i = 0; i < 2; i++) {
    const angle = crownBearing + i * Math.PI + rng.spread(0.4)
    clumps.push({
      center: new Vector3(
        Math.cos(angle) * crownDistance,
        outerMeanY + height * 0.175 + rng.spread(height * 0.012),
        Math.sin(angle) * crownDistance
      ),
      radius: crownRadius * rng.range(0.94, 1.06),
      squash: clumpSquash * 0.96,
      lumps: makeLumps(rng, 4, [0.08, 0.2], [1.2, 2.6])
    })
  }

  // ── Rescale so the crown lands exactly on `height` ────────────────────────
  //
  // Every length above is linear in one scale factor and no rotation depends on
  // it, so measuring the true top once and multiplying through is exact. Doing
  // it the other way — solving the proportions so the top comes out right — is
  // not possible in closed form once the lump field is in the way, and guessing
  // leaves the option `height` meaning "about that tall", which is useless to a
  // level editor placing the thing against a cliff.
  let top = 0
  for (const clump of clumps) {
    top = Math.max(
      top,
      clump.center.y + clump.radius * clump.squash * CANOPY_INFLATE * lumpRadius(_up, clump.lumps)
    )
  }
  const k = top > 1e-6 ? height / top : 1

  trunkTop *= k
  splitY *= k
  flareRadius *= k
  lean.multiplyScalar(k)
  for (const limb of limbs) {
    limb.origin.multiplyScalar(k)
    limb.length *= k
    limb.radius *= k
    limb.bend *= k
    limb.gnarl *= k
    limb.twist *= k
    makeLimbFrame(limb.origin, limb.bearing, limb.tilt, limb.frame)
  }

  let canopyRadius = 0
  let canopyBottom = Number.POSITIVE_INFINITY
  for (const clump of clumps) {
    clump.center.multiplyScalar(k)
    clump.radius *= k
    canopyBottom = Math.min(canopyBottom, clump.center.y - clump.radius * clump.squash)
  }

  // The canopy's **support function**: how far the union of the clumps reaches
  // along each bearing, on the surface LOD0 actually renders (lump field and
  // inscribed-polygon inflate included). The peak sizes the cull radius; the
  // mean sizes the LOD3 impostor, which is a body of revolution standing in for
  // a lumpy ring and would otherwise have to choose between overhanging it at
  // every bearing or tucking inside it at every bearing.
  let canopyMeanRadius = 0
  for (let i = 0; i < BEARINGS; i++) {
    const theta = (i / BEARINGS) * TAU
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    _bearing.set(cos, 0, sin)
    let reach = 0
    for (const clump of clumps) {
      reach = Math.max(
        reach,
        clump.center.x * cos +
          clump.center.z * sin +
          clump.radius * CANOPY_INFLATE * lumpRadius(_bearing, clump.lumps)
      )
    }
    canopyRadius = Math.max(canopyRadius, reach)
    canopyMeanRadius += reach / BEARINGS
  }

  // Biased north (−Z) but not pinned to it: instances are yaw-rotated in the
  // world, so a hard compass direction in object space is a fiction anyway, and
  // a per-seed bearing stops two neighbouring oaks mossing identically.
  const mossAngle = -Math.PI / 2 + rng.spread(0.8)

  return {
    height,
    trunkTop,
    splitY,
    flareRadius,
    lean,
    sectionAt,
    profileScale,
    grooveAt: makeBarkGroove(rng, sectionAt),
    mossBearing: new Vector3(Math.cos(mossAngle), 0, Math.sin(mossAngle)),
    mossTop: splitY + (limbs[0]?.length ?? 0) * 0.45,
    limbs,
    clumps,
    canopyRadius,
    canopyMeanRadius,
    canopyBottom,
    seed
  }
}

// ─── Bark paint ─────────────────────────────────────────────────────────────

/**
 * Bottom of the bark's vertical ramp. `barkOldDark` alone puts the root flare in
 * the darkest band, and the AO and the fissure pass then multiply into it — the
 * three together land under the not-black floor (GDD R4), which is the one place
 * this family can actually go wrong on colour rather than on shape.
 */
const BARK_LOW = C.barkOldDark.clone().lerp(C.barkOldBase, 0.42)

/** Ceiling on the fissure and AO passes, for the reason above. */
const FISSURE_STRENGTH = 0.55
const BARK_AO_STRENGTH = 0.6

const _paint = new Color()
const _axis = new Vector3()

/**
 * Darkens the valleys of the fused section toward `barkOldDark`.
 *
 * The bearing is measured against the trunk's **jogged** axis at that height,
 * not against the object origin, so the grooves stay on the flutes when the bole
 * leans. `loftGeometry` writes `x = cosθ·r + offsetX`, so this recovers exactly
 * the θ the section was evaluated at — the pass and the shape agree to the last
 * digit, on every tier.
 */
const paintBarkFissures = (
  geometry: BufferGeometry,
  axisAt: (y: number, out: Vector3) => Vector3,
  grooveAt: (theta: number) => number,
  strength: number
): BufferGeometry => {
  const position = geometry.getAttribute('position')
  const attribute = ensureColorAttribute(geometry)
  const array = attribute.array as Float32Array

  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i)
    axisAt(y, _axis)
    const dx = position.getX(i) - _axis.x
    const dz = position.getZ(i) - _axis.z
    if (dx * dx + dz * dz < 1e-10) {
      continue
    }
    const t = grooveAt(Math.atan2(dz, dx)) * strength
    const r = array[i * 3]!
    const g = array[i * 3 + 1]!
    const b = array[i * 3 + 2]!
    array[i * 3] = r + (C.barkOldDark.r - r) * t
    array[i * 3 + 1] = g + (C.barkOldDark.g - g) * t
    array[i * 3 + 2] = b + (C.barkOldDark.b - b) * t
  }
  attribute.needsUpdate = true
  return geometry
}

/**
 * Moss on the up-facing, shaded side of the lower trunk and the limb tops.
 *
 * Gated on the normal's upness *and* on height *and* on bearing, all three, and
 * held to 0.3 at its strongest. Two of the three gates were not enough: upness
 * alone greened every limb in the canopy, and upness plus height painted a
 * continuous collar round the bole that read as a stripe of paint rather than as
 * something growing on one flank.
 */
const paintMoss = (geometry: BufferGeometry, bearing: Vector3, maxY: number, amount: number): BufferGeometry => {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const attribute = ensureColorAttribute(geometry)
  const array = attribute.array as Float32Array

  for (let i = 0; i < position.count; i++) {
    const up = normal.getY(i)
    if (up < 0.06) {
      continue
    }
    const fade = 1 - clamp01(position.getY(i) / maxY)
    if (fade <= 0) {
      continue
    }
    const face = Math.max(0, normal.getX(i) * bearing.x + normal.getZ(i) * bearing.z)
    const t = up ** 1.6 * fade * (0.3 + 0.7 * face) * amount
    _paint.setRGB(array[i * 3]!, array[i * 3 + 1]!, array[i * 3 + 2]!).lerp(C.grassCapBase, t)
    array[i * 3] = _paint.r
    array[i * 3 + 1] = _paint.g
    array[i * 3 + 2] = _paint.b
  }
  attribute.needsUpdate = true
  return geometry
}

// ─── Parts ──────────────────────────────────────────────────────────────────

const buildTrunk = (shape: OldOakShape, segments: number, rings: number, cap: boolean): BufferGeometry => {
  const yAt = (u: number): number => shape.trunkTop * (1 - u)
  const offsetAt = (u: number, out: Vector3): Vector3 => {
    // Squared height fraction, not a fractional power: the lean has to be a
    // total function of `u` for the same reason the profile does.
    const t = 1 - u
    const k = t * t
    return out.set(shape.lean.x * k, 0, shape.lean.z * k)
  }
  const profileAt = (u: number): number => oakTrunkProfile(u) * shape.profileScale

  // Signature is `(radius, jogX, jogZ)`, per `buildRingList` — a lean moves the
  // silhouette exactly as much as a radius change does, and a metric blind to it
  // spends every ring on the flare and none on the tilt.
  const us = buildRingList([0, 1], rings, (u, out) => {
    offsetAt(u, out)
    const jogX = out.x
    const jogZ = out.z
    return out.set(shape.flareRadius * profileAt(u), jogX, jogZ)
  })

  const inflate = sectionAreaInflate(segments, 0, shape.sectionAt)
  const scale = shape.flareRadius * inflate * profileVolumeInflate(us, profileAt, yAt)
  const radiusAt = (u: number, theta: number): number => scale * profileAt(u) * shape.sectionAt(theta)

  const geometry = loftGeometry({ us, segments, yAt, radiusAt, offsetAt, capTop: cap })

  paintByHeight(geometry, BARK_LOW, C.barkOldBase, { min: 0, max: shape.trunkTop, curve: 0.55 })
  // The young-tree bark stands in for a weathered highlight on up-facing wood.
  // There is no `barkOldLit`, and adding one would be a palette entry that only
  // ever appears here at 35 % strength.
  paintByUpness(geometry, C.barkBase, 0.35, 2)
  paintBarkFissures(
    geometry,
    (y, out) => {
      const t = clamp01(y / shape.trunkTop)
      const k = t * t
      return out.set(shape.lean.x * k, 0, shape.lean.z * k)
    },
    shape.grooveAt,
    FISSURE_STRENGTH
  )
  return paintMoss(geometry, shape.mossBearing, shape.mossTop, 0.3)
}

const buildLimb = (shape: OldOakShape, limb: OakLimb, segments: number, rings: number): BufferGeometry => {
  const yAt = (u: number): number => limb.length * (1 - u)
  const offsetAt = (u: number, out: Vector3): Vector3 => {
    const s = 1 - u
    // `s²` bends the limb back toward the horizontal; `s(1−s)` curls the first
    // third the other way. Both are integer powers, so the loft can difference
    // them outside [0, 1] without producing NaN.
    return out.set(limb.bend * s * s - limb.gnarl * s * (1 - s), 0, limb.twist * s * s)
  }
  const profileAt = (u: number): number => limbProfile(u) / LIMB_PROFILE_PEAK

  const us = buildRingList([0, 1], rings, (u, out) => {
    offsetAt(u, out)
    const jogX = out.x
    const jogZ = out.z
    return out.set(limb.radius * profileAt(u), jogX, jogZ)
  })

  const inflate = sectionAreaInflate(segments, 0, UNIT_SECTION)
  const scale = limb.radius * inflate * profileVolumeInflate(us, profileAt, yAt)
  const radiusAt = (u: number): number => scale * profileAt(u)

  const geometry = loftGeometry({ us, segments, yAt, radiusAt, offsetAt })
  // Rotation only — `applyMatrix4` carries the analytic normals through the
  // normal matrix, so they stay exact and stay unit length.
  geometry.applyMatrix4(limb.frame)

  paintUniform(geometry, C.barkOldBase)
  paintByUpness(geometry, C.barkBase, 0.3, 2)
  return paintMoss(geometry, shape.mossBearing, shape.mossTop, 0.22)
}

const buildClump = (clump: OakClump, widthSegments: number, heightSegments: number): BufferGeometry => {
  const geometry = blobGeometry({
    radius: clump.radius,
    widthSegments,
    heightSegments,
    lumps: clump.lumps,
    scale: new Vector3(1, clump.squash, 1)
  })

  // The foliage law (GDD R3), at the mandated 0.85.
  //
  // `radiusBias` is held just above `tree.ts`'s 0.18 rather than scaled up with
  // the squash, and that restraint is deliberate. The bias offsets the *virtual*
  // centre, so its influence grows as `atan(bias / r)` toward the equator: at
  // 0.42 a point 78 % of the way to this clump's pole shades at 40° off
  // horizontal instead of the surface's true 83°, which is a rounder, darker
  // clump — the opposite of the flat top it is supposed to buy. The umbrella's
  // flatness comes from the *layout* (§ Canopy, and the crown clumps' height
  // above the outer ring), not from bending the normals until it appears.
  blendNormalsToSphere(geometry, new Vector3(0, 0, 0), 0.85, clump.radius * 0.22)

  // `paintRadial` replaces; the other two blend into what is already there.
  paintUniform(geometry, C.foliageBase)
  paintRadial(geometry, new Vector3(0, clump.radius * 0.5, 0), C.foliageBase, C.foliageDeep, clump.radius * 1.9)
  paintByUpness(geometry, C.foliageLit, 0.6, 2)

  geometry.translate(clump.center.x, clump.center.y, clump.center.z)
  return geometry
}

// ─── Tiers ──────────────────────────────────────────────────────────────────

interface OakTier {
  trunkSegments: number
  trunkRings: number
  trunkCap: boolean
  limbSegments: number
  limbRings: number
  clumpW: number
  clumpH: number
  budget: number
  aoSamples: number
}

/**
 * Triangles = trunkSegments × (trunkRings − 1) × 2 + trunkSegments (cap)
 *           + limbs × limbSegments × (limbRings − 1) × 2
 *           + clumps × clumpW × (2·clumpH − 2)
 *
 * The trunk keeps `2 × LOBES` down to LOD1 and spends its reduction on rings,
 * which is the cliff family's rule and applies for the same reason: the fused
 * section is what makes the bole recognisable, the profile is only its pose.
 * LOD2 is the exception, and it is a placement argument rather than a section
 * one: at 117 m — this asset's LOD1→LOD2 switch, at `distanceScale` 2.6 — a
 * 1.7 m bole is a couple of pixels wide while the canopy is still 10 m across,
 * so the four triangles the second lobe pass costs buy nothing there and buy a
 * whole clump ring in the canopy.
 */
const TIERS: OakTier[] = [
  {
    trunkSegments: LOBES * 2,
    trunkRings: 5,
    trunkCap: true,
    limbSegments: 4,
    limbRings: 5,
    clumpW: LOD0_CLUMP_W,
    clumpH: 3,
    budget: 340,
    aoSamples: 8
  },
  {
    trunkSegments: LOBES * 2,
    trunkRings: 3,
    trunkCap: true,
    limbSegments: 3,
    limbRings: 3,
    clumpW: 4,
    clumpH: 3,
    budget: 190,
    aoSamples: 6
  },
  {
    trunkSegments: LOBES,
    trunkRings: 3,
    trunkCap: true,
    limbSegments: 3,
    limbRings: 2,
    clumpW: 4,
    clumpH: 2,
    budget: 95,
    aoSamples: 6
  }
]

const buildTier = (shape: OldOakShape, tier: OakTier, name: string): BufferGeometry => {
  const parts: BufferGeometry[] = [buildTrunk(shape, tier.trunkSegments, tier.trunkRings, tier.trunkCap)]
  for (const limb of shape.limbs) {
    parts.push(buildLimb(shape, limb, tier.limbSegments, tier.limbRings))
  }
  for (const clump of shape.clumps) {
    parts.push(buildClump(clump, tier.clumpW, tier.clumpH))
  }

  const woodParts = 1 + shape.limbs.length
  const ranges = partRanges(parts)
  const merged = mergeParts(parts, name)

  // Baked on the merged tree, so the canopy genuinely darkens the limbs under it
  // and the clumps shade each other. Range-split on apply so wood resolves toward
  // bark and leaves toward foliage — one shared deep colour greens the fissures.
  const ao = bakeVertexAO(merged, {
    samples: tier.aoSamples,
    maxDistance: shape.canopyRadius * 0.55,
    strength: 0.95,
    power: 1.15
  })
  for (let i = 0; i < ranges.length; i++) {
    const wood = i < woodParts
    applyVertexAO(merged, ao, wood ? C.barkOldDark : C.foliageDeep, wood ? BARK_AO_STRENGTH : 0.9, ranges[i])
  }

  // A fresh generator per tier rather than `shape.rng`: drawing from the shared
  // stream here would make tier N's jitter depend on how many vertices tier N−1
  // happened to have, so adding a ring to LOD0 would silently repaint LOD2.
  jitterColor(merged, makeRng(shape.seed * 9781 + 977), 0.04)

  // Wind ramps across the canopy only — zero through the whole bole and the
  // lower limbs, which is what "heavy and slow" means geometrically. Derived
  // from height rather than from part membership so it is continuous; a step at
  // the limb/clump join tears the mesh open in a gust. The radial term gives the
  // rim of the umbrella the most travel, which is where an oak actually moves.
  const windEnd = shape.height
  paintWindWeight(merged, (x, y, z) => {
    const t = smootherstep(shape.canopyBottom, windEnd, y)
    const radial = Math.min(1, Math.hypot(x, z) / shape.canopyRadius)
    return t * (0.55 + 0.45 * radial)
  })

  return finishTier(merged, tier.budget, name)
}

/**
 * LOD3 at 286 m: a solid canopy impostor plus a 6-triangle bole stub.
 *
 * A billboard is not available — with no prop textures (GDD §5.2) there is no
 * alpha mask, so a crossed quad renders as two literal rectangles. The stub is
 * not optional either: this tree is 11 m tall and its trunk is still a visible
 * mark at the LOD2→LOD3 boundary, so dropping it makes the canopy hop.
 */
const buildImpostor = (shape: OldOakShape, name: string): BufferGeometry => {
  const source = shape.clumps[shape.clumps.length - 1]!

  // Solved against the *rendered* envelope rather than guessed at a fraction of
  // it. A `canopyRadius * 0.9` blob measured 29 % wider and 2 % shorter than
  // LOD0, because the impostor's own lump field and its 4-segment inflate
  // multiply on top — a mismatch that size is the one thing a dithered
  // crossfade cannot hide (GDD §4.3).
  const spread = IMPOSTOR_INFLATE * meanEquatorialLump(source.lumps)
  const radius = shape.canopyMeanRadius / spread
  const rise = radius * IMPOSTOR_INFLATE * lumpRadius(_up, source.lumps)
  // Solved against the canopy's vertical *span*, not against its centroid.
  // Pinning the centre to the centroid and solving only for the top left the
  // impostor's underside 1.5 m below the real canopy — the crown clumps pull
  // the centroid up, so the blob had to grow downward to reach the same height.
  // Matching both ends is the same amount of arithmetic and no guesswork.
  const centerY = (shape.canopyBottom + shape.height) * 0.5
  const squash = Math.min(0.75, Math.max(0.3, (shape.height - centerY) / rise))

  const canopy = blobGeometry({
    radius,
    widthSegments: 4,
    heightSegments: 3,
    lumps: source.lumps,
    scale: new Vector3(1, squash, 1)
  })
  blendNormalsToSphere(canopy, new Vector3(0, 0, 0), 0.9, radius * 0.22)
  paintUniform(canopy, C.foliageBase)
  paintRadial(canopy, new Vector3(0, radius * 0.35, 0), C.foliageBase, C.foliageDeep, radius * 1.7)
  paintByUpness(canopy, C.foliageLit, 0.5, 2)
  // On the axis, not on the canopy's centroid: the support function is measured
  // from the origin, so an off-axis impostor would reach `|centroid| +
  // meanRadius` on one side and fall short by the same amount on the other.
  canopy.translate(0, centerY, 0)

  const rings: Ring[] = [
    { center: new Vector3(0, 0, 0), radius: shape.flareRadius * shape.profileScale * oakTrunkProfile(1) * 0.86 },
    {
      center: new Vector3(shape.lean.x, shape.trunkTop, shape.lean.z),
      radius: shape.flareRadius * shape.profileScale * oakTrunkProfile(0)
    }
  ]
  const stub = tubeGeometry(rings, 3)
  // A straight axis at last, so `blendNormalsToCylinder` is the right tool here
  // where it was the wrong one for the bent limbs.
  blendNormalsToCylinder(stub, new Vector3(0, 0, 0), new Vector3(0, 1, 0), 0.9)
  paintUniform(stub, BARK_LOW)

  const merged = mergeParts([canopy, stub], name)
  paintWindWeight(merged, (_x, y) => (y > shape.canopyBottom ? 0.55 : 0))
  return finishTier(merged, 26, name)
}

// ─── Asset ──────────────────────────────────────────────────────────────────

/** Farthest vertex from the object origin — the honest instance-cull radius. */
const boundingRadius = (geometry: BufferGeometry): number => {
  const array = geometry.getAttribute('position').array as ArrayLike<number>
  let worst = 0
  for (let i = 0; i < array.length; i += 3) {
    const x = array[i]!
    const y = array[i + 1]!
    const z = array[i + 2]!
    worst = Math.max(worst, x * x + y * y + z * z)
  }
  return Math.sqrt(worst)
}

export const createOldOakAsset = (options: OldOakOptions = {}): WorldAsset => {
  const shape = buildShape(options)
  const name = `old-oak-${options.seed ?? 1}`

  const tiers: BufferGeometry[] = TIERS.map((tier, i) => buildTier(shape, tier, `${name}/LOD${i}`))
  tiers.push(buildImpostor(shape, `${name}/LOD3`))

  return {
    name,
    perfTag: 'oaks',
    tiers,
    material: createToonMaterial({
      name: 'old-oak',
      // Foliage ramp for the whole tree, bark included: they share one draw call
      // and the softer terminator costs the bark almost nothing.
      ramp: getFoliageRamp(),
      wind: true,
      // Heavy and slow. The scatter tree runs at 0.075; a bole this size that
      // swayed as much as a sapling would undo everything the silhouette says.
      windStrength: 0.05,
      rimStrength: 0.42
    }),
    outline: createOutlineMaterial({ pixelWidth: 1.6, wind: true, windStrength: 0.05, name: 'old-oak-outline' }),
    outlineMaxTier: 1,
    radius: boundingRadius(tiers[0]!),
    // The largest flora in the world, so it holds detail furthest out — but
    // capped at 2.6. Cull is clamped to 320 m globally (`lod/config.ts`), and
    // past 2.6 the LOD2→LOD3 switch lands beyond it: a tier generated,
    // budgeted, asserted and never drawn.
    distanceScale: 2.6
  }
}

/**
 * Cylinder collider for the bole, in metres.
 *
 * `radius` is the bole **above the root flare**, at its narrowest bearing. Two
 * separate decisions, and both go the same way:
 *
 *   • the flare is a decorative skirt. Sizing the collider to it would stop the
 *     player a hand's width off the bark all the way up, and standing next to a
 *     landmark tree is most of what a landmark tree is for.
 *   • the narrowest bearing, not the widest, for the reason `plateauMetrics`
 *     gives: the valleys sit ~20 % in from the crests, and a collider on the
 *     crests claims solid wood where there is a flute.
 *
 * `height` stops just under the split, so a limb — which is geometry the
 * collider does not describe — can never stop the player.
 */
export const oldOakMetrics = (options: OldOakOptions = {}): { radius: number; height: number } => {
  const shape = buildShape(options)

  let narrowest = Number.POSITIVE_INFINITY
  for (let i = 0; i < 128; i++) {
    narrowest = Math.min(narrowest, shape.sectionAt((i / 128) * TAU))
  }

  return {
    radius: shape.flareRadius * shape.profileScale * oakTrunkProfile(FLARE_TOP) * narrowest,
    height: shape.splitY * 0.95
  }
}
