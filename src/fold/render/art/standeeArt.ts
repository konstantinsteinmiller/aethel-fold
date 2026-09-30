/**
 * Paper standee atlas — the "tiny 2D paper knights" of aethel-fold-GDD §6.
 *
 * Every unit is a die-cut paper figure: vector-drawn character art with bold
 * ink, surrounded by the white paper margin a real cut-out keeps. Frames are
 * drawn programmatically so the game ships without art; if a matching image
 * exists in `/public/images/fold/units/` (listed in its `manifest.json`), it
 * replaces the drawn frame at runtime — drop in art, no code change.
 *
 * Looks (roadmaps #6, #17) stay procedural: the hero's five cells are painted
 * in the equipped variant (a scarf, a royal sash, a crown; Winter adds the
 * scarf) — at boot in place of the classic ones, at the same cost — and
 * repainted in idle time when the player equips another (`setHero`). The
 * Halloween bats have their own two cells, painted only when that season is
 * on and never at boot (`paintSeason`).
 */

import type { CanvasTexture } from 'three'
import type { HeroVariant } from '../../logic/cosmetics'
import type { Season } from '../../logic/seasons'
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
  | 'runner0' | 'runner1' | 'runnerFlail'
  | 'leaper0' | 'leaper1' | 'leaperJump' | 'leaperFlail'
  | 'hero0' | 'heroCheer' | 'heroCower' | 'heroHit' | 'heroWalk'
  | 'personRed0' | 'personRed1' | 'personBlue0' | 'personBlue1'
  | 'personGreen0' | 'personGreen1' | 'personYellow0' | 'personYellow1'
  | 'crushed' | 'scrap'
  | 'bat0' | 'bat1'
  // C12: the shield-bearer (books 2 and 3), appended so the older cells keep their places.
  | 'bearer0' | 'bearer1' | 'bearerBlock' | 'bearerFlail'

const ORDER: FrameName[] = [
  'knight0', 'knight1', 'knightFlail', 'brute0', 'brute1', 'bruteFlail', 'archer0', 'archerDraw',
  'hero0', 'heroCheer', 'heroCower', 'heroHit', 'heroWalk', 'crushed', 'scrap',
  'personRed0', 'personRed1', 'personBlue0', 'personBlue1', 'personGreen0', 'personGreen1', 'personYellow0', 'personYellow1',
  'runner0', 'runner1', 'runnerFlail', 'leaper0', 'leaper1', 'leaperJump', 'leaperFlail',
  'bat0', 'bat1',
  'bearer0', 'bearer1', 'bearerBlock', 'bearerFlail'
]

/** The hero's cells: repainted together when the look changes. */
export const HERO_FRAMES: readonly FrameName[] = ['hero0', 'heroCheer', 'heroCower', 'heroHit', 'heroWalk']

/** Halloween's bat standees: painted only while that season is on, never at boot. */
const SEASONAL: ReadonlySet<FrameName> = new Set<FrameName>(['bat0', 'bat1'])

/** How the hero is dressed: the equipped variant and the season. */
export interface HeroLook {
  variant: HeroVariant
  season: Season
}

export const CLASSIC_HERO: Readonly<HeroLook> = { variant: 'classic', season: 'none' }

/** Accessories a look puts on the hero (Winter wraps a scarf round any variant). */
export const heroAccessories = (look: HeroLook): { scarf: boolean; sash: boolean; crown: boolean; sailor: boolean } => ({
  scarf: look.variant === 'scarf' || look.season === 'winter',
  sash: look.variant === 'sash',
  crown: look.variant === 'crown',
  // Book 3's unlock (roadmap #3): a sailor's cap and collar.
  sailor: look.variant === 'sailor'
})

const heroKey = (look: HeroLook): string => {
  const a = heroAccessories(look)
  return `${a.scarf ? 's' : ''}${a.sash ? 'h' : ''}${a.crown ? 'c' : ''}${a.sailor ? 'n' : ''}`
}

