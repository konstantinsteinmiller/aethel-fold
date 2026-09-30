import { expect, test } from '@playwright/test'
import { settleRibbon, waitForGame } from './helpers'

const VIEWPORTS = [
  { name: 'phone-portrait-min', width: 320, height: 658 },
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'phone-landscape-min', width: 658, height: 320 },
  { name: 'phone-landscape', width: 844, height: 390 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1920, height: 1080 }
]

for (const vp of VIEWPORTS) {
  test(`HUD fits without overlap at ${vp.name} (${vp.width}×${vp.height})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto('/')
    await waitForGame(page)
    await page.waitForTimeout(800)
    const boxes = await page.evaluate(() => {
      const q = (sel: string) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height }
      }
      return {
        page: q('.page-badge'),
        hearts: q('.hearts'),
        score: q('.score__tag'),
        right: q('.hud-right')
      }
    })
    for (const [k, b] of Object.entries(boxes)) {
      expect(b, k).not.toBeNull()
      expect(b!.w, `${k} width`).toBeGreaterThan(20)
      expect(b!.h, `${k} height`).toBeGreaterThan(20)
      expect(b!.x, `${k} left`).toBeGreaterThanOrEqual(0)
      expect(b!.x + b!.w, `${k} right`).toBeLessThanOrEqual(vp.width + 1)
    }
    const overlap = (a: any, b: any) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    expect(overlap(boxes.page, boxes.score)).toBe(false)
    expect(overlap(boxes.score, boxes.right)).toBe(false)
    expect(overlap(boxes.hearts, boxes.score)).toBe(false)
    await page.screenshot({ path: `test-results/responsive-${vp.name}.png` })
  })
}

// The reported case: German ("Buch 2 · Seite 6/6 / Endlich Frieden") next to a
// five-digit score on a phone in portrait. The page badge must stay in its
// column and never slide under the score badge.
for (const width of [320, 360, 390, 412]) {
  test(`long page label + five-digit score never overlap at ${width}px portrait (de)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 })
    await page.addInitScript(() => {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
      localStorage.setItem('aethel_state', JSON.stringify({
        user_language: 'de', fold_wins: 1, fold_book: 2, fold_page: 6,
        fold_run: { score: 44720, hits: 0, time: 300 }, fold_best: { score: 44720, time: 300 }
      }))
    })
    await page.goto('/')
    await waitForGame(page)
    await expect(page.locator('.page-badge[aria-label="Buch 2 · Seite 6/6"]')).toBeAttached()
    await page.waitForTimeout(800)
    const b = await page.evaluate(() => {
      const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect()
      const p = r('.page-badge')
      const s = r('.score__tag')
      const h = r('.hearts')
      return { pRight: p.right, pBottom: p.bottom, sLeft: s.left, sBottom: s.bottom, hRight: h.right }
    })
    expect(b.pRight, 'page badge right edge vs score left edge').toBeLessThanOrEqual(b.sLeft + 0.5)
    expect(b.hRight).toBeLessThanOrEqual(b.sLeft + 0.5)
  })
}

