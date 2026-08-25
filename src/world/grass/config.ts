/**
 * ─── Grass LOD table, coverage maths and the detail ladder ──────────────────
 *
 * Grass gets its **own** six-tier table rather than riding `lod/config.ts`'s
 * four, and that is a deliberate departure from GDD R7 rather than an oversight.
 * The reason is that a tier boundary costs something quite different here:
 *
 * * A boulder's tiers differ in *tessellation*. Four tiers is plenty, because
 *   the silhouette barely moves and the crossfade hides what's left.
 * * Grass tiers differ in *population*. Tier N+1 draws a strict **subset** of
 *   tier N's blades (see `bladeGeometry.ts`), so a tier step is a density halving
 *   — and halving density in four steps from "meadow" to "one blade per square
 *   metre" makes each step a visible thinning. Six steps of ~35 % each is the
 *   same total reduction spread finely enough that no single boundary reads.
 *
 * The second reason is arithmetic. Grass covers *area*, so cost goes as the
 * square of the range: the outermost tier holds ~57 % of all patches. Spending
 * two extra tiers out there is the cheapest possible way to buy back triangles,
 * and it is exactly where a triangle is worth least.
 */

/** Tiers. Six, see above. */
export const GRASS_TIER_COUNT = 6

/**
 * Edge length of one patch, in metres.
 *
 * This is the unit of instancing, of culling and of terrain-height
 * interpolation, so it is three trade-offs at once:
 *
 * * **Smaller** → tighter culling (less grass drawn outside the view cone) and a
 *   more accurate bilinear height fit, but more instances and more CPU per frame.
 * * **Larger** → fewer instances, but a patch straddling a tier boundary flips
 *   ~200 blades at once, and the bilinear height fit starts to float grass off a
 *   convex ridge.
 *
 * 4 m sits where the height error over the world's terrain (30 m amplitude,
 * 170 m feature size) stays under ~3 cm — well inside the depth a blade is sunk
 * into the ground anyway.
 */
export const PATCH_SIZE = 4

/** Convenience: patch area, used for capacity estimates. */
export const PATCH_AREA = PATCH_SIZE * PATCH_SIZE

/**
 * End distance of each tier at detail `ultra`, in metres.
 *
 * Not `LOD_DISTANCES × distanceScale`: grass is not a scaled-down prop. A blade
 * is ~0.35 m and would be culled by ~40 m on the prop table, which is far too
 * close — a meadow that stops at 40 m reads as a circle of lawn following the
 * player. What lets it reach 140 m instead is that the far tiers cost almost
 * nothing (8 triangles per 16 m² against 1 344 at LOD0).
 */
export const GRASS_DISTANCES = [9, 18, 32, 54, 78, 115] as const

/**
 * Fraction of the last tier's blades still standing at the cull distance.
 *
 * Not zero: the height taper in `grassGlsl.ts` sinks the survivors into the
 * ground over the same stretch, and having both reach zero at once makes the
 * horizon edge sharper than either does alone.
 */
export const HORIZON_DENSITY = 0.35

/**
 * Width of the per-blade fade, as a fraction of the patch's live blade count.
 *
 * ── Why a fraction, and not a fixed number of blades ────────────────────────
 *
 * A blade is drawn when its ordinal falls under `live`, and the blades straddling
 * that threshold are part-height so nothing appears in a single frame. The
 * question is *how many* straddle it, and the first implementation answered with
 * a constant: 2.5 blades.
 *
 * That is a constant in the wrong space. What matters is how much **camera
 * travel** a blade takes to grow, and that is `window / (d live/d distance)` —
 * so a constant window means the fade duration is inversely proportional to how
 * steeply the ramp falls. Measured with the front-loaded table, LOD0 sheds 54
 * blades per metre, so 2.5 ordinals is **4.6 cm of travel — twelve milliseconds
 * at walking pace, under one frame.** Every blade popped, and 54 of them did it
 * per metre walked. Tripling the near-field density made it three times worse,
 * which is why it only became obvious afterwards.
 *
 * A fraction of `live` fixes both halves at once:
 *
 * * **Duration becomes roughly constant in distance** (1.1–3.8 m across the whole
 *   table) instead of varying 15× between the near field and the horizon.
 * * **It is continuous at tier boundaries.** `live` agrees on both sides by
 *   construction (§4.3), so a window derived from it agrees too. A per-tier
 *   window does not: the slope jumps at every boundary, and at LOD1→LOD2 that
 *   would have swapped ~39 blades of 240 between "fading" and "full" in one step
 *   — trading the pop this fixes for a smaller one at 18 m.
 *
 * The cost is that ~10 % of blades are mid-fade at any moment, which reads as
 * height variation rather than as missing grass — the blades already vary 0.70 to
 * 1.32 in height per blade, so a few short ones are indistinguishable.
 */
