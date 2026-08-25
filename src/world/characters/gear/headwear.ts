import { Color, Vector3 } from 'three'
import { HAT_CLEARANCE } from '../equipment'
import { HEAD } from '../face'
import { circleSection, finishGear, type GearModel, paintPart, type SweptPart, sweep } from './gearKit'
import { band, buildPanel, type Colourway, DYES, front, pickWay, shadeCloth, way } from './garmentKit'
import { hatHeadClearance } from './hat'

/**
 * ─── Five hats, and the one thing they all have to get right ────────────────
 *
 * Headwear is the second half of making a hundred townspeople distinguishable,
 * and it does a job the torso garment cannot: it changes the **top** of the
 * silhouette, which is a third of a chibi's outline. A coif and a kettle helm on
 * the same body in the same tunic are two different people at 40 m.
 *
 * Frame (see `index.ts`): the origin is the `headTop` socket, which is the head
 * bone plus 150 mm — **the head's lower-cap centre at y = 1.29, not its crown at
 * 1.56**. Every model here is authored around a point inside the skull, and
 * reading `headTop` as "the top of the head" puts a hat 270 mm above the figure.
 *
 * ── Sized against the head that is built, not the one that is meant ─────────
 *
 * `hat.ts` records the trap and this file inherits its solution wholesale. The
 * head is shaded as a smooth ellipsoid but **built as a 9-gon over 10 rings**,
 * whose facets sit up to `r(1 − cos 20°)` — 15 mm on a 250 mm head — inside it.
 * Sized to the ideal surface a hat floats; sized to the facets it clips at four
 * bearings out of nine.
 *
 * So every model here is a **9-gon rotated onto the head's own bearings**
 * (`segments: HEAD.radial`, `vOffset: 0.25` — the head's vertex 0 sits at +Z and
 * `circleSection`'s first sample lands there when `v` starts at ¼). Aligned, both
 * surfaces lose the same inscription factor at every bearing, so the gap is
 * `(R − r)·f(θ)` rather than alternating between `R − r` and `R·cos 20° − r`.
 * `inflate` is deliberately *not* applied, exactly as in `hat.ts`: the correction
 * would grow the vertices off the authored curve and break that alignment
 * argument, which is worth more here than 6 % of size fidelity.
 *
 * Clearance is then **measured on the built meshes**, both ways, by
 * `hatHeadClearance()` — never derived from the control points, because the
 * profile is a B-spline that sits inside them and the mesh chords between
 * stations, so an authored apex height is an upper bound twice over. Measured
 * numbers are in `tests/world/professionGear.test.ts`.
 *
 * ── The thing that is *not* solved, and cannot be from this file ────────────
 *
 * **Hair.** Twenty-one styles ride the same head bone, and six of them break the
 * skull's convex hull hard: measured as distance from this frame's origin, a
 * ponytail reaches 428 mm, a wild cut 358 mm, braids 360 mm, a fringe bulges to
 * 335 mm at eyebrow height. Nothing sized to a 250 mm skull clears those, and
 * the shipped straw hat does not either — this is a pre-existing condition, not
 * one these five introduce.
 *
 * The fix is not more clearance. Making a coif big enough to swallow a ponytail
 * stops it being a coif. The fix is for the **body builder to suppress or swap
 * the hair when the head slot is filled**, which is a `chibiGeometry.ts` /
 * `variants.ts` change and is reported rather than made here. Until it lands,
 * every model below clears the *bowl / short / bald / bob / receding / coif*
 * family — six styles that hug the skull — and intersects the tall ones.
 *
 * ── Cost, which is the real constraint on headwear ─────────────────────────
 *
 * A torso garment costs its wearer **zero** draw calls, because it is merged into
 * the body. Headwear does not: it is parented to a bone, so it is a mesh, and
 * `CharacterEquipment` measures ~3.3 draws per equipped item once its outline
 * hull is counted. A hundred hatted townspeople is therefore ~330 draw calls
 * against GDD §5.2's cap of **180 for the whole view** — headwear cannot be worn
 * by a crowd the way a garment can. See the report; the answer is an instanced
 * field per hat kind, not a smaller hat.
 */

export type HeadwearKind = 'coif' | 'hood' | 'flatCap' | 'officialCap' | 'helmet'

