/**
 * The bookshelf on the desk (roadmap #2): chapter select without a menu.
 *
 * After the first victory a small cardboard shelf stands on the desk right of
 * the book, one standing book per book of the game (three since roadmap #3;
 * a slot past the last playable book would stand as a "coming" silhouette).
 * Each spine carries the stars earned in it. Wide
 * aspects see the shelf beside the page; portrait zooms the camera out to it.
 * While the camera is out at the shelf the world stands still (sim time); the
 * paper under a finger still settles in real time.
 *
 * Tapping a book pulls it out a little and shows its stars per page; tapping
 * it again opens it — the current book zooms back in and play continues,
 * any other unlocked book starts on page 1. Locked books are silhouettes and
 * only shake.
 *
 * Pure: no three.js, no Vue. The game owns one `ShelfState`, the host feeds it
 * the saved progress (`setShelfProgress`), the view draws it.
 *
 * Slots after the books are the Dragon Rush figurines (roadmap #16), one per
 * book, standing on the top board once the book is won; tapped like a book
 * (pull out → a card with the par and best time; again → the rush starts).
 * The secrets counter (roadmap #15) is a card on the top board beside them,
 * drawn by the view from the save — not a slot, since it isn't opened.
 */

import { SHELF } from './config'
import { BOOKS } from './pages'
import { rushPar, rushUnlocked } from './rush'
import type { BookId, Stars } from './types'

/**
 * What stands in a slot: a book, or (roadmap #16) the Dragon Rush figurine
 * of a won book — a little folded dragon on the shelf's top board.
 */
export type ShelfSlotKind = 'book' | 'rush'

/**
 *   current — the book being played (tap twice: back to it, play continues)
 *   open    — unlocked, not the one being played (tap twice: start it on page 1)
 *   locked  — exists but not unlocked yet: a silhouette
 *   coming  — not in the game yet (book 3): a silhouette with a question mark
 */
export type ShelfSlotState = 'current' | 'open' | 'locked' | 'coming' | 'hidden'

export interface ShelfSlot {
  kind: ShelfSlotKind
  /** Book number (1-based; may be a book that isn't in `BOOKS` yet). */
  book: number
  state: ShelfSlotState
  /** Stars earned in it, and the most it has (3 × rated pages). */
  stars: number
  max: number
  /** Best stars per rated page, in page order. */
  pages: Stars[]
  /** Won at least once. */
  won: boolean
  /** Rush slots: the best time (s, 0 = none yet) and the par. */
  best: number
  par: number
}

/** Saved progress, one entry per book (index = book − 1). */
export interface ShelfProgress {
  wins: number[]
  cleared: number[]
  /** Best stars per rated page. */
  stars: Stars[][]
  /** Best Dragon Rush time per book, seconds (0 = none). */
  rush?: number[]
}

/** Why the shelf opened (the `shelf` event's `b`). */
export type ShelfReason = 'button' | 'tap' | 'victory' | 'shut'
export const SHELF_REASONS: readonly ShelfReason[] = ['button', 'tap', 'victory', 'shut']

/** `pickShelf` result: the tap landed on the open book on the desk. */
export const SHELF_DESK = -2
/** `pickShelf` result: the tap hit nothing. */
export const SHELF_NONE = -1

export interface ShelfState {
  /** The shelf is on the desk (a book has been won). */
  available: boolean
  /** The play camera already shows it (wide aspects); portrait needs the zoom button. */
  inView: boolean
  /** The camera is out at the shelf; the world stands still. */
  open: boolean
  reason: ShelfReason
  /** Opened on a won book: every book starts on page 1, nothing "continues". */
  finished: boolean
  /** Pulled-out slot being inspected, or -1. */
  selected: number
  /** The slot with the pulsing "tap me" outline, or -1. */
  highlight: number
  /** The victory already turned to the shelf once (it doesn't do it again). */
  autoShown: boolean
  slots: ShelfSlot[]
  progress: ShelfProgress
  /** Bumped on any change the view repaints for. */
  rev: number
}

/** Is `book` a book of the game (has pages)? */
export const isPlayableBook = (book: number): book is BookId => Object.prototype.hasOwnProperty.call(BOOKS, book)

/**
 * Unlock rule: book 1 is always open; book n opens once book n − 1 has been
 * won (or book n itself was already played or won — a save from elsewhere).
 */
