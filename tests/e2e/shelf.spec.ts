import { expect, test } from '@playwright/test'
import { ALL_LESSONS, collectErrors, ff, readSave, seedState, state, tapShelf, waitForGame } from './helpers'

/** Play book 1's finale through to the victory ribbon. */
const winBook1 = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.evaluate(() => window.__fold!.jumpTo(6))
  await ff(page, 1)
  await page.evaluate(() => window.__fold!.game.foldNow(0))
  for (let i = 0; i < 12 && (await state(page)).phase !== 'victory'; i++) await ff(page, 0.5)
  expect((await state(page)).phase).toBe('victory')
}

test.describe('Aethel Fold — the desk bookshelf (chapter select)', () => {
  test('no shelf before the first win', async ({ page }) => {
    await seedState(page, { fold_lessons: ALL_LESSONS })
    await page.goto('/')
    await waitForGame(page)
    const s = await state(page)
    expect(s.shelf.available).toBe(false)
    await expect(page.getByTestId('shelf-zoom')).toHaveCount(0)
  })

  test('winning book 1 turns the camera to the shelf; tapping book 2 twice opens it on page 1', async ({ page }) => {
    const errors = collectErrors(page)
    const { shelf: _learned, ...unlearned } = ALL_LESSONS
    await seedState(page, { fold_lessons: unlearned, fold_cleared: 5 })
    await page.goto('/')
    await waitForGame(page)
    await winBook1(page)
    // The victory card first, then the camera goes out to the shelf by itself.
    await expect(page.getByTestId('victory-book2')).toBeVisible({ timeout: 5000 })
    await ff(page, 7)
    let s = await state(page)
    expect(s.shelf.open).toBe(true)
    expect(s.shelf.camera).toBe(1)
    expect(s.shelf.highlight).toBe(1)
    expect(s.shelf.slots).toEqual(['open', 'open', 'coming'])
    await expect(page.getByTestId('victory-book2')).toHaveCount(0)
    // The wordless hand points at the glowing book.
    expect(s.lesson).toBe('shelf')
    await expect(page.locator('.ghost')).toBeVisible()
    await page.screenshot({ path: 'test-results/shelf-victory.png' })
    // First tap pulls it out to inspect…
    await tapShelf(page, 1)
    await ff(page, 0.6)
    s = await state(page)
    expect(s.shelf.selected).toBe(1)
    expect(s.shelf.open).toBe(true)
    await page.screenshot({ path: 'test-results/shelf-inspect.png' })
    // …the second opens it.
    await tapShelf(page, 1)
    await ff(page, 0.5)
    s = await state(page)
    expect(s.book).toBe(2)
    expect(s.page).toBe(1)
    expect(s.shelf.open).toBe(false)
    await expect(page.locator('.page-badge[aria-label="Book 2 · Page 1/6"]')).toBeVisible()
    const save = await readSave(page)
    expect(save?.fold_book).toBe(2)
    expect(save?.fold_page).toBe(1)
    expect(save?.fold_lessons?.shelf).toBe(true)
    await page.waitForTimeout(500)
    expect(errors).toEqual([])
  })

  test('portrait: the zoom button goes out to the shelf (the world stops), the current book goes back in', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedState(page, { fold_lessons: ALL_LESSONS, fold_wins: 1, fold_cleared: 6, fold_stars: { b1p1: 3, b1p2: 1 } })
    await page.goto('/')
    await waitForGame(page)
    await ff(page, 3)
    let s = await state(page)
    expect(s.shelf.available).toBe(true)
    expect(s.shelf.inView).toBe(false)
    const zoom = page.getByTestId('shelf-zoom')
    await expect(zoom).toBeVisible()
    await expect(zoom).toHaveAttribute('aria-label', 'Bookshelf')
    await zoom.click()
    await ff(page, 1.5)
    s = await state(page)
    expect(s.shelf.open).toBe(true)
    expect(s.shelf.camera).toBe(1)
    expect(s.shelf.selected).toBe(0)
    expect(s.timeScale).toBeLessThan(0.05)
    await expect(zoom).toHaveAttribute('aria-label', 'Back to the book')
    await page.screenshot({ path: 'test-results/shelf-portrait.png' })
    // A locked or coming book only shakes.
    await tapShelf(page, 2)
    await ff(page, 0.3)
    expect((await state(page)).shelf.selected).toBe(0)
    // The current book is already pulled out: one tap continues where we were.
    const before = s.score
    await tapShelf(page, 0)
    await ff(page, 1.5)
    s = await state(page)
    expect(s.shelf.open).toBe(false)
    expect(s.book).toBe(1)
    expect(s.page).toBe(1)
    expect(s.score).toBeGreaterThanOrEqual(before)
    expect(s.shelf.camera).toBe(0)
    expect(s.timeScale).toBeGreaterThan(0.9)
  })

  test('wide screens see the shelf beside the book: a tap on a book goes straight to it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await seedState(page, { fold_lessons: ALL_LESSONS, fold_wins: 1, fold_cleared: 6 })
    await page.goto('/')
    await waitForGame(page)
    await ff(page, 1)
    let s = await state(page)
    expect(s.shelf.inView).toBe(true)
    await expect(page.getByTestId('shelf-zoom')).toHaveCount(0)
    await tapShelf(page, 1)
    await ff(page, 0.2)
    s = await state(page)
    expect(s.shelf.open).toBe(true)
    expect(s.shelf.selected).toBe(1)
    // Escape goes back to the book.
    await page.keyboard.press('Escape')
    await ff(page, 0.2)
    s = await state(page)
    expect(s.shelf.open).toBe(false)
    await expect(page.getByRole('dialog', { name: 'Paused' })).toHaveCount(0)
  })

  test('folding the won book shut (a sweep right to left) goes to the shelf', async ({ page }) => {
    // Wide, so the sweep has desk to run on beside the victory card.
    await page.setViewportSize({ width: 1280, height: 720 })
    await seedState(page, { fold_lessons: ALL_LESSONS, fold_cleared: 5 })
    await page.goto('/')
    await waitForGame(page)
    await winBook1(page)
    const y = 720 * 0.86
    await page.mouse.move(1280 * 0.97, y)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(1280 * (0.97 - 0.035 * i), y)
    await page.mouse.up()
    await ff(page, 0.2)
    expect((await state(page)).shelf.open).toBe(true)
  })
})
