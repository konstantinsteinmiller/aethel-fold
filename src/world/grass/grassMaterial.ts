import type { IUniform, WebGLProgramParametersWithUniforms } from 'three'
import { Color, DoubleSide, Vector2, Vector4 } from 'three'
import { C } from '../art/palette'
import { worldUniforms } from '../shading/globals'
import { getFoliageRamp } from '../shading/ramp'
import { ToonMaterial } from '../shading/toonMaterial'
import { FADE_FRACTION, PATCH_SIZE } from './config'
import {
  GRASS_COLOR_FRAGMENT_GLSL,
  GRASS_COMPUTE_GLSL,
  GRASS_PARS_FRAGMENT_GLSL,
  GRASS_PARS_VERTEX_GLSL,
  GRASS_POSITION_GLSL
} from './grassGlsl'

/**
 * ─── The grass shading family ───────────────────────────────────────────────
 *
 * Extends `ToonMaterial` and **chains** into its `onBeforeCompile`, never
 * assigns over it. That is the rule this project has already been bitten by
 * twice (AAA-graphics §4): an assignment silently deletes the banded ramp, the
 * periwinkle shadow tint, the fresnel rim, the dithered crossfade *and* the
 * cascade uniforms — and the scene still renders, just unlit and undirected,
 * with no error anywhere.
 *
 * ── The cost of being a second family ───────────────────────────────────────
 *
 * This is a second toon program, so it is a real charge against the ≤13 program
 * ceiling in GDD §5.2. It is spent knowingly: the alternative is a `WORLD_GRASS`
 * define on `ToonMaterial`, which forks the same program anyway *and* pays the
 * fork on every prop's cache key. Six tiers share this one program — the tiers
 * differ only by uniform.
 *
 * ── Grass never casts a shadow ──────────────────────────────────────────────
 *
 * The shadow pass renders through three's own depth material, which knows
 * nothing about the blade construction above — a caster would be the *undrawn*
 * patch geometry, a flat cluster of untransformed blades sitting at the world
 * origin. This is the identical argument water makes in `assets/types.ts`, and
 * it is not a loss worth mourning: the shadow pass is already 63 % of GPU time
 * in a constrained frame (AAA-graphics §12.3), and self-shadowing grass at this
 * blade size resolves to noise at any cascade this world can afford.
 *
 * ── And it draws no outline ─────────────────────────────────────────────────
 *
 * `outlineMaterial.ts` already names this exact failure when it explains why the
 * outline is an inverted hull rather than a screen-space edge pass: a sobel
 * "would put an outline around every blade of grass". An inverted hull does the
 * same thing from the other direction — it would double the grass draw count and
 * the triangle count for a 1.6 px line around a 3 cm blade.
 */

/**
 * Uniforms shared by reference across all six tiers, exactly as `worldUniforms`
 * is shared across the world. One write reaches every tier — which matters here
 * because `uCullNear`/`uCullFar` move whenever the detail level changes, and
 * walking six materials to write two floats is six chances to forget one.
 */
/**
 * Module-level, and therefore shared by *every* `GrassField` in the process.
 *
 * That is the same contract `shading/globals.ts` sets for `worldUniforms`, and it
 * holds for the same reason: exactly one `World` is mounted at a time (the router
 * guarantees it, and `WorldScene` disposes on unmount). Two live fields would
 * fight over `uCullFar` and `uWidthScale`. If a second world ever needs to exist
 * beside the first, these move onto the field.
 */
export const grassUniforms = {
  uPatchSize: { value: PATCH_SIZE } as IUniform<number>,
  /**
   * Screen-pixel floor on blade width.
   *
   * Above 1.0 for two separate reasons. The first is anti-flicker: at exactly one
   * pixel a blade still lands between two samples about half the time, which is
   * the artefact this started as.
   *
   * The second turned out to matter more, and it is why this sits at 1.9. Grass
   * density falls with distance by design, so ground *coverage* falls with it —
   * and a meadow that shows soil between its blades at 30 m reads as patchy
   * rather than as distant. Widening the survivors restores the coverage the
   * thinning gave up, at zero triangles, and it does it against the real
   * framebuffer rather than against a baked guess. This is the mechanism that
   * replaced the per-tier width multipliers the first pass used.
   */
  uMinPixels: { value: 1.9 } as IUniform<number>,
  /**
   * Where the wind fades out, in metres. Shared — it is a property of the world,
   * not of a tier. Whether a tier evaluates the wind block at all is per-tier
   * (`uBladeWind`); see `config.ts`'s `tierHasWind`.
   */
  uWindNear: { value: 26 } as IUniform<number>,
  uWindFar: { value: 48 } as IUniform<number>,
  /** See `FADE_FRACTION` — the width of the per-blade fade, as a share of `live`. */
  uFadeFraction: { value: FADE_FRACTION } as IUniform<number>,
  uCullNear: { value: 100 } as IUniform<number>,
  uCullFar: { value: 140 } as IUniform<number>,
  /** Peak bend, in radians-ish. Scaled by the world's wind speed setting. */
  uGrassWind: { value: 0.42 } as IUniform<number>,
  /** Idle breathing so the sward is never perfectly still. */
  uTipLift: { value: 0.035 } as IUniform<number>,
  uGrassTipWarm: { value: C.grassTipWarm.clone() } as IUniform<Color>,
  /**
   * Grass runs its own wind rather than the generic `aWind` sway, so it needs
   * these directly. Pointed at the world's objects, not copies — see
   * `shading/globals.ts`.
   */
  uTime: worldUniforms.uTime as IUniform<number>,
  uWindDir: worldUniforms.uWindDir as IUniform<Vector2>,
  uWindSpeed: worldUniforms.uWindSpeed as IUniform<number>,
  uUnitsPerPixel: worldUniforms.uUnitsPerPixel as IUniform<number>
}

