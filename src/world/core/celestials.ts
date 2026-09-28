import {
  AdditiveBlending,
  type Color,
  FrontSide,
  Group,
  Mesh,
  PlaneGeometry,
  type Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3
} from 'three'
import { C } from '../art/palette'
import { SKY_RADIUS } from './sky'
import { CLOUD_FUNCTIONS_GLSL, CLOUD_UNIFORMS_GLSL, type CloudUniforms } from './clouds'

/**
 * ─── The two bodies in the sky ──────────────────────────────────────────────
 *
 * `dayCycle.ts` has moved the light, the sky, the fog and the ambient through a
 * full day since this world had a horizon. What it never had was anything to
 * *look at*: the sun was an inference from the direction of the shadows, and
 * the moon was a claim made by a colour temperature. This module draws both.
 *
 * ── What they cost, and why that is the first paragraph ─────────────────────
 *
 * **Two draw calls, two programs, 722 triangles, no texture, no shadow.**
 * Measured in the browser, A/B inside one build by toggling the group: the
 * meadow at the spawn goes 111 → 112 draws with the sun up alone, and 111 → 113
 * at dusk with both bodies in frame; programs 19 → 20 → 21 as each first draws.
 * The budget in GDD §5.2 is 180 draws and about 14 programs and Chapter 1's
 * interior already measures 225, so a sky ornament that cost a pass, a render
 * target or a sort would not be worth having at all. Everything below follows
 * from that:
 *
 * * the sun is **one camera-facing quad** whose disc *and* halo are one
 *   fragment shader — a separate glow mesh is the obvious build and it doubles
 *   the cost of the cheaper of the two objects;
 * * the moon is **one sphere** whose phase is `dot(N, sunDirection)`, so the
 *   crescent is geometry rather than a texture atlas of phases or a second
 *   subtracted disc;
 * * both are **gated on `visible`**, so below the horizon they cost *nothing*
 *   rather than a discarded fill — half of every cycle, that is both of them.
 *
 * ── Why they ride the sky and not the world ─────────────────────────────────
 *
 * Both hang under the sky dome, which `World` already re-centres on the camera
 * every frame. Being children of it, they inherit that for free and are always
 * the same distance from the viewer, which buys three things at once:
 *
 * 1. **They can never clip world geometry.** At 0.955 of the dome's radius they
 *    are outside anything the terrain streamer will ever build, and inside the
 *    dome, so the sky can never be drawn over them.
 * 2. **They are exempt from the LOD contract** (CLAUDE.md rule 7) for the same
 *    reason the dome is, and it is worth stating rather than assuming: LOD
 *    tiers exist to trade triangles against *shrinking screen coverage*, and
 *    these two have constant angular size by construction. There is no distance
 *    at which the sun gets cheaper to draw, so there is no tier to switch to,
 *    and nothing to pop.
 * 3. **They stay out of the shadow pass.** `castShadow`/`receiveShadow` are
 *    left false: a sun that casts a shadow is a contradiction, and either body
 *    inside the cascade fit would blow the shadow frustum out to 800 m.
 *
 * ── Where the light is, and where the moon is ───────────────────────────────
 *
 * The moon is lit by the **true** sun vector, not by the rig's key light, which
 * is the sun's vector flipped once it sets. That distinction is the whole
 * feature: fed the flipped vector every phase would be its own opposite. See
 * `DayCycle.computeLight` for the other half of the argument — the light and
 * the body deliberately do not agree at night, and the reasoning is there.
 *
 * ── Blending ────────────────────────────────────────────────────────────────
 *
 * The sun blends **additively** and the moon **normally**, and they are not
 * interchangeable. A sun is a light: over a dawn sky its core should clip to
 * white and its halo should *brighten* whatever it lies on, which is what
 * additive does and what alpha cannot. A moon is a lit body with a dark side,
 * and the dark side has to be *darker* than the sky behind it or the whole limb
 * disappears and the phase reads as a disc of the wrong size — which additive,
 * being incapable of subtracting, cannot do.
 */

