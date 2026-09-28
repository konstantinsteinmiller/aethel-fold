import { Color, Vector2, Vector3, type IUniform } from 'three'
import { C } from '../art/palette'

/**
 * ─── Clouds ─────────────────────────────────────────────────────────────────
 *
 * Three layers of procedural cloud, drawn **inside the sky dome's own fragment
 * shader**. No geometry, no texture, no second pass:
 *
 *     draw calls  +0
 *     programs    +0
 *     triangles   +0
 *     memory      +0
 *
 * That is the whole reason this file is a GLSL *chunk* rather than a class with
 * a mesh in it. The dome is already a full-screen fill that runs before
 * everything and writes no depth, so a cloud composited into it is paid for at
 * exactly the moment the sky was going to be shaded anyway. A billboard field —
 * the obvious alternative, and the one that looks best in a screenshot — is a
 * second full-screen pass of blended transparency, and the budget in GDD §5 has
 * no room for one.
 *
 * ── What the cost actually is, and where it went ────────────────────────────
 *
 * ALU, not bandwidth. Every octave is four hashes, so the honest unit here is
 * *octaves per pixel*, and this spends **six**: two on the cirrus, three on the
 * cumulus, one on the stratus. Two things keep that off most of the screen:
 *
 *   * everything below the horizon returns before sampling anything (`dir.y`
 *     test) — in a level view that is half the dome;
 *   * the layers are evaluated back to front and each one is skipped outright
 *     once the accumulated alpha is opaque.
 *
 * ── Three designs, three speeds ─────────────────────────────────────────────
 *
 * The brief was variation and weather, and both come from the same place: the
 * layers are different *shapes* moving at different *rates*, which is what a
 * sky actually is. One noise field scrolled at one speed reads as a texture
 * sliding across a dome, and no amount of detail fixes it — the tell is that
 * everything stays in the same relative position forever.
 *
 *   | layer   | height | speed | octaves | what it reads as                  |
 *   |---------|-------:|------:|--------:|-----------------------------------|
 *   | cirrus  |   1.00 | 1.00× |       2 | thin, stretched, high, fast       |
 *   | cumulus |   0.55 | 0.42× |       3 | the hero layer: puffy, distinct   |
 *   | stratus |   0.30 | 0.16× |       1 | a slow low bank, mostly near the horizon |
 *
 * The cirrus is stretched **along the wind** rather than being round, which is
 * the single cheapest thing that makes two layers of the same noise look like
 * two different kinds of weather: one anisotropic domain scale, no extra
 * samples.
 *
 * ── The projection, and the one place it breaks ─────────────────────────────
 *
 * Clouds live on a horizontal plane, not on the dome, or they would sit at a
 * fixed angular size and never converge — a sky whose clouds are the same size
 * overhead and at the horizon reads as wallpaper. So the view direction is
 * projected onto a plane at height `h`:
 *
 *     uv = dir.xz * (h / dir.y)
 *
 * which is exact, free, and divides by zero at the horizon. As `dir.y` falls to
 * 0 the domain runs to infinity and the noise aliases into a shimmering band.
 * `HORIZON_FADE` takes the whole field out before that happens, and the divisor
 * is clamped as well so a pixel exactly on the horizon cannot produce a NaN
 * that propagates into the sky colour. Both guards, not one: the clamp alone
 * leaves a visibly repeating smear, and the fade alone still evaluates the
 * noise at absurd coordinates on the way down.
 *
 * ── Lighting ────────────────────────────────────────────────────────────────
 *
 * Density *is* thickness, so the shading is free: a value just over the
 * coverage threshold is a wisp at the edge of a cloud and takes `cloudLit`, and
 * a value well over it is the middle of one and takes `cloudShade`. That is the
 * same three-band logic as the toon ramp, arrived at without a normal — and it
 * is why there is no second noise sample here to find a gradient with.
 *
 * On top of that the half of the sky the sun is in gets a lift, which is what
 * makes a cloudy sunset read as directional rather than as an evenly orange
 * ceiling. One dot product.
 *
 * ── Shared uniforms ─────────────────────────────────────────────────────────
 *
 * `createCloudUniforms()` is called **once** and its uniform objects are handed
 * by reference to the sky *and* to the sun and moon materials. three.js reads
 * `uniform.value` at draw time, so writing it once updates every material that
 * shares the object — and that is what lets the sun and moon be occluded by the
 * same cloud that is drawn over the sky, with no CPU-side copy of the noise and
 * no chance of the two disagreeing about where a cloud is.
 */

