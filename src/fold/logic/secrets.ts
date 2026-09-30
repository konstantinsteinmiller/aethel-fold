/**
 * Page secrets (roadmap #15): one hidden interaction per page, twelve over the
 * two books. Never required, never hinted — no highlight bit, no lesson, no
 * hand — but each pays off on the spot: a sparkle, a chime and, the first time
 * ever, a small score bonus (`SECRET.bonus`, kept out of the page's star
 * rating). Found secrets are kept in the save (`aethel_state.fold_secrets`, a
 * list of ids) and counted on the desk shelf and in the pause bookshelf.
 *
 * Kinds of trigger:
 *   desk  — a desk prop, on any page (the lamp: night mode)
 *   taps  — `SECRET.taps` taps on one thing, each within `SECRET.tapGap`
 *   folds — one fold snapped `count` times on one visit to the page
 *   pair  — two folds snapped within `SECRET.pairGap` of each other
 *   sling — a sling stone landing on a spot (a disc) or across a band
 *
 * A tap secret's target may stand up off the page (the windmill, the hero on
 * his keep): the view writes where it *appears* on the page plane into
 * `spotX/spotZ` each frame (like the tear anchors), so the finger lands on
 * what the eye sees. A secret tap never eats the tap: whatever else it does
 * (a stamp) still happens — except that a tap clearly on the hero
 * (`SECRET.heroClear` of the target's reach) doesn't also loose a ballista
 * bolt past him.
 *
 * Adding book 3: append six more `SECRETS` with `book: 3`. Codes are the index
 * in `SECRET_IDS` (append-only); every counter derives from the list.
 *
 * Pure: no three.js, no Vue. Nothing here allocates per frame.
 */

import { BOSS, HERO_X, HERO_Z, SECRET } from './config'
import type { PageId } from './types'

export type SecretId =
  | 'lamp' | 'boat' | 'fling' | 'moat' | 'nap' | 'hop'
  | 'wave' | 'apples' | 'whirl' | 'campfire' | 'bonk' | 'flap'

export type SecretTrigger = 'desk' | 'taps' | 'folds' | 'pair' | 'sling'

/**
 * When it can be set off:
 *   play   — while the page is being played (intro, play, cleared)
 *   asleep — before the dragon wakes (dormant, rumble, unfold)
 *   finale — once the finale fold is done (finale, victory)
 */
export type SecretWhen = 'play' | 'asleep' | 'finale'

export interface SecretDef {
  id: SecretId
  book: number
  page: PageId
  trigger: SecretTrigger
  when: SecretWhen
  /** Target (taps, sling): page-space centre, height of the thing tapped, and reach. */
  x: number
  y: number
  z: number
  r: number
  /** Sling: a disc around (x, z), or a band across the page at z (± r). */
  shape: 'disc' | 'band'
  /** Taps on the hero: the target follows him. */
  hero: boolean
  /** Folds (by `FoldDef.id`) for `folds` / `pair`. */
  folds: readonly string[]
  count: number
}

const def = (d: Partial<SecretDef> & Pick<SecretDef, 'id' | 'book' | 'page' | 'trigger'>): SecretDef => ({
  when: 'play', x: 0, y: 0, z: 0, r: 1, shape: 'disc', hero: false, folds: [], count: 0, ...d
})

/**
 * The twelve. Book 1:
 *   lamp     desk lamp: tap it → night mode (the lamp's warm pool on a periwinkle desk)
 *   boat     the Ravine: fold the ravine three times → a paper boat sails down it
 *   fling    the Siege: flip both catapult flaps at once → a double fling, fireworks
 *   moat     the Gates: a sling stone into the moat → a splash
 *   nap      the Castle Core: tap the sleeping core three times before the dragon wakes → it snores
 *   hop      the Frog: tap the folded frog three times → it hops
 * Book 2:
 *   wave     Home: tap the hero three times → he waves
 *   apples   the Orchard: tap the big apple tree by the keep three times → apples fall
 *   whirl    the Mill: tap the windmill three times → the sails whirl
 *   campfire the Camp: tap the enemy campfire three times → sparks fly
 *   bonk     the Return: a sling stone on the dragon before it wakes → bonk
 *   flap     the Crane: tap the folded crane three times → it flaps its wings
 */
