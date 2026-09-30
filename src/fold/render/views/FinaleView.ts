/**
 * Page 6 (aethel-fold-GDD §8): "The Dragon is reduced to a single flat sheet
 * of paper. A dotted line appears. The player swipes one last time, folding
 * the fearsome dragon into a tiny, harmless paper frog."
 *
 * Book 2 ends the same way but folds a paper crane that flutters above the
 * keep instead of a hopping frog; book 3 folds the flattened kraken (its
 * violet sheet) into a little paper fish that leaps as if out of the sea.
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
import { craneGeometry } from '../models'
import { createPaperMaterial, type PaperMaterial } from '../paperMaterial'

const HINGE_Z = 0.6
const HALF_W = 3.2
const TOP_D = 2.4
const BOT_D = 2.4

const DRAGON_SHEET: readonly Col[] = ['dragonRed', 'dragonBlue', 'dragonGreen', 'dragonYellow', 'dragonRedDark', 'dragonBlueDark', 'dragonOrange']
const KRAKEN_SHEET: readonly Col[] = ['kraken', 'krakenDark', 'krakenLight', 'krakenSucker', 'kraken', 'seaDeep', 'krakenDark']

/** Flat faceted sheet from x0..x1, z0..z1 (y = 0), with the boss's colours in triangles. */
const sheetGeometry = (
  x0: number, x1: number, z0: number, z1: number, seed: number, cols: readonly Col[] = DRAGON_SHEET
): BufferGeometry => {
  const b = new PaperBuilder()
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

/** Book 3's finale: a folded paper fish, nose toward +z, standing on its belly fin. */
const fishGeometry = (): BufferGeometry => {
  const b = new PaperBuilder()
  const tri = (p: number[], q: number[], r: number[], c: Col): void => {
    b.tri(p[0]!, p[1]!, p[2]!, q[0]!, q[1]!, q[2]!, r[0]!, r[1]!, r[2]!, c)
  }
  const N = [0, 0.4, 0.75]
  const T = [0, 0.78, 0]
  const B = [0, 0.08, 0.05]
  const L = [-0.22, 0.4, 0.05]
  const R = [0.22, 0.4, 0.05]
  const K = [0, 0.4, -0.55]
  // Body: two folded diamonds (front and back half).
  tri(N, R, T, 'fish')
  tri(N, T, L, 'fishDark')
  tri(N, B, R, 'fishBelly')
  tri(N, L, B, shade('fishBelly', 0.9))
  tri(K, T, R, 'fishDark')
  tri(K, L, T, 'fish')
  tri(K, R, B, shade('fish', 0.85))
  tri(K, B, L, 'fishDark')
  // Tail: a notched fin, both faces.
  const t1 = [0, 0.82, -0.95]
  const t2 = [0, 0.02, -0.95]
  const tm = [0, 0.4, -0.78]
  tri(K, t1, tm, 'fish')
  tri(K, tm, t1, 'fishDark')
  tri(K, tm, t2, 'fish')
  tri(K, t2, tm, 'fishDark')
  // Eyes.
  for (const sx of [-1, 1]) {
    tri([sx * 0.2, 0.5, 0.42], [sx * 0.2, 0.38, 0.5], [sx * 0.2, 0.52, 0.56], 'paperWhite')
    tri([sx * 0.2, 0.5, 0.42], [sx * 0.2, 0.52, 0.56], [sx * 0.2, 0.38, 0.5], 'paperWhite')
    tri([sx * 0.21, 0.47, 0.47], [sx * 0.21, 0.43, 0.5], [sx * 0.21, 0.5, 0.51], 'ink')
    tri([sx * 0.21, 0.47, 0.47], [sx * 0.21, 0.5, 0.51], [sx * 0.21, 0.43, 0.5], 'ink')
  }
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

  constructor(private readonly variant: 'frog' | 'crane' | 'fish' = 'frog') {
    const cols = variant === 'fish' ? KRAKEN_SHEET : DRAGON_SHEET
    this.mat = createPaperMaterial({ vertexColors: true, grain: 0.05, doubleSided: true, backTint: '#efe4c8' })
    this.frogMat = createPaperMaterial({ vertexColors: true, grain: 0.04 })
    // The packet holds everything that folds; its origin is the page centre of the sheet.
    this.group.add(this.packet)
    // Bottom half (stays), split into left/right so the second fold works.
    const botL = new Mesh(sheetGeometry(-HALF_W, 0, HINGE_Z, HINGE_Z + BOT_D, 3, cols), this.mat)
    const botR = new Mesh(sheetGeometry(0, HALF_W, HINGE_Z, HINGE_Z + BOT_D, 5, cols), this.mat)
    // Top half hinged at z = HINGE_Z; its geometry is local to the hinge.
    const topL = new Mesh(sheetGeometry(-HALF_W, 0, -TOP_D, 0, 7, cols), this.mat)
    const topR = new Mesh(sheetGeometry(0, HALF_W, -TOP_D, 0, 11, cols), this.mat)
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

    // The crane geometry is a shared cached one; the finale owns (and disposes) a copy.
    this.frog = new Mesh(
      variant === 'crane' ? craneGeometry('dragonRed').clone() : variant === 'fish' ? fishGeometry() : frogGeometry(), this.frogMat
    )
    this.frog.castShadow = true
    this.frog.visible = false
    this.frog.position.set(0, 0, 0.6)
    this.frog.scale.setScalar(1.6)
    this.group.add(this.frog)
    this.group.userData.perfTag = 'fold.finale'
  }

  /** The finale's secret (roadmap #15): the frog takes a big spinning hop, the crane a loop. */
  trick(): void {
    this.trickK = 1
  }

  private trickK = 0

  update(game: FoldGame, time: number, dt: number, highlight: boolean): void {
    this.popped = false
    this.trickK = Math.max(0, this.trickK - dt * 1.25)
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
    if (this.variant === 'crane') {
      // The crane rises and hovers, wings beating (a squash on y).
      const rise = clamp01((t - 1.5) / 1.4)
      const beat = Math.sin(time * 7)
      this.frog.position.set(Math.sin(time * 0.9) * 0.4 * rise, 0.1 + rise * 1.6 + Math.sin(time * 1.7) * 0.12 * rise, 0.6)
      this.frog.scale.set(base * 1.4, base * 1.4 * (1 + beat * 0.1 * rise), base * 1.4)
      // Tipped back toward the lens so its wings read from the steep camera.
      this.frog.rotation.set(0.9, Math.sin(time * 0.6) * 0.35, Math.sin(time * 0.9) * 0.1 * rise)
      if (this.trickK > 0) {
        // A loop-the-loop with fast wingbeats.
        const k = 1 - this.trickK
        this.frog.position.y += Math.sin(k * Math.PI) * 1.4
        this.frog.rotation.x += k * Math.PI * 2
        this.frog.scale.y *= 1 + Math.sin(time * 30) * 0.2 * this.trickK
      }
      return
    }
    if (this.variant === 'fish') {
      // The fish leaps in arcs, nose up on the way up and down on the way down, turning side-on to the lens.
      const leapT = Math.max(0, t - 1.7)
      const k = (leapT % 1.6) / 1.6
      const leapY = Math.sin(k * Math.PI) * 1.1
      this.frog.position.set(Math.sin(time * 0.7) * 0.5, leapY, 0.6)
      this.frog.scale.setScalar(base * 1.1)
      this.frog.rotation.set(Math.cos(k * Math.PI) * -0.9, Math.PI / 2 + Math.sin(time * 0.5) * 0.3, 0)
      if (this.trickK > 0) {
        // A big leap with a twist.
        const q = 1 - this.trickK
        this.frog.position.y += Math.sin(q * Math.PI) * 2.6
        this.frog.rotation.z += q * Math.PI * 2
      }
      return
    }
    this.frog.position.set(0, hopY, 0.6)
    this.frog.scale.set(base * (1 + (hopY > 0 ? -0.08 : 0.06)), base * (1 + (hopY > 0 ? 0.12 : -0.08)), base)
    this.frog.rotation.y = Math.sin(time * 0.8) * 0.25
    if (this.trickK > 0) {
      // A big spinning hop.
      const k = 1 - this.trickK
      this.frog.position.y += Math.sin(k * Math.PI) * 2.2
      this.frog.rotation.y += k * Math.PI * 2
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose()
    })
    this.mat.dispose()
    this.frogMat.dispose()
  }
}
