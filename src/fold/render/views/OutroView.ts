/**
 * The boss outro on screen (C9b): the cheering paper crowd and the paper
 * fireworks, both read from the game's `CutsceneRunner` (`game.outro`).
 *
 * - Crowd: one instanced `StandeeField` (its own paper id, so the Sobel pass
 *   inks every silhouette), shown only on the victory page. How each cast
 *   moves is its row's `motion` in `ACTORS`:
 *     hop   paper people pop up from flat like every standee, then hop and
 *           wave; a `cheer` beat throws everybody's arms (and hats) up.
 *     leap  book 3's dolphins: arcs out of the finale page's sea and back in,
 *           the card rolled along the arc (and mirrored for a dolphin heading
 *           left); every third leap, and every leap on a cheer, a full spin.
 *           Under water they are simply below the page — the paper sea hides
 *           them — and each exit and dive throws a little paper spray.
 *     bob   book 3's paper boats: pop up, then rock and drift on the swell
 *           while their crew waves.
 *   Sizes are phone-first: a crowd member stands ~1.3 knights tall.
 * - Fireworks: the rocket trails and bursts are chips of the shared confetti
 *   mesh (`Effects`, id 127: no ink) — no draw call of their own. Bursts open
 *   as rings facing the camera (`fireworkBurst` with the camera), high over
 *   the page's upper half. The pool's caps bound them (`OUTRO` in config).
 * - Camera: `camera` beats glide the desk camera (`DeskCamera.setCut`) on the
 *   real clock; the end (or a skip) glides it home.
 * - Pre-warm (`prewarm`): the crowd's only program the boot's `compile`
 *   can't reach — its shadow-depth program — is linked by drawing the empty
 *   crowd for a couple of frames behind the splash.
 *
 * Adding a cast is a row in `ACTORS` (frames, size, motion) plus its atlas
 * frames. Nothing here allocates per frame.
 */

import type { PerspectiveCamera } from 'three'
import type { FoldGame } from '../../logic/game'
import type { FoldEvent } from '../../logic/events'
import { OUTRO } from '../../logic/config'
import { FW_RISE, FIREWORK_TINTS, SHOT_HOME, sparksPerBurst, type CutActor, type FireworkTint } from '../../logic/cutscene'
import { clamp01, easeOutBack, smoothstep } from '../../logic/math'
import type { PaletteKey } from '../palette'
import type { FrameName, StandeeAtlas } from '../art/standeeArt'
import type { DeskCamera } from '../camera'
import type { ConfettiPalette, Effects } from './Effects'
import { STANDEE_H, STANDEE_LEAN, StandeeField } from './StandeeField'

type Motion = 'hop' | 'leap' | 'bob'

interface ActorLook {
  /** Wave and hooray frames (a dolphin: swimming, and the happy leap). */
  frames: readonly [FrameName, FrameName]
  /** Every other member of the cast wears these instead (the second paper boat). */
  alt?: readonly [FrameName, FrameName]
  /** Standee scale. */
  size: number
  /** Hop height of the idle cheer (page units); for a leap, the arc's height. */
  hop: number
  motion: Motion
}

