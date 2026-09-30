/**
 * One page of the book, fully dressed: the printed sheet (with die-cut holes),
 * its fold lines, pop-up scenery (paper pines, folded trees, bushes, rocks
 * that spring up when the page opens) and its set pieces — the battlement of
 * Page 3, the castle of Pages 4–5, the dragon, and the finale sheet — and the
 * player's own castle along the bottom edge of every page.
 *
 * Everything that stands up lives in `riser`, a group scaled on y by `rise`:
 * a page built under a turning (or peeling) sheet is held flat and unfolds as
 * the sheet uncovers it, the way a pop-up book opens — instead of its towers
 * poking through the page that is still turning over them.
 *
 * The page is printed in the current look (roadmaps #6, #17): the equipped
 * paper and the season's skin, plus the season's dress on the player's castle
 * (pumpkin towers, snow caps). `repaint` reprints it in another look — about
 * 30 ms of canvas work, so the host only calls it where a hitch can't show
 * (behind the pause menu, or in idle time off the page in play).
 */

import { Group, InstancedMesh, Mesh, PlaneGeometry, type BufferGeometry, type Scene, type Texture } from 'three'
import { CASTLE, HERO_INVULN, PAGE_HALF_D, PAGE_HALF_W } from '../../logic/config'
import type { FoldGame } from '../../logic/game'
import type { FoldState, PageDef } from '../../logic/types'
import { acrossHinge, alongHinge, isStampable, onFootprint } from '../../logic/folds'
import { clamp01, easeOutBack } from '../../logic/math'
import { createRng } from '../../logic/rng'
import { secretOnPage } from '../../logic/secrets'
import { PLAIN_LOOK, paintPage, type PageLook, type PageTextures } from '../art/pageArt'
import type { SpriteTextures } from '../art/spriteArt'
import { createPaperMaterial, type PaperMaterial } from '../paperMaterial'
import { TMP } from '../paperGeometry'
import {
  appleTreeGeometry, battlementGeometry, bushGeometry, castleBaileyGeometry, millSailsGeometry, millTowerGeometry,
  playerCastleGeometry, pineGeometry,
  rockGeometry, roundTreeGeometry, seasonCastleGeometry, snowyGeometry, tentGeometry
} from '../models'
import { FoldView } from './FoldView'
import { CastleView } from './CastleView'
import { DragonView } from './DragonView'
import { FinaleView } from './FinaleView'
import { SlingView } from './SlingView'
import { CaptionLabel, captionZ } from './CaptionLabel'

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
  textures: PageTextures
  /** The look the page is printed in. */
  look: PageLook
  /** The season's dress on the player's castle (null outside a season). */
  private seasonCastle: Mesh | null = null
  castle: CastleView | null = null
  dragon: DragonView | null = null
  finale: FinaleView | null = null
  sling: SlingView | null = null
  caption: CaptionLabel | null = null
  private sails: Mesh | null = null
  /** The mill's secret: the sails whirl (1 → 0), their angle accumulated in real time. */
  private whirlK = 0
  private sailAngle = 0
  private readonly pageMat: PaperMaterial
  private readonly propMat: PaperMaterial
  /** Scenery, one instanced mesh per prop kind; `geo` is its everyday geometry, `snow` its Winter one. */
  private readonly props: { mesh: InstancedMesh; items: PropInstance[]; geo: BufferGeometry; snow: BufferGeometry }[] = []
  private battlement: Mesh | null = null
  /** The player's castle (own material so it can flash when it is hit). */
  private readonly castleMat: PaperMaterial
  private readonly playerCastle: Mesh
  /** Everything that stands up off the page (see the file header). */
  private readonly riser = new Group()
  /** 0…1 how far the pop-ups have risen; 1 = fully up. */
  rise = 1
  /** Held flat under a turning/peeling sheet: the transition drives `rise`. */
  private held = false
  /** 0…1 pop-up of the scenery as the page opens. */
  intro = 0
  private foldStates: FoldState[]

  constructor(
    readonly def: PageDef, folds: FoldState[], sprites: SpriteTextures, overlay: Scene, captionText = '',
    look: PageLook = PLAIN_LOOK
  ) {
    this.foldStates = folds
    this.look = { paper: look.paper, season: look.season }
    this.textures = paintPage(def, this.look)
    this.pageMat = createPaperMaterial({ map: this.textures.page, grain: 0.05 })
    const plane = new PlaneGeometry(PAGE_HALF_W * 2, PAGE_HALF_D * 2)
    plane.rotateX(-Math.PI / 2)
    const page = new Mesh(plane, this.pageMat)
    page.receiveShadow = true
    this.group.add(page)

    folds.forEach((f) => {
      const v = new FoldView(f, this.textures.art, this.pageMat.uniforms.uObjectId.value)
      this.folds.push(v)
      this.group.add(v.group)
    })

    this.propMat = createPaperMaterial({ vertexColors: true, grain: 0.05 })
    this.group.add(this.riser)
    this.placeProps()

    // The player's castle: keep in the middle, ballista towers, curtain walls.
    this.castleMat = createPaperMaterial({ vertexColors: true, grain: 0.05 })
    this.playerCastle = new Mesh(
      playerCastleGeometry(CASTLE.keepZ, CASTLE.towerX, CASTLE.towerZ, CASTLE.keepTop, CASTLE.towerTop), this.castleMat
    )
    this.playerCastle.castShadow = true
    this.playerCastle.receiveShadow = true
    this.riser.add(this.playerCastle)
    // …and the rest of it, unfolding out past the page's bottom edge.
    const bailey = new Mesh(castleBaileyGeometry(), this.castleMat)
    bailey.castShadow = true
    bailey.receiveShadow = true
    this.riser.add(bailey)
    this.dressCastle(this.look.season)

    if (def.theme === 'siege') {
      this.battlement = new Mesh(battlementGeometry(9.2), this.propMat)
      this.battlement.position.set(0, 0, -6.2)
      this.battlement.castShadow = true
      this.battlement.receiveShadow = true
      this.riser.add(this.battlement)
    }
    if (def.theme === 'gates' || def.theme === 'core') {
      this.castle = new CastleView(def.theme === 'gates' ? 'gates' : 'core', sprites, overlay)
      this.riser.add(this.castle.group)
    }
    if (def.theme === 'core') {
      this.dragon = new DragonView(sprites, overlay)
      this.riser.add(this.dragon.group)
    }
    if (def.theme === 'finale') {
      this.finale = new FinaleView(def.finale ?? 'frog')
      this.group.add(this.finale.group)
    }
    if (def.sling) {
      this.sling = new SlingView()
      this.riser.add(this.sling.group)
    }
    if (def.theme === 'mill') {
      const tower = new Mesh(millTowerGeometry(), this.propMat)
      tower.position.set(4.3, 0, -1.4)
      tower.castShadow = true
      tower.receiveShadow = true
      this.sails = new Mesh(millSailsGeometry(), this.propMat)
      this.sails.position.set(4.3, 1.45, -0.83)
      this.sails.castShadow = true
      this.riser.add(tower, this.sails)
    }
    // The Orchard's secret stands by the keep: one big apple tree (tap it three times).
    const secret = secretOnPage(def.book, def.id)
    if (secret?.id === 'apples') {
      const tree = new Mesh(appleTreeGeometry(), this.propMat)
      tree.position.set(secret.x, 0, secret.z)
      tree.rotation.y = 0.6
      tree.scale.setScalar(0.95)
      tree.castShadow = true
      tree.receiveShadow = true
      this.riser.add(tree)
    }
    const cz = captionZ(def)
    if (cz !== null) {
      this.caption = new CaptionLabel(cz)
      this.caption.set(captionText)
      this.group.add(this.caption.mesh)
    }
    this.group.userData.perfTag = `fold.book${def.book}.page${def.id}`
  }

  /** Put the season's dress on the castle and the scenery (or take it off). */
  private dressCastle(season: PageLook['season']): void {
    for (const p of this.props) p.mesh.geometry = season === 'winter' ? p.snow : p.geo
    const geo = seasonCastleGeometry(season, CASTLE.keepZ, CASTLE.towerX, CASTLE.towerZ, CASTLE.keepTop, CASTLE.towerTop)
    if (this.seasonCastle && this.seasonCastle.geometry === geo) return
    if (this.seasonCastle) {
      this.seasonCastle.removeFromParent()
      this.seasonCastle = null
    }
    if (!geo) return
    const m = new Mesh(geo, this.castleMat)
    m.castShadow = true
    m.receiveShadow = true
    this.seasonCastle = m
    this.riser.add(m)
  }

  /**
   * Reprint the page in another look (roadmap #6/#17): new canvases for the
   * sheet and every flap, the castle's seasonal dress swapped. Returns false
   * when the look is the one it already has. ~30 ms: never mid-play (see the
   * file header).
   */
  repaint(look: PageLook): boolean {
    if (look.paper === this.look.paper && look.season === this.look.season) return false
    this.look = { paper: look.paper, season: look.season }
    const old = this.textures
    this.textures = paintPage(this.def, this.look)
    this.pageMat.uniforms.map!.value = this.textures.page
    for (const f of this.folds) f.setArt(this.textures.art)
    old.dispose()
    this.dressCastle(this.look.season)
    return true
  }

  get artTexture(): Texture {
    return this.textures.art
  }

  private placeProps(): void {
    const def = this.def
    const rng = createRng(def.book * 977 + def.id * 131 + 7)
    const types: { geo: BufferGeometry; name: string; weight: number; scale: [number, number] }[] = def.theme === 'orchard'
      ? [
          { geo: appleTreeGeometry(), name: 'appleTree', weight: 0.6, scale: [0.55, 0.78] },
          { geo: roundTreeGeometry(), name: 'roundTree', weight: 0.15, scale: [0.5, 0.7] },
          { geo: bushGeometry(), name: 'bush', weight: 0.25, scale: [0.7, 1] }
        ]
      : def.theme === 'camp'
        ? [
            { geo: tentGeometry(), name: 'tent', weight: 0.5, scale: [0.8, 1.05] },
            { geo: pineGeometry(), name: 'pine', weight: 0.3, scale: [0.55, 0.8] },
            { geo: rockGeometry(), name: 'rock', weight: 0.2, scale: [0.6, 0.95] }
          ]
        : [
            { geo: pineGeometry(), name: 'pine', weight: 0.42, scale: [0.55, 0.8] },
            { geo: roundTreeGeometry(), name: 'roundTree', weight: 0.28, scale: [0.5, 0.72] },
            { geo: bushGeometry(), name: 'bush', weight: 0.18, scale: [0.7, 1] },
            { geo: rockGeometry(), name: 'rock', weight: 0.12, scale: [0.6, 0.95] }
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
      const snow = snowyGeometry(ty.geo, ty.name)
      const mesh = new InstancedMesh(this.look.season === 'winter' ? snow : ty.geo, this.propMat, items.length)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.props.push({ mesh, items, geo: ty.geo, snow })
      this.riser.add(mesh)
    })
    this.applyProps(0)
  }

  private freeSpot(x: number, z: number): boolean {
    const def = this.def
    // Keep clear of the roads.
    for (let l = 0; l < def.lanes.length; l++) if (Math.abs(laneXAt(def, l, z) - x) < 1.05) return false
    // …of every fold (a tree on a flap would ride it up — and hide the guide).
    for (const f of this.foldStates) {
      if (onFootprint(f, x, z, 0.45)) return false
      // A launch flap flips 180° over its hinge and lands on the far side:
      // keep that landing strip clear too, or the flipped flap cuts a tree.
      if (f.def.kind === 'launch') {
        const s = alongHinge(f, x, z)
        const d = acrossHinge(f, x, z)
        if (s > -0.7 && s < f.len + 0.7 && d < 0.3 && d > -f.def.depth - 0.9) return false
      }
    }
    // …of the hero's camp, the castle and the set pieces.
    if (z > 4.1 && Math.abs(x) < 2.8) return false
    if ((def.theme === 'gates' || def.theme === 'core') && z < -2.3) return false
    if (def.theme === 'siege' && z < -5.3) return false
    if (def.theme === 'finale' && Math.abs(x) < 3.9 && z > -2.4 && z < 3.6) return false
    if (def.theme === 'core' && Math.abs(x) < 4.4 && z < 1) return false
    // The player's castle and its grounds along the bottom edge.
    if (z > 5.2) return false
    if (def.sling && Math.hypot(x - def.sling.x, z - def.sling.z) < 2.2) return false
    if (def.theme === 'mill' && Math.hypot(x - 4.3, z + 1.4) < 1.4) return false
    // A tap secret's target stays clear, so the finger finds it (roadmap #15).
    const sd = secretOnPage(def.book, def.id)
    if (sd && sd.trigger === 'taps' && !sd.hero && Math.hypot(x - sd.x, z - sd.z) < 1.2) return false
    // The caption label along the top edge.
    // (Standing props project up the screen, so keep well below it.)
    const cz = captionZ(def)
    if (cz !== null && cz < 0 && z < cz + 1.5) return false
    if (cz !== null && cz > 0 && z > cz - 0.6) return false
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

  /** Hold every pop-up flat until a page transition lets it rise. */
  hold(): void {
    this.held = true
    this.setRise(0)
  }

  /** The transition is over: stand fully up and resume the normal intro. */
  release(): void {
    this.held = false
    this.setRise(1)
  }

  /** 0…1: how far the pop-ups have risen out of the page (with a paper bounce). */
  setRise(r: number): void {
    const k = clamp01(r)
    this.rise = k
    this.riser.scale.y = Math.max(0.001, k >= 1 ? 1 : easeOutBack(k, 1.8))
    this.riser.visible = k > 0.002
    if (this.held) {
      this.intro = k * 1.2
      this.applyProps(this.intro)
    }
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
    if (!this.held && this.intro < 1.2) {
      this.intro = Math.min(1.2, this.intro + dt * 1.2)
      this.applyProps(this.intro)
    }
    const lesson = game.lesson
    const lid = lesson.id
    const lessonFold = lid && lid !== 'spread' && lid !== 'peel' && lid !== 'crease' && lid !== 'core' && lid !== 'sling' && lid !== 'leaper'
      ? lesson.target
      : -1
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
          // A folded ballista glows once enemies are past the middle of the page.
          if (!hl && f.def.kind === 'ballista') {
            for (const e of game.enemies) if ((e.state === 'march' || e.state === 'blocked') && e.z > 0) hl = true
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
      this.folds[i]!.update(time, dt, hl && Math.floor(time * 2.5) % 2 === 0 ? true : hl, this.rise)
    }
    // A lesson's first-encounter demo: the ghost of its flap moves with the hand.
    const demo = lesson.demo
    const live = game.page === this.def && demo.phase !== 'off' && demo.on === 'fold'
    for (let i = 0; i < this.folds.length; i++) {
      const on = live && demo.target === i
      this.folds[i]!.ghost(on ? demo.fold : 0, on ? demo.alpha * Math.min(1, this.rise) : 0)
    }
    // The castle flashes and shudders while it recovers from a hit.
    const inv = game.page === this.def ? Math.max(0, game.hero.invuln) / HERO_INVULN : 0
    this.castleMat.uniforms.uFlash.value = inv * 0.45
    this.playerCastle.position.x = inv > 0.4 ? Math.sin(time * 60) * 0.04 * inv : 0
    this.castle?.update(game, time, dt)
    this.dragon?.update(game, time, dt)
    // Only the page in play drives the sling (a preview under a turn stays at rest).
    if (this.sling) {
      if (game.page === this.def) this.sling.update(game, time, dt)
    }
    if (this.sails) {
      this.whirlK = Math.max(0, this.whirlK - dt * 0.45)
      this.sailAngle += dt * (0.9 + this.whirlK * this.whirlK * 16)
      this.sails.rotation.z = this.sailAngle
    }
    const frogFold = this.foldStates.findIndex((f) => f.def.kind === 'frog')
    this.finale?.update(game, time, dt, frogFold >= 0 && this.foldStates[frogFold]!.phase === 'ready')
  }

  /** The mill's secret: the sails whirl round, then wind down. */
  whirl(): void {
    this.whirlK = 1
  }

  dispose(): void {
    for (const f of this.folds) f.dispose()
    for (const p of this.props) p.mesh.dispose()
    this.castle?.dispose()
    this.dragon?.dispose()
    this.finale?.dispose()
    this.sling?.dispose()
    this.caption?.dispose()
    this.group.traverse((o) => {
      if (o instanceof Mesh && !(o instanceof InstancedMesh) && !o.geometry.userData.shared) o.geometry.dispose()
    })
    this.pageMat.dispose()
    this.propMat.dispose()
    this.castleMat.dispose()
    this.textures.dispose()
  }
}
