import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CrazyGamesStrategy } from '@/utils/save/CrazyGamesStrategy'
import { SaveManager } from '@/utils/save/SaveManager'
import { SAVE_KEYS, META_KEY, computeMeta, serializeMeta } from '@/utils/save/SaveMergePolicy'

// Fake CrazyGames `data` module — keeps an in-memory map so we can assert
// on what got mirrored. The real SDK API is a subset we can fully cover
// here (`getItem` / `setItem` / `removeItem`).
const makeFakeData = (seed: Record<string, string> = {}) => {
  const store = new Map<string, string>(Object.entries(seed))
  return {
    store,
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key)
    })
  }
}

const MANIFEST_KEY = '__save_internal__crazy_keys'
const STATE = SAVE_KEYS.STATE

/** The single persisted blob, as `useAethelState` writes it. */
const blob = (fields: Record<string, unknown>): string => JSON.stringify(fields)
const metaFor = (state: string, savedAt = '2025-01-01T00:00:00.000Z'): string =>
  serializeMeta(computeMeta({ get: k => (k === STATE ? state : null) }, savedAt))

/** Cloud contents of a returning player: blob + META + manifest naming both. */
const cloudSave = (state: string): Record<string, string> => ({
  [MANIFEST_KEY]: JSON.stringify([META_KEY, STATE]),
  [STATE]: state,
  [META_KEY]: metaFor(state)
})

const PROGRESS = blob({
  [SAVE_KEYS.PAGE]: 4,
  [SAVE_KEYS.CLEARED]: 3,
  [SAVE_KEYS.RUNS]: 2,
  [SAVE_KEYS.LESSONS]: { fold: true, tear: true },
  user_sound_volume: 0.5
})

const initWithFakeTimers = async (manager: SaveManager) => {
  const p = manager.init()
  await vi.runAllTimersAsync()
  await p
}

