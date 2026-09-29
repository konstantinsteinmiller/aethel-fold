import { expect, test, type Page } from '@playwright/test'
import { ALL_LESSONS, ff, state, waitForGame } from './helpers'

/**
 * The CrazyGames build keeps game state ONLY in the SDK cloud (`sdk.data`);
 * raw localStorage must stay clean. These tests replace the real SDK with a
 * fake whose "cloud" lives in the test process, so it survives reloads and
 * can be slow or flaky on purpose.
 */
const CG = 'http://localhost:2051/'

interface Cloud {
  store: Record<string, string>
  /** ms each getItem takes */
  delay: number
  /** number of getItem calls that throw before the SDK recovers */
  failures: number
}

const cloudFor = (state: Record<string, unknown> | null): Cloud => {
  const store: Record<string, string> = {}
  if (state) {
    store.aethel_state = JSON.stringify(state)
    store.__save_meta__ = JSON.stringify({ savedAt: new Date(Date.now() - 60_000).toISOString(), progressScore: 9999, schemaVersion: 1, maxStage: 3 })
    store.__save_internal__crazy_keys = JSON.stringify(['__save_meta__', 'aethel_state'])
  }
  return { store, delay: 0, failures: 0 }
}

const installFakeSdk = async (page: Page, cloud: Cloud): Promise<void> => {
  // Keep a handle on the real Storage before the SaveManager swaps
  // `window.localStorage` for its proxy (Chromium defines the accessor on the
  // window itself, so it can't be recovered from Window.prototype later).
  await page.addInitScript(() => {
    ;(window as unknown as { __rawStorage?: Storage }).__rawStorage = window.localStorage
  })
  await page.exposeBinding('__cloudSet', (_src, key: string, value: string | null) => {
    if (value === null) delete cloud.store[key]
    else cloud.store[key] = value
  })
  await page.exposeBinding('__cloudFail', () => {
    if (cloud.failures > 0) {
      cloud.failures--
      return true
    }
    return false
  })
  await page.route('https://sdk.crazygames.com/**', async (route) => {
    const body = `(() => {
      const store = ${JSON.stringify(cloud.store)};
      const delay = ${cloud.delay};
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      window.CrazyGames = { SDK: {
        environment: 'crazygames',
        init: async () => {},
        data: {
          getItem: async (k) => { await wait(delay); if (await window.__cloudFail()) throw new Error('sdk.data unavailable'); return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null },
          setItem: async (k, v) => { store[k] = String(v); await window.__cloudSet(k, String(v)) },
          removeItem: async (k) => { delete store[k]; await window.__cloudSet(k, null) },
          clear: async () => { for (const k of Object.keys(store)) { delete store[k]; await window.__cloudSet(k, null) } }
        },
        game: { settings: { muteAudio: false }, isMuted: () => false, loadingStart() {}, loadingStop() {}, gameplayStart() {}, gameplayStop() {}, happytime() {}, addSettingsChangeListener() {} },
        user: { getUser: async () => null, getSystemInfo: async () => ({ locale: 'en-US' }), systemInfo: { locale: 'en-US' } },
        ad: { hasAdblock: async () => false, requestAd: (_t, cb) => { cb && cb.adFinished && cb.adFinished() } }
      } };
    })();`
    await route.fulfill({ status: 200, contentType: 'application/javascript', body })
  })
}

const rawGameKeys = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = []
    // Read *raw* storage (the SaveManager proxies window.localStorage).
    const raw = (window as unknown as { __rawStorage: Storage }).__rawStorage
    for (let i = 0; i < raw.length; i++) {
      const k = raw.key(i)!
      if (k === 'aethel_state' || k.startsWith('__save_')) out.push(k)
    }
    return out
  })

test.describe('aethel_state — SDK cloud hydration (CrazyGames build)', () => {
  const saved = { fold_page: 3, fold_cleared: 2, fold_run: { score: 3100, hits: 0, time: 80 }, fold_lessons: ALL_LESSONS, fold_runs: 2, user_language: 'en' }

  test('a returning player boots on their cloud page, and raw localStorage stays clean', async ({ page }) => {
    const cloud = cloudFor(saved)
    await installFakeSdk(page, cloud)
    await page.goto(CG)
    await waitForGame(page)
    const s = await state(page)
    expect(s.page).toBe(3)
    expect(s.score).toBe(3100)
    expect(await page.evaluate(() => (window as any).__saveManager?.strategyName)).toBe('crazyGames')
    expect(await rawGameKeys(page)).toEqual([])
  })

  test('progress made in-game reaches the cloud and survives a reload', async ({ page }) => {
    const cloud = cloudFor(saved)
    await installFakeSdk(page, cloud)
    await page.goto(CG)
    await waitForGame(page)
    await ff(page, 1)
    await page.evaluate(() => window.__fold!.clearPage())
    await ff(page, 1.2)
    await expect.poll(() => JSON.parse(cloud.store.aethel_state ?? '{}').fold_page, { timeout: 15_000 }).toBe(4)
    await page.reload()
    await waitForGame(page)
    expect((await state(page)).page).toBe(4)
  })

  test('a slow SDK is waited for — never a false fresh user', async ({ page }) => {
    const cloud = cloudFor(saved)
    cloud.delay = 1200
    await installFakeSdk(page, cloud)
    await page.goto(CG)
    await waitForGame(page)
    expect((await state(page)).page).toBe(3)
  })

  test('a transient SDK failure is retried and still restores the save', async ({ page }) => {
    const cloud = cloudFor(saved)
    cloud.failures = 3
    await installFakeSdk(page, cloud)
    await page.goto(CG)
    await waitForGame(page)
    await expect.poll(async () => (await state(page)).page, { timeout: 30_000 }).toBe(3)
  })

  test('a brand-new player starts on page 1 and seeds the cloud', async ({ page }) => {
    const cloud = cloudFor(null)
    await installFakeSdk(page, cloud)
    await page.goto(CG)
    await waitForGame(page)
    expect((await state(page)).page).toBe(1)
    await expect.poll(() => Object.keys(cloud.store).sort(), { timeout: 15_000 }).toEqual(['__save_internal__crazy_keys', '__save_meta__', 'aethel_state'])
  })
})
