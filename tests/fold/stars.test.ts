import { describe, expect, it } from 'vitest'
import { FoldGame } from '@/fold/logic/game'
import { BOOKS, PAGE_COUNT, pageDef } from '@/fold/logic/pages'
import { ENEMY, SCORE, STARS } from '@/fold/logic/config'
import {
  asStars, isRated, mergeStarRecords, parFor, readStarRecord, starKey, starsFor
} from '@/fold/logic/stars'
import type { BookId, PageId } from '@/fold/logic/types'
import { ALL_LESSONS_LEARNED, botStep } from './bot'

const PAGE_IDS: PageId[] = [1, 2, 3, 4, 5, 6]
const BOOK_IDS: BookId[] = [1, 2]

/** Run until `pageCleared`; returns its event fields (or null on a crumple / timeout). */
const clearWithBot = (g: FoldGame, seconds: number): { perfect: number; stars: number; pageScore: number } | null => {
  const dt = 1 / 60
  for (let t = 0; t < seconds; t += dt) {
    botStep(g)
    const before = g.pageStartScore
    g.update(dt)
    for (let i = 0; i < g.events.count; i++) {
      const e = g.events.items[i]!
      if (e.type === 'pageCleared') return { perfect: e.b, stars: e.c, pageScore: g.score - before }
    }
    g.events.clear()
    if (g.phase === 'crumple') return null
  }
  return null
}

describe('star rating rule', () => {
  it('★ clear, ★★ at most one heart lost, ★★★ a perfect page at or above par', () => {
    expect(starsFor(3, 99999, 1000, false)).toBe(1)
    expect(starsFor(2, 99999, 1000, false)).toBe(1)
    expect(starsFor(1, 99999, 1000, false)).toBe(2)
    expect(starsFor(0, 999, 1000, false)).toBe(2)
    expect(starsFor(0, 1000, 1000, false)).toBe(3)
    expect(starsFor(0, 5000, 1000, false)).toBe(3)
  })

  it('a Try-again continue caps the page at ★', () => {
    expect(starsFor(0, 99999, 1000, true)).toBe(1)
    expect(starsFor(1, 99999, 1000, true)).toBe(1)
  })

  it('junk never earns ★★★ (NaN par or hits)', () => {
    expect(starsFor(0, 5000, Number.NaN, false)).toBe(2)
    expect(starsFor(Number.NaN, 5000, 1000, false)).toBe(1)
  })

  it('save values are clamped to 0…3', () => {
    expect(asStars(2)).toBe(2)
    expect(asStars(7)).toBe(3)
    expect(asStars(-1)).toBe(0)
    expect(asStars('3')).toBe(0)
    expect(asStars(Number.NaN)).toBe(0)
    expect(starKey(2, 4)).toBe('b2p4')
    expect(readStarRecord({ b1p1: 3, b2p6: 1, b3p1: 3, b1p7: 2, b1p2: 0, b1p3: 'x', junk: 1 })).toEqual({ b1p1: 3, b2p6: 1 })
    expect(readStarRecord(null)).toEqual({})
    expect(readStarRecord([3])).toEqual({})
  })

  it('merging two star records keeps the best of each page', () => {
    expect(mergeStarRecords({ b1p1: 3, b1p2: 1 }, { b1p1: 1, b1p2: 2, b2p1: 3 })).toEqual({ b1p1: 3, b1p2: 2, b2p1: 3 })
    expect(mergeStarRecords(undefined, { b1p1: 2 })).toEqual({ b1p1: 2 })
  })
})

describe('pars', () => {
  it('every page of both books has a finite, positive par on the 50-point step', () => {
    for (const book of BOOK_IDS) {
      for (const id of PAGE_IDS) {
        const p = pageDef(book, id)
        expect(Number.isFinite(p.par), `b${book}p${id}`).toBe(true)
        expect(p.par, `b${book}p${id}`).toBeGreaterThan(0)
        expect(p.par % STARS.parStep, `b${book}p${id}`).toBe(0)
        expect(p.par).toBe(parFor(p))
      }
    }
    expect(Object.keys(BOOKS[1]).length).toBe(PAGE_COUNT)
  })

  it('par sits above what every perfect clear banks anyway — the skill share is real', () => {
    for (const book of BOOK_IDS) {
      for (const id of PAGE_IDS) {
        const p = pageDef(book, id)
        if (!isRated(p)) continue
        let floor = SCORE.perfectPage
        for (const w of p.waves) for (const s of w.spawns) floor += ENEMY[s.type].score
        for (const t of p.tears) floor += t.score
        if (p.exit === 'boss') floor += SCORE.boss + 5 * SCORE.weakpoint
        expect(p.par, `b${book}p${id}`).toBeGreaterThan(floor)
      }
    }
  })

  it('follows the documented rule (page 1: 20 knights)', () => {
    const p = pageDef(1, 1)
    const knights = p.waves.reduce((n, w) => n + w.spawns.length, 0)
    expect(knights).toBe(20)
    expect(p.par).toBe(Math.floor((knights * 100 * (1 + STARS.parSkill) + SCORE.perfectPage) / 50) * 50)
  })

  it('the finale is unrated; every other page is rated', () => {
    for (const book of BOOK_IDS) {
      expect(isRated(pageDef(book, 6))).toBe(false)
      for (const id of [1, 2, 3, 4, 5] as PageId[]) expect(isRated(pageDef(book, id))).toBe(true)
    }
  })

  // The balance check behind STARS.parSkill: the frame-perfect bot makes par
  // on every rated page (so ★★★ is achievable), without par being a gimme.
  // On book 1's dragon the bot's shield timing still takes a hit now and then,
  // so its points are judged as if the page had been flawless (+ the perfect
  // bonus it missed) — par is about points; the no-hit part is the player's.
  it.each(BOOK_IDS.flatMap((b) => [1, 2, 3, 4, 5].map((p) => [b, p] as [BookId, PageId])))(
    'book %i page %i: the frame-perfect bot scores par', (book, page) => {
      const par = pageDef(book, page).par
      let best = 0
      for (let seed = 1; seed <= 4 && best < par; seed++) {
        const g = new FoldGame({ seed: seed * 31 + page, book, learned: ALL_LESSONS_LEARNED })
        g.startRun(page)
        const r = clearWithBot(g, 400)
        if (!r) continue
        const flawless = r.pageScore + (r.perfect ? 0 : SCORE.perfectPage)
        best = Math.max(best, flawless)
        if (r.perfect && r.pageScore >= par) expect(r.stars).toBe(3)
      }
      expect(best, `best ${best} vs par ${par}`).toBeGreaterThanOrEqual(par)
    }
  )
})

