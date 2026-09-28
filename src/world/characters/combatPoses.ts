import type { Bone } from 'three'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { type DrawnState, GRIP_ROTATION, type ItemKind, SOCKETS, type SocketName, STOW_SOCKET } from './equipment'
import type { PoseTargets } from './poses'
import { boneDefinition, type BoneName } from './rig'

/**
 * ─── Carrying and drawing ───────────────────────────────────────────────────
 *
 * An **additive layer over `poses.ts`**. The gait owns the legs, the pelvis and
 * the trunk; everything here writes only to the arms — `shoulder`, `upperArm`,
 * `forearm`, `hand` — and it is applied *after* the gait so it overrides the arm
 * swing without ever touching a leg. Call order:
 *
 *     applyGait / applyIdle / applyJump
 *     applyBank
 *     applyCarry(bones, drawn, effort)          // arms are no longer free
 *     applyDraw(bones, kind, t, direction, …)   // only while transitioning
 *     applyShield(bones, effort, brace)         // left arm, wins over the above
 *
 * ── Why the arms cannot keep swinging ───────────────────────────────────────
 *
 * A character running with a drawn sword swinging its arms like an empty-handed
 * walk is the classic tell, and it is not fixed by *freezing* the arm either — a
 * held weapon still rides the cadence, it just rides a fraction of it. So the
 * carry poses do not discard the gait's arm curves, they **scale** them: the
 * authored angle is the base and `RESIDUAL_SWING` of whatever the gait left is
 * added on top. The cadence stays phase-locked to the feet for free, and there
 * is no second set of curves to keep in sync with the first.
 *
 * ── The hand actually reaches the grip ──────────────────────────────────────
 *
 * A draw is not a pose, it is a *handover*: at one instant the item stops being
 * a child of the stow bone and becomes a child of the hand. If the hand is not
 * exactly at the socket at that instant the sword teleports into the fist, which
 * is the single most visible failure this file exists to prevent — and a
 * hand-authored reach pose cannot prevent it, because the socket is on the hips
 * or the chest and those are being moved by the gait. Reaching the socket while
 * the pelvis lists 4° and the chest counter-rotates 14° means solving for it,
 * every frame, against the bone matrices the skeleton actually has.
 *
 * So the reach is **two-bone IK** (`reachGrip`), and the handover is exact in
 * *both* position and orientation:
 *
 *     hand.matrixWorld ∘ SOCKETS.handR   ==   stowBone.matrixWorld ∘ stowSocket
 *
 * which is precisely the condition for the item's world transform to be
 * unchanged by the reparent. Position alone is not enough: an item that keeps
 * its position and snaps 30° of roll is just as obviously wrong.
 *
 * ── The handover is a window, not a frame ───────────────────────────────────
 *
 * The clip's time warp holds the path parameter *exactly* at the grip for a
 * short plateau (`handoverWindow`), so `CharacterEquipment` may reparent on any
 * frame inside it rather than having to hit one. That plateau is also what makes
 * the path C¹ through the grip: the hand decelerates to a stop, the item changes
 * hands, and it accelerates away, which is what a real draw does anyway — the
 * fingers have to close.
 *
 * ── Nothing here allocates ──────────────────────────────────────────────────
 *
 * Module-level scratch only, and the socket table is baked into `Vector3`s and
 * `Quaternion`s once at load. `Bone.getWorldPosition`-style calls are avoided in
 * favour of `updateWorldMatrix(true, false)` plus reads, which is the same work
 * without the temporaries.
 */

// ─── Items that have a draw ─────────────────────────────────────────────────

/** The kinds with a stow socket *and* a hand to draw into. */
export type DrawableKind = 'sword' | 'greatsword' | 'bow' | 'crossbow'

export const DRAWABLE_KINDS: readonly DrawableKind[] = ['sword', 'greatsword', 'bow', 'crossbow']

export const isDrawable = (kind: ItemKind): kind is DrawableKind =>
  kind === 'sword' || kind === 'greatsword' || kind === 'bow' || kind === 'crossbow'

/**
 * ─── Pose families ──────────────────────────────────────────────────────────
 *
 * A weapon's **pose is a property of how it is held, not of what it is.** A
 * broadsword or a dagger would leave a hip scabbard into a one-handed guard
 * along the sword's arc; an axe would come over the shoulder into two hands
 * exactly as a greatsword does; a longbow is drawn like a bow.
 *
 * That distinction is what makes a new weapon cost nothing here. Every table
 * below this line is a `Record<DrawableKind, …>` — draw paths, hand turns,
 * handover windows, clip lengths, elbow hinges, off-hand joins, eight of them —
 * and the alternative to this map is a new row in each per weapon, for weapons
 * that move identically to ones that already exist. Worse, they would have had to be *re-tuned* against the
 * same measured constraints (`elbowStability`, the antipodal guard), and the
 * suite that guards those runs over `DRAWABLE_KINDS`, so the new rows would have
 * been unguarded.
 *
 * So the animation layer knows four kinds and always will. `ItemKind` is free to
 * grow, and this is the only place that has to notice.
 *
 * Null means "has no draw": a garment, a hat, a shield (which is never stowed),
 * a quiver.
 */
export const POSE_FAMILY: Record<ItemKind, DrawableKind | null> = {
  sword: 'sword',
  greatsword: 'greatsword',
  bow: 'bow',
  crossbow: 'crossbow',
  shield: null,
  hat: null,
  torsoArmour: null,
  robe: null,
  hoodedRobe: null,
  tabard: null,
  apronSmock: null,
  dress: null,
  pinafore: null,
  jerkin: null,
  roughTunic: null,
  mantle: null,
  wanderersCoat: null,
  coif: null,
  hood: null,
  flatCap: null,
  officialCap: null,
  helmet: null,
  hose: null,
  looseTrousers: null,
  plateLegs: null,
  rolledTrousers: null,
  tallBoots: null
}

/**
 * Which of the four motions carries this item, or null if it has none.
 *
 * The one accessor everything outside this file should use. `isDrawable` above
 * is kept because three suites narrow with it, but it answers the *narrower*
 * question — "is this one of the four base kinds" — and a caller that wants to
 * know whether an item can be drawn must ask this instead.
 */
export const poseFamilyOf = (kind: ItemKind): DrawableKind | null => POSE_FAMILY[kind]

/** The `DrawnState` a finished draw leaves the character in. */
export const DRAWN_STATE_FOR: Record<DrawableKind, DrawnState> = {
  sword: 'mainHand',
  greatsword: 'twoHand',
  bow: 'bow',
  crossbow: 'crossbow'
}

export type DrawDirection = 'draw' | 'sheathe'

/**
 * Clip lengths, seconds.
 *
 * **Sheathing is slower than drawing, always.** Drawing is a committed motion
 * with a target; stowing is a blind one that has to find the scabbard mouth, and
 * a sheathe played at draw speed reads as the blade being *thrown* at the hip.
 * The mass ordering is the other half: a greatsword coming off the back takes
 * half again as long as a hip sword.
 */
export const DRAW_SECONDS: Record<DrawableKind, number> = {
  sword: 0.78,
  greatsword: 1.9,
  bow: 1.7,
  crossbow: 1.6
}

export const SHEATHE_SECONDS: Record<DrawableKind, number> = {
  sword: 0.95,
  greatsword: 2.15,
  bow: 1.95,
  crossbow: 1.8
}

// ─── Small maths ────────────────────────────────────────────────────────────

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value)
const clampAbs = (value: number): number => (value < -1 ? -1 : value > 1 ? 1 : value)
const lerp = (from: number, to: number, w: number): number => from + (to - from) * w

/**
 * Smoothstep, clamped.
 *
 * Every weight and every path parameter in this file is built out of these and
 * nothing else, which is what makes the whole layer C¹ in time by construction:
 * a smoothstep has zero derivative at both ends, so windows can be butted
 * against each other without leaving a corner at the seam. A corner in a joint
 * angle is an infinite acceleration and it reads on screen as a tick at exactly
 * the moment the eye is on the hand.
 */
