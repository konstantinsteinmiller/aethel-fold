import type { BufferGeometry } from 'three'
import { Vector3 } from 'three'
import { makeRng, type Rng } from '../geometry/rng'
import { bakeVertexAO } from '../geometry/vertexAO'
import { applyVertexAO } from '../geometry/vertexColor'
import { createOutlineMaterial } from '../shading/outlineMaterial'
import { mergeParts } from './common'
import {
  buildRingList,
  createCliffMaterial,
  finishTier,
  type GrassShelf,
  loftGeometry,
  makeSection,
  makeStrata,
  paintGrassShelves,
  profileVolumeInflate,
  sectionAreaInflate,
  smootherstep,
  strataAt,
  type Stratum,
  strataOffsetAt,
  strataSeeds
} from './plateau'
import { PALE_STONE, paintSedimentaryBands, paintStoneBody, type StoneBand, type StonePalette } from './stone'
import type { WorldAsset } from './types'

/**
 * ─── Stacked-slab pillar ────────────────────────────────────────────────────
 *
 * A tower of discrete horizontal blocks, each one knocked a little sideways off
 * the one below — a pile of coins someone shoved. It is the most architectural
 * prop in the cliff family and it is what a level designer reaches for when a
 * jumping route needs obvious footholds: every block edge is a foothold the eye
 * can find from across the valley, and the crown is a genuinely flat top.
 *
 * The read against its siblings is entirely in how the profile *breaks*:
 *
 *   • `plateau`    — one continuous undercut anvil
 *   • `cliff`      — one continuous stratified taper
 *   • `pillarStack`— discrete blocks: flat top, near-vertical wall, sharp
 *                    shoulder, repeated
 *
 * ── Why this is one loft and not N stacked cylinders ────────────────────────
 *
 * "Discrete blocks" reads as "merge some cylinders", and that is wrong three
 * times over, each of which costs something the contract does not let us spend:
 *
 *   1. **Interpenetrating shells.** Stacked cylinders that actually touch have
 *      to overlap, so every block contributes a full disc of interior triangles
 *      that are never visible and still occupy the tier's budget — at these
 *      budgets (260 for LOD0) two buried caps per joint is a quarter of the
 *      prop spent on nothing.
 *   2. **A seam the normals cannot cross.** Analytic normals come from the
 *      shape function (GDD R2); two cylinders have two shape functions and no
 *      derivative across the join, so every shoulder is either a hard 90° edge
 *      — banned outright — or needs an authored chamfer ring per joint.
 *   3. **Block *counts* would differ per tier.** Dropping a cylinder to make
 *      LOD2 fit changes the silhouette's topology, and the dithered crossfade
 *      (GDD §4.3) blends *coverage*, not shape. A tier with five blocks fading
 *      into a tier with seven is visible from any distance you can still see
 *      the prop from.
 *
 * A single lofted surface of revolution whose profile is a **sum of narrow
 * smootherstep steps** gives the same read with none of that: the shape stays
 * one continuous C² function of `u`, so all four tiers sample the same surface,
 * the shoulders get real analytic normals with a real bevel, and a coarse tier
 * *merges* neighbouring blocks instead of deleting one. `makeStrata` /
 * `strataAt` / `strataOffsetAt` / `strataSeeds` in `plateau.ts` already generate
 * exactly this — the pillar is what they were written for; the plateau uses two
 * of them and the spire three, this uses five to seven and turns the jogs up.
 *
 * ── The three dials that decide whether it is a stack or a cone ─────────────
 *
 * **Break width.** The bevel on each shoulder is the smootherstep's width in
 * `u`, measured against the loft's `U_EPSILON` (0.0025) — the central difference
 * that authors the normal spans `2 × U_EPSILON`, i.e. 0.005. At `width ≈ 0.022`
 * the shoulder is ~4× that: wide enough that the difference resolves a real
 * rolled edge rather than aliasing across the step, narrow enough that the step
 * stays an arris — 0.022 of `u` on a 9 m tower is a 20 cm bevel. This is the
 * tight end of the family's range on purpose; the plateau's `0.04–0.07` is a
 * broad terrace and softens the whole tower into a melted cone, while a
 * zero-width break gives the central difference nothing to differentiate and
 * comes back as papercraft.
 *
 * **Axis jog.** Radius steps alone still read as a lathe-turned profile, because
 * the axis is straight and the eye finds that instantly. The jogs are what make
 * it a *stack*: each block sits visibly off-centre from its neighbour, so the
 * silhouette is a zig-zag rather than a staircase. They are turned up here to
 * `radius × 0.2` (the spire uses 0.22 of a much smaller radius, the plateau
 * 0.05) — but anchored at the crown, so the walkable top stays over the
 * placement point and the stack leans away *below* it. Anchoring anywhere else
 * swings the top off its cylinder collider and the player stands on air.
 *
 * **Sign alternation** (`fitStrata`). The third dial is the one that was not
 * obvious until it was measured: `makeStrata`'s 68 %-outward draw is a random
 * walk *with a drift term*, and on six breaks instead of the plateau's two the
 * drift wins — the crown ended up at a median 48 % of the base and the prop was
 * a wedding cake. Forcing the breaks to alternate in and out down the stack is
 * both the fix and the reference: a coin stack is exactly a sequence where each
 * block is wider than the one above and narrower than the one below.
 *
 * Budgets (GDD §4.1): 260 / 150 / 82 / 38.
 */

