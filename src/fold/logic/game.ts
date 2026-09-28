/**
 * FoldGame — the whole of Castle Fold's rules, headless.
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
  PAGE_HALF_W, PAGE_TURN_TIME, PEEL_COMPLETE, SCORE, SPAWN_Z, TIME_SCALE_RATE, TORN_LINGER,
  FOLD_SNAP_THRESHOLD
} from './config'
import { EventQueue, KILL_CRUSH, KILL_FLING, KILL_LAUNCH, KILL_RIDGE, KILL_TEAR } from './events'
import {
  FOLD_LOWERED, FOLD_READY, FOLD_SNAPPED, FOLD_SPRUNG, FOLD_STAMPED,
  acrossHinge, alongHinge, createFold, dragFold, grabFold, isBarrier, isGrabbable, isStampable,
  isTrap, onFootprint, releaseFold, revealFold, snapFold, stampFold, updateFold, damageFold
} from './folds'
import {
  MAX_ENEMIES, createEnemyPool, createHero, createProjectilePool, isAlive, resetPools, spawnEnemy,
  spawnProjectile
} from './entities'
import { bossAwake, bossPhaseCode, brokenCount, createBoss, nextWeakPoint, resetBoss } from './boss'
import { LESSON_IDS, clearLesson, createLessonState, lessonCode, setHand } from './lessons'
import { PAGES } from './pages'
import { createRng, type Rng } from './rng'
import { clamp, clamp01, damp, segmentsCross } from './math'
import type {
  BossPhase, Enemy, EnemyType, FoldState, GamePhase, LessonId, PageDef, PageId, SpawnDef, TearState
} from './types'

/** Gravity for everything thrown (page units / s²) — floaty on purpose: it's paper. */
const G = 14
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
}

export const emptyStats = (): GameStats => ({
  launched: 0, crushed: 0, torn: 0, folds: 0, stamps: 0, blocks: 0,
  knights: 0, brutes: 0, archers: 0, catapults: 0, flung: 0, ridged: 0
})

export interface GameOptions {
  seed?: number
  /** Lessons the player already learned (persisted); those never slow time. */
  learned?: Partial<Record<LessonId, boolean>>
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

  pageId: PageId = 1
  page: PageDef = PAGES[1]
  folds: FoldState[] = []
  tears: TearState[] = []

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

  constructor(opts: GameOptions = {}) {
    this.rng = createRng(opts.seed ?? 0x5eed)
    const learned = {} as Record<LessonId, boolean>
    for (const id of LESSON_IDS) learned[id] = !!opts.learned?.[id]
    this.learned = learned
  }

  // ─── Run / page lifecycle ────────────────────────────────────────────────

  /** Start a run at `page` (a returning player resumes their saved page). */
  startRun(page: PageId = 1, score = 0): void {
    this.score = score
    this.runHits = 0
    this.runTime = 0
    this.pagesCleared = page - 1
    this.stats = emptyStats()
    resetBoss(this.boss)
    this.loadPage(page)
  }

  loadPage(id: PageId): void {
    this.pageId = id
    this.page = PAGES[id]
    this.folds = this.page.folds.map(createFold)
    this.tears = this.page.tears.map(createTear)
    this.waveOrder = this.page.waves.map((w) => [...w.spawns].sort((a, b) => a.at - b.at))
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
    clearLesson(this.lesson)
    for (const f of this.folds) if (f.def.fromWave === 0) revealFold(f)
    if (id === 5) resetBoss(this.boss)
    if (id === 6) {
      this.boss.phase = 'flat'
      this.boss.collapse = 1
      this.boss.exposed = -1
    }
    this.setPhase(id === 5 ? 'boss' : 'intro')
    this.events.emit('pageIntro', id)
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
    clearLesson(this.lesson)
    this.events.emit('crumple')
    this.setPhase('crumple', CRUMPLE_TIME)
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
        if (this.phaseTimer <= 0) this.loadPage(Math.min(6, this.turnFrom + 1) as PageId)
        break
      case 'peel':
        this.updateHero(simDt)
        if (this.peelDone) {
          this.peel = Math.min(1, this.peel + realDt * 2.2)
          if (this.peel >= 1) {
            this.events.emit('peelDone')
            this.loadPage(5)
          }
        } else if (!this.peeling && this.peel > 0) {
          this.peel = damp(this.peel, 0, 9, realDt)
        }
        break
      case 'crumple':
        this.phaseTimer -= realDt
        if (this.phaseTimer <= 0) {
          this.setPhase('drop', PAGE_DROP_TIME)
          this.restartPage()
          // restartPage → loadPage set phase intro; keep the drop visible.
          this.setPhase('drop', PAGE_DROP_TIME)
        }
        break
      case 'drop':
        this.phaseTimer -= realDt
        if (this.phaseTimer <= 0) this.setPhase(this.pageId === 5 ? 'boss' : 'intro')
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

    this.updateLessons(realDt)
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
    this.events.emit('tap', 0, 0, 0, x, z)
    return false
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
    if (!this.waveStarted) {
      this.waveGap -= dt
      if (this.waveGap <= 0) this.startWave(this.waveIndex)
      return
    }
    this.waveTime += dt
    const order = this.waveOrder[this.waveIndex]!
    while (this.waveCursor < order.length && order[this.waveCursor]!.at <= this.waveTime) {
      this.spawnFrom(order[this.waveCursor]!)
      this.waveCursor++
    }
    this.updateSally(dt)
    if (this.waveCursor >= order.length && this.mobileAlive() === 0) {
      // Next wave after a breath.
      this.waveIndex++
      this.waveStarted = false
      if (this.waveIndex < waves.length) this.waveGap = waves[this.waveIndex]!.delay
    }
  }

