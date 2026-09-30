/**
 * Aethel Fold — shared logic types.
 *
 * Everything under `src/fold/logic/` is plain TypeScript with no three.js, no
 * Vue and no DOM, so the whole game can be simulated headlessly in a unit
 * test. The renderer reads these structures; it never writes to them.
 *
 * Page space: x ∈ [-PAGE_HALF_W, PAGE_HALF_W] left→right, z ∈ [-PAGE_HALF_D,
 * PAGE_HALF_D] top (enemy side) → bottom (player side). y is height above the
 * sheet and only matters for things in the air (launched knights, arrows).
 */

/** A page's position within its book (every book has six). */
export type PageId = 1 | 2 | 3 | 4 | 5 | 6

/**
 * Book 1 — "The Paper Dragon": the hero marches on the enemy castle.
 * Book 2 — "The Homefront": the perspective flips; the enemy besieges the
 * hero's own keep, which stands at the bottom of every page.
 */
export type BookId = 1 | 2

/** Origami stars a cleared page earns (roadmap #1): 0 = never cleared. */
export type Stars = 0 | 1 | 2 | 3

// ─── Folds ─────────────────────────────────────────────────────────────────

/**
 * wall    — a flap on the enemy side of its hinge that snaps up to 90°. Pops a
 *           pop-up tower/wall/shield, launches anything standing on it, then
 *           blocks the lane until it is stamped flat or lowers by itself.
 * valley  — two panels either side of a strip that rise into a V, trapping
 *           whoever is inside; a stamp claps them shut and crushes the lot.
 * launch  — a flap that flips 180° over its enemy-side hinge and flings what
 *           stands on it (a catapult, knights) back up the page.
 * ridge   — the ground itself folds into a ∧ mountain that permanently closes
 *           a lane, so the march has to re-route (the "shape terrain" fold).
 * frog    — the finale: the flattened dragon sheet folds into a paper frog.
 * ballista — a ballista folded flat on one of the player's castle towers;
 *           swiping it up flips it open for BALLISTA_SHOTS tap-aimed bolts,
 *           then it folds itself away and re-arms after a cooldown.
 */
export type FoldKind = 'wall' | 'valley' | 'launch' | 'ridge' | 'frog' | 'ballista'

/** The pop-up that rises with a wall fold. Purely art + blocking strength. */
export type FoldStructure = 'tower' | 'wall' | 'shield' | 'ballista' | 'none'

export interface FoldDef {
  id: string
  kind: FoldKind
  /** Hinge segment in page space. For a valley it is the strip's centre line. */
  ax: number
  az: number
  bx: number
  bz: number
  /**
   * Flap depth, measured perpendicular to the hinge on the flap side. For a
   * valley it is the half-width of the strip (each panel's width).
   */
  depth: number
  /**
   * Which side of a→b the flap lies on: +1 = the side `sideOf` reports as
   * positive. Pages are authored with helpers so nobody has to reason about
   * it by hand.
   */
  side: 1 | -1
  structure: FoldStructure
  /** Seconds a raised wall stays up before lowering by itself. */
  hold: number
  /** Seconds after lowering before the line can be folded again. */
  cooldown: number
  /** Knocks (enemy bashes, arrow hits, fire ticks) a raised wall absorbs. */
  hp: number
  /** Swipe direction in page space (unit). Computed by the page builder. */
  sx: number
  sz: number
  /** Wave index from which the fold is available (lines fade in). */
  fromWave: number
  /** Wordless lesson that introduces this line, if any. */
  lesson?: LessonId
}

export type FoldPhase =
  | 'hidden'     // not yet introduced this page
  | 'ready'      // flat, dotted guide visible, can be grabbed
  | 'dragging'   // following the player's finger
  | 'snapping'   // released past the threshold — accelerating to full
  | 'up'         // raised: blocking / trapping, stampable
  | 'stamping'   // slamming flat with extreme force
  | 'lowering'   // gently folding back down (hold expired or wall broken)
  | 'cooldown'   // flat, guide dimmed, not grabbable yet
  | 'spent'      // single-use folds (launch, ridge, frog) after use

