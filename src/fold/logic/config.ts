/**
 * Castle Fold — tuning constants.
 *
 * Every number the simulation uses lives here so balancing is one file. Where a
 * number was chosen against a measurement, the measurement is in the comment.
 */

// ─── Page geometry (page space units; see types.ts) ────────────────────────

export const PAGE_W = 10
export const PAGE_D = 14
export const PAGE_HALF_W = PAGE_W / 2
export const PAGE_HALF_D = PAGE_D / 2

/** Where the hero stands, and the line an enemy must not cross. */
export const HERO_X = 0
export const HERO_Z = 5.6
export const BREACH_Z = 5.0
/** Enemies enter just above the top edge so they walk *onto* the page. */
export const SPAWN_Z = -PAGE_HALF_D - 0.4

// ─── Folds ─────────────────────────────────────────────────────────────────

/** Released past this much drag, a fold snaps home. Below, it springs back. */
export const FOLD_SNAP_THRESHOLD = 0.42
/** A flick faster than this (drag units per second) snaps regardless. */
export const FOLD_FLICK_SPEED = 3.2
/** Seconds for the snap from wherever the finger let go to fully folded. */
export const FOLD_SNAP_TIME = 0.16
/** Seconds the stamp slam takes — short on purpose: "extreme force". */
export const FOLD_STAMP_TIME = 0.085
/** Seconds to lower a wall gently when its hold expires. */
export const FOLD_LOWER_TIME = 0.55
/** Spring back when a drag is abandoned below the threshold. */
export const FOLD_SPRING_RATE = 14
/** Raised-wall angle at which it starts counting as a barrier (0…1). */
export const FOLD_BLOCK_T = 0.55
/** Seconds a stamped valley stays shut before unfolding again. */
export const VALLEY_SHUT_TIME = 0.55
/** Default wall timings, overridable per fold. */
export const WALL_HOLD = 5.5
export const WALL_COOLDOWN = 0.9
export const WALL_HP = 6
export const SHIELD_HOLD = 3.4
export const SHIELD_COOLDOWN = 0.7
export const SHIELD_HP = 5
export const VALLEY_HOLD = 7

// ─── Enemies ───────────────────────────────────────────────────────────────

export interface EnemyTuning {
  speed: number
  hp: number
  size: number
  score: number
  /** Can a wall snap throw it? Brutes are too heavy. */
  launchable: boolean
  /** Wall damage per bash. */
  bash: number
  /** Seconds between bashes. */
  bashRate: number
  /** Hit-stop when stamped. */
  hitStop: boolean
  /** Separation radius used when bunching behind walls. */
  radius: number
}

export const ENEMY: Record<'knight' | 'brute' | 'archer' | 'catapult', EnemyTuning> = {
  knight: { speed: 0.95, hp: 1, size: 1, score: 100, launchable: true, bash: 1, bashRate: 1.1, hitStop: false, radius: 0.34 },
  brute: { speed: 0.6, hp: 3, size: 1.55, score: 250, launchable: false, bash: 2, bashRate: 1.4, hitStop: true, radius: 0.55 },
  archer: { speed: 0, hp: 1, size: 1, score: 150, launchable: true, bash: 0, bashRate: 0, hitStop: false, radius: 0.34 },
  catapult: { speed: 0, hp: 1, size: 1.3, score: 300, launchable: true, bash: 0, bashRate: 0, hitStop: true, radius: 0.6 }
}

/** Archers: first volley delay and cadence. */
export const ARCHER_FIRST_SHOT = 3.2
export const ARCHER_RATE = 4.6
/** Seconds of visible bow-draw before an arrow leaves. */
export const ARCHER_WINDUP = 0.9
export const ARROW_SPEED = 7.5
/** Catapults: slower, high arcs, telegraphed with a landing marker. */
export const CATAPULT_FIRST_SHOT = 4.5
export const CATAPULT_RATE = 7.5
export const CATAPULT_WINDUP = 1.2
export const BOULDER_FLIGHT = 1.9

/** Launch: knights thrown by a snapping wall fly at the lens. */
export const LAUNCH_SPEED_Y = 9.5
export const LAUNCH_SPEED_Z = 6.5
export const LAUNCH_LIFE = 0.9
/** A catapult flung by a launch fold lands this far up the page (z). */
export const FLING_TIME = 1.05
export const FLING_RADIUS = 1.9

/** Crushed/torn enemies linger this long for the flatten animation. */
export const CRUSH_LINGER = 0.5
export const TORN_LINGER = 0.45

// ─── Hero ──────────────────────────────────────────────────────────────────

export const HERO_HP = 3
export const HERO_INVULN = 1.1

// ─── Tears ─────────────────────────────────────────────────────────────────

/** Two-finger spread (as a fraction of the start distance) that completes a tear. */
export const SPREAD_COMPLETE = 0.85
/** Single-pointer tear drag (as a fraction of the viewport's short side). */
export const TEAR_DRAG_COMPLETE = 0.2

// ─── Game feel ─────────────────────────────────────────────────────────────

/** GDD §5: 0.1 s (3 frames) freeze on stamping a large enemy. */
export const HIT_STOP = 0.1
/** Lesson slow-mo. */
export const LESSON_TIME_SCALE = 0.14
export const TIME_SCALE_RATE = 7

// ─── Scoring ───────────────────────────────────────────────────────────────

export const SCORE = {
  /** Per extra enemy in one launch/stamp: +25 % of its base, stacking. */
  multiKillStep: 0.25,
  /** Stamp crush bonus on top of base. */
  stampBonus: 0.5,
  tower: 500,
  gate: 750,
  drawbridge: 1000,
  weakpoint: 1500,
  boss: 5000,
  frog: 2000,
  /** Clearing a page without losing a heart. */
  perfectPage: 1000,
  /** Arrows/boulders/fire caught on a shield. */
  block: 50
}

// ─── Boss ──────────────────────────────────────────────────────────────────

export const BOSS = {
  rumble: 2.6,
  unfold: 3.4,
  roar: 1.6,
  idleMin: 1.6,
  idleMax: 2.6,
  breathCharge: 2.2,
  breath: 1.35,
  stomp: 1.6,
  /** Seconds a weak point stays open before the dragon covers it again. */
  exposed: 6.5,
  hurt: 1.5,
  collapse: 3.2,
  /** Breath/stomp attacks between weak points. */
  attacksPerExposure: 2,
  /** Breath aim: page-space target (the hero). */
  breathZ: 5.4
}

// ─── Waves / pacing ────────────────────────────────────────────────────────

/** Seconds after the last wave before the page counts as cleared. */
export const PAGE_CLEAR_DELAY = 0.9
/** Seconds the page-turn animation takes (renderer matches this). */
export const PAGE_TURN_TIME = 1.35
export const CRUMPLE_TIME = 1.25
export const PAGE_DROP_TIME = 0.8
export const PEEL_COMPLETE = 0.55
