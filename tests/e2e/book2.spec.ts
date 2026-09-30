import { expect, test } from '@playwright/test'
import { ALL_LESSONS, collectErrors, ff, readSave, screenOf, seedState, state, waitForGame } from './helpers'

/** Pull the sling back from its cup by (dx, dz) page units with the real mouse, then let go. */
const pullSling = async (page: import('@playwright/test').Page, dx: number, dz: number): Promise<void> => {
  const s = (await state(page)).sling!
  const a = await screenOf(page, s.x, s.z)
  const b = await screenOf(page, s.x + dx, s.z + dz)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8)
  await page.mouse.up()
}

test.describe('Aethel Fold — book 2 (The Homefront)', () => {
  test('book 2 stays locked until book 1 is won', async ({ page }) => {
    await seedState(page, { fold_lessons: ALL_LESSONS })
    await page.goto('/')
    await waitForGame(page)
    await page.getByRole('button', { name: /pause and settings/i }).click()
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible()
    await expect(page.getByTestId('pause-books')).toHaveCount(0)
  })

  test('after a win, the bookshelf opens book 2, which survives a reload', async ({ page }) => {
    const errors = collectErrors(page)
    await seedState(page, { fold_lessons: ALL_LESSONS, fold_wins: 1, fold_cleared: 6, fold_stars: { b1p1: 3, b1p2: 2, b2p1: 1 } })
    await page.goto('/')
    await waitForGame(page)
    await page.getByRole('button', { name: /pause and settings/i }).click()
    await page.getByTestId('pause-books').click()
    // Each book on the shelf shows the stars earned in it.
    await expect(page.getByTestId('book-1-stars')).toHaveAttribute('aria-label', '5 of 15 stars')
    await expect(page.getByTestId('book-2-stars')).toHaveAttribute('aria-label', '1 of 15 stars')
    await page.getByTestId('book-2').click()
    await ff(page, 0.5)
    const s = await state(page)
    expect(s.book).toBe(2)
    expect(s.page).toBe(1)
    await expect(page.getByText('The Home Keep')).toBeVisible()
    await expect(page.locator('.page-badge[aria-label="Book 2 · Page 1/6"]')).toBeVisible()
    expect(s.sling).not.toBeNull()
    const save = await readSave(page)
    expect(save?.fold_book).toBe(2)
    await page.reload()
    await waitForGame(page)
    expect((await state(page)).book).toBe(2)
    await page.waitForTimeout(1000)
    expect(errors).toEqual([])
  })

  test('pulling the sling back and letting go fires a stone up the page', async ({ page }) => {
    await seedState(page, { fold_lessons: ALL_LESSONS, fold_wins: 1, fold_book: 2, fold_page: 1 })
    await page.goto('/')
    await waitForGame(page)
    await ff(page, 1)
    expect((await state(page)).book).toBe(2)
    // Pull toward the player (down the page) and a little right: the shot flies up-left.
    await pullSling(page, 0.4, 1.2)
    const s = await state(page)
    expect(s.sling!.shots).toBe(1)
    expect(s.sling!.cool).toBeGreaterThan(0)
    // Reloads.
    await ff(page, 2)
    expect((await state(page)).sling!.cool).toBe(0)
  })

  test('winning book 1 offers book 2 on the victory card', async ({ page }) => {
    await seedState(page, { fold_lessons: ALL_LESSONS })
    await page.goto('/')
    await waitForGame(page)
    await page.evaluate(() => window.__fold!.jumpTo(6))
    await ff(page, 1)
    await page.evaluate(() => window.__fold!.game.foldNow(0))
    for (let i = 0; i < 12 && (await state(page)).phase !== 'victory'; i++) await ff(page, 0.5)
    await expect(page.getByTestId('victory-book2')).toBeVisible({ timeout: 5000 })
    await page.getByTestId('victory-book2').click()
    await ff(page, 0.5)
    const s = await state(page)
    expect(s.book).toBe(2)
    expect(s.page).toBe(1)
  })
})
