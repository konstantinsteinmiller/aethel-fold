import type { Vector3 } from 'three'
import { ref } from 'vue'
import type { World } from '../core/World'
import { allPlaceables } from '../level/catalog'
import type { PlaceableCategory, Placement } from '../level/types'
import { hasStoredPlacements, LevelEditor, type LevelSeed } from './LevelEditor'
import { editorMode, installEditorToggle } from './toggle'

/**
 * ─── Level editor façade ────────────────────────────────────────────────────
 *
 * The only surface `LevelEditorPanel.vue` is allowed to touch. Everything it
 * hands out is a primitive or a plain copy; the scene graph, the `DitheredLod`
 * nodes and the `PlaceableDefinition`s (which hold live geometries and
 * materials) never leave this module. That is not tidiness — a
 * `PlaceableDefinition` dropped into a `ref` would have Vue deep-proxy every
 * `BufferGeometry` behind it, and the world would silently drop to a slideshow
 * (GDD §0).
 *
 * Wiring, in `World`:
 *
 *   installLevelEditor(this)                 // after the scene is built
 *   seedLevel(STARTING_LEVEL)                // no-op once a level exists
 *   updateLevelEditor(this.camera.position)  // once per frame, before render
 *   disposeLevelEditor()                     // in dispose()
 *
 * The per-frame call is optional. Until it arrives the editor drives itself
 * from its own rAF so it is usable the moment it is installed; the first
 * external `updateLevelEditor` cancels that loop, so wiring it up properly can
 * never double-tick.
 *
 * Install order does not matter: placements whose definition is not registered
 * yet are parked and hydrated on the first frame, so `installLevelEditor` may
 * run before or after the placeables register.
 *
 * Systems that need the placement list *every* frame (the player's colliders)
 * poll `levelRevision()` — a plain integer — and only re-read the allocating
 * `levelPlacements()` when it moves.
 */

export { editorMode, setEditorMode } from './toggle'
export type { Placement } from '../level/types'
export type { LevelSeed } from './LevelEditor'

/** Currently selected palette entry id (`''` = nothing selected). */
export const editorSelectedId = ref('')
/** Placement yaw shown by the ghost, in whole degrees, for the panel readout. */
export const editorRotationDeg = ref(0)
/** How many placements exist, orphans and the held prop included. */
export const editorPlacementCount = ref(0)
/** True while a prop is picked up and following the aim point. */
export const editorHolding = ref(false)
/** Vertical offset above the aimed surface, in metres (Ctrl + wheel). */
export const editorLiftMetres = ref(0)
/** Transient status line (export results, clear confirmations). */
export const editorStatus = ref('')

/** A palette row: a flat projection, never the definition itself. */
export interface PaletteEntry {
  id: string
  label: string
  category: PlaceableCategory
}

let editor: LevelEditor | null = null
let uninstallToggle: (() => void) | null = null
let rafId: number | null = null
let externallyDriven = false
/** Carries the revision across dispose/install so it never runs backwards. */
let revisionBase = 0
/** Seeds handed over before the editor existed. Applied at install. */
let queuedSeeds: LevelSeed[] | null = null

const stopSelfDrive = (): void => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

const startSelfDrive = (): void => {
  stopSelfDrive()
  const tick = (): void => {
    if (!editor || externallyDriven) {
      rafId = null
      return
    }
    rafId = requestAnimationFrame(tick)
    editor.update()
  }
  rafId = requestAnimationFrame(tick)
}

export const installLevelEditor = (world: World): LevelEditor => {
  if (editor) {
    return editor
  }
  const instance = new LevelEditor(world)
  instance.onStateChange = snapshot => {
    editorPlacementCount.value = snapshot.placementCount
    editorHolding.value = snapshot.holding
    editorRotationDeg.value = snapshot.rotationDeg
    editorLiftMetres.value = snapshot.liftMetres
  }
  // The mode may already be on from a previous session (it is persisted), so
  // the scene-side flag is pushed once here rather than waiting for a toggle.
  instance.setActive(editorMode.value)
  editor = instance
  uninstallToggle = installEditorToggle(on => instance.setActive(on))
  if (queuedSeeds) {
    // `seedLevel` already took the onlyIfEmpty decision against storage, which
    // cannot have changed since — nothing between there and here writes it.
    instance.seed(queuedSeeds)
    queuedSeeds = null
  }
  editorPlacementCount.value = instance.placementCount()
  startSelfDrive()
  return instance
}

/** Per-frame hook. Calling it once hands the editor over to the host loop. */
export const updateLevelEditor = (cameraPosition?: Vector3): void => {
  if (!externallyDriven) {
    externallyDriven = true
    stopSelfDrive()
  }
  editor?.update(cameraPosition)
}

export const disposeLevelEditor = (): void => {
  stopSelfDrive()
  externallyDriven = false
  // +1 so a consumer polling across the teardown sees the change and re-reads
  // an empty list, instead of holding colliders for a scene that is gone.
  revisionBase = levelRevision() + 1
  queuedSeeds = null
  uninstallToggle?.()
  uninstallToggle = null
  editor?.dispose()
  editor = null
  editorSelectedId.value = ''
  editorPlacementCount.value = 0
  editorHolding.value = false
  editorStatus.value = ''
}