export interface FoldState {
  def: FoldDef
  /** Hinge frame (precomputed): unit along the hinge, unit toward the flap, hinge length, centre. */
  ux: number
  uz: number
  nx: number
  nz: number
  len: number
  cx: number
  cz: number
  phase: FoldPhase
  /** 0 = flat on the page, 1 = fully folded (90° wall, 180° launch, ∧ ridge…). */
  t: number
  /** Angular-ish velocity of t, used for the spring back and the snap. */
  v: number
  /** Drag progress the finger asked for (0…1) while dragging. */
  drag: number
  /** Seconds left in the current timed phase (hold, cooldown). */
  timer: number
  hp: number
  /** Visual: 0…1 flash on snap / stamp, decays in the renderer's time. */
  flash: number
  /** Monotonic counter bumped on every snap/stamp so views can react once. */
  rev: number
  /** Ballistas: bolts left while open. */
  ammo: number
  /** Ballistas: where the last bolt was aimed (the view turns toward it). */
  aimX: number
  aimZ: number
}

// ─── Tear targets (spread / pinch) ─────────────────────────────────────────

export type TearKind = 'tower' | 'gate' | 'drawbridge' | 'weakpoint'

export interface TearDef {
  id: string
  kind: TearKind
  x: number
  z: number
  /** Pick radius in page units. */
  radius: number
  /** Crease direction angle (radians, page space) — the tear opens across it. */
  angle: number
  /** Available from wave index. */
  fromWave: number
  /** Must these be torn first? (ids) */
  requires?: string[]
  score: number
  lesson?: LessonId
}

export interface TearState {
  def: TearDef
  /**
   * Where the tear is *picked* on the page plane. Defaults to the def's
   * position; the renderer moves it to the ground-projection of the visible
   * crease (a crease 1.4 m up a tower appears further down the screen).
   */
  px: number
  pz: number
  /** 0 = intact, 1 = torn open. Follows the fingers while pulling. */
  t: number
  pulling: boolean
  torn: boolean
  /** Visible & pullable? False until `requires` are torn and fromWave reached. */
  active: boolean
  rev: number
}

// ─── Enemies ───────────────────────────────────────────────────────────────

/**
 * runner — a light scout, twice as fast as a knight; one hit of anything kills it.
 * leaper — a grasshopper-knight on paper springs: zig-zags between lanes in
 *          hops and vaults clean over raised walls, so walls can't stop it —
 *          the sling, a valley or a launch flap can.
 */
export type EnemyType = 'knight' | 'brute' | 'archer' | 'catapult' | 'runner' | 'leaper'

export type EnemyState =
  | 'dead'       // slot free
  | 'march'      // walking its lane
  | 'blocked'    // stopped behind a raised wall, bashing it
  | 'trapped'    // inside a raised valley
  | 'launched'   // ballistic, flying toward the lens or back up the page
  | 'crushed'    // flattened by a stamp; plays out then frees the slot
  | 'torn'       // ripped (by a tear or a catapult landing)
  | 'breached'   // reached the player's line
  | 'stand'      // stationary shooters (archers, catapults)
  | 'swept'      // lost footing (ridge rising under it), tumbling aside
  | 'leap'       // a leaper mid-hop (lane change or vaulting a wall)

export interface Enemy {
  id: number
  type: EnemyType
  state: EnemyState
  x: number
  z: number
  y: number
  vx: number
  vy: number
  vz: number
  /** Lane index it is following (march) or -1. */
  lane: number
  /** Lateral target (re-route) — x it steers toward. */
  tx: number
  speed: number
  hp: number
  /** Seconds in the current state. */
  age: number
  /** Timer for shooters/bashers. */
  cool: number
  /** Walk-cycle phase, advanced with distance walked. */
  phase: number
  /** Spin while launched (radians). */
  spin: number
  /** Scale (brutes are big). */
  size: number
  /** Which fold holds it (blocked/trapped), or -1. */
  fold: number
  /** Visual flags: anticipation (0…1) for shooters winding up. */
  windup: number
  /** Knight flying toward the camera ends in a lens-burst instead of a floor burst. */
  towardLens: boolean
  /** Monotonic spawn serial for stable view mapping. */
  serial: number
}

// ─── Projectiles ───────────────────────────────────────────────────────────

