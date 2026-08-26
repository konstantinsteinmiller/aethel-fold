import { type BufferGeometry, Color, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { buildChibiGeometry } from '@/world/characters/chibiGeometry'
import { DEFAULT_APPEARANCE, EQUIPMENT_BUDGET, ITEM_SLOT, type ItemKind } from '@/world/characters/equipment'
import { gearModel } from '@/world/characters/gear'
import { sleeveColourForItem } from '@/world/characters/gear/garments'
import { DYES, HIPS_Y } from '@/world/characters/gear/garmentKit'
import { windingDisagreements } from '@/world/characters/gear/gearKit'
import { legPairTriangles } from '@/world/characters/gear/legKit'
import { WANDERER_BUDGET, WANDERER_WAYS, buildTallBoots, buildWanderersCoat } from '@/world/characters/gear/wanderer'
import { BUILDS } from '@/world/characters/variants'
import { triangleCount } from '@/world/geometry/budget'

/**
 * ─── The road coat and the tall boots ───────────────────────────────────────
 *
 * The contract every model in `gear/` is held to — inside its budget and not
 * trivially under it, finite, unit normals, outward winding, closed, never
 * black, deterministic in its seed and varying only in albedo — plus the four
 * claims these two make that nothing else in the folder does:
 *
 *   1. the crossed straps are **geometry** and stand proud of the coat,
 *   2. the boot cuff is a **fold** — two faces, not a step,
 *   3. the coat is never narrower than the torso it replaces,
 *   4. `sleeveColourForItem` answers for the coat, which lives in a different
 *      file from the nine it was written for.
 */

const KINDS = ['wanderersCoat', 'tallBoots'] as const
type Kind = (typeof KINDS)[number]

const BUILDERS: Record<Kind, (options?: { seed?: number }) => ReturnType<typeof buildWanderersCoat>> = {
  wanderersCoat: buildWanderersCoat,
  tallBoots: buildTallBoots
}

const models = new Map(KINDS.map(kind => [kind, BUILDERS[kind]({ seed: 1 })]))

const authoredLuma = (r: number, g: number, b: number): number => {
  const colour = new Color(r, g, b).convertLinearToSRGB()
  return 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b
}

const darkest = (geometry: BufferGeometry): number => {
  const colour = geometry.getAttribute('color')
  let worst = 1
  for (let i = 0; i < colour.count; i++) {
    worst = Math.min(worst, authoredLuma(colour.getX(i), colour.getY(i), colour.getZ(i)))
  }
  return worst
}

/**
 * ─── Welding, and why every edge test in this folder needs it ───────────────
 *
 * `sweep` closes its section by **repeating the first column of vertices at the
 * end**, so the seam of a swept solid is two coincident vertex rings with
 * different indices. An edge test keyed on indices therefore reports the whole
 * seam as unshared — 80 edges on the coat, 64 on the boots — on geometry that is
 * perfectly closed. Position, rounded to a tenth of a millimetre, is the key
 * that tells the truth.
 */
const weld = (geometry: BufferGeometry): number[] => {
  const position = geometry.getAttribute('position')
  const ids = new Map<string, number>()
  const of: number[] = []
  for (let i = 0; i < position.count; i++) {
    const key = `${Math.round(position.getX(i) * 1e4)}:${Math.round(position.getY(i) * 1e4)}:${Math.round(position.getZ(i) * 1e4)}`
    let id = ids.get(key)
    if (id === undefined) {
      id = ids.size
      ids.set(key, id)
    }
    of.push(id)
  }
  return of
}

/** Every edge shared exactly twice — the closed-solid test the folder uses. */
const openEdges = (geometry: BufferGeometry): number => {
  const index = geometry.getIndex()!
  const of = weld(geometry)
  const seen = new Map<string, number>()
  for (let f = 0; f < index.count; f += 3) {
    const tri = [of[index.getX(f)]!, of[index.getX(f + 1)]!, of[index.getX(f + 2)]!]
    for (let e = 0; e < 3; e++) {
      const a = tri[e]!
      const b = tri[(e + 1) % 3]!
      if (a === b) {
        continue
      }
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
  }
  let open = 0
  for (const count of seen.values()) {
    if (count !== 2) {
      open++
    }
  }
  return open
}

/**
 * The model's connected components, as lists of welded vertex ids.
 *
 * A `GearModel` is one merged geometry, so this is the only way from outside the
 * builder to say "the coat is a body **and two straps**" rather than "the coat
 * is 420 triangles of something".
 */
const components = (geometry: BufferGeometry): number[][] => {
  const index = geometry.getIndex()!
  const of = weld(geometry)
  const parent: number[] = []
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!
      a = parent[a]!
    }
    return a
  }
  for (const id of of) {
    while (parent.length <= id) {
      parent.push(parent.length)
    }
  }
  for (let f = 0; f < index.count; f += 3) {
    const a = find(of[index.getX(f)]!)
    const b = find(of[index.getX(f + 1)]!)
    const c = find(of[index.getX(f + 2)]!)
    parent[b] = a
    parent[find(c)] = a
  }
  const groups = new Map<number, number[]>()
  for (let i = 0; i < of.length; i++) {
    const root = find(of[i]!)
    const list = groups.get(root)
    if (list) {
      list.push(i)
    } else {
      groups.set(root, [i])
    }
  }
  return [...groups.values()].sort((a, b) => b.length - a.length)
}

