import { Color, Ray, Vector3 } from 'three'
import { C } from '../art/palette'
import { limbMesh, type LimbMesh } from './limb'

/**
 * ─── The face ───────────────────────────────────────────────────────────────
 *
 * Eyes, catchlights, a lower-lid wedge and a mouth, pressed onto the head as
 * small patches of the *same* geometry, the same material and the same skinned
 * program the body already uses (GDD §5.2 — characters fork two programs via
 * `USE_SKINNING` and the face must not make a third).
 *
 * Everything here is a decal in topology and a solid in shading: an open,
 * outward-facing shell with no back side. That is deliberate on three counts —
 * it halves the triangles, it cannot self-intersect the skull, and the outline
 * pass draws `BackSide` only, so an outward-facing patch is culled there and the
 * eyes get no 1.6 px hull of their own. A closed lens would have produced one,
 * and an 8 mm dark ring around a 60 mm eye is not a stylistic choice.
 *
 * ── Where the face sits, and why it is ray-cast ─────────────────────────────
 *
 * The head is *shaded* as a smooth ellipsoid — `limbMesh` takes its normals from
 * the radius profile, so the analytic normal at any point is
 * `normalize(u.x / 0.94, u.y, u.z)` for a sphere direction `u`. It is *built* as
 * a 9-gon swept over 10 rings, and a 9-gon's facets sit up to `r(1 − cos 20°)` —
 * **15 mm on a 250 mm head** — inside the ellipsoid they are inscribed in.
 *
 * Measured, at the authored feature positions: the eye region's real surface is
 * **15–19 mm** inside the ideal ellipsoid, the mouth's 5–11 mm. A feature placed
 * on the ideal surface would therefore hover a centimetre and a half off the
 * face — visible from any three-quarter angle, and it would cast its own shadow.
 *
 * So a feature vertex is placed by casting a ray from the head's cap centre
 * through its ideal position and taking the hit on the head's **actual**
 * triangles, built by the same `limbMesh` call `chibiGeometry` uses. Nothing
 * here models the tessellation; it asks it. If the head's `radial` or `capRings`
 * ever change, the face follows for free — which a hand-rolled facet model would
 * not, and would fail silently when it stopped matching.
 *
 * The ray is radial, so a feature keeps its angular position exactly and loses
 * ~7 % of its linear size to the inset. The authored numbers below are the
 * pre-inset ones; the rendered `bright` eye is ~61 × 78 mm.
 *
 * ── Where the face sits *vertically*, which is the trap ─────────────────────
 *
 * The head part lerps `skinBase → hairBase` along a 20 mm axis, and the caps
 * extend past both ends with the parameter clamped. In practice: everything
 * below y = 1.29 is pure skin, everything above y = 1.31 is pure hair, and the
 * boundary lands on the head's own equator. The upper hemisphere is a bowl cut.
 *
 * The usual chibi instinct — eyes slightly above the middle of the head — puts
 * them *in the hair* here. They are instead placed with their top edge 13 mm
 * **below** the hairline, centre at y ≈ 1.233, which is 37 % of the way up a
 * head spanning 1.04–1.56. That is not a compromise: an enlarged cranium is the
 * whole of the chibi read, and features sitting low on it is what the enlargement
 * means. Eyes on the adult 50 % midline of a three-heads-tall figure look like a
 * shrunken adult. The bowl cut's fringe then ends just above the eyes, which is
 * what a bowl cut does.
 *
 * **13 mm is therefore a ceiling, not a starting point**: no eye style may put a
 * lid, a corner or a catchlight higher than the one the file shipped with, which
 * is why every spec below is authored against that number rather than against
 * the hairline itself. `characterFace.test.ts` asserts it for all ten.
 *
 * ── Ten eyes and five mouths, at constant topology ──────────────────────────
 *
 * A city wants a hundred faces that do not obviously repeat, and this face is
 * 38 triangles read at 10–40 m. Two consequences run through every number below.
 *
 * **First: shape and spacing, never detail.** Under the world's 55° camera on a
 * 1080-row viewport the head is **27 px at 20 m and an eye is 4**. Rendered at
 * exactly that size in a browser, nothing survives but how far apart the two
 * dark blobs sit and how much ink they carry — so the styles spread *rendered
 * inter-ocular clearance* from 60 mm to 98 mm and eye area by a factor of 2.3,
 * and treat outline, lid slant and tilt as the things that pay off when the
 * player walks up to somebody. An honest range-by-range summary, written off
 * those renders rather than off intent, is in the note above `EYE_STYLES`.
 *
 * **Second: every style is the same 50 vertices and 38 triangles.** Not a budget
 * dodge — a structural requirement, twice over. `chibiGeometry` appends the face
 * last and three suites locate it as `position.count − FACE_VERTICES`, so a style
 * with its own vertex count would silently hand those tests the wrong block. And
 * `assertTriBudget` only ever sees the *one* combination that happened to be
 * built, so a per-style count means the ceiling is enforced on whichever face the
 * test data picked. Constant topology makes the worst case over
 * (10 eyes × 5 mouths × 21 hairstyles × 4 head shapes) exactly the worst case
 * over hairstyles alone: **1016 triangles, 44 under `CHIBI_BUDGET`.**
 *
 * So a style is a *shape function*, never a mesh: a superellipse's exponent and
 * radii, a roll of the eye's tangent frame, a slant on the upper lid, a spacing.
 * The **brows are derived from that same shape function** rather than authored —
 * ten authored brows over ten authored eyes would drift apart invisibly — and
 * the lid slant stays, because it is free and it is what carries the expression
 * past the range at which a 7 mm brow stops resolving. See the note above
 * `BROW_COLUMNS` for what a brow costs, what it buys, and the two things that
 * had to move to make room for one.
 *
 * ── Mirroring, and why it is not `dx = −dx` ─────────────────────────────────
 *
 * `setFrame` builds both eyes' frames from world up, so both eyes' local +x
 * points the same way in the world — the eyes are *translated* copies, not
 * mirrored ones. That is invisible while every feature is symmetric, and wrong
 * the moment one is not: a slanted lid authored in frame-local x would slant the
 * same way on both eyes, which reads as a head tilt rather than as a face.
 *
 * The convention here is therefore that asymmetric shape terms are functions of
 * `outward = side · u`, which is +1 at the corner away from the nose on *either*
 * eye, while the coordinate handed to `emit` stays frame-local. That keeps the
 * default's arithmetic byte-for-byte identical (the shipped figure is hashed by
 * `characterVariants.test.ts`) and still produces an exact mirror — the rim's
 * vertex *i* on one eye pairs with `(12 − i) mod 12` on the other.
 *
 * Quads are the exception: their corners are authored outward-signed, so
 * mirroring reverses the cycle and would wind them inward. Swapping the two
 * corners within each row reverses it back *and* leaves the emission order the
 * one the shipped file used.
 *
 * ── Normals ─────────────────────────────────────────────────────────────────
 *
 * Every feature's own analytic normal (the lens height field's gradient, exact
 * rather than differenced — the field is a closed form) is blended toward the
 * head's *smooth* normal at `FACE_NORMAL_BLEND`, which is GDD R3's foliage law
 * applied to the same problem: a small patch lit by its own geometry reads as a
 * separate object stuck to the head, and the toon ramp's quantisation makes that
 * worse, not better, because the patch can land a whole band away from the skin
 * it sits on. The blend target is the *ellipsoid* normal, not the polygon it is
 * really made of, because that is what the head itself is shaded with.
 *
 * `blendNormalsToSphere` is the same idea and is not used: it targets a sphere,
 * and this head is squashed 0.94 laterally — exactly the axis the eyes are
 * offset along, which is where that error is largest.
 *
 * ── No baked AO, still ──────────────────────────────────────────────────────
 *
 * Same reason as the body (see `chibiGeometry.ts`). The one place AO would help
 * — a contact shade under the fringe — is also the one place the head turns
 * underneath it.
 */