export interface GrassMaterialOptions {
  /** Root half-width of this tier's blades, in metres — the screen-width floor
   *  is expressed relative to it. */
  bladeWidth: number
  /** 0 = keep the baked yaw, 1 = fully camera-facing. Only the far tiers. */
  faceCamera: number
  /**
   * `1` if this tier evaluates the wind block, `0` to skip it. Per tier rather
   * than global because it is what makes the skip *free*: uniform inside a draw
   * call, so the whole warp takes the same path.
   */
  bladeWind: number
  name?: string
}

export class GrassMaterial extends ToonMaterial {
  private readonly uBladeWidth: IUniform<number>
  private readonly uFaceCamera: IUniform<number>
  private readonly uBladeWind: IUniform<number>
  /**
   * The tier's width compensation (`1/√tierDensity`).
   *
   * Per tier, not global, because the detail level thins each tier by a different
   * amount (`TIER_DENSITY_EXPONENT`) — widening the horizon as if it had been
   * thinned like the near field fattens it visibly.
   *
   * A uniform rather than a bake, and that is the whole reason a detail change is
   * free: with the width baked in, `setLevel` had to regenerate all six patch
   * geometries, which measured as a **34 ms frame** on the click. Under `auto`
   * that hitch lands exactly when the adaptive controller has decided the machine
   * is already struggling — the worst possible moment to spend 34 ms proving it.
   */
  private readonly uWidthScale: IUniform<number> = { value: 1 }
  /**
   * `(rampStart, rampEnd, bladesAtStart, bladesAtEnd)` for this tier.
   *
   * Per tier and not per patch, which is the point: the shader evaluates the
   * ramp from each blade's own depth. Doing it per patch put a 20 % density step
   * on a 4 m grid in the near field — see `config.ts`'s `tierRamp`.
   */
  private readonly uTierRamp: IUniform<Vector4> = { value: new Vector4(0, 1, 1, 1) }

  constructor(options: GrassMaterialOptions) {
    super({
      // White: the whole albedo arrives from `vGrassTint`, which is the ground
      // colour sampled where the patch stands times the along-blade gradient.
      color: new Color(0xffffff),
      // Grass is foliage. The softer terminator is the difference between a
      // meadow and a field of green plastic.
      ramp: getFoliageRamp(),
      // Not the generic wind — see `grassUniforms`. Also load-bearing: with
      // `WORLD_WIND` defined, `uTime`/`uWindDir`/`uWindSpeed` would be declared
      // twice and the shader would fail to compile.
      wind: false,
      // No `color` attribute on the geometry — twelve bytes per vertex of data
      // that is three instructions to derive, on the largest vertex buffer in
      // the world.
      vertexColors: false,
      // A blade is a single sheet. Culling its back faces punches holes in the
      // sward from every second viewing angle; three's `DOUBLE_SIDED` path flips
      // the normal by `gl_FrontFacing`, so the lit side is always the near side.
      side: DoubleSide,
      // Softer than a prop: a blade is thin and takes the periwinkle push over
      // its whole width, and at full strength the meadow's shadowed half turns
      // blue rather than dark green.
      shadowTintMix: 0.22,
      // ── Much *weaker* than a prop, and this was measured the hard way ──────
      //
      // The first pass reasoned that a rim would read as a sheen across the top
      // of the sward and set it to 0.6, above the world's 0.45 default. It came
      // out as a field of white straw, and at the impostor tiers as white
      // speckles across the whole horizon.
      //
      // The reason is specific to grass and worth keeping: GDD R5 tunes the rim
      // for a *closed* surface, where `pow(1 − N·V, p)` is near zero across most
      // of the object and spikes only at the silhouette. Grass has no interior.
      // Every blade's normal is blended 0.6 toward the ground normal (R3), which
      // points up, while the camera looks along the ground — so `N·V ≈ 0` and
      // the fresnel term is at its *maximum* over the entire meadow at once.
      // What is a thin bright edge on a boulder is a full-coverage white wash
      // here.
      //
      // So the rim is cut to a third of the world default and sharpened. It
      // still catches the blades that genuinely turn away, which is what it is
      // for; the sheen the first pass wanted comes from the toon ramp's top band
      // instead, where it belongs.
      rimStrength: 0.15,
      rimPower: 3.6,
      name: options.name ?? 'grass'
    })

    this.uBladeWidth = { value: options.bladeWidth }
    this.uFaceCamera = { value: options.faceCamera }
    this.uBladeWind = { value: options.bladeWind }
  }

