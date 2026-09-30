import { describe, expect, it } from 'vitest'
import { FoldGame } from '@/fold/logic/game'
import { SECRET } from '@/fold/logic/config'
import {
  SECRETS, SECRET_IDS, SECRET_TOTAL, countFound, createSecretState, enterSecretPage, mergeSecretLists, noteSecretSnap,
  readSecretList, secretCode, secretOnPage, secretsInBook, type SecretId
} from '@/fold/logic/secrets'
import { starsFor } from '@/fold/logic/stars'
import type { BookId, PageId } from '@/fold/logic/types'
import { ALL_LESSONS_LEARNED } from './bot'

const DT = 1 / 60

const game = (book: BookId, page: PageId, found: readonly string[] = []): FoldGame => {
  const g = new FoldGame({ seed: 21, learned: ALL_LESSONS_LEARNED, book, secrets: found })
  g.startRun(page, 0, book)
  g.events.clear()
  return g
}

const step = (g: FoldGame, s: number): void => {
  for (let t = 0; t < s; t += DT) {
    g.update(DT)
    g.events.clear()
  }
}

/** Advance, collecting the `secret` events (a = code, b = new). */
const collect = (g: FoldGame, s: number, out: { a: number; b: number }[]): void => {
  for (let t = 0; t < s; t += DT) {
    g.update(DT)
    grab(g, out)
  }
}
const grab = (g: FoldGame, out: { a: number; b: number }[]): void => {
  for (let i = 0; i < g.events.count; i++) {
    const e = g.events.items[i]!
    if (e.type === 'secret') out.push({ a: e.a, b: e.b })
  }
  g.events.clear()
}

/** Three quick taps on the page's secret spot (a frame apart). */
const tapSpot = (g: FoldGame, out: { a: number; b: number }[], n: number = SECRET.taps): void => {
  for (let k = 0; k < n; k++) {
    g.tap(g.secrets.spotX, g.secrets.spotZ)
    grab(g, out)
    g.update(0.2)
    grab(g, out)
  }
}

const fold = (g: FoldGame, id: string): number => g.folds.findIndex((f) => f.def.id === id)

/** Snap a fold now and let the snap finish (real time). */
const snap = (g: FoldGame, id: string, out: { a: number; b: number }[]): void => {
  const i = fold(g, id)
  const f = g.folds[i]!
  if (f.phase !== 'ready') {
    // A test shortcut: the fold is ready again (its cooldown would take a while).
    f.phase = 'ready'
    f.t = 0
  }
  expect(g.foldNow(i)).toBe(true)
  collect(g, 0.3, out)
}

const code = (id: SecretId): number => secretCode(id)

