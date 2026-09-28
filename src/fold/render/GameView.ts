/**
 * GameView — the three.js side of Castle Fold, driven entirely by FoldGame.
 *
 * Owns the scene (desk, book, the current page and the one being revealed),
 * the lamp, units, projectiles, VFX and the transition sheet. Each frame it
 * mirrors the simulation, turns simulation events into juice, projects
 * interactive anchors (tear creases, dragon weak points) back onto the page
 * plane for the gesture layer, and renders through the ink pipeline.
 */

import { Color, Scene, SpotLight, Vector3, type WebGLRenderTarget } from 'three'
import type { FoldGame } from '../logic/game'
import type { FoldEvent } from '../logic/events'
import { KILL_CRUSH, KILL_FLING, KILL_LAUNCH, KILL_RIDGE, KILL_TEAR } from '../logic/events'
import { PAGE_TURN_TIME, CRUMPLE_TIME, PAGE_DROP_TIME } from '../logic/config'
import { PAGES } from '../logic/pages'
import type { PageId } from '../logic/types'
import { createFold } from '../logic/folds'
import { clamp01, easeInOutCubic } from '../logic/math'
import { FoldRenderer } from './FoldRenderer'
import { DeskCamera, type CameraFrame } from './camera'
import { paperGlobals } from './paperMaterial'
import { HEX } from './palette'
import { BookView } from './views/BookView'
import { PageView } from './views/PageView'
import { UnitsView, type SurfaceSampler } from './views/UnitsView'
import { ProjectilesView } from './views/ProjectilesView'
import { Effects } from './views/Effects'
import { SheetView } from './views/SheetView'
import { createStandeeAtlas, type StandeeAtlas } from './art/standeeArt'
import { createSpriteTextures, type SpriteTextures } from './art/spriteArt'
import { paintPlainSheet } from './art/pageArt'
import { disposeModelCache } from './models'

export interface ScreenPoint {
  x: number
  y: number
  visible: boolean
}

/** What the view tells the HUD (comic words at a screen point, etc.). */
export interface ViewSignals {
  word(key: string, x: number, y: number, size?: number, tone?: string): void
}

export class GameView {
  readonly renderer: FoldRenderer
  readonly scene = new Scene()
  readonly desk = new DeskCamera()
  readonly book: BookView
  readonly units: UnitsView
  readonly projectiles: ProjectilesView
  readonly effects: Effects
  readonly sheet: SheetView
  readonly lamp: SpotLight
  readonly atlas: StandeeAtlas
  readonly sprites: SpriteTextures
  page: PageView | null = null
  /** A page built ahead (under a turning/peeling sheet). */
  private incoming: PageView | null = null
  private incomingId: PageId | null = null
  private snapshotRT: WebGLRenderTarget | null = null
  private snapshotMRT: WebGLRenderTarget | null = null
  private transition: 'none' | 'turn' | 'peel' | 'crumple' | 'drop' = 'none'
  private transT = 0
  private flash = 0
  private white = 0
  private time = 0
  private lastPhase = ''
  private breathTimer = 0
  private width = 1
  private height = 1
  private readonly frame: CameraFrame = { top: 0.1, bottom: 0.03, side: 0.02 }
  private readonly tmp = new Vector3()
  private readonly surface: SurfaceSampler
  private leftPageArt: PageView['textures'] | null = null

  constructor(canvas: HTMLCanvasElement, private readonly game: FoldGame, private readonly signals: ViewSignals) {
    this.renderer = new FoldRenderer({ canvas })
    this.scene.background = new Color(HEX.deskDark)
    this.atlas = createStandeeAtlas()
    this.sprites = createSpriteTextures()

    // The desk lamp: a warm spot straight above, hard shadows (GDD §2).
    this.lamp = new SpotLight(0xffffff, 1, 60, 0.6, 0.35, 0)
    this.lamp.position.copy(paperGlobals.uLampPos.value)
    this.lamp.target.position.set(0, 0, 0.3)
    this.lamp.castShadow = true
    const size = this.renderer.isMobile ? 1024 : 2048
    this.lamp.shadow.mapSize.set(size, size)
    this.lamp.shadow.bias = -0.0006
    this.lamp.shadow.normalBias = 0.02
    this.lamp.shadow.camera.near = 6
    this.lamp.shadow.camera.far = 40
    this.scene.add(this.lamp, this.lamp.target)
    paperGlobals.uLampDir.value.subVectors(this.lamp.target.position, this.lamp.position).normalize()

    this.book = new BookView()
    this.scene.add(this.book.group)
    this.units = new UnitsView(this.atlas)
    this.scene.add(this.units.group)
    this.projectiles = new ProjectilesView()
    this.scene.add(this.projectiles.group)
    this.effects = new Effects(this.sprites, this.renderer.overlay)
    this.scene.add(this.effects.group)
    this.sheet = new SheetView(paintPlainSheet(99))
    this.scene.add(this.sheet.mesh)

    this.surface = {
      dip: (fold, x, z) => this.page?.dip(fold, x, z) ?? 0,
      stand: (x, z) => this.page?.stand(x, z) ?? 0
    }
  }