export const FADE_FRACTION = 0.1

/**
 * Blades baked into one patch, per tier, at detail `ultra`.
 *
 * ── The near field is deliberately front-loaded ─────────────────────────────
 *
 * 900 blades over 16 m² is **56 blades/m²** underfoot, against 15 at 25 m and
 * 1.3 at the horizon. That is a 45× spread across the table, and it is the right
 * shape because *area* is what costs: LOD0's whole disc is 16 patches full-circle
 * and about **6** survive the view cone, while LOD5's ring is 1 400 patches and
 * 224 survive. A blade added to LOD0 is drawn by six patches; a blade added to
 * LOD5 is drawn by two hundred.
 *
 * So the tier the player is standing in is the cheapest place in the entire
 * system to spend a blade, and the first pass under-spent it — 380 blades read as
 * a lawn with tufts on it rather than as a meadow you are standing in.
 *
 * The counts still fall smoothly enough that the density ramp between neighbours
 * never steps: the largest ratio is 900 → 560 across LOD0, which the ramp spreads
 * over nine metres.
 */
export const TIER_BLADES = [900, 560, 240, 110, 44, 20] as const

/**
 * How hard a detail level's `density` hits each tier.
 *
 * `bladesForTier` raises the level's density to these exponents, so a lower
 * setting thins the **near** tiers hardest and leaves the far ones nearly alone.
 * That is the opposite of `lod/config.ts`'s `TIER_QUALITY_EXPONENT`, and both are
 * right, because the two knobs mean different things: there, quality moves
 * *distance*, and pulling the near boundary in costs the player detail on the
 * object in front of them. Here `range` already owns distance, and `density` owns
 * blades per patch — where the arithmetic runs the other way.
 *
 * Two reasons, both measured:
 *
 * * **The near tiers are where the cost is.** With the front-loaded table above,
 *   LOD0–LOD2 are 63 % of grass triangles at `ultra`. A uniform multiplier takes
 *   most of its saving from tiers that were nearly free to begin with.
 * * **A uniform multiplier empties the horizon.** LOD5 is 20 blades at `ultra`;
 *   at `minimum`'s 0.22 a flat scale leaves **4**, which after the horizon ramp is
 *   one blade per patch — a visibly bald far field on exactly the devices that
 *   can least afford the fog to be doing nothing. At 0.45 it keeps 10.
 */
export const TIER_DENSITY_EXPONENT = [1.0, 0.95, 0.85, 0.7, 0.55, 0.45] as const

/**
 * Length segments per blade, per tier. Triangles per blade = `2·s − 1`
 * (the tip segment collapses to a point), so 7 / 5 / 3 / 1 / 1 / 1.
 */
export const TIER_SEGMENTS = [4, 3, 2, 1, 1, 1] as const

