import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { DeskCamera, type CameraFrame } from '@/fold/render/camera'
import { SHELF } from '@/fold/logic/config'
import {
  SHELF_CARD_W, shelfCardPoint, shelfCardPose, shelfHalfWidth, shelfToWorld, slotX, type ShelfCardPose, type ShelfPoint
} from '@/fold/logic/shelf'

// Roughly the HUD frame FoldScene hands the camera on a phone (the HUD strip plus the zoom button).
const FRAME: CameraFrame = { top: 0.16, bottom: 0.02, side: 0.015 }

/** A camera fitted to w × h, glided all the way out to the shelf (or kept at the book). */
const at = (w: number, h: number, shelf: boolean): DeskCamera => {
  const d = new DeskCamera()
  d.fit(w / h, FRAME)
  d.setShelf(shelf)
  for (let i = 0; i < 120; i++) d.update(1 / 60)
  return d
}

const v = new Vector3()
const px = (d: DeskCamera, w: number, h: number, p: ShelfPoint): { x: number; y: number } => {
  v.set(p.x, p.y, p.z).project(d.camera)
  return { x: (v.x + 1) * 0.5 * w, y: (1 - v.y) * 0.5 * h }
}

/** On-screen width (px) of a slot's spine at mid height. */
const bookWidth = (d: DeskCamera, w: number, h: number, slot: number): number => {
  const p: ShelfPoint = { x: 0, y: 0, z: 0 }
  const y = SHELF.board + SHELF.bookH * 0.5
  const a = px(d, w, h, shelfToWorld(slotX(slot) - SHELF.bookW / 2, y, SHELF.bookD / 2, p))
  const b = px(d, w, h, shelfToWorld(slotX(slot) + SHELF.bookW / 2, y, SHELF.bookD / 2, p))
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** Smallest on-screen height (px) of a middle star on the card of a pulled-out book (5 rated pages, as `paintStarCard` lays them out). */
const starHeight = (d: DeskCamera, w: number, h: number, slot: number): number => {
  const rows = 5
  const rowH = (320 - 74 - 12) / rows
  const r = Math.min(21, rowH * 0.4)
  const c: ShelfCardPose = { x: 0, y: 0, z: 0, tilt: 0, scale: 1 }
  shelfCardPose(slot, 1, 1, d.shelfClose, c)
  const p: ShelfPoint = { x: 0, y: 0, z: 0 }
  let worst = Infinity
  for (let row = 0; row < rows; row++) {
    const yc = 74 + rowH * (row + 0.5)
    const u = 156 / 256 - 0.5
    const a = px(d, w, h, shelfCardPoint(c, u, 1 - (yc - r) / 320, p))
    const b = px(d, w, h, shelfCardPoint(c, u, 1 - (yc + r * Math.cos(Math.PI / 5)) / 320, p))
    worst = Math.min(worst, Math.hypot(b.x - a.x, b.y - a.y))
  }
  return worst
}

describe('shelf camera: portrait close-up', () => {
  for (const [w, h] of [[320, 658], [390, 844]] as const) {
    it(`frames the shelf alone at ${w}×${h}: books ≥ 60 px wide, card stars ≥ 14 px tall`, () => {
      const d = at(w, h, true)
      expect(d.shelfInView).toBe(false)
      expect(d.shelfClose).toBe(true)
      for (let i = 0; i < SHELF.slots; i++) {
        const bw = bookWidth(d, w, h, i)
        expect(Number.isFinite(bw)).toBe(true)
        expect(bw, `book ${i + 1}`).toBeGreaterThanOrEqual(60)
        expect(starHeight(d, w, h, i), `stars of book ${i + 1}`).toBeGreaterThanOrEqual(14)
      }
    })

    it(`keeps the shelf, a pulled-out book and its card inside the frame under the HUD at ${w}×${h}`, () => {
      const d = at(w, h, true)
      const p: ShelfPoint = { x: 0, y: 0, z: 0 }
      const c: ShelfCardPose = { x: 0, y: 0, z: 0, tilt: 0, scale: 1 }
      const pts: ShelfPoint[] = []
      const hw = shelfHalfWidth()
      for (const lx of [-hw, hw]) {
        for (const ly of [0, SHELF.board * 2 + SHELF.bookH + 0.28]) {
          for (const lz of [-(SHELF.bookD + 0.3) / 2, SHELF.bookD / 2 + SHELF.pull]) pts.push({ ...shelfToWorld(lx, ly, lz, p) })
        }
      }
      for (let i = 0; i < SHELF.slots; i++) {
        shelfCardPose(i, 1, 1, true, c)
        for (const [u, vv] of [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]] as const) pts.push({ ...shelfCardPoint(c, u, vv, p) })
      }
      for (const q of pts) {
        const s = px(d, w, h, q)
        expect(s.x).toBeGreaterThanOrEqual(0)
        expect(s.x).toBeLessThanOrEqual(w)
        expect(s.y, 'below the HUD').toBeGreaterThanOrEqual(h * FRAME.top - 0.5)
        expect(s.y).toBeLessThanOrEqual(h)
      }
    })
  }

  it('the close-up card stays inside the shelf width, grows and leans back to face the camera', () => {
    const c: ShelfCardPose = { x: 0, y: 0, z: 0, tilt: 0, scale: 1 }
    for (let i = 0; i < SHELF.slots; i++) {
      shelfCardPose(i, 1, 1, true, c)
      expect(c.scale).toBeGreaterThan(1)
      expect(c.tilt).toBeLessThan(0)
      expect(Math.abs(c.x) + (c.scale * SHELF_CARD_W) / 2).toBeLessThanOrEqual(shelfHalfWidth() + 1e-9)
    }
  })

  it('glides between the poses in real time, finite on every frame', () => {
    const d = at(390, 844, false)
    const start = d.camera.position.clone()
    d.setShelf(true)
    let prev = d.camera.position.clone()
    let maxStep = 0
    for (let i = 0; i < 90; i++) {
      d.update(1 / 60)
      const p = d.camera.position
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true)
      maxStep = Math.max(maxStep, p.distanceTo(prev))
      prev = p.clone()
    }
    expect(d.shelfK).toBe(1)
    const total = d.camera.position.distanceTo(start)
    // Eased: no single frame jumps more than a tenth of the whole move.
    expect(maxStep).toBeLessThan(total * 0.1)
  })
})

describe('shelf camera: wide screens keep their framing', () => {
  for (const [w, h] of [[658, 320], [844, 390], [1280, 720], [1920, 1080]] as const) {
    it(`${w}×${h}: shelf in view, no close-up, card pose as before`, () => {
      const d = at(w, h, true)
      expect(d.shelfInView).toBe(true)
      expect(d.shelfClose).toBe(false)
      const c: ShelfCardPose = { x: 0, y: 0, z: 0, tilt: 0, scale: 1 }
      shelfCardPose(0, 1, 1, false, c)
      expect(c.x).toBe(slotX(0))
      expect(c.tilt).toBeCloseTo(0.35)
      expect(c.scale).toBeCloseTo(1)
      expect(c.y).toBeCloseTo(SHELF.board + SHELF.bookH + 0.1)
      expect(c.z).toBeCloseTo(SHELF.bookD / 2 + SHELF.pull - 0.25)
    })
  }
})
