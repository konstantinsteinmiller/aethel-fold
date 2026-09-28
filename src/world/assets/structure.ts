import { type BufferGeometry, Color, DoubleSide, Vector3 } from 'three'
import { assertTriBudget } from '../geometry/budget'
import { makeRng, type Rng } from '../geometry/rng'
import { paintWindWeight } from '../geometry/build'
import { paintPart, type Section, splineAt, splineSection, sweep, type SweptPart } from '../geometry/sweep'
import { bakeVertexAO } from '../geometry/vertexAO'
import { applyVertexAO, jitterColor } from '../geometry/vertexColor'
import { createOutlineMaterial } from '../shading/outlineMaterial'
import { makeToonRamp, type RampStop } from '../shading/ramp'
import { createToonMaterial, type ToonMaterial } from '../shading/toonMaterial'
import { C } from '../art/palette'
import { measuredRadius, mergeParts, partRanges } from './common'
import { assertFiniteGeometry } from './plateau'
import type { WorldAsset } from './types'

/**
 * ─── The built world: houses, palisades, bridges, carts ─────────────────────
 *
 * The village is the first thing in this project that is **built** rather than
 * grown or eroded, and it needs a different kit from either. `plateau.ts` lofts
 * a surface of revolution, which is right for a rock and useless for a roof;
 * `chibiGeometry.ts` skins a rig, which is right for a person and useless for a
 * fence. What a village is made of is *members* — a post, a beam, a stake, a
 * plank, a rafter — and every one of them is a section swept along a short
 * path, which is exactly the primitive `geometry/sweep.ts` already provides.
 *
 * So this file is not a new geometry kernel. It is a **spec format** on top of
 * that primitive, plus the one thing the sweep does not do for itself: turn a
 * list of members into a four-tier LOD ladder that satisfies the GDD's
 * crossfade contract.
 *
 * ── What a building costs in draw calls ─────────────────────────────────────
 *
 * Zero, per building. A `WorldAsset` is **one merged geometry per tier and one
 * shared material** (`createStructureMaterial` hands out three for the whole
 * village), and `level/PlacementBatcher.ts` batches every placement of a given
 * `defId` into one `InstancedLodField`. A field draws one `InstancedMesh` per
 * *tier that has members*, plus an outline mesh for LOD0 and LOD1 (GDD R6).
 *
 * Measured by driving a field directly, twenty cottages in one cell:
 *
 * | camera | mesh draws | outline draws | total |
 * |---|---:|---:|---:|
 * | 12 m (all LOD0) | 1 | 1 | **2** |
 * | 30 m (LOD0→LOD1 band) | 2 | 2 | **4** |
 * | 60 m (all LOD1) | 1 | 1 | **2** |
 * | 100 m (LOD1→LOD2 band) | 2 | 1 | **3** |
 * | 200 m (all LOD3) | 1 | 0 | **1** |
 *
 * Sixty cottages at 40 m measure the same 4 as twenty do. So the number to hold
 * down is the count of *house types*, not of houses — and it is why a second
 * cottage is a second `seed` on the same generator (`house-cottage-b`) rather
 * than a second shape.
 *
 * ── What is geometry and what is paint ──────────────────────────────────────
 *
 * This is the decision that sets the whole budget, and it is GDD R1 applied
 * literally: **silhouette is geometry, everything inside the outline is vertex
 * colour.** For a half-timbered village that means
 *
 *   * the roof mass, the wall mass, the chimney, the ridge cap, the eaves bead,
 *     the door and the corner posts are *modelled* — every one of them changes
 *     the outline;
 *   * the daub panels, the plank seams on a door, the courses on a thatch roof
 *     and the char on a burnt beam are *painted*, because none of them changes
 *     the outline and all of them would cost more triangles than the entire
 *     roof.
 *
 * The first pass modelled a full Fachwerk frame — sill, plate, studs, braces —
 * and measured **1 640 triangles for one cottage**, nearly three times the
 * ancient oak, which is the most expensive hand-placed prop in the project. The
 * same house painted reads better at 15 m (the frame is *crisper*, because paint
 * has no bevel to lose) and costs 460.
 *
 * ── Where that rule stops, and the measurement that found the edge ──────────
 *
 * "Paint it" is not free, and the second pass found the price. **Vertex colour
 * cannot express a feature narrower than the vertex spacing**, and a wall's
 * vertex spacing is set by its perimeter. A cottage is 5.4 × 4.0 m — 18.8 m
 * round — so at 16 samples the narrowest paintable vertical is 2.35 m against a
 * real Fachwerk post's 15–20 cm, and buying it down to 1.2 m costs 320
 * triangles. Four *modelled* corner posts cost 64 and are 28 cm.
 *
 * So the split is by **orientation**, not by material:
 *
 *   * **horizontals are paint** — a sill, a mid-rail, a wall plate are functions
 *     of height, and height costs *rings*, at 2 segments' worth of triangles
 *     each. `WALL_RINGS` buys three of them for 40 triangles on a cottage.
 *   * **verticals and diagonals are geometry** — corner posts, studs and braces
 *     have no cheap parameter to ride on, and applied to the wall they also earn
 *     an outline, a real AO line and (at a corner) a real silhouette break.
 *     `flatTimber` builds one for 16 triangles.
 *
 * The first pass's 1 640 came from modelling *both* halves. Doing only the half
 * paint cannot reach costs 192 on a cottage, and it is the difference between a
 * facade and a beige box with lines on it.
 *
 * ── How a tier is made ──────────────────────────────────────────────────────
 *
 * Two levers, applied to the *spec* rather than to the mesh, so every tier is a
 * fresh evaluation of the same shape function — which is the only way the
 * dithered crossfade can hold (GDD §4.3, and `plateau.ts`'s note on why tiers
 * must not be decimations of each other):
 *
 *   1. **Rings and segments come down** by a fixed schedule, with the inscribed
 *      polygon compensated (`INFLATE`) so a coarse tier is the same *size* as
 *      the fine one it fades from. Without that a house visibly shrinks at every
 *      LOD boundary — a section sampled at 5 points encloses 81 % of the area it
 *      does at 12.
 *   2. **Members drop out**, coarsest-first, by their own `lastTier`. A window
 *      frame is gone by LOD1, a chimney survives to LOD3. That is the lever that
 *      actually pays: a cottage is 60 % small members by count and 25 % by
 *      triangle, and dropping them is invisible at the distance the tier is for
 *      while halving its cost.
 *
 * Nothing here is allowed to produce a tier that is *empty*: a member with
 * `lastTier: 3` must exist in every structure, asserted below, or the coarsest
 * tier would be a zero-triangle geometry that the LOD field happily draws as
 * nothing and no test would notice.
 */

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Y = new Vector3(0, 1, 0)
const AXIS_Z = new Vector3(0, 0, 1)

export type Vec3 = readonly [number, number, number]

/**
 * A rounded rectangle, for squared timber.
 *
 * The corner control points sit at ±(1, 1) and the curve falls short of them by
 * about 12 %, which **is** the chamfer a hewn beam has — GDD R2 for free, and
 * cheaper than an authored one because there is no extra ring. The four
 * mid-edge points are what stop it collapsing to an ellipse: without them the
 * section's flats bow and a beam reads as a dowel.
 */
export const BEAM_SECTION: Section = splineSection([
  [1, 0.62],
  [1, 1],
  [0.62, 1],
  [-0.62, 1],
  [-1, 1],
  [-1, 0.62],
  [-1, -0.62],
  [-1, -1],
  [-0.62, -1],
  [0.62, -1],
  [1, -1],
  [1, -0.62]
])

/**
 * A split log: round, with one flat where the axe went through.
 *
 * The palisade is the reason this exists. A palisade of *cylinders* reads as a
 * row of pipes; a palisade of split trunks reads as a wall, and the whole of the
 * difference is that the inner face is flat and catches the light as one band
 * rather than as a gradient.
 */
export const LOG_SECTION: Section = splineSection([
  [1, 0],
  [0.78, 0.78],
  [0, 1],
  [-0.78, 0.78],
  [-0.92, 0],
  [-0.78, -0.78],
  [0, -1],
  [0.78, -0.78]
])

/** A thin slab: a plank, a door, a shutter, a bridge deck. */
export const PLANK_SECTION: Section = splineSection([
  [1, 0.55],
  [1, 1],
  [-1, 1],
  [-1, 0.55],
  [-1, -0.55],
  [-1, -1],
  [1, -1],
  [1, -0.55]
])

/**
 * ─── A wall's plan, and why `BEAM_SECTION` is the wrong one for it ──────────
 *
 * A house wall is the largest flat surface in the village and the only one whose
 * entire content is paint, so where its samples land *is* the facade. Measured
 * on the built mesh, `BEAM_SECTION` at the wall's 10 segments produced this
 * polygon:
 *
 *     (1.000, 0.477) (0.890, 0.968) (0.102, 1.000) (-0.825, 0.986)
 *     (-0.999, 0.622) (-1.000, -0.477) …
 *
 * — which has 180° rotational symmetry and **no mirror symmetry at all**. Not
 * one of its four corners carried a vertex. `BEAM_SECTION` has 12 control
 * points, so its corners (at v = 1/12, 4/12, 7/12, 10/12) are only sampled when
 * the segment count is a multiple of 12; at 10, 8, 6 or 5 the arrises fall
 * between samples and the flats bow. `plateau.ts` measured the general form of
 * this once — a 24 %-deep flute sampled off its arrises delivered 37 % of its
 * depth — and a wall is the same failure at 90°.
 *
 * Sixteen points fixes it for the counts a wall actually uses. Corners sit at
 * indices 2, 6, 10, 14 and face midpoints at 0, 4, 8, 12, so:
 *
 *   * **16 samples** hit every control point;
 *   * **8 samples** hit 0, 2, 4 … 14 — all four corners and all four face
 *     midpoints, a symmetric octagon;
 *   * **12 samples** hit the four face midpoints exactly and straddle each
 *     corner *symmetrically* (at indices 1.33 and 2.67), so the tier is still
 *     mirror-symmetric even though it is not aligned.
 *
 * That is why the wall carries `segmentsByTier: [16, 12, 8, 8]` rather than
 * taking `SEGMENT_SCALE`, which would give 16 / 12 / 10 / 7 — and 10 and 7 are
 * both counts with no mirror symmetry on a 16-point loop.
 *
 * The 0.66 mid-arris points are the bevel (GDD R2): the sampled corner lands at
 * (0.943, 0.943), a 5.7 % chamfer, inside the 2–11 % the rule asks for.
 */
