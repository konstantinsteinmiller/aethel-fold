import type { Object3D, PerspectiveCamera } from 'three'
import { Group, Vector3 } from 'three'
import type { CollisionWorld, Placement } from '../level/types'
import { createCapsuleMesh, type PlayerCapsule } from './capsuleMesh'
import { type ColliderDefinition, createCollisionWorld, type PlayerCollisionWorld } from './collision'
import { lookDirection, PlayerController } from './PlayerController'

/**
 * ─── Player façade ──────────────────────────────────────────────────────────
 *
 * The imperative handle `World` (and, through it, Vue) holds. Same shape as
 * every other seam in this project: one object, plain methods, no reactivity,
 * nothing about three.js leaking upward except the `Object3D` the caller has to
 * add to the scene (GDD §0).
 *
 * It exists so the three parts underneath — controller, collision, placeholder
 * mesh — can be wired to each other here rather than by whoever is integrating
 * them. In particular the collision world has to be told the player's height
 * and step height, or its vertical overlap test silently disagrees with the
 * controller's step probe and props become selectively solid.
 *
 * **Coexisting with the orbit camera.** Both controllers can stay attached at
 * once; `setEnabled` decides which is listening. A disabled player drops its
 * held keys and releases the pointer lock, so switching modes never leaves a
 * stuck W behind or a captured cursor the orbit rig can't use.
 */

export interface PlayerSpawn {
  x: number
  z: number
  /** Omit to drop the player onto whatever the collision world reports. */
  y?: number
}

export interface CreatePlayerOptions {
  camera: PerspectiveCamera
  /** Terrain sampler — `Heightfield.heightAt` / `Terrain.heightAt`. */
  heightAt?: (x: number, z: number) => number
  /** Supply a ready-made collision world instead; `heightAt` is then unused. */
  collision?: CollisionWorld
  /** `defId` → collider, when levels don't come from the placeable catalog. */
  resolveDefinition?: (defId: string) => ColliderDefinition | undefined
  spawn?: PlayerSpawn
  radius?: number
  height?: number
  eyeHeight?: number
  walkSpeed?: number
  sprintMultiplier?: number
  jumpHeight?: number
  gravity?: number
  stepHeight?: number
  lookSensitivity?: number
  bobStrength?: number
  /** Initial yaw, in radians. Pitch always starts level. */
  yaw?: number
  /** Start disabled when the orbit camera owns the frame. */
  enabled?: boolean
  /** Build the placeholder capsule. Off saves two draw calls and a geometry. */
  mesh?: boolean
  /** Third-person boom length, in metres. */
  thirdPersonDistance?: number
}

export interface Player {
  readonly controller: PlayerController
  readonly collision: CollisionWorld
  /** Non-null unless the caller supplied their own collision world. */
  readonly propCollision: PlayerCollisionWorld | null
  /**
   * Scene root for the placeholder capsule. `scene.add(player.object)` and
   * `profiler.registerRoot(player.object, player.perfTag)` — an unregistered
   * root is invisible to the ablation profiler (GDD §5.3).
   */
  readonly object: Object3D
  readonly perfTag: string
  /** Live feet position. Read it; don't mutate it — use `teleport`. */
  readonly position: Vector3
  readonly enabled: boolean
  readonly grounded: boolean

  update(delta: number): void
  attach(element: HTMLElement): void
  detach(): void
  setEnabled(enabled: boolean): void
  /** Shows the capsule and swings the camera onto a boom behind it. */
  setThirdPerson(active: boolean): void
  setColliderSource(source: (() => Placement[]) | null): void
  /** Call after mutating a placement in place — see `PlayerCollisionWorld`. */
  invalidateColliders(): void
  teleport(x: number, y: number, z: number): void
  dispose(): void
}

const _boom = new Vector3()

