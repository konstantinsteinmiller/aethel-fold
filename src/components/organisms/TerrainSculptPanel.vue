<template lang="pug">
  .ts-panel.pointer-events-auto(v-if="editorMode && sculptReady" :class="{ 'is-min': minimised }")
    //- Header bar. This row is the whole panel when minimised, so it carries
    //- the armed tool and the delta size — the two things you check at a glance.
    .ts-head
      span.ts-title ⛰ Terrain Sculpt
      span.ts-head-sum(v-if="minimised") {{ minimisedSummary }}
      span.ts-badge(:class="{ armed: sculptTool !== 'off' }") {{ toolLabel }}
      button.ts-min(
        type="button"
        :title="minimised ? 'Restore the terrain sculptor' : 'Minimise to the header bar'"
        :aria-label="minimised ? 'Restore the terrain sculptor' : 'Minimise the terrain sculptor'"
        @click="toggleMinimised"
        @pointerdown.stop
      ) {{ minimised ? '+' : '−' }}

    template(v-if="!minimised")
      .ts-tools
        button.ts-tool(
          v-for="entry in TOOLS"
          :key="entry.tool"
          :class="{ sel: sculptTool === entry.tool }"
          :title="entry.title"
          @click="selectSculptTool(entry.tool)"
          @pointerdown.stop
        )
          span.ts-tool-key {{ entry.key }}
          span.ts-tool-name {{ entry.label }}
      button.ts-off(
        :class="{ sel: sculptTool === 'off' }"
        title="0 — disarm, so left-drag orbits the camera again"
        @click="selectSculptTool('off')"
        @pointerdown.stop
      ) {{ sculptTool === 'off' ? 'disarmed — left-drag orbits' : '0 · disarm (release the mouse)' }}

      .ts-slider
        span.ts-slider-label Radius
        input.ts-slider-input(
          type="range"
          :min="SCULPT_RADIUS_RANGE[0]"
          :max="SCULPT_RADIUS_RANGE[1]"
          step="0.5"
          :value="sculptRadius"
          @input="onRadius"
          @pointerdown.stop
          @keydown.stop
          @wheel.stop
        )
        span.ts-slider-value {{ sculptRadius.toFixed(1) }} m
      .ts-slider
        span.ts-slider-label Strength
        input.ts-slider-input(
          type="range"
          :min="SCULPT_STRENGTH_RANGE[0]"
          :max="SCULPT_STRENGTH_RANGE[1]"
          step="0.05"
          :value="sculptStrength"
          @input="onStrength"
          @pointerdown.stop
          @keydown.stop
          @wheel.stop
        )
        span.ts-slider-value {{ strengthLabel }}

      .ts-falloffs
        button.ts-falloff(
          v-for="curve in SCULPT_FALLOFF_IDS"
          :key="curve"
          :class="{ sel: sculptFalloffCurve === curve }"
          :title="FALLOFF_TITLES[curve]"
          @click="selectSculptFalloff(curve)"
          @pointerdown.stop
        ) {{ curve }}

      .ts-row(v-if="sculptTool === 'flatten'")
        span Flatten to
        b {{ sculptFlattenTarget.toFixed(2) }} m
        button.ts-act.slim(
          title="H — take the height under the crosshair"
          @click="runSample"
          @pointerdown.stop
        ) pick
      .ts-row
        span Delta
        b {{ sculptTiles }} tile{{ sculptTiles === 1 ? '' : 's' }} · {{ kilobytes }}

      //- Above the legend on purpose: on a short viewport the panel scrolls, and
      //- the two buttons you reach for mid-session must not be the part below
      //- the fold.
      .ts-actions
        button.ts-act(
          :disabled="sculptUndoDepth === 0"
          title="Z — revert the last stroke exactly"
          @click="runUndo"
          @pointerdown.stop
        ) ↶ undo ({{ sculptUndoDepth }})
        button.ts-act.alt(
          title="Drop every height offset in this browser. Undoable as one step."
          @click="runClear"
          @pointerdown.stop
        ) clear all
      .ts-msg(v-if="sculptStatus") {{ sculptStatus }}

      .ts-hint
        | #[b 1] raise · #[b 2] lower · #[b 3] smooth · #[b 4] flatten · #[b 5] roughen
        br
        | #[b 0] disarm · drag #[b LMB] to paint while armed
        br
        //- Square brackets are written as plain text: pug's `#[tag …]`
        //- interpolation ends at the first `]`, so `#[b ]]` cannot be spelled.
        | [ and ] radius ∓25 % · #[b −] / #[b =] strength ∓30 %
        br
        | #[b V] falloff curve · #[b H] set flatten height · #[b Z] undo stroke
        br
        | No wheel binding: the prop editor claims the wheel in capture phase.
        br
        | Strength is m/s for raise/lower/roughen, a convergence rate for the rest.
      .ts-foot Ground colour follows height and slope — re-shaping re-tints.
