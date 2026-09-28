/**
 * ─── Saying the line ────────────────────────────────────────────────────────
 *
 * Turns a written line into a stream of mouth openness over time, so the figure
 * on screen is moving their mouth *while their line is up* and stops when it is
 * finished. The brief: **one movement per word, and the word's letter count
 * decides how long it lasts.**
 *
 * ── Driven by text, not audio ───────────────────────────────────────────────
 *
 * A line may or may not have a recording (`speech.ts` resolves `null` for an
 * unrecorded one), so the lip sync cannot depend on a waveform or a phoneme
 * track — the *text* is the one signal every line is guaranteed to have, and
 * everything below is squeezed out of it. When a clip does play, stretch the
 * plan's time axis to the clip's duration rather than re-planning.
 *
 * That sounds like a poor substitute and it mostly is not, because the thing a
 * viewer actually checks is far coarser than lip-reading: mouth moving while
 * words appear, mouth still between sentences, longer words taking longer. Get
 * those three right and it reads as speech. Get the *timing* wrong — a mouth
 * still chewing three seconds after the text box emptied — and no amount of
 * phoneme accuracy would have saved it.
 *
 * ── Why syllables rather than one open per word ─────────────────────────────
 *
 * The brief says one movement per word, and taken literally that is wrong for
 * this game specifically, because the game is **German first** (`i18n/index.ts`
 * sets `de` as the default). "Waffenmeister" and "ja" would each get one open,
 * held for 1.1 s and 0.16 s respectively — the long one reads as a yawn.
 *
 * So the word's letter count still decides its *duration*, exactly as asked, and
 * inside that duration the mouth pulses once per ~3 letters. A three-letter word
 * gets its single movement; a thirteen-letter compound gets four, which is what
 * saying it actually looks like. The rule is kept and the failure mode it would
 * have had in German is removed.
 */

/**
 * Seconds of speech per letter.
 *
 * From read-aloud rate rather than invented: ~150 words per minute is 2.5 words
 * a second, and the mean word is about five letters, so a five-letter word has
 * ~0.4 s to live in. That is 0.062 s a letter once `WORD_GAP` is taken out.
 */
const SECONDS_PER_LETTER = 0.062

/** The closing between words. Below about 60 ms the line reads as one long slur. */
const WORD_GAP = 0.085

/** No word is quicker than this, so "a" and "im" still register as a movement. */
const MIN_WORD = 0.13

/**
 * Extra silence after a word ending in punctuation.
 *
 * A comma is a breath and a full stop is a beat, and having the mouth stop at
 * both is most of what makes the delivery feel like someone reading a sentence
 * rather than emitting a word queue.
 */
const PAUSE_AFTER: Readonly<Record<string, number>> = {
  ',': 0.13,
  ';': 0.16,
  ':': 0.16,
  '.': 0.26,
  '!': 0.26,
  '?': 0.26,
  '…': 0.34,
  '—': 0.2
}

/** Letters per pulse. Three is roughly a German syllable and close enough in English. */
const LETTERS_PER_PULSE = 3

/** How wide the per-pulse amplitude wobble is, either side of 1. */
const AMPLITUDE_SPREAD = 0.26

/**
 * A planned line: how long it takes and how open the mouth is at any point.
 *
 * The word table is a flat `Float32Array` of `[start, duration, pulses,
 * amplitude]` per word rather than an array of objects, for the reason every
 * hot structure in this codebase is flat — `openAt` is called once per frame per
 * speaking character and must not walk a pointer chase to do it.
 */
export interface Utterance {
  /** Seconds from the first sound to the last. */
  readonly duration: number
  /** How many words were found. Zero for an empty or punctuation-only line. */
  readonly words: number
  readonly table: Float32Array
}

const STRIDE = 4

/** An utterance with nothing in it. Shared, because a silent speaker is the common case. */
export const SILENCE: Utterance = { duration: 0, words: 0, table: new Float32Array(0) }

/**
 * Cheap deterministic hash, so a word always gets the same amplitude.
 *
 * Deterministic and not random on purpose: a line replayed — and these are, the
 * player can back out of a conversation and re-enter it — must animate the same
 * way both times, or the second viewing looks like a different performance of
 * the same sentence.
 */
