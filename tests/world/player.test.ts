import { PerspectiveCamera, Vector3 } from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import type { ColliderShape, CollisionWorld, Placement } from '@/world/level/types'
import { createCollisionWorld, type PlayerCollisionWorld } from '@/world/player/collision'
import { groundForward, PlayerController, strafeRight } from '@/world/player/PlayerController'

/**
 * Pure-logic coverage for the first-person controller. No WebGL is touched —
 * `PerspectiveCamera` is plain maths, the collision world is plain numbers, and
 * the placeholder capsule (the only part that builds geometry) is deliberately
 * not exercised here.
 */

const DT = 1 / 60

// ── Fixtures ───────────────────────────────────────────────────────────────

/** Collision world with a stub heightfield and no props. */
const flatCollision = (heightAt: (x: number, z: number) => number = () => 0): PlayerCollisionWorld =>
  createCollisionWorld({ heightAt, playerHeight: 1.8, stepHeight: 0.4 })

/** Collision world holding a single prop, with the catalog stubbed out. */
const propCollision = (
  collider: ColliderShape,
  walkable: boolean,
  placement: Partial<Placement> = {},
  heightAt: (x: number, z: number) => number = () => 0
): { world: PlayerCollisionWorld; placements: Placement[] } => {
  const placements: Placement[] = [
    { id: 'p0', defId: 'stub', x: 0, y: 0, z: 0, rotY: 0, scale: 1, ...placement }
  ]
  const world = createCollisionWorld({
    heightAt,
    playerHeight: 1.8,
    stepHeight: 0.4,
    resolveDefinition: () => ({ collider, walkable })
  })
  world.setColliderSource(() => placements)
  return { world, placements }
}

const controllers: PlayerController[] = []

const makeController = (
  collision: CollisionWorld,
  options: Partial<{ jumpHeight: number; gravity: number; walkSpeed: number }> = {}
): { controller: PlayerController; element: HTMLElement } => {
  const controller = new PlayerController({
    camera: new PerspectiveCamera(55, 1, 0.5, 1200),
    collision,
    bobStrength: 0,
    ...options
  })
  const element = document.createElement('div')
  controller.attach(element)
  controllers.push(controller)
  return { controller, element }
}

const key = (type: 'keydown' | 'keyup', code: string): void => {
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }))
}

const step = (controller: PlayerController, frames: number, delta = DT): void => {
  for (let i = 0; i < frames; i++) {
    controller.update(delta)
  }
}

afterEach(() => {
  for (const controller of controllers) {
    controller.detach()
  }
  controllers.length = 0
})

// ── Strafe vector ──────────────────────────────────────────────────────────

