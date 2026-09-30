/**
 * The enemy castle (Pages 4 and 5).
 *
 * Page 4 "The Castle Gates": the flanking towers, the gatehouse and the
 * drawbridge carry a visible crease (GDD §4.2) — each is built in two halves
 * hinged at their outer edges, so spreading the fingers pulls the halves
 * apart along the crease, light spills out of the gap, and at 100 % the two
 * halves slam down flat: torn.
 *
 * Page 5 "Castle Core": the same castle, whole. During the boss intro it
 * rumbles, gears glow through every seam, and then every wall hinges outward
 * and lies flat like an unfolded paper box — the net the dragon rises from.
 */

import { Group, Mesh, Vector3, type Scene } from 'three'
import type { FoldGame } from '../../logic/game'
import type { TearState } from '../../logic/types'
import { clamp01, easeInOutCubic } from '../../logic/math'
import { PaperBuilder, type Col } from '../paperGeometry'
import { createPaperMaterial, type PaperMaterial } from '../paperMaterial'
import type { SpriteTextures } from '../art/spriteArt'
import { GlowSprite } from './Effects'
import { HEX } from '../palette'

const easeOutBounce = (t: number): number => {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) return n1 * t * t
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
  return n1 * (t -= 2.625 / d1) * t + 0.984375
}

type FallDir = 'L' | 'R' | 'F' | 'B'

/** A piece of castle hinged at the edge it falls over. */
class Piece {
  readonly pivot = new Group()
  readonly body = new Group()
  constructor(readonly dir: FallDir, x: number, z: number, hingeOffset: number) {
    this.pivot.position.set(x, 0, z)
    // Move the hinge to the piece's outer base edge.
    if (dir === 'L') {
      this.pivot.position.x -= hingeOffset
      this.body.position.x = hingeOffset
    } else if (dir === 'R') {
      this.pivot.position.x += hingeOffset
      this.body.position.x = -hingeOffset
    } else if (dir === 'F') {
      this.pivot.position.z += hingeOffset
      this.body.position.z = -hingeOffset
    } else {
      this.pivot.position.z -= hingeOffset
      this.body.position.z = hingeOffset
    }
    this.pivot.add(this.body)
  }

  /** 0 = standing, 1 = lying flat outward. */
  fall(a: number): void {
    const r = a * Math.PI / 2
    this.pivot.rotation.set(0, 0, 0)
    if (this.dir === 'L') this.pivot.rotation.z = r
    else if (this.dir === 'R') this.pivot.rotation.z = -r
    else if (this.dir === 'F') this.pivot.rotation.x = r
    else this.pivot.rotation.x = -r
  }
}

interface Tearable {
  id: string
  halves: [Piece, Piece] | [Piece]
  crease: Mesh
  gear: GlowSprite
  /** World point of the visible crease (for picking). */
  anchor: Vector3
  fallT: number
  mat: PaperMaterial
}

