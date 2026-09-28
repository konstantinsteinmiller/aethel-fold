// End-to-end scenario tests for the bulletproof-save protocol. Each
// scenario simulates a real-world failure mode that previously cost
// players progress and asserts that the new strategy + manager
// combination handles it without overwriting cloud data.
//
// All scenarios use the CrazyGames SDK shape; the same logic is
// exercised against Glitch in GlitchStrategy.test.ts.
//
// Castle Fold persists exactly one gameplay entry — the `aethel_state`
// blob, whose fields are the `fold_*` progress keys — plus the META blob.
//
// Fixture rule (why these once hung for 30 s each): a fixture whose
// remote manifest names keys the SDK doesn't return is *not* a returning
// player — the strategy correctly refuses it as `failed-retrying`, the
// local snapshot looks fresh, and `SaveManager.init()` then waits on the
// 1 s boot-sanity sleeps. Under fake timers a bare `await init()` never
// resolves. Every fixture here therefore seeds real `aethel_state`
// progress, and every scenario that can legitimately enter a sleep drives
// the clock while it waits.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CrazyGamesStrategy } from '@/utils/save/CrazyGamesStrategy'
import { SaveManager } from '@/utils/save/SaveManager'
import {
  computeMeta,
  META_KEY,
  SAVE_KEYS,
  serializeMeta
} from '@/utils/save/SaveMergePolicy'
import type { HydrateNotice } from '@/utils/save/types'

const KEYS_MANIFEST = '__save_internal__crazy_keys'
const STATE = SAVE_KEYS.STATE

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

/** Progress fields as `useFoldProgress` writes them into the blob. */
const progress = (cleared: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  [SAVE_KEYS.PAGE]: Math.min(6, cleared + 1),
  [SAVE_KEYS.CLEARED]: cleared,
  [SAVE_KEYS.RUNS]: 2,
  [SAVE_KEYS.LESSONS]: { fold: true },
  ...extra
})

const metaFor = (blob: string, savedAt: string): string =>
  serializeMeta(computeMeta({ get: (k) => (k === STATE ? blob : null) }, savedAt))

/** SDK store contents for a returning player — the state blob, the META
 *  blob, and the manifest that names both. */
const seedReturningPlayer = (fields: Record<string, unknown>, savedAt = '2026-04-26T10:00:00Z') => {
  const blob = JSON.stringify(fields)
  return {
    [KEYS_MANIFEST]: JSON.stringify([META_KEY, STATE]),
    [STATE]: blob,
    [META_KEY]: metaFor(blob, savedAt)
  }
}

const readBlob = (raw: string | null | undefined): Record<string, unknown> =>
  raw ? JSON.parse(raw) as Record<string, unknown> : {}

/** Await `init()` while driving fake time so any sanity-guard / inline
 *  retry sleep resolves instead of hanging the test. */
const initDriven = async (manager: SaveManager, ms: number): Promise<void> => {
  const p = manager.init()
  await vi.advanceTimersByTimeAsync(ms)
  await p
}

