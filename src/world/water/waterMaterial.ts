import type { DataTexture, IUniform, WebGLProgramParametersWithUniforms } from 'three'
import { Color, DoubleSide } from 'three'
import { C } from '../art/palette'
import { worldUniforms } from '../shading/globals'
import { ToonMaterial } from '../shading/toonMaterial'
import type { WaterStyle } from './types'
import {
  WATER_COLOR_FRAGMENT_GLSL,
  WATER_NORMAL_FRAGMENT_GLSL,
  WATER_PARS_FRAGMENT_GLSL,
  WATER_PARS_VERTEX_GLSL,
  WATER_SPARKLE_FRAGMENT_GLSL,
  WATER_VERTEX_GLSL
} from './waterGlsl'
import { WATER_ATLAS_TILE_METRES, getWaterAtlas } from './waterTextures'

/**
 * ─── The world's one water material ─────────────────────────────────────────
 *
 * A `ToonMaterial` subclass whose `onBeforeCompile` **chains** its parent's, for
 * the same reason `TerrainMaterial` does. Everything the rest of the world gets
 * for free — fog, cascaded shadows, tone mapping, colour management, the
 * periwinkle shadow tint, the mandatory fresnel rim and the dithered LOD
 * crossfade — arrives through that chain. A hand-rolled `ShaderMaterial` would
 * have to re-implement every one of them and would lose them one at a time and
 * silently. It also means a waterfall curtain can be handed to `DitheredLod`
 * exactly like any other prop, because `uFade` and the fade discard are already
 * in the program.
 *
 * ── One program for all water ───────────────────────────────────────────────
 *
 * Pond, sea, river and waterfall are **uniform values only**. There is no define
 * that forks on water kind, and there is no place in the shader that asks which
 * kind it is: a waterfall is a vertical sheet, and the vertex stage discovers
 * that from `|normal.y|` rather than from a flag. Four defines here would be
 * four programs, which on its own is a third of the GDD §5.2 budget of ~13 for
 * the entire world.
 *
 * `uSteepness` is the newest thing that could have broken this and did not.
 * Gerstner displacement is asked for on the sea and the river and is off on the
 * pond and the falls, which is exactly the shape of a `#define WATER_GERSTNER` —
 * and it is a uniform instead, so all four still share one program and the two
 * that do not want it pay a multiply by zero in the *vertex* stage. Water's cost
 * is overdraw; vertex ALU on a few thousand vertices is not where it is spent.
 *
 * ── Transparency ────────────────────────────────────────────────────────────
 *
 * `transparent` with `depthWrite: false`, and the choice is a trade between two
 * failure modes:
 *
 *   • **`depthWrite: true`** would make every water surface occlude the water
 *     behind it. A river built from segments, or a fall whose plume overlaps the
 *     pool it lands in, would punch the far surface out entirely and show
 *     whatever was drawn before it — sky, at a seam. That is a hole in the
 *     world.
 *   • **`depthWrite: false`** means two overlapping water surfaces blend in draw
 *     order rather than in depth order. The error is real but small: both
 *     surfaces are the same near-uniform blue, so getting them backwards changes
 *     a blend weight, not a silhouette.
 *
 * The second failure is the cheaper one, so it is the one taken.
 *
 * `DoubleSide` because a fall is walked behind and a river ribbon is seen
 * edge-on from a low camera — paired with `forceSinglePass`, without which
 * three draws every transparent double-sided mesh twice and compiles two
 * programs for it. See the constructor.
 *
 * ── Shadows ─────────────────────────────────────────────────────────────────
 *
 * Water *receives* — a cliff shadow lying across a pond is most of what places
 * it in the world — so the CSM registration `ToonMaterial`'s constructor does is
 * left exactly alone, and `super.onBeforeCompile` still installs the cascade
 * uniforms. Water should not *cast*: the shadow pass uses three's own depth
 * material, which knows nothing about the wave displacement, so a casting water
 * mesh would drop the shadow of an undisplaced flat plane. Set
 * `castShadow = false` on the mesh.
 */

export interface WaterMaterialOptions {
  style: WaterStyle
  name?: string
}

/**
 * The atlas uniform, shared by reference across every water material — exactly
 * as `worldUniforms` are, and for the same reason: there is one tile in the
 * world and a per-material uniform object would only give the driver more
 * distinct bindings to track for an identical texture.
 *
 * Built lazily on the first `onBeforeCompile` rather than at module scope. It is
 * ~10 ms of main-thread work at boot, and a module-level call would charge it to
 * whoever first *imports* this file — including a unit test that never renders.
 */
