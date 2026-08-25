/**
 * ─── Grass in the vertex shader ─────────────────────────────────────────────
 *
 * The patch geometry (`bladeGeometry.ts`) is one shared, baked cluster of blades
 * standing at the origin. Everything that turns it into *this* patch of *this*
 * meadow happens here, from a 48-byte instance stream:
 *
 *   aGrassA = (originX, originZ, h00, h10)
 *   aGrassB = (h01,     h11,     hash, density)
 *   aGrassC = (tintR,   tintG,   tintB, fade)
 *
 * There is deliberately **no instance matrix**. The mesh is a plain `Mesh` with
 * an `InstancedBufferGeometry`, which three renders instanced without defining
 * `USE_INSTANCING` — so no `instanceMatrix` attribute is bound, no 4×4 multiply
 * runs per vertex, and the per-instance cost is 48 bytes instead of 64 for data
 * that is richer than a transform.
 *
 * Six things happen to every vertex, in this order, and each one is here because
 * removing it produces a specific, nameable artefact:
 *
 * 1. **Toroidal root shift + yaw offset by patch hash.** Without it, one baked
 *    layout stamped across the world tiles at 4 m and the eye finds the grid
 *    instantly. `fract()` on the *root* (identical across a blade's vertices, so
 *    the blade moves whole) costs three instructions and the repetition is gone.
 * 2. **Bilinear terrain height from four corner heights.** A patch is 4 m, and
 *    the world's terrain has a 170 m feature size, so the interpolation error is
 *    centimetres. This is what removes the alternative — a per-blade height
 *    lookup, which would mean either a streamed heightmap texture or a per-blade
 *    CPU sample, and both cost more than the entire rest of this system.
 * 3. **Wind as a rotation about the root, not a translation.** A translated blade
 *    shears: its tip slides sideways while its length stays the same, which reads
 *    as the grass being dragged rather than bent. The vertical shortening term
 *    (`y -= bend² · t² · 0.5`) is the cheap approximation to arc length that
 *    makes it read as a bend.
 * 4. **Minimum screen width.** A 3 cm blade at 90 m is a fraction of a pixel and
 *    flickers on and off with sub-pixel camera motion — the single most visible
 *    failure mode a grass field has. Widening to a floor of `uMinPixels` screen
 *    pixels (using the same `uUnitsPerPixel` the outlines hold their 1.6 px with)
 *    trades a slightly fatter distant blade for a horizon that holds still.
 * 5. **Normals blended toward the ground normal** at 0.6 (GDD R3). Geometric
 *    blade normals are correct and make a meadow look like litter, because every
 *    blade lands in a different band of the toon ramp. Blending toward the
 *    surface the grass grows out of makes the sward take the light as one
 *    surface — which is what it visually is.
 * 6. **Height taper at the cull edge.** Grass sinks into the ground over the last
 *    tier's band rather than vanishing at a radius, so there is no circle of lawn
 *    following the player.
 */

