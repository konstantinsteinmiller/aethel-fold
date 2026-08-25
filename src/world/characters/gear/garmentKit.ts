import { Color, Vector3 } from 'three'
import { C } from '../../art/palette'
import { boneDefinition } from '../rig'
import { clearingSection, paintPart, type Section, splineSection, sweep, type SweptPart } from './gearKit'

/**
 * ─── Profession garments: the recipe every one of them follows ──────────────
 *
 * `chibiGeometry.ts` substitutes a torso garment **for** the body's torso rather
 * than covering it, and `torsoArmour.ts` is the worked example of what that
 * demands. This file is that example turned into a recipe, because the failure it
 * documents is not a property of armour — it is a property of *replacing a body
 * part*, and every garment in `garments.ts` would otherwise have to rediscover it:
 *
 *   > Once the torso is gone, a gap is not a costume error. It is a hole straight
 *   > through the character, and the sky is visible through it.
 *
 * The armour closed that with a pelvis, a gorget and two collapsed rings, after
 * measuring **208 174 rays** passing through the figure without them. Nine
 * garments cannot each re-derive those numbers by trial, and nine copies of them
 * would drift. So the closure lives here and is not the garment's to author:
 * `PELVIS_ROWS` and `GORGET_ROWS` are prepended and appended to every profile,
 * and a garment file authors only the part between them — the part that is
 * actually the costume.
 *
 * ── What a garment may and may not be ───────────────────────────────────────
 *
 * The substitution weights the garment by `torsoChestWeight`, which is a function
 * of height along the hips→chest axis and nothing else. Two consequences, both
 * measured rather than assumed, and both of which killed a design:
 *
 *   * **No sleeves.** A sleeve vertex would take hips/chest weight like the rest
 *     of the garment, so it would hang rigidly off the ribcage while the arm
 *     swung out of it. Sleeve *volume* — the thing that separates a mage from a
 *     labourer at 20 m — has to be carried by the shoulder yoke's width and the
 *     hem, not by geometry over the arm.
 *   * **No floor-length skirt.** Anything below the hips joint is weight 1 on the
 *     hips, i.e. rigid to the pelvis, and the legs swing through it. Measured on
 *     the shipped rig, in the hips bone's own frame, over 36 phases of each gait:
 *     the leg reaches |z| ≤ **194 mm** at y = 0.375 walking and ≤ **216 mm**
 *     jumping, but ≤ **359 mm** running. A knee-length skirt that contains a run
 *     would be 0.72 m across on a 1.56 m figure — wider than the character is
 *     tall is not a robe, it is a bell tent. So the long garments here are sized
 *     to contain the **walk and the jump**, which is what a townsperson does, and
 *     a sprinting mage shows a knee. `HEM_FLOOR` records the shortest hem that
 *     needs no flare at all.
 *
 * ── The one number a garment may not move ───────────────────────────────────
 *
 * `PELVIS_ROWS[0]` is an apex on the axis at y = 0.470, which is the height the
 * torso's own bottom cap bottomed out at. `splineAt` gives end control points
 * multiplicity 3, so that row is *interpolated exactly*: the ring really
 * collapses, the solid really closes, and `dropDegenerateFaces` charges
 * `segments` triangles for the band instead of `2 × segments`. Every interior row
 * is only approximated, which is why every number a garment authors is a shape
 * hint and these two are guarantees.
 *
 * ── Colour is where eighteen professions come from ──────────────────────────
 *
 * Nine silhouettes are not eighteen professions, and they were never meant to be.
 * A garment resolves a **dye** from its `seed` (`DYES`, all of them existing
 * palette triples — no new constants), so the same smock is a farmer in `moss`
 * and a tavern keeper in `madder`. Shape stays authored, exactly as `finishGear`
 * requires: the seed reaches the albedo and nothing else.
 *
 * **This is inert until something passes a seed.** `CharacterEquipment`'s
 * `ItemGeometryFactory` is `() => BufferGeometry` today, so `CreatorScene`'s
 * registration builds every wearer's garment at seed 1. Widening that signature
 * to `(seed?: number) => BufferGeometry` is the whole change; it is reported
 * rather than made here because this module does not own that file.
 */

/** The hips joint. Every row below is stated in character space against it. */
export const HIPS_Y = boneDefinition('hips').head[1]

