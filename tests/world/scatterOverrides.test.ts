import { beforeEach, describe, expect, it } from 'vitest'
import { Heightfield } from '@/world/terrain/Heightfield'
import { scatterChunk } from '@/world/scatter'
import { ScatterColliderIndex } from '@/world/scatterColliders'
import {
  loadScatterOverrides,
  saveScatterOverrides,
  ScatterOverrides,
  scatterKey
} from '@/world/level/scatterOverrides'

/**
 * ─── Deleting something the generator will make again ───────────────────────
 *
 * A scattered tree is not stored anywhere. It is a function of the terrain seed,
 * produced fresh every time its chunk streams in. "Delete this tree" therefore
 * cannot mean "remove it from a list" — there is no list. It means: remember
 * enough about it to recognise it the next time the generator produces it, and
 * drop it on the way through.
 *
 * That makes the **key** the load-bearing part. Everything below is really one
 * question asked four ways: does the tombstone still find its tree after the
 * chunk has unloaded, reloaded, and the page has been closed and reopened?
 */

const field = new Heightfield({ seed: 1234 })
const OPTIONS = { spacing: 11, seed: 300, maxSlope: 0.34, clusterSize: 95, clusterThreshold: 0.47 }

/** Regenerates one chunk exactly as the streamer would, applying a filter. */
const generate = (reject?: (t: { x: number; z: number }) => boolean) => {
  const out = scatterChunk(field, OPTIONS, 0, 0, 48)
  return reject ? out.filter(t => !reject(t)) : out
}

describe('scatterKey', () => {
  it('is stable for the same instance', () => {
    expect(scatterKey('tree0', 12.345, -6.789)).toBe(scatterKey('tree0', 12.345, -6.789))
  })

  it('separates species standing in the same place', () => {
    // Two variants can land on the same spot in different chunks. Sharing a
    // tombstone would delete a tree somebody never touched.
    expect(scatterKey('tree0', 5, 5)).not.toBe(scatterKey('tree1', 5, 5))
  })

  it('quantises to a centimetre, so float dust cannot lose an instance', () => {
    expect(scatterKey('tree0', 5.0000001, 5)).toBe(scatterKey('tree0', 5, 5))
    expect(scatterKey('tree0', 5.02, 5)).not.toBe(scatterKey('tree0', 5, 5))
  })
})

describe('ScatterOverrides', () => {
  it('reports a tombstoned key and only that key', () => {
    const overrides = new ScatterOverrides()
    overrides.remove('tree0:100:200')

    expect(overrides.isRemoved('tree0:100:200')).toBe(true)
    expect(overrides.isRemoved('tree0:100:201')).toBe(false)
  })

  it('refuses to double-count a repeated delete', () => {
    const overrides = new ScatterOverrides()

    expect(overrides.remove('a')).toBe(true)
    expect(overrides.remove('a')).toBe(false)
    expect(overrides.removedCount).toBe(1)
  })

  it('bumps its revision on every real change and never on a no-op', () => {
    const overrides = new ScatterOverrides()
    const start = overrides.revision

    overrides.remove('a')
    const afterAdd = overrides.revision
    expect(afterAdd).toBeGreaterThan(start)

    overrides.remove('a')
    expect(overrides.revision).toBe(afterAdd)

    overrides.restore('nothing-here')
    expect(overrides.revision).toBe(afterAdd)
  })

  it('sorts its list, so an export diffs cleanly in review', () => {
    const overrides = new ScatterOverrides()
    overrides.remove('c')
    overrides.remove('a')
    overrides.remove('b')

    expect(overrides.list()).toEqual(['a', 'b', 'c'])
  })

  it('merges a shipped patch without dropping local deletions', () => {
    // A world patch composes with what the player already deleted. Tombstones
    // only ever add, so nothing can conflict — and nothing may be lost.
    const overrides = new ScatterOverrides()
    overrides.remove('mine')

    const added = overrides.merge({ removed: ['theirs', 'mine'] })

    expect(added).toBe(1)
    expect(overrides.isRemoved('mine')).toBe(true)
    expect(overrides.isRemoved('theirs')).toBe(true)
  })

  it('replaces the whole set on load, unlike merge', () => {
    const overrides = new ScatterOverrides()
    overrides.remove('stale')
    overrides.load({ removed: ['fresh'] })

    expect(overrides.isRemoved('stale')).toBe(false)
    expect(overrides.isRemoved('fresh')).toBe(true)
  })

  it('survives corrupt stored data', () => {
    const overrides = new ScatterOverrides()
    overrides.load({ removed: ['ok', '', null as unknown as string, 7 as unknown as string] })

    expect(overrides.removedCount).toBe(1)
    expect(overrides.isRemoved('ok')).toBe(true)
  })
})

describe('persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips through storage', () => {
    const overrides = new ScatterOverrides()
    overrides.remove(scatterKey('tree0', 12.34, -5.67))
    saveScatterOverrides(overrides.toJSON())

    // A fresh page load.
    const restored = ScatterOverrides.restore()

    expect(restored.isRemoved(scatterKey('tree0', 12.34, -5.67))).toBe(true)
  })

  it('restores an empty set when nothing is stored', () => {
    expect(ScatterOverrides.restore().removedCount).toBe(0)
  })

  it('ignores stored garbage rather than throwing at boot', () => {
    localStorage.setItem('world.scatterOverrides.v1', '{ this is not json')

    expect(loadScatterOverrides()).toBeNull()
    expect(ScatterOverrides.restore().removedCount).toBe(0)
  })
})

