/**
 * ─── Water GLSL ─────────────────────────────────────────────────────────────
 *
 * The chunks `WaterMaterial` splices into `MeshToonMaterial`. Kept as plain
 * strings next to the material, for the same reason `shading/glsl.ts` is: shader
 * surgery that lives in a global `THREE.ShaderChunk` table is invisible at the
 * call site and impossible to grep for.
 *
 * Everything here is a function of world position, `uTime`, the four baked
 * attributes from `types.ts`, and **two taps of the water atlas**
 * (`waterTextures.ts`). The atlas is the one texture GDD §5.2 was amended to
 * allow — generated at boot, never downloaded — and it exists because the signal
 * water needs is high-frequency *and* animated, which is the one thing neither
 * vertex colour nor a per-fragment sine stack can pay for.
 *
 * ── Two taps, and everything is built out of them ───────────────────────────
 *
 * Water is the heaviest overdraw in the frame, so the sample count is the
 * budget that matters here, not the instruction count. **Two `texture2D` per
 * fragment, total.** Caustics, refraction, the cellular river surface, the
 * waterfall's blotches, the crest-foam jitter, the shore-band jitter and the
 * sun glitter are all read out of those same two `vec4`s. Adding a third tap for
 * any one effect would be a 50 % bandwidth increase on the surface that can
 * least afford it.
 *
 * The two taps differ in scale (×1.73), in scroll speed (×0.61) and — for the
 * swell drift — in scroll *direction* (rotated ~37°); see
 * `WATER_ATLAS_SECOND_TAP`. That is what stops a 6 m tile repeated 57 times
 * across a bay from reading as wallpaper: the combination of the two has no
 * period either layer has.
 *
 * What the atlas *replaced*, rather than added to: the previous revision spent
 * twelve `sin` (two `waterStrands` calls, six each) plus an eight-hash
 * two-octave value noise per fragment on a surface pattern that still came out
 * as evenly-spaced polka dots on the river and as grey blobs on the pond. Those
 * are gone; four trig calls (`waterDetailGradient`) came back. So the two taps
 * are bought with a large net reduction in transcendentals — an instruction
 * count, not a measurement, and stated as such: see the perf note below.
 *
 * ── What was and was not measurable ─────────────────────────────────────────
 *
 * Structural, and solid: **3 compiled programs, 7–9 draw calls and identical
 * triangle counts before and after**, 60 fps in every bench preset at 1600×900
 * and at 2200×1300. The look pass that followed held all of it: **3 programs,
 * 6–9 draws, 88.8–104.7 k triangles, 60 fps and p99 16.9–17.7 ms** across nine
 * framed shots at 1600×900, against 17.0–17.5 ms for the same shots before it.
 * It is a wash within the vsync-quantised noise, which is the honest reading —
 * the net instruction change is a handful of ALU ops either way and two texture
 * fetches before and after.
 *
 * Water's own GPU cost, measured by interleaving `water.visible` on and off in
 * 0.8 s blocks (132 samples per side, so contention lands on both halves
 * equally) at 2200×1300 with water over most of the frame: **3.19 ms with water,
 * 2.59 ms without — 0.59 ms.**
 *
 * **No honest before/after GPU delta exists for this change**, and the reason is
 * worth recording so nobody spends an afternoon re-deriving it. On this machine
 * `EXT_disjoint_timer_query_webgl2` returned medians of 1.85 ms and 3.96 ms for
 * *identical code* in two consecutive 160-sample runs, and the profiler's own
 * ablation returned the same value for all four scene tags in a run (it was
 * measuring global drift, not per-tag cost). A control run with both taps
 * stubbed out to a constant came back *more* expensive than with the real
 * fetches — physically impossible, and the clearest statement available that the
 * effect being sought is below the noise floor here.
 *
 * ── The one rule that turned out to matter more than any of the art dials ───
 *
 * **Nothing that varies across the surface may be multiplied by `uTime`, and
 * nothing that varies fast across the surface may rotate the sample frame.**
 *
 * Both halves were learned the hard way, and both had the same symptom: an atlas
 * sheared into a grating so fine that every channel mip-averages to a constant,
 * which reads as "this water has no texture at all".
 *
 *   • The scroll used to be `aFlow * uFlowSpeed * uTime`. `aFlow` varies per
 *     vertex by design, so that is a shear whose magnitude grows linearly and
 *     without bound — ~0.045·t tiles per metre on a waterfall, i.e. unusable a
 *     couple of minutes after the page loads. It is now a *scalar* built only
 *     from uniforms, applied along the anisotropic frame's own axis.
 *   • The anisotropy used to blend frames by `min(length(aFlow), 1)` and to
 *     rotate by the per-vertex `aFlow` direction. Both are frame changes driven
 *     by something that varies, and a rotating frame applied to a coordinate of
 *     magnitude L adds a parasitic gradient of L·∇θ. The blend is now uniform,
 *     the rotation is used only where the direction field turns slowly (a river,
 *     not a curtain), and the coordinate is anchored on the mesh so L is the
 *     body's radius rather than its distance from the world origin.
 *
 * The two properties that follow from it:
 *
 *   • **Seamless in space.** Every pattern is phased by a coordinate the vertex
 *     stage derives from world position — never from object *space*, whose axes
 *     rotate with the placement. Two segments of the same river ribbon, or two
 *     tiles of one sea, must agree exactly at their shared edge. The atlas
 *     coordinate now subtracts the *mesh's* world origin, which is a translation
 *     and keeps that agreement within a mesh but not between two separate ones;
 *     see the vertex stage for why that trade is taken and what would break it.
 *     The wave keeps the pure world coordinate, because a disagreement there is
 *     a crack in the geometry rather than in a texture.
 *   • **Seamless in time.** Scrolls go into the *argument of a sine*, or into a
 *     `RepeatWrapping` UV through a `fract()` that is **constant over the whole
 *     surface**. A `fract()` on a *spatial* coordinate snaps back at the wrap and
 *     tears; a `fract()` on a uniform scalar wraps every fragment at the same
 *     instant by exactly one tile, which on a repeating texture is not a change
 *     at all.
 *
 * ── A pond is bit-exact still, and every addition here respects that ────────
 *
 * `styles.ts` insists a pond be *exactly* still (`waveAmplitude: 0`), and last
 * round measured it: `motion[pond] = 0.000`. Every new term is multiplied by a
 * uniform that is exactly zero for a pond — `uDetail` and `uCaustic` are both
 * derived from `waveAmplitude`, and `uSwellDrift` is gated by it — so the atlas
 * UVs, the refraction offset and the detail slope are all frozen there rather
 * than merely slow. That is a physical statement as much as an art one: a
 * perfectly flat surface has no slope variation to focus light with, so it casts
 * no caustics and refracts uniformly.
 *
 * ── The `aFlow` contract, for generators ────────────────────────────────────
 *
 * **`aFlow` is a *direction*. Its magnitude is now read only as "is there flow
 * here at all".** That is a narrowing of the old contract and it is deliberate:
 * a per-vertex *speed* multiplied by `uTime` is the shear described above, so
 * the pattern's speed comes from the style's `flowSpeed` alone and is the same
 * everywhere on one body. A river's inside bank at 0.55 no longer runs slower
 * than its outside at 1.0; on screen that difference was never visible, and what
 * it actually produced was a coordinate that compressed without limit.
 *
 * Generators should keep baking honest relative magnitudes — nothing here is
 * hurt by them and the editor displays them — but must not expect them to be
 * seen. `(0,0)` still means "no flow": it leaves the coordinate isotropic.
 *
 * The two components are in the **surface frame** the vertex stage builds, not
 * in world XZ: `+y` runs along the sheet's flow axis (world +Z on a horizontal
 * surface, straight down a curtain) and `+x` runs across it. A waterfall
 * therefore points its `aFlow` at (0, 1) — and on a curtain the shader uses that
 * axis directly rather than the baked direction, because a curtain's fanned-out
 * lateral spread turns fast enough across its own width to distort the sample
 * frame. See the fragment stage.
 */

