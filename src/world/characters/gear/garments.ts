import type { Color } from 'three'
import type { ItemKind } from '../equipment'
import { finishGear, type GearModel, type SweptPart } from './gearKit'
import {
  around,
  band,
  buildGarmentBody,
  buildPanel,
  type Colourway,
  DYES,
  type Dye,
  FITTED_SECTION,
  front,
  pickWay,
  ROUND_SECTION,
  type Row,
  shadeCloth,
  SOFT_SECTION,
  way
} from './garmentKit'

/**
 * ─── Nine silhouettes, eighteen professions ─────────────────────────────────
 *
 * The request was a garment per medieval trade — judge, mayor, knight, farmer,
 * mine worker, housewife, maid, recruit, town guard, shop owner, harbour worker,
 * fisher, day worker, mage, mage apprentice, hunter, weaver, tavern keeper. Built
 * literally that is eighteen tubes that differ by 15 mm of radius, and at the
 * 10–40 m the world is actually read at, **eighteen tubes are one tube**.
 *
 * So this is a spanning set instead: nine shapes chosen for what survives at
 * 20 m, which a garment's colour does not decide. Measured against the outline
 * and nothing else, a torso garment has exactly five levers:
 *
 *   1. **Hem height and flare** — a bell that reaches the knee against a jerkin
 *      that stops at the hip is the single largest read in the set.
 *   2. **Waist break** — nipped-and-belted against hanging straight.
 *   3. **Shoulder line** — squared and broad, sloped and soft, or narrow.
 *   4. **Collar** — how wide it stays and how fast it turns in. Not whether it
 *      is *open*: see THE COLLAR FLOOR below, which is the measurement that took
 *      that half of the lever away.
 *   5. **A thing hanging free off the body** — an apron, a tabard skirt, a bib,
 *      a cowl, a cape. This is the only lever that breaks the surface of
 *      revolution, and it is the one that reads from the furthest away.
 *
 * Nine shapes × thirteen dyes × twenty-one hair styles × six hats is the actual
 * combination space, and it is what makes a hundred townspeople not look alike.
 * An honest count of how many *professions* it separates is in the report, not
 * here: colour tells a farmer from a tavern keeper, and shape does not.
 *
 * ── What every one of them inherits, and may not restate ────────────────────
 *
 * `garmentKit.ts` owns the pelvis, the gorget and the two collapsed rings, for
 * the reason its header gives: with the torso substituted out, a gap is a hole
 * straight through the character. A garment file authors only the costume
 * between them, and it therefore cannot open one.
 *
 * ── Where each is authored against the body ─────────────────────────────────
 *
 * Every row is `[y, halfDepth (Z), halfWidth (X)]` in **character** space
 * (`rig.ts`: hips 0.62, chest 0.95, neck 1.06), so a number can be read straight
 * against the figure. Two floors apply to all nine and are asserted per garment
 * in `tests/world/professionGear.test.ts`:
 *
 *   * **Never narrower than the torso it replaces.** The shipped torso is 391 mm
 *     front-to-back and 289 mm across (male) / 352 × 293 (female), and a garment
 *     inside that reads as a corset with the arms and neck hanging off it.
 *   * **Never a hem the legs walk out through the side of.** Measured in the hips
 *     bone's own frame over 36 phases of each gait: above y = 0.56 the legs never
 *     leave |x| ≤ 0.164, so a hem there needs no flare. Below it, the flare in
 *     each profile is sized to the **walk and the jump** and the run is quoted in
 *     the garment's own comment — see `garmentKit.ts` for why containing a run is
 *     not a thing a 1.56 m figure can wear.
 */

export type GarmentKind =
  | 'robe'
  | 'hoodedRobe'
  | 'tabard'
  | 'apronSmock'
  | 'dress'
  | 'pinafore'
  | 'jerkin'
  | 'roughTunic'
  | 'mantle'

/**
 * Triangle budgets, stated here because `EQUIPMENT_BUDGET` is not this module's
 * to edit. **These are the numbers to copy into it**, and
 * `tests/world/professionGear.test.ts` asserts they agree the moment the rows
 * land, so the two cannot drift apart in the interval.
 *
 * They run from 240 to 405 against the cuirass's 260, and the spread is worth
 * stating because a garment's cost multiplies by the population in a way a
 * sword's does not: **every one of these replaces the torso's 96 triangles
 * rather than adding to them**, and each costs its wearer zero extra draw calls
 * and zero extra programs. A hundred townspeople in the dearest garment here is
 * 97 600 triangles in the same draw calls as a hundred in none. Against that,
 * spending 100 more triangles on a hem that reads at 20 m is the cheapest
 * silhouette in the project.
 *
 * Each number is the model's measured count plus ~7 %, which is what stops a
 * budget from quietly becoming a target: `gear.test.ts` fails any model under
 * 55 % of its own budget, so an inflated ceiling is a failing test rather than a
 * licence.
 */
export const GARMENT_BUDGET: Record<GarmentKind, number> = {
  robe: 300,
  hoodedRobe: 370,
  tabard: 375,
  apronSmock: 330,
  dress: 300,
  pinafore: 370,
  jerkin: 260,
  roughTunic: 240,
  mantle: 405
}

// ─── THE COLLAR FLOOR, which cost nine garments a redesign ──────────────────
//
// **A garment cannot have an open neck.** Not as geometry, anyway, and the reason
// is a piece of the torso nobody had counted as part of the neck seam.
//
// The torso `PartSpec` these replace is `hips → chest` with `capRings: 2`, and an
// end cap is a hemisphere: the torso's own volume does not stop at the chest
// joint at y = 0.95, it **domes up to y = 1.12** and that dome is the figure's
// shoulders. The neck part above it is only 70 mm across, and the arm parts start
// at x = ±0.09, so the annulus between them — roughly r ∈ [0.07, 0.13] over
// y ∈ [1.03, 1.10] — is carried by the torso cap and by nothing else.
//
// The first pass here gave each garment the collar its costume wanted: a low open
// neck on the smock and the rough tunic, a scooped one on the dress, a small
// standing one on the pinafore. Measured against the plain figure over 13 poses,
// that opened **6 to 570 rays** per garment straight through the shoulders,
// every one of them between y = 1.05 and y = 1.09. The cuirass passes the same
// test because its gorget is 135 mm wide at y = 1.068 — which had read as armour
// styling and is in fact structural.
//
// So every garment now carries at least the cuirass's coverage: ~0.155 half-width
// at y ≈ 1.03 and ~0.135 at y ≈ 1.07, against a torso cap that is 0.128 and 0.104
// there. The collar is still a lever — how wide, and how fast it tapers — but
// "open" is now a **paint** decision, and each garment's paint says so. Read at
// 20 m that is the right trade anyway: a 30 mm neckline was never in the
// silhouette, and the ring of shadow that replaces it is.

