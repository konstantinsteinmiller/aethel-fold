# AAA-graphics — the rendering pipeline

Companion to [`GDD.md`](./GDD.md). The GDD is the *art and performance contract*
— the numbers a change must not violate. This file is the *pipeline*: what runs,
in what order, and why each stage is built the way it is.

Every number below was measured in a real browser (headless Chrome, RTX 4090
laptop, 1418×802), not estimated. Where a technique was tried and rejected, the
rejection is recorded — that is usually the more useful half.

---

## 1. The frame, in order

```
 rAF tick
 ├─ profiler.beginFrame            reset renderer.info, open GPU timer query
 ├─ worldUniforms.uTime += dt      one write reaches every material
 ├─ syncColliders()                only if levelRevision() moved
 ├─ camera update                  controller or player, by camera mode
 ├─ camera.updateMatrixWorld()     ← BEFORE any frustum test (see §2)
 ├─ lights.follow()                CSM re-fits its cascades to the camera
 ├─ updateLevelEditor()            aim ray; needs current camera matrices
 ├─ syncPlacementBatch()           swap batched ↔ pickable on editor toggle
 ├─ terrain.update()               stream, then cull + LOD live chunks
 ├─ scatter fields ×7              hierarchical cull + LOD + instance repack
 ├─ grass.update()                 residency, view-cone cull, tier + density ramp
 ├─ sky.position = camera.position keeps the dome closed at any distance
 ├─ renderer.render()
 └─ profiler.endFrame              close GPU query, percentiles, tag stats
```

### 2. Why the matrix update is where it is

LOD assignment frustum-tests against `camera.matrixWorldInverse`, and three only
refreshes that **inside** `render()`. Doing the update by hand first is not
tidiness — with it the other way round every system tests against a one-frame
stale frustum, which shows up as props popping in at the screen edge during fast
camera turns and is very hard to attribute after the fact.

---

## 3. Geometry: procedural, analytic normals, four tiers

Assets are generated at boot from seeded shape functions — no meshes ship.

**Normals are analytic**, central-differenced from the continuous shape
function, never taken from the tessellated mesh. This replaced an angle-threshold
smoothing pass at 38°, which measurement showed was wrong for these budgets: at
our tessellation adjacent faces meet at 36° (W=10), 60° (W=6) and 90° (W=4), so a
fixed threshold smoothed the fine tier and left the coarse ones faceted. The
*shading* then changed at every LOD boundary — and unlike a silhouette change, a
surface flipping smooth→faceted is something a dithered crossfade cannot hide,
because both tiers look wrong at 50 % coverage.

**Tiers are size-corrected on both axes.** A coarse tier inscribes inside the
true surface *and* its chords bulge outside concave stretches. Uncorrected tiers
ran 12–62 % off LOD0 by volume, and the crossfade showed the dither because the
silhouettes genuinely differed. `1/cos(π/W)^0.6` for a blob's section;
`sectionAreaInflate` × `profileVolumeInflate` for a loft.

**Every tier is checked for non-finite floats** before its budget assertion. This
guard exists because a NaN tier has a perfectly valid triangle count: `cliff.ts`
once shipped `(-0.006) ** 0.85` — NaN for a negative base with a fractional
exponent — which produced NaN normals on the crown ring, NaN colours through
`paintByUpness`, and rendered as solid black caps that every automated check
passed. **Comparisons against NaN are all false**, so `|len − 1| > 0.01` and
`lum < 0.005` both silently succeed. Use `Number.isFinite`.

---

## 4. Shading: one family, one program

`ToonMaterial` extends `MeshToonMaterial` and patches it in `onBeforeCompile`,
rather than being a `ShaderMaterial` written from scratch. Inheriting means
shadow maps, fog, instancing, skinning, vertex colours, tone mapping and colour
management keep working across three upgrades; a hand-rolled material would have
to re-implement each and would lose them one at a time.

Patched on top: banded gradient ramp, periwinkle shadow tint (never black),
mandatory fresnel rim, dithered LOD crossfade, foliage wind, and — chained last
— cascaded shadows.

**`onBeforeCompile` is a contended resource.** three's `CSM.setupMaterial` does
`material.onBeforeCompile = …`, a plain assignment. Calling it would silently
delete every patch above: the scene still renders, just without any art
direction, and nothing errors. `core/shadows.ts` therefore applies CSM's two
defines and three uniforms by hand and `ToonMaterial` chains into it.

The failure mode when that chain is missing is worth knowing, because it is
silent and total: `USE_CSM` is defined so the shader compiles the cascade branch,
which gates `RE_Direct` on the fragment's depth falling inside a cascade range.
With the uniforms absent that array reads all-zero, no cascade ever matches, and
**the direct light disappears entirely** — no shadows, no toon bands, no error.

`TerrainMaterial` extends `ToonMaterial` and chains again. `GrassMaterial`
extends it and chains a third time — it builds every blade from scratch in the
vertex shader and still inherits the ramp, the periwinkle shadows, the rim, the
fog and the cascades. Anything that patches shaders must chain, never assign.

Program count: **12–14** for the whole scene, 4 textures. Grass is the +1: a
second toon family, spent knowingly, and shared by all six of its tiers.

---

## 5. LOD: four tiers, dithered crossfade

Bands are ~15 % of each switch distance, scaled by a global `lodBias` (from FOV
and framebuffer height) and a per-asset `distanceScale`.

**The fade value is signed, and the sign is load-bearing.** Both tiers in a band
sample the same interleaved-gradient noise at the same pixel. If both used
`ign > fade → discard` they would keep the *identical* half of the pixels and the
other half would show background — holes, not a crossfade. The outgoing tier
(positive) keeps `[0, c)`; the incoming tier (negative) keeps `[c, 1]`.

**Outlines do not dither.** Only the tier with `|coverage| ≥ 0.5` draws one.
Dithering a 1.6 px line fails visibly: the two hulls sit a fraction of a pixel
apart, so the complementary patterns don't reconstruct and the silhouette becomes
a dotted crawl.

Share of instances mid-crossfade: **21 % by derivation, 29 % measured**. It is
set by the geometry of the problem (annulus over disc), not by camera speed.

**Grass is six tiers with no crossfade at all**, and that is the stronger form of
R7 rather than an exemption from it: its tiers differ in blade *population*, and
the population a patch draws is a continuous function of distance that agrees on
both sides of every boundary. Dithering it was tried and looks worse — the blades
a coarse tier lacks are drawn by the fine tier alone at 50 %, reconstructed by
nothing, and a half-tone on three-pixel geometry is a comb. It also pays none of
the 29 % double-draw above. Full reasoning in [`grass.md`](./grass.md) §4.3.

---

## 6. Culling: hierarchical, cell → instance

Instances are sorted into 48 m cells stored as contiguous runs. Each frame a cell
is classified once: `OUTSIDE` → skipped and marked **dormant** so later frames
cost nothing; `INSIDE` → all instances accepted with **zero** per-instance plane
tests; only `INTERSECTS` pays the full cost.

The second-order win is larger than the first. Per-instance culling made
membership churn on every camera *rotation*, which dirtied the instanced matrix
buffers and re-uploaded them every frame.

**Grass culls by a horizontal view cone instead of the frustum**, in the same two
levels (cell → patch). Three reasons, and only the first is speed: an exact 2D
cone/circle test is a dot, a cross and a compare against six plane evaluations;
it admits a **margin** the frustum cannot express, which is what stops grass
growing in at the screen edge on a fast turn (14° buys 840°/s at 60 fps); and
culling ground cover by *pitch* would drop the sward under the player's feet the
moment they looked up. Measured inside one build via
`GrassField.coneMarginOverride`: **1 240 → 422 patches (−66 %)**, grass triangles
−58 %, frame p50 −20 % on a rasterisation-bound machine.

Grass also does no dirty tracking, deliberately. `InstancedLodField` avoids
re-uploading matrices when membership is unchanged; for grass membership churns
on every camera rotation *by construction* — that is what the cone is for — so
the flag would be set every frame anyway. Repacking ~450 patches × 48 B is 21 KB,
cheaper to do than to think about.

Measured at 23 223 instances, same build, same scripted orbit, toggled live:

| | flat sweep | hierarchical |
|---|---|---|
| scatter CPU p95 | 1.30 ms | 0.90 ms |
| scatter CPU worst | 2.80 ms | **1.40 ms** |
| GPU | 5.88 ms | **3.28 ms** |

