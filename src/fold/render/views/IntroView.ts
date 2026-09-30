/**
 * The first-launch intro's picture (roadmap #12), in the engine's own scene.
 *
 * Built only when the intro plays. It borrows the host `GameView`'s desk,
 * book, lamp, camera, effects, atlas and sprites, and adds one group to its
 * scene with the intro's own actors, all existing views:
 *
 *   PageView        the demo page (`INTRO_PAGE`), bound to the demo game's folds
 *   UnitsView       its knights (and the hero on the keep), on the shared atlas
 *   ProjectilesView the ballista bolts and the sling stone
 *   DragonView      the boss rig, posed by `dragonPose` for a fly-over instead of
 *                   by a boss fight: a puppet `{ boss, hero }` feeds its update
 *   SeaPeekActor    the sea monster's peek (placeholder until Book 3 registers
 *                   its kraken — see `SeaPeekView.ts`)
 *
 * While it is up, the page in play, its units and projectiles are hidden
 * (and the player's game is frozen by the engine); `detach` shows them again
 * — with page 1's pop-ups rising — and the intro's objects are disposed in
 * idle time afterwards, so the tap that skips never waits on it.
 *
 * Draw calls: the demo page replaces the hidden page 1, so the intro costs
 * what a page with a castle and two ballistas costs, plus the dragon (as on
 * the dragon's page) while it is on screen and the sea peek's 10 meshes;
 * below the dragon page's measured 123 (implementation plan §7).
 */

import { Group } from 'three'
import type { FoldGame } from '../../logic/game'
import type { FoldEvent } from '../../logic/events'
import { KILL_BOLT, KILL_CRUSH, KILL_FLING, KILL_LAUNCH, KILL_RIDGE, KILL_SHOT, KILL_TEAR } from '../../logic/events'
import { CASTLE } from '../../logic/config'
import { createBoss } from '../../logic/boss'
import { createHero } from '../../logic/entities'
import {
  createDragonPose, createSeaPeekPose, dragonPose, INTRO_PAGE, seaPeekPose, type DragonPose, type SeaPeekPose
} from '../../logic/intro'
import type { GameView, ScreenPoint } from '../GameView'
import { PageView } from './PageView'
import { UnitsView, type SurfaceSampler } from './UnitsView'
import { ProjectilesView } from './ProjectilesView'
import { DragonView } from './DragonView'
import { createSeaPeek, type SeaPeekActor } from './SeaPeekView'

/** How big the flying dragon is next to the page's dragon. */
const DRAGON_SCALE = 0.72

export interface IntroSignals {
  /** A comic word at a screen point (the host's FxLayer). */
  word(key: string, x: number, y: number, size: number, tone: string): void
  /** A synthetic sound cue (the dragon's fire) for the audio. */
  sfx?(e: FoldEvent): void
}

export class IntroView {
  readonly group = new Group()
  readonly page: PageView
  readonly units: UnitsView
  readonly projectiles: ProjectilesView
  readonly dragon: DragonView
  readonly sea: SeaPeekActor
  /** The dragon's puppet state: what `DragonView.update` reads instead of a boss fight. */
  private readonly puppet = { boss: createBoss(), hero: createHero() }
  private readonly dPose: DragonPose = createDragonPose()
  private readonly sPose: SeaPeekPose = createSeaPeekPose()
  private readonly surface: SurfaceSampler
  private readonly sp: ScreenPoint = { x: 0, y: 0, visible: false }
  /** A reusable event for the synthetic sound cues. */
  private readonly cue: FoldEvent = { type: 'bossBreath', a: 0, b: 0, c: 0, x: 0, z: 0 }
  private time = 0
  private breathing = false
  private scorch = 0
  private attached = true
  private disposed = false

