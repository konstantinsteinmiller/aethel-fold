// ─── Game-state field catalogue ─────────────────────────────────────────────
//
// Field names INSIDE the single `aethel_state` object (see `useAethelState.ts`).
// These are NOT separate localStorage keys — they are properties of the one
// persisted object — but they are still a contract with the player base:
// renaming any of them strands existing players' progress on the old field.

// ─── Castle Fold progress ───────────────────────────────────────────────────

/** Page (1…6) the player resumes on after a reload. */
export const PAGE_KEY = 'fold_page'
/** Run checkpoint taken at every page start: `{ score, hits, time }`. */
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

// ─── User settings (shared platform layer) ──────────────────────────────────

export const SOUND_KEY = 'user_sound_volume'
export const MUSIC_KEY = 'user_music_volume'
export const LANGUAGE_KEY = 'user_language'
/** Mobile-only hard audio mute (boolean). On phones the OS volume rocker owns
 *  the device level and the Web Audio gain has no effect, so the on-screen mute
 *  is a silence toggle instead: suspend all audio + block new music/SFX. */
export const MOBILE_MUTE_KEY = 'mobile_mute'
