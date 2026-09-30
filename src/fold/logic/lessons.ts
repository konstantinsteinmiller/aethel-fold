/**
 * Wordless onboarding (GDD §6). A lesson is: slow time down, show a ghost hand
 * performing the gesture on the exact spot, wait for the player to do it, then
 * give time back. No text is required to learn any mechanic.
 *
 * The controller is pure data the UI renders: `hand` describes the ghost
 * gesture in page space; the view projects it to the screen.
 */

import type { LessonId } from './types'

export type HandGesture = 'swipe' | 'tap' | 'spread' | 'drag'

/**
 * Where the hand's points live:
 *   page  — on the page plane (y = 0), the default
 *   world — a 3D point (`y` is its height): a book on the desk shelf
 *   zoom  — the HUD's shelf zoom button (the host resolves its screen rect)
 */
export type HandAnchor = 'page' | 'world' | 'zoom'

export interface HandCue {
  gesture: HandGesture
  /** Page-space start and end of the motion (tap: a = b). */
  ax: number
  az: number
  bx: number
  bz: number
  /** Optional height of the target above the page (structures, the dragon). */
  y: number
  anchor: HandAnchor
}

export interface LessonState {
  id: LessonId | null
  /** Sub-step (the stamp lesson is swipe-then-tap). */
  step: number
  /** Index of the fold / tear / weak point the lesson points at. */
  target: number
  /** Seconds the lesson has been showing. */
  age: number
  /** Whether the ghost hand is visible. */
  showHand: boolean
  hand: HandCue
  /** Time scale this lesson asks for (1 = none). */
  timeScale: number
  /** Idle hint (learned lessons): hand without slow-mo. */
  hint: boolean
  /** First-encounter demonstration (roadmap #4); `phase: 'off'` when none. */
  demo: LessonDemo
  rev: number
}

// ─── Demonstration ───────────────────────────────────────────────────────────
//
// On a lesson's first encounter the game *shows* the move before asking for
// it: the ghost hand performs the gesture while a ghost copy of the paper it
// acts on (a translucent flap, the sling's cup, a tear's crack, the page
// corner) moves with it, in sync, then fades. It loops until the player acts;
// any input cancels it on the spot (a short fade), so the real fold is under
// the finger at once. Pure choreography: it never touches fold state, enemies
// or time — the lesson's own slow-mo/freeze runs exactly as without it.

/**
 * The choreography of one loop:
 *   swipe    — the hand sweeps a → b and the ghost fold rises with it (0 → 1).
 *   swipeTap — swipe up, glide to the flap, press: the ghost slams shut (stamp).
 *   tap      — the hand presses and the raised ghost slams shut (1 → 0).
 *   pull     — the hand drags a → b pulling the ghost along, lets go: it springs back.
 */
export type DemoKind = 'swipe' | 'swipeTap' | 'tap' | 'pull'
export type DemoPhase = 'off' | 'show' | 'fade'
/** What the ghost copies: a fold's flap, a tear, the sling's cup, the page corner, or nothing. */
export type DemoOn = 'none' | 'fold' | 'tear' | 'sling' | 'peel'

export interface LessonDemo {
  phase: DemoPhase
  kind: DemoKind
  on: DemoOn
  /** Fold / tear index the ghost copies (-1 for none). */
  target: number
  /** Real seconds into the current loop. */
  clock: number
  /** Loops completed. */
  loops: number
  /** Stop after this many loops (0 = until the player acts). */
  maxLoops: number
  /** Ghost paper progress, 0…1 (fold angle / pull / tear opening / peel). */
  fold: number
  /** Hand progress along its a → b path, 0…1. */
  hand: number
  /** Hand gliding from the path's end to the tap point, 0…1. */
  glide: number
  /** Finger pressing down, 0…1. */
  press: number
  /** Ghost (hand and paper) visibility, 0…1. */
  alpha: number
  /** Page-space tap point (swipeTap). */
  tx: number
  tz: number
}

/** Seconds per loop, per choreography. */
export const DEMO_PERIOD: Readonly<Record<DemoKind, number>> = { swipe: 2.4, swipeTap: 3.4, tap: 1.8, pull: 2.4 }
/** Seconds the ghost takes to fade once the player acts. */
export const DEMO_FADE = 0.22
/** Loops shown with reduced motion before falling back to the plain hand. */
export const DEMO_REDUCED_LOOPS = 1

const createDemo = (): LessonDemo => ({
  phase: 'off', kind: 'swipe', on: 'none', target: -1, clock: 0, loops: 0, maxLoops: 0,
  fold: 0, hand: 0, glide: 0, press: 0, alpha: 0, tx: 0, tz: 0
})

const sm = (e0: number, e1: number, x: number): number => {
  const t = x <= e0 ? 0 : x >= e1 ? 1 : (x - e0) / (e1 - e0)
  return t * t * (3 - 2 * t)
}

