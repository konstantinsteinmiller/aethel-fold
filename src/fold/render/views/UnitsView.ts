/**
 * Units on the page: enemies (instanced standees + 3D paper catapults) and the
 * hero (standee + banner + floating paper hearts). The victory crowd is the
 * boss outro's (`OutroView`, C9b).
 */

import { Group, Mesh, type PerspectiveCamera } from 'three'
import type { FoldGame } from '../../logic/game'
import { MAX_ENEMIES } from '../../logic/entities'
import { CASTLE } from '../../logic/config'
import type { Enemy } from '../../logic/types'
import { clamp01, easeOutBack } from '../../logic/math'
import type { FrameName, StandeeAtlas } from '../art/standeeArt'
import { createPaperMaterial, type PaperMaterial } from '../paperMaterial'
import { bannerGeometry, catapultArmGeometry, catapultBaseGeometry, heartGeometry } from '../models'
import { StandeeField } from './StandeeField'

export interface SurfaceSampler {
  /** Height of the paper surface under an enemy held by fold `fold` (valley dips). */
  dip(fold: number, x: number, z: number): number
  /** Height a stationary shooter stands at (battlements, tower tops). */
  stand(x: number, z: number): number
}

class CatapultModel {
  readonly group = new Group()
  readonly arm = new Group()
  private lastCool = 0
  private fire = 0
  constructor(mat: PaperMaterial) {
    const base = new Mesh(catapultBaseGeometry(), mat)
    base.castShadow = true
    this.group.add(base)
    const armMesh = new Mesh(catapultArmGeometry(), mat)
    armMesh.castShadow = true
    this.arm.position.set(0, 0.62, -0.1)
    this.arm.add(armMesh)
    this.group.add(this.arm)
    this.group.scale.setScalar(1.05)
    this.group.visible = false
  }

  update(e: Enemy, dt: number, time: number): void {
    const g = this.group
    g.visible = true
    g.position.set(e.x, e.y, e.z)
    if (e.cool > this.lastCool + 0.5) this.fire = 1
    this.lastCool = e.cool
    this.fire = Math.max(0, this.fire - dt * 3.5)
    // Rest: arm cocked back toward the enemy side; windup pulls it lower; fire swings it over.
    const rest = -1.9
    const pull = -2.35
    const shot = -0.5
    this.arm.rotation.x = this.fire > 0 ? shot + (rest - shot) * (1 - this.fire) : rest + (pull - rest) * e.windup
    if (e.state === 'launched' || e.state === 'torn') {
      g.rotation.set(e.spin * 0.8, e.spin * 0.3, e.spin * 0.5)
      if (e.state === 'torn') g.scale.setScalar(Math.max(0.01, 1.05 * (1 - e.age * 2.4)))
    } else {
      g.rotation.set(0, Math.PI, Math.sin(time * 20) * 0.01 * e.windup)
      g.scale.setScalar(1.05)
    }
  }
}

/** Walk A, walk B, flail/wind-up frame per enemy type. */
const FRAMES: Record<Enemy['type'], readonly [FrameName, FrameName, FrameName]> = {
  knight: ['knight0', 'knight1', 'knightFlail'],
  brute: ['brute0', 'brute1', 'bruteFlail'],
  archer: ['archer0', 'archer0', 'archerDraw'],
  catapult: ['knight0', 'knight1', 'knightFlail'],
  runner: ['runner0', 'runner1', 'runnerFlail'],
  leaper: ['leaper0', 'leaper1', 'leaperFlail'],
  shieldBearer: ['bearer0', 'bearer1', 'bearerFlail']
}

export class UnitsView {
  readonly group = new Group()
  readonly enemies: StandeeField
  readonly hero: StandeeField
  private readonly catapults: CatapultModel[] = []
  private readonly catapultSlot: number[] = []
  private readonly propMat: PaperMaterial
  private readonly banner: Mesh
  private readonly hearts: Mesh[] = []
  private readonly heartMat: PaperMaterial
  private readonly flash = new Float32Array(MAX_ENEMIES)
  private readonly lastState: string[] = new Array(MAX_ENEMIES).fill('dead')
  private readonly lastSerial = new Float64Array(MAX_ENEMIES)
  private heroHp = 3
  private heartPop = [0, 0, 0]
  private heroFlash = 0

