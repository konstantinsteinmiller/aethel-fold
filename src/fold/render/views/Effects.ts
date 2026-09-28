/**
 * Juice (aethel-fold-GDD §2 VFX, §5).
 *
 * - Confetti: "explosions are bursts of multi-coloured rectangular confetti"
 *   — one instanced mesh of paper chips with flutter physics that settle on
 *   the page. Also the paper flecks of a stamp, the scraps of a tear, the
 *   paper-fire of the dragon and the lens burst of a launched knight.
 * - Shock rings: ink rings that race out from a snap or a stamp.
 * - Glows (overlay pass, additive): the toon gears, sparkles and halos.
 *
 * Everything is pooled; nothing allocates after construction.
 */

import {
  AdditiveBlending, Color, DynamicDrawUsage, Group, InstancedMesh, Mesh, PlaneGeometry, RingGeometry,
  Sprite, SpriteMaterial, Vector3, type PerspectiveCamera, type Scene, type Texture
} from 'three'
import { CONFETTI_KEYS, HEX, type PaletteKey } from '../palette'
import { createPaperMaterial, type PaperMaterial } from '../paperMaterial'
import { TMP } from '../paperGeometry'
import type { SpriteTextures } from '../art/spriteArt'

const MAX_CONFETTI = 1100
const MAX_RINGS = 10
const MAX_GLOWS = 40

export type ConfettiPalette = 'festive' | 'paper' | 'flame' | 'gold' | 'ink' | 'hero' | 'enemy' | 'dragon'

const PALETTES: Record<ConfettiPalette, PaletteKey[]> = {
  festive: [...CONFETTI_KEYS],
  paper: ['parchment', 'parchmentLight', 'paperWhite', 'parchmentShade'],
  flame: ['dragonRed', 'dragonOrange', 'dragonYellow', 'c6', 'danger'],
  gold: ['gold', 'gear', 'gearGlow', 'flagYellow'],
  ink: ['ink', 'inkSoft', 'parchmentShade'],
  hero: ['heroBlue', 'heroSteel', 'flagYellow'],
  enemy: ['enemyRed', 'enemySteel', 'gold', 'paperWhite'],
  dragon: ['dragonRed', 'dragonBlue', 'dragonGreen', 'dragonYellow']
}

export interface ConfettiOptions {
  count: number
  speed?: number
  up?: number
  spread?: number
  palette?: ConfettiPalette
  size?: number
  life?: number
  /** Initial direction bias (world). */
  dirX?: number
  dirY?: number
  dirZ?: number
  gravity?: number
  /** Settle on the page (y = 0) instead of falling through. */
  settle?: boolean
}

export class Effects {
  readonly group = new Group()
  private readonly confetti: InstancedMesh
  private readonly confMat: PaperMaterial
  // Confetti state (struct of arrays).
  private readonly px = new Float32Array(MAX_CONFETTI)
  private readonly py = new Float32Array(MAX_CONFETTI)
  private readonly pz = new Float32Array(MAX_CONFETTI)
  private readonly vx = new Float32Array(MAX_CONFETTI)
  private readonly vy = new Float32Array(MAX_CONFETTI)
  private readonly vz = new Float32Array(MAX_CONFETTI)
  private readonly rx = new Float32Array(MAX_CONFETTI)
  private readonly ry = new Float32Array(MAX_CONFETTI)
  private readonly rz = new Float32Array(MAX_CONFETTI)
  private readonly wx = new Float32Array(MAX_CONFETTI)
  private readonly wy = new Float32Array(MAX_CONFETTI)
  private readonly wz = new Float32Array(MAX_CONFETTI)
  private readonly life = new Float32Array(MAX_CONFETTI)
  private readonly maxLife = new Float32Array(MAX_CONFETTI)
  private readonly size = new Float32Array(MAX_CONFETTI)
  private readonly grav = new Float32Array(MAX_CONFETTI)
  private readonly settle = new Uint8Array(MAX_CONFETTI)
  private readonly flat = new Uint8Array(MAX_CONFETTI)
  private cursor = 0
  private live = 0

  private readonly rings: Mesh[] = []
  private readonly ringMats: PaperMaterial[] = []
  private readonly ringT = new Float32Array(MAX_RINGS)
  private readonly ringLife = new Float32Array(MAX_RINGS)
  private readonly ringR = new Float32Array(MAX_RINGS)
  private ringCursor = 0

  private readonly glows: Sprite[] = []
  private readonly glowT = new Float32Array(MAX_GLOWS)
  private readonly glowLife = new Float32Array(MAX_GLOWS)
  private readonly glowSize = new Float32Array(MAX_GLOWS)
  private readonly glowSpin = new Float32Array(MAX_GLOWS)
  private readonly glowRise = new Float32Array(MAX_GLOWS)
  private glowCursor = 0

