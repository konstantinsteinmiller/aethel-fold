/**
 * ─── Who sounds like whom ───────────────────────────────────────────────────
 *
 * Every speaker is cast: a Piper TTS model per language, used by
 * `pnpm voice-over:generate` to render a placeholder `.ogg` for every
 * registered line (`scripts/gen-voice-over.ts`, `voice-over-workflow.md`). The
 * runtime never reads this file — it only reads files off disk — so a recast is
 * "change a row, delete the stale `.ogg`s, re-run the generator", and a *human*
 * recording dropped into the same folder simply wins, forever, because the
 * generator never overwrites a file that already exists.
 *
 * A game casts its speakers with {@link castVoices}. A speaker nobody cast
 * falls back to `narrator`, so an uncast line still gets a placeholder rather
 * than being silently skipped.
 *
 * ── Casting rule ────────────────────────────────────────────────────────────
 *
 * Free Piper German is three male (thorsten, karlsson, pavoque) and three female
 * (eva_k, kerstin, ramona) single-speaker models, so voices will be shared. The
 * rule that keeps it survivable: **no two speakers who appear in the same scene
 * share a model** — that is the only sharing a player can hear.
 *
 * Avoid the multi-speaker `#id` pools (`de_DE-mls-medium`,
 * `en_US-libritts_r-medium`): the per-id gender is undocumented, and a
 * known-gender model shared across scenes is a smaller lie than an unknown one.
 *
 * ── The shape of a model id ─────────────────────────────────────────────────
 *
 * The HuggingFace `rhasspy/piper-voices` name, `<lang_REGION>-<name>-<quality>`,
 * optionally `#<speakerId>`. `pnpm voice-over:setup` downloads each distinct
 * base model once into `tools/piper/`. Empty models (`{ de: '', en: '' }`) mark
 * a **non-speech** voice — a roar, a grunt — which the generator skips.
 */

export interface VoiceModel {
  /** Piper model id for German. `''` = non-speech, never synthesized. */
  de: string
  /** Piper model id for English. `''` = non-speech, never synthesized. */
  en: string
  /** Display name for the recording checklist. Defaults to the speaker id. */
  name?: { de: string; en: string }
}

/** The speaker every uncast id falls back to. */
export const DEFAULT_SPEAKER = 'narrator'

/** The cast, keyed by speaker id. Extend it with {@link castVoices}. */
export const VOICES: Record<string, VoiceModel> = {
  narrator: { de: 'de_DE-thorsten-medium', en: 'en_GB-alan-medium', name: { de: 'Erzähler', en: 'Narrator' } }
}

/**
 * Speaker ids that are **one person** (e.g. a character heard on screen and as
 * a voice-over across a cut). The checklist groups them so one performer records
 * both, and a test asserts each group shares one model.
 */
export const VOICE_ALIASES: string[][] = []

/** Adds or replaces cast rows. */
export const castVoices = (cast: Readonly<Record<string, VoiceModel>>): void => {
  Object.assign(VOICES, cast)
}

/** Declares that the given speaker ids are one person. */
export const aliasVoices = (...speakers: string[]): void => {
  VOICE_ALIASES.push(speakers)
}

const castOf = (who: string): VoiceModel | undefined => VOICES[who] ?? VOICES[DEFAULT_SPEAKER]

/** True for a voice that must never be synthesized. */
export const isNonSpeechVoice = (who: string): boolean => {
  const voice = castOf(who)
  return !voice || (!voice.de && !voice.en)
}

/**
 * The Piper model for a speaker in a locale, or `''` when non-speech. German
 * for anything starting `de`, English for everything else.
 */
export const voiceModel = (who: string, locale: string): string => {
  const voice = castOf(who)
  if (!voice) {
    return ''
  }
  return locale.toLowerCase().startsWith('de') ? voice.de : voice.en
}

/** A speaker's display name in a locale, or the id itself. */
export const speakerDisplayName = (who: string, locale: string): string => {
  const name = VOICES[who]?.name
  if (!name) {
    return who
  }
  return locale.toLowerCase().startsWith('de') ? name.de : name.en
}

/** Every distinct base model the cast references, deduped and sorted. */
export const allPiperModels = (): string[] => {
  const models = new Set<string>()
  for (const voice of Object.values(VOICES)) {
    if (voice.de) {
      models.add(voice.de.split('#')[0] as string)
    }
    if (voice.en) {
      models.add(voice.en.split('#')[0] as string)
    }
  }
  return [...models].sort()
}