export const GRASS_PARS_VERTEX_GLSL = /* glsl */ `
attribute vec4 aBlade;   // (rootX, rootZ, hash01, yaw)
attribute vec3 aShape;   // (t along blade, dz/dy of the blade curve, blade ordinal)
attribute vec4 aGrassA;  // (originX, originZ, h00, h10)
attribute vec4 aGrassB;  // (h01, h11, patchHash01, density01)
// aGrassC.w is spare. It carried the CPU-computed live blade count until the
// ramp moved into the shader; the slot is kept so the stream stays three clean
// vec4s, which is what lets it interleave as one buffer.
attribute vec4 aGrassC;  // (tint.rgb, reserved)

uniform float uPatchSize;
uniform float uBladeWidth;
uniform float uWidthScale;
uniform float uMinPixels;
uniform float uUnitsPerPixel;
uniform float uFaceCamera;
uniform float uCullNear;
uniform float uCullFar;
// Per tier: (rampStart, rampEnd, bladesAtStart, bladesAtEnd), in metres/blades.
uniform vec4 uTierRamp;
uniform float uFadeFraction;
uniform float uGrassWind;
uniform float uTipLift;
// Per tier: 0 skips the wind block entirely. Uniform across the draw call, so
// the branch is free on every tier that takes it either way.
uniform float uBladeWind;
uniform float uWindNear;
uniform float uWindFar;
// Additive warmth at the tip, derived from the palette rather than written as a
// literal — no hex, and no numeric colour, anywhere but \`art/palette.ts\`.
uniform vec3 uGrassTipWarm;

// Declared here rather than inherited from WIND_PARS_VERTEX_GLSL, which is
// gated behind WORLD_WIND. Grass sets \`wind: false\` on its material because it
// does not use the generic \`aWind\` sway — a per-vertex weight is the wrong model
// for something whose bend is a function of height along a blade — so it owns
// these three, and the material asserts the define is absent to keep them from
// ever being declared twice.
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindSpeed;

varying vec3 vGrassTint;

// One cheap hash, reused for every per-blade decision. Deterministic in the
// blade's own hash and the patch's, so a blade is stable frame to frame — a
// time-varying hash here would make the meadow boil.
float grassHash(float a, float b) {
  return fract(sin(a * 91.3458 + b * 47.9898) * 43758.5453);
}
`

/**
 * Runs where `beginnormal_vertex` would. Everything downstream —
 * `defaultnormal_vertex`, `begin_vertex`, `project_vertex`, the fade, the fog —
 * then behaves exactly as it does for any other object in the world.
 */
