/**
 * The two books of Aethel Fold, six pages each (GDD §8 for book 1), authored
 * with small builders so the
 * geometry reads as intent ("a tower line across the centre lane") instead of
 * as hinge maths.
 *
 * Conventions (page space, see types.ts): z grows toward the player. A *wall*
 * lies on the enemy side of its hinge, so marching knights walk onto it before
 * they reach the hinge — snapping it launches them; once it stands, it blocks.
 */

import {
  BALLISTA_COOLDOWN, BREACH_Z, CASTLE, PAGE_HALF_D, SHIELD_COOLDOWN, SHIELD_HOLD, SHIELD_HP, SPAWN_Z,
  VALLEY_HOLD, WALL_COOLDOWN, WALL_HOLD, WALL_HP, SCORE
} from './config'
import type {
  BookId, EnemyType, FoldDef, FoldStructure, LaneDef, LessonId, PageDef, PageId, SlingDef, SpawnDef, TearDef, WaveDef
} from './types'
import { withPar } from './stars'

// ─── Builders ──────────────────────────────────────────────────────────────

interface FoldOpts {
  structure?: FoldStructure
  hold?: number
  cooldown?: number
  hp?: number
  fromWave?: number
  lesson?: LessonId
  /** Launch flaps only: seconds after a fling before the flap is back, re-armed. */
  rearm?: number
}

/**
 * A horizontal wall line from x0 to x1 at depth z; the flap covers
 * [z - depth, z] (enemy side). Swipe "up the page" to lift it.
 */
export const wallLine = (id: string, x0: number, x1: number, z: number, depth: number, o: FoldOpts = {}): FoldDef => ({
  id,
  kind: 'wall',
  ax: x0, az: z, bx: x1, bz: z,
  depth,
  // left→right hinge: the enemy side (smaller z) is the negative side.
  side: -1,
  structure: o.structure ?? 'wall',
  hold: o.hold ?? (o.structure === 'shield' ? SHIELD_HOLD : WALL_HOLD),
  cooldown: o.cooldown ?? (o.structure === 'shield' ? SHIELD_COOLDOWN : WALL_COOLDOWN),
  hp: o.hp ?? (o.structure === 'shield' ? SHIELD_HP : WALL_HP),
  sx: 0, sz: -1,
  fromWave: o.fromWave ?? 0,
  lesson: o.lesson
})

/** A valley strip centred on z, `half` wide either side; swipe along it. */
export const valleyLine = (id: string, x0: number, x1: number, z: number, half: number, o: FoldOpts = {}): FoldDef => ({
  id,
  kind: 'valley',
  ax: x0, az: z, bx: x1, bz: z,
  depth: half,
  side: 1,
  structure: 'none',
  hold: o.hold ?? VALLEY_HOLD,
  cooldown: o.cooldown ?? WALL_COOLDOWN,
  hp: o.hp ?? 99,
  sx: 1, sz: 0,
  fromWave: o.fromWave ?? 0,
  lesson: o.lesson
})

/**
 * A launch flap: hinge on its enemy-side edge at z, the flap covers
 * [z, z + depth] (player side). Flipping it throws its load up the page.
 */
export const launchFlap = (id: string, x0: number, x1: number, z: number, depth: number, o: FoldOpts = {}): FoldDef => ({
  id,
  kind: 'launch',
  ax: x0, az: z, bx: x1, bz: z,
  depth,
  side: 1,
  structure: 'none',
  // hold > 0: the flipped flap folds back after a beat and re-arms (book 2's
  // catapult barrages); 0 = single use.
  hold: o.rearm ? 0.9 : 0,
  cooldown: o.rearm ?? 0,
  hp: 99,
  sx: 0, sz: -1,
  fromWave: o.fromWave ?? 0,
  lesson: o.lesson
})

