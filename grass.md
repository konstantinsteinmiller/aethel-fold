# grass — the meadow system

Companion to [`GDD.md`](./GDD.md) (the art and performance contract) and
[`AAA-graphics.md`](./AAA-graphics.md) (the pipeline). This file covers
`src/world/grass/` only: what it draws, how it stays cheap, what each detail
level actually costs, and what was tried and rejected.

Every number below was measured in a real browser over CDP against a throwaway
Chrome profile, not estimated. Where a technique was measured and thrown away,
the rejection is recorded — that is usually the more useful half.

---

## 1. The headline

**A meadow at 56 blades per square metre underfoot, in 6 draw calls, for 97 k
triangles and 0.3 ms of CPU.** One extra shader program. No textures. No shadow
pass. No crossfade overdraw. Grass never pops, never shimmers, never sways at a
distance where swaying would only alias, and never draws behind you.

Measured at 5120 × 2880 with **228 000 grass triangles**: still 60 fps, still no
GPU cost the timer can resolve.

Six LOD tiers, five player-selectable detail levels plus `auto` and `off`, and a
view-cone cull that removes **66 % of patches** before anything is submitted.

---

## 2. The one idea

**The instance is a patch, not a blade.**

A patch is a 4 m × 4 m tuft cluster whose blades are baked into a single shared
geometry at boot. The field instances *that*, so a meadow of 400 000 resident
blades is 2 700 instances of 48 bytes, and the blade layout is uploaded to the
GPU exactly once.

Everything that has to differ between two patches standing next to each other —
rotation, root offset, blade height, colour, how many blades are standing — is
applied per patch in the vertex shader from a 48-byte instance stream:

```
aGrassA = (originX, originZ, h00, h10)     patch origin + two corner heights
aGrassB = (h01, h11, hash01, density01)    the other two corners + the patch's seed
aGrassC = (tintR, tintG, tintB, liveBlades) ground colour + how many blades stand
```

There is deliberately **no instance matrix**. The mesh is a plain `Mesh` carrying
an `InstancedBufferGeometry`, which three renders instanced *without* defining
`USE_INSTANCING` (it decides the define from `isInstancedMesh` and the draw from
`geometry.isInstancedBufferGeometry`) — so no `instanceMatrix` attribute is
bound, no 4×4 multiply runs per vertex, and 48 bytes carry strictly more
information than 64 bytes of transform would.

| | one instance per blade | one instance per patch |
|---|---|---|
| instances resident | ~400 000 | **2 722** |
| bytes per instance | 64 (matrix) | **48** |
| instance data resident | ~26 MB | **311 KB** |
| CPU per frame | a per-blade loop | a per-patch loop |

---

## 3. What the vertex shader does

Six things happen to every vertex, in this order. Each is here because removing
it produces a specific, nameable artefact.

1. **Toroidal root shift + yaw offset, by patch hash.** One baked layout stamped
   across the world tiles at 4 m and the eye finds the grid instantly. `fract()`
   on the blade's *root* (identical across the blade's vertices, so the blade
   moves whole) costs three instructions and the repetition is gone.
2. **Bilinear terrain height from four corner heights.** A patch is 4 m and the
   world's terrain has a 170 m feature size, so the interpolation error is
   centimetres — inside the depth a blade is sunk into the ground anyway. This is
   what removes the alternative: a per-blade height lookup means either a
   streamed heightmap texture or a per-blade CPU sample, and both cost more than
   the entire rest of this system. The same four corners give the surface
   gradient for free.
3. **Wind as a rotation about the root, not a translation.** A translated blade
   shears — its tip slides sideways while its length stays the same, which reads
   as the grass being *dragged*. The vertical shortening term (`y −= bend²·t²·0.5`)
   is the cheap approximation to arc length that makes it read as a bend. Two
   travelling octaves phased by **world position**, so a gust visibly crosses the
   meadow instead of the whole field breathing in unison.
4. **A minimum screen width.** A 3 cm blade at 90 m is a fraction of a pixel and
   flickers on and off with sub-pixel camera motion — the single most visible
   failure mode a grass field has. Blades widen to a floor of 1.9 screen pixels
   using the same `uUnitsPerPixel` the outlines hold their 1.6 px with. This
   turned out to do a second job as well: grass density falls with distance by
   design, so ground *coverage* falls with it, and widening the survivors
   restores the coverage the thinning gave up at **zero triangles**.
