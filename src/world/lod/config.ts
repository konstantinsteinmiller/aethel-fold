/**
 * ─── LOD distance table + coverage maths ────────────────────────────────────
 *
 * GDD §4.2 / §4.3. Everything that switches detail in this world goes through
 * `coverageAt`, so there is exactly one definition of when a tier is visible
 * and how much of it survives the dither.
 */

/** End distance of each tier, in metres, before scaling. */
export const LOD_DISTANCES = [18, 45, 110, 260] as const

/** Crossfade band width at the *end* of each tier. ~15 % of the switch distance. */
export const LOD_BANDS = [3, 7, 16, 25] as const

/** Past this, exp² fog has erased the object and the draw is pure waste. */
export const MAX_CULL_DISTANCE = 320

/** Below this magnitude a tier contributes nothing and is dropped from the draw. */
export const COVERAGE_EPSILON = 0.002

export const TIER_COUNT = 4

/**
 * Resolution/FOV compensation. A 1.6× taller framebuffer resolves ~1.6× more
 * detail at the same distance, so the whole table stretches — otherwise the
 * world visibly coarsens on a phone at the same spot where it looks fine on a
 * desktop, which players read as "low quality" rather than "smaller screen".
 */
let lodBias = 1

export const setLodBias = (value: number): void => {
  lodBias = Math.max(0.25, Math.min(4, value))
}

export const getLodBias = (): number => lodBias

/**
 * Derives the bias from the current framebuffer and FOV, normalised against a
 * 1080p / 55° reference.
 */
export const updateLodBiasFromView = (drawingBufferHeight: number, fovDegrees: number): void => {
  const referenceHeight = 1080
  const referenceFov = 55
  const heightFactor = drawingBufferHeight / referenceHeight
  const fovFactor = Math.tan((referenceFov * Math.PI) / 360) / Math.tan((fovDegrees * Math.PI) / 360)
  setLodBias(heightFactor * fovFactor)
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Writes **signed** coverage for all four tiers and returns a visibility bitmask.
 *
 * Sign convention (see `FADE_FRAGMENT_GLSL` — it is not cosmetic):
 *   `+c`  the tier is fading *out* at its far boundary → keeps dither `[0, c)`
 *   `−c`  the tier is fading *in* at its near boundary → keeps dither `[c, 1]`
 *   ` 1`  fully visible
 *
 * The two tiers inside a band therefore always sum to exactly 1.0 coverage, so
 * the silhouette never thins and never doubles up.
 *
 * @param out Float32Array(4), written in place — this runs per instance per
 *            frame and must not allocate (GDD §5.2).
 */
export const coverageAt = (distance: number, distanceScale: number, out: Float32Array): number => {
  const scale = distanceScale * lodBias
  let mask = 0

  for (let i = 0; i < TIER_COUNT; i++) {
    const end = LOD_DISTANCES[i]! * scale
    const outBand = LOD_BANDS[i]! * scale

    // Fading in across the previous tier's band. Tier 0 has no near boundary.
    const fadeIn =
      i === 0 ? 1 : clamp01((distance - LOD_DISTANCES[i - 1]! * scale) / (LOD_BANDS[i - 1]! * scale))
    const fadeOut = 1 - clamp01((distance - end) / outBand)

    // Incoming tiers are stored negated. The shader keeps `ign >= 1 + vFade`,
    // whose measure is `-vFade` — so `vFade = -coverage` and the outgoing tier's
    // `+(1 - coverage)` is its exact complement.
    const value = fadeIn < 1 ? -fadeIn : fadeOut

    out[i] = value
    if (Math.abs(value) > COVERAGE_EPSILON) {
      mask |= 1 << i
    }
  }

  return mask
}

/** Distance past which an object of this scale is dropped entirely. */
export const cullDistanceFor = (distanceScale: number): number => {
  const scale = distanceScale * lodBias
  return Math.min(MAX_CULL_DISTANCE, (LOD_DISTANCES[TIER_COUNT - 1]! + LOD_BANDS[TIER_COUNT - 1]!) * scale)
}
