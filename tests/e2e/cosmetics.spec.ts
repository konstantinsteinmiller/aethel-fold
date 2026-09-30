import { expect, test, type Page } from '@playwright/test'
import { ALL_LESSONS, collectErrors, readSave, seedState, waitForGame } from './helpers'

// ─── Paper cosmetics (roadmap #6) and seasonal skins (roadmap #17) ──────────
//
// `?season=` pins the season so the specs don't depend on today's date.

const openSettings = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: /pause and settings/i }).click()
  await page.getByRole('button', { name: /^settings$/i }).click()
  await expect(page.getByTestId('cosmetics')).toBeAttached()
}

const look = (page: Page) => page.evaluate(() => window.__fold!.look())

test('equip a paper, a confetti cut and a hero on the settings face; they stay across a reload', async ({ page }) => {
  const errors = collectErrors(page)
  // 20 stars: graph, stars, scarf, washi, hearts, sash, newsprint — not the map, the cranes or the crown.
  await seedState(page, {
    fold_lessons: ALL_LESSONS,
    fold_stars: { b1p1: 3, b1p2: 3, b1p3: 3, b1p4: 3, b1p5: 3, b2p1: 3, b2p2: 2 }
  })
  await page.goto('/?season=none')
  await waitForGame(page)
  // Stars earned before (another device, an older build) unlocked quietly at boot.
  expect((await readSave(page))?.fold_cosmetics?.owned).toEqual(
    ['paper.graph', 'paper.washi', 'paper.newsprint', 'hero.scarf', 'hero.sash', 'confetti.stars', 'confetti.hearts']
  )
  expect((await look(page)).page).toEqual({ paper: 'plain', season: 'none' })

  await openSettings(page)
  // A locked one is a silhouette with its stars, and does nothing.
  const map = page.getByTestId('look-paper.map')
  await expect(map).toHaveAttribute('aria-disabled', 'true')
  await expect(map.locator('.cootie__swatch-req')).toContainText('26')
  await map.click({ force: true })
  expect((await look(page)).want.paper).toBe('plain')

  await page.getByTestId('look-paper.washi').click()
  await expect(page.getByTestId('look-paper.washi')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('looks-paper')).toContainText('Washi')
  // The page in play is reprinted behind the menu (idle time while paused).
  await page.waitForFunction(() => window.__fold!.look().page?.paper === 'washi', null, { timeout: 15_000 })
  await page.getByTestId('look-confetti.hearts').click()
  await page.getByTestId('look-hero.sash').click()
  const now = await look(page)
  expect(now.confetti).toBe('hearts')
  expect(now.want).toEqual({ paper: 'washi', hero: 'sash', confetti: 'hearts', season: 'none' })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  const save = await readSave(page)
  expect(save?.fold_cosmetics?.equipped).toEqual({ paper: 'washi', hero: 'sash', confetti: 'hearts' })
  // One save object: nothing else in localStorage for it.
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('fold_')))).toEqual([])

  await page.reload()
  await waitForGame(page)
  const after = await look(page)
  expect(after.page).toEqual({ paper: 'washi', season: 'none' })
  expect(after.confetti).toBe('hearts')
  expect(after.want.hero).toBe('sash')
  expect(errors).toEqual([])
})

test('a page clear whose stars unlock a cosmetic shows the unlock card after the star ribbon', async ({ page }) => {
  const errors = collectErrors(page)
  // One star banked: clearing page 1 unhurt (★★ at least) reaches the graph paper's 3.
  await seedState(page, { fold_lessons: ALL_LESSONS, fold_stars: { b2p5: 1 } })
  await page.goto('/?season=none')
  await waitForGame(page)
  await page.evaluate(() => window.__fold!.fastForward(1))
  await page.evaluate(() => window.__fold!.clearPage())
  await page.evaluate(() => window.__fold!.fastForward(0.2))
  const cue = page.locator('.unlock-cue.is-on')
  await cue.waitFor({ state: 'attached' })
  await expect(cue.locator('[data-cosmetic="paper.graph"]')).toBeAttached()
  // It waits for the ribbon: its drop starts after the stars have folded in.
  const delay = await page.evaluate(() => {
    const a = document.querySelector('.unlock-cue.is-on')!.getAnimations()[0]!
    return Number(a.effect!.getComputedTiming().delay)
  })
  expect(delay).toBeGreaterThan(2000)
  expect((await readSave(page))?.fold_cosmetics?.owned).toContain('paper.graph')
  expect(errors).toEqual([])
})

/**
 * Mean RGB of the middle of the page in a screenshot (decoded in the page),
 * and (4th value) the share of its pixels that read as snow: bright, and as
 * blue as they are red (parchment under the warm lamp is far redder than blue).
 */
