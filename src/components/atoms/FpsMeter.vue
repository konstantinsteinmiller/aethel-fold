<template lang="pug">
  div(
    v-if="settings.fpsMonitor"
    class="pointer-events-none fixed top-0 left-0 z-40 select-none px-3 py-2 text-xs font-semibold tabular-nums fps-shadow"
    :class="tone"
    :style="insetStyle"
  ) {{ t('settings.fps', { n: fps }) }}
</template>

<!--
  The player-facing frame-rate readout. Top-left, one line, nothing else.

  ── Props / emits ───────────────────────────────────────────────────────────
  None. It reads `useGameSettings().settings.fpsMonitor` and shows itself when
  that is on, so it can be mounted once near the root of a scene and forgotten.

  ── Why it counts its own frames ────────────────────────────────────────────
  It deliberately does not ask the `World` or the ablation profiler. Two
  reasons, and the second is the one that matters:

  * this is an atom, and an atom that imports the renderer cannot be mounted on
    a route that has no renderer;
  * the profiler measures the *world's* frame. What a player means by "is it
    smooth" is the frame the browser actually presented, which includes the Vue
    overlay, the compositor and anything else on the page. A rAF-to-rAF delta is
    exactly that number.

  `FPerfMeter.vue` was rejected for this rather than extended: it gates on a
  `localStorage` code word instead of a setting, and its draw-call counter
  monkey-patches `CanvasRenderingContext2D` — which for a WebGL scene counts
  nothing at all while permanently wrapping every 2D canvas call in the tab.

  ── It shares a corner with the perf panel, and loses ───────────────────────
  `WorldPerfPanel` is also `fixed top-0 left-0`, at `z-50` against this one's
  `z-40`. They can only be up together when a developer has typed the perf
  panel's code word *and* left the player-facing readout on, and in that case
  the panel is the better instrument — GPU ms, p99 and worst frame, none of
  which this number can tell them. So it goes underneath rather than moving to a
  corner where a player would not look for it.

  ── Why a window and not 1/dt ───────────────────────────────────────────────
  A per-frame `1000 / dt` flickers between 58 and 62 and is unreadable; a
  one-second mean hides the very stutter the player turned this on to see. So:
  frames are counted over a 250 ms window, and the window's result is folded
  into the display with a light EMA. A single dropped frame moves it visibly,
  a vsync jitter does not.

  The loop allocates nothing — four numbers, no array, no object literal (the
  rule the rest of this project's update paths are held to).
-->

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { settings } from '@/use/useGameSettings'

const { t } = useI18n()

/** How long a sample runs before it is reported. 250 ms ≈ 15 frames at 60. */
const WINDOW_MS = 250
/** Weight of a fresh sample. 0.6 keeps a single bad window visible. */
const SMOOTHING = 0.6

const fps = ref(0)

let handle: number | null = null
let windowStart = 0
let framesInWindow = 0
let smoothed = 0

const tick = (now: number): void => {
  handle = requestAnimationFrame(tick)
  if (windowStart === 0) {
    windowStart = now
    return
  }
  framesInWindow += 1
  const elapsed = now - windowStart
  if (elapsed < WINDOW_MS) {
    return
  }
  const sample = (framesInWindow * 1000) / elapsed
  smoothed = smoothed === 0 ? sample : smoothed + (sample - smoothed) * SMOOTHING
  fps.value = Math.round(smoothed)
  windowStart = now
  framesInWindow = 0
}

const start = (): void => {
  if (handle !== null || typeof requestAnimationFrame === 'undefined') {
    return
  }
  windowStart = 0
  framesInWindow = 0
  smoothed = 0
  handle = requestAnimationFrame(tick)
}

const stop = (): void => {
  if (handle !== null) {
    cancelAnimationFrame(handle)
    handle = null
  }
  // Reset rather than freeze: a number left on screen from before the meter was
  // switched off would be read as current the next time it is switched on.
  fps.value = 0
}

// The loop only runs while the readout is on screen. A rAF that ticks for a
// hidden element is a wake-up per frame for nothing, and on a phone that is
// battery the player did not agree to spend.
watch(
  () => settings.value.fpsMonitor,
  on => {
    if (on) {
      start()
    } else {
      stop()
    }
  },
  { immediate: true }
)

onBeforeUnmount(stop)

// Bands, not a gradient — the question is "is this fine, marginal or bad", and
// three answers read faster than a continuous hue. Fixed thresholds because the
// game targets 60; on a 30 Hz panel the amber is honest about what is possible
// there rather than flattering it.
const tone = computed(() => {
  const value = fps.value
  if (value >= 55) {
    return 'text-slate-200'
  }
  return value >= 40 ? 'text-amber-300' : 'text-rose-400'
})

// Safe-area insets, so the readout clears a notch in landscape.
const insetStyle = {
  marginTop: 'env(safe-area-inset-top, 0px)',
  marginLeft: 'env(safe-area-inset-left, 0px)'
}
</script>

<style scoped lang="sass">
.tabular-nums
  font-variant-numeric: tabular-nums

// Legible over both a bright sky and a dark treeline without a plate behind it.
.fps-shadow
  text-shadow: 0 1px 2px rgba(2, 6, 23, 0.9), 0 0 3px rgba(2, 6, 23, 0.7)
</style>