export const GRASS_COMPUTE_GLSL = /* glsl */ `
vec3 wGrassPos;
vec3 wGrassNormal;

{
  float patchHash = aGrassB.z;
  float t = aShape.x;

  // ── 1. Per-patch decorrelation ─────────────────────────────────────────────
  // The root wraps inside the patch, so a blade moves whole and the 4 m stamp
  // stops repeating. Yaw picks up the same hash so orientation decorrelates too.
  vec2 root = fract(aBlade.xy / uPatchSize + vec2(patchHash, patchHash * 0.7371)) * uPatchSize;
  float yaw = aBlade.w + patchHash * 6.2831853;

  float bladeHash = grassHash(aBlade.z, patchHash);

  // ── 2. Ground, from the patch's four corner heights ────────────────────────
  vec2 uvp = clamp(root / uPatchSize, 0.0, 1.0);
  float hx0 = mix(aGrassA.z, aGrassA.w, uvp.x);
  float hx1 = mix(aGrassB.x, aGrassB.y, uvp.x);
  float ground = mix(hx0, hx1, uvp.y);

  // The same four corners give the surface gradient for free, which is both the
  // normal the blade blends toward and the reason grass on a slope leans with
  // the hill instead of standing on it like bristles.
  float dhx = (mix(aGrassA.w, aGrassB.y, uvp.y) - mix(aGrassA.z, aGrassB.x, uvp.y)) / uPatchSize;
  float dhz = (mix(aGrassB.x, aGrassB.y, uvp.x) - mix(aGrassA.z, aGrassA.w, uvp.x)) / uPatchSize;
  vec3 groundNormal = normalize(vec3(-dhx, 1.0, -dhz));

  vec3 worldRoot = vec3(aGrassA.x + root.x, ground, aGrassA.y + root.y);
  float depth = distance(worldRoot, cameraPosition);

  // ── The density ramp, which is this system's LOD ──────────────────────────
  //
  // How many blades this patch stands, as a continuous function of distance:
  // uTierRamp is (start, end, bladesAtStart, bladesAtEnd) for the tier this draw
  // call belongs to, and aGrassB.w is the patch's own suitability. A blade is
  // drawn iff its ordinal falls under the result.
  //
  // Evaluated from **this blade's** depth, not the patch's. A patch is 4 m and
  // the near ramp sheds ~54 blades a metre, so a per-patch evaluation put a 20 %
  // density step on a 4 m grid directly in front of the player. Four extra
  // instructions remove the grid entirely.
  //
  // The divisor is what makes this a ramp rather than a staircase: the blades
  // straddling the threshold are *part height* and grow out of / sink into the
  // ground, so a blade is never added or removed in one frame. It is a fraction
  // of the live count rather than a constant, because a constant is a constant
  // in the wrong space — see FADE_FRACTION in config.ts, where a fixed 2.5
  // blades measured as a 12 ms transition in the near field.
  //
  // Both the ramp and the window are continuous across a tier boundary, which is
  // why grass needs no dithered crossfade: there is no discontinuity to hide.
  float rampK = clamp((depth - uTierRamp.x) / max(uTierRamp.y - uTierRamp.x, 1e-4), 0.0, 1.0);
  float live = mix(uTierRamp.z, uTierRamp.w, rampK) * aGrassB.w;
  float alive = clamp((live - aShape.z) / max(live * uFadeFraction, 1.0), 0.0, 1.0);
  float heightMul = alive * (0.70 + 0.62 * bladeHash);

  // 6. Sink into the ground over the last band rather than vanishing at a radius.
  heightMul *= 1.0 - smoothstep(uCullNear, uCullFar, depth);

  // ── Blade frame ───────────────────────────────────────────────────────────
  vec2 fwd = vec2(sin(yaw), cos(yaw));
  vec2 side = vec2(fwd.y, -fwd.x);

  // The coarse tiers turn their blades toward the viewer. One wide triangle
  // standing in for a whole tuft cannot be allowed to go edge-on — it would
  // disappear, and a tuft that vanishes when you turn your head is far more
  // visible than one that is slightly too flat. Near tiers keep their own yaw
  // (uFaceCamera = 0), where there are enough blades for the average to hold.
  if (uFaceCamera > 0.0) {
    vec2 toCam = cameraPosition.xz - worldRoot.xz;
    float toCamLen = length(toCam);
    if (toCamLen > 0.0001) {
      toCam /= toCamLen;
      vec2 camSide = vec2(toCam.y, -toCam.x);
      camSide *= sign(dot(camSide, side) + 1e-5);
      side = normalize(mix(side, camSide, uFaceCamera));
      fwd = vec2(-side.y, side.x);
    }
  }

  // ── 4. Minimum screen width ───────────────────────────────────────────────
  // uWidthScale is the detail level's density compensation, applied here rather
  // than baked, so that changing level costs a uniform write instead of six
  // geometry rebuilds.
  float minWorldWidth = uMinPixels * uUnitsPerPixel * depth;
  float widthMul = uWidthScale * clamp(minWorldWidth / max(uBladeWidth, 1e-5), 1.0, 4.5);
  // Width follows the density ramp too, so a blade crossing the live threshold
  // grows *uniformly* rather than unfolding from a squat full-width stub. It
  // deliberately does NOT follow the horizon taper: there the blade should sink
  // into the ground at full width, which is what makes the far edge read as
  // mown sward rather than as grass being deleted.
  vec3 local = vec3(position.x * widthMul * alive, position.y * heightMul, position.z * heightMul);

  // ── 3. Wind: two travelling octaves, and only in the near field ───────────
  //
  // Phased by *world* position, so a gust visibly crosses the meadow instead of
  // the whole field breathing in unison — the same argument the tree wind makes,
  // and the effect is far stronger here because grass is a continuous surface.
  //
  // It fades out with distance and stops entirely past uWindFar. At 50 m a blade
  // is two or three pixels wide, and moving it a fraction of a pixel per frame
  // does not read as wind — it reads as sparkle, which is the one artefact the
  // screen-width floor cannot fix because the problem is the motion rather than
  // the size. A still far field is calmer, and it makes the near field's motion
  // read as *nearer*.
  //
  // uBladeWind is 0 for every tier whose whole range sits past uWindFar, so this
  // branch is uniform across those draw calls and the block below — two sin
  // calls and about fifteen operations — is never taken for the 75 % of patches
  // that live out there.
  float bend = 0.0;
  float lever = t * t;
  vec2 sway = vec2(0.0);
  float rise = 0.0;

  if (uBladeWind > 0.0) {
    float windFade = 1.0 - smoothstep(uWindNear, uWindFar, depth);
    float gustPhase = dot(worldRoot.xz, uWindDir) * 0.09 - uTime * uWindSpeed * 1.35;
    float gust = sin(gustPhase) * 0.6 + sin(gustPhase * 2.13 + 1.7) * 0.4;
    // Per-blade stiffness, so a tuft does not move as one rigid plate.
    float stiffness = 0.55 + 0.75 * bladeHash;
    bend = uGrassWind * windFade * stiffness * (gust + 0.32);
    // Quadratic in t: the root is anchored and the tip carries the whole travel.
    sway = uWindDir * (bend * lever * local.y);
    // A touch of lift at the tip keeps blades from looking pinned when the wind
    // drops to zero — the near sward should never be perfectly flat.
    rise = uTipLift * windFade * lever * local.y * (0.5 + 0.5 * sin(uTime * 0.9 + bladeHash * 6.28));
  }

  vec3 offset = vec3(
    side.x * local.x + fwd.x * local.z + sway.x,
    local.y,
    side.y * local.x + fwd.y * local.z + sway.y
  );
  // Bending shortens vertical reach. Without this the blade stretches as it
  // leans and the field looks like it is being pulled rather than blown.
  offset.y -= bend * bend * lever * local.y * 0.5;
  offset.y += rise;

  wGrassPos = worldRoot + offset;

  // ── 5. Normal ─────────────────────────────────────────────────────────────
  // Blade-local normal is exactly normalize(0, -dz/dy, 1) for the baked curve —
  // see bladeGeometry.ts. Rotate it into the blade's frame, tilt it with the
  // wind bend, then blend toward the ground.
  // (No backticks anywhere below this line: this comment lives inside a template
  // literal, and one would close the string and take the module out with it.)
  vec3 nLocal = normalize(vec3(0.0, -aShape.y, 1.0));
  vec3 nWorld = vec3(
    side.x * nLocal.x + fwd.x * nLocal.z,
    nLocal.y,
    side.y * nLocal.x + fwd.y * nLocal.z
  );
  nWorld = normalize(nWorld - vec3(uWindDir.x, 0.0, uWindDir.y) * (bend * t * 0.7));
  // GDD R3: ground scatter blends toward the surface it grows from at 0.6.
  wGrassNormal = normalize(mix(nWorld, groundNormal, 0.6));

  // ── Colour ────────────────────────────────────────────────────────────────
  // Root dark, tip light and slightly warm. This is the whole of the grass's
  // interior detail — there is no texture and no per-vertex colour attribute,
  // just a gradient along t times the ground colour sampled where the patch
  // stands, which is what guarantees the blades can never read as pasted onto a
  // terrain of a different green.
  // The exponent is below 2 on purpose: a squared ramp keeps the lower two
  // thirds of the blade near the root colour, and since that is where the blades
  // overlap each other, the sward reads as one dark mat with bright tips rather
  // than as individual leaves.
  float shade = 0.54 + 0.66 * pow(t, 1.55);
  shade *= 0.88 + 0.24 * bladeHash;
  vGrassTint = aGrassC.rgb * shade + uGrassTipWarm * (t * t);
}
`

/** Replaces `transformed` after `begin_vertex` has set it from `position`. */
export const GRASS_POSITION_GLSL = /* glsl */ `
transformed = wGrassPos;
`

export const GRASS_PARS_FRAGMENT_GLSL = /* glsl */ `
varying vec3 vGrassTint;
`

/**
 * The per-patch tint, applied where a vertex colour would be.
 *
 * Grass runs with `vertexColors: false` on purpose: the colour is a function of
 * two things the shader already has — the patch's ground tint and the position
 * along the blade — so a `color` attribute would be twelve bytes per vertex of
 * data derivable in three instructions, on the geometry with the most vertices
 * in the world.
 */
export const GRASS_COLOR_FRAGMENT_GLSL = /* glsl */ `
diffuseColor.rgb *= vGrassTint;
`
