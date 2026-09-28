import { valueNoise2D } from '../geometry/rng'

/**
 * ─── Where the water is ─────────────────────────────────────────────────────
 *
 * The engine has no idea a chapter exists, and it must not learn: `story/` is
 * content and `terrain/` is the machine that content runs on. But the ground has
 * to know where the waterline is, because *everything a shore looks like* is a
 * function of one number — how far above the surface a point of ground stands.
 * Sand, damp sand, the dry-grass collar and the absence of blades are all that
 * quantity, ramped.
 *
 * So the engine is handed a **water table**: a list of horizontal rectangles,
 * each with a surface height and an optional linear slope. Not a callback, and
 * that is the whole design constraint:
 *
 *   * `chunkGeometry.ts` runs `groundColorCore` on a **Web Worker**, which is
 *     its own module graph. A `(x, z) => number` closure cannot cross a
 *     `postMessage`; a `Float32Array` can, and does, uncopied.
 *   * `grassPlacement.ts` is deliberately three-free and worker-ready for the
 *     same reason (`grass.md` §7, §9.1), so whatever reaches it has to survive a
 *     structured clone without turning into a graph of objects.
 *
 * This is exactly the decision `grassPlacement.ts::setGrassExclusions` already
 * makes for building footprints, and it is made the same way here on purpose:
 * one flat-array convention for "places the terrain must be told about", rather
 * than two.
 *
 * ── Rectangles, not a signed-distance field ─────────────────────────────────
 *
 * A body of standing water in this world *is* a rectangle: `frame.ts::SEA_HALF`
 * says so in as many words, and the seabed under it is shaped as one for the
 * same reason. A river is a rectangle too once you accept a slope — the Arla
 * falls 3.4 m over 260 m in a straight line, so a single rect with `slopeZ`
 * reproduces its surface *exactly* where ten per-segment rects would step
 * 0.34 m at every node boundary. On the Arla's 0.7 m/m bank that step is 0.5 m
 * of horizontal shore, which is a visible notch every 26 m.
 *
 * The rect is the **water plane's** footprint, not the wet ground's. It extends
 * well past the shore in every direction — the sea's is 172 m from the island's
 * centre against a shoreline at 71 m — which is what makes the query "how high
 * is the water here" answerable on dry land at all.
 */

/**
 * One body of standing or slowly-running water.
 *
 * `y` is the surface height at the rect's **centre**; `slopeX`/`slopeZ` carry it
 * away from there in metres per metre. A pond, a lake and the sea leave both at
 * zero.
 */
export interface WaterBody {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
  /** World-space y of the surface at the centre of the rectangle. */
  y: number
  /** Fall of the surface along +x, metres per metre. Default 0. */
  slopeX?: number
  /** Fall of the surface along +z, metres per metre. Default 0. */
  slopeZ?: number
}

/** Floats per body in the packed table: minX, minZ, maxX, maxZ, y, slopeX, slopeZ. */
export const WATER_STRIDE = 7

/**
 * What `waterLevelAt` answers with on dry land.
 *
 * `-Infinity` rather than a sentinel like `-9999`, because every consumer's next
 * move is `height - waterLevelAt(x, z)` and the honest answer there is "this
 * ground is infinitely far above the water" — which then clamps to *no shore
 * treatment at all* through the same expression that ramps it near one. A finite
 * sentinel would need a branch at every call site, and one of those call sites
 * would eventually be missing it.
 */
export const NO_WATER = Number.NEGATIVE_INFINITY

/** Packs bodies for the wire. Returns an empty array for an empty list. */
export const packWaterBodies = (bodies: readonly WaterBody[]): Float32Array => {
  const out = new Float32Array(bodies.length * WATER_STRIDE)
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i]!
    const o = i * WATER_STRIDE
    out[o] = Math.min(body.minX, body.maxX)
    out[o + 1] = Math.min(body.minZ, body.maxZ)
    out[o + 2] = Math.max(body.minX, body.maxX)
    out[o + 3] = Math.max(body.minZ, body.maxZ)
    out[o + 4] = body.y
    out[o + 5] = body.slopeX ?? 0
    out[o + 6] = body.slopeZ ?? 0
  }
  return out
}

