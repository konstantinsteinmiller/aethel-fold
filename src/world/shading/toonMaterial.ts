import type { DataTexture, IUniform, Side, WebGLProgramParametersWithUniforms } from 'three'
import { Color, FrontSide, MeshToonMaterial } from 'three'
import { C, RIM_POWER, RIM_STRENGTH, SHADOW_TINT_MIX } from '../art/palette'
import { worldUniforms } from './globals'
import {
  FADE_FRAGMENT_GLSL,
  FADE_PARS_FRAGMENT_GLSL,
  FADE_PARS_VERTEX_GLSL,
  FADE_VERTEX_GLSL,
  SURFACE_FRAGMENT_GLSL,
  SURFACE_PARS_FRAGMENT_GLSL,
  WIND_PARS_VERTEX_GLSL,
  WIND_VERTEX_GLSL
} from './glsl'
import { getActiveShadowCascades } from '../core/shadows'
import { getDefaultRamp } from './ramp'

/**
 * ─── The world's one shading family ─────────────────────────────────────────
 *
 * Built by patching `MeshToonMaterial` rather than by writing a `ShaderMaterial`
 * from scratch, and that's a deliberate trade. Inheriting three's material means
 * shadow maps, fog, instancing, skinning, vertex colours, tone mapping and
 * colour-space conversion all keep working for free, forever, across three
 * upgrades. A hand-rolled `ShaderMaterial` would have to re-implement each of
 * those and would silently lose them one at a time.
 *
 * What's added on top (GDD §2):
 *   • the banded gradient ramp                     (R4)
 *   • shadows tinted to periwinkle, never black    (R4)
 *   • a mandatory fresnel rim                      (R5)
 *   • dithered LOD crossfade, per-instance capable (R7 / §4.3)
 *   • two-octave foliage wind                      (Phase B, wired now)
 *
 * Program count stays at the GDD §5.2 limit of one per shading family: the only
 * define that forks the program is `WORLD_WIND`, so the whole world compiles
 * into two programs (plus three's own instancing/shadow permutations).
 */

export interface ToonMaterialOptions {
  color?: Color
  /** Band table. `getDefaultRamp()` unless this is foliage. */
  ramp?: DataTexture
  /** Compiles in the wind path; the geometry then needs an `aWind` attribute. */
  wind?: boolean
  windStrength?: number
  shadowTintMix?: number
  rimStrength?: number
  rimPower?: number
  /** Props carry all their detail in vertex colours, so this defaults to true. */
  vertexColors?: boolean
  side?: Side
  name?: string
}

export class ToonMaterial extends MeshToonMaterial {
  /** Per-material LOD crossfade coverage in [0,1]. 1 = fully opaque. */
  readonly uFade: IUniform<number> = { value: 1 }

  // `protected` so subclasses (TerrainMaterial) can carry the full look through
  // their own clone() instead of silently reverting to defaults.
  protected readonly uShadowTint: IUniform<Color>
  protected readonly uShadowTintMix: IUniform<number>
  protected readonly uRimColor: IUniform<Color>
  protected readonly uRimPower: IUniform<number>
  protected readonly uRimStrength: IUniform<number>
  protected readonly uWindStrength: IUniform<number>
  protected readonly windEnabled: boolean

  constructor(options: ToonMaterialOptions = {}) {
    super({
      color: options.color ?? new Color(0xffffff),
      gradientMap: options.ramp ?? getDefaultRamp(),
      vertexColors: options.vertexColors ?? true,
      side: options.side ?? FrontSide,
      fog: true
    })

    this.name = options.name ?? 'toon'
    this.windEnabled = options.wind ?? false

    this.uShadowTint = { value: C.shadowTint.clone() }
    this.uShadowTintMix = { value: options.shadowTintMix ?? SHADOW_TINT_MIX }
    this.uRimColor = { value: C.rim.clone() }
    this.uRimPower = { value: options.rimPower ?? RIM_POWER }
    this.uRimStrength = { value: options.rimStrength ?? RIM_STRENGTH }
    this.uWindStrength = { value: options.windStrength ?? 0.06 }

    if (this.windEnabled) {
      this.defines = { ...this.defines, WORLD_WIND: '' }
    }

    // Enrol in cascaded shadows. Done here rather than by
    // `CSM.setupMaterial`, which would assign over `onBeforeCompile` and delete
    // every patch this class applies — see `core/shadows.ts`. Null before the
    // lighting rig exists, which is fine: nothing renders before then.
    getActiveShadowCascades()?.register(this)
  }