/** A ridge: the ground folds into a ∧ along z, closing [x0, x1] for good. */
export const ridgeLine = (id: string, x0: number, x1: number, z: number, half: number, o: FoldOpts = {}): FoldDef => ({
  id,
  kind: 'ridge',
  ax: x0, az: z, bx: x1, bz: z,
  depth: half,
  side: 1,
  structure: 'none',
  hold: Infinity,
  cooldown: 0,
  hp: 99,
  sx: 0, sz: -1,
  fromWave: o.fromWave ?? 0,
  lesson: o.lesson
})

/** The finale fold across the flattened dragon sheet. */
export const frogLine = (id: string, x0: number, x1: number, z: number, depth: number): FoldDef => ({
  id,
  kind: 'frog',
  ax: x0, az: z, bx: x1, bz: z,
  depth,
  side: -1,
  structure: 'none',
  hold: Infinity,
  cooldown: 0,
  hp: 99,
  sx: 0, sz: -1,
  fromWave: 0,
  lesson: 'frog'
})

/**
 * A ballista folded flat on one of the castle towers. The "flap" is the strip
 * of page in front of the tower: swipe up it to flip the ballista open.
 */
export const ballistaLine = (id: string, x: number): FoldDef => ({
  id,
  kind: 'ballista',
  ax: x - 0.5, az: CASTLE.towerZ - 0.4, bx: x + 0.5, bz: CASTLE.towerZ - 0.4,
  depth: 0.8,
  side: -1,
  structure: 'ballista',
  hold: Infinity,
  cooldown: BALLISTA_COOLDOWN,
  hp: 99,
  sx: 0, sz: -1,
  fromWave: 0,
  lesson: 'ballista'
})

/** The castle's sling sits bottom-right, under the thumb. */
const SLING: SlingDef = { x: 3.95, z: 5.75 }

/** Both tower ballistas (book 1 from page 3 on, every fighting page of book 2). */
const ballistas = (): FoldDef[] => [ballistaLine('ballista-l', -CASTLE.towerX), ballistaLine('ballista-r', CASTLE.towerX)]

export const tear = (
  id: string, kind: TearDef['kind'], x: number, z: number, o: Partial<Omit<TearDef, 'id' | 'kind' | 'x' | 'z'>> = {}
): TearDef => ({
  id,
  kind,
  x,
  z,
  radius: o.radius ?? (kind === 'gate' || kind === 'drawbridge' ? 1.35 : 1.15),
  angle: o.angle ?? Math.PI / 2,
  fromWave: o.fromWave ?? 0,
  requires: o.requires,
  score: o.score ?? (kind === 'gate' ? SCORE.gate : kind === 'drawbridge' ? SCORE.drawbridge : SCORE.tower),
  lesson: o.lesson
})

/** A lane is a gentle S down the page ending at the breach line. */
export const lane = (x: number, wobble = 0, phase = 0): LaneDef => {
  const points: number[] = []
  const steps = 8
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const z = SPAWN_Z + (BREACH_Z + 0.4 - SPAWN_Z) * t
    points.push(x + Math.sin(t * Math.PI * 2 + phase) * wobble * (1 - t * 0.6), z)
  }
  return { points }
}

const s = (type: EnemyType, laneIdx: number, at: number): SpawnDef => ({ type, lane: laneIdx, at })
const post = (type: EnemyType, x: number, z: number, at = 0): SpawnDef => ({ type, lane: -1, at, x, z })

/** A column of `n` enemies on one lane, `gap` seconds apart. */
const column = (type: EnemyType, laneIdx: number, start: number, n: number, gap: number): SpawnDef[] => {
  const out: SpawnDef[] = []
  for (let i = 0; i < n; i++) out.push(s(type, laneIdx, start + i * gap))
  return out
}

const wave = (spawns: SpawnDef[], delay = 1.2, lesson?: LessonId): WaveDef => ({ spawns, delay, lesson })

// Every page is wrapped in `withPar`, which gives it its ★★★ score par from
// its own content (enemy base points + tears + the perfect bonus, plus a 30 %
// skill share; the dragon's page adds the boss and weak-point points and a
// flat skill share). The rule and its reasoning live in `parFor` (stars.ts),
// so a rebalanced wave moves its page's par with it.

