<template lang="pug">
  div(class="absolute bottom-3 left-3 z-40 flex flex-col items-start gap-2" :style="insetStyle")
    //- The panel opens *above* the button rather than over the scene's centre:
    //- a graphics setting is judged by looking at the world while changing it,
    //- so the world has to stay visible.
    transition(name="settings")
      div(
        v-if="open"
        class="max-h-[70vh] w-72 max-w-[85vw] overflow-y-auto rounded-xl bg-slate-950/80 p-3 text-slate-200 shadow-lg backdrop-blur-sm"
      )
        div(class="mb-3 flex items-center justify-between")
          span(class="text-sm font-semibold") {{ t('world.settings.title') }}
          button(
            type="button"
            class="rounded px-2 py-0.5 text-xs text-slate-400 hover:text-slate-200"
            @click="open = false"
          ) {{ t('close') }}

        GraphicsMenu

        //- Live cost, in the units a player can act on. Deliberately not draw
        //- calls or milliseconds: "blades on screen" is the thing the grass
        //- selector actually moves, and it is legible without a glossary.
        p(class="mt-3 border-t border-white/10 pt-2 text-[11px] tabular-nums text-slate-500")
          | {{ t('world.settings.drawnPatches', { n: patches, tris: triangles }) }}

    button(
      type="button"
      class="rounded-full bg-slate-950/65 px-4 py-2 text-xs text-slate-200 backdrop-blur-sm"
      :aria-label="t('world.settings.open')"
      @click="open = !open"
    ) {{ t('world.settings.title') }}
</template>

<!--
  The sandbox route's graphics flyout: a button bottom-left, `GraphicsMenu` in a
  panel above it, and the one thing that needs a live `World` — what the current
  settings are costing right now.

  ── Props / emits ───────────────────────────────────────────────────────────
  Props:  `world: World | null`. Emits: none.

  ── What moved out, and what this still owns ────────────────────────────────
  Every control now lives in `GraphicsMenu` and writes to the `useGameSettings`
  singleton; this file used to own the grass selector and wrote it straight into
  `world.applySettings`. That was two bugs waiting:

  * the choice lived on the `World`, which is **rebuilt** on every route change,
    so walking to `/characters` and back reset it;
  * it had its own `localStorage` key for one setting while the rest of the
    settings screen had another.

  What is left here is the half that genuinely needs the renderer: pushing the
  player's settings into whichever `World` is mounted (`applySettingsTo`), and
  reading the grass counters back out for the cost line. Any other host that
  owns a `World` — `StoryScene` — has to make the same `applySettingsTo` call;
  it is deliberately not hidden inside `useGameSettings`, because a settings
  module that reached for a global "current world" would be a second source of
  truth for which world that is.

  ── One-time migration off the old key ──────────────────────────────────────
  The one-time migration off this panel's old `world.grassDetail` key now lives
  in `use/useGameSettings.ts`. It ran here, on mount — and this panel is no
  longer mounted on `/story`, so a player who only opened the chapter would have
  silently lost the grass level they had chosen.
-->

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import GraphicsMenu from '@/components/organisms/GraphicsMenu.vue'
import { applySettingsTo, settings } from '@/use/useGameSettings'
import type { World } from '@/world/core/World'

const props = defineProps<{ world: World | null }>()

const { t } = useI18n()

/** Cost readout refresh. Slow on purpose — it is context, not an instrument. */
const SAMPLE_INTERVAL_MS = 500

const open = ref(false)
const patches = ref(0)
const triangles = ref(0)

// Safe-area insets, so the button clears the home indicator in landscape.
const insetStyle = {
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  paddingLeft: 'env(safe-area-inset-left, 0px)'
}

const push = (): void => {
  const world = props.world
  if (world) {
    applySettingsTo(world)
  }
}

const sample = (): void => {
  const world = props.world
  if (!world) {
    return
  }
  patches.value = world.grass.stats.drawnPatches
  triangles.value = Math.round(world.grass.stats.triangles / 100) / 10
}

let timer: number | null = null

/**
 * `settings` is replaced wholesale by `setSetting`, so a shallow watch sees
 * every change and a `deep: true` would only re-walk eleven fields for nothing.
 */
watch(settings, push)

// The world arrives *after* this component mounts — a child's `onMounted` runs
// before its parent's, and the parent is where `new World(...)` happens. Without
// this the player's settings would only reach the renderer on their next change.
watch(() => props.world, push)

onMounted(() => {
  push()
  timer = window.setInterval(sample, SAMPLE_INTERVAL_MS)
  sample()
})

onBeforeUnmount(() => {
  if (timer !== null) {
    window.clearInterval(timer)
  }
})
</script>

<style scoped lang="sass">
.settings-enter-active,
.settings-leave-active
  transition: opacity 160ms ease, transform 160ms ease

.settings-enter-from,
.settings-leave-to
  opacity: 0
  transform: translateY(6px)

.tabular-nums
  font-variant-numeric: tabular-nums
</style>
