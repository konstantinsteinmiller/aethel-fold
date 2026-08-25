<template lang="pug">
  .ed-panel.pointer-events-auto(v-if="editorMode" :class="{ 'is-min': minimised }")
    //- Header bar. This row is the whole panel when minimised, so it carries the
    //- two facts you need to keep working — what is selected and how many
    //- placements exist — not just the title.
    .ed-head
      span.ed-title ⚑ Level Editor
      span.ed-head-sum(v-if="minimised") {{ minimisedSummary }}
      span.ed-count(v-else) {{ items.length }}
      button.ed-min(
        type="button"
        :title="minimised ? 'Restore the level editor' : 'Minimise to the header bar'"
        :aria-label="minimised ? 'Restore the level editor' : 'Minimise the level editor'"
        @click="toggleMinimised"
        @pointerdown.stop
      ) {{ minimised ? '+' : '−' }}
    template(v-if="!minimised")
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
        | Trees &amp; rocks work the same — #[b X] removes, #[b F] turns one into a prop
        br
        | Holding: #[b G] drop · #[b X] delete · #[b wheel] / #[b Q] / #[b E] rotate
        br
        | Focused: #[b C] copy · #[b −] / #[b +] scale — or use the card over it
        br
        | Height: #[b Ctrl]+wheel ±2 cm · #[b Ctrl]+#[b Shift]+wheel ±10 cm grid
      .ed-export
        button.ed-export-btn.wide(
          :title="patchTitle"
          @click="runPatchExport('delta')"
          @pointerdown.stop
        ) ⤓ Export to code
        span.ed-patch-counts(v-if="patchDirty") {{ patchCounts }}
      .ed-export
        button.ed-export-btn.alt(
          title="Export the whole scene as a replacement for the shipped baseline, not a diff against it"
          @click="runPatchExport('full')"
          @pointerdown.stop
        ) full
        button.ed-export-btn.alt(
          title="Copy the whole level as a JSON Placement[] (also logged to the console)"
          @click="runExport"
          @pointerdown.stop
        ) JSON
        button.ed-export-btn.alt(
          v-if="patchScatter > 0"
          :title="`Bring back the ${patchScatter} scattered prop(s) deleted in this world.\nDeletions that ship in worldPatch.generated.ts come back on the next reload — remove them there.`"
          @click="runRestoreScatter"
          @pointerdown.stop
        ) restore {{ patchScatter }}
        button.ed-export-btn.alt(
          title="Delete every placement in this browser"
          @click="runClear"
          @pointerdown.stop
        ) clear
      .ed-export-msg(v-if="editorStatus") {{ editorStatus }}
      .ed-empty(v-if="!items.length")
        | {{ search ? 'No match.' : 'No placeables registered yet — the catalogue is empty.' }}
      .ed-list
        //- People. First in the list because a town is laid out around them, and
        //- because selecting one takes the crosshair off the prop palette — a
        //- fact that is easier to notice at the top than buried under six
        //- collapsed prop categories.
        button.ed-cat(@click="toggle('npc')" @pointerdown.stop)
          span.ed-cat-caret {{ isOpen('npc') ? '▾' : '▸' }}
          span.ed-cat-label People
          span.ed-cat-count {{ npcItems.length }}
        template(v-if="isOpen('npc')")
          .ed-npc-sum
            | {{ npcCount }} placed · {{ npcActive }} built
            button.ed-npc-clear(
              v-if="npcCount > 0"
              title="Delete every NPC spawn in this browser"
              @click="runClearNpcs"
              @pointerdown.stop
            ) clear
          button.ed-item(
            v-for="entry in npcItems"
            :key="entry.id"
            :class="{ sel: entry.id === npcSelected }"
            :title="`${entry.label} — wears ${entry.wears}.\nCtrl+Click places one; each click is a different person.\nWheel turns them before you place.`"
            @click="pickProfession(entry.id)"
            @pointerdown.stop
          )
            span.ed-item-name {{ entry.label }}
            span.ed-item-id {{ entry.id }}
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  editorLiftMetres,
  editorMode,
  editorPalette,
  editorPaletteRevision,
  editorPlacementCount,
  editorRotationDeg,
  editorSelectedId,
  editorStatus,
  exportPlacements,
  exportWorldPatch,
  restoreAllScatter,
  worldPatchSummary,
  clearPlacements,
  resetLift,
  selectPlaceable,
  type PaletteEntry
} from '@/world/editor'
import {
  clearNpcs,
  npcActive,
  npcCount,
  npcPalette,
  npcSelected,
  selectProfession
} from '@/world/npc'
import { PLACEABLE_CATEGORY_LABELS, PLACEABLE_CATEGORY_ORDER, type PlaceableCategory } from '@/world/level/types'
import type { PatchMode } from '@/world/level/worldPatch'

const palette = ref<PaletteEntry[]>([])
const search = ref('')