const TAU = Math.PI * 2

export type PillarForm = 'tower' | 'step'

export interface PillarStackOptions {
  seed?: number
  form?: PillarForm
  /** Radius at the widest block, in metres. Defaults per form. */
  radius?: number
  height?: number
  /** Which rock this is cut from. Defaults to the family's pale blue-grey. */
  stone?: StonePalette
  /**
   * Strength of the sedimentary banding pass, 0–1. Default 0: the pale stone is
   * one rock, and striping it would put a desert cue on a Hebridean sea stack.
   * The desert registration passes 1.
   */
  banding?: number
  /**
   * Turf on the up-facing block tops. Defaults on for `PALE_STONE` and off for
   * every other palette — green on terracotta reads as a bug, whereas bare
   * stone never does, so the default fails in the safe direction for a future
   * chalk or ice palette too. Pass it explicitly to override.
   */
  shelfGrass?: boolean
}

interface FormSpec {
  radius: number
  height: number
  distanceScale: number
  /** Break count. Blocks = breaks + 1. */
  breaks: [number, number]
  /** Where breaks are allowed to land, in profile parameter. */
  span: [number, number]
  /** Axis jog per break, as a fraction of `radius`. */
  jog: number
}

/**
 * `distanceScale` stays at or under 2.5 for the same reason it does in
 * `plateau.ts`: cull is clamped to 320 m globally, so anything past ~2.6 opens
 * the LOD3 band beyond the cull distance and the tier is generated, budgeted,
 * asserted and never drawn.
 */
const FORMS: Record<PillarForm, FormSpec> = {
  // The jumping route. Tall enough to be a landmark, and the block spacing —
  // roughly 1.1 m of height per block at this size — is deliberately near the
  // player's step height so the silhouette reads as climbable.
  tower: { radius: 2.4, height: 9, distanceScale: 2.5, breaks: [5, 7], span: [0.12, 0.86], jog: 0.2 },
  // A low mounting block: wide, three blocks, and a much smaller jog. A short
  // prop with a tall prop's lean reads as falling over rather than as stacked.
  step: { radius: 2.8, height: 3.2, distanceScale: 2.0, breaks: [3, 3], span: [0.18, 0.78], jog: 0.13 }
}

/** Where the buried tip lands. The profile is exactly 0 here. */
const PROFILE_BOTTOM = 1.12

/** Lobes in the section. Every tier's segment count is 2× or 1× this. */
const LOBES = 6

/**
 * The crown may never fall below this fraction of the widest block.
 *
 * `makeStrata` draws roughly two breaks outward for every one inward, which is
 * right for a spire — a rock that only ever widens downward is a staircase — but
 * on six or seven breaks that bias *accumulates*. Across 40 seeds, before this
 * guard and `fitStrata`'s alternation, the crown collider on a nominal 2.4 m
 * tower ran from **0.80 m to 1.68 m, median 1.15 m**: the prop stopped being a
 * stack of coins and became a wedding cake, and the walkable top it exists to
 * provide shrank to 1.6 m across at nine metres up. With both in, 60 seeds give
 * 1.15–1.82 m, median 1.39 m.
 *
 * 0.62 keeps the top landable and the silhouette near vertical while still
 * leaving the stack visibly bottom-heavy.
 */
const MIN_CROWN_RATIO = 0.62

