import { describe, expect, it } from 'vitest'
import { type Bone, type BufferGeometry, Euler, Matrix4, Quaternion, Ray, Triangle, Vector3 } from 'three'
import {
  applyCarry,
  applyDraw,
  applyShield,
  DRAWABLE_KINDS,
  DRAWN_STATE_FOR,
  type DrawableKind,
  type DrawDirection,
  elbowStability,
  handoverWindow,
  resetElbowStability,
  transitionSeconds
} from '@/world/characters/combatPoses'
import { applyBank, applyGait, applyIdle, applyJump, RUN, WALK } from '@/world/characters/poses'
import { buildSkeleton } from '@/world/characters/skeleton'
import { buildChibiGeometry } from '@/world/characters/chibiGeometry'
import { gearModel } from '@/world/characters/gear'
import { BONE_NAMES, type BoneName } from '@/world/characters/rig'
import {
  DEFAULT_APPEARANCE,
  GRIP_ROTATION,
  type ItemKind,
  type Sex,
  SOCKETS,
  type SocketName,
  STOW_SOCKET
} from '@/world/characters/equipment'

/**
 * ─── Carrying, drawing and the handover ─────────────────────────────────────
 *
 * Three classes of failure, and only the first is obvious from a screenshot:
 *
 * 1. **The item teleports.** The reparent from the stow socket to the fist is
 *    only invisible if the *item's world transform is the same on both sides of
 *    it* — position and orientation. Asserted by composing both transforms and
 *    comparing them, rather than by checking that some hand is "near" some hip.
 * 2. **Something ticks.** A blend that is continuous but not smooth reads as a
 *    snap at exactly the frame the eye is on the hand. Asserted by sampling
 *    densely in time and bounding the per-frame change of every bone.
 * 3. **The legs move.** This layer writes to the arms and to nothing else. A
 *    single stray write to a hip would be invisible in a still and obvious in
 *    motion, so it is asserted bone-for-bone against an untouched gait.
 */

const rig = () => {
  const { byName, root } = buildSkeleton()
  root.updateMatrixWorld(true)
  return byName
}

const bone = (bones: Map<BoneName, Bone>, name: BoneName): Bone => {
  const found = bones.get(name)
  if (!found) {
    throw new Error(`missing bone ${name}`)
  }
  return found
}

const worldPosition = (bones: Map<BoneName, Bone>, name: BoneName, out = new Vector3()): Vector3 => {
  const target = bone(bones, name)
  target.updateWorldMatrix(true, false)
  return out.setFromMatrixPosition(target.matrixWorld)
}

/**
 * The world transform an item attached to `socket` would have.
 *
 * Deliberately recomputed here from `SOCKETS` rather than imported from the
 * poser: the test has to be able to disagree with the code it is testing.
 */
const socketTransform = (bones: Map<BoneName, Bone>, name: SocketName): Matrix4 => {
  const socket = SOCKETS[name]
  const parent = bone(bones, socket.bone)
  parent.updateWorldMatrix(true, false)
  const local = new Matrix4().compose(
    new Vector3(socket.position[0], socket.position[1], socket.position[2]),
    new Quaternion().setFromEuler(new Euler(socket.rotation[0], socket.rotation[1], socket.rotation[2], 'XYZ')),
    new Vector3(1, 1, 1)
  )
  return new Matrix4().multiplyMatrices(parent.matrixWorld, local)
}

/**
 * The world transform of an **item of `kind`** hung on `socket`.
 *
 * The socket alone stopped being the item's transform when `GRIP_ROTATION`
 * landed: `CharacterEquipment.place` composes the grip on top of the socket in a
 * hand and nowhere else, so a sword in the fist sits a quarter turn off the fist
 * itself. The handover test below has always claimed to compare *the item's*
 * transform on both sides of the reparent, and comparing bare sockets quietly
 * stopped being that — it would have passed with the blade flipping 90° at the
 * exact frame the eye is on it. Recomputed here from `SOCKETS` and
 * `GRIP_ROTATION` rather than imported from the poser, for the same reason as
 * above.
 */
const itemTransform = (bones: Map<BoneName, Bone>, name: SocketName, kind: ItemKind): Matrix4 => {
  const transform = socketTransform(bones, name)
  if (name !== 'handR' && name !== 'handL') {
    return transform
  }
  const grip = GRIP_ROTATION[kind]
  return transform.multiply(
    new Matrix4().makeRotationFromEuler(new Euler(grip[0], grip[1], grip[2], 'XYZ'))
  )
}

const drawnSocketOf = (kind: DrawableKind): SocketName => (kind === 'bow' ? 'handL' : 'handR')

const positionOf = (matrix: Matrix4): Vector3 => new Vector3().setFromMatrixPosition(matrix)
const rotationOf = (matrix: Matrix4): Quaternion => new Quaternion().setFromRotationMatrix(matrix)

const captureAll = (bones: Map<BoneName, Bone>): Quaternion[] =>
  BONE_NAMES.map(name => bone(bones, name).quaternion.clone())

/**
 * Bit-for-bit identical, not "close".
 *
 * `Quaternion.angleTo` is the obvious thing to reach for and it is wrong here:
 * it returns 3e-8 for a quaternion compared against its own twin, because
 * `setFromEuler` leaves the length a couple of ULPs short of one and the `acos`
 * amplifies it. Untouched means untouched, so the components are compared
 * directly and a stray write of any size at all fails.
 */
const expectUntouched = (a: Bone, b: Bone, label: string): void => {
  expect(a.quaternion.x, label).toBe(b.quaternion.x)
  expect(a.quaternion.y, label).toBe(b.quaternion.y)
  expect(a.quaternion.z, label).toBe(b.quaternion.z)
  expect(a.quaternion.w, label).toBe(b.quaternion.w)
}

const ARM_BONES: readonly BoneName[] = [
  'shoulder.L',
  'upperArm.L',
  'forearm.L',
  'hand.L',
  'shoulder.R',
  'upperArm.R',
  'forearm.R',
  'hand.R'
]

const BODY_BONES: readonly BoneName[] = BONE_NAMES.filter(name => !ARM_BONES.includes(name))

const DIRECTIONS: readonly DrawDirection[] = ['draw', 'sheathe']

// ── 1. The handover ─────────────────────────────────────────────────────────

