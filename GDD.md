# aethel-fold — Game Design Document

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

> **Grass is the one exception, and it is stronger rather than weaker.** A
> crossfade *hides* a discontinuity; grass has none to hide. Its tiers differ in
> blade **population**, not in tessellation, and the blade count a patch draws is
> a continuous function of distance that evaluates to the same number on both
> sides of every tier boundary — so the swap changes nothing visible at all.
> Dithering it was tried first and looks worse: the blades a coarse tier lacks
> are drawn by the fine tier alone at 50 % coverage, reconstructed by nothing, and
> a half-tone on geometry three pixels wide is a comb rather than a fade. It is
> also free where a crossfade costs 21–29 % double-drawn instances. See
> [`grass.md`](./grass.md) §4.3.

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
| Grass tip warm | `#30371f` | **added**, not mixed, into a blade tip by t² |
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
| Tree (broadleaf) | 200 | 110 | 56 | 16 | 162 / 80 / 54 / 16 |
| Tree (crown) | 200 | 110 | 56 | 16 | 180 / 84 / 54 / 16 |
| Pine (spruce/fir, ±snow) | 200 | 110 | 56 | 16 | 192 / 98 / 52 / 15 |
| Birch | 180 | 100 | 50 | 14 | 172 / 90 / 44 / 14 |
| Ancient oak | 340 | 190 | 95 | 26 | 320 / 184 / 92 / 22 |
| Oak (broad / tall / leaning) | 200 | 110 | 56 | 16 | 162 / 80 / 54 / 16 · 180 / 84 / 54 / 16 · 162 / 80 / 54 / 16 |
| Tree stump (sawn, axe-notched) | 120 | 66 | 34 | 12 | 102 / 54 / 30 / 9 |
| Dead tree (snag / fallen log) | 110 | 56 | 30 | 14 | 90 / 42 / 24 / 9 · 84 / 44 / 24 / 12 |
| Shrub / sapling / thicket | 100 | 60 | 32 | 18 | 72 / 48 / 24 / 10 · 64 / 40 / 22 / 16 · 88 / 56 / 30 / 16 |
| Boulder | 180 | 96 | 44 | 12 | 140 / 80 / 36 / 12 |
| Stone | 72 | 40 | 20 | 8 | 56 / 36 / 20 / 8 |
| Plateau | 260 | 150 | 80 | 40 | 216 / 144 / 72 / 36 |
| Cliff spire | 260 | 150 | 100 | 36 | 200 / 120 / 80 / 30 |
| Basalt cluster | 210 | 124 | 60 | 20 | 196 / 115 / 54 / 18 |
| Slab | 112 | 76 | 40 | 18 | 96 / 64 / 32 / 16 |
| Grass rock | 130 | 84 | 40 | 20 | 99 / 63 / 30 / 15 |
| Mesa / butte | 300 | 175 | 95 | 44 | 280 / 168 / 84 / 42 |
| Stacked pillar | 260 | 150 | 82 | 38 | 240 / 144 / 72 / 36 |
| Shard wall | 260 | 150 | 78 | 30 | 252 / 144 / 72 / 24 |
| Hoodoo | 250 | 145 | 80 | 36 | 240 / 120 / 72 / 36 |
| Terrain chunk (48 m) | 1400 | 400 | 128 | 24 | 1344 / 384 / 120 / 18 |
| Grass patch (4 m) *(6 tiers)* | 6300 | 2800 | 720 | 110 / 44 / 20 | exact |
| Cottage / longhouse | 860 | 420 | 200 | 100 | 844 / 382 / 168 / 92 |
| Barn | 640 | 320 | 160 | 90 | 550 / 272 / 138 / 76 |
| Smithy (2 storeys) | 1220 | 620 | 340 | 140 | 1150 / 560 / 306 / 124 |
| Hut wall (interior shell, 2.6–6.4 m) | 340 | 200 | 110 | 60 | 228–292 / 132–164 / 58 / 40 |
| Hut wall with window bay (2.8 m) | 460 | 260 | 140 | 80 | 252 / 132 / 66 / 44 |
| Hut window glass *(translucent, no outline)* | 120 | 70 | 40 | 24 | 32 / 12 / 10 / 8 |
| Hut roof (shingled, 12.8 × 11.8 m) | 340 | 200 | 110 | 60 | 304 / 146 / 90 / 44 |
| Hut rafters (12.8 × 10.8 m room) | 700 | 380 | 170 | 100 | 426 / 228 / 100 / 32 |
| Chair (ladder-back) | 400 | 230 | 120 | 64 | 176 / 88 / 50 / 24 |
| Wall pieces (hammers · pelt · antlers · portrait) | 260–560 | 150–300 | 80–150 | 40–70 | 112 / 56 / 24 / 8 · 162 / 82 / 30 / 16 · 160 / 80 / 32 / 24 · 400 / 222 / 90 / 44 |
| Hunting net (panel, stakes, four guys) | 820 | 420 | 200 | 90 | 576 / 296 / 120 / 64 |
| Palisade run (4.8 m) | 540 | 290 | 120 | 60 | 462 / 256 / 30 / 16 |
| Village gate | 1320 | 760 | 410 | 140 | 680 / 318 / 192 / 48 |
| Bridge (7.2 m span) | 960 | 520 | 260 | 90 | 820 / 384 / 210 / 48 |
| Well | 600 | 330 | 190 | 70 | 414 / 198 / 92 / 36 |
| Cart / market stall | 680 | 380 | 200 | 70 | 344 / 172 / 58 / 16 (stall 280 / 136 / 60 / 32) |
| Log pile | 760 | 430 | 90 | 34 | 612 / 200 / 30 / 16 |
| Bench / trough | 280 | 160 | 80 | 30 | 108 / 60 / 30 / 8 |
| Trollschwein *(1 tier)* | 1450 | — | — | — | 734 |
| Sheep (ewe) | 560 | 280 | 130 | 80 | 516 / 242 / 108 / 66 |
| *(future)* Monster | 900 | 420 | 180 | 40 | — |
| Chibi human | 1380 | 700 | 430 | 320 | 896–1356 / 412–676 / 366–414 / 312 |

