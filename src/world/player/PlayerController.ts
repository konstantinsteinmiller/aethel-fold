import { type PerspectiveCamera, Vector3 } from 'three'
import type { CollisionWorld } from '../level/types'

/**
 * ─── First-person capsule controller ────────────────────────────────────────
 *
 * A sibling of `OrbitCameraController`: same hand-rolled, no-dependency,
 * zero-allocation shape, same `1 - exp(-k·dt)` smoothing, same "attach to an
 * element, feed it a delta" contract. The two are designed to coexist — only
 * one should be `enabled` at a time, and a disabled controller ignores every
 * event it receives, so the world can flip between orbit and first-person
 * without rebinding anything.
 *
 * Where it deliberately differs from the orbit rig:
 *
 * **Look is not damped.** The orbit camera critically-damps its yaw and pitch
 * because it is a cinematic rig and a snapping camera makes LOD crossfades read
 * as pops. A first-person head is not a cinematic rig: any smoothing between
 * the mouse and the view is felt directly as input lag, and 30 ms of it is the
 * difference between "responsive" and "swimming". Movement is damped; look is
 * 1:1.
 *
 * **The strafe axis is `cross(forward, up) = (-f.z, 0, f.x)`.** The orbit
 * camera shipped the exact negation of this for a while, which swapped A and D.
 * `strafeRight` is exported and unit-tested purely so that cannot recur.
 *
 * **Step-up lives in the collision world, not here.** Anything the player can
 * step over simply doesn't block horizontally, and `groundHeightAt` — probed
 * from `feet + stepHeight` — then reports its top as the ground. The controller
 * only has to smooth the *eye* through the resulting jump, which is what makes
 * stairs feel like stairs instead of like a teleport every 40 cm.
 */

export interface PlayerControllerOptions {
  camera: PerspectiveCamera
  collision: CollisionWorld
  /** Capsule radius. 0.35 m ≈ shoulder width, and clears a 1 m gap. */
  radius?: number
  /** Total capsule height, feet to crown. */
  height?: number
  /** Camera height above the feet. Slightly under `height` — eyes aren't on top. */
  eyeHeight?: number
  /** Ground speed in m/s. */
  walkSpeed?: number
  sprintMultiplier?: number
  /** Apex of a standing jump, in metres. Jump impulse is derived from it. */
  jumpHeight?: number
  /** Deliberately well above 9.81 — real gravity makes a jump feel like a balloon. */
  gravity?: number
  /** Ledges up to this tall are stepped over rather than blocked against. */
  stepHeight?: number
  /** Radians of yaw per pixel of pointer movement. */
  lookSensitivity?: number
  /** 0 disables head bob entirely. */
  bobStrength?: number
  /** Start disabled when the orbit camera owns the frame. */
  enabled?: boolean
}

/** Just under ±90°: exactly 90° makes the yaw axis degenerate at the poles. */
const PITCH_LIMIT = Math.PI / 2 - 0.001

/**
 * Velocity convergence rates. Ground is stiff so a direction change is
 * immediate; air is soft so a jump commits to its arc instead of letting the
 * player steer mid-flight like a drone.
 */
const GROUND_DAMPING = 16
const AIR_DAMPING = 3.5

/** Below this drop the player is considered to still be touching the ground. */
const GROUND_EPSILON = 0.001
/**
 * Terminal velocity. The ground probe is swept, so this isn't needed for
 * correctness — it's here so a fall off the map stays readable and so the
 * impact-scaled landing dip has a bounded input.
 */
const MAX_FALL_SPEED = 55

/** Jump pressed this long before landing still fires on touchdown. */
const JUMP_BUFFER = 0.12
/** Jump pressed this long after walking off a ledge still fires. */
const COYOTE_TIME = 0.1

/** How fast the eye catches up to the body after a step or a landing. */
const EYE_CATCHUP_DAMPING = 11
/** Clamp, so a 6 m fall doesn't bury the camera in the floor for a frame. */
const EYE_OFFSET_LIMIT = 0.45
/** Steps smaller than this are below the noise floor and aren't worth smoothing. */
const STEP_SMOOTH_MIN = 0.02
const LANDING_DIP_PER_SPEED = 0.022

/** Bob phase advances with distance travelled, so it is stride-locked. */
const BOB_RATE = 1.55
const BOB_BLEND_DAMPING = 8
const BOB_ROLL = 0.09

const _forwardScratch = new Vector3()
const _forward = new Vector3()
const _right = new Vector3()
const _wish = new Vector3()

