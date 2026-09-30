/**
 * The desk bookshelf (roadmap #2): a small cardboard shelf right of the book
 * with one standing book per book of the game and a silhouette for the one
 * still to come. Chapter select without a menu: the camera goes out to it
 * (`DeskCamera.setShelf`), a tap pulls a book out and a little star card
 * rises from it, a second tap opens it (see `logic/shelf.ts`).
 *
 * Draw cost: the shelf body plus one mesh per book (one texture each: spine
 * art and two swatches, see `SPINE_UV`), plus the star card while a book is
 * pulled out — five draws at most, none at all while the shelf is out of
 * view (`group.visible = false`). Textures repaint only when the shelf's
 * `rev` changes; the per-frame update eases a few numbers.
 *
 * On the top board (`extras`): the Dragon Rush figurines (roadmap #16), one
 * little folded dragon per won book — tapped like a book, their card shows
 * the par and the best time — and the secrets counter (roadmap #15), a
 * standing card with a sparkle and "found/total". Two to four more draws,
 * still none while the shelf is out of view.
 */

import { BufferGeometry, Group, Mesh, PlaneGeometry, type CanvasTexture } from 'three'
import { SHELF } from '../../logic/config'
import { SECRET_IDS, SECRET_TOTAL } from '../../logic/secrets'
import type { FoldEvent } from '../../logic/events'
import type { FoldGame } from '../../logic/game'
import {
  SHELF_CARD_H, SHELF_CARD_W, isRushSlot, rushSlotOf, shelfCardPose, shelfHalfWidth, slotAnchor, slotX, type ShelfCardPose,
  type ShelfPoint, type ShelfState
} from '../../logic/shelf'
import { BOOK_COUNT } from '../../logic/pages'
import { PaperBuilder } from '../paperGeometry'
import { createPaperMaterial, type PaperMaterial } from '../paperMaterial'
import {
  SPINE_UV, cardCanvas, paintRushCard, paintSecretsCard, paintSpine, paintStarCard, secretsCanvas, spineCanvas
} from '../art/shelfArt'
import { rushDragonGeometry } from '../models'
import type { PaletteKey } from '../palette'
import { toTexture } from '../art/canvas'

/** One standing book: a box whose faces sample the spine texture (spine art, cover and page swatches). */
const bookGeometry = (): BufferGeometry => {
  const b = new PaperBuilder()
  const x = SHELF.bookW / 2
  const h = SHELF.bookH
  const z = SHELF.bookD / 2
  const S = SPINE_UV.spine
  const C = SPINE_UV.cover
  const P = SPINE_UV.pages
  const c: [number, number] = [C.u, C.v]
  const p: [number, number] = [P.u, P.v]
  const flat = (q: [number, number]): [[number, number], [number, number], [number, number], [number, number]] => [q, q, q, q]
  // Spine (+z, toward the player).
  b.quad([-x, 0, z], [x, 0, z], [x, h, z], [-x, h, z], 'paperWhite', [[S.u0, S.v0], [S.u1, S.v0], [S.u1, S.v1], [S.u0, S.v1]])
  // Fore-edge (−z), top and bottom: the page block.
  b.quad([x, 0, -z], [-x, 0, -z], [-x, h, -z], [x, h, -z], 'paperWhite', flat(p))
  b.quad([-x, h, z], [x, h, z], [x, h, -z], [-x, h, -z], 'paperWhite', flat(p))
  b.quad([-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], 'paperWhite', flat(p))
  // Cover boards (±x).
  b.quad([x, 0, z], [x, 0, -z], [x, h, -z], [x, h, z], 'paperWhite', flat(c))
  b.quad([-x, 0, -z], [-x, 0, z], [-x, h, z], [-x, h, -z], 'paperWhite', flat(c))
  return b.build()
}