Generators call `assertTriBudget(geometry, budget, name)` and **throw** in dev if
they exceed it. The budget is a ceiling, not a target.

**The house rows were raised to pay for a facade and a thatch roof that are
actually there.** Cottage LOD0 went 720 → 860 (actual 582 → 812), LOD3 76 → 100.
None of it went on making the building bigger; all of it went on two things
paint had been failing to say, and both failures were measured rather than
judged by eye.

**The facade.** `box`'s path polygon put the cottage wall's seven LOD0 vertex
rows at height fractions 0, 0.001, 0.161, 0.803, 0.991, 0.999, 1 — **64 % of the
wall carried no vertex row at all** — so `timberFrame`'s "mid-rail at two thirds
height" resolved to height 0.99 and painted the rail on the wall plate. Its
corner posts were painted at v = 0, ¼, ½, ¾ while the section's corners are at
1/12, 4/12, 7/12, 10/12, i.e. a sixth of the perimeter away, in the middle of
each face. Fixing the polygon and giving the wall a ring schedule whose rows
*are* the sill, mid-rail and plate is free (a tier costs rings × segments, not
control points). What is not free is the 16-point wall section (100 → 160) and
the twelve applied timbers — four corner posts, four mid-rails, four braces —
at 16 triangles each. Those are modelled because vertex colour cannot express a
feature narrower than the vertex spacing: on an 18.8 m perimeter at 16 samples
the narrowest paintable vertical is 2.35 m, and buying it down to 1.2 m costs
320 triangles against 64 for four real posts that also break the outline.