const smoothstep01 = (value: number): number => {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

/** A C¹ pulse: 0 at both ends of the window, 1 in the middle. */
const pulse01 = (value: number, from: number, to: number): number => {
  const s = smoothstep01((value - from) / (to - from))
  return 4 * s * (1 - s)
}

const UP = new Vector3(0, 1, 0)
const FORWARD = new Vector3(0, 0, 1)

// ─── The rig, measured once ─────────────────────────────────────────────────

interface ArmChain {
  /** Unit direction from the upper arm's head to the forearm's, in bind pose. */
  axis1: Vector3
  /** Unit direction from the forearm's head to the hand's, in bind pose. */
  axis2: Vector3
  length1: number
  length2: number
  /**
   * Inverse of each bone's **bind frame** — the basis whose Y is the bone's own
   * direction and whose X is a fixed perpendicular.
   *
   * The solve builds the same basis in world space and composes the two, which
   * is what makes it singularity-free. See `reachGrip`.
   */
  frame1: Quaternion
  frame2: Quaternion
}

const _frameBasis = new Matrix4()
const _frameX = new Vector3()
const _frameY = new Vector3()
const _frameZ = new Vector3()

/** The bind frame for a bone whose child lies along `axis`, inverted. */
const inverseBindFrame = (axis: Vector3): Quaternion => {
  // Y along the bone, back toward its parent, and X perpendicular to it and to
  // world forward. Well conditioned for every bone in this rig: no arm bone has
  // any z component in bind pose, so the cross product is never short.
  _frameY.copy(axis).negate()
  _frameX.copy(_frameY).cross(FORWARD).normalize()
  _frameZ.copy(_frameX).cross(_frameY)
  _frameBasis.makeBasis(_frameX, _frameY, _frameZ)
  return new Quaternion().setFromRotationMatrix(_frameBasis).invert()
}

const measureArm = (side: 'L' | 'R'): ArmChain => {
  const upper = boneDefinition(`upperArm.${side}` as BoneName).head
  const fore = boneDefinition(`forearm.${side}` as BoneName).head
  const hand = boneDefinition(`hand.${side}` as BoneName).head
  const axis1 = new Vector3(fore[0] - upper[0], fore[1] - upper[1], fore[2] - upper[2])
  const axis2 = new Vector3(hand[0] - fore[0], hand[1] - fore[1], hand[2] - fore[2])
  const length1 = axis1.length()
  const length2 = axis2.length()
  axis1.divideScalar(length1)
  axis2.divideScalar(length2)
  return {
    axis1,
    axis2,
    length1,
    length2,
    frame1: inverseBindFrame(axis1),
    frame2: inverseBindFrame(axis2)
  }
}

const ARM: Record<'L' | 'R', ArmChain> = { L: measureArm('L'), R: measureArm('R') }

/**
 * The socket table, baked.
 *
 * `SOCKETS` stores tuples so it stays readable and diffable; the poser needs
 * them as three objects and would otherwise rebuild them every frame.
 */
interface BakedSocket {
  bone: BoneName
  position: Vector3
  quaternion: Quaternion
}

const SOCKET_LOCAL: Record<SocketName, BakedSocket> = (() => {
  const out = {} as Record<SocketName, BakedSocket>
  const euler = new Euler()
  for (const name of Object.keys(SOCKETS) as SocketName[]) {
    const socket = SOCKETS[name]
    euler.set(socket.rotation[0], socket.rotation[1], socket.rotation[2], 'XYZ')
    out[name] = {
      bone: socket.bone,
      position: new Vector3(socket.position[0], socket.position[1], socket.position[2]),
      quaternion: new Quaternion().setFromEuler(euler)
    }
  }
  return out
})()

const HAND_SOCKET: Record<'L' | 'R', BakedSocket> = { L: SOCKET_LOCAL.handL, R: SOCKET_LOCAL.handR }

/**
 * `GRIP_ROTATION`, baked, with its inverse.
 *
 * ── The one thing that has to stay true across the handover ─────────────────
 *
 * An item in a fist sits at `hand · GRIP`, and an item in a scabbard sits at the
 * stow socket. The reparent is invisible only if those two world transforms are
 * equal on the frame it happens — so the reach cannot aim the hand *at* the
 * scabbard any more, it has to aim it at `stow · GRIP⁻¹`. Getting that backwards
 * does not fail a socket-to-socket comparison (both sockets still coincide); it
 * puts a quarter-turn flip in the sword at the exact frame the eye is on it.
 *
 * Everything downstream therefore distinguishes two frames that used to be one:
 * the **hand's** (what the solver poses) and the **item's** (what a haft, a
 * stock or a bowstring is measured along). `itemWorld` is the second.
 */
const GRIP_QUAT: Record<ItemKind, Quaternion> = (() => {
  const out = {} as Record<ItemKind, Quaternion>
  const euler = new Euler()
  for (const kind of Object.keys(GRIP_ROTATION) as ItemKind[]) {
    const grip = GRIP_ROTATION[kind]
    euler.set(grip[0], grip[1], grip[2], 'XYZ')
    out[kind] = new Quaternion().setFromEuler(euler)
  }
  return out
})()

const GRIP_INVERSE: Record<ItemKind, Quaternion> = (() => {
  const out = {} as Record<ItemKind, Quaternion>
  for (const kind of Object.keys(GRIP_QUAT) as ItemKind[]) {
    out[kind] = GRIP_QUAT[kind].clone().invert()
  }
  return out
})()

/** Which hand draws each kind, read off `DRAWN_SOCKET` rather than restated. */
const DRAW_SIDE: Record<DrawableKind, 'L' | 'R'> = {
  sword: 'R',
  greatsword: 'R',
  bow: 'L',
  crossbow: 'R'
}

// ─── Scratch ────────────────────────────────────────────────────────────────

const _root = new Vector3()
const _target = new Vector3()
const _wrist = new Vector3()
const _toTarget = new Vector3()
const _pole = new Vector3()
const _perp = new Vector3()
const _dir1 = new Vector3()
const _dir2 = new Vector3()
const _elbow = new Vector3()
const _normal = new Vector3()
const _axis = new Vector3()
const _projA = new Vector3()
const _projB = new Vector3()
const _cross = new Vector3()
const _grip = new Vector3()

const _qParent = new Quaternion()
const _qUpper = new Quaternion()
const _qFore = new Quaternion()
const _qHand = new Quaternion()
const _qWorld1 = new Quaternion()
const _qWorld2 = new Quaternion()
const _qSwing = new Quaternion()
const _qSocket = new Quaternion()
/** The item's frame, which is the hand's turned by `GRIP_ROTATION`. */
const _qItem = new Quaternion()
const _qRoll = new Quaternion()
const _qGirdle = new Quaternion()
const _qScratch = new Quaternion()

// ─── World-space reads ──────────────────────────────────────────────────────

/**
 * World transform of a socket.
 *
 * Everything downstream is expressed against this rather than against authored
 * world positions, so a change to `SOCKETS` moves the reach with it instead of
 * silently leaving the hand where the old table used to be.
 */
export const socketWorld = (
  bones: PoseTargets,
  name: SocketName,
  outPosition: Vector3,
  outQuaternion: Quaternion
): boolean => {
  const baked = SOCKET_LOCAL[name]
  const bone = bones.get(baked.bone)
  if (!bone) {
    return false
  }
  bone.updateWorldMatrix(true, false)
  outPosition.copy(baked.position).applyMatrix4(bone.matrixWorld)
  outQuaternion.setFromRotationMatrix(bone.matrixWorld).multiply(baked.quaternion)
  return true
}

/** World transform of a hand's grip socket — the **hand's** frame, not the item's. */
export const gripWorld = (
  bones: PoseTargets,
  side: 'L' | 'R',
  outPosition: Vector3,
  outQuaternion: Quaternion
): boolean => socketWorld(bones, side === 'L' ? 'handL' : 'handR', outPosition, outQuaternion)

/**
 * World transform of the **item** a hand is holding: the grip socket turned by
 * that kind's `GRIP_ROTATION`.
 *
 * The frame a haft, a stock or a bowstring is measured in. Since
 * `GRIP_ROTATION` is a pure rotation the position is the grip's own — only the
 * orientation differs, and it differs by a quarter turn on three of the four
 * drawables, which is the difference between a support hand on the haft and one
 * a hand's width off it in mid-air.
 */
export const itemWorld = (
  bones: PoseTargets,
  side: 'L' | 'R',
  kind: ItemKind,
  outPosition: Vector3,
  outQuaternion: Quaternion
): boolean => {
  if (!gripWorld(bones, side, outPosition, outQuaternion)) {
    return false
  }
  outQuaternion.multiply(GRIP_QUAT[kind])
  return true
}

/** Rotates a direction authored in the chest's frame into world space. */
const torsoDirection = (bones: PoseTargets, x: number, y: number, z: number, out: Vector3): Vector3 => {
  const chest = bones.get('chest')
  out.set(x, y, z)
  if (chest) {
    chest.updateWorldMatrix(true, false)
    _qScratch.setFromRotationMatrix(chest.matrixWorld)
    out.applyQuaternion(_qScratch)
  }
  return out.normalize()
}

/** Offsets a world point by a vector authored in the chest's frame. */
const addTorsoOffset = (bones: PoseTargets, point: Vector3, x: number, y: number, z: number, scale: number): void => {
  if (scale === 0) {
    return
  }
  const chest = bones.get('chest')
  _perp.set(x, y, z)
  if (chest) {
    chest.updateWorldMatrix(true, false)
    _qScratch.setFromRotationMatrix(chest.matrixWorld)
    _perp.applyQuaternion(_qScratch)
  }
  point.addScaledVector(_perp, scale)
}

// ─── Two-bone IK ────────────────────────────────────────────────────────────

/**
 * How close to full extension the solver is allowed to get, as a fraction.
 *
 * Not a hard clamp. At full extension the elbow angle's derivative with respect
 * to the target distance is infinite, so a target creeping past the arm's reach
 * makes the elbow snap straight over one frame. The distance is therefore
 * *softly* saturated (see `softReach`), which is C¹ everywhere and simply lets
 * the hand fall short of an unreachable target — the honest failure.
 *
 * ── 45 mm → 35 mm, and the 10 mm is measured ────────────────────────────────
 *
 * The margin is what the hand falls short *by* on a reach at the edge of the
 * envelope, and `GRIP_ROTATION` moved that edge: `reachGrip` places the wrist one
 * grip-offset short of the target **in the hand's own orientation**, so turning
 * an item a quarter turn in the fist swings that 36 mm offset to a different
 * place and the greatsword's over-shoulder reach got longer by it. Measured at
 * the handover, at a run, mid-stride: the item moved **4.54 mm** across the
 * reparent at 45 mm of margin, against a 2 mm budget. 35 mm brings it to
 * **1.79 mm** and nothing else moves — `elbowStability` is 0.987 / 0.749 /
 * 0.563 / 0.673 and the worst arm step 0.67 / 0.62 / 0.41 / 1.32 rad either way,
 * to three figures. Going further does keep helping (30 mm gives 0.72 mm) and
 * was not taken: the whole point of the margin is to stay off the singularity,
 * and 35 mm is the least that buys back the budget.
 */
const SOFT_MARGIN = 0.035


/**
 * How close the wrist may come to the shoulder, metres.
 *
 * The geometric limit is |l1 − l2| = 30 mm, which is the elbow folded flat.
 * 0.132 m is the elbow at 145°, and it is the real limit here: these limbs are
 * 50–62 mm thick, so a fold past that puts the forearm inside the upper arm —
 * measured at 157° on the bow's reach before this floor existed. It cannot go
 * higher: `backOver` sits 0.228 m from the shoulder, so a floor much above
 * 0.15 m would stop the hand reaching the greatsword's own hilt.
 */
const MIN_SPAN = 0.132

/**
 * Saturates the solve distance at both ends, smoothly.
 *
 * Not a clamp. At either limit the elbow angle's derivative with respect to the
 * target distance is infinite, so a target creeping past the arm's reach makes
 * the elbow snap straight — or fold flat — over a single frame. The exponential
 * has value and slope matching the identity at the handover point, so the whole
 * function is C¹ and simply lets the hand fall short of an impossible target,
 * which is the honest failure.
 */
const softReach = (distance: number, max: number): number => {
  const ceiling = max - SOFT_MARGIN
  if (distance > ceiling) {
    return max - SOFT_MARGIN * Math.exp(-(distance - ceiling) / SOFT_MARGIN)
  }
  const floor = MIN_SPAN + SOFT_MARGIN
  if (distance < floor) {
    return MIN_SPAN + SOFT_MARGIN * Math.exp((distance - floor) / SOFT_MARGIN)
  }
  return distance
}

/** How much of the angular error to the target the shoulder girdle takes up. */
const GIRDLE_GAIN = 0.42
/** …and the most it may rotate. Roughly the real scapula's range. */
const GIRDLE_LIMIT = 0.42

const _girdleRoot = new Vector3()
const _girdleTip = new Vector3()
const _girdleAxis = new Vector3()

/**
 * Leans the shoulder girdle toward whatever the hand is reaching for.
 *
 * ── Not a flourish: without it the hip socket is out of reach ───────────────
 *
 * Measured on this rig: the arm is 0.428 m from the shoulder to the wrist, and
 * the `hipR` socket sits up to 0.395 m from the shoulder at some phases of a
 * run — inside the envelope by 8 %, which the solver's soft saturation eats.
 * The hand ends up 2 mm short of the hilt, which is 2 mm of daylight between a
 * fist and a sword at the exact frame they are supposed to be one object.
 *
 * A real body does not reach with the arm alone either. The scapula protracts
 * and depresses toward anything at the edge of reach, and it is the first thing
 * to move, not the last — an arm that extends from a rigid shoulder is the pose
 * a mannequin makes. Gain and limit are both modest, so this reads as the
 * shoulder *leading* the reach rather than as the torso lunging.
 */
const assistGirdle = (shoulder: Bone, upper: Bone, target: Vector3, weight: number): void => {
  upper.updateWorldMatrix(true, false)
  _girdleTip.setFromMatrixPosition(upper.matrixWorld)
  _girdleRoot.setFromMatrixPosition(shoulder.matrixWorld)
  _qGirdle.setFromRotationMatrix(shoulder.matrixWorld)

  _dir1.copy(_girdleTip).sub(_girdleRoot)
  _dir2.copy(target).sub(_girdleRoot)
  const currentLength = _dir1.length()
  const targetLength = _dir2.length()
  if (currentLength < 1e-6 || targetLength < 1e-6) {
    return
  }
  _dir1.divideScalar(currentLength)
  _dir2.divideScalar(targetLength)

  _girdleAxis.copy(_dir1).cross(_dir2)
  const sine = _girdleAxis.length()
  if (sine < 1e-6) {
    return
  }
  _girdleAxis.divideScalar(sine)
  // Saturated with a tanh rather than clamped. `Math.min` here is a corner in
  // the shoulder's position, and the hand hangs off the shoulder, so it is a
  // corner in the grip's path — invisible in a still, and the reason the
  // greatsword's draw failed a sampling-refinement test while passing every
  // bound anyone would think to write.
  // Faded out where the axis is ill-conditioned. `sine` is small both when the
  // girdle is already pointing at the target — where there is nothing to do —
  // and when it is pointing *away* from it, where the axis to swing about is
  // whichever way the numbers fall and flips between frames. Measured before
  // this: 43° of girdle in one frame, mid-draw.
  const authority = smoothstep01(sine / 0.45)
  const angle = Math.atan2(sine, _dir1.dot(_dir2)) * GIRDLE_GAIN * weight * authority
  _qSwing.setFromAxisAngle(_girdleAxis, GIRDLE_LIMIT * Math.tanh(angle / GIRDLE_LIMIT))

  // The swing is in world space and the bone's rotation is local, so it is
  // conjugated into the bone's own frame and applied on the right — which
  // composes it *after* the girdle motion the gait already put there rather
  // than replacing it.
  _qScratch.copy(_qGirdle).invert().multiply(_qSwing).multiply(_qGirdle)
  shoulder.quaternion.multiply(_qScratch)
}

/**
 * Puts a hand's **grip socket** on `target` with the hand at `handWorld`, then
 * blends the result over whatever pose is already on the bones by `weight`.
 *
 * ── Why the grip and not the wrist ──────────────────────────────────────────
 *
 * The item hangs off the grip socket, 36 mm from the wrist. Solving for the
 * wrist and hoping leaves the item that far out of the scabbard, which at chibi
 * scale is a fifth of the hand. Because the hand's world orientation is an
 * *input* here rather than a result, the grip offset is known before the solve
 * and can simply be subtracted — the answer is exact in one pass, with no
 * iteration and no residual.
 *
 * ── Why quaternions here and Euler in the carry poses ───────────────────────
 *
 * The carry poses are authored joint angles a few degrees from the gait's, and
 * `poses.ts`'s reasoning applies: single dominant axis, close poses, Euler is
 * cheaper and reads better in source. A reach behind the head is neither — it
 * is 120° of elbow and a large shoulder swing, and lerping *that* in Euler is
 * not the shortest path between the two orientations. It bulges visibly on the
 * way through. So the solve produces quaternions and blends with `slerp`.
 */
const reachGrip = (
  bones: PoseTargets,
  side: 'L' | 'R',
  target: Vector3,
  hinge: Vector3,
  handWorld: Quaternion,
  weight: number
): void => {
  if (weight <= 0) {
    return
  }
  const chain = ARM[side]
  const upper = bones.get(`upperArm.${side}` as BoneName)
  const fore = bones.get(`forearm.${side}` as BoneName)
  const hand = bones.get(`hand.${side}` as BoneName)
  const shoulder = bones.get(`shoulder.${side}` as BoneName)
  if (!upper || !fore || !hand || !shoulder) {
    return
  }

  // The wrist target, needed before the girdle can be aimed at it.
  _wrist.copy(HAND_SOCKET[side].position).applyQuaternion(handWorld)
  _wrist.negate().add(target)
  assistGirdle(shoulder, upper, _wrist, weight)

  // Ancestors only: the arm's own children are about to be overwritten, so
  // updating them here would be work thrown away.
  upper.updateWorldMatrix(true, false)
  _root.setFromMatrixPosition(upper.matrixWorld)
  _qParent.setFromRotationMatrix(shoulder.matrixWorld)

  // The wrist has to land one grip-offset short of the target, measured in the
  // orientation the hand is going to end up in — computed above, before the
  // girdle moved, and unaffected by it.
  _toTarget.copy(_wrist).sub(_root)
  const raw = _toTarget.length()
  if (raw < 1e-6) {
    return
  }
  const l1 = chain.length1
  const l2 = chain.length2
  const distance = softReach(raw, l1 + l2)
  _toTarget.divideScalar(raw)

  // Law of cosines for the shoulder's half-angle between the target line and
  // the upper arm.
  const cosine = clampAbs((l1 * l1 + distance * distance - l2 * l2) / (2 * l1 * distance))
  const alpha = Math.acos(cosine)

  // ── The elbow's side, from a hinge axis rather than a pole ────────────────
  //
  // The usual formulation gives the solver a *pole vector* — a direction the
  // elbow should lean toward — and takes its component perpendicular to the
  // reach line. That component vanishes, and then reverses, whenever the reach
  // line sweeps past the pole, and an over-shoulder draw sweeps its reach line
  // through a right angle: up behind the head at the grip, forward and down at
  // the guard. Measured with a fixed pole: |cos| between the two reached 0.99
  // mid-draw and the elbow snapped to the other side of the arm, jumping the
  // grip 0.43 m in one frame. Interpolating between two poles moved the crossing
  // rather than removing it.
  //
  // A **hinge axis** — the elbow's own flexion axis, which is roughly
  // medio-lateral on a real arm — has no such crossing: the elbow side is
  // `hinge × line`, which is perpendicular to the line for free and only
  // degenerates if the arm reaches straight along its own hinge, i.e. sideways
  // through its own elbow. The authored axes below stay within 30° of the
  // character's lateral axis, so it never comes close.
  _perp.copy(hinge).cross(_toTarget)
  // Both operands are unit, so this length is the sine of the angle between the
  // hinge and the reach line: 1 when the elbow's axis is square to the reach and
  // 0 when the arm is reaching along its own hinge, where which side the elbow
  // falls on is undefined and flips between frames. Recorded rather than
  // guarded, because there is no continuous way to guard it — see
  // `elbowStability`.
  _stability = Math.min(_stability, _perp.length())
  if (_perp.lengthSq() < 1e-8) {
    _perp.copy(UP).cross(_toTarget)
    if (_perp.lengthSq() < 1e-8) {
      _perp.copy(FORWARD).cross(_toTarget)
    }
  }
  _perp.normalize()

  _dir1.copy(_toTarget).multiplyScalar(Math.cos(alpha)).addScaledVector(_perp, Math.sin(alpha))
  _elbow.copy(_root).addScaledVector(_dir1, l1)
  _dir2.copy(_root).addScaledVector(_toTarget, distance).sub(_elbow)
  const reach2 = _dir2.length()
  if (reach2 < 1e-6) {
    return
  }
  _dir2.divideScalar(reach2)

  // ── Frames, not swings ────────────────────────────────────────────────────
  //
  // Each bone's orientation is built as a whole basis: **Y** back along the bone
  // and **X** along the bend plane's normal. Composed with the inverse of the
  // same basis taken in bind pose, that is the bone's world rotation, and the
  // twist about the bone comes out of the bend plane rather than being left
  // undetermined.
  //
  // The obvious alternative — the minimal swing from the bone's bind direction
  // onto the solved direction — has a singularity where the two are opposite,
  // and this rig walks straight into it: the bind arm points down and an
  // over-shoulder reach points it up. `setFromUnitVectors` has no defined answer
  // there, and either side of it the *twist* it invents differs by half a turn.
  // Measured before this rewrite: 140° of forearm in one frame, mid-draw, on
  // the greatsword.
  _normal.copy(_toTarget).cross(_perp).normalize()

  _frameY.copy(_dir1).negate()
  _frameZ.copy(_normal).cross(_frameY)
  _frameBasis.makeBasis(_normal, _frameY, _frameZ)
  _qWorld1.setFromRotationMatrix(_frameBasis).multiply(chain.frame1)
  _qUpper.copy(_qParent).invert().multiply(_qWorld1)

  _frameY.copy(_dir2).negate()
  _frameZ.copy(_normal).cross(_frameY)
  _frameBasis.makeBasis(_normal, _frameY, _frameZ)
  _qWorld2.setFromRotationMatrix(_frameBasis).multiply(chain.frame2)
  _qFore.copy(_qWorld1).invert().multiply(_qWorld2)

  // ── The twist goes in the forearm, not the wrist ──────────────────────────
  //
  // The swings above fix where each bone *points* and leave the rotation about
  // that direction undetermined, so whatever twist is needed to meet the grip's
  // orientation lands wherever it is not taken up first. Before this, that was
  // the wrist: reaching behind the shoulder for a greatsword put 300° through
  // `hand.R` over the reach — measured — which no wrist has, and which showed up
  // as the hand spinning on the end of the arm at 30° a frame.
  //
  // A real arm takes it in **pronation**, at the radioulnar joint, which is a
  // rotation of the forearm about its own axis. Extracting the twist component
  // of the error about that axis (the standard swing-twist decomposition) and
  // rolling the forearm by it leaves the wrist only the swing — the part a wrist
  // can actually do.
  _qScratch.copy(_qWorld2).invert().premultiply(handWorld)
  const sign = _qScratch.w < 0 ? -1 : 1
  const along = sign * (_qScratch.x * _dir2.x + _qScratch.y * _dir2.y + _qScratch.z * _dir2.z)
  const twist = 2 * Math.atan2(along, sign * _qScratch.w)
  _qRoll.setFromAxisAngle(chain.axis2, twist)
  _qFore.multiply(_qRoll)
  _qWorld2.copy(_qWorld1).multiply(_qFore)

  _qHand.copy(_qWorld2).invert().multiply(handWorld)

  if (weight >= 1) {
    upper.quaternion.copy(_qUpper)
    fore.quaternion.copy(_qFore)
    hand.quaternion.copy(_qHand)
    return
  }
  upper.quaternion.slerp(_qUpper, weight)
  fore.quaternion.slerp(_qFore, weight)
  hand.quaternion.slerp(_qHand, weight)
}

let _stability = 1

/**
 * How square the elbow's hinge axis was to the reach line, over every solve
 * since the last `resetElbowStability`.
 *
 * 1 is perpendicular and 0 is the singular case: an arm reaching *along* its own
 * elbow hinge has no defined bend side, and a hair either way puts the elbow
 * above the arm or below it. There is no runtime fix — blending between the two
 * sides passes through a straight arm, and clamping picks one and sticks with it
 * until it doesn't. It is an authoring constraint on the hinges and the paths,
 * so it is measured and asserted in the tests instead.
 *
 * It has caught this once already: the greatsword's exit brings the hand across
 * the midline at head height, so the reach line points almost straight out
 * sideways — within 18° of the hinge — and the elbow snapped from above the
 * shoulder to below it, moving 0.42 m in one frame.
 */
export const elbowStability = (): number => _stability

/** Starts a fresh measurement window. */
export const resetElbowStability = (): void => {
  _stability = 1
}

const _fromPoint = new Vector3()
const _fromQuat = new Quaternion()
const _easedTarget = new Vector3()
const _easedQuat = new Quaternion()
const _shoulderPoint = new Vector3()
const _fromDirection = new Vector3()
const _toDirection = new Vector3()

/**
 * `reachGrip`, with the *target* eased in from wherever the hand already is.
 *
 * ── Why the pose cannot simply be cross-faded ───────────────────────────────
 *
 * The obvious way to bring a reach in is to solve it and slerp the arm from its
 * current pose toward the solution. It works for a hip draw and it fails for an
 * over-shoulder one, for a reason that is invisible until it happens: reaching
 * behind the shoulder turns the upper arm from pointing down-and-out to pointing
 * up-and-out, which is a rotation of about 178°. **Two quaternions 178° apart
 * are nearly antipodal, and the geodesic between them is nearly a semicircle
 * whose direction is arbitrarily sensitive to either endpoint.** Measured: the
 * solved pose advancing a smooth 1.8° per frame, the current pose constant, the
 * blend weight smooth — and the blended arm jumping 95° between two frames, with
 * the grip 0.31 m away from where it had been.
 *
 * So the blend happens in *space* instead. The solver runs every frame on a
 * target interpolated from the hand's own current grip toward the destination,
 * which means the hand is always somewhere sensible and the arm is always a
 * valid solution for where the hand is. The pose weight then only has to cover
 * the difference between the gait's elbow and the solver's, with the hand in the
 * same place either way — a few tens of degrees, nowhere near antipodal.
 */
const reachGripEased = (
  bones: PoseTargets,
  side: 'L' | 'R',
  target: Vector3,
  hinge: Vector3,
  handWorld: Quaternion,
  ease: number,
  weight: number
): void => {
  if (weight <= 0) {
    return
  }
  if (ease >= 1) {
    reachGrip(bones, side, target, hinge, handWorld, weight)
    return
  }
  const upper = bones.get(`upperArm.${side}` as BoneName)
  if (!upper || !gripWorld(bones, side, _fromPoint, _fromQuat)) {
    return
  }

  // ── Interpolated around the shoulder, not across it ───────────────────────
  //
  // A straight line from the hand's current position to the destination is a
  // chord, and for a reach that starts at the hip and ends behind the neck that
  // chord passes within 0.13 m of the shoulder joint. A reach line that short
  // swings through most of a hemisphere in a handful of frames and takes the
  // elbow's bend plane with it — measured: `elbowStability` down to 0.15 and the
  // upper arm moving 60° in one frame, in the *middle* of a smooth ease.
  //
  // Interpolating the radius and the direction separately keeps the hand out at
  // roughly arm's length the whole way round, which is both well conditioned and
  // what an arm does: the elbow does not fold up to pass the hand by the
  // shoulder on its way somewhere else.
  upper.updateWorldMatrix(true, false)
  _shoulderPoint.setFromMatrixPosition(upper.matrixWorld)
  _fromDirection.copy(_fromPoint).sub(_shoulderPoint)
  _toDirection.copy(target).sub(_shoulderPoint)
  const fromRadius = _fromDirection.length()
  const toRadius = _toDirection.length()
  if (fromRadius < 1e-4 || toRadius < 1e-4) {
    reachGrip(bones, side, target, hinge, handWorld, weight)
    return
  }
  _fromDirection.divideScalar(fromRadius)
  _toDirection.divideScalar(toRadius)
  _easedTarget
    .copy(_fromDirection)
    .lerp(_toDirection, ease)
    .normalize()
    .multiplyScalar(lerp(fromRadius, toRadius, ease))
    .add(_shoulderPoint)
  // ── The orientation cannot be eased through an antipode ───────────────────
  //
  // The paragraph above is about *position*, and the same failure lives one axis
  // over: `_fromQuat` is wherever the gait left the hand and `handWorld` is the
  // grip's, and once an item is gripped blade-up those two are up to a half turn
  // apart. **Two quaternions 180° apart have no defined geodesic** — the plane of
  // the slerp is set by whichever way the endpoints happen to be leaning, so a
  // degree of gait swing rotates the whole interpolation. Measured on the sword's
  // sheathe at half speed: the eased target flipping, and 167° of forearm and
  // 156° of wrist in a single frame — with the hand's *world* orientation barely
  // moving, because the pair of them counter-rotated.
  //
  // So the ease is faded out as the two approach antipodal and the solver is sent
  // straight at the target instead. Nothing is lost by that: `weight` is what
  // fades the pose in, and it is still zero at the start of the clip. `closeness`
  // is |cos(θ/2)| — 1 aligned, 0 antipodal — and 0.6 is θ ≈ 106°, chosen by
  // sweeping it: the worst arm step across all four clips is 0.86 / 0.94 rad at a
  // guard of 0.30, 0.67 / 0.72 at 0.60, and 0.69 / 0.67 at 0.80, while the
  // crossbow's elbow stability falls from 0.682 to 0.602 if the ease is removed
  // altogether. 0.60 is where both stop improving.
  const closeness = Math.abs(_fromQuat.dot(handWorld))
  const authority = smoothstep01(closeness / 0.6)
  _easedQuat.copy(_fromQuat).slerp(handWorld, lerp(1, ease, authority))

  reachGrip(bones, side, _easedTarget, hinge, _easedQuat, weight)
}

/**
 * Rolls the forearm about its own bone axis, leaving the hand where it is.
 *
 * ── The one joint the gait never uses, and the only one a shield has ────────
 *
 * `poses.ts` notes that `rotation.y` on an arm bone "would do nothing" because a
 * bone pointing along −Y is invariant under rotation about Y. That is true of
 * the child's *position* and false of its *orientation*: rolling the forearm
 * carries the hand's frame with it, and pronation is exactly how a real arm
 * decides which way the palm — and therefore a strapped shield's face — points.
 *
 * The roll is applied about the bind-pose bone axis rather than about local Y,
 * because this rig's forearm is 17° off vertical in bind pose and rolling about
 * Y would drag the hand sideways by a centimetre.
 */
const rollForearm = (bones: PoseTargets, side: 'L' | 'R', radians: number): void => {
  const fore = bones.get(`forearm.${side}` as BoneName)
  if (!fore || radians === 0) {
    return
  }
  _qRoll.setFromAxisAngle(ARM[side].axis2, radians)
  fore.quaternion.multiply(_qRoll)
}

/**
 * Rolls the forearm so that a hand-local axis points as close as possible to a
 * world direction, and returns the residual angle in radians.
 *
 * Constrained, and honestly so: rolling sweeps the axis around a cone about the
 * forearm, so only the component perpendicular to the forearm can be matched.
 * The residual is returned rather than hidden — if it is large, the *arm* pose
 * is wrong, and no amount of wrist will fix it.
 */
const aimByRoll = (bones: PoseTargets, side: 'L' | 'R', local: Vector3, desired: Vector3): number => {
  const fore = bones.get(`forearm.${side}` as BoneName)
  const hand = bones.get(`hand.${side}` as BoneName)
  if (!fore || !hand) {
    return 0
  }
  hand.updateWorldMatrix(true, false)
  _qScratch.setFromRotationMatrix(hand.matrixWorld)
  _normal.copy(local).applyQuaternion(_qScratch)

  fore.updateWorldMatrix(true, false)
  _qWorld2.setFromRotationMatrix(fore.matrixWorld)
  _axis.copy(ARM[side].axis2).applyQuaternion(_qWorld2).normalize()

  _projA.copy(_normal).addScaledVector(_axis, -_normal.dot(_axis))
  _projB.copy(desired).addScaledVector(_axis, -desired.dot(_axis))
  const reliability = Math.min(_projA.length(), _projB.length())
  if (reliability < 1e-4) {
    return Math.acos(clampAbs(_axis.dot(_normal.normalize())))
  }
  _cross.copy(_projA).cross(_projB)
  // Faded out as the aim approaches the forearm's own axis. There the
  // projection is a few millimetres long and its direction is noise, so the
  // solved roll swings wildly between frames from a change too small to see —
  // measured at 63° in one frame before this guard existed.
  const authority = smoothstep01(reliability / 0.25)
  rollForearm(bones, side, Math.atan2(_cross.dot(_axis), _projA.dot(_projB)) * authority)

  // What is left over. The roll sweeps the axis around a cone whose half-angle
  // it cannot change, so the residual is exactly the difference between the two
  // directions' angles to the forearm — and it is the *arm* pose's problem.
  const coneNormal = Math.acos(clampAbs(_axis.dot(_normal.normalize())))
  const coneDesired = Math.acos(clampAbs(_axis.dot(desired)))
  return Math.abs(coneNormal - coneDesired)
}

// ─── Carriage ───────────────────────────────────────────────────────────────

/**
 * Fraction of the gait's own arm swing a carrying arm keeps.
 *
 * Not zero. A weapon arm still rides the cadence — it is *damped*, not welded —
 * and an arm frozen at a constant angle over a run cycle reads as a mannequin
 * being slid along the ground. Measured against the curves in `gaitCurves.ts`, a
 * run's ±45° shoulder becomes ±9° at 0.2, which is about what a person carrying
 * a sword actually does.
 */
const RESIDUAL_SWING = 0.2
/** The shield arm keeps even less: it is a braced structure, not a pendulum. */
const RESIDUAL_SHIELD = 0.12
/** The shoulder girdle keeps more than the arm — the torso still works. */
const RESIDUAL_GIRDLE = 0.45

interface ArmPose {
  /** Shoulder flexion as `rotation.x`; negative is forward. */
  shoulder: number
  /** Abduction: positive is away from the body, on either side. */
  spread: number
  /**
   * Humeral internal rotation, positive turning the elbow's fold *across* the
   * body on either side.
   *
   * The gait never uses this axis, and for anything held it is the axis that
   * matters most: it decides which way the forearm folds. With it at zero every
   * elbow folds straight forward, which is why a shield posed without it ends up
   * a shelf sticking out in front of the character instead of a plate across it.
   */
  twist: number
  /** Elbow as `rotation.x`; negative folds the hand forward. */
  elbow: number
  /** Wrist as `rotation.x`, same sign convention as the elbow. */
  wrist: number
  /** Forearm pronation, radians, positive rolling the palm down. */
  roll: number
}

/** Poses at a stand, and the same pose at a full run. Blended by `effort`. */
interface CarrySpec {
  side: 'L' | 'R'
  rest: ArmPose
  run: ArmPose
  residual: number
}

/**
 * ── The carries ─────────────────────────────────────────────────────────────
 *
 * Every one of them tightens with effort: the elbow folds harder and the arm
 * comes in toward the body. That is not stylisation, it is what a mass on the
 * end of a lever forces you to do — a sword held at arm's length while running
 * swings a moment of inertia you cannot control, so runners shorten the lever.
 * It is also what stops the weapon geometry from sweeping through the thighs at
 * the top of a stride, which is the practical reason to get it right.
 */
const SWORD_HAND: CarrySpec = {
  side: 'R',
  rest: { shoulder: -0.12, spread: 0.02, twist: 0.14, elbow: -1.05, wrist: -0.12, roll: 0.25 },
  run: { shoulder: -0.26, spread: -0.06, twist: 0.26, elbow: -1.95, wrist: -0.2, roll: 0.45 },
  residual: RESIDUAL_SWING
}

/**
 * Both hands on one haft, so the leading hand has to be somewhere the trailing
 * one can follow it to. Measured: with the sword hand's own spread (+0.16) the
 * support hand's target lands 0.427 m from the left shoulder — 1 mm inside the
 * arm's total length — and the hands sit 70 mm apart instead of 130. A
 * two-hander is carried on the centreline for exactly this reason.
 */
const TWO_HAND_MAIN: CarrySpec = {
  side: 'R',
  rest: { shoulder: -0.24, spread: -0.46, twist: 0.34, elbow: -1.9, wrist: -0.12, roll: 0.15 },
  run: { shoulder: -0.32, spread: -0.54, twist: 0.42, elbow: -2.1, wrist: -0.16, roll: 0.3 },
  residual: RESIDUAL_SWING * 0.6
}

const BOW_HAND: CarrySpec = {
  side: 'L',
  rest: { shoulder: -0.1, spread: -0.04, twist: 0.2, elbow: -0.5, wrist: -0.05, roll: -0.35 },
  run: { shoulder: -0.42, spread: -0.2, twist: 0.5, elbow: -1.15, wrist: -0.08, roll: -0.5 },
  residual: RESIDUAL_SWING * 0.5
}

const BOW_FREE: CarrySpec = {
  side: 'R',
  rest: { shoulder: -0.06, spread: 0.1, twist: 0, elbow: -0.5, wrist: -0.12, roll: 0 },
  run: { shoulder: -0.16, spread: 0.06, twist: 0.1, elbow: -1.1, wrist: -0.18, roll: 0 },
  residual: RESIDUAL_SWING * 1.6
}

const CROSSBOW_MAIN: CarrySpec = {
  side: 'R',
  rest: { shoulder: 0.14, spread: -0.36, twist: 0.3, elbow: -1.72, wrist: -0.06, roll: 0.1 },
  run: { shoulder: 0.06, spread: -0.44, twist: 0.38, elbow: -1.86, wrist: -0.1, roll: 0.22 },
  residual: RESIDUAL_SWING * 0.6
}

const armPose = (spec: CarrySpec, effort: number, out: ArmPose): ArmPose => {
  const e = clamp01(effort)
  out.shoulder = lerp(spec.rest.shoulder, spec.run.shoulder, e)
  out.spread = lerp(spec.rest.spread, spec.run.spread, e)
  out.twist = lerp(spec.rest.twist, spec.run.twist, e)
  out.elbow = lerp(spec.rest.elbow, spec.run.elbow, e)
  out.wrist = lerp(spec.rest.wrist, spec.run.wrist, e)
  out.roll = lerp(spec.rest.roll, spec.run.roll, e)
  return out
}

const _pose: ArmPose = { shoulder: 0, spread: 0, twist: 0, elbow: 0, wrist: 0, roll: 0 }

/**
 * Writes one arm's carry pose over whatever the gait left, keeping `residual`
 * of the gait's own swing.
 *
 * Legs, pelvis and trunk are never touched — that is the whole reason this is a
 * separate layer rather than a branch inside `applyGait`.
 */
const carryArm = (bones: PoseTargets, spec: CarrySpec, effort: number, weight: number): void => {
  if (weight <= 0) {
    return
  }
  const side = spec.side
  const pose = armPose(spec, effort, _pose)
  const outward = side === 'L' ? 1 : -1

  const arm = bones.get(`upperArm.${side}` as BoneName)
  if (arm) {
    const swing = arm.rotation.x
    arm.rotation.x = lerp(swing, pose.shoulder + swing * spec.residual, weight)
    arm.rotation.z = lerp(arm.rotation.z, outward * pose.spread, weight)
    // Negated against `outward`: internal rotation turns the elbow's fold plane
    // *inboard* on both sides.
    arm.rotation.y = lerp(arm.rotation.y, -outward * pose.twist, weight)
  }
  const fore = bones.get(`forearm.${side}` as BoneName)
  if (fore) {
    const swing = fore.rotation.x
    fore.rotation.x = lerp(swing, pose.elbow + swing * spec.residual * 0.5, weight)
    fore.rotation.y = lerp(fore.rotation.y, 0, weight)
    fore.rotation.z = lerp(fore.rotation.z, 0, weight)
  }
  const hand = bones.get(`hand.${side}` as BoneName)
  if (hand) {
    hand.rotation.x = lerp(hand.rotation.x, pose.wrist, weight)
    hand.rotation.y = lerp(hand.rotation.y, 0, weight)
    hand.rotation.z = lerp(hand.rotation.z, 0, weight)
  }
  const girdle = bones.get(`shoulder.${side}` as BoneName)
  if (girdle) {
    girdle.rotation.y = lerp(girdle.rotation.y, girdle.rotation.y * RESIDUAL_GIRDLE, weight)
  }
  // Pronation last, and about the bone's own axis rather than through
  // `rotation.y`: the forearm sits 17° off vertical in bind pose, so local Y is
  // not the roll axis and using it would drag the hand a centimetre sideways.
  // Scaled by the blend weight so it fades in with the rest of the pose.
  rollForearm(bones, side, outward * pose.roll * weight)
}

/**
 * Distance along the haft, from the leading hand's grip to the trailing hand's,
 * in metres. A chibi's hand is 55 mm across, so 130 mm is two fists with a
 * finger's gap — closer and they interpenetrate, wider and the pose reads as
 * carrying a plank between two people.
 */
const HAFT_SPACING = 0.13
/**
 * Where the support hand sits on a crossbow's stock, ahead of the trigger.
 *
 * **Negative, unlike the haft.** A greatsword's second hand goes *down* the grip
 * toward the pommel; a crossbow's goes *forward* under the fore-end. Same
 * mechanism, opposite ends of the item, and getting the sign wrong on the sword
 * put the support hand a hand's width up the blade — which also happened to be
 * 8 mm outside the left arm's reach, so it read as the hands drifting apart
 * rather than as the obvious thing it was.
 */
const STOCK_SPACING = -0.12

/**
 * Puts the off hand on the item the main hand is already holding.
 *
 * Solved rather than posed. The support hand's target is defined *on the item* —
 * a fixed distance down the haft from the leading grip — so it tracks the main
 * hand through the whole run cycle instead of being a second set of angles that
 * agree with the first only at the pose they were authored in. Two hands on one
 * weapon that drift apart over a stride is the most obvious possible tell.
 */
const linkOffHand = (
  bones: PoseTargets,
  kind: ItemKind,
  spacing: number,
  hingeX: number,
  hingeY: number,
  hingeZ: number,
  weight: number
): void => {
  if (weight <= 0) {
    return
  }
  if (!gripWorld(bones, 'R', _grip, _qSocket)) {
    return
  }
  // Down the **item's** axis, which is the hand's turned by `GRIP_ROTATION` —
  // and on a greatsword that is a quarter turn, so reading the offset off the
  // hand instead would send the support hand 130 mm out along the *forearm*
  // rather than down the haft. `+Y` runs grip→pommel (see the note on the item
  // frame below), so a positive spacing puts the support hand behind the leading
  // one and a negative one puts it out along the blade or the stock.
  _qItem.copy(_qSocket).multiply(GRIP_QUAT[kind])
  _target.set(0, spacing, 0).applyQuaternion(_qItem).add(_grip)
  torsoDirection(bones, hingeX, hingeY, hingeZ, _pole)
  // Eased the same way as a draw's reach, and for the same reason: a support
  // hand coming from a full run's arm swing to a haft in front of the chest is
  // a long way round.
  reachGripEased(bones, 'L', _target, _pole, _qSocket, weight, smoothstep01(weight / 0.3))
}

/**
 * Poses the arms for a drawn weapon.
 *
 * `effort` is 0 standing and 1 at a full run — the caller's own speed blend, the
 * same number `Character` already computes for the walk-to-run weight. `weight`
 * fades the whole layer in, which is what `applyDraw` uses to land on this pose
 * exactly at the end of a transition.
 */
const carryArms = (bones: PoseTargets, drawn: DrawnState, effort: number, weight: number, offHand: boolean): void => {
  if (drawn === 'sheathed' || weight <= 0) {
    return
  }
  const w = clamp01(weight)
  switch (drawn) {
    case 'mainHand':
      carryArm(bones, SWORD_HAND, effort, w)
      break
    case 'twoHand':
      carryArm(bones, TWO_HAND_MAIN, effort, w)
      if (offHand) {
        linkOffHand(bones, 'greatsword', HAFT_SPACING, 0.83, 0.4, 0.39, w)
      }
      break
    case 'bow':
      carryArm(bones, BOW_HAND, effort, w)
      carryArm(bones, BOW_FREE, effort, w)
      break
    case 'crossbow':
      carryArm(bones, CROSSBOW_MAIN, effort, w)
      if (offHand) {
        linkOffHand(bones, 'crossbow', STOCK_SPACING, 0.83, 0.4, 0.39, w)
      }
      break
  }
}

export const applyCarry = (bones: PoseTargets, drawn: DrawnState, effort = 0, weight = 1): void => {
  carryArms(bones, drawn, effort, weight, true)
}

// ─── The shield ─────────────────────────────────────────────────────────────

/**
 * ── What a shield actually does on a moving body ────────────────────────────
 *
 * A strapped shield (the *enarmes* kind — Wikipedia, "Strapped shield") is not
 * held, it is **worn**: the forearm lies across the back face under a strap and
 * the hand grips a second strap near the rim. Two consequences the pose has to
 * respect, and both of them are load-bearing:
 *
 * 1. **The wrist is locked.** Strapped to the forearm, the plate cannot be
 *    angled with the wrist — so this pose leaves `hand.L` near neutral and turns
 *    the shield with *forearm pronation* instead (`aimByRoll`). Cocking the
 *    wrist to aim a shield is the single clearest sign nobody checked how one
 *    attaches.
 * 2. **The plate's plane contains the forearm**, so where the arm points decides
 *    where the shield sits, and the roll decides where it faces. They are
 *    independent, which is why they are solved separately here.
 *
 * ── The third consequence, which is the one the first pass missed ───────────
 *
 * **The board is rigidly an extension of the forearm, and most of it hangs
 * *past* the hand.** `gear/shield.ts` puts the grip bar on the item's origin and
 * runs the board along the item's ±Y: the top edge 122 mm one way, the point
 * 237 mm the other. `SOCKETS.handL` has an identity rotation, so the item's ±Y
 * is the hand bone's ±Y — and with the wrist near neutral that sits a fixed
 * **17.5°** off the forearm's own elbow→wrist line (measured; it is the A-pose's
 * forearm tilt, `rig.ts`). The board therefore points wherever the forearm
 * points, always, and the roll can only spin it about that line.
 *
 * The first cut of these three poses was authored as if the plate could be
 * angled independently of the arm, and every one of them folded the elbow to
 * "tuck" or "raise" it. Measured, at a stand, with the shield attached: the
 * board's long axis came out **72° off vertical** — the plate lying nearly
 * horizontal with its point 0.5 m out in *front* of the character at hip height.
 * At a run it was 110° (point up and back) and at a brace 138° (point straight
 * up, the shield upside down). Doing nothing at all scored 20°. That is the
 * defect the user reported as "hanging at an odd angle".
 *
 * The three carriages below are re-authored against that constraint, and the
 * numbers are searched rather than guessed — 960 combinations scored on the
 * board's axis, the plate's normal, the residual left to the wrist, and the
 * signed distance from the board's 208 vertices to the skinned body:
 *
 * * **Rest / walk** — the arm hangs, so the board hangs: **13–19° off
 *   vertical**, plate 4–11° off dead outboard, point beside the left knee, and
 *   86–89 mm of daylight between the board and the thigh through a whole walk
 *   cycle. The shoulder is drawn *back* 0.22 rad rather than left neutral, and
 *   that is what buys the vertical: the board trails the forearm by 17.5°, so a
 *   forearm hanging plumb leaves the point 17.5° forward of plumb.
 * * **Run** — tucked. The elbow folds to 41° (from 11°) and the arm comes in:
 *   the hand's lateral offset from the chest drops from 0.23 m to 0.19 m and the
 *   plate turns forward (its +Z component goes 0.06 → 0.68). The board can only
 *   follow the forearm, so folding it also swings the point forward and down
 *   across the thigh — 27° off vertical, which is as far as the fold can go
 *   before the board reads as a plank held out in front.
 * * **Brace** (a jump, a landing, an impact) — up and canted. SCA and HEMA
 *   sword-and-board drill puts the top edge under the eyes with the elbow *in*;
 *   **this model cannot do that**, and it is worth writing down why rather than
 *   half-doing it. Raising the hand means raising the elbow above it, and with
 *   the board hanging past the hand along the forearm the only arm poses that
 *   keep the plate vertical *and* raise it throw the elbow wide — measured, the
 *   whole surviving family sat at a hand 0.42–0.51 m off the chest's centreline,
 *   i.e. the shield flung out sideways. So the brace raises and *cants* instead:
 *   the hand comes up 0.15 m, the arm comes in to 0.16 m, and the plate's normal
 *   ends up up-and-forward — which is the riot-training cant, deflecting what
 *   hits it into the ground. The board is 71° off vertical there and that is the
 *   model's limit, not a choice.
 */
const SHIELD_WALK: ArmPose = { shoulder: 0.22, spread: -0.2, twist: 0.3, elbow: -0.16, wrist: 0.02, roll: 0 }
const SHIELD_RUN: ArmPose = { shoulder: 0.2, spread: -0.3, twist: 0.2, elbow: -0.6, wrist: 0.02, roll: 0 }
const SHIELD_BRACE: ArmPose = { shoulder: -0.65, spread: -0.35, twist: 0.5, elbow: -0.55, wrist: 0.02, roll: 0 }

/**
 * Where the plate faces, in the chest's frame, at each carriage.
 *
 * **Outboard at rest, forward at a run, up-and-forward at a brace, and none of
 * the three is a preference.** The plate's normal is perpendicular to the
 * forearm — that is what strapping it there means — so a shield on a hanging arm
 * *cannot* face forward, and asking it to is how you get the wrist cocked at 60°
 * to fake it. `aimByRoll` returns the residual precisely so that asking for an
 * impossible face is visible rather than silent; all three of these leave it
 * under 5°, against 19° for the poses they replace.
 */
const SHIELD_FACE_WALK = new Vector3(1, -0.04, 0.12)
const SHIELD_FACE_RUN = new Vector3(0.6, 0.1, 0.79)
const SHIELD_FACE_BRACE = new Vector3(0.32, 0.82, 0.48)

/**
 * The shield's outward face in the item's own frame.
 *
 * `SOCKETS.handL` has an identity rotation, so an item's axes *are* the hand
 * bone's axes: in bind pose the plate stands upright facing +Z with the top edge
 * up. That is the contract the gear agent's mesh has to be authored to, and it
 * is the one this pose aims.
 */
const SHIELD_NORMAL_LOCAL = new Vector3(0, 0, 1)

const _shieldPose: ArmPose = { shoulder: 0, spread: 0, twist: 0, elbow: 0, wrist: 0, roll: 0 }
const _shieldFace = new Vector3()

/**
 * Carries a shield on the left forearm.
 *
 * `effort` blends walk→run, `brace` raises it (a jump, a block). Applied after
 * `applyCarry`, and it wins on the left arm — a shield and a two-handed weapon
 * are not a valid loadout, and if the caller asks for both, the shield is the
 * one that has somewhere to be.
 */
export const applyShield = (bones: PoseTargets, effort = 0, brace = 0, weight = 1): number => {
  const w = clamp01(weight)
  if (w <= 0) {
    return 0
  }
  const e = clamp01(effort)
  const b = clamp01(brace)

  _shieldPose.shoulder = lerp(lerp(SHIELD_WALK.shoulder, SHIELD_RUN.shoulder, e), SHIELD_BRACE.shoulder, b)
  _shieldPose.spread = lerp(lerp(SHIELD_WALK.spread, SHIELD_RUN.spread, e), SHIELD_BRACE.spread, b)
  _shieldPose.twist = lerp(lerp(SHIELD_WALK.twist, SHIELD_RUN.twist, e), SHIELD_BRACE.twist, b)
  _shieldPose.elbow = lerp(lerp(SHIELD_WALK.elbow, SHIELD_RUN.elbow, e), SHIELD_BRACE.elbow, b)
  _shieldPose.wrist = lerp(lerp(SHIELD_WALK.wrist, SHIELD_RUN.wrist, e), SHIELD_BRACE.wrist, b)

  const arm = bones.get('upperArm.L')
  if (arm) {
    const swing = arm.rotation.x
    arm.rotation.x = lerp(swing, _shieldPose.shoulder + swing * RESIDUAL_SHIELD, w)
    arm.rotation.z = lerp(arm.rotation.z, _shieldPose.spread, w)
    // Internal rotation, which for the left arm is negative — this is the joint
    // that swings the plate across the body instead of out in front of it.
    arm.rotation.y = lerp(arm.rotation.y, -_shieldPose.twist, w)
  }
  const fore = bones.get('forearm.L')
  if (fore) {
    const swing = fore.rotation.x
    fore.rotation.x = lerp(swing, _shieldPose.elbow + swing * RESIDUAL_SHIELD, w)
    fore.rotation.y = lerp(fore.rotation.y, 0, w)
    fore.rotation.z = lerp(fore.rotation.z, 0, w)
  }
  const hand = bones.get('hand.L')
  if (hand) {
    // Near neutral, and deliberately so — see the note above. The strap does not
    // let the wrist do anything else.
    hand.rotation.x = lerp(hand.rotation.x, _shieldPose.wrist, w)
    hand.rotation.y = lerp(hand.rotation.y, 0, w)
    hand.rotation.z = lerp(hand.rotation.z, 0, w)
  }
  const girdle = bones.get('shoulder.L')
  if (girdle) {
    girdle.rotation.y = lerp(girdle.rotation.y, girdle.rotation.y * RESIDUAL_GIRDLE, w)
  }

  _shieldFace
    .copy(SHIELD_FACE_WALK)
    .lerp(SHIELD_FACE_RUN, e)
    .lerp(SHIELD_FACE_BRACE, b)
    .normalize()
  torsoDirection(bones, _shieldFace.x, _shieldFace.y, _shieldFace.z, _pole)
  return aimByRoll(bones, 'L', SHIELD_NORMAL_LOCAL, _pole) * w
}

// ─── Draw and sheathe ───────────────────────────────────────────────────────

/**
 * ── The item frame, which everything below depends on ───────────────────────
 *
 * An item's origin is its **grip** — the point that lands in the fist — and its
 * local **+Y runs grip→pommel**, so the blade, the stock or the bow's lower limb
 * extends along **−Y**.
 *
 * This is not a preference, it is read off the socket table. `hipR` cants the
 * item by −0.35 about Z: with the blade at −Y the tip swings *down and outboard
 * of the right thigh* and the hilt stands up toward the waist, which is a sword
 * on a hip. With the blade at +Y the same socket points the tip up past the ribs
 * — a scabbard through the armpit. `backOver` decides it a second time: +0.55
 * about Z puts the pommel over the **right** shoulder and the tip down by the
 * left hip, which is the only arrangement a right hand can draw.
 *
 * The consequence that matters elsewhere: with the elbow straight the blade
 * points at the ground, and folding the elbow to a right angle points it
 * forward. Every carry pose below is authored knowing that.
 */

/** Path parameter at which the hand is on the grip. */
const GRIP_P = 0.35

/**
 * Path parameter at which the item has arrived where it is carried.
 *
 * The last 30 % of the path is deliberately *still*: the hand is already at the
 * carry position, and all that happens is the elbow and the wrist relaxing out
 * of the solver's answer into the authored one. Nothing about the hand moves, so
 * the blend that hands control back cannot move it either — which is the whole
 * trick, and the alternative to it was cross-fading the hand's position between
 * the top of the draw and the guard, a straight line between two points 0.5 m
 * apart that the hand covered at 8 m/s.
 *
 * It is 30 % and not 5 % because the wrist has the furthest to go: up to the
 * grip the hand holds the item's *stow* orientation, which is what makes the
 * handover exact, and a greatsword's stow orientation is most of a half-turn
 * from the way it is held. That rotation has to happen somewhere, and here it
 * has 18 frames rather than four.
 */
const PULL_END = 0.85

/**
 * The time warps.
 *
 * `[a, b]` is the window in clip time over which the path parameter sits exactly
 * at `GRIP_P` — the plateau the handover happens in. Outside it the parameter
 * moves by smoothstep, so the whole warp is monotone and C¹, and the hand comes
 * to rest at the grip rather than passing through it.
 *
 * **Draw and sheathe share the path and differ in the warp.** They must share
 * the path: a blade leaves and enters a scabbard along the same axis, and giving
 * the sheathe its own arc is how you get a tip that enters through the side of
 * the scabbard. They must differ in the warp: a draw spends its time *leaving* —
 * 34 % of the clip to reach, then away — and a sheathe spends its time *finding*
 * — 52 % lining the tip up, then a long dwell at the mouth before the hand lets
 * go. Time-reversing a draw gives a sheathe that stabs the hip and is out of
 * there, which is exactly what a reversed clip always looks like.
 */
const DRAW_WINDOW: Record<DrawableKind, readonly [number, number]> = {
  // A hip draw is short and quick: the hand has barely left the hip before it is
  // back on the hilt.
  sword: [0.34, 0.44],
  // An over-shoulder reach is most of a half-turn of the whole arm, and the
  // clips are longer *and* spend proportionally more of themselves on it.
  // Measured at the shorter timings: 34° of elbow in a single frame at 60 Hz,
  // which is a smooth curve travelling far too fast rather than a discontinuity,
  // and it reads exactly the same on screen.
  greatsword: [0.3, 0.38],
  bow: [0.3, 0.38],
  crossbow: [0.3, 0.38]
}

const SHEATHE_WINDOW: Record<DrawableKind, readonly [number, number]> = {
  sword: [0.52, 0.7],
  greatsword: [0.56, 0.72],
  bow: [0.56, 0.72],
  crossbow: [0.56, 0.72]
}

const warp = (t: number, kind: DrawableKind, direction: DrawDirection): number => {
  const [a, b] = direction === 'draw' ? DRAW_WINDOW[kind] : SHEATHE_WINDOW[kind]
  const clamped = clamp01(t)
  if (direction === 'draw') {
    return GRIP_P * smoothstep01(clamped / a) + (1 - GRIP_P) * smoothstep01((clamped - b) / (1 - b))
  }
  return 1 - ((1 - GRIP_P) * smoothstep01(clamped / a) + GRIP_P * smoothstep01((clamped - b) / (1 - b)))
}

/**
 * The window, in normalised clip time, during which the drawing hand is on the
 * stow socket and the item may change parent.
 *
 * `CharacterEquipment` reparents on any frame inside this — the pose holds the
 * grip exactly on the socket for the whole span, so there is no frame to hit.
 */
export const handoverWindow = (kind: DrawableKind, direction: DrawDirection): readonly [number, number] =>
  direction === 'draw' ? DRAW_WINDOW[kind] : SHEATHE_WINDOW[kind]

/** The middle of `handoverWindow`; the frame to aim at if only one is wanted. */
export const handoverTime = (kind: DrawableKind, direction: DrawDirection): number => {
  const [a, b] = handoverWindow(kind, direction)
  return (a + b) * 0.5
}

/** Seconds a transition takes. */
export const transitionSeconds = (kind: DrawableKind, direction: DrawDirection): number =>
  direction === 'draw' ? DRAW_SECONDS[kind] : SHEATHE_SECONDS[kind]

/**
 * ── The paths ───────────────────────────────────────────────────────────────
 *
 * Two genuinely different shapes, because a cross-body reach and an
 * over-shoulder reach are not the same motion at different heights:
 *
 * * **A hip draw** is a *drop and a lift*. The hand falls to the hilt from
 *   outside and slightly forward of the hip — never straight down through the
 *   thigh — closes, and then pulls up and *across the chest*, because the hilt
 *   is canted inboard and the blade can only leave along its own axis. The hand
 *   ends up near the opposite shoulder, which is why a hip draw finishes with a
 *   flick back to centre and an over-shoulder draw does not.
 * * **An over-shoulder draw** is a *climb and a fall*. The hand goes up outside
 *   the deltoid — through the head if you interpolate straight to the target —
 *   turns in behind the neck, then comes up and over the shoulder and drops
 *   forward into the guard. The elbow leads it the whole way, which is why its
 *   pole points up and the hip draw's points back.
 *
 * `approach` is added to the socket at the start of the reach and decays to zero
 * at the grip; `bulge` is a mid-arc bow that turns a straight line into a curve.
 * `pull` is how far the grip has to travel before the item is clear; `exit` is
 * where it goes after that — and `exit` is chosen so the path *ends where the
 * carry pose starts*. Leaving a gap there costs nothing in the pose and
 * everything in the motion: the settle blend has to close it in the last
 * quarter of the clip, and 0.28 m of it made the sword's grip peak at 3.7 m/s
 * on a figure a metre and a half tall. All in the chest's frame — **+X is the character's
 * left** — except `pull`, which is derived from the socket's own orientation so
 * that recanting a scabbard recants its draw.
 */
interface DrawPath {
  approach: Vector3
  bulge: Vector3
  /** Metres along the socket's +Y (grip→pommel) before the item is clear. */
  pull: number
  /**
   * For slung items — a bow or a crossbow on the back — the item does not leave
   * along its own axis, it is lifted off the back and swung round. `pull` then
   * runs along this chest-frame direction instead of the socket's.
   */
  slung: Vector3 | null
  exit: Vector3
  /**
   * A mid-exit bow, the same idea as `bulge` but for the way out.
   *
   * Its job is not only shape. The pull lifts the hand and the exit drops it,
   * and in the middle they cancel: without a bulge the greatsword's hand passes
   * **0.13 m from its own shoulder joint** — inside the solver's fold limit, and
   * a reach line that short swings through most of a hemisphere while its
   * endpoint moves three centimetres. Measured there: the grip at 7.9 m/s and
   * 86° of upper arm in one frame, with no discontinuity anywhere in the inputs.
   *
   * Pushing the middle of the arc forward to roughly arm's length fixes the
   * conditioning and is also the shape the motion wants — the blade comes over
   * the shoulder and *out*, not down past the ear.
   */
  exitBulge: Vector3
  /**
   * The elbow's flexion axis, in the chest's frame, at the grip and at the end.
   *
   * Rotates over the pull because a real elbow's axis does: reaching behind the
   * head turns the humerus in, and the axis with it. Interpolated rather than
   * fixed so the elbow leads the hand round instead of trailing it.
   *
   * ── All nine of these are searched, not authored ─────────────────────────
   *
   * The first cut was authored by eye against a *standing* character, and it
   * measured badly the moment the gait moved underneath it: `elbowStability`
   * fell to 0.38 on the greatsword, 0.14 on the crossbow and **0.05** on the
   * bow — sin 3°, an elbow whose side is decided by rounding — while the sword,
   * whose reach never leaves the sagittal plane, held 0.78.
   *
   * They are now the result of coordinate ascent on that measure, run over both
   * directions and three speeds at 60 Hz, with each key held within 40° of its
   * authored direction. The 40° is not a tuning knob: the hinge decides which
   * side of the arm the elbow falls on, and a search free to cross a right angle
   * finds a "better" number by quietly bending the elbow backwards. Anchored, it
   * only re-aims what was already roughly right:
   *
   *     sword 0.78 → 0.99    greatsword 0.17 → 0.64
   *     bow   0.07 → 0.62    crossbow   0.26 → 0.68
   *
   * The worst single-frame arm step follows it down — greatsword 109° → 48°,
   * crossbow 140° → 76° — except on the bow, which stays at 107° because its
   * remaining spike is the *path* sweeping its reach line, not the hinge missing
   * it. That one is still open.
   */
  hinge: Vector3
  hingeEnd: Vector3
  /**
   * The hinge at the *start* of the approach, where the hand is still at the
   * character's side and the reach line points down and outboard — the opposite
   * of where it points once the hand is behind the neck. A single hinge cannot
   * serve both: measured with only the grip's, `elbowStability` fell to 0.05
   * mid-approach and the upper arm turned 157° in one frame.
   */
  hingeStart: Vector3
  /**
   * How the item turns in the hand between the grip and the carry, as an
   * axis-angle **in the item's own frame**.
   *
   * ── Measured, not authored ──────────────────────────────────────────────
   *
   * It is exactly `stowSocketWorld⁻¹ · carryHandWorld` on this rig, sampled at
   * a stand, and it is baked here rather than read from the carry pose every
   * frame because reading it means slerping toward a target that is itself
   * still moving. That was tried: it put a 96° step in the wrist.
   *
   * Without it the hand holds the item's *stowed* orientation for the whole
   * path and then has to catch up in the last few frames — 25° of wrist per
   * frame for the sword, 56° for the greatsword, which is not a snap in the
   * blending sense but reads as one. Spread along the pull it becomes what it
   * should be: the blade turning out of the scabbard as it rises.
   */
  turnAxis: Vector3
  turnAngle: number
}

const PATHS: Record<DrawableKind, DrawPath> = {
  sword: {
    // Shortened outboard (was −0.1) when `SOCKETS.hipR` moved 55 mm out: the
    // approach exists to bring the hand *outside* the hip before it drops onto
    // the hilt, and the hilt now stands outside the hip on its own.
    //
    // It is a shape change and **not** what fixed the grip speed — measured, the
    // clip's peak step was identical to seventeen significant figures before and
    // after, because the peak is not in the reach. See `exit`.
    approach: new Vector3(-0.05, 0.07, 0.11),
    bulge: new Vector3(-0.04, 0.0, 0.06),
    pull: 0.28,
    slung: null,
    // Moved with the socket, not retuned: `exit` exists to land the path where
    // the carry pose starts, and the carry pose did not move while `hipR` moved
    // (−0.055, +0.02, +0.07). Leaving it alone would have made the hand cover
    // that distance twice — out to the new hilt and back again — which is where
    // the sword's peak grip speed went when the socket changed.
    exit: new Vector3(-0.145, -0.12, 0.09),
    exitBulge: new Vector3(-0.06, 0.0, 0.06),
    hinge: new Vector3(0.975, -0.1, 0.197),
    hingeEnd: new Vector3(0.809, -0.552, -0.202),
    hingeStart: new Vector3(0.885, -0.455, 0.102),
    // Re-measured after `SOCKETS.hipR` moved outboard and its Z cant halved to
    // free the hilt from the hip: the stow orientation changed, so the rotation
    // between it and the carry changed with it. Was (−0.976, 0.143, 0.163) at
    // 1.53 rad against the old socket.
    turnAxis: new Vector3(-0.97, 0.232, 0.069).normalize(),
    turnAngle: 1.508
  },
  greatsword: {
    approach: new Vector3(-0.24, -0.12, 0.07),
    bulge: new Vector3(-0.12, 0.09, -0.06),
    pull: 0.26,
    slung: null,
    exit: new Vector3(-0.05, -0.34, 0.36),
    exitBulge: new Vector3(-0.1, -0.02, 0.24),
    // ── Re-searched when the blade-up grip landed ──────────────────────────
    //
    // A grip rotation moves the *wrist* target — `reachGrip` subtracts the
    // 36 mm socket offset in the hand's own orientation — so turning the item a
    // quarter turn in the fist swings that offset up to 50 mm and the reach line
    // with it. Measured: `elbowStability` on this clip fell from 0.64 to **0.467**
    // on the reverted hinges, which is sin 27.9° and inside the band where the
    // elbow's side is decided by rounding. Re-run through the same coordinate
    // ascent the authored keys came from — both directions, five speeds, every
    // key held within 40° of its authored aim — it comes back at **0.750**, above
    // where it was before the grip existed, and the worst arm step falls with it
    // (0.721 → 0.624 rad). `hingeEnd` was already right and the search left it
    // alone.
    hinge: new Vector3(0.121, -0.87, 0.478),
    hingeEnd: new Vector3(0.773, -0.545, -0.325),
    hingeStart: new Vector3(0.316, -0.785, -0.533),
    // The long way round measures 233°; this is the same rotation taken the
    // short way, which is the one the hand takes.
    turnAxis: new Vector3(-0.962, 0.25, 0.11).normalize(),
    turnAngle: 1.1
  },
  crossbow: {
    approach: new Vector3(-0.22, -0.14, 0.08),
    bulge: new Vector3(-0.14, 0.06, -0.05),
    pull: 0.22,
    // Slung, not sheathed: it comes off the back around the right side rather
    // than sliding up a scabbard it does not have.
    slung: new Vector3(-0.5, 0.5, 0.7),
    exit: new Vector3(-0.08, -0.23, 0.21),
    exitBulge: new Vector3(-0.1, -0.02, 0.24),
    // Re-searched with the prod-levelling grip, the same way the greatsword's
    // was: worst arm step 0.90 → 0.80 rad with `elbowStability` unmoved at
    // 0.673. Only the mid-path key needed re-aiming.
    hinge: new Vector3(0.171, -0.828, 0.533),
    hingeEnd: new Vector3(0.86, -0.45, -0.23),
    hingeStart: new Vector3(0.839, 0.035, -0.542),
    turnAxis: new Vector3(-0.967, 0.253, 0.015).normalize(),
    turnAngle: 1.67
  },
  bow: {
    approach: new Vector3(0.22, -0.13, 0.06),
    bulge: new Vector3(0.13, 0.08, -0.06),
    pull: 0.2,
    slung: new Vector3(0.45, 0.55, 0.7),
    exit: new Vector3(0.17, -0.47, 0.14),
    exitBulge: new Vector3(0.05, -0.01, 0.08),
    hinge: new Vector3(0.912, 0.167, -0.375),
    hingeEnd: new Vector3(0.82, 0.56, -0.03),
    hingeStart: new Vector3(0.257, 0.269, 0.928),
    turnAxis: new Vector3(-0.905, 0.235, -0.354).normalize(),
    turnAngle: 0.85
  }
}

/**
 * How much the hand rolls *away* from the grip's own orientation at the start of
 * the approach, radians about the forearm.
 *
 * The hand arrives open and turns onto the grip in the last part of the reach.
 * A hand that travels the whole way already locked in the gripping orientation
 * looks like the sword is being carried invisibly before it is picked up.
 */
const OPEN_HAND_ROLL = 0.55

const _pathTarget = new Vector3()
const _pathPole = new Vector3()
const _pathQuat = new Quaternion()
const _pullAxis = new Vector3()

/**
 * The rotation the item makes in the hand between the grip and the carry, with
 * `GRIP_ROTATION` folded in, as a quaternion.
 *
 * `turnAxis` / `turnAngle` are authored as `stowSocketWorld⁻¹ · carryHandWorld` —
 * a rotation between two **hand** frames, which is what they have to stay,
 * because the end of the pull has to land the hand exactly where `applyCarry`
 * puts it. What changed is the *start*: the hand now grips at `stow · GRIP⁻¹`
 * rather than at `stow`, so the rotation it has to make from there is
 * `GRIP · turn`. Composed once here rather than re-authored, so the table above
 * keeps meaning what it says and a change to `GRIP_ROTATION` cannot leave it
 * stale.
 *
 * Interpolated by `slerp` from identity rather than by scaling an angle, because
 * the composite is no longer a rotation about the authored axis. Same curve, one
 * fewer number to keep honest.
 */
const HAND_TURN: Record<DrawableKind, Quaternion> = (() => {
  const out = {} as Record<DrawableKind, Quaternion>
  for (const kind of DRAWABLE_KINDS) {
    const path = PATHS[kind]
    out[kind] = GRIP_QUAT[kind]
      .clone()
      .multiply(new Quaternion().setFromAxisAngle(path.turnAxis, path.turnAngle))
  }
  return out
})()

const IDENTITY_QUAT = new Quaternion()

/**
 * The grip's world target and the hand's world orientation at path parameter
 * `p`, for one item.
 *
 * Continuous and C¹ in `p` by construction: the approach terms are smoothstepped
 * so both their value *and* their derivative vanish at the grip, and the pull
 * terms start there from zero with zero derivative. Nothing in the path has a
 * corner at the handover, which — together with the plateau in the time warp —
 * is why an item can change parent mid-motion without a visible tick.
 *
 * **`_pathQuat` is the item's frame until the last statement of each branch,
 * then the hand's.** The pull runs along the item's own axis and the item is
 * what has to coincide with the scabbard at the handover, so everything is
 * solved in the item's frame and converted once, at the end, by `GRIP⁻¹`.
 */
const pathAt = (bones: PoseTargets, kind: DrawableKind, p: number, socketName: SocketName): boolean => {
  if (!socketWorld(bones, socketName, _pathTarget, _pathQuat)) {
    return false
  }
  const path = PATHS[kind]

  // The elbow's hinge, swung from the reach pose toward the carry pose — but
  // **late**, over the last 40 % rather than the whole pull. The hinge ends up
  // near the character's lateral axis and the reach line is *also* lateral while
  // the hand is still up by the shoulder, so turning the hinge early walks it
  // straight through the reach line. See `elbowStability`.
  const swing = smoothstep01((p - 0.42) / 0.28)
  if (p < GRIP_P) {
    _pathPole.copy(path.hingeStart).lerp(path.hinge, p / GRIP_P)
  } else {
    _pathPole.copy(path.hinge).lerp(path.hingeEnd, swing)
  }
  torsoDirection(bones, _pathPole.x, _pathPole.y, _pathPole.z, _pathPole)

  if (p <= GRIP_P) {
    // Reach. `k` is 1 at the start of the clip and 0 at the grip.
    //
    // **Linear in `p`, deliberately.** The time warp is already a smoothstep and
    // the reach weight is another; easing this as well multiplies three peak
    // rates together and the hand ends up covering a third of its travel in a
    // sixth of the time. Measured at 4.1 m/s of grip speed on a 1.56 m figure,
    // where a person's sword hand peaks near 2 m/s at this scale. The
    // deceleration into the hilt comes from the warp's plateau instead, which is
    // also what makes the derivative vanish exactly at the handover.
    const k = 1 - clamp01(p / GRIP_P)
    addTorsoOffset(bones, _pathTarget, path.approach.x, path.approach.y, path.approach.z, k)
    const bow = 4 * k * (1 - k)
    addTorsoOffset(bones, _pathTarget, path.bulge.x, path.bulge.y, path.bulge.z, bow)
    // ── The hand turns onto the grip across the reach, not before it ──────────
    //
    // Item frame → hand frame, but eased in rather than present from the first
    // frame. At `k = 1` the target is the scabbard's own orientation — exactly
    // what it was when every item shared one grip, so the start of the clip is
    // still continuous with the gait — and at `k = 0` it is `stow · GRIP⁻¹`, the
    // orientation the fist has to be in for the item to sit on the socket.
    //
    // **Measured, and this is why it is not simply applied at full strength.**
    // Reaching for a hip scabbard turns the hand a quarter turn onto the hilt
    // (the thumb goes from pointing forward to pointing down the blade at the
    // guard), and with the whole 90° sitting on the target from `p = 0` the two
    // ramps that chase it — `ease` and `reach` — multiplied into **28.7° in one
    // frame** on the sword, against 15.5° before. Spread linearly across the
    // reach it is 16.6°. Linear rather than smoothstepped for the reason the
    // reach itself is linear: the warp is already a smoothstep and the weight is
    // another, and easing a third multiplies three peak rates together.
    _qRoll.copy(IDENTITY_QUAT).slerp(GRIP_INVERSE[kind], 1 - k)
    _pathQuat.multiply(_qRoll)
    // Open hand → gripping hand over the second half of the reach. About the
    // forearm and therefore in the **hand's** frame, so it goes on after the
    // conversion above.
    _qRoll.setFromAxisAngle(ARM[DRAW_SIDE[kind]].axis2, OPEN_HAND_ROLL * k)
    _pathQuat.multiply(_qRoll)
    return true
  }

  // Eased at both ends, not linear: the pull now finishes at `PULL_END` rather
  // than at the end of the clip, and a linear ramp stopping there is a corner in
  // the hand's velocity at a point where the clock is still running.
  const s = smoothstep01((p - GRIP_P) / (PULL_END - GRIP_P))
  if (path.slung) {
    torsoDirection(bones, path.slung.x, path.slung.y, path.slung.z, _pullAxis)
  } else {
    // Along the item's own axis: the grip travels toward the pommel as the blade
    // leaves the scabbard, which is the socket's +Y in world space.
    _pullAxis.copy(UP).applyQuaternion(_pathQuat)
  }
  _pathTarget.addScaledVector(_pullAxis, path.pull * s)
  // Almost the same window as the pull rather than a phase after it: sequential
  // ramps put all of the exit's travel into the second half of an already short
  // span, and the hand ended up covering 0.9 m at 5 m/s. Overlapping them turns
  // "up, then over" into one sweep up and over, which is both slower and what a
  // two-handed draw actually looks like.
  const away = smoothstep01((p - GRIP_P - 0.05) / (PULL_END - GRIP_P - 0.05))
  addTorsoOffset(bones, _pathTarget, path.exit.x, path.exit.y, path.exit.z, away)
  const round = 4 * away * (1 - away)
  addTorsoOffset(bones, _pathTarget, path.exitBulge.x, path.exitBulge.y, path.exitBulge.z, round)
  // Item frame → hand frame, before the turn, because `HAND_TURN` is a rotation
  // between two hand frames (see its note).
  _pathQuat.multiply(GRIP_INVERSE[kind])
  // The item turns in the hand as it comes out — see `turnAxis`. Applied on the
  // right, so it is a rotation in the hand's own frame and the same numbers hold
  // whichever way the character is facing.
  _qRoll.copy(IDENTITY_QUAT).slerp(HAND_TURN[kind], s)
  _pathQuat.multiply(_qRoll)
  return true
}

/**
 * When the off hand joins, in path parameter.
 *
 * A greatsword's second hand cannot arrive until the blade is off the back —
 * there is a metre of steel between the two hands' positions and it is still
 * inside the harness at 0.5. A crossbow's support hand can come earlier; it only
 * has to clear the shoulder.
 */
const OFF_HAND_JOIN: Record<DrawableKind, readonly [number, number]> = {
  sword: [1, 1],
  // Both after `PULL_END`, where the leading hand has stopped moving. Starting
  // the join during the pull means the support hand chases a grip that is still
  // travelling up over the shoulder, and it has to cover the same distance in
  // half the time — measured at 129° of shoulder in one frame.
  greatsword: [0.72, 0.96],
  crossbow: [0.7, 0.95],
  bow: [0.62, 0.95]
}

/**
 * Poses a draw or a sheathe.
 *
 * `t` runs 0→1 across the clip in both directions — a sheathe is not a draw
 * played backwards, it is the same path under a different warp, so the caller
 * always counts up. `effort` is the same speed blend `applyCarry` takes.
 *
 * At `t = 0` the arms are left exactly as the gait had them, and at `t = 1` the
 * pose is exactly `applyCarry(bones, DRAWN_STATE_FOR[kind], effort)` for a draw
 * and exactly the gait for a sheathe. Both ends are continuous with what runs
 * either side of the clip, which is the only way a transition does not announce
 * itself.
 */
export const applyDraw = (
  bones: PoseTargets,
  kind: DrawableKind,
  t: number,
  direction: DrawDirection = 'draw',
  effort = 0
): void => {
  const socketName = STOW_SOCKET[kind]
  if (!socketName) {
    return
  }
  const p = warp(t, kind, direction)
  const side = DRAW_SIDE[kind]

  // ── Landing on the carry, without ever cross-fading two distant poses ─────
  //
  // The carry pose goes on **at full weight** well before the clip ends, and the
  // reach then lifts the hand back off it along the path. That looks like the
  // wrong way round until you try the obvious way: fading the carry *in* over
  // the reach means slerping an arm that is up behind the shoulder toward one
  // folded at the belly, and those two are ~170° apart. Measured with the carry
  // faded in: the greatsword's grip jumping 0.18 m at p ≈ 0.77, and — the reason
  // this took three attempts to find — the jump **did not shrink when the
  // sampling was refined**, because it was never a step size, it was a geodesic
  // between two nearly antipodal orientations flipping which way round it went.
  //
  // With the carry underneath, `reachGripEased` measures its start from the
  // carry's own grip, so the two poses being blended always put the hand within
  // `ease` of each other, and the blend is well conditioned everywhere. None of
  // the carry is *seen* while the reach is at full weight — it is the solver's
  // reference, not the pose.
  //
  // The off hand is excluded here and applied once further down, on its own
  // timing. Applying it from both places looked harmless and was not:
  // `reachGrip` leans the shoulder girdle toward its target by multiplying into
  // the bone, so solving the same reach twice in one frame leans it twice.
  const settle = smoothstep01((p - GRIP_P) / (PULL_END - GRIP_P))
  carryArms(bones, DRAWN_STATE_FOR[kind], effort, settle, false)

  // How far the hand has left the carry pose for the path. It rises across the
  // approach and then simply stays — the path's own tail brings the hand to the
  // carry position, so there is nothing left to fade.
  //
  // **Linear**, because the time warp is already eased and easing this as well
  // squares the peak rate: the reach then covers half its travel in a fifth of
  // its time. The corner where it reaches 1 sits inside the warp's plateau,
  // where the clock has stopped, so it costs nothing.
  const ease = clamp01(p / GRIP_P)
  // Control goes back to the carry pose over the still tail of the path, where
  // the two poses already hold the hand in the same place.
  const reach = smoothstep01(p / (GRIP_P * 0.5)) * (1 - smoothstep01((p - PULL_END) / (1 - PULL_END)))
  if (reach > 0 && pathAt(bones, kind, p, socketName)) {
    reachGripEased(bones, side, _pathTarget, _pathPole, _pathQuat, ease, reach)
  }

  // The off hand. A greatsword's joins and stays; a bow's draw hand touches the
  // string and comes away again, which is why one is a step and the other a
  // pulse.
  const [from, to] = OFF_HAND_JOIN[kind]
  if (from < 1) {
    if (kind === 'bow') {
      const touch = pulse01(p, from, to)
      if (touch > 0 && gripWorld(bones, 'L', _grip, _qSocket)) {
        // The string sits a hand's width down the bow's belly from the grip —
        // in the **bow's** frame, which is the fist's turned a quarter about X.
        _qItem.copy(_qSocket).multiply(GRIP_QUAT.bow)
        _target.set(0, -0.06, -0.1).applyQuaternion(_qItem).add(_grip)
        torsoDirection(bones, 0.86, -0.19, -0.46, _pole)
        reachGripEased(bones, 'R', _target, _pole, _qSocket, touch, smoothstep01(touch / 0.3))
      }
    } else {
      const join = smoothstep01((p - from) / (to - from))
      linkOffHand(bones, kind, kind === 'crossbow' ? STOCK_SPACING : HAFT_SPACING, 0.83, 0.4, 0.39, join)
    }
  }
}