/**
 * Triangle budgets, stated here because `EQUIPMENT_BUDGET` is not this module's
 * to edit. **These are the numbers to copy into it.**
 *
 * Four of the five are above the straw hat's 180 and the fifth equals it, and the
 * reason is the closure: every one of these is a *closed* solid — outer surface, round the
 * rim, inner surface, inner apex — because an open-bottomed dome is a
 * single-sided shell and `FrontSide` means the player looking up from below sees
 * straight through the crown to the sky. The inner wall is half the triangles and
 * it is not optional.
 */
export const HEADWEAR_BUDGET: Record<HeadwearKind, number> = {
  coif: 200,
  hood: 250,
  flatCap: 180,
  officialCap: 215,
  helmet: 215
}

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Z = new Vector3(0, 0, 1)

const _color = new Color()

/** Aligns a hat's 9-gon with the head's, whose vertex 0 sits at +Z. */
const HEAD_BEARING_OFFSET = 0.25

/**
 * `[y, radius (Z), z offset]` in the `headTop` frame.
 *
 * The X extent is **0.94 × the Z extent**, which is the head's own `crossSection`
 * — it is 0.47 m wide and 0.50 m deep. Following it rather than sweeping a circle
 * is what keeps the clearance the same at every bearing instead of pinching
 * front-to-back; `hat.ts` swept a circle and paid 4 mm of unevenness for it,
 * which a wide brim can afford and a close-fitting coif cannot.
 *
 * The `z` offset exists for one model: the hood's mass sits **behind** the head,
 * and shifting the path is how a surface of revolution says that without an
 * asymmetric section it would then have to keep aligned with the head's 9-gon.
 */
type HeadRow = readonly [number, number, number?]

const HEAD_WIDTH_RATIO = HEAD.widthScale

interface HeadShellOptions {
  name: string
  rows: readonly HeadRow[]
  stations: number
  us?: readonly number[]
  paint: (u: number, v: number, out: Color, at: (row: number) => number) => void
}

const buildHeadShell = (options: HeadShellOptions): SweptPart => {
  const at = (row: number): number => (row + 1) / (options.rows.length + 1)
  const part = sweep({
    name: options.name,
    path: options.rows.map(([y, , z]) => [0, y, z ?? 0] as const),
    extentA: options.rows.map(([, r]) => r * HEAD_WIDTH_RATIO),
    extentB: options.rows.map(([, r]) => r),
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: circleSection,
    stations: options.stations,
    us: options.us,
    segments: HEAD.radial,
    vOffset: HEAD_BEARING_OFFSET
  })
  return paintPart(part, (u, v, out) => options.paint(u, v, out, at), _color)
}

/**
 * Every shell here folds at its rim, so every one needs rings placed by hand.
 *
 * The failure an even spread produces is documented three times over in this
 * folder now — `hat.ts`'s brim, `garments.ts`'s cape and skirt — and it is always
 * the same: a band whose two ends face opposite ways, reported as exactly
 * `segments` faces winding against their own normals.
 */
const RIM_US_11 = [0, 0.11, 0.22, 0.34, 0.44, 0.5, 0.56, 0.63, 0.72, 0.85, 1]
const RIM_US_12 = [0, 0.09, 0.19, 0.28, 0.37, 0.455, 0.5, 0.545, 0.64, 0.73, 0.86, 1]
const RIM_US_13 = [0, 0.1, 0.19, 0.28, 0.37, 0.45, 0.5, 0.545, 0.59, 0.66, 0.78, 0.9, 1]

/**
 * The upper half of these lists is not padding, and it is the second measurement
 * this file paid for.
 *
 * The head narrows fast above y = 0.197 — its rings run 177 mm, 96 mm, 0 over
 * 73 mm of height — so a shell that samples its own inner wall at `u` 0.66 and
 * then 0.82 **chords straight across the head's shoulder**. Measured on the first
 * coif: the authored inner wall was 74 mm clear at that height and the built one
 * cleared the head's own vertex by **2.7 mm**, against `HAT_CLEARANCE`'s 12. The
 * hood was at 9.2 and the flat cap at 8.7 for the same reason.
 *
 * A ring at each control point through the crown fixes all three, and that is the
 * general rule: a clearance is a property of the *chords*, not of the curve, which
 * is exactly why `hatHeadClearance` measures the built meshes.
 */