// ─── Page 1 — The Border (swipe to fold) ───────────────────────────────────

const page1: PageDef = withPar({
  id: 1,
  book: 1,
  nameKey: 'border',
  theme: 'border',
  exit: 'turn',
  introDelay: 0.6,
  lanes: [lane(0, 0.25, 0.4), lane(-2.9, 0.35, 1.3), lane(2.9, 0.35, 2.2)],
  folds: [
    wallLine('p1-centre', -1.55, 1.55, -0.55, 2.1, { structure: 'tower', lesson: 'swipe' }),
    wallLine('p1-left', -4.35, -1.6, 1.1, 1.8, { structure: 'wall', fromWave: 1 }),
    wallLine('p1-right', 1.6, 4.35, 1.1, 1.8, { structure: 'wall', fromWave: 1 })
  ],
  tears: [],
  waves: [
    // The GDD §6 opening: a column of tiny knights marching down the road.
    wave(column('knight', 0, 0, 4, 0.58), 0, 'swipe'),
    wave([...column('knight', 1, 0, 3, 0.6), ...column('knight', 2, 1.4, 3, 0.6)], 1.3),
    wave([
      ...column('knight', 0, 0, 3, 0.6),
      ...column('knight', 1, 1.2, 3, 0.55),
      ...column('knight', 2, 2.6, 4, 0.55)
    ], 1.2)
  ]
})

// ─── Page 2 — The Ravine (valley + tap to stamp) ───────────────────────────

const page2: PageDef = withPar({
  id: 2,
  book: 1,
  nameKey: 'ravine',
  theme: 'ravine',
  exit: 'turn',
  introDelay: 0.7,
  lanes: [lane(0, 0.3, 0.9), lane(-3, 0.3, 2), lane(3, 0.3, 0.2)],
  folds: [
    valleyLine('p2-ravine', -4.6, 4.6, -1.3, 0.95, { lesson: 'stamp' }),
    wallLine('p2-left', -4.35, -1.4, 2.3, 1.6, { structure: 'wall', fromWave: 1 }),
    wallLine('p2-right', 1.4, 4.35, 2.3, 1.6, { structure: 'wall', fromWave: 1 }),
    // A catapult sets up on the far bank: flip it back onto its own crew.
    launchFlap('p2-launch', 1.3, 3.9, -4.5, 1.6, { fromWave: 1, lesson: 'launch', rearm: 5 })
  ],
  tears: [],
  waves: [
    wave([...column('knight', 0, 0, 3, 0.5), s('brute', 0, 1.9)], 0, 'stamp'),
    wave([
      post('catapult', 2.6, -3.7),
      s('brute', 1, 0), ...column('knight', 1, 1.2, 2, 0.6), s('brute', 2, 1.6), ...column('knight', 2, 2.6, 2, 0.6)
    ], 1.4),
    wave([
      post('catapult', 2.6, -3.7, 1.5),
      ...column('knight', 0, 0, 4, 0.45),
      s('brute', 1, 0.8), s('brute', 2, 1.8), s('brute', 0, 3.2),
      ...column('knight', 1, 2.4, 3, 0.5), ...column('knight', 2, 3.6, 3, 0.5)
    ], 1.2)
  ]
})

// ─── Page 3 — The Siege (shield, launch, shape terrain) ────────────────────