  constructor(private readonly host: GameView, private readonly game: FoldGame, private readonly signals: IntroSignals) {
    const look = host.currentLook
    this.page = new PageView(INTRO_PAGE, game.folds, host.sprites, host.renderer.overlay, '', { paper: look.paper, season: look.season })
    this.page.group.userData.perfTag = 'fold.intro.page'
    this.units = new UnitsView(host.atlas)
    this.projectiles = new ProjectilesView()
    this.dragon = new DragonView(host.sprites, host.renderer.overlay)
    this.dragon.group.position.set(0, 0, 0)
    this.dragon.group.scale.setScalar(DRAGON_SCALE)
    this.dragon.group.userData.perfTag = 'fold.intro.dragon'
    this.sea = createSeaPeek({ sprites: host.sprites, overlay: host.renderer.overlay })
    this.group.add(this.page.group, this.units.group, this.projectiles.group, this.dragon.group, this.sea.group)
    this.group.userData.perfTag = 'fold.intro'
    this.surface = {
      dip: (fold, x, z) => this.page.dip(fold, x, z),
      stand: (x, z) => this.page.stand(x, z)
    }
    const b = this.puppet.boss
    b.phase = 'dormant'
    this.puppet.hero.x = 0
    host.scene.add(this.group)
    this.hideHost(true)
  }

  /** The page in play and its actors: hidden under the intro, back (pop-ups rising) after it. */
  private hideHost(hide: boolean): void {
    const h = this.host
    if (h.page) {
      h.page.group.visible = !hide
      if (!hide) h.page.intro = 0
    }
    h.units.group.visible = !hide
    h.projectiles.group.visible = !hide
  }

  /** Pose everything for intro time `t` (after the director stepped the demo game). */
  update(t: number, dt: number): void {
    if (!this.attached) return
    this.time += dt
    const time = this.time
    const g = this.game
    this.page.update(g, time, dt)
    this.units.update(g, this.surface, this.host.desk.camera, time, dt)
    this.projectiles.update(g, this.surface, time)
    this.updateDragon(t, time, dt)
    seaPeekPose(t, this.sPose)
    this.sea.update(this.sPose, time, dt)
  }

  private updateDragon(t: number, time: number, dt: number): void {
    const p = dragonPose(t, this.dPose)
    const b = this.puppet.boss
    const d = this.dragon
    if (!p.on) {
      // Dormant hides the rig and its glows.
      if (b.phase !== 'dormant') {
        b.phase = 'dormant'
        d.update(this.puppet, time, dt)
      }
      this.breathing = false
      return
    }
    const fire = p.fire
    b.phase = fire ? 'breath' : 'idle'
    // Past the breath's rear-up: the head stays thrust forward while it breathes.
    b.phaseTime = 1
    b.aimX = p.aimX
    b.aimZ = p.aimZ
    const grp = d.group
    grp.position.set(p.x, p.y, p.z)
    // The model's +x axis pitches it nose-down: a climb is a negative angle.
    grp.rotation.set(-p.pitch, p.yaw, p.roll, 'YXZ')
    // A faster clock beats the wings harder in flight (the rig's idle flap is slow).
    d.update(this.puppet, time * p.flap, dt)
    if (fire) {
      const m = d.mouth
      const dir = d.mouthDir
      this.host.effects.flame(m.x, m.y, m.z, dir.x, dir.y, dir.z, 6)
      // Where the fire lands: scorched paper flecks and a puff now and then.
      this.scorch -= dt
      if (this.scorch <= 0) {
        this.scorch = 0.16
        this.host.effects.burst(p.aimX, 0.1, p.aimZ, { count: 10, palette: 'flame', speed: 2.4, up: 2.6, size: 0.8 })
      }
      if (!this.breathing) {
        this.cue.type = 'bossBreath'
        this.signals.sfx?.(this.cue)
        this.wordAt('roar', p.x, p.y + 1.6, p.z, 1.3, 'roar')
        this.host.desk.shake(0.12)
      }
    }
    this.breathing = fire
  }

  private wordAt(key: string, x: number, y: number, z: number, size = 1, tone = 'default'): void {
    this.host.project(x, y, z, this.sp)
    this.signals.word(key, this.sp.x, this.sp.y, size, tone)
  }

