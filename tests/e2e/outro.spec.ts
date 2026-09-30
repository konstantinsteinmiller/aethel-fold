import { expect, test, type Page } from '@playwright/test'
import { ALL_LESSONS, collectErrors, ff, readSave, seedState, state, waitForGame } from './helpers'

/**
 * The boss outro (C9b): after the finale fold the win is saved, the cheering
 * paper crowd pops up and paper fireworks go off; a tap skips to the victory
 * card. Screenshots go to `OUTRO_SHOTS` when set (not committed).
 */
const SHOTS = process.env.OUTRO_SHOTS ?? 'test-results'

/** Beat book `book`'s dragon and fold the finale: stops on the victory frame (the outro has just begun). */
const beatBoss = async (page: Page, book = 1): Promise<void> => {
  await page.evaluate((b) => window.__fold!.jumpTo(5, b), book)
  await ff(page, 1)
  await page.evaluate(() => window.__fold!.clearPage())
  for (let i = 0; i < 20 && (await state(page)).page !== 6; i++) await ff(page, 0.5)
  expect((await state(page)).page).toBe(6)
  await ff(page, 1)
  await page.evaluate(() => window.__fold!.game.foldNow(0))
  for (let i = 0; i < 40 && (await state(page)).phase !== 'victory'; i++) await ff(page, 0.1)
  expect((await state(page)).phase).toBe('victory')
}

const outro = (page: Page) => page.evaluate(() => window.__fold!.outro())

/** Two real frames, so what the last fast-forward set up is on screen. */
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