const mesh = (b: PaperBuilder, mat: PaperMaterial): Mesh => {
  const m = new Mesh(b.build(), mat)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

export class CastleView {
  readonly group = new Group()
  private readonly mat: PaperMaterial
  private readonly creaseMat: PaperMaterial
  private readonly pieces: Piece[] = []
  private readonly tearables = new Map<string, Tearable>()
  private readonly seamGears: GlowSprite[] = []
  private readonly coreGear: GlowSprite
  private readonly materials: PaperMaterial[] = []
  private readonly glows: GlowSprite[] = []
  private readonly tmp = new Vector3()

  private readonly overlayScene: Scene
  private readonly spriteTex: SpriteTextures

  constructor(private readonly mode: 'gates' | 'core', sprites: SpriteTextures, overlay: Scene) {
    this.overlayScene = overlay
    this.spriteTex = sprites
    this.mat = createPaperMaterial({ vertexColors: true, grain: 0.06 })
    this.creaseMat = createPaperMaterial({ unlit: true, color: HEX.highlight, emissive: HEX.gear, emissiveIntensity: 0.6 })
    this.materials.push(this.mat, this.creaseMat)

    // ─── Static pieces ───
    const roofCol: Col = 'roofBlue'
    // Back curtain wall.
    this.addPiece('B', 0, -6.8, 0.2, (b) => {
      b.box(8.8, 1.7, 0.4, 'stone', 'stoneLight', 'stoneDark')
      b.push().translate(0, 0, 0.12).crenels(8.8, 0.16, 1.7, 0.26, 16, 'stoneLight').pop()
    })
    // Keep with two turrets.
    this.addPiece('B', 0, -6.15, 0.65, (b) => {
      b.box(2.9, 2.9, 1.3, 'stone', 'stoneLight', 'stoneDark')
      for (let y = 0.5; y < 2.8; y += 0.55) b.push().translate(0, y, 0.655).box(2.86, 0.04, 0.02, 'stoneDark').pop()
      b.push().translate(0, 2.9, 0).pyramid(3.2, 1.6, 1.3, 'roofRed').pop()
      b.push().translate(0, 0, 0.66).sheet([-0.45, 0, 0.45, 0, 0.45, 0.9, 0, 1.25, -0.45, 0.9], 'woodDark').pop()
      for (const x of [-0.85, 0.85]) b.push().translate(x, 1.7, 0.66).sheet([-0.13, 0, 0.13, 0, 0.13, 0.4, -0.13, 0.4], 'ink').pop()
      b.push().translate(0, 4.2, 0).flag(0.8, 'enemyRed').pop()
    })
    for (const sx of [-1, 1]) {
      this.addPiece(sx < 0 ? 'L' : 'R', sx * 1.75, -6.4, 0.38, (b) => {
        b.drum(0.38, 3.5, 8, 'stoneLight', 'stone')
        b.push().translate(0, 3.5, 0).cone(0.55, 0.9, 8, roofCol).pop()
        b.push().translate(0, 4.38, 0).flag(0.55, 'flagYellow').pop()
      })
      // Side walls from the back to the flank towers.
      this.addPiece(sx < 0 ? 'L' : 'R', sx * 3.45, -5.95, 0.18, (b) => {
        b.box(0.36, 1.4, 1.5, 'stone', 'stoneLight', 'stoneDark')
      })
      // Front walls between the flank towers and the gatehouse.
      this.addPiece('F', sx * 2.05, -4.4, 0.18, (b) => {
        b.box(1.6, 1.35, 0.36, 'stone', 'stoneLight', 'stoneDark')
        b.push().translate(0, 0, 0.1).crenels(1.6, 0.16, 1.35, 0.24, 4, 'stoneLight').pop()
      })
    }

    // ─── Tearables ───
    this.addTearTower('p4-tower-l', -3.45, -4.55, 'L')
    this.addTearTower('p4-tower-r', 3.45, -4.55, 'R')
    this.addGate()
    this.addDrawbridge()

    // Gears for the core transformation (seams + the big one in the middle).
    for (let i = 0; i < 7; i++) this.seamGears.push(new GlowSprite(sprites.gear, HEX.gearGlow, overlay))
    this.coreGear = new GlowSprite(sprites.gear, HEX.gearGlow, overlay)
    this.glows.push(...this.seamGears, this.coreGear)
    this.group.userData.perfTag = `fold.castle.${mode}`
  }

  private addPiece(dir: FallDir, x: number, z: number, off: number, build: (b: PaperBuilder) => void, mat = this.mat): Piece {
    const p = new Piece(dir, x, z, off)
    const b = new PaperBuilder()
    build(b)
    p.body.add(mesh(b, mat))
    this.group.add(p.pivot)
    this.pieces.push(p)
    return p
  }

  private tearMaterial(): PaperMaterial {
    const m = createPaperMaterial({ vertexColors: true, grain: 0.06 })
    this.materials.push(m)
    return m
  }

  private addTearTower(id: string, x: number, z: number, side: 'L' | 'R'): void {
    const mat = this.tearMaterial()
    const w = 1.35
    const h = 2.35
    const halves: Piece[] = []
    for (const s of [-1, 1] as const) {
      const p = new Piece(s < 0 ? 'L' : 'R', x + s * w / 4, z, w / 4)
      const b = new PaperBuilder()
      b.box(w / 2, h, w, 'stone', 'stoneLight', 'stoneDark')
      for (let y = 0.45; y < h; y += 0.5) b.push().translate(0, y, w / 2 + 0.005).box(w / 2 - 0.02, 0.035, 0.01, 'stoneDark').pop()
      b.push().translate(0, h, 0).crenels(w / 2, w, 0, 0.24, 2, 'stoneLight').pop()
      // Half a pyramid roof: two triangles meeting at the crease.
      b.push().translate(-s * w / 4, h + 0.24, 0)
      const r = w / 2 + 0.12
      const apex: [number, number, number] = [0, 1.1, 0]
      if (s < 0) {
        b.tri(-r, 0, r, 0, 0, r, apex[0], apex[1], apex[2], 'roofBlue')
        b.tri(0, 0, -r, -r, 0, -r, apex[0], apex[1], apex[2], 'roofBlue')
        b.tri(-r, 0, -r, -r, 0, r, apex[0], apex[1], apex[2], 'roofBlue')
      } else {
        b.tri(0, 0, r, r, 0, r, apex[0], apex[1], apex[2], 'roofBlue')
        b.tri(r, 0, -r, 0, 0, -r, apex[0], apex[1], apex[2], 'roofBlue')
        b.tri(r, 0, r, r, 0, -r, apex[0], apex[1], apex[2], 'roofBlue')
      }
      b.pop()
      // Arrow slit.
      b.push().translate(0, 1.3, w / 2 + 0.01).sheet([-0.05, 0, 0.05, 0, 0.05, 0.36, -0.05, 0.36], 'ink').pop()
      p.body.add(mesh(b, mat))
      this.group.add(p.pivot)
      halves.push(p)
    }
    const crease = new Mesh(new PaperBuilder().box(0.06, h * 0.92, 0.02, 'highlight').build(), this.creaseMat)
    crease.position.set(x, 0.1, z + w / 2 + 0.02)
    this.group.add(crease)
    this.tearables.set(id, {
      id, halves: halves as [Piece, Piece], crease, mat, fallT: 0,
      gear: new GlowSprite(this.coreSprite(), HEX.gearGlow, this.overlayScene),
      anchor: new Vector3(x, 1.25, z + w / 2)
    })
    void side
  }

  private addGate(): void {
    const mat = this.tearMaterial()
    const x = 0
    const z = -4.25
    const w = 2.5
    const h = 2.2
    const d = 0.9
    const halves: Piece[] = []
    for (const s of [-1, 1] as const) {
      const p = new Piece(s < 0 ? 'L' : 'R', x + s * w / 4, z, w / 4)
      const b = new PaperBuilder()
      b.box(w / 2, h, d, 'stone', 'stoneLight', 'stoneDark')
      b.push().translate(0, h, 0).crenels(w / 2, d, 0, 0.26, 3, 'stoneLight').pop()
      // Half of the great door, with iron bands.
      b.push().translate(-s * w / 4 + s * 0.35, 0, d / 2 + 0.01).sheet([-0.35, 0, 0.35, 0, 0.35, 1.2, -0.35, 1.2], 'wood').pop()
      for (const y of [0.3, 0.8]) b.push().translate(-s * w / 4 + s * 0.35, y, d / 2 + 0.02).box(0.7, 0.06, 0.02, 'steelDark').pop()
      p.body.add(mesh(b, mat))
      this.group.add(p.pivot)
      halves.push(p)
    }
    // A banner over the gate on its own (falls with the left half visually).
    const crease = new Mesh(new PaperBuilder().box(0.07, h * 0.94, 0.02, 'highlight').build(), this.creaseMat)
    crease.position.set(x, 0.05, z + d / 2 + 0.03)
    this.group.add(crease)
    this.tearables.set('p4-gate', {
      id: 'p4-gate', halves: halves as [Piece, Piece], crease, mat, fallT: 0,
      gear: new GlowSprite(this.coreSprite(), HEX.gearGlow, this.overlayScene),
      anchor: new Vector3(x, 1.1, z + d / 2)
    })
  }

  private addDrawbridge(): void {
    const mat = this.tearMaterial()
    // Stands up against the gate; falls forward (+z) across the moat.
    const p = new Piece('F', 0, -3.72, 0)
    const b = new PaperBuilder()
    b.push().translate(0, 0, -0.06).box(1.5, 1.75, 0.12, 'wood', 'wood', 'woodDark', 'wood').pop()
    for (let x = -0.6; x <= 0.61; x += 0.3) b.push().translate(x, 0, 0.005).box(0.03, 1.75, 0.02, 'woodDark').pop()
    for (const y of [0.3, 1.35]) b.push().translate(0, y, 0.01).box(1.5, 0.08, 0.03, 'steelDark').pop()
    // Chains.
    for (const x of [-0.62, 0.62]) b.push().translate(x, 1.6, -0.2).rotate(0.6, 0, 0).box(0.05, 0.9, 0.05, 'steelDark').pop()
    p.body.add(mesh(b, mat))
    this.group.add(p.pivot)
    const crease = new Mesh(new PaperBuilder().box(1.4, 0.06, 0.02, 'highlight').build(), this.creaseMat)
    crease.position.set(0, 0.9, -3.62)
    this.group.add(crease)
    this.tearables.set('p4-bridge', {
      id: 'p4-bridge', halves: [p], crease, mat, fallT: 0,
      gear: new GlowSprite(this.coreSprite(), HEX.gearGlow, this.overlayScene),
      anchor: new Vector3(0, 0.9, -3.6)
    })
  }

  private coreSprite() {
    return this.spriteTex.gear
  }

  /** World anchor of a tear's visible crease (the engine projects it for picking). */
  anchorOf(id: string): Vector3 | null {
    return this.tearables.get(id)?.anchor ?? null
  }

  /** Height a shooter on top of a tower stands at. */
  standAt(x: number, z: number): number {
    for (const [id, t] of this.tearables) {
      if (id === 'p4-gate' || id === 'p4-bridge') continue
      if (Math.abs(t.anchor.x - x) < 0.8 && Math.abs(t.anchor.z - 0.67 - z) < 0.9 && t.fallT === 0) return 2.35
    }
    return 0
  }

  update(game: FoldGame, time: number, dt: number): void {
    const tears = game.tears
    if (this.mode === 'gates') {
      // A spread lesson's demonstration cracks its tear open with the ghost hands.
      const demo = game.lesson.demo
      const demoTear = demo.phase !== 'off' && demo.on === 'tear' ? demo.target : -1
      for (let i = 0; i < tears.length; i++) this.updateTear(tears[i]!, time, dt, i === demoTear ? demo.fold * 0.6 : 0)
      for (const p of this.pieces) p.fall(0)
      for (const g of this.seamGears) g.set(0, 0, 0, 0, 0)
      this.coreGear.set(0, 0, 0, 0, 0)
      return
    }
    // Core: all tearables intact; the boss drives the transformation.
    for (const t of this.tearables.values()) {
      t.crease.visible = false
      t.gear.set(0, 0, 0, 0, 0)
    }
    const b = game.boss
    const shake = b.phase === 'rumble' ? 0.05 + (b.phaseTime / 2.6) * 0.07 : b.phase === 'unfold' ? 0.04 : 0
    this.group.position.set((Math.random() - 0.5) * shake, 0, (Math.random() - 0.5) * shake * 0.5)
    let unfold = 0
    if (b.phase === 'unfold') unfold = clamp01(b.phaseTime / 3.0)
    else if (b.phase !== 'dormant' && b.phase !== 'rumble') unfold = 1
    const all = [...this.pieces]
    for (const t of this.tearables.values()) all.push(...t.halves)
    all.forEach((p, i) => {
      const k = clamp01((unfold - (i % 7) * 0.05) / 0.7)
      p.fall(easeInOutCubic(k))
    })
    // Gears glowing through the seams.
    const seamPts = [[-1.3, 2.2, -5.5], [1.3, 2.2, -5.5], [0, 2.6, -5.5], [-2.6, 1.2, -4.4], [2.6, 1.2, -4.4], [-3.45, 1.4, -4.3], [3.45, 1.4, -4.3]]
    const glow = b.phase === 'rumble' ? clamp01(b.phaseTime / 1.6) : b.phase === 'unfold' ? 1 - unfold * 0.8 : 0
    this.seamGears.forEach((g, i) => {
      const p = seamPts[i]!
      g.set(p[0]!, p[1]!, p[2]!, 0.9 + Math.sin(time * 6 + i) * 0.15, glow * (0.7 + 0.3 * Math.sin(time * 9 + i)), time * (i % 2 ? 2.5 : -2.5))
    })
    const core = b.phase === 'rumble' ? clamp01(b.phaseTime / 2.6) * 0.8 : b.phase === 'unfold' ? 1 : b.phase === 'roar' ? 1 - clamp01(b.phaseTime / 1.2) : 0
    this.coreGear.set(0, 1.4 + unfold * 0.8, -4.6, 2.6 + unfold * 2.2, core, time * 1.8)
    void dt
  }

  private updateTear(t: TearState, time: number, dt: number, ghostOpen = 0): void {
    const v = this.tearables.get(t.def.id)
    if (!v) return
    // Keep the pick point on the visible crease.
    if (t.torn) v.fallT = Math.min(1, v.fallT + dt * 1.6)
    else v.fallT = 0
    const open = t.torn ? 1 : Math.max(t.t, ghostOpen)
    const bounce = t.torn ? easeOutBounce(v.fallT) : 0
    for (const h of v.halves) {
      if (v.halves.length === 1) h.fall(t.torn ? bounce : open * 0.12)
      else h.fall(t.torn ? bounce : open * 0.14)
    }
    v.crease.visible = t.active && !t.torn
    v.crease.scale.set(1 + open * 3, 1, 1)
    this.creaseMat.uniforms.uEmissiveIntensity.value = 0.45 + Math.sin(time * 6) * 0.25
    v.mat.uniforms.uHighlight.value = t.active && !t.torn ? 1 : 0
    v.mat.uniforms.uFlash.value = t.pulling ? 0.08 + open * 0.2 : 0
    // Light spilling out of the opening crack.
    const a = v.anchor
    v.gear.set(a.x, a.y, a.z + 0.2, 0.6 + open * 1.6, t.torn ? Math.max(0, 1 - v.fallT * 2) : open * 0.95, time * 3)
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose()
    })
    for (const m of this.materials) m.dispose()
    for (const g of this.glows) g.dispose()
    for (const t of this.tearables.values()) t.gear.dispose()
  }
}
