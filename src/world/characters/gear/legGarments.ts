import { type BufferGeometry, Color, Ray, Vector3 } from 'three'
import { C } from '../../art/palette'
import type { SkinTone } from '../equipment'
import { limbMesh } from '../limb'
import { boneDefinition } from '../rig'
import { band, type Colourway, DYES, pickWay, shadeCloth, way } from './garmentKit'
import { finishGear, type GearModel } from './gearKit'
import { buildLegPair, front, HIPS_Y, KNEE_Y, LEG_SECTION, type LegRow, outboard, THIGH_Y } from './legKit'

/**
 * ─── Four leg garments, and the honest count of what they separate ──────────
 *
 * `garments.ts` learned that a garment per profession is eighteen tubes that read
 * as one tube, and shipped nine silhouettes instead. The same lesson applies here
 * with **much less room**, and the arithmetic is worth stating before the models
 * because it is what decided how many there are:
 *
 *   * The world camera is 55° (`World.ts`), so at 20 m a 1080-row buffer resolves
 *     **51.9 px per metre**. One leg is 0.18 m across — nine pixels — and the pair
 *     spans 0.35 m, eighteen. A 20 mm difference in a leg's width is **one pixel**.
 *   * The window a leg garment's width may move in is **~35 mm**, and it is not a
 *     matter of taste. The **floor** is the leg it replaces: anything narrower
 *     opens a ray path the body was closing, which puts the outboard reach at
 *     ≥ 182 mm (`legKit.ts`, and the differential test in
 *     `tests/world/legGear.test.ts`). The **ceiling** is the midline: the two
 *     thighs are 180 mm apart and the body's own thigh already comes within 5 mm
 *     of x = 0, so past about 218 mm a garment's inboard surface reaches x = 0,
 *     where the substitution's 12 mm blend band makes it follow the *average* of
 *     two legs — which through a stride is neither of them.
 *
 * So a leg garment is a **close- and mid-range** lever, not a 20 m one, and the
 * levers it actually has are, in descending order of how far they read:
 *
 *   1. **Value.** A steel greave against pale hose changes the bottom third of
 *      the figure's value, and value survives when 9 px of width does not.
 *   2. **A discontinuity in the outline.** A roll of cloth above a bare calf, or a
 *      knee cop standing proud of the thigh above it, breaks the leg's line. A
 *      kink reads at twice the distance a gradual 20 mm does.
 *   3. **Width and taper**, which is the weakest and is where a fifth garment died
 *      — see below.
 *
 * ── What the four actually measure, one leg, |x| in mm ──────────────────────
 *
 *   | y            | 0.60 | 0.52 | 0.44 | 0.37 | 0.33 | 0.29 | 0.20 | 0.11 |
 *   |--------------|-----:|-----:|-----:|-----:|-----:|-----:|-----:|-----:|
 *   | hose         |  186 |  184 |  182 |  183 |  183 |  183 |  182 |  186 |
 *   | looseTrousers|  199 |  202 |  203 |  204 |  204 |  203 |  200 |  189 |
 *   | plateLegs    |  194 |  195 |  196 |  197 |  198 |  196 |  191 |  189 |
 *   | rolledTrousers| 192 |  195 |  195 |  201 |  205 |  210 |  186 |  186 |
 *
 * The widest gap between any two of them is **28 mm** (hose against the rolled
 * trouser's turn-up) and the narrowest is **9 mm** (loose against plate). At 20 m
 * that is 1.4 px and 0.5 px; at 1.5 m it is 19 px and 6 px. The set is therefore
 * honestly four silhouettes at conversational range, **two** at ~8 m — thin ones
 * and wide ones — and **one** at 20 m, where only value and the outline's kinks
 * survive. That is the number, and it is why there are four models and not eight.
 *
 * ── The fifth candidate, and why it is not here ─────────────────────────────
 *
 * **Padded/quilted legs** were built and cut. The width window above is the whole
 * argument: sized to the top of it a padded chausse lands at 215 mm against the
 * loose trouser's 204 — **11 mm, a fifth of a pixel at 20 m and eight pixels at
 * conversational distance**, on a garment whose whole idea is that it is thicker.
 * Its quilting rhythm reads at 1.5 m and at nothing beyond 5 m. Two garments that
 * are one silhouette are one garment, so the loose trouser keeps the slot and the
 * padded leg is a dye of it — `DYES.undyed` on `looseTrousers` is the arming
 * garment.
 *
 * A **work skirt** was rejected before it was built, for a structural reason
 * rather than a measured one: a skirt in the *legs* slot must be a bell **and**
 * two legs, because the legs under its hem are gone — so it costs twice a leg
 * garment to deliver a silhouette `garments.ts` already ships three of. The hem is
 * the torso slot's lever and it stays there.
 *
 * ── Where each row is authored against the body ─────────────────────────────
 *
 * `[y, centreX, halfWidth (outboard), halfDepth (front)]` in **character** space
 * for the left leg (`legKit.ts::LegRow`). Two floors apply to all four and are
 * asserted per garment in `tests/world/legGear.test.ts`:
 *
 *   * **Never narrower than the leg it replaces**, at any bearing — inboard
 *     included, which is the half that is easy to forget and is where the holes
 *     were.
 *   * **Never across the midline.** The closest any of them comes is 7.8 mm
 *     (hose) and the worst share of the opposite leg that produces is a few per
 *     cent, so each leg is its own solid and moves with its own bones.
 *
 * ── Under a long hem ────────────────────────────────────────────────────────
 *
 * Four torso garments in `garments.ts` hang below the knee — robe (hem 0.367),
 * dress (0.380), hooded robe (0.407), pinafore (0.440). The `mantle` looks like a
 * fifth and is not: its *cape* falls to 0.824 but its body hem is at 0.578, above
 * every leg.
 *
 * Measured over 16 bearings and every height the two share, the **tightest**
 * clearance between a skirt's outer wall and a leg garment is **10 mm** (loose
 * trousers under the hooded robe, at y = 0.58) and the loosest is 44 mm. So
 * nothing pokes through and nothing has to be suppressed — the right behaviour is
 * the third one, which is to size the legs so the question never arises.
 *
 * Suppressing them would also be the wrong trade even if it were free:
 * **55–65 % of a leg garment is below the lowest hem in the wardrobe**, and it is
 * the lower half — the greave, the bare calf, the ankle gather. A robe hides the
 * thigh, which is the half that carries nothing.
 */