// ─── The skirt, and the two folds that took three passes to get right ───────
//
// Four of the nine hang below the hips, and all four share one profile skeleton
// and one station list. That is not tidiness, it is the result of a measurement.
//
// A skirt has **two reversals**, not one: the profile climbs off the pelvis dome,
// turns over at the waist, falls the whole depth of the skirt on its *inside*,
// turns again at the hem, and climbs back up the outside. Each turn is a place
// where the surface normal rotates through 180°, and a band that chords across
// one has its two ends facing opposite ways — which `assertOutwardWinding`
// reports, and which is a hole in the description of a rim rather than a coarse
// approximation of one (`hat.ts` records the same failure on a brim).
//
// Three things were tried and two of them are wrong, recorded because the wrong
// two are the obvious ones:
//
//   * **More stations.** An even 16 gave 10 bad faces, an even 18 gave 5, an even
//     22 gave 0 — and the 22 costs 400 triangles for a garment that needs 280.
//     Worse, at 20 stations the bad faces were *still there* at 2 × 10⁻⁵ m²: the
//     refinement was producing ever-smaller slivers around the same kink rather
//     than resolving it.
//   * **Stations placed on the fold's own control points.** This made it worse,
//     not better — 0 bad faces became 4 — because the problem is not where the
//     rings are but that the surface has a genuine kink for them to straddle.
//   * **Rolling the fold** — spreading the reversal over three control points
//     with a real 20 mm radius, exactly as the hat's brim rim does. `us16` below
//     then comes out clean at 280 triangles, in both the round and the soft
//     section. That is GDD R2 arriving from the other direction: there is no hard
//     edge in this world, and a fold sampled until it stops complaining is still
//     a hard edge.
//
// The rolled waist is *invisible* — it sits inside the skirt's own outer wall, so
// nothing on screen depends on its shape. It exists solely so the mesh is a
// description of a surface rather than of a crease.

/**
 * Body rows for a skirted garment, and what each index means.
 *
 * All four use these sixteen slots so they can share `SKIRT_US`, and so the
 * paint functions can key features off the same indices. `at(j)` is
 * `(j + 4) / 22` — three pelvis rows ahead of them and `splineAt`'s own
 * `(j + 1) / (n + 1)` centring.
 *
 *   0–2   the waist roll: rising, crest, over
 *   3–5   the skirt's inner wall, descending
 *   6     the hem crest — the visible bottom edge
 *   7     round the hem
 *   8     the outer wall's base
 *   9     hip      10  waist     11  chest/bust
 *   12    shoulder 13  yoke      14  collar    15  collar rim
 */
const SKIRT_US = [0, 0.075, 0.14, 0.19, 0.235, 0.28, 0.335, 0.39, 0.435, 0.48, 0.535, 0.6, 0.67, 0.76, 0.87, 1]

/** Index of the hem crest in a skirted body's rows. */
const HEM = 6
/** Index of the row where the outer wall starts, i.e. the first visible one. */
const OUTER = 7

/**
 * The shading every skirt shares.
 *
 * Everything below the hem's turn is the garment's *lining* — the inside of a
 * tube — and is in permanent shade. It falls to the dye's own shadow and never
 * toward black (GDD R4), which is the discipline `garmentKit.ts` states once:
 * no garment lerps past its own shadow, and the darkest shadow in `DYES` is
 * 0.183 authored sRGB luma against a floor of 0.06.
 */
const shadeSkirt = (
  out: Color,
  cloth: Dye,
  u: number,
  facing: number,
  at: (row: number) => number,
  lift: number
): void => {
  shadeCloth(out, cloth, facing, lift)
  if (u < at(HEM)) {
    out.lerp(cloth.shadow, 0.55)
  }
  // A vertical fall-off on the outside. A skirt hangs under the body's own
  // overhang and is genuinely darker at the bottom; a convex shell does not
  // occlude itself enough for the AO bake to find all of it.
  const down = Math.max(0, Math.min(1, (at(9) - u) / (at(9) - at(OUTER))))
  out.lerp(cloth.shadow, 0.3 * down)
  // The hem's own edge, which is what makes a hem read as an edge.
  out.lerp(cloth.shadow, 0.25 * band(u, at(HEM), 14))
}

// ─── 1. The robe ────────────────────────────────────────────────────────────
//
// Mage, judge, priest, scholar, herbalist. A **column**: no waist, no belt, and a
// hem at 0.358 — the lowest in the set. That is the whole silhouette, and it is
// the only one here that does not narrow anywhere between the hem and the
// shoulder.
//
// The hem is 258 mm deep (after the section's own inscription correction) against
// a walking leg's 194 mm and a jumping leg's 216 mm at that height, so it contains
// both with 40 mm to spare. A **run** puts the leg at 359 mm and the knee comes
// through the front of the robe; containing that would need a 0.72 m hem on a
// 1.56 m figure. Mages walk.

const ROBE_ROWS: readonly Row[] = [
  [0.572, 0.176, 0.14], // waist roll, rising off the pelvis dome
  [0.59, 0.196, 0.16], // roll crest — hidden inside the skirt's own outer wall
  [0.572, 0.212, 0.178], // over the roll, heading down
  [0.5, 0.222, 0.192], // inner wall
  [0.41, 0.234, 0.204], // inner wall
  [0.375, 0.244, 0.214],
  [0.358, 0.252, 0.222], // hem crest — the visible bottom edge
  [0.378, 0.258, 0.228], // round the hem
  [0.52, 0.24, 0.208], // outer wall, rising
  [0.68, 0.214, 0.182], // hip
  [0.8, 0.204, 0.17], // waist — a robe is not nipped, and that is the point
  [0.9, 0.21, 0.174], // chest
  [0.975, 0.216, 0.178], // shoulder yoke — the widest the shoulders get
  [1.018, 0.198, 0.168], // yoke, turning in
  [1.044, 0.188, 0.158], // collar, standing high
  [1.072, 0.168, 0.14] // gorget rise — see THE COLLAR FLOOR below
]

