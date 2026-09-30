/**
 * Aethel Fold — tuning constants.
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
/**
 * The player's castle along the bottom edge: a keep in the middle (the hero
 * stands on its roof) and two low towers carrying the ballistas. Kept low so
 * it never hides the enemies and traps behind it.
 */
export const CASTLE = {
  keepZ: 6.4,
  keepTop: 0.95,
  towerX: 2.2,
  towerZ: 6.45,
  towerTop: 0.9
} as const

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

export const ENEMY: Record<'knight' | 'brute' | 'archer' | 'catapult' | 'runner' | 'leaper', EnemyTuning> = {
  knight: { speed: 0.95, hp: 1, size: 1, score: 100, launchable: true, bash: 1, bashRate: 1.1, hitStop: false, radius: 0.34 },
  brute: { speed: 0.6, hp: 3, size: 1.55, score: 250, launchable: false, bash: 2, bashRate: 1.4, hitStop: true, radius: 0.55 },
  archer: { speed: 0, hp: 1, size: 1, score: 150, launchable: true, bash: 0, bashRate: 0, hitStop: false, radius: 0.34 },
  catapult: { speed: 0, hp: 1, size: 1.3, score: 300, launchable: true, bash: 0, bashRate: 0, hitStop: true, radius: 0.6 },
  // Twice a knight's pace: the wall has to be up *before* it arrives.
  runner: { speed: 1.95, hp: 1, size: 0.86, score: 120, launchable: true, bash: 1, bashRate: 0.8, hitStop: false, radius: 0.3 },
  // Walls don't hold it (it vaults them) — the sling, a valley or a launch flap do.
  leaper: { speed: 0.8, hp: 1, size: 1, score: 200, launchable: true, bash: 0, bashRate: 0, hitStop: false, radius: 0.34 }
}

/** Leapers: seconds between zig-zag hops, hop and vault flight times. */
export const LEAPER_HOP_EVERY = 1.9
export const LEAPER_HOP_TIME = 0.55
export const LEAPER_VAULT_TIME = 1.05
/** How far past a wall's hinge a vaulting leaper lands. */
export const LEAPER_VAULT_LAND = 1.0
/** A leaper this high in the air is out of a sling stone's reach. */
export const LEAPER_SHOT_CEILING = 1.7

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

// ─── Sling (book 2) ───────────────────────────────────────────────────────

/** Seconds to reload after a shot. */
export const SLING_COOL = 1.35
/** Page units of pull before a release counts as a shot. */
export const SLING_MIN_PULL = 0.3
/** Range per unit of pull (pull back 1, the stone flies ~5.5 up the page). */
export const SLING_GAIN = 5.5
/** Longest shot, page units from the cup. */
export const SLING_RANGE = 14.5
/** Splash radius where the stone lands. */
export const SLING_RADIUS = 1.2
/** Grab radius around the cup. */
export const SLING_GRAB = 1.0
/** Flight time = base + per unit of distance. */
export const SLING_FLIGHT_BASE = 0.35
export const SLING_FLIGHT_PER = 0.045

// ─── Ballistas (the castle towers) ────────────────────────────────────────

/** Bolts per opening; then it folds itself away. */
export const BALLISTA_SHOTS = 2
/** Seconds folded away before it can be flipped open again. */
export const BALLISTA_COOLDOWN = 3
/** Bolt speed (page units / s); bolts fly flat and pierce. */
export const BOLT_SPEED = 24
/** How close to the bolt's path an enemy must be to be hit. */
export const BOLT_RADIUS = 0.42
/** Enemies one bolt can pierce. */
export const BOLT_PIERCE = 4

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
  block: 50,
  /** A sling stone landing on the dragon's exposed weak point. */
  slingWeak: 500,
  /** …or anywhere on its body. */
  slingBody: 150
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
  breathZ: 5.4,
  /** Where the dragon's body is on the page, and how big (sling hits). */
  bodyX: 0,
  bodyZ: -3,
  bodyRadius: 2.6,
  /** Sling hits on the body that make it flinch and expose its next weak point. */
  slingHitsToExpose: 3
}

// ─── Waves / pacing ────────────────────────────────────────────────────────

/** Seconds after the last wave before the page counts as cleared. */
export const PAGE_CLEAR_DELAY = 0.9
/** Seconds the page-turn animation takes (renderer matches this). */
export const PAGE_TURN_TIME = 1.35
export const CRUMPLE_TIME = 1.25
export const PAGE_DROP_TIME = 0.8
export const PEEL_COMPLETE = 0.55