/** The cardboard shelf: bottom and top boards, two sides and a back. */
const shelfGeometry = (): BufferGeometry => {
  const b = new PaperBuilder()
  const hw = shelfHalfWidth()
  const t = SHELF.board
  const d = SHELF.bookD + 0.3
  const innerH = SHELF.bookH + 0.28
  b.push().translate(0, 0, 0).box(hw * 2, t, d, 'underlayer', 'parchmentEdge', 'underlayerInk', 'parchmentEdge').pop()
  b.push().translate(0, t + innerH, 0).box(hw * 2, t, d, 'underlayer', 'parchmentEdge', 'underlayer', 'parchmentEdge').pop()
  for (const sx of [-1, 1]) {
    b.push().translate(sx * (hw - t / 2), t, 0).box(t, innerH, d, 'underlayer', 'parchmentEdge', 'underlayer', 'parchmentEdge').pop()
  }
  b.push().translate(0, t, -d / 2 + t / 2).box(hw * 2 - t * 2, innerH, t, 'underlayerInk', 'parchmentEdge', 'underlayerInk', 'underlayer').pop()
  // A little dog-eared label strip on the bottom board's front edge.
  b.push().translate(0, 0.02, d / 2 + 0.005).box(hw * 1.1, t * 0.7, 0.02, 'parchmentLight').pop()
  return b.build()
}

/** Figurine colours per book: body, wings, plinth (book 3 gets its own when it arrives). */
const FIGURE: Readonly<Record<number, [PaletteKey, PaletteKey, PaletteKey]>> = {
  1: ['dragonRed', 'dragonRedDark', 'bookCover'],
  2: ['dragonBlue', 'dragonBlueDark', 'heroBlue'],
  3: ['dragonGreen', 'dragonGreenDark', 'forest']
}

/** The secrets counter card on the top board (shelf units). */
const SECRETS_W = 1.0
const SECRETS_H = 0.72

interface Figure {
  holder: Group
  mesh: Mesh
  mat: PaperMaterial
  /** Eased 0…1 "pulled out" (it hops up and turns to face the player). */
  pull: number
  nope: number
}

interface Book {
  holder: Group
  mesh: Mesh
  mat: PaperMaterial
  tex: CanvasTexture
  ctx: CanvasRenderingContext2D
  /** Eased 0…1 pulled out. */
  pull: number
  /** Shake left when a locked book is tapped (1 → 0). */
  nope: number
}

export class ShelfView {
  readonly group = new Group()
  /** Leans back so the spines face the steep desk camera. */
  private readonly rack = new Group()
  /** Room on the top board for later desk objects (roadmap #15, #16). */
  readonly extras = new Group()
  private readonly books: Book[] = []
  /** Dragon Rush figurines, one per book of the game (slot `rushSlotOf(book)`). */
  private readonly figures: Figure[] = []
  private readonly secretsCard: Mesh
  private readonly secretsMat: PaperMaterial
  private readonly secretsTex: CanvasTexture
  private readonly secretsCtx: CanvasRenderingContext2D
  /** Found count the counter card was painted with (−1 = never). */
  private secretsShown = -1
  private readonly body: Mesh
  private readonly bodyMat: PaperMaterial
  private readonly card: Mesh
  private readonly cardMat: PaperMaterial
  private readonly cardTex: CanvasTexture
  private readonly cardCtx: CanvasRenderingContext2D
  private cardK = 0
  private cardSlot = -1
  private rev = -1
  private time = 0
  private readonly pt: ShelfPoint = { x: 0, y: 0, z: 0 }
  private readonly cardPose: ShelfCardPose = { x: 0, y: 0, z: 0, tilt: 0, scale: 1 }

