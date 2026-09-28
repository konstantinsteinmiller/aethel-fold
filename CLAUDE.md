# aethel-fold — project instructions

Two products live in this repo:

* **`src/world/`, route `/`** — the stylised cel-shaded 3D open world
  (*Meadowfall*). This is the project. All new 3D work goes here, and it's what
  every platform build boots into.
* **`src/game/`, `src/use/useTower*`, route `/tower`** — the original 2D canvas
  tower-siege game. Intact and still reachable, but no longer the default route.
  Untouched by the 3D work — don't refactor it "on the way".

* **`src/world/story/`, `src/world/combat/`, route `/story`** — *Chroniken von
  Arlaan*, chapter 1 (*Die Trollschweinjagd*), as a playable chapter. It runs on
  the same engine as Meadowfall: `World` is constructed with `mode: 'story'`,
  which brings the terrain, scatter, grass, lighting, LOD, profiler and adaptive
  quality and brings **none** of the level editor, the persisted placement store,
  the demo characters or the pooled crowd. Its props, its cast and its river are
  content, not player state, and are never written to `localStorage`.

The shared platform layer (`src/platforms/`, `src/utils/save/`, `src/i18n/`,
`src/components/atoms/F*`) is used by both. Changes there must not break either.

---

## Non-negotiables for `src/world/`

**Read [`GDD.md`](./GDD.md) before touching art or shading.** It is the contract;
for anything in `src/world/grass/`, read [`grass.md`](./grass.md) too — grass is
the one system that departs from the four-tier crossfaded LOD contract, and the
reasons are measured rather than stylistic.
the seven art rules (§2), the palette (§3), the LOD table (§4) and the
performance limits (§5) are binding. Summary of what breaks the look fastest:

1. **Raw three.js only — never TresJS, never `ref`s on scene objects.**
   Vue owns the DOM, three.js owns the canvas. No reactivity crosses into
   `src/world/`. Nothing in an update path may allocate.
2. **Colours come from `src/world/art/palette.ts`.** No hex literals in shaders,
   materials or generators.
3. **Bevel every cut, and take normals from the shape function, not the mesh.**
   Procedural shapes get analytic normals (central differences in
   `blobGeometry`); `smoothNormalsByAngle(38°)` is only for *imported* meshes.
   A fixed angle threshold silently leaves coarse LOD tiers faceted while fine
   ones smooth, which makes every LOD boundary flash a new shading solution.
4. **Foliage normals are blended toward the clump centre at 0.85**
   (`blendNormalsToSphere`). Ground scatter blends toward world up at 0.6.
   Skipping this is what makes stylised foliage look cheap.
5. **Shadows are never black** — they fall to the periwinkle tint. Rim light is
   mandatory on every lit object.
6. **Outlines**: inverted hull, constant 1.6 *screen* px, coloured (base × 0.22,
   shifted cool), LOD0 + LOD1 only. Never `#000`, never world-space width.
7. **Every world object ships 4 LOD tiers** within the budgets in GDD §4.1,
   generated through `assertTriBudget`, and switched with the **dithered
   crossfade** in `src/world/lod/`. A hard LOD swap is a bug.
   *Grass is the documented exception*: 6 tiers differing in blade population,
   with a continuous density ramp instead of a crossfade. It satisfies "nothing
   pops" more strictly, not less — see [`grass.md`](./grass.md) §4.3. Do not
   generalise it to anything whose tiers differ in tessellation.
8. **No prop textures.** Detail is vertex colour + authored normals + baked
   vertex AO. The only textures are the gradient ramp and shadow map.
9. **Instancing is the default** for anything appearing more than ~8 times —
   route it through `InstancedLodField`.
10. **Register every new scene root with the profiler** (`perfTag`), or it becomes
    invisible to the ablation profiler and its cost can't be attributed.

---

## Non-negotiables for the story chapter

