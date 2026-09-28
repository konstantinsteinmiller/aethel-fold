/**
 * Paper standee atlas — the "tiny 2D paper knights" of aethel-fold-GDD §6.
 *
 * Every unit is a die-cut paper figure: vector-drawn character art with bold
 * ink, surrounded by the white paper margin a real cut-out keeps. Frames are
 * drawn programmatically so the game ships without art; if a matching image
 * exists in `/public/images/fold/units/` (listed in its `manifest.json`), it
 * replaces the drawn frame at runtime — drop in art, no code change.
 */

import type { CanvasTexture } from 'three'
import { HEX, css } from '../palette'
import { makeCanvas, toTexture } from './canvas'

export const CELL_W = 128
export const CELL_H = 192
const COLS = 8
const ROWS = 5
export const ATLAS_W = CELL_W * COLS
export const ATLAS_H = CELL_H * ROWS

export type FrameName =
  | 'knight0' | 'knight1' | 'knightFlail'
  | 'brute0' | 'brute1' | 'bruteFlail'
  | 'archer0' | 'archerDraw'
  | 'hero0' | 'heroCheer' | 'heroCower' | 'heroHit' | 'heroWalk'
  | 'personRed0' | 'personRed1' | 'personBlue0' | 'personBlue1'
  | 'personGreen0' | 'personGreen1' | 'personYellow0' | 'personYellow1'
  | 'crushed' | 'scrap'

const ORDER: FrameName[] = [
  'knight0', 'knight1', 'knightFlail', 'brute0', 'brute1', 'bruteFlail', 'archer0', 'archerDraw',
  'hero0', 'heroCheer', 'heroCower', 'heroHit', 'heroWalk', 'crushed', 'scrap',
  'personRed0', 'personRed1', 'personBlue0', 'personBlue1', 'personGreen0', 'personGreen1', 'personYellow0', 'personYellow1'
]

/** UV rectangle (u0, v0, u1, v1) of a frame, ready for the `aFrame` attribute. */
export interface FrameUV {
  u0: number
  v0: number
  u1: number
  v1: number
}

export interface StandeeAtlas {
  texture: CanvasTexture
  frame(name: FrameName): FrameUV
  /** Try `/images/fold/units/manifest.json` overrides (non-blocking). */
  loadOverrides(baseUrl: string): Promise<number>
  dispose(): void
}

type Painter = (ctx: CanvasRenderingContext2D) => void

const INK = HEX.ink
const LW = 4.2

const stroke = (ctx: CanvasRenderingContext2D, w = LW): void => {
  ctx.lineWidth = w
  ctx.strokeStyle = INK
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()
}

const fillStroke = (ctx: CanvasRenderingContext2D, fill: string, w = LW): void => {
  ctx.fillStyle = fill
  ctx.fill()
  stroke(ctx, w)
}

const ellipse = (ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, w = LW): void => {
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
  fillStroke(ctx, fill, w)
}

const rrect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, lw = LW): void => {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  fillStroke(ctx, fill, lw)
}

const poly = (ctx: CanvasRenderingContext2D, pts: number[], fill: string, w = LW): void => {
  ctx.beginPath()
  ctx.moveTo(pts[0]!, pts[1]!)
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!)
  ctx.closePath()
  fillStroke(ctx, fill, w)
}

// ─── Characters ────────────────────────────────────────────────────────────

interface KnightStyle {
  tabard: string
  tabardDark: string
  steel: string
  trim: string
  plume?: string
  scale: number
  horns?: boolean
  weapon: 'sword' | 'club' | 'bow'
  shield: string
  emblem: 'chevron' | 'star' | 'skull' | 'none'
}

const legs = (ctx: CanvasRenderingContext2D, pose: number, s: KnightStyle): void => {
  // pose: 0 = together, 1 = stride, 2 = flail (kicking)
  const spread = pose === 1 ? 10 : pose === 2 ? 16 : 3
  const lift = pose === 2 ? -10 : 0
  rrect(ctx, 64 - 16 - spread, 142, 13, 36, 5, s.steel)
  rrect(ctx, 64 + 3 + spread, 142 + lift, 13, 36, 5, s.steel)
  // Boots.
  ellipse(ctx, 64 - 11 - spread, 178, 11, 6, HEX.woodDark)
  ellipse(ctx, 64 + 10 + spread, 178 + lift, 11, 6, HEX.woodDark)
}

