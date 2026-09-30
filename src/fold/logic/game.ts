/**
 * FoldGame — the whole of Aethel Fold's rules, headless.
 *
 * Owns: the current page, its folds and tears, the enemy and projectile
 * pools, the hero, the dragon, the wordless lessons, waves, scoring and the
 * page flow (intro → play → cleared → turn | peel | boss → finale → victory,
 * and crumple → drop on defeat).
 *
 * Time: `update(realDt)` advances two clocks. Player-driven motion (dragging,
 * snapping and stamping a fold, tearing, peeling) always runs in real time so
 * the paper answers the finger instantly even while a lesson has slowed the
 * world to a crawl. Everything else (marching, arrows, the dragon) runs in
 * *sim* time = real × timeScale, and freezes completely during hit-stop.
 *
 * Nothing here allocates per frame. Page loads allocate (folds, tears).
 */

import {
  ARCHER_FIRST_SHOT, ARCHER_RATE, ARCHER_WINDUP, ARROW_SPEED, BOSS, BOULDER_FLIGHT, BREACH_Z,
  CATAPULT_FIRST_SHOT, CATAPULT_RATE, CATAPULT_WINDUP, CRUMPLE_TIME, CRUSH_LINGER, ENEMY,
  FLING_RADIUS, FLING_TIME, HERO_HP, HERO_INVULN, HERO_X, HERO_Z, HIT_STOP, LAUNCH_LIFE,
  LAUNCH_SPEED_Y, LAUNCH_SPEED_Z, LESSON_TIME_SCALE, PAGE_CLEAR_DELAY, PAGE_DROP_TIME,
  PAGE_HALF_D, PAGE_HALF_W, PAGE_TURN_TIME, PEEL_COMPLETE, SCORE, SPAWN_Z, TIME_SCALE_RATE, TORN_LINGER,
  FOLD_SNAP_THRESHOLD, LEAPER_HOP_EVERY, LEAPER_HOP_TIME, LEAPER_SHOT_CEILING, LEAPER_VAULT_LAND,
  LEAPER_VAULT_TIME, SLING_COOL, SLING_FLIGHT_BASE, SLING_FLIGHT_PER, SLING_GAIN, SLING_GRAB, SLING_MIN_PULL,
  SLING_RADIUS, SLING_RANGE, BALLISTA_SHOTS, BOLT_PIERCE, BOLT_RADIUS, BOLT_SPEED, ALMOST, DIFFICULTY
} from './config'
import {
  type KindMemory, createKindMemory, difficultyFor, extraPerWave, foldSlowmoOn, noteCrumple, notePageWon,
  resetRunMemory, retryPenalty, shouldEaseBoss
} from './difficulty'
import { EventQueue, KILL_BOLT, KILL_CRUSH, KILL_FLING, KILL_LAUNCH, KILL_RIDGE, KILL_SHOT, KILL_TEAR } from './events'
import {
  FOLD_LOWERED, FOLD_READY, FOLD_SNAPPED, FOLD_SPRUNG, FOLD_STAMPED,
  abandonFold, acrossHinge, alongHinge, createFold, dragFold, grabFold, isBarrier, isGrabbable, isStampable,
  isTrap, onFootprint, releaseFold, revealFold, snapFold, stampFold, updateFold, damageFold
} from './folds'
import {
  MAX_ENEMIES, createEnemyPool, createHero, createProjectilePool, isAlive, resetPools, spawnEnemy,
  spawnProjectile
} from './entities'
import { bossAwake, bossPhaseCode, brokenCount, createBoss, nextWeakPoint, resetBoss } from './boss'
import { LESSON_IDS, clearLesson, createLessonState, lessonCode, setHand } from './lessons'
import { PAGE_COUNT, pageDef } from './pages'
import { starsFor } from './stars'
import { createRng, type Rng } from './rng'
import { G_PAPER, clamp, clamp01, damp, segmentDistance, segmentsCross, v2 } from './math'
import type {
  BookId, BossPhase, Enemy, EnemyType, FoldState, GamePhase, LessonId, PageDef, PageId, SlingState, SpawnDef,
  Stars, TearState
} from './types'

const G = G_PAPER
/** Seconds of play the finale fold animation takes before the ribbon drops. */
export const FINALE_TIME = 2.9
/** Idle seconds before a learned mechanic gets a silent ghost-hand reminder. */
export const IDLE_HINT_AFTER = 6

export interface GameStats {
  launched: number
  crushed: number
  torn: number
  folds: number
  stamps: number
  blocks: number
  knights: number
  brutes: number
  archers: number
  catapults: number
  flung: number
  ridged: number
  runners: number
  leapers: number
  /** Ballista bolts fired, and enemies they pierced. */
  bolts: number
  boltKills: number
  /** Sling stones fired, and enemies they took down. */
  shots: number
  shotKills: number
  /** Origami stars earned on the pages cleared this run (roadmap #1; per-page bests live in the save). */
  stars: number
}

export const emptyStats = (): GameStats => ({
  launched: 0, crushed: 0, torn: 0, folds: 0, stamps: 0, blocks: 0,
  knights: 0, brutes: 0, archers: 0, catapults: 0, flung: 0, ridged: 0,
  runners: 0, leapers: 0, shots: 0, shotKills: 0, bolts: 0, boltKills: 0, stars: 0
})

export interface GameOptions {
  seed?: number
  /** Lessons the player already learned (persisted); those never slow time. */
  learned?: Partial<Record<LessonId, boolean>>
  /** Which book to open (defaults to book 1). */
  book?: BookId
  /** "The book is kind" memory (persisted); the game mutates this object in place. */
  kind?: KindMemory
}

const createTear = (def: PageDef['tears'][number]): TearState => ({
  def, px: def.x, pz: def.z, t: 0, pulling: false, torn: false, active: false, rev: 0
})

export class FoldGame {
  readonly events = new EventQueue()
  readonly rng: Rng
  readonly enemies = createEnemyPool()
  readonly projectiles = createProjectilePool()
  readonly hero = createHero()
  readonly boss = createBoss()
  readonly lesson = createLessonState()
  readonly learned: Record<LessonId, boolean>
  stats: GameStats = emptyStats()

  book: BookId = 1
  pageId: PageId = 1
  page: PageDef = pageDef(1, 1)
  folds: FoldState[] = []
  tears: TearState[] = []
  /** The keep's sling (book 2 pages), or null. */
  sling: SlingState | null = null

  phase: GamePhase = 'boot'
  /** Seconds in the current phase (real time). */
  phaseTime = 0
  private phaseTimer = 0

  // Waves
  waveIndex = 0
  private waveTime = 0
  private waveGap = 0
  private waveCursor = 0
  private waveOrder: SpawnDef[][] = []
  private waveStarted = false
  private sallyTimer = 0

  // Score
  score = 0
  pageStartScore = 0
  combo = 0
  private comboTimer = 0
  hitsThisPage = 0
  runHits = 0
  runTime = 0
  pagesCleared = 0
  /** Stars the last cleared page earned (roadmap #1); also carried as `c` on `pageCleared`. */
  pageStars: Stars = 0
  /** A Try-again continue was taken on this page attempt: caps its rating at ★. */
  continuedThisPage = false

  // Time
  timeScale = 1
  private timeTarget = 1
  hitStop = 0
  paused = false
  /** Seconds since the last player input (real time). */
  idle = 0

  // Page transitions
  peel = 0
  peeling = false
  private peelDone = false
  turnFrom: PageId = 1
  finaleTime = 0
  private bossActed = false
  private pageClearedEmitted = false

  // "Almost!" moment (roadmap #9)
  /** The running crumple is a defeat (Try again offered), not a pause-menu restart. */
  defeated = false
  /** Try-again continues left on this page attempt. */
  continuesLeft: number = ALMOST.continues
  /** Where a drop returns to: a fresh page's intro/boss, or the phase a continue resumes. */
  private dropTo: GamePhase = 'intro'
  private crumpledFrom: GamePhase = 'play'

  // Adaptive difficulty, "the book is kind" (roadmap #8) — invisible to the player.
  /** The persisted memory the knobs below are derived from. */
  kind: KindMemory
  /** Multiplies enemy march speed and wave spawn pacing (sim time). 1 = as authored. */
  difficulty = 1
  /** Extra marchers appended to every wave (perfect streak). */
  extraPerWave = 0
  /** A new column (wave or dragon stomp) arrives: bumps so the fold slow-mo fires once per column. */
  private column = 0
  private slowmoColumn = 0
  /** Real seconds of kind slow-mo left. */
  private kindSlowmo = 0

  constructor(opts: GameOptions = {}) {
    this.rng = createRng(opts.seed ?? 0x5eed)
    this.kind = opts.kind ?? createKindMemory()
    const learned = {} as Record<LessonId, boolean>
    for (const id of LESSON_IDS) learned[id] = !!opts.learned?.[id]
    this.learned = learned
    if (opts.book) this.book = opts.book
  }

  // ─── Run / page lifecycle ────────────────────────────────────────────────

  /** Start a run at `page` (a returning player resumes their saved page). */
  startRun(page: PageId = 1, score = 0, book: BookId = this.book): void {
    this.book = book
    this.score = score
    this.runHits = 0
    this.runTime = 0
    this.pagesCleared = page - 1
    this.pageStars = 0
    this.stats = emptyStats()
    // Page 1 is a new run: the book forgets the crumples (not the streak or the boss ease).
    if (page === 1) resetRunMemory(this.kind)
    resetBoss(this.boss)
    this.loadPage(page)
  }

  loadPage(id: PageId): void {
    this.pageId = id
    this.page = pageDef(this.book, id)
    this.folds = this.page.folds.map(createFold)
    this.tears = this.page.tears.map(createTear)
    const boss = this.page.exit === 'boss'
    if (boss && shouldEaseBoss(this.kind, this.book, id)) this.kind.bossEase = true
    this.difficulty = difficultyFor(this.kind, this.book, id, boss)
    this.extraPerWave = extraPerWave(this.kind)
    this.waveOrder = this.page.waves.map((w) => this.orderWave(w.spawns))
    resetPools(this.enemies, this.projectiles)
    const h = this.hero
    h.hp = HERO_HP
    h.invuln = 0
    h.mood = 'walk'
    h.moodTimer = 0.9
    h.rev++
    this.waveIndex = 0
    this.waveTime = 0
    this.waveCursor = 0
    this.waveStarted = false
    this.waveGap = this.page.introDelay
    this.sallyTimer = this.page.sally?.after ?? 0
    this.pageStartScore = this.score
    this.hitsThisPage = 0
    this.combo = 0
    this.comboTimer = 0
    this.hitStop = 0
    this.timeScale = 1
    this.timeTarget = 1
    this.peel = 0
    this.peeling = false
    this.peelDone = false
    this.finaleTime = 0
    this.pageClearedEmitted = false
    this.defeated = false
    this.continuesLeft = ALMOST.continues
    this.continuedThisPage = false
    this.column = 0
    this.slowmoColumn = 0
    this.kindSlowmo = 0
    const sd = this.page.sling
    this.sling = sd
      ? { def: sd, cool: 0, aiming: false, pullX: 0, pullZ: 0, tx: sd.x, tz: sd.z, shots: 0, rev: (this.sling?.rev ?? 0) + 1 }
      : null
    clearLesson(this.lesson)
    for (const f of this.folds) if (f.def.fromWave === 0) revealFold(f)
    const exit = this.page.exit
    if (exit === 'boss') resetBoss(this.boss)
    if (exit === 'finale') {
      this.boss.phase = 'flat'
      this.boss.collapse = 1
      this.boss.exposed = -1
    }
    this.setPhase(exit === 'boss' ? 'boss' : 'intro')
    this.events.emit('pageIntro', id)
  }