/** `shot` is the player's own sling stone (a wadded paper ball). */
export type ProjectileType = 'arrow' | 'boulder' | 'catapultFling' | 'fire' | 'shot' | 'bolt'

export interface Projectile {
  id: number
  alive: boolean
  type: ProjectileType
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** Where it will land (page space) — used for the ground marker. */
  tx: number
  tz: number
  age: number
  life: number
  /** The enemy that fired it (for flings: the catapult's slot). */
  owner: number
  stuck: boolean
  serial: number
  /** Bolts: enemies pierced so far. */
  hits: number
}

// ─── Hero ──────────────────────────────────────────────────────────────────

export interface Hero {
  x: number
  z: number
  hp: number
  maxHp: number
  /** Seconds of invulnerability after a hit. */
  invuln: number
  /** 'idle' | 'cheer' | 'cower' | 'hit' | 'down' — for the standee's pose. */
  mood: HeroMood
  moodTimer: number
  rev: number
}

export type HeroMood = 'idle' | 'cheer' | 'cower' | 'hit' | 'down' | 'walk'

// ─── Lessons (wordless onboarding) ─────────────────────────────────────────

export type LessonId =
  | 'swipe' | 'stamp' | 'shield' | 'launch' | 'ridge' | 'spread' | 'peel' | 'crease' | 'core' | 'frog'
  // Added with book 2 (appended so the persisted lesson codes stay stable).
  | 'crush' | 'sling' | 'leaper' | 'ballista'
  // Added with the desk bookshelf (roadmap #2).
  | 'shelf'

// ─── Waves ─────────────────────────────────────────────────────────────────

export interface SpawnDef {
  type: EnemyType
  lane: number
  /** Seconds after the wave starts. */
  at: number
  /** Fixed position for stationary shooters. */
  x?: number
  z?: number
}

export interface WaveDef {
  spawns: SpawnDef[]
  /** Seconds of breathing room after the previous wave is cleared. */
  delay: number
  /** Lesson to run on this wave (slow-mo + ghost hand). */
  lesson?: LessonId
}

// ─── Pages ─────────────────────────────────────────────────────────────────

export interface LaneDef {
  /** Polyline from the top edge to the player's line, page space. */
  points: number[] // x0,z0,x1,z1,...
}

// ─── Sling (the player's trebuchet, book 2) ────────────────────────────────

export interface SlingDef {
  /** Where the sling's cup rests, page space (near the hero's keep). */
  x: number
  z: number
}

export interface SlingState {
  def: SlingDef
  /** Seconds until it can be drawn again (reloading). */
  cool: number
  /** Being pulled back by the finger. */
  aiming: boolean
  /** Pull vector (finger − grab point), page units; the shot flies the other way. */
  pullX: number
  pullZ: number
  /** Where the shot will land. */
  tx: number
  tz: number
  shots: number
  rev: number
}

export interface PageDef {
  id: PageId
  book: BookId
  /** i18n key suffix for the page name, e.g. 'border' → fold.page.border. */
  nameKey: string
  lanes: LaneDef[]
  folds: FoldDef[]
  tears: TearDef[]
  waves: WaveDef[]
  /** How the page ends: automatic page turn, interactive layer peel, or scripted. */
  exit: 'turn' | 'peel' | 'boss' | 'finale'
  /**
   * Knights that keep sallying out of a gate until that tear is torn
   * (Page 4). Starts after `after` seconds of play.
   */
  sally?: { untilTorn: string; every: number; count: number; x: number; z: number; after: number }
  /** Decorative theme used by the renderer's page painter. */
  theme: 'border' | 'ravine' | 'siege' | 'gates' | 'core' | 'finale' | 'home' | 'orchard' | 'mill' | 'camp'
  /** The player's sling, if this page has one. */
  sling?: SlingDef
  /**
   * Where lane walkers appear. Pages with a wall or a castle across the top
   * spawn them in front of it (they pop up out of the page like every
   * standee) instead of walking through the paper structure.
   */
  spawnZ?: number
  /** What the finale folds the dragon into. */
  finale?: 'frog' | 'crane'
  /** Who spills out when the dragon stomps (defaults to knights, then a brute). */
  stomp?: EnemyType[]
  /** Boss attack pace multiplier (< 1 = faster). */
  bossPace?: number
  /** Seconds before the first wave. */
  introDelay: number
  /**
   * Score par for ★★★ (roadmap #1): a Perfect Page that gathers at least this
   * many points on the page. Derived from the page's content by `parFor` in
   * `stars.ts` (the rule is documented there); the finale is unrated.
   */
  par: number
}

