/**
 * Seeded PRNG (mulberry32). The simulation never calls Math.random so a test
 * can replay a page frame-for-frame.
 */
export interface Rng {
  next(): number
  range(lo: number, hi: number): number
  seed(s: number): void
}

export const createRng = (seed = 0x2f6b1c): Rng => {
  let a = seed >>> 0
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    seed: (s: number) => {
      a = s >>> 0
    }
  }
}