describe('strafe vector sign', () => {
  const up = new Vector3(0, 1, 0)

  it('is exactly cross(forward, up) at every yaw', () => {
    const forward = new Vector3()
    const right = new Vector3()
    const expected = new Vector3()

    for (let yaw = -Math.PI * 2; yaw <= Math.PI * 2; yaw += 0.37) {
      groundForward(yaw, forward)
      strafeRight(yaw, right)
      expected.copy(forward).cross(up)

      expect(right.x).toBeCloseTo(expected.x, 12)
      expect(right.y).toBeCloseTo(expected.y, 12)
      expect(right.z).toBeCloseTo(expected.z, 12)
    }
  })

  it('points at +X when facing -Z — the sign that shipped inverted in the orbit rig', () => {
    const forward = groundForward(0, new Vector3())
    expect(forward.x).toBeCloseTo(0, 12)
    expect(forward.z).toBeCloseTo(-1, 12)

    const right = strafeRight(0, new Vector3())
    expect(right.x).toBeCloseTo(1, 12)
    expect(right.y).toBe(0)
    expect(right.z).toBeCloseTo(0, 12)
  })

  it('rotates with yaw: facing -X, right is +Z', () => {
    const right = strafeRight(Math.PI / 2, new Vector3())
    expect(right.x).toBeCloseTo(0, 12)
    expect(right.z).toBeCloseTo(-1, 12)

    const forward = groundForward(Math.PI / 2, new Vector3())
    expect(forward.x).toBeCloseTo(-1, 12)
    expect(forward.z).toBeCloseTo(0, 12)
  })

  it('drives D to +X and A to -X through the controller', () => {
    const { controller } = makeController(flatCollision())
    controller.teleport(0, 0, 0)
    controller.snapToGround()

    key('keydown', 'KeyD')
    step(controller, 12)
    key('keyup', 'KeyD')

    expect(controller.position.x).toBeGreaterThan(0.3)
    expect(controller.position.z).toBeCloseTo(0, 6)

    const afterD = controller.position.x
    key('keydown', 'KeyA')
    step(controller, 24)
    key('keyup', 'KeyA')

    expect(controller.position.x).toBeLessThan(afterD)
  })

  it('drives W toward -Z at yaw 0', () => {
    const { controller } = makeController(flatCollision())
    controller.teleport(0, 0, 0)
    controller.snapToGround()

    key('keydown', 'KeyW')
    step(controller, 12)
    key('keyup', 'KeyW')

    expect(controller.position.z).toBeLessThan(-0.3)
    expect(controller.position.x).toBeCloseTo(0, 6)
  })

  it('never lets a diagonal outrun a straight line', () => {
    const straight = makeController(flatCollision()).controller
    straight.teleport(0, 0, 0)
    straight.snapToGround()
    key('keydown', 'KeyW')
    step(straight, 30)
    key('keyup', 'KeyW')

    const diagonal = makeController(flatCollision()).controller
    diagonal.teleport(0, 0, 0)
    diagonal.snapToGround()
    key('keydown', 'KeyW')
    key('keydown', 'KeyD')
    step(diagonal, 30)
    key('keyup', 'KeyW')
    key('keyup', 'KeyD')

    const straightDistance = Math.hypot(straight.position.x, straight.position.z)
    const diagonalDistance = Math.hypot(diagonal.position.x, diagonal.position.z)
    expect(diagonalDistance).toBeLessThanOrEqual(straightDistance + 1e-6)
  })
})

// ── Gravity and jump ───────────────────────────────────────────────────────

describe('gravity and jump integration', () => {
  it('stays put on flat ground with no input', () => {
    const { controller } = makeController(flatCollision())
    controller.teleport(0, 0, 0)
    controller.snapToGround()

    step(controller, 60)

    expect(controller.position.y).toBeCloseTo(0, 6)
    expect(controller.isGrounded).toBe(true)
  })

  it('reaches roughly the configured apex and comes back down', () => {
    const { controller } = makeController(flatCollision(), { jumpHeight: 1.2, gravity: 22 })
    controller.teleport(0, 0, 0)
    controller.snapToGround()

    key('keydown', 'Space')
    key('keyup', 'Space')

    let apex = 0
    let airborneFrames = 0
    for (let i = 0; i < 240; i++) {
      controller.update(DT)
      apex = Math.max(apex, controller.position.y)
      if (!controller.isGrounded) {
        airborneFrames++
      }
    }

    // Semi-implicit Euler undershoots the analytic v²/2g apex by half a step.
    expect(apex).toBeGreaterThan(1.05)
    expect(apex).toBeLessThan(1.25)
    // ~0.66 s of hang time at these numbers; anything near 240 means it never landed.
    expect(airborneFrames).toBeGreaterThan(20)
    expect(airborneFrames).toBeLessThan(60)
    expect(controller.isGrounded).toBe(true)
    expect(controller.position.y).toBeCloseTo(0, 6)
  })

  it('reaches the same apex at 30 fps as at 144 fps', () => {
    const apexAt = (delta: number): number => {
      const { controller } = makeController(flatCollision(), { jumpHeight: 1.2, gravity: 22 })
      controller.teleport(0, 0, 0)
      controller.snapToGround()
      key('keydown', 'Space')
      key('keyup', 'Space')

      let apex = 0
      for (let elapsed = 0; elapsed < 1.5; elapsed += delta) {
        controller.update(delta)
        apex = Math.max(apex, controller.position.y)
      }
      return apex
    }

    expect(apexAt(1 / 30)).toBeCloseTo(apexAt(1 / 144), 1)
  })

  it('cannot jump while airborne (past the coyote window)', () => {
    const { controller } = makeController(flatCollision(), { jumpHeight: 1.2, gravity: 22 })
    controller.teleport(0, 0, 0)
    controller.snapToGround()

    key('keydown', 'Space')
    key('keyup', 'Space')
    step(controller, 20)

    const before = controller.position.y
    expect(controller.isGrounded).toBe(false)

    key('keydown', 'Space')
    key('keyup', 'Space')
    step(controller, 1)

    // The second press is buffered, not honoured: it must not add height.
    expect(controller.position.y).toBeLessThan(before + 0.05)
  })

  it('falls onto the ground from a height and stops there', () => {
    const { controller } = makeController(flatCollision())
    controller.teleport(0, 12, 0)

    step(controller, 300)

    expect(controller.position.y).toBeCloseTo(0, 6)
    expect(controller.isGrounded).toBe(true)
  })
})