**Culling spheres are measured across every tier**, not from LOD0 and not from
the published `asset.radius`. Tiers are size-corrected against *each other*, so
the tier reaching furthest is routinely a coarse one; a hand-derived radius was
measured up to 27.7 % short. An undersized sphere doesn't look like a culling
bug — the prop vanishes at the screen edge while partly visible, which reads as a
streaming failure.

---

## 7. Streaming

Terrain chunks are generated on a Web Worker and returned as **transferables**
(zero-copy). Four rules keep it from being felt:

| rule | why |
|---|---|
| **Budget, don't burst** | Geometry construction and GPU upload are main-thread work no worker can take. ~2 ms/frame ceiling; measured max 2.2 ms (one-chunk granularity — the check runs after a chunk completes). |
| **Hysteresis** | Unload radius is 1.25× load radius, or pacing a boundary thrashes. |
| **Predict** | The load centre leads the camera along its velocity. |
| **Pool** | Nodes and GPU buffers are recycled; tier sizes are fixed so a recycled node's buffers are always the right shape. |

Scatter streams **on the back of terrain residency**, not its own — two systems
deciding independently what is loaded eventually disagree, and the failure mode
is a tree standing on a chunk that no longer exists. Placement is a pure function
of `(seed, chunk coords)`; if it depended on generation *order*, walking away and
back would reshuffle the forest behind you.

`heightfieldCore.ts` and `chunkGeometry.ts` are **three.js-free** so the worker
bundle doesn't ship a second copy of three (~150 KB), and so the worker and the
main-thread fallback run literally the same function.

Measured: unbounded (traversed to **1 399 m**; the old bound was 192 m), ~65
chunks resident, 60 fps, **0 janky frames**, boot build 900 ms → ~300 ms.

**Vertex compression:** normals `Int16`, colours `Uint16`, both *normalized* —
WebGL expands them in fixed-function hardware, so **24 B/vertex instead of 40
(−40 %)** with zero shader changes. Positions stay `Float32`: chunk-local, so
48 m already has millimetre precision, and quantising them is where faceting on a
gentle slope shows first. 16-bit not 8-bit because these colours are *linear* and
terrain greens sit at 0.1–0.4, where an 8-bit step is ~4 % relative.

---

## 8. Draw-call discipline

Instancing is the default, not an optimisation.

**Hand-placed level props are batched.** The editor gives every placement its own
`DitheredLod` — correct while editing, since you must be able to aim at one — but
that costs a draw call plus an outline draw each. Measured on a 40-prop level:

| | draws | level-prop draws | GPU |
|---|---|---|---|
| editor open (pickable nodes) | 304 | 86 | 4.13 ms |
| editor closed (**batched**) | **166** | **20** | **3.05 ms** |

The swap is reversible and rebuilds only on an editor *toggle*, never on an edit.
Batched placements are still spatially celled — one cell per definition would
span the whole level, never be fully outside the frustum, and put every instance
back on a per-instance plane test.

---

## 9. Shadows

Three cascades over the view depth (splits ≈ 0 / 0.175 / 0.396 / 1.0 of a 260 m
range), replacing a single 2048 map over a 120 m box that stopped casting 60 m
from the camera — the hard cap on view distance once terrain streamed past it.

Only one cascade contributes per fragment (`RE_Direct` is depth-gated), so three
lights do not triple the intensity.

**Grass never casts.** The shadow pass renders through three's own depth
material, which knows nothing about blades constructed in the colour shader — a
caster would be the undrawn patch geometry sitting at the world origin. Identical
argument to water's in `assets/types.ts`, and not a loss worth mourning: the
shadow pass is already 63 % of GPU time in a constrained frame (§12.3), and
self-shadowing grass at this blade size resolves to noise at any cascade this
world can afford. Grass *receives* shadows normally.

---

## 9b. Grass

`src/world/grass/` — the largest instance count in the world, and the cheapest
per instance. Documented in full in [`grass.md`](./grass.md); the pipeline-level
facts:

* **One instance per 4 m patch**, not per blade. 48 bytes per instance carrying an
  origin, four terrain corner heights, a hash, a ground tint and a live blade
  count. Blades are baked into a shared per-tier geometry once at boot and
  rebuilt into world space by the vertex shader.
* **6 draw calls, flat**, at every detail level — one per tier. +1 program.
* **6 LOD tiers**, differing in blade population rather than tessellation, with a
  continuous density ramp instead of a crossfade (§5).
* **View-cone culling** with a rotation-gap margin (§6).
* **No shadow, no outline, no texture.** Detail is a vertex-shader gradient over
  the ground colour sampled where the patch stands.
* **Wind fades out 26 → 48 m** and the two far tiers skip the block entirely on a
  draw-uniform branch. Sub-pixel motion reads as sparkle rather than as wind, and
  those tiers are 75 % of drawn patches.
* Measured cost at the reference config: **+6 draws, 6.1 k–97 k triangles,
  0.1–0.3 ms CPU** across the five levels, and **no measurable GPU cost** on a
  discrete GPU even at 14.7 megapixels with 228 k grass triangles at a locked
  60 fps.

---

## 10. Measurement

The perf panel (`cmonc`-independent; always available) reports fps, CPU ms,
**GPU ms** via `EXT_disjoint_timer_query_webgl2`, draw calls, triangles,
programs, geometries, and **p50 / p95 / p99 / worst frame time plus a count of
frames over budget** across a 240-frame window.

Percentiles rather than a mean, because a mean hides exactly what players feel: a
scene at a flawless 8 ms mean that spends one frame in sixty at 40 ms reads as
*stuttering*, and the mean moves by 0.5 ms.

**The uncapped frame rate (purple).** Next to the live fps the panel shows
`1000 / max(cpuMs, gpuMs)` and which of the two set it — the frame rate with
vsync taken out of the equation. Displayed because the green number is the most
misleading thing on the panel: a 6 ms scene and a 15 ms scene both read 60, which
is the whole reason this document keeps saying to judge by GPU ms. The purple
number says the same thing as a rate, so headroom is legible without reading a
second row. `max` rather than a sum, because the CPU builds frame N+1 while the
GPU draws frame N — the ceiling is the slower stage.

It is an **upper bound and an optimistic one**: `cpuMs` covers our loop between
`beginFrame` and `endFrame`, so compositing, GC, event dispatch and rAF overhead
are all outside it. Read a wide green/purple gap as "there is headroom here",
never as a promise of that number on an unlocked display. With no GPU timer it
reports the CPU ceiling alone and labels itself `cpu`, rather than implying the
GPU was checked and found faster. A typical reading on this desktop: **60 fps
displayed, 272 uncapped, GPU-bound** at 1.6 ms CPU / 3.7 ms GPU.

**Three panel states, each cheaper than the last.** `full` → `compact` (the
counters only) → `hidden` (a chip), remembered in `localStorage`. Minimising is
not just a `v-if`: `compact` stops copying the per-tag table, `hidden` stops
sampling altogether, and both clear `Profiler.collectTags`, which stops the
whole-scene tag walk at the source. This panel has already been caught
distorting the frame it was measuring — throttling its walk took a constrained
run from 47 fps to 58 — so an instrument nobody is reading should cost nothing.
The ablation profiler overrides the flag while it runs, so "measure" still works
from a collapsed panel.

**Ablation profiler.** On demand it hides one tag at a time and measures the drop
in GPU frame time, producing a ranked cost-per-tag table. Everything else is a
proxy: a tag with huge triangle counts may be nearly free (small on screen,
early-z rejected) while a tag with 200 triangles may cost 3 ms. Ablation measures
what you'd actually get back by deleting it.

**And it has a floor, which the grass work found.** On a desktop GPU this scene
runs at 3–4 ms against a 16.7 ms vsync, and hiding one tag does not move the
number out of the noise: in three runs the profiler reported `sculpt` — a tag
that draws nothing at all — at **2.24 ms**, and ranked a 57 k-triangle grass
field below it. Ablation is a ratio instrument and needs the frame to be
*loaded*. Where it reads noise, load the machine (a software rasteriser, a
constrained-device profile, `?density=N`) or report the deterministic counters
instead and say so.

**Instanced draws are counted from the geometry, not only from `InstancedMesh`.**
A plain `Mesh` carrying an `InstancedBufferGeometry` still draws instanced —
three decides that from the geometry and only decides `USE_INSTANCING` from
`isInstancedMesh`. Grass takes exactly that path, and before the tag walk learned
about it the panel billed grass **six draws and 1.8 k triangles** for six patches
while `renderer.info` reported 39 k. The ablation table would have ranked the
largest triangle source in the scene as the cheapest thing in it.

