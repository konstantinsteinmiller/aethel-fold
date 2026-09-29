/**
 * PaperMaterial — the one surface shader of Aethel Fold.
 *
 * aethel-fold-GDD §2: "flat, unlit cel-shaded … with bold thick black
 * outlines … unbleached parchment with subtle paper grain … a warm, localized
 * point light from above (a desk lamp) casting sharp, hard-edged shadows."
 *
 * - Toon: two hard bands from a single warm lamp; the shadow side falls to a
 *   periwinkle tint (never black) and the lamp's cone pools warm light on the
 *   page centre so the desk corners fall off.
 * - Hard shadows come from three's own spot-light shadow map (`lights: true`),
 *   so every pivot-animated flap casts correctly with no custom depth material.
 * - Paper grain is procedural, in world space (it moves with the paper).
 * - MRT: location 1 receives the view-space normal and an object id + an
 *   "actionable" bit. The composite pass runs a Sobel over normals, depth and
 *   ids to ink every silhouette and crease, and turns the actionable bit into
 *   GDD §9's pulsing yellow highlight along the outline.
 *
 * Colours are authored in sRGB (palette.ts), converted to linear by three,
 * lit in linear, and written sRGB-encoded into an 8-bit target.
 */

import {
  Color, DoubleSide, FrontSide, ShaderMaterial, UniformsLib, UniformsUtils, Vector3,
  type IUniform, type Side, type Texture
} from 'three'
import { HEX } from './palette'

/** Uniforms every paper material shares (one object, updated once a frame). */
export const paperGlobals = {
  uTime: { value: 0 },
  uLampPos: { value: new Vector3(0.6, 16, 5) },
  uLampDir: { value: new Vector3(0, -1, -0.2).normalize() },
  uLampColor: { value: new Color(HEX.lamp) },
  uShadowColor: { value: new Color(HEX.shadow) },
  uAmbient: { value: 0.16 },
  /** cos of the lamp cone's outer/inner angle for the warm pool. */
  uLampOuter: { value: Math.cos(0.95) },
  uLampInner: { value: Math.cos(0.42) },
  /** Global desaturation (pause / slow-mo focus), 0…1. */
  uDesat: { value: 0 },
  /** Highlight pulse phase, driven by the engine. */
  uPulse: { value: 0 }
}

export interface PaperMaterialOptions {
  map?: Texture | null
  /** Decode `map` from sRGB by hand (render-target snapshots). */
  mapIsSRGBData?: boolean
  alphaTest?: number
  /** Per-instance atlas frames (attribute `aFrame` = u0, v0, u1, v1). */
  atlas?: boolean
  doubleSided?: boolean
  /** Tint applied to back faces (the plain back of the paper). */
  backTint?: string
  grain?: number
  emissive?: string
  emissiveIntensity?: number
  /** Skip the toon bands (glowing things, the guide lines). */
  unlit?: boolean
  vertexColors?: boolean
  /** Object id for the outline pass (1…126). */
  id?: number
  /** Opacity via ordered dither (keeps everything in the opaque pass). */
  opacity?: number
  /** Extra per-material flat colour multiplier. */
  color?: string
  /** Vertical wobble/flutter for thin sheets (confetti, flames), radians. */
  flutter?: boolean
}

const vertex = /* glsl */ `
#include <common>
#include <color_pars_vertex>
#include <shadowmap_pars_vertex>

varying vec3 vWorldPos;
varying vec3 vViewNormal;
varying vec3 vWorldNormal;
varying vec2 vUv;

#ifdef USE_ATLAS
attribute vec4 aFrame;
#endif

void main() {
  #include <color_vertex>
  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>

  vUv = uv;
  #ifdef USE_ATLAS
  vUv = mix(aFrame.xy, aFrame.zw, uv);
  #endif

  #include <project_vertex>
  #include <worldpos_vertex>
  #include <shadowmap_vertex>

  vec4 wp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
  #endif
  wp = modelMatrix * wp;
  vWorldPos = wp.xyz;
  vViewNormal = normalize(transformedNormal);
  vWorldNormal = normalize(inverseTransformDirection(transformedNormal, viewMatrix));
}
`