const ROBE_WAYS: readonly Colourway[] = [
  way(DYES.forest, DYES.saffron), // judge, scholar — dark wool, gold at the collar
  way(DYES.woad, DYES.linen), // mage
  way(DYES.madder, DYES.saffron), // priest
  way(DYES.ash, DYES.woad), // clerk
  way(DYES.undyed, DYES.madder) // village healer
]

export const buildRobe = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(ROBE_WAYS, seed)
  const body = buildGarmentBody({
    name: 'gear/robe/body',
    rows: ROBE_ROWS,
    section: ROUND_SECTION,
    stations: SKIRT_US.length,
    us: SKIRT_US,
    paint: (u, v, out, at) => {
      const facing = front(v)
      shadeSkirt(out, cloth, u, facing, at, 0.16)
      // Trim at the collar. The one warm accent on a cool garment, and the thing
      // that keeps a long dark robe from reading as a bin liner. Narrow: at a
      // falloff of 13 it covered the whole shoulder yoke and read as a cape.
      const collar = band(u, at(15), 26)
      out.lerp(trim.base, 0.85 * collar).lerp(trim.lit, 0.35 * collar * Math.max(0, facing))
    }
  })
  return finishGear({
    name: 'gear/robe',
    budget: GARMENT_BUDGET.robe,
    parts: [body],
    deep: [cloth.shadow],
    // Light: a robe is a convex column and almost nothing occludes anything. A
    // strong bake only dirties the cloth.
    aoAmount: [0.4],
    seed,
    jitter: 0.025
  })
}

// ─── 2. The hooded robe ─────────────────────────────────────────────────────
//
// Mage apprentice, hunter, monk, traveller, forester. The robe's column with the
// collar dropped and a **cowl lying on the shoulders**, which is the read: at
// 20 m it is a lump that breaks the line from the shoulder to the head, and no
// other garment in the set has one. The hem is 40 mm shorter, so the two do not
// share an outline either.
//
// The hood is **down**, and that is a constraint rather than a style choice. A
// garment is weighted `hips → chest`, so a hood worn up would hang off the
// ribcage while the head turned inside it. Hood-up is headwear (`headwear.ts`),
// where it rides the head bone and the geometry is honest.

const HOODED_ROWS: readonly Row[] = [
  [0.572, 0.174, 0.138],
  [0.59, 0.192, 0.156],
  [0.572, 0.206, 0.172],
  [0.51, 0.214, 0.182],
  [0.448, 0.228, 0.196],
  [0.415, 0.238, 0.206],
  [0.398, 0.248, 0.214], // hem crest — 40 mm above the plain robe's
  [0.418, 0.254, 0.22],
  [0.54, 0.236, 0.202],
  [0.68, 0.21, 0.178],
  [0.8, 0.198, 0.164],
  [0.9, 0.212, 0.174],
  [0.975, 0.214, 0.178], // shoulders, sloped — the cowl's weight is on them
  [1.008, 0.194, 0.162],
  [1.036, 0.184, 0.152], // collar — read as low and open by paint, not by shape
  [1.072, 0.166, 0.138]
]

/**
 * The cowl, `[y, z, halfWidth (X), halfDepth (Z)]`, top to bottom.
 *
 * Both ends collapse **inside the robe** — the top inside the collar, the bottom
 * inside the back — so the closure is never seen and the two solids genuinely
 * intersect rather than abut. The robe's back surface sits at z ≈ −0.20 over this
 * span, so the cowl's −0.15 centre with an 80 mm half-depth straddles it: 30 mm
 * of the cowl stands proud and the rest is buried.
 */
const COWL_ROWS: readonly (readonly [number, number, number, number])[] = [
  [1.082, -0.085, 0, 0],
  [1.058, -0.13, 0.095, 0.055],
  [1.01, -0.19, 0.152, 0.095],
  [0.945, -0.205, 0.16, 0.105], // 98 mm proud of the robe's back at this height
  [0.885, -0.18, 0.128, 0.082],
  [0.852, -0.12, 0, 0]
]

const HOODED_WAYS: readonly Colourway[] = [
  way(DYES.forest, DYES.hide), // hunter
  way(DYES.woad, DYES.ash), // mage apprentice
  way(DYES.undyed, DYES.hide), // monk
  way(DYES.hide, DYES.tan), // traveller
  way(DYES.moss, DYES.tan) // forester
]

export const buildHoodedRobe = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(HOODED_WAYS, seed)
  const body = buildGarmentBody({
    name: 'gear/hoodedRobe/body',
    rows: HOODED_ROWS,
    section: ROUND_SECTION,
    stations: SKIRT_US.length,
    us: SKIRT_US,
    paint: (u, v, out, at) => {
      const facing = front(v)
      shadeSkirt(out, cloth, u, facing, at, 0.16)
      // The neck opening: the inside of a cloth tube, and the darkest thing on
      // the garment.
      out.lerp(cloth.shadow, 0.5 * band(u, at(14), 13))
    }
  })
  const cowl = buildPanel({
    name: 'gear/hoodedRobe/cowl',
    rows: COWL_ROWS,
    stations: 6,
    segments: 8,
    paint: (_u, v, out) => {
      // A cowl faces **backwards**, so its lit side is the one a body panel's is
      // not: the sign on `front` is flipped rather than the section rebuilt.
      shadeCloth(out, cloth, -front(v), 0.2)
      out.lerp(trim.base, 0.25)
    }
  })
  return finishGear({
    name: 'gear/hoodedRobe',
    budget: GARMENT_BUDGET.hoodedRobe,
    parts: [body, cowl],
    deep: [cloth.shadow, cloth.shadow],
    // Stronger on the cowl: the crease where it meets the shoulders is a real
    // cavity, and it is the only thing on this garment the bake can find.
    aoAmount: [0.4, 0.8],
    seed,
    jitter: 0.028
  })
}

// ─── 3. The tabard ──────────────────────────────────────────────────────────
//
// Knight, town guard, herald. A **fitted under-layer with two free panels**, and
// the panels are the whole point: they hang past the hem, so the outline breaks
// into a body and two flaps with daylight down each side. Nothing else in the set
// has a discontinuous outline, which is why this one still reads at 40 m when the
// rest have stopped.
//
// The under-layer's hem is at 0.578, above the height any leg reaches, so it
// needs no flare and spends its rows on a hard belt and a squared shoulder
// instead.

const TABARD_ROWS: readonly Row[] = [
  [0.585, 0.152, 0.114], // hem inner lip
  [0.556, 0.184, 0.14], // hem roll, underside
  [0.578, 0.202, 0.154], // hem crest
  [0.65, 0.202, 0.153], // hip
  [0.73, 0.196, 0.148], // waist
  [0.79, 0.208, 0.158], // belt crest
  [0.86, 0.202, 0.153],
  [0.94, 0.212, 0.16], // chest
  [1.01, 0.204, 0.16], // shoulder — squared
  [1.062, 0.172, 0.142] // collar, over the gorget line
]