/**
 * ─── Vertex: parameters ─────────────────────────────────────────────────────
 *
 * `uTime` is declared here rather than reused from the wind block, because the
 * wind block only declares it under `WORLD_WIND` and water never compiles with
 * wind (see the `WaterMaterial` constructor — that is also what stops this from
 * being a duplicate declaration).
 *
 * Missing attributes are not an error in GL — they read as the attribute default
 * — so geometry that forgets `aShore` renders as solid foam rather than as
 * nothing. That is deliberate: a loud failure beats a subtle one.
 *
 * ── `waterWave`: three directional Gerstner octaves and their *exact* normal ──
 *
 * This used to be a sum of plain sines, and the comment here used to say the
 * gradient was the reason: Gerstner displaces horizontally as well, so the
 * normal needs the Jacobian of that displacement and "the closed form stops
 * being three cosines". **That reasoning was incomplete.** A Gerstner sum has a
 * closed-form normal too — it is the cross product of the two tangents of the
 * displaced parameterisation, and both tangents are analytic — it is only more
 * algebra than three cosines. It is written out below and it is exact; nothing
 * here uses a finite difference or `dFdx`/`dFdy`, for the reason recorded
 * against the flow-scroll bug: a resolution-dependent gradient on this surface
 * was measured failing before.
 *
 * The parameterisation, for rest position `p` in the surface frame, octave
 * weights `W = (0.55, 0.31, 0.14)`, unit bearings `D`, wavenumbers `k`, phases
 * `φ = k(D·p) + ωt`, amplitude `A` and steepness product `qa = Q·A`:
 *
 *     X(p) = p + qa · Σ Wᵢ Dᵢ cos φᵢ            (horizontal, in-frame)
 *     Y(p) =      A · Σ Wᵢ    sin φᵢ            (vertical)
 *
 * The phase is read at the **rest** position, never at the displaced one — that
 * is what keeps the tangents analytic, and it is the only formulation with a
 * closed-form normal at all.
 *
 * Writing `aᵢ = qa·Wᵢ·kᵢ·sin φᵢ`, `gx`/`gz` for the height gradient, and
 *
 *     Jxx = Σ aᵢ Dᵢx²   Jzz = Σ aᵢ Dᵢz²   Jxz = Σ aᵢ Dᵢx Dᵢz
 *
 * the tangents are `T = ∂/∂x = (1−Jxx, gx, −Jxz)` and `B = ∂/∂z = (−Jxz, gz,
 * 1−Jzz)`, and `N = B × T` is
 *
 *     N = ( −gx(1−Jzz) − gz·Jxz ,  (1−Jxx)(1−Jzz) − Jxz² ,  −gz(1−Jxx) − gx·Jxz )
 *
 * At `qa = 0` all three J terms are **exactly** zero — every one carries `qa` as
 * a factor — and `N` collapses to `(−gx, 1, −gz)`, the height-field normal this
 * file had before, bit for bit. That is what keeps `motion[pond]` at 0.000; see
 * the note further down. It is not the GPU Gems approximation, which drops the
 * `Jxz` cross terms and the `(1−J)` products; those are the terms that carry the
 * *asymmetry* between a sharp crest and a broad trough, which is the entire
 * point of doing this.
 *
 * `waterWave` returns `raw`, `grad` (both unchanged, and unitless in amplitude),
 * the horizontal `offset` in metres, and `jac = (Jxx, Jzz, Jxz)`.
 *
 * ── The loop clamp, and where it is ─────────────────────────────────────────
 *
 * A Gerstner sum self-intersects — crests fold over into shells — once the
 * summed `Σ Qᵢ Aᵢ kᵢ` passes 1. The sum matters, not the octaves: three octaves
 * each individually safe still fold. Since `Q` and `A` are shared here the
 * criterion is `qa · Σ Wᵢkᵢ ≤ 1`, and `Σ Wᵢkᵢ = k·WATER_WK_SUM`, so **the clamp
 * is one `min()` on `qa` inside `waterWave`**, applied after the caller's
 * per-vertex damping so it bounds the value actually used.
 *
 * The limit is 0.92 rather than 1. At exactly 1 the trochoid reaches its cusp,
 * where `N` above is the zero vector — `(1−Jxx)(1−Jzz) − Jxz²` is 0 there and so
 * are `gx`/`gz`, because a cusp sits at a crest — and `normalize` of that is a
 * NaN that spreads to the whole triangle. 0.92 keeps `N.y ≥ 0.08` for any mix of
 * bearings. It is far above anything the presets ask for: the sea's `qa` is
 * 0.78 × 0.16 = 0.125 m against a limit of 0.97 m at its 11 m wavelength, and
 * the river's 0.025 m against 0.167 m. The clamp exists for the editor's
 * sliders, not for the presets.
 *
 * ── Horizontal displacement versus the baked attributes ─────────────────────
 *
 * `aShore` and `aDepth` are baked against each vertex's **rest** position
 * (`types.ts` — there is no depth buffer to ask instead). Gerstner moves
 * vertices horizontally, so a vertex carrying `aShore = 0` would slide in and
 * out of the water while still claiming to be exactly on the waterline: the
 * shore band's own edge would breathe by `qa` at the wave frequency, and on the
 * sea — where the dry cells are dropped, so the mesh edge *is* the waterline —
 * a 12.5 cm retreat exposes a strip of beach that was covered a moment ago.
 *
 * So steepness is **damped linearly to zero as `aShore → 0`**: no horizontal
 * displacement on the waterline, full displacement a `foamWidth` inside it. It
 * is also the physically defensible shape — a wave that has run out of water
 * cannot bunch — and it is what protects a river's banks, where the channel is
 * only a few metres wide and the whole sheet is inside the band.
 *
 * **The damping is a per-vertex factor on a displacement, which is exactly the
 * class of mistake the flow-scroll shear was**, so it is worth stating what is
 * neglected. The exact Jacobian of `σ(p)·d₀(p)` is `σ∇d₀ + d₀⊗∇σ`; only the
 * first term is in `jac`. `∇σ` is not available — `aShore` is an attribute and
 * its gradient is not baked — so the second is dropped. It is bounded, unlike
 * the shear: `|d₀|·|∇σ| ≤ qa / foamWidth`, which on the sea is 0.125 / 1.5 =
 * 0.083, against a retained `Jxx` of at most `qa·k·WATER_WK_SUM` = 0.119. In
 * normal terms that is `N = (−0.15, 1, …)` against `(−0.15, 0.92, …)`: 8.6°
 * versus 9.4° from vertical, under one degree, and only inside the foam band
 * that is being painted white anyway. Linear damping rather than a smoothstep
 * because a ramp of fixed width has its smallest possible peak `|∇σ|` when it is
 * linear, and this is the term that peak feeds.
 *
 * The atlas coordinate `vWaterSurface` also keeps the rest position, so the
 * pattern does not follow the bunching. At 12.5 cm against a 6 m tile that is
 * 2 % of a tile and invisible; making it follow would mean sampling the atlas at
 * a coordinate whose own gradient is the Jacobian above, i.e. a texture read
 * that compresses where the geometry does, which is a much louder artifact than
 * the one it fixes.
 *
 * The octave scales are 1 : 1.93 : 3.71, deliberately not harmonic. Harmonic
 * ratios make the sum repeat at the base wavelength, and a sea whose surface
 * repeats every 11 m reads as wallpaper however large the plane is.
 *
 * Weights sum to exactly 1, so `raw` is bounded by ±1 and `uWaveAmplitude` is
 * the true peak displacement in metres rather than an upper bound on it.
 *
 * **This stage carries the swell and nothing shorter, and that is forced.** The
 * sea's base grid clamps to **3.43 m quads** (`MAX_WATER_VERTICES`, measured in
 * `surface.ts`), so the 1–3 m chop the reference shows has nowhere to exist in
 * this geometry: displacing it would alias into the grid rather than appear. It
 * lives in the fragment stage's shading normal instead — see
 * `waterDetailGradient`.
 */