const ACTORS: Record<CutActor, ActorLook> = {
  villagers: { frames: ['cheerVillager0', 'cheerVillager1'], size: 1.32, hop: 0.22, motion: 'hop' },
  soldiers: { frames: ['cheerSoldier0', 'cheerSoldier1'], size: 1.36, hop: 0.18, motion: 'hop' },
  farmers: { frames: ['cheerFarmer0', 'cheerFarmer1'], size: 1.32, hop: 0.2, motion: 'hop' },
  kids: { frames: ['cheerKid0', 'cheerKid1'], size: 1.24, hop: 0.3, motion: 'hop' },
  dolphins: { frames: ['dolphin0', 'dolphin1'], size: 1.4, hop: 1.55, motion: 'leap' },
  boats: { frames: ['boatA0', 'boatA1'], alt: ['boatB0', 'boatB1'], size: 1.5, hop: 0.06, motion: 'bob' }
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

/** A dolphin's leap: seconds per leap (plus up to `LEAP_VARY` by its seed), the airborne share, how far it travels. */
const LEAP_PERIOD = 2.1
const LEAP_VARY = 0.5
const LEAP_AIR = 0.56
const LEAP_LEN = 1.7
/** Of a leap's height, how much also carries it up the page (toward the top of the screen): a leap reads tall from the steep camera. */
const LEAP_UP_PAGE = 0.32
const TAU = Math.PI * 2

export class OutroView {
  readonly crowd: StandeeField
  /** Trail emission debt per firework slot (chips owed at `OUTRO.trailRate`). */
  private readonly trailDebt = new Float32Array(OUTRO.fireworkSlots)
  /** Per crowd member: in the air last frame (a dolphin), so its exits and dives splash once. */
  private readonly air = new Uint8Array(OUTRO.crowdCap)
  private shown = false
  /** Frames left of the pre-warm draw (the empty crowd shown so its shadow program links). */
  private warmFrames = 0

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

  /**
   * Link the crowd's programs before the outro needs them: its colour program
   * is shared with the units (and compiled with the scene), but its
   * shadow-depth one is only linked when a shadow pass first draws it. Show
   * the empty crowd (every instance scaled to nothing) for the next two
   * frames: two draws, no pixels, and the victory's first frame never
   * compiles. Called behind the splash (`FoldEngine.prewarm`).
   */
  prewarm(): void {
    if (this.shown) return
    this.warmFrames = 2
    this.crowd.mesh.visible = true
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
          this.effects.fireworkBurst(e.x, r.fireworks.y[e.a]!, e.z, sparksPerBurst(r.lite), TINT_PALETTE[tint], OUTRO.linger, this.desk.camera)
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
        this.air.fill(0)
        this.crowd.commit()
      }
    }
    if (this.warmFrames > 0 && --this.warmFrames === 0 && !this.shown) this.crowd.mesh.visible = false
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
      const yaw = Math.atan2(cam.x - m.x, cam.z - m.z) * 0.4
      if (look.motion === 'leap') {
        this.leap(i, m.x, m.z, m.seed, r.time - m.popAt, look, yaw, cheering, calm, game.outro.lite)
        continue
      }
      // Pops up from flat on the page (pop-up book!), then cheers.
      const rise = clamp01(k)
      const pitch = (1 - easeOutBack(rise, 2)) * -1.4
      const ph = time * (6.5 + m.seed * 2) + m.seed * 6.283
      const wave = Math.sin(ph * 0.5) > 0.2
      const frames = look.alt && i % 2 === 1 ? look.alt : look.frames
      F.setFrame(i, cheering || !wave ? frames[1] : frames[0])
      const scale = look.size * Math.max(0.001, easeOutBack(rise, 1.6))
      if (look.motion === 'bob') {
        // A paper boat rocks and drifts on the swell; a cheer bounces it.
        const sw = time * (1.3 + m.seed * 0.4) + m.seed * 6.283
        const x = m.x + Math.sin(sw * 0.45) * 0.14 * calm
        const y = (Math.sin(sw) * 0.035 + cheerK * look.hop * 2) * calm * rise
        F.place(i, x, y, m.z, yaw, Math.sin(sw * 0.8) * 0.1 * calm, pitch, scale)
        continue
      }
      const hop = (Math.abs(Math.sin(ph)) * look.hop + cheerK * 0.42) * calm * rise
      const roll = Math.sin(ph * 0.8) * 0.09 * calm
      // A little squash at the bottom of each hop.
      const squash = 1 - (1 - Math.min(1, hop * 12)) * 0.06 * calm
      F.place(i, m.x, hop, m.z, yaw, roll, pitch, scale, squash)
    }
    F.commit()
  }

  /**
   * A dolphin at `t` seconds after it first broke the surface: leaps out of
   * the sea (a parabola, also carried a little up the page so it reads tall
   * from the steep camera), the card rolled along the arc, and back in; under
   * water it is hidden. Spray on every exit and dive.
   */
  private leap(
    i: number, x0: number, z0: number, seed: number, t: number, look: ActorLook, yaw: number, cheering: boolean, calm: number, lite: boolean
  ): void {
    const F = this.crowd
    const period = LEAP_PERIOD + seed * LEAP_VARY
    const cycles = t / period
    const n = Math.floor(cycles)
    const ph = cycles - n
    const dir = seed < 0.5 ? 1 : -1
    const inAir = ph < LEAP_AIR
    const wasAir = this.air[i] === 1
    this.air[i] = inAir ? 1 : 0
    if (!inAir) {
      if (wasAir) this.splash(x0 + dir * LEAP_LEN * 0.5, z0, lite)
      F.hide(i)
      return
    }
    const u = ph / LEAP_AIR
    if (!wasAir) this.splash(x0 - dir * LEAP_LEN * 0.5, z0, lite)
    const H = look.hop * (0.55 + 0.45 * calm)
    const h = H * 4 * u * (1 - u)
    const x = x0 + dir * (u - 0.5) * LEAP_LEN
    const z = z0 - h * LEAP_UP_PAGE
    // Along the arc (screen-ish: its rise also climbs the page): nose angle from the horizontal.
    const vx = dir * LEAP_LEN
    const vy = H * 4 * (1 - 2 * u) * (1 + LEAP_UP_PAGE)
    let roll = Math.atan2(vy, vx) - Math.PI / 2
    // A full spin every third leap, and on every leap during a cheer (never in reduced motion).
    const spin = calm === 1 && (cheering || (n + Math.floor(seed * 3)) % 3 === 0)
    if (spin) roll -= dir * TAU * smoothstep(0.18, 0.82, u)
    F.setFrame(i, spin || (u > 0.28 && u < 0.72) ? look.frames[1] : look.frames[0], dir < 0)
    const s = look.size
    // Its middle rides the arc: at the ends it is half under the page (diving in, breaking out).
    F.placeAbout(i, x, h + STANDEE_H * s * 0.1, z, yaw, roll, STANDEE_LEAN, s)
  }

  /** Paper spray where a dolphin breaks the surface (a few chips of the shared confetti mesh). */
  private splash(x: number, z: number, lite: boolean): void {
    const n = lite ? OUTRO.splashChips / 2 : OUTRO.splashChips
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + Math.random() * 0.8
      this.effects.chip(
        x + Math.cos(a) * 0.12, 0.08, z + Math.sin(a) * 0.08,
        Math.cos(a) * 1.3, 2.6 + Math.random() * 1.2, Math.sin(a) * 0.6,
        OUTRO.splashLife, 0.9, 7, k % 2 ? 'seaFoam' : 'waterLight'
      )
    }
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