// ── The head, as the face must see it ──────────────────────────────────────
//
// Mirrored from the head `PartSpec` in `chibiGeometry.ts`. Duplicated rather
// than imported to keep the footprint in that file to one call — and pinned by
// `tests/world/characterFace.test.ts`, which rebuilds the head from these
// numbers and checks the result against the shipped chibi geometry. A drift here
// is a failing test, not a face sliding off a skull.
export const HEAD = {
  /** Start joint of the head part — the centre of its *lower* cap, not of the volume. */
  centre: [0, 1.29, 0],
  /** End joint. The 20 mm axis between the two is the whole hairline gradient. */
  top: [0, 1.31, 0],
  radius: 0.25,
  /**
   * Lateral squash. `crossSection: [1, 0.94]` reads as front-to-back in the
   * source comment; it is not. `limbMesh` builds its frame with `u = +Z` and
   * `v = +X` for a vertical axis, so `crossSection[0]` scales **Z** and
   * `crossSection[1]` scales **X**. The head is 0.47 m wide and 0.50 m deep.
   */
  widthScale: 0.94,
  radial: 9,
  rings: 1,
  capRings: 4,
  /** Below this the head is skin; above 1.31 it is hair. Nothing may cross it. */
  hairlineY: 1.29
} as const

/** GDD R3, foliage strength. See the header. */
export const FACE_NORMAL_BLEND = 0.85

// ── Eyes ───────────────────────────────────────────────────────────────────
//
// A superellipse rather than an ellipse: `|x/w|^n + |y/h|^n = 1` at n = 2.6 is
// the rounded rectangle the reference style actually draws, and it flattens the
// upper lid, which is where an eye's read comes from. A plain ellipse at this
// size is a dark circle and the face goes doll-like. The exponent is per style
// precisely because it is the cheapest control there is: 2.2 is a bead, 3.6 is a
// slit, and neither costs a vertex.
//
// 12 segments, not 10: 12 puts a vertex on all four extremes, so the widest and
// tallest points of the shape are the shape's, not the tessellation's. It is the
// same 12 for every style — see the topology note in the header.
const EYE_SEGMENTS = 12
/** Clear of the skull by enough to never z-fight, small enough to never read as a lip. */
const EYE_LIFT = 0.002
/** Height of the dome at the eye's centre, above `EYE_LIFT`. It is what the rim light catches. */
const EYE_BULGE = 0.002

/**
 * One eye style. Ten of these are the whole customisation surface of an eye.
 *
 * Distances are metres of **arc across the head**, not chords: `walk` maps them
 * with the exponential map, so 33 mm of half-width is 33 mm of skin.
 */
interface EyeSpec {
  /**
   * Half the inter-ocular distance — the centre's lateral offset from the
   * midline.
   *
   * The single strongest identity cue on this face, and — with the eye's own
   * area — the only one still alive at 20 m, which is why the ten styles spread
   * these centres over 19 mm (38 mm of inter-ocular distance) while every other
   * number moves by a few.
   */
  x: number
  /** Centre height, relative to the face anchor on the head's equator. */
  y: number
  halfWidth: number
  halfHeight: number
  /** Superellipse exponent. 2 is an ellipse; 3.5 is a rounded slot. */
  exponent: number
  /**
   * Tilt of the whole eye about its own centre, radians, **positive lifts the
   * corner away from the nose**. Mirrored per side by rolling each eye's tangent
   * frame, so an upturned eye is upturned on both sides rather than tilted.
   */
  roll: number
  /**
   * Slant of the **upper lid only**, as a fraction of half-height removed at one
   * corner. Positive drops the lid toward the nose (the brow of a scowl),
   * negative drops it toward the ear (the brow of a worry).
   *
   * This is the brow, and it is free: the eye is a solid dark shape, so its top
   * edge *is* the line a brow would have drawn. Only the upper half is scaled,
   * and the scale peaks at 1, so no style can push a lid above `bright`'s.
   */
  lidSlant: number
}

/**
 * The ten, ordered as the creation screen should show them: the shipped face
 * first, then the two that move only the spacing, then the two that change only
 * the mass, then the five that change the shape. That is deliberately the order
 * of *decreasing* range at which the change is visible.
 *
 * ── What actually reads, by distance ────────────────────────────────────────
 *
 * Read off browser renders at true pixel size, not off intent:
 *
 * • **1.3–2.2 m** (the creation screen, a conversation; head 227–349 px) — all
 *   ten are separate faces. Roll and lid slant carry the expression, the
 *   superellipse carries the character, and the mouth's five are all distinct.
 * • **8 m** (across a street; head 67 px, eye 10 px) — spacing and dark area
 *   survive, roll survives faintly, lid slant does not. About **five** groups:
 *   `small`, `sleepy`, `wide`/`tall`, `bright`/`close`, `almond`. `sharp`,
 *   `soft` and `weary` have become the same face. Of the mouths only `grin`
 *   and `open` separate from the three line mouths.
 * • **20 m** (head 27 px, eye 4 px) — spacing and mass only, and they *do*
 *   still work: `small`'s two dots are visibly further apart and smaller than
 *   `close`'s. About **three** groups. No mouth reads at all, and nothing about
 *   shape does. Past this the figure is told apart by hair silhouette, head
 *   shape and colour, which is what those levers are for.
 *
 * So: ten faces at arm's length, five at street range, three across a square.
 * Multiplied by 5 mouths that only matter within ~8 m, and by the hair, head
 * and colour levers that carry the distance, the honest claim is **fifty
 * distinct faces close up and enough silhouette variety that a hundred NPCs do
 * not repeat** — not fifty distinguishable faces at every range.
 */
export type EyeStyle =
  | 'bright'
  | 'wide'
  | 'close'
  | 'tall'
  | 'small'
  | 'almond'
  | 'sleepy'
  | 'sharp'
  | 'soft'
  | 'weary'

export const EYE_STYLES: readonly EyeStyle[] = [
  'bright',
  'wide',
  'close',
  'tall',
  'small',
  'almond',
  'sleepy',
  'sharp',
  'soft',
  'weary'
]

/**
 * Authored against two hard limits and one soft one:
 *
 * • `y + halfHeight + halfWidth·|sin roll| ≤ −0.013` — the shipped lid height.
 *   Anything above it is a dark shape drawn on a dark fringe.
 * • the outer edge stays inside ~28° of the head's front bearing, so no eye
 *   wraps onto the side of the skull where the ray-cast starts grazing.
 * • the catchlight and the lower-lid wedge scale with the eye rather than being
 *   re-authored per style, so a slit does not get a bead's highlight.
 */
