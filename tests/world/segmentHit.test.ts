import { describe, expect, it } from 'vitest'
import type { ColliderShape, Placement } from '@/world/level/types'
import { createCollisionWorld, type PlayerCollisionWorld } from '@/world/player/collision'

/**
 * ─── Line of sight against props ────────────────────────────────────────────
 *
 * `segmentHit` exists because `resolveMove` cannot answer "where is the wall".
 * It *slides*: a sweep that meets a wall comes back the same distance from where
 * it started, just displaced along it. Measured in the storyteller's hut,
 * sweeping 6 m out from the fireside in sixteen directions reported a reach of
 * ~6 m in all sixteen — inside a room four metres across.
 *
 * That is what put the dialogue camera outside the building, framing the scene
 * through the rafters from the garden. So the first two tests here are the two
 * halves of that bug: a wall must be found, and it must be found *at the right
 * distance along the line*.
 */

const worldWith = (
  collider: ColliderShape,
  walkable = false,
  placement: Partial<Placement> = {}
): PlayerCollisionWorld => {
  const placements: Placement[] = [
    { id: 'p0', defId: 'stub', x: 0, y: 0, z: 0, rotY: 0, scale: 1, ...placement }
  ]
  const world = createCollisionWorld({
    heightAt: () => 0,
    playerHeight: 1.8,
    stepHeight: 0.4,
    resolveDefinition: () => ({ collider, walkable })
  })
  world.setColliderSource(() => placements)
  return world
}

/** A wall two metres wide, thin, and 2.4 m tall, centred on the origin. */
const WALL: ColliderShape = { kind: 'box', halfX: 1, halfZ: 0.2, height: 2.4 }

describe('a straight line against a box', () => {
  it('reports the fraction at which it enters, not merely that it did', () => {
    const world = worldWith(WALL)
    // Straight through the wall along Z, from 4 m out. The near face is at
    // z = -0.2, so the entry is 3.8/8 of the way.
    const hit = world.segmentHit(0, 1, -4, 0, 1, 4)
    expect(hit).toBeCloseTo(3.8 / 8, 3)
  })

  it('is clear when the line misses to the side', () => {
    const world = worldWith(WALL)
    expect(world.segmentHit(3, 1, -4, 3, 1, 4)).toBe(1)
  })

  it('is clear when the line passes over the top', () => {
    const world = worldWith(WALL)
    // The wall tops out at 2.4; a line held at 3 m never meets it.
    expect(world.segmentHit(0, 3, -4, 0, 3, 4)).toBe(1)
  })

  /**
   * The case the camera actually hits. A lens that has already been pushed
   * inside a wall is *maximally* blocked, and a naive slab test reports the
   * exit face instead — which reads as "mostly clear" and is the worst possible
   * answer, because it is confidently wrong in the safe direction.
   */
  it('reports zero when the line starts inside', () => {
    const world = worldWith(WALL)
    expect(world.segmentHit(0, 1, 0, 0, 1, 6)).toBe(0)
  })

  it('is clear when the line stops short of the wall', () => {
    const world = worldWith(WALL)
    expect(world.segmentHit(0, 1, -4, 0, 1, -1)).toBe(1)
  })

  /**
   * A bridge deck blocks a *walk* and does not block a *look*. Treating the two
   * the same would have the dialogue camera refuse to see across the Arla.
   */
  it('ignores walkable props', () => {
    expect(worldWith(WALL, true).segmentHit(0, 1, -4, 0, 1, 4)).toBe(1)
  })

  it('respects the placement rotation', () => {
    // A quarter turn swaps the wall's axes: it now spans +/-1 in Z and +/-0.2 in
    // X. So a line down Z meets the *long* side at z = -1 (3/8 of the way),
    // where unturned it met the thin face at z = -0.2 (3.8/8) — and a line down
    // X at z = 1.5 now passes beyond its end instead of through its face.
    const turned = worldWith(WALL, false, { rotY: Math.PI / 2 })
    expect(turned.segmentHit(0, 1, -4, 0, 1, 4)).toBeCloseTo(3 / 8, 3)
    expect(turned.segmentHit(-4, 1, 1.5, 4, 1, 1.5)).toBe(1)
    // And through the middle it is the thin way now: entry at x = -0.2.
    expect(turned.segmentHit(-4, 1, 0, 4, 1, 0)).toBeCloseTo(3.8 / 8, 3)
  })

  it('scales with the placement', () => {
    const big = worldWith(WALL, false, { scale: 2 })
    // Twice as thick: the near face moves from z = -0.2 to z = -0.4.
    expect(big.segmentHit(0, 1, -4, 0, 1, 4)).toBeCloseTo(3.6 / 8, 3)
  })
})

describe('a straight line against a cylinder', () => {
  const TRUNK: ColliderShape = { kind: 'cylinder', radius: 0.5, height: 4 }

  it('enters at the near face', () => {
    const world = worldWith(TRUNK)
    expect(world.segmentHit(0, 1, -4, 0, 1, 4)).toBeCloseTo(3.5 / 8, 3)
  })

  it('misses a tangent that clears the radius', () => {
    const world = worldWith(TRUNK)
    expect(world.segmentHit(0.75, 1, -4, 0.75, 1, 4)).toBe(1)
  })

  it('is clear above the top', () => {
    const world = worldWith(TRUNK)
    expect(world.segmentHit(0, 5, -4, 0, 5, 4)).toBe(1)
  })

  it('handles a purely vertical line', () => {
    const world = worldWith(TRUNK)
    // Down the axis: inside the circle for its whole length, so it is blocked
    // the moment it reaches the top of the trunk.
    expect(world.segmentHit(0, 8, 0, 0, 0, 0)).toBeCloseTo(0.5, 2)
    // And beside it, never.
    expect(world.segmentHit(2, 8, 0, 2, 0, 0)).toBe(1)
  })
})

describe('several props at once', () => {
  it('returns the nearest hit', () => {
    const placements: Placement[] = [
      { id: 'far', defId: 'stub', x: 0, y: 0, z: 3, rotY: 0, scale: 1 },
      { id: 'near', defId: 'stub', x: 0, y: 0, z: 1, rotY: 0, scale: 1 }
    ]
    const world = createCollisionWorld({
      heightAt: () => 0,
      playerHeight: 1.8,
      stepHeight: 0.4,
      resolveDefinition: () => ({ collider: WALL, walkable: false })
    })
    world.setColliderSource(() => placements)
    // Near wall's face is at z = 0.8, four fifths of the way along a 1 m... the
    // line runs from z = -4 to z = 6, so 4.8/10.
    expect(world.segmentHit(0, 1, -4, 0, 1, 6)).toBeCloseTo(4.8 / 10, 3)
  })

  /**
   * The collider list is rebuilt lazily from the placement store. `segmentHit`
   * shipped for an afternoon without the `sync()` every other entry point opens
   * with, and reported a clear line through a hut it had simply never read the
   * walls of — the dialogue camera then had better information than before and
   * still put itself inside a wall.
   */
  it('reads placements it has never been asked about before', () => {
    const world = worldWith(WALL)
    // No `resolveMove` or `groundHeightAt` call first: this is the very first
    // question anyone asks this world.
    expect(world.segmentHit(0, 1, -4, 0, 1, 4)).toBeLessThan(1)
  })
})