  constructor() {
    this.group.position.set(SHELF.x, SHELF.y, SHELF.z)
    this.group.rotation.y = SHELF.yaw
    this.rack.rotation.x = SHELF.lean
    this.group.add(this.rack)

    this.bodyMat = createPaperMaterial({ vertexColors: true, grain: 0.09 })
    this.body = new Mesh(shelfGeometry(), this.bodyMat)
    this.body.castShadow = true
    this.body.receiveShadow = true
    this.rack.add(this.body)
    this.extras.position.set(0, SHELF.board * 2 + SHELF.bookH + 0.28, 0)
    this.rack.add(this.extras)

    const geo = bookGeometry()
    geo.userData.shared = true
    for (let i = 0; i < SHELF.slots; i++) {
      const [c, ctx] = spineCanvas()
      const tex = toTexture(c)
      const mat = createPaperMaterial({ map: tex, grain: 0.05 })
      const mesh = new Mesh(geo, mat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      const holder = new Group()
      holder.position.set(slotX(i), SHELF.board, 0)
      holder.add(mesh)
      this.rack.add(holder)
      this.books.push({ holder, mesh, mat, tex, ctx, pull: 0, nope: 0 })
    }

    for (let book = 1; book <= BOOK_COUNT; book++) {
      const [body, dark, plinth] = FIGURE[book] ?? FIGURE[3]!
      const mat = createPaperMaterial({ vertexColors: true, grain: 0.05, doubleSided: true })
      const mesh = new Mesh(rushDragonGeometry(body, dark, plinth), mat)
      mesh.castShadow = true
      const holder = new Group()
      holder.position.set(slotX(rushSlotOf(book)), 0, 0.1)
      holder.rotation.y = 0.35
      holder.visible = false
      holder.add(mesh)
      this.extras.add(holder)
      this.figures.push({ holder, mesh, mat, pull: 0, nope: 0 })
    }
    // The secrets counter: a little standing card, leaning back on its fold.
    const [sc, sctx] = secretsCanvas()
    this.secretsCtx = sctx
    this.secretsTex = toTexture(sc)
    this.secretsMat = createPaperMaterial({ map: this.secretsTex, grain: 0.04, doubleSided: true })
    const sg = new PlaneGeometry(SECRETS_W, SECRETS_H)
    sg.translate(0, SECRETS_H / 2, 0)
    this.secretsCard = new Mesh(sg, this.secretsMat)
    this.secretsCard.position.set(SHELF.secretsX, 0, 0.35)
    this.secretsCard.rotation.set(-0.3, 0.25, 0)
    this.secretsCard.castShadow = true
    this.extras.add(this.secretsCard)

    const [cc, cctx] = cardCanvas()
    this.cardCtx = cctx
    this.cardTex = toTexture(cc)
    this.cardMat = createPaperMaterial({ map: this.cardTex, grain: 0.04, doubleSided: true })
    const cg = new PlaneGeometry(SHELF_CARD_W, SHELF_CARD_H)
    cg.translate(0, SHELF_CARD_H / 2, 0)
    this.card = new Mesh(cg, this.cardMat)
    this.card.castShadow = true
    this.card.visible = false
    this.rack.add(this.card)

    this.group.visible = false
    this.group.userData.perfTag = 'fold.shelf'
  }

  /** Repaint spines (and the card) for the shelf's current state. Events only. */
  private sync(s: ShelfState): void {
    this.rev = s.rev
    for (let i = 0; i < this.books.length; i++) {
      const slot = s.slots[i]
      if (!slot) continue
      paintSpine(this.books[i]!.ctx, slot)
      this.books[i]!.tex.needsUpdate = true
    }
    this.cardSlot = -1
  }

  onEvent(e: FoldEvent): void {
    if (e.type === 'shelfSelect' && e.b === 0) {
      const b = isRushSlot(e.a) ? this.figures[e.a - SHELF.slots] : this.books[e.a]
      if (b) b.nope = 1
    }
  }

  /**
   * Per frame (no allocation). `camK` is the camera's blend toward the shelf
   * pose: the shelf is drawn only while the camera can see it.
   */
  update(g: FoldGame, dt: number, camK: number): void {
    const s = g.shelf
    const show = s.available && (s.inView || s.open || camK > 0.001)
    if (this.group.visible !== show) this.group.visible = show
    if (!show) return
    this.time += dt
    if (s.rev !== this.rev) this.sync(s)
    const ease = 1 - Math.exp(-dt * 11)
    // The glow says "tap me": out at the shelf, or on a won book's victory page where it stands in view.
    const glow = s.open || (s.inView && g.phase === 'victory')
    for (let i = 0; i < this.books.length; i++) {
      const b = this.books[i]!
      const want = s.open && s.selected === i ? 1 : 0
      b.pull += (want - b.pull) * ease
      if (Math.abs(want - b.pull) < 1e-4) b.pull = want
      b.nope = Math.max(0, b.nope - dt * 2.4)
      const h = b.holder
      h.position.z = b.pull * SHELF.pull
      h.position.y = SHELF.board + b.pull * 0.06
      // Pulled out, it tips toward the player; a locked one shakes its head.
      h.rotation.x = b.pull * 0.2
      h.rotation.z = Math.sin(this.time * 38) * b.nope * 0.09
      const hl = glow && i === s.highlight ? 1 : 0
      if (b.mat.uniforms.uHighlight.value !== hl) b.mat.uniforms.uHighlight.value = hl
    }
    // The rush figurines: standing once their book is won; picked, one hops up and turns to the player.
    for (let k = 0; k < this.figures.length; k++) {
      const f = this.figures[k]!
      const slot = s.slots[SHELF.slots + k]
      const on = !!slot && slot.state !== 'hidden'
      if (f.holder.visible !== on) f.holder.visible = on
      if (!on) continue
      const want = s.open && s.selected === SHELF.slots + k ? 1 : 0
      f.pull += (want - f.pull) * ease
      if (Math.abs(want - f.pull) < 1e-4) f.pull = want
      f.nope = Math.max(0, f.nope - dt * 2.4)
      const h = f.holder
      h.position.y = f.pull * 0.35 + Math.abs(Math.sin(this.time * 9)) * 0.06 * f.pull
      h.rotation.y = 0.35 - f.pull * 0.35
      h.rotation.z = Math.sin(this.time * 38) * f.nope * 0.12
    }
    // The secrets counter repaints when the count changes (a discovery, a save arriving).
    let found = 0
    const have = g.secrets.found
    for (let i = 0; i < SECRET_IDS.length; i++) if (have[SECRET_IDS[i]!]) found++
    if (found !== this.secretsShown) {
      this.secretsShown = found
      paintSecretsCard(this.secretsCtx, found, SECRET_TOTAL)
      this.secretsTex.needsUpdate = true
    }
    // The star card rises out of the pulled-out book (a rush figurine's card shows its par and best).
    const sel = s.open ? s.selected : -1
    if (sel >= 0 && sel !== this.cardSlot && s.slots[sel]) {
      this.cardSlot = sel
      const slot = s.slots[sel]!
      if (slot.kind === 'rush') paintRushCard(this.cardCtx, slot)
      else paintStarCard(this.cardCtx, slot)
      this.cardTex.needsUpdate = true
    }
    const wantCard = sel >= 0 ? 1 : 0
    this.cardK += (wantCard - this.cardK) * ease
    if (Math.abs(wantCard - this.cardK) < 1e-3) this.cardK = wantCard
    const on = this.cardK > 0.01 && this.cardSlot >= 0
    if (this.card.visible !== on) this.card.visible = on
    if (on) {
      // Portrait phones frame the shelf alone (no room beside the book): the card grows and faces the camera.
      const c = shelfCardPose(this.cardSlot, this.pullOf(this.cardSlot), this.cardK, !s.inView, this.cardPose)
      this.card.position.set(c.x, c.y, c.z)
      this.card.rotation.x = c.tilt
      this.card.scale.setScalar(c.scale)
    }
  }

  /** Eased pull of a slot (for picking). A rush figurine's card always stands in front of the shelf. */
  pullOf(i: number): number {
    return isRushSlot(i) ? 1 : this.books[i]?.pull ?? 0
  }

  /** Eased hop of a slot as drawn (the spine anchor; a figurine hops up instead of sliding out). */
  private drawnPull(i: number): number {
    return isRushSlot(i) ? this.figures[i - SHELF.slots]?.pull ?? 0 : this.books[i]?.pull ?? 0
  }

  /** Page-space point on a slot's spine (`up` 0 bottom … 1 top), as currently drawn. */
  anchorOf(i: number, up: number): ShelfPoint {
    return slotAnchor(i, this.pt, this.drawnPull(i), up)
  }

  /** Slots drawn: the books, then the rush figurines. */
  get slots(): number {
    return this.books.length + this.figures.length
  }

  dispose(): void {
    this.body.geometry.dispose()
    this.bodyMat.dispose()
    this.books[0]?.mesh.geometry.dispose()
    for (const b of this.books) {
      b.mat.dispose()
      b.tex.dispose()
    }
    this.card.geometry.dispose()
    this.cardMat.dispose()
    this.cardTex.dispose()
    for (const f of this.figures) f.mat.dispose()
    this.secretsCard.geometry.dispose()
    this.secretsMat.dispose()
    this.secretsTex.dispose()
  }
}
