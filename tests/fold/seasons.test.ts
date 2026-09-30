import { describe, expect, it } from 'vitest'
import { SEASON_WINDOWS, activeSeason, inWindow, parseSeason, seasonFor } from '@/fold/logic/seasons'

// ─── Seasonal page skins (roadmap #17) ─────────────────────────────────────

/** A local date (month 1…12), at a given hour. */
const day = (y: number, m: number, d: number, h = 12, min = 0): Date => new Date(y, m - 1, d, h, min)

describe('seasonFor: Halloween 15 Oct – 2 Nov, Winter 10 Dec – 6 Jan (local, inclusive)', () => {
  it('Halloween boundaries', () => {
    expect(seasonFor(day(2026, 10, 14, 23, 59))).toBe('none')
    expect(seasonFor(day(2026, 10, 15, 0, 0))).toBe('halloween')
    expect(seasonFor(day(2026, 10, 31))).toBe('halloween')
    expect(seasonFor(day(2026, 11, 2, 23, 59))).toBe('halloween')
    expect(seasonFor(day(2026, 11, 3, 0, 0))).toBe('none')
  })

  it('Winter boundaries, across the new year', () => {
    expect(seasonFor(day(2026, 12, 9, 23, 59))).toBe('none')
    expect(seasonFor(day(2026, 12, 10, 0, 0))).toBe('winter')
    expect(seasonFor(day(2026, 12, 24))).toBe('winter')
    expect(seasonFor(day(2026, 12, 31, 23, 59))).toBe('winter')
    expect(seasonFor(day(2027, 1, 1, 0, 0))).toBe('winter')
    expect(seasonFor(day(2027, 1, 6, 23, 59))).toBe('winter')
    expect(seasonFor(day(2027, 1, 7, 0, 0))).toBe('none')
  })

  it('the rest of the year is plain, leap day included', () => {
    for (const [m, d] of [[1, 8], [2, 29], [3, 1], [6, 15], [9, 30], [10, 1], [11, 15], [12, 1]] as const) {
      expect(seasonFor(day(2028, m, d)), `${m}/${d}`).toBe('none')
    }
  })

  it('every day of a year falls in at most one window', () => {
    let halloween = 0
    let winter = 0
    for (let t = day(2026, 1, 1).getTime(); t < day(2027, 1, 1).getTime(); t += 86_400_000) {
      const d = new Date(t)
      const m = d.getMonth() + 1
      const hits = SEASON_WINDOWS.filter((w) => inWindow(w, m, d.getDate())).length
      expect(hits).toBeLessThanOrEqual(1)
      const s = seasonFor(d)
      if (s === 'halloween') halloween++
      if (s === 'winter') winter++
    }
    expect(halloween).toBe(19) // 15–31 Oct + 1–2 Nov
    expect(winter).toBe(28) // 10–31 Dec + 1–6 Jan
  })

  it('an invalid date is plain', () => {
    expect(seasonFor(new Date(Number.NaN))).toBe('none')
  })
})

describe('parseSeason and activeSeason', () => {
  it('parses the DEV override', () => {
    expect(parseSeason('halloween')).toBe('halloween')
    expect(parseSeason(' Winter ')).toBe('winter')
    expect(parseSeason('none')).toBe('none')
    expect(parseSeason('off')).toBe('none')
    expect(parseSeason('easter')).toBeNull()
    expect(parseSeason(null)).toBeNull()
    expect(parseSeason(3)).toBeNull()
  })

  it('the setting turns the date off; an override wins either way', () => {
    const oct = day(2026, 10, 20)
    expect(activeSeason(oct, true)).toBe('halloween')
    expect(activeSeason(oct, false)).toBe('none')
    expect(activeSeason(oct, false, 'winter')).toBe('winter')
    expect(activeSeason(day(2026, 6, 1), true, 'halloween')).toBe('halloween')
    expect(activeSeason(oct, true, 'none')).toBe('none')
  })
})