// ─── Boss ──────────────────────────────────────────────────────────────────

export type BossPhase =
  | 'dormant'      // castle, still
  | 'rumble'       // castle shakes, gears glow through the seams
  | 'unfold'       // the castle opens outward into the dragon
  | 'roar'         // GROUAAARGH
  | 'idle'         // choosing an attack
  | 'breathCharge' // head rears, mouth glows — raise a shield!
  | 'breath'       // paper-fire stream
  | 'stomp'        // stomps, knights spill out
  | 'exposed'      // a weak point glows — crease/spread it
  | 'hurt'         // limb folding back
  | 'collapse'     // folding down into a flat sheet
  | 'flat'         // the sheet the finale folds

export type BossLimb = 'legFL' | 'legFR' | 'wingL' | 'wingR' | 'neck'

export interface BossWeakPoint {
  limb: BossLimb
  /** 'crease' = swipe along the glowing crease; 'core' = spread the gear. */
  mode: 'crease' | 'core'
  /** Page-space position of the weak point on the ground plane projection. */
  x: number
  z: number
  /** Swipe direction for crease mode. */
  sx: number
  sz: number
  broken: boolean
  /** 0…1 progress while being pulled/swiped. */
  t: number
}

export interface Boss {
  phase: BossPhase
  timer: number
  /** Total seconds in phase (for animation curves). */
  phaseTime: number
  weakPoints: BossWeakPoint[]
  /** Index into weakPoints currently exposed, or -1. */
  exposed: number
  /** Fire stream aim, page space. */
  aimX: number
  aimZ: number
  /** How many attacks since the last exposure. */
  attacks: number
  /** Sling stones that hit its body since the last exposure (3 → it flinches open). */
  slingHits: number
  /** 0…1 fold-down progress in collapse; frog progress in the finale. */
  collapse: number
  /**
   * Multiplies the paced `BOSS` timings (`bossTiming` in boss.ts): 1 in normal
   * play, `RUSH.timing` in a Dragon Rush (roadmap #16). Survives `resetBoss`.
   */
  timing: number
  rev: number
}

// ─── Game ──────────────────────────────────────────────────────────────────

export type GamePhase =
  | 'boot'
  | 'intro'       // page settles, first wave pending
  | 'play'
  | 'cleared'     // all waves done — structures fold down
  | 'turn'        // page-turn animation running
  | 'peel'        // waiting for the player to peel the corner
  | 'crumple'     // hero down: the page crumples into a ball
  | 'drop'        // a fresh page drops onto the desk
  | 'boss'        // page 5 boss choreography (see Boss.phase)
  | 'finale'      // page 6: fold the dragon into a frog
  | 'victory'     // ribbon + confetti, run summary
  | 'rushOver'    // Dragon Rush: the dragon is folded flat, the result card is up (roadmap #16)
  | 'paused'

/**
 * What a run is (roadmap #16): the story (pages in order, stars, checkpoints),
 * or a Dragon Rush — a book's dragon alone, faster, against the clock.
 */
export type GameMode = 'story' | 'dragonRush'

/** `FoldGame.startRun` in its object form. */
export interface RunOptions {
  mode?: GameMode
  book?: BookId
  /** Story only: the page to start on (default 1). */
  page?: PageId
  /** Story only: the score carried in (default 0). */
  score?: number
}

/**
 * The actionable-highlight modes (roadmap #14, `FoldSettings.highlightMode`):
 *   standard — GDD §9's pulsing yellow glow along the outline;
 *   steady   — the same glow at a constant, bright level (no pulsing);
 *   bold     — steady, plus a thick highlight halo edged in ink around the
 *              whole silhouette, readable against pale paper.
 */
export type HighlightMode = 'standard' | 'steady' | 'bold'
export const HIGHLIGHT_MODES: readonly HighlightMode[] = ['standard', 'steady', 'bold']
