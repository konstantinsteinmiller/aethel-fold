import type { Vector3 } from 'three'
import { ref } from 'vue'
import type { World } from '../core/World'
import { triangleCount } from '../geometry/budget'
import { allPlaceables, catalogRevision } from '../level/catalog'
import type { PlaceableCategory, Placement } from '../level/types'
import { buildWorldPatch, formatWorldPatch, type PatchMode } from '../level/worldPatch'
import {
  type EditorFocus,
  editorFocusScreen,
  EMPTY_FOCUS,
  hasStoredPlacements,
  LevelEditor,
  type LevelSeed
} from './LevelEditor'
import { npcSpawns } from '../npc'
import { waterPlacements } from '../water/editorFacade'
import { disposeTerrainSculptor, installTerrainSculptor, setSculptActive, updateTerrainSculptor } from './sculptFacade'
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

/**
 * ─── Focus billboard ────────────────────────────────────────────────────────
 *
 * What the crosshair is on (or what is in hand), split deliberately in two:
 *
 * * **`editorFocus`** — a `ref` holding primitives only, written when the focus
 *   *changes* or the focused prop is edited. This is what the card renders.
 * * **`editorFocusScreen`** — a plain, non-reactive object mutated every frame
 *   with the anchor's normalised device coordinates. The panel reads it from its
 *   own rAF and writes the DOM transform directly.
 *
 * The split is the whole design. A HUD that tracks a moving object has to update
 * at frame rate, and routing that through a `ref` would put a Vue patch pass on
 * the render loop — the exact coupling GDD §0 keeps three.js and Vue apart to
 * avoid. Identity changes a few times a second at most and can afford
 * reactivity; position cannot.
 */
export const editorFocus = ref<EditorFocus>(EMPTY_FOCUS)
export { editorFocusScreen } from './LevelEditor'
export type { EditorFocus } from './LevelEditor'

/** A palette row: a flat projection, never the definition itself. */
export interface PaletteEntry {
  id: string
  label: string
  category: PlaceableCategory
  /**
   * LOD0 triangle count — what one of these costs standing next to the player.
   *
   * LOD0 rather than a sum or an average of the ladder, because the question the
   * number answers is "can I afford to put this here", and the answer is set by
   * the tier that draws when the prop is close. A prop's coarse tiers are what
   * it costs at 200 m, which is never the reason a scene got heavy.
   */
  tris: number
  /** All four tiers, finest first, for the row's tooltip. */
  lodTris: number[]
}

let editor: LevelEditor | null = null
/**
 * The world the editor is installed in.
 *
 * Held only for the export, which needs the seeded baseline and the scatter
 * overrides — both of which live on `World` because they are the world's, not
 * the editor's. Nothing per-frame reads this, so it stays outside the ref layer.
 */
let hostWorld: World | null = null
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
  hostWorld = world
  const instance = new LevelEditor(world)
  instance.onStateChange = snapshot => {
    editorPlacementCount.value = snapshot.placementCount
    editorHolding.value = snapshot.holding
    editorRotationDeg.value = snapshot.rotationDeg
    editorLiftMetres.value = snapshot.liftMetres
  }
  instance.onFocusChange = focus => {
    editorFocus.value = focus
  }
  // The mode may already be on from a previous session (it is persisted), so
  // the scene-side flag is pushed once here rather than waiting for a toggle.
  instance.setActive(editorMode.value)
  editor = instance
  // The terrain sculptor rides the same code word and the same lifecycle: it
  // is the other half of the same tool from the user's side, and installing it
  // separately would mean two places that can forget to tear the other down.
  installTerrainSculptor(world)
  uninstallToggle = installEditorToggle(on => {
    instance.setActive(on)
    setSculptActive(on)
  })
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
  updateTerrainSculptor()
  watchCatalogue()
}

/**
 * ─── Keeping the palette in step with a catalogue that arrives late ─────────
 *
 * Bumped once the catalogue has stopped growing. The panel watches it and
 * re-reads the palette.
 *
 * This exists because placeable generation no longer happens at boot: it was
 * 77 % of a 660 ms boot and now drains over ~30 frames *after* the first render
 * (AAA-graphics §11d). The panel mounts long before that finishes, and editor
 * mode is persisted — so on any reload with the editor already on, the palette
 * was read exactly once against an empty registry and stayed empty for the whole
 * session. The only workaround was to type the code word twice, which is not
 * something anybody would guess.
 */