---

## 10b. Skinned characters

The first thing in this world that is not a rigid prop. `src/world/characters/`
is a procedural chibi humanoid: a rig (`rig.ts`), a mesh assembled from one
primitive (`limb.ts` → `chibiGeometry.ts`), a `Skeleton` built from the bind pose
(`skeleton.ts`), and locomotion as functions of stride phase (`poses.ts`).

**Cost, measured, three characters under mobile + 4× CPU:**

| characters | draw calls | triangles | programs |
|------------|------------|-----------|----------|
| off        | 70         | 65.5k     | 11       |
| on         | 79         | 71.4k     | 11       |

Three draws and ~1 962 triangles each — body, outline hull, shadow — and
654 triangles per mesh against the GDD's 700 ceiling. Posing all three costs
0.1–0.3 ms of CPU: a pose is ~20 `Euler` writes and allocates nothing.

**The program count is the real price.** Adding characters took the scene from
**7 programs to 11**, against a ≤13 budget. `USE_SKINNING` forks every program a
skinned mesh touches — toon, outline, and the shadow depth material. That is a
fixed cost for the whole character family however many characters exist, but it
is most of the remaining headroom, and a second skinned material family would
not fit.

### What skinning broke, and how

**The outline hull had no skinning at all.** It is a hand-written
`ShaderMaterial`, so unlike `ToonMaterial` — which inherits `MeshToonMaterial`
and gets skinning free — it would have stayed in bind pose while the body walked
out of it. It works now because three decides skinning from the *object*:
`skinning: object.isSkinnedMesh === true`, so `USE_SKINNING` is defined and
`bindMatrix` / `bindMatrixInverse` / `boneTexture` are uploaded for **any**
material on a `SkinnedMesh`, with `skinIndex`/`skinWeight` declared by three's
vertex prefix. Adding the four `#ifdef`-guarded chunks was enough.

The normal has to be skinned too, not just the position. The hull is extruded
*along the normal*, so a bind-pose normal on a posed vertex pushes it the wrong
way and the outline thickens and thins as a limb rotates.

**Body and outline share one skeleton**, not two kept in sync. There is one set
of bone matrices and both meshes read it, so a pose reaches both or neither.

### The legs were mirrored, and the test agreed with them

The first cycle looked wrong, and it was: **legs swung backwards and knees bent
forwards**. Both signs were inverted.

Every bone in this rig points down and the character faces +Z, so rotating a bone
about +X moves its tip *backwards*. Measured, not assumed:

    shin.rotation.x = +0.8  →  foot z = −0.194, y = +0.142
    shin.rotation.x = −0.8  →  foot z = +0.194

So hip flexion is **negative** `rotation.x`, knee flexion is **positive**, and the
original code had both the other way round.

**The unit test asserted `shin.rotation.x <= 0` and passed**, because it had been
written from the same wrong assumption as the code. That is the durable lesson
here: a test on a raw rotation sign cannot distinguish a correct rig from its
mirror image. Every assertion in `gait.test.ts` now reads a **bone's world
position after posing** — is the foot in front of the hips at heel strike, is the
signed thigh-to-shin angle ever negative — and the first of those would have
failed on the first run.

### Curves from gait analysis, not sine waves

`gaitCurves.ts` holds sagittal hip, knee and ankle angles over the cycle, keyed
to the shape of standard clinical gait data (Winter). Sparse keys, sampled with
Catmull–Rom — linear segments put a corner at every key, and a corner in a joint
angle is an infinite acceleration that reads as a tick at heel strike.

The feature that matters most is the **loading response**: the knee flexes ~18°
shortly after heel strike to absorb bodyweight, then straightens before the big
swing flexion. It is what makes a walk look heavy, it is a second peak in the
knee curve, and no single sine wave can produce it. A test asserts it exists.

**Running is not a fast walk**, and the differences are structural:

| | walk | run |
|---|---|---|
| pelvis at mid-stance | **highest** — vaults over a straight leg | **lowest** — knee absorbs |
| peak knee flexion | ~62° | ~125° |
| elbow | ~25°, loose | held ~90° throughout |
| trunk | upright | leaning |

The inverted vertical rhythm is the one that matters: reusing the walk's rise
curve at a larger amplitude is exactly what makes a run read as a hurried walk.
Tests assert the inversion, the doubled knee flexion, the folded elbows and the
lean.

**Jump** is a one-shot clip with five beats — anticipation, drive, rise, fall,
landing — where the crouch and the recovery are most of the runtime. A jump
without them reads as weightless however the physics is tuned.

Stride phase advances with **distance travelled**, not wall time. A cycle on a
clock slides its feet the moment speed changes, and foot-slide is the most
legible animation error there is — which is also why the sample characters walk
and run circles rather than standing still: a locomotion cycle on a stationary
figure always reads as moonwalking, however correct the joint angles are.

### An elbow is not a knee

The arms were inverted too, and for longer: forearms trailed *behind* the body
through every animation. The cause is one line of anatomy that the leg fix did
not generalise to — **a knee folds backwards, an elbow folds forwards**. Both
were written with the same sign. Verified against the rig rather than reasoned:

    forearm.rotation.x = -1.4  ->  hand z = +0.187   forward, correct
    forearm.rotation.x = +1.4  ->  hand z = -0.187   behind the body

All three call sites — gait, jump and idle — had it positive.

**The test that should have caught it took an absolute value.** It read
`Math.min(straightest, Math.abs(flexion))`, so a fully inverted elbow passed as
long as it was bent by *some* amount. `arms.test.ts` replaces it and never takes
`Math.abs` of a joint angle: it asserts signed elbow flexion stays positive
across 64 phases of walk, run, the walk-to-run blend, the jump and the idle, on
both sides.

That is the same lesson as the legs, one level down. The legs were fixed by
asserting world positions instead of rotation signs; the arms slipped through
because a *world-space* test can still discard the sign it just computed.

### The rest of the arm

Fixing the fold direction left three things that still read as mechanical, all
now addressed:

* **The wrist was never posed at all.** The `hand` bones existed and stayed at
  bind. A hand rigidly continuing the line of the forearm is one of the
  strongest tells of a puppet, so there are now `*_WRIST` curves — small, and
  larger in a run, where the hands are carried as loose fists.
* **The shoulder girdle was never posed either.** It now protracts as the arm
  swings forward and retracts behind. Subtle, but its absence is what makes an
  arm look bolted to a torso rather than slung from it.
* **Arms swung in two fixed parallel planes.** They now draw toward the midline
  as they come forward, weakly in a walk and strongly in a run, which is what
  real arms do. A test asserts the run's hands come closer to the body's centre
  line than the walk's, and a second asserts they never pass through the torso.

### Motion drives the animation, never the other way round

The characters walked sideways and backwards. The demo declared each one's speed
and computed its facing by hand, and the formula was a quarter turn out:

    velocity around the circle = (-sin a, cos a)
    correct facing             = atan2(vx, vz) = -a
    what was written           = atan2(cos a, -sin a) = a + pi/2

Patching the formula would have fixed the symptom. Instead a `Character` now
**measures** its own velocity from how far its group actually moved since the
last frame, and derives everything from it: speed, gait, heading and bank. The
demo only moves it. A declared speed that disagrees with the travel is the
mechanism behind every foot-slide, and a hand-written heading is the mechanism
behind walking sideways — making both outputs rather than inputs removes the
whole class.

`characterMotion.test.ts` sweeps **sixteen headings** and asserts the character's
forward vector agrees with its travel direction at every one. Two axes would
have passed on a formula that was wrong on the other two.

### Blending, so nothing snaps

* **Walk to run is one continuous blend**, weighted by measured speed and
  interpolated at the *sample* level rather than by cross-fading two finished
  poses. Walk and run share a structure — both are heel-strike-at-zero cycles
  over the same joints — so interpolating the angles leaves a valid gait at every
  weight, where cross-fading two poses taken at different points in their cycles
  produces a leg that is briefly in neither.
* **Standing is a blend target too**: below a walking pace the gait fades into
  the breathing idle instead of freezing mid-stride.
* **Turning is rate-limited and banked.** The body turns toward its heading at a
  bounded rate and leans into the turn in proportion to how hard it is being
  taken, split across spine and head so the eyes stay level.

### The player was a ghost