// ─── The shared contract ────────────────────────────────────────────────────

describe.each(KINDS)('%s', kind => {
  const model = models.get(kind)!

  it('agrees with `EQUIPMENT_BUDGET`, which is the one this file cannot edit', () => {
    expect(WANDERER_BUDGET[kind]).toBe(EQUIPMENT_BUDGET[kind as ItemKind])
  })

  it('sits in the slot it says it does', () => {
    expect(ITEM_SLOT[kind as ItemKind]).toBe(kind === 'wanderersCoat' ? 'torso' : 'legs')
  })

  it('stays inside its budget, and is not trivially small', () => {
    const count = triangleCount(model.geometry)
    expect(count, `${kind} triangles`).toBeLessThanOrEqual(WANDERER_BUDGET[kind])
    // The folder's own rule: a budget that a model uses less than 55 % of is a
    // ceiling nobody is aiming at.
    expect(count).toBeGreaterThan(WANDERER_BUDGET[kind] * 0.55)
  })

  it('emits only finite floats', () => {
    for (const name of ['position', 'normal', 'color'] as const) {
      const attribute = model.geometry.getAttribute(name)
      for (let i = 0; i < attribute.count * attribute.itemSize; i++) {
        expect(Number.isFinite(attribute.array[i]), `${name}[${i}]`).toBe(true)
      }
    }
  })

  it('carries unit-length authored normals', () => {
    const normal = model.geometry.getAttribute('normal')
    for (let i = 0; i < normal.count; i++) {
      expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)), `vertex ${i}`).toBeCloseTo(1, 4)
    }
  })

  it('winds every face outward', () => {
    expect(windingDisagreements(model.geometry), `${kind} bad faces`).toBe(0)
  })

  it('is a closed solid', () => {
    expect(openEdges(model.geometry), `${kind} unshared edges`).toBe(0)
  })

  it('is never black, in any colourway (GDD R4)', () => {
    for (let seed = 0; seed < 6; seed++) {
      expect(darkest(BUILDERS[kind]({ seed }).geometry), `${kind} seed ${seed}`).toBeGreaterThan(0.06)
    }
  })

  it('is deterministic in shape and in colour for a given seed', () => {
    for (const seed of [0, 1, 4]) {
      const a = BUILDERS[kind]({ seed }).geometry
      const b = BUILDERS[kind]({ seed }).geometry
      expect(Array.from(a.getAttribute('position').array)).toEqual(Array.from(b.getAttribute('position').array))
      expect(Array.from(a.getAttribute('color').array)).toEqual(Array.from(b.getAttribute('color').array))
    }
  })

  it('varies albedo with the seed but never shape', () => {
    // `finishGear`'s contract: the seed reaches the albedo and nothing else.
    const base = BUILDERS[kind]({ seed: 1 }).geometry
    let differed = 0
    for (let seed = 0; seed < 5; seed++) {
      const other = BUILDERS[kind]({ seed }).geometry
      expect(Array.from(other.getAttribute('position').array)).toEqual(Array.from(base.getAttribute('position').array))
      if (
        Array.from(other.getAttribute('color').array).join() !== Array.from(base.getAttribute('color').array).join()
      ) {
        differed++
      }
    }
    expect(differed, 'colourways that differ from seed 1').toBeGreaterThan(2)
  })

  it('has a colourway table that fits `GEAR_SEED_SPACE`', () => {
    const ways = WANDERER_WAYS[kind]
    expect(ways.length).toBeGreaterThan(2)
    expect(ways.length).toBeLessThanOrEqual(6)
  })
})

