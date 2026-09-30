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
import type { BookId, PageDef, PageId } from './logic/types'
import { GestureRecognizer, type GestureFeedback } from './input/gestures'
import { GameView, type ScreenPoint } from './render/GameView'
import { FoldAudio } from './audio/FoldAudio'
import { haptics } from './haptics'
import { getAudioContext } from '@/use/useAssets'

export interface EngineHooks {
  /** Every simulation event, after the view and audio have reacted. */
  onEvent(e: FoldEvent, game: FoldGame): void
  /** Comic words the view wants shown at a screen point. */
  word(key: string, x: number, y: number, size: number, tone: string): void
  /** Called once per frame after rendering (cheap HUD sync). */
  onFrame?(game: FoldGame, dt: number): void
  /** The storybook line printed on a page. */
  caption?(def: PageDef): string
}

export interface EngineOptions extends GameOptions {
  startPage?: PageId
  startScore?: number
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
  private readonly onPointerDown = (e: PointerEvent) => this.pointer('down', e)
  private readonly onPointerMove = (e: PointerEvent) => this.pointer('move', e)
  private readonly onPointerUp = (e: PointerEvent) => this.pointer('up', e)
  private readonly onPointerCancel = (e: PointerEvent) => this.pointer('cancel', e)
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
    })
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
  }

  setPaused(p: boolean): void {
    if (this.game.paused === p) return
    this.game.paused = p
    if (p) this.gestures.cancel()
    this.audio?.muffle(p ? 0.85 : 0)
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

  project(x: number, y: number, z: number, out: ScreenPoint): ScreenPoint {
    return this.view.project(x, y, z, out)
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

  dispose(): void {
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
    g.update(dt)
    this.view.update(g.paused ? dt * 0.25 : dt)
    // Events: view (VFX), audio, haptics, then the HUD / persistence hooks.
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
    this.view.render()
    this.audio?.update()
    this.view.renderer.sample(dtMs, now)
    this.hooks.onFrame?.(g, dt)
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

  /** Paint the next page's art while the player is busy with this one. */
  private scheduleWarm(page: PageId): void {
    if (this.warmTimer) clearTimeout(this.warmTimer)
    if (page >= 6) return
    const next = (page + 1) as PageId
    this.warmTimer = setTimeout(() => {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback
      const run = () => this.view.warm(next)
      if (ric) ric(run, { timeout: 2500 })
      else run()
    }, 2200)
  }

  // ─── Input ───────────────────────────────────────────────────────────────

  private pointer(kind: 'down' | 'move' | 'up' | 'cancel', e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const now = performance.now()
    if (kind === 'down') {
      this.audio?.start()
      if (this.audio && this.audio.ctx.state === 'suspended') void this.audio.ctx.resume().catch(() => undefined)
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

  private feedback(kind: GestureFeedback, value: number): void {
    if (kind === 'grab') haptics.grab()
    else haptics.dragTick()
    this.audio?.dragTick(value, kind === 'tearTick' ? 'tear' : kind === 'peelTick' ? 'peel' : 'fold')
  }
}