describe('the drawing hand reaches the stow socket', () => {
  it('puts the item’s world transform on both sides of the reparent, to 2 mm and 3°', () => {
    // Sampled across the *whole* handover window and across gait phases,
    // because the socket rides the hips or the chest and both are moving: a
    // reach that only lands in a neutral stance is a reach that misses by
    // several centimetres at mid-stride, which is when a character draws.
    const bones = rig()
    let worstPosition = 0
    let worstAngle = 0

    for (const kind of DRAWABLE_KINDS) {
      const stow = STOW_SOCKET[kind]
      if (!stow) {
        throw new Error(`${kind} has no stow socket`)
      }
      for (const direction of DIRECTIONS) {
        const [from, to] = handoverWindow(kind, direction)
        for (let i = 0; i <= 6; i++) {
          const t = from + ((to - from) * i) / 6
          for (const phase of [0, 0.17, 0.33, 0.5, 0.71, 0.88]) {
            for (const effort of [0, 0.5, 1]) {
              applyGait(bones, phase, WALK, RUN, effort)
              applyDraw(bones, kind, t, direction, effort)

              const stowed = itemTransform(bones, stow, kind)
              const held = itemTransform(bones, drawnSocketOf(kind), kind)
              const gap = positionOf(stowed).distanceTo(positionOf(held))
              const angle = rotationOf(stowed).angleTo(rotationOf(held))
              worstPosition = Math.max(worstPosition, gap)
              worstAngle = Math.max(worstAngle, angle)
              expect(gap, `${kind} ${direction} t=${t.toFixed(2)} phase=${phase}`).toBeLessThan(0.002)
              expect(angle, `${kind} ${direction} t=${t.toFixed(2)} phase=${phase}`).toBeLessThan(0.052)
            }
          }
        }
      }
    }
    // Reported so a regression that merely *approaches* the tolerance is
    // visible in the run rather than only when it finally crosses it.
    expect(worstPosition).toBeLessThan(0.002)
    expect(worstAngle).toBeLessThan(0.052)
  })

  it('needs the shoulder girdle to close the hip draw, and records the margin', () => {
    // The solver saturates softly rather than snapping, so an unreachable
    // target fails *quietly*: the hand stops short and only the test above
    // notices. This records the margin, which is thin and worth knowing about.
    //
    // Measured on this rig: the arm is 0.4277 m shoulder-to-wrist and the solver
    // holds a 45 mm soft margin off that, so it can place a wrist 0.383 m out.
    //
    // The `hipR` wrist target used to reach 0.395 m at some phases of a run —
    // past that margin, and reachable only because the girdle leans into it
    // first. Moving the socket outboard and forward to free the hilt from the
    // hip (see `equipment.ts`) brought that to **0.362 m**, so the reach is now
    // inside the solver's own envelope and the girdle is a flourish rather than
    // the thing that closes it. The bounds below stayed: the upper one is still
    // the thing that would break, and the lower one records that this is a
    // near-full-extension reach rather than a comfortable one.
    const bones = rig()
    let worst = 0
    for (const kind of DRAWABLE_KINDS) {
      const stow = STOW_SOCKET[kind]!
      const side = kind === 'bow' ? 'L' : 'R'
      for (let i = 0; i < 24; i++) {
        applyGait(bones, i / 24, WALK, RUN, 1)
        const shoulder = worldPosition(bones, `upperArm.${side}` as BoneName)
        const stowed = socketTransform(bones, stow)
        const wrist = new Vector3(0, -0.02, 0.03)
          .applyQuaternion(rotationOf(stowed))
          .negate()
          .add(positionOf(stowed))
        worst = Math.max(worst, shoulder.distanceTo(wrist))
        // Inside the arm's actual length, with room for the girdle to make up
        // the rest. Past 0.42 no amount of shoulder saves it.
        expect(shoulder.distanceTo(wrist), `${kind} @ ${i}`).toBeLessThan(0.4)
      }
    }
    expect(worst).toBeGreaterThan(0.34)
  })
})

// ── 1b. The sheathed sword is outside the body ──────────────────────────────

/**
 * ─── Measuring a prop against the body it hangs on ──────────────────────────
 *
 * A socket table cannot be checked by reading it. `hipR`'s first numbers put the
 * sword's grip and pommel *inside* the hip — visible in one screenshot and in no
 * test, because every test asked about the sword's own transform and none of
 * them asked where the body was.
 *
 * So the body is skinned here, by hand, from the same bind pose and the same
 * weights the GPU uses, and the sword's vertices are measured against the
 * resulting triangles: nearest distance for the magnitude, ray parity for the
 * sign. It costs about a second and it is the only assertion in this file that
 * could have caught the defect.
 */

interface Soup {
  rest: Float32Array
  index: Uint32Array
  boneA: Uint16Array
  boneB: Uint16Array
  weightA: Float32Array
  weightB: Float32Array
}

const soupOf = (geometry: BufferGeometry): Soup => {
  const position = geometry.getAttribute('position')
  const skinIndex = geometry.getAttribute('skinIndex')
  const skinWeight = geometry.getAttribute('skinWeight')
  const source = geometry.getIndex()
  if (!source) {
    throw new Error('body geometry is not indexed')
  }
  const rest = new Float32Array(position.count * 3)
  const boneA = new Uint16Array(position.count)
  const boneB = new Uint16Array(position.count)
  const weightA = new Float32Array(position.count)
  const weightB = new Float32Array(position.count)
  for (let i = 0; i < position.count; i++) {
    rest[i * 3] = position.getX(i)
    rest[i * 3 + 1] = position.getY(i)
    rest[i * 3 + 2] = position.getZ(i)
    // Two influences is the whole of this rig's weighting — `chibiGeometry`
    // writes a bone and its neighbour and zeroes the other two.
    boneA[i] = skinIndex.getX(i)
    boneB[i] = skinIndex.getY(i)
    weightA[i] = skinWeight.getX(i)
    weightB[i] = skinWeight.getY(i)
  }
  const index = new Uint32Array(source.count)
  for (let i = 0; i < source.count; i++) {
    index[i] = source.getX(i)
  }
  return { rest, index, boneA, boneB, weightA, weightB }
}

const _skinPoint = new Vector3()
const _skinAccumulator = new Vector3()

const skinSoup = (soup: Soup, matrices: Matrix4[], out: Float32Array): void => {
  for (let i = 0; i < soup.boneA.length; i++) {
    _skinAccumulator.set(0, 0, 0)
    if (soup.weightA[i] !== 0) {
      _skinPoint
        .fromArray(soup.rest, i * 3)
        .applyMatrix4(matrices[soup.boneA[i]!]!)
        .multiplyScalar(soup.weightA[i]!)
      _skinAccumulator.add(_skinPoint)
    }
    if (soup.weightB[i] !== 0) {
      _skinPoint
        .fromArray(soup.rest, i * 3)
        .applyMatrix4(matrices[soup.boneB[i]!]!)
        .multiplyScalar(soup.weightB[i]!)
      _skinAccumulator.add(_skinPoint)
    }
    out[i * 3] = _skinAccumulator.x
    out[i * 3 + 1] = _skinAccumulator.y
    out[i * 3 + 2] = _skinAccumulator.z
  }
}