// The star ribbon (roadmap #1) drops in under the HUD strip on a cleared page:
// it must stay inside the screen and never cover the HUD.
for (const vp of [{ width: 320, height: 658 }, { width: 658, height: 320 }, { width: 844, height: 390 }]) {
  test(`the star ribbon stays clear of the HUD at ${vp.width}×${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp)
    await page.addInitScript(() => {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
      localStorage.setItem('aethel_state', JSON.stringify({
        fold_lessons: {
          swipe: true, stamp: true, shield: true, launch: true, ridge: true, spread: true, peel: true, crease: true,
          core: true, frog: true, crush: true, sling: true, leaper: true, ballista: true
        }
      }))
    })
    await page.goto('/')
    await waitForGame(page)
    await page.evaluate(() => window.__fold!.fastForward(1))
    await page.evaluate(() => window.__fold!.clearPage())
    await page.evaluate(() => window.__fold!.fastForward(0.2))
    // Mid-hang, every earned star folded in (frozen there: see settleRibbon).
    await settleRibbon(page)
    const b = await page.evaluate(() => {
      const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect()
      const band = r('.star-ribbon__band')
      const hud = [r('.page-badge'), r('.hearts'), r('.score__tag'), r('.hud-right')]
      return { band: { x: band.x, y: band.y, w: band.width, h: band.height }, hudBottom: Math.max(...hud.map((h) => h.bottom)) }
    })
    expect(b.band.w).toBeGreaterThan(40)
    expect(b.band.x).toBeGreaterThanOrEqual(0)
    expect(b.band.x + b.band.w).toBeLessThanOrEqual(vp.width + 1)
    expect(b.band.y, 'ribbon top vs HUD bottom').toBeGreaterThanOrEqual(b.hudBottom - 0.5)
    expect(b.band.y + b.band.h).toBeLessThan(vp.height * 0.45)
    // …and never over the book: clear of its cover (page ± a cover margin) on one side or above it.
    const book = await page.evaluate(() => {
      const f = window.__fold!
      const pts = [[-5.4, -7.4], [5.4, -7.4], [-5.4, 7.4], [5.4, 7.4]].map(([x, z]) => f.screenOf(x!, z!))
      return {
        left: Math.min(...pts.map((p) => p.x)), right: Math.max(...pts.map((p) => p.x)), top: Math.min(...pts.map((p) => p.y))
      }
    })
    const clear = b.band.y + b.band.h <= book.top || b.band.x >= book.right || b.band.x + b.band.w <= book.left
    expect(clear, `ribbon ${JSON.stringify(b.band)} vs book ${JSON.stringify(book)}`).toBe(true)
    await page.screenshot({ path: `test-results/star-ribbon-${vp.width}x${vp.height}.png` })
  })
}

// Short landscape with a book won: the desk bookshelf stands right of the book,
// in the column the star ribbon hangs in. The ribbon fits above the shelf.
for (const vp of [{ width: 658, height: 320 }, { width: 844, height: 390 }]) {
  test(`the star ribbon stays clear of the desk bookshelf at ${vp.width}×${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp)
    await page.addInitScript(() => {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
      localStorage.setItem('aethel_state', JSON.stringify({
        fold_wins: 1, fold_cleared: 6,
        fold_lessons: {
          swipe: true, stamp: true, shield: true, launch: true, ridge: true, spread: true, peel: true, crease: true,
          core: true, frog: true, crush: true, sling: true, leaper: true, ballista: true, shelf: true
        }
      }))
    })
    await page.goto('/')
    await waitForGame(page)
    expect((await page.evaluate(() => window.__fold!.state().shelf.inView))).toBe(true)
    await page.evaluate(() => window.__fold!.fastForward(1))
    await page.evaluate(() => window.__fold!.clearPage())
    await page.evaluate(() => window.__fold!.fastForward(0.2))
    await settleRibbon(page)
    const b = await page.evaluate(() => {
      const band = document.querySelector('.star-ribbon__band')!.getBoundingClientRect()
      const hud = [...document.querySelectorAll('.page-badge, .hearts, .score__tag, .hud-right')].map((e) => e.getBoundingClientRect().bottom)
      const f = window.__fold!
      const pts = [[-5.4, -7.4], [5.4, -7.4], [-5.4, 7.4], [5.4, 7.4]].map(([x, z]) => f.screenOf(x!, z!))
      return {
        band: { x: band.x, y: band.y, w: band.width, h: band.height },
        hudBottom: Math.max(...hud),
        shelfTop: f.engine.shelfTop() as number,
        bookRight: Math.max(...pts.map((p) => p.x)),
        bookTop: Math.min(...pts.map((p) => p.y))
      }
    })
    expect(Number.isFinite(b.shelfTop)).toBe(true)
    expect(b.band.w).toBeGreaterThan(40)
    expect(b.band.y, 'ribbon top vs HUD bottom').toBeGreaterThanOrEqual(b.hudBottom - 0.5)
    expect(b.band.y + b.band.h, 'ribbon bottom vs shelf top').toBeLessThanOrEqual(b.shelfTop)
    expect(b.band.x + b.band.w).toBeLessThanOrEqual(vp.width + 1)
    const clearOfBook = b.band.y + b.band.h <= b.bookTop || b.band.x >= b.bookRight
    expect(clearOfBook, `ribbon ${JSON.stringify(b.band)} vs book right ${b.bookRight} top ${b.bookTop}`).toBe(true)
    await page.screenshot({ path: `test-results/star-ribbon-shelf-${vp.width}x${vp.height}.png` })
  })
}

