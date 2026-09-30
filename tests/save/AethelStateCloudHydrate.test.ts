import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

// ─── Cloud → composable hydrate (the "fresh user" regression) ───────────────
//
// THE BUG THIS FILE EXISTS TO PREVENT:
//   A returning player reloads. The platform SDK's cloud read is async. The
//   Vue module graph evaluates first, every composable reads an empty blob and
//   initialises to defaults, and the player is rendered as a brand-new install:
//   page 1, nothing cleared, no records, no lessons. The next write then
//   commits those defaults over the real cloud save and the loss becomes
//   permanent.
//
// The whole game state lives in ONE `aethel_state` blob (an allowlisted
// payload key), so the strategy mirrors it verbatim. `reloadAethelState()` is
// wired into the `saveDataVersion` bump inside `useSaveStatus` — and the ORDER
// matters: the blob must be re-read BEFORE the bump, or every
// `watch(saveDataVersion)` consumer re-reads the stale pre-hydrate snapshot and
// the bug survives.

const MANIFEST_KEY = '__save_internal__crazy_keys'
const STATE_KEY = 'aethel_state'

const makeFakeData = (seed: Record<string, string> = {}) => {
  const store = new Map<string, string>(Object.entries(seed))
  return {
    store,
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { store.set(key, value) }),
    removeItem: vi.fn(async (key: string) => { store.delete(key) })
  }
}

const flush = async (): Promise<void> => { await nextTick(); await nextTick() }

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

/** A cloud snapshot for a player who is deep into the game, plus the meta blob
 *  the merge resolver needs in order to pick remote over an empty local. */
const seededCloud = async (extra: Record<string, unknown> = {}) => {
  const { META_KEY } = await import('@/utils/save/SaveMergePolicy')
  const cloudBlob = {
    fold_page: 4,
    fold_cleared: 3,
    fold_best: { score: 8450, time: 0 },
    fold_wins: 1,
    fold_runs: 9,
    fold_lessons: { swipe: true, stamp: true, shield: true },
    fold_stats: { launched: 42, crushed: 17, torn: 6, folds: 88, stamps: 31, blocks: 12 },
    fold_settings: { haptics: false, shake: true, quality: 'low' },
    fold_run: { score: 5120, hits: 2, time: 410.5 },
    user_sound_volume: 0.4,
    user_language: 'es',
    ...extra
  }
  const meta = {
    savedAt: '2026-05-19T00:00:00.000Z',
    // cleared 3 × 1000 + wins 1 × 5000 + 3 lessons × 50 + (page 4 − 1) × 100 + runs 9 × 10
    progressScore: 3 * 1000 + 1 * 5000 + 3 * 50 + 3 * 100 + 9 * 10,
    schemaVersion: 1,
    maxStage: 3
  }
  return makeFakeData({
    [MANIFEST_KEY]: JSON.stringify([STATE_KEY, META_KEY]),
    [STATE_KEY]: JSON.stringify(cloudBlob),
    [META_KEY]: JSON.stringify(meta)
  })
}

/** Boot the CrazyGames cloud-only configuration: gameplay state lives in memory
 *  only and `sdk.data` is the sole persistence backend. */
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
  await flush()
  return manager
}

