import { Color, Vector3 } from 'three'
import { C } from '../../art/palette'
import {
  around,
  band,
  buildGarmentBody,
  type Colourway,
  type Dye,
  DYES,
  FITTED_SECTION,
  front,
  HIPS_Y,
  pickWay,
  type Row,
  shadeCloth,
  way
} from './garmentKit'
import { finishGear, type GearModel, paintPart, splineSection, sweep, type SweptPart } from './gearKit'
import { buildLegPair, front as legFront, LEG_SECTION, type LegRow, outboard } from './legKit'

/**
 * ─── The wanderer's kit ─────────────────────────────────────────────────────
 *
 * A road coat and a pair of tall boots: the two garments the wardrobe did not
 * have, and the ones a *travelling* character needs — everything in
 * `garments.ts` and `legGarments.ts` is a townsperson's, because that is what
 * the eighteen professions asked for. Somebody who arrives from somewhere else
 * is a different silhouette, and this is it.
 *
 * ── What each adds that the existing set does not ───────────────────────────
 *
 * `garments.ts` lists the five levers a torso garment has and says the fifth —
 * *a thing hanging free off the body* — is the one that reads from furthest
 * away. The coat uses it, and not for a hem: a pair of **crossed leather
 * straps**, swept across the chest as their own closed solids.
 *
 * That is the one genuinely new idea in this file, and it is a shape idea rather
 * than a costume one. Every marking in `garments.ts` is a **ring** — a band in
 * `u` — because a surface of revolution is symmetric about the figure's own
 * axis and so is every ring on it. A diagonal is not, which makes these the
 * first thing in the folder that tells a viewer which way a character is facing
 * from behind, and the first that keeps saying so as the figure turns. See
 * `STRAP_PATH` for why they could not be painted.
 *
 * The boots use the ordinary lever and use it harder than anything in
 * `legGarments.ts`: a **turned-down cuff** just under the knee, which is a fold
 * — the profile turns through nearly 180° and comes back — rather than a step.
 * `rolledTrousers` has the only other real discontinuity on a leg in this
 * project and it is a *step*, 24 mm over 60 mm of height; a fold is read from
 * three times as far because its two faces catch different toon bands.
 *
 * ── Both are `torso` / `legs` items, so both are free at the draw call ──────
 *
 * `chibiGeometry` substitutes them **for** the body's parts rather than covering
 * them, so a hundred wanderers cost a hundred wanderers' worth of vertices in
 * the same draw calls as a hundred naked chibis. See `equipment.ts::BODY_SLOTS`.
 */

// ─── Budgets ────────────────────────────────────────────────────────────────

/**
 * Stated here because `EQUIPMENT_BUDGET` is not this module's to edit, exactly
 * as `garments.ts::GARMENT_BUDGET` and `legGarments.ts::LEG_GARMENT_BUDGET` are.
 * `tests/world/wandererGear.test.ts` asserts the two agree, so they cannot
 * drift.
 *
 * The coat is 300 for the body (17 stations at 10 segments, both end rings
 * collapsed — see `COAT_US` for the three rings the hem's fold costs) plus 120
 * for the two straps: **420**, which makes it the dearest torso garment in the
 * project, past the mantle's 405. The ceiling is that plus the ~7 % every model
 * in the folder is given, so a budget does not quietly become a target
 * (`gear.test.ts` fails any model under 55 % of its own).
 *
 * The boots are 416 — the dearest leg garment in the project, past the plate's
 * 380 — and the fold is why: a profile that turns 180° needs a ring on each face
 * of the turn, and rings on a leg are paid for **twice** because there are two
 * legs. 15 stations at 8 segments with all four end rings collapsed is
 * `2 × ((15 − 1) × 8 × 2 − 2 × 8)`, and that is exact rather than approximate:
 * `legPairTriangles` is a closed form and the ceiling below is it plus 7 %.
 */
export const WANDERER_BUDGET = {
  wanderersCoat: 450,
  tallBoots: 445
} as const