/** UV rectangle (u0, v0, u1, v1) of a frame, ready for the `aFrame` attribute. */
export interface FrameUV {
  u0: number
  v0: number
  u1: number
  v1: number
}

/**
 * Frames no book-1 page shows until its victory: the cheering crowd and book 2's
 * runners, leapers and shield-bearers (the bearers march in books 2 and 3 only). `createStandeeAtlas` leaves their cells blank so the
 * boot only paints what page 1 can show (roadmap #13); `paintDeferred` fills
 * them in later (idle after the first input, or at once when a book-2 page or
 * the victory crowd needs them). Blank cells are never on screen before then.
 */
const DEFERRED: ReadonlySet<FrameName> = new Set<FrameName>([
  'personRed0', 'personRed1', 'personBlue0', 'personBlue1', 'personGreen0', 'personGreen1', 'personYellow0', 'personYellow1',
  'runner0', 'runner1', 'runnerFlail', 'leaper0', 'leaper1', 'leaperJump', 'leaperFlail',
  // C12: shield-bearers march only in books 2 and 3.
  'bearer0', 'bearer1', 'bearerBlock', 'bearerFlail'
])

export interface StandeeAtlas {
  texture: CanvasTexture
  frame(name: FrameName): FrameUV
  /** Paint the deferred frames (crowd, book 2) if not yet painted. Returns true if it painted now. */
  paintDeferred(): boolean
  /** Have the deferred frames been painted? */
  readonly complete: boolean
  /** Repaint the hero's five cells for a look (idle time). Returns true if it painted (the look changed). */
  setHero(look: HeroLook): boolean
  /** Paint a season's own frames (Halloween's bats) if not yet painted. Returns true if it painted now. */
  paintSeason(season: Season): boolean
  /** Are Halloween's bat frames painted? */
  readonly batsReady: boolean
  /** Try `/images/fold/units/manifest.json` overrides (non-blocking). */
  loadOverrides(baseUrl: string): Promise<number>
  dispose(): void
}

type Painter = (ctx: CanvasRenderingContext2D) => void

const INK = HEX.ink
/** Outline weight: bold enough to read at thumbnail size, not so bold it clogs. */
const LW = 3.2

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
  /** A cloth hood instead of a great helm (archers, runners). */
  hood?: boolean
  /** No shield arm (runners travel light). */
  noShield?: boolean
  /** Paper coil springs instead of boots (leapers); 0 = coiled, 1 = sprung. */
  springs?: number
  /** Grasshopper feelers on the helm (leapers). */
  feelers?: boolean
  /** Hero looks (roadmap #6): a knitted scarf, a royal sash, a crown instead of the plume. */
  scarf?: boolean
  sash?: boolean
  crown?: boolean
  /** Book 3's sailor (roadmap #3): a white cap instead of the plume, a navy collar. */
  sailor?: boolean
}

const spring = (ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number): void => {
  // A zig-zag paper coil from y0 (knee) down to y1 (foot).
  const n = 5
  ctx.beginPath()
  ctx.moveTo(x, y0)
  for (let i = 1; i <= n; i++) ctx.lineTo(x + (i % 2 ? 9 : -9), y0 + ((y1 - y0) * i) / n)
  ctx.lineTo(x, y1)
  stroke(ctx, 5.5)
  ctx.beginPath()
  ctx.moveTo(x, y0)
  for (let i = 1; i <= n; i++) ctx.lineTo(x + (i % 2 ? 9 : -9), y0 + ((y1 - y0) * i) / n)
  ctx.lineTo(x, y1)
  ctx.strokeStyle = HEX.gold
  ctx.lineWidth = 2.6
  ctx.stroke()
}

