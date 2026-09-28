import type { CastId } from './cast'
import { BANTER, type Line, SCRIPT, type ScriptId, type Speaker } from './script'

/**
 * ─── Stable names for the chapter's spoken lines ────────────────────────────
 *
 * A voice-over file is found by name and nothing else: record a line, save it as
 * `<LINE_ID>.ogg`, drop it in the speaker's folder, and it plays the next time
 * that line fires (`speech.ts`). There is no manifest, no registry and no code
 * change — which is only safe if the LINE_ID is *stable*, and that is the entire
 * job of this file.
 *
 * ── Why not the array index ────────────────────────────────────────────────
 *
 * The obvious id for `SCRIPT.frameAsk[2]` is `frameAsk-2`, and it is a trap. The
 * script is prose under active revision; the normal edit is **inserting a line
 * in the middle of a beat**. With positional ids that insertion silently
 * renumbers every line after it, so every recording from that point on is now
 * attached to the wrong sentence. Nothing throws, nothing fails a test, and the
 * only symptom is Gearn answering a question he was not asked — twenty minutes
 * into a chapter, in a language a reviewer may not speak.
 *
 * ── What is used instead ───────────────────────────────────────────────────
 *
 *   `<group>-<6 hex of FNV-1a over the German text>`   e.g. `frameAsk-7f3a91`
 *
 * Three properties follow, and all three are the reason:
 *
 *   1. **Inserting a line moves no existing id.** Ids are a function of the text
 *      and the block it sits in, not of position, so a new line simply gets a
 *      new id and every recording stays attached to the words it was made from.
 *   2. **Editing a line's text invalidates exactly that line's recording** — the
 *      id changes, the old `.ogg` stops being found, and the checklist shows it
 *      as un-recorded again. That is *correct*: the recording is now of a
 *      sentence the game no longer contains. Nothing else in the beat moves.
 *   3. **It is reproducible from the script alone.** No side table of ids to
 *      keep in sync, nothing to merge, and two people who edit different beats
 *      never conflict. The hash is written inline (twelve lines, below) rather
 *      than pulled from a dependency, because a hash whose implementation can
 *      change under a version bump is not a stable id.
 *
 * The **German** text is hashed, not the English, for the reason the script's
 * own header gives: the German is the source and the English is a translation of
 * it. Retranslating a line does not change what was recorded in German, and it
 * should not invalidate the German recording.
 *
 * ── The one thing this does not give you ───────────────────────────────────
 *
 * Two *verbatim identical* German lines inside one block hash the same. That is
 * a collision, it is handled (below) by suffixing the second and later
 * occurrences `-2`, `-3`, …, and it is the single case where inserting a line is
 * not invariant: putting a third copy of an already-duplicated sentence *before*
 * the existing two shifts their suffixes. It is exported as
 * {@link DISAMBIGUATED_LINE_IDS} so a test can watch for it; today the list is
 * empty. A genuine 24-bit hash collision between two *different* sentences in
 * the same block lands in the same mechanism and is equally harmless.
 */

/** How many hex digits of the hash go into an id. 24 bits — collisions within
 *  one block (the only scope that matters) are handled explicitly below, so the
 *  short, readable form wins over an unreadable full-width one. */
const HASH_HEX = 6

/**
 * FNV-1a, 32 bits, over the UTF-16 code units of `text`, as lowercase hex.
 *
 * Written out rather than imported: the id has to be reproducible from this
 * repository for as long as the recordings exist, and a dependency's hash is a
 * number that can change under a version bump. `Math.imul` is the multiply —
 * plain `*` loses the low bits to float64 above 2^53 and would make the result
 * platform-flavoured.
 */
export const textHash = (text: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0').slice(-HASH_HEX)
}

/**
 * The id prefix for the walk-up lines of one cast member.
 *
 * `banter-` rather than the bare cast id, because the two namespaces genuinely
 * overlap: `SCRIPT.theodor` is a beat *about* Theodor and `BANTER.theodor` is
 * what Theodor says when you walk up to him. Without the prefix those two would
 * share a group name and their ids could collide — quietly, since both are
 * strings that look right.
 */
export const banterGroup = (who: CastId): string => `banter-${who}`