export const WATER_PARS_VERTEX_GLSL = /* glsl */ `
attribute float aDepth;
attribute float aShore;
attribute vec2 aFlow;

// The wind block declares uTime too, but only under WORLD_WIND — which water
// never sets. The guard is what keeps that a fact rather than a convention.
#ifndef WORLD_WIND
  uniform float uTime;
#endif
uniform float uWaveAmplitude;
uniform float uWaveLength;
uniform float uWaveSpeed;
uniform float uSteepness;

varying vec2 vWaterSurface;
varying float vWaterDepth;
varying float vWaterShore;
varying vec2 vWaterFlow;
varying float vWaterCrest;
varying float vWaterFlat;

// Non-harmonic octave scales (1 : 1.93 : 3.71) and weights summing to exactly 1
// — see the header.
const vec2 WATER_DIR_A = vec2(0.940, 0.342);
const vec2 WATER_DIR_B = vec2(-0.416, 0.909);
const vec2 WATER_DIR_C = vec2(0.602, -0.799);

// Σ Wᵢ·(kᵢ/k) over the three octaves — the wavelength-independent half of the
// loop criterion Σ QᵢAᵢkᵢ ≤ 1. Kept next to the weights and the scales it is
// built from, because it is wrong the moment either changes.
const float WATER_WK_SUM = 0.55 + 0.31 * 1.93 + 0.14 * 3.71;
// Fraction of the fold threshold the summed steepness is allowed to reach. Not
// 1: at 1 the trochoid cusps and the analytic normal there is the zero vector.
const float WATER_LOOP_LIMIT = 0.92;

void waterWave(in vec2 p, in float qaWanted, out float raw, out vec2 grad, out vec2 offset, out vec3 jac) {
  float k = 6.28318531 / max(uWaveLength, 0.05);
  float w = 6.28318531 * uWaveSpeed;

  // The loop clamp, on the **summed** steepness across all three octaves. See
  // the header: per-octave clamping lets three individually-safe octaves fold.
  float qa = min(qaWanted, WATER_LOOP_LIMIT / (WATER_WK_SUM * k));

  float pa = dot(WATER_DIR_A, p) * k + uTime * w;
  float pb = dot(WATER_DIR_B, p) * (k * 1.93) + uTime * (w * 1.37);
  float pc = dot(WATER_DIR_C, p) * (k * 3.71) + uTime * (w * 0.71);

  float sa = sin(pa);
  float sb = sin(pb);
  float sc = sin(pc);
  float ca = cos(pa);
  float cb = cos(pb);
  float cc = cos(pc);

  raw = sa * 0.55 + sb * 0.31 + sc * 0.14;
  grad = WATER_DIR_A * (ca * 0.55 * k)
       + WATER_DIR_B * (cb * 0.31 * k * 1.93)
       + WATER_DIR_C * (cc * 0.14 * k * 3.71);

  // Horizontal bunching toward the crests, in metres. No k: the displacement of
  // a trochoid is Q·A·cos φ regardless of wavelength, and it is the *product*
  // with k that the loop clamp above bounds.
  offset = (WATER_DIR_A * (ca * 0.55) + WATER_DIR_B * (cb * 0.31) + WATER_DIR_C * (cc * 0.14)) * qa;

  // aᵢ = qa·Wᵢ·kᵢ·sin φᵢ, the per-octave weight of the horizontal Jacobian.
  float aa = qa * (0.55 * k) * sa;
  float ab = qa * (0.31 * k * 1.93) * sb;
  float ac = qa * (0.14 * k * 3.71) * sc;
  jac = vec3(
    aa * WATER_DIR_A.x * WATER_DIR_A.x + ab * WATER_DIR_B.x * WATER_DIR_B.x + ac * WATER_DIR_C.x * WATER_DIR_C.x,
    aa * WATER_DIR_A.y * WATER_DIR_A.y + ab * WATER_DIR_B.y * WATER_DIR_B.y + ac * WATER_DIR_C.y * WATER_DIR_C.y,
    aa * WATER_DIR_A.x * WATER_DIR_A.y + ab * WATER_DIR_B.x * WATER_DIR_B.y + ac * WATER_DIR_C.x * WATER_DIR_C.y
  );
}
`

/**
 * ─── Vertex: displacement and the analytic normal ───────────────────────────
 *
 * Injected immediately before `<project_vertex>`, which is the only slot where
 * `transformed` (from `<begin_vertex>`) and `vNormal` (from `<normal_vertex>`)
 * both exist and neither has been consumed yet.
 *
 * **The normal is a tilt applied to the baked normal, not a replacement for it.**
 * The wave's own analytic normal `N` (see `waterWave`) is what a *flat* sheet
 * would have, so what this adds is `N − (0, 1, 0)` — the part of it that is not
 * already world up. On a flat sheet that reproduces `N` exactly; everywhere else
 * it still respects whatever the generator baked. Writing `N` in directly would
 * have flattened a river ribbon running down a slope back to horizontal and
 * shaded it as if it were level.
 *
 * At zero steepness `N − (0,1,0)` is `(−∂h/∂x, 0, −∂h/∂z)`, which is the plain
 * height-field tilt this block carried before Gerstner arrived — the same
 * expression, reached the same way, and identical bit for bit because every
 * Jacobian term carries `qa` as a factor.
 *
 * `waterFlat`, the world normal's `|y|`, gates the whole thing. It is 1 on a
 * pond, sea or river and ~0 on a waterfall curtain, so a vertical sheet keeps
 * its baked normal and gets no vertical heave — without a define, a branch, or
 * the material knowing which kind of water it is. It is now also handed to the
 * fragment stage as `vWaterFlat`, which is what lets one program give a
 * *horizontal* sheet caustics and refraction (both need a bottom under the
 * water) and a *vertical* one churning blotches instead — again with no define
 * and no branch on water kind. Note the vertical displacement is written into
 * object-space `transformed.y`, which is world +Y only because water transforms
 * are yaw-only; a water placement pitched or rolled would heave along its own
 * axis instead. It gates the horizontal Gerstner shift too — dragging a curtain
 * sideways would peel it off the rock it hangs on — which is belt-and-braces
 * next to `fall.steepness = 0`, but costs one multiply and holds if the editor
 * ever puts a river style on a waterfall.
 *
 * ── The horizontal shift is world-space, so it is projected back ────────────
 *
 * The vertical term can be written straight into `transformed.y` because yaw
 * leaves world +Y alone. The horizontal one cannot: object +X and +Z rotate
 * under a yaw and stretch under a non-uniform scale, both of which water
 * placements use. The linear part of the model matrix has orthogonal columns for
 * any rotation-times-axis-scale, so `dot(shift, cᵢ) / dot(cᵢ, cᵢ)` inverts it
 * exactly for a few ALU rather than a `mat3` inverse — and reduces to the shift
 * itself for the identity-rotation, unit-scale meshes the bench actually places.
 *
 * With `uWaveAmplitude == 0` every wave term is multiplied by zero and the
 * position and normal come out bit-identical to the baked ones: a pond is
 * *exactly* still, which `styles.ts` insists on, and it costs a multiply rather
 * than a branch. `uSteepness == 0` is the same argument one level down — a
 * waterfall's silhouette does not move by a millimetre.
 *
 * The view-space conversion goes through `mat3(viewMatrix)` rather than
 * `normalMatrix`. The gradient is a world-space quantity; `normalMatrix` is
 * object→view and would need the model rotation undone first, while the camera
 * matrix carries no scale so its upper 3×3 is the pure world→view rotation.
 */