const fragment = /* glsl */ `
layout(location = 1) out highp vec4 gNormal;

#include <common>
#include <packing>
#include <color_pars_fragment>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>

uniform float uTime;
uniform vec3 uLampPos;
uniform vec3 uLampDir;
uniform vec3 uLampColor;
uniform vec3 uShadowColor;
uniform float uAmbient;
uniform float uLampOuter;
uniform float uLampInner;
uniform float uDesat;
uniform float uPulse;

uniform vec3 uColor;
uniform vec3 uBackTint;
uniform vec3 uEmissive;
uniform float uEmissiveIntensity;
uniform float uGrain;
uniform float uObjectId;
uniform float uHighlight;
uniform float uOpacity;
uniform float uFlash;

#ifdef USE_MAP
uniform sampler2D map;
#endif
#ifdef USE_ALPHATEST
uniform float alphaTest;
#endif

varying vec3 vWorldPos;
varying vec3 vViewNormal;
varying vec3 vWorldNormal;
varying vec2 vUv;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1, 0, 0));
  float n010 = hash13(i + vec3(0, 1, 0));
  float n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1));
  float n101 = hash13(i + vec3(1, 0, 1));
  float n011 = hash13(i + vec3(0, 1, 1));
  float n111 = hash13(i + vec3(1, 1, 1));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z);
}

float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  int i = int(q.x) + int(q.y) * 4;
  float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return (m[i] + 0.5) / 16.0;
}

vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 fromSRGB(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

void main() {
  if (uOpacity < 0.999 && bayer4(gl_FragCoord.xy) > uOpacity) discard;

  vec3 base = uColor;
  #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  base *= vColor.rgb;
  #endif

  #ifdef USE_MAP
  vec4 tex = texture2D(map, vUv);
  #ifdef MAP_SRGB_DATA
  tex.rgb = fromSRGB(tex.rgb);
  #endif
  #ifdef USE_ALPHATEST
  if (tex.a < alphaTest) discard;
  #endif
  base *= tex.rgb;
  #endif

  vec3 n = normalize(vWorldNormal);
  vec3 vn = normalize(vViewNormal);
  #ifdef DOUBLE_SIDED
  if (!gl_FrontFacing) {
    n = -n;
    vn = -vn;
    base *= uBackTint;
  }
  #endif

  // Paper grain: long fibres + fine tooth, world space.
  if (uGrain > 0.0) {
    float fibre = vnoise(vWorldPos * vec3(9.0, 2.2, 1.6)) * 0.6 + vnoise(vWorldPos * 38.0) * 0.4;
    base *= 1.0 + (fibre - 0.5) * uGrain;
  }

  vec3 color;
  #ifdef UNLIT
  color = base;
  #else
  vec3 toLamp = uLampPos - vWorldPos;
  vec3 L = normalize(toLamp);
  float ndl = dot(n, L);
  float shadow = getShadowMask();
  // Two hard toon bands, softened by a pixel so edges don't shimmer.
  float lit = smoothstep(0.0, 0.05, ndl) * 0.4 + smoothstep(0.32, 0.37, ndl) * 0.6;
  lit *= mix(0.0, 1.0, shadow);
  float pool = smoothstep(uLampOuter, uLampInner, dot(-L, uLampDir));
  vec3 lampTerm = uLampColor * mix(0.82, 1.1, pool);
  vec3 shade = mix(uShadowColor * 0.88, vec3(1.0), 0.18);
  vec3 lightCol = mix(shade * mix(0.78, 1.0, pool), lampTerm, lit) + uAmbient * uShadowColor;
  color = base * lightCol;
  // Paper catches a thin warm edge where it turns from the lamp (rim).
  float rim = pow(1.0 - clamp(abs(vn.z), 0.0, 1.0), 3.0) * 0.18 * lit;
  color += rim * uLampColor;
  #endif

  color += uEmissive * uEmissiveIntensity;
  color = mix(color, vec3(1.0), uFlash);

  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(color, vec3(lum) * vec3(1.0, 0.97, 0.92), uDesat);

  gl_FragColor = vec4(toSRGB(color), 1.0);
  gNormal = vec4(vn * 0.5 + 0.5, (uObjectId * 2.0 + uHighlight) / 255.0);
}
`