/**
 * The overall taper the blocks are cut from: near-vertical, widening 19 % from
 * crown to base so the tower is visibly bottom-heavy without any single step
 * having to carry that.
 *
 * Linear, not a fractional power. `u ** 0.9` reads slightly better and is a
 * partial function — the loft samples `u = -0.0025` at the crown and every
 * non-integer exponent of a negative number is NaN. That is the arithmetic that
 * shipped eight solid-black cliff tiers; see the header of `cliff.ts`.
 */
const pillarTaper = (u: number): number => 0.84 + 0.16 * u

/**
 * Closes the tip. The knee sits at `u = 0.96` and the prop is planted at
 * `u = 1`, so at ground level the base is still 90 % of full width: the taper is
 * almost entirely buried, and the bottom block meets the terrain as a block
 * rather than as a cone. Pulling the knee up to 0.94 to give the coarse tiers an
 * easier chord costs 21 % of the base's width above ground and it shows.
 */
const pillarFoot = (u: number): number => 1 - smootherstep(0.96, PROFILE_BOTTOM, u)

interface PillarShape {
  radius: number
  height: number
  sectionAt: (theta: number) => number
  strata: Stratum[]
  /** Normalises the profile so `radius` is the true maximum radius. */
  profileScale: number
  bands: StoneBand[]
  shelves: GrassShelf[]
  stone: StonePalette
  banding: number
  shelfGrass: boolean
  extent: number
  rng: Rng
}

interface PillarTier {
  /** How many breaks (prominence-first) this tier pins as real steps. */
  resolved: number
  rings: number
  segments: number
  budget: number
  aoSamples: number
}

/**
 * Segments hold at `2 × LOBES` from LOD0 to LOD2 and halve only at LOD3, where
 * 6 still lands on all 6 crests. Everything else is spent on rings, which is the
 * right way round for this family (GDD §4.1) — and doubly so here, because the
 * rings *are* the blocks.
 *
 * Triangles = `2 × segments × (rings − 1)`: the side bands, minus `segments` for
 * the half-degenerate band at the closed tip, plus `segments` back for the cap
 * fan. Those two cancel exactly, which is why the counts are so round.
 *
 * `resolved` is capped by arithmetic, not taste: pinning a break costs two rings
 * (`strataSeeds` brackets it), and `buildRingList` cannot place fewer than zero
 * free rings, so `2 + 2 × resolved ≤ rings` at every tier.
 *
 * LOD2 sits at 0 rather than at the 1 it can just afford, and this is the sharp
 * edge `cliff.ts` warns about, measured on this prop. At `resolved: 1` the whole
 * four-ring budget is the two endpoints plus one bracketed shoulder, so the
 * entire body below that shoulder is a single chord; the tier encloses far too
 * little, `profileVolumeInflate` scales it back up to compensate, and the
 * scaling is uniform — it lands on the **crown**, which is the one part of this
 * prop that has a collider attached to it. Across nine seeds the LOD2 crown came
 * out 11–57 % wider than LOD0's (worst 56.5 % for the tower, 45.5 % for the
 * step). At `resolved: 0`, where greedy refinement spends both free rings on the
 * largest deviations instead, the same measurement is 0.3–4.1 % (tower) and
 * 0.3–1.6 % (step). A merged pair of blocks is a fine LOD2; a tower whose top
 * grows by half at the crossfade is not.
 *
 * LOD3's crown runs 2.0–8.1 % over LOD0 and that residue is `sectionAreaInflate`
 * doing its job on a 6-gon rather than a ring-list problem — it is the price of
 * halving the segments, and paying it is what keeps the tier the same *size* as
 * the one it fades from.
 */
const TIERS: PillarTier[] = [
  { resolved: 4, rings: 11, segments: LOBES * 2, budget: 260, aoSamples: 12 },
  { resolved: 2, rings: 7, segments: LOBES * 2, budget: 150, aoSamples: 10 },
  { resolved: 0, rings: 4, segments: LOBES * 2, budget: 82, aoSamples: 8 },
  { resolved: 0, rings: 4, segments: LOBES, budget: 38, aoSamples: 6 }
]

