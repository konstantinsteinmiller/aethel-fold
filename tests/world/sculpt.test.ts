import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyDab,
  createBaseGridCache,
  parseSculpt,
  SCULPT_FALLOFFS,
  SCULPT_STORE_KEY,
  sculptFalloff,
  SculptField,
  serialiseSculpt,
  type SculptBrush,
  type SculptFalloff
} from '@/world/terrain/SculptField'
import { DEFAULT_HEIGHTFIELD_PARAMS, heightAtCore, normalAtCore } from '@/world/terrain/heightfieldCore'

const brush = (overrides: Partial<SculptBrush> = {}): SculptBrush => ({
  tool: 'raise',
  radius: 10,
  strength: 4,
  falloff: 'smooth',
  seed: 99,
  ...overrides
})

const flatBase = (): ((i: number, j: number) => number) => () => 0

describe('SculptField — raster read/write', () => {
  it('reads back an exact lattice value and allocates one tile', () => {
    const field = new SculptField()
    expect(field.isEmpty).toBe(true)
    field.addAt(10, 12, 3.5)
    expect(field.tileCount).toBe(1)
    expect(field.valueAt(10, 12)).toBeCloseTo(3.5, 6)
    // The interpolant is exact on the lattice.
    expect(field.sample(10, 12)).toBeCloseTo(3.5, 6)
    expect(field.sample(200, 200)).toBe(0)
  })

  it('allocates a separate tile per 64 m square, including negative ones', () => {
    const field = new SculptField()
    field.addAt(1, 1, 1)
    field.addAt(65, 1, 1)
    field.addAt(-1, -1, 1)
    expect(field.tileCount).toBe(3)
    expect(field.valueAt(-1, -1)).toBeCloseTo(1, 6)
    expect(field.valueAt(65, 1)).toBeCloseTo(1, 6)
  })

  it('returns hard zero — not an epsilon — where nothing was carved', () => {
    const field = new SculptField()
    field.addAt(0, 0, 5)
    expect(field.sample(400.37, -913.11)).toBe(0)
  })
})

describe('SculptField — continuity across a tile boundary', () => {
  // A ramp straddling x = 64 m, which is the seam between tile 0 and tile 1.
  const ramped = (): SculptField => {
    const field = new SculptField()
    for (let j = 60; j <= 68; j++) {
      for (let i = 60; i <= 68; i++) {
        field.addAt(i, j, i * 0.25)
      }
    }
    return field
  }

  it('has no value jump at the seam', () => {
    const field = ramped()
    const left = field.sample(63.999999, 64)
    const right = field.sample(64.000001, 64)
    expect(Math.abs(right - left)).toBeLessThan(1e-4)
    expect(field.sample(64, 64)).toBeCloseTo(64 * 0.25, 5)
  })

  it('walks the seam with no step larger than the neighbouring steps', () => {
    const field = ramped()
    const step = 0.01
    let previous = field.sample(62, 64)
    let maxJump = 0
    let seamJump = 0
    for (let x = 62 + step; x <= 66; x += step) {
      const value = field.sample(x, 64)
      const jump = Math.abs(value - previous)
      if (Math.abs(x - 64) < step) {
        seamJump = jump
      }
      maxJump = Math.max(maxJump, jump)
      previous = value
    }
    // A seam would show as one step several times the size of its neighbours.
    expect(seamJump).toBeLessThanOrEqual(maxJump)
    expect(maxJump).toBeLessThan(0.02)
  })

  it('is C1 at a cell boundary — the derivative does not jump', () => {
    const field = ramped()
    const slope = (x: number): number => (field.sample(x + 1e-4, 64) - field.sample(x - 1e-4, 64)) / 2e-4
    // Cell boundaries sit on the integers; the cubic fade drives the slope to
    // zero from both sides, so the two agree. Raw bilinear would not.
    expect(Math.abs(slope(64 - 1e-3) - slope(64 + 1e-3))).toBeLessThan(1e-2)
  })
})

describe('sculptFalloff', () => {
  it('runs from 1 at the centre to 0 at the rim, monotonically, for every curve', () => {
    for (const curve of SCULPT_FALLOFFS) {
      expect(sculptFalloff(curve, 0)).toBe(1)
      expect(sculptFalloff(curve, 1)).toBe(0)
      expect(sculptFalloff(curve, 1.4)).toBe(0)
      let previous = 1
      for (let i = 1; i <= 50; i++) {
        const value = sculptFalloff(curve, i / 50)
        expect(value).toBeLessThanOrEqual(previous + 1e-9)
        expect(value).toBeGreaterThanOrEqual(0)
        previous = value
      }
    }
  })

  it('separates the curves where it matters', () => {
    const half: Record<SculptFalloff, number> = {
      smooth: sculptFalloff('smooth', 0.5),
      linear: sculptFalloff('linear', 0.5),
      sharp: sculptFalloff('sharp', 0.5),
      plateau: sculptFalloff('plateau', 0.5)
    }
    expect(half.plateau).toBe(1)
    expect(half.sharp).toBeLessThan(half.linear)
    expect(half.smooth).toBeCloseTo(0.5, 6)
  })
})