// ── Ground clamping ────────────────────────────────────────────────────────

describe('ground clamping against a stub heightfield', () => {
  it('lands on the terrain height under the player, not on zero', () => {
    const { controller } = makeController(flatCollision((x: number) => (x > 5 ? 2 : 0)))
    controller.teleport(10, 10, 0)

    step(controller, 300)

    expect(controller.position.y).toBeCloseTo(2, 6)
    expect(controller.isGrounded).toBe(true)
  })

  it('sticks to a downhill slope instead of hopping off it', () => {
    // W walks toward -Z, and the ground falls away with it: 1 m of drop per 4 m
    // travelled ≈ 14°, well inside the step-height stick.
    const { controller } = makeController(flatCollision((_x: number, z: number) => z * 0.25))
    controller.teleport(0, 0, 0)
    controller.snapToGround()

    key('keydown', 'KeyW')
    let airborneFrames = 0
    for (let i = 0; i < 90; i++) {
      controller.update(DT)
      if (!controller.isGrounded) {
        airborneFrames++
      }
    }
    key('keyup', 'KeyW')

    expect(controller.position.z).toBeLessThan(-3)
    expect(airborneFrames).toBe(0)
    expect(controller.position.y).toBeCloseTo(controller.position.z * 0.25, 6)
  })

  it('reports the top of a walkable prop as ground, terrain otherwise', () => {
    const { world } = propCollision({ kind: 'box', halfX: 2, halfZ: 2, height: 0.3 }, true)

    expect(world.groundHeightAt(0, 0, 0.4)).toBeCloseTo(0.3, 6)
    // Outside the footprint the terrain wins.
    expect(world.groundHeightAt(9, 0, 0.4)).toBeCloseTo(0, 6)
  })

  it('ignores a walkable top the player cannot reach from where they are', () => {
    const { world } = propCollision({ kind: 'box', halfX: 2, halfZ: 2, height: 0.5 }, true, { y: 3 })

    // Standing underneath: the platform is above the probe, so the ground is terrain.
    expect(world.groundHeightAt(0, 0, 0.4)).toBeCloseTo(0, 6)
    // Falling onto it from above: now it wins.
    expect(world.groundHeightAt(0, 0, 9)).toBeCloseTo(3.5, 6)
  })

  it('ignores a non-walkable prop entirely for ground purposes', () => {
    const { world } = propCollision({ kind: 'box', halfX: 2, halfZ: 2, height: 0.3 }, false)
    expect(world.groundHeightAt(0, 0, 0.4)).toBeCloseTo(0, 6)
  })

  it('steps the controller up onto a knee-high slab', () => {
    const { world } = propCollision({ kind: 'box', halfX: 3, halfZ: 3, height: 0.3 }, true)
    const { controller } = makeController(world)
    // W walks toward -Z, so start clear of the slab's +Z face at z = 3.
    controller.teleport(0, 0, 6)
    controller.snapToGround()

    key('keydown', 'KeyW')
    step(controller, 60)
    key('keyup', 'KeyW')

    expect(controller.position.z).toBeLessThan(2.9)
    expect(controller.position.z).toBeGreaterThan(-3)
    expect(controller.position.y).toBeCloseTo(0.3, 6)
    expect(controller.isGrounded).toBe(true)
  })

  it('is blocked by a slab taller than the step height', () => {
    const { world } = propCollision({ kind: 'box', halfX: 3, halfZ: 3, height: 1.2 }, true)
    const { controller } = makeController(world)
    controller.teleport(0, 0, 6)
    controller.snapToGround()

    key('keydown', 'KeyW')
    step(controller, 90)
    key('keyup', 'KeyW')

    // Stopped one radius short of the slab's +Z face at z = 3.
    expect(controller.position.z).toBeCloseTo(3.35, 4)
    expect(controller.position.y).toBeCloseTo(0, 6)
  })
})