/**
 * This module graph's copy of the table.
 *
 * Module-level, like `TERRAIN_PALETTE` and `EXCLUSIONS` in `grassPlacement.ts`,
 * and for the identical reason: the main thread and each terrain worker hold
 * their own, fed by their own message. The alternative — threading it through
 * `HeightfieldParams` — reads better and does not work, because that struct is
 * cloned into the worker exactly once at `init` and water arrives after the
 * chapter's placeables have drained.
 */
let WATER: Float32Array<ArrayBufferLike> = new Float32Array(0)

export const setWaterTable = (table: Float32Array<ArrayBufferLike>): void => {
  WATER = table
}

/** The live table, for a caller that has to forward it (the worker pool does). */
export const waterTable = (): Float32Array<ArrayBufferLike> => WATER

/**
 * Surface height of the water standing over `(x, z)`, or `NO_WATER`.
 *
 * **Highest wins** where two bodies overlap. That is the right way round for the
 * one case that actually occurs — a river running out into a sea — because the
 * river's surface is the one that decides where its own banks are wet, and the
 * sea's rectangle is only there to answer for open water.
 *
 * A linear scan. There are one or two bodies in a chapter and this is called
 * once per terrain vertex (625 at LOD0 per 48 m chunk) and once per grass patch,
 * both of which already cost four fbm octaves each — the scan is four compares
 * against sixteen value-noise lookups.
 */
export const waterLevelAt = (x: number, z: number): number => {
  let best = NO_WATER
  for (let i = 0; i + WATER_STRIDE <= WATER.length; i += WATER_STRIDE) {
    const minX = WATER[i]!
    const minZ = WATER[i + 1]!
    const maxX = WATER[i + 2]!
    const maxZ = WATER[i + 3]!
    if (x < minX || x > maxX || z < minZ || z > maxZ) {
      continue
    }
    const y = WATER[i + 4]! + WATER[i + 5]! * (x - (minX + maxX) * 0.5) + WATER[i + 6]! * (z - (minZ + maxZ) * 0.5)
    if (y > best) {
      best = y
    }
  }
  return best
}

// ─── The shore band ─────────────────────────────────────────────────────────

/**
 * ── The one quantity a shore is made of ─────────────────────────────────────
 *
 * `height − waterLevelAt(x, z)`. Every constant below is a threshold on it, in
 * metres, and that choice does a job no horizontal distance could: it makes the
 * beach's *width* fall out of the ground's own slope. A shelving shore gets a
 * wide beach and a cut bank gets a narrow strip of wet sand, from one set of
 * numbers, because that is what those two things are.
 *
 * ── Measured against the ground the chapter actually has ────────────────────
 *
 * The storyteller's island, sampled through `terrain.heightAt` in the browser
 * along +x from `ISLE`, is the calibration case:
 *
 * | r (m) | 92    | 84    | 76    | 71.1 | 68   | 64   | 62   | 60   | 58   | 56   |
 * |-------|-------|-------|-------|------|------|------|------|------|------|------|
 * | above | −1.04 | −1.00 | −0.51 | 0.00 | 0.25 | 0.40 | 0.52 | 0.85 | 1.33 | 1.90 |
 *
 * So the beach falls at **0.095 m/m** and the shoulder behind it at 0.16–0.29,
 * and the thresholds below convert to this much *walking*, outward from the
 * plateau:
 *
 * | band                        | height above water | on this shore |
 * |-----------------------------|-------------------:|--------------:|
 * | meadow restored             |        above 2.30  |    from r 54.8|
 * | dry-grass collar            |       0.45 … 2.30  |         7.9 m |
 * | sand, fading                |       0.45 … 1.40  |         4.9 m |
 * | sand, full                  |       below 0.45   |         8.4 m |
 * | damp sand at the waterline  |       below 0.40   |         4.2 m |
 *
 * That is a **16 m walk** from meadow to water, of which 13 m is visibly beach —
 * about four seconds at the player's pace, which is what a shore this size
 * should cost to cross. On the Arla's 0.7 m/m cut bank the same numbers give
 * 2.6 m, correctly: that bank is not a beach.
 *
 * ── Terrain vertices carrying the gradient, per LOD ─────────────────────────
 *
 * A chunk is 48 m at 24/12/6/3 quads a side (`Terrain.ts::TIER_SEGMENTS`), so
 * the vertex spacing is 2 / 4 / 8 / 16 m and the 16 m band is carried by **8 /
 * 4 / 2 / 1** vertices. LOD3 cannot resolve the band at all — which is fine and
 * is why the numbers are not pushed any narrower: LOD3 starts well past the
 * distance at which exp² fog (`FOG_DENSITY` 0.0085) has taken 60 % of the
 * saturation out of the ground anyway. LOD1 at four vertices is the tier that
 * sets the floor, and it is the reason the sand band is 0.95 m of height rather
 * than the 0.4 m that would read as a crisp tideline up close.
 */