const shieldShape = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: KnightStyle): void => {
  ctx.beginPath()
  ctx.moveTo(x - w / 2, y - h / 2)
  ctx.lineTo(x + w / 2, y - h / 2)
  ctx.lineTo(x + w / 2, y + h * 0.1)
  ctx.quadraticCurveTo(x + w / 2, y + h / 2, x, y + h / 2 + 4)
  ctx.quadraticCurveTo(x - w / 2, y + h / 2, x - w / 2, y + h * 0.1)
  ctx.closePath()
  fillStroke(ctx, s.shield)
  ctx.save()
  ctx.clip()
  if (s.emblem === 'chevron') {
    poly(ctx, [x - w / 2, y + 4, x, y - 8, x + w / 2, y + 4, x + w / 2, y + 14, x, y + 2, x - w / 2, y + 14], s.trim, 2.5)
  } else if (s.emblem === 'star') {
    const pts: number[] = []
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2
      const r = i % 2 ? 5 : 12
      pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r)
    }
    poly(ctx, pts, s.trim, 2.5)
  } else if (s.emblem === 'skull') {
    ellipse(ctx, x, y - 2, 9, 8, HEX.paperWhite, 2.5)
    ellipse(ctx, x - 3.5, y - 2, 2.2, 2.6, INK, 0)
    ellipse(ctx, x + 3.5, y - 2, 2.2, 2.6, INK, 0)
  }
  ctx.restore()
}

