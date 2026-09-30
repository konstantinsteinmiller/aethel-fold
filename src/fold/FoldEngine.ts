/**
 * FoldEngine — glue between the pure game, the three.js view, the WebAudio
 * soundscape, haptics and the pointer. Owns the frame loop.
 *
 *   pointer → GestureRecognizer → FoldGame input API
 *   rAF     → game.update → view.update → events → (view, audio, haptics, hooks) → render
 *
 * The Vue layer talks to it through a handful of methods and a hooks object;
 * no Vue reactivity crosses into this file (GDD.md §0: Vue owns the DOM,
 * three.js owns the canvas).
 */

import { FoldGame, type GameOptions } from './logic/game'
import type { FoldEvent } from './logic/events'
import type { BookId, HighlightMode, PageDef, PageId } from './logic/types'
import { GestureRecognizer, type GestureFeedback } from './input/gestures'
import { GameView, type ScreenPoint } from './render/GameView'
import { FoldAudio } from './audio/FoldAudio'
import { haptics } from './haptics'
import { getAudioContext } from '@/use/useAssets'
import { SHELF_NONE, type ShelfProgress } from './logic/shelf'
import { SLOW_MODE_SCALE } from './logic/config'
import type { Look } from './logic/cosmetics'

export interface EngineHooks {
  /** Every simulation event, after the view and audio have reacted. */
  onEvent(e: FoldEvent, game: FoldGame): void
  /** Comic words the view wants shown at a screen point. */
  word(key: string, x: number, y: number, size: number, tone: string): void
  /** Called once per frame after rendering (cheap HUD sync). */
  onFrame?(game: FoldGame, dt: number): void
  /** The storybook line printed on a page. */
  caption?(def: PageDef): string
  /** The player's first press on the canvas (boot telemetry, roadmap #13). Once. */
  onFirstInput?(): void
}

/** ms after a page's intro before its successor is painted (once the player has touched the page). */
const WARM_AFTER_INTRO = 2200
/** ms after the first press before the deferred art starts (it then waits for idle time). */
const WARM_AFTER_TOUCH = 400
/** ms before the warm-up runs for a player who hasn't touched the page yet. */
const WARM_UNTOUCHED = 6000

export interface EngineOptions extends GameOptions {
  startPage?: PageId
  startScore?: number
  /** The equipped cosmetics and the season (roadmaps #6, #17): art only, the game never sees it. */
  look?: Look
}

export class FoldEngine {
  readonly game: FoldGame
  readonly view: GameView
  readonly audio: FoldAudio | null
  readonly gestures: GestureRecognizer
  private raf = 0
  private last = 0
  private running = false
  private canvas: HTMLCanvasElement
  private cssW = 1
  private cssH = 1
  private warmTimer: ReturnType<typeof setTimeout> | null = null
  /** The player has pressed the page at least once (gates the deferred art). */
  private touched = false
  /** The splash could not precompile in parallel: compile in the first idle warm-up. */
  private compileLater = false
  /** The page the next warm-up builds (0 = none). */
  private warmPage: PageId | 0 = 0
  private disposed = false
  /** A new look's canvas work is waiting for idle time (or for a pause, for the page in play). */
  private lookPending = false
  private lookQueued = false
  private readonly onPointerDown = (e: PointerEvent) => this.pointer('down', e)
  private readonly onPointerMove = (e: PointerEvent) => this.pointer('move', e)
  private readonly onPointerUp = (e: PointerEvent) => this.pointer('up', e)
  private readonly onPointerCancel = (e: PointerEvent) => this.pointer('cancel', e)
  /** A pointer the desk bookshelf has taken (−1 none): where and when it went down, and what it hit. */
  private shelfPtr = -1
  private shelfX = 0
  private shelfY = 0
  private shelfT = 0
  private shelfHit = SHELF_NONE
  /** A pointer that went down on the desk lamp (−1 none), and where and when. */
  private lampPtr = -1
  private lampX = 0
  private lampY = 0
  private lampT = 0
  private readonly onWheel = (e: WheelEvent) => {
    const r = this.canvas.getBoundingClientRect()
    if (this.gestures.wheel(e.clientX - r.left, e.clientY - r.top, e.deltaY)) e.preventDefault()
  }

