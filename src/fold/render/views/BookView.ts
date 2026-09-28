/**
 * The desk and the open book the game is played in.
 *
 * - A warm wooden desk (painted plank texture) under the lamp.
 * - A leather-bound book: the right-hand page is the play page (y = 0); under
 *   it the thick stack of layered pages whose edges show on every side —
 *   aethel-fold-GDD §7's "thick, folded paper layers at the edges of the
 *   screen, teasing … massive hidden depth".
 * - The left-hand page shows the last page you turned (a snapshot), so the
 *   book fills up as you play. Landscape and desktop see it; portrait doesn't.
 * - A few origami desk props (crane, boat, pencil) for the wide aspects.
 */

import { Group, Mesh, PlaneGeometry, RepeatWrapping, type Texture } from 'three'
import { PAGE_HALF_D, PAGE_HALF_W } from '../../logic/config'
import { HEX, css } from '../palette'
import { makeCanvas, paperGrain, seeded, toTexture, edgeBurn, stains } from '../art/canvas'
import { PaperBuilder } from '../paperGeometry'
import { createPaperMaterial, type PaperMaterial } from '../paperMaterial'
import { boatGeometry, craneGeometry, pencilGeometry } from '../models'

export const DESK_Y = -0.62
const COVER_TOP = -0.44
const SPINE_X = -PAGE_HALF_W - 0.28

