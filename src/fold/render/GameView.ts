/**
 * GameView — the three.js side of Aethel Fold, driven entirely by FoldGame.
 *
 * Owns the scene (desk, book, the current page and the one being revealed),
 * the lamp, units, projectiles, VFX and the transition sheet. Each frame it
 * mirrors the simulation, turns simulation events into juice, projects
 * interactive anchors (tear creases, dragon weak points) back onto the page
 * plane for the gesture layer, and renders through the ink pipeline.
 *
 * Looks (roadmaps #6, #17) — what the player equipped and the season:
 *   confetti chips   swapped at once (a geometry swap: free)
 *   hero, bats       atlas cells repainted in `applyLook` (idle time, ~1–3 ms)
 *   page paper       new pages are printed in the new look; the page in play is
 *                    reprinted only while the game is paused (the equip happens
 *                    in the pause menu, which hides the ~30 ms of canvas work),
 *                    otherwise it keeps its paper until the next page is built;
 *                    a hidden prebuilt page is reprinted in idle time, like the
 *                    warm-up that built it.
 */

import { Box3, Color, Mesh, Scene, SpotLight, Vector3, type WebGLRenderTarget } from 'three'
import type { FoldGame } from '../logic/game'
import type { FoldEvent } from '../logic/events'
import { BLOCK_BEARER, KILL_BOLT, KILL_CAPSIZE, KILL_CRUSH, KILL_FLING, KILL_LAUNCH, KILL_RIDGE, KILL_SHOT, KILL_TEAR } from '../logic/events'
import { CASTLE, DESK_LAMP, PAGE_TURN_TIME, CRUMPLE_TIME, PAGE_DROP_TIME, PAGE_HALF_D, PAGE_HALF_W, SHELF } from '../logic/config'
import { SECRET_IDS } from '../logic/secrets'
import { PAGE_COUNT, pageDef } from '../logic/pages'
import type { PageDef, PageId } from '../logic/types'
import { createFold } from '../logic/folds'
import { clamp01, easeInOutCubic, segmentDistance, smoothstep, v2 } from '../logic/math'
import { SHELF_DESK, SHELF_NONE, shelfHalfWidth } from '../logic/shelf'
import { createPaperMaterial, type PaperMaterial } from './paperMaterial'
import { FoldRenderer } from './FoldRenderer'
import { DeskCamera, type CameraFrame } from './camera'
import { paperGlobals } from './paperMaterial'
import { HEX } from './palette'
import { BookView, DESK_Y } from './views/BookView'
import { PageView } from './views/PageView'
import { UnitsView, type SurfaceSampler } from './views/UnitsView'
import { ProjectilesView } from './views/ProjectilesView'
import { Effects } from './views/Effects'
import { SheetView } from './views/SheetView'
import { ShelfView } from './views/ShelfView'
import { createStandeeAtlas, type StandeeAtlas } from './art/standeeArt'
import { createSpriteTextures, type SpriteTextures } from './art/spriteArt'
import { paintPlainSheet } from './art/pageArt'
import { boatGeometry, disposeModelCache } from './models'
import { BatsView } from './views/BatsView'
import { SnowView } from './views/SnowView'
import { OutroView } from './views/OutroView'
import { DEFAULT_LOOK, type Look } from '../logic/cosmetics'
import type { PageLook } from './art/pageArt'

export interface ScreenPoint {
  x: number
  y: number
  visible: boolean
}

/** What the view tells the HUD (comic words at a screen point, etc.). */
export interface ViewSignals {
  word(key: string, x: number, y: number, size?: number, tone?: string): void
  /** The storybook line printed on a page (localised by the host). */
  caption?(def: PageDef): string
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
  /** The desk bookshelf (roadmap #2). */
  readonly shelf: ShelfView
  readonly lamp: SpotLight
  readonly atlas: StandeeAtlas
  readonly sprites: SpriteTextures
  page: PageView | null = null
  /** A page built ahead (under a turning/peeling sheet). */
  private incoming: PageView | null = null
  private incomingDef: PageDef | null = null
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
  /** Night mode (roadmap #15), eased toward the game's `secrets.night` (real time). */
  private night = 0
  /**
   * The Ravine's secret (and the Harbour's regatta): a paper boat sailing
   * across the page along `boatZ` (seconds left, or 0), on the page it set
   * off on.
   */
  private readonly boat: Mesh
  private readonly boatMat: PaperMaterial
  private boatT = 0
  private boatZ = -1.3
  private boatPage: PageDef | null = null
  /** Halloween's bat standees (roadmap #17). */
  readonly bats: BatsView
  /** Winter's falling paper snow (roadmap #17). */
  readonly snow: SnowView
  /** Winter's daylight (roadmap #17): 0 = the warm desk lamp, 1 = crisp and cool; eased (real time). */
  private winterLight = 0
  private readonly lampWarmCol = new Color(HEX.lamp)
  private readonly lampWinterCol = new Color(HEX.lampWinter)
  /** The boss outro's crowd and fireworks (C9b). */
  readonly outro: OutroView
  /** The look new pages are printed in, and the atlas and effects follow (roadmaps #6, #17). */
  private look: Look
  /** Boot telemetry (roadmap #13): ms the standee atlas took at boot, and the deferred/seasonal paints since. */
  readonly paintMs = { atlasBoot: 0, atlasDeferred: 0, atlasSeason: 0, atlasHero: 0 }