  constructor(canvas: HTMLCanvasElement, private readonly hooks: EngineHooks, opts: EngineOptions = {}) {
    this.canvas = canvas
    this.game = new FoldGame(opts)
    this.view = new GameView(canvas, this.game, {
      word: (key, x, y, size = 1, tone = 'default') => hooks.word(key, x, y, size, tone),
      caption: (def) => hooks.caption?.(def) ?? ''
    }, opts.look)
    const ctx = getAudioContext()
    this.audio = ctx ? new FoldAudio(ctx) : null
    this.gestures = new GestureRecognizer(this.game, {
      project: (sx, sy, out) => this.view.unproject(sx, sy, out),
      minDim: () => Math.min(this.cssW, this.cssH),
      feedback: (k, v) => this.feedback(k, v)
    })
    this.game.startRun(opts.startPage ?? 1, opts.startScore ?? 0)
    this.view.update(0)
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  attach(): void {
    const c = this.canvas
    c.addEventListener('pointerdown', this.onPointerDown)
    c.addEventListener('pointermove', this.onPointerMove)
    c.addEventListener('pointerup', this.onPointerUp)
    c.addEventListener('pointercancel', this.onPointerCancel)
    c.addEventListener('lostpointercapture', this.onPointerCancel)
    c.addEventListener('wheel', this.onWheel, { passive: false })
  }

  detach(): void {
    const c = this.canvas
    c.removeEventListener('pointerdown', this.onPointerDown)
    c.removeEventListener('pointermove', this.onPointerMove)
    c.removeEventListener('pointerup', this.onPointerUp)
    c.removeEventListener('pointercancel', this.onPointerCancel)
    c.removeEventListener('lostpointercapture', this.onPointerCancel)
    c.removeEventListener('wheel', this.onWheel)
  }

  /**
   * Splash-time preparation (roadmap #13): let the view build page 1 from the
   * boot events, then — where the GPU can compile in parallel
   * (`KHR_parallel_shader_compile`) — precompile every program the scene can
   * draw with `compileAsync`, which leaves the main thread free for the splash.
   * Without the extension a compile ahead of the first frame would only block
   * the main thread for the programs page 1 doesn't draw yet, so those are
   * compiled in idle time after the first press instead (`warmNow`). Resolves
   * after at most `timeoutMs`, with how long it took and which path ran.
   * Call before `start()`.
   */
  async prewarm(timeoutMs = 2000): Promise<{ ms: number; parallel: boolean }> {
    const t0 = performance.now()
    this.dispatch()
    if (!this.view.canCompileParallel()) {
      this.compileLater = true
      return { ms: performance.now() - t0, parallel: false }
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    await Promise.race([
      this.view.precompile(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      })
    ])
    if (timer) clearTimeout(timer)
    return { ms: performance.now() - t0, parallel: true }
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.audio?.start()
    this.last = performance.now()
    const loop = (now: number): void => {
      if (!this.running) return
      this.raf = requestAnimationFrame(loop)
      this.frame(now)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
  }

  resize(w: number, h: number, insets: { top: number; bottom: number; side: number }): void {
    this.cssW = Math.max(1, w)
    this.cssH = Math.max(1, h)
    this.view.setSize(this.cssW, this.cssH, insets)
    this.game.setShelfInView(this.view.desk.shelfInView)
  }

  // ─── Desk bookshelf (roadmap #2) ─────────────────────────────────────────

  /** The saved progress the shelf shows (boot, and whenever the save changes). */
  setShelfProgress(p: ShelfProgress): void {
    this.game.setShelfProgress(p)
  }

  /** The HUD's zoom button: out to the shelf, or back to the book. */
  toggleShelf(): boolean {
    this.gestures.cancel()
    return this.game.toggleShelf()
  }

  closeShelf(): boolean {
    return this.game.closeShelf()
  }

  setPaused(p: boolean): void {
    if (this.game.paused === p) return
    this.game.paused = p
    if (p) this.gestures.cancel()
    this.audio?.muffle(p ? 0.85 : 0)
    // A page still printed in an old look is reprinted behind the menu.
    if (p && this.lookPending) this.queueLook()
  }

  // ─── Looks (roadmaps #6, #17) ────────────────────────────────────────────

  /**
   * The equipped cosmetics or the season changed. The confetti changes at
   * once; the atlas and page repaints run in idle time, and the page in play
   * only while paused (see `GameView`'s header) — so an equip never hitches
   * a fold.
   */
  setLook(look: Look): void {
    if (!this.view.setLook(look)) return
    this.lookPending = true
    this.queueLook()
  }

  private queueLook(): void {
    if (this.lookQueued || this.disposed) return
    this.lookQueued = true
    const run = (): void => {
      this.lookQueued = false
      if (this.disposed) return
      this.lookPending = this.view.applyLook(this.game.paused)
    }
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback
    if (ric) ric(run, { timeout: 600 })
    else setTimeout(run, 50)
  }

  setVolumes(sfx: number, music: number): void {
    this.audio?.setVolumes(sfx, music)
  }

  setQuality(q: 'auto' | 'high' | 'low'): void {
    this.view.renderer.scaleLock = q === 'auto' ? null : q === 'high' ? 1 : 0.62
    this.view.setSize(this.cssW, this.cssH)
  }

  setShake(on: boolean): void {
    this.view.desk.reducedMotion = !on
    // Lesson demonstrations play once instead of looping (roadmap #4).
    const prefers = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    this.game.reducedMotion = !on || prefers
  }

  setHaptics(on: boolean): void {
    haptics.setEnabled(on)
  }

  // ─── Accessibility (roadmap #14) ─────────────────────────────────────────

  /** Press and hold instead of swiping (swipes keep working too). */
  setHoldToFold(on: boolean): void {
    // The lesson demonstrations show the press and hold too.
    this.game.holdToFold = on
    if (this.gestures.holdToFold === on) return
    this.gestures.cancel()
    this.gestures.holdToFold = on
  }

  /** The world at 0.75× (sim time only: the player's folds stay on the real clock). */
  setSlowMode(on: boolean): void {
    this.game.worldScale = on ? SLOW_MODE_SCALE : 1
  }

  /** How actionable things are marked: pulsing, steady, or bold with an ink-edged halo. */
  setHighlightMode(mode: HighlightMode): void {
    this.view.renderer.setHighlight(mode)
  }

  project(x: number, y: number, z: number, out: ScreenPoint): ScreenPoint {
    return this.view.project(x, y, z, out)
  }

  // ─── Dragon Rush (roadmap #16) and page secrets (roadmap #15) ────────────

  /** A book's Dragon Rush: its dragon alone, faster, against the clock. */
  startRush(book: BookId): void {
    this.gestures.cancel()
    this.view.units.showCrowd(false)
    this.game.startRun({ mode: 'dragonRush', book })
  }

  /** The rush result's "again". */
  restartRush(): boolean {
    this.gestures.cancel()
    return this.game.restartRush()
  }

  /** Night mode as saved (the desk lamp's secret). */
  setNight(on: boolean): void {
    this.game.setNight(on)
  }

  /** The secrets the save says were found (boot, a late cloud hydrate). */
  setSecretsFound(ids: readonly string[]): void {
    this.game.setSecretsFound(ids)
  }

  /** Screen point (CSS px) of the desk lamp, as drawn (tests). */
  lampScreen(out: ScreenPoint): ScreenPoint {
    return this.view.lampScreen(out)
  }

  /** Start over from page 1 of a book (Play again / pick a book). */
  newRun(book: BookId = this.game.book): void {
    this.gestures.cancel()
    this.view.units.showCrowd(false)
    this.game.startRun(1, 0, book)
  }

  jumpTo(page: PageId, score = this.game.score, book: BookId = this.game.book): void {
    this.gestures.cancel()
    this.view.units.showCrowd(false)
    this.game.startRun(page, score, book)
  }

  /** Repaint the printed story lines (font loaded / language changed). */
  refreshCaptions(): void {
    this.view.refreshCaptions(true)
  }

  /** Test/debug: run the simulation `seconds` ahead in fixed steps. */
  fastForward(seconds: number): void {
    const g = this.game
    const step = 1 / 60
    for (let t = 0; t < seconds; t += step) {
      g.update(step)
      const ev = g.events
      for (let i = 0; i < ev.count; i++) {
        const e = ev.items[i]!
        this.view.onEvent(e)
        this.hooks.onEvent(e, g)
      }
      ev.clear()
      this.view.update(step)
    }
  }

  restartPage(): void {
    this.gestures.cancel()
    this.game.forfeitPage()
  }

  /** The Almost! moment's Try again. Returns true if a page dropped. */
  tryAgain(): boolean {
    this.gestures.cancel()
    return this.game.tryAgain()
  }

  /** Rewarded second chance (roadmap #19): may the last heart hold for an offer? */
  setSecondChance(on: boolean): void {
    this.game.setSecondChance(on)
  }

  /** The second-chance ad was watched: one heart back. */
  restoreHeart(): boolean {
    this.gestures.cancel()
    return this.game.restoreHeart()
  }

  /** The second chance was turned down (or had no ad): the page crumples. */
  declineSecondChance(): boolean {
    return this.game.declineSecondChance()
  }

  dispose(): void {
    this.disposed = true
    this.stop()
    this.detach()
    if (this.warmTimer) clearTimeout(this.warmTimer)
    this.audio?.dispose()
    this.view.dispose()
  }

  // ─── Frame ───────────────────────────────────────────────────────────────

  private frame(now: number): void {
    const dtMs = now - this.last
    this.last = now
    const dt = Math.min(0.05, Math.max(0, dtMs / 1000))
    const g = this.game
    // Hold to fold (roadmap #14) advances with the real clock, not the world's.
    this.gestures.frame(now)
    g.update(dt)
    this.view.update(g.paused ? dt * 0.25 : dt)
    this.dispatch()
    this.view.render()
    this.audio?.update()
    this.view.renderer.sample(dtMs, now)
    this.hooks.onFrame?.(g, dt)
  }

  /** Events: view (VFX), audio, haptics, then the HUD / persistence hooks. */
  private dispatch(): void {
    const g = this.game
    const ev = g.events
    for (let i = 0; i < ev.count; i++) {
      const e = ev.items[i]!
      this.view.onEvent(e)
      this.audio?.onEvent(e, g)
      this.hapticFor(e)
      this.hooks.onEvent(e, g)
      if (e.type === 'pageIntro') this.scheduleWarm(e.a as PageId)
    }
    ev.clear()
  }

  private hapticFor(e: FoldEvent): void {
    switch (e.type) {
      case 'foldSnap':
        haptics.snap()
        break
      case 'foldStamp':
        haptics.stamp(e.c === 1)
        break
      case 'tear':
      case 'bossHurt':
        haptics.tear()
        break
      case 'heroHit':
        haptics.hit()
        break
      case 'victory':
      case 'pageCleared':
        haptics.success()
        break
    }
  }

  /**
   * Paint the next page's art (and the atlas frames page 1 doesn't need) while
   * the player is busy with this one — but never before the first press: until
   * then the boot owns the main thread (roadmap #13). The work runs in idle
   * time; a player who never touches the page gets it after `WARM_UNTOUCHED`.
   */
  private scheduleWarm(page: PageId): void {
    if (this.warmTimer) clearTimeout(this.warmTimer)
    this.warmTimer = null
    this.warmPage = page < 6 ? ((page + 1) as PageId) : 0
    if (this.touched) this.armWarm(WARM_AFTER_INTRO)
    else this.armWarm(WARM_UNTOUCHED)
  }

  private armWarm(delay: number): void {
    if (this.warmTimer) clearTimeout(this.warmTimer)
    this.warmTimer = setTimeout(() => {
      this.warmTimer = null
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback
      const run = (): void => this.warmNow()
      if (ric) ric(run, { timeout: 2500 })
      else run()
    }, delay)
  }

  private warmNow(): void {
    if (this.disposed) return
    // No parallel compile at boot: issue the programs the first page hasn't drawn yet
    // (marchers, effects, the shelf) now, so the driver links them before they appear.
    if (this.compileLater) {
      this.compileLater = false
      void this.view.precompile()
    }
    this.view.warmArt()
    const next = this.warmPage
    this.warmPage = 0
    if (next) this.view.warm(next)
  }

  /** The first press: whatever warm-up was waiting on it can start soon. */
  private firstTouch(): void {
    this.touched = true
    this.hooks.onFirstInput?.()
    this.armWarm(WARM_AFTER_TOUCH)
  }

  // ─── Input ───────────────────────────────────────────────────────────────

  private pointer(kind: 'down' | 'move' | 'up' | 'cancel', e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const now = performance.now()
    if (kind === 'down') {
      if (!this.touched) this.firstTouch()
      this.audio?.start()
      if (this.audio && this.audio.ctx.state === 'suspended') void this.audio.ctx.resume().catch(() => undefined)
    }
    if (this.shelfPointer(kind, e.pointerId, x, y, now)) return
    if (this.lampPointer(kind, e.pointerId, x, y, now)) return
    if (kind === 'down') {
      try {
        this.canvas.setPointerCapture(e.pointerId)
      } catch {
        /* synthetic events in tests */
      }
      this.gestures.down(e.pointerId, x, y, now)
    } else if (kind === 'move') {
      this.gestures.move(e.pointerId, x, y, now)
    } else if (kind === 'up') {
      this.gestures.up(e.pointerId, x, y, now)
    } else {
      this.gestures.up(e.pointerId, x, y, now - 10_000)
    }
  }

  /**
   * Taps on the desk bookshelf go to the game's shelf API instead of the
   * gesture recognizer: every pointer while the camera is out at the shelf,
   * and a press on a book of a shelf the play camera already shows. A tap
   * (short, barely moved) picks what is under it. Returns true if taken.
   */
  private shelfPointer(kind: 'down' | 'move' | 'up' | 'cancel', id: number, x: number, y: number, now: number): boolean {
    const g = this.game
    const s = g.shelf
    if (kind === 'down') {
      if (this.shelfPtr !== -1) return s.open
      let hit = SHELF_NONE
      if (!s.open) {
        if (!s.inView || !g.canOpenShelf()) return false
        hit = this.view.pickShelf(x, y)
        if (hit < 0) return false
      }
      this.shelfPtr = id
      this.shelfX = x
      this.shelfY = y
      this.shelfT = now
      this.shelfHit = hit
      return true
    }
    if (id !== this.shelfPtr) return s.open
    if (kind === 'move') return true
    this.shelfPtr = -1
    const slop = Math.min(this.cssW, this.cssH) * 0.04
    const tap = kind === 'up' && now - this.shelfT < 700 && Math.hypot(x - this.shelfX, y - this.shelfY) < slop
    if (!tap) return true
    if (s.open) g.shelfTap(this.view.pickShelf(x, y))
    else if (this.shelfHit >= 0) {
      this.gestures.cancel()
      g.openShelf('tap', this.shelfHit)
    }
    return true
  }

  /**
   * A tap on the desk lamp (the desk's secret) goes to `tapLamp` instead of
   * the gesture recognizer. The lamp stands behind the book, off the page, so
   * it never takes a press meant for a fold. Returns true if taken.
   */
  private lampPointer(kind: 'down' | 'move' | 'up' | 'cancel', id: number, x: number, y: number, now: number): boolean {
    if (kind === 'down') {
      if (this.lampPtr !== -1 || this.game.shelf.open || this.game.paused || !this.view.pickLamp(x, y)) return false
      this.lampPtr = id
      this.lampX = x
      this.lampY = y
      this.lampT = now
      return true
    }
    if (id !== this.lampPtr) return false
    if (kind === 'move') return true
    this.lampPtr = -1
    const slop = Math.min(this.cssW, this.cssH) * 0.04
    if (kind === 'up' && now - this.lampT < 700 && Math.hypot(x - this.lampX, y - this.lampY) < slop) this.game.tapLamp()
    return true
  }

  /** Screen y (CSS px) of the desk bookshelf's top, +Infinity while it isn't drawn (HUD layout). */
  shelfTop(): number {
    return this.view.shelfTop()
  }

  /** Screen point (CSS px) of a shelf slot's spine centre, as drawn (tests, the ghost hand). */
  shelfScreen(slot: number, out: ScreenPoint): ScreenPoint {
    const a = this.view.shelf.anchorOf(slot, 0.5)
    return this.view.project(a.x, a.y, a.z, out)
  }

  private feedback(kind: GestureFeedback, value: number): void {
    if (kind === 'grab') haptics.grab()
    else haptics.dragTick()
    this.audio?.dragTick(value, kind === 'tearTick' ? 'tear' : kind === 'peelTick' ? 'peel' : 'fold')
  }
}
