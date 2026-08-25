import { type BufferGeometry, Color, Ray, Vector3 } from 'three'
import { C } from '../../art/palette'
import { EQUIPMENT_BUDGET } from '../equipment'
import { limbMesh } from '../limb'
import { boneDefinition } from '../rig'
import { clearingSection, finishGear, type GearModel, paintPart, splineSection, sweep } from './gearKit'

/**
 * ─── The torso armour ───────────────────────────────────────────────────────
 *
 * Frame (see `index.ts`): the origin is the **hips joint** — `rig.ts` puts it at
 * y = 0.62 — and +Y is up. This is the one item in the folder that is not held,
 * so its "grip" is the point a bone-parented empty should sit at, and the hips
 * joint is the only choice that makes the offset zero.
 *
 * ── It *is* the torso now, and that changed the whole job ───────────────────
 *
 * The first version of this file was a shell worn **over** the body's torso, and
 * every number in it was a clearance. `chibiGeometry.ts` now substitutes this
 * model for the torso `PartSpec` rather than covering it, which turns two things
 * inside out:
 *
 *   • **Interference stopped mattering.** There is no torso underneath to poke
 *     through the plate, so the 8 mm clearance the overlay needed is gone. What
 *     `torsoArmourMargin()` measures is no longer a safety margin but a
 *     *silhouette* check: the armour must be at least as wide as the tunic it
 *     replaces, or the figure reads as a corset with the arms and neck hanging
 *     off it.
 *   • **Coverage started mattering, absolutely.** A gap between this shell and
 *     its neighbours used to show the tunic; it now shows the sky *through the
 *     character*. So the model is a **closed solid** that intersects the neck
 *     above it and both thighs below it, and the seam is measured over the whole
 *     run, walk and jump cycles in `tests/world/equipment.test.ts` — 28 million
 *     probe rays across 85 poses, zero rays that the tunic'd figure stops and
 *     this one does not.
 *
 * The three things that had to be re-authored for that, and the measurement each
 * one closed:
 *
 *   1. **A pelvis.** The torso's own bottom cap filled the hips down to y = 0.470
 *      and the armour stopped at its hem. Removing the torso opened the crotch:
 *      1 574 rays through the figure between y = 0.47 and 0.56. The profile now
 *      starts at an apex on the axis at exactly 0.470 — the height the torso's
 *      cap bottomed out at — and domes back up to the hem's inner lip.
 *   2. **A gorget.** The collar used to be a torso-wide ring (230 × 180 mm)
 *      because the torso's shoulder dome filled it. Removing the torso opened an
 *      annulus around the neck: 2 338 rays between y = 1.04 and 1.07. The collar
 *      now rises past the crest, narrows to a rim at y ≈ 1.118 and closes on the
 *      axis at 1.098 — inside the neck, so the closure is never seen, and the
 *      rim crosses the neck's own surface so the two solids genuinely intersect.
 *   3. **Both ends closed.** They used to be open rings folded back into the
 *      body, which is the right answer for a shell over something opaque and the
 *      wrong one for a shell that *is* the body. Two collapsed rings cost 20
 *      triangles and make a hole structurally impossible rather than merely
 *      absent at the poses that were checked.
 *
 * ── The torso's cross-section, which this is authored against ───────────────
 *
 * The torso part it replaces was `hips → chest`, radii 0.15 → 0.17,
 * `crossSection: [1.15, 0.85]`. That cross-section does **not** mean what its
 * own comment says. `limbMesh` builds its frame with `u = +Z` and `v = +X` for a
 * vertical axis, so `crossSection[0]` scales **Z** and `crossSection[1]` scales
 * **X** — the same inversion `face.ts` documents for the head. The shipped torso
 * is therefore **391 mm front-to-back and 289 mm across**, i.e. deeper than it is
 * wide, which is the opposite of what the comment above it intends.
 *
 * This model matches the torso that ships, not the one that was meant, and the
 * decision on whether to correct that cross-section is the user's. If it is ever
 * corrected, this model has to be re-authored with it — `torsoArmourMargin()`
 * and the seam tests will both say so loudly rather than the armour quietly
 * turning into a barrel.
 *
 * ── The inscribed-polygon correction, which still applies ───────────────────
 *
 *  * The armour's section is a **10-gon**, so its own facets bulge inward by
 *    `1 − cos(π/10)` = 4.9 % — 9 mm at the waist. `inflate` puts the *edge
 *    midpoints* on the authored curve instead of the vertices, which is the only
 *    form of the correction a clearance check can use (GDD §4.3).
 *  * The body's own 8-gon bulges inward too, but its **vertices** sit on the
 *    ideal ellipse, so the ideal is what has to be matched — the faceting is
 *    slack, never margin.
 */

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Z = new Vector3(0, 0, 1)