describe('CrazyGamesStrategy (per-key)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('hydrates localStorage from the SDK manifest at boot', async () => {
    const data = makeFakeData(cloudSave(PROGRESS))
    const manager = new SaveManager(new CrazyGamesStrategy(() => data))
    await initWithFakeTimers(manager)

    expect(manager.hydrateState).toBe('success-with-data')
    expect(window.localStorage.getItem(STATE)).toBe(PROGRESS)
    expect(JSON.parse(window.localStorage.getItem(STATE)!)[SAVE_KEYS.CLEARED]).toBe(3)
  })

  it('mirrors subsequent writes to the SDK after a debounce, sorted', async () => {
    const data = makeFakeData()
    const manager = new SaveManager(new CrazyGamesStrategy(() => data))
    await initWithFakeTimers(manager)

    const state = blob({ [SAVE_KEYS.PAGE]: 2, [SAVE_KEYS.CLEARED]: 1 })
    window.localStorage.setItem(STATE, state)

    expect(data.setItem).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()

    // Per-key writes plus the manifest. The state blob and META both land.
    const writes = data.setItem.mock.calls.filter(c => c[0] !== MANIFEST_KEY)
    expect(writes).toContainEqual([STATE, state])
    expect(writes.map(c => c[0])).toContain(META_KEY)

    // Wire ordering is sorted alphabetically.
    const orderedKeys = writes.map(c => c[0])
    expect(orderedKeys).toEqual([...orderedKeys].sort())

    // Manifest carries the full sorted key list — and nothing else of ours.
    expect(JSON.parse(data.store.get(MANIFEST_KEY)!)).toEqual([META_KEY, STATE])
  })

  it('does NOT mirror non-allowlisted keys (vConsole / ad-tech / dev flags / per-field names)', async () => {
    const data = makeFakeData()
    const manager = new SaveManager(new CrazyGamesStrategy(() => data))
    await initWithFakeTimers(manager)

    window.localStorage.setItem(STATE, blob({ [SAVE_KEYS.RUNS]: 1 }))
    window.localStorage.setItem('vConsole_switch_x', '0')
    window.localStorage.setItem('prebid11_exp_1_26', 'false')
    window.localStorage.setItem('li-module-enabled', 'true')
    window.localStorage.setItem(SAVE_KEYS.CLEARED, '6')
    window.localStorage.setItem('tower_state', '{}')

    await vi.runAllTimersAsync()

    const writes = data.setItem.mock.calls.map(c => c[0])
    expect(new Set(writes)).toEqual(new Set([STATE, META_KEY, MANIFEST_KEY]))
  })

  it('mirrors removeItem to the SDK and drops the key from the manifest', async () => {
    const data = makeFakeData(cloudSave(PROGRESS))
    const manager = new SaveManager(new CrazyGamesStrategy(() => data))
    await initWithFakeTimers(manager)

    window.localStorage.removeItem(STATE)
    await vi.runAllTimersAsync()

    expect(data.removeItem).toHaveBeenCalledWith(STATE)
    expect(data.store.has(STATE)).toBe(false)
    expect(JSON.parse(data.store.get(MANIFEST_KEY)!)).not.toContain(STATE)
  })

  it('no-ops gracefully when the SDK is unavailable', async () => {
    const manager = new SaveManager(new CrazyGamesStrategy(() => null))
    await initWithFakeTimers(manager)

    const state = blob({ [SAVE_KEYS.RUNS]: 1 })
    expect(() => window.localStorage.setItem(STATE, state)).not.toThrow()
    await vi.runAllTimersAsync()
    expect(window.localStorage.getItem(STATE)).toBe(state)
  })

  it('flush() pushes pending writes synchronously on demand', async () => {
    const data = makeFakeData()
    const manager = new SaveManager(new CrazyGamesStrategy(() => data))
    await initWithFakeTimers(manager)

    const state = blob({ [SAVE_KEYS.RUNS]: 1 })
    window.localStorage.setItem(STATE, state)
    expect(data.setItem).not.toHaveBeenCalled()

    await manager.flush()

    expect(data.setItem).toHaveBeenCalledWith(STATE, state)
  })

  it('does not mirror hydration writes back to the SDK', async () => {
    const data = makeFakeData(cloudSave(PROGRESS))
    const manager = new SaveManager(new CrazyGamesStrategy(() => data))
    await initWithFakeTimers(manager)

    expect(data.setItem).not.toHaveBeenCalled()
  })

  it('META blob rides along with each flush so the next hydrate can merge', async () => {
    const data = makeFakeData()
    const manager = new SaveManager(new CrazyGamesStrategy(() => data))
    await initWithFakeTimers(manager)

    window.localStorage.setItem(STATE, blob({ [SAVE_KEYS.CLEARED]: 4, [SAVE_KEYS.WINS]: 1 }))
    await vi.runAllTimersAsync()

    expect(data.store.get(META_KEY)).toBeTruthy()
    const meta = JSON.parse(data.store.get(META_KEY)!)
    expect(meta.savedAt).toBeTruthy()
    expect(meta.maxStage).toBe(4)
    expect(meta.progressScore).toBe(4000 + 5000)
  })

  // ─── Settings-stranding regression ──────────────────────────────────────
  // Background: useUser.ts holds sound / music volume in module-level refs
  // and only writes them when the player changes them — or, on the first
  // saveDataVersion bump, seeds the defaults into the blob. A player who
  // never touches settings may therefore have a local blob the cloud has
  // never seen. To round-trip correctly the strategy MUST sweep local
  // payload keys after the merge resolution and queue any value missing
  // from sdk.data.

  it('pushes a local blob (settings only) that is missing from sdk.data', async () => {
    // Simulates useUser.ts having seeded its current ref values into the
    // blob just before the strategy runs. Cloud is empty.
    const state = blob({ user_sound_volume: 0.7, user_music_volume: 0.6, user_language: 'en' })
    window.localStorage.setItem(STATE, state)

    const data = makeFakeData()
    const manager = new SaveManager(new CrazyGamesStrategy(() => data))
    await initWithFakeTimers(manager)

    expect(data.setItem).toHaveBeenCalledWith(STATE, state)
    // Manifest carries the blob — next refresh's hydrate reads it back.
    expect(JSON.parse(data.store.get(MANIFEST_KEY)!)).toEqual([META_KEY, STATE])
  })

  it('does NOT re-push a blob that already matches sdk.data', async () => {
    // Player previously synced — both sides agree. The post-hydrate sweep
    // should dedupe via lastSentByKey and skip a redundant flush so QA
    // doesn't see spurious writes on every load.
    const seed = cloudSave(PROGRESS)
    window.localStorage.setItem(STATE, seed[STATE]!)
    window.localStorage.setItem(META_KEY, seed[META_KEY]!)

    const data = makeFakeData(seed)
    const manager = new SaveManager(new CrazyGamesStrategy(() => data))
    await initWithFakeTimers(manager)

    expect(data.setItem).not.toHaveBeenCalled()
  })

  it('on a fresh-remote hydrate, seeds sdk.data with the local blob', async () => {
    // Cloud is fresh (no manifest). Local has progress + settings from the
    // last session. The player's first cloud save must be complete.
    window.localStorage.setItem(STATE, PROGRESS)

    const data = makeFakeData()
    const manager = new SaveManager(new CrazyGamesStrategy(() => data))
    await initWithFakeTimers(manager)

    expect(manager.hydrateState).toBe('success-empty')
    expect(data.store.get(STATE)).toBe(PROGRESS)
    expect(JSON.parse(data.store.get(META_KEY)!).maxStage).toBe(3)
  })

  // ─── Cloud-only mode (CG QA requirement) ────────────────────────────────
  // Requirement: on CrazyGames builds, gameplay state (`aethel_state`) and
  // our save bookkeeping ("__save_internal__*", "__save_meta__") MUST NOT
  // live in raw localStorage. Only "fps", "debug", "cheat",
  // "campaign-test", "full_unlocked" (developer toggles touched from
  // DevTools) are exempt. Persistence is sdk.data only; localStorage is a
  // runtime cache served from BlobStorage's in-memory map.

  it('cloud-only mode: payload writes never land in raw localStorage', async () => {
    // Capture un-patched accessor BEFORE SaveManager replaces it on the
    // window.localStorage instance — test setup uses an in-memory
    // polyfill, so we read via the prototype to bypass the patched proxy.
    const proto = Object.getPrototypeOf(window.localStorage)
    const rawGet = proto.getItem.bind(window.localStorage)

    const data = makeFakeData()
    const manager = new SaveManager(
      new CrazyGamesStrategy(() => data),
      window.localStorage,
      { blob: { persistToRaw: false } }
    )
    await initWithFakeTimers(manager)

    window.localStorage.setItem(STATE, PROGRESS)
    await vi.runAllTimersAsync()

    // sdk.data has the values.
    expect(data.store.get(STATE)).toBe(PROGRESS)
    expect(data.store.get(META_KEY)).toBeTruthy()

    // Raw localStorage is empty of every gameplay + bookkeeping key.
    expect(rawGet(STATE)).toBeNull()
    expect(rawGet(MANIFEST_KEY)).toBeNull()
    expect(rawGet(META_KEY)).toBeNull()
  })

  it('cloud-only mode: dev toggles ARE preserved in raw localStorage', async () => {
    const proto = Object.getPrototypeOf(window.localStorage)
    const rawGet = proto.getItem.bind(window.localStorage)

    // Dev toggles set before SaveManager constructs.
    window.localStorage.setItem('fps', 'true')
    window.localStorage.setItem('debug', 'true')
    window.localStorage.setItem('cheat', 'true')
    window.localStorage.setItem('campaign-test', '1')
    window.localStorage.setItem('full_unlocked', 'true')

    const data = makeFakeData()
    const manager = new SaveManager(
      new CrazyGamesStrategy(() => data),
      window.localStorage,
      { blob: { persistToRaw: false } }
    )
    await initWithFakeTimers(manager)

    expect(rawGet('fps')).toBe('true')
    expect(rawGet('debug')).toBe('true')
    expect(rawGet('cheat')).toBe('true')
    expect(rawGet('campaign-test')).toBe('1')
    expect(rawGet('full_unlocked')).toBe('true')

    // And subsequent writes to dev toggles still land in raw.
    window.localStorage.setItem('debug', 'false')
    expect(rawGet('debug')).toBe('false')
  })

  it('cloud-only mode: scrubs pre-existing payload + bookkeeping at boot, preserves dev toggles', async () => {
    // Simulates upgrading a returning player from raw-mirror mode to
    // cloud-only mode: their localStorage already has the state blob, the
    // META blob, and the manifest. After construction every
    // gameplay/bookkeeping key must be gone from raw, but the values must
    // survive in BlobStorage's in-memory state so the hydrate's local meta
    // still computes from real values.
    window.localStorage.setItem(STATE, PROGRESS)
    window.localStorage.setItem(META_KEY, metaFor(PROGRESS))
    window.localStorage.setItem(MANIFEST_KEY, JSON.stringify([META_KEY, STATE]))
    window.localStorage.setItem('fps', 'true')

    const proto = Object.getPrototypeOf(window.localStorage)
    const rawGet = proto.getItem.bind(window.localStorage)

    const data = makeFakeData()
    const manager = new SaveManager(
      new CrazyGamesStrategy(() => data),
      window.localStorage,
      { blob: { persistToRaw: false } }
    )
    await initWithFakeTimers(manager)

    // Raw is scrubbed of all payload + bookkeeping keys.
    expect(rawGet(STATE)).toBeNull()
    expect(rawGet(META_KEY)).toBeNull()
    expect(rawGet(MANIFEST_KEY)).toBeNull()
    // Dev toggle preserved.
    expect(rawGet('fps')).toBe('true')

    // Values readable via the patched accessor (in-memory state),
    // and forwarded to sdk.data on the next flush.
    expect(window.localStorage.getItem(STATE)).toBe(PROGRESS)
    expect(data.store.get(STATE)).toBe(PROGRESS)
  })

  it('cloud-only mode: saveDataVersion bumps AFTER patchLocalStorage, not during hydrate', async () => {
    // Regression for the timing bug: composables (useUser, useFoldProgress,
    // etc.) watch `saveDataVersion` and re-read state when it bumps. If the
    // bump fires DURING hydrate, the watcher runs before
    // `patchLocalStorage()` installs the BlobStorage proxy — every read
    // hits raw localStorage (empty in cloud-only mode after the boot
    // scrub) and every write lands in raw too. The fix bumps
    // `saveDataVersion` from `SaveManager.init()` AFTER patches.
    const data = makeFakeData(cloudSave(PROGRESS))
    const manager = new SaveManager(
      new CrazyGamesStrategy(() => data),
      window.localStorage,
      { blob: { persistToRaw: false } }
    )

    let observedHydratedAtBump: boolean | null = null
    let observedStateAtBump: string | null = null
    manager.onBootComplete(() => {
      observedHydratedAtBump = manager.isHydrated()
      observedStateAtBump = window.localStorage.getItem(STATE)
    })

    await initWithFakeTimers(manager)

    expect(observedHydratedAtBump).toBe(true)
    expect(observedStateAtBump).toBe(PROGRESS)
  })

  it('cloud-only mode: a write after refresh does NOT shrink the cloud manifest', async () => {
    // Regression for the manifest-overwrite bug: in cloud-only mode the
    // manifest lives in BlobStorage's internalShadow. On a fresh page load
    // the shadow is empty until hydrate syncs the cloud manifest into it.
    // Without that sync, `trackKey` reads `[]`, the first write produces a
    // single-key manifest, and `doFlush` uploads it, orphaning every other
    // key on sdk.data.
    const seed = cloudSave(PROGRESS)
    const data = makeFakeData(seed)
    const manager = new SaveManager(
      new CrazyGamesStrategy(() => data),
      window.localStorage,
      { blob: { persistToRaw: false } }
    )
    await initWithFakeTimers(manager)

    // The cloud manifest was synced into the shadow by hydrate.
    expect(window.localStorage.getItem(MANIFEST_KEY)).toBe(seed[MANIFEST_KEY])

    // Player switches language to French.
    const next = blob({ ...JSON.parse(PROGRESS), user_language: 'fr' })
    window.localStorage.setItem(STATE, next)
    await vi.runAllTimersAsync()

    // Cloud still has every key — none orphaned.
    expect(data.store.get(STATE)).toBe(next)
    expect(data.store.get(META_KEY)).toBeTruthy()
    expect(JSON.parse(data.store.get(MANIFEST_KEY)!)).toEqual([META_KEY, STATE])
  })
})