The capsule player on `/` works and always did — the "Walk" button calls
`setCameraMode('firstPerson')`, WASD moves it, and it tracks the terrain exactly
(`feetAboveGround = 0`, eye height 1.69 m, measured). But its **root group was
never made visible**: `setThirdPerson` was the only thing that showed it and
nothing called it. So the player cast no shadow and left no trace, which is
reasonably indistinguishable from not being there.

The body is now visible whenever the player is enabled. In first person the
capsule's own material is `FrontSide`, so from a camera inside it the near faces
are culled and nothing obstructs the view; only the outline needs hiding,
because `BackSide` is exactly what would fill the screen from inside.

**Cost: 2 programs, 12 to 14.** That is over the ≤13 in GDD §5 and worth stating
plainly rather than absorbing. One of the three was avoided — the capsule's
outline program never compiles, because the mesh it belongs to is never
rendered in first person.

### Departures from the GDD, deliberate

* **Procedural, not glTF.** GDD §6 Phase C plans skeletal animation via glTF.
  There are no character assets in the repo and everything else in this world is
  generated from a function, so the mesh and the cycles are too. The engine paths
  are identical — `SkinnedMesh`, `Skeleton`, skin attributes — so an imported
  character drops into the same pipeline.
* **No baked vertex AO**, alone among everything in the world. AO is baked in
  bind pose; the darkest thing it finds is the arm against the ribcage, and that
  shadow walks out into open air the moment the arm swings.
* **No LOD tiers yet.** Every other object ships four (GDD R7). Characters ship
  one. The GDD's plan — tiers sharing one skeleton so a switch never re-binds a
  skin — still stands and is the next piece of work.
* **Over the program budget.** The scene now compiles 14 against the ≤13 in
  GDD §5: skinning forks toon, outline and shadow depth for the character
  family, and the visible player body adds two more. Worth a pass before the
  next material family lands.
* **No face.** Planned as a separate normal-flattened cap so toon bands never cut
  across it. The hairline is currently the only facial feature.

---

## 10c. Collision

Two paths, because the two kinds of prop are nothing alike.

**Hand-placed props** — platforms, pillars, plateaus, anything the level editor
puts down — go through `PlayerCollisionWorld`'s placement path: a `Placement`
carries a `defId`, the catalogue resolves it to an analytic collider, and the
list is rebuilt only when the level changes. Correct for the few dozen props a
level holds. This always worked.

**Scattered props** — trees, boulders, stones — never had a collider at all, and
the player walked through every trunk in the world. The level had collision and
the *forest* did not, which is why it was easy to miss.

They cannot use the same path. Scatter arrives per terrain chunk from a seeded
function, and there are tens of thousands of instances resident at once —
**2 603 measured** in a normal view. Resolving a catalogue entry and a trig pair
per instance, and rebuilding wholesale when anything moves, is the wrong shape
for that by three orders of magnitude. The player can only touch the handful
within a stride.

So `scatterColliders.ts` is a spatial index keyed by the residency unit that
already exists — the terrain chunk. Instances are stored as flat
`Float32Array`s, five floats each, and a query walks the 3×3 chunk neighbourhood
around the player: at a 48 m chunk that is at most nine map lookups however big
the world gets. The result is pushed into the collision world as *transient*
colliders, refilled every frame immediately before the move that consumes them,
and appended past the placement list so the hot loops stay one contiguous walk
over one array.

| | placements | scatter |
|---|---|---|
| identity | `defId` + transform | world-space instance |
| resolved | on change | every frame, near the player only |
| count | tens | ~2 600 resident, ~0–10 in reach |
| walkable | per definition | never — a trunk is not a floor |