export const bookUnlockedBy = (book: number, wins: readonly number[], cleared: readonly number[]): boolean => {
  if (!isPlayableBook(book)) return false
  if (book === 1) return true
  return (wins[book - 2] ?? 0) > 0 || (wins[book - 1] ?? 0) > 0 || (cleared[book - 1] ?? 0) > 0
}

/** The shelf appears after the first victory. */
export const shelfAvailable = (wins: readonly number[]): boolean => {
  for (const w of wins) if (w > 0) return true
  return false
}

/** Slot index of a book. */
export const slotOfBook = (book: number): number => book - 1

const emptyProgress = (): ShelfProgress => ({ wins: [], cleared: [], stars: [], rush: [] })

/** Slot index of a book's Dragon Rush figurine (after the book slots). */
export const rushSlotOf = (book: number): number => SHELF.slots + book - 1

/** The slots for some progress. `finished`: the current book has just been won. Allocates (events only). */
export const buildSlots = (p: ShelfProgress, current: BookId, finished: boolean): ShelfSlot[] => {
  const out: ShelfSlot[] = []
  for (let i = 0; i < SHELF.slots; i++) {
    const book = i + 1
    const pages = isPlayableBook(book) ? (p.stars[i] ?? []).slice() : []
    let stars = 0
    for (const s of pages) stars += s
    const state: ShelfSlotState = !isPlayableBook(book)
      ? 'coming'
      : !bookUnlockedBy(book, p.wins, p.cleared)
        ? 'locked'
        : book === current && !finished ? 'current' : 'open'
    out.push({ kind: 'book', book, state, stars, max: pages.length * 3, pages, won: (p.wins[i] ?? 0) > 0, best: 0, par: 0 })
  }
  // A Dragon Rush figurine per book of the game, standing once the book is won.
  for (let book = 1; isPlayableBook(book); book++) {
    const won = rushUnlocked(book, p.wins)
    out.push({
      kind: 'rush', book, state: won ? 'open' : 'hidden', stars: 0, max: 0, pages: [], won,
      best: p.rush?.[book - 1] ?? 0, par: rushPar(book)
    })
  }
  return out
}

/** Can this slot be opened (tapped through)? */
export const slotActionable = (s: ShelfSlot | undefined): boolean => !!s && (s.state === 'current' || s.state === 'open')

/**
 * Which slot glows. Mid-run: the current book (tap it to go back). After a
 * win: the next book in line that is open and not yet won — the one just
 * unlocked — or, when there is none, the book just finished.
 */
export const shelfTarget = (slots: readonly ShelfSlot[], current: BookId, finished: boolean): number => {
  const cur = slotOfBook(current)
  if (!finished) return slotActionable(slots[cur]) ? cur : -1
  const books = SHELF.slots
  for (let k = 1; k <= books; k++) {
    const i = (cur + k) % books
    const s = slots[i]!
    if (s.kind === 'book' && slotActionable(s) && !s.won) return i
  }
  return slotActionable(slots[cur]) ? cur : -1
}

export const createShelfState = (): ShelfState => ({
  available: false,
  inView: false,
  open: false,
  reason: 'button',
  finished: false,
  selected: -1,
  highlight: -1,
  autoShown: false,
  slots: buildSlots(emptyProgress(), 1, false),
  progress: emptyProgress(),
  rev: 0
})

/** Rebuild the slots and highlight (progress changed, a book opened, a win). */
export const refreshShelf = (s: ShelfState, current: BookId): void => {
  s.available = shelfAvailable(s.progress.wins)
  s.slots = buildSlots(s.progress, current, s.finished)
  s.highlight = shelfTarget(s.slots, current, s.finished)
  if (s.selected >= 0 && !slotActionable(s.slots[s.selected])) s.selected = -1
  s.rev++
}

/** Take a copy of the saved progress. */
export const setShelfProgress = (s: ShelfState, p: ShelfProgress, current: BookId): void => {
  s.progress = { wins: p.wins.slice(), cleared: p.cleared.slice(), stars: p.stars.map((a) => a.slice()), rush: (p.rush ?? []).slice() }
  refreshShelf(s, current)
}

/** A book was just won (before the save round-trip brings it back). */
export const noteShelfWin = (s: ShelfState, book: BookId): void => {
  const i = slotOfBook(book)
  const w = s.progress.wins
  while (w.length <= i) w.push(0)
  w[i] = Math.max(1, w[i]!)
}

export interface ShelfPoint {
  x: number
  y: number
  z: number
}

