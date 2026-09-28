import { type PerspectiveCamera, Vector3 } from 'three'
import type { CollisionWorld } from '../level/types'

/**
 * ─── The camera during a conversation ───────────────────────────────────────
 *
 * Takes the camera off the player's shoulder and puts it on a **spring arm
 * behind the listener**, looking across their shoulder into the face of whoever
 * is speaking. When the speaker changes it swings to the other shoulder, which
 * is shot/reverse-shot — the oldest grammar there is for filming two people
 * talking, and the reason a conversation reads as a scene rather than as two
 * models facing each other.
 *
 * ── Why the *listener's* shoulder and not the speaker's ─────────────────────
 *
 * Because it is the speaker's face the player needs, and the only way to get a
 * face is to stand behind the person looking at it. Framing over the speaker's
 * own shoulder gives the back of the head of the person currently talking,
 * which is the shot you use when you are hiding an expression.
 *
 * The listener is in frame regardless — they are between the lens and the
 * subject — so this one placement satisfies both halves of the brief ("focusing
 * both characters" and "the currently talking character's head focused")
 * without a wider shot that would make both faces too small to read.
 *
 * ── The flight, and why it is just an exponential ───────────────────────────
 *
 * `begin` seeds the rig from wherever the gameplay camera happens to be, and
 * everything after is `at.lerp(wanted, dt * rate)`. That single line *is* the
 * camera flight: exponential smoothing eases out on its own, so the rig leaves
 * the player's shoulder quickly and settles into the shot slowly, which is what
 * a crane move looks like. A hand-authored spline would let an artist tune the
 * curve, and would need one per shot for a chapter with 31 beats in it.
 *
 * The one thing added on top is a **dolly**: each new shot starts half a metre
 * further back and creeps in. It is small enough that nobody will name it and
 * large enough that a static two-shot stops feeling like a screenshot.
 *
 * ── Keeping both faces in shot ──────────────────────────────────────────────
 *
 * Two mechanisms, and they answer different halves of the same problem.
 *
 * **Choosing the angle** (`chooseShot`) runs once per shot. It walks a list of
 * candidate angles — reverse, same side, tighter versions of both, profile from
 * either side, and finally a single on the speaker — and takes the first
 * preferred one from which `segmentHit` reports a clear line to *both* heads. A
 * room too small for an over-the-shoulder gets a profile; a corridor with a post
 * in the middle gets the other shoulder.
 *
 * **The spring arm** (`constrain`) runs every frame and only shortens: once the
 * angle is chosen, the lens is pulled in along its own line until nothing solid
 * is between it and the speaker.
 *
 * Three constraints, cheapest first:
 *
 *   1. **Props** — `CollisionWorld.segmentHit` from the speaker's head outward
 *      to the lens, which returns where along that line the first blocking prop
 *      is. The origin is a standing character, so it is never itself inside
 *      geometry.
 *   2. **Terrain under the lens** — clamped above `groundAt`.
 *   3. **Terrain along the arm** — four samples between focus and camera, and
 *      the lens rises above the highest. `segmentHit` only knows about props, so
 *      without this the camera happily reverses into a hillside.
 *
 * What none of it does is make the building transparent. That was the other way
 * to solve this and it was not needed: with a profile angle available, there is
 * always somewhere inside the room to stand, and a fade would have meant a
 * per-instance opacity attribute on the batched structures — the same channel
 * the LOD crossfade already uses, which is not a thing to share by halves.
 */

/**
 * How far behind the listener's head the lens sits, in metres.
 *
 * ── Set from how much of the frame the foreground head takes ────────────────
 *
 * A chibi is three heads tall, so its head is a ~0.5 m sphere — and the
 * foreground of an over-the-shoulder shot is exactly that sphere. At the 1.25 m
 * this started at, it subtends 2·atan(0.25/1.25) = 22.6°, which against this
 * camera's FOV is **41 % of the frame width**: not a shoulder in the corner, a
 * wall down the left of the shot with the scene behind it.
 *
 * 2.05 m brings that to 13.6°, about a quarter of the width, which reads as a
 * foreground element. Further back is better framing and a smaller subject —
 * the speaker's face is the point, and at 2.05 + a 2.2 m conversation gap they
 * are 4.25 m out, where a chibi head is still ~12 % of the frame.
 */
