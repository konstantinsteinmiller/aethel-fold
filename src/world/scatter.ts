import type { WorldAsset } from './assets/types'
import { fbm2D, makeRng } from './geometry/rng'
import { type InstancedLodField, type InstanceTransform } from './lod/InstancedLodField'
import type { Heightfield } from './terrain/heightfield'

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
 * Seeding a fresh RNG per chunk costs nothing and makes the world stable.
 */

export interface ScatterOptions {
  /** Average metres between instances. Also the jittered-grid cell size. */
  spacing: number
  seed?: number
  /** Reject slopes steeper than this (0 = flat, 1 = vertical). */
  maxSlope?: number
  /** Reject below this height — keeps props out of water and sand flats. */
  minHeight?: number
  scaleRange?: [number, number]
  /** Feature size of the density mask, in metres. Larger = broader groves. */
  clusterSize?: number
  /** Density mask cutoff. Higher = emptier world with tighter clumps. */
  clusterThreshold?: number
  /** Sink props slightly so they never appear to hover on a slope. */
  sink?: number
  /** Keep this radius around the origin clear, so the camera starts in the open. */
  clearRadius?: number
}

/**
 * Placements for one chunk. Pure: same inputs always give the same output, so a
 * chunk that streams out and back in is identical.
 */
export const scatterChunk = (
  field: Heightfield,
  options: ScatterOptions,
  originX: number,
  originZ: number,
  chunkSize: number,
  out: InstanceTransform[] = []
): InstanceTransform[] => {
  const {
    spacing,
    seed = 7,
    maxSlope = 0.32,
    minHeight = -2.5,
    scaleRange = [0.8, 1.25],
    clusterSize = 90,
    clusterThreshold = 0.46,
    sink = 0.12,
    clearRadius = 0
  } = options

  out.length = 0
  const cells = Math.max(1, Math.round(chunkSize / spacing))
  const step = chunkSize / cells
  // Chunk coordinates fold into the seed, so placement depends on *where* the
  // chunk is, never on when it was generated.
  const cx = Math.round(originX / chunkSize)
  const cz = Math.round(originZ / chunkSize)
  const rng = makeRng((seed * 73856093) ^ (cx * 19349663) ^ (cz * 83492791))
  const inverseCluster = 1 / clusterSize

  for (let gz = 0; gz < cells; gz++) {
    for (let gx = 0; gx < cells; gx++) {
      const x = originX + (gx + 0.5) * step + rng.spread(step * 0.45)
      const z = originZ + (gz + 0.5) * step + rng.spread(step * 0.45)

      if (clearRadius > 0 && x * x + z * z < clearRadius * clearRadius) {
        continue
      }

      const density = fbm2D(x * inverseCluster, z * inverseCluster, 3, 2.07, 0.55, seed + 4001)
      if (density < clusterThreshold) {
        continue
      }
      // Feather the grove edge: near the threshold, thin out probabilistically
      // rather than cutting a hard boundary through the middle of a forest.
      if (rng() > Math.min(1, (density - clusterThreshold) * 6)) {
        continue
      }

      const height = field.heightAt(x, z)
      if (height < minHeight) {
        continue
      }
      if (field.slopeAt(x, z) > maxSlope) {
        continue
      }

      out.push({
        x,
        y: height - sink,
        z,
        rotY: rng.range(0, Math.PI * 2),
        scale: rng.range(scaleRange[0], scaleRange[1])
      })
    }
  }

  return out
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
  scratch: InstanceTransform[]
): number => {
  scatterChunk(heightfield, options, originX, originZ, chunkSize, scratch)
  if (scratch.length === 0) {
    return 0
  }
  return fieldInstance.addCell(key, scratch) ? scratch.length : 0
}

export type { WorldAsset }
