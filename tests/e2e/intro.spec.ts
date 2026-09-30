import { expect, test, type Page } from '@playwright/test'
import { ALL_LESSONS, collectErrors, ff, readSave, seedState, state, waitForGame } from './helpers'

/**
 * The first-launch intro (roadmap #12). An automated browser never sees it
 * unless the URL asks (`?intro=1`: the normal first-launch policy), which is
 * how every other spec keeps booting straight into page 1.
 */

const intro = (page: Page) => page.evaluate(() => window.__fold!.intro())
const boot = (page: Page) => page.evaluate(() => window.__fold!.boot())

/** A tap in the middle of the page (where a player would tap). */
const tapPage = async (page: Page): Promise<void> => {
  const box = (await page.locator('canvas.fold-canvas').boundingBox())!
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.55)
}

test.describe('Aethel Fold — first-launch intro (roadmap #12)', () => {
  test('a fresh profile opens on the intro; a tap drops straight onto page 1 with a clean console; a reload never shows it again', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto('/?intro=1')
    await waitForGame(page)
    // The intro is the first thing on screen, with the wordless skip tab; the HUD is hidden, page 1 waits behind it.
    expect((await intro(page)).playing).toBe(true)
    await expect(page.getByTestId('intro-skip')).toBeVisible()
    await expect(page.locator('.hud-top')).toHaveClass(/hud-top--intro/)
    const before = await state(page)
    expect(before.intro).toBe(true)
    expect(before.page).toBe(1)
    expect(before.book).toBe(1)
    expect(before.enemies).toBe(0)
    expect((await boot(page)).intro).toBe('playing')
    // Let the show run a little (the demo game, never the player's).
    await page.waitForTimeout(800)
    expect((await state(page)).score).toBe(0)

    await tapPage(page)
    await expect.poll(async () => (await intro(page)).playing).toBe(false)
    await expect(page.getByTestId('intro-skip')).toHaveCount(0)
    await expect(page.locator('.hud-top')).not.toHaveClass(/hud-top--intro/)
    const s = await state(page)
    expect(s.page).toBe(1)
    expect(s.score).toBe(0)
    expect(s.hp).toBe(3)
    await expect(page.getByText('Page 1/6')).toBeVisible()
    // Telemetry: the skip tap is the first input; the intro is marked skipped.
    const b = await boot(page)
    expect(b.intro).toBe('skipped')
    expect(b.intro_end_ms).toBeGreaterThanOrEqual(b.boot_ms)
    expect(b.first_input_ms).toBeGreaterThanOrEqual(b.boot_ms)
    // Saved once, for good, inside aethel_state (no new localStorage key).
    await expect.poll(async () => (await readSave(page))?.fold_intro).toBe(true)
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => !['fps', 'debug', 'cheat'].includes(k)))
    expect(keys).toEqual(['aethel_state'])

    // Page 1 then plays exactly as a normal first boot: the swipe lesson comes.
    for (let i = 0; i < 40 && (await state(page)).lesson !== 'swipe'; i++) await ff(page, 0.5)
    expect((await state(page)).lesson).toBe('swipe')
    await page.waitForTimeout(500)
    expect(errors).toEqual([])

    await page.reload()
    await waitForGame(page)
    expect((await intro(page)).playing).toBe(false)
    expect((await boot(page)).intro).toBe('none')
    expect((await state(page)).page).toBe(1)
    await expect(page.getByTestId('intro-skip')).toHaveCount(0)
  })

  test('left alone, it ends into page 1 by itself (and counts as watched)', async ({ page }) => {
    await page.goto('/?intro=1')
    await waitForGame(page)
    expect((await intro(page)).playing).toBe(true)
    // The intro's own clock (the DEV fast-forward runs the intro, never the player's game).
    await ff(page, 16)
    await expect.poll(async () => (await intro(page)).playing).toBe(false)
    expect((await boot(page)).intro).toBe('watched')
    const s = await state(page)
    expect(s.page).toBe(1)
    expect(s.score).toBe(0)
    await expect.poll(async () => (await readSave(page))?.fold_intro).toBe(true)
  })

  test('a returning player (any progress) never sees it and boots straight into their page', async ({ page }) => {
    await seedState(page, { fold_page: 3, fold_cleared: 2, fold_run: { score: 4200, hits: 0, time: 90 }, fold_lessons: ALL_LESSONS, fold_runs: 1 })
    await page.goto('/?intro=1')
    await waitForGame(page)
    expect((await intro(page)).playing).toBe(false)
    expect((await boot(page)).intro).toBe('none')
    const s = await state(page)
    expect(s.page).toBe(3)
    expect(s.score).toBe(4200)
    // Nothing about the intro was written for them.
    expect((await readSave(page))?.fold_intro).toBeUndefined()
  })

  test('a player who only started a run once (no intro flag, an older build) is a returning player too', async ({ page }) => {
    await seedState(page, { fold_page: 1, fold_runs: 1 })
    await page.goto('/?intro=1')
    await waitForGame(page)
    expect((await intro(page)).playing).toBe(false)
  })

  test('automation boots straight into page 1 unless the URL asks for the intro', async ({ page }) => {
    await page.goto('/')
    await waitForGame(page)
    expect((await intro(page)).playing).toBe(false)
    expect((await state(page)).page).toBe(1)
  })

  test('the settings replay it over the page in play; a key skips it and the page is as it was', async ({ page }) => {
    await seedState(page, { fold_lessons: ALL_LESSONS, fold_intro: true })
    await page.goto('/?intro=1')
    await waitForGame(page)
    expect((await intro(page)).playing).toBe(false)
    await ff(page, 3)
    const before = await state(page)
    await page.getByRole('button', { name: /pause and settings/i }).click()
    await page.getByRole('button', { name: /^settings$/i }).click()
    await page.getByTestId('replay-intro').click()
    await expect.poll(async () => (await intro(page)).playing).toBe(true)
    await expect(page.getByTestId('intro-skip')).toBeVisible()
    // The player's page is frozen underneath.
    await page.waitForTimeout(600)
    const during = await state(page)
    expect(during.score).toBe(before.score)
    expect(during.enemies).toBe(before.enemies)
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await intro(page)).playing).toBe(false)
    // No pause menu opened behind it, and a replay is no boot event.
    await expect(page.locator('.cootie')).toHaveCount(0)
    expect((await boot(page)).intro).toBe('none')
    expect((await state(page)).page).toBe(before.page)
  })
})
