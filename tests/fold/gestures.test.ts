import { describe, expect, it } from 'vitest'
import { FoldGame } from '@/fold/logic/game'
import { GestureRecognizer, type PagePoint } from '@/fold/input/gestures'
import { spawnEnemy } from '@/fold/logic/entities'

/** A trivial "camera": 40 px per page unit, page origin at (200, 300). */
const PX = 40
const toScreen = (x: number, z: number): [number, number] => [200 + x * PX, 300 + z * PX]
const host = {
  project: (sx: number, sy: number, out: PagePoint) => {
    out.x = (sx - 200) / PX
    out.z = (sy - 300) / PX
    return true
  },
  minDim: () => 400
}

const ALL = { swipe: true, stamp: true, shield: true, launch: true, ridge: true, spread: true, peel: true, crease: true, core: true, frog: true, crush: true, sling: true, leaper: true, ballista: true }

const setup = (page: 1 | 2 | 3 | 4 | 5 = 1) => {
  const g = new FoldGame({ learned: ALL })
  g.startRun(page)
  for (let i = 0; i < 90; i++) {
    g.update(1 / 60)
    g.events.clear()
  }
  return { g, r: new GestureRecognizer(g, host) }
}

const swipe = (r: GestureRecognizer, from: [number, number], to: [number, number], t0 = 0): void => {
  r.down(1, from[0], from[1], t0)
  for (let i = 1; i <= 10; i++) r.move(1, from[0] + (to[0] - from[0]) * i / 10, from[1] + (to[1] - from[1]) * i / 10, t0 + i * 16)
  r.up(1, to[0], to[1], t0 + 200)
}

describe('GestureRecognizer', () => {
  it('a swipe along the arrow folds the wall', () => {
    const { g, r } = setup()
    const f = g.folds[0]!
    swipe(r, toScreen(f.cx, f.cz - 0.2), toScreen(f.cx, f.cz - 2.2))
    expect(['snapping', 'up']).toContain(f.phase)
  })

  it('a swipe the wrong way does nothing', () => {
    const { g, r } = setup()
    const f = g.folds[0]!
    swipe(r, toScreen(f.cx, f.cz - 1.5), toScreen(f.cx, f.cz + 0.8))
    expect(f.phase).toBe('ready')
  })

  it('a quick tap on a raised wall stamps it', () => {
    const { g, r } = setup()
    g.foldNow(0)
    for (let i = 0; i < 30; i++) g.update(1 / 60)
    const f = g.folds[0]!
    const [x, y] = toScreen(f.cx, f.cz - 0.4)
    r.down(1, x, y, 0)
    r.up(1, x, y, 90)
    expect(f.phase).toBe('stamping')
  })

  it('two fingers spreading on a crease tear it', () => {
    const { g, r } = setup(4)
    const t = g.tears.find((o) => o.def.id === 'p4-tower-l')!
    expect(t.active).toBe(true)
    const [cx, cy] = toScreen(t.px, t.pz)
    r.down(1, cx - 8, cy, 0)
    r.down(2, cx + 8, cy, 5)
    for (let i = 1; i <= 10; i++) {
      r.move(1, cx - 8 - i * 10, cy, 10 + i * 16)
      r.move(2, cx + 8 + i * 10, cy, 10 + i * 16)
    }
    r.up(2, cx + 108, cy, 300)
    r.up(1, cx - 108, cy, 300)
    expect(t.torn).toBe(true)
  })

  it('a single-pointer drag across a crease tears it too (the mouse spread)', () => {
    const { g, r } = setup(4)
    const t = g.tears.find((o) => o.def.id === 'p4-tower-r')!
    const [cx, cy] = toScreen(t.px, t.pz)
    swipe(r, [cx, cy], [cx + 120, cy])
    expect(t.torn).toBe(true)
  })

  it('valleys fold along their length, either direction', () => {
    const { g, r } = setup(2)
    const v = g.folds.find((f) => f.def.kind === 'valley')!
    spawnEnemy(g.enemies, 'knight', 0, v.cz, 0, 0)
    swipe(r, toScreen(v.cx + 2, v.cz), toScreen(v.cx - 1.5, v.cz))
    expect(['snapping', 'up']).toContain(v.phase)
  })

  it('cancel releases whatever was held', () => {
    const { g, r } = setup()
    const f = g.folds[0]!
    const a = toScreen(f.cx, f.cz - 0.2)
    r.down(1, a[0], a[1], 0)
    r.move(1, a[0], a[1] - 30, 16)
    expect(f.phase).toBe('dragging')
    r.cancel()
    expect(f.phase).toBe('ready')
  })
})