/**
 * Forces the breaks to alternate outward / inward down the stack, and caps how
 * far the residual drift can carry the crown.
 *
 * This is the difference between the pillar and its siblings stated as one
 * function. `makeStrata` picks each break's direction independently at 68 %
 * outward, which on the plateau's two breaks and the spire's three is exactly
 * the wanted irregularity. On six it is a random walk with a drift term, and a
 * drifting radius is a *cone*: the reference is a stack of coins, so what the
 * eye has to be able to find is one block wider than the one above it and
 * narrower than the one below.
 *
 * Alternation also does most of the drift control for free — each outward step
 * is largely paid back by the next inward one — so the clamp below it is a
 * guarantee rather than the mechanism: over 120 shape builds it fired **twice**,
 * at `jutScale` 0.98 and 0.91. Scaling every jut by one factor is the right way
 * to spend those two: it preserves the alternation and the relative sizes, and
 * only the depth of the steps gives way.
 *
 * Inward steps are held to 72 % of an outward one. At parity the stack nets no
 * wider at all and reads as balanced on a point; at `makeStrata`'s own 70 % on
 * an unbiased sign sequence it is within a percent of this, so the number is
 * inherited rather than invented.
 */
const fitStrata = (strata: Stratum[]): void => {
  const byDepth = [...strata].sort((a, b) => a.u - b.u)
  for (const [i, stratum] of byDepth.entries()) {
    const outward = i % 2 === 0
    stratum.jut = Math.abs(stratum.jut) * (outward ? 1 : -0.72)
    // Only an outward step has an up-facing shelf for turf, and `makeStrata`'s
    // flag was set from a direction that has just been overwritten.
    stratum.shelf = outward
  }

  const peakWith = (jutScale: number): number => {
    let peak = 0
    for (let i = 0; i <= 256; i++) {
      const u = (i / 256) * PROFILE_BOTTOM
      peak = Math.max(peak, (pillarTaper(u) + strataAt(u, strata) * jutScale) * pillarFoot(u))
    }
    return peak
  }

  // `strataAt` is linear in `jut`, so one scalar stands in for rescaling the
  // whole list, and `peakWith` is monotonic in it — twelve bisections land
  // inside a thousandth.
  const ceiling = pillarTaper(0) / MIN_CROWN_RATIO
  if (peakWith(1) > ceiling) {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) * 0.5
      if (peakWith(mid) > ceiling) {
        hi = mid
      } else {
        lo = mid
      }
    }
    for (const stratum of strata) {
      stratum.jut *= lo
    }
  }

  // `makeStrata` orders prominence-first because that is the order the tiers drop
  // breaks in, and both fields it sorts on have just been rewritten.
  strata.sort((a, b) => Math.abs(b.jut) * (b.shelf ? 1.6 : 1) - Math.abs(a.jut) * (a.shelf ? 1.6 : 1))
}

/**
 * One stripe per block, with the stripe's edges on the block's own shoulders.
 *
 * Scattering the stripes the way `makeStoneBands` does is right for a butte,
 * whose geometry has no horizontal features to disagree with. Here it is
 * actively wrong: an offset stripe puts a colour change halfway up a flat block
 * face and leaves a *second* edge, the shoulder, a few centimetres away — and
 * two edges that nearly line up but don't is the exact signature of a
 * misregistered texture. Aligned, the colour change **is** the shoulder, the AO
 * crease lands on the same line, and the tower reads as rock cut into courses
 * rather than as rock with a decal on it. Aligning won, and not narrowly.
 *
 * `halfHeight = 0.72 × block` is the number that makes the alignment hold, and
 * it is a genuine optimum rather than a guess. `paintSedimentaryBands`' profile
 * is solid to `d = 0.5` and zero at `d = 1`, and its overlap rule is
 * strongest-band-wins, so where two neighbours cross is where the boundary
 * actually lands. Bisecting that crossover for the strength range drawn below:
 *
 *   0.58 × block → boundary within 1 % of a block, but each stripe is down to
 *                  **13 %** strength at the shoulder: the courses fade out
 *                  exactly where they are supposed to be crispest
 *   0.72 × block → boundary within 4.6 %, strength at the shoulder **70 %**
 *   1.00 × block → both neighbours saturate across the whole overlap, so the
 *                  *strength draw* decides the boundary and it wanders up to
 *                  **24 %** of a block off the geometry
 *
 * Signs alternate rather than being drawn at random. A stack of pale-only
 * stripes is a gradient with ripples in it; strict alternation is what lets the
 * eye count the courses from 60 m, where no geometry survives to say so.
 */
const makeBlockBands = (rng: Rng, edges: readonly number[]): StoneBand[] => {
  const bands: StoneBand[] = []
  for (let i = 0; i < edges.length - 1; i++) {
    const top = edges[i]!
    const bottom = edges[i + 1]!
    const block = top - bottom
    if (block <= 1e-4) {
      continue
    }
    bands.push({
      y: (top + bottom) * 0.5,
      halfHeight: block * 0.72,
      // Kept in a tight range on purpose — see the halfHeight note above.
      strength: rng.range(0.4, 0.6) * (i % 2 === 0 ? 1 : -0.8)
    })
  }
  return bands
}