/** One line, with everything the runtime and the tooling need to name its file. */
export interface StoryVoiceLine {
  /** The LINE_ID — the `.ogg` base name. Unique across the whole chapter. */
  id: string
  /** `SCRIPT` block id, or `banter-<castId>`. Also the id's prefix. */
  group: string
  /** Position inside the block. For ordering the checklist — never for the id. */
  index: number
  /** Speech sub-folder under `public/speech/<locale>/`: the speaker's id, so a
   *  voice actor's whole part lives in one directory. */
  folder: string
  who: Speaker
  de: string
  en: string
  kind: 'script' | 'banter'
  /** The `Line` object the id was derived from. Identity, not a copy — this is
   *  what {@link lineIdOf} looks up. */
  line: Line
}

/** Ids that needed a `-2` / `-3` suffix to stay unique. Empty is the healthy
 *  state; a test asserts it, so a duplicated sentence is noticed when it is
 *  added rather than when a recording turns up on the wrong line. */
export const DISAMBIGUATED_LINE_IDS: string[] = []

const byLine = new Map<Line, StoryVoiceLine>()
const byId = new Map<string, StoryVoiceLine>()

const push = (kind: 'script' | 'banter', group: string, index: number, line: Line): StoryVoiceLine => {
  const base = `${group}-${textHash(line.de)}`
  let id = base
  // Suffix only on an actual clash, so the common case keeps the short id and a
  // clash is visible in the id itself rather than hidden behind a rename.
  for (let n = 2; byId.has(id); n++) {
    id = `${base}-${n}`
  }
  if (id !== base) {
    DISAMBIGUATED_LINE_IDS.push(id)
  }
  const entry: StoryVoiceLine = {
    id,
    group,
    index,
    folder: line.who,
    who: line.who,
    de: line.de,
    en: line.en,
    kind,
    line
  }
  byId.set(id, entry)
  byLine.set(line, entry)
  return entry
}

const build = (): StoryVoiceLine[] => {
  const out: StoryVoiceLine[] = []
  // `SCRIPT` first and in declaration order, so the checklist reads in the order
  // the chapter is played rather than in whatever order the keys sort.
  const scriptBlocks = Object.entries(SCRIPT) as unknown as [ScriptId, readonly Line[]][]
  for (const [group, lines] of scriptBlocks) {
    lines.forEach((line, index) => out.push(push('script', group, index, line)))
  }
  const banterBlocks = Object.entries(BANTER) as unknown as [CastId, readonly Line[] | undefined][]
  for (const [who, lines] of banterBlocks) {
    if (!lines) {
      continue
    }
    lines.forEach((line, index) => out.push(push('banter', banterGroup(who), index, line)))
  }
  return out
}

/**
 * Every spoken line in the chapter, in play order, with its id resolved.
 *
 * Built once at import. `SCRIPT` and `BANTER` are module-level `const` data with
 * no branches in them, so there is nothing to invalidate and no reason to rebuild
 * — and the map below depends on the `Line` objects being these exact ones.
 */
export const STORY_VOICE_LINES: readonly StoryVoiceLine[] = build()

/**
 * The id of a line, looked up by **object identity**.
 *
 * This is the one the director wants: it already holds the `Line` it is
 * displaying — `SCRIPT[beat.script][i]` or `banterFor(who, turn)` — and both of
 * those hand back the very objects enumerated above, so no bookkeeping of beat
 * ids and indices has to be threaded through the call. Returns `null` for a line
 * that was constructed at runtime rather than taken from the script, which is
 * exactly the case where there cannot be a recording of it.
 */
export const voiceLineOf = (line: Line): StoryVoiceLine | null => byLine.get(line) ?? null

/** {@link voiceLineOf}, id only. */
export const lineIdOf = (line: Line): string | null => byLine.get(line)?.id ?? null

/** The entry for a LINE_ID, or `null`. The inverse of {@link lineIdOf}. */
export const voiceLineById = (id: string): StoryVoiceLine | null => byId.get(id) ?? null

/** The id of the `index`-th line of a named `SCRIPT` block. */
export const scriptLineId = (script: ScriptId, index: number): string | null => {
  const line = (SCRIPT[script] as readonly Line[])[index]
  return line ? lineIdOf(line) : null
}

/** The id of the `turn`-th walk-up line of a cast member (unclamped — pass what
 *  `banterFor` would have used). */
export const banterLineId = (who: CastId, turn: number): string | null => {
  const line = BANTER[who]?.[turn]
  return line ? lineIdOf(line) : null
}