/** Let the page start (intro → play), wipe it with the debug clear, optionally tweak, and return the stars. */
const debugClear = (g: FoldGame, tweak?: () => void): number => {
  const dt = 1 / 60
  for (let t = 0; t < 10 && g.phase !== 'play'; t += dt) {
    g.update(dt)
    g.events.clear()
  }
  g.debugClearPage()
  tweak?.()
  for (let t = 0; t < 3; t += dt) {
    g.update(dt)
    for (let i = 0; i < g.events.count; i++) if (g.events.items[i]!.type === 'pageCleared') return g.events.items[i]!.c
    g.events.clear()
  }
  return -1
}

describe('stars in the game', () => {
  it('pageCleared carries the stars (c) and GameStats.stars sums them over the run', () => {
    const g = new FoldGame({ seed: 5, learned: ALL_LESSONS_LEARNED })
    g.startRun(1)
    const r = clearWithBot(g, 240)
    expect(r).not.toBeNull()
    expect(r!.stars).toBeGreaterThanOrEqual(1)
    expect(g.pageStars).toBe(r!.stars)
    expect(g.stats.stars).toBe(r!.stars)
  })

  it('one heart lost is ★★ even far above par', () => {
    const g = new FoldGame({ seed: 5, learned: ALL_LESSONS_LEARNED })
    g.startRun(1)
    expect(debugClear(g, () => {
      g.hitsThisPage = 1
      g.score += 100_000
    })).toBe(2)
  })

  it('a perfect page at par is ★★★, just under par is ★★', () => {
    for (const [bonus, want] of [[0, 3], [-60, 2]] as const) {
      const g = new FoldGame({ seed: 5, learned: ALL_LESSONS_LEARNED })
      g.startRun(1)
      // With the perfect bonus the clear adds, the page lands exactly on par + bonus.
      const stars = debugClear(g, () => {
        g.score = g.pageStartScore + g.page.par + bonus - SCORE.perfectPage
      })
      expect(stars, `bonus ${bonus}`).toBe(want)
    }
  })

  it('a page finished after a Try-again continue earns ★', () => {
    const g = new FoldGame({ seed: 3, learned: ALL_LESSONS_LEARNED })
    g.startRun(2)
    const dt = 1 / 60
    // Do nothing until the page crumples, then take the continue.
    for (let t = 0; t < 120 && g.phase !== 'crumple'; t += dt) {
      g.update(dt)
      g.events.clear()
    }
    expect(g.phase).toBe('crumple')
    for (let t = 0; t < 3 && !g.canTryAgain(); t += dt) {
      g.update(dt)
      g.events.clear()
    }
    expect(g.tryAgain()).toBe(true)
    expect(g.continuedThisPage).toBe(true)
    const stars = debugClear(g)
    expect(stars).toBe(1)
  })

  it('a fresh page (restart) forgets the continue and can earn ★★★ again', () => {
    const g = new FoldGame({ seed: 3, learned: ALL_LESSONS_LEARNED })
    g.startRun(1)
    g.continuedThisPage = true
    g.restartPage()
    expect(g.continuedThisPage).toBe(false)
  })

  it('the dragon page is rated when it collapses', () => {
    const g = new FoldGame({ seed: 99, learned: ALL_LESSONS_LEARNED })
    g.startRun(5)
    const r = clearWithBot(g, 400)
    expect(r).not.toBeNull()
    expect(r!.stars).toBeGreaterThanOrEqual(1)
    expect(r!.stars).toBeLessThanOrEqual(3)
  })
})