/**
 * Below this `dir.y` no cloud is drawn at all, and above `HORIZON_FADE_HIGH` it
 * is at full strength.
 *
 * The low edge is what stops the plane projection's divide-by-zero from ever
 * being visible; the high edge is far enough up that the transition happens
 * over sky rather than at the skyline, where the eye is looking for a seam.
 */
const HORIZON_FADE_LOW = 0.045
const HORIZON_FADE_HIGH = 0.26

/** Metres per second the cumulus layer's domain travels at wind strength 1. */
const BASE_WIND_SPEED = 0.0075

/**
 * How far `uCloudCover` may push a layer's density threshold, either way.
 *
 * The dial biases the threshold rather than scaling the result, so this number
 * is what decides whether the two ends of it are *weather*. It has to be wide
 * enough that 1 closes the sky: an fbm of unit-range noise clusters hard around
 * 0.5, so a bias that only reaches 0.29 leaves a permanently broken sky at the
 * overcast end — measured at 0.59 mean coverage, which reads as "cloudy" and
 * never as "overcast", with no setting that does.
 *
 * At 0.72 the cumulus threshold runs 0.86 (a clear sky with a few wisps) down
 * to 0.14 (closed). Named because it appears three times — in the shared GLSL,
 * in the per-layer block emitted from the table, and in the CPU mirror — and
 * three copies of a tuning constant is three chances to tune one of them.
 */
const COVER_BIAS = 0.72

/**
 * How far the density is stretched about 0.5 before it is thresholded.
 *
 * An fbm of unit-range value noise does not use its range: three octaves with
 * weights summing to 1 pile up around the middle, so almost every sample lands
 * within a whisker of the threshold and the smoothstep that follows spends its
 * whole width there. The result was clouds with no edges -- airbrushed smudges,
 * measurably the softest thing in a game whose art direction is "bevel every
 * cut" and a three-band ramp.
 *
 * Expanding first means `softness` can be small and still anti-alias, which is
 * what buys a crisp silhouette. It costs one multiply-add per layer.
 */
const DENSITY_CONTRAST = 1.9

/**
 * The three designs.
 *
 * `height` is the plane the layer is projected onto, in domain units rather
 * than metres — the absolute scale is arbitrary because `scale` immediately
 * multiplies it, and what matters is the *ratio* between the layers, which is
 * what makes them parallax against each other as the camera turns.
 */
export interface CloudLayer {
  readonly name: string
  readonly height: number
  /** Domain scale. `x` runs along the wind, `y` across it — see the cirrus. */
  readonly scale: readonly [number, number]
  /** Multiplier on the wind speed. The whole point of having three layers. */
  readonly speed: number
  /** Density under which there is no cloud. Higher is a clearer sky. */
  readonly threshold: number
  /** How far past the threshold the edge takes to become solid. */
  readonly softness: number
  /** Peak alpha of this layer on its own. */
  readonly opacity: number
  /**
   * How far this layer is allowed to shade, 0..1.
   *
   * The fourth axis of variation, and the one that stops a thin layer reading as
   * a dark one. Density is used as a proxy for thickness, so any layer that
   * passes its threshold picks up the shade colour -- which is right for a
   * cumulus, whose underside really is darker than the sky, and wrong for
   * cirrus, which is thin enough that the sky lights it from behind and is
   * *brighter* than the blue around it. At 1.0 the streaks came out blue-grey
   * and read as smoke.
   */
  readonly shading: number
}

export const CLOUD_LAYERS: readonly CloudLayer[] = [
  {
    // Highest, fastest, and stretched 4:1 along the wind, which is what makes a
    // cirrus a streak rather than a small cumulus.
    name: 'cirrus',
    height: 1,
    // 1.1 across the wind against 4.2 along it. The ratio is the design; the
    // absolute numbers are what stop it being one enormous sheet -- at [0.42,
    // 1.7] the layer's own threshold contour was a single straight edge running
    // right across the sky, which reads as a gradient someone forgot to blur
    // rather than as high cloud.
    scale: [1.1, 4.2],
    speed: 1,
    // High, so only the top of the density range gets through: cirrus is what
    // is left when a cloud is nearly not there.
    threshold: 0.6,
    softness: 0.115,
    opacity: 0.3,
    // Barely shades: lit from behind, so it stays near cloudLit.
    shading: 0.16
  },
  {
    // The layer the sky is actually read from. Three octaves is one more than
    // anything else here gets, and it buys the lumpy silhouette that says
    // "cloud" rather than "smoke".
    name: 'cumulus',
    height: 0.55,
    scale: [1, 1],
    speed: 0.42,
    threshold: 0.5,
    softness: 0.055,
    opacity: 1,
    // The only layer thick enough to have a real underside.
    shading: 1
  },
  {
    // One octave. A bank this soft has no detail to resolve, and at 0.16× it is
    // nearly stationary — which is exactly what makes the cirrus above it look
    // fast without the cirrus having to move at an implausible rate.
    name: 'stratus',
    height: 0.3,
    scale: [0.5, 0.62],
    speed: 0.16,
    threshold: 0.46,
    softness: 0.20,
    opacity: 0.33,
    shading: 0.55
  }
]

