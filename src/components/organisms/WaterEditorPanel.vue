<template lang="pug">
  .wed-panel.pointer-events-auto(v-if="editorMode && waterEditorReady" :class="{ 'is-min': minimised }")
    //- Header bar. Same idiom as `LevelEditorPanel.vue`: minimised this row is
    //- the whole panel, so it keeps the two facts that matter — which mode the
    //- Alt bindings are currently in, and how many bodies exist.
    .wed-head
      span.wed-title ≈ Water Editor
      span.wed-head-sum(v-if="minimised") {{ waterMode }} · {{ bodyLabel }}
      span.wed-count(v-else) {{ waterBodyCount }}
      button.wed-min(
        type="button"
        :title="minimised ? 'Restore the water editor' : 'Minimise to the header bar'"
        :aria-label="minimised ? 'Restore the water editor' : 'Minimise the water editor'"
        @click="toggleMinimised"
        @pointerdown.stop
      ) {{ minimised ? '+' : '−' }}
    template(v-if="!minimised")
      .wed-modes
        button.wed-mode(
          v-for="entry in MODES"
          :key="entry.mode"
          :class="{ sel: waterMode === entry.mode }"
          :title="entry.title"
          @click="setWaterMode(entry.mode)"
          @pointerdown.stop
        ) {{ entry.label }}
      .wed-styles
        button.wed-style(
          v-for="option in styles"
          :key="option.id"
          :class="{ sel: option.id === waterStyleId }"
          @click="selectWaterStyle(option.id)"
          @pointerdown.stop
        ) {{ option.label }}
      .wed-row
        span Surface
        b {{ surfaceLabel }}
      template(v-if="waterMode === 'river'")
        .wed-row
          span Nodes
          b {{ nodeLabel }}
        .wed-row
          span Half-width
          b {{ metres(waterNodeHalfWidth) }}
        .wed-actions
          button.wed-act(:disabled="!waterBuilding" @click="undoWaterNode" @pointerdown.stop) undo node
          button.wed-act(:disabled="!waterBuilding" @click="finishWaterRun" @pointerdown.stop) finish
          button.wed-act(:disabled="waterRiverNodes < 3" @click="closeWaterRun" @pointerdown.stop) close loop
      template(v-else)
        .wed-row
          span Extent
          b {{ metres(waterHalfX) }} × {{ metres(waterHalfZ) }}
        .wed-row
          span Rotation
          b {{ waterRotationDeg }}°
      .wed-aim(v-if="waterAimedId")
        span Aimed: #[b {{ waterAimedKind || 'water' }}]
        button.wed-act.alt(@click="deleteAimedWater" @pointerdown.stop) delete
      .wed-hint
        | #[b Alt]+#[b P] pool · #[b Alt]+#[b R] river · #[b Alt]+#[b O] off
        br
        | #[b Alt]+Click / #[b Alt]+#[b G] {{ waterMode === 'river' ? 'add node' : 'place pool' }}
        br
        | #[b Alt]+drag scale X and Z · #[b Alt]+#[b Shift]+Click / #[b Alt]+#[b X] delete
        br
        | #[b Alt]+#[b J]/#[b L] {{ waterMode === 'river' ? 'node half-width' : 'half-X' }} ∓ · #[b Alt]+#[b K]/#[b I] half-Z ∓
        br
        | #[b Alt]+[ / #[b Alt]+] rotate ∓15° · #[b Alt]+#[b −]/#[b =] height ∓10 cm
        br
        | #[b Alt]+#[b Backspace] undo node · #[b Alt]+#[b Enter] finish (#[b Shift] closes)
        br
        | #[b Alt]+#[b ,]/#[b .] step node · #[b Alt]+#[b Y] cycle style
        br
        | Hold #[b Shift] on the size and height keys for a coarse step.
      button.wed-tune-toggle(@click="tuning = !tuning" @pointerdown.stop)
        span {{ tuning ? '▾' : '▸' }} tune {{ waterStyleId }}
      .wed-tune(v-if="tuning")
        .wed-slider(v-for="slider in WATER_STYLE_SLIDERS" :key="slider.key")
          span.wed-slider-label {{ slider.label }}
          input.wed-slider-input(
            type="range"
            :min="slider.min"
            :max="slider.max"
            :step="slider.step"
            :value="waterStyleValues[slider.key]"
            @input="onParam(slider.key, $event)"
            @pointerdown.stop
            @keydown.stop
            @wheel.stop
          )
          span.wed-slider-value {{ number(waterStyleValues[slider.key]) }}
      .wed-export
        button.wed-export-btn(
          title="Copy the whole water layout as a JSON WaterPlacement[] (also logged to the console)"
          @click="runExport"
          @pointerdown.stop
        ) ⤓ Export JSON
        button.wed-export-btn.alt(
          title="Delete every body of water in this browser"
          @click="runClear"
          @pointerdown.stop
        ) clear
      .wed-export-msg(v-if="waterStatus") {{ waterStatus }}
      .wed-foot {{ waterBodyCount }} placed · water keys are all #[b Alt]-modified