// ─── 1. The road coat ───────────────────────────────────────────────────────
//
// Grey wool over a wide hide belt, with a baldric and a second strap crossed at
// the sternum. A short skirt that breaks just past the hip — 30 mm below the
// jerkin's, and 10 mm short of the rough tunic's — so the three read as three
// lengths rather than as one hem in three dyes.
//
// ── The rows are the jerkin's, moved, and here is every millimetre of it ────
//
// A wanderer and a town watchman wear the same *kind* of thing, so a coat that
// differs from the jerkin by its paint alone would be the eighteen-tubes mistake
// `garments.ts` opens with. Measured against `JERKIN_ROWS`, at the four heights
// where the outline is actually read:
//
//   | height        | jerkin | coat  | Δ     | what it says                    |
//   |---------------|-------:|------:|------:|---------------------------------|
//   | hem crest     |  0.566 | 0.548 | −18mm | a longer skirt over the thigh   |
//   | hem half-width|  0.152 | 0.178 | +26mm | and a fuller one                |
//   | waist         |  0.712 | 0.700 | −12mm | the break sits lower            |
//   | waist width   |  0.142 | 0.146 |  +4mm | barely nipped: a coat, not a    |
//   |               |        |       |       | jerkin                          |
//   | shoulder      |  0.170 | 0.176 |  +6mm | squarer                         |
//
// 26 mm of hem is **1.3 px at 20 m**, which on its own is not a garment — it is
// the crossed straps that carry this one, and they are the only marking in the
// folder that is not a ring.
//
// The hem crest at 0.548 is **12 mm under `HEM_FLOOR`**, and that is a real cost
// rather than an oversight: below 0.56 a garment is trading flare against gait.
// The flare here (0.178 outboard against the legs' own 0.164 measured over 36
// phases of a walk and a jump) contains both of those with 12 mm to spare, and
// shows a knee at a full run — which is the trade `garmentKit.ts::HEM_FLOOR`
// says every hem below the floor has to state, and which a coat, of all things,
// should be allowed to make.

const COAT_ROWS: readonly Row[] = [
  [0.578, 0.154, 0.124],
  [0.53, 0.192, 0.158],
  [0.548, 0.214, 0.178], // hem crest — a short skirt, 12 mm under HEM_FLOOR
  [0.632, 0.204, 0.166],
  [0.7, 0.19, 0.146], // waist — barely nipped
  [0.744, 0.212, 0.166], // belt crest — the widest band in the folder
  [0.8, 0.198, 0.154],
  [0.885, 0.208, 0.162], // chest — where the straps cross
  [0.985, 0.218, 0.176], // shoulder — squared, and the widest point above the belt
  [1.03, 0.192, 0.158],
  [1.07, 0.17, 0.142] // standing collar
]

/**
 * Explicit ring parameters, with **three extra rings inside the hem's fold** —
 * and those three are the whole reason this list is not the jerkin's.
 *
 * ── Measured, because the obvious answer was wrong twice ────────────────────
 *
 * The hem turns under itself between rows 0 and 2, and a band chorded straight
 * across that turn has its two ends facing opposite ways;
 * `assertOutwardWinding` counts exactly that. Six shapes of the same profile
 * were built and counted:
 *
 *   | hem                                     | rings in the fold | bad faces |
 *   |-----------------------------------------|------------------:|----------:|
 *   | the jerkin's own (control)              |                 3 |         0 |
 *   | 0.548 crest, 178 mm hem                 |                 3 |         4 |
 *   | 0.548 crest, softened widths            |                 3 |         2 |
 *   | 0.544 crest, softened widths            |                 3 |         2 |
 *   | 0.550 crest, narrower turn              |                 3 |         4 |
 *   | **0.548 crest, 178 mm hem, six rings**  |                 6 |     **0** |
 *
 * The jerkin's list works for the jerkin's hem and for nothing deeper: this
 * skirt drops 48 mm and comes back 18 while the jerkin's drops 33 and comes back
 * 21, and *no* amount of softening the widths gets a fold that deep under the
 * threshold at three rings. Two of the trials reached 2 bad faces, which is the
 * trap — near enough to look like tuning, and still a hole in the description of
 * a rim rather than a coarse approximation of one.
 *
 * The three rings cost **60 triangles**, which is what the hem is worth: it is
 * this garment's only silhouette below the belt.
 */