  constructor(canvas: HTMLCanvasElement, private readonly game: FoldGame, private readonly signals: ViewSignals, look: Look = DEFAULT_LOOK) {
    this.renderer = new FoldRenderer({ canvas })
    this.scene.background = new Color(HEX.deskDark)
    this.look = { ...look }
    const t0 = performance.now()
    this.atlas = createStandeeAtlas({ variant: look.hero, season: look.season })
    this.paintMs.atlasBoot = performance.now() - t0
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
    this.effects.setConfettiShape(look.confetti)
    this.scene.add(this.effects.group)
    this.bats = new BatsView(this.atlas)
    this.scene.add(this.bats.group)
    this.snow = new SnowView()
    this.scene.add(this.snow.group)
    // A page printed for Winter boots straight into Winter's light.
    this.winterLight = look.season === 'winter' ? 1 : 0
    this.applyWinterLight()
    this.outro = new OutroView(this.atlas, this.effects, this.desk)
    this.scene.add(this.outro.mesh)
    this.sheet = new SheetView(paintPlainSheet(99))
    this.scene.add(this.sheet.mesh)
    this.shelf = new ShelfView()
    this.scene.add(this.shelf.group)
    this.boatMat = createPaperMaterial({ vertexColors: true, grain: 0.05, doubleSided: true })
    this.boat = new Mesh(boatGeometry(), this.boatMat)
    this.boat.visible = false
    this.boat.castShadow = true
    this.scene.add(this.boat)

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

  private readonly pickOut = { x: 0, z: 0 }
  private readonly segOut = v2()

  /**
   * What a tap at a screen point hits on the desk: a shelf slot (the nearest
   * spine within reach), `SHELF_DESK` (the open book) or `SHELF_NONE`. Taps
   * only (allocation-free all the same).
   */
  pickShelf(sx: number, sy: number): number {
    const sh = this.shelf
    let best = SHELF_NONE
    if (sh.group.visible) {
      let bestD = Infinity
      const reach = Math.max(24, Math.min(this.width, this.height) * 0.045)
      const slots = this.game.shelf.slots
      for (let i = 0; i < slots.length; i++) {
        // A rush figurine stands only once its book is won.
        if (slots[i]!.state === 'hidden' || i >= sh.slots) continue
        const a = sh.anchorOf(i, 0.05)
        this.project(a.x, a.y, a.z, this.sp)
        const ax = this.sp.x
        const ay = this.sp.y
        const b = sh.anchorOf(i, 0.95)
        this.project(b.x, b.y, b.z, this.sp)
        // Half the spine's screen width, from its projected height (a spine is ~0.36 as wide as tall).
        const half = Math.hypot(this.sp.x - ax, this.sp.y - ay) * 0.2
        const d = segmentDistance(sx, sy, ax, ay, this.sp.x, this.sp.y, this.segOut).x
        if (d < Math.max(reach, half) && d < bestD) {
          bestD = d
          best = i
        }
      }
    }
    if (best !== SHELF_NONE) return best
    // The open book: the play page and the turned pages on its left.
    if (this.unproject(sx, sy, this.pickOut)) {
      const { x, z } = this.pickOut
      if (x <= PAGE_HALF_W + 0.3 && x >= -PAGE_HALF_W * 3 - 0.9 && Math.abs(z) <= PAGE_HALF_D + 0.3) return SHELF_DESK
    }
    return SHELF_NONE
  }

  /**
   * Is a screen point on the desk lamp (the desk's secret)? Its projected
   * foot-to-shade segment, with a finger's reach. Taps only.
   */
  pickLamp(sx: number, sy: number): boolean {
    this.project(DESK_LAMP.x, DESK_Y + 0.1, DESK_LAMP.z, this.sp)
    if (!this.sp.visible) return false
    const ax = this.sp.x
    const ay = this.sp.y
    this.project(DESK_LAMP.x, DESK_Y + DESK_LAMP.h, DESK_LAMP.z + 0.4, this.sp)
    const len = Math.hypot(this.sp.x - ax, this.sp.y - ay)
    const reach = Math.max(22, Math.min(this.width, this.height) * 0.04, len * 0.45)
    return segmentDistance(sx, sy, ax, ay, this.sp.x, this.sp.y, this.segOut).x < reach
  }

  /** Screen point (CSS px) of the desk lamp's middle (tests). */
  lampScreen(out: ScreenPoint): ScreenPoint {
    return this.project(DESK_LAMP.x, DESK_Y + DESK_LAMP.h * 0.5, DESK_LAMP.z + 0.2, out)
  }

  private readonly corner = new Vector3()
  private readonly box = new Box3()
  private readonly childBox = new Box3()

  /**
   * Screen y (CSS px) of the top of the desk bookshelf as drawn — the highest
   * point of its top board and of what stands on it (`extras`: the Dragon Rush
   * figurines and the secrets card, when shown) — or +Infinity while the
   * shelf is hidden. Events and layout only (the star ribbon fits above it,
   * so it never covers a figurine or the card).
   */
  shelfTop(): number {
    const sh = this.shelf
    if (!sh.group.visible) return Infinity
    sh.group.updateMatrixWorld(true)
    const hw = shelfHalfWidth()
    const d = (SHELF.bookD + 0.3) / 2
    let best = Infinity
    for (let i = 0; i < 4; i++) {
      // The board itself.
      this.corner.set(i & 1 ? hw : -hw, 0, i & 2 ? d : -d)
      sh.extras.localToWorld(this.corner)
      best = Math.min(best, this.project(this.corner.x, this.corner.y, this.corner.z, this.sp).y)
    }
    // Everything standing on it that is shown: every corner of its world bounds.
    const box = this.box.makeEmpty()
    for (const c of sh.extras.children) {
      if (!c.visible) continue
      this.childBox.setFromObject(c)
      if (!this.childBox.isEmpty()) box.union(this.childBox)
    }
    if (!box.isEmpty()) {
      for (let i = 0; i < 8; i++) {
        const x = i & 1 ? box.max.x : box.min.x
        const y = i & 2 ? box.max.y : box.min.y
        const z = i & 4 ? box.max.z : box.min.z
        best = Math.min(best, this.project(x, y, z, this.sp).y)
      }
    }
    return best
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

  /** The paper and season pages are printed in. */
  private get pageLook(): PageLook {
    return { paper: this.look.paper, season: this.look.season }
  }

  private buildPage(def: PageDef, folds = this.game.folds): PageView {
    const v = new PageView(def, folds, this.sprites, this.renderer.overlay, this.signals.caption?.(def) ?? '', this.pageLook)
    this.scene.add(v.group)
    return v
  }

  /** Build the page the player is about to see (under a turn/peel). */
  private prebuild(id: PageId, visible = true): void {
    const def = pageDef(this.game.book, id)
    if (this.incomingDef === def && this.incoming) {
      this.incoming.group.visible = visible
      return
    }
    this.incoming?.dispose()
    this.incoming?.group.removeFromParent()
    // Placeholder fold states until the real ones arrive with loadPage.
    const folds = def.folds.map(createFold)
    for (const f of folds) if (f.def.fromWave === 0) f.phase = 'ready'
    this.incoming = this.buildPage(def, folds)
    // Flat until the transition that reveals it lets its pop-ups rise.
    this.incoming.hold()
    this.incoming.group.visible = visible
    this.incomingDef = def
  }

  /** Repaint the storybook captions (the font arrived, or the language changed). */
  refreshCaptions(force = false): void {
    for (const p of [this.page, this.incoming]) {
      if (p?.caption) p.caption.set(this.signals.caption?.(p.def) ?? '', force)
    }
  }

  private adoptPage(): void {
    const g = this.game
    const def = g.page
    // Same page again (restart / drop): keep the painted page, re-bind its folds.
    if (this.page && this.page.def === def) {
      this.page.bindFolds(g.folds)
      this.page.group.visible = true
      this.page.intro = 0
      return
    }
    const old = this.page
    let next: PageView
    if (this.incoming && this.incomingDef === def) {
      next = this.incoming
      this.incoming = null
      this.incomingDef = null
      next.bindFolds(g.folds)
      next.group.visible = true
      // Adopted without a turn/peel still running (a jump): stand up now.
      if (this.transition !== 'turn' && this.transition !== 'peel') next.release()
    } else {
      next = this.buildPage(def)
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
      case 'shelfSelect':
        this.shelf.onEvent(e)
        break
      case 'shelfBook':
        this.desk.kick(0.4)
        break
      case 'secret':
        this.secret(e)
        break
      case 'night':
        this.book.lampWobble = 1
        this.effects.glow(DESK_LAMP.x, DESK_Y + DESK_LAMP.h - 0.4, DESK_LAMP.z + 0.6, 2.6, 0.6, 'star', 'lampWarm', 2)
        break
      case 'rushStart':
        // A rematch: the camera as for any dragon page (the outro's crowd is the victory page's only).
        this.desk.setZoom(1)
        break
      case 'outro':
        // Its frames are painted by now (boss and finale pages paint them on their intro); never twice.
        this.paintDeferred()
        this.outro.onEvent(e, g)
        break
      case 'outroBeat':
      case 'firework':
        this.outro.onEvent(e, g)
        break
      case 'rushDone': {
        const kraken = g.boss.kind === 'kraken'
        for (let i = 0; i < 3; i++) fx.burst(-3 + i * 3, 3, -1, { count: 50, palette: kraken ? 'kraken' : 'dragon', speed: 5, up: 7 })
        this.wordAt(kraken ? 'rushKraken' : 'rush', 0, 3, -1, 1.4, 'good')
        break
      }
      case 'pleat': {
        // A section of the accordion shuts: a crunch where it closed, a word for a catch.
        this.desk.shake(e.b > 0 ? 0.1 : 0.04)
        this.desk.kick(0.35)
        fx.ring(e.x, e.z, 1.6, 0.3)
        fx.burst(e.x, 0.3, e.z, { count: 10 + e.b * 8, palette: 'paper', speed: 3, up: 3, size: 0.8 })
        if (e.b > 0) this.wordAt('crunch', e.x, 1.1, e.z, 0.9 + e.b * 0.1 + e.c * 0.06, 'stamp')
        break
      }
      case 'capsize':
        fx.burst(e.x, 0.2, e.z, { count: 26, palette: 'water', speed: 3.5, up: 5 })
        fx.ring(e.x, e.z, 1.4, 0.35, 'waterLight')
        this.wordAt('splash', e.x, 1.2, e.z, 0.9, 'snap')
        break
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
        if (k === 'boat') {
          // The boat pushes off from its dock.
          fx.burst(e.x, 0.1, e.z, { count: 20, palette: 'water', speed: 3, up: 3 })
          const d = f.def
          const dx = d.ax + f.ux * 0.6
          const dz = d.az + f.uz * 0.6
          this.wordAt('ahoy', dx, 1.4, dz, 1, 'snap')
          break
        }
        this.wordAt(k === 'wall' || k === 'ridge' ? 'snap' : k === 'valley' || k === 'pleat' ? 'fold' : 'fling', e.x, 1.2, e.z, 1 + e.b * 0.08, 'snap')
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
        else if (e.c === KILL_BOLT) fx.burst(e.x, 0.6, e.z, { count: 14, palette: 'festive', speed: 4, up: 4 })
        else if (e.c === KILL_SHOT) fx.burst(e.x, 0.5, e.z, { count: 16, palette: 'festive', speed: 3.5, up: 4.5 })
        else if (e.c === KILL_CAPSIZE) fx.burst(e.x, 0.3, e.z, { count: 12, palette: 'festive', speed: 2.5, up: 4 })
        break
      }
      case 'bossHit': {
        fx.burst(e.x, 1.6, e.z, { count: 26, palette: g.boss.kind === 'kraken' ? 'kraken' : 'dragon', speed: 4, up: 4 })
        this.wordAt('thwack', e.x, 2.4, e.z, e.c ? 1.3 : 1, 'stamp')
        this.desk.shake(e.c ? 0.14 : 0.08)
        break
      }
      case 'ballistaFire': {
        const f = g.folds[e.a]
        if (f) {
          fx.burst(f.cx, CASTLE.towerTop + 0.5, CASTLE.towerZ - 0.4, { count: 12, palette: 'paper', speed: 2.5, up: 2, size: 0.7 })
          this.wordAt('twang', f.cx, CASTLE.towerTop + 1.2, CASTLE.towerZ, 0.8, 'snap')
        }
        this.desk.kick(0.35)
        break
      }
      case 'slingFire': {
        const s = g.sling
        if (s) fx.burst(s.def.x, 0.9, s.def.z, { count: 10, palette: 'paper', speed: 2.2, up: 2, size: 0.7 })
        this.desk.kick(0.3)
        break
      }
      case 'leap': {
        // Springs: a puff of paper flecks at take-off; a vault gets a word.
        fx.burst(e.x, 0.05, e.z, { count: e.c ? 10 : 5, palette: 'paper', speed: 2, up: 1.5, size: 0.6 })
        if (e.c) this.wordAt('boing', e.x, 1.4, e.z, 0.8, 'snap')
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
        if (e.c === BLOCK_BEARER) {
          // A bolt glances off a shield-bearer's shield: sparks and a glint, BLOCKED! the first time on a page.
          fx.burst(e.x, 0.8, e.z, { count: 12, palette: 'gold', speed: 3.5, up: 3, size: 0.6 })
          fx.glow(e.x, 0.9, e.z + 0.1, 0.9, 0.25, 'star', 'highlightHot', 4)
          this.wordAt(e.b ? 'blocked' : 'tink', e.x, 1.5, e.z, e.b ? 1.1 : 0.75, e.b ? 'good' : 'snap')
          break
        }
        // c = 3: the dragon's fire on a shield; c = 5: the kraken's ink.
        const big = e.c === 3 || e.c === 5
        fx.burst(e.x, 0.7, e.z, { count: big ? 30 : 8, palette: e.c === 3 ? 'flame' : e.c === 5 ? 'inkJet' : 'paper', speed: 3, up: 3, size: big ? 1.4 : 0.8 })
        if (big) this.wordAt('blocked', e.x, 1.4, e.z, 1.1, 'good')
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
        } else if (e.b === 5) {
          // Sling stone lands: a thump ring, paper flecks, a word if it hit.
          this.desk.shake(e.c > 0 ? 0.1 : 0.05)
          fx.ring(e.x, e.z, 2.2, 0.35, 'highlight')
          fx.burst(e.x, 0.15, e.z, { count: 18, palette: 'paper', speed: 3.5, up: 3, size: 0.9 })
          if (e.c > 0) this.wordAt('thwack', e.x, 1.1, e.z, 1 + Math.min(0.4, e.c * 0.1), 'stamp')
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
        // Books 2 and 3's runners and leapers: their atlas frames must be painted before they can march on.
        // The outro's crowd (C9b): painted on the boss and finale pages' intro, under the page turn.
        if (g.book >= 2 || g.page.exit === 'boss' || g.page.exit === 'finale') this.paintDeferred()
        this.outro.onEvent(e, g)
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
        this.prebuild(Math.min(PAGE_COUNT, e.b) as PageId)
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
        if (b.kind === 'kraken') {
          this.krakenPhase()
          break
        }
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
        const a = this.page?.boss?.anchors[e.a]
        if (a) {
          fx.burst(a.x, a.y, a.z, { count: 70, palette: g.boss.kind === 'kraken' ? 'kraken' : 'dragon', speed: 6, up: 5 })
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
        this.paintDeferred()
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

  /** The kraken's moves (book 3): splash as it surfaces, its roar, the zoom as it fights, the fold-down. */
  private krakenPhase(): void {
    const b = this.game.boss
    const fx = this.effects
    if (b.phase === 'surface') {
      this.desk.setZoom(1.05)
      this.desk.shake(0.12)
      fx.burst(0, 0.4, -4.2, { count: 60, palette: 'water', speed: 5, up: 7 })
      fx.ring(0, -4.2, 4, 0.6, 'waterLight')
    } else if (b.phase === 'roar') {
      this.desk.shake(0.3)
      this.wordAt('blubRoar', 0, 3.8, -3.6, 1.6, 'roar')
      fx.burst(0, 2.5, -3.8, { count: 40, palette: 'kraken', speed: 5, up: 5 })
    } else if (b.phase === 'idle') this.desk.setZoom(1.04)
    else if (b.phase === 'collapse') {
      this.desk.setZoom(1)
      fx.burst(0, 1.6, -4, { count: 90, palette: 'kraken', speed: 6, up: 7 })
      fx.burst(0, 0.3, -4, { count: 50, palette: 'water', speed: 5, up: 6 })
    }
  }

  /** Sail the secret's paper boat across the page at `z`. */
  private launchBoat(z: number): void {
    this.boatT = 3.4
    this.boatZ = z
    this.boatPage = this.game.page
    this.boat.visible = true
  }

  /**
   * A page secret went off (roadmap #15): a sparkle where it happened, and its
   * own little show. Events only.
   */
  private secret(e: FoldEvent): void {
    const fx = this.effects
    const id = SECRET_IDS[e.a]
    const def = this.game.secrets.def
    const y = id === 'lamp' ? DESK_Y + DESK_LAMP.h : def && def.id === id ? def.y + 0.4 : 1
    fx.glow(e.x, y, e.z, 3.2, 0.9, 'star', 'highlightHot', 3)
    fx.burst(e.x, y, e.z, { count: e.b ? 40 : 18, palette: 'gold', speed: 3.5, up: 4 })
    switch (id) {
      case 'boat':
        this.launchBoat(-1.3)
        this.wordAt('ahoy', -3, 1.2, -1.3, 1, 'good')
        break
      case 'regatta': {
        // The Harbour: a paper boat sails the length of the channel, and the harbour cheers.
        const f = this.game.folds.find((o) => o.def.id === 's1-boat')
        this.launchBoat(f ? f.def.az : -1.5)
        this.wordAt('regatta', 0, 1.6, f ? f.def.az : -1.5, 1.2, 'good')
        fx.burst(0, 1, f ? f.def.az : -1.5, { count: 40, palette: 'festive', speed: 4, up: 6 })
        break
      }
      case 'tidepool':
        fx.burst(e.x, 0.2, e.z, { count: 44, palette: 'water', speed: 4, up: 6 })
        fx.ring(e.x, e.z, 2.4, 0.6, 'waterLight')
        this.wordAt('splash', e.x, 1.4, e.z, 1.1, 'snap')
        break
      case 'beacon':
        this.page?.beacon()
        fx.glow(e.x, 2.4, e.z, 4.5, 1.2, 'star', 'highlightHot', 4)
        this.wordAt('flash', e.x, 3, e.z, 1.1, 'good')
        break
      case 'shipshape':
        for (let i = 0; i < 4; i++) fx.burst(-3 + i * 2, 3.2 + (i % 2), -3, { count: 36, palette: 'festive', speed: 5, up: 6 })
        this.wordAt('shipshape', 0, 3, -2.6, 1.2, 'combo')
        break
      case 'tickle':
        fx.burst(e.x, 0.4, e.z, { count: 30, palette: 'water', speed: 2.5, up: 5, size: 0.8 })
        fx.burst(e.x, 0.6, e.z, { count: 16, palette: 'kraken', speed: 2, up: 3 })
        this.wordAt('giggle', e.x, 1.8, e.z, 1.1, 'crease')
        break
      case 'jump':
        this.page?.finale?.trick()
        fx.burst(0, 0.3, 0.6, { count: 40, palette: 'water', speed: 4, up: 6 })
        this.wordAt('splash', 0, 3, 0.6, 1.2, 'good')
        break
      case 'fling':
        for (let i = 0; i < 4; i++) fx.burst(-3 + i * 2, 3.5 + (i % 2), -5.2, { count: 36, palette: 'festive', speed: 5, up: 6 })
        this.wordAt('doubleFling', 0, 3, -4.6, 1.2, 'combo')
        break
      case 'moat':
        fx.burst(e.x, 0.2, e.z, { count: 44, palette: 'water', speed: 4, up: 6 })
        fx.ring(e.x, e.z, 2.4, 0.6, 'waterLight')
        this.wordAt('splash', e.x, 1.4, e.z, 1.1, 'snap')
        break
      case 'nap':
        this.wordAt('snore', e.x, 3, e.z, 1.2, 'crease')
        break
      case 'hop':
      case 'flap':
        this.page?.finale?.trick()
        this.wordAt(id === 'hop' ? 'hop' : 'flap', 0, 3, 0.6, 1.2, 'good')
        break
      case 'wave':
        this.wordAt('hello', e.x, 2.4, e.z, 1.1, 'good')
        fx.burst(e.x, 2, e.z, { count: 24, palette: 'hero', speed: 3, up: 4 })
        break
      case 'apples':
        fx.burst(e.x, 1.4, e.z, { count: 30, palette: 'apple', speed: 2.2, up: 1.5, size: 1.3, settle: true })
        this.wordAt('plop', e.x, 2.2, e.z, 1, 'snap')
        break
      case 'whirl':
        this.page?.whirl()
        this.wordAt('whoosh', e.x, 2.6, e.z, 1.1, 'snap')
        break
      case 'campfire':
        for (let i = 0; i < 3; i++) fx.flame(e.x, 0.1, e.z, (i - 1) * 0.2, 1, 0, 10)
        fx.burst(e.x, 0.4, e.z, { count: 40, palette: 'flame', speed: 3, up: 7, size: 0.7 })
        this.wordAt('crackle', e.x, 1.6, e.z, 1, 'rip')
        break
      case 'bonk':
        fx.burst(e.x, 1.4, e.z, { count: 30, palette: 'dragon', speed: 3.5, up: 4 })
        this.wordAt('bonk', e.x, 2.8, e.z, 1.3, 'stamp')
        this.desk.shake(0.1)
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
        this.prebuild(Math.min(PAGE_COUNT, g.pageId + 1) as PageId)
        this.transition = 'peel'
      }
      // The peel lesson's demonstration lifts the corner a little with the ghost hand.
      const demo = g.lesson.demo
      const ghostPeel = demo.phase !== 'off' && demo.on === 'peel' ? demo.fold * 0.3 : 0
      this.sheet.set(easeInOutCubic(clamp01(Math.max(g.peel, ghostPeel))) * 1.02)
      // The layer below unfolds as the corner comes away.
      this.incoming?.setRise(smoothstep(0.3, 0.95, g.peel))
    }

    switch (this.transition) {
      case 'turn': {
        this.transT += dt
        const k = clamp01(this.transT / PAGE_TURN_TIME)
        this.sheet.set(easeInOutCubic(k))
        // The new page's pop-ups unfold as the turning sheet clears them.
        ;(this.incoming ?? this.page)?.setRise(smoothstep(0.42, 0.97, k))
        if (k >= 1 && g.phase !== 'turn') {
          this.sheet.hide()
          this.transition = 'none'
          this.page?.release()
        }
        break
      }
      case 'peel':
        if (g.phase !== 'peel' && g.page.exit === 'boss') {
          this.sheet.hide()
          this.transition = 'none'
          this.page?.release()
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
    this.outro.update(g, this.desk.camera, this.time, dt)
    this.projectiles.update(g, this.surface, this.time)

    // Dragon fire stream (or the kraken's ink jet).
    if (this.breathTimer > 0) {
      this.breathTimer -= dt
      const d = this.page?.boss
      if (d) {
        const m = d.mouth
        const dir = d.mouthDir
        this.effects.flame(m.x, m.y, m.z, dir.x, dir.y, dir.z, 6, g.boss.kind === 'kraken' ? 'inkJet' : 'flame')
      }
    }
    // Finale puff.
    const fin = this.page?.finale
    if (fin?.popped) {
      this.effects.burst(0, 1.6, 0.6, { count: 80, palette: 'dragon', speed: 5, up: 5 })
      this.effects.glow(0, 1.2, 0.6, 5, 0.8, 'star', 'highlightHot', 3)
      const fin = this.page?.def.finale
      this.wordAt(fin === 'crane' ? 'flap' : fin === 'fish' ? 'splash' : 'ribbit', 0, 2.4, 0.6, 1.3, 'good')
    }

    // The Ravine's paper boat sails down the folded ravine, bobbing.
    if (this.boatT > 0) {
      this.boatT = Math.max(0, this.boatT - dt)
      const k = 1 - this.boatT / 3.4
      const b = this.boat
      b.position.set(-4.6 + k * 9.2, 0.12 + Math.sin(k * 25) * 0.05, this.boatZ + Math.sin(k * 7) * 0.2)
      b.rotation.set(Math.sin(k * 19) * 0.08, Math.PI / 2 + Math.sin(k * 7) * 0.2, Math.sin(k * 23) * 0.1)
      b.scale.setScalar(0.9)
      if (this.boatT <= 0 || g.page !== this.boatPage) {
        this.boatT = 0
        b.visible = false
      }
    }
    this.book.update(dt)
    this.effects.update(dt)
    this.bats.show(this.look.season === 'halloween' && !g.shelf.open)
    this.bats.update(this.time)
    this.snow.show(this.look.season === 'winter' && !g.shelf.open)
    if (this.snow.visible) {
      // Fewer flakes on the fast graphics setting; a sparse, slow fall with reduced motion (no allocation: two booleans).
      const lock = this.renderer.scaleLock
      this.snow.setDensity(lock !== null && lock < 1, this.desk.reducedMotion || g.reducedMotion)
    }
    this.snow.update(this.time, dt)
    // Winter's light eases in and out with the season (the equip happens behind the pause).
    const wantW = this.look.season === 'winter' ? 1 : 0
    if (this.winterLight !== wantW) {
      this.winterLight += (wantW - this.winterLight) * Math.min(1, dt * 3)
      if (Math.abs(wantW - this.winterLight) < 0.002) this.winterLight = wantW
      this.applyWinterLight()
    }
    // Out at the shelf or back at the book (real time, whatever the world's clock).
    this.desk.setShelf(g.shelf.open)
    this.desk.update(dt)
    this.shelf.update(g, dt, this.desk.shelfK)

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
    // Night mode (the lamp): eased in and out over a moment, the pool on the page centre.
    const want = g.secrets.night ? 1 : 0
    if (this.night !== want) {
      this.night += (want - this.night) * Math.min(1, dt * 3.5)
      if (Math.abs(want - this.night) < 0.002) this.night = want
    }
    u.uNight!.value = this.night
    if (this.night > 0) {
      this.project(0, 0, 0.8, this.sp)
      u.uNightCentre!.value.set(this.sp.x / this.width, 1 - this.sp.y / this.height)
    }
    if (g.phase !== this.lastPhase) this.lastPhase = g.phase
  }

  /** The lamp colour every paper material reads, between the warm lamp and Winter's daylight. No allocation. */
  private applyWinterLight(): void {
    paperGlobals.uLampColor.value.copy(this.lampWarmCol).lerp(this.lampWinterCol, this.winterLight)
  }

  /** Move interactive anchors to where they *appear* on the page plane. */
  private syncAnchors(): void {
    const g = this.game
    const p = this.page
    if (!p) return
    // A tap secret's target stands up off the page (a windmill, the hero on his keep):
    // the finger lands where the eye sees it.
    const sd = g.secrets.def
    if (sd && sd.trigger === 'taps') {
      this.tmp.set(sd.hero ? g.hero.x : sd.x, sd.y, sd.hero ? g.hero.z : sd.z)
      this.groundOf(this.tmp, this.anchorOut)
      g.secrets.spotX = this.anchorOut.x
      g.secrets.spotZ = this.anchorOut.z
    }
    if (p.castle) {
      for (const t of g.tears) {
        const a = p.castle.anchorOf(t.def.id)
        if (!a) continue
        this.groundOf(a, this.anchorOut)
        t.px = this.anchorOut.x
        t.pz = this.anchorOut.z
      }
    }
    const rig = p.boss
    if (rig && g.page.exit === 'boss') {
      const b = g.boss
      for (let i = 0; i < b.weakPoints.length; i++) {
        const w = b.weakPoints[i]!
        if (w.broken) continue
        this.groundOf(rig.anchors[i]!, this.anchorOut)
        w.x = this.anchorOut.x
        w.z = this.anchorOut.z
      }
    }
  }

  private readonly anchorOut = { x: 0, z: 0 }

  render(): void {
    this.renderer.render(this.scene, this.desk.camera, this.time)
  }

  /**
   * Compile every program the scene can draw (page 1, units, projectiles,
   * effects, the shelf, the composite) while the splash is still up, so the
   * first frame and the first marchers don't stall on shader compiles
   * (roadmap #13). Resolves with whether the GPU could compile in parallel.
   */
  precompile(): Promise<boolean> {
    return this.renderer.precompile(this.scene, this.desk.camera)
  }

  /** Can programs compile off the main thread (`KHR_parallel_shader_compile`)? */
  canCompileParallel(): boolean {
    return this.renderer.canCompileParallel()
  }

  private paintDeferred(): void {
    const t0 = performance.now()
    if (this.atlas.paintDeferred()) this.paintMs.atlasDeferred = performance.now() - t0
  }

  /** The art the first page doesn't need (the crowd's and book 2's standee frames, the season's bats). Idle time only. */
  warmArt(): void {
    this.paintDeferred()
    const t0 = performance.now()
    if (this.atlas.paintSeason(this.look.season)) this.paintMs.atlasSeason = performance.now() - t0
  }

  // ─── Looks (roadmaps #6, #17) ────────────────────────────────────────────

  get currentLook(): Readonly<Look> {
    return this.look
  }

  /** The paper the page in play is printed on (tests, debugging). */
  get printedLook(): PageLook | null {
    return this.page ? this.page.look : null
  }

  /**
   * A new look: the confetti chips change at once; everything that costs
   * canvas work waits for `applyLook` (see the file header). Returns true when
   * there is such work.
   */
  setLook(look: Look): boolean {
    const was = this.look
    this.look = { ...look }
    this.effects.setConfettiShape(look.confetti)
    return was.hero !== look.hero || was.season !== look.season || was.paper !== look.paper || this.pageStale()
  }

  /** Does the page in play (or the one built ahead) still wear another look? */
  pageStale(): boolean {
    const want = this.look
    const a = this.page
    const b = this.incoming
    if (a && (a.look.paper !== want.paper || a.look.season !== want.season)) return true
    return !!b && (b.look.paper !== want.paper || b.look.season !== want.season)
  }

  /**
   * The canvas work of a new look, in idle time: the hero's cells and the
   * season's bats in the atlas, a hidden prebuilt page reprinted, and the page
   * in play reprinted only when `paused` (the menu hides the hitch). Returns
   * true when the page in play still wears an old look afterwards.
   */
  applyLook(paused: boolean): boolean {
    const look = this.look
    const t0 = performance.now()
    if (this.atlas.setHero({ variant: look.hero, season: look.season })) this.paintMs.atlasHero = performance.now() - t0
    // The bats only once the player is past the boot (warm-up), or right away when the season comes on later.
    if (look.season === 'halloween' && !this.atlas.batsReady && this.atlas.complete) this.warmArt()
    const want = this.pageLook
    if (this.incoming && !this.incoming.group.visible) this.incoming.repaint(want)
    if (this.page && paused) this.page.repaint(want)
    return this.pageStale()
  }

  /** Prebuild a page's view off the hot path (idle time). */
  warm(id: PageId): void {
    const def = pageDef(this.game.book, id)
    if (this.game.page === def || this.incomingDef === def) return
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
    this.shelf.dispose()
    this.boatMat.dispose()
    this.bats.dispose()
    this.snow.dispose()
    // The lamp colour is shared by every paper material: leave it warm for whatever comes next.
    this.winterLight = 0
    this.applyWinterLight()
    this.outro.dispose()
    this.atlas.dispose()
    this.sprites.dispose()
    this.snapshotRT?.dispose()
    this.snapshotMRT?.dispose()
    this.leftPageArt?.dispose()
    disposeModelCache()
    this.renderer.dispose()
  }
}
