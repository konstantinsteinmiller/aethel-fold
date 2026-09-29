/**
 * The keep's sling (book 2): a paper Y-fork with an elastic band and a wadded
 * paper stone in its cup.
 *
 *   ready    — the stone sits in the cup. Whenever there is something to
 *              shoot at it *asks* to be used: the fork glows (actionable
 *              outline), a blue ring pulses on the ground around it, a blue
 *              marker bobs above it, and every couple of seconds the stone
 *              tugs back on the band by itself — the gesture, demonstrated.
 *   aiming   — the cup follows the finger back; a dotted arc and a landing
 *              ring show where the stone will come down (dim until the pull
 *              is long enough to count).
 *   fired    — the band snaps forward; the cup is empty while it reloads, and
 *              a fresh stone pops in when it is ready.
 *
 * Reads `SlingState`; never writes it. No allocation per frame.
 */

import {
  BoxGeometry, CircleGeometry, Color, ConeGeometry, DynamicDrawUsage, Group, InstancedMesh, Mesh, RingGeometry, Vector3
} from 'three'
import type { SlingState } from '../../logic/types'
import type { FoldGame } from '../../logic/game'
import { G_PAPER, clamp01, easeOutBack } from '../../logic/math'
import { SLING_FLIGHT_BASE, SLING_FLIGHT_PER } from '../../logic/config'
import { createPaperMaterial, type PaperMaterial } from '../paperMaterial'
import { paperBallGeometry, slingForkGeometry } from '../models'
import { TMP } from '../paperGeometry'
import { HEX } from '../palette'

const DOTS = 11
/** The sling is drawn larger than life so a thumb can find it. */
const SCALE = 1.5
/** Band anchor points on the fork (world, after SCALE), matching slingForkGeometry. */
const TIP_Y = 0.95 * SCALE
const TIP_X = 0.3 * SCALE
/** How far the cup visibly travels back, at most (page units). */
const MAX_DRAW = 1.6

export class SlingView {
  readonly group = new Group()
  private readonly forkMat: PaperMaterial
  private readonly ballMat: PaperMaterial
  private readonly bandMat: PaperMaterial
  private readonly aimMat: PaperMaterial
  private readonly fork: Mesh
  private readonly cup: Mesh
  private readonly bands: Mesh[] = []
  private readonly ring: Mesh
  private readonly dots: InstancedMesh
  /** "Use me" cues: ground ring and a bobbing marker (no ink, guide blue). */
  private readonly cueMat: PaperMaterial
  private readonly cueRing: Mesh
  private readonly marker: Mesh
  private cue = 0
  // Pre-parsed colours: Color.set(string) parses (and allocates) every call.
  private readonly colGuide = new Color(HEX.guide)
  private readonly colGlow = new Color(HEX.guideGlow)
  private readonly colDim = new Color(HEX.parchmentEdge)
  private readonly tip = new Vector3()
  private readonly cupPos = new Vector3()
  private readonly rest = new Vector3()
  private lastRev = -1
  private recoil = 0
  private pop = 1
  private state: SlingState | null = null