const COAT_US = [0, 0.08, 0.16, 0.2, 0.235, 0.265, 0.294, 0.325, 0.353, 0.43, 0.51, 0.59, 0.67, 0.75, 0.84, 0.92, 1]

/**
 * Six colourways, and the grey one is at **index 1**, not 0.
 *
 * That is deliberate and it is the only place in the folder that does it.
 * `DEFAULT_APPEARANCE.gearSeed` is 1 — "every builder's own default is
 * `seed = 1`, so the figure a caller gets from `DEFAULT_APPEARANCE` is the one
 * every wardrobe sheet and every existing test was authored against" — so index
 * 1 is what a designer opening the creation screen sees before touching
 * anything, and what an NPC gets if a profession forgets to name its seeds.
 * Putting the flagship colourway anywhere else means the coat's first
 * impression is a colourway nobody chose.
 *
 * `charcoal` is absent on purpose: the coat is the *lighter* half of this kit
 * and the trousers under it are the dark half, so a charcoal coat over charcoal
 * boots is one dark column with a beard on it. Every way here is a cloth the
 * boots are not.
 */
const COAT_WAYS: readonly Colourway[] = [
  way(DYES.forest, DYES.hide), // ranger
  way(DYES.ash, DYES.brass), // the wanderer: grey wool, brass at the belt
  way(DYES.tan, DYES.steel), // caravan guard
  way(DYES.undyed, DYES.hide), // journeyman
  way(DYES.woad, DYES.steel), // free-company livery
  way(DYES.madder, DYES.brass) // messenger
]

/**
 * ─── The crossed straps, and why they are geometry ──────────────────
 *
 * A diagonal is the one marking on a surface of revolution that is not symmetric
 * under rotation about the figure's own axis — the first thing in this folder
 * that tells a viewer which way a character faces from behind. It was authored
 * as **paint** first, as a band in `v − k·u`, and the arithmetic killed it
 * before it ever rendered:
 *
 *   > The coat's body is 14 stations by **10 segments**. One segment is 110 mm
 *   > of this figure's circumference. A strap is 32 mm. A painted strap is
 *   > therefore under a third of one quad wide — and vertex colour cannot draw
 *   > anything narrower than the quad it is interpolated across, so it arrives
 *   > as a faint smear that changes width every segment.
 *
 * That is a general fact about this project's shading rather than one about
 * straps: **vertex colour can draw a band in `u` and cannot draw a band in `v`**,
 * because there are fourteen rings and ten segments and a garment's features run
 * around it. Every marking in `garments.ts` is a ring for that reason; the
 * jerkin's buckle is the one exception, it is 85 mm across — nearly a whole
 * segment — and it reads as a soft blob.
 *
 * So each strap is a **swept solid**: 60 triangles, both ends collapsed and
 * buried in the coat exactly as `garmentKit.ts::buildPanel` buries an apron's
 * top. 120 triangles for the pair, and they buy the one thing this garment has
 * that the other ten do not, plus a silhouette break in profile that no amount
 * of paint could ever have produced.
 *
 * ── The path is the chest's own surface, plus 8–12 mm ────────────────────
 *
 * Seven control points, from over the character's **left** shoulder (+X — see
 * the rig note in `equipment.ts`) down to the right hip, crossing the midline at
 * y = 0.858. The crossing is at the **chest row**, not halfway up: halfway lands
 * at the solar plexus, where nothing on a body holds a strap, and it leaves the
 * two lower legs of the X so shallow that the pair reads as a V.
 *
 * ── `z` is measured off the coat, not estimated from its rows ──────────────
 *
 * The first pass estimated it — `extentB` at that height, scaled for the
 * section's keel and the inscribed-polygon inflation — and every one of the
 * seven came out **1 to 18 mm short**, so the straps rendered as four short
 * slivers where the mass happened to clear the wool and nothing in between. The
 * estimate is not recoverable by tuning, because `FITTED_SECTION` is a closed
 * B-spline through ten control points and its radius at an arbitrary bearing has
 * no closed form; `garmentKit.ts` says the same thing from the other end —
 * *clearances must be measured on the built mesh, never derived from the control
 * points.*
 *
 * So the coat's body was built at 61 × 60 (a measurement, not a mesh) and its
 * front surface read off at each of these seven `(x, y)`:
 *
 *   | x      | y     | coat front z |
 *   |--------|-------|-------------:|
 *   |  0.150 | 1.008 |       0.1326 |
 *   |  0.108 | 0.948 |       0.1996 |
 *   |  0.055 | 0.898 |       0.2202 |
 *   |  0.000 | 0.858 |       0.2248 |
 *   | −0.055 | 0.815 |       0.2134 |
 *   | −0.108 | 0.775 |       0.1807 |
 *   | −0.152 | 0.738 |       0.1334 |
 *
 * The five interior points sit **7 mm** proud of that, which is 4 mm once the
 * B-spline's own smoothing is taken off — a uniform cubic through these controls
 * passes 2.5–2.7 mm inside them — so the strap's axis is a few millimetres off
 * the wool and its 16 mm half-thickness carries the visible face 20 mm proud
 * while the back stays 12 mm *inside* the coat. That is the whole trick: a strap
 * whose back is outside the garment has daylight under it and reads as a hoop.
 *
 * The two end points are 30 mm *inside* instead, which is what buries them.
 */