export const editorPaletteRevision = ref(0)

/**
 * Frames the catalogue must sit still before the palette is re-read.
 *
 * Not zero, because the drain registers one definition per slice and firing on
 * each would run 34 Vue patch passes across the most frame-sensitive second of
 * the session — the drain already runs at ~10 fps under a CPU throttle. Two
 * quiet frames costs one integer compare per frame and fires once.
 */
const CATALOG_SETTLE_FRAMES = 2

let seenCatalogue = -1
let catalogueQuietFrames = 0

const watchCatalogue = (): void => {
  const revision = catalogRevision()
  if (revision !== seenCatalogue) {
    seenCatalogue = revision
    catalogueQuietFrames = 0
    return
  }
  if (catalogueQuietFrames < CATALOG_SETTLE_FRAMES) {
    catalogueQuietFrames++
    if (catalogueQuietFrames === CATALOG_SETTLE_FRAMES) {
      editorPaletteRevision.value = revision
    }
  }
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
  hostWorld = null
  disposeTerrainSculptor()
  editor?.dispose()
  editor = null
  editorSelectedId.value = ''
  editorPlacementCount.value = 0
  editorHolding.value = false
  editorStatus.value = ''
  editorFocus.value = EMPTY_FOCUS
  editorFocusScreen.onScreen = false
}

/**
 * ─── Focus actions ──────────────────────────────────────────────────────────
 *
 * Every verb the billboard offers, and every one of them is also a key binding —
 * the card exists to make them *discoverable*, not to replace the shortcuts. The
 * façade layer is one line each on purpose: the editor owns the semantics, this
 * only decides what the panel is allowed to reach.
 */

/** Pick the focused prop up, or put down the one in hand. `F` / `G`. */
export const focusMove = (): void => {
  editor?.toggleGrab()
}

/** Delete the focused prop, carried or aimed at. `X`. */
export const focusDelete = (): void => {
  editor?.deleteFocused()
}

/** Turn the focused prop. `Q` / `E`. */
export const focusRotate = (degrees: number): void => {
  editor?.rotateFocused(degrees)
}

/** Grow or shrink the focused prop by one step. `−` / `+`. */
export const focusScale = (direction: number): void => {
  editor?.scaleFocused(direction)
}

/** Copy the focused prop and pick the copy up. `C`. */
export const focusDuplicate = (): void => {
  editor?.duplicateFocused()
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
    category: definition.category,
    // Counted here rather than passed through from the generator's budget
    // assertion, because this must be the count of the geometry that will
    // actually be drawn — a ledger entry can go stale against its mesh, and a
    // number the designer is budgeting against that quietly disagrees with the
    // renderer is worse than no number at all.
    tris: definition.asset.tiers[0] ? triangleCount(definition.asset.tiers[0]) : 0,
    lodTris: definition.asset.tiers.map(triangleCount)
  }))

export const selectPlaceable = (id: string): void => {
  editorSelectedId.value = id
  editor?.setSelected(id)
}

/**
 * Hands placement rendering to the instanced batch (`false`) or back to the
 * editor's individual nodes (`true`). Driven by `World` off the editor mode.
 */
