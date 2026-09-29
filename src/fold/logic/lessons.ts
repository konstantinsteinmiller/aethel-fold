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

export interface HandCue {
  gesture: HandGesture
  /** Page-space start and end of the motion (tap: a = b). */
  ax: number
  az: number
  bx: number
  bz: number
  /** Optional height of the target above the page (structures, the dragon). */
  y: number
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
  rev: number
}

export const LESSON_IDS: readonly LessonId[] = [
  'swipe', 'stamp', 'shield', 'launch', 'ridge', 'spread', 'peel', 'crease', 'core', 'frog',
  'crush', 'sling', 'leaper', 'ballista'
]

export const lessonCode = (id: LessonId): number => LESSON_IDS.indexOf(id)

export const createLessonState = (): LessonState => ({
  id: null,
  step: 0,
  target: -1,
  age: 0,
  showHand: false,
  hand: { gesture: 'swipe', ax: 0, az: 0, bx: 0, bz: 0, y: 0 },
  timeScale: 1,
  hint: false,
  rev: 0
})

export const setHand = (
  l: LessonState, gesture: HandGesture, ax: number, az: number, bx: number, bz: number, y = 0
): void => {
  const h = l.hand
  if (l.showHand && h.gesture === gesture && h.ax === ax && h.az === az && h.bx === bx && h.bz === bz && h.y === y) return
  l.hand.gesture = gesture
  l.hand.ax = ax
  l.hand.az = az
  l.hand.bx = bx
  l.hand.bz = bz
  l.hand.y = y
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
  l.rev++
}