export type LegGarmentKind = 'hose' | 'looseTrousers' | 'plateLegs' | 'rolledTrousers'

/**
 * Triangle budgets, stated here because `EQUIPMENT_BUDGET` is not this module's to
 * edit. **These are the numbers to copy into it**, and `legGear.test.ts` asserts
 * they agree the moment the rows land, so the two cannot drift in the interval.
 *
 * They run 345–380 against a torso garment's 240–405, and that near-parity is the
 * uncomfortable number this file has to report rather than hide: **a leg garment
 * is two closed solids with four closures**, where a torso garment is one with
 * two, and it buys a ninth of the silhouette. The cost is honest — 8 segments
 * round a 180 mm limb read at arm's length in the creation screen, and 6 (the
 * body's own) shows 12 mm of flat at every bearing — but it means legs are the
 * first thing a crowd should drop. See the note on population cost below.
 *
 * Each number is the model's measured count plus ~7 %, which is what stops a
 * budget from quietly becoming a target: the suite fails any model under 55 % of
 * its own budget, so an inflated ceiling is a failing test rather than a licence.
 *
 * ── What a hundred townspeople pay ──────────────────────────────────────────
 *
 * A leg garment **replaces** the body's thigh and shin parts, which cost 144
 * triangles for the pair (two `limbMesh` parts per leg, 36 each). So the dearest
 * garment here is 380 gross and **+236 net** per wearer, in the same draw calls
 * and the same two programs. A hundred of them is 38 000 gross, +23 600 net —
 * against the ~40 500 a hundred of the dearest torso garment costs. Legs are
 * therefore a little over half the torso wardrobe's crowd cost for a great deal
 * less than half its read, and the right answer past ~15 m is to stop substituting
 * and let the body's own legs draw.
 */
export const LEG_GARMENT_BUDGET: Record<LegGarmentKind, number> = {
  hose: 345,
  looseTrousers: 345,
  plateLegs: 380,
  rolledTrousers: 380
}