/**
 * ─── Minimise ───────────────────────────────────────────────────────────────
 *
 * The house idiom for an editor overlay, shared verbatim with
 * `WaterEditorPanel.vue` (and any panel added later) — only the key and the
 * summary line differ.
 *
 * Its own localStorage key, never the save blob, exactly as
 * `src/world/editor/toggle.ts` argues for the editor mode itself: a chrome
 * preference that synced would follow a player across devices and ride along in
 * a save export. Both reads and writes are wrapped, so a browser with storage
 * disabled loses the persistence and keeps the button rather than throwing on
 * mount.
 *
 * Deliberately *not* factored into a composable. Two `ref`s and six lines are
 * cheaper to copy than to import, and a shared module would be a third place to
 * look when a panel's chrome misbehaves.
 */
const MINIMISED_KEY = 'world_editor_panel_minimised'

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
// And again whenever the catalogue itself settles. Mount and switch-on were
// both correct until placeable generation moved off the boot path — it now
// drains over ~30 frames *after* the first render, so on a reload with editor
// mode already on (it is persisted) neither ever fired against a populated
// registry and the palette stayed empty for the whole session.
watch(editorPaletteRevision, readPalette)

const items = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) {
    return palette.value
  }
  return palette.value.filter(
    entry => entry.label.toLowerCase().includes(query) || entry.id.toLowerCase().includes(query)
  )
})

const selectedLabel = computed(() => {
  // The two palettes are one crosshair, so the readout has to be able to name
  // either. Selecting in one clears the other (`selectProfession` / `setBrush`),
  // so at most one of these is ever set.
  const profession = npcItems.value.find(entry => entry.id === npcSelected.value)
  if (profession) {
    return profession.label
  }
  return palette.value.find(entry => entry.id === editorSelectedId.value)?.label ?? '—'
})

// Fixed at module scope — professions are a compile-time table, not a registry
// that fills in over the first thirty frames the way placeables do.
const npcItems = computed(() => {
  const query = search.value.trim().toLowerCase()
  const all = npcPalette()
  if (!query) {
    return all
  }
  return all.filter(entry => entry.label.toLowerCase().includes(query) || entry.id.toLowerCase().includes(query))
})

const pickProfession = (id: string): void => {
  // Clicking the selected one again puts the tool away, which is the only way
  // back to the prop palette without picking a prop.
  selectProfession(id === npcSelected.value ? '' : id)
}

const runClearNpcs = (): void => {
  clearNpcs()
}

const placedLabel = computed(
  () => `${editorPlacementCount.value} placed`
)

// The whole panel when minimised, so it spells the empty case out. The
// expanded panel can afford "Selected: —" because the word "Selected" is right
// there; a bare em dash on a lone bar says nothing.
const minimisedSummary = computed(
  () =>
    `${editorSelectedId.value || npcSelected.value ? selectedLabel.value : 'nothing selected'} · ${placedLabel.value}`
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
// `'npc'` rides the same collapse state as the prop categories. It is not a
// `PlaceableCategory` and must not become one — a profession has no `WorldAsset`
// and no LOD ladder, so a row in the catalogue would be a `defId` that sometimes
// means a rock and sometimes means a fisherman.
type SectionKey = PlaceableCategory | 'npc'
const collapsed = ref<Set<SectionKey>>(new Set())
const isOpen = (category: SectionKey): boolean => searching.value || !collapsed.value.has(category)
const toggle = (category: SectionKey): void => {
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

/**
 * ─── The patch readout ──────────────────────────────────────────────────────
 *
 * What a delta export would contain, shown next to the button so the size of
 * the change is visible *before* it is written rather than only in the toast
 * afterwards — the same reason the palette shows triangle counts on the rows
 * instead of after you place something.
 *
 * Polled on an interval rather than watched. `editorPlacementCount` misses the
 * half of it that matters most here: deleting a tree changes no placement at
 * all, only the tombstone set, so a watch on the count would leave the readout
 * stale for exactly the edits this feature exists to record.
 */
const patch = ref({ added: 0, moved: 0, deleted: 0, removedScatter: 0, npcs: 0, water: 0 })
const refreshPatch = (): void => {
  // Only while the tool is open. Off, the panel body is not rendered and nobody
  // can be reading the number, so the diff would be a timer burning frames for
  // an invisible label.
  if (editorMode.value) {
    patch.value = worldPatchSummary()
  }
}

// NPCs and water count toward "there is something to export" even though they
// are not diffs: they ship as whole lists, so a level whose only change is a
// lake still has a change worth writing. Without them the counts line stayed
// hidden and the button looked like it would do nothing.
const patchDirty = computed(
  () =>
    patch.value.added + patch.value.moved + patch.value.deleted + patch.value.removedScatter +
      patch.value.npcs + patch.value.water >
    0
)
const patchScatter = computed(() => patch.value.removedScatter)
const patchCounts = computed(() => {
  const parts: string[] = []
  if (patch.value.added) parts.push(`+${patch.value.added}`)
  if (patch.value.moved) parts.push(`~${patch.value.moved}`)
  if (patch.value.deleted) parts.push(`−${patch.value.deleted}`)
  if (patch.value.removedScatter) parts.push(`🌲−${patch.value.removedScatter}`)
  if (patch.value.npcs) parts.push(`☺${patch.value.npcs}`)
  if (patch.value.water) parts.push(`≈${patch.value.water}`)
  return parts.join(' ')
})
const patchTitle = computed(
  () =>
    'Write this session’s changes into src/world/level/worldPatch.generated.ts ' +
    '(dev server), so they can be committed and shipped. Falls back to the clipboard ' +
    'when no dev server is listening.\n\n' +
    `${patch.value.added} added · ${patch.value.moved} moved · ${patch.value.deleted} deleted · ` +
    `${patch.value.removedScatter} scattered prop(s) removed`
)

let patchTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  refreshPatch()
  patchTimer = setInterval(refreshPatch, 1000)
})
onBeforeUnmount(() => {
  if (patchTimer) {
    clearInterval(patchTimer)
    patchTimer = null
  }
})