* **The chapter's dialogue is content, not UI.** It lives in
  `src/world/story/script.ts` as German (the manuscript's own language) plus an
  English translation, and `storyLine()` falls back to English elsewhere. It is
  deliberately *not* in `src/i18n/locales/` — that bundle is chrome, where a
  machine translation is correct, and this is an author's prose. Everything
  *around* it (objectives, the control list, the two buttons) **is** chrome and
  **is** in all 21 locales, and `tests/i18nParity.test.ts` enforces that.
* **Nothing in `combat/` may know that a chapter exists.** `CombatDirector`
  takes a ground sampler and a collision world and never reaches back into the
  scene; `brains.ts` are pure functions of world state; `Combatant` owns no
  scene objects. The story is the only layer that knows both.
* **The player fills the same `Intent` struct a brain does.** That symmetry is
  load-bearing: a bug in lunge distance, guard arcs or dodge i-frames is then a
  bug you can watch happen to a bandit rather than one that only manifests on
  the one actor nobody can see from outside.
* **Balance numbers come from measurements, and the measurement goes in the
  comment.** `HIT_GRACE` and `CombatantStats.might` both exist because a
  standing player died in 2.4 s in the browser; both say so where they are
  defined.
* **The storyteller's furniture is sized to the rig, not to a person.** The
  chibi's hip-to-sole is 0.62 m against a real adult's 0.90, so a 0.5 m stool is
  a bar stool and a 0.76 m table is chest-high on somebody sitting at it. Seats
  are 0.34 and the table 0.56; the arithmetic that produces those, and the
  seated leg's two joint angles, is solved in `combat/postures.ts` rather than
  keyed by eye.
* **The HUD may read primitives off the snapshot, never fields of a struct
  inside it.** `StoryDirector` reuses one object for `talkTarget`, `seat` and
  the shot focus — deliberately, so nine cast members do not cost nine objects a
  frame — and the snapshot re-points at the *same reference* every frame. A
  `computed` reading `state.value.talkTarget.nameKey` therefore has no
  dependency on the name and re-runs only on a revision bump. The symptom: in
  the forest the companions walk in formation so the prompt never drops, and
  every one of them showed **"Jester"** — whoever was focused when it first
  appeared. Copy the field out into its own `ref` where the screen points are
  copied; an unchanged primitive assignment is a no-op for Vue's tracking, so it
  is free on the frames that do not change.
* **A collider is a proxy for the whole prop, not for the player's knees.**
  Four things ray-cast against a building's box now — the player, projectiles,
  the dialogue camera and the follow camera's spring arm — and only the first is
  a capsule. Building heights are the *roof apex*; a 2.4 m box under a 4.6 m
  house let the 2.85 m follow camera sail over the proxy and into the roof
  space, where back-face culling deleted the near wall and the building
  "disappeared on camera rotation". It is not a culling bug: measured over
  14 400 samples, the instanced field never dropped a building whose geometry
  was on screen.
* **Any camera on an arm needs a spring.** `StoryPlayer.shortenArm` and
  `DialogueCamera.constrain` both sweep with `segmentHit`, never `resolveMove` —
  the latter is written for a character, so it *slides* along a wall and reports
  the distance it started with. Constrain the smoothed position as well as the
  target, or the easing walks the lens through the wall for the frames it takes
  to catch up.
* **A frozen frame is not a still frame.** `CombatDirector.update` calls
  `settle` with the real `dt` while combat is disabled, and it must: passing 0
  makes `Character.update` return before `resetPose`, so the figure keeps the
  pose the last *moving* frame left on it and the player stands through every
  dialogue beat frozen mid-stride. Only `Combatant.tick` may stop.
* **`beam`'s `halfA` is not the height.** For a member running along +X the
  frame is `axisA = dir × up = +Z` and `axisB = +Y`, so on a *horizontal* member
  `halfA` is measured across the run horizontally and `halfB` vertically — the
  opposite way round from a vertical one. Getting it backwards made the window
  glass a 1.08 m-thick sheet lying flat through the wall, and nothing catches
  it: the budget is unchanged and the geometry is finite.
* **A posture is idempotent; a swing is not.** `applyClip` *adds* its hip lift,
  which is right for a clip composed on a freshly reset pose and catastrophic for
  one held for minutes — `Character.update` skips `resetPose` when `dt <= 0`, and
  the director runs `settle(actor, 0)` for the whole of every dialogue beat. Use
  `applyPosture`, which re-seats the pelvis first. Without it the household's
  heads were 30–52 m underground after two hundred frames of conversation.

## Conventions

* 2-space indent, single quotes, no semicolons (matches the existing codebase;
  `biome.json` says tabs but no file in the repo actually uses them).
* Vue SFCs: `<template lang="pug">`, `<style scoped lang="sass">`, Tailwind 4
  utilities in the template.
* Composables are module-level singletons (see the `singleton-composable` skill).
* **All player-facing strings go through vue-i18n and must be added to every
  locale in `src/i18n/locales/`.** Debug overlays (the perf panel) are exempt.
* `pnpm type-check` and `pnpm test` must pass before anything is called done.

## Performance is a recurring check, not a one-off

Before calling any `src/world/` change done, run the checklist in
[`AAA-graphics.md`](./AAA-graphics.md) §10 and the project memory
`world-perf-recurring-checks`. The short version:

* **Draw calls ≤ 180**, programs ≤ ~14 — instancing is the default, not an
  optimisation. Grass holds at a flat **+6 draws and +1 program** at every detail
  level; if a change makes it +7, it has added a tier or a material.
* **The ablation profiler has a floor.** On a desktop GPU this scene has 13 ms of
  headroom and hiding a tag reports noise — it once priced a tag that draws
  nothing at 2.24 ms. Load the machine (software rasteriser, constrained-device
  profile, `?density=N`) or report deterministic counters and say which.
* Judge by **p99 and worst frame**, never fps or a mean: the frame is vsync-bound
  at 60, so regressions only show in the tail.
* Judge GPU cost by **GPU ms** (timer queries), never CPU frame time — with vsync
  a 6 ms scene and a 15 ms scene both report 16.7 ms.
* **Zero per-frame allocation.** `subarray`, `map`, `filter` and object literals
  all count.
* **Never assign `onBeforeCompile` — chain it.** An assignment silently deletes
  the LOD crossfade, rim light, shadow tint and wind, with no error.
* **Check every generated tier with `Number.isFinite`.** Comparisons against NaN
  are all false, so the obvious guards silently pass.
* A/B **within one build** (`cell cull` toggle, `?density=N`), not across commits.

## Verifying 3D work

Typecheck is not sufficient — shader compile errors and LOD popping only show up
at runtime. Boot `pnpm dev`, open `/` (the world is the default route), check the console is clean, and use
the perf panel's ablation profiler to confirm nothing regressed against the
budgets in GDD §5.

**Nor is it sufficient for the chapter, and the misses are not subtle.** Four
defects in `/story` typechecked cleanly, passed 1 994 tests, and were only found
by opening a browser and looking:

* the entire cast stood 400 m below the terrain during every dialogue beat,
  because the combat director's frozen path posed the figures without ever
  writing their transforms;
* the whole village never drew, because the placement batch was built on frame
  one against a catalogue that drains over the following thirty;
* every roof was a dome, because a single apex control point is smoothed away by
  a closed B-spline;
* the ambush killed a standing player in 2.4 seconds.

Four more, from the same discipline applied to the storyteller's room:

* **every building in the hamlet was drawn at the world origin**, 1.7 km away,
  while the perf panel reported them as visible and in the right cell.
  `InstancedLodField` marked a tier dirty with `mask ^ masks[i]`, and `addCell`
  seeds a new slot at `0xff` on purpose — so the one tier that actually claimed
  the instance was the one bit XOR cleared. It self-heals the moment a prop
  changes LOD, which is why it survived: walk toward it and it snaps into place.
  Nothing on a fixed mark ever does.
* **the cast stood 10 cm inside the floorboards and the player 30 cm above
  them**, because the boards were authored 0.1 m proud, the cast is placed by
  `groundAt` (which samples *terrain*), and the walkable collider was 0.4 tall.
* **the household's heads ended up 30–52 m underground** during dialogue — see
  the posture note above.
* **a roof over a room the camera is inside** needs its *shadow* opened as well
  as its geometry: the dither discard lives in the toon material and the shadow
  pass uses three's own depth material, so a veiled roof went on shading the room
  it had just become see-through.

So: open `/#/story`, walk the chapter, and read the perf panel. `__story.jumpTo(id)`
is a DEV-only beat jump (`'ambush'`, `'boar-chase'`, `'home'`, `'frame-begin'`, …)
so a set piece twenty minutes in can be reached in one line.