export interface CloudUniforms {
  uCloudTime: IUniform<number>
  uCloudWind: IUniform<Vector2>
  /** 0 clears the sky completely, 1 is overcast. The weather dial. */
  uCloudCover: IUniform<number>
  /** Master fade. Multiplies every layer; 0 removes the whole field. */
  uCloudOpacity: IUniform<number>
  uCloudLit: IUniform<Color>
  uCloudShade: IUniform<Color>
  /** Toward the sun, world space. Only `xz` is used, to lift the sunlit half. */
  uCloudSun: IUniform<Vector3>
}

/**
 * One set of cloud uniforms, to be shared by every material that draws or is
 * occluded by clouds.
 *
 * Call once. Handing the same objects to several materials is the whole
 * mechanism — see the header.
 */
export const createCloudUniforms = (): CloudUniforms => ({
  uCloudTime: { value: 0 },
  // Normalised at rest so a caller that never touches it still gets motion.
  uCloudWind: { value: new Vector2(0.86, 0.51) },
  uCloudCover: { value: 0.5 },
  uCloudOpacity: { value: 1 },
  uCloudLit: { value: new Color().copy(C.cloudLit) },
  uCloudShade: { value: new Color().copy(C.cloudShade) },
  uCloudSun: { value: new Vector3(0, 1, 0) }
})

/**
 * The declarations, for any shader that wants `cloudField` or `cloudAlpha`.
 *
 * Split from the functions below only so a shader can put the uniforms above
 * its own varyings and keep three's `#include`s where they have to be.
 */
export const CLOUD_UNIFORMS_GLSL = /* glsl */ `
uniform float uCloudTime;
uniform vec2 uCloudWind;
uniform float uCloudCover;
uniform float uCloudOpacity;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uCloudSun;
`

/**
 * The field itself.
 *
 * `cloudAlpha(dir)` is how much cloud lies along a view direction, 0..1.
 * `cloudField(dir)` is that plus the colour to draw, premultiplied by nothing —
 * the caller mixes.
 *
 * Both are pure functions of the direction and the uniforms, which is what lets
 * the sun's own shader ask "is there a cloud in front of me" and get the same
 * answer the sky gave for that pixel.
 */

/**
 * One layer's contribution, emitted from the table above.
 *
 * Built here rather than inside the shader template so there is exactly one
 * level of string nesting in this file and it is in a line I can see. The
 * previous shape put a nested template inside the GLSL, and GLSL comments in
 * this project are written with backticks around identifiers -- which end the
 * enclosing template literal and turn the rest of the shader into TypeScript.
 * The compiler's complaint when that happens points at a line 200 below the
 * cause, so: no backticks below this line, and no nested templates above it.
 */
const layerGlsl = (layer: CloudLayer): string => {
  const h = layer.height.toFixed(3)
  const sx = layer.scale[0].toFixed(3)
  const sy = layer.scale[1].toFixed(3)
  const speed = layer.speed.toFixed(3)
  const threshold = layer.threshold.toFixed(3)
  const softness = layer.softness.toFixed(3)
  const opacity = layer.opacity.toFixed(3)
  const shading = layer.shading.toFixed(3)
  return [
    '  // -- ' + layer.name + ' --',
    '  cover = cloudLayer(dir, ' + h + ', vec2(' + sx + ', ' + sy + '), ' + speed + ', ' + threshold + ', ' + softness + ', density) * ' + opacity + ';',
    '  if (cover > 0.002 && alpha < 0.998) {',
    '    edge = ' + threshold + ' - (uCloudCover - 0.5) * ' + COVER_BIAS.toFixed(3) + ';',
    '    added = cover * (1.0 - alpha);',
    '    alpha += added;',
    '    color += cloudShadeOf(density, edge, ' + shading + ', sunLift) * added;',
    '  }'
  ].join('\n')
}