export interface CelestialsOptions {
  /**
   * Distance from the viewer. Just inside the dome — far enough out that no
   * terrain reaches it, near enough in that the dome never covers it.
   */
  radius?: number
  /** Sun disc angular radius, radians. */
  sunAngularRadius?: number
  /** Moon angular radius, radians. */
  moonAngularRadius?: number
}

/**
 * What `Celestials` needs from the cycle.
 *
 * Structural rather than a `DayCycle` import so a test can drive it with an
 * object literal, and so this module has no opinion about who is moving the
 * sky — the same reason `CombatDirector` takes a ground sampler rather than a
 * terrain.
 */
export interface CelestialCycle {
  readonly sunDirection: Vector3
  readonly moonDirection: Vector3
  readonly sunColor: Color
  readonly stats: { readonly daylight: number }
}

/**
 * Angular radius of the sun disc, radians.
 *
 * The real sun is 0.0047 — about ten pixels at this FOV, which is a bright
 * speck rather than a sun. 0.022 puts the disc at ~2.5° across, roughly 50 px
 * on a 1080p frame: big enough to read as a body and to give the halo something
 * to fall off from, small enough that it still reads as *far away*. This is the
 * same lie every stylised sky tells, and the size at which it stops being a lie
 * and starts being a cartoon is about twice this.
 */
const SUN_ANGULAR_RADIUS = 0.022

/**
 * Angular radius of the moon, radians.
 *
 * Larger than the sun's, which reality does not support and the phase requires:
 * the terminator has to cross enough pixels to read as a curve rather than as a
 * jagged edge, and at the sun's size a crescent is four pixels wide.
 */
const MOON_ANGULAR_RADIUS = 0.027

/**
 * How far past the disc the sun's halo reaches, as a multiple of the disc.
 *
 * This sizes the quad, so it is fill rate: 3.2 makes the sun's billboard 8°
 * across, about 1 % of the frame at this FOV, of which the shader discards
 * everything outside the halo before blending.
 */
const SUN_HALO_REACH = 3.2

/** Below this the body is not drawn at all. See the cost note in the header. */
const MIN_VISIBLE_OPACITY = 0.004

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Every size below goes into a geometry that is built once and never checked
 * again, and a NaN one produces a mesh that is *silently* never drawn — three
 * fails the frustum test against a NaN bounding sphere and moves on. Guarded at
 * the constructor rather than trusted (CLAUDE.md).
 */
const positiveOr = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback

/**
 * The sun.
 *
 * One quad, two shapes. `uDisc` is where the body ends as a fraction of the
 * quad's half-width, and the halo runs from there to the quad's edge on a cubed
 * falloff — cubed rather than linear because a linear halo reads as a painted
 * ring with a visible outer edge, and the eye finds that edge instantly against
 * a flat sky.
 */
const sunVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const sunFragmentShader = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uHalo;
uniform float uOpacity;
uniform float uDisc;
uniform float uSoft;
uniform vec3 uBodyDirection;
${CLOUD_UNIFORMS_GLSL}

varying vec2 vUv;