  // ─── Layout ──────────────────────────────────────────────────────────────

  setSize(w: number, h: number, frame?: Partial<CameraFrame>): void {
    this.width = w
    this.height = h
    if (frame) Object.assign(this.frame, frame)
    this.renderer.setSize(w, h)
    this.desk.fit(w / Math.max(1, h), this.frame)
  }

  /** CSS-pixel screen position of a world point (for DOM overlays). */
  project(x: number, y: number, z: number, out: ScreenPoint): ScreenPoint {
    this.tmp.set(x, y, z).project(this.desk.camera)
    out.x = (this.tmp.x * 0.5 + 0.5) * this.width
    out.y = (-this.tmp.y * 0.5 + 0.5) * this.height
    out.visible = this.tmp.z < 1
    return out
  }

  /** Screen (CSS px) → page plane (y = 0). */
  unproject(sx: number, sy: number, out: { x: number; z: number }): boolean {
    const cam = this.desk.camera
    this.tmp.set((sx / this.width) * 2 - 1, -(sy / this.height) * 2 + 1, 0.5).unproject(cam)
    const dx = this.tmp.x - cam.position.x
    const dy = this.tmp.y - cam.position.y
    const dz = this.tmp.z - cam.position.z
    if (Math.abs(dy) < 1e-6) return false
    const k = -cam.position.y / dy
    if (k <= 0) return false
    out.x = cam.position.x + dx * k
    out.z = cam.position.z + dz * k
    return true
  }

  /** Ground-plane point under the screen position of a world point. */
  private groundOf(p: Vector3, out: { x: number; z: number }): void {
    const cam = this.desk.camera.position
    const dy = p.y - cam.y
    const k = Math.abs(dy) < 1e-6 ? 0 : -cam.y / dy
    out.x = cam.x + (p.x - cam.x) * k
    out.z = cam.z + (p.z - cam.z) * k
  }

  // ─── Pages ───────────────────────────────────────────────────────────────

  private buildPage(id: PageId, folds = this.game.folds): PageView {
    const v = new PageView(PAGES[id], folds, this.sprites, this.renderer.overlay)
    this.scene.add(v.group)
    return v
  }

  /** Build the page the player is about to see (under a turn/peel). */
  private prebuild(id: PageId, visible = true): void {
    if (this.incomingId === id && this.incoming) {
      this.incoming.group.visible = visible
      return
    }
    this.incoming?.dispose()
    this.incoming?.group.removeFromParent()
    // Placeholder fold states until the real ones arrive with loadPage.
    const folds = PAGES[id].folds.map(createFold)
    for (const f of folds) if (f.def.fromWave === 0) f.phase = 'ready'
    this.incoming = this.buildPage(id, folds)
    this.incoming.group.visible = visible
    this.incomingId = id
  }

  private adoptPage(): void {
    const g = this.game
    const id = g.pageId
    // Same page again (restart / drop): keep the painted page, re-bind its folds.
    if (this.page && this.page.def.id === id) {
      this.page.bindFolds(g.folds)
      this.page.group.visible = true
      this.page.intro = 0
      return
    }
    const old = this.page
    let next: PageView
    if (this.incoming && this.incomingId === id) {
      next = this.incoming
      this.incoming = null
      this.incomingId = null
      next.bindFolds(g.folds)
      next.group.visible = true
    } else {
      next = this.buildPage(id)
    }
    if (old) {
      if (this.transition === 'turn') {
        // The turned page's illustration becomes the book's left-hand page.
        const art = old.textures.art
        old.textures.page.dispose()
        old.textures.dispose = () => undefined
        this.leftPageArt?.dispose()
        this.leftPageArt = { art, page: art, dispose: () => art.dispose() }
        this.book.setLeftPage(art)
      }
      old.dispose()
      old.group.removeFromParent()
    }
    this.page = next
  }

