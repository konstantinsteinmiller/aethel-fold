/**
 * Gesture recognizer: raw pointer events → game intents (GDD §4, §10.3).
 *
 *   one finger, moves along a fold's arrow ........ Swipe to Fold (follows the finger)
 *   one finger, down + up without moving .......... Tap to Stamp
 *   two fingers pulled apart over a crease ........ Spread to Flatten (tears / wing cores)
 *   one finger dragged off a crease ............... Tear drag (the mouse's spread)
 *   one finger along a glowing boss crease ........ Crease (fold a limb back)
 *   one finger from the dog-eared corner .......... Peel the layer
 *   one finger on the keep's sling, pulled back ... Sling (aim the other way, let go to shoot)
 *   mouse wheel over a crease ..................... Spread (desktop)
 *   one finger right → left over the won book ...... Fold it shut: off to the desk bookshelf
 *
 * Pure logic: it never touches the DOM. The host feeds it pointer events with
 * screen coordinates and a `project` function that maps a screen point onto
 * the page plane. No allocation per move event.
 */

import { SPREAD_COMPLETE, TEAR_DRAG_COMPLETE } from '../logic/config'
import type { FoldGame } from '../logic/game'
import type { FoldState } from '../logic/types'

export interface PagePoint {
  x: number
  z: number
}

/** Map a screen pixel to page space; return false if it misses the page plane. */
export type Projector = (sx: number, sy: number, out: PagePoint) => boolean

export type GestureFeedback = 'dragTick' | 'grab' | 'tearTick' | 'peelTick'

export interface GestureHost {
  project: Projector
  /** Short side of the viewport in CSS px — gesture distances scale with it. */
  minDim(): number
  feedback?(kind: GestureFeedback, value: number): void
}

type Mode = 'idle' | 'pending' | 'fold' | 'tear' | 'spread' | 'crease' | 'peel' | 'sling' | 'shut' | 'none'

interface Ptr {
  id: number
  active: boolean
  sx: number
  sy: number
  startSx: number
  startSy: number
  x: number
  z: number
  startX: number
  startZ: number
  t0: number
}

const mkPtr = (): Ptr => ({ id: -1, active: false, sx: 0, sy: 0, startSx: 0, startSy: 0, x: 0, z: 0, startX: 0, startZ: 0, t0: 0 })

/** Screen slop before a press becomes a drag, as a fraction of the short side. */
const SLOP = 0.022
/** A press shorter than this (ms) without moving is a tap. */
const TAP_MS = 420
/** Minimum alignment between the finger and a fold's arrow to grab it. */
const ALIGN = 0.28
/** Screen travel (fraction of the short side) that folds the won book shut. */
const SHUT = 0.28

export class GestureRecognizer {
  mode: Mode = 'idle'
  /** Fold / tear / weak point being manipulated. */
  target = -1
  /** Latest progress 0…1 of the active manipulation (for the UI). */
  progress = 0

