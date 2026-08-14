<template lang="pug">
  .ed-panel.pointer-events-auto(v-if="editorMode")
    .ed-head
      span.ed-title ⚑ Level Editor
      span.ed-count {{ items.length }}
    input.ed-search(
      v-model="search"
      placeholder="Search objects…"
      @keydown.stop
      @pointerdown.stop
      @wheel.stop
    )
    .ed-sel
      | Selected: #[b {{ selectedLabel }}]
      span.ed-rot {{ editorRotationDeg }}°
    .ed-lift
      span Lift #[b {{ liftLabel }}]
      button.ed-lift-reset(
        v-if="editorLiftMetres !== 0"
        title="Drop the placement height back to the surface"
        @click="resetLift"
        @pointerdown.stop
      ) reset
    .ed-hint
      | #[b Ctrl]+Click / #[b G] place · #[b Shift]+Click remove
      br
      | Aim an object: #[b F] pick up · #[b X] delete
      br
      | Holding: #[b G] drop · #[b X] delete · #[b wheel] / #[b Q] / #[b E] rotate
      br
      | Height: #[b Ctrl]+wheel ±2 cm · #[b Ctrl]+#[b Shift]+wheel ±10 cm grid
    .ed-export
      button.ed-export-btn(
        title="Copy the whole level as a JSON Placement[] (also logged to the console)"
        @click="runExport"
        @pointerdown.stop
      ) ⤓ Export JSON
      button.ed-export-btn.alt(
        title="Delete every placement in this browser"
        @click="runClear"
        @pointerdown.stop
      ) clear
    .ed-export-msg(v-if="editorStatus") {{ editorStatus }}
    .ed-empty(v-if="!items.length")
      | {{ search ? 'No match.' : 'No placeables registered yet — the catalogue is empty.' }}
    .ed-list
      template(v-for="group in groups" :key="group.category")
        button.ed-cat(@click="toggle(group.category)" @pointerdown.stop)
          span.ed-cat-caret {{ isOpen(group.category) ? '▾' : '▸' }}
          span.ed-cat-label {{ group.label }}
          span.ed-cat-count {{ group.entries.length }}
        template(v-if="isOpen(group.category)")
          button.ed-item(
            v-for="entry in group.entries"
            :key="entry.id"
            :class="{ sel: entry.id === editorSelectedId }"
            :title="costTitle(entry)"
            @click="selectPlaceable(entry.id)"
            @pointerdown.stop
          )
            span.ed-item-name {{ entry.label }}
            span.ed-item-tris(:class="costClass(entry.tris)") {{ entry.tris }}
            span.ed-item-id {{ entry.id }}
    .ed-foot {{ placedLabel }} · type #[b cmonc] to exit
</template>

<!--
  In-world level editor palette — a port of dreamion's `LevelEditorPanel.vue`,
  kept visually and control-for-control identical because that is the whole
  point of porting it.

  Deliberately NOT internationalised: it is a dev tool behind a code word, and
  the project i18n rule exempts debug overlays. Translating "Ctrl+Click place"
  into 21 languages would add keys no player can ever reach.

  Every value this component holds is a string, a number or a boolean. The
  palette arrives as a flat projection from `editorPalette()` — never a
  `PlaceableDefinition`, which carries live geometries and materials that Vue
  would deep-proxy on contact (GDD §0).
-->

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  editorLiftMetres,
  editorMode,
  editorPalette,
  editorPlacementCount,
  editorRotationDeg,
  editorSelectedId,
  editorStatus,
  exportPlacements,
  clearPlacements,
  resetLift,
  selectPlaceable,
  type PaletteEntry
} from '@/world/editor'
import { PLACEABLE_CATEGORY_LABELS, PLACEABLE_CATEGORY_ORDER, type PlaceableCategory } from '@/world/level/types'

const palette = ref<PaletteEntry[]>([])
const search = ref('')

