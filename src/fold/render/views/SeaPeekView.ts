/**
 * The intro's "sea peek" beat (roadmap #12): for three seconds a sea monster
 * surfaces behind the page's top edge, looks around, does nothing, and sinks
 * away again — a teaser for Book 3's kraken.
 *
 * ── The hook ─────────────────────────────────────────────────────────────
 * The beat talks to a `SeaPeekActor`, never to a concrete model:
 *
 *   interface SeaPeekActor {
 *     readonly group: Object3D                      // the intro adds it to its scene
 *     update(pose: SeaPeekPose, time, dt): void     // pose it (world space, page units)
 *     dispose(): void
 *   }
 *
 * `createSeaPeek` builds whatever `setSeaPeekFactory` registered, or the
 * placeholder below. The real kraken is registered in `IntroView`'s imports:
 *
 *   setSeaPeekFactory((ctx) => new KrakenPeek(ctx.sprites, ctx.overlay))
 *
 * (`KrakenPeek.ts`), where `KrakenPeek.update` maps the pose onto the kraken rig: `pose.sea`
 * (0…1, the paper sea popping up and folding away), `pose.rise` (0…1, how far
 * it has surfaced), `pose.x`/`pose.z` (where, behind the top edge),
 * `pose.sway` and `pose.time` (idle motion). The pose comes from
 * `seaPeekPose` in `logic/intro.ts`, so the timing stays in pure logic and the
 * actor only draws. The actor is built lazily, only when the intro plays.
 *
 * ── The placeholder ──────────────────────────────────────────────────────
 * Kept as the fallback (`setSeaPeekFactory(null)`).
 * Three rows of scalloped paper waves (the sea, a pop-up strip standing on
 * the desk) and, between them, a folded-paper monster: a faceted mantle dome
 * with two eyes and four tentacles that curl and uncurl. Palette sea tones
 * (`water*`, `dragonBlue*`), ids from `nextPaperId`, 10 small meshes and two
 * materials (one program: the paper material with vertex colours).
 */

import { Group, Mesh, type BufferGeometry, type Object3D, type Scene } from 'three'
import type { SeaPeekPose } from '../../logic/intro'
import { PaperBuilder, shade, type Col } from '../paperGeometry'
import { createPaperMaterial, type PaperMaterial } from '../paperMaterial'
import type { SpriteTextures } from '../art/spriteArt'
import { DESK_Y } from './BookView'

export interface SeaPeekActor {
  /** Added to the intro's scene by the host; posed in world space by `update`. */
  readonly group: Object3D
  /** Pose it for this frame (allocation-free). */
  update(pose: Readonly<SeaPeekPose>, time: number, dt: number): void
  dispose(): void
}

/** What a sea-peek actor may borrow from the host view. */
export interface SeaPeekContext {
  sprites: SpriteTextures
  /** The additive overlay scene (glows). */
  overlay: Scene
}

export type SeaPeekFactory = (ctx: SeaPeekContext) => SeaPeekActor

let factory: SeaPeekFactory | null = null

/** Register the actor the intro's sea peek shows (Book 3's kraken), or null for the placeholder. */
export const setSeaPeekFactory = (f: SeaPeekFactory | null): void => {
  factory = f
}

/** The registered actor, or the placeholder. */
export const createSeaPeek = (ctx: SeaPeekContext): SeaPeekActor => (factory ? factory(ctx) : new SeaPeekPlaceholder())

// ─── Placeholder geometry ──────────────────────────────────────────────────

/** Rows of the paper sea: z offset from the spot, height, colour. The monster rises between rows 1 and 2 (shared with `KrakenPeek`). */
const SEA_ROWS: readonly { z: number; h: number; c: Col }[] = [
  { z: 0.55, h: 0.75, c: 'waterLight' },
  { z: 0, h: 1.05, c: 'water' },
  { z: -1.3, h: 1.35, c: 'waterDark' }
]
const SEA_HALF = 3.6
/** Where the monster stands inside the sea (z offset from the spot). */
export const MONSTER_Z = -0.65