export const WATER_VERTEX_GLSL = /* glsl */ `
{
  #ifdef USE_INSTANCING
    mat4 waterModel = modelMatrix * instanceMatrix;
  #else
    mat4 waterModel = modelMatrix;
  #endif
  vec3 waterWorld = (waterModel * vec4(transformed, 1.0)).xyz;
  vec3 waterOrigin = waterModel[3].xyz;

  // World normal. Water placements scale non-uniformly (a sea is halfX by halfZ),
  // so this is not the inverse-transpose — but every water sheet's baked normal
  // is axis-aligned with its own scale, and those survive mat3(modelMatrix)
  // exactly.
  vec3 waterN = normalize(mat3(modelMatrix) * normal);
  float waterFlat = abs(waterN.y);

  // Surface frame: V runs along the flow's natural axis, U across it.
  //   flat sheet  (waterFlat 1) -> V = world +Z, U = world +X
  //   curtain     (waterFlat 0) -> V = world down projected into the sheet,
  //                                U = the horizontal across it
  // so a horizontal surface samples at exactly (world.x, world.z) and every
  // seam between tiles still agrees, while a vertical curtain gets a coordinate
  // that actually travels down the sheet. Built from the *world* normal, never
  // from the object's axes, so two tiles at different yaws still line up.
  vec3 waterAxisV = normalize(mix(vec3(0.0, -1.0, 0.0) + waterN * waterN.y, vec3(0.0, 0.0, 1.0), waterFlat));
  vec3 waterAxisU = cross(waterN, waterAxisV);
  vec2 waterP = vec2(dot(waterWorld, waterAxisU), dot(waterWorld, waterAxisV));

  // ── The atlas coordinate is anchored on the mesh, the wave is not ──────────
  //
  // The frame above is per-vertex: on a curved strand or a spray dome its axes
  // rotate from one vertex to the next, and so does the flow frame the fragment
  // stage builds on top of it. Projecting a *world* position onto a rotating
  // frame gives a coordinate whose gradient carries a term proportional to the
  // world position itself — so the same waterfall asset, unchanged, samples the
  // atlas at a different scale depending on how far from the world origin it was
  // placed.
  //
  // Measured on the bench: the river fall at 11 m from the origin and the
  // shelf fall at 66 m are the same generator at the same style, and the shelf
  // rendered as a fine vertical pinstripe against the river's broad streaks —
  // roughly the ratio of their distances. The spray domes, whose frame turns
  // through a full circle across 1.4 m, came out hatched at well under a
  // centimetre for the same reason.
  //
  // Subtracting the mesh's own world origin bounds the coordinate by the body's
  // radius instead. **The trade is real and worth stating:** the pattern is no
  // longer purely world-phased, so two *separate* water meshes that share an
  // edge would no longer agree across it. Nothing in this world does — a river
  // is one ribbon, a fall is one asset, the sea is one plane, and pools stand
  // above the sea rather than abutting it — but a future tiled sea would have to
  // give its tiles a shared origin.
  //
  // The **wave** keeps the world coordinate, which is not negotiable: that one
  // drives vertex displacement, so a disagreement there is a crack in the
  // surface rather than a discontinuity in a texture.
  vec3 waterLocal = waterWorld - waterOrigin;
  vec2 waterPatternP = vec2(dot(waterLocal, waterAxisU), dot(waterLocal, waterAxisV));

  // ── Steepness, damped at the sheet's free edge ─────────────────────────────
  //
  // aShore is baked against the *rest* position, so a vertex that slides
  // horizontally carries a shore distance it no longer has. Damping the
  // horizontal term to zero on the waterline is what stops the foam band — and,
  // on a sea whose dry cells are dropped, the mesh's own edge — from breathing
  // at the wave frequency. Linear, and clamped because a generator is free to
  // bake aShore past 1 on a wide body. See the header for the one Jacobian term
  // this drops and how large it is (under a degree, inside the foam band).
  float waterShoreDamp = clamp(aShore, 0.0, 1.0);
  // waterFlat gates it for the same reason it gates the heave: a curtain must
  // not be dragged sideways off its rock.
  float waterSteep = uSteepness * uWaveAmplitude * waterShoreDamp * waterFlat;

  float waterRaw;
  vec2 waterGrad;
  vec2 waterOffset;
  vec3 waterJac;
  waterWave(waterP, waterSteep, waterRaw, waterGrad, waterOffset, waterJac);

  float waterHeight = waterRaw * uWaveAmplitude;

  // Displacement is world-vertical, so it is gated by how horizontal the sheet
  // is: a curtain must not heave up and down. The *crest pattern* below is
  // deliberately not gated — see vWaterCrest.
  transformed.y += waterHeight * waterFlat;

  // Horizontal bunching, in the surface frame's own plane — so on a river ribbon
  // running down a slope the vertices slide *along* the sheet rather than off
  // it — projected back into object space through the model matrix's columns.
  vec3 waterShift = waterAxisU * waterOffset.x + waterAxisV * waterOffset.y;
  vec3 waterColX = waterModel[0].xyz;
  vec3 waterColZ = waterModel[2].xyz;
  transformed.x += dot(waterShift, waterColX) / max(dot(waterColX, waterColX), 1e-8);
  transformed.z += dot(waterShift, waterColZ) / max(dot(waterColZ, waterColZ), 1e-8);

  #ifndef FLAT_SHADED
    vec2 waterSlope = waterGrad * (uWaveAmplitude * waterFlat);
    // N - (0,1,0), with N the exact Gerstner normal derived in the header:
    //   N = ( -gx(1-Jzz) - gz*Jxz, (1-Jxx)(1-Jzz) - Jxz^2, -gz(1-Jxx) - gx*Jxz )
    // At zero steepness every J term is exactly zero and this is (-gx, 0, -gz),
    // the height-field tilt, bit for bit.
    vec3 waterTilt = vec3(
      -waterSlope.x * (1.0 - waterJac.y) - waterSlope.y * waterJac.z,
      (1.0 - waterJac.x) * (1.0 - waterJac.y) - waterJac.z * waterJac.z - 1.0,
      -waterSlope.y * (1.0 - waterJac.x) - waterSlope.x * waterJac.z
    );
    vNormal = normalize(vNormal + mat3(viewMatrix) * waterTilt);
  #endif

  vWaterSurface = waterPatternP;
  vWaterDepth = aDepth;
  vWaterShore = aShore;
  vWaterFlow = aFlow;
  vWaterFlat = waterFlat;
  // Normalised crest phase in [-1,1]. Not multiplied by waterFlat: crest foam is
  // a *pattern*, not a displacement, and a waterfall's whole preset leans on it
  // (fall.crestFoam is 0.75). Gating it on flatness silently zeroed the loudest
  // dial in the styles table. It still collapses to 0 when the amplitude does,
  // which is what keeps whitecaps off a still pond.
  vWaterCrest = waterHeight / max(uWaveAmplitude, 1e-4);
}
`

/**
 * ─── Fragment: parameters ───────────────────────────────────────────────────
 *
 * `waterTapA`, `waterTapB` and `waterDetailSlope` are plain globals, not
 * varyings. The two atlas taps are taken once in the colour block and read again
 * in the normal block and the sparkle block, and those are three separate
 * injection sites in the same `main()` — a global is the only way to carry a
 * value between them, and it costs nothing.
 *
 * ── `waterBand`: quantise [0,1] into hard steps (GDD R4) ────────────────────
 *
 * The riser is a 0.1-wide smoothstep rather than a bare `step()`. Water is
 * near-horizontal and usually seen at a grazing angle, where a single-fragment
 * hard edge crawls and shimmers as the camera moves; a tenth of a step still
 * reads as an edge rather than as a gradient, and stops the crawl.
 *
 * ── `waterDetailGradient`: the small waves, as a slope rather than a height ──
 *
 * Two oblique sine octaves and their exact gradient, at roughly a fifth of the
 * swell's wavelength — so a sea whose swell is 11 m gets chop at ~2 m and ~1.2 m,
 * which is the scale the reference reads at.
 *
 * **It returns a slope and is never integrated into a displacement, and that is
 * forced rather than chosen.** The sea's base grid clamps at 3.43 m quads
 * (`surface.ts` measures this: `MAX_WATER_VERTICES` on a 340 m sea), so a 2 m
 * wave cannot be represented in the geometry at all — displacing it would alias
 * into the grid, not appear on it. Refining the grid to carry it was rejected
 * on the same page: a uniform grid already spends ~97 % of its vertices on open
 * water where nothing varies, and this would be doubling that waste.
 *
 * Shading it instead is not a consolation prize. **Sun glitter is a slope
 * distribution** — the bright path to the horizon exists because a rippled
 * surface presents a spread of normals, not because it presents a spread of
 * heights — so a per-fragment slope is the term that actually produces the
 * reference's glitter path, and a displaced 3.43 m grid would not have.
 *
 * The wavenumber `k` is deliberately **left out of the returned gradient**. The
 * true gradient of `a·sin(k·x)` carries a factor `a·k`, which would make the
 * slope of a river (wavelength 1.9 m) six times that of a sea (11 m) at the same
 * dial setting. Normalising it out makes `uDetail` mean "how steep is the chop",
 * in the same units, for every preset.
 */
export const WATER_PARS_FRAGMENT_GLSL = /* glsl */ `
uniform float uTime;
uniform sampler2D uWaterAtlas;
uniform vec3 uWaterShallow;
uniform vec3 uWaterMid;
uniform vec3 uWaterDeep;
uniform vec3 uWaterFoam;
uniform vec3 uWaterSparkle;
uniform vec3 uWaterCaustic;
uniform float uWaveLength;
uniform float uWaveSpeed;
uniform float uDepthFalloff;
uniform float uFoamWidth;
uniform float uCrestFoam;
uniform float uOpacity;
uniform float uSparkle;
uniform float uFlowSpeed;
uniform float uAtlasScale;
uniform float uSwellDrift;
uniform float uCaustic;
uniform float uDetail;
uniform float uRefract;

varying vec2 vWaterSurface;
varying float vWaterDepth;
varying float vWaterShore;
varying vec2 vWaterFlow;
varying float vWaterCrest;
varying float vWaterFlat;

vec4 waterTapA;
vec4 waterTapB;
vec2 waterDetailSlope;

float waterBand(float x, float steps) {
  float s = clamp(x, 0.0, 1.0) * steps;
  return (floor(s) + smoothstep(0.45, 0.55, fract(s))) / steps;
}

// Bearing of the swell, matching WATER_DIR_A in the vertex stage — the caustics
// and the surface pattern have to travel the way the wave that makes them does,
// or the sea reads as two surfaces sliding over each other.
const vec2 WATER_SWELL_DIR = vec2(0.940, 0.342);

// ~37°. Rotates the *second* tap's swell drift so the two atlas layers move in
// different directions as well as at different speeds — two layers on a shared
// bearing still beat into a single travelling pattern. It applies to the swell
// term only: the flow scroll is a scalar along the anisotropic axis, and
// rotating that would put the second tap's streaks across the current.
const mat2 WATER_TAP_ROT = mat2(0.799, -0.602, 0.602, 0.799);

// ~29° and ~112°, mutually oblique. Two axis-aligned gratings sum into a
// rectangular lattice — evenly spaced blobs in rows and columns, fish scales
// rather than water — and the lattice comes from the axis alignment inside one
// octave, not from the relation between octaves, so non-harmonic scales do not
// rescue it.
const vec2 WATER_D1 = vec2(0.875, 0.485);
const vec2 WATER_D2 = vec2(-0.375, 0.927);

// How far the atlas coordinate is compressed *along* the flow, so running water
// reads as streaks travelling downstream rather than as blobs drifting along.
//
// One constant, used in two places that have to agree exactly: the anisotropic
// frame below, and the scroll rate. uFlowSpeed is metres per second of *world*
// travel, and a feature sitting at a fixed atlas UV moves through the compressed
// frame at scroll / (uAtlasScale * WATER_FLOW_SQUASH) metres per second — so the
// squash has to appear in the scroll too, or a waterfall's blotches slide at
// three times the speed its style asks for.
//
// 0.44, up from 0.32. At 0.32 a curtain's blotch comes out 3.1x taller than it
// is wide, which on the 4.2 m river fall is one patch for the whole ten-metre
// drop — invisible until the shear fix below stopped hiding it.
const float WATER_FLOW_SQUASH = 0.70;

vec2 waterDetailGradient(vec2 p, float warp) {
  // 0.28 of the swell, floored at half a metre. At 0.18/0.30 a river (1.9 m
  // swell) got 34 cm chop, which on a 4 m channel at 15 m is a 15-pixel ruled
  // hatch that no amount of warping hides. The sea lands at 3.1 m and 1.8 m,
  // which is the 1-3 m band the reference reads at.
  float k = 6.28318531 / max(uWaveLength * 0.28, 0.50);
  float w = 6.28318531 * uWaveSpeed;
  // Opposed temporal signs: two chop octaves travelling the same way average
  // into one coarser wave, which is the swell again rather than detail on it.
  //
  // The warp is the atlas's blotch channel, phase-shifting each octave along its
  // own axis. Measured on screen: without it, two sines — however oblique their
  // axes — draw a *ruled diagonal grating* across the whole sea, which at a
  // grazing angle reads as corduroy rather than as chop. Warping bends each
  // crest along the perpendicular, so the ripple wanders. It costs nothing: the
  // tap it comes from has already been paid for by the colour block.
  float pa = dot(WATER_D1, p) * k + warp * 4.2 + uTime * (w * 2.1);
  float pb = dot(WATER_D2, p) * (k * 1.71) - warp * 3.1 - uTime * (w * 3.1);
  return WATER_D1 * (cos(pa) * 0.62) + WATER_D2 * (cos(pb) * 0.38 * 1.71);
}
`