export const WALL_SECTION: Section = splineSection([
  [1, 0],
  [1, 0.66],
  [1, 1],
  [0.66, 1],
  [0, 1],
  [-0.66, 1],
  [-1, 1],
  [-1, 0.66],
  [-1, 0],
  [-1, -0.66],
  [-1, -1],
  [-0.66, -1],
  [0, -1],
  [0.66, -1],
  [1, -1],
  [1, -0.66]
])

/**
 * ─── A square timber, exact at four samples ─────────────────────────────────
 *
 * For the applied frame — corner posts, mid-rails, braces, studs, brackets.
 * There are twelve of them on a cottage and nine on an interior wall, so their
 * segment count is the difference between a frame that fits in the budget and
 * one that does not; four is the floor `MIN_SEGMENTS` allows and a square timber
 * genuinely has four faces.
 *
 * `BEAM_SECTION` cannot be sampled at four. Measured on the built mesh: it comes
 * out as a *diamond* (its vertices land on the mid-edge control points, not the
 * corners) inflated 41 % by `inflateFor(4) = 1/cos(45°)`, so a 14 cm stud
 * arrived 36 cm across the diagonal with its flats at 45° to the wall it is
 * applied to. The inflate is not wrong — it is the inscribed-polygon
 * compensation GDD §4.3 requires, exact for a circle — it is just enormous at
 * four samples, and `BEAM_SECTION`'s own note only ever claimed "under 2 %" for
 * the counts it was designed for.
 *
 * So this section is authored **against** that compensation. The control polygon
 * solves
 *
 *     (4c + d) / 6 · 1/cos(π/4) = 1      →   c = 0.9091, d = 0.6061
 *
 * which puts the four samples exactly on (±1, ±1) after inflation. Verified
 * numerically: at S = 4 the built polygon is (1, 1) (−1, 1) (−1, −1) (1, −1) to
 * six decimals.
 *
 * It is only right at four. Pin `segmentsByTier` to [4, 4, 4, 4] with it — at
 * eight it delivers a 0.765 octagon — which is what `flatTimber` does.
 */
export const TIMBER_SECTION: Section = splineSection([
  [0.909137, 0.909137],
  [0, 0.606091],
  [-0.909137, 0.909137],
  [-0.606091, 0],
  [-0.909137, -0.909137],
  [0, -0.606091],
  [0.909137, -0.909137],
  [0.606091, 0]
])

/**
 * The section parameters of a wall's four corners.
 *
 * Exported because `timberFrame` paints corner posts and has to put them on the
 * corners. It did not: the old paint used `|cos(4πv)|` which peaks at
 * v = 0, ¼, ½, ¾ while `BEAM_SECTION`'s corners are at 1/12, 4/12, 7/12, 10/12 —
 * so every "corner post" in the village was painted in the middle of a *face*,
 * a sixth of the perimeter away from the corner it was named after.
 */
export const WALL_CORNER_V = [2 / 16, 6 / 16, 10 / 16, 14 / 16] as const

/**
 * ─── A thatched roof's cross-section ────────────────────────────────────────
 *
 * Authored as a *section* rather than as two swept planes because a roof is
 * exactly one extrusion along its own ridge, and building it as planes costs
 * two parts, two normal solutions and a seam at the ridge that has to be
 * bevelled by hand. Here the ridge bevel is the spline's own rounding, which is
 * what thatch actually looks like — a straight arris is a *tiled* roof, and
 * the village is thatched.
 *
 * ── Why this list is 24 long and not 16 ─────────────────────────────────────
 *
 * The first pass was a *pitch*: an apex cluster, a straight run of four points
 * per slope, and a chamfered eaves. Measured on the built mesh, it had neither
 * of the two features that make straw read as straw rather than as a folded
 * card:
 *
 *   * **No ridge cap.** The apex was a rounded-over corner. Real thatch carries
 *     a separate *roll* of straw over the ridge, 15–25 cm proud of the coat and
 *     70–90 cm wide, and its lower edge is a hard line across both slopes. That
 *     is the single most recognisable thing about a thatched roof, and it is on
 *     the silhouette from every direction that shows a gable.
 *   * **No eaves bead.** The old eaves point sat at (1.04, −0.12) while the
 *     slope line extrapolated to x = 1.11 at the same height — i.e. the edge was
 *     *inside* the pitch. That is a chamfer, not a bead. Thatch is combed over
 *     the wall plate and its cut ends form a fat roll that overhangs, and the
 *     shadow that roll throws is what plants the building on the ground.
 *
 * Both are pure section work, so they cost segments rather than rings: one
 * triangle row per control point per band. At the ring schedule `ROOF_RINGS`
 * uses that is 10 triangles a point at LOD0 — 80 for the cap and the bead
 * together, which is why `ROOF_RINGS` drops a ring pair to pay for them (see
 * its note). Net at LOD0 the roof got *cheaper*: 252 → 240.
 *
 * ── Reading the numbers ─────────────────────────────────────────────────────
 *
 * Unit section: x is scaled by `halfSpan`, y by `rise`. The coat is the straight
 * plane `y = 0.954 − 0.918x`; every "proud" or "recessed" figure below is signed
 * distance from *that* line, and a cottage multiplies it by rise = 2.15 m.
 *
 * Index 1 is the apex and `roof()` sets `vOffset = 1 / 24` so the section's
 * first *sample* lands exactly on it, at any segment count. The old code said
 * `vOffset: 1/18` for a 16-point list, which put the ridge sample at
 * (−0.008, 0.995) — 0.8 % off-centre and 0.5 % low. It never showed because the
 * apex cluster is three points wide, but it made the roof imperceptibly
 * asymmetric and the comment claiming "one sample per control point" false.
 */
const THATCH_POINTS: readonly (readonly [number, number])[] = [
  // ── The ridge cap ────────────────────────────────────────────────────────
  //
  // The apex is a *cluster* of three inside 10 % of the span. The first pass
  // authored a single apex point and the B-spline rounded it away completely:
  // every house in the village came out a **dome**, which is a legitimate
  // building and not the one that was asked for. A closed cubic B-spline
  // approximates, so an apex is a cluster — exactly the argument `CAP_T` makes
  // for a beam's end, arrived at from the other direction.
  //
  // Measured on the **built cottage mesh**, at the ring in the middle of the
  // ridge, against the plane fitted through the coat's own rows: the cap stands
  // 9.8 cm proud at the apex, 13.4 cm at the shoulder, 13.7 cm at the flank and
  // 8.1 cm where its edge face starts, and its lower edge lands back on the coat
  // to within 3 mm. It is 0.89 m wide across the ridge — a real ridge roll.
  [-0.052, 0.985],
  [0.0, 1.035],
  [0.052, 0.985],
  [0.112, 0.938],
  // The cap's edge: 7 cm of x for 7 cm of y, i.e. a near-vertical cut face.
  // Two points rather than one, because a single point is a corner the spline
  // rounds away — the same failure as the apex, one order smaller.
  [0.158, 0.868],
  [0.172, 0.796],
  // ── The coat ─────────────────────────────────────────────────────────────
  //
  // Three points, alternately 2.4 % of the rise proud of and recessed from the
  // coat plane. That is the *course lap* — one row of straw overlapping the one
  // below — and it is geometry rather than paint because paint cannot carry it:
  // a course period finer than the vertex spacing aliases, and it aliases to a
  // *different* pattern in every tier, which is exactly the shading flip GDD R7
  // says a crossfade cannot hide. Here the lap is a control point, so all four
  // tiers evaluate the same shape and agree.
  //
  // A closed cubic B-spline delivers a third of an alternating control-point
  // offset (the sample is (−a + 4a − a)/6 = a/3), so an authored offset arrives
  // at a third of its size.
  //
  // **±3.2 % of the rise, raised from ±2.4 %.** The original delivered 3.6 cm
  // peak-to-peak on a cottage and a normal tilt of about 5°, and was chosen as
  // texture. Looked at in the browser from the village street it is *nothing*:
  // every roof in the village reads as one flat tan plane, because the toon
  // ramp quantises and 5° does not cross a band edge anywhere on the slope.
  // 3.2 % delivers 4.8 cm and about 7°, which does cross one under the
  // chapter's low afternoon sun, and the coat gains the horizontal banding a
  // thatched roof is supposed to have.
  //
  // Straight otherwise: a thatched roof's pitch is one plane and any *bow* in it
  // reads as a sagging roof rather than a steep one, which is the difference
  // between a village and a set of tents. A 4.8 cm ripple over a 3.1 m slope is
  // 1.5 %, which is still texture, not sag.
  [0.36, 0.6555],
  [0.575, 0.3940],
  [0.79, 0.2609],
  // ── The eaves bead ───────────────────────────────────────────────────────
  //
  // The coat necks in below the pitch line at the throat, swells back past it,
  // and rolls under. Four points a side rather than two: the throat and the
  // swell are what make it a bead instead of a chamfer, and the near-vertical
  // outer face between them is the cut ends of the straw, which is the one
  // surface on a thatched roof that faces the camera squarely.
  //
  // Measured on the built cottage: the throat necks 2.7 cm inside the pitch
  // line, the bead's outermost row stands **7.2 cm proud of it**, and the cut
  // face between them is **30 cm tall and vertical to within 2.4 cm** — a 49°
  // normal break off a 41° pitch, which is a whole toon band. The first draft
  // put the swell at x = 1.06 and measured 3.8 cm
  // *inside* the pitch line with a 45° face, i.e. still a chamfer: a closed
  // B-spline averages a cluster of four points hard enough that authoring the
  // shape you want is not the same as authoring the numbers you want.
  [0.925, 0.062],
  [1.1, 0.03],
  [1.1, -0.15],
  [0.86, -0.245],
  // The soffit, shallow rather than flat: a roof read from below at the eaves is
  // 20 % of its screen area from a walking camera, and a flat underside takes
  // the toon ramp's darkest band across its whole width, which reads as a hole
  // rather than as a soffit.
  [0.0, -0.28],
  // ── The leeward half, mirrored about index 1 ─────────────────────────────
  [-0.86, -0.245],
  [-1.1, -0.15],
  [-1.1, 0.03],
  [-0.925, 0.062],
  [-0.79, 0.2528],
  [-0.575, 0.4021],
  [-0.36, 0.6474],
  [-0.172, 0.796],
  [-0.158, 0.868],
  [-0.112, 0.938]
]