const page3: PageDef = withPar({
  id: 3,
  book: 1,
  nameKey: 'siege',
  theme: 'siege',
  exit: 'turn',
  introDelay: 0.6,
  // In front of the battlement, not through it.
  spawnZ: -5.4,
  lanes: [lane(0, 0.2, 0.3), lane(-3.3, 0.25, 1.5), lane(3.3, 0.25, 2.8)],
  folds: [
    wallLine('p3-shield', -2.3, 2.3, 4.25, 0.8, { structure: 'shield', lesson: 'shield' }),
    launchFlap('p3-launch-l', -3.9, -1.3, -3.25, 1.7, { lesson: 'launch' }),
    launchFlap('p3-launch-r', 1.3, 3.9, -3.25, 1.7, { lesson: 'launch' }),
    ridgeLine('p3-ridge', -1.25, 1.25, 0.55, 0.85, { fromWave: 1, lesson: 'ridge' }),
    wallLine('p3-left', -4.4, -1.6, 2.4, 1.5, { structure: 'wall', fromWave: 1 }),
    wallLine('p3-right', 1.6, 4.4, 2.4, 1.5, { structure: 'wall', fromWave: 1 }),
    ...ballistas()
  ],
  tears: [],
  waves: [
    wave([
      post('archer', -3.5, -6.05), post('archer', -1.75, -6.05), post('archer', 1.75, -6.05), post('archer', 3.5, -6.05),
      post('catapult', -2.6, -2.35), post('catapult', 2.6, -2.35),
      ...column('knight', 0, 2.5, 2, 0.8)
    ], 0, 'shield'),
    wave([...column('knight', 0, 0, 5, 0.5), ...column('knight', 1, 2.2, 2, 0.6)], 1.4, 'ridge'),
    wave([
      ...column('knight', 1, 0, 3, 0.5), s('brute', 2, 0.6), ...column('knight', 2, 1.8, 3, 0.5),
      s('brute', 1, 3.2), ...column('knight', 0, 3.8, 2, 0.5)
    ], 1.2)
  ]
})

// ─── Page 4 — The Castle Gates (spread to flatten, then peel) ──────────────

const page4: PageDef = withPar({
  id: 4,
  book: 1,
  nameKey: 'gates',
  theme: 'gates',
  exit: 'peel',
  introDelay: 0.8,
  // In front of the castle's outer wall and moat.
  spawnZ: -2.15,
  sling: SLING,
  lanes: [lane(0, 0.15, 0.6), lane(-2.7, 0.3, 1.9), lane(2.7, 0.3, 0.1)],
  folds: [
    wallLine('p4-shield', -2.3, 2.3, 4.25, 0.8, { structure: 'shield' }),
    wallLine('p4-centre', -1.4, 1.4, 0.2, 1.7, { structure: 'tower' }),
    wallLine('p4-left', -4.4, -1.5, 1.7, 1.5, { structure: 'wall' }),
    wallLine('p4-right', 1.5, 4.4, 1.7, 1.5, { structure: 'wall' }),
    // Siege engines in front of the walls: fling them back onto the archer towers.
    launchFlap('p4-launch-l', -4.4, -2.2, -2.1, 1.5, { fromWave: 1 }),
    launchFlap('p4-launch-r', 2.2, 4.4, -2.1, 1.5, { fromWave: 1 }),
    ...ballistas()
  ],
  tears: [
    tear('p4-tower-l', 'tower', -3.45, -4.55, { lesson: 'spread' }),
    tear('p4-tower-r', 'tower', 3.45, -4.55),
    tear('p4-gate', 'gate', 0, -4.25),
    tear('p4-bridge', 'drawbridge', 0, -3.05, { requires: ['p4-gate'], angle: 0 })
  ],
  sally: { untilTorn: 'p4-gate', every: 7, count: 2, x: 0, z: -3.6, after: 6 },
  waves: [
    wave([post('archer', -3.45, -4.95), post('archer', 3.45, -4.95), ...column('knight', 0, 1.8, 3, 0.55)], 0, 'spread'),
    wave([
      post('catapult', -3.3, -1.35), post('catapult', 3.3, -1.35),
      ...column('knight', 1, 0, 3, 0.5), ...column('knight', 2, 1, 3, 0.5)
    ], 1.5),
    // The sling's first appearance (a taste of book 2): brutes shrug off a
    // wall's launch, a stone doesn't.
    wave([s('brute', 0, 0), ...column('knight', 1, 0.8, 3, 0.5), s('brute', 2, 1.6), ...column('knight', 0, 2.4, 3, 0.45)], 1.2, 'sling')
  ]
})

