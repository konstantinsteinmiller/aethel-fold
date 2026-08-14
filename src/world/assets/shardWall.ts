import { type BufferGeometry, Color, Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { triangleCount } from '../geometry/budget'
import { applyCutPlane, blobGeometry, type CutPlane, type Lump, lumpRadius, makeLumps } from '../geometry/build'
import { makeRng, type Rng } from '../geometry/rng'
import { bakeVertexAO } from '../geometry/vertexAO'
import { applyVertexAO, jitterColor } from '../geometry/vertexColor'
import { createOutlineMaterial } from '../shading/outlineMaterial'
import { mergeParts, partRanges } from './common'
import { createCliffMaterial, finishTier } from './plateau'
import {
  makeStoneBands,
  paintSedimentaryBands,
  paintStoneBody,
  PALE_STONE,
  type StoneBand,
  type StonePalette
} from './stone'
import type { WorldAsset } from './types'

/**
 * ─── Shard wall ─────────────────────────────────────────────────────────────
 *
 * A row (or a fan) of thin, tall, flat-sided rock plates standing on edge,
 * packed shoulder to shoulder at different heights, thicknesses and bearings —
 * a fractured ridge, or a set of dominoes half-buried in the ground.
 *
 * It is the one **planar-dominant** prop in the stone family, and that is the
 * whole reason it exists. Everything else here is a surface of revolution
 * (plateau, spire, slab, mesa) or a lump-displaced spheroid (boulder, grass
 * rock), so a rock garden built out of them reads as lathe-turned however many
 * flutes and strata get bolted on. A row of flat plates is the cheapest
 * available way to break that, because it is the one silhouette in the set that
 * is not a body of rotation at all.
 *
 * ── Why `blobGeometry` + cut planes rather than a loft ──────────────────────
 *
 * `slab.ts` proves a loft can make a rectangular section, so an eccentric
 * superellipse would give the flat faces. It cannot give the rest of the fin:
 *
 *   • The identity of a shard is its **angled, chipped top and its sheared
 *     faces**, and those are half-spaces. A loft's height is `yAt(u)` — a
 *     function of the ring parameter alone — so a plane that is not
 *     perpendicular to the axis is inexpressible; a slanted top would have to be
 *     faked with a cap part, which is a differently-authored mesh in all but
 *     name.
 *   • At these budgets a fin is 8–60 triangles. A loft's cheapest closed form is
 *     3 rings × 4 segments plus two caps, and both caps are buried or
 *     edge-on-invisible on a plate.
 *
 * So each fin is `blobGeometry` — a lump-displaced spheroid at a 5 : 1 : 0.2
 * scale — sliced by five or six **bevelled** half-space cuts: two that shear
 * the sides into a blade, two that flatten the broad faces, and one or two that
 * chip the top. The bevel is not optional: an unbevelled plate edge catches a
 * pixel-wide specular line along a perfectly hard edge and reads as papercraft
 * at any distance the player can see it from.
 *
 * ── Normals: analytic, and why the `basalt.ts` exemption does not apply ──────
 *
 * `basalt.ts` is allowed `smoothNormalsByAngle` because a prism's dihedral
 * angles come from its cross-section and its chamfer, so the set of angles is
 * the same at every tier. A fin is not a prism. Between its cuts it is a curved,
 * lump-displaced spheroid, and its bevels are curved by construction — so the
 * angle between adjacent faces is a function of tessellation, exactly the case
 * GDD R2 records: a fixed threshold smooths the fine tier and leaves the coarse
 * ones faceted, and the *shading solution* then changes at every LOD boundary,
 * which a dithered crossfade cannot hide. Normals therefore come from
 * `blobGeometry`'s central differences of the shape function, identical at all
 * four tiers.
 *
 * ── The one place this file overrules a shared primitive ────────────────────
 *
 * `blobGeometry` inflates every tier by `1/cos(π/W)^0.6` to undo inscribed-
 * polygon shrinkage. That is right for a sphere and wrong for a plate, and it is
 * cancelled here (the scale is pre-divided by it).
 *
 * With `W` and `H` both **even** — which is why the grid ladder below has no odd
 * counts — the sample set contains the ±X width extremes, the ±Z thickness
 * extremes and the ±Y poles exactly. Nothing is being lost at those points, so
 * the inflation is pure over-extension: W=4 would render 13 % wider *and taller*
 * than W=6, which on a 7.5 m fin is a 0.97 m jump in the middle of a crossfade.
 *
 * Cancelled, the disagreement between the two grids is at most **2.3 %** of the
 * support in any bearing (worst at ~70° off the face, where W=4 gives 0.342 and
 * W=6 gives 0.350 of the half-width — about 1 cm on a 1.6 m plate), because a
 * 5:1 section's inscribed polygon is a close fit everywhere except within a few
 * degrees of its thin axis, where both grids are wrong by the same amount. Tier
 * agreement is what §4.3 asks for, not absolute area.
 *
 * ── Tier reduction: a countable set, so dropping is measured, not assumed ────
 *
 * Fins are ranked by prominence (tall and central first) the way `basalt.ts`
 * ranks its columns, but **only LOD3 loses any**. At `distanceScale` 2.4 the
 * LOD0→LOD1 crossfade sits at 43–50 m, where an outer fin is still ~26 px wide;
 * removing one there pops, plainly. LOD1 and LOD2 therefore keep every fin and
 * spend their whole reduction on per-fin sampling instead, handed out
 * prominence-first by `allocateGrids` so the tall central plates that carry the
 * silhouette are the last to coarsen.
 *
 * LOD3 cannot: seven fins at the ladder's cheapest rung is 56 triangles against
 * a budget of 30. It folds the row into three instead of dropping four of it —
 * see `foldFins`, which records what the two obvious selection rules measured.
 *
 * Budgets (GDD §4.1): 260 / 150 / 78 / 30.
 */

const TAU = Math.PI * 2

export type ShardForm = 'wall' | 'cluster'

export interface ShardWallOptions {
  seed?: number
  form?: ShardForm
  /** Height of the tallest fin, ground to apex, in metres. */
  height?: number
  stone?: StonePalette
  /** Sedimentary band strength. 0 leaves the stone plain. */
  banding?: number
}

interface FormSpec {
  height: number
  /** Length of the row, or diameter of the fan, at the form's nominal height. */
  span: number
  count: [number, number]
}

const FORMS: Record<ShardForm, FormSpec> = {
  // A barrier or a skyline feature: a rough line of plates, tallest in the
  // middle, falling off toward the ends.
  wall: { height: 7.5, span: 7, count: [5, 7] },
  // The same plates fanned around a point at wildly different bearings, so it
  // reads as a shattered outcrop rather than as a wall someone built.
  cluster: { height: 4.5, span: 3.4, count: [4, 5] }
}

/** How much of a fin's pole-to-pole height sits below y = 0. */
const BURY = 0.16

/** Bevel radius on every cut, as a fraction of the fin's half-thickness. */
const BEVEL = 0.4

/** Per-fin value shift, so no two plates in a cluster are the same swatch. */
const SHADE_JITTER = 0.07

/** Horizontal bands, generated once per shape and shared by every fin. */
const BAND_COUNT = 7

/**
 * Height band the collider box is measured over. The fins are widest near their
 * own mid-height, which on a 7 m plate is well above the player's head — sizing
 * the box to that would stop them a third of a metre short of a wall they are
 * walking past.
 */
const PLAYER_REACH = 1.9

/** Collider shave. Brushing through a groove reads far better than a hard stop. */
const FOOT_SHAVE = 0.94

// ─── One fin ────────────────────────────────────────────────────────────────

/**
 * A cut plane, held as a *fraction* of one of the fin's half-extents rather than
 * as an absolute distance.
 *
 * LOD3 folds several fins into one wider plate (`foldFins`), and an absolute
 * distance would not move with it: the side cuts would bite deeper by exactly
 * the amount the fin grew and the plate would come out the width it started.
 * Fractions scale with the fin, so a widened fin is the same shape, larger.
 */
interface FinCut {
  normal: Vector3
  frac: number
  /** Which half-extent `frac` is measured against. */
  against: 'width' | 'thickness' | 'support'
}

interface Fin {
  halfWidth: number
  halfHeight: number
  halfThick: number
  lumps: Lump[]
  cuts: FinCut[]
  /** Placement: lean, tilt out of the row's plane, bearing, position. */
  x: number
  y: number
  z: number
  lean: number
  tiltOut: number
  yaw: number
  matrix: Matrix4
  /** Ranking for the triangle allocator and for LOD3's fold. */
  prominence: number
  /** This fin's single value draw, and the AO resolve target it implies. */
  shade: number
  shadow: Color
}

const shadeMultiplier = (shade: number): number => 1 + (shade * 2 - 1) * SHADE_JITTER

/**
 * Cut normals are authored almost entirely in X and Z, and the reason is the
 * aspect ratio rather than taste: a fin's half-height is ~20× its half-thickness
 * and ~5× its half-width, so a normal's Y component is multiplied by the largest
 * number in the shape. A face plane tilted even 10° off vertical does not
 * flatten a face — it shears the whole top off. Only the chip planes, which are
 * *meant* to reach the top, carry a large Y.
 */
const makeFinCuts = (rng: Rng): FinCut[] => {
  const cuts: FinCut[] = []

  // Sides. A few degrees of rake each, independently drawn, so the blade tapers
  // as it rises and is never symmetric. Without them the fin's outline is the
  // spheroid's — a leaf standing on its point, not a plate.
  for (const side of [1, -1]) {
    const rake = rng.range(0.03, 0.13)
    cuts.push({
      normal: new Vector3(side * Math.cos(rake), Math.sin(rake), rng.spread(0.1)).normalize(),
      frac: rng.range(0.62, 0.82),
      against: 'width'
    })
  }

  // Broad faces. The tiny Y term is what makes the plate a wedge in profile —
  // thicker at the foot than at the top — and 0.012 already takes a third of the
  // thickness out of the top of a 7 m fin. Signed independently per face, so
  // some plates shear instead of tapering.
  for (const side of [1, -1]) {
    cuts.push({
      normal: new Vector3(rng.spread(0.06), rng.spread(0.012), side).normalize(),
      frac: rng.range(0.66, 0.9),
      against: 'thickness'
    })
  }

  // The chipped top. Measured against the spheroid's support in the plane's own
  // direction, which is always at or under the true support (the lump field only
  // adds), so the cut is guaranteed to bite whatever the seed.
  const chips = rng.int(1, 2)
  for (let i = 0; i < chips; i++) {
    const tilt = rng.range(0.22, 0.62) * (rng() < 0.5 ? 1 : -1)
    const bearing = rng.range(0, TAU)
    cuts.push({
      normal: new Vector3(
        Math.sin(tilt) * Math.cos(bearing),
        Math.cos(tilt),
        Math.sin(tilt) * Math.sin(bearing)
      ).normalize(),
      frac: rng.range(0.74, 0.9),
      against: 'support'
    })
  }

  return cuts
}

const cutPlanesFor = (fin: Fin): CutPlane[] => {
  const bevel = fin.halfThick * BEVEL
  return fin.cuts.map(cut => {
    const n = cut.normal
    const reference =
      cut.against === 'width'
        ? fin.halfWidth
        : cut.against === 'thickness'
          ? fin.halfThick
          : Math.hypot(fin.halfWidth * n.x, fin.halfHeight * n.y, fin.halfThick * n.z)
    return { normal: n, dist: reference * cut.frac, bevel }
  })
}

const composeFin = (fin: Fin): Matrix4 =>
  // YXZ: the lean happens inside the fin's own plane, the tilt takes it out of
  // that plane, and the bearing turns the finished plate. Any other order swings
  // the lean around with the bearing and the row stops looking like one break.
  new Matrix4().compose(
    new Vector3(fin.x, fin.y, fin.z),
    new Quaternion().setFromEuler(new Euler(fin.tiltOut, fin.yaw, fin.lean, 'YXZ')),
    new Vector3(1, 1, 1)
  )

/**
 * Grids one fin can be built at, cheapest first. Triangles = `W × (2H − 2)`.
 *
 * Both counts are even in every entry, which is the constraint that lets the
 * sphere inflation be cancelled — see the header. The ladder alternates between
 * spending on the section (W: 4 gives a rhombic plate, 6 gives genuinely flat
 * broad faces) and on the profile (H: 2 collapses the fin to a bipyramid, 4
 * describes the taper, 6 resolves the chipped top as a facet rather than as a
 * point), so each rung is a real step up in fidelity.
 *
 * It runs one rung past what a 7-fin wall can afford on purpose: the counts are
 * drawn from the seed, and without a top rung above 36 a 5-fin wall spent 180 of
 * its 260 and had nowhere to put the rest.
 */
const GRIDS: readonly (readonly [number, number])[] = [
  [4, 2],
  [6, 2],
  [4, 4],
  [6, 4],
  [6, 6]
]

/** The top rung. LOD0 draws its fins at this or the one below it, never coarser. */
const FINEST = GRIDS[GRIDS.length - 1]!

const _dir = new Vector3()
const _point = new Vector3()
const _scale = new Vector3()

/**
 * `blobGeometry`'s shape function for one fin, reproduced so the metrics and the
 * measurements below run against the surface the mesh actually sits on. Order is
 * load-bearing: lump field, then the anisotropic scale, then the cuts as passed.
 */
const finSurface = (fin: Fin, cuts: readonly CutPlane[], direction: Vector3, out: Vector3): Vector3 => {
  out.copy(direction).multiplyScalar(lumpRadius(direction, fin.lumps))
  out.x *= fin.halfWidth
  out.y *= fin.halfHeight
  out.z *= fin.halfThick
  for (let i = 0; i < cuts.length; i++) {
    applyCutPlane(out, cuts[i]!)
  }
  return out
}

interface FinMeasure {
  /** Object-space Y of the highest surface point, after cuts and placement. */
  apex: number
  /** Half-extents of the footprint over the player's height, about the origin. */
  footX: number
  footZ: number
  /** Farthest surface point from the origin, horizontally. */
  reach: number
}

const _prev = new Vector3()
const _edge = new Vector3()

/**
 * Widens `measure`'s footprint by the part of one mesh edge that crosses the
 * player's height band.
 *
 * Sampling the *surface* in that band and sampling the *mesh* in it are not the
 * same measurement, and the difference is a collider bug. The first version
 * swept the continuous surface densely and came out 9 % wider than LOD0's own
 * bounding box: a 6-gon section is up to 12 % short of its ellipse between its
 * samples, and the lump field's widest point rarely lands on a ring. A box wider
 * than the mesh is an invisible wall, so the walk is over the mesh's edges —
 * which are straight, so clipping to the band and reading the two ends is exact.
 */
const accumulateFootprint = (a: Vector3, b: Vector3, measure: FinMeasure): void => {
  const dy = b.y - a.y
  let t0 = 0
  let t1 = 1

  if (Math.abs(dy) < 1e-9) {
    if (a.y < 0 || a.y > PLAYER_REACH) {
      return
    }
  } else {
    const low = -a.y / dy
    const high = (PLAYER_REACH - a.y) / dy
    t0 = Math.max(0, Math.min(low, high))
    t1 = Math.min(1, Math.max(low, high))
    if (t0 > t1) {
      return
    }
  }

  // Both ends of the clipped edge. The edge is straight, so its widest point in
  // the band is one of the two — there is nothing to sample in between.
  _edge.copy(a).lerp(b, t0)
  measure.footX = Math.max(measure.footX, Math.abs(_edge.x))
  measure.footZ = Math.max(measure.footZ, Math.abs(_edge.z))
  _edge.copy(a).lerp(b, t1)
  measure.footX = Math.max(measure.footX, Math.abs(_edge.x))
  measure.footZ = Math.max(measure.footZ, Math.abs(_edge.z))
}

/**
 * Everything the collider and the bounds need, taken from the **finest rung's
 * own vertices and edges** rather than from a dense sweep — so every number here
 * describes a mesh that gets drawn rather than a surface nothing samples.
 *
 * The two rungs LOD0 can land on share their bearings, their poles and their
 * equator, so the apex measured here is LOD0's apex to the millimetre on every
 * seed tried; `FOOT_SHAVE` carries the couple of percent the ring counts can
 * differ by in the footprint.
 */
const measureFin = (fin: Fin): FinMeasure => {
  const cuts = cutPlanesFor(fin)
  const measure: FinMeasure = { apex: Number.NEGATIVE_INFINITY, footX: 0, footZ: 0, reach: 0 }
  const bearings = FINEST[0]
  const rings = FINEST[1]

  for (let k = 0; k < bearings; k++) {
    const azimuth = (k / bearings) * TAU
    const cosAzimuth = Math.cos(azimuth)
    const sinAzimuth = Math.sin(azimuth)

    for (let j = 0; j <= rings; j++) {
      const polar = (j / rings) * Math.PI
      const sin = Math.sin(polar)
      _dir.set(sin * cosAzimuth, Math.cos(polar), sin * sinAzimuth)
      finSurface(fin, cuts, _dir, _point).applyMatrix4(fin.matrix)
      measure.apex = Math.max(measure.apex, _point.y)
      measure.reach = Math.max(measure.reach, Math.hypot(_point.x, _point.z))
      if (j > 0) {
        accumulateFootprint(_prev, _point, measure)
      }
      _prev.copy(_point)
    }
  }

  return measure
}

// ─── Shape ──────────────────────────────────────────────────────────────────

interface ShardShape {
  /** Prominence-ordered, which is the order the triangle allocator spends in. */
  fins: Fin[]
  stone: StonePalette
  bands: StoneBand[]
  banding: number
  /** Apex of the tallest fin. Exactly the requested height, by construction. */
  height: number
  footX: number
  footZ: number
  extent: number
  /** Centre-to-centre fin spacing, which is the AO ray budget. */
  spacing: number
  rng: Rng
}

const buildShape = (options: ShardWallOptions): ShardShape => {
  const form = options.form ?? 'wall'
  const spec = FORMS[form]
  const rng = makeRng(options.seed ?? 1)
  const stone = options.stone ?? PALE_STONE
  const height = options.height ?? spec.height * rng.range(0.86, 1.16)
  const span = spec.span * (height / spec.height)
  const count = rng.int(spec.count[0], spec.count[1])
  const slot = span / count

  const fins: Fin[] = []

  for (let i = 0; i < count; i++) {
    let x = 0
    let z = 0
    let yaw = 0
    let nominal = 0

    if (form === 'wall') {
      const t = (i + 0.5) / count
      const centre = 1 - Math.abs(t - 0.5) * 2
      // Positional jitter stays well inside a slot: neighbours must overlap in
      // plan or the base of the wall reads as separate props parked in a line
      // rather than as one mass that broke.
      x = span * (t - 0.5) + rng.spread(slot * 0.16)
      z = rng.spread(slot * 0.2)
      yaw = rng.spread(0.26)
      nominal = height * (0.34 + 0.66 * centre ** 0.8) * rng.range(0.9, 1.06)
    } else {
      // Bearings spread over a half turn, because a plate at θ and one at θ + π
      // are the same plate — a full turn would waste half the fan on duplicates.
      const bearing = (i / count) * Math.PI + rng.spread(0.45)
      const drift = rng.range(0, slot * 0.5)
      x = Math.cos(bearing) * drift
      z = Math.sin(bearing) * drift
      yaw = bearing + rng.spread(0.4)
      nominal = height * (i === 0 ? 1 : rng.range(0.52, 0.9))
    }

    const halfWidth = slot * rng.range(0.58, 0.92) * (0.7 + 0.3 * (nominal / height))
    const halfHeight = nominal / (2 * (1 - BURY))
    const shade = rng()

    const fin: Fin = {
      halfWidth,
      halfHeight,
      // Roughly 5:1 against the width. Thinner reads as card, thicker as a slab.
      halfThick: halfWidth * rng.range(0.17, 0.24),
      lumps: makeLumps(rng, 3, [0.06, 0.16], [1.6, 3.4]),
      cuts: makeFinCuts(rng),
      x,
      y: halfHeight * (1 - 2 * BURY),
      z,
      lean: rng.spread(0.1),
      tiltOut: rng.spread(0.05),
      yaw,
      matrix: new Matrix4(),
      prominence: nominal,
      shade,
      shadow: stone.shadow.clone().multiplyScalar(shadeMultiplier(shade))
    }
    fin.matrix = composeFin(fin)
    fins.push(fin)
  }

  /**
   * The chip cuts take an unpredictable slice off each fin's top, so the drawn
   * heights are nominal rather than real. Every length in a fin — the cut
   * distances included, which is why they are fractions — is linear in its
   * half-extents, so one measured pass and a uniform rescale make the tallest
   * apex land exactly on `height`. Guessing a compensation factor instead leaves
   * the collider a few tens of centimetres out, and this prop is a wall.
   */
  let tallest = 0
  for (const fin of fins) {
    tallest = Math.max(tallest, measureFin(fin).apex)
  }
  const correction = tallest > 1e-6 ? height / tallest : 1

  let footX = 0
  let footZ = 0
  let extent = 0
  for (const fin of fins) {
    fin.halfWidth *= correction
    fin.halfHeight *= correction
    fin.halfThick *= correction
    fin.x *= correction
    fin.y *= correction
    fin.z *= correction
    fin.matrix = composeFin(fin)
    const measure = measureFin(fin)
    footX = Math.max(footX, measure.footX)
    footZ = Math.max(footZ, measure.footZ)
    extent = Math.max(extent, measure.reach)
  }

  fins.sort((a, b) => b.prominence - a.prominence)

  return {
    fins,
    stone,
    bands: makeStoneBands(rng, BAND_COUNT, 0, height, [0.035, 0.09]),
    banding: options.banding ?? 0,
    height,
    footX,
    footZ,
    extent,
    spacing: slot * correction,
    rng
  }
}

// ─── Tiers ──────────────────────────────────────────────────────────────────

const gridTriangles = (grid: readonly [number, number]): number => grid[0] * (2 * grid[1] - 2)

/**
 * Hands the tier's triangles out one rung at a time, in prominence order, until
 * the next upgrade would break the budget.
 *
 * A fixed grid per tier cannot work here: the fin count is drawn from the seed,
 * so the same tier is anywhere from 4 to 7 fins and a table sized for 7 leaves a
 * 4-fin cluster spending 60 % of its allowance. Handing them out greedily fills
 * every variant's budget and puts the last triangles where the silhouette is.
 */
const allocateGrids = (fins: number, budget: number): number[] => {
  const levels = new Array<number>(fins).fill(0)
  let total = fins * gridTriangles(GRIDS[0]!)

  for (let level = 1; level < GRIDS.length; level++) {
    const step = gridTriangles(GRIDS[level]!) - gridTriangles(GRIDS[level - 1]!)
    for (let i = 0; i < fins; i++) {
      if (total + step > budget) {
        return levels
      }
      levels[i] = level
      total += step
    }
  }

  return levels
}

const _axis = new Vector3()

/**
 * Folds the row down to `keep` fins, and it **folds** rather than selects.
 *
 * Two rules were tried first and both pop, measured against LOD0's bounding box
 * at the 264 m crossfade where the whole wall is ~27 px wide:
 *
 *   • `basalt.ts`'s rule — keep the most prominent — left LOD3 at **47 %** of
 *     LOD0's length. A rosette's tallest column is also its most central, so
 *     keeping it holds the cluster's extent; a row's tall fins are *all* in the
 *     middle, so keeping them shortens the wall by half.
 *   • Prominence-weighted farthest-point sampling recovered only to 51–66 %,
 *     because a fin short enough to sit at the end of the row is short enough to
 *     lose every tie-break.
 *
 * So each surviving fin stands for a contiguous *group* of the row: it is the
 * group's most prominent member, moved to the middle of the group's footprint
 * and widened to cover it. That is `basalt.ts`'s LOD3 argument taken to a row
 * rather than to a point — real geometry from the same shape function at its
 * coarsest, not a stand-in that shades differently — and because the cut
 * distances are fractions of the half-width, widening the plate rescales its
 * taper and its chip with it instead of eating them.
 *
 * The group's height is its members' mean, except for the group holding the
 * tallest fin, which keeps that fin's own height: the peak of the silhouette is
 * the one number a collider and a skyline both depend on. Taking the lead's
 * height everywhere instead raised the ends of the row by up to 2.8 m, which is
 * a *larger* error at the crossfade than the one it was fixing.
 */
const foldFins = (fins: readonly Fin[], keep: number): Fin[] => {
  if (keep >= fins.length) {
    return [...fins]
  }

  const tallest = fins[0]!
  const ordered = [...fins].sort((a, b) => a.x - b.x)
  const folded: Fin[] = []

  for (let g = 0; g < keep; g++) {
    const group = ordered.filter((_, i) => Math.floor((i * keep) / ordered.length) === g)
    if (group.length === 0) {
      continue
    }

    let lead = group[0]!
    for (const fin of group) {
      if (fin.prominence > lead.prominence) {
        lead = fin
      }
    }
    if (group.length === 1) {
      folded.push(lead)
      continue
    }

    // The lead's own width axis, because a plate can only grow sideways: object
    // space +X turned by the fin's bearing.
    _axis.set(Math.cos(lead.yaw), 0, -Math.sin(lead.yaw))
    let low = Number.POSITIVE_INFINITY
    let high = Number.NEGATIVE_INFINITY
    let heightSum = 0
    for (const fin of group) {
      const along = (fin.x - lead.x) * _axis.x + (fin.z - lead.z) * _axis.z
      low = Math.min(low, along - fin.halfWidth)
      high = Math.max(high, along + fin.halfWidth)
      heightSum += fin.halfHeight
    }

    const middle = (low + high) * 0.5
    const halfHeight = group.includes(tallest) ? lead.halfHeight : heightSum / group.length
    const merged: Fin = {
      ...lead,
      halfWidth: (high - low) * 0.5,
      halfHeight,
      x: lead.x + _axis.x * middle,
      z: lead.z + _axis.z * middle,
      y: halfHeight * (1 - 2 * BURY),
      matrix: new Matrix4()
    }
    merged.matrix = composeFin(merged)
    folded.push(merged)
  }

  // Back into prominence order, because that is the order `allocateGrids`
  // spends in — the groups came out sorted along the row.
  return folded.sort((a, b) => b.prominence - a.prominence)
}

interface ShardTier {
  /** Fins kept. Only LOD3 is below the maximum — see `foldFins`. */
  fins: number
  budget: number
  aoSamples: number
}

const TIERS: ShardTier[] = [
  { fins: 7, budget: 260, aoSamples: 12 },
  { fins: 7, budget: 150, aoSamples: 10 },
  { fins: 7, budget: 78, aoSamples: 8 },
  { fins: 3, budget: 30, aoSamples: 6 }
]

/**
 * A tier's allocation ceiling: its own budget, or the same *proportional* step
 * down from what the previous tier actually spent — whichever is smaller.
 *
 * The budgets in §4.1 are sized for the largest variant this generator can draw
 * (a 7-fin wall). A 4-fin cluster lands at 144 triangles for LOD0, which sits
 * comfortably under LOD1's 150 ceiling as well, so a plain budget check hands
 * LOD1 the identical mesh — a second full tier that costs a draw call, a bake
 * and a crossfade to show nothing at all. Stepping each tier down by the ratio
 * the budget table itself asks for (0.58, 0.52, 0.38) keeps every variant on the
 * same reduction curve as the 7-fin case.
 */
const allocationCeiling = (tier: number, spent: number): number => {
  const budget = TIERS[tier]!.budget
  if (tier === 0) {
    return budget
  }
  return Math.min(budget, Math.floor(spent * (budget / TIERS[tier - 1]!.budget)))
}

const buildFin = (fin: Fin, grid: readonly [number, number]): BufferGeometry => {
  const widthSegments = grid[0]
  // `blobGeometry` multiplies by `1/cos(π/W)^0.6` before the scale; dividing the
  // scale by the same factor cancels it exactly. See the header for why a plate
  // wants that and a sphere does not.
  const inflate = 1 / Math.cos(Math.PI / widthSegments) ** 0.6

  const geometry = blobGeometry({
    radius: 1,
    widthSegments,
    heightSegments: grid[1],
    lumps: fin.lumps,
    cuts: cutPlanesFor(fin),
    scale: _scale.set(fin.halfWidth, fin.halfHeight, fin.halfThick).divideScalar(inflate)
  })

  return geometry.applyMatrix4(fin.matrix)
}

const buildTier = (shape: ShardShape, tier: ShardTier, ceiling: number, name: string): BufferGeometry => {
  const kept = foldFins(shape.fins, tier.fins)
  const levels = allocateGrids(kept.length, ceiling)

  const parts = kept.map((fin, i) => {
    const geometry = buildFin(fin, GRIDS[levels[i]!]!)
    // Per fin, before the merge: the ramp reads the geometry's own box, so one
    // call on the merged cluster would give a 3 m fin the top of a 7 m one and
    // the whole row would flatten into a single gradient.
    paintStoneBody(geometry, shape.rng, shape.stone)
    // Bands are absolute in object-space Y and shared across fins *and* tiers,
    // which is the entire point — stripes that line up from plate to plate are
    // what say these were one layer of rock before it broke.
    paintSedimentaryBands(geometry, shape.stone, shape.bands, shape.banding)
    // A constant draw turns `jitterColor`'s per-vertex noise into a per-fin value
    // shift, which is the one thing that stops seven instances of the same
    // material reading as one extruded object.
    jitterColor(geometry, () => fin.shade, SHADE_JITTER)
    return geometry
  })

  const ranges = partRanges(parts)
  const merged = mergeParts(parts, name)

  // Roughly one fin spacing. Shorter and the contact shadow where two plates
  // interpenetrate never forms, and that dark seam in the gaps is most of what
  // sells the packing — without it the row reads as props parked side by side.
  const ao = bakeVertexAO(merged, {
    samples: tier.aoSamples,
    maxDistance: shape.spacing * 1.15,
    strength: 0.95,
    power: 1.1
  })
  // Range-split per fin, and not for tidiness: each plate resolves toward its
  // own shaded value, so the AO deepens the value separation the shade jitter
  // created instead of pulling every crevice back to one colour.
  for (let i = 0; i < kept.length; i++) {
    applyVertexAO(merged, ao, kept[i]!.shadow, 0.85, ranges[i]!)
  }

  return finishTier(merged, tier.budget, name)
}

export const createShardWallAsset = (options: ShardWallOptions = {}): WorldAsset => {
  const form = options.form ?? 'wall'
  const shape = buildShape(options)
  const name = `shard-${form}-${shape.banding > 0 ? 'banded' : 'plain'}-${options.seed ?? 1}`

  let spent = 0
  const tiers = TIERS.map((tier, i) => {
    const geometry = buildTier(shape, tier, allocationCeiling(i, spent), `${name}/LOD${i}`)
    spent = triangleCount(geometry)
    return geometry
  })

  return {
    name,
    perfTag: 'shards',
    tiers,
    material: createCliffMaterial('shard-wall'),
    outline: createOutlineMaterial({ pixelWidth: 1.6, name: 'shard-wall-outline' }),
    outlineMaxTier: 1,
    radius: Math.hypot(shape.extent, shape.height),
    // Tall enough to hold detail a long way out, but the cull is clamped to
    // 320 m and 2.6 would open LOD3's band past it (see `plateau.ts`).
    distanceScale: 2.4
  }
}

/**
 * Collider dimensions — a **box**, not a cylinder.
 *
 * A wall is not a surface of revolution: a cylinder around a 7 m row of plates
 * would be almost entirely air, and the player would be stopped three metres
 * short of a prop they can see they are nowhere near.
 *
 * The box is axis-aligned in object space before the placement's Y-rotation
 * (`ColliderShape` in `level/types.ts`), so the `'wall'` form's row runs along
 * **object-space X** and a placement's `rotY` turns the whole wall as one. The
 * half-extents are the fins' *combined* footprint measured over the player's
 * own height and then shaved inward, because the plates are widest near their
 * mid-height — several metres above anything the player can walk into.
 *
 * Not walkable, and not a judgement call: the tops are chipped and a few
 * centimetres wide, so a walkable box would put the player standing on a
 * rectangle of thin air spanning the whole row.
 *
 * `height` is the tallest fin's apex as the **finest grid** samples it, which is
 * LOD0's own top rather than that of a continuous surface nothing draws — the
 * shape is rescaled at generation time to make the two the same number, so the
 * `height` option means what it says (see `buildShape`).
 */
export const shardWallMetrics = (
  options: ShardWallOptions = {}
): { halfX: number; halfZ: number; height: number } => {
  const shape = buildShape(options)
  return {
    halfX: shape.footX * FOOT_SHAVE,
    halfZ: shape.footZ * FOOT_SHAVE,
    height: shape.height
  }
}
