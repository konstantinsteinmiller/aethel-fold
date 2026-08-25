import { BackSide, ShaderMaterial, UniformsLib, UniformsUtils } from 'three'
import { OUTLINE_COOL, OUTLINE_COOL_MIX, OUTLINE_DARKEN } from '../art/palette'
import { worldUniforms } from './globals'
import { WIND_PARS_VERTEX_GLSL, WIND_VERTEX_GLSL } from './glsl'

/**
 * ─── Inverted-hull outline ──────────────────────────────────────────────────
 *
 * Back-faces, pushed out along the normal, drawn behind the object. Chosen over
 * a screen-space depth/normal edge pass because the world is thousands of small
 * instanced props: a fullscreen sobel would put an outline around every blade of
 * grass and around the terrain's own tessellation, and would cost a full-screen
 * pass on a phone. The hull outlines exactly the silhouettes we want and rides
 * along in the same instanced draw.
 *
 * Two details do most of the work (GDD R6):
 *
 * • **Constant screen width.** The hull is expanded in *view* space by
 *   `pixelWidth × unitsPerPixel × depth`, so a 1.6 px outline stays 1.6 px at
 *   2 m and at 40 m. Expanding by a fixed world-space amount — what most
 *   inverted-hull implementations do — makes distant props look like they were
 *   drawn with a marker.
 *
 * • **Coloured, never black.** The outline colour is *derived from the object's
 *   own vertex colour* (× 0.22, shifted cool), so a birch outlines pale and a
 *   basalt boulder outlines near-black, automatically, and a palette change
 *   carries through without touching this file. A uniform black outline is the
 *   single fastest way to make a stylised scene read as a cheap cartoon filter.
 */

export interface OutlineMaterialOptions {
  /** Outline thickness in screen pixels. The project default is 1.6 (GDD R6). */
  pixelWidth?: number
  /** Matches the base material's wind so the outline doesn't detach in a gust. */
  wind?: boolean
  windStrength?: number
  name?: string
}

const vertexShader = /* glsl */ `
uniform float uPixelWidth;
uniform float uUnitsPerPixel;
uniform float uFade;

#ifdef USE_INSTANCING
  attribute float aFade;
#endif

varying float vFade;
varying vec3 vColorRaw;

${WIND_PARS_VERTEX_GLSL}

#include <common>
#include <fog_pars_vertex>
// ── Skinning ────────────────────────────────────────────────────────────────
//
// An inverted hull has to deform with the body or it stays in bind pose while
// the character walks out of it — the outline detaches completely, which is the
// most visible possible failure.
//
// This is a hand-written ShaderMaterial, so none of it comes for free the way
// it does for ToonMaterial (which inherits MeshToonMaterial). It works because
// three decides skinning from the *object*, not the material —
// skinning: object.isSkinnedMesh === true — so USE_SKINNING is defined and
// bindMatrix, bindMatrixInverse and boneTexture are uploaded for any material
// on a SkinnedMesh. skinIndex/skinWeight are declared by three's vertex prefix
// under the same define. Every chunk below is #ifdef-guarded, so nothing
// changes for the props and no extra program is compiled for them.
//
// NB: no backticks in this comment — it lives inside a template literal, and
// one would close the string and take the whole module out with it.
#include <skinning_pars_vertex>

void main() {
  vColorRaw = color;

  // Signed coverage, see FADE_FRAGMENT_GLSL — instanced fields carry it
  // per-instance and ignore the master uniform.
  #ifdef USE_INSTANCING
    vFade = aFade;
  #else
    vFade = uFade;
  #endif

  vec3 transformed = position;
  vec3 objectNormal = normal;

  // Order is load-bearing: skinbase builds the four bone matrices that the
  // other two read, and the normal must be skinned as well as the position —
  // the hull is extruded *along the normal*, so an unskinned normal would push
  // a correctly-posed vertex in the bind-pose direction and the outline would
  // fatten and thin as the limb rotated.
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>

  ${WIND_VERTEX_GLSL}

  vec4 mvPosition = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
    // Instances use uniform scale by contract, so the rotation block of
    // instanceMatrix is orthogonal and doubles as the normal matrix. If
    // non-uniform instance scaling is ever introduced this needs the inverse
    // transpose instead, and the outline will visibly thin on the squashed axis.
    objectNormal = mat3(instanceMatrix) * objectNormal;
  #endif
  mvPosition = modelViewMatrix * mvPosition;

  vec3 viewNormal = normalize(normalMatrix * objectNormal);

  // Depth-proportional expansion → constant pixel width.
  float widthWorld = uPixelWidth * uUnitsPerPixel * max(-mvPosition.z, 0.001);
  mvPosition.xyz += viewNormal * widthWorld;

  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`