/** The paper sea: three rows of scalloped waves standing on the desk (the placeholder's and the kraken peek's). */
export const seaGeometry = (): BufferGeometry => {
  const b = new PaperBuilder()
  const n = 18
  SEA_ROWS.forEach((row, r) => {
    for (let i = 0; i < n; i++) {
      const x0 = -SEA_HALF + (i / n) * SEA_HALF * 2
      const x1 = -SEA_HALF + ((i + 1) / n) * SEA_HALF * 2
      // Scalloped crests: every other vertex a wave top.
      const h0 = row.h * (i % 2 === 0 ? 0.72 : 1) + (r === 1 ? 0.06 : 0)
      const h1 = row.h * (i % 2 === 0 ? 1 : 0.72)
      const c = i % 2 ? shade(row.c, 0.94) : row.c
      b.quad([x0, 0, row.z], [x1, 0, row.z], [x1, h1, row.z], [x0, h0, row.z], c)
    }
  })
  return b.build()
}

/** The mantle: a faceted dome with a folded brow and two eyes, facing +z. */
const mantleGeometry = (): BufferGeometry => {
  const b = new PaperBuilder()
  const sides = 8
  const r = 1.05
  const h = 2.3
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2
    const a1 = ((i + 1) / sides) * Math.PI * 2
    const c: Col = i % 2 ? 'dragonBlueDark' : 'dragonBlue'
    // Lower ring (a short skirt), then the pointed dome.
    const x0 = Math.sin(a0) * r
    const z0 = Math.cos(a0) * r
    const x1 = Math.sin(a1) * r
    const z1 = Math.cos(a1) * r
    b.quad([x0, 0, z0], [x1, 0, z1], [x1 * 0.92, 0.9, z1 * 0.92], [x0 * 0.92, 0.9, z0 * 0.92], shade(c, 0.9))
    b.tri(x0 * 0.92, 0.9, z0 * 0.92, x1 * 0.92, 0.9, z1 * 0.92, 0, h, -0.25, c)
  }
  // Eyes: gold diamonds with ink slits, on the front of the skirt.
  for (const s of [-1, 1]) {
    b.push().translate(s * 0.42, 0.55, 0.98).rotate(0, s * 0.35, 0)
    b.tri(-0.22, 0, 0.02, 0.22, 0, 0.02, 0, 0.26, 0.02, 'highlight')
    b.tri(0.22, 0, 0.02, -0.22, 0, 0.02, 0, -0.2, 0.02, 'gold')
    b.tri(-0.04, -0.14, 0.05, 0.04, -0.14, 0.05, 0, 0.2, 0.05, 'ink')
    b.pop()
  }
  // A folded brow over the eyes.
  b.tri(-0.8, 0.86, 0.75, 0.8, 0.86, 0.75, 0, 1.05, 0.95, 'dragonBlueDark')
  return b.build()
}

/** One tentacle part along +y (diamond cross-section, tapering), suckers on the inner face. */
const tentacleGeometry = (r0: number, r1: number, len: number): BufferGeometry => {
  const b = new PaperBuilder()
  const ring = (r: number, y: number): [number, number, number][] => [[0, y, r], [r, y, 0], [0, y, -r], [-r, y, 0]]
  const lo = ring(r0, 0)
  const hi = ring(r1, len)
  const cols: Col[] = ['waterLight', 'dragonBlue', 'dragonBlueDark', 'dragonBlue']
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    b.quad(lo[i]!, lo[j]!, hi[j]!, hi[i]!, cols[i]!)
  }
  b.tri(hi[0]![0], len, hi[0]![2], hi[1]![0], len, hi[1]![2], hi[2]![0], len, hi[2]![2], 'dragonBlueDark')
  b.tri(hi[0]![0], len, hi[0]![2], hi[2]![0], len, hi[2]![2], hi[3]![0], len, hi[3]![2], 'dragonBlueDark')
  return b.build()
}