  /** Root half-width of this tier's blades, after detail-level compensation. */
  setBladeWidth(value: number): void {
    this.uBladeWidth.value = value
  }

  /** This tier's `1/√density` width compensation. See `uWidthScale`. */
  setWidthScale(value: number): void {
    this.uWidthScale.value = value
  }

  /** `[start, end, bladesAtStart, bladesAtEnd]`. See `uTierRamp`. */
  setTierRamp(ramp: readonly number[]): void {
    this.uTierRamp.value.set(ramp[0]!, ramp[1]!, ramp[2]!, ramp[3]!)
  }

  override customProgramCacheKey(): string {
    // Distinct from `world-toon`, or three would hand grass the props' program.
    return `world-grass|${this.defines?.CSM_CASCADES ?? 0}`
  }

  override onBeforeCompile(shader: WebGLProgramParametersWithUniforms): void {
    // Chained, not replaced. Everything the world's look depends on is applied
    // by this call; the grass patches go *on top* of the result.
    super.onBeforeCompile(shader)

    for (const [name, uniform] of Object.entries(grassUniforms)) {
      shader.uniforms[name] = uniform
    }
    shader.uniforms.uBladeWidth = this.uBladeWidth
    shader.uniforms.uFaceCamera = this.uFaceCamera
    shader.uniforms.uBladeWind = this.uBladeWind
    shader.uniforms.uWidthScale = this.uWidthScale
    shader.uniforms.uTierRamp = this.uTierRamp

    shader.vertexShader = shader.vertexShader
      // After the fade and wind declarations `ToonMaterial` put here.
      .replace('#include <clipping_planes_pars_vertex>', `#include <clipping_planes_pars_vertex>\n${GRASS_PARS_VERTEX_GLSL}`)
      // The blade is built where the normal would normally be read, because the
      // normal has to be the *blade's*, and three computes normals before
      // positions. `objectNormal` is declared here rather than by the replaced
      // chunk, so nothing downstream can tell the difference.
      .replace('#include <beginnormal_vertex>', `${GRASS_COMPUTE_GLSL}\nvec3 objectNormal = wGrassNormal;`)
      // `begin_vertex` still runs — `transformed` is declared there — and is
      // immediately overwritten with the world-space blade vertex.
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${GRASS_POSITION_GLSL}`)

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <clipping_planes_pars_fragment>',
        `#include <clipping_planes_pars_fragment>\n${GRASS_PARS_FRAGMENT_GLSL}`
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n${GRASS_COLOR_FRAGMENT_GLSL}`)

    // `uFade` is left at 1 for every grass tier and the dither in
    // `FADE_FRAGMENT_GLSL` therefore never runs — a patch belongs to exactly one
    // tier at a time, because grass replaces the crossfade with a continuous
    // per-blade density ramp (see `config.ts`). The chunk stays compiled in
    // rather than being surgically removed: it costs one comparison against a
    // uniform that is coherent across the whole draw, and cutting it out would
    // mean forking `ToonMaterial`'s injection for one branch.
    //
    // `super` already chained the cascades in. Re-running it here would apply
    // CSM's replacements a second time and double the cascade branch.
  }

  /**
   * `ToonMaterial.clone()` constructs a `ToonMaterial`, which would quietly
   * downgrade a cloned grass tier to a prop material — it renders, as a cluster
   * of untransformed blades at the world origin. Nothing in the field clones,
   * but `DitheredLod` and `InstancedLodField` both do, so leaving the inherited
   * clone in place is a trap for the next person who reuses this material.
   */
  override clone(): this {
    const copy = new GrassMaterial({
      bladeWidth: this.uBladeWidth.value,
      faceCamera: this.uFaceCamera.value,
      bladeWind: this.uBladeWind.value,
      name: this.name
    })
    copy.uFade.value = this.uFade.value
    copy.uWidthScale.value = this.uWidthScale.value
    copy.uTierRamp.value.copy(this.uTierRamp.value)
    return copy as this
  }
}