export const THATCH_SECTION: Section = splineSection(THATCH_POINTS)

/**
 * One sample per control point, and the offset that puts sample 0 on the apex.
 *
 * Derived rather than written out, because the two numbers have to move together
 * and they did not: the old code hard-coded 18 for a 16-point list. At 12
 * samples the grid steps 8.3 % of the section and can miss the whole apex
 * cluster, which puts the roof's ridge *between* two vertices and restores
 * exactly the dome the cluster exists to prevent. `plateau.ts` measured the
 * general form of this once: a 24 %-deep flute sampled off its arrises delivered
 * 37 % of its authored depth.
 */
const THATCH_SEGMENTS = THATCH_POINTS.length
const THATCH_V_OFFSET = 1 / THATCH_SEGMENTS

/**
 * Where each of the section's features sits in the `downslope` parameter the
 * roof paints against — `2 · min(v, 1 − v)`, which is 0 at the ridge and 1 at
 * the middle of the soffit.
 *
 * Exported because `village.ts` paints the roof and has to put the ridge cap's
 * colour on the ridge cap rather than 6 % away from it. Every one of these is
 * `2 · (index − 1) / 24`: `paintPart` reports `v = step / segments`, and
 * `vOffset` shifts the *geometry* by one control point, so paint's `v = 0` is
 * section index 1.
 */
export const THATCH_AT = {
  /** The apex. */
  ridge: 0,
  /** Where the cap's near-vertical edge face begins. */
  capEdge: 2 * 3 / THATCH_SEGMENTS,
  /** Where the cap's edge lands back on the coat. */
  coatTop: 2 * 4 / THATCH_SEGMENTS,
  /** The lowest coat row, just above the eaves throat. */
  coatFoot: 2 * 7 / THATCH_SEGMENTS,
  /** The neck above the bead. */
  throat: 2 * 8 / THATCH_SEGMENTS,
  /** The bead's outermost row. */
  bead: 2 * 9 / THATCH_SEGMENTS,
  /** Under the bead, where the soffit starts. */
  soffit: 2 * 11 / THATCH_SEGMENTS
} as const

/**
 * The course period, in `downslope`.
 *
 * Two control-point rows, which is the finest period the *coarsest crossfading
 * pair* can both carry: LOD0 samples the section every 2/24 = 0.083 of
 * downslope and LOD1 every 2/19 = 0.105, so anything under ~0.21 is below LOD1's
 * Nyquist rate. The old paint used 0.13 against a LOD0 spacing of 0.125 — one
 * sample per course — so the courses were aliased noise, and *different* noise
 * in every tier.
 *
 * 1/6 is deliberately right at LOD0's Nyquist rather than safely above it: at
 * exactly two samples per course the lap lands on a control-point row and the
 * course face on the next, which is the same grid the geometric lap above uses.
 * Paint and shape therefore reinforce instead of beating against each other.
 */
export const THATCH_COURSE = 1 / 6

/**
 * ─── A shingled roof's cross-section ────────────────────────────────────────
 *
 * The other roof in this world, and it is authored rather than borrowed from
 * `THATCH_SECTION` because the two materials differ in exactly the places a
 * silhouette is made of.
 *
 * Straw is *combed*: every edge on it is a roll, the ridge is a fat cushion and
 * the eaves are a bead of cut ends. Split oak shingles are *laid*: every edge is
 * an arris, the ridge is two boards nailed over each other, and the eaves are a
 * row of tips overhanging a fascia with nothing rolled about them. Painting one
 * section with two colour schemes gives two colours of thatch, which is what the
 * smithy's roof was — it used `THATCH_SECTION` with `shinglePaint` and read as
 * grey straw from across the square.
 *
 * ── The three features, and what each is for ────────────────────────────────
 *
 *   * **The ridge board** (indices 2–4). Two planks lapped over the apex, with a
 *     near-vertical cut edge where they finish. On thatch the equivalent is a
 *     28 %-of-span roll; here it is 21 % and it has a *corner*, which is the
 *     whole difference on the skyline.
 *   * **Three course steps a slope** (5–10, in proud/recessed pairs 3 % of the
 *     span apart). A shingle course is a butt edge standing the thickness of a
 *     shingle proud of the one below, and the face between the two is vertical.
 *     Authoring the pair 3 % apart in x and 7–8 % apart in y is what produces
 *     that face rather than a ripple: the same trick the cap's edge uses, three
 *     times down the slope. The B-spline still averages it to about a third, so
 *     a 1.9 m rise arrives at a 4 cm step with a 60° face — one whole toon band
 *     against a 41° pitch.
 *   * **The drip** (11–13). The tips overhang and are cut square. Thatch necks
 *     *in* above its bead; shingle does not neck at all, it simply stops, and
 *     the shadow under it is a straight line rather than a roll.
 *
 * Twenty-four points, the same as thatch, so the two roofs cost the same and a
 * building can swap between them without a budget change.
 */
const SHINGLE_POINTS: readonly (readonly [number, number])[] = [
  // Index 0 is the mirror of index 2 — see `THATCH_POINTS` on why the list
  // closes this way and why the apex is a cluster rather than a point.
  [-0.052, 0.982],
  [0.0, 1.018],
  [0.052, 0.982],
  // The ridge board's lower arris, and its cut edge: 1.6 % of x for 5.8 % of y.
  [0.104, 0.950],
  [0.120, 0.892],
  // Back on the coat. The plane from here to the eaves course is
  // y = 0.856 − 0.860 (x − 0.155); every figure below is signed distance off it.
  [0.155, 0.856],
  // Course 1: +1.9 % proud, then −3.2 % recessed 3 % of the span downslope.
  [0.400, 0.664],
  [0.430, 0.588],
  // Course 2.
  [0.680, 0.425],
  [0.710, 0.348],
  // The eaves course, standing proudest of the three because it is doubled —
  // a shingled roof starts with a double starter course, and that is the row
  // that carries the eaves shadow.
  [0.935, 0.190],
  // The tips, overhanging the fascia, and their square cut ends.
  [1.030, 0.078],
  [1.035, -0.055],
  // The soffit. Flatter and shallower than thatch's, and 2 points rather than
  // 3: there is no roll to come back under, so the underside runs straight in
  // from the fascia to the middle of the span.
  [0.0, -0.105],
  [-1.035, -0.055],
  [-1.030, 0.078],
  [-0.935, 0.190],
  [-0.710, 0.348],
  [-0.680, 0.425],
  [-0.430, 0.588],
  [-0.400, 0.664],
  [-0.155, 0.856],
  [-0.120, 0.892],
  [-0.104, 0.950]
]

export const SHINGLE_SECTION: Section = splineSection(SHINGLE_POINTS)

const SHINGLE_SEGMENTS = SHINGLE_POINTS.length
const SHINGLE_V_OFFSET = 1 / SHINGLE_SEGMENTS

/**
 * Where the shingle section's features land in `downslope`, on the same
 * `2 · (index − 1) / N` rule `THATCH_AT` derives.
 *
 * Exported for the same reason: a paint that puts the ridge board's colour a
 * sixth of a slope away from the ridge board is a printing error.
 */
export const SHINGLE_AT = {
  ridge: 0,
  /** The ridge board's lower arris. */
  capEdge: (2 * 2) / SHINGLE_SEGMENTS,
  /** Where its cut edge lands back on the coat. */
  coatTop: (2 * 4) / SHINGLE_SEGMENTS,
  /** The three proud butt rows, finest first. */
  course: [(2 * 5) / SHINGLE_SEGMENTS, (2 * 7) / SHINGLE_SEGMENTS, (2 * 9) / SHINGLE_SEGMENTS] as const,
  /** The overhanging tips. */
  drip: (2 * 10) / SHINGLE_SEGMENTS,
  /** Their square cut ends. */
  butt: (2 * 11) / SHINGLE_SEGMENTS,
  /** Under the drip, where the soffit starts. */
  soffit: (2 * 12) / SHINGLE_SEGMENTS
} as const

/**
 * The course period, in `downslope` — two control-point rows, exactly as
 * `THATCH_COURSE` is and for the same Nyquist argument.
 *
 * A row is `2 / SHINGLE_SEGMENTS` of downslope, so two of them is four
 * twenty-fourths, i.e. 1/6 — the same period thatch runs at, which is what lets
 * one paint helper serve both roofs.
 */
export const SHINGLE_COURSE = 4 / SHINGLE_SEGMENTS

export type PaintFn = (u: number, v: number, out: Color) => void