5. **Normals blended 0.6 toward the ground normal** (GDD R3). Geometric blade
   normals are correct and make a meadow look like litter, because every blade
   lands in a different band of the toon ramp. Blending toward the surface the
   grass grows out of makes the sward take the light as one surface — which is
   what it visually is.
6. **Height taper at the cull edge.** Grass sinks into the ground over the last
   14 % of its range rather than vanishing at a radius, so there is no circle of
   lawn following the player.

Colour is the ground colour **sampled where the patch stands**, times a gradient
along the blade. `groundColorCore` is the same function the terrain mesh itself
is coloured with, so whatever the macro noise is doing to the ground — the dry
warm patches, the cool damp hollows, the dirt creeping up a slope — the blades do
too. That single decision is what stops grass reading as a green carpet laid over
a differently-green hill.

---

## 4. Six tiers, and why grass has no crossfade

### 4.1 The ladder

| tier | range (m) | blades / patch | blades / m² | segments | tris / blade | tris / patch | wind |
|---|---:|---:|---:|---:|---:|---:|:--:|
| LOD0 | 0 – 9 | 900 | 56.3 | 4 | 7 | 6 300 | ✓ |
| LOD1 | 9 – 18 | 560 | 35.0 | 3 | 5 | 2 800 | ✓ |
| LOD2 | 18 – 32 | 240 | 15.0 | 2 | 3 | 720 | ✓ fading |
| LOD3 | 32 – 54 | 110 | 6.9 | 1 | 1 | 110 | ✓ fading |
| LOD4 | 54 – 78 | 44 | 2.8 | 1 | 1 | 44 | — |
| LOD5 | 78 – 115 | 20 | 1.3 | 1 | 1 | 20 | — |

Ranges are multiplied by the detail level's `range` and by the global `lodBias`
(clamped to 0.7–1.15 for grass; see §7).

**The table is deliberately front-loaded — 45× from the near field to the
horizon — because *area* is what costs.** LOD0's whole disc is 16 patches
full-circle and about **6** survive the view cone; LOD5's ring is 1 400 patches
and 224 survive. A blade added to LOD0 is drawn by six patches; the same blade
added to LOD5 is drawn by two hundred. So the tier the player is standing in is
the cheapest place in the entire system to spend a blade, and the first pass
under-spent it badly: at 380 blades the near field read as a lawn with tufts on
it rather than as a meadow you are standing in. Tripling it cost **+40 k
triangles and zero measurable GPU time**.

The counts still fall smoothly enough that the density ramp between neighbours
never steps — the largest ratio is 900 → 560 across LOD0, spread over nine metres.

**Six tiers rather than the world's four (GDD R7), on purpose.** A boulder's tiers
differ in *tessellation*, and four is plenty because the silhouette barely moves.
Grass tiers differ in *population*, so a tier step is a density reduction — and
going from "meadow" to "one blade per square metre" in four steps makes each step
a visible thinning. Six steps of ~35 % each spread the same total reduction
finely enough that no single boundary reads.

The second reason is arithmetic: grass covers *area*, so the outermost tier holds
**57 % of all patches**. Two extra tiers out there are the cheapest possible way
to buy back triangles, and it is exactly where a triangle is worth least.

### 4.2 The subset property

Tier N+1 bakes a **strict prefix** of tier N's blade sequence: blade *k* is at the
identical root, yaw, height and curl in every tier. This is the load-bearing
invariant of the whole system and it is pinned by a test.

Blades are assigned to clump centres round-robin (`i % clumpCount`) with the
distance from the centre growing as `floor(i / clumpCount)`. Two things fall out
for free: a thinned tier still touches **every** clump rather than keeping the
first few whole, and the coarsest tiers — which take fewer blades than there are
clumps — land exactly on clump *centres*.

### 4.3 No crossfade, and that is stronger than one

Every other LOD in this world dithers across a transition band. Grass does not.

**The mechanism was measured and it fails on grass.** A crossfade hides a
discontinuity by drawing both tiers with complementary screen-door patterns. That
reconstructs beautifully on a boulder, whose two tiers cover the same pixels.
Grass tiers differ in population, so the blades tier N+1 *does not have* are
drawn by tier N alone at 50 % coverage and are reconstructed by nothing — they
render as visibly hatched blades. On geometry three pixels wide, a half-tone is
not a fade, it is a comb. (Screenshots of this are what killed the first version.)

**So the discontinuity is removed instead of hidden.** The number of blades a
patch draws is a continuous function of distance:

```glsl
k     = clamp((depth − rampStart) / (rampEnd − rampStart), 0.0, 1.0)
live  = mix(bladesAtStart, bladesAtEnd, k) * patchSuitability
alive = clamp((live − bladeOrdinal) / max(live * FADE_FRACTION, 1.0), 0.0, 1.0)
```

A blade is drawn iff its ordinal is below `live`, and the blades straddling that
threshold are *part height* — they grow out of and sink back into the ground
rather than blinking. At a tier boundary `k` reaches 1 on the outgoing side and 0
on the incoming side and both evaluate to **the same number**, so the swap changes
the blade population by exactly zero. This only works because of the subset
property; a test asserts the continuity at every boundary.

`depth` is **this blade's** distance, not the patch's — see §4.3b for what
happened when it wasn't.

What still changes at a boundary is tessellation (4 segments → 3) and ≤ 4 % of
blade width. Both are sub-pixel at the distance they happen: at the LOD0→LOD1
boundary the coarse blade's vertices sit within 0.35 px of the fine blade's
polyline.

**And it is faster.** GDD §4.3 measures 21–29 % of instances mid-crossfade at any
moment, each drawn twice. Grass pays none of that: a patch belongs to exactly one
tier, always.

### 4.3b Two things this got wrong first, both in the 5–10 m band

Both shipped, both were reported as visible LOD popping in the near field, and
both are worth writing down because neither shows up in a still frame or in any
counter.

**The fade window was a constant in the wrong space.** `alive` originally used a
fixed 2.5-blade window. But what the eye judges is not how many blades straddle
the threshold, it is how much **camera travel** a blade takes to grow — and that
is `window / (d live / d distance)`. With the front-loaded table LOD0 sheds 54
blades per metre, so 2.5 ordinals is **4.6 cm of travel, or twelve milliseconds
at walking pace**: under one frame. Every blade popped, fifty-four of them per
metre walked. Tripling the near-field density made it three times worse, which is
why it only became obvious after that change.

The window is now `live × FADE_FRACTION`. A fraction rather than a per-tier
constant, for two reasons: it holds the duration roughly constant in *distance*
(0.7–4.5 m across the whole table, against a 15× spread before), and it is
**continuous at tier boundaries** because `live` is. A per-tier window derived
from that tier's own slope is not — the slope jumps 4× at LOD1→LOD2, which would
have swapped ~39 blades of 240 between "fading" and "full" in a single step,
trading the near-field pop for a smaller one at 18 m.

**And `live` was evaluated per patch, from the patch centre.** A patch is 4 m and
the near ramp sheds ~54 blades per metre, so two adjacent patches differed by
~150 blades of ~730 — a **20 % density step, on a 4 m grid, directly in front of
the player**. The ramp now lives in the vertex shader and reads each blade's own
depth; the tier still selects the draw call, but the density inside it is a
smooth function of position. Four instructions and one `vec4` uniform, and the
triangle count did not move at all.

| | fade duration at 6 m | density step between adjacent patches |
|---|---:|---:|
| before | 4.6 cm — 12 ms at walking pace | 20 %, on a 4 m grid |
| after | **1.07 m — 267 ms** | **none: evaluated per blade** |

**A measurement that did not work, recorded so nobody repeats it.** The obvious
check is to step the camera 5 cm at a time and diff the framebuffer. It cannot
resolve this: at that step size parallax on near blades changes 20–25 % of pixels
whatever the LOD is doing, and three configurations — the old window, the new
one, and no fade at all — overlapped across repeats. `GrassField.fadeFractionOverride`
exists so the comparison can be made inside one build; the instruments that
actually answer the question are the arithmetic above and a pair of eyes.

### 4.4 Wind stops before the horizon does

The wind fades out between **26 m and 48 m** (scaled with the tier table, so a
level that pulls the whole meadow in keeps the same *proportion* of it moving),
and LOD4 and LOD5 skip the wind block entirely.

**This is an art decision before it is a performance one.** At 50 m a blade is
two or three pixels wide, and moving it a fraction of a pixel per frame does not
read as wind — it reads as *sparkle*. It is the same sub-pixel aliasing the
screen-width floor exists to fix, except that a width floor cannot help geometry
whose problem is that it moves. A still far field is calmer and more legible, and
it makes the near field's motion read as *nearer*.

The saving comes free with it. `uBladeWind` is 0 for any tier whose whole range
sits past the fade, so the branch is **uniform across the draw call** — the entire
warp takes the same path and the skip costs nothing to take. What it skips is two
`sin` calls and ~15 operations, on the tiers holding **75 % of drawn patches**.

