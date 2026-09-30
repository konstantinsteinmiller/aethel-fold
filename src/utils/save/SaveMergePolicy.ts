// ─── Save merge policy ────────────────────────────────────────────────────
//
// Decides what to do when a hydrate brings back remote data that disagrees
// with the local snapshot. Pure module — no Vue, no I/O, no side effects.
// Strategies call into this; the SaveManager wires the result back into
// localStorage via the LocalStorageAccessor it owns.
//
// Each persisted save now carries a meta blob (`__save_meta__`) alongside
// the player's actual keys. The blob lets the next hydrate score local vs.
// remote and pick a winner deterministically without prompting.
//
// Score formula (Aethel Fold):
//   pagesCleared  × 1000   (book 1 + book 2)
// + wins          × 5000   (book 1 + book 2)
// + lessons       ×   50
// + resumePage    ×  100
// + runs          ×   10
// + stars         ×   25   (origami stars over every page, at most 10 × 3)
//
// `pagesCleared` is the headline progress number (highest page ever cleared),
// wins are completed runs, and lessons / the resume page / the run counter
// break ties between two saves at the same milestone. Stars (≤ 30 × 25 = 750)
// never outrank a cleared page; they only prefer the better-played save of two
// at the same milestone.
//
// Stars are also merged field-level: whichever side wins, `carryStars` folds
// the loser's per-page best stars into the winner's blob (per-page maximum),
// so a merge can never take a star away.
//
// Conflict policy:
//   - higher score wins
//   - tie on score → newer savedAt wins
//   - same time too → keep local (no needless writes)
//   - Aethel Fold has no currency, so a remote win never pays a bonus.

import { CLEARED2_KEY, CLEARED_KEY, LESSONS_KEY, PAGE_KEY, RUNS_KEY, STARS_KEY, WINS2_KEY, WINS_KEY } from '@/keys'
import { STATE_KEY } from '@/use/useAethelState'
import { countStars, mergeStarRecords, readStarRecord } from '@/fold/logic/stars'

/** Where the meta blob is stored in localStorage / on the remote backend.
 *  NOT prefixed with `__save_internal__` — this key needs to round-trip
 *  through the strategy's mirror just like player data. */
export const META_KEY = '__save_meta__'

/** Bumped when the meta blob's shape changes in a non-additive way. */
export const SCHEMA_VERSION = 1

// ─── Game-specific keys the score formula needs to read ────────────────────
//
// Sourced from `src/keys.ts` (single source of truth shared with the
// composables that own these keys). Importing keeps this module pure (no
// Vue imports — `keys.ts` is a flat constants file) AND eliminates the
// drift risk the previous duplicated declaration had.

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SaveMeta {
  /** ISO timestamp of when this save was generated. */
  savedAt: string
  /** Output of the score formula above. */
  progressScore: number
  schemaVersion: number
  /** Highest wave the save represents — used to compute the conflict bonus.
   *  Field name kept as `maxStage` for wire-compat with saves already in the
   *  cloud from earlier builds; semantically it is "best wave". */
  maxStage: number
  /**
   * Cloud `savedAt` for which this client already received the conflict
   * bonus. Prevents repeat farming: if a player force-closes and reopens
   * (cloud unchanged, local possibly cleared), the strategy still sees
   * `remote-wins` would award `+N coins` — but if `bonusReceivedFor`
   * matches the cloud's `savedAt`, the bonus is suppressed because we
   * already paid it out. The flag is written into the META blob and
   * round-trips through cloud + IDB backup, so it survives whichever
   * partition the OS happens to clear.
   *
   * Optional for back-compat with legacy save blobs that predate this
   * field — `parseMeta` accepts records without it.
   */
  bonusReceivedFor?: string
}

/** Narrow read-only view over a localStorage snapshot. */
export interface SnapshotReader {
  get(key: string): string | null
}

/**
 * Hydrate-time merge resolution. The SaveManager's job is to:
 *   - apply the chosen side's keys to local
 *   - schedule a flush back to remote when the chosen side is local
 *
 * `bonusCoins` is kept in the shape for strategy compatibility and is always 0.
 */
