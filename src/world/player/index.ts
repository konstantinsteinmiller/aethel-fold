import type { Object3D, PerspectiveCamera } from 'three'
import { Group, Vector3 } from 'three'
import type { CollisionWorld, Placement } from '../level/types'
import type { CharacterAppearance, EquipmentLoadout } from '../characters/equipment'
import { createCapsuleMesh, type PlayerCapsule } from './capsuleMesh'
import { createChibiBody, type PlayerBody } from './chibiBody'
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
  /**
   * The character the player walks around as, and what they are wearing.
   *
   * Both optional and both defaulted to the shipped figure, because two of the
   * three callers of this function are a test and a bench that have no roster to
   * read. `World` passes `roster.ts::playerLook()`; see the note there on why it
   * is resolved once at spawn rather than watched.
   *
   * Ignored when `body` is `'capsule'` — a debug cylinder has no face.
   */
  appearance?: CharacterAppearance
  loadout?: EquipmentLoadout
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
  /** Build a visible body. Off saves two draw calls and a geometry. */
  mesh?: boolean
  /**
   * Which body to build.
   *
   * `chibi` is the same rig the NPCs use and is the default. `capsule` keeps
   * the old placeholder, which is still the better view for collision work:
   * it *is* the collision shape, so any disagreement between what you see
   * and what you hit is visible rather than hidden inside a silhouette.
   */
  body?: 'chibi' | 'capsule'
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
    body = 'chibi',
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

  // One of the two is built, never both. `capsule` stays typed as itself so the
  // existing third-person/visibility plumbing is unchanged; `chibi` goes through
  // the same small interface.
  const capsule: PlayerCapsule | null = mesh && body === 'capsule' ? createCapsuleMesh({ radius, height }) : null
  const chibi: PlayerBody | null =
    mesh && body === 'chibi'
      ? createChibiBody({
          height,
          // Who the player is. Resolved by the caller rather than read here, so
          // this module keeps knowing nothing about storage — `World` owns the
          // decision and a test can hand in whoever it likes.
          ...(options.appearance ? { appearance: options.appearance } : {}),
          ...(options.loadout ? { loadout: options.loadout } : {})
        })
      : null
  // `mesh: false` still gets a root, so the caller's scene.add / registerRoot
  // wiring is identical either way and never has to null-check.
  const object: Object3D = capsule ? capsule.group : chibi ? chibi.object : new Group()
  /** Whichever body exists, behind the two calls the visibility paths need. */
  const visibleBody: { setVisible(v: boolean): void; setFirstPerson(a: boolean): void } | null =
    capsule ?? chibi
  if (!capsule) {
    object.name = 'player'
    object.userData.perfTag = 'player'
  }

  controller.teleport(spawn.x, spawn.y ?? 0, spawn.z)
  if (spawn.y === undefined) {
    controller.snapToGround()
  }

  let thirdPerson = false

  /**
   * Seconds since the last body sync.
   *
   * The chibi needs a real `dt` — its gait phase advances with distance and its
   * speed is measured from the position delta. Passing a fixed step would make
   * the cadence wrong at every frame rate but one.
   */
  let lastSync = 0
  let wasGrounded = true

  const syncMesh = (): void => {
    // Runs in first person too. The body stays in the scene there — invisible to
    // the camera inside it, but still casting a shadow — so it has to keep
    // following the controller or the shadow detaches and walks off on its own.
    if (capsule) {
      capsule.group.position.copy(controller.position)
      // Yaw only. Pitching the body with the head would tip the capsule over.
      capsule.group.rotation.y = controller.lookYaw
      return
    }
    if (!chibi) {
      return
    }
    const now = performance.now()
    const dt = lastSync === 0 ? 1 / 60 : Math.min(0.05, (now - lastSync) / 1000)
    lastSync = now
    chibi.sync(controller.position, controller.lookYaw, dt)
    // Jump on the leaving-the-ground edge, not on the key: the controller owns
    // when a jump actually happens, and buffering means the two can differ.
    const grounded = controller.isGrounded
    if (wasGrounded && !grounded) {
      chibi.jump()
    }
    wasGrounded = grounded
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
    /**
     * Enables the controller **and puts the body in the world**.
     *
     * The two were separate, and the body was never turned on: `setThirdPerson`
     * was the only thing that showed it and nothing called it. The result was a
     * player who walked around casting no shadow and leaving no trace — which is
     * why the character looked, reasonably, like it was not there at all.
     */
    setEnabled: (next: boolean): void => {
      controller.setEnabled(next)
      if (!visibleBody) {
        return
      }
      if (!next) {
        visibleBody?.setVisible(false)
        return
      }
      if (thirdPerson) {
        visibleBody?.setVisible(true)
      } else {
        visibleBody?.setFirstPerson(true)
      }
      syncMesh()
    },
    setThirdPerson: (active: boolean): void => {
      thirdPerson = active
      if (active) {
        visibleBody?.setVisible(true)
      } else {
        // Not hidden — switched to the first-person body, which keeps the
        // shadow and drops only the outline.
        visibleBody?.setFirstPerson(true)
      }
      syncMesh()
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