`tierHasWind` is derived from the distance tables rather than hard-coded, and a
test pins it: moving a tier boundary or the fade range without the other would
leave a band of visibly frozen grass at a fixed radius, which is the sort of
thing that survives a code review and not a playtest.

---

## 5. Directional culling — the biggest single win

Grass is *everywhere*, and about three quarters of everywhere is behind you.

Every frame each cell (one terrain chunk's worth of patches) is classified against
a horizontal **view cone**: the camera's own horizontal half-FOV plus a margin of
10–14° depending on detail level. Cells fully inside accept all their patches with
no further test; cells that straddle pay a per-patch cone test; cells outside are
skipped whole.

It is a cone rather than the six-plane frustum the scatter fields use, for three
reasons:

1. **Cheaper.** An exact 2D cone/circle test is a dot, a cross and a compare,
   against six plane evaluations.
2. **It admits a margin the frustum cannot express.** The frustum is exactly the
   visible set, so a fast turn reveals a cell the frame *after* it entered view —
   grass would visibly grow in at the screen edge. The margin is the rotation gap:
   at 60 fps and 14°, the camera can spin at **840°/s** before it outruns its own
   grass.
3. Grass is ground cover, so culling by pitch would drop the sward under the
   player's feet the moment they looked up.

### Measured, interleaved inside one page load

`GrassField.coneMarginOverride` switches it off at runtime, so this is an A/B of
one build against itself (rule 9). Software rasteriser, 800×450, `ultra`, three
rounds, median:

| | patches drawn | grass tris | scene tris | GPU | frame p50 |
|---|---:|---:|---:|---:|---:|
| cone off | 1 240 | 132 116 | 175 368 | 207 ms | 250 ms |
| **cone on (+14°)** | **422** | **55 652** | **98 904** | **160 ms** | **200 ms** |
| | **−66 %** | **−58 %** | −44 % | **−23 %** | **−20 %** |

The two-level split matters as much as the cone itself. The first version tested
cells only, and a 48 m cell has a ~35 m bounding radius — at 60 m that subtends
35° against a 57° cone, so a straddling cell was accepted whenever its centre
landed anywhere in a 176° arc. Measured: **15 of 27 cells culled** where the cone's
share of the circle is 22 %. Adding the per-patch test for straddling cells is
what closed the gap; an instrumented probe confirms the field now draws *exactly*
the patches an unoptimised full sweep would classify as inside the cone (422 of
1 240, matching to the patch).

**One thing this cost to learn.** The first A/B "disabled" the cone by opening it
to a 180° half-angle, and under-reported the saving by nearly half — 718 patches
against a true unculled 1 240. At 180° the cone still carries its apex guard
(`along < −radius` rejects anything more than a patch-radius behind the camera
plane), so "disabled" was really "front hemisphere". A toggle that silently
compares a state with itself is a trap this project has already hit once, in
§11b's occlusion measurement.

---

## 6. Performance, per detail level

### 6.1 The five levels

Named to match `perf/AdaptiveQuality.ts` exactly, so `auto` maps one onto the
other without a translation table nobody would keep in sync.

| level | density | range | cone margin | blades per patch (LOD0…LOD5) | near field |
|---|---:|---:|---:|---|---:|
| minimum | 0.22 | 0.45 | 10° | 198 / 133 / 66 / 38 / 19 / 10 | 12.4 /m² |
| low | 0.33 | 0.58 | 11° | 297 / 195 / 94 / 51 / 24 / 12 | 18.6 /m² |
| medium | 0.48 | 0.72 | 12° | 432 / 279 / 129 / 66 / 29 / 14 | 27.0 /m² |
| high | 0.70 | 0.86 | 13° | 630 / 399 / 177 / 86 / 36 / 17 | 39.4 /m² |
| ultra | 1.00 | 1.00 | 14° | 900 / 560 / 240 / 110 / 44 / 20 | 56.3 /m² |

**Range is the knob that gives up the horizon**, and it is where the saving is:
cost goes as `density × range²`, so cutting range is quadratically more effective
than cutting density. That is GDD §11c's rule and a rare alignment — the knob that
hurts the player least is also the knob that does the most.

**Density does not apply uniformly.** Each tier's share is
`density ** TIER_DENSITY_EXPONENT[tier]` with exponents `1.0 → 0.45`, so a lower
setting thins the **near** tiers hard and leaves the horizon nearly alone. This is
the opposite of `lod/config.ts`'s `TIER_QUALITY_EXPONENT`, and both are right:
there, quality moves *distance*, so pulling the near boundary in costs the player
detail on the object in front of them. Here `range` already owns distance and
`density` owns blades per patch — where the arithmetic runs the other way, for two
measured reasons.

* **The near tiers are where the cost is.** LOD0–LOD2 are 63 % of grass triangles
  at `ultra`. A flat multiplier takes most of its saving from tiers that were
  nearly free.
* **A flat multiplier empties the horizon.** LOD5 is 20 blades at `ultra`; at
  `minimum`'s 0.22 a flat scale leaves **4**, which after the horizon ramp is one
  blade per patch — a visibly bald far field on exactly the devices that can least
  afford it. With the exponent it keeps 10.

The small-looking densities are not a reduction against the previous ladder:
`minimum` bakes 198 blades into LOD0 where the old 0.5 baked 190. What changed is
the top. The fractions moved because the thing they are a fraction *of* moved.

**Density loss is compensated in width, per tier.** Halving blade count without
touching the blade halves ground coverage, and the result is not "less grass" — it
is bald ground with grass standing in it. Each tier widens by `1/√tierDensity`
(capped at 1.6). Per tier, because the thinning is per tier: a far tier that kept
85 % of its blades must not be widened as if it had kept 22 %, or the horizon
fattens while the near field stays honest.

### 6.2 Cost — the deterministic numbers

Desktop, headless Chrome, 1418 × 802, first-person at eye height in open meadow,
adaptive quality pinned to `ultra`, three rounds, median.

| level | draw calls | scene tris | **grass tris** | patches drawn | patches resident | grass CPU |
|---|---:|---:|---:|---:|---:|---:|
| **off** | 134 | 60 956 | 0 | 0 | 0 | 0 ms |
| **minimum** | 140 | 67 094 | **6 138** | 91 | 2 001 | 0.1 ms |
| **low** | 140 | 74 204 | **13 248** | 155 | 2 001 | 0.1 ms |
| **medium** | 140 | 90 976 | **30 020** | 235 | 2 001 | 0.1 ms |
| **high** | 140 | 113 128 | **52 172** | 326 | 2 273 | 0.1 ms |
| **ultra** | 140 | 158 050 | **97 094** | 444 | 2 722 | 0.3 ms |

* **Draw calls: +6 at every level, including `ultra`.** One per tier, flat. The
  frame stays at 140 against the GDD §5.2 ceiling of 180.
* **Programs: 11 → 12**, against the ≤13 ceiling. Grass is a second toon family;
  all six tiers share the one program and differ only by uniform.
* **CPU: 0.1–0.3 ms**, which is the cull, the tier assignment and the packing of
  ~450 patches × 48 bytes. It is flat across the ladder because it is a function
  of *patch* count, not blade count — tripling the near-field blades moved it not
  at all.
* Patch distribution at `ultra` across LOD0…LOD5: **6 / 8 / 28 / 67 / 111 / 224**.
  Note the shape — 75 % of patches are in the two cheapest tiers (and skip the
  wind block entirely), while 6 patches carry the whole near field.

### 6.3 GPU cost

**On a discrete GPU it is below the measurement floor, even at 14.7 megapixels.**
Interleaved four-round A/B at 5120 × 2880:

| level | grass tris at this res | scene tris | GPU ms (median) | fps |
|---|---:|---:|---:|---:|
| off | 0 | 186 446 | 6.09 | 60 |
| minimum | 15 835 | 200 973 | 5.85 | 60 |
| low | 32 844 | 219 290 | 5.89 | 60 |
| medium | 63 670 | 248 808 | 6.89 | 60 |
| high | 114 705 | 302 459 | 6.51 | 60 |
| ultra | **227 960** | 414 406 | 6.13 | 60 |

The spread across the whole ladder is 1.04 ms; the spread *within a single level*
across its four rounds is up to 2.8 ms. There is no signal. Grass at `ultra` adds
**227 960 triangles at 14.7 megapixels** and costs nothing the timer can resolve,
at a locked 60 fps.

The ablation profiler (GDD §5.3) says the same thing and should not be trusted
here either: on the same machine it reported `sculpt` — a tag that draws nothing
at all — at 2.24 ms. A scene running at 3–4 ms against a 16.7 ms vsync has too
much headroom for hiding one tag to resolve.

**On a software rasteriser it resolves**, and that is the honest worst case: a
machine with no GPU, where cost is pure rasterisation. 800 × 450, each level
measured against an `off` baseline taken immediately beside it, three rounds:

| level | grass tris | Δ GPU ms (median) | per-round Δ |
|---|---:|---:|---|
| minimum | 6 118 | **+2.3** | +8.6, −4.4, +2.3 |
| low | 12 588 | **+11.6** | +23.0, +2.9, +11.6 |
| medium | 29 039 | **+29.9** | +29.9, +32.3, +21.2 |
| high | 50 658 | **+43.9** | +56.4, +40.8, +43.9 |
| ultra | 94 930 | **+70.6** | +65.1, +72.8, +70.6 |

Against an `off` baseline of 76–95 ms. The per-round column is shown because it is
±15 ms noisy and pretending otherwise would be dishonest — but the medians are
monotonic and land at ~0.74 µs per 1 000 grass triangles, which is **well under
half** what the rest of the scene's triangles cost on the same machine (grass
triangles are small, opaque and early-z friendly).

