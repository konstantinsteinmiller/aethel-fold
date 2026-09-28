import type { Speaker } from './script'

/**
 * ─── Who sounds like whom ───────────────────────────────────────────────────
 *
 * Every speaker in the chapter is cast: a Piper TTS model per language, used by
 * `pnpm voice-over:generate` to render a placeholder `.ogg` for every line the
 * chapter contains (`scripts/gen-voice-over.ts`, `voice-over-workflow.md`). The
 * runtime never reads this file — it only reads files off disk — so a recast is
 * "change a row, delete the stale `.ogg`s, re-run the generator", and a *human*
 * recording dropped into the same folder simply wins, forever, because the
 * generator never overwrites a file that already exists.
 *
 * ── German is cast first, and that is not the usual order ───────────────────
 *
 * The sibling project this system comes from is English-first with a machine
 * translation behind it, so its German casting is a courtesy. Here it is the
 * other way round: `Chroniken von Arlaan` is a German manuscript, `script.ts`
 * holds the author's own German with an English translation beside it, and the
 * German audio is the one a player is most likely to hear. So the German column
 * was assigned first, under the constraint below, and the English column was
 * fitted around it afterwards — where it has nine male and nine female voices to
 * spend and no constraint worth mentioning.
 *
 * ── The German constraint, and the rule that makes it survivable ────────────
 *
 * Free Piper German is **three speakers** with a known gender — thorsten (M),
 * karlsson (M), pavoque (M) — and **three** female — eva_k, kerstin, ramona. The
 * three quality tiers of thorsten (`low` / `medium` / `high`) are the same man at
 * three registers, which buys a little separation and no more. Twenty-two
 * speakers do not fit in that.
 *
 * So the rule is not "everyone is unique" — it cannot be — it is:
 *
 *   **no two speakers who appear in the same scene share a model.**
 *
 * That is the only sharing a player can detect. The chapter is three sealed
 * casts (the fireside room sixty years later, the hunt in Arlaan, the bandits),
 * and each is internally distinct in German; the reuse is always across a cut of
 * sixty years or thirty kilometres. Karlsson is Gearn on the road and the smith
 * in the room; pavoque is the storyteller and the man who robs four teenagers.
 * Neither pair is ever on screen together. If a new beat ever puts one of those
 * pairs in the same room, this table is what has to change, not the beat.
 *
 * ── No multi-speaker `#id` pools ────────────────────────────────────────────
 *
 * Piper's `de_DE-mls-medium` and `en_US-libritts_r-medium` carry hundreds of
 * voices selected by `#<speakerId>`, which looks like the answer to the sentence
 * above. It is not: the per-id gender is undocumented and unpredictable, and in
 * the project this system comes from it handed a male trader a woman's voice —
 * silently, because nothing in the pipeline knows what a voice sounds like. A
 * known-gender single-speaker model that is shared across a cut is a smaller lie
 * than an unknown-gender one that is unique. `# M` / `# F` marks each row.
 *
 * ── The two children ────────────────────────────────────────────────────────
 *
 * There is no child voice in the free Piper catalogue in either language, and
 * Arthus is nine. The lightest available female voice is used for both children
 * — which is what animation does anyway — and it is a **placeholder that is
 * meant to be replaced**: those two parts are at the top of the recording list
 * in `voice-over-todo.md` precisely because TTS cannot do them.
 *
 * ── The shape of a model id ─────────────────────────────────────────────────
 *
 * The HuggingFace `rhasspy/piper-voices` name, `<lang_REGION>-<name>-<quality>`,
 * optionally `#<speakerId>` for a multi-speaker model (unused here, see above).
 * `pnpm voice-over:setup` downloads each distinct base model once into
 * `tools/piper/`. Empty models (`{ de: '', en: '' }`) mark a **non-speech** voice
 * — a roar, a grunt, a line that is a stage direction — which the generator
 * skips; nobody in this chapter is one yet, and the mechanism is kept because
 * the trollboar will be.
 */

export interface VoiceModel {
  /** Piper model id for German. `''` = non-speech, never synthesized. */
  de: string
  /** Piper model id for English. `''` = non-speech, never synthesized. */
  en: string
}

