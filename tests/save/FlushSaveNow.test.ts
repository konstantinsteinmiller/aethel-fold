import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── flushSaveNow — immediate checkpoint flush (the CG "stage lost on reload"
// regression) ──────────────────────────────────────────────────────────────
//
// On the CrazyGames cloud-only build, a cleared page writes the new progress into
// `aethel_state`, but the push to `sdk.data` only fires after the persist (~200ms)
// + strategy-flush (~250ms) debounces, and the async cloud write then takes
// time to land. A player who clears a page and reloads a moment later beat that
// pipeline → the reload restored the OLD page.
//
// `flushSaveNow()` (called at every hard checkpoint) forces the whole pipeline to
// drain synchronously-as-possible: write `aethel_state` now → SaveManager proxy →
// strategy dirty → `manager.flush()` → backend. This test proves a checkpoint write
// reaches the (fake) backend right after `flushSaveNow()` WITHOUT advancing any
// timers — i.e. it does not wait for either debounce.

const STATE_KEY = 'aethel_state'
// Fields inside the blob (see `src/keys.ts`).
const CLEARED = 'fold_cleared'
const PAGE = 'fold_page'
const BEST = 'fold_best'

const makeFakeData = (seed: Record<string, string> = {}) => {
  const store = new Map<string, string>(Object.entries(seed))
  return {
    store,
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { store.set(key, value) }),
    removeItem: vi.fn(async (key: string) => { store.delete(key) })
  }
}

const bootCloudOnly = async (data: ReturnType<typeof makeFakeData>) => {
  const { SaveManager } = await import('@/utils/save/SaveManager')
  const { CrazyGamesStrategy } = await import('@/utils/save/CrazyGamesStrategy')
  const { installSaveStatus } = await import('@/use/useSaveStatus')
  const manager = new SaveManager(
    new CrazyGamesStrategy(() => data),
    window.localStorage,
    { blob: { persistToRaw: false } }
  )
  installSaveStatus(manager)
  await manager.init()
  return manager
}

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

describe('flushSaveNow — immediate flush on a hard checkpoint', () => {
  it('pushes a pending page write to the backend without waiting for the debounce', async () => {
    const data = makeFakeData()
    await bootCloudOnly(data)

    const { setState } = await import('@/use/useAethelState')
    const { flushSaveNow } = await import('@/use/useSaveStatus')

    // A cleared page writes the new progress into aethel_state (still sitting
    // on the debounce timers — nothing has reached the cloud yet).
    setState(CLEARED, 2)
    expect(data.store.get(STATE_KEY)).toBeUndefined()

    // The checkpoint flush drains everything immediately — no fake timers.
    await flushSaveNow()

    const cloudBlob = JSON.parse(data.store.get(STATE_KEY) || '{}')
    expect(cloudBlob[CLEARED]).toBe(2)
  })

  it('also carries coexisting progress (records, resume page) written in the same checkpoint', async () => {
    const data = makeFakeData()
    await bootCloudOnly(data)

    const { setState } = await import('@/use/useAethelState')
    const { flushSaveNow } = await import('@/use/useSaveStatus')

    setState(BEST, { score: 250, time: 0 })
    setState(PAGE, 4)
    setState(CLEARED, 3)
    await flushSaveNow()

    const cloudBlob = JSON.parse(data.store.get(STATE_KEY) || '{}')
    expect(cloudBlob[CLEARED]).toBe(3)
    expect(cloudBlob[PAGE]).toBe(4)
    expect(cloudBlob[BEST]).toEqual({ score: 250, time: 0 })
  })
})

// A short tick that lets a fire-and-forget `void flushSaveNow()` async chain
// settle WITHOUT advancing far enough to trip the 200ms persist debounce — so
// anything in the cloud after it got there via the immediate checkpoint flush,
// not the throttle.
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('discrete progression events flush to the backend immediately', () => {
  it('clearing a page (the resume checkpoint) flushes without waiting for the debounce', async () => {
    const data = makeFakeData()
    await bootCloudOnly(data)
    const prog = await import('@/use/useFoldProgress')

    // `pageCleared` for page 2 → resume on page 3, two pages cleared.
    prog.checkpoint(3, { score: 1840, hits: 1, time: 95.44 }, 2)
    await settle()

    const blob = JSON.parse(data.store.get(STATE_KEY) || '{}')
    expect(blob[PAGE]).toBe(3)
    expect(blob[CLEARED]).toBe(2)
    expect(blob.fold_run).toEqual({ score: 1840, hits: 1, time: 95.4 })
  })

  it('finishing a run flushes the new records immediately', async () => {
    const data = makeFakeData()
    await bootCloudOnly(data)
    const prog = await import('@/use/useFoldProgress')

    prog.recordVictory(9120, 612.3)
    await settle()

    const blob = JSON.parse(data.store.get(STATE_KEY) || '{}')
    expect(blob[BEST]).toEqual({ score: 9120, time: 612.3 })
    expect(blob.fold_wins).toBe(1)
    expect(blob[CLEARED]).toBe(6)
  })
})