const paintDesk = (): Texture => {
  const [c, ctx] = makeCanvas(1024, 1024)
  const rng = seeded(4242)
  const planks = 7
  const ph = 1024 / planks
  for (let i = 0; i < planks; i++) {
    const base = i % 3 === 0 ? HEX.desk : i % 3 === 1 ? HEX.deskLight : HEX.desk
    ctx.fillStyle = base
    ctx.fillRect(0, i * ph, 1024, ph)
    // Grain.
    for (let k = 0; k < 26; k++) {
      ctx.strokeStyle = css('deskGrain', 0.18 + rng.next() * 0.25)
      ctx.lineWidth = 1 + rng.next() * 2.5
      ctx.beginPath()
      const y0 = i * ph + rng.next() * ph
      ctx.moveTo(0, y0)
      for (let x = 0; x <= 1024; x += 64) ctx.lineTo(x, y0 + Math.sin(x * 0.01 + k) * 6 * rng.next())
      ctx.stroke()
    }
    // Knot.
    if (rng.next() < 0.6) {
      const kx = rng.next() * 1024
      const ky = i * ph + ph * (0.3 + rng.next() * 0.4)
      for (let r = 4; r < 22; r += 5) {
        ctx.strokeStyle = css('deskDark', 0.35)
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.ellipse(kx, ky, r * 2.2, r * 0.8, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    // Plank seam.
    ctx.fillStyle = css('deskDark', 0.85)
    ctx.fillRect(0, i * ph, 1024, 3)
  }
  const t = toTexture(c)
  t.wrapS = t.wrapT = RepeatWrapping
  t.repeat.set(3, 3)
  return t
}

const paintTitlePage = (): Texture => {
  const w = 512
  const h = Math.round((512 * PAGE_HALF_D) / PAGE_HALF_W)
  const [c, ctx] = makeCanvas(w, h)
  const rng = seeded(77)
  ctx.fillStyle = HEX.parchment
  ctx.fillRect(0, 0, w, h)
  paperGrain(ctx, w, h, rng, 0.4)
  stains(ctx, w, h, rng, 3)
  // Frame + a big printed crane.
  ctx.strokeStyle = css('inkSoft', 0.6)
  ctx.lineWidth = 3
  ctx.strokeRect(22, 22, w - 44, h - 44)
  ctx.save()
  ctx.translate(w / 2, h * 0.42)
  ctx.scale(2.3, 2.3)
  ctx.fillStyle = HEX.c3
  ctx.strokeStyle = HEX.ink
  ctx.lineWidth = 2.4
  ctx.lineJoin = 'round'
  const tri = (pts: number[], fill: string): void => {
    ctx.beginPath()
    ctx.moveTo(pts[0]!, pts[1]!)
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    ctx.stroke()
  }
  tri([-60, -40, 0, 0, -10, 12], HEX.c3)
  tri([60, -44, 0, 0, 10, 12], HEX.guide)
  tri([-10, 12, 0, 0, 10, 12, 0, 24], HEX.c3)
  tri([10, 12, 44, -30, 40, -34, 8, 6], HEX.guide)
  tri([-10, 12, -38, -8, -34, -12, -6, 6], HEX.c3)
  ctx.restore()
  // Printed rule lines where a title would go (text-free: the HUD carries words).
  ctx.strokeStyle = css('inkSoft', 0.35)
  ctx.lineWidth = 2
  for (let i = 0; i < 6; i++) {
    const y = h * 0.66 + i * 22
    ctx.beginPath()
    ctx.moveTo(70, y)
    ctx.lineTo(w - 70 - (i % 2) * 60, y)
    ctx.stroke()
  }
  edgeBurn(ctx, w, h)
  return toTexture(c)
}

export class BookView {
  readonly group = new Group()
  private readonly leftPageMat: PaperMaterial
  private readonly titleTex: Texture
  private readonly deskTex: Texture
  private readonly materials: PaperMaterial[] = []

  constructor() {
    // Desk.
    this.deskTex = paintDesk()
    const deskMat = createPaperMaterial({ map: this.deskTex, grain: 0.03 })
    this.materials.push(deskMat)
    const desk = new Mesh(new PlaneGeometry(90, 70), deskMat)
    desk.rotation.x = -Math.PI / 2
    desk.position.set(-6, DESK_Y, -4)
    desk.receiveShadow = true
    this.group.add(desk)

    // Cover boards (leather + gold tooling edge).
    const b = new PaperBuilder()
    const coverW = PAGE_HALF_W * 4 + 1.6
    const coverX0 = SPINE_X - PAGE_HALF_W * 2 - 0.9
    b.push().translate(coverX0 + coverW / 2, DESK_Y, 0).box(coverW, COVER_TOP - DESK_Y, PAGE_HALF_D * 2 + 1.1, 'bookCover', 'bookCover', 'bookCoverDark', 'bookCoverDark').pop()
    b.push().translate(coverX0 + coverW / 2, COVER_TOP - 0.004, PAGE_HALF_D + 0.54).box(coverW - 0.3, 0.02, 0.04, 'bookGold').pop()
    // Spine gutter.
    b.push().translate(SPINE_X, COVER_TOP - 0.02, 0).box(0.5, 0.06, PAGE_HALF_D * 2 + 0.6, 'bookCoverDark').pop()

    // Right-hand stack: the layers under the play page, each a little
    // irregular so the edges read as many sheets, not one block.
    const rng = seeded(911)
    const layers = 8
    const top = -0.012
    const h = (top - COVER_TOP) / layers
    for (let i = 0; i < layers; i++) {
      const y = COVER_TOP + i * h
      const ox = (rng.next() - 0.5) * 0.08
      const oz = (rng.next() - 0.5) * 0.1
      const w = PAGE_HALF_W * 2 + 0.06 + (rng.next() - 0.5) * 0.06
      const d = PAGE_HALF_D * 2 + 0.08 + (rng.next() - 0.5) * 0.08
      const tint = i % 3 === 0 ? 'parchmentShade' : i % 3 === 1 ? 'parchment' : 'parchmentEdge'
      b.push().translate(ox + 0.02, y, oz).box(w, h * 0.92, d, tint, 'parchment', tint, tint).pop()
    }
    // Left-hand stack (pages already turned).
    for (let i = 0; i < 5; i++) {
      const y = COVER_TOP + i * h * 1.4
      const ox = (rng.next() - 0.5) * 0.08
      const w = PAGE_HALF_W * 2 + (rng.next() - 0.5) * 0.06
      b.push().translate(SPINE_X - 0.3 - w / 2 + ox, y, (rng.next() - 0.5) * 0.1).box(w, h * 1.3, PAGE_HALF_D * 2 + 0.06, i % 2 ? 'parchmentShade' : 'parchmentEdge', 'parchment').pop()
    }
    // Ribbon bookmark draped over the bottom edge.
    b.push().translate(SPINE_X + 0.1, -0.005, PAGE_HALF_D - 0.4).box(0.28, 0.01, 1.4, 'bookCover').pop()
    b.push().translate(SPINE_X + 0.1, COVER_TOP, PAGE_HALF_D + 0.35).rotate(-0.25, 0, 0).box(0.28, 0.45, 0.02, 'bookCover').pop()
    const bookMat = createPaperMaterial({ vertexColors: true, grain: 0.05 })
    this.materials.push(bookMat)
    const book = new Mesh(b.build(), bookMat)
    book.castShadow = true
    book.receiveShadow = true
    this.group.add(book)

    // Left page surface.
    this.titleTex = paintTitlePage()
    this.leftPageMat = createPaperMaterial({ map: this.titleTex, grain: 0.04 })
    this.materials.push(this.leftPageMat)
    const left = new Mesh(new PlaneGeometry(PAGE_HALF_W * 2, PAGE_HALF_D * 2), this.leftPageMat)
    left.rotation.x = -Math.PI / 2
    left.position.set(SPINE_X - 0.3 - PAGE_HALF_W, COVER_TOP + h * 7.2, 0)
    left.receiveShadow = true
    this.group.add(left)

    // Desk props, well outside the page so they never cover play.
    const propMat = createPaperMaterial({ vertexColors: true, grain: 0.05, doubleSided: true, backTint: '#d8d0c0' })
    this.materials.push(propMat)
    const crane = new Mesh(craneGeometry('c3'), propMat)
    crane.position.set(9.4, DESK_Y, -3.2)
    crane.rotation.y = -0.7
    crane.scale.setScalar(1.25)
    crane.castShadow = true
    this.group.add(crane)
    const crane2 = new Mesh(craneGeometry('c1'), propMat)
    crane2.position.set(-22, DESK_Y, 4.5)
    crane2.rotation.y = 0.9
    crane2.castShadow = true
    this.group.add(crane2)
    const boat = new Mesh(boatGeometry(), propMat)
    boat.position.set(8.9, DESK_Y, 4.6)
    boat.rotation.y = 0.4
    boat.scale.setScalar(1.2)
    boat.castShadow = true
    this.group.add(boat)
    const pencil = new Mesh(pencilGeometry(), propMat)
    pencil.position.set(9.2, DESK_Y + 0.09, 0.8)
    pencil.rotation.y = 1.1
    pencil.castShadow = true
    this.group.add(pencil)
    // Below the book (the portrait view's lower desk).
    const crane3 = new Mesh(craneGeometry('c2'), propMat)
    crane3.position.set(3.4, DESK_Y, PAGE_HALF_D + 2.6)
    crane3.rotation.y = 2.4
    crane3.scale.setScalar(1.1)
    crane3.castShadow = true
    this.group.add(crane3)
    const boat2 = new Mesh(boatGeometry(), propMat)
    boat2.position.set(-3.6, DESK_Y, PAGE_HALF_D + 3.1)
    boat2.rotation.y = -0.5
    boat2.castShadow = true
    this.group.add(boat2)
    const pencil2 = new Mesh(pencilGeometry(), propMat)
    pencil2.position.set(1.6, DESK_Y + 0.09, PAGE_HALF_D + 1.5)
    pencil2.rotation.y = 0.12
    pencil2.castShadow = true
    this.group.add(pencil2)
    this.group.userData.perfTag = 'fold.book'
  }

  /** Put the last turned page on the left-hand side. */
  setLeftPage(tex: Texture | null, srgbData = false): void {
    const m = this.leftPageMat
    m.uniforms.map!.value = tex ?? this.titleTex
    if (srgbData && tex) m.defines.MAP_SRGB_DATA = ''
    else delete m.defines.MAP_SRGB_DATA
    m.needsUpdate = true
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh && !o.geometry.userData.shared) o.geometry.dispose()
    })
    for (const m of this.materials) m.dispose()
    this.titleTex.dispose()
    this.deskTex.dispose()
  }
}