  private readonly colors = new Map<PaletteKey, Color>()
  private readonly tmpV = new Vector3()
  private readonly right = new Vector3()
  private readonly upV = new Vector3()
  private readonly fwd = new Vector3()

  constructor(private readonly sprites: SpriteTextures, overlay: Scene) {
    this.confMat = createPaperMaterial({ doubleSided: true, backTint: '#e8e2d8', grain: 0, id: 127 })
    const geo = new PlaneGeometry(0.1, 0.16)
    this.confetti = new InstancedMesh(geo, this.confMat, MAX_CONFETTI)
    this.confetti.instanceMatrix.setUsage(DynamicDrawUsage)
    this.confetti.frustumCulled = false
    this.confetti.castShadow = true
    TMP.m.makeScale(0, 0, 0)
    for (let i = 0; i < MAX_CONFETTI; i++) {
      this.confetti.setMatrixAt(i, TMP.m)
      this.confetti.setColorAt(i, TMP.c.setRGB(1, 1, 1))
    }
    this.confetti.instanceColor!.setUsage(DynamicDrawUsage)
    this.group.add(this.confetti)
    for (const k of Object.keys(HEX) as PaletteKey[]) this.colors.set(k, new Color(HEX[k]))

    const ringGeo = new RingGeometry(0.86, 1, 40)
    ringGeo.rotateX(-Math.PI / 2)
    for (let i = 0; i < MAX_RINGS; i++) {
      const m = createPaperMaterial({ unlit: true, color: HEX.ink, grain: 0 })
      const r = new Mesh(ringGeo, m)
      r.visible = false
      r.renderOrder = 3
      this.rings.push(r)
      this.ringMats.push(m)
      this.group.add(r)
    }

    for (let i = 0; i < MAX_GLOWS; i++) {
      const mat = new SpriteMaterial({
        map: sprites.glow, blending: AdditiveBlending, depthTest: false, depthWrite: false, transparent: true
      })
      const s = new Sprite(mat)
      s.visible = false
      this.glows.push(s)
      overlay.add(s)
    }
    this.group.userData.perfTag = 'fold.vfx'
  }

  // ─── Spawners ────────────────────────────────────────────────────────────

  burst(x: number, y: number, z: number, o: ConfettiOptions): void {
    const pal = PALETTES[o.palette ?? 'festive']
    const speed = o.speed ?? 4
    const spread = o.spread ?? 1
    const up = o.up ?? 4
    const size = o.size ?? 1
    const life = o.life ?? 2.2
    for (let n = 0; n < o.count; n++) {
      const i = this.cursor
      this.cursor = (this.cursor + 1) % MAX_CONFETTI
      const a = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * speed * spread
      this.px[i] = x + (Math.random() - 0.5) * 0.2
      this.py[i] = y + Math.random() * 0.2
      this.pz[i] = z + (Math.random() - 0.5) * 0.2
      this.vx[i] = Math.cos(a) * r + (o.dirX ?? 0) * speed
      this.vy[i] = up * (0.6 + Math.random() * 0.7) + (o.dirY ?? 0) * speed
      this.vz[i] = Math.sin(a) * r + (o.dirZ ?? 0) * speed
      this.rx[i] = Math.random() * 6
      this.ry[i] = Math.random() * 6
      this.rz[i] = Math.random() * 6
      this.wx[i] = (Math.random() - 0.5) * 18
      this.wy[i] = (Math.random() - 0.5) * 14
      this.wz[i] = (Math.random() - 0.5) * 18
      this.life[i] = life * (0.7 + Math.random() * 0.6)
      this.maxLife[i] = this.life[i]!
      this.size[i] = size * (0.7 + Math.random() * 0.7)
      this.grav[i] = o.gravity ?? 7
      this.settle[i] = o.settle === false ? 0 : 1
      this.flat[i] = 0
      this.confetti.setColorAt(i, this.colors.get(pal[Math.floor(Math.random() * pal.length)]!)!)
    }
    this.live = Math.min(MAX_CONFETTI, this.live + o.count)
  }