/** Section samples. Ten is the cuirass's number and the reason is the same:
 *  fewer and the keel is a facet, more and the belt band costs more than it
 *  reads. */
export const SEGMENTS = 10

/** Inscribed-polygon compensation (GDD §4.3), for any segment count. */
export const inflateFor = (segments: number): number => 1 / Math.cos(Math.PI / segments)

/**
 * `[y, halfDepth (Z), halfWidth (X)]` in **character** space.
 *
 * Character space rather than the hips frame so the numbers can be read straight
 * against `rig.ts` — hips 0.62, chest 0.95, neck 1.06 — without arithmetic. They
 * are shifted into the hips frame on the way into the sweep.
 *
 * The Z-before-X order is not arbitrary and is the trap `torsoArmour.ts`
 * documents: `limbMesh` builds a vertical part with `u = +Z` and `v = +X`, so the
 * torso's `crossSection: [1.15, 0.85]` scales **Z** first. The shipped torso is
 * 391 mm front-to-back and 289 mm across — deeper than it is wide. Every garment
 * here is authored against the torso that ships, not the one its own comment
 * intends.
 */
export type Row = readonly [number, number, number]

/**
 * The pelvis: an apex on the axis, then the dome that fills the crotch.
 *
 * Not decorative. Removing the torso opened the region between y = 0.47 and 0.56
 * to **1 574 rays** straight through the figure, and this is what closed it. The
 * dome also has to reach at least as far out as the torso's cap did at every
 * bearing, or the thighs emerge from a waist that is narrower than they are.
 */
export const PELVIS_ROWS: readonly Row[] = [
  [0.47, 0.0, 0.0], // apex — closed, and exactly where the torso's cap bottomed
  [0.497, 0.158, 0.117],
  [0.552, 0.164, 0.122]
]

/**
 * The gorget: a rim that crosses **inside** the neck's own surface, then an apex.
 *
 * The neck is built at radius 0.070 at y = 1.06 rising to 0.080 at 1.14, so at
 * y = 1.118 its surface is at ≈ 0.0775. The rim's half-width of 0.075 becomes
 * 0.0770 after `INFLATE` and its half-depth 0.0924 — so the two solids genuinely
 * intersect rather than touch, and the closure at 1.098 is buried where nothing
 * can see it. Without this the annulus around the neck passed **2 338 rays**.
 */
export const GORGET_ROWS: readonly Row[] = [
  [1.118, 0.09, 0.075], // rim — crosses the neck's surface
  [1.098, 0.0, 0.0] // apex — closed, and inside the neck
]

/**
 * The lowest hem that needs no flare, in metres.
 *
 * Below the hips joint a garment is rigid to the pelvis. Measured over 36 phases
 * of walk, run and jump, the legs stay inside |x| ≤ 0.164 and |z| ≤ 0.085 above
 * this height in every one of them — so a hem at or above it never has a leg pass
 * through its side, whatever the character is doing. Below it, a garment is
 * trading flare against gait, and the garment's own comment has to say which.
 */
export const HEM_FLOOR = 0.56

// ─── Sections ───────────────────────────────────────────────────────────────
//
// Authored as `[X, Z]` with **`v = 0` at the front (+Z)**, which is the
// convention `torsoArmour.ts` set and the reason `front()` below is a cosine.
// `circleSection`'s own sine convention does not survive a custom section, and
// getting it backwards lights the back of a garment and shades the chest.
//
// Every one is symmetric in X by construction (1↔9, 2↔8, 3↔7, 4↔6), so a typo
// cannot make one side of the chest wider than the other — the single asymmetry
// a figure this stylised cannot survive.
//
// All three run through `clearingSection`, which scales the section so its
// *smallest* radius is 1. That is the opposite of what a world prop does and it
// is deliberate: a plateau normalises to its peak because nothing has to fit
// inside a plateau, whereas a garment's extents are a promise that the body is
// inside them at **every** bearing, so the tightest bearing is the one that has
// to mean what it says.

/** Loose cloth. A tunic, a robe, a sack: hung, not fitted, so nearly round. */
export const ROUND_SECTION = clearingSection(
  splineSection([
    [0.0, 1.0],
    [0.6, 0.83],
    [0.97, 0.32],
    [0.97, -0.32],
    [0.6, -0.86],
    [0.0, -0.98],
    [-0.6, -0.86],
    [-0.97, -0.32],
    [-0.97, 0.32],
    [-0.6, 0.83]
  ])
)

