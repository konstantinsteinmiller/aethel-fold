import { expect, test, type Page } from '@playwright/test'
import { ALL_LESSONS, ff, seedState, state, waitForGame } from './helpers'

/**
 * Ads (roadmaps #9, #17, #19).
 *
 *   * The plain default build (the plain server) offers no ad UI anywhere. (The
 *     jury build is the itch.io build; its config is pinned in the unit tests.)
 *   * The ad build (a CrazyGames full release with VITE_APP_INTERSTITIALS and
 *     VITE_APP_REWARDED, on E2E_ADS_PORT) runs against a fake SDK that records
 *     every `requestAd`: an interstitial after a page clear once the grace is
 *     over (with the game paused under it), none inside the grace, and the
 *     rewarded second chance and Try again.
 */
const ADS = `http://localhost:${Number(process.env.E2E_ADS_PORT) || 2052}/`
const adsServer = !process.env.E2E_PLAIN_ONLY || !!process.env.E2E_ADS

interface AdLog {
  requests: string[]
  /** `game.paused` sampled while each ad was on screen. */
  pausedDuring: boolean[]
}

/** A fake CrazyGames SDK: an in-memory cloud and an ad that takes `adMs` to finish. */
const installAdSdk = async (page: Page, save: Record<string, unknown>, log: AdLog, adMs = 600): Promise<void> => {
  const store: Record<string, string> = {
    aethel_state: JSON.stringify(save),
    __save_meta__: JSON.stringify({ savedAt: new Date(Date.now() - 60_000).toISOString(), progressScore: 9999, schemaVersion: 1, maxStage: 3 }),
    __save_internal__crazy_keys: JSON.stringify(['__save_meta__', 'aethel_state'])
  }
  await page.exposeBinding('__adRequested', (_src, type: string) => {
    log.requests.push(type)
  })
  await page.exposeBinding('__adPaused', (_src, paused: boolean) => {
    log.pausedDuring.push(paused)
  })
  await page.route('https://sdk.crazygames.com/**', async (route) => {
    const body = `(() => {
      const store = ${JSON.stringify(store)};
      window.CrazyGames = { SDK: {
        environment: 'crazygames',
        init: async () => {},
        data: {
          getItem: async (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
          setItem: async (k, v) => { store[k] = String(v) },
          removeItem: async (k) => { delete store[k] },
          clear: async () => { for (const k of Object.keys(store)) delete store[k] }
        },
        game: { settings: { muteAudio: false }, isMuted: () => false, loadingStart() {}, loadingStop() {}, gameplayStart() {}, gameplayStop() {}, happytime() {}, addSettingsChangeListener() {} },
        user: { getUser: async () => null, getSystemInfo: async () => ({ locale: 'en-US' }), systemInfo: { locale: 'en-US' } },
        ad: {
          hasAdblock: async () => false,
          requestAd: (type, cb) => {
            window.__adRequested(type);
            cb && cb.adStarted && cb.adStarted();
            setTimeout(() => {
              window.__adPaused(!!(window.__fold && window.__fold.game.paused));
              cb && cb.adFinished && cb.adFinished();
            }, ${adMs});
          }
        }
      } };
    })();`
    await route.fulfill({ status: 200, contentType: 'application/javascript', body })
  })
}

/** Three hits through the gate. */
const loseHearts = (page: Page, n = 3) =>
  page.evaluate((k) => {
    const g = window.__fold!.game
    for (let i = 0; i < k; i++) {
      g.hero.invuln = 0
      g.hurtHero(0, 5)
    }
  }, n)

test.describe('ads — the plain default build', () => {
  test('offers no ad UI: plain Try again, no second chance, no ad requests', async ({ page }) => {
    // Even a player long past the grace gets nothing: the build has no ads compiled in.
    await seedState(page, { fold_lessons: ALL_LESSONS, fold_playtime: 3600 })
    await page.goto('/')
    await waitForGame(page)
    const flags = await page.evaluate(() => (window.__fold as any).ads())
    expect(flags.rewarded).toBe(false)
    expect(flags.interstitials).toBe(false)
    await page.evaluate(() => window.__fold!.jumpTo(2))
    await ff(page, 3)
    await loseHearts(page)
    expect((await state(page)).phase).toBe('crumple')
    await expect(page.getByTestId('second-chance')).toHaveCount(0)
    await ff(page, 2)
    await expect(page.getByTestId('almost-retry')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('almost-retry-ad')).toHaveCount(0)
    await page.getByTestId('almost-retry').click({ force: true })
    // A page clear asks for nothing either.
    await ff(page, 1)
    await page.evaluate(() => window.__fold!.clearPage())
    await ff(page, 3)
    await page.waitForTimeout(800)
    const after = await page.evaluate(() => (window.__fold as any).ads())
    expect(after.requested).toBe(0)
    expect(after.shown).toBe(0)
    expect(after.playtime).toBe(3600)
  })
})

