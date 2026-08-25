import { BufferAttribute, BufferGeometry, Vector3 } from 'three'
import { measuredRadius, mergeParts } from '../assets/common'
import type { WorldAsset } from '../assets/types'
import { assertTriBudget } from '../geometry/budget'
import { makeRng, type Rng } from '../geometry/rng'
import { WATER_STYLES } from './styles'
import { WATER_ATTRIBUTES, type WaterStyle } from './types'
import { createWaterMaterial } from './waterMaterial'

/**
 * ─── Waterfalls ─────────────────────────────────────────────────────────────
 *
 * Five sizes of the same fall — a knee-high splash, a short wide curtain, a
 * tall broad one, a single thin ribbon, and a narrow grouped pair — all built
 * from one shape function and shaded by one material at one set of style
 * dials. White at the lip, white where it lands, blue-cyan through the middle,
 * and the whole set reads as the same water at different scales because none of
 * them get their own anything.
 *
 * ── Why this returns a `WorldAsset` ─────────────────────────────────────────
 *
 * It would be less code to hand back a single `BufferGeometry` and let the
 * caller place it. Returning the standard four-tier asset instead is what lets a
 * waterfall be registered as an ordinary placeable: it goes through `DitheredLod`,
 * the level editor and the ablation profiler with no special case anywhere. The
 * only thing that had to bend to make that work is `material`, and it didn't —
 * `WaterMaterial extends ToonMaterial`, so it satisfies the field directly.
 *
 * ── The shape, and the three things that make it read as water ──────────────
 *
 * **Strands, not a quad.** The fall is split into separate narrow sheets of
 * uneven width with gaps between them. The gaps are the whole trick: a single
 * flat sheet with a good shader on it still reads as a blue wall, because the
 * silhouette has no structure. Splitting it costs nothing — the triangles were
 * going to be spent on rows either way — and it is what puts the rock behind
 * the fall in view, which is the reference's "one fall split by the rock".
 *
 * **A lip, not a start.** Each strand begins with a short horizontal lap that
 * rolls over a quarter-arc into the drop. Without it the water begins in mid-air
 * on a straight edge. The arc is part of the same path parameterisation rather
 * than a separate part, so the roll-over is C¹ and the analytic normals cross it
 * without a crease (GDD R2).
 *
 * **A ragged bottom.** Strands differ in length, so the lower edge of the fall
 * is broken rather than a ruled line. A straight bottom edge is the single
 * loudest tell that a waterfall is a texture on a plane. `frayAt` then feathers
 * *within* each strand, because per-strand raggedness alone is still a set of
 * ruled lines at different heights.
 *
 * ── The silhouette pass, against the reference curtains ─────────────────────
 *
 * The first version of this file was rejected on look, and three of the four
 * notes were about outline rather than shading:
 *
 * **They read as ribbons, not sheets.** Fixed at the source: `FormSpec.gapFill`
 * is now per form, and the wide forms fill 80–98 % of their slot instead of
 * 62–95 %. Same strand count, same gaps, a fifth of the width.
 *
 * **They are cones, not barrels.** `widenAt` replaces the linear spread with an
 * accelerating flare plus a mid-drop bulge, and `crossBowAt` bows the sheet
 * toward the viewer across its width so it is a curved surface rather than a
 * plane. Both are zero at the outer edge and at `v = 1`, which is what lets them
 * change the shape without changing what the tiers have to agree on.
 *
 * **They start, they do not spill.** `knitAt` widens every strand to fill its
 * whole slot at the lip and relaxes it over the first third of the drop, so the
 * water goes over as one sheet and *breaks* into strands on the way down;
 * `sheetThickness` puts a bead on the lip so the crest has volume in silhouette.
 *
 * The fourth note — no spray — has its own section below.
 *
 * ── Widening, thinning, and why they are one number ─────────────────────────
 *
 * Falling water accelerates, so it spreads and thins. Here the entire lateral
 * coordinate is scaled by `widen(v) = 1 + spread·v` and the sheet thickness is
 * divided by the same factor, which keeps the strand's cross-sectional area
 * roughly constant down its length. Making the two independent dials was the
 * first version and it drifts: a fall tuned to spread nicely ends up either
 * fattening as it falls or vanishing before it lands.
 *
 * Scaling the *whole* lateral coordinate (not each strand about its own centre)
 * is also what keeps the tiers agreeing. The outermost strand edges are pinned
 * to ±1 at the lip, so every tier's outer silhouette is `±halfWidth·widen(v)`
 * regardless of how many strands it has.
 *
 * ── Coarse tiers merge strands, they do not drop them ───────────────────────
 *
 * A tier with fewer strands takes contiguous groups of the LOD0 strands and
 * spans each group from its first strand's left edge to its last's right edge,
 * keeping the group's longest reach. Dropping a strand instead would change
 * where the gaps are, and the gap structure *is* the silhouette here — the
 * dithered crossfade can hide a rounder edge, it cannot hide a hole moving.
 *
 * ── No outline, and this is the deliberate exception ────────────────────────
 *
 * Every prop in this world ships an inverted-hull outline (GDD R6). Water does
 * not, and `outline` is `null` on purpose:
 *
 *   • R6 sets the outline colour to base × 0.22 shifted cool. On a bright cyan
 *     sheet that lands at a near-black line, which is the one colour the whole
 *     art direction bans (R5: shadows fall to periwinkle, never to black).
 *   • The hull is drawn behind a *translucent* surface, so unlike every opaque
 *     prop its interior pixels are visible through the water rather than being
 *     depth-rejected. The result reads as a dark decal stuck to the fall.
 *
 * The silhouette still separates from the terrain, because foam does the job an
 * outline would: `aShore` reaches 0 on every free edge, so the fall is already
 * outlined in white by its own material.
 *
 * ── Attribute conventions this file emits ───────────────────────────────────
 *
 * `aDepth` on a curtain is the sheet's **thickness**, thin at a strand's edges
 * and thickest in its middle, which is what gives each strand a blue core and
 * white edges out of the depth ramp alone. Absolute values are small on purpose:
 * against `fall.depthFalloff` of 0.9 m the thickest sheet in the set is 0.22 m,
 * about a quarter of the way up the ramp, which is the shallow/foam end where
 * `styles.ts` says a waterfall lives.
 *
 * `aShore` is the normalised distance to the sheet's own boundary per
 * `types.ts` — 0 on every free edge (both sides of every strand, the ragged
 * bottom, the lip's back edge) and 1 a foam-width inside. The lateral band is
 * capped at 55 % of the strand's half-width; see `FOAM_BAND_LIMIT`.
 *
 * `aFlow` is a **direction with a relative magnitude around 1**, not an absolute
 * velocity. `WaterStyle.flowSpeed` is "the scale" (`types.ts`) and the material
 * multiplies by it, so baking it in here as well would square it — 5.5 × 5.5 =
 * 30 units/s on the `fall` preset. It points down the curtain, accelerating from
 * 0.55 at the lip to 1.35 at the base, and radially outward on the splash pool,
 * which is what makes the base read as water spreading rather than as a puddle
 * that happens to be underneath.
 *
 * **The vec2 is in the shader's surface frame, and `+y` is downstream.**
 * `waterGlsl.ts` builds `axisV` per vertex from the world normal — world +Z on a
 * horizontal sheet, world down on a curtain — and `axisU = cross(n, axisV)`
 * across it. So a curtain emits `(lateral, +speed)`, **not** `−speed`; a negative
 * second component scrolls the fall *upward*, which is what this file emitted
 * before the frame was generalised and is the first thing to check if a fall
 * ever looks like it is running backwards.
 *
 * The frame rotating with the surface is what lets one uniform value be correct
 * along the whole path, with no per-section special case — and none should be
 * added. On the lip lap the sheet is horizontal, so `axisV` is world +Z, which
 * is exactly where the water is going there. Resolved to world space and
 * measured across all five forms and all four tiers, the drift is downward at
 * every curtain vertex; down beats horizontal by at least 2.25× on the drop, and
 * drops to 0.30× only across the roll-over corner, where the water genuinely is
 * moving over the lip more than it is falling.
 *
 * The same frame settles the lateral sign: `axisU` works out to world +X for
 * both the curtain (`n ≈ +Z`) and the pool (`n ≈ +Y`), which agrees with this
 * file's own `+u`, so a positive lateral component drifts a strand outward.
 *
 * The spray cluster is the exception to the "one convention for the whole file"
 * rule above, and deliberately: it is authored as a *world* direction (outward
 * and up) and converted per vertex by `flowFor`, because a puff's normal points
 * in every direction and there is no single hand-derived answer. See the spray
 * section.
 *
 * ── Spray ───────────────────────────────────────────────────────────────────
 *
 * The base of every reference fall is a soft white cloud, and the falls in this
 * file arrived at a flat disc and stopped. `buildPuffs` / `buildSprayGeometry`
 * add a cluster of lobed shells over the impact point — a mound, a shoulder
 * half-buried in it, and a smaller riser standing in front of the rock face. It
 * is the largest single line item in the new budgets and it is where the round-2
 * increase went; the numbers are in the tier table.
 *
 * Budgets (LOD0/1/2/3), by form. The rise over the first version is spray on
 * every tier but LOD3, plus one extra row on the wide forms to resolve the
 * barrel and the frayed edge:
 *   splash  130 /  70 / 34 / 12      ribbon  190 / 100 / 48 / 18
 *   curtain 300 / 170 / 85 / 26      strands 280 / 160 / 78 / 26
 *   broad   420 / 240 / 120 / 34
 */

export type WaterfallForm = 'splash' | 'curtain' | 'broad' | 'ribbon' | 'strands'

export interface WaterfallOptions {
  seed?: number
  form?: WaterfallForm
  /** Metres, lip to pool surface. */
  height?: number
  /** Metres across at the lip. The fall is wider than this where it lands. */
  width?: number
  /**
   * Lean off vertical, radians, in the plane of the curtain. A dead-plumb fall
   * reads as a texture — the eye has nothing to measure the drop against, so a
   * 10 m ribbon and a 2 m one look identical.
   */
  lean?: number
  style?: WaterStyle
}

const TAU = Math.PI * 2
const HALF_PI = Math.PI / 2

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

const smootherstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

// ─── Form specs ─────────────────────────────────────────────────────────────