export interface StructureMember {
  name: string
  /** Section-centre control points, in the asset's own object space. */
  path: readonly Vec3[]
  /** Half-extent along `axisA` at each control point. 0 collapses the ring. */
  extentA: readonly number[]
  extentB: readonly number[]
  axisA?: Vector3
  axisB?: Vector3
  section?: Section
  /**
   * Four ring schedules, finest first — spline parameters, always starting at 0
   * and ending at 1. Defaults to `CAPPED_RINGS`; see its note.
   */
  rings?: readonly (readonly number[])[]
  /** Samples around the section at LOD0. Reduced per tier by `SEGMENT_SCALE`. */
  segments?: number
  /**
   * Explicit sample counts, finest first, overriding `SEGMENT_SCALE`.
   *
   * For the one case the global schedule cannot serve: a section whose features
   * are only sampled at particular counts. `SEGMENT_SCALE` on the wall's 16-point
   * section gives 16 / 12 / 10 / 7, and 10 and 7 are counts at which a 16-point
   * loop has no mirror symmetry — the wall comes out visibly lopsided on one
   * side at LOD2 and LOD3. See `WALL_SECTION`'s note for which counts work and
   * why. Use it for that, not to buy detail: it bypasses the one mechanism that
   * guarantees a coarse tier is cheaper than a fine one.
   */
  segmentsByTier?: readonly [number, number, number, number]
  /**
   * Overrides the inscribed-polygon compensation. See `inflateFor`.
   *
   * `1` for any section whose samples land **on its own control points**, which
   * for a polygon means the sampled shape is already the authored shape and
   * there is nothing to compensate. Measured on the cottage wall before this
   * existed: `WALL_SECTION` puts a vertex exactly on (1, 0) at 16, 12 and 8
   * samples, so the default `1/cos(π/segments)` was pure over-correction and the
   * wall grew **2.72 m → 2.90 m of half-length between LOD0 and LOD3** — a 6.7 %
   * step, on a building, at a boundary the player is looking straight at. That is
   * the same failure §4.3 exists to prevent, running the other way.
   */
  inflate?: number
  vOffset?: number
  paint: PaintFn
  /** Colour this member's ambient occlusion resolves toward. Never black (R4). */
  deep: Color
  /** AO strength. 0 skips it — right for anything that is already in shadow. */
  ao?: number
  /** Vertex wind weight. Non-zero only for cloth: a banner, an awning. */
  wind?: number
  /**
   * Coarsest tier this member survives to, 0–3. Default 3.
   *
   * The single most effective lever in the file — see the header. A member that
   * is *inside* another one's silhouette (a window frame against a wall, a
   * bucket against a well's roof) should almost always be 0 or 1.
   */
  lastTier?: number
  /**
   * Finest tier this member first appears at, 0–3. Default 0.
   *
   * The other half of `lastTier`, and the reason it is not simply "drop things
   * as they get small": some shapes are cheapest to describe *coarsely* by a
   * different member entirely. A palisade is twelve split stakes at LOD0 and
   * LOD1 — the gaps between them are the whole read — and one painted slab at
   * LOD2 and LOD3, where a stake is under a pixel wide and twelve of them are
   * 12 × the triangles of the slab that replaces them.
   *
   * This is what keeps the tiers from being decimations of each other, which
   * GDD §4.3 requires and which a purely subtractive scheme cannot give: a
   * substitution is a *different description of the same shape*, and the
   * dithered crossfade is exactly the mechanism for swapping one for the other
   * without a pop.
   */
  firstTier?: number
}

export interface StructureSpec {
  name: string
  perfTag: string
  members: readonly StructureMember[]
  /** Four triangle ceilings, finest first. Asserted at generation time. */
  budgets: readonly [number, number, number, number]
  /** Multiplies the global LOD distance table. A house is large — see R7. */
  distanceScale: number
  /** Albedo jitter seed, so two cottages are not one cottage twice. */
  seed?: number
  jitter?: number
  /** Materials the whole family shares. See `createStructureMaterial`. */
  material?: StructureMaterial
  /**
   * Set false to ship no inverted-hull outline.
   *
   * For glass, and so far only for glass. An outline is a back-faced shell
   * pushed 1.6 screen pixels out along the normals and painted with the base
   * colour darkened — which on an opaque prop is the stylisation this whole
   * world is built on, and on a 22 %-opacity pane is an opaque dark rectangle
   * standing a couple of pixels outside it. It also costs a draw call per tier
   * (GDD §5.2 budgets 180 for the frame), which is not nothing on a prop that
   * is placed four times in one room.
   */
  outline?: boolean
}

/**
 * ─── Ring schedules, and why they are authored rather than scaled ───────────
 *
 * The first pass reduced a tier by scaling the *ring count* — LOD3 took a third
 * of LOD0's rings — and it produced tiers with **zero triangles**. Every capped
 * member in this file collapses its section to a point at both ends (that is
 * what a bevelled cut is here), so a tier reduced to two rings sampled *both*
 * poles, every quad in the single band was degenerate, `dropDegenerateFaces`
 * removed all of them, and the LOD field cheerfully drew nothing. Measured
 * before the fix: the palisade's LOD2 and LOD3 were empty, the gate's LOD3 was
 * empty, and the cottage's LOD3 was ten triangles.
 *
 * So a tier's rings are an **authored list of spline parameters**, not a count,
 * and every list starts at 0 and ends at 1. That guarantees the caps survive to
 * LOD3, and it puts the surviving interior rings where the shape actually turns
 * rather than wherever an even spread happens to land.
 *
 * ── Reading these numbers ───────────────────────────────────────────────────
 *
 * They are parameters of the *spline*, not fractions of the member's length, and
 * the two are deliberately very different. `CAP_T` clusters its control points
 * hard at the ends, so t = 0.33 is 1.3 % along the beam and t = 0.5 is halfway:
 * the whole bevel lives in t ∈ [0, 0.35] and the entire straight run lives in
 * t ∈ [0.35, 0.65]. That non-uniformity is the only way a uniform cubic B-spline
 * can describe "flat for 95 % of its length with a short rounded end", and it is
 * the same trick `sword.ts` uses to get a ricasso and a point out of one sweep.
 */
const CAPPED_RINGS: readonly (readonly number[])[] = [
  [0, 0.3, 0.4, 0.5, 0.6, 0.7, 1],
  [0, 0.34, 0.5, 0.66, 1],
  [0, 0.36, 0.5, 0.64, 1],
  [0, 0.42, 0.58, 1]
]

/**
 * For members whose *path* bends — a cambered bridge deck, a sagging ridge, a
 * curving palisade run. They need interior rings for the curve, not only for
 * the bevel, so the middle of the range is sampled instead of skipped.
 */
const CURVED_RINGS: readonly (readonly number[])[] = [
  [0, 0.3, 0.38, 0.44, 0.5, 0.56, 0.62, 0.7, 1],
  [0, 0.33, 0.42, 0.5, 0.58, 0.67, 1],
  [0, 0.38, 0.5, 0.62, 1],
  [0, 0.45, 0.55, 1]
]

/**
 * For members whose section is uniform and whose length carries no information —
 * a palisade stake, a rail, a fence post, a barrel hoop.
 *
 * Four rings at LOD0 instead of seven. A straight prism gains nothing from
 * interior rings: the mesh interpolates linearly between them and the extent is
 * already flat there, so the extra rings are duplicated geometry. Measured on
 * the palisade, whose twelve stakes went from **720 triangles to 432** with no
 * visible difference at any distance — the stakes are 40 cm wide and their whole
 * read is the gap between them.
 */
const SIMPLE_RINGS: readonly (readonly number[])[] = [
  [0, 0.34, 0.5, 0.66, 1],
  [0, 0.38, 0.62, 1],
  [0, 0.5, 1],
  [0, 0.5, 1]
]

/**
 * For a small member *applied* to a bigger one — a corner post on a wall, a
 * brace, a mid-rail, a jetty bracket, a window frame.
 *
 * Three bands at LOD0 rather than `CAPPED_RINGS`' six, because the whole point
 * of `CAP_T` is that the straight run lives in t ∈ [0.35, 0.65] and everything
 * outside it is the two bevels: `[0, 0.35, 0.65, 1]` is therefore *exactly* the
 * ring list a straight applied member needs — cap, start of the flat, end of the
 * flat, cap — and the three interior rings `CAPPED_RINGS` adds are duplicated
 * geometry down a member that carries no shape.
 *
 * The saving is what makes a modelled frame affordable at all. A cottage's
 * frame is twelve applied members; at 4 segments they cost 16 triangles each on
 * `FLAT_RINGS` and 40 each on `CAPPED_RINGS` — 192 against 480. The smithy's six
 * jetty brackets came down from 300 triangles to 120 for no visible change; they
 * are 7 cm square and their entire read is that they are *there*.
 */
const FLAT_RINGS: readonly (readonly number[])[] = [
  [0, 0.35, 0.65, 1],
  [0, 0.5, 1],
  [0, 0.5, 1],
  [0, 0.5, 1]
]

/**
 * ─── The wall's rings are the frame's horizontals ───────────────────────────
 *
 * Every other schedule here puts rings where the *shape* turns. A wall has no
 * shape to speak of — it is a battered box — so its rings go where the *paint*
 * turns, which for a half-timbered facade is the sill, the mid-rail and the wall
 * plate. Vertex colour cannot express a feature with no vertex on it, and the
 * old wall had none anywhere useful.
 *
 * Measured before this existed, on the cottage's own wall: `CAPPED_RINGS`
 * against `box`'s path put the seven LOD0 ring rows at heights
 *
 *     0.000, 0.001, 0.161, 0.803, 0.991, 0.999, 1.000
 *
 * so **64 % of the wall's height carried no vertex row at all**, and
 * `timberFrame`'s "mid-rail at two thirds height" (u = 0.62) resolved to
 * height 0.99 — the paint was drawing the rail on the wall plate. The sill
 * (u = 0.02) resolved to height 0.0005, i.e. onto the collapsed bottom ring.
 * Worse, the rail's row moved between tiers: u = 0.60 / 0.66 / 0.64 / 0.58,
 * four different heights, which is a hard LOD swap of a painted feature and a
 * bug under GDD R7.
 *
 * The numbers below are inverses of `box`'s (now linear-ish) height map, so the
 * rail sits at the *same height* in all four tiers and only its neighbours thin
 * out. Heights, LOD0: 0, 0.06, 0.30, 0.62, 0.86, 0.96, 1.
 */
const WALL_RINGS: readonly (readonly number[])[] = [
  [0, 0.302, 0.418, 0.547, 0.649, 0.712, 1],
  [0, 0.302, 0.475, 0.547, 0.712, 1],
  [0, 0.32, 0.547, 0.70, 1],
  [0, 0.36, 0.66, 1]
]

