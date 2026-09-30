import { describe, expect, it } from 'vitest'
import { FoldGame } from '@/fold/logic/game'
import { ENEMY, SCORE, SHIELD_BEARER_PACE, SLING_GAIN, SLOW_MODE_SCALE, DIFFICULTY } from '@/fold/logic/config'
import { spawnEnemy } from '@/fold/logic/entities'
import { BLOCK_BEARER, KILL_CAPSIZE, KILL_CRUSH, KILL_SHOT } from '@/fold/logic/events'
import { BOOKS, pageDef } from '@/fold/logic/pages'
import { isRated, parFor } from '@/fold/logic/stars'
import { createKindMemory, noteCrumple } from '@/fold/logic/difficulty'
import type { BookId, EnemyType, PageDef, PageId, SpawnDef } from '@/fold/logic/types'
import { ALL_LESSONS_LEARNED, run } from './bot'

// C12: the shield-bearer — half a knight's pace, a shield ballista bolts glance off.

const DT = 1 / 60

const step = (g: FoldGame, s: number, each?: () => void): void => {
  for (let t = 0; t < s; t += DT) {
    g.update(DT)
    each?.()
    g.events.clear()
  }
}

const game = (book: BookId, page: PageId, seed = 3): FoldGame => {
  const g = new FoldGame({ seed, learned: ALL_LESSONS_LEARNED, book })
  g.startRun(page, 0, book)
  step(g, 0.05)
  return g
}

const foldIndex = (g: FoldGame, id: string): number => g.folds.findIndex((f) => f.def.id === id)

/** An enemy standing still at (x, z) (its lane offset keeps it from drifting to the lane's centre). */
const parked = (g: FoldGame, x: number, z: number, type: EnemyType = 'shieldBearer'): number => {
  const slot = spawnEnemy(g.enemies, type, x, z, 0, 0)
  const e = g.enemies[slot]!
  e.speed = 0
  e.tx = x - g.laneX(0, z)
  return slot
}

const bearersOn = (p: PageDef): number => {
  let n = 0
  for (const w of p.waves) for (const s of w.spawns) if (s.type === 'shieldBearer') n++
  if (p.stomp?.includes('shieldBearer')) n++
  return n
}

describe('shield-bearer — tuning', () => {
  it('marches at half a knight\'s pace, one hit, launchable, with base points for the par rule', () => {
    expect(SHIELD_BEARER_PACE).toBe(0.5)
    expect(ENEMY.shieldBearer.speed).toBeCloseTo(ENEMY.knight.speed * 0.5, 10)
    expect(ENEMY.shieldBearer.hp).toBe(1)
    expect(ENEMY.shieldBearer.launchable).toBe(true)
    expect(Number.isFinite(ENEMY.shieldBearer.score)).toBe(true)
    expect(ENEMY.shieldBearer.score).toBeGreaterThan(ENEMY.knight.score)
  })

  it('walks half as far as a knight in the same time, and slow mode scales both alike', () => {
    const march = (type: EnemyType, slow: boolean): number => {
      const g = game(1, 1)
      if (slow) g.worldScale = SLOW_MODE_SCALE
      const e = g.enemies[spawnEnemy(g.enemies, type, 0, -6, 1, 0)]!
      const z0 = e.z
      step(g, 1)
      return e.z - z0
    }
    const knight = march('knight', false)
    const bearer = march('shieldBearer', false)
    expect(knight).toBeGreaterThan(0)
    expect(bearer / knight).toBeCloseTo(0.5, 2)
    expect(march('shieldBearer', true) / bearer).toBeCloseTo(SLOW_MODE_SCALE, 2)
  })

  it('takes the kind book\'s pace on spawn like every marcher', () => {
    const kind = createKindMemory()
    noteCrumple(kind, 3, 2)
    const g = new FoldGame({ seed: 3, learned: ALL_LESSONS_LEARNED, book: 3, kind })
    g.startRun(2, 0, 3)
    expect(g.difficulty).toBeCloseTo(DIFFICULTY.crumpleSlow, 10)
    const spawn = (g as unknown as { spawnFrom(sd: SpawnDef): void }).spawnFrom.bind(g)
    spawn({ type: 'shieldBearer', lane: 1, at: 0 })
    spawn({ type: 'knight', lane: 2, at: 0 })
    const base = (type: EnemyType) => {
      const e = g.enemies.find((o) => o.state === 'march' && o.type === type)!
      // Undo the personal jitter spread (entities.spawnEnemy) to compare base paces.
      return e.speed / (0.94 + Math.abs(e.tx) * 0.12)
    }
    expect(base('shieldBearer')).toBeCloseTo(ENEMY.shieldBearer.speed * DIFFICULTY.crumpleSlow, 6)
    expect(base('shieldBearer') / base('knight')).toBeCloseTo(0.5, 6)
  })

  it('a perfect streak\'s extra marcher behind a shield-bearer is a knight, not another shield', () => {
    const g = game(3, 1)
    g.extraPerWave = 2
    const order = (g as unknown as { orderWave(s: readonly SpawnDef[]): SpawnDef[] }).orderWave([
      { type: 'knight', lane: 0, at: 0 }, { type: 'shieldBearer', lane: 1, at: 1 }
    ])
    expect(order).toHaveLength(4)
    expect(order.slice(2).map((s) => s.type)).toEqual(['knight', 'knight'])
    expect(order.slice(2).map((s) => s.lane)).toEqual([2, 0])
  })
})

