/**
 * The origami dragon (aethel-fold-GDD §8 Page 5; storyboard panels
 * "Transformation Complete" → "Boss Folding Down").
 *
 * Built like real origami: every part is a few crisp facets in the four GDD
 * colours (bright reds, blues, greens, yellows). The rig is procedural —
 * legs are two-bone chains solved toward foot targets, the neck and tail are
 * point chains — so poses are just target points and every animation (rear,
 * breathe, stomp, a limb creased backward, the final fold-down) is a few
 * lines of maths instead of keyframes.
 */

import { Group, Mesh, Vector3, type BufferGeometry, type Scene } from 'three'
import type { FoldGame } from '../../logic/game'
import type { BossLimb } from '../../logic/types'
import { bossClock } from '../../logic/boss'
import { clamp01, easeOutBack } from '../../logic/math'
import { PaperBuilder, shade, type Col } from '../paperGeometry'
import { createPaperMaterial, type PaperMaterial } from '../paperMaterial'
import type { SpriteTextures } from '../art/spriteArt'
import { GlowSprite } from './Effects'
import { HEX } from '../palette'

const ROOT_Z = -3.95
const BODY_Y = 1.35

/** Unit-length faceted limb segment (diamond cross-section) along +y. */
const segmentGeometry = (r0: number, r1: number, a: Col, b: Col, belly: Col): BufferGeometry => {
  const pb = new PaperBuilder()
  const ring = (r: number, y: number): [number, number, number][] => [
    [0, y, r], [r, y, 0], [0, y, -r], [-r, y, 0]
  ]
  const lo = ring(r0, 0)
  const hi = ring(r1, 1)
  const cols: Col[] = [belly, a, b, a]
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    pb.quad(lo[i]!, lo[j]!, hi[j]!, hi[i]!, cols[i]!)
  }
  pb.tri(hi[0]![0], 1, hi[0]![2], hi[1]![0], 1, hi[1]![2], hi[2]![0], 1, hi[2]![2], shade(a, 0.9))
  pb.tri(hi[0]![0], 1, hi[0]![2], hi[2]![0], 1, hi[2]![2], hi[3]![0], 1, hi[3]![2], shade(a, 0.9))
  pb.tri(lo[0]![0], 0, lo[0]![2], lo[2]![0], 0, lo[2]![2], lo[1]![0], 0, lo[1]![2], b)
  pb.tri(lo[0]![0], 0, lo[0]![2], lo[3]![0], 0, lo[3]![2], lo[2]![0], 0, lo[2]![2], b)
  return pb.build()
}

const bodyGeometry = (): BufferGeometry => {
  const b = new PaperBuilder()
  const F: [number, number, number] = [0, 0.15, 1.45]
  const B: [number, number, number] = [0, 0.3, -1.55]
  const T: [number, number, number] = [0, 0.85, 0.1]
  const D: [number, number, number] = [0, -0.5, 0.1]
  const L: [number, number, number] = [-0.9, 0.12, 0.1]
  const R: [number, number, number] = [0.9, 0.12, 0.1]
  const tri = (p: [number, number, number], q: [number, number, number], r: [number, number, number], c: Col): void => {
    b.tri(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2], c)
  }
  tri(F, R, T, 'dragonRed')
  tri(F, T, L, 'dragonRedDark')
  tri(B, T, R, 'dragonRedDark')
  tri(B, L, T, 'dragonRed')
  tri(F, D, R, 'dragonYellow')
  tri(F, L, D, 'dragonOrange')
  tri(B, R, D, 'dragonOrange')
  tri(B, D, L, 'dragonYellow')
  // Spine ridge: yellow folded spikes.
  for (let i = 0; i < 4; i++) {
    const z = 0.9 - i * 0.55
    const y = 0.85 - Math.abs(z - 0.1) * 0.35
    b.tri(-0.08, y - 0.05, z + 0.2, 0.08, y - 0.05, z + 0.2, 0, y + 0.42, z - 0.08, 'dragonYellow')
    b.tri(0.08, y - 0.05, z + 0.2, -0.08, y - 0.05, z + 0.2, 0, y + 0.42, z - 0.08, shade('dragonYellow', 0.8))
  }
  return b.build()
}