  private startWave(index: number): void {
    this.waveIndex = index
    this.waveTime = 0
    this.waveCursor = 0
    this.waveStarted = true
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
      if (slot >= 0) this.events.emit('spawn', slot)
    }
  }

  private spawnFrom(sd: SpawnDef): void {
    let x: number
    let z: number
    if (sd.lane >= 0 && this.page.lanes[sd.lane]) {
      x = this.laneX(sd.lane, SPAWN_Z)
      z = SPAWN_Z
    } else {
      x = sd.x ?? 0
      z = sd.z ?? SPAWN_Z
    }
    // A shooter posted on a structure that is already torn has nowhere to stand.
    if (sd.lane < 0) {
      for (const t of this.tears) if (t.torn && Math.hypot(t.def.x - x, t.def.z - z) < t.def.radius + 0.75) return
    }
    const jitter = sd.lane >= 0 ? this.rng.range(-0.32, 0.32) : 0
    const slot = spawnEnemy(this.enemies, sd.type, x + jitter, z, sd.lane, jitter)
    if (slot < 0) return
    const e = this.enemies[slot]!
    if (e.state === 'stand') {
      const first = e.type === 'archer' ? ARCHER_FIRST_SHOT : CATAPULT_FIRST_SHOT
      e.cool = first + this.rng.range(0, 1.6)
    }
    this.events.emit('spawn', slot)
  }

  /** Marching enemies alive (stationary shooters don't hold a wave back). */
  mobileAlive(): number {
    let n = 0
    for (const e of this.enemies) if (e.state === 'march' || e.state === 'blocked' || e.state === 'trapped') n++
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
    this.pagesCleared = Math.max(this.pagesCleared, this.pageId)
    // Fold every raised pop-up back into the page (pop-up books close flat).
    for (const f of this.folds) {
      if (f.phase === 'up') f.phase = 'lowering'
      else if (f.phase === 'dragging') f.phase = 'ready'
    }
    this.hero.mood = 'cheer'
    this.hero.moodTimer = 2
    this.events.emit('pageCleared', this.pageId, perfect ? 1 : 0)
    this.setPhase('cleared', PAGE_CLEAR_DELAY)
  }

  private exitPage(): void {
    if (this.page.exit === 'peel') {
      this.setPhase('peel')
      return
    }
    this.turnFrom = this.pageId
    this.setPhase('turn', PAGE_TURN_TIME)
    this.events.emit('pageTurn', this.pageId, Math.min(6, this.pageId + 1))
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
      p.vy -= G * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
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
      this.events.emit('crumple')
      clearLesson(this.lesson)
      this.setPhase('crumple', CRUMPLE_TIME)
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
          const n = 3 + Math.min(2, brokenCount(b))
          for (let k = 0; k < n; k++) {
            const lane = k % this.page.lanes.length
            const slot = spawnEnemy(
              this.enemies, k === n - 1 && brokenCount(b) >= 2 ? 'brute' : 'knight',
              this.laneX(lane, -1.4) + this.rng.range(-0.3, 0.3), -1.4 - k * 0.25, lane, this.rng.range(-0.3, 0.3)
            )
            if (slot >= 0) this.events.emit('spawn', slot)
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
          this.pagesCleared = Math.max(this.pagesCleared, 5)
          this.award(SCORE.boss, 0, -3, 1)
          if (this.hitsThisPage === 0) this.award(SCORE.perfectPage, 0, 0, 1)
          this.events.emit('pageCleared', 5, this.hitsThisPage === 0 ? 1 : 0)
          this.loadPage(6)
        }
        break
      case 'flat':
        break
    }
  }

  /** The dragon speeds up as it loses limbs. */
  private bossPace(): number {
    return 1 - brokenCount(this.boss) * 0.12
  }

  private breathCharge(): number {
    return BOSS.breathCharge * (1 - brokenCount(this.boss) * 0.08)
  }

  private exposeWeakPoint(): void {
    const b = this.boss
    const i = nextWeakPoint(b)
    if (i < 0) return
    b.exposed = i
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
  private lessonEvent(what: 'snap' | 'stamp' | 'tear' | 'peel' | 'crease' | 'core', index: number): void {
    const l = this.lesson
    if (!l.id) return
    switch (l.id) {
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
      if (l.id && !l.hint) l.age = 0
    } else if (l.id) {
      clearLesson(l)
    }
    this.timeTarget = l.id && !l.hint ? l.timeScale : 1
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
    if (!learned.launch && learned.shield) {
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
    if (!learned.frog && this.pageId === 6 && this.phase === 'play') {
      const i = this.foldIndexWithLesson('frog')
      if (i >= 0) this.startLesson('frog', i)
    }
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
      if (!isStampable(f) || !learned.stamp) continue
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
    if (this.pageId === 5) {
      for (const w of this.boss.weakPoints) w.broken = true
      this.setBossPhase('collapse', 0.3)
    }
  }

  /** Is the dragon awake and on the board? (renderer/UI helper) */
  bossActive(): boolean {
    return this.pageId === 5 && bossAwake(this.boss)
  }
}