/** Horizontal look direction. Matches three's convention: yaw 0 faces −Z. */
export const groundForward = (yaw: number, out: Vector3): Vector3 => out.set(-Math.sin(yaw), 0, -Math.cos(yaw))

/**
 * Strafe axis — `normalize(cross(forward, up))`, i.e. `(-f.z, 0, f.x)`.
 *
 * Written out from the cross product rather than as the collapsed
 * `(cos yaw, 0, -sin yaw)` on purpose: the collapsed form is where the sign
 * error that swapped A and D in the orbit camera came from, and this way the
 * definition and the code are the same line.
 */
export const strafeRight = (yaw: number, out: Vector3): Vector3 => {
  groundForward(yaw, _forwardScratch)
  return out.set(-_forwardScratch.z, 0, _forwardScratch.x)
}

/** Full look direction including pitch. For raycasts and interaction probes. */
export const lookDirection = (yaw: number, pitch: number, out: Vector3): Vector3 => {
  const cosPitch = Math.cos(pitch)
  return out.set(-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch)
}

export class PlayerController {
  readonly camera: PerspectiveCamera
  /** Feet position. Read-only to the outside — use `teleport`. */
  readonly position = new Vector3()
  readonly velocity = new Vector3()

  readonly radius: number
  readonly height: number
  readonly eyeHeight: number
  readonly stepHeight: number

  walkSpeed: number
  sprintMultiplier: number
  lookSensitivity: number
  bobStrength: number

  private readonly collision: CollisionWorld
  private readonly gravity: number
  private readonly jumpSpeed: number

  private yaw = 0
  private pitch = 0

  private grounded = false
  private coyoteTimer = 0
  private jumpBuffer = 0

  /** This frame's vertical displacement, computed with the step's *mean* velocity. */
  private verticalStep = 0
  /** Eye minus body, in metres. Decays to zero; see `EYE_CATCHUP_DAMPING`. */
  private eyeOffset = 0
  private bobPhase = 0
  private bobLevel = 0

  private enabled: boolean
  private element: HTMLElement | null = null
  private readonly keys = new Set<string>()

  /** Pointer id currently drag-looking, or -1. Only used in the fallback path. */
  private dragPointer = -1
  private dragX = 0
  private dragY = 0
  private locked = false
  /**
   * Set once the browser refuses a lock (iOS Safari, an embedded portal iframe
   * without `allow="pointer-lock"`, a user dismissing the prompt). After that we
   * stop asking and stay on drag-look — re-requesting on every click produces a
   * console error per click and a browser-level nag.
   */
  private lockUnavailable = false