const buildShape = (options: PillarStackOptions): PillarShape => {
  const form = options.form ?? 'tower'
  const spec = FORMS[form]
  const rng = makeRng(options.seed ?? 1)

  const radius = options.radius ?? spec.radius * rng.range(0.9, 1.12)
  const height = options.height ?? spec.height * rng.range(0.9, 1.12)

  // Shallow bundle offset and a small wobble: this prop reads as *cut blocks*,
  // so the flutes only need to keep the wall from being a lathe-turned cylinder
  // (valleys land ~7 % in from the crests). Deepen it and the vertical grooves
  // start competing with the horizontal courses, and the courses are the point.
  const sectionAt = makeSection(rng, LOBES, 0.34, [0.02, 0.045])

  // Narrow breaks, large juts, large jogs — the inverse of the plateau's two
  // broad terraces. `width` at 0.018–0.026 puts the shoulder at ~4× the loft's
  // central-difference span, which is a bevelled arris rather than a ramp.
  const strata = makeStrata(
    rng,
    rng.int(spec.breaks[0], spec.breaks[1]),
    spec.span,
    [0.018, 0.026],
    [0.1, 0.2],
    radius * spec.jog
  )
  fitStrata(strata)

  let peak = 0
  for (let i = 0; i <= 256; i++) {
    const u = (i / 256) * PROFILE_BOTTOM
    peak = Math.max(peak, (pillarTaper(u) + strataAt(u, strata)) * pillarFoot(u))
  }
  const profileScale = peak > 1e-6 ? 1 / peak : 1

  const yAt = (u: number): number => height * (1 - u)

  // Block boundaries, crown down to ground. The buried tip is deliberately not
  // an edge: the bottom block's stripe should be sized to the part of it anyone
  // can see, not stretched by the 12 % that is under the terrain.
  const edges = [height, ...strata.map(stratum => yAt(stratum.u)).sort((a, b) => b - a), 0]

  const stone = options.stone ?? PALE_STONE

  let jog = 0
  for (const stratum of strata) {
    jog += Math.hypot(stratum.jogX, stratum.jogZ)
  }

  return {
    radius,
    height,
    sectionAt,
    strata,
    profileScale,
    // Built once here and shared by every tier, never per tier: a band is a
    // function of Y alone, so one list is what guarantees LOD0 and LOD3 stripe
    // at the same heights. Four tiers with four stripe patterns is two different
    // rocks inside one crossfade (GDD §4.3, and the note in `stone.ts`).
    bands: makeBlockBands(rng, edges),
    // Same argument, and `paintGrassShelves` is self-correcting across tiers: a
    // tier that resolved a break has up-facing normals there and grows turf, one
    // that merged it has near-horizontal normals and grows almost none.
    shelves: strata
      .filter(stratum => stratum.shelf)
      .map(stratum => ({ y: yAt(stratum.u), halfHeight: height * stratum.width * 0.9 })),
    stone,
    banding: options.banding ?? 0,
    shelfGrass: options.shelfGrass ?? stone === PALE_STONE,
    extent: radius + jog,
    rng
  }
}