// ─── Page 5 — The Boss (castle core transformation) ────────────────────────

const page5: PageDef = withPar({
  id: 5,
  book: 1,
  nameKey: 'core',
  theme: 'core',
  exit: 'boss',
  introDelay: 0.5,
  lanes: [lane(0, 0.2, 0.5), lane(-2.8, 0.25, 1.4), lane(2.8, 0.25, 2.4)],
  folds: [
    wallLine('p5-shield', -2.5, 2.5, 4.2, 0.85, { structure: 'shield', hold: 2.8 }),
    wallLine('p5-centre', -1.2, 1.2, 0.9, 1.5, { structure: 'tower' }),
    wallLine('p5-left', -4.4, -1.3, 2.0, 1.6, { structure: 'wall' }),
    wallLine('p5-right', 1.3, 4.4, 2.0, 1.6, { structure: 'wall' }),
    ...ballistas()
  ],
  tears: [],
  waves: []
})

// ─── Page 6 — Victory (the frog) ───────────────────────────────────────────

const page6: PageDef = withPar({
  id: 6,
  book: 1,
  nameKey: 'finale',
  theme: 'finale',
  exit: 'finale',
  introDelay: 0.4,
  lanes: [],
  folds: [frogLine('p6-frog', -3.2, 3.2, 0.6, 2.4)],
  tears: [],
  waves: [],
  finale: 'frog'
})

// ═══ Book 2 — The Homefront ════════════════════════════════════════════════
//
// The frog hopped home and told the Paper King everything. Now his army comes
// for the hero's own keep, drawn along the bottom edge of every page. New:
// the keep's sling (pull back, let go), runners (fast) and leapers (vault
// walls, zig-zag between lanes).


const home1: PageDef = withPar({
  id: 1,
  book: 2,
  nameKey: 'home',
  theme: 'home',
  exit: 'turn',
  introDelay: 0.6,
  sling: SLING,
  lanes: [lane(0, 0.25, 0.9), lane(-2.9, 0.3, 1.7), lane(2.7, 0.3, 0.4)],
  folds: [
    wallLine('h1-centre', -1.5, 1.5, -0.3, 2.0, { structure: 'tower' }),
    wallLine('h1-left', -4.35, -1.6, 1.6, 1.7, { structure: 'wall', fromWave: 1 }),
    wallLine('h1-right', 1.6, 4.35, 1.6, 1.7, { structure: 'wall', fromWave: 1 }),
    ...ballistas()
  ],
  tears: [],
  waves: [
    wave(column('knight', 0, 0, 4, 0.75), 0, 'sling'),
    // Runners: twice as fast — the wall has to be up before they arrive.
    wave([...column('runner', 1, 0, 3, 0.45), ...column('runner', 2, 1.8, 3, 0.45)], 1.4),
    wave([
      ...column('knight', 0, 0, 3, 0.6), ...column('runner', 1, 1, 4, 0.4),
      s('brute', 2, 1.6), ...column('runner', 2, 3.2, 3, 0.4), ...column('knight', 1, 4, 2, 0.6)
    ], 1.2)
  ]
})