test.describe('ads — the ad build (fake CrazyGames SDK)', () => {
  test.skip(!adsServer, 'the ad server is not running (E2E_PLAIN_ONLY without E2E_ADS)')

  test('after the grace, a page clear shows an interstitial once the next page settles, with the game paused under it', async ({ page }) => {
    const log: AdLog = { requests: [], pausedDuring: [] }
    await installAdSdk(page, { fold_lessons: ALL_LESSONS, fold_playtime: 600, user_language: 'en' }, log, 1200)
    await page.goto(ADS)
    await waitForGame(page)
    await ff(page, 1)
    await page.evaluate(() => window.__fold!.clearPage())
    // Nothing during the clear or the page turn.
    await ff(page, 0.5)
    expect(log.requests).toEqual([])
    await ff(page, 2)
    await expect.poll(() => log.requests, { timeout: 15_000 }).toContain('midgame')
    await expect.poll(() => log.pausedDuring.length, { timeout: 15_000 }).toBe(1)
    expect(log.pausedDuring[0]).toBe(true)
    // The game resumes after the ad.
    await expect.poll(async () => page.evaluate(() => window.__fold!.game.paused)).toBe(false)
    expect((await state(page)).page).toBe(2)
    // The next clear is inside the 121 s gap: no second interstitial.
    await ff(page, 1)
    await page.evaluate(() => window.__fold!.clearPage())
    await ff(page, 3)
    await page.waitForTimeout(1000)
    expect(log.requests.filter((r) => r === 'midgame')).toHaveLength(1)
  })

  test('inside a first-time player\'s first three minutes: no interstitial, no rewarded UI', async ({ page }) => {
    const log: AdLog = { requests: [], pausedDuring: [] }
    await installAdSdk(page, { fold_lessons: ALL_LESSONS, fold_playtime: 20, user_language: 'en' }, log)
    await page.goto(ADS)
    await waitForGame(page)
    await ff(page, 1)
    await page.evaluate(() => window.__fold!.clearPage())
    await ff(page, 3)
    await page.waitForTimeout(1000)
    await ff(page, 2)
    await loseHearts(page)
    await expect(page.getByTestId('second-chance')).toHaveCount(0)
    await ff(page, 2)
    await expect(page.getByTestId('almost-retry')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('almost-retry-ad')).toHaveCount(0)
    expect(log.requests).toEqual([])
  })

  for (const vp of [{ width: 320, height: 658 }, { width: 658, height: 320 }]) {
    test(`the ad cards fit on screen and clear the HUD at ${vp.width}×${vp.height}`, async ({ page }) => {
      await page.setViewportSize(vp)
      const log: AdLog = { requests: [], pausedDuring: [] }
      await installAdSdk(page, { fold_lessons: ALL_LESSONS, fold_playtime: 600, fold_page: 2, fold_cleared: 1, user_language: 'en' }, log, 300)
      await page.goto(ADS)
      await waitForGame(page)
      await ff(page, 3)
      await loseHearts(page)
      const inside = async (testId: string): Promise<void> => {
        const el = page.getByTestId(testId)
        await expect(el).toBeVisible({ timeout: 10_000 })
        // Let the pop-in transition finish before measuring (SwiftShader frames are slow).
        await expect.poll(() => el.evaluate((n) => getComputedStyle(n).transform), { timeout: 15_000 }).toMatch(/^matrix\(1, 0, 0, 1,/)
        const box = (await el.boundingBox())!
        const hud = (await page.locator('.hud-top').boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.y).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5)
        expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5)
        // Below the HUD strip's widgets (their own boxes, not the full-width strip).
        for (const w of await page.locator('.hud-top > div').all()) {
          const b = await w.boundingBox()
          if (!b || b.height === 0) continue
          const overlaps = box.x < b.x + b.width && b.x < box.x + box.width && box.y < b.y + b.height && b.y < box.y + box.height
          expect(overlaps, `${testId} overlaps a HUD column`).toBe(false)
        }
        expect(hud).toBeTruthy()
      }
      await inside('second-chance')
      await page.getByTestId('second-chance-skip').click({ force: true })
      await ff(page, 2)
      await expect(page.getByTestId('almost-retry')).toBeVisible({ timeout: 15_000 })
      // One ad per death: turned down the offer, so the Try again is the plain one.
      await expect(page.getByTestId('almost-retry-ad')).toHaveCount(0)
      expect(log.requests).toEqual([])
    })
  }

  test('the rewarded second chance gives a heart back, then the Almost! Try again is a rewarded button', async ({ page }) => {
    const log: AdLog = { requests: [], pausedDuring: [] }
    await installAdSdk(page, { fold_lessons: ALL_LESSONS, fold_playtime: 600, fold_page: 2, fold_cleared: 1, user_language: 'en' }, log, 400)
    await page.goto(ADS)
    await waitForGame(page)
    expect((await state(page)).page).toBe(2)
    await ff(page, 3)
    await loseHearts(page)
    // The world holds on the last heart with the offer up.
    const offer = page.getByTestId('second-chance')
    await expect(offer).toBeVisible({ timeout: 10_000 })
    expect((await state(page)).phase).toBe('play')
    expect((await state(page)).hp).toBe(0)
    await page.getByTestId('second-chance-watch').click({ force: true })
    await expect.poll(async () => (await state(page)).hp, { timeout: 10_000 }).toBe(1)
    expect(log.requests).toEqual(['rewarded'])
    expect(log.pausedDuring).toEqual([true])
    await expect(offer).toHaveCount(0)
    // Once per page: the next last heart crumples straight into the Almost! moment.
    await ff(page, 2.5)
    await loseHearts(page, 1)
    expect((await state(page)).phase).toBe('crumple')
    await expect(offer).toHaveCount(0)
    await ff(page, 2)
    const retryAd = page.getByTestId('almost-retry-ad')
    await expect(retryAd).toBeVisible({ timeout: 15_000 })
    // The rewarded ad just watched restarted the interstitial gap: no interstitial on this crumple.
    expect(log.requests).toEqual(['rewarded'])
    await retryAd.click({ force: true })
    await expect.poll(async () => (await state(page)).hp, { timeout: 10_000 }).toBe(3)
    expect(log.requests).toEqual(['rewarded', 'rewarded'])
    const s = await state(page)
    expect(['drop', 'play']).toContain(s.phase)
    expect(s.page).toBe(2)
  })
})
