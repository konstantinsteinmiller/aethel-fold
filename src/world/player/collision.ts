import { getPlaceable } from '../level/catalog'
import type { ColliderShape, CollisionWorld, Placement } from '../level/types'

/**
 * ─── Player collision ───────────────────────────────────────────────────────
 *
 * Implements `CollisionWorld` (level/types.ts) against the analytic collider
 * proxies that placed props carry. Nothing here ever touches a render mesh —
 * see the note on `ColliderShape` for why a box that matches the *walkable top*
 * beats the real silhouette.
 *
 * Three decisions that shape the whole file:
 *
 * **Placements are resolved into a flat, pooled collider list.** A `Placement`
 * stores a `defId` and a transform; the hot loops want world-space numbers and
 * a precomputed sin/cos. Resolving that per query would mean a Map lookup and a
 * trig pair per prop per frame. The pool is grown, never shrunk, and rebuilt in
 * place — so even a supplier that hands back a freshly-built array every call
 * costs zero allocation (GDD §5.2).
 *
 * **The collider source is a callback, not an import.** This module must not
 * know that a level editor exists; it asks for `Placement[]` and is done. The
 * definition lookup is injectable for the same reason — it lets tests and any
 * future non-catalog level format supply colliders directly.
 *
 * **Blocking is decided vertically first, and step height is part of that
 * test.** A collider whose top is within the player's step height simply
 * doesn't block: the player walks into it and `groundHeightAt` then lifts them
 * onto it. That is the entire step-up implementation, and it is why stairs and
 * slabs are walkable without a single special case in the controller.
 *
 * **Known limits.** `resolveMove` is a substepped discrete depenetration, not a
 * continuous sweep: substeps are capped at `MAX_SUBSTEPS`, so a collider
 * thinner than the player's radius can still be crossed at implausible speeds.
 * Colliders are XZ-rotated boxes and Y-axis cylinders only — no ramps, no
 * ceilings. Walking off a ledge uses the player's *centre*, so the capsule's
 * near edge overhangs by its radius before the fall starts. All three are
 * cheaper than the alternative and none is visible at the speeds this world
 * moves at.
 */

/** Just the two fields collision cares about on a `PlaceableDefinition`. */
export interface ColliderDefinition {
  collider: ColliderShape
  walkable: boolean
}

export interface CollisionWorldOptions {
  /** Terrain sampler — `Heightfield.heightAt` / `Terrain.heightAt`. */
  heightAt: (x: number, z: number) => number
  /** Total capsule height. Sets the vertical span tested against colliders. */
  playerHeight?: number
  /** Ledges up to this tall are walked over rather than blocked against. */
  stepHeight?: number
  /**
   * `defId` → collider. Defaults to the placeable catalog; overridable so this
   * module never has to be the one that knows where levels come from.
   */
  resolveDefinition?: (defId: string) => ColliderDefinition | undefined
}

/** World-space collision proxy. Pooled and rewritten in place, never recreated. */
interface Collider {
  /** 0 = box, 1 = cylinder. An int so the hot loop branches on a compare. */
  kind: number
  x: number
  z: number
  baseY: number
  topY: number
  halfX: number
  halfZ: number
  radius: number
  /** cos/sin of the placement's Y rotation, for the box's world↔local transform. */
  cos: number
  sin: number
  /** XZ bounding radius, for the broadphase reject. */
  bound: number
  walkable: boolean
}

const KIND_BOX = 0
const KIND_CYLINDER = 1

/**
 * Substeps of the horizontal move. Each is at most 3/4 of the player radius, so
 * a wall thicker than that cannot be stepped over in one frame at any speed the
 * clamped delta allows.
 */
const MAX_SUBSTEPS = 4
/**
 * Depenetration passes per substep. One pass resolves a wall; a second and
 * third resolve the corner where two walls push against each other, which
 * otherwise leaves the player wedged a few centimetres inside one of them.
 */
const RELAX_PASSES = 3
/** Below this, a push direction is degenerate and the fallback axis is used. */
const EPSILON_SQUARED = 1e-12

/**
 * `resolveMove` returns this same object every call — the interface's
 * `{ x, z }` return would otherwise be a guaranteed per-frame allocation on the
 * hottest path in the game (GDD §5.2). Callers must read it immediately; it is
 * invalid the moment `resolveMove` is called again.
 */
