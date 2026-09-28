import { describe, expect, it } from 'vitest'
import { Heightfield } from '@/world/terrain/heightfield'
import { packWaterBodies, setWaterTable, shoreHeightAbove } from '@/world/terrain/waterLevel'
import { SHORE_BAND, scatterChunkSet, type ScatterSpeciesPlan } from '@/world/scatter'
import { ScatterColliderIndex } from '@/world/scatterColliders'
import { createCollisionWorld } from '@/world/player/collision'
import type { InstanceTransform } from '@/world/lod/InstancedLodField'

/**
 * ─── Three things a player reported, and none of them typechecked wrong ─────
 *
 * 1. Trees and rocks grew **in the sea** off the storyteller's island, trunks
 *    submerged, out to the horizon. `minHeight` was a single world constant and
 *    the chapter has two bodies of water 1.7 km and 3.7 m apart.
 * 2. Boulders stood inside canopies and stones half inside other stones,
 *    because every species sampled its own jittered grid with no knowledge of
 *    the others.
 * 3. Nothing in `/story` collided. The scatter collider index was populated and
 *    correct; the thing that fed it into the collision world lived in
 *    `World.frame()`'s `firstPerson` branch, and the chapter runs the `story`
 *    branch.
 *
 * Each section below fails on the code as it shipped.
 */

const field = new Heightfield({ seed: 4711 })

/** Three species close enough in spacing to fight over the same ground. */
const plan = (): ScatterSpeciesPlan[] => [
  {
    footprint: 0.95,
    options: { spacing: 12, seed: 700, maxSlope: 0.5, clusterSize: 140, clusterThreshold: 0.42, scaleRange: [0.7, 1.5] }
  },
  {
    footprint: 0.45,
    options: { spacing: 10, seed: 300, maxSlope: 0.34, clusterSize: 130, clusterThreshold: 0.42, scaleRange: [0.82, 1.3] }
  },
  {
    footprint: 0.42,
    options: { spacing: 7, seed: 900, maxSlope: 0.55, clusterSize: 60, clusterThreshold: 0.44, scaleRange: [0.6, 1.4] }
  }
]

/** Copies a batch out, since the resolver hands back pooled objects. */
const snapshot = (batch: InstanceTransform[][]): InstanceTransform[][] =>
  batch.map(list => list.map(t => ({ ...t })))

const place = (species: ScatterSpeciesPlan[], cx: number, cz: number): InstanceTransform[][] => {
  const batch: InstanceTransform[][] = species.map(() => [])
  scatterChunkSet(field, species, cx * 48, cz * 48, 48, batch)
  return snapshot(batch)
}

describe('nothing grows in the water', () => {
  const bodies = [{ minX: -200, maxX: 200, minZ: -200, maxZ: 200, y: 6 }]
  const shoreAbove = (x: number, z: number, height: number): number => shoreHeightAbove(x, z, height, 4711)

  it('places nothing below the waterline or in the shore band', () => {
    setWaterTable(packWaterBodies(bodies))
    try {
      const species = plan().map(entry => ({ ...entry, options: { ...entry.options, shoreAbove } }))
      const batch = place(species, 3, 3)
      const placed = batch.flat()

      // The point of the fixture: a y = 6 surface over ground that is mostly
      // below it, so a rejection that did nothing would leave hundreds standing.
      expect(placed.every(t => shoreAbove(t.x, t.z, field.heightAt(t.x, t.z)) >= SHORE_BAND)).toBe(true)
    } finally {
      setWaterTable(new Float32Array(0))
    }
  })

  it('is inert with no water table, so Meadowfall is untouched', () => {
    setWaterTable(new Float32Array(0))
    const dry = place(plan(), 3, 3)
    const withSampler = place(
      plan().map(entry => ({ ...entry, options: { ...entry.options, shoreAbove } })),
      3,
      3
    )
    expect(withSampler).toEqual(dry)
  })

  it('a single world constant could not have done this', () => {
    // The shape of the shipped bug. Two bodies at different heights: a
    // `minHeight` high enough to keep props out of the deep one strips the
    // shallow one's whole valley, and one low enough for the valley leaves the
    // deep one forested.
    setWaterTable(
      packWaterBodies([
        { minX: -400, maxX: -100, minZ: -400, maxZ: 400, y: 8 },
        { minX: 100, maxX: 400, minZ: -400, maxZ: 400, y: -6 }
      ])
    )
    try {
      expect(shoreHeightAbove(-200, 0, 8.2, 4711)).toBeLessThan(1)
      expect(shoreHeightAbove(200, 0, 8.2, 4711)).toBeGreaterThan(10)
    } finally {
      setWaterTable(new Float32Array(0))
    }
  })
})

