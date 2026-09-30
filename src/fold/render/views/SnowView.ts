/**
 * Winter's falling snow (roadmap #17): paper flakes drifting down over the
 * book and the desk. One instanced draw of a little six-point paper star, no
 * shadow, ink-free (paper id 127: a flake must never be outlined), in the
 * confetti's material variant (so no new shader program), shown only in the
 * Winter season and never while the camera is out at the shelf.
 *
 * Density follows the player's settings: the full flurry by default, a third
 * of it on the "fast" graphics setting, and a slow, sparse fall when reduced
 * motion is on. Pooled struct-of-arrays state; nothing allocates per frame.
 * Art only: nothing in the game knows about it.
 */

import { DynamicDrawUsage, Group, InstancedMesh, Shape, ShapeGeometry } from 'three'
import { PAGE_HALF_D, PAGE_HALF_W } from '../../logic/config'
import { createPaperMaterial, type PaperMaterial } from '../paperMaterial'
import { TMP } from '../paperGeometry'
import { HEX } from '../palette'

/** Flakes at full density. */
export const SNOW_MAX = 180
/** The volume they fall through (world units around the page). */
const X = PAGE_HALF_W + 1.6
const Z0 = -PAGE_HALF_D - 2.5
const Z1 = PAGE_HALF_D + 1
const TOP = 7

/** A six-point paper star, about 0.13 across. */
const flakeGeometry = (): ShapeGeometry => {
  const s = new Shape()
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    const r = i % 2 ? 0.028 : 0.068
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  s.closePath()
  return new ShapeGeometry(s, 1)
}

export class SnowView {
  readonly group = new Group()
  private readonly mesh: InstancedMesh
  private readonly mat: PaperMaterial
  private readonly px = new Float32Array(SNOW_MAX)
  private readonly py = new Float32Array(SNOW_MAX)
  private readonly pz = new Float32Array(SNOW_MAX)
  /** Fall speed, sway phase and spin per flake. */
  private readonly vy = new Float32Array(SNOW_MAX)
  private readonly ph = new Float32Array(SNOW_MAX)
  private readonly spin = new Float32Array(SNOW_MAX)
  private readonly size = new Float32Array(SNOW_MAX)
  private on = false
  /** Flakes drawn now (the density setting). */
  private active = SNOW_MAX
  /** Fall-speed multiplier (reduced motion slows it right down). */
  private pace = 1
  private seed = 1

  constructor() {
    // The confetti's material variant (double-sided, ink-free, instance colours): no new program.
    this.mat = createPaperMaterial({ doubleSided: true, backTint: HEX.snowShade, grain: 0, id: 127 })
    this.mesh = new InstancedMesh(flakeGeometry(), this.mat, SNOW_MAX)
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    for (let i = 0; i < SNOW_MAX; i++) this.mesh.setColorAt(i, TMP.c.set(HEX.snowBank))
    this.mesh.frustumCulled = false
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    for (let i = 0; i < SNOW_MAX; i++) this.respawn(i, this.rand() * TOP)
    this.group.add(this.mesh)
    this.group.visible = false
    this.group.userData.perfTag = 'fold.snow'
  }

  /** A tiny deterministic stream (no allocation, no Math.random dependency in tests). */
  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647
    return this.seed / 2147483647
  }

  private respawn(i: number, y: number): void {
    this.px[i] = (this.rand() * 2 - 1) * X
    this.pz[i] = Z0 + this.rand() * (Z1 - Z0)
    this.py[i] = y
    this.vy[i] = 0.55 + this.rand() * 0.55
    this.ph[i] = this.rand() * Math.PI * 2
    this.spin[i] = (this.rand() - 0.5) * 3
    this.size[i] = 0.75 + this.rand() * 0.6
  }

  /** Is it Winter (and the camera at the book)? */
  show(want: boolean): void {
    if (want === this.on) return
    this.on = want
    this.group.visible = want
  }

  /** Density from the settings: `low` graphics draws a third, reduced motion a sparse, slow fall. */
  setDensity(low: boolean, reducedMotion: boolean): void {
    const n = reducedMotion ? Math.round(SNOW_MAX / 4) : low ? Math.round(SNOW_MAX / 3) : SNOW_MAX
    this.active = n
    this.mesh.count = n
    this.pace = reducedMotion ? 0.35 : 1
  }

  get visible(): boolean {
    return this.on
  }

  get count(): number {
    return this.active
  }

  update(time: number, dt: number): void {
    if (!this.on) return
    const d = Math.min(dt, 0.05) * this.pace
    for (let i = 0; i < this.active; i++) {
      let y = this.py[i]! - this.vy[i]! * d
      if (y < 0) {
        this.respawn(i, TOP)
        y = TOP
      }
      this.py[i] = y
      const ph = this.ph[i]!
      const x = this.px[i]! + Math.sin(time * 0.9 + ph) * 0.35
      const z = this.pz[i]! + Math.cos(time * 0.7 + ph) * 0.2
      TMP.e.set(time * this.spin[i]! + ph, ph, time * this.spin[i]! * 0.5)
      TMP.q.setFromEuler(TMP.e)
      TMP.p.set(x, y, z)
      TMP.s.setScalar(this.size[i]!)
      TMP.m.compose(TMP.p, TMP.q, TMP.s)
      this.mesh.setMatrixAt(i, TMP.m)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.mesh.dispose()
    this.mat.dispose()
  }
}