/**
 * Bind-pose-to-world matrices for one sampled pose, plus the bones themselves so
 * the socket can be read off the same rig that was skinned.
 */
const posedRig = (apply: (bones: Map<BoneName, Bone>) => void) => {
  const built = buildSkeleton()
  apply(built.byName)
  built.root.updateMatrixWorld(true)
  return {
    bones: built.byName,
    matrices: built.skeleton.bones.map((bone, i) =>
      new Matrix4().multiplyMatrices(bone.matrixWorld, built.skeleton.boneInverses[i]!)
    )
  }
}

/**
 * Every pose the sheathed sword has to survive.
 *
 * Bind, the breathing idle, a walk and a run at three bank angles each, and a
 * jump — 97 in all. Banks are included because a turn rolls the whole figure
 * about its travel axis and the hip goes with it, and the deepest penetration of
 * the old socket was at `run 10/12 bank −0.35`, which no unbanked sample reached.
 */
const CLEARANCE_POSES: { label: string; apply: (bones: Map<BoneName, Bone>) => void }[] = (() => {
  const list: { label: string; apply: (bones: Map<BoneName, Bone>) => void }[] = [
    { label: 'bind', apply: () => {} }
  ]
  for (let step = 0; step < 12; step++) {
    const phase = step / 12
    list.push({ label: `idle ${step}`, apply: bones => applyIdle(bones, step * 0.31) })
    list.push({ label: `jump ${step}/12`, apply: bones => applyJump(bones, phase) })
    for (const bank of [-0.35, 0, 0.35]) {
      list.push({
        label: `walk ${step}/12 bank ${bank}`,
        apply: bones => {
          applyGait(bones, phase, WALK, RUN, 0)
          applyBank(bones, bank)
        }
      })
      list.push({
        label: `run ${step}/12 bank ${bank}`,
        apply: bones => {
          applyGait(bones, phase, WALK, RUN, 1)
          applyBank(bones, bank)
        }
      })
    }
  }
  return list
})()

/**
 * Worst signed distance from any of an item's vertices to the body surface, over
 * every pose. Negative is inside.
 */
const worstClearance = (
  sex: Sex,
  vertices: readonly Vector3[]
): { signed: number; pose: string; against: string } => {
  const geometry = buildChibiGeometry(undefined, `clearance/${sex}`, { ...DEFAULT_APPEARANCE, sex }).geometry
  const soup = soupOf(geometry)
  const skinIndex = geometry.getAttribute('skinIndex')
  const triangleBone: string[] = []
  for (let f = 0; f < soup.index.length; f += 3) {
    triangleBone.push(BONE_NAMES[skinIndex.getX(soup.index[f]!)]!)
  }
  const posed = new Float32Array(soup.rest.length)

  const triangle = new Triangle()
  const closest = new Vector3()
  const ray = new Ray()
  const corner = [new Vector3(), new Vector3(), new Vector3()]
  const hit = new Vector3()
  const world = new Vector3()
  const socketMatrix = new Matrix4()
  const hip = SOCKETS.hipR
  const socketLocal = new Matrix4().compose(
    new Vector3(hip.position[0], hip.position[1], hip.position[2]),
    new Quaternion().setFromEuler(new Euler(hip.rotation[0], hip.rotation[1], hip.rotation[2], 'XYZ')),
    new Vector3(1, 1, 1)
  )

  // An arbitrary bearing, and it has to be arbitrary: an axis-aligned ray grazes
  // the ring edges of every limb at once and miscounts them all together.
  const BEARING = new Vector3(0.5121, 0.6042, 0.6104).normalize()

  const inside = (point: Vector3): boolean => {
    ray.origin.copy(point)
    ray.direction.copy(BEARING)
    let crossings = 0
    for (let f = 0; f < soup.index.length; f += 3) {
      corner[0]!.fromArray(posed, soup.index[f]! * 3)
      corner[1]!.fromArray(posed, soup.index[f + 1]! * 3)
      corner[2]!.fromArray(posed, soup.index[f + 2]! * 3)
      if (ray.intersectTriangle(corner[0]!, corner[1]!, corner[2]!, false, hit)) {
        crossings++
      }
    }
    return crossings % 2 === 1
  }

  let signed = Number.POSITIVE_INFINITY
  let pose = ''
  let against = ''
  for (const sample of CLEARANCE_POSES) {
    const built = posedRig(sample.apply)
    skinSoup(soup, built.matrices, posed)
    const hips = bone(built.bones, 'hips')
    hips.updateWorldMatrix(true, false)
    socketMatrix.multiplyMatrices(hips.matrixWorld, socketLocal)

    for (const vertex of vertices) {
      world.copy(vertex).applyMatrix4(socketMatrix)
      let nearest = Number.POSITIVE_INFINITY
      let nearestBone = '?'
      for (let f = 0; f < soup.index.length; f += 3) {
        triangle.a.fromArray(posed, soup.index[f]! * 3)
        triangle.b.fromArray(posed, soup.index[f + 1]! * 3)
        triangle.c.fromArray(posed, soup.index[f + 2]! * 3)
        triangle.closestPointToPoint(world, closest)
        const distance = closest.distanceTo(world)
        if (distance < nearest) {
          nearest = distance
          nearestBone = triangleBone[f / 3]!
        }
      }
      // The parity test is only paid for where it can change the answer.
      const value = nearest < 0.09 && inside(world) ? -nearest : nearest
      if (value < signed) {
        signed = value
        pose = sample.label
        against = nearestBone
      }
    }
  }
  return { signed, pose, against }
}

