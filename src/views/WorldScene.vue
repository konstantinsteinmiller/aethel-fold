<template lang="pug">
  div(ref="host" class="relative h-full w-full overflow-hidden bg-slate-900 select-none")
    canvas(
      ref="canvas"
      class="block h-full w-full touch-none outline-none"
    )

    WorldPerfPanel(:world="world")

    //- The "[E] Sit" prompt over a bench, a stool or a chair the player is
    //- looking at. Same component and same seat layer the chapter uses; `World`
    //- owns the scan and this polls it. See `world/interaction/`.
    SeatBillboard(:target="seatLabel" :screen="seatPoint")

    //- ── And the way back up, which cannot be a billboard here ────────────
    //-
    //- The chapter draws "press E or Esc to stand" over the seat, because its
    //- camera is behind the player and the seat is in front of it. This route is
    //- **first person**, so sitting down puts the seat's anchor 1.03 m directly
    //- below the camera -- under the player's own chin -- where it projects
    //- off-screen (measured; the projection actually comes back NaN, the
    //- degenerate case of a point on the lens). A world-space label is simply
    //- the wrong tool once the thing being labelled is the thing you are sitting
    //- on.
    //-
    //- So the seated hint is chrome: fixed, bottom centre, in the same place the
    //- controls hint above already puts a line of text the player needs and does
    //- not need to aim at.
    transition(name="hint")
      div(
        v-if="seatedHint"
        class="pointer-events-none absolute inset-x-0 bottom-16 z-20 flex justify-center px-4"
      )
        div(class="seat-hint rounded-full bg-slate-950/65 px-3 py-1.5 text-xs font-medium text-white ring-1 ring-amber-200/45 backdrop-blur-[2px]")
          | {{ t('story.seated', { key: interactKeyLabel }) }}

    //- Self-gating on the editor mode, so this renders nothing until "cmonc"
    //- is typed and costs nothing while it's off.
    LevelEditorPanel

    //- What the crosshair is on, floating over it. Same self-gate; its rAF
    //- starts and stops with the mode, so it is free while the editor is off.
    EditorFocusCard

    //- Water: ponds, seas and spline rivers, top-right. Same code word and the
    //- same self-gate as the others, and it positions itself — the three panels
    //- claim different corners (props top-left, water top-right, sculpt
    //- bottom-right) rather than being laid out from here.
    WaterEditorPanel

    //- Terrain sculpting, bottom-right. Same code word, same self-gate; the
    //- prop palette holds the top-left and the water editor the top-right.
    TerrainSculptPanel

    //- Player-facing graphics settings, bottom-left. Unlike the perf panel this
    //- ships — it is where the grass detail level lives.
    WorldSettingsPanel(:world="world")

    //- Camera mode switch. Deliberately a plain button rather than a hotkey:
    //- every letter key is either camera movement or an editor binding, and
    //- pointer lock needs a real user gesture to be granted anyway.
    button(
      type="button"
      class="absolute right-3 bottom-3 z-40 rounded-full bg-slate-950/65 px-4 py-2 text-xs text-slate-200 backdrop-blur-sm"
      @click="toggleCameraMode"
    ) {{ firstPerson ? t('world.modeOrbit') : t('world.modeFirstPerson') }}

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
import { computed, markRaw, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import EditorFocusCard from '@/components/organisms/EditorFocusCard.vue'
import LevelEditorPanel from '@/components/organisms/LevelEditorPanel.vue'
import SeatBillboard from '@/components/organisms/SeatBillboard.vue'
import TerrainSculptPanel from '@/components/organisms/TerrainSculptPanel.vue'
import WaterEditorPanel from '@/components/organisms/WaterEditorPanel.vue'
import WorldPerfPanel from '@/components/organisms/WorldPerfPanel.vue'
import WorldSettingsPanel from '@/components/organisms/WorldSettingsPanel.vue'
import { World } from '@/world/core/World'
import { bindingFor, keyLabel } from '@/use/useKeybindings'
import { makeScreenPoint, projectToScreen, type ScreenPoint } from '@/world/core/project'

const { t } = useI18n()

const host = useTemplateRef<HTMLDivElement>('host')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')

// See the comment above — shallowRef + markRaw, never a plain ref.
const world = shallowRef<World | null>(null)
const showHint = ref(true)
const firstPerson = ref(false)

const toggleCameraMode = (): void => {
  const instance = world.value
  if (!instance) {
    return
  }
  firstPerson.value = !firstPerson.value
  instance.setCameraMode(firstPerson.value ? 'firstPerson' : 'orbit')
}

let observer: ResizeObserver | null = null
let hintTimer: number | null = null

/**
 * The seat prompt's projection, as a mutated struct behind a tick.
 *
 * The same trade `StoryScene` makes and for the same reason: a new object a
 * frame for one indicator is 60 allocations a second for a label that changes
 * what it says twice a minute. The `World` is never handed to Vue (see the
 * header) -- this polls `world.seatPrompt` and copies three numbers out.
 */
const seatRaw = makeScreenPoint()
const screenTick = ref(0)
const hasSeat = ref(false)
const seated = ref(false)
let seatRaf = 0

const seatPoint = computed<ScreenPoint | null>(() => {
  screenTick.value
  return hasSeat.value ? { ...seatRaw } : null
})
/**
 * The billboard only ever draws the **standing** prompt now.
 *
 * `seated` is deliberately not routed through it: see the template's note on
 * why a first-person seated hint cannot be a world-space label.
 */
const seatLabel = computed(() => (hasSeat.value && !seated.value ? { seated: false } : null))
/** The fixed "press E or Esc to stand" line. True whenever the player is on a seat. */
const seatedHint = computed(() => seated.value)
/** Read live, so a rebind is reflected in the hint. Matches `NpcBillboard`. */
const interactKeyLabel = computed(() => {
  const label = keyLabel(bindingFor('interact'))
  return label.text ?? (label.i18n ? t(label.i18n) : bindingFor('interact'))
})

/**
 * Its own rAF rather than `World.onUpdate`.
 *
 * `onUpdate` is called only in story mode -- its comment says so, and the story
 * depends on where in the frame it lands. `EditorFocusCard` already sets the
 * precedent for a self-gating poll in this shell, and this is the same shape:
 * it bumps the tick only when there is something on screen, so a session with
 * no bench in sight costs Vue nothing.
 */
const pumpSeat = (): void => {
  const instance = world.value
  if (instance) {
    const prompt = instance.seatPrompt
    if (prompt) {
      projectToScreen(instance.camera, prompt.at.x, prompt.at.y, prompt.at.z, seatRaw)
      // `onScreen` gates the *billboard* only. The seated hint is fixed chrome
      // and must not inherit that gate -- while seated the anchor is on the lens
      // and never passes it, which is exactly the case the hint exists for.
      hasSeat.value = seatRaw.onScreen
      seated.value = prompt.seated
      screenTick.value++
    } else if (hasSeat.value || seated.value) {
      hasSeat.value = false
      seated.value = false
    }
  }
  seatRaf = requestAnimationFrame(pumpSeat)
}

/**
 * The two keys the sandbox shell owns for sitting.
 *
 * `interact` is latched into the world and consumed on its next frame -- the
 * same shape `StoryPlayer.takeInteract` has, so a held key cannot request a seat
 * sixty times a second. Escape only ever stands the player up; `/` has no pause
 * menu for it to argue with.
 */
const onSeatKey = (event: KeyboardEvent): void => {
  if (event.repeat) {
    return
  }
  const instance = world.value
  if (!instance) {
    return
  }
  if (event.code === bindingFor('interact')) {
    instance.requestSit()
  } else if (event.code === 'Escape') {
    instance.standUp()
  }
}

onMounted(() => {
  const canvasElement = canvas.value
  const hostElement = host.value
  if (!canvasElement || !hostElement) {
    return
  }

  // `?density=3` multiplies scatter density for benchmarking. Dev only — at
  // shipping density the frame is vsync-bound, so culling work is unmeasurable
  // without a way to load the scene up.
  const params = new URLSearchParams(location.search)
  /**
   * A dev-only numeric override, or `NaN` when it was not given.
   *
   * ── `Number(null)` is 0, and that switched the crowd off in dev ────────────
   *
   * This read `Number(params.get(name))`, and `URLSearchParams.get` returns
   * `null` for a missing key, so **an absent override arrived as `0`** rather
   * than as `NaN`. Four of the five callers below guard with `> 0` and were
   * accidentally safe. `crowd` guards with `>= 0` — deliberately, because
   * `?crowd=0` is the A/B arm that turns the crowd off — so every dev session
   * without `?crowd=N` in the URL got `crowdBudget: 0`, `Crowd.budget` of zero,
   * and `search()` picking `Math.min(0, count)` spawns. No error, no warning:
   * the level's NPCs simply never stood up, and the perf panel's NPC row read a
   * perfectly plausible 0.
   *
   * Production was never affected — the `DEV` gate already returned `NaN` there,
   * which is why the shipped world has always had its crowd. Returning `NaN` for
   * "absent" in *both* branches is what every caller already assumes, and it
   * keeps `?crowd=0` meaning what it is for.
   */
  const devNumber = (name: string): number => {
    if (!import.meta.env.DEV) {
      return Number.NaN
    }
    const raw = params.get(name)
    return raw === null || raw.trim() === '' ? Number.NaN : Number(raw)
  }
  const density = devNumber('density')
  // `?cascades=2&shadowfar=180` — the shadow pass is the single most expensive
  // thing in a constrained frame, and its cascade count is a shader define, so
  // it can only be compared across page loads of one build.
  const cascades = devNumber('cascades')
  const shadowFar = devNumber('shadowfar')
  // `?loadradius=130` — detailed terrain reach. Chunk count goes as its square,
  // so this is the largest single lever on draw-call count.
  const loadRadius = devNumber('loadradius')
  // `?gearinst=0` — draw the crowd's hats and weapons per character instead of
  // batching them. The A/B arm for the `GearInstancer` claim.
  const gearInstancing = devNumber('gearinst')
  // `?crowd=12` — how many NPC figures may stand at once. The lever the crowd's
  // draw budget is actually set by; see `DEFAULT_CROWD_BUDGET`.
  const crowd = devNumber('crowd')
  const instance = markRaw(
    new World(canvasElement, {
      ...(Number.isFinite(density) && density > 0 ? { densityScale: density } : {}),
      ...(Number.isFinite(cascades) && cascades > 0 ? { shadowCascades: cascades } : {}),
      ...(Number.isFinite(shadowFar) && shadowFar > 0 ? { shadowMaxFar: shadowFar } : {}),
      ...(Number.isFinite(loadRadius) && loadRadius > 0 ? { loadRadius } : {}),
      ...(Number.isFinite(gearInstancing) ? { instanceGear: gearInstancing !== 0 } : {}),
      ...(Number.isFinite(crowd) && crowd >= 0 ? { crowdBudget: crowd } : {})
    })
  )
  instance.attach(canvasElement)
  world.value = instance
  window.addEventListener('keydown', onSeatKey)
  seatRaf = requestAnimationFrame(pumpSeat)

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

  // ── Shader warmup ─────────────────────────────────────────────────────────
  //
  // Links every program into a 1×1 buffer before the loop presents anything, so
  // the driver's compile lands behind the splash rather than on the player's
  // first interactive frame. Measured, interleaved A/B within one build:
  //
  //   worst opening frame   984–1612 ms  →  5–10 ms
  //   added time to appear   none        →  0.9–2.0 s (splash still up)
  //
  // It relocates the cost rather than removing it — a driver's shader compile
  // cannot be sliced across frames the way asset generation could. `?warmup=0`
  // turns it off so the two paths stay comparable inside one build.
  //
  // Deliberately not awaited: `onMounted` must not become async, or the unmount
  // guard below stops being registered synchronously and a fast navigate-away
  // leaks the world. If the component unmounted while we waited, `dispose()`
  // has already run and there is nothing left to start.
  const warmupOff = import.meta.env.DEV && new URLSearchParams(location.search).get('warmup') === '0'
  if (warmupOff) {
    instance.start()
  } else {
    void instance.warmUp().then(() => {
      if (world.value === instance) {
        instance.start()
      }
    })
  }

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
  window.removeEventListener('keydown', onSeatKey)
  cancelAnimationFrame(seatRaf)
  world.value?.dispose()
  world.value = null
})
</script>

<style scoped lang="sass">
// Same reasoning as `NpcBillboard`: this is drawn over a sunlit meadow, and a
// text shadow is what keeps the glyph edges readable where the panel's own alpha
// lets a bright background through.
.seat-hint
  text-shadow: 0 1px 2px rgba(2, 6, 23, 0.9), 0 0 6px rgba(2, 6, 23, 0.55)

.hint-enter-active,
.hint-leave-active
  transition: opacity 600ms ease

.hint-enter-from,
.hint-leave-to
  opacity: 0
</style>
