<template lang="pug">
  div(ref="host" class="relative h-full w-full overflow-hidden bg-slate-900 select-none")
    canvas(
      ref="canvas"
      class="block h-full w-full touch-none outline-none"
    )

    WorldPerfPanel(:world="world")

    //- Controls hint. Fades out once the player has moved — a permanent overlay
    //- on a world you're meant to look at is the wrong trade.
    transition(name="hint")
      div(
        v-if="showHint"
        class="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4"
      )
        div(class="rounded-full bg-slate-950/60 px-4 py-1.5 text-center text-xs text-slate-300 backdrop-blur-sm")
          | {{ t('world.controlsHint') }}
</template>

<!--
  The Vue shell for the 3D world. Its entire job is to own a canvas element, a
  size, and a lifecycle — every frame of actual work happens inside `World`.

  The `World` instance is held in a `shallowRef` and wrapped in `markRaw`. This
  is not a micro-optimisation: a plain `ref` would hand the whole three.js scene
  graph to Vue's reactive proxy, and every `mesh.visible = false` the LOD system
  performs 60 times a second would trigger dependency tracking on a few thousand
  objects. It is the single easiest way to destroy this project's performance,
  and it fails silently — the scene renders correctly, just at 12 fps.
-->

<script setup lang="ts">
import { markRaw, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import WorldPerfPanel from '@/components/organisms/WorldPerfPanel.vue'
import { World } from '@/world/core/World'

const { t } = useI18n()

const host = useTemplateRef<HTMLDivElement>('host')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')

// See the comment above — shallowRef + markRaw, never a plain ref.
const world = shallowRef<World | null>(null)
const showHint = ref(true)

let observer: ResizeObserver | null = null
let hintTimer: number | null = null

onMounted(() => {
  const canvasElement = canvas.value
  const hostElement = host.value
  if (!canvasElement || !hostElement) {
    return
  }

  const instance = markRaw(new World(canvasElement))
  instance.attach(canvasElement)
  world.value = instance

  if (import.meta.env.DEV) {
    // Dev-only handle so a headless CDP session (and the console) can read
    // profiler numbers and poke settings without a UI round-trip. Stripped
    // from every production build by the `import.meta.env.DEV` gate.
    ;(window as unknown as { __world?: World }).__world = instance
  }

  // ResizeObserver rather than a window resize listener: the canvas is laid out
  // by CSS inside whatever shell the game uses, so it can change size without
  // the window doing so (orientation UI, safe-area changes, a parent panel).
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

  hintTimer = window.setTimeout(() => {
    showHint.value = false
  }, 7000)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  if (hintTimer !== null) {
    window.clearTimeout(hintTimer)
  }
  world.value?.dispose()
  world.value = null
})
</script>

<style scoped lang="sass">
.hint-enter-active,
.hint-leave-active
  transition: opacity 600ms ease

.hint-enter-from,
.hint-leave-to
  opacity: 0
</style>
