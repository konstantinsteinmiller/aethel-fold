# aethel-fold — project instructions

**Aethel Fold** (`src/fold/`, `src/views/FoldScene.vue`, route `/`) is the
product: a 3D origami pop-up-book castle siege on raw three.js, in two books of
six pages (`BOOKS` in `src/fold/logic/pages.ts`; book 2 unlocks after book 1). The spec is
[`aethel-fold-GDD.md`](./aethel-fold-GDD.md); the architecture decisions, task
list and status log are in
[`game-implementation-plan.md`](./game-implementation-plan.md). Read both before
changing gameplay or the look.

Also in the repo:

* **`src/world/`, route `/world`** — *Meadowfall*, the cel-shaded open-world
  engine the project grew out of. Kept as a lazy-loaded bench and not on the
  hot path. The `/water` lab, the `/characters` creator, the *Chroniken von Arlaan* chapter,
  the 2D tower game and the meta systems (battle pass, achievements, daily
  rewards and missions, treasure chest, ad-reward buttons) have been
  **removed**; don't resurrect them.
* **`src/voice/`** — the voice-over system, kept deliberately for later use.

The shared platform layer (`src/platforms/`, `src/utils/save/`, `src/i18n/`,
`src/components/atoms/F*`, `src/components/molecules/F*`) is used by both
Aethel Fold and the benches. Changes there must not break either.

---

## Non-negotiables for Aethel Fold

* **Logic is pure TS.** `src/fold/logic` imports neither three.js nor Vue, so
  every rule is unit-testable in `tests/fold`. The view layer reads logic state
  and consumes the pooled `EventQueue`; it never writes back except through the
  `FoldGame` input API (`grab`/`drag`/`release`/`tap`/`pullTear`/…).
* **Folds run in real time; the world runs in sim time.** Lessons slow the world
  to `LESSON_TIME_SCALE` and then freeze it, but the player's own fold must keep
  following the finger at full speed. Hit-stop pauses the world, never the
  paper.
* **Zero per-frame allocation** in logic, gestures, views, audio scheduling and
  `FoldScene`'s HUD sync. Use the `TMP` scratch objects in `paperGeometry.ts`
  and the pools in `entities.ts` / `FxLayer`.
* **Every paper object gets an id** (`nextPaperId`) so the Sobel pass can ink
  its silhouette. Id **127** means "no ink" (confetti, flames); anything that
  must never be outlined uses it. The highlight bit drives the pulsing yellow
  "actionable" outline, and the only way to tell the player a thing can be
  touched is to set it.
* **Colours come from `src/fold/render/palette.ts`.** Shadows fall to the
  periwinkle tint, never black; outlines are the ink colour, never `#000`.
* **One save object.** Every persisted value lives in `aethel_state`, through
  `useAethelState` (`getState`/`setState`) and the typed wrappers in
  `useFoldProgress`. Never add a localStorage key: `SaveMergePolicy.isPayloadKey`
  only uploads `aethel_state` and `__save_meta__`, so a new key silently never
  reaches the cloud. Hard checkpoints (page start or clear, victory) call
  `flushSaveNow()`. A late cloud hydration bumps `progressRevision`, and
  `FoldScene` must honour it by jumping to the restored page. The test for "not
  a false fresh user" is `tests/save/AethelStateCloudHydrate.test.ts` plus
  `tests/e2e/cloud-hydration.spec.ts`.
* **Onboarding is wordless.** A new mechanic gets a `LessonId` in `lessons.ts`,
  a trigger in `game.ts` and a ghost-hand script. The hint text under the hand
  is a secondary aid and goes through i18n like every other string.
* **No ads in the jury build** — no interstitials, no rewarded, no reward
  buttons. Ads exist only behind the build flags `VITE_APP_INTERSTITIALS` /
  `VITE_APP_REWARDED` (`src/platforms/adFlags.ts`), which are honoured only on
  platforms with an ad SDK (CrazyGames, GameDistribution, Playgama, GamePix,
  GameMonetize, Yandex, Poki) and are off for the jury, plain web, itch.io, Glitch
  and Wavedash builds. Any new ad code goes through `useFoldAds` and must
  early-return on those constants; `tests/platforms/foldAdFlags.test.ts` and
  `tests/ui/foldAdsUi.test.ts` guard the jury config.
* **Only the `Angry` font.** Monospace is allowed in debug overlays only.
* **Nothing walks through paper.** Lane walkers spawn at `PageDef.spawnZ` in
  front of any structure across the top, and a page built under a turning or
  peeling sheet keeps its pop-ups flat (`PageView.hold`) until the transition
  lets them rise. Keep the player's castle low (`CASTLE` in `config.ts`).
* **UI never overlaps UI or the page.** The HUD is a grid (left: page and
  hearts; centre: score and boss meter; right: mute and pause). Size everything
  with `clamp()`/`vw`/`vh` and safe-area insets, and check 320×658 portrait and
  658×320 landscape (`tests/e2e/responsive.spec.ts`).

---

## Non-negotiables for `src/world/` (the Meadowfall bench)

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

Typecheck is not sufficient: shader compile errors, ink artefacts, lesson
timing and hydration races only show up at runtime.

* `pnpm test:e2e` drives the real game in Chromium. It covers:
  * boot straight into page 1 with a clean console
  * the swipe lesson, stamp, tear and pause
  * the boss through to VICTORY
  * local persistence and reload
  * fake-SDK cloud hydration
  * HUD overlap at six viewports

  In a memory-tight container run it spec by spec, with
  `E2E_PLAIN_ONLY=1` for everything but `cloud-hydration`.
* For eyeballing, boot `pnpm dev` (port 2050) and use the DEV handle
  `window.__fold`:
  * `jumpTo(page, book?)` (book 2 = "The Homefront", GDD §11)
  * `clearPage()`
  * `fastForward(s)`
  * `state()`
  * `screenOf(x, z)`

  Headless screenshots need SwiftShader
  (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`) and run
  at about 5 fps, so fast-forward instead of waiting.
* For the Meadowfall bench, open `/#/world`, check the console, and read the perf
  panel's ablation profiler against GDD §5.