  // ─── Snapshots ───────────────────────────────────────────────────────────

  private snapshot(): void {
    const w = Math.min(1280, this.renderer.drawingWidth)
    const h = Math.round((w * this.renderer.drawingHeight) / this.renderer.drawingWidth)
    if (!this.snapshotRT || this.snapshotRT.width !== w || this.snapshotRT.height !== h) {
      this.snapshotRT?.dispose()
      this.snapshotMRT?.dispose()
      this.snapshotRT = this.renderer.createColorTarget(w, h)
      this.snapshotMRT = this.renderer.createPipelineTarget(w, h)
    }
    this.sheet.hide()
    this.renderer.renderTo(this.scene, this.desk.camera, this.snapshotRT, this.snapshotMRT!)
    this.sheet.bind(this.snapshotRT.texture, this.desk.camera)
  }

  // ─── Events → juice ──────────────────────────────────────────────────────

  private readonly sp: ScreenPoint = { x: 0, y: 0, visible: false }

  private wordAt(key: string, x: number, y: number, z: number, size = 1, tone = 'default'): void {
    this.project(x, y, z, this.sp)
    this.signals.word(key, this.sp.x, this.sp.y, size, tone)
  }

  onEvent(e: FoldEvent): void {
    const g = this.game
    const fx = this.effects
    switch (e.type) {
      case 'foldSnap': {
        const f = g.folds[e.a]
        if (!f) break
        const k = f.def.kind
        this.desk.shake(k === 'ridge' ? 0.14 : 0.1)
        this.desk.kick(0.6)
        fx.ring(e.x, e.z, k === 'valley' ? 3 : 2.3, 0.4)
        fx.burst(e.x, 0.2, e.z, { count: 16, palette: 'paper', speed: 3, up: 3, size: 0.9 })
        if (e.b > 0) fx.burst(e.x, 1, e.z - 0.8, { count: 22 + e.b * 10, palette: 'festive', speed: 4.5, up: 6 })
        if (k === 'frog') break
        this.wordAt(k === 'wall' || k === 'ridge' ? 'snap' : k === 'valley' ? 'fold' : 'fling', e.x, 1.2, e.z, 1 + e.b * 0.08, 'snap')
        break
      }
      case 'foldStamp': {
        this.desk.shake(e.c ? 0.2 : 0.14)
        this.desk.kick(1)
        fx.ring(e.x, e.z, 3.2, 0.5)
        fx.burst(e.x, 0.05, e.z, { count: 30, palette: 'paper', speed: 6, up: 1.6, size: 0.8 })
        if (e.b > 0) fx.burst(e.x, 0.3, e.z, { count: 26 + e.b * 12, palette: 'festive', speed: 5, up: 5 })
        this.wordAt('stamp', e.x, 0.6, e.z, 1.1 + e.b * 0.1, 'stamp')
        this.white = e.c ? 0.25 : 0.12
        break
      }
      case 'foldBreak': {
        const f = g.folds[e.a]
        if (!f) break
        fx.burst(f.cx, 0.8, f.cz, { count: 24, palette: 'paper', speed: 4, up: 4, size: 1.3 })
        this.wordAt('rip', f.cx, 1, f.cz, 0.9, 'rip')
        break
      }
      case 'lensHit': {
        this.project(e.x, 3, e.z, this.sp)
        const sx = Math.max(-0.8, Math.min(0.8, (this.sp.x / this.width) * 2 - 1))
        const sy = Math.max(-0.8, Math.min(0.8, -(this.sp.y / this.height) * 2 + 1))
        fx.lensBurst(this.desk.camera, sx, sy)
        this.desk.shake(0.05)
        break
      }
      case 'kill': {
        if (e.c === KILL_CRUSH) fx.burst(e.x, 0.1, e.z, { count: 14, palette: 'enemy', speed: 3.5, up: 3 })
        else if (e.c === KILL_TEAR || e.c === KILL_FLING) fx.burst(e.x, 0.6, e.z, { count: 18, palette: 'festive', speed: 4, up: 5 })
        else if (e.c === KILL_RIDGE) fx.burst(e.x, 0.8, e.z, { count: 10, palette: 'festive', speed: 3, up: 4 })
        else if (e.c === KILL_LAUNCH) fx.burst(e.x, 0.4, e.z, { count: 8, palette: 'festive', speed: 2.5, up: 5 })
        break
      }
      case 'tear': {
        this.desk.shake(0.16)
        this.desk.kick(0.7)
        fx.ring(e.x, e.z, 3, 0.55, 'highlight')
        fx.burst(e.x, 1.4, e.z - 0.6, { count: 60, palette: 'festive', speed: 5.5, up: 7 })
        fx.burst(e.x, 1, e.z - 0.6, { count: 26, palette: 'paper', speed: 4, up: 5, size: 1.6 })
        fx.glow(e.x, 1.2, e.z - 0.8, 4, 0.7, 'gear', 'gearGlow', 3)
        this.wordAt('rip', e.x, 2.2, e.z - 0.6, 1.3, 'rip')
        break
      }
      case 'blocked': {
        fx.burst(e.x, 0.7, e.z, { count: e.c === 3 ? 30 : 8, palette: e.c === 3 ? 'flame' : 'paper', speed: 3, up: 3, size: e.c === 3 ? 1.4 : 0.8 })
        if (e.c === 3) this.wordAt('blocked', e.x, 1.4, e.z, 1.1, 'good')
        break
      }
      case 'impact': {
        if (e.b === 2) {
          // The flung catapult crashes onto the archers.
          this.desk.shake(0.2)
          fx.ring(e.x, e.z, 2.6, 0.5)
          fx.burst(e.x, 0.4, e.z, { count: 50, palette: 'festive', speed: 5, up: 6 })
          fx.burst(e.x, 0.3, e.z, { count: 20, palette: 'paper', speed: 5, up: 3, size: 1.4 })
          this.wordAt('crash', e.x, 1.2, e.z, 1.2, 'stamp')
        } else if (e.b === 4) {
          fx.burst(e.x, 0.1, e.z, { count: 12, palette: 'paper', speed: 3, up: 2 })
          fx.ring(e.x, e.z, 1.2, 0.35)
        } else if (e.b === 1) {
          fx.burst(e.x, 0.2, e.z, { count: 12, palette: 'festive', speed: 3, up: 3 })
        }
        break
      }
      case 'heroHit': {
        this.flash = 1
        this.desk.shake(0.22)
        fx.burst(g.hero.x - 0.55 + e.b * 0.55, 1.8, g.hero.z, { count: 16, palette: 'enemy', speed: 3, up: 4 })
        break
      }
      case 'crumple': {
        this.snapshot()
        this.sheet.start('crumple')
        if (this.page) this.page.group.visible = false
        this.units.group.visible = false
        this.projectiles.group.visible = false
        this.transition = 'crumple'
        this.transT = 0
        break
      }
      case 'pageDrop': {
        this.transition = 'drop'
        this.transT = 0
        this.adoptPage()
        this.units.group.visible = true
        this.projectiles.group.visible = true
        break
      }
      case 'pageIntro': {
        if (this.transition === 'drop') break
        this.adoptPage()
        if (this.transition !== 'turn' && this.transition !== 'peel') this.transition = 'none'
        this.units.group.visible = true
        this.projectiles.group.visible = true
        break
      }
      case 'pageTurn': {
        this.snapshot()
        this.sheet.start('turn')
        if (this.page) this.page.group.visible = false
        this.units.group.visible = false
        this.projectiles.group.visible = false
        this.prebuild(Math.min(6, e.b) as PageId)
        this.transition = 'turn'
        this.transT = 0
        break
      }
      case 'pageCleared': {
        fx.burst(-4, 2, 3, { count: 40, palette: 'festive', speed: 4, up: 7, dirX: 0.5 })
        fx.burst(4, 2, 3, { count: 40, palette: 'festive', speed: 4, up: 7, dirX: -0.5 })
        if (e.b) this.wordAt('perfect', 0, 2, 1, 1.3, 'good')
        break
      }
      case 'bossPhase': {
        const b = g.boss
        if (b.phase === 'rumble') this.desk.shake(0.08)
        if (b.phase === 'unfold') {
          this.desk.setZoom(1.06)
          this.desk.shake(0.15)
        }
        if (b.phase === 'roar') {
          this.desk.shake(0.32)
          this.wordAt('roar', 0, 4.4, -2.4, 1.6, 'roar')
          fx.burst(0, 3.5, -2, { count: 40, palette: 'dragon', speed: 5, up: 5 })
        }
        if (b.phase === 'idle') this.desk.setZoom(1.04)
        if (b.phase === 'collapse') {
          this.desk.setZoom(1)
          fx.burst(0, 2, -3.5, { count: 90, palette: 'dragon', speed: 6, up: 7 })
        }
        break
      }
      case 'bossBreath':
        this.breathTimer = 1.05
        break
      case 'bossStomp': {
        this.desk.shake(0.24)
        this.desk.kick(0.8)
        fx.ring(e.x, e.z, 3.4, 0.5)
        fx.ring(-e.x, e.z, 2.4, 0.5)
        fx.burst(e.x, 0.1, e.z, { count: 26, palette: 'paper', speed: 5, up: 2.5 })
        break
      }
      case 'bossHurt': {
        const w = g.boss.weakPoints[e.a]
        const a = this.page?.dragon?.anchors[e.a]
        if (a) {
          fx.burst(a.x, a.y, a.z, { count: 70, palette: 'dragon', speed: 6, up: 5 })
          fx.burst(a.x, a.y, a.z, { count: 30, palette: 'gold', speed: 4, up: 5 })
          fx.glow(a.x, a.y, a.z, 3.5, 0.6, 'star', 'highlightHot', 4)
          this.project(a.x, a.y, a.z, this.sp)
          this.signals.word(w?.mode === 'crease' ? 'crease' : 'rip', this.sp.x, this.sp.y - 30, 1.4, 'crease')
        }
        this.desk.shake(0.25)
        this.white = 0.3
        break
      }
      case 'frog':
        this.desk.shake(0.08)
        break
      case 'victory': {
        this.units.showCrowd(true)
        for (let i = 0; i < 5; i++) fx.burst(-4 + i * 2, 3 + (i % 2), -1 + (i % 3), { count: 70, palette: 'festive', speed: 5.5, up: 8 })
        break
      }
      case 'tap':
        fx.ring(e.x, e.z, 0.7, 0.25, 'inkSoft')
        break
      case 'combo':
        if (e.b === 3 || e.b === 5 || e.b >= 8) this.wordAt('combo', 0, 2.5, 2.5, 1 + Math.min(0.6, e.b * 0.05), 'combo')
        break
    }
  }