const STRAP_PATH: readonly (readonly [number, number, number])[] = [
  [0.15, 1.008, 0.103], // over the shoulder, 30 mm inside the coat
  [0.108, 0.948, 0.207],
  [0.055, 0.898, 0.227],
  [0.0, 0.858, 0.232], // the crossing, at the chest row
  [-0.055, 0.815, 0.221],
  [-0.108, 0.775, 0.188],
  [-0.152, 0.738, 0.104] // into the belt, buried again
]

/**
 * Half-width across the body (`axisA` = X) and half-thickness off it
 * (`axisB` = Z) at each control point. Both ends collapse to zero, which closes
 * the solid and charges `segments` triangles for the end band instead of
 * `2 × segments` — the same saving `garmentKit.ts::PELVIS_ROWS` takes.
 *
 * 30 mm of half-width on a strap running at ~45° is a **42 mm apparent width**,
 * which is a belt rather than a bootlace and is 2 px at 20 m. The 13 mm of depth
 * becomes 16 mm after the section's own inflation, and that number is load
 * bearing — see `STRAP_PATH`.
 */
const STRAP_WIDTH: readonly number[] = [0, 0.028, 0.03, 0.03, 0.03, 0.028, 0]
const STRAP_DEPTH: readonly number[] = [0, 0.012, 0.013, 0.013, 0.013, 0.012, 0]

/**
 * A strap's section: a rounded rectangle lying flat against the chest.
 *
 * Not an ellipse. A strap has an *edge* — the line where its flat face turns
 * over into its thickness — and that edge is what catches a different band of
 * the toon ramp from the face, which is what makes 11 mm of leather read as
 * leather. An elliptical section graduates through the turn and renders as a
 * tube.
 */
const STRAP_SECTION = splineSection([
  [0.0, 1.0],
  [0.72, 0.92],
  [1.0, 0.34],
  [1.0, -0.34],
  [0.72, -0.92],
  [0.0, -1.0],
  [-0.72, -0.92],
  [-1.0, -0.34],
  [-1.0, 0.34],
  [-0.72, 0.92]
])

/** A strap is 2 px at 20 m. Eight rings and five segments is already generous. */
const STRAP_STATIONS = 8
const STRAP_SEGMENTS = 5

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Z = new Vector3(0, 0, 1)

const _strapColour = new Color()

/**
 * One strap. `side` is +1 for the one over the character's left shoulder and
 * −1 for its mirror — a reflection in X and nothing else, so the two are the
 * same leather at the same heights, crossing at the same point.
 */