interface FormSpec {
  height: number
  width: number
  /** Canonical strand count. Coarse tiers merge these; nothing generates more. */
  strands: number
  /** Sheet thickness at the lip, metres. Feeds `aDepth` and the cross-section bulge. */
  thickness: number
  /** Fraction the curtain widens by between lip and pool. */
  spread: number
  /**
   * Share of its slot a strand fills, min and max. This is the **gap dial**, and
   * it is what separates a sheet from a set of ribbons.
   *
   * Measured against the reference curtains: at the 0.62–0.95 this file shipped
   * with, `broad` came out as six ropes with as much rock visible between them as
   * water — the note the user's rejection opens with. A broad fall in the
   * reference is a *sheet* with seams in it; the gaps are thin dark lines, not
   * columns. So the wide forms are pushed to 0.80–0.98 and the deliberately
   * ribbon-like ones (`ribbon`, `strands`) keep their wide gaps, because for
   * those the gap *is* the form.
   */
  gapFill: readonly [number, number]
  lean: number
  /** Pool radius as a multiple of the fall's half-width where it lands. */
  poolWiden: number
  distanceScale: number
}

/**
 * The five reference sizes. `strands` and `poolWiden` are what separate them as
 * much as the metres do: the splash is nearly all pool, the ribbon is nearly all
 * fall, and reading the two rows against each other is how the set stays
 * recognisable as one material.
 */
const FORMS: Record<WaterfallForm, FormSpec> = {
  // Knee-height and more froth than fall — the pool is nearly twice the width of
  // the water landing in it, which is the whole read of the form.
  splash: {
    height: 0.55, width: 1, strands: 3, thickness: 0.09,
    spread: 0.62, gapFill: [0.72, 0.96], lean: 0.04, poolWiden: 1.7, distanceScale: 0.9
  },
  curtain: {
    height: 2.6, width: 3.4, strands: 5, thickness: 0.16,
    spread: 0.42, gapFill: [0.78, 0.97], lean: 0.045, poolWiden: 1.3, distanceScale: 1.9
  },
  // Six strands across six metres, not eight. With `gapFill` at 0.80–0.98 the
  // strand half-widths land at 0.41–0.50 m against the style's 0.35 m foam band,
  // so every one of them keeps a blue core outright — at the old five-metre
  // width and 0.62–0.95 fill they were 0.26–0.36 m and only `FOAM_BAND_LIMIT`
  // was holding a core open. Eight strands would put them back under 0.35 m, and
  // the core's *width* is the entire difference between this form and `curtain`.
  broad: {
    height: 7, width: 6.2, strands: 6, thickness: 0.22,
    spread: 0.45, gapFill: [0.8, 0.98], lean: 0.035, poolWiden: 1.25, distanceScale: 2.6
  },
  // The tallest and the leanest. A 10 m fall less than a metre wide is a
  // vertical line unless something breaks the plumb, so this form carries both
  // the largest `lean` and by far the largest `spread`.
  ribbon: {
    height: 11, width: 0.7, strands: 2, thickness: 0.1,
    spread: 0.95, gapFill: [0.55, 0.85], lean: 0.1, poolWiden: 2.4, distanceScale: 2.6
  },
  strands: {
    height: 3, width: 1.6, strands: 3, thickness: 0.12,
    spread: 0.52, gapFill: [0.58, 0.88], lean: 0.05, poolWiden: 1.6, distanceScale: 1.5
  }
}

// ─── Tier specs ─────────────────────────────────────────────────────────────

interface WaterfallTier {
  /** Merged strand count for this tier. */
  strands: number
  /** Vertices across a strand. 4 gives a flat blue core; 3 a single ridge; 2 no core. */
  cols: number
  /** Vertices down a strand, lip included. */
  rows: number
  poolSegments: number
  /** 2 = centre + foam ring + rim. 1 = centre + rim, LOD3 only. */
  poolRings: 1 | 2
  /**
   * Puffs in the spray cluster. 0 is the mound over the impact point; the rest
   * are the smaller ones rising around and in front of it. 0 disables spray.
   */
  sprayPuffs: number
  /** Segments around the mound. Satellites take `satelliteSegments` of this. */
  spraySegments: number
  /**
   * Rings on the **mound**. Satellites always take 2 — they are half-buried, and
   * a third ring buys profile on a part of the shell that is inside the mound.
   *
   * 3 is not a luxury on the mound and 2 was measured wrong on screen. A
   * hemisphere sampled at one intermediate ring puts 82 % of its radius and only
   * 27 % of its height into the first band, so it renders as a **flat-topped
   * drum**: a shallow lid on a near-vertical skirt, with a hard crease all the
   * way round where they meet. That is what a spray cluster looked like before
   * this field existed. A third ring at 0.36/0.70/1 splits the fall into three
   * slopes (11°, 36°, ~vertical with a slight undercut from the swell), which is
   * a dome.
   */
  sprayRings: 1 | 2 | 3
  budget: number
}

/**
 * Triangles = strands · (cols−1) · (rows−1) · 2
 *           + poolSegments · (poolRings === 2 ? 3 : 1)
 *           + Σ puffs of segments · (2 · sprayRings − 1),
 *             the mound at `spraySegments` and every satellite at
 *             `satelliteSegments` of it.
 *
 * (The pool term was written `poolSegments · (poolRings + 1)` here for a while
 * and is wrong for `poolRings === 1`: a one-ring pool is a bare fan, so it is
 * `poolSegments` triangles, not twice that. Nothing depended on it — the budgets
 * were set from measurements — but it made every LOD3 row in this table look
 * five triangles more expensive than it is.)
 *
 * Rows are spent, not columns, on every tier that can afford either: a strand is
 * a long thin thing and its silhouette lives in its length. `cols` only rises to
 * 4 where the strand is wide enough for a core to survive the foam band, which
 * is the `curtain`, `broad` and `strands` LOD0 tiers.
 *
 * The rows are evenly spaced along the path, so the lip and bottom foam bands
 * get stretched over their end cells rather than resolved. That is left alone
 * deliberately — the error runs *toward* more white at the lip and at the base,
 * which is the direction the reference wants, so it would be triangles spent to
 * make the fall worse.
 *
 * ── Where the round-2 triangles went ────────────────────────────────────────
 *
 * Every budget in this table rose, and all of the increase is spray plus the one
 * extra row the tall forms needed to resolve the barrel (`crossBowAt`) and the
 * frayed bottom edge (`frayAt`) — a bulge sampled at 7 rows over a 7 m drop is a
 * crease. Measured totals against the new budgets:
 *
 *   splash   129/130 ·  68/70 ·  31/34 ·   9/12
 *   curtain  293/300 · 162/170 ·  82/85 ·  18/26
 *   broad    415/420 · 213/240 · 117/120 ·  24/34
 *   ribbon   187/190 ·  98/100 ·  43/48 ·  14/18
 *   strands  254/280 · 135/160 ·  77/78 ·  18/26
 *
 * The spray share of LOD0 is 45 / 86 / 97 / 70 / 86 triangles in that order, and
 * it is spent on **resolution before puffs**: a ten-segment three-ring mound
 * with two satellites reads as a rounder cloud than a seven-segment two-ring
 * mound with four, and every failure this shape has had on screen — quartz
 * spikes, then a flat-topped drum — was a silhouette with visible corners.
 * `splash` gets one puff at nine segments for the same reason: at knee height
 * its cluster is one small object and it is better round than lumpy.
 *
 * **LOD3 gets no spray at all**, on every form. At the distance LOD3 switches in
 * the mound is a handful of pixels; the three-to-ten triangles the ladder leaves
 * there would buy a triangle-shaped puff, which is worse than none. LOD2 keeps a
 * single mound because it is still the thing that tells the eye where the fall
 * *ends* — a fall whose base goes bare at mid distance reads as a sheet stopping
 * in mid-air, which is the failure this whole pass exists to remove.
 */
const TIERS: Record<WaterfallForm, WaterfallTier[]> = {
  splash: [
    { strands: 3, cols: 3, rows: 6, poolSegments: 8, poolRings: 2, sprayPuffs: 1, spraySegments: 9, sprayRings: 3, budget: 130 },
    { strands: 2, cols: 3, rows: 5, poolSegments: 5, poolRings: 2, sprayPuffs: 1, spraySegments: 7, sprayRings: 2, budget: 70 },
    { strands: 1, cols: 3, rows: 3, poolSegments: 5, poolRings: 2, sprayPuffs: 1, spraySegments: 8, sprayRings: 1, budget: 34 },
    { strands: 1, cols: 2, rows: 3, poolSegments: 5, poolRings: 1, sprayPuffs: 0, spraySegments: 0, sprayRings: 1, budget: 12 }
  ],
  curtain: [
    { strands: 5, cols: 4, rows: 7, poolSegments: 9, poolRings: 2, sprayPuffs: 3, spraySegments: 10, sprayRings: 3, budget: 300 },
    { strands: 4, cols: 3, rows: 7, poolSegments: 8, poolRings: 2, sprayPuffs: 2, spraySegments: 9, sprayRings: 2, budget: 170 },
    { strands: 2, cols: 3, rows: 6, poolSegments: 7, poolRings: 2, sprayPuffs: 1, spraySegments: 7, sprayRings: 2, budget: 85 },
    { strands: 1, cols: 3, rows: 4, poolSegments: 6, poolRings: 1, sprayPuffs: 0, spraySegments: 0, sprayRings: 1, budget: 26 }
  ],
  broad: [
    { strands: 6, cols: 4, rows: 9, poolSegments: 10, poolRings: 2, sprayPuffs: 3, spraySegments: 11, sprayRings: 3, budget: 420 },
    { strands: 5, cols: 3, rows: 7, poolSegments: 9, poolRings: 2, sprayPuffs: 3, spraySegments: 10, sprayRings: 2, budget: 240 },
    { strands: 3, cols: 3, rows: 6, poolSegments: 8, poolRings: 2, sprayPuffs: 1, spraySegments: 11, sprayRings: 2, budget: 120 },
    { strands: 1, cols: 3, rows: 5, poolSegments: 8, poolRings: 1, sprayPuffs: 0, spraySegments: 0, sprayRings: 1, budget: 34 }
  ],
  ribbon: [
    { strands: 2, cols: 3, rows: 13, poolSegments: 7, poolRings: 2, sprayPuffs: 3, spraySegments: 8, sprayRings: 3, budget: 190 },
    { strands: 2, cols: 3, rows: 8, poolSegments: 6, poolRings: 2, sprayPuffs: 1, spraySegments: 8, sprayRings: 2, budget: 100 },
    { strands: 1, cols: 3, rows: 6, poolSegments: 5, poolRings: 2, sprayPuffs: 1, spraySegments: 8, sprayRings: 1, budget: 48 },
    { strands: 1, cols: 2, rows: 5, poolSegments: 6, poolRings: 1, sprayPuffs: 0, spraySegments: 0, sprayRings: 1, budget: 18 }
  ],
  strands: [
    { strands: 3, cols: 4, rows: 9, poolSegments: 8, poolRings: 2, sprayPuffs: 3, spraySegments: 10, sprayRings: 3, budget: 280 },
    { strands: 3, cols: 3, rows: 7, poolSegments: 7, poolRings: 2, sprayPuffs: 2, spraySegments: 9, sprayRings: 2, budget: 160 },
    { strands: 2, cols: 3, rows: 5, poolSegments: 7, poolRings: 2, sprayPuffs: 1, spraySegments: 8, sprayRings: 2, budget: 78 },
    { strands: 1, cols: 3, rows: 4, poolSegments: 6, poolRings: 1, sprayPuffs: 0, spraySegments: 0, sprayRings: 1, budget: 26 }
  ]
}