const TABARD_US = [0, 0.08, 0.17, 0.25, 0.31, 0.375, 0.45, 0.53, 0.62, 0.71, 0.8, 0.9, 1]

/**
 * The front panel. `[y, z, halfWidth (X), halfDepth (Z)]`, top to bottom.
 *
 * The top apex is at z = 0.09 with the body's own front surface at ≈ 0.23, so it
 * closes **inside** the chest — a panel that closed in open air would show its
 * own pole as a cone on the sternum. From y = 0.90 down it stands ~40 mm proud,
 * and past the under-layer's hem at 0.578 it hangs free.
 *
 * The 22 mm half-depth is not padding. A panel with no thickness is a
 * single-sided sheet, and the material renders `FrontSide`: the player standing
 * behind the character would see through the tabard into the inside of it.
 */
const TABARD_FRONT: readonly (readonly [number, number, number, number])[] = [
  // The apex's `z` is 0.13 and not 0.09, and that is a winding fix rather than a
  // shape one: at a collapsed ring `sweep` takes the pole's normal by
  // differencing a quarter of a band forward, and with the panel widening to
  // 120 mm over a path that was still climbing steeply in z, **one** face came
  // out wound against it. Moving the apex out along the path's own direction
  // aligns the two. Measured: 1 bad face at z = 0.09, 0 at 0.13.
  [1.05, 0.13, 0, 0],
  [1.008, 0.195, 0.12, 0.018],
  [0.9, 0.245, 0.148, 0.024],
  [0.7, 0.25, 0.152, 0.024],
  [0.5, 0.246, 0.15, 0.022],
  [0.445, 0.24, 0, 0]
]

const TABARD_BACK: readonly (readonly [number, number, number, number])[] = [
  [1.05, -0.125, 0, 0],
  [1.008, -0.19, 0.12, 0.018],
  [0.9, -0.238, 0.148, 0.024],
  [0.7, -0.244, 0.152, 0.024],
  [0.5, -0.24, 0.15, 0.022],
  [0.445, -0.234, 0, 0]
]

const TABARD_WAYS: readonly Colourway[] = [
  way(DYES.woad, DYES.saffron), // town guard — the livery colours
  way(DYES.madder, DYES.linen), // knight
  way(DYES.forest, DYES.saffron), // household troops
  way(DYES.linen, DYES.madder), // herald
  way(DYES.ash, DYES.woad) // watch
]

const tabardPanel = (name: string, rows: typeof TABARD_FRONT, cloth: Dye, trim: Dye, sign: number): SweptPart =>
  buildPanel({
    name,
    rows,
    stations: 6,
    segments: 8,
    paint: (u, v, out, at) => {
      const facing = sign * front(v)
      shadeCloth(out, cloth, facing, 0.22)
      // The device: a broad band of the livery's second colour down the middle of
      // the panel. Zero triangles — it is a charge on a flat field, which is what
      // heraldry is. The bearing it is centred on is the panel's *outward* face,
      // which is +Z for the front panel and −Z for the back one.
      const middle = Math.max(0, 1 - around(v, sign > 0 ? 0 : 0.5) * 3.4)
      const along = Math.max(0, 1 - Math.abs(u - 0.5) * 2)
      out.lerp(trim.base, 0.88 * middle * along)
      out.lerp(trim.lit, 0.35 * middle * along * Math.max(0, facing))
      // The hem darkens: a hanging panel's bottom edge is in its own shadow.
      out.lerp(cloth.shadow, 0.3 * band(u, at(rows.length - 1), 4))
    }
  })

export const buildTabard = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(TABARD_WAYS, seed)
  const body = buildGarmentBody({
    name: 'gear/tabard/body',
    rows: TABARD_ROWS,
    section: FITTED_SECTION,
    stations: TABARD_US.length,
    us: TABARD_US,
    paint: (u, v, out, at) => {
      const facing = front(v)
      // The under-layer is quilted linen and reads as the *neutral* the panels
      // are seen against, so it never takes the livery colour.
      shadeCloth(out, DYES.undyed, facing, 0.14)
      out.lerp(DYES.undyed.shadow, 0.3 * band(u, at(1), 9))
      // The belt, over the crest already in the profile.
      const belt = band(u, at(5), 13)
      out.lerp(DYES.hide.base, 0.92 * belt).lerp(DYES.hide.lit, 0.3 * belt * Math.max(0, facing))
      // Mail at the collar: the one place a guard's kit shows metal.
      const collar = band(u, at(9), 12)
      out.lerp(DYES.steel.base, 0.8 * collar).lerp(DYES.steel.lit, 0.3 * collar * Math.max(0, facing))
    }
  })
  return finishGear({
    name: 'gear/tabard',
    budget: GARMENT_BUDGET.tabard,
    parts: [
      body,
      tabardPanel('gear/tabard/front', TABARD_FRONT, cloth, trim, 1),
      tabardPanel('gear/tabard/back', TABARD_BACK, cloth, trim, -1)
    ],
    deep: [DYES.undyed.shadow, cloth.shadow, cloth.shadow],
    // The panels stand off the body, so the bake finds the gap behind them —
    // which is the shade that makes them read as hanging rather than as painted.
    aoAmount: [0.5, 0.75, 0.75],
    seed,
    jitter: 0.03
  })
}

// ─── 4. The apron'd smock ───────────────────────────────────────────────────
//
// Farmer, tavern keeper, shop owner, baker, blacksmith, mine worker. A loose
// smock with a **bib apron down the front** — the widest profession spread of any
// shape here, because an apron is what half a town wears and its colour is what
// tells them apart.
//
// The apron is a separate solid rather than a bulge in the section, and that is
// the difference between an apron and a paunch: it has an *edge*, and the edge is
// what the eye reads.

const SMOCK_ROWS: readonly Row[] = [
  [0.575, 0.15, 0.112],
  [0.542, 0.186, 0.15],
  [0.566, 0.206, 0.166], // hem crest — a working smock hangs wide
  [0.65, 0.204, 0.164],
  [0.74, 0.198, 0.158], // waist, gathered
  [0.775, 0.208, 0.166], // belt crest
  [0.85, 0.206, 0.164],
  [0.935, 0.212, 0.168], // chest
  [0.995, 0.204, 0.164], // shoulders — rolled and soft
  [1.028, 0.188, 0.156], // neck — wide and open by paint, not by shape
  [1.066, 0.166, 0.138]
]

