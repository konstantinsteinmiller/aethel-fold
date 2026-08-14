<template lang="pug">
  div(
    class="pointer-events-none fixed top-0 left-0 z-50 w-full p-2 font-mono text-[11px] leading-tight sm:w-auto sm:max-w-md"
    :style="insetStyle"
  )
    div(class="pointer-events-auto rounded-lg bg-slate-950/78 text-slate-200 shadow-lg backdrop-blur-sm")

      //- Header: always visible, doubles as the collapse toggle.
      button(
        type="button"
        class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left"
        @click="collapsed = !collapsed"
      )
        span(:class="['text-base font-bold tabular-nums', fpsClass]") {{ frame.fps }}
        span(class="text-slate-400") fps
        span(class="tabular-nums text-slate-300") {{ frame.cpuMs.toFixed(1) }}
        span(class="text-slate-500") cpu
        span(v-if="frame.gpuSupported" class="tabular-nums text-slate-300") {{ frame.gpuMs.toFixed(1) }}
        span(v-if="frame.gpuSupported" class="text-slate-500") gpu
        span(class="ml-auto text-slate-500") {{ collapsed ? '▸' : '▾' }}

      div(v-if="!collapsed" class="border-t border-white/10 px-3 pt-2 pb-3")

        //- ── Frame counters ────────────────────────────────────────────────
        div(class="grid grid-cols-2 gap-x-4 gap-y-0.5 text-slate-400")
          div(class="flex justify-between")
            span draw calls
            span(:class="['tabular-nums', frame.drawCalls > 180 ? 'text-amber-400' : 'text-slate-200']") {{ frame.drawCalls }}
          div(class="flex justify-between")
            span triangles
            span(class="tabular-nums text-slate-200") {{ formatCount(frame.triangles) }}
          div(class="flex justify-between")
            span programs
            span(class="tabular-nums text-slate-200") {{ frame.programs }}
          div(class="flex justify-between")
            span geometries
            span(class="tabular-nums text-slate-200") {{ frame.geometries }}

        //- Frame-time tail. The mean hides the spikes players actually feel,
        //- so p99 and the worst frame get equal billing with the average.
        div(class="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 border-t border-white/10 pt-1.5 text-slate-400")
          div(class="flex justify-between")
            span p50
            span(class="tabular-nums text-slate-200") {{ frame.frameMsP50.toFixed(1) }}
          div(class="flex justify-between")
            span p95
            span(:class="['tabular-nums', tailClass(frame.frameMsP95)]") {{ frame.frameMsP95.toFixed(1) }}
          div(class="flex justify-between")
            span p99
            span(:class="['tabular-nums', tailClass(frame.frameMsP99)]") {{ frame.frameMsP99.toFixed(1) }}
          div(class="flex justify-between")
            span worst
            span(:class="['tabular-nums', tailClass(frame.frameMsMax)]") {{ frame.frameMsMax.toFixed(1) }}
          div(class="col-span-2 flex justify-between")
            span janky frames / 240
            span(:class="['tabular-nums', frame.jankFrames > 0 ? 'text-amber-400' : 'text-slate-200']") {{ frame.jankFrames }}

        //- ── Per-tag table ─────────────────────────────────────────────────
        div(class="mt-2 border-t border-white/10 pt-2")
          div(class="mb-1 flex items-center justify-between")
            span(class="text-slate-400") cost by asset
            button(
              type="button"
              class="rounded bg-sky-600/80 px-2 py-0.5 text-slate-50 disabled:opacity-50"
              :disabled="ablationRunning"
              @click="measure"
            ) {{ ablationRunning ? `measuring ${Math.round(ablationProgress * 100)}%` : 'measure' }}

          table(class="w-full")
            thead
              tr(class="text-slate-500")
                th(class="text-left font-normal") tag
                th(class="text-right font-normal") draws
                th(class="text-right font-normal") tris
                th(class="text-right font-normal") inst
                th(class="text-right font-normal") cpu
                th(class="text-right font-normal") gpu
            tbody
              tr(v-for="row in tags" :key="row.tag")
                td(class="pr-2 text-slate-200") {{ row.tag }}
                td(class="text-right tabular-nums text-slate-300") {{ row.drawCalls }}
                td(class="text-right tabular-nums text-slate-300") {{ formatCount(row.triangles) }}
                td(class="text-right tabular-nums text-slate-300") {{ row.instances }}
                td(:class="['text-right tabular-nums', row.cpuMs > 1 ? 'text-amber-400' : 'text-slate-300']") {{ row.cpuMs.toFixed(2) }}
                td(:class="['text-right tabular-nums', gpuClass(row.gpuMs)]") {{ row.gpuMs < 0 ? '–' : row.gpuMs.toFixed(2) }}

          p(v-if="!frame.gpuSupported" class="mt-1 text-[10px] text-amber-400/90")
            | GPU timer queries unavailable — "gpu" column falls back to CPU frame delta and is only meaningful once frames drop below vsync.

        //- ── Toggles ───────────────────────────────────────────────────────
        div(class="mt-2 flex flex-wrap gap-1.5 border-t border-white/10 pt-2")
          button(
            v-for="toggle in toggles"
            :key="toggle.key"
            type="button"
            :class="['rounded px-2 py-0.5', settings[toggle.key] ? 'bg-emerald-600/75 text-slate-50' : 'bg-white/10 text-slate-400']"
            @click="flip(toggle.key)"
          ) {{ toggle.label }}

        div(class="mt-1.5 flex items-center gap-2")
          span(class="text-slate-400") scale
          input(
            type="range"
            min="0.6"
            max="1"
            step="0.05"
            class="h-1 flex-1 accent-sky-500"
            :value="settings.renderScale"
            @input="onScale"
          )
          span(class="w-8 text-right tabular-nums text-slate-200") {{ settings.renderScale.toFixed(2) }}

        //- ── Build info + budgets ──────────────────────────────────────────
        div(class="mt-2 border-t border-white/10 pt-2 text-slate-400")
          div(class="flex justify-between")
            span built in
            span(class="tabular-nums text-slate-200") {{ build.buildMs.toFixed(0) }} ms
          div(class="flex justify-between")
            span instances
            span(class="tabular-nums text-slate-200") {{ build.treeInstances }} trees · {{ build.rockInstances }} rocks
          button(
            type="button"
            class="mt-1 text-slate-500 underline"
            @click="showBudgets = !showBudgets"
          ) {{ showBudgets ? 'hide' : 'show' }} triangle budgets

          div(v-if="showBudgets" class="mt-1 max-h-40 overflow-y-auto")
            div(
              v-for="entry in budgets"
              :key="entry.name"
              class="flex justify-between gap-3"
            )
              span(class="truncate text-slate-500") {{ entry.name }}
              span(:class="['tabular-nums', entry.tris > entry.budget ? 'text-rose-400' : 'text-slate-300']")
                | {{ entry.tris }}/{{ entry.budget }}