const buildStrap = (side: 1 | -1, trim: Dye, cloth: Dye): SweptPart => {
  const part = sweep({
    name: `gear/wanderersCoat/strap${side > 0 ? 'L' : 'R'}`,
    path: STRAP_PATH.map(([x, y, z]) => [side * x, y - HIPS_Y, z] as const),
    extentA: STRAP_WIDTH,
    extentB: STRAP_DEPTH,
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: STRAP_SECTION,
    stations: STRAP_STATIONS,
    segments: STRAP_SEGMENTS,
    inflate: 1 / Math.cos(Math.PI / STRAP_SEGMENTS)
  })
  return paintPart(
    part,
    (u, v, out) => {
      // `v = 0` is +Z on this section, the same convention `garmentKit.ts` sets
      // for the body, so `cos` is the face pointing away from the chest.
      const facing = Math.cos(v * Math.PI * 2)
      out.copy(DYES.hide.shadow).lerp(DYES.hide.base, 0.72 + 0.28 * Math.max(0, facing))
      out.lerp(DYES.hide.lit, 0.22 * Math.max(0, facing) ** 2)
      // The edge itself.
      out.lerp(DYES.hide.shadow, 0.5 * Math.max(0, 1 - Math.abs(Math.abs(facing) - 0.34) * 6))
      // Two studs, at the quarter points, in the coat's own trim metal.
      const stud = Math.max(0, 1 - Math.abs(u - 0.3) * 26) + Math.max(0, 1 - Math.abs(u - 0.72) * 26)
      out.lerp(trim.base, 0.7 * stud * Math.max(0, facing))
      // The buried ends take the cloth's shadow, so that if a seed or a build
      // ever pushes one out of the coat it reads as a shadow rather than as a
      // floating tab.
      out.lerp(cloth.shadow, Math.max(0, 1 - u * 14) + Math.max(0, 1 - (1 - u) * 14))
    },
    _strapColour
  )
}

// ─── 2. The tall boots ──────────────────────────────────────────────────────
//
// Dark trousers tucked into boots that reach the knee, with the shaft turned
// down into a cuff just under it.
//
// ── The cuff is a fold, and a fold is not a wide place ──────────────────────
//
// Four rows describe it and each one is load-bearing:
//
//   | y     | outboard | what it is                                          |
//   |-------|---------:|-----------------------------------------------------|
//   | 0.330 |   0.0872 | the trouser, going into the boot                    |
//   | 0.302 |   0.1032 | the cuff's **outer** face, rising                   |
//   | 0.286 |   0.1035 | the crest: the top of the fold                      |
//   | 0.262 |   0.0918 | the cuff's **inner** face, coming back down         |
//
// The outer face rises 16 mm in 28 mm of height and the inner falls 12 mm in 24:
// the two are nearly parallel and 149 mm apart at the crest, which is a *lip*
// standing off the shaft rather than a bulge in it. That is the whole difference
// between this and `rolledTrousers` — which is 1.7 mm wider at its widest and
// reads completely differently, because its 24 mm step has one face and this has
// two, catching two different bands of the toon ramp along the same 60 mm of leg.
//
// It stays **5.2 mm inside `rolledTrousers`' crest** on purpose. That model's own
// comment calls its 0.1087 "the widest thing in the set" and the claim is worth
// keeping true: a second model at the same width would make the sentence a
// coincidence rather than a fact, and the fold does not need the millimetres.

const BOOT_ROWS: readonly LegRow[] = [
  [0.596, 0.0954, 0.0872, 0.092], // waistband
  [0.516, 0.0908, 0.0884, 0.0912],
  [0.452, 0.0902, 0.0878, 0.0902],
  [0.372, 0.0962, 0.0846, 0.0894], // knee — the same real bulge every leg here needs
  [0.33, 0.0975, 0.0872, 0.0908], // the trouser going into the boot
  [0.302, 0.0985, 0.1032, 0.106], // the cuff's outer face
  [0.286, 0.0988, 0.1035, 0.1064], // crest — the top of the fold
  [0.262, 0.0986, 0.0918, 0.0944], // the cuff's inner face, back down
  [0.196, 0.098, 0.0886, 0.0906], // the shaft
  [0.14, 0.0978, 0.0862, 0.088]
]

/**
 * Explicit rings, and this model is the reason `LegPairOptions.us` exists in
 * the strength it does. The fold at rows 4–7 turns the profile through nearly
 * 180° inside 68 mm of a 620 mm leg — under a ninth of the path — so an even
 * spread gives it one ring and chords straight across it, which
 * `assertOutwardWinding` reports as exactly `segments` bad faces per leg.
 */
const BOOT_US = [0, 0.055, 0.115, 0.22, 0.315, 0.39, 0.45, 0.5, 0.545, 0.585, 0.63, 0.7, 0.78, 0.87, 1]