/** Shelf-local point (x along the shelf, y up from the desk, z toward the player) → page space. */
export const shelfToWorld = (lx: number, ly: number, lz: number, out: ShelfPoint): ShelfPoint => {
  // Lean back about x…
  const cl = Math.cos(SHELF.lean)
  const sl = Math.sin(SHELF.lean)
  const y1 = ly * cl - lz * sl
  const z1 = ly * sl + lz * cl
  // …then turn about y.
  const cy = Math.cos(SHELF.yaw)
  const sy = Math.sin(SHELF.yaw)
  out.x = SHELF.x + lx * cy + z1 * sy
  out.z = SHELF.z - lx * sy + z1 * cy
  out.y = SHELF.y + y1
  return out
}

/** Shelf-local x of a slot's centre (a rush figurine: its spot on the top board). */
export const slotX = (i: number): number =>
  i < SHELF.slots ? (i - (SHELF.slots - 1) / 2) * SHELF.spacing : SHELF.rushX[i - SHELF.slots] ?? SHELF.rushX[0]!

/** Is this slot index a Dragon Rush figurine? */
export const isRushSlot = (i: number): boolean => i >= SHELF.slots

/** Shelf-local height of the top board's upper face (the rush figurines and the secrets card stand on it). */
export const shelfTopY = (): number => SHELF.board * 2 + SHELF.bookH + 0.28

/**
 * World position of a point on a slot's spine (`up` = 0 bottom … 1 top), with
 * the book pulled `pull` of the way out. Shared by the ghost hand and the
 * view, so the hand lands on the book the renderer draws.
 */
export const slotAnchor = (i: number, out: ShelfPoint, pull = 0, up = 0.5): ShelfPoint =>
  isRushSlot(i)
    // A figurine on the top board; "pulled out" it hops up a little.
    ? shelfToWorld(slotX(i), shelfTopY() + SHELF.rushH * up + pull * 0.35, 0.1, out)
    : shelfToWorld(slotX(i), SHELF.board + SHELF.bookH * up, SHELF.bookD / 2 + pull * SHELF.pull, out)

/** Half the shelf's outer width (shelf-local x). */
export const shelfHalfWidth = (): number => ((SHELF.slots - 1) / 2) * SHELF.spacing + SHELF.bookW / 2 + SHELF.board + 0.12

// ─── The star card ───────────────────────────────────────────────────────────

/** The inspect card's size in shelf units (its canvas is 256 × 320). */
export const SHELF_CARD_W = 2.1
export const SHELF_CARD_H = (SHELF_CARD_W * 320) / 256
/**
 * Close-up (portrait phones, where the camera frames the shelf alone): the
 * card grows, leans back to face the camera (pitch 49°, lean −0.32 → about
 * −0.53) and stays inside the shelf's width so it can't widen the framing.
 */
const CLOSE_CARD_SCALE = 1.4
const CLOSE_CARD_TILT = -0.5

/** Where the star card stands in the (leaned) rack: centre x, foot y and z, tilt about x, scale. */
export interface ShelfCardPose {
  x: number
  y: number
  z: number
  tilt: number
  scale: number
}

/**
 * The star card's pose for a slot, `k` of the way risen out of a book pulled
 * `pull` of the way out. `close`: the portrait close-up. Pure, allocation-free.
 */
export const shelfCardPose = (slot: number, pull: number, k: number, close: boolean, out: ShelfCardPose): ShelfCardPose => {
  const s = close ? CLOSE_CARD_SCALE : 1
  const room = shelfHalfWidth() - (SHELF_CARD_W * s) / 2
  const x = slotX(slot)
  out.x = close ? Math.max(-room, Math.min(room, x)) : x
  out.y = SHELF.board + SHELF.bookH * (0.55 + 0.45 * k) + (close ? 0.2 : 0.1)
  out.z = SHELF.bookD / 2 + pull * SHELF.pull - 0.25
  out.tilt = (close ? CLOSE_CARD_TILT : 0.35) * k
  out.scale = (0.25 + 0.75 * k) * s
  return out
}

/** Page-space point on the card: `u` −0.5 … 0.5 across, `v` 0 (foot) … 1 (top). */
export const shelfCardPoint = (c: ShelfCardPose, u: number, v: number, out: ShelfPoint): ShelfPoint => {
  const ly = v * SHELF_CARD_H * c.scale
  return shelfToWorld(c.x + u * SHELF_CARD_W * c.scale, c.y + ly * Math.cos(c.tilt), c.z + ly * Math.sin(c.tilt), out)
}