const EYE_SPECS: Record<EyeStyle, EyeSpec> = {
  /** The shipped eye. Must stay exactly these numbers — the default figure is hashed. */
  bright: { x: 0.071, y: -0.055, halfWidth: 0.033, halfHeight: 0.042, exponent: 2.6, roll: 0, lidSlant: 0 },
  /** 85 mm of rendered clearance between the lids, against `bright`'s 71. Open, guileless. */
  wide: { x: 0.081, y: -0.055, halfWidth: 0.035, halfHeight: 0.038, exponent: 2.4, roll: 0, lidSlant: 0 },
  /** 60 mm rendered. Close-set reads as intent, and it is one of the two cues alive at 20 m. */
  close: { x: 0.062, y: -0.055, halfWidth: 0.03, halfHeight: 0.041, exponent: 2.7, roll: 0.02, lidSlant: 0.06 },
  /** Narrow and full height — 75 % of `bright`'s area in a quite different outline. */
  tall: { x: 0.068, y: -0.057, halfWidth: 0.024, halfHeight: 0.043, exponent: 2.5, roll: 0.02, lidSlant: 0 },
  /** 43 % of `bright`'s rendered area and 98 mm apart: the comic/elderly read, and the one style that is still obviously itself at 20 m. */
  small: { x: 0.076, y: -0.052, halfWidth: 0.023, halfHeight: 0.026, exponent: 2.2, roll: 0, lidSlant: 0 },
  /** Wide, short, upturned. The one that most changes the *outline* without changing the mass. */
  almond: { x: 0.072, y: -0.056, halfWidth: 0.036, halfHeight: 0.031, exponent: 3.1, roll: 0.13, lidSlant: 0.1 },
  /** A slot: exponent 3.6 keeps the corners square where an ellipse would pinch shut. */
  sleepy: { x: 0.072, y: -0.058, halfWidth: 0.037, halfHeight: 0.022, exponent: 3.6, roll: 0.05, lidSlant: 0.18 },
  /** The scowl. Lid drops a third of its height toward the nose; roll lifts the outer corner. */
  sharp: { x: 0.069, y: -0.057, halfWidth: 0.034, halfHeight: 0.034, exponent: 3, roll: 0.16, lidSlant: 0.34 },
  /** The mirror of `sharp` in both terms, which is the whole difference between kind and cross. */
  soft: { x: 0.073, y: -0.056, halfWidth: 0.032, halfHeight: 0.038, exponent: 2.3, roll: -0.12, lidSlant: -0.28 },
  /** Droop plus a low lid. Reads tired at 3 m and simply small at 10. */
  weary: { x: 0.07, y: -0.056, halfWidth: 0.033, halfHeight: 0.027, exponent: 2.8, roll: -0.17, lidSlant: -0.2 }
}

/**
 * `bright`, again — the size the catchlight and lower-lid numbers below were
 * authored against. Every other style scales them by its own ratio to this, so
 * the two sub-features stay inside the lid instead of needing ten copies.
 *
 * Division by the same literal is exactly 1, so the default's bytes are
 * untouched.
 */
const EYE_REFERENCE = EYE_SPECS.bright

// Catchlight: upper-outer, mirrored per eye rather than lit from one world
// direction. A character that turns would otherwise swing its highlights across
// its own eyes, and mirrored is what the reference art does anyway.
const CATCH_X = 0.013
const CATCH_Y = 0.016
const CATCH_HALF_WIDTH = 0.009
const CATCH_HALF_HEIGHT = 0.011
const CATCH_LIFT = 0.0006

// The lower-lid wedge — `eyeLight` pulled most of the way back to `eyeDark`, so
// the catchlight stays the single brightest point on the figure. Trapezoidal for
// free: narrower at the bottom, following the eye's own lower rim.
const SCLERA_Y = -0.023
const SCLERA_HALF_WIDTH_TOP = 0.021
const SCLERA_HALF_WIDTH_BOTTOM = 0.013
const SCLERA_HALF_HEIGHT = 0.008
const SCLERA_LIFT = 0.0004
const SCLERA_MIX = 0.4

// ── Mouth ──────────────────────────────────────────────────────────────────
//
// A 3-quad strip, not a line: the taper is the whole point. A constant-width
// dash reads as a scratch; thick in the middle and thin at the corners reads as
// a closed mouth. The corners also ride up by `smile`, which is a smile at 9 px
// and nothing at 3.
//
// ── What a 46 × 15 mm feature can be varied by ──────────────────────────────
//
// Very little, and it is worth saying which little. Four columns put samples at
// t = ±1 and ±1/3, so the *shape* of the curve between them is not expressible:
// what the strip can say is how wide it is, how thick it is, and where its two
// corners sit relative to its middle.
//
// Rendered at true pixel size, that is also all that would have survived. At
// 20 m the mouth is one or two dark pixels and **none of the five is
// distinguishable from any other** — an honest result, not a hedge. At 8 m only
// `grin` and `open` separate from the three line mouths, on width and on mass.
// Everything else is a read the player gets inside about 3 m, which is where the
// creation screen and every conversation happen.
//
// So the five are spread along ink and corner height rather than shaped: `grin`
// carries 39 % more ink than `smile`, and `open` carries 25 % more of it in half
// the width — the only way a cavity reads at all without a second row of
// vertices. Asymmetric mouths (the smirk, which is the strongest identity cue of
// the lot) are deliberately **not** here: the suite asserts left-right symmetry
// across the whole face, and breaking it for one mouth would retire an assertion
// that protects every other feature.
const MOUTH_COLUMNS = 4

interface MouthSpec {
  /** Centre height, relative to the face anchor. */
  y: number
  halfWidth: number
  /** Half-thickness at the centre, before the taper. */
  thickness: number
  /** Fraction of thickness removed at the corners. 0.88 is nearly a point. */
  taper: number
  /** Corner rise, metres. Negative frowns. Quadratic in the column parameter. */
  smile: number
  /**
   * Clearance above the skull, metres — and **not** a free number, because of a
   * defect the shipped face has and this one cannot inherit.
   *
   * The head is built as a 9-gon and one of its nine vertex columns runs
   * **straight down the front centre line**, exactly where a mouth is. Facets
   * fall away from that ridge fast: at `x` metres to either side the built
   * surface is `250·(1−cos40°)·u(1−u)` below the ideal ellipsoid, with
   * `u = (x/0.94)/(250·sin40°)` — **3.3 mm at 9 mm out, 4.0 mm at 11 mm.** The
   * mouth's inner columns sit at `halfWidth/3`, so the strip between them is a
   * flat chord that far *behind* a ridge which is on the ellipsoid itself.
   *
   * With the shipped 1.5 mm lift the ridge therefore comes **through** the
   * mouth, and the skin it exposes is 8 mm wide — a bright notch splitting every
   * mouth into two ticks, ~4 px of it at 2.2 m. Rendered at 0.8 m before and
   * after in a browser: at 4.5 mm the notch is gone and the mouths are solid
   * shapes; at 34° of yaw nothing floats, shadows or separates.
   *
   * `smile` is the exception and keeps 1.5 mm because it is the shipped face and
   * `characterVariants.test.ts` hashes its bytes. **Raising it to 0.0045 with the
   * other four is a one-number fix and the right one** — it needs 2.9 mm and has
   * 1.5 — but it re-baselines that hash, which is not this file's call to make.
   */
  lift: number
  /**
   * Mix toward `eyeDark`, for the one style that is a hole rather than a line.
   *
   * Value contrast is the only tool a mouth this size has: an open mouth drawn
   * in the same warm `faceLine` as a closed one reads as a *thicker* closed
   * mouth. Pulled a third of the way to the eye's dark keeps it legible as a
   * cavity while staying two palette entries and well clear of R4's black.
   */
  darken: number
}