const SMOCK_US = [0, 0.08, 0.16, 0.235, 0.294, 0.353, 0.43, 0.51, 0.59, 0.67, 0.75, 0.84, 0.92, 1]

const APRON_ROWS: readonly (readonly [number, number, number, number])[] = [
  [0.94, 0.17, 0, 0], // apex, well inside the chest
  [0.905, 0.232, 0.095, 0.018], // bib, top
  [0.78, 0.246, 0.115, 0.022], // bib, waist
  [0.64, 0.25, 0.165, 0.022], // skirt, widening
  [0.5, 0.244, 0.17, 0.02],
  [0.45, 0.236, 0, 0] // hem
]

const SMOCK_WAYS: readonly Colourway[] = [
  way(DYES.moss, DYES.undyed), // farmer
  way(DYES.madder, DYES.linen), // tavern keeper
  way(DYES.woad, DYES.linen), // shop owner
  way(DYES.tan, DYES.linen), // baker
  way(DYES.hide, DYES.hide), // blacksmith, in a leather apron
  way(DYES.ash, DYES.undyed) // mine worker
]

export const buildApronSmock = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(SMOCK_WAYS, seed)
  const body = buildGarmentBody({
    name: 'gear/apronSmock/body',
    rows: SMOCK_ROWS,
    section: ROUND_SECTION,
    stations: SMOCK_US.length,
    us: SMOCK_US,
    paint: (u, v, out, at) => {
      const facing = front(v)
      shadeCloth(out, cloth, facing, 0.16)
      out.lerp(cloth.shadow, 0.3 * band(u, at(1), 9))
      const belt = band(u, at(5), 12)
      out.lerp(DYES.hide.base, 0.85 * belt).lerp(DYES.hide.lit, 0.3 * belt * Math.max(0, facing))
      out.lerp(cloth.shadow, 0.4 * band(u, at(9), 11))
    }
  })
  const apron = buildPanel({
    name: 'gear/apronSmock/apron',
    rows: APRON_ROWS,
    stations: 6,
    segments: 8,
    paint: (u, v, out, at) => {
      const facing = front(v)
      shadeCloth(out, trim, facing, 0.24)
      // The waist tie, where the bib narrows into the skirt.
      out.lerp(trim.shadow, 0.45 * band(u, at(2), 11))
      out.lerp(trim.shadow, 0.35 * band(u, at(4), 4))
    }
  })
  return finishGear({
    name: 'gear/apronSmock',
    budget: GARMENT_BUDGET.apronSmock,
    parts: [body, apron],
    deep: [cloth.shadow, trim.shadow],
    aoAmount: [0.45, 0.7],
    seed,
    jitter: 0.03
  })
}

// ─── 5. The dress ───────────────────────────────────────────────────────────
//
// Housewife, market woman, innkeeper's wife, noblewoman, weaver. A **bell**:
// nipped to 192 mm at y = 0.745 and 266 mm deep at a hem of 0.372, which is the
// widest point on any figure in this world. The taper from waist to hem is 74 mm,
// and that ratio is the read — not the nip, which is 20 mm and vanishes past
// about 12 m.
//
// Same hem arithmetic as the robe: it contains the walk's 194 mm and the jump's
// 216 mm at that height and does not contain the run's 359 mm.

const DRESS_ROWS: readonly Row[] = [
  [0.574, 0.172, 0.136],
  [0.592, 0.19, 0.154],
  [0.574, 0.206, 0.172],
  [0.5, 0.222, 0.194], // inner wall of the bell
  [0.415, 0.246, 0.218],
  [0.388, 0.258, 0.23],
  [0.372, 0.266, 0.238], // hem crest — the widest point on the figure
  [0.392, 0.272, 0.244],
  [0.52, 0.25, 0.222],
  [0.66, 0.212, 0.182], // hip
  [0.745, 0.192, 0.158], // waist — nipped, and 16 mm clear of the torso beneath
  [0.81, 0.198, 0.16],
  [0.9, 0.212, 0.17], // bust
  [0.975, 0.196, 0.158], // shoulder — narrow, which is half of what reads female
  [1.022, 0.184, 0.152], // neckline — scooped by paint, not by shape
  [1.068, 0.162, 0.134]
]

const DRESS_WAYS: readonly Colourway[] = [
  way(DYES.madder, DYES.linen), // market woman
  way(DYES.moss, DYES.undyed), // housewife
  way(DYES.woad, DYES.linen), // innkeeper's wife
  way(DYES.forest, DYES.saffron), // noblewoman
  way(DYES.undyed, DYES.madder), // village woman
  way(DYES.saffron, DYES.hide) // weaver
]

export const buildDress = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(DRESS_WAYS, seed)
  const body = buildGarmentBody({
    name: 'gear/dress/body',
    rows: DRESS_ROWS,
    section: SOFT_SECTION,
    stations: SKIRT_US.length,
    us: SKIRT_US,
    paint: (u, v, out, at) => {
      const facing = front(v)
      shadeSkirt(out, cloth, u, facing, at, 0.17)
      // A sash at the waist, in the trim colour. It is what makes the nip read
      // from further away than the 20 mm of geometry alone manages.
      const sash = band(u, at(10), 22)
      out.lerp(trim.base, 0.8 * sash).lerp(trim.lit, 0.3 * sash * Math.max(0, facing))
      // The neckline's binding.
      out.lerp(trim.base, 0.55 * band(u, at(14), 22))
    }
  })
  return finishGear({
    name: 'gear/dress',
    budget: GARMENT_BUDGET.dress,
    parts: [body],
    deep: [cloth.shadow],
    aoAmount: [0.4],
    seed,
    jitter: 0.025
  })
}

// ─── 6. The pinafore ────────────────────────────────────────────────────────
//
// Maid, serving girl, kitchen help, laundress. The dress's bell cut **60 mm
// shorter and left fuller**, with a bright bib panel over it. Read against the
// dress at 20 m the difference is the hem height and a pale rectangle on the
// chest; read against the smock it is the bell.
//
// The bib is the same primitive as the apron and a different shape on purpose: it
// is narrow at the chest and wide at the skirt, where the apron is a slab. A maid
// and a farmhand should not share an outline.
//
// It is also the only long garment that nearly contains a run: the hem sits at
// 0.432 where a running leg reaches 275 mm against the hem's 263 mm, so 12 mm of
// knee shows at the extreme of a sprint rather than 100 mm.