const knightFigure = (ctx: CanvasRenderingContext2D, pose: number, s: KnightStyle, armUp = 0, open = false): void => {
  ctx.save()
  ctx.translate(64, 182)
  ctx.scale(s.scale, s.scale)
  ctx.translate(-64, -182)
  legs(ctx, pose, s)
  // Body / tabard.
  poly(ctx, [40, 96, 88, 96, 94, 148, 34, 148], s.tabard)
  poly(ctx, [58, 96, 70, 96, 70, 148, 58, 148], s.tabardDark, 2.5)
  rrect(ctx, 38, 128, 52, 9, 3, HEX.woodDark, 3)
  ellipse(ctx, 64, 132.5, 4, 3.4, s.trim, 2)
  // Weapon arm (right, viewer's left).
  const swing = pose === 1 ? -0.25 : pose === 2 ? -0.9 : 0.1
  ctx.save()
  ctx.translate(38, 104)
  ctx.rotate(swing - armUp * 1.8)
  rrect(ctx, -7, -4, 14, 34, 6, s.steel)
  if (s.weapon === 'sword') {
    rrect(ctx, -3, 26, 6, 10, 2, HEX.woodDark, 2.5)
    rrect(ctx, -10, 24, 20, 5, 2, s.trim, 2.5)
    poly(ctx, [-3.5, 29, 3.5, 29, 2.5, 64, 0, 70, -2.5, 64], HEX.heroSteel, 3)
  } else if (s.weapon === 'club') {
    poly(ctx, [-4, 26, 4, 26, 12, 70, -10, 70], HEX.wood, 3.5)
    for (let i = 0; i < 3; i++) poly(ctx, [-12 + i * 9, 62, -8 + i * 9, 74, -4 + i * 9, 62], HEX.steelDark, 2)
  } else {
    ctx.beginPath()
    ctx.moveTo(-2, 0)
    ctx.quadraticCurveTo(28, 30, -2, 64)
    stroke(ctx, 5)
    ctx.beginPath()
    ctx.moveTo(-2, 0)
    ctx.quadraticCurveTo(28, 30, -2, 64)
    ctx.strokeStyle = HEX.wood
    ctx.lineWidth = 2.5
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(-2, 0)
    ctx.lineTo(armUp > 0 ? 18 : -2, 32)
    ctx.lineTo(-2, 64)
    ctx.lineWidth = 1.5
    ctx.strokeStyle = HEX.paperWhite
    ctx.stroke()
  }
  ctx.restore()
  // Shield arm (left, viewer's right).
  if (s.weapon !== 'bow') shieldShape(ctx, 92, 118 - armUp * 10, 34, 42, s)
  else {
    // Quiver.
    rrect(ctx, 80, 92, 14, 38, 4, HEX.woodDark, 3)
    for (let i = 0; i < 3; i++) poly(ctx, [82 + i * 4, 92, 85 + i * 4, 80, 88 + i * 4, 92], HEX.paperWhite, 2)
  }
  // Head.
  if (s.weapon === 'bow') {
    // Hood.
    ctx.beginPath()
    ctx.moveTo(38, 94)
    ctx.quadraticCurveTo(36, 44, 64, 40)
    ctx.quadraticCurveTo(92, 44, 90, 94)
    ctx.closePath()
    fillStroke(ctx, s.tabard)
    ellipse(ctx, 64, 72, 20, 19, HEX.skin)
    ellipse(ctx, 57, 72, 2.8, 3.4, INK, 0)
    ellipse(ctx, 71, 72, 2.8, 3.4, INK, 0)
    ctx.beginPath()
    ctx.moveTo(56, 82)
    ctx.quadraticCurveTo(64, open ? 90 : 85, 72, 82)
    stroke(ctx, 2.5)
  } else {
    // Great helm.
    ctx.beginPath()
    ctx.moveTo(38, 96)
    ctx.lineTo(38, 62)
    ctx.quadraticCurveTo(40, 38, 64, 36)
    ctx.quadraticCurveTo(88, 38, 90, 62)
    ctx.lineTo(90, 96)
    ctx.closePath()
    fillStroke(ctx, s.steel)
    // Visor slit + breaths.
    rrect(ctx, 44, 64, 40, 7, 3, INK, 0)
    if (open) ellipse(ctx, 64, 84, 6, 5, INK, 0)
    else for (let i = 0; i < 3; i++) ellipse(ctx, 56 + i * 8, 84, 1.8, 1.8, INK, 0)
    ctx.beginPath()
    ctx.moveTo(64, 38)
    ctx.lineTo(64, 62)
    stroke(ctx, 3)
    if (s.horns) {
      poly(ctx, [40, 54, 18, 36, 26, 30, 44, 46], HEX.paperWhite)
      poly(ctx, [88, 54, 110, 36, 102, 30, 84, 46], HEX.paperWhite)
    }
    if (s.plume) {
      ctx.beginPath()
      ctx.moveTo(64, 38)
      ctx.quadraticCurveTo(58, 14, 80, 8)
      ctx.quadraticCurveTo(72, 22, 84, 30)
      ctx.quadraticCurveTo(70, 30, 64, 38)
      fillStroke(ctx, s.plume)
    }
  }
  ctx.restore()
}

const REDKNIGHT: KnightStyle = {
  tabard: HEX.enemyRed, tabardDark: HEX.enemyRedDark, steel: HEX.enemySteel, trim: HEX.gold,
  scale: 0.92, weapon: 'sword', shield: HEX.enemyRed, emblem: 'chevron'
}
const BRUTE: KnightStyle = {
  tabard: HEX.enemyRedDark, tabardDark: HEX.ink, steel: HEX.steelDark, trim: HEX.gold,
  scale: 1, horns: true, weapon: 'club', shield: HEX.enemyRedDark, emblem: 'skull'
}
const ARCHER: KnightStyle = {
  tabard: HEX.enemyRed, tabardDark: HEX.enemyRedDark, steel: HEX.enemySteel, trim: HEX.gold,
  scale: 0.9, weapon: 'bow', shield: HEX.enemyRed, emblem: 'none'
}
const HERO: KnightStyle = {
  tabard: HEX.heroBlue, tabardDark: HEX.heroBlueDark, steel: HEX.heroSteel, trim: HEX.gold, plume: HEX.flagYellow,
  scale: 0.95, weapon: 'sword', shield: HEX.heroBlue, emblem: 'star'
}