const headGeometry = (): BufferGeometry => {
  const b = new PaperBuilder()
  // Head points toward +z; origin at the back of the skull.
  const nose: [number, number, number] = [0, 0.05, 1.05]
  const top: [number, number, number] = [0, 0.42, 0.1]
  const l: [number, number, number] = [-0.38, 0.05, 0.05]
  const r: [number, number, number] = [0.38, 0.05, 0.05]
  const bot: [number, number, number] = [0, -0.12, 0.2]
  const back: [number, number, number] = [0, 0.15, -0.3]
  const tri = (p: number[], q: number[], s: number[], c: Col): void => {
    b.tri(p[0]!, p[1]!, p[2]!, q[0]!, q[1]!, q[2]!, s[0]!, s[1]!, s[2]!, c)
  }
  tri(nose, r, top, 'dragonRed')
  tri(nose, top, l, 'dragonRedDark')
  tri(back, top, r, 'dragonRedDark')
  tri(back, l, top, 'dragonRed')
  tri(nose, bot, r, 'dragonYellow')
  tri(nose, l, bot, 'dragonOrange')
  tri(back, r, bot, 'dragonOrange')
  tri(back, bot, l, 'dragonYellow')
  // Eyes (white facets with ink pupils) and horns.
  for (const s of [-1, 1]) {
    b.tri(s * 0.2, 0.28, 0.42, s * 0.33, 0.14, 0.3, s * 0.12, 0.2, 0.62, 'paperWhite')
    b.tri(s * 0.12, 0.2, 0.62, s * 0.33, 0.14, 0.3, s * 0.2, 0.28, 0.42, 'paperWhite')
    b.tri(s * 0.21, 0.24, 0.45, s * 0.27, 0.18, 0.4, s * 0.18, 0.2, 0.52, 'ink')
    b.tri(s * 0.18, 0.2, 0.52, s * 0.27, 0.18, 0.4, s * 0.21, 0.24, 0.45, 'ink')
    b.tri(s * 0.12, 0.38, 0.05, s * 0.28, 0.3, -0.05, s * 0.3, 0.95, -0.55, 'dragonYellow')
    b.tri(s * 0.3, 0.95, -0.55, s * 0.28, 0.3, -0.05, s * 0.12, 0.38, 0.05, shade('dragonYellow', 0.75))
  }
  return b.build()
}

const jawGeometry = (): BufferGeometry => {
  const b = new PaperBuilder()
  b.tri(0, -0.02, 0.95, 0.3, 0, 0.05, -0.3, 0, 0.05, 'dragonYellow')
  b.tri(0, -0.02, 0.95, -0.3, 0, 0.05, 0, -0.22, 0.2, 'dragonOrange')
  b.tri(0, -0.02, 0.95, 0, -0.22, 0.2, 0.3, 0, 0.05, 'dragonOrange')
  // Teeth.
  for (let i = 0; i < 3; i++) {
    const z = 0.3 + i * 0.2
    const w = 0.25 - i * 0.06
    for (const s of [-1, 1]) b.tri(s * w, 0, z, s * (w - 0.05), 0, z + 0.08, s * (w - 0.02), 0.12, z + 0.03, 'paperWhite')
  }
  return b.build()
}

