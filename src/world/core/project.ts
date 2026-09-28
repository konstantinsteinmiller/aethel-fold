import { type PerspectiveCamera, Vector3 } from 'three'

/**
 * ─── Putting a world position on the screen ─────────────────────────────────
 *
 * The seam between the three.js scene and the Vue HUD. Anything that draws an
 * HTML element over a point in the world (the seat prompt, a locator arrow, a
 * name tag) goes through here, and this is the only place that knows how to
 * turn one into the other.
 *
 * ── Coordinates: origin top-left, and unclamped ─────────────────────────────
 *
 * `x = 0` is the left edge and `y = 0` is the **top**, because that is what CSS
 * `left`/`top` percentages mean. NDC's y points up, so there is a flip in here
 * and it is the single easiest thing in this file to get backwards.
 *
 * Values outside `0..1` are returned as they are and are not an error: an
 * off-screen target's true position is what lets the locator point an arrow at
 * it. Clamping is a *layout* decision and belongs in the component doing the
 * layout.
 *
 * ── Behind the camera is the whole difficulty ───────────────────────────────
 *
 * `Vector3.project` divides by `w`, and `w` is negative behind the camera — so
 * both components come out negated and a target directly behind the player
 * projects to the opposite edge of the screen. An arrow driven off that points
 * exactly 180° wrong, and nothing about the result looks unusual: it is a
 * perfectly ordinary off-screen coordinate.
 *
 * So the camera-space z is tested separately and the point is mirrored back
 * through the centre, then pushed outward so it lands well off-screen where an
 * edge-clamped indicator belongs.
 */

export interface ScreenPoint {
  /** 0 at the left edge, 1 at the right. Not clamped. */
  x: number
  /** 0 at the **top** edge, 1 at the bottom. Not clamped. */
  y: number
  /** True only when the point is in front of the camera *and* inside the viewport. */
  onScreen: boolean
  /** Metres from the camera to the point. */
  distance: number
}

/**
 * How far past the screen a behind-the-camera point is pushed.
 *
 * Any value above 1 works — it only has to land outside `0..1` so the consumer
 * treats it as off-screen. 2.5 keeps the arrow's angle stable as a target passes
 * the 90° line, where a smaller push makes it jitter across the corner.
 */
const BEHIND_PUSH = 2.5

const _point = new Vector3()
const _camera = new Vector3()

/**
 * Projects a world point, filling `out`.
 *
 * Fills a caller-owned struct rather than returning one: this runs every frame
 * for the locator and again for the talk prompt, and GDD section 5 allows no
 * allocation on that path.
 */
export const projectToScreen = (
  camera: PerspectiveCamera,
  x: number,
  y: number,
  z: number,
  out: ScreenPoint
): ScreenPoint => {
  out.distance = Math.hypot(x - camera.position.x, y - camera.position.y, z - camera.position.z)

  // Camera space, purely to find out which side of the lens this is on. Three's
  // cameras look down **−Z**, so a positive z here is behind the viewer.
  _camera.set(x, y, z).applyMatrix4(camera.matrixWorldInverse)
  const behind = _camera.z > 0

  _point.set(x, y, z).project(camera)
  out.x = _point.x * 0.5 + 0.5
  out.y = 0.5 - _point.y * 0.5

  if (behind) {
    // Mirror back through the centre — undoing the negative `w` — and push out.
    out.x = 0.5 - (out.x - 0.5) * BEHIND_PUSH
    out.y = 0.5 - (out.y - 0.5) * BEHIND_PUSH
    out.onScreen = false
    return out
  }
  out.onScreen = out.x >= 0 && out.x <= 1 && out.y >= 0 && out.y <= 1
  return out
}

/** A fresh struct for a caller to own. */
export const makeScreenPoint = (): ScreenPoint => ({ x: 0.5, y: 0.5, onScreen: false, distance: 0 })
