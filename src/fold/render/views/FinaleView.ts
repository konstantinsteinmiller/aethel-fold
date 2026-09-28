/**
 * Page 6 (aethel-fold-GDD §8): "The Dragon is reduced to a single flat sheet
 * of paper. A dotted line appears. The player swipes one last time, folding
 * the fearsome dragon into a tiny, harmless paper frog."
 *
 * The sheet is printed with the flattened dragon (its colours in facets).
 * After the swipe: fold top-over-bottom, fold right-over-left, the packet
 * spins up in a puff of confetti and lands as a hopping origami frog.
 */

import { Group, Mesh, type BufferGeometry } from 'three'
import type { FoldGame } from '../../logic/game'
import { FINALE_TIME } from '../../logic/game'
import { clamp01, easeInOutCubic, easeOutBack } from '../../logic/math'
import { PaperBuilder, shade, type Col } from '../paperGeometry'
import { createPaperMaterial, type PaperMaterial } from '../paperMaterial'

const HINGE_Z = 0.6
const HALF_W = 3.2
const TOP_D = 2.4
const BOT_D = 2.4

/** Flat faceted sheet from x0..x1, z0..z1 (y = 0), with dragon-coloured triangles. */
const sheetGeometry = (x0: number, x1: number, z0: number, z1: number, seed: number): BufferGeometry => {
  const b = new PaperBuilder()
  const cols: Col[] = ['dragonRed', 'dragonBlue', 'dragonGreen', 'dragonYellow', 'dragonRedDark', 'dragonBlueDark', 'dragonOrange']
  const nx = 4
  const nz = 3
  let k = seed
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const ax = x0 + ((x1 - x0) * i) / nx
      const bx = x0 + ((x1 - x0) * (i + 1)) / nx
      const az = z0 + ((z1 - z0) * j) / nz
      const bz = z0 + ((z1 - z0) * (j + 1)) / nz
      const c1 = cols[k++ % cols.length]!
      const c2 = cols[(k * 3) % cols.length]!
      const y = 0.008
      if ((i + j) % 2) {
        b.tri(ax, y, az, ax, y, bz, bx, y, bz, c1)
        b.tri(ax, y, az, bx, y, bz, bx, y, az, c2)
      } else {
        b.tri(ax, y, az, ax, y, bz, bx, y, az, c1)
        b.tri(bx, y, az, ax, y, bz, bx, y, bz, c2)
      }
      // Back of the paper.
      b.tri(ax, -0.004, az, bx, -0.004, az, bx, -0.004, bz, 'parchmentShade')
      b.tri(ax, -0.004, az, bx, -0.004, bz, ax, -0.004, bz, 'parchmentShade')
    }
  }
  return b.build()
}

const frogGeometry = (): BufferGeometry => {
  const b = new PaperBuilder()
  const g: Col = 'frog'
  const d: Col = 'frogDark'
  const belly: Col = 'frogBelly'
  // Body: a folded diamond, nose toward +z.
  const N: [number, number, number] = [0, 0.32, 0.72]
  const T: [number, number, number] = [0, 0.62, 0.05]
  const L: [number, number, number] = [-0.52, 0.22, -0.05]
  const R: [number, number, number] = [0.52, 0.22, -0.05]
  const B: [number, number, number] = [0, 0.28, -0.62]
  const D: [number, number, number] = [0, 0.05, 0.05]
  const tri = (p: number[], q: number[], r: number[], c: Col): void => {
    b.tri(p[0]!, p[1]!, p[2]!, q[0]!, q[1]!, q[2]!, r[0]!, r[1]!, r[2]!, c)
  }
  tri(N, R, T, g)
  tri(N, T, L, d)
  tri(B, T, R, d)
  tri(B, L, T, g)
  tri(N, D, R, belly)
  tri(N, L, D, shade(belly, 0.9))
  tri(B, R, D, shade(g, 0.8))
  tri(B, D, L, shade(g, 0.9))
  // Eyes: two folded bumps.
  for (const s of [-1, 1]) {
    const e = [s * 0.2, 0.62, 0.3]
    tri([s * 0.08, 0.5, 0.42], [s * 0.34, 0.45, 0.22], e, 'paperWhite')
    tri(e, [s * 0.34, 0.45, 0.22], [s * 0.08, 0.5, 0.42], 'paperWhite')
    tri([s * 0.18, 0.6, 0.34], [s * 0.26, 0.57, 0.27], [s * 0.2, 0.66, 0.29], 'ink')
    tri([s * 0.2, 0.66, 0.29], [s * 0.26, 0.57, 0.27], [s * 0.18, 0.6, 0.34], 'ink')
    // Back legs: big folded triangles.
    tri([s * 0.35, 0.2, -0.35], [s * 0.95, 0.02, -0.15], [s * 0.7, 0.05, -0.8], s < 0 ? g : d)
    tri([s * 0.7, 0.05, -0.8], [s * 0.95, 0.02, -0.15], [s * 0.35, 0.2, -0.35], s < 0 ? d : g)
    // Front legs.
    tri([s * 0.25, 0.18, 0.35], [s * 0.6, 0.02, 0.55], [s * 0.35, 0.02, 0.7], g)
    tri([s * 0.35, 0.02, 0.7], [s * 0.6, 0.02, 0.55], [s * 0.25, 0.18, 0.35], d)
  }
  // A little smile.
  tri([-0.12, 0.3, 0.7], [0.12, 0.3, 0.7], [0, 0.26, 0.74], 'ink')
  return b.build()
}

