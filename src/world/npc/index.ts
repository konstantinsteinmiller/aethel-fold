import type { Vector3 } from 'three'
import { ref } from 'vue'
import { PROFESSIONS, PROFESSION_IDS, type Profession } from '../characters/professions'
import type { LevelEditor } from '../editor/LevelEditor'
import { Crowd, type CrowdOptions } from './Crowd'
import { NpcBrush } from './NpcBrush'
import {
  NpcStore,
  clearStoredSpawns,
  loadSpawns,
  sanitiseSpawn,
  saveSpawns,
  spawnBreakdown,
  type NpcSpawn
} from './spawns'

/**
 * ─── NPC façade ─────────────────────────────────────────────────────────────
 *
 * The only surface `LevelEditorPanel.vue` is allowed to touch, and the same rule
 * as `editor/index.ts`: everything handed out is a primitive or a plain copy.
 * The `Crowd`, the `NpcStore` and the `Character` instances behind them never
 * leave this module — a `Character` dropped into a `ref` would have Vue
 * deep-proxy a skeleton, two skinned meshes and every buffer behind them, and
 * the world would silently drop to a slideshow (GDD §0).
 *
 * Wiring, in `World`:
 *
 *   installCrowd(this, { groundAt })   // after the level editor
 *   updateCrowd(dt, this.camera.position)
 *   disposeCrowd()
 */

/** The profession the brush will place, or `''` when the tool is off. */
export const npcSelected = ref('')
/** How many spawns the level holds. */
export const npcCount = ref(0)
/** How many figures are actually built right now — the number draws scale with. */
export const npcActive = ref(0)
/** Transient status line, shared shape with `editorStatus`. */
export const npcStatus = ref('')

/** A palette row. A flat projection, never the outfit table itself. */
export interface NpcPaletteEntry {
  id: Profession
  label: string
  /** What they are wearing, as a short line for the row's tooltip. */
  wears: string
}

export const npcPalette = (): NpcPaletteEntry[] =>
  PROFESSION_IDS.map(id => {
    const outfit = PROFESSIONS[id]
    const worn = [outfit.torso, outfit.legs, outfit.head, outfit.mainHand, outfit.offHand, outfit.back].filter(
      (kind): kind is NonNullable<typeof kind> => kind !== null
    )
    return {
      id,
      label: outfit.label,
      wears: worn.length > 0 ? worn.join(', ') : 'nothing'
    }
  })

let store: NpcStore | null = null
let crowd: Crowd | null = null
let brush: NpcBrush | null = null
let host: LevelEditor | null = null

const syncCounts = (): void => {
  npcCount.value = store?.size ?? 0
  npcActive.value = crowd?.active ?? 0
}

export interface InstallCrowdOptions extends CrowdOptions {
  /** The level editor whose crosshair the placing tool borrows. */
  editor?: LevelEditor | null
}

/**
 * Builds the store, the crowd and the editor tool, and loads what is saved.
 *
 * Idempotent: a second call returns the existing crowd rather than a second one
 * standing inside the first.
 */
export const installCrowd = (options: InstallCrowdOptions = {}): Crowd => {
  if (crowd) {
    return crowd
  }
  const { editor = null, ...crowdOptions } = options
  store = new NpcStore()
  store.restore(loadSpawns())
  crowd = new Crowd(store, crowdOptions)
  brush = new NpcBrush(store, crowd)
  host = editor
  if (editor) {
    // The brush's preview lives under the editor's own group so it is torn down
    // and hidden with the rest of the tool rather than tracking editor mode
    // separately.
    editor.group.add(brush.group)
  }
  syncCounts()
  return crowd
}

/** Per-frame hook. `cameraPosition` is what decides who exists. */
export const updateCrowd = (dt: number, cameraPosition?: Vector3): void => {
  crowd?.update(dt, cameraPosition)
  // Read *after* the update so the panel shows what is standing now, and pushed
  // from here rather than from the brush: the brush is not the only writer —
  // a click places one, but the crowd itself parks and unparks figures as the
  // camera moves, and a count only the brush updated would be wrong the moment
  // the player walked away. Both are integers compared before assignment, so a
  // frame in which nothing changed costs Vue nothing.
  const count = store?.size ?? 0
  if (count !== npcCount.value) {
    npcCount.value = count
  }
  const active = crowd?.active ?? 0
  if (active !== npcActive.value) {
    npcActive.value = active
  }
}

export const disposeCrowd = (): void => {
  host?.setBrush(null)
  brush?.dispose()
  crowd?.dispose()
  brush = null
  crowd = null
  store = null
  host = null
  npcSelected.value = ''
  npcCount.value = 0
  npcActive.value = 0
  npcStatus.value = ''
}

export const isCrowdInstalled = (): boolean => crowd !== null

/**
 * Picks the role the next click places, or `''` to hand the crosshair back to
 * the prop palette.
 *
 * Selecting a profession and selecting a placeable are two answers to "what does
 * a click do", so each drops the other — the editor does its half in `setBrush`
 * and this does the other half.
 */
export const selectProfession = (id: string): void => {
  if (!brush || !host) {
    return
  }
  const profession = PROFESSION_IDS.find(candidate => candidate === id) ?? null
  brush.select(profession)
  host.setBrush(profession ? brush : null)
  npcSelected.value = profession ?? ''
}

/** Plain copies of every spawn, sorted. What the patch export writes. */
export const npcSpawns = (): NpcSpawn[] => store?.all() ?? []

/**
 * Lay down the crowd a shipped patch carries.
 *
 * Same rule as `seedLevel`, and for the same reason: **only when there is
 * nobody yet**. Someone who has spent an hour arranging a market must not find
 * the shipped villagers injected on top of their work, or their arrangement
 * replaced by a reload.
 *
 * Unlike placements there is no baseline to diff against and no orphan path —
 * `sanitiseSpawn` drops a profession this build does not know and `NpcStore`
 * keeps it aside so a save never eats it.
 */
export const seedNpcs = (entries: readonly unknown[] | undefined): number => {
  if (!store || !entries || entries.length === 0 || store.size > 0) {
    return 0
  }
  let seeded = 0
  for (const entry of entries) {
    const spawn = sanitiseSpawn(entry)
    if (!spawn) {
      continue
    }
    store.add(spawn)
    seeded++
  }
  if (seeded > 0) {
    saveSpawns(store)
    crowd?.invalidate()
    syncCounts()
  }
  return seeded
}

/** Monotonic mutation counter. A plain integer — polled, never a `ref`. */
export const npcRevision = (): number => store?.revision ?? 0

/** A one-line summary of who is in the level, for the panel. */
export const npcSummary = (): string => {
  if (!store || store.size === 0) {
    return 'none'
  }
  return spawnBreakdown(store.view())
    .map(row => `${PROFESSIONS[row.profession].label} ×${row.count}`)
    .join(' · ')
}

export const clearNpcs = (): string => {
  const removed = store?.clear() ?? 0
  if (store) {
    saveSpawns(store)
  }
  crowd?.invalidate()
  syncCounts()
  const message = `Cleared ${removed} NPC(s)`
  npcStatus.value = message
  return message
}

/** Forgets the saved crowd entirely — storage included. Dev tool only. */
export const forgetStoredNpcs = (): void => {
  clearStoredSpawns()
}

export { DEFAULT_CROWD_BUDGET, DEFAULT_CROWD_RANGE } from './Crowd'
export type { NpcSpawn } from './spawns'
export type { Profession } from '../characters/professions'