  // ─── Frame ───────────────────────────────────────────────────────────────

  update(dt: number): void {
    const g = this.game
    this.time += dt
    paperGlobals.uTime.value = this.time
    paperGlobals.uPulse.value = 0.5 + 0.5 * Math.sin(this.time * 6.5)

    // Peel: the sheet follows the finger.
    if (g.phase === 'peel') {
      if (this.transition !== 'peel') {
        this.snapshot()
        this.sheet.start('peel')
        if (this.page) this.page.group.visible = false
        this.units.group.visible = false
        this.projectiles.group.visible = false
        this.prebuild(5)
        this.transition = 'peel'
      }
      this.sheet.set(easeInOutCubic(clamp01(g.peel)) * 1.02)
    }

    switch (this.transition) {
      case 'turn': {
        this.transT += dt
        const k = clamp01(this.transT / PAGE_TURN_TIME)
        this.sheet.set(easeInOutCubic(k))
        if (k >= 1 && g.phase !== 'turn') {
          this.sheet.hide()
          this.transition = 'none'
        }
        break
      }
      case 'peel':
        if (g.phase !== 'peel' && g.pageId === 5) {
          this.sheet.hide()
          this.transition = 'none'
        }
        break
      case 'crumple': {
        this.transT += dt
        const k = clamp01(this.transT / (CRUMPLE_TIME * 0.45))
        this.sheet.set(k)
        // After crumpling, throw the ball off to the side.
        const th = clamp01((this.transT - CRUMPLE_TIME * 0.45) / (CRUMPLE_TIME * 0.55))
        const m = this.sheet.mesh
        m.position.set(th * 14, Math.sin(th * Math.PI) * 5 + th * 2, -th * 4)
        m.rotation.set(th * 9, th * 6, th * 4)
        break
      }
      case 'drop': {
        this.transT += dt
        const k = clamp01(this.transT / PAGE_DROP_TIME)
        const p = this.page
        if (p) {
          const fall = 1 - k * k
          p.group.position.set(0, fall * 7, 0)
          p.group.rotation.set(Math.sin(k * 9) * 0.12 * (1 - k), 0, Math.sin(k * 7 + 1) * 0.15 * (1 - k))
          this.units.group.visible = k >= 1
          if (k >= 1) {
            p.group.position.set(0, 0, 0)
            p.group.rotation.set(0, 0, 0)
            this.effects.burst(0, 0.1, 0, { count: 60, palette: 'paper', speed: 7, up: 1.5, size: 1.2 })
            this.effects.ring(0, 0, 7, 0.5, 'inkSoft')
            this.desk.shake(0.12)
            this.sheet.hide()
            this.transition = 'none'
          }
        }
        break
      }
    }

    this.page?.update(g, this.time, dt)
    this.incoming?.update(g, this.time, dt)
    this.syncAnchors()
    this.units.update(g, this.surface, this.desk.camera, this.time, dt)
    this.projectiles.update(g, this.surface, this.time)

    // Dragon fire stream.
    if (this.breathTimer > 0) {
      this.breathTimer -= dt
      const d = this.page?.dragon
      if (d) {
        const m = d.mouth
        const dir = d.mouthDir
        this.effects.flame(m.x, m.y, m.z, dir.x, dir.y, dir.z, 6)
      }
    }
    // Finale puff.
    const fin = this.page?.finale
    if (fin?.popped) {
      this.effects.burst(0, 1.6, 0.6, { count: 80, palette: 'dragon', speed: 5, up: 5 })
      this.effects.glow(0, 1.2, 0.6, 5, 0.8, 'star', 'highlightHot', 3)
      this.wordAt('ribbit', 0, 2.4, 0.6, 1.3, 'good')
    }

    this.effects.update(dt)
    this.desk.update(dt)

    // Composite juice.
    this.flash = Math.max(0, this.flash - dt * 2.2)
    this.white = Math.max(0, this.white - dt * 3)
    const u = this.renderer.composite.uniforms
    u.uFlash!.value = this.flash
    u.uWhite!.value = this.white
    const focus = g.lesson.id && !g.lesson.hint ? 1 - Math.min(1, g.timeScale) : 0
    u.uFocus!.value += (focus - u.uFocus!.value) * Math.min(1, dt * 6)
    u.uDesat!.value += ((g.paused ? 0.75 : 0) - u.uDesat!.value) * Math.min(1, dt * 8)
    u.uPulse!.value = paperGlobals.uPulse.value
    if (g.phase !== this.lastPhase) this.lastPhase = g.phase
  }