/**
 * Width multiplier per tier.
 *
 * Tiers 0–3 are blades. Tiers 4 and 5 are **impostors**: a short, broad, upright
 * triangle standing in for a small tuft, which is the grass analogue of the
 * solid impostor blob GDD §4.1 uses for prop LOD3 — and it is chosen for the
 * same reason a cross-billboard was rejected there. With no alpha mask a
 * billboard is a literal rectangle; a triangle is a shape.
 *
 * ── These are nearly flat, and the first pass was not ───────────────────────
 *
 * Tier 5 was originally 6.4× width at 8 blades a patch, on the reasoning that at
 * 100 m each triangle stands in for a whole tuft. The horizon came out as a
 * field of white speckles: at that range the ground is seen at a *grazing*
 * angle, so it occupies very little screen area and a 30 cm-wide flag is not a
 * tuft, it is a flag.
 *
 * Two things came out of fixing it. The first is that what reads correctly at
 * that distance is a **dense low fuzz** — many small triangles, not a few large
 * ones. The second matters more: the job those numbers were doing is already
 * done, and done better, by the screen-width floor in `grassGlsl.ts`, which
 * widens a blade to a minimum *pixel* count using the real framebuffer instead
 * of a baked guess about how far away it will be. So these are now almost flat,
 * and that also removes the last visible discontinuity at a tier boundary — a
 * 40 % width step between two tiers is a step in ground *coverage*, which shows
 * as a faint ring even when the individual blades are sub-pixel.
 */
export const BLADE_WIDTH_SCALE = [1, 1, 1.04, 1.1, 1.18, 1.28] as const

/** Height multiplier per tier. The far tiers sit slightly lower — sward, not
 *  stalks — but only slightly; see `BLADE_WIDTH_SCALE`. */
export const BLADE_HEIGHT_SCALE = [1, 1, 1, 0.98, 0.95, 0.92] as const

/** Triangles per patch, per tier. Asserted at generation time. */
export const TIER_TRI_BUDGET = TIER_BLADES.map(
  (blades, tier) => blades * (2 * TIER_SEGMENTS[tier]! - 1)
) as readonly number[]

// ─── Wind falls off with distance ───────────────────────────────────────────

/**
 * Where the wind starts and finishes fading out, in metres before scaling.
 *
 * Distant grass does not sway, and that is an **art** decision before it is a
 * performance one. At 50 m a blade is two or three pixels wide; moving it a
 * fraction of a pixel per frame does not read as wind, it reads as *sparkle* —
 * the same sub-pixel aliasing the screen-width floor exists to fix, except that
 * a width floor cannot help geometry whose problem is that it moves. A still
 * far field is calmer and more legible, and it makes the near field's motion
 * read as nearer.
 *
 * The saving comes free with it. Everything past `WIND_FADE_END` skips the whole
 * wind block — two `sin` calls and ~15 ops — and that is where the vertices are:
 * LOD4 and LOD5 are **75 % of drawn patches** and 22 % of drawn vertices.
 *
 * 26 → 48 m puts the fade inside LOD2/LOD3 and leaves LOD4 (which starts at 54)
 * and LOD5 entirely still, so their branch is uniform across the whole draw call
 * and costs nothing to take.
 */
export const WIND_FADE_START = 26
export const WIND_FADE_END = 48

/**
 * Whether a tier needs the wind block compiled into its draw at all.
 *
 * Derived from the tables rather than hard-coded, so moving a tier boundary or
 * the fade range cannot silently leave a swaying tier with its wind switched off
 * — which would read as a band of frozen grass at a fixed radius.
 */
export const tierHasWind = (tier: number): boolean => tierStartRatio(tier) < WIND_FADE_END

/** Tier start distance before scaling. Scale-independent, so `tierHasWind` is. */
const tierStartRatio = (tier: number): number => (tier === 0 ? 0 : GRASS_DISTANCES[tier - 1]!)

// ─── The detail ladder ──────────────────────────────────────────────────────

export interface GrassDetailLevel {
  name: string
  /** Multiplies every tier's blade count. */
  density: number
  /** Multiplies every tier's switch distance. */
  range: number
  /**
   * Extra half-angle beyond the camera's horizontal FOV, in degrees — the
   * "rotation gap". Wider is safer on a fast turn and costs more grass.
   */
  coneMarginDeg: number
}

