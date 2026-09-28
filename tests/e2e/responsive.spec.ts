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
