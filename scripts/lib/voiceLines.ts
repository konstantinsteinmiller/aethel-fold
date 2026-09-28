import '@/voice/catalog'
import { allVoiceLines, type VoiceLine as RegisteredLine } from '@/voice/lines'
import { isNonSpeechVoice, speakerDisplayName, voiceModel } from '@/voice/voices'

/**
 * ─── The one enumeration both voice-over tools read ─────────────────────────
 *
 * `gen-voice-over-todo.ts` (the recording checklist) and `gen-voice-over.ts`
 * (the TTS pass) have to agree, exactly, on which lines exist, what they are
 * called and where their files go — otherwise the checklist ticks off a file the
 * generator will never write. So neither enumerates anything; both call this.
 *
 * It is a thin map over the registry in `src/voice/lines.ts`. Importing
 * `@/voice/catalog` first is what pulls in every game module that registers
 * lines. What this adds is the casting (`voices.ts`) and the display name, so
 * the tools need to know about neither.
 */

export interface VoiceLine extends RegisteredLine {
  /** The German Piper model, or `''` when this speaker is non-speech. */
  piperDe: string
  /** The English Piper model, or `''` when this speaker is non-speech. */
  piperEn: string
  /** A roar or a grunt — never synthesized, never listed as recordable. */
  nonSpeech: boolean
  /** The speaker's display name, in German, for a German checklist. */
  nameDe: string
  /** The speaker's display name, in English. */
  nameEn: string
}

/** Every registered spoken line, in registration order, cast and named. */
export const collectVoiceLines = (): VoiceLine[] =>
  allVoiceLines().map(line => ({
    ...line,
    piperDe: voiceModel(line.speaker, 'de'),
    piperEn: voiceModel(line.speaker, 'en'),
    nonSpeech: isNonSpeechVoice(line.speaker),
    nameDe: speakerDisplayName(line.speaker, 'de'),
    nameEn: speakerDisplayName(line.speaker, 'en')
  }))

/**
 * The authored text of a line in one locale.
 *
 * German for anything starting `de`, English otherwise — the same prefix test
 * `voiceModel()` uses. Both languages are authored in the registry, so there is
 * nothing to translate.
 */
export const textFor = (line: VoiceLine, locale: string): string =>
  locale.toLowerCase().startsWith('de') ? line.de : line.en

/** The Piper model for a line in one locale, or `''`. */
export const modelFor = (line: VoiceLine, locale: string): string =>
  locale.toLowerCase().startsWith('de') ? line.piperDe : line.piperEn

/** The display name for a speaker in one locale. */
export const nameFor = (line: VoiceLine, locale: string): string =>
  locale.toLowerCase().startsWith('de') ? line.nameDe : line.nameEn

/** True when the authored line carries a `(stage direction)`. */
export const hasDirection = (text: string): boolean => /\([^)]*\)/.test(text)

/**
 * What the TTS should actually **speak**, as opposed to what the bubble shows.
 *
 * The caption keeps everything the author wrote; only Piper's input is cleaned.
 * Three rules, and the second one is a deliberate departure from the pipeline
 * this was ported from:
 *
 *   1. `(a stage direction)` is dropped — otherwise the placeholder voice says
 *      the word "contemptuous" out loud. A line that was *entirely* a direction cleans to `''`, and the
 *      caller skips synthesis rather than rendering silence.
 *
 *   2. `*emphasis*` is **unwrapped, not dropped** — the markers go, the word
 *      stays. In the project this came from `*…*` marks a sound cue (`*a hungry
 *      snarl*`) and is correctly deleted; here it marks italics on a word the
 *      author wants stressed — `„Ach. *Die* Geschichte meinst du."` — and
 *      deleting it would change the sentence.
 *
 *   3. Quotation marks are dropped. German lines are often wrapped in
 *      typographic quotes (`„ … "`), which are typography rather than
 *      speech; espeak-ng's handling of `„` is not something to find out about
 *      from a rendered file. Apostrophes are untouched — `doesn't` is a word.
 *
 * Kept in this shared module rather than in the generator so the runtime, the
 * generator and the test all read one definition of "what gets spoken".
 */
export const speechText = (text: string): string =>
  (text || '')
    .replace(/\([^)]*\)/g, ' ') // (contemptuous) — meta, never voiced
    .replace(/\*([^*]*)\*/g, '$1') // *Die* — the markers are meta, the word is not
    .replace(/[„“”"«»]/g, ' ') // typographic quotation marks
    .replace(/[*()]/g, ' ') // stray unmatched markers
    .replace(/\s+([,.!?;:…])/g, '$1') // tidy the space a stripped quote left behind
    .replace(/\s{2,}/g, ' ')
    .trim()

/** Where the generator writes a line's file, and the first place the runtime
 *  looks for it. Repo-relative, forward slashes — it is used both as a path and
 *  as text in the checklist. */
export const oggPathNested = (locale: string, folder: string, lineId: string): string =>
  `public/speech/${locale}/${folder}/${lineId}.ogg`

/** The flat drop location. LINE_IDs are globally unique, so a file here is
 *  unambiguous, and it is the obvious place for somebody handed twelve files.
 *  The runtime accepts it and both tools count it as recorded. */
export const oggPathFlat = (locale: string, lineId: string): string => `public/speech/${locale}/${lineId}.ogg`