  constructor() {
    this.forkMat = createPaperMaterial({ vertexColors: true, grain: 0.05 })
    this.ballMat = createPaperMaterial({ vertexColors: true, grain: 0.03 })
    this.bandMat = createPaperMaterial({ color: HEX.heroBlueDark, grain: 0 })
    // Guides draw without ink (id 127) so the arc reads as light, not as paper.
    this.aimMat = createPaperMaterial({ unlit: true, color: HEX.guide, grain: 0, id: 127 })

    this.fork = new Mesh(slingForkGeometry(), this.forkMat)
    this.fork.castShadow = true
    this.fork.receiveShadow = true
    this.group.add(this.fork)

    this.cup = new Mesh(paperBallGeometry(), this.ballMat)
    this.cup.castShadow = true
    this.group.add(this.cup)

    const unit = new BoxGeometry(1, 1, 1)
    unit.translate(0, 0, 0.5)
    for (let i = 0; i < 2; i++) {
      const band = new Mesh(unit, this.bandMat)
      band.castShadow = true
      this.bands.push(band)
      this.group.add(band)
    }

    const ring = new RingGeometry(0.95, 1.18, 32, 1)
    ring.rotateX(-Math.PI / 2)
    this.ring = new Mesh(ring, this.aimMat)
    this.ring.renderOrder = 2
    this.ring.visible = false
    this.group.add(this.ring)

    const dot = new CircleGeometry(0.075, 8)
    this.dots = new InstancedMesh(dot, this.aimMat, DOTS)
    this.dots.instanceMatrix.setUsage(DynamicDrawUsage)
    this.dots.frustumCulled = false
    this.dots.count = 0
    this.group.add(this.dots)

    this.cueMat = createPaperMaterial({ unlit: true, color: HEX.guide, grain: 0, id: 127 })
    const cueRing = new RingGeometry(0.85, 1.05, 36, 1)
    cueRing.rotateX(-Math.PI / 2)
    this.cueRing = new Mesh(cueRing, this.cueMat)
    this.cueRing.renderOrder = 2
    this.group.add(this.cueRing)
    const cone = new ConeGeometry(0.2, 0.42, 4, 1)
    cone.rotateX(Math.PI)
    this.marker = new Mesh(cone, this.cueMat)
    this.group.add(this.marker)

    this.group.visible = false
    this.group.userData.perfTag = 'fold.sling'
  }

  update(game: FoldGame, time: number, dt: number): void {
    const s = game.sling
    this.state = s
    if (!s) {
      this.group.visible = false
      return
    }
    this.group.visible = true
    const d = s.def
    this.fork.position.set(d.x, 0, d.z)
    this.fork.scale.setScalar(SCALE)
    if (s.rev !== this.lastRev) {
      // Fired (cool just set) → recoil; reloaded (cool back to 0) → pop a stone in.
      if (this.lastRev >= 0) {
        if (s.cool > 0) this.recoil = 1
        else this.pop = 0
      }
      this.lastRev = s.rev
    }
    this.recoil = Math.max(0, this.recoil - dt * 5)
    this.pop = Math.min(1, this.pop + dt * 3.2)

    // Cup: at rest just behind the fork; while aiming, follows the pull.
    this.rest.set(d.x, 0.78 * SCALE, d.z + 0.3)
    const loaded = s.cool <= 0
    // Something on the board to shoot at?
    let targets = false
    if (loaded && !s.aiming) {
      for (const e of game.enemies) {
        if (e.state === 'march' || e.state === 'stand' || e.state === 'blocked') {
          targets = true
          break
        }
      }
    }
    this.cue += ((targets ? 1 : 0) - this.cue) * Math.min(1, dt * 5)

    const cup = this.cupPos
    if (s.aiming) {
      let px = s.pullX
      let pz = s.pullZ
      const len = Math.hypot(px, pz)
      if (len > MAX_DRAW) {
        px *= MAX_DRAW / len
        pz *= MAX_DRAW / len
      }
      cup.set(this.rest.x + px, this.rest.y - Math.min(0.45, len * 0.18), this.rest.z + pz)
    } else {
      // Snap-back wobble after a shot.
      cup.copy(this.rest)
      cup.z -= Math.sin(this.recoil * Math.PI * 3) * this.recoil * 0.35
      // The tease: every 2.4 s the stone tugs back toward the player and
      // snaps home, showing the gesture without a word.
      const ph = (time % 2.4) / 2.4
      const tug = ph < 0.3 ? Math.sin((ph / 0.3) * Math.PI * 0.5) : ph < 0.4 ? 1 - (ph - 0.3) / 0.1 : 0
      cup.z += tug * 0.55 * this.cue
      cup.y -= tug * 0.12 * this.cue
    }
    this.cup.visible = loaded || s.aiming
    const ps = loaded ? Math.max(0.01, easeOutBack(this.pop, 2.6)) : 0.01
    this.cup.position.copy(cup)
    this.cup.rotation.set(time * 0.7, time * 0.4, 0)
    this.cup.scale.setScalar(ps * 1.6)

    // Bands from each fork tip to the cup.
    for (let i = 0; i < 2; i++) {
      const b = this.bands[i]!
      this.tip.set(d.x + (i === 0 ? -TIP_X : TIP_X), TIP_Y, d.z)
      const len = this.tip.distanceTo(cup)
      b.position.copy(this.tip)
      b.lookAt(cup)
      b.scale.set(0.06, 0.06, Math.max(0.001, len))
    }

    // Actionable glow + the cues.
    const hl = targets ? 1 : 0
    const c = this.cue
    this.cueRing.visible = c > 0.02
    this.marker.visible = c > 0.02
    if (c > 0.02) {
      const pulse = (time * 1.4) % 1
      const rs = (0.8 + pulse * 0.7) * c
      this.cueRing.position.set(d.x, 0.03, d.z + 0.1)
      this.cueRing.scale.set(rs, 1, rs)
      this.marker.position.set(d.x, TIP_Y + 1.05 + Math.abs(Math.sin(time * 4)) * 0.3, d.z + 0.2)
      this.marker.rotation.y = time * 2
      this.marker.scale.setScalar(Math.max(0.01, c))
      // Fade the ring as it grows (the colour eases toward the paper).
      this.cueMat.uniforms.uColor.value.copy(pulse < 0.6 ? this.colGuide : this.colGlow)
    }
    this.forkMat.uniforms.uHighlight.value = hl
    this.ballMat.uniforms.uHighlight.value = hl

    // Aim guide.
    const armed = s.aiming && game.slingArmed()
    this.ring.visible = s.aiming
    if (s.aiming) {
      this.ring.position.set(s.tx, 0.03, s.tz)
      const pulse = 0.92 + Math.sin(time * 14) * 0.08
      const k = armed ? pulse : 0.55
      this.ring.scale.set(k, 1, k)
      this.aimMat.uniforms.uColor.value.copy(armed ? this.colGuide : this.colDim)
      this.arc(cup.x, cup.y, cup.z, s.tx, s.tz, time)
    } else {
      this.dots.count = 0
    }
  }

