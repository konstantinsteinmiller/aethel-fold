import { PerspectiveCamera, Vector3 } from 'three'
import { type ActionId, DEFAULT_BINDINGS, mouseCode } from '@/use/useKeybindings'
import type { Combatant } from '../combat/Combatant'
import type { Intent } from '../combat/brains'
import type { CollisionWorld } from '../level/types'

/**
 * What the player is holding, as far as the controls are concerned.
 *
 * Three values and not the full `ItemKind` union, because the *control scheme*
 * only has three cases: something you swing, something you shoot, and empty
 * hands. A scrantis and a war axe are both `melee` here even though they are
 * nothing alike in `combat/movesets.ts` — the difference between them is what
 * the swing does, not what the buttons mean.
 */
export type WeaponMode = 'melee' | 'bow' | 'none'

/**
 * ─── Playing Athalus ────────────────────────────────────────────────────────
 *
 * Input and a camera, and nothing else. It does not move the character, it does
 * not attack, it does not know what a bandit is — it fills in an `Intent`, the
 * same struct a brain fills in, and `CombatDirector` does the rest.
 *
 * That symmetry is the point and is worth restating from the director's side: a
 * bug in lunge distance, in guard arcs or in dodge i-frames is a bug the player
 * can *watch happen to a bandit*, rather than one that only ever manifests on
 * the one actor nobody can see from outside.
 *
 * ── Third person, not the world's first-person walker ───────────────────────
 *
 * `player/PlayerController.ts` is an excellent first-person walker with a step
 * probe, a capsule and a bob, and it is the wrong tool here for one reason:
 * **you cannot read a melee fight from inside your own head.** Every mechanic in
 * `combat/` — the guard's 140° arc, the boar's straight-line charge, the two
 * bandits circling behind you — is a *spatial* read, and first person deletes
 * the half of the space that is behind you. So the story runs its own camera.
 *
 * It is also, deliberately, not the orbit rig. `OrbitCameraController` frames a
 * *point*; a combat camera has to frame the space between two moving bodies, and
 * the difference shows up the moment the boar charges: an orbit camera keeps the
 * player centred and the animal leaves frame, while this one leads.
 *
 * ── What it deliberately does not do ────────────────────────────────────────
 *
 * No lock-on. It was written and cut: with `AGGRO_TOKENS` at two, a lock camera
 * spends the fight pointing at one of five men while the other four walk round
 * the back, and the chapter's ambush is specifically about being surrounded.
 * What replaced it is the shoulder offset below, which widens as enemies
 * multiply — the camera pulls back and up when the fight gets crowded, which
 * shows the crowd instead of hiding it behind one target.
 */

export interface StoryPlayerOptions {
  camera: PerspectiveCamera
  /** Terrain height, for the camera's own ground clamp. */
  groundAt: (x: number, z: number) => number
  /**
   * The world's prop colliders, for the camera's spring arm.
   *
   * A getter rather than the object, because the collision world is rebuilt
   * whenever the level changes and holding it would pin a dead one — the same
   * shape `StoryDirectorOptions` and `DialogueCamera` already use.
   *
   * Optional: three suites construct a player with no world at all.
   */
  collision?: () => CollisionWorld | null
}

const _forward = new Vector3()
const _right = new Vector3()
const _wanted = new Vector3()
const _look = new Vector3()

/**
 * Metres behind and above the character at rest.
 *
 * The height was 2.05 and is 2.85, and the reason is grass. A blade at `ultra`
 * detail stands about 0.5 m, the camera's own ground clamp keeps it 0.6 m off
 * the terrain, and at 2.05 m of shoulder height on flat ground the lens sat low
 * enough that the near field was a wall of grass — measured on screen, the
 * bottom half of the frame. Raising it 0.8 m and pitching the default view down
 * puts the horizon a third of the way up and the ground plane where it belongs.
 */
const BASE_DISTANCE = 5.6
const BASE_HEIGHT = 2.85
/** The camera looks at a point this far above the character's feet. */
const FOCUS_HEIGHT = 1.15

/** Radians per pixel of mouse travel. */
const LOOK_SENSITIVITY = 0.0026
/** Pitch limits. Down is negative. */
const MIN_PITCH = -0.95
const MAX_PITCH = 0.62

