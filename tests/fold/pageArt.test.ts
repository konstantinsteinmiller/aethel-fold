import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { BOOKS } from '@/fold/logic/pages'

const ALL_PAGES = Object.values(BOOKS).flatMap((b) => Object.values(b))
import { PAPER_PATTERNS, HERO_VARIANTS, CONFETTI_SHAPES } from '@/fold/logic/cosmetics'
import { SEASONS } from '@/fold/logic/seasons'

// ─── Painters with every look (roadmaps #6, #17) ───────────────────────────
//
// jsdom has no 2D canvas, so the painters draw into a recording stand-in that
// fails on any non-finite number (NaN compares false, so a NaN coordinate
// would otherwise paint nothing and pass). Every page of every book is painted
// on every paper in every season, and the standee atlas in every hero look.

const bad: string[] = []
let calls = 0

const check = (name: string, args: unknown[]): void => {
  calls++
  for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) bad.push(`${name}(${args.map(String).join(', ')})`)
}

const gradient = () => ({ addColorStop: (o: number, _c: string) => check('addColorStop', [o]) })

const fakeContext = (canvas: object): CanvasRenderingContext2D => {
  const state: Record<string | symbol, unknown> = { canvas, lineWidth: 1, globalAlpha: 1 }
  const handler: ProxyHandler<object> = {
    get(_t, key) {
      if (key in state) return state[key]
      if (key === 'createLinearGradient' || key === 'createRadialGradient') {
        return (...args: unknown[]) => {
          check(String(key), args)
          return gradient()
        }
      }
      if (key === 'createPattern') return (..._args: unknown[]) => ({ setTransform: () => undefined })
      if (key === 'measureText') return (s: string) => ({ width: String(s).length * 10 })
      if (key === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
      return (...args: unknown[]) => check(String(key), args)
    },
    set(_t, key, value) {
      if (typeof value === 'number') check(`set ${String(key)}`, [value])
      state[key] = value
      return true
    }
  }
  return new Proxy({}, handler) as CanvasRenderingContext2D
}

const realCreate = document.createElement.bind(document)

beforeAll(() => {
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, opts?: ElementCreationOptions) => {
    if (tag !== 'canvas') return realCreate(tag, opts)
    const c = { width: 0, height: 0, style: {} } as unknown as HTMLCanvasElement & { __ctx?: CanvasRenderingContext2D }
    ;(c as unknown as { getContext: () => CanvasRenderingContext2D }).getContext = () => {
      c.__ctx ??= fakeContext(c)
      return c.__ctx
    }
    return c
  }) as typeof document.createElement)
})

afterAll(() => {
  vi.restoreAllMocks()
})

describe('paintPage in every look', () => {
  it('every page × paper × season paints finite coordinates and textures', async () => {
    const { paintPage, PAGE_PAPERS } = await import('@/fold/render/art/pageArt')
    expect([...PAGE_PAPERS]).toEqual([...PAPER_PATTERNS])
    let n = 0
    for (const def of ALL_PAGES) {
      for (const paper of PAPER_PATTERNS) {
        for (const season of SEASONS) {
          bad.length = 0
          const before = calls
          const tex = paintPage(def, { paper, season })
          expect(bad, `b${def.book}p${def.id} ${paper} ${season}`).toEqual([])
          expect(calls - before).toBeGreaterThan(1000)
          expect(tex.art).toBeTruthy()
          expect(tex.page).toBeTruthy()
          tex.dispose()
          n++
        }
      }
    }
    expect(n).toBe(18 * PAPER_PATTERNS.length * SEASONS.length)
  })

  it('the default look is the plain page (no argument = plain parchment, no season)', async () => {
    const { paintPage, PLAIN_LOOK } = await import('@/fold/render/art/pageArt')
    expect(PLAIN_LOOK).toEqual({ paper: 'plain', season: 'none' })
    bad.length = 0
    paintPage(ALL_PAGES[0]!).dispose()
    expect(bad).toEqual([])
  })
})