describe('the sheathed sword stands clear of the body', () => {
  const sword = gearModel('sword').geometry
  const swordPosition = sword.getAttribute('position')
  const all: Vector3[] = []
  const hilt: Vector3[] = []
  for (let i = 0; i < swordPosition.count; i++) {
    const vertex = new Vector3(swordPosition.getX(i), swordPosition.getY(i), swordPosition.getZ(i))
    all.push(vertex)
    // The *Griff*: grip and pommel. `gear/sword.ts` puts the guard's top at
    // y = −0.005 and the grip profile from −0.028 up to the pommel at +0.135, so
    // everything at or above the socket origin is hilt and nothing else is.
    if (vertex.y >= 0) {
      hilt.push(vertex)
    }
  }

  it('keeps the grip and the pommel proud of the hip, on both builds, in every pose', () => {
    // ── The numbers ─────────────────────────────────────────────────────────
    //
    // Before: −46.7 mm on the male build (deepest at `run 10/12 bank −0.35`,
    // against `thigh.R`) and −51.5 mm on the female one (`idle 1`, against the
    // hips). The female figure is the worse case because its hips are wider —
    // 0.163 × 0.9 = 147 mm half-width against the male's 0.15 × 0.85 = 127 —
    // and the old socket put the pommel's axis at x = −0.084.
    //
    // After: **+8.3 mm (male) and +9.1 mm (female)**. The margin asserted is
    // 5 mm, which leaves the measurement 3 mm of room to drift before this
    // fails; it is deliberately tight, because the thing it is guarding against
    // is a hilt that reads as sunk into the tunic, and that starts at zero.
    for (const sex of ['male', 'female'] as const) {
      const worst = worstClearance(sex, hilt)
      expect(worst.signed, `${sex} hilt worst at ${worst.pose} vs ${worst.against}`).toBeGreaterThan(0.005)
    }
  }, 60_000)

  it('keeps the blade out of the leg too, not just the hilt', () => {
    // The hilt is what was reported, but pushing it out is only a fix if the
    // blade does not pay for it: the reason the old cant was −0.35 rad about Z
    // was to swing the tip clear of `thigh.R`, and halving it puts the tip back
    // over the leg unless the socket moves outboard by as much as the cant gave
    // up. It does, and this is the assertion that says so — the worst point on
    // the *whole* sword is a hilt vertex, not a blade one.
    for (const sex of ['male', 'female'] as const) {
      const worst = worstClearance(sex, all)
      expect(worst.signed, `${sex} sword worst at ${worst.pose} vs ${worst.against}`).toBeGreaterThan(0.005)
    }
  }, 60_000)

  it('still hangs on the character’s right, tip down and trailing', () => {
    // +X is the character's *left* (`equipment.ts`), so a right-hip scabbard
    // lives entirely in negative x. This is the assertion that catches the whole
    // sword being mirrored, which looks deliberate until you notice the draw
    // reaches across the body.
    const bones = rig()
    applyGait(bones, 0.25, WALK, RUN, 0)
    const socket = socketTransform(bones, 'hipR')
    const at = (y: number): Vector3 => new Vector3(0, y, 0).applyMatrix4(socket)

    const pommel = at(0.135)
    const grip = at(0)
    const tip = at(-0.47)

    for (const [name, point] of [
      ['pommel', pommel],
      ['grip', grip],
      ['tip', tip]
    ] as const) {
      expect(point.x, `${name} on the right`).toBeLessThan(-0.1)
    }
    // Tip down, and *below* the grip by most of the blade's length.
    expect(tip.y).toBeLessThan(grip.y - 0.4)
    // Canted: the hilt forward of the tip, which is how a belt hangs a scabbard
    // and what keeps the tip out of the backswing of the leg.
    expect(pommel.z).toBeGreaterThan(tip.z + 0.1)
    // …and the pommel is outside the torso rather than over the belly. It still
    // leans *inboard* of the grip — the cant that swings the tip clear of the
    // thigh does that unavoidably, and halving it was only half the fix — but it
    // now leans inboard from far enough out that it stays outside: x = −0.164
    // measured, against −0.084 before, on a torso 127–147 mm wide at the hips.
    expect(pommel.x).toBeLessThan(-0.15)
    expect(pommel.x).toBeGreaterThan(grip.x)
  })
})

// ── 2. Continuity ───────────────────────────────────────────────────────────

/**
 * Runs a whole transition at 60 Hz with the gait advancing underneath, and
 * returns the largest angular step any bone took between two frames.
 */
const worstStep = (
  kind: DrawableKind,
  direction: DrawDirection,
  effort: number,
  onFrame?: (bones: Map<BoneName, Bone>, t: number) => void
): { arms: number; body: number } => {
  const bones = rig()
  const seconds = transitionSeconds(kind, direction)
  const frames = Math.ceil(seconds * 60)
  let previous: Quaternion[] | null = null
  let arms = 0
  let body = 0
  let phase = 0

  for (let frame = 0; frame <= frames; frame++) {
    const t = frame / frames
    // Distance-driven, as `Character` does it: the stride keeps running while
    // the hands are busy.
    phase = (phase + (1 / 60) * (0.95 + effort)) % 1
    applyGait(bones, phase, WALK, RUN, effort)
    applyDraw(bones, kind, t, direction, effort)
    onFrame?.(bones, t)

    const current = captureAll(bones)
    if (previous) {
      for (let i = 0; i < BONE_NAMES.length; i++) {
        const step = previous[i]!.angleTo(current[i]!)
        if (ARM_BONES.includes(BONE_NAMES[i]!)) {
          arms = Math.max(arms, step)
        } else {
          body = Math.max(body, step)
        }
      }
    }
    previous = current
  }
  return { arms, body }
}

