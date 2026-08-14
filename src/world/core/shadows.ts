import type { Material, Object3D, PerspectiveCamera, WebGLProgramParametersWithUniforms } from 'three'
import { ShaderChunk, Vector3 } from 'three'
import { CSM } from 'three/examples/jsm/csm/CSM.js'
import type { CSMShader as CsmShaderChunks } from 'three/examples/jsm/csm/CSMShader.js'
import * as csmShaderModule from 'three/examples/jsm/csm/CSMShader.js'

/**
 * `@types/three` declares `CSMShader` as an *interface* only, but the runtime
 * module exports a const object of that name — so a plain named import
 * type-errors ("only refers to a type"). The namespace import plus a cast is
 * the narrowest correct workaround; nothing about the runtime shape is being
 * assumed beyond what the interface already states.
 */
const CSM_CHUNKS = (csmShaderModule as unknown as { CSMShader: CsmShaderChunks }).CSMShader

/**
 * ─── Cascaded shadow maps ───────────────────────────────────────────────────
 *
 * A single shadow map has to trade resolution against range: at 2048 texels
 * over the 120 m box this world used, shadows simply stopped 60 m from the
 * camera focus — which was the hard cap on view distance once terrain started
 * streaming out to 190 m. Cascades split the view depth so the near slice keeps
 * centimetre texels while the far slice still gets *something*.
 *
 * ── Why this wrapper exists instead of `csm.setupMaterial(material)` ────────
 *
 * three's `CSM.setupMaterial` does:
 *
 *     material.onBeforeCompile = function (shader) { … }
 *
 * — a plain **assignment**. Every material in this world is a `ToonMaterial`
 * whose `onBeforeCompile` is a class method carrying the dithered LOD
 * crossfade, the fresnel rim, the periwinkle shadow tint and the foliage wind.
 * Calling `setupMaterial` would silently overwrite all of it: the scene would
 * still render, just without any of the art direction, and nothing would error.
 *
 * So the pieces are applied by hand instead. `setupMaterial`'s entire job is to
 * set two defines and add three uniforms, and `_updateUniforms` refreshes them
 * from a `shaders` map — all reproducible from outside, and all far cheaper
 * than forking the class.
 *
 * The global `ShaderChunk` patch is three's own design, not ours; it's done
 * once here rather than on every material.
 */

/** Registered by `CSM` on the shader it hands back. Mirrored here. */
interface CsmShaderRecord {
  uniforms: Record<string, { value: unknown }>
}

let chunksPatched = false

const patchChunksOnce = (): void => {
  if (chunksPatched) {
    return
  }
  // Process-global, exactly as `CSM.setupMaterial` would do it. Safe here
  // because every lit material in this app is ours.
  ShaderChunk.lights_fragment_begin = CSM_CHUNKS.lights_fragment_begin
  ShaderChunk.lights_pars_begin = CSM_CHUNKS.lights_pars_begin
  chunksPatched = true
}

export interface ShadowCascadesOptions {
  camera: PerspectiveCamera
  parent: Object3D
  /** Direction the light travels. */
  direction: Vector3
  cascades?: number
  shadowMapSize?: number
  /** Beyond this, nothing casts. Fog has erased it anyway. */
  maxFar?: number
  intensity?: number
  color?: number
}

export class ShadowCascades {
  readonly csm: CSM
  private readonly registered = new Set<Material>()

  constructor(options: ShadowCascadesOptions) {
    const {
      camera,
      parent,
      direction,
      cascades = 3,
      shadowMapSize = 2048,
      // 260 m: past the LOD cull distance, and exp² fog at 0.0085 has removed
      // ~90 % of contrast by then. Cascades beyond it are texels spent on haze.
      maxFar = 260,
      intensity = 2.15,
      color = 0xfff3d6
    } = options

    patchChunksOnce()

    this.csm = new CSM({
      camera,
      parent,
      cascades,
      maxFar,
      // 'practical' is the standard log/uniform blend — pure logarithmic wastes
      // the far cascade on sky, pure uniform starves the near one.
      mode: 'practical',
      shadowMapSize,
      lightDirection: direction.clone().negate().normalize(),
      lightIntensity: intensity,
      lightNear: 1,
      lightFar: 1200
    })

    for (const light of this.csm.lights) {
      light.color.setHex(color)
      // Normal bias offsets along the surface normal, so it fixes acne on the
      // terrain's shallow slopes without detaching the contact shadow under a
      // boulder the way a large constant bias does.
      light.shadow.normalBias = 0.06
    }
  }

  /**
   * Applies what `setupMaterial` would have, without touching
   * `onBeforeCompile`. Call once per material, before it first renders.
   */
  register(material: Material): void {
    if (this.registered.has(material)) {
      return
    }
    this.registered.add(material)
    material.defines = { ...material.defines, USE_CSM: 1, CSM_CASCADES: this.csm.cascades }
    if (this.csm.fade) {
      material.defines.CSM_FADE = ''
    }
    material.needsUpdate = true
  }

  /**
   * Adds CSM's uniforms to a shader and enrols it for per-frame updates. Called
   * from `ToonMaterial.onBeforeCompile` *after* its own patches, which is the
   * whole point of this class.
   */
  applyToShader(material: Material, shader: WebGLProgramParametersWithUniforms): void {
    if (!this.registered.has(material)) {
      return
    }
    const scope = this.csm as unknown as {
      _getExtendedBreaks: (target: unknown[]) => void
      shaders: Map<Material, unknown>
      camera: PerspectiveCamera
      maxFar: number
    }
    const breaks: unknown[] = []
    scope._getExtendedBreaks(breaks)
    const far = Math.min(scope.camera.far, scope.maxFar)

    shader.uniforms.CSM_cascades = { value: breaks }
    shader.uniforms.cameraNear = { value: scope.camera.near }
    shader.uniforms.shadowFar = { value: far }

    // Enrol in CSM's own uniform refresh, so cascade splits stay live as the
    // camera's near/far change.
    scope.shaders.set(material, shader as unknown as CsmShaderRecord)
  }

  /** Re-fits the cascades to the current camera. Once per frame, before render. */
  update(): void {
    this.csm.update()
  }

  /**
   * Recomputes the cascade splits and pushes them into every enrolled shader.
   *
   * Needed after the projection changes, because CSM only refreshes its
   * uniforms from `updateFrustums` — `update()` re-fits the *lights* but leaves
   * the split uniforms alone.
   */
  updateFrustums(): void {
    this.csm.updateFrustums()
  }

  setDirection(direction: Vector3): void {
    this.csm.lightDirection.copy(direction).negate().normalize()
  }

  dispose(): void {
    this.csm.dispose()
    this.registered.clear()
  }
}

/**
 * Module-level handle so `ToonMaterial` can reach the active cascade set from
 * inside `onBeforeCompile` without every material taking a constructor
 * dependency on the lighting rig.
 */
let active: ShadowCascades | null = null

export const setActiveShadowCascades = (cascades: ShadowCascades | null): void => {
  active = cascades
}

export const getActiveShadowCascades = (): ShadowCascades | null => active
