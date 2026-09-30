/**
 * The paper kraken (book 3, page 5; aethel-fold-GDD §13) — "scary but cute".
 *
 * Cute by its proportions and its face: a chunky rounded origami dome of a
 * head (few, large facets in soft pastel coral with teal spots), oversized
 * eyes with glossy deep-sea pupils and a paper highlight, heavy periwinkle
 * brows, a small pouty beak, stubby curling arms with rounded tips and rows
 * of suction cups. Menacing by scale, posture and telegraphs: it
 * bobs cheekily while it waits, then rears up huge, brows folded down into a
 * glare, eyes narrowed and glinting, before every attack; hurt, its brows
 * lift into a surprised, sad look and its eyes go wide.
 *
 * Built like the rest of the book: faceted paper in vertex colour, no
 * textures (the suction cups are little paper discs on the arms). Arms are point
 * chains — six points, five chunky segments with domed ends — posed each
 * frame from a few curves (raised and curling, lying flat across the page,
 * curled back when broken, the slam), so every move is a few lines of maths.
 *
 * Draw cost: the arms are two instanced meshes of one segment (every arm at
 * once, and the exposed arm again in a highlighted material, so the
 * actionable outline marks just that arm), plus the head, the face (eyes,
 * brows and beak, no shadow) and the crease strip — fewer draws than the
 * dragon's rig. Nothing allocates per frame (scratch vectors and `TMP`).
 *
 * The four front arms are the tentacle weak points (0…3, see `createBoss`);
 * the mantle's core is the fifth. `anchors` are their world points (the game
 * projects them onto the page for the gesture layer, like the dragon's), and
 * `mouth`/`mouthDir` are the beak the ink jet leaves from.
 */

import { Group, InstancedMesh, Mesh, Quaternion, Vector3, type BufferGeometry, type Scene } from 'three'
import type { FoldGame } from '../../logic/game'
import { KRAKEN } from '../../logic/config'
import { krakenClock } from '../../logic/kraken'
import { clamp01, easeOutBack } from '../../logic/math'
import { PaperBuilder, TMP, shade, type Col } from '../paperGeometry'
import { createPaperMaterial, type PaperMaterial } from '../paperMaterial'
import type { SpriteTextures } from '../art/spriteArt'
import { GlowSprite } from './Effects'
import { HEX } from '../palette'

/** Points per arm (five segments). */
const PTS = 6
const ARMS = 8
/** Front arms are the tentacle weak points. */
const FRONT = 4
/** Where the mantle's weak point (the core) sits, in the head's frame. */
const CORE = new Vector3(0, 1.55, 1.05)
/** Where the face sits on the head (its front, +z). */
const FACE_Y = 0.92
const FACE_Z = 1.34

type P3 = [number, number, number]

/**
 * One chunky arm segment along +y (unit length, unit radius): a hexagonal
 * tube with domed ends, so a chain of them reads as one soft, rounded arm
 * and its last segment ends in a rounded tip. Two opposite facets are the
 * pale belly with a row of suction cups — little folded paper discs (a coral
 * ring, a light centre) — built into the geometry, so the arms share the
 * props' instanced material variant (no texture, no new shader program).
 */