describe('Bulletproof save scenarios', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('Scenario 1: returning player — clean hydrate, no boot retries', async () => {
    const seed = seedReturningPlayer(progress(3, { [SAVE_KEYS.WINS]: 1 }))
    const data = makeFakeData(seed)
    const manager = new SaveManager(new CrazyGamesStrategy(() => data))
    // No timer driving: a clean returning-player hydrate must resolve with
    // zero sleeps. If this ever hangs, the boot path started waiting.
    await manager.init()

    expect(window.localStorage.getItem(STATE)).toBe(seed[STATE])
    const blob = readBlob(window.localStorage.getItem(STATE))
    expect(blob[SAVE_KEYS.CLEARED]).toBe(3)
    expect(blob[SAVE_KEYS.WINS]).toBe(1)
    expect(manager.hydrateState).toBe('success-with-data')
    expect(data.getItem.mock.calls.filter(c => c[0] === KEYS_MANIFEST)).toHaveLength(1)
  })

  it('Scenario 2: returning player + transient SDK error — sanity-guard retry recovers', async () => {
    const seed = seedReturningPlayer(progress(3))
    const data = makeFakeData(seed)
    // The first hydrate attempt (manifest + its two inline retries) all
    // throw; the sanity-guard retry 1 s later sees the healthy SDK.
    let manifestCalls = 0
    data.getItem.mockImplementation(async (key: string) => {
      if (key === KEYS_MANIFEST && ++manifestCalls <= 3) throw new Error('transient SDK error')
      return seed[key as keyof typeof seed] ?? null
    })

    const manager = new SaveManager(new CrazyGamesStrategy(() => data))
    await initDriven(manager, 2_000)

    expect(manifestCalls).toBe(4)
    expect(manager.hydrateState).toBe('success-with-data')
    expect(readBlob(window.localStorage.getItem(STATE))[SAVE_KEYS.CLEARED]).toBe(3)
    // Recovery does not echo the cloud's own data back at it.
    expect(data.setItem).not.toHaveBeenCalled()
  })

  it('Scenario 3: returning player + persistent failure — local writes do NOT flush to remote', async () => {
    const data = makeFakeData(seedReturningPlayer(progress(3)))
    data.getItem.mockImplementation(async () => {
      throw new Error('persistent failure')
    })

    const manager = new SaveManager(new CrazyGamesStrategy(() => data))
    // hydrate (2×250 ms inline) + 3 × (1 s guard + 2×250 ms inline) = 5 s
    await initDriven(manager, 6_000)

    expect(manager.hydrateState).toBe('failed-retrying')

    // The game boots on fresh defaults and autosaves them.
    window.localStorage.setItem(STATE, JSON.stringify({ [SAVE_KEYS.PAGE]: 1, [SAVE_KEYS.CLEARED]: 0 }))
    await vi.advanceTimersByTimeAsync(2_000)

    expect(data.setItem).not.toHaveBeenCalled()
  })

  it('Scenario 4: new player — empty remote confirmed, local seeds remote', async () => {
    const data = makeFakeData()
    const manager = new SaveManager(new CrazyGamesStrategy(() => data))
    const initPromise = manager.init()
    await vi.runAllTimersAsync()
    await initPromise

    expect(manager.hydrateState).toBe('success-empty')

    const blob = JSON.stringify({ [SAVE_KEYS.PAGE]: 2, [SAVE_KEYS.CLEARED]: 1, [SAVE_KEYS.RUNS]: 1 })
    window.localStorage.setItem(STATE, blob)
    await vi.runAllTimersAsync()

    expect(data.store.get(STATE)).toBe(blob)
    expect(data.store.get(META_KEY)).toBeTruthy()
    expect(JSON.parse(data.store.get(KEYS_MANIFEST)!)).toEqual([META_KEY, STATE])
  })

  it('Scenario 5: local ahead of remote — local wins, pushed to remote', async () => {
    const data = makeFakeData(seedReturningPlayer(progress(2)))

    const localBlob = JSON.stringify(progress(4))
    window.localStorage.setItem(STATE, localBlob)
    window.localStorage.setItem(META_KEY, metaFor(localBlob, '2026-04-27T10:00:00Z'))

    const manager = new SaveManager(new CrazyGamesStrategy(() => data))
    await manager.init()
    await vi.runAllTimersAsync()

    expect(window.localStorage.getItem(STATE)).toBe(localBlob)
    expect(data.store.get(STATE)).toBe(localBlob)
    expect(readBlob(data.store.get(STATE))[SAVE_KEYS.CLEARED]).toBe(4)
  })

  it('Scenario 6: remote ahead of local — remote wins, NO bonus', async () => {
    const seed = seedReturningPlayer(progress(5, { [SAVE_KEYS.WINS]: 1 }))
    const data = makeFakeData(seed)

    const localBlob = JSON.stringify(progress(1))
    window.localStorage.setItem(STATE, localBlob)
    window.localStorage.setItem(META_KEY, metaFor(localBlob, '2026-04-27T08:00:00Z'))

    const strategy = new CrazyGamesStrategy(() => data)
    const notices: HydrateNotice[] = []
    strategy.onHydrateNotice(n => notices.push(n))
    const manager = new SaveManager(strategy)
    await manager.init()
    await vi.runAllTimersAsync()

    // Local is replaced by the cloud blob verbatim — nothing injected into it.
    expect(window.localStorage.getItem(STATE)).toBe(seed[STATE])
    expect(data.store.get(STATE)).toBe(seed[STATE])
    expect(notices.at(-1)?.state).toBe('success-with-data')
    expect(notices.every(n => !n.bonusCoinsAwarded)).toBe(true)
    // …and the cloud is not rewritten with a merged / bonus-bearing copy.
    expect(data.setItem.mock.calls.filter(c => c[0] === STATE)).toHaveLength(0)
  })

  it('Scenario 7: identical local + remote — tie-keep-local, no re-upload', async () => {
    const seed = seedReturningPlayer(progress(3), '2026-04-27T10:00:00Z')
    const data = makeFakeData(seed)

    window.localStorage.setItem(STATE, seed[STATE])
    window.localStorage.setItem(META_KEY, seed[META_KEY])

    const manager = new SaveManager(new CrazyGamesStrategy(() => data))
    await manager.init()
    await vi.runAllTimersAsync()

    expect(manager.hydrateState).toBe('success-with-data')
    const realWrites = data.setItem.mock.calls.filter(c => c[0] !== KEYS_MANIFEST)
    expect(realWrites).toHaveLength(0)
  })

  it('Scenario 8 (regression test): hydrate failure + module defaults must NOT overwrite remote', async () => {
    const seed = seedReturningPlayer(progress(3, { [SAVE_KEYS.WINS]: 2 }))
    const data = makeFakeData(seed)
    data.getItem.mockImplementation(async () => {
      throw new Error('blip')
    })

    const manager = new SaveManager(new CrazyGamesStrategy(() => data))
    await initDriven(manager, 6_000)

    // What every composable writes at module init on a "fresh" boot.
    window.localStorage.setItem(STATE, JSON.stringify({
      [SAVE_KEYS.PAGE]: 1,
      [SAVE_KEYS.CLEARED]: 0,
      [SAVE_KEYS.WINS]: 0,
      [SAVE_KEYS.LESSONS]: {},
      user_sound_volume: 0.7
    }))
    window.localStorage.setItem(META_KEY, metaFor('{}', '2026-09-01T00:00:00Z'))
    await vi.advanceTimersByTimeAsync(2_000)

    expect(data.store.get(STATE)).toBe(seed[STATE])
    expect(data.store.get(META_KEY)).toBe(seed[META_KEY])
    expect(data.setItem).not.toHaveBeenCalled()
  })
})