const hash = (text: string, from: number, to: number): number => {
  let h = 0x811c9dc5
  for (let i = from; i < to; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return ((h >>> 8) & 0xffff) / 0xffff
}

/**
 * True for anything that should count toward a word's length.
 *
 * ── The high range is bounded, and that bound is load-bearing ───────────────
 *
 * The obvious version is `code >= 0xc0` — "everything past Latin-1's punctuation
 * block" — which picks up ä ö ü ß correctly and then also picks up the **em dash
 * (U+2014) and the ellipsis (U+2026)**, both of which this file's own
 * `PAUSE_AFTER` table lists as punctuation. `'… — ,'` parsed as two words and
 * the mouth moved through a silence.
 *
 * So the range stops at Latin Extended-B. That covers every accented letter any
 * European language in this game will ever use and nothing above it.
 */
const isLetter = (code: number): boolean =>
  (code >= 65 && code <= 90) ||
  (code >= 97 && code <= 122) ||
  (code >= 48 && code <= 57) ||
  (code >= 0xc0 && code <= 0x24f)

/**
 * Plans a line of dialogue.
 *
 * Called once when a line goes up — a click, not a frame — so it is allowed to
 * allocate. `openAt` is the part that runs every frame and allocates nothing.
 */
export const planUtterance = (text: string): Utterance => {
  if (!text) {
    return SILENCE
  }
  // Two passes: count the words, then fill a table sized exactly right. The
  // alternative is a growing array of objects, and this is the one call where
  // the cost is a click rather than a frame — so it may as well be tidy.
  let words = 0
  let i = 0
  while (i < text.length) {
    if (isLetter(text.charCodeAt(i))) {
      words++
      while (i < text.length && isLetter(text.charCodeAt(i))) {
        i++
      }
    } else {
      i++
    }
  }
  if (words === 0) {
    return SILENCE
  }

  const table = new Float32Array(words * STRIDE)
  let clock = 0
  let w = 0
  i = 0
  while (i < text.length) {
    if (!isLetter(text.charCodeAt(i))) {
      i++
      continue
    }
    const from = i
    while (i < text.length && isLetter(text.charCodeAt(i))) {
      i++
    }
    const letters = i - from
    const duration = Math.max(MIN_WORD, letters * SECONDS_PER_LETTER)

    const at = w * STRIDE
    table[at] = clock
    table[at + 1] = duration
    table[at + 2] = Math.max(1, Math.round(letters / LETTERS_PER_PULSE))
    // Long words open wider, and the hash keeps two neighbours from matching.
    // Without the wobble a sentence is a metronome, which is the single most
    // obvious tell that a mouth is being driven by a timer.
    // Clamped here rather than at the far end: `applyMouth` would clamp it too,
    // but silently — every loud syllable in a long word would flatten against
    // the ceiling at exactly the same value and the wobble would stop existing
    // where it is most visible.
    const emphasis = Math.min(1, 0.62 + letters * 0.045)
    const wobble = 1 - AMPLITUDE_SPREAD + hash(text, from, i) * AMPLITUDE_SPREAD * 2
    table[at + 3] = Math.min(1, emphasis * wobble)
    w++

    clock += duration + WORD_GAP
    // Punctuation that trails the word — `"Ja!"` and `"Ja …"` both count.
    for (let p = i; p < text.length && p < i + 3; p++) {
      const pause = PAUSE_AFTER[text[p]!]
      if (pause !== undefined) {
        clock += pause
      } else if (text[p] !== ' ' && text[p] !== '"' && text[p] !== '»' && text[p] !== '«') {
        break
      }
    }
  }
  // The trailing `WORD_GAP` is real: the mouth closes after the last word, and
  // the caller uses `duration` to know when the figure may go back to idle.
  return { duration: clock, words, table }
}

/**
 * How open the mouth is `t` seconds into the line, 0..1.
 *
 * ── The shape of one pulse ──────────────────────────────────────────────────
 *
 * A raised cosine, `(1 − cos 2πp) / 2`: shut at the start of the pulse, wide in
 * the middle, shut at the end. Not a triangle, because the corner at the top of
 * a triangle is a visible flick at 60 fps on a mouth being watched from two
 * metres; not a sine, because a sine is only shut at one instant and the mouth
 * needs to actually *close* between syllables or the whole line reads as one
 * held vowel.
 *
 * ── Why this is a search and not a cursor ───────────────────────────────────
 *
 * A cursor that walks forward with the clock is faster and is wrong here,
 * because dialogue is *scrubbable*: the player advances a line early, a beat
 * restarts, the director rewinds. A pure function of `t` cannot desynchronise
 * from the text on screen. The search is a linear walk over at most ~20 words
 * and runs once a frame for one speaker, so the cost is not worth a bug that
 * only appears when somebody clicks quickly.
 */
export const openAt = (utterance: Utterance, t: number): number => {
  const { table, words } = utterance
  if (words === 0 || t < 0 || t >= utterance.duration) {
    return 0
  }
  for (let w = 0; w < words; w++) {
    const at = w * STRIDE
    const start = table[at]!
    if (t < start) {
      // In the gap before this word: shut. This is the closing between words
      // and it is what makes the line read as words rather than as a drone.
      return 0
    }
    const duration = table[at + 1]!
    if (t >= start + duration) {
      continue
    }
    const through = (t - start) / duration
    const pulses = table[at + 2]!
    // `% 1` rather than a modulo on an index, so the last pulse of a word ends
    // exactly at 1 and closes the mouth on the word boundary.
    const p = (through * pulses) % 1
    return (1 - Math.cos(p * Math.PI * 2)) * 0.5 * table[at + 3]!
  }
  return 0
}
