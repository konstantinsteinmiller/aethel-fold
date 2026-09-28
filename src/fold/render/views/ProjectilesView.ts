/**
 * Paper arrows and crumpled-paper boulders in flight, plus the red dashed
 * landing markers that telegraph where a boulder (or the dragon's breath) is
 * going to land.
 */

import { DynamicDrawUsage, Group, InstancedMesh, Mesh, RingGeometry, Vector3 } from 'three'
import type { FoldGame } from '../../logic/game'
import { MAX_PROJECTILES } from '../../logic/entities'
import { arrowGeometry, boulderGeometry } from '../models'
import { createPaperMaterial, type PaperMaterial } from '../paperMaterial'
import { TMP } from '../paperGeometry'
import { HEX } from '../palette'
import type { SurfaceSampler } from './UnitsView'

const MARKERS = 6

export class ProjectilesView {
  readonly group = new Group()
  private readonly arrows: InstancedMesh
  private readonly boulders: InstancedMesh
  private readonly mat: PaperMaterial
  private readonly markers: Mesh[] = []
  private readonly markerMat: PaperMaterial
  private readonly breathMarker: Mesh
  private readonly breathMat: PaperMaterial
  private readonly dir = new Vector3()
  private readonly fwd = new Vector3(0, 0, 1)
  /** Visual lift for shots fired from battlements / towers, decaying over the flight. */
  private readonly lift = new Float32Array(MAX_PROJECTILES)
  private readonly serial = new Float64Array(MAX_PROJECTILES)
  private readonly lastDir = new Float32Array(MAX_PROJECTILES * 3)

  constructor() {
    this.mat = createPaperMaterial({ vertexColors: true, grain: 0.03 })
    this.arrows = new InstancedMesh(arrowGeometry(), this.mat, MAX_PROJECTILES)
    this.boulders = new InstancedMesh(boulderGeometry(), this.mat, 8)
    for (const m of [this.arrows, this.boulders]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage)
      m.frustumCulled = false
      m.castShadow = true
      m.count = 0
      this.group.add(m)
    }
    const ring = new RingGeometry(0.5, 0.62, 28, 1)
    ring.rotateX(-Math.PI / 2)
    this.markerMat = createPaperMaterial({ unlit: true, color: HEX.danger, grain: 0 })
    for (let i = 0; i < MARKERS; i++) {
      const m = new Mesh(ring, this.markerMat)
      m.visible = false
      m.renderOrder = 2
      this.markers.push(m)
      this.group.add(m)
    }
    this.breathMat = createPaperMaterial({ unlit: true, color: HEX.dragonOrange, grain: 0 })
    this.breathMarker = new Mesh(ring, this.breathMat)
    this.breathMarker.visible = false
    this.group.add(this.breathMarker)
    this.group.userData.perfTag = 'fold.projectiles'
  }

  update(game: FoldGame, surf: SurfaceSampler, time: number): void {
    let na = 0
    let nb = 0
    let nm = 0
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const p = game.projectiles[i]!
      if (!p.alive) continue
      if (p.serial !== this.serial[i]) {
        this.serial[i] = p.serial
        const owner = game.enemies[p.owner]
        this.lift[i] = owner ? surf.stand(owner.x, owner.z) : 0
      }
      const k = p.stuck ? 1 : Math.min(1, p.age / Math.max(0.01, p.life))
      const y = p.y + this.lift[i]! * (1 - k)
      if (p.type === 'arrow') {
        if (p.stuck) {
          // Keep the last flight direction (velocity is zeroed once it sticks).
          this.dir.set(this.lastDir[i * 3]!, this.lastDir[i * 3 + 1]!, this.lastDir[i * 3 + 2]!)
        } else {
          this.dir.set(p.vx, p.vy, p.vz).normalize()
          this.lastDir[i * 3] = this.dir.x
          this.lastDir[i * 3 + 1] = this.dir.y
          this.lastDir[i * 3 + 2] = this.dir.z
        }
        if (this.dir.lengthSq() < 0.5) this.dir.set(0, 0, 1)
        TMP.q.setFromUnitVectors(this.fwd, this.dir)
        TMP.p.set(p.x, y, p.z)
        TMP.s.setScalar(1.25)
        TMP.m.compose(TMP.p, TMP.q, TMP.s)
        this.arrows.setMatrixAt(na++, TMP.m)
      } else if (p.type === 'boulder' && nb < 8) {
        TMP.e.set(time * 7 + i, time * 5, 0)
        TMP.q.setFromEuler(TMP.e)
        TMP.p.set(p.x, y + 0.3, p.z)
        TMP.s.setScalar(1.2)
        TMP.m.compose(TMP.p, TMP.q, TMP.s)
        this.boulders.setMatrixAt(nb++, TMP.m)
        if (!p.stuck && nm < MARKERS) {
          const m = this.markers[nm++]!
          m.visible = true
          m.position.set(p.tx, 0.02, p.tz)
          const pulse = 0.85 + Math.sin(time * 16) * 0.15
          const s = (0.6 + k * 0.7) * pulse
          m.scale.set(s, 1, s)
        }
      }
    }
    this.arrows.count = na
    this.boulders.count = nb
    this.arrows.instanceMatrix.needsUpdate = true
    this.boulders.instanceMatrix.needsUpdate = true
    for (let i = nm; i < MARKERS; i++) this.markers[i]!.visible = false

    // Breath telegraph: a pulsing orange ring where the fire will land.
    const b = game.boss
    const charging = game.pageId === 5 && (b.phase === 'breathCharge' || b.phase === 'breath')
    this.breathMarker.visible = charging
    if (charging) {
      const k = b.phase === 'breathCharge' ? 1 - Math.max(0, b.timer) / 2.2 : 1
      this.breathMarker.position.set(b.aimX, 0.025, b.aimZ)
      const s = (1.8 - k * 0.8) * (0.9 + Math.sin(time * 18) * 0.1)
      this.breathMarker.scale.set(s, 1, s)
    }
  }

  dispose(): void {
    this.mat.dispose()
    this.markerMat.dispose()
    this.breathMat.dispose()
    this.markers[0]?.geometry.dispose()
    this.arrows.dispose()
    this.boulders.dispose()
  }
}
