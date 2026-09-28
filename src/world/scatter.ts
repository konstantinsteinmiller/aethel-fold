import type { WorldAsset } from './assets/types'
import { fbm2D } from './geometry/rng'
import { type InstancedLodField, type InstanceTransform } from './lod/InstancedLodField'
import type { Heightfield } from './terrain/heightfield'
import { SHORE_SAND_TOP } from './terrain/waterLevel'

/**
 * ─── Scatter placement ──────────────────────────────────────────────────────
 *
 * Jittered-grid sampling with a noise density mask, generated **per chunk** so
 * scatter streams with the terrain it stands on.
 *
 * Not true Poisson-disc: at these densities the visual difference is nil, and a
 * jittered grid gives a guaranteed minimum spacing for free (one sample per
 * cell) while running in O(n) with no spatial index.
 *
 * The density mask is what turns "scattered props" into "a landscape". A
 * uniform sprinkle reads as procedural immediately; clumping into groves with
 * genuinely empty clearings reads as authored, for one extra fbm sample.
 *
 * ── Why per-chunk placement is deterministic, not incremental ───────────────
 *
 * A chunk's scatter is a pure function of `(seed, chunk coordinates)`. It has to
 * be: a chunk is generated afresh every time it streams in, and if the result
 * depended on generation *order* — a single walking RNG across the world, say —
 * then walking away and back would silently reshuffle the forest behind you.
 *
 * ── Why the jitter is hashed per cell rather than drawn from a stream ───────
 *
 * It used to be one `makeRng` per chunk per species, walked cell by cell. That
 * is deterministic but it is not *addressable*: getting cell 40's jitter meant
 * drawing cells 0–39 first, so a single cell could never be evaluated on its
 * own. The cross-species rejection pass below needs exactly that — it has to
 * look one cell outside the chunk it is filling — so every random value is now
 * a hash of `(seed, global cell index, salt)`.
 *
 * Two consequences worth naming. The lattice is now **global** rather than
 * per-chunk: cell indices are absolute, so a species' grid is one lattice across
 * the world and the same cell yields the same candidate whichever chunk asks.
 * And the layout changed once, when this landed — an old `scatterOverrides`
 * tombstone (keyed on a position) no longer matches anything, which costs a
 * sandbox user their deletions and costs the shipped world nothing, since
 * `WORLD_PATCH.removedScatter` is empty.
 *
 * ── Cross-species rejection ─────────────────────────────────────────────────
 *
 * Each species used to sample its own grid with no knowledge of the others, so
 * a tree field and a boulder field happily landed on the same square metre —
 * boulders inside canopies, stones half-buried in other stones. `scatterChunkSet`
 * resolves all species together against one shared footprint index. See its
 * header for the rule and why it stays order-free.
 */

/**
 * Metres of dry ground a prop needs above the local water surface.
 *
 * `minHeight` used to carry this job as a single world constant, which cannot
 * work once a chapter has a sea at y = 2 and a river at y = 1.7 falling to
 * y = −1.7 in the same scene: one number is either above the river (a bare
 * valley) or below the sea (a forest growing out of it, out to the horizon,
 * which is what shipped). Rejection is sampled against the **local** water
 * surface instead, and this is the freeboard on top of it.
 *
 * It is `SHORE_SAND_TOP` and not a number of its own, deliberately. That is
 * where `terrain/waterLevel.ts` stops painting the ground as beach, so a prop
 * stands exactly where the sand ends — one boundary for the paint, the grass and
 * the props rather than three that nearly agree. A tree in the sand is the same
 * defect as a tree in the water, one metre up.
 *
 * On the storyteller's island's 0.095 m/m beach that is a treeline at r ≈ 57.6 m
 * against a shoreline at 71 m; the island's procedural wood is thereby all but
 * gone, and the edge of wood it keeps is the one `story/frame.ts` places by hand.
 * On the Arla's 0.7 m/m cut bank the same number is 1.2 m of clear bank, which is
 * a riverbank rather than a clearing.
 */
export const SHORE_BAND = SHORE_SAND_TOP

