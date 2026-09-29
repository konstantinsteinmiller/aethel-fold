/**
 * Fold lines: the state machine behind "Swipe to Fold" and "Tap to Stamp".
 *
 *   hidden ─► ready ─grab─► dragging ─release≥threshold─► snapping ─► up
 *                ▲              │                                     │ │
 *                │              └─release<threshold (spring back)──┐  │ └─tap─► stamping ─► cooldown
 *                │                                                 ▼  └─hold expires/broken─► lowering ─► cooldown
 *                └──────────────────────── cooldown timer ◄──────────────────────────────────────────────┘
 *
 * `t` is the one number the renderer needs: 0 = flat on the page, 1 = fully
 * folded (a wall at 90°, a launch flap at 180°, a valley dipped into its V, a
 * ridge at its peak). This module only moves `t` and reports *moments* (snap,
 * stamp impact) through return codes — what a snap launches or a stamp crushes
 * is decided by the game, which knows about enemies.
 */

import {
  FOLD_FLICK_SPEED, FOLD_LOWER_TIME, FOLD_SNAP_THRESHOLD, FOLD_SNAP_TIME, FOLD_SPRING_RATE,
  FOLD_STAMP_TIME, VALLEY_SHUT_TIME
} from './config'
import { clamp01, damp } from './math'
import type { FoldDef, FoldState } from './types'

export const createFold = (def: FoldDef): FoldState => {
  const dx = def.bx - def.ax
  const dz = def.bz - def.az
  const len = Math.sqrt(dx * dx + dz * dz) || 1
  const ux = dx / len
  const uz = dz / len
  // perp = (-uz, ux) is the positive `sideOf` side; the flap is on `side`.
  const nx = -uz * def.side
  const nz = ux * def.side
  return {
    def,
    ux, uz, nx, nz, len,
    cx: (def.ax + def.bx) / 2,
    cz: (def.az + def.bz) / 2,
    phase: 'hidden',
    t: 0,
    v: 0,
    drag: 0,
    timer: 0,
    hp: def.hp,
    flash: 0,
    rev: 0,
    ammo: 0,
    aimX: (def.ax + def.bx) / 2,
    aimZ: -7
  }
}

// ─── Geometry queries ──────────────────────────────────────────────────────

/** Along-hinge coordinate of a point (0 at a, len at b). */
export const alongHinge = (f: FoldState, x: number, z: number): number =>
  (x - f.def.ax) * f.ux + (z - f.def.az) * f.uz

/** Signed distance from the hinge line, positive toward the flap. */
export const acrossHinge = (f: FoldState, x: number, z: number): number =>
  (x - f.def.ax) * f.nx + (z - f.def.az) * f.nz

/**
 * Is (x, z) on the flap's footprint? For a valley/ridge the footprint is the
 * strip either side of the centre line.
 */
export const onFootprint = (f: FoldState, x: number, z: number, margin = 0): boolean => {
  const s = alongHinge(f, x, z)
  if (s < -margin || s > f.len + margin) return false
  const d = acrossHinge(f, x, z)
  const k = f.def.kind
  if (k === 'valley' || k === 'ridge') return Math.abs(d) <= f.def.depth + margin
  return d >= -margin && d <= f.def.depth + margin
}

/** Page-space point on the flap: (s along the hinge, d across it). */
export const flapPoint = (f: FoldState, s: number, d: number, out: { x: number; z: number }) => {
  out.x = f.def.ax + f.ux * s + f.nx * d
  out.z = f.def.az + f.uz * s + f.nz * d
  return out
}

/** Does this fold currently stand up as a barrier? */
export const isBarrier = (f: FoldState): boolean => {
  const k = f.def.kind
  if (k === 'wall') return (f.phase === 'up' || f.phase === 'snapping') && f.t >= 0.55
  if (k === 'ridge') return (f.phase === 'up' || f.phase === 'snapping') && f.t >= 0.5
  return false
}

/** Is this valley raised into a trap? */
export const isTrap = (f: FoldState): boolean =>
  f.def.kind === 'valley' && (f.phase === 'up' || f.phase === 'snapping') && f.t >= 0.5

export const isGrabbable = (f: FoldState): boolean => f.phase === 'ready'

export const isStampable = (f: FoldState): boolean =>
  (f.def.kind === 'wall' || f.def.kind === 'valley') && f.phase === 'up' && f.t > 0.9

// ─── Player input ──────────────────────────────────────────────────────────

export const grabFold = (f: FoldState): boolean => {
  if (!isGrabbable(f)) return false
  f.phase = 'dragging'
  f.drag = 0
  f.v = 0
  return true
}

/** Finger progress along the swipe, 0…1 (can overshoot; clamped). */
export const dragFold = (f: FoldState, progress: number): void => {
  if (f.phase !== 'dragging') return
  f.drag = clamp01(progress)
}

/**
 * Let go. Returns true if the fold is now snapping home.
 * `speed` is the finger's progress velocity (per second) at release.
 */
