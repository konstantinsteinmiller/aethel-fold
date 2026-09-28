import { expect, test } from '@playwright/test'
import { ALL_LESSONS, collectErrors, ff, screenOf, seedState, state, swipe, waitForGame } from './helpers'

test.describe('Castle Fold — gameplay', () => {
  test('boots straight into page 1 (no main menu) with a clean console', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto('/')
    await waitForGame(page)
    const s = await state(page)
    expect(s.page).toBe(1)
    await expect(page.locator('canvas.fold-canvas')).toBeVisible()
    await expect(page.getByText('The Border')).toBeVisible()
    await expect(page.getByText('Page 1/6')).toBeVisible()
    await page.waitForTimeout(1500)
    expect(errors).toEqual([])
  })

  test('the wordless swipe lesson slows time, shows the ghost hand, and a real swipe snaps the wall', async ({ page }) => {
    await page.goto('/')
    await waitForGame(page)
    // Let the first column march onto the fold (fast-forward in small bites).
    for (let i = 0; i < 40 && (await state(page)).lesson !== 'swipe'; i++) await ff(page, 0.5)
    expect((await state(page)).lesson).toBe('swipe')
    await ff(page, 1)
    expect((await state(page)).timeScale).toBeLessThan(0.3)
    await expect(page.locator('.ghost-hint')).toContainText('Swipe')
    const f = (await state(page)).folds[0]!
    expect(f.phase).toBe('ready')
    await swipe(page, [0, -0.75], [0, -2.5])
    await page.waitForTimeout(300)
    await ff(page, 0.4)
    const after = await state(page)
    expect(['up', 'snapping']).toContain(after.folds[0]!.phase)
    expect(after.score).toBeGreaterThan(0)
    expect(after.lesson).toBe(null)
  })

  test('tap to stamp: a tap on a raised wall slams it flat', async ({ page }) => {
    await seedState(page, { fold_lessons: ALL_LESSONS })
    await page.goto('/')
    await waitForGame(page)
    await ff(page, 1)
    await page.evaluate(() => window.__fold!.game.foldNow(0))
    await ff(page, 0.4)
    expect((await state(page)).folds[0]!.phase).toBe('up')
    const p = await screenOf(page, 0, -1.2)
    await page.mouse.click(p.x, p.y)
    await ff(page, 0.05)
    const phase = (await state(page)).folds[0]!.phase
    expect(['stamping', 'cooldown', 'ready']).toContain(phase)
  })

  test('spread to flatten: dragging across a tower crease tears it (page 4)', async ({ page }) => {
    await seedState(page, { fold_lessons: ALL_LESSONS })
    await page.goto('/')
    await waitForGame(page)
    await page.evaluate(() => window.__fold!.jumpTo(4))
    await ff(page, 2)
    const t = await page.evaluate(() => {
      const g = window.__fold!.game
      const tear = g.tears.find((o: any) => o.def.id === 'p4-tower-l')
      return { x: tear.px, z: tear.pz, active: tear.active }
    })
    expect(t.active).toBe(true)
    await swipe(page, [t.x, t.z], [t.x + 3, t.z], 12)
    const torn = await page.evaluate(() => window.__fold!.game.tears.find((o: any) => o.def.id === 'p4-tower-l').torn)
    expect(torn).toBe(true)
  })

  test('the pause menu folds in, and Resume returns to play', async ({ page }) => {
    await page.goto('/')
    await waitForGame(page)
    await page.getByRole('button', { name: /pause and settings/i }).click()
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible()
    expect(await page.evaluate(() => window.__fold!.game.paused)).toBe(true)
    await page.getByRole('button', { name: /resume/i }).click()
    await expect(page.getByRole('dialog', { name: 'Paused' })).toHaveCount(0)
    expect(await page.evaluate(() => window.__fold!.game.paused)).toBe(false)
  })

  test('the boss can be beaten and the frog fold ends in VICTORY with Play again', async ({ page }) => {
    await seedState(page, { fold_lessons: ALL_LESSONS })
    await page.goto('/')
    await waitForGame(page)
    await page.evaluate(() => window.__fold!.jumpTo(5))
    await ff(page, 1)
    await page.evaluate(() => window.__fold!.clearPage())
    for (let i = 0; i < 20 && (await state(page)).page !== 6; i++) await ff(page, 0.5)
    expect((await state(page)).page).toBe(6)
    await ff(page, 1)
    await swipe(page, [0, 0.4], [0, -1.8])
    for (let i = 0; i < 12 && (await state(page)).phase !== 'victory'; i++) await ff(page, 0.5)
    expect((await state(page)).phase).toBe('victory')
    await expect(page.getByText('VICTORY')).toBeVisible()
    await expect(page.getByRole('button', { name: /play again/i })).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: /play again/i }).click()
    await ff(page, 0.5)
    expect((await state(page)).page).toBe(1)
  })
})