// ─── Where the rings go, and why not evenly ─────────────────────────────────
//
// Every garment places its stations by hand, and the reason is the shape of a leg
// rather than a preference: **the middle of a leg is a straight line and the two
// ends turn through 90°.** Spread evenly, a leg garment spends half its rings
// describing a taper that two would describe exactly, and hands the ankle's tip
// two rings to round a hemisphere with — which chords straight across the corner
// and leaves the body 3–4 mm outside the garment at y = 0, on all four models at
// once. Five rings over the last third and three over the first sixth is what
// closes it, and it costs nothing: the count is the same, only the placement
// moved.
//
// This is `garments.ts::SKIRT_US` arriving from the other direction — there it was
// a hem *fold* that needed rings, here it is two closures — and the same rule
// applies: rings where the curve needs them, not where the loop puts them.

/** 12 rings over 14 rows: three in the hip closure, four down the leg, five in the ankle. */
const HOSE_US = [0, 0.07, 0.15, 0.27, 0.4, 0.465, 0.53, 0.62, 0.71, 0.79, 0.88, 1]
/** 12 over 14. */
const LOOSE_US = [0, 0.06, 0.13, 0.25, 0.37, 0.48, 0.58, 0.66, 0.74, 0.825, 0.915, 1]
/** 13 over 15 — one lands on the poleyn, which turns fastest. */
const PLATE_US = [0, 0.06, 0.125, 0.24, 0.34, 0.42, 0.49, 0.57, 0.66, 0.745, 0.82, 0.9, 1]
/** 13 over 15 — one on the turn-up's crest and one on the step below it. */
const ROLLED_US = [0, 0.06, 0.125, 0.24, 0.34, 0.42, 0.49, 0.57, 0.66, 0.745, 0.82, 0.9, 1]

/** Colourways per kind, so the tests can sweep every one for a black albedo. */
export const LEG_GARMENT_COLOURWAYS: Record<LegGarmentKind, number> = {
  hose: 6,
  looseTrousers: 5,
  plateLegs: 4,
  rolledTrousers: 5
}

// ─── Shared shading ─────────────────────────────────────────────────────────

/**
 * The inner face of a thigh is in permanent contact shade and no bake finds it.
 *
 * The two legs are separate closed solids that only meet inside the pelvis, so the
 * vertex-AO pass — which is what gives a cuirass its crevices — sees two convex
 * columns with 20 mm of air between them and returns almost nothing. It is put in
 * by hand here, keyed off the section's own bearing, and it is most of what makes
 * a pair of legs read as two legs rather than as one column at 8 m.
 */
const shadeLeg = (out: Color, cloth: Parameters<typeof shadeCloth>[1], u: number, v: number, lift: number): Color => {
  shadeCloth(out, cloth, front(v), lift)
  out.lerp(cloth.shadow, 0.38 * Math.max(0, -outboard(v)))
  // A vertical fall-off toward the ankle. A leg hangs under the body's own
  // overhang and is genuinely darker at the bottom; never past the dye's own
  // shadow (GDD R4).
  //
  // **`u = 0` is the hip apex and `u = 1` is the ankle apex** — the profile runs
  // top to bottom, which is the opposite of every torso garment in the folder and
  // is the one thing about this file that will catch a reader out. The first pass
  // had this fall-off, the boot ramp and the rolled trouser's bare calf all
  // reversed, and the browser showed it in one frame: a figure in skin-coloured
  // trousers with a dark band across its hips.
  out.lerp(cloth.shadow, 0.24 * Math.max(0, (u - 0.4) / 0.6))
  return out
}

/**
 * The boot the substitution takes away.
 *
 * `chibiGeometry` ramps the *shin* part from `clothShadow` to `hairBase` — the
 * shin is the boot shaft, and a leg garment that replaces it and stops at cloth
 * leaves a pale ankle standing on a dark shoe. `hairBase` stays a palette literal
 * here for the reason the body's own comment gives: the palette shares it with
 * hair so the silhouette closes top and bottom, and reading it off the appearance
 * would give a blond character blond boots.
 */
const bootward = (out: Color, u: number, from: number, tint: Color): Color =>
  out.lerp(tint, Math.max(0, Math.min(1, (u - from) / (1 - from))) ** 1.3)

