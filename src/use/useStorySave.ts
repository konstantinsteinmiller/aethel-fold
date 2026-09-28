import { ref } from 'vue'

/**
 * ─── Story saves ────────────────────────────────────────────────────────────
 *
 * Three numbered slots and one quick slot, persisted to `localStorage`.
 *
 * ── This module does not know what a beat is ────────────────────────────────
 *
 * It stores a `payload: unknown` and hands it back untouched. The story layer
 * decides what goes in it; this decides where it lives, that it survives a
 * reload, and that a blob written by an older build cannot stop the menu from
 * opening.
 *
 * That seam is the whole point. `StoryDirector` owns a `CombatDirector`, which
 * owns `Character`s, which own skeletons and buffers — a save module that knew
 * how to walk that graph would have to be rewritten every time the chapter grew
 * a new kind of state, and would drag three.js into a file the settings screen
 * imports. The four fields *around* the payload (`chapter`, `beatId`, `label`,
 * `savedAt`) exist because the load menu has to draw a row for a save without
 * understanding it.
 *
 * ── Everything is total ─────────────────────────────────────────────────────
 *
 * `sanitiseStorySave` follows `useGameSettings.ts::sanitiseSettings`: every
 * branch returns a usable table rather than throwing, and a single unreadable
 * slot costs that slot, not the file. A save menu that will not open because of
 * a key from an older build is a far worse failure than one empty row.
 *
 * Reads and writes are wrapped, because `localStorage` **throws outright** in a
 * sandboxed iframe — which is how several of the portals this ships to serve
 * games. A player there keeps their saves for the session and loses them on
 * reload, which is strictly better than a menu that throws on every click.
 */

/**
 * Slot ids are numbers so `menu.slot` can interpolate one straight into
 * "Slot {n}", and a union rather than `number` so `saveSlots.value[slot]` is a
 * `StorySaveRecord | null` instead of `| undefined` under
 * `noUncheckedIndexedAccess`.
 */
export type SaveSlotId = 0 | 1 | 2 | 3

/** The autosave-shaped slot. Quick save / quick load are just this slot. */
export const QUICK_SLOT = 0 as const

/** The slots a player picks by hand, in menu order. */
export const SAVE_SLOTS: readonly SaveSlotId[] = [1, 2, 3]

/** Every slot, quick first. Used by `clearAllSlots` and by the tests. */
export const ALL_SLOTS: readonly SaveSlotId[] = [QUICK_SLOT, 1, 2, 3]

export interface StorySaveRecord {
  slot: SaveSlotId
  /** ISO 8601, stamped by `writeSlot`. Rendered in the player's locale. */
  savedAt: string
  chapter: number
  /** Opaque to this module — an id out of `story/chapter1.ts`. */
  beatId: string
  /** Already-resolved text for the row, e.g. the objective. Never a key. */
  label: string
  /**
   * Whatever the story layer needs to restore itself.
   *
   * Must be JSON-serialisable. If it is not, `writeSlot` returns `false` and
   * the save stays in memory for the session — see `persist`.
   */
  payload: unknown
}

/** The whole table, `null` where a slot is empty. */
export type StorySaveTable = Record<SaveSlotId, StorySaveRecord | null>

/** What a caller passes in; the slot and the timestamp are stamped here. */
export type StorySaveInput = Omit<StorySaveRecord, 'slot' | 'savedAt'> & { savedAt?: string }

export const STORY_SAVE_KEY = 'world.storySave.v1'

/**
 * Bumped only when a blob written by an older build cannot be read at all.
 *
 * A mismatch drops every slot rather than attempting a migration, so the
 * version is deliberately *not* bumped for an added field — `sanitiseRecord`
 * already fills in what is missing, and a player losing three saves to a
 * cosmetic schema change is the worse outcome.
 */
export const STORY_SAVE_VERSION = 1

const emptyTable = (): StorySaveTable => ({ 0: null, 1: null, 2: null, 3: null })

