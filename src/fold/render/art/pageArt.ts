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
 *
 * The look (`PageLook`) picks the paper the map is printed on (roadmap #6:
 * plain parchment, graph, washi, newsprint, map) and the season's skin
 * (roadmap #17: Halloween dusk with pumpkins and bats, Winter snow). Both are
 * pale prints under the illustration plus a faint veil over it, drawn with
 * their own random stream so the page's layout (meadows, rocks, flowers) is
 * the same on every paper. The under-flap layer carries the same motif, so a
 * raised flap reveals the paper it was cut from. Seasonal marks stay clear of
 * the lanes, so marchers and roads read the same in every season.
 */

import type { CanvasTexture } from 'three'
import { BOAT, OUTRO, PAGE_D, PAGE_HALF_D, PAGE_HALF_W, PAGE_W, PLEAT } from '../../logic/config'
import type { FoldDef, PageDef } from '../../logic/types'
import type { Rng } from '../../logic/rng'
import type { PaperPattern } from '../../logic/cosmetics'
import type { Season } from '../../logic/seasons'
import { HEX, css, type PaletteKey } from '../palette'
import { blob, edgeBurn, inkLine, makeCanvas, paperGrain, seeded, smoothPath, stains, toTexture } from './canvas'

export const PAGE_TEX_W = 1024
export const PAGE_TEX_H = Math.round((PAGE_TEX_W * PAGE_D) / PAGE_W)

const PX = PAGE_TEX_W / PAGE_W
const px = (x: number): number => (x + PAGE_HALF_W) * PX
const py = (z: number): number => (z + PAGE_HALF_D) * PX

/** What a page is printed on: the equipped paper and the season's skin. */
export interface PageLook {
  paper: PaperPattern
  season: Season
}

export const PLAIN_LOOK: Readonly<PageLook> = { paper: 'plain', season: 'none' }

export interface PageTextures {
  art: CanvasTexture
  page: CanvasTexture
  dispose(): void
}

/** Hinge frame of a fold definition: unit along (ux, uz), unit toward the flap (nx, nz), length. */
const frame = (f: FoldDef): { ux: number; uz: number; nx: number; nz: number; len: number } => {
  const dx = f.bx - f.ax
  const dz = f.bz - f.az
  const len = Math.hypot(dx, dz) || 1
  const ux = dx / len
  const uz = dz / len
  return { ux, uz, nx: -uz * f.side, nz: ux * f.side, len }
}

/** Strips (valley, ridge, and book 3's boat channel and pleat) lie either side of their line. */
const stripKind = (f: FoldDef): boolean => f.kind === 'valley' || f.kind === 'ridge' || f.kind === 'boat' || f.kind === 'pleat'

/**
 * Footprint polygon of a fold's cut flap (page space), as canvas pixel
 * coordinates. A boat's flap is only its dock square — the channel is water.
 */
const footprint = (f: FoldDef): number[] => {
  const { ux, uz, nx, nz, len } = frame(f)
  const d0 = stripKind(f) ? -f.depth : 0
  const d1 = f.depth
  const s1 = f.kind === 'boat' ? Math.min(len, BOAT.dock) : len
  const bx = f.ax + ux * s1
  const bz = f.az + uz * s1
  const pts = [
    f.ax + nx * d0, f.az + nz * d0,
    bx + nx * d0, bz + nz * d0,
    bx + nx * d1, bz + nz * d1,
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

const parchmentBase = (ctx: CanvasRenderingContext2D, rng: Rng, tint: string = HEX.parchment): void => {
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

/**
 * The boat's dock flap: cut on all four sides, printed with the paper-boat
 * crease pattern (diagonals and the mid-line) and a little boat mark.
 */
const boatCut = (ctx: CanvasRenderingContext2D, f: FoldDef): void => {
  const p = footprint(f)
  ctx.save()
  ctx.fillStyle = css('paperWhite', 0.9)
  polyPath(ctx, p)
  ctx.fill()
  ctx.strokeStyle = css('ink', 0.6)
  ctx.lineWidth = 1.8
  polyPath(ctx, p)
  ctx.stroke()
  ctx.strokeStyle = css('inkSoft', 0.55)
  ctx.lineWidth = 1.6
  ctx.setLineDash([10, 7])
  ctx.beginPath()
  ctx.moveTo(p[0]!, p[1]!)
  ctx.lineTo(p[4]!, p[5]!)
  ctx.moveTo(p[2]!, p[3]!)
  ctx.lineTo(p[6]!, p[7]!)
  ctx.moveTo((p[0]! + p[2]!) / 2, (p[1]! + p[3]!) / 2)
  ctx.lineTo((p[4]! + p[6]!) / 2, (p[5]! + p[7]!) / 2)
  ctx.stroke()
  ctx.setLineDash([])
  // A small printed boat in the middle: what the flap becomes.
  const cx = (p[0]! + p[4]!) / 2
  const cy = (p[1]! + p[5]!) / 2
  ctx.fillStyle = css('guide', 0.85)
  ctx.beginPath()
  ctx.moveTo(cx - 22, cy + 2)
  ctx.lineTo(cx + 22, cy + 2)
  ctx.lineTo(cx + 13, cy + 13)
  ctx.lineTo(cx - 13, cy + 13)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(cx - 12, cy)
  ctx.lineTo(cx + 12, cy)
  ctx.lineTo(cx, cy - 18)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/**
 * The pleat: its two long cut sides, and the accordion's creases across it —
 * valley folds (dashes) at the section edges, mountain folds (dash-dot) in
 * each section's middle, the origami way.
 */
const pleatCut = (ctx: CanvasRenderingContext2D, f: FoldDef): void => {
  const p = footprint(f)
  const { ux, uz, nx, nz, len } = frame(f)
  ctx.save()
  ctx.strokeStyle = css('ink', 0.55)
  ctx.lineWidth = 1.8
  ctx.beginPath()
  ctx.moveTo(p[0]!, p[1]!)
  ctx.lineTo(p[2]!, p[3]!)
  ctx.moveTo(p[4]!, p[5]!)
  ctx.lineTo(p[6]!, p[7]!)
  ctx.stroke()
  ctx.restore()
  const n = Math.max(2, f.creases ?? PLEAT.creases)
  for (let k = 0; k <= n * 2; k++) {
    const sAt = (k / (n * 2)) * len
    const x = f.ax + ux * sAt
    const z = f.az + uz * sAt
    creaseLine(ctx, x - nx * f.depth, z - nz * f.depth, x + nx * f.depth, z + nz * f.depth, k % 2 === 1)
  }
}

/** Die-cut line around a flap: the cut the pop-up folds out of. */
const cutLine = (ctx: CanvasRenderingContext2D, f: FoldDef): void => {
  if (f.kind === 'boat') return boatCut(ctx, f)
  if (f.kind === 'pleat') return pleatCut(ctx, f)
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

const paintFinale = (ctx: CanvasRenderingContext2D, page: PageDef, rng: Rng): void => {
  meadows(ctx, rng, 9)
  // Book 3's "Calm Water": the sea along the top, where the outro's dolphins leap and its paper boats bob.
  if (page.book === 3) seaTop(ctx, rng, OUTRO.seaZ)
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

// ─── Book 3 themes: the Sea of Paper ───────────────────────────────────────

/** Wave marks (little double arcs) scattered over a band of sea. */
const waveMarks = (ctx: CanvasRenderingContext2D, rng: Rng, y0: number, y1: number, count: number, alpha = 0.9): void => {
  ctx.save()
  ctx.strokeStyle = css('seaFoam', alpha)
  ctx.lineWidth = 2.2
  for (let i = 0; i < count; i++) {
    const x = 40 + rng.next() * (PAGE_TEX_W - 80)
    const y = y0 + rng.next() * Math.max(1, y1 - y0)
    ctx.beginPath()
    ctx.arc(x - 7, y, 7, Math.PI * 1.1, Math.PI * 1.9)
    ctx.arc(x + 7, y, 7, Math.PI * 1.1, Math.PI * 1.9)
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * The sea along the top of the page down to a wavy shoreline at `shoreZ`,
 * with a foam line and a strip of beach below it. The enemy wades out of it.
 */
const seaTop = (ctx: CanvasRenderingContext2D, rng: Rng, shoreZ: number): void => {
  const shore = (x: number): number => py(shoreZ + Math.sin(x * 1.3 + 0.7) * 0.18 + Math.sin(x * 3.1) * 0.06)
  ctx.save()
  // Beach first, a little below the waterline.
  ctx.beginPath()
  ctx.moveTo(0, 0)
  for (let x = -PAGE_HALF_W; x <= PAGE_HALF_W + 0.01; x += 0.25) ctx.lineTo(px(x), shore(x) + 44)
  ctx.lineTo(PAGE_TEX_W, 0)
  ctx.closePath()
  ctx.fillStyle = HEX.sand
  ctx.fill()
  // The sea, deep at the top.
  const g = ctx.createLinearGradient(0, 0, 0, py(shoreZ))
  g.addColorStop(0, HEX.seaDeep)
  g.addColorStop(1, HEX.sea)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  for (let x = -PAGE_HALF_W; x <= PAGE_HALF_W + 0.01; x += 0.25) ctx.lineTo(px(x), shore(x))
  ctx.lineTo(PAGE_TEX_W, 0)
  ctx.closePath()
  ctx.fillStyle = g
  ctx.fill()
  // Foam along the shore.
  ctx.strokeStyle = css('seaFoam', 0.95)
  ctx.lineWidth = 6
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (let x = -PAGE_HALF_W; x <= PAGE_HALF_W + 0.01; x += 0.25) {
    if (x === -PAGE_HALF_W) ctx.moveTo(px(x), shore(x))
    else ctx.lineTo(px(x), shore(x))
  }
  ctx.stroke()
  ctx.strokeStyle = css('ink', 0.35)
  ctx.lineWidth = 1.6
  ctx.stroke()
  ctx.restore()
  waveMarks(ctx, rng, 30, py(shoreZ) - 30, 26)
  // Pebbles on the beach.
  for (let i = 0; i < 18; i++) {
    const x = -4.7 + rng.next() * 9.4
    const y = shore(x) + 10 + rng.next() * 28
    ctx.fillStyle = rng.next() < 0.5 ? HEX.sandDark : HEX.rock
    ctx.beginPath()
    ctx.arc(px(x), y, 2.5 + rng.next() * 3, 0, Math.PI * 2)
    ctx.fill()
  }
}

/**
 * A boat's channel: water along the fold's line, `depth` either side, with
 * foamy banks, and stepping stones where each road fords it. Drawn over the
 * roads (they wade).
 */
const channel = (ctx: CanvasRenderingContext2D, page: PageDef, f: FoldDef, rng: Rng): void => {
  const { ux, uz, nx, nz, len } = frame(f)
  const a0 = [f.ax - ux * 0.4, f.az - uz * 0.4]
  const a1 = [f.ax + ux * (len + 0.4), f.az + uz * (len + 0.4)]
  ctx.save()
  const band = (half: number, fill: string): void => {
    ctx.beginPath()
    ctx.moveTo(px(a0[0]! + nx * half), py(a0[1]! + nz * half))
    ctx.lineTo(px(a1[0]! + nx * half), py(a1[1]! + nz * half))
    ctx.lineTo(px(a1[0]! - nx * half), py(a1[1]! - nz * half))
    ctx.lineTo(px(a0[0]! - nx * half), py(a0[1]! - nz * half))
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
  }
  band(f.depth + 0.12, HEX.sandDark)
  band(f.depth, HEX.sea)
  band(f.depth * 0.45, css('seaDeep', 0.55))
  // Ink banks.
  ctx.strokeStyle = css('ink', 0.45)
  ctx.lineWidth = 2
  for (const sgn of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(px(a0[0]! + nx * f.depth * sgn), py(a0[1]! + nz * f.depth * sgn))
    ctx.lineTo(px(a1[0]! + nx * f.depth * sgn), py(a1[1]! + nz * f.depth * sgn))
    ctx.stroke()
  }
  ctx.restore()
  // Current marks along the channel.
  ctx.save()
  ctx.strokeStyle = css('seaFoam', 0.9)
  ctx.lineWidth = 2
  for (let i = 0; i < 16; i++) {
    const s = rng.next() * len
    const d = (rng.next() - 0.5) * f.depth * 1.2
    const x = f.ax + ux * s + nx * d
    const z = f.az + uz * s + nz * d
    ctx.beginPath()
    ctx.moveTo(px(x - ux * 0.25), py(z - uz * 0.25))
    ctx.quadraticCurveTo(px(x) + nx * 5, py(z) + nz * 5, px(x + ux * 0.25), py(z + uz * 0.25))
    ctx.stroke()
  }
  ctx.restore()
  // Stepping stones where the roads ford the channel.
  for (const l of page.lanes) {
    const x = laneX(l.points, f.az)
    for (let k = -2; k <= 2; k++) {
      const z = f.az + (k / 2.5) * f.depth
      ctx.fillStyle = HEX.rock
      blob(ctx, px(x + (rng.next() - 0.5) * 0.3), py(z), 8, 6, rng, 6, 0.2)
      ctx.fill()
      ctx.strokeStyle = css('ink', 0.4)
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }
}

/** Wooden pier planks beside the boat's dock (outside the flap). */
const pier = (ctx: CanvasRenderingContext2D, f: FoldDef): void => {
  const { ux, uz } = frame(f)
  const x = f.ax - ux * 0.25
  const z = f.az - uz * 0.25
  ctx.save()
  ctx.translate(px(x), py(z))
  ctx.rotate(Math.atan2(uz, ux))
  const w = 0.4 * PX
  const h = (f.depth * 2 + 0.6) * PX
  ctx.fillStyle = HEX.wood
  ctx.fillRect(-w / 2, -h / 2, w, h)
  ctx.strokeStyle = HEX.woodDark
  ctx.lineWidth = 1.6
  for (let y = -h / 2 + 7; y < h / 2; y += 9) {
    ctx.beginPath()
    ctx.moveTo(-w / 2, y)
    ctx.lineTo(w / 2, y)
    ctx.stroke()
  }
  ctx.strokeStyle = css('ink', 0.6)
  ctx.strokeRect(-w / 2, -h / 2, w, h)
  ctx.restore()
}

/** Reed tufts in the salt marsh. */
const reeds = (ctx: CanvasRenderingContext2D, rng: Rng, page: PageDef, count: number): void => {
  ctx.save()
  ctx.lineCap = 'round'
  for (let i = 0; i < count; i++) {
    const x = -4.7 + rng.next() * 9.4
    const z = -5 + rng.next() * 10
    if (!offLane(page, x, z, 0.7)) continue
    ctx.strokeStyle = rng.next() < 0.5 ? HEX.kelp : HEX.forestDark
    ctx.lineWidth = 1.6
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath()
      ctx.moveTo(px(x) + k * 2, py(z))
      ctx.lineTo(px(x) + k * 4, py(z) - 10 - rng.next() * 8)
      ctx.stroke()
    }
  }
  ctx.restore()
}

const pool = (ctx: CanvasRenderingContext2D, rng: Rng, x: number, z: number, r: number): void => {
  blob(ctx, px(x), py(z), r * PX, r * PX * 0.8, rng, 10, 0.18)
  ctx.fillStyle = HEX.sea
  ctx.fill()
  ctx.strokeStyle = css('ink', 0.45)
  ctx.lineWidth = 2
  ctx.stroke()
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2
    ctx.fillStyle = k % 2 ? HEX.rock : HEX.rockDark
    ctx.beginPath()
    ctx.arc(px(x) + Math.cos(a) * r * PX * 1.05, py(z) + Math.sin(a) * r * PX * 0.85, 4 + rng.next() * 3, 0, Math.PI * 2)
    ctx.fill()
  }
}

/**
 * Book 3: where each sea page's printed shoreline is. `PageView` keeps its
 * props out of the water with the same numbers.
 */
export const SEA_SHORE: Readonly<Partial<Record<PageDef['theme'], number>>> = {
  harbour: -4.9, marsh: -5.7, lighthouse: -5.2, shipyard: -5.6, deep: -1.9
}

/** A page's printed shoreline, if it has a sea (book 3's sea pages, and its finale page). */
export const shoreOf = (page: PageDef): number | undefined =>
  SEA_SHORE[page.theme] ?? (page.book === 3 && page.theme === 'finale' ? OUTRO.seaZ : undefined)

/** The page's roads from the beach down (the marchers wade out of the sea to them). */
const roadsAshore = (ctx: CanvasRenderingContext2D, page: PageDef, shoreZ: number, width: number): void => {
  for (const l of page.lanes) {
    const pts: number[] = []
    for (let i = 0; i < l.points.length; i += 2) if (l.points[i + 1]! > shoreZ + 0.1) pts.push(l.points[i]!, l.points[i + 1]!)
    // Start right at the waterline.
    if (pts.length >= 2) pts.unshift(laneX(l.points, shoreZ + 0.1), shoreZ + 0.1)
    if (pts.length >= 4) road(ctx, pts, width)
  }
}

/** The boat channels and piers of a page, and its pleats' ground print. */
const seaFolds = (ctx: CanvasRenderingContext2D, page: PageDef, rng: Rng): void => {
  for (const f of page.folds) {
    if (f.kind !== 'boat') continue
    channel(ctx, page, f, rng)
    pier(ctx, f)
  }
}

const paintHarbour = (ctx: CanvasRenderingContext2D, page: PageDef, rng: Rng): void => {
  meadows(ctx, rng, 7)
  seaTop(ctx, rng, SEA_SHORE.harbour!)
  roadsAshore(ctx, page, SEA_SHORE.harbour!, 44)
  seaFolds(ctx, page, rng)
  // Little boats moored in the harbour, printed on the sea.
  for (const [x, z] of [[-3.8, -5.9], [-1.6, -6.3], [2.2, -6.0], [4.1, -5.6]] as const) {
    if (!offLane(page, x, z, 0.8)) continue
    ctx.save()
    ctx.translate(px(x), py(z))
    ctx.fillStyle = HEX.paperWhite
    ctx.strokeStyle = css('ink', 0.55)
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(-18, 0)
    ctx.lineTo(18, 0)
    ctx.lineTo(11, 9)
    ctx.lineTo(-11, 9)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
  flowers(ctx, rng, 30)
  compass(ctx, px(3.9), py(5.4), 38)
}

const paintMarsh = (ctx: CanvasRenderingContext2D, page: PageDef, rng: Rng): void => {
  // Wet sand flats with shallow pools, reeds and a thin sea along the top.
  ctx.fillStyle = css('sand', 0.8)
  ctx.fillRect(0, 0, PAGE_TEX_W, PAGE_TEX_H)
  meadows(ctx, rng, 4)
  seaTop(ctx, rng, -5.7)
  for (let i = 0; i < 9; i++) {
    const x = -4.6 + rng.next() * 9.2
    const z = -4.6 + rng.next() * 9
    if (!offLane(page, x, z, 1.1)) continue
    blob(ctx, px(x), py(z), 30 + rng.next() * 40, 18 + rng.next() * 20, rng, 9, 0.2)
    ctx.fillStyle = css('sea', 0.6)
    ctx.fill()
  }
  roadsAshore(ctx, page, -5.7, 42)
  reeds(ctx, rng, page, 60)
  // The tide pool (the page's secret: a sling stone into it).
  pool(ctx, rng, -4.2, -3.4, 0.55)
}

const paintLighthouse = (ctx: CanvasRenderingContext2D, page: PageDef, rng: Rng): void => {
  meadows(ctx, rng, 9)
  seaTop(ctx, rng, -5.2)
  // Cliffs and the lighthouse's rock on the right bank.
  for (let i = 0; i < 22; i++) {
    const x = -4.8 + rng.next() * 9.6
    const z = -5.3 + (rng.next() - 0.5) * 0.5
    ctx.fillStyle = rng.next() < 0.5 ? HEX.rock : HEX.rockDark
    blob(ctx, px(x), py(z), 10 + rng.next() * 10, 7 + rng.next() * 6, rng, 6, 0.25)
    ctx.fill()
    ctx.strokeStyle = css('ink', 0.45)
    ctx.lineWidth = 1.2
    ctx.stroke()
  }
  ctx.save()
  blob(ctx, px(4.2), py(-3.6), 70, 56, rng, 10, 0.15)
  ctx.fillStyle = HEX.rock
  ctx.fill()
  ctx.strokeStyle = css('ink', 0.5)
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()
  roadsAshore(ctx, page, -5.2, 42)
  seaFolds(ctx, page, rng)
  flowers(ctx, rng, 25)
}

const paintShipyard = (ctx: CanvasRenderingContext2D, page: PageDef, rng: Rng): void => {
  meadows(ctx, rng, 5)
  seaTop(ctx, rng, -5.6)
  // Slipways running from the beach down into the sea (beside the catapult flaps' landing), and stacks of timber.
  for (const x of [-1.6, 1.6]) {
    ctx.save()
    ctx.translate(px(x), py(-6.3))
    ctx.fillStyle = HEX.wood
    ctx.fillRect(-22, -50, 44, 120)
    ctx.strokeStyle = HEX.woodDark
    ctx.lineWidth = 2
    for (let y = -46; y < 70; y += 12) {
      ctx.beginPath()
      ctx.moveTo(-22, y)
      ctx.lineTo(22, y)
      ctx.stroke()
    }
    ctx.strokeStyle = css('ink', 0.55)
    ctx.strokeRect(-22, -50, 44, 120)
    ctx.restore()
  }
  for (let i = 0; i < 6; i++) {
    const x = -4.5 + rng.next() * 9
    const z = -2 + rng.next() * 6
    if (!offLane(page, x, z, 1)) continue
    ctx.save()
    ctx.translate(px(x), py(z))
    ctx.rotate((rng.next() - 0.5) * 0.6)
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = k % 2 ? HEX.woodDark : HEX.wood
      ctx.fillRect(-24, -9 + k * 6, 48, 5)
    }
    ctx.restore()
  }
  roadsAshore(ctx, page, -5.6, 44)
  seaFolds(ctx, page, rng)
  flowers(ctx, rng, 15)
}

const paintDeep = (ctx: CanvasRenderingContext2D, page: PageDef, rng: Rng): void => {
  meadows(ctx, rng, 5)
  // The kraken's sea fills the top half; a swirl of current where it sleeps.
  seaTop(ctx, rng, -1.9)
  ctx.save()
  ctx.strokeStyle = css('seaDeep', 0.7)
  ctx.lineWidth = 3
  for (let k = 1; k <= 5; k++) {
    ctx.beginPath()
    ctx.ellipse(px(0), py(-4.6), 70 * k, 34 * k, 0, 0.2 * k, Math.PI * 1.6 + 0.2 * k)
    ctx.stroke()
  }
  ctx.restore()
  // Roads start at the shore: the boarders come off the tentacles.
  roadsAshore(ctx, page, -1.9, 42)
  flowers(ctx, rng, 20)
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
  camp: paintCamp,
  harbour: paintHarbour,
  marsh: paintMarsh,
  lighthouse: paintLighthouse,
  shipyard: paintShipyard,
  deep: paintDeep
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

// ─── Papers (roadmap #6) ───────────────────────────────────────────────────

/** Base stock of each paper; Winter prints plain maps on snow-white paper. */
const PAPER_TINT: Record<PaperPattern, PaletteKey> = {
  plain: 'parchment',
  graph: 'graphPaper',
  washi: 'washi',
  newsprint: 'newsprint',
  map: 'mapPaper',
  chart: 'chartPaper'
}

/** A small repeating tile as a canvas pattern (one fill for the whole sheet). */
const tile = (ctx: CanvasRenderingContext2D, size: number, draw: (t: CanvasRenderingContext2D) => void): CanvasPattern | null => {
  const [c, t] = makeCanvas(size, size)
  draw(t)
  return ctx.createPattern(c, 'repeat')
}

const fillTile = (ctx: CanvasRenderingContext2D, pat: CanvasPattern | null): void => {
  if (!pat) return
  ctx.save()
  ctx.fillStyle = pat
  ctx.fillRect(0, 0, PAGE_TEX_W, PAGE_TEX_H)
  ctx.restore()
}

const gridTile = (ctx: CanvasRenderingContext2D, alphaMinor: number, alphaMajor: number): CanvasPattern | null =>
  tile(ctx, 80, (t) => {
    t.strokeStyle = css('graphLine', alphaMinor)
    t.lineWidth = 1
    for (let i = 0; i < 80; i += 16) {
      t.beginPath()
      t.moveTo(i + 0.5, 0)
      t.lineTo(i + 0.5, 80)
      t.moveTo(0, i + 0.5)
      t.lineTo(80, i + 0.5)
      t.stroke()
    }
    t.strokeStyle = css('graphLine', alphaMajor)
    t.lineWidth = 1.6
    t.beginPath()
    t.moveTo(0.8, 0)
    t.lineTo(0.8, 80)
    t.moveTo(0, 0.8)
    t.lineTo(80, 0.8)
    t.stroke()
  })

const halftoneTile = (ctx: CanvasRenderingContext2D, alpha: number): CanvasPattern | null =>
  tile(ctx, 12, (t) => {
    t.fillStyle = css('newsInk', alpha)
    t.beginPath()
    t.arc(3, 3, 1.3, 0, Math.PI * 2)
    t.arc(9, 9, 1.3, 0, Math.PI * 2)
    t.fill()
  })

/** Kozo fibres: long, soft, slightly curved strands. */
const washiFibres = (ctx: CanvasRenderingContext2D, rng: Rng, count: number, alpha: number): void => {
  ctx.save()
  ctx.lineCap = 'round'
  for (let i = 0; i < count; i++) {
    const x = rng.next() * PAGE_TEX_W
    const y = rng.next() * PAGE_TEX_H
    const len = 20 + rng.next() * 50
    const a = rng.next() * Math.PI
    const bend = (rng.next() - 0.5) * 18
    ctx.strokeStyle = css('washiFibre', alpha)
    ctx.lineWidth = 0.7 + rng.next() * 1
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 - Math.sin(a) * bend, y + Math.sin(a) * len * 0.5 + Math.cos(a) * bend, x + Math.cos(a) * len, y + Math.sin(a) * len)
    ctx.stroke()
  }
  ctx.restore()
}

/** Seigaiha: rows of overlapping wave arcs, printed very faint. */
const seigaiha = (ctx: CanvasRenderingContext2D, alpha: number): void => {
  ctx.save()
  ctx.strokeStyle = css('washiPrint', alpha)
  ctx.lineWidth = 1.4
  const r = 30
  for (let row = 0, y = 0; y < PAGE_TEX_H + r; row++, y += r * 0.5) {
    const off = row % 2 ? r : 0
    for (let x = -r + off; x < PAGE_TEX_W + r; x += r * 2) {
      for (const k of [1, 0.66, 0.33]) {
        ctx.beginPath()
        ctx.arc(x, y, r * k, Math.PI, Math.PI * 2)
        ctx.stroke()
      }
    }
  }
  ctx.restore()
}

/** Newsprint: columns of grey "type", a few headline bars, a halftone photo block. */
const newsColumns = (ctx: CanvasRenderingContext2D, rng: Rng, alpha: number): void => {
  ctx.save()
  const colW = 150
  for (let x = 44; x + colW < PAGE_TEX_W - 30; x += colW + 22) {
    let y = 50
    while (y < PAGE_TEX_H - 50) {
      if (rng.next() < 0.06) {
        // A headline bar and a gap.
        ctx.fillStyle = css('newsInk', alpha * 1.5)
        ctx.fillRect(x, y, colW * (0.6 + rng.next() * 0.4), 9)
        y += 22
        continue
      }
      if (rng.next() < 0.025) {
        // A halftone photo block.
        const h = 70 + rng.next() * 60
        ctx.fillStyle = css('newsInk', alpha * 0.6)
        ctx.fillRect(x, y, colW, h)
        y += h + 12
        continue
      }
      ctx.fillStyle = css('newsInk', alpha)
      ctx.fillRect(x, y, colW * (0.7 + rng.next() * 0.3), 3)
      y += 11
    }
  }
  // Column rules.
  ctx.strokeStyle = css('newsInk', alpha)
  ctx.lineWidth = 1
  for (let x = 44 + colW + 11; x < PAGE_TEX_W - 30; x += colW + 22) {
    ctx.beginPath()
    ctx.moveTo(x, 40)
    ctx.lineTo(x, PAGE_TEX_H - 40)
    ctx.stroke()
  }
  ctx.restore()
}

/** Survey map: contour rings around a few hills, and a dashed graticule. */
const contours = (ctx: CanvasRenderingContext2D, rng: Rng, alpha: number, key: PaletteKey = 'mapLine'): void => {
  ctx.save()
  ctx.strokeStyle = css(key, alpha)
  ctx.lineWidth = 1.3
  for (let i = 0; i < 6; i++) {
    const cx = rng.next() * PAGE_TEX_W
    const cy = rng.next() * PAGE_TEX_H
    const rings = 5 + Math.floor(rng.next() * 4)
    const rx = 90 + rng.next() * 90
    const ry = 70 + rng.next() * 70
    for (let k = 1; k <= rings; k++) {
      blob(ctx, cx, cy, (rx * k) / rings, (ry * k) / rings, rng, 10, 0.12)
      ctx.stroke()
    }
  }
  ctx.restore()
}

const graticule = (ctx: CanvasRenderingContext2D, alpha: number, key: PaletteKey = 'mapLine'): void => {
  ctx.save()
  ctx.strokeStyle = css(key, alpha)
  ctx.lineWidth = 1.2
  ctx.setLineDash([10, 7])
  for (let x = 128; x < PAGE_TEX_W; x += 128) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, PAGE_TEX_H)
    ctx.stroke()
  }
  for (let y = 128; y < PAGE_TEX_H; y += 128) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(PAGE_TEX_W, y)
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Sea chart (book 3's paper): rhumb lines fanning out of two compass points,
 * dashed depth lines, and sounding marks (little crosses and dots).
 */
const rhumbs = (ctx: CanvasRenderingContext2D, rng: Rng, alpha: number, key: PaletteKey = 'chartLine'): void => {
  ctx.save()
  ctx.strokeStyle = css(key, alpha)
  ctx.lineWidth = 1.1
  for (const [cx, cy] of [[PAGE_TEX_W * 0.28, PAGE_TEX_H * 0.3], [PAGE_TEX_W * 0.74, PAGE_TEX_H * 0.72]] as const) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(a) * 1600, cy + Math.sin(a) * 1600)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(cx, cy, 34, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

const soundings = (ctx: CanvasRenderingContext2D, rng: Rng, alpha: number, key: PaletteKey = 'chartLine'): void => {
  ctx.save()
  ctx.strokeStyle = css(key, alpha)
  ctx.fillStyle = css(key, alpha)
  ctx.lineWidth = 1.2
  ctx.setLineDash([8, 6])
  for (let i = 0; i < 4; i++) {
    blob(ctx, rng.next() * PAGE_TEX_W, rng.next() * PAGE_TEX_H, 120 + rng.next() * 120, 80 + rng.next() * 90, rng, 10, 0.15)
    ctx.stroke()
  }
  ctx.setLineDash([])
  for (let i = 0; i < 90; i++) {
    const x = rng.next() * PAGE_TEX_W
    const y = rng.next() * PAGE_TEX_H
    if (i % 3 === 0) {
      ctx.beginPath()
      ctx.moveTo(x - 3, y - 3)
      ctx.lineTo(x + 3, y + 3)
      ctx.moveTo(x + 3, y - 3)
      ctx.lineTo(x - 3, y + 3)
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.arc(x, y, 1.4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** The paper's own print, under the illustration (full strength, but pale). */
const paperUnder = (ctx: CanvasRenderingContext2D, paper: PaperPattern, rng: Rng): void => {
  switch (paper) {
    case 'graph':
      fillTile(ctx, gridTile(ctx, 0.35, 0.6))
      break
    case 'washi':
      seigaiha(ctx, 0.14)
      washiFibres(ctx, rng, 420, 0.4)
      break
    case 'newsprint':
      newsColumns(ctx, rng, 0.16)
      break
    case 'map':
      contours(ctx, rng, 0.38)
      graticule(ctx, 0.32)
      break
    case 'chart':
      rhumbs(ctx, rng, 0.34)
      soundings(ctx, rng, 0.4)
      break
  }
}

/**
 * A faint veil of the same print over the illustration, so the paper shows
 * through the meadows too. Light enough that roads, folds and cut lines keep
 * their contrast (≤ 0.12 alpha of a pale colour).
 */
const paperOver = (ctx: CanvasRenderingContext2D, paper: PaperPattern, rng: Rng): void => {
  switch (paper) {
    case 'graph':
      fillTile(ctx, gridTile(ctx, 0.06, 0.12))
      break
    case 'washi':
      washiFibres(ctx, rng, 160, 0.2)
      break
    case 'newsprint':
      fillTile(ctx, halftoneTile(ctx, 0.07))
      break
    case 'map':
      graticule(ctx, 0.1)
      break
    case 'chart':
      rhumbs(ctx, rng, 0.1)
      break
  }
}

// ─── Seasons (roadmap #17) ─────────────────────────────────────────────────

/** Lane x at z (the lane's polyline, clamped at its ends). */
const laneX = (points: readonly number[], z: number): number => {
  if (z <= points[1]!) return points[0]!
  for (let i = 2; i < points.length; i += 2) {
    if (z <= points[i + 1]!) {
      const t = (z - points[i - 1]!) / (points[i + 1]! - points[i - 1]! || 1)
      return points[i - 2]! + (points[i]! - points[i - 2]!) * t
    }
  }
  return points[points.length - 2]!
}

/** Is a page point clear of every lane (by `margin` page units) and of the keep's grounds? */
const offLane = (page: PageDef, x: number, z: number, margin: number): boolean => {
  if (z > 5.6) return false
  for (const l of page.lanes) if (Math.abs(laneX(l.points, z) - x) < margin) return false
  return true
}

/** A page point clear of the lanes (tries a few times; null if none found). */
const spotOffLane = (page: PageDef, rng: Rng, margin: number): [number, number] | null => {
  for (let k = 0; k < 12; k++) {
    const x = -4.6 + rng.next() * 9.2
    const z = -6.5 + rng.next() * 12
    if (offLane(page, x, z, margin)) return [x, z]
  }
  return null
}

const pumpkin = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void => {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = HEX.pumpkin
  ctx.strokeStyle = css('ink', 0.6)
  ctx.lineWidth = 1.6
  for (const dx of [-0.45, 0.45, 0]) {
    ctx.beginPath()
    ctx.ellipse(dx * r, 0, r * 0.62, r * 0.8, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.strokeStyle = css('pumpkinDark', 0.9)
  ctx.beginPath()
  ctx.moveTo(0, -r * 0.7)
  ctx.lineTo(0, r * 0.7)
  ctx.stroke()
  ctx.fillStyle = HEX.pumpkinStem
  ctx.fillRect(-r * 0.12, -r * 1.05, r * 0.24, r * 0.35)
  ctx.restore()
}

const printedBat = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number): void => {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  ctx.scale(s, s)
  ctx.fillStyle = css('bat', 0.75)
  ctx.beginPath()
  ctx.moveTo(0, -4)
  ctx.quadraticCurveTo(8, -12, 20, -6)
  ctx.quadraticCurveTo(15, -2, 16, 4)
  ctx.quadraticCurveTo(10, 0, 6, 5)
  ctx.lineTo(0, 3)
  ctx.lineTo(-6, 5)
  ctx.quadraticCurveTo(-10, 0, -16, 4)
  ctx.quadraticCurveTo(-15, -2, -20, -6)
  ctx.quadraticCurveTo(-8, -12, 0, -4)
  ctx.fill()
  ctx.restore()
}

const cobweb = (ctx: CanvasRenderingContext2D, cx: number, cy: number, sx: number, sy: number): void => {
  ctx.save()
  ctx.strokeStyle = css('inkSoft', 0.35)
  ctx.lineWidth = 1.1
  const R = 120
  for (let i = 0; i <= 5; i++) {
    const a = (i / 5) * (Math.PI / 2)
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + sx * Math.cos(a) * R, cy + sy * Math.sin(a) * R)
    ctx.stroke()
  }
  for (let k = 1; k <= 4; k++) {
    const r = (k / 4) * R
    ctx.beginPath()
    for (let i = 0; i <= 5; i++) {
      const a = (i / 5) * (Math.PI / 2)
      const px0 = cx + sx * Math.cos(a) * r
      const py0 = cy + sy * Math.sin(a) * r
      if (i === 0) ctx.moveTo(px0, py0)
      else ctx.quadraticCurveTo(cx + sx * Math.cos(a - 0.16) * r * 0.86, cy + sy * Math.sin(a - 0.16) * r * 0.86, px0, py0)
    }
    ctx.stroke()
  }
  ctx.restore()
}

const snowflake = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void => {
  ctx.save()
  ctx.translate(x, y)
  ctx.strokeStyle = css('snowEdge', 0.95)
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const c = Math.cos(a)
    const sn = Math.sin(a)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(c * r, sn * r)
    ctx.moveTo(c * r * 0.55, sn * r * 0.55)
    ctx.lineTo(c * r * 0.55 + Math.cos(a + 0.8) * r * 0.3, sn * r * 0.55 + Math.sin(a + 0.8) * r * 0.3)
    ctx.moveTo(c * r * 0.55, sn * r * 0.55)
    ctx.lineTo(c * r * 0.55 + Math.cos(a - 0.8) * r * 0.3, sn * r * 0.55 + Math.sin(a - 0.8) * r * 0.3)
    ctx.stroke()
  }
  ctx.restore()
}

/** A snow bank: a bright blob with a cool shaded underside and a periwinkle-blue edge (never black). */
const snowBank = (ctx: CanvasRenderingContext2D, rng: Rng, x: number, y: number, rx: number, ry: number): void => {
  blob(ctx, x, y + ry * 0.18, rx * 1.02, ry * 0.95, rng, 10, 0.2)
  ctx.fillStyle = css('snowEdge', 0.55)
  ctx.fill()
  blob(ctx, x, y, rx, ry, rng, 10, 0.22)
  ctx.fillStyle = HEX.snowBank
  ctx.fill()
  ctx.strokeStyle = css('snowEdge', 0.9)
  ctx.lineWidth = 2.4
  ctx.stroke()
  // A soft blue crescent along its lower edge: the lamp can't wash that out.
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(x, y + ry * 0.35, rx * 0.8, ry * 0.45, 0, 0.15, Math.PI - 0.15)
  ctx.strokeStyle = css('iceBlue', 0.9)
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.restore()
}

/**
 * Winter's print (roadmap #17, made visible under the lamp): a cool snow veil
 * over the page, the roads and channels printed back on top of it (lanes stay
 * as readable as ever), deep snow banks along both long edges and drifts all
 * over the meadows — every one of them off the lanes — and printed flakes.
 */
const winterPrint = (ctx: CanvasRenderingContext2D, page: PageDef, rng: Rng): void => {
  // The veil is painted on its own sheet with the roads and channels cut out
  // of it, so lanes, bridges and water keep exactly the contrast they had.
  const [vc, v] = makeCanvas(PAGE_TEX_W, PAGE_TEX_H)
  v.fillStyle = css('snowPaper', 0.6)
  v.fillRect(0, 0, PAGE_TEX_W, PAGE_TEX_H)
  v.globalCompositeOperation = 'destination-out'
  v.lineCap = 'round'
  v.lineJoin = 'round'
  // (The castle core's blueprint prints no roads: nothing to keep clear there.)
  if (page.theme !== 'core') {
    v.lineWidth = 58
    for (const l of page.lanes) {
      const pts: number[] = []
      for (let i = 0; i < l.points.length; i += 2) pts.push(px(l.points[i]!), py(l.points[i + 1]!))
      smoothPath(v, pts)
      v.stroke()
    }
  }
  for (const f of page.folds) {
    if (f.kind !== 'boat') continue
    const { ux, uz, nx, nz, len } = frame(f)
    const h = f.depth + 0.1
    v.beginPath()
    v.moveTo(px(f.ax - ux * 0.5 + nx * h), py(f.az - uz * 0.5 + nz * h))
    v.lineTo(px(f.ax + ux * (len + 0.5) + nx * h), py(f.az + uz * (len + 0.5) + nz * h))
    v.lineTo(px(f.ax + ux * (len + 0.5) - nx * h), py(f.az + uz * (len + 0.5) - nz * h))
    v.lineTo(px(f.ax - ux * 0.5 - nx * h), py(f.az - uz * 0.5 - nz * h))
    v.closePath()
    v.fill()
  }
  v.globalCompositeOperation = 'source-over'
  ctx.drawImage(vc, 0, 0)
  // Snow lies on land: not in a boat channel, not out on the sea (book 3).
  const shore = shoreOf(page)
  const dry = (x: number, z: number): boolean => {
    if (shore !== undefined && z < shore + 0.4) return false
    for (const f of page.folds) {
      if (f.kind !== 'boat') continue
      const { ux, uz, nx, nz, len } = frame(f)
      const s = (x - f.ax) * ux + (z - f.az) * uz
      const d = (x - f.ax) * nx + (z - f.az) * nz
      if (s > -0.8 && s < len + 0.8 && Math.abs(d) < f.depth + 0.55) return false
    }
    return true
  }
  // Deep banks along both long edges.
  for (const side of [-1, 1]) {
    for (let z = -6.6; z < 5.4; z += 0.55) {
      const x = side * (PAGE_HALF_W - 0.35 - rng.next() * 0.3)
      if (!offLane(page, x, z, 0.95) || !dry(x, z)) continue
      snowBank(ctx, rng, px(x), py(z), 52 + rng.next() * 40, 32 + rng.next() * 20)
    }
  }
  // Drifts over the meadows.
  for (let i = 0; i < 56; i++) {
    const p = spotOffLane(page, rng, 1.1)
    if (!p || !dry(p[0], p[1])) continue
    snowBank(ctx, rng, px(p[0]), py(p[1]), 38 + rng.next() * 50, 22 + rng.next() * 24)
  }
  for (let i = 0; i < 70; i++) {
    const p = spotOffLane(page, rng, 0.75)
    if (p) snowflake(ctx, px(p[0]), py(p[1]), 6 + rng.next() * 8)
  }
}

/** The season's print over the illustration (under the frame and the cut lines). */
const seasonOver = (ctx: CanvasRenderingContext2D, page: PageDef, season: Season, rng: Rng): void => {
  if (season === 'halloween') {
    // A dusk wash: plum at the top where the enemy comes from, warm pumpkin light by the keep.
    const g = ctx.createLinearGradient(0, 0, 0, PAGE_TEX_H)
    g.addColorStop(0, css('duskPurple', 0.18))
    g.addColorStop(0.55, css('duskPurple', 0.06))
    g.addColorStop(1, css('duskOrange', 0.14))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, PAGE_TEX_W, PAGE_TEX_H)
    for (let i = 0; i < 9; i++) {
      const p = spotOffLane(page, rng, 1.1)
      if (p) pumpkin(ctx, px(p[0]), py(p[1]), 12 + rng.next() * 8)
    }
    for (let i = 0; i < 8; i++) {
      const p = spotOffLane(page, rng, 0.9)
      if (p) printedBat(ctx, px(p[0]), py(p[1]), 0.8 + rng.next() * 0.6, (rng.next() - 0.5) * 0.6)
    }
    cobweb(ctx, 28, 28, 1, 1)
    cobweb(ctx, PAGE_TEX_W - 28, 28, -1, 1)
  } else if (season === 'winter') {
    winterPrint(ctx, page, rng)
  }
}

// ─── Underlayer ────────────────────────────────────────────────────────────

/**
 * The layer under the flaps (darker kraft, or the ravine's shadowed floor),
 * with the equipped paper's motif in place of the blueprint grid — so a raised
 * flap shows the back of the same paper it was cut from — and the season's
 * tint on its lines. `rng` is the page's main stream (grain), `motif` the
 * look's own stream.
 */
const underlayerPattern = (ctx: CanvasRenderingContext2D, rng: Rng, dark: boolean, look: PageLook, motif: Rng): void => {
  ctx.fillStyle = dark ? HEX.ravine : HEX.underlayer
  ctx.fillRect(0, 0, PAGE_TEX_W, PAGE_TEX_H)
  const seasonKey: PaletteKey | null = look.season === 'winter' ? 'iceBlue' : look.season === 'halloween' ? 'duskPurple' : null
  const lineKey: PaletteKey = dark ? 'ink' : seasonKey ?? 'blueprint'
  const alpha = dark ? 0.35 : 0.6
  switch (look.paper) {
    case 'washi':
      washiFibres(ctx, motif, 260, dark ? 0.25 : 0.55)
      break
    case 'newsprint': {
      ctx.fillStyle = css(dark ? 'ink' : seasonKey ?? 'newsInk', dark ? 0.2 : 0.3)
      for (let y = 30; y < PAGE_TEX_H - 30; y += 12) {
        for (let x = 30; x < PAGE_TEX_W - 30; x += 160) ctx.fillRect(x, y, 130 * (0.7 + motif.next() * 0.3), 3)
      }
      break
    }
    case 'map':
      contours(ctx, motif, alpha, dark ? 'ink' : seasonKey ?? 'underlayerInk')
      break
    case 'chart':
      rhumbs(ctx, motif, alpha, dark ? 'ink' : seasonKey ?? 'underlayerInk')
      break
    default: {
      // Plain and graph: the blueprint grid (graph paper's back is a finer one).
      const step = look.paper === 'graph' ? 16 : 24
      ctx.strokeStyle = css(lineKey, alpha)
      ctx.lineWidth = look.paper === 'graph' ? 1 : 1.2
      for (let x = 0; x < PAGE_TEX_W; x += step) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, PAGE_TEX_H)
        ctx.stroke()
      }
      for (let y = 0; y < PAGE_TEX_H; y += step) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(PAGE_TEX_W, y)
        ctx.stroke()
      }
    }
  }
  paperGrain(ctx, PAGE_TEX_W, PAGE_TEX_H, rng, 0.35)
}

// ─── Entry point ───────────────────────────────────────────────────────────

/** Paper ids `paintPage` can print on (tests: every one paints). */
export const PAGE_PAPERS: readonly PaperPattern[] = ['plain', 'graph', 'washi', 'newsprint', 'map', 'chart']

export const paintPage = (page: PageDef, look: PageLook = PLAIN_LOOK): PageTextures => {
  const rng = seeded(page.book * 104729 + page.id * 7919 + 17)
  // The look's own stream: the layout (meadows, rocks…) is the same on every paper.
  const motif = seeded(page.book * 104729 + page.id * 7919 + 31337)
  const paper: PaperPattern = PAPER_TINT[look.paper] ? look.paper : 'plain'
  const [artC, art] = makeCanvas(PAGE_TEX_W, PAGE_TEX_H)
  const tint = paper === 'plain' && look.season === 'winter' ? HEX.snowPaper : HEX[PAPER_TINT[paper]]
  parchmentBase(art, rng, tint)
  paperUnder(art, paper, motif)
  paperGrain(art, PAGE_TEX_W, PAGE_TEX_H, rng)
  PAINTERS[page.theme](art, page, rng)
  keepGrounds(art)
  stains(art, PAGE_TEX_W, PAGE_TEX_H, rng, 5)
  paperOver(art, paper, motif)
  seasonOver(art, page, look.season, motif)
  mapFrame(art)
  // (Ballistas fold on the towers, not out of the page: no cut.)
  for (const f of page.folds) if (f.kind !== 'frog' && f.kind !== 'ballista') cutLine(art, f)
  edgeBurn(art, PAGE_TEX_W, PAGE_TEX_H)

  // The page itself: the same print, with holes where flaps are cut out.
  const [pageC, pg] = makeCanvas(PAGE_TEX_W, PAGE_TEX_H)
  pg.drawImage(artC, 0, 0)
  const [underC, under] = makeCanvas(PAGE_TEX_W, PAGE_TEX_H)
  underlayerPattern(under, rng, false, { paper, season: look.season }, motif)
  const [ravineC, rav] = makeCanvas(PAGE_TEX_W, PAGE_TEX_H)
  underlayerPattern(rav, rng, true, { paper, season: look.season }, motif)
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