**The roof got cheaper and fatter.** A 24-point `THATCH_SECTION` with a modelled
ridge cap (15–19 cm proud of the coat, 0.86 m across) and a modelled eaves bead
replaced a 16-point pitch whose "bead" measured *inside* its own slope line —
a chamfer, not a bead. It is paid for by dropping the roof's ring schedule from
`CURVED_RINGS`' 8 bands to 6: rings only shape the two gable half-hips, while
the section shapes the ridge and the eaves along the whole length. **240
triangles against the old 252.**

**And then the ridge got liggers, inside the budget rather than over it.**

Looked at in the browser from Nimmerschein's street, every thatched roof in the
village read as a flat tan plane. Three things were wrong and only one of them
was a matter of taste:

* `thatchPaint`'s course term was **phase-inverted**. A vertex row sits at
  `down = k/12`, so the old `q = ((down / THATCH_COURSE − 0.5) mod 1)` was 0 on
  the odd rows — which are exactly the rows `THATCH_SECTION` pushes *proud* — so
  the lap shadow was painted onto every butt edge and the paint cancelled the
  relief instead of reinforcing it.
* its `butts` term, a third of the roof's whole tonal range, was
  `smoothstep(0.62, 1.0, q)` against a `q` that is only ever 0 or 0.5. It was
  **identically zero at every vertex in every tier** and had never affected a
  pixel.
* the geometric lap was ±2.4 % of the rise, i.e. 3.6 cm and a 5° normal tilt on
  a cottage, which does not cross a toon band edge anywhere on the slope. It is
  ±3.2 % now: 4.8 cm, about 7°, and still 1.5 % of the slope, so still texture
  rather than sag.

The first two are free. What is not free is the **ridge fixing** — two hazel
liggers, one `flatTimber` each — and it is modelled rather than painted for the
reason the applied frame is: a painted ligger is a colour on a smooth surface,
so it vanishes under any light but a head-on one and can never reach the
silhouette. The ridge is the only part of a roof that is on the skyline from
every approach.

It is **two** members and not six because of this table. Crossed spars were
authored with them and cut: six applied timbers cost 96 at LOD0, and a cottage
is 812 against 860, a barn 550 against 640 and the smithy 1150 against 1220 —
the tightest has 48 to spend. A spar is 2.8 cm and 34 cm long, legible from the
doorstep and gone by ten metres; a ligger is a 8.4 cm line running the whole
ridge. Two of them cost 32 at LOD0 and 16 at LOD1, so the cottage lands at
844 / 382 and no cap in this table moved.

**The chibi human row was raised from 700 to 850 to pay for customisation, from
850 to 1060 to pay for hands, and from 1060 to 1380 to pay for a face with
volume.** Almost none of *customisation* costs
triangles and that has not changed: head shape (four shapes) is a warp of the
head that already exists, sex is two torso radii and a cross-section, and skin,
hair, tunic and brow colour are albedo. What costs triangles is geometry that
changes the silhouette, and there are now three kinds of it.

**Hair that breaks the outline**, which is the only kind worth modelling on a
figure read at 10–40 m: four spikes (120), an all-round mane (112), a pair of
braids or two locks over the shoulders (80), coiled templers (72), a long mass
(64), a ponytail or a topknot (60). Nine of the twenty-one carry **no mesh at
all** — `bowl`, `short`, `bald`, `coif`, `receding` are the head's own colour ramp
slid to a different height, because 10 mm of hair thickness on a 0.5 m head is
half a screen pixel at 20 m and a shell for it would be 50 triangles of nothing.

**A body that has hands, ears and brows**, which is where the 210 went:

| feature | tris | note |
|---|---:|---|
| hands | 192 | 96 a side: palm, index finger, thumb |
| ears | 60 | 30 a side, on every style that does not cover them |
| brows | 12 | 6 a side, in the character's hair colour |