const buildTier = (shape: PillarShape, tier: PillarTier, name: string): BufferGeometry => {
  const { segments } = tier
  const inflate = sectionAreaInflate(segments, 0, shape.sectionAt)

  const yAt = (u: number): number => shape.height * (1 - u)
  // The foot is applied over the strata rather than under them, so a break low
  // on the body can still jut without stopping the tip closing to a point — a
  // tip that does not close costs `segments` extra triangles for a cap nobody
  // sees, and the budgets here have no room for it.
  const profileAt = (u: number): number =>
    (pillarTaper(u) + strataAt(u, shape.strata)) * pillarFoot(u) * shape.profileScale
  const offsetAt = (u: number, out: Vector3): Vector3 => strataOffsetAt(u, shape.strata, out)

  const us = buildRingList(
    // Anchored at `u = 0`. Every ring list starts at the crown, so the flat top
    // is at exactly `height` on all four tiers and the collider's claim that the
    // top is flat and where it says it is holds at every LOD.
    [0, PROFILE_BOTTOM, ...strataSeeds(shape.strata, tier.resolved)],
    tier.rings,
    (u, out) => {
      offsetAt(u, out)
      const jogX = out.x
      const jogZ = out.z
      return out.set(shape.radius * profileAt(u), jogX, jogZ)
    }
  )

  // Both corrections together: one for the section polygon, one for the ring
  // chords. Neither is optional — each fixes a bias the other cannot see.
  const scale = shape.radius * inflate * profileVolumeInflate(us, profileAt, yAt)
  const radiusAt = (u: number, theta: number): number => scale * profileAt(u) * shape.sectionAt(theta)

  const body = loftGeometry({
    us,
    segments,
    yAt,
    radiusAt,
    offsetAt,
    // The crown is walkable and the collider says it is flat, so it gets its own
    // capped ring with exact `+Y` normals rather than sharing the wall's.
    capTop: true
  })

  paintStoneBody(body, shape.rng, shape.stone, 0.03)
  paintSedimentaryBands(body, shape.stone, shape.bands, shape.banding)
  if (shape.shelfGrass) {
    paintGrassShelves(body, shape.shelves, 0.95)
  }

  // Merged even though there is one part: `mergeParts` is what normalises the
  // attribute set (drops UVs, adds the zero `aWind` the toon material's wind
  // path reads). A lofted rock that skips it ships a tier the LOD system has to
  // special-case.
  const merged = mergeParts([body], name)

  // Scaled to the prop's **radius**, not its height. Every occluder on this
  // shape is a block oversailing the one beneath it, and that overhang is at
  // most a jut plus a jog — well under a radius. Rays budgeted to the 9 m height
  // spend themselves flying up the open side of the tower and come back with
  // nothing, which costs bake time and lifts the very shadow under the ledges
  // that is doing all the modelling work here (GDD R1).
  const ao = bakeVertexAO(merged, {
    samples: tier.aoSamples,
    maxDistance: shape.radius,
    strength: 0.9,
    power: 1.15
  })
  applyVertexAO(merged, ao, shape.stone.shadow, 0.85)

  return finishTier(merged, tier.budget, name)
}

export const createPillarStackAsset = (options: PillarStackOptions = {}): WorldAsset => {
  const form = options.form ?? 'tower'
  const shape = buildShape(options)
  // The banding flag is in the name because this generator is registered twice
  // — pale and desert — and two placeables sharing a name would collide in the
  // budget ledger and in the perf panel's per-asset breakdown.
  const name = `pillar-${form}-${shape.banding > 0 ? 'banded' : 'plain'}-${options.seed ?? 1}`

  const tiers = TIERS.map((tier, i) => buildTier(shape, tier, `${name}/LOD${i}`))

  return {
    name,
    perfTag: 'pillars',
    tiers,
    material: createCliffMaterial('pillar-stack'),
    outline: createOutlineMaterial({ pixelWidth: 1.6, name: 'pillar-stack-outline' }),
    outlineMaxTier: 1,
    // The jogged base, not the crown: the lowest block is both the widest and
    // the furthest off-axis, and a bounding radius that misses it pops the whole
    // tower out of the frustum from underneath.
    radius: Math.hypot(shape.extent, shape.height),
    distanceScale: FORMS[form].distanceScale
  }
}

/**
 * Crown radius and height, for collider sizing.
 *
 * The narrowest bearing of the section, not the widest, times the profile at
 * `u = 0` — the same inscribed rule as `plateauMetrics`, for the same reason: the
 * crown is fluted, so its outline is not a circle. A collider on the crests
 * leaves arcs of thin air over the valleys for the player to stand on, while one
 * on the valleys costs a few centimetres of real ledge. Only the first of those
 * gets filed as a bug.
 *
 * `profileAt(0)` is evaluated rather than assumed to be `pillarTaper(0)`: a break
 * placed at the very top of its span can reach up into `u = 0` through its own
 * bevel, and the crown would then be several centimetres wider than the collider
 * claims.
 */
export const pillarStackMetrics = (options: PillarStackOptions = {}): { radius: number; height: number } => {
  const shape = buildShape(options)

  let narrowest = Number.POSITIVE_INFINITY
  for (let i = 0; i < 128; i++) {
    narrowest = Math.min(narrowest, shape.sectionAt((i / 128) * TAU))
  }

  const crown = (pillarTaper(0) + strataAt(0, shape.strata)) * pillarFoot(0) * shape.profileScale
  return { radius: shape.radius * crown * narrowest, height: shape.height }
}