Measured end to end: the player walked from 3 m at a tree and stopped at
**0.61 m**, which is exactly the trunk radius (0.26 at that instance's scale)
plus the player radius (0.35).

**Collider radii are the trunk, not the silhouette.** `asset.radius` is the
bounding sphere, which for a tree is its canopy — using it would ring every
tree in the world with a two-metre invisible wall. Stones are given a height
*below* the player's step height on purpose, so ankle-high rubble is stepped
over rather than walked into; a world where every pebble stops you feels like it
is made of glue.

### The player's body

The player is now the same chibi rig the NPCs use, scaled to the capsule's
height (1.8 / 1.56 = 1.154 — unscaled, the 1.7 m eye would float above the
character's own head). It walks with the real gait, casts a shadow, and jumps on
the controller's leaving-the-ground edge rather than on the key, because the
controller buffers input and the two can differ.

`body: 'capsule'` still builds the old placeholder. That is not sentiment: the
capsule *is* the collision shape, so for collision work it is the better view —
any disagreement between what you see and what you hit is visible rather than
hidden inside a silhouette.

---

## 10d. Day and night

One in-game day in 24 real minutes. The sun rises in the east, arcs over at
~69° (not overhead — a zenith sun casts every shadow directly under its object,
which reads as no shadows at all), sets in the west, and drags the shadows, the
sky, the fog and the ambient with it. `core/dayCycle.ts`.

### It is cheap because of what it is allowed to touch

Checked first, not last. Everything the cycle moves is a **uniform or a light
property**: sun colour and intensity, the sky dome's `uZenith`/`uHorizon`, the
scene fog colour, the hemisphere fill. So a full cycle costs about a dozen float
writes per frame and rebuilds nothing.

That is not a given. The palette's *surface* colours are baked into vertex
attributes at generation time, so tinting the world by rewriting those would
mean regenerating every asset four times a minute. The cycle deliberately only
moves the lighting rig. A test asserts the uniform objects are written **in
place** rather than replaced — a replaced value also severs three's shared-
uniform wiring, silently.

Night keeps **one** directional light, flipped to face the moon, rather than
adding a second. Two lights would double the shadow cost of a scene already
spending most of its draw calls on shadows.

### The saving, and what it cost to make it free

Half of every cycle is night, and a night shadow map is three cascades of draw
calls rendering shadows nobody can see — moonlight at this intensity is below
what the toon ramp can band. So the shadow pass switches off below the horizon:

| | draw calls | triangles |
|---|---|---|
| noon | 146 | 94.2k |
| midnight | **100** | **78.8k** |

−32 % draws and −16 % triangles for half the day.

**It very nearly was not worth it.** Turning `castShadow` off changes three's
program key — `numDirectionalShadows` goes 2 → 0 — and **every material in the
scene recompiles**. Measured, the first dusk cost a **400 ms frame** (programs
12 → 17); transitions after it cost 17 ms, once both variants were cached. A
32 % draw-call cut that hitches for 400 ms twice a day is not an optimisation.

The fix is the one the shader warmup already exists for: `World.warmUp()` now
renders one pass with shadows off and one with them on, so both variants are
compiled behind the splash. After that, measured across three transitions:

| transition | before | after |
|---|---|---|
| first dusk | 400.1 ms | **17.8 ms** |
| first dawn | 17.0 ms | 16.9 ms |
| second dusk | 18.8 ms | 17.0 ms |

Same lesson as §12.1: the cost cannot be removed, only moved to where nobody is
looking.

### Sunrise and sunset

Dawn and dusk share one warm colour set. They are not the same colour in life —
dawn is cleaner, dusk dustier — but at this saturation the difference is below
what the toon ramp resolves, and a second set would be two more lerps for a
distinction nobody can see.

The golden band is applied as an *addition* on top of the night→day blend rather
than as a third state the sky passes through, and it is gated on the sun being
near the horizon **from either side**, so it fades back out at night instead of
staying lit.

---

## 10e. Editing a procedural world, and shipping the edits

Every object in the world is removable and movable from the in-game editor, and
those changes can be written back into the repository as a **world patch** that
travels to other machines. Two very different kinds of object had to be made to
look the same from the user's side.

### Why scatter is not turned into placements

The obvious reading of "make everything editable" is to convert each tree, stone
and boulder into an editor `Placement`. It does not survive contact with the
numbers. There are ~2 300 scatter instances resident at a 240 m load radius and
~20 000 across a walk; they arrive per terrain chunk from a seeded function and
the set changes as you move. As placements they would be a save file measured in
megabytes, a collider rebuild over the whole list on every edit, and a streaming
system whose contents are suddenly global state.

So the generator stays authoritative and the editor keeps a **sparse override
layer** on top of it (`world/level/scatterOverrides.ts`):

* **Tombstones.** A deleted instance is remembered by key. The generator still
  produces it; the chunk loader filters it out between generation and the field,
  so it reaches neither the renderer nor the collider index.
* **Additions.** A *moved* scattered prop is a tombstone plus an ordinary
  placement — which the editor already knows how to store, render, collide with
  and export.

The override set is only as large as what the user actually changed, which is
also exactly the shape of a distributable patch. One structure serves the editor,
the save file and the export.

### The key has to survive regeneration

A tombstone is useless if it cannot recognise its instance after the chunk
unloads and comes back. An index into the generator's output would depend on
iteration order, rejection tests and the RNG. The key is the **species plus the
position quantised to a centimetre**, because that is what the generator is a
function *of*: same seed, same terrain, same position, forever. It does not
survive a terrain-seed change or a spacing change — correct and unavoidable,
since those regenerate the world and a tombstone for a tree that no longer
exists should be dropped rather than honoured somewhere else.

### Picking something with no scene node

Scatter cannot be raycast. The fields are `InstancedMesh`es whose slots are
repacked every frame by the LOD and culling passes, so three.js's `instanceId`
names a *slot*, not a prop, and means something different on the next frame.

`ScatterColliderIndex.nearestToRay` answers the aim instead, testing the stored
collider cylinders. Chunks are gathered by walking the ray in quarter-chunk steps
and visited once each, so the scan is bounded by how many chunks the ray crosses
rather than by the size of the world. A positional `nearest()` around the terrain
aim point is kept as a fallback for the cases the cylinders are too small for
(looking down at a stone from above).

A ray test rather than a position test because they fail in opposite situations:
looking at a tree from the ground, the terrain under that aim is metres *behind*
the trunk, so a position-based pick selects the wrong prop or none.

### The export has to be a diff, and it has to accumulate

The naive export writes out every placement. That works exactly once: the second
export contains the shipped starting level as well as the user's additions, so
applying it on top of a world that already seeds the starting level duplicates
everything in it.

The subtler trap is what the diff runs *against*. Diffing against "starting level
+ current patch" makes everything the patch already contains compare equal, so
the next export writes only what changed since that patch — and since the export
replaces the file wholesale, the previous session's work disappears from it.
**The baseline is `STARTING_PROPS` alone.** A patch then always restates
everything it is responsible for, which is what makes overwriting it safe.

Caught in the browser, not in a test: two consecutive editing sessions, and the
first session's prop was missing from the second session's patch.

A patch has three parts, and a *move* needs two of them — `placements` for where
the prop ended up and `removedPlacements` for the starting prop it came from.
With only the first, a fresh install seeds the original and puts the moved copy
beside it.

| Mode | `placements` | `removedPlacements` |
|---|---|---|
| `delta` | added + moved-to | deleted + moved-from |
| `full` | the whole scene | every starting prop |

Both round-trip: boot with the patch applied, export again, and the file is
byte-identical.

### Export means *write the file*

dreamion documented this trap the hard way: its first export copied a blob to the
clipboard and called it done, which is not an export at all — it leaves the work
one missed paste from gone, with nothing to say whether the paste happened.

The dev server exposes `POST /__editor/save-world-patch`, which overwrites
`src/world/level/worldPatch.generated.ts`. The change lands in `git diff`, which
is where a world patch has to be if it is going to be reviewed and distributed.
The clipboard is the fallback for a production build with no server to write
with. The endpoint gates on the payload already looking like the module it
replaces, since it writes into `src/`.

The plugin also **suppresses HMR for that one file**. It is imported by
`World.ts`, so Vite's default response to it changing is a full reload — which
fires a second after the button is pressed, wipes the confirmation that says the
export worked, and throws away the camera position and everything else the
session was holding. The editor has already applied the change live; the file is
for the next boot. Without this the button reads as doing nothing.

### The focus billboard

The verbs were reachable only as key bindings, which is fine once you know them
and useless before: nothing on screen said a tree could be deleted, so the
feature was invisible to anyone who had not read the source.
`EditorFocusCard.vue` floats a card over whatever the crosshair is on. Every
button is also a shortcut, and the shortcut is printed on the button.

It is split across two channels, and the split is the whole design:

* **Identity** (`editorFocus`) is a `ref`, written only when the focus *changes*
  or the focused prop is edited — a few times a second at most.
* **Position** (`editorFocusScreen`) is a plain module object mutated every
  frame by the scene, read from the component's own `requestAnimationFrame` and
  written straight to `style.transform`. It never touches a Vue proxy.

A HUD that tracks a moving object updates at frame rate, and routing that through
reactivity would put a Vue patch pass on the render loop — the coupling GDD §0
keeps three.js and Vue apart to avoid. The rAF starts and stops with the mode, so
the card costs nothing while the editor is off.

The card shows only the verbs that apply. A scattered prop can be deleted and
moved; it cannot be rotated, scaled or lifted in place, because there is nothing
to write those to short of turning it into a placement — which is what Move does.
Its border carries the state: cyan aimed, gold in hand, green scattered, the same
colours the scene-side outline highlight uses.

Verified in the browser: the card's bottom edge sits on the projected anchor to
the pixel. It renders *under* the palette and perf panels, which is the right
order — the palette has to stay clickable — so a prop behind the chrome shows a
card you cannot read until the panel is minimised.

### Measured, in the browser

| Step | Result |
|---|---|
| Aim at a tree, press X | colliders 2260 → 2259, tombstone written to `localStorage` |
| Reload | tombstone survives, and the instance is **not regenerated** at that position |
| Aim at a stone, press F then G | colliders −1, tombstones +1, placements +1, persisted |
| Export to code | `Wrote src/world/level/worldPatch.generated.ts · +1 ~0 −0 · 2 scatter` |
| Boot a fresh browser with that patch | starts at 2258 colliders and 2 tombstones — the patch applies with empty `localStorage` |
| Second session, export again | 2 placements, 4 tombstones — the first session's prop is still there |
| Export with no edits | file identical, byte for byte |

---

## 11. Rejected, and why

| Technique | Why not |
|---|---|
| **TresJS** | Wraps every scene node in a Vue reactive proxy. Thousands of instanced transforms and per-instance fade attributes rewritten per frame is exactly the overhead this can't afford. |
| **`CSM.setupMaterial`** | Assigns over `onBeforeCompile`, silently deleting every art-direction patch. Composed by hand instead. |
| **Cross-billboard LOD3** | With no prop textures there is no alpha mask, so crossed quads render as literal rectangles. LOD3 is a solid impostor blob. |
| **Textures / atlasing** | The vertex-colour approach is *why* the scene is 11–13 programs and 4 textures. Adding textures would trade a structural win for a marginal one. |
| **Raycasting terrain for the editor's aim** | `Raycaster` ignores `object.visible` and `DitheredLod` keeps all four tiers mounted, so it hits the LOD3 silhouette and the 2.5 m chunk skirts. Replaced with an analytic heightfield march. |
| **8-bit vertex colours** | Linear colour space; terrain greens at 0.1–0.4 band at ~4 % relative steps. |
| **`InstancedMesh` for grass** | Forces a 64-byte `instanceMatrix` and a 4×4 multiply per vertex for a transform that is one position and one hash. A plain `Mesh` + `InstancedBufferGeometry` renders instanced *without* defining `USE_INSTANCING`, so grass carries its own 48-byte stream. |
| **One instance per blade** | 400 000 instances × 64 B is 26 MB and a per-blade CPU loop. The patch (4 m, ~380 blades) is the right instancing unit. |
| **Dithered crossfade on grass** | Its tiers differ in population, so the non-shared blades dither against nothing and render as hatched combs. Replaced by a continuous per-blade density ramp — better *and* free. |

---

## 11b. Horizon occlusion — built, measured, defaulted off

`perf/TerrainOcclusion.ts` culls cells hidden behind ridges by marching the
analytic height field from the eye. It is correct and it works: **27 of 290 cells
occluded** standing in a valley, trees 394 → 314 instances (−20 %), boulders
31 → 9 (−71 %), triangles −5.4 %.

It is **off by default anyway**, because it bought no frame time:

| run (9× density, valley) | GPU off | GPU on | delta |
|---|---|---|---|
| 1 | 8.12 ms | 3.56 ms | −4.56 ms |
| 2 | 3.07 ms | 3.27 ms | +0.20 ms |
| 3 | 3.30 ms | 3.26 ms | −0.04 ms |

Run 1 was an outlier — the "off" sample was taken while chunks were still
streaming. **Runs 2 and 3 are the truth: no measurable gain.** The scene is not
GPU-bound (3.3 ms against a 16.7 ms budget), and three already sorts opaque
front-to-back, so most of what this culls was being early-z rejected for free.

Two things worth recording beyond the result:

* **The first A/B measured nothing at all**, because disabling the feature did
  not clear consumers' cached `occluded` verdicts — so both samples ran with
  culling effectively on and reported a saving of exactly zero. Any cached cull
  must invalidate on toggle, or the toggle silently compares a state with itself.
* **The first implementation probed the wrong height.** It aimed at
  `centre + boundingRadius`, and a 48 m cell of 7 m trees has a ~35 m radius made
  almost entirely of horizontal spread — so it sampled 35 m above the treetops
  and culled 1 cell in 120. Occlusion needs the *top of the tallest thing* and
  the *horizontal half-extent* as separate quantities.

Re-measure on the real target (a mid-range Android). Tile-based GPUs handle
overdraw very differently from the desktop part this was measured on, and that is
where this most plausibly starts paying.

## 11c. Adaptive quality

`perf/AdaptiveQuality.ts` drives quality from **measured GPU time**, because the
shipping target is a mid-range Android at 0.75× render scale while development
happens on a desktop GPU with five times the headroom — a hand-tuned level is a
level tuned for the wrong machine by definition.

**The knob order is the design.** The brief was "reduce machine strain without
losing near-field asset quality", so knobs are spent in the order that costs the
player least: crossfade band width first (21–29 % of instances are drawn twice —
the cheapest thing to give up), then far LOD distances, then render scale last
and never below 0.7, because outlines are 1.6 *screen pixels* and break up.

**LOD distances degrade non-uniformly.** Each tier boundary is scaled by
`quality ** exponent` with exponents `[0.25, 0.6, 1.0, 1.2]`. A single uniform
multiplier — the obvious implementation — would halve LOD0's range at quality
0.5, so the first thing a struggling machine loses is the detail on the object
the player is standing next to. Measured ladder:

| level | render scale | LOD0 range | cull | triangles | draws |
|---|---|---|---|---|---|
| ultra | 1.00 | 31 m | 320 m | 69 145 | 166 |
| high | 1.00 | 29 m | 320 m | 60 045 | 158 |
| medium | 1.00 | 27.5 m | 320 m | 52 721 | 160 |
| low | 0.85 | 21.5 m | 214 m | 33 262 | 122 |
| minimum | 0.70 | 16.5 m | 129 m | 16 249 | 96 |

`medium` costs **24 % of the triangles for 3.5 m of near-field range**. End to
end it is −76 % triangles and −42 % draws for a 47 % cut in LOD0 distance.

**It drops fast and rises slowly**, asymmetrically and with a cooldown. Dropping
late means the player already felt the stutter; rising eagerly means oscillating
between two levels, which is more noticeable than simply sitting one lower. A
signal parked in the dead band, or alternating either side of it, provably
produces no change — both are pinned by tests.

The state machine is verified by unit test rather than in a browser: the world's
own frame loop samples the controller every frame, so any in-page probe races the
real driver and measures their interleaving rather than the logic. That mistake
cost a confusing measurement before the tests were written.

## 11d. Profiling under constrained-device emulation

Every number above this section came from an RTX 4090. The shipping target is a
mid-range Android. `scratchpad/cdpMobile.mjs` adds three independent constraints
over CDP — CPU throttling, phone viewport + DPR, and a software rasteriser — and
installs them **before navigation**, so boot itself is measured rather than
escaping unthrottled.

### What it found

| | desktop | mobile viewport | mobile + 4× CPU |
|---|---|---|---|
| fps | 60 | 60 | **32** |
| CPU / frame | 3.5 ms | 5.4 ms | **56.8 ms** |
| GPU / frame | 2.9 ms | 6.3 ms | 15.4 ms |
| p99 | 17.1 ms | 17.0 ms | **216.7 ms** |
| janky frames | 2/240 | 1/240 | **144/240** |

**The world is CPU-bound on a constrained device, not GPU-bound** — the opposite
of what every desktop measurement suggested. Per-tag CPU accounted for only
2.26 ms of a 15 ms frame; the rest was render submission and, it turned out, the
profiler itself.

### The profiler was one of the most expensive things in the frame

`collectTagStats` walks the entire scene graph. The panel reads it at 8 Hz; it
was running at 60 Hz. Throttling it to every 6th frame, under mobile + 4× CPU:

| | before | after |
|---|---|---|
| fps | 47 | **58** |
| p95 | 66.7 ms | **16.9 ms** |
| p99 | 83.3 ms | **33.4 ms** |
| janky frames | 74/240 | **6/240** |
| quality settled at | `minimum` | **`low`** |

An instrument that distorts the frame it measures is worse than no instrument.
`FrameStats.profilerMs` now reports the profiler's own cost, for the same reason.

### The adaptive controller was blind on exactly the machines that needed it

On a software rasteriser there is **no `EXT_disjoint_timer_query_webgl2`**. The
controller was written to do nothing without it, reasoning that frame time is
pinned to vsync and therefore uninformative — true only *while frames are being
hit*. Measured: 2 fps, 517 ms p50, controller sitting at `ultra` with **zero
changes**.

Two fixes, both evidenced:

* **Frame-time fallback**, asymmetric. A frame time well past vsync is
  unambiguous and may drop quality; a frame time *at* vsync only proves we are
  not currently failing, so it counts as headroom for the slow raise path and
  nothing more.
* **A panic path.** Thresholds count *samples*, and samples arrive one per frame
  — so a failing machine also produces evidence slowly. At 3 fps, `dropAfter: 20`
  meant 7 seconds per level and ~35 seconds to reach the bottom. Past 2.5× budget
  the controller drops on 3 samples with a shortened cooldown.

| software GL | original | + fallback | + panic |
|---|---|---|---|
| fps | 2 | 3 | **7** |
| p50 | 516.7 ms | 350 ms | **166.7 ms** |
| quality changes | 0 | 1 | **4 → minimum** |

### Boot: 77 % of it was one call

Phase timing (`WorldBuildInfo.phases`) put **521 ms of a 660 ms desktop boot in
`registerAllPlaceables()`** — 34 placeables, 164 LOD tiers, all generated
synchronously before the first frame. Under a 4× CPU throttle that boot was
4.8 s.

Nothing in the first frame needs it: terrain streams itself and the scatter
species are generated separately. It now runs **after the first frame is on
screen**, using machinery that already existed — the editor parks a placement
whose `defId` isn't registered as an orphan, and `rehydrateLevel()` spawns it
when the definition arrives. That path was built for asset-module ordering and
turns out to be exactly what deferring needs.

| blocking boot | desktop | mobile + 4× CPU |
|---|---|---|
| before | 660 ms | 4775 ms |
| after | **178 ms** | **728 ms** |

**This moved the cost, it did not remove it.** The generation block was still
2.4–4 s under throttle; it just landed after the world was visible rather than
before. That is the right trade for a web game — a blank screen is what loses
players — but it is not the fix.

### Deferring is not dividing: slicing the catalogue

`buildDefinitions()` was one 700-line function returning an array literal, and an
array literal evaluates all 34 elements before it returns — so no scheduler could
enter it. It is now an array of **factories** (`() => ({…})` per row), drained by
`registerPlaceablesIncremental(budgetMs)` under the same 2 ms frame budget as
terrain chunk uploads. `registerAllPlaceables()` still exists and still blocks,
for tests and tools; it calls the incremental form with `Infinity`, which never
satisfies the stopping rule, and *resumes* rather than restarts.

The budget is checked **after** each row, not before. Checked before, a 2 ms
budget would never start a 90 ms row and the drain would never finish; checked
after, one placeable is always the minimum unit of progress. That granularity is
the design's floor and it is not small — see the table below.

| mobile + 4× CPU | before | after |
|---|---|---|
| `longestStallMs` | 2400–4000 ms | **633 ms** (which is now boot, not the catalogue) |
| drain shape | one block | 32–33 frames, ~2.2–2.9 s of work |
| during the drain | frozen | ~9–11 fps, worst gap 567 ms |
| settled quality | `minimum` | **`high`** |
| settled p99 / jank | — | 17.9 ms / 0 |

Two things that are *not* improvements and should not be read as such: the total
work is unchanged, and the drain is not smooth. It is ~3 s at roughly 10 fps
instead of ~3 s at 0 fps. What that buys is a loop that keeps turning — input is
read, the camera moves, the world visibly fills in — which is the difference
between "loading" and "hung".

**Generation cost is now measured per asset** (`World.assetBuildCosts`, exposed
off the world rather than imported, because a `import('…/assets')` from a probe
gets a second module instance under Vite). The distribution has a long head and
no single culprit: worst is `basalt-cluster` at 309 ms (9.3 % of 3321 ms), the
top 8 are 47 %, and the two rock props are under 1 ms each. So the ~300 ms floor
on a single slice is inherent to per-placeable granularity, not one bad asset —
going below it means slicing *within* a generator (per LOD tier), which touches
every asset module.

### The controller was reading the loader, not the machine

Slicing introduced a regression that the block had hidden. 33 slow frames is a
long run of over-budget samples, so `AdaptiveQuality` walked all the way down and
sat at `minimum` while the finished world ran at 60 fps. The single block had
been one delta, filtered out as a tab-switch, and never reached it.

Two fixes, both about *what counts as evidence*: nothing is sampled while
`placeablesPending`, and `Profiler.resetFrameWindow()` clears the percentile
window when the drain completes — the window is 240 frames deep, so without it
33 slow frames stay in p95 for four seconds after their cause is gone.
`longestStallMs` deliberately survives that reset; it exists to answer "did this
session ever freeze", and a freeze counter that forgets is not one.

### A filter that hid the worst thing that happened

The stall above originally reported a `worst` frame of **165 ms**. The real
number was **4067 ms**. `recordFrameDelta` discards deltas over a second as
tab-switches — correct for percentiles, and exactly wrong for finding freezes.
`FrameStats.longestStallMs` now records the unfiltered maximum alongside it.

## 12. Next, in order of value

1. **The first *real* frame.** The largest single stall in the session, and now
   attributed: `WorldBuildInfo.firstFrameMs` times the opening `render()` calls
   individually, because `recordFrameDelta` starts at frame two and therefore
   cannot see the gap that *creates* frame two.

   Measured on an unthrottled desktop: **35, 0.6, 577, 6.9, 5, 4.2 ms**. The
   spike is not frame 0. Frames 0 and 1 draw an almost-empty scene — the terrain
   chunks are still in flight from the worker and the scatter fields have not
   populated — so frame **2** is the first frame that draws the real world, and
   that is where the driver compiles and links every program at once. The index
   moves with conditions; "the first frame that draws the real scene" is the
   invariant.

   **Fixed.** `World.warmUp()` drives the whole `frame()` path into a 1×1
   drawing buffer before the loop presents anything, so every program links
   behind the splash. On by default; `?warmup=0` disables it for A/B.

   | interleaved A/B, one build | `warmup=0` | `warmup=1` |
   |---|---|---|
   | worst opening frame | 984–1612 ms | **5–10 ms** |
   | opening frames | 41, 1, **1412**, 100, 6, 8 | 6, 5, 8, 8, 6, 5 |
   | added time before the world appears | none | 0.9–2.0 s (splash still up) |

   It took three attempts, and the two failures are the instructive part:

   - **`renderer.compileAsync` is worse than doing nothing.** Four A/B pairs:
     with it, 380–576 ms inside `compile()` *plus* an opening frame of
     925–1446 ms; without it, 566–1764 ms and nothing else.
   - **A bare `render()` warms nothing**, and neither does warming too early.
     `firstFrameDraws` settled it: on a cold boot frames 0 and 1 draw **one call
     and one geometry** — the sky — because the terrain chunks are still in
     flight from the worker. Both failed attempts were warming an empty scene.
     An instanced LOD field also draws nothing until `update()` has set its
     counts, which a bare `render()` never does.

   So the warmup **passes until the program count stops growing** rather than
   running a fixed number of frames: each pass is a real frame, so the loop is
   what causes the content to arrive as well as what waits for it. Capped at 4
   passes — 12 eliminated the stall no better and cost 2.1–2.7 s instead of
   0.9–2.0 s, because it was waiting on a draw count that never settles while
   chunks stream.

   This *relocates* the cost; it cannot remove it, since a driver's shader
   compile cannot be sliced the way asset generation could. `longestStallMs`
   stays around 0.4–1.5 s and now falls inside the warmup, where nothing is on
   screen. Relocation was the goal.
2. **Cheaper AO bakes — done, 1.44×.** Measured first rather than assumed:
   vertex-AO baking is **89.8 % of catalogue build time** (633 ms of 705 ms,
   137 bakes, 18.8M ray-triangle tests), which makes it the floor on how long a
   slice of the frame-budgeted drain can block.

   `bakeVertexAO` now culls per vertex before shooting any rays. Every ray stops
   at `maxDistance` — `nearest` starts there and only shrinks — so a triangle
   whose bounding sphere is further than that from the origin cannot be hit by
   *any* of that vertex's rays. Testing it once per vertex replaces testing it
   once per vertex **per sample**, which removes **59.5 %** of all
   ray-triangle tests (18.8M → 7.6M) and takes AO from 90 % of catalogue build
   to ~69 %.

   The output is bit-identical, and that is asserted rather than argued: a
   `bruteForce` option runs the naive path, and the suite compares the two
   exactly (no tolerance) across a box, a sphere, a torus knot and a
   non-power-of-two sample count. A wrong cull would not throw — it would
   silently lighten one crevice on one asset at one LOD tier.

   Honest numbers: **1.32–1.81× on real prop geometry, 1.44× overall.** An
   earlier sample measured 35×, which was wrong — it had picked terrain chunks,
   which never get an AO bake at all. Per-tier `aoSamples` was already tuned
   (10/8/8/6), so that avenue was spent before this started.
3. **The shadow pass — done, 2 cascades.** This item was going to be chunk
   impostors. Measuring first said otherwise, and the sequence is worth keeping:

   - Under mobile + 4× CPU, all the tagged systems together were **12.8 ms of a
     31.8 ms frame**, and the scatter fields — what chunk impostors would fix —
     were **6 ms**. Nineteen milliseconds had no owner at all.
   - `FrameStats.renderMs` now times `renderer.render()` directly, because the
     per-tag table only covers systems that wrap themselves in
     `beginCpu`/`endCpu`. It found **20 ms of 26.4 ms CPU inside draw
     submission**. The far-field instance loop was about to be rebuilt on the
     assumption that it was the problem.
   - Toggling `shadows` inside one build, with quality pinned: the shadow pass
     is **90 of 139 draw calls, 72k of 108k triangles, and 63 % of GPU time**.

   So the fix was the cascade count, not impostors. Three → two removes 42 draw
   calls of 208 (−20 %) and ~25k submitted triangles (−22 %), which is what
   brings the frame back under the GDD §5 budget of ≤180 draws from 207–209.
   Checked by eye at 5 m and 14 m first: nothing visible, because these shadows
   are soft, periwinkle-tinted and dithered (GDD R5), which absorbs the texel
   density it gives up. `?cascades=3&shadowfar=N` restores the old values.

   Then attributing the *remaining* casters found a defect. `Terrain.ts` sets
   `mesh.castShadow = false` on every chunk at construction, with a comment
   saying chunks never cast — and it did nothing. `DitheredLod` re-assigns
   `castShadow` from `asset.castsShadow ?? true` **every frame** as tiers cross
   their fade thresholds, so the constructor's intent was overwritten one frame
   later. Twenty chunks were casting into every cascade: **16.3k of the 20.9k
   caster triangles in the scene**. Declaring `castsShadow: false` on the asset —
   the mechanism water already uses — makes the existing intent actually hold.

   Combined, under mobile + 4× CPU with a scripted orbit, three repeats:

   | mobile + 4× CPU | before | after |
   |---|---|---|
   | draw calls | 207–209 | **120–121** |
   | triangles | 114.5k | **54.8k** |
   | `renderMs` | 26–30 ms | **9.2–10.8 ms** |
   | CPU | 30–34 ms | **11.3–12.9 ms** |
   | GPU | 19–22 ms | **6.0–6.5 ms** |
   | p95 frame | 67–84 ms | **33.3–33.4 ms** |

   The run-to-run spread collapsed as well — 9.2/10.8/10.2 against an earlier
   16–33 — which is itself the tell: the machine had been pushed into a regime
   where it was thrashing, and the noise that made the cascade timings
   unmeasurable was partly *caused* by the cost being removed here. Programs
   also fell 8 → 7, since terrain no longer compiles a depth variant.

   Shadow-caster *tiers* were already capped at LOD0/LOD1, so that avenue was
   spent before this started.
4. **The frame-time tail, on a quiet machine.** The *mean* is now solved: the
   shipped configuration — adaptive quality on, nothing pinned — runs at
   **54–57 fps, p50 16.7 ms, p95 16.9 ms under mobile + 4× CPU, staying at
   `ultra` with zero quality reductions**. Earlier in the same session that
   profile was 32 fps and degraded to `minimum`.

   What is left is the tail: p99 33.4 ms and 1–7 janky frames per 240. The cause
   is identified. Chunk instantiation has two units with very different costs — a
   recycled node copies into existing buffers, a **cold** one allocates four
   `BufferGeometry` objects, a `DitheredLod` with tier meshes and outline hull,
   and fresh GPU buffers. One cold node exceeds the 2 ms upload budget by itself,
   and a budget can only stop between units. Measured: while the pool was still
   growing (50 → 65 nodes) a moving camera saw 16 janky frames and a 50 ms worst
   frame; once full, the same traversal over the same new terrain saw 3 and
   33.5 ms.

   Rationing cold nodes to one per frame is now a live knob
   (`Terrain.coldNodeLimit`) so it can be A/B'd inside one build, and the cold
   path is re-armed per round by emptying the pool and teleporting to virgin
   terrain — pool growth is otherwise a once-per-session event that cannot be
   compared against itself.

   **It works, and it doesn't matter.** Four interleaved rounds:

   | `coldNodeLimit` | worst upload frame | frames used | frame p95 | worst frame |
   |---|---|---|---|---|
   | unlimited | 9.8 ms | 20 | 33.4 ms | ~50 ms |
   | 1 | **7.6 ms** | 32 | 33.4 ms | ~50 ms |

   It improves its own metric and moves frame time not at all, because the
   arithmetic never supported it: a cold node costs ~3.7 ms against a 2 ms
   budget, so rationing saves single-digit milliseconds out of frames that are
   50–100 ms. Attributing those frames properly closed the question — in the
   stressed case `renderMs` is **21.9 of 26.5 ms CPU (83 %)**, terrain upload
   peaks at 13.4 ms and scatter population at 5.1 ms. **Streaming is not what
   makes those frames slow; draw submission is**, the same answer as §12.3.

   Default left unchanged: a slower fill is a real cost and the benefit was not
   observable. The knob stays for a device where upload does dominate.

   Also worth recording: the first version of the harness disposed the pooled
   nodes it dropped, and `DitheredLod.dispose()` releases tier materials that are
   clones of one shared template — so it reached into every *live* chunk. The
   terrain degraded after the first call and streaming stopped two rounds later,
   which read as a plausible result until the chunk-load counter showed zero.
5. **Distant terrain — done, one draw call.** Streaming gives an unbounded world
   but a *bounded horizon*: chunks load to 190 m and past that is sky. From any
   height that reads as standing on a floating island.

   `distantRing.ts` builds one coarse mesh (96 quads over 2.8 km, ~29 m cells)
   with a hole where the streamer already draws, and `DistantTerrain` keeps it
   centred on the viewer. It reuses the streamed terrain's height, normal and
   colour functions and its **material instance**, so there is no extra program
   and the seam is a resolution change rather than a material change.

   Cost, interleaved A/B inside one build, three rounds, mobile + 4× CPU:

   | ring | draw calls | triangles | GPU     |
   |------|------------|-----------|---------|
   | off  | 118        | 44.0k     | 5.38 ms |
   | on   | **119**    | 62.2k     | 5.87 ms |

   +1 draw and ~0.5 ms of GPU for a kilometre of horizon. Extending `loadRadius`
   to reach the same distance would have needed ~3 000 chunks, and the frame is
   CPU-bound on draw submission.

   Three things this cost to learn:

   - **The hole is cut per quad, so overlap is bounded, not zero.** A quad
     straddling the boundary keeps triangles inside the hole; dropping those
     quads instead tears a gap at exactly the radius where the streamer stops.
     The ring therefore sits 2 m below true ground — coincident surfaces
     shimmer, a lower one simply loses. A test asserts the overlap stays within
     one cell of the boundary.
   - **Snap, don't follow.** Re-centring continuously would re-sample the height
     function at shifting positions every frame and make distant ridges *crawl*.
     It re-centres every 192 m instead, at a distance where fog has flattened the
     contrast.
   - **It had to move to the worker.** Built inline the ring cost **17.4 ms on a
     desktop** — a hitch every 192 m, ~70 ms throttled. `distantRing.ts` was
     already three.js-free for the same reason `chunkGeometry` is, so it rides
     the existing terrain worker; only the GPU upload stays on-frame, now
     **1.2 ms**.

   **A finding for the art side, not the pipeline.** At the shipped fog density
   (exp² 0.0085) most of the ring is invisible — fog, not streaming radius, is
   what currently bounds the visible horizon. At 0.0022 the difference is the
   whole picture: without the ring the ground ends in a cliff edge against sky;
   with it, rolling hills to the horizon. Whether to open the fog up is a GDD §3
   decision, not one to make silently while optimising.

   **And the obvious follow-on does not work.** With the ring drawing everything
   past 170 m, the streamer looked like it could stop far sooner — chunk count
   goes as the square of `loadRadius`, so this is the largest single lever on
   draw calls. It measures beautifully and it is wrong:

   | `loadRadius`  | resident chunks | terrain draws | total draws | tree instances |
   |---------------|-----------------|---------------|-------------|----------------|
   | 190 (default) | 70              | 30            | 119         | 496            |
   | 150           | 43              | 21            | 109         | —              |
   | 120           | 27              | 16            | 102         | **168**        |

   The terrain is indistinguishable at shipping fog. The *trees* are not: scatter
   streams on the back of terrain chunks, so two thirds of the mid-distance
   forest disappears with them, and the ring supplies ground with nothing growing
   on it. `?loadradius=N` is left as a knob and the default is unchanged.

   This is what item 6 is actually for. Scatter impostors are the prerequisite
   for shrinking `loadRadius`, not an alternative to it — which is the same
   conclusion the roadmap reached before, arrived at from the other direction.
6. **Scatter past the chunk radius — scoped, and deliberately not built.**
   `loadRadius` controls *both* detailed terrain and scatter residency, and item
   5 shows terrain is free to shrink while scatter is not. Investigating it
   turned up something better than the planned answer and a reason to stop.

   **Impostors are not needed.** `scatterChunk` is pure and depends only on the
   heightfield, not on the chunk mesh, and `InstancedLodField` already draws
   distant instances as one instanced call at LOD3 — which *is* an impostor. So
   trees do not need new baked geometry to outlive their chunk; scatter simply
   needs its own residency radius, decoupled from terrain. That is a much
   smaller change than the roadmap assumed.

   **What blocks it is the ground, not the trees.** Beyond the chunk radius the
   only surface is the ring: 29 m cells, sitting 2 m low by design. A tree placed
   at true `heightAt` would hover above it by the sampling error plus the drop —
   metres, on a ridge. Every fix trades one artifact for another:

   | approach              | artifact                                |
   |-----------------------|-----------------------------------------|
   | place at true height  | trees hover above the ring              |
   | place at ring height  | tree jumps when its chunk loads         |
   | shrink `depthDrop`    | z-fighting returns in the overlap band  |

   **And the payoff does not justify picking one.** It is ~17 draw calls of 119,
   on a frame already at 60 fps / p95 16.9 ms / `ultra` under a 4× CPU throttle.
   Spending a visible artifact on headroom nobody is short of is the wrong trade.

   Revisit when something actually needs the draw calls — more asset families, a
   denser world, or a device that misses vsync at the current count.
7. **Re-measure occlusion culling on real mobile hardware.** Built (§11b) and
   defaulted **off**: three desktop runs gave −4.56, +0.20 and −0.04 ms, which is
   noise around zero. The case for it is a weak GPU with a heavy fill cost, which
   is exactly the machine not yet measured on.
8. **OffscreenCanvas render loop.** Moves rendering off the main thread so GC and
   DOM work stop causing spikes. Note before starting: this *relocates* draw
   submission rather than reducing it, and submission is 83–87 % of frame CPU —
   so it buys isolation from main-thread jank, not headroom.
9. **WebGPU.** Compute-shader culling and indirect draw remove the CPU instance
   loop entirely. Big migration, narrower support.

Two items that used to sit on this list are done and have their own sections:
**occlusion culling** (§11b, built and measured, kept off) and the **adaptive
quality controller** (§11c, shipped and driving five levels off measured GPU ms).