/** A wing: three membranes fanned out along −x from the shoulder (mirrored for the right). */
const wingGeometry = (side: -1 | 1): BufferGeometry => {
  const b = new PaperBuilder()
  const s = side
  const root: [number, number, number] = [0, 0, 0]
  const tips: [number, number, number][] = [
    [s * 2.3, 1.55, 0.35], [s * 3.4, 0.95, -0.05], [s * 3.9, 0.15, -0.55], [s * 3.1, -0.45, -1.05]
  ]
  const cols: Col[] = ['dragonBlue', 'dragonBlueDark', 'dragonBlue']
  for (let i = 0; i < 3; i++) {
    const a = tips[i]!
    const c = tips[i + 1]!
    if (s < 0) {
      b.tri(root[0], root[1], root[2], c[0], c[1], c[2], a[0], a[1], a[2], cols[i]!)
      b.tri(root[0], root[1], root[2], a[0], a[1], a[2], c[0], c[1], c[2], shade(cols[i]!, 0.8))
    } else {
      b.tri(root[0], root[1], root[2], a[0], a[1], a[2], c[0], c[1], c[2], cols[i]!)
      b.tri(root[0], root[1], root[2], c[0], c[1], c[2], a[0], a[1], a[2], shade(cols[i]!, 0.8))
    }
  }
  // Yellow leading-edge spar.
  const t0 = tips[0]!
  b.tri(0, 0.06, 0.05, t0[0], t0[1] + 0.06, t0[2], t0[0] * 0.5, t0[1] * 0.5 + 0.16, t0[2] * 0.5 + 0.08, 'dragonYellow')
  b.tri(0, 0.06, 0.05, t0[0] * 0.5, t0[1] * 0.5 + 0.16, t0[2] * 0.5 + 0.08, t0[0], t0[1] + 0.06, t0[2], shade('dragonYellow', 0.8))
  return b.build()
}

class Segment {
  readonly mesh: Mesh
  private static readonly up = new Vector3(0, 1, 0)
  private static readonly d = new Vector3()
  constructor(geo: BufferGeometry, mat: PaperMaterial, parent: Group) {
    this.mesh = new Mesh(geo, mat)
    this.mesh.castShadow = true
    parent.add(this.mesh)
  }

  span(a: Vector3, b: Vector3, thickness = 1): void {
    const d = Segment.d.subVectors(b, a)
    const len = d.length()
    this.mesh.position.copy(a)
    if (len > 1e-5) this.mesh.quaternion.setFromUnitVectors(Segment.up, d.multiplyScalar(1 / len))
    this.mesh.scale.set(thickness, Math.max(0.001, len), thickness)
  }
}

interface Leg {
  limb: BossLimb | null
  hip: Vector3
  foot: Vector3
  thigh: Segment
  shin: Segment
  claw: Mesh
  mat: PaperMaterial
  side: number
  front: boolean
  knee: Vector3
}