/**
 * ─── The roof trades a ring pair for the ridge cap ──────────────────────────
 *
 * Six bands at LOD0 where `CURVED_RINGS` has eight. The rings on a roof exist
 * for one thing — the half-hip where `ROOF_E` collapses the section over the
 * last 7 % of the ridge — and `CURVED_RINGS` spends four of its nine rings
 * inside each end's first 26 %. Dropping to seven leaves the hip described at
 * path fractions 0, 3.4 %, 16 %, 50 % and their mirrors, which is two interior
 * rings per hip instead of three.
 *
 * What that buys is 4 segments' worth of section at the same price, and the
 * section is strictly the better place to spend: the rings only shape the two
 * gable ends, while the section shapes the ridge cap and the eaves bead along
 * the whole length and from every direction. Net at LOD0 the new 24-point
 * section on this schedule is **240 triangles against the old 16-point section
 * on `CURVED_RINGS`' 252** — a fatter, better roof for less.
 */
const ROOF_RINGS: readonly (readonly number[])[] = [
  [0, 0.3, 0.4, 0.5, 0.6, 0.7, 1],
  [0, 0.34, 0.5, 0.66, 1],
  [0, 0.38, 0.5, 0.62, 1],
  [0, 0.45, 0.55, 1]
]

export { CAPPED_RINGS, CURVED_RINGS, FLAT_RINGS, ROOF_RINGS, SIMPLE_RINGS, WALL_RINGS }

/** Section samples kept at each tier. */
const SEGMENT_SCALE = [1, 0.78, 0.62, 0.45] as const

/**
 * The floor on section samples, **per tier**, and the middle pair is the
 * interesting one.
 *
 * Four is the honest minimum: three is a triangle, and every section in this
 * file is a *quadrilateral* by intent — a beam, a wall, a plank and a stake all
 * have four faces and their silhouette is what identifies them. A three-sided
 * wall at 90 m does not read as a distant building, it reads as a bug, and it
 * saves eight triangles.
 *
 * LOD2 floors at **five** instead, and that is not an art decision — it is what
 * makes the ladder *strictly* monotonic. `assets.test.ts` requires every tier to
 * be smaller than the one before it, and with a single floor of four, LOD2 and
 * LOD3 of any member already at the floor came out identical: the palisade's
 * coarse slab measured 16 triangles at both, which is a tier that costs a
 * geometry, a buffer upload and a crossfade for zero saving. Raising only LOD2's
 * floor separates them without giving LOD3 a shape it cannot carry.
 */
const MIN_SEGMENTS = [4, 4, 5, 4] as const

/**
 * Inscribed-polygon compensation (GDD §4.3).
 *
 * A section sampled at `n` points encloses less than the curve it approximates,
 * so a tier that halves its segments is visibly *thinner* than the tier it fades
 * from — and on a building that shows up as the whole village stepping inward at
 * a range the player is looking straight at it. Putting the edge midpoints on
 * the curve instead of the vertices is the standard fix and it is exact for a
 * circle; for the rounded-rectangle sections here it over-corrects by under 2 %,
 * which is the right side to err on.
 */
const inflateFor = (segments: number): number => 1 / Math.cos(Math.PI / segments)

const _color = new Color()

const buildMember = (member: StructureMember, tier: number): SweptPart => {
  const rings = (member.rings ?? CAPPED_RINGS)[tier]!
  const baseSegments = member.segments ?? 8
  const segments = member.segmentsByTier
    ? member.segmentsByTier[tier]!
    : Math.max(MIN_SEGMENTS[tier]!, Math.round(baseSegments * SEGMENT_SCALE[tier]!))

  const part = sweep({
    name: `${member.name}/LOD${tier}`,
    path: member.path,
    extentA: member.extentA,
    extentB: member.extentB,
    axisA: member.axisA ?? AXIS_X,
    axisB: member.axisB ?? AXIS_Z,
    section: member.section ?? BEAM_SECTION,
    stations: rings.length,
    us: rings,
    ...(member.vOffset !== undefined ? { vOffset: member.vOffset } : {}),
    inflate: member.inflate ?? inflateFor(segments),
    segments
  })

  paintPart(part, member.paint, _color)
  return part
}

const buildTier = (spec: StructureSpec, tier: number, rng: Rng): BufferGeometry => {
  const kept = spec.members.filter(
    member => (member.lastTier ?? 3) >= tier && (member.firstTier ?? 0) <= tier
  )
  if (kept.length === 0) {
    throw new Error(`[world] ${spec.name}: LOD${tier} has no members — every tier must draw something`)
  }
  const parts = kept.map(member => {
    const part = buildMember(member, tier)
    if (member.wind) {
      // A constant weight, not a height ramp: every cloth member in the village
      // — a banner, a stall's awning — hangs free along its whole length below
      // the line it is tied to, and a ramp anchored at the geometry's own y = 0
      // would pin whichever end happened to be modelled lower.
      paintWindWeight(part.geometry, member.wind)
    }
    return part
  })

  const geometries = parts.map(part => part.geometry)
  const ranges = partRanges(geometries)
  const merged = mergeParts(geometries, `${spec.name}/LOD${tier}`)

  const radius = measuredRadius([merged])
  // Rays scaled to the structure. A house's own eaves and its doorway are the
  // only occluders that matter to it; a metre-long ray from a roof ridge finds
  // sky, and one long enough to reach the ground would darken the whole roof.
  const ao = bakeVertexAO(merged, {
    samples: tier === 0 ? 12 : 8,
    maxDistance: radius * 0.4,
    strength: 0.85,
    power: 1.2
  })
  for (let i = 0; i < ranges.length; i++) {
    const amount = kept[i]!.ao ?? 0.7
    if (amount > 0) {
      applyVertexAO(merged, ao, kept[i]!.deep, amount, ranges[i])
    }
  }

  jitterColor(merged, rng, spec.jitter ?? 0.03)
  merged.computeBoundingSphere()
  merged.computeBoundingBox()
  assertFiniteGeometry(merged, `${spec.name}/LOD${tier}`)
  assertTriBudget(merged, spec.budgets[tier]!, `${spec.name}/LOD${tier}`)
  return merged
}

/**
 * The built world's two materials.
 *
 * Two, not one per prop and not one for everything. A toon material is a
 * *program* — the scene's budget is ~14 of them (GDD §5) and the world already
 * runs at 19 — so a material per building would put the village alone past the
 * whole scene's allowance. One is not enough either: the ramp's band positions
 * are what separate thatch from mortar, and a single ramp tuned for timber makes
 * the well's stonework read as more timber.
 */
const materials: Partial<Record<StructureMaterial, ToonMaterial>> = {}

export type StructureMaterial = 'timber' | 'stone' | 'cloth' | 'glass'

/**
 * Ramps, and why the built world does not simply take the default.
 *
 * `DEFAULT_RAMP`'s terminator sits at 0.42–0.50, which is tuned for a *rounded*
 * surface — a boulder, a tree — where a band edge that swims is the failure
 * being avoided. A village is the opposite geometry: large planar faces meeting
 * at fixed angles, so every face takes exactly one band over its whole area and
 * the only thing separating a wall from the roof above it is *which* band. With
 * the default's two dark bands 0.16 apart, a north wall and the soffit above it
 * landed in the same one and the eaves disappeared.
 *
 * So timber spreads the dark end and keeps the lit end short — the roof is the
 * biggest area in the village and must not blow out — and stone gets a genuine
 * fourth highlight band, because the well's coping and the forge's hearth are
 * the only surfaces here with a specular read at all.
 */
const TIMBER_RAMP: RampStop[] = [
  { value: 0.28, edge: 0.36 },
  { value: 0.5, edge: 0.55 },
  { value: 0.76, edge: 0.8 },
  { value: 0.96, edge: 1.0 }
]

const STONE_RAMP: RampStop[] = [
  { value: 0.3, edge: 0.4 },
  { value: 0.5, edge: 0.56 },
  { value: 0.72, edge: 0.74 },
  { value: 1.0, edge: 1.0 }
]

/**
 * Glass: two bands, both bright, and a hard step between them.
 *
 * A toon ramp on a transparent surface is not shading a solid — it is deciding
 * where the *reflection* is, and a reflection has an edge. Three graded bands
 * put a soft gradient across a pane and made it read as tinted perspex; two
 * bands with a step at 0.55 read as a sheet catching the sky over one half of
 * itself, which is what old window glass does.
 */
const GLASS_RAMP: RampStop[] = [
  { value: 0.52, edge: 0.55 },
  { value: 0.52, edge: 0.56 },
  { value: 1.0, edge: 0.9 },
  { value: 1.0, edge: 1.0 }
]

/**
 * The built world's materials.
 *
 * Three, not one per prop. A toon material is a *program* — the scene's budget
 * is ~14 of them (GDD §5) and this world already runs at 19 — so a material per
 * building would put the village alone past the whole scene's allowance. One is
 * not enough either: the ramp's band positions are what separate thatch from
 * mortar, and a single ramp tuned for timber makes the well's stonework read as
 * more timber. `cloth` is a third only because it compiles in the wind path,
 * which the other two must not pay for.
 */
export const createStructureMaterial = (kind: StructureMaterial): ToonMaterial => {
  const existing = materials[kind]
  if (existing) {
    return existing
  }
  const made = createToonMaterial({
    name: `structure-${kind}`,
    ramp: makeToonRamp(kind === 'stone' ? STONE_RAMP : kind === 'glass' ? GLASS_RAMP : TIMBER_RAMP),
    // Glass takes the strongest rim in the family. On every other surface here
    // the rim is a stylisation; on a pane it is doing the actual physical job —
    // a sheet of glass is visible almost entirely through the light that grazes
    // it, and without the rim a 22 %-opacity pane in a shaded reveal is
    // indistinguishable from an empty hole.
    rimStrength: kind === 'glass' ? 1.15 : kind === 'stone' ? 0.5 : 0.4,
    ...(kind === 'cloth' ? { wind: true, windStrength: 0.35 } : {}),
    ...(kind === 'glass'
      ? {
          transparent: true,
          // 0.22: measured against the room behind it rather than chosen. At
          // 0.4 the interior wall's daub reads through as a pale smear and the
          // pane looks like a dirty board; below ~0.15 the mullions are the
          // only thing left and the window is a hole with sticks in it.
          opacity: 0.22,
          // Two panes per window and four windows per room: with depth writes
          // on, whichever pane draws first punches a hole in the one behind it.
          depthWrite: false,
          // Both faces. A window is looked *through*, so the player is behind
          // it as often as in front of it, and back-face culling would delete
          // every pane seen from inside the hut — which is precisely the
          // situation this material exists for.
          side: DoubleSide
        }
      : {})
  })
  materials[kind] = made
  return made
}