</template>

<!--
  Dev overlay for the 3D world (GDD §5.3).

  Deliberately NOT internationalised: per the project i18n rule, debug overlays
  are exempt, and translating "draw calls" into 21 languages would add 40 keys
  that no player ever sees.

  Sampling is decoupled from the render loop on purpose. The profiler updates
  every frame in plain JS; this component copies its numbers into refs at 8 Hz.
  Driving Vue reactivity at 60 Hz from inside the render loop would put a patch
  pass on the hot path — the exact thing GDD §0 keeps three.js and Vue apart to
  avoid — and a counter that updates 60 times a second is unreadable anyway.
-->

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { FrameStats, TagStats } from '@/world/perf/Profiler'
import type { World, WorldSettings } from '@/world/core/World'

const props = defineProps<{ world: World | null }>()

const SAMPLE_INTERVAL_MS = 125

const collapsed = ref(false)
const showBudgets = ref(false)
const ablationRunning = ref(false)
const ablationProgress = ref(0)

const frame = ref<FrameStats>({
  fps: 0,
  cpuMs: 0,
  gpuMs: 0,
  gpuSupported: false,
  drawCalls: 0,
  triangles: 0,
  programs: 0,
  geometries: 0,
  textures: 0,
  frameMsP50: 0,
  frameMsP95: 0,
  frameMsP99: 0,
  frameMsMax: 0,
  jankFrames: 0
})