export class DragonView {
  readonly group = new Group()
  private readonly rig = new Group()
  private readonly body: Mesh
  private readonly head = new Group()
  private readonly jaw = new Group()
  private readonly wings: Group[] = []
  private readonly wingMats: PaperMaterial[] = []
  private readonly legs: Leg[] = []
  private readonly neck: Segment[] = []
  private readonly tail: Segment[] = []
  private readonly bodyMat: PaperMaterial
  private readonly neckMat: PaperMaterial
  private readonly materials: PaperMaterial[] = []
  private readonly chest: GlowSprite
  private readonly mouthGlow: GlowSprite
  private readonly weakGlow: GlowSprite
  private readonly creaseMat: PaperMaterial
  private readonly creaseStrip: Mesh
  /** World positions of weak points (legFL, legFR, wingL, wingR, neck). */
  readonly anchors: Vector3[] = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()]
  readonly mouth = new Vector3()
  readonly mouthDir = new Vector3(0, -0.4, 1)
  private readonly tmpA = new Vector3()
  private readonly tmpB = new Vector3()
  private readonly tmpC = new Vector3()
  private readonly sd = new Vector3()
  private readonly sBend = new Vector3()
  private readonly sFoot = new Vector3()
  private readonly yAxis = new Vector3(0, 1, 0)
  private readonly neckPts = [new Vector3(), new Vector3(), new Vector3(), new Vector3()]
  private readonly tailPts = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()]
  private hurtFlash = 0
  private lastRev = -1
  private limbFold = new Map<BossLimb, number>()

  constructor(sprites: SpriteTextures, overlay: Scene) {
    this.bodyMat = createPaperMaterial({ vertexColors: true, grain: 0.05 })
    this.neckMat = createPaperMaterial({ vertexColors: true, grain: 0.05 })
    this.creaseMat = createPaperMaterial({ unlit: true, color: HEX.highlight, emissive: HEX.gear, emissiveIntensity: 0.8 })
    this.materials.push(this.bodyMat, this.neckMat, this.creaseMat)
    this.group.position.set(0, 0, ROOT_Z)
    this.group.add(this.rig)

    this.body = new Mesh(bodyGeometry(), this.bodyMat)
    this.body.castShadow = true
    this.body.position.y = BODY_Y
    this.rig.add(this.body)

    // Neck: three segments + head.
    const neckGeo = segmentGeometry(0.3, 0.22, 'dragonGreen', 'dragonGreenDark', 'dragonYellow')
    for (let i = 0; i < 3; i++) this.neck.push(new Segment(neckGeo, this.neckMat, this.rig))
    const headMesh = new Mesh(headGeometry(), this.bodyMat)
    headMesh.castShadow = true
    this.head.add(headMesh)
    const jawMesh = new Mesh(jawGeometry(), this.bodyMat)
    jawMesh.castShadow = true
    this.jaw.position.set(0, -0.02, 0.08)
    this.jaw.add(jawMesh)
    this.head.add(this.jaw)
    this.rig.add(this.head)

    // Tail.
    const tailGeo = segmentGeometry(0.26, 0.12, 'dragonRed', 'dragonRedDark', 'dragonYellow')
    for (let i = 0; i < 4; i++) this.tail.push(new Segment(tailGeo, this.bodyMat, this.rig))

    // Wings.
    for (const s of [-1, 1] as const) {
      const m = createPaperMaterial({ vertexColors: true, grain: 0.04, doubleSided: true, backTint: '#9bb6ff' })
      this.materials.push(m)
      this.wingMats.push(m)
      const w = new Group()
      const mesh = new Mesh(wingGeometry(s), m)
      mesh.castShadow = true
      w.add(mesh)
      w.position.set(s * 0.55, BODY_Y + 0.6, 0.25)
      this.wings.push(w)
      this.rig.add(w)
    }

    // Legs.
    const legDefs: { limb: BossLimb | null; side: number; front: boolean; hip: [number, number, number]; foot: [number, number, number] }[] = [
      { limb: 'legFL', side: -1, front: true, hip: [-0.55, BODY_Y - 0.1, 0.75], foot: [-1.75, 0, 2.1] },
      { limb: 'legFR', side: 1, front: true, hip: [0.55, BODY_Y - 0.1, 0.75], foot: [1.75, 0, 2.1] },
      { limb: null, side: -1, front: false, hip: [-0.55, BODY_Y, -0.9], foot: [-1.45, 0, -1.3] },
      { limb: null, side: 1, front: false, hip: [0.55, BODY_Y, -0.9], foot: [1.45, 0, -1.3] }
    ]
    for (const d of legDefs) {
      const mat = createPaperMaterial({ vertexColors: true, grain: 0.05 })
      this.materials.push(mat)
      const thighGeo = segmentGeometry(0.2, 0.15, 'dragonGreen', 'dragonGreenDark', 'dragonYellow')
      const shinGeo = segmentGeometry(0.15, 0.1, 'dragonRed', 'dragonRedDark', 'dragonYellow')
      const claw = new Mesh(new PaperBuilder().cone(0.22, 0.22, 4, 'dragonYellow').build(), mat)
      claw.castShadow = true
      this.rig.add(claw)
      this.legs.push({
        limb: d.limb, side: d.side, front: d.front, mat, claw,
        hip: new Vector3(...d.hip), foot: new Vector3(...d.foot), knee: new Vector3(),
        thigh: new Segment(thighGeo, mat, this.rig), shin: new Segment(shinGeo, mat, this.rig)
      })
    }

    // Crease strip for the exposed leg.
    this.creaseStrip = new Mesh(new PaperBuilder().box(0.09, 1, 0.09, 'highlight').build(), this.creaseMat)
    this.creaseStrip.visible = false
    this.rig.add(this.creaseStrip)

    this.chest = new GlowSprite(sprites.gear, HEX.gearGlow, overlay)
    this.mouthGlow = new GlowSprite(sprites.glow, HEX.dragonOrange, overlay)
    this.weakGlow = new GlowSprite(sprites.gear, HEX.gearGlow, overlay)
    this.group.visible = false
    this.group.userData.perfTag = 'fold.dragon'
  }

  update(game: FoldGame, time: number, dt: number): void {
    const b = game.boss
    // Authored seconds: a faster rush dragon (roadmap #16) plays the same moves, faster.
    const bt = bossClock(b)
    const ph = b.phase
    if (ph === 'dormant' || ph === 'rumble' || ph === 'flat') {
      this.group.visible = false
      this.chest.set(0, 0, 0, 0, 0)
      this.mouthGlow.set(0, 0, 0, 0, 0)
      this.weakGlow.set(0, 0, 0, 0, 0)
      return
    }
    this.group.visible = true
    if (b.rev !== this.lastRev) {
      if (ph === 'hurt') this.hurtFlash = 1
      this.lastRev = b.rev
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5)

    // Emergence during the unfold.
    let emerge = 1
    if (ph === 'unfold') emerge = clamp01((bt - 1.2) / 2.0)
    const e = easeOutBack(emerge, 1.4)
    this.rig.scale.set(Math.max(0.01, e), Math.max(0.01, e), Math.max(0.01, e))

    // Collapse: everything folds flat onto the page.
    const col = ph === 'collapse' ? clamp01(b.collapse) : 0
    const flat = 1 - col * 0.94
    this.rig.scale.y *= flat
    this.rig.rotation.x = col * 0.08

    // Limb fold amounts (broken → 1, being pulled → w.t).
    b.weakPoints.forEach((w, i) => {
      const target = w.broken ? 1 : b.exposed === i ? w.t * 0.8 : 0
      const cur = this.limbFold.get(w.limb) ?? 0
      this.limbFold.set(w.limb, cur + (target - cur) * (1 - Math.exp(-dt * (w.broken ? 5 : 14))))
    })
    const fold = (l: BossLimb): number => this.limbFold.get(l) ?? 0
    const brokenLegs = fold('legFL') + fold('legFR')

    // Body: breathing bob; rear for charge; stomp lift; kneel on broken legs.
    const breathe = Math.sin(time * 2.2) * 0.06
    let rear = 0
    let lift = 0
    if (ph === 'breathCharge') rear = clamp01(bt / 0.6)
    else if (ph === 'breath') rear = 1 - clamp01(bt / 0.25)
    else if (ph === 'roar') rear = Math.sin(clamp01(bt / 1.4) * Math.PI) * 0.9
    if (ph === 'stomp') {
      const k = bt
      lift = k < 0.55 ? Math.sin((k / 0.55) * Math.PI / 2) * 0.7 : Math.max(0, 0.7 - (k - 0.55) * 7)
    }
    const kneel = brokenLegs * 0.35
    this.body.position.y = BODY_Y + breathe + lift * 0.5 - kneel
    this.body.rotation.x = -lift * 0.35 + brokenLegs * 0.12 - rear * 0.12
    this.body.rotation.z = (fold('legFR') - fold('legFL')) * 0.18
    this.bodyMat.uniforms.uFlash.value = this.hurtFlash * 0.6

    // Neck & head.
    const look = Math.atan2(game.hero.x - 0, 9) * 0.6
    const neckDown = b.exposed === 4 ? 0.8 : 0
    const base = this.neckPts[0]!.set(0, this.body.position.y + 0.55, 1.05)
    const rearUp = rear * 0.9 - neckDown * 1.3 - fold('neck') * 1.4
    this.neckPts[1]!.set(look * 0.3, base.y + 0.75 + rearUp * 0.4, 1.55 - rear * 0.35)
    this.neckPts[2]!.set(look * 0.7, base.y + 1.35 + rearUp * 0.7, 2.0 - rear * 0.6 + (ph === 'breath' ? 0.5 : 0))
    this.neckPts[3]!.set(look, base.y + 1.75 + rearUp, 2.5 - rear * 0.8 + (ph === 'breath' ? 0.9 : 0))
    for (let i = 0; i < 3; i++) this.neck[i]!.span(this.neckPts[i]!, this.neckPts[i + 1]!)
    this.head.position.copy(this.neckPts[3]!)
    const headPitch = rear * -0.7 + (ph === 'breath' ? 0.55 : 0) + neckDown * 0.6
    this.head.rotation.set(headPitch, look * 0.8, Math.sin(time * 1.4) * 0.05)
    let jawOpen = 0.08 + Math.max(0, Math.sin(time * 1.3)) * 0.05
    if (ph === 'breathCharge') jawOpen = 0.15 + clamp01(bt / 1.8) * 0.5
    if (ph === 'breath') jawOpen = 0.85
    if (ph === 'roar') jawOpen = 0.9
    if (ph === 'hurt') jawOpen = 0.6
    this.jaw.rotation.x = jawOpen
    this.neckMat.uniforms.uHighlight.value = b.exposed === 4 ? 1 : 0
    this.neckMat.uniforms.uFlash.value = this.hurtFlash * 0.6

    // Mouth (world) for the fire stream.
    this.group.updateMatrixWorld(true)
    this.tmpA.set(0, 0, 0.95).applyEuler(this.head.rotation).add(this.head.position)
    this.rig.localToWorld(this.mouth.copy(this.tmpA))
    this.mouthDir.set(game.boss.aimX - this.mouth.x, -this.mouth.y, game.boss.aimZ - this.mouth.z).normalize()
    const mouthGlow = ph === 'breathCharge' ? clamp01(bt / 1.8) : ph === 'breath' ? 1 : 0
    this.mouthGlow.set(this.mouth.x, this.mouth.y, this.mouth.z, 0.6 + mouthGlow * 2.2, mouthGlow, 0)

    // Tail sway.
    for (let i = 0; i < 5; i++) {
      const k = i / 4
      this.tailPts[i]!.set(
        Math.sin(time * 1.6 - k * 2) * k * 0.6,
        this.body.position.y + 0.25 - k * 1.1 + Math.max(0, k - 0.6) * 0.8,
        -1.45 - k * 2.2
      )
    }
    for (let i = 0; i < 4; i++) this.tail[i]!.span(this.tailPts[i]!, this.tailPts[i + 1]!)

    // Wings: flap, spread for the roar, fold when broken.
    for (let s = 0; s < 2; s++) {
      const w = this.wings[s]!
      const limb: BossLimb = s === 0 ? 'wingL' : 'wingR'
      const f = fold(limb)
      const side = s === 0 ? -1 : 1
      const flapK = ph === 'roar' ? 1.6 : ph === 'breathCharge' ? 0.5 : 1
      const flap = Math.sin(time * 2.4 * flapK + s * 0.3) * 0.22
      const exposed = b.exposed === (s === 0 ? 2 : 3)
      w.position.y = this.body.position.y + 0.6
      w.rotation.set(-0.15 + f * 0.3, side * f * 1.35, side * -(flap + (exposed ? -0.35 : 0)) - side * f * 0.9)
      w.scale.set(1 - f * 0.45, 1, 1 - f * 0.2)
      const m = this.wingMats[s]!
      m.uniforms.uHighlight.value = exposed ? 1 : 0
      m.uniforms.uFlash.value = this.hurtFlash * 0.5
    }

    // Legs: two-bone chains to foot targets.
    for (const L of this.legs) {
      const f = L.limb ? fold(L.limb) : 0
      const exposed = L.limb && b.exposed === (L.limb === 'legFL' ? 0 : 1)
      // Hip rides the body.
      this.tmpA.copy(L.hip)
      this.tmpA.y += this.body.position.y - BODY_Y
      // Foot: planted; stomp lifts the front feet; broken legs fold back under.
      const foot = this.tmpB.copy(L.foot)
      if (L.front && ph === 'stomp') foot.y += lift * 1.2
      if (exposed) foot.z += 0.35
      if (f > 0) {
        foot.lerp(this.tmpC.set(L.hip.x * 1.1, 0.25, L.hip.z - 0.6), f)
      }
      this.solveLeg(L, this.tmpA, foot, f)
      L.mat.uniforms.uHighlight.value = exposed ? 1 : 0
      L.mat.uniforms.uFlash.value = this.hurtFlash * 0.6
    }

    // Weak-point anchors (world) and their glow.
    this.group.updateMatrixWorld(true)
    const anchorsLocal = [this.legs[0]!.knee, this.legs[1]!.knee]
    for (let i = 0; i < 2; i++) this.rig.localToWorld(this.anchors[i]!.copy(anchorsLocal[i]!))
    for (let s = 0; s < 2; s++) {
      const w = this.wings[s]!
      this.tmpA.set(s === 0 ? -2.6 : 2.6, 0.55, -0.15)
      w.localToWorld(this.anchors[2 + s]!.copy(this.tmpA))
    }
    this.rig.localToWorld(this.anchors[4]!.copy(this.neckPts[1]!).lerp(this.neckPts[2]!, 0.5))

    // Chest core gear.
    this.tmpA.set(0, this.body.position.y - 0.05, 1.15)
    this.rig.localToWorld(this.tmpA)
    const chestK = ph === 'breathCharge' ? 1 : ph === 'unfold' ? emerge : ph === 'collapse' ? 1 - col : 0.55
    this.chest.set(this.tmpA.x, this.tmpA.y, this.tmpA.z, 0.9 + chestK * 0.5, chestK * 0.9, time * 2.4)

    if (b.exposed >= 0 && ph === 'exposed') {
      const a = this.anchors[b.exposed]!
      const w = b.weakPoints[b.exposed]!
      const pulse = 0.8 + Math.sin(time * 8) * 0.2
      this.weakGlow.set(a.x, a.y, a.z, (1.1 + w.t * 0.8) * pulse, 0.95, time * (w.mode === 'core' ? 4 : 1.5))
      // Crease strip along the exposed leg.
      if (w.mode === 'crease') {
        const L = this.legs[b.exposed]!
        this.creaseStrip.visible = true
        const d = this.tmpA.subVectors(L.foot, L.knee)
        const len = d.length()
        this.creaseStrip.position.copy(L.knee)
        if (len > 1e-5) this.creaseStrip.quaternion.setFromUnitVectors(this.yAxis, d.multiplyScalar(1 / len))
        this.creaseStrip.scale.set(1.3, len, 1.3)
      } else this.creaseStrip.visible = false
    } else {
      this.weakGlow.set(0, 0, 0, 0, 0)
      this.creaseStrip.visible = false
    }
    this.creaseMat.uniforms.uEmissiveIntensity.value = 0.6 + Math.sin(time * 9) * 0.35
  }

  private solveLeg(L: Leg, hip: Vector3, foot: Vector3, fold: number): void {
    const upper = L.front ? 1.25 : 1.05
    const lower = L.front ? 1.25 : 1.0
    const d = this.sd.subVectors(foot, hip)
    const dist = Math.min(d.length(), upper + lower - 0.001)
    const dir = d.normalize()
    // Law of cosines for the knee angle; bend the knee outward and up (forward for front legs).
    const a = (upper * upper - lower * lower + dist * dist) / (2 * dist)
    const h = Math.sqrt(Math.max(0, upper * upper - a * a))
    const bendDir = this.sBend.set(L.side * 0.7, 0.55, L.front ? 0.45 - fold * 1.2 : -0.45).normalize()
    // Remove the component along the leg so the bend is perpendicular.
    bendDir.addScaledVector(dir, -bendDir.dot(dir)).normalize()
    L.knee.copy(hip).addScaledVector(dir, a).addScaledVector(bendDir, h)
    const footReal = this.sFoot.copy(hip).addScaledVector(dir, dist)
    L.thigh.span(hip, L.knee)
    L.shin.span(L.knee, footReal)
    L.claw.position.copy(footReal)
    L.claw.position.y = Math.max(0, footReal.y - 0.05)
    L.claw.rotation.y = L.side * 0.4
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh && !o.geometry.userData.shared) o.geometry.dispose()
    })
    for (const m of this.materials) m.dispose()
    this.chest.dispose()
    this.mouthGlow.dispose()
    this.weakGlow.dispose()
  }
}
