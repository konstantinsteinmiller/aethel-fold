/**
 * The desk camera: a steep, near-isometric look down at the open book
 * (aethel-fold-GDD §2), fitted to any aspect ratio so the whole play page is
 * always visible — portrait phones see the page edge to edge, landscape and
 * desktop see the desk, the book's left page and the thick layer stack
 * around it (the GDD §7 "curiosity loop").
 *
 * Juice lives here too: vertical high-frequency shake (GDD §5), a zoom punch
 * on snaps, and slow focus moves for the boss.
 *
 * Two poses (roadmap #2): `book` frames the page, `shelf` pulls out and over
 * so the desk bookshelf right of the book is in the picture too. The camera
 * eases between them in real time (`setShelf`), whatever the world's time.
 */

import { MathUtils, PerspectiveCamera, Vector3 } from 'three'
import { PAGE_HALF_D, PAGE_HALF_W, SHELF } from '../logic/config'
import { shelfCardPoint, shelfCardPose, shelfHalfWidth, shelfToWorld, type ShelfCardPose, type ShelfPoint } from '../logic/shelf'

/** Pitch below the horizon: steep in portrait, lower in landscape (height-limited). */
const PITCH_PORTRAIT = MathUtils.degToRad(67)
const PITCH_LANDSCAPE = MathUtils.degToRad(52)
/** Out at the shelf the camera lowers to look at the spines rather than down on the book tops. */
const PITCH_SHELF = MathUtils.degToRad(49)
const FOV = 30

export interface CameraFrame {
  /** Screen fractions reserved for UI at the top / bottom (never cover the page with HUD). */
  top: number
  bottom: number
  side: number
}

interface Pose {
  dist: number
  fx: number
  fz: number
  pitch: number
}

/** The HUD frame the "is the shelf already on screen" test uses — fixed, so the answer depends on the aspect only. */
const REFERENCE_FRAME: CameraFrame = { top: 0.1, bottom: 0.02, side: 0.015 }

/**
 * The shelf's outer corners in page space (flat xyz), with room for a pulled-out
 * book and its star card. `close`: the portrait close-up — the shelf's own top
 * plus the real corners of the (larger) card over either end book.
 */