// ─── Tuning constants ───────────────────────────────────────────────────────

/**
 * The lateral foam band may not exceed this fraction of a strand's half-width.
 *
 * Without the cap, `aShore` is `distance / style.foamWidth` — and measured at the
 * lip across all five forms, **not one strand in the set reaches 1 anywhere**:
 * the cores peak at 0.30–0.42 on the narrow forms and 0.50–0.68 on `broad`. A
 * strand has to be 0.7 m wide before a 0.35 m foam band leaves anything in the
 * middle of it, and none of them are. The whole set renders as one white wall
 * with the gaps present in the geometry and invisible in the shading.
 *
 * At 0.55 every strand keeps a core whose width is proportional to the strand,
 * which is also the right art answer: a thin strand *should* be froth all the way
 * through, and a broad one should not. `splash` is the proof that the cap is not
 * just papering over the problem — it still peaks at 0.77, because its foam is
 * limited by its *length*, not its width, and it stays froth.
 */
const FOAM_BAND_LIMIT = 0.55

/** How far the longest strand dips below the pool surface, so there is no gap. */
const POOL_SINK = 0.04

/** Lateral wander, in turns over the length of the drop. */
const WANDER_TURNS = 0.75

/** Rim deviation from a true ellipse, so the pool is "roughly" elliptical. */
const POOL_WOBBLE = 0.09

/** `aFlow` magnitude at the lip and at the base — relative, see the header. */
const FLOW_LIP = 0.55
const FLOW_BASE = 1.35

/** Sideways share of `aFlow`, per unit of normalised distance off the centreline. */
const FLOW_LATERAL = 0.22

/** `aFlow` magnitude on the splash pool, relative to the same scale. */
const FLOW_POOL = 0.35

// ─── Round-2 silhouette dials ───────────────────────────────────────────────

/**
 * Mid-drop bulge, as a fraction of `spread`, on top of the accelerating flare.
 *
 * The reference curtains are barrels, not cones: widest a little below the
 * middle, and *flaring* again where they land. `widenAt` gets both out of one
 * polynomial, and the barrel term is `v(1−v)` so it is exactly zero at both
 * ends — which is what keeps `widen(1) = 1 + spread` and therefore keeps the
 * outer silhouette of every tier identical, the pinning `buildStrands` relies on.
 */
const BARREL = 0.55

/**
 * How far into the drop the strands stay knitted into one sheet, in `v`.
 *
 * The reference falls do not begin as separated ribbons — the water goes over
 * the lip as a continuous sheet and *breaks* into strands a little way down. So
 * every strand is widened to fill its whole slot at the lip and relaxes to its
 * authored width by here, which opens the gaps as the water falls instead of
 * having them there from the start. Below ~0.2 the split reads as instant and
 * the effect is invisible; above ~0.45 a short fall never separates at all.
 */
const KNIT_SPAN = 0.32

/** Extra sheet thickness rolling over the lip, as a fraction, decaying by `v` 0.18. */
const LIP_BEAD = 0.7

/** Where the frayed bottom edge starts biting, in path fraction `s`. */
const FRAY_FROM = 0.72

// ─── Spray ──────────────────────────────────────────────────────────────────

/**
 * `aShore` at the top of a puff. The rim is 0 (free edge, so pure foam) and this
 * is what the apex reaches.
 *
 * Not 0 everywhere, which was the first version: a puff whose `aShore` is 0 at
 * every vertex is one flat unbroken sheet of `foam`, and a stylised spray cloud
 * needs the depth ramp's cyan somewhere in it or it reads as a snowball. At 0.45
 * the shader's three-step foam band puts two visible steps across the puff — the
 * top takes a cyan wash, the flanks and rim stay white.
 */
const SPRAY_SHORE_MOUND = 0.45
/** The same for the smaller rising puffs, which should be thinner and whiter. */
const SPRAY_SHORE_SATELLITE = 0.26

/** `aFlow` magnitude on spray, relative to the same scale as the curtain's. */
const SPRAY_FLOW = 0.5

/**
 * The rebound direction spray is baked against, before it is projected onto the
 * surface: outward from the impact axis and up. Up dominates — this is water
 * being thrown back off the pool, and a spray cloud whose pattern crawls
 * downward reads as the fall continuing through the ground.
 */
const SPRAY_OUT = 0.55
const SPRAY_UP = 1

/**
 * How far below level a spray drift may end up, as a sine — 0.12 is about 7°.
 *
 * Not 0. Forcing the drift exactly level would mean rotating away the entire
 * vertical component on the flanks too, where it is the rise that makes the
 * cluster read as spray rather than as a lid. This only bites where the shell's
 * own downhill has taken the drift below the horizon; see `sprayDirection`.
 */
const SPRAY_MAX_DIP = 0.12

/**
 * Radial lobe depth on a puff, and the vertical wobble of its rim.
 *
 * Rendered at the first values tried (0.26 and 0.16) the cluster came out as a
 * cluster of **quartz crystals**: at ten segments a ±26 % radius swing puts a
 * concave notch between every pair of vertices, so the silhouette alternates in
 * and out and every face catches a different band of the toon ramp. Spray is
 * lumpy, not spiky. At 0.15 the lobes read as bulges on a round outline, which
 * is what the reference clouds are, and the triangles freed by dropping a
 * satellite go into segments instead — a rounder polygon beats a lobed one.
 */
const SPRAY_LOBE = 0.15
const SPRAY_RIM_WOBBLE = 0.1

/** Flank swell, so a puff is a puff and not a hemisphere. */
const SPRAY_SWELL = 0.38

/**
 * Sweep of the puff shell, in units of a quarter turn.
 *
 * The mound stops at 1 — a hemisphere, open at the bottom, and the opening is
 * buried in the pool where nothing can see it. The satellites float, so they
 * carry a little past it and tuck their rim under; 1.2 (~108°) is enough to hide
 * the opening from anything at or above eye level. Further (1.56 was tried) and
 * the shell closes toward a point underneath, which is the crystal silhouette
 * again from below.
 */
const SPRAY_SWEEP_MOUND = 1
const SPRAY_SWEEP_SATELLITE = 1.2

// ─── Shape ──────────────────────────────────────────────────────────────────

interface Strand {
  /** Span across the lip in normalised [−1, 1]. The outermost edges are pinned. */
  left: number
  right: number
  /**
   * The strand's share of the lip, before the gap was cut out of it. These tile
   * [−1, 1] with no overlap and no hole, which is what lets `knitAt` widen every
   * strand back out to a seamless sheet at the lip without any strand having to
   * know about its neighbours.
   */
  slotLeft: number
  slotRight: number
  /** 1 reaches the pool; below that the strand stops short and the bottom frays. */
  reach: number
}

interface WaterfallShape {
  form: WaterfallForm
  style: WaterStyle
  height: number
  halfWidth: number
  spread: number
  thickness: number
  lean: number
  /** Depth of the horizontal lap at the top, metres. */
  lipDepth: number
  /** Radius of the roll-over arc, metres. */
  lipRadius: number
  /** How far the fall bows out from the rock by the time it lands. */
  bow: number
  /** Peak of the barrel bulge across the curtain's width, metres. */
  crossBow: number
  /** How far the frayed bottom edge can lift a column above the strand's own end. */
  frayAmp: number
  frayPhase: number
  wanderAmp: number
  wanderPhase: number
  strands: Strand[]
  poolCenterX: number
  poolCenterZ: number
  poolRadiusX: number
  poolRadiusZ: number
  poolDepth: number
  poolRise: number
  poolPhase: number
  /** The spray cluster, largest first. Tiers take a prefix of this list. */
  puffs: SprayPuff[]
}

/**
 * Uneven widths and uneven gaps, then the two outer edges pinned to ±1.
 *
 * The pin is not cosmetic. Merging groups of these for a coarse tier preserves
 * whatever the first and last strand's outer edges are, so if they were jittered
 * the fall would be a slightly different width at every tier and the crossfade
 * would have a size mismatch to expose (`geometry/build.ts` has the same problem
 * and the same answer).
 */
const buildStrands = (rng: Rng, count: number, gapFill: readonly [number, number]): Strand[] => {
  const strands: Strand[] = []
  const slot = 2 / count
  for (let i = 0; i < count; i++) {
    const fill = rng.range(gapFill[0], gapFill[1])
    const drift = rng.spread((1 - fill) * 0.45)
    const mid = -1 + slot * (i + 0.5) + drift * slot
    const half = (slot * fill) * 0.5
    strands.push({
      left: mid - half,
      right: mid + half,
      slotLeft: -1 + slot * i,
      slotRight: -1 + slot * (i + 1),
      reach: rng.range(0.88, 1)
    })
  }
  strands[0]!.left = -1
  strands[count - 1]!.right = 1
  return strands
}