/**
 * Merge, then check the fit — **on the shell alone**.
 *
 * `parts[0]` is the piece that has to clear the skull, and it is the only piece
 * the clearance question applies to. The hood's nape drape deliberately passes
 * *through* the head: it hangs behind it and rests on the neck, so its inner wall
 * is buried in the skull exactly as the hooded robe's cowl is buried in the
 * robe's back, and the intersection is what makes the union seamless.
 *
 * `minGap` is unsigned, so measuring the merged model reports that intersection
 * as a **2.4 mm clearance** and the guard fires on a part that is behaving
 * correctly. Measured, and the reason this signature takes the parts rather than
 * the finished model.
 */
const finishHeadwear = (
  kind: HeadwearKind,
  parts: SweptPart[],
  deep: Color[],
  aoAmount: number[],
  seed: number,
  jitter: number
): GearModel => {
  const shell = parts[0]!.geometry
  const model = finishGear({
    name: `gear/${kind}`,
    budget: HEADWEAR_BUDGET[kind],
    parts,
    deep,
    aoAmount,
    seed,
    jitter
  })
  // The same guard `hat.ts` ships, for the same reason: a clearance derived from
  // control points is an upper bound twice over, and the only number worth having
  // is the one taken off the built meshes.
  const clearance = hatHeadClearance(shell)
  if (clearance < HAT_CLEARANCE * 0.9 && import.meta.env.DEV) {
    throw new Error(
      `[gear] ${kind} clears the built head by ${(clearance * 1000).toFixed(1)} mm, ` +
        `below HAT_CLEARANCE (${(HAT_CLEARANCE * 1000).toFixed(0)} mm)`
    )
  }
  return model
}

// ─── 1. The coif ────────────────────────────────────────────────────────────
//
// Housewife, maid, weaver, laundress, monk, mine worker. A cloth cap that covers
// the whole skull and stops just above the brow, which is the point: it **deletes
// the hair from the silhouette**, and on a figure whose head is a third of its
// height that is the largest single change any accessory can make.
//
// The rim sits at y = +0.040. The eyes are at −0.055 with a 42 mm half-height, so
// their top edge is at −0.013 — the rim clears the eye by 53 mm and reads as
// sitting on the forehead rather than over it.

const COIF_ROWS: readonly HeadRow[] = [
  [0.302, 0.0],
  [0.29, 0.13],
  [0.24, 0.234],
  [0.14, 0.278],
  [0.04, 0.292], // rim, outside
  [0.012, 0.276], // round the rim
  [0.09, 0.262], // inner
  [0.2, 0.238],
  [0.284, 0.126],
  [0.292, 0.0] // inner apex
]

const COIF_WAYS: readonly Colourway[] = [
  way(DYES.linen, DYES.woad), // housewife, maid
  way(DYES.undyed, DYES.madder), // weaver
  way(DYES.flax, DYES.hide), // laundress
  way(DYES.ash, DYES.forest), // monk
  way(DYES.madder, DYES.linen) // market woman
]

export const buildCoif = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(COIF_WAYS, seed)
  const shell = buildHeadShell({
    name: 'gear/coif/shell',
    ...SHELL.coif,
    paint: (u, v, out, at) => {
      const facing = front(v)
      shadeCloth(out, cloth, facing, 0.24)
      // Past the rim the surface is the inside of the cap. It is never lit, and
      // it falls to the dye's own shadow rather than toward black (GDD R4).
      if (u > at(4)) {
        out.lerp(cloth.shadow, 0.6)
      }
      // A band round the brow — the coif's tie, and the only structure on it.
      out.lerp(trim.base, 0.6 * band(u, at(4), 14))
    }
  })
  return finishHeadwear('coif', [shell], [cloth.shadow], [0.6], seed, 0.03)
}

// ─── 2. The hood ────────────────────────────────────────────────────────────
//
// Mage, hunter, traveller, thief, monk. The hood **up**, which the hooded robe in
// `garments.ts` cannot do: a torso garment is weighted `hips → chest`, so a hood
// worn on the head from there would stay put while the head turned inside it.
// Here it rides the head bone, so it turns with the face, which is what a hood
// does.
//
// Its mass sits behind and above the skull — the path is shifted 35–42 mm in −Z
// — so the outline reads as a peak over the crown and a fall down the nape,
// rather than as a bucket. The front rim stands 80 mm proud of the face at brow
// height, which is the shadowed opening a hood is recognised by.