// ─── The claims these two make and nothing else does ────────────────────────

describe('the crossed straps are geometry, not paint', () => {
  const coat = models.get('wanderersCoat')!
  const parts = components(coat.geometry)
  const position = coat.geometry.getAttribute('position')
  const at = (i: number): Vector3 => new Vector3(position.getX(i), position.getY(i) + HIPS_Y, position.getZ(i))

  it('costs 120 triangles more than the body alone', () => {
    // 300 for the body (17 stations x 10 segments, both end rings collapsed) and
    // 60 for each strap (8 x 5, likewise). If this number changes, so has one of
    // the three, and the comment above `COAT_US` says which rings are load-bearing.
    expect(triangleCount(coat.geometry)).toBe(420)
  })

  it('is three closed solids: a coat and two straps', () => {
    // The claim `STRAP_PATH` makes, stated in the only form that is checkable
    // from outside the builder. Painted straps would leave one component.
    expect(parts.length, 'connected components').toBe(3)
    expect(parts[1]!.length, 'strap vertex count').toBe(parts[2]!.length)
  })

  it('each strap runs from one shoulder to the opposite hip', () => {
    // Which is what makes the pair an X rather than a V: a strap that stayed on
    // its own side of the midline would be a brace.
    for (const strap of [parts[1]!, parts[2]!]) {
      const points = strap.map(at)
      const high = points.filter(p => p.y > 0.94)
      const low = points.filter(p => p.y < 0.79)
      expect(high.length, 'vertices up at the shoulder').toBeGreaterThan(2)
      expect(low.length, 'vertices down at the hip').toBeGreaterThan(2)
      const highX = high.reduce((sum, p) => sum + p.x, 0) / high.length
      const lowX = low.reduce((sum, p) => sum + p.x, 0) / low.length
      expect(Math.sign(highX), 'the two ends are on opposite sides').not.toBe(Math.sign(lowX))
      expect(Math.abs(highX)).toBeGreaterThan(0.05)
      expect(Math.abs(lowX)).toBeGreaterThan(0.05)
    }
  })

  it('the two are mirror images in X', () => {
    const left = parts[1]!.map(at)
    const right = parts[2]!.map(at)
    const key = (p: Vector3): string => `${Math.round(p.y * 1e4)}:${Math.round(p.z * 1e4)}:${Math.round(Math.abs(p.x) * 1e4)}`
    expect(new Set(left.map(key))).toEqual(new Set(right.map(key)))
  })

  it('stands proud of the coat it is worn over', () => {
    // The whole point of `STRAP_PATH`'s measured stand-off: the strap's face is
    // outside the wool while its back stays inside it, which is what stops it
    // reading as a floating hoop. Compared at the same height and the same side,
    // against the coat's own component.
    const body = parts[0]!.map(at)
    let worst = Infinity
    for (const strap of [parts[1]!, parts[2]!]) {
      for (const p of strap.map(at)) {
        if (p.y < 0.8 || p.y > 0.95 || Math.abs(p.x) < 0.03) {
          continue
        }
        let coatFront = -Infinity
        for (const q of body) {
          if (Math.abs(q.y - p.y) < 0.03 && Math.abs(q.x - p.x) < 0.03) {
            coatFront = Math.max(coatFront, q.z)
          }
        }
        if (coatFront > -1) {
          worst = Math.min(worst, p.z - coatFront)
        }
      }
    }
    // Every strap vertex in the band is at worst level with the wool — its back
    // half is *supposed* to be inside — and the face stands clear.
    expect(worst, 'worst strap vertex against the coat under it').toBeGreaterThan(-0.02)
    const proudest = Math.max(...[...parts[1]!, ...parts[2]!].map(i => at(i).z))
    const coatProudest = Math.max(...body.filter(p => Math.abs(p.x) > 0.03).map(p => p.z))
    expect(proudest, 'the strap face against the coat beside it').toBeGreaterThan(coatProudest + 0.01)
  })
})