// ── Wall sliding ───────────────────────────────────────────────────────────

describe('resolveMove slides instead of stopping dead', () => {
  it('keeps the tangential component of a glancing move', () => {
    const { world } = propCollision({ kind: 'box', halfX: 3, halfZ: 0.5, height: 3 }, false)

    const result = world.resolveMove(0, -2, 1, -0.4, 0.35, 0)

    // Full travel along the wall...
    expect(result.x).toBeCloseTo(1, 4)
    // ...and pushed back out to exactly one radius from its -Z face.
    expect(result.z).toBeCloseTo(-0.85, 4)
  })

  it('stops dead only when the move is head-on', () => {
    const { world } = propCollision({ kind: 'box', halfX: 3, halfZ: 0.5, height: 3 }, false)

    const result = world.resolveMove(0, -2, 0, -0.4, 0.35, 0)

    expect(result.x).toBeCloseTo(0, 6)
    expect(result.z).toBeCloseTo(-0.85, 4)
  })

  it('leaves an unobstructed move untouched', () => {
    const { world } = propCollision({ kind: 'box', halfX: 3, halfZ: 0.5, height: 3 }, false)

    const result = world.resolveMove(0, -20, 0.5, -18, 0.35, 0)

    expect(result.x).toBeCloseTo(0.5, 6)
    expect(result.z).toBeCloseTo(-18, 6)
  })

  it('respects the collider’s Y rotation', () => {
    // The same thin wall, turned 90°, now blocks along X rather than along Z.
    const { world } = propCollision({ kind: 'box', halfX: 3, halfZ: 0.5, height: 3 }, false, {
      rotY: Math.PI / 2
    })

    const result = world.resolveMove(-2, 0, -0.4, 1, 0.35, 0)

    expect(result.x).toBeCloseTo(-0.85, 4)
    expect(result.z).toBeCloseTo(1, 4)
  })

  it('slides around a cylinder', () => {
    const { world } = propCollision({ kind: 'cylinder', radius: 1, height: 3 }, false)

    const result = world.resolveMove(0, -3, 0, -0.5, 0.35, 0)

    // Pushed out to radius + player radius, straight back along the contact normal.
    expect(Math.hypot(result.x, result.z)).toBeCloseTo(1.35, 4)
    expect(result.z).toBeLessThan(0)
  })

  it('does not block a collider the player can step over', () => {
    const { world } = propCollision({ kind: 'box', halfX: 3, halfZ: 0.5, height: 0.3 }, true)

    const result = world.resolveMove(0, -2, 0, 0, 0.35, 0)

    expect(result.x).toBeCloseTo(0, 6)
    expect(result.z).toBeCloseTo(0, 6)
  })

  it('does not block a collider that starts above the player’s head', () => {
    const { world } = propCollision({ kind: 'box', halfX: 3, halfZ: 0.5, height: 3 }, false, { y: 4 })

    const result = world.resolveMove(0, -2, 0, 0, 0.35, 0)

    expect(result.z).toBeCloseTo(0, 6)
  })

  it('scales the collider with the placement', () => {
    const { world } = propCollision({ kind: 'cylinder', radius: 1, height: 3 }, false, { scale: 2 })

    const result = world.resolveMove(0, -6, 0, -1, 0.35, 0)

    expect(Math.hypot(result.x, result.z)).toBeCloseTo(2.35, 4)
  })

  it('returns a shared object — the zero-allocation contract', () => {
    const { world } = propCollision({ kind: 'box', halfX: 1, halfZ: 1, height: 2 }, false)

    const a = world.resolveMove(0, -5, 0, -4, 0.35, 0)
    const b = world.resolveMove(0, -4, 0, -3, 0.35, 0)

    expect(a).toBe(b)
  })
})