const HOOD_ROWS: readonly HeadRow[] = [
  [0.336, 0.0, -0.035],
  [0.322, 0.132, -0.038],
  [0.264, 0.252, -0.042],
  [0.16, 0.324, -0.042],
  [0.045, 0.35, -0.038], // rim, outside
  [0.01, 0.33, -0.035], // round the rim
  [0.095, 0.31, -0.035], // inner
  [0.215, 0.264, -0.038],
  [0.302, 0.136, -0.038],
  [0.316, 0.0, -0.035] // inner apex
]

const HOOD_WAYS: readonly Colourway[] = [
  way(DYES.forest, DYES.hide), // hunter
  way(DYES.woad, DYES.ash), // mage
  way(DYES.hide, DYES.tan), // traveller
  way(DYES.undyed, DYES.hide), // monk
  way(DYES.ash, DYES.woad) // thief
]

/**
 * The drape down the nape, `[y, z, halfWidth (X), halfDepth (Z)]`.
 *
 * Added after the first screenshot, which is the whole argument for taking one:
 * the shell alone passed every geometric check and read on screen as a **swim
 * cap**. A hood is recognised by the cloth falling behind the head, and a shell
 * whose rim is a horizontal circle has none.
 *
 * Both ends collapse buried — the top inside the hood's own back wall at
 * z = −0.26 against a wall at −0.345, the bottom at the nape where the garment's
 * collar is. It swings with the head, which is what a hood does.
 */
const HOOD_DRAPE: readonly (readonly [number, number, number, number])[] = [
  [0.09, -0.26, 0, 0],
  [0.02, -0.28, 0.115, 0.065],
  [-0.09, -0.25, 0.135, 0.075],
  [-0.16, -0.21, 0.108, 0.062],
  [-0.2, -0.175, 0, 0]
]

export const buildHood = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(HOOD_WAYS, seed)
  const shell = buildHeadShell({
    name: 'gear/hood/shell',
    ...SHELL.hood,
    paint: (u, v, out, at) => {
      const facing = front(v)
      shadeCloth(out, cloth, facing, 0.2)
      // The opening. A hood's inside is the deepest value on the whole figure and
      // it is what makes the face read as *inside* something.
      if (u > at(4)) {
        out.lerp(cloth.shadow, 0.7)
      }
      out.lerp(trim.base, 0.5 * band(u, at(4), 16))
      // The peak: the crown catches the light, which is what gives a hood its
      // point instead of leaving it a dome.
      out.lerp(cloth.lit, 0.25 * band(u, at(0), 5) * Math.max(0, facing))
    }
  })
  const drape = buildPanel({
    name: 'gear/hood/drape',
    rows: HOOD_DRAPE,
    // Already in the `headTop` frame, so no hips offset.
    originY: 0,
    stations: 5,
    segments: 8,
    paint: (_u, v, out) => {
      // Backward-facing, like the hooded robe's cowl: the sign on `front` flips
      // rather than the section being rebuilt.
      shadeCloth(out, cloth, -front(v), 0.18)
      out.lerp(cloth.shadow, 0.2)
    }
  })
  return finishHeadwear('hood', [shell, drape], [cloth.shadow, cloth.shadow], [0.85, 0.7], seed, 0.032)
}

// ─── 3. The flat cap ────────────────────────────────────────────────────────
//
// Shop owner, day worker, apprentice, harbour worker, fisher. The smallest thing
// in the set: a soft cap that perches on the crown and slouches 20 mm forward.
// It leaves the hair visible under it, which is deliberate — it is the hat for
// characters whose *hair* is doing the identifying work, and it costs 144
// triangles to say "townsman, not soldier, not scholar".

const CAP_ROWS: readonly HeadRow[] = [
  [0.31, 0.0, 0.012],
  [0.3, 0.112, 0.014],
  [0.258, 0.198, 0.016],
  [0.208, 0.254, 0.018],
  [0.168, 0.288, 0.02], // the band, widest
  [0.146, 0.276, 0.018], // under the band
  [0.192, 0.246, 0.014], // inner
  [0.258, 0.186, 0.012],
  [0.3, 0.0, 0.012] // inner apex
]

