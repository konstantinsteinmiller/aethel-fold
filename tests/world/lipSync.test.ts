import { describe, expect, it } from 'vitest'
import { openAt, planUtterance, SILENCE } from '@/world/story/lipSync'

/**
 * ─── Timing a mouth off a string ────────────────────────────────────────────
 *
 * There is no audio in this game, so the *text* is the only signal the lip sync
 * has. Everything asserted here is a property of that translation, and the ones
 * worth writing down are the ones with a visible failure on the other side:
 * a mouth still moving after the text box has emptied, a mouth that never
 * closes between words, or a German umlaut timed as if it were punctuation.
 */

const say = (text: string) => planUtterance(text)

describe('planning a line', () => {
  it('finds the words and nothing else', () => {
    expect(say('Halt dich hinter mir.').words).toBe(4)
    expect(say('  ').words).toBe(0)
    expect(say('… — ,').words).toBe(0)
    expect(say('').words).toBe(0)
  })

  it('gives a longer word longer to be said', () => {
    // The brief, restated as a test: the letter count decides the duration.
    const short = say('Ja')
    const long = say('Waffenmeister')
    expect(long.duration).toBeGreaterThan(short.duration * 3)
  })

  /**
   * German is the default language (`i18n/index.ts`), so an umlaut has to count
   * as a letter. If it did not, `Grün` would time as three letters and every
   * second word in the game would be cut short — a failure that is invisible in
   * English and constant in German.
   */
  it('counts umlauts and ß as letters', () => {
    expect(say('Grün').duration).toBeCloseTo(say('Grun').duration, 6)
    expect(say('Straße').words).toBe(1)
    expect(say('Straße').duration).toBeGreaterThan(say('Stra').duration)
  })

  it('is deterministic, so a replayed line is the same performance', () => {
    const a = say('Setz dich, Junge.')
    const b = say('Setz dich, Junge.')
    expect([...a.table]).toEqual([...b.table])
  })

  it('holds a beat after a full stop', () => {
    // Same two words, one with a sentence break in the middle. The pause is the
    // difference, and it is what makes a delivery read as sentences.
    expect(say('Geh. Jetzt').duration).toBeGreaterThan(say('Geh Jetzt').duration)
  })

  it('does not rush a one-letter word', () => {
    // `MIN_WORD`. Without a floor "a" gets 62 ms — under four frames, which is a
    // twitch rather than a word.
    expect(say('a').duration).toBeGreaterThan(0.13)
  })
})

describe('opening the mouth', () => {
  const line = say('Setz dich, Junge. Im Stehen hört sich keine Geschichte richtig an.')

  it('is shut before the line and after it', () => {
    expect(openAt(line, -1)).toBe(0)
    expect(openAt(line, 0)).toBeCloseTo(0, 5)
    expect(openAt(line, line.duration)).toBe(0)
    expect(openAt(line, line.duration + 10)).toBe(0)
    expect(openAt(SILENCE, 0.2)).toBe(0)
  })

  /**
   * The one that matters most. A mouth that never fully shuts reads as a single
   * held vowel for the length of the line, and no amount of correct timing
   * elsewhere rescues it — it is the difference between speech and a drone.
   */
  it('closes completely somewhere inside the line', () => {
    let lowest = 1
    for (let t = 0; t < line.duration; t += 1 / 120) {
      lowest = Math.min(lowest, openAt(line, t))
    }
    expect(lowest).toBeLessThan(0.001)
  })

  it('actually opens', () => {
    let highest = 0
    for (let t = 0; t < line.duration; t += 1 / 120) {
      highest = Math.max(highest, openAt(line, t))
    }
    expect(highest).toBeGreaterThan(0.5)
  })

  it('never leaves the 0..1 range the vertex write expects', () => {
    for (let t = -0.5; t < line.duration + 0.5; t += 1 / 240) {
      const open = openAt(line, t)
      expect(Number.isFinite(open)).toBe(true)
      expect(open).toBeGreaterThanOrEqual(0)
      expect(open).toBeLessThanOrEqual(1)
    }
  })

  /**
   * A long compound gets more than one movement inside its own duration — the
   * German half of the design note on `LETTERS_PER_PULSE`. One open held for
   * 1.1 s is a yawn, not a word.
   */
  it('pulses more than once through a long word', () => {
    const long = say('Waffenmeister')
    let crossings = 0
    let wasOpen = false
    for (let t = 0; t < long.duration; t += 1 / 240) {
      const open = openAt(long, t) > 0.25
      if (open && !wasOpen) {
        crossings++
      }
      wasOpen = open
    }
    expect(crossings).toBeGreaterThanOrEqual(3)
  })

  /**
   * Dialogue is scrubbable — the player clicks past a line, a beat restarts, the
   * director rewinds — so `openAt` must hold no cursor. Sampled at identical
   * times in both directions, because `t += 0.05` and `i * 0.05` accumulate
   * float error differently and comparing the two tests the adder, not the
   * function.
   */
  it('is a pure function of time, so clicking back through a line resyncs', () => {
    const times: number[] = []
    for (let i = 0; i * 0.05 < line.duration; i++) {
      times.push(i * 0.05)
    }
    const forwards = times.map(t => openAt(line, t))
    const backwards: number[] = []
    for (let i = times.length - 1; i >= 0; i--) {
      backwards.unshift(openAt(line, times[i]!))
    }
    expect(backwards).toEqual(forwards)
  })
})