describe('brush tools', () => {
  it('raise lifts the centre by strength·dt and tapers to nothing at the rim', () => {
    const field = new SculptField()
    applyDab(field, brush({ radius: 10, strength: 4 }), { x: 0, z: 0, dt: 0.5, target: 0 }, flatBase())
    expect(field.valueAt(0, 0)).toBeCloseTo(2, 5)
    expect(field.valueAt(5, 0)).toBeCloseTo(2 * sculptFalloff('smooth', 0.5), 5)
    expect(field.valueAt(10, 0)).toBe(0)
    expect(field.valueAt(14, 0)).toBe(0)
  })

  it('lower is the exact negation of raise', () => {
    const up = new SculptField()
    const down = new SculptField()
    applyDab(up, brush({ tool: 'raise' }), { x: 3, z: -7, dt: 0.25, target: 0 }, flatBase())
    applyDab(down, brush({ tool: 'lower' }), { x: 3, z: -7, dt: 0.25, target: 0 }, flatBase())
    for (let i = -6; i <= 12; i++) {
      expect(down.valueAt(i, -7)).toBeCloseTo(-up.valueAt(i, -7), 6)
    }
  })

  it('flatten converges on the target from either side', () => {
    const base = (i: number): number => (i < 0 ? -6 : 6)
    const field = new SculptField()
    for (let n = 0; n < 60; n++) {
      applyDab(field, brush({ tool: 'flatten', strength: 4, radius: 10 }), { x: 0, z: 0, dt: 0.1, target: 1 }, base)
    }
    expect(base(-3) + field.valueAt(-3, 0)).toBeCloseTo(1, 2)
    expect(base(3) + field.valueAt(3, 0)).toBeCloseTo(1, 2)
    // Outside the brush the surface is untouched.
    expect(field.valueAt(30, 0)).toBe(0)
  })

  it('smooth reduces the roughness of a corrugated surface', () => {
    const base = (i: number, j: number): number => (((i + j) % 2 === 0 ? 1 : -1) * 3)
    const field = new SculptField()
    const roughness = (): number => {
      let sum = 0
      for (let j = -4; j <= 4; j++) {
        for (let i = -4; i <= 4; i++) {
          sum += Math.abs(base(i, j) + field.valueAt(i, j))
        }
      }
      return sum
    }
    const before = roughness()
    for (let n = 0; n < 30; n++) {
      applyDab(field, brush({ tool: 'smooth', strength: 5, radius: 12 }), { x: 0, z: 0, dt: 0.1, target: 0 }, base)
    }
    expect(roughness()).toBeLessThan(before * 0.25)
  })

  it('roughen adds bounded, deterministic, coherent offsets', () => {
    const a = new SculptField()
    const b = new SculptField()
    const dab = { x: 0, z: 0, dt: 0.5, target: 0 }
    applyDab(a, brush({ tool: 'noise', strength: 3, radius: 12 }), dab, flatBase())
    applyDab(b, brush({ tool: 'noise', strength: 3, radius: 12 }), dab, flatBase())

    let peak = 0
    let nonZero = 0
    for (let j = -12; j <= 12; j++) {
      for (let i = -12; i <= 12; i++) {
        expect(b.valueAt(i, j)).toBe(a.valueAt(i, j))
        peak = Math.max(peak, Math.abs(a.valueAt(i, j)))
        if (a.valueAt(i, j) !== 0) {
          nonZero++
        }
      }
    }
    expect(nonZero).toBeGreaterThan(100)
    // strength · dt · falloff(0) is the ceiling.
    expect(peak).toBeLessThanOrEqual(3 * 0.5 + 1e-6)
  })

  it('ignores a zero-length dab', () => {
    const field = new SculptField()
    expect(applyDab(field, brush(), { x: 0, z: 0, dt: 0, target: 0 }, flatBase())).toBe(false)
    expect(field.isEmpty).toBe(true)
  })
})