const BEHIND = 2.05

/**
 * How far to the side. This is the whole of what "over the shoulder" means.
 *
 * Scaled with `BEHIND` so the foreground head keeps sitting off-centre rather
 * than sliding back toward the middle as the lens retreats.
 */
const SHOULDER = 0.82

/** How far above the listener's head. A shade above, looking very slightly down. */
const RISE = 0.14

/**
 * How much further back a shot starts before creeping in.
 *
 * The dolly. Eased out over `DOLLY_RATE`, so it is nearly spent by the end of
 * the first second of a line and completely gone by the second.
 */
const DOLLY = 0.5
const DOLLY_RATE = 1.4

/**
 * Where the lens aims, between the two heads. 1 is the speaker's face exactly.
 *
 * Not 1: aiming dead at the speaker pushes the listener to the very edge of the
 * frame, and 15 % back toward the midpoint is enough to seat their shoulder in
 * the corner where a foreground element belongs.
 */
const LOOK_BIAS = 0.85

/** Metres of clearance the lens keeps above any ground beneath or behind it. */
const CLEARANCE = 0.45

/** The lens's own radius for the prop sweep. Roughly a fist — it only has to not be *in* a wall. */
const LENS_RADIUS = 0.22

/**
 * The shortest the spring arm may get, in metres.
 *
 * Below about this the near plane starts eating the face the shot exists to
 * show. In a room too small to hold even this, the lens ends up slightly inside
 * a wall — which is the correct trade: a tight shot with a sliver of wall in one
 * corner is a shot, and a camera pulled into somebody's skull is not.
 */
const MIN_ARM = 0.85

/**
 * How near a head may be to the lens and still count as framed, in metres.
 *
 * Below this it fills the frame as a wall of skin - and, more to the point, a
 * lens this close to somebody is usually *inside* them.
 */
const MIN_SUBJECT = 0.95

/**
 * Seconds between checks that the held angle still frames both people.
 *
 * Four times a second: fast enough that a bad angle is corrected within a beat
 * of somebody moving, slow enough that the handful of segment tests it costs
 * never shows up in a profile.
 */
const SHOT_RECHECK = 0.25

/**
 * How far apart two people can be and still be having a conversation, in metres.
 *
 * Past this the over-the-shoulder framing stops meaning anything: the "listener"
 * is a dot at the bottom of the frame and the lens is a metre behind them,
 * pointing at somebody the length of a clearing away. Measured on the fireside
 * scene entered by a debug jump, where the boy had not been staged and stood
 * 15.3 m from his grandfather — the shot put the camera through the back wall of
 * the hut aiming at a figure outside it.
 *
 * Six metres is a generous room. Past it, the single is the honest shot.
 */
const MAX_CONVERSATION_SPAN = 6

/** How many points along the arm are tested against the terrain. */
const ARM_SAMPLES = 4

/** Smoothing rates. The aim settles faster than the body moves, as an operator does. */
const POSITION_RATE = 4.5
const LOOK_RATE = 6.5

/**
 * One camera angle, as a recipe rather than a position.
 *
 * A recipe because the two people move while they talk: the angle is chosen
 * once per shot and re-applied to their live positions every frame, so a
 * character shifting their weight moves the camera with them instead of
 * invalidating a position picked two seconds ago.
 */
interface Shot {
  kind: 'over' | 'profile' | 'single'
  /** Fraction of the full stand-off. Lower is a tighter, more cramped angle. */
  back: number
  /** Take the opposite shoulder to the one the reverse-cut picked. */
  flip: boolean
  /**
   * True for angles worth stopping at.
   *
   * The search stops at the first *preferred* angle that sees both faces. The
   * cramped and profile fallbacks are not preferred: they are there so a small
   * room gets a shot at all, and they should lose to a proper over-the-shoulder
   * whenever there is room for one.
   */
  preferred: boolean
}

const SINGLE: Shot = { kind: 'single', back: 1, flip: false, preferred: false }

