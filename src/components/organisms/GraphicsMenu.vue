<template lang="pug">
  div(class="space-y-5")
    //- ── Grass detail ───────────────────────────────────────────────────────
    div(class="space-y-1.5")
      label(class="block text-sm text-slate-200" for="graphics-grass") {{ t('settings.grass') }}
      select(
        id="graphics-grass"
        class="w-full rounded-lg bg-slate-800/90 px-2 py-1.5 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus-visible:ring-amber-400/60"
        :value="settings.grassDetail"
        @change="onGrass"
      )
        option(v-for="level in grassLevels" :key="level" :value="level") {{ grassLabel(level) }}
      p(class="text-[11px] leading-snug text-slate-400") {{ grassHint }}

    //- ── Render scale ───────────────────────────────────────────────────────
    div(class="space-y-1.5")
      div(class="flex items-baseline justify-between")
        label(class="text-sm text-slate-200" for="graphics-scale") {{ t('settings.renderScale') }}
        span(class="text-xs tabular-nums text-slate-400") {{ t('settings.percent', { n: scalePercent }) }}
      input(
        id="graphics-scale"
        type="range"
        min="0.6"
        max="1"
        step="0.05"
        class="menu-range w-full"
        :value="settings.renderScale"
        @input="onScale"
      )
      p(class="text-[11px] leading-snug text-slate-400") {{ t('settings.renderScaleHint') }}

    //- ── Switches ───────────────────────────────────────────────────────────
    div(class="space-y-1 border-t border-white/10 pt-4")
      div(v-for="toggle in toggles" :key="toggle.key")
        button(
          type="button"
          class="flex w-full items-center justify-between gap-4 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-white/5"
          role="switch"
          :aria-checked="settings[toggle.key]"
          @click="setSetting(toggle.key, !settings[toggle.key])"
        )
          span(class="text-sm text-slate-200") {{ t(toggle.label) }}
          span(
            class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
            :class="settings[toggle.key] ? 'bg-amber-500' : 'bg-slate-700'"
          )
            span(
              class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-slate-100 transition-transform"
              :class="settings[toggle.key] ? 'translate-x-4' : 'translate-x-0'"
            )
        p(v-if="toggle.hint" class="px-1 pb-1 text-[11px] leading-snug text-slate-400") {{ t(toggle.hint) }}
</template>

<!--
  The graphics panel of the settings screen. This is where the player-facing
  graphics options live — they were moved out of `WorldSettingsPanel`, which is
  now the sandbox route's thin wrapper around this component.

  ── Props / emits ───────────────────────────────────────────────────────────
  None of either. Every control writes into the `useGameSettings` singleton.

  ── It does not touch the renderer, on purpose ──────────────────────────────
  The old panel called `world.applySettings(...)` directly, which meant the
  player's choices lived on an object that **does not survive the world being
  rebuilt**: walking from `/story` to `/characters` and back constructs a new
  `World` and every choice was gone. Now the setting is the record and the
  renderer is a consumer of it — whoever owns a `World` calls
  `applySettingsTo(world)` when it mounts and whenever `settings` changes.
  `WorldSettingsPanel` does that for the routes that mount it.

  ── Grass detail is not read back ───────────────────────────────────────────
  Under `auto`, `AdaptiveQuality` moves the grass level inside the frame loop.
  The old panel polled `world.settings.grassDetail` every 500 ms and wrote it
  into the control, which was right when the control was the renderer's state
  and is wrong now that it is the player's *request*: the read-back would
  replace their `auto` with whatever level the machine happened to be on, and
  the next reload would pin it there. So the select shows what they asked for,
  and `settings.grassAutoHint` says what `auto` means.
-->

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { type GameSettings, setSetting, settings } from '@/use/useGameSettings'
import { GRASS_DETAIL_SETTINGS, type GrassDetailSetting } from '@/world/grass/config'

const { t } = useI18n()

/**
 * A type-only import of the grass level union, and the runtime list beside it.
 *
 * `src/world/grass/config.ts` is a plain constants module — no three.js, no
 * scene — so importing it here does not drag the renderer into the settings
 * screen. The alternative was restating the seven level names in this file,
 * which is how a settings screen ends up offering a level the engine dropped.
 */
const grassLevels = GRASS_DETAIL_SETTINGS

type ToggleKey = Extract<keyof GameSettings, 'shadows' | 'outlines' | 'wind' | 'adaptiveQuality' | 'fpsMonitor'>

// Ordered by what a player reaches for when the game stutters: the two big
// passes first, then the cheap one, then the automatic that makes all three
// move on their own, and the readout that tells them whether it worked.
const toggles: readonly { key: ToggleKey; label: string; hint?: string }[] = [
  { key: 'shadows', label: 'settings.shadows' },
  { key: 'outlines', label: 'settings.outlines' },
  { key: 'wind', label: 'settings.wind' },
  { key: 'adaptiveQuality', label: 'settings.adaptive', hint: 'settings.adaptiveHint' },
  { key: 'fpsMonitor', label: 'settings.fpsMonitor' }
]

/**
 * The seven level names, reusing `world.settings.detail.*`.
 *
 * A second `settings.detail.*` block was rejected: the same seven words in two
 * places is the shape a half-translated screen comes from, and the parity test
 * would happily pass with both.
 */
const grassLabel = (level: GrassDetailSetting): string => t(`world.settings.detail.${level}`)

const grassHint = computed(() =>
  settings.value.grassDetail === 'auto' ? t('world.settings.grassAutoHint') : t('settings.grassHint')
)

const scalePercent = computed(() => Math.round(settings.value.renderScale * 100))

const onGrass = (event: Event): void => {
  const value = (event.target as HTMLSelectElement).value
  // Guarded rather than cast: the `<select>` can only ever hold one of these,
  // but the cast would be the thing that stopped being true if the option list
  // were ever fed from somewhere else.
  if ((GRASS_DETAIL_SETTINGS as readonly string[]).includes(value)) {
    setSetting('grassDetail', value as GrassDetailSetting)
  }
}

const onScale = (event: Event): void => {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) {
    return
  }
  // Clamped to the same 0.6–1.0 window `sanitiseSettings` enforces on load, so
  // a value written at runtime can never be one the loader would refuse.
  setSetting('renderScale', Math.min(1, Math.max(0.6, value)))
}
</script>

<style scoped lang="sass">
.tabular-nums
  font-variant-numeric: tabular-nums

// Same native range as `AudioMenu` — kept in both files rather than lifted into
// a shared atom, because a third file for eighteen lines of CSS is a worse
// trade than two copies that are read side by side.
.menu-range
  appearance: none
  height: 1.5rem
  background: transparent
  cursor: pointer

  &::-webkit-slider-runnable-track
    height: 0.375rem
    border-radius: 9999px
    background: rgba(148, 163, 184, 0.25)

  &::-moz-range-track
    height: 0.375rem
    border-radius: 9999px
    background: rgba(148, 163, 184, 0.25)

  &::-webkit-slider-thumb
    appearance: none
    margin-top: -0.3125rem
    width: 1rem
    height: 1rem
    border-radius: 9999px
    background: #fbbf24
    box-shadow: 0 1px 3px rgba(2, 6, 23, 0.6)

  &::-moz-range-thumb
    width: 1rem
    height: 1rem
    border: 0
    border-radius: 9999px
    background: #fbbf24
    box-shadow: 0 1px 3px rgba(2, 6, 23, 0.6)

  &:focus-visible
    outline: 2px solid rgba(251, 191, 36, 0.7)
    outline-offset: 4px
    border-radius: 9999px
</style>