const pageColour = async (page: Page): Promise<[number, number, number, number]> => {
  const png = (await page.screenshot()).toString('base64')
  const box = await page.evaluate(() => {
    const f = window.__fold!
    const a = f.screenOf(-3.5, -3)
    const b = f.screenOf(3.5, 3)
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
  })
  return page.evaluate(async ({ png, box }) => {
    const img = new Image()
    img.src = `data:image/png;base64,${png}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0)
    const k = img.width / window.innerWidth
    const d = g.getImageData(Math.round(box.x * k), Math.round(box.y * k), Math.round(box.w * k), Math.round(box.h * k)).data
    let r = 0
    let gg = 0
    let b = 0
    let snow = 0
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]!
      gg += d[i + 1]!
      b += d[i + 2]!
      if (d[i + 2]! - d[i]! > -28 && d[i]! + d[i + 1]! + d[i + 2]! > 600) snow++
    }
    const n = d.length / 4
    return [r / n, gg / n, b / n, snow / n] as [number, number, number, number]
  }, { png, box })
}

test('season override: Halloween and Winter skins print, the bats wait for the first input, screenshots differ', async ({ page }) => {
  const errors = collectErrors(page)
  const colours: Record<string, [number, number, number, number]> = {}
  for (const season of ['none', 'halloween', 'winter'] as const) {
    await page.goto(`/?season=${season}`)
    await waitForGame(page)
    const l = await look(page)
    expect(l.want.season).toBe(season)
    expect(l.page).toEqual({ paper: 'plain', season })
    // Seasonal atlas frames are never painted at boot (roadmap #13's budget).
    expect((await page.evaluate(() => window.__fold!.boot().paint)).atlasSeason).toBe(0)
    expect(l.bats).toBe(false)
    // Winter's falling snow shows at once (it's one instanced draw; nothing to paint).
    expect(l.snow).toBe(season === 'winter')
    colours[season] = await pageColour(page)
    await page.screenshot({ path: `test-results/season-${season}.png` })
    if (season === 'halloween') {
      // The first press lets the idle warm-up paint the deferred frames, bats included.
      await page.mouse.click(8, Math.round((page.viewportSize()?.height ?? 800) * 0.97))
      await page.waitForFunction(() => window.__fold!.look().bats, null, { timeout: 20_000 })
      expect((await page.evaluate(() => window.__fold!.boot().paint)).atlasSeason).toBeGreaterThan(0)
    }
  }
  const diff = (a: number[], b: number[]) => Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!)
  // The skins are visible but gentle: the page changes colour, it doesn't turn into another page.
  console.log('page colours', JSON.stringify(colours))
  expect(diff(colours.halloween!, colours.none!)).toBeGreaterThan(3)
  expect(diff(colours.halloween!, colours.none!), 'halloween').toBeLessThan(90)
  // Winter must read under the desk lamp (the owner found it too subtle: the mean colour moved by
  // ~33, blue against red by ~20, and no pixel read as snow). Now the lamp turns to a cool winter
  // daylight and the page is snowed over: a large shift in the mean colour (measured ~120), blue
  // up against red by far more (~110), and most of the page reading as snow (~0.7, none on plain
  // parchment) — while it is still the same page (the lanes and folds are left clear).
  const cool = (c: number[]) => c[2]! - c[0]!
  expect(diff(colours.winter!, colours.none!), 'winter').toBeGreaterThan(80)
  expect(diff(colours.winter!, colours.none!), 'winter').toBeLessThan(170)
  expect(cool(colours.winter!) - cool(colours.none!)).toBeGreaterThan(60)
  expect(colours.none![3]).toBeLessThan(0.05)
  expect(colours.winter![3]).toBeGreaterThan(0.5)
  // Winter's snow paper is brighter than plain parchment.
  const lum = (c: number[]) => c[0]! + c[1]! + c[2]!
  expect(lum(colours.winter!)).toBeGreaterThan(lum(colours.none!))
  // The DEV handle switches a skin live (repainted behind a pause, or on the next page).
  expect(await page.evaluate(() => window.__fold!.setSeason('halloween'))).toBe('halloween')
  expect(errors).toEqual([])
})

test('turning seasonal decorations off takes the skin off (and back on)', async ({ page }) => {
  // No override: the local date says Halloween (only `new Date()` is pinned; clocks and timers run as ever).
  await page.addInitScript(() => {
    const Real = Date
    class OctoberDate extends Real {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(2026, 9, 20, 12, 0)
        else super(...(args as [number]))
      }
    }
    ;(window as unknown as { Date: DateConstructor }).Date = OctoberDate as unknown as DateConstructor
  })
  await page.goto('/')
  await waitForGame(page)
  expect((await look(page)).want.season).toBe('halloween')
  await openSettings(page)
  const sw = page.getByTestId('setting-seasonal')
  await sw.click()
  await page.waitForFunction(() => window.__fold!.look().page?.season === 'none', null, { timeout: 15_000 })
  expect((await readSave(page))?.fold_settings?.seasonal).toBe(false)
  await sw.click()
  await page.waitForFunction(() => window.__fold!.look().page?.season === 'halloween', null, { timeout: 15_000 })
})
