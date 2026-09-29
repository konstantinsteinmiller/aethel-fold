import { ref, type Ref } from 'vue'

/**
 * ─── `aethel_state` — the single persisted state object ──────────────────────
 *
 * EVERY persisted value Aethel Fold touches — the page to resume on, the run
 * checkpoint, records, the wordless lessons already learned, lifetime stats
 * and the player's settings — lives inside ONE in-memory record
 * (`aethelState: Record<string, any>`), and exactly ONE localStorage key is
 * ever written: `aethel_state`.
 *
 * Why one object:
 *   • Non-platform builds → a single localStorage entry, zero pollution.
 *   • Platform builds → `SaveManager` proxies `localStorage.setItem`, so the
 *     cloud payload is literally `{ aethel_state, __save_meta__ }`. One object
 *     round-trips to CrazyGames `sdk.data` / GamePix / Playgama / Yandex /
 *     Glitch instead of dozens of per-key writes.
 *
 * Field names inside the record are catalogued in `src/keys.ts`. They are a
 * contract with the player base: renaming one strands existing players'
 * progress on the old field.
 *
 * Hydration: on platform builds `main.ts` awaits `SaveManager.init()` (the
 * cloud read) before anything reads the blob for gameplay, then calls
 * `reloadAethelState()` so the in-memory object is the *hydrated* one. Every
 * consumer also re-reads on `saveDataVersion` (useSaveStatus) so a cloud
 * recovery that lands later (retry ladder) replaces a transient empty read —
 * a slow SDK can never leave the game running as a false "fresh user".
 *
 * Writes are debounced (trailing edge, hard-capped) and hard-flushed on
 * `pagehide` / tab-hide so a close mid-burst never drops data.
 */

export const STATE_KEY = 'aethel_state'

const persistRaw = (blob: Record<string, any>): void => {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(blob))
  } catch { /* quota / private mode — in-memory state is still authoritative */ }
}

// ─── Debounced write batching ───────────────────────────────────────────────
const PERSIST_DEBOUNCE_MS = 200
const PERSIST_MAX_WAIT_MS = 2500
let persistTimer: ReturnType<typeof setTimeout> | null = null
let firstDirtyAt = 0

/** Force the debounced blob write to happen NOW. Called on page-hide and (via
 *  `useSaveStatus.flushSaveNow`) at hard checkpoints (page cleared, victory)
 *  so the cloud push starts immediately instead of waiting out the debounce. */
export const flushPersist = (): void => {
  if (persistTimer != null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  firstDirtyAt = 0
  persistRaw(aethelState.value)
}

const schedulePersist = (): void => {
  const now = Date.now()
  if (firstDirtyAt === 0) firstDirtyAt = now
  if (persistTimer != null) clearTimeout(persistTimer)
  const remaining = PERSIST_MAX_WAIT_MS - (now - firstDirtyAt)
  const delay = Math.max(0, Math.min(PERSIST_DEBOUNCE_MS, remaining))
  persistTimer = setTimeout(() => {
    persistTimer = null
    firstDirtyAt = 0
    persistRaw(aethelState.value)
  }, delay)
}

if (typeof window !== 'undefined') {
  const onHide = () => flushPersist()
  window.addEventListener('pagehide', onHide)
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPersist()
  })
}

const buildInitial = (): Record<string, any> => {
  // On platform builds `localStorage.getItem` is the SaveManager proxy at this
  // point, so this read already sees cloud-hydrated data.
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, any>
    }
  } catch { /* corrupt → start fresh */ }
  return {}
}

/** The single in-memory aggregate of all persisted game state. */
export const aethelState: Ref<Record<string, any>> = ref(buildInitial())

/** Read a value out of the blob. `fallback` is returned when the key is absent. */
export const getState = <T = unknown>(key: string, fallback?: T): T => {
  const v = aethelState.value[key]
  return (v === undefined ? fallback : v) as T
}

export const hasState = (key: string): boolean => aethelState.value[key] !== undefined

export const setState = (key: string, value: unknown): void => {
  // Replace the record identity so `watch(aethelState)` (shallow) fires for
  // every consumer that mirrors a field into its own ref.
  aethelState.value = { ...aethelState.value, [key]: value }
  schedulePersist()
}

/** Batch-write several fields with ONE reactive identity change and ONE persist. */
export const setStates = (patch: Record<string, unknown>): void => {
  aethelState.value = { ...aethelState.value, ...patch }
  schedulePersist()
}

export const removeState = (key: string): void => {
  if (aethelState.value[key] === undefined) return
  const next = { ...aethelState.value }
  delete next[key]
  aethelState.value = next
  schedulePersist()
}

/** Re-read from localStorage. Called by the SaveManager hydrate bridge
 *  (`useSaveStatus.bumpSaveDataVersion`) so cloud-sourced updates land
 *  in-memory BEFORE any composable's `saveDataVersion` watcher re-reads its
 *  keys — the ordering is load-bearing for correct hydration. */
export const reloadAethelState = (): void => {
  aethelState.value = buildInitial()
}

/** Test-only: wipe both the in-memory blob and the persisted entry. */
export const __resetAethelState = (): void => {
  aethelState.value = {}
  try { localStorage.removeItem(STATE_KEY) } catch { /* harmless */ }
}
