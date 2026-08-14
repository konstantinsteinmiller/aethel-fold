import type { BufferGeometry } from 'three'
import type { OutlineMaterial } from '../shading/outlineMaterial'
import type { ToonMaterial } from '../shading/toonMaterial'

/**
 * What every generator in `src/world/assets/` returns, and the only thing the
 * LOD system knows how to consume.
 *
 * Note there is exactly one material per asset, not one per part. A tree's bark
 * and canopy have different ideal ramps, but splitting them costs a second draw
 * call *per instanced tier per LOD* — four extra draws per species before a
 * single tree exists. They share the foliage ramp instead, and the trunk gets
 * its distinction from vertex colour and from `aWind = 0`. In a forest that
 * trade is not close.
 */
export interface WorldAsset {
  name: string
  /** Profiler bucket. Everything drawn must belong to one (GDD §5.3). */
  perfTag: string
  /** Exactly 4, finest first. Non-indexed; carries position, normal, color, aWind. */
  tiers: BufferGeometry[]
  material: ToonMaterial
  /** Shared outline template; null for assets that don't outline (e.g. terrain). */
  outline: OutlineMaterial | null
  /** Tiers `0..outlineMaxTier` draw an outline. GDD R6 says 1 — LOD0 and LOD1. */
  outlineMaxTier: number
  /** Object-space bounding radius, used for instance frustum culling. */
  radius: number
  /**
   * Multiplies the global LOD distance table (GDD §4.2).
   *
   * LOD distance has to scale with object size or it's meaningless: a 5 m tree
   * and a 0.4 m pebble subtend the same angle at wildly different ranges, and a
   * single distance table would either strip the trees bare at 20 m or keep
   * every pebble at full detail out to the horizon.
   */
  distanceScale: number
}

export const LOD_TIER_COUNT = 4