/**
 * How fast the camera catches up, per second.
 *
 * Split, and the asymmetry is deliberate: **position lags, rotation does not.**
 * A camera whose *rotation* lags the mouse feels broken at any value, while one
 * whose position lags the character by 12 % of a second reads as weight. Two
 * constants rather than one is what lets both be true.
 */
const POSITION_LERP = 9
const AIM_LERP = 26

/** Where the camera sits while the bow is drawn. See `update`. */
/**
 * ─── The spring arm ─────────────────────────────────────────────────────────
 *
 * The follow camera sits 5.6 m behind the character on a rigid arm, and until
 * now that arm went through walls. Stand next to a building, turn, and the lens
 * ends up *inside* it: back-face culling then removes the near wall and most of
 * the roof, and the building appears to vanish. That is what it was reported as
 * — "this house disappears visibly on camera rotation" — and it is not a culling
 * bug at all. Measured afterwards over 14 400 samples (five hamlet buildings ×
 * four distances × two heights × eight approaches × forty-five headings), the
 * instanced field never once dropped a building whose geometry was on screen.
 *
 * `DialogueCamera` has solved this since it was written and its header argues
 * the case at length; the follow rig simply never got the same treatment. The
 * numbers below are its numbers, for the same reasons, with one change: the
 * arm may get shorter here than it may there, because a conversation can afford
 * to give up the shot and gameplay cannot afford to give up the view.
 */
/**
 * How much clearance the lens keeps from whatever it stopped against.
 *
 * 0.45 rather than the dialogue camera's 0.22, and the number comes from the
 * near plane: at 0.5 m anything closer than that is clipped away, so a lens
 * parked 22 cm off a wall is a lens looking through it. Measured against the
 * hamlet cottage, 0.25 left the camera 4 cm outside the collider box — outside,
 * but well inside the near plane's reach of the roof overhang.
 */
const LENS_RADIUS = 0.45

/**
 * The shortest the arm may get, in metres.
 *
 * 1.1 rather than the dialogue camera's 0.85. Below about a metre the character
 * fills the frame and the player cannot see what they are walking into, which
 * during play is worse than the sliver of wall that the alternative costs. The
 * near plane is 0.5, so this still clears it twice over.
 */
const MIN_ARM = 1.1

const AIM_DISTANCE = 2.9
const AIM_HEIGHT = 1.75
/** Metres to the character's right, so the body clears the crosshair. */
const AIM_SHOULDER = 0.75
/** How fast the shoulder offset eases in and out, per second. */
const AIM_LERP_RATE = 7

export class StoryPlayer {
  readonly camera: PerspectiveCamera

  /** Yaw the camera orbits at. The character's facing follows it while moving. */
  yaw = 0
  pitch = -0.24

  /**
   * What is in the player's hands, pushed in by the director each frame.
   *
   * The one piece of *game* state this input layer knows about, and it earns
   * its place: the guard button and the aim button are the same button, and
   * which one it is depends entirely on this. See `onPointerDown`.
   */
  weaponMode: WeaponMode = 'none'

  /** Held guard. Melee only — with a bow up, the same button aims instead. */
  private guarding = false
  private wantsLight = false
  private wantsHeavy = false
  private wantsDodge = false
  private wantsShoot = false
  private wantsInteract = false
  private wantsDraw = false
  /** True while the bow is being drawn. Released on button-up. */
  aiming = false
  aimCharge = 0
  /** True while sprint is held *and* the character is actually going forward. */
  sprinting = false

  /**
   * The live binding table, as a **plain object**.
   *
   * Copied in from `use/useKeybindings.ts` by the Vue shell rather than read
   * from the `computed` directly, and that is the GDD §0 line: this class runs
   * inside the frame loop, and a reactive read in an update path is how Vue
   * ends up tracking dependencies sixty times a second on something that
   * changes twice a session. The shell watches the ref and calls `setBindings`;
   * everything in here reads a frozen snapshot.
   */
  private bindings: Record<ActionId, string> = { ...DEFAULT_BINDINGS }

  private readonly keys = new Set<string>()
  private element: HTMLElement | null = null
  private locked = false
  private enabled = true

  /** Smoothed camera position, so a frame drop does not snap the view. */
  private readonly at = new Vector3()
  private started = false

