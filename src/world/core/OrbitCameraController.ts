import { MathUtils, type PerspectiveCamera, Vector3 } from 'three'

/**
 * ─── Camera rig ─────────────────────────────────────────────────────────────
 *
 * Orbit around a movable focus, with keyboard traversal of the focus itself —
 * enough to walk the world and inspect an asset from every angle, which is what
 * this milestone is for.
 *
 * Hand-rolled rather than `examples/jsm/controls/OrbitControls` for two reasons
 * that both matter here: OrbitControls has no notion of a focus that *travels*
 * (so WASD would fight its internal target), and it pulls a chunk of unused
 * code into the bundle for a web game that has to be interactive in seconds.
 *
 * Everything is critically damped toward a desired value rather than set
 * directly. A camera that snaps makes LOD crossfades look like pops even when
 * they aren't, because the eye reads the whole frame as discontinuous.
 */

export interface OrbitCameraOptions {
  minDistance?: number
  maxDistance?: number
  minPitch?: number
  maxPitch?: number
  moveSpeed?: number
  /** Keeps the camera this far above the ground. */
  groundClearance?: number
}

const _offset = new Vector3()
const _forward = new Vector3()
const _right = new Vector3()

export class OrbitCameraController {
  readonly camera: PerspectiveCamera
  /** Point the camera orbits, and what the LOD/shadow systems follow. */
  readonly focus = new Vector3()

  private desiredYaw = 0.6
  private desiredPitch = 0.42
  private desiredDistance = 14
  private yaw = 0.6
  private pitch = 0.42
  private distance = 14

  private readonly desiredFocus = new Vector3()
  private readonly keys = new Set<string>()
  private readonly pointers = new Map<number, { x: number; y: number }>()
  private lastPinchDistance = 0

  private element: HTMLElement | null = null
  private readonly options: Required<OrbitCameraOptions>
  private groundHeight: ((x: number, z: number) => number) | null = null

  constructor(camera: PerspectiveCamera, options: OrbitCameraOptions = {}) {
    this.camera = camera
    this.options = {
      minDistance: options.minDistance ?? 3,
      maxDistance: options.maxDistance ?? 140,
      minPitch: options.minPitch ?? -0.25,
      maxPitch: options.maxPitch ?? 1.35,
      moveSpeed: options.moveSpeed ?? 18,
      groundClearance: options.groundClearance ?? 1.6
    }
  }

  setGroundSampler(sampler: (x: number, z: number) => number): void {
    this.groundHeight = sampler
  }

  setFocus(x: number, y: number, z: number): void {
    this.focus.set(x, y, z)
    this.desiredFocus.set(x, y, z)
  }

  attach(element: HTMLElement): void {
    this.element = element
    element.addEventListener('pointerdown', this.onPointerDown)
    element.addEventListener('pointermove', this.onPointerMove)
    element.addEventListener('pointerup', this.onPointerUp)
    element.addEventListener('pointercancel', this.onPointerUp)
    element.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  detach(): void {
    const element = this.element
    if (element) {
      element.removeEventListener('pointerdown', this.onPointerDown)
      element.removeEventListener('pointermove', this.onPointerMove)
      element.removeEventListener('pointerup', this.onPointerUp)
      element.removeEventListener('pointercancel', this.onPointerUp)
      element.removeEventListener('wheel', this.onWheel)
    }
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.keys.clear()
    this.pointers.clear()
    this.element = null
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.element?.setPointerCapture(event.pointerId)
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    this.lastPinchDistance = 0
  }

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId)
    this.lastPinchDistance = 0
  }

  private onPointerMove = (event: PointerEvent): void => {
    const previous = this.pointers.get(event.pointerId)
    if (!previous) {
      return
    }
    const dx = event.clientX - previous.x
    const dy = event.clientY - previous.y
    previous.x = event.clientX
    previous.y = event.clientY

    if (this.pointers.size >= 2) {
      this.handlePinch()
      return
    }

    // Rotation rate is in radians per pixel, independent of canvas size — the
    // same drag should turn the same amount on a phone and on a 4K monitor.
    this.desiredYaw -= dx * 0.005
    this.desiredPitch = MathUtils.clamp(
      this.desiredPitch + dy * 0.005,
      this.options.minPitch,
      this.options.maxPitch
    )
  }

  private handlePinch(): void {
    const points = [...this.pointers.values()]
    const a = points[0]!
    const b = points[1]!
    const distance = Math.hypot(a.x - b.x, a.y - b.y)
    if (this.lastPinchDistance > 0) {
      const ratio = this.lastPinchDistance / distance
      this.desiredDistance = MathUtils.clamp(
        this.desiredDistance * ratio,
        this.options.minDistance,
        this.options.maxDistance
      )
    }
    this.lastPinchDistance = distance
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    // Multiplicative, so one notch feels the same at 5 m and at 100 m.
    const factor = Math.exp(event.deltaY * 0.0014)
    this.desiredDistance = MathUtils.clamp(
      this.desiredDistance * factor,
      this.options.minDistance,
      this.options.maxDistance
    )
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code)
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code)
  }

  private onBlur = (): void => {
    this.keys.clear()
  }

  update(deltaSeconds: number): void {
    this.applyKeyboard(deltaSeconds)

    // Critically-damped exponential smoothing. The `1 - exp(-k·dt)` form is
    // framerate-independent, unlike the usual `lerp(a, b, 0.1)` which converges
    // at a different rate at 30 fps than at 144.
    const smooth = 1 - Math.exp(-14 * deltaSeconds)
    this.yaw += (this.desiredYaw - this.yaw) * smooth
    this.pitch += (this.desiredPitch - this.pitch) * smooth
    this.distance += (this.desiredDistance - this.distance) * smooth
    this.focus.lerp(this.desiredFocus, smooth)

    if (this.groundHeight) {
      const ground = this.groundHeight(this.focus.x, this.focus.z)
      this.desiredFocus.y = ground + 2.2
    }

    const cosPitch = Math.cos(this.pitch)
    _offset.set(
      Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cosPitch
    )
    this.camera.position.copy(this.focus).addScaledVector(_offset, this.distance)

    if (this.groundHeight) {
      // Never let the camera dip below the terrain — clipping through a hill is
      // the fastest way to make a world feel like a tech demo.
      const floor = this.groundHeight(this.camera.position.x, this.camera.position.z) + this.options.groundClearance
      if (this.camera.position.y < floor) {
        this.camera.position.y = floor
      }
    }

    this.camera.lookAt(this.focus)
  }

  private applyKeyboard(deltaSeconds: number): void {
    if (this.keys.size === 0) {
      return
    }
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 3.5 : 1
    // Traversal speed scales with orbit distance: at 100 m out, moving at
    // walking pace feels broken.
    const speed = this.options.moveSpeed * boost * deltaSeconds * (0.35 + this.distance * 0.045)

    _forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize()
    // right = normalize(cross(forward, up)) = (-fz, 0, fx).
    // This was (fz, 0, -fx) — the exact negation — so A and D were swapped.
    _right.set(-_forward.z, 0, _forward.x)

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) {
      this.desiredFocus.addScaledVector(_forward, speed)
    }
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) {
      this.desiredFocus.addScaledVector(_forward, -speed)
    }
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) {
      this.desiredFocus.addScaledVector(_right, speed)
    }
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) {
      this.desiredFocus.addScaledVector(_right, -speed)
    }
  }
}