/** Contiguous groups of the canonical strands, spanned edge to edge. */
const mergeStrands = (canonical: readonly Strand[], count: number): Strand[] => {
  if (count >= canonical.length) {
    return canonical.slice()
  }
  const merged: Strand[] = []
  for (let g = 0; g < count; g++) {
    const from = Math.round((g * canonical.length) / count)
    const to = Math.max(from + 1, Math.round(((g + 1) * canonical.length) / count))
    let reach = 0
    for (let i = from; i < to; i++) {
      reach = Math.max(reach, canonical[i]!.reach)
    }
    // The group's longest reach, not its mean: the bottom envelope is a
    // silhouette, and averaging would lift it and shrink the tier.
    //
    // The cost of taking the max is that raggedness flattens as groups grow —
    // merging the curtain's five strands into two leaves its two bottoms 0.6 mm
    // apart, because the max of three draws from [0.88, 1] is nearly always ~1.
    // That is the right way round: the *lowest* point of the fall is preserved
    // exactly at every tier, so the crossfade has no silhouette change to
    // expose, and a flat bottom edge on a tier that starts at 45 m is a
    // sub-pixel loss.
    // The merged slot spans the group's slots, so the merged strands still tile
    // [−1, 1] exactly and the knitted lip is seamless at every tier.
    merged.push({
      left: canonical[from]!.left,
      right: canonical[to - 1]!.right,
      slotLeft: canonical[from]!.slotLeft,
      slotRight: canonical[to - 1]!.slotRight,
      reach
    })
  }
  return merged
}

const buildShape = (options: WaterfallOptions): WaterfallShape => {
  const form = options.form ?? 'curtain'
  const spec = FORMS[form]
  const rng = makeRng(options.seed ?? 1)

  const height = options.height ?? spec.height * rng.range(0.85, 1.18)
  const width = options.width ?? spec.width * rng.range(0.85, 1.2)
  const halfWidth = width * 0.5
  const lean = options.lean ?? spec.lean * rng.range(0.6, 1.5)
  const style = options.style ?? WATER_STYLES.fall!

  // Both clamped hard. The lap and its roll-over are read at the top of the
  // fall against the whole drop, so scaling them linearly with height gives an
  // 11 m ribbon a 1.9 m shelf sticking out of the cliff.
  const lipDepth = Math.max(0.18, Math.min(0.5, 0.16 * height + 0.12))
  const lipRadius = Math.min(lipDepth * 0.9, height * 0.14, 0.4)
  const bow = Math.min(0.09 * height, 0.55)

  const spread = spec.spread
  const footX = Math.tan(lean) * height
  const poolRadiusX = halfWidth * (1 + spread) * spec.poolWiden + 0.18
  const poolRadiusZ = Math.max(0.35, poolRadiusX * rng.range(0.5, 0.68))

  const shape: WaterfallShape = {
    form,
    style,
    height,
    halfWidth,
    spread,
    thickness: spec.thickness * rng.range(0.85, 1.15),
    lean,
    lipDepth,
    lipRadius,
    bow,
    // A gentle arc across the width, not a fold: at 16 % of the width it is
    // barely a sixth of the fall's own spread, which is enough to swing the
    // shading and the rim light across the curtain and not enough to make the
    // sheet read as a tube. Capped so a six-metre `broad` does not bulge half a
    // metre into the camera.
    crossBow: Math.min(0.16 * width, 0.5),
    frayAmp: Math.min(0.09 * height, 0.32),
    frayPhase: rng.range(0, TAU),
    wanderAmp: Math.min(0.05 * width, 0.12),
    wanderPhase: rng.range(0, TAU),
    strands: buildStrands(rng, spec.strands, spec.gapFill),
    poolCenterX: footX,
    poolCenterZ: bow,
    poolRadiusX,
    poolRadiusZ,
    poolDepth: Math.min(0.55, 0.06 * height + 0.16),
    poolRise: Math.min(0.06, poolRadiusX * 0.05),
    poolPhase: rng.range(0, TAU),
    puffs: []
  }
  // After the pool, because the cluster is sized and placed against it.
  shape.puffs = buildPuffs(shape, rng)
  return shape
}

// ─── The strand path ────────────────────────────────────────────────────────

interface StrandPath {
  /** Path parameter where the horizontal lap ends. */
  s1: number
  /** Path parameter where the roll-over arc ends and the drop begins. */
  s2: number
  bottomY: number
  /** Vertical extent of the drop leg, metres. */
  drop: number
  /** Total path length, metres — `aShore`'s along-path distances are metric. */
  length: number
}

/**
 * `s` is arc-length fraction along lap → arc → drop, so rows land at even
 * spacing in *metres* whatever the mix of the three a strand happens to have.
 */
const strandPath = (shape: WaterfallShape, strand: Strand): StrandPath => {
  const ragged = Math.min(0.13 * shape.height, 0.55)
  const bottomY = -POOL_SINK + (1 - strand.reach) * ragged
  const drop = Math.max(0.05, shape.height - shape.lipRadius - bottomY)
  const lap = Math.max(0, shape.lipDepth - shape.lipRadius)
  const arc = shape.lipRadius * HALF_PI
  const length = lap + arc + drop
  return { s1: lap / length, s2: (lap + arc) / length, bottomY, drop, length }
}

const bowAt = (shape: WaterfallShape, v: number): number => shape.bow * (0.35 * v + 0.65 * v * v)
const bowSlope = (shape: WaterfallShape, v: number): number => shape.bow * (0.35 + 1.3 * v)

/**
 * Lateral scale of the whole curtain at drop progress `v`.
 *
 * Three properties, and each one is load-bearing:
 *
 *   • **`widen(0) = 1` and `widen(1) = 1 + spread`.** The barrel term vanishes at
 *     both ends, so the lip and the landing width are exactly what the form spec
 *     says and every tier's outer silhouette matches — the pin `buildStrands`
 *     puts on ±1 is only worth having if this holds.
 *   • **It accelerates.** The linear version this replaced spread evenly down the
 *     drop, which is a cone; the reference curtains barely move for the first
 *     third and then throw outward where they land. Falling water accelerates, so
 *     a quadratic is also the honest shape.
 *   • **It bulges.** `BARREL · v(1−v)` peaks at mid-drop, which is the barrel the
 *     reference silhouettes have and a cone does not.
 */
const widenAt = (shape: WaterfallShape, v: number): number =>
  1 + shape.spread * (0.26 * v + 0.74 * v * v + BARREL * v * (1 - v))

/**
 * How much of its slot a strand occupies at `v` — 1 at the lip, 0 once it has
 * relaxed to its authored width. See `KNIT_SPAN`.
 */
const knitAt = (v: number): number => 1 - smootherstep(0, KNIT_SPAN, v)

/** The strand's span at `v`, knitted toward its slot near the lip. Scratch, not owned. */
const _span = { centre: 0, half: 0 }

const spanAt = (strand: Strand, v: number): typeof _span => {
  const knit = knitAt(v)
  const left = strand.left + (strand.slotLeft - strand.left) * knit
  const right = strand.right + (strand.slotRight - strand.right) * knit
  _span.centre = (left + right) * 0.5
  _span.half = (right - left) * 0.5
  return _span
}

/**
 * Sheet thickness, metres. Shared by the position (which bulges by half of it)
 * and by `aDepth` (which *is* it) — they were two copies of the same expression
 * and the lip bead below is exactly the kind of change that would have been made
 * to one of them.
 *
 * The bead is the water rolling over the edge: real water arrives at a lip with
 * depth and thins as it accelerates away, and without it the curtain's crest is
 * the same paper thinness as its middle. It shows in the silhouette from the
 * side, which is where the reference reads as *spilling* rather than as starting.
 */
const sheetThickness = (shape: WaterfallShape, u: number, v: number): number => {
  const bead = 1 + LIP_BEAD * (1 - smootherstep(0, 0.18, v))
  return (shape.thickness * bead * Math.max(0, 1 - u * u)) / widenAt(shape, v)
}

/**
 * Barrel bulge toward the viewer, metres, as a function of the **global**
 * normalised lateral coordinate.
 *
 * Global, not per-strand: every tier samples this at the same lateral position
 * whichever strand happens to own it there, so merging strands cannot move the
 * bulge. Zero at ±1, so the outer silhouette is untouched, and ramped in over
 * the first half of the drop because the lip sits on rock and is straight.
 */
const crossBowAt = (shape: WaterfallShape, across: number, v: number): number =>
  shape.crossBow * Math.max(0, 1 - across * across) * smootherstep(0, 0.55, v)

/**
 * The ragged bottom edge, [0, 1], again as a function of the global lateral
 * coordinate for the same reason as `crossBowAt`.
 *
 * `reach` already varies the bottom *per strand*, which breaks the fall's lower
 * edge into steps — a ruled line per strand. The reference edge is not stepped,
 * it is feathered: the water thins out and runs out at different points across a
 * single strand. Two non-harmonic terms is enough for that at the four to five
 * columns a strand actually has.
 */
const frayAt = (shape: WaterfallShape, across: number): number =>
  0.5 +
  0.5 *
    (Math.sin(across * 5.7 + shape.frayPhase) * 0.6 + Math.sin(across * 11.3 + shape.frayPhase * 1.7 + 2.2) * 0.4)

/** Drop progress in [0,1]; 0 for anything still on the lip or in the roll-over. */
const dropProgress = (path: StrandPath, s: number): number =>
  s <= path.s2 ? 0 : (s - path.s2) / (1 - path.s2)

/**
 * The sheet as a function of `(u, s)` — `u` across a strand in [−1,1], `s` along
 * its path in [0,1]. Continuous everywhere, which is what makes every tier the
 * same object and the normals below meaningful.
 *
 * The cross-section is a shallow convex arc, not a flat ribbon: the strand bulges
 * half its own thickness along the *centreline's* sheet normal, so the bulge is
 * upward on the horizontal lap and toward the viewer on the drop. Flat would be
 * cheaper by nothing at all and would give every vertex of a strand the same
 * normal, which kills the rim light that R5 makes mandatory and takes the
 * edge-lit look of the reference with it.
 */
