import { FogExp2, HemisphereLight, type PerspectiveCamera, type Scene, Vector3 } from 'three'
import { C, FOG_DENSITY } from '../art/palette'
import { setActiveShadowCascades, ShadowCascades } from './shadows'

/**
 * ─── Lighting rig ───────────────────────────────────────────────────────────
 *
 * Two lights, and that's the whole world. A toon ramp quantises `dot(N,L)` per
 * light, so every extra directional light adds another set of hard bands
 * crossing the first at a different angle — three lights and a rock looks
 * shattered. Stylised cel shading wants exactly one shaped key and a broad
 * unshaped fill.
 *
 * **Key**: warm directional sun, casts the only shadows.
 * **Fill**: hemisphere, cool sky above / warm bounce below. The warm ground
 * bounce is what stops shadowed undersides from going dead — it's standing in
 * for the light a real ground plane would kick back up.
 *
 * Intensities are tuned so the lit band lands just over 1.0 (the tone mapper
 * rolls it off) and the shadow band lands near 0.55, giving a ~2:1 key-to-fill
 * ratio. That ratio is the number to protect: push it higher and the shadows
 * go inky, lower and the bands stop reading.
 */

export interface LightRig {
  /** Cascaded sun. Replaces the single directional light + its 120 m box. */
  cascades: ShadowCascades
  fill: HemisphereLight
  /** Direction the sun light travels *from*, normalised. */
  sunDirection: Vector3
  /**
   * Re-centres the shadow frustum on a point. Must be called every frame the
   * camera moves — a static shadow camera large enough to cover the whole world
   * would need a 16 k map to hold this shadow resolution.
   */
  follow(focus: Vector3): void
  /** Call after the camera's projection changes (resize / FOV). */
  onProjectionChanged(): void
  dispose(): void
}

export interface LightRigOptions {
  camera: PerspectiveCamera
  shadowMapSize?: number
  cascades?: number
  /** Beyond this nothing casts; fog has erased it. */
  shadowMaxFar?: number
  sunIntensity?: number
  fillIntensity?: number
}

/**
 * Direction the sun light travels *from*. ~38° elevation: high enough that
 * shadows don't smear across the whole valley, low enough that the terrain's
 * ridges actually catch a rim.
 */
const SUN_DIRECTION = new Vector3(-0.52, 0.62, -0.58).normalize()

export const createLightRig = (scene: Scene, options: LightRigOptions): LightRig => {
  // MeshToonMaterial's diffuse is `irradiance × RECIPROCAL_PI × albedo`, so the
  // lit band lands at `(sun + fill) × 0.318 × albedo`. At 2.6 + 1.0 that's
  // 1.15 × albedo — every mid-tone albedo clipped, which is what flattened the
  // first pass into poster paint. 2.15 + 0.85 puts the lit band at 0.95, just
  // under clip, and keeps the ~2:1 key-to-fill ratio the bands need.
  const {
    camera,
    shadowMapSize = 2048,
    // ── Two cascades, not three ───────────────────────────────────────────────
    //
    // The shadow pass is the most expensive thing in a constrained frame: with
    // quality pinned and the camera still, it was **90 of 139 draw calls and
    // 63 % of GPU time** (measured by toggling `shadows` inside one build).
    //
    // Dropping the third cascade removes, deterministically:
    //   • 42 draw calls of 208 while moving (−20 %) — which is what brings the
    //     frame back under the GDD §5 budget of ≤180, from 207–209
    //   • ~25k submitted triangles of 114k (−22 %)
    //
    // Checked by eye at 5 m and 14 m before changing it, since this trades
    // shadow-map texel density for submission cost: cascade 0 now covers a wider
    // range, so any loss shows up near the camera first. Nothing visible at
    // either distance — the shadows here are soft, periwinkle-tinted and
    // dithered (GDD R5), which absorbs the density this gives up.
    //
    // `?cascades=3` restores the old value for comparison. Honest caveat: the
    // *timing* win could not be separated from noise on the development machine
    // (within-config GPU spread was as wide as the difference between configs).
    // The reduction in submitted work is deterministic; the ms are not proven.
    cascades: cascadeCount = 2,
    shadowMaxFar = 260,
    sunIntensity = 2.15,
    fillIntensity = 0.85
  } = options

  // Fog is part of the lighting, not an afterthought: it's the aerial
  // perspective that makes 300 m read as distance rather than as smallness, and
  // its colour is deliberately lighter and bluer than the sky horizon (GDD §3).
  scene.fog = new FogExp2(C.fog.getHex(), FOG_DENSITY)

  // Cascades rather than one map. A single 2048 over a 120 m box meant shadows
  // simply stopped 60 m from the camera — fine for a bounded world, the hard
  // cap on view distance once terrain streams to 190 m and beyond.
  //
  // Registered as the active set *before* any material compiles, because
  // `ToonMaterial.onBeforeCompile` reaches for it to add CSM's uniforms.
  const cascades = new ShadowCascades({
    camera,
    parent: scene,
    direction: SUN_DIRECTION,
    cascades: cascadeCount,
    shadowMapSize,
    maxFar: shadowMaxFar,
    intensity: sunIntensity,
    color: C.sun.getHex()
  })
  setActiveShadowCascades(cascades)

  const fill = new HemisphereLight(C.hemiSky.getHex(), C.hemiGround.getHex(), fillIntensity)
  fill.name = 'fill'
  scene.add(fill)

  return {
    cascades,
    fill,
    sunDirection: SUN_DIRECTION,
    // CSM re-fits itself from the camera every frame, so "following" is just
    // its update — the focus argument is kept for call-site compatibility and
    // deliberately unused.
    follow: () => cascades.update(),
    onProjectionChanged: () => cascades.updateFrustums(),
    dispose: () => {
      setActiveShadowCascades(null)
      cascades.dispose()
      fill.dispose()
      scene.remove(fill)
    }
  }
}
