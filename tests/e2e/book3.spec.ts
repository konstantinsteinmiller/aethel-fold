import { expect, test } from '@playwright/test'
import { ALL_LESSONS, collectErrors, ff, readSave, seedState, state, swipe, tapShelf, waitForGame } from './helpers'

// Roadmap #3: Book 3 — "The Sea of Paper" (aethel-fold-GDD §13).

/** Books 1 and 2 won: book 3 is open. */
const WON_TWO = { fold_wins: 1, fold_cleared: 6, fold_wins2: 1, fold_cleared2: 6 }

test.describe('Aethel Fold — book 3 (The Sea of Paper)', () => {
  test('jumps to book 3 page 1 with a clean console; the boat lesson demonstrates the fold', async ({ page }) => {
    const errors = collectErrors(page)
    const { boat: _boat, ...learned } = ALL_LESSONS
    await seedState(page, { fold_lessons: learned, ...WON_TWO })
    await page.goto('/')
    await waitForGame(page)
    await page.evaluate(() => window.__fold!.jumpTo(1, 3))
    await ff(page, 0.5)
    const s = await state(page)
    expect(s.book).toBe(3)
    expect(s.page).toBe(1)
    expect(s.folds.map((f) => f.kind)).toContain('boat')
    await expect(page.getByText('The Harbour')).toBeVisible()
    await expect(page.locator('.page-badge[aria-label="Book 3 · Page 1/6"]')).toBeVisible()
    // The first column wades into the harbour channel: the ghost hand shows the boat fold.
    for (let i = 0; i < 40 && (await state(page)).lesson !== 'boat'; i++) await ff(page, 0.5)
    expect((await state(page)).lesson).toBe('boat')
    await expect(page.locator('.ghost.ghost--demo')).toBeVisible()
    await expect(page.locator('.ghost-hint')).toContainText('boat')
    // A real swipe along the dock flap folds the boat: it sails, and the lesson is learned.
    const boat = await page.evaluate(() => {
      const f = window.__fold!.game.folds.find((o: { def: { kind: string } }) => o.def.kind === 'boat')
      return { ax: f.def.ax as number, az: f.def.az as number }
    })
    await swipe(page, [boat.ax + 0.2, boat.az], [boat.ax + 2.4, boat.az])
    await ff(page, 0.4)
    const after = await state(page)
    expect(after.folds.find((f) => f.kind === 'boat')!.phase).toBe('up')
    expect(after.lesson).not.toBe('boat')
    await expect.poll(async () => (await readSave(page))?.fold_lessons?.boat, { timeout: 8000 }).toBe(true)
    await page.waitForTimeout(500)
    expect(errors).toEqual([])
  })

  test('the pleat folds under a real swipe down the strip, and a cleared page turns and saves', async ({ page }) => {
    const errors = collectErrors(page)
    await seedState(page, { fold_lessons: ALL_LESSONS, ...WON_TWO })
    await page.goto('/')
    await waitForGame(page)
    await page.evaluate(() => window.__fold!.jumpTo(2, 3))
    await ff(page, 1)
    const p = await page.evaluate(() => {
      const f = window.__fold!.game.folds.find((o: { def: { kind: string } }) => o.def.kind === 'pleat')
      return { x: f.def.ax as number, z0: f.def.az as number, z1: f.def.bz as number }
    })
    await swipe(page, [p.x, p.z0 + 0.3], [p.x, p.z1 - 0.2], 14)
    await ff(page, 0.6)
    expect(['up', 'snapping']).toContain((await state(page)).folds.find((f) => f.kind === 'pleat')!.phase)
    // Clear the page: it turns to the Lighthouse, and the save has book 3's progress.
    await page.evaluate(() => window.__fold!.clearPage())
    for (let i = 0; i < 20 && (await state(page)).page !== 3; i++) await ff(page, 0.5)
    const s = await state(page)
    expect(s.book).toBe(3)
    expect(s.page).toBe(3)
    await expect(page.getByText('The Lighthouse')).toBeVisible()
    const save = await readSave(page)
    expect(save?.fold_book).toBe(3)
    expect(save?.fold_page).toBe(3)
    expect(save?.fold_cleared3).toBe(2)
    await page.waitForTimeout(500)
    expect(errors).toEqual([])
  })

  test('the kraken: it surfaces, a tentacle crease breaks under a real swipe, and it folds into a fish — VICTORY', async ({ page }) => {
    const errors = collectErrors(page)
    await seedState(page, { fold_lessons: ALL_LESSONS, ...WON_TWO })
    await page.goto('/')
    await waitForGame(page)
    await page.evaluate(() => window.__fold!.jumpTo(5, 3))
    await ff(page, 0.5)
    expect((await state(page)).phase).toBe('boss')
    await expect(page.locator('.boss')).toContainText(/kraken/i)
    // Keep the shield up for the ink and the boarders off the page; wait for the first bared tentacle.
    for (let i = 0; i < 80 && (await state(page)).boss !== 'exposed'; i++) {
      await page.evaluate(() => {
        const g = window.__fold!.game
        for (const e of g.enemies) if (e.state === 'march') e.state = 'dead'
        const si = g.folds.findIndex((f: { def: { id: string } }) => f.def.id === 'd5-shield')
        if (g.boss.phase === 'inkCharge' && g.folds[si].phase === 'ready') g.foldNow(si)
      })
      await ff(page, 0.4)
    }
    expect((await state(page)).boss).toBe('exposed')
    // Let the view lay the tentacle down and sync its crease anchor, then swipe along it toward the mantle.
    await page.waitForTimeout(600)
    const w = await page.evaluate(() => {
      const b = window.__fold!.game.boss
      const wp = b.weakPoints[b.exposed]
      return { i: b.exposed as number, x: wp.x as number, z: wp.z as number, sx: wp.sx as number, sz: wp.sz as number }
    })
    expect(w.i).toBe(0)
    await swipe(page, [w.x - w.sx * 0.6, w.z - w.sz * 0.6], [w.x + w.sx * 1.2, w.z + w.sz * 1.2], 12)
    await ff(page, 0.2)
    expect(await page.evaluate(() => window.__fold!.game.boss.weakPoints[0].broken)).toBe(true)
    // The rest by the debug handle, then the finale fold.
    await page.evaluate(() => window.__fold!.clearPage())
    for (let i = 0; i < 30 && (await state(page)).page !== 6; i++) await ff(page, 0.5)
    expect((await state(page)).page).toBe(6)
    await ff(page, 1)
    await page.evaluate(() => window.__fold!.game.foldNow(0))
    for (let i = 0; i < 12 && (await state(page)).phase !== 'victory'; i++) await ff(page, 0.5)
    expect((await state(page)).phase).toBe('victory')
    await expect(page.getByText('The sea is calm.', { exact: false })).toBeVisible({ timeout: 8000 })
    await expect(page.getByTestId('victory-rush')).toContainText('Kraken Rush')
    const save = await readSave(page)
    expect(save?.fold_wins3).toBe(1)
    expect(save?.fold_cleared3).toBe(6)
    expect(save?.fold_book).toBe(3)
    await page.waitForTimeout(500)
    expect(errors).toEqual([])
  })

  test('book 3 is on the pause bookshelf once book 2 is won (locked before)', async ({ page }) => {
    await seedState(page, { fold_lessons: ALL_LESSONS, fold_wins: 1, fold_cleared: 6 })
    await page.goto('/')
    await waitForGame(page)
    await page.getByRole('button', { name: /pause and settings/i }).click()
    await page.getByTestId('pause-books').click()
    await expect(page.getByTestId('book-3')).toBeDisabled()
    await expect(page.getByTestId('book-3')).toContainText('Win book 2')
  })

  test('on the desk shelf, book 3 stands open once book 2 is won; tapping it twice opens it on page 1', async ({ page }) => {
    const errors = collectErrors(page)
    await seedState(page, { fold_lessons: ALL_LESSONS, ...WON_TWO })
    await page.goto('/')
    await waitForGame(page)
    await ff(page, 0.5)
    expect((await state(page)).shelf.slots).toEqual(['current', 'open', 'open'])
    expect((await state(page)).shelf.rush).toEqual(['open', 'open', 'hidden'])
    await page.evaluate(() => window.__fold!.toggleShelf())
    for (let i = 0; i < 10 && (await state(page)).shelf.camera < 1; i++) await ff(page, 0.3)
    await tapShelf(page, 2)
    await ff(page, 0.6)
    expect((await state(page)).shelf.selected).toBe(2)
    await tapShelf(page, 2)
    await ff(page, 1)
    const s = await state(page)
    expect(s.book).toBe(3)
    expect(s.page).toBe(1)
    expect(s.shelf.open).toBe(false)
    expect((await readSave(page))?.fold_book).toBe(3)
    await page.waitForTimeout(500)
    expect(errors).toEqual([])
  })

  test('C12: a shield-bearer marches onto a book-3 page, and a ballista bolt glances off its shield', async ({ page }) => {
    const errors = collectErrors(page)
    await seedState(page, { fold_lessons: ALL_LESSONS, ...WON_TWO })
    await page.goto('/')
    await waitForGame(page)
    await page.evaluate(() => window.__fold!.jumpTo(2, 3))
    await ff(page, 1)
    // Wave 1 is a plain knight column; sweep it off so wave 2 (a shield-bearer at its head) comes on.
    const bearerZ = (): Promise<number | null> => page.evaluate(() => {
      const g = window.__fold!.game
      for (const e of g.enemies) if (e.type === 'shieldBearer' && e.state === 'march') return e.z as number
      for (const e of g.enemies) if (e.state === 'march') e.state = 'dead'
      return null
    })
    let z: number | null = null
    for (let i = 0; i < 40 && z === null; i++) {
      z = await bearerZ()
      if (z === null) await ff(page, 0.5)
    }
    expect(z).not.toBeNull()
    // It walked in from the top edge (spawnZ), not out of the paper.
    expect(z!).toBeLessThan(-4)
    for (let i = 0; i < 20 && ((await bearerZ()) ?? -99) < -1.5; i++) await ff(page, 0.5)
    await page.setViewportSize({ width: 390, height: 844 })
    await ff(page, 0.2)
    // Open the ballista on its side and shoot straight at it: the bolt is spent on the shield.
    const hit = await page.evaluate(() => {
      const g = window.__fold!.game
      const e = g.enemies.find((o: { type: string; state: string }) => o.type === 'shieldBearer' && o.state === 'march')
      const i = g.folds.findIndex((f: { def: { id: string } }) => f.def.id === (e.x < 0 ? 'ballista-l' : 'ballista-r'))
      g.foldNow(i)
      return { slot: g.enemies.indexOf(e), i }
    })
    await ff(page, 0.3)
    const fired = await page.evaluate(({ slot }) => {
      const g = window.__fold!.game
      const e = g.enemies[slot]
      return g.fireBallista(e.x, e.z)
    }, hit)
    expect(fired).toBe(true)
    // ~7 page units from the tower at 24 units/s.
    await ff(page, 0.5)
    const after = await page.evaluate(({ slot }) => {
      const g = window.__fold!.game
      return { state: g.enemies[slot].state as string, blocked: g.stats.boltsBlocked as number }
    }, hit)
    expect(after.state).toBe('march')
    expect(after.blocked).toBeGreaterThanOrEqual(1)
    await expect(page.locator('.fx-word', { hasText: 'BLOCKED!' }).first()).toBeAttached()
    const shots = process.env.SHIELD_SHOTS
    if (shots) await page.screenshot({ path: `${shots}/book3-shield-bearers-390x844.png` })
    await page.waitForTimeout(500)
    expect(errors).toEqual([])
  })

  test('the Kraken Rush starts from the DEV handle and runs its clock', async ({ page }) => {
    const errors = collectErrors(page)
    await seedState(page, { fold_lessons: ALL_LESSONS, ...WON_TWO, fold_wins3: 1, fold_cleared3: 6 })
    await page.goto('/')
    await waitForGame(page)
    await page.evaluate(() => window.__fold!.startRush(3))
    await ff(page, 2)
    const s = await state(page)
    expect(s.mode).toBe('dragonRush')
    expect(s.book).toBe(3)
    expect(s.rush.par).toBe(60)
    expect(s.rush.time).toBeGreaterThan(1)
    expect(await page.evaluate(() => window.__fold!.game.boss.kind)).toBe('kraken')
    await expect(page.locator('.rush-clock')).toBeVisible()
    expect(errors).toEqual([])
  })
})
