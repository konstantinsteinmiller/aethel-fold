/**
 * One page of the book, fully dressed: the printed sheet (with die-cut holes),
 * its fold lines, pop-up scenery (paper pines, folded trees, bushes, rocks
 * that spring up when the page opens) and its set pieces — the battlement of
 * Page 3, the castle of Pages 4–5, the dragon, and the finale sheet.
 */

import { Group, InstancedMesh, Mesh, PlaneGeometry, type BufferGeometry, type Scene, type Texture } from 'three'
import { PAGE_HALF_D, PAGE_HALF_W } from '../../logic/config'
import type { FoldGame } from '../../logic/game'
import type { FoldState, PageDef } from '../../logic/types'
import { isStampable, onFootprint } from '../../logic/folds'
import { clamp01, easeOutBack } from '../../logic/math'
import { createRng } from '../../logic/rng'
import { paintPage, type PageTextures } from '../art/pageArt'
import type { SpriteTextures } from '../art/spriteArt'
import { createPaperMaterial, type PaperMaterial } from '../paperMaterial'
import { TMP } from '../paperGeometry'
import { battlementGeometry, bushGeometry, pineGeometry, rockGeometry, roundTreeGeometry } from '../models'
import { FoldView } from './FoldView'
import { CastleView } from './CastleView'
import { DragonView } from './DragonView'
import { FinaleView } from './FinaleView'

interface PropInstance {
  x: number
  z: number
  rot: number
  scale: number
  delay: number
}

const laneXAt = (page: PageDef, lane: number, z: number): number => {
  const p = page.lanes[lane]!.points
  if (z <= p[1]!) return p[0]!
  for (let i = 2; i < p.length; i += 2) {
    if (z <= p[i + 1]!) {
      const t = (z - p[i - 1]!) / (p[i + 1]! - p[i - 1]! || 1)
      return p[i - 2]! + (p[i]! - p[i - 2]!) * t
    }
  }
  return p[p.length - 2]!
}

export class PageView {
  readonly group = new Group()
  readonly folds: FoldView[] = []
  readonly textures: PageTextures
  castle: CastleView | null = null
  dragon: DragonView | null = null
  finale: FinaleView | null = null
  private readonly pageMat: PaperMaterial
  private readonly propMat: PaperMaterial
  private readonly props: { mesh: InstancedMesh; items: PropInstance[] }[] = []
  private battlement: Mesh | null = null
  /** 0…1 pop-up of the scenery as the page opens. */
  intro = 0
  private foldStates: FoldState[]

  constructor(readonly def: PageDef, folds: FoldState[], sprites: SpriteTextures, overlay: Scene) {
    this.foldStates = folds
    this.textures = paintPage(def)
    this.pageMat = createPaperMaterial({ map: this.textures.page, grain: 0.05 })
    const plane = new PlaneGeometry(PAGE_HALF_W * 2, PAGE_HALF_D * 2)
    plane.rotateX(-Math.PI / 2)
    const page = new Mesh(plane, this.pageMat)
    page.receiveShadow = true
    this.group.add(page)

    folds.forEach((f) => {
      const v = new FoldView(f, this.textures.art)
      this.folds.push(v)
      this.group.add(v.group)
    })

    this.propMat = createPaperMaterial({ vertexColors: true, grain: 0.05 })
    this.placeProps()

    if (def.theme === 'siege') {
      this.battlement = new Mesh(battlementGeometry(9.2), this.propMat)
      this.battlement.position.set(0, 0, -6.2)
      this.battlement.castShadow = true
      this.battlement.receiveShadow = true
      this.group.add(this.battlement)
    }
    if (def.theme === 'gates' || def.theme === 'core') {
      this.castle = new CastleView(def.theme === 'gates' ? 'gates' : 'core', sprites, overlay)
      this.group.add(this.castle.group)
    }
    if (def.theme === 'core') {
      this.dragon = new DragonView(sprites, overlay)
      this.group.add(this.dragon.group)
    }
    if (def.theme === 'finale') {
      this.finale = new FinaleView()
      this.group.add(this.finale.group)
    }
    this.group.userData.perfTag = `fold.page${def.id}`
  }

  get artTexture(): Texture {
    return this.textures.art
  }

  private placeProps(): void {
    const def = this.def
    const rng = createRng(def.id * 131 + 7)
    const types: { geo: BufferGeometry; weight: number; scale: [number, number] }[] = [
      { geo: pineGeometry(), weight: 0.42, scale: [0.55, 0.8] },
      { geo: roundTreeGeometry(), weight: 0.28, scale: [0.5, 0.72] },
      { geo: bushGeometry(), weight: 0.18, scale: [0.7, 1] },
      { geo: rockGeometry(), weight: 0.12, scale: [0.6, 0.95] }
    ]
    const buckets: PropInstance[][] = types.map(() => [])
    const tries = 260
    const want = def.theme === 'core' ? 8 : def.theme === 'finale' ? 16 : 18
    let placed = 0
    for (let n = 0; n < tries && placed < want; n++) {
      const x = -PAGE_HALF_W + 0.45 + rng.next() * (PAGE_HALF_W * 2 - 0.9)
      const z = -PAGE_HALF_D + 0.5 + rng.next() * (PAGE_HALF_D * 2 - 1)
      if (!this.freeSpot(x, z)) continue
      let r = rng.next()
      let t = 0
      while (t < types.length - 1 && r > types[t]!.weight) {
        r -= types[t]!.weight
        t++
      }
      const [s0, s1] = types[t]!.scale
      buckets[t]!.push({ x, z, rot: rng.next() * Math.PI * 2, scale: s0 + rng.next() * (s1 - s0), delay: rng.next() * 0.45 })
      placed++
    }
    types.forEach((ty, i) => {
      const items = buckets[i]!
      if (items.length === 0) return
      const mesh = new InstancedMesh(ty.geo, this.propMat, items.length)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.props.push({ mesh, items })
      this.group.add(mesh)
    })
    this.applyProps(0)
  }