  /**
   * The demo game's events → juice, as the page in play gets it (`GameView.onEvent`):
   * the snap, stamp, kill, ballista and sling moments the intro shows off.
   */
  onEvent(e: FoldEvent): void {
    if (!this.attached) return
    const g = this.game
    const fx = this.host.effects
    const desk = this.host.desk
    switch (e.type) {
      case 'foldSnap': {
        const f = g.folds[e.a]
        if (!f) break
        const k = f.def.kind
        desk.shake(0.1)
        desk.kick(0.6)
        fx.ring(e.x, e.z, k === 'valley' ? 3 : 2.3, 0.4)
        fx.burst(e.x, 0.2, e.z, { count: 16, palette: 'paper', speed: 3, up: 3, size: 0.9 })
        if (e.b > 0) fx.burst(e.x, 1, e.z - 0.8, { count: 22 + e.b * 10, palette: 'festive', speed: 4.5, up: 6 })
        if (k === 'ballista') break
        this.wordAt(k === 'wall' ? 'snap' : k === 'valley' ? 'fold' : 'fling', e.x, 1.2, e.z, 1 + e.b * 0.08, 'snap')
        break
      }
      case 'foldStamp':
        desk.shake(0.14)
        desk.kick(1)
        fx.ring(e.x, e.z, 3.2, 0.5)
        fx.burst(e.x, 0.05, e.z, { count: 30, palette: 'paper', speed: 6, up: 1.6, size: 0.8 })
        if (e.b > 0) fx.burst(e.x, 0.3, e.z, { count: 26 + e.b * 12, palette: 'festive', speed: 5, up: 5 })
        this.wordAt('stamp', e.x, 0.6, e.z, 1.1 + e.b * 0.1, 'stamp')
        break
      case 'kill':
        if (e.c === KILL_CRUSH) fx.burst(e.x, 0.1, e.z, { count: 14, palette: 'enemy', speed: 3.5, up: 3 })
        else if (e.c === KILL_TEAR || e.c === KILL_FLING) fx.burst(e.x, 0.6, e.z, { count: 18, palette: 'festive', speed: 4, up: 5 })
        else if (e.c === KILL_RIDGE) fx.burst(e.x, 0.8, e.z, { count: 10, palette: 'festive', speed: 3, up: 4 })
        else if (e.c === KILL_LAUNCH) fx.burst(e.x, 0.4, e.z, { count: 8, palette: 'festive', speed: 2.5, up: 5 })
        else if (e.c === KILL_BOLT) fx.burst(e.x, 0.6, e.z, { count: 14, palette: 'festive', speed: 4, up: 4 })
        else if (e.c === KILL_SHOT) fx.burst(e.x, 0.5, e.z, { count: 16, palette: 'festive', speed: 3.5, up: 4.5 })
        break
      case 'lensHit':
        fx.lensBurst(desk.camera, 0, 0.2)
        desk.shake(0.05)
        break
      case 'ballistaFire': {
        const f = g.folds[e.a]
        if (f) {
          fx.burst(f.cx, CASTLE.towerTop + 0.5, CASTLE.towerZ - 0.4, { count: 12, palette: 'paper', speed: 2.5, up: 2, size: 0.7 })
          this.wordAt('twang', f.cx, CASTLE.towerTop + 1.2, CASTLE.towerZ, 0.8, 'snap')
        }
        desk.kick(0.35)
        break
      }
      case 'slingFire': {
        const s = g.sling
        if (s) fx.burst(s.def.x, 0.9, s.def.z, { count: 10, palette: 'paper', speed: 2.2, up: 2, size: 0.7 })
        desk.kick(0.3)
        break
      }
      case 'impact':
        if (e.b === 5) {
          desk.shake(e.c > 0 ? 0.1 : 0.05)
          fx.ring(e.x, e.z, 2.2, 0.35, 'highlight')
          fx.burst(e.x, 0.15, e.z, { count: 18, palette: 'paper', speed: 3.5, up: 3, size: 0.9 })
          if (e.c > 0) this.wordAt('thwack', e.x, 1.1, e.z, 1 + Math.min(0.4, e.c * 0.1), 'stamp')
        }
        break
    }
  }

  /** Off the screen at once: the page in play comes back. The objects stay until `dispose`. */
  detach(): void {
    if (!this.attached) return
    this.attached = false
    this.group.removeFromParent()
    // The dragon's glows live in the overlay scene: dark before they go.
    this.puppet.boss.phase = 'dormant'
    this.dragon.update(this.puppet, this.time, 0)
    this.hideHost(false)
  }

  dispose(): void {
    if (this.disposed) return
    this.detach()
    this.disposed = true
    this.page.dispose()
    this.units.dispose()
    this.projectiles.dispose()
    this.dragon.dispose()
    this.sea.dispose()
  }
}