const LAYERS_GLSL = CLOUD_LAYERS.map(layerGlsl).join('\n\n')

/**
 * The field itself.
 *
 * `cloudAlpha(dir)` is how much cloud lies along a view direction, 0..1.
 * `cloudField(dir)` is that plus the colour, as **straight** (non-premultiplied)
 * alpha, so the caller composites with a single mix().
 *
 * Both are pure functions of the direction and the uniforms, which is what lets
 * the sun's own shader ask "is there a cloud in front of me" and get the same
 * answer the sky gave for that pixel.
 */
export const CLOUD_FUNCTIONS_GLSL = /* glsl */ `
float cloudHash(vec2 p) {
  // Two fract()s and a self-dot. Cheap, and stable across the drivers this
  // ships to -- a sin()-based hash is a couple of instructions shorter and
  // decomposes into visible banding on some mobile GPUs at these domain sizes.
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float cloudNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  // Smoothstep the interpolant, not the result: a linear lerp between lattice
  // values leaves the lattice visible as diamond creases, which at cloud scale
  // is a grid across the sky.
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = cloudHash(i);
  float b = cloudHash(i + vec2(1.0, 0.0));
  float c = cloudHash(i + vec2(0.0, 1.0));
  float d = cloudHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Octave counts are fixed at 1, 2 and 3, so these are written out rather than
// looped -- a loop would only cost the driver a decision it already has.
float cloudFbm2(vec2 p) {
  return cloudNoise(p) * 0.65 + cloudNoise(p * 2.17 + 19.3) * 0.35;
}

float cloudFbm3(vec2 p) {
  return cloudNoise(p) * 0.53
       + cloudNoise(p * 2.11 + 11.7) * 0.31
       + cloudNoise(p * 4.09 + 41.1) * 0.16;
}

// View direction to a point on a horizontal plane at height h. The clamp on the
// divisor is a NaN guard, not a look: the caller has already faded the field out
// well above the angle at which it starts to matter.
vec2 cloudPlane(vec3 dir, float h) {
  return dir.xz * (h / max(dir.y, 0.05));
}

// How far up the sky a direction is, faded so the horizon is never sampled.
float cloudHorizonFade(vec3 dir) {
  return smoothstep(HORIZON_LOW, HORIZON_HIGH, dir.y);
}

// Coverage of one layer. uCloudCover biases the threshold rather than scaling
// the result, so turning the weather up grows the clouds outward from where they
// already are instead of fading a fixed shape in -- the difference between a sky
// clouding over and a sky having its opacity animated.
float cloudLayer(vec3 dir, float h, vec2 scale, float speed, float threshold, float softness, out float density) {
  vec2 drift = uCloudWind * (uCloudTime * speed);
  vec2 uv = cloudPlane(dir, h) * scale + drift;
  float raw = (h > 0.9) ? cloudFbm2(uv) : ((h > 0.4) ? cloudFbm3(uv) : cloudNoise(uv));
  // Stretch about the middle before thresholding -- see DENSITY_CONTRAST.
  density = clamp((raw - 0.5) * DENSITY_CONTRAST + 0.5, 0.0, 1.0);
  float edge = threshold - (uCloudCover - 0.5) * COVER_BIAS;
  return smoothstep(edge, edge + softness, density);
}

// Colour a layer from its own density: thin edges lit, thick cores shaded.
//
// Quantised, because everything else in this world is. A cloud carrying the only
// smooth gradient on screen reads as an object from a different game -- the same
// argument the moon's terminator is banded for. Three bands with a soft step
// between them: the step is an anti-aliasing width, not a style, and without it
// the band boundaries crawl across the sky as the layer drifts.
vec3 cloudShadeOf(float density, float edge, float shading, vec3 sunLift) {
  float core = smoothstep(edge, edge + 0.34, density) * shading;
  float bands = 3.0;
  float q = floor(core * bands) / bands;
  float f = fract(core * bands);
  core = min(q + smoothstep(0.35, 0.65, f) / bands, 1.0);
  return mix(uCloudLit, uCloudShade, core * 0.85) + sunLift;
}

// The whole field along a direction. rgb is premultiplied by a.
//
// Composited far to near -- cirrus, then cumulus, then the low stratus bank on
// top -- because that is the order they are actually in, and compositing them
// the other way puts the high thin layer over the near thick one.
vec4 cloudField(vec3 dir) {
  float sky = cloudHorizonFade(dir);
  if (sky <= 0.001 || uCloudOpacity <= 0.001) {
    return vec4(0.0);
  }

  // Which half of the sky the sun is in. One dot, and it is what stops an
  // overcast sunset from being a uniformly orange ceiling.
  vec2 sunAz = normalize(uCloudSun.xz + vec2(1e-5, 0.0));
  float toSun = dot(normalize(dir.xz + vec2(1e-5, 0.0)), sunAz);
  vec3 sunLift = uCloudLit * (max(toSun, 0.0) * 0.10 * max(uCloudSun.y + 0.25, 0.0));

  vec3 color = vec3(0.0);
  float alpha = 0.0;
  float density = 0.0;
  float cover = 0.0;
  float edge = 0.0;
  float added = 0.0;

LAYERS_PLACEHOLDER

  float a = clamp(alpha, 0.0, 1.0) * sky * uCloudOpacity;
  // ── Straight alpha, not premultiplied ───────────────────────────────────
  //
  // color was accumulated weighted by each layer's contribution, so dividing by
  // the running alpha turns it back into the field's average colour. It must be
  // handed back that way, because every caller composites with mix(), which
  // multiplies by the alpha itself.
  //
  // This returned (color * a) once, i.e. premultiplied, and mix() then applied the
  // alpha a second time: a cirrus at a = 0.3 contributed 0.09 of its colour over
  // a sky scaled to 0.7, so thin high cloud came out *darker* than the sky it
  // was drawn on and read as smoke. Nothing errored; it just looked wrong, and
  // it looked wrong in a way that is easy to mistake for a shading choice.
  return vec4(color / max(alpha, 1e-4), a);
}

// Coverage only, for callers that just need to know if they are hidden.
float cloudAlpha(vec3 dir) {
  return cloudField(dir).a;
}
`
  // A *global* regex, not a bare string. Every one of these names appears in
  // the shader more than once -- at least in the code and in the comment above
  // it -- and a string `replace` substitutes the first only. That shipped once:
  // the comment became
  // "see 1.900" and the identifier a line below it survived into the GLSL, where
  // it is an undeclared identifier. three reports that as a console *warning*
  // and hands back a material that draws nothing, so the type-check passed, the
  // suite passed, and the sky went black. `tests/world/clouds.test.ts` now
  // asserts that none of these names survives.
  .replace(/COVER_BIAS/g, COVER_BIAS.toFixed(3))
  .replace(/DENSITY_CONTRAST/g, DENSITY_CONTRAST.toFixed(3))
  .replace(/HORIZON_LOW/g, HORIZON_FADE_LOW.toFixed(3))
  .replace(/HORIZON_HIGH/g, HORIZON_FADE_HIGH.toFixed(3))
  .replace(/LAYERS_PLACEHOLDER/g, LAYERS_GLSL)