test.describe('Aethel Fold — the boss outro', () => {
  test('book 1: the win is saved, the crowd and fireworks play, a tap skips to the victory card, a reload keeps the win', async ({ page }) => {
    const errors = collectErrors(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await seedState(page, { fold_lessons: ALL_LESSONS, fold_cleared: 4 })
    await page.goto('/')
    await waitForGame(page)
    await beatBoss(page)
    // Saved before (and whatever happens to) the outro.
    await expect.poll(async () => (await readSave(page))?.fold_wins).toBe(1)
    let o = await outro(page)
    expect(o.active).toBe(true)
    expect(o.script).toBe('b1-outro')
    // The card waits; the wordless skip is offered.
    await expect(page.getByTestId('victory-book2')).toHaveCount(0)
    await expect(page.getByTestId('outro-skip')).toBeVisible()
    await expect(page.getByTestId('shelf-zoom')).toHaveCount(0)
    // The crowd pops up and the first fireworks burst.
    await ff(page, 1.9)
    await frames(page)
    o = await outro(page)
    expect(o.active).toBe(true)
    expect(o.crowd).toBeGreaterThanOrEqual(14)
    expect(o.crowdShown).toBe(true)
    expect(o.cutting).toBe(true)
    expect(o.chips).toBeGreaterThan(0)
    expect(o.dropped).toBe(0)
    await page.screenshot({ path: `${SHOTS}/outro-b1-crowd.png` })
    await ff(page, 3.2)
    await frames(page)
    o = await outro(page)
    expect(o.crowd).toBe(20)
    await page.screenshot({ path: `${SHOTS}/outro-b1-fireworks.png` })
    // A tap on the page skips.
    await page.mouse.click(195, 520)
    await ff(page, 0.1)
    o = await outro(page)
    expect(o.active).toBe(false)
    expect(o.skipped).toBe(true)
    // The crowd stays to cheer behind the card; the camera glides home.
    expect(o.crowdShown).toBe(true)
    await expect(page.getByTestId('victory-book2')).toBeVisible({ timeout: 10_000 })
    await ff(page, 1)
    expect((await outro(page)).cutting).toBe(false)
    const s = await state(page)
    expect(s.phase).toBe('victory')
    expect(s.shelf.open).toBe(false)
    // Reload: still won.
    await page.reload()
    await waitForGame(page)
    const save = await readSave(page)
    expect(save?.fold_wins).toBe(1)
    const after = await state(page)
    expect(after.shelf.available).toBe(true)
    expect(after.shelf.slots[1]).not.toBe('locked')
    expect((await outro(page)).active).toBe(false)
    expect(errors).toEqual([])
  })

  test('the skip button, low quality and book 2: lighter fireworks, the crane\'s script', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedState(page, {
      fold_lessons: ALL_LESSONS, fold_wins: 1, fold_cleared: 6, fold_book: 2, fold_page: 5, fold_cleared2: 4,
      fold_settings: { quality: 'low' }
    })
    await page.goto('/')
    await waitForGame(page)
    await beatBoss(page, 2)
    let o = await outro(page)
    expect(o.script).toBe('b2-outro')
    expect(o.lite).toBe(true)
    await ff(page, 1.9)
    await frames(page)
    o = await outro(page)
    expect(o.fireworks).toBeLessThanOrEqual(2)
    await page.screenshot({ path: `${SHOTS}/outro-b2-low.png` })
    await page.getByTestId('outro-skip').click()
    await ff(page, 0.1)
    expect((await outro(page)).active).toBe(false)
    await expect(page.getByTestId('outro-skip')).toHaveCount(0)
  })

  test('Dragon Rush never plays it', async ({ page }) => {
    await seedState(page, { fold_lessons: ALL_LESSONS, fold_wins: 1, fold_cleared: 6 })
    await page.goto('/')
    await waitForGame(page)
    await page.evaluate(() => window.__fold!.startRush(1))
    await ff(page, 1)
    await page.evaluate(() => window.__fold!.clearPage())
    await ff(page, 3)
    expect((await state(page)).phase).toBe('rushOver')
    const o = await outro(page)
    expect(o.active).toBe(false)
    expect(o.script).toBeNull()
    await expect(page.getByTestId('outro-skip')).toHaveCount(0)
    await expect(page.getByTestId('rush-result')).toBeVisible({ timeout: 10_000 })
  })

  for (const vp of [{ width: 320, height: 658 }, { width: 658, height: 320 }]) {
    test(`nothing overlaps the HUD during the outro at ${vp.width}×${vp.height}`, async ({ page }) => {
      await page.setViewportSize(vp)
      await seedState(page, { fold_lessons: ALL_LESSONS, fold_cleared: 4 })
      await page.goto('/')
      await waitForGame(page)
      await beatBoss(page)
      await ff(page, 1.5)
      const skip = page.getByTestId('outro-skip')
      await expect(skip).toBeVisible()
      // Past the button's drop-in.
      await page.waitForFunction(() => document.querySelector('[data-testid="outro-skip"]')!.getAnimations().every((a) => a.playState === 'finished'))
      const boxes = await page.evaluate(() => {
        const q = (sel: string) => {
          const r = document.querySelector(sel)!.getBoundingClientRect()
          return { x: r.x, y: r.y, w: r.width, h: r.height }
        }
        return { page: q('.page-badge'), hearts: q('.hearts'), score: q('.score__tag'), right: q('.hud-right'), skip: q('[data-testid="outro-skip"]') }
      })
      const overlap = (a: typeof boxes.skip, b: typeof boxes.skip) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
      for (const k of ['page', 'hearts', 'score', 'right'] as const) expect(overlap(boxes.skip, boxes[k]), `skip vs ${k}`).toBe(false)
      expect(overlap(boxes.page, boxes.score)).toBe(false)
      expect(overlap(boxes.score, boxes.right)).toBe(false)
      expect(boxes.skip.x).toBeGreaterThanOrEqual(0)
      expect(boxes.skip.y).toBeGreaterThanOrEqual(0)
      expect(boxes.skip.x + boxes.skip.w).toBeLessThanOrEqual(vp.width + 0.5)
      expect(boxes.skip.y + boxes.skip.h).toBeLessThanOrEqual(vp.height + 0.5)
      expect(boxes.skip.w).toBeGreaterThanOrEqual(40)
      // The victory card is not up yet (it comes with the outro's end).
      await expect(page.getByTestId('victory-book2')).toHaveCount(0)
      await page.screenshot({ path: `${SHOTS}/outro-${vp.width}x${vp.height}.png` })
    })
  }
})
