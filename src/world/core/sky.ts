import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry } from 'three'
import { C } from '../art/palette'

/**
 * ─── Sky dome ───────────────────────────────────────────────────────────────
 *
 * A vertical gradient on the inside of a sphere. Deliberately not a cubemap and
 * not an atmospheric-scattering shader: at this art direction the sky's only
 * jobs are to set the ambient key and to give the fog something to blend into,
 * and a two-colour ramp with a slightly raised horizon does both for one draw
 * call and zero texture memory.
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

varying vec3 vLocalPosition;

#include <common>
#include <dithering_pars_fragment>

void main() {
  // pow() on the normalised height compresses the gradient toward the horizon,
  // which is what makes a dome read as sky rather than as a painted ceiling.
  float h = normalize(vLocalPosition).y * 0.5 + 0.5;
  vec3 color = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), uExponent));
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
`

export const createSky = (radius = 900): Mesh => {
  const material = new ShaderMaterial({
    uniforms: {
      uZenith: { value: C.skyZenith.clone() },
      uHorizon: { value: new Color().copy(C.skyHorizon) },
      uExponent: { value: 0.85 }
    },
    vertexShader,
    fragmentShader,
    side: BackSide,
    depthWrite: false,
    fog: false,
    dithering: true
  })

  const sky = new Mesh(new SphereGeometry(radius, 24, 16), material)
  sky.name = 'sky'
  // Always first, never occludes: the dome is drawn before everything with
  // depth writes off, so it costs one untested fullscreen-ish fill.
  sky.renderOrder = -1000
  sky.frustumCulled = false
  sky.userData.perfTag = 'sky'
  return sky
}
