import { expect, test } from '@playwright/test'
import { ALL_LESSONS, ff, readSave, seedState, state, waitForGame } from './helpers'

test.describe('aethel_state — local persistence (plain web build)', () => {
  test('writes exactly one localStorage key for game state', async ({ page }) => {
    await page.goto('/')
    await waitForGame(page)
    await ff(page, 1)
    await page.waitForTimeout(600)
    const keys = await page.evaluate(() => Object.keys(localStorage))
    const ours = keys.filter((k) => !['fps', 'debug', 'cheat'].includes(k))
    expect(ours).toEqual(['aethel_state'])
    const save = await readSave(page)
    expect(save?.fold_page).toBe(1)
    expect(save?.fold_runs).toBeGreaterThanOrEqual(1)
  })

  test('a reload resumes on the saved page with the checkpoint score (not a fresh user)', async ({ page }) => {
    await seedState(page, {
      fold_page: 3,
      fold_cleared: 2,
      fold_run: { score: 4200, hits: 1, time: 95 },
      fold_lessons: ALL_LESSONS,
      fold_runs: 1
    })
    await page.goto('/')
    await waitForGame(page)
    const s = await state(page)
    expect(s.page).toBe(3)
    expect(s.score).toBe(4200)
    expect(s.lesson).toBe(null)
    await expect(page.getByText('The Siege')).toBeVisible()
  })

  test('clearing a page checkpoints the next page, and a reload lands there', async ({ page }) => {
    await seedState(page, { fold_lessons: ALL_LESSONS })
    await page.goto('/')
    await waitForGame(page)
    await ff(page, 1)
    await page.evaluate(() => window.__fold!.clearPage())
    await ff(page, 1)
    await page.waitForTimeout(3000)
    const save = await readSave(page)
    expect(save?.fold_page).toBe(2)
    expect(save?.fold_cleared).toBe(1)
    await page.reload()
    await waitForGame(page)
    expect((await state(page)).page).toBe(2)
  })

  test('settings persist inside the same object', async ({ page }) => {
    await page.goto('/')
    await waitForGame(page)
    await page.getByRole('button', { name: /pause and settings/i }).click()
    await page.getByRole('button', { name: /^settings$/i }).click()
    await page.getByRole('switch').first().click()
    await page.waitForTimeout(800)
    const save = await readSave(page)
    expect(save?.fold_settings?.haptics).toBe(false)
  })
})
