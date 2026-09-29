/**
 * Procedural page painter — the parchment "maps" each level is printed on.
 *
 * Two canvases per page:
 *   art   — the full illustration. Fold flaps sample it, so when a flap lies
 *           flat it is invisible against the page; when it lifts, the art
 *           lifts with it (pop-up books print the art on the flap).
 *   page  — the same art with every flap footprint replaced by the layer
 *           underneath (darker kraft paper, blueprint lines). That is what the
 *           hole shows when a flap stands up — the GDD §7 hidden depth.
 *
 * Page space (x ∈ [-5, 5], z ∈ [-7, 7]) maps to canvas pixels linearly;
 * `v = 1 - (z + 7) / 14` in texture space (CanvasTexture flips Y).
 */

import type { CanvasTexture } from 'three'
import { PAGE_D, PAGE_HALF_D, PAGE_HALF_W, PAGE_W } from '../../logic/config'
import type { FoldDef, PageDef } from '../../logic/types'
import type { Rng } from '../../logic/rng'
import { HEX, css } from '../palette'
import { blob, edgeBurn, inkLine, makeCanvas, paperGrain, seeded, smoothPath, stains, toTexture } from './canvas'

export const PAGE_TEX_W = 1024
export const PAGE_TEX_H = Math.round((PAGE_TEX_W * PAGE_D) / PAGE_W)

const PX = PAGE_TEX_W / PAGE_W
const px = (x: number): number => (x + PAGE_HALF_W) * PX
const py = (z: number): number => (z + PAGE_HALF_D) * PX

export interface PageTextures {
  art: CanvasTexture
  page: CanvasTexture
  dispose(): void
}

/** Footprint polygon of a fold (page space), as canvas pixel coordinates. */
const footprint = (f: FoldDef): number[] => {
  const dx = f.bx - f.ax
  const dz = f.bz - f.az
  const len = Math.hypot(dx, dz) || 1
  const ux = dx / len
  const uz = dz / len
  const nx = -uz * f.side
  const nz = ux * f.side
  const k = f.kind
  const d0 = k === 'valley' || k === 'ridge' ? -f.depth : 0
  const d1 = f.depth
  const pts = [
    f.ax + nx * d0, f.az + nz * d0,
    f.bx + nx * d0, f.bz + nz * d0,
    f.bx + nx * d1, f.bz + nz * d1,
    f.ax + nx * d1, f.az + nz * d1
  ]
  const out: number[] = []
  for (let i = 0; i < pts.length; i += 2) out.push(px(pts[i]!), py(pts[i + 1]!))
  return out
}

const polyPath = (ctx: CanvasRenderingContext2D, p: number[]): void => {
  ctx.beginPath()
  ctx.moveTo(p[0]!, p[1]!)
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!)
  ctx.closePath()
}

// ─── Shared motifs ─────────────────────────────────────────────────────────