  /** Crowd pressure, 0..1. Pulls the camera back — see the header. */
  private crowding = 0
  /** 0 = free camera, 1 = fully over the shoulder. Eased. See `update`. */
  private shoulder = 0

  constructor(private readonly options: StoryPlayerOptions) {
    this.camera = options.camera
  }

  attach(element: HTMLElement): void {
    this.detach()
    this.element = element
    element.addEventListener('pointerdown', this.onPointerDown)
    element.addEventListener('pointerup', this.onPointerUp)
    element.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    document.addEventListener('pointerlockchange', this.onLockChange)
  }

  detach(): void {
    const element = this.element
    if (element) {
      element.removeEventListener('pointerdown', this.onPointerDown)
      element.removeEventListener('pointerup', this.onPointerUp)
      element.removeEventListener('contextmenu', this.onContextMenu)
    }
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('pointerlockchange', this.onLockChange)
    this.keys.clear()
    this.element = null
  }

  /**
   * Turns input off without detaching.
   *
   * Used for dialogue and for the frame-story cards. **The held keys are
   * dropped**, which is the whole reason this is a method rather than a flag the
   * caller checks: a player holding W when a conversation starts, and still
   * holding it when the conversation ends, would otherwise walk out of the scene
   * the instant control returned.
   */
  setEnabled(on: boolean): void {
    this.enabled = on
    if (!on) {
      this.keys.clear()
      this.guarding = false
      this.wantsLight = false
      this.wantsHeavy = false
      this.wantsDodge = false
      this.wantsShoot = false
      this.wantsDraw = false
      this.aiming = false
      this.aimCharge = 0
      this.sprinting = false
      if (this.locked) {
        document.exitPointerLock?.()
      }
    }
  }

  /** True once the pointer is captured. The HUD shows a prompt until it is. */
  get pointerLocked(): boolean {
    return this.locked
  }

  private readonly onLockChange = (): void => {
    this.locked = document.pointerLockElement === this.element
  }

  private readonly onContextMenu = (event: Event): void => {
    // The right button is the guard (or the bow's aim). Without this it is a
    // context menu, every time.
    event.preventDefault()
  }

  /** Which action a raw code is bound to right now, or null. */
  private action(code: string): ActionId | null {
    for (const id of Object.keys(this.bindings) as ActionId[]) {
      if (this.bindings[id] === code) {
        return id
      }
    }
    return null
  }

  /**
   * Hands the input layer a fresh binding table.
   *
   * A copy, deliberately: the caller owns a reactive object and this class must
   * not hold a reference into it. See the note on `bindings`.
   */
  setBindings(next: Record<ActionId, string>): void {
    this.bindings = { ...next }
  }