/**
 * ─── Fragment: colour, caustics, churn, foam and alpha ──────────────────────
 *
 * Injected after `<color_fragment>`, so everything here lands in `diffuseColor`
 * before three's toon lighting bands it — and, because `<color_fragment>` runs
 * before `<normal_fragment_begin>`, this is also where the two atlas taps and
 * the detail slope are computed for the two blocks downstream.
 *
 * **The depth ramp is three stops, not two** (see the palette's water note): a
 * straight shallow→deep lerp is a linear wash that reads as tinted glass, while
 * the mid stop is where most of a pond's surface actually sits and is what makes
 * it read as having a bottom.
 *
 * ── Refraction, and the honest cheat it is ──────────────────────────────────
 *
 * There is no scene depth texture in this renderer and adding one costs a full
 * extra pass over the whole scene for one material (`types.ts` states the
 * decision and why). So nothing here can bend a ray and re-look-up the bottom.
 *
 * What it does instead: `aDepth` is baked per-vertex, and the depth ramp is the
 * only thing that draws the bottom at all — so **perturbing the depth the ramp
 * is read at** makes the sea floor appear to swim under the surface, which is
 * what refraction reads as from above. The offset comes from the blotch channel
 * of the first tap, so it is already scrolling with the swell.
 *
 * Three gates, all of them load-bearing:
 *   • `(1 - depth)` — deep water shows no bottom, so there is nothing to wobble.
 *   • `vWaterFlat` — a curtain's `aDepth` is its *thickness*, not a distance to
 *     a floor, and wobbling that just makes the sheet flicker between colours.
 *   • `uDetail` — a flat surface refracts uniformly, so a pond stays exact.
 *
 * ── Caustics ────────────────────────────────────────────────────────────────
 *
 * The single biggest thing missing from the sea. Both taps' **G channel** is
 * `F2−F1`, i.e. distance to the nearest cell *boundary*, and thresholding it
 * gives the bright net between cells — which is what a caustic actually is, and
 * what a plain Worley F1 (blobs) cannot produce at any scale.
 *
 * Two layers, multiplied rather than added. The intersection of two nets moving
 * in different directions at different speeds has neither layer's period, so the
 * caustics never settle into a visible loop; adding them would have kept both.
 * Then quantised, because everything in this world is (GDD R4) — a smooth
 * caustic web is the tell of a realistic-water shader wearing a cel palette.
 *
 * ── Interior churn: one term that is cells on a river and blotches on a fall ─
 *
 * The reference asks for two different things — a river is a *cellular* surface
 * with short white veins travelling downstream, a waterfall is bright cyan
 * carrying *big soft white blotches* sliding down it — and they are one `mix`
 * apart, blended by `vWaterFlat`. Not by a uniform, and deliberately: the
 * difference between them is genuinely the difference between a surface with a
 * bottom and a sheet falling through air, and that is exactly what `|normal.y|`
 * already measures. A uniform would have been a fifth dial for the editor to get
 * wrong on a curtain.
 *
 * Its weight is `uCrestFoam`, which already orders the presets the way this
 * wants them (pond 0, sea 0.18, river 0.4, fall 0.75) and already means "how
 * much is this water churning". A pond gets exactly none, which is what stops
 * its frozen pattern reading as marbled paper.
 *
 * ── Foam ────────────────────────────────────────────────────────────────────
 *
 * **The foam bands are quantised, not ramped.** A smooth alpha falloff at the
 * shoreline is the single clearest tell of stock engine water; three hard steps
 * is what makes it read as drawn.
 *
 * Both band boundaries are **jittered by the atlas**, and on the crest band that
 * is a fix for a defect visible in the before shots rather than a flourish.
 * `vWaterCrest` is a *vertex* attribute, so quantising it lands the step on a
 * straight line inside every triangle — and on the sea's 3.43 m quads that
 * rendered as a scatter of pale angular polygons across the open water, the
 * tessellation drawn in white. Jittering the threshold by a per-fragment field
 * breaks the step off the triangle edges.
 *
 * **Opacity rises with depth.** Shallow water at `uOpacity` lets the terrain
 * through, which is most of what places a shoreline in the world; deep water
 * closes up. Foam is fully opaque regardless.
 */