describe('no two props stand in the same place', () => {
  /** Every pair across every species, as (distance, minimum allowed). */
  const violations = (
    species: ScatterSpeciesPlan[],
    batches: { list: InstanceTransform[]; footprint: number }[]
  ): number => {
    void species
    let bad = 0
    for (let a = 0; a < batches.length; a++) {
      for (let b = a; b < batches.length; b++) {
        const first = batches[a]!
        const second = batches[b]!
        for (let i = 0; i < first.list.length; i++) {
          for (let j = b === a ? i + 1 : 0; j < second.list.length; j++) {
            const p = first.list[i]!
            const q = second.list[j]!
            const reach = first.footprint * p.scale + second.footprint * q.scale
            const dx = p.x - q.x
            const dz = p.z - q.z
            if (dx * dx + dz * dz < reach * reach - 1e-9) {
              bad++
            }
          }
        }
      }
    }
    return bad
  }

  const flatten = (species: ScatterSpeciesPlan[], batch: InstanceTransform[][]) =>
    species.map((entry, i) => ({ list: batch[i]!, footprint: entry.footprint }))

  it('resolves every species against every other, not each against itself', () => {
    // A chunk with a wood in it — chunk (0, 0) of this seed holds five props
    // and would pass by having nothing to resolve.
    const species = plan()
    const batch = place(species, -3, -3)
    expect(batch.flat().length).toBeGreaterThan(50)
    expect(violations(species, flatten(species, batch))).toBe(0)
  })

  it('holds across a chunk boundary', () => {
    // The case a per-chunk pass gets wrong however careful it is inside one
    // chunk: a tree 30 cm inside the boundary and a boulder just outside it are
    // resolved by two different invocations.
    const species = plan()
    const left = place(species, -3, 2)
    const right = place(species, -2, 2)
    const joined = species.map((entry, i) => ({
      list: [...left[i]!, ...right[i]!],
      footprint: entry.footprint
    }))
    // Both chunks together must hold at least one prop within a metre of the
    // seam, or this test would pass by having nothing to check.
    const nearSeam = joined.flatMap(entry => entry.list).filter(t => Math.abs(t.x + 96) < 2)
    expect(nearSeam.length).toBeGreaterThan(0)
    expect(violations(species, joined)).toBe(0)
  })

  it('is a pure function of (seed, chunk), so a chunk that streams back is identical', () => {
    const species = plan()
    const first = place(species, -2, 5)
    // Generating other chunks in between must leave no trace: the resolver's
    // footprint index is scratch, not state.
    place(species, 0, 0)
    place(species, -2, 4)
    const second = place(species, -2, 5)
    expect(second).toEqual(first)
  })

  it('does not depend on which neighbour was generated first', () => {
    const species = plan()
    const forwards = [place(species, -3, 2), place(species, -2, 2)]
    const backwards = [place(species, -2, 2), place(species, -3, 2)]
    expect(backwards[1]).toEqual(forwards[0])
    expect(backwards[0]).toEqual(forwards[1])
  })

  it('lets the higher-ranked species keep its ground', () => {
    // Rank is plan order. The boulder is first, so where the two would have
    // collided it is the oak that moves — never the other way round.
    const species = plan()
    const together = place(species, -3, -3)
    const boulderAlone = place([species[0]!], -3, -3)
    expect(together[0]).toEqual(boulderAlone[0])
  })

  it('thins rather than empties — the wood is still a wood', () => {
    const species = plan()
    const resolved = place(species, -3, -3).flat().length
    const unresolved = species
      .map(entry => place([{ ...entry, footprint: 0 }], -3, -3)[0]!.length)
      .reduce((a, b) => a + b, 0)
    expect(resolved).toBeLessThan(unresolved)
    // A rejection pass that costs more than a third of the world is not
    // separating props, it is deleting them.
    expect(resolved).toBeGreaterThan(unresolved * 0.66)
  })
})