  /** A wave's spawns in time order, plus the perfect-streak extras (page load only: allocates). */
  private orderWave(spawns: readonly SpawnDef[]): SpawnDef[] {
    const order = [...spawns].sort((a, b) => a.at - b.at)
    if (this.extraPerWave <= 0) return order
    let last: SpawnDef | null = null
    for (const s of order) if (s.lane >= 0 && ENEMY[s.type].speed > 0) last = s
    if (!last) return order
    const lanes = Math.max(1, this.page.lanes.length)
    for (let k = 0; k < this.extraPerWave; k++) {
      order.push({ type: last.type, lane: (last.lane + k + 1) % lanes, at: last.at + 0.9 * (k + 1) })
    }
    return order
  }

  /** Throw the page away and restart it (hero down). Score returns to the page start. */
  restartPage(): void {
    this.score = this.pageStartScore
    this.loadPage(this.pageId)
    this.events.emit('pageDrop', this.pageId)
  }

  /** Pause-menu "restart page": crumple this sheet and drop a fresh one. */
  forfeitPage(): void {
    const p = this.phase
    if (p === 'crumple' || p === 'drop' || p === 'turn' || p === 'victory' || p === 'finale' || p === 'boot') return
    this.crumple(false)
  }

  /**
   * The page crumples. A defeat opens the "Almost!" moment: the event carries
   * how close the player was (a = enemies left, or the dragon's unbroken weak
   * points when c = 1), b = 1 offers Try again. Left alone, a fresh page drops
   * after `ALMOST.autoRetry`; a forfeit drops one after the crumple animation.
   */
  private crumple(defeat: boolean): void {
    clearLesson(this.lesson)
    this.defeated = defeat
    this.kindSlowmo = 0
    if (defeat) {
      this.crumpledFrom = this.phase
      noteCrumple(this.kind, this.book, this.pageId)
      // A continue picks up with the kinder pace straight away.
      this.setDifficulty(difficultyFor(this.kind, this.book, this.pageId, this.page.exit === 'boss'))
    }
    this.events.emit('crumple', this.enemiesLeft(), defeat ? 1 : 0, this.page.exit === 'boss' ? 1 : 0)
    this.setPhase('crumple', defeat ? ALMOST.autoRetry : CRUMPLE_TIME)
  }

  /** How far from a clear: enemies alive plus those still to come (the dragon: weak points left). */
  enemiesLeft(): number {
    if (this.page.exit === 'boss') return this.boss.weakPoints.length - brokenCount(this.boss)
    let n = this.aliveCount()
    for (let w = this.waveIndex; w < this.waveOrder.length; w++) {
      const order = this.waveOrder[w]!
      n += w === this.waveIndex && this.waveStarted ? order.length - this.waveCursor : order.length
    }
    return n
  }

  /** Can the Almost! moment's Try again be taken now (the crumpled ball is gone)? */
  canTryAgain(): boolean {
    return !this.paused && this.phase === 'crumple' && this.defeated && this.phaseTime >= CRUMPLE_TIME
  }

  /**
   * Try again: the page drops straight back as it was, with full hearts, at
   * the cost of `ALMOST.penalty` of the points gathered on it. Once the
   * page's continues are spent, it drops a fresh page instead (score back to
   * the page start). Returns true if a page dropped.
   */
  tryAgain(): boolean {
    if (!this.canTryAgain()) return false
    if (this.continuesLeft <= 0) {
      this.dropFresh()
      return true
    }
    this.continuesLeft--
    this.continuedThisPage = true
    const lost = retryPenalty(this.score - this.pageStartScore, ALMOST.penalty)
    this.score -= lost
    const h = this.hero
    h.hp = HERO_HP
    h.invuln = ALMOST.grace
    h.mood = 'walk'
    h.moodTimer = 0.9
    h.rev++
    // Whatever was in the air when the page went is gone with it.
    for (const p of this.projectiles) p.alive = false
    this.combo = 0
    this.comboTimer = 0
    this.hitStop = 0
    this.timeScale = 1
    this.timeTarget = 1
    this.defeated = false
    this.dropTo = this.crumpledFrom
    this.setPhase('drop', PAGE_DROP_TIME)
    this.events.emit('pageDrop', this.pageId, 1, lost)
    return true
  }

  /** A fresh copy of the page drops (the old crumple → restart path). */
  private dropFresh(): void {
    this.restartPage()
    this.dropTo = this.page.exit === 'boss' ? 'boss' : 'intro'
    // restartPage → loadPage set phase intro; keep the drop visible.
    this.setPhase('drop', PAGE_DROP_TIME)
  }

  /** Change the pace scalar; marchers already on the page slow down (or speed up) with it. */
  private setDifficulty(d: number): void {
    if (d === this.difficulty) return
    const k = d / this.difficulty
    for (const e of this.enemies) if (e.state !== 'dead') e.speed *= k
    this.difficulty = d
  }

  private setPhase(p: GamePhase, timer = 0): void {
    this.phase = p
    this.phaseTime = 0
    this.phaseTimer = timer
  }

  // ─── Main tick ───────────────────────────────────────────────────────────

  update(realDtIn: number): void {
    const realDt = Math.min(Math.max(realDtIn, 0), 0.05)
    if (this.paused || this.phase === 'boot') return
    this.phaseTime += realDt
    this.idle += realDt
    if (this.comboTimer > 0) {
      this.comboTimer -= realDt
      if (this.comboTimer <= 0) this.combo = 0
    }
    const playing = this.phase === 'play' || this.phase === 'boss' || this.phase === 'intro' || this.phase === 'finale'
    if (playing) this.runTime += realDt

    // Hit-stop freezes the world *completely* (GDD §5) — folds included.
    if (this.hitStop > 0) {
      this.hitStop -= realDt
      return
    }

    this.timeScale = damp(this.timeScale, this.timeTarget, TIME_SCALE_RATE, realDt)
    if (this.timeTarget === 0 && this.timeScale < 0.01) this.timeScale = 0
    const simDt = realDt * this.timeScale

    this.updateFolds(realDt, simDt)
    this.updateTears(realDt)
    this.updateSling(realDt)

    switch (this.phase) {
      case 'intro':
      case 'play':
        this.updateWaves(simDt)
        this.updateEnemies(simDt)
        this.updateProjectiles(simDt)
        this.updateHero(simDt)
        this.checkPageClear()
        break
      case 'boss':
        this.updateBoss(simDt)
        this.updateEnemies(simDt)
        this.updateProjectiles(simDt)
        this.updateHero(simDt)
        break
      case 'cleared':
        this.updateEnemies(simDt)
        this.updateProjectiles(simDt)
        this.updateHero(simDt)
        this.phaseTimer -= realDt
        if (this.phaseTimer <= 0) this.exitPage()
        break
      case 'turn':
        this.phaseTimer -= realDt
        if (this.phaseTimer <= 0) this.loadPage(Math.min(PAGE_COUNT, this.turnFrom + 1) as PageId)
        break
      case 'peel':
        this.updateHero(simDt)
        if (this.peelDone) {
          this.peel = Math.min(1, this.peel + realDt * 2.2)
          if (this.peel >= 1) {
            this.events.emit('peelDone')
            this.loadPage(Math.min(PAGE_COUNT, this.pageId + 1) as PageId)
          }
        } else if (!this.peeling && this.peel > 0) {
          this.peel = damp(this.peel, 0, 9, realDt)
        }
        break
      case 'crumple':
        this.phaseTimer -= realDt
        if (this.phaseTimer <= 0) this.dropFresh()
        break
      case 'drop':
        this.phaseTimer -= realDt
        if (this.phaseTimer <= 0) this.setPhase(this.dropTo, this.dropTo === 'cleared' ? PAGE_CLEAR_DELAY : 0)
        break
      case 'finale':
        this.finaleTime += realDt
        this.updateHero(simDt)
        if (this.finaleTime >= FINALE_TIME) {
          this.setPhase('victory')
          this.events.emit('victory')
        }
        break
      case 'victory':
        this.updateHero(simDt)
        break
    }

    this.updateKindSlowmo(realDt)
    this.updateLessons(realDt)
  }

  /**
   * After a crumple on this page, the next column to walk onto a ready fold
   * gets half a second of lesson-style slow-mo (sim time only: the fold
   * itself still follows the finger in real time). Once per column.
   */
  private updateKindSlowmo(realDt: number): void {
    if (this.kindSlowmo > 0) {
      this.kindSlowmo -= realDt
      return
    }
    if (this.column === this.slowmoColumn || (this.phase !== 'play' && this.phase !== 'boss')) return
    if (!foldSlowmoOn(this.kind, this.book, this.pageId)) return
    for (let i = 0; i < this.folds.length; i++) {
      const f = this.folds[i]!
      if (!isGrabbable(f)) continue
      for (let j = 0; j < MAX_ENEMIES; j++) {
        const e = this.enemies[j]!
        if (e.state !== 'march' || !onFootprint(f, e.x, e.z, 0)) continue
        this.slowmoColumn = this.column
        this.kindSlowmo = DIFFICULTY.foldSlowmo
        return
      }
    }
  }

  // ─── Folds ───────────────────────────────────────────────────────────────

  private updateFolds(realDt: number, simDt: number): void {
    for (let i = 0; i < this.folds.length; i++) {
      const f = this.folds[i]!
      // Reveal lines introduced by later waves.
      if (f.phase === 'hidden' && this.waveStarted && f.def.fromWave <= this.waveIndex) {
        revealFold(f)
        this.events.emit('foldReady', i)
      }
      const p = f.phase
      const dt = p === 'dragging' || p === 'snapping' || p === 'stamping' || p === 'ready' ? realDt : simDt
      const r = updateFold(f, dt)
      if (r === FOLD_SNAPPED) this.onFoldSnapped(i)
      else if (r === FOLD_STAMPED) this.onFoldStamped(i)
      else if (r === FOLD_LOWERED) this.events.emit('foldLower', i)
      else if (r === FOLD_READY) this.events.emit('foldReady', i)
      else if (r === FOLD_SPRUNG) this.events.emit('foldRelease', i, 0)
    }
  }

  private onFoldSnapped(i: number): void {
    const f = this.folds[i]!
    const k = f.def.kind
    this.stats.folds++
    let launched = 0
    if (k === 'wall') {
      for (let j = 0; j < MAX_ENEMIES; j++) {
        const e = this.enemies[j]!
        if ((e.state !== 'march' && e.state !== 'blocked') || !onFootprint(f, e.x, e.z, 0.18)) continue
        if (ENEMY[e.type].launchable) {
          this.launchEnemy(j, f, true)
          this.kill(j, KILL_LAUNCH, launched++)
          this.stats.launched++
        } else {
          // Too heavy to throw: it staggers against the new wall and stays.
          e.state = 'blocked'
          e.fold = i
          e.cool = ENEMY[e.type].bashRate
          e.windup = 1
        }
      }
    } else if (k === 'valley') {
      for (let j = 0; j < MAX_ENEMIES; j++) {
        const e = this.enemies[j]!
        if ((e.state !== 'march' && e.state !== 'blocked') || !onFootprint(f, e.x, e.z, 0.1)) continue
        e.state = 'trapped'
        e.fold = i
        e.age = 0
      }
    } else if (k === 'launch') {
      for (let j = 0; j < MAX_ENEMIES; j++) {
        const e = this.enemies[j]!
        if ((e.state !== 'march' && e.state !== 'blocked' && e.state !== 'stand') || !onFootprint(f, e.x, e.z, 0.2)) continue
        this.launchEnemy(j, f, false)
        launched++
        this.stats.flung++
      }
    } else if (k === 'ridge') {
      for (let j = 0; j < MAX_ENEMIES; j++) {
        const e = this.enemies[j]!
        if ((e.state !== 'march' && e.state !== 'blocked') || !onFootprint(f, e.x, e.z, 0.12)) continue
        e.state = 'swept'
        e.age = 0
        const side = e.x >= f.cx ? 1 : -1
        e.vx = side * this.rng.range(2.2, 3.4)
        e.vy = this.rng.range(3.5, 5)
        e.vz = this.rng.range(-0.8, 0.8)
        this.kill(j, KILL_RIDGE, launched++)
        this.stats.ridged++
      }
    } else if (k === 'ballista') {
      // Flipped open: loaded with bolts, aimed straight up the page.
      f.ammo = BALLISTA_SHOTS
      f.aimX = f.cx
      f.aimZ = -PAGE_HALF_D
    } else if (k === 'frog') {
      this.finaleTime = 0
      this.setPhase('finale')
      this.award(SCORE.frog, f.cx, f.cz, 1)
      this.events.emit('frog')
    }
    this.events.emit('foldSnap', i, launched, 0, f.cx, f.cz)
    this.lessonEvent('snap', i)
  }