describe('shield-bearer — ballista bolts glance off, everything else hurts', () => {
  const open = (g: FoldGame): number => {
    const i = foldIndex(g, 'ballista-l')
    expect(g.foldNow(i)).toBe(true)
    step(g, 0.3)
    return i
  }

  it('a bolt is blocked: no damage, the bolt is spent, the column behind is screened, the one in front is hit', () => {
    const g = game(3, 1)
    const i = open(g)
    const x = g.folds[i]!.cx
    const front = parked(g, x, 1.5, 'knight')
    const bearer = parked(g, x, 0)
    const behind1 = parked(g, x, -0.8, 'knight')
    const behind2 = parked(g, x, -1.6, 'knight')
    const score0 = g.score
    const blocks: { b: number; x: number; z: number }[] = []
    const killed: number[] = []
    expect(g.fireBallista(x, -4)).toBe(true)
    // (Short: a torn slot is freed after its linger and the page's first wave may reuse it.)
    step(g, 0.4, () => {
      for (let k = 0; k < g.events.count; k++) {
        const e = g.events.items[k]!
        if (e.type === 'blocked' && e.c === BLOCK_BEARER) blocks.push({ b: e.b, x: e.x, z: e.z })
        if (e.type === 'kill') killed.push(e.a)
      }
    })
    expect(killed).toEqual([front])
    expect(g.enemies[bearer]!.state).toBe('march')
    expect(g.enemies[bearer]!.hp).toBe(ENEMY.shieldBearer.hp)
    expect(g.enemies[behind1]!.state).toBe('march')
    expect(g.enemies[behind2]!.state).toBe('march')
    // Consumed on the shield: no bolt flies on.
    expect(g.projectiles.some((p) => p.alive && p.type === 'bolt')).toBe(false)
    expect(g.stats.boltKills).toBe(1)
    expect(g.stats.boltsBlocked).toBe(1)
    // The first block on a page carries the big-word flag; only the knight's kill scored.
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.b).toBe(1)
    expect(Math.abs(blocks[0]!.x - x)).toBeLessThan(0.01)
    expect(g.score - score0).toBe(ENEMY.knight.score)
    // It flinched into its block pose, and settles back into the march.
    expect(g.enemies[bearer]!.windup).toBeGreaterThan(0)
    step(g, 0.5)
    expect(g.enemies[bearer]!.windup).toBe(0)
    // A second block on the same page: no big word.
    expect(g.fireBallista(x, -4)).toBe(true)
    let second = -1
    step(g, 0.5, () => {
      for (let k = 0; k < g.events.count; k++) {
        const e = g.events.items[k]!
        if (e.type === 'blocked' && e.c === BLOCK_BEARER) second = e.b
      }
    })
    expect(second).toBe(0)
    expect(g.enemies[bearer]!.state).toBe('march')
    expect(g.stats.boltsBlocked).toBe(2)
  })

  it('the block pose shows right after the tink', () => {
    const g = game(3, 1)
    const i = open(g)
    const x = g.folds[i]!.cx
    const bearer = parked(g, x, 0)
    g.fireBallista(x, -4)
    let peak = 0
    step(g, 0.4, () => {
      peak = Math.max(peak, g.enemies[bearer]!.windup)
    })
    expect(peak).toBeGreaterThan(0.5)
  })

  it('a sling stone takes it down (one hit, like a knight)', () => {
    const g = game(3, 1)
    const s = g.sling!
    const bearer = parked(g, 1, -2)
    g.grabSling()
    g.aimSling(-(1 - s.def.x) / SLING_GAIN, -(-2 - s.def.z) / SLING_GAIN)
    expect(g.releaseSling()).toBe(true)
    let kind = -1
    step(g, 1.5, () => {
      for (let k = 0; k < g.events.count; k++) {
        const e = g.events.items[k]!
        if (e.type === 'kill' && e.a === bearer) kind = e.c
      }
    })
    expect(kind).toBe(KILL_SHOT)
    expect(g.enemies[bearer]!.state === 'torn' || g.enemies[bearer]!.state === 'dead').toBe(true)
    expect(g.stats.shieldBearers).toBe(1)
  })

  it('a wall snap launches it like a knight', () => {
    const g = game(2, 1)
    const i = foldIndex(g, 'h1-centre')
    const bearer = parked(g, 0, -1.2)
    expect(g.foldNow(i)).toBe(true)
    step(g, 0.3)
    expect(g.enemies[bearer]!.state === 'launched' || g.enemies[bearer]!.state === 'dead').toBe(true)
  })

  it('the pleat crushes it, and the boat capsizes it', () => {
    const g = game(3, 2)
    const i = foldIndex(g, 's2-pleat')
    const bearer = parked(g, 0, -4.2)
    let crush = false
    expect(g.foldNow(i)).toBe(true)
    step(g, 1, () => {
      for (let k = 0; k < g.events.count; k++) {
        const e = g.events.items[k]!
        if (e.type === 'kill' && e.a === bearer && e.c === KILL_CRUSH) crush = true
      }
    })
    expect(crush).toBe(true)

    const h = game(3, 1)
    const b = foldIndex(h, 's1-boat')
    const wader = parked(h, 0.5, -1.4)
    let capsized = false
    expect(h.foldNow(b)).toBe(true)
    step(h, 4, () => {
      for (let k = 0; k < h.events.count; k++) {
        const e = h.events.items[k]!
        if (e.type === 'kill' && e.a === wader && e.c === KILL_CAPSIZE) capsized = true
      }
    })
    expect(capsized).toBe(true)
  })
})