// ── Collider source ────────────────────────────────────────────────────────

describe('collider source', () => {
  it('picks up placements added after the source was set', () => {
    const { world, placements } = propCollision({ kind: 'box', halfX: 1, halfZ: 1, height: 2 }, true)

    expect(world.groundHeightAt(6, 0, 0.4)).toBeCloseTo(0, 6)

    placements.push({ id: 'p1', defId: 'stub', x: 6, y: 0, z: 0, rotY: 0, scale: 1 })

    expect(world.groundHeightAt(6, 0, 2.4)).toBeCloseTo(2, 6)
    expect(world.colliderCount).toBe(2)
  })

  it('needs invalidate() after an in-place edit', () => {
    const { world, placements } = propCollision({ kind: 'box', halfX: 1, halfZ: 1, height: 2 }, true)

    world.groundHeightAt(0, 0, 2.4)
    placements[0]!.x = 20

    // Length and identity are unchanged, so the cache is still the old transform.
    expect(world.groundHeightAt(0, 0, 2.4)).toBeCloseTo(2, 6)
    world.invalidate()
    expect(world.groundHeightAt(0, 0, 2.4)).toBeCloseTo(0, 6)
    expect(world.groundHeightAt(20, 0, 2.4)).toBeCloseTo(2, 6)
  })

  it('drops every collider when the source is cleared', () => {
    const { world } = propCollision({ kind: 'box', halfX: 1, halfZ: 1, height: 2 }, true)

    expect(world.groundHeightAt(0, 0, 2.4)).toBeCloseTo(2, 6)
    world.setColliderSource(null)
    expect(world.groundHeightAt(0, 0, 2.4)).toBeCloseTo(0, 6)
    expect(world.colliderCount).toBe(0)
  })

  it('skips placements whose definition has no collider', () => {
    const placements: Placement[] = [{ id: 'p0', defId: 'stub', x: 0, y: 0, z: 0, rotY: 0, scale: 1 }]
    const world = createCollisionWorld({
      heightAt: () => 0,
      resolveDefinition: () => ({ collider: { kind: 'none' }, walkable: false })
    })
    world.setColliderSource(() => placements)

    expect(world.groundHeightAt(0, 0, 99)).toBeCloseTo(0, 6)
    expect(world.colliderCount).toBe(0)
  })
})

// ── Enable / disable ───────────────────────────────────────────────────────

describe('enabled toggle', () => {
  it('ignores input and freezes while disabled, so the orbit camera can own the frame', () => {
    const { controller } = makeController(flatCollision())
    controller.teleport(0, 0, 0)
    controller.snapToGround()
    controller.setEnabled(false)

    key('keydown', 'KeyW')
    step(controller, 60)
    key('keyup', 'KeyW')

    expect(controller.position.x).toBe(0)
    expect(controller.position.z).toBe(0)

    controller.setEnabled(true)
    key('keydown', 'KeyW')
    step(controller, 30)
    key('keyup', 'KeyW')

    expect(controller.position.z).toBeLessThan(-0.5)
  })

  it('clamps pitch just under the poles and leaves yaw unbounded', () => {
    const { controller } = makeController(flatCollision())

    controller.setLook(40, 8)
    expect(controller.lookYaw).toBe(40)
    expect(controller.lookPitch).toBeLessThan(Math.PI / 2)
    expect(controller.lookPitch).toBeGreaterThan(Math.PI / 2 - 0.01)

    controller.setLook(-40, -8)
    expect(controller.lookYaw).toBe(-40)
    expect(controller.lookPitch).toBeGreaterThan(-Math.PI / 2)
    expect(controller.lookPitch).toBeLessThan(-Math.PI / 2 + 0.01)
  })
})
