/**
 * Canvas helpers shared by the procedural painters.
 */

import { CanvasTexture, LinearMipmapLinearFilter, LinearFilter, SRGBColorSpace } from 'three'
import { createRng, type Rng } from '../../logic/rng'
import { HEX, css, type PaletteKey } from '../palette'

export const makeCanvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: false })
  if (!ctx) throw new Error('[fold] 2D canvas unavailable')
  return [c, ctx]
}

export const toTexture = (c: HTMLCanvasElement, mips = true): CanvasTexture => {
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  t.generateMipmaps = mips
  t.minFilter = mips ? LinearMipmapLinearFilter : LinearFilter
  t.magFilter = LinearFilter
  t.needsUpdate = true
  return t
}

export const seeded = (seed: number): Rng => createRng(seed)

/** Draw a smooth closed blob (organic meadow patch) through `points` jittered radii. */
export const blob = (
  ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, rng: Rng, lobes = 9, wobble = 0.22
): void => {
  const pts: [number, number][] = []
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2
    const r = 1 + (rng.next() - 0.5) * 2 * wobble
    pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r])
  }
  ctx.beginPath()
  for (let i = 0; i < lobes; i++) {
    const p0 = pts[i]!
    const p1 = pts[(i + 1) % lobes]!
    const mx = (p0[0] + p1[0]) / 2
    const my = (p0[1] + p1[1]) / 2
    if (i === 0) {
      const pl = pts[lobes - 1]!
      ctx.moveTo((pl[0] + p0[0]) / 2, (pl[1] + p0[1]) / 2)
    }
    ctx.quadraticCurveTo(p0[0], p0[1], mx, my)
  }
  ctx.closePath()
}

/** Ink stroke helper — slightly irregular width like a dip pen. */
export const inkLine = (ctx: CanvasRenderingContext2D, pts: number[], width: number, color: string = HEX.ink): void => {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(pts[0]!, pts[1]!)
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!)
  ctx.stroke()
  ctx.restore()
}

/** Smooth polyline through points (Catmull-Rom → quadratic midpoints). */
export const smoothPath = (ctx: CanvasRenderingContext2D, pts: number[]): void => {
  ctx.beginPath()
  ctx.moveTo(pts[0]!, pts[1]!)
  for (let i = 2; i < pts.length - 2; i += 2) {
    const mx = (pts[i]! + pts[i + 2]!) / 2
    const my = (pts[i + 1]! + pts[i + 3]!) / 2
    ctx.quadraticCurveTo(pts[i]!, pts[i + 1]!, mx, my)
  }
  ctx.lineTo(pts[pts.length - 2]!, pts[pts.length - 1]!)
}

/** Paper fibres + tooth over the whole canvas (multiply). */
export const paperGrain = (ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, strength = 1): void => {
  ctx.save()
  // Long fibres.
  for (let i = 0; i < 900 * strength; i++) {
    const x = rng.next() * w
    const y = rng.next() * h
    const len = 6 + rng.next() * 26
    const a = rng.next() * Math.PI
    ctx.strokeStyle = rng.next() < 0.5 ? css('parchmentShade', 0.35) : css('parchmentLight', 0.45)
    ctx.lineWidth = 0.6 + rng.next() * 0.9
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
    ctx.stroke()
  }
  // Tooth speckle.
  for (let i = 0; i < 5000 * strength; i++) {
    const x = rng.next() * w
    const y = rng.next() * h
    ctx.fillStyle = rng.next() < 0.6 ? css('parchmentEdge', 0.18) : css('paperWhite', 0.22)
    ctx.fillRect(x, y, 1.2, 1.2)
  }
  ctx.restore()
}

/** Tea-stain rings and blotches for an old-map feel. */
export const stains = (ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, count = 4): void => {
  ctx.save()
  for (let i = 0; i < count; i++) {
    const x = rng.next() * w
    const y = rng.next() * h
    const r = 30 + rng.next() * 90
    const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r)
    g.addColorStop(0, css('parchmentShade', 0))
    g.addColorStop(0.75, css('parchmentShade', 0.18))
    g.addColorStop(0.92, css('parchmentEdge', 0.28))
    g.addColorStop(1, css('parchmentShade', 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** Darken the sheet's edges (deckled, handled paper). */
export const edgeBurn = (ctx: CanvasRenderingContext2D, w: number, h: number, key: PaletteKey = 'parchmentEdge', amount = 0.42): void => {
  ctx.save()
  const gx = ctx.createLinearGradient(0, 0, w, 0)
  gx.addColorStop(0, css(key, amount))
  gx.addColorStop(0.06, css(key, 0))
  gx.addColorStop(0.94, css(key, 0))
  gx.addColorStop(1, css(key, amount))
  ctx.fillStyle = gx
  ctx.fillRect(0, 0, w, h)
  const gy = ctx.createLinearGradient(0, 0, 0, h)
  gy.addColorStop(0, css(key, amount))
  gy.addColorStop(0.045, css(key, 0))
  gy.addColorStop(0.955, css(key, 0))
  gy.addColorStop(1, css(key, amount))
  ctx.fillStyle = gy
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}