/**
 * Five levels, named to match `perf/AdaptiveQuality.ts` exactly so `auto` can map
 * one onto the other without a translation table nobody would keep in sync.
 *
 * ── Density and range do not fall at the same rate, on purpose ──────────────
 *
 * Cost goes as `density × range²`, because grass covers area — so cutting range
 * is quadratically more effective than cutting density. `range` therefore drops
 * hard down the ladder, which is also the same argument `setLodQuality` makes for
 * props: the first thing a struggling machine should lose is the horizon, never
 * the ground it is standing on. A meadow that stops 60 m sooner reads as haze at
 * this fog density; one that thins underfoot reads as *broken*.
 *
 * Density falls further than range in raw numbers — 4.5× against 2.2× — and that
 * is not a contradiction, because density does **not** apply uniformly: see
 * `TIER_DENSITY_EXPONENT`, which spends almost all of it on the near tiers where
 * the triangles actually are and leaves the horizon nearly untouched. Combined,
 * `ultra` → `minimum` is roughly **17×**.
 *
 * The densities look small against the old ladder (0.5 → 0.22 at `minimum`) and
 * are not a reduction: `TIER_BLADES` was front-loaded at the same time, so
 * `minimum` bakes 198 blades into LOD0 where it used to bake 190. What changed is
 * the top — `ultra` went from 380 to 900. The fractions moved because the thing
 * they are a fraction *of* moved.
 *
 * ── And density loss is compensated in width ────────────────────────────────
 *
 * Halving blade count without touching blade width halves ground *coverage*, and
 * the result is not "less grass", it is bald patches with grass in them. Each
 * level therefore widens its blades by `1/√density` (capped), so the sward keeps
 * roughly constant coverage and the levels differ in *resolution* rather than in
 * whether there is a lawn. See `bladeGeometry.ts`.
 */
export const GRASS_LEVELS: readonly GrassDetailLevel[] = [
  { name: 'minimum', density: 0.22, range: 0.45, coneMarginDeg: 10 },
  { name: 'low', density: 0.33, range: 0.58, coneMarginDeg: 11 },
  { name: 'medium', density: 0.48, range: 0.72, coneMarginDeg: 12 },
  { name: 'high', density: 0.7, range: 0.86, coneMarginDeg: 13 },
  { name: 'ultra', density: 1, range: 1, coneMarginDeg: 14 }
]

/** What the settings menu can be set to. `auto` follows `AdaptiveQuality`. */
export type GrassDetailSetting = 'auto' | 'off' | 'minimum' | 'low' | 'medium' | 'high' | 'ultra'

export const GRASS_DETAIL_SETTINGS: readonly GrassDetailSetting[] = [
  'auto',
  'ultra',
  'high',
  'medium',
  'low',
  'minimum',
  'off'
]

export const grassLevelIndex = (name: string): number => {
  const index = GRASS_LEVELS.findIndex(level => level.name === name)
  return index < 0 ? GRASS_LEVELS.length - 1 : index
}

// ─── Tier selection and the density ramp ────────────────────────────────────

/**
 * ─── Why grass has no crossfade band ────────────────────────────────────────
 *
 * Every other LOD in this world dithers across a transition band (GDD R7 / §4.3)
 * and grass does not. That is a deliberate departure, and it serves R7's *intent*
 * — nothing pops — strictly better than R7's *mechanism* does here.
 *
 * **The mechanism was measured and it fails on grass.** A crossfade hides a
 * discontinuity by drawing both tiers with complementary screen-door patterns.
 * That reconstructs beautifully on a boulder, whose two tiers cover the same
 * pixels. Grass tiers differ in *population*: the blades tier N+1 does not have
 * are drawn by tier N alone at 50 % coverage, so they are not reconstructed by
 * anything — they render as visibly hatched blades. On geometry three pixels
 * wide, a half-tone is not a fade, it is a comb.
 *
 * **So the discontinuity is removed instead of hidden.** The number of blades a
 * patch draws is a *continuous* function of distance:
 *
 *     live(d) = lerp(bladesInThisTier, bladesInTheNextTier, k)   k ∈ [0,1]
 *
 * A blade is drawn iff its ordinal in the baked sequence is below `live`, and the
 * two or three blades straddling that threshold shrink into the ground rather
 * than blinking (see `grassGlsl.ts`). At a tier boundary `k` reaches 1 on the
 * outgoing side and 0 on the incoming side, and both evaluate to *the same
 * number* — so the swap changes the blade population by exactly zero. This works
 * only because tier N+1 bakes a strict prefix of tier N's blade sequence
 * (`bladeGeometry.ts`), which is what makes "the first 34 blades" mean the same
 * thing in both tiers.
 *
 * What still changes at a boundary is tessellation (4 segments → 3) and ~6 % of
 * blade width. Both are sub-pixel at the distance they happen.
 *
 * **And it is faster.** GDD §4.3 measures 21–29 % of instances mid-crossfade at
 * any moment, each drawn twice. Grass pays none of that: a patch belongs to
 * exactly one tier, always.
 */