The split matters more than the total, because a city pays for it per
townsperson. **Hands are 192 of the 210 and 19 % of the figure** — a lot for two
objects that are 30 px at 3 m and 3 px at 20 m, and the first thing a coarse tier
should attack: LOD1 wants the mitten back. They are spent because a character in
this game holds a sword, and the hand is where the player's eye goes the moment
one is drawn. **Ears were not new** — they were already 30 a side, but as a
*hairstyle's* geometry, so the game's default character (`bowl`) had none. They
belong to the body now and a haircut may only cover them; eleven styles do.
**Brows are 12** and are the only thing on the figure that puts the character's
hair colour on their face — they read to about 3 m and nothing past it, which is
the same range the mouth's five styles and the eye's lid slant work at.

**A face that is geometry rather than decals**, which is where the last 320 went
and the newest of the three. `face.ts` can put a dark shape anywhere on the
skull; what it cannot do is change the skull's *outline*, because a decal has no
thickness. `features.ts` adds the three things that do — and they are their own
axes on `CharacterAppearance`, not hair styles, because hair and beard were one
axis before this and "a grey mane **and** a beard to the sternum" was therefore
inexpressible:

| feature | tris | note |
|---|---:|---|
| beard, `moustache` → `forked` | 60–250 | eight styles, spread by which direction they break the outline |
| bushy brow ridge | 60 | 30 a side; the decal brow stays underneath it |
| nose | 30 | any of four, and the only feature on this head with a *profile* |

The nose is the best value in the whole table: 30 triangles for the one place
this figure's outline stops being an egg. The long beards are the dearest and
are also the largest silhouette change the figure has — `patriarch` is 216
triangles for a mass 294 mm across hanging 196 mm below the chin, which is more
outline than any hairstyle buys, read at 20 m where a face is not.

**All three default to the value that emits nothing**, so the shipped figure and
every character saved before they existed is still 956 triangles. A crowd pays
for facial hair at `professions.ts`'s own rate (0.4, and never on the feminine
build): about **+13 000 triangles on a hundred townspeople**, in the same draw
calls and the same programs, because every one of these is merged into the
body's own skinned mesh.

So the ceiling covers 896 (`coif`, the one style that is painted *and* covers the
ears) through **1356** (`ponytail` + `forked` + a nose + bushy brows), and leaves
24 of headroom.

**The four tiers now exist** (`chibiGeometry.ts::CHIBI_TIERS`), and their budgets
are **measured rather than scaled**, which is a change from every other row in
this table. The coarse tiers were 662 / 290 / 69 — LOD0 times the 0.48 / 0.21 /
0.05 a prop uses — and two of those three are unreachable by construction:

> A prop is one blob and its tessellation goes all the way down. A chibi is
> **twelve separate capsules**, and a capsule has a floor: four segments around,
> one ring along, one cap ring at each end is 24 triangles, and twelve of those
> is 288. With the head's extra cap rings the floor of this construction is
> **312**, four and a half times the 69 the scaling asked for. The number is not
> about detail, it is about how many *parts* a body is made of.

Dropping parts at LOD3 (the neck, which is already entirely inside the
head/torso overlap, and the two feet) reaches 240 — still 3.5× over, for a second
body topology to maintain and 576 triangles saved across a whole crowd. The
honest 69-triangle answer is an **impostor**, a billboard from a rendered atlas,
and this project has no impostor system; building one to save vertex work the
frame is not short of would be the wrong order of work. So the coarse budgets are
the measured worst case plus the ~2 % headroom LOD0 has.

What each rung drops, and the range that justifies it:

| tier | switch | figure is | drops |
|---|---:|---:|---|
| 1 | 18 m | 32 px | the face decals, the brow ridge, the nose, four fingers a hand |
| 2 | 45 m | 13 px | the hair mesh, the ears, the beard's own moustache and tines |
| 3 | 110 m | 5 px | the beard, both hands, half the sweep again |

**The beard outlives the nose by two tiers**, which is the one ordering worth
stating: a beard is *silhouette* — `patriarch` is 294 mm across on a 470 mm head,
still 6 px wide at 45 m — while a nose is 3 px at 8 m and gone by 20.