// ─── 1. Hose ────────────────────────────────────────────────────────────────
//
// The default under everything, and the one that has to be *right* rather than
// interesting: it is what a townsperson wears, what shows under every long hem,
// and the baseline the other three are read against.
//
// It is the leg plus 11–14 mm of cloth — measured, not chosen: the floor is the leg
// it replaces, and this is the narrowest it can be and still stand **2.3 mm**
// clear of the body at its own tightest bearing (the inboard-rear of the crotch,
// at y = 0.47, where the torso's bottom cap has run out). A calf swell at y = 0.29,
// a knee and a garter at the top of the thigh are the only three shapes in it.
//
// The knee is a real bulge — 86 mm of half-depth against the shin's 76 — and it is
// not styling. The body's knee is a **rigid ball**: the thigh's end cap and the
// shin's start cap are both weighted 50/50, so they rotate together and keep their
// volume through any bend. A garment's knee is a tube whose ends belong to
// different bones, so it pinches. Measured at the deepest phase of a run, a hose
// cut flush to the leg let 68 rays through the back of its own knee.

const HOSE_ROWS: readonly LegRow[] = [
  [0.596, 0.0954, 0.0837, 0.0888], // garter — the top of the stocking
  [0.52, 0.0906, 0.0848, 0.0884],
  [0.462, 0.0902, 0.0842, 0.087],
  [0.372, 0.0962, 0.0812, 0.086], // knee — a real bulge, and it is not styling: see below
  [0.288, 0.0981, 0.0779, 0.079], // calf
  [0.196, 0.0977, 0.077, 0.0758]
]

const HOSE_WAYS: readonly Colourway[] = [
  way(DYES.undyed, DYES.hide), // the commonest thing in a medieval town
  way(DYES.woad, DYES.undyed),
  way(DYES.madder, DYES.tan),
  way(DYES.forest, DYES.hide),
  way(DYES.ash, DYES.linen),
  way(DYES.tan, DYES.hide)
]

export const buildHose = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(HOSE_WAYS, seed)
  const legs = buildLegPair({
    name: 'gear/hose',
    rows: HOSE_ROWS,
    section: LEG_SECTION,
    stations: HOSE_US.length,
    us: HOSE_US,
    paint: (u, v, out, at) => {
      shadeLeg(out, cloth, u, v, 0.16)
      // The garter, in the trim colour. Narrow — at a falloff of 12 it covered
      // half the thigh and read as a second garment.
      const garter = band(u, at(0), 24)
      out.lerp(trim.base, 0.8 * garter).lerp(trim.lit, 0.3 * garter * Math.max(0, front(v)))
      bootward(out, u, at(4), C.hairBase)
    }
  })
  return finishGear({
    name: 'gear/hose',
    budget: LEG_GARMENT_BUDGET.hose,
    parts: legs,
    deep: [cloth.shadow, cloth.shadow],
    // Light: a leg is a convex column and the only cavity is between the two,
    // which `shadeLeg` puts in by hand because the bake cannot reach it.
    aoAmount: [0.35, 0.35],
    seed,
    jitter: 0.025
  })
}

// ─── 2. Loose trousers ──────────────────────────────────────────────────────
//
// Labourer, carter, sailor, and — in `undyed` — the arming garment worn under
// plate, which is what the cut fifth model was for.
//
// A **parallel column** where the hose tapers: 205 mm outboard at the thigh and
// 200 mm at the calf, against the hose's 186 and 182. That is up to 21 mm per leg, one
// pixel at 20 m and twenty at 1.5 m, so what carries it at any distance is the
// *taper*: two lines that stay apart against two that converge. The gather at the
// ankle is the second read, and it is a discontinuity rather than a width.
//
// The inner edge sits 5 mm off the midline at the widest row, which is the closest
// anything here comes to crossing it.

const LOOSE_ROWS: readonly LegRow[] = [
  [0.594, 0.1035, 0.0929, 0.0975],
  [0.516, 0.103, 0.0929, 0.0965],
  [0.428, 0.103, 0.0925, 0.0955],
  [0.344, 0.104, 0.092, 0.0935], // knee — a loose trouser does not follow it
  [0.264, 0.104, 0.0925, 0.094],
  [0.186, 0.1035, 0.091, 0.0925] // above the gather
]

const LOOSE_WAYS: readonly Colourway[] = [
  way(DYES.hide, DYES.tan), // carter, labourer
  way(DYES.undyed, DYES.hide), // the arming garment under plate
  way(DYES.ash, DYES.woad), // sailor
  way(DYES.flax, DYES.hide),
  way(DYES.moss, DYES.tan)
]