export const releaseFold = (f: FoldState, speed = 0): boolean => {
  if (f.phase !== 'dragging') return false
  if (f.drag >= FOLD_SNAP_THRESHOLD || (f.drag > 0.12 && speed >= FOLD_FLICK_SPEED)) {
    f.phase = 'snapping'
    f.v = Math.max(1 / FOLD_SNAP_TIME, speed)
    return true
  }
  f.phase = 'ready'
  return false
}

/** Drop a drag without judging it (pause, lost pointer): the flap springs back. */
export const abandonFold = (f: FoldState): void => {
  if (f.phase === 'dragging') f.phase = 'ready'
}

/** Force-snap (lesson auto-complete, tests, keyboard accessibility). */
export const snapFold = (f: FoldState): boolean => {
  if (f.phase !== 'ready' && f.phase !== 'dragging') return false
  f.phase = 'snapping'
  f.v = 1 / FOLD_SNAP_TIME
  return true
}

export const stampFold = (f: FoldState): boolean => {
  if (!isStampable(f)) return false
  f.phase = 'stamping'
  f.v = 1 / FOLD_STAMP_TIME
  return true
}

/** Hide/show at page start or when a wave introduces it. */
export const revealFold = (f: FoldState): void => {
  if (f.phase !== 'hidden') return
  f.phase = 'ready'
  f.t = 0
  f.hp = f.def.hp
}

/** Knock damage into a raised wall; returns true if it broke. */
export const damageFold = (f: FoldState, amount: number): boolean => {
  if (f.phase !== 'up') return false
  f.hp -= amount
  f.flash = Math.max(f.flash, 0.5)
  if (f.hp <= 0) {
    f.phase = 'lowering'
    f.timer = 0
    return true
  }
  return false
}

// ─── Per-frame dynamics ────────────────────────────────────────────────────

/** Moments reported by `updateFold`. */
export const FOLD_NONE = 0
export const FOLD_SNAPPED = 1
export const FOLD_STAMPED = 2
export const FOLD_LOWERED = 3
export const FOLD_READY = 4
export const FOLD_SPRUNG = 5

export const updateFold = (f: FoldState, dt: number): number => {
  if (f.flash > 0) f.flash = Math.max(0, f.flash - dt * 2.5)
  switch (f.phase) {
    case 'hidden':
    case 'spent':
      return FOLD_NONE
    case 'ready': {
      // Spring back after an abandoned drag.
      if (f.t > 0.0005) {
        f.t = damp(f.t, 0, FOLD_SPRING_RATE, dt)
        if (f.t <= 0.0005) {
          f.t = 0
          return FOLD_SPRUNG
        }
      }
      return FOLD_NONE
    }
    case 'dragging':
      // Follow the finger tightly but not rigidly — paper has a little weight.
      f.t = damp(f.t, f.drag * 0.92, 28, dt)
      return FOLD_NONE
    case 'snapping': {
      // Accelerating snap: the closer it gets, the faster it goes (a *snap*).
      f.v += dt * 60
      f.t += f.v * dt
      if (f.t >= 1) {
        f.t = 1
        f.v = 0
        f.flash = 1
        f.rev++
        const k = f.def.kind
        // A launch flap with a hold folds back after a beat and re-arms.
        if (k === 'frog' || (k === 'launch' && !(f.def.hold > 0))) f.phase = 'spent'
        else {
          f.phase = 'up'
          f.timer = f.def.hold
        }
        return FOLD_SNAPPED
      }
      return FOLD_NONE
    }
    case 'up': {
      if (Number.isFinite(f.timer)) {
        f.timer -= dt
        if (f.timer <= 0) {
          f.phase = 'lowering'
          return FOLD_NONE
        }
      }
      return FOLD_NONE
    }
    case 'stamping': {
      f.t -= f.v * dt
      if (f.t <= 0) {
        f.t = 0
        f.v = 0
        f.flash = 1
        f.rev++
        if (f.def.kind === 'valley') {
          // The ravine stays shut a beat so the crush reads, then cools down.
          f.phase = 'cooldown'
          f.timer = Math.max(f.def.cooldown, VALLEY_SHUT_TIME)
        } else {
          f.phase = 'cooldown'
          f.timer = f.def.cooldown
        }
        return FOLD_STAMPED
      }
      return FOLD_NONE
    }
    case 'lowering': {
      f.t -= dt / FOLD_LOWER_TIME
      if (f.t <= 0) {
        f.t = 0
        f.phase = 'cooldown'
        f.timer = f.def.cooldown
        f.hp = f.def.hp
        return FOLD_LOWERED
      }
      return FOLD_NONE
    }
    case 'cooldown': {
      f.timer -= dt
      if (f.timer <= 0) {
        f.phase = 'ready'
        f.hp = f.def.hp
        return FOLD_READY
      }
      return FOLD_NONE
    }
  }
  return FOLD_NONE
}