const _resolved = { x: 0, z: 0 }

export class PlayerCollisionWorld implements CollisionWorld {
  private readonly heightAt: (x: number, z: number) => number
  private readonly resolveDefinition: (defId: string) => ColliderDefinition | undefined

  private playerHeight: number
  private stepHeight: number

  private readonly colliders: Collider[] = []
  private count = 0
  /** Colliders appended past `count` for one frame — see `beginTransientColliders`. */
  private transientCount = 0

  private source: (() => Placement[]) | null = null
  private lastSource: Placement[] | null = null
  private lastLength = -1
  private dirty = true

  constructor(options: CollisionWorldOptions) {
    this.heightAt = options.heightAt
    this.playerHeight = options.playerHeight ?? 1.8
    this.stepHeight = options.stepHeight ?? 0.4
    this.resolveDefinition = options.resolveDefinition ?? getPlaceable
  }

  /**
   * Supplies the placed props to collide against.
   *
   * The callback is invoked on every query, so it must return the *live* array
   * rather than a copy — returning `[...placements]` would allocate twice a
   * frame forever. Rebuilds are triggered by array identity or length changing;
   * mutating a placement's transform in place is invisible to that check, so
   * call `invalidate()` after an in-place edit.
   */
  setColliderSource(source: (() => Placement[]) | null): void {
    this.source = source
    this.dirty = true
  }

  /** Forces a collider rebuild on the next query. */
  invalidate(): void {
    this.dirty = true
  }

  /**
   * Opens a batch of world-space colliders for this frame.
   *
   * Scattered props — trees, boulders, stones — are not `Placement`s and there
   * are tens of thousands of them, so they cannot go through the placement path:
   * that resolves a catalogue entry and a trig pair per prop and rebuilds
   * wholesale when anything changes. Instead the caller queries a spatial index
   * around the player and pushes only the handful within reach, every frame.
   *
   * They share the placement pool, appended after `count`, so the hot loops stay
   * one contiguous walk over one array rather than two loops over two.
   *
   * Call once per frame *before* moving the player. `sync()` runs first so
   * `count` is settled before anything is appended past it.
   */
  beginTransientColliders(): void {
    this.sync()
    this.transientCount = 0
  }

  /**
   * Adds one upright cylinder for this frame.
   *
   * Never walkable. A tree trunk is something to walk *around*; making it
   * standable would let the player levitate on contact, and `groundHeightAt`
   * skips non-walkable colliders entirely so this also keeps them out of the
   * ground query.
   */
  addTransientCylinder(x: number, z: number, baseY: number, topY: number, radius: number): void {
    const collider = this.at(this.count + this.transientCount)
    collider.kind = KIND_CYLINDER
    collider.x = x
    collider.z = z
    collider.baseY = baseY
    collider.topY = topY
    collider.radius = radius
    collider.halfX = radius
    collider.halfZ = radius
    collider.cos = 1
    collider.sin = 0
    collider.bound = radius
    collider.walkable = false
    this.transientCount++
  }


  /** Kept in sync with the controller so the vertical overlap test stays honest. */
  setPlayerMetrics(playerHeight: number, stepHeight: number): void {
    this.playerHeight = playerHeight
    this.stepHeight = stepHeight
  }

  /**
   * Live collider count — placements plus this frame's transients.
   * For the debug HUD and for tests.
   */
  get colliderCount(): number {
    return this.count + this.transientCount
  }

