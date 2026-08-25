import type { Vector3 } from 'three'

/**
 * ─── Heightfield horizon occlusion ──────────────────────────────────────────
 *
 * Frustum culling only removes what is off-screen. In a valley, most of what is
 * *on* screen is behind a ridge — and in a heightfield world the terrain is by
 * far the dominant occluder, so testing against the height function directly
 * beats rasterising occluders into a depth buffer for a fraction of the code.
 *
 * ── Three properties make this cheap ────────────────────────────────────────
 *
 * **It depends only on camera position, not orientation.** A ridge that hides a
 * grove keeps hiding it however you turn. So results cache across every frame in
 * which the camera has not *moved* far — which, during ordinary look-around, is
 * all of them. This is the whole reason it's affordable; a view-dependent test
 * would have to re-run on every rotation.
 *
 * **Coarse sampling errs the safe way.** A march that steps over a thin ridge
 * reports "visible" and simply culls nothing. Over-culling — hiding something
 * the player can see — is the failure that looks like a bug, so every knob here
 * is biased toward visible: a generous clearance margin, samples that skip the
 * ends of the ray, and three sample points that must *all* be blocked.
 *
 * **Unknown means visible.** When the cache invalidates, cells revert to visible
 * and are re-tested over the following frames under a budget. The cost of that
 * is a few frames of drawing more; the cost of the alternative — trusting a
 * stale "occluded" after the camera moved — is geometry popping out of view.
 */

export interface TerrainOcclusionOptions {
  /** Re-test everything once the camera has moved this far, in metres. */
  invalidateDistance?: number
  /** Sphere tests allowed per frame. Spreads the cost over ~10 frames. */
  testBudget?: number
  /** Samples along each ray. Coarse on purpose — see the class notes. */
  steps?: number
  /**
   * Terrain must exceed the ray by this much to count as blocking. Absorbs the
   * gap between the sampled height and the tessellated mesh the player sees.
   */
  clearance?: number
  /** Nothing beyond this is tested; fog has removed it anyway. */
  maxDistance?: number
}

export class TerrainOcclusion {
  /** Bumped when the cache is invalidated. Consumers compare against it. */
  version = 1

  private isEnabled = true

  /**
   * Toggling **invalidates every cached result**. Without that, disabling this
   * leaves consumers holding their last `occluded: true` and the cells stay
   * culled — which silently made an A/B measurement of this feature compare two
   * identical states and report a saving of exactly zero.
   */
  get enabled(): boolean {
    return this.isEnabled
  }

  set enabled(on: boolean) {
    if (this.isEnabled === on) {
      return
    }
    this.isEnabled = on
    this.version++
  }

  readonly stats = { tested: 0, occluded: 0, budgetHit: false }

  private readonly heightAt: (x: number, z: number) => number
  private readonly invalidateDistanceSq: number
  private readonly testBudget: number
  private readonly steps: number
  private readonly clearance: number
  private readonly maxDistance: number

  private lastX = Number.POSITIVE_INFINITY
  private lastY = Number.POSITIVE_INFINITY
  private lastZ = Number.POSITIVE_INFINITY
  private eyeX = 0
  private eyeY = 0
  private eyeZ = 0
  private remaining = 0

  constructor(heightAt: (x: number, z: number) => number, options: TerrainOcclusionOptions = {}) {
    const {
      invalidateDistance = 8,
      testBudget = 24,
      steps = 20,
      clearance = 1.5,
      maxDistance = 320
    } = options
    this.heightAt = heightAt
    this.invalidateDistanceSq = invalidateDistance * invalidateDistance
    this.testBudget = testBudget
    this.steps = steps
    this.clearance = clearance
    this.maxDistance = maxDistance
  }

  /** Call once per frame, before any consumer runs its cull. */
  beginFrame(camera: Vector3): void {
    this.eyeX = camera.x
    this.eyeY = camera.y
    this.eyeZ = camera.z
    this.remaining = this.testBudget
    this.stats.tested = 0
    this.stats.occluded = 0
    this.stats.budgetHit = false

    const dx = camera.x - this.lastX
    const dy = camera.y - this.lastY
    const dz = camera.z - this.lastZ
    if (dx * dx + dy * dy + dz * dz > this.invalidateDistanceSq) {
      this.lastX = camera.x
      this.lastY = camera.y
      this.lastZ = camera.z
      this.version++
    }
  }

  /** False when the per-frame budget is spent — callers then keep "visible". */
  canTest(): boolean {
    return this.isEnabled && this.remaining > 0
  }

  /**
   * Is a region hidden behind terrain?
   *
   * `topY` is the height of the **tallest thing in it**, and `spread` its
   * horizontal half-extent. Those are deliberately separate parameters rather
   * than a bounding-sphere radius, and the distinction is what makes this test
   * useful at all: a 48 m cell of 7 m trees has a bounding sphere ~35 m in
   * radius, almost entirely from horizontal spread. Probing `centre + radius`
   * therefore aimed 35 m above the treetops, where no ridge in this world
   * reaches — the first version culled 1 cell in 120 for exactly that reason.
   *
   * Three rays, all of which must be blocked: the top of the region and its two
   * horizontal extremes at that height. One ray through the centre would cull a
   * grove whose edge is plainly visible around the side of a ridge.
   */
  isRegionOccluded(x: number, topY: number, z: number, spread: number): boolean {
    if (!this.isEnabled || this.remaining <= 0) {
      return false
    }
    this.remaining--
    this.stats.tested++

    const dx = x - this.eyeX
    const dz = z - this.eyeZ
    const horizontal = Math.sqrt(dx * dx + dz * dz)
    if (horizontal < spread * 1.5 || horizontal > this.maxDistance) {
      // Too close to say anything useful, or far enough that fog has it.
      return false
    }

    // Perpendicular in the ground plane, for the two side samples.
    const px = (-dz / horizontal) * spread
    const pz = (dx / horizontal) * spread

    const blocked =
      this.isRayBlocked(x, topY, z) &&
      this.isRayBlocked(x + px, topY, z + pz) &&
      this.isRayBlocked(x - px, topY, z - pz)

    if (blocked) {
      this.stats.occluded++
    }
    return blocked
  }

  /**
   * Marches the height field from the eye to a point. Samples skip both ends:
   * near the camera the ray is inside whatever the camera is standing on, and
   * at the far end it is at the target itself, which is not an occluder of
   * itself.
   */
  private isRayBlocked(targetX: number, targetY: number, targetZ: number): boolean {
    const dx = targetX - this.eyeX
    const dy = targetY - this.eyeY
    const dz = targetZ - this.eyeZ

    for (let i = 1; i < this.steps; i++) {
      const t = i / this.steps
      // Skip the last 8 %: terrain immediately under the target must not count
      // as occluding it.
      if (t > 0.92) {
        break
      }
      const sx = this.eyeX + dx * t
      const sy = this.eyeY + dy * t
      const sz = this.eyeZ + dz * t
      if (this.heightAt(sx, sz) > sy + this.clearance) {
        return true
      }
    }
    return false
  }
}