describe('nothing ticks', () => {
  /**
   * Largest per-frame bone rotation each clip is *known* to reach, radians.
   *
   * Per kind, because they are not one problem. These came down when the hinge
   * axes were re-searched (see `elbowStability` below): measured worst arm step
   * across both directions and three speeds is now
   *
   *     sword 0.27 (16°)   greatsword 0.84 (48°)
   *     bow   1.86 (107°)  crossbow   1.32 (76°)
   *
   * against 0.3 / 1.9 / 2.0 / 2.45 before — the greatsword halved and the
   * crossbow nearly halved. The bow is the one that barely moved, and it is
   * still a recorded defect rather than a budget: 107° on one frame of a
   * 1.7 s clip is the elbow's bend plane turning over where the reach line is
   * closest to the hinge, and closing it needs the *path* re-shaped, not the
   * hinge re-aimed.
   */
  /**
   * ── Re-measured for the blade-up grip ─────────────────────────────────────
   *
   * `GRIP_ROTATION` moved three of these, in both directions, and the reason is
   * one sentence: the hand now has to *turn onto* the hilt. With every item
   * gripped in the scabbard's own frame the reach barely rotated the wrist at
   * all; a sword carried blade-up is gripped with the thumb pointing down the
   * blade, which is a quarter turn from where a swinging hand holds it, and that
   * quarter turn has to happen inside the reach.
   *
   * Measured worst arm step, both directions × five speeds, after the changes
   * that paid for it (the grip eased in across the reach rather than applied at
   * the first frame; the antipodal guard on `reachGripEased`'s orientation ease;
   * the greatsword's and crossbow's re-searched hinges):
   *
   *     sword 0.67 (38°)   greatsword 0.62 (36°)
   *     bow   0.41 (23°)   crossbow   0.81 (47°)
   *
   * against 0.27 / 0.84 / 1.86 / 1.32 before. Only the sword went up. The **bow
   * came down by a factor of four and a half** and the crossbow by nearly two:
   * their spikes were the elbow's bend plane turning over where the reach line is
   * closest to the hinge, and the antipodal guard is what removed both. The three
   * numbers that are now the *worst* on this rig are all under 40°, where the
   * first cut of these clips ran at 107°.
   */
  const KNOWN_WORST_STEP: Record<DrawableKind, number> = {
    sword: 0.75,
    greatsword: 0.75,
    bow: 0.55,
    crossbow: 0.95
  }

  it('keeps every arm bone inside its clip’s known worst step, all speeds', () => {
    // A magnitude bound, not a smoothness one -- smoothness is the jerk test
    // below. This exists to catch a *teleport*: a discontinuity in this layer
    // shows up as one frame of 40 degrees or more sitting between neighbours of
    // three.
    //
    // The ceiling is set by the honest worst case. An over-shoulder reach turns
    // most of the arm through half a turn, and the forearm's share includes the
    // pronation that carries the palm round onto the grip -- measured at
    // 19 deg/frame during the bow's reach, which is 1150 deg/s for about a fifth
    // of a second. The first cut of the clips ran that at 34 deg/frame; the fix
    // was to give the over-shoulder draws longer clips and a larger share of
    // them, not to raise the bound.
    for (const kind of DRAWABLE_KINDS) {
      for (const direction of DIRECTIONS) {
        for (const effort of [0, 0.5, 1]) {
          const { arms } = worstStep(kind, direction, effort)
          expect(arms, `${kind} ${direction} effort=${effort}`).toBeLessThan(KNOWN_WORST_STEP[kind])
        }
      }
    }
  })

  /**
   * Largest first and second difference of the grip's position over a clip
   * sampled at `frames` steps.
   */
  const gripDifferences = (
    kind: DrawableKind,
    direction: DrawDirection,
    frames: number
  ): { first: number; second: number } => {
    const bones = rig()
    const socket = drawnSocketOf(kind)
    const previous = new Vector3()
    let step = 0
    let previousStep = 0
    let first = 0
    let second = 0
    for (let frame = 0; frame <= frames; frame++) {
      applyGait(bones, 0.25, WALK)
      applyDraw(bones, kind, frame / frames, direction, 0)
      const grip = positionOf(socketTransform(bones, socket))
      if (frame > 0) {
        step = grip.distanceTo(previous)
        first = Math.max(first, step)
        if (frame > 1) {
          second = Math.max(second, Math.abs(step - previousStep))
        }
        previousStep = step
      }
      previous.copy(grip)
    }
    return { first, second }
  }

  it('has a grip path that is smooth, proven by refining the sampling', () => {
    // ── Why not simply bound the per-frame step ──────────────────────────────
    //
    // Because the bound would be a tuning constant, and it would pass for a
    // clip with a genuine discontinuity in it as long as the discontinuity was
    // smaller than the constant.
    //
    // Continuity has a sampling-rate signature instead, and it does not care
    // what the numbers are: refine the sampling 4× and a continuous path's
    // largest step falls by 4×, while a jump discontinuity's does not fall at
    // all. Differentiability shows in the second difference, which falls by 16×
    // for a C¹ path and stays put for a corner. Slack is left for the maximum
    // landing between samples.
    for (const kind of DRAWABLE_KINDS) {
      for (const direction of DIRECTIONS) {
        const coarse = gripDifferences(kind, direction, 60)
        const fine = gripDifferences(kind, direction, 240)
        const label = `${kind} ${direction}`
        // A jump discontinuity holds its size under refinement (ratio 1); a
        // corner halves its second difference each time the sampling doubles
        // (ratio 4 over 4×); a C¹ path drops by 16. The thresholds sit clear of
        // the first two and leave room for the maximum landing between samples.
        expect(fine.first, `${label} first`).toBeLessThan(coarse.first / 2.5)
        expect(fine.second, `${label} second`).toBeLessThan(coarse.second / 5)
      }
    }
  })

  it('keeps the grip at a speed a hand can actually move at', () => {
    // A smooth path can still be far too fast, and the refinement test above
    // would not notice. A person's sword hand peaks near 3.5 m/s in a draw; on
    // a 1.56 m figure that scales to about 2 m/s, which is 0.033 m in a 60 Hz
    // frame. The three over-shoulder draws are allowed 0.06–0.09 — 3.5 to 5 m/s
    // — and that is the same recorded defect as above rather than a considered
    // budget: the middle of those arcs is where the elbow is turning over, and
    // the hand goes with it.
    const limit: Record<DrawableKind, number> = {
      sword: 0.04,
      greatsword: 0.075,
      bow: 0.058,
      crossbow: 0.085
    }
    for (const kind of DRAWABLE_KINDS) {
      for (const direction of DIRECTIONS) {
        const frames = Math.ceil(transitionSeconds(kind, direction) * 60)
        const { first } = gripDifferences(kind, direction, frames)
        expect(first, `${kind} ${direction}`).toBeLessThan(limit[kind])
      }
    }
  })

  it('leaves the trunk and the legs to the gait, frame for frame', () => {
    for (const kind of DRAWABLE_KINDS) {
      for (const direction of DIRECTIONS) {
        const posed = rig()
        const bare = rig()
        const frames = 24
        for (let frame = 0; frame <= frames; frame++) {
          const t = frame / frames
          const phase = frame / 17
          applyGait(posed, phase, WALK, RUN, 0.6)
          applyDraw(posed, kind, t, direction, 0.6)
          applyGait(bare, phase, WALK, RUN, 0.6)
          for (const name of BODY_BONES) {
            expectUntouched(bone(posed, name), bone(bare, name), `${kind} ${name}`)
            expect(bone(posed, name).position.y, `${kind} ${name}`).toBe(bone(bare, name).position.y)
          }
        }
      }
    }
  })
})