const person = (ctx: CanvasRenderingContext2D, body: string, armsUp: boolean): void => {
  ctx.save()
  ctx.translate(64, 182)
  ctx.scale(0.8, 0.8)
  ctx.translate(-64, -182)
  // Legs.
  rrect(ctx, 50, 140, 10, 38, 4, HEX.inkSoft, 3)
  rrect(ctx, 68, 140, 10, 38, 4, HEX.inkSoft, 3)
  // Arms.
  const ay = armsUp ? 60 : 100
  poly(ctx, [44, 106, 24, ay, 32, ay - 6, 52, 100], HEX.skin, 3.5)
  poly(ctx, [84, 106, 104, ay, 96, ay - 6, 76, 100], HEX.skin, 3.5)
  // Dress/tunic.
  poly(ctx, [48, 96, 80, 96, 96, 148, 32, 148], body)
  // Head.
  ellipse(ctx, 64, 72, 24, 23, HEX.skin)
  ellipse(ctx, 56, 70, 3, 3.6, INK, 0)
  ellipse(ctx, 72, 70, 3, 3.6, INK, 0)
  ellipse(ctx, 64, 83, armsUp ? 6 : 4, armsUp ? 5 : 2.5, INK, 0)
  ellipse(ctx, 50, 79, 4, 2.6, css('c7', 0.7), 0)
  ellipse(ctx, 78, 79, 4, 2.6, css('c7', 0.7), 0)
  // Hair tuft.
  ctx.beginPath()
  ctx.moveTo(44, 64)
  ctx.quadraticCurveTo(52, 40, 64, 48)
  ctx.quadraticCurveTo(78, 38, 86, 62)
  ctx.quadraticCurveTo(66, 54, 44, 64)
  fillStroke(ctx, HEX.woodDark, 3)
  ctx.restore()
}

const crushed: Painter = (ctx) => {
  // A flattened knight: a splat of red paper with a squashed helm.
  ctx.save()
  poly(ctx, [14, 168, 40, 150, 60, 160, 88, 146, 116, 166, 100, 184, 64, 178, 30, 186], HEX.enemyRed)
  ellipse(ctx, 64, 164, 26, 10, HEX.enemySteel)
  rrect(ctx, 46, 160, 36, 5, 2, INK, 0)
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    ellipse(ctx, 64 + Math.cos(a) * 50, 166 + Math.sin(a) * 16, 4, 3, HEX.c2, 2)
  }
  ctx.restore()
}

const scrap: Painter = (ctx) => {
  poly(ctx, [30, 120, 96, 104, 110, 150, 70, 176, 22, 160], HEX.parchment)
  ctx.beginPath()
  ctx.moveTo(40, 132)
  ctx.lineTo(92, 124)
  ctx.moveTo(38, 148)
  ctx.lineTo(96, 140)
  stroke(ctx, 2)
}

const PAINTERS: Record<FrameName, Painter> = {
  knight0: (c) => knightFigure(c, 0, REDKNIGHT),
  knight1: (c) => knightFigure(c, 1, REDKNIGHT),
  knightFlail: (c) => knightFigure(c, 2, REDKNIGHT, 0.6, true),
  brute0: (c) => knightFigure(c, 0, BRUTE),
  brute1: (c) => knightFigure(c, 1, BRUTE),
  bruteFlail: (c) => knightFigure(c, 2, BRUTE, 0.5, true),
  archer0: (c) => knightFigure(c, 0, ARCHER),
  archerDraw: (c) => knightFigure(c, 0, ARCHER, 0.5),
  hero0: (c) => knightFigure(c, 0, HERO),
  heroCheer: (c) => knightFigure(c, 0, HERO, 1, true),
  heroCower: (c) => knightFigure(c, 2, HERO, -0.2),
  heroHit: (c) => knightFigure(c, 2, HERO, 0.3, true),
  heroWalk: (c) => knightFigure(c, 1, HERO),
  personRed0: (c) => person(c, HEX.c1, false),
  personRed1: (c) => person(c, HEX.c1, true),
  personBlue0: (c) => person(c, HEX.c3, false),
  personBlue1: (c) => person(c, HEX.c3, true),
  personGreen0: (c) => person(c, HEX.c4, false),
  personGreen1: (c) => person(c, HEX.c4, true),
  personYellow0: (c) => person(c, HEX.c2, false),
  personYellow1: (c) => person(c, HEX.c2, true),
  crushed,
  scrap
}