  /**
   * three hashes `onBeforeCompile.toString()` by default, which would re-hash a
   * multi-kilobyte function for every material every frame it's first seen.
   * A stable short key that covers every define we fork on is both faster and
   * easier to reason about.
   */
  override customProgramCacheKey(): string {
    // The CSM cascade count is a define, so it has to be in the key — two
    // materials with different cascade counts must not share a program.
    return `world-toon|${this.windEnabled ? 'w' : ''}|${this.defines?.CSM_CASCADES ?? 0}`
  }

  override onBeforeCompile(shader: WebGLProgramParametersWithUniforms): void {
    // Shared-by-reference: one write to `worldUniforms.uTime.value` per frame
    // reaches every material in the world.
    shader.uniforms.uTime = worldUniforms.uTime
    shader.uniforms.uWindDir = worldUniforms.uWindDir
    shader.uniforms.uWindSpeed = worldUniforms.uWindSpeed

    // Per-material.
    shader.uniforms.uFade = this.uFade
    shader.uniforms.uWindStrength = this.uWindStrength
    shader.uniforms.uShadowTint = this.uShadowTint
    shader.uniforms.uShadowTintMix = this.uShadowTintMix
    shader.uniforms.uRimColor = this.uRimColor
    shader.uniforms.uRimPower = this.uRimPower
    shader.uniforms.uRimStrength = this.uRimStrength

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <clipping_planes_pars_vertex>',
        `#include <clipping_planes_pars_vertex>\n${FADE_PARS_VERTEX_GLSL}\n${WIND_PARS_VERTEX_GLSL}`
      )
      // Injecting *before* project_vertex means the wind displacement happens
      // after skinning/morphs and before the projection — the only correct slot.
      .replace('#include <project_vertex>', `${FADE_VERTEX_GLSL}\n${WIND_VERTEX_GLSL}\n#include <project_vertex>`)

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <clipping_planes_pars_fragment>',
        `#include <clipping_planes_pars_fragment>\n${FADE_PARS_FRAGMENT_GLSL}\n${SURFACE_PARS_FRAGMENT_GLSL}`
      )
      // The fade discard runs before any lighting work — inside a crossfade
      // band we're shading two objects for one silhouette, so the earlier the
      // half of them dies, the better.
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FADE_FRAGMENT_GLSL}`)
      .replace('#include <opaque_fragment>', `${SURFACE_FRAGMENT_GLSL}\n#include <opaque_fragment>`)

    // Cascaded shadows last, and *chained* rather than assigned. `USE_CSM` is
    // already on this material's defines, so the shader is compiling the cascade
    // branch — which gates `RE_Direct` on `linearDepth` falling inside a cascade
    // range. Without these uniforms that array reads as all-zero, no cascade
    // ever matches, and the direct light silently disappears entirely: the scene
    // renders lit only by the hemisphere fill, with no shadows and no toon
    // bands. (Exactly what happened when this call was missing.)
    getActiveShadowCascades()?.applyToShader(this, shader)
  }

  /** Crossfade coverage. Driven by `DitheredLod`; not for hand-tuning. */
  setFade(value: number): void {
    this.uFade.value = value
  }

  get windStrength(): number {
    return this.uWindStrength.value
  }

  set windStrength(value: number) {
    this.uWindStrength.value = value
  }

  /**
   * Clone that keeps the shared program but gets its *own* `uFade`.
   * `DitheredLod` needs one material per tier for exactly this reason: the
   * tiers must fade independently while still hitting the same compiled shader.
   */
  override clone(): this {
    const copy = new ToonMaterial({
      color: this.color.clone(),
      ramp: (this.gradientMap as DataTexture | null) ?? undefined,
      wind: this.windEnabled,
      windStrength: this.uWindStrength.value,
      shadowTintMix: this.uShadowTintMix.value,
      rimStrength: this.uRimStrength.value,
      rimPower: this.uRimPower.value,
      vertexColors: this.vertexColors,
      side: this.side,
      name: this.name
    })
    copy.uFade.value = this.uFade.value
    return copy as this
  }
}

export const createToonMaterial = (options: ToonMaterialOptions = {}): ToonMaterial => new ToonMaterial(options)