  constructor(options: PlayerControllerOptions) {
    this.camera = options.camera
    this.collision = options.collision
    this.radius = options.radius ?? 0.35
    this.height = options.height ?? 1.8
    this.eyeHeight = options.eyeHeight ?? 1.7
    this.stepHeight = options.stepHeight ?? 0.4
    this.walkSpeed = options.walkSpeed ?? 5.2
    this.sprintMultiplier = options.sprintMultiplier ?? 1.85
    this.lookSensitivity = options.lookSensitivity ?? 0.0022
    this.bobStrength = options.bobStrength ?? 0.045
    this.gravity = options.gravity ?? 22
    this.enabled = options.enabled ?? true

    // v² = 2·g·h — derive the impulse from the apex so tuning the *feel*
    // (how high can I get) never means solving for a velocity by hand.
    this.jumpSpeed = Math.sqrt(2 * this.gravity * (options.jumpHeight ?? 1.15))
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  attach(element: HTMLElement): void {
    this.detach()
    this.element = element

    element.addEventListener('pointerdown', this.onPointerDown)
    element.addEventListener('pointermove', this.onPointerMove)
    element.addEventListener('pointerup', this.onPointerUp)
    element.addEventListener('pointercancel', this.onPointerUp)
    // Pointer-lock movement arrives as `mousemove` on the document, not as a
    // pointer event on the canvas — the canvas gets no pointer events at all
    // while locked, which is exactly why the two paths are separate handlers.
    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    document.addEventListener('pointerlockerror', this.onPointerLockError)
  }

  detach(): void {
    const element = this.element
    if (element) {
      element.removeEventListener('pointerdown', this.onPointerDown)
      element.removeEventListener('pointermove', this.onPointerMove)
      element.removeEventListener('pointerup', this.onPointerUp)
      element.removeEventListener('pointercancel', this.onPointerUp)
    }
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    document.removeEventListener('pointerlockerror', this.onPointerLockError)

    this.exitPointerLock()
    this.keys.clear()
    this.dragPointer = -1
    this.element = null
  }

  /**
   * Toggles the whole controller. Disabling releases the pointer and drops every
   * held key, so the orbit camera can take over without inheriting a stuck W.
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return
    }
    this.enabled = enabled
    if (!enabled) {
      this.keys.clear()
      this.velocity.set(0, 0, 0)
      this.dragPointer = -1
      this.exitPointerLock()
    }
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  get isGrounded(): boolean {
    return this.grounded
  }

  get isPointerLocked(): boolean {
    return this.locked
  }

  /** True once the browser has refused a lock; the UI can offer drag-look hints. */
  get isPointerLockUnavailable(): boolean {
    return this.lockUnavailable
  }

  /** Places the player and re-seats the camera immediately, without a frame of lag. */
  teleport(x: number, y: number, z: number): void {
    this.position.set(x, y, z)
    this.velocity.set(0, 0, 0)
    this.verticalStep = 0
    this.eyeOffset = 0
    this.bobLevel = 0
    this.grounded = false
    this.coyoteTimer = 0
    this.jumpBuffer = 0
    this.writeCamera(0, 0)
  }

  /**
   * Slides the feet horizontally, leaving the fall alone.
   *
   * ── Why this is not `teleport` ─────────────────────────────────────────
   *
   * `teleport` is a *cut*: it clears the velocity, the vertical step, the eye
   * lag, the bob, the coyote timer **and the grounded flag**, which is exactly
   * right for putting somebody somewhere else and exactly wrong for nudging
   * them 40 cm. Called every frame — which is what a scripted settle onto a
   * seat does — clearing `grounded` sixty times a second re-enters the fall on
   * every one of them, and the player lands with a step-down each time.
   *
   * This is the other half of that pair: the horizontal position moves, the
   * camera follows it with no frame of lag, and nothing about the vertical
   * state is touched. `world/interaction/SitController` is the caller — it owns
   * the last half metre onto a seat and does not want a physics step for it.
   */
  slideTo(x: number, z: number): void {
    this.position.x = x
    this.position.z = z
    // The move was authored, not walked. A leftover velocity would be spent on
    // the frame the controls come back, in whatever direction the seat was.
    this.velocity.x = 0
    this.velocity.z = 0
    this.writeCamera(0, 0)
  }

  /** Absolute look angles, in radians. Yaw is unbounded; pitch is clamped. */
  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw
    this.pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT)
  }

  get lookYaw(): number {
    return this.yaw
  }

  get lookPitch(): number {
    return this.pitch
  }

  /** Drops the player onto whatever is under them. Used at spawn. */
  snapToGround(): void {
    // Probe from well overhead so the highest surface below the spawn point
    // wins, rather than whatever the feet happen to be level with.
    this.position.y = this.collision.groundHeightAt(this.position.x, this.position.z, this.position.y + 1000)
    this.velocity.set(0, 0, 0)
    this.verticalStep = 0
    this.grounded = true
    this.eyeOffset = 0
    this.writeCamera(0, 0)
  }

  // ── Input ────────────────────────────────────────────────────────────────

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled) {
      return
    }
    // Only a mouse can hold a pointer lock. Asking on a touch pointer costs the
    // player their first drag — the request fails asynchronously, so the tap
    // that triggered it has already been swallowed by the time we learn that.
    if (event.pointerType === 'mouse' && this.requestPointerLock()) {
      return
    }
    // Fallback: drag-look. Also the touch path — a finger drag is the only
    // look input a phone has, and pointer events give it to us for free.
    this.dragPointer = event.pointerId
    this.dragX = event.clientX
    this.dragY = event.clientY
    this.element?.setPointerCapture?.(event.pointerId)
  }

  private onPointerMove = (event: PointerEvent): void => {
    // While locked, look comes from `mousemove`'s movementX/Y instead; the
    // pointer's clientX/Y is frozen and would apply a constant zero delta.
    if (!this.enabled || this.locked || event.pointerId !== this.dragPointer) {
      return
    }
    const dx = event.clientX - this.dragX
    const dy = event.clientY - this.dragY
    this.dragX = event.clientX
    this.dragY = event.clientY
    this.applyLook(dx, dy)
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.dragPointer) {
      this.dragPointer = -1
    }
  }

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.enabled || !this.locked) {
      return
    }
    this.applyLook(event.movementX, event.movementY)
  }

  private applyLook(deltaX: number, deltaY: number): void {
    // Right on screen is +X in pointer space and −yaw in world space (yaw 0
    // faces −Z, so turning right takes forward.x = −sin(yaw) positive).
    this.yaw -= deltaX * this.lookSensitivity
    this.pitch = clamp(this.pitch - deltaY * this.lookSensitivity, -PITCH_LIMIT, PITCH_LIMIT)
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) {
      return
    }
    this.keys.add(event.code)
    if (event.code === 'Space') {
      // Buffered rather than consumed immediately, so a jump pressed a few
      // frames before touchdown still fires — the difference between a
      // controller that obeys and one that "eats inputs".
      this.jumpBuffer = JUMP_BUFFER
      // Space scrolls the page, which under a canvas game means the whole
      // viewport lurches on every jump.
      event.preventDefault()
    }
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code)
  }

  private onBlur = (): void => {
    // A tab switch never delivers keyup, so without this the player walks into
    // the horizon while the tab is in the background.
    this.keys.clear()
  }

  private onPointerLockChange = (): void => {
    this.locked = this.element !== null && document.pointerLockElement === this.element
  }

  private onPointerLockError = (): void => {
    this.lockUnavailable = true
    this.locked = false
  }

  /** Returns true if a lock is held or has just been asked for. */
  private requestPointerLock(): boolean {
    const element = this.element
    if (!element || this.locked) {
      return this.locked
    }
    if (this.lockUnavailable || typeof element.requestPointerLock !== 'function') {
      this.lockUnavailable = true
      return false
    }
    try {
      // Chrome returns a promise, Safari returns undefined, and a rejection
      // here is a *permission* answer, not a bug — so it downgrades to
      // drag-look rather than surfacing.
      const result = element.requestPointerLock() as unknown
      if (result && typeof (result as Promise<void>).then === 'function') {
        void (result as Promise<void>).catch(() => {
          this.lockUnavailable = true
        })
      }
    } catch {
      this.lockUnavailable = true
      return false
    }
    return true
  }

  private exitPointerLock(): void {
    if (this.locked && typeof document.exitPointerLock === 'function') {
      document.exitPointerLock()
    }
    this.locked = false
  }

  // ── Frame ────────────────────────────────────────────────────────────────

  /** One step. `delta` is already clamped by `World.frame`. */
  update(delta: number): void {
    if (!this.enabled || delta <= 0) {
      return
    }

    this.integrateHorizontal(delta)
    this.integrateVertical(delta)
    this.resolveGround(delta)

    // ── Eye ──────────────────────────────────────────────────────────────
    // The body is where the physics says it is; the eye lags it through steps
    // and landings and decays back. Framerate-independent decay, same form as
    // everything else in the rig.
    this.eyeOffset *= Math.exp(-EYE_CATCHUP_DAMPING * delta)

    const planarSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z)
    const bobTarget = this.grounded ? Math.min(1, planarSpeed / this.walkSpeed) : 0
    this.bobLevel += (bobTarget - this.bobLevel) * (1 - Math.exp(-BOB_BLEND_DAMPING * delta))
    // Advancing by *distance* rather than by time keeps the stride locked to the
    // feet: walk and sprint then share one cycle that simply runs faster,
    // instead of the bob sliding against the movement.
    this.bobPhase += planarSpeed * delta * BOB_RATE

    const amplitude = this.bobLevel * this.bobStrength
    // Vertical bob is two per stride (one per footfall), roll is one.
    this.writeCamera(Math.sin(this.bobPhase * 2) * amplitude, Math.sin(this.bobPhase) * amplitude * BOB_ROLL)
  }

  private integrateHorizontal(delta: number): void {
    groundForward(this.yaw, _forward)
    strafeRight(this.yaw, _right)

    const forwardInput =
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0)
    const strafeInput =
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0)

    _wish.set(0, 0, 0)
    if (forwardInput !== 0) {
      _wish.addScaledVector(_forward, forwardInput)
    }
    if (strafeInput !== 0) {
      _wish.addScaledVector(_right, strafeInput)
    }

    const wishLength = Math.sqrt(_wish.x * _wish.x + _wish.z * _wish.z)
    if (wishLength > 0) {
      const sprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
      const speed = this.walkSpeed * (sprinting ? this.sprintMultiplier : 1)
      // Normalise, or holding W+D is √2 faster than W — the oldest bug in
      // first-person movement and still the most common.
      _wish.multiplyScalar(speed / wishLength)
    }

    const blend = 1 - Math.exp(-(this.grounded ? GROUND_DAMPING : AIR_DAMPING) * delta)
    this.velocity.x += (_wish.x - this.velocity.x) * blend
    this.velocity.z += (_wish.z - this.velocity.z) * blend

    const targetX = this.position.x + this.velocity.x * delta
    const targetZ = this.position.z + this.velocity.z * delta
    const resolved = this.collision.resolveMove(
      this.position.x,
      this.position.z,
      targetX,
      targetZ,
      this.radius,
      this.position.y
    )

    const movedX = resolved.x - this.position.x
    const movedZ = resolved.z - this.position.z
    this.position.x = resolved.x
    this.position.z = resolved.z

    // Re-derive velocity from the displacement that actually happened. Without
    // this, holding W into a wall keeps a full-speed velocity that fires the
    // player sideways the instant the wall ends — and the wall-normal component
    // would keep re-entering the wall every frame, which the depenetration then
    // has to undo, producing a visible buzz along the surface.
    const inverseDelta = 1 / delta
    this.velocity.x = movedX * inverseDelta
    this.velocity.z = movedZ * inverseDelta
  }

  private integrateVertical(delta: number): void {
    this.jumpBuffer = Math.max(0, this.jumpBuffer - delta)

    // Coyote time: the ledge you just walked off still counts as ground for a
    // beat. Players read a missed jump here as the game being wrong, not as
    // them being late, because they pressed it "as they left the edge".
    if (this.jumpBuffer > 0 && (this.grounded || this.coyoteTimer > 0)) {
      this.velocity.y = this.jumpSpeed
      this.grounded = false
      this.coyoteTimer = 0
      this.jumpBuffer = 0
    }

    const before = this.velocity.y
    this.velocity.y -= this.gravity * delta
    if (this.velocity.y < -MAX_FALL_SPEED) {
      this.velocity.y = -MAX_FALL_SPEED
    }
    // Integrate with the step's *mean* velocity, not its start or end value.
    // Under constant acceleration the trapezoid is exact, so the jump apex is
    // the configured height at 30 fps and at 144 fps alike. Plain Euler — in
    // either flavour — misses it by ½·g·dt², which is 12 cm of jump height at
    // 30 fps: enough to turn a ledge that is reachable on a desktop into one
    // that is not on a phone.
    this.verticalStep = (before + this.velocity.y) * 0.5 * delta
  }

  private resolveGround(delta: number): void {
    const previousY = this.position.y
    this.position.y += this.verticalStep

    // Probe from the *higher* of this frame's and last frame's feet, plus the
    // step height. The `max` makes the fall swept — a 40 m/s drop can't pass
    // through a 20 cm slab between two frames — and the `+ stepHeight` is what
    // lifts the player onto anything the collision world let them walk into.
    const probeY = Math.max(previousY, this.position.y) + this.stepHeight
    const ground = this.collision.groundHeightAt(this.position.x, this.position.z, probeY)

    const wasGrounded = this.grounded
    const drop = this.position.y - ground
    // While already grounded the player sticks to surfaces up to a step below,
    // or every downhill step would launch them into a series of small hops.
    const stick = wasGrounded ? this.stepHeight : GROUND_EPSILON

    if (this.velocity.y <= 0 && drop <= stick) {
      const lift = ground - this.position.y
      const impactSpeed = -this.velocity.y

      this.position.y = ground
      this.velocity.y = 0
      this.grounded = true
      this.coyoteTimer = COYOTE_TIME

      if (wasGrounded) {
        // A stair or a slope. The body jumps, the eye doesn't.
        if (lift > STEP_SMOOTH_MIN || lift < -STEP_SMOOTH_MIN) {
          this.eyeOffset = clamp(this.eyeOffset - lift, -EYE_OFFSET_LIMIT, EYE_OFFSET_LIMIT)
        }
      } else {
        // A landing. Dip proportional to impact, which is most of what sells
        // weight — a jump that ends with the camera exactly level reads as the
        // player having been a floating point the whole time.
        this.eyeOffset = clamp(
          this.eyeOffset - impactSpeed * LANDING_DIP_PER_SPEED,
          -EYE_OFFSET_LIMIT,
          EYE_OFFSET_LIMIT
        )
      }
      return
    }

    this.grounded = false
    this.coyoteTimer = Math.max(0, this.coyoteTimer - delta)
  }

  private writeCamera(bobY: number, bobRoll: number): void {
    this.camera.position.set(
      this.position.x,
      this.position.y + this.eyeHeight + this.eyeOffset + bobY,
      this.position.z
    )
    // YXZ, so yaw is applied about world up and pitch about the already-yawed
    // right axis. Any other order rolls the horizon as you look around.
    this.camera.rotation.set(this.pitch, this.yaw, bobRoll, 'YXZ')
  }
}

const clamp = (value: number, min: number, max: number): number => (value < min ? min : value > max ? max : value)
