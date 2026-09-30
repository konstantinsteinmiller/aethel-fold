/**
 * The boss outros (C9b): one cutscene script per book, played by the
 * `CutsceneRunner` right after the finale fold, when the win is already saved.
 *
 * Placement: the finale fold (frog / crane, `FINALE_TIME`) → `victory` (the
 * host records and flushes the win) → this outro (≈7 s, a tap skips it after
 * `OUTRO.skipAfter`) → the victory card drops in → `SHELF.afterVictory` later
 * the camera turns to the shelf. So the outro never fights the finale's fold
 * (it has finished) nor the card (it waits for the outro's end). Dragon Rush
 * never gets here: a rush ends in `rushOver` and its own result card.
 *
 * Timing rules the tests hold for every script: beats in order, one `end`
 * last, the crowd within `OUTRO.crowdCap`, the camera home before the end,
 * and no firework dropped by the pool's cap in either mode (normal and lite).
 *
 * Book 3's script brings its own cast (`CutActor` 'dolphins' and 'boats',
 * with rows in the view's actor table): dolphins leaping and spinning out of
 * the finale page's sea, and people waving from paper boats along its shore.
 *
 * Pure data: no three.js, no Vue.
 */

import { SHOT_HOME, type CutScript } from './cutscene'
import type { BookId } from './types'

/** Fireworks burst over the upper half of the page, clear of the HUD in every framing. */
const SKY = { x0: -3.2, x1: 3.2, z0: -3.4, z1: -0.6 }
/** Book 3: further down the page, so the bursts open over the beach and the fields, not over the leaping dolphins. */
const SEA_SKY = { x0: -3.2, x1: 3.2, z0: 0.2, z1: 2.6 }

/** Book 1, "The Siege": the villagers and the king's soldiers come out to cheer the frog. */
export const OUTRO_BOOK1: CutScript = {
  id: 'b1-outro',
  beats: [
    { at: 0, kind: 'camera', shot: { zoom: 1.1, yaw: 0.09, pitch: -0.06, fx: 0, fz: 0 }, dur: 1.8 },
    { at: 0.15, kind: 'crowd', actor: 'villagers', edge: 'left', count: 5, stagger: 0.09 },
    { at: 0.35, kind: 'crowd', actor: 'soldiers', edge: 'right', count: 5, stagger: 0.09 },
    { at: 0.6, kind: 'fireworks', count: 3, gap: 0.35, ...SKY, tint: 'festive' },
    { at: 0.9, kind: 'crowd', actor: 'farmers', edge: 'bottom', count: 4, stagger: 0.1 },
    { at: 1.25, kind: 'cheer' },
    { at: 1.7, kind: 'crowd', actor: 'kids', edge: 'top', count: 6, stagger: 0.08 },
    { at: 2.7, kind: 'fireworks', count: 3, gap: 0.4, ...SKY, tint: 'gold' },
    { at: 3.0, kind: 'camera', shot: { zoom: 1.06, yaw: -0.09, pitch: -0.04, fx: 0, fz: 0 }, dur: 2.4 },
    { at: 4.3, kind: 'cheer' },
    { at: 4.75, kind: 'fireworks', count: 3, gap: 0.35, ...SKY, tint: 'festive' },
    { at: 5.9, kind: 'camera', shot: SHOT_HOME, dur: 1.2 },
    { at: 7.2, kind: 'end' }
  ]
}

/** Book 2, "The Homefront": the keep's guards and the home folk cheer the crane. */
export const OUTRO_BOOK2: CutScript = {
  id: 'b2-outro',
  beats: [
    { at: 0, kind: 'camera', shot: { zoom: 1.1, yaw: -0.09, pitch: -0.06, fx: 0, fz: 0 }, dur: 1.8 },
    { at: 0.15, kind: 'crowd', actor: 'soldiers', edge: 'left', count: 5, stagger: 0.09 },
    { at: 0.35, kind: 'crowd', actor: 'villagers', edge: 'right', count: 5, stagger: 0.09 },
    { at: 0.6, kind: 'fireworks', count: 3, gap: 0.35, ...SKY, tint: 'cool' },
    { at: 0.9, kind: 'crowd', actor: 'soldiers', edge: 'bottom', count: 4, stagger: 0.1 },
    { at: 1.25, kind: 'cheer' },
    { at: 1.7, kind: 'crowd', actor: 'kids', edge: 'top', count: 6, stagger: 0.08 },
    { at: 2.7, kind: 'fireworks', count: 3, gap: 0.4, ...SKY, tint: 'warm' },
    { at: 3.0, kind: 'camera', shot: { zoom: 1.06, yaw: 0.09, pitch: -0.04, fx: 0, fz: 0 }, dur: 2.4 },
    { at: 4.3, kind: 'cheer' },
    { at: 4.75, kind: 'fireworks', count: 3, gap: 0.35, ...SKY, tint: 'gold' },
    { at: 5.9, kind: 'camera', shot: SHOT_HOME, dur: 1.2 },
    { at: 7.2, kind: 'end' }
  ]
}

/**
 * Book 3, "The Sea of Paper": the kraken sleeps again. Dolphins leap out of
 * the calm sea along the top of the page (spinning on the cheers), the
 * harbour folk wave from paper boats along the shore, and the sea keep's
 * people cheer the fish from both banks. The camera leans toward the sea.
 */
export const OUTRO_BOOK3: CutScript = {
  id: 'b3-outro',
  beats: [
    { at: 0, kind: 'camera', shot: { zoom: 1.08, yaw: 0.08, pitch: -0.05, fx: 0, fz: -0.7 }, dur: 1.8 },
    { at: 0.1, kind: 'crowd', actor: 'dolphins', edge: 'sea', count: 5, stagger: 0.2 },
    { at: 0.3, kind: 'crowd', actor: 'boats', edge: 'shore', count: 3, stagger: 0.16 },
    { at: 0.6, kind: 'fireworks', count: 3, gap: 0.35, ...SEA_SKY, tint: 'cool' },
    { at: 0.9, kind: 'crowd', actor: 'villagers', edge: 'left', count: 5, stagger: 0.09 },
    { at: 1.05, kind: 'crowd', actor: 'kids', edge: 'right', count: 5, stagger: 0.09 },
    { at: 1.25, kind: 'cheer' },
    { at: 1.7, kind: 'crowd', actor: 'soldiers', edge: 'bottom', count: 4, stagger: 0.1 },
    { at: 2.7, kind: 'fireworks', count: 3, gap: 0.4, ...SEA_SKY, tint: 'gold' },
    { at: 3.0, kind: 'camera', shot: { zoom: 1.05, yaw: -0.08, pitch: -0.04, fx: 0, fz: -0.5 }, dur: 2.4 },
    { at: 4.3, kind: 'cheer' },
    { at: 4.75, kind: 'fireworks', count: 3, gap: 0.35, ...SEA_SKY, tint: 'festive' },
    { at: 5.9, kind: 'camera', shot: SHOT_HOME, dur: 1.2 },
    { at: 7.2, kind: 'end' }
  ]
}

/** Each book's outro. A book without one (a new book, until its script lands) just shows the card. */
export const OUTROS: Partial<Record<BookId, CutScript>> = {
  1: OUTRO_BOOK1,
  2: OUTRO_BOOK2,
  3: OUTRO_BOOK3
}

export const outroFor = (book: BookId): CutScript | null => OUTROS[book] ?? null
