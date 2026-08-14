import { Vector3 } from 'three'
import type { WorldAsset } from './assets/types'
import { makeRng } from './geometry/rng'
import { fbm2D } from './geometry/rng'
import { InstancedLodField } from './lod/InstancedLodField'
import type { Heightfield } from './terrain/heightfield'

/**
 * ─── Scatter placement ──────────────────────────────────────────────────────
 *
 * Jittered-grid sampling with a noise density mask. Not true Poisson-disc: at
 * these densities the visual difference is nil, and a jittered grid gives a
 * guaranteed minimum spacing for free (one sample per cell) while running in
 * O(n) instead of needing a spatial index.
 *
 * The density mask is what turns "scattered props" into "a landscape". A
 * uniform sprinkle of trees reads as procedural immediately; clumping them into
 * groves with genuinely empty clearings between reads as authored, and costs
 * one extra fbm sample per candidate.
 */

export interface ScatterOptions {
  /** Square extent to scatter over, centred on the origin. */
  extent: number
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

const _position = new Vector3()

export const createScatterField = (
  field: Heightfield,
  asset: WorldAsset,
  options: ScatterOptions
): InstancedLodField => {
  const {
    extent,
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

  const rng = makeRng(seed)
  const cells = Math.floor(extent / spacing)
  const half = extent / 2

  // Capacity is the grid size, not the expected yield — the field allocates
  // per-tier matrix buffers up front and cannot grow, so it has to be sized for
  // the worst case rather than the average.
  const capacity = cells * cells
  const scatterField = new InstancedLodField(asset, capacity)

  const inverseCluster = 1 / clusterSize

  for (let gz = 0; gz < cells; gz++) {
    for (let gx = 0; gx < cells; gx++) {
      const x = -half + (gx + 0.5) * spacing + rng.spread(spacing * 0.45)
      const z = -half + (gz + 0.5) * spacing + rng.spread(spacing * 0.45)

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

      _position.set(x, height - sink, z)
      scatterField.add(_position, rng.range(0, Math.PI * 2), rng.range(scaleRange[0], scaleRange[1]))
    }
  }

  // Sorts the instances into spatial cells for hierarchical culling. Cheap
  // here, and it's what stops the per-frame loop being O(instances).
  scatterField.commit()
  return scatterField
}