const armSegment = (): BufferGeometry => {
  const pb = new PaperBuilder()
  const n = 6
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2
    const a1 = ((i + 1) / n) * Math.PI * 2
    const p0: P3 = [Math.cos(a0), 0, Math.sin(a0)]
    const p1: P3 = [Math.cos(a1), 0, Math.sin(a1)]
    const q0: P3 = [Math.cos(a0) * 0.9, 1, Math.sin(a0) * 0.9]
    const q1: P3 = [Math.cos(a1) * 0.9, 1, Math.sin(a1) * 0.9]
    const belly = i === 1 || i === 4
    pb.quad(p0, q0, q1, p1, belly ? 'krakenSucker' : i % 2 ? 'kraken' : 'krakenLight')
    // Domed ends: a low cone over each end (rounded tips, soft joints).
    pb.tri(q0[0], 1, q0[2], 0, 1.32, 0, q1[0], 1, q1[2], i % 2 ? 'kraken' : shade('kraken', 0.94))
    pb.tri(p0[0], 0, p0[2], p1[0], 0, p1[2], 0, -0.32, 0, 'krakenDark')
    if (!belly) continue
    // Two suction cups on the belly facet, standing a hair proud of it.
    const am = (a0 + a1) / 2
    const nx = Math.cos(am)
    const nz = Math.sin(am)
    const tx = -nz
    const tz = nx
    for (const y of [0.3, 0.72]) {
      const r0 = Math.cos(Math.PI / n) * (1 - y * 0.1)
      for (const [rad, c, lift] of [[0.26, 'krakenDark', 0.02], [0.14, 'krakenLight', 0.035]] as const) {
        const ox = nx * (r0 + lift)
        const oz = nz * (r0 + lift)
        for (let k = 0; k < 6; k++) {
          const b0 = (k / 6) * Math.PI * 2
          const b1 = ((k + 1) / 6) * Math.PI * 2
          // Wound to face outward (along +n).
          pb.tri(
            ox, y, oz,
            ox + tx * Math.cos(b1) * rad, y + Math.sin(b1) * rad * 0.9, oz + tz * Math.cos(b1) * rad,
            ox + tx * Math.cos(b0) * rad, y + Math.sin(b0) * rad * 0.9, oz + tz * Math.cos(b0) * rad,
            c
          )
        }
      }
    }
  }
  return pb.build()
}

/** The head: a big rounded dome, a few large facets, teal spots on the crown. */
const headGeometry = (): BufferGeometry => {
  const b = new PaperBuilder()
  const sides = 7
  const rings: [number, number][] = [[1.2, 0], [1.44, 0.42], [1.42, 0.98], [1.2, 1.52], [0.78, 1.94], [0, 2.14]]
  for (let r = 0; r < rings.length - 1; r++) {
    const [r0, y0] = rings[r]!
    const [r1, y1] = rings[r + 1]!
    for (let i = 0; i < sides; i++) {
      // Turned half a facet so a flat face (not an edge) looks at the camera: the face sits on it.
      const a0 = ((i + 0.5) / sides) * Math.PI * 2
      const a1 = ((i + 1.5) / sides) * Math.PI * 2
      const c: Col = (i + r) % 2 ? 'kraken' : 'krakenLight'
      const p0: P3 = [Math.sin(a0) * r0, y0, Math.cos(a0) * r0]
      const p1: P3 = [Math.sin(a1) * r0, y0, Math.cos(a1) * r0]
      const p2: P3 = [Math.sin(a1) * r1, y1, Math.cos(a1) * r1]
      const p3: P3 = [Math.sin(a0) * r1, y1, Math.cos(a0) * r1]
      if (r1 > 0) b.quad(p0, p1, p2, p3, c)
      else b.tri(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], c)
    }
  }
  // Teal spots on the crown and the back: big soft diamonds lying on the facets.
  const spot = (a: number, y: number, r: number, s: number): void => {
    const x = Math.sin(a) * r
    const z = Math.cos(a) * r
    const tx = Math.cos(a) * s
    const tz = -Math.sin(a) * s
    b.quad([x - tx, y, z - tz], [x, y - s * 0.8, z], [x + tx, y, z + tz], [x, y + s * 0.8, z], 'krakenTeal')
  }
  spot(0.95, 1.35, 1.36, 0.2)
  spot(-0.95, 1.35, 1.36, 0.2)
  spot(2.2, 1.0, 1.46, 0.24)
  spot(-2.2, 1.0, 1.46, 0.24)
  spot(Math.PI, 1.5, 1.25, 0.26)
  return b.build()
}