/** Sand is at full strength at and below this height above the water. */
export const SHORE_SAND_FULL = 0.45
/** …and gone by here. Between the two it fades into the dry-grass collar. */
export const SHORE_SAND_TOP = 1.4
/** Top of the dry-grass collar; the meadow is untouched above it. */
export const SHORE_DRY_TOP = 2.3
/**
 * Damp sand: full at and below the waterline, gone by here.
 *
 * 0.4 rather than the 0.25 a tideline looks like in life, and the reason is the
 * mesh, not the art. A terrain vertex is 2 m apart at LOD0 and 4 m at LOD1, which
 * on the island's 0.095 m/m beach is 0.19 m and 0.38 m of *height* — so a band
 * thinner than this has no vertex of its own at LOD1 and the wet strip vanishes
 * on exactly the tier the shoreline is usually read at. 0.4 m is 4.2 m of beach
 * there, and one LOD1 vertex above the water carries it.
 */
export const SHORE_DAMP_TOP = 0.4

/**
 * How far the boundary wanders, in metres of height.
 *
 * Without it the beach is a perfect contour line, which is the same tell the
 * dirt blend in `groundColorCore` already carries an `edge` noise term to avoid.
 * 0.16 m on the island's 0.095 m/m beach is **±1.7 m of shoreline**, so the sand
 * meanders by roughly the width of a grass patch — enough to break the circle,
 * small enough that it never reaches the water.
 */
export const SHORE_JITTER = 0.16

/**
 * Feature size of that wander, as a noise frequency.
 *
 * 0.085 is a ~12 m wavelength, deliberately close to the 11 m the dirt boundary
 * uses: two boundaries meeting on the same hillside at different scales read as
 * two systems, and this one is often within a few metres of that one.
 */
export const SHORE_JITTER_FREQUENCY = 0.085

/**
 * Grass is absent at and below this height above the water, and back to full
 * density at `GRASS_SHORE_FULL`.
 *
 * The start is `SHORE_SAND_FULL` **exactly**, and that identity is the point:
 * blades begin where the sand begins to give way, so the meadow's edge and the
 * beach's edge are one boundary rather than two that nearly agree. `grass.md`
 * §7 is emphatic that suitability is a weight and never a test, so this is a
 * ramp — and the ramp's *width* is the thing to check when tuning it, not its
 * position: on the island it spans 6.7 m, which is 1.7 grass patches, and the
 * shared `SHORE_JITTER` noise is what stops that reading as a row of squares.
 */
export const GRASS_SHORE_START = SHORE_SAND_FULL
export const GRASS_SHORE_FULL = SHORE_DRY_TOP - 0.1

/**
 * Height above the nearest water surface, wandered by `SHORE_JITTER`.
 *
 * **One function, called by both the terrain paint and the grass placer**, and
 * that is load-bearing rather than tidy. The two run on different threads from
 * different modules, and if each rolled its own noise the blades would stop
 * exactly where the sand stopped *on average* and cross it everywhere else —
 * grass standing in the beach, which is the defect this whole band exists to
 * remove, reintroduced by a duplicated expression.
 *
 * Returns `+Infinity` on ground with no water under it at all, which every
 * consumer's `clamp01` then resolves to "full meadow, no shore" without a
 * branch. The early return is not only for that: it also skips the noise lookup
 * on the ~99 % of the world that is nowhere near a shore.
 */
export const shoreHeightAbove = (x: number, z: number, height: number, seed: number): number => {
  const above = height - waterLevelAt(x, z)
  if (above >= SHORE_DRY_TOP + SHORE_JITTER) {
    return above
  }
  return (
    above +
    (valueNoise2D(x * SHORE_JITTER_FREQUENCY, z * SHORE_JITTER_FREQUENCY, seed + 617) - 0.5) * 2 * SHORE_JITTER
  )
}