  private onFoldStamped(i: number): void {
    const f = this.folds[i]!
    let crushed = 0
    let heavy = 0
    for (let j = 0; j < MAX_ENEMIES; j++) {
      const e = this.enemies[j]!
      const st = e.state
      if (st !== 'march' && st !== 'blocked' && st !== 'trapped') continue
      const hit = st === 'trapped' ? e.fold === i : onFootprint(f, e.x, e.z, 0.25)
      if (!hit) continue
      if (ENEMY[e.type].hitStop) heavy++
      e.state = 'crushed'
      e.age = 0
      e.y = 0
      this.kill(j, KILL_CRUSH, crushed++)
      this.stats.crushed++
    }
    this.stats.stamps++
    if (heavy > 0) this.hitStop = HIT_STOP
    this.events.emit('foldStamp', i, crushed, heavy > 0 ? 1 : 0, f.cx, f.cz)
    this.lessonEvent('stamp', i)
  }

  // ─── Player input API (called by the gesture layer) ──────────────────────

  private touched(): void {
    this.idle = 0
    if (this.lesson.hint) clearLesson(this.lesson)
  }

  /** Best ready fold near a page-space point, or -1. */
  pickFold(x: number, z: number, reach = 1.05): number {
    if (!this.acceptsInput()) return -1
    let best = -1
    let bestCost = Infinity
    for (let i = 0; i < this.folds.length; i++) {
      const f = this.folds[i]!
      if (!isGrabbable(f)) continue
      const s = alongHinge(f, x, z)
      const d = acrossHinge(f, x, z)
      const k = f.def.kind
      const dLo = k === 'valley' || k === 'ridge' ? -f.def.depth : -0.35
      const dHi = f.def.depth
      const ds = s < 0 ? -s : s > f.len ? s - f.len : 0
      const dd = d < dLo ? dLo - d : d > dHi ? d - dHi : 0
      const dist = Math.sqrt(ds * ds + dd * dd)
      if (dist > reach) continue
      // Prefer the line the finger is *on*, then the closer centre.
      const cost = dist * 4 + Math.abs(s - f.len / 2) / f.len * 0.2
      if (cost < bestCost) {
        bestCost = cost
        best = i
      }
    }
    return best
  }

  /** All ready folds under a point (for direction-disambiguated grabs). Writes indices into `out`. */
  foldsNear(x: number, z: number, out: number[], reach = 1.05): number {
    out.length = 0
    if (!this.acceptsInput()) return 0
    for (let i = 0; i < this.folds.length; i++) {
      const f = this.folds[i]!
      if (!isGrabbable(f)) continue
      const s = alongHinge(f, x, z)
      const d = acrossHinge(f, x, z)
      const k = f.def.kind
      const dLo = k === 'valley' || k === 'ridge' ? -f.def.depth : -0.35
      const ds = s < 0 ? -s : s > f.len ? s - f.len : 0
      const dd = d < dLo ? dLo - d : d > f.def.depth ? d - f.def.depth : 0
      if (Math.sqrt(ds * ds + dd * dd) <= reach) out.push(i)
    }
    return out.length
  }

  grab(i: number): boolean {
    const f = this.folds[i]
    if (!f || !this.acceptsInput()) return false
    this.touched()
    if (!grabFold(f)) return false
    this.events.emit('foldGrab', i)
    return true
  }

  drag(i: number, progress: number): void {
    const f = this.folds[i]
    if (!f) return
    this.idle = 0
    dragFold(f, progress)
    this.events.emit('foldDrag', i, f.drag)
  }

  /** Drop a drag without judging it (the gesture was cancelled). */
  abandon(i: number): void {
    const f = this.folds[i]
    if (!f || f.phase !== 'dragging') return
    abandonFold(f)
    this.events.emit('foldRelease', i, f.drag)
  }

  release(i: number, speed = 0): boolean {
    const f = this.folds[i]
    if (!f) return false
    const snapped = releaseFold(f, speed)
    if (!snapped) this.events.emit('foldRelease', i, f.drag)
    return snapped
  }

  /** Keyboard / accessibility / tests: fold a line in one go. */
  foldNow(i: number): boolean {
    const f = this.folds[i]
    if (!f || !this.acceptsInput()) return false
    this.touched()
    return snapFold(f)
  }