describe('aethel_state cloud hydrate → composable refresh', () => {
  it('hydrates the blob into localStorage before the app graph reads it', async () => {
    const data = await seededCloud()
    await bootCloudOnly(data)

    const blob = JSON.parse(window.localStorage.getItem(STATE_KEY) || '{}')
    expect(blob.fold_cleared).toBe(3)
    expect(blob.fold_page).toBe(4)
    expect(blob.fold_best).toEqual({ score: 8450, time: 0 })
  })

  it('refreshes the progress composable — the player is NOT a fresh user', async () => {
    const data = await seededCloud()
    await bootCloudOnly(data)

    const p = await import('@/use/useFoldProgress')
    expect(p.resumePage.value).toBe(4)
    expect(p.pagesCleared.value).toBe(3)
    expect(p.records.value).toEqual({ score: 8450, time: 0 })
    expect(p.hasProgress()).toBe(true)
  })

  it('refreshes a progress composable that was evaluated BEFORE the cloud read landed', async () => {
    // The real boot order: the module graph (and its refs) evaluates against
    // an empty blob, THEN the SDK read completes. The `saveDataVersion` bump
    // must reload the blob and re-read every ref, or the player boots fresh.
    const p = await import('@/use/useFoldProgress')
    expect(p.pagesCleared.value).toBe(0)
    expect(p.hasProgress()).toBe(false)

    const data = await seededCloud()
    await bootCloudOnly(data)

    expect(p.resumePage.value).toBe(4)
    expect(p.pagesCleared.value).toBe(3)
    expect(p.records.value.score).toBe(8450)
    expect(p.runs.value).toBe(9)
    expect(p.lessons.value).toEqual({ swipe: true, stamp: true, shield: true })
    expect(p.runCheckpoint.value).toEqual({ score: 5120, hits: 2, time: 410.5 })
    expect(p.hasProgress()).toBe(true)
  })

  it('refreshes lessons, wins, runs and every lifetime counter', async () => {
    const data = await seededCloud()
    await bootCloudOnly(data)

    const p = await import('@/use/useFoldProgress')
    expect(p.wins.value).toBe(1)
    expect(p.runs.value).toBe(9)
    expect(p.lifetime.value.launched).toBe(42)
    expect(p.lifetime.value.folds).toBe(88)
    expect(p.lifetime.value.stamps).toBe(31)
    // Learned lessons must survive the reload, or every wordless lesson the
    // player already sat through slows time again on the next run.
    expect(p.lessons.value).toEqual({ swipe: true, stamp: true, shield: true })
  })

  it('refreshes user settings so the player keeps their language and volume', async () => {
    const data = await seededCloud()
    await bootCloudOnly(data)

    const { default: useUser } = await import('@/use/useUser')
    const u = useUser()
    expect(u.userLanguage.value).toBe('es')
    expect(u.userSoundVolume.value).toBe(0.4)
  })

  it('restores the in-progress run rather than starting a fresh book', async () => {
    const data = await seededCloud()
    await bootCloudOnly(data)

    const p = await import('@/use/useFoldProgress')
    expect(p.resumePage.value).toBe(4)
    expect(p.runCheckpoint.value).toEqual({ score: 5120, hits: 2, time: 410.5 })
  })

  it('restores the exact game settings', async () => {
    // A reload must not reset the player's choices to the defaults (haptics
    // on, auto quality) — that would silently re-enable what they turned off.
    const data = await seededCloud()
    await bootCloudOnly(data)

    const p = await import('@/use/useFoldProgress')
    // A save from before the accessibility options (roadmap #14) gets their defaults.
    expect(p.foldSettings.value).toEqual({
      haptics: false, shake: true, quality: 'low', holdToFold: false, slowMode: false, highlightMode: 'standard', night: false
    })
  })

  it('restores the accessibility options (hold to fold, slow mode, highlight)', async () => {
    const data = await seededCloud({
      fold_settings: { haptics: true, shake: false, quality: 'auto', holdToFold: true, slowMode: true, highlightMode: 'bold' }
    })
    await bootCloudOnly(data)

    const p = await import('@/use/useFoldProgress')
    expect(p.foldSettings.value).toEqual({
      haptics: true, shake: false, quality: 'auto', holdToFold: true, slowMode: true, highlightMode: 'bold', night: false
    })
  })

  it('sanitises a garbled accessibility setting back to its default', async () => {
    const data = await seededCloud({
      fold_settings: { haptics: true, shake: true, quality: 'auto', holdToFold: 'yes', slowMode: 1, highlightMode: 'neon' }
    })
    await bootCloudOnly(data)

    const p = await import('@/use/useFoldProgress')
    expect(p.foldSettings.value.holdToFold).toBe(false)
    expect(p.foldSettings.value.slowMode).toBe(false)
    expect(p.foldSettings.value.highlightMode).toBe('standard')
  })

  it('keeps no gameplay field in raw localStorage on a cloud-only build', async () => {
    const data = await seededCloud()
    await bootCloudOnly(data)

    // Cloud-only mode: gameplay state is in-memory; the proxy serves reads.
    // Nothing must leak into the raw store as a top-level key.
    const raw: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k) raw.push(k)
    }
    expect(raw.filter((k) => k.startsWith('fold_') || k.startsWith('user_'))).toEqual([])
  })
})

