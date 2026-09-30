/**
 * The boss outro on screen (C9b): the cheering paper crowd and the paper
 * fireworks, both read from the game's `CutsceneRunner` (`game.outro`).
 *
 * - Crowd: one instanced `StandeeField` (its own paper id, so the Sobel pass
 *   inks every silhouette), shown only on the victory page. Each person pops
 *   up from flat like every standee, then hops and waves; a `cheer` beat
 *   throws everybody's arms (and hats) up with a bigger hop.
 * - Fireworks: the rocket trails and bursts are chips of the shared confetti
 *   mesh (`Effects`, id 127: no ink) — no draw call of their own. The pool's
 *   caps bound them (`OUTRO` in config).
 * - Camera: `camera` beats glide the desk camera (`DeskCamera.setCut`) in
 *   real time; the end (or a skip) glides it home.
 *
 * Adding a cast (book 3's dolphins, people in paper boats) is a row in
 * `ACTORS` (frames and how it cheers) plus its atlas frames. Nothing here
 * allocates per frame.
 */

import type { PerspectiveCamera } from 'three'
import type { FoldGame } from '../../logic/game'
import type { FoldEvent } from '../../logic/events'
import { OUTRO } from '../../logic/config'
import { FW_RISE, FIREWORK_TINTS, SHOT_HOME, sparksPerBurst, type CutActor, type FireworkTint } from '../../logic/cutscene'
import { clamp01, easeOutBack } from '../../logic/math'
import type { PaletteKey } from '../palette'
import type { FrameName, StandeeAtlas } from '../art/standeeArt'
import type { DeskCamera } from '../camera'
import type { ConfettiPalette, Effects } from './Effects'
import { StandeeField } from './StandeeField'

interface ActorLook {
  /** Wave and hooray frames. */
  frames: readonly [FrameName, FrameName]
  /** Standee scale. */
  size: number
  /** Hop height of the idle cheer (page units). */
  hop: number
}

const ACTORS: Record<CutActor, ActorLook> = {
  villagers: { frames: ['cheerVillager0', 'cheerVillager1'], size: 1.02, hop: 0.2 },
  soldiers: { frames: ['cheerSoldier0', 'cheerSoldier1'], size: 1.05, hop: 0.16 },
  farmers: { frames: ['cheerFarmer0', 'cheerFarmer1'], size: 1.02, hop: 0.18 },
  kids: { frames: ['cheerKid0', 'cheerKid1'], size: 0.95, hop: 0.28 }
}

const TINT_PALETTE: Record<FireworkTint, ConfettiPalette> = {
  festive: 'festive', gold: 'gold', cool: 'cool', warm: 'warm'
}
/** Trail chip colour per tint (a bright paper spark). */
const TINT_TRAIL: Record<FireworkTint, PaletteKey> = {
  festive: 'highlightHot', gold: 'gold', cool: 'waterLight', warm: 'c6'
}

/** Seconds a cheer beat's hooray lasts. */
const CHEER_TIME = 1.1

export class OutroView {
  readonly crowd: StandeeField
  /** Trail emission debt per firework slot (chips owed at `OUTRO.trailRate`). */
  private readonly trailDebt = new Float32Array(OUTRO.fireworkSlots)
  private shown = false

  constructor(atlas: StandeeAtlas, private readonly effects: Effects, private readonly desk: DeskCamera) {
    this.crowd = new StandeeField(atlas, OUTRO.crowdCap)
    for (let i = 0; i < OUTRO.crowdCap; i++) this.crowd.hide(i)
    this.crowd.commit()
    // Drawn only while there is a crowd: outside the victory page it costs no draw call.
    this.crowd.mesh.visible = false
    this.crowd.mesh.userData.perfTag = 'fold.outro'
  }

  get mesh() {
    return this.crowd.mesh
  }

