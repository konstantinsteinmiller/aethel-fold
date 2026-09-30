/**
 * Painted art for the desk bookshelf (roadmap #2): each book's spine and the
 * little star card an inspected book shows. Wordless — numbers and origami
 * stars only, so nothing here needs a locale.
 *
 * A book is one box with one texture: the spine art fills the top of the
 * canvas, and a strip along the bottom holds two flat swatches the other faces
 * sample (the cover boards and the page block). See `SPINE_UV`.
 */

import type { ShelfSlot } from '../../logic/shelf'
import type { PaletteKey } from '../palette'
import { HEX, css } from '../palette'
import { makeCanvas, paperGrain, seeded } from './canvas'

export const SPINE_TEX_W = 128
export const SPINE_TEX_H = 352
/** Height of the swatch strip at the bottom of the spine canvas. */
const STRIP = 32

/** UV ranges inside the spine texture (v = 0 at the canvas bottom). */
export const SPINE_UV = {
  /** The spine art. */
  spine: { u0: 0.02, u1: 0.98, v0: (STRIP + 3) / SPINE_TEX_H, v1: 0.995 },
  /** A point inside the cover-board swatch. */
  cover: { u: 0.25, v: (STRIP / 2) / SPINE_TEX_H },
  /** A point inside the page-block swatch. */
  pages: { u: 0.75, v: (STRIP / 2) / SPINE_TEX_H }
} as const

export const CARD_TEX_W = 256
export const CARD_TEX_H = 320

/** Cover colour per book (book 3 is painted when it arrives). */
const COVER: Readonly<Record<number, [PaletteKey, PaletteKey]>> = {
  1: ['bookCover', 'bookCoverDark'],
  2: ['heroBlue', 'heroBlueDark'],
  3: ['dragonGreen', 'dragonGreenDark']
}

const star = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, stroke: string = HEX.ink): void => {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.46 : r
    const x = cx + Math.cos(a) * rr
    const y = cy + Math.sin(a) * rr
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = Math.max(2, r * 0.18)
  ctx.lineJoin = 'round'
  ctx.strokeStyle = stroke
  ctx.stroke()
}

const fitText = (ctx: CanvasRenderingContext2D, text: string, size: number, maxW: number): void => {
  let s = size
  ctx.font = `${s}px Angry, sans-serif`
  while (s > 12 && ctx.measureText(text).width > maxW) {
    s -= 2
    ctx.font = `${s}px Angry, sans-serif`
  }
}