const PINAFORE_ROWS: readonly Row[] = [
  [0.574, 0.172, 0.136],
  [0.592, 0.19, 0.154],
  [0.574, 0.206, 0.172],
  [0.52, 0.216, 0.186],
  [0.47, 0.234, 0.204],
  [0.448, 0.246, 0.216],
  [0.432, 0.256, 0.226], // hem crest — short and full
  [0.452, 0.262, 0.232],
  [0.56, 0.244, 0.214],
  [0.68, 0.214, 0.184],
  [0.76, 0.196, 0.162], // waist
  [0.83, 0.202, 0.164],
  [0.915, 0.212, 0.172], // bust
  [0.985, 0.198, 0.16], // shoulder
  [1.03, 0.186, 0.154], // a small standing collar
  [1.07, 0.164, 0.136]
]

const BIB_ROWS: readonly (readonly [number, number, number, number])[] = [
  [0.96, 0.15, 0, 0], // apex, inside the chest
  [0.93, 0.226, 0.078, 0.016], // bib top — narrow, between the straps
  [0.84, 0.238, 0.09, 0.018],
  [0.76, 0.244, 0.115, 0.02], // the waist tie
  [0.62, 0.248, 0.15, 0.02], // skirt
  [0.48, 0.243, 0.148, 0.018],
  [0.446, 0.238, 0, 0]
]

const PINAFORE_WAYS: readonly Colourway[] = [
  way(DYES.woad, DYES.linen), // maid
  way(DYES.hide, DYES.linen), // serving girl
  way(DYES.forest, DYES.linen), // kitchen help
  way(DYES.madder, DYES.flax), // laundress
  way(DYES.ash, DYES.linen) // scullery
]

export const buildPinafore = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(PINAFORE_WAYS, seed)
  const body = buildGarmentBody({
    name: 'gear/pinafore/body',
    rows: PINAFORE_ROWS,
    section: SOFT_SECTION,
    stations: SKIRT_US.length,
    us: SKIRT_US,
    paint: (u, v, out, at) => {
      const facing = front(v)
      shadeSkirt(out, cloth, u, facing, at, 0.17)
      // The straps. Geometry would cost 32 triangles for two 20 mm ribbons the
      // outline never sees; as paint they cost nothing and read at exactly the
      // distance they are meant to — close.
      const yoke = band(u, at(13), 20)
      const strap = Math.max(0, 1 - around(v, 0.08) * 22) + Math.max(0, 1 - around(v, 0.92) * 22)
      out.lerp(trim.base, 0.85 * yoke * strap)
      out.lerp(trim.lit, 0.3 * yoke * strap * Math.max(0, facing))
    }
  })
  const bib = buildPanel({
    name: 'gear/pinafore/bib',
    rows: BIB_ROWS,
    stations: 6,
    segments: 8,
    paint: (u, v, out, at) => {
      const facing = front(v)
      shadeCloth(out, trim, facing, 0.26)
      out.lerp(trim.shadow, 0.4 * band(u, at(3), 12))
      out.lerp(trim.shadow, 0.3 * band(u, at(5), 4))
    }
  })
  return finishGear({
    name: 'gear/pinafore',
    budget: GARMENT_BUDGET.pinafore,
    parts: [body, bib],
    deep: [cloth.shadow, trim.shadow],
    aoAmount: [0.4, 0.7],
    seed,
    jitter: 0.028
  })
}

// ─── 7. The jerkin ──────────────────────────────────────────────────────────
//
// Recruit, hunter, mercenary, off-duty guard, smith. **Short and hard**: a hem at
// 0.566, a waist nipped to 186 mm by a wide belt, and the broadest shoulder in
// the set at 216 mm. It is the only garment here whose outline goes *out* at the
// shoulder and *in* at the waist, which is what reads as armed rather than
// dressed.
//
// Worn over the `FITTED_SECTION`, which is keeled at the sternum — a jerkin is
// cut leather over a chest, not a barrel with a belt painted on it.

const JERKIN_ROWS: readonly Row[] = [
  [0.578, 0.15, 0.112],
  [0.545, 0.18, 0.14],
  [0.566, 0.196, 0.152], // hem crest — barely past the hip
  [0.64, 0.196, 0.15],
  [0.712, 0.186, 0.142], // waist — nipped hard, and 12 mm clear of the torso
  [0.755, 0.204, 0.158], // belt crest
  [0.812, 0.194, 0.15],
  [0.9, 0.208, 0.158], // chest
  [0.985, 0.216, 0.17], // shoulder — squared and broad
  [1.024, 0.19, 0.158],
  [1.066, 0.168, 0.14] // standing collar
]

const JERKIN_US = [0, 0.08, 0.16, 0.235, 0.294, 0.353, 0.43, 0.51, 0.59, 0.67, 0.75, 0.84, 0.92, 1]

const JERKIN_WAYS: readonly Colourway[] = [
  way(DYES.hide, DYES.steel), // recruit, mercenary — brown hide, steel studs
  way(DYES.forest, DYES.hide), // hunter
  way(DYES.tan, DYES.steel), // apprentice at arms
  way(DYES.ash, DYES.steel), // town watch
  way(DYES.woad, DYES.steel) // livery
]

export const buildJerkin = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(JERKIN_WAYS, seed)
  const body = buildGarmentBody({
    name: 'gear/jerkin/body',
    rows: JERKIN_ROWS,
    section: FITTED_SECTION,
    stations: JERKIN_US.length,
    us: JERKIN_US,
    paint: (u, v, out, at) => {
      const facing = front(v)
      shadeCloth(out, cloth, facing, 0.2)
      out.lerp(cloth.shadow, 0.3 * band(u, at(1), 9))
      // The belt: the widest band in the set, because a jerkin's waist is the
      // thing being described.
      const belt = band(u, at(5), 10)
      out.lerp(DYES.hide.base, 0.9 * belt).lerp(DYES.hide.lit, 0.35 * belt * Math.max(0, facing))
      // A buckle at the front of it. Two triangles' worth of read for none.
      out.lerp(trim.lit, 0.8 * belt * Math.max(0, 1 - around(v, 0) * 9))
      // The laced placket down the sternum — the open V a jerkin closes with.
      const placket = Math.max(0, 1 - around(v, 0) * 26)
      out.lerp(cloth.shadow, 0.55 * placket * Math.max(0, Math.min(1, (u - at(6)) * 4)))
      // Studs at the collar.
      const collar = band(u, at(10), 15)
      out.lerp(trim.base, 0.7 * collar).lerp(trim.lit, 0.3 * collar * Math.max(0, facing))
    }
  })
  return finishGear({
    name: 'gear/jerkin',
    budget: GARMENT_BUDGET.jerkin,
    parts: [body],
    deep: [cloth.shadow],
    aoAmount: [0.45],
    seed,
    jitter: 0.03
  })
}