export const setPlacementsRendered = (on: boolean): void => {
  editor?.setPlacementsRendered(on)
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

/** The whole level as JSON, for pasting somewhere by hand. */
export const exportPlacements = async (): Promise<string> => {
  const placements = levelPlacements()
  const text = JSON.stringify(placements, null, 2)
  console.log(text)
  const ok = await copyToClipboard(text)
  const message = `${ok ? 'Copied' : 'In console (copy failed)'} · ${placements.length} placement(s)`
  editorStatus.value = message
  return message
}

/**
 * ─── Export to code ─────────────────────────────────────────────────────────
 *
 * The point of the level editor is that changes made in the browser end up in
 * the repository, where they can be reviewed, committed and shipped to everyone
 * else. dreamion learnt this the hard way: its first export copied a blob to the
 * clipboard and called it done, and the trap it documents is that a clipboard
 * export is not an export at all — it puts the work one paste away from being
 * lost, and nothing tells you if the paste never happened.
 *
 * So the primary path **writes the file**. The dev server exposes
 * `/__editor/save-world-patch` (see `vite.config.ts`), which replaces
 * `src/world/level/worldPatch.generated.ts` and lets HMR reload it. The
 * clipboard is the fallback for when that endpoint is not there — a production
 * build, or the game running from a static host.
 */

const PATCH_ENDPOINT = '/__editor/save-world-patch'

const writePatchToRepo = async (source: string): Promise<string | null> => {
  if (!import.meta.env.DEV) {
    // No dev server, no write. Saying so beats a fetch that 404s into a
    // fallback and leaves the user unsure which path ran.
    return null
  }
  try {
    const response = await fetch(PATCH_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source })
    })
    if (!response.ok) {
      return null
    }
    const result = (await response.json()) as { path?: string }
    return result.path ?? PATCH_FILE
  } catch {
    return null
  }
}

const PATCH_FILE = 'src/world/level/worldPatch.generated.ts'

/**
 * Write the editor's changes into the repo as a world patch.
 *
 * `delta` (the default) exports what this session changed against the shipped
 * baseline; `full` exports the whole scene as a replacement for that baseline.
 * Both include every scatter deletion, which is always a delta because the
 * procedural generator *is* the thing it is a delta against.
 */
export const exportWorldPatch = async (mode: PatchMode = 'delta'): Promise<string> => {
  if (!hostWorld) {
    const message = 'No world — export needs the editor installed'
    editorStatus.value = message
    return message
  }
  const built = buildWorldPatch({
    live: levelPlacements(),
    baseline: hostWorld.levelBaseline,
    removedScatter: hostWorld.scatterOverrides.list(),
    // The whole crowd in both modes — there is no shipped baseline to diff a
    // villager against, so "what changed" and "who is there" are the same list.
    npcs: npcSpawns(),
    // Ditto for water: no shipped baseline, so the whole layout ships.
    water: waterPlacements(),
    mode
  })
  const source = formatWorldPatch(built, mode)
  console.log(source)

  const crowd = built.npcs > 0 ? ` · ${built.npcs} npc` : ''
  const lakes = built.water > 0 ? ` · ${built.water} water` : ''
  const summary =
    (mode === 'delta'
      ? `+${built.added} ~${built.moved} −${built.deleted} · ${built.removedScatter} scatter`
      : `${built.added} placement(s) · ${built.removedScatter} scatter`) + crowd + lakes

  const written = await writePatchToRepo(source)
  if (written) {
    const message = `Wrote ${written} · ${summary}`
    editorStatus.value = message
    return message
  }
  const copied = await copyToClipboard(source)
  const message = `${copied ? 'Copied' : 'In console'} · ${summary}`
  editorStatus.value = message
  return message
}

/**
 * What a delta export would contain right now, without writing anything.
 *
 * The panel shows this beside the button so the counts are visible *before* the
 * commit, not only in the toast afterwards.
 */
export const worldPatchSummary = (): {
  added: number
  moved: number
  deleted: number
  removedScatter: number
  npcs: number
  water: number
} => {
  if (!hostWorld) {
    return { added: 0, moved: 0, deleted: 0, removedScatter: 0, npcs: 0, water: 0 }
  }
  const built = buildWorldPatch({
    live: levelPlacements(),
    baseline: hostWorld.levelBaseline,
    removedScatter: hostWorld.scatterOverrides.list(),
    npcs: npcSpawns(),
    water: waterPlacements(),
    mode: 'delta'
  })
  return {
    added: built.added,
    moved: built.moved,
    deleted: built.deleted,
    removedScatter: built.removedScatter,
    npcs: built.npcs,
    water: built.water
  }
}

/** Bring back every scattered prop the editor deleted. */
export const restoreAllScatter = (): string => {
  const count = hostWorld?.scatterOverrides.removedCount ?? 0
  hostWorld?.clearScatterOverrides()
  const message = `Restored ${count} scattered prop(s)`
  editorStatus.value = message
  return message
}

export const clearPlacements = (): string => {
  const removed = editor?.clearAll() ?? 0
  const message = `Cleared ${removed} placement(s)`
  editorStatus.value = message
  return message
}