/**
 * Five ways, and every one of them is a **dark** trouser under a lighter boot.
 *
 * That is the fixed relationship in this model rather than a preference: the
 * cuff is the whole silhouette and it needs a value break to be read at all past
 * ~8 m, where 149 mm of fold is 7 px. Reversing it — a pale trouser and a dark
 * boot — was tried on paper and puts the break at the wrong height: the eye then
 * reads the *top* of the boot shaft as the leg's edge and the cuff vanishes into
 * it.
 */
const BOOT_WAYS: readonly Colourway[] = [
  way(DYES.forest, DYES.tan), // ranger
  way(DYES.charcoal, DYES.hide), // the wanderer — index 1, for the reason `COAT_WAYS` gives
  way(DYES.undyed, DYES.hide), // journeyman
  way(DYES.woad, DYES.hide), // livery
  way(DYES.charcoal, DYES.steel) // company sergeant
]

const _leather = new Color()

export const buildWanderersCoat = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(COAT_WAYS, seed)

  const body = buildGarmentBody({
    name: 'gear/wanderersCoat/body',
    rows: COAT_ROWS,
    section: FITTED_SECTION,
    stations: COAT_US.length,
    us: COAT_US,
    paint: (u, v, out, at) => {
      const facing = front(v)
      // **0.14 of lift, against the folder's usual 0.18–0.20.** `shadeCloth`'s
      // own note says a torso garment is the largest single field on the figure
      // and takes the toon ramp's top band across all of it at once, so an
      // albedo that reads correct on a swatch arrives as poster paint — and
      // `ash` is the lightest cloth any garment in the folder is cut from, on
      // the widest skirt in it. Two thirds of the usual lift is what keeps a
      // sunlit coat reading as grey wool.
      //
      // ── The value break across the chest is the head, and is not a bug ───
      //
      // Rendered in full sun (`faces.html?turn=222&yaw=138`) this coat has a
      // hard horizontal value step at about the belt: mid-grey above, pale
      // below. It was chased twice — first as an albedo problem, then as vertex
      // AO — and it is neither. It is the **shadow the head casts on the
      // chest**: a 0.52 m sphere with the sun at 38° of elevation throws a
      // shadow whose lower edge lands across the ribcage, and the step is that
      // edge. Shooting the same figure with `beard=none` moves nothing, which is
      // what ruled the beard out; the step survives every albedo change for the
      // same reason. Do not flatten it.
      shadeCloth(out, cloth, facing, 0.14)
      // A fall-off toward the hem, for the reason `legGarments.ts::shadeLeg` has
      // one: cloth hanging under the body's own overhang is genuinely darker at
      // the bottom. Never past the dye's own shadow (GDD R4).
      out.lerp(cloth.shadow, 0.26 * Math.max(0, 1 - u * 2.2))

      // The hem's own turn, in its own shade — the underside of a skirt is never
      // lit by anything, and never goes past the dye's shadow (GDD R4).
      out.lerp(cloth.shadow, 0.34 * band(u, at(1), 10))

      // ── The belt ───────────────────────────────────────────────────────────
      //
      // The widest band in the folder, because a road coat's waist is the thing
      // being described — and it is drawn as a *ring*, which is the one shape
      // vertex colour on a 14 × 10 grid can actually resolve.
      const belt = band(u, at(5), 13)
      _leather.copy(DYES.hide.base).lerp(DYES.hide.lit, 0.35 * Math.max(0, facing))
      out.lerp(_leather, 0.94 * belt)
      out.lerp(DYES.hide.shadow, 0.45 * band(u, at(4), 22))

      // The buckle: a plate, not a stud. 85 mm across — nearly a whole segment,
      // which is the narrowest thing this tessellation can draw at all (see
      // `STRAP_PATH`) — and at 20 m it is two pixels of warm metal on a grey
      // coat, which is the cheapest "somebody has money" signal in the folder.
      const buckle = belt * Math.max(0, 1 - around(v, 0) * 15)
      out.lerp(trim.base, 0.9 * buckle).lerp(trim.lit, 0.45 * buckle * Math.max(0, facing))

      // The coat's front closure, offset from the midline: a wrap, not a
      // button-through. The one asymmetric thing on the body sweep, and it is
      // 5 mm of shadow — which is all a fold of wool is.
      const wrapEdge = Math.max(0, 1 - around(v, 0.055) * 24)
      out.lerp(cloth.shadow, 0.42 * wrapEdge * Math.max(0, Math.min(1, (u - at(1)) * 5)))

      // The collar, in its own shade with a line of the same hide at its base.
      out.lerp(cloth.shadow, 0.35 * band(u, at(10), 15))
      out.lerp(_leather, 0.5 * band(u, at(9), 24))
    }
  })

  return finishGear({
    name: 'gear/wanderersCoat',
    budget: WANDERER_BUDGET.wanderersCoat,
    // The straps go in as their own parts rather than being merged into the
    // body: `finishGear` bakes vertex AO per part, and a strap merged into the
    // coat would darken the coat under itself — which is right — *and* itself
    // against the coat, which is not, because a strap lies on top.
    parts: [body, buildStrap(1, trim, cloth), buildStrap(-1, trim, cloth)],
    deep: [cloth.shadow, DYES.hide.shadow, DYES.hide.shadow],
    aoAmount: [0.45, 0.25, 0.25],
    seed,
    jitter: 0.03
  })
}