// ─── 8. The rough tunic ─────────────────────────────────────────────────────
//
// Day worker, mine worker, fisher, harbour worker, beggar, farm hand. **A sack
// with a rope round it.** No structure anywhere: sloped shoulders, no collar, a
// hem that hangs to 0.572 and a waist 12 mm narrower than the chest rather than
// 30. It is the cheapest garment in the set at 220 triangles and the most worn.
//
// The hem's 176 mm half-width against the thigh's 166 mm at that height is 10 mm
// of clearance, which is the whole reason the hem is at 0.572 and not lower: at
// 0.525 the thigh comes through the side of it.

const TUNIC_ROWS: readonly Row[] = [
  [0.585, 0.152, 0.114],
  [0.552, 0.192, 0.156],
  [0.572, 0.216, 0.176], // hem crest — loose, and 10 mm clear of the thigh
  [0.66, 0.212, 0.172],
  [0.74, 0.202, 0.162], // waist, gathered by a rope
  [0.768, 0.21, 0.17], // the rope's crest
  [0.85, 0.208, 0.168],
  [0.94, 0.214, 0.172], // chest
  [1.006, 0.2, 0.162], // shoulders — sloped, no structure at all
  [1.062, 0.172, 0.142] // neck — a plain wide hole, painted rather than cut
]

const TUNIC_US = [0, 0.08, 0.17, 0.25, 0.31, 0.375, 0.45, 0.53, 0.62, 0.71, 0.8, 0.9, 1]

const TUNIC_WAYS: readonly Colourway[] = [
  way(DYES.undyed, DYES.hide), // day worker
  way(DYES.ash, DYES.hide), // mine worker
  way(DYES.sage, DYES.hide), // fisher
  way(DYES.tan, DYES.hide), // harbour worker
  way(DYES.flax, DYES.hide), // beggar
  way(DYES.moss, DYES.hide) // farm hand
]

export const buildRoughTunic = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(TUNIC_WAYS, seed)
  const body = buildGarmentBody({
    name: 'gear/roughTunic/body',
    rows: TUNIC_ROWS,
    section: ROUND_SECTION,
    stations: TUNIC_US.length,
    us: TUNIC_US,
    paint: (u, v, out, at) => {
      const facing = front(v)
      shadeCloth(out, cloth, facing, 0.15)
      out.lerp(cloth.shadow, 0.32 * band(u, at(1), 9))
      // The rope: narrow and dark, and the only structure on the garment.
      const rope = band(u, at(5), 22)
      out.lerp(trim.base, 0.9 * rope).lerp(trim.shadow, 0.4 * rope)
      // The neck hole is a hole. A wide open one is what says "no tailor".
      out.lerp(cloth.shadow, 0.45 * band(u, at(9), 10))
    }
  })
  return finishGear({
    name: 'gear/roughTunic',
    budget: GARMENT_BUDGET.roughTunic,
    parts: [body],
    deep: [cloth.shadow],
    aoAmount: [0.45],
    seed,
    jitter: 0.035
  })
}

// ─── 9. The mantle ──────────────────────────────────────────────────────────
//
// Mayor, merchant, traveller, night watch, priest. A plain body under a **shoulder
// cape**, and the cape is the answer to "can a cloak be a torso garment".
//
// It can, but only as a *capelet*. A full cloak falling to the hem would be rigid
// to the chest while the arms swing, so the arm would pass through it at every
// intermediate angle of every stride. Ending the hem at 0.872 keeps the cape
// above the elbow: at that height the upper arm sits at x ≈ 0.226 and swings
// ±50 mm in z at a walk, which stays inside the cape's 292 mm half-depth. A run
// takes the arm out through the front — the same trade the robe's hem makes, and
// recorded for the same reason.

const MANTLE_ROWS: readonly Row[] = [
  [0.588, 0.15, 0.112],
  [0.556, 0.186, 0.146],
  [0.578, 0.204, 0.162], // hem crest
  [0.66, 0.202, 0.16],
  [0.74, 0.194, 0.152], // waist
  [0.782, 0.206, 0.162], // belt crest
  [0.855, 0.2, 0.158],
  [0.938, 0.21, 0.166], // chest
  [1.006, 0.202, 0.162], // shoulder
  [1.062, 0.172, 0.142]
]

/** Eleven, not thirteen: almost all of this body is under the cape, and the rings
 *  it does not spend there are the ones the cape's hem needs. */
const MANTLE_US = [0, 0.1, 0.19, 0.25, 0.3125, 0.375, 0.47, 0.58, 0.7, 0.85, 1]

/**
 * The cape. `[y, z, halfWidth (X), halfDepth (Z)]`, top to bottom, then back up
 * the inside.
 *
 * A cone would be a single-sided shell and the player looking up under it would
 * see the sky through the shoulders, so the profile turns at the hem and climbs
 * back inside, exactly as the hat's brim does. Both apexes close inside the
 * collar, where nothing can see them.
 */
const CAPE_ROWS: readonly (readonly [number, number, number, number])[] = [
  [1.088, -0.01, 0, 0], // apex, buried in the collar
  [1.072, -0.011, 0.14, 0.156],
  // 250 mm across by y = 1.038, and that number is the arm rather than a taste.
  // The `upperArm` part's start cap is a hemisphere about (0.17, 1.00), so the
  // arm's widest point is **x = 0.227 at y = 1.024** — and the first cape, at
  // 196 mm there, let two wedges of shoulder through the top of itself. Visible
  // in the screenshot, invisible to every test in the file.
  [1.038, -0.013, 0.25, 0.278],
  [0.975, -0.015, 0.286, 0.318],
  [0.898, -0.016, 0.3, 0.334],
  [0.838, -0.018, 0.308, 0.342], // hem crest — the cape's visible edge
  [0.824, -0.018, 0.296, 0.33], // round the hem
  [0.864, -0.017, 0.274, 0.306], // underside
  [0.946, -0.016, 0.226, 0.254], // lining, rising
  [1.03, -0.012, 0.142, 0.16],
  [1.076, -0.01, 0, 0] // inner apex, buried in the collar
]