const home2: PageDef = withPar({
  id: 2,
  book: 2,
  nameKey: 'orchard',
  theme: 'orchard',
  exit: 'turn',
  introDelay: 0.7,
  sling: SLING,
  lanes: [lane(0, 0.2, 0.2), lane(-3, 0.25, 1.1), lane(2.8, 0.25, 2.6)],
  folds: [
    valleyLine('o2-ditch', -4.6, 4.6, -2.5, 0.9, { fromWave: 1 }),
    wallLine('o2-centre', -1.45, 1.45, 1.0, 1.8, { structure: 'tower' }),
    wallLine('o2-left', -4.35, -1.55, 2.6, 1.5, { structure: 'wall' }),
    wallLine('o2-right', 1.55, 4.35, 2.6, 1.5, { structure: 'wall' }),
    ...ballistas()
  ],
  tears: [],
  waves: [
    // Leapers: they vault the tower. The sling brings them down.
    wave([...column('knight', 0, 0, 2, 0.7), s('leaper', 0, 2.2), s('leaper', 1, 3.6)], 0, 'leaper'),
    wave([
      ...column('leaper', 1, 0, 2, 1.2), ...column('runner', 2, 0.8, 3, 0.45),
      ...column('knight', 0, 2, 3, 0.55), s('leaper', 2, 3.4)
    ], 1.4),
    wave([
      s('brute', 0, 0), ...column('leaper', 1, 0.6, 2, 1), ...column('knight', 2, 1, 3, 0.55),
      s('brute', 2, 2.4), ...column('runner', 0, 3, 3, 0.4), s('leaper', 0, 4.2)
    ], 1.2)
  ]
})

const home3: PageDef = withPar({
  id: 3,
  book: 2,
  nameKey: 'mill',
  theme: 'mill',
  exit: 'turn',
  introDelay: 0.6,
  sling: SLING,
  lanes: [lane(0, 0.2, 0.3), lane(-3.2, 0.25, 1.5), lane(3.1, 0.25, 2.8)],
  folds: [
    wallLine('m3-shield', -2.3, 2.3, 4.25, 0.8, { structure: 'shield' }),
    // Catapult nests on both flanks. The flaps fold back and re-arm, because
    // the Paper King keeps sending more.
    launchFlap('m3-launch-l', -4.4, -1.8, -4.3, 1.6, { rearm: 4.5 }),
    launchFlap('m3-launch-r', 1.8, 4.4, -4.3, 1.6, { rearm: 4.5 }),
    ridgeLine('m3-ridge', -1.25, 1.25, -0.4, 0.85, { fromWave: 1 }),
    wallLine('m3-left', -4.4, -1.6, 2.2, 1.5, { structure: 'wall' }),
    wallLine('m3-right', 1.6, 4.4, 2.2, 1.5, { structure: 'wall' }),
    ...ballistas()
  ],
  tears: [],
  waves: [
    wave([post('catapult', -3.1, -3.5), post('catapult', 3.1, -3.5), ...column('knight', 0, 2, 3, 0.7)], 0),
    wave([
      post('catapult', -3.1, -3.5, 1), ...column('runner', 0, 0, 4, 0.4),
      post('catapult', 3.1, -3.5, 5), ...column('knight', 1, 2.4, 3, 0.55), ...column('knight', 2, 4.2, 2, 0.55)
    ], 1.4),
    wave([
      post('catapult', -3.1, -3.5, 0.5), post('catapult', 3.1, -3.5, 0.5),
      post('archer', -1.6, -6.1), post('archer', 1.6, -6.1),
      s('leaper', 0, 1), ...column('runner', 1, 1.6, 3, 0.4), s('brute', 2, 2.2), ...column('knight', 0, 3.4, 3, 0.5),
      post('catapult', -3.1, -3.5, 8), post('catapult', 3.1, -3.5, 9)
    ], 1.2)
  ]
})