</template>

<!--
  In-world terrain sculpting. A sibling of `LevelEditorPanel.vue` and
  `WaterEditorPanel.vue`, not a section of either: it edits the heightfield
  rather than a placement list, it stores under its own key
  (`world_sculpt_delta`), and all three are usable in the same session.

  ── Placement ──────────────────────────────────────────────────────────────

  Anchored **bottom-right**, clearing the camera-mode button that already sits
  there. The prop palette owns the top-left and the water editor owns the
  top-right, so this is the one free right-hand anchor. Capped at 46vh so a
  top-right water panel at its own 82vh and this one can both be open on a
  1080p viewport; on a much shorter one they can still meet, which is what the
  minimise button is for.

  Deliberately NOT internationalised: a dev tool behind a code word, which the
  project i18n rule exempts. Translating "strength is m/s for raise/lower" into
  21 languages would add keys no player can ever reach.

  Every value this component holds is a string, a number or a boolean. The
  delta itself — a map of `Float32Array` tiles the player's collision reads
  every frame — never leaves `sculptFacade.ts` (GDD §0).
-->

<script setup lang="ts">
import { computed, ref } from 'vue'
import { editorMode } from '@/world/editor/toggle'
import {
  clearSculpt,
  sampleSculptTarget,
  SCULPT_FALLOFF_IDS,
  SCULPT_RADIUS_RANGE,
  SCULPT_STRENGTH_RANGE,
  sculptBytes,
  sculptFalloffCurve,
  sculptFlattenTarget,
  sculptRadius,
  sculptReady,
  sculptStatus,
  sculptStrength,
  sculptTiles,
  sculptTool,
  sculptUndoDepth,
  selectSculptFalloff,
  selectSculptTool,
  setSculptRadius,
  setSculptStrength,
  undoSculpt,
  type SculptFalloff,
  type SculptTool
} from '@/world/editor/sculptFacade'

const TOOLS: { tool: SculptTool; key: string; label: string; title: string }[] = [
  { tool: 'raise', key: '1', label: 'raise', title: '1 — push the surface up' },
  { tool: 'lower', key: '2', label: 'lower', title: '2 — pull the surface down' },
  { tool: 'smooth', key: '3', label: 'smooth', title: '3 — average the surface toward its neighbourhood' },
  { tool: 'flatten', key: '4', label: 'flatten', title: '4 — converge on the height you first clicked' },
  { tool: 'noise', key: '5', label: 'roughen', title: '5 — add ~3 m coherent bumps' }
]

const FALLOFF_TITLES: Record<SculptFalloff, string> = {
  smooth: 'Smoothstep — the default dome',
  linear: 'Linear — a cone',
  sharp: 'Cubic — a narrow spike, for detail',
  plateau: 'Flat to 70 %, then a shoulder — for terraces'
}

/**
 * Minimised state, persisted in its own tiny key — the same idiom the prop
 * palette uses. It is a view preference, not sculpt data, so it deliberately
 * does not ride in `world_sculpt_delta`: clearing the terrain must not also
 * reopen a panel you folded away.
 */
const MINIMISED_KEY = 'world_sculpt_panel_minimised'