/** Cut cloth. A dress, a smock: shaped at the front, flat across the back. */
export const SOFT_SECTION = clearingSection(
  splineSection([
    [0.0, 1.04],
    [0.59, 0.9],
    [0.97, 0.38],
    [1.0, -0.24],
    [0.61, -0.83],
    [0.0, -0.97],
    [-0.61, -0.83],
    [-1.0, -0.24],
    [-0.97, 0.38],
    [-0.59, 0.9]
  ])
)

/**
 * Worked hide or a quilted body: proud at the sternum, near-flat behind.
 *
 * Eight of these ten control points exist to say *keeled*, because that is most
 * of the difference between "a jerkin" and "a bucket". A surface of revolution
 * over the torso's own ellipse renders as a smooth barrel with a belt painted on
 * it, whatever colour it is.
 */
export const FITTED_SECTION = clearingSection(
  splineSection([
    [0.0, 1.08],
    [0.57, 0.95],
    [0.99, 0.46],
    [1.03, -0.18],
    [0.63, -0.85],
    [0.0, -1.0],
    [-0.63, -0.85],
    [-1.03, -0.18],
    [-0.99, 0.46],
    [-0.57, 0.95]
  ])
)

// ─── Dyes ───────────────────────────────────────────────────────────────────

/**
 * A cloth colour, as a lit/base/shadow triple.
 *
 * All thirteen are existing palette entries regrouped — not one new constant,
 * which is the point: a dye range invented for costumes is a second palette, and
 * the two drift until a farmer's smock is a green no tree in the world is.
 *
 * The shadow end is what the no-black rule (GDD R4) is measured at, and the
 * darkest of these is `needleDeep` at **0.183 authored sRGB luma** — comfortably
 * over the 0.06 floor `tests/world/gear.test.ts` holds every model to. The
 * discipline that follows is stated once here: **a garment never lerps past its
 * own dye's shadow.** Every shading term below bottoms out there.
 */
export interface Dye {
  name: string
  lit: Color
  base: Color
  shadow: Color
  /**
   * The `variants.ts::TUNIC_COLOURS` index whose sleeves go with this cloth.
   *
   * **A garment does not own the sleeves**, and this is the one fit problem the
   * browser found that no geometric test could. `chibiGeometry` paints
   * `upperArm` from `paint.tunic`, which comes from `appearance.tunicColour` —
   * so a green dress ships with blue sleeves unless the caller changes the
   * appearance too. Screenshotted, and unmistakable: two woad-blue shoulder caps
   * on a moss-green bell.
   *
   * The right fix is for whatever equips a garment to set `tunicColour` from
   * `garments.ts::sleeveColourFor()`, which reads this field. It is stated here
   * rather than solved here because `CharacterAppearance` is not this module's.
   */
  tunicIndex: number
}

const dye = (name: string, lit: Color, base: Color, shadow: Color, tunicIndex: number): Dye => ({
  name,
  lit,
  base,
  shadow,
  tunicIndex
})

export const DYES = {
  /** Woad. The one saturated field the character silhouette already carries. */
  woad: dye('woad', C.tunicLit, C.tunicBase, C.tunicShadow, 0),
  /** Undyed wool — the default of a medieval town and the commonest garment. */
  undyed: dye('undyed', C.clothLit, C.clothBase, C.clothShadow, 4),
  /** Madder red, read off the sandstone ramp: earthy rather than pillar-box. */
  madder: dye('madder', C.sandstoneLit, C.sandstoneBase, C.sandstoneShadow, 1),
  moss: dye('moss', C.foliageLit, C.foliageBase, C.foliageDeep, 2),
  /** The darkest cloth in the set. Scholars, judges, night watch. */
  forest: dye('forest', C.needleLit, C.needleBase, C.needleDeep, 2),
  /** Bleached linen. Aprons, coifs, shirts — the brightest field allowed. */
  linen: dye('linen', C.snowLit, C.snowBase, C.snowDeep, 4),
  tan: dye('tan', C.woodLit, C.woodBase, C.woodShadow, 3),
  /** Worked hide. Jerkins, belts, harbour and mine kit. */
  hide: dye('hide', C.leatherLit, C.leatherBase, C.leatherShadow, 3),
  ash: dye('ash', C.cliffLit, C.cliffBase, C.cliffShadow, 4),
  saffron: dye('saffron', C.strawLit, C.strawBase, C.strawShadow, 5),
  sage: dye('sage', C.grassCapLit, C.grassCapBase, C.grassCapDeep, 2),
  flax: dye('flax', C.birchLit, C.birchBase, C.birchMark, 4),
  steel: dye('steel', C.steelLit, C.steelBase, C.steelShadow, 4)
} as const