export const buildLooseTrousers = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(LOOSE_WAYS, seed)
  const legs = buildLegPair({
    name: 'gear/looseTrousers',
    rows: LOOSE_ROWS,
    section: LEG_SECTION,
    stations: LOOSE_US.length,
    us: LOOSE_US,
    paint: (u, v, out, at) => {
      shadeLeg(out, cloth, u, v, 0.15)
      // The ankle gather, where the trouser is tied over the boot.
      const tie = band(u, at(5), 20)
      out.lerp(trim.base, 0.7 * tie).lerp(trim.shadow, 0.3 * tie)
      // The waistband, mostly hidden under whatever is above — painted anyway,
      // because "mostly" is not "always" on a figure that bends.
      out.lerp(trim.shadow, 0.35 * band(u, at(0), 22))
      bootward(out, u, at(5), C.hairBase)
    }
  })
  return finishGear({
    name: 'gear/looseTrousers',
    budget: LEG_GARMENT_BUDGET.looseTrousers,
    parts: legs,
    deep: [cloth.shadow, cloth.shadow],
    aoAmount: [0.35, 0.35],
    seed,
    jitter: 0.03
  })
}

// ─── 3. Plate legs ──────────────────────────────────────────────────────────
//
// Knight, town guard, captain. Cuisse, poleyn, greave — and the poleyn is the
// whole reason this is a separate model rather than a steel dye of the hose.
//
// The knee cop is authored **in Z, not in X**: 113 mm of half-depth against the
// cuisse's 97 and the greave's 94, so from the side the leg's line breaks forward
// at the knee and comes back. A width bump would have been the obvious move and it
// is the wrong one — 16 mm across a 9 px leg is invisible from the front, whereas
// the same 16 mm in depth is a kink in the *profile*, which is what a walking
// figure presents most of the time. Screenshotted from the side: it reads.
//
// The second read is value, and it is the one that survives 20 m: steel on the
// bottom third of the figure against cloth is a value change of the whole leg, and
// value outlives nine pixels of width.

const PLATE_ROWS: readonly LegRow[] = [
  [0.598, 0.1011, 0.0895, 0.097], // cuisse, upper — the plate's top edge
  [0.5, 0.0995, 0.089, 0.095],
  [0.42, 0.0993, 0.088, 0.0925],
  [0.375, 0.1015, 0.0885, 0.102], // the poleyn rising
  [0.335, 0.1015, 0.0895, 0.1127], // knee cop — proud in Z, which is where it reads
  [0.285, 0.1015, 0.0875, 0.094], // greave, top
  [0.2, 0.101, 0.086, 0.0865] // greave, tapering to the ankle
]

const PLATE_WAYS: readonly Colourway[] = [
  way(DYES.steel, DYES.hide), // knight
  way(DYES.steel, DYES.madder), // captain
  way(DYES.ash, DYES.hide), // town guard, munition plate
  way(DYES.steel, DYES.forest) // household retainer
]

export const buildPlateLegs = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(PLATE_WAYS, seed)
  const legs = buildLegPair({
    name: 'gear/plateLegs',
    rows: PLATE_ROWS,
    section: LEG_SECTION,
    stations: PLATE_US.length,
    us: PLATE_US,
    paint: (u, v, out, at) => {
      const facing = front(v)
      // Held well down from the lit end, for the reason the cuirass records: a
      // plate is a large flat field, it takes the toon ramp's top band across all
      // of it at once, and an albedo that reads correct on a swatch arrives as
      // poster paint.
      shadeLeg(out, cloth, u, v, 0.2)
      // The poleyn's own highlight — a cop is a dome and catches the sun where
      // the cuisse above it does not.
      const cop = band(u, at(4), 13)
      out.lerp(cloth.lit, 0.3 * cop * Math.max(0, facing) ** 2)
      // The straps: leather behind the knee and at the top of the greave, which
      // is where a real harness buckles. Paint rather than geometry — two 15 mm
      // straps are 32 triangles the outline never sees.
      out.lerp(trim.base, 0.75 * band(u, at(5), 26) * Math.max(0, -facing))
      out.lerp(trim.base, 0.7 * band(u, at(0), 22))
      // Brass at the cuisse's top edge, the one warm accent on a cool kit, and the
      // thing that stops a steel leg reading as a grey pipe.
      const edge = band(u, at(0), 30)
      out.lerp(C.brassBase, 0.6 * edge).lerp(C.brassLit, 0.3 * edge * Math.max(0, facing))
      bootward(out, u, at(6), C.leatherShadow)
    }
  })
  return finishGear({
    name: 'gear/plateLegs',
    budget: LEG_GARMENT_BUDGET.plateLegs,
    parts: legs,
    deep: [cloth.shadow, cloth.shadow],
    // A plate leg has one real cavity — the fold behind the poleyn — and a strong
    // bake only dirties the rest.
    aoAmount: [0.4, 0.4],
    seed,
    jitter: 0.022
  })
}