/** Fill the pose (fold, hand, glide, press, alpha) for the demo's current clock. */
export const sampleDemo = (d: LessonDemo): void => {
  const c = d.clock
  const P = DEMO_PERIOD[d.kind]
  switch (d.kind) {
    case 'swipe':
      d.alpha = Math.min(sm(0, 0.25, c), 1 - sm(P - 0.5, P, c))
      d.hand = sm(0.3, 1.3, c)
      d.fold = d.hand
      d.glide = 0
      d.press = 0
      break
    case 'swipeTap':
      d.alpha = Math.min(sm(0, 0.25, c), 1 - sm(P - 0.4, P, c))
      d.hand = sm(0.3, 1.3, c)
      d.glide = sm(1.4, 1.9, c)
      d.press = Math.min(sm(2.0, 2.15, c), 1 - sm(2.45, 2.65, c))
      // Up with the hand, then slammed shut by the press.
      d.fold = c < 2.1 ? d.hand : 1 - sm(2.1, 2.28, c)
      break
    case 'tap':
      d.alpha = Math.min(sm(0, 0.2, c), 1 - sm(P - 0.4, P, c))
      d.hand = 1
      d.glide = 0
      d.press = Math.min(sm(0.35, 0.5, c), 1 - sm(0.7, 0.85, c))
      d.fold = 1 - sm(0.45, 0.62, c)
      break
    case 'pull':
      d.alpha = Math.min(sm(0, 0.25, c), 1 - sm(P - 0.6, P - 0.1, c))
      d.hand = sm(0.3, 1.3, c)
      d.glide = 0
      d.press = 0
      // Held at full draw, then let go: it springs home.
      d.fold = c < 1.55 ? d.hand : 1 - sm(1.55, 1.7, c)
      break
  }
}

/** Begin a demonstration (the lesson's first encounter). */
export const startDemo = (
  l: LessonState, kind: DemoKind, on: DemoOn, target: number, reducedMotion: boolean, tx = 0, tz = 0
): void => {
  const d = l.demo
  d.phase = 'show'
  d.kind = kind
  d.on = on
  d.target = target
  d.clock = 0
  d.loops = 0
  d.maxLoops = reducedMotion ? DEMO_REDUCED_LOOPS : 0
  d.tx = tx
  d.tz = tz
  sampleDemo(d)
  l.rev++
}

/**
 * Advance the demo by real seconds. Returns true on the frame it ends by
 * itself (its loops ran out), so the caller can remember it was shown.
 */
export const stepDemo = (l: LessonState, realDt: number): boolean => {
  const d = l.demo
  if (d.phase === 'off') return false
  if (d.phase === 'fade') {
    d.alpha -= realDt / DEMO_FADE
    if (d.alpha <= 0) stopDemo(l)
    return false
  }
  d.clock += realDt
  const P = DEMO_PERIOD[d.kind]
  if (d.clock >= P) {
    d.clock -= P
    if (d.clock >= P) d.clock = 0
    d.loops++
    if (d.maxLoops > 0 && d.loops >= d.maxLoops) {
      stopDemo(l)
      return true
    }
  }
  sampleDemo(d)
  return false
}

/** The player acted: fade the ghost out now. Returns true if a demo was showing. */
export const cancelDemo = (l: LessonState): boolean => {
  const d = l.demo
  if (d.phase !== 'show') return false
  d.phase = 'fade'
  l.rev++
  return true
}

export const stopDemo = (l: LessonState): void => {
  const d = l.demo
  if (d.phase === 'off') return
  d.phase = 'off'
  d.alpha = 0
  d.fold = 0
  d.press = 0
  d.target = -1
  d.on = 'none'
  l.rev++
}

/** Is a ghost visible on this lesson right now? */
export const demoShowing = (l: LessonState): boolean => l.demo.phase !== 'off'

export const LESSON_IDS: readonly LessonId[] = [
  'swipe', 'stamp', 'shield', 'launch', 'ridge', 'spread', 'peel', 'crease', 'core', 'frog',
  'crush', 'sling', 'leaper', 'ballista', 'shelf'
]

export const lessonCode = (id: LessonId): number => LESSON_IDS.indexOf(id)

export const createLessonState = (): LessonState => ({
  id: null,
  step: 0,
  target: -1,
  age: 0,
  showHand: false,
  hand: { gesture: 'swipe', ax: 0, az: 0, bx: 0, bz: 0, y: 0, anchor: 'page' },
  timeScale: 1,
  hint: false,
  demo: createDemo(),
  rev: 0
})

export const setHand = (
  l: LessonState, gesture: HandGesture, ax: number, az: number, bx: number, bz: number, y = 0, anchor: HandAnchor = 'page'
): void => {
  const h = l.hand
  if (
    l.showHand && h.gesture === gesture && h.ax === ax && h.az === az && h.bx === bx && h.bz === bz && h.y === y &&
    h.anchor === anchor
  ) return
  l.hand.gesture = gesture
  l.hand.ax = ax
  l.hand.az = az
  l.hand.bx = bx
  l.hand.bz = bz
  l.hand.y = y
  l.hand.anchor = anchor
  l.showHand = true
  l.rev++
}

export const clearLesson = (l: LessonState): void => {
  l.id = null
  l.step = 0
  l.target = -1
  l.age = 0
  l.showHand = false
  l.timeScale = 1
  l.hint = false
  stopDemo(l)
  l.rev++
}