const _color = new Color()

/** The hips joint. Everything below is stated relative to it. */
const ORIGIN_Y = boneDefinition('hips').head[1]

const SEGMENTS = 10

/** Inscribed-polygon compensation for a 10-gon section (GDD §4.3). */
const INFLATE = 1 / Math.cos(Math.PI / SEGMENTS)

/**
 * `[y, halfDepth (Z), halfWidth (X)]` in **character** space, so the numbers can
 * be read straight against `chibiGeometry.ts` and `rig.ts` without arithmetic.
 * Converted to the hips-relative frame on the way into the sweep.
 *
 * Order, bottom to top: pelvis apex → up under the skirt → the hem's fold → up
 * the outside → the gorget → collar apex.
 *
 * **Both ends are apexes, and that is what makes this a closed solid.**
 * `splineAt` gives the end control points multiplicity 3, so the first and last
 * are *interpolated exactly* — an extent of 0 there really is 0, the ring really
 * does collapse, and `dropDegenerateFaces` charges `segments` triangles for the
 * band rather than `2 × segments`. Interior control points are only approximated,
 * which is why every number between the two apexes is a shape hint and the two
 * apexes are a guarantee.
 */
const PROFILE: readonly (readonly [number, number, number])[] = [
  [0.47, 0.0, 0.0], // pelvis apex — closed. The torso's own cap bottomed out here
  [0.497, 0.158, 0.117], // pelvis, lower — tracks the cap it replaces
  [0.552, 0.164, 0.122], // pelvis, upper — 25 mm inside the hem roll above it
  [0.585, 0.15, 0.112], // hem, inner lip
  [0.552, 0.18, 0.136], // hem roll, underside
  [0.575, 0.198, 0.15], // hem crest — the visible skirt edge
  [0.64, 0.199, 0.15], // hip
  [0.715, 0.192, 0.145], // waist, nipped
  [0.775, 0.206, 0.156], // belt crest
  [0.82, 0.196, 0.148], // above the belt
  [0.9, 0.214, 0.157], // chest
  [0.975, 0.212, 0.155], // shoulder yoke
  [1.03, 0.184, 0.15], // collar crest
  [1.068, 0.165, 0.135], // gorget, rising toward the neck
  [1.118, 0.09, 0.075], // gorget rim — crosses inside the neck's own surface
  [1.098, 0.0, 0.0] // collar apex — closed, and buried inside the neck
]

/**
 * Rings sampled along the path.
 *
 * 14 rings × 10 segments is 13 bands, two of which end on a collapsed ring:
 * 11 × 20 + 2 × 10 = **240 triangles** against the 260 of
 * `EQUIPMENT_BUDGET.torsoArmour`. The two closures cost 20 of that, which is
 * what a hole through the character costs to remove.
 */
const STATIONS = 14

/**
 * `u` of the features the paint pass keys off.
 *
 * Derived, not counted off by hand. `splineAt` centres control point `j` at
 * `u = (j + 1) / (n + 1)` — the previous form was `j / (n − 1)`, which put the
 * collar accent 0.05 of the path below the crest it is meant to sit on. On a
 * band whose falloff is `1 − |u − U| × 11` that is half the accent's width.
 */
const featureU = (index: number): number => (index + 1) / (PROFILE.length + 1)

const HEM_U = featureU(5)
const BELT_U = featureU(8)
const COLLAR_U = featureU(12)
/** Past the rim the surface is inside the neck. Nothing sees it. */
const RIM_U = featureU(14)