describe('undo', () => {
  const sampleRow = (field: SculptField): number[] => {
    const out: number[] = []
    for (let i = -40; i <= 40; i++) {
      out.push(field.sample(i * 1.37, 3.9))
    }
    return out
  }

  it('restores the field bit-for-bit, including tiles that did not exist', () => {
    const field = new SculptField()
    // A first stroke, so undo has to restore *content* as well as absence.
    field.beginStroke()
    applyDab(field, brush({ radius: 20 }), { x: 0, z: 0, dt: 0.5, target: 0 }, flatBase())
    field.endStroke()

    const before = sampleRow(field)
    const tilesBefore = field.tileCount

    field.beginStroke()
    for (let n = 0; n < 10; n++) {
      applyDab(field, brush({ tool: 'lower', radius: 30 }), { x: n * 8, z: 0, dt: 0.2, target: 0 }, flatBase())
    }
    const record = field.endStroke()
    expect(record).not.toBeNull()
    expect(field.tileCount).toBeGreaterThan(tilesBefore)
    expect(sampleRow(field)).not.toEqual(before)

    field.restore(record!)
    expect(sampleRow(field)).toEqual(before)
    expect(field.tileCount).toBe(tilesBefore)
  })

  it('undoes a clear-all back to the exact surface', () => {
    const field = new SculptField()
    applyDab(field, brush({ radius: 24 }), { x: 12, z: -30, dt: 0.4, target: 0 }, flatBase())
    const before = sampleRow(field)
    const record = field.clear()
    expect(field.isEmpty).toBe(true)
    field.restore(record!)
    expect(sampleRow(field)).toEqual(before)
  })

  it('reports no record for a stroke that changed nothing', () => {
    const field = new SculptField()
    field.beginStroke()
    expect(field.endStroke()).toBeNull()
  })
})

describe('worker transport', () => {
  it('rebuilds an identical field from patches — the main thread and the worker agree', () => {
    const main = new SculptField()
    const worker = new SculptField()

    for (let n = 0; n < 6; n++) {
      applyDab(main, brush({ radius: 18 }), { x: n * 20 - 50, z: n * 7, dt: 0.3, target: 0 }, flatBase())
      const patch = main.takePatch()
      expect(patch).not.toBeNull()
      expect(worker.applyPatch(patch!)).toBe(true)
    }
    expect(main.takePatch()).toBeNull()

    for (let z = -60; z <= 60; z += 3.7) {
      for (let x = -80; x <= 80; x += 4.3) {
        expect(worker.sample(x, z)).toBe(main.sample(x, z))
      }
    }
  })

  it('carries a tile deletion so an undo on the main thread reaches the worker', () => {
    const main = new SculptField()
    const worker = new SculptField()
    main.beginStroke()
    applyDab(main, brush({ radius: 12 }), { x: 0, z: 0, dt: 0.3, target: 0 }, flatBase())
    const record = main.endStroke()!
    worker.applyPatch(main.takePatch()!)
    // Four: the brush sits on the origin, which is the corner where four tiles
    // meet — exactly the case a duplicated border ring would have to keep in
    // step, and the reason there isn't one.
    expect(worker.tileCount).toBe(4)

    main.restore(record)
    worker.applyPatch(main.takePatch()!)
    expect(worker.tileCount).toBe(0)
    expect(worker.sample(0, 0)).toBe(0)
  })

  it('refuses a patch with a different lattice rather than misplacing it', () => {
    const field = new SculptField()
    expect(field.applyPatch({ cellSize: 2, tileCells: 64, tiles: [] })).toBe(false)
  })
})

describe('persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips through localStorage within the 1 cm quantum', () => {
    const field = new SculptField()
    applyDab(field, brush({ radius: 22, strength: 6 }), { x: 30, z: -18, dt: 0.5, target: 0 }, flatBase())
    applyDab(field, brush({ tool: 'lower', radius: 14 }), { x: -70, z: 40, dt: 0.4, target: 0 }, flatBase())

    const text = serialiseSculpt(field)
    expect(text).not.toBeNull()
    localStorage.setItem(SCULPT_STORE_KEY, text!)

    const restored = parseSculpt(localStorage.getItem(SCULPT_STORE_KEY))
    expect(restored.tileCount).toBe(field.tileCount)
    for (let z = -60; z <= 60; z += 5.3) {
      for (let x = -90; x <= 60; x += 6.1) {
        expect(restored.sample(x, z)).toBeCloseTo(field.sample(x, z), 2)
      }
    }
  })

  it('stores nothing for an unsculpted field, and drops tiles erased back to flat', () => {
    const field = new SculptField()
    expect(serialiseSculpt(field)).toBeNull()
    field.addAt(4, 4, 0.0001)
    expect(serialiseSculpt(field)).toBeNull()
  })

  it('loads a malformed, truncated or foreign store as empty', () => {
    expect(parseSculpt(null).isEmpty).toBe(true)
    expect(parseSculpt('').isEmpty).toBe(true)
    expect(parseSculpt('{ not json').isEmpty).toBe(true)
    expect(parseSculpt('[1,2,3]').isEmpty).toBe(true)
    expect(parseSculpt(JSON.stringify({ v: 99, cell: 1, tile: 64, tiles: [] })).isEmpty).toBe(true)
    expect(parseSculpt(JSON.stringify({ v: 1, cell: 4, tile: 64, tiles: [] })).isEmpty).toBe(true)
    expect(
      parseSculpt(JSON.stringify({ v: 1, cell: 1, tile: 64, tiles: [{ x: 0, z: 0, d: 'AAAA' }] })).isEmpty
    ).toBe(true)
    expect(
      parseSculpt(JSON.stringify({ v: 1, cell: 1, tile: 64, tiles: [{ x: 'a', z: 0, d: 'AAAA' }] })).isEmpty
    ).toBe(true)
  })
})