const parchmentBase = (ctx: CanvasRenderingContext2D, rng: Rng, tint = HEX.parchment): void => {
  const w = PAGE_TEX_W
  const h = PAGE_TEX_H
  ctx.fillStyle = tint
  ctx.fillRect(0, 0, w, h)
  // Gentle lamp-independent tonal drift so large areas never look flat.
  for (let i = 0; i < 7; i++) {
    const g = ctx.createRadialGradient(rng.next() * w, rng.next() * h, 10, rng.next() * w, rng.next() * h, 300 + rng.next() * 400)
    g.addColorStop(0, css('parchmentLight', 0.35))
    g.addColorStop(1, css('parchmentLight', 0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
}

const mapFrame = (ctx: CanvasRenderingContext2D): void => {
  const w = PAGE_TEX_W
  const h = PAGE_TEX_H
  ctx.save()
  ctx.strokeStyle = css('inkSoft', 0.55)
  ctx.lineWidth = 3
  ctx.strokeRect(18, 18, w - 36, h - 36)
  ctx.lineWidth = 1.2
  ctx.strokeRect(28, 28, w - 56, h - 56)
  // Corner flourishes.
  for (const [cx, cy, sx, sy] of [[28, 28, 1, 1], [w - 28, 28, -1, 1], [28, h - 28, 1, -1], [w - 28, h - 28, -1, -1]] as const) {
    ctx.beginPath()
    ctx.moveTo(cx, cy + sy * 46)
    ctx.quadraticCurveTo(cx + sx * 6, cy + sy * 6, cx + sx * 46, cy)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx + sx * 16, cy + sy * 16, 5, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

const compass = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void => {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.strokeStyle = css('inkSoft', 0.7)
  ctx.fillStyle = css('inkSoft', 0.55)
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2)
  ctx.stroke()
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const long = i % 2 === 0
    const L = long ? r * 1.05 : r * 0.62
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * L, Math.sin(a) * L)
    ctx.lineTo(Math.cos(a + 0.26) * r * 0.16, Math.sin(a + 0.26) * r * 0.16)
    ctx.lineTo(Math.cos(a - 0.26) * r * 0.16, Math.sin(a - 0.26) * r * 0.16)
    ctx.closePath()
    if (long) ctx.fill()
    else ctx.stroke()
  }
  ctx.restore()
}

const road = (ctx: CanvasRenderingContext2D, lanePts: number[], width: number): void => {
  const pts: number[] = []
  for (let i = 0; i < lanePts.length; i += 2) pts.push(px(lanePts[i]!), py(lanePts[i + 1]!))
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  smoothPath(ctx, pts)
  ctx.strokeStyle = css('roadDark', 0.9)
  ctx.lineWidth = width + 10
  ctx.stroke()
  smoothPath(ctx, pts)
  ctx.strokeStyle = HEX.road
  ctx.lineWidth = width
  ctx.stroke()
  // Wheel ruts.
  ctx.setLineDash([14, 12])
  smoothPath(ctx, pts)
  ctx.strokeStyle = css('roadDark', 0.55)
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()
}

const meadows = (ctx: CanvasRenderingContext2D, rng: Rng, count: number): void => {
  for (let i = 0; i < count; i++) {
    const cx = rng.next() * PAGE_TEX_W
    const cy = 60 + rng.next() * (PAGE_TEX_H - 120)
    const rx = 70 + rng.next() * 170
    const ry = 60 + rng.next() * 140
    blob(ctx, cx, cy, rx, ry, rng)
    ctx.fillStyle = rng.next() < 0.5 ? HEX.meadow : HEX.meadowLight
    ctx.fill()
    ctx.strokeStyle = css('meadowDark', 0.9)
    ctx.lineWidth = 2.4
    ctx.stroke()
    // Grass tufts, pen-drawn.
    ctx.strokeStyle = css('forestDark', 0.55)
    ctx.lineWidth = 1.4
    for (let k = 0; k < 14; k++) {
      const gx = cx + (rng.next() - 0.5) * rx * 1.3
      const gy = cy + (rng.next() - 0.5) * ry * 1.3
      ctx.beginPath()
      ctx.moveTo(gx - 4, gy)
      ctx.lineTo(gx - 1, gy - 7)
      ctx.moveTo(gx, gy)
      ctx.lineTo(gx + 1, gy - 9)
      ctx.moveTo(gx + 4, gy)
      ctx.lineTo(gx + 3, gy - 6)
      ctx.stroke()
    }
  }
}

const flowers = (ctx: CanvasRenderingContext2D, rng: Rng, count: number): void => {
  const petals = [HEX.c1, HEX.c2, HEX.c5, HEX.c7, HEX.paperWhite]
  for (let i = 0; i < count; i++) {
    const x = rng.next() * PAGE_TEX_W
    const y = rng.next() * PAGE_TEX_H
    ctx.fillStyle = petals[Math.floor(rng.next() * petals.length)]!
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2
      ctx.beginPath()
      ctx.arc(x + Math.cos(a) * 3.2, y + Math.sin(a) * 3.2, 2.4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = HEX.gold
    ctx.beginPath()
    ctx.arc(x, y, 1.8, 0, Math.PI * 2)
    ctx.fill()
  }
}

const river = (ctx: CanvasRenderingContext2D, pts: number[], width: number, rng: Rng): void => {
  const p: number[] = []
  for (let i = 0; i < pts.length; i += 2) p.push(px(pts[i]!), py(pts[i + 1]!))
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  smoothPath(ctx, p)
  ctx.strokeStyle = HEX.waterDark
  ctx.lineWidth = width + 12
  ctx.stroke()
  smoothPath(ctx, p)
  ctx.strokeStyle = HEX.water
  ctx.lineWidth = width
  ctx.stroke()
  // Wave marks.
  ctx.strokeStyle = css('waterLight', 0.95)
  ctx.lineWidth = 2.2
  for (let i = 0; i < p.length - 2; i += 2) {
    const x = (p[i]! + p[i + 2]!) / 2 + (rng.next() - 0.5) * width * 0.4
    const y = (p[i + 1]! + p[i + 3]!) / 2 + (rng.next() - 0.5) * width * 0.4
    ctx.beginPath()
    ctx.arc(x - 6, y, 6, Math.PI * 1.1, Math.PI * 1.9)
    ctx.arc(x + 6, y, 6, Math.PI * 1.1, Math.PI * 1.9)
    ctx.stroke()
  }
  ctx.restore()
}

const bridgeAt = (ctx: CanvasRenderingContext2D, x: number, z: number, w: number, h: number): void => {
  ctx.save()
  ctx.translate(px(x), py(z))
  ctx.fillStyle = HEX.wood
  ctx.fillRect(-w / 2, -h / 2, w, h)
  ctx.strokeStyle = HEX.woodDark
  ctx.lineWidth = 2
  for (let i = -w / 2 + 8; i < w / 2; i += 10) {
    ctx.beginPath()
    ctx.moveTo(i, -h / 2)
    ctx.lineTo(i, h / 2)
    ctx.stroke()
  }
  ctx.strokeStyle = HEX.ink
  ctx.lineWidth = 2.5
  ctx.strokeRect(-w / 2, -h / 2, w, h)
  ctx.restore()
}

/** Origami notation: valley fold = dashes, mountain fold = dash-dot. */
const creaseLine = (ctx: CanvasRenderingContext2D, x0: number, z0: number, x1: number, z1: number, mountain: boolean): void => {
  ctx.save()
  ctx.strokeStyle = css('inkSoft', 0.6)
  ctx.lineWidth = 2.2
  ctx.setLineDash(mountain ? [16, 6, 3, 6] : [12, 8])
  ctx.beginPath()
  ctx.moveTo(px(x0), py(z0))
  ctx.lineTo(px(x1), py(z1))
  ctx.stroke()
  ctx.restore()
}

/** Die-cut line around a flap: the cut the pop-up folds out of. */
const cutLine = (ctx: CanvasRenderingContext2D, f: FoldDef): void => {
  const p = footprint(f)
  ctx.save()
  ctx.strokeStyle = css('ink', 0.55)
  ctx.lineWidth = 1.8
  // The hinge edge is not cut (it's the fold) — draw the three cut sides only.
  ctx.beginPath()
  if (f.kind === 'valley' || f.kind === 'ridge') {
    ctx.moveTo(p[0]!, p[1]!)
    ctx.lineTo(p[2]!, p[3]!)
    ctx.moveTo(p[4]!, p[5]!)
    ctx.lineTo(p[6]!, p[7]!)
  } else {
    ctx.moveTo(p[0]!, p[1]!)
    ctx.lineTo(p[6]!, p[7]!)
    ctx.lineTo(p[4]!, p[5]!)
    ctx.lineTo(p[2]!, p[3]!)
  }
  ctx.stroke()
  ctx.restore()
  const mountain = f.kind === 'ridge'
  if (f.kind === 'valley' || f.kind === 'ridge') {
    const cxA = f.ax
    const cxB = f.bx
    creaseLine(ctx, cxA, f.az, cxB, f.bz, mountain)
  } else {
    creaseLine(ctx, f.ax, f.az, f.bx, f.bz, false)
  }
}

// ─── Themes ────────────────────────────────────────────────────────────────

const paintBorder = (ctx: CanvasRenderingContext2D, page: PageDef, rng: Rng): void => {
  meadows(ctx, rng, 13)
  // A little stream in the corner, far from the lanes.
  river(ctx, [-5.2, 2.6, -4.4, 3.4, -4.7, 4.6, -3.9, 5.6, -4.3, 7.2], 30, rng)
  for (const l of page.lanes) road(ctx, l.points, 46)
  flowers(ctx, rng, 70)
  // The border itself: a dotted frontier line across the page.
  ctx.save()
  ctx.strokeStyle = css('enemyRedDark', 0.7)
  ctx.lineWidth = 3
  ctx.setLineDash([2, 10])
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(30, py(-4.6))
  for (let x = -5; x <= 5; x += 0.5) ctx.lineTo(px(x), py(-4.6 + Math.sin(x * 1.3) * 0.18))
  ctx.stroke()
  ctx.restore()
  compass(ctx, px(3.9), py(5.7), 44)
}

const paintRavine = (ctx: CanvasRenderingContext2D, page: PageDef, rng: Rng): void => {
  meadows(ctx, rng, 11)
  for (const l of page.lanes) road(ctx, l.points, 44)
  // Rocky scree on both lips of the ravine.
  const v = page.folds.find((f) => f.kind === 'valley')
  if (v) {
    for (const edge of [v.az - v.depth - 0.25, v.az + v.depth + 0.25]) {
      for (let i = 0; i < 26; i++) {
        const x = -4.8 + rng.next() * 9.6
        const z = edge + (rng.next() - 0.5) * 0.3
        ctx.fillStyle = rng.next() < 0.5 ? HEX.rock : HEX.rockDark
        blob(ctx, px(x), py(z), 7 + rng.next() * 8, 5 + rng.next() * 6, rng, 6, 0.25)
        ctx.fill()
        ctx.strokeStyle = css('ink', 0.5)
        ctx.lineWidth = 1.2
        ctx.stroke()
      }
    }
  }
  flowers(ctx, rng, 40)
  compass(ctx, px(-3.9), py(5.8), 40)
}

const paintSiege = (ctx: CanvasRenderingContext2D, page: PageDef, rng: Rng): void => {
  // Farmland patchwork.
  const cols = [HEX.meadow, HEX.meadowLight, HEX.road, HEX.meadowDark]
  for (let i = 0; i < 16; i++) {
    const x = rng.next() * PAGE_TEX_W
    const y = rng.next() * PAGE_TEX_H
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate((rng.next() - 0.5) * 0.5)
    const w = 110 + rng.next() * 160
    const h = 80 + rng.next() * 110
    ctx.fillStyle = cols[i % cols.length]!
    ctx.fillRect(-w / 2, -h / 2, w, h)
    ctx.strokeStyle = css('forestDark', 0.35)
    ctx.lineWidth = 1.4
    for (let s = -w / 2 + 8; s < w / 2; s += 11) {
      ctx.beginPath()
      ctx.moveTo(s, -h / 2)
      ctx.lineTo(s, h / 2)
      ctx.stroke()
    }
    ctx.strokeStyle = css('ink', 0.5)
    ctx.lineWidth = 2
    ctx.strokeRect(-w / 2, -h / 2, w, h)
    ctx.restore()
  }
  river(ctx, [-5.4, -0.4, -3, -0.9, -1, -0.3, 1, -0.7, 3, -0.2, 5.4, -0.6], 38, rng)
  for (const l of page.lanes) road(ctx, l.points, 42)
  for (const l of page.lanes) {
    // Bridges where the roads cross the river.
    const lx = l.points[0]!
    bridgeAt(ctx, lx, -0.5, 64, 58)
  }
  // Hill symbols where the ridge will rise.
  const r = page.folds.find((f) => f.kind === 'ridge')
  if (r) {
    ctx.save()
    ctx.strokeStyle = css('inkSoft', 0.55)
    ctx.lineWidth = 1.8
    for (let x = r.ax + 0.3; x < r.bx; x += 0.6) {
      ctx.beginPath()
      ctx.moveTo(px(x - 0.25), py(r.az + 0.2))
      ctx.lineTo(px(x), py(r.az - 0.25))
      ctx.lineTo(px(x + 0.25), py(r.az + 0.2))
      ctx.stroke()
    }
    ctx.restore()
  }
  flowers(ctx, rng, 25)
}

const paintGates = (ctx: CanvasRenderingContext2D, page: PageDef, rng: Rng): void => {
  meadows(ctx, rng, 8)
  // Cobbled courtyard below the walls.
  ctx.save()
  ctx.fillStyle = HEX.stoneLight
  ctx.fillRect(40, py(-7), PAGE_TEX_W - 80, py(-3.8) - py(-7))
  ctx.strokeStyle = css('stoneDark', 0.7)
  ctx.lineWidth = 1.3
  for (let y = py(-7) + 8; y < py(-3.8); y += 16) {
    const off = (Math.floor(y / 16) % 2) * 12
    for (let x = 40 + off; x < PAGE_TEX_W - 40; x += 24) {
      ctx.beginPath()
      ctx.ellipse(x, y, 10, 6, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  ctx.restore()
  // Moat under the drawbridge.
  river(ctx, [-5.4, -3.05, -2, -2.95, 0, -3.05, 2, -2.95, 5.4, -3.05], 44, rng)
  for (const l of page.lanes) road(ctx, l.points, 44)
  flowers(ctx, rng, 30)
}

const paintCore = (ctx: CanvasRenderingContext2D, _page: PageDef, rng: Rng): void => {
  // The castle-core layer: a blueprint printed on darker stock.
  ctx.fillStyle = css('underlayer', 0.85)
  ctx.fillRect(0, 0, PAGE_TEX_W, PAGE_TEX_H)
  ctx.save()
  ctx.strokeStyle = css('blueprint', 0.45)
  ctx.lineWidth = 1
  for (let x = 0; x < PAGE_TEX_W; x += 32) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, PAGE_TEX_H)
    ctx.stroke()
  }
  for (let y = 0; y < PAGE_TEX_H; y += 32) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(PAGE_TEX_W, y)
    ctx.stroke()
  }
  // Gear diagrams.
  ctx.strokeStyle = css('underlayerInk', 0.7)
  ctx.lineWidth = 2
  for (let i = 0; i < 7; i++) {
    const cx = rng.next() * PAGE_TEX_W
    const cy = rng.next() * PAGE_TEX_H
    const r = 30 + rng.next() * 60
    const teeth = 8 + Math.floor(rng.next() * 6)
    ctx.beginPath()
    for (let t = 0; t <= teeth * 2; t++) {
      const a = (t / (teeth * 2)) * Math.PI * 2
      const rr = t % 2 ? r : r * 1.18
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
    }
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.35, 0, Math.PI * 2)
    ctx.stroke()
  }
  // Measurement ticks along the edges.
  ctx.strokeStyle = css('inkSoft', 0.5)
  for (let y = 40; y < PAGE_TEX_H - 40; y += 20) {
    ctx.beginPath()
    ctx.moveTo(40, y)
    ctx.lineTo(y % 100 === 0 ? 58 : 48, y)
    ctx.stroke()
  }
  ctx.restore()
}

const paintFinale = (ctx: CanvasRenderingContext2D, _page: PageDef, rng: Rng): void => {
  meadows(ctx, rng, 9)
  flowers(ctx, rng, 120)
  // Printed confetti and stars around the edges.
  const cols = [HEX.c1, HEX.c2, HEX.c3, HEX.c4, HEX.c5, HEX.c6]
  for (let i = 0; i < 160; i++) {
    const x = rng.next() * PAGE_TEX_W
    const y = rng.next() * PAGE_TEX_H
    const edge = Math.min(x, PAGE_TEX_W - x, y, PAGE_TEX_H - y)
    if (edge > 220 && rng.next() < 0.8) continue
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rng.next() * Math.PI)
    ctx.fillStyle = cols[i % cols.length]!
    ctx.fillRect(-5, -3, 10, 6)
    ctx.restore()
  }
  // Laurel wreath ring in the middle (where the frog will sit).
  ctx.save()
  ctx.translate(px(0), py(0.4))
  ctx.strokeStyle = HEX.forestDark
  ctx.fillStyle = HEX.forest
  ctx.lineWidth = 2
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 11; i++) {
      const a = Math.PI / 2 + side * (0.35 + i * 0.22)
      const r = 190
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(a + side * 0.9)
      ctx.beginPath()
      ctx.ellipse(0, 0, 18, 7, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
  }
  ctx.restore()
}

// ─── Book 2 themes ─────────────────────────────────────────────────────────

/** Village cottages printed around the keep: little roofs seen from above. */
const cottages = (ctx: CanvasRenderingContext2D, rng: Rng, spots: number[]): void => {
  for (let i = 0; i < spots.length; i += 2) {
    ctx.save()
    ctx.translate(px(spots[i]!), py(spots[i + 1]!))
    ctx.rotate((rng.next() - 0.5) * 0.4)
    const w = 46 + rng.next() * 20
    const h = 34 + rng.next() * 12
    ctx.fillStyle = HEX.roofRed
    ctx.fillRect(-w / 2, -h / 2, w, h / 2)
    ctx.fillStyle = HEX.roofRedDark
    ctx.fillRect(-w / 2, 0, w, h / 2)
    ctx.strokeStyle = css('ink', 0.6)
    ctx.lineWidth = 1.6
    ctx.strokeRect(-w / 2, -h / 2, w, h)
    ctx.beginPath()
    ctx.moveTo(-w / 2, 0)
    ctx.lineTo(w / 2, 0)
    ctx.stroke()
    ctx.restore()
  }
}

const paintHome = (ctx: CanvasRenderingContext2D, page: PageDef, rng: Rng): void => {
  meadows(ctx, rng, 12)
  for (const l of page.lanes) road(ctx, l.points, 44)
  // The village the keep protects.
  cottages(ctx, rng, [-4.2, 3.4, -3.6, 4.4, 4.3, 3.2, 3.9, 4.3, -4.3, -0.4, 4.2, 0.2])
  flowers(ctx, rng, 60)
  // The frontier the enemy crossed: a torn dotted line at the top.
  ctx.save()
  ctx.strokeStyle = css('enemyRedDark', 0.65)
  ctx.lineWidth = 2.4
  ctx.setLineDash([2, 10])
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(30, py(-5.4))
  for (let x = -5; x <= 5; x += 0.5) ctx.lineTo(px(x), py(-5.4 + Math.sin(x * 1.1 + 1) * 0.2))
  ctx.stroke()
  ctx.restore()
}

const paintOrchard = (ctx: CanvasRenderingContext2D, page: PageDef, rng: Rng): void => {
  meadows(ctx, rng, 8)
  // Rows of printed saplings between the roads.
  ctx.save()
  for (let z = -6.2; z < 4.5; z += 0.9) {
    for (let x = -4.6; x < 4.8; x += 0.9) {
      let onRoad = false
      for (const l of page.lanes) {
        const p = l.points
        const t = (z - p[1]!) / (p[p.length - 1]! - p[1]!)
        const lx = p[0]! + (p[p.length - 2]! - p[0]!) * Math.max(0, Math.min(1, t))
        if (Math.abs(lx - x) < 0.8) onRoad = true
      }
      if (onRoad || rng.next() < 0.35) continue
      ctx.fillStyle = css('meadowDark', 0.8)
      ctx.beginPath()
      ctx.arc(px(x + (rng.next() - 0.5) * 0.2), py(z), 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = css('c1', 0.85)
      ctx.beginPath()
      ctx.arc(px(x) + 3, py(z) - 2, 2.4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
  for (const l of page.lanes) road(ctx, l.points, 42)
  flowers(ctx, rng, 40)
}

const paintMill = (ctx: CanvasRenderingContext2D, page: PageDef, rng: Rng): void => {
  // Wheat fields in golden strips.
  const cols = [HEX.flagYellow, HEX.meadowLight, HEX.road, HEX.meadow]
  for (let i = 0; i < 14; i++) {
    const x = rng.next() * PAGE_TEX_W
    const y = rng.next() * PAGE_TEX_H
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate((rng.next() - 0.5) * 0.4)
    const w = 120 + rng.next() * 150
    const h = 90 + rng.next() * 90
    ctx.fillStyle = css(i % 2 ? 'meadowLight' : 'road', 0.9)
    if (i % 4 === 0) ctx.fillStyle = cols[0]!
    ctx.fillRect(-w / 2, -h / 2, w, h)
    ctx.strokeStyle = css('goldDark', 0.35)
    ctx.lineWidth = 1.2
    for (let s = -h / 2 + 7; s < h / 2; s += 9) {
      ctx.beginPath()
      ctx.moveTo(-w / 2, s)
      ctx.lineTo(w / 2, s)
      ctx.stroke()
    }
    ctx.restore()
  }
  for (const l of page.lanes) road(ctx, l.points, 42)
  flowers(ctx, rng, 20)
}

const paintCamp = (ctx: CanvasRenderingContext2D, page: PageDef, rng: Rng): void => {
  meadows(ctx, rng, 7)
  // Trampled ground at the enemy camp along the top.
  ctx.save()
  blob(ctx, px(0), py(-6), 470, 120, rng, 14, 0.1)
  ctx.fillStyle = css('roadDark', 0.55)
  ctx.fill()
  ctx.restore()
  // Campfire rings.
  for (const [x, z] of [[-1.2, -6.2], [1.4, -6.0]] as const) {
    ctx.save()
    ctx.translate(px(x), py(z))
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2
      ctx.fillStyle = HEX.rockDark
      ctx.beginPath()
      ctx.arc(Math.cos(a) * 16, Math.sin(a) * 12, 4.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = HEX.c6
    ctx.beginPath()
    ctx.arc(0, 0, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  for (const l of page.lanes) road(ctx, l.points, 44)
  flowers(ctx, rng, 30)
}

const PAINTERS: Record<PageDef['theme'], (ctx: CanvasRenderingContext2D, page: PageDef, rng: Rng) => void> = {
  border: paintBorder,
  ravine: paintRavine,
  siege: paintSiege,
  gates: paintGates,
  core: paintCore,
  finale: paintFinale,
  home: paintHome,
  orchard: paintOrchard,
  mill: paintMill,
  camp: paintCamp
}

/** The player's castle grounds: a cobbled bailey along the bottom edge. */
const keepGrounds = (ctx: CanvasRenderingContext2D): void => {
  ctx.save()
  const y0 = py(5.95)
  ctx.fillStyle = HEX.stoneLight
  ctx.fillRect(34, y0, PAGE_TEX_W - 68, PAGE_TEX_H - 34 - y0)
  ctx.strokeStyle = css('stoneDark', 0.55)
  ctx.lineWidth = 1.1
  for (let y = y0 + 8; y < PAGE_TEX_H - 34; y += 14) {
    const off = (Math.floor(y / 14) % 2) * 10
    for (let x = 40 + off; x < PAGE_TEX_W - 40; x += 20) {
      ctx.beginPath()
      ctx.ellipse(x, y, 8, 5, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  ctx.restore()
}

// ─── Underlayer ────────────────────────────────────────────────────────────

const underlayerPattern = (ctx: CanvasRenderingContext2D, rng: Rng, dark = false): void => {
  ctx.fillStyle = dark ? HEX.ravine : HEX.underlayer
  ctx.fillRect(0, 0, PAGE_TEX_W, PAGE_TEX_H)
  ctx.strokeStyle = dark ? css('ink', 0.35) : css('blueprint', 0.6)
  ctx.lineWidth = 1.2
  for (let x = 0; x < PAGE_TEX_W; x += 24) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, PAGE_TEX_H)
    ctx.stroke()
  }
  for (let y = 0; y < PAGE_TEX_H; y += 24) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(PAGE_TEX_W, y)
    ctx.stroke()
  }
  paperGrain(ctx, PAGE_TEX_W, PAGE_TEX_H, rng, 0.35)
}

// ─── Entry point ───────────────────────────────────────────────────────────

export const paintPage = (page: PageDef): PageTextures => {
  const rng = seeded(page.book * 104729 + page.id * 7919 + 17)
  const [artC, art] = makeCanvas(PAGE_TEX_W, PAGE_TEX_H)
  parchmentBase(art, rng)
  paperGrain(art, PAGE_TEX_W, PAGE_TEX_H, rng)
  PAINTERS[page.theme](art, page, rng)
  keepGrounds(art)
  stains(art, PAGE_TEX_W, PAGE_TEX_H, rng, 5)
  mapFrame(art)
  // (Ballistas fold on the towers, not out of the page: no cut.)
  for (const f of page.folds) if (f.kind !== 'frog' && f.kind !== 'ballista') cutLine(art, f)
  edgeBurn(art, PAGE_TEX_W, PAGE_TEX_H)

  // The page itself: the same print, with holes where flaps are cut out.
  const [pageC, pg] = makeCanvas(PAGE_TEX_W, PAGE_TEX_H)
  pg.drawImage(artC, 0, 0)
  const [underC, under] = makeCanvas(PAGE_TEX_W, PAGE_TEX_H)
  underlayerPattern(under, rng)
  const [ravineC, rav] = makeCanvas(PAGE_TEX_W, PAGE_TEX_H)
  underlayerPattern(rav, rng, true)
  for (const f of page.folds) {
    if (f.kind === 'frog' || f.kind === 'ballista') continue
    pg.save()
    polyPath(pg, footprint(f))
    pg.clip()
    pg.drawImage(f.kind === 'valley' ? ravineC : underC, 0, 0)
    // Inner shadow along the cut edge: the hole has depth.
    pg.strokeStyle = css('ink', 0.35)
    pg.lineWidth = 10
    polyPath(pg, footprint(f))
    pg.stroke()
    pg.restore()
  }

  const artTex = toTexture(artC)
  const pageTex = toTexture(pageC)
  return {
    art: artTex,
    page: pageTex,
    dispose() {
      artTex.dispose()
      pageTex.dispose()
    }
  }
}

/** Plain paper for the back of turned sheets and the book's left page. */
export const paintPlainSheet = (seed: number, w = 512, h = Math.round((512 * PAGE_D) / PAGE_W)): CanvasTexture => {
  const rng = seeded(seed)
  const [c, ctx] = makeCanvas(w, h)
  ctx.fillStyle = HEX.parchment
  ctx.fillRect(0, 0, w, h)
  paperGrain(ctx, w, h, rng, 0.35)
  stains(ctx, w, h, rng, 2)
  edgeBurn(ctx, w, h)
  return toTexture(c)
}

export const CAPTION_TEX_W = 1024
export const CAPTION_TEX_H = 88

/**
 * The storybook line: a printed paper label pasted into the page margin.
 * Pop-up books carry their text on the page itself, so the story needs no
 * overlay. Painted separately from the page so it can be repainted when the
 * font arrives or the language changes.
 */
export const paintCaption = (text: string, ctx?: CanvasRenderingContext2D): CanvasTexture | null => {
  let tex: CanvasTexture | null = null
  if (!ctx) {
    const [c, g] = makeCanvas(CAPTION_TEX_W, CAPTION_TEX_H)
    ctx = g
    tex = toTexture(c)
  }
  const w = CAPTION_TEX_W
  const h = CAPTION_TEX_H
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = HEX.parchmentLight
  ctx.fillRect(0, 0, w, h)
  const rng = seeded(text.length * 31 + 7)
  paperGrain(ctx, w, h, rng, 0.4)
  ctx.strokeStyle = css('inkSoft', 0.45)
  ctx.lineWidth = 2
  ctx.strokeRect(8, 8, w - 16, h - 16)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let size = 46
  const maxW = w - 70
  ctx.font = `${size}px Angry, sans-serif`
  while (size > 24 && ctx.measureText(text).width > maxW) {
    size -= 1
    ctx.font = `${size}px Angry, sans-serif`
  }
  ctx.fillStyle = HEX.inkSoft
  ctx.fillText(text, w / 2, h / 2 + 2, maxW)
  return tex
}

export const pageUV = (x: number, z: number): [number, number] => [
  (x + PAGE_HALF_W) / PAGE_W,
  1 - (z + PAGE_HALF_D) / PAGE_D
]

export { inkLine }