/**
 * The cast, keyed by `Speaker` — which is `CastId` plus the six voices that
 * speak without a body of their own.
 *
 * Typed `Record<Speaker, …>` rather than `Partial<…>` on purpose: adding a
 * speaker to `script.ts` and forgetting to cast them would otherwise produce a
 * character whose lines are silently never generated, and the compiler is a
 * better place to find that out than the checklist is.
 */
export const VOICES: Record<Speaker, VoiceModel> = {
  // ══════════════════════════════════════════════════════════════════════════
  // The fireside room — one afternoon, sixty years after the chapter
  //
  // Five people in one room, so all five are distinct in German. This is the
  // act the player opens the game in, and the first voice they hear is the old
  // man's, so he gets the deepest German model and the one British voice in the
  // English column that sounds like somebody who tells stories for a living.
  // ══════════════════════════════════════════════════════════════════════════
  storyteller: { de: 'de_DE-pavoque-low', en: 'en_GB-alan-medium' }, // M
  arthusBoy: { de: 'de_DE-eva_k-x_low', en: 'en_US-amy-medium' }, // F (stands in for a boy of nine — see header)
  lenaGirl: { de: 'de_DE-kerstin-low', en: 'en_US-ljspeech-high' }, // F (stands in for a girl younger still)
  smithFather: { de: 'de_DE-karlsson-low', en: 'en_US-norman-medium' }, // M
  motherMara: { de: 'de_DE-ramona-low', en: 'en_GB-alba-medium' }, // F

  // The same four, as the bodiless voices they were before the frame became a
  // played act. They are aliases in `script.ts` and they are aliases here: a
  // line from `arthus` and a line from `arthusBoy` are the same boy, and giving
  // them different models would be a continuity bug nobody would think to look
  // for.
  arthus: { de: 'de_DE-eva_k-x_low', en: 'en_US-amy-medium' }, // F — = arthusBoy
  lena: { de: 'de_DE-kerstin-low', en: 'en_US-ljspeech-high' }, // F — = lenaGirl
  smith: { de: 'de_DE-karlsson-low', en: 'en_US-norman-medium' }, // M — = smithFather
  // `narrator` is the storyteller's voice laid over Arlaan across a cut. Same
  // man, therefore same model — the player is not supposed to learn that the
  // voice over the forest and the man in the chair are two entries in a table.
  narrator: { de: 'de_DE-pavoque-low', en: 'en_GB-alan-medium' }, // M — = storyteller

  // ══════════════════════════════════════════════════════════════════════════
  // Arlaan — the four who go hunting
  //
  // Athalus carries the chapter, so he takes thorsten at his most neutral
  // register; Jester is the mouth of the group and takes the same man pitched
  // up. Gearn is karlsson, which is also the smith in the room above — sixty
  // years and an ocean apart, and worth noting that Gearn *is* the storyteller,
  // so the one pairing that would be a mistake (gearn sharing with storyteller)
  // is the one deliberately avoided.
  // ══════════════════════════════════════════════════════════════════════════
  athalus: { de: 'de_DE-thorsten-medium', en: 'en_US-ryan-high' }, // M
  jester: { de: 'de_DE-thorsten-high', en: 'en_US-joe-medium' }, // M
  gearn: { de: 'de_DE-karlsson-low', en: 'en_US-kusal-medium' }, // M
  kareen: { de: 'de_DE-kerstin-low', en: 'en_GB-cori-high' }, // F

  // ══════════════════════════════════════════════════════════════════════════
  // Arlaan — Nimmerschein
  //
  // Only Theodor and Nidane speak in the chapter as written; the rest are cast
  // anyway, because the compiler requires it and because the cost of casting a
  // silent character now is one line and the cost of forgetting is a character
  // who is silently skipped by the generator later.
  // ══════════════════════════════════════════════════════════════════════════
  theodor: { de: 'de_DE-thorsten-low', en: 'en_GB-northern_english_male-medium' }, // M
  nidane: { de: 'de_DE-ramona-low', en: 'en_US-hfc_female-medium' }, // F
  // Nidane calling from off-screen. Same woman, same model — see `narrator`.
  nidaneVoice: { de: 'de_DE-ramona-low', en: 'en_US-hfc_female-medium' }, // F — = nidane
  roland: { de: 'de_DE-pavoque-low', en: 'en_US-lessac-medium' }, // M
  lothar: { de: 'de_DE-thorsten-low', en: 'en_US-danny-low' }, // M
  gart: { de: 'de_DE-karlsson-low', en: 'en_US-norman-medium' }, // M
  lara: { de: 'de_DE-eva_k-x_low', en: 'en_US-kristin-medium' }, // F
  galiana: { de: 'de_DE-kerstin-low', en: 'en_GB-jenny_dioco-medium' }, // F
  jonas: { de: 'de_DE-thorsten-high', en: 'en_US-hfc_male-medium' }, // M

  // ══════════════════════════════════════════════════════════════════════════
  // The road and the camp — the bandits
  //
  // A sealed cast: four voices that appear together and nowhere else, so all
  // four are distinct in German even though every model here is borrowed from
  // somebody in the two acts above.
  // ══════════════════════════════════════════════════════════════════════════
  banditLeader: { de: 'de_DE-thorsten-low', en: 'en_US-danny-low' }, // M
  // Brutos is the same man as `banditLeader` — the id differs by what the
  // player has been told his name is (see `SPEAKER_BODY` in `script.ts`), so
  // the model must not. He speaks in both chapters and this is the row that
  // keeps him one person across them.
  brutos: { de: 'de_DE-thorsten-low', en: 'en_US-danny-low' }, // M — = banditLeader
  bandit: { de: 'de_DE-thorsten-medium', en: 'en_GB-northern_english_male-medium' }, // M
  dorgo: { de: 'de_DE-karlsson-low', en: 'en_US-hfc_male-medium' }, // M
  jergo: { de: 'de_DE-thorsten-high', en: 'en_US-joe-medium' } // M
}