// ── Brows ──────────────────────────────────────────────────────────────────
//
// ── They were cut once, and the reasoning that cut them was half right ──────
//
// The first pass costed brows and dropped them, buying the read back by
// slanting the upper lid: the eye is a solid dark shape, so its top edge *is*
// the line a brow would have drawn. That is still true and the slant stays —
// it is free, it survives to ~3 m, and it is what gives `sharp` and `soft`
// their expression before a brow is even reached.
//
// What the cut got wrong is that a brow is not only a line above the eye. It is
// the one feature that carries the character's **hair colour onto the face**,
// and without it a blond character has a dark-brown mouth, dark eyes and no
// other evidence anywhere below the hairline that their hair is blond. Twelve
// triangles buy that.
//
// ── Where a brow can physically go, which is the whole difficulty ───────────
//
// The face sits low on an enlarged cranium and the hairline is the head's own
// equator, so the band between the top of the eye and the painted hair is
// **13 mm** — and the header above states 13 mm as a *ceiling* no feature may
// cross. A brow does not fit in a band of zero.
//
// Both ends therefore moved, by the smallest amount that works and no more:
//
//   * A brow's highest vertex is held at `BROW_CEILING`, 2.5 mm below the face
//     anchor — 10.5 mm above the shipped ceiling, and the number is derived
//     rather than picked (see `browPlacement`).
//   * `HAIRLINE`'s floor in `variants.ts` moved from −0.25 to **+0.25**, which
//     raises the painted line on the nine styles that sat on the floor by 10 mm
//     and on `bowl` by 5 mm. The file's own note says 5 mm of hairline is a
//     quarter of a pixel at 20 m; this is half of one, and it buys the feature
//     the floor now exists to protect. The floor used to be set by the eyelid;
//     it is set by the brow now, and that is the only rule change.
//
// ── What it costs at range, measured, not claimed ───────────────────────────
//
// A brow is ~74 mm long and 7 mm thick at its thickest. Under this world's 55°
// camera on a 1080-row viewport that is 3.7 px × 0.35 px at 2 m, and **0.35 px ×
// 0.03 px at 20 m** — so a brow is a conversation-range feature, exactly like
// the mouth's five styles and the lid slant, and it adds nothing to the
// three-groups-at-20 m result in the note above `EYE_STYLES`. What it does add
// is hair colour on the face at the range the creation screen and every dialogue
// happen at.
export const BROW_COLUMNS = 4

/**
 * The highest a brow vertex may sit, in the face frame.
 *
 * **Derived, not chosen.** Working backwards from the assertion in
 * `characterVariants.test.ts` that no face vertex comes within 5 mm of the
 * painted hairline: on `square` (the shortest head, height 0.94) a hairline at
 * `HAIRLINE` = +0.25 lands at y = 1.29452, so the highest face vertex may reach
 * 1.28652, which is 2.2 mm of arc below the anchor once the exponential map's
 * own foreshortening is taken off. Rounded down to 2.0, which measures out at
 * 9.4 mm of clearance against the 8 mm the suite asks for.
 *
 * Every brow's top lands *exactly* here when its eye is high enough to push it
 * there, and lower otherwise — see `browPlacement`.
 */
const BROW_CEILING = -0.002

/** Half-thickness at the thickest point. 7 mm of brow; the mouth is 15. */
const BROW_THICKNESS = 0.003

/**
 * Clearance above the skull. The mouth's number, for a weaker version of the
 * mouth's reason.
 *
 * The mouth needs 4.5 mm because it straddles the head's front-centre vertex
 * column, whose facets fall 3.3–4.0 mm away on either side. A brow does not
 * straddle it — it spans x ≈ 28–110 mm, entirely between the 0° and 40° columns
 * — so the sag it has to clear is only the one *within* a facet across its own
 * 23 mm quads, which is smaller. It takes the same number anyway rather than a
 * second one to tune: at 4.5 mm the whole face is already inside the 8 mm the
 * suite allows a feature to stand off the skull, and a brow and a mouth lying at
 * different heights on the same face is a difference nobody wants to discover.
 */
const BROW_LIFT = 0.0045

/** Clear skin between the top of the lid and the bottom of the brow. */
const BROW_GAP = 0.0055

/** Rise of the arch at the middle, over a straight line between the two ends. */
const BROW_ARCH = 0.0015

/** A brow is a little wider than the eye under it, and sits a little outboard. */
const BROW_WIDTH_SCALE = 1.12
const BROW_OUT_SHIFT = 0.004

/**
 * Where the thickness peaks, in outward coordinates: inner third, as a brow
 * does. `BROW_TAPER` is how much is removed at the far end from there — 0.75
 * leaves a quarter of the thickness at the outer tip and 78 % at the inner one.
 */
const BROW_PEAK = -0.3
const BROW_TAPER = 0.75

/**
 * How the eye's own expression terms drive the brow's tilt.
 *
 * The brow is **not** authored per style: ten authored brows would drift from
 * the ten eyes they sit over, and the drift would be invisible in code. It is
 * derived from the two terms that already say what the face is doing, with the
 * signs that make a scowl scowl: `lidSlant` is positive when the lid drops
 * toward the nose, and a brow doing the same lifts its *outer* end, which is
 * what `roll` also does. So both coefficients are positive and the two compound
 * on `sharp` (+0.27 rad) and on `soft` (−0.21) rather than cancelling.
 */
const BROW_TILT_FROM_SLANT = 0.55
const BROW_TILT_FROM_ROLL = 0.5

interface BrowPlacement {
  /** Lateral offset of the brow's centre from the midline. */
  x: number
  /** Height of the brow's centre line, in the face frame. */
  y: number
  halfWidth: number
  /** Radians; positive lifts the end away from the nose. Mirrored per side. */
  tilt: number
}

/**
 * A brow, from the eye it belongs to.
 *
 * `y` is the smaller of two constraints and both are real:
 *
 *   * **`BROW_GAP` of clear skin above the lid.** A brow touching the lash line
 *     merges with it into one blob at any distance past a metre, which is the
 *     failure this feature exists to avoid — it would be an eye with a thicker
 *     top edge, i.e. exactly the lid slant that is already there, for 12 more
 *     triangles.
 *   * **`BROW_CEILING` above the topmost vertex**, where "topmost" is the arch
 *     and the half-thickness and the tilt's rise added together. They do not all
 *     peak at the same column, so the sum over-clamps by ~1 mm — deliberately,
 *     because the direction of the error is the safe one and the alternative is
 *     maximising a quadratic to save a millimetre nobody can see.
 *
 * On `bright`, `close` and `tall` the ceiling binds; on the six low-lidded
 * styles the gap does, so a sleepy face keeps a heavy low brow instead of a
 * surprised high one.
 */
const browPlacement = (spec: EyeSpec): BrowPlacement => {
  const halfWidth = spec.halfWidth * BROW_WIDTH_SCALE
  const tilt = BROW_TILT_FROM_SLANT * spec.lidSlant + BROW_TILT_FROM_ROLL * spec.roll
  const rise = halfWidth * Math.abs(Math.sin(tilt)) + BROW_ARCH + BROW_THICKNESS
  // The lid's top at the eye's own centre column, which is where it is highest.
  const lid = spec.y + spec.halfHeight
  const gapLimited = lid + BROW_GAP + BROW_THICKNESS - BROW_ARCH
  return { x: spec.x + BROW_OUT_SHIFT, y: Math.min(gapLimited, BROW_CEILING - rise), halfWidth, tilt }
}

export type MouthStyle = 'smile' | 'neutral' | 'frown' | 'grin' | 'open'

export const MOUTH_STYLES: readonly MouthStyle[] = ['smile', 'neutral', 'frown', 'grin', 'open']

