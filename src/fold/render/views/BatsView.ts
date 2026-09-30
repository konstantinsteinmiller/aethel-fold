/**
 * Halloween's bat standees (roadmap #17): six little paper bats flapping in
 * lazy loops over the desk beside the book's long edges — off the lanes, above
 * anything that marches. One instanced draw on the standee atlas (no shadow
 * pass: they fly high and small), shown only while the season is Halloween
 * and the atlas has painted their two frames (idle time, never at boot).
 *
 * Art only: nothing in the game knows about them. Zero allocation per frame.
 */

import { Group } from 'three'
import { PAGE_HALF_W } from '../../logic/config'
import type { StandeeAtlas } from '../art/standeeArt'
import { StandeeField } from './StandeeField'

const COUNT = 6

/** Loop centre (x, y, z), radius and phase of each bat: three down each side of the page. */
const LOOPS: readonly (readonly [number, number, number, number, number])[] = [
  [-(PAGE_HALF_W + 0.55), 2.3, -4.6, 0.7, 0],
  [-(PAGE_HALF_W + 0.35), 2.7, -1.2, 0.55, 2.1],
  [-(PAGE_HALF_W + 0.6), 2.1, 2.2, 0.65, 4.0],
  [PAGE_HALF_W + 0.5, 2.5, -4.0, 0.6, 1.1],
  [PAGE_HALF_W + 0.4, 2.2, -0.4, 0.7, 3.3],
  [PAGE_HALF_W + 0.6, 2.8, 2.8, 0.5, 5.2]
]

export class BatsView {
  readonly group = new Group()
  private readonly field: StandeeField
  private on = false

  constructor(private readonly atlas: StandeeAtlas) {
    this.field = new StandeeField(atlas, COUNT)
    this.field.mesh.castShadow = false
    this.group.add(this.field.mesh)
    this.group.visible = false
    this.group.userData.perfTag = 'fold.bats'
  }

  /** Is the Halloween flock wanted (the season), and can it be drawn yet (its frames painted)? */
  show(want: boolean): void {
    const on = want && this.atlas.batsReady
    if (on === this.on) return
    this.on = on
    this.group.visible = on
  }

  update(time: number): void {
    if (!this.on) return
    const f = this.field
    for (let i = 0; i < COUNT; i++) {
      // Indexed, not destructured: array destructuring walks an iterator.
      const L = LOOPS[i]!
      const cx = L[0]
      const cy = L[1]
      const cz = L[2]
      const r = L[3]
      const ph = L[4]
      const w = 0.7 + i * 0.07
      const a = time * w + ph
      const x = cx + Math.cos(a) * r
      const z = cz + Math.sin(a) * r * 0.8
      const y = cy + Math.sin(time * 2.6 + ph) * 0.18
      f.setFrame(i, Math.floor(time * 7 + ph * 3) % 2 === 0 ? 'bat0' : 'bat1')
      // Face along the loop, rocking with the wingbeat.
      f.place(i, x, y, z, Math.cos(a) * 0.5, Math.sin(time * 7 + ph) * 0.15, 0, 0.5)
    }
    f.commit()
  }

  dispose(): void {
    this.field.dispose()
  }
}