export class FinaleView {
  readonly group = new Group()
  private readonly top = new Group()
  private readonly rightHalf = new Group()
  private readonly packet = new Group()
  private readonly frog: Mesh
  private readonly mat: PaperMaterial
  private readonly frogMat: PaperMaterial
  /** Set when the folded packet pops into the frog this frame (for the puff). */
  popped = false
  private poppedOnce = false
  hops = 0
  private lastHop = -1

  constructor() {
    this.mat = createPaperMaterial({ vertexColors: true, grain: 0.05, doubleSided: true, backTint: '#efe4c8' })
    this.frogMat = createPaperMaterial({ vertexColors: true, grain: 0.04 })
    // The packet holds everything that folds; its origin is the page centre of the sheet.
    this.group.add(this.packet)
    // Bottom half (stays), split into left/right so the second fold works.
    const botL = new Mesh(sheetGeometry(-HALF_W, 0, HINGE_Z, HINGE_Z + BOT_D, 3), this.mat)
    const botR = new Mesh(sheetGeometry(0, HALF_W, HINGE_Z, HINGE_Z + BOT_D, 5), this.mat)
    // Top half hinged at z = HINGE_Z; its geometry is local to the hinge.
    const topL = new Mesh(sheetGeometry(-HALF_W, 0, -TOP_D, 0, 7), this.mat)
    const topR = new Mesh(sheetGeometry(0, HALF_W, -TOP_D, 0, 11), this.mat)
    for (const m of [botL, botR, topL, topR]) {
      m.castShadow = true
      m.receiveShadow = true
    }
    // Right half (bottom-right + top-right) rotates about x = 0 for fold 2.
    this.rightHalf.add(botR)
    const topRPivot = new Group()
    topRPivot.position.z = HINGE_Z
    topRPivot.add(topR)
    this.rightHalf.add(topRPivot)
    this.top.position.z = HINGE_Z
    this.top.add(topL)
    this.packet.add(botL, this.top, this.rightHalf)
    this.rightHalf.userData.topPivot = topRPivot

    this.frog = new Mesh(frogGeometry(), this.frogMat)
    this.frog.castShadow = true
    this.frog.visible = false
    this.frog.position.set(0, 0, 0.6)
    this.frog.scale.setScalar(1.6)
    this.group.add(this.frog)
    this.group.userData.perfTag = 'fold.finale'
  }

  update(game: FoldGame, time: number, dt: number, highlight: boolean): void {
    this.popped = false
    const f = game.folds.find((o) => o.def.kind === 'frog')
    const topPivot = this.rightHalf.userData.topPivot as Group
    if (game.phase !== 'finale' && game.phase !== 'victory') {
      // Waiting for the last swipe: the finger lifts the top half a little.
      const lift = f ? f.t : 0
      const a = lift * Math.PI
      this.top.rotation.x = a
      topPivot.rotation.x = a
      this.rightHalf.rotation.z = 0
      this.packet.visible = true
      this.packet.scale.setScalar(1)
      this.packet.position.set(0, 0, 0)
      this.packet.rotation.set(0, 0, 0)
      this.frog.visible = false
      this.mat.uniforms.uHighlight.value = highlight ? 1 : 0
      this.poppedOnce = false
      this.hops = 0
      this.lastHop = -1
      return
    }
    this.mat.uniforms.uHighlight.value = 0
    const t = game.phase === 'victory' ? FINALE_TIME + 10 : game.finaleTime
    // Fold 1: top over bottom (already mostly done by the snap).
    const f1 = easeInOutCubic(clamp01(t / 0.35))
    this.top.rotation.x = Math.PI * Math.max(f1, 0.999 * (f ? f.t : 1))
    topPivot.rotation.x = this.top.rotation.x
    // Fold 2: right over left about x = 0.
    const f2 = easeInOutCubic(clamp01((t - 0.4) / 0.4))
    this.rightHalf.rotation.z = f2 * Math.PI
    // Spin up and shrink into the frog.
    const s = clamp01((t - 0.9) / 0.45)
    this.packet.visible = s < 1
    this.packet.position.set(0, s * 1.4, HINGE_Z * s)
    this.packet.rotation.y = s * s * 9
    this.packet.scale.setScalar(Math.max(0.01, 1 - s * 0.85))
    if (s >= 1 && !this.poppedOnce) {
      this.poppedOnce = true
      this.popped = true
    }
    // Frog.
    const fr = clamp01((t - 1.3) / 0.35)
    this.frog.visible = fr > 0
    const base = easeOutBack(fr, 2.4) * 1.6
    // Hops: two in the finale, then a happy hop every couple of seconds.
    const hopT = t - 1.7
    let hopY = 0
    let hopIdx = -1
    if (hopT > 0) {
      const period = hopT < 1.2 ? 0.6 : 2.2
      const local = hopT < 1.2 ? hopT % 0.6 : (hopT - 1.2) % 2.2
      hopIdx = hopT < 1.2 ? Math.floor(hopT / 0.6) : 2 + Math.floor((hopT - 1.2) / 2.2)
      const k = clamp01(local / 0.45)
      hopY = Math.sin(k * Math.PI) * (period < 1 ? 0.9 : 0.6)
    }
    if (hopIdx !== this.lastHop && hopIdx >= 0) {
      this.lastHop = hopIdx
      this.hops++
    }
    this.frog.position.set(0, hopY, 0.6)
    this.frog.scale.set(base * (1 + (hopY > 0 ? -0.08 : 0.06)), base * (1 + (hopY > 0 ? 0.12 : -0.08)), base)
    this.frog.rotation.y = Math.sin(time * 0.8) * 0.25
    void dt
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose()
    })
    this.mat.dispose()
    this.frogMat.dispose()
  }
}