// ─── 4. Rolled trousers ─────────────────────────────────────────────────────
//
// Fisher, harbour worker, ditcher, anyone wading. A trouser turned up above the
// calf with **bare leg below it**, and it is the only true discontinuity in the
// set: 210 mm outboard at the roll dropping to 186 at the calf, a 24 mm step over
// 60 mm of height, with a skin/cloth value break on the same line.
//
// The step alone is 1.2 px at 20 m — the value break is what actually carries it,
// which is the same argument the plate legs make from the other direction. Against
// the hose it is the widest separation in the set at **28 mm**, and against the
// loose trouser it is 14 mm; both are read at the roll and not at the calf.
//
// ── It needs the wearer's skin tone, and cannot ask for it ──────────────────
//
// The bare calf is painted from `skinTone`, so this is the one model in the folder
// whose albedo depends on the *character* rather than on its own seed. `GearBuilder`
// is `(options?: { seed?: number }) => GearModel`, so the option is accepted here
// and defaults to `skinTone: 1` — and a caller that equips this without passing the
// wearer's tone ships a dark-skinned character with pale calves. That is the same
// class of failure `garmentKit.ts` records for sleeves ("a green dress with blue
// sleeves"), and the fix is the same shape: whatever equips a leg garment passes
// the appearance through. Reported rather than solved here, because
// `CharacterAppearance` and `ItemGeometryFactory` are not this module's.

const ROLLED_ROWS: readonly LegRow[] = [
  [0.594, 0.1006, 0.089, 0.09],
  [0.46, 0.099, 0.0885, 0.089],
  [0.375, 0.1, 0.0885, 0.0895], // over the knee
  [0.318, 0.105, 0.0955, 0.0965], // the turn-up rising
  [0.288, 0.1087, 0.0991, 0.1], // roll crest — the widest thing in the set
  [0.248, 0.099, 0.079, 0.079], // under the roll: bare leg starts here
  [0.184, 0.0986, 0.0779, 0.0779] // calf
]

const ROLLED_WAYS: readonly Colourway[] = [
  way(DYES.flax, DYES.hide), // fisher
  way(DYES.undyed, DYES.woad), // harbour worker
  way(DYES.ash, DYES.hide), // ditcher
  way(DYES.tan, DYES.forest),
  way(DYES.hide, DYES.linen)
]

/** The palette's skin ramp, indexed the way `CharacterAppearance` indexes it. */
const SKIN: readonly Color[] = [C.skinTone0, C.skinTone1, C.skinTone2, C.skinTone3, C.skinTone4]