/** A small printed frog (book 1) or crane (book 2) on the spine. */
const emblem = (ctx: CanvasRenderingContext2D, book: number, cx: number, cy: number): void => {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.strokeStyle = HEX.ink
  const tri = (pts: number[], fill: string): void => {
    ctx.beginPath()
    ctx.moveTo(pts[0]!, pts[1]!)
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    ctx.stroke()
  }
  if (book === 1) {
    tri([-26, 14, 0, -18, 26, 14], HEX.frog)
    tri([-26, 14, 0, 4, 26, 14], HEX.frogDark)
    ctx.fillStyle = HEX.paperWhite
    for (const x of [-9, 9]) {
      ctx.beginPath()
      ctx.arc(x, -8, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  } else if (book === 2) {
    tri([-30, -10, 0, 8, -6, 16], HEX.c3)
    tri([30, -14, 0, 8, 6, 16], HEX.guide)
    tri([-6, 16, 0, 8, 6, 16, 0, 24], HEX.c3)
  } else {
    tri([-24, 16, 0, -20, 24, 16], HEX.dragonGreen)
  }
  ctx.restore()
}

/** A padlock (locked silhouettes). */
const padlock = (ctx: CanvasRenderingContext2D, cx: number, cy: number, col: string): void => {
  ctx.save()
  ctx.strokeStyle = col
  ctx.fillStyle = col
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.arc(cx, cy - 10, 15, Math.PI, 0)
  ctx.stroke()
  ctx.fillRect(cx - 24, cy - 10, 48, 36)
  ctx.restore()
}

/** Paint a book's spine and its two swatches for its slot state. */
export const paintSpine = (ctx: CanvasRenderingContext2D, slot: ShelfSlot): void => {
  const w = SPINE_TEX_W
  const h = SPINE_TEX_H - STRIP
  const silhouette = slot.state === 'locked' || slot.state === 'coming'
  const [coverKey, darkKey] = COVER[slot.book] ?? COVER[3]!
  const cover = silhouette ? HEX.shadowDeep : HEX[coverKey]
  const dark = silhouette ? HEX.shadowDeep : HEX[darkKey]
  ctx.clearRect(0, 0, w, SPINE_TEX_H)
  // Swatches: cover boards (left) and the page block (right).
  ctx.fillStyle = dark
  ctx.fillRect(0, h, w / 2, STRIP)
  ctx.fillStyle = silhouette ? HEX.shadow : HEX.parchmentShade
  ctx.fillRect(w / 2, h, w / 2, STRIP)

  // The spine.
  ctx.fillStyle = cover
  ctx.fillRect(0, 0, w, h)
  const rng = seeded(slot.book * 97 + 13)
  paperGrain(ctx, w, h, rng, silhouette ? 0.15 : 0.35)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (silhouette) {
    // A silhouette: no title, no stars — a lock, or a question mark for the book still to come.
    ctx.strokeStyle = css('shadow', 0.9)
    ctx.lineWidth = 4
    ctx.setLineDash(slot.state === 'coming' ? [10, 8] : [])
    ctx.strokeRect(10, 10, w - 20, h - 20)
    ctx.setLineDash([])
    if (slot.state === 'coming') {
      ctx.fillStyle = css('shadow', 0.95)
      fitText(ctx, '?', 110, w - 30)
      ctx.fillText('?', w / 2, h * 0.42)
    } else {
      padlock(ctx, w / 2, h * 0.42, css('shadow', 0.95))
    }
    return
  }
  // Gold tooling bands.
  ctx.fillStyle = HEX.bookGold
  for (const y of [16, 26, h - 30, h - 20]) ctx.fillRect(8, y, w - 16, 4)
  // Title plate with the book's number.
  const plateY = 44
  ctx.fillStyle = HEX.parchmentLight
  ctx.strokeStyle = HEX.ink
  ctx.lineWidth = 3
  ctx.fillRect(18, plateY, w - 36, 74)
  ctx.strokeRect(18, plateY, w - 36, 74)
  ctx.fillStyle = HEX.ink
  fitText(ctx, String(slot.book), 64, w - 44)
  ctx.fillText(String(slot.book), w / 2, plateY + 40)
  emblem(ctx, slot.book, w / 2, 160)
  // Star sticker: a gold star over "earned/max".
  const sy = h - 88
  ctx.fillStyle = HEX.paperWhite
  ctx.strokeStyle = HEX.ink
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.ellipse(w / 2, sy, 50, 44, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  star(ctx, w / 2, sy - 14, 17, slot.stars > 0 ? HEX.gold : HEX.parchmentShade)
  ctx.fillStyle = HEX.ink
  const label = `${slot.stars}/${slot.max}`
  fitText(ctx, label, 28, 88)
  ctx.fillText(label, w / 2, sy + 20)
  // The book being read carries a ribbon bookmark over its top.
  if (slot.state === 'current') {
    ctx.fillStyle = HEX.highlight
    ctx.strokeStyle = HEX.ink
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(w - 40, 0)
    ctx.lineTo(w - 20, 0)
    ctx.lineTo(w - 20, 40)
    ctx.lineTo(w - 30, 32)
    ctx.lineTo(w - 40, 40)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
}

/** The inspect card: the book's number and its best stars on every rated page. */
export const paintStarCard = (ctx: CanvasRenderingContext2D, slot: ShelfSlot): void => {
  const w = CARD_TEX_W
  const h = CARD_TEX_H
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = HEX.parchmentLight
  ctx.fillRect(0, 0, w, h)
  paperGrain(ctx, w, h, seeded(slot.book * 31 + 5), 0.4)
  ctx.strokeStyle = HEX.ink
  ctx.lineWidth = 5
  ctx.strokeRect(4, 4, w - 8, h - 8)
  const [coverKey] = COVER[slot.book] ?? COVER[3]!
  ctx.fillStyle = HEX[coverKey]
  ctx.fillRect(8, 8, w - 16, 52)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = HEX.paperWhite
  const head = `${slot.book} · ${slot.stars}/${slot.max}`
  fitText(ctx, head, 38, w - 40)
  ctx.fillText(head, w / 2 + 12, 36)
  star(ctx, 34, 34, 16, HEX.gold)
  const rows = Math.max(1, slot.pages.length)
  const top = 74
  const rowH = (h - top - 12) / rows
  for (let r = 0; r < slot.pages.length; r++) {
    const y = top + rowH * (r + 0.5)
    // The page number in a little dog-eared tab…
    ctx.fillStyle = HEX.parchmentShade
    ctx.strokeStyle = HEX.ink
    ctx.lineWidth = 2.5
    ctx.fillRect(18, y - rowH * 0.36, 44, rowH * 0.72)
    ctx.strokeRect(18, y - rowH * 0.36, 44, rowH * 0.72)
    ctx.fillStyle = HEX.ink
    fitText(ctx, String(r + 1), 30, 36)
    ctx.fillText(String(r + 1), 40, y + 1)
    // …and its three stars.
    const got = slot.pages[r] ?? 0
    for (let k = 0; k < 3; k++) {
      star(ctx, 104 + k * 52, y, Math.min(21, rowH * 0.4), k < got ? HEX.gold : HEX.parchment, k < got ? HEX.ink : css('inkSoft', 0.5))
    }
  }
}

/** Fresh canvases for one book (spine) or the inspect card. */
export const spineCanvas = (): [HTMLCanvasElement, CanvasRenderingContext2D] => makeCanvas(SPINE_TEX_W, SPINE_TEX_H)
export const cardCanvas = (): [HTMLCanvasElement, CanvasRenderingContext2D] => makeCanvas(CARD_TEX_W, CARD_TEX_H)