const legs = (ctx: CanvasRenderingContext2D, pose: number, s: KnightStyle): void => {
  // pose: 0 = together, 1 = stride, 2 = flail (kicking)
  const spread = pose === 1 ? 10 : pose === 2 ? 16 : 3
  const lift = pose === 2 ? -10 : 0
  if (s.springs !== undefined) {
    // Short thighs on coil springs; the springs stretch when it jumps.
    const foot = 164 + s.springs * 16
    rrect(ctx, 64 - 16 - spread, 140, 13, 16, 5, s.steel)
    rrect(ctx, 64 + 3 + spread, 140 + lift, 13, 16, 5, s.steel)
    spring(ctx, 64 - 10 - spread, 155, foot)
    spring(ctx, 64 + 10 + spread, 155 + lift, foot + lift)
    ellipse(ctx, 64 - 10 - spread, foot + 2, 11, 4.5, HEX.woodDark)
    ellipse(ctx, 64 + 10 + spread, foot + 2 + lift, 11, 4.5, HEX.woodDark)
    return
  }
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
  if (s.sash) {
    // A royal sash from the shoulder to the hip, with a gold star pinned on.
    poly(ctx, [40, 104, 50, 96, 92, 138, 84, 147], HEX.sash, 2.6)
    poly(ctx, [44, 101, 48, 98, 89, 139, 86, 142], HEX.sashDark, 0)
    const pts: number[] = []
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2
      const r = i % 2 ? 3.2 : 7.5
      pts.push(62 + Math.cos(a) * r, 118 + Math.sin(a) * r)
    }
    poly(ctx, pts, HEX.gold, 2)
  }
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
  if (s.noShield) {
    rrect(ctx, 84, 100 - armUp * 14, 13, 30, 6, s.steel, 3)
  } else if (s.weapon !== 'bow') shieldShape(ctx, 92, 118 - armUp * 10, 34, 42, s)
  else {
    // Quiver.
    rrect(ctx, 80, 92, 14, 38, 4, HEX.woodDark, 3)
    for (let i = 0; i < 3; i++) poly(ctx, [82 + i * 4, 92, 85 + i * 4, 80, 88 + i * 4, 92], HEX.paperWhite, 2)
  }
  // Head.
  if (s.hood || s.weapon === 'bow') {
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
    if (s.feelers) {
      for (const side of [-1, 1]) {
        ctx.beginPath()
        ctx.moveTo(64 + side * 10, 40)
        ctx.quadraticCurveTo(64 + side * 22, 10, 64 + side * 40, 12)
        stroke(ctx, 3)
        ellipse(ctx, 64 + side * 40, 12, 4, 4, HEX.gold, 2)
      }
    }
    if (s.horns) {
      poly(ctx, [40, 54, 18, 36, 26, 30, 44, 46], HEX.paperWhite)
      poly(ctx, [88, 54, 110, 36, 102, 30, 84, 46], HEX.paperWhite)
    }
    if (s.crown) {
      // A paper crown instead of the plume, with two gems.
      poly(ctx, [44, 44, 44, 24, 53, 34, 58, 16, 64, 30, 70, 16, 75, 34, 84, 24, 84, 44], HEX.gold, 3)
      ellipse(ctx, 58, 38, 3.2, 3.2, HEX.c1, 1.8)
      ellipse(ctx, 70, 38, 3.2, 3.2, HEX.c3, 1.8)
    } else if (s.sailor) {
      // A round white sailor's cap with a navy band and a pompom, instead of the plume.
      ellipse(ctx, 64, 32, 25, 9, HEX.sailorWhite, 3)
      rrect(ctx, 42, 34, 44, 8, 3, HEX.sailorNavy, 2.4)
      ellipse(ctx, 64, 22, 5, 5, HEX.c1, 2)
    } else if (s.plume) {
      ctx.beginPath()
      ctx.moveTo(64, 38)
      ctx.quadraticCurveTo(58, 14, 80, 8)
      ctx.quadraticCurveTo(72, 22, 84, 30)
      ctx.quadraticCurveTo(70, 30, 64, 38)
      fillStroke(ctx, s.plume)
    }
  }
  if (s.sailor) {
    // A navy sailor's collar over the shoulders, a white stripe on its edge, a red knot.
    poly(ctx, [34, 96, 94, 96, 90, 116, 38, 116], HEX.sailorNavy, 2.6)
    poly(ctx, [38, 110, 90, 110, 89, 113, 39, 113], HEX.sailorWhite, 0)
    poly(ctx, [58, 112, 70, 112, 64, 124], HEX.c1, 2)
  }
  if (s.scarf) {
    // A knitted scarf round the neck; its tail blows out to the side.
    // (Out to the viewer's left, so it never hides the shield's emblem.)
    poly(ctx, [36, 96, 46, 97, 30, 126, 19, 121], HEX.scarfRed, 2.8)
    for (let i = 0; i < 4; i++) {
      ctx.beginPath()
      ctx.moveTo(19 + i * 3, 122 + i * 1.3)
      ctx.lineTo(16 + i * 3, 130 + i * 1.3)
      stroke(ctx, 2)
    }
    rrect(ctx, 36, 88, 56, 12, 5, HEX.scarfRed, 2.8)
    for (let x = 44; x < 90; x += 10) rrect(ctx, x, 89.5, 4, 9, 2, HEX.scarfRedDark, 0)
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
const RUNNER: KnightStyle = {
  tabard: HEX.c6, tabardDark: HEX.enemyRedDark, steel: HEX.enemySteel, trim: HEX.gold,
  scale: 0.8, weapon: 'sword', shield: HEX.enemyRed, emblem: 'none', hood: true, noShield: true
}
const leaperStyle = (springs: number): KnightStyle => ({
  tabard: HEX.forest, tabardDark: HEX.forestDark, steel: HEX.enemySteel, trim: HEX.gold, plume: HEX.enemyRed,
  scale: 0.9, weapon: 'sword', shield: HEX.meadowDark, emblem: 'chevron', springs, feelers: true
})
const HERO: KnightStyle = {
  tabard: HEX.heroBlue, tabardDark: HEX.heroBlueDark, steel: HEX.heroSteel, trim: HEX.gold, plume: HEX.flagYellow,
  scale: 0.95, weapon: 'sword', shield: HEX.heroBlue, emblem: 'star'
}

/** The hero's style for a look (a fresh object: painting only). */
const heroStyle = (look: HeroLook): KnightStyle => ({ ...HERO, ...heroAccessories(look) })

/** Painters of the hero's five cells, for one look. */
const heroPainters = (look: HeroLook): Record<string, Painter> => {
  const st = heroStyle(look)
  return {
    hero0: (c) => knightFigure(c, 0, st),
    heroCheer: (c) => knightFigure(c, 0, st, 1, true),
    heroCower: (c) => knightFigure(c, 2, st, -0.2),
    heroHit: (c) => knightFigure(c, 2, st, 0.3, true),
    heroWalk: (c) => knightFigure(c, 1, st)
  }
}

/** A paper bat (Halloween), wings up (0) or down (1): plum paper, gold eyes. */
const bat = (ctx: CanvasRenderingContext2D, down: boolean): void => {
  ctx.save()
  ctx.translate(64, 110)
  const wy = down ? 22 : -26
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(side * 10, -6)
    ctx.quadraticCurveTo(side * 34, wy - 10, side * 58, wy)
    ctx.quadraticCurveTo(side * 48, wy + 12, side * 44, wy + 22)
    ctx.quadraticCurveTo(side * 36, wy + 10, side * 28, wy + 22)
    ctx.quadraticCurveTo(side * 20, wy + 8, side * 10, 12)
    ctx.closePath()
    fillStroke(ctx, HEX.batWing)
  }
  // Body and ears.
  poly(ctx, [-12, -18, -8, -34, -2, -22, 2, -22, 8, -34, 12, -18], HEX.bat, 2.8)
  ellipse(ctx, 0, 0, 16, 22, HEX.bat)
  ellipse(ctx, -6, -8, 3.4, 3.8, HEX.gold, 1.6)
  ellipse(ctx, 6, -8, 3.4, 3.8, HEX.gold, 1.6)
  poly(ctx, [-4, 4, -2, 9, 0, 4, 2, 9, 4, 4], HEX.paperWhite, 1.4)
  ctx.restore()
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

/** A five-pointed star of radius `r` (the shield's emblem). */
const star = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, w: number): void => {
  const pts: number[] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2
    const k = i % 2 ? r * 0.45 : r
    pts.push(x + Math.cos(a) * k, y + Math.sin(a) * k)
  }
  poly(ctx, pts, fill, w)
}