export const buildRolledTrousers = (options: { seed?: number; skinTone?: SkinTone } = {}): GearModel => {
  const seed = options.seed ?? 1
  const { cloth, trim } = pickWay(ROLLED_WAYS, seed)
  const skin = SKIN[options.skinTone ?? 1]!
  // A leg's own shade, from the same ramp the body uses. Never toward black.
  const skinShade = skin.clone().lerp(C.skinShadow, 0.55)
  const legs = buildLegPair({
    name: 'gear/rolledTrousers',
    rows: ROLLED_ROWS,
    section: LEG_SECTION,
    stations: ROLLED_US.length,
    us: ROLLED_US,
    paint: (u, v, out, at) => {
      const facing = front(v)
      shadeLeg(out, cloth, u, v, 0.15)
      // The roll's own edge, which is what makes a turn-up read as a turn-up
      // rather than as a thicker trouser.
      out.lerp(cloth.shadow, 0.4 * band(u, at(4), 20))
      out.lerp(trim.base, 0.55 * band(u, at(3), 22))
      out.lerp(trim.shadow, 0.35 * band(u, at(0), 20))
      // Below the roll — i.e. at **larger** u — the garment *is* the leg. Blended
      // over a narrow window rather than switched, because a hard albedo step on a
      // smooth surface shows the octagon's own facets: the toon ramp quantises the
      // shading and an abrupt colour change lands on a different band each segment.
      const bare = Math.max(0, Math.min(1, (u - at(4) - 0.012) / 0.045))
      out.lerp(skinShade, bare)
      out.lerp(skin, bare * (0.55 + 0.3 * Math.max(0, facing)))
      out.lerp(skinShade, bare * 0.45 * Math.max(0, -outboard(v)))
      bootward(out, u, at(6), C.hairBase)
    }
  })
  return finishGear({
    name: 'gear/rolledTrousers',
    budget: LEG_GARMENT_BUDGET.rolledTrousers,
    parts: legs,
    deep: [cloth.shadow, cloth.shadow],
    aoAmount: [0.35, 0.35],
    seed,
    jitter: 0.025
  })
}

export const LEG_GARMENT_BUILDERS: Record<LegGarmentKind, (options?: { seed?: number; skinTone?: SkinTone }) => GearModel> =
  {
    hose: buildHose,
    looseTrousers: buildLooseTrousers,
    plateLegs: buildPlateLegs,
    rolledTrousers: buildRolledTrousers
  }

// ─── Fit measurement ────────────────────────────────────────────────────────

const _ray = new Ray()
const _hit = new Vector3()
const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()

/**
 * The body's thigh and shin surfaces, sampled analytically rather than at their
 * own vertices.
 *
 * `torsoArmourMargin` probes the torso's *vertices*, which is enough for a part
 * built with two rings and two caps. A leg is not: `chibiGeometry` builds the
 * thigh with `rings: 1, capRings: 1`, so it has rings at only four heights —
 * y = 0.685, 0.60, 0.33 and 0.26 — and the whole of the mid-thigh, which is where
 * the tightest bearing is, has no vertex on it at all. A vertex probe would
 * therefore report a clean fit on a garment that misses the leg by a centimetre
 * over 150 mm of its length. So the surface is re-derived from the same
 * `limbMesh` at a 5 mm pitch instead.
 */
const legSurfacePoints = (limbScale: number): Float32Array => {
  const points: number[] = []
  for (const side of [1, -1]) {
    for (const [fromName, toName, radiusStart, radiusEnd] of [
      ['thigh', 'shin', 0.085, 0.07],
      ['shin', 'foot', 0.07, 0.072]
    ] as const) {
      const from = boneDefinition(`${fromName}.L` as 'thigh.L').head
      const to = boneDefinition(`${toName}.L` as 'shin.L').head
      const mesh = limbMesh({
        from: new Vector3(side * from[0], from[1], from[2]),
        to: new Vector3(side * to[0], to[1], to[2]),
        radiusStart: radiusStart * limbScale,
        radiusEnd: radiusEnd * limbScale,
        // Dense on purpose: this is a measurement surface, not a render.
        radial: 24,
        rings: 40,
        capRings: 8
      })
      for (let i = 0; i < mesh.position.length; i++) {
        points.push(mesh.position[i]!)
      }
    }
  }
  return new Float32Array(points)
}

export interface LegFit {
  /** Smallest (garment shell − body leg) along the leg's own bearing, in metres. */
  margin: number
  /** Character-space height at which that minimum occurs. */
  atY: number
  /** The body sample that minimum was measured at, in character space. */
  at: [number, number, number]
  /** Body-leg samples outside the garment. Must be zero. */
  breaches: number
  /** Smallest distance from the garment's inboard surface to x = 0, in metres. */
  midlineClearance: number
}

/**
 * How far the leg garment stands proud of the leg it replaces, and how close it
 * comes to the midline.
 *
 * Radial about the **leg's own axis** rather than the figure's: both surfaces are
 * stars about that axis over the covered band, so "how far short of the shell does
 * the body fall along its own bearing" is the comparable quantity — and unlike a
 * nearest-point distance it is signed, so a shortfall reports as a negative number
 * rather than as a small positive one.
 *
 * Samples inside the **torso** are skipped, because there the leg garment is
 * deliberately narrower than the thigh's start dome and the torso is what closes
 * the figure. That band is `y > 0.47` and inside the torso's own ellipse — below
 * 0.47 the torso's bottom cap has run out and the leg is on its own, which is
 * exactly where the tightest bearing turns out to be.
 */
