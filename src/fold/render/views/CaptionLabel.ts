/**
 * The page's storybook line: a printed paper label pasted flat into the page
 * margin (top edge, or bottom edge where a set piece fills the top). It is
 * part of the page, so it turns, crumples and peels with it — no DOM overlay.
 */

import { Mesh, PlaneGeometry, type CanvasTexture } from 'three'
import { PAGE_HALF_D } from '../../logic/config'
import type { PageDef } from '../../logic/types'
import { CAPTION_TEX_H, CAPTION_TEX_W, paintCaption } from '../art/pageArt'
import { makeCanvas, toTexture } from '../art/canvas'
import { createPaperMaterial, type PaperMaterial } from '../paperMaterial'

const WIDTH = 8.4
const HEIGHT = (WIDTH * CAPTION_TEX_H) / CAPTION_TEX_W

/** Where the label goes on a page, or null when the page has no room for one. */
export const captionZ = (def: PageDef): number | null => {
  // The player's castle always fills the bottom edge. The page-3 battlement
  // fills the top edge, so its label sits just in front of the wall; the
  // enemy castle (and the dragon inside it) leave no room at all.
  if (def.theme === 'gates' || def.theme === 'core' || def.theme === 'deep') return null
  if (def.theme === 'siege') return -5.1
  return -PAGE_HALF_D + 0.5
}

export class CaptionLabel {
  readonly mesh: Mesh
  private readonly ctx: CanvasRenderingContext2D
  private readonly texture: CanvasTexture
  private readonly mat: PaperMaterial
  private text = ''

  constructor(z: number) {
    const [c, ctx] = makeCanvas(CAPTION_TEX_W, CAPTION_TEX_H)
    this.ctx = ctx
    this.texture = toTexture(c)
    this.mat = createPaperMaterial({ map: this.texture, grain: 0.03 })
    const geo = new PlaneGeometry(WIDTH, HEIGHT)
    geo.rotateX(-Math.PI / 2)
    this.mesh = new Mesh(geo, this.mat)
    this.mesh.position.set(0, 0.006, z)
    this.mesh.receiveShadow = true
    this.mesh.visible = false
  }

  /** Paint `text` (no-op when unchanged unless forced, e.g. after the font loads). */
  set(text: string, force = false): void {
    if (text === this.text && !force) return
    this.text = text
    this.mesh.visible = text.length > 0
    if (!text) return
    paintCaption(text, this.ctx)
    this.texture.needsUpdate = true
  }

  get current(): string {
    return this.text
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.mat.dispose()
    this.texture.dispose()
  }
}