/**
 * Speaker ids that are **one person**.
 *
 * The chapter names six people twice, for reasons that are all narrative rather
 * than technical: the storyteller is `storyteller` when he speaks in the room
 * and `narrator` when his voice is laid over Arlaan across a cut; the bandit
 * chief is `banditLeader` while four robbed teenagers do not know his name and
 * `brutos` once his own men use it; and Arthus, Lena, the smith and Nidane kept
 * the bodiless ids they had before the frame became a played act.
 *
 * Written down here, rather than left implicit in two rows of {@link VOICES}
 * that happen to match, because two things need it and neither can infer it:
 * the recording checklist has to tell a performer that two of its sections are
 * one part (nobody should book two sessions for the storyteller), and a test has
 * to be able to fail when a recast splits a person in half by changing only one
 * of their rows. Matching models are *not* sufficient evidence of an alias —
 * German is a six-voice catalogue and unrelated characters share rows on purpose.
 */
export const VOICE_ALIASES: readonly (readonly Speaker[])[] = [
  ['storyteller', 'narrator'],
  ['arthusBoy', 'arthus'],
  ['lenaGirl', 'lena'],
  ['smithFather', 'smith'],
  ['nidane', 'nidaneVoice'],
  ['banditLeader', 'brutos']
]

/** True for a voice that must never be synthesized — a roar, a grunt, a line
 *  that is really a stage direction. The generator skips these entirely. */
export const isNonSpeechVoice = (who: Speaker): boolean => {
  const voice = VOICES[who]
  return !voice || (!voice.de && !voice.en)
}

/**
 * The Piper model for a speaker in a locale, or `''` when non-speech.
 *
 * German for anything starting `de` — `de-AT` and `de-CH` included, the same
 * prefix test `storyLine()` uses — and English for everything else, which is the
 * same fallback the chapter's *text* performs.
 */
export const voiceModel = (who: Speaker, locale: string): string => {
  const voice = VOICES[who]
  if (!voice) {
    return ''
  }
  return locale.toLowerCase().startsWith('de') ? voice.de : voice.en
}

/**
 * Every distinct base model the cast references, deduped and sorted.
 *
 * What `pnpm voice-over:setup` downloads. Speaker suffixes are stripped so a
 * multi-speaker pool would be fetched once rather than once per voice — there
 * are none today (see the header) and the strip costs nothing.
 */
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