// The settings face of the pause (with the accessibility rows, roadmap #14) fits
// the smallest phone both ways: every row inside the card, none overlapping.
for (const vp of [{ width: 320, height: 658 }, { width: 658, height: 320 }]) {
  test(`the settings face fits at ${vp.width}×${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp)
    await page.goto('/')
    await waitForGame(page)
    await page.getByRole('button', { name: /pause and settings/i }).click()
    await page.getByRole('button', { name: /^settings$/i }).click()
    await expect(page.getByTestId('setting-hold')).toBeAttached()
    // The card folds in with a scale/rotate transition: measure once it has settled.
    await page.waitForFunction(() => {
      const card = document.querySelector('.cootie__card')
      return !!card && card.getAnimations({ subtree: true }).length === 0 && getComputedStyle(card).transform === 'none'
    })
    const r = await page.evaluate(() => {
      const box = (e: Element) => {
        const b = e.getBoundingClientRect()
        return { x: b.x, y: b.y, w: b.width, h: b.height }
      }
      const card = box(document.querySelector('.cootie__scroll')!)
      const rows = [...document.querySelectorAll('.cootie__settings > .cootie__row')].map((row) => ({
        row: box(row),
        parts: [...row.children].map(box),
        scrollW: row.scrollWidth,
        clientW: row.clientWidth
      }))
      return { card, rows }
    })
    expect(r.rows.length).toBe(9)
    const overlap = (a: any, b: any) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5
    for (const row of r.rows) {
      expect(row.row.x).toBeGreaterThanOrEqual(r.card.x - 0.5)
      expect(row.row.x + row.row.w).toBeLessThanOrEqual(r.card.x + r.card.w + 0.5)
      expect(row.scrollW, 'row content overflows').toBeLessThanOrEqual(row.clientW + 1)
      // Label and control side by side, never on top of each other.
      expect(overlap(row.parts[0], row.parts[1])).toBe(false)
    }
    for (let i = 0; i < r.rows.length; i++) {
      for (let j = i + 1; j < r.rows.length; j++) expect(overlap(r.rows[i]!.row, r.rows[j]!.row), `rows ${i}/${j}`).toBe(false)
    }
    await page.screenshot({ path: `test-results/settings-${vp.width}x${vp.height}.png` })
  })
}

// The desk bookshelf's zoom button (roadmap #2) sits in the HUD's right column,
// under mute and settings — only where the camera can't already see the shelf.
for (const vp of [{ width: 320, height: 658, button: true }, { width: 390, height: 844, button: true }, { width: 658, height: 320, button: false }, { width: 844, height: 390, button: false }]) {
  test(`the shelf zoom button fits the HUD grid at ${vp.width}×${vp.height}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.addInitScript(() => {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
      localStorage.setItem('aethel_state', JSON.stringify({
        user_language: 'de', fold_wins: 1, fold_cleared: 6, fold_run: { score: 44720, hits: 0, time: 300 },
        fold_best: { score: 44720, time: 300 }, fold_page: 3
      }))
    })
    await page.goto('/')
    await waitForGame(page)
    await page.waitForTimeout(800)
    const zoom = page.getByTestId('shelf-zoom')
    if (!vp.button) {
      await expect(zoom).toHaveCount(0)
      expect(await page.evaluate(() => window.__fold!.state().shelf.inView)).toBe(true)
      return
    }
    await expect(zoom).toBeVisible()
    const b = await page.evaluate(() => {
      const r = (sel: string) => {
        const e = document.querySelector(sel)!.getBoundingClientRect()
        return { x: e.x, y: e.y, w: e.width, h: e.height }
      }
      return { zoom: r('[data-testid="shelf-zoom"]'), page: r('.page-badge'), hearts: r('.hearts'), score: r('.score__tag'), row: r('.hud-right__row') }
    })
    const overlap = (a: any, c: any) => a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h
    expect(b.zoom.w).toBeGreaterThanOrEqual(36)
    expect(b.zoom.x).toBeGreaterThanOrEqual(0)
    expect(b.zoom.x + b.zoom.w).toBeLessThanOrEqual(vp.width + 1)
    for (const k of ['page', 'hearts', 'score', 'row'] as const) expect(overlap(b.zoom, b[k]), `zoom vs ${k}`).toBe(false)
    // It never sits over the book: its bottom stays above the page's top corners.
    const top = await page.evaluate(() => Math.min(window.__fold!.screenOf(-5, -7).y, window.__fold!.screenOf(5, -7).y))
    expect(b.zoom.y + b.zoom.h, 'zoom button vs page top').toBeLessThanOrEqual(top + 0.5)
    await page.screenshot({ path: `test-results/shelf-zoom-${vp.width}x${vp.height}.png` })
  })
}