  /** Placement colliders only, excluding scatter. */
  get placementColliderCount(): number {
    return this.count
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  /**
   * Highest walkable surface at or below `fromY`.
   *
   * The `fromY` ceiling is what makes overhangs work: standing under a raised
   * platform, its top is above the probe and is ignored, so the player stays on
   * the terrain instead of being snapped 4 m up through solid geometry. The
   * controller probes from `feet + stepHeight`, which is also what turns a
   * knee-high slab into a step.
   */
  groundHeightAt(x: number, z: number, fromY: number): number {
    this.sync()

    let best = this.heightAt(x, z)

    const total = this.count + this.transientCount
    for (let i = 0; i < total; i++) {
      const collider = this.colliders[i]!
      // Cheapest rejects first: not standable, already lower than what we have,
      // or out of reach above the probe.
      if (!collider.walkable || collider.topY <= best || collider.topY > fromY) {
        continue
      }
      const dx = x - collider.x
      const dz = z - collider.z
      if (dx * dx + dz * dz > collider.bound * collider.bound) {
        continue
      }
      if (!containsPoint(collider, dx, dz)) {
        continue
      }
      best = collider.topY
    }

    return best
  }

  /**
   * Slides a circle of `radius` from (fromX, fromZ) toward (toX, toZ).
   *
   * Depenetration along the contact normal *is* the slide: pushing out along
   * the normal cancels exactly the component of the attempted motion that went
   * into the surface and leaves the tangential component untouched. A controller
   * that instead rejects the whole move when any part of it is blocked sticks on
   * every wall it brushes, which reads as broken long before the player can say
   * why.
   *
   * Returns a shared object — read it now, it is overwritten on the next call.
   */
  resolveMove(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    radius: number,
    y: number
  ): { x: number; z: number } {
    this.sync()

    // Colliders the player can simply step onto never block; ones that start
    // above the head are irrelevant. Both bounds are computed once, outside the
    // substep loop, because the player's feet do not move vertically here.
    const stepTop = y + this.stepHeight
    const head = y + this.playerHeight

    const deltaX = toX - fromX
    const deltaZ = toZ - fromZ
    const distance = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ)
    // Substep so a sprint into a thin wall cannot land the player on the far
    // side of it before a single depenetration pass ever runs.
    const substeps = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil(distance / (radius * 0.75))))
    const inverseSubsteps = 1 / substeps

    _resolved.x = fromX
    _resolved.z = fromZ

    for (let step = 0; step < substeps; step++) {
      _resolved.x += deltaX * inverseSubsteps
      _resolved.z += deltaZ * inverseSubsteps

      for (let pass = 0; pass < RELAX_PASSES; pass++) {
        let touched = false
        const total = this.count + this.transientCount
        for (let i = 0; i < total; i++) {
          const collider = this.colliders[i]!
          if (collider.topY <= stepTop || collider.baseY >= head) {
            continue
          }
          const dx = _resolved.x - collider.x
          const dz = _resolved.z - collider.z
          const reach = collider.bound + radius
          if (dx * dx + dz * dz > reach * reach) {
            continue
          }
          if (this.pushOut(collider, radius, dx, dz)) {
            touched = true
          }
        }
        // Nothing overlapped this pass, so nothing will overlap the next one.
        if (!touched) {
          break
        }
      }
    }

    return _resolved
  }

  // ── Depenetration ────────────────────────────────────────────────────────

  /** Pushes `_resolved` out of one collider. Returns true if it had to. */
  private pushOut(collider: Collider, radius: number, dx: number, dz: number): boolean {
    if (collider.kind === KIND_CYLINDER) {
      const reach = collider.radius + radius
      const lengthSquared = dx * dx + dz * dz
      if (lengthSquared >= reach * reach) {
        return false
      }
      if (lengthSquared > EPSILON_SQUARED) {
        const scale = reach / Math.sqrt(lengthSquared)
        _resolved.x = collider.x + dx * scale
        _resolved.z = collider.z + dz * scale
      } else {
        // Dead centre: no normal exists, so pick an axis rather than divide by
        // zero. Any direction is equally wrong and this one is deterministic.
        _resolved.x = collider.x + reach
        _resolved.z = collider.z
      }
      return true
    }

    // Box: work in the collider's own frame, where it is an AABB and the test
    // is a clamp. Rotating the point in is two multiplies cheaper than rotating
    // four planes out.
    const localX = collider.cos * dx - collider.sin * dz
    const localZ = collider.sin * dx + collider.cos * dz

    const clampedX = localX < -collider.halfX ? -collider.halfX : localX > collider.halfX ? collider.halfX : localX
    const clampedZ = localZ < -collider.halfZ ? -collider.halfZ : localZ > collider.halfZ ? collider.halfZ : localZ

    let pushX = localX - clampedX
    let pushZ = localZ - clampedZ
    const lengthSquared = pushX * pushX + pushZ * pushZ

    if (lengthSquared >= radius * radius) {
      return false
    }

    if (lengthSquared > EPSILON_SQUARED) {
      const length = Math.sqrt(lengthSquared)
      const scale = radius / length
      pushX = clampedX + pushX * scale
      pushZ = clampedZ + pushZ * scale
    } else {
      // Centre is *inside* the box — only possible if the player was already
      // overlapping (a prop dropped on top of them, or a teleport). Leave by
      // the nearest face, which is the shortest and least surprising exit.
      const outX = collider.halfX - Math.abs(localX)
      const outZ = collider.halfZ - Math.abs(localZ)
      if (outX < outZ) {
        pushX = (localX >= 0 ? 1 : -1) * (collider.halfX + radius)
        pushZ = localZ
      } else {
        pushX = localX
        pushZ = (localZ >= 0 ? 1 : -1) * (collider.halfZ + radius)
      }
    }

    // Back to world space.
    _resolved.x = collider.x + collider.cos * pushX + collider.sin * pushZ
    _resolved.z = collider.z - collider.sin * pushX + collider.cos * pushZ
    return true
  }

  // ── Collider cache ───────────────────────────────────────────────────────

  private sync(): void {
    if (!this.source) {
      this.count = 0
      return
    }
    const placements = this.source()
    if (!this.dirty && placements === this.lastSource && placements.length === this.lastLength) {
      return
    }
    this.rebuild(placements)
    this.lastSource = placements
    this.lastLength = placements.length
    this.dirty = false
  }

  private rebuild(placements: Placement[]): void {
    let count = 0

    for (let i = 0; i < placements.length; i++) {
      const placement = placements[i]!
      const definition = this.resolveDefinition(placement.defId)
      if (!definition) {
        continue
      }
      const shape = definition.collider
      if (shape.kind === 'none') {
        continue
      }

      const collider = this.at(count++)
      const scale = placement.scale
      collider.x = placement.x
      collider.z = placement.z
      // `Placement.y` is the prop's base — the editor has already folded the
      // definition's `groundOffset` into it — so the collider grows upward.
      collider.baseY = placement.y
      collider.walkable = definition.walkable
      collider.cos = Math.cos(placement.rotY)
      collider.sin = Math.sin(placement.rotY)

      if (shape.kind === 'cylinder') {
        collider.kind = KIND_CYLINDER
        collider.radius = shape.radius * scale
        collider.halfX = collider.radius
        collider.halfZ = collider.radius
        collider.topY = placement.y + shape.height * scale
        collider.bound = collider.radius
      } else {
        collider.kind = KIND_BOX
        collider.halfX = shape.halfX * scale
        collider.halfZ = shape.halfZ * scale
        collider.radius = 0
        collider.topY = placement.y + shape.height * scale
        // Rotation-invariant bound, so the broadphase never has to re-derive it.
        collider.bound = Math.sqrt(collider.halfX * collider.halfX + collider.halfZ * collider.halfZ)
      }
    }

    this.count = count
  }

  /** Pool accessor. Grows on demand and is never shrunk — see the class notes. */
  private at(index: number): Collider {
    let collider = this.colliders[index]
    if (!collider) {
      collider = {
        kind: KIND_BOX,
        x: 0,
        z: 0,
        baseY: 0,
        topY: 0,
        halfX: 0,
        halfZ: 0,
        radius: 0,
        cos: 1,
        sin: 0,
        bound: 0,
        walkable: false
      }
      this.colliders[index] = collider
    }
    return collider
  }
}

/** Is (x, z) — given as an offset from the collider's centre — over its top face? */
const containsPoint = (collider: Collider, dx: number, dz: number): boolean => {
  if (collider.kind === KIND_CYLINDER) {
    return dx * dx + dz * dz <= collider.radius * collider.radius
  }
  const localX = collider.cos * dx - collider.sin * dz
  const localZ = collider.sin * dx + collider.cos * dz
  return Math.abs(localX) <= collider.halfX && Math.abs(localZ) <= collider.halfZ
}

export const createCollisionWorld = (options: CollisionWorldOptions): PlayerCollisionWorld =>
  new PlayerCollisionWorld(options)