export interface ScatterOptions {
  /** Average metres between instances. Also the jittered-grid cell size. */
  spacing: number
  seed?: number
  /** Reject slopes steeper than this (0 = flat, 1 = vertical). */
  maxSlope?: number
  /**
   * Absolute floor, in world units. A backstop for sand flats and sink holes;
   * **water is not its job** — see `shoreAbove`.
   */
  minHeight?: number
  /**
   * Height of the ground above the local water surface, or `+Infinity`.
   *
   * `terrain/waterLevel.ts::shoreHeightAbove`, bound to the world's seed. It is
   * **injected rather than imported** for two reasons: this module stays a pure
   * function of its arguments and therefore testable without installing a global
   * water table, and a world with no water pays one `undefined` check per
   * candidate instead of a call.
   *
   * The same function paints the sand and thins the grass, jitter included, so
   * the treeline wanders with the beach instead of cutting a clean contour
   * through it.
   */
  shoreAbove?: (x: number, z: number, height: number) => number
  /** Freeboard above the local water surface. Defaults to `SHORE_BAND`. */
  shoreBand?: number
  scaleRange?: [number, number]
  /** Feature size of the density mask, in metres. Larger = broader groves. */
  clusterSize?: number
  /** Density mask cutoff. Higher = emptier world with tighter clumps. */
  clusterThreshold?: number
  /** Sink props slightly so they never appear to hover on a slope. */
  sink?: number
  /** Keep this radius around the origin clear, so the camera starts in the open. */
  clearRadius?: number
  /**
   * Extra circles kept clear of this species, in world space.
   *
   * `clearRadius` above is measured from the **world origin**, which was fine
   * while there was one settlement and it sat there. It stopped being fine the
   * moment the story put a second one 1.7 km away: the island got the full
   * procedural forest, oaks grew through the storyteller's hut, and the opening
   * shot of the chapter was the inside of a tree trunk.
   *
   * A list rather than a second radius, because there is no reason to think two
   * is the last number of places a chapter will want to keep clear.
   */
  clearZones?: readonly { x: number; z: number; radius: number }[]
}

/**
 * One species, as the cross-species resolver sees it.
 *
 * `field`, `collide` and the rest of what `World` hangs off a species are
 * deliberately not here: this module places points and knows nothing about what
 * gets drawn at them.
 */
export interface ScatterSpeciesPlan {
  options: ScatterOptions
  /**
   * Ground-level solid radius at unit scale, in metres.
   *
   * **Not** the render bounding radius, and not the collider radius either,
   * though it is derived from the second. See `scatterChunkSet`'s header.
   */
  footprint: number
}

/**
 * Scratch for the per-chunk zone filter.
 *
 * Module level and reused, because this runs inside the terrain's chunk-load
 * hook and nothing in `src/world/` may allocate in a loop (GDD §5). It grows to
 * the high-water mark of "zones near one chunk" and stays there — a few dozen
 * references at worst.
 */
const _nearbyZones: { x: number; z: number; radius: number }[] = []

/**
 * Pooled `InstanceTransform` objects, one list per plan slot.
 *
 * The output arrays are truncated with `length = kept` every chunk; the pool is
 * not, so the objects survive and are rewritten in place. Without it a chunk
 * load allocates one object per placed instance — ~300 of them per chunk, on the
 * main thread, in the streamer's hook (GDD §5.2).
 */
const _pool: InstanceTransform[][] = []

// ── The footprint index ─────────────────────────────────────────────────────
//
// A flat open-addressed bucket grid over the chunk plus a `reach` apron, as
// three parallel arrays plus a linked list per bucket. Rebuilt per chunk by
// refilling `_gridHead` with −1, which is the only per-chunk write that is not
// proportional to the number of candidates.
//
// Bucket size is the largest reach any pair of species can have, so a query only
// ever has to look at the 3×3 buckets around a point.

/** Bucket heads, `-1` for empty. Sized to the apron window on first use. */
let _gridHead = new Int32Array(0)
let _gridNext = new Int32Array(0)
let _gridX = new Float64Array(0)
let _gridZ = new Float64Array(0)
let _gridR = new Float64Array(0)
let _gridCount = 0
let _gridColumns = 0
let _gridMinX = 0
let _gridMinZ = 0
let _gridCell = 1

const gridReset = (minX: number, minZ: number, span: number, cell: number): void => {
  _gridCell = cell
  _gridMinX = minX
  _gridMinZ = minZ
  _gridColumns = Math.max(1, Math.ceil(span / cell) + 1)
  const buckets = _gridColumns * _gridColumns
  if (_gridHead.length < buckets) {
    _gridHead = new Int32Array(buckets)
  }
  _gridHead.fill(-1, 0, buckets)
  _gridCount = 0
}