/** One big eye facing +z: the white, a glossy deep-sea pupil, a paper highlight. */
const eyeGeometry = (): BufferGeometry => {
  const b = new PaperBuilder()
  const disc = (cx: number, cy: number, z: number, r: number, n: number, c: Col): void => {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2
      const a1 = ((i + 1) / n) * Math.PI * 2
      b.tri(cx, cy, z, cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, z, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, z, c)
    }
  }
  // The white, bulging a little toward its middle.
  for (let i = 0; i < 10; i++) {
    const a0 = (i / 10) * Math.PI * 2
    const a1 = ((i + 1) / 10) * Math.PI * 2
    b.tri(0, 0, 0.06, Math.cos(a0) * 0.38, Math.sin(a0) * 0.38, 0, Math.cos(a1) * 0.38, Math.sin(a1) * 0.38, 0, 'krakenEye')
  }
  disc(0, -0.05, 0.075, 0.23, 10, 'krakenPupil')
  disc(0.07, 0.05, 0.09, 0.075, 6, 'krakenEye')
  disc(-0.08, -0.14, 0.09, 0.035, 5, 'krakenEye')
  return b.build()
}

/** A heavy folded brow (a thick paper strip), centred on its middle. */
const browGeometry = (): BufferGeometry =>
  new PaperBuilder().push().translate(0, -0.075, 0).box(0.62, 0.15, 0.1, 'krakenBrow', shade('krakenBrow', 1.2)).pop().build()

/** A small pouty beak: a folded diamond pointing down. */
const beakGeometry = (): BufferGeometry => {
  const b = new PaperBuilder()
  b.tri(-0.15, 0, 0.02, 0.15, 0, 0.02, 0, 0.1, 0.1, 'krakenBeak')
  b.tri(-0.15, 0, 0.02, 0, -0.2, 0.08, 0.15, 0, 0.02, shade('krakenBeak', 0.85))
  b.tri(0.15, 0, 0.02, 0, -0.2, 0.08, 0, 0.1, 0.1, shade('krakenBeak', 0.92))
  b.tri(-0.15, 0, 0.02, 0, 0.1, 0.1, 0, -0.2, 0.08, 'krakenBeak')
  return b.build()
}

interface Arm {
  /** Base on the head (local), and the unit direction it reaches out in. */
  bx: number
  bz: number
  dx: number
  dz: number
  /** Resting target on the page (local) when it lies flat (front arms: the weak point's spot). */
  tx: number
  tz: number
  /** Eased 0…1: lying flat (exposed / slam), curled back (broken). */
  lay: number
  curl: number
  pts: Vector3[]
}