const home4: PageDef = withPar({
  id: 4,
  book: 2,
  nameKey: 'camp',
  theme: 'camp',
  exit: 'turn',
  introDelay: 0.8,
  sling: SLING,
  lanes: [lane(0, 0.3, 0.6), lane(-2.9, 0.3, 1.9), lane(2.9, 0.3, 0.1)],
  folds: [
    wallLine('c4-shield', -2.3, 2.3, 4.25, 0.8, { structure: 'shield' }),
    launchFlap('c4-launch-l', -4.4, -2.0, -4.9, 1.5, { rearm: 5 }),
    launchFlap('c4-launch-r', 2.0, 4.4, -4.9, 1.5, { rearm: 5 }),
    valleyLine('c4-ditch', -4.6, 4.6, -1.6, 0.85),
    wallLine('c4-centre', -1.4, 1.4, 1.2, 1.7, { structure: 'tower' }),
    wallLine('c4-left', -4.4, -1.5, 2.7, 1.4, { structure: 'wall' }),
    wallLine('c4-right', 1.5, 4.4, 2.7, 1.4, { structure: 'wall' }),
    ...ballistas()
  ],
  tears: [],
  waves: [
    wave([
      post('catapult', -3.2, -4.15), post('catapult', 3.2, -4.15),
      ...column('knight', 0, 1, 3, 0.55), ...column('leaper', 1, 2.6, 2, 1)
    ], 0),
    wave([
      ...column('runner', 2, 0, 4, 0.38), s('brute', 0, 1), ...column('leaper', 0, 2, 2, 0.9),
      post('catapult', -3.2, -4.15, 3), ...column('knight', 1, 3, 3, 0.5)
    ], 1.4),
    wave([
      post('catapult', -3.2, -4.15, 0), post('catapult', 3.2, -4.15, 0.5),
      s('brute', 1, 0), s('brute', 2, 1.2), ...column('leaper', 0, 0.6, 3, 0.9),
      ...column('runner', 1, 2.2, 4, 0.36), ...column('knight', 2, 3, 3, 0.5),
      post('catapult', 3.2, -4.15, 9)
    ], 1.2)
  ]
})

const home5: PageDef = withPar({
  id: 5,
  book: 2,
  nameKey: 'return',
  theme: 'core',
  exit: 'boss',
  introDelay: 0.5,
  sling: SLING,
  bossPace: 0.85,
  stomp: ['runner', 'leaper', 'knight', 'runner', 'brute'],
  lanes: [lane(0, 0.2, 0.5), lane(-2.8, 0.25, 1.4), lane(2.8, 0.25, 2.4)],
  folds: [
    wallLine('r5-shield', -2.5, 2.5, 4.2, 0.85, { structure: 'shield', hold: 2.8 }),
    wallLine('r5-centre', -1.2, 1.2, 0.9, 1.5, { structure: 'tower' }),
    wallLine('r5-left', -4.4, -1.3, 2.0, 1.6, { structure: 'wall' }),
    wallLine('r5-right', 1.3, 4.4, 2.0, 1.6, { structure: 'wall' }),
    ...ballistas()
  ],
  tears: [],
  waves: []
})

const home6: PageDef = withPar({
  id: 6,
  book: 2,
  nameKey: 'homecoming',
  theme: 'finale',
  exit: 'finale',
  introDelay: 0.4,
  lanes: [],
  folds: [frogLine('h6-crane', -3.2, 3.2, 0.6, 2.4)],
  tears: [],
  waves: [],
  finale: 'crane'
})

export const BOOKS: Readonly<Record<BookId, Readonly<Record<PageId, PageDef>>>> = {
  1: { 1: page1, 2: page2, 3: page3, 4: page4, 5: page5, 6: page6 },
  2: { 1: home1, 2: home2, 3: home3, 4: home4, 5: home5, 6: home6 }
}

/** Book 1's pages (the original six). */
export const PAGES: Readonly<Record<PageId, PageDef>> = BOOKS[1]

export const PAGE_COUNT = 6
export const BOOK_COUNT = 2

export const pageDef = (book: BookId, id: PageId): PageDef => BOOKS[book][id]

export const isBookId = (n: unknown): n is BookId => n === 1 || n === 2

export const isPageId = (n: unknown): n is PageId =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= PAGE_COUNT

/** Total enemies a page will ever spawn from its waves (boss stomps excluded). */
export const pageEnemyCount = (p: PageDef): number =>
  p.waves.reduce((n, w) => n + w.spawns.length, 0)

/** Page-space top edge, re-exported for renderers that frame the castle. */
export const PAGE_TOP_Z = -PAGE_HALF_D
