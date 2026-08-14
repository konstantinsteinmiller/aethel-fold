import { DirectionalLight, FogExp2, HemisphereLight, type Scene, Vector3 } from 'three'
import { C, FOG_DENSITY } from '../art/palette'

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
  sun: DirectionalLight
  fill: HemisphereLight
  /** Direction the sun light travels *from*, normalised. */
  sunDirection: Vector3
  /**
   * Re-centres the shadow frustum on a point. Must be called every frame the
   * camera moves — a static shadow camera large enough to cover the whole world
   * would need a 16 k map to hold this shadow resolution.
   */
  follow(focus: Vector3): void
  dispose(): void
}

export interface LightRigOptions {
  /** Half-extent of the orthographic shadow frustum, in metres. */
  shadowRadius?: number
  shadowMapSize?: number
  sunIntensity?: number
  fillIntensity?: number
}

const _target = new Vector3()

export const createLightRig = (scene: Scene, options: LightRigOptions = {}): LightRig => {
  // MeshToonMaterial's diffuse is `irradiance × RECIPROCAL_PI × albedo`, so the
  // lit band lands at `(sun + fill) × 0.318 × albedo`. At 2.6 + 1.0 that's
  // 1.15 × albedo — every mid-tone albedo clipped, which is what flattened the
  // first pass into poster paint. 2.15 + 0.85 puts the lit band at 0.95, just
  // under clip, and keeps the ~2:1 key-to-fill ratio the bands need.
  const { shadowRadius = 60, shadowMapSize = 2048, sunIntensity = 2.15, fillIntensity = 0.85 } = options

  // Fog is part of the lighting, not an afterthought: it's the aerial
  // perspective that makes 300 m read as distance rather than as smallness, and
  // its colour is deliberately lighter and bluer than the sky horizon (GDD §3).
  scene.fog = new FogExp2(C.fog.getHex(), FOG_DENSITY)

  const sun = new DirectionalLight(C.sun.getHex(), sunIntensity)
  sun.name = 'sun'
  // ~38° elevation: high enough that shadows don't smear across the whole
  // valley, low enough that the terrain's ridges actually catch a rim.
  const sunDirection = new Vector3(-0.52, 0.62, -0.58).normalize()
  sun.castShadow = true
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize)
  sun.shadow.camera.left = -shadowRadius
  sun.shadow.camera.right = shadowRadius
  sun.shadow.camera.top = shadowRadius
  sun.shadow.camera.bottom = -shadowRadius
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = shadowRadius * 4
  // Normal bias rather than constant bias: it offsets along the surface normal,
  // so it fixes shadow acne on the terrain's shallow slopes without detaching
  // the contact shadow under a boulder the way a large constant bias does.
  sun.shadow.normalBias = 0.06
  sun.shadow.bias = -0.0004
  scene.add(sun)
  scene.add(sun.target)

  const fill = new HemisphereLight(C.hemiSky.getHex(), C.hemiGround.getHex(), fillIntensity)
  fill.name = 'fill'
  scene.add(fill)

  const distance = shadowRadius * 2.2

  const follow = (focus: Vector3): void => {
    // Snap the shadow frustum to a texel grid. Without this, sub-texel drift as
    // the camera moves makes shadow edges crawl and shimmer — the single most
    // visible shadow artefact in a game with a moving camera, and free to fix.
    const texelSize = (shadowRadius * 2) / shadowMapSize
    _target.set(
      Math.round(focus.x / texelSize) * texelSize,
      Math.round(focus.y / texelSize) * texelSize,
      Math.round(focus.z / texelSize) * texelSize
    )
    sun.target.position.copy(_target)
    sun.position.copy(_target).addScaledVector(sunDirection, distance)
    sun.target.updateMatrixWorld()
    sun.updateMatrixWorld()
  }

  follow(new Vector3())

  return {
    sun,
    fill,
    sunDirection,
    follow,
    dispose: () => {
      sun.dispose()
      fill.dispose()
      scene.remove(sun, sun.target, fill)
    }
  }
}