const gridInsert = (x: number, z: number, radius: number): void => {
  if (_gridCount >= _gridNext.length) {
    const size = Math.max(1024, _gridNext.length * 2)
    const next = new Int32Array(size)
    const gx = new Float64Array(size)
    const gz = new Float64Array(size)
    const gr = new Float64Array(size)
    next.set(_gridNext)
    gx.set(_gridX)
    gz.set(_gridZ)
    gr.set(_gridR)
    _gridNext = next
    _gridX = gx
    _gridZ = gz
    _gridR = gr
  }
  const bx = Math.floor((x - _gridMinX) / _gridCell)
  const bz = Math.floor((z - _gridMinZ) / _gridCell)
  if (bx < 0 || bz < 0 || bx >= _gridColumns || bz >= _gridColumns) {
    // Outside the apron: it cannot reach anything inside the chunk, so it is not
    // worth a slot. Callers already reject these; this is the belt.
    return
  }
  const bucket = bz * _gridColumns + bx
  const index = _gridCount++
  _gridX[index] = x
  _gridZ[index] = z
  _gridR[index] = radius
  _gridNext[index] = _gridHead[bucket]!
  _gridHead[bucket] = index
}

/** True when something already indexed overlaps a disc of `radius` at (x, z). */
const gridBlocked = (x: number, z: number, radius: number): boolean => {
  const bx = Math.floor((x - _gridMinX) / _gridCell)
  const bz = Math.floor((z - _gridMinZ) / _gridCell)
  for (let dz = -1; dz <= 1; dz++) {
    const cz = bz + dz
    if (cz < 0 || cz >= _gridColumns) {
      continue
    }
    for (let dx = -1; dx <= 1; dx++) {
      const cx = bx + dx
      if (cx < 0 || cx >= _gridColumns) {
        continue
      }
      let index = _gridHead[cz * _gridColumns + cx]!
      while (index >= 0) {
        const ox = _gridX[index]! - x
        const oz = _gridZ[index]! - z
        const reach = _gridR[index]! + radius
        if (ox * ox + oz * oz < reach * reach) {
          return true
        }
        index = _gridNext[index]!
      }
    }
  }
  return false
}

/**
 * One uniform value in [0, 1) for a lattice cell.
 *
 * `salt` picks which of the cell's several independent values this is. Same
 * mixing as `geometry/rng.ts::hash2` — an integer hash rather than a stream,
 * because the resolver has to be able to evaluate one cell without evaluating
 * its neighbours first.
 */
