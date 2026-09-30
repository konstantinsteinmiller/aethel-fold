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
  | 'cheerVillager0' | 'cheerVillager1' | 'cheerSoldier0' | 'cheerSoldier1'
  | 'cheerFarmer0' | 'cheerFarmer1' | 'cheerKid0' | 'cheerKid1'
  | 'crushed' | 'scrap'
  | 'bat0' | 'bat1'

const ORDER: FrameName[] = [
  'knight0', 'knight1', 'knightFlail', 'brute0', 'brute1', 'bruteFlail', 'archer0', 'archerDraw',
  'hero0', 'heroCheer', 'heroCower', 'heroHit', 'heroWalk', 'crushed', 'scrap',
  'cheerVillager0', 'cheerVillager1', 'cheerSoldier0', 'cheerSoldier1', 'cheerFarmer0', 'cheerFarmer1', 'cheerKid0', 'cheerKid1',
  'runner0', 'runner1', 'runnerFlail', 'leaper0', 'leaper1', 'leaperJump', 'leaperFlail',
  'bat0', 'bat1'
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
 * Frames no book-1 page shows until its victory: the outro's cheering crowd
 * (C9b) and book 2's runners and leapers. `createStandeeAtlas` leaves their cells blank so the
 * boot only paints what page 1 can show (roadmap #13); `paintDeferred` fills
 * them in later (idle after the first input, or at once when a book-2 page, a
 * boss or finale page, or the victory crowd needs them). Blank cells are never on screen before then.
 */
const DEFERRED: ReadonlySet<FrameName> = new Set<FrameName>([
  'cheerVillager0', 'cheerVillager1', 'cheerSoldier0', 'cheerSoldier1', 'cheerFarmer0', 'cheerFarmer1', 'cheerKid0', 'cheerKid1',
  'runner0', 'runner1', 'runnerFlail', 'leaper0', 'leaper1', 'leaperJump', 'leaperFlail'
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

// ─── The outro's cheering crowd (C9b) ───────────────────────────────────────
//
// Chibi paper people: a big round head on a small body, big shiny eyes with
// a paper-white highlight, rosy cheeks, an open happy mouth, pastel clothes.
// Pose 0 waves (one arm up, hat on); pose 1 is the hooray (both arms up, the
// hat tossed into the air — the soldier's helmet only bounces).

type ChibiHat = 'bonnet' | 'helmet' | 'straw' | 'party'

interface ChibiStyle {
  outfit: string
  outfitDark: string
  legs: string
  hair: string
  hat: ChibiHat
  /** A flared dress instead of a tunic. */
  skirt?: boolean
  /** Two hair buns. */
  buns?: boolean
  /** A pennant on a stick in the waving hand. */
  flag?: boolean
  /** A gold star on the tabard. */
  star?: boolean
  /** Figure scale about the feet (kids are a head shorter). */
  scale?: number
}

const starPts = (x: number, y: number, r0: number, r1: number): number[] => {
  const pts: number[] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2
    const r = i % 2 ? r1 : r0
    pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r)
  }
  return pts
}

/** An arm from the shoulder, `a` radians clockwise from hanging down; returns nothing, draws the mitten hand too. */
const chibiArm = (ctx: CanvasRenderingContext2D, sx: number, sy: number, a: number, s: ChibiStyle, hand: { x: number; y: number }): void => {
  const len = 27
  ctx.save()
  ctx.translate(sx, sy)
  ctx.rotate(a)
  rrect(ctx, -5.5, -3, 11, len, 5.5, s.outfit, 3)
  ellipse(ctx, 0, len + 1, 6.8, 6.8, HEX.skin, 3)
  ctx.restore()
  hand.x = sx - Math.sin(a) * (len + 1)
  hand.y = sy + Math.cos(a) * (len + 1)
}

const chibiHat = (ctx: CanvasRenderingContext2D, s: ChibiStyle, x: number, y: number, rot: number): void => {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  switch (s.hat) {
    case 'bonnet':
      ellipse(ctx, 0, 5, 30, 8, HEX.straw)
      ellipse(ctx, 0, -3, 20, 12, HEX.straw)
      rrect(ctx, -20, -1, 40, 6, 3, HEX.pastelPink, 2.4)
      ellipse(ctx, 14, -4, 4.5, 4.5, HEX.paperWhite, 2)
      ellipse(ctx, 14, -4, 1.8, 1.8, HEX.pastelLemonDark, 0)
      break
    case 'straw':
      ellipse(ctx, 0, 6, 38, 8.5, HEX.straw)
      rrect(ctx, -18, -15, 36, 22, 10, HEX.straw)
      rrect(ctx, -18, -1, 36, 6, 2, HEX.pastelMintDark, 2.4)
      ctx.beginPath()
      ctx.moveTo(-30, 8)
      ctx.lineTo(-24, 5)
      ctx.moveTo(26, 5)
      ctx.lineTo(32, 8)
      stroke(ctx, 1.8)
      break
    case 'party':
      poly(ctx, [0, -30, -14, 6, 14, 6], HEX.pastelLilac)
      ellipse(ctx, -3, -8, 2.4, 2.4, HEX.pastelLemon, 1.6)
      ellipse(ctx, 5, -1, 2.4, 2.4, HEX.pastelPink, 1.6)
      ellipse(ctx, 1, -18, 2, 2, HEX.pastelMint, 1.4)
      ellipse(ctx, 0, -32, 5.5, 5.5, HEX.pastelPink, 2.4)
      break
    case 'helmet':
      ctx.beginPath()
      ctx.ellipse(0, 10, 31, 24, 0, Math.PI, 0)
      ctx.closePath()
      fillStroke(ctx, HEX.heroSteel)
      rrect(ctx, -33, 6, 66, 8, 4, HEX.enemySteel, 2.8)
      ctx.beginPath()
      ctx.moveTo(0, -14)
      ctx.quadraticCurveTo(-4, -28, 8, -32)
      ctx.quadraticCurveTo(4, -22, 12, -16)
      ctx.quadraticCurveTo(6, -14, 0, -14)
      fillStroke(ctx, HEX.pastelPink, 2.6)
      break
  }
  ctx.restore()
}

const chibiHand = { x: 0, y: 0 }

const chibi = (ctx: CanvasRenderingContext2D, s: ChibiStyle, hooray: boolean): void => {
  ctx.save()
  const k = s.scale ?? 1
  ctx.translate(64, 180)
  ctx.scale(k, k)
  ctx.translate(-64, -174)
  // Stubby legs and round shoes (a little skip in the hooray).
  const lift = hooray ? -4 : 0
  rrect(ctx, 50, 144, 11, 24, 5, s.legs, 3)
  rrect(ctx, 67, 144 + lift, 11, 24, 5, s.legs, 3)
  ellipse(ctx, 54, 170, 9, 5.5, HEX.woodDark, 3)
  ellipse(ctx, 74, 170 + lift, 9, 5.5, HEX.woodDark, 3)
  // Small body.
  if (s.skirt) {
    poly(ctx, [50, 108, 78, 108, 94, 152, 34, 152], s.outfit)
    poly(ctx, [56, 112, 72, 112, 78, 146, 50, 146], HEX.paperWhite, 2.4)
  } else {
    rrect(ctx, 43, 106, 42, 46, 13, s.outfit)
    rrect(ctx, 43, 134, 42, 7, 3, s.outfitDark, 2.4)
  }
  if (s.star) poly(ctx, starPts(64, 122, 8, 3.4), HEX.gold, 2.2)
  // Buns and back hair behind the head.
  if (s.buns) {
    ellipse(ctx, 33, 60, 10, 10, s.hair)
    ellipse(ctx, 95, 60, 10, 10, s.hair)
  }
  ellipse(ctx, 64, 72, 34, 31, s.hair)
  // The big round head.
  ellipse(ctx, 64, 80, 30, 27, HEX.skin)
  // Bangs.
  ctx.beginPath()
  ctx.moveTo(33, 76)
  ctx.quadraticCurveTo(35, 46, 64, 45)
  ctx.quadraticCurveTo(93, 46, 95, 76)
  ctx.lineTo(88, 64)
  ctx.lineTo(80, 70)
  ctx.lineTo(71, 61)
  ctx.lineTo(62, 68)
  ctx.lineTo(53, 61)
  ctx.lineTo(45, 70)
  ctx.lineTo(39, 63)
  ctx.closePath()
  fillStroke(ctx, s.hair, 3)
  // Big shiny eyes: ink, a paper-white highlight and a little glint.
  for (const ex of [52, 76]) {
    ellipse(ctx, ex, 84, 5.4, 7, INK, 0)
    ellipse(ctx, ex - 1.6, 80.6, 2.4, 2.6, HEX.paperWhite, 0)
    ellipse(ctx, ex + 1.8, 87.6, 1.1, 1.1, HEX.paperWhite, 0)
  }
  // Rosy cheeks.
  ellipse(ctx, 43, 93, 5.8, 3.6, css('blush', 0.85), 0)
  ellipse(ctx, 85, 93, 5.8, 3.6, css('blush', 0.85), 0)
  // An open, happy mouth (wider in the hooray) with a tongue.
  const m = hooray ? 7.5 : 6
  ctx.beginPath()
  ctx.moveTo(64 - m, 93)
  ctx.quadraticCurveTo(64, hooray ? 108 : 104, 64 + m, 93)
  ctx.closePath()
  fillStroke(ctx, INK, 2)
  ellipse(ctx, 64, hooray ? 101.5 : 99, m * 0.5, 2.4, HEX.tongue, 0)
  // Hat: on the head, or tossed high in the hooray (the helmet only hops).
  if (s.hat === 'helmet') chibiHat(ctx, s, 64, hooray ? 50 : 56, hooray ? -0.12 : 0)
  else if (hooray) chibiHat(ctx, s, 74, s.hat === 'party' ? 34 : 24, 0.4)
  else chibiHat(ctx, s, 64, s.hat === 'party' ? 48 : 50, s.hat === 'party' ? -0.15 : 0)
  // Arms in front: a wave (one up, one on the hip) or both up.
  if (hooray) {
    chibiArm(ctx, 45, 114, 2.25, s, chibiHand)
    const fx = chibiHand.x
    const fy = chibiHand.y
    chibiArm(ctx, 83, 114, -2.25, s, chibiHand)
    if (s.flag) chibiFlag(ctx, fx, fy)
  } else {
    chibiArm(ctx, 45, 114, 2.6, s, chibiHand)
    if (s.flag) chibiFlag(ctx, chibiHand.x, chibiHand.y)
    chibiArm(ctx, 83, 114, -0.45, s, chibiHand)
  }
  ctx.restore()
}

/** A little pennant on a stick, held up in a hand. */
const chibiFlag = (ctx: CanvasRenderingContext2D, hx: number, hy: number): void => {
  ctx.beginPath()
  ctx.moveTo(hx, hy + 4)
  ctx.lineTo(hx - 3, hy - 34)
  stroke(ctx, 3.4)
  poly(ctx, [hx - 3, hy - 34, hx + 20, hy - 28, hx - 2, hy - 20], HEX.pastelLemon, 2.4)
}

const VILLAGER: ChibiStyle = {
  outfit: HEX.pastelPink, outfitDark: HEX.pastelPinkDark, legs: HEX.paperWhite, hair: HEX.hairBrown, hat: 'bonnet', skirt: true, buns: true
}
const SOLDIER: ChibiStyle = {
  outfit: HEX.pastelSky, outfitDark: HEX.pastelSkyDark, legs: HEX.heroSteel, hair: HEX.hairBrown, hat: 'helmet', flag: true, star: true
}
const FARMER: ChibiStyle = {
  outfit: HEX.pastelMint, outfitDark: HEX.pastelMintDark, legs: HEX.pastelSkyDark, hair: HEX.hairGold, hat: 'straw'
}
const KID: ChibiStyle = {
  outfit: HEX.pastelLemon, outfitDark: HEX.pastelLemonDark, legs: HEX.pastelLilacDark, hair: HEX.hairGold, hat: 'party', scale: 0.88
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
  cheerVillager0: (c) => chibi(c, VILLAGER, false),
  cheerVillager1: (c) => chibi(c, VILLAGER, true),
  cheerSoldier0: (c) => chibi(c, SOLDIER, false),
  cheerSoldier1: (c) => chibi(c, SOLDIER, true),
  cheerFarmer0: (c) => chibi(c, FARMER, false),
  cheerFarmer1: (c) => chibi(c, FARMER, true),
  cheerKid0: (c) => chibi(c, KID, false),
  cheerKid1: (c) => chibi(c, KID, true),
  crushed,
  scrap,
  bat0: (c) => bat(c, false),
  bat1: (c) => bat(c, true)
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
