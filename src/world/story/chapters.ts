import type { Beat } from './chapter1'
import { CHAPTER_ONE } from './chapter1'
import { CHAPTER_TWO } from './chapter2'

/**
 * ─── The story, as one list ─────────────────────────────────────────────────
 *
 * Every chapter's beats, concatenated, in reading order.
 *
 * ── Why flat and not a list of chapters ─────────────────────────────────────
 *
 * Because the director already walks a flat list with a single integer index,
 * and that integer is load-bearing in four places that all get harder the moment
 * it becomes a pair: the save format (`StorySnapshot.beatId` resolves through
 * `beatIndex`), the objective tracker (which looks *backwards* through recent
 * beats and would have to walk off the front of a chapter into the end of the
 * one before), `finishBeat`'s `index++`, and the dev jump.
 *
 * Concatenating costs one lookup — `chapterOf` — and leaves all four of those
 * exactly as they were. A chapter boundary then becomes what it actually is in
 * a book: a place where the reader turns a page, not a different kind of thing.
 *
 * This is the same argument `chapter1.ts` makes for a list over a graph, applied
 * one level up. And the same escape hatch applies: the day a chapter can be
 * *skipped* or played out of order, this becomes a chooser and the chapters stay
 * exactly as they are written.
 *
 * ── Beat ids must be unique across the whole story ──────────────────────────
 *
 * `beatIndex` searches this list, so two chapters with a beat called `open`
 * would make every save in the later one load into the earlier. Chapter 2
 * prefixes its ids `b2-` for that reason, and `tests/world/storyChapter.test.ts`
 * asserts uniqueness so the third chapter cannot forget.
 */
export const STORY_BEATS: readonly Beat[] = [...CHAPTER_ONE, ...CHAPTER_TWO]

/**
 * Where each chapter starts in `STORY_BEATS`, indexed from 0 for chapter 1.
 *
 * Derived from the chapter arrays rather than written down, so it cannot drift
 * when a beat is added to Chapter 1.
 */
export const CHAPTER_STARTS: readonly number[] = [0, CHAPTER_ONE.length]

/** How many chapters are playable. */
export const CHAPTER_COUNT = CHAPTER_STARTS.length

/**
 * Which chapter a beat index belongs to, counting from **1**.
 *
 * One-based because it is a number the player sees: `StoryState.chapter` drives
 * the HUD, and "Chapter 0" is not a thing a reader has ever been shown.
 * Out-of-range indices clamp to the last chapter, which is what the director
 * wants when the story has run off the end and the state is `complete`.
 */
export const chapterOf = (index: number): number => {
  let chapter = 1
  for (let i = 1; i < CHAPTER_STARTS.length; i++) {
    if (index >= CHAPTER_STARTS[i]!) {
      chapter = i + 1
    }
  }
  return chapter
}

/** Index of a beat by id, or -1. Searches the whole story, not one chapter. */
export const beatIndex = (id: string): number => STORY_BEATS.findIndex(beat => beat.id === id)

/**
 * The time of day in force at a beat, or `undefined` if the story never says.
 *
 * ── Why a beat's own `time` is not the answer ───────────────────────────────
 *
 * Because most beats do not carry one. The chapter states a time where the light
 * *changes* and says nothing for the runs in between — `ambush` names 0.66 and
 * `ambush-over`, thirty seconds later in the same meadow, names nothing at all.
 * Reading `beat.time` directly would therefore light two consecutive beats of
 * one continuous scene from two different times of day, and the beat that looked
 * wrong would be the one with nothing written on it.
 *
 * So the inherited value is the last one named at or before `index`. That is the
 * state a player who walked there would be in, which is exactly what `begin`,
 * `__story.jumpTo`, a loaded save and a retry all need — see
 * `StoryDirector.applyBeatTime`, the only caller.
 *
 * Returns `undefined` only for a story whose opening beats name no time at all;
 * `tests/world/storyLighting.test.ts` pins that Chapter 1's first beat does.
 */
export const timeAtBeat = (index: number): number | undefined => {
  for (let i = Math.min(index, STORY_BEATS.length - 1); i >= 0; i--) {
    const time = STORY_BEATS[i]?.time
    if (time !== undefined) {
      return time
    }
  }
  return undefined
}