/**
 * The angles, in the order a camera operator would try them.
 *
 * Reverse first — the whole grammar of shot/reverse-shot is that the angle
 * changes when the speaker does. Then the same side, in case the reverse is the
 * one against a wall. Then tighter versions of both. Then the profile, which
 * fits in a room that fits nothing else. `SINGLE` is the floor and is scored
 * along with the rest rather than being a special case.
 */
const SHOTS: readonly Shot[] = [
  { kind: 'over', back: 1, flip: false, preferred: true },
  { kind: 'over', back: 1, flip: true, preferred: true },
  { kind: 'over', back: 0.62, flip: false, preferred: true },
  { kind: 'over', back: 0.62, flip: true, preferred: true },
  { kind: 'profile', back: 1, flip: false, preferred: true },
  { kind: 'profile', back: 1, flip: true, preferred: true },
  { kind: 'profile', back: 0.6, flip: false, preferred: false },
  SINGLE
]

/** A head to frame: world position of the face, plus which way the body faces. */
export interface Focus {
  x: number
  y: number
  z: number
  /** Yaw in the same convention as `Combatant.facing` — 0 is +Z. */
  facing: number
}

export interface DialogueCameraOptions {
  camera: PerspectiveCamera
  groundAt: (x: number, z: number) => number
  collision: () => CollisionWorld | null
}

export class DialogueCamera {
  /** True while this rig owns the camera. The director checks it before letting the player camera run. */
  active = false

  private readonly options: DialogueCameraOptions
  /** Smoothed lens position. Nothing is written to the camera without going through here. */
  private readonly at = new Vector3()
  /** Smoothed aim point. */
  private readonly look = new Vector3()
  /**
   * Which shoulder the lens is over: +1 or −1.
   *
   * Flipped on every speaker change, which is the reverse angle. Flipping rather
   * than choosing means the two angles of a conversation stay consistent —
   * picking a side per shot from the geometry would sometimes give the same side
   * twice in a row, and a reverse shot that does not reverse reads as a jump cut.
   */
  private side = 1
  /** Seconds since the current shot started, for the dolly. */
  private shotTime = 0
  /** Seconds since the held angle was last checked for still working. */
  private sinceCheck = 0
  /** The angle currently being held. Re-picked only when the speaker changes. */
  private shot: Shot = SINGLE
  private speakerId = ''
  private seeded = false

  constructor(options: DialogueCameraOptions) {
    this.options = options
  }

  /**
   * Takes the camera, starting from wherever it is now.
   *
   * Seeding from the live camera is what makes the transition a move rather than
   * a cut: the first frame of the conversation is drawn from exactly where the
   * last frame of gameplay was, and the rig glides from there.
   */
  begin(): void {
    if (this.active) {
      return
    }
    this.active = true
    this.seeded = false
    this.shotTime = 0
    this.speakerId = ''
  }

  /** Hands the camera back. The player rig re-seeds itself on its next update. */
  end(): void {
    this.active = false
  }