const evalStrandPoint = (
  shape: WaterfallShape,
  strand: Strand,
  path: StrandPath,
  u: number,
  s: number,
  out: Vector3
): Vector3 => {
  const a = shape.lipRadius
  let y: number
  let z: number
  let tangentY: number
  let tangentZ: number
  let v: number

  if (s < path.s1) {
    // Horizontal lap: the water is already moving before it has anywhere to fall.
    y = shape.height
    z = -shape.lipDepth + (s / path.s1) * (shape.lipDepth - a)
    tangentY = 0
    tangentZ = 1
    v = 0
  } else if (s < path.s2) {
    // Quarter arc, tangent-matched to the lap at one end and the drop at the
    // other — this is the bevel R2 asks for, expressed in the path instead of
    // in a cut plane.
    const theta = ((s - path.s1) / (path.s2 - path.s1)) * HALF_PI
    y = shape.height - a + a * Math.cos(theta)
    z = -a + a * Math.sin(theta)
    tangentY = -Math.sin(theta)
    tangentZ = Math.cos(theta)
    v = 0
  } else {
    v = (s - path.s2) / (1 - path.s2)
    y = shape.height - a - path.drop * v
    z = bowAt(shape, v)
    const dz = bowSlope(shape, v)
    const len = Math.hypot(path.drop, dz)
    tangentY = -path.drop / len
    tangentZ = dz / len
  }

  const widen = widenAt(shape, v)
  const span = spanAt(strand, v)
  const centre = span.centre
  const half = span.half
  // Zero at the lip, so every tier leaves the edge in exactly the same place no
  // matter which strands were merged into which.
  const wander =
    shape.wanderAmp *
    smootherstep(0, 0.22, v) *
    Math.sin(v * WANDER_TURNS * TAU + centre * 3.1 + shape.wanderPhase)
  const across = centre + u * half
  const lateral = across * shape.halfWidth * widen + wander
  const thickness = sheetThickness(shape, u, v)
  // Only bites over the last quarter of the path, so the lip, the roll-over and
  // the whole upper drop are untouched by it.
  const fray = shape.frayAmp * frayAt(shape, across) * smootherstep(FRAY_FROM, 1, s)

  // Sheet normal of the centreline frame: T × x̂ = (0, tangentZ, −tangentY).
  out.x = lateral + Math.tan(shape.lean) * (shape.height - y)
  out.y = y + tangentZ * thickness * 0.5 - fray
  out.z = z - tangentY * thickness * 0.5 + crossBowAt(shape, across, v)
  return out
}

const _pa = new Vector3()
const _pb = new Vector3()
const _pc = new Vector3()
const _pd = new Vector3()
const _du = new Vector3()
const _ds = new Vector3()

/**
 * Central differences on the sheet function, not on the mesh (GDD R3).
 *
 * Same reasoning as `blobGeometry`: a fixed-angle smoothing pass leaves a
 * 13-row ribbon smooth and a 5-row one faceted, so the *shading* would change
 * at every LOD boundary and no crossfade can hide that. The epsilons are
 * one-sided at the parameter boundaries, which is fine — the cross product only
 * needs the plane, not the magnitude.
 */
const EPS_U = 0.03
const EPS_S = 0.004

const strandNormal = (
  shape: WaterfallShape,
  strand: Strand,
  path: StrandPath,
  u: number,
  s: number,
  out: Vector3
): Vector3 => {
  evalStrandPoint(shape, strand, path, Math.min(1, u + EPS_U), s, _pa)
  evalStrandPoint(shape, strand, path, Math.max(-1, u - EPS_U), s, _pb)
  evalStrandPoint(shape, strand, path, u, Math.min(1, s + EPS_S), _pc)
  evalStrandPoint(shape, strand, path, u, Math.max(0, s - EPS_S), _pd)

  _du.subVectors(_pa, _pb)
  _ds.subVectors(_pc, _pd)
  out.crossVectors(_ds, _du)

  if (!(out.lengthSq() > 1e-16)) {
    // Positive test, so a NaN lands here rather than sliding past — the failure
    // mode `assertFiniteGeometry` exists for.
    out.set(0, 0, 1)
    return out
  }
  return out.normalize()
}

// ─── Strand geometry ────────────────────────────────────────────────────────

const buildStrandGeometry = (
  shape: WaterfallShape,
  strand: Strand,
  cols: number,
  rows: number
): BufferGeometry => {
  const path = strandPath(shape, strand)
  const count = cols * rows
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const depth = new Float32Array(count)
  const shore = new Float32Array(count)
  const flow = new Float32Array(count * 2)
  const point = new Vector3()
  const normal = new Vector3()

  for (let r = 0; r < rows; r++) {
    const s = r / (rows - 1)
    const v = dropProgress(path, s)
    const widen = widenAt(shape, v)
    // Read off the scratch immediately — `evalStrandPoint` below reuses it.
    const spanCentre = spanAt(strand, v).centre
    const spanHalf = _span.half
    const halfMetres = spanHalf * shape.halfWidth * widen
    // The band is metric, so a strand that is narrow relative to `foamWidth`
    // is genuinely all foam — which is the splash form's whole look.
    const band = Math.max(1e-4, Math.min(shape.style.foamWidth, halfMetres * FOAM_BAND_LIMIT))
    const endBand = Math.max(1e-4, shape.style.foamWidth)
    const endShore = Math.min(s, 1 - s) * path.length / endBand
    const speed = FLOW_LIP + (FLOW_BASE - FLOW_LIP) * v

    for (let c = 0; c < cols; c++) {
      const u = cols === 1 ? 0 : (c / (cols - 1)) * 2 - 1
      const i = r * cols + c

      evalStrandPoint(shape, strand, path, u, s, point)
      strandNormal(shape, strand, path, u, s, normal)

      positions[i * 3] = point.x
      positions[i * 3 + 1] = point.y
      positions[i * 3 + 2] = point.z
      normals[i * 3] = normal.x
      normals[i * 3 + 1] = normal.y
      normals[i * 3 + 2] = normal.z

      depth[i] = sheetThickness(shape, u, v)
      shore[i] = clamp01(Math.min((halfMetres * (1 - Math.abs(u))) / band, endShore))

      const offCentre = spanCentre + u * spanHalf
      // `+x` in the shader's surface frame is `cross(n, axisV)`. Worked through
      // for this geometry: on the drop `n ≈ (0,0,1)` and `axisV ≈ (0,−1,0)`, so
      // `axisU = (1,0,0)`; on the pool `n ≈ (0,1,0)` and `axisV = (0,0,1)`, so
      // `axisU = (1,0,0)` again. Both agree with this file's own `+u`, so a
      // positive `offCentre` drifts outward. If that ever inverts, the strands
      // splay inward and the fall reads as a funnel.
      flow[i * 2] = speed * (Math.tan(shape.lean) + FLOW_LATERAL * offCentre)
      // `+y` is downstream — see the header. Negative here scrolls the fall
      // upward, which is what this emitted before the frame was generalised.
      flow[i * 2 + 1] = speed
    }
  }

  // Winding matches the analytic normal (∂s × ∂u, which is +z on the drop), so
  // the front face is the one the player is standing in front of.
  const indices: number[] = []
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c
      const b = a + 1
      const d = a + cols
      const e = d + 1
      indices.push(a, d, b, b, d, e)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('aDepth', new BufferAttribute(depth, 1))
  geometry.setAttribute('aShore', new BufferAttribute(shore, 1))
  geometry.setAttribute('aFlow', new BufferAttribute(flow, 2))
  geometry.setIndex(indices)
  return geometry
}

// ─── Splash pool ────────────────────────────────────────────────────────────

const poolPoint = (shape: WaterfallShape, t: number, theta: number, out: Vector3): Vector3 => {
  const wobbleX = 1 + POOL_WOBBLE * Math.sin(3 * theta + shape.poolPhase)
  const wobbleZ = 1 + POOL_WOBBLE * Math.sin(3 * theta + shape.poolPhase + 1.9)
  out.x = shape.poolCenterX + t * shape.poolRadiusX * wobbleX * Math.cos(theta)
  out.y = shape.poolRise * (1 - t * t)
  out.z = shape.poolCenterZ + t * shape.poolRadiusZ * wobbleZ * Math.sin(theta)
  return out
}

const EPS_T = 0.01
const EPS_THETA = 0.01

const poolNormal = (shape: WaterfallShape, t: number, theta: number, out: Vector3): Vector3 => {
  if (t <= 0) {
    // Apex of the dome. Every θ collapses to the same point there, so the
    // difference is degenerate and the answer is known exactly instead.
    return out.set(0, 1, 0)
  }
  poolPoint(shape, t, theta + EPS_THETA, _pa)
  poolPoint(shape, t, theta - EPS_THETA, _pb)
  poolPoint(shape, Math.min(1, t + EPS_T), theta, _pc)
  poolPoint(shape, Math.max(0, t - EPS_T), theta, _pd)

  _du.subVectors(_pa, _pb)
  _ds.subVectors(_pc, _pd)
  out.crossVectors(_du, _ds)

  if (!(out.lengthSq() > 1e-16)) {
    return out.set(0, 1, 0)
  }
  out.normalize()
  if (out.y < 0) {
    out.negate()
  }
  return out
}

/**
 * A low, roughly elliptical, near-flat disc, wider than the fall and offset to
 * sit under where the fall actually lands (the lean and the bow both move that).
 *
 * **`aDepth` is zero at the impact point and zero at the rim, with the water in
 * between.** That is not a mistake: `aDepth` is optical depth, and directly under
 * the fall the water is aerated white froth with nothing to see through, which is
 * exactly what `fall.shallow = C.waterFoam` resolves to. The result is the
 * reference's pool — white where it lands, a ring of blue-cyan around that, foam
 * again at the rim.
 *
 * The pool is also the only horizontal surface in the asset, so it is the only
 * part the material's wave displacement and crest foam reach at all
 * (`waterGlsl.ts` gates both on `abs(normal.y)`). All of "heavy foam where they
 * land" comes from here; the curtain's whites are entirely `aShore`.
 */