</template>

<!--
  In-world water editor. A sibling of `LevelEditorPanel.vue`, not a section of
  it: water is a different schema (`WaterPlacement`, with a non-uniform extent
  and a spline), a different storage key and a different set of bindings, and
  the two tools are usable at the same time.

  Every binding shown in the legend is `Alt`-modified, and that is load-bearing
  rather than tidy — the prop editor's `onKeyDown` bails on `event.altKey`,
  which is the only reason both can listen on `window` at once. The legend is
  the "quick lookup" the tool is meant to have: it is the same `.ed-hint` block
  idiom, kept next to the controls it describes.

  Deliberately NOT internationalised: a dev tool behind a code word, which the
  project i18n rule exempts. Translating "Alt+drag scale X and Z" into 21
  languages would add keys no player can ever reach.

  Every value this component holds is a string, a number or a boolean. The
  styles arrive as a flat `{ id, label }` projection — never a `WaterStyle`,
  which carries live `Color`s that Vue would proxy on contact (GDD §0).
-->

<script setup lang="ts">
import { computed, ref } from 'vue'
import { editorMode } from '@/world/editor/toggle'
import {
  clearWaterBodies,
  closeWaterRun,
  deleteAimedWater,
  exportWaterLayout,
  finishWaterRun,
  selectWaterStyle,
  setWaterMode,
  setWaterStyleParam,
  undoWaterNode,
  WATER_STYLE_SLIDERS,
  waterAimedId,
  waterAimedKind,
  waterBodyCount,
  waterBuilding,
  waterEditorReady,
  waterHalfX,
  waterHalfZ,
  waterMode,
  waterNodeHalfWidth,
  waterRiverNodes,
  waterRotationDeg,
  waterStatus,
  waterStyleId,
  waterStyleOptions,
  waterStyleValues,
  waterSurfaceRelative,
  waterSurfaceY,
  waterActiveNode,
  type WaterEditMode,
  type WaterStyleNumberKey
} from '@/world/water/editorFacade'

const MODES: { mode: WaterEditMode; label: string; title: string }[] = [
  { mode: 'pool', label: 'pool', title: 'Alt+P — place pools and seas' },
  { mode: 'river', label: 'river', title: 'Alt+R — lay a river along a spline' },
  { mode: 'off', label: 'off', title: 'Alt+O — stop editing water' }
]

// Snapshotted, not recomputed: `WATER_STYLES` is a build-time table, so a
// `computed` over it would re-project four rows on every unrelated render.
const styles = waterStyleOptions()

const tuning = ref(false)

/**
 * ─── Minimise ───────────────────────────────────────────────────────────────
 *
 * The same six lines as `LevelEditorPanel.vue`, under this panel's own key —
 * the two tools fold independently, because the common case is wanting one of
 * them out of the way, not both.
 *
 * Own localStorage key, never the save blob, per `src/world/editor/toggle.ts`,
 * and wrapped on both read and write so a browser with storage disabled loses
 * the persistence rather than throwing on mount.
 */