/** Draw `paint` into a cell with the die-cut white paper margin around it. */
const cutOut = (ctx: CanvasRenderingContext2D, x: number, y: number, paint: Painter | HTMLImageElement): void => {
  const [figC, fig] = makeCanvas(CELL_W, CELL_H)
  if (paint instanceof HTMLImageElement) {
    const s = Math.min((CELL_W - 16) / paint.width, (CELL_H - 12) / paint.height)
    const w = paint.width * s
    const h = paint.height * s
    fig.drawImage(paint, (CELL_W - w) / 2, CELL_H - 6 - h, w, h)
  } else {
    paint(fig)
  }
  // White silhouette, dilated → the paper margin.
  const [silC, sil] = makeCanvas(CELL_W, CELL_H)
  sil.drawImage(figC, 0, 0)
  sil.globalCompositeOperation = 'source-in'
  sil.fillStyle = HEX.paperWhite
  sil.fillRect(0, 0, CELL_W, CELL_H)
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, CELL_W, CELL_H)
  ctx.clip()
  const R = 5
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    ctx.drawImage(silC, x + Math.cos(a) * R, y + Math.sin(a) * R)
  }
  // A faint ink edge on the margin so the cut reads even on white paper.
  ctx.globalCompositeOperation = 'destination-over'
  ctx.globalAlpha = 0.5
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    ctx.drawImage(silC, x + Math.cos(a) * (R + 1.2), y + Math.sin(a) * (R + 1.2))
  }
  ctx.restore()
  ctx.drawImage(figC, x, y)
}

export const createStandeeAtlas = (): StandeeAtlas => {
  const [canvas, ctx] = makeCanvas(ATLAS_W, ATLAS_H)
  const index = new Map<FrameName, number>()
  ORDER.forEach((name, i) => {
    index.set(name, i)
    cutOut(ctx, (i % COLS) * CELL_W, Math.floor(i / COLS) * CELL_H, PAINTERS[name])
  })
  const texture = toTexture(canvas, true)
  const frames = new Map<FrameName, FrameUV>()
  const inset = 0.5
  for (const [name, i] of index) {
    const cx = (i % COLS) * CELL_W
    const cy = Math.floor(i / COLS) * CELL_H
    // Texture Y is flipped: v = 1 at the canvas top.
    frames.set(name, {
      u0: (cx + inset) / ATLAS_W,
      v0: 1 - (cy + CELL_H - inset) / ATLAS_H,
      u1: (cx + CELL_W - inset) / ATLAS_W,
      v1: 1 - (cy + inset) / ATLAS_H
    })
  }
  return {
    texture,
    frame: (n) => frames.get(n)!,
    async loadOverrides(baseUrl: string): Promise<number> {
      let names: string[] = []
      try {
        const res = await fetch(`${baseUrl}images/fold/units/manifest.json`, { cache: 'force-cache' })
        if (!res.ok) return 0
        const json = (await res.json()) as { units?: string[] }
        names = Array.isArray(json.units) ? json.units : []
      } catch {
        return 0
      }
      let n = 0
      for (const file of names) {
        const key = file.replace(/\.(webp|png|jpe?g)$/i, '')
        const targets = ORDER.filter((f) => f === key || f.replace(/\d$|Flail$|Draw$|Cheer$|Cower$|Hit$|Walk$/, '') === key)
        if (targets.length === 0) continue
        const img = new Image()
        img.decoding = 'async'
        img.src = `${baseUrl}images/fold/units/${file}`
        try {
          await img.decode()
        } catch {
          continue
        }
        for (const t of targets) {
          const i = index.get(t)!
          const x = (i % COLS) * CELL_W
          const y = Math.floor(i / COLS) * CELL_H
          ctx.clearRect(x, y, CELL_W, CELL_H)
          cutOut(ctx, x, y, img)
        }
        n++
      }
      if (n > 0) texture.needsUpdate = true
      return n
    },
    dispose() {
      texture.dispose()
    }
  }
}
