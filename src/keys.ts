// ─── Game-state field catalogue ─────────────────────────────────────────────
//
// Field names INSIDE the single `aethel_state` object (see `useAethelState.ts`).
// These are NOT separate localStorage keys — they are properties of the one
// persisted object — but they are still a contract with the player base:
// renaming any of them strands existing players' progress on the old field.

// ─── Aethel Fold progress ───────────────────────────────────────────────────

/** Page (1…6) the player resumes on after a reload. */
export const PAGE_KEY = 'fold_page'
/**
 * Run checkpoint taken at every page start: `{ score, hits, time }`, plus the
 * "book is kind" memory when it carries something: `crumples` per page
 * (`{ b1p3: 2 }`), the perfect-page `streak`, and the sticky `bossEase`.
 */
export const RUN_KEY = 'fold_run'
/** Highest page ever cleared (0…6) — the headline progress number. */
export const CLEARED_KEY = 'fold_cleared'
/** Records: `{ score, time }` (time in seconds for a full run, 0 = none). */
export const BEST_KEY = 'fold_best'
/** Completed runs (victories). */
export const WINS_KEY = 'fold_wins'
/** Runs started. */
export const RUNS_KEY = 'fold_runs'
/** Wordless lessons already learned: `Record<LessonId, true>`. */
export const LESSONS_KEY = 'fold_lessons'
/** Lifetime stats: launched, crushed, torn, folds, stamps, blocks … */
export const STATS_KEY = 'fold_stats'
/** Game settings: `{ haptics, shake, quality }`. */
export const SETTINGS_KEY = 'fold_settings'
/** Book (1 or 2) the resume page belongs to. */
export const BOOK_KEY = 'fold_book'
/** Book 2 ("The Homefront"): highest page cleared, records `{ score, time }`, victories. */
export const CLEARED2_KEY = 'fold_cleared2'
export const BEST2_KEY = 'fold_best2'
export const WINS2_KEY = 'fold_wins2'
/**
 * Best origami stars per page (roadmap #1): `Record<'b<book>p<page>', 1…3>`,
 * e.g. `{ b1p1: 3, b1p2: 2 }`. Only ever raised; a cloud merge keeps the
 * per-page maximum of both sides (`carryStars` in SaveMergePolicy).
 */
export const STARS_KEY = 'fold_stars'
/**
 * Page secrets found (roadmap #15): a list of secret ids, e.g.
 * `['lamp', 'boat']`. Only ever grows; a cloud merge keeps the union.
 */
export const SECRETS_KEY = 'fold_secrets'
/**
 * Dragon Rush best times (roadmap #16): `Record<'b<book>', seconds>`, e.g.
 * `{ b1: 58.3 }`. Only ever lowered; a cloud merge keeps the faster.
 */
export const RUSH_KEY = 'fold_rush'
/**
 * Paper cosmetics (roadmap #6): `{ owned: ['paper.graph', …], equipped:
 * { paper, hero, confetti } }`. `owned` only grows (stars unlock it); a cloud
 * merge keeps the union and the winning side's equipped items where owned.
 */
export const COSMETICS_KEY = 'fold_cosmetics'
/**
 * Lifetime playtime in seconds (roadmaps #9, #17, #19): the ad grace reads it
 * (no ad before 3 minutes of a first-time player's play). Only ever grows, and
 * only ad builds write it.
 */
export const PLAYTIME_KEY = 'fold_playtime'

// ─── User settings (shared platform layer) ──────────────────────────────────

export const SOUND_KEY = 'user_sound_volume'
export const MUSIC_KEY = 'user_music_volume'
export const LANGUAGE_KEY = 'user_language'
/** Mobile-only hard audio mute (boolean). On phones the OS volume rocker owns
 *  the device level and the Web Audio gain has no effect, so the on-screen mute
 *  is a silence toggle instead: suspend all audio + block new music/SFX. */
export const MOBILE_MUTE_KEY = 'mobile_mute'
/** The volumes `{ music, sound }` from before the mute button silenced the
 *  game, so the next tap restores exactly those (null/absent = not muted by
 *  the button). Inside `aethel_state`, so it survives reloads and devices. */
export const MUTED_VOLUMES_KEY = 'user_muted_volumes'