/** Frees the shared materials. Called from the asset registry's teardown. */
export const disposeStructureMaterials = (): void => {
  for (const key of Object.keys(materials) as StructureMaterial[]) {
    materials[key]?.dispose()
    delete materials[key]
  }
}

export const buildStructureAsset = (spec: StructureSpec): WorldAsset => {
  const rng = makeRng(spec.seed ?? 1)
  const tiers = [0, 1, 2, 3].map(tier => buildTier(spec, tier, rng))
  return {
    name: spec.name,
    perfTag: spec.perfTag,
    tiers,
    material: createStructureMaterial(spec.material ?? 'timber'),
    outline:
      spec.outline === false ? null : createOutlineMaterial({ pixelWidth: 1.6, name: `${spec.name}-outline` }),
    // 0 when there is no hull to draw. `assets.test.ts` asserts the pair move
    // together, and it is right to: a non-zero `outlineMaxTier` beside a null
    // material is a field that will happily allocate outline meshes for a prop
    // that has no outline material to give them.
    outlineMaxTier: spec.outline === false ? 0 : 1,
    radius: measuredRadius(tiers),
    distanceScale: spec.distanceScale
  }
}

// ─── Member constructors ────────────────────────────────────────────────────

const _dir = new Vector3()
const _sideA = new Vector3()
const _sideB = new Vector3()
const _from = new Vector3()
const _to = new Vector3()

/**
 * ─── The capped-member control polygon ──────────────────────────────────────
 *
 * The single most important nine numbers in the file, and the reason they look
 * so lopsided is measured rather than aesthetic.
 *
 * A uniform cubic B-spline smooths over roughly `3 / (n + 1)` of its parameter
 * range, so a naive `[0, w, w, w, 0]` extent polygon does **not** produce "a
 * beam with bevelled ends" — it produces a *lens*. Sampled: that polygon reaches
 * only 50 % of its authored half-width at t = 0.25 and 96 % at t = 0.40, i.e.
 * the taper occupies two fifths of the member at each end and every timber in
 * the village came out spindle-shaped.
 *
 * The fix is not more control points on the extent (36 would be needed to get
 * the taper under a tenth). It is to make the *path* non-uniform in arc length,
 * so that the parameter range the extent spends tapering covers almost no actual
 * distance. `CAP_T` puts four of its nine control points inside the first 2.5 %
 * of the run and four inside the last 2.5 %, which leaves t ∈ [0.35, 0.65] — the
 * whole flat middle of the extent curve — covering 91 % of the length.
 *
 * Measured on the pair below: at 1.3 % along the member the section is at 70 %
 * width, at 5 % it is at 87 %, and it holds 93–98 % across the entire middle.
 * That is a hewn beam with a chamfered end, which is what GDD R2 asks for, and
 * it costs no extra rings.
 *
 * `sword.ts` reaches the same conclusion from the other side — its blade control
 * points cluster at the ricasso and the point — so this is the family's second
 * independent derivation of the same rule rather than a new idea.
 */
const CAP_T = [0, 0.005, 0.012, 0.025, 0.5, 0.975, 0.988, 0.995, 1] as const
const CAP_E = [0, 0.35, 0.72, 0.93, 1, 0.93, 0.72, 0.35, 0] as const

/**
 * A rounder end, for thatch.
 *
 * The gable of a thatched roof is *combed over* rather than cut square — the
 * straw wraps the end in a half-hip. `ROOF_E` spreads the same collapse across
 * 7 % of the ridge instead of 2.5 %, which produces exactly that, and it is why
 * a roof does not simply use `CAP_T`.
 */
const ROOF_E = [0, 0.42, 0.74, 0.94, 1, 0.94, 0.74, 0.42, 0] as const

/**
 * The same nine control points, with the collapse spread over `hip` of the
 * ridge instead of a fixed 7 %.
 *
 * `hipProfile(0.07)` reproduces the original list exactly — the three inner
 * numbers were 0.17, 0.43 and 1.0 of it — so thatch is untouched and the
 * parameter exists for shingle, which wants 2 %.
 *
 * ── Why shingle wants a different one ───────────────────────────────────────
 *
 * A half-hip is what straw *does*: it is combed over the end of the ridge and
 * the result is a soft quarter-round. Split shingles are laid in courses that
 * stop at a square edge under a barge board, and there is no way to comb them.
 * At 7 % of a 12.8 m ridge the storyteller's roof ended in a 90 cm fan of
 * radiating facets at each gable — which is a legitimate roof and it is a
 * *thatched* one, sitting on the one building in the chapter that is deliberately
 * not thatched.
 *
 * 2 % is 26 cm, which is a chamfer rather than a hip, and it lands behind the
 * barge board.
 */
const hipProfile = (hip: number): readonly number[] => [
  0,
  0.17 * hip,
  0.43 * hip,
  hip,
  0.5,
  1 - hip,
  1 - 0.43 * hip,
  1 - 0.17 * hip,
  1
]

const ROOF_T = hipProfile(0.07)

/**
 * Scales the cap profile per end, so one end can be a chamfer and the other a
 * point. `taper: [1, 0.16]` is the palisade stake: full at the foot, sharpened
 * at the top.
 */
const taperedProfile = (half: number, endA: number, endB: number): number[] =>
  CAP_E.map((e, i) => {
    const t = CAP_T[i]!
    // Linear in the *path fraction*, not in the spline parameter: a taper is a
    // property of the physical member, and CAP_T is deliberately not uniform.
    const end = endA + (endB - endA) * t
    return half * e * end
  })

export interface BeamOptions {
  name: string
  from: Vec3
  to: Vec3
  /** Half-thickness across the beam. */
  halfA: number
  /** Half-thickness the other way. Defaults to `halfA` — a square timber. */
  halfB?: number
  /** Scales the half-extents at each end. `[1, 0]` makes a pointed stake. */
  taper?: readonly [number, number]
  section?: Section
  segments?: number
  segmentsByTier?: readonly [number, number, number, number]
  rings?: readonly (readonly number[])[]
  /** Rolls the section about the beam's own axis, in radians. */
  roll?: number
  paint: PaintFn
  deep: Color
  ao?: number
  wind?: number
  lastTier?: number
  firstTier?: number
}

/**
 * A straight member between two points, with bevelled ends.
 *
 * The frame is derived rather than authored: `axisA` is the beam direction
 * crossed with world up, so a beam's "width" axis is always horizontal and its
 * "depth" axis always leans with the beam. That is the right default for
 * everything a village is made of — a rafter's broad face lies in the roof
 * plane, a stake's flat faces along the wall — and `roll` is there for the two
 * members it is wrong for.
 */
export const beam = (options: BeamOptions): StructureMember => {
  _from.set(options.from[0], options.from[1], options.from[2])
  _to.set(options.to[0], options.to[1], options.to[2])
  _dir.subVectors(_to, _from)
  const length = _dir.length()
  if (!(length > 1e-6)) {
    throw new Error(`[world] ${options.name}: zero-length member`)
  }
  _dir.multiplyScalar(1 / length)

  // Nearly vertical members have no horizontal cross product with up, so they
  // fall back to +X. Tested against 0.999 rather than exactly 1: a post that is
  // 1° off vertical still produces a cross product too short to normalise
  // stably, and the resulting frame spins with float noise.
  if (Math.abs(_dir.y) > 0.999) {
    _sideA.set(1, 0, 0)
  } else {
    _sideA.crossVectors(_dir, AXIS_Y).normalize()
  }
  _sideB.crossVectors(_sideA, _dir).normalize()

  if (options.roll) {
    const cos = Math.cos(options.roll)
    const sin = Math.sin(options.roll)
    const ax = _sideA.x * cos + _sideB.x * sin
    const ay = _sideA.y * cos + _sideB.y * sin
    const az = _sideA.z * cos + _sideB.z * sin
    _sideB.set(_sideB.x * cos - _sideA.x * sin, _sideB.y * cos - _sideA.y * sin, _sideB.z * cos - _sideA.z * sin)
    _sideA.set(ax, ay, az)
  }

  const [endA, endB] = options.taper ?? [1, 1]
  const halfB = options.halfB ?? options.halfA
  const path = CAP_T.map(
    u =>
      [
        _from.x + (_to.x - _from.x) * u,
        _from.y + (_to.y - _from.y) * u,
        _from.z + (_to.z - _from.z) * u
      ] as Vec3
  )

  return {
    name: options.name,
    path,
    extentA: taperedProfile(options.halfA, endA, endB),
    extentB: taperedProfile(halfB, endA, endB),
    axisA: _sideA.clone(),
    axisB: _sideB.clone(),
    section: options.section ?? BEAM_SECTION,
    ...(options.rings ? { rings: options.rings } : {}),
    segments: options.segments ?? 8,
    ...(options.segmentsByTier ? { segmentsByTier: options.segmentsByTier } : {}),
    paint: options.paint,
    deep: options.deep,
    ...(options.ao !== undefined ? { ao: options.ao } : {}),
    ...(options.wind !== undefined ? { wind: options.wind } : {}),
    ...(options.lastTier !== undefined ? { lastTier: options.lastTier } : {}),
    ...(options.firstTier !== undefined ? { firstTier: options.firstTier } : {})
  }
}

