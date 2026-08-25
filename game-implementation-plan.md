# Grass system — implementation plan

Living plan for the `src/world/grass/` milestone. Resume from here if a session
ends. Final documentation lives in [`grass.md`](./grass.md).

## Goal

Automatic grass on grassy ground, **6 LOD tiers**, **5 player-selectable detail
levels** (+ `auto` + `off`) in a settings menu, directional (view-cone) culling,
and the fewest possible draw calls / triangles.

## Architecture

**One instance per *patch*, not per blade.** A patch is a 4 m × 4 m tuft cluster
whose blades are baked into the tier geometry once at boot and shared by every
instance. Per-instance data is 48 B (three `vec4`s, interleaved), against 64 B
for a bare `instanceMatrix` — and it replaces ~200 blade instances.

Rendering uses `Mesh` + `InstancedBufferGeometry` (verified: three 0.185 renders
instanced from `geometry.isInstancedBufferGeometry` but only defines
`USE_INSTANCING` for `isInstancedMesh`) — so there is **no `instanceMatrix`
attribute and no per-vertex matrix multiply**.

| file | role |
|---|---|
| `grass/config.ts` | 6-tier distance table, coverage maths, the 5 detail levels |
| `grass/bladeGeometry.ts` | per-tier patch geometry (clumped blade layout) |
| `grass/grassGlsl.ts` | vertex-shader blade construction, wind, taper |
| `grass/grassMaterial.ts` | `GrassMaterial extends ToonMaterial` (chains, never assigns) |
| `grass/grassPlacement.ts` | per-chunk patch generation — three.js-free, pure |
| `grass/GrassField.ts` | residency, cone cull, LOD assignment, packing |
| `components/organisms/WorldSettingsPanel.vue` | the player-facing menu |

## Steps

1. [x] Read the GDD / AAA-graphics contracts and the existing LOD, scatter,
       terrain, shading and settings code.
2. [x] `grass/config.ts` — tiers, ranges, levels.
3. [x] `grass/bladeGeometry.ts` — blade + clump layout, subset property across tiers.
4. [x] `grass/grassGlsl.ts` + `grass/grassMaterial.ts`.
5. [x] `grass/grassPlacement.ts` — suitability mask, corner heights, ground tint.
6. [x] `grass/GrassField.ts` — cone-sphere cull, per-chunk cells, packing.
7. [x] Wire into `World.ts` (settings, streaming hooks, frame, profiler tag).
8. [x] `WorldSettingsPanel.vue` + i18n across all 21 locales.
9. [x] Tests (`tests/world/grass.test.ts`).
10. [x] Measure per level in a real browser, write `grass.md`.
11. [x] Revision pass — see `grass.md` §9.

## Status: done

Shipped. `pnpm type-check`, `pnpm test` (754 tests, 61 files) and `vite build`
all pass; the browser console is clean at every detail level. Numbers, the
revision pass and the change checklist live in [`grass.md`](./grass.md).

Four things changed course mid-build and are worth remembering:

1. The **dithered crossfade was removed** for grass and replaced by a continuous
   per-blade density ramp. It looks better *and* is free. (`grass.md` §4.3)
2. The **rim light had to be cut to a third** of the world default — grass has no
   interior, so the fresnel is at maximum over the whole meadow at once.
3. **Detail changes became free** (`setDrawRange` + a width uniform) after the
   rebuild path measured 34 ms on the click.
4. The **view-cone A/B was initially wrong** because a 180° cone is not a
   disabled cone — it still carries the apex guard.

## Invariants that must not break

* No hex literals — colours come from `art/palette.ts`.
* `onBeforeCompile` is **chained**, never assigned.
* Zero per-frame allocation in `GrassField.update`.
* Grass never casts shadows (the depth material cannot see vertex-built blades —
  the same argument water makes in `assets/types.ts`).
* Grass draws no outline (an inverted hull per blade is the exact failure mode
  `outlineMaterial.ts` already warns about).
* Every tier checked with `Number.isFinite` before its budget assertion.