  /** Dotted flight arc from the cup to the landing point (same ballistics as the logic). */
  private arc(x0: number, y0: number, z0: number, tx: number, tz: number, time: number): void {
    const T = SLING_FLIGHT_BASE + Math.hypot(tx - x0, tz - z0) * SLING_FLIGHT_PER
    const vy = (0.12 - y0) / T + 0.5 * G_PAPER * T
    const drift = (time * 1.6) % 1
    for (let i = 0; i < DOTS; i++) {
      const u = clamp01((i + drift) / DOTS)
      const t = u * T
      TMP.p.set(x0 + (tx - x0) * u, y0 + vy * t - 0.5 * G_PAPER * t * t + 0.04, z0 + (tz - z0) * u)
      TMP.q.identity()
      TMP.e.set(-Math.PI / 2, 0, 0)
      TMP.q.setFromEuler(TMP.e)
      const sc = 0.7 + 0.5 * Math.sin(u * Math.PI)
      TMP.s.set(sc, sc, sc)
      TMP.m.compose(TMP.p, TMP.q, TMP.s)
      this.dots.setMatrixAt(i, TMP.m)
    }
    this.dots.count = DOTS
    this.dots.instanceMatrix.needsUpdate = true
  }

  get sling(): SlingState | null {
    return this.state
  }

  dispose(): void {
    this.bands[0]?.geometry.dispose()
    this.ring.geometry.dispose()
    this.dots.geometry.dispose()
    this.dots.dispose()
    this.forkMat.dispose()
    this.ballMat.dispose()
    this.bandMat.dispose()
    this.aimMat.dispose()
    this.cueMat.dispose()
    this.cueRing.geometry.dispose()
    this.marker.geometry.dispose()
  }
}
