# 3d-world — Game Design Document

> **Working title:** *Meadowfall*
> **Genre:** stylised 3D open-world action-adventure (hybrid-casual, web)
> **Stack:** Vue 3 + TypeScript + Vite + **three.js (raw)** — see [Engine decision](#0-engine-decision)
> **Target:** 60 fps on a 2021 mid-range Android phone at 0.75× render scale;
> 60 fps on integrated-GPU laptops at 1× (DPR capped at 2).

This document is the **art and performance contract**. Every asset, shader and
system in `src/world/` is written against the numbers and rules below. If a rule
here and the code disagree, the code is wrong.

---

## 0. Engine decision

**Raw three.js, not TresJS.** Chosen deliberately, and the reasoning is part of
the contract because it constrains how everything below is written.

| | TresJS | raw three.js |
|---|---|---|
| Scene graph | Vue components → reactive proxies per node | plain JS objects |
| Per-frame cost | Vue's reactivity + patch pass touches the scene tree | zero framework overhead |
| Instancing | possible, but fights the declarative model | first-class |
| Custom `onBeforeCompile` shader surgery | awkward through props | direct |
| Ergonomics for UI | excellent | n/a |

An open world is thousands of instanced transforms mutated every frame, plus
per-instance LOD-fade attributes streamed to the GPU. Wrapping each of those in
a reactive proxy is exactly the overhead this project cannot afford — and it
mirrors the performance contract the 2D game in this repo already follows ("hot
collections are plain non-reactive structures").

**Division of labour:**

* **three.js owns the canvas.** Scene graph, materials, loop, all of `src/world/`.
  No Vue reactivity crosses into `src/world/` — not one `ref` on a hot path.
* **Vue owns the DOM.** HUD, menus, modals, the perf panel. It talks to the
  world through a small imperative façade, never by proxying scene objects.

TresJS remains a fine choice for a low-object-count product scene. It is the
wrong choice for this one.

---

## 1. The look in one paragraph

Sun-bleached, cel-shaded wilderness with the readability of *Breath of the Wild*
and the chunky, hand-carved solidity of a diorama. Objects are **low-poly but
never faceted** — bevelled silhouettes and hand-authored vertex normals make a
56-triangle rock read as a smooth, weighty boulder. Colour does the work that
polygons normally do: baked vertex AO in the crevices, warm rim light on every
silhouette, and shadows that fall to a cool periwinkle rather than to black.
Distance drains saturation into a pale blue haze so the horizon reads as *far*
rather than as *small*. Nothing pops in — ever.

**Reference axis:** *Breath of the Wild* (light, fog, ground) × *Sable*
(silhouette economy) × *Genshin Impact* (foliage shading).
**Explicitly NOT:** flat-shaded facet-art low-poly, Minecraft voxel, PBR realism,
or thick uniform black cartoon outlines.

---

## 2. The seven rules of the art style

These are the rules that keep the style coherent as content is added. They are
enforced in code where enforceable (see `src/world/geometry/`, `src/world/shading/`).

### R1 — Silhouette-first budgeting
Every triangle you spend must change the outline. Interior detail comes from
vertex colour and vertex normals, **never** from geometry. A boulder gets its
crevices from baked AO, not from a modelled crease.

### R2 — Bevel everything, and take normals from the shape, not the mesh
No hard 90° edge exists in this world. Every generator applies a small bevel
(2–11 % of the local feature size) to each cut, so the result is *soft surface,
crisp crease* rather than either a faceted rock or a melted blob.

**Normals for procedural shapes are computed analytically** — by central-
differencing the continuous shape function on the unit sphere
(`blobGeometry` in `geometry/build.ts`) — never from the tessellated mesh.

> This replaced an angle-threshold ("smoothing group") pass at 38°, which was
> measured to be wrong for these budgets. At our tessellation, adjacent faces
> meet at 36° (W=10), 60° (W=6) and 90° (W=4), so a fixed threshold smooths the
> fine tier and leaves the coarse ones faceted. The *shading* then changed at
> every LOD boundary — and unlike a silhouette change, a surface flipping from
> smooth to faceted is something a dithered crossfade cannot hide, because both
> tiers look wrong at 50 % coverage. Differencing the continuous shape gives the
> exact normal of the surface all four tiers approximate, so they shade
> identically and a 36-triangle boulder shades like a sculpted one.

`smoothNormalsByAngle(geo, 38)` remains in `geometry/normals.ts` for *imported*
meshes (Phase C glTF characters), which have no shape function to differentiate.

### R3 — Normals are authored, not computed (foliage law)
Geometric normals are correct and ugly. Foliage clumps have their normals
**blended toward the clump's centre** (`blendNormalsToSphere`, strength 0.85),
so a 40-triangle leaf blob shades like a smooth sphere and the toon bands wrap
around it in one clean arc instead of shattering into per-face steps. This
single trick is what separates "stylised" from "cheap".

* Foliage clump → spherical normals, strength **0.85**
* Grass / small ground scatter → normals blended toward **world up**, strength 0.6
  (kills the harsh self-shading that makes scatter look like litter)
* Trunks / branches → cylindrical normals about the branch axis
* Rocks → pure R2 angle smoothing, no blending

### R4 — Three bands, warm-to-cool
Lighting is quantised to **3 diffuse bands** (a 4th, tiny band exists only in the
terminator to stop the mid→light step from crawling). The ramp is not a
brightness ramp — it is a **hue ramp**: lit is warm and slightly desaturated,
mid is the base albedo, shadow is darker **and shifted toward periwinkle**
(`#6b7bb5` mix, 35 %). Pure-black shadow is banned everywhere.

### R5 — Rim light is mandatory
Every lit object carries a fresnel rim (`pow(1 - N·V, 3.2)`) tinted with the sky
colour. It is what separates a dark tree from a dark hill without an outline
doing all the work, and it is the cheapest "expensive-looking" effect available.

### R6 — Outlines are coloured, thin and near-field only
Inverted-hull outlines, width held at a constant **1.6 screen pixels** by scaling
with distance (a world-space-width outline balloons in the distance and looks
like a cartoon sticker). Outline colour is the object's own base colour
multiplied to 22 % and shifted cool — **never** `#000`. Outlines render on
**LOD0 and LOD1 only**; past that they are sub-pixel and only cost draw calls.

### R7 — Nothing pops
Every LOD switch is a **dithered crossfade** across a transition band, not a
swap. See §4. This is a hard requirement, not a polish item.

---

## 3. Palette

Single source of truth: `src/world/art/palette.ts`. Do not hardcode colours
anywhere else.

| Role | Hex | Notes |
|---|---|---|
| Sun / key light | `#fff3d6` | warm, intensity **2.15** |
| Sky fill (hemi top) | `#a8d8f0` | intensity **0.85** |
| Bounce fill (hemi bottom) | `#c9b98e` | warm ground bounce, keeps shadows alive |
| Shadow tint | `#6b7bb5` | mixed 35 % into band 0 |
| Rim tint | `#dff1ff` | |
| Sky zenith | `#5fa8d8` | |
| Sky horizon | `#dceef7` | |
| Fog | `#cfe4f0` | exp² fog, density **0.0085** |
| Grass lit | `#8fb861` | |
| Grass base | `#6e934c` | |
| Grass shadow | `#455f3f` | |
| Grass dry | `#a3a663` | warm end of the grass range |
| Dirt | `#8f6a49` | slope blend from normalY 0.94 |
| Sand | `#c7b489` | low, flat hollows only |
| Rock base | `#9b9d99` | warm-grey boulder family |
| Rock warm | `#b8ab95` | mixed by upward-facing normal |
| Rock shadow | `#62615c` | warm-neutral, not blue |
| Cliff lit | `#bcc4c8` | pale blue-grey family — plateaus, spires, basalt, slabs |
| Cliff base | `#9ba7ae` | |
| Cliff shadow | `#5d6673` | cool, unlike `rockShadow` |
| Grass cap lit | `#84a75e` | the flat green tops — duller than `grassLit`, see below |
| Grass cap base | `#627f45` | |
| Grass cap deep | `#36512c` | under the draped lip and on shelf turf, from baked AO |
| Bark base | `#6d5138` | |
| Bark dark | `#453224` | |
| Foliage lit | `#74a248` | |
| Foliage base | `#527d3a` | |
| Foliage deep | `#2c4c2b` | interior of clump, from baked AO |

**Two rock families, on purpose.** `rock*` is warm grey (boulders, stones);
`cliff*` is pale blue-grey (plateaus, spires, basalt, slabs). A plateau standing
next to a boulder has to read as a *different stone*, not the same stone at a
different size — warm grey against cool grey is the cheapest geological story
available, and it costs three palette entries.

**Everything here is duller than it looks on a swatch**, and that is deliberate:
the lit band lands at ~0.95× albedo, so a colour that reads "correct" flat
arrives on screen clipped. The first pass authored grass at `#9ccc55`/`#7aab45`
and the ground rendered as flat lime poster paint.

The **grass caps are duller still — below `grassLit` — and that is not an
oversight.** They were first authored *brighter* than the meadow, reasoning that
a cap has to separate from the ground it floats above. True, and not an argument
for saturation: a cap is a large, *flat*, fully-lit plane, so unlike the rolling
ground it takes the ramp's top band across its whole area with no falloff
anywhere, and it arrives a full band hotter than the same hex does on terrain.
The separation it needs is already free — it sits on pale blue-grey stone, so
hue and value contrast do the work and the rim light draws the edge.

**Saturation-by-distance:** the fog colour is *lighter and bluer* than the sky
horizon on purpose. Objects therefore lose saturation before they lose contrast,
which is what reads as aerial perspective.

---

## 4. LOD contract

Every world object ships **exactly four LOD tiers**, plus a cull distance.

### 4.1 Triangle budgets (hard caps, asserted at generation time)

| Asset | LOD0 | LOD1 | LOD2 | LOD3 | actual (0/1/2/3) |
|---|---:|---:|---:|---:|---|
| Tree | 200 | 110 | 56 | 16 | 162 / 80 / 54 / 16 |
| Boulder | 180 | 96 | 44 | 12 | 140 / 80 / 36 / 12 |
| Stone | 72 | 40 | 20 | 8 | 56 / 36 / 20 / 8 |
| Plateau | 260 | 150 | 80 | 40 | 216 / 144 / 72 / 36 |
| Cliff spire | 260 | 150 | 100 | 36 | 200 / 120 / 80 / 30 |
| Basalt cluster | 210 | 124 | 60 | 20 | 196 / 115 / 54 / 18 |
| Slab | 112 | 76 | 40 | 18 | 96 / 64 / 32 / 16 |
| Grass rock | 130 | 84 | 40 | 20 | 99 / 63 / 30 / 15 |
| Terrain chunk (48 m) | 1400 | 400 | 128 | 24 | 1344 / 384 / 120 / 18 |
| *(future)* Monster | 900 | 420 | 180 | 40 | — |
| *(future)* Chibi human | 700 | 340 | 150 | 36 | — |

Generators call `assertTriBudget(geometry, budget, name)` and **throw** in dev if
they exceed it. The budget is a ceiling, not a target.

**The cliff family sits above the boulder, and that is a placement decision
rather than an art one.** A boulder is scatter — thousands of them, so its
budget is really a per-*field* budget. A plateau or a spire is placed by hand,
in tens, and is usually the thing the player is standing on or navigating by, so
its triangles are seen from two metres rather than from forty. What they buy is
also different: a boulder spends its budget on a silhouette, while a plateau has
to spend some on a **genuinely planar top** (it is walkable, and the collider
claims it is flat) and on the grass cap's lip, which is the feature that
identifies the whole family.

**Their coarse tiers are budgeted unusually high on purpose, and the split
between rings and segments is the reason.** This family's identity lives in its
*section* — a bundle of fused columns whose valleys are genuine arrises — and a
tier only shows those arrises if its segment count is a multiple of the lobe
count. Segments are therefore held constant from LOD0 to LOD2 and each tier
spends its reduction on **rings** instead. That is what pushes LOD2 to 80–100
rather than the boulder's 44, and it is the right way round: the profile is this
family's pose and can be approximated, while the section is what makes it
recognisable at all. LOD3 sits at 36–40 for a related reason — three rings
cannot describe an anvil or a 2:1 taper with ledges in it, and the tier measured
45 % over its LOD0 volume until it got a fourth.

Slab and grass rock go the other way — they are stacked and scattered in
quantity, so they are budgeted nearer the stone than the plateau.

**Tier size is corrected on both axes, not one.** §4.3 explains why a coarse tier
is a genuinely smaller object and has to be inflated back. That argument applies
twice over: once to the polygon approximating the *section*, and once to the
chords approximating the *profile*, where every chord across a concave stretch
falls outside the true curve and makes a low-ring tier systematically **too fat**.
Correcting only the first left the cliff family's coarse tiers running 12–62 %
off LOD0's volume. With both corrections (`sectionAreaInflate` and
`profileVolumeInflate`) every tier of every prop in the family lands within
**2.8 %** by volume — under 1 % linear — which is what the dithered crossfade
needs and what a per-asset fudge factor never reliably delivered.

**LOD3 is a solid impostor blob, not a billboard.** Cross-billboards were the
obvious choice and are wrong here: with no prop textures (§5.2) there is no alpha
mask, so a crossed quad renders as two literal rectangles. Instead LOD3 is the
same lump-displaced shape at its coarsest sampling — 8–16 triangles of real
geometry, which self-shades, takes the fog and the toon ramp like everything
else, and reads correctly from any angle.

The tree's LOD3 keeps a **6-triangle trunk stub**. A canopy-only impostor makes
every tree hop upward at the LOD2→LOD3 boundary, where the trunk is still ~15
screen pixels — precisely the pop the crossfade exists to prevent.

### 4.2 Switch distances

Distances are in metres, multiplied by **two** factors: a global `lodBias`
derived from FOV and render resolution (so perceived detail is
resolution-independent), and a per-asset `distanceScale` (so a 5 m tree and a
0.4 m pebble aren't judged by the same table — see `WorldAsset.distanceScale`).

| Tier | Base range (m) | Crossfade band | tree ×2.0 | stone ×0.55 |
|---|---|---|---|---|
| LOD0 | 0 – 18 | 18 → 21 | 0 – 36 | 0 – 10 |
| LOD1 | 18 – 45 | 45 → 52 | 36 – 90 | 10 – 25 |
| LOD2 | 45 – 110 | 110 → 126 | 90 – 220 | 25 – 61 |
| LOD3 | 110 – 260 | 260 → 285 (fade to nothing) | 220 – 320* | 61 – 143 |
| culled | > 285 | | | |

\* Cull distance is clamped to 320 m globally regardless of scale — past that
exp² fog has erased the object anyway and the draw is pure waste.

Bands are **~15 %** of the switch distance and are asymmetric on approach vs.
retreat (**8 % hysteresis**) so an object hovering exactly on a boundary cannot
oscillate.

### 4.3 How the crossfade works

Both tiers render simultaneously inside the band. Each gets a `uFade` in
`[0,1]`; the fragment shader discards a pixel when

```glsl
interleavedGradientNoise(gl_FragCoord.xy) > uFade
```

using Jimenez's IGN, which produces a stable, uniform, non-swimming screen-door
pattern. The outgoing tier gets `1 - fade`, so the two patterns are complementary
and total coverage stays at 100 % throughout the transition — no ghosting, no
double-darkening, no alpha-sort artefacts.

**Cost.** Instances inside a band are drawn by two tiers instead of one. Draw
*calls* don't increase — every tier is one instanced draw regardless — so the
cost is a doubled vertex load and roughly unchanged fragment load (each tier
discards about half its pixels) for the affected instances only.

How many is that? Scatter is spread over 2D, so the share sitting inside a band
is the annulus area over the disc area, `Σ 2·Dᵢ·Bᵢ / D²max` ≈ **21 %** for the
table above. **Measured at 29 %** in a wide view at 95 m orbit, with total GPU
frame time at 1.5 ms — so the bands are affordable and stay at 15 %. (An earlier
draft of this document guessed "< 6 %"; that was wrong by 4×, and the geometry
of the problem — not camera speed — is what sets it.)

**Silhouette matching is a prerequisite, not a nicety.** A UV sphere puts its
vertices on the true surface, so faces bulge inward and a coarse tier is
genuinely *smaller*: 5 % thin at W=10, 19 % at W=5. Crossfading two different
sizes shows the dither pattern no matter how good the blend is. Every tier is
therefore scaled by `1/cos(π/W)^0.6` so all four approximate the same ideal
surface.

**Outlines do not dither.** Only the tier with `|coverage| ≥ 0.5` draws one.
Coverage magnitudes sum to 1 across a band, so exactly one tier qualifies.
Dithering a 1.6 px line fails visibly — the two hulls sit a fraction of a pixel
apart, so their complementary patterns don't reconstruct and the silhouette
becomes a dotted crawl. Switching a hairline is imperceptible; speckling it is not.

**Shadows during a fade:** only the tier with `fade ≥ 0.5` casts, so shadow maps
never double-darken. For instanced fields both tiers may cast for a few frames;
this is invisible because tier silhouettes are matched by design (R1).

---

## 5. Performance contract

### 5.1 Frame budget (16.6 ms @ 60 fps, mid-range Android)

| System | Budget |
|---|---|
| Terrain (draw + update) | 2.5 ms |
| Instanced scatter (trees/rocks/grass) | 3.5 ms |
| Characters + monsters | 4.0 ms |
| Shadow pass | 2.0 ms |
| Post / sky / misc | 1.5 ms |
| Headroom | 3.1 ms |

### 5.2 Hard limits

* **Draw calls ≤ 180** in a typical view. Instancing is the default, not an
  optimisation — every scatter prop goes through `InstancedLodField`.
* **Zero per-frame allocation** in `src/world/` update paths. Scratch
  `Vector3`/`Matrix4` objects are module-level singletons. This is checked by
  watching GC sawtooth in the perf panel.
* **DPR capped at 2**, render scale user-adjustable 0.6–1.0.
* **One material program per shading family.** Every toon object shares one
  compiled program; variation comes from uniforms and vertex colours. Shader
  compilation stalls are the #1 cause of first-play jank.
* **No textures for props.** Colour is vertex colour. The only textures in the
  scene are the 1×N gradient ramp and the shadow map.

### 5.2b Streaming and hierarchical culling

The world is **streamed**, not built at boot. Terrain chunks are generated on a
Web Worker and uploaded under a per-frame time budget; scatter instances are
culled through a spatial hierarchy rather than one at a time.

**Hierarchical culling** (`InstancedLodField`). Instances are sorted at build
time into 48 m cells, stored as contiguous runs. Each frame a cell is classified
against the frustum once:

* `OUTSIDE` → skipped, then marked **dormant** so subsequent frames cost nothing
* `INSIDE` → every instance accepted with **no per-instance plane test**
* `INTERSECTS` → only these pay the per-instance cost

The second-order win matters more than the first: per-instance culling made
membership churn on every camera *rotation*, which dirtied the instanced matrix
buffers and re-uploaded them. Measured at 23 223 instances, same build, same
scripted orbit — scatter CPU worst-case **2.80 → 1.40 ms**, GPU **5.88 → 3.28 ms**.
The `cell cull` toggle in the perf panel flips it back for A/B measurement.

**Streaming** (`terrain/`). Four rules keep it from being felt:

| rule | why |
|---|---|
| Budget, don't burst | Geometry construction and GPU upload are main-thread work no worker can take. The ready queue drains against ~2 ms/frame. Measured max in any frame during traversal: **0.6 ms**. |
| Hysteresis | Unload radius is 1.25× load radius, or pacing a boundary thrashes. |
| Predict | The load centre leads the camera along its velocity, so chunks arrive before they're needed. |
| Pool | Nodes and GPU buffers are recycled. Tier sizes are fixed, so a recycled node's buffers are always the right shape. |

`heightfieldCore.ts` and `chunkGeometry.ts` are **three.js-free** so the worker
bundle doesn't ship a second copy of three, and so the worker and the
main-thread fallback run literally the same function — a streaming system whose
background and fallback paths are two implementations is one where they drift.

Boot build dropped from ~900 ms to **296 ms** once terrain left the constructor.

**Not yet streamed:** scatter instances are still built eagerly over the whole
world extent, which is why `TerrainOptions.size` still bounds the world. Cell
sorting is the groundwork for streaming them too — that's the next step.

### 5.3 Profiling — "which asset wastes the most performance"

`src/world/perf/` provides:

1. **Live counters** — fps, CPU frame ms, **GPU ms** (via
   `EXT_disjoint_timer_query_webgl2`), draw calls, triangles, programs, geometries,
   textures.
1b. **Frame-time percentiles** — p50 / p95 / p99 / worst over a 240-frame window,
   plus a count of frames over budget. A mean hides exactly what players feel: a
   scene at a flawless 8 ms mean that spends one frame in sixty at 40 ms reads as
   *stuttering*, and the mean moves by 0.5 ms. Streaming makes this the number
   that matters, because chunk uploads land on individual frames.
2. **Per-tag accounting** — every object registers a `perfTag`
   (`terrain`, `trees`, `rocks`, `monsters:bokoblin`, …). Each frame the profiler
   frustum-tests registered roots and attributes visible draw calls, triangles
   and instance counts to their tag.
3. **Ablation profiler** — the honest measurement. On demand it hides one tag at
   a time for N frames and measures the drop in GPU frame time, producing a
   ranked "cost per tag in ms" table. Estimating cost from triangle counts lies;
   hiding the thing and measuring does not.
4. **CPU system timers** — each update system is bracketed, so a tag that is
   cheap to draw but expensive to update (skinned monsters, LOD bucketing) is
   still caught.

---

## 6. Content roadmap

### Phase A — Foundation *(this milestone)*
Renderer, toon material family, geometry toolkit, dithered LOD system,
cel-shaded chunked terrain, **tree / stone / boulder** with 4 LODs each,
scatter fields, perf HUD with ablation profiling.

### Phase B — World
Biomes (meadow, pine highland, red canyon), water with toon foam line, wind
system driving foliage, day/night with a ramp that re-tints rather than dims,
grass field, cliffs, props (fences, crates, ruins).

### Phase C — Characters
* **Chibi humans** — 3-head proportions, cel-shaded, ~700 tris, hand-painted
  vertex colours, face as a separate normal-flattened cap so toon bands never
  cut across the face.
* **Monsters** — the animation bar is the point: correct weight-shift walk and
  run cycles (contact / down / pass / up, no floaty interpolation), and attacks
  with real anticipation → strike → recovery timing and hit-stop.
* Skeletal animation via glTF; LOD tiers share one skeleton, so LOD switching
  never re-binds a skin.

### Phase D — Game layer
Traversal, combat, the existing save/platform/i18n pipeline from the 2D game
reused wholesale.

---

## 7. Repo layout

```
src/world/
  art/palette.ts            single source of colour truth
  core/                     renderer, scene rig, loop, camera
  geometry/                 rng, normals, bevel, vertex AO, budget assertions
  shading/                  toon material family, ramp, dither, wind, outline
  lod/                      DitheredLod, InstancedLodField
  assets/                   tree.ts, stone.ts, boulder.ts (procedural, 4 LODs)
  terrain/                  heightfield, chunked terrain with 4 tiers
  perf/                     profiler, GPU timer, ablation
src/views/WorldScene.vue    the Vue shell + perf panel  →  route /  (default)
```

The 2D tower-siege game this repo started as still lives at `/tower`, intact.
It owns `tower_state` and the save / ads / platform pipeline that the 3D world
inherits, so it stays until Phase D reuses that layer.

---

## 8. Standard requirements block

> In GENERAL for all work: Do your work on a high-fidelity basis, don't do just
> good enough. Make the interactions feel good, add vfx juice where applicable
> (optimize to not overload the CPU/GPU). Don't take shortcuts. After planning,
> write the plan into `game-implementation-plan.md` to continue from if a session
> ends unexpectedly.
> The game starts right into the first scene, no main menu.
> Fully responsive: all mobile orientations, min portrait 320×658px, tablet and
> desktop up to fullscreen. No fixed px where avoidable — use %, vw/vh. Respect
> safe-area insets. Images are not selectable/draggable like normal web content
> but must allow drag and click events for game logic.
> Optimize for web-game standards: fast jump into gameplay (hot-path loading),
> delay uncritical assets until after first paint.
> Save ALL state variables in one object named `tower_state`.