/**
 * ─── An applied timber: the 16-triangle member the frame is built from ──────
 *
 * A `beam` with three things pinned, and every one of them is load-bearing:
 *
 *   * **`TIMBER_SECTION` at exactly four samples**, so the timber is a square
 *     with its flats parallel to whatever it is applied to. See that section's
 *     note for why `BEAM_SECTION` at four is a 41 %-oversized diamond.
 *   * **`FLAT_RINGS`**, so the member is a straight prism with a short chamfer
 *     at each end and nothing in between — 16 triangles at LOD0 against
 *     `CAPPED_RINGS`' 40.
 *   * **the girth correction.** `FLAT_RINGS` puts its two interior rings at
 *     spline parameter 0.35 and 0.65, and `CAP_E` is at 0.8187 there, so a
 *     member authored at `half` is built at 0.82 × `half`. The taper is the
 *     wanted shape — 2.8 % of the length at each end, which is the bevel — but
 *     the girth is not, so `half` is divided through by that measured 0.8187 and
 *     the built member is the size the caller asked for.
 *
 * `half` is therefore a real half-thickness in metres, measured on the mesh.
 */
export interface FlatTimberOptions {
  name: string
  from: Vec3
  to: Vec3
  /** Half-thickness across the member, as built. */
  half: number
  /** Half-thickness the other way. Defaults to `half`. */
  halfB?: number
  /**
   * Per-end scale on the cap profile, as `beam`'s own `taper`.
   *
   * Passed through rather than left out, because the applied-timber form is the
   * cheapest member in the kit (16 triangles) and some of the things that want
   * to be one are *pointed*: an antler tine, a wolf pelt's leg. Without it those
   * had to be `beam`s at 40.
   */
  taper?: readonly [number, number]
  roll?: number
  paint: PaintFn
  deep: Color
  ao?: number
  lastTier?: number
  firstTier?: number
}

const FLAT_GIRTH = 1 / 0.8187
const FLAT_SEGMENTS = [4, 4, 4, 4] as const

export const flatTimber = (options: FlatTimberOptions): StructureMember =>
  beam({
    name: options.name,
    from: options.from,
    to: options.to,
    halfA: options.half * FLAT_GIRTH,
    halfB: (options.halfB ?? options.half) * FLAT_GIRTH,
    section: TIMBER_SECTION,
    segments: 4,
    segmentsByTier: FLAT_SEGMENTS,
    rings: FLAT_RINGS,
    ...(options.taper ? { taper: options.taper } : {}),
    ...(options.roll !== undefined ? { roll: options.roll } : {}),
    paint: options.paint,
    deep: options.deep,
    ...(options.ao !== undefined ? { ao: options.ao } : {}),
    ...(options.lastTier !== undefined ? { lastTier: options.lastTier } : {}),
    ...(options.firstTier !== undefined ? { firstTier: options.firstTier } : {})
  })

export interface BoxOptions {
  name: string
  /** Centre of the footprint. */
  x?: number
  z?: number
  /** Bottom and top, in object space. */
  y0: number
  y1: number
  halfX: number
  halfZ: number
  /**
   * Footprint scale at the top, as a fraction of the base.
   *
   * Under 1 is a *batter* — a wall that leans in as it rises. Every cob and daub
   * wall has one, it is 3–5 % over a storey, and it is most of why a modelled
   * house reads as built rather than as extruded. A perfectly prismatic wall is
   * the single loudest "this is a box" tell in a stylised village.
   */
  batter?: number
  /** Round the top and bottom edges over this fraction of the height. */
  bevel?: number
  section?: Section
  segments?: number
  segmentsByTier?: readonly [number, number, number, number]
  /** See `StructureMember.inflate`. 1 for a polygonal section sampled on itself. */
  inflate?: number
  rings?: readonly (readonly number[])[]
  paint: PaintFn
  deep: Color
  ao?: number
  lastTier?: number
  firstTier?: number
}

/**
 * ─── A box's own control polygon, and why it is not `CAP_T` / `CAP_E` ───────
 *
 * `CAP_T` exists to make a *beam* — 91 % of its length flat, a short rounded end
 * — and it does that by being wildly non-uniform in arc length. Reused for a
 * box, that non-uniformity lands on the wrong axis: it compresses the whole
 * height into two parameter values.
 *
 * Measured on the cottage's own wall before this existed, with `bevel = 0.045`
 * the nine `CAP_T` control points sat at height fractions
 *
 *     0, 0.00045, 0.00108, 0.00225, 0.955, 0.998, 0.999, 0.9996, 1
 *
 * so the "bottom chamfer" occupied **0.2 % of the height** (5.6 mm on a 2.5 m
 * wall — a hard 90° edge, which GDD R2 says does not exist in this world) while
 * the top occupied 4.5 %, and every ring the LOD schedule placed between
 * u = 0.4 and u = 0.6 landed somewhere in the top fifth. Two thirds of the wall
 * had no vertex row, so nothing could be painted on it.
 *
 * The asymmetry was a plain slip: `heightAt` tests `t < 0.5`, and `CAP_T`'s
 * middle control point *is* 0.5, so it took the top branch and the "middle" of
 * the run was placed at 1 − bevel.
 *
 * Twelve points instead of nine, four for each bevel and four spread evenly
 * through the straight run. The triangle count is untouched — a tier costs
 * `rings × segments`, not control points — so this is a free fix, and it is what
 * makes `WALL_RINGS` able to name a height at all. The resulting map (bevel
 * 0.045):
 *
 *     u    0.30  0.35  0.40  0.45  0.50  0.55  0.60  0.65  0.70
 *     h    0.058 0.133 0.244 0.370 0.500 0.630 0.756 0.867 0.942
 *
 * and the extent is ≥ 0.99 by u = 0.30, i.e. the bevel is over by 5.8 % of the
 * height rather than eating 13 % of it.
 *
 * Every box in the village and the interior gets a symmetric arris at the floor
 * as a side effect. That is the intended shape — R2 — and it is why the change
 * is made here rather than in a second builder alongside.
 */
const boxHeights = (bevel: number): number[] => {
  const run = 1 - 2 * bevel
  return [
    0,
    0.1 * bevel,
    0.45 * bevel,
    bevel,
    bevel + 0.2 * run,
    bevel + 0.4 * run,
    bevel + 0.6 * run,
    bevel + 0.8 * run,
    1 - bevel,
    1 - 0.45 * bevel,
    1 - 0.1 * bevel,
    1
  ]
}

/**
 * The matching extent profile.
 *
 * Tapers over the first and last three points only — much faster in *parameter*
 * than `CAP_E`, which is the whole point: the extent has to reach full width by
 * the time the height has climbed `bevel`, or the "bevel" is a splayed plinth.
 * Measured: 14 % inset at 1.4 % height, 3.8 % at 2.7 %, 0.7 % at 5.8 %.
 */
const BOX_E = [0, 0.72, 0.97, 1, 1, 1, 1, 1, 1, 0.97, 0.72, 0] as const

/**
 * An upright mass — a wall block, a chimney, a plinth, a hay bale.
 *
 * Distinct from `beam` because its bevel is a *fraction of the height* rather
 * than a fixed distance: a wall 3 m tall wants a 4 cm arris and a bale 0.6 m
 * tall wants the same, so the two cannot share one taper number.
 */
export const box = (options: BoxOptions): StructureMember => {
  const { y0, y1, halfX, halfZ } = options
  const x = options.x ?? 0
  const z = options.z ?? 0
  const height = y1 - y0
  const bevel = options.bevel ?? 0.05
  const batter = options.batter ?? 1
  const heights = boxHeights(bevel)
  const widthAt = (i: number): number => 1 + (batter - 1) * heights[i]!

  return {
    name: options.name,
    path: heights.map(h => [x, y0 + height * h, z] as Vec3),
    extentA: BOX_E.map((e, i) => halfX * e * widthAt(i)),
    extentB: BOX_E.map((e, i) => halfZ * e * widthAt(i)),
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: options.section ?? BEAM_SECTION,
    ...(options.rings ? { rings: options.rings } : {}),
    segments: options.segments ?? 8,
    ...(options.segmentsByTier ? { segmentsByTier: options.segmentsByTier } : {}),
    ...(options.inflate !== undefined ? { inflate: options.inflate } : {}),
    paint: options.paint,
    deep: options.deep,
    ...(options.ao !== undefined ? { ao: options.ao } : {}),
    ...(options.lastTier !== undefined ? { lastTier: options.lastTier } : {}),
    ...(options.firstTier !== undefined ? { firstTier: options.firstTier } : {})
  }
}

export interface RoofOptions {
  name: string
  /** Ridge line, from gable to gable. */
  from: Vec3
  to: Vec3
  /** Half-span of the roof at the eaves. */
  halfSpan: number
  /** Height from eaves to ridge. */
  rise: number
  /** Overhang past each gable, as a fraction of the ridge length. */
  gableOverhang?: number
  /**
   * Sag of the ridge line at its middle, in metres.
   *
   * A thatched roof on a timber frame settles, and the ridge is where it shows.
   * 3–6 cm over a 6 m house is enough to be read and not enough to look broken;
   * zero reads as a modern truss and is the difference between a village and a
   * housing estate.
   */
  sag?: number
  /**
   * Fraction of the ridge the section collapses over at each gable.
   *
   * Defaults to 0.07 for thatch and 0.02 for shingle — see `hipProfile`.
   */
  hip?: number
  /**
   * Which roof this is.
   *
   * Not a `Section` parameter, deliberately: the section, the sample count and
   * the `vOffset` that lands sample 0 on the apex are three numbers that have to
   * move together, and `THATCH_SEGMENTS` was hard-coded against a 16-point list
   * once already (see its note) with the result that every roof in the village
   * came out a dome. One word picks all three.
   */
  kind?: 'thatch' | 'shingle'
  segments?: number
  rings?: readonly (readonly number[])[]
  paint: PaintFn
  deep: Color
  ao?: number
  /** Vertex wind weight. The market stall's awning is the only roof that has one. */
  wind?: number
  lastTier?: number
  firstTier?: number
}