/** Start distance of a tier — the previous tier's end. */
export const tierStart = (tier: number, scale: number): number =>
  tier === 0 ? 0 : GRASS_DISTANCES[tier - 1]! * scale

/** Tier a patch at `distance` belongs to, or −1 when it is past the cull. */
export const grassTierAt = (distance: number, scale: number): number => {
  for (let i = 0; i < GRASS_TIER_COUNT; i++) {
    if (distance < GRASS_DISTANCES[i]! * scale) {
      return i
    }
  }
  return -1
}

/**
 * Blades a patch draws at `distance`, interpolated between its tier's baked
 * count and the next tier's.
 *
 * `baked` is the *actual* per-tier blade counts after the detail level's density
 * multiplier, not `TIER_BLADES` — a level that bakes 30 % of the blades must ramp
 * between the numbers it actually baked, or the ramp would ask for blades that
 * are not in the geometry and the sward would simply stop thinning.
 */
export const liveBladesAt = (
  tier: number,
  distance: number,
  scale: number,
  baked: readonly number[]
): number => {
  const ramp = tierRamp(tier, scale, baked)
  const start = ramp[0]!
  const end = ramp[1]!
  const here = ramp[2]!
  const next = ramp[3]!
  const span = end - start
  const k = span > 0 ? Math.min(1, Math.max(0, (distance - start) / span)) : 0
  return here + (next - here) * k
}

/**
 * The four numbers the ramp needs: `[start, end, bladesAtStart, bladesAtEnd]`.
 *
 * Handed to the shader as a `vec4` so the ramp can be evaluated **per blade**
 * from that blade's own depth, rather than once per patch from the patch centre.
 *
 * That is not a micro-optimisation, it is a visible fix. A patch is 4 m and the
 * near ramp sheds ~54 blades per metre, so two adjacent patches differ by ~150
 * blades of ~730 — a **20 % density step, on a 4 m grid, right in front of the
 * player**. Evaluating per blade makes the density a smooth function of position
 * and the grid disappears. It costs four instructions and one `vec4` uniform.
 *
 * Written into `out` so the per-frame path never allocates (GDD §5.2).
 */
export const tierRamp = (
  tier: number,
  scale: number,
  baked: readonly number[],
  out: number[] = [0, 0, 0, 0]
): number[] => {
  const here = baked[tier] ?? 0
  out[0] = tierStart(tier, scale)
  out[1] = GRASS_DISTANCES[tier]! * scale
  out[2] = here
  // The last tier ramps toward a fraction of itself rather than to nothing —
  // see `HORIZON_DENSITY`.
  out[3] = tier + 1 < GRASS_TIER_COUNT ? (baked[tier + 1] ?? 0) : here * HORIZON_DENSITY
  return out
}

/** Distance past which grass is dropped entirely, for a given range scale. */
export const grassCullDistance = (scale: number): number => GRASS_DISTANCES[GRASS_TIER_COUNT - 1]! * scale

/**
 * Patch slots a tier can need, for a given range scale.
 *
 * The full ring area rather than the cone-culled share: the cone is a *setting*
 * (it can be widened for an A/B, and it widens by itself on an ultrawide
 * window), and a capacity that assumed it would silently drop grass the moment
 * either changed. Over-reserving is 48 bytes a slot.
 */
export const tierCapacity = (tier: number, scale: number): number => {
  const outer = GRASS_DISTANCES[tier]! * scale
  const inner = tierStart(tier, scale)
  const area = Math.PI * (outer * outer - inner * inner)
  // +1 ring of patches for the boundary, ×1.15 for clustering slack.
  return Math.ceil((area / PATCH_AREA) * 1.15) + 64
}