describe('the boot cuff is a fold, not a step', () => {
  const boots = models.get('tallBoots')!

  it('costs exactly what the leg-pair formula says', () => {
    expect(triangleCount(boots.geometry)).toBe(legPairTriangles(15))
  })

  it('has two faces, one rising into the crest and one falling out of it', () => {
    // A step has one face; a fold has two, and that is the whole difference
    // between this and `rolledTrousers`. Measured as the *outboard reach* of the
    // left leg at each ring — a ring lookup rather than a fixed grid, because
    // `BOOT_US` deliberately does not put rings on a fixed grid.
    const position = boots.geometry.getAttribute('position')
    const rings: { y: number; x: number }[] = []
    const seen = new Map<number, number>()
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      if (x < 0.02) {
        continue
      }
      const band = Math.round((position.getY(i) + HIPS_Y) * 1000)
      seen.set(band, Math.max(seen.get(band) ?? 0, x))
    }
    for (const [band, x] of seen) {
      rings.push({ y: band / 1000, x })
    }
    rings.sort((a, b) => a.y - b.y)

    const crest = rings.reduce((best, ring) => (ring.x > best.x ? ring : best), rings[0]!)
    // Measured: the crest is at y = 0.294 and reaches 0.2099 outboard, against
    // 0.1985 at the shaft below (y = 0.250) and 0.1897 at the trouser above
    // (y = 0.356). Two faces, 11 mm and 20 mm of turn, over 106 mm of leg.
    expect(crest.y, 'the crest sits under the knee').toBeGreaterThan(0.26)
    expect(crest.y).toBeLessThan(0.32)

    const below = rings.filter(r => r.y < crest.y - 0.02 && r.y > crest.y - 0.08)
    const above = rings.filter(r => r.y > crest.y + 0.02 && r.y < crest.y + 0.1)
    expect(below.length, 'rings below the crest').toBeGreaterThan(0)
    expect(above.length, 'rings above it').toBeGreaterThan(0)
    expect(crest.x - Math.max(...below.map(r => r.x)), 'the fold turns back in below').toBeGreaterThan(0.008)
    expect(crest.x - Math.max(...above.map(r => r.x)), 'and in above').toBeGreaterThan(0.008)
  })

  it('stays inside `rolledTrousers`, which owns the "widest in the set" claim', () => {
    const position = boots.geometry.getAttribute('position')
    let widest = 0
    for (let i = 0; i < position.count; i++) {
      widest = Math.max(widest, Math.abs(position.getX(i)))
    }
    const rolled = gearModel('rolledTrousers', 1).geometry.getAttribute('position')
    let rolledWidest = 0
    for (let i = 0; i < rolled.count; i++) {
      rolledWidest = Math.max(rolledWidest, Math.abs(rolled.getX(i)))
    }
    expect(widest, 'tall boots').toBeLessThan(rolledWidest)
  })
})