  private readonly a: Ptr = mkPtr()
  private readonly b: Ptr = mkPtr()
  private readonly near: number[] = []
  private readonly tmp: PagePoint = { x: 0, z: 0 }
  private tearCandidate = -1
  private creaseCandidate = -1
  private spreadD0 = 0
  private lastProgress = 0
  private lastT = 0
  private speed = 0
  private tickAcc = 0
  private wheelTarget = -1
  private wheelProgress = 0
  private wheelTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly game: FoldGame, private readonly host: GestureHost) {}

  // ─── Events ──────────────────────────────────────────────────────────────

  down(id: number, sx: number, sy: number, now: number): void {
    const g = this.game
    if (!this.a.active) {
      if (!this.fill(this.a, id, sx, sy, now)) return
      this.mode = 'pending'
      this.target = -1
      this.progress = 0
      this.speed = 0
      if (g.pickSling(this.a.x, this.a.z) && g.grabSling()) {
        this.mode = 'sling'
        this.host.feedback?.('grab', 0)
        return
      }
      this.tearCandidate = g.pickTear(this.a.x, this.a.z)
      this.creaseCandidate = g.pickCrease(this.a.x, this.a.z)
      g.foldsNear(this.a.x, this.a.z, this.near)
      if (g.pickPeel(this.a.x, this.a.z)) this.mode = 'peel'
      return
    }
    if (this.b.active) return
    // Aiming the sling is a one-finger job; a second finger changes nothing.
    if (this.mode === 'sling') return
    if (!this.fill(this.b, id, sx, sy, now)) return
    // Second finger: this is a spread. Let go of whatever the first was doing.
    if (this.mode === 'fold' && this.target >= 0) g.release(this.target, 0)
    if (this.mode === 'crease') g.releaseWeak()
    if (this.mode === 'tear' && this.target !== -1) g.releaseTear(this.target)
    const mx = (this.a.sx + this.b.sx) / 2
    const my = (this.a.sy + this.b.sy) / 2
    let t = this.tearCandidate
    if (this.host.project(mx, my, this.tmp)) {
      const mid = g.pickTear(this.tmp.x, this.tmp.z, 0.9)
      if (mid !== -1) t = mid
    }
    if (t === -1) {
      this.mode = 'none'
      return
    }
    this.mode = 'spread'
    this.target = t
    this.spreadD0 = Math.hypot(this.a.sx - this.b.sx, this.a.sy - this.b.sy)
    this.progress = 0
    this.host.feedback?.('grab', 0)
  }

  move(id: number, sx: number, sy: number, now: number): void {
    const p = id === this.a.id && this.a.active ? this.a : id === this.b.id && this.b.active ? this.b : null
    if (!p) return
    p.sx = sx
    p.sy = sy
    if (this.host.project(sx, sy, this.tmp)) {
      p.x = this.tmp.x
      p.z = this.tmp.z
    }
    const g = this.game
    const minDim = Math.max(1, this.host.minDim())
    switch (this.mode) {
      case 'pending': {
        if (p !== this.a) return
        const moved = Math.hypot(sx - p.startSx, sy - p.startSy)
        if (moved < minDim * SLOP) return
        this.decide(now)
        break
      }
      case 'fold': {
        const f = g.folds[this.target]
        if (!f) return
        const prog = this.foldProgress(f)
        this.track(prog, now)
        g.drag(this.target, prog)
        this.tick(prog, 'dragTick')
        break
      }
      case 'tear': {
        const moved = Math.hypot(this.a.sx - this.a.startSx, this.a.sy - this.a.startSy)
        const prog = Math.min(1, moved / (minDim * TEAR_DRAG_COMPLETE))
        this.progress = prog
        g.pullTear(this.target, prog)
        this.tick(prog, 'tearTick')
        if (prog >= 1) this.mode = 'none'
        break
      }
      case 'spread': {
        if (!this.b.active) return
        const d = Math.hypot(this.a.sx - this.b.sx, this.a.sy - this.b.sy)
        const need = Math.max(this.spreadD0 * SPREAD_COMPLETE, minDim * 0.16)
        const prog = Math.max(0, Math.min(1, (d - this.spreadD0) / need))
        this.progress = prog
        g.pullTear(this.target, prog)
        this.tick(prog, 'tearTick')
        if (prog >= 1) this.mode = 'none'
        break
      }
      case 'crease': {
        const w = g.boss.weakPoints[this.target]
        if (!w) return
        const prog = ((p.x - p.startX) * w.sx + (p.z - p.startZ) * w.sz) / 1.5
        this.progress = Math.max(0, Math.min(1, prog))
        g.pullWeak(this.progress)
        this.tick(this.progress, 'dragTick')
        break
      }
      case 'sling': {
        if (p !== this.a) return
        g.aimSling(p.x - p.startX, p.z - p.startZ)
        const pull = Math.min(1, Math.hypot(p.x - p.startX, p.z - p.startZ) / 2.5)
        this.progress = pull
        this.tick(pull, 'dragTick')
        break
      }
      case 'shut': {
        const prog = Math.max(0, Math.min(1, (p.startSx - sx) / (minDim * SHUT)))
        this.progress = prog
        this.tick(prog, 'peelTick')
        if (prog >= 1) {
          g.foldShut()
          this.mode = 'none'
        }
        break
      }
      case 'peel': {
        // Drag the corner up and to the left (toward the page centre).
        const dx = p.startSx - sx
        const dy = p.startSy - sy
        const prog = Math.max(0, (dx * 0.6 + dy * 0.8) / (minDim * 0.55))
        this.progress = Math.min(1, prog)
        g.peelDrag(this.progress)
        this.tick(this.progress, 'peelTick')
        break
      }
    }
  }

  up(id: number, _sx: number, _sy: number, now: number): void {
    const isA = id === this.a.id && this.a.active
    const isB = id === this.b.id && this.b.active
    if (!isA && !isB) return
    const g = this.game
    if (isB) {
      this.b.active = false
      if (this.mode === 'spread') {
        g.releaseTear(this.target)
        this.mode = 'none'
      }
      return
    }
    // Primary finger lifted.
    switch (this.mode) {
      case 'pending':
        if (now - this.a.t0 < TAP_MS) g.tap(this.a.x, this.a.z)
        break
      case 'fold':
        g.release(this.target, this.speed)
        break
      case 'tear':
      case 'spread':
        g.releaseTear(this.target)
        break
      case 'crease':
        g.releaseWeak()
        break
      case 'peel':
        g.peelRelease()
        break
      case 'sling':
        g.releaseSling()
        break
      case 'shut':
        if (this.progress >= 0.5) g.foldShut()
        break
    }
    this.a.active = false
    if (this.b.active) {
      // The remaining finger shouldn't start anything new mid-gesture.
      this.mode = 'none'
      return
    }
    this.mode = 'idle'
    this.target = -1
    this.progress = 0
  }

  cancel(): void {
    const g = this.game
    // A cancelled gesture (pause, lost capture) never counts as a fold.
    if (this.mode === 'fold' && this.target >= 0) g.abandon(this.target)
    if ((this.mode === 'tear' || this.mode === 'spread') && this.target !== -1) g.releaseTear(this.target)
    if (this.mode === 'crease') g.releaseWeak()
    if (this.mode === 'peel') g.peelRelease()
    if (this.mode === 'sling') g.cancelSling()
    this.a.active = false
    this.b.active = false
    this.mode = 'idle'
    this.target = -1
    this.progress = 0
  }

  /** Mouse wheel over a crease pulls it apart (desktop spread). */
  wheel(sx: number, sy: number, deltaY: number): boolean {
    const g = this.game
    if (!this.host.project(sx, sy, this.tmp)) return false
    const t = g.pickTear(this.tmp.x, this.tmp.z, 0.6)
    if (t === -1) return false
    if (t !== this.wheelTarget) {
      this.wheelTarget = t
      this.wheelProgress = 0
    }
    this.wheelProgress = Math.min(1, this.wheelProgress + Math.min(0.2, Math.abs(deltaY) / 600))
    g.pullTear(t, this.wheelProgress)
    this.host.feedback?.('tearTick', this.wheelProgress)
    if (this.wheelTimer) clearTimeout(this.wheelTimer)
    this.wheelTimer = setTimeout(() => {
      g.releaseTear(this.wheelTarget)
      this.wheelTarget = -1
      this.wheelProgress = 0
    }, 320)
    return true
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private fill(p: Ptr, id: number, sx: number, sy: number, now: number): boolean {
    if (!this.host.project(sx, sy, this.tmp)) return false
    p.id = id
    p.active = true
    p.sx = p.startSx = sx
    p.sy = p.startSy = sy
    p.x = p.startX = this.tmp.x
    p.z = p.startZ = this.tmp.z
    p.t0 = now
    return true
  }

  /** The finger has moved past the slop: what is it doing? */
  private decide(now: number): void {
    const g = this.game
    const p = this.a
    const dx = p.x - p.startX
    const dz = p.z - p.startZ
    const len = Math.hypot(dx, dz) || 1
    const ux = dx / len
    const uz = dz / len

    // The won book: a sweep from right to left folds it shut.
    if (g.phase === 'victory') {
      const sdx = p.sx - p.startSx
      this.mode = sdx < 0 && Math.abs(sdx) > Math.abs(p.sy - p.startSy) && g.canOpenShelf() ? 'shut' : 'none'
      this.progress = 0
      return
    }
    if (this.tearCandidate !== -1) {
      this.mode = 'tear'
      this.target = this.tearCandidate
      this.host.feedback?.('grab', 0)
      return
    }
    if (this.creaseCandidate >= 0) {
      const w = g.boss.weakPoints[this.creaseCandidate]
      if (w && ux * w.sx + uz * w.sz > ALIGN) {
        this.mode = 'crease'
        this.target = this.creaseCandidate
        this.host.feedback?.('grab', 0)
        return
      }
    }
    let best = -1
    let bestDot = ALIGN
    for (let k = 0; k < this.near.length; k++) {
      const i = this.near[k]!
      const f = g.folds[i]
      if (!f) continue
      // Valleys fold along their length, either way.
      const dot = f.def.kind === 'valley'
        ? Math.abs(ux * f.def.sx + uz * f.def.sz)
        : ux * f.def.sx + uz * f.def.sz
      if (dot > bestDot) {
        bestDot = dot
        best = i
      }
    }
    if (best >= 0 && g.grab(best)) {
      this.mode = 'fold'
      this.target = best
      this.lastProgress = 0
      this.lastT = now
      this.speed = 0
      this.tickAcc = 0
      this.host.feedback?.('grab', 0)
      const f = g.folds[best]!
      const prog = this.foldProgress(f)
      g.drag(best, prog)
      return
    }
    this.mode = 'none'
  }

  /** Finger travel along the fold's arrow, normalised to the fold's size. */
  private foldProgress(f: FoldState): number {
    const p = this.a
    const dx = p.x - p.startX
    const dz = p.z - p.startZ
    const k = f.def.kind
    let along: number
    let full: number
    if (k === 'valley') {
      along = Math.abs(dx * f.def.sx + dz * f.def.sz)
      full = Math.max(1.4, f.len * 0.3)
    } else {
      along = dx * f.def.sx + dz * f.def.sz
      full = k === 'ridge' ? Math.max(1.3, f.def.depth * 1.5) : Math.max(1.15, f.def.depth * 0.8)
    }
    return Math.max(0, Math.min(1, along / full))
  }

  private track(prog: number, now: number): void {
    const dt = Math.max(1, now - this.lastT) / 1000
    const v = (prog - this.lastProgress) / dt
    this.speed = this.speed * 0.6 + v * 0.4
    this.lastProgress = prog
    this.lastT = now
    this.progress = prog
  }

  /** Haptic/audio ticks every ~6 % of progress while dragging. */
  private tick(prog: number, kind: GestureFeedback): void {
    const step = Math.floor(prog * 16)
    if (step !== this.tickAcc) {
      this.tickAcc = step
      this.host.feedback?.(kind, prog)
    }
  }
}