const readMinimised = (): boolean => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(MINIMISED_KEY) === 'true'
  } catch {
    return false
  }
}

const minimised = ref(readMinimised())

const toggleMinimised = (): void => {
  minimised.value = !minimised.value
  try {
    localStorage.setItem(MINIMISED_KEY, minimised.value ? 'true' : 'false')
  } catch {
    // Private mode. The fold still works, it just won't survive a reload.
  }
}

const toolLabel = computed(() =>
  sculptTool.value === 'off' ? 'off' : (TOOLS.find(entry => entry.tool === sculptTool.value)?.label ?? '—')
)

// Two different quantities behind one slider — see the legend. Labelling them
// identically would make a "2.5" mean 2.5 m/s in one tool and a 0.4 s time
// constant in another with nothing on screen to say so.
const strengthLabel = computed(() =>
  sculptTool.value === 'smooth' || sculptTool.value === 'flatten'
    ? `${sculptStrength.value.toFixed(2)} /s`
    : `${sculptStrength.value.toFixed(2)} m/s`
)

const kilobytes = computed(() => `${Math.round(sculptBytes.value / 1024)} KB`)

// The whole panel when minimised, so it spells the empty case out rather than
// showing "0 tiles" and leaving you to wonder whether the tool is broken.
const minimisedSummary = computed(() =>
  sculptTiles.value === 0 ? 'unsculpted' : `${sculptTiles.value} tile${sculptTiles.value === 1 ? '' : 's'}`
)

const onRadius = (event: Event): void => {
  const input = event.target as HTMLInputElement | null
  if (input) {
    setSculptRadius(Number.parseFloat(input.value))
  }
}

const onStrength = (event: Event): void => {
  const input = event.target as HTMLInputElement | null
  if (input) {
    setSculptStrength(Number.parseFloat(input.value))
  }
}

let messageTimer: ReturnType<typeof setTimeout> | null = null
const flashStatus = (): void => {
  if (messageTimer) {
    clearTimeout(messageTimer)
  }
  messageTimer = setTimeout(() => {
    sculptStatus.value = ''
  }, 6000)
}

const runUndo = (): void => {
  undoSculpt()
  flashStatus()
}

const runClear = (): void => {
  clearSculpt()
  flashStatus()
}

const runSample = (): void => {
  sampleSculptTarget()
  flashStatus()
}
</script>

<style scoped lang="sass">
.ts-panel
  position: absolute
  // Clears the camera-mode button (`right-3 bottom-3`, ~2.1rem tall).
  bottom: calc(3.4rem + env(safe-area-inset-bottom, 0px))
  right: calc(0.75rem + env(safe-area-inset-right, 0px))
  width: 15.5rem
  max-height: 46vh
  overflow-y: auto
  display: flex
  flex-direction: column
  background: rgba(14, 16, 22, 0.92)
  border: 1px solid #3a4257
  border-radius: 6px
  padding: 0.5rem
  color: #e8ecf2
  z-index: 50
  // Minimised it must give the canvas back, not just shrink vertically — a
  // full-width collapsed bar still covers the ground you are aiming at.
  &.is-min
    width: auto
    min-width: 12rem
    overflow: visible
    padding: 0.35rem 0.5rem
.ts-head
  display: flex
  align-items: center
  gap: 0.4rem
.ts-panel:not(.is-min) .ts-head
  margin-bottom: 0.35rem
.ts-title
  font-weight: 700
  font-size: 0.82rem
  flex: 1 1 auto
  white-space: nowrap
.ts-head-sum
  flex: 0 0 auto
  font-size: 0.62rem
  color: #8fa0c0
  white-space: nowrap
  font-variant-numeric: tabular-nums
.ts-badge
  flex: 0 0 auto
  font-size: 0.6rem
  letter-spacing: 0.02em
  text-transform: uppercase
  color: #8fa0c0
  border: 1px solid #333c50
  border-radius: 3px
  padding: 0.05rem 0.28rem
  &.armed
    color: #cdf0ff
    border-color: #4aa8d4
    background: #234a5c
