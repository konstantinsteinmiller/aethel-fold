/**
 * ─── Shared GLSL chunks ─────────────────────────────────────────────────────
 *
 * Kept as plain strings rather than registered into `THREE.ShaderChunk`, so the
 * world's shader surgery stays visible in this directory instead of mutating a
 * global three.js table that the 2D game's future self might also touch.
 */

/**
 * Interleaved Gradient Noise (Jimenez, "Next Generation Post Processing in
 * Call of Duty: Advanced Warfare", SIGGRAPH 2014).
 *
 * This is the dither used for the LOD crossfade (GDD §4.3). It matters that it
 * is IGN and not `fract(sin(dot(uv, ...)))` hash noise: IGN is *spatially
 * uniform* — every 3×3 pixel neighbourhood contains a near-even spread of
 * threshold values — so at 50 % fade you get a clean half-tone rather than
 * clumps that read as holes in the object. It's also stable in screen space,
 * so a static camera shows a static pattern instead of boiling.
 */
export const IGN_GLSL = /* glsl */ `
float worldIGN(vec2 p) {
  return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
}
`

/**
 * The fade test itself. Runs first in the fragment shader — discarding before
 * the lighting work is the whole point, since inside a crossfade band we're
 * shading two objects for one silhouette.
 *
 * **`vFade` is signed, and the sign is load-bearing.** Both tiers in a band
 * sample the same IGN at the same pixel, so if both used `ign > fade → discard`
 * they would keep the *identical* half of the pixels and the other half would
 * show background — holes, not a crossfade. The outgoing tier (positive) keeps
 * `[0, c)`; the incoming tier (negative, magnitude `1 − c`) keeps `[c, 1]`.
 * Exactly complementary, 100 % coverage at every point of the transition.
 *
 * `vFade == 1` skips the noise entirely. That's the overwhelmingly common case
 * — an object outside any band — and the branch is coherent across the whole
 * draw, so it costs nothing.
 */
export const FADE_FRAGMENT_GLSL = /* glsl */ `
if (vFade < 0.0) {
  if (worldIGN(gl_FragCoord.xy) < 1.0 + vFade) discard;
} else if (vFade < 0.998) {
  if (worldIGN(gl_FragCoord.xy) > vFade) discard;
}
`

export const FADE_PARS_VERTEX_GLSL = /* glsl */ `
uniform float uFade;
#ifdef USE_INSTANCING
  attribute float aFade;
#endif
varying float vFade;
`

export const FADE_PARS_FRAGMENT_GLSL = /* glsl */ `
varying float vFade;
${IGN_GLSL}
`

/**
 * Instanced fields carry the signed fade per instance and ignore `uFade` — the
 * two can't be combined, because multiplying a signed coverage by a master
 * opacity would silently flip which half of the dither pattern survives.
 */
export const FADE_VERTEX_GLSL = /* glsl */ `
#ifdef USE_INSTANCING
  vFade = aFade;
#else
  vFade = uFade;
#endif
`

/**
 * ─── Wind ───────────────────────────────────────────────────────────────────
 *
 * Two-octave sway phased by world position, weighted per-vertex by `aWind`.
 *
 * Phasing by *world* position rather than by instance id is what stops a forest
 * from breathing in unison — the gust visibly travels across the treeline, which
 * is most of the perceived life in the scene for about 12 instructions.
 *
 * The small downward term matters too: a branch swinging sideways on a fixed
 * radius should shorten its vertical reach. Without it the canopy looks like
 * it's sliding rather than bending.
 */
export const WIND_PARS_VERTEX_GLSL = /* glsl */ `
#ifdef WORLD_WIND
  attribute float aWind;
  uniform float uTime;
  uniform vec2 uWindDir;
  uniform float uWindStrength;
  uniform float uWindSpeed;
#endif
`

export const WIND_VERTEX_GLSL = /* glsl */ `
#ifdef WORLD_WIND
  {
    #ifdef USE_INSTANCING
      vec3 worldSample = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
    #else
      vec3 worldSample = (modelMatrix * vec4(transformed, 1.0)).xyz;
    #endif
    float phase = worldSample.x * 0.17 + worldSample.z * 0.13;
    float sway = sin(uTime * uWindSpeed + phase) * 0.62
               + sin(uTime * uWindSpeed * 1.87 + phase * 2.3) * 0.38;
    float w = aWind * uWindStrength;
    transformed.xz += uWindDir * (sway * w);
    transformed.y -= abs(sway) * w * 0.28;
  }
#endif
`

/**
 * ─── Stylised surface response ──────────────────────────────────────────────
 *
 * Applied to `outgoingLight` after three's toon lighting has run, and it does
 * the two things that separate this from a stock `MeshToonMaterial`:
 *
 * 1. **Shadows fall to periwinkle, never to black** (GDD R4). The mask is on
 *    luminance rather than on the shadow map, so ambient-occluded and
 *    self-shadowed regions get the same treatment as cast shadows — otherwise
 *    the two kinds of dark in the frame don't match.
 *
 * 2. **Fresnel rim** (GDD R5), scaled down in shadow. A rim at full strength on
 *    an unlit surface reads as a glow rather than as a grazing highlight, which
 *    is the classic tell of a cheap cel shader.
 *
 * Relies on `geometryNormal` and `geometryViewDir` being in scope — three
 * declares both in `lights_fragment_begin`, which runs earlier in main().
 */
export const SURFACE_PARS_FRAGMENT_GLSL = /* glsl */ `
uniform vec3 uShadowTint;
uniform float uShadowTintMix;
uniform vec3 uRimColor;
uniform float uRimPower;
uniform float uRimStrength;
`

export const SURFACE_FRAGMENT_GLSL = /* glsl */ `
{
  float worldLum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  float worldShadowMask = 1.0 - smoothstep(0.0, 0.55, worldLum);
  outgoingLight = mix(outgoingLight, outgoingLight * uShadowTint, worldShadowMask * uShadowTintMix);

  float worldFresnel = pow(1.0 - clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0), uRimPower);
  outgoingLight += uRimColor * (worldFresnel * uRimStrength * (0.3 + 0.7 * worldLum));
}
`
