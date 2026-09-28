/**
 * The desk camera: a steep, near-isometric look down at the open book
 * (aethel-fold-GDD §2), fitted to any aspect ratio so the whole play page is
 * always visible — portrait phones see the page edge to edge, landscape and
 * desktop see the desk, the book's left page and the thick layer stack
 * around it (the GDD §7 "curiosity loop").
 *
 * Juice lives here too: vertical high-frequency shake (GDD §5), a zoom punch
 * on snaps, and slow focus moves for the boss.
 */

import { MathUtils, PerspectiveCamera, Vector3 } from 'three'
import { PAGE_HALF_D, PAGE_HALF_W } from '../logic/config'

/** Pitch below the horizon: steep in portrait, lower in landscape (height-limited). */
const PITCH_PORTRAIT = MathUtils.degToRad(67)
const PITCH_LANDSCAPE = MathUtils.degToRad(52)
const FOV = 30

export interface CameraFrame {
  /** Screen fractions reserved for UI at the top / bottom (never cover the page with HUD). */
  top: number
  bottom: number
  side: number
}

export class DeskCamera {
  readonly camera: PerspectiveCamera
  /** Point on the page the camera looks at. */
  readonly focus = new Vector3(0, 0, 0.6)
  private distance = 30
  private baseDistance = 30
  private aspect = 1
  private pitch = PITCH_PORTRAIT

  // Juice state
  private shakeAmp = 0
  private shakeTime = 0
  private punch = 0
  private punchV = 0
  /** Extra distance multiplier (boss reveal pull-back), eased. */
  private zoom = 1
  private zoomTarget = 1
  private readonly tmp = new Vector3()
  private readonly dir = new Vector3()
  reducedMotion = false

  constructor() {
    this.camera = new PerspectiveCamera(FOV, 1, 1, 120)
  }

  /** Solve the distance that fits the page (+ margin) inside the usable frame. */
  fit(aspect: number, frame: CameraFrame): void {
    this.aspect = aspect
    // Blend the pitch from portrait (≤ 0.8) to landscape (≥ 1.4).
    const k = Math.min(1, Math.max(0, (aspect - 0.8) / 0.6))
    this.pitch = PITCH_PORTRAIT + (PITCH_LANDSCAPE - PITCH_PORTRAIT) * k
    const cam = this.camera
    cam.aspect = aspect
    cam.fov = FOV
    // The page's corners (with a margin for the paper stack and pop-ups).
    const mx = PAGE_HALF_W + 0.12
    const zTop = -PAGE_HALF_D - 1.1 // castle roofs and flags stand above the top edge
    const zBot = PAGE_HALF_D + 0.45
    const corners: [number, number, number][] = [
      [-mx, 0, zTop], [mx, 0, zTop], [-mx, 0, zBot], [mx, 0, zBot],
      [-mx, 2.8, zTop + 0.6], [mx, 2.8, zTop + 0.6],
      // The castle keep's roof and flags (pages 4–5) stand ~4.4 units tall.
      [0, 4.6, -6.1]
    ]
    this.focus.set(0, 0, 0.35)
    const usableTop = 1 - frame.top * 2
    const usableBot = -1 + frame.bottom * 2
    const usableX = 1 - frame.side * 2
    const want = (usableTop + usableBot) / 2
    const bbox = { minX: 0, maxX: 0, minY: 0, maxY: 0 }
    const measure = (dist: number, fz: number): typeof bbox => {
      this.focus.z = fz
      this.place(dist)
      bbox.minX = bbox.minY = Infinity
      bbox.maxX = bbox.maxY = -Infinity
      for (const c of corners) {
        this.tmp.set(c[0], c[1], c[2]).project(cam)
        bbox.minX = Math.min(bbox.minX, this.tmp.x)
        bbox.maxX = Math.max(bbox.maxX, this.tmp.x)
        bbox.minY = Math.min(bbox.minY, this.tmp.y)
        bbox.maxY = Math.max(bbox.maxY, this.tmp.y)
      }
      return bbox
    }
    // For a distance, slide the focus along z until the page's projected
    // bounding box is centred between the HUD and the bottom edge.
    const centred = (dist: number): number => {
      let fz = 0.35
      for (let it = 0; it < 4; it++) {
        const b0 = measure(dist, fz)
        const c0 = (b0.minY + b0.maxY) / 2
        const b1 = measure(dist, fz + 0.5)
        const c1 = (b1.minY + b1.maxY) / 2
        const slope = (c1 - c0) / 0.5
        if (Math.abs(slope) < 1e-5) break
        fz -= (c0 - want) / slope
      }
      return fz
    }
    let lo = 6
    let hi = 90
    let bestZ = 0.35
    for (let it = 0; it < 26; it++) {
      const mid = (lo + hi) / 2
      const fz = centred(mid)
      const b = measure(mid, fz)
      const ok = b.minX >= -usableX && b.maxX <= usableX && b.maxY <= usableTop && b.minY >= usableBot
      if (ok) {
        hi = mid
        bestZ = fz
      } else lo = mid
    }
    this.baseDistance = hi
    this.distance = hi
    this.focus.z = bestZ
    this.place(hi)
  }

  private place(dist: number): void {
    const cam = this.camera
    this.dir.set(0, Math.sin(this.pitch), Math.cos(this.pitch))
    cam.position.copy(this.focus).addScaledVector(this.dir, dist)
    cam.lookAt(this.focus)
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld(true)
  }

  shake(amount: number): void {
    if (this.reducedMotion) amount *= 0.25
    this.shakeAmp = Math.min(0.35, Math.max(this.shakeAmp, amount))
  }

  /** A quick push toward the page (snap / stamp). */
  kick(amount: number): void {
    if (this.reducedMotion) amount *= 0.3
    this.punchV -= amount
  }

  setZoom(z: number): void {
    this.zoomTarget = z
  }

  update(dt: number): void {
    this.shakeTime += dt
    this.shakeAmp = Math.max(0, this.shakeAmp - dt * 1.6 * Math.max(0.3, this.shakeAmp * 6))
    // Critically-damped spring for the punch.
    const k = 180
    const c = 2 * Math.sqrt(k)
    this.punchV += (-k * this.punch - c * this.punchV) * dt
    this.punch += this.punchV * dt
    this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-dt * 1.8))
    this.distance = this.baseDistance * this.zoom * (1 + this.punch * 0.06)
    this.place(this.distance)
    if (this.shakeAmp > 0.0005) {
      // GDD §5: sharp, low-amplitude, high-frequency, *vertical*.
      const t = this.shakeTime
      const y = (Math.sin(t * 92) * 0.6 + Math.sin(t * 57 + 1.3) * 0.4) * this.shakeAmp
      const x = Math.sin(t * 71 + 0.7) * this.shakeAmp * 0.18
      this.camera.position.y += y
      this.camera.position.x += x
      this.camera.updateMatrixWorld(true)
    }
  }

  get aspectRatio(): number {
    return this.aspect
  }
}