/**
 * The shield-bearer (C12), in the chibi look of the victory crowd and the
 * kraken — "scary but cute": a big round helm with a red crest, big glossy
 * eyes, stubby legs, and a large round paper shield held square in front
 * (gold rim, red face, a paper star, a gold boss). `pose` 0/1 are the two
 * walk steps; 'block' raises the shield with the eyes squeezed shut and a
 * glint on the rim (a bolt just glanced off); 'flail' flings it askew.
 */
const bearer = (ctx: CanvasRenderingContext2D, pose: 0 | 1 | 'block' | 'flail'): void => {
  const block = pose === 'block'
  const flail = pose === 'flail'
  const step = pose === 1 ? 1 : 0
  ctx.save()
  ctx.translate(64, 182)
  ctx.scale(0.94, 0.94)
  ctx.translate(-64, -182)
  // Stubby legs and round boots.
  const spread = step ? 8 : flail ? 13 : 2
  const lift = step ? -6 : flail ? -12 : 0
  rrect(ctx, 64 - 17 - spread, 150, 13, 24, 5, HEX.enemySteel)
  rrect(ctx, 64 + 4 + spread, 150 + lift, 13, 24, 5, HEX.enemySteel)
  ellipse(ctx, 64 - 11 - spread, 176, 11, 6, HEX.woodDark)
  ellipse(ctx, 64 + 11 + spread, 176 + lift, 11, 6, HEX.woodDark)
  // A round little body in the enemy's red tabard.
  ellipse(ctx, 64, 132, 27, 25, HEX.enemyRed)
  ellipse(ctx, 64, 147, 22, 5, HEX.enemyRedDark, 0)
  // A short spear over the shoulder (viewer's left), behind the shield.
  ctx.save()
  ctx.translate(34, 118)
  ctx.rotate(flail ? -1.1 : block ? -0.1 : -0.35 + step * 0.08)
  rrect(ctx, -3, -58, 6, 70, 3, HEX.wood, 2.6)
  poly(ctx, [-7, -56, 0, -76, 7, -56], HEX.heroSteel, 2.6)
  ellipse(ctx, 0, 6, 7, 7, HEX.enemySteel, 2.6)
  ctx.restore()
  // The head: a big round helm with a red paper crest and a brim, the face in it.
  const hy = flail ? 66 : block ? 72 : 68 + step * 2
  ctx.save()
  if (flail) {
    ctx.translate(64, hy)
    ctx.rotate(0.22)
    ctx.translate(-64, -hy)
  }
  ctx.beginPath()
  ctx.moveTo(40, hy - 22)
  ctx.quadraticCurveTo(64, hy - 62, 88, hy - 22)
  ctx.quadraticCurveTo(64, hy - 36, 40, hy - 22)
  fillStroke(ctx, HEX.enemyRed, 2.8)
  ellipse(ctx, 64, hy, 36, 34, HEX.enemySteel)
  ellipse(ctx, 64, hy + 7, 27, 22, HEX.skin, 2.8)
  rrect(ctx, 30, hy - 17, 68, 10, 5, HEX.steelDark, 2.8)
  ellipse(ctx, 50, hy - 20, 7, 3, css('paperWhite', 0.8), 0)
  // Big glossy eyes (squeezed shut behind a block), rosy cheeks, a small mouth.
  const ey = hy + 5
  if (block) {
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(64 + side * 4, ey - 5)
      ctx.lineTo(64 + side * 13, ey)
      ctx.lineTo(64 + side * 4, ey + 5)
      stroke(ctx, 3.2)
    }
    ellipse(ctx, 64, ey + 15, 3.5, 3, INK, 0)
  } else {
    for (const side of [-1, 1]) {
      const ex = 64 + side * 11
      ellipse(ctx, ex, ey, 8.5, 10, HEX.krakenEye, 2.4)
      ellipse(ctx, ex + side * 0.5, ey + 1.5, flail ? 3.5 : 6, flail ? 4 : 7.5, HEX.krakenPupil, 0)
      ellipse(ctx, ex - 2.2, ey - 2.6, 2.4, 2.4, HEX.paperWhite, 0)
      ellipse(ctx, ex + 2.4, ey + 3.4, 1.1, 1.1, HEX.paperWhite, 0)
    }
    if (flail) ellipse(ctx, 64, ey + 16, 4.5, 4, INK, 0)
    else {
      ctx.beginPath()
      ctx.moveTo(60, ey + 15)
      ctx.quadraticCurveTo(64, ey + 18, 68, ey + 15)
      stroke(ctx, 2.4)
    }
  }
  ellipse(ctx, 45, ey + 11, 5, 3, css('c7', 0.7), 0)
  ellipse(ctx, 83, ey + 11, 5, 3, css('c7', 0.7), 0)
  ctx.restore()
  // The big round paper shield, held square in front (raised on a block, flung askew in a flail).
  const sx = flail ? 88 : 68
  const sy = block ? 118 : flail ? 124 : 132 + step * 2
  ctx.save()
  ctx.translate(sx, sy)
  ctx.rotate(flail ? 0.7 : block ? -0.08 : 0)
  ellipse(ctx, 0, 0, 36, 35, HEX.gold)
  ellipse(ctx, 0, 0, 29, 28, HEX.enemyRed, 2.6)
  star(ctx, 0, 0, 17, HEX.paperWhite, 2.4)
  ellipse(ctx, 0, 0, 5, 5, HEX.gold, 2.2)
  // Paper shine along the upper rim.
  ctx.beginPath()
  ctx.arc(0, 0, 23, -2.6, -1.7)
  ctx.lineWidth = 3.5
  ctx.strokeStyle = css('paperWhite', 0.75)
  ctx.stroke()
  if (block) {
    // The glint where the bolt glanced off.
    star(ctx, 18, -22, 9, HEX.highlightHot, 2)
    for (let i = 0; i < 3; i++) {
      const a = -1.9 + i * 0.55
      ctx.beginPath()
      ctx.moveTo(18 + Math.cos(a) * 12, -22 + Math.sin(a) * 12)
      ctx.lineTo(18 + Math.cos(a) * 20, -22 + Math.sin(a) * 20)
      stroke(ctx, 2.6)
    }
  }
  ctx.restore()
  // Mitts on the shield's rim.
  if (!flail) {
    ellipse(ctx, sx - 31, sy + 6, 7, 7, HEX.enemySteel, 2.6)
    ellipse(ctx, sx + 31, sy + 6, 7, 7, HEX.enemySteel, 2.6)
  }
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
  runner0: (c) => knightFigure(c, 1, RUNNER, 0.2),
  runner1: (c) => knightFigure(c, 2, RUNNER, -0.1),
  runnerFlail: (c) => knightFigure(c, 2, RUNNER, 0.7, true),
  leaper0: (c) => knightFigure(c, 0, leaperStyle(0)),
  leaper1: (c) => knightFigure(c, 1, leaperStyle(0.3)),
  leaperJump: (c) => knightFigure(c, 0, leaperStyle(1), 0.9, true),
  leaperFlail: (c) => knightFigure(c, 2, leaperStyle(0.6), 0.6, true),
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
  scrap,
  bat0: (c) => bat(c, false),
  bat1: (c) => bat(c, true),
  bearer0: (c) => bearer(c, 0),
  bearer1: (c) => bearer(c, 1),
  bearerBlock: (c) => bearer(c, 'block'),
  bearerFlail: (c) => bearer(c, 'flail')
}

