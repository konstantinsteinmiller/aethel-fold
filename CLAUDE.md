# 3d-world — project instructions

Two products live in this repo:

* **`src/world/`, route `/`** — the stylised cel-shaded 3D open world
  (*Meadowfall*). This is the project. All new 3D work goes here, and it's what
  every platform build boots into.
* **`src/game/`, `src/use/useTower*`, route `/tower`** — the original 2D canvas
  tower-siege game. Intact and still reachable, but no longer the default route.
  Untouched by the 3D work — don't refactor it "on the way".

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