export const SECRETS: readonly SecretDef[] = [
  def({ id: 'lamp', book: 1, page: 1, trigger: 'desk' }),
  def({ id: 'boat', book: 1, page: 2, trigger: 'folds', folds: ['p2-ravine'], count: 3 }),
  def({ id: 'fling', book: 1, page: 3, trigger: 'pair', folds: ['p3-launch-l', 'p3-launch-r'] }),
  def({ id: 'moat', book: 1, page: 4, trigger: 'sling', shape: 'band', z: -3.05, r: 0.5 }),
  def({ id: 'nap', book: 1, page: 5, trigger: 'taps', when: 'asleep', x: 0, y: 1.1, z: -3.2, r: 1.7 }),
  def({ id: 'hop', book: 1, page: 6, trigger: 'taps', when: 'finale', x: 0, y: 1, z: 0.6, r: 1.7 }),
  def({ id: 'wave', book: 2, page: 1, trigger: 'taps', hero: true, x: HERO_X, y: 1.5, z: HERO_Z, r: 0.95 }),
  def({ id: 'apples', book: 2, page: 2, trigger: 'taps', x: -4.35, y: 1.1, z: 4.6, r: 0.95 }),
  def({ id: 'whirl', book: 2, page: 3, trigger: 'taps', x: 4.3, y: 1.45, z: -0.83, r: 1.15 }),
  def({ id: 'campfire', book: 2, page: 4, trigger: 'taps', x: -1.2, y: 0, z: -6.2, r: 0.8 }),
  def({ id: 'bonk', book: 2, page: 5, trigger: 'sling', when: 'asleep', x: BOSS.bodyX, z: BOSS.bodyZ, r: BOSS.bodyRadius }),
  def({ id: 'flap', book: 2, page: 6, trigger: 'taps', when: 'finale', x: 0, y: 1.2, z: 0.6, r: 1.7 })
]

export const SECRET_IDS: readonly SecretId[] = SECRETS.map((s) => s.id)
export const SECRET_TOTAL = SECRETS.length

/** Event code of a secret (its index; append-only). */
export const secretCode = (id: SecretId): number => SECRET_IDS.indexOf(id)
export const secretById = (id: string): SecretDef | undefined => SECRETS.find((s) => s.id === id)
export const isSecretId = (v: unknown): v is SecretId => typeof v === 'string' && (SECRET_IDS as readonly string[]).includes(v)

/** The page-bound secret of a page (desk secrets are on every page and not listed here), or null. */
export const secretOnPage = (book: number, page: number): SecretDef | null => {
  for (const s of SECRETS) if (s.book === book && s.page === page && s.trigger !== 'desk') return s
  return null
}

/** How many secrets a book hides (the desk lamp counts for book 1). */
export const secretsInBook = (book: number): number => {
  let n = 0
  for (const s of SECRETS) if (s.book === book) n++
  return n
}

/** Sanitise a stored `fold_secrets` list: known ids only, each once, in `SECRETS` order. */
export const readSecretList = (v: unknown): SecretId[] => {
  if (!Array.isArray(v)) return []
  const have = new Set(v.filter(isSecretId))
  return SECRET_IDS.filter((id) => have.has(id))
}

/** Union of two found lists (a save merge must never lose a secret). */
export const mergeSecretLists = (a: readonly string[], b: readonly string[]): SecretId[] => readSecretList([...a, ...b])

/** Found secrets, over every book or in one. */
export const countFound = (found: readonly string[], book?: number): number => {
  let n = 0
  for (const s of SECRETS) if ((book === undefined || s.book === book) && found.includes(s.id)) n++
  return n
}

// ─── Detection state ─────────────────────────────────────────────────────────