describe('the elbow always knows which side it is on', () => {
  it('keeps the hinge square enough to the reach line, every clip', () => {
    // The one invariant the paths have to be authored against, and the one that
    // has broken most often. `elbowStability` is the sine of the angle between
    // the elbow's hinge axis and the line from shoulder to target: at 0 the bend
    // side is undefined and a hair either way puts the elbow above the arm or
    // below it. Every symptom of it looked like something else — a 0.43 m jump
    // in the grip, 157° of upper arm in a frame, a "blend" that was really a
    // geodesic flipping which way round it went.
    for (const kind of DRAWABLE_KINDS) {
      for (const direction of DIRECTIONS) {
        for (const effort of [0, 1]) {
          const bones = rig()
          let worst = 1
          let at = 0
          const frames = Math.ceil(transitionSeconds(kind, direction) * 60)
          for (let frame = 0; frame <= frames; frame++) {
            const t = frame / frames
            applyGait(bones, frame / 37, WALK, RUN, effort)
            resetElbowStability()
            applyDraw(bones, kind, t, direction, effort)
            if (elbowStability() < worst) {
              worst = elbowStability()
              at = t
            }
          }
          // ── Was 0.045, and 0.045 was a record of a defect ──────────────────
          //
          // The three over-shoulder draws used to sit at 0.38 (greatsword), 0.14
          // (crossbow) and **0.05** (bow) — sin 3°, an elbow whose side is
          // decided by rounding — against the sword's healthy 0.78. The
          // diagnosis was authoring: the hinge keys were chosen against a
          // standing character, and a running gait swings the reaching arm
          // through reach lines they are not square to.
          //
          // That is what was fixed. The nine hinge keys were re-searched against
          // the reach lines the clips *actually* produce — both directions,
          // three speeds, every frame — by coordinate ascent on this very
          // measure, each key anchored within 40° of its authored direction so
          // the elbow cannot quietly end up on the other side of the arm. The
          // authored axes were not far wrong in *kind*, only in aim.
          //
          //     sword 0.78 → 0.99    greatsword 0.17 → 0.64
          //     bow   0.07 → 0.62    crossbow   0.26 → 0.68
          //
          // 0.5 is sin 30°: comfortably conditioned, and low enough to leave the
          // paths room to be re-shaped without this becoming the thing that
          // fails first.
          //
          // ── And once more, when the grip rotations landed ──────────────────
          //
          // A grip rotation moves the *wrist* target — `reachGrip` subtracts the
          // 36 mm socket offset in the hand's own orientation — so it moves the
          // reach line the hinges were aimed against. The greatsword fell to
          // 0.467 and was re-searched by the same ascent; the crossbow's hinge
          // was re-aimed with it. Where it stands now:
          //
          //     sword 0.987   greatsword 0.749   bow 0.563   crossbow 0.673
          //
          // The bow is the one that went *down* (0.62 → 0.563) and it is the
          // only kind whose grip is a quarter turn with nothing else changed;
          // it is still sin 34°, and its worst arm step fell from 1.86 rad to
          // 0.41 over the same change.
          expect(worst, `${kind} ${direction} effort=${effort} @ ${at.toFixed(2)}`).toBeGreaterThan(0.5)
        }
      }
    }
  })
})

// ── 3. The ends of the clip ─────────────────────────────────────────────────

describe('a transition starts and ends where its neighbours are', () => {
  it('leaves the gait untouched at the stowed end', () => {
    for (const kind of DRAWABLE_KINDS) {
      const posed = rig()
      const bare = rig()
      // A draw begins stowed; a sheathe ends there.
      for (const [direction, t] of [
        ['draw', 0],
        ['sheathe', 1]
      ] as const) {
        applyGait(posed, 0.4, WALK, RUN, 0.5)
        applyDraw(posed, kind, t, direction, 0.5)
        applyGait(bare, 0.4, WALK, RUN, 0.5)
        for (const name of BONE_NAMES) {
          expectUntouched(bone(posed, name), bone(bare, name), `${kind} ${direction} ${name}`)
        }
      }
    }
  })

  it('lands exactly on the carry pose at the drawn end', () => {
    for (const kind of DRAWABLE_KINDS) {
      for (const [direction, t] of [
        ['draw', 1],
        ['sheathe', 0]
      ] as const) {
        const posed = rig()
        const carried = rig()
        applyGait(posed, 0.4, WALK, RUN, 0.5)
        applyDraw(posed, kind, t, direction, 0.5)
        applyGait(carried, 0.4, WALK, RUN, 0.5)
        applyCarry(carried, DRAWN_STATE_FOR[kind], 0.5)
        for (const name of BONE_NAMES) {
          expect(
            bone(posed, name).quaternion.angleTo(bone(carried, name).quaternion),
            `${kind} ${direction} ${name}`
          ).toBeLessThan(1e-6)
        }
      }
    }
  })
})

// ── 4. Carriage ─────────────────────────────────────────────────────────────

describe('carriage', () => {
  it('never writes to a leg, a hip or the spine', () => {
    const posed = rig()
    const bare = rig()
    for (const state of ['mainHand', 'twoHand', 'bow', 'crossbow'] as const) {
      for (let i = 0; i < 16; i++) {
        const phase = i / 16
        applyGait(posed, phase, WALK, RUN, 0.4)
        applyCarry(posed, state, 0.4)
        applyGait(bare, phase, WALK, RUN, 0.4)
        for (const name of BODY_BONES) {
          expectUntouched(bone(posed, name), bone(bare, name), `${state} ${name}`)
        }
      }
    }
  })

  it('damps the arm swing instead of leaving it or freezing it', () => {
    // Both failures are bugs. An undamped arm is the classic tell — a character
    // running with a drawn sword swinging like an empty-handed walk — and a
    // frozen one reads as a mannequin on rails.
    const swept = (carry: boolean): number => {
      const bones = rig()
      let min = Infinity
      let max = -Infinity
      for (let i = 0; i < 64; i++) {
        applyGait(bones, i / 64, RUN)
        if (carry) {
          applyCarry(bones, 'mainHand', 1)
        }
        const hand = worldPosition(bones, 'hand.R')
        const hips = worldPosition(bones, 'hips')
        min = Math.min(min, hand.z - hips.z)
        max = Math.max(max, hand.z - hips.z)
      }
      return max - min
    }
    const free = swept(false)
    const held = swept(true)
    expect(held).toBeLessThan(free * 0.45)
    expect(held).toBeGreaterThan(0.005)
  })

  it('keeps both hands on one haft as the body moves under them', () => {
    // Two hands on a greatsword that drift apart over a stride is the most
    // obvious possible tell, and it is what a second set of authored angles
    // gives you: they agree at the pose they were authored in and nowhere else.
    const bones = rig()
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < 48; i++) {
      applyGait(bones, i / 48, WALK, RUN, i / 48)
      applyCarry(bones, 'twoHand', i / 48)
      const left = positionOf(socketTransform(bones, 'handL'))
      const right = positionOf(socketTransform(bones, 'handR'))
      const gap = left.distanceTo(right)
      min = Math.min(min, gap)
      max = Math.max(max, gap)
    }
    // ── The authored spacing is 0.13 m, and it now falls 11 mm short ─────────
    //
    // Not slop: the support hand's target is measured **down the haft**, and the
    // haft is a quarter turn from where it used to be. With every item gripped
    // in the hand's own frame, `(0, 0.13, 0)` ran down the *forearm* and put the
    // second hand somewhere the arm was already near; down the real haft it sits
    // 0.467 m from the left shoulder against 0.4277 m of arm, so `softReach`
    // saturates for the whole cycle and the hand stops 119.4–123.6 mm from the
    // leading one.
    //
    // Left rather than closed, because the two things that would close it are
    // both worse. Shortening `HAFT_SPACING` moves the hands together on a haft
    // where a chibi fist is now 84 mm wide (see `chibiGeometry`'s `appendFist`),
    // and 119 mm of centres is already only a 35 mm gap between two fists.
    // Moving the leading hand means retuning `TWO_HAND_MAIN`, which the draw's
    // `turnAxis` is measured against. Measured on the arm itself, the cost of
    // leaving it is small: the left elbow stays 31° off straight at its worst,
    // so it reads as a reach and not as a locked arm.
    expect(min).toBeGreaterThan(0.118)
    expect(max).toBeLessThan(0.135)
  })

  it('tightens the elbow as the character speeds up', () => {
    const elbowAt = (effort: number): number => {
      const bones = rig()
      applyGait(bones, 0.25, WALK, RUN, effort)
      applyCarry(bones, 'mainHand', effort)
      return Math.abs(bone(bones, 'forearm.R').rotation.x)
    }
    expect(elbowAt(1)).toBeGreaterThan(elbowAt(0) + 0.25)
  })
})