describe('heightAtCore with a delta attached', () => {
  it('is bit-identical away from any edit', () => {
    const field = new SculptField()
    applyDab(field, brush({ radius: 30, strength: 8 }), { x: 0, z: 0, dt: 0.6, target: 0 }, flatBase())

    const plain = { ...DEFAULT_HEIGHTFIELD_PARAMS }
    const sculpted = { ...DEFAULT_HEIGHTFIELD_PARAMS, delta: field }

    const normalA = new Float32Array(3)
    const normalB = new Float32Array(3)
    for (let z = -400; z <= 400; z += 37) {
      for (let x = -400; x <= 400; x += 41) {
        if (Math.hypot(x, z) < 80) {
          continue
        }
        // Bit-identical, not "close": installing the editor must not shift
        // ground nobody touched, or every chunk in the world becomes dirty.
        expect(heightAtCore(x, z, sculpted)).toBe(heightAtCore(x, z, plain))
        normalAtCore(x, z, sculpted, normalA)
        normalAtCore(x, z, plain, normalB)
        expect([...normalA]).toEqual([...normalB])
      }
    }
  })

  it('adds the offset on top of the spawn damping, not underneath it', () => {
    const field = new SculptField()
    for (let j = -6; j <= 6; j++) {
      for (let i = -6; i <= 6; i++) {
        field.addAt(i, j, 10)
      }
    }
    const plain = { ...DEFAULT_HEIGHTFIELD_PARAMS }
    const sculpted = { ...DEFAULT_HEIGHTFIELD_PARAMS, delta: field }
    // Inside `plainRadius`, where the base height is damped to 35 %. The full
    // 10 m must arrive, or the editor appears to eat two thirds of every edit.
    expect(heightAtCore(0, 0, sculpted) - heightAtCore(0, 0, plain)).toBeCloseTo(10, 6)
  })

  it('moves the surface by what was painted', () => {
    const field = new SculptField()
    const params = { ...DEFAULT_HEIGHTFIELD_PARAMS, delta: field }
    const before = heightAtCore(120, -60, params)
    applyDab(field, brush({ radius: 16, strength: 5 }), { x: 120, z: -60, dt: 1, target: 0 }, flatBase())
    expect(heightAtCore(120, -60, params) - before).toBeCloseTo(5, 4)
  })
})

describe('createBaseGridCache', () => {
  it('memoises by lattice index and scales to world metres', () => {
    let calls = 0
    const cache = createBaseGridCache((x, z) => {
      calls++
      return x * 100 + z
    }, 2)
    expect(cache(3, 5)).toBe(3 * 2 * 100 + 5 * 2)
    expect(cache(3, 5)).toBe(3 * 2 * 100 + 5 * 2)
    expect(calls).toBe(1)
    expect(cache(-3, -5)).toBe(-3 * 2 * 100 - 5 * 2)
    expect(calls).toBe(2)
  })
})

describe('measurement — smooth brush dab cost', () => {
  it('reports base-height misses and dab time', () => {
    const field = new SculptField()
    let misses = 0
    const cache = createBaseGridCache((x, z) => {
      misses++
      return heightAtCore(x, z, DEFAULT_HEIGHTFIELD_PARAMS)
    }, field.cellSize)

    const dabAt = (radius: number, n: number): { ms: number; misses: number } => {
      const start = misses
      const t0 = performance.now()
      for (let k = 0; k < n; k++) {
        applyDab(field, brush({ tool: 'smooth', radius, strength: 4 }), { x: 0, z: 0, dt: 0.016, target: 0 }, cache)
      }
      return { ms: (performance.now() - t0) / n, misses: misses - start }
    }

    const first24 = dabAt(24, 1)
    const rest24 = dabAt(24, 20)
    const first48 = dabAt(48, 1)
    const rest48 = dabAt(48, 20)
    console.log(
      JSON.stringify({ first24, rest24, first48, rest48 })
    )
    expect(rest24.misses).toBe(0)
  })
})