const MOUTH_SPECS: Record<MouthStyle, MouthSpec> = {
  /** The shipped mouth. Must stay exactly these numbers — the default figure is hashed. */
  // `lift` raised 1.5 → 4.5 mm to match the other four. The head's 9-gon has a
  // vertex column running down the front centre line — exactly where a mouth
  // sits — whose facets drop 3.3 mm at 9 mm out and 4.0 mm at 11 mm. At 1.5 mm
  // the ridge came *through* the mouth and split it into two ticks with an 8 mm
  // bright notch, on every character that has ever shipped. The byte-identity
  // hash in `characterVariants.test.ts` was re-baselined for this deliberately:
  // it guards against accidental drift, not against fixing a visible defect,
  // and the change moves positions only — counts, normals, colours, indices and
  // weights are untouched.
  smile: { y: -0.14, halfWidth: 0.024, thickness: 0.0075, taper: 0.8, smile: 0.008, darken: 0, lift: 0.0045 },
  /**
   * Level corners, and *thicker* than the shipped smile with a much weaker
   * taper — 7 mm of ink at the corners against `smile`'s 3.
   *
   * Rendered at 1.3 m before and after: at the shipped taper a level mouth has
   * no corners left to be level *with*, and reads as a scratch under the nose
   * rather than as a mouth. A smile can afford the taper because its corners
   * are doing something; a straight line cannot.
   */
  neutral: { y: -0.14, halfWidth: 0.027, thickness: 0.0085, taper: 0.6, smile: 0, darken: 0, lift: 0.0045 },
  /** Corners 11.5 mm down and the whole mouth 5 mm up, which is what stops it reading as a chin. */
  frown: { y: -0.135, halfWidth: 0.024, thickness: 0.008, taper: 0.65, smile: -0.0115, darken: 0, lift: 0.0045 },
  /** 66 mm wide: the widest silhouette here, and one of only two mouths that still read at 8 m. */
  grin: { y: -0.138, halfWidth: 0.033, thickness: 0.0075, taper: 0.78, smile: 0.013, darken: 0, lift: 0.0045 },
  /** 36 × 25 mm of near-lens: a cavity, not a line. See `darken`. */
  open: { y: -0.142, halfWidth: 0.018, thickness: 0.0125, taper: 0.8, smile: 0, darken: 0.35, lift: 0.0045 }
}

/**
 * ─── The face's blocks, in the order they are emitted ───────────────────────
 *
 * Written out because three suites locate features by arithmetic on these — the
 * face is appended last, so it is `position.count − FACE_VERTICES`, and the
 * mouth used to be "the last eight". It is not the last eight any more (the
 * brows are), and a literal 8 in a test would have gone on passing while
 * measuring a brow.
 *
 * The order is eyes → mouth → **brows last**, and that is the cheap half of the
 * decision: it leaves the eye block at offset 0 where every existing assertion
 * about eyes already looks.
 */
export const EYE_VERTICES = 2 * (EYE_SEGMENTS + 1 + 4 + 4)
export const MOUTH_VERTICES = MOUTH_COLUMNS * 2
export const BROW_VERTICES = 2 * BROW_COLUMNS * 2

export const EYE_TRIANGLES = 2 * (EYE_SEGMENTS + 2 + 2)
export const MOUTH_TRIANGLES = (MOUTH_COLUMNS - 1) * 2
export const BROW_TRIANGLES = 2 * (BROW_COLUMNS - 1) * 2

/**
 * Triangles the face adds to the figure, **the same for every style** — see the
 * topology note in the header.
 *
 * 50 now, against the 38 that shipped before the brows: 906 body + 50 = 956 on
 * the shipped bowl cut and 1016 in the worst case, against `CHIBI_BUDGET`'s
 * 1060 (GDD §4.1). Because the count does not depend on the style, that worst
 * case is the worst case over all 240 (eye × mouth × hair × head) combinations,
 * not over the one a test happened to build.
 */
export const FACE_TRIANGLES = EYE_TRIANGLES + MOUTH_TRIANGLES + BROW_TRIANGLES
export const FACE_VERTICES = EYE_VERTICES + MOUTH_VERTICES + BROW_VERTICES

/** Derived once. Never mutated — the palette's `Color`s must not be. */
const SCLERA_COLOR = C.eyeLight.clone().lerp(C.eyeDark, SCLERA_MIX)

/**
 * One colour per mouth style, derived once at module load.
 *
 * `darken === 0` returns the palette entry itself rather than a clone of it, so
 * the four line mouths are bit-for-bit `faceLine` and the suite that counts
 * `faceLine` vertices keeps meaning what it says.
 */
const MOUTH_COLORS: Record<MouthStyle, Color> = (() => {
  const out = {} as Record<MouthStyle, Color>
  for (const style of MOUTH_STYLES) {
    const { darken } = MOUTH_SPECS[style]
    out[style] = darken === 0 ? C.faceLine : C.faceLine.clone().lerp(C.eyeDark, darken)
  }
  return out
})()

/** Eyes and mouth together. The whole of what a character's face can vary by. */
export interface FaceStyle {
  eyes: EyeStyle
  mouth: MouthStyle
  /**
   * Brow albedo — the character's **hair** colour, darkened and then guaranteed
   * to clear the skin under it (`variants.browColour`).
   *
   * It arrives from outside rather than being derived here for the same reason
   * the eye and mouth styles do: this file knows nothing about appearance, and
   * importing `variants.ts` would close a cycle (`variants` imports `HEAD` from
   * here). `chibiGeometry` owns both and hands it over.
   *
   * The fallback is `faceLine`, the fixed dark neutral the mouth uses. That is
   * the honest answer for a caller with no appearance to derive from — a
   * paper-doll preview or a test — and it is legible on four of the five skin
   * tones, which is exactly why the derived colour exists.
   */
  brow?: Color
}

/** The shipped face. `bright` + `smile` must reproduce the hashed default figure. */
export const DEFAULT_FACE: FaceStyle = { eyes: 'bright', mouth: 'smile' }

/**
 * Style lookups that survive a save file written by an older build.
 *
 * An appearance can arrive from `localStorage` or a platform cloud store, where
 * the type system stopped applying the moment it was serialised. A missing style
 * falls back to the shipped one rather than throwing on `undefined.halfWidth`
 * three frames into a scene.
 */
const eyeSpec = (style: EyeStyle): EyeSpec => EYE_SPECS[style] ?? EYE_SPECS.bright
const mouthSpec = (style: MouthStyle): MouthSpec => MOUTH_SPECS[style] ?? MOUTH_SPECS.smile
const mouthColor = (style: MouthStyle): Color => MOUTH_COLORS[style] ?? MOUTH_COLORS.smile

const HEAD_CENTRE = new Vector3(HEAD.centre[0], HEAD.centre[1], HEAD.centre[2])
const WORLD_UP = new Vector3(0, 1, 0)

/**
 * The head's real triangles, built by the same call `chibiGeometry` makes.
 *
 * Lazy and shared: `buildChibiGeometry` runs once per character and the head is
 * identical every time.
 */
let headSurface: LimbMesh | null = null
const headMesh = (): LimbMesh => {
  if (!headSurface) {
    headSurface = limbMesh({
      from: new Vector3(HEAD.centre[0], HEAD.centre[1], HEAD.centre[2]),
      to: new Vector3(HEAD.top[0], HEAD.top[1], HEAD.top[2]),
      radiusStart: HEAD.radius,
      radiusEnd: HEAD.radius,
      radial: HEAD.radial,
      rings: HEAD.rings,
      capRings: HEAD.capRings,
      crossSection: [1, HEAD.widthScale]
    })
  }
  return headSurface
}

/** A tangent basis on the head's surface, in the *sphere* parameter space. */
interface SurfaceFrame {
  dir: Vector3
  right: Vector3
  up: Vector3
  /** Radians this frame has been rolled about `dir` by, so `emit` can match it. */
  roll: number
}

const makeFrame = (): SurfaceFrame => ({ dir: new Vector3(), right: new Vector3(), up: new Vector3(), roll: 0 })

const setFrame = (frame: SurfaceFrame, dir: Vector3): SurfaceFrame => {
  frame.dir.copy(dir).normalize()
  frame.right.crossVectors(WORLD_UP, frame.dir).normalize()
  frame.up.crossVectors(frame.dir, frame.right).normalize()
  frame.roll = 0
  return frame
}

const _rolled = new Vector3()

/**
 * Rotates a frame about its own normal — the eye tilt.
 *
 * Rolling the *frame* rather than the coordinates keeps the eye's rim, its
 * catchlight and its lower lid on one rigid body: tilting them independently is
 * how a highlight ends up outside the lid it belongs to.
 *
 * One approximation lives here. `walk` divides the lateral step by the head's
 * 0.94 cross-section, which is only the right correction while `right` is the
 * world-x-ish axis it was written for; a rolled frame mixes a little of that
 * factor into the vertical. Bounded by `(1/0.94 − 1)·sin(roll)` — 1.1 % of an
 * offset at the largest roll in the table, so under half a millimetre on a 43 mm
 * half-height. Not worth an anisotropic exponential map.
 *
 * A zero roll returns untouched, so the default figure never enters this path.
 */