  constructor(atlas: StandeeAtlas) {
    this.enemies = new StandeeField(atlas, MAX_ENEMIES)
    this.hero = new StandeeField(atlas, 1)
    this.group.add(this.enemies.mesh, this.hero.mesh)
    this.propMat = createPaperMaterial({ vertexColors: true, grain: 0.05 })
    for (let i = 0; i < 4; i++) {
      const c = new CatapultModel(this.propMat)
      this.catapults.push(c)
      this.catapultSlot.push(-1)
      this.group.add(c.group)
    }
    this.banner = new Mesh(bannerGeometry(), this.propMat)
    this.banner.castShadow = true
    this.group.add(this.banner)
    this.heartMat = createPaperMaterial({ vertexColors: true, grain: 0.02, doubleSided: true, backTint: '#c02a2a' })
    for (let i = 0; i < 3; i++) {
      const h = new Mesh(heartGeometry(), this.heartMat)
      h.castShadow = true
      h.scale.setScalar(0.62)
      this.hearts.push(h)
      this.group.add(h)
    }
    this.group.userData.perfTag = 'fold.units'
  }

  update(game: FoldGame, surf: SurfaceSampler, camera: PerspectiveCamera, time: number, dt: number): void {
    const cam = camera.position
    // ─── Enemies ───
    for (let c = 0; c < this.catapultSlot.length; c++) this.catapultSlot[c] = -1
    let catapultIdx = 0
    const F = this.enemies
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const e = game.enemies[i]!
      if (e.serial !== this.lastSerial[i]) {
        this.lastSerial[i] = e.serial
        this.flash[i] = 0
      }
      if (e.state === 'dead') {
        if (this.lastState[i] !== 'dead') F.hide(i)
        this.lastState[i] = 'dead'
        continue
      }
      if (this.lastState[i] !== e.state) {
        if (e.state === 'crushed' || e.state === 'torn' || e.state === 'launched') this.flash[i] = 1
        this.lastState[i] = e.state
      }
      this.flash[i] = Math.max(0, this.flash[i]! - dt * 5)
      if (e.type === 'catapult') {
        F.hide(i)
        const model = this.catapults[catapultIdx]
        if (model) {
          model.update(e, dt, time)
          this.catapultSlot[catapultIdx] = i
          catapultIdx++
        }
        continue
      }
      this.placeEnemy(e, i, surf, cam.x, cam.z, time)
      const fl = this.flash[i]!
      F.tint(i, 1 + fl * 0.8, 1 + fl * 0.8, 1 + fl * 0.8)
    }
    for (let c = catapultIdx; c < this.catapults.length; c++) this.catapults[c]!.group.visible = false
    F.commit()