  /**
   * One frame of the shot.
   *
   * `listener` may be null — a character talking to nobody, which the chapter
   * does have (Athalus swearing at a boar). That falls back to a three-quarter
   * front angle taken off the speaker's own facing, which is the single-subject
   * equivalent and needs no second body to place.
   */
  update(dt: number, speakerId: string, speaker: Focus, listener: Focus | null): void {
    if (!this.active) {
      return
    }
    if (speakerId !== this.speakerId) {
      // A new speaker is a new shot: reverse the angle, re-arm the dolly, and
      // pick the angle again from scratch.
      if (this.speakerId !== '') {
        this.side = -this.side
      }
      this.speakerId = speakerId
      this.shotTime = 0
      this.sinceCheck = 0
      this.chooseShot(speaker, listener)
    }
    this.shotTime += dt

    // The dolly, decaying from `DOLLY` to nothing over about a second and a half.
    const dolly = DOLLY * Math.exp(-this.shotTime * DOLLY_RATE)

    this.place(this.shot, speaker, listener, dolly)
    this.constrain(speaker)

    // ── Hold the angle, but notice when it has stopped working ────────────
    //
    // The angle is chosen once per shot, which is what stops the camera cutting
    // around every time somebody shifts their weight. The cost is that it is
    // chosen from *one instant* — and the cast move. A beat that walks a
    // character to their mark after the line has started, or a player who backs
    // away mid-conversation, leaves an angle that was right when it was picked
    // and frames a wall by the time it is seen.
    //
    // So the shot is re-checked four times a second and re-picked only when it
    // has actually failed. That is not the same as re-scoring every frame: a
    // shot that still holds both faces is never disturbed, so this cannot
    // oscillate between two angles that both work.
    this.sinceCheck += dt
    if (this.sinceCheck > SHOT_RECHECK) {
      this.sinceCheck = 0
      if (!this.canFrame(speaker) || (listener !== null && !this.canFrame(listener))) {
        this.chooseShot(speaker, listener)
        this.place(this.shot, speaker, listener, dolly)
        this.constrain(speaker)
      }
    }

    const camera = this.options.camera
    if (!this.seeded) {
      // First frame: start at the gameplay camera, aim where it was aiming. The
      // glide toward `_wanted` begins on the next frame.
      this.at.copy(camera.position)
      camera.getWorldDirection(_forward)
      this.look.copy(camera.position).addScaledVector(_forward, 3)
      this.seeded = true
    }
    this.at.lerp(_wanted, Math.min(1, dt * POSITION_RATE))
    this.look.lerp(_target, Math.min(1, dt * LOOK_RATE))
    camera.position.copy(this.at)
    camera.lookAt(this.look)
  }

  /**
   * ─── Choosing the angle ─────────────────────────────────────────────────
   *
   * Runs **once per shot**, not per frame, and that is a stability decision as
   * much as a cost one: re-scoring every frame lets the camera flip angles
   * mid-sentence whenever a character shifts their weight, which reads as a cut
   * nobody asked for. An operator picks the angle and then holds it.
   *
   * Candidates are tried in order of how good they look when they work, and the
   * first preferred one that can **see both heads** wins. If none can, the
   * least-bad wins — scored by how many heads are visible first and how much arm
   * it keeps second, so a cramped shot of both beats a roomy shot of one.
   *
   * ── Why this replaced "shorten the arm until it fits" ────────────────────
   *
   * Inside the storyteller's hut there is no amount of shortening that makes an
   * over-the-shoulder work: the lens wants to be two metres behind a man sitting
   * a metre from the back wall, and the room is smaller than the shot. The old
   * code pushed the lens through the wall and framed the scene from the garden,
   * through the rafters. The answer is not a shorter version of the wrong angle,
   * it is a different angle — and a profile or a reverse is inside the room for
   * free, because it stands where the two of them already are.
   */
  private chooseShot(speaker: Focus, listener: Focus | null): void {
    if (!listener) {
      this.shot = SINGLE
      return
    }
    const span = Math.hypot(speaker.x - listener.x, speaker.z - listener.z)
    if (span < 0.35 || span > MAX_CONVERSATION_SPAN) {
      // Too close: two cast members parked on the same mark, which happens when
      // a beat repositions the party — there is no shoulder to shoot over.
      // Too far: see `MAX_CONVERSATION_SPAN`.
      this.shot = SINGLE
      return
    }

    let best = SINGLE
    let bestScore = -1
    for (const shot of SHOTS) {
      this.place(shot, speaker, listener, 0)
      this.constrain(speaker)
      let visible = 0
      if (this.canFrame(speaker)) {
        visible++
      }
      if (this.canFrame(listener)) {
        visible++
      }
      // Arm length only breaks ties between equally-visible angles; a tenth of a
      // metre must never outrank seeing somebody's face.
      const arm = Math.hypot(_wanted.x - speaker.x, _wanted.y - speaker.y, _wanted.z - speaker.z)
      const score = visible * 100 + (arm < 9 ? arm : 9)
      if (score > bestScore) {
        bestScore = score
        best = shot
      }
      if (visible === 2 && shot.preferred) {
        // The first preferred angle that works is the one an operator would have
        // taken. Stop looking.
        break
      }
    }
    this.shot = best
  }