const tags = shallowRef<TagStats[]>([])
const settings = ref<WorldSettings>({
  outlines: true,
  shadows: true,
  wind: true,
  frustumCullInstances: true,
  hierarchical: true,
  renderScale: 1
})

const build = computed(
  () =>
    props.world?.buildInfo ?? {
      buildMs: 0,
      treeInstances: 0,
      rockInstances: 0,
      terrainChunks: 0,
      placeables: 0,
      seededProps: 0,
      budgets: []
    }
)
const budgets = computed(() => build.value.budgets)

// Safe-area insets, so the panel clears a notch in landscape on a phone.
const insetStyle = {
  paddingTop: 'env(safe-area-inset-top, 0px)',
  paddingLeft: 'env(safe-area-inset-left, 0px)'
}

const toggles = [
  { key: 'outlines' as const, label: 'outlines' },
  { key: 'shadows' as const, label: 'shadows' },
  { key: 'wind' as const, label: 'wind' },
  { key: 'frustumCullInstances' as const, label: 'inst cull' },
  { key: 'hierarchical' as const, label: 'cell cull' }
]

let timer: number | null = null

const sample = (): void => {
  const world = props.world
  if (!world) {
    return
  }
  // Copy, don't alias: handing the profiler's live object to a ref would make
  // Vue proxy an object mutated 60×/s.
  frame.value = { ...world.profiler.frame }
  tags.value = world.profiler.rankedTags().map(entry => ({ ...entry }))
  ablationRunning.value = world.profiler.ablationRunning
  ablationProgress.value = world.profiler.ablationProgressRatio
  settings.value = { ...world.settings }
}

onMounted(() => {
  timer = window.setInterval(sample, SAMPLE_INTERVAL_MS)
  sample()
})

onBeforeUnmount(() => {
  if (timer !== null) {
    window.clearInterval(timer)
  }
})

const measure = (): void => {
  props.world?.profiler.startAblation()
  ablationRunning.value = true
}

const flip = (key: keyof WorldSettings): void => {
  const world = props.world
  if (!world) {
    return
  }
  world.applySettings({ [key]: !world.settings[key] } as Partial<WorldSettings>)
  settings.value = { ...world.settings }
}

const onScale = (event: Event): void => {
  const value = Number((event.target as HTMLInputElement).value)
  props.world?.applySettings({ renderScale: value })
  settings.value = { ...(props.world?.settings ?? settings.value) }
}

const formatCount = (value: number): string =>
  value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}k` : `${value}`

const fpsClass = computed(() => {
  const value = frame.value.fps
  if (value >= 55) {
    return 'text-emerald-400'
  }
  if (value >= 40) {
    return 'text-amber-400'
  }
  return 'text-rose-500'
})

// 16.7 ms is the 60 Hz budget; 25 ms is a frame the eye registers as a hitch.
const tailClass = (ms: number): string => {
  if (ms >= 25) {
    return 'text-rose-400'
  }
  if (ms > 16.7) {
    return 'text-amber-400'
  }
  return 'text-slate-200'
}

const gpuClass = (value: number): string => {
  if (value < 0) {
    return 'text-slate-600'
  }
  if (value >= 3) {
    return 'text-rose-400'
  }
  if (value >= 1.2) {
    return 'text-amber-400'
  }
  return 'text-slate-300'
}
</script>

<style scoped lang="sass">
.tabular-nums
  font-variant-numeric: tabular-nums
</style>