describe('the coat is never narrower than the torso it replaces', () => {
  it.each(['male', 'female'] as const)('%s build', sex => {
    // The floor every torso garment in the folder is held to: inside the torso
    // it replaces, a garment reads as a corset with the arms and neck hanging
    // off it. The shipped torso is `hipRadius → chestRadius` scaled by
    // `torsoCrossSection`, and the coat has to clear its widest ring.
    const build = BUILDS[sex]
    const torsoHalfWidth = build.chestRadius * build.torsoCrossSection[1]
    const torsoHalfDepth = build.chestRadius * build.torsoCrossSection[0]

    const position = models.get('wanderersCoat')!.geometry.getAttribute('position')
    let widest = 0
    let deepest = 0
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i) + HIPS_Y
      if (y < 0.85 || y > 0.99) {
        continue
      }
      widest = Math.max(widest, Math.abs(position.getX(i)))
      deepest = Math.max(deepest, Math.abs(position.getZ(i)))
    }
    expect(widest, `${sex} chest half-width`).toBeGreaterThan(torsoHalfWidth)
    expect(deepest, `${sex} chest half-depth`).toBeGreaterThan(torsoHalfDepth)
  })
})

describe('the sleeves match the coat', () => {
  it('answers for a torso garment that does not live in `garments.ts`', () => {
    // The failure this prevents is the one the browser found and no geometric
    // test could: a grey coat arriving with two woad-blue shoulder caps on it.
    for (let seed = 0; seed < 6; seed++) {
      const index = sleeveColourForItem('wanderersCoat', seed)
      expect(index, `seed ${seed}`).not.toBeNull()
      expect(index).toBe(WANDERER_WAYS.wanderersCoat[seed % 6]!.cloth.tunicIndex)
    }
  })

  it('still answers null for a kind with no sleeves', () => {
    expect(sleeveColourForItem('sword')).toBeNull()
    expect(sleeveColourForItem('tallBoots')).toBeNull()
  })
})

describe('the two new dyes', () => {
  it('are darker than everything that came before and still clear GDD R4', () => {
    const charcoal = DYES.charcoal
    expect(authoredLuma(charcoal.shadow.r, charcoal.shadow.g, charcoal.shadow.b)).toBeGreaterThan(0.06)
    // Monotone: lit brighter than base brighter than shadow. A ramp that is not
    // is a garment whose "shadow" is its highlight.
    const luma = (colour: Color): number => authoredLuma(colour.r, colour.g, colour.b)
    for (const dye of [DYES.charcoal, DYES.brass]) {
      expect(luma(dye.lit), `${dye.name} lit`).toBeGreaterThan(luma(dye.base))
      expect(luma(dye.base), `${dye.name} base`).toBeGreaterThan(luma(dye.shadow))
    }
    // And charcoal really is the darkest cloth in the table.
    for (const dye of Object.values(DYES)) {
      expect(luma(DYES.charcoal.shadow), `charcoal vs ${dye.name}`).toBeLessThanOrEqual(luma(dye.shadow) + 1e-9)
    }
  })
})

describe('a dressed wanderer is a whole figure', () => {
  it('builds with the coat and the boots substituted in, inside the ceiling', () => {
    const built = buildChibiGeometry(
      undefined,
      'test/wanderer',
      { ...DEFAULT_APPEARANCE, beard: 'patriarch', brows: 'bushy', nose: 'round', hair: 'wild', gearSeed: 1 },
      gearModel('wanderersCoat', 1).geometry,
      gearModel('tallBoots', 1).geometry
    )
    expect(triangleCount(built.geometry)).toBeGreaterThan(1500)
    const position = built.geometry.getAttribute('position')
    for (let i = 0; i < position.count * 3; i++) {
      expect(Number.isFinite(position.array[i])).toBe(true)
    }
    // The feet still exist: a leg garment replaces the thigh and the shin, never
    // the `foot` part, and a boot that swallowed it would leave the figure
    // standing on stumps.
    let lowest = Infinity
    for (let i = 0; i < position.count; i++) {
      lowest = Math.min(lowest, position.getY(i))
    }
    expect(lowest).toBeLessThan(0.02)
  })
})

// Kept honest: the sweep's own vector type is what the strap path is authored in.
export type _Unused = Vector3