let idCounter = 1
/** Hand out outline ids (1…123, wrapping). 124–126 are reserved (sheet, guide), 127 = never inked. */
export const nextPaperId = (): number => {
  idCounter = (idCounter % 123) + 1
  return idCounter
}

export type PaperMaterial = ShaderMaterial & {
  uniforms: Record<string, IUniform> & {
    uColor: IUniform<Color>
    uObjectId: IUniform<number>
    uHighlight: IUniform<number>
    uOpacity: IUniform<number>
    uFlash: IUniform<number>
    uEmissive: IUniform<Color>
    uEmissiveIntensity: IUniform<number>
  }
}

export const createPaperMaterial = (o: PaperMaterialOptions = {}): PaperMaterial => {
  const uniforms = UniformsUtils.merge([
    UniformsLib.lights,
    {
      uColor: { value: new Color(o.color ?? '#ffffff') },
      uBackTint: { value: new Color(o.backTint ?? HEX.parchmentShade) },
      uEmissive: { value: new Color(o.emissive ?? '#000000') },
      uEmissiveIntensity: { value: o.emissiveIntensity ?? (o.emissive ? 1 : 0) },
      uGrain: { value: o.grain ?? 0.07 },
      uObjectId: { value: o.id ?? nextPaperId() },
      uHighlight: { value: 0 },
      uOpacity: { value: o.opacity ?? 1 },
      uFlash: { value: 0 },
      map: { value: o.map ?? null },
      alphaTest: { value: o.alphaTest ?? 0.5 }
    }
  ]) as PaperMaterial['uniforms']
  // Shared globals must stay shared (merge clones values).
  for (const [k, v] of Object.entries(paperGlobals)) uniforms[k] = v
  uniforms.map!.value = o.map ?? null

  const defines: Record<string, string> = {}
  if (o.map) defines.USE_MAP = ''
  if (o.map && o.mapIsSRGBData) defines.MAP_SRGB_DATA = ''
  if (o.map && o.alphaTest !== undefined) defines.USE_ALPHATEST = ''
  if (o.atlas) defines.USE_ATLAS = ''
  if (o.doubleSided) defines.DOUBLE_SIDED = ''
  if (o.unlit) defines.UNLIT = ''

  const side: Side = o.doubleSided ? DoubleSide : FrontSide
  const m = new ShaderMaterial({
    uniforms,
    vertexShader: vertex,
    fragmentShader: fragment,
    defines,
    lights: true,
    side,
    vertexColors: o.vertexColors ?? false
  }) as PaperMaterial
  return m
}

/** Depth material for alpha-tested atlas standees (shadow pass). */
export const createCutoutDepthMaterial = (map: Texture, alphaTest = 0.5): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: { map: { value: map }, alphaTest: { value: alphaTest } },
    vertexShader: /* glsl */ `
      #include <common>
      attribute vec4 aFrame;
      varying vec2 vUv;
      void main() {
        vUv = mix(aFrame.xy, aFrame.zw, uv);
        vec3 transformed = position;
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      #include <packing>
      uniform sampler2D map;
      uniform float alphaTest;
      varying vec2 vUv;
      void main() {
        if (texture2D(map, vUv).a < alphaTest) discard;
        gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
      }
    `
  })
