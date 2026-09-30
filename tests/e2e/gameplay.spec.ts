import { expect, test } from '@playwright/test'
import { ALL_LESSONS, collectErrors, ff, readSave, screenOf, seedState, state, swipe, waitForGame } from './helpers'

test.describe('Aethel Fold — gameplay', () => {
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

  test('a crumple shows how close it was, then Try again drops the page back with full hearts', async ({ page }) => {
    await seedState(page, { fold_lessons: ALL_LESSONS })
    await page.goto('/')
    await waitForGame(page)
    await page.evaluate(() => window.__fold!.jumpTo(2))
    await ff(page, 3)
    // Three hits through the gate: the hero goes down and the page crumples.
    await page.evaluate(() => {
      const g = window.__fold!.game
      for (let k = 0; k < 3; k++) {
        g.hero.invuln = 0
        g.hurtHero(0, 5)
      }
    })
    const left = await page.evaluate(() => window.__fold!.state().enemiesLeft)
    expect(left).toBeGreaterThan(0)
    await ff(page, 0.05)
    await expect(page.locator('.fx-almost')).toContainText('ALMOST!')
    await expect(page.locator('.fx-almost')).toContainText(`${left} soldier`)
    const button = page.getByTestId('almost-retry')
    // A fresh page would drop by itself after a few seconds: hold the clock.
    await ff(page, 2)
    await expect(button).toBeVisible({ timeout: 5000 })
    await expect(button).toContainText('Try again')
    // (The attention pulse never lets Playwright call it "stable"; a finger doesn't care.)
    await button.click({ force: true })
    const s = await state(page)
    expect(['drop', 'play']).toContain(s.phase)
    expect(s.hp).toBe(3)
    expect(s.page).toBe(2)
    await expect(button).toHaveCount(0)
    // The kind book remembers the crumple in the one save object.
    await expect.poll(async () => (await readSave(page))?.fold_run?.crumples?.b1p2).toBe(1)
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

test.describe('Aethel Fold — loading screen', () => {
  test('shows the logo and a progress bar from the first paint, and clears once the game is on screen', async ({ page }) => {
    // Hold the game chunk back so the loading screen has something to cover.
    await page.route('**/src/views/FoldScene.vue*', async (r) => {
      await new Promise((ok) => setTimeout(ok, 2500))
      await r.continue()
    })
    await page.goto('/')
    await expect(page.locator('#static-splash .splash-bar__fill')).toBeAttached()
    await expect(page.locator('.splash-progress, #static-splash .splash-bar').first()).toBeVisible()
    // Still loading (the chunk is held): the splash must not have given up.
    await page.waitForTimeout(1500)
    await expect(page.locator('.splash-progress')).toBeVisible()
    await waitForGame(page)
    await expect(page.locator('.splash-progress')).toHaveCount(0, { timeout: 15_000 })
  })
})
