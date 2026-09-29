import { expect, test } from '@playwright/test'
import { waitForGame } from './helpers'

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