export const createPlayer = (options: CreatePlayerOptions): Player => {
  const {
    camera,
    radius = 0.35,
    height = 1.8,
    eyeHeight = 1.7,
    stepHeight = 0.4,
    spawn = { x: 0, z: 0 },
    enabled = true,
    mesh = true,
    thirdPersonDistance = 4.2
  } = options

  const heightAt = options.heightAt
  if (!options.collision && !heightAt) {
    throw new Error('[world] createPlayer needs either `heightAt` or `collision`')
  }

  const propCollision =
    options.collision || !heightAt
      ? null
      : createCollisionWorld({
          heightAt,
          playerHeight: height,
          stepHeight,
          resolveDefinition: options.resolveDefinition
        })
  const collision: CollisionWorld = options.collision ?? (propCollision as PlayerCollisionWorld)

  const controller = new PlayerController({
    camera,
    collision,
    radius,
    height,
    eyeHeight,
    stepHeight,
    walkSpeed: options.walkSpeed,
    sprintMultiplier: options.sprintMultiplier,
    jumpHeight: options.jumpHeight,
    gravity: options.gravity,
    lookSensitivity: options.lookSensitivity,
    bobStrength: options.bobStrength,
    enabled
  })

  if (options.yaw !== undefined) {
    controller.setLook(options.yaw, 0)
  }

  const capsule: PlayerCapsule | null = mesh ? createCapsuleMesh({ radius, height }) : null
  // `mesh: false` still gets a root, so the caller's scene.add / registerRoot
  // wiring is identical either way and never has to null-check.
  const object: Object3D = capsule ? capsule.group : new Group()
  if (!capsule) {
    object.name = 'player'
    object.userData.perfTag = 'player'
  }

  controller.teleport(spawn.x, spawn.y ?? 0, spawn.z)
  if (spawn.y === undefined) {
    controller.snapToGround()
  }

  let thirdPerson = false

  const syncMesh = (): void => {
    if (!capsule || !thirdPerson) {
      return
    }
    capsule.group.position.copy(controller.position)
    // Yaw only. Pitching the body with the head would tip the capsule over.
    capsule.group.rotation.y = controller.lookYaw
  }

  const applyBoom = (): void => {
    if (!thirdPerson) {
      return
    }
    // Pull straight back along the look ray from the eye. Deliberately not a
    // collision-swept boom: this is a debug view, and a boom that clips through
    // a wall is far less confusing here than one that silently shortens and
    // makes you think the player moved.
    lookDirection(controller.lookYaw, controller.lookPitch, _boom)
    camera.position.addScaledVector(_boom, -thirdPersonDistance)
    // Same reasoning as the orbit rig: a camera under the terrain reads as a
    // broken game rather than as a debug view.
    const floor = collision.groundHeightAt(camera.position.x, camera.position.z, camera.position.y + 1000) + 0.6
    if (camera.position.y < floor) {
      camera.position.y = floor
    }
  }

  return {
    controller,
    collision,
    propCollision,
    object,
    perfTag: 'player',
    position: controller.position,

    get enabled(): boolean {
      return controller.isEnabled
    },
    get grounded(): boolean {
      return controller.isGrounded
    },

    update: (delta: number): void => {
      controller.update(delta)
      syncMesh()
      applyBoom()
    },
    attach: (element: HTMLElement): void => controller.attach(element),
    detach: (): void => controller.detach(),
    setEnabled: (next: boolean): void => controller.setEnabled(next),
    setThirdPerson: (active: boolean): void => {
      thirdPerson = active
      capsule?.setVisible(active)
      if (active) {
        syncMesh()
      }
    },
    setColliderSource: (source: (() => Placement[]) | null): void => {
      propCollision?.setColliderSource(source)
    },
    invalidateColliders: (): void => {
      propCollision?.invalidate()
    },
    teleport: (x: number, y: number, z: number): void => {
      controller.teleport(x, y, z)
      syncMesh()
    },
    dispose: (): void => {
      controller.detach()
      capsule?.dispose()
    }
  }
}

export { groundForward, lookDirection, PlayerController, strafeRight } from './PlayerController'
export type { PlayerControllerOptions } from './PlayerController'
export { createCollisionWorld, PlayerCollisionWorld } from './collision'
export type { ColliderDefinition, CollisionWorldOptions } from './collision'
export { createCapsuleMesh } from './capsuleMesh'
export type { CapsuleMeshOptions, PlayerCapsule } from './capsuleMesh'
