<template lang="pug">
  div(ref="host" class="relative h-full w-full overflow-hidden bg-slate-900 select-none")
    canvas(
      ref="canvas"
      class="block h-full w-full touch-none outline-none"
    )

    //- Counters. Water is transparent and overdraw-heavy, so this scene has to
    //- be able to show its own cost — shipping it blind would defeat the point
    //- of building it.
    div(class="pointer-events-none absolute top-0 left-0 z-40 p-2 font-mono text-[11px] leading-tight" :style="insetStyle")
      div(class="rounded-lg bg-slate-950/78 px-3 py-2 text-slate-200 shadow-lg backdrop-blur-sm")
        div(class="flex items-center gap-2")
          span(:class="['text-base font-bold tabular-nums', fpsClass]") {{ stats.fps }}
          span(class="text-slate-400") fps
          //- Vsync pins the green number; the purple one is the ceiling. Water is
          //- overdraw-bound, so this is the number that moves when a preset does.
          span(v-if="stats.uncappedFps > 0" class="text-base font-bold tabular-nums text-purple-400") {{ stats.uncappedFps }}
          span(v-if="stats.uncappedFps > 0" class="text-purple-400/60") max·{{ stats.uncappedBy }}
          span(class="tabular-nums text-slate-300") {{ stats.cpuMs.toFixed(1) }}
          span(class="text-slate-500") cpu
        div(class="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 border-t border-white/10 pt-1 text-slate-400")
          div(class="flex justify-between gap-3")
            span draws
            span(class="tabular-nums text-slate-200") {{ stats.drawCalls }}
          div(class="flex justify-between gap-3")
            span tris
            span(class="tabular-nums text-slate-200") {{ formatCount(stats.triangles) }}
          div(class="flex justify-between gap-3")
            span programs
            span(:class="['tabular-nums', stats.programs > 13 ? 'text-amber-400' : 'text-slate-200']") {{ stats.programs }}
          div(class="flex justify-between gap-3")
            span p99
            span(:class="['tabular-nums', stats.frameMsP99 > 16.7 ? 'text-amber-400' : 'text-slate-200']") {{ stats.frameMsP99.toFixed(1) }}
        div(class="mt-1 border-t border-white/10 pt-1")
          table(class="w-full text-slate-400")
            tr(v-for="row in tags" :key="row.tag")
              td(class="pr-3 text-slate-300") {{ row.tag }}
              td(class="pr-3 text-right tabular-nums") {{ row.drawCalls }}
              td(class="text-right tabular-nums") {{ formatCount(row.triangles) }}

    //- Caption + presets. A dev bench, so plain strings: the project's i18n rule
    //- exempts debug surfaces, and the perf panel sets the precedent.
    div(class="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex flex-col items-center gap-2 p-3")
      p(class="max-w-xl rounded-full bg-slate-950/65 px-4 py-1.5 text-center text-xs text-slate-200 backdrop-blur-sm")
        | {{ caption }}
      div(class="pointer-events-auto flex flex-wrap justify-center gap-1.5")
        button(
          v-for="preset in presets"
          :key="preset.id"
          type="button"
          :class="['rounded-full px-3 py-1.5 text-xs backdrop-blur-sm', preset.id === active ? 'bg-sky-600/85 text-slate-50' : 'bg-slate-950/65 text-slate-300']"
          @click="jump(preset.id)"
        ) {{ preset.label }}
</template>

<!--
  `/water` — the Vue shell for the water bench.

  Same division of labour as `WorldScene.vue`, and for the same reason: this
  component owns a canvas element, a size and a lifecycle, and every frame of
  work happens inside `WaterLab`. The instance is held in a `shallowRef` and
  wrapped in `markRaw` so Vue's reactive proxy never reaches a scene node — a
  plain `ref` would put dependency tracking on the LOD system's per-frame
  `visible` writes, which fails silently by rendering correctly at 12 fps.

  `WorldPerfPanel` is deliberately not reused: it is typed against `World` and
  reads `buildInfo`, `settings` and `applySettings` off it, none of which exist
  here. Rather than widen a shared component for a bench, the counters that
  matter for water — draws, triangles, programs, and the per-tag split — are
  read straight off this scene's own profiler.
-->

<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef } from 'vue'
import type { FrameStats, TagStats } from '@/world/perf/Profiler'
import { WaterLab, type WaterLabPreset } from '@/world/water/WaterLab'

const host = useTemplateRef<HTMLDivElement>('host')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')

// See the comment above — shallowRef + markRaw, never a plain ref.
const lab = shallowRef<WaterLab | null>(null)
const presets = shallowRef<readonly WaterLabPreset[]>([])
const tags = shallowRef<TagStats[]>([])
const active = ref('overview')
const caption = ref('Loading the island…')

const stats = ref<FrameStats>({
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
  jankFrames: 0,
  profilerMs: 0,
  renderMs: 0,
  longestStallMs: 0,
  uncappedFps: 0,
  uncappedBy: 'none'
})

const insetStyle = {
  paddingTop: 'env(safe-area-inset-top, 0px)',
  paddingLeft: 'env(safe-area-inset-left, 0px)'
}

let observer: ResizeObserver | null = null
let timer: number | null = null

const jump = (id: string): void => {
  const instance = lab.value
  if (!instance) {
    return
  }
  instance.focusPreset(id)
  active.value = id
  caption.value = instance.presets.find(preset => preset.id === id)?.caption ?? ''
}

onMounted(() => {
  const canvasElement = canvas.value
  const hostElement = host.value
  if (!canvasElement || !hostElement) {
    return
  }

  const instance = markRaw(new WaterLab(canvasElement))
  instance.attach(canvasElement)
  lab.value = instance
  presets.value = instance.presets
  caption.value = instance.presets[0]?.caption ?? ''

  if (import.meta.env.DEV) {
    // Dev-only handle so a CDP session can read the profiler's numbers and drive
    // the presets without a UI round-trip, exactly as `WorldScene` exposes the
    // world. Stripped from every production build by the `DEV` gate.
    ;(window as unknown as { __waterLab?: WaterLab }).__waterLab = instance
  }

  observer = new ResizeObserver(entries => {
    const entry = entries[0]
    if (!entry) {
      return
    }
    const { width, height } = entry.contentRect
    instance.setSize(width, height)
  })
  observer.observe(hostElement)
  instance.setSize(hostElement.clientWidth, hostElement.clientHeight)
  instance.start()

  // 8 Hz, off the render loop: driving Vue from inside the frame would put a
  // patch pass on the hot path, and a counter that updates 60 times a second is
  // unreadable anyway.
  timer = window.setInterval(() => {
    stats.value = { ...instance.profiler.frame }
    tags.value = instance.profiler.rankedTags().map(entry => ({ ...entry }))
  }, 125)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  if (timer !== null) {
    window.clearInterval(timer)
  }
  lab.value?.dispose()
  lab.value = null
})

const formatCount = (value: number): string =>
  value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}k` : `${value}`

const fpsClass = computed(() => {
  const value = stats.value.fps
  if (value >= 55) {
    return 'text-emerald-400'
  }
  if (value >= 40) {
    return 'text-amber-400'
  }
  return 'text-rose-500'
})
</script>

<style scoped lang="sass">
.tabular-nums
  font-variant-numeric: tabular-nums
</style>
