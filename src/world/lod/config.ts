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
 * ─── Quality bias: degrade the horizon, not what's underfoot ────────────────
 *
 * `quality` runs 1 (full) down to ~0.4. It is applied to each tier boundary
 * raised to a **different exponent**, so lowering it pulls the far boundaries in
 * hard while barely moving the near one.
 *
 * A single uniform multiplier would be the obvious implementation and the wrong
 * one: at quality 0.5 it would move LOD0's boundary from 18 m to 9 m, so the
 * first thing a struggling machine loses is the detail on the object the player
 * is standing next to — the one thing that is *never* worth trading. With these
 * exponents the same 0.5 leaves LOD0 at ~15 m and cuts LOD3 nearly in half.
 *
 * | quality | LOD0 | LOD1 | LOD2 | LOD3 |
 * |---|---|---|---|---|
 * | 1.00 | ×1.00 | ×1.00 | ×1.00 | ×1.00 |
 * | 0.70 | ×0.91 | ×0.81 | ×0.70 | ×0.65 |
 * | 0.50 | ×0.84 | ×0.66 | ×0.50 | ×0.44 |
 */
const TIER_QUALITY_EXPONENT = [0.25, 0.6, 1.0, 1.2] as const

let quality = 1

export const setLodQuality = (value: number): void => {
  quality = Math.max(0.35, Math.min(1, value))
}

export const getLodQuality = (): number => quality

/**
 * Crossfade band width multiplier.
 *
 * Instances inside a band are drawn by two tiers, measured at 21–29 % of the
 * field. Narrowing the bands is therefore a direct, near-field-safe saving under
 * load — the transition gets more abrupt, which is a far better trade than
 * coarsening what the player is looking at.
 */
let bandScale = 1

export const setLodBandScale = (value: number): void => {
  bandScale = Math.max(0.25, Math.min(1, value))
}

export const getLodBandScale = (): number => bandScale

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
    const tierScale = scale * quality ** TIER_QUALITY_EXPONENT[i]!
    const end = LOD_DISTANCES[i]! * tierScale
    const outBand = LOD_BANDS[i]! * tierScale * bandScale

    // Fading in across the previous tier's band. Tier 0 has no near boundary.
    const previousScale = i === 0 ? scale : scale * quality ** TIER_QUALITY_EXPONENT[i - 1]!
    const fadeIn =
      i === 0
        ? 1
        : clamp01(
            (distance - LOD_DISTANCES[i - 1]! * previousScale) / (LOD_BANDS[i - 1]! * previousScale * bandScale)
          )
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
  const scale = distanceScale * lodBias * quality ** TIER_QUALITY_EXPONENT[TIER_COUNT - 1]!
  return Math.min(MAX_CULL_DISTANCE, (LOD_DISTANCES[TIER_COUNT - 1]! + LOD_BANDS[TIER_COUNT - 1]!) * scale)
}