export const WATER_COLOR_FRAGMENT_GLSL = /* glsl */ `
{
  // ── The two taps, and the one coordinate they share ────────────────────────
  //
  // Both the sample point and the drift are in the *surface* frame the vertex
  // stage built, which is what lets a waterfall's aFlow of (0, 1) travel down
  // its own curtain. Sampling world XZ here — as an earlier revision did — left
  // the pattern shimmering in place on any near-vertical sheet, because world XZ
  // barely changes as you go down one.
  //
  // The swell drift, and only the swell drift, moves the *sample point*. It is
  // spatially uniform — one bearing, one speed, for the whole sheet — so it
  // translates the pattern without deforming it. uSwellDrift is gated by wave
  // amplitude in the material, so a pond's is exactly 0 and its tap is bit-exact
  // static. Caustics are made by the *wave*, not by the current, so this is also
  // the physically right carrier for them: aFlow * uFlowSpeed is 0.05 m/s on a
  // sea (it bobs far more than it travels, styles.ts) and would take two minutes
  // to move the pattern one tile.
  vec2 waterDrift = WATER_SWELL_DIR * (uSwellDrift * uTime);

  // Stretch the pattern along the current. Running water reads as streaks
  // travelling downstream, not as isolated blobs drifting along — so the
  // coordinate is compressed along the flow, which makes the atlas vary slowly
  // that way and quickly across it. On a curtain the same compression turns the
  // blotches into the reference's vertical streaks for free.
  //
  // **How much anisotropy is a uniform; only its direction is per-vertex.** It
  // used to be min(length(aFlow), 1), and that is a coordinate *frame* being
  // blended by a quantity that varies across the surface — which distorts by
  // |mix target − source|, and the two frames differ by a rotation, so that
  // difference is proportional to the *coordinate's own magnitude*. A curtain
  // whose coordinate reaches ~14 and whose aFlow runs 0.55 at the lip and 1.35 at
  // the base (clamped to 1) therefore picked up on the order of an extra unit of
  // coordinate per metre of drop, against the ~0.5 it is supposed to have — the
  // pattern compressed itself down the sheet and the bottom half of every strand
  // came out smooth. Deriving it from uFlowSpeed instead makes it constant per
  // body: 0 on a pond (which is what keeps its coordinate isotropic and
  // bit-exact), 0.08 on a sea, 1 on a river or a fall.
  //
  // At zero flow waterAlong is (0,0) and the target collapses to the origin, so
  // a sea's 0.08 is a uniform 8 % zoom of the tile rather than a distortion of
  // it — no normalize of a zero vector to guard, and no branch.
  //
  // ── Which axis the squash and the scroll run along ─────────────────────────
  //
  // A frame that rotates across the surface turns a coordinate of magnitude L
  // into a parasitic gradient of L·∇θ, on top of the gradient of 1 it is meant
  // to have. Two bodies of water sit at opposite ends of that:
  //
  //   • a **river** bakes aFlow as its channel tangent, which turns at 0.003
  //     rad/m along the bench spline — 13 % on a 40 m ribbon, and it is the only
  //     thing that makes its streaks and its drift run down the channel rather
  //     than across it, so it is worth paying;
  //   • a **curtain** bakes a lateral spread of ±0.22 rad across its own width
  //     (FLOW_LATERAL), which over a 10 m drop is a parasite of ~1 per metre —
  //     as large as the signal. Measured: the two falls in the bench, same
  //     generator and same style, rendered at visibly different pattern scales,
  //     the further one as a fine vertical pinstripe.
  //
  // And a curtain does not need it. The vertex frame's +y axis already runs
  // straight down the sheet — that is what the aFlow contract says a waterfall's
  // own flow direction is, before the generator adds its lateral fan on top — so
  // for a curtain the correct axis is the constant (0, 1), and constant is
  // exactly what makes the parasite vanish.
  //
  // The blend between the two has to be **uniform-derived**. vWaterFlat is the
  // natural discriminator and is unusable here: a per-fragment blend makes the
  // axis field vary across the surface again, which is the parasite this exists
  // to remove, and a strand's rounded cross-section swings |n.y| through its
  // whole range in about a third of a metre — a faster-turning field than the
  // aFlow fan it would be replacing. (Reasoned, not measured: the version that
  // shipped is the uniform one.) uFlowSpeed is the uniform that separates them:
  // styles.ts puts a fall an order of magnitude above a river (5.5 against 1.35)
  // precisely because falling water is the one place fast reads as correct, so
  // the threshold sits in a gap nothing is near. A hypothetical slow curtain
  // would keep aFlow's fan and its distortion; a river at 5 m/s would drift
  // along world +Z. Neither exists, and both are a wrong *look* rather than a
  // wrong *frame*.
  float waterAniso = clamp(uFlowSpeed * 1.6, 0.0, 1.0);
  float waterSheet = smoothstep(2.5, 4.5, uFlowSpeed);
  vec2 waterFlowDir = vWaterFlow / max(length(vWaterFlow), 1e-4);
  vec2 waterAxis = mix(waterFlowDir, vec2(0.0, 1.0), waterSheet);
  // max(), not normalize(): a pond's aFlow is (0,0) and waterSheet is 0 there,
  // so the blend is the zero vector — and normalize() of it is a NaN that
  // survives being multiplied by a zero waterAniso.
  vec2 waterAlong = waterAxis / max(length(waterAxis), 1e-4);
  vec2 waterAcross = vec2(-waterAlong.y, waterAlong.x);

  vec2 waterPa = vWaterSurface - waterDrift;
  vec2 waterPb = vWaterSurface - WATER_TAP_ROT * waterDrift * 0.61 + vec2(37.4, 19.1);
  vec2 waterQa = mix(waterPa, vec2(dot(waterPa, waterAcross), dot(waterPa, waterAlong) * WATER_FLOW_SQUASH), waterAniso);
  vec2 waterQb = mix(waterPb, vec2(dot(waterPb, waterAcross), dot(waterPb, waterAlong) * WATER_FLOW_SQUASH), waterAniso);

  // ── The flow scroll, and why it is a uniform scalar rather than aFlow·t ─────
  //
  // **aFlow * uFlowSpeed * uTime cannot be a sample-point offset, and this was
  // the single biggest thing wrong with the water.** aFlow varies per vertex
  // by design — a curtain runs 0.55 at the lip and 1.35 at the base (FLOW_LIP,
  // FLOW_BASE), a plunge pool's is radial, a spray dome's points outward in
  // every direction — so an offset proportional to it is a *shear* of the sample
  // coordinate whose magnitude grows linearly and without bound with uTime.
  //
  // Measured, by rendering fract(waterQa · uAtlasScale) straight into
  // diffuseColor on the river fall: at a 3 m tile the along-sheet coordinate
  // came back as a grating wrapping **~13 times per metre of drop**, some
  // minutes into a session (uTime read back as 891 s shortly afterwards). The
  // predicted rate is
  // (FLOW_BASE − FLOW_LIP)·uFlowSpeed·squash·t / (drop · tile), which with the
  // 0.32 squash of the time is ≈ 0.045·t tiles per metre — 13 per metre at
  // t ≈ 300 s, and rising for as long as the tab is open. Every channel
  // therefore mip-averages to a flat constant within a
  // couple of minutes of the page loading — which is exactly the reported "the
  // waterfalls have no water texture at all", and is why the curtain looked like
  // fine speckle at a third of the right size: it was not the pattern at the
  // wrong scale, it was the pattern sheared into an aliasing grating. The same
  // shear is what left the plunge pool a flat disc and the spray mounds a
  // featureless white.
  //
  // The fix is to scroll **after** the frame change, along the compressed axis,
  // by a scalar built only from uniforms. It is constant across the surface, so
  // its screen-space derivative is exactly zero and it can never shear anything;
  // it slides the pattern through the surface's own parameterisation, which is
  // what advection looks like when the velocity field is not being integrated.
  // The price is honest and small: a curtain's blotches no longer accelerate
  // between lip and base, and a plunge pool's no longer spread radially. Both
  // were invisible anyway — they were the shear.
  //
  // fract is safe here for the one reason it is never safe on a spatial
  // coordinate: the offset is the same for every fragment, and the atlas is
  // RepeatWrapping, so wrapping it at exactly one tile leaves every sampled
  // texel — and every mip of them — identical. There is no snap to see because
  // nothing changes at the wrap. Without it the offset would grow until float32
  // quantised the scroll into visible steps.
  float waterScroll = uTime * uFlowSpeed * uAtlasScale * WATER_FLOW_SQUASH;
  waterTapA = texture2D(uWaterAtlas, waterQa * uAtlasScale - vec2(0.0, fract(waterScroll)));
  // The second tap keeps its own scale (1.73) and its own speed (0.61) — two
  // layers on one velocity beat into a single travelling pattern, which is the
  // repeat coming straight back.
  waterTapB = texture2D(uWaterAtlas, waterQb * (uAtlasScale * 1.73) - vec2(0.0, fract(waterScroll * 1.73 * 0.61)));

  // Slope of the chop, for the shading normal two blocks down. Domain-warped
  // and amplitude-modulated out of the same tap, and then faded out with
  // distance — a 2 m ripple seen at 200 m is well under a pixel, so past that it
  // is pure aliasing energy with nothing left to depict. The far sea keeps its
  // glitter regardless, because that comes from the *atlas*, which has a mip
  // chain and fades to a smooth wash rather than to a crawl.
  //
  // Phased by waterPa, which no longer carries the flow drift — so a river's
  // chop no longer travels with its current. It has its own two temporal terms
  // and reads as moving without it, and the sea it was written for never had a
  // flow drift worth the name (0.05 m/s). The alternative was to keep the one
  // term in the shader that grew without bound.
  float waterFar = 1.0 - smoothstep(55.0, 170.0, length(vViewPosition));
  waterDetailSlope = waterDetailGradient(waterPa, waterTapA.b)
                   * (uDetail * vWaterFlat * waterFar * 0.17 * (0.30 + 1.40 * waterTapA.a));

  // ── Depth, refracted ───────────────────────────────────────────────────────
  float waterDepthRaw = clamp(vWaterDepth / max(uDepthFalloff, 0.05), 0.0, 1.0);
  float waterDepthT = clamp(
    waterDepthRaw + (waterTapA.b - 0.5) * (uRefract * uDetail * vWaterFlat * (1.0 - waterDepthRaw)),
    0.0,
    1.0
  );

  vec3 waterColor = mix(uWaterShallow, uWaterMid, smoothstep(0.0, 0.55, waterDepthT));
  waterColor = mix(waterColor, uWaterDeep, smoothstep(0.5, 1.0, waterDepthT));

  // ── Caustics ───────────────────────────────────────────────────────────────
  // Thin veins and three steps, not fat blobs and two. At 0.38 the net kept a
  // third of the channel's range, which after a 2-step quantise put half-strength
  // caustic over most of the shallow shelf — the green went milky and the cells
  // stopped reading as cells. Real caustics are a *web*: bright lines with the
  // bottom's own colour between them.
  float waterNetA = 1.0 - smoothstep(0.0, 0.20, waterTapA.g);
  float waterNetB = 1.0 - smoothstep(0.0, 0.34, waterTapB.g);
  float waterCaustic = waterBand(waterNetA * (0.20 + 1.0 * waterNetB), 3.0);
  // Only where there is a bottom close enough under the surface to focus onto,
  // and only on water that has a bottom at all. Read at the *unrefracted* depth
  // so the mask's own edge does not wobble along with the colour.
  float waterCausticMask = (1.0 - smoothstep(0.04, 0.46, waterDepthRaw)) * vWaterFlat;
  waterColor = mix(waterColor, uWaterCaustic, waterCaustic * waterCausticMask * uCaustic);

  // ── Interior churn ─────────────────────────────────────────────────────────
  float waterCurtain = 1.0 - vWaterFlat;
  // R is Worley F1: 0 at a cell centre, so 1-R is a bright cell body. Banded
  // into three steps, which is the reference river's stepped cellular surface.
  float waterCells = waterBand(1.0 - waterTapA.r, 3.0);
  // G is F2-F1: the short white veins between cells, stretched into streaks by
  // the anisotropic coordinate above.
  float waterVein = 1.0 - smoothstep(0.0, 0.24, waterTapA.g);
  // B is the soft blotch fBm, already S-curved twice in the atlas.
  //
  // **The second tap jitters the threshold; it is not blended into the field.**
  // Blending it in (at 0.25) put its own 1.73x-finer structure inside every
  // patch, which is the other half of why a curtain read as speckle rather than
  // as patches. Jittering the threshold keeps patch *interiors* solid and spends
  // the second tap on their *edges* instead, where a ragged boundary reads as
  // churn — and it still breaks the tile repeat, which is the job the second tap
  // was taken for.
  //
  // Two narrow tiers rather than one wide ramp. smoothstep(0.30, 0.80) spanned
  // nearly the channel's whole useful range, so what reached the screen was the
  // fBm itself: a mid-grey wash that averages flat at any distance. The
  // reference's blotches are patches — a soft halo around a solid core, with the
  // depth ramp's cyan showing between them — which is a step function with a
  // shoulder, not a gradient.
  float waterBlotchField = waterTapA.b + (waterTapB.b - 0.5) * 0.22;
  float waterBlotch = 0.40 * smoothstep(0.40, 0.56, waterBlotchField)
                    + 0.60 * smoothstep(0.56, 0.74, waterBlotchField);
  // The flat-water half is held at 0.72 of the curtain's. A curtain is *made* of
  // entrained air and wants to go white; open water carries the same cells as
  // surface texture, and at parity they stacked on top of the caustics and the
  // glint and turned the shallows milky.
  float waterChurn = clamp(mix((waterCells * 0.42 + waterVein * 0.58) * 0.72, waterBlotch, waterCurtain), 0.0, 1.0);
  // 0.85 rather than the bare dial. At 1.0 the plunge pool's splash cones — whose
  // normals are neither flat nor vertical, so they take a full share of the
  // blotch — went solid white and read as ice shards standing in the pool.
  float waterInterior = waterChurn * uCrestFoam * 0.85;

  // ── Foam ───────────────────────────────────────────────────────────────────
  float waterShoreT = clamp((vWaterShore + (waterTapA.r - 0.5) * 0.20) / max(uFoamWidth, 0.02), 0.0, 1.0);
  float waterShoreFoam = 1.0 - waterBand(waterShoreT, 3.0);

  // Faded out with distance by the same factor as the chop, and for the same
  // reason: vWaterCrest is interpolated across 3.43 m quads, so at 150 m the
  // whole band structure is inside a couple of pixels and the far sea rendered
  // as fine horizontal striping — the wave crests aliasing, not a look.
  //
  // **Gated by vWaterFlat, which the vertex stage's vWaterCrest deliberately is
  // not.** Keeping the *pattern* ungated there is right — it is what lets a
  // curtain's crest phase exist at all — but painting a whitecap band with it on
  // a vertical sheet lays a second, unrelated white field over the blotches, and
  // the two together are what made a curtain milky instead of cyan-with-patches.
  // A whitecap is a wave crest breaking; a curtain has no wave crests. The fall
  // preset's crestFoam of 0.75 still does its work through the interior churn
  // above, which is the term that actually draws its blotches.
  float waterCrestFoam = uCrestFoam * waterFar * vWaterFlat
                       * waterBand(smoothstep(0.25, 0.9, vWaterCrest + (waterTapB.b - 0.5) * 0.55), 2.0);

  float waterFoamMask = clamp(max(waterShoreFoam, waterCrestFoam), 0.0, 1.0);

  // ── Perforation: holes in a foam *mass* ────────────────────────────────────
  //
  // A large foam mass is not a flat plate of one colour. A waterfall's spray
  // cluster carries aShore ≤ 0.45 over its whole body, so the three-step shore
  // band saturates across all of it and it rendered as a solid grey-white lump —
  // the first thing the eye lands on in the falls shot, and reading as plaster
  // rather than as boiling water.
  //
  // **It multiplies the finished white, not the foam mask.** Perforating only
  // the mask was tried first and does not work: the interior churn is combined
  // with a max, so it fills every hole back in and the mound went from plaster
  // to frosted glass. Cutting the total is also what lets the depth ramp's cyan
  // actually reach the screen in a hole, which is the whole point.
  //
  // Two scales, combined with **min() rather than a weighted sum**, and the
  // difference is not cosmetic. The churn alone is the right *shape* and the
  // wrong *size* on a spray mound: the cluster is ~2 m across against the 5 m
  // tile a fall samples, so it sits inside a single blotch and reads as 1 over
  // all of it. A weighted sum then cannot open a hole either — at 0.45·churn the
  // field never falls below 0.45, so the first band edge is unreachable wherever
  // the churn is high, and the mound went from plaster to frosted glass and
  // stopped there. Measured by ablation: with uCrestFoam and uFoamWidth zeroed
  // the same mound renders plain teal, so the white was the foam path all along
  // and the perforation simply was not reaching it.
  //
  // min() says a hole is where *either* the big churn or the fine aeration is
  // absent. The ripple channel runs at 17 and 31 lattice cells to the tile —
  // 16–29 cm here — which is what a boiling surface reads as from the few metres
  // a plunge pool is seen at, and it opens ~28 % of the mound to the depth
  // ramp's cyan. On a curtain the churn is the smaller of the two wherever its
  // patches part, so the big cyan gaps survive and the ripple only breaks up the
  // white inside them.
  //
  // Gated on uCrestFoam, so it is a property of churning water: a fall opens to
  // 0.14 of its white, a river to 0.54, the sea's beach surf to 0.79, and a pond
  // — which has no churn to punch holes with — is untouched at exactly 1.
  float waterPerforate =
    1.0 - uCrestFoam * 1.15 * (1.0 - waterBand(min(waterChurn, waterTapB.a * 1.25 + 0.15), 2.0));

  // **One mix, not two.** Interior churn and the foam bands both drive toward
  // uWaterFoam, and two successive mixes toward the same colour compound:
  // 0.46 then 0.75 landed at 0.87, which is what turned a fall's splash white.
  // A max is bounded by construction and keeps the shoreline at full strength.
  float waterWhite = max(waterFoamMask, waterInterior) * waterPerforate;
  waterColor = mix(waterColor, uWaterFoam, waterWhite);

  diffuseColor.rgb = waterColor;
  // Churn closes the sheet up as well as whitening it — a waterfall's blotches
  // are entrained air, which is the one part of a curtain you cannot see the
  // cliff through. three's own material-level 'opacity' stays multiplicative on
  // top of this, so a water mesh can still be faded out wholesale without
  // touching the style.
  float waterBody = max(mix(uOpacity, 1.0, waterDepthT * 0.7), waterInterior * 0.4);
  diffuseColor.a = max(waterBody, waterFoamMask) * opacity;
}
`