describe('hydrate failure modes', () => {
  it('does NOT overwrite a real cloud save when the local snapshot is empty', async () => {
    const data = await seededCloud()
    const manager = await bootCloudOnly(data)

    // A trivial post-boot write must not clobber the hydrated fields.
    const p = await import('@/use/useFoldProgress')
    const { flushSaveNow } = await import('@/use/useSaveStatus')
    p.setFoldSetting('shake', false)
    await flushSaveNow()
    await manager.flush()

    const cloudBlob = JSON.parse(data.store.get(STATE_KEY) || '{}')
    expect(cloudBlob.fold_cleared).toBe(3)
    expect(cloudBlob.fold_page).toBe(4)
    expect(cloudBlob.fold_best).toEqual({ score: 8450, time: 0 })
    expect(cloudBlob.fold_settings).toEqual({
      haptics: false, shake: false, quality: 'low', holdToFold: false, slowMode: false, highlightMode: 'standard', night: false
    })
  })

  it('retries a transient SDK failure before letting a returning player boot fresh', async () => {
    vi.useFakeTimers()
    try {
      const data = await seededCloud()
      const snapshot = new Map(data.store)
      let calls = 0
      data.getItem.mockImplementation(async (key: string) => {
        calls++
        // Fail the very first manifest read — the transient-blip failure mode.
        if (key === MANIFEST_KEY && calls === 1) throw new Error('transient SDK error')
        return snapshot.get(key) ?? null
      })

      const { SaveManager } = await import('@/utils/save/SaveManager')
      const { CrazyGamesStrategy } = await import('@/utils/save/CrazyGamesStrategy')
      const manager = new SaveManager(
        new CrazyGamesStrategy(() => data),
        window.localStorage,
        { blob: { persistToRaw: false } }
      )
      const init = manager.init()
      await vi.advanceTimersByTimeAsync(1_500)
      await init

      expect(manager.hydrateState).toBe('success-with-data')
      const blob = JSON.parse(window.localStorage.getItem(STATE_KEY) || '{}')
      expect(blob.fold_cleared).toBe(3)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('treats a genuinely empty cloud as a real fresh install', async () => {
    const data = makeFakeData()
    await bootCloudOnly(data)

    const p = await import('@/use/useFoldProgress')
    expect(p.pagesCleared.value).toBe(0)
    expect(p.resumePage.value).toBe(1)
    expect(p.records.value).toEqual({ score: 0, time: 0 })
    expect(p.runCheckpoint.value).toBeNull()
    expect(p.hasProgress()).toBe(false)
  })

  it('survives a corrupt cloud blob without wiping the player', async () => {
    const { META_KEY } = await import('@/utils/save/SaveMergePolicy')
    const data = makeFakeData({
      [MANIFEST_KEY]: JSON.stringify([STATE_KEY, META_KEY]),
      [STATE_KEY]: '{not json at all',
      [META_KEY]: JSON.stringify({
        savedAt: '2026-05-19T00:00:00.000Z',
        progressScore: 5000, schemaVersion: 1, maxStage: 5
      })
    })
    // A corrupt blob must degrade to defaults, not throw during boot.
    await expect(bootCloudOnly(data)).resolves.toBeDefined()
    const p = await import('@/use/useFoldProgress')
    expect(p.pagesCleared.value).toBe(0)
    expect(p.records.value.score).toBe(0)
  })
})

describe('reload round-trip', () => {
  it('a page cleared before the reload is still there after it', async () => {
    // ── Session 1: play, then flush at the checkpoint. ──
    const data = makeFakeData()
    const m1 = await bootCloudOnly(data)
    const p1 = await import('@/use/useFoldProgress')

    p1.startNewRun()
    p1.learnLesson('swipe')
    p1.bankScore(3300)
    // `pageCleared` for page 4 → resume on page 5 with four pages cleared.
    p1.checkpoint(5, { score: 3300, hits: 3, time: 512.2 }, 4)
    await m1.flush()

    // ── Session 2: a cold boot against the same cloud store. ──
    vi.resetModules()
    localStorage.clear()
    const data2 = makeFakeData(Object.fromEntries(data.store))
    await bootCloudOnly(data2)

    const p2 = await import('@/use/useFoldProgress')
    expect(p2.resumePage.value).toBe(5)
    expect(p2.pagesCleared.value).toBe(4)
    expect(p2.records.value.score).toBe(3300)
    expect(p2.runs.value).toBe(1)
    expect(p2.lessons.value).toEqual({ swipe: true })
    expect(p2.runCheckpoint.value).toEqual({ score: 3300, hits: 3, time: 512.2 })
  })
})