const buildPoolGeometry = (shape: WaterfallShape, segments: number, rings: 1 | 2): BufferGeometry => {
  // The foam band measured in from the rim, clamped so it can neither swallow
  // the disc on a splash nor become a hairline on a broad fall's pool.
  const inner = Math.max(0.4, Math.min(0.82, 1 - shape.style.foamWidth / shape.poolRadiusX))
  const radii = rings === 2 ? [inner, 1] : [1]

  const count = 1 + segments * radii.length
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const depth = new Float32Array(count)
  const shore = new Float32Array(count)
  const flow = new Float32Array(count * 2)
  const point = new Vector3()
  const normal = new Vector3()

  poolPoint(shape, 0, 0, point)
  poolNormal(shape, 0, 0, normal)
  positions[0] = point.x
  positions[1] = point.y
  positions[2] = point.z
  normals[0] = normal.x
  normals[1] = normal.y
  normals[2] = normal.z
  // With two rings the centre is the aerated impact point. With one it stands in
  // for the whole disc, so it carries the area-weighted average instead — the
  // alternative is LOD3 turning the pool solid white and popping against LOD2.
  depth[0] = rings === 2 ? 0 : shape.poolDepth * 0.45
  shore[0] = 1
  flow[0] = 0
  flow[1] = 0

  for (let ring = 0; ring < radii.length; ring++) {
    const t = radii[ring]!
    for (let i = 0; i < segments; i++) {
      const theta = (i / segments) * TAU
      const index = 1 + ring * segments + i

      poolPoint(shape, t, theta, point)
      poolNormal(shape, t, theta, normal)
      positions[index * 3] = point.x
      positions[index * 3 + 1] = point.y
      positions[index * 3 + 2] = point.z
      normals[index * 3] = normal.x
      normals[index * 3 + 1] = normal.y
      normals[index * 3 + 2] = normal.z

      const rim = t >= 1
      depth[index] = rim ? 0 : shape.poolDepth
      shore[index] = rim ? 0 : 1
      // Radial, decelerating outward — spreading water slows as its ring grows.
      const speed = FLOW_POOL * (1 - 0.35 * t)
      flow[index * 2] = Math.cos(theta) * speed
      flow[index * 2 + 1] = Math.sin(theta) * speed
    }
  }

  // Reversed relative to the natural (θ, t) order so the face normal comes out
  // +y and matches the analytic one.
  const indices: number[] = []
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments
    indices.push(0, 1 + next, 1 + i)
  }
  for (let ring = 0; ring < radii.length - 1; ring++) {
    const innerBase = 1 + ring * segments
    const outerBase = innerBase + segments
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments
      indices.push(innerBase + i, innerBase + next, outerBase + i)
      indices.push(innerBase + next, outerBase + next, outerBase + i)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('aDepth', new BufferAttribute(depth, 1))
  geometry.setAttribute('aShore', new BufferAttribute(shore, 1))
  geometry.setAttribute('aFlow', new BufferAttribute(flow, 2))
  geometry.setIndex(indices)
  return geometry
}

// ─── The shader's surface frame, reproduced ─────────────────────────────────

const _frameU = new Vector3()
const _frameV = new Vector3()
const _flowDir = new Vector3()
const _flowAlt = new Vector3()
const _flowUp = new Vector3()

/**
 * The per-vertex frame `waterGlsl.ts` builds, line for line.
 *
 * `aFlow` is expressed in this frame, not in world space, so anything that wants
 * to bake a *world* direction — which is what spray is authored as, "outward and
 * up" — has to know it. The curtain and the pool get away with hand-derived
 * constants because their normals are (0,0,±1) and (0,1,0) and the frame works
 * out to world axes; a spray puff's normal points everywhere, and hand-deriving
 * that would be four cases and a table of measurements that goes stale.
 *
 * Two details that look like they could be tidied and cannot:
 *
 *   • `(0,−1,0) + n·n.y` is **not normalised before the mix**. Its length is the
 *     normal's horizontal extent, so it is short on a near-flat surface and the
 *     mix toward world +Z is correspondingly dominant there. Normalising first
 *     gives a different frame from the shader's, which is worse than a slightly
 *     odd one — the whole point is to agree with what will actually be sampled.
 *   • `axisU = cross(n, axisV)` is not unit length wherever `n` and `axisV` are
 *     not perpendicular (anywhere `n.z ≠ 0` and the surface is neither flat nor
 *     vertical). That is the shader's frame too, so `flowFor` inherits it: a
 *     direction baked there scrolls a little slower than its magnitude says. The
 *     error is at most `1 − |axisU|` and it is a speed, not a direction.
 */
const surfaceFrame = (normal: Vector3, axisU: Vector3, axisV: Vector3): void => {
  const flat = Math.abs(normal.y)
  axisV.set(normal.x * normal.y, normal.y * normal.y - 1, normal.z * normal.y)
  axisV.set(axisV.x * (1 - flat), axisV.y * (1 - flat), axisV.z * (1 - flat) + flat)
  if (axisV.lengthSq() > 1e-12) {
    axisV.normalize()
  } else {
    axisV.set(0, 0, 1)
  }
  axisU.crossVectors(normal, axisV)
}

/**
 * `aFlow` for a vertex whose analytic normal is `normal` and whose water travels
 * in world direction `direction` (unit).
 *
 * A world displacement `d` changes the shader's sample coordinate by
 * `(d·axisU, d·axisV)`, and the shader scrolls the sample point *against*
 * `aFlow` — so a feature appears to travel along `aFlow` in exactly this
 * coordinate. Two dot products is the whole conversion.
 *
 * Any part of `direction` along the normal is dropped, because there is no way
 * to show motion out of a surface by scrolling a pattern across it. Callers that
 * care hand in a direction already tangent to their own surface.
 */
const flowFor = (normal: Vector3, direction: Vector3, magnitude: number, out: Float32Array, at: number): void => {
  surfaceFrame(normal, _frameU, _frameV)
  out[at] = direction.dot(_frameU) * magnitude
  out[at + 1] = direction.dot(_frameV) * magnitude
}

// ─── Spray ──────────────────────────────────────────────────────────────────

/**
 * ── What was missing, and why it is geometry rather than a shader channel ────
 *
 * Every reference fall has a soft white cloud where it lands, and one has mist
 * standing in front of the rock face beside it. This file had a flat elliptical
 * disc and nothing above it, so the water arrived at the pool and simply stopped
 * — the single clearest reason the falls read as sheets hung in front of a cliff
 * rather than as water hitting something.
 *
 * It cannot come from the material. Spray is *volume above the pool*: it has a
 * silhouette against the sky, it occludes the bottom of the curtain, and it is
 * lit from a different set of angles than the sheet behind it. None of those are
 * things a fragment program on the existing surfaces can produce.
 *
 * ── Shape ───────────────────────────────────────────────────────────────────
 *
 * A cluster of lobed hemispheroid shells: a mound over the impact, a shoulder
 * half-buried in it, and a riser standing a little above and in front. Three
 * shapes, one function.
 *
 * **Roundness first, lumpiness second.** This is the opposite of the order the
 * shape was first built in and both wrong answers are worth recording, because
 * both looked reasonable in the parameters and neither did on screen:
 *
 *   • deep lobes (0.26) at ten segments put a concave notch between every pair
 *     of vertices, and the cluster rendered as a heap of **quartz crystals**;
 *   • a two-ring shell puts 82 % of its radius and 27 % of its height into the
 *     first band, so it rendered as a **flat-topped drum** with a hard crease
 *     round the join.
 *
 * What reads as spray is a round outline with shallow bulges on it, which is
 * segments and rings before lobe depth and before puff count. Hence
 * `SPRAY_LOBE` at 0.15 and a three-ring mound.
 *
 * The cluster, not one shell, is what gives mist *height* without a mound the
 * size of the pool. The satellites overlap the mound rather than standing clear
 * of it — clear, they read as separate objects in a row — and both sit in the
 * +Z half, so they stand in front of the curtain rather than inside the rock
 * behind it. That placement is also the sorting fix — see `buildTier`.
 *
 * ── `aFlow`, and why it is not (0, 1) ───────────────────────────────────────
 *
 * Spray is water coming *back* off the pool. Baked with the curtain's downward
 * flow it reads as the fall continuing through the ground, which is worse than
 * no spray. So every spray vertex is authored against a world direction —
 * `SPRAY_OUT` outward from the impact axis plus `SPRAY_UP` up — and converted
 * into the shader's surface frame by `flowFor`.
 *
 * The direction is first projected onto the shell's own tangent plane, since the
 * component through the surface cannot be shown. What survives is worth being
 * precise about, because it is not "outward and up" everywhere and cannot be:
 *
 *   • on the **flanks**, where the shell is steep, the surviving tangent runs
 *     up the outside of the puff — the rise;
 *   • on the **top**, where the shell is shallow, it runs outward and follows
 *     the surface's own slope, so it is up to about 9° below horizontal — the
 *     spread. Nowhere near falling, and it is what makes a wide shallow mound
 *     read as billowing out rather than boiling in place;
 *   • on the ring between them the projection collapses, and there it blends to
 *     **around** the shell, which is degenerate only at the apex. Churn is the
 *     honest answer where a rebound cannot be drawn at all.
 *
 * "Up, projected onto the surface" was the first fallback and it is wrong in a
 * way worth recording: on a dome, up-along-the-surface points at the apex, so it
 * is *inward*, and it pulled the whole field of a squat mound toward its middle.
 */

interface SprayPuff {
  x: number
  y: number
  z: number
  radiusX: number
  radiusZ: number
  /** Apex height above `y`. The rim sits at `y + height·cos(sweep·π/2)`. */
  height: number
  /** Quarter-turns of shell. 1 is a hemisphere; more curls back under. */
  sweep: number
  phase: number
  /** `aShore` at the apex; the rim is always 0. */
  shoreCore: number
}

/**
 * The cluster: one mound over the impact point, then satellites around it.
 *
 * Sized off the fall's landing width *and* its height, not one or the other.
 * Width alone gives an eleven-metre `ribbon` — 0.7 m across — a puff the size of
 * a football; height alone gives the 0.55 m `splash` a cloud twice its own drop.
 * The `sqrt` on height is the same reasoning a plume gets its energy from the
 * drop but throws it into a growing volume.
 */