const rollFrame = (frame: SurfaceFrame, angle: number): SurfaceFrame => {
  if (angle === 0) {
    return frame
  }
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  _rolled.copy(frame.right)
  frame.right.multiplyScalar(cos).addScaledVector(frame.up, sin)
  frame.up.multiplyScalar(cos).addScaledVector(_rolled, -sin)
  frame.roll = angle
  return frame
}

const _walkAxis = new Vector3()

/**
 * Steps `(dx, dy)` metres across the head from a frame — the exponential map.
 *
 * Arc-length-correct rather than a tangent-plane projection, so an authored
 * 66 mm eye is 66 mm of head and not 62. The lateral step is pre-divided by the
 * cross-section because the sphere parameter it becomes is scaled by 0.94 on the
 * way to the ellipsoid.
 */
const walk = (frame: SurfaceFrame, dx: number, dy: number, out: Vector3): Vector3 => {
  const ax = dx / (HEAD.widthScale * HEAD.radius)
  const ay = dy / HEAD.radius
  const angle = Math.hypot(ax, ay)
  if (angle < 1e-9) {
    return out.copy(frame.dir)
  }
  _walkAxis
    .set(0, 0, 0)
    .addScaledVector(frame.right, ax / angle)
    .addScaledVector(frame.up, ay / angle)
  return out.copy(frame.dir).multiplyScalar(Math.cos(angle)).addScaledVector(_walkAxis, Math.sin(angle)).normalize()
}

/**
 * The head's shading normal for a sphere direction — the reciprocal-cross-section
 * rule from `limbMesh`, and provably the same vector it writes: its profile
 * normal for the lower cap is `(sin/0.94, s/r, cos)`, which is this.
 */
const surfaceNormal = (dir: Vector3, out: Vector3): Vector3 =>
  out.set(dir.x / HEAD.widthScale, dir.y, dir.z).normalize()

const _ray = new Ray()
const _hit = new Vector3()
const _triA = new Vector3()
const _triB = new Vector3()
const _triC = new Vector3()

/**
 * Where a sphere direction meets the head's **built** surface.
 *
 * Radial from the cap centre, back-face test disabled because the ray starts
 * inside and leaves through the inward side of a front face.
 */
/**
 * The head part's `along` parameter at the last `castToHead` hit.
 *
 * This is the whole of how the face gets its skin weights, and it exists because
 * the obvious answer is wrong. Weighting the face 1.0 to `head` sounds like what
 * "the face is part of the head" means — but the *skull it is glued to* is not
 * weighted that way. `chibiGeometry` ramps the head part toward `neck` over the
 * first 30 % of its axis, and the head's lower cap, which is exactly where a face
 * sits, is inside that ramp at a full 50/50 split.
 *
 * So a weight-1 face and the skull under it rotate by different amounts the
 * instant the head bone moves, and `poses.ts` moves it constantly — gait
 * counter-roll, turn lean, jump crouch, idle sway. Measured before this was
 * threaded through: **49.6 mm of slide at 25° of head yaw**, on a 250 mm head.
 * The eyes swim across the face.
 *
 * Interpolating the hit triangle's own `along` and running it through the body's
 * blend makes a face vertex adopt the exact binding of the surface it is resting
 * on, so the two are rigid with respect to each other by construction rather than
 * by a tolerance.
 */
let _hitAlong = 0

const _bary = new Vector3()

/** Barycentric coordinates of `p` in triangle (a, b, c), assuming `p` is on it. */
const barycentric = (p: Vector3, a: Vector3, b: Vector3, c: Vector3, out: Vector3): Vector3 => {
  const v0x = b.x - a.x
  const v0y = b.y - a.y
  const v0z = b.z - a.z
  const v1x = c.x - a.x
  const v1y = c.y - a.y
  const v1z = c.z - a.z
  const v2x = p.x - a.x
  const v2y = p.y - a.y
  const v2z = p.z - a.z
  const d00 = v0x * v0x + v0y * v0y + v0z * v0z
  const d01 = v0x * v1x + v0y * v1y + v0z * v1z
  const d11 = v1x * v1x + v1y * v1y + v1z * v1z
  const d20 = v2x * v0x + v2y * v0y + v2z * v0z
  const d21 = v2x * v1x + v2y * v1y + v2z * v1z
  const denominator = d00 * d11 - d01 * d01
  if (Math.abs(denominator) < 1e-12) {
    return out.set(1, 0, 0)
  }
  const v = (d11 * d20 - d01 * d21) / denominator
  const w = (d00 * d21 - d01 * d20) / denominator
  return out.set(1 - v - w, v, w)
}

const castToHead = (dir: Vector3, out: Vector3): Vector3 => {
  const mesh = headMesh()
  out.set(HEAD.widthScale * HEAD.radius * dir.x, HEAD.radius * dir.y, HEAD.radius * dir.z).add(HEAD_CENTRE)
  _ray.origin.copy(HEAD_CENTRE)
  _ray.direction.copy(out).sub(HEAD_CENTRE).normalize()

  let best = Infinity
  for (let i = 0; i < mesh.index.length; i += 3) {
    const ia = mesh.index[i]!
    const ib = mesh.index[i + 1]!
    const ic = mesh.index[i + 2]!
    _triA.fromArray(mesh.position, ia * 3)
    _triB.fromArray(mesh.position, ib * 3)
    _triC.fromArray(mesh.position, ic * 3)
    if (_ray.intersectTriangle(_triA, _triB, _triC, false, _hit)) {
      const distance = _hit.distanceToSquared(HEAD_CENTRE)
      if (distance < best) {
        best = distance
        out.copy(_hit)
        barycentric(_hit, _triA, _triB, _triC, _bary)
        _hitAlong = _bary.x * mesh.along[ia]! + _bary.y * mesh.along[ib]! + _bary.z * mesh.along[ic]!
      }
    }
  }
  if (!Number.isFinite(best)) {
    throw new Error('[face] a feature vertex missed the head — the head spec in face.ts has drifted')
  }
  return out
}

interface Builder {
  position: number[]
  normal: number[]
  color: number[]
  /** The head part's `along` under each vertex — see `_hitAlong`. */
  along: number[]
  index: number[]
}

const _dir = new Vector3()
const _point = new Vector3()
const _headNormal = new Vector3()
const _normal = new Vector3()
const _localFrame = makeFrame()

/**
 * Writes one face vertex and returns its index.
 *
 * `slopeX/slopeY` are the feature's height-field gradient in its own tangent
 * plane, in metres per metre. Zero is a decal; non-zero tilts the normal the way
 * a dome would, before the blend flattens most of it back into the skull. The
 * local frame is rolled to match the feature's, or a tilted eye's dome would
 * shade as if it were not tilted.
 */
const emit = (
  builder: Builder,
  frame: SurfaceFrame,
  dx: number,
  dy: number,
  lift: number,
  slopeX: number,
  slopeY: number,
  color: Color
): number => {
  walk(frame, dx, dy, _dir)
  surfaceNormal(_dir, _headNormal)
  rollFrame(setFrame(_localFrame, _dir), frame.roll)

  _normal
    .copy(_headNormal)
    .addScaledVector(_localFrame.right, -slopeX)
    .addScaledVector(_localFrame.up, -slopeY)
    .normalize()
    .lerp(_headNormal, FACE_NORMAL_BLEND)
    .normalize()

  castToHead(_dir, _point).addScaledVector(_headNormal, lift)

  const index = builder.position.length / 3
  builder.position.push(_point.x, _point.y, _point.z)
  builder.normal.push(_normal.x, _normal.y, _normal.z)
  builder.color.push(color.r, color.g, color.b)
  // Recorded by the cast above, so the vertex carries the skull's own binding
  // rather than a guess about which bone a face "belongs" to.
  builder.along.push(_hitAlong)
  return index
}