let waterAtlasUniform: IUniform<DataTexture> | null = null

const getWaterAtlasUniform = (): IUniform<DataTexture> => {
  waterAtlasUniform ??= { value: getWaterAtlas().texture }
  return waterAtlasUniform
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * Wave amplitude, in metres, at which the chop and the caustics reach full
 * strength. Set from the `sea` preset (0.16 m), which is the surface the
 * reference is loudest about — so the sea sits at 1, a river at ~0.4, and a
 * pond's exact 0 stays an exact 0.
 */
const FULL_DETAIL_AMPLITUDE = 0.14

/**
 * The amplitude below which caustics are considered fully faded out.
 *
 * Much smaller than `FULL_DETAIL_AMPLITUDE` on purpose, and the physics is the
 * argument: caustic brightness comes from *curvature* focusing light, and even a
 * shallow ripple focuses hard. A river at 0.055 m should have nearly the sea's
 * caustics on its bed, while its chop is nowhere near the sea's.
 */
const FULL_CAUSTIC_AMPLITUDE = 0.06

/**
 * Fraction of the swell's phase speed at which the atlas is scrolled.
 *
 * Caustics are made by the wave, so they travel with it — but not *at* it: the
 * sea's phase speed is 4.6 m/s (0.42 crests/s × 11 m), and a caustic net moving
 * at walking pace across a bay reads as a projected video. A tenth of it puts an
 * atlas cell crossing its own width in about two seconds, which is the rate the
 * reference's bottom ripples at.
 */
const SWELL_DRIFT_FRACTION = 0.12

/**
 * Amplitude of the refraction wobble, as a fraction of `depthFalloff`.
 *
 * Expressed as a fraction rather than in metres so it scales with the body: a
 * 0.1 shift on a sea (7 m falloff) is 0.7 m of apparent depth, and on a river
 * (1.9 m) it is 19 cm. Both read as the same amount of swim, which is what the
 * eye judges — the bottom of a stream does not wobble by metres.
 */
const REFRACT_DEPTH_FRACTION = 0.34

/**
 * Metres of surface per atlas tile, overriding `WATER_ATLAS_TILE_METRES` where
 * the shader wants a different size than the atlas author suggested.
 *
 * The atlas file sizes `fall` at 3 m from its blotch channel: 3 fBm octaves over
 * a 3 m tile put the base patches at about 1 m, and the curtains it was written
 * against are 1.6–5.4 m wide. That is the right *reasoning*, and on screen it is
 * still too small — the patches read as a texture on the water rather than as
 * the water's own structure, and by the time a fall is seen from the ten metres
 * the bench frames it at, they average to a pale wash. The reference curtains
 * carry two or three patches across their width, not five, with the depth ramp's
 * cyan clearly showing between them.
 *
 * 5 m puts the blotch channel's base octave at 1.7 m across the sheet and
 * (5 / 4) / `WATER_FLOW_SQUASH` ≈ 1.8 m down it, so the 4.2 m `river` fall gets
 * two or three patches across its width and the 1.6 m `ribbon` gets one. Chosen
 * from screenshots against 3, 4.5, 6.5, 9 and 12: 3 came out checkered, and by
 * 6.5 whole strands were going a flat colour between patches.
 *
 * It is set here rather than in `waterTextures.ts` because it is a statement
 * about how this shader samples the tile, not about the tile — the atlas's own
 * suggestion is right for a shader that samples it isotropically, and this one
 * does not.
 *
 * The same scale reaches the fall's plunge pool and spray cluster, which share
 * its material — and wants to: at 3 m the holes punched in a spray mound's foam
 * came out finer than the mound's own facets.
 */
const TILE_METRES_OVERRIDE: Record<string, number> = { fall: 5 }

export class WaterMaterial extends ToonMaterial {
  private readonly uWaveAmplitude: IUniform<number> = { value: 0 }
  private readonly uWaveLength: IUniform<number> = { value: 1 }
  private readonly uWaveSpeed: IUniform<number> = { value: 0 }
  /**
   * Gerstner steepness, 0–1 (`WaterStyle.steepness`). A **uniform**, never a
   * define: forking the program on "is this Gerstner" would take water from one
   * compiled program to two for one arithmetic branch, and the branch it buys is
   * a multiply by zero on a surface whose cost is overdraw rather than vertex
   * ALU. Pond and fall sit at 0 and the shader's whole horizontal path
   * multiplies out there exactly — see `waterGlsl.ts`.
   */
  private readonly uSteepness: IUniform<number> = { value: 0 }
  private readonly uWaterShallow: IUniform<Color> = { value: new Color() }
  private readonly uWaterMid: IUniform<Color> = { value: new Color() }
  private readonly uWaterDeep: IUniform<Color> = { value: new Color() }
  private readonly uWaterFoam: IUniform<Color> = { value: new Color() }
  private readonly uWaterSparkle: IUniform<Color> = { value: C.waterSparkle.clone() }
  private readonly uWaterCaustic: IUniform<Color> = { value: C.waterCaustic.clone() }
  private readonly uDepthFalloff: IUniform<number> = { value: 1 }
  private readonly uFoamWidth: IUniform<number> = { value: 1 }
  private readonly uCrestFoam: IUniform<number> = { value: 0 }
  private readonly uOpacity: IUniform<number> = { value: 1 }
  private readonly uSparkle: IUniform<number> = { value: 0 }
  private readonly uFlowSpeed: IUniform<number> = { value: 0 }
  /** Atlas tiles per metre of surface — the reciprocal of `WATER_ATLAS_TILE_METRES`. */
  private readonly uAtlasScale: IUniform<number> = { value: 0.25 }
  /** Metres/second the atlas is scrolled by the swell, on top of `aFlow`. */
  private readonly uSwellDrift: IUniform<number> = { value: 0 }
  private readonly uCaustic: IUniform<number> = { value: 0 }
  private readonly uDetail: IUniform<number> = { value: 0 }
  private readonly uRefract: IUniform<number> = { value: 0 }

  /**
   * The style the *geometry* was baked against, kept so `clone()` can rebuild an
   * identical material rather than one whose foam band has silently rescaled.
   */
  private readonly bakedStyle: WaterStyle
  /**
   * `aShore` is baked normalised: 0 on a free edge, 1 at `foamWidth` metres
   * inside it (`types.ts`). So the shader's foam width is a **ratio against the
   * baked band**, not metres — 1 reproduces exactly what the generator baked,
   * and dragging the editor's `foamWidth` slider widens or narrows the band live
   * without regenerating a single vertex.
   */
  private readonly bakedFoamWidth: number
  private activeStyle: WaterStyle

  constructor(options: WaterMaterialOptions) {
    super({
      name: options.name ?? `water-${options.style.id}`,
      // No `color` attribute is baked (`WATER_ATTRIBUTES`), and `USE_COLOR` on a
      // geometry that lacks one reads the attribute default — black water.
      vertexColors: false,
      side: DoubleSide,
      rimStrength: options.style.rimStrength,
      // Water never sways. `wind: true` would add `WORLD_WIND` to the defines —
      // a second water program — and would declare `uTime` twice in the vertex
      // stage, which is a compile error rather than a silent one.
      wind: false
    })

    this.transparent = true
    this.depthWrite = false
    // Without this, `renderObject` splits every transparent `DoubleSide` draw
    // into a BackSide pass and a FrontSide pass — two draw calls per water mesh,
    // two `needsUpdate` flips per object per frame, and **two compiled
    // programs**, since `flipSided` is part of three's own program key. Measured
    // here: 2 water programs before, 1 after. The split exists so a closed
    // transparent shell sorts its own far side behind its near side; water is a
    // sheet, never a shell, so there is no far side to sort against.
    this.forceSinglePass = true

    this.bakedStyle = options.style
    this.bakedFoamWidth = Math.max(options.style.foamWidth, 1e-3)
    this.activeStyle = options.style
    this.applyStyle(options.style)
  }

  /** The style currently on the uniforms — not necessarily the one baked into the geometry. */
  get style(): WaterStyle {
    return this.activeStyle
  }

  /**
   * Live restyle for the editor's sliders.
   *
   * Writes `.value` on the existing uniform objects and touches nothing else —
   * no define, no uniform object reassignment, no `needsUpdate`. Any of those
   * would recompile the program, and a recompile on every frame of a drag is a
   * multi-hundred-millisecond stall per slider rather than a hitch.
   *
   * Colours are `copy`'d, never assigned: `WaterStyle` holds references straight
   * out of the palette, and assigning one into a uniform would alias it — a
   * later write to the uniform would then edit the palette itself.
   */
  applyStyle(style: WaterStyle): void {
    this.activeStyle = style

    this.uWaveAmplitude.value = style.waveAmplitude
    this.uWaveLength.value = Math.max(style.waveLength, 0.05)
    this.uWaveSpeed.value = style.waveSpeed
    // Clamped here rather than in the shader so the GLSL `min()` against the
    // loop threshold only ever has to defend against a large amplitude or a
    // short wavelength, not against a negative steepness inverting the trochoid.
    this.uSteepness.value = clamp01(style.steepness)

    this.uWaterShallow.value.copy(style.shallow)
    this.uWaterMid.value.copy(style.mid)
    this.uWaterDeep.value.copy(style.deep)
    this.uWaterFoam.value.copy(style.foam)

    this.uDepthFalloff.value = Math.max(style.depthFalloff, 0.05)
    this.uFoamWidth.value = style.foamWidth / this.bakedFoamWidth
    this.uCrestFoam.value = style.crestFoam
    this.uOpacity.value = style.opacity
    this.uSparkle.value = style.sparkle
    this.uFlowSpeed.value = style.flowSpeed

    // ── Everything the atlas needs, derived rather than authored ─────────────
    //
    // Deliberately **not** new `WaterStyle` fields. Four more dials would be
    // four more things the editor can set to a value that contradicts the wave
    // it is standing on — caustics on a mirror, chop with no swell — and every
    // one of these is a consequence of dials the style already has. Derivation
    // also means the four presets need no edit to pick the new look up, and an
    // interpolated style between two of them stays coherent.
    //
    // The atlas author's own per-preset tile size is the anchor
    // (`WATER_ATLAS_TILE_METRES`: 1 m Worley cells on a sea, tighter on a river
    // so a 3 m channel gets several cells across it). A style that is not one of
    // the four falls back to a wavelength-derived size, so the editor's own
    // presets still work.
    const tileMetres =
      TILE_METRES_OVERRIDE[style.id] ??
      WATER_ATLAS_TILE_METRES[style.id] ??
      Math.min(8, Math.max(1.5, style.waveLength * 0.7))
    this.uAtlasScale.value = 1 / tileMetres

    // A pond's exact 0 has to survive all four of these, or `motion[pond]`
    // stops being 0.000 — see the note at the top of `waterGlsl.ts`.
    this.uDetail.value = clamp01(style.waveAmplitude / FULL_DETAIL_AMPLITUDE)
    this.uCaustic.value = clamp01(style.waveAmplitude / FULL_CAUSTIC_AMPLITUDE)
    this.uRefract.value = REFRACT_DEPTH_FRACTION
    this.uSwellDrift.value =
      style.waveSpeed * style.waveLength * SWELL_DRIFT_FRACTION * clamp01(style.waveAmplitude / 0.02)

    this.uRimStrength.value = style.rimStrength
  }

  /**
   * Constant for every body of water in the world — that is the whole point.
   * Pond, sea, river and fall differ by uniform values only, so all four share
   * one compiled program and water costs the GDD §5.2 budget exactly one.
   * `super` contributes the wind flag (never set here) and the CSM cascade
   * count, which is a property of the lighting rig rather than of the water.
   */
  override customProgramCacheKey(): string {
    return `world-water|${super.customProgramCacheKey()}`
  }

  override onBeforeCompile(shader: WebGLProgramParametersWithUniforms): void {
    // Chain, never assign. `super` installs the dithered LOD fade, the wind
    // block, the periwinkle shadow tint, the fresnel rim and the CSM cascade
    // uniforms; everything below is added on top of those, not instead of them.
    super.onBeforeCompile(shader)

    // Shared by reference with every other material in the world — one write per
    // frame to `worldUniforms.uTime.value` drives the waves, the flow and the
    // wind together. `super` has already put the same object in the bag; naming
    // it here is what makes water's dependency on it explicit.
    shader.uniforms.uTime = worldUniforms.uTime

    shader.uniforms.uWaveAmplitude = this.uWaveAmplitude
    shader.uniforms.uWaveLength = this.uWaveLength
    shader.uniforms.uWaveSpeed = this.uWaveSpeed
    shader.uniforms.uSteepness = this.uSteepness
    shader.uniforms.uWaterShallow = this.uWaterShallow
    shader.uniforms.uWaterMid = this.uWaterMid
    shader.uniforms.uWaterDeep = this.uWaterDeep
    shader.uniforms.uWaterFoam = this.uWaterFoam
    shader.uniforms.uWaterSparkle = this.uWaterSparkle
    shader.uniforms.uWaterCaustic = this.uWaterCaustic
    shader.uniforms.uDepthFalloff = this.uDepthFalloff
    shader.uniforms.uFoamWidth = this.uFoamWidth
    shader.uniforms.uCrestFoam = this.uCrestFoam
    shader.uniforms.uOpacity = this.uOpacity
    shader.uniforms.uSparkle = this.uSparkle
    shader.uniforms.uFlowSpeed = this.uFlowSpeed
    shader.uniforms.uAtlasScale = this.uAtlasScale
    shader.uniforms.uSwellDrift = this.uSwellDrift
    shader.uniforms.uCaustic = this.uCaustic
    shader.uniforms.uDetail = this.uDetail
    shader.uniforms.uRefract = this.uRefract
    // Shared by reference, like `uTime` — one tile for every body of water in
    // the world. Adding a sampler does not fork the program: only defines do,
    // and there is still exactly one water program.
    shader.uniforms.uWaterAtlas = getWaterAtlasUniform()

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WATER_PARS_VERTEX_GLSL}`)
      // `super` has already prepended the fade and wind blocks to this include;
      // matching the remaining literal lands the wave after both, and after
      // `<begin_vertex>`/`<normal_vertex>`, which is the only slot where
      // `transformed` and `vNormal` both exist and neither has been consumed.
      .replace('#include <project_vertex>', `${WATER_VERTEX_GLSL}\n#include <project_vertex>`)

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WATER_PARS_FRAGMENT_GLSL}`)
      // Before the lighting, so the toon ramp bands the water colour rather than
      // the water colour being painted over already-banded light. This is also
      // where the two atlas taps are read, and `<color_fragment>` running before
      // `<normal_fragment_begin>` in three's own `meshtoon_frag` is what lets the
      // block below reuse them instead of taking a third and fourth.
      .replace('#include <color_fragment>', `#include <color_fragment>\n${WATER_COLOR_FRAGMENT_GLSL}`)
      // The only slot where view-space `normal` exists and nothing has consumed
      // it: `lights_fragment_begin` copies it into `geometryNormal` immediately
      // after, so the chop reaches the toon bands, the rim and the glint alike.
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>\n${WATER_NORMAL_FRAGMENT_GLSL}`)
      // After `super`'s `SURFACE_FRAGMENT_GLSL`, so the glint sits on top of the
      // shadow tint and rim instead of being tinted by them.
      .replace('#include <opaque_fragment>', `${WATER_SPARKLE_FRAGMENT_GLSL}\n#include <opaque_fragment>`)

    if (import.meta.env.DEV) {
      // Chunk surgery fails *silently*: a renamed include in a three upgrade
      // means the replace matches nothing and the effect quietly disappears with
      // no error anywhere. Recording whether each patch landed makes that
      // checkable from the console instead of guessable from a screenshot.
      this.userData.patched = {
        vertexWave: shader.vertexShader.includes('waterWave('),
        vertexNormal: shader.vertexShader.includes('vNormal = normalize(vNormal +'),
        vertexGerstner: shader.vertexShader.includes('vec3 waterTilt = vec3('),
        fragmentColor: shader.fragmentShader.includes('float waterDepthT ='),
        fragmentAtlas: shader.fragmentShader.includes('waterTapA = texture2D('),
        fragmentDetailNormal: shader.fragmentShader.includes('waterDetailSlope.x'),
        fragmentSparkle: shader.fragmentShader.includes('float waterGlint ='),
        // Inherited, and the ones that vanish first if a `super` call is ever
        // dropped in favour of assigning `onBeforeCompile`.
        inheritedFade: shader.fragmentShader.includes('worldIGN('),
        inheritedSurface: shader.fragmentShader.includes('uShadowTintMix')
      }
    }
  }

  /**
   * Clone that keeps the shared program but gets its own `uFade`, so
   * `DitheredLod` can crossfade two tiers of the same waterfall independently.
   * Rebuilt from the *baked* style and then restyled, so a clone taken mid-drag
   * carries the current look without inheriting a rescaled foam baseline.
   */
  override clone(): this {
    const copy = new WaterMaterial({ style: this.bakedStyle, name: this.name })
    copy.applyStyle(this.activeStyle)
    copy.uFade.value = this.uFade.value
    return copy as this
  }
}

export const createWaterMaterial = (options: WaterMaterialOptions): WaterMaterial => new WaterMaterial(options)