const buildPuffs = (shape: WaterfallShape, rng: Rng): SprayPuff[] => {
  const landing = shape.halfWidth * widenAt(shape, 1)
  const radius = landing * 0.7 + 0.1 * Math.sqrt(shape.height) + 0.12
  // Low, but not a pancake. At `radius · 1.1` — taller than wide — the mound
  // stood in front of the curtain as an object with a top and two sides and hid
  // the landing instead of surrounding it; at 0.62 it lost the dome profile
  // altogether. Spray at the foot of a fall is a low bank the water disappears
  // *into*, which is about three quarters as tall as it is across.
  const height = Math.min(0.3 * shape.height, radius * 0.75) + 0.08

  const puffs: SprayPuff[] = [
    {
      x: shape.poolCenterX,
      // The rim of a `sweep: 1` shell is exactly at `y`, so this puts it on the
      // pool surface and buries the shell's open bottom in it.
      y: shape.poolRise * 0.4,
      z: shape.poolCenterZ + radius * 0.12,
      radiusX: radius,
      // Squashed along Z for the same reason the pool is: the fall is a wide thin
      // thing, and a circular mound in front of it hides the curtain it belongs to.
      radiusZ: radius * 0.6,
      height,
      sweep: SPRAY_SWEEP_MOUND,
      phase: rng.range(0, TAU),
      shoreCore: SPRAY_SHORE_MOUND
    }
  ]

  // Two satellites, and they are different jobs rather than two draws from one
  // distribution. Both are generated unconditionally so that a coarse tier
  // taking a prefix of this list gets the *same* puffs as the fine one — a tier
  // that regenerated its own would move them, and the dithered crossfade cannot
  // hide a cloud jumping sideways.
  //
  // Both **overlap the mound**, deliberately. Placed clear of it at half a
  // radius out they read as separate objects standing in a row; sunk into it
  // they are bulges on one cloud, which is what makes a cluster a cluster.

  // The shoulder: beside where the water lands, half-buried, and the reason the
  // mound has an uneven top instead of one dome's profile.
  const shoulderAngle = rng.range(0.12, 0.5) * Math.PI * (rng() < 0.5 ? 1 : -1)
  const shoulderScale = rng.range(0.34, 0.46)
  puffs.push({
    x: shape.poolCenterX + Math.cos(shoulderAngle) * radius * rng.range(0.42, 0.62),
    y: shape.poolRise * 0.4 + height * rng.range(0.2, 0.42),
    z: shape.poolCenterZ + Math.abs(Math.sin(shoulderAngle)) * radius * 0.4,
    radiusX: radius * shoulderScale,
    radiusZ: radius * shoulderScale * 0.85,
    height: height * rng.range(0.6, 0.95),
    sweep: SPRAY_SWEEP_SATELLITE,
    phase: rng.range(0, TAU),
    shoreCore: SPRAY_SHORE_SATELLITE
  })

  // The riser: mist standing off the rock face, which is the second thing the
  // references show and the one the mound cannot do — a bank on the pool has no
  // silhouette above the pool. Small, high, and pushed to +Z so it stands in
  // *front* of the curtain rather than inside the cliff behind it.
  const riserScale = rng.range(0.2, 0.3)
  puffs.push({
    x: shape.poolCenterX + rng.spread(radius * 0.45),
    y: shape.poolRise * 0.4 + height * rng.range(0.95, 1.4),
    z: shape.poolCenterZ + radius * rng.range(0.2, 0.45),
    radiusX: radius * riserScale,
    radiusZ: radius * riserScale * 0.85,
    height: height * rng.range(0.4, 0.62),
    sweep: SPRAY_SWEEP_SATELLITE,
    phase: rng.range(0, TAU),
    shoreCore: SPRAY_SHORE_SATELLITE
  })
  return puffs
}

/**
 * `t` from apex (0) to rim (1), `θ` around. Continuous in both, so the central
 * differences below are the shape's own normals and not the mesh's (GDD R3).
 *
 * The swell term is what stops this being a hemisphere: it peaks halfway down
 * the shell, so the widest point of a puff sits below its top and the profile
 * is convex — which is the difference between a cloud and a dome.
 */
const sprayPoint = (puff: SprayPuff, t: number, theta: number, out: Vector3): Vector3 => {
  const a = t * puff.sweep * HALF_PI
  const rise = Math.cos(a)
  const reach = Math.sin(a)
  const lobe =
    1 + SPRAY_LOBE * (Math.sin(3 * theta + puff.phase) * 0.62 + Math.sin(5 * theta + puff.phase * 1.7 + 2.1) * 0.38)
  const swell = 1 + SPRAY_SWELL * rise * reach
  const radial = reach * lobe * swell
  out.x = puff.x + puff.radiusX * radial * Math.cos(theta)
  out.z = puff.z + puff.radiusZ * radial * Math.sin(theta)
  out.y = puff.y + puff.height * (rise + SPRAY_RIM_WOBBLE * reach * Math.sin(2 * theta + puff.phase + 0.7))
  return out
}

const EPS_SPRAY_T = 0.012
const EPS_SPRAY_THETA = 0.012

const sprayNormal = (puff: SprayPuff, t: number, theta: number, out: Vector3): Vector3 => {
  if (t <= 0) {
    // The apex is one point for every θ, so the θ difference is degenerate there
    // and the answer is known exactly instead. Same case as `poolNormal`'s centre.
    return out.set(0, 1, 0)
  }
  sprayPoint(puff, t, theta + EPS_SPRAY_THETA, _pa)
  sprayPoint(puff, t, theta - EPS_SPRAY_THETA, _pb)
  sprayPoint(puff, Math.min(1, t + EPS_SPRAY_T), theta, _pc)
  sprayPoint(puff, Math.max(0, t - EPS_SPRAY_T), theta, _pd)

  _du.subVectors(_pa, _pb)
  _ds.subVectors(_pc, _pd)
  // ∂θ × ∂t, which for this parameterisation comes out pointing away from the
  // shell's axis and upward — the same handedness `poolNormal` uses.
  out.crossVectors(_du, _ds)

  if (!(out.lengthSq() > 1e-16)) {
    return out.set(0, 1, 0)
  }
  return out.normalize()
}

/**
 * The world direction the spray at `point` is travelling, tangent to the shell.
 * See the section header for why it is blended rather than switched.
 */
const sprayDirection = (puff: SprayPuff, point: Vector3, normal: Vector3, out: Vector3): Vector3 => {
  const offsetX = point.x - puff.x
  const offsetZ = point.z - puff.z
  const horizontal = Math.hypot(offsetX, offsetZ)
  out.set(0, SPRAY_UP, 0)
  if (horizontal > 1e-5) {
    out.x = (offsetX / horizontal) * SPRAY_OUT
    out.z = (offsetZ / horizontal) * SPRAY_OUT
  }
  out.normalize()
  out.addScaledVector(normal, -out.dot(normal))
  const strength = out.length()

  // Tangent basis. `cross(n, up)` is the shell's contour line: tangent to the
  // surface *and* exactly level, both by construction. `cross(contour, n)` is
  // then the up-slope, whose `y` is the normal's horizontal extent and so is
  // never negative. Two orthonormal axes, one of which carries the whole
  // vertical component of anything in the tangent plane — which is what makes
  // the dip clamp below an exact bound rather than an approximation.
  const slope = Math.hypot(normal.x, normal.z)
  if (slope < 1e-5) {
    // The apex: the tangent plane is horizontal, every direction in it is level,
    // and the clamp has nothing to do. One of them is as outward as another, so
    // whatever survived the projection stands.
    return strength > 1e-6 ? out.multiplyScalar(1 / strength) : out.set(1, 0, 0)
  }
  _flowAlt.set(-normal.z / slope, 0, normal.x / slope)
  _flowUp.set((-normal.x * normal.y) / slope, slope, (-normal.z * normal.y) / slope)

  // Sign the contour to agree with the drift it is about to be blended with.
  // **Measured**: without this, a vertex whose drift ran against the contour got
  // a lerp between two nearly opposite unit vectors — a very short result, and
  // normalising a short vector amplifies whatever survived. A −8.8° drift came
  // out at −19°, which is how a clamp that read as correct did nothing at all.
  if (strength > 1e-6) {
    out.multiplyScalar(1 / strength)
    if (out.dot(_flowAlt) < 0) {
      _flowAlt.negate()
    }
  } else {
    if (_flowAlt.x * -offsetZ + _flowAlt.z * offsetX < 0) {
      _flowAlt.negate()
    }
    out.copy(_flowAlt)
  }
  out.lerp(_flowAlt, 1 - smootherstep(0.12, 0.45, strength)).normalize()

  // ── The never-below-level clamp ───────────────────────────────────────────
  //
  // On the shallow top of a shell, "outward along the surface" is also
  // "downhill", and how far downhill is the shell's own slope — which is not
  // small: measured over every form and forty seeds it reached **30.7° below
  // horizontal** on `broad`, which stops reading as a cloud spreading and starts
  // reading as water running off a dome.
  //
  // A convex shell cannot offer outward *and* up in the same place, so the
  // choice is which to give up, and "not falling" is the whole reason spray is
  // authored against a rebound direction at all. Rotating within the tangent
  // plane — rather than mixing toward the contour — is what makes the bound
  // exact: the result is still a unit tangent and its `y` is `slope · climb`.
  const floor = Math.max(-1, -SPRAY_MAX_DIP / slope)
  if (out.dot(_flowUp) < floor) {
    const along = out.dot(_flowAlt) < 0 ? -1 : 1
    out.set(0, 0, 0)
    out.addScaledVector(_flowAlt, along * Math.sqrt(Math.max(0, 1 - floor * floor)))
    out.addScaledVector(_flowUp, floor)
    out.normalize()
  }
  return out
}

/**
 * Satellites are coarser than the mound — they are smaller and further inside
 * the cluster. Proportional rather than a fixed subtraction, because the mound
 * segment counts now span 7 to 14 and a constant offset makes the coarse end
 * degenerate while barely touching the fine end.
 */
const satelliteSegments = (segments: number): number => Math.max(4, Math.round(segments * 0.6))

const SPRAY_RADII: Record<1 | 2 | 3, readonly number[]> = {
  1: [1],
  // Just above the widest point of the swell, so the two chords apex→ring→rim
  // sit either side of it. At 0.55 the ring landed below the bulge and the top
  // of the puff came out as a long straight cone.
  2: [0.48, 1],
  // Shoulder and skirt, not one compromise between them — see `sprayRings`.
  3: [0.36, 0.7, 1]
}