interface Lens {
  lift: number
  slopeX: number
  slopeY: number
}

const _lens: Lens = { lift: 0, slopeX: 0, slopeY: 0 }

/**
 * The eye's dome, evaluated in the eye's own tangent plane.
 *
 * `h(s) = lift + bulge·(1 − s²)` with `s` the superellipse radial parameter, so
 * the apex is at the centre and the rim lands exactly on `EYE_LIFT`. The
 * gradient is the closed form — `dh/ds = −2·bulge·s`, projected onto the spoke —
 * so nothing here is differenced and nothing depends on the tessellation.
 *
 * A slanted lid is the one place `s` reads below 1 at the rim, because the lid
 * scale shortens the vertex without changing the superellipse it is measured
 * against. The dome therefore does not quite close along a slanted lid: at the
 * strongest slant in the table the rim sits 0.6 mm proud instead of 0. That is
 * an eyelid's worth of thickness on a 34 mm eye and is left alone deliberately —
 * correcting it would mean carrying the pre-slant coordinate through four call
 * sites to hide half a millimetre.
 */
const lensAt = (spec: EyeSpec, dx: number, dy: number, out: Lens): Lens => {
  const s = Math.min(
    1,
    Math.pow(
      Math.pow(Math.abs(dx) / spec.halfWidth, spec.exponent) + Math.pow(Math.abs(dy) / spec.halfHeight, spec.exponent),
      1 / spec.exponent
    )
  )
  out.lift = EYE_LIFT + EYE_BULGE * (1 - s * s)
  const radiusSq = dx * dx + dy * dy
  if (radiusSq < 1e-12) {
    out.slopeX = 0
    out.slopeY = 0
    return out
  }
  const k = (-2 * EYE_BULGE * s * s) / radiusSq
  out.slopeX = k * dx
  out.slopeY = k * dy
  return out
}

/**
 * Quad corners, counter-clockwise from outside: BL, BR, TR, TL — authored
 * **outward-signed**, so `+x` is away from the nose on either eye.
 *
 * The left eye reads the corner list with the two vertices of each row swapped.
 * That is not a flourish: mirroring x reverses the cycle and would wind the quad
 * inward, which under `FrontSide` deletes the catchlight and under the outline's
 * `BackSide` replaces it with a solid plate. Swapping within rows reverses the
 * cycle back, and does it without changing which corner is emitted first — so
 * the shipped figure's vertex order, which is hashed, is untouched.
 */
const addLensQuad = (
  builder: Builder,
  frame: SurfaceFrame,
  spec: EyeSpec,
  side: 1 | -1,
  corners: readonly (readonly [number, number])[],
  color: Color,
  epsilon: number
): void => {
  const v: number[] = []
  for (let i = 0; i < corners.length; i++) {
    const corner = corners[side > 0 ? i : i ^ 1]!
    const dx = side * corner[0]
    const dy = corner[1]
    lensAt(spec, dx, dy, _lens)
    v.push(emit(builder, frame, dx, dy, _lens.lift + epsilon, _lens.slopeX, _lens.slopeY, color))
  }
  builder.index.push(v[0]!, v[1]!, v[2]!, v[0]!, v[2]!, v[3]!)
}

const _faceFrame = makeFrame()
const _eyeFrame = makeFrame()
const _mouthFrame = makeFrame()
const _anchor = new Vector3()

const addEye = (builder: Builder, spec: EyeSpec, side: 1 | -1): void => {
  setFrame(_eyeFrame, walk(_faceFrame, side * spec.x, spec.y, _anchor))
  // Mirrored, so an upturned eye is upturned on both sides. Rolling both frames
  // the same way would tilt the face instead, which reads as a broken neck.
  rollFrame(_eyeFrame, side * spec.roll)

  const power = 2 / spec.exponent
  const lidDrop = Math.abs(spec.lidSlant)
  const lidSide = Math.sign(spec.lidSlant)

  const centre = emit(builder, _eyeFrame, 0, 0, EYE_LIFT + EYE_BULGE, 0, 0, C.eyeDark)
  const rim: number[] = []
  for (let i = 0; i < EYE_SEGMENTS; i++) {
    const phi = (i / EYE_SEGMENTS) * Math.PI * 2
    const sin = Math.sin(phi)
    const cos = Math.cos(phi)
    // Unit superellipse coordinates. `u` is frame-local and identical on both
    // eyes; `outward` is the same number signed away from the nose, and only the
    // asymmetric terms are allowed to see it. See the mirroring note in the
    // header — this is what makes vertex `i` on one eye the mirror of
    // `(12 − i) mod 12` on the other without reordering anything.
    const u = Math.sign(sin) * Math.pow(Math.abs(sin), power)
    const v = Math.sign(cos) * Math.pow(Math.abs(cos), power)
    const outward = side * u
    // Upper lid only, and scaled by at most 1 so no style rises above `bright`.
    const lid = v > 0 ? 1 - lidDrop * (1 - lidSide * outward) * 0.5 : 1
    const dx = spec.halfWidth * u
    const dy = spec.halfHeight * v * lid
    lensAt(spec, dx, dy, _lens)
    rim.push(emit(builder, _eyeFrame, dx, dy, _lens.lift, _lens.slopeX, _lens.slopeY, C.eyeDark))
  }
  for (let i = 0; i < EYE_SEGMENTS; i++) {
    // The rim runs top → +x → bottom, which is clockwise seen from outside, so
    // the fan's last two corners are swapped to keep the patch front-facing.
    // Get this wrong and the eye vanishes under `FrontSide` and *reappears* in
    // the outline pass as a solid dark plate. It holds for the mirrored eye too:
    // `dx` is the same sequence there, so the traversal is the same direction.
    builder.index.push(centre, rim[(i + 1) % EYE_SEGMENTS]!, rim[i]!)
  }

  // The two sub-features ride the eye's size rather than being authored per
  // style: a slit with a bead's catchlight is a slit with a highlight hanging
  // out of it.
  const wide = spec.halfWidth / EYE_REFERENCE.halfWidth
  const high = spec.halfHeight / EYE_REFERENCE.halfHeight

  const catchX = CATCH_X * wide
  const catchY = CATCH_Y * high
  const catchW = CATCH_HALF_WIDTH * wide
  const catchH = CATCH_HALF_HEIGHT * high
  addLensQuad(
    builder,
    _eyeFrame,
    spec,
    side,
    [
      [catchX - catchW, catchY - catchH],
      [catchX + catchW, catchY - catchH],
      [catchX + catchW, catchY + catchH],
      [catchX - catchW, catchY + catchH]
    ],
    C.eyeLight,
    CATCH_LIFT
  )

  const scleraY = SCLERA_Y * high
  const scleraTop = SCLERA_HALF_WIDTH_TOP * wide
  const scleraBottom = SCLERA_HALF_WIDTH_BOTTOM * wide
  const scleraH = SCLERA_HALF_HEIGHT * high
  addLensQuad(
    builder,
    _eyeFrame,
    spec,
    side,
    [
      [-scleraBottom, scleraY - scleraH],
      [scleraBottom, scleraY - scleraH],
      [scleraTop, scleraY + scleraH],
      [-scleraTop, scleraY + scleraH]
    ],
    SCLERA_COLOR,
    SCLERA_LIFT
  )
}