  /** A tap on the page: stamp whatever raised structure is under it. */
  tap(x: number, z: number): boolean {
    if (!this.acceptsInput()) return false
    this.touched()
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < this.folds.length; i++) {
      const f = this.folds[i]!
      if (!isStampable(f)) continue
      const s = alongHinge(f, x, z)
      if (s < -0.5 || s > f.len + 0.5) continue
      const d = acrossHinge(f, x, z)
      const lo = f.def.kind === 'valley' ? -f.def.depth - 0.55 : -1.0
      const hi = f.def.depth + 0.6
      if (d < lo || d > hi) continue
      const dd = Math.abs(d - (lo + hi) / 2)
      if (dd < bestD) {
        bestD = dd
        best = i
      }
    }
    if (best >= 0) return this.stamp(best)
    // Nothing to stamp: an open ballista shoots where the finger tapped.
    if (this.fireBallista(x, z)) return true
    this.events.emit('tap', 0, 0, 0, x, z)
    return false
  }

  /** Open ballista with bolts left, nearest to `x` (the tapped side), or -1. */
  armedBallista(x: number): number {
    let best = -1
    let bd = Infinity
    for (let i = 0; i < this.folds.length; i++) {
      const f = this.folds[i]!
      if (f.def.kind !== 'ballista' || f.phase !== 'up' || f.ammo <= 0) continue
      const d = Math.abs(f.cx - x)
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return best
  }

  /** Loose a bolt from an open ballista toward (x, z). Returns true if one flew. */
  fireBallista(x: number, z: number): boolean {
    if (!this.acceptsInput()) return false
    const i = this.armedBallista(x)
    if (i < 0) return false
    const f = this.folds[i]!
    // Only up the page: a tap behind the tower means nothing.
    const x0 = f.cx
    const z0 = f.cz - 0.2
    if (z > z0 - 0.6) return false
    this.touched()
    let dx = x - x0
    let dz = z - z0
    const d = Math.hypot(dx, dz)
    dx /= d
    dz /= d
    // Fly on past the tap to the page's edge: bolts pierce.
    const slot = spawnProjectile(
      this.projectiles, 'bolt', x0, 1.25, z0, dx * BOLT_SPEED, 0, dz * BOLT_SPEED, x, z, 16 / BOLT_SPEED, i
    )
    f.ammo--
    f.aimX = x
    f.aimZ = z
    f.flash = 1
    // The last bolt is away: fold back down after a beat, then cool down.
    if (f.ammo <= 0) f.timer = 0.35
    this.stats.bolts++
    this.events.emit('ballistaFire', i, slot, 0, x, z)
    this.lessonEvent('bolt', i)
    return true
  }

  stamp(i: number): boolean {
    const f = this.folds[i]
    if (!f || !this.acceptsInput()) return false
    this.touched()
    return stampFold(f)
  }

  /** Nearest pullable tear or exposed core weak point: returns tear index, or -2 for the boss weak point, or -1. */
  pickTear(x: number, z: number, reach = 0.5): number {
    if (!this.acceptsInput()) return -1
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < this.tears.length; i++) {
      const t = this.tears[i]!
      if (!t.active || t.torn) continue
      const d = Math.hypot(t.px - x, t.pz - z) - t.def.radius
      if (d < reach && d < bestD) {
        bestD = d
        best = i
      }
    }
    if (best < 0 && this.boss.exposed >= 0) {
      const w = this.boss.weakPoints[this.boss.exposed]!
      if (w.mode === 'core' && Math.hypot(w.x - x, w.z - z) < 1.45 + reach) return -2
    }
    return best
  }

  /** Pull a tear (or the exposed core weak point with index -2) to `progress` (0…1). */
  pullTear(i: number, progress: number): void {
    this.touched()
    if (i === -2) {
      this.pullWeak(progress)
      return
    }
    const t = this.tears[i]
    if (!t || !t.active || t.torn) return
    if (!t.pulling) {
      t.pulling = true
      this.events.emit('tearPull', i, 0)
    }
    t.t = Math.max(t.t * 0.5, clamp01(progress))
    this.events.emit('tearPull', i, t.t)
    if (t.t >= 1) this.completeTear(i)
  }

  releaseTear(i: number): void {
    if (i === -2) {
      this.releaseWeak()
      return
    }
    const t = this.tears[i]
    if (!t || t.torn) return
    t.pulling = false
    this.events.emit('tearRelease', i)
  }

  /** Exposed crease weak point near a point (swipe mode), or -1. */
  pickCrease(x: number, z: number): number {
    if (!this.acceptsInput() || this.boss.exposed < 0) return -1
    const w = this.boss.weakPoints[this.boss.exposed]!
    if (w.mode !== 'crease') return -1
    return Math.hypot(w.x - x, w.z - z) < 1.7 ? this.boss.exposed : -1
  }

  pullWeak(progress: number): void {
    const b = this.boss
    if (b.exposed < 0) return
    this.idle = 0
    const w = b.weakPoints[b.exposed]!
    w.t = clamp01(progress)
    if (w.mode === 'core' && w.t >= 1) this.breakWeak()
  }

  releaseWeak(): void {
    const b = this.boss
    if (b.exposed < 0) return
    const w = b.weakPoints[b.exposed]!
    if (w.mode === 'crease' && w.t >= FOLD_SNAP_THRESHOLD) this.breakWeak()
    else w.t = 0
  }

  /** Peel region: the dog-eared bottom-right corner. */
  pickPeel(x: number, z: number): boolean {
    return this.phase === 'peel' && !this.peelDone && x > 1.6 && z > 3.2
  }

  peelDrag(progress: number): void {
    if (this.phase !== 'peel' || this.peelDone) return
    this.touched()
    if (!this.peeling) {
      this.peeling = true
      this.events.emit('peelStart')
    }
    this.peel = clamp01(progress)
    if (this.peel >= 0.97) this.finishPeel()
  }

  peelRelease(): void {
    if (this.phase !== 'peel' || this.peelDone) return
    this.peeling = false
    if (this.peel >= PEEL_COMPLETE) this.finishPeel()
  }

  private finishPeel(): void {
    if (this.peelDone) return
    this.peelDone = true
    this.peeling = false
    this.pagesCleared = Math.max(this.pagesCleared, 4)
    this.lessonEvent('peel', 0)
  }

  // ─── Sling (book 2) ──────────────────────────────────────────────────────

  /** Is a finger at (x, z) on the loaded sling's cup? */
  pickSling(x: number, z: number): boolean {
    const s = this.sling
    // (While the corner is to be peeled, a drag down there is the peel.)
    if (!s || s.cool > 0 || !this.acceptsInput() || this.phase === 'peel') return false
    return Math.hypot(x - s.def.x, z - s.def.z) <= SLING_GRAB
  }

  grabSling(): boolean {
    const s = this.sling
    if (!s || s.cool > 0 || !this.acceptsInput()) return false
    this.touched()
    s.aiming = true
    s.pullX = 0
    s.pullZ = 0
    s.tx = s.def.x
    s.tz = s.def.z
    this.events.emit('slingGrab', 0, 0, 0, s.def.x, s.def.z)
    return true
  }

  /** The finger has pulled the cup back by (px, pz) page units; aim the other way. */
  aimSling(px: number, pz: number): void {
    const s = this.sling
    if (!s || !s.aiming) return
    this.idle = 0
    s.pullX = px
    s.pullZ = pz
    let dx = -px * SLING_GAIN
    let dz = -pz * SLING_GAIN
    const d = Math.hypot(dx, dz)
    if (d > SLING_RANGE) {
      dx *= SLING_RANGE / d
      dz *= SLING_RANGE / d
    }
    s.tx = clamp(s.def.x + dx, -PAGE_HALF_W + 0.25, PAGE_HALF_W - 0.25)
    s.tz = clamp(s.def.z + dz, -PAGE_HALF_D + 0.25, BREACH_Z - 0.2)
  }

  /** Is the current pull enough to shoot? (The view dims the aim when not.) */
  slingArmed(): boolean {
    const s = this.sling
    return !!s && s.aiming && Math.hypot(s.pullX, s.pullZ) >= SLING_MIN_PULL
  }

  /** Let go: fire if pulled far enough. Returns true if a stone flew. */
  releaseSling(): boolean {
    const s = this.sling
    if (!s || !s.aiming) return false
    const armed = this.slingArmed()
    s.aiming = false
    if (!armed || !this.acceptsInput()) {
      s.pullX = s.pullZ = 0
      this.events.emit('slingCancel')
      return false
    }
    const x0 = s.def.x
    const z0 = s.def.z
    const y0 = 0.9
    const T = SLING_FLIGHT_BASE + Math.hypot(s.tx - x0, s.tz - z0) * SLING_FLIGHT_PER
    const slot = spawnProjectile(
      this.projectiles, 'shot', x0, y0, z0,
      (s.tx - x0) / T, (0.12 - y0) / T + 0.5 * G * T, (s.tz - z0) / T, s.tx, s.tz, T, -1
    )
    s.cool = SLING_COOL
    s.shots++
    s.rev++
    s.pullX = s.pullZ = 0
    this.stats.shots++
    this.events.emit('slingFire', slot, 0, 0, s.tx, s.tz)
    this.lessonEvent('shot', slot)
    return true
  }

  cancelSling(): void {
    const s = this.sling
    if (!s || !s.aiming) return
    s.aiming = false
    s.pullX = s.pullZ = 0
    this.events.emit('slingCancel')
  }

  private updateSling(realDt: number): void {
    const s = this.sling
    if (!s || s.cool <= 0) return
    // Reloading is the player's own machine: real time, like a fold.
    s.cool -= realDt
    if (s.cool <= 0) {
      s.cool = 0
      s.rev++
      this.events.emit('slingReady', 0, 0, 0, s.def.x, s.def.z)
    }
  }

  /** A sling stone lands: everyone on the ground under it is torn to confetti. */
  private slingImpact(x: number, z: number): void {
    let n = 0
    for (let j = 0; j < MAX_ENEMIES; j++) {
      const e = this.enemies[j]!
      if (!isAlive(e)) continue
      if (e.state === 'leap' && e.y > LEAPER_SHOT_CEILING) continue
      if (Math.hypot(e.x - x, e.z - z) > SLING_RADIUS + ENEMY[e.type].radius * 0.5) continue
      e.state = 'torn'
      e.age = 0
      e.y = 0
      this.kill(j, KILL_SHOT, n++)
    }
    this.stats.shotKills += n
    this.events.emit('impact', -1, 5, n, x, z)
    // The dragon can be pelted too.
    const b = this.boss
    if (b.exposed >= 0 && b.phase === 'exposed') {
      // A stone on the exposed weak point breaks it.
      const w = b.weakPoints[b.exposed]!
      if (Math.hypot(w.x - x, w.z - z) < SLING_RADIUS + 0.55) {
        this.award(SCORE.slingWeak, w.x, w.z, 1)
        this.breakWeak()
        return
      }
    }
    if (this.page.exit === 'boss' && bossAwake(b) && b.phase !== 'exposed' && b.phase !== 'hurt' &&
      Math.hypot(x - BOSS.bodyX, z - BOSS.bodyZ) < BOSS.bodyRadius) {
      // A body hit: it flinches. Mid fire-breath charge, it chokes on it;
      // every few hits it rears up and bares its next weak point.
      b.slingHits++
      this.award(SCORE.slingBody, x, z, 1)
      const choked = b.phase === 'breathCharge'
      this.events.emit('bossHit', 0, b.slingHits, choked ? 1 : 0, x, z)
      if (b.slingHits >= BOSS.slingHitsToExpose) {
        b.slingHits = 0
        this.exposeWeakPoint()
      } else if (choked) {
        this.setBossPhase('idle', this.rng.range(BOSS.idleMin, BOSS.idleMax) * this.bossPace())
      }
    }
  }

  acceptsInput(): boolean {
    if (this.paused) return false
    const p = this.phase
    return p === 'intro' || p === 'play' || p === 'boss' || p === 'peel' || p === 'cleared'
  }

  // ─── Waves ───────────────────────────────────────────────────────────────

  private updateWaves(dt: number): void {
    const waves = this.page.waves
    if (this.phase === 'intro') {
      this.waveGap -= dt
      if (this.waveGap <= 0) {
        this.setPhase('play')
        this.startWave(0)
      }
      return
    }
    if (this.waveIndex >= waves.length) return
    // The book is kind: a slower pace stretches the spawn intervals too.
    const paced = dt * this.difficulty
    if (!this.waveStarted) {
      this.waveGap -= paced
      if (this.waveGap <= 0) this.startWave(this.waveIndex)
      return
    }
    this.waveTime += paced
    const order = this.waveOrder[this.waveIndex]!
    while (this.waveCursor < order.length && order[this.waveCursor]!.at <= this.waveTime) {
      this.spawnFrom(order[this.waveCursor]!)
      this.waveCursor++
    }
    this.updateSally(paced)
    if (this.waveCursor >= order.length && this.mobileAlive() === 0 && !this.shotInFlight()) {
      // Next wave after a breath.
      this.waveIndex++
      this.waveStarted = false
      if (this.waveIndex < waves.length) this.waveGap = waves[this.waveIndex]!.delay
    }
  }

  private shotInFlight(): boolean {
    for (const p of this.projectiles) if (p.alive && p.type === 'shot') return true
    return false
  }

  private startWave(index: number): void {
    this.waveIndex = index
    this.waveTime = 0
    this.waveCursor = 0
    this.waveStarted = true
    this.column++
    this.events.emit('waveStart', index)
  }

  private updateSally(dt: number): void {
    const s = this.page.sally
    if (!s) return
    const gate = this.tears.find((t) => t.def.id === s.untilTorn)
    if (!gate || gate.torn) return
    this.sallyTimer -= dt
    if (this.sallyTimer > 0) return
    this.sallyTimer = s.every
    for (let k = 0; k < s.count; k++) {
      const lane = k % Math.max(1, this.page.lanes.length)
      const slot = spawnEnemy(this.enemies, 'knight', s.x + (k - (s.count - 1) / 2) * 0.5, s.z, lane, this.rng.range(-0.3, 0.3))
      if (slot >= 0) {
        this.primeSpawn(slot)
        this.events.emit('spawn', slot)
      }
    }
  }

  private spawnFrom(sd: SpawnDef): void {
    let x: number
    let z: number
    if (sd.lane >= 0 && this.page.lanes[sd.lane]) {
      z = this.page.spawnZ ?? SPAWN_Z
      x = this.laneX(sd.lane, z)
    } else {
      x = sd.x ?? 0
      z = sd.z ?? SPAWN_Z
    }
    // A shooter posted on a structure that is already torn has nowhere to stand.
    if (sd.lane < 0) {
      for (const t of this.tears) if (t.torn && Math.hypot(t.def.x - x, t.def.z - z) < t.def.radius + 0.75) return
      // …and a post that's still manned isn't re-manned (catapult barrages).
      for (const o of this.enemies) if (o.state === 'stand' && o.type === sd.type && Math.hypot(o.x - x, o.z - z) < 0.8) return
    }
    const jitter = sd.lane >= 0 ? this.rng.range(-0.32, 0.32) : 0
    const slot = spawnEnemy(this.enemies, sd.type, x + jitter, z, sd.lane, jitter)
    if (slot < 0) return
    const e = this.enemies[slot]!
    if (e.state === 'stand') {
      const first = e.type === 'archer' ? ARCHER_FIRST_SHOT : CATAPULT_FIRST_SHOT
      e.cool = first + this.rng.range(0, 1.6)
    }
    this.primeSpawn(slot)
    this.events.emit('spawn', slot)
  }

  /** Per-spawn setup: the book's pace, and leapers wait a moment before their first hop. */
  private primeSpawn(slot: number): void {
    const e = this.enemies[slot]!
    e.speed *= this.difficulty
    if (e.type === 'leaper') e.cool = LEAPER_HOP_EVERY * this.rng.range(0.7, 1.2)
  }

  /** Marching enemies alive (stationary shooters don't hold a wave back). */
  mobileAlive(): number {
    let n = 0
    for (const e of this.enemies) if (e.state === 'march' || e.state === 'blocked' || e.state === 'trapped' || e.state === 'leap') n++
    return n
  }

  aliveCount(): number {
    let n = 0
    for (const e of this.enemies) if (isAlive(e)) n++
    return n
  }

  /** Lane centre x at a given z (linear along the lane polyline). */
  laneX(lane: number, z: number): number {
    const l = this.page.lanes[lane]
    if (!l) return 0
    const p = l.points
    if (z <= p[1]!) return p[0]!
    for (let i = 2; i < p.length; i += 2) {
      const z1 = p[i + 1]!
      if (z <= z1) {
        const z0 = p[i - 1]!
        const t = (z - z0) / (z1 - z0 || 1)
        return p[i - 2]! + (p[i]! - p[i - 2]!) * t
      }
    }
    return p[p.length - 2]!
  }

  private checkPageClear(): void {
    if (this.phase !== 'play') return
    if (this.page.exit !== 'turn' && this.page.exit !== 'peel') return
    if (this.waveIndex < this.page.waves.length) return
    if (this.aliveCount() > 0) return
    for (const t of this.tears) if (!t.torn) return
    this.pageCleared()
  }

  private pageCleared(): void {
    if (this.pageClearedEmitted) return
    this.pageClearedEmitted = true
    const perfect = this.hitsThisPage === 0
    if (perfect) this.award(SCORE.perfectPage, 0, 0, 1)
    const stars = this.ratePage()
    notePageWon(this.kind, this.book, this.pageId, perfect, false)
    this.pagesCleared = Math.max(this.pagesCleared, this.pageId)
    // Fold every raised pop-up back into the page (pop-up books close flat).
    for (const f of this.folds) {
      if (f.phase === 'up') f.phase = 'lowering'
      else if (f.phase === 'dragging') f.phase = 'ready'
    }
    this.hero.mood = 'cheer'
    this.hero.moodTimer = 2
    this.events.emit('pageCleared', this.pageId, perfect ? 1 : 0, stars)
    this.setPhase('cleared', PAGE_CLEAR_DELAY)
  }

  /**
   * Rate the page just cleared (after its perfect bonus is banked): hearts
   * lost, the points gathered on it against its par, and whether a Try-again
   * continue was used. See `stars.ts`.
   */
  private ratePage(): Stars {
    const stars = starsFor(this.hitsThisPage, this.score - this.pageStartScore, this.page.par, this.continuedThisPage)
    this.pageStars = stars
    this.stats.stars += stars
    return stars
  }

  private exitPage(): void {
    if (this.page.exit === 'peel') {
      this.setPhase('peel')
      return
    }
    this.turnFrom = this.pageId
    this.setPhase('turn', PAGE_TURN_TIME)
    this.events.emit('pageTurn', this.pageId, Math.min(PAGE_COUNT, this.pageId + 1))
  }

  // ─── Enemies ─────────────────────────────────────────────────────────────

  private updateEnemies(dt: number): void {
    if (dt <= 0) return
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const e = this.enemies[i]!
      if (e.state === 'dead') continue
      e.age += dt
      switch (e.state) {
        case 'march':
          this.march(e, i, dt)
          break
        case 'blocked':
          this.blocked(e, i, dt)
          break
        case 'trapped':
          this.trapped(e, dt)
          break
        case 'launched':
          this.flying(e, i, dt)
          break
        case 'leap':
          this.leaping(e, i, dt)
          break
        case 'swept':
          e.vy -= G * dt
          e.x += e.vx * dt
          e.y += e.vy * dt
          e.z += e.vz * dt
          e.spin += dt * 11
          if (e.age > 0.9) e.state = 'dead'
          break
        case 'stand':
          this.shooter(e, i, dt)
          break
        case 'crushed':
          if (e.age > CRUSH_LINGER) e.state = 'dead'
          break
        case 'torn':
          if (e.age > TORN_LINGER) e.state = 'dead'
          break
        case 'breached':
          e.z += dt * 0.6
          if (e.age > 0.45) e.state = 'dead'
          break
      }
    }
  }

  private march(e: Enemy, i: number, dt: number): void {
    const tune = ENEMY[e.type]
    this.rerouteAroundRidges(e)
    const leaper = e.type === 'leaper'
    if (leaper) {
      // Zig-zag: every so often, hop across to a neighbouring lane.
      e.cool -= dt
      if (e.cool <= 0 && e.z > SPAWN_Z + 1.4 && e.z < BREACH_Z - 1.6) {
        this.hopLane(e, i)
        return
      }
    }
    const targetX = clamp(this.laneX(e.lane, e.z) + e.tx, -PAGE_HALF_W + 0.4, PAGE_HALF_W - 0.4)
    const nz = e.z + e.speed * dt
    const nx = damp(e.x, targetX, 2.4, dt)
    // Walls stop the march.
    for (let k = 0; k < this.folds.length; k++) {
      const f = this.folds[k]!
      if (f.def.kind !== 'wall' || !isBarrier(f)) continue
      const s = alongHinge(f, nx, nz)
      if (s < -tune.radius * 0.6 || s > f.len + tune.radius * 0.6) continue
      const dNow = acrossHinge(f, e.x, e.z)
      const dNext = acrossHinge(f, nx, nz)
      if (dNow >= -0.05 && dNext < tune.radius) {
        if (leaper) {
          // Springs coil… and it vaults clean over the wall.
          this.vault(e, i, f, dNow)
          return
        }
        e.state = 'blocked'
        e.fold = k
        e.cool = tune.bashRate * 0.6
        e.age = 0
        return
      }
    }
    // Don't walk through whoever is stuck in front: queue up and fan out.
    if (this.crowdedAhead(e, i, nx, nz, tune.radius)) {
      e.x = damp(e.x, e.x + (e.tx >= 0 ? 0.6 : -0.6), 1.5, dt)
      e.phase += dt * 2
      return
    }
    e.phase += (nz - e.z) * 5.2 + Math.abs(nx - e.x) * 3
    e.x = nx
    e.z = nz
    if (e.z >= BREACH_Z) this.breach(i)
  }

  /** Ballistic hop to (x, z), landing after `T` seconds. */
  private leapTo(e: Enemy, x: number, z: number, T: number): void {
    e.state = 'leap'
    e.vx = (x - e.x) / T
    e.vz = (z - e.z) / T
    e.vy = 0.5 * G * T
    e.y = 0
    e.fold = -1
    e.windup = 0
  }

  private hopLane(e: Enemy, i: number): void {
    const n = this.page.lanes.length
    let lane = e.lane
    if (n > 1) {
      lane = e.lane + (this.rng.next() < 0.5 ? -1 : 1)
      if (lane < 0) lane = 1
      if (lane >= n) lane = n - 2
    }
    const z = e.z + 0.9
    e.lane = lane
    this.leapTo(e, clamp(this.laneX(lane, z) + e.tx * 0.5, -PAGE_HALF_W + 0.4, PAGE_HALF_W - 0.4), z, LEAPER_HOP_TIME)
    this.events.emit('leap', i, 0, 0, e.x, e.z)
  }

  private vault(e: Enemy, i: number, f: FoldState, dNow: number): void {
    const push = -LEAPER_VAULT_LAND - dNow
    const z = e.z + f.nz * push
    const x = clamp(e.x + f.nx * push, -PAGE_HALF_W + 0.4, PAGE_HALF_W - 0.4)
    this.leapTo(e, x, z, LEAPER_VAULT_TIME)
    this.events.emit('leap', i, 0, 1, e.x, e.z)
  }

  private leaping(e: Enemy, i: number, dt: number): void {
    e.vy -= G * dt
    e.x += e.vx * dt
    e.y += e.vy * dt
    e.z += e.vz * dt
    e.phase += dt * 4
    if (e.y > 0 || e.vy >= 0) return
    // Landed.
    e.y = 0
    e.vx = e.vy = e.vz = 0
    e.state = 'march'
    e.age = 1
    e.cool = LEAPER_HOP_EVERY * this.rng.range(0.8, 1.25)
    // Straight into a raised ravine: caught.
    for (let k = 0; k < this.folds.length; k++) {
      const f = this.folds[k]!
      if (isTrap(f) && onFootprint(f, e.x, e.z, 0)) {
        e.state = 'trapped'
        e.fold = k
        e.age = 0
        return
      }
    }
    if (e.z >= BREACH_Z) this.breach(i)
  }

  private crowdedAhead(e: Enemy, i: number, nx: number, nz: number, r: number): boolean {
    for (let j = 0; j < MAX_ENEMIES; j++) {
      if (j === i) continue
      const o = this.enemies[j]!
      const st = o.state
      if (st !== 'blocked' && st !== 'trapped' && st !== 'march') continue
      if (o.z <= e.z) continue
      const rr = r + ENEMY[o.type].radius
      if (o.z - nz < rr * 0.8 && Math.abs(o.x - nx) < rr * 0.7) {
        // Only yield to someone who isn't also walking away at the same pace.
        if (st !== 'march' || o.z - nz < rr * 0.45) return true
      }
    }
    return false
  }

  private rerouteAroundRidges(e: Enemy): void {
    for (let k = 0; k < this.folds.length; k++) {
      const f = this.folds[k]!
      if (f.def.kind !== 'ridge' || !isBarrier(f)) continue
      if (e.z > f.cz - f.def.depth - 0.25) continue
      const lx = this.laneX(e.lane, f.cz)
      if (lx < f.def.ax - 0.6 || lx > f.def.bx + 0.6) continue
      // Find the nearest lane that passes the ridge.
      let best = -1
      let bestD = Infinity
      for (let l = 0; l < this.page.lanes.length; l++) {
        const x = this.laneX(l, f.cz)
        if (x >= f.def.ax - 0.6 && x <= f.def.bx + 0.6) continue
        const d = Math.abs(x - e.x)
        if (d < bestD) {
          bestD = d
          best = l
        }
      }
      if (best >= 0) e.lane = best
    }
  }

  private blocked(e: Enemy, _i: number, dt: number): void {
    const f = this.folds[e.fold]
    if (!f || !isBarrier(f)) {
      e.state = 'march'
      e.fold = -1
      return
    }
    const tune = ENEMY[e.type]
    e.windup = Math.max(0, e.windup - dt * 3)
    e.phase += dt * 1.5
    // Keep a hand's breadth off the paper so bashes read.
    const d = acrossHinge(f, e.x, e.z)
    if (d < tune.radius) {
      e.x += f.nx * (tune.radius - d)
      e.z += f.nz * (tune.radius - d)
    }
    e.cool -= dt
    if (e.cool <= 0) {
      e.cool = tune.bashRate
      e.windup = 1
      if (tune.bash > 0 && damageFold(f, tune.bash)) this.events.emit('foldBreak', e.fold)
    }
  }

  private trapped(e: Enemy, dt: number): void {
    const f = this.folds[e.fold]
    if (!f) {
      e.state = 'march'
      return
    }
    if (!isTrap(f) && f.phase !== 'stamping') {
      e.state = 'march'
      e.fold = -1
      return
    }
    // Slide down into the crease and flail.
    const d = acrossHinge(f, e.x, e.z)
    const nd = damp(d, 0, 5, dt)
    e.x += f.nx * (nd - d)
    e.z += f.nz * (nd - d)
    e.phase += dt * 9
  }

  private launchEnemy(j: number, f: FoldState, towardLens: boolean): void {
    const e = this.enemies[j]!
    e.state = 'launched'
    e.age = 0
    e.towardLens = towardLens
    e.fold = -1
    if (towardLens) {
      e.vy = LAUNCH_SPEED_Y * this.rng.range(0.9, 1.1)
      e.vz = LAUNCH_SPEED_Z * this.rng.range(0.85, 1.15)
      e.vx = (e.x - f.cx) * 0.9 + this.rng.range(-0.6, 0.6)
      e.spin = this.rng.range(0, 6)
      return
    }
    // Flung back up the page: solve a ballistic arc to the landing point.
    const d = acrossHinge(f, e.x, e.z)
    const landZ = f.def.az - d - (e.type === 'catapult' ? 1.9 : this.rng.range(1.6, 3.2))
    const landX = e.x + (e.type === 'catapult' ? 0 : this.rng.range(-0.8, 0.8))
    const T = FLING_TIME
    e.vx = (landX - e.x) / T
    e.vz = (landZ - e.z) / T
    e.vy = 0.5 * G * T
    e.y = 0
    e.tx = landX
  }

  private flying(e: Enemy, i: number, dt: number): void {
    e.vy -= G * dt
    e.x += e.vx * dt
    e.y += e.vy * dt
    e.z += e.vz * dt
    e.spin += dt * (e.towardLens ? 10 : 7)
    if (e.towardLens) {
      if (e.age >= LAUNCH_LIFE) {
        this.events.emit('lensHit', i, 0, 0, e.x, e.z)
        e.state = 'dead'
      }
      return
    }
    if (e.y <= 0 && e.vy < 0) {
      e.y = 0
      this.events.emit('impact', i, e.type === 'catapult' ? 2 : 1, 0, e.x, e.z)
      if (e.type === 'catapult') {
        // The catapult crashes down onto whoever it lands on.
        let n = 0
        for (let j = 0; j < MAX_ENEMIES; j++) {
          if (j === i) continue
          const o = this.enemies[j]!
          if (!isAlive(o)) continue
          if (Math.hypot(o.x - e.x, o.z - e.z) > FLING_RADIUS) continue
          o.state = 'torn'
          o.age = 0
          this.kill(j, KILL_FLING, ++n)
        }
      }
      e.state = 'torn'
      e.age = 0
      this.kill(i, KILL_FLING, 0)
    }
  }

  private shooter(e: Enemy, i: number, dt: number): void {
    e.cool -= dt
    const windup = e.type === 'archer' ? ARCHER_WINDUP : CATAPULT_WINDUP
    e.windup = e.cool < windup ? clamp01(1 - e.cool / windup) : 0
    if (e.cool > 0) return
    e.cool = (e.type === 'archer' ? ARCHER_RATE : CATAPULT_RATE) + this.rng.range(-0.6, 0.9)
    e.windup = 0
    const tx = HERO_X + this.rng.range(-0.55, 0.55)
    const tz = HERO_Z
    if (e.type === 'archer') {
      const y0 = 0.95
      const dist = Math.hypot(tx - e.x, tz - e.z)
      const T = dist / ARROW_SPEED
      const slot = spawnProjectile(
        this.projectiles, 'arrow', e.x, y0, e.z,
        (tx - e.x) / T, (0.55 - y0) / T + 0.5 * G * T, (tz - e.z) / T, tx, tz, T, i
      )
      if (slot >= 0) this.events.emit('shoot', slot, 0, 1)
    } else {
      const T = BOULDER_FLIGHT
      const y0 = 1.1
      const slot = spawnProjectile(
        this.projectiles, 'boulder', e.x, y0, e.z,
        (tx - e.x) / T, (0.4 - y0) / T + 0.5 * G * T, (tz - e.z) / T, tx, tz, T, i
      )
      if (slot >= 0) this.events.emit('shoot', slot, 0, 2)
    }
    const h = this.hero
    if (h.mood === 'idle') {
      h.mood = 'cower'
      h.moodTimer = 0.9
    }
  }

  private breach(i: number): void {
    const e = this.enemies[i]!
    e.state = 'breached'
    e.age = 0
    this.events.emit('breach', i, 0, 0, e.x, e.z)
    this.hurtHero(e.x, e.z)
  }

  /** Book-keep a kill: score (with multi-kill + combo), stats and event. */
  private kill(i: number, kind: number, multiIndex: number): void {
    const e = this.enemies[i]!
    const base = ENEMY[e.type].score
    let mult = 1 + SCORE.multiKillStep * multiIndex
    if (kind === KILL_CRUSH) mult += SCORE.stampBonus
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1
    this.comboTimer = 1.6
    if (this.combo >= 3) this.events.emit('combo', 0, this.combo)
    mult *= 1 + Math.min(this.combo - 1, 10) * 0.1
    const pts = Math.round((base * mult) / 5) * 5
    this.score += pts
    if (kind === KILL_SHOT) this.lessonEvent('shotKill', i)
    this.events.emit('kill', i, pts, kind, e.x, e.z)
    this.events.emit('score', 0, pts, Math.round(mult * 100), e.x, e.z)
    this.countType(e.type)
    const h = this.hero
    if (h.mood !== 'hit' && h.mood !== 'down') {
      h.mood = 'cheer'
      h.moodTimer = 0.8
    }
  }

  private countType(t: EnemyType): void {
    if (t === 'knight') this.stats.knights++
    else if (t === 'brute') this.stats.brutes++
    else if (t === 'archer') this.stats.archers++
    else if (t === 'runner') this.stats.runners++
    else if (t === 'leaper') this.stats.leapers++
    else this.stats.catapults++
  }

  private award(points: number, x: number, z: number, mult: number): void {
    this.score += points
    this.events.emit('score', 0, points, Math.round(mult * 100), x, z)
  }

  // ─── Projectiles ─────────────────────────────────────────────────────────

  private updateProjectiles(dt: number): void {
    if (dt <= 0) return
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i]!
      if (!p.alive) continue
      p.age += dt
      if (p.stuck) {
        if (p.age > p.life) p.alive = false
        continue
      }
      const px = p.x
      const pz = p.z
      if (p.type === 'bolt') {
        this.boltStep(p, px, pz, dt)
        continue
      }
      p.vy -= G * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      if (p.type === 'shot') {
        // The player's own stone sails over the walls.
        if (p.age >= p.life) {
          p.alive = false
          this.slingImpact(p.tx, p.tz)
        }
        continue
      }
      // A raised wall or shield in the way catches it.
      const blocker = this.barrierCrossing(px, pz, p.x, p.z)
      if (blocker >= 0) {
        const f = this.folds[blocker]!
        p.stuck = true
        p.life = p.age + 1.4
        p.vx = p.vy = p.vz = 0
        this.stats.blocks++
        this.award(SCORE.block, p.x, p.z, 1)
        this.events.emit('blocked', i, blocker, p.type === 'boulder' ? 2 : 1, p.x, p.z)
        if (damageFold(f, p.type === 'boulder' ? 2 : 1)) this.events.emit('foldBreak', blocker)
        continue
      }
      if (p.age >= p.life) {
        p.alive = false
        this.events.emit('impact', i, p.type === 'boulder' ? 4 : 3, 0, p.tx, p.tz)
        const h = this.hero
        if (Math.hypot(p.tx - h.x, p.tz - h.z) < 1.1) this.hurtHero(p.tx, p.tz)
      }
    }
  }

  private readonly segOut = v2()

  /** A ballista bolt flies flat and fast, piercing whoever is on its path. */
  private boltStep(p: { x: number; z: number; vx: number; vz: number; age: number; life: number; alive: boolean; hits: number }, px: number, pz: number, dt: number): void {
    p.x += p.vx * dt
    p.z += p.vz * dt
    for (let j = 0; j < MAX_ENEMIES && p.hits < BOLT_PIERCE; j++) {
      const e = this.enemies[j]!
      if (!isAlive(e)) continue
      if (e.state === 'leap' && e.y > LEAPER_SHOT_CEILING) continue
      segmentDistance(e.x, e.z, px, pz, p.x, p.z, this.segOut)
      if (this.segOut.x > BOLT_RADIUS + ENEMY[e.type].radius * 0.5) continue
      e.state = 'torn'
      e.age = 0
      e.y = 0
      this.kill(j, KILL_BOLT, p.hits++)
      this.stats.boltKills++
    }
    const out = p.z < -PAGE_HALF_D - 0.6 || p.x < -PAGE_HALF_W - 0.6 || p.x > PAGE_HALF_W + 0.6
    if (p.hits >= BOLT_PIERCE || out || p.age >= p.life) {
      p.alive = false
      this.events.emit('impact', -1, 6, p.hits, p.x, p.z)
    }
  }

  /** Index of a raised wall whose hinge the segment crosses, or -1. */
  private barrierCrossing(x0: number, z0: number, x1: number, z1: number): number {
    for (let k = 0; k < this.folds.length; k++) {
      const f = this.folds[k]!
      if (f.def.kind !== 'wall' || !isBarrier(f)) continue
      if (segmentsCross(x0, z0, x1, z1, f.def.ax - 0.15, f.def.az, f.def.bx + 0.15, f.def.bz)) return k
    }
    return -1
  }

  // ─── Tears ───────────────────────────────────────────────────────────────

  private updateTears(dt: number): void {
    for (let i = 0; i < this.tears.length; i++) {
      const t = this.tears[i]!
      if (t.torn) continue
      const reached = this.waveIndex > t.def.fromWave || (this.waveIndex === t.def.fromWave && this.waveStarted)
      let active = this.phase === 'play' && reached
      if (active && t.def.requires) {
        for (const id of t.def.requires) {
          const r = this.tears.find((o) => o.def.id === id)
          if (r && !r.torn) active = false
        }
      }
      if (active !== t.active) {
        t.active = active
        t.rev++
      }
      if (!t.pulling && t.t > 0) t.t = damp(t.t, 0, 8, dt)
    }
  }

  private completeTear(i: number): void {
    const t = this.tears[i]!
    t.torn = true
    t.pulling = false
    t.t = 1
    t.rev++
    this.stats.torn++
    // Whoever stood on it comes down with it.
    let n = 0
    for (let j = 0; j < MAX_ENEMIES; j++) {
      const e = this.enemies[j]!
      if (!isAlive(e)) continue
      if (Math.hypot(e.x - t.def.x, e.z - t.def.z) > t.def.radius + 0.75) continue
      e.state = 'torn'
      e.age = 0
      this.kill(j, KILL_TEAR, ++n)
    }
    this.award(t.def.score, t.px, t.pz, 1)
    this.events.emit('tear', i, t.def.score, 0, t.px, t.pz)
    this.lessonEvent('tear', i)
  }

  // ─── Hero ────────────────────────────────────────────────────────────────

  private updateHero(dt: number): void {
    const h = this.hero
    if (h.invuln > 0) h.invuln -= dt
    if (h.moodTimer > 0) {
      h.moodTimer -= dt
      if (h.moodTimer <= 0 && h.mood !== 'down') h.mood = 'idle'
    }
  }

  private hurtHero(x: number, z: number): void {
    const h = this.hero
    if (h.invuln > 0 || h.hp <= 0) return
    h.hp--
    h.invuln = HERO_INVULN
    h.mood = 'hit'
    h.moodTimer = 0.7
    h.rev++
    this.hitsThisPage++
    this.runHits++
    this.combo = 0
    this.events.emit('heroHit', 0, h.hp, 0, x, z)
    if (h.hp <= 0) {
      h.mood = 'down'
      this.events.emit('heroDown')
      this.crumple(true)
    }
  }

  // ─── Boss ────────────────────────────────────────────────────────────────

  private setBossPhase(p: BossPhase, timer: number): void {
    const b = this.boss
    b.phase = p
    b.timer = timer
    b.phaseTime = 0
    b.rev++
    this.bossActed = false
    this.events.emit('bossPhase', bossPhaseCode(p))
  }

  private updateBoss(dt: number): void {
    const b = this.boss
    b.phaseTime += dt
    b.timer -= dt
    switch (b.phase) {
      case 'dormant':
        if (b.phaseTime > this.page.introDelay + 0.9) this.setBossPhase('rumble', BOSS.rumble)
        break
      case 'rumble':
        if (b.timer <= 0) this.setBossPhase('unfold', BOSS.unfold)
        break
      case 'unfold':
        if (b.timer <= 0) this.setBossPhase('roar', BOSS.roar)
        break
      case 'roar':
        if (b.timer <= 0) this.setBossPhase('idle', this.rng.range(BOSS.idleMin, BOSS.idleMax))
        break
      case 'idle':
        if (b.timer <= 0) {
          if (b.attacks >= BOSS.attacksPerExposure) this.exposeWeakPoint()
          else if (b.attacks % 2 === 0) this.setBossPhase('breathCharge', this.breathCharge())
          else this.setBossPhase('stomp', BOSS.stomp)
        }
        break
      case 'breathCharge': {
        const h = this.hero
        b.aimX = damp(b.aimX, h.x, 3, dt)
        b.aimZ = BOSS.breathZ
        if (h.mood === 'idle') {
          h.mood = 'cower'
          h.moodTimer = 0.6
        }
        if (b.timer <= 0) this.setBossPhase('breath', BOSS.breath)
        break
      }
      case 'breath':
        if (!this.bossActed && b.phaseTime >= 0.35) {
          this.bossActed = true
          this.events.emit('bossBreath', 0, 0, 0, b.aimX, b.aimZ)
          const blocker = this.barrierCrossing(0, -2.6, b.aimX, b.aimZ)
          if (blocker >= 0) {
            this.stats.blocks++
            this.award(SCORE.block * 4, this.folds[blocker]!.cx, this.folds[blocker]!.cz, 1)
            this.events.emit('blocked', -1, blocker, 3, this.folds[blocker]!.cx, this.folds[blocker]!.cz)
            if (damageFold(this.folds[blocker]!, 2)) this.events.emit('foldBreak', blocker)
          } else {
            this.hurtHero(b.aimX, b.aimZ)
          }
        }
        if (b.timer <= 0) {
          b.attacks++
          this.setBossPhase('idle', this.rng.range(BOSS.idleMin, BOSS.idleMax) * this.bossPace())
        }
        break
      case 'stomp':
        if (!this.bossActed && b.phaseTime >= 0.55) {
          this.bossActed = true
          const side = this.rng.next() < 0.5 ? -1 : 1
          this.events.emit('bossStomp', 0, 0, 0, side * 1.6, -1.6)
          const n = 3 + Math.min(2, brokenCount(b)) + this.extraPerWave
          this.column++
          const mix = this.page.stomp
          for (let k = 0; k < n; k++) {
            const lane = k % this.page.lanes.length
            const type: EnemyType = mix ? mix[k % mix.length]! : k === n - 1 && brokenCount(b) >= 2 ? 'brute' : 'knight'
            const slot = spawnEnemy(
              this.enemies, type,
              // In front of the castle core, never inside its walls.
              this.laneX(lane, -1.4) + this.rng.range(-0.3, 0.3), -1.3 - k * 0.15, lane, this.rng.range(-0.3, 0.3)
            )
            if (slot >= 0) {
              this.primeSpawn(slot)
              this.events.emit('spawn', slot)
            }
          }
        }
        if (b.timer <= 0) {
          b.attacks++
          this.setBossPhase('idle', this.rng.range(BOSS.idleMin, BOSS.idleMax) * this.bossPace())
        }
        break
      case 'exposed':
        if (b.timer <= 0) {
          const w = b.weakPoints[b.exposed]
          if (w) w.t = 0
          b.exposed = -1
          b.attacks = BOSS.attacksPerExposure - 1
          this.setBossPhase('breathCharge', this.breathCharge())
        }
        break
      case 'hurt':
        if (b.timer <= 0) {
          if (nextWeakPoint(b) < 0) this.setBossPhase('collapse', BOSS.collapse)
          else this.setBossPhase('idle', 0.8)
        }
        break
      case 'collapse':
        b.collapse = clamp01(1 - b.timer / BOSS.collapse)
        if (b.timer <= 0) {
          b.collapse = 1
          this.setBossPhase('flat', 0)
          this.pagesCleared = Math.max(this.pagesCleared, this.pageId)
          this.award(SCORE.boss, 0, -3, 1)
          if (this.hitsThisPage === 0) this.award(SCORE.perfectPage, 0, 0, 1)
          const stars = this.ratePage()
          notePageWon(this.kind, this.book, this.pageId, this.hitsThisPage === 0, true)
          this.events.emit('pageCleared', this.pageId, this.hitsThisPage === 0 ? 1 : 0, stars)
          this.loadPage(Math.min(PAGE_COUNT, this.pageId + 1) as PageId)
        }
        break
      case 'flat':
        break
    }
  }

  /** The dragon speeds up as it loses limbs. */
  private bossPace(): number {
    return (1 - brokenCount(this.boss) * 0.12) * (this.page.bossPace ?? 1)
  }

  private breathCharge(): number {
    return BOSS.breathCharge * (1 - brokenCount(this.boss) * 0.08) * (this.page.bossPace ?? 1)
  }

  private exposeWeakPoint(): void {
    const b = this.boss
    const i = nextWeakPoint(b)
    if (i < 0) return
    b.exposed = i
    b.slingHits = 0
    b.weakPoints[i]!.t = 0
    this.setBossPhase('exposed', BOSS.exposed)
  }

  private breakWeak(): void {
    const b = this.boss
    const i = b.exposed
    if (i < 0) return
    const w = b.weakPoints[i]!
    w.broken = true
    w.t = 1
    b.exposed = -1
    b.attacks = 0
    this.award(SCORE.weakpoint, w.x, w.z, 1)
    this.events.emit('bossHurt', i, 0, 0, w.x, w.z)
    this.hitStop = HIT_STOP
    this.setBossPhase('hurt', BOSS.hurt)
    this.lessonEvent(w.mode === 'crease' ? 'crease' : 'core', i)
  }

  // ─── Lessons ─────────────────────────────────────────────────────────────

  private startLesson(id: LessonId, target: number): void {
    const l = this.lesson
    l.id = id
    l.step = 0
    l.target = target
    l.age = 0
    l.hint = false
    l.timeScale = LESSON_TIME_SCALE
    l.rev++
    this.events.emit('lesson', lessonCode(id), 1)
  }

  private completeLesson(): void {
    const l = this.lesson
    if (!l.id) return
    const id = l.id
    if (!l.hint) {
      this.learned[id] = true
      this.events.emit('lesson', lessonCode(id), 0)
    }
    clearLesson(l)
  }

  /** Something happened that may complete the running lesson. */
  /** Drop the running lesson without marking it learned (its moment passed). */
  private abortLesson(): void {
    clearLesson(this.lesson)
  }

  private lessonEvent(
    what: 'snap' | 'stamp' | 'tear' | 'peel' | 'crease' | 'core' | 'shot' | 'shotKill' | 'bolt', index: number
  ): void {
    const l = this.lesson
    if (!l.id) return
    switch (l.id) {
      case 'ballista':
        if (what === 'snap' && index === l.target && l.step === 0) {
          l.step = 1
          l.age = 0
          l.rev++
        } else if (what === 'bolt') this.completeLesson()
        break
      case 'crush':
        if (what === 'stamp' && (index === l.target || l.hint)) this.completeLesson()
        break
      case 'sling':
      case 'leaper':
        if (what === 'shot') this.completeLesson()
        break
      case 'swipe':
      case 'shield':
      case 'ridge':
      case 'frog':
        if (what === 'snap' && (index === l.target || l.hint)) this.completeLesson()
        break
      case 'launch':
        if (what === 'snap' && this.folds[index]?.def.kind === 'launch') this.completeLesson()
        break
      case 'stamp':
        if (what === 'snap' && index === l.target && l.step === 0) {
          l.step = 1
          l.age = 0
          l.rev++
        } else if (what === 'stamp') this.completeLesson()
        break
      case 'spread':
        if (what === 'tear') this.completeLesson()
        break
      case 'peel':
        if (what === 'peel') this.completeLesson()
        break
      case 'crease':
        if (what === 'crease') this.completeLesson()
        break
      case 'core':
        if (what === 'core') this.completeLesson()
        break
    }
  }

  private updateLessons(realDt: number): void {
    const l = this.lesson
    if (l.id && !l.hint) {
      l.age += realDt
      this.driveLesson()
    } else if (this.acceptsInput() || this.phase === 'peel') {
      // A real lesson always wins over a reminder.
      const hinting = l.hint
      if (hinting) {
        l.id = null
        l.hint = false
      }
      this.triggerLessons()
      if (!l.id) {
        if (this.idle > IDLE_HINT_AFTER) this.idleHint()
        else if (hinting) clearLesson(l)
      }
      if (l.id && !l.hint) {
        l.age = 0
        // Place the ghost hand on the very frame the lesson starts.
        this.driveLesson()
      }
    } else if (l.id) {
      clearLesson(l)
    }
    this.timeTarget = l.id && !l.hint ? l.timeScale : 1
    if (this.kindSlowmo > 0 && this.timeTarget > LESSON_TIME_SCALE) this.timeTarget = LESSON_TIME_SCALE
  }

  private foldIndexWithLesson(id: LessonId): number {
    for (let i = 0; i < this.folds.length; i++) {
      const f = this.folds[i]!
      if (f.def.lesson === id && isGrabbable(f)) return i
    }
    return -1
  }

  /** Lead enemy (largest z) standing on a fold's footprint; returns slot or -1. */
  private leadOn(f: FoldState, margin = 0): number {
    let best = -1
    let bz = -Infinity
    for (let j = 0; j < MAX_ENEMIES; j++) {
      const e = this.enemies[j]!
      if (e.state !== 'march') continue
      if (!onFootprint(f, e.x, e.z, margin)) continue
      if (e.z > bz) {
        bz = e.z
        best = j
      }
    }
    return best
  }

  private countOn(f: FoldState): number {
    let n = 0
    for (const e of this.enemies) if (e.state === 'march' && onFootprint(f, e.x, e.z, 0)) n++
    return n
  }

  private triggerLessons(): void {
    const learned = this.learned
    const wave = this.page.waves[this.waveIndex]
    const waveLesson = this.waveStarted ? wave?.lesson : undefined

    if (!learned.swipe && waveLesson === 'swipe') {
      const i = this.foldIndexWithLesson('swipe')
      if (i >= 0) {
        const f = this.folds[i]!
        const lead = this.leadOn(f)
        if (lead >= 0 && (this.countOn(f) >= 3 || acrossHinge(f, this.enemies[lead]!.x, this.enemies[lead]!.z) < f.def.depth * 0.45)) {
          this.startLesson('swipe', i)
          return
        }
      }
    }
    if (!learned.stamp && waveLesson === 'stamp') {
      const i = this.foldIndexWithLesson('stamp')
      if (i >= 0) {
        const f = this.folds[i]!
        if (this.countOn(f) >= 2) {
          this.startLesson('stamp', i)
          return
        }
      }
    }
    if (!learned.shield) {
      const i = this.foldIndexWithLesson('shield')
      if (i >= 0 && this.maxWindup() > 0.05) {
        this.startLesson('shield', i)
        return
      }
    }
    if (!learned.launch) {
      for (let j = 0; j < MAX_ENEMIES; j++) {
        const e = this.enemies[j]!
        if (e.type !== 'catapult' || e.state !== 'stand') continue
        const i = this.launchFlapUnder(e)
        if (i >= 0 && (e.windup > 0.05 || this.phaseTime > 9)) {
          this.startLesson('launch', i)
          return
        }
      }
    }
    if (!learned.ridge && waveLesson === 'ridge') {
      const i = this.foldIndexWithLesson('ridge')
      if (i >= 0) {
        const f = this.folds[i]!
        for (const e of this.enemies) {
          if (e.state !== 'march') continue
          if (e.x < f.def.ax - 0.3 || e.x > f.def.bx + 0.3) continue
          const d = f.cz - e.z
          if (d > 0 && d < f.def.depth + 1.6) {
            this.startLesson('ridge', i)
            return
          }
        }
      }
    }
    if (!learned.spread) {
      for (let i = 0; i < this.tears.length; i++) {
        const t = this.tears[i]!
        if (t.def.lesson === 'spread' && t.active && !t.torn && this.waveStarted && this.waveTime > 1.2) {
          this.startLesson('spread', i)
          return
        }
      }
    }
    if (!learned.peel && this.phase === 'peel' && !this.peelDone) {
      this.startLesson('peel', 0)
      return
    }
    if (this.boss.exposed >= 0 && this.boss.phase === 'exposed') {
      const w = this.boss.weakPoints[this.boss.exposed]!
      if (w.mode === 'crease' && !learned.crease) {
        this.startLesson('crease', this.boss.exposed)
        return
      }
      if (w.mode === 'core' && !learned.core) {
        this.startLesson('core', this.boss.exposed)
        return
      }
    }
    if (!learned.ballista && (this.phase === 'play' || this.phase === 'boss')) {
      // The castle's ballistas: once something is past the middle of the page.
      const lead = this.leadEnemy()
      if (lead >= 0 && this.enemies[lead]!.z > -1.5) {
        for (let i = 0; i < this.folds.length; i++) {
          const f = this.folds[i]!
          if (f.def.kind === 'ballista' && isGrabbable(f) && this.enemies[lead]!.x * f.cx >= 0) {
            this.startLesson('ballista', i)
            return
          }
        }
      }
    }
    if (!learned.crush && learned.swipe) {
      // Folding a wall back down onto whoever is bashing it: the counter-attack.
      for (let i = 0; i < this.folds.length; i++) {
        const f = this.folds[i]!
        if (f.def.kind !== 'wall' || !isStampable(f)) continue
        let n = 0
        for (const e of this.enemies) if (e.state === 'blocked' && e.fold === i) n++
        if (n >= 2) {
          this.startLesson('crush', i)
          return
        }
      }
    }
    if (this.sling && this.sling.cool <= 0 && this.phase === 'play') {
      if (!learned.sling && waveLesson === 'sling') {
        const lead = this.leadEnemy()
        if (lead >= 0 && this.enemies[lead]!.z > -3.2) {
          this.startLesson('sling', lead)
          return
        }
      }
      if (!learned.leaper) {
        for (let j = 0; j < MAX_ENEMIES; j++) {
          const e = this.enemies[j]!
          if (e.type === 'leaper' && e.state === 'march' && e.z > -3.4) {
            this.startLesson('leaper', j)
            return
          }
        }
      }
    }
    if (!learned.frog && this.page.exit === 'finale' && this.phase === 'play') {
      const i = this.foldIndexWithLesson('frog')
      if (i >= 0) this.startLesson('frog', i)
    }
  }

  /** The marching enemy furthest down the page, or -1. */
  private leadEnemy(): number {
    let best = -1
    let bz = -Infinity
    for (let j = 0; j < MAX_ENEMIES; j++) {
      const e = this.enemies[j]!
      if (e.state !== 'march') continue
      if (e.z > bz) {
        bz = e.z
        best = j
      }
    }
    return best
  }

  /** Ghost hand: pull the sling back so the stone lands on (x, z). */
  private handOnSling(x: number, z: number): void {
    const s = this.sling
    if (!s) return
    const dx = (x - s.def.x) / SLING_GAIN
    const dz = (z - s.def.z) / SLING_GAIN
    setHand(this.lesson, 'drag', s.def.x, s.def.z, s.def.x - dx, s.def.z - dz, 0.6)
  }

  private maxWindup(): number {
    let m = 0
    for (const e of this.enemies) if (e.state === 'stand' && e.windup > m) m = e.windup
    return m
  }

  private launchFlapUnder(e: Enemy): number {
    for (let i = 0; i < this.folds.length; i++) {
      const f = this.folds[i]!
      if (f.def.kind === 'launch' && isGrabbable(f) && onFootprint(f, e.x, e.z, 0.2)) return i
    }
    return -1
  }

  /** Per-frame lesson choreography: where the hand is, how slow time runs. */
  private driveLesson(): void {
    const l = this.lesson
    switch (l.id) {
      case 'swipe':
      case 'shield':
      case 'ridge':
      case 'launch':
      case 'frog': {
        const f = this.folds[l.target]
        if (!f) return this.completeLesson()
        if (f.phase === 'up' || f.phase === 'spent') return this.completeLesson()
        this.handOnFold(f)
        let freeze = false
        if (l.id === 'swipe') {
          const lead = this.leadOn(f, 0.3)
          if (lead >= 0 && acrossHinge(f, this.enemies[lead]!.x, this.enemies[lead]!.z) < 0.5) freeze = true
          if (lead < 0 && this.countOn(f) === 0 && l.age > 1.5) freeze = true
        } else if (l.id === 'shield' || l.id === 'launch') {
          freeze = this.maxWindup() > 0.8
        } else if (l.id === 'ridge') {
          for (const e of this.enemies) {
            if (e.state === 'march' && e.x > f.def.ax - 0.3 && e.x < f.def.bx + 0.3 && f.cz - e.z < f.def.depth + 0.35 && f.cz - e.z > 0) freeze = true
          }
        } else if (l.id === 'frog') {
          l.timeScale = 1
          return
        }
        l.timeScale = f.phase === 'dragging' ? 0.35 : freeze ? 0 : LESSON_TIME_SCALE
        break
      }
      case 'stamp': {
        const f = this.folds[l.target]
        if (!f) return this.completeLesson()
        if (l.step === 0) {
          if (f.phase !== 'ready' && f.phase !== 'dragging' && f.phase !== 'snapping') return this.completeLesson()
          this.handOnFold(f)
          let leaving = false
          for (const e of this.enemies) {
            if (e.state === 'march' && onFootprint(f, e.x, e.z, 0) && acrossHinge(f, e.x, e.z) > f.def.depth * 0.55) leaving = true
          }
          l.timeScale = f.phase === 'dragging' ? 0.35 : leaving ? 0 : LESSON_TIME_SCALE
        } else {
          if (f.phase !== 'up' && f.phase !== 'stamping') return this.completeLesson()
          if (l.hand.gesture !== 'tap') setHand(l, 'tap', f.cx, f.cz, f.cx, f.cz, 0)
          l.timeScale = 0.3
        }
        break
      }
      case 'spread': {
        const t = this.tears[l.target]
        if (!t || t.torn) return this.completeLesson()
        setHand(l, 'spread', t.px, t.pz, t.px, t.pz, 0)
        l.timeScale = t.pulling ? 0.4 : this.maxWindup() > 0.75 ? 0 : 0.25
        break
      }
      case 'peel':
        if (this.peelDone) return this.completeLesson()
        if (l.hand.gesture !== 'drag') setHand(l, 'drag', 4.5, 6.5, 1.2, 2.2, 0)
        l.timeScale = 1
        break
      case 'ballista': {
        const f = this.folds[l.target]
        if (!f) return this.abortLesson()
        const lead = this.leadEnemy()
        if (l.step === 0) {
          if (f.phase === 'up') {
            l.step = 1
            l.age = 0
          } else if (f.phase !== 'ready' && f.phase !== 'dragging' && f.phase !== 'snapping') return this.abortLesson()
          else {
            this.handOnFold(f)
            const near = lead >= 0 && this.enemies[lead]!.z > 0.6
            l.timeScale = f.phase === 'dragging' ? 0.35 : near ? 0 : LESSON_TIME_SCALE
            break
          }
        }
        // Step 1: tap on the enemy to shoot it.
        if (f.phase !== 'up' || f.ammo <= 0) return this.abortLesson()
        if (lead < 0) return this.completeLesson()
        if (l.hand.gesture !== 'tap') {
          const e = this.enemies[lead]!
          setHand(l, 'tap', e.x, e.z, e.x, e.z, 0.6)
        }
        l.timeScale = l.age < 0.4 ? LESSON_TIME_SCALE : 0
        break
      }
      case 'crush': {
        const f = this.folds[l.target]
        if (!f) return this.abortLesson()
        if (f.phase !== 'up' && f.phase !== 'stamping') return this.abortLesson()
        if (l.hand.gesture !== 'tap') setHand(l, 'tap', f.cx + f.nx * 0.5, f.cz + f.nz * 0.5, f.cx + f.nx * 0.5, f.cz + f.nz * 0.5, 0.9)
        // Let the bashing read for a beat, then hold the world still.
        l.timeScale = l.age < 0.6 ? LESSON_TIME_SCALE : 0
        break
      }
      case 'sling':
      case 'leaper': {
        const s = this.sling
        const e = this.enemies[l.target]
        if (!s) return this.abortLesson()
        if (!e || !isAlive(e)) return l.id === 'leaper' ? this.completeLesson() : this.abortLesson()
        if (l.hand.gesture !== 'drag') {
          // Lead the target: aim where it will be a moment from now.
          this.handOnSling(e.x, Math.min(BREACH_Z - 0.6, e.z + (l.id === 'leaper' ? 1.2 : 0.9)))
        }
        if (s.aiming) l.timeScale = 0.35
        else l.timeScale = e.z > (l.id === 'leaper' ? -1.6 : -1.2) || l.age > 2.4 ? 0 : LESSON_TIME_SCALE
        break
      }
      case 'crease':
      case 'core': {
        const b = this.boss
        if (b.exposed !== l.target) return this.completeLesson()
        const w = b.weakPoints[l.target]!
        if (w.mode === 'crease') {
          if (l.hand.gesture !== 'swipe') setHand(l, 'swipe', w.x - w.sx * 0.7, w.z - w.sz * 0.7, w.x + w.sx * 0.9, w.z + w.sz * 0.9, 0.9)
        } else if (l.hand.gesture !== 'spread') setHand(l, 'spread', w.x, w.z, w.x, w.z, 1.2)
        l.timeScale = w.t > 0 ? 0.6 : 0.3
        break
      }
    }
  }

  private handOnFold(f: FoldState): void {
    const l = this.lesson
    const k = f.def.kind
    let ax: number
    let az: number
    let bx: number
    let bz: number
    if (k === 'valley') {
      // Along the strip, left to right through the middle.
      ax = f.cx - f.ux * f.len * 0.32
      az = f.cz - f.uz * f.len * 0.32
      bx = f.cx + f.ux * f.len * 0.32
      bz = f.cz + f.uz * f.len * 0.32
    } else if (k === 'launch') {
      // From the far (player-side) edge up over the hinge.
      ax = f.cx + f.nx * f.def.depth * 0.85
      az = f.cz + f.nz * f.def.depth * 0.85
      bx = f.cx - f.nx * 0.4
      bz = f.cz - f.nz * 0.4
    } else if (k === 'ridge') {
      ax = f.cx
      az = f.cz + f.def.depth * 0.9
      bx = f.cx
      bz = f.cz - f.def.depth * 0.9
    } else {
      // Walls/frog: from the hinge up across the flap, the way the arrow points.
      ax = f.cx + f.nx * 0.15
      az = f.cz + f.nz * 0.15
      bx = f.cx + f.nx * f.def.depth * 0.95
      bz = f.cz + f.nz * f.def.depth * 0.95
    }
    if (l.hand.gesture !== 'swipe' || l.hand.ax !== ax || l.hand.az !== az) setHand(l, 'swipe', ax, az, bx, bz, 0)
  }

  /**
   * A learned mechanic the player seems to have forgotten: show the hand
   * again, silently, without touching time. Cleared by the next input.
   */
  private idleHint(): void {
    const l = this.lesson
    // Peel waiting?
    const learned = this.learned
    if (this.phase === 'peel' && !this.peelDone && learned.peel) {
      l.id = 'peel'
      l.hint = true
      setHand(l, 'drag', 4.5, 6.5, 1.2, 2.2, 0)
      return
    }
    // Exposed boss weak point?
    const b = this.boss
    if (b.exposed >= 0 && learned[b.weakPoints[b.exposed]!.mode]) {
      const w = b.weakPoints[b.exposed]!
      l.id = w.mode === 'crease' ? 'crease' : 'core'
      l.target = b.exposed
      l.hint = true
      if (w.mode === 'crease') setHand(l, 'swipe', w.x - w.sx * 0.7, w.z - w.sz * 0.7, w.x + w.sx * 0.9, w.z + w.sz * 0.9, 0.9)
      else setHand(l, 'spread', w.x, w.z, w.x, w.z, 1.2)
      return
    }
    // A stampable structure with enemies at it?
    for (let i = 0; i < this.folds.length; i++) {
      const f = this.folds[i]!
      if (!isStampable(f) || !(learned.stamp || learned.crush)) continue
      for (const e of this.enemies) {
        if ((e.state === 'blocked' || e.state === 'trapped') && e.fold === i) {
          l.id = 'stamp'
          l.step = 1
          l.target = i
          l.hint = true
          setHand(l, 'tap', f.cx, f.cz, f.cx, f.cz, 0)
          return
        }
      }
    }
    // An intact tear?
    for (let i = 0; i < this.tears.length; i++) {
      const t = this.tears[i]!
      if (t.active && !t.torn && learned.spread) {
        l.id = 'spread'
        l.target = i
        l.hint = true
        setHand(l, 'spread', t.px, t.pz, t.px, t.pz, 0)
        return
      }
    }
    // An open ballista with bolts left, or a closed one and trouble coming.
    if (learned.ballista) {
      const lead = this.leadEnemy()
      if (lead >= 0 && this.enemies[lead]!.z > -1) {
        const e = this.enemies[lead]!
        const armed = this.armedBallista(e.x)
        if (armed >= 0) {
          l.id = 'ballista'
          l.step = 1
          l.target = armed
          l.hint = true
          setHand(l, 'tap', e.x, e.z, e.x, e.z, 0.6)
          return
        }
        for (let i = 0; i < this.folds.length; i++) {
          const f = this.folds[i]!
          if (f.def.kind !== 'ballista' || !isGrabbable(f) || e.z < 1.5) continue
          l.id = 'ballista'
          l.step = 0
          l.target = i
          l.hint = true
          this.handOnFold(f)
          return
        }
      }
    }
    // A loaded sling and something to shoot at.
    const s = this.sling
    if (s && s.cool <= 0 && learned.sling) {
      const lead = this.leadEnemy()
      if (lead >= 0 && this.enemies[lead]!.z > -2) {
        const e = this.enemies[lead]!
        l.id = 'sling'
        l.target = lead
        l.hint = true
        this.handOnSling(e.x, Math.min(BREACH_Z - 0.6, e.z + 0.8))
        return
      }
    }
    // A ready fold with enemies walking onto it.
    for (let i = 0; i < this.folds.length; i++) {
      const f = this.folds[i]!
      if (!isGrabbable(f)) continue
      const k = f.def.kind
      const urgent = (k === 'frog' && learned.frog) || (learned.swipe && (k === 'wall' || k === 'valley') && this.countOn(f) > 0)
      if (!urgent) continue
      l.id = k === 'frog' ? 'frog' : 'swipe'
      l.target = i
      l.hint = true
      this.handOnFold(f)
      return
    }
  }

  // ─── Debug / tests ───────────────────────────────────────────────────────

  /** Clear every enemy and tear on the page (dev shortcut / tests). */
  debugClearPage(): void {
    for (let j = 0; j < MAX_ENEMIES; j++) {
      const e = this.enemies[j]!
      if (isAlive(e)) {
        e.state = 'torn'
        e.age = 0
        this.kill(j, KILL_TEAR, 0)
      }
    }
    for (let i = 0; i < this.tears.length; i++) if (!this.tears[i]!.torn) this.completeTear(i)
    this.waveIndex = this.page.waves.length
    if (this.page.exit === 'boss') {
      for (const w of this.boss.weakPoints) w.broken = true
      this.setBossPhase('collapse', 0.3)
    }
  }

  /** Is the dragon awake and on the board? (renderer/UI helper) */
  bossActive(): boolean {
    return this.page.exit === 'boss' && bossAwake(this.boss)
  }
}