Read as a ratio: on a machine with no GPU at all, `ultra` adds ~86 % to the
frame's rasterisation and `minimum` adds ~3 %. On anything with a real GPU, all
six levels are free and the choice is purely about how the meadow looks.

### 6.4 Memory and boot

| | |
|---|---:|
| tier geometries (6, shared) | 595 KB |
| tier instance buffers (6) | 203 KB |
| source instance pool (6 636 patches) | 311 KB |
| **total** | **1.11 MB** |
| boot cost (`WorldBuildInfo.phases`) | **14–16 ms** |

The geometry doubled when the near field did — LOD0 is 8 100 vertices at 900
blades, which is also why it is worth checking: one more doubling would pass the
65 535 ceiling on its `Uint16` index buffer.

Boot is a fifth of `scatter assets` (65–78 ms), unmoved by the density change, and
sits well inside the ~150 ms blocking boot. No textures are added — grass keeps
GDD §5.2's no-prop-textures rule intact.

### 6.5 Changing level is free

`setLevel` writes one uniform and six draw ranges. Nothing is regenerated,
nothing is allocated.

Density is `setDrawRange(0, blades × trianglesPerBlade × 3)` — every tier is baked
once at full density and blades are written into the index buffer in ordinal
order, so drawing the first N blades *is* a draw range. Width compensation is a
uniform (`uWidthScale`) rather than baked into `position.x`.