describe('a deleted prop stays deleted through regeneration', () => {
  it('generates the same chunk twice identically', () => {
    // The premise everything else rests on. If the generator were not pure,
    // a position-based tombstone could never find its instance again.
    const first = generate()
    const second = generate()

    expect(first.length).toBeGreaterThan(0)
    expect(second.map(t => scatterKey('tree0', t.x, t.z))).toEqual(first.map(t => scatterKey('tree0', t.x, t.z)))
  })

  it('drops exactly the tombstoned instance and nothing else', () => {
    const before = generate()
    const victim = before[Math.floor(before.length / 2)]!
    const overrides = new ScatterOverrides()
    overrides.remove(scatterKey('tree0', victim.x, victim.z))

    const after = generate(t => overrides.isRemoved(scatterKey('tree0', t.x, t.z)))

    expect(after).toHaveLength(before.length - 1)
    expect(after.some(t => t.x === victim.x && t.z === victim.z)).toBe(false)
  })

  it('brings it back when the tombstone is lifted', () => {
    const before = generate()
    const victim = before[0]!
    const key = scatterKey('tree0', victim.x, victim.z)
    const overrides = new ScatterOverrides()
    overrides.remove(key)
    overrides.restore(key)

    expect(generate(t => overrides.isRemoved(scatterKey('tree0', t.x, t.z)))).toHaveLength(before.length)
  })

  it('keys a deletion to one species only', () => {
    // Same position, different species: two variants can genuinely stand on the
    // same spot, and deleting one must not take the other with it.
    const before = generate()
    const victim = before[1]!
    const overrides = new ScatterOverrides()
    overrides.remove(scatterKey('tree0', victim.x, victim.z))

    const asOtherSpecies = generate(t => overrides.isRemoved(scatterKey('tree1', t.x, t.z)))

    expect(asOtherSpecies).toHaveLength(before.length)
  })
})

/**
 * ─── Aiming at something that has no scene node ─────────────────────────────
 *
 * Scatter cannot be raycast: the fields are `InstancedMesh`es whose slots are
 * repacked every frame by the LOD and culling passes, so three.js's
 * `instanceId` names a *slot*, not a prop, and means something different next
 * frame. The editor's crosshair therefore tests the stored collider cylinders.
 */
describe('picking a scattered prop', () => {
  const index = new ScatterColliderIndex(48)
  const spec = { radius: 0.3, height: 3 }

  beforeEach(() => {
    index.clear()
    index.add(0, 0, [{ x: 10, y: 0, z: 10, rotY: 0, scale: 1 }], spec, 2)
    index.add(0, 0, [{ x: 30, y: 0, z: 10, rotY: 0, scale: 1 }], spec, 5)
  })

  it('finds the prop the ray passes through', () => {
    // Standing at z = 10 looking down +x at eye height, straight at the trunk.
    const hit = index.nearestToRay(0, 1.6, 10, 1, 0, 0, 90)

    expect(hit).not.toBeNull()
    expect(hit!.x).toBe(10)
    expect(hit!.speciesOrdinal).toBe(2)
  })

  it('returns the nearer of two props on the same ray', () => {
    // The far one is also under the crosshair. Aiming means the first thing hit,
    // or deleting a tree would reach through it to the one behind.
    const hit = index.nearestToRay(0, 1.6, 10, 1, 0, 0, 90)

    expect(hit!.x).toBe(10)
  })

  it('finds the far one once the near one is gone', () => {
    index.clear()
    index.add(0, 0, [{ x: 30, y: 0, z: 10, rotY: 0, scale: 1 }], spec, 5)

    expect(index.nearestToRay(0, 1.6, 10, 1, 0, 0, 90)!.speciesOrdinal).toBe(5)
  })

  it('misses a prop the ray goes past', () => {
    expect(index.nearestToRay(0, 1.6, 16, 1, 0, 0, 90)).toBeNull()
  })

  it('misses a prop the ray passes over', () => {
    // Above the trunk's 3 m. Without the height test, looking at the sky over a
    // forest would pick a tree.
    expect(index.nearestToRay(0, 12, 10, 1, 0, 0, 90)).toBeNull()
  })

  it('ignores what is behind the camera', () => {
    // Looking the other way. Without clamping the ray parameter to the forward
    // half, the closest-approach solution happily reports a negative distance.
    expect(index.nearestToRay(0, 1.6, 10, -1, 0, 0, 90)).toBeNull()
  })

  it('respects the range limit', () => {
    expect(index.nearestToRay(0, 1.6, 10, 1, 0, 0, 5)).toBeNull()
  })

  it('declines a straight-down ray rather than guessing', () => {
    // No meaningful ordering along a ray with no horizontal extent — the
    // caller's positional fallback answers this case instead.
    expect(index.nearestToRay(10, 20, 10, 0, -1, 0, 90)).toBeNull()
    expect(index.nearest(10, 10, 2.5)).not.toBeNull()
  })

  it('finds props in chunks the ray only crosses on its way', () => {
    // The prop is four chunks away, so this only works if the walk collects
    // every chunk along the ray rather than the one under the camera.
    index.clear()
    index.add(4, 0, [{ x: 200, y: 0, z: 10, rotY: 0, scale: 1 }], spec, 1)

    expect(index.nearestToRay(0, 1.6, 10, 1, 0, 0, 400)).not.toBeNull()
  })
})