const MINIMISED_KEY = 'world_water_panel_minimised'

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
    // Private mode / storage disabled. The panel still folds, it just won't
    // remember across a reload — strictly better than throwing.
  }
}

const metres = (value: number): string => `${value.toFixed(1)} m`

const number = (value: number): string =>
  Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')

// Absolute height and offset-above-ground are different quantities and the
// readout has to say which, or "0.4" reads as sea level.
const surfaceLabel = computed(() =>
  waterSurfaceRelative.value
    ? `${waterSurfaceY.value >= 0 ? '+' : '−'}${Math.abs(waterSurfaceY.value).toFixed(2)} m over ground`
    : `y ${waterSurfaceY.value.toFixed(2)} m`
)

// Minimised summary. "1 body" rather than "1 bodies" — the bar is two words
// wide and a wrong plural is the only thing anyone would read in it.
const bodyLabel = computed(() =>
  waterBodyCount.value === 1 ? '1 body' : `${waterBodyCount.value} bodies`
)

const nodeLabel = computed(() => {
  if (waterRiverNodes.value === 0) {
    return 'none'
  }
  if (waterRiverNodes.value === 1) {
    // A one-node run is not a placement and is never saved — see `WaterEditor.draft`.
    return '1 (draft — needs 2)'
  }
  const active = waterActiveNode.value >= 0 ? ` · editing #${waterActiveNode.value + 1}` : ''
  return `${waterRiverNodes.value}${active}`
})

const onParam = (key: WaterStyleNumberKey, event: Event): void => {
  const input = event.target as HTMLInputElement | null
  if (!input) {
    return
  }
  setWaterStyleParam(key, Number.parseFloat(input.value))
}

let messageTimer: ReturnType<typeof setTimeout> | null = null
const flashStatus = (): void => {
  if (messageTimer) {
    clearTimeout(messageTimer)
  }
  messageTimer = setTimeout(() => {
    waterStatus.value = ''
  }, 6000)
}

const runExport = async (): Promise<void> => {
  await exportWaterLayout()
  flashStatus()
}

const runClear = (): void => {
  clearWaterBodies()
  flashStatus()
}
</script>

<style scoped lang="sass">
// ── Overlay layout ──────────────────────────────────────────────────────────
//
// Top of the right column. The left column is spoken for: `WorldPerfPanel` is
// `fixed top-0 left-0` (448 × 478 px expanded at a 1418 × 802 viewport) and
// `LevelEditorPanel` is bottom-left under it.
//
// `max-height` was 82vh, which left the right column with nothing under it.
// 52vh so a second right-hand tool — the terrain sculpt panel — can anchor
// bottom-right above the camera-mode button (`right-3 bottom-3`) with roughly
// 38vh of its own. Nothing else claims the right side.
.wed-panel
  position: absolute
  top: calc(0.75rem + env(safe-area-inset-top, 0px))
  right: calc(0.75rem + env(safe-area-inset-right, 0px))
  width: 16rem
  max-height: 52vh
  overflow-y: auto
  display: flex
  flex-direction: column
  background: rgba(14, 16, 22, 0.92)
  border: 1px solid #3a4257
  border-radius: 6px
  padding: 0.5rem
  color: #e8ecf2
  z-index: 50
  // Minimised: a bar that shrink-wraps its own text, so it covers no more of
  // the viewport than it draws.
  &.is-min
    width: auto
    min-width: 11rem
    max-width: 19rem
    max-height: none
    overflow: hidden
    padding: 0.3rem 0.45rem
    .wed-head
      margin-bottom: 0
.wed-head
  display: flex
  align-items: center
  gap: 0.4rem
  margin-bottom: 0.35rem
.wed-title
  flex: 0 0 auto
  font-weight: 700
  font-size: 0.82rem
.wed-count
  flex: 1 1 auto
  text-align: right
  font-size: 0.7rem
  color: #8fa0c0
.wed-head-sum
  flex: 1 1 auto
  min-width: 0
  overflow: hidden
  text-overflow: ellipsis
  white-space: nowrap
  text-align: right
  font-size: 0.64rem
  color: #9fb2d4
