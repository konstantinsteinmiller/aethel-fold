<template lang="pug">
  div(class="absolute bottom-3 left-3 z-40 flex flex-col items-start gap-2" :style="insetStyle")
    //- The panel opens *above* the button rather than over the scene's centre:
    //- a graphics setting is judged by looking at the world while changing it,
    //- so the world has to stay visible.
    transition(name="settings")
      div(
        v-if="open"
        class="w-64 max-w-[80vw] rounded-xl bg-slate-950/80 p-3 text-slate-200 shadow-lg backdrop-blur-sm"
      )
        div(class="mb-2 flex items-center justify-between")
          span(class="text-sm font-semibold") {{ t('world.settings.title') }}
          button(
            type="button"
            class="rounded px-2 py-0.5 text-xs text-slate-400 hover:text-slate-200"
            @click="open = false"
          ) {{ t('close') }}

        label(class="mb-1 block text-xs text-slate-400" for="world-grass-detail") {{ t('world.settings.grass') }}
        select(
          id="world-grass-detail"
          class="w-full rounded-lg bg-slate-800/90 px-2 py-1.5 text-sm text-slate-100 outline-none"
          :value="detail"
          @change="onDetail"
        )
          option(v-for="option in options" :key="option" :value="option") {{ label(option) }}

        p(class="mt-1.5 text-[11px] leading-snug text-slate-400") {{ hint }}

        //- Live cost, in the units a player can act on. Deliberately not draw
        //- calls or milliseconds: "blades on screen" is the thing the slider
        //- above actually moves, and it is legible without a glossary.
        p(class="mt-2 border-t border-white/10 pt-2 text-[11px] tabular-nums text-slate-500")
          | {{ t('world.settings.drawnPatches', { n: patches, tris: triangles }) }}

    button(
      type="button"
      class="rounded-full bg-slate-950/65 px-4 py-2 text-xs text-slate-200 backdrop-blur-sm"
      :aria-label="t('world.settings.open')"
      @click="open = !open"
    ) {{ t('world.settings.title') }}
</template>

<!--
  Player-facing graphics settings for the 3D world.

  Separate from `WorldPerfPanel`, which is a dev overlay and exempt from i18n:
  everything here is a player-visible string and goes through vue-i18n into every
  locale the project ships.

  The world is the source of truth for the setting, not this component — the
  `auto` mode is driven by `AdaptiveQuality` inside the frame loop, so a local
  `ref` would drift the moment the machine changed the level under it. The
  selector reads `world.settings.grassDetail` and writes through `applySettings`.
-->

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { World } from '@/world/core/World'
import { GRASS_DETAIL_SETTINGS, type GrassDetailSetting } from '@/world/grass/config'

const props = defineProps<{ world: World | null }>()

const { t } = useI18n()

const STORAGE_KEY = 'world.grassDetail'
/** Cost readout refresh. Slow on purpose — it is context, not an instrument. */
const SAMPLE_INTERVAL_MS = 500

const open = ref(false)
const detail = ref<GrassDetailSetting>('auto')
const patches = ref(0)
const triangles = ref(0)

const options = GRASS_DETAIL_SETTINGS

// Safe-area insets, so the button clears the home indicator in landscape.
const insetStyle = {
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  paddingLeft: 'env(safe-area-inset-left, 0px)'
}

/**
 * Restored from storage, because a graphics setting that resets on reload is one
 * the player has to find again every session. Guarded because storage throws
 * outright in a sandboxed iframe, which is how several of the portals this ships
 * to serve games.
 */
const readStored = (): GrassDetailSetting | null => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored && (GRASS_DETAIL_SETTINGS as readonly string[]).includes(stored)
      ? (stored as GrassDetailSetting)
      : null
  } catch {
    return null
  }
}

const label = (option: GrassDetailSetting): string => t(`world.settings.detail.${option}`)

const hint = computed(() =>
  detail.value === 'auto' ? t('world.settings.grassAutoHint') : t('world.settings.grassHint')
)

const apply = (next: GrassDetailSetting): void => {
  detail.value = next
  props.world?.applySettings({ grassDetail: next })
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Not worth surfacing — the setting still applies, it just forgets.
  }
}

const onDetail = (event: Event): void => {
  apply((event.target as HTMLSelectElement).value as GrassDetailSetting)
}

let timer: number | null = null

const sample = (): void => {
  const world = props.world
  if (!world) {
    return
  }
  // Read back rather than trusting the local ref: under `auto` the frame loop
  // moves the level without anyone touching this component.
  detail.value = world.settings.grassDetail
  patches.value = world.grass.stats.drawnPatches
  triangles.value = Math.round(world.grass.stats.triangles / 100) / 10
}

onMounted(() => {
  const stored = readStored()
  if (stored) {
    apply(stored)
  } else {
    detail.value = props.world?.settings.grassDetail ?? 'auto'
  }
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
