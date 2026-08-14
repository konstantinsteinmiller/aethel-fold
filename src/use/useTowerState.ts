import { ref, type Ref } from 'vue'

/**
 * ─── `tower_state` — the single persisted state object ───────────────────────
 *
 * EVERY persisted value 3d-world touches — meta progression, the resumable
 * run snapshot, user settings, retention bookkeeping — lives inside ONE
 * in-memory record (`towerState`), and exactly ONE localStorage key is ever
 * written: `tower_state`.
 *
 * Why one object:
 *   • Non-platform builds → a single localStorage entry, zero pollution.
 *   • Platform builds → `SaveManager` proxies `localStorage.setItem`, so the
 *     cloud payload is literally `{ tower_state, __save_meta__ }`. One object
 *     round-trips to CrazyGames `sdk.data` / GamePix / Playgama / Yandex /
 *     Glitch instead of dozens of per-key writes.
 *
 * Field names inside the record are catalogued in `src/keys.ts` and are all
 * `ts_`-prefixed. They are a contract with the player base: renaming one
 * strands existing players' progress on the old field.
 *
 * Writes are debounced (trailing edge, hard-capped) and hard-flushed on
 * `pagehide` / tab-hide so a close mid-burst never drops data.
 */

export const STATE_KEY = 'tower_state'

/** Persisted values may be bare strings ("en"), stringified numbers ("120"),
 *  or stringified JSON. JSON.parse round-trips numbers/objects; bare strings
 *  throw, so we fall back to the raw value. Used by the one-shot fold of any
 *  stray individual key into the blob. */
const tryParse = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

const persistRaw = (blob: Record<string, any>): void => {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(blob))
  } catch { /* quota / private mode — in-memory state is still authoritative */ }
}

// ─── Debounced write batching ───────────────────────────────────────────────
// The in-memory update is synchronous (consumers expect the new value to be
// readable immediately), but the actual localStorage persist is coalesced into
// a single trailing-edge write after PERSIST_DEBOUNCE_MS of quiet, with a hard
// cap so a continuous stream (resources ticking every wave) still flushes
// roughly every PERSIST_MAX_WAIT_MS.
const PERSIST_DEBOUNCE_MS = 200
const PERSIST_MAX_WAIT_MS = 2500
let persistTimer: ReturnType<typeof setTimeout> | null = null
let firstDirtyAt = 0

/** Force the debounced blob write to happen NOW — cancels the pending timer and
 *  writes `tower_state` to localStorage synchronously. Called from the
 *  page-hide handlers below and (via `useSaveStatus.flushSaveNow`) at hard
 *  checkpoints (wave cleared, run ended, tech purchased) so the cloud push
 *  starts immediately instead of waiting out the debounce. */
export const flushPersist = (): void => {
  if (persistTimer != null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  firstDirtyAt = 0
  persistRaw(towerState.value)
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
    persistRaw(towerState.value)
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
  let blob: Record<string, any> = {}

  // Load the consolidated blob if a previous run (or a cloud hydrate) already
  // wrote it. On platform builds `localStorage.getItem` is the SaveManager
  // proxy at this point, so this read already sees cloud-hydrated data.
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        blob = parsed as Record<string, any>
      }
    }
  } catch { /* corrupt → start fresh */ }

  // Generic fold: if a player somehow has individual `ts_*` entries in raw
  // localStorage (defensive per-key write, or a mid-migration snapshot from an
  // older client), fold them into the blob once and remove them. The blob takes
  // precedence when both exist.
  let migrated = false
  try {
    const stragglers: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('ts_')) stragglers.push(k)
    }
    for (const k of stragglers) {
      const raw = localStorage.getItem(k)
      if (raw === null) continue
      if (!(k in blob)) blob[k] = tryParse(raw)
      try { localStorage.removeItem(k) } catch { /* harmless */ }
      migrated = true
    }
  } catch { /* harmless */ }

  if (migrated) persistRaw(blob)
  return blob
}

/** The single in-memory aggregate of all persisted game state.
 *  `Record<string, any>` by design — this is a heterogeneous bag keyed by the
 *  constants in `src/keys.ts`; consumers narrow via `getState<T>()`. */
export const towerState: Ref<Record<string, any>> = ref(buildInitial())

/** Read a value out of the blob. `fallback` is returned when the key is absent.
 *  The type parameter is advisory — the layer does not validate shape. */
export const getState = <T = unknown>(key: string, fallback?: T): T => {
  const v = towerState.value[key]
  return (v === undefined ? fallback : v) as T
}

export const hasState = (key: string): boolean => towerState.value[key] !== undefined

export const setState = (key: string, value: unknown): void => {
  // Replace the record identity so `watch(towerState)` (shallow) fires for every
  // consumer that mirrors a field into its own ref.
  towerState.value = { ...towerState.value, [key]: value }
  schedulePersist()
}

/** Batch-write several fields with ONE reactive identity change and ONE persist
 *  schedule. Used by the run-snapshot writer, which touches half a dozen keys
 *  at each wave boundary and would otherwise fan out six watcher passes. */
export const setStates = (patch: Record<string, unknown>): void => {
  towerState.value = { ...towerState.value, ...patch }
  schedulePersist()
}

export const removeState = (key: string): void => {
  if (towerState.value[key] === undefined) return
  const next = { ...towerState.value }
  delete next[key]
  towerState.value = next
  schedulePersist()
}

/** Re-read from localStorage. Called by the SaveManager hydrate bridge
 *  (`useSaveStatus.bumpSaveDataVersion`) so cloud-sourced updates land
 *  in-memory BEFORE any composable's `saveDataVersion` watcher re-reads its
 *  keys — the ordering is load-bearing for correct hydration. */
export const reloadTowerState = (): void => {
  towerState.value = buildInitial()
}

/** Test-only: wipe both the in-memory blob and the persisted entry. */
export const __resetTowerState = (): void => {
  towerState.value = {}
  try { localStorage.removeItem(STATE_KEY) } catch { /* harmless */ }
}