.wed-min
  flex: 0 0 auto
  display: flex
  align-items: center
  justify-content: center
  width: 1.15rem
  height: 1.15rem
  background: #2a3040
  border: 1px solid #445068
  border-radius: 3px
  color: #a9b8d4
  font-family: inherit
  font-size: 0.78rem
  line-height: 1
  cursor: pointer
  &:hover
    background: #343c50
    color: #e8ecf2
.wed-modes,
.wed-styles
  display: flex
  gap: 0.25rem
  margin-bottom: 0.35rem
.wed-mode,
.wed-style
  flex: 1 1 auto
  background: #191d28
  border: 1px solid #333c50
  border-radius: 3px
  color: #d6dcea
  font-family: inherit
  font-size: 0.66rem
  padding: 0.24rem 0.3rem
  cursor: pointer
  &:hover
    background: #232838
  &.sel
    background: #234a5c
    border-color: #4aa8d4
    color: #cdf0ff
.wed-style
  font-size: 0.6rem
.wed-row
  display: flex
  justify-content: space-between
  align-items: baseline
  gap: 0.4rem
  font-size: 0.72rem
  color: #cfe0ff
  margin-bottom: 0.15rem
  font-variant-numeric: tabular-nums
.wed-actions
  display: flex
  gap: 0.25rem
  margin: 0.25rem 0 0.35rem
.wed-act
  flex: 1 1 auto
  background: #2a3040
  border: 1px solid #445068
  border-radius: 3px
  color: #a9b8d4
  font-family: inherit
  font-size: 0.62rem
  padding: 0.22rem 0.3rem
  cursor: pointer
  &:hover
    background: #343c50
  &:disabled
    opacity: 0.4
    cursor: default
  &.alt
    flex: 0 0 auto
    color: #e0a9a9
    border-color: #6b4444
.wed-aim
  display: flex
  justify-content: space-between
  align-items: center
  gap: 0.4rem
  font-size: 0.66rem
  color: #cfe0ff
  margin: 0.2rem 0 0.35rem
.wed-hint
  font-size: 0.62rem
  line-height: 1.45
  color: #8fa0c0
  margin-bottom: 0.4rem
.wed-tune-toggle
  background: #232a3a
  border: 1px solid #384258
  border-radius: 3px
  color: #cfe0ff
  font-family: inherit
  font-size: 0.62rem
  font-weight: 700
  letter-spacing: 0.02em
  text-transform: uppercase
  text-align: left
  padding: 0.24rem 0.4rem
  margin-bottom: 0.35rem
  cursor: pointer
  &:hover
    background: #2b3348
.wed-tune
  display: flex
  flex-direction: column
  gap: 2px
  margin-bottom: 0.4rem
.wed-slider
  display: flex
  align-items: center
  gap: 0.3rem
  font-size: 0.58rem
  color: #8fa0c0
.wed-slider-label
  flex: 0 0 4.1rem
.wed-slider-input
  flex: 1 1 auto
  min-width: 0
  height: 0.9rem
  accent-color: #4aa8d4
.wed-slider-value
  flex: 0 0 2.2rem
  text-align: right
  color: #cfe0ff
  font-variant-numeric: tabular-nums
.wed-export
  display: flex
  gap: 0.25rem
  margin-bottom: 0.35rem
.wed-export-btn
  flex: 1 1 auto
  background: #223a2c
  border: 1px solid #3d6b4b
  border-radius: 3px
  color: #bfe8cd
  font-family: inherit
  font-size: 0.66rem
  font-weight: 700
  padding: 0.26rem 0.4rem
  cursor: pointer
  &:hover
    background: #2c4c39
  &.alt
    flex: 0 0 auto
    background: #2a3040
    border-color: #445068
    color: #a9b8d4
    font-weight: 400
    &:hover
      background: #343c50
.wed-export-msg
  font-size: 0.62rem
  color: #9fe0b4
  margin-bottom: 0.35rem
  word-break: break-word
.wed-foot
  margin-top: 0.2rem
  font-size: 0.6rem
  color: #6f7d99
</style>
