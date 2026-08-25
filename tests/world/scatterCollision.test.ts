import { describe, expect, it } from 'vitest'
import { ScatterColliderIndex } from '@/world/scatterColliders'
import { createCollisionWorld } from '@/world/player/collision'

/**
 * ─── Scattered props have to block ──────────────────────────────────────────
 *
 * Hand-placed props always collided — they are `Placement`s with a catalogue
 * entry, resolved through the editor's collider path. **Scattered** props never
 * did: trees, boulders and stones arrive per terrain chunk from a seeded
 * function and had no collider of any kind, so the player walked through every
 * trunk in the world. The level had collision; the forest did not.
 *
 * The two halves are tested separately and then together, because each can fail
 * silently on its own: an index that never finds anything and a collision world
 * that ignores what it is given both look exactly like no collision at all.
 */

const flat = () => 0

const spec = { radius: 0.3, height: 3 }

describe('scatter collider index', () => {
  it('finds a prop the player is standing next to', () => {
    const index = new ScatterColliderIndex(48)
    index.add(0, 0, [{ x: 5, y: 0, z: 5, rotY: 0, scale: 1 }], spec)

    const hits: number[] = []
    const found = index.queryNear(5.5, 5, 1, {
      addTransientCylinder: (x, _z, _b, _t, r) => {
        hits.push(x, r)
      }
    })
    expect(found).toBe(1)
    expect(hits[0]).toBe(5)
    // `toBeCloseTo`, not `toBe`: the index stores `Float32Array`, so 0.3 comes
    // back as 0.30000001192092896. Storing doubles to make an assertion tidy
    // would double the memory of the one structure that holds every tree.
    expect(hits[1]).toBeCloseTo(0.3, 6)
  })

  it('ignores props out of reach', () => {
    const index = new ScatterColliderIndex(48)
    index.add(0, 0, [{ x: 40, y: 0, z: 40, rotY: 0, scale: 1 }], spec)
    const found = index.queryNear(0, 0, 2, { addTransientCylinder: () => {} })
    expect(found).toBe(0)
  })

  it('reaches across a chunk boundary', () => {
    // The player is rarely at a chunk's centre. A query that only looked at the
    // chunk it stands in would let the player walk through any tree within a
    // metre of a boundary — a seam of ghost trees every 48 m.
    const index = new ScatterColliderIndex(48)
    // A tree at x=47.5 lives in chunk 0; the player at x=48.5 stands in chunk 1.
    index.add(0, 0, [{ x: 47.5, y: 0, z: 10, rotY: 0, scale: 1 }], spec)
    const found = index.queryNear(48.5, 10, 1.5, { addTransientCylinder: () => {} })
    expect(found).toBe(1)
  })

  it('scales the collider with the instance', () => {
    const index = new ScatterColliderIndex(48)
    index.add(0, 0, [{ x: 0, y: 2, z: 0, rotY: 0, scale: 2 }], spec)
    let radius = 0
    let top = 0
    let base = 0
    index.queryNear(0, 0, 1, {
      addTransientCylinder: (_x, _z, b, t, r) => {
        base = b
        top = t
        radius = r
      }
    })
    expect(radius).toBeCloseTo(0.6, 6)
    // Grows upward from the instance's base, exactly as a placed prop does.
    expect(base).toBeCloseTo(2, 6)
    expect(top).toBeCloseTo(8, 6)
  })

  it('forgets a chunk that unloads', () => {
    const index = new ScatterColliderIndex(48)
    index.add(1, 2, [{ x: 60, y: 0, z: 110, rotY: 0, scale: 1 }], spec)
    expect(index.size).toBe(1)
    index.remove(1, 2)
    expect(index.size).toBe(0)
    expect(index.queryNear(60, 110, 2, { addTransientCylinder: () => {} })).toBe(0)
  })

  it('keeps several species in the same chunk', () => {
    const index = new ScatterColliderIndex(48)
    index.add(0, 0, [{ x: 1, y: 0, z: 1, rotY: 0, scale: 1 }], spec)
    index.add(0, 0, [{ x: 2, y: 0, z: 1, rotY: 0, scale: 1 }], { radius: 0.8, height: 1 })
    expect(index.size).toBe(2)
    expect(index.queryNear(1.5, 1, 2, { addTransientCylinder: () => {} })).toBe(2)
  })
})

describe('collision against scatter', () => {
  it('stops the player walking through a trunk', () => {
    const world = createCollisionWorld({ heightAt: flat, playerHeight: 1.8, stepHeight: 0.5 })
    world.beginTransientColliders()
    // A tree at the origin, 3 m tall.
    world.addTransientCylinder(0, 0, 0, 3, 0.3)

    // Walk straight at it from 2 m away.
    const moved = world.resolveMove(0, -2, 0, 0.2, 0.35, 0.1)
    // Blocked short of the trunk: the player's radius plus the trunk's.
    expect(moved.z).toBeLessThan(-0.6)
  })

  it('lets the player slide around it rather than sticking', () => {
    const world = createCollisionWorld({ heightAt: flat, playerHeight: 1.8, stepHeight: 0.5 })
    world.beginTransientColliders()
    world.addTransientCylinder(0, 0, 0, 3, 0.3)
    // Brushing past on a diagonal: the tangential part of the move must survive.
    const moved = world.resolveMove(-0.6, -0.6, -0.1, 0.4, 0.35, 0.1)
    expect(Math.hypot(moved.x + 0.6, moved.z + 0.6)).toBeGreaterThan(0.2)
  })

  it('steps over something shorter than the step height', () => {
    const world = createCollisionWorld({ heightAt: flat, playerHeight: 1.8, stepHeight: 0.5 })
    world.beginTransientColliders()
    // A stone 0.28 m tall — under the step height, so it must not block.
    world.addTransientCylinder(0, 0, 0, 0.28, 0.4)
    const moved = world.resolveMove(0, -1, 0, 1, 0.35, 0.1)
    expect(moved.z).toBeGreaterThan(0.9)
  })

  it('never treats a trunk as standable ground', () => {
    // Transient colliders are non-walkable by construction. If they were not,
    // brushing a tree would levitate the player three metres.
    const world = createCollisionWorld({ heightAt: flat, playerHeight: 1.8, stepHeight: 0.5 })
    world.beginTransientColliders()
    world.addTransientCylinder(0, 0, 0, 3, 0.3)
    expect(world.groundHeightAt(0, 0, 10)).toBe(0)
  })

  it('drops last frame’s colliders when a new batch begins', () => {
    const world = createCollisionWorld({ heightAt: flat, playerHeight: 1.8, stepHeight: 0.5 })
    world.beginTransientColliders()
    world.addTransientCylinder(0, 0, 0, 3, 0.3)
    expect(world.colliderCount).toBe(1)
    // A stale collider is a tree the player collides with after walking away
    // from it — and it would accumulate one per frame forever.
    world.beginTransientColliders()
    expect(world.colliderCount).toBe(0)
  })

  it('collides with index and collision world wired together', () => {
    // The integration the two halves above cannot prove on their own.
    const index = new ScatterColliderIndex(48)
    index.add(0, 0, [{ x: 3, y: 0, z: 3, rotY: 0, scale: 1 }], spec)
    const world = createCollisionWorld({ heightAt: flat, playerHeight: 1.8, stepHeight: 0.5 })

    world.beginTransientColliders()
    index.queryNear(3, 1.5, 4, world)
    expect(world.colliderCount).toBe(1)

    const moved = world.resolveMove(3, 1.5, 3, 3.4, 0.35, 0.1)
    expect(moved.z).toBeLessThan(2.4)
  })
})