/** Draw `paint` into a cell with the die-cut white paper margin around it. */
/** Two cell-sized scratch canvases, shared by every cut-out (one pair instead of two canvases per frame). */
let scratch: { figC: HTMLCanvasElement; fig: CanvasRenderingContext2D; silC: HTMLCanvasElement; sil: CanvasRenderingContext2D } | null = null
const scratchCanvases = () => {
  if (!scratch) {
    const [figC, fig] = makeCanvas(CELL_W, CELL_H)
    const [silC, sil] = makeCanvas(CELL_W, CELL_H)
    scratch = { figC, fig, silC, sil }
  }
  const s = scratch
  s.fig.setTransform(1, 0, 0, 1, 0, 0)
  s.fig.globalAlpha = 1
  s.fig.globalCompositeOperation = 'source-over'
  s.fig.clearRect(0, 0, CELL_W, CELL_H)
  s.sil.setTransform(1, 0, 0, 1, 0, 0)
  s.sil.globalCompositeOperation = 'source-over'
  s.sil.clearRect(0, 0, CELL_W, CELL_H)
  return s
}

const cutOut = (ctx: CanvasRenderingContext2D, x: number, y: number, paint: Painter | HTMLImageElement): void => {
  const { figC, fig, silC, sil } = scratchCanvases()
  if (paint instanceof HTMLImageElement) {
    const s = Math.min((CELL_W - 16) / paint.width, (CELL_H - 12) / paint.height)
    const w = paint.width * s
    const h = paint.height * s
    fig.drawImage(paint, (CELL_W - w) / 2, CELL_H - 6 - h, w, h)
  } else {
    paint(fig)
  }
  // White silhouette, dilated → the paper margin.
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

export const createStandeeAtlas = (hero: HeroLook = CLASSIC_HERO): StandeeAtlas => {
  const [canvas, ctx] = makeCanvas(ATLAS_W, ATLAS_H)
  const index = new Map<FrameName, number>()
  let heroNow = heroKey(hero)
  const heroPaint = heroPainters(hero)
  ORDER.forEach((name, i) => {
    index.set(name, i)
    if (DEFERRED.has(name) || SEASONAL.has(name)) return
    // The hero is painted in the equipped look straight away (same five cells, same cost).
    cutOut(ctx, (i % COLS) * CELL_W, Math.floor(i / COLS) * CELL_H, heroPaint[name] ?? PAINTERS[name])
  })
  const texture = toTexture(canvas, true)
  let complete = false
  let batsReady = false
  /** Frames an override image replaced: a late paint must not draw over them. */
  const overridden = new Set<FrameName>()
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
    get complete() {
      return complete
    },
    paintDeferred(): boolean {
      if (complete) return false
      complete = true
      for (const name of DEFERRED) {
        if (overridden.has(name)) continue
        const i = index.get(name)!
        cutOut(ctx, (i % COLS) * CELL_W, Math.floor(i / COLS) * CELL_H, PAINTERS[name])
      }
      texture.needsUpdate = true
      return true
    },
    get batsReady() {
      return batsReady
    },
    setHero(look: HeroLook): boolean {
      const key = heroKey(look)
      if (key === heroNow) return false
      heroNow = key
      const paint = heroPainters(look)
      for (const name of HERO_FRAMES) {
        if (overridden.has(name)) continue
        const i = index.get(name)!
        const x = (i % COLS) * CELL_W
        const y = Math.floor(i / COLS) * CELL_H
        ctx.clearRect(x, y, CELL_W, CELL_H)
        cutOut(ctx, x, y, paint[name]!)
      }
      texture.needsUpdate = true
      return true
    },
    paintSeason(season: Season): boolean {
      if (season !== 'halloween' || batsReady) return false
      batsReady = true
      for (const name of SEASONAL) {
        const i = index.get(name)!
        cutOut(ctx, (i % COLS) * CELL_W, Math.floor(i / COLS) * CELL_H, PAINTERS[name])
      }
      texture.needsUpdate = true
      return true
    },
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
          overridden.add(t)
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