const isSlot = (value: unknown): value is SaveSlotId => value === 0 || value === 1 || value === 2 || value === 3

const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback

/**
 * One record, repaired.
 *
 * Returns `null` — an empty slot — only when there is nothing recognisable
 * there. A record missing its label still loads; the row just reads thinner.
 * The slot id is taken from the *key it was found under*, not from the record,
 * so a hand-edited file cannot make slot 2 claim to be slot 3.
 */
const sanitiseRecord = (slot: SaveSlotId, raw: unknown): StorySaveRecord | null => {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const data = raw as Record<string, unknown>
  const beatId = text(data.beatId, '')
  if (beatId === '') {
    // No beat means nothing to resume to. Whatever else is in the record, this
    // row could never be loaded, so it must not be offered as loadable.
    return null
  }
  const chapter = typeof data.chapter === 'number' && Number.isFinite(data.chapter) ? data.chapter : 1
  return {
    slot,
    savedAt: text(data.savedAt, ''),
    chapter,
    beatId,
    label: text(data.label, ''),
    payload: 'payload' in data ? data.payload : null
  }
}

export const sanitiseStorySave = (raw: unknown): StorySaveTable => {
  const out = emptyTable()
  if (!raw || typeof raw !== 'object') {
    return out
  }
  const data = raw as Record<string, unknown>
  if (data.version !== STORY_SAVE_VERSION) {
    return out
  }
  const slots = data.slots
  if (!slots || typeof slots !== 'object') {
    return out
  }
  const table = slots as Record<string, unknown>
  for (const key of Object.keys(table)) {
    const slot = Number(key)
    if (!isSlot(slot)) {
      continue
    }
    out[slot] = sanitiseRecord(slot, table[key])
  }
  return out
}

const load = (): StorySaveTable => {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORY_SAVE_KEY)
    return sanitiseStorySave(raw ? JSON.parse(raw) : null)
  } catch {
    return emptyTable()
  }
}

/**
 * The live table. Read it; write through `writeSlot` / `clearSlot`.
 *
 * Replaced wholesale on every write rather than mutated, so a `computed` over
 * one slot re-evaluates without anybody needing a deep watcher.
 */
export const saveSlots = ref<StorySaveTable>(load())

/**
 * Returns whether the table reached storage.
 *
 * Two ways it does not: storage throws (sandboxed iframe, quota), or the
 * payload is not JSON-serialisable — a circular object, a `Map`, a three.js
 * node someone reached for by mistake. Both leave the save in memory and
 * correct for this session, and both are worth telling the player about, which
 * is what the return value is for (`menu.saveFailed`).
 */
const persist = (): boolean => {
  try {
    if (typeof localStorage === 'undefined') {
      return false
    }
    localStorage.setItem(STORY_SAVE_KEY, JSON.stringify({ version: STORY_SAVE_VERSION, slots: saveSlots.value }))
    return true
  } catch {
    return false
  }
}

export const readSlot = (slot: SaveSlotId): StorySaveRecord | null => saveSlots.value[slot]

/** True when there is something in the slot to load. */
export const hasSave = (slot: SaveSlotId): boolean => saveSlots.value[slot] !== null

export const writeSlot = (slot: SaveSlotId, record: StorySaveInput): boolean => {
  const stored: StorySaveRecord = {
    slot,
    savedAt: record.savedAt ?? new Date().toISOString(),
    chapter: record.chapter,
    beatId: record.beatId,
    label: record.label,
    payload: record.payload
  }
  saveSlots.value = { ...saveSlots.value, [slot]: stored }
  return persist()
}

export const clearSlot = (slot: SaveSlotId): boolean => {
  saveSlots.value = { ...saveSlots.value, [slot]: null }
  return persist()
}

/** Empties every slot. There if a host wants "New game" to start a clean file. */
export const clearAllSlots = (): boolean => {
  saveSlots.value = emptyTable()
  return persist()
}