const buildSprayGeometry = (puff: SprayPuff, segments: number, rings: 1 | 2 | 3): BufferGeometry => {
  const radii = SPRAY_RADII[rings]

  const count = 1 + segments * radii.length
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const depth = new Float32Array(count)
  const shore = new Float32Array(count)
  const flow = new Float32Array(count * 2)
  const point = new Vector3()
  const normal = new Vector3()

  sprayPoint(puff, 0, 0, point)
  sprayNormal(puff, 0, 0, normal)
  positions[0] = point.x
  positions[1] = point.y
  positions[2] = point.z
  normals[0] = normal.x
  normals[1] = normal.y
  normals[2] = normal.z
  // Aerated froth all the way through — there is nothing to see into, which is
  // the same call `buildPoolGeometry` makes at the impact point.
  depth[0] = 0
  shore[0] = puff.shoreCore
  flowFor(normal, sprayDirection(puff, point, normal, _flowDir), SPRAY_FLOW, flow, 0)

  for (let ring = 0; ring < radii.length; ring++) {
    const t = radii[ring]!
    for (let i = 0; i < segments; i++) {
      const theta = (i / segments) * TAU
      const index = 1 + ring * segments + i

      sprayPoint(puff, t, theta, point)
      sprayNormal(puff, t, theta, normal)
      positions[index * 3] = point.x
      positions[index * 3 + 1] = point.y
      positions[index * 3 + 2] = point.z
      normals[index * 3] = normal.x
      normals[index * 3 + 1] = normal.y
      normals[index * 3 + 2] = normal.z

      depth[index] = 0
      // Linear in `t`, so the rim — the shell's only free edge — is exactly 0 and
      // the foam band the shader draws there outlines the puff in white without
      // an outline pass (the same argument the header makes for the curtain).
      shore[index] = puff.shoreCore * (1 - t)
      flowFor(normal, sprayDirection(puff, point, normal, _flowDir), SPRAY_FLOW, flow, index * 2)
    }
  }

  // Same winding as the pool: reversed relative to the natural (θ, t) order, so
  // the face normal agrees with the analytic one.
  const indices: number[] = []
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments
    indices.push(0, 1 + next, 1 + i)
  }
  for (let ring = 0; ring < radii.length - 1; ring++) {
    const innerBase = 1 + ring * segments
    const outerBase = innerBase + segments
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments
      indices.push(innerBase + i, innerBase + next, outerBase + i)
      indices.push(innerBase + next, outerBase + next, outerBase + i)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('aDepth', new BufferAttribute(depth, 1))
  geometry.setAttribute('aShore', new BufferAttribute(shore, 1))
  geometry.setAttribute('aFlow', new BufferAttribute(flow, 2))
  geometry.setIndex(indices)
  return geometry
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * The water equivalent of `assertFiniteGeometry`, and it exists separately for
 * one reason: that one only walks `position/normal/color/aWind`, so a NaN in
 * `aDepth` or an `aShore` of 4 would pass it and then render as a solid foam
 * sheet with no error anywhere.
 *
 * Every check is written as a **positive** test. `if (value > 1)` is false for
 * NaN, so the obvious form of every one of these silently cannot fail — which is
 * how a black asset shipped from this repo once already.
 */
const assertWaterGeometry = (geometry: BufferGeometry, name: string): BufferGeometry => {
  const problems: string[] = []

  for (const key of WATER_ATTRIBUTES) {
    const attribute = geometry.getAttribute(key)
    if (!attribute) {
      problems.push(`missing "${key}"`)
      continue
    }
    const array = attribute.array as ArrayLike<number>
    let bad = 0
    for (let i = 0; i < array.length; i++) {
      if (!Number.isFinite(array[i]!)) {
        bad++
      }
    }
    if (bad > 0) {
      problems.push(`${bad}/${array.length} non-finite in "${key}"`)
    }
  }

  const normal = geometry.getAttribute('normal')
  if (normal) {
    let unnormalised = 0
    for (let i = 0; i < normal.count; i++) {
      const lengthSq = normal.getX(i) ** 2 + normal.getY(i) ** 2 + normal.getZ(i) ** 2
      if (!(Math.abs(lengthSq - 1) < 2e-3)) {
        unnormalised++
      }
    }
    if (unnormalised > 0) {
      problems.push(`${unnormalised}/${normal.count} normals are not unit length`)
    }
  }

  const shore = geometry.getAttribute('aShore')
  if (shore) {
    let outOfRange = 0
    for (let i = 0; i < shore.count; i++) {
      const value = shore.getX(i)
      if (!(value >= 0 && value <= 1)) {
        outOfRange++
      }
    }
    if (outOfRange > 0) {
      problems.push(`${outOfRange}/${shore.count} aShore outside [0,1]`)
    }
  }

  const depth = geometry.getAttribute('aDepth')
  if (depth) {
    let negative = 0
    for (let i = 0; i < depth.count; i++) {
      if (!(depth.getX(i) >= 0)) {
        negative++
      }
    }
    if (negative > 0) {
      problems.push(`${negative}/${depth.count} aDepth below zero`)
    }
  }

  if (problems.length > 0) {
    const message = `[world] ${name}: ${problems.join('; ')}`
    if (import.meta.env.DEV) {
      throw new Error(message)
    }
    console.warn(message)
  }
  return geometry
}

// ─── Assembly ───────────────────────────────────────────────────────────────

/**
 * Merge order is the draw order, and for water it is also the sort order.
 *
 * `WaterMaterial` is transparent with `depthWrite: false` (its header explains
 * why: a depth-writing water surface punches a hole in the water behind it). One
 * consequence is that nothing inside a single water mesh sorts by depth — the
 * triangles blend in index order. So the spray goes **last**, and everything
 * about the cluster is arranged so that "last" is also "nearest":
 *
 *   • the puffs are placed in the +Z half, which is the side the curtain hangs
 *     toward and the side a viewer is on (−Z is the cliff the water came off);
 *   • the mound is squashed along Z so it sits *in front of* the base of the
 *     curtain rather than wrapping around it.
 *
 * Seen from behind the fall the order is wrong and a puff blends over a curtain
 * that is in front of it. That is the same error the material already accepts
 * between two water surfaces, and it has the same shape: both are near-white
 * foam there, so what changes is a blend weight, not a silhouette.
 *
 * Nothing here writes depth or casts a shadow — `castsShadow: false` on the
 * asset covers the whole mesh, spray included, so the cloud cannot drop a hard
 * quantised shadow of itself onto the pool.
 */
const buildTier = (shape: WaterfallShape, tier: WaterfallTier, name: string): BufferGeometry => {
  const parts: BufferGeometry[] = []
  for (const strand of mergeStrands(shape.strands, tier.strands)) {
    parts.push(buildStrandGeometry(shape, strand, tier.cols, tier.rows))
  }
  parts.push(buildPoolGeometry(shape, tier.poolSegments, tier.poolRings))
  for (let i = 0; i < tier.sprayPuffs && i < shape.puffs.length; i++) {
    const segments = i === 0 ? tier.spraySegments : satelliteSegments(tier.spraySegments)
    // Satellites never take the mound's third ring — see `sprayRings`.
    const rings = i === 0 ? tier.sprayRings : (Math.min(tier.sprayRings, 2) as 1 | 2)
    parts.push(buildSprayGeometry(shape.puffs[i]!, segments, rings))
  }

  // `mergeParts` normalises the parts and fills in the `color` (white) and
  // `aWind` (0) attributes every `WorldAsset` tier is expected to carry. White
  // is the right base here: the water's colour comes from the depth ramp in the
  // shader, and any tint in the attribute would multiply on top of it twice.
  const geometry = mergeParts(parts, name)
  // Validate before budgeting — a tier full of NaN still has a valid triangle
  // count, so the other order reports success on a broken asset.
  return assertTriBudget(assertWaterGeometry(geometry, name), tier.budget, name)
}

/**
 * One waterfall, as an ordinary four-tier placeable.
 *
 * Whatever places this must set `castShadow = false` on the tier meshes.
 * `WaterMaterial` displaces the surface in its own vertex shader and three's
 * shadow pass uses its own depth material, which knows nothing about that — a
 * casting water mesh drops the shadow of the undisplaced sheet.
 */
export const createWaterfallAsset = (options: WaterfallOptions = {}): WorldAsset => {
  const form = options.form ?? 'curtain'
  const shape = buildShape(options)
  const name = `waterfall-${form}-${options.seed ?? 1}`
  const tiers = TIERS[form].map((tier, i) => buildTier(shape, tier, `${name}/LOD${i}`))

  return {
    name,
    perfTag: 'waterfalls',
    tiers,
    material: createWaterMaterial({ style: shape.style, name: `${name}-water` }),
    // Deliberate — see the header. Water is outlined by its own foam.
    outline: null,
    outlineMaxTier: 0,
    // Measured across every tier rather than derived: the lean, the spread and
    // the pool's rim wobble all move the furthest vertex after the nominal
    // extents are chosen, and an under-reported radius culls the fall while a
    // slice of it is still on screen.
    radius: measuredRadius(tiers),
    distanceScale: FORMS[form].distanceScale,
    // The shadow pass runs three's depth material, which has no idea this
    // surface displaces itself in its own vertex shader — so a curtain would
    // cast the hard opaque rectangle of its undisplaced sheet. `DitheredLod`
    // reads this flag; see the note on the field in `assets/types.ts`.
    castsShadow: false
  }
}

/**
 * Footprint and drop of a generated waterfall, for the editor's gizmo and for
 * sizing whatever the level wants to put around it.
 *
 * Note this is deliberately **not** a collider box. A waterfall the player
 * cannot walk into is worse than one they can, and the half-extents here span
 * the splash pool — which is exactly the part they should be able to stand in.
 */
export const waterfallMetrics = (
  options: WaterfallOptions = {}
): { halfX: number; halfZ: number; height: number } => {
  const shape = buildShape(options)
  const wobble = 1 + POOL_WOBBLE
  const foot = Math.tan(shape.lean) * shape.height
  const spread = shape.halfWidth * (1 + shape.spread) + shape.wanderAmp

  let halfX = Math.max(
    shape.halfWidth,
    Math.abs(foot + spread),
    Math.abs(foot - spread),
    Math.abs(shape.poolCenterX) + shape.poolRadiusX * wobble
  )
  let halfZ = Math.max(
    shape.lipDepth,
    shape.bow,
    Math.abs(shape.poolCenterZ) + shape.poolRadiusZ * wobble
  )

  // The cluster is sized against the *landing* width and the pool is sized
  // against the same thing times `poolWiden`, so a satellite normally sits well
  // inside the disc — but not on every form, and an under-reported footprint is
  // an editor gizmo that does not contain what it is dragging.
  const puffWobble = 1 + SPRAY_LOBE + SPRAY_SWELL
  for (const puff of shape.puffs) {
    halfX = Math.max(halfX, Math.abs(puff.x) + puff.radiusX * puffWobble)
    halfZ = Math.max(halfZ, Math.abs(puff.z) + puff.radiusZ * puffWobble)
  }

  return { halfX, halfZ, height: shape.height }
}