// ─── "Almost!" moment on failure (roadmap #9) ─────────────────────────────

export const ALMOST = {
  /** Seconds the "Almost! N soldiers from a clear!" count stays up after the crumple. */
  show: 2,
  /** Seconds after the crumple the big Try-again button appears. */
  button: 1.9,
  /** Seconds after the crumple a fresh page drops on its own (score back to the page start). */
  autoRetry: 5.5,
  /** Try-agains per page attempt that continue where the page was; after that, Try again starts it fresh. */
  continues: 1,
  /** Share of the points gathered on this page that a Try-again continue costs. */
  penalty: 0.5,
  /** Sim seconds the hero can't be hurt after a Try-again drop (whoever was at the gate files past). */
  grace: 2
} as const

// ─── Star rating per page (roadmap #1) ────────────────────────────────────

export const STARS = {
  /** ★★: cleared with at most this many hearts lost. */
  twoStarHits: 1,
  /**
   * Par (see `parFor` in stars.ts) asks for this share of the page's enemy
   * base points *on top of* the points every perfect clear banks anyway — the
   * bonus only multi-kills, stamp crushes and combos pay. Measured against the
   * frame-perfect autoplay bot (tests/fold/bot.ts, 8 seeds, perfect clears):
   * its natural skill share runs from 0.36 (book 2 page 3) to 0.9 (page 1),
   * so 0.35 is just inside what a flawless player gets without chasing combos
   * on the hardest page, and a human has to chain folds to reach it.
   */
  parSkill: 0.35,
  /**
   * The dragon's page has no authored waves (its marchers spill from stomps),
   * so its skill share is flat: the bot banks 3.0–5.4k on top of the boss,
   * weak-point and perfect points.
   */
  bossSkill: 2500,
  /** Pars are rounded down to this step so they read cleanly. */
  parStep: 50,
  /** Seconds after `pageCleared` the first star folds in (lands with the page turn's lift)… */
  revealDelay: 0.55,
  /** …and between stars. Audio (FoldAudio) and the ribbon (StarRibbon) share these. */
  revealStep: 0.32,
  /** Seconds the ribbon hangs after the last star before it folds away. */
  revealHold: 1.1
} as const

// ─── Adaptive difficulty, "the book is kind" (roadmap #8) ─────────────────

export const DIFFICULTY = {
  /** March speed / spawn pace on a page the player has already crumpled on. */
  crumpleSlow: 0.9,
  /** Real seconds of lesson-style slow-mo when the next column walks onto a fold, after a crumple. */
  foldSlowmo: 0.5,
  /** Perfect pages in a row before waves grow… */
  perfectStreak: 3,
  /** …by this many marchers. */
  extraPerWave: 1,
  /** Crumples on the pages up to the boss page before the dragon's mass units ease off… */
  bossEaseLosses: 2,
  /** …to this share of their speed. */
  bossEase: 0.8,
  /** Clamp for the stacked scalar. */
  min: 0.6,
  max: 1.5
} as const

// ─── The bookshelf on the desk (roadmap #2) ───────────────────────────────

/**
 * A small cardboard bookshelf standing on the desk right of the book: one
 * slot per book, plus a silhouette for the book that is still coming. Wide
 * aspects see it beside the page; portrait zooms the camera out to it.
 * Page space (y = 0 is the play page); the view and the ghost hand both place
 * the books from these numbers (`slotAnchor` in `shelf.ts`).
 */
export const SHELF = {
  x: 9.6,
  z: -1.7,
  /** The desk top, below the page plane (BookView's `DESK_Y`). */
  y: -0.62,
  /** Turned a little toward the book and the camera (about y). */
  yaw: -0.3,
  /** Leans back so the spines face the steep desk camera (about x). */
  lean: -0.32,
  /** Book slots: one per book, the last one the coming book 3. */
  slots: 3,
  spacing: 1.46,
  bookW: 1.2,
  bookH: 3.2,
  bookD: 2.1,
  /** Thickness of the shelf's boards. */
  board: 0.16,
  /** How far an inspected book slides out toward the player. */
  pull: 1.0,
  /** Real seconds after the victory ribbon before the camera turns to the shelf by itself. */
  afterVictory: 6,
  /** Real-time constant of the camera's zoom out / in (seconds). */
  zoomTime: 0.32,
  /** Real seconds the ghost hand points the way to the shelf on a page intro. */
  cueTime: 4
} as const