/**
 * A cloth and the colour of whatever is piped, banded or belted onto it.
 *
 * Two dyes rather than one because the *trim* is where a profession lands. A
 * judge and a farm hand can wear the same dark wool; gold at the collar is the
 * whole difference, and it costs nothing — the crest the trim sits on is already
 * in the profile (GDD R1).
 */
export interface Colourway {
  cloth: Dye
  trim: Dye
}

const pick = <T>(list: readonly T[], seed: number): T =>
  list[((Math.round(seed) % list.length) + list.length) % list.length]!

/**
 * Picks one of a garment's colourways from its seed.
 *
 * Modulo rather than a hash: a caller that wants a specific colourway can ask for
 * it by number, which a hash would take away for no benefit at this list length.
 */
export const pickDye = (list: readonly Dye[], seed: number): Dye => pick(list, seed)

export const pickWay = (list: readonly Colourway[], seed: number): Colourway => pick(list, seed)

/** Shorthand for a colourway table. */
export const way = (cloth: Dye, trim: Dye): Colourway => ({ cloth, trim })

// ─── Shading ────────────────────────────────────────────────────────────────

/** Front-facing measure of a section bearing. `+1` at the sternum, `−1` behind. */
export const front = (v: number): number => Math.cos(v * Math.PI * 2)

/** A soft band in `u`, 1 at `at` and 0 by `1 / width` away from it. */
export const band = (u: number, at: number, width: number): number => Math.max(0, 1 - Math.abs(u - at) * width)

/**
 * Distance in `v` around the closed section, **wrapping at the seam**.
 *
 * A placket down the sternum sits at `v = 0`, and `v` is sampled over `[0, 1)`:
 * written as `|v − 0|` the band paints half of itself and stops dead at the seam,
 * which renders as a stripe down one side of the chest and nothing down the
 * other. Every feature keyed to a bearing goes through this.
 */
export const around = (v: number, at: number): number => {
  const d = Math.abs(v - at)
  return d < 1 - d ? d : 1 - d
}

/**
 * The base coat every garment starts from.
 *
 * Held well down from the dye's lit end on purpose, and it is the same argument
 * `palette.ts` makes for `grassCapLit`: a torso garment is the **largest single
 * field on the figure**, so it takes the toon ramp's top band across its whole
 * area at once and an albedo that reads correct on a swatch arrives as poster
 * paint. The cuirass shipped a first pass at 0.2–0.5 toward `steelLit` and put a
 * 0.29 m plate at a higher value than the character's own face.
 */
export const shadeCloth = (out: Color, cloth: Dye, facing: number, lift = 0.18): Color => {
  out.copy(cloth.shadow).lerp(cloth.base, 0.72 + 0.28 * Math.max(0, facing))
  out.lerp(cloth.lit, lift * Math.max(0, facing) ** 2)
  out.lerp(cloth.shadow, 0.4 * Math.max(0, -facing))
  return out
}

// ─── The body sweep ─────────────────────────────────────────────────────────

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Z = new Vector3(0, 0, 1)

const _color = new Color()

export interface GarmentBodyOptions {
  name: string
  /** Rows between the pelvis dome and the gorget rim, bottom to top. */
  rows: readonly Row[]
  section: Section
  stations: number
  /**
   * Explicit ring parameters, for a profile that turns faster than one station
   * gap. Every garment with a hem *fold* needs them: the surface turns through
   * ~180° at the hem, and a band chorded straight across that turn has its two
   * ends facing opposite ways — which `assertOutwardWinding` reports as exactly
   * `segments` bad faces, and which is a hole in the description of a rim rather
   * than a coarse approximation of one.
   */
  us?: readonly number[]
  /**
   * Paint, by the surface's own `(u, v)`.
   *
   * `at(i)` is the path parameter of body row `i` — **derived, not counted off by
   * hand.** `splineAt` centres control point `j` at `u = (j + 1) / (n + 1)`; the
   * obvious `j / (n − 1)` puts a collar accent 0.05 of the path below the crest
   * it belongs on, which on a band with a falloff of 11 is half the accent wide.
   */
  paint: (u: number, v: number, out: Color, at: (row: number) => number) => void
  segments?: number
}