  private freeSpot(x: number, z: number): boolean {
    const def = this.def
    // Keep clear of the roads.
    for (let l = 0; l < def.lanes.length; l++) if (Math.abs(laneXAt(def, l, z) - x) < 1.05) return false
    // …of every fold (a tree on a flap would ride it up — and hide the guide).
    for (const f of this.foldStates) if (onFootprint(f, x, z, 0.45)) return false
    // …of the hero's camp, the castle and the set pieces.
    if (z > 4.1 && Math.abs(x) < 2.8) return false
    if ((def.theme === 'gates' || def.theme === 'core') && z < -2.3) return false
    if (def.theme === 'siege' && z < -5.3) return false
    if (def.theme === 'finale' && Math.abs(x) < 3.9 && z > -2.4 && z < 3.6) return false
    if (def.theme === 'core' && Math.abs(x) < 4.4 && z < 1) return false
    // Not on the frame's very edge.
    if (Math.abs(x) > PAGE_HALF_W - 0.35 || Math.abs(z) > PAGE_HALF_D - 0.4) return false
    // Not on top of another prop.
    for (const p of this.props) for (const it of p.items) if (Math.hypot(it.x - x, it.z - z) < 0.8) return false
    return true
  }

  private applyProps(k: number): void {
    for (const { mesh, items } of this.props) {
      items.forEach((it, i) => {
        const p = clamp01((k - it.delay) / 0.55)
        const s = Math.max(0.001, easeOutBack(p, 2.4)) * it.scale
        TMP.e.set((1 - clamp01(p * 1.4)) * -1.3, it.rot, 0)
        TMP.q.setFromEuler(TMP.e)
        TMP.p.set(it.x, 0, it.z)
        TMP.s.set(it.scale, s, it.scale)
        TMP.m.compose(TMP.p, TMP.q, TMP.s)
        mesh.setMatrixAt(i, TMP.m)
      })
      mesh.instanceMatrix.needsUpdate = true
    }
  }

  /** Re-bind to live fold states (a preview built under a turning page, or a restart). */
  bindFolds(folds: FoldState[]): void {
    this.foldStates = folds
    folds.forEach((f, i) => this.folds[i]?.bind(f))
  }

  /** Valley dip under a trapped enemy (see FoldView.dipAt). */
  dip(fold: number, x: number, z: number): number {
    return this.folds[fold]?.dipAt(x, z) ?? 0
  }

  stand(x: number, z: number): number {
    if (this.def.theme === 'siege' && z < -5.6) return 0.55
    if (this.castle) return this.castle.standAt(x, z)
    return 0
  }

  update(game: FoldGame, time: number, dt: number): void {
    if (this.intro < 1.2) {
      this.intro = Math.min(1.2, this.intro + dt * 1.2)
      this.applyProps(this.intro)
    }
    const lesson = game.lesson
    const lessonFold = lesson.id && lesson.id !== 'spread' && lesson.id !== 'peel' && lesson.id !== 'crease' && lesson.id !== 'core' ? lesson.target : -1
    for (let i = 0; i < this.folds.length; i++) {
      const f = this.foldStates[i]!
      let hl = false
      if (f.phase === 'ready') {
        if (i === lessonFold || f.def.kind === 'frog') hl = true
        else {
          for (const e of game.enemies) {
            if ((e.state === 'march' || e.state === 'stand') && onFootprint(f, e.x, e.z, f.def.kind === 'launch' ? 0.2 : 0.9)) {
              hl = true
              break
            }
          }
          if (!hl && f.def.structure === 'shield') {
            for (const e of game.enemies) if (e.state === 'stand' && e.windup > 0.2) hl = true
            if (game.boss.phase === 'breathCharge') hl = true
          }
        }
      } else if (isStampable(f)) {
        for (const e of game.enemies) {
          if ((e.state === 'blocked' || e.state === 'trapped') && e.fold === i) {
            hl = true
            break
          }
        }
      }
      this.folds[i]!.update(time, dt, hl && Math.floor(time * 2.5) % 2 === 0 ? true : hl)
    }
    this.castle?.update(game, time, dt)
    this.dragon?.update(game, time, dt)
    const frogFold = this.foldStates.findIndex((f) => f.def.kind === 'frog')
    this.finale?.update(game, time, dt, frogFold >= 0 && this.foldStates[frogFold]!.phase === 'ready')
  }

  dispose(): void {
    for (const f of this.folds) f.dispose()
    for (const p of this.props) p.mesh.dispose()
    this.castle?.dispose()
    this.dragon?.dispose()
    this.finale?.dispose()
    this.group.traverse((o) => {
      if (o instanceof Mesh && !(o instanceof InstancedMesh) && !o.geometry.userData.shared) o.geometry.dispose()
    })
    this.pageMat.dispose()
    this.propMat.dispose()
    this.textures.dispose()
  }
}