const addMouth = (builder: Builder, spec: MouthSpec, color: Color): void => {
  setFrame(_mouthFrame, walk(_faceFrame, 0, spec.y, _anchor))

  const top: number[] = []
  const bottom: number[] = []
  for (let i = 0; i < MOUTH_COLUMNS; i++) {
    const t = (i / (MOUTH_COLUMNS - 1)) * 2 - 1
    const dx = t * spec.halfWidth
    // Quadratic in `t`, so the corners carry the expression and the middle stays
    // put. Symmetric by construction — the suite asserts the face is.
    const centre = spec.smile * t * t
    const half = spec.thickness * (1 - spec.taper * t * t)
    top.push(emit(builder, _mouthFrame, dx, centre + half, spec.lift, 0, 0, color))
    bottom.push(emit(builder, _mouthFrame, dx, centre - half, spec.lift, 0, 0, color))
  }
  for (let i = 0; i < MOUTH_COLUMNS - 1; i++) {
    builder.index.push(bottom[i]!, bottom[i + 1]!, top[i + 1]!, bottom[i]!, top[i + 1]!, top[i]!)
  }
}

const _browFrame = makeFrame()

/**
 * One brow, on `side`.
 *
 * A 3-quad strip like the mouth, and for the same reason: the taper *is* the
 * feature. A constant-width bar over an eye reads as a censor stripe. What
 * differs from the mouth is that a brow is **asymmetric** — thick at the inner
 * third, a needle at the outer tip — so the shape terms are functions of
 * `outward` (the header's mirroring convention) while the coordinate handed to
 * `emit` stays frame-local. That keeps the column order, and therefore the
 * winding, identical on both sides: `dx` increases with `i` on either eye, so
 * the same index push that winds the mouth outward winds this outward too.
 *
 * The tilt is applied by **rolling the frame**, mirrored per side, exactly as
 * the eye's own roll is. Tilting the coordinates instead would tilt both brows
 * the same way in the world, which reads as a head tilt rather than as a face.
 */
const addBrow = (builder: Builder, place: BrowPlacement, side: 1 | -1, color: Color): void => {
  setFrame(_browFrame, walk(_faceFrame, side * place.x, place.y, _anchor))
  rollFrame(_browFrame, side * place.tilt)

  const top: number[] = []
  const bottom: number[] = []
  for (let i = 0; i < BROW_COLUMNS; i++) {
    const u = (i / (BROW_COLUMNS - 1)) * 2 - 1
    const outward = side * u
    const dx = u * place.halfWidth
    // Arch: a rise in the middle over the straight line the tilt already draws.
    const centre = BROW_ARCH * (1 - u * u)
    // Thickness peaks at the inner third and tapers to a point outward. The
    // divisor normalises the parabola so its far end is exactly `BROW_TAPER`.
    const offset = (outward - BROW_PEAK) / (1 + Math.abs(BROW_PEAK))
    const half = BROW_THICKNESS * (1 - BROW_TAPER * offset * offset)
    top.push(emit(builder, _browFrame, dx, centre + half, BROW_LIFT, 0, 0, color))
    bottom.push(emit(builder, _browFrame, dx, centre - half, BROW_LIFT, 0, 0, color))
  }
  for (let i = 0; i < BROW_COLUMNS - 1; i++) {
    builder.index.push(bottom[i]!, bottom[i + 1]!, top[i + 1]!, bottom[i]!, top[i + 1]!, top[i]!)
  }
}

export interface FaceMesh {
  position: Float32Array
  normal: Float32Array
  color: Float32Array
  /** The head part's `along` under each vertex, for the skin blend. */
  along: Float32Array
  index: Uint16Array
}

/** The face on its own, for tests and for anything that wants to inspect it. */
export const faceMesh = (style: FaceStyle = DEFAULT_FACE): FaceMesh => {
  const builder: Builder = { position: [], normal: [], color: [], along: [], index: [] }
  const eyes = eyeSpec(style.eyes)

  // The face looks down +Z: the rig faces +Z (see `Character.measureMotion`).
  setFrame(_faceFrame, _anchor.set(0, 0, 1))

  addEye(builder, eyes, 1)
  addEye(builder, eyes, -1)
  addMouth(builder, mouthSpec(style.mouth), mouthColor(style.mouth))

  // Last, so the mouth keeps the block position three suites already locate it
  // at, and so `BROW_VERTICES` is the only arithmetic a caller needs to skip
  // them. Both brows are derived from the one eye spec — see `browPlacement`.
  const brow = browPlacement(eyes)
  const browColor = style.brow ?? C.faceLine
  addBrow(builder, brow, 1, browColor)
  addBrow(builder, brow, -1, browColor)

  return {
    position: new Float32Array(builder.position),
    normal: new Float32Array(builder.normal),
    color: new Float32Array(builder.color),
    along: new Float32Array(builder.along),
    index: new Uint16Array(builder.index)
  }
}

export interface FaceSink {
  positions: number[]
  normals: number[]
  colors: number[]
  skinIndices: number[]
  skinWeights: number[]
  indices: number[]
  /** Index of `head` in `BONE_NAMES`. */
  headBone: number
  /** Index of `neck`, the head part's parent — the face shares its joint blend. */
  neckBone: number
  /** The body's joint-blend width, so the face cannot drift from it. */
  jointBlend: number
  /**
   * The character's face style. Both optional and both defaulting to the shipped
   * face, so a caller that has not been taught about styles yet keeps building
   * the figure it always did — including, byte for byte, the hashed default.
   */
  eyes?: EyeStyle
  mouth?: MouthStyle
  /** Brow albedo — see `FaceStyle.brow`. Defaults to `faceLine`. */
  brow?: Color
}

/**
 * Appends the face to a chibi geometry under construction.
 *
 * **The face adopts the skull's binding, it does not assert its own.** Weight 1
 * to `head` is the intuitive choice and it is wrong: the head part's lower cap —
 * the whole of where a face sits — is inside the ramp toward `neck` at up to a
 * 50/50 split, so a rigid face and the surface beneath it separate the instant
 * the head bone turns. `poses.ts` turns it on every frame of every state.
 *
 * Measured with weight 1: **49.6 mm of slide at 25° of head yaw** on a 250 mm
 * head — the eyes swim across the face. Running the ray-cast's own interpolated
 * `along` through the same blend the body uses drops it to zero by construction.
 * The style has no bearing on any of that: every style casts onto the same skull
 * and inherits whatever it is resting on.
 */
export const appendFace = (sink: FaceSink): void => {
  const face = faceMesh({
    eyes: sink.eyes ?? DEFAULT_FACE.eyes,
    mouth: sink.mouth ?? DEFAULT_FACE.mouth,
    brow: sink.brow
  })
  const base = sink.positions.length / 3
  const count = face.position.length / 3

  for (let i = 0; i < count; i++) {
    sink.positions.push(face.position[i * 3]!, face.position[i * 3 + 1]!, face.position[i * 3 + 2]!)
    sink.normals.push(face.normal[i * 3]!, face.normal[i * 3 + 1]!, face.normal[i * 3 + 2]!)
    sink.colors.push(face.color[i * 3]!, face.color[i * 3 + 1]!, face.color[i * 3 + 2]!)

    // The head part's own rule, verbatim: below `jointBlend` the weight ramps
    // toward the parent, reaching an even split at the joint. The head's `to` is
    // an explicit vector so it has no child, which is why only the parent branch
    // exists here — a face vertex is never past the far end.
    const t = face.along[i]!
    let otherWeight = 0
    if (t < sink.jointBlend) {
      const k = Math.max(0, t) / sink.jointBlend
      otherWeight = 0.5 * (1 - k * k * (3 - 2 * k))
    }
    sink.skinIndices.push(sink.headBone, sink.neckBone, 0, 0)
    sink.skinWeights.push(1 - otherWeight, otherWeight, 0, 0)
  }

  for (const value of face.index) {
    sink.indices.push(base + value)
  }
}