/** Scratch, so the per-frame update allocates nothing (GDD §5.2). */
const _lit = new Color()
const _shade = new Color()

/**
 * Moves the sky on. Call once a frame with the frame's delta in seconds.
 *
 * `wind` is a *strength*, not a speed in metres — it multiplies the per-layer
 * rates in `CLOUD_LAYERS`, which are the things that carry the relative motion.
 */
export const advanceClouds = (uniforms: CloudUniforms, delta: number, wind = 1): void => {
  if (!Number.isFinite(delta) || !Number.isFinite(wind)) {
    return
  }
  uniforms.uCloudTime.value += delta * wind * BASE_WIND_SPEED
  // Wrapped, and generously: the domain is unbounded and a float that has been
  // adding a small number for an hour loses the precision the noise lattice
  // needs, which shows up as the clouds visibly quantising into steps. 4096 is
  // far past any period the eye can follow and well inside float32's exact
  // integer range.
  if (uniforms.uCloudTime.value > 4096) {
    uniforms.uCloudTime.value -= 4096
  }
}

/**
 * Tints the field for the time of day.
 *
 * Takes the same three shaped numbers `DayCycle` already computes for the sky —
 * so a cloud cannot end up lit for a different hour than the sky behind it,
 * which is the failure a second copy of this arithmetic would eventually
 * produce.
 *
 * `day` is 0 at night and 1 in full daylight, `golden` peaks at the horizon,
 * and `sunDirection` points at the true sun (below the horizon at night).
 */