const runPatchExport = async (mode: PatchMode): Promise<void> => {
  await exportWorldPatch(mode)
  refreshPatch()
  flashStatus()
}

const runRestoreScatter = (): void => {
  restoreAllScatter()
  refreshPatch()
  flashStatus()
}
</script>

<style scoped lang="sass">
// ── Overlay layout ──────────────────────────────────────────────────────────
//
// Bottom-left, not top-left. `WorldPerfPanel` is `fixed top-0 left-0` and
// measures 448 × 478 px expanded at a 1418 × 802 viewport — the old top-left
// anchor put this panel entirely *inside* it. Anchoring to the bottom instead
// of picking a `top` offset means the two never collide without this file
// having to know the perf panel's height, which changes as its own sections
// open.
//
// The height cap is the same argument made explicit: `100vh - 31rem` reserves
// ~496 px of left column for the perf panel, and the 62vh keeps the palette
// from running the full height of a tall monitor. Below about a 780 px
// viewport the reservation is what binds and the list gets short — collapse
// the perf panel, which is what its own header toggle is for. Left free for
// other tools: the whole right column (see `WaterEditorPanel.vue`) and the
// centre of the frame.
.ed-panel
  position: absolute
  bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px))
  left: calc(0.75rem + env(safe-area-inset-left, 0px))
  width: 15rem
  max-height: min(62vh, calc(100vh - 31rem))
  display: flex
  flex-direction: column
  background: rgba(14, 16, 22, 0.92)
  border: 1px solid #3a4257
  border-radius: 6px
  padding: 0.5rem
  color: #e8ecf2
  z-index: 50
  // Minimised: a single bar that shrink-wraps its own text, so it covers no
  // more of the viewport than it draws — a full-width collapsed panel would
  // still eat clicks meant for the world behind it.
  &.is-min
    width: auto
    min-width: 11rem
    max-width: 19rem
    max-height: none
    overflow: hidden
    padding: 0.3rem 0.45rem
    .ed-head
      margin-bottom: 0
.ed-head
  display: flex
  align-items: center
  gap: 0.4rem
  margin-bottom: 0.35rem
.ed-title
  flex: 0 0 auto
  font-weight: 700
  font-size: 0.82rem
.ed-count
  flex: 1 1 auto
  text-align: right
  font-size: 0.7rem
  color: #8fa0c0
.ed-head-sum
  flex: 1 1 auto
  min-width: 0
  overflow: hidden
  text-overflow: ellipsis
  white-space: nowrap
  text-align: right
  font-size: 0.64rem
  color: #9fb2d4
.ed-min
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
  &.wide
    flex: 1 1 100%
  &.alt
    flex: 0 0 auto
    background: #2a3040
    border-color: #445068
    color: #a9b8d4
    font-weight: 400
    &:hover
      background: #343c50
// What the patch would contain, sat next to the button that writes it. Amber
// rather than the status line's green: this is a pending change, not a result.
.ed-patch-counts
  flex: 0 0 auto
  align-self: center
  font-size: 0.62rem
  color: #e8c98f
  white-space: nowrap
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
// The crowd's two numbers. `built` is the one that matters and the one nothing
// else on screen shows: `Crowd` only ever stands up its budget, so a level with
// 200 spawns in it reading "200 placed · 12 built" is correct, not a bug.
.ed-npc-sum
  display: flex
  align-items: center
  gap: 0.4rem
  padding: 0.2rem 0.45rem
  font-size: 0.62rem
  color: #8fa0c0
.ed-npc-clear
  margin-left: auto
  background: #2b3348
  border: 1px solid #384258
  border-radius: 3px
  color: #cfe0ff
  font-family: inherit
  font-size: 0.6rem
  padding: 0.1rem 0.35rem
  cursor: pointer
  &:hover
    background: #384258
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
