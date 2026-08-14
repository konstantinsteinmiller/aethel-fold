import type { WebGLProgramParametersWithUniforms } from 'three'
import { ToonMaterial, type ToonMaterialOptions } from '../shading/toonMaterial'

/**
 * Terrain shading = the world's toon material plus one thing: a procedural
 * macro-variation term in world XZ.
 *
 * Vertex colours carry the biome blending, but at LOD2/LOD3 the vertices are
 * 8–16 m apart, so all of that variation is gone exactly where the largest area
 * of screen is covered — the far hillsides go flat and plastic. Two octaves of
 * cheap fragment noise, ±8 % on the albedo, restore the impression of ground
 * cover at any tessellation for about ten instructions, and cost no texture
 * (GDD §5.2).
 */

const NOISE_GLSL = /* glsl */ `
varying vec3 vWorldPos;

float terrainHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float terrainNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(terrainHash(i), terrainHash(i + vec2(1.0, 0.0)), u.x),
    mix(terrainHash(i + vec2(0.0, 1.0)), terrainHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
`

const TINT_GLSL = /* glsl */ `
{
  // Three octaves spanning ~30 m down to ~0.6 m. The largest is doing the real
  // work — it's what reads as patches of different ground cover across a
  // hillside — while the smallest only keeps the surface from looking like
  // sheet plastic underfoot.
  float macro = terrainNoise(vWorldPos.xz * 0.035) * 0.5
              + terrainNoise(vWorldPos.xz * 0.31) * 0.32
              + terrainNoise(vWorldPos.xz * 1.7) * 0.18;

  // Contrast expansion, and it is not optional. Summing three independent
  // uniform octaves gives a near-Gaussian with a standard deviation of only
  // ~0.18 — so a nominal ±14 % swing actually delivers ±5 %, which is invisible.
  // The smoothstep pushes that central mass back out to the full range and the
  // stated amplitude becomes the real one.
  macro = smoothstep(0.28, 0.72, macro);

  // ±15 % on value, plus a slight desaturating pull on the bright end so the
  // lighter patches read as sun-bleached grass rather than as brighter paint.
  diffuseColor.rgb *= 0.85 + macro * 0.3;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))), macro * 0.14);
}
`

export class TerrainMaterial extends ToonMaterial {
  constructor(options: ToonMaterialOptions = {}) {
    super({ name: 'terrain', ...options })
  }

  override customProgramCacheKey(): string {
    return `world-terrain|${super.customProgramCacheKey()}`
  }

  override onBeforeCompile(shader: WebGLProgramParametersWithUniforms): void {
    // Chain, don't replace: the base class installs the fade, rim, shadow tint
    // and wind patches, and this only adds the macro variation on top.
    super.onBeforeCompile(shader)

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      // The base class already rewrote this include to prepend the fade/wind
      // block; matching the remaining literal include lands us after both.
      .replace(
        '#include <project_vertex>',
        'vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>'
      )

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${TINT_GLSL}`)

    if (import.meta.env.DEV) {
      // Shader-chunk surgery fails *silently* — a renamed include in a three
      // upgrade just means the replace matches nothing and the effect quietly
      // disappears, with no error anywhere. Recording whether each patch landed
      // makes that checkable from the console instead of guessable from a
      // screenshot.
      this.userData.patched = {
        vertexWorldPos: shader.vertexShader.includes('vWorldPos ='),
        fragmentNoise: shader.fragmentShader.includes('terrainNoise('),
        fragmentTint: shader.fragmentShader.includes('float macro =')
      }
    }
  }

  override clone(): this {
    const copy = new TerrainMaterial({
      color: this.color.clone(),
      vertexColors: this.vertexColors,
      side: this.side,
      name: this.name,
      shadowTintMix: this.uShadowTintMix.value,
      rimStrength: this.uRimStrength.value,
      rimPower: this.uRimPower.value
    })
    copy.uFade.value = this.uFade.value
    return copy as this
  }
}