// Snapshotted, not recomputed per render: the catalogue is a build-time
// registry, so a `computed` over it would re-project the whole palette on
// every keystroke in the search box for a list that cannot have changed.
//
// Re-read on each switch-on as well as on mount, so this component is safe to
// mount unconditionally: if it happens to mount before the asset modules have
// registered, the first toggle picks the palette up rather than leaving it
// permanently empty. There is no timer and no watcher on the frame loop here —
// while editor mode is off this component does no work at all.
const readPalette = (): void => {
  palette.value = editorPalette()
}
onMounted(readPalette)
watch(editorMode, on => {
  if (on) {
    readPalette()
  }
})

const items = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) {
    return palette.value
  }
  return palette.value.filter(
    entry => entry.label.toLowerCase().includes(query) || entry.id.toLowerCase().includes(query)
  )
})

const selectedLabel = computed(
  () => palette.value.find(entry => entry.id === editorSelectedId.value)?.label ?? '—'
)

const placedLabel = computed(
  () => `${editorPlacementCount.value} placed`
)

// Centimetres under a metre, metres above it — a lift of "0.04 m" is harder to
// read at a glance than "4 cm", and sub-metre nudging is the common case.
const liftLabel = computed(() => {
  const metres = editorLiftMetres.value
  if (metres === 0) {
    return 'ground'
  }
  const sign = metres > 0 ? '+' : '−'
  const magnitude = Math.abs(metres)
  return magnitude < 1 ? `${sign}${Math.round(magnitude * 100)} cm` : `${sign}${magnitude.toFixed(2)} m`
})

const groups = computed(() =>
  PLACEABLE_CATEGORY_ORDER.map(category => ({
    category,
    label: PLACEABLE_CATEGORY_LABELS[category],
    entries: items.value.filter(entry => entry.category === category)
  })).filter(group => group.entries.length > 0)
)

// Collapsible sections. A live search force-opens every one of them, or a match
// could sit invisible inside a collapsed header.
const searching = computed(() => search.value.trim().length > 0)
const collapsed = ref<Set<PlaceableCategory>>(new Set())
const isOpen = (category: PlaceableCategory): boolean => searching.value || !collapsed.value.has(category)
const toggle = (category: PlaceableCategory): void => {
  // A fresh Set, because mutating one in place does not trip Vue's reactivity
  // for the `has` lookups above.
  const next = new Set(collapsed.value)
  if (next.has(category)) {
    next.delete(category)
  } else {
    next.add(category)
  }
  collapsed.value = next
}

/**
 * Cost banding for the LOD0 triangle count.
 *
 * The thresholds are drawn from where the catalogue actually clusters rather
 * than from round numbers: scatter props (stone 56, slab 96, grass rock 99) sit
 * under 120, the ordinary hand-placed props (tree 162, pine 192, plateau 216)
 * run to about 240, and only the hero geometry — mesa 280, ancient oak 320 —
 * goes past it. So the three bands separate "place freely", "place normally"
 * and "this one is a landmark, place a few".
 *
 * Banding rather than a bare number because the number alone requires knowing
 * the budget table to interpret, and the point of putting it here is that the
 * designer should not have to.
 */
const costClass = (tris: number): string => (tris <= 120 ? 'low' : tris <= 240 ? 'mid' : 'high')

const costTitle = (entry: PaletteEntry): string =>
  `${entry.id}\nLOD0–3: ${entry.lodTris.join(' / ')} tris`

let messageTimer: ReturnType<typeof setTimeout> | null = null
const flashStatus = (): void => {
  if (messageTimer) {
    clearTimeout(messageTimer)
  }
  messageTimer = setTimeout(() => {
    editorStatus.value = ''
  }, 6000)
}

const runExport = async (): Promise<void> => {
  await exportPlacements()
  flashStatus()
}

const runClear = (): void => {
  clearPlacements()
  flashStatus()
}
</script>

<style scoped lang="sass">
.ed-panel
  position: absolute
  top: calc(0.75rem + env(safe-area-inset-top, 0px))
  left: calc(0.75rem + env(safe-area-inset-left, 0px))
  width: 15rem
  max-height: 78vh
  display: flex
  flex-direction: column
  background: rgba(14, 16, 22, 0.92)
  border: 1px solid #3a4257
  border-radius: 6px
  padding: 0.5rem
  color: #e8ecf2
  z-index: 50
.ed-head
  display: flex
  justify-content: space-between
  align-items: baseline
  margin-bottom: 0.35rem