/**
 * ─── Fragment: the chop, as a shading normal ────────────────────────────────
 *
 * Injected after `<normal_fragment_begin>`, the one slot where view-space
 * `normal` exists and nothing downstream has read it yet — `lights_fragment_begin`
 * copies it into `geometryNormal`, so the toon bands, the rim, the shadow tint
 * and the sparkle all pick this up together.
 *
 * `waterDetailSlope` is a world-space slope in the surface frame, so it converts
 * with `mat3(viewMatrix)` exactly as the vertex stage's does; on a flat sheet the
 * frame's U and V *are* world X and Z, which is why `(x, 0, y)` is the right
 * embedding. It is already multiplied by `vWaterFlat` at the point it is
 * computed, so a curtain — where that embedding would be wrong — gets zero.
 *
 * This is the whole of the user's "small waves": at 2 m and 1.2 m on a sea whose
 * swell is 11 m, and visible as texture, as a break in the toon band edges, and
 * above all as the spread that turns the sun's specular into a glitter path.
 */
export const WATER_NORMAL_FRAGMENT_GLSL = /* glsl */ `
{
  normal = normalize(normal - mat3(viewMatrix) * vec3(waterDetailSlope.x, 0.0, waterDetailSlope.y));
}
`

/**
 * ─── Fragment: banded sparkle ───────────────────────────────────────────────
 *
 * Injected after `SURFACE_FRAGMENT_GLSL` (the shared periwinkle shadow tint and
 * fresnel rim) and before `<opaque_fragment>`, so the glint sits on top of the
 * surface response instead of being tinted by it.
 *
 * **Two hard steps, not a Blinn lobe.** A smooth specular highlight on a cel
 * surface is what makes stylised water read as wet plastic; quantising it into
 * the same band structure as the rest of the shading is what makes it read as
 * sun caught on a facet (GDD R4).
 *
 * **The exponent is 58, and the ripple channel modulates the lobe rather than
 * being added to it.** Both halves of that were measured on screen.
 *
 * The detail slope now perturbs `geometryNormal` per fragment, so there is a
 * real spread of normals to catch the sun — which is what turns a highlight into
 * a glitter *path*, since a path is a slope distribution and nothing else. But
 * the previous form added the ripple sample *into* the specular before
 * thresholding, and once the normals spread that additive floor was enough to
 * pass the threshold on its own: the whole sea, including deep water 200 m off
 * the sun's bearing, came out peppered with white specks. Multiplying instead
 * means a fleck can only brighten a highlight that already exists, never create
 * one, so the glints collapse onto the lane where the sun actually is.
 *
 * **That was still not enough to draw a path, and the reason is geometric.** A
 * fleck can only brighten an existing highlight — but with the chop spreading
 * the normal by ~16° and a 58-exponent lobe passing its own threshold out to
 * ~18°, "an existing highlight" covers a 34° cone, which from a low camera is
 * most of the visible sea. Measured at the raised sparkle of 0.88: glints of the
 * right brightness, evenly scattered, marking nothing. So the block now carries
 * an explicit **path** term — the angular distance between the *unperturbed*
 * normal and the half vector — and both the glint and its coverage are gated on
 * it. See `waterPath` below for how its window was derived.
 *
 * The fleck mask is what keeps a *mirror-flat* pond from failing the other way.
 * On a pond every normal is identical, so the specular varies only through the
 * view direction: smoothly, and monotonically across the surface. A bare
 * `step()` on that draws its iso-contour as a clean curve, which on a flat disc
 * is very nearly a straight line — the pond rendered as two half-planes divided
 * by a hard seam. The mask makes that contour ragged and then punches it into
 * flecks, and the path term is smooth for the same reason: it can vary the
 * *density* of a random field across the pond without ever drawing an edge.
 *
 * The ripple channel is deliberately *not* pre-thresholded in the atlas (see its
 * header): the threshold is here, so the mip chain averages a smooth field
 * rather than a mostly-zero mask, and the glitter survives at the distance the
 * sun path is most visible.
 *
 * All of it comes from a *spatial* function, so it survives a `flowSpeed` of 0
 * and a still pond stays bit-exact still.
 *
 * `NUM_DIR_LIGHTS` is three's own define and is already part of its program key,
 * so branching on it here adds no program of ours. Without a directional light
 * there is nothing to glint off and the whole block compiles away.
 */