  /**
   * True when this head is actually *in the shot* from the candidate lens.
   *
   * ── Four tests, and the first version only had the last one ──────────────
   *
   * "Nothing solid is in the way" is necessary and nowhere near sufficient, and
   * the failure it allows is spectacular: measured in the storyteller's hut, the
   * spring arm shortened until the lens was **0.41 m from the listener's head**
   * and reported him perfectly visible — he was, in the sense that no wall stood
   * between them. He projected to screen x = 6.16, which is five frame-widths
   * off the right edge, because the camera was inside his skull.
   *
   * So: in front of the lens, inside the frustum, far enough away to be a
   * subject rather than a texture, and unoccluded.
   */
  private canFrame(head: Focus): boolean {
    _toHead.set(head.x - _wanted.x, head.y - _wanted.y, head.z - _wanted.z)
    const distance = _toHead.length()
    // A head closer than this is not framed, it is worn.
    if (distance < MIN_SUBJECT) {
      return false
    }
    _toHead.multiplyScalar(1 / distance)
    _forward.set(_target.x - _wanted.x, _target.y - _wanted.y, _target.z - _wanted.z)
    const aimLength = _forward.length()
    if (aimLength < 1e-4) {
      return false
    }
    _forward.multiplyScalar(1 / aimLength)

    // Horizontal half-angle from the vertical FOV and the aspect. A cone rather
    // than a true frustum: it is the *inscribed* cone, so it is conservative on
    // the diagonals, which is the right way to be wrong for a shot.
    const camera = this.options.camera
    const halfVertical = (camera.fov * Math.PI) / 360
    const halfAngle = Math.atan(Math.tan(halfVertical) * Math.max(1, camera.aspect))
    // 0.95 rather than something tighter because an over-the-shoulder is
    // *supposed* to have the foreground head near the frame edge — that is what
    // makes it a foreground element. Anything stricter rejects the shot this
    // class exists to produce.
    if (_toHead.dot(_forward) < Math.cos(halfAngle * 0.95)) {
      return false
    }

    const collision = this.options.collision()
    if (!collision) {
      return true
    }
    // `> 0.985`: the last centimetre or two of the ray is inside the head's own
    // body, and a figure with their back to a wall would otherwise report
    // themselves as occluded by it.
    return collision.segmentHit(_wanted.x, _wanted.y, _wanted.z, head.x, head.y, head.z) > 0.985
  }

  /**
   * Puts `_wanted` and `_target` where `shot` says, from live positions.
   *
   * Split from `chooseShot` because the recipe is chosen once and applied every
   * frame — people move while they talk, and the shot has to follow them.
   */
  private place(shot: Shot, speaker: Focus, listener: Focus | null, dolly: number): void {
    if (shot.kind === 'single' || !listener) {
      // Three-quarter front off the speaker's own facing. Straight on is a
      // passport photo — the angle is what gives the head volume.
      const yaw = speaker.facing + this.side * 0.7
      const distance = 2.1 + dolly
      _wanted.set(speaker.x + Math.sin(yaw) * distance, speaker.y + RISE * 1.6, speaker.z + Math.cos(yaw) * distance)
      _target.set(speaker.x, speaker.y, speaker.z)
      return
    }

    let axisX = speaker.x - listener.x
    let axisZ = speaker.z - listener.z
    const span = Math.hypot(axisX, axisZ) || 1
    axisX /= span
    axisZ /= span
    // Perpendicular, in the ground plane. Which way round is `side`'s business.
    const rightX = axisZ
    const rightZ = -axisX
    const side = shot.flip ? -this.side : this.side

    if (shot.kind === 'profile') {
      // Square to the line between them, both faces in three-quarter. The shot
      // you use when the room is too small to get behind anybody — and the one
      // that is always inside it, because it stands where they already are.
      const midX = (speaker.x + listener.x) * 0.5
      const midZ = (speaker.z + listener.z) * 0.5
      const out = shot.back * (span * 0.5 + 1.5) + dolly
      _wanted.set(midX + rightX * out * side, (speaker.y + listener.y) * 0.5 + RISE * 2.4, midZ + rightZ * out * side)
      // Still biased at the speaker, so a profile two-shot still says who is
      // talking.
      _target.set(
        midX + (speaker.x - midX) * 0.7,
        (speaker.y + listener.y) * 0.5 + (speaker.y - listener.y) * 0.35,
        midZ + (speaker.z - midZ) * 0.7
      )
      return
    }

    // Over the shoulder: behind the listener, across their shoulder, onto the
    // speaker. See the header on why it is the *listener's* shoulder.
    const back = BEHIND * shot.back + dolly
    _wanted.set(
      listener.x - axisX * back + rightX * SHOULDER * shot.back * side,
      listener.y + RISE,
      listener.z - axisZ * back + rightZ * SHOULDER * shot.back * side
    )
    // Aim mostly at the speaker's face, biased back toward the midpoint so the
    // listener keeps a corner of the frame instead of being cropped out of it.
    _target.set(
      listener.x + (speaker.x - listener.x) * LOOK_BIAS,
      listener.y + (speaker.y - listener.y) * LOOK_BIAS,
      listener.z + (speaker.z - listener.z) * LOOK_BIAS
    )
  }