describe('standee atlas looks', () => {
  it('every hero variant in every season, a repaint, and the bats paint finite', async () => {
    const { createStandeeAtlas, heroAccessories } = await import('@/fold/render/art/standeeArt')
    for (const variant of HERO_VARIANTS) {
      for (const season of SEASONS) {
        bad.length = 0
        const a = createStandeeAtlas({ variant, season })
        expect(a.batsReady).toBe(false)
        // Same look again: nothing to repaint.
        expect(a.setHero({ variant, season })).toBe(false)
        expect(a.paintDeferred()).toBe(true)
        // Only Halloween paints the bats, once.
        expect(a.paintSeason(season)).toBe(season === 'halloween')
        expect(a.paintSeason(season)).toBe(false)
        expect(a.batsReady).toBe(season === 'halloween')
        expect(bad, `${variant} ${season}`).toEqual([])
        a.dispose()
      }
    }
    // Winter wraps the scarf round any variant.
    expect(heroAccessories({ variant: 'crown', season: 'winter' })).toEqual({ scarf: true, sash: false, crown: true, sailor: false })
    expect(heroAccessories({ variant: 'classic', season: 'none' })).toEqual({ scarf: false, sash: false, crown: false, sailor: false })
    const a = createStandeeAtlas()
    expect(a.setHero({ variant: 'sash', season: 'none' })).toBe(true)
    expect(a.setHero({ variant: 'sash', season: 'none' })).toBe(false)
    // Scarf by choice and scarf by winter look the same: no repaint.
    expect(a.setHero({ variant: 'scarf', season: 'none' })).toBe(true)
    expect(a.setHero({ variant: 'classic', season: 'winter' })).toBe(false)
    a.dispose()
  })
})

describe("book 3's outro cast in the atlas", () => {
  it('dolphins and paper boats have their own cells inside the grown atlas, and paint finite (deferred)', async () => {
    const { createStandeeAtlas, ATLAS_H, CELL_H } = await import('@/fold/render/art/standeeArt')
    expect(ATLAS_H / CELL_H).toBe(6)
    bad.length = 0
    const a = createStandeeAtlas()
    const names = ['dolphin0', 'dolphin1', 'boatA0', 'boatA1', 'boatB0', 'boatB1', 'bearer0', 'bat1', 'knight0'] as const
    const seen = new Set<string>()
    for (const n of names) {
      const f = a.frame(n)
      for (const v of [f.u0, f.v0, f.u1, f.v1]) expect(v >= 0 && v <= 1, n).toBe(true)
      seen.add(`${f.u0.toFixed(4)},${f.v0.toFixed(4)}`)
    }
    expect(seen.size).toBe(names.length)
    expect(a.complete).toBe(false)
    expect(a.paintDeferred()).toBe(true)
    expect(bad).toEqual([])
    a.dispose()
  })
})

describe('look geometry', () => {
  it('confetti chips, the castle dress and snowy scenery are finite', async () => {
    const { confettiGeometry } = await import('@/fold/render/views/Effects')
    const models = await import('@/fold/render/models')
    const { CASTLE } = await import('@/fold/logic/config')
    const finite = (g: { getAttribute(n: string): { array: ArrayLike<number> } }, what: string): void => {
      for (const attr of ['position', 'normal']) {
        const arr = g.getAttribute(attr).array
        for (let i = 0; i < arr.length; i++) expect(Number.isFinite(arr[i]!), `${what} ${attr}[${i}]`).toBe(true)
      }
    }
    for (const s of CONFETTI_SHAPES) {
      const g = confettiGeometry(s)
      expect(g.getAttribute('position').count).toBeGreaterThan(3)
      finite(g, s)
      g.computeBoundingBox()
      // About the classic chip's size, so a burst keeps its weight.
      const b = g.boundingBox!
      expect(b.max.x - b.min.x).toBeLessThan(0.25)
      expect(b.max.y - b.min.y).toBeLessThan(0.25)
    }
    expect(models.seasonCastleGeometry('none', CASTLE.keepZ, CASTLE.towerX, CASTLE.towerZ, CASTLE.keepTop, CASTLE.towerTop)).toBeNull()
    for (const season of ['halloween', 'winter'] as const) {
      const g = models.seasonCastleGeometry(season, CASTLE.keepZ, CASTLE.towerX, CASTLE.towerZ, CASTLE.keepTop, CASTLE.towerTop)!
      finite(g, season)
      g.computeBoundingBox()
      // The castle stays low: the dress adds little above the tallest roof (the bailey keep's, 2.2).
      expect(g.boundingBox!.max.y).toBeLessThan(2.4)
    }
    for (const [name, geo] of [
      ['pine', models.pineGeometry()], ['roundTree', models.roundTreeGeometry()], ['bush', models.bushGeometry()],
      ['rock', models.rockGeometry()], ['appleTree', models.appleTreeGeometry()], ['tent', models.tentGeometry()]
    ] as const) {
      const snowy = models.snowyGeometry(geo, name)
      finite(snowy, name)
      expect(snowy.getAttribute('position').count).toBeGreaterThanOrEqual(geo.getAttribute('position').count)
      expect(snowy.getAttribute('color').count).toBe(snowy.getAttribute('position').count)
    }
  })
})