export const applyCloudLighting = (
  uniforms: CloudUniforms,
  day: number,
  golden: number,
  sunDirection: { x: number; y: number; z: number }
): void => {
  _lit.copy(C.cloudLitNight).lerp(C.cloudLit, day).lerp(C.cloudLitWarm, golden)
  _shade.copy(C.cloudShadeNight).lerp(C.cloudShade, day).lerp(C.cloudShadeWarm, golden)
  uniforms.uCloudLit.value.copy(_lit)
  uniforms.uCloudShade.value.copy(_shade)
  uniforms.uCloudSun.value.set(sunDirection.x, sunDirection.y, sunDirection.z)
}

/**
 * Where the clouds are along a direction, on the CPU.
 *
 * **Not** used by the renderer — the shader is the only thing that draws them,
 * and this is deliberately not wired into it. It exists so the behaviour that
 * matters can be asserted without a GL context: that coverage responds to the
 * weather dial, that the field is gone below the horizon, and that the three
 * layers move at different rates. Keeping it honest is the job of
 * `tests/world/clouds.test.ts`, which pins it against the GLSL constants above
 * rather than against a second set of numbers.
 */
export const cloudCoverageAt = (
  uniforms: CloudUniforms,
  dir: { x: number; y: number; z: number }
): number => {
  const length = Math.hypot(dir.x, dir.y, dir.z)
  if (!Number.isFinite(length) || length < 1e-6) {
    return 0
  }
  const y = dir.y / length
  const sky = smoothstep(HORIZON_FADE_LOW, HORIZON_FADE_HIGH, y)
  if (sky <= 0.001 || uniforms.uCloudOpacity.value <= 0.001) {
    return 0
  }
  const x = dir.x / length
  const z = dir.z / length
  const wind = uniforms.uCloudWind.value
  const time = uniforms.uCloudTime.value

  let alpha = 0
  for (const layer of CLOUD_LAYERS) {
    const scaleDivisor = Math.max(y, 0.05)
    const u = (x * (layer.height / scaleDivisor)) * layer.scale[0] + wind.x * time * layer.speed
    const v = (z * (layer.height / scaleDivisor)) * layer.scale[1] + wind.y * time * layer.speed
    const raw = layer.height > 0.9 ? fbm2(u, v) : layer.height > 0.4 ? fbm3(u, v) : noise2(u, v)
    const density = Math.min(1, Math.max(0, (raw - 0.5) * DENSITY_CONTRAST + 0.5))
    const edge = layer.threshold - (uniforms.uCloudCover.value - 0.5) * COVER_BIAS
    const cover = smoothstep(edge, edge + layer.softness, density) * layer.opacity
    alpha = alpha + cover * (1 - alpha)
  }
  return Math.min(1, Math.max(0, alpha)) * sky * uniforms.uCloudOpacity.value
}

// ── The CPU mirror of the GLSL above ───────────────────────────────────────
//
// Same hash, same interpolant, same octave weights. It is a mirror and mirrors
// drift, which is why nothing in the render path reads it and why the suite
// asserts *properties* (monotonic in cover, zero below the horizon, different
// per-layer rates) rather than exact values a shader would have to match.

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

const fract = (v: number): number => v - Math.floor(v)

const hash2 = (x: number, y: number): number => {
  let p0 = fract(x * 0.1031)
  let p1 = fract(y * 0.1031)
  let p2 = fract(x * 0.1031)
  const d = p0 * (p1 + 33.33) + p1 * (p2 + 33.33) + p2 * (p0 + 33.33)
  p0 = fract(p0 + d)
  p1 = fract(p1 + d)
  p2 = fract(p2 + d)
  return fract((p0 + p1) * p2)
}

const noise2 = (x: number, y: number): number => {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash2(ix, iy)
  const b = hash2(ix + 1, iy)
  const c = hash2(ix, iy + 1)
  const d = hash2(ix + 1, iy + 1)
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy
}

const fbm2 = (x: number, y: number): number =>
  noise2(x, y) * 0.65 + noise2(x * 2.17 + 19.3, y * 2.17 + 19.3) * 0.35

const fbm3 = (x: number, y: number): number =>
  noise2(x, y) * 0.53 +
  noise2(x * 2.11 + 11.7, y * 2.11 + 11.7) * 0.31 +
  noise2(x * 4.09 + 41.1, y * 4.09 + 41.1) * 0.16
