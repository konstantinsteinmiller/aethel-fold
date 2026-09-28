<template lang="pug">
  div(
    class="tracker pointer-events-none absolute right-0 top-[30%] z-20 select-none pr-3"
    :style="insetStyle"
  )
    transition(name="fade")
      div(v-if="rows.length > 0" class="w-56 max-w-[42vw] text-right")
        div(class="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-300/80") {{ t('story.objectives') }}

        //- Keyed by objective id so the list *moves* when the director advances
        //- a step, instead of the text of every row changing in place. Which
        //- row is new is then something the eye reads, not something it has to
        //- re-read the whole list to work out.
        transition-group(name="obj" tag="ul" class="relative mt-2 flex flex-col items-end gap-2")
          li(v-for="row in rows" :key="row.id" class="w-full")
            div(class="flex items-start justify-end gap-2")
              //- A diamond, bigger and amber for the objective in hand. Both
              //- are the same shape on purpose: the difference between "now"
              //- and "later" should read as weight, not as a second symbol to
              //- learn.
              span(
                class="shrink-0 rotate-45 rounded-[1px]"
                :class="[row.active ? 'mt-[6px] h-[7px] w-[7px] bg-amber-300' : 'mt-[5px] h-[5px] w-[5px] bg-slate-500', row.done ? 'opacity-40' : '']"
              )
              span(
                class="min-w-0 text-right leading-snug"
                :class="[row.active ? 'text-sm font-medium text-slate-100' : 'text-[11px] text-slate-400', row.done ? 'line-through opacity-50' : '']"
              ) {{ row.label }}
            div(
              v-if="row.distance"
              class="mt-0.5 text-[10px] tabular-nums"
              :class="[row.active ? 'text-amber-200/75' : 'text-slate-500', row.done ? 'opacity-50' : '']"
            ) {{ row.distance }}
</template>

<!--
  The objective list, right-hand side, ~30 % down from the top edge.

  ── Contract ────────────────────────────────────────────────────────────────

    props   objectives  `{ id, label, done?, distance? }[]`, **plain data**:
                        `label` is already translated, `distance` is metres or
                        null. The first entry is the active one.
    emits   none

  ── Why plain data and not the director ─────────────────────────────────────

  For the same reason `StoryOverlay` takes a flat snapshot: `StoryDirector` owns
  a `CombatDirector`, which owns `Character`s, which own skeletons, skinned
  meshes and their buffers. Handing any of that to Vue deep-proxies every one of
  them and drops the world to a slideshow (GDD §0). This component is not
  allowed to import it, and mapping the director's state into this shape is the
  scene's job.

  `label` arrives translated rather than as a key because the *chapter's*
  objective ids live in `story.objective.*` while a later chapter's may not, and
  a component that builds its own `t()` key decides where every future
  objective's string has to live. The chrome around the labels — the heading and
  the metres — is translated here, where it belongs.

  ── Position ────────────────────────────────────────────────────────────────

  `z-20`, one layer under `StoryOverlay`'s `z-30`, so its death, chapter-complete
  and pointer-lock screens always cover this rather than fighting it for the
  same pixels. Mount it inside the scene's `relative` host, beside `StoryOverlay`.
-->

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

interface Objective {
  id: string
  label: string
  done?: boolean
  distance?: number | null
}

const props = defineProps<{ objectives: Objective[] }>()

const { t } = useI18n()

interface Row {
  id: string
  label: string
  done: boolean
  active: boolean
  distance: string | null
}

const rows = computed<Row[]>(() =>
  props.objectives.map((objective, index) => ({
    id: objective.id,
    label: objective.label,
    done: objective.done === true,
    active: index === 0,
    // `Number.isFinite`, not `typeof === 'number'` alone: a distance derived
    // from a position that has not been written yet arrives as NaN, every
    // comparison against it is false, and the row would render "NaN m" — the
    // same trap the LOD generators guard against.
    distance:
      typeof objective.distance === 'number' && Number.isFinite(objective.distance)
        ? t('story.metres', { n: Math.max(0, Math.round(objective.distance)) })
        : null
  }))
)

// Clears a notch in landscape, and is 0 everywhere else.
const insetStyle = {
  paddingRight: 'calc(0.75rem + env(safe-area-inset-right, 0px))'
}
</script>

<style scoped lang="sass">
// The tracker sits over open meadow, which at midday is the brightest thing in
// the frame. Without this the amber heading and the slate-400 rows both wash
// out against it, and no amount of colour choice fixes that — the contrast is
// against a moving background.
.tracker
  text-shadow: 0 1px 3px rgba(2, 6, 23, 0.85)

.fade-enter-active,
.fade-leave-active
  transition: opacity 260ms ease

.fade-enter-from,
.fade-leave-to
  opacity: 0

.obj-enter-active,
.obj-leave-active,
.obj-move
  transition: opacity 240ms ease, transform 240ms ease

.obj-enter-from,
.obj-leave-to
  opacity: 0
  transform: translateX(14px)

// Taken out of flow while leaving, so the rows below it slide up under the
// `.obj-move` transition instead of jumping the moment the row is removed.
.obj-leave-active
  position: absolute
  right: 0

@media (prefers-reduced-motion: reduce)
  .obj-enter-active,
  .obj-leave-active,
  .obj-move
    transition: opacity 240ms ease

  .obj-enter-from,
  .obj-leave-to
    transform: none
</style>