export const buildTallBoots = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(BOOT_WAYS, seed)

  const legs = buildLegPair({
    name: 'gear/tallBoots',
    rows: BOOT_ROWS,
    section: LEG_SECTION,
    stations: BOOT_US.length,
    us: BOOT_US,
    paint: (u, v, out, at) => {
      const facing = legFront(v)
      // `u = 0` is the hip apex and `u = 1` is the ankle apex — the opposite of
      // every torso garment in the folder, and the trap `legGarments.ts` records
      // getting wrong in its first pass.
      shadeCloth(out, cloth, facing, 0.15)
      out.lerp(cloth.shadow, 0.38 * Math.max(0, -outboard(v)))
      out.lerp(cloth.shadow, 0.2 * Math.max(0, (u - 0.4) / 0.6))

      // Where the trouser stops being a trouser. A window rather than a step,
      // for the reason `rolledTrousers` gives: a hard albedo change on a smooth
      // octagon lands on a different toon band each segment and shows the facets.
      const leather = Math.max(0, Math.min(1, (u - at(4) + 0.01) / 0.035))
      _leather.copy(trim.base).lerp(trim.lit, 0.34 * Math.max(0, facing))
      out.lerp(_leather, leather)
      out.lerp(trim.shadow, leather * 0.42 * Math.max(0, -outboard(v)))

      // The cuff's two faces. The outer one catches the light and the inner one
      // is in the fold's own shade — which is the fold, as far as the ramp is
      // concerned.
      out.lerp(trim.lit, 0.4 * band(u, at(5), 34) * Math.max(0, 0.35 + facing))
      out.lerp(trim.shadow, 0.55 * band(u, at(7), 30))
      // The crest's own rim: the top edge of the leather, 6 mm of it.
      out.lerp(trim.shadow, 0.3 * band(u, at(6), 60))

      // The shaft's seam, up the outboard side. Nothing else on a leg in this
      // project is asymmetric about the section, and a boot is.
      out.lerp(trim.shadow, 0.3 * Math.max(0, leather) * Math.max(0, 1 - Math.abs(outboard(v) - 1) * 7))

      // The sole and the heel, in the body's own boot colour so the garment
      // meets the `foot` part it does not replace. `hairBase` stays a palette
      // literal for the reason `legGarments.ts::bootward` gives.
      out.lerp(C.hairBase, Math.max(0, Math.min(1, (u - at(9)) / (1 - at(9)))) ** 1.3)
    }
  })

  return finishGear({
    name: 'gear/tallBoots',
    budget: WANDERER_BUDGET.tallBoots,
    parts: legs,
    deep: [cloth.shadow, cloth.shadow],
    aoAmount: [0.35, 0.35],
    seed,
    jitter: 0.025
  })
}

/** The two colourway tables, for the sleeve-colour lookup and for the tests. */
export const WANDERER_WAYS = {
  wanderersCoat: COAT_WAYS,
  tallBoots: BOOT_WAYS
} as const