.ts-min
  flex: 0 0 auto
  width: 1.15rem
  height: 1.15rem
  line-height: 1
  background: #2a3040
  border: 1px solid #445068
  border-radius: 3px
  color: #a9b8d4
  font-family: inherit
  font-size: 0.62rem
  cursor: pointer
  &:hover
    background: #343c50
.ts-tools
  display: flex
  gap: 0.2rem
  margin-bottom: 0.25rem
.ts-tool
  flex: 1 1 auto
  min-width: 0
  display: flex
  flex-direction: column
  align-items: center
  gap: 1px
  background: #191d28
  border: 1px solid #333c50
  border-radius: 3px
  color: #d6dcea
  font-family: inherit
  padding: 0.2rem 0.1rem
  cursor: pointer
  &:hover
    background: #232838
  &.sel
    background: #234a5c
    border-color: #4aa8d4
    color: #cdf0ff
.ts-tool-key
  font-size: 0.56rem
  font-weight: 700
  color: #8fa0c0
.ts-tool-name
  font-size: 0.58rem
  overflow: hidden
  text-overflow: ellipsis
.ts-off
  background: #2a3040
  border: 1px solid #445068
  border-radius: 3px
  color: #a9b8d4
  font-family: inherit
  font-size: 0.6rem
  padding: 0.2rem 0.3rem
  margin-bottom: 0.35rem
  cursor: pointer
  &:hover
    background: #343c50
  &.sel
    color: #cfe0ff
    border-color: #5a688a
.ts-slider
  display: flex
  align-items: center
  gap: 0.3rem
  font-size: 0.62rem
  color: #8fa0c0
  margin-bottom: 2px
.ts-slider-label
  flex: 0 0 3.2rem
.ts-slider-input
  flex: 1 1 auto
  min-width: 0
  height: 0.9rem
  accent-color: #4aa8d4
.ts-slider-value
  flex: 0 0 3.1rem
  text-align: right
  color: #cfe0ff
  font-variant-numeric: tabular-nums
.ts-falloffs
  display: flex
  gap: 0.2rem
  margin: 0.3rem 0
.ts-falloff
  flex: 1 1 auto
  min-width: 0
  background: #191d28
  border: 1px solid #333c50
  border-radius: 3px
  color: #d6dcea
  font-family: inherit
  font-size: 0.56rem
  padding: 0.18rem 0.1rem
  cursor: pointer
  &:hover
    background: #232838
  &.sel
    background: #234a5c
    border-color: #4aa8d4
    color: #cdf0ff
.ts-row
  display: flex
  justify-content: space-between
  align-items: baseline
  gap: 0.4rem
  font-size: 0.68rem
  color: #cfe0ff
  margin-bottom: 0.15rem
  font-variant-numeric: tabular-nums
.ts-hint
  font-size: 0.6rem
  line-height: 1.45
  color: #8fa0c0
  margin: 0.3rem 0 0.4rem
.ts-actions
  display: flex
  gap: 0.25rem
.ts-act
  flex: 1 1 auto
  background: #223a2c
  border: 1px solid #3d6b4b
  border-radius: 3px
  color: #bfe8cd
  font-family: inherit
  font-size: 0.64rem
  font-weight: 700
  padding: 0.24rem 0.4rem
  cursor: pointer
  &:hover
    background: #2c4c39
  &:disabled
    opacity: 0.4
    cursor: default
  &.slim
    flex: 0 0 auto
    font-weight: 400
    font-size: 0.58rem
    padding: 0.1rem 0.35rem
  &.alt
    flex: 0 0 auto
    background: #2a3040
    border-color: #6b4444
    color: #e0a9a9
    font-weight: 400
    &:hover
      background: #343c50
.ts-msg
  font-size: 0.6rem
  color: #9fe0b4
  margin-top: 0.3rem
  word-break: break-word
.ts-foot
  margin-top: 0.35rem
  font-size: 0.58rem
  color: #6f7d99
</style>