.ed-title
  font-weight: 700
  font-size: 0.82rem
.ed-count
  font-size: 0.7rem
  color: #8fa0c0
.ed-search
  width: 100%
  background: #10131c
  border: 1px solid #3a4257
  border-radius: 4px
  color: #e8ecf2
  font-family: inherit
  font-size: 0.72rem
  padding: 0.28rem 0.4rem
  margin-bottom: 0.35rem
  outline: none
.ed-sel
  display: flex
  justify-content: space-between
  align-items: baseline
  gap: 0.4rem
  font-size: 0.72rem
  color: #cfe0ff
  margin-bottom: 0.15rem
.ed-rot
  flex: 0 0 auto
  font-size: 0.64rem
  color: #8fa0c0
  font-variant-numeric: tabular-nums
.ed-lift
  display: flex
  justify-content: space-between
  align-items: baseline
  gap: 0.4rem
  font-size: 0.72rem
  color: #cfe0ff
  margin-bottom: 0.15rem
  font-variant-numeric: tabular-nums
.ed-lift-reset
  flex: 0 0 auto
  background: none
  border: none
  padding: 0
  font: inherit
  font-size: 0.62rem
  color: #8fa0c0
  text-decoration: underline
  cursor: pointer
.ed-hint
  font-size: 0.64rem
  color: #8fa0c0
  margin-bottom: 0.4rem
.ed-export
  display: flex
  gap: 0.25rem
  margin-bottom: 0.35rem
.ed-export-btn
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
.ed-export-msg
  font-size: 0.62rem
  color: #9fe0b4
  margin-bottom: 0.35rem
  word-break: break-word
.ed-empty
  font-size: 0.66rem
  color: #8fa0c0
  padding: 0.35rem 0
.ed-list
  overflow-y: auto
  display: flex
  flex-direction: column
  gap: 2px
.ed-cat
  position: sticky
  top: 0
  z-index: 1
  display: flex
  align-items: center
  gap: 0.35rem
  text-align: left
  background: #232a3a
  border: 1px solid #384258
  border-radius: 3px
  color: #cfe0ff
  font-family: inherit
  font-size: 0.66rem
  font-weight: 700
  letter-spacing: 0.02em
  text-transform: uppercase
  padding: 0.26rem 0.4rem
  margin-top: 2px
  cursor: pointer
  &:first-child
    margin-top: 0
  &:hover
    background: #2b3348
.ed-cat-caret
  flex: 0 0 auto
  width: 0.7rem
  color: #8fa0c0
.ed-cat-label
  flex: 1 1 auto
.ed-cat-count
  flex: 0 0 auto
  font-size: 0.6rem
  font-weight: 400
  color: #8fa0c0
.ed-item
  display: flex
  align-items: baseline
  // Tighter than the 0.4rem it was: the row carries a third column now, and the
  // label is the one that gives up space to it.
  gap: 0.3rem
  text-align: left
  background: #191d28
  border: 1px solid transparent
  border-radius: 3px
  color: #d6dcea
  font-family: inherit
  font-size: 0.7rem
  padding: 0.22rem 0.4rem
  cursor: pointer
  &:hover
    background: #232838
  &.sel
    background: #2a3a5c
    border-color: #4a7fd4
.ed-item-name
  flex: 1 1 auto
  overflow: hidden
  text-overflow: ellipsis
  white-space: nowrap
.ed-item-tris
  flex: 0 0 auto
  min-width: 1.7rem
  text-align: right
  font-size: 0.58rem
  font-variant-numeric: tabular-nums
  // Tabular figures and a min-width wide enough for three digits, so a 96 and a
  // 280 occupy the same slot and the number does not shift the id beside it as
  // the list is filtered. The counts do not share a global right edge — the id
  // column is variable width — which is why the cost banding carries the
  // at-a-glance read rather than the alignment.
  &.low
    color: #7fb08a
  &.mid
    color: #c9b676
  &.high
    color: #d98c74
.ed-item-id
  flex: 0 0 auto
  font-size: 0.56rem
  opacity: 0.55
.ed-foot
  margin-top: 0.4rem
  font-size: 0.6rem
  color: #6f7d99
</style>
