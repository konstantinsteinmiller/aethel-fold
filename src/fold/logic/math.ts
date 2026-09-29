/**
 * Tiny, allocation-free 2D helpers for the page plane.
 *
 * The game logic lives on the page: x runs left→right across the sheet, z runs
 * top→bottom (enemy side → player side). Nothing in `logic/` knows three.js,
 * so these are the only vector maths it needs. Every helper that produces a
 * vector writes into an `out` argument — the simulation runs every frame and
 * must not allocate.
 */

export interface V2 {
  x: number
  z: number
}

export const v2 = (x = 0, z = 0): V2 => ({ x, z })

export const set = (out: V2, x: number, z: number): V2 => {
  out.x = x
  out.z = z
  return out
}

export const copy = (out: V2, a: V2): V2 => {
  out.x = a.x
  out.z = a.z
  return out
}

export const dot = (a: V2, b: V2): number => a.x * b.x + a.z * b.z

export const len = (x: number, z: number): number => Math.sqrt(x * x + z * z)

export const dist = (a: V2, b: V2): number => len(a.x - b.x, a.z - b.z)

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Frame-rate independent exponential approach (`rate` per second). */
export const damp = (current: number, target: number, rate: number, dt: number): number =>
  target + (current - target) * Math.exp(-rate * dt)

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

export const easeOutBack = (t: number, s = 1.70158): number => {
  const u = t - 1
  return 1 + u * u * ((s + 1) * u + s)
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

export const easeInCubic = (t: number): number => t * t * t

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/**
 * Distance from point p to the segment ab, and the parametric position along
 * it (0 at a, 1 at b), written into `out` as { x: distance, z: t }.
 */
export const segmentDistance = (
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number,
  out: V2
): V2 => {
  const abx = bx - ax
  const abz = bz - az
  const l2 = abx * abx + abz * abz
  let t = l2 > 1e-9 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0
  t = clamp01(t)
  const cx = ax + abx * t
  const cz = az + abz * t
  out.x = len(px - cx, pz - cz)
  out.z = t
  return out
}

/**
 * Signed side of p relative to the directed line a→b in the page plane.
 * Positive = to the left when looking from a toward b with z pointing "down
 * the page". Only the sign and relative magnitude are ever used.
 */
export const sideOf = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number =>
  (bx - ax) * (pz - az) - (bz - az) * (px - ax)

/** Do segments p1p2 and q1q2 properly intersect? */
export const segmentsCross = (
  p1x: number, p1z: number, p2x: number, p2z: number,
  q1x: number, q1z: number, q2x: number, q2z: number
): boolean => {
  const d1 = sideOf(q1x, q1z, p1x, p1z, p2x, p2z)
  const d2 = sideOf(q2x, q2z, p1x, p1z, p2x, p2z)
  const d3 = sideOf(p1x, p1z, q1x, q1z, q2x, q2z)
  const d4 = sideOf(p2x, p2z, q1x, q1z, q2x, q2z)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** Shortest signed angle difference a→b, in radians, in (-π, π]. */
export const angleDelta = (a: number, b: number): number => {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d <= -Math.PI) d += Math.PI * 2
  return d
}

/** Gravity for everything thrown (page units / s²) — floaty on purpose: it's paper. */
export const G_PAPER = 14
