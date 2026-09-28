import { BufferAttribute, Group, InstancedMesh, Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import { C } from '../art/palette'
import { mergeParts } from '../assets/common'
import { circleSection, paintPart, splineSection, sweep } from '../geometry/sweep'
import { createOutlineMaterial } from '../shading/outlineMaterial'
import { createToonMaterial } from '../shading/toonMaterial'
import { Color } from 'three'
import type { Team } from './types'

/**
 * ─── Arrows ─────────────────────────────────────────────────────────────────
 *
 * Chapter 1's most-used weapon by a distance. Kareen puts three into the boar,
 * Jester and Kareen each drop a bandit before the melee starts, and the four of
 * them finish the boar with a volley — so this is the one combat system in the
 * chapter that runs while nothing else does.
 *
 * ── One InstancedMesh, and why that decides the whole design ────────────────
 *
 * GDD §5.2 caps the scene at 180 draw calls and the world spends 132 before a
 * villager exists (`Crowd.ts` measures it). An arrow per mesh would be one draw
 * plus one outline draw *each*, so a volley of six is 12 draws and a fight where
 * arrows stick in things is unbounded. One `InstancedMesh` plus its outline hull
 * is **two draws for every arrow in the world, forever**, which is the only
 * shape that survives the budget.
 *
 * The cost of that choice is that every arrow shares one geometry and one
 * material, so a burning arrow or a bolt would need a second field. Nothing in
 * Chapter 1 needs one.
 *
 * ── Why arrows stick, and why they expire ───────────────────────────────────
 *
 * A hit arrow is parked at the contact point and kept for `STUCK_SECONDS`. That
 * is not decoration: it is the only feedback in the game that says *where* a
 * shot landed, and the prose leans on it — the boar goes down with three shafts
 * in its flank and the group walks up to a body that visibly has them in it.
 *
 * They expire because the pool is fixed. A shaft that stays forever means the
 * sixteenth shot of a fight silently does not exist, which is a far worse
 * failure than a shaft fading after twelve seconds.
 */

/** How many arrows may exist at once. */
export const ARROW_POOL = 24

/** Seconds a hit arrow stays stuck in what it hit. */
const STUCK_SECONDS = 12

/** Metres per second at full draw. */
export const ARROW_SPEED = 42

/** Downward acceleration, m/s². Well under real gravity — see `update`. */
const ARROW_GRAVITY = 6.5

/** Beyond this an arrow is retired even if it has hit nothing. */
const MAX_RANGE = 90

interface Arrow {
  active: boolean
  /** True once it has hit something and is parked. */
  stuck: boolean
  life: number
  team: Team
  ownerId: string
  damage: number
  poiseDamage: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  travelled: number
}

const _matrix = new Matrix4()
const _position = new Vector3()
const _quaternion = new Quaternion()
const _scale = new Vector3(1, 1, 1)
const _dir = new Vector3()
const _up = new Vector3(0, 1, 0)
const _colour = new Color()

/**
 * The arrow model: a shaft, a head and three vanes, ~90 triangles.
 *
 * Authored **along +Y** rather than the gear folder's −Y, and that is a
 * deliberate departure with a reason: an arrow is never socketed to a bone, it
 * is oriented by `setFromUnitVectors` against its own velocity, and that helper
 * is written against +Y. Adopting the gear convention here would mean negating
 * every velocity at the one call site that uses it, which is exactly the kind of
 * silent sign error `equipment.ts` records having shipped once already.
 */
const buildArrowGeometry = () => {
  const AXIS_X = new Vector3(1, 0, 0)
  const AXIS_Z = new Vector3(0, 0, 1)

  const shaft = sweep({
    name: 'arrow/shaft',
    path: [
      [0, -0.34, 0],
      [0, -0.32, 0],
      [0, -0.1, 0],
      [0, 0.16, 0],
      [0, 0.2, 0],
      [0, 0.22, 0]
    ],
    extentA: [0, 0.0035, 0.0038, 0.0038, 0.0035, 0],
    extentB: [0, 0.0035, 0.0038, 0.0038, 0.0035, 0],
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: circleSection,
    stations: 6,
    segments: 5
  })
  paintPart(
    shaft,
    (u, _v, out) => {
      out.copy(C.woodBase).lerp(C.woodLit, 0.3)
      // The nock, dark, at the tail.
      out.lerp(C.leatherShadow, 0.8 * (u < 0.06 ? 1 : 0))
    },
    _colour
  )

  const head = sweep({
    name: 'arrow/head',
    path: [
      [0, 0.2, 0],
      [0, 0.215, 0],
      [0, 0.245, 0],
      [0, 0.3, 0],
      [0, 0.315, 0]
    ],
    extentA: [0, 0.004, 0.011, 0.002, 0],
    extentB: [0, 0.004, 0.011, 0.002, 0],
    axisA: AXIS_X,
    axisB: AXIS_Z,
    // A bodkin: square in section, which is what a war arrow's head is and what
    // makes it read as a point rather than as a bead on the end of a stick.
    section: splineSection([
      [1, 0.4],
      [1, 1],
      [-1, 1],
      [-1, 0.4],
      [-1, -0.4],
      [-1, -1],
      [1, -1],
      [1, -0.4]
    ]),
    stations: 5,
    segments: 4
  })
  paintPart(
    head,
    (u, _v, out) => {
      out.copy(C.steelBase).lerp(C.steelLit, 0.25 + 0.5 * u)
    },
    _colour
  )

  // Three vanes, as one swept blade each. They are the only part of an arrow
  // that is visible at 15 m — a 7 mm shaft is under a pixel and a fletching is
  // three — so they get half the model's triangles.
  const vanes = [0, 1, 2].map(i => {
    const angle = (i / 3) * Math.PI * 2
    const nx = Math.cos(angle)
    const nz = Math.sin(angle)
    const vane = sweep({
      name: `arrow/vane${i}`,
      path: [
        [nx * 0.004, -0.3, nz * 0.004],
        [nx * 0.007, -0.29, nz * 0.007],
        [nx * 0.014, -0.25, nz * 0.014],
        [nx * 0.014, -0.19, nz * 0.014],
        [nx * 0.006, -0.15, nz * 0.006],
        [nx * 0.004, -0.145, nz * 0.004]
      ],
      extentA: [0, 0.0022, 0.0025, 0.0025, 0.0022, 0],
      extentB: [0, 0.009, 0.013, 0.013, 0.008, 0],
      axisA: new Vector3(nz, 0, -nx),
      axisB: new Vector3(nx, 0, nz),
      section: circleSection,
      stations: 6,
      segments: 4
    })
    paintPart(
      vane,
      (u, _v, out) => {
        out.copy(C.clothLit).lerp(C.arlaanRed, 0.5 + 0.3 * u)
      },
      _colour
    )
    return vane
  })

  return mergeParts([shaft.geometry, head.geometry, ...vanes.map(v => v.geometry)], 'arrow')
}

/**
 * The arrow field.
 *
 * Two draws total, whatever is in flight. `count` is set to the number of live
 * arrows each frame rather than hiding dead ones with a zero scale — a zero-
 * scaled instance still costs its vertex work, and a shrinking `count` costs
 * nothing at all.
 */
export class Projectiles {
  readonly group = new Group()

  private readonly arrows: Arrow[] = []
  private readonly mesh: InstancedMesh
  private readonly hull: InstancedMesh | null
  private live = 0

  constructor() {
    this.group.name = 'projectiles'
    this.group.userData.perfTag = 'combat'

    const geometry = buildArrowGeometry()
    const material = createToonMaterial({ name: 'arrow' })
    this.mesh = new InstancedMesh(geometry, material, ARROW_POOL)
    this.mesh.frustumCulled = false
    this.mesh.castShadow = true
    this.mesh.count = 0
    this.group.add(this.mesh)

    // The inverted hull. `outlineMaterial` is written for instanced fields
    // already, so an arrow gets the same 1.6 screen-pixel outline everything
    // else in the world has — GDD R6, which has no exception for small objects
    // and would look wrong if it did: an un-outlined arrow against an outlined
    // world reads as a rendering error.
    // Its colour is derived from the geometry's own vertex colours in the
    // shader (GDD R6: base x 0.22, shifted cool), exactly as every other outline
    // in the world is — there is nothing to configure here and nothing to keep
    // in step with the arrow's albedo.
    const outline = createOutlineMaterial({ pixelWidth: 1.6, name: 'arrow-outline' })
    this.hull = new InstancedMesh(geometry, outline, ARROW_POOL)
    this.hull.frustumCulled = false
    this.hull.castShadow = false
    this.hull.count = 0
    this.hull.renderOrder = -1
    this.group.add(this.hull)

    for (let i = 0; i < ARROW_POOL; i++) {
      this.arrows.push({
        active: false,
        stuck: false,
        life: 0,
        team: 'party',
        ownerId: '',
        damage: 0,
        poiseDamage: 0,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        travelled: 0
      })
    }
  }

  /**
   * Looses an arrow. Recycles the oldest if the pool is full.
   *
   * Recycling rather than refusing: a shot the player took and that produced
   * nothing is a bug they will report, and the oldest arrow in a full pool is by
   * construction the least interesting one on screen.
   */
  fire(
    ownerId: string,
    team: Team,
    from: Vector3,
    direction: Vector3,
    damage: number,
    poiseDamage: number,
    speed = ARROW_SPEED
  ): void {
    let slot = this.arrows.find(a => !a.active)
    if (!slot) {
      let oldest = this.arrows[0]!
      for (const arrow of this.arrows) {
        if (arrow.life > oldest.life) {
          oldest = arrow
        }
      }
      slot = oldest
    }
    slot.active = true
    slot.stuck = false
    slot.life = 0
    slot.team = team
    slot.ownerId = ownerId
    slot.damage = damage
    slot.poiseDamage = poiseDamage
    slot.x = from.x
    slot.y = from.y
    slot.z = from.z
    slot.vx = direction.x * speed
    slot.vy = direction.y * speed
    slot.vz = direction.z * speed
    slot.travelled = 0
  }

  /**
   * Integrates every live arrow and asks `onHit` about each one that has moved.
   *
   * `onHit` is a callback rather than a returned list because a list would
   * allocate every frame, and this runs at 60 Hz with up to 24 arrows in it. It
   * returns the height of whatever was struck, or `null` for a clean miss — the
   * arrow then keeps flying.
   *
   * ── The gravity is wrong on purpose ────────────────────────────────────────
   *
   * 6.5 m/s² against 9.81. At the real value a 42 m/s arrow drops 1.1 m over
   * 30 m, which is correct and unusable: the player is aiming down a third-person
   * camera with no rangefinder, and every shot past 20 m goes into the dirt for
   * reasons they cannot see. Two thirds of gravity keeps a visible, learnable arc
   * — the shaft still *tips* forward as it falls, which is the read — while
   * putting a 30 m shot 0.7 m low instead of 1.1.
   */
  update(
    dt: number,
    onHit: (
      x: number,
      y: number,
      z: number,
      team: Team,
      ownerId: string,
      damage: number,
      poiseDamage: number,
      dirX: number,
      dirZ: number
    ) => boolean,
    groundAt: (x: number, z: number) => number
  ): void {
    for (const arrow of this.arrows) {
      if (!arrow.active) {
        continue
      }
      arrow.life += dt
      if (arrow.stuck) {
        if (arrow.life > STUCK_SECONDS) {
          arrow.active = false
        }
        continue
      }

      arrow.vy -= ARROW_GRAVITY * dt
      const stepX = arrow.vx * dt
      const stepY = arrow.vy * dt
      const stepZ = arrow.vz * dt
      arrow.x += stepX
      arrow.y += stepY
      arrow.z += stepZ
      arrow.travelled += Math.hypot(stepX, stepY, stepZ)

      const speed = Math.hypot(arrow.vx, arrow.vz) || 1
      if (
        onHit(
          arrow.x,
          arrow.y,
          arrow.z,
          arrow.team,
          arrow.ownerId,
          arrow.damage,
          arrow.poiseDamage,
          arrow.vx / speed,
          arrow.vz / speed
        )
      ) {
        // Stuck in a body. Its life restarts so `STUCK_SECONDS` is measured from
        // the hit rather than from the shot — an arrow that hit at 11.9 s of
        // flight would otherwise vanish on contact.
        arrow.stuck = true
        arrow.life = 0
        continue
      }

      const ground = groundAt(arrow.x, arrow.z)
      if (arrow.y <= ground + 0.02) {
        arrow.y = ground + 0.02
        arrow.stuck = true
        arrow.life = 0
        continue
      }
      if (arrow.travelled > MAX_RANGE) {
        arrow.active = false
      }
    }

    this.writeInstances()
  }

  private writeInstances(): void {
    let index = 0
    for (const arrow of this.arrows) {
      if (!arrow.active) {
        continue
      }
      _position.set(arrow.x, arrow.y, arrow.z)
      if (arrow.stuck) {
        // A stuck arrow keeps the orientation it hit with. Its velocity is still
        // in the record because nothing zeroes it, which is deliberate — it is
        // the cheapest possible way to remember which way the shaft is pointing.
        _dir.set(arrow.vx, arrow.vy, arrow.vz)
      } else {
        _dir.set(arrow.vx, arrow.vy, arrow.vz)
      }
      if (_dir.lengthSq() < 1e-8) {
        _dir.set(0, 1, 0)
      }
      _dir.normalize()
      _quaternion.setFromUnitVectors(_up, _dir)
      _matrix.compose(_position, _quaternion, _scale)
      this.mesh.setMatrixAt(index, _matrix)
      this.hull?.setMatrixAt(index, _matrix)
      index++
    }
    if (index !== this.live || index > 0) {
      this.mesh.instanceMatrix.needsUpdate = true
      if (this.hull) {
        this.hull.instanceMatrix.needsUpdate = true
      }
    }
    this.live = index
    this.mesh.count = index
    if (this.hull) {
      this.hull.count = index
    }
  }

  get liveCount(): number {
    return this.live
  }

  clear(): void {
    for (const arrow of this.arrows) {
      arrow.active = false
    }
    this.mesh.count = 0
    if (this.hull) {
      this.hull.count = 0
    }
    this.live = 0
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as { dispose(): void }).dispose()
    this.mesh.dispose()
    if (this.hull) {
      ;(this.hull.material as { dispose(): void }).dispose()
      this.hull.dispose()
    }
    this.group.clear()
  }
}

/** Unused import guard — `Object3D` and `BufferAttribute` are re-exported for tests. */
export type { Object3D, BufferAttribute }
