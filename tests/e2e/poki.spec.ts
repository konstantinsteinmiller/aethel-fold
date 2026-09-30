import { expect, test, type Page } from '@playwright/test'
import { ALL_LESSONS, ff, seedState, state, waitForGame } from './helpers'

/**
 * The Poki build (VITE_APP_POKI + both ad flags) against a fake PokiSDK served
 * in place of game-cdn.poki.com/scripts/v2/poki-sdk.js. Runs only with
 * E2E_POKI=1 (its own dev server on E2E_POKI_PORT).
 */
const POKI = `http://localhost:${Number(process.env.E2E_POKI_PORT) || 2053}/`

interface PokiLog {
  calls: string[]
  /** `game.paused` sampled while each break was on screen. */
  pausedDuring: boolean[]
}

const installPoki = async (page: Page, log: PokiLog, breakMs = 600): Promise<void> => {
  await page.exposeBinding('__poki', (_src, call: string) => {
    log.calls.push(call)
  })
  await page.exposeBinding('__pokiPaused', (_src, paused: boolean) => {
    log.pausedDuring.push(paused)
  })
  await page.route('https://game-cdn.poki.com/**', async (route) => {
    const body = `(() => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const sample = () => window.__pokiPaused(!!(window.__fold && window.__fold.game.paused));
      window.PokiSDK = {
        init: async () => { window.__poki('init') },
        setDebug: () => {},
        gameLoadingFinished: () => window.__poki('gameLoadingFinished'),
        gameplayStart: () => window.__poki('gameplayStart'),
        gameplayStop: () => window.__poki('gameplayStop'),
        commercialBreak: async (onStart) => { window.__poki('commercialBreak'); onStart && onStart(); await wait(${breakMs}); sample() },
        rewardedBreak: async () => { window.__poki('rewardedBreak'); await wait(${breakMs}); sample(); return true }
      };
    })();`
    await route.fulfill({ status: 200, contentType: 'application/javascript', body })
  })
}

test.describe('Poki build (fake PokiSDK)', () => {
  test.skip(!process.env.E2E_POKI, 'the Poki server runs only with E2E_POKI=1')

  test('boot: init, gameLoadingFinished once, then paired gameplayStart / gameplayStop around the pause', async ({ page }) => {
    const log: PokiLog = { calls: [], pausedDuring: [] }
    await installPoki(page, log)
    await seedState(page, { fold_lessons: ALL_LESSONS, user_language: 'en' })
    await page.goto(POKI)
    await waitForGame(page)
    await expect.poll(() => log.calls, { timeout: 15_000 }).toContain('gameplayStart')
    expect(log.calls.filter((c) => c === 'init')).toHaveLength(1)
    expect(log.calls.filter((c) => c === 'gameLoadingFinished')).toHaveLength(1)
    expect(log.calls.indexOf('gameLoadingFinished')).toBeLessThan(log.calls.indexOf('gameplayStart'))
    await page.getByRole('button', { name: /pause and settings/i }).click()
    await expect.poll(() => log.calls.at(-1)).toBe('gameplayStop')
    await page.getByRole('button', { name: /resume/i }).click()
    await expect.poll(() => log.calls.at(-1)).toBe('gameplayStart')
    // Strictly alternating: never two starts or two stops in a row.
    const gp = log.calls.filter((c) => c === 'gameplayStart' || c === 'gameplayStop')
    for (let i = 1; i < gp.length; i++) expect(gp[i]).not.toBe(gp[i - 1])
    // No other portal's text, and no outbound links on the page.
    expect(await page.locator('a[href^="http"]').count()).toBe(0)
  })

  test('after the grace: a page clear ends in a commercialBreak with the game paused and gameplay stopped', async ({ page }) => {
    const log: PokiLog = { calls: [], pausedDuring: [] }
    await installPoki(page, log, 1000)
    await seedState(page, { fold_lessons: ALL_LESSONS, fold_playtime: 600, user_language: 'en' })
    await page.goto(POKI)
    await waitForGame(page)
    await ff(page, 1)
    await page.evaluate(() => window.__fold!.clearPage())
    await ff(page, 2.5)
    await expect.poll(() => log.calls, { timeout: 15_000 }).toContain('commercialBreak')
    const i = log.calls.indexOf('commercialBreak')
    expect(log.calls[i - 1]).toBe('gameplayStop')
    await expect.poll(() => log.pausedDuring.length, { timeout: 15_000 }).toBe(1)
    expect(log.pausedDuring[0]).toBe(true)
    await expect.poll(() => log.calls.at(-1), { timeout: 15_000 }).toBe('gameplayStart')
    expect(await page.evaluate(() => window.__fold!.game.paused)).toBe(false)
  })

  test('the rewarded second chance goes through rewardedBreak', async ({ page }) => {
    const log: PokiLog = { calls: [], pausedDuring: [] }
    await installPoki(page, log, 400)
    await seedState(page, { fold_lessons: ALL_LESSONS, fold_playtime: 600, user_language: 'en' })
    await page.goto(POKI)
    await waitForGame(page)
    await page.evaluate(() => window.__fold!.jumpTo(2))
    await ff(page, 3)
    await page.evaluate(() => {
      const g = window.__fold!.game
      for (let k = 0; k < 3; k++) {
        g.hero.invuln = 0
        g.hurtHero(0, 5)
      }
    })
    await expect(page.getByTestId('second-chance')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('second-chance-watch').click({ force: true })
    await expect.poll(async () => (await state(page)).hp, { timeout: 15_000 }).toBe(1)
    expect(log.calls).toContain('rewardedBreak')
    expect(log.pausedDuring).toEqual([true])
  })
})