/**
 * Rings across the cape's hem, and the reason this list is not a spread.
 *
 * The first cape had a sharper hem and an even spread of nine stations over it:
 * **ten faces wound against their own normals, on ten segments**, which is the
 * whole band. That is the mesh reporting the truth — a band whose two ends face
 * opposite ways is not a coarse rim, it is a hole in the description of one.
 * Five rings now sit across `u` 0.40–0.65, where control points 4 to 6 turn the
 * surface through 180°.
 */
const CAPE_US = [0, 0.1, 0.2, 0.3, 0.38, 0.43, 0.48, 0.53, 0.6, 0.7, 0.82, 1]

const MANTLE_WAYS: readonly Colourway[] = [
  way(DYES.forest, DYES.saffron), // mayor
  way(DYES.madder, DYES.saffron), // merchant
  way(DYES.hide, DYES.tan), // traveller
  way(DYES.woad, DYES.steel), // night watch
  way(DYES.ash, DYES.linen) // priest
]

export const buildMantle = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(MANTLE_WAYS, seed)
  const body = buildGarmentBody({
    name: 'gear/mantle/body',
    rows: MANTLE_ROWS,
    section: SOFT_SECTION,
    stations: MANTLE_US.length,
    us: MANTLE_US,
    paint: (u, v, out, at) => {
      const facing = front(v)
      // The body under a cape is barely seen, so it is painted a step darker than
      // the cape rather than the same colour — which is what stops the two from
      // merging into one silhouette at distance.
      shadeCloth(out, DYES.undyed, facing, 0.13)
      out.lerp(DYES.undyed.shadow, 0.4 * Math.max(0, 1 - u / at(2)))
      out.lerp(DYES.hide.base, 0.9 * band(u, at(5), 13))
    }
  })
  const cape = buildPanel({
    name: 'gear/mantle/cape',
    rows: CAPE_ROWS,
    stations: CAPE_US.length,
    us: CAPE_US,
    segments: 10,
    section: SOFT_SECTION,
    paint: (u, v, out, at) => {
      const facing = front(v)
      shadeCloth(out, cloth, facing, 0.22)
      // Past the hem the surface is the cape's *lining* and is in permanent
      // shade. It falls to the dye's own shadow, never toward black (R4).
      if (u > at(4)) {
        out.lerp(cloth.shadow, 0.55)
      }
      out.lerp(cloth.shadow, 0.35 * band(u, at(4), 12))
      // The clasp at the throat.
      out.lerp(trim.lit, 0.85 * band(u, at(1), 14) * Math.max(0, 1 - around(v, 0) * 9))
    }
  })
  return finishGear({
    name: 'gear/mantle',
    budget: GARMENT_BUDGET.mantle,
    parts: [body, cape],
    deep: [DYES.undyed.shadow, cloth.shadow],
    // Strong on the cape: the space between its lining and the body is a real
    // cavity, and it is the only thing in this renderer that knows it is one.
    aoAmount: [0.5, 0.85],
    seed,
    jitter: 0.028
  })
}

// ─── The table ──────────────────────────────────────────────────────────────

export type GarmentBuilder = (options?: { seed?: number }) => GearModel

/**
 * Every garment's generator, keyed the way `gear/index.ts` keys `GEAR_BUILDERS`.
 *
 * Separate from that table only because `ItemKind` is not this module's to
 * extend: adding these nine kinds to `equipment.ts` is the parent's edit, and
 * these rows go straight into `GEAR_BUILDERS` when it lands.
 */
export const GARMENT_BUILDERS: Record<GarmentKind, GarmentBuilder> = {
  robe: buildRobe,
  hoodedRobe: buildHoodedRobe,
  tabard: buildTabard,
  apronSmock: buildApronSmock,
  dress: buildDress,
  pinafore: buildPinafore,
  jerkin: buildJerkin,
  roughTunic: buildRoughTunic,
  mantle: buildMantle
}

/**
 * The `TUNIC_COLOURS` index whose sleeves go with a garment's colourway.
 *
 * **This is the one fit problem the geometry tests could not see**, and the
 * browser found it immediately: `chibiGeometry` paints `upperArm` from
 * `appearance.tunicColour`, so a moss-green dress arrives with two woad-blue
 * shoulder caps on it. A garment cannot fix that from inside itself — it does not
 * own the arms — so whatever equips one has to set
 * `appearance.tunicColour = sleeveColourFor(kind, seed)` first.
 *
 * `src/world/characters/gear/wardrobe.html` does exactly that, which is why the
 * lineup there has matching sleeves and the first screenshots did not.
 */
export const sleeveColourFor = (kind: GarmentKind, seed = 1): number => WAYS_OF[kind][
  ((Math.round(seed) % WAYS_OF[kind].length) + WAYS_OF[kind].length) % WAYS_OF[kind].length
]!.cloth.tunicIndex

/**
 * The same answer for any `ItemKind`, or null when the kind has no sleeves to
 * match.
 *
 * `torsoArmour` is the case that matters: it lives in the `torso` slot like the
 * nine cloth garments but it is plate, it has no colourway table, and its arms
 * are bare skin rather than cloth. A caller holding an `ItemKind` — which is
 * everything outside this folder — should ask this rather than narrowing the
 * type itself and getting `undefined[…]` for the one kind that does not fit.
 */
export const sleeveColourForItem = (kind: ItemKind, seed = 1): number | null =>
  kind in WAYS_OF ? sleeveColourFor(kind as GarmentKind, seed) : null

const WAYS_OF: Record<GarmentKind, readonly Colourway[]> = {
  robe: ROBE_WAYS,
  hoodedRobe: HOODED_WAYS,
  tabard: TABARD_WAYS,
  apronSmock: SMOCK_WAYS,
  dress: DRESS_WAYS,
  pinafore: PINAFORE_WAYS,
  jerkin: JERKIN_WAYS,
  roughTunic: TUNIC_WAYS,
  mantle: MANTLE_WAYS
}

/** How many colourways each garment resolves from its seed. */
export const GARMENT_COLOURWAYS: Record<GarmentKind, number> = {
  robe: ROBE_WAYS.length,
  hoodedRobe: HOODED_WAYS.length,
  tabard: TABARD_WAYS.length,
  apronSmock: SMOCK_WAYS.length,
  dress: DRESS_WAYS.length,
  pinafore: PINAFORE_WAYS.length,
  jerkin: JERKIN_WAYS.length,
  roughTunic: TUNIC_WAYS.length,
  mantle: MANTLE_WAYS.length
}