#include <common>
${CLOUD_FUNCTIONS_GLSL}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);

  // The body. The only hard edge in this world that is *supposed* to be hard —
  // uSoft is an anti-aliasing width, not a style, and is a couple of pixels
  // at the size this thing is drawn.
  float disc = 1.0 - smoothstep(uDisc - uSoft, uDisc + uSoft, r);

  // The halo, cubed. Reaches the quad's edge at exactly zero so the billboard's
  // own square boundary can never show.
  float falloff = 1.0 - smoothstep(uDisc, 1.0, r);
  float halo = falloff * falloff * falloff;

  // ── Behind a cloud ────────────────────────────────────────────────────
  //
  // The dome draws the clouds and then this quad draws on top of it, so
  // without this the sun blazes straight through an overcast sky — most
  // visibly at sunset, where a thick bank and a full-strength halo end up in
  // the same fifty pixels.
  //
  // Sampled once per fragment at the body's own direction rather than the
  // fragment's, so the disc dims as a whole instead of having a cloud edge cut
  // across it: the quad is 8° wide and the cloud field is smooth over that, so
  // the difference is invisible and the cost is one field evaluation over ~1 %
  // of the frame. The uniforms are the *same objects* the sky is drawing with
  // (see the note on shared uniforms in clouds.ts), so the two can never
  // disagree about where a cloud is.
  //
  // 0.82 rather than 1.0: an overcast sun is a bright patch, not an absence.
  float behind = 1.0 - cloudAlpha(uBodyDirection) * 0.82;

  float alpha = clamp(disc + halo, 0.0, 1.0) * uOpacity * behind;
  // Most of a 8°-wide quad is empty. Discarding costs a branch and saves the
  // blend, which on a tiler is the expensive half.
  if (alpha < 0.004) discard;

  gl_FragColor = vec4(mix(uHalo, uCore, disc), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/**
 * The moon.
 *
 * World-space normal in the vertex shader, phase in the fragment shader. The
 * normal is `mat3(modelMatrix) * normal` rather than the usual inverse
 * transpose because the body is only ever translated and *uniformly* scaled, so
 * the upper 3×3 is a scale times a rotation and normalising is exact. Getting
 * this wrong on a non-uniform scale would skew the terminator rather than error.
 */
const moonVertexShader = /* glsl */ `
varying vec3 vWorldNormal;
void main() {
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const moonFragmentShader = /* glsl */ `
uniform vec3 uSunDirection;
uniform vec3 uLit;
uniform vec3 uDark;
uniform float uOpacity;
uniform vec3 uBodyDirection;
${CLOUD_UNIFORMS_GLSL}

varying vec3 vWorldNormal;

#include <common>
${CLOUD_FUNCTIONS_GLSL}

void main() {
  // The sun is treated as being at infinity, which is both physically right and
  // the reason this never produces a NaN: the honest normalize(sun - moon)
  // for two bodies at the same radius is 0/0 at new moon, i.e. exactly where a
  // phase shader is most likely to be looked at closely.
  float lambert = dot(normalize(vWorldNormal), uSunDirection);

  // Two soft steps, not one. Everything else in this world is shaded through a
  // three-band toon ramp, and a moon carrying the only smooth gradient on
  // screen reads as an object from a different game. The narrow middle band is
  // the terminator, and it is what makes the disc read as a sphere.
  float band = 0.5 * smoothstep(-0.10, 0.02, lambert) + 0.5 * smoothstep(0.06, 0.28, lambert);

  // Cloud, same as the sun — and taken further here, to 0.94, because a moon
  // is not bright enough to show through anything. See the sun's note.
  float behind = 1.0 - cloudAlpha(uBodyDirection) * 0.94;
  float alpha = uOpacity * behind;
  if (alpha < 0.004) discard;

  gl_FragColor = vec4(mix(uDark, uLit, band), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/**
 * Sun elevation over which the disc is at full strength, and under which it is
 * gone.
 *
 * The lower edge is *below* the horizon rather than at it, so the sun sinks and
 * dims instead of being switched off at the moment it touches the skyline. The
 * terrain occludes it honestly wherever there is terrain — the disc is drawn at
 * 860 m with depth testing on — but over open water there is nothing to hide
 * behind, and the sky dome's horizon is a gradient rather than an edge.
 */
const SUN_FADE_LOW = -0.075
const SUN_FADE_HIGH = 0.01

/** The same, for the moon. */
const MOON_FADE_LOW = -0.06
const MOON_FADE_HIGH = 0.02

/**
 * Daylight over which the moon is not drawn.
 *
 * A daytime moon is real and lovely and this is not it: at these phases most of
 * the disc is the *dark* side, which against a bright blue sky reads as a hole
 * punched in it. It is also the frame where the new moon would cross the sun
 * and put a periwinkle blot in the middle of the halo. Gone by mid-morning,
 * back at dusk.
 */
const MOON_DAYLIGHT_FADE = 0.55

export class Celestials {
  /** Add this to the sky dome. It carries no transform of its own. */
  readonly group = new Group()

  private readonly sun: Mesh
  private readonly moon: Mesh
  private readonly sunMaterial: ShaderMaterial
  private readonly moonMaterial: ShaderMaterial
  private readonly radius: number

  constructor(clouds: CloudUniforms, options: CelestialsOptions = {}) {
    const {
      // 0.955 of the dome. Any closer and a mountain at the far edge of the
      // terrain stream could be drawn in front of the sun from a ridge.
      radius = SKY_RADIUS * 0.955,
      sunAngularRadius = SUN_ANGULAR_RADIUS,
      moonAngularRadius = MOON_ANGULAR_RADIUS
    } = options

    this.radius = positiveOr(radius, SKY_RADIUS * 0.955)
    const sunAngle = positiveOr(sunAngularRadius, SUN_ANGULAR_RADIUS)
    const moonAngle = positiveOr(moonAngularRadius, MOON_ANGULAR_RADIUS)

    this.group.name = 'celestials'
    // Set here as well as by `registerRoot`, matching `sky.ts` — but note that
    // it is `registerRoot` that actually creates the profiler's bucket. A tag
    // written here and never registered reads as a measurement that exists and
    // is always zero, which is worse than an absent one.
    this.group.userData.perfTag = 'celestials'

    // ── Sun ────────────────────────────────────────────────────────────────
    const sunHalfSize = Math.tan(sunAngle) * this.radius * SUN_HALO_REACH
    this.sunMaterial = new ShaderMaterial({
      uniforms: {
        uCore: { value: C.sun.clone() },
        uHalo: { value: C.sunGlow.clone() },
        uOpacity: { value: 0 },
        uDisc: { value: 1 / SUN_HALO_REACH },
        // ~1.4 % of the quad, which is between one and two pixels at the size
        // this is drawn on a 1080p frame — the width an edge needs to stop
        // crawling, and no more.
        uSoft: { value: 0.014 },
        // Rewritten every frame; only has to be finite for the first compile.
        uBodyDirection: { value: new Vector3(0, 1, 0) },
        // By reference. The sky owns these; see `clouds.ts` on why they are
        // shared rather than copied.
        ...clouds
      },
      vertexShader: sunVertexShader,
      fragmentShader: sunFragmentShader,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: FrontSide,
      fog: false
    })
    this.sun = new Mesh(new PlaneGeometry(sunHalfSize * 2, sunHalfSize * 2), this.sunMaterial)
    this.sun.name = 'sun'

    // ── Moon ───────────────────────────────────────────────────────────────
    //
    // 24×16 is the dome's own segmentation, and 720 triangles. At ~60 px across
    // that is far more than the silhouette needs and still less than a single
    // blade of grass; the reason not to go coarser is the terminator, which is a
    // *shading* boundary and shows faceting where a silhouette would hide it.
    this.moonMaterial = new ShaderMaterial({
      uniforms: {
        // Overwritten in place every frame; the initial value only has to be
        // finite so the first compile has something to link against.
        uSunDirection: { value: new Vector3(0, 1, 0) },
        uLit: { value: C.moonDisc.clone() },
        uDark: { value: C.moonDark.clone() },
        uOpacity: { value: 0 },
        uBodyDirection: { value: new Vector3(0, 1, 0) },
        ...clouds
      },
      vertexShader: moonVertexShader,
      fragmentShader: moonFragmentShader,
      transparent: true,
      depthWrite: false,
      side: FrontSide,
      fog: false
    })
    this.moon = new Mesh(new SphereGeometry(Math.tan(moonAngle) * this.radius, 24, 16), this.moonMaterial)
    this.moon.name = 'moon'

    for (const body of [this.sun, this.moon]) {
      // After the dome (−1000) and before the world (0). Both materials are
      // transparent, so three draws them after the opaque pass regardless and
      // the depth buffer already holds the terrain — which is what lets a ridge
      // occlude the setting sun without either body writing depth itself.
      body.renderOrder = -999
      // Off, as on the dome they hang under. Culling would in fact work — both
      // bounding spheres are exact — but it would save at most one draw call
      // for objects already gated on `visible`, at the price of a transform
      // written after the cull in any future reordering silently deleting the
      // sky.
      body.frustumCulled = false
      body.castShadow = false
      body.receiveShadow = false
      body.visible = false
      this.group.add(body)
    }
  }

  /**
   * Places and colours both bodies. Once per frame, after `DayCycle.update`.
   *
   * `cameraQuaternion` is the camera's **world** rotation, which is its local
   * one as long as nothing parents the camera. It billboards the sun; the moon
   * is a sphere and does not care.
   *
   * Allocates nothing: every write below is into an existing `Vector3`, `Color`
   * or uniform slot (GDD §5.2).
   */
  update(cycle: CelestialCycle, cameraQuaternion: Quaternion): void {
    const sunDirection = cycle.sunDirection
    const moonDirection = cycle.moonDirection

    // ── The NaN gate ───────────────────────────────────────────────────────
    //
    // A single non-finite component would put a body at an undefined position,
    // which three renders as *nothing at all* — no warning, no error, and every
    // `elevation < cutoff` below silently false (CLAUDE.md). Summing catches a
    // NaN in any component and an ±Infinity pair as well.
    const sunSum = sunDirection.x + sunDirection.y + sunDirection.z
    const moonSum = moonDirection.x + moonDirection.y + moonDirection.z
    if (!Number.isFinite(sunSum) || !Number.isFinite(moonSum)) {
      this.sun.visible = false
      this.moon.visible = false
      return
    }

    const daylight = Number.isFinite(cycle.stats.daylight) ? cycle.stats.daylight : 1

    // ── Sun ────────────────────────────────────────────────────────────────
    const sunOpacity = smoothstep(SUN_FADE_LOW, SUN_FADE_HIGH, sunDirection.y)
    this.sun.visible = sunOpacity > MIN_VISIBLE_OPACITY
    if (this.sun.visible) {
      this.sun.position.copy(sunDirection).multiplyScalar(this.radius)
      // Camera-aligned rather than aimed at the camera: the two differ by less
      // than a pixel at this distance, and copying a quaternion is cheaper than
      // building a lookAt basis, which would also need a scratch matrix.
      this.sun.quaternion.copy(cameraQuaternion)

      const uniforms = this.sunMaterial.uniforms
      // Whatever the key light is doing — the cycle warms both from the same
      // lerp, so the disc can never disagree with the light it is casting.
      ;(uniforms.uCore!.value as Color).copy(cycle.sunColor)
      // The halo takes most of that warmth but keeps some of its own paler
      // cast, so dawn gives an orange core inside a peach halo rather than one
      // flat orange blob.
      ;(uniforms.uHalo!.value as Color).copy(C.sunGlow).lerp(cycle.sunColor, 0.55)
      // Where the shader asks the cloud field whether this body is hidden.
      ;(uniforms.uBodyDirection!.value as Vector3).copy(sunDirection)
      uniforms.uOpacity!.value = sunOpacity
    }

    // ── Moon ───────────────────────────────────────────────────────────────
    const moonOpacity =
      smoothstep(MOON_FADE_LOW, MOON_FADE_HIGH, moonDirection.y) * (1 - smoothstep(0, MOON_DAYLIGHT_FADE, daylight))
    this.moon.visible = moonOpacity > MIN_VISIBLE_OPACITY
    if (this.moon.visible) {
      this.moon.position.copy(moonDirection).multiplyScalar(this.radius)

      const uniforms = this.moonMaterial.uniforms
      ;(uniforms.uSunDirection!.value as Vector3).copy(sunDirection)
      // The same air that reddens the sun reddens a moon low over the horizon,
      // and by more, because the light has been through it twice. Held to a
      // third of the way to `sunLow` — a fully orange moon reads as a second
      // sun, which is a much stranger thing to see than a warm one.
      const warm = 1 - smoothstep(0.02, 0.3, moonDirection.y)
      ;(uniforms.uLit!.value as Color).copy(C.moonDisc).lerp(C.sunLow, warm * 0.35)
      ;(uniforms.uBodyDirection!.value as Vector3).copy(moonDirection)
      uniforms.uOpacity!.value = moonOpacity
    }
  }

  dispose(): void {
    this.sun.geometry.dispose()
    this.moon.geometry.dispose()
    this.sunMaterial.dispose()
    this.moonMaterial.dispose()
    this.group.clear()
  }
}