export const legGarmentMargin = (geometry: BufferGeometry, limbScale = 1, hipRadius = 0.15, crossSection: readonly [number, number] = [1.15, 0.85]): LegFit => {
  const points = legSurfacePoints(limbScale)
  const position = geometry.getAttribute('position')
  const index = geometry.index!
  const array = position.array as ArrayLike<number>
  const chestRadius = hipRadius === 0.15 ? 0.17 : 0.15

  let margin = Number.POSITIVE_INFINITY
  let atY = 0
  const at: [number, number, number] = [0, 0, 0]
  let breaches = 0

  for (let i = 0; i < points.length; i += 3) {
    const x = points[i]!
    const y = points[i + 1]!
    const z = points[i + 2]!
    // Inside the torso? Its profile is a sphere-capped tube between the hips and
    // the chest joints; only the bottom cap can reach a leg sample.
    if (y > HIPS_Y - hipRadius) {
      const s = y - HIPS_Y
      const r = s <= 0 ? Math.sqrt(Math.max(0, hipRadius * hipRadius - s * s)) : hipRadius + (chestRadius - hipRadius) * (s / (0.95 - HIPS_Y))
      const halfZ = r * crossSection[0]
      const halfX = r * crossSection[1]
      if (halfX > 1e-6 && (x / halfX) ** 2 + (z / halfZ) ** 2 <= 1) {
        continue
      }
    }

    // The leg axis at this height: the thigh leans, the shin is vertical.
    const axisX = y >= KNEE_Y ? 0.09 + 0.01 * ((THIGH_Y - y) / (THIGH_Y - KNEE_Y)) : 0.1
    const centreX = (x >= 0 ? 1 : -1) * axisX
    const dx = x - centreX
    const radius = Math.hypot(dx, z)
    if (radius < 1e-6) {
      continue
    }

    // In the garment's frame: the hips joint is the origin.
    _ray.origin.set(centreX, y - HIPS_Y, 0)
    _ray.direction.set(dx / radius, 0, z / radius)

    // Farthest hit, not nearest: at the top of the leg the ray leaves through the
    // hip dome's inner wall first and the outer shell second, and it is the outer
    // shell the body must be inside of.
    //
    // **Hits past the midline are discarded**, and that is not a refinement. An
    // inboard-pointing ray from the left leg's axis runs straight on into the
    // *right* leg, whose far wall is 180 mm away — so "farthest hit" reports a
    // 0.2 m shell, the margin comes out hugely positive, and the whole inboard
    // half of the check silently stops testing anything. Measured before this
    // line existed: every garment reported a clean inboard fit while the hose was
    // in fact 6 mm short of the thigh at the crotch.
    let shell = -1
    for (let f = 0; f < index.count; f += 3) {
      _a.fromArray(array as number[], index.getX(f) * 3)
      _b.fromArray(array as number[], index.getX(f + 1) * 3)
      _c.fromArray(array as number[], index.getX(f + 2) * 3)
      // Two-sided: the ray starts inside, so it leaves through the inward side of
      // a front face.
      if (_ray.intersectTriangle(_a, _b, _c, false, _hit) && _hit.x * centreX >= 0) {
        const distance = Math.hypot(_hit.x - centreX, _hit.z)
        if (distance > shell) {
          shell = distance
        }
      }
    }
    if (shell < 0) {
      breaches++
      continue
    }
    const gap = shell - radius
    if (gap < 0) {
      breaches++
    }
    if (gap < margin) {
      margin = gap
      atY = y
      at[0] = x
      at[1] = y
      at[2] = z
    }
  }

  let midlineClearance = Number.POSITIVE_INFINITY
  for (let i = 0; i < position.count; i++) {
    // Only below the pelvis: the top dome is buried in the torso and both legs'
    // domes legitimately approach the axis there.
    if (position.getY(i) + HIPS_Y < HIPS_Y - hipRadius) {
      midlineClearance = Math.min(midlineClearance, Math.abs(position.getX(i)))
    }
  }

  return { margin, atY, at, breaches, midlineClearance }
}