  onEvent(e: FoldEvent, game: FoldGame): void {
    const r = game.outro
    switch (e.type) {
      case 'outroBeat': {
        const b = r.script?.beats[e.a]
        if (b && b.kind === 'camera' && e.b === 0) {
          const s = b.shot
          this.desk.setCut(s.zoom, s.yaw, s.pitch, s.fx, s.fz, b.dur)
        }
        break
      }
      case 'outro':
        // The end or a skip: home, briskly after a skip (the card is coming).
        if (e.a === 0 && this.desk.cutting) {
          const h = SHOT_HOME
          this.desk.setCut(h.zoom, h.yaw, h.pitch, h.fx, h.fz, e.b ? 0.6 : 0.9)
        }
        break
      case 'firework':
        if (e.b === 1) {
          const tint = FIREWORK_TINTS[e.c] ?? 'festive'
          this.effects.fireworkBurst(e.x, r.fireworks.y[e.a]!, e.z, sparksPerBurst(r.lite), TINT_PALETTE[tint], OUTRO.linger)
        } else {
          this.trailDebt[e.a] = 0
        }
        break
      case 'pageIntro':
        // A new page (a new run, a jump): whatever framing a cutscene left goes home.
        if (this.desk.cutting) this.desk.setCut(1, 0, 0, 0, 0, 0.5)
        break
    }
  }

  update(game: FoldGame, camera: PerspectiveCamera, time: number, dt: number): void {
    const r = game.outro
    const show = r.script !== null && r.crowdCount > 0 && game.phase === 'victory'
    if (show !== this.shown) {
      this.shown = show
      this.crowd.mesh.visible = show
      if (!show) {
        for (let i = 0; i < OUTRO.crowdCap; i++) this.crowd.hide(i)
        this.crowd.commit()
      }
    }
    if (show) this.updateCrowd(game, camera, time)
    if (r.active) this.updateTrails(game, dt)
  }

  private updateCrowd(game: FoldGame, camera: PerspectiveCamera, time: number): void {
    const r = game.outro
    const cam = camera.position
    const calm = game.reducedMotion ? 0.3 : 1
    const cheering = r.active && r.time - r.cheerAt < CHEER_TIME
    const cheerK = cheering ? Math.sin(clamp01((r.time - r.cheerAt) / CHEER_TIME) * Math.PI) : 0
    const F = this.crowd
    for (let i = 0; i < OUTRO.crowdCap; i++) {
      if (i >= r.crowdCount) {
        F.hide(i)
        continue
      }
      const m = r.crowd[i]!
      const look = ACTORS[m.actor]
      const k = (r.time - m.popAt) / OUTRO.popTime
      if (k <= 0) {
        F.hide(i)
        continue
      }
      // Pops up from flat on the page (pop-up book!), then cheers.
      const rise = clamp01(k)
      const pitch = (1 - easeOutBack(rise, 2)) * -1.4
      const ph = time * (6.5 + m.seed * 2) + m.seed * 6.283
      const wave = Math.sin(ph * 0.5) > 0.2
      F.setFrame(i, cheering || !wave ? look.frames[1] : look.frames[0])
      const hop = (Math.abs(Math.sin(ph)) * look.hop + cheerK * 0.42) * calm * rise
      const roll = Math.sin(ph * 0.8) * 0.09 * calm
      const yaw = Math.atan2(cam.x - m.x, cam.z - m.z) * 0.4
      // A little squash at the bottom of each hop.
      const squash = 1 - (1 - Math.min(1, hop * 12)) * 0.06 * calm
      F.place(i, m.x, hop, m.z, yaw, roll, pitch, look.size * Math.max(0.001, easeOutBack(rise, 1.6)), squash)
    }
    F.commit()
  }

  /** Each rising rocket trails bright chips at `OUTRO.trailRate` (real time, allocation-free). */
  private updateTrails(game: FoldGame, dt: number): void {
    const fw = game.outro.fireworks
    for (let i = 0; i < fw.capacity; i++) {
      if (fw.state[i] !== FW_RISE) continue
      const k = fw.riseK(i)
      const y = fw.y[i]! * (1 - (1 - k) * (1 - k))
      this.trailDebt[i]! += dt * OUTRO.trailRate
      const tint = FIREWORK_TINTS[fw.tint[i]!] ?? 'festive'
      while (this.trailDebt[i]! >= 1) {
        this.trailDebt[i]! -= 1
        this.effects.chip(
          fw.x[i]! + (Math.random() - 0.5) * 0.06, y, fw.z[i]! + (Math.random() - 0.5) * 0.06,
          (Math.random() - 0.5) * 0.4, -0.6, (Math.random() - 0.5) * 0.4,
          OUTRO.trailLife, 0.55, 1, TINT_TRAIL[tint]
        )
      }
    }
  }

  dispose(): void {
    this.crowd.dispose()
  }
}