describe('page secrets: the list (roadmap #15)', () => {
  it('eighteen secrets, one per page of all three books, the desk lamp for book 1', () => {
    expect(SECRET_TOTAL).toBe(18)
    expect(new Set(SECRET_IDS).size).toBe(18)
    expect(secretsInBook(1)).toBe(6)
    expect(secretsInBook(2)).toBe(6)
    expect(secretsInBook(3)).toBe(6)
    // Book 3's were appended: the codes of the first twelve never moved.
    expect(SECRET_IDS.slice(0, 12)).toEqual(['lamp', 'boat', 'fling', 'moat', 'nap', 'hop', 'wave', 'apples', 'whirl', 'campfire', 'bonk', 'flap'])
    for (const b of [1, 2, 3]) {
      for (let p = 1; p <= 6; p++) {
        const n = SECRETS.filter((s) => s.book === b && s.page === p).length
        expect(n, `b${b}p${p}`).toBe(1)
      }
    }
    expect(secretOnPage(1, 1)).toBeNull()
    expect(SECRETS.find((s) => s.book === 1 && s.page === 1)!.trigger).toBe('desk')
    // Fold secrets name folds that exist on their pages.
    for (const s of SECRETS) {
      for (const id of s.folds) {
        const g = game(s.book as BookId, s.page)
        expect(fold(g, id), `${s.id}: ${id}`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('sanitises, counts and merges found lists', () => {
    expect(readSecretList(['boat', 'lamp', 'nope', 'boat', 3, null])).toEqual(['lamp', 'boat'])
    expect(readSecretList('lamp')).toEqual([])
    expect(readSecretList(undefined)).toEqual([])
    expect(countFound(['lamp', 'boat', 'wave'])).toBe(3)
    expect(countFound(['lamp', 'boat', 'wave'], 1)).toBe(2)
    expect(countFound(['lamp', 'boat', 'wave'], 2)).toBe(1)
    expect(mergeSecretLists(['wave'], ['lamp', 'wave'])).toEqual(['lamp', 'wave'])
  })

  it('a pair only counts both folds close together; counters start over on each page load', () => {
    const s = createSecretState()
    enterSecretPage(s, 1, 3)
    expect(noteSecretSnap(s, 'p3-launch-l')).toBe(false)
    s.clock += SECRET.pairGap + 0.1
    expect(noteSecretSnap(s, 'p3-launch-r')).toBe(false)
    s.clock += 0.2
    expect(noteSecretSnap(s, 'p3-launch-l')).toBe(true)
    expect(noteSecretSnap(s, 'p3-ridge')).toBe(false)
    enterSecretPage(s, 1, 2)
    expect(noteSecretSnap(s, 'p2-ravine')).toBe(false)
    expect(noteSecretSnap(s, 'p2-ravine')).toBe(false)
    enterSecretPage(s, 1, 2)
    expect(noteSecretSnap(s, 'p2-ravine')).toBe(false)
    expect(noteSecretSnap(s, 'p2-ravine')).toBe(false)
    expect(noteSecretSnap(s, 'p2-ravine')).toBe(true)
  })
})

describe('page secrets: every trigger, once', () => {
  it('lamp: a tap on the desk lamp toggles night mode; the first tap ever finds the secret', () => {
    const g = game(1, 1)
    const out: { a: number; b: number }[] = []
    const score = g.score
    expect(g.tapLamp()).toBe(true)
    expect(g.events.types()).toContain('night')
    grab(g, out)
    expect(out).toEqual([{ a: code('lamp'), b: 1 }])
    expect(g.score).toBe(score + SECRET.bonus)
    expect(g.tapLamp()).toBe(false)
    expect(g.secrets.night).toBe(false)
    grab(g, out)
    expect(out[1]).toEqual({ a: code('lamp'), b: 0 })
    expect(g.score).toBe(score + SECRET.bonus)
    // The lamp works on any page and in any mode (it is on the desk).
    const h = game(2, 4, ['lamp'])
    h.tapLamp()
    grab(h, out)
    expect(out[2]).toEqual({ a: code('lamp'), b: 0 })
    expect(h.score).toBe(0)
  })

  it('boat: the ravine folded three times on one visit', () => {
    const g = game(1, 2)
    const out: { a: number; b: number }[] = []
    snap(g, 'p2-ravine', out)
    snap(g, 'p2-ravine', out)
    expect(out).toEqual([])
    snap(g, 'p2-ravine', out)
    expect(out).toEqual([{ a: code('boat'), b: 1 }])
    // Other folds never count.
    const h = game(1, 2)
    const none: { a: number; b: number }[] = []
    for (let k = 0; k < 3; k++) snap(h, 'p2-left', none)
    expect(none).toEqual([])
  })

  it('fling: both catapult flaps flipped at once — not one after the other', () => {
    const g = game(1, 3)
    const out: { a: number; b: number }[] = []
    snap(g, 'p3-launch-l', out)
    collect(g, SECRET.pairGap + 0.3, out)
    snap(g, 'p3-launch-r', out)
    expect(out).toEqual([])
    const h = game(1, 3)
    snap(h, 'p3-launch-l', out)
    snap(h, 'p3-launch-r', out)
    expect(out).toEqual([{ a: code('fling'), b: 1 }])
  })

  it('moat: a sling stone into the moat (and not one that lands short of it)', () => {
    const g = game(1, 4)
    const out: { a: number; b: number }[] = []
    expect(g.slingAt(2, 1)).toBe(true)
    collect(g, 3, out)
    expect(out).toEqual([])
    expect(g.slingAt(-1.5, -3.05)).toBe(true)
    collect(g, 3, out)
    expect(out).toEqual([{ a: code('moat'), b: 1 }])
  })

  it('nap: three taps on the sleeping castle core, before the dragon wakes', () => {
    const g = game(1, 5)
    const out: { a: number; b: number }[] = []
    expect(g.boss.phase).toBe('dormant')
    tapSpot(g, out)
    expect(out).toEqual([{ a: code('nap'), b: 1 }])
    // Awake, the dragon doesn't nap.
    const h = game(1, 5)
    for (let t = 0; t < 30 && h.boss.phase !== 'idle'; t += DT) step(h, DT)
    expect(h.boss.phase).toBe('idle')
    const late: { a: number; b: number }[] = []
    tapSpot(h, late)
    expect(late).toEqual([])
  })

  it('hop: three taps on the folded frog (the page takes no other input by then)', () => {
    const g = game(1, 6)
    const out: { a: number; b: number }[] = []
    // Before it is folded, nothing.
    tapSpot(g, out)
    expect(out).toEqual([])
    expect(g.foldNow(0)).toBe(true)
    collect(g, 0.4, out)
    expect(g.phase).toBe('finale')
    tapSpot(g, out)
    expect(out).toEqual([{ a: code('hop'), b: 1 }])
    // …and on the victory page too, as a replay.
    collect(g, 4, out)
    expect(g.phase).toBe('victory')
    tapSpot(g, out)
    expect(out[1]).toEqual({ a: code('hop'), b: 0 })
  })

  it('wave: three taps on the hero, who waves back', () => {
    const g = game(2, 1)
    const out: { a: number; b: number }[] = []
    tapSpot(g, out)
    expect(out).toEqual([{ a: code('wave'), b: 1 }])
    expect(g.hero.mood).toBe('cheer')
  })

  it('apples, whirl, campfire: three taps on the apple tree, the windmill, the campfire', () => {
    for (const [page, id] of [[2, 'apples'], [3, 'whirl'], [4, 'campfire']] as const) {
      const g = game(2, page)
      const out: { a: number; b: number }[] = []
      expect(g.secrets.def?.id).toBe(id)
      tapSpot(g, out)
      expect(out, id).toEqual([{ a: code(id), b: 1 }])
    }
  })

  it('taps must be quick and on target', () => {
    const g = game(2, 3)
    const out: { a: number; b: number }[] = []
    // Too slow between taps.
    for (let k = 0; k < 4; k++) {
      g.tap(g.secrets.spotX, g.secrets.spotZ)
      collect(g, SECRET.tapGap + 0.2, out)
    }
    expect(out).toEqual([])
    // Off target.
    for (let k = 0; k < 3; k++) {
      g.tap(g.secrets.spotX + 3, g.secrets.spotZ)
      collect(g, 0.1, out)
    }
    expect(out).toEqual([])
    // The view moves the target to where it appears: the finger follows it.
    g.secrets.spotX -= 0.7
    g.secrets.spotZ += 1.1
    tapSpot(g, out)
    expect(out).toEqual([{ a: code('whirl'), b: 1 }])
  })

  it('bonk: a sling stone on the dragon before it wakes', () => {
    const g = game(2, 5)
    const out: { a: number; b: number }[] = []
    expect(g.slingAt(0, -3)).toBe(true)
    collect(g, 2, out)
    expect(out).toEqual([{ a: code('bonk'), b: 1 }])
    // No sling hit counted on a sleeping dragon.
    expect(g.boss.slingHits).toBe(0)
  })

  it('flap: three taps on the folded crane', () => {
    const g = game(2, 6)
    const out: { a: number; b: number }[] = []
    expect(g.foldNow(0)).toBe(true)
    collect(g, 0.4, out)
    tapSpot(g, out)
    expect(out).toEqual([{ a: code('flap'), b: 1 }])
  })

  it('a secret pays its bonus once: again on the same page, or found in an earlier session, it only shows off', () => {
    const g = game(2, 3)
    const out: { a: number; b: number }[] = []
    tapSpot(g, out)
    const after = g.score
    expect(after).toBe(SECRET.bonus)
    tapSpot(g, out)
    expect(out).toEqual([{ a: code('whirl'), b: 1 }, { a: code('whirl'), b: 0 }])
    expect(g.score).toBe(after)
    const h = game(2, 3, ['whirl'])
    tapSpot(h, out)
    expect(out[2]).toEqual({ a: code('whirl'), b: 0 })
    expect(h.score).toBe(0)
    // The host's saved list, fed in later (a late cloud hydrate), counts too.
    const k = game(1, 2)
    k.setSecretsFound(['boat', 'junk'])
    expect(k.secretsFound()).toEqual(['boat'])
    for (let n = 0; n < 3; n++) snap(k, 'p2-ravine', out)
    expect(out[3]).toEqual({ a: code('boat'), b: 0 })
    expect(k.score).toBe(0)
  })

  it('a secret never lifts the page\'s stars', () => {
    const g = game(2, 3)
    const out: { a: number; b: number }[] = []
    tapSpot(g, out)
    expect(g.score).toBe(SECRET.bonus)
    for (let t = 0; t < 10 && g.phase !== 'play'; t += DT) step(g, DT)
    g.debugClearPage()
    let stars = -1
    for (let t = 0; t < 5 && stars < 0; t += DT) {
      g.update(DT)
      for (let i = 0; i < g.events.count; i++) if (g.events.items[i]!.type === 'pageCleared') stars = g.events.items[i]!.c
      g.events.clear()
    }
    expect(stars).toBe(starsFor(g.hitsThisPage, g.score - g.pageStartScore - SECRET.bonus, g.page.par, false))
  })

  it('secrets are never required and never hinted: nothing about them is highlighted or taught', () => {
    // A page with its secret found plays exactly like one without: same folds, same lessons.
    for (const s of SECRETS) {
      if (s.trigger === 'desk') continue
      const g = game(s.book as BookId, s.page)
      expect(g.secrets.def?.id).toBe(s.id)
      expect(g.lesson.id).toBeNull()
    }
  })
})

describe('page secrets: C6 follow-ups', () => {
  /** Count `ballistaFire` events while tapping at (x, z). */
  const bolts = (g: FoldGame, x: number, z: number): number => {
    g.tap(x, z)
    let n = 0
    for (let i = 0; i < g.events.count; i++) if (g.events.items[i]!.type === 'ballistaFire') n++
    g.events.clear()
    g.update(0.2)
    g.events.clear()
    return n
  }

  it('Home: a tap clearly on the hero never also looses a ballista bolt; the rim and elsewhere still fire', () => {
    const g = game(2, 1)
    // Both ballistas open, with bolts.
    for (let i = 0; i < g.folds.length; i++) if (g.folds[i]!.def.kind === 'ballista') expect(g.foldNow(i)).toBe(true)
    step(g, 0.5)
    expect(g.folds.filter((f) => f.def.kind === 'ballista' && f.phase === 'up').length).toBe(2)
    // Where the view says the hero appears (he stands up off the page, so his spot is up the page from his feet).
    g.secrets.spotX = 0
    g.secrets.spotZ = 4.4
    const r = g.secrets.def!.r
    expect(bolts(g, 0, 4.4)).toBe(0)
    expect(bolts(g, r * SECRET.heroClear * 0.9, 4.4)).toBe(0)
    // Near the rim of his reach a shot past him is as likely meant: it fires.
    expect(bolts(g, r * 0.95, 4.4)).toBe(1)
    // Up the page, away from him: fires as ever.
    expect(bolts(g, -1.5, -2)).toBe(1)
  })

  it('Home: the hero taps still count for his wave', () => {
    const g = game(2, 1)
    for (let i = 0; i < g.folds.length; i++) if (g.folds[i]!.def.kind === 'ballista') g.foldNow(i)
    step(g, 0.5)
    g.secrets.spotX = 0
    g.secrets.spotZ = 4.4
    const out: { a: number; b: number }[] = []
    tapSpot(g, out)
    expect(out).toEqual([{ a: code('wave'), b: 1 }])
  })

  it('Siege: the catapult flaps re-arm, so the fling can be tried again on the same visit', () => {
    const g = game(1, 3)
    const out: { a: number; b: number }[] = []
    const l = fold(g, 'p3-launch-l')
    const r = fold(g, 'p3-launch-r')
    // A first try, too slow: one flap, then the other well after.
    expect(g.foldNow(l)).toBe(true)
    collect(g, SECRET.pairGap + 0.4, out)
    expect(g.foldNow(r)).toBe(true)
    collect(g, 0.3, out)
    expect(out).toEqual([])
    // No test shortcut: both flaps come back by themselves.
    for (let t = 0; t < 12 && (g.folds[l]!.phase !== 'ready' || g.folds[r]!.phase !== 'ready'); t += DT) collect(g, DT, out)
    expect(g.folds[l]!.phase).toBe('ready')
    expect(g.folds[r]!.phase).toBe('ready')
    // A second try, both at once: the secret.
    expect(g.foldNow(l)).toBe(true)
    expect(g.foldNow(r)).toBe(true)
    collect(g, 0.3, out)
    expect(out).toEqual([{ a: code('fling'), b: 1 }])
  })
})