export interface SecretState {
  /** Ids ever found (the host feeds the saved list; discoveries add to it). */
  found: Record<string, boolean>
  /** This page's secret, or null. */
  def: SecretDef | null
  /** Where the tap target appears on the page plane (the view keeps it current). */
  spotX: number
  spotZ: number
  /** Real seconds on this page (the tap and pair windows use it). */
  clock: number
  taps: number
  lastTap: number
  /** Snaps of the counted fold on this visit. */
  count: number
  /** Last snap time of each fold of a pair. */
  pairA: number
  pairB: number
  /** Night mode (the lamp), a cosmetic the host persists. */
  night: boolean
  rev: number
}

export const createSecretState = (found: readonly string[] = []): SecretState => {
  const f: Record<string, boolean> = {}
  for (const id of readSecretList(found)) f[id] = true
  return {
    found: f, def: null, spotX: 0, spotZ: 0, clock: 0, taps: 0, lastTap: -1e9, count: 0,
    pairA: -1e9, pairB: -1e9, night: false, rev: 0
  }
}

/** A page loads: its secret's counters start over (a visit is one page load). */
export const enterSecretPage = (s: SecretState, book: number, page: number): void => {
  const d = secretOnPage(book, page)
  s.def = d
  s.spotX = d ? d.x : 0
  s.spotZ = d ? d.z : 0
  s.clock = 0
  s.taps = 0
  s.lastTap = -1e9
  s.count = 0
  s.pairA = -1e9
  s.pairB = -1e9
  s.rev++
}

/** Mark found; true when it is new. */
export const markFound = (s: SecretState, id: SecretId): boolean => {
  if (s.found[id]) return false
  s.found[id] = true
  s.rev++
  return true
}

/**
 * A tap at page point (x, z) on the page's tap target: counts it (a tap too
 * long after the last one starts the count over). True when this tap is the
 * one that sets the secret off; the count then starts over.
 */
export const countSecretTap = (s: SecretState, x: number, z: number): boolean => {
  const d = s.def
  if (!d || d.trigger !== 'taps') return false
  const dx = x - s.spotX
  const dz = z - s.spotZ
  if (dx * dx + dz * dz > d.r * d.r) return false
  if (s.clock - s.lastTap > SECRET.tapGap) s.taps = 0
  s.taps++
  s.lastTap = s.clock
  if (s.taps < SECRET.taps) return false
  s.taps = 0
  s.lastTap = -1e9
  return true
}

/**
 * Is a tap within `k` × the target's reach of where it appears (`spotX/Z`)?
 * `k` < 1 asks for a tap clearly on the target, not just near it.
 */
export const tapOnSpot = (s: SecretState, x: number, z: number, k = 1): boolean => {
  const d = s.def
  if (!d) return false
  const dx = x - s.spotX
  const dz = z - s.spotZ
  const r = d.r * k
  return dx * dx + dz * dz <= r * r
}

/** A fold snapped (by `FoldDef.id`): true when it completes the page's fold or pair secret. */
export const noteSecretSnap = (s: SecretState, foldId: string): boolean => {
  const d = s.def
  if (!d) return false
  if (d.trigger === 'folds') {
    if (d.folds[0] !== foldId) return false
    s.count++
    if (s.count < d.count) return false
    s.count = 0
    return true
  }
  if (d.trigger === 'pair') {
    if (foldId === d.folds[0]) s.pairA = s.clock
    else if (foldId === d.folds[1]) s.pairB = s.clock
    else return false
    if (Math.abs(s.pairA - s.pairB) > SECRET.pairGap) return false
    s.pairA = -1e9
    s.pairB = -1e9
    return true
  }
  return false
}

/** A sling stone landed at (x, z): true when it hit the page's sling secret. */
export const slingSecretHit = (s: SecretState, x: number, z: number): boolean => {
  const d = s.def
  if (!d || d.trigger !== 'sling') return false
  if (d.shape === 'band') return Math.abs(z - d.z) <= d.r
  const dx = x - d.x
  const dz = z - d.z
  return dx * dx + dz * dz <= d.r * d.r
}