The first version regenerated all six patch geometries instead, and measured as a
**34 ms frame on the click**. Tolerable for a menu; unacceptable for `auto`, where
the level moves because `AdaptiveQuality` has just decided the machine is
struggling — spending 34 ms to prove it is the one thing a quality controller must
never do.

### 6.6 `auto`

Follows `AdaptiveQuality`, **one level below** it. The controller starts every
session at `ultra` and only walks down after ~20 over-budget samples, so a machine
that cannot run grass at ultra would spend its first second there — which is
exactly the second in which terrain is still streaming and the placeable catalogue
is still draining. The grass ladder is steeper than the quality ladder, so one
level of offset is a real reduction rather than a rounding.

---

## 7. Where grass grows

Placement (`grassPlacement.ts`) is **pure and three.js-free**, for the same two
reasons `heightfieldCore.ts` is: it can move onto the terrain worker without
dragging a second copy of three into that bundle, and it can be unit-tested
without a GL context. A chunk's patches are a function of `(heightfield params,
chunk coordinates)` and nothing else — a chunk that streams out and back in
produces byte-identical grass, or the meadow reshuffles behind the player's back.

**Suitability is a weight, not a test.** The obvious implementation rejects a patch
when the slope is too steep or the ground is sand, and that draws a hard line
across a hillside that nothing else in the scene follows. Instead every criterion
produces a density in [0,1], the densities multiply, and the shader thins the
patch accordingly. A meadow fades into scree over three or four metres, which is
what a real boundary looks like and costs nothing extra. A patch disappears only
once its density falls under 6 %, below which it would be paying a full instance
for ten visible blades.

The criteria: surface normal (full at `normalY` 0.9, gone by 0.62), height above
the water and sand line, an fbm clearing mask at ~62 m so the world has meadows
and bare ground rather than a uniform carpet, and a high-frequency thinning octave.

**Corner heights come from a shared grid.** A 48 m chunk holds 12 × 12 patches;
sampling four corners each is 576 `heightAtCore` calls, each of which is four fbm
evaluations. Sampling a 13 × 13 grid once and indexing it gives every patch its
four corners for **169** calls — 3.4× fewer — and makes adjacent patches share
corners *exactly*, so no seam can open between them. The surface gradient falls
out of the same grid by central difference, so the slope test is free.

**Residency is narrower than the terrain's** and decided separately. Chunks stream
to 190 m; grass is culled at 115 m, and at 52 m on `minimum`. Building grass for
every loaded chunk would be up to five times the patches, all of them permanently
outside the cull distance. Two chunks are converted per frame under the same
budget-don't-burst rule the terrain uploads follow, with 1.25× hysteresis.

---

## 8. Rejected, and why

| Technique | Why not |
|---|---|
| **One instance per blade** | 400 000 instances × 64 B is 26 MB of matrix data and a per-blade CPU loop. The patch is the right instancing unit; see §2. |
| **`InstancedMesh`** | Forces `instanceMatrix` — 64 bytes and a 4×4 multiply per vertex for a transform that is one position and one hash. A plain `Mesh` + `InstancedBufferGeometry` renders instanced without it. |
| **Heightmap texture for blade height** | A streamed height texture is a whole subsystem, and a vertex texture fetch per vertex. Four corner heights in the instance stream and a bilerp cost nothing and are accurate to centimetres over 4 m. |
| **Dithered LOD crossfade** | Grass tiers differ in *population*, so the non-shared blades are dithered against nothing and render as hatched combs. Replaced by a continuous density ramp, which is both better-looking and free — see §4.3. |
| **Rim light at the world default (0.45)** | Grass has no interior: every blade's normal is blended toward *up* while the camera looks along the ground, so `pow(1−N·V, p)` is at its maximum over the entire meadow at once. At 0.6 the field rendered as white straw and the horizon as white speckles. Cut to 0.15 and sharpened. |
| **Wide impostor blades at the far tiers** (6.4× width, 8/patch) | At 100 m the ground is seen at a grazing angle, so a 30 cm-wide triangle is not a tuft, it is a flag. The horizon came out as white speckles. What reads correctly there is a dense low fuzz — and the screen-width floor does that job better, because it sizes against the real framebuffer. |
| **Inverted-hull outline** (GDD R6) | `outlineMaterial.ts` already names this failure when it explains why the outline is a hull rather than a screen-space edge pass: a sobel "would put an outline around every blade of grass". A hull does the same from the other direction — double the draws and triangles for a 1.6 px line around a 3 cm blade. |
| **Casting shadows** | The shadow pass renders through three's depth material, which knows nothing about blades built in the colour shader — a caster would be the undrawn patch geometry sitting at the world origin. Same argument water makes in `assets/types.ts`. The shadow pass is already 63 % of GPU time in a constrained frame. |
| **Rebuilding tier geometry on a detail change** | 34 ms on the click, landing exactly when `auto` has decided the machine is struggling. Replaced by `setDrawRange` + a width uniform; see §6.5. |
| **Uncapped `lodBias`** | Grass covers area, so stretching range by the bias multiplies patches by its square. On a phone at DPR 2 the uncapped 1.69 took grass from 57 k to 113 k triangles, buying detail at 130–170 m where exp² fog has erased 70–80 % of it — and reaching past the streamed terrain onto the distant ring, which sits 2 m low by design, so the extra grass would visibly hover. Clamped to 0.7–1.15. |
| **A flat `density` multiplier across tiers** | Takes most of its saving from the far tiers, which were nearly free, and leaves LOD5 at four blades a patch on `minimum` — a bald horizon on the devices least able to afford one. Replaced by `TIER_DENSITY_EXPONENT`. |
| **Wind everywhere** | At 50 m a blade is 2–3 px wide and sub-pixel motion reads as sparkle, not as wind. Faded out 26 → 48 m; the two tiers past that skip the block on a draw-uniform branch. |

---

## 9. Revision pass — what could still be better

Written after the system was finished and re-read, in rough order of value.

1. **Placement should move to the terrain worker.** `grassPlacement.ts` is already
   three.js-free precisely so it can, and residency currently spends ~0.2 ms of
   main thread per chunk built. Nothing blocks it except plumbing a second message
   type through `ChunkWorkerPool`; it was left out to keep this change to one
   subsystem. On a 4×-throttled device that 0.2 ms is 0.8 ms, landing on the same
   frames as a terrain upload.
2. **Colour variation between clumps is per-blade, not per-clump.** `bladeHash`
   varies brightness blade by blade, which is right for texture and wrong for
   *reading* tufts as objects — a real meadow has patches of slightly different
   green a metre or two across. The patch tint already carries the macro
   variation; a mid-frequency term between the two is missing and would cost one
   hash.
3. **Blades do not react to the player.** Parting grass as the capsule walks
   through it is the single juiciest thing this system could gain, and it is
   cheap: one `uPlayerPos` uniform and a radial push in the vertex shader, on the
   near tiers only. It was left out because it is gameplay feel rather than
   rendering, and the brief was rendering.
4. **The near field could plausibly go further still.** LOD0 is 900 blades
   (56 /m²) and cost +40 k triangles for zero measurable GPU time — the same
   arithmetic says 1 400 would cost another 30 k and still be free on a discrete
   GPU. What stops it is not the frame: it is that LOD0's index buffer is `Uint16`
   and 900 blades is already 8 100 vertices, so roughly one more doubling hits the
   65 535 ceiling and the tier would have to split or go 32-bit.
5. **The screen-width floor is untested at very low render scales.** At
   `renderScale` 0.7 on a phone, `uUnitsPerPixel` grows 1.4× and blades widen with
   it. That is correct in principle — the floor is in *pixels* — but the
   interaction with `widthCompensation` at `minimum` (1.41×) has only been reasoned
   about, not looked at on a device.
6. **No occlusion culling.** `perf/TerrainOcclusion.ts` exists and grass does not
   use it. Grass is ground cover, so a ridge hides a great deal of it — plausibly
   a bigger win here than for the scatter fields, where it measured as no gain at
   all (§11b). It is not wired up because that measurement is only meaningful on
   the mobile hardware nobody has profiled yet, and adding an unmeasured cull to
   the system with the most instances is how the last one ended up defaulted off.
7. **The `off` setting frees nothing.** It stops all work and all drawing but keeps
   the 795 KB resident, so toggling back is instant. On a memory-constrained
   device the opposite trade might be right; nothing measures it either way.
8. **A patch on a tier boundary flips tiers every frame** as the camera breathes,
   and unlike the prop table there is no 8 % hysteresis band to stop it.
   Checked, and it is genuinely free: the visible result is nil (both tiers
   evaluate to the same blade count, which is the whole point of §4.3), and there
   is no upload cost either, because every non-empty tier re-uploads its whole
   packed range every frame anyway — grass does no dirty tracking (§5). Recorded
   because it *looks* like a defect on a read-through and is not; adding
   hysteresis would buy nothing.
9. **`grassUniforms` is module-level**, so two `GrassField`s in one process would
   fight over `uCullFar` and `uWidthScale`. Exactly the contract `worldUniforms`
   already sets, and the router guarantees one live `World` — but it is an
   assumption, not an invariant, and a second world would break it silently.

---

## 10. Checklist for changing this system

Run these before calling any `src/world/grass/` change done. They map to failures
that already happened once during this build.

* **`pnpm test`** — `tests/world/grass.test.ts` pins the subset property, the
  continuity of the density ramp across every tier boundary, the index-buffer
  layout that makes `setDrawRange` a blade count, placement determinism, and the
  shape of the detail ladder. Every one of those is invisible when broken.
* **Look at it at eye level, not from the orbit camera.** Every art bug in this
  system — the white rim wash, the hatched crossfade, the speckled horizon — was
  invisible from 40 m up and obvious from 1.7 m.
* **Judge GPU cost on a software rasteriser or not at all.** A discrete GPU cannot
  resolve this system's cost; the ablation profiler on this scene reports noise.
* **Judge smoothness by walking, not by looking.** Every LOD defect this system
  has had was invisible standing still and obvious in motion, and a framebuffer
  diff cannot see them (§4.3b). If you change `TIER_BLADES` or `GRASS_DISTANCES`,
  re-check the fade duration: `window / slope` must stay above ~0.5 m of camera
  travel at every distance, which a test asserts.
* **A/B inside one build** via `GrassField.coneMarginOverride` and
  `GrassField.fadeFractionOverride`, and remember that a 180° cone is not a
  disabled cone.
* **Watch draw calls stay at +6.** Any change that makes it +7 has added a tier or
  a material and needs a reason.
* **Check every tier with `Number.isFinite`** before its budget assertion.
  Comparisons against NaN are all false (AAA-graphics §3).
* **Never assign `onBeforeCompile`** — `GrassMaterial` chains into `ToonMaterial`,
  which chains into the cascaded shadows. An assignment deletes the ramp, the
  periwinkle shadows, the rim and the cascades, silently.