const CAP_WAYS: readonly Colourway[] = [
  way(DYES.hide, DYES.tan), // day worker
  way(DYES.forest, DYES.hide), // shop owner
  way(DYES.madder, DYES.hide), // apprentice
  way(DYES.sage, DYES.hide), // fisher
  way(DYES.undyed, DYES.hide) // harbour worker
]

export const buildFlatCap = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(CAP_WAYS, seed)
  const shell = buildHeadShell({
    name: 'gear/flatCap/shell',
    ...SHELL.flatCap,
    paint: (u, v, out, at) => {
      const facing = front(v)
      shadeCloth(out, cloth, facing, 0.26)
      if (u > at(4)) {
        out.lerp(cloth.shadow, 0.55)
      }
      // The band at the widest point, and a darker peak at the front where the
      // slouch throws its own shadow.
      out.lerp(trim.base, 0.55 * band(u, at(4), 18))
      out.lerp(cloth.shadow, 0.3 * band(u, at(3), 9) * Math.max(0, facing))
    }
  })
  return finishHeadwear('flatCap', [shell], [cloth.shadow], [0.7], seed, 0.035)
}

// ─── 4. The official's cap ──────────────────────────────────────────────────
//
// Judge, mayor, clerk, scholar, guild master. The one hat whose read is **height**
// — a flat-topped tube standing 195 mm above the crown, where every other model
// here hugs the skull. On a three-heads-tall figure that adds an eighth to the
// total silhouette, which is why it works from further away than the colour of
// anybody's robe.
//
// The brim at the base is what stops it reading as a chimney: it flares 245 mm
// and rolls under, so the outline has a shoulder where the cap meets the head.

const OFFICIAL_ROWS: readonly HeadRow[] = [
  [0.45, 0.0], // top apex
  [0.446, 0.14],
  [0.43, 0.196], // top rim, rolled
  [0.385, 0.196],
  [0.27, 0.19], // the tube
  [0.19, 0.212], // band
  [0.162, 0.262], // brim crest
  [0.142, 0.244], // under the brim
  [0.18, 0.212], // inner wall, bottom — 24 mm off the head, not 46
  [0.29, 0.184],
  [0.42, 0.15],
  [0.436, 0.0] // inner apex
]

const OFFICIAL_WAYS: readonly Colourway[] = [
  way(DYES.forest, DYES.saffron), // judge
  way(DYES.madder, DYES.saffron), // mayor
  way(DYES.woad, DYES.linen), // clerk
  way(DYES.ash, DYES.woad), // scholar
  way(DYES.hide, DYES.saffron) // guild master
]

export const buildOfficialCap = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(OFFICIAL_WAYS, seed)
  const shell = buildHeadShell({
    name: 'gear/officialCap/shell',
    ...SHELL.officialCap,
    paint: (u, v, out, at) => {
      const facing = front(v)
      shadeCloth(out, cloth, facing, 0.2)
      if (u > at(7)) {
        out.lerp(cloth.shadow, 0.6)
      }
      // The band round the base, in the trim colour: this is the whole difference
      // between a judge's cap and a clerk's, and it costs nothing.
      const bandU = band(u, at(5), 16)
      out.lerp(trim.base, 0.85 * bandU).lerp(trim.lit, 0.35 * bandU * Math.max(0, facing))
      // The brim's underside is a cavity and reads as one.
      out.lerp(cloth.shadow, 0.4 * band(u, at(7), 18))
      // And the flat top takes the sky.
      out.lerp(cloth.lit, 0.28 * band(u, at(1), 8))
    }
  })
  return finishHeadwear('officialCap', [shell], [cloth.shadow], [0.7], seed, 0.026)
}

// ─── 5. The helmet ──────────────────────────────────────────────────────────
//
// Town guard, knight, recruit, watch, gate keeper. A close steel dome with a
// **brow ridge** — a 310 mm flare at y = 0.082 that tucks back to 302 at the rim,
// so the outline has a hard horizontal line across the forehead. That line is the
// read; a smooth steel dome is a bald head with a specular highlight.
//
// The only model here painted in metal, and it obeys the same discipline the
// cuirass does: `steelBase` with the shading doing the work, not `steelLit`. A
// helmet is a large curved field close to camera and it takes the toon ramp's top
// band across a third of itself at once.