describe('shield-bearer — placement and pars', () => {
  it('book 1 has none; book 2 has one or two, on its later pages; book 3 has them on most rated pages', () => {
    for (let p = 1; p <= 6; p++) expect(bearersOn(pageDef(1, p as PageId)), `b1p${p}`).toBe(0)
    let book2 = 0
    for (let p = 1; p <= 6; p++) {
      const n = bearersOn(pageDef(2, p as PageId))
      if (p <= 2) expect(n, `b2p${p}`).toBe(0)
      book2 += n
    }
    expect(book2).toBeGreaterThanOrEqual(1)
    expect(book2).toBeLessThanOrEqual(2)
    let rated = 0
    let withBearers = 0
    for (let p = 1; p <= 6; p++) {
      const def = pageDef(3, p as PageId)
      if (!isRated(def)) continue
      rated++
      if (bearersOn(def) > 0) withBearers++
    }
    expect(withBearers * 2).toBeGreaterThan(rated)
  })

  it('every shield-bearer walks a lane (spawns at the page\'s spawnZ, never posted inside paper)', () => {
    for (const book of [2, 3] as BookId[]) {
      for (let p = 1; p <= 6; p++) {
        for (const w of BOOKS[book][p as PageId].waves) {
          for (const s of w.spawns) if (s.type === 'shieldBearer') expect(s.lane, `b${book}p${p}`).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('pars stay finite and above what a perfect clear banks anyway', () => {
    for (const book of [2, 3] as BookId[]) {
      for (let p = 1; p <= 5; p++) {
        const def = pageDef(book, p as PageId)
        expect(Number.isFinite(def.par)).toBe(true)
        expect(def.par).toBe(parFor(def))
        let guaranteed = SCORE.perfectPage
        for (const w of def.waves) for (const s of w.spawns) guaranteed += ENEMY[s.type].score
        if (def.exit === 'boss') guaranteed += SCORE.boss + 5 * SCORE.weakpoint
        expect(def.par, `b${book}p${p}`).toBeGreaterThan(guaranteed)
      }
    }
  })

  it('a shield-bearer marches onto a book-3 page from its spawn line', () => {
    const g = game(3, 2, 1)
    let seen = -1
    run(g, 120, () => {
      const e = g.enemies.find((o) => o.type === 'shieldBearer' && o.state === 'march')
      if (e) seen = e.z
      return !!e
    })
    expect(seen).toBeGreaterThan(-8)
    expect(seen).toBeLessThan(-4)
  })
})