/**
 * The cuirass's section, in (X, Z), `v = 0` at the **front**.
 *
 * Not a circle, and that is most of the difference between "a cuirass" and "a
 * bucket". A surface of revolution over the torso's own ellipse rendered as a
 * smooth barrel with a belt painted on it; a breastplate is *keeled* — proud at
 * the sternum, flatter across the back — and eight of these ten control points
 * exist to say that in a shape the silhouette can carry.
 *
 * Symmetric in X by construction (1↔9, 2↔8, 3↔7, 4↔6), so a typo cannot make
 * one side of the chest wider than the other, which is the one asymmetry a
 * figure this stylised cannot survive.
 */
const CUIRASS_SECTION = clearingSection(
  splineSection([
    [0.0, 1.06],
    [0.58, 0.94],
    [0.99, 0.44],
    [1.02, -0.2],
    [0.62, -0.84],
    [0.0, -1.0],
    [-0.62, -0.84],
    [-1.02, -0.2],
    [-0.99, 0.44],
    [-0.58, 0.94]
  ])
)

const buildCuirass = () => {
  const part = sweep({
    name: 'gear/torsoArmour/cuirass',
    path: PROFILE.map(([y]) => [0, y - ORIGIN_Y, 0] as const),
    extentA: PROFILE.map(row => row[2]),
    extentB: PROFILE.map(row => row[1]),
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: CUIRASS_SECTION,
    stations: STATIONS,
    segments: SEGMENTS,
    inflate: INFLATE
  })

  return paintPart(
    part,
    (u, v, out) => {
      // Held well down from the first pass, which lerped 0.2–0.5 toward
      // `steelLit` and put a 0.29 m plate at a higher value than the character's
      // own face. A cuirass is the *largest* field on the figure — the argument
      // the palette makes for `grassCapLit` applies to it exactly: a big flat
      // surface takes the ramp's top band across its whole area, so an albedo
      // that reads correct on a swatch arrives as poster paint. It is now
      // `steelBase` with the shading doing the work, and the plate sits below
      // skin in value where it belongs.
      // `v = 0` is the keel, so the front-facing measure is a cosine here —
      // `circleSection`'s sine convention does not survive a custom section, and
      // getting it wrong lights the back of the armour and shades the chest.
      const front = Math.cos(v * Math.PI * 2)
      out.copy(C.steelShadow).lerp(C.steelBase, 0.72 + 0.28 * Math.max(0, front))
      out.lerp(C.steelLit, 0.22 * Math.max(0, front) ** 2)
      out.lerp(C.steelShadow, 0.4 * Math.max(0, -front))
      // A vertical fall-off: the skirt lives under the chest's own overhang and
      // is genuinely darker. AO finds some of this; a convex shell does not
      // occlude itself enough to find all of it.
      out.lerp(C.steelShadow, 0.3 * Math.max(0, 1 - u / HEM_U) + 0.25 * Math.max(0, 1 - Math.abs(u - HEM_U) * 3))
      // The belt: leather over the crest that already exists in the profile.
      const belt = Math.max(0, 1 - Math.abs(u - BELT_U) * 13)
      out.lerp(C.leatherBase, 0.92 * belt).lerp(C.leatherLit, 0.3 * belt * Math.max(0, front))
      // Brass at the collar, which is the one warm accent on a cool kit and is
      // the thing that keeps a steel cuirass from reading as a grey barrel.
      // Carried up over the gorget, because the gorget is *visible* now that the
      // armour reaches the neck rather than stopping on top of a torso.
      const collar = Math.max(0, 1 - Math.abs(u - COLLAR_U) * 11)
      out.lerp(C.brassBase, 0.85 * collar).lerp(C.brassLit, 0.35 * collar * Math.max(0, front))
      // Only past the rim is the surface inside the neck. Nothing sees it — but
      // it must not be black if the neck ever swings far enough that something
      // does (GDD R4), so this is a lerp toward `steelShadow` and not a black.
      if (u > RIM_U) {
        out.lerp(C.steelShadow, 0.5)
      }
    },
    _color
  )
}

// ─── Fit measurement ────────────────────────────────────────────────────────

const _ray = new Ray()
const _hit = new Vector3()
const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _vertex = new Vector3()