/** Is the editor installed? The panel renders nothing before it is. */
export const isLevelEditorInstalled = (): boolean => editor !== null

/**
 * The palette as flat rows. Called by the panel on mount (it only mounts while
 * editor mode is on, which is always after the asset modules have registered).
 * Returns `[]` while the catalogue is still empty rather than throwing.
 */
export const editorPalette = (): PaletteEntry[] =>
  allPlaceables().map(definition => ({
    id: definition.id,
    label: definition.label,
    category: definition.category
  }))

export const selectPlaceable = (id: string): void => {
  editorSelectedId.value = id
  editor?.setSelected(id)
}

/** Drops the placement height back to the aimed surface. Panel button only. */
export const resetLift = (): void => {
  editor?.resetLift()
}

/**
 * Monotonic mutation counter for the placement list. Plain number, no `ref` —
 * this is read from the frame loop, which must never touch Vue.
 *
 * `levelPlacements()` allocates: it copies and sorts, because that is what an
 * export and a persist need. A per-frame consumer (the player's collider set)
 * must therefore poll this integer instead and only re-read when it changes:
 *
 *   if (levelRevision() !== this.lastRevision) {
 *     this.lastRevision = levelRevision()
 *     this.rebuildColliders(levelPlacements())
 *   }
 *
 * It bumps on every edit — place, remove, pick up, drop, rotate, clear, the
 * load from storage, deferred orphan hydration, and the teardown. It does
 * *not* bump while a prop is carried: a held prop's stored transform is frozen
 * at where it was picked up and only rewritten on drop, so nothing the frame
 * loop does can change the list. Skip `heldPlacementId()` when building
 * colliders, or the carried prop leaves a phantom behind.
 */
export const levelRevision = (): number => revisionBase + (editor?.revision() ?? 0)

/** The carried placement's id, or null. Exclude it from any collider set. */
export const heldPlacementId = (): string | null => editor?.heldId() ?? null

/**
 * Does this browser already have a level? True when the editor holds any
 * placement, or — before it is installed — when one is in storage. Log it at
 * boot to tell a seeded world from a restored one.
 */
export const hasStoredLevel = (): boolean => editor?.hasLevel() ?? hasStoredPlacements()

export interface SeedOptions {
  /**
   * Seed only when there is no level yet. **Defaults to true, and should stay
   * true.** Someone who has spent an hour building must never find defaults
   * injected on top of their work, or their layout replaced by a reload.
   */
  onlyIfEmpty?: boolean
}

/**
 * Lay down a starting arrangement, so a fresh boot has something to look at.
 *
 * What comes out is *ordinary placements*: editable, removable, persisted and
 * exported exactly like hand-placed props. There is no defaults layer, no
 * tombstones and no diff — once seeded, they are simply the level.
 *
 * Returns how many were seeded, or 0 when it declined. Safe either side of
 * `installLevelEditor`: called first, the decision is taken immediately
 * against storage and the seeds are queued for install. A `defId` that has not
 * registered yet is seeded anyway and hydrates on the first frame, so this
 * also works before the placeables register.
 */
export const seedLevel = (seeds: readonly LevelSeed[], options: SeedOptions = {}): number => {
  const { onlyIfEmpty = true } = options
  if (onlyIfEmpty && hasStoredLevel()) {
    return 0
  }
  if (seeds.length === 0) {
    return 0
  }
  if (editor) {
    return editor.seed(seeds)
  }
  // Appended rather than overwritten: two pre-install calls should both land.
  queuedSeeds = queuedSeeds ? [...queuedSeeds, ...seeds] : [...seeds]
  return seeds.length
}

/**
 * Retry saved placements whose definition was missing when the editor loaded.
 * The first frame does this automatically — call it only if placeables can
 * register later than that.
 */
export const rehydrateLevel = (): number => editor?.retryOrphans() ?? 0

/** Plain copies of every placement, sorted by definition then position. */
export const levelPlacements = (): Placement[] => editor?.snapshot() ?? []

const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Denied, or the document is not focused — fall through to the legacy path
    // rather than losing the export.
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/**
 * One clean export: the whole level as a JSON `Placement[]`.
 *
 * dreamion split this into "delta" and "full" because it shipped hand-authored
 * defaults and needed to print only what an editing session changed. This
 * project has no seeded layer yet — every placement is authored in the editor —
 * so a delta would be identical to the full export, and offering both would
 * only imply a distinction that does not exist. Add the split back when a
 * committed base layout exists to diff against.
 */
export const exportPlacements = async (): Promise<string> => {
  const placements = levelPlacements()
  const text = JSON.stringify(placements, null, 2)
  console.log(text)
  const ok = await copyToClipboard(text)
  const message = `${ok ? 'Copied' : 'In console (copy failed)'} · ${placements.length} placement(s)`
  editorStatus.value = message
  return message
}

export const clearPlacements = (): string => {
  const removed = editor?.clearAll() ?? 0
  const message = `Cleared ${removed} placement(s)`
  editorStatus.value = message
  return message
}