describe('scattered props block in every camera mode', () => {
  const flat = () => 0
  const spec = { radius: 0.3, height: 3 }

  /** The wiring `World` installs: the collision world pulls, nobody pushes. */
  const wired = () => {
    const index = new ScatterColliderIndex(48)
    const world = createCollisionWorld({ heightAt: flat, playerHeight: 1.8, stepHeight: 0.5 })
    world.setTransientSource((x, z) => index.queryNear(x, z, 4, world))
    return { index, world }
  }

  it('collides without anyone having opened a batch first', () => {
    // The regression. `/story` never called `beginTransientColliders`, because
    // the only call site was in `World.frame()`'s `firstPerson` branch — so the
    // transient list stayed empty for the whole chapter and every actor walked
    // through every trunk while the sandbox two routes away collided perfectly.
    const { index, world } = wired()
    index.add(0, 0, [{ x: 0, y: 0, z: 0, rotY: 0, scale: 1 }], spec)

    const moved = world.resolveMove(0, -2, 0, 0.2, 0.35, 0.1)
    expect(moved.z).toBeLessThan(-0.6)
  })

  it('gives each actor the scatter around itself, not around whoever asked last', () => {
    // A chapter moves fourteen combatants a frame, spread over a clearing. One
    // batch filled around the player would collide all of them against the
    // player's surroundings.
    const { index, world } = wired()
    index.add(0, 0, [{ x: 0, y: 0, z: 0, rotY: 0, scale: 1 }], spec)
    index.add(0, 0, [{ x: 30, y: 0, z: 0, rotY: 0, scale: 1 }], spec)

    expect(world.resolveMove(0, -2, 0, 0.2, 0.35, 0.1).z).toBeLessThan(-0.6)
    // Thirty metres away, and blocked by its own tree rather than by the first.
    expect(world.resolveMove(30, -2, 30, 0.2, 0.35, 0.1).z).toBeLessThan(-0.6)
  })

  it('answers the camera the same way whoever moved last', () => {
    // `segmentHit` used to read whatever batch the previous `resolveMove` left
    // behind, so the dialogue camera's occlusion test depended on turn order.
    const { index, world } = wired()
    index.add(0, 0, [{ x: 0, y: 0, z: 0, rotY: 0, scale: 1 }], spec)

    const blocked = world.segmentHit(0, 1, -3, 0, 1, 3)
    world.resolveMove(30, -2, 30, 0.2, 0.35, 0.1)
    expect(world.segmentHit(0, 1, -3, 0, 1, 3)).toBeCloseTo(blocked, 6)
    expect(blocked).toBeLessThan(1)
  })

  it('still works the manual way, for a world with no scatter index', () => {
    const world = createCollisionWorld({ heightAt: flat, playerHeight: 1.8, stepHeight: 0.5 })
    world.beginTransientColliders()
    world.addTransientCylinder(0, 0, 0, 3, 0.3)
    expect(world.resolveMove(0, -2, 0, 0.2, 0.35, 0.1).z).toBeLessThan(-0.6)
  })
})