  /**
   * Raises or drops whatever `guardOrAim` means for the weapon in hand.
   *
   * ── One button, two meanings, and why that is not confusing ──────────────
   *
   * With a blade up it is a guard, and letting go inside `PARRY_WINDOW` of an
   * incoming blow is a parry. With a bow up it is the draw, and letting go
   * looses. Those look like two different mechanics and they are the same
   * *intent* — "commit to the weapon I am holding" — which is why they share a
   * button rather than sitting on two the player has to choose between under
   * pressure. The controls panel relabels the row from `weaponMode`, so what is
   * on screen always matches what the button will do.
   *
   * Empty hands do nothing at all rather than falling back to a guard: a guard
   * with no weapon is a stance the animation layer has no pose for, and a
   * player who thinks they are blocking with their forearms is a player about
   * to be surprised.
   */
  private setGuardOrAim(down: boolean): void {
    if (this.weaponMode === 'bow') {
      if (down) {
        this.aiming = true
      } else if (this.aiming) {
        this.aiming = false
        // Only a *charged* draw looses. A tap is a nocked arrow put back, which
        // is what stops the bow being a faster sword.
        if (this.aimCharge > 0.55) {
          this.wantsShoot = true
        }
        this.aimCharge = 0
      }
      return
    }
    if (this.weaponMode === 'melee') {
      this.guarding = down
    }
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled) {
      return
    }
    if (!this.locked) {
      // First click captures the pointer and does nothing else — a click that
      // both grabs the mouse and swings a sword is a swing the player did not
      // ask for, in a direction they could not see.
      void this.element?.requestPointerLock?.()
      return
    }
    this.press(mouseCode(event.button), true)
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.press(mouseCode(event.button), false)
  }

  /**
   * One place every binding is resolved, whether it came from a key or a mouse
   * button.
   *
   * Written as one function rather than two handlers because the binding table
   * makes no distinction — a player may put "guard" on a keyboard key and
   * "interact" on a mouse button, and a handler pair that each only knew about
   * its own device would silently drop half of those.
   */
  private press(code: string, down: boolean): void {
    const action = this.action(code)
    if (action === null) {
      return
    }
    switch (action) {
      case 'attackLight':
        if (down) {
          this.wantsLight = true
        }
        return
      case 'attackHeavy':
        if (down) {
          this.wantsHeavy = true
        }
        return
      case 'guardOrAim':
        this.setGuardOrAim(down)
        return
      case 'dodge':
        if (down) {
          this.wantsDodge = true
        }
        return
      case 'interact':
        if (down) {
          this.wantsInteract = true
        }
        return
      case 'drawWeapon':
        if (down) {
          this.wantsDraw = true
        }
        return
      default:
        // Movement and sprint are *held*, so they are read from `keys` in
        // `fillIntent` rather than latched here. The shell owns pause, the
        // quick-save pair and the controls toggle.
        return
    }
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.enabled || !this.locked) {
      return
    }
    this.yaw -= event.movementX * LOOK_SENSITIVITY
    this.pitch -= event.movementY * LOOK_SENSITIVITY
    this.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.pitch))
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) {
      return
    }
    const code = event.code
    // Auto-repeat would latch a fresh dodge every 30 ms while the key is held.
    if (event.repeat) {
      return
    }
    this.keys.add(code)
    // Space scrolls the page and the function keys open browser tools; both are
    // bindable, so the guard is on *whether the code is bound* rather than on a
    // list of codes that would go stale the moment somebody rebound one.
    if (this.action(code) !== null && (code === 'Space' || code.startsWith('F') || code === 'Tab')) {
      event.preventDefault()
    }
    this.press(code, true)
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code)
    this.press(event.code, false)
  }

  /** True once, then cleared. The director polls it to draw or sheathe. */
  takeDraw(): boolean {
    const wanted = this.wantsDraw
    this.wantsDraw = false
    return wanted
  }

  /** Whether the key bound to an action is down right now. */
  private held(action: ActionId): boolean {
    const code = this.bindings[action]
    return code !== '' && this.keys.has(code)
  }

  /** True once, then cleared. The story director polls it for `interact` beats. */
  takeInteract(): boolean {
    const wanted = this.wantsInteract
    this.wantsInteract = false
    return wanted
  }

  /**
   * Puts everything down without standing the input layer down.
   *
   * ── Why this is not `setEnabled(false)` ─────────────────────────────────
   *
   * The chapter needs a state where the *character* is not accepting orders and
   * the *camera* still is: walking to a bench, sitting down on it, and sitting
   * on it for as long as the player likes. `setEnabled(false)` drops the pointer
   * lock and stops `onPointerMove` reading, so a player who sat down would find
   * the mouse released and the view frozen — which reads as the game having
   * crashed, not as sitting down.
   *
   * So the director keeps input alive, calls `fillIntent` to *drain* the
   * one-shot latches, and overwrites the movement fields. This is the rest of
   * that: the held states — the guard, the bow's draw — are not latches and
   * survive a drained frame, so a guard raised on the way to a bench would
   * otherwise arrive as somebody sitting down behind a shield, and a drawn bow
   * would keep the camera pulled in over the shoulder for the whole scene.
   *
   * Idempotent, and called every frame the seat owns the character.
   */
  lowerWeapon(): void {
    this.guarding = false
    this.aiming = false
    this.aimCharge = 0
    this.sprinting = false
    this.wantsLight = false
    this.wantsHeavy = false
    this.wantsDodge = false
    this.wantsShoot = false
  }

  /**
   * True while the player is asking to move under their own steam.
   *
   * Exposed so the chapter can let a movement key mean "no, never mind" during
   * a scripted walk-up. It reads the same held-key set and the same arrow-key
   * aliases `fillIntent` does — deliberately the same source, because a second
   * copy of that list is a second thing to forget when a binding is added.
   */
  get moving(): boolean {
    return (
      this.held('moveForward') ||
      this.held('moveBack') ||
      this.held('moveLeft') ||
      this.held('moveRight') ||
      this.keys.has('ArrowUp') ||
      this.keys.has('ArrowDown') ||
      this.keys.has('ArrowLeft') ||
      this.keys.has('ArrowRight')
    )
  }

  /**
   * Fills the combat intent from this frame's input.
   *
   * Movement is **camera-relative**, which is the only scheme that works with a
   * free-look third-person camera: W is "away from the camera", not "north", and
   * a player who has turned the camera 90° expects W to have turned with it.
   */
  fillIntent(intent: Intent, self: Combatant, dt: number): void {
    intent.moveX = 0
    intent.moveZ = 0
    intent.throttle = 0
    intent.attackLight = false
    intent.attackHeavy = false
    intent.dodge = false
    intent.shoot = false
    intent.guard = this.guarding

    if (!this.enabled) {
      intent.facing = self.facing
      intent.guard = false
      return
    }

    if (this.aiming) {
      this.aimCharge = Math.min(1, this.aimCharge + dt / BOW_DRAW_SECONDS)
    }

    // The camera's own basis, flattened. `_forward` is where the camera looks
    // with the pitch removed — pitching the view must not make W slower.
    _forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))
    // ── Right, and it really is right ────────────────────────────────────
    //
    // This world is right-handed and Y-up, so with `forward` on +Z the
    // character's right hand is on **−X** — `equipment.ts` says so at the top,
    // and every socket in the game is measured against it. Right is therefore
    // `forward x up = (-forward.z, 0, forward.x)`.
    //
    // It shipped as `(forward.z, 0, -forward.x)`, which is the exact negative:
    // **A strafed right and D strafed left.** It is a sign error that reads as
    // a control preference, which is why it survived — the movement is smooth,
    // the camera is correct, and only a player who has ever used a game before
    // notices that the keys are the wrong way round.
    _right.set(-_forward.z, 0, _forward.x)

    let x = 0
    let z = 0
    // The arrow keys are a permanent alias rather than a binding: they are what
    // a player tries first when WASD does not work, and losing that fallback to
    // a rebind is how somebody ends up unable to move at all.
    if (this.held('moveForward') || this.keys.has('ArrowUp')) {
      x += _forward.x
      z += _forward.z
    }
    if (this.held('moveBack') || this.keys.has('ArrowDown')) {
      x -= _forward.x
      z -= _forward.z
    }
    if (this.held('moveLeft') || this.keys.has('ArrowLeft')) {
      x -= _right.x
      z -= _right.z
    }
    if (this.held('moveRight') || this.keys.has('ArrowRight')) {
      x += _right.x
      z += _right.z
    }

    const length = Math.hypot(x, z)
    // ── Sprint ──────────────────────────────────────────────────────────────
    //
    // Held, forward-only, and refused while aiming, guarding or committed.
    // Forward-only because a character who back-pedals at 5.2 m/s is a character
    // with no reason ever to turn around, and the boar chase is built on the
    // player having to commit to a direction.
    const wantsSprint = this.held('sprint')
    const goingForward = length > 1e-4 && x * _forward.x + z * _forward.z > 0.35 * length
    this.sprinting = wantsSprint && goingForward && !this.aiming && !this.guarding && !self.busy

    if (length > 1e-4) {
      intent.moveX = x
      intent.moveZ = z
      // Aiming and guarding both walk. Neither should be a full run: a bow drawn
      // at a sprint and a shield held at a sprint are both things this figure
      // cannot do, and slowing them is how the player is told so.
      intent.throttle = this.aiming ? 0.4 : this.guarding ? 0.55 : this.sprinting ? SPRINT_THROTTLE : 1
    }

    // ── Which way the character faces ──────────────────────────────────────
    //
    // Toward the camera while aiming, guarding or attacking; toward the movement
    // otherwise. That split is what makes strafing round a guard possible: a
    // character who always faces their movement cannot circle an enemy while
    // keeping a shield between them.
    if (this.aiming || this.guarding || self.busy) {
      intent.facing = this.yaw
    } else if (length > 1e-4) {
      intent.facing = Math.atan2(x, z)
    } else {
      intent.facing = self.facing
    }

    intent.attackLight = this.wantsLight
    intent.attackHeavy = this.wantsHeavy
    intent.dodge = this.wantsDodge
    intent.shoot = this.wantsShoot

    this.wantsLight = false
    this.wantsHeavy = false
    this.wantsDodge = false
    this.wantsShoot = false
  }

  /** Where an arrow should fly, from the camera's own aim. */
  aimDirection(out: Vector3): Vector3 {
    return out.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch) + 0.06, Math.cos(this.yaw) * Math.cos(this.pitch)).normalize()
  }

  /**
   * Places the camera behind the character.
   *
   * `crowd` is how many hostiles are engaged, and it pulls the camera back and
   * up — see the header on why this replaced a lock-on. The pull is smoothed
   * over about a second so a bandit arriving does not shove the view.
   */
  update(dt: number, focusX: number, focusY: number, focusZ: number, crowd: number): void {
    const wantedCrowding = Math.min(1, crowd / 3)
    this.crowding += (wantedCrowding - this.crowding) * Math.min(1, dt * 1.2)

    // ── Aiming pulls the camera in over the right shoulder ────────────────
    //
    // Not a zoom. A bow needs the *shot line* to be readable, and the shot line
    // leaves the character's hands — so the camera comes closer (5.6 → 2.9 m),
    // drops a little, and slides 0.75 m to the character's right so the body
    // stops covering the middle of the screen where the crosshair is. That
    // offset is the whole of what "over the shoulder" means and it is the
    // reason a third-person shooter looks like one.
    //
    // Eased rather than snapped, over about a fifth of a second: an instant
    // shoulder swap on a button press reads as the camera glitching.
    this.shoulder += ((this.aiming ? 1 : 0) - this.shoulder) * Math.min(1, dt * AIM_LERP_RATE)

    const distance = BASE_DISTANCE + this.crowding * 1.9 - this.shoulder * (BASE_DISTANCE - AIM_DISTANCE)
    const height = BASE_HEIGHT + this.crowding * 0.85 - this.shoulder * (BASE_HEIGHT - AIM_HEIGHT)

    const cosPitch = Math.cos(this.pitch)
    // The character's own right, which is -X of the facing (see `fillIntent`).
    const rightX = -Math.cos(this.yaw)
    const rightZ = Math.sin(this.yaw)
    const offset = this.shoulder * AIM_SHOULDER
    _wanted.set(
      focusX - Math.sin(this.yaw) * distance * cosPitch + rightX * offset,
      focusY + height - Math.sin(this.pitch) * distance,
      focusZ - Math.cos(this.yaw) * distance * cosPitch + rightZ * offset
    )

    // Never below the ground, and never so close to it that the near plane
    // clips into a hill. 0.6 m is a little over the near plane at this FOV.
    // Never below the ground, and never inside the grass either: a blade is
    // ~0.5 m at `ultra`, so a clamp at 0.6 m puts the lens exactly in the canopy
    // on any downslope. 1.25 m clears it.
    const ground = this.options.groundAt(_wanted.x, _wanted.z)
    if (_wanted.y < ground + 1.25) {
      _wanted.y = ground + 1.25
    }

    // The arm, before the smoothing.
    this.shortenArm(focusX, focusY, focusZ, _wanted)

    if (!this.started) {
      this.at.copy(_wanted)
      this.started = true
    } else {
      this.at.lerp(_wanted, Math.min(1, dt * POSITION_LERP))
    }

    // ── And again, after it ────────────────────────────────────────────────
    //
    // Constraining only the *target* is not enough, and the failure is the one
    // the whole spring arm exists to prevent. `at` chases `_wanted` over about a
    // fifth of a second, so on the frame a wall swings between the character and
    // the lens the target jumps inward while `at` is still out beyond it — and
    // for those few frames the camera travels *through* the wall it was just
    // told to stop at. Re-running the sweep on the smoothed position costs a
    // second `segmentHit` and makes the guarantee unconditional: whatever the
    // easing does, the position finally handed to the camera is outside the
    // geometry.
    //
    // It also gives the right asymmetry for free — the arm shortens instantly
    // and lengthens smoothly, which is what a spring arm is supposed to do.
    this.shortenArm(focusX, focusY, focusZ, this.at)

    this.camera.position.copy(this.at)

    // The look-at slides with the shoulder too, or the camera moves right and
    // then immediately turns back to centre the body it just moved off.
    _look.set(focusX + rightX * offset * 0.8, focusY + FOCUS_HEIGHT + this.shoulder * 0.12, focusZ + rightZ * offset * 0.8)
    // Rotation is snapped rather than lerped — see `AIM_LERP`'s note. The lerp
    // here is only to stop a teleport from whipping the view.
    const blend = Math.min(1, dt * AIM_LERP)
    _wanted.copy(this.camera.getWorldDirection(_forward)).multiplyScalar(1 - blend)
    this.camera.lookAt(_look)
  }

  /**
   * Pulls a camera position in along its own arm to just short of the first
   * blocking prop between it and the character.
   *
   * `segmentHit` is the honest question and `resolveMove` is not: the latter is
   * written for a *character*, so meeting a wall it slides along it and reports
   * the same distance it started with. `DialogueCamera` records measuring
   * exactly that — sweeping 6 m out from the fireside in sixteen directions
   * reported a reach of ~6 m in all sixteen, inside a room four metres across.
   *
   * The ray starts at the point the camera is *looking at*, not at the
   * character's feet: an arm anchored at ground level is an arm that clips
   * through every doorstep and reports a wall wherever the ground rises.
   *
   * Mutates `target` in place — this runs twice a frame and `src/world/` does
   * not allocate in an update path.
   */
  private shortenArm(focusX: number, focusY: number, focusZ: number, target: Vector3): void {
    const collision = this.options.collision?.()
    if (!collision) {
      return
    }
    const anchorY = focusY + FOCUS_HEIGHT
    const armX = target.x - focusX
    const armY = target.y - anchorY
    const armZ = target.z - focusZ
    const length = Math.hypot(armX, armY, armZ)
    if (length <= 1e-3) {
      return
    }
    const hit = collision.segmentHit(focusX, anchorY, focusZ, target.x, target.y, target.z)
    if (hit >= 1) {
      return
    }
    // Stop a lens-radius short of the surface, and never closer than `MIN_ARM` —
    // a lens inside the character's own head is worse than one against a wall.
    const stop = Math.max(MIN_ARM, hit * length - LENS_RADIUS)
    if (stop >= length) {
      return
    }
    const t = stop / length
    target.set(focusX + armX * t, anchorY + armY * t, focusZ + armZ * t)
  }

  /**
   * Adopts a camera position the rig did not put there.
   *
   * Called when the dialogue camera hands back: without it the first gameplay
   * frame after a conversation snaps to wherever the follow rig was standing
   * when the conversation began, which is a hard cut out of every scene. With
   * it, `at` starts at the shot's own last position and the existing
   * `POSITION_LERP` glides back behind the player — the same move, run backwards.
   */
  seedFrom(position: Vector3): void {
    this.at.copy(position)
    this.started = true
  }

  /** Restores the camera to a clean state when the story hands control back. */
  reset(): void {
    this.started = false
    this.crowding = 0
    this.shoulder = 0
    this.keys.clear()
  }

  /** True while the bow is up. The HUD draws a crosshair on this. */
  get overTheShoulder(): boolean {
    return this.aiming
  }
}

/** Seconds to a full draw. Matches the ally archers' own `ARCHER_DRAW_SECONDS`. */
export const BOW_DRAW_SECONDS = 1.1

/**
 * Sprint speed, as a multiple of the walk.
 *
 * 1.5, which on Athalus's 3.5 m/s is 5.25 — a shade under the boar's 5.6. That
 * ordering is deliberate and it is the whole design of the chase: sprinting
 * *nearly* outruns the animal, so the player who runs in a straight line is
 * caught slowly and the player who cuts around a boulder gets away. Give the
 * player 5.7 and the set piece evaporates.
 *
 * `CombatDirector` clamps `throttle` and its ceiling has to leave room for this
 * and for `allyBrain`'s 1.25 catch-up.
 */
export const SPRINT_THROTTLE = 1.5