  /**
   * A launched knight hits the lens (GDD §6 0:02): a burst of big confetti
   * right in front of the camera, flying outward across the screen.
   */
  lensBurst(camera: PerspectiveCamera, sx = 0, sy = 0): void {
    camera.getWorldDirection(this.fwd)
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion)
    this.upV.set(0, 1, 0).applyQuaternion(camera.quaternion)
    const d = 2.6
    const tanH = Math.tan((camera.fov * Math.PI) / 360) * d
    const cx = camera.position.x + this.fwd.x * d + this.right.x * sx * tanH * camera.aspect + this.upV.x * sy * tanH
    const cy = camera.position.y + this.fwd.y * d + this.right.y * sx * tanH * camera.aspect + this.upV.y * sy * tanH
    const cz = camera.position.z + this.fwd.z * d + this.right.z * sx * tanH * camera.aspect + this.upV.z * sy * tanH
    const pal = PALETTES.festive
    for (let n = 0; n < 34; n++) {
      const i = this.cursor
      this.cursor = (this.cursor + 1) % MAX_CONFETTI
      const a = Math.random() * Math.PI * 2
      const sp = 1.2 + Math.random() * 2.8
      this.px[i] = cx
      this.py[i] = cy
      this.pz[i] = cz
      this.vx[i] = (this.right.x * Math.cos(a) + this.upV.x * Math.sin(a)) * sp
      this.vy[i] = (this.right.y * Math.cos(a) + this.upV.y * Math.sin(a)) * sp
      this.vz[i] = (this.right.z * Math.cos(a) + this.upV.z * Math.sin(a)) * sp
      this.rx[i] = Math.random() * 6
      this.ry[i] = Math.random() * 6
      this.rz[i] = Math.random() * 6
      this.wx[i] = (Math.random() - 0.5) * 20
      this.wy[i] = (Math.random() - 0.5) * 20
      this.wz[i] = (Math.random() - 0.5) * 20
      this.life[i] = 0.55 + Math.random() * 0.35
      this.maxLife[i] = this.life[i]!
      this.size[i] = 0.9 + Math.random() * 0.8
      this.grav[i] = 1.2
      this.settle[i] = 0
      this.flat[i] = 0
      this.confetti.setColorAt(i, this.colors.get(pal[Math.floor(Math.random() * pal.length)]!)!)
    }
    this.live = Math.min(MAX_CONFETTI, this.live + 34)
  }

  ring(x: number, z: number, radius: number, life = 0.45, color: PaletteKey = 'ink'): void {
    const i = this.ringCursor
    this.ringCursor = (this.ringCursor + 1) % MAX_RINGS
    const r = this.rings[i]!
    r.position.set(x, 0.03, z)
    r.visible = true
    this.ringMats[i]!.uniforms.uColor.value.copy(this.colors.get(color)!)
    this.ringT[i] = 0
    this.ringLife[i] = life
    this.ringR[i] = radius
  }

  glow(
    x: number, y: number, z: number, size: number, life: number,
    kind: 'glow' | 'gear' | 'star' | 'ring' = 'glow', color: PaletteKey = 'gearGlow', spin = 0, rise = 0
  ): void {
    const i = this.glowCursor
    this.glowCursor = (this.glowCursor + 1) % MAX_GLOWS
    const s = this.glows[i]!
    const mat = s.material as SpriteMaterial
    const tex: Texture = kind === 'gear' ? this.sprites.gear : kind === 'star' ? this.sprites.star : kind === 'ring' ? this.sprites.ring : this.sprites.glow
    if (mat.map !== tex) {
      mat.map = tex
      mat.needsUpdate = true
    }
    mat.color.copy(this.colors.get(color)!)
    s.position.set(x, y, z)
    s.visible = true
    this.glowT[i] = 0
    this.glowLife[i] = life
    this.glowSize[i] = size
    this.glowSpin[i] = spin
    this.glowRise[i] = rise
  }

  /** Paper-fire: a stream of flame-coloured paper strips along a direction. */
  flame(x: number, y: number, z: number, dx: number, dy: number, dz: number, count: number): void {
    this.burst(x, y, z, {
      count, speed: 6.5, spread: 0.18, up: 0.5, palette: 'flame', size: 1.7, life: 0.75,
      dirX: dx, dirY: dy, dirZ: dz, gravity: 1.5, settle: false
    })
  }

  // ─── Tick ────────────────────────────────────────────────────────────────

  update(dt: number): void {
    // Confetti.
    if (this.live > 0) {
      let alive = 0
      for (let i = 0; i < MAX_CONFETTI; i++) {
        if (this.life[i]! <= 0) continue
        this.life[i]! -= dt
        const l = this.life[i]!
        if (l <= 0) {
          TMP.m.makeScale(0, 0, 0)
          this.confetti.setMatrixAt(i, TMP.m)
          continue
        }
        alive++
        if (this.flat[i]) {
          // Lying on the page: fade by shrinking in the last half second.
          const k = Math.min(1, l / 0.5)
          TMP.e.set(-Math.PI / 2, this.ry[i]!, 0)
          TMP.q.setFromEuler(TMP.e)
          TMP.p.set(this.px[i]!, 0.012, this.pz[i]!)
          TMP.s.setScalar(this.size[i]! * k)
          TMP.m.compose(TMP.p, TMP.q, TMP.s)
          this.confetti.setMatrixAt(i, TMP.m)
          continue
        }
        // Flutter: paper falls slowly, drifting, and tumbles.
        const drag = 1.9
        this.vx[i]! -= this.vx[i]! * drag * dt
        this.vz[i]! -= this.vz[i]! * drag * dt
        this.vy[i]! -= this.grav[i]! * dt
        if (this.vy[i]! < -2.2) this.vy[i]! += (-2.2 - this.vy[i]!) * 4 * dt
        const t = l * 7 + i
        this.vx[i]! += Math.sin(t) * 1.4 * dt
        this.vz[i]! += Math.cos(t * 1.3) * 1.4 * dt
        this.px[i]! += this.vx[i]! * dt
        this.py[i]! += this.vy[i]! * dt
        this.pz[i]! += this.vz[i]! * dt
        this.rx[i]! += this.wx[i]! * dt
        this.ry[i]! += this.wy[i]! * dt
        this.rz[i]! += this.wz[i]! * dt
        if (this.settle[i] && this.py[i]! <= 0.015) {
          this.py[i] = 0.015
          this.flat[i] = 1
          this.life[i] = Math.min(l, 1.2 + Math.random())
        }
        const k = Math.min(1, l / 0.3)
        TMP.e.set(this.rx[i]!, this.ry[i]!, this.rz[i]!)
        TMP.q.setFromEuler(TMP.e)
        TMP.p.set(this.px[i]!, this.py[i]!, this.pz[i]!)
        TMP.s.setScalar(this.size[i]! * k)
        TMP.m.compose(TMP.p, TMP.q, TMP.s)
        this.confetti.setMatrixAt(i, TMP.m)
      }
      this.live = alive
      this.confetti.instanceMatrix.needsUpdate = true
      if (this.confetti.instanceColor) this.confetti.instanceColor.needsUpdate = true
    }

    // Rings.
    for (let i = 0; i < MAX_RINGS; i++) {
      const r = this.rings[i]!
      if (!r.visible) continue
      this.ringT[i]! += dt
      const k = this.ringT[i]! / this.ringLife[i]!
      if (k >= 1) {
        r.visible = false
        continue
      }
      const e = 1 - Math.pow(1 - k, 3)
      const rad = 0.2 + this.ringR[i]! * e
      r.scale.set(rad, 1, rad)
      this.ringMats[i]!.uniforms.uOpacity.value = 1 - k
    }

    // Glows.
    for (let i = 0; i < MAX_GLOWS; i++) {
      const s = this.glows[i]!
      if (!s.visible) continue
      this.glowT[i]! += dt
      const k = this.glowT[i]! / this.glowLife[i]!
      if (k >= 1) {
        s.visible = false
        continue
      }
      const mat = s.material as SpriteMaterial
      const pop = k < 0.2 ? k / 0.2 : 1
      const sz = this.glowSize[i]! * (0.6 + 0.4 * pop) * (1 + k * 0.3)
      s.scale.set(sz, sz, 1)
      mat.rotation += this.glowSpin[i]! * dt
      mat.opacity = (1 - k) * (1 - k)
      s.position.y += this.glowRise[i]! * dt
    }
  }

  dispose(): void {
    this.confetti.geometry.dispose()
    this.confMat.dispose()
    this.confetti.dispose()
    this.rings[0]?.geometry.dispose()
    for (const m of this.ringMats) m.dispose()
    for (const s of this.glows) {
      s.removeFromParent()
      ;(s.material as SpriteMaterial).dispose()
    }
  }
}

/** A persistent glowing sprite owned by a view (gear cores, weak points). */
export class GlowSprite {
  readonly sprite: Sprite
  constructor(tex: Texture, color: string, overlay: Scene, size = 1) {
    this.sprite = new Sprite(new SpriteMaterial({
      map: tex, color: new Color(color), blending: AdditiveBlending, depthTest: false, depthWrite: false, transparent: true
    }))
    this.sprite.scale.set(size, size, 1)
    this.sprite.visible = false
    overlay.add(this.sprite)
  }

  set(x: number, y: number, z: number, size: number, opacity: number, rotation = 0): void {
    const s = this.sprite
    s.visible = opacity > 0.01
    s.position.set(x, y, z)
    s.scale.set(size, size, 1)
    const m = s.material as SpriteMaterial
    m.opacity = opacity
    m.rotation = rotation
  }

  dispose(): void {
    this.sprite.removeFromParent()
    ;(this.sprite.material as SpriteMaterial).dispose()
  }
}
