import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry } from 'three'
import { C } from '../art/palette'
import { CLOUD_FUNCTIONS_GLSL, CLOUD_UNIFORMS_GLSL, createCloudUniforms, type CloudUniforms } from './clouds'

/**
 * ─── Sky dome ───────────────────────────────────────────────────────────────
 *
 * A vertical gradient on the inside of a sphere, with three layers of
 * procedural cloud composited over it. Deliberately not a cubemap and not an
 * atmospheric-scattering shader: at this art direction the sky's only jobs are
 * to set the ambient key and to give the fog something to blend into, and a
 * two-colour ramp with a slightly raised horizon does both for one draw call
 * and zero texture memory.
 *
 * The clouds are in **this** shader rather than in a mesh of their own, and
 * `clouds.ts` explains at length why. The short version is that this pass is
 * already paid for: the dome is a full-screen fill that runs first and writes
 * no depth, so a cloud composited into it costs ALU on pixels that were going
 * to be shaded anyway, where a billboard field would cost a second full-screen
 * pass of blended transparency. Draw calls, programs and triangles are all
 * unchanged by the clouds being here.
 *
 * `dithering` is on because an 8-bit vertical gradient across 1080 pixels bands
 * visibly — the one place in this world where a *smooth* gradient is wanted,
 * ironically, and the only place three's ordered dither is worth its cost.
 */

const vertexShader = /* glsl */ `
varying vec3 vLocalPosition;
void main() {
  vLocalPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uExponent;
${CLOUD_UNIFORMS_GLSL}

varying vec3 vLocalPosition;

#include <common>
#include <dithering_pars_fragment>
${CLOUD_FUNCTIONS_GLSL}

void main() {
  vec3 dir = normalize(vLocalPosition);

  // pow() on the normalised height compresses the gradient toward the horizon,
  // which is what makes a dome read as sky rather than as a painted ceiling.
  float h = dir.y * 0.5 + 0.5;
  vec3 color = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), uExponent));

  // Over the gradient, never through it: the dome is opaque and the cloud is an
  // alpha the sky shows through, so a thin cirrus takes the zenith's blue with
  // it and a thick cumulus does not. Compositing here rather than blending a
  // second surface is what keeps this at one pass.
  vec4 clouds = cloudField(dir);
  color = mix(color, clouds.rgb, clouds.a);

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
`

/**
 * Default dome radius, exported because the sun and the moon have to know it.
 *
 * `celestials.ts` hangs both bodies *inside* the dome at a fraction of this, so
 * a number that used to live only in a default argument is now a contract
 * between two files — and the failure mode if they disagree is a sun rendered
 * behind the sky, which is invisible rather than obviously wrong.
 */
export const SKY_RADIUS = 900

/**
 * The dome, carrying the cloud uniforms it draws with.
 *
 * A `Mesh` with one property added rather than a `{ mesh, clouds }` pair,
 * because three call sites already hold the return of `createSky` *as a mesh* —
 * they add it to a scene, register it with the profiler, park it on the camera
 * and dispose it — and only one of them has any interest in the weather. A pair
 * would rewrite all three to reach through `.mesh` so that one of them could
 * reach `.clouds`.
 *
 * The uniforms are handed on to `Celestials` **by reference**, so the sun and
 * the moon are occluded by the same cloud the sky is drawing, from one set of
 * numbers. See the note on shared uniforms in `clouds.ts`.
 */
export interface SkyMesh extends Mesh {
  readonly clouds: CloudUniforms
}

export const createSky = (radius = SKY_RADIUS): SkyMesh => {
  const clouds = createCloudUniforms()
  const material = new ShaderMaterial({
    uniforms: {
      uZenith: { value: C.skyZenith.clone() },
      uHorizon: { value: new Color().copy(C.skyHorizon) },
      uExponent: { value: 0.85 },
      // Spread by reference on purpose — see `Sky.clouds`.
      ...clouds
    },
    vertexShader,
    fragmentShader,
    side: BackSide,
    depthWrite: false,
    fog: false,
    dithering: true
  })

  const mesh = new Mesh(new SphereGeometry(radius, 24, 16), material)
  mesh.name = 'sky'
  // Always first, never occludes: the dome is drawn before everything with
  // depth writes off, so it costs one untested fullscreen-ish fill.
  mesh.renderOrder = -1000
  mesh.frustumCulled = false
  mesh.userData.perfTag = 'sky'
  // Assigned after construction, so the cast goes through `unknown`: `Mesh` has
  // no `clouds` and TypeScript is right to say the two do not overlap yet.
  const sky = mesh as unknown as SkyMesh
  ;(sky as { clouds: CloudUniforms }).clouds = clouds
  return sky
}