/**
 * A pitched roof, as one extrusion of `THATCH_SECTION` along its own ridge.
 *
 * The section is a *unit* shape, so `halfSpan` and `rise` scale it — which is
 * what lets the eaves' rolled-under lip, the ridge's rounding and the soffit's
 * shallow dish keep their proportions on a cottage and on a barn without being
 * authored twice.
 */
export const roof = (options: RoofOptions): StructureMember => {
  const overhang = options.gableOverhang ?? 0.06
  const sag = options.sag ?? 0.05
  _from.set(options.from[0], options.from[1], options.from[2])
  _to.set(options.to[0], options.to[1], options.to[2])
  _dir.subVectors(_to, _from)
  const length = _dir.length()
  _dir.multiplyScalar(1 / length)

  // Perpendicular to the ridge, horizontal: the span direction.
  _sideA.crossVectors(_dir, AXIS_Y).normalize()

  // The ridge runs from `from` to `to`, extended past both gables by the
  // overhang. The hip profile then places nine control points along that
  // extended line, clustered at the two ends so the half-hip happens over the
  // fraction of it that `hip` names.
  const hip = options.hip ?? (options.kind === 'shingle' ? 0.02 : 0.07)
  const profile = hip === 0.07 ? ROOF_T : hipProfile(hip)
  const path = profile.map(t => {
    const u = -overhang + t * (1 + 2 * overhang)
    // The sag is a half-cosine so it is flat at the gables and deepest in the
    // middle — a parabola in `u` would drop the overhanging ends *below* the
    // gable, which is the opposite of how a ridge settles.
    const droop = sag * Math.sin(Math.PI * Math.max(0, Math.min(1, u)))
    return [
      _from.x + (_to.x - _from.x) * u,
      _from.y + (_to.y - _from.y) * u - droop,
      _from.z + (_to.z - _from.z) * u
    ] as Vec3
  })

  const shingle = options.kind === 'shingle'
  return {
    name: options.name,
    path,
    extentA: ROOF_E.map(e => options.halfSpan * e),
    extentB: ROOF_E.map(e => options.rise * e),
    axisA: _sideA.clone(),
    axisB: AXIS_Y.clone(),
    section: shingle ? SHINGLE_SECTION : THATCH_SECTION,
    ...(options.rings ? { rings: options.rings } : { rings: ROOF_RINGS }),
    // One sample per control point of the section, derived rather than written
    // out — see `THATCH_SEGMENTS`.
    segments: options.segments ?? (shingle ? SHINGLE_SEGMENTS : THATCH_SEGMENTS),
    // Puts the first sample on control point 1, which is the ridge itself, at
    // *any* segment count: sample k sits at 1/24 + k/S, so k = 0 is the apex's
    // own parameter whatever S is.
    vOffset: shingle ? SHINGLE_V_OFFSET : THATCH_V_OFFSET,
    paint: options.paint,
    deep: options.deep,
    ...(options.ao !== undefined ? { ao: options.ao } : {}),
    ...(options.wind !== undefined ? { wind: options.wind } : {}),
    ...(options.lastTier !== undefined ? { lastTier: options.lastTier } : {}),
    ...(options.firstTier !== undefined ? { firstTier: options.firstTier } : {})
  }
}

// ─── Paint helpers ──────────────────────────────────────────────────────────

export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t)

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6))
  return t * t * (3 - 2 * t)
}

/**
 * A repeating band along a parameter, as a 0..1 ridge.
 *
 * The village's whole surface vocabulary — thatch courses, plank seams, a
 * barrel's hoops, the daub between studs — is bands, and every one of them is
 * this function with a different period and a different pair of colours. Written
 * once because a second copy would drift in phase and two planks would stop
 * lining up.
 */
export const bands = (t: number, period: number, sharpness = 6): number => {
  const phase = Math.abs(((t / period) % 1) * 2 - 1)
  return clamp01(phase ** (1 / sharpness))
}

/**
 * The height fraction a `box`'s ring parameter actually lands at.
 *
 * `PaintFn`'s `u` is the *spline parameter of the ring*, not a distance — and
 * the two are deliberately very far apart, because `CAP_T` and `boxHeights` are
 * both non-uniform on purpose. Every paint in the village treats `u` as a
 * fraction anyway, which is harmless for a band pattern and wrong the moment a
 * paint wants to name a height ("the mid-rail at two thirds"). This converts,
 * for the paints that need to.
 *
 * It is *not* applied inside `box` itself. Doing that would silently move every
 * paint in `villageProps.ts` that targets a ring parameter by name — the
 * barrel's hoops at u = 0.3 and 0.7, the well's coping, the fire pit's mouth —
 * and those are correct as written against the rings they aim at.
 */
export const boxHeightAt = (u: number, bevel = 0.045): number => splineAt(boxHeights(bevel), u)

/**
 * Deterministic value noise on the unit torus, C¹ and seamless in `v`.
 *
 * For the daub. A panel of wattle and daub is hand-floated over sticks and is
 * never flat, and the difference between a stylised village and a set of
 * extruded blocks is largely that its big pale surfaces have some life in them.
 *
 * Written as a sum of two low harmonics rather than as hashed per-vertex noise
 * for one reason: **every tier has to agree.** Hashed noise is a function of the
 * vertex *index*, so a coarse tier draws different noise and the crossfade has
 * two unrelated patterns to reconcile — the shading flip GDD R7 says a
 * crossfade cannot hide. A band-limited function of `(u, v)` is sampled by
 * whatever vertices a tier has and reconstructs to the same surface.
 */
export const daubMottle = (u: number, v: number): number => {
  const a = Math.sin(2 * Math.PI * (v * 3 + 0.13)) * Math.sin(Math.PI * (u * 2.3 + 0.41))
  const b = Math.sin(2 * Math.PI * (v * 5 - 0.27)) * Math.sin(Math.PI * (u * 3.7 - 0.19))
  return 0.62 * a + 0.38 * b
}

/**
 * ─── The half-timbered wall ─────────────────────────────────────────────────
 *
 * Takes `u` as a **`box` ring parameter** and `v` as the section parameter, and
 * both are load-bearing: the frame has to survive the wall being rotated,
 * scaled or battered, which a paint keyed off world x/z does not.
 *
 * ── What this can and cannot draw, measured ─────────────────────────────────
 *
 * Vertex colour cannot express a feature narrower than the vertex spacing, and
 * that single fact decides the whole design. A cottage's wall is 5.4 × 4.0 m —
 * an 18.8 m perimeter — so at the 16 samples `WALL_SECTION` runs at, one step is
 * 1.18 m and the narrowest paintable vertical is **2.35 m**. A real Fachwerk
 * post is 15–20 cm. Painting it at 32 segments would cost 320 triangles and
 * still be 1.2 m wide; four *modelled* corner posts cost 64 and are 28 cm (see
 * `village.ts`). So:
 *
 *   * **verticals are geometry** — corner posts and braces are applied members;
 *   * **horizontals are paint**, because a horizontal band costs *rings*, and
 *     `WALL_RINGS` buys a row at the sill, the mid-rail and the plate for 2
 *     segments' worth of triangles each;
 *   * what is left here is the horizontals, the daub, and a soft corner
 *     darkening that sits *under* the modelled posts rather than replacing them.
 *
 * The previous version drew none of the three correctly: its "corner posts" were
 * at v = 0, ¼, ½, ¾ while the section's corners were at 1/12, 4/12, 7/12, 10/12
 * (so they landed mid-face), its mid-rail resolved to height 0.99, and its sill
 * to height 0.0005 — on the collapsed bottom ring. See `WALL_RINGS`.
 */
export const timberFrame = (u: number, v: number, out: Color, bevel = 0.045): void => {
  const h = boxHeightAt(u, bevel)

  // ── The frame's horizontals ───────────────────────────────────────────────
  //
  // Half-widths are set from the *row spacing*, not from a real beam's size: at
  // LOD0 the rows sit at h = 0, 0.064, 0.306, 0.611, 0.850, 0.951, 1, so a band
  // narrower than ~0.05 would put full strength on one row and nothing on its
  // neighbours, and the linear interpolation between them is what the eye reads.
  // 0.055 gives a rail that peaks hard on its own row and is gone by the next.
  const sill = smoothstep(0.075, 0.03, h)
  const plate = smoothstep(0.90, 0.955, h)
  const rail = smoothstep(0.055, 0.012, Math.abs(h - 0.611))

  // ── The corners ───────────────────────────────────────────────────────────
  //
  // Not a post — the posts are modelled. This is the daub darkening into the
  // corner it is packed against, which is what the baked AO would give if a
  // 28 cm re-entrant had any samples in it, and it stops the modelled post
  // reading as a stick glued to a flat panel.
  let corner = 0
  for (const at of WALL_CORNER_V) {
    // Wrapped distance around the section, so the corner at v = 14/16 also
    // catches samples at v just under 1.
    const d = Math.abs(((v - at + 1.5) % 1) - 0.5)
    corner = Math.max(corner, smoothstep(0.075, 0.02, d))
  }

  const wood = clamp01(Math.max(sill, Math.max(plate, rail)))

  // ── The daub ──────────────────────────────────────────────────────────────
  //
  // Panels are mottled rather than flat (see `mottle`), and the mottle is scaled
  // *down* inside the frame members so a rail does not inherit the panel's
  // blotches — timber and daub are different materials and share nothing but a
  // plane.
  const panel = 1 - wood
  out.copy(C.daubBase).lerp(C.daubLit, clamp01(0.34 + 0.40 * h + 0.09 * daubMottle(u, v) * panel))
  // Daub is dirtiest where the ground splashes it, which is the bottom 15 %.
  out.lerp(C.daubShadow, 0.55 * smoothstep(0.18, 0.0, h))
  // Rain runs off the plate and stains the panel below it.
  out.lerp(C.daubShadow, 0.22 * smoothstep(0.80, 0.90, h) * panel)
  out.lerp(C.daubShadow, 0.4 * corner * panel)

  out.lerp(C.timberBase, wood)
  // Lit along the top arris of a horizontal member, which is the only face of it
  // the sun reaches on a wall.
  out.lerp(C.timberLit, wood * 0.38 * (0.35 + 0.65 * h))
}