    // ─── Hero ───
    const h = game.hero
    if (h.hp < this.heroHp) {
      this.heartPop[h.hp] = 1
      this.heroFlash = 1
    }
    if (h.hp > this.heroHp) this.heartPop = [0, 0, 0]
    this.heroHp = h.hp
    this.heroFlash = Math.max(0, this.heroFlash - dt * 3)
    let frame: FrameName = 'hero0'
    let hop = 0
    let roll = Math.sin(time * 2.1) * 0.03
    switch (h.mood) {
      case 'cheer':
        frame = 'heroCheer'
        hop = Math.abs(Math.sin(time * 11)) * 0.22
        break
      case 'cower':
        frame = 'heroCower'
        roll = Math.sin(time * 30) * 0.05
        break
      case 'hit':
        frame = 'heroHit'
        roll = Math.sin(time * 45) * 0.18 * (1 - this.heroFlash * 0.2)
        break
      case 'down':
        frame = 'heroHit'
        break
      case 'walk':
        frame = Math.floor(time * 6) % 2 ? 'heroWalk' : 'hero0'
        hop = Math.abs(Math.sin(time * 9)) * 0.08
        break
    }
    this.hero.setFrame(0, frame)
    // The hero stands on the roof of the player's keep, above the castle gate.
    const hx = h.x
    const hz = CASTLE.keepZ - 0.05
    const pitch = h.mood === 'down' ? -1.35 : 0
    this.hero.place(0, hx, CASTLE.keepTop + hop, hz, Math.atan2(cam.x - hx, cam.z - hz) * 0.3, roll, pitch, 0.95)
    const f = 1 + this.heroFlash * 1.2
    this.hero.tint(0, f, f * (1 - this.heroFlash * 0.5), f * (1 - this.heroFlash * 0.5))
    this.hero.commit()
    // The keep flies its own flag; the camp banner is not needed any more.
    this.banner.visible = false
    for (let k = 0; k < 3; k++) {
      const heart = this.hearts[k]!
      const alive = k < h.hp
      const pop = this.heartPop[k]!
      if (pop > 0) this.heartPop[k] = Math.max(0, pop - dt * 1.8)
      heart.visible = alive || pop > 0
      const bob = Math.sin(time * 2.6 + k * 1.1) * 0.06
      const lift = alive ? 0 : (1 - pop) * 1.4
      heart.position.set(hx - 0.55 + k * 0.55, CASTLE.keepTop + 1.45 + bob + lift, hz + 0.05)
      heart.rotation.y = alive ? Math.sin(time * 1.7 + k) * 0.35 : (1 - pop) * 9
      heart.scale.setScalar(alive ? 0.6 : 0.6 * pop)
    }
    this.heartMat.uniforms.uFlash.value = this.heroFlash * 0.4
  }

  private placeEnemy(e: Enemy, i: number, surf: SurfaceSampler, camX: number, camZ: number, time: number): void {
    const F = this.enemies
    const yaw = Math.atan2(camX - e.x, camZ - e.z) * 0.3
    const size = e.size
    const walkA = Math.floor(e.phase / Math.PI) % 2 === 0
    const isBrute = e.type === 'brute'
    const fr = FRAMES[e.type]
    const walk0 = fr[0]
    const walk1 = fr[1]
    const flail = fr[2]
    // Spawn: the standee unfolds up from flat (pop-up book!).
    const rise = clamp01(e.age / 0.28)
    const risePitch = (1 - easeOutBack(rise, 2)) * -1.4
    switch (e.state) {
      case 'march': {
        // A shield-bearer's windup is its block pose: a bolt just glanced off the shield.
        F.setFrame(i, e.type === 'shieldBearer' && e.windup > 0.25 ? 'bearerBlock' : walkA ? walk0 : walk1)
        const hop = Math.abs(Math.sin(e.phase)) * 0.09 * (isBrute ? 0.6 : 1)
        const roll = Math.sin(e.phase) * (isBrute ? 0.06 : 0.11)
        F.place(i, e.x, hop, e.z, yaw, roll, risePitch, size)
        break
      }
      case 'blocked': {
        F.setFrame(i, e.windup > 0.35 ? flail : walk0)
        const lean = -e.windup * 0.35
        F.place(i, e.x, 0, e.z, yaw, Math.sin(time * 14 + i) * 0.03, lean, size)
        break
      }
      case 'trapped': {
        F.setFrame(i, Math.floor(time * 8 + i) % 2 ? flail : walk0)
        const y = surf.dip(e.fold, e.x, e.z)
        F.place(i, e.x, y, e.z, yaw, Math.sin(time * 18 + i * 2) * 0.22, 0, size)
        break
      }
      case 'leap': {
        // Springs out, tilting into the jump and back down for the landing.
        F.setFrame(i, 'leaperJump')
        const tilt = Math.max(-0.35, Math.min(0.35, -e.vy * 0.05))
        F.place(i, e.x, e.y, e.z, yaw, Math.sin(e.phase * 3) * 0.08, tilt, size * (1 + Math.min(0.12, e.y * 0.05)))
        break
      }
      case 'launched':
      case 'swept': {
        F.setFrame(i, flail)
        F.place(i, e.x, e.y, e.z, yaw + e.spin * 0.6, e.spin, e.spin * 0.7, size * (e.towardLens ? 1 + e.age * 1.6 : 1))
        break
      }
      case 'crushed': {
        F.setFrame(i, 'crushed')
        const a = clamp01(e.age / 0.08)
        // Slammed flat onto the page, then shrinks into it.
        const fade = clamp01((e.age - 0.25) / 0.25)
        F.place(i, e.x, 0.015, e.z, yaw, 0, -Math.PI / 2 * a, size * 1.15 * (1 - fade * 0.9), 1 - a * 0.2)
        break
      }
      case 'torn': {
        F.setFrame(i, 'scrap')
        const s = Math.max(0.01, 1 - e.age * 2.2)
        F.place(i, e.x, 0.2 + e.age * 1.4, e.z, yaw + e.age * 8, e.age * 6, 0, size * s)
        break
      }
      case 'breached': {
        F.setFrame(i, walkA ? walk0 : walk1)
        F.place(i, e.x, 0, e.z, yaw, 0, 0, size * Math.max(0.01, 1 - e.age * 2))
        break
      }
      case 'stand': {
        F.setFrame(i, e.windup > 0.15 ? flail : walk0)
        F.place(i, e.x, e.y + surf.stand(e.x, e.z), e.z, yaw, Math.sin(time * 1.8 + i) * 0.03, risePitch - e.windup * 0.12, size)
        break
      }
      default:
        F.hide(i)
    }
  }

  dispose(): void {
    this.enemies.dispose()
    this.hero.dispose()
    this.propMat.dispose()
    this.heartMat.dispose()
  }
}
