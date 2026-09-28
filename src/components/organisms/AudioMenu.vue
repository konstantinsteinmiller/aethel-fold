<template lang="pug">
  div(class="space-y-5")
    //- ── Volumes ────────────────────────────────────────────────────────────
    div(v-for="row in rows" :key="row.key" class="space-y-1.5")
      div(class="flex items-baseline justify-between")
        label(:for="`audio-${row.key}`" class="text-sm text-slate-200") {{ t(row.label) }}
        span(class="text-xs tabular-nums text-slate-400") {{ t('settings.percent', { n: percent(row.key) }) }}
      input(
        :id="`audio-${row.key}`"
        type="range"
        min="0"
        max="1"
        step="0.05"
        class="menu-range w-full"
        :value="settings[row.key]"
        @input="onVolume(row.key, $event)"
      )

    //- ── Mute ───────────────────────────────────────────────────────────────
    //- Below the sliders and separated, because it overrides all four rather
    //- than being a fifth of them.
    div(class="border-t border-white/10 pt-4")
      button(
        type="button"
        class="flex w-full items-center justify-between gap-4 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-white/5"
        role="switch"
        :aria-checked="settings.muted"
        @click="setSetting('muted', !settings.muted)"
      )
        span(class="text-sm text-slate-200") {{ t('settings.mute') }}
        span(
          class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
          :class="settings.muted ? 'bg-amber-500' : 'bg-slate-700'"
        )
          span(
            class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-slate-100 transition-transform"
            :class="settings.muted ? 'translate-x-4' : 'translate-x-0'"
          )
</template>

<!--
  The audio panel of the settings screen.

  ── Props / emits ───────────────────────────────────────────────────────────
  None of either. It writes straight into the `useGameSettings` singleton, which
  persists itself — a panel that emitted its changes upward would need every
  host to re-implement the same four `setSetting` calls, and the one that forgot
  would silently drop the player's choice.

  ── Why the controls are hand-built ─────────────────────────────────────────
  `FSlider` and `FSwitch` exist and were rejected: they are the 2D tower game's
  chrome — skewed bodies, yellow-to-orange gradients, four-way black text
  shadows — and dropping one into this overlay reads as a different game pasted
  into the pause menu. The house style here is `StoryOverlay`'s: slate plate,
  one hairline ring, amber only where something is on.

  ── What consumes these ─────────────────────────────────────────────────────
  Voices does: `world/story/speech.ts` plays the chapter's voice-over at
  `masterVolume × voiceVolume`, silenced by `muted`, and pushes a mid-sentence
  slider move onto the clip that is already talking. The other two are still
  stored-only — the world has no music or effects mixer at the time of writing —
  and they stay here so whichever layer grows one reads these numbers rather
  than inventing a second set. `muted` is the flag the platform mute callbacks
  (`useGamePauseAudio`) already expect to find a player-side equivalent of.
-->

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { type GameSettings, setSetting, settings } from '@/use/useGameSettings'

const { t } = useI18n()

type VolumeKey = Extract<keyof GameSettings, 'masterVolume' | 'musicVolume' | 'effectsVolume' | 'voiceVolume'>

// Master first, and it stays first: it is the one a player reaches for when the
// game is too loud, and the three below it are the balance they set once.
//
// Voices last rather than second, even though the chapter is mostly people
// talking: it is the row a player only goes looking for once they have decided
// something specific about the voice-over — that the placeholder TTS is worse
// than reading the line themselves — and putting it above Music would push the
// two everyone actually adjusts further down the panel.
const rows: readonly { key: VolumeKey; label: string }[] = [
  { key: 'masterVolume', label: 'settings.master' },
  { key: 'musicVolume', label: 'settings.music' },
  { key: 'effectsVolume', label: 'settings.effects' },
  { key: 'voiceVolume', label: 'settings.voice' }
]

const percent = (key: VolumeKey): number => Math.round(settings.value[key] * 100)

const onVolume = (key: VolumeKey, event: Event): void => {
  const value = Number((event.target as HTMLInputElement).value)
  // A range input cannot normally produce NaN, but a parse of an empty string
  // can — and `clamp` in `sanitiseSettings` only guards what is *loaded*, not
  // what is written at runtime.
  if (!Number.isFinite(value)) {
    return
  }
  setSetting(key, Math.min(1, Math.max(0, value)))
}
</script>

<style scoped lang="sass">
.tabular-nums
  font-variant-numeric: tabular-nums

// The one place a raw element is styled rather than wrapped: a native range
// input keeps its keyboard behaviour (arrows, Home/End, Page Up) for free, and
// re-implementing that on a div is how a settings screen stops being reachable
// without a mouse.
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