const cellNoise = (cellX: number, cellZ: number, seed: number, salt: number): number => {
  let h =
    Math.imul(cellX | 0, 0x27d4eb2d) ^
    Math.imul(cellZ | 0, 0x165667b1) ^
    Math.imul(seed | 0, 0x9e3779b9) ^
    Math.imul(salt | 0, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const SALT_JITTER_X = 1
const SALT_JITTER_Z = 2
const SALT_FEATHER = 3
const SALT_ROTATION = 4
const SALT_SCALE = 5

/** A single-species plan, so `scatterChunk` can reuse the resolver. */
const _soloPlan: ScatterSpeciesPlan[] = [{ options: { spacing: 1 }, footprint: 0 }]
const _soloOut: InstanceTransform[][] = [[]]

/**
 * Placements for one chunk, for one species, with no cross-species awareness.
 *
 * Kept because it is the honest unit of "what does this species' grid produce
 * here" and the override tests are written against it. `World` uses
 * `scatterChunkSet` instead — a species resolved on its own can and does land on
 * top of another one.
 *
 * Pure: same inputs always give the same output, so a chunk that streams out and
 * back in is identical.
 *
 * Copies out of the resolver's pool rather than handing the pooled objects on.
 * The pool is rewritten by the next call, and a caller that holds two results at
 * once — every test in `scatterOverrides.test.ts` does — would otherwise be
 * comparing an array against itself.
 */
export const scatterChunk = (
  field: Heightfield,
  options: ScatterOptions,
  originX: number,
  originZ: number,
  chunkSize: number,
  out: InstanceTransform[] = []
): InstanceTransform[] => {
  _soloPlan[0]!.options = options
  _soloPlan[0]!.footprint = 0
  scatterChunkSet(field, _soloPlan, originX, originZ, chunkSize, _soloOut)
  const produced = _soloOut[0]!
  out.length = 0
  for (let i = 0; i < produced.length; i++) {
    const transform = produced[i]!
    out.push({ x: transform.x, y: transform.y, z: transform.z, rotY: transform.rotY, scale: transform.scale })
  }
  return out
}

/**
 * ─── Placing every species against every other ──────────────────────────────
 *
 * Fills `out[i]` with `plan[i]`'s instances for one chunk. `plan` must already
 * be in **resolution order**, biggest and most structural first: a species can
 * only be pushed aside by one that comes before it.
 *
 * ── The rule, stated so it can be checked ───────────────────────────────────
 *
 * A candidate P is placed iff
 *
 *   1. it passes its own species' local tests — density mask, feather, clear
 *      zones, slope, `minHeight`, and the shoreline band above the local water
 *      surface; and
 *   2. no candidate Q that also passes *its* local tests, and that outranks P,
 *      lies within `footprint(P)·scale(P) + footprint(Q)·scale(Q)` of it.
 *
 * Rank is `(plan position, global cell Z, global cell X)` — a total order that
 * has nothing to do with which chunk is being filled or when.
 *
 * ── Why acceptance deliberately does not cascade ────────────────────────────
 *
 * Q vetoes P whether or not Q was itself vetoed. That looks like a bug and is
 * the load-bearing decision in the whole pass: if being vetoed removed a prop
 * from the veto set, then whether P stands would depend on Q, which depends on
 * Q's neighbours, which depends on theirs — a dependency chain of unbounded
 * reach, evaluated inside a 3×3 window. Two adjacent chunks would resolve the
 * same prop differently and the forest would reshuffle as you walked. The cost
 * of the flat rule is the occasional clearing where a vetoing prop was itself
 * removed; the cost of the cascading one is non-determinism.
 *
 * ── Why the window is the chunk plus one cell ───────────────────────────────
 *
 * A prop 30 cm inside the boundary still overlaps one just outside it, so the
 * candidates of the neighbouring cells have to be evaluated too — but only
 * evaluated, not placed. **One** ring is provably enough: a cell's candidate is
 * jittered by at most 0.45 of the cell, so the nearest a candidate two cells out
 * can come is 1.05 cells — 7.2 m at the world's smallest cell (48 / 7 = 6.86 m,
 * the stones and the thicket) against a largest reach of 2.85 m (twice the
 * boulder's 0.95 at its 1.5 scale). Halve the tightest spacing and this needs
 * revisiting.
 *
 * ── The radii, and why they are not the bounding radius ─────────────────────
 *
 * `footprint` is the **solid ground radius**: what the prop actually occupies at
 * the height a player, a boulder or another trunk would meet it.
 *
 *   * It is not the render bounding radius. A tree's bounding radius is its
 *     canopy, and two canopies interpenetrating a little is a grove, not a bug.
 *     A broad oak splits at 1.9 m and the player walks *under* it, so a stone in
 *     its shade is correct and a stone in its bole is not.
 *   * It is not quite the collider radius either. `scatterColliders.ts` sizes a
 *     trunk for *blocking*, which is the narrow thing the player walks around;
 *     the spruce and the thicket carry foliage down to the ground, and a boulder
 *     inside one of those is invisible however walkable the trunk is. Those two
 *     get their skirt instead of their stem.
 *
 * Sum of radii, not a fixed clearance: two props may touch, they may not
 * interpenetrate. Containment — the "completely hidden" half of the brief — is
 * the same test, since a prop entirely inside another is at `d ≤ rBig − rSmall`,
 * which is inside `d < rBig + rSmall` for any positive `rSmall`.
 */
export const scatterChunkSet = (
  field: Heightfield,
  plan: readonly ScatterSpeciesPlan[],
  originX: number,
  originZ: number,
  chunkSize: number,
  out: InstanceTransform[][]
): void => {
  // Widest pair of footprints in play, which is both the apron and the bucket
  // size. Computed per call: it is a handful of multiplies against a plan of a
  // dozen entries, and caching it would be one more thing to invalidate when a
  // species' scale range is tuned.
  let widest = 0
  for (let i = 0; i < plan.length; i++) {
    const entry = plan[i]!
    const reach = entry.footprint * (entry.options.scaleRange?.[1] ?? 1.25)
    if (reach > widest) {
      widest = reach
    }
  }
  // Twice the widest, because a species also excludes *itself*: a jittered grid
  // only guarantees a tenth of a cell between two adjacent cells' candidates,
  // which at the 7 m spacing of the stones is 70 cm — half a stone.
  const maxReach = widest * 2
  const resolving = maxReach > 0
  // The bucket may be larger than the reach (a bigger bucket only means more
  // candidates per 3×3 query) but never smaller, or the query would miss. The
  // floor keeps a plan of small props from asking for a quarter of a million
  // buckets and a `fill` per chunk.
  const bucket = maxReach > 2 ? maxReach : 2

  if (resolving) {
    gridReset(originX - maxReach, originZ - maxReach, chunkSize + maxReach * 2, bucket)
  }

  const limitX = originX + chunkSize
  const limitZ = originZ + chunkSize

  for (let s = 0; s < plan.length; s++) {
    const entry = plan[s]!
    const {
      spacing,
      seed = 7,
      maxSlope = 0.32,
      minHeight = -2.5,
      shoreAbove,
      shoreBand = SHORE_BAND,
      scaleRange = [0.8, 1.25],
      clusterSize = 90,
      clusterThreshold = 0.46,
      sink = 0.12,
      clearRadius = 0,
      clearZones
    } = entry.options

    const pool = _pool[s] ?? (_pool[s] = [])
    const list = out[s] ?? (out[s] = [])
    let kept = 0

    // ── Zones are pre-filtered to this chunk, once ───────────────────────────
    //
    // A settlement is ~200 buildings and a chunk offers up to a few hundred
    // candidate positions per species, so testing every candidate against every
    // zone is tens of thousands of distance tests per chunk per species — on the
    // main thread, inside the terrain's load hook, where a stall is a visible
    // hitch as you walk.
    //
    // Almost none of those tests can succeed: a 48 m chunk can only overlap the
    // handful of zones within a chunk-diagonal of it. Filtering once per chunk
    // turns the inner loop from ~200 tests into ~0 everywhere except inside a
    // village, where it is ~6.
    let nearbyCount = 0
    if (clearZones !== undefined && clearZones.length > 0) {
      const centreX = originX + chunkSize * 0.5
      const centreZ = originZ + chunkSize * 0.5
      const reach = chunkSize * 0.708 + maxReach
      for (let i = 0; i < clearZones.length; i++) {
        const zone = clearZones[i]!
        const dx = zone.x - centreX
        const dz = zone.z - centreZ
        const limit = reach + zone.radius
        if (dx * dx + dz * dz > limit * limit) {
          continue
        }
        if (nearbyCount < _nearbyZones.length) {
          _nearbyZones[nearbyCount] = zone
        } else {
          _nearbyZones.push(zone)
        }
        nearbyCount++
      }
    }

    const cells = Math.max(1, Math.round(chunkSize / spacing))
    const step = chunkSize / cells
    // Absolute lattice indices. Chunk origins are multiples of `chunkSize` and
    // `step` divides it exactly, so a species' grid is one lattice across the
    // world and a cell yields the same candidate whichever chunk asks for it.
    const baseCellX = Math.round(originX / step)
    const baseCellZ = Math.round(originZ / step)
    const inverseCluster = 1 / clusterSize
    const jitter = step * 0.45
    // One ring outside the chunk when the pass is resolving overlaps, none when
    // it is not — `scatterChunk` asks for a single species and wants exactly the
    // chunk's own cells.
    const ring = resolving ? 1 : 0

    for (let gz = -ring; gz < cells + ring; gz++) {
      const cellZ = baseCellZ + gz
      for (let gx = -ring; gx < cells + ring; gx++) {
        const cellX = baseCellX + gx

        const x = (cellX + 0.5) * step + (cellNoise(cellX, cellZ, seed, SALT_JITTER_X) * 2 - 1) * jitter
        const z = (cellZ + 0.5) * step + (cellNoise(cellX, cellZ, seed, SALT_JITTER_Z) * 2 - 1) * jitter

        const inside = x >= originX && x < limitX && z >= originZ && z < limitZ
        if (!inside) {
          // A candidate outside the chunk is only here to veto, so one that
          // cannot reach the chunk is not worth a noise sample.
          if (
            !resolving ||
            x < originX - maxReach ||
            x >= limitX + maxReach ||
            z < originZ - maxReach ||
            z >= limitZ + maxReach
          ) {
            continue
          }
        }

        if (clearRadius > 0 && x * x + z * z < clearRadius * clearRadius) {
          continue
        }
        if (nearbyCount > 0) {
          let cleared = false
          for (let i = 0; i < nearbyCount; i++) {
            const zone = _nearbyZones[i]!
            const dx = x - zone.x
            const dz = z - zone.z
            if (dx * dx + dz * dz < zone.radius * zone.radius) {
              cleared = true
              break
            }
          }
          if (cleared) {
            continue
          }
        }

        const density = fbm2D(x * inverseCluster, z * inverseCluster, 3, 2.07, 0.55, seed + 4001)
        if (density < clusterThreshold) {
          continue
        }
        // Feather the grove edge: near the threshold, thin out probabilistically
        // rather than cutting a hard boundary through the middle of a forest.
        if (cellNoise(cellX, cellZ, seed, SALT_FEATHER) > Math.min(1, (density - clusterThreshold) * 6)) {
          continue
        }

        const height = field.heightAt(x, z)
        if (height < minHeight) {
          continue
        }
        // ── Nothing stands in the water, or on the beach ────────────────────
        //
        // Local, because two bodies of water can be kilometres apart and metres
        // different in height, and a single `minHeight` cannot be right for both. `+Infinity` away
        // from water, so this is one compare on the dry 99 % of the world.
        if (shoreAbove !== undefined && shoreAbove(x, z, height) < shoreBand) {
          continue
        }
        if (field.slopeAt(x, z) > maxSlope) {
          continue
        }

        const scale = scaleRange[0] + cellNoise(cellX, cellZ, seed, SALT_SCALE) * (scaleRange[1] - scaleRange[0])

        if (resolving) {
          const radius = entry.footprint * scale
          const blocked = inside && gridBlocked(x, z, radius)
          // Indexed whether or not it was blocked — see the header on why the
          // veto set is "everything that passed its own tests" rather than
          // "everything that was placed".
          gridInsert(x, z, radius)
          if (blocked) {
            continue
          }
        }

        if (!inside) {
          continue
        }

        let transform = pool[kept]
        if (transform === undefined) {
          transform = { x: 0, y: 0, z: 0, rotY: 0, scale: 1 }
          pool[kept] = transform
        }
        transform.x = x
        transform.y = height - sink
        transform.z = z
        transform.rotY = cellNoise(cellX, cellZ, seed, SALT_ROTATION) * Math.PI * 2
        transform.scale = scale
        list[kept] = transform
        kept++
      }
    }

    list.length = kept
  }
}

/**
 * Drops instances the editor has deleted, in place.
 *
 * Applied between generation and the field, so a tombstoned prop never reaches
 * the renderer, the collider index or the save file — one filter instead of
 * three places that have to agree. In place, because the chunk-load path is
 * allocation-free (GDD §5.2).
 */
export const filterScatter = (
  transforms: InstanceTransform[],
  reject: (transform: InstanceTransform) => boolean
): void => {
  let kept = 0
  for (let i = 0; i < transforms.length; i++) {
    const transform = transforms[i]!
    if (reject(transform)) {
      continue
    }
    transforms[kept++] = transform
  }
  transforms.length = kept
}

/**
 * Worst-case instances a chunk can yield, used to size a field's slot pool.
 *
 * The bound is the full grid — every candidate surviving every rejection test.
 * Deliberately pessimistic: a field that runs out of slots mid-traversal drops
 * scatter silently, and the cost of over-reserving is a few hundred KB.
 */
export const maxInstancesPerChunk = (spacing: number, chunkSize: number): number => {
  const cells = Math.max(1, Math.round(chunkSize / spacing))
  return cells * cells
}

/** Adds a chunk's scatter to a field. Returns how many were placed. */
export const addChunkScatter = (
  fieldInstance: InstancedLodField,
  heightfield: Heightfield,
  options: ScatterOptions,
  key: string,
  originX: number,
  originZ: number,
  chunkSize: number,
  scratch: InstanceTransform[],
  reject?: (transform: InstanceTransform) => boolean
): number => {
  scatterChunk(heightfield, options, originX, originZ, chunkSize, scratch)
  if (reject && scratch.length > 0) {
    filterScatter(scratch, reject)
  }
  if (scratch.length === 0) {
    return 0
  }
  return fieldInstance.addCell(key, scratch) ? scratch.length : 0
}

export type { WorldAsset }