  /** Move interactive anchors to where they *appear* on the page plane. */
  private syncAnchors(): void {
    const g = this.game
    const p = this.page
    if (!p) return
    if (p.castle) {
      for (const t of g.tears) {
        const a = p.castle.anchorOf(t.def.id)
        if (!a) continue
        this.groundOf(a, this.anchorOut)
        t.px = this.anchorOut.x
        t.pz = this.anchorOut.z
      }
    }
    if (p.dragon && g.pageId === 5) {
      const b = g.boss
      for (let i = 0; i < b.weakPoints.length; i++) {
        const w = b.weakPoints[i]!
        if (w.broken) continue
        this.groundOf(p.dragon.anchors[i]!, this.anchorOut)
        w.x = this.anchorOut.x
        w.z = this.anchorOut.z
      }
    }
  }

  private readonly anchorOut = { x: 0, z: 0 }

  render(): void {
    this.renderer.render(this.scene, this.desk.camera, this.time)
  }

  /** Prebuild a page's view off the hot path (idle time). */
  warm(id: PageId): void {
    if (this.game.pageId === id || this.incomingId === id) return
    this.prebuild(id, false)
  }

  dispose(): void {
    this.page?.dispose()
    this.incoming?.dispose()
    this.book.dispose()
    this.units.dispose()
    this.projectiles.dispose()
    this.effects.dispose()
    this.sheet.dispose()
    this.atlas.dispose()
    this.sprites.dispose()
    this.snapshotRT?.dispose()
    this.snapshotMRT?.dispose()
    this.leftPageArt?.dispose()
    disposeModelCache()
    this.renderer.dispose()
  }
}
