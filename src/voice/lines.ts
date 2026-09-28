/**
 * ─── The voice-line registry ────────────────────────────────────────────────
 *
 * A voice-over file is found by name and nothing else: record a line, save it
 * as `<LINE_ID>.ogg`, drop it in the speaker's folder, and it plays the next
 * time that line fires (`speech.ts`). There is no manifest and no code change —
 * which is only safe if the LINE_ID is *stable*, and that is this file's job.
 *
 * A game registers its spoken lines here, grouped (a scene, a conversation, a
 * set of barks), with the German and the English text side by side:
 *
 *   registerVoiceLines('intro', [
 *     { speaker: 'narrator', de: 'Es war einmal …', en: 'Once upon a time …' }
 *   ])
 *
 * The runtime then plays a line by object identity or by id (`speech.ts`), and
 * the tooling under `scripts/` enumerates every registered line to build the
 * recording checklist and to render TTS placeholders. For the tooling to see a
 * game's lines, the module that registers them has to be imported from
 * `catalog.ts`.
 *
 * ── Why not the array index ────────────────────────────────────────────────
 *
 * The normal edit to a script is **inserting a line in the middle of a scene**.
 * With positional ids that insertion silently renumbers every line after it and
 * every recording from that point on is attached to the wrong sentence. So:
 *
 *   `<group>-<6 hex of FNV-1a over the German text>`   e.g. `intro-7f3a91`
 *
 *   1. **Inserting a line moves no existing id.**
 *   2. **Editing a line's text invalidates exactly that line's recording** —
 *      correct, because the recording is of a sentence the game no longer has.
 *   3. **It is reproducible from the text alone.** The hash is written inline
 *      rather than imported, because a dependency's hash can change under a
 *      version bump and orphan every recording on disk.
 *
 * The German text is hashed because it is the source; re-translating a line
 * does not invalidate the German recording. Two verbatim-identical German lines
 * inside one group collide; the second and later get `-2`, `-3`, … and are
 * listed in {@link DISAMBIGUATED_LINE_IDS} so a test can notice.
 */

/** How many hex digits of the hash go into an id (24 bits). */
const HASH_HEX = 6

/**
 * FNV-1a, 32 bits, over the UTF-16 code units of `text`, as lowercase hex.
 *
 * `Math.imul` is the multiply — plain `*` loses the low bits to float64 above
 * 2^53 and would make the result platform-flavoured.
 */
export const textHash = (text: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0').slice(-HASH_HEX)
}

/** What a game hands to {@link registerVoiceLines}: one spoken line. */
export interface VoiceLineInput {
  /** Speaker id — a key of `VOICES` (`voices.ts`) and the speech sub-folder. */
  speaker: string
  /** German text. Hashed into the id. */
  de: string
  /** English text. */
  en: string
}

/** One registered line, with everything the runtime and tooling need. */
export interface VoiceLine {
  /** The LINE_ID — the `.ogg` base name. Unique across the registry. */
  id: string
  /** The group it was registered under. Also the id's prefix. */
  group: string
  /** Position inside the group. For ordering the checklist — never for the id. */
  index: number
  speaker: string
  /** Speech sub-folder under `public/speech/<locale>/`: the speaker's id, so a
   *  voice actor's whole part lives in one directory. */
  folder: string
  de: string
  en: string
  /** The object that was registered. Identity, not a copy — this is what
   *  {@link voiceLineOf} looks up. */
  source: VoiceLineInput
}

/** Ids that needed a `-2` / `-3` suffix to stay unique. Empty is healthy. */
export const DISAMBIGUATED_LINE_IDS: string[] = []

const registry: VoiceLine[] = []
const bySource = new Map<VoiceLineInput, VoiceLine>()
const byId = new Map<string, VoiceLine>()

/**
 * Registers a group of lines and returns their resolved entries, in order.
 *
 * Group names must be id-safe (letters, digits, `-`, `_`). Registering the same
 * input object twice returns the existing entry rather than a duplicate, so a
 * module that is imported by both the game and a tool is harmless.
 */
export const registerVoiceLines = (group: string, lines: readonly VoiceLineInput[]): VoiceLine[] => {
  if (!/^[A-Za-z0-9_-]+$/.test(group)) {
    throw new Error(`voice group "${group}" must be letters, digits, '-' or '_'`)
  }
  return lines.map((line, index) => {
    const existing = bySource.get(line)
    if (existing) {
      return existing
    }
    const base = `${group}-${textHash(line.de)}`
    let id = base
    for (let n = 2; byId.has(id); n++) {
      id = `${base}-${n}`
    }
    if (id !== base) {
      DISAMBIGUATED_LINE_IDS.push(id)
    }
    const entry: VoiceLine = {
      id,
      group,
      index,
      speaker: line.speaker,
      folder: line.speaker,
      de: line.de,
      en: line.en,
      source: line
    }
    registry.push(entry)
    byId.set(id, entry)
    bySource.set(line, entry)
    return entry
  })
}

/** Every registered line, in registration order. */
export const allVoiceLines = (): readonly VoiceLine[] => registry

/** The entry for a registered input object, by identity, or `null`. */
export const voiceLineOf = (line: VoiceLineInput): VoiceLine | null => bySource.get(line) ?? null

/** {@link voiceLineOf}, id only. */
export const lineIdOf = (line: VoiceLineInput): string | null => bySource.get(line)?.id ?? null

/** The entry for a LINE_ID, or `null`. */
export const voiceLineById = (id: string): VoiceLine | null => byId.get(id) ?? null

/** The authored text of a line in one locale: German for `de*`, English otherwise. */
export const voiceText = (line: VoiceLineInput, locale: string): string =>
  locale.toLowerCase().startsWith('de') ? line.de : line.en

/** Empties the registry. For tests only. */
export const clearVoiceLines = (): void => {
  registry.length = 0
  bySource.clear()
  byId.clear()
  DISAMBIGUATED_LINE_IDS.length = 0
}