export class KrakenView {
  readonly group = new Group()
  private readonly rig = new Group()
  /** The head (leaning back a little) and its face. */
  private readonly head = new Group()
  private readonly face = new Group()
  private readonly headMesh: Mesh
  private readonly eyes: Mesh[] = []
  private readonly brows: Mesh[] = []
  private readonly beak: Mesh
  private readonly arms: Arm[] = []
  private readonly segs: InstancedMesh
  private readonly hotSegs: InstancedMesh
  private readonly bodyMat: PaperMaterial
  private readonly faceMat: PaperMaterial
  private readonly armMat: PaperMaterial
  private readonly hotMat: PaperMaterial
  private readonly creaseMat: PaperMaterial
  private readonly creaseStrip: Mesh
  private readonly beakGlow: GlowSprite
  private readonly weakGlow: GlowSprite
  private readonly materials: PaperMaterial[] = []
  /** World points of the weak points (four tentacles, then the mantle core). */
  readonly anchors: Vector3[] = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()]
  readonly mouth = new Vector3()
  readonly mouthDir = new Vector3(0, -0.2, 1)
  private readonly tmpA = new Vector3()
  private readonly dir = new Vector3()
  private readonly q = new Quaternion()
  private readonly yAxis = new Vector3(0, 1, 0)
  private hurtFlash = 0
  /** Eased 0…1 moods of the face: the glare (the attack telegraph) and hurt (surprised, sad). */
  private glare = 0
  private sad = 0
  private lastRev = -1

  constructor(sprites: SpriteTextures, overlay: Scene) {
    this.bodyMat = createPaperMaterial({ vertexColors: true, grain: 0.05 })
    this.faceMat = createPaperMaterial({ vertexColors: true, grain: 0.02 })
    this.armMat = createPaperMaterial({ vertexColors: true, grain: 0.04 })
    // The exposed arm drawn again in its own material: the actionable outline marks it alone.
    this.hotMat = createPaperMaterial({ vertexColors: true, grain: 0.04 })
    this.creaseMat = createPaperMaterial({ unlit: true, color: HEX.highlight, emissive: HEX.gear, emissiveIntensity: 0.8 })
    this.materials.push(this.bodyMat, this.faceMat, this.armMat, this.hotMat, this.creaseMat)
    this.group.position.set(KRAKEN.bodyX, 0, KRAKEN.bodyZ)
    this.group.add(this.rig)

    this.headMesh = new Mesh(headGeometry(), this.bodyMat)
    this.headMesh.castShadow = true
    this.head.add(this.headMesh)
    this.head.rotation.x = -0.26
    this.rig.add(this.head)

    // The face: two big eyes, heavy brows above them, a pouty beak below (no shadow: they sit on the head).
    this.face.position.set(0, FACE_Y, FACE_Z)
    this.head.add(this.face)
    const eyeGeo = eyeGeometry()
    const browGeo = browGeometry()
    for (const s of [-1, 1]) {
      const eye = new Mesh(eyeGeo, this.faceMat)
      eye.position.set(s * 0.46, 0.02, 0)
      eye.rotation.y = s * 0.22
      this.eyes.push(eye)
      const brow = new Mesh(browGeo, this.faceMat)
      brow.position.set(s * 0.46, 0.5, 0.08)
      brow.rotation.y = s * 0.22
      this.brows.push(brow)
      this.face.add(eye, brow)
    }
    this.beak = new Mesh(beakGeometry(), this.faceMat)
    this.beak.position.set(0, -0.42, 0.06)
    this.face.add(this.beak)

    const seg = armSegment()
    this.segs = new InstancedMesh(seg, this.armMat, ARMS * (PTS - 1))
    this.segs.castShadow = true
    this.segs.frustumCulled = false
    this.hotSegs = new InstancedMesh(seg, this.hotMat, PTS - 1)
    this.hotSegs.castShadow = true
    this.hotSegs.frustumCulled = false
    this.rig.add(this.segs, this.hotSegs)

    // Front arms reach for their weak-point spots; the back four fan out behind and to the sides.
    const front: [number, number][] = [[-2.3, -1.6], [2.3, -1.6], [-3.6, -2.5], [3.6, -2.5]]
    for (let i = 0; i < ARMS; i++) {
      let tx: number
      let tz: number
      if (i < FRONT) {
        tx = front[i]![0] - KRAKEN.bodyX
        tz = front[i]![1] - KRAKEN.bodyZ
      } else {
        const a = [-2.1, 2.1, -2.7, 2.7][i - FRONT]!
        tx = Math.sin(a) * 2.4
        tz = Math.cos(a) * 1.5
      }
      const len = Math.hypot(tx, tz) || 1
      const dx = tx / len
      const dz = tz / len
      const pts: Vector3[] = []
      for (let k = 0; k < PTS; k++) pts.push(new Vector3())
      this.arms.push({ bx: dx, bz: dz, dx, dz, tx, tz, lay: 0, curl: 0, pts })
    }

    this.creaseStrip = new Mesh(new PaperBuilder().box(0.09, 1, 0.09, 'highlight').build(), this.creaseMat)
    this.creaseStrip.visible = false
    this.rig.add(this.creaseStrip)

    this.beakGlow = new GlowSprite(sprites.glow, HEX.krakenLight, overlay)
    this.weakGlow = new GlowSprite(sprites.gear, HEX.gearGlow, overlay)
    this.group.visible = false
    this.group.userData.perfTag = 'fold.kraken'
  }

  update(game: FoldGame, time: number, dt: number): void {
    const b = game.boss
    const ph = b.phase
    if (b.kind !== 'kraken' || ph === 'flat') {
      this.group.visible = false
      this.beakGlow.set(0, 0, 0, 0, 0)
      this.weakGlow.set(0, 0, 0, 0, 0)
      return
    }
    this.group.visible = true
    // Authored seconds: a Kraken Rush plays the same moves, faster.
    const bt = krakenClock(b)
    if (b.rev !== this.lastRev) {
      if (ph === 'hurt') this.hurtFlash = 1
      this.lastRev = b.rev
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5)

    // Asleep only the eyes show above the water; surfacing, it rises out of the page.
    let rise = 1
    if (ph === 'dormant') rise = 0.3
    else if (ph === 'surface') rise = 0.3 + 0.7 * clamp01(bt / KRAKEN.surface)
    const arms = ph === 'dormant' ? 0 : ph === 'surface' ? easeOutBack(clamp01(bt / KRAKEN.surface), 1.4) : 1
    const col = ph === 'collapse' ? clamp01(b.collapse) : 0

    // The telegraph: it rears up big, glaring, before every attack (the ink charge, the slam's wind-up).
    const windUp = KRAKEN.slamAt * KRAKEN.slam
    let rear = 0
    if (ph === 'inkCharge') rear = clamp01(bt / 0.5)
    else if (ph === 'ink') rear = 1 - clamp01(bt / 0.5)
    else if (ph === 'slam') rear = bt < windUp ? clamp01(bt / 0.4) : 1 - clamp01((bt - windUp) / 0.3)
    else if (ph === 'roar') rear = Math.sin(clamp01(bt / KRAKEN.roar) * Math.PI)
    const ease = 1 - Math.exp(-dt * 9)
    const glareWant = ph === 'inkCharge' || (ph === 'slam' && bt < windUp) || ph === 'roar' ? 1 : 0
    const sadWant = ph === 'hurt' || ph === 'collapse' ? 1 : 0
    this.glare += (glareWant - this.glare) * ease
    this.sad += (sadWant - this.sad) * ease

    // A cheeky idle bob (squash and stretch), the rear-up, the collapse.
    const bob = Math.sin(time * 2.2)
    const grow = 1 + rear * 0.16
    this.rig.position.y = -2.3 * (1 - rise) + (0.06 + bob * 0.07) * rise + rear * 0.55
    this.rig.scale.set((1 + col * 0.3) * grow, Math.max(0.05, 1 - col * 0.94) * grow, (1 + col * 0.3) * grow)
    this.head.scale.set(1 - bob * 0.025, 1 + bob * 0.035, 1 - bob * 0.025)
    // (Hurt, it looks up at the camera, wide-eyed: the face tips toward the lens.)
    this.head.rotation.x = -0.26 - rear * 0.16 - this.sad * 0.2
    this.head.rotation.z = Math.sin(time * 1.1) * 0.05 * (1 - rear)
    this.bodyMat.uniforms.uFlash.value = this.hurtFlash * 0.6
    this.bodyMat.uniforms.uHighlight.value = b.exposed === 4 && ph === 'exposed' ? 1 : 0

    // The face: brows fold down into a glare (inner ends low) or lift into a sad, surprised look;
    // the eyes narrow when it glares, go wide when it hurts, and blink now and then.
    const blink = ph === 'dormant' ? 1 : time % 3.7 < 0.12 ? 0.15 : 1
    const narrow = 1 - this.glare * 0.42
    const wide = 1 + this.sad * 0.22
    const tilt = this.glare * 0.5 - this.sad * 0.45
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1
      this.eyes[s]!.scale.set(wide, Math.max(0.1, narrow * wide * blink), 1)
      const brow = this.brows[s]!
      // (+z rotation lifts the right end: the inner end of the left brow is its right end.)
      brow.rotation.z = -side * tilt
      brow.position.y = 0.5 - this.glare * 0.14 + this.sad * 0.12
    }
    // The beak pouts, and opens wide for the ink.
    const open = ph === 'inkCharge' ? 0.3 + clamp01(bt / 1.6) * 0.5 : ph === 'ink' ? 1 : 0
    this.beak.scale.set(1 + open * 0.2, 1 + open * 0.8 + Math.sin(time * 3) * 0.04, 1)
    this.faceMat.uniforms.uFlash.value = Math.max(this.hurtFlash * 0.5, this.glare * (0.25 + 0.2 * Math.sin(time * 14)))

    // Arms.
    const armEase = 1 - Math.exp(-dt * 8)
    let slamArm = -1
    if (ph === 'slam') {
      let bd = Infinity
      for (let i = 0; i < FRONT; i++) {
        if (b.weakPoints[i]!.broken) continue
        const d = Math.abs(this.arms[i]!.tx + KRAKEN.bodyX - b.aimX)
        if (d < bd) {
          bd = d
          slamArm = i
        }
      }
      if (slamArm < 0) slamArm = b.aimX < 0 ? FRONT : FRONT + 1
    }
    let n = 0
    let hot = 0
    for (let i = 0; i < ARMS; i++) {
      const a = this.arms[i]!
      const w = i < FRONT ? b.weakPoints[i]! : null
      const exposed = !!w && b.exposed === i && ph === 'exposed'
      const broken = !!w && w.broken
      const layWant = exposed ? 1 - (w ? w.t * 0.35 : 0) : i === slamArm ? (bt < windUp ? 0 : 1) : 0
      a.lay += (layWant - a.lay) * armEase
      const curlWant = broken ? 1 : exposed && w ? w.t * 0.5 : 0
      a.curl += (curlWant - a.curl) * (1 - Math.exp(-dt * (broken ? 5 : 12)))
      // Where a lying arm reaches: its spot, or the slam point.
      let tx = a.tx
      let tz = a.tz
      if (i === slamArm) {
        tx = b.aimX - KRAKEN.bodyX
        tz = KRAKEN.slamZ - KRAKEN.bodyZ
      }
      const lift = i === slamArm && bt < windUp ? clamp01(bt / windUp) : rear * 0.5
      this.poseArm(a, i, time, tx, tz, arms, lift)
      if (arms <= 0.001) continue
      const thick = (i < FRONT ? 0.36 : 0.3) * (1 - a.curl * 0.25)
      for (let k = 0; k < PTS - 1; k++) {
        const r = thick * (1 - k * 0.13)
        this.segment(this.segs, n++, a.pts[k]!, a.pts[k + 1]!, r)
        if (exposed) this.segment(this.hotSegs, hot++, a.pts[k]!, a.pts[k + 1]!, r * 1.05)
      }
    }
    // Park the unused instances.
    TMP.m.makeScale(0, 0, 0)
    for (let k = n; k < this.segs.count; k++) this.segs.setMatrixAt(k, TMP.m)
    for (let k = hot; k < this.hotSegs.count; k++) this.hotSegs.setMatrixAt(k, TMP.m)
    this.segs.instanceMatrix.needsUpdate = true
    this.hotSegs.instanceMatrix.needsUpdate = true
    this.hotMat.uniforms.uHighlight.value = hot > 0 ? 1 : 0
    this.armMat.uniforms.uFlash.value = this.hurtFlash * 0.6
    this.hotMat.uniforms.uFlash.value = this.hurtFlash * 0.6

    // Anchors (world): the middle of each front arm, and the mantle core.
    this.group.updateMatrixWorld(true)
    for (let i = 0; i < FRONT; i++) this.rig.localToWorld(this.anchors[i]!.copy(this.arms[i]!.pts[3]!))
    this.head.localToWorld(this.anchors[4]!.copy(CORE))

    // The beak (the ink jet's mouth).
    this.beak.localToWorld(this.mouth.set(0, -0.08, 0.12))
    this.mouthDir.set(b.aimX - this.mouth.x, -this.mouth.y, b.aimZ - this.mouth.z).normalize()
    const glow = ph === 'inkCharge' ? clamp01(bt / 1.6) : ph === 'ink' ? 1 : 0
    this.beakGlow.set(this.mouth.x, this.mouth.y, this.mouth.z, 0.5 + glow * 1.6, glow * 0.85, 0)

    // The exposed weak point: a glow, and a crease strip along a tentacle.
    if (b.exposed >= 0 && ph === 'exposed') {
      const anchor = this.anchors[b.exposed]!
      const w = b.weakPoints[b.exposed]!
      const pulse = 0.8 + Math.sin(time * 8) * 0.2
      this.weakGlow.set(anchor.x, anchor.y, anchor.z, (1.1 + w.t * 0.8) * pulse, 0.95, time * (w.mode === 'core' ? 4 : 1.5))
      if (w.mode === 'crease' && b.exposed < FRONT) {
        const a = this.arms[b.exposed]!
        const p0 = a.pts[1]!
        const p1 = a.pts[PTS - 2]!
        const d = this.tmpA.subVectors(p1, p0)
        const len = d.length()
        this.creaseStrip.visible = true
        this.creaseStrip.position.copy(p0)
        this.creaseStrip.position.y += 0.3
        if (len > 1e-5) this.creaseStrip.quaternion.setFromUnitVectors(this.yAxis, d.multiplyScalar(1 / len))
        this.creaseStrip.scale.set(1.4, len, 1.4)
      } else this.creaseStrip.visible = false
    } else {
      this.weakGlow.set(0, 0, 0, 0, 0)
      this.creaseStrip.visible = false
    }
    this.creaseMat.uniforms.uEmissiveIntensity.value = 0.6 + Math.sin(time * 9) * 0.35
  }

  /**
   * Pose one arm's chain (local): a blend of "raised, curling and waving" and
   * "lying flat to (tx, tz)" by `lay`, curled back toward the head by `curl`,
   * grown out of the head by `grow`, lifted high by `lift` (the wind-up).
   * Stubby: the raised arm reaches half its lying length and curls its tip up.
   */
  private poseArm(a: Arm, i: number, time: number, tx: number, tz: number, grow: number, lift: number): void {
    const reach = Math.hypot(tx - a.bx, tz - a.bz)
    const curl = a.curl
    const norm = 1 / Math.sin(Math.PI * 0.62)
    for (let k = 0; k < PTS; k++) {
      const u = k / (PTS - 1)
      // Raised: out along its direction, arching up, the tip curling over, waving.
      const wave = Math.sin(time * 2.1 + i * 1.7 + k * 0.9) * 0.22 * u
      const out = reach * 0.46 * Math.sin(u * Math.PI * 0.62) * norm
      const rx = a.bx + a.dx * out - a.dz * wave
      const rz = a.bz + a.dz * out + a.dx * wave
      const ry = 0.3 + Math.sin(u * Math.PI * 0.9) * (1.2 + lift * 1.4) + u * u * 0.5 + Math.sin(time * 1.7 + i + k) * 0.1 * u
      // Flat: a straight line on the page to the target, the tip curling up a little.
      const fx = a.bx + (tx - a.bx) * u
      const fz = a.bz + (tz - a.bz) * u
      const fy = 0.12 + Math.sin(u * Math.PI) * 0.1 + (u > 0.8 ? (u - 0.8) * 1.2 : 0)
      let x = rx + (fx - rx) * a.lay
      let y = ry + (fy - ry) * a.lay
      let z = rz + (fz - rz) * a.lay
      // Curled back (folded): pulled in toward the base and tucked up.
      if (curl > 0) {
        x += (a.bx + a.dx * 0.45 * u - x) * curl
        z += (a.bz + a.dz * 0.45 * u - z) * curl
        y += (0.4 + u * 0.55 - y) * curl
      }
      // Growing out of the head while it surfaces.
      a.pts[k]!.set(a.bx + (x - a.bx) * grow, 0.25 + (y - 0.25) * grow, a.bz + (z - a.bz) * grow)
    }
  }

  /** One instanced segment from p to q with cross-section radius r. */
  private segment(mesh: InstancedMesh, i: number, p: Vector3, q: Vector3, r: number): void {
    const d = this.dir.subVectors(q, p)
    const len = d.length()
    if (len > 1e-5) this.q.setFromUnitVectors(this.yAxis, d.multiplyScalar(1 / len))
    else this.q.identity()
    TMP.s.set(r, Math.max(0.001, len), r)
    TMP.m.compose(p, this.q, TMP.s)
    mesh.setMatrixAt(i, TMP.m)
  }

  dispose(): void {
    this.headMesh.geometry.dispose()
    this.eyes[0]?.geometry.dispose()
    this.brows[0]?.geometry.dispose()
    this.beak.geometry.dispose()
    this.segs.geometry.dispose()
    this.segs.dispose()
    this.hotSegs.dispose()
    this.creaseStrip.geometry.dispose()
    for (const m of this.materials) m.dispose()
    this.beakGlow.dispose()
    this.weakGlow.dispose()
  }
}