const shelfCorners = (close = false): number[] => {
  const out: number[] = []
  const p: ShelfPoint = { x: 0, y: 0, z: 0 }
  const hw = shelfHalfWidth()
  // Close: the top board and what stands on it (the rush figurines, the secrets card).
  const top = SHELF.board * 2 + SHELF.bookH + (close ? 0.3 + SHELF.rushH : 1.9)
  // The close-up hugs the boards (the back board is at −(bookD + 0.3) / 2); every pixel of width is book size.
  const front = SHELF.bookD / 2 + SHELF.pull + (close ? 0.08 : 0.2)
  const back = close ? -(SHELF.bookD + 0.3) / 2 : -SHELF.bookD / 2 - 0.2
  if (close) {
    const c: ShelfCardPose = { x: 0, y: 0, z: 0, tilt: 0, scale: 1 }
    for (const slot of [0, SHELF.slots - 1]) {
      shelfCardPose(slot, 1, 1, true, c)
      for (const [u, v] of [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]] as const) {
        shelfCardPoint(c, u, v, p)
        out.push(p.x, p.y, p.z)
      }
    }
  }
  for (const lx of [-hw, hw]) {
    for (const [ly, lz] of [[0, front], [0, back], [top, SHELF.bookD / 2], [top, -SHELF.bookD / 2]] as const) {
      shelfToWorld(lx, ly, lz, p)
      out.push(p.x, p.y, p.z)
    }
  }
  return out
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
  /** The two framings and the eased blend between them (0 = book, 1 = shelf). */
  private readonly bookPose: Pose = { dist: 30, fx: 0, fz: 0.35, pitch: PITCH_PORTRAIT }
  private readonly shelfPose: Pose = { dist: 30, fx: 0, fz: 0.35, pitch: PITCH_SHELF }
  private shelfTarget = 0
  /** Eased 0…1 toward the shelf pose (real time). */
  shelfK = 0
  /** The book pose already shows the whole shelf (wide aspects): no zoom button needed. */
  shelfInView = false
  /**
   * The shelf pose frames the shelf alone (wherever it isn't in view — portrait
   * phones and tablets): beside the book there, its books were ~30 px wide.
   */
  shelfClose = false
  private readonly shelfPts = shelfCorners()
  private readonly closePts = shelfCorners(true)

  constructor() {
    this.camera = new PerspectiveCamera(FOV, 1, 1, 120)
  }

  /** Solve both poses for an aspect and the HUD frame. */
  fit(aspect: number, frame: CameraFrame): void {
    this.aspect = aspect
    // Blend the pitch from portrait (≤ 0.8) to landscape (≥ 1.4).
    const k = Math.min(1, Math.max(0, (aspect - 0.8) / 0.6))
    const bookPitch = PITCH_PORTRAIT + (PITCH_LANDSCAPE - PITCH_PORTRAIT) * k
    this.bookPose.pitch = bookPitch
    this.shelfPose.pitch = Math.min(bookPitch, PITCH_SHELF)
    const cam = this.camera
    cam.aspect = aspect
    cam.fov = FOV
    // The page's corners (with a margin for the paper stack and pop-ups).
    const mx = PAGE_HALF_W + 0.12
    const zTop = -PAGE_HALF_D - 1.1 // castle roofs and flags stand above the top edge
    const zBot = PAGE_HALF_D + 0.45
    const page = [
      -mx, 0, zTop, mx, 0, zTop, -mx, 0, zBot, mx, 0, zBot,
      -mx, 2.8, zTop + 0.6, mx, 2.8, zTop + 0.6,
      // The castle keep's roof and flags (pages 4–5) stand ~4.4 units tall.
      0, 4.6, -6.1
    ]
    // Is the shelf on screen in the book pose? Judged against a fixed frame, so
    // the HUD growing a zoom button can't flip the answer back.
    const ref: Pose = { dist: 0, fx: 0, fz: 0, pitch: bookPitch }
    this.solve(page, REFERENCE_FRAME, false, ref)
    this.shelfInView = this.inside(this.shelfPts, ref, REFERENCE_FRAME)
    this.solve(page, frame, false, this.bookPose)
    this.shelfClose = !this.shelfInView
    if (this.shelfClose) {
      // Portrait: only the shelf, centred under the HUD, as big as the width allows (the book goes off to the left).
      this.solve(this.closePts, frame, true, this.shelfPose)
      this.pose()
      return
    }
    // The shelf pose: the shelf and the upper right-hand part of the book beside it.
    const x0 = 1.2
    const zMid = 1.5
    const out = [
      x0, 0, zTop, mx, 0, zTop, x0, 0, zMid, mx, 0, zMid, mx, 2.8, zTop + 0.6,
      ...this.shelfPts
    ]
    this.solve(out, frame, true, this.shelfPose, true)
    this.pose()
  }

  /**
   * Fit `corners` (flat xyz) inside the usable frame: bisect the distance,
   * and for each distance slide the focus (z, and x when `centreX`) until the
   * projected bounding box is centred between the HUD and the bottom edge
   * (or, `alignTop`, hangs right under the HUD).
   * Resize only (allocates nothing per frame).
   */
  private solve(corners: readonly number[], frame: CameraFrame, centreX: boolean, out: Pose, alignTop = false): void {
    const cam = this.camera
    this.pitch = out.pitch
    const usableTop = 1 - frame.top * 2
    const usableBot = -1 + frame.bottom * 2
    const usableX = 1 - frame.side * 2
    // Centred between the HUD and the bottom edge — or hung from the HUD (the shelf pose: top-right).
    const want = alignTop ? usableTop - 0.03 : (usableTop + usableBot) / 2
    const yOf = (b: { minY: number; maxY: number }): number => (alignTop ? b.maxY : (b.minY + b.maxY) / 2)
    const bbox = { minX: 0, maxX: 0, minY: 0, maxY: 0 }
    const measure = (dist: number, fx: number, fz: number): typeof bbox => {
      this.focus.set(fx, 0, fz)
      this.place(dist)
      bbox.minX = bbox.minY = Infinity
      bbox.maxX = bbox.maxY = -Infinity
      for (let i = 0; i < corners.length; i += 3) {
        this.tmp.set(corners[i]!, corners[i + 1]!, corners[i + 2]!).project(cam)
        bbox.minX = Math.min(bbox.minX, this.tmp.x)
        bbox.maxX = Math.max(bbox.maxX, this.tmp.x)
        bbox.minY = Math.min(bbox.minY, this.tmp.y)
        bbox.maxY = Math.max(bbox.maxY, this.tmp.y)
      }
      return bbox
    }
    let fx = 0
    if (centreX) {
      for (let i = 0; i < corners.length; i += 3) fx += corners[i]!
      fx /= corners.length / 3
    }
    const centred = (dist: number): number => {
      let fz = 0.35
      for (let it = 0; it < 4; it++) {
        if (centreX) {
          const a = measure(dist, fx, fz)
          const cx0 = (a.minX + a.maxX) / 2
          const b = measure(dist, fx + 0.5, fz)
          const cx1 = (b.minX + b.maxX) / 2
          const sx = (cx1 - cx0) / 0.5
          if (Math.abs(sx) > 1e-5) fx -= cx0 / sx
        }
        const c0 = yOf(measure(dist, fx, fz))
        const c1 = yOf(measure(dist, fx, fz + 0.5))
        const slope = (c1 - c0) / 0.5
        if (Math.abs(slope) < 1e-5) break
        fz -= (c0 - want) / slope
      }
      return fz
    }
    let lo = 6
    let hi = 90
    let bestZ = 0.35
    let bestX = fx
    for (let it = 0; it < 26; it++) {
      const mid = (lo + hi) / 2
      const fz = centred(mid)
      const b = measure(mid, fx, fz)
      const ok = b.minX >= -usableX && b.maxX <= usableX && b.maxY <= usableTop && b.minY >= usableBot
      if (ok) {
        hi = mid
        bestZ = fz
        bestX = fx
      } else lo = mid
    }
    out.dist = hi
    out.fx = bestX
    out.fz = bestZ
  }

  /** Do all `pts` project inside the usable frame from `pose`? */
  private inside(pts: readonly number[], pose: Pose, frame: CameraFrame): boolean {
    this.pitch = pose.pitch
    this.focus.set(pose.fx, 0, pose.fz)
    this.place(pose.dist)
    for (let i = 0; i < pts.length; i += 3) {
      this.tmp.set(pts[i]!, pts[i + 1]!, pts[i + 2]!).project(this.camera)
      if (Math.abs(this.tmp.x) > 1 - frame.side * 2 || this.tmp.y > 1 - frame.top * 2 || this.tmp.y < -1) return false
    }
    return true
  }

  /** Go out to the shelf (true) or back to the book. Eased in real time by `update`. */
  setShelf(open: boolean): void {
    this.shelfTarget = open ? 1 : 0
  }

  /** Blend the two poses by `shelfK` into focus + base distance. */
  private pose(): void {
    const k = this.shelfK
    const e = k * k * (3 - 2 * k)
    const a = this.bookPose
    const b = this.shelfPose
    this.baseDistance = a.dist + (b.dist - a.dist) * e
    this.pitch = a.pitch + (b.pitch - a.pitch) * e
    this.focus.set(a.fx + (b.fx - a.fx) * e, 0, a.fz + (b.fz - a.fz) * e)
    this.distance = this.baseDistance
    this.place(this.baseDistance)
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
    // Out to the shelf and back: a smooth real-time glide (never the world's clock).
    if (this.shelfK !== this.shelfTarget) {
      const step = dt / (SHELF.zoomTime * 3)
      this.shelfK = this.shelfTarget > this.shelfK ? Math.min(1, this.shelfK + step) : Math.max(0, this.shelfK - step)
      this.pose()
    }
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