**And a character's ladder does not buy what a prop's buys.** Measured in the
world, eight NPCs against an empty crowd, the crowd's cost is **draw calls**
(161 → 181 against §5.2's ≤180), and a tier does not change how many draws a
figure is. What the ladder actually returns is the **hull past LOD1** — one draw
call per distant figure and its shadow another. Measured on eight wanderers: the
crowd submits 24 meshes with 12 hulls and 8 shadow casters up close, and 5 meshes
with 1 hull and 0 shadow casters at 60 m. The vertex saving (1356 → 312) is real
and is the smaller half.

**A torso or leg garment does not add to this row.** Both *replace* body parts
rather than covering them — the torso's 96 triangles and the legs' 144 are never
built — so a dressed figure is `body − replaced + garment`, and the garment's own
allowance comes from `EQUIPMENT_BUDGET` rather than from here.

**The grass patch is budgeted per *patch*, not per blade, and ships six tiers.**
That row is the only one in this table where the budget is met exactly rather
than undercut, because the geometry is generated *to* it: a patch is `N` blades
of `2s−1` triangles and both numbers are the design. It is also the only asset
whose tiers differ in population rather than tessellation — which is what buys
the six tiers and what removes the crossfade (R7).

The table is **front-loaded 45× from the near field to the horizon**, because
grass covers *area*: LOD0's disc is ~6 drawn patches while LOD5's ring is ~224, so
a blade spent on LOD0 is drawn six times and the same blade spent on LOD5 is drawn
two hundred times. At `ultra` a patch is 900 blades over 16 m² — **56 blades/m²**
underfoot against 1.3 at 115 m. See [`grass.md`](./grass.md).

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

**The three new oak rows share the scatter tree's ladder exactly, and that is
the point.** `oakBroad`, `oakTall` and `oakLean` are rows in `tree.ts`'s `FORMS`
table, not new generators — one material, one ramp, one budget ladder, so a
mixed wood still costs one draw call per tier per scatter field. What separates
them is where the canopy's mass sits and how far the trunk leans, measured as
bounding boxes at LOD0: **6.75 × 3.61 × 5.57 m** for the broad, **2.86 × 8.44 ×
2.23** for the tall, **4.53 × 4.89 × 4.72** with the canopy centroid 0.98 m off
the axis for the leaning one. Three *seeds* of one row differ by none of that,
which is why a wood built from three seeds read as one tree stamped repeatedly.

**None of them may exceed four clumps**, and that is arithmetic rather than
taste: at five, LOD2 wants 66 triangles against 56 and the only way back under
the ceiling is a 2-segment clump, which is a flat quad. The variation has to come
from `spread`, `squash`, `trunkTop` and `leanAmount` — which is convenient, since
those are also the four that survive distance.

**The forest floor is budgeted below the boulder and above the stone**, and it
buys three things the wood did not have. A **stump** says a person has been here,
and 30 of its 102 triangles are the cut face alone — four concentric rings
carrying painted growth rings and a pale sapwood band, because this is the one
prop the player looks *down* at and its silhouette is a boulder's. A **snag**
puts a bare vertical bar through the canopy line, which is the thing that makes a
stand of trees read as procedural: every other tree here puts its mass between
3 m and 9 m, so a wood is a continuous band of foliage over a continuous band of
shadow, and reseeding does not change that. And the **shrub / sapling / thicket**
row is the layer under four metres, without which a forest is a park — three
forms out of one generator and one material, so the densest field in the world is
one `InstancedLodField` rather than three.

**The stump's coarse tiers keep the cut face longest**, which is the one tier
ordering in this table that runs against size. LOD2 drops the bole to a triangle
in section while the cut face still carries three radial rings: at this asset's
LOD1→LOD2 switch (36 m at `distanceScale` 0.8) the bole is two pixels of bark and
the cut face is the entire prop.

**The ancient oak is budgeted as a landmark, not as flora.** 340 at LOD0 against
the scatter tree's 200, on exactly the argument the cliff family already makes
above: a scatter tree's budget is really a per-*field* budget, while the oak is
placed by hand in ones and twos and is the thing the player navigates by. What
it buys is branch structure — three or four gnarled limbs — which is the one
feature that separates an old tree from a big one, and which no amount of canopy
lumping substitutes for.

**The village is budgeted as landmark, not as scatter, and for the ancient
oak's reason.** A cottage is 582 triangles against a scatter tree's 162 because
it is placed by hand in twenties rather than by the thousand, it is the thing the
player navigates by, and — unlike anything else in the catalogue — its
*orientation* carries meaning. What its budget buys is set out in
`assets/structure.ts`: the roof mass, the wall mass, the chimney, the door and
the corner posts are modelled because every one of them changes the outline, and
the timber frame, the daub panels, the thatch courses and the plank seams are
**vertex colour**, because none of them does. The first pass modelled a full
Fachwerk frame and measured 1 640 triangles for one house — three times the
ancient oak — and read *worse* at 15 m, because paint has no bevel to lose.

**The palisade is the catalogue's only asset whose coarse tiers are a different
object.** LOD0 and LOD1 are twelve individually leaning split stakes; LOD2 and
LOD3 are one battered slab with the stake rhythm painted on. The gaps between
the stakes are the entire read of a stockade at close range, and past ~60 m a
stake is under a pixel wide and twelve of them alias into a shimmering band for
twelve times the triangles. `StructureMember.firstTier` is the field that exists
for this, and it is the one place in the project where §4.3's "tiers must not be
decimations of each other" is satisfied by *substitution* rather than by
re-evaluating one shape more coarsely.

**The Trollschwein ships one tier, not four.** It is the first claimant on the
`Monster` row and it takes only the LOD0 number. A creature in a chapter is never
further away than the fight it is part of, so a tier ladder would be four
geometries of which three never draw — the same call `Character` makes, for the
same reason its own tiers exist (a *crowd* recedes; a boss does not).

**The desert props are not new budget rows for new shapes.** A hoodoo is the
same lofted surface of revolution as a sea stack and a desert mesa is the same
mesa; the family is a `StonePalette` (`assets/stone.ts`) plus a sedimentary
banding paint pass, so it costs three colours and zero triangles. That is R1
taken to its conclusion: the strongest identifying feature of the whole desert
reference — the horizontal strata — is vertex colour, not geometry.

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

  > **Chapter 1's hamlet does not meet this and it is measured, not ignored.**
  > Measured on one build: **156** in the sandbox forest, **121** at the trap
  > clearing, **217** standing in the storyteller's yard and ~225 inside his
  > room. The room is where the instancing argument stops working — every prop
  > in it is placed *once*, so a field per definition is a draw per definition,
  > and there are 22 definitions in that room.
  >
  > Accounted for: the scene was already ~206 in that view before the room was
  > rebuilt. The rework added ~8 to the level batch (a roof, four window bays,
  > four panes, a chair and four wall pieces, against two wall slabs removed)
  > and the flock adds **+4** (two main-pass, two shadow-cascade, no new
  > program — five sheep are one skinned mesh). The water-aware scatter gives
  > some back by thinning overlaps.
  >
  > The remedy is a merge pass — one asset per *wall*, not per object on it —
  > and it is not a change to make while the room's layout is still moving.
  > The glass carries no inverted hull, which is both why it looks like glass
  > and one draw call per tier it does not spend (see `StructureSpec.outline`).
* **Zero per-frame allocation** in `src/world/` update paths. Scratch
  `Vector3`/`Matrix4` objects are module-level singletons. This is checked by
  watching GC sawtooth in the perf panel.
* **DPR capped at 2**, render scale user-adjustable 0.6–1.0.
* **One material program per shading family.** Every toon object shares one
  compiled program; variation comes from uniforms and vertex colours. Shader
  compilation stalls are the #1 cause of first-play jank.
* **No textures for props.** Colour is vertex colour. The only textures in the
  scene are the 1×N gradient ramp, the shadow map, and the **water atlas**.

> **The water exception, and why it is not a crack in the rule.** The rule exists
> so that detail comes from silhouette, authored normals and baked vertex data
> rather than from art assets — it is a budget on *download and memory*, and a
> discipline about where detail comes from. Water is the one surface that cannot
> pay it. Its detail is **high-frequency and animated**: caustics on a sandy
> bottom, cellular churn travelling down a river, blotchy foam sliding down a
> curtain. Vertex colour cannot carry any of that, because water's vertices are
> spent resolving the wave and the shoreline band, and there is no per-vertex
> budget left at the frequency the eye is reading.
>
> The alternative — evaluating it per-fragment — was costed and rejected: layered
> cellular noise is ~18 samples per pixel over a surface that routinely covers
> half the screen, on a mid-range Android target where water is already the
> heaviest overdraw in the frame.
>
> So water samples **one small tiling atlas that is generated procedurally at
> boot** (`world/water/waterTextures.ts`), exactly as the gradient ramp is. No
> art asset is authored, shipped or downloaded, so the budget the rule protects
> is untouched. What changed is only the claim that the ramp is the *only*
> generated texture — that was a statement about a world with no water in it.

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

**Vertex compression.** Terrain normals are `Int16` and colours `Uint16`, both
*normalized* attributes — WebGL expands them back to floats in fixed-function
hardware, so **24 B/vertex instead of 40 (−40 %)** across transfer, GPU upload
and resident memory, with **zero shader changes**. Positions stay `Float32`:
they're chunk-local, so 48 m already has millimetre precision, and quantising
them is where faceting on a gentle slope would show first. 16-bit rather than
8-bit because these colours are *linear* and terrain greens sit around 0.1–0.4,
where an 8-bit step is ~4 % relative — visible banding on a large hillside for
the cheap half of the saving.

`heightfieldCore.ts` and `chunkGeometry.ts` are **three.js-free** so the worker
bundle doesn't ship a second copy of three, and so the worker and the
main-thread fallback run literally the same function — a streaming system whose
background and fallback paths are two implementations is one where they drift.

Boot build dropped from ~900 ms to **296 ms** once terrain left the constructor.

**Scatter streams too.** Instances live in a fixed slot pool grouped into cells;
a cell is added when its terrain chunk loads and dropped when it unloads, so
scatter can never outlive the ground it stands on. Placement is a pure function
of `(seed, chunk coords)` — it has to be, or walking away and back would
reshuffle the forest behind you. **The world is unbounded**: `TerrainOptions.size`
is no longer passed. Verified by traversing to 1 399 m (the old bound was 192 m)
at a steady 60 fps with **zero janky frames**.

Two bugs only an unbounded world could expose, both found by walking out:

* The **sky dome** is a finite sphere that was fixed at the origin, so past
  900 m the player walked out through it and the horizon rendered as black
  wedges. It now follows the camera.
* Instance **culling spheres** were derived from LOD0's bounding sphere. Tiers
  are size-corrected against *each other* (§4.3), never against LOD0, so the
  tier reaching furthest is routinely a coarse one — an undersized sphere makes
  a prop vanish at the screen edge while part of it is still visible, which
  reads as a streaming failure rather than a culling one. The sphere is now
  measured across every tier.

### 5.2c Cascaded shadow maps

Three cascades over the view depth (splits ≈ 0 / 0.175 / 0.396 / 1.0 of a 260 m
range), replacing a single 2048 map over a 120 m box that simply stopped casting
60 m from the camera — the hard cap on view distance once terrain streamed past
it.

**three's `CSM.setupMaterial` cannot be used here.** It does
`material.onBeforeCompile = function (shader) { … }` — a plain assignment. Every
material in this world is a `ToonMaterial` whose `onBeforeCompile` carries the
dithered LOD crossfade, the fresnel rim, the periwinkle shadow tint and the
foliage wind. Calling it would silently delete all of that: the scene still
renders, just without any art direction, and nothing errors.

`core/shadows.ts` therefore applies the pieces by hand — two defines, three
uniforms, and enrolment in CSM's refresh map — and `ToonMaterial` *chains* into
it at the end of its own patches. The failure mode when that chain is missing is
worth recording: `USE_CSM` is defined, so the shader compiles the cascade branch,
which gates `RE_Direct` on the fragment's depth falling inside a cascade range.
With the uniforms absent that array reads as all-zero, no cascade ever matches,
and **the direct light disappears entirely** — no shadows, no toon bands, no
error.

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
~~grass field~~ **(built — `src/world/grass/`, six tiers, 6 draw calls, five
player-selectable detail levels; see [`grass.md`](./grass.md))**, cliffs, props
(fences, crates, ruins).

### Phase C — Characters *(started)*
* **Chibi humans** — 3-head proportions, cel-shaded, ~1000 tris, hand-painted
  vertex colours, face as a separate normal-flattened cap so toon bands never
  cut across the face.
  **Built** (`src/world/characters/`): 896–1016 tris, 19 bones, skinned body and
  skinned outline hull sharing one skeleton, walk/run/idle. The face cap exists —
  eyes, a mouth and hair-coloured brows pressed onto the skull's *built* surface
  by ray-cast, plus hands, ears, twenty-one hairstyles and four head shapes.
* **Monsters** — the animation bar is the point: correct weight-shift walk and
  run cycles (contact / down / pass / up, no floaty interpolation), and attacks
  with real anticipation → strike → recovery timing and hit-stop.
  Walk and run cycles exist and are asserted against that bar; attacks do not.
* Skeletal animation via glTF; LOD tiers share one skeleton, so LOD switching
  never re-binds a skin.
  **Departed from, deliberately:** the mesh and the cycles are procedural, like
  every other asset here — there are no character files to load. The engine path
  is unchanged (`SkinnedMesh` + `Skeleton`), so an imported glTF character drops
  into the same pipeline.
  **Built**: four tiers (`CHIBI_TIERS`), crossfaded with the same dither the
  props use, every rung bound to the **one** `Skeleton` the requirement above
  names — so a switch is a visibility change, not a re-bind. Rungs are built on
  demand and refreshed on equip; the hull and shadow casting stop at LOD1. See
  §4.1 for why the coarse budgets are measured rather than scaled.
  **Still owed**: the *gear* is single-tier. A wanderer's coat is 420 triangles
  and the boots 416, so a figure at LOD2 is 430 of body under 836 of costume —
  the garments now dominate a distant figure, which is the next thing to fix and
  is exactly the argument `gear/index.ts` makes in reverse ("unlike a world prop
  these are never at 200 m"). They are now.

> **Skinning costs programs.** `USE_SKINNING` forks every program a skinned mesh
> touches — toon, outline and shadow depth — taking the scene from 7 to **11**
> against the ≤13 ceiling in §5. That is a fixed cost for the whole character
> family, but a second skinned material family would not fit.

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
  grass/                    patch-instanced meadow, 6 tiers  →  grass.md
  assets/                   tree.ts, stone.ts, boulder.ts (procedural, 4 LODs)
  terrain/                  heightfield, chunked terrain with 4 tiers
  perf/                     profiler, GPU timer, ablation
src/views/WorldScene.vue    the Vue shell + perf panel  →  route /world  (lazy bench)
```

The route `/` now belongs to Aethel Fold (`aethel-fold-GDD.md`); Meadowfall is a
lazy-loaded bench at `/world`. The 2D tower-siege game this repo started as, and
the `/water` and `/characters` benches, have been removed; the save / platform
pipeline lives on under `aethel_state`.

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