  /**
   * Pulls `_wanted` out of anything solid. See the three constraints in the header.
   *
   * The order matters. Props are resolved first, on the horizontal plane, and
   * the terrain clamps are applied after — because the prop sweep can move the
   * lens sideways onto completely different ground, and clamping to the old
   * ground height would then park it inside a slope.
   */
  private constrain(focus: Focus): void {
    const collision = this.options.collision()
    if (collision) {
      // ── A spring arm shortens; it does not slide ────────────────────────
      //
      // This used to ask `resolveMove` how far the lens got and shorten to that.
      // It never once shortened anything, because `resolveMove` is written for a
      // *character*: meeting a wall it slides along it and ends up the same
      // distance from where it started. Measured in the storyteller's hut —
      // sweeping 6 m out from the fireside in sixteen directions reported a
      // reach of ~6 m in all sixteen, inside a room four metres across. The
      // camera asked where the wall was, was told there wasn't one, and framed
      // the scene from the garden through the rafters.
      //
      // `segmentHit` is the honest question: it returns *where along the line*
      // the first blocking prop is, and the lens is pulled straight back in
      // along its own direction to just short of it. The framing degrades — the
      // shot gets tighter — rather than swinging to an angle nobody chose.
      const armX = _wanted.x - focus.x
      const armY = _wanted.y - focus.y
      const armZ = _wanted.z - focus.z
      const length = Math.hypot(armX, armY, armZ)
      if (length > 1e-3) {
        const hit = collision.segmentHit(focus.x, focus.y, focus.z, _wanted.x, _wanted.y, _wanted.z)
        if (hit < 1) {
          // Stop a lens-radius short of the surface, and never closer than
          // `MIN_ARM` — a lens inside the speaker's own head is worse than one
          // against a wall.
          const stop = Math.max(MIN_ARM, hit * length - LENS_RADIUS)
          const t = Math.min(1, stop / length)
          _wanted.set(focus.x + armX * t, focus.y + armY * t, focus.z + armZ * t)
        }
      }
    }

    // The ground under the lens, and the ground along the arm behind it. The
    // second is what stops the rig reversing into a hillside on a slope, which
    // `resolveMove` cannot see because a hill is not a prop.
    let floor = this.options.groundAt(_wanted.x, _wanted.z)
    for (let i = 1; i <= ARM_SAMPLES; i++) {
      const t = i / (ARM_SAMPLES + 1)
      const height = this.options.groundAt(focus.x + (_wanted.x - focus.x) * t, focus.z + (_wanted.z - focus.z) * t)
      if (height > floor) {
        floor = height
      }
    }
    if (_wanted.y < floor + CLEARANCE) {
      _wanted.y = floor + CLEARANCE
    }
  }
}

// Module-level scratch. One rig runs at a time — there is one camera — so these
// are safe to share, and the alternative is three `Vector3`s allocated per frame
// in the one code path GDD section 5 is most explicit about.
const _wanted = new Vector3()
const _target = new Vector3()
const _forward = new Vector3()
const _toHead = new Vector3()