const HELMET_ROWS: readonly HeadRow[] = [
  [0.335, 0.0],
  [0.322, 0.116],
  [0.284, 0.206],
  [0.216, 0.266],
  [0.136, 0.296],
  [0.082, 0.31], // brow ridge, proud
  [0.046, 0.302], // rim, outside
  [0.022, 0.286], // round the rim
  [0.08, 0.272], // inner
  [0.19, 0.252],
  [0.288, 0.156],
  [0.312, 0.0] // inner apex
]

/** Steel, and what is riveted to it. The cloth dye is the helmet's liner. */
const HELMET_WAYS: readonly Colourway[] = [
  way(DYES.steel, DYES.hide), // town guard
  way(DYES.steel, DYES.woad), // livery
  way(DYES.steel, DYES.madder),
  way(DYES.ash, DYES.hide), // an old, dulled helm
  way(DYES.steel, DYES.forest)
]

export const buildHelmet = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(HELMET_WAYS, seed)
  const shell = buildHeadShell({
    name: 'gear/helmet/shell',
    ...SHELL.helmet,
    paint: (u, v, out, at) => {
      const facing = front(v)
      shadeCloth(out, cloth, facing, 0.26)
      // Inside the helm: the liner, which is leather and not steel. It is never
      // lit, and it is the reason a helmet does not read as a hollow shell.
      if (u > at(6)) {
        out.copy(trim.shadow).lerp(trim.base, 0.45)
      }
      // The brow ridge takes the light along its whole length — the one place a
      // helmet is allowed the ramp's top band, because it is 20 mm wide.
      const brow = band(u, at(5), 20)
      out.lerp(cloth.lit, 0.5 * brow * Math.max(0, facing) ** 0.5)
      // And a dark line under it, which is what makes the ridge read as an edge
      // rather than as a highlight.
      out.lerp(cloth.shadow, 0.4 * band(u, at(6), 26))
    }
  })
  return finishHeadwear('helmet', [shell], [cloth.shadow], [0.75], seed, 0.02)
}

/**
 * Each shell's own profile and rings, in one table.
 *
 * Keyed rather than inlined so `headwearHeadClearance` can rebuild exactly the
 * surface the guard measures without a builder's paint, its AO bake or its second
 * part coming along for the ride.
 */
const SHELL: Record<HeadwearKind, { rows: readonly HeadRow[]; stations: number; us: readonly number[] }> = {
  coif: { rows: COIF_ROWS, stations: RIM_US_12.length, us: RIM_US_12 },
  hood: { rows: HOOD_ROWS, stations: RIM_US_12.length, us: RIM_US_12 },
  flatCap: { rows: CAP_ROWS, stations: RIM_US_11.length, us: RIM_US_11 },
  officialCap: { rows: OFFICIAL_ROWS, stations: RIM_US_13.length, us: RIM_US_13 },
  helmet: { rows: HELMET_ROWS, stations: RIM_US_13.length, us: RIM_US_13 }
}

/**
 * Smallest distance between a hat's **shell** and the built head, both ways.
 *
 * Public because it is the number `HAT_CLEARANCE` is a contract about, and
 * because it has to be taken off the shell rather than off the finished model:
 * see `finishHeadwear`.
 */
export const headwearHeadClearance = (kind: HeadwearKind): number =>
  hatHeadClearance(buildHeadShell({ name: `fit/${kind}`, ...SHELL[kind], paint: () => {} }).geometry)

// ─── The table ──────────────────────────────────────────────────────────────

export type HeadwearBuilder = (options?: { seed?: number }) => GearModel

export const HEADWEAR_BUILDERS: Record<HeadwearKind, HeadwearBuilder> = {
  coif: buildCoif,
  hood: buildHood,
  flatCap: buildFlatCap,
  officialCap: buildOfficialCap,
  helmet: buildHelmet
}

export const HEADWEAR_COLOURWAYS: Record<HeadwearKind, number> = {
  coif: COIF_WAYS.length,
  hood: HOOD_WAYS.length,
  flatCap: CAP_WAYS.length,
  officialCap: OFFICIAL_WAYS.length,
  helmet: HELMET_WAYS.length
}