// ── 5. The shield ───────────────────────────────────────────────────────────

describe('the shield', () => {
  /** Where the plate faces, in world space: the item's +Z through the hand. */
  const faceOf = (bones: Map<BoneName, Bone>): Vector3 =>
    new Vector3(0, 0, 1).applyQuaternion(rotationOf(socketTransform(bones, 'handL')))

  const posed = (effort: number, brace: number) => {
    const bones = rig()
    applyGait(bones, 0.25, WALK, RUN, effort)
    const residual = applyShield(bones, effort, brace)
    return { bones, residual }
  }

  it('faces the plate where it is aimed, within what the forearm allows', () => {
    // The roll can only sweep the plate's normal around a cone about the
    // forearm, so a residual here is the *arm* pose being wrong, not the wrist.
    for (const [effort, brace] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [0.5, 0.5]
    ] as const) {
      const { residual } = posed(effort, brace)
      expect(residual, `effort=${effort} brace=${brace}`).toBeLessThan(0.35)
    }
  })

  /** The board's long axis in world space: the item's −Y through the hand. */
  const axisOf = (bones: Map<BoneName, Bone>): Vector3 =>
    new Vector3(0, -1, 0).applyQuaternion(rotationOf(socketTransform(bones, 'handL')))

  it('hangs the board down the leg at rest instead of poking it out in front', () => {
    // The defect this replaces, and the reason it is measured as an *angle from
    // vertical* rather than eyeballed: the board is rigidly an extension of the
    // forearm (`gear/shield.ts` runs it along the item's ±Y, and `SOCKETS.handL`
    // is an identity rotation, so it trails the forearm by a fixed 17.5°). The
    // first cut of the carry poses folded the elbow to "tuck" the shield and
    // took the whole board with it: measured at 72° off vertical at a stand —
    // the plate lying nearly flat with its point half a metre out in front —
    // 110° at a run and 138° at a brace, which is upside down. Doing nothing at
    // all scored 20°, so the pose layer was making it worse.
    const down = new Vector3(0, -1, 0)
    const fromVertical = (bones: Map<BoneName, Bone>): number => axisOf(bones).angleTo(down)

    // Rest and every phase of a walk: the arm hangs, so the board hangs.
    for (let i = 0; i < 8; i++) {
      const bones = rig()
      applyGait(bones, i / 8, WALK, RUN, 0)
      applyShield(bones, 0, 0)
      // 13–19° measured across the cycle; the bound leaves room for the gait's
      // own shoulder swing without leaving room for a fold.
      expect(fromVertical(bones), `walk ${i}/8`).toBeLessThan(0.42)
    }
    // A run folds the elbow to tuck the plate in, and the board can only follow
    // the forearm — so it swings forward and down across the thigh. 24–38°
    // measured; past ~50° it reads as a plank held out in front.
    for (let i = 0; i < 8; i++) {
      const bones = rig()
      applyGait(bones, i / 8, WALK, RUN, 1)
      applyShield(bones, 1, 0)
      expect(fromVertical(bones), `run ${i}/8`).toBeLessThan(0.88)
    }
  })

  it('faces the plate outboard at rest and forward as it comes up', () => {
    // Not a preference — a consequence. The plate's normal is perpendicular to
    // the forearm, so a shield on a hanging arm faces *outward* and cannot be
    // made to face forward without cocking the wrist, which a strap does not
    // allow. It turns to the front only once the arm has come across the body.
    const walk = faceOf(posed(0, 0).bones)
    const run = faceOf(posed(1, 0).bones)
    const brace = faceOf(posed(0, 1).bones)

    // +X is the character's left, so a left-arm shield always faces outboard or
    // forward and never back across the body.
    for (const [name, face] of [
      ['walk', walk],
      ['run', run],
      ['brace', brace]
    ] as const) {
      expect(face.x, `${name} outboard`).toBeGreaterThan(-0.1)
    }
    expect(walk.x).toBeGreaterThan(0.8)
    expect(run.z).toBeGreaterThan(walk.z + 0.4)
    // ── Why this is 0.45 and not 0.8 ────────────────────────────────────────
    //
    // It was 0.8, and 0.8 was only reachable by a brace pose that pointed the
    // board straight up. The plate's normal is locked perpendicular to the
    // forearm *and* the board hangs past the hand along it, so squaring the
    // plate to the front while keeping it in front of the body needs the elbow
    // raised above the hand — and every arm pose that does that throws the
    // elbow wide: searched, the whole surviving family put the hand 0.42–0.51 m
    // off the chest's centreline, i.e. the shield flung out sideways.
    //
    // So the brace raises and *cants* instead: the plate's normal comes up and
    // forward (0.49 of +Z, measured) rather than squaring, which is the
    // riot-training cant that deflects into the ground. Squaring it properly is
    // a change to `gear/shield.ts` — see the note there in the report — not a
    // number that can be tuned here.
    expect(brace.z).toBeGreaterThan(0.45)
    expect(brace.z).toBeGreaterThan(walk.z + 0.3)
    // Up, not down: the cant is what makes it a deflection rather than a wall.
    expect(brace.y).toBeGreaterThan(0.4)
  })

  it('tucks in at a run and comes up to brace', () => {
    const walk = posed(0, 0)
    const run = posed(1, 0)
    const brace = posed(0, 1)

    const lateral = (bones: Map<BoneName, Bone>): number =>
      Math.abs(worldPosition(bones, 'hand.L').x - worldPosition(bones, 'chest').x)
    const height = (bones: Map<BoneName, Bone>): number =>
      worldPosition(bones, 'hand.L').y - worldPosition(bones, 'hips').y
    // The *world* bend, not `forearm.rotation.x`: the pose is rolled into place
    // by `aimByRoll` after the angles are written, and the Euler that comes back
    // out of the rolled quaternion no longer has the elbow in `x`.
    const elbow = (bones: Map<BoneName, Bone>): number => elbowBend(bones, 'L')

    // Running: closer to the body and the elbow folded harder — a plate on a
    // straight arm at running cadence is a lever nobody can hold still.
    expect(lateral(run.bones)).toBeLessThan(lateral(walk.bones))
    expect(elbow(run.bones)).toBeGreaterThan(elbow(walk.bones) + 0.5)
    expect(elbow(run.bones)).toBeLessThan(2.6)
    // Bracing: up, and folded harder still.
    expect(height(brace.bones)).toBeGreaterThan(height(walk.bones) + 0.1)
    expect(elbow(brace.bones)).toBeGreaterThan(elbow(walk.bones))
  })

  it('leaves the wrist alone — the strap does not let it move', () => {
    for (const [effort, brace] of [
      [0, 0],
      [1, 0],
      [0, 1]
    ] as const) {
      const { bones } = posed(effort, brace)
      const wrist = bone(bones, 'hand.L').rotation
      expect(Math.hypot(wrist.x, wrist.y, wrist.z), `effort=${effort}`).toBeLessThan(0.12)
    }
  })

  it('does not touch the legs or the right arm', () => {
    const withShield = rig()
    const bare = rig()
    for (let i = 0; i < 16; i++) {
      applyGait(withShield, i / 16, WALK, RUN, 0.5)
      applyShield(withShield, 0.5, 0)
      applyGait(bare, i / 16, WALK, RUN, 0.5)
      for (const name of [...BODY_BONES, 'shoulder.R', 'upperArm.R', 'forearm.R', 'hand.R'] as BoneName[]) {
        expectUntouched(bone(withShield, name), bone(bare, name), name)
      }
    }
  })

  it('moves continuously as effort and brace ramp', () => {
    // Two seconds at 60 Hz: effort ramps from a stand to a full run and the
    // brace comes up and down twice, which is faster than any caller would
    // drive it and therefore a fair worst case.
    const bones = rig()
    let previous: Quaternion[] | null = null
    let worst = 0
    for (let i = 0; i <= 120; i++) {
      const u = i / 120
      applyGait(bones, u, WALK, RUN, u)
      applyShield(bones, u, Math.max(0, Math.sin(u * Math.PI * 2)))
      const current = captureAll(bones)
      if (previous) {
        for (let b = 0; b < BONE_NAMES.length; b++) {
          worst = Math.max(worst, previous[b]!.angleTo(current[b]!))
        }
      }
      previous = current
    }
    expect(worst).toBeLessThan(0.14)
  })
})