export const WATER_SPARKLE_FRAGMENT_GLSL = /* glsl */ `
#if NUM_DIR_LIGHTS > 0
{
  vec3 waterHalf = normalize(directionalLights[0].direction + geometryViewDir);
  float waterSpec = pow(max(dot(geometryNormal, waterHalf), 0.0), 58.0);

  // ── The path the glitter lies on ───────────────────────────────────────────
  //
  // **A sun path is a locus, and a specular step alone cannot draw one.** The
  // chop perturbs the shading normal by up to ~16° and a 58-exponent lobe still
  // passes a 0.10 threshold at ~18° off the mirror direction, so roughly a 34°
  // cone of the sea qualified — which on a low camera is most of the visible
  // water. Measured on screen at sparkle 0.88: glints of the right brightness,
  // scattered evenly over the whole sea like confetti, with nothing marking
  // where the sun actually is.
  //
  // What defines the path is the *mean* surface — the sheet without its chop —
  // mirroring the sun into the eye, and the brightness falls off with angular
  // distance from that. vNormal is exactly that normal: the vertex stage's
  // output, carrying the swell and nothing shorter, before waterDetailSlope
  // perturbs it two blocks up. Its ±9° of swell tilt is also what keeps the
  // path's edge ragged rather than a drawn oval.
  //
  // The window is set from the geometry rather than by eye. Looking along the
  // sun's own bearing this dot stays above 0.93 at every view elevation — which
  // is why a glitter path is long — while swinging 30° off that bearing at a
  // grazing 20° view drops it to 0.90 and 60° off drops it to 0.74. So the
  // useful range is the top ~15 % of the dot; 0.87 → 0.98 puts the road at
  // roughly ±20° of azimuth with soft shoulders, checked on screen against 0.84
  // → 0.975, which was wide enough that the lane still reached both edges of the
  // frame.
  #ifdef FLAT_SHADED
    vec3 waterBaseN = geometryNormal;
  #else
    vec3 waterBaseN = normalize(vNormal);
  #endif
  float waterPath = smoothstep(0.87, 0.98, dot(waterBaseN, waterHalf));

  float waterFleck = waterTapA.a;
  float waterSpecJittered = waterSpec * (0.30 + 1.60 * waterFleck);
  // Threshold well above the channel's mean, so the mask is zero over most of
  // the surface.
  //
  // **Sparse and bright, not dense and dim**, and the pond is what forced it.
  // A mirror-flat surface holds one half-vector across its whole width, so the
  // specular passes the low threshold *everywhere* and the mask is the only
  // thing setting coverage. With that mask at ~12 % and a 0.30 low tier, the
  // pond rendered as a scatter of hundreds of grey dots — gravel, not a mirror.
  // Verified by zeroing uSparkle at runtime: the speckle is entirely this
  // block, and the pond underneath is a clean gradient. Halving the coverage
  // and lifting the low tier to 0.55 turns the same budget of pixels into
  // glints that actually read as light.
  //
  // Coverage now *rises toward the middle of the path*, which is the other half
  // of what makes a road read as a road: dense and continuous where the sun is,
  // thinning to scattered points at its edges. Sliding both ends of one
  // smoothstep by waterPath buys that for two multiply-adds. Off the path it
  // lands at smoothstep(0.88, 0.96) — near enough the fixed mask this replaced,
  // which is what keeps the far sea from reading as sheen — and on it at
  // smoothstep(0.72, 0.86), the coverage the old mask had everywhere.
  float waterFlecks = smoothstep(0.88 - 0.16 * waterPath, 0.96 - 0.10 * waterPath, waterFleck);
  float waterGlint =
    (step(0.10, waterSpecJittered) * 0.55 + step(0.45, waterSpecJittered) * 0.45) * waterFlecks * waterPath;

  // A mix toward the sparkle colour, not an add. An additive lobe at the pond's
  // sparkle of 0.9 exceeds 1.0 wherever it lands, and a mirror-flat surface
  // holds one half-vector across its whole width — so the entire pond clipped
  // to white instead of catching a highlight. Mixing is bounded by construction
  // and gives the flat quantised patch R4 asks for anyway.
  outgoingLight = mix(outgoingLight, uWaterSparkle, waterGlint * uSparkle);

  // ── Droplets, on a curtain only ────────────────────────────────────────────
  //
  // Points rather than a lobe, and deliberately **not** gated on the sun's
  // half-vector: a fall's sparkle is light caught by airborne droplets from
  // every direction, and gating it on the specular would switch it off across
  // the whole shaded face of the curtain, which is exactly where the reference
  // has most of it.
  //
  // This is the waterfall pass's request, and its argument for putting it here
  // instead of in geometry is right: every part of a fall shares this one
  // material, so a 4 cm droplet quad has aShore 0 on all four edges and
  // renders as a solid white *square* at the foam colour and the style's alpha
  // floor. Making it read as a point needs sub-quad alpha, which is a shader
  // job by definition — and it would have cost 80–120 triangles per fall that
  // LOD1 would then have to drop, a silhouette change the crossfade shows.
  //
  // 1 - vWaterFlat is exactly "this is a curtain", the vertex stage already
  // computes it, and it is 0 on a pond — so this costs no uniform, no define,
  // no program, and does not disturb a still pond. The threshold is the atlas
  // author's own suggestion for reading the ripple channel as points rather
  // than as cells, and because the tap is compressed along aFlow the points
  // come out as short dashes sliding down the sheet.
  float waterDroplet = smoothstep(0.72, 0.95, waterFleck) * (1.0 - vWaterFlat);
  outgoingLight = mix(outgoingLight, uWaterSparkle, waterDroplet * uSparkle * 0.95);
}
#endif
`