/** The torso part `chibiGeometry.ts` builds, in the armour's frame. */
const torsoInArmourSpace = () => {
  const hips = boneDefinition('hips').head
  const chest = boneDefinition('chest').head
  return limbMesh({
    from: new Vector3(hips[0], hips[1] - ORIGIN_Y, hips[2]),
    to: new Vector3(chest[0], chest[1] - ORIGIN_Y, chest[2]),
    radiusStart: 0.15,
    radiusEnd: 0.17,
    radial: 8,
    rings: 2,
    capRings: 2,
    crossSection: [1.15, 0.85]
  })
}

export interface ArmourFit {
  /** Smallest (armour shell − body surface) over the covered band, in metres. */
  margin: number
  /** Character-space height at which that minimum occurs. */
  atY: number
  /** Body vertices in the band that are *outside* the shell. Must be zero. */
  breaches: number
}

/**
 * How far the armour stands proud of the torso it replaces.
 *
 * **This used to be a clearance and is now a silhouette check.** With the torso
 * substituted out there is nothing underneath to poke through; what the number
 * still guards is that the cuirass is nowhere *narrower* than the tunic it
 * replaces, which is the difference between armour and a corset — and it is the
 * check that fires if `chibiGeometry`'s torso `crossSection` is ever corrected
 * under this model's feet.
 *
 * Radial rather than nearest-point on purpose: both surfaces are stars about the
 * Y axis over the covered band, so "how far short of the shell does the body
 * fall along its own bearing" is the comparable quantity — and unlike a
 * nearest-point distance it is **signed**, so a shortfall reports as a negative
 * number rather than as a small positive one.
 *
 * The band stops below the gorget and above the hem's fold, because outside it
 * the armour is deliberately *inside* the neck and the thighs, and a radial probe
 * there is measuring a closure rather than a silhouette.
 */
export const torsoArmourMargin = (geometry: BufferGeometry, bandLow = 0.6, bandHigh = 1.0): ArmourFit => {
  const torso = torsoInArmourSpace()
  const position = geometry.getAttribute('position')
  const index = geometry.index!
  const array = position.array as ArrayLike<number>

  let margin = Number.POSITIVE_INFINITY
  let atY = 0
  let breaches = 0

  for (let i = 0; i < torso.along.length; i++) {
    _vertex.set(torso.position[i * 3]!, torso.position[i * 3 + 1]!, torso.position[i * 3 + 2]!)
    const characterY = _vertex.y + ORIGIN_Y
    if (characterY < bandLow || characterY > bandHigh) {
      continue
    }
    const bodyRadius = Math.hypot(_vertex.x, _vertex.z)
    if (bodyRadius < 1e-6) {
      continue
    }

    _ray.origin.set(0, _vertex.y, 0)
    _ray.direction.set(_vertex.x / bodyRadius, 0, _vertex.z / bodyRadius)

    // Farthest hit, not nearest: at a fold the ray crosses the buried lip first
    // and the outer shell second, and it is the outer shell the body must be
    // inside of.
    let shell = -1
    for (let f = 0; f < index.count; f += 3) {
      _a.fromArray(array as number[], index.getX(f) * 3)
      _b.fromArray(array as number[], index.getX(f + 1) * 3)
      _c.fromArray(array as number[], index.getX(f + 2) * 3)
      // Two-sided: the ray starts inside, so it leaves through the inward side
      // of a front face — the same reason `face.ts` disables the back-face test.
      if (_ray.intersectTriangle(_a, _b, _c, false, _hit)) {
        const distance = Math.hypot(_hit.x, _hit.z)
        if (distance > shell) {
          shell = distance
        }
      }
    }
    if (shell < 0) {
      breaches++
      continue
    }
    const gap = shell - bodyRadius
    if (gap < 0) {
      breaches++
    }
    if (gap < margin) {
      margin = gap
      atY = characterY
    }
  }

  return { margin, atY, breaches }
}

export const buildTorsoArmour = (options: { seed?: number } = {}): GearModel =>
  finishGear({
    name: 'gear/torsoArmour',
    budget: EQUIPMENT_BUDGET.torsoArmour,
    parts: [buildCuirass()],
    deep: [C.steelShadow],
    // Light: a cuirass is convex, so almost nothing occludes anything and a
    // strong bake only dirties the plate.
    aoAmount: [0.45],
    seed: options.seed ?? 1,
    jitter: 0.02
  })
