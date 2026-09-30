/**
 * Seasonal page skins (roadmap #17): Halloween and Winter, switched on by the
 * player's local date. Art only — the view paints pumpkin towers, bat standees
 * and a dusk palette, or snow paper, snow-capped towers and a scarf on the
 * hero. No rule of the game reads the season.
 *
 *   halloween  15 Oct … 2 Nov  (inclusive)
 *   winter     10 Dec … 6 Jan  (inclusive, across the new year)
 *
 * The windows are by calendar day in the local time zone (`Date#getMonth` /
 * `getDate`), so a player sees the pumpkins from their own midnight. The host
 * can turn the decorations off (the "Seasonal decorations" setting) and a DEV
 * build can force one (`?season=halloween`, `__fold.setSeason`).
 *
 * Pure: no three.js, no Vue.
 */

export type Season = 'none' | 'halloween' | 'winter'

export const SEASONS: readonly Season[] = ['none', 'halloween', 'winter']

/** A window of calendar days: month 1…12, day of month, both ends inclusive; may wrap the year. */
export interface SeasonWindow {
  season: Exclude<Season, 'none'>
  from: { month: number; day: number }
  to: { month: number; day: number }
}

export const SEASON_WINDOWS: readonly SeasonWindow[] = [
  { season: 'halloween', from: { month: 10, day: 15 }, to: { month: 11, day: 2 } },
  { season: 'winter', from: { month: 12, day: 10 }, to: { month: 1, day: 6 } }
]

/** Month·100 + day, so calendar days compare as numbers (Oct 15 → 1015). */
const ordinal = (month: number, day: number): number => month * 100 + day

/** Is a calendar day inside a window (which may wrap past 31 Dec)? */
export const inWindow = (w: SeasonWindow, month: number, day: number): boolean => {
  const d = ordinal(month, day)
  const a = ordinal(w.from.month, w.from.day)
  const b = ordinal(w.to.month, w.to.day)
  return a <= b ? d >= a && d <= b : d >= a || d <= b
}

/** The season of a local date ('none' outside every window, or for an invalid date). */
export const seasonFor = (date: Date): Season => {
  const t = date.getTime()
  if (!Number.isFinite(t)) return 'none'
  const month = date.getMonth() + 1
  const day = date.getDate()
  for (const w of SEASON_WINDOWS) if (inWindow(w, month, day)) return w.season
  return 'none'
}

/** A season named in a query string or a debug call, or null when it names none. */
export const parseSeason = (v: unknown): Season | null => {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  if (s === 'off' || s === 'plain') return 'none'
  return (SEASONS as readonly string[]).includes(s) ? (s as Season) : null
}

/**
 * The season the view paints: the DEV override if there is one, else the
 * date's — and nothing while the player has turned the decorations off.
 */
export const activeSeason = (date: Date, enabled: boolean, override: Season | null = null): Season => {
  if (override !== null) return override
  return enabled ? seasonFor(date) : 'none'
}
