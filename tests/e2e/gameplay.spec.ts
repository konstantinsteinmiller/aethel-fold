import { expect, test } from '@playwright/test'
import { ALL_LESSONS, collectErrors, ff, readSave, screenOf, seedState, state, swipe, waitForGame, skipOutro } from './helpers'

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

  test('boot telemetry records boot_ms and first_input_ms (roadmap #13)', async ({ page }) => {
    await page.goto('/')
    await waitForGame(page)
    const before = await page.evaluate(() => window.__fold!.boot())
    expect(before.boot_ms).toBeGreaterThan(0)
    expect(before.first_input_ms).toBe(-1)
    expect(before.precompile_ms).toBeGreaterThanOrEqual(0)
    const box = (await page.locator('canvas.fold-canvas').boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.85)
    const after = await page.evaluate(() => window.__fold!.boot())
    expect(after.first_input_ms).toBeGreaterThanOrEqual(after.boot_ms)
    expect(after.boot_ms).toBe(before.boot_ms)
    // Nothing of it is persisted: the save stays the one aethel_state object.
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => /boot/i.test(k)))
    expect(keys).toEqual([])
  })

  test('hold to fold: a press held on the wall folds it, no swipe (roadmap #14)', async ({ page }) => {
    await seedState(page, { fold_lessons: ALL_LESSONS, fold_settings: { haptics: true, shake: true, quality: 'auto', holdToFold: true } })
    await page.goto('/')
    await waitForGame(page)
    for (let i = 0; i < 40 && (await state(page)).folds[0]?.phase !== 'ready'; i++) await ff(page, 0.25)
    expect((await state(page)).folds[0]!.phase).toBe('ready')
    const a = await screenOf(page, 0, -0.75)
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    // The hold runs on the real clock, frame by frame (SwiftShader is slow: give it time).
    await expect.poll(async () => (await state(page)).folds[0]!.phase, { timeout: 15_000 }).not.toBe('ready')
    await expect.poll(async () => (await state(page)).folds[0]!.phase, { timeout: 15_000 }).toMatch(/snapping|up/)
    await page.mouse.up()
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
    // First encounter: the hand demonstrates the fold (roadmap #4) until the player acts.
    await expect(page.locator('.ghost.ghost--demo')).toBeAttached()
    await page.screenshot({ path: 'test-results/lesson-demo.png' })
    const f = (await state(page)).folds[0]!
    expect(f.phase).toBe('ready')
    await swipe(page, [0, -0.75], [0, -2.5])
    await page.waitForTimeout(300)
    await ff(page, 0.4)
    const after = await state(page)
    expect(['up', 'snapping']).toContain(after.folds[0]!.phase)
    expect(after.score).toBeGreaterThan(0)
    expect(after.lesson).toBe(null)
    await expect(page.locator('.ghost--demo')).toHaveCount(0)
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
    await skipOutro(page)
    await expect(page.getByText('VICTORY')).toBeVisible()
    await expect(page.getByRole('button', { name: /play again/i })).toBeVisible({ timeout: 15_000 })
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

test.describe('Aethel Fold — page secrets (roadmap #15)', () => {
  test('a page secret: the desk lamp turns night on and off, is found once, and night mode survives a reload', async ({ page }) => {
    const errors = collectErrors(page)
    await seedState(page, { fold_lessons: ALL_LESSONS })
    await page.goto('/')
    await waitForGame(page)
    let s = await state(page)
    expect(s.secrets.found).toEqual([])
    expect(s.secrets.night).toBe(false)
    const score = s.score
    // A real tap on the lamp behind the book (no highlight, no hint: it is a secret).
    const lamp = await page.evaluate(() => window.__fold!.lampScreen())
    await page.mouse.click(lamp.x, lamp.y)
    await ff(page, 0.8)
    s = await state(page)
    expect(s.secrets.night).toBe(true)
    expect(s.secrets.found).toEqual(['lamp'])
    // The one-time bonus (and no fold, stamp or tap on the page happened).
    expect(s.score).toBe(score + 250)
    await page.screenshot({ path: 'test-results/secret-lamp-night.png' })
    let save = await readSave(page)
    expect(save?.fold_secrets).toEqual(['lamp'])
    expect(save?.fold_settings?.night).toBe(true)
    // Off again: no second bonus.
    await page.mouse.click(lamp.x, lamp.y)
    await ff(page, 0.5)
    s = await state(page)
    expect(s.secrets.night).toBe(false)
    expect(s.score).toBe(score + 250)
    expect((await readSave(page))?.fold_settings?.night).toBe(false)
    // On, and a reload keeps it (and the find).
    await page.mouse.click(lamp.x, lamp.y)
    await ff(page, 0.5)
    await page.waitForTimeout(600)
    await page.reload()
    await waitForGame(page)
    s = await state(page)
    expect(s.secrets.night).toBe(true)
    expect(s.secrets.found).toEqual(['lamp'])
    save = await readSave(page)
    expect(save?.fold_secrets).toEqual(['lamp'])
    // Only the one save key.
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('fold') || k.includes('secret') || k.includes('night')))).toEqual([])
    expect(errors).toEqual([])
  })
})