const fragmentShader = /* glsl */ `
uniform vec3 uCool;
uniform float uDarken;
uniform float uCoolMix;

varying float vFade;
varying vec3 vColorRaw;

#include <common>
#include <fog_pars_fragment>

void main() {
  // Outlines do NOT dither across a crossfade — only the dominant tier draws one.
  //
  // Dithering a 1.6 px line is visibly wrong: the two tiers' hulls sit a fraction
  // of a pixel apart, so their complementary patterns don't reconstruct into a
  // solid line and the silhouette comes out as a dotted crawl (very obvious in a
  // still frame). Coverage magnitudes sum to 1 across a band, so exactly one tier
  // is ≥ 0.5 and this hands the outline to it wholesale. Switching a hairline is
  // imperceptible; speckling it is not.
  if (abs(vFade) < 0.5) discard;

  // deriveOutlineColor() from art/palette.ts, evaluated per-fragment so it
  // tracks the vertex colour instead of a per-asset constant.
  vec3 outlineColor = mix(vColorRaw * uDarken, uCool, uCoolMix);

  gl_FragColor = vec4(outlineColor, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

export class OutlineMaterial extends ShaderMaterial {
  readonly uFade = { value: 1 }

  constructor(options: OutlineMaterialOptions = {}) {
    const { pixelWidth = 1.6, wind = false, windStrength = 0.06, name = 'toon-outline' } = options

    super({
      // `fog: true` + merging UniformsLib.fog is what lets a raw ShaderMaterial
      // participate in the scene fog; without the merge the chunks compile but
      // read undefined uniforms and every outline renders unfogged black.
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          uPixelWidth: { value: pixelWidth },
          uUnitsPerPixel: { value: 0.002 },
          uFade: { value: 1 },
          // From the palette, not literals: the level editor restores these
          // exact values after highlighting a focused prop, and a second copy
          // of the number here is a prop that quietly keeps the wrong outline.
          uCool: { value: OUTLINE_COOL.clone() },
          uDarken: { value: OUTLINE_DARKEN },
          uCoolMix: { value: OUTLINE_COOL_MIX },
          uWindStrength: { value: windStrength },
          uTime: { value: 0 },
          uWindDir: { value: worldUniforms.uWindDir.value.clone() },
          uWindSpeed: { value: worldUniforms.uWindSpeed.value }
        }
      ]),
      vertexShader,
      fragmentShader,
      // The hull is the object's back faces; culling front faces is what turns
      // it into a silhouette instead of a solid blob in front of the mesh.
      side: BackSide,
      vertexColors: true,
      fog: true,
      defines: wind ? { WORLD_WIND: '' } : {}
    })

    this.name = name

    // Re-point the shared uniforms at the global objects. UniformsUtils.merge
    // deep-clones, which is right for the per-material values above but would
    // otherwise sever wind/units-per-pixel from the world clock.
    this.uniforms.uTime = worldUniforms.uTime
    this.uniforms.uWindDir = worldUniforms.uWindDir
    this.uniforms.uWindSpeed = worldUniforms.uWindSpeed
    this.uniforms.uUnitsPerPixel = worldUniforms.uUnitsPerPixel
    this.uniforms.uFade = this.uFade
  }

  /**
   * `ShaderMaterial.copy` deep-clones the uniform bag, which is right for the
   * per-material values but severs this material from the world clock and from
   * its own `uFade` object. Both have to be re-pointed, or a cloned outline
   * silently stops responding to wind and to the LOD crossfade — and it fails
   * *invisibly*, which is why this override exists rather than a note.
   */
  override copy(source: this): this {
    super.copy(source)
    this.uniforms.uTime = worldUniforms.uTime
    this.uniforms.uWindDir = worldUniforms.uWindDir
    this.uniforms.uWindSpeed = worldUniforms.uWindSpeed
    this.uniforms.uUnitsPerPixel = worldUniforms.uUnitsPerPixel
    this.uFade.value = source.uFade.value
    this.uniforms.uFade = this.uFade
    return this
  }

  setFade(value: number): void {
    this.uFade.value = value
  }

  get pixelWidth(): number {
    return this.uniforms.uPixelWidth!.value as number
  }

  set pixelWidth(value: number) {
    this.uniforms.uPixelWidth!.value = value
  }
}

export const createOutlineMaterial = (options: OutlineMaterialOptions = {}): OutlineMaterial =>
  new OutlineMaterial(options)