/** The full profile a garment ships: closure, costume, closure. */
export const garmentProfile = (rows: readonly Row[]): readonly Row[] => [...PELVIS_ROWS, ...rows, ...GORGET_ROWS]

/** Triangles a sweep costs, with both end rings collapsed. */
export const sweptTriangles = (stations: number, segments: number): number =>
  (stations - 1) * segments * 2 - 2 * segments

export const buildGarmentBody = (options: GarmentBodyOptions): SweptPart => {
  const profile = garmentProfile(options.rows)
  const segments = options.segments ?? SEGMENTS
  const at = (row: number): number => (PELVIS_ROWS.length + row + 1) / (profile.length + 1)

  const part = sweep({
    name: options.name,
    path: profile.map(([y]) => [0, y - HIPS_Y, 0] as const),
    extentA: profile.map(row => row[2]),
    extentB: profile.map(row => row[1]),
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: options.section,
    stations: options.stations,
    us: options.us,
    segments,
    inflate: inflateFor(segments)
  })

  return paintPart(part, (u, v, out) => options.paint(u, v, out, at), _color)
}

// ─── Hanging panels ─────────────────────────────────────────────────────────

/**
 * A flat panel hanging off the body: an apron, a tabard skirt, a bib.
 *
 * These are what carry the professions the body sweep cannot, because a surface
 * of revolution has exactly one thing to say about the front of a garment and an
 * apron is a second thing. Each is its own **closed** solid — collapsed at both
 * ends — whose top end is buried inside the body sweep, so the union of the two
 * has no crack whatever the viewing angle and the closure is never seen.
 *
 * `depth` is the panel's half-thickness in Z at each control point, and it is
 * never zero except at the two ends: a panel with no thickness is a single-sided
 * sheet, and `FrontSide` means the player standing behind the character sees
 * through the apron to the inside of the smock.
 */
export interface PanelOptions {
  name: string
  /** `[y, z, halfWidth (X), halfDepth (Z)]` in character space, top to bottom. */
  rows: readonly (readonly [number, number, number, number])[]
  /**
   * Height of this part's own frame origin, in character space.
   *
   * Defaults to the hips joint, because that is the frame a torso garment is
   * authored in. `headwear.ts` passes 0: its rows are already in the `headTop`
   * frame, and subtracting the hips joint from them would put a hood 620 mm below
   * the head — which is not an error anything downstream would catch, because a
   * hat 620 mm low is still a valid closed solid.
   */
  originY?: number
  stations: number
  /** Explicit ring parameters. A panel with a rolled hem needs them — see
   *  `GarmentBodyOptions.us`, and the cape in `garments.ts` that proved it. */
  us?: readonly number[]
  segments?: number
  /** Defaults to `ELLIPSE_SECTION`. A cape or a cowl wants a body section. */
  section?: Section
  paint: (u: number, v: number, out: Color, at: (row: number) => number) => void
}

/**
 * An ellipse with **`v = 0` at the front**, matching the body sections above
 * rather than `circleSection`'s own `v = 0` at +X.
 *
 * One convention across the folder is what lets `front()` be a cosine
 * everywhere; two conventions is how a panel ends up lit on its back face and
 * nobody notices until a screenshot.
 */
export const ELLIPSE_SECTION: Section = (v, out) => {
  const angle = v * Math.PI * 2
  out.set(Math.sin(angle), Math.cos(angle))
}

export const buildPanel = (options: PanelOptions): SweptPart => {
  const segments = options.segments ?? 8
  const at = (row: number): number => (row + 1) / (options.rows.length + 1)
  const originY = options.originY ?? HIPS_Y
  const part = sweep({
    name: options.name,
    path: options.rows.map(([y, z]) => [0, y - originY, z] as const),
    extentA: options.rows.map(row => row[2]),
    extentB: options.rows.map(row => row[3]),
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: options.section ?? ELLIPSE_SECTION,
    stations: options.stations,
    us: options.us,
    segments,
    inflate: inflateFor(segments)
  })
  return paintPart(part, (u, v, out) => options.paint(u, v, out, at), _color)
}
