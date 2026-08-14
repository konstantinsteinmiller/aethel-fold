import { Vector2 } from 'three'

/**
 * Uniform objects shared *by reference* across every world material.
 *
 * three copies `shader.uniforms` per program, but the uniform *objects*
 * themselves are held by reference — so assigning these into each material's
 * uniform bag inside `onBeforeCompile` means one write to `.value` updates all
 * of them. The alternative (walking a material registry every frame writing
 * `uTime`) is a per-frame loop over hundreds of materials for a single float.
 */
export const worldUniforms = {
  /** Seconds since world start. Drives wind, water, anything periodic. */
  uTime: { value: 0 },
  /** Horizontal wind direction, normalised. */
  uWindDir: { value: new Vector2(0.82, 0.57).normalize() },
  uWindSpeed: { value: 1.15 },
  /**
   * World units per screen pixel at 1 m depth — `2·tan(fov/2) / drawingBufferHeight`.
   * Lets the outline shader hold a constant *pixel* width at any distance,
   * resolution or FOV (GDD R6). Refreshed by the renderer on resize.
   */
  uUnitsPerPixel: { value: 0.002 }
}

export const updateUnitsPerPixel = (fovDegrees: number, drawingBufferHeight: number): void => {
  const fovRadians = (fovDegrees * Math.PI) / 180
  worldUniforms.uUnitsPerPixel.value = (2 * Math.tan(fovRadians / 2)) / Math.max(1, drawingBufferHeight)
}