// ── 6. Hygiene ──────────────────────────────────────────────────────────────

describe('hygiene', () => {
  it('is deterministic — two rigs, same inputs, identical bones', () => {
    const a = rig()
    const b = rig()
    for (const kind of DRAWABLE_KINDS) {
      for (const direction of DIRECTIONS) {
        for (let i = 0; i <= 20; i++) {
          const t = i / 20
          applyGait(a, t, WALK, RUN, 0.3)
          applyDraw(a, kind, t, direction, 0.3)
          applyGait(b, t, WALK, RUN, 0.3)
          applyDraw(b, kind, t, direction, 0.3)
          for (const name of BONE_NAMES) {
            const qa = bone(a, name).quaternion
            const qb = bone(b, name).quaternion
            expect(qa.x).toBe(qb.x)
            expect(qa.y).toBe(qb.y)
            expect(qa.z).toBe(qb.z)
            expect(qa.w).toBe(qb.w)
          }
        }
      }
    }
  })

  it('produces finite rotations everywhere, including past the ends of a clip', () => {
    const bones = rig()
    for (const kind of DRAWABLE_KINDS) {
      for (const direction of DIRECTIONS) {
        for (let i = -4; i <= 24; i++) {
          const t = i / 20
          applyGait(bones, i / 13, WALK, RUN, 0.8)
          applyDraw(bones, kind, t, direction, 0.8)
          applyShield(bones, 0.8, 0.2)
          for (const name of BONE_NAMES) {
            const q = bone(bones, name).quaternion
            expect(Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w), name).toBe(true)
            expect(Math.abs(q.length() - 1)).toBeLessThan(1e-5)
          }
        }
      }
    }
  })

  it('holds the elbow inside a human range through every clip', () => {
    // A solver will happily fold an elbow through itself to reach something.
    // Unsigned here on purpose — this is the *magnitude* limit, and the
    // direction is asserted separately below, because in a reach behind the
    // head the fold is nowhere near the sagittal plane and a signed sagittal
    // measure would report nonsense.
    for (const kind of DRAWABLE_KINDS) {
      for (const direction of DIRECTIONS) {
        const bones = rig()
        for (let i = 0; i <= 40; i++) {
          applyGait(bones, i / 40, WALK, RUN, 0.5)
          applyDraw(bones, kind, i / 40, direction, 0.5)
          for (const side of ['L', 'R'] as const) {
            const elbow = elbowBend(bones, side)
            // 145°, which is where `MIN_SPAN` puts the solver's floor. These
            // limbs are 50–62 mm thick; past this the forearm is inside the
            // upper arm.
            expect(elbow, `${kind} ${direction} ${side} @ ${i}`).toBeLessThan(2.56)
          }
        }
      }
    }
  })

  it('folds every posed elbow forwards, never backwards', () => {
    // The rule `arms.test.ts` exists to protect: an elbow folds the opposite way
    // to a knee. Read off the local rotation, where the sign is unambiguous —
    // and only for the arms this layer poses by angle. The support hand is
    // solved, and its fold direction is guaranteed by the pole vector instead.
    const posedByAngle: Record<string, readonly ('L' | 'R')[]> = {
      mainHand: ['R'],
      twoHand: ['R'],
      bow: ['L', 'R'],
      crossbow: ['R']
    }
    for (const state of ['mainHand', 'twoHand', 'bow', 'crossbow'] as const) {
      for (const effort of [0, 1]) {
        const bones = rig()
        for (let i = 0; i < 24; i++) {
          applyGait(bones, i / 24, WALK, RUN, effort)
          applyCarry(bones, state, effort)
          for (const side of posedByAngle[state]!) {
            expect(bone(bones, `forearm.${side}` as BoneName).rotation.x, `${state} ${side} @ ${i}`).toBeLessThan(0.002)
          }
        }
      }
    }
  })
})

/** Unsigned elbow bend: 0 is a straight arm, π is folded flat. */
const elbowBend = (bones: Map<BoneName, Bone>, side: 'L' | 'R'): number => {
  const upper = worldPosition(bones, `upperArm.${side}` as BoneName, new Vector3())
  const fore = worldPosition(bones, `forearm.${side}` as BoneName, new Vector3())
  const hand = worldPosition(bones, `hand.${side}` as BoneName, new Vector3())
  const upperDirection = new Vector3().subVectors(fore, upper).normalize()
  const foreDirection = new Vector3().subVectors(hand, fore).normalize()
  return Math.acos(Math.min(1, Math.max(-1, upperDirection.dot(foreDirection))))
}