interface Tentacle {
  base: Group
  tip: Group
  side: number
  phase: number
}

/** The stand-in sea monster until Book 3's kraken is registered (see the file header). */
export class SeaPeekPlaceholder implements SeaPeekActor {
  readonly group = new Group()
  private readonly sea: Mesh
  private readonly monster = new Group()
  private readonly mantle: Mesh
  private readonly tentacles: Tentacle[] = []
  private readonly seaMat: PaperMaterial
  private readonly bodyMat: PaperMaterial
  private readonly geos: BufferGeometry[] = []

  constructor() {
    this.seaMat = createPaperMaterial({ vertexColors: true, grain: 0.05, doubleSided: true })
    this.bodyMat = createPaperMaterial({ vertexColors: true, grain: 0.05, doubleSided: true })
    const seaGeo = seaGeometry()
    this.geos.push(seaGeo)
    this.sea = new Mesh(seaGeo, this.seaMat)
    this.sea.receiveShadow = true
    this.group.add(this.sea)

    const mantleGeo = mantleGeometry()
    this.geos.push(mantleGeo)
    this.mantle = new Mesh(mantleGeo, this.bodyMat)
    this.mantle.castShadow = true
    this.monster.add(this.mantle)
    const baseGeo = tentacleGeometry(0.2, 0.13, 1.25)
    const tipGeo = tentacleGeometry(0.13, 0.03, 1.05)
    this.geos.push(baseGeo, tipGeo)
    // Two tentacles each side, the outer pair further out and further back.
    const spots: [number, number, number][] = [[-1.05, 0.25, 0.3], [1.05, 0.25, 0.3], [-1.55, 0.1, -0.35], [1.55, 0.1, -0.35]]
    spots.forEach(([x, y, z], i) => {
      const side = x < 0 ? -1 : 1
      const base = new Group()
      base.position.set(x, y, z)
      const bm = new Mesh(baseGeo, this.bodyMat)
      base.add(bm)
      const tip = new Group()
      tip.position.y = 1.2
      tip.add(new Mesh(tipGeo, this.bodyMat))
      base.add(tip)
      this.monster.add(base)
      this.tentacles.push({ base, tip, side, phase: i * 1.3 })
    })
    this.monster.position.z = MONSTER_Z
    this.group.add(this.monster)
    // Far behind the page: a size up, so it reads at a glance.
    this.group.scale.setScalar(1.3)
    this.group.visible = false
    this.group.userData.perfTag = 'fold.intro.seaPeek'
  }

  update(pose: Readonly<SeaPeekPose>, time: number, _dt: number): void {
    const on = pose.on && (pose.sea > 0.002 || pose.rise > 0.002)
    this.group.visible = on
    if (!on) return
    this.group.position.set(pose.x, DESK_Y, pose.z)
    // The paper sea stands up like a pop-up strip.
    this.sea.scale.set(1, Math.max(0.001, pose.sea), 1)
    // The monster surfaces from under the waves, sways, looks around.
    const r = pose.rise
    this.monster.visible = r > 0.002
    this.monster.position.y = -2.6 + r * 2.75
    this.monster.rotation.set(0.05 - r * 0.1, Math.sin(pose.time * 1.3) * 0.35, pose.sway)
    for (const t of this.tentacles) {
      const w = Math.sin(time * 2.4 + t.phase)
      // Rising: the tentacles unfurl out of the water; sinking: they curl back in.
      t.base.rotation.set(-0.25 + w * 0.12, 0, -t.side * (0.35 + r * 0.45 + w * 0.08))
      t.tip.rotation.set(0.35 + w * 0.3, 0, -t.side * (1.1 - r * 0.6 + w * 0.25))
    }
  }

  dispose(): void {
    for (const g of this.geos) g.dispose()
    this.seaMat.dispose()
    this.bodyMat.dispose()
  }
}