export type MergeResolution =
/** Remote had higher progress; overwrite local. Bonus may be 0 if local was empty. */
  | { kind: 'remote-wins'; bonusCoins: number }
  /** Local had higher progress; keep local and push it to remote on next flush. */
  | { kind: 'local-wins' }
  /** Local was empty; remote is the seed. Same as remote-wins but no bonus and no "loss". */
  | { kind: 'remote-only' }
  /** Remote returned no data; nothing to merge. */
  | { kind: 'local-only' }
  /** Both sides identical; keep local, skip the rewrite. */
  | { kind: 'tie-keep-local' }

// ─── Helpers ──────────────────────────────────────────────────────────────

const safeInt = (v: string | null, fallback: number): number => {
  if (v == null) return fallback
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

const safeJson = <T>(v: string | null, fallback: T): T => {
  if (v == null) return fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Compute a fresh meta blob from the current localStorage snapshot.
 * Pure — no side effects.
 */
/** Pull a sub-field out of the consolidated `aethel_state` blob, falling back
 *  to a top-level read. Exported so the SaveManager's fresh-user guard reads
 *  the exact same way the score formula does. */
export const readField = (read: SnapshotReader, field: string): string | null => {
  const blob = read.get(STATE_KEY)
  if (blob != null) {
    try {
      const parsed = JSON.parse(blob)
      if (parsed && typeof parsed === 'object' && field in parsed) {
        const v = (parsed as Record<string, unknown>)[field]
        if (v == null) return null
        return typeof v === 'string' ? v : JSON.stringify(v)
      }
    } catch { /* fall through to direct read */ }
  }
  return read.get(field)
}

export const computeMeta = (
  read: SnapshotReader,
  savedAt: string = new Date().toISOString()
): SaveMeta => {
  // A brand-new local snapshot scores 0 and can never beat a real cloud save.
  const cleared = Math.max(0, Math.min(6, safeInt(readField(read, CLEARED_KEY), 0)))
  const wins = Math.max(0, safeInt(readField(read, WINS_KEY), 0))
  // Book 2 progress counts the same as book 1's: a save deep into the second
  // book must never lose to a stale one that only finished the first.
  const cleared2 = Math.max(0, Math.min(6, safeInt(readField(read, CLEARED2_KEY), 0)))
  const wins2 = Math.max(0, safeInt(readField(read, WINS2_KEY), 0))
  const runs = Math.max(0, safeInt(readField(read, RUNS_KEY), 0))
  const page = Math.max(1, Math.min(6, safeInt(readField(read, PAGE_KEY), 1)))
  const lessons = safeJson<Record<string, unknown>>(readField(read, LESSONS_KEY), {})
  let learned = 0
  if (lessons && typeof lessons === 'object') {
    for (const v of Object.values(lessons)) if (v === true) learned++
  }
  const stars = countStars(safeJson<unknown>(readField(read, STARS_KEY), {}))

  const progressScore =
    (cleared + cleared2) * 1000
    + (wins + wins2) * 5000
    + learned * 50
    + (page - 1) * 100
    + runs * 10
    + stars * 25

  return { savedAt, progressScore, schemaVersion: SCHEMA_VERSION, maxStage: cleared + cleared2 }
}

/**
 * Parse a meta blob from a stored value. Returns null for missing /
 * malformed blobs (treat as "no prior meta exists" — typically a save
 * that predates this layer or a value the SDK never wrote).
 */
export const parseMeta = (raw: string | null | undefined): SaveMeta | null => {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const m = parsed as Partial<SaveMeta>
  if (
    typeof m.savedAt !== 'string' ||
    typeof m.progressScore !== 'number' || !Number.isFinite(m.progressScore) ||
    typeof m.schemaVersion !== 'number' || !Number.isFinite(m.schemaVersion) ||
    typeof m.maxStage !== 'number' || !Number.isFinite(m.maxStage)
  ) return null
  const out: SaveMeta = {
    savedAt: m.savedAt,
    progressScore: m.progressScore,
    schemaVersion: m.schemaVersion,
    maxStage: m.maxStage
  }
  if (typeof m.bonusReceivedFor === 'string') {
    out.bonusReceivedFor = m.bonusReceivedFor
  }
  return out
}

export const serializeMeta = (meta: SaveMeta): string => JSON.stringify(meta)

/**
 * Compare local and remote metas, return the resolution.
 *
 * Rules (in order):
 *   1. No remote → 'local-only'
 *   2. No local  → 'remote-only'  (nothing to lose; no bonus needed)
 *   3. remote.score > local.score → 'remote-wins'
 *   4. local.score > remote.score → 'local-wins'
 *   5. Equal scores → newer savedAt wins (no bonus on score-tie wins)
 *   6. Equal everything → 'tie-keep-local'
 */
export const decideMerge = (
  localMeta: SaveMeta | null,
  remoteMeta: SaveMeta | null
): MergeResolution => {
  if (!remoteMeta) return { kind: 'local-only' }
  if (!localMeta) return { kind: 'remote-only' }

  if (remoteMeta.progressScore > localMeta.progressScore) {
    return { kind: 'remote-wins', bonusCoins: 0 }
  }
  if (localMeta.progressScore > remoteMeta.progressScore) {
    return { kind: 'local-wins' }
  }

  // Equal scores → newer timestamp wins. No bonus on a score-tie win
  // because no progress was actually surpassed.
  const lt = Date.parse(localMeta.savedAt)
  const rt = Date.parse(remoteMeta.savedAt)
  if (Number.isFinite(rt) && Number.isFinite(lt) && rt > lt) {
    return { kind: 'remote-wins', bonusCoins: 0 }
  }
  return { kind: 'tie-keep-local' }
}

/**
 * Fold the other side's best stars into the winning side's `aethel_state`
 * blob (per-page maximum), so a whole-blob merge never loses a star.
 * `winnerRaw` / `otherRaw` are raw `aethel_state` strings (null = absent).
 * Returns the new winner blob, or null when nothing changes (no write needed,
 * or the winner blob is missing / unparseable — then it is left alone).
 */
export const carryStars = (winnerRaw: string | null, otherRaw: string | null): string | null => {
  if (winnerRaw == null || otherRaw == null) return null
  let winner: unknown
  let other: unknown
  try {
    winner = JSON.parse(winnerRaw)
    other = JSON.parse(otherRaw)
  } catch {
    return null
  }
  if (!winner || typeof winner !== 'object' || Array.isArray(winner)) return null
  if (!other || typeof other !== 'object' || Array.isArray(other)) return null
  const w = winner as Record<string, unknown>
  const theirs = readStarRecord((other as Record<string, unknown>)[STARS_KEY])
  if (Object.keys(theirs).length === 0) return null
  const ours = readStarRecord(w[STARS_KEY])
  const merged = mergeStarRecords(ours, theirs)
  let changed = false
  for (const k of Object.keys(merged)) if (merged[k] !== ours[k]) changed = true
  if (!changed) return null
  return JSON.stringify({ ...w, [STARS_KEY]: merged })
}

/**
 * Allowlist of keys that participate in the persisted payload.
 *
 * Replacing the old "anything not internal" rule because that let
 * unrelated localStorage entries — vConsole layout, ad-tech experiment
 * flags (`prebid11_*`, `dummy_*_exp`, `li-module-enabled`, `bid_pf_*`),
 * dev toggles, and whatever the next library decides to scribble — get
 * mirrored to the cloud. The CrazyGames Data Module then included all
 * of that in its upload, ballooning the POST body and giving QA a
 * misleading picture of what the game stores.
 *
 * Single-blob model: every persisted gameplay value lives inside the
 * `aethel_state` localStorage entry (see `useAethelState.ts`). The cloud
 * therefore mirrors exactly TWO keys — the state blob and the meta blob.
 */
export const isPayloadKey = (key: string): boolean => key === META_KEY || key === STATE_KEY

// Re-exported so tests / other modules don't have to re-declare them.
export const SAVE_KEYS = {
  STATE: STATE_KEY,
  CLEARED: CLEARED_KEY,
  WINS: WINS_KEY,
  RUNS: RUNS_KEY,
  PAGE: PAGE_KEY,
  LESSONS: LESSONS_KEY
} as const
