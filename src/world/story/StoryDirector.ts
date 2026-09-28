import { Group, type PerspectiveCamera, Vector3 } from 'three'
import { Character } from '../characters/Character'
import { CharacterEquipment } from '../characters/CharacterEquipment'
import type { CollisionWorld, Placement } from '../level/types'
import { Combatant } from '../combat/Combatant'
import { CombatDirector } from '../combat/CombatDirector'
import type { Intent } from '../combat/brains'
import { SeatFinder, seatRootLift, SitController } from '../interaction'
import type { DrawnState } from '../characters/equipment'
import type { SeatKind } from '../combat/postures'
import { movesetFor, STATS } from '../combat/movesets'
import { SheepFlock } from '../creatures/Sheep'
import { TrollBoar } from '../creatures/TrollBoar'
import { CAST, type CastId, FIRESIDE } from './cast'
import { CHAPTER_ONE_SPAWN, FRAME_SPAWN, type Beat, type EncounterId } from './chapter1'
import { beatIndex, chapterOf, STORY_BEATS, timeAtBeat } from './chapters'
import { CAMP_MARKS, CAMP_TRACK } from './camp'
import { FRAME_MARKS, FRAME_ROUTES, HUT, HUT_ROOM, SHEEP_PADDOCK } from './frame'
import { AMBUSH, TRAP_CLEARING } from './level'
import { banterFor, type Line, SCRIPT, type ScriptId, type Speaker, speakerBody, storyLine } from './script'
import { StoryPlayer, type WeaponMode } from './StoryPlayer'
import { DialogueCamera, type Focus } from './DialogueCamera'
import { openAt, planUtterance, SILENCE, type Utterance } from './lipSync'
import { playStoryLine, stopStoryLine } from './speech'

/**
 * ─── Running Chapter 1 ──────────────────────────────────────────────────────
 *
 * The one object that knows the chapter exists. It owns the cast, walks the beat
 * list, spawns the two encounters, and pushes dialogue at whoever is listening.
 *
 * Everything under it is deliberately ignorant: `CombatDirector` does not know
 * what a chapter is, `Character` does not know what a bandit is, `brains.ts` does
 * not know there is a script. That is what lets the fights be tuned without
 * touching the story and the story be rewritten without touching the fights.
 *
 * ── Why the cast is built once and hidden, not spawned on demand ────────────
 *
 * Building a `Character` is measured at **1.4 ms median, 3.1 ms worst**
 * (`Crowd.ts`), and the ambush needs five of them at the same instant. Spawning
 * them when the fight starts is a 16 ms hitch on exactly the frame the player
 * needs to react to five men coming out of a treeline.
 *
 * So every figure in the chapter is built during the load, parked far below the
 * ground, and *moved* into place. The cost is one-off and lands behind the
 * splash; the benefit is that no beat in the chapter can hitch.
 *
 * ── The party carries the boar, and that is a cheat ─────────────────────────
 *
 * The manuscript has the four of them hauling the carcass on ropes for the whole
 * walk home. Modelling that means four characters constrained to a rigid body
 * with a rope each, which is a physics system for one prop. Instead the boar's
 * body is parented to the party's centre and the four of them walk in a loose
 * diamond around it, which reads correctly from every angle the camera can
 * reach and costs one `Object3D.position` write a frame. Recorded because it is
 * the one place the game says something the book does not.
 */

export type StoryPhase = 'loading' | 'playing' | 'dialogue' | 'failed' | 'complete'

/**
 * Bumped whenever a snapshot written by an older build can no longer be read.
 *
 * Separate from `useStorySave`'s `STORY_SAVE_VERSION`, which versions the *slot
 * table*: that one changes when the storage shape changes and this one changes
 * when the chapter does. A renamed beat invalidates every save and does not
 * touch the table.
 */
export const STORY_SAVE_VERSION = 1

export interface StorySnapshot {
  version: number
  /** A `Beat.id`, out of any chapter — see `chapters.ts`. */
  beatId: string
  playerId: CastId
  /** Fraction of maximum, 0..1. */
  hp: number
  /** How many times the player has talked to each NPC. */
  banter: [string, number][]
  /**
   * Where the player was standing, and which way they faced.
   *
   * ── The one position that is saved, and why it has to be ──────────────────
   *
   * Everything else in the scene is re-staged by the beat, which is what makes
   * this a checkpoint save rather than a state dump. The player is the
   * exception, and the reason is a soft lock: a `combat` beat has no `at` of its
   * own — it spawns an encounter and ends when that encounter resolves — so a
   * load into one placed the player wherever they last happened to be. Measured:
   * loading `ambush` put Athalus **101 m** from five bandits who were waiting
   * for him, with nothing in the chapter able to close the gap.
   */
  at?: { x: number; z: number; facing: number }
}

export interface StoryState {
  phase: StoryPhase
  beat: number
  beatId: string
  /** i18n key under `story.objective.*`, or '' when there is none. */
  objective: string
  /** The line on screen, or null. */
  line: Line | null
  /** True while the current line is a fireside card rather than a bubble. */
  frame: boolean
  /** Player vitals, 0..1. */
  hp: number
  stamina: number
  /** How many hostiles are still standing. */
  foes: number
  /** Bow draw, 0..1. */
  aim: number
  /** True while the bow is up. The HUD draws a crosshair on this. */
  aiming: boolean
  /** What is in the player's hands. The controls panel relabels itself on it. */
  weapon: WeaponMode
  /** True when the player is inside an `interact` beat's radius. */
  canInteract: boolean
  /** True until the pointer is captured. */
  needsPointerLock: boolean
  /** Which chapter the player has reached. The controls panel hides after 1. */
  chapter: number
  /**
   * The objective list the tracker draws, newest last.
   *
   * i18n *keys* rather than text — this layer has no business knowing which
   * language the player reads, and `story.objective.<key>` is resolved in the
   * Vue shell. Completed entries are kept so the tracker can strike them
   * through, which is most of what makes a quest list feel like progress.
   */
  objectives: readonly { id: string; key: string; done: boolean; distance: number | null }[]
  /**
   * Where the current objective is, projected to the screen by the shell.
   *
   * World space, because projecting needs the camera and the camera is here.
   * Null when the beat has no place attached to it — a dialogue beat has
   * nothing to point at, and a locator pinned to the middle of the screen for
   * the length of a conversation is worse than no locator.
   */
  objectiveAt: { x: number; y: number; z: number } | null
  objectiveDistance: number | null
  /**
   * The person the player would talk to if they pressed the interact key.
   *
   * Resolved here rather than in the shell because it depends on the camera's
   * own aim — see `findTalkTarget`.
   */
  talkTarget: {
    id: string
    nameKey: Speaker
    distance: number
    /**
     * Their head, in world space, for the shell to project the billboard onto.
     *
     * The **head** and not the feet: a label anchored to the ground is behind
     * the character from every angle the camera can reach, and one anchored to
     * their centre is inside their chest. This is `Character.headPosition`, the
     * same point the dialogue camera aims at, so the prompt sits where the shot
     * is about to go.
     */
    at: { x: number; y: number; z: number }
  } | null
  /**
   * The bench, chair or stool the interact key would use, or null.
   *
   * Two prompts in one field, told apart by `seated`: before, it is the
   * "[E] Sit" over a seat the camera is on; after, it is the "press E or Esc to
   * stand" over the seat the player is in. One field because they are never
   * both true and because the shell projects exactly one world point either way
   * — a second nullable struct would be a second thing to keep in step for no
   * gain.
   *
   * Null for the whole of the walk-up and both blends: the player has committed
   * and a prompt telling them to press the key they just pressed is noise.
   */
  seat: {
    /** Where the prompt hangs, world space — the seat, raised a little. */
    at: { x: number; y: number; z: number }
    distance: number
    /** True once the figure is all the way down. */
    seated: boolean
  } | null
}

export interface StoryDirectorOptions {
  camera: PerspectiveCamera
  groundAt: (x: number, z: number) => number
  collision: () => CollisionWorld | null
  /**
   * The chapter's props, so the seats among them can be found.
   *
   * Optional, and the chapter runs without it — the tests build a director with
   * no level at all, and then nothing is sittable. Handed in rather than read
   * from the catalogue on purpose: `world/interaction/seats.ts` carries its own
   * table of which `defId` is a seat precisely so the index can be built the
   * moment the placements exist, instead of against a catalogue that is still
   * draining thirty frames later.
   */
  placements?: readonly Placement[]
  /**
   * Fades every instance of one placeable. 1 solid, 0 gone.
   *
   * Wired to `World.setPlacementVeil`. Optional, and the chapter runs without
   * it — the tests construct a director with no world at all — but with it the
   * storyteller's roof opens when the player goes indoors, which is the one
   * thing a roofed room played from inside cannot do without help from the
   * layer that knows where the player is.
   */
  setPlacementVeil?: (defId: string, value: number) => void
  /**
   * Puts the sun where the scene wants it. Wired to `World.dayCycle`.
   *
   * `time` is the same 0-1 clock `DayCycle` uses (0 midnight, 0.25 sunrise, 0.5
   * noon, 0.75 sunset) and `blendSeconds` is real seconds to slide there, 0 to
   * snap. Optional for the reason `setPlacementVeil` is: the suites build a
   * director with no world at all, and a chapter with no sky still plays.
   *
   * A callback rather than a `DayCycle` reference, and that is the same rule the
   * whole file follows -- the director knows the chapter and knows nothing about
   * the renderer. It is also what lets a test assert the chapter's *lighting
   * script* (this beat asks for dusk, that one snaps) without constructing a
   * shadow cascade.
   */
  setTimeOfDay?: (time: number, blendSeconds: number) => void
}

const _at = new Vector3()
const _head = new Vector3()
const _aim = new Vector3()

/**
 * The five who come out of the treeline in Chapter 1, by actor id.
 *
 * The leader is addressed by his cast id and his men by index — see the note in
 * the constructor. Written once because three separate things loop over exactly
 * this set: the spawn, the rout, and the check that decides when the rout
 * happens. When it was `bandit-${i}` in all three, adding a sixth bandit meant
 * finding all three.
 */
/** A mark in `frame.ts`: somewhere to stand, and how to stand there. */
type FrameMark = { x: number; z: number; facing: number; posture?: SeatKind }

/**
 * How long one leg of a walk may take before the act stops waiting for it.
 *
 * `errandBrain` steers a straight line, so a leg that has been authored badly —
 * or one whose doorway another actor is standing in — never completes, and a
 * figure grinds against geometry for the rest of the scene. Six seconds is over
 * three times the longest leg in `FRAME_ROUTES` at a walk.
 *
 * The give-up is a *skip to the next waypoint*, not a teleport to the end: a
 * walker who cannot round the corner of the house is still much better served by
 * being put at the door than by appearing in a chair, and the failure then costs
 * one visible pop instead of the whole arrival.
 */
const ERRAND_LEG_SECONDS = 6

/** The beats during which somebody may be walking in. See `enterBeat`. */
const ARRIVAL_BEATS: ReadonlySet<string> = new Set(['frame-call', 'frame-sit', 'frame-begin'])

const AMBUSHERS = ['banditLeader', 'bandit-1', 'bandit-2', 'bandit-3', 'bandit-4'] as const

/** Cast rows that fight for the other side. See `buildCastMember`'s team. */
const BANDIT_CAST: ReadonlySet<string> = new Set(['bandit', 'banditLeader', 'dorgo', 'jergo'])

/** Where a parked figure waits. Far enough down to be inside the terrain. */
const PARKED_Y = -400

/**
 * How near the paddock the camera has to be for the sheep to exist at all.
 *
 * Just past `cullDistanceFor(1)` — see `updateSheep`.
 */
const SHEEP_RANGE = 300

/** How close somebody has to be before the talk prompt appears, in metres. */
const TALK_RANGE = 4.2
/**
 * How near the middle of the screen they have to be, as a cosine.
 *
 * 0.55 is about 57 degrees off the camera's heading — generous, because the
 * prompt should appear for somebody you are *walking toward*, not only for
 * somebody you have centred exactly. The tighter the cone, the more it feels
 * like the game is refusing to let you talk to a person standing in front of
 * you.
 */
const TALK_CONE = 0.55

/**
 * How far above a seat's own surface its prompt hangs, in metres.
 *
 * The talk prompt is anchored to a *head* for a reason its own note gives — a
 * label at somebody's feet is behind them from every angle the camera can
 * reach. A seat has no head, and the equivalent mistake is anchoring to the
 * plank: the prompt then sits inside the bench from the front and behind it
 * from above. 0.55 puts it about where the sitter's chest will be, which is
 * both clear of the furniture and where the player is already looking.
 */
const SEAT_PROMPT_LIFT = 0.55

export class StoryDirector {
  readonly group = new Group()
  readonly combat: CombatDirector
  readonly player: StoryPlayer

  private readonly characters = new Map<string, Character>()
  private readonly boar: TrollBoar
  /**
   * The storyteller's sheep.
   *
   * Public and read-only because it is the one thing in the chapter with no
   * script, no beat and no combatant behind it — so the only way to *check* it
   * from outside is to reach it. `__story.sheep.setActive(false)` in the console
   * is how its draw-call cost was A/B'd within one build, which GDD §5.3 and the
   * `world-perf-recurring-checks` memory both require over comparing commits.
   */
  readonly sheep: SheepFlock
  private readonly equipment = new Map<string, CharacterEquipment>()

  private index = 0
  /**
   * The actor the player is currently controlling.
   *
   * Two people over the chapter — `arthusBoy` on the island and `athalus` in
   * Arlaan — switched by `Beat.player`. Everything downstream reads this rather
   * than a constant, which is what lets one camera, one intent struct and one
   * director carry both without knowing there are two.
   */
  private playerId: CastId = 'arthusBoy'
  private phase: StoryPhase = 'loading'
  private lines: readonly Line[] = []
  private lineIndex = 0
  private lineHeld = 0
  private overTalk = false
  /**
   * The beat's own lines, parked while a walk-up conversation plays over them.
   *
   * Null when no banter is running. Parking rather than merging, because the
   * beat's script is the chapter and the banter is an aside — the aside has to
   * be able to end without having advanced anything, and the only way to
   * guarantee that is to put back exactly what was there.
   */
  private parkedLines: { lines: readonly Line[]; index: number } | null = null
  /** How many times the player has talked to each NPC, so they say the next thing. */
  private readonly banterTurns = new Map<CastId, number>()
  private beatTime = 0
  private readonly flags = new Set<string>()
  private canInteract = false
  /** True once this beat's interaction has fired. See `advanceLine`. */
  private interacted = false
  /**
   * The conversation rig. Owns the camera between `begin` and `end`.
   *
   * Held rather than constructed per scene because it carries the shoulder it is
   * currently over, and that has to survive from one line to the next — it is
   * what makes the second line of a scene the *reverse* of the first.
   */
  private readonly dialogueCamera: DialogueCamera
  /**
   * The line currently being mouthed, and how far into it we are.
   *
   * Re-planned whenever the line on screen changes, which includes a line
   * arriving, the player clicking past one, and a beat restarting.
   */
  private utterance: Utterance = SILENCE
  private utteranceTime = 0
  /** Whose mouth is open. Kept so it can be shut again when they stop talking. */
  private speaking: CastId | null = null
  /** The line the current `utterance` was planned from, to detect a change. */
  private plannedFor: Line | null = null
  /**
   * Which language the player is reading, pushed in by the Vue shell.
   *
   * The mouth is timed off the text that is actually on screen. German runs
   * about 15 % longer than the same line in English, and timing the German
   * delivery off the English string leaves the figure standing with a shut mouth
   * through the last two words of every sentence.
   */
  locale = 'de'
  // ── Voice-over ───────────────────────────────────────────────────────────
  //
  // Three numbers and a token, because a recorded line has to beat the reading
  // timer. See `startVoice` and the hold in `update`.
  /** Seconds this line's clip needs, including the tail. 0 when there is none. */
  private voiceHold = 0
  /** A clip is playing whose length the browser has not reported yet. */
  private voiceWaiting = false
  /**
   * Lip-sync clock multiplier: the planned utterance over the clip's real
   * length. 1 when there is no recording, which is the whole of today.
   */
  private utteranceRate = 1
  /**
   * Bumped on every line change, so a promise or an `ended` belonging to a line
   * the player has already clicked past cannot write to the current one. Two
   * clicks inside a decoded frame is all it takes, and the symptom -- a hold
   * that never expires because a dead line reported a duration -- looks like the
   * chapter freezing rather than like an audio bug.
   */
  private voiceToken = 0
  /**
   * ── The household, on its way in ─────────────────────────────────────────
   *
   * Who is currently walking somewhere, which leg of their route they are on,
   * and the mark they finish at. Keyed by cast id, and empty for the whole of
   * the chapter except the four minutes of the frame act.
   *
   * This is the state the act's *drama* is made of: the old man will not start
   * until there is nobody left to wait for, and "left to wait for" is now
   * literally the size of this map rather than a beat index.
   */
  private readonly walking = new Map<CastId, { legs: readonly { x: number; z: number }[]; leg: number; mark: FrameMark }>()
  private objectiveAt: { x: number; y: number; z: number } | null = null
  private objectiveDistance: number | null = null
  private talkTarget: StoryState['talkTarget'] = null
  /**
   * The shot, filled in place each frame.
   *
   * Fields rather than locals for the reason everything on this path is: the
   * camera runs 60 times a second and two object literals a frame is two object
   * literals a frame. `shotPartner` aliases `shotPartnerFocus` or is null, which
   * is how "there is nobody to shoot over" is expressed without an allocation.
   */
  private shotSpeaker = ''
  private readonly shotFocus: Focus = { x: 0, y: 0, z: 0, facing: 0 }
  private readonly shotPartnerFocus: Focus = { x: 0, y: 0, z: 0, facing: 0 }
  private shotPartner: Focus | null = null
  /** The talk prompt's one struct. See the note on `shotFocus`. */
  private readonly talkSlot: NonNullable<StoryState['talkTarget']> = {
    id: '',
    nameKey: 'narrator',
    distance: 0,
    at: { x: 0, y: 0, z: 0 }
  }

  /**
   * Who the player may strike up a conversation with.
   *
   * A list rather than "anybody on the party team", because most of the cast
   * are not conversational furniture: five bandits and a boar are on the same
   * actor list and none of them takes an interact prompt. It is also what keeps
   * the per-frame scan short — `findTalkTarget` runs every frame and this is
   * nine entries rather than twenty.
   */
  private readonly talkable: readonly CastId[] = [
    'jester',
    'gearn',
    'kareen',
    'theodor',
    'nidane',
    'storyteller',
    'arthusBoy',
    'lenaGirl',
    'smithFather',
    'motherMara'
  ]

  // ── Sitting on things ─────────────────────────────────────────────────────
  //
  // Two objects from `world/interaction/`, which knows nothing about a chapter:
  // a finder that answers "which seat is the camera on" and a five-state machine
  // that gets somebody into one and back out. Everything chapter-shaped about
  // sitting — when it is allowed, what interrupts it, which key it costs — is
  // in this file, and nothing seat-shaped is.
  private readonly seats: SeatFinder | null
  private readonly sit = new SitController()
  /** The seat prompt's one struct. See the note on `shotFocus`. */
  private readonly seatSlot: NonNullable<StoryState['seat']> = {
    at: { x: 0, y: 0, z: 0 },
    distance: 0,
    seated: false
  }
  private seatPrompt: StoryState['seat'] = null
  /**
   * Whose sit it is.
   *
   * Remembered rather than assumed to be `playerId`, because the one path that
   * cancels a sit *while changing who the player is* — `switchTo`, the cut
   * between the two timeframes — would otherwise stand up the arriving actor
   * and leave the departing one in a chair for the rest of the chapter.
   */
  private sitActorId: string | null = null
  /**
   * The player's hit points last frame, so a blow landing can end a sit.
   *
   * A remembered number rather than a hook, because `Combatant` has no event to
   * hook: damage is a method that changes a field, and every consumer of it in
   * this project reads the field. One float against a subscription that would
   * have to be unsubscribed on an actor switch.
   */
  private lastHp = 0

  /** Bumped whenever anything the HUD shows changes. Polled, never a `ref`. */
  private revision = 0

  /**
   * How solid the storyteller's roof currently is. Eased, never snapped.
   *
   * The last value written is kept so the per-frame call can be skipped when
   * nothing has moved: `setPlacementVeil` is cheap but it is called sixty times
   * a second for the whole chapter, and 1.7 km of it happens somewhere the roof
   * is not even drawn.
   */
  private roofVeil = 1
  private roofVeilWritten = -1

  constructor(private readonly options: StoryDirectorOptions) {
    this.group.name = 'story'
    this.group.userData.perfTag = 'story'
    this.combat = new CombatDirector(options.groundAt, options.collision)
    this.group.add(this.combat.group)
    this.player = new StoryPlayer({
      camera: options.camera,
      groundAt: options.groundAt,
      // The follow camera's spring arm. Without it the 5.6 m arm swings through
      // walls and the lens ends up inside whatever the player is standing next
      // to — see `StoryPlayer.shortenArm`.
      collision: options.collision
    })
    this.dialogueCamera = new DialogueCamera({
      camera: options.camera,
      groundAt: options.groundAt,
      collision: options.collision
    })
    // Once, at construction. The seats are content — no beat moves a bench —
    // so the whole index is resolved into world space here and never touched
    // again, which is what lets the per-frame scan be a grid lookup.
    this.seats = options.placements ? new SeatFinder(options.placements, options.groundAt) : null

    // ── The cast ───────────────────────────────────────────────────────────
    for (const id of ['athalus', 'jester', 'gearn', 'kareen', 'theodor', 'nidane'] as CastId[]) {
      this.buildCastMember(id, id)
    }
    // Five bandits: a leader and four of one shape. Their ids carry an index so
    // the combat director can address one, while their *appearance* comes from
    // the same two cast rows — see `cast.ts` on why the rank and file are one
    // entry.
    // The leader keeps his **cast id as his actor id**, unlike his four men.
    // Chapter 2 is played as him, and `Beat.player` is a `CastId` — so the one
    // bandit the story ever needs to address by name is the one whose two ids
    // are the same. His men stay indexed, because the only thing that ever wants
    // them is a loop.
    this.buildCastMember('banditLeader', 'banditLeader')
    for (let i = 1; i <= 4; i++) {
      this.buildCastMember('bandit', `bandit-${i}`, i)
    }
    // Chapter 2's two speaking bandits. Built with everyone else during the load
    // for the reason in the header — the camp assembles in one frame.
    this.buildCastMember('dorgo', 'dorgo')
    this.buildCastMember('jergo', 'jergo')
    // The fireside household. Built with everyone else, during the load, and
    // parked underground until the frame act places them — the same argument the
    // header makes for the bandits: a `Character` is 1.4 ms and there is no
    // frame in this chapter that can afford five of them at once.
    for (const id of FIRESIDE) {
      this.buildCastMember(id, id)
    }

    this.boar = new TrollBoar({ perfTag: 'story' })
    this.boar.setPosition(_at.set(0, PARKED_Y, 0))
    this.group.add(this.boar.group)

    // ── The storyteller's sheep ────────────────────────────────────────────
    //
    // Scenery, not cast: they have no combatant, no brain and no beat, and
    // nothing in the chapter ever asks where they are. So they are the one thing
    // here that is *not* parked at `PARKED_Y` when the story cuts to Arlaan —
    // `SheepFlock.setActive` hides the subtree instead, which costs nothing at
    // all rather than five hidden draws, and stops the wander advancing. See the
    // note on that method.
    //
    // `HUT_ROOM` is the keep-out because the room's doorway is a 2 m hole in a
    // wall of colliders, and prop collision alone would let a sheep walk in and
    // stand in the middle of the frame act.
    this.sheep = new SheepFlock({
      paddock: SHEEP_PADDOCK,
      keepOut: [HUT_ROOM],
      groundAt: options.groundAt,
      perfTag: 'story'
    })
    this.group.add(this.sheep.group)
    this.sheep.setActive(false)

    this.combat.onDeath = id => this.onDeath(id)
    this.combat.leaderId = 'athalus'
  }

  /**
   * Builds one figure and its combatant, parked underground.
   *
   * `seed` shifts the appearance for the rank-and-file bandits. It moves
   * `gearSeed` and the skin tone only — the *outline* stays identical, which
   * `cast.ts` argues for at length: five men coming out of a treeline read as a
   * wall, and a wall is more frightening than five individuals.
   */
  private buildCastMember(castId: CastId, actorId: string, seed = 0): void {
    const member = CAST[castId]
    const appearance = { ...member.appearance }
    if (seed > 0) {
      appearance.gearSeed = member.appearance.gearSeed + seed
      appearance.skinTone = ((member.appearance.skinTone + seed) % 5) as typeof appearance.skinTone
    }

    const character = new Character({
      appearance,
      // Stable per *role*, not per actor: `assertTriBudget`'s ledger replaces a
      // row by name, so a name that varied per bandit would grow the perf panel
      // a row per figure and turn it into a history.
      geometryName: `story/${castId}`,
      perfTag: 'story'
    })
    character.group.scale.setScalar(member.scale)
    character.setPosition(_at.set(0, PARKED_Y, 0))
    this.group.add(character.group)
    this.characters.set(actorId, character)

    const kit = new CharacterEquipment(character)
    kit.setLoadout(member.loadout)
    this.equipment.set(actorId, kit)

    const stats = STATS[statsKeyFor(castId)] ?? STATS.bandit!
    const weapon = member.loadout.mainHand ?? member.loadout.back ?? null
    const combatant = new Combatant({
      id: actorId,
      // A set rather than a chain of ors: it was two names and grew to four the
      // moment Chapter 2 gave two of the bandits something to say, and the
      // failure of forgetting one is silent — Dorgo and Jergo defaulted to
      // `party`, which made them hostile to the man they spend the chapter
      // talking to and put a foe counter over a fireside conversation.
      team: BANDIT_CAST.has(castId) ? 'foe' : 'party',
      stats,
      moveset: movesetFor(weapon),
      weapon
    })
    combatant.x = 0
    combatant.y = PARKED_Y
    combatant.z = 0
    // Parked figures are `down` so no brain runs and no hit test can find them.
    combatant.kill()

    this.combat.add({
      id: actorId,
      combatant,
      character,
      brain: brainFor(castId),
      ...(STATION[castId] ? { station: STATION[castId] } : {}),
      bowDamage: castId === 'kareen' ? 17 : castId === 'jester' ? 13 : 0,
      eyeHeight: 1.1 * member.scale
    })
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Puts the chapter at its first beat and the player at the trap clearing. */
  begin(): void {
    this.index = 0
    this.flags.clear()

    // ── Arlaan is staged now and stood on for later ────────────────────────
    //
    // Athalus and the hunting party are put where the story beats expect them
    // even though the chapter opens 1.7 km away on an island. That is cheaper
    // than staging them at the cut and it is also safer: a `travel` beat's exit
    // test reads a position every frame, so an actor who has not been placed yet
    // is an actor at the origin, and the origin is inside Nimmerschein.
    const athalus = this.combat.get('athalus')!
    athalus.revive()
    athalus.x = CHAPTER_ONE_SPAWN.x
    athalus.z = CHAPTER_ONE_SPAWN.z
    athalus.y = this.options.groundAt(athalus.x, athalus.z)
    athalus.facing = CHAPTER_ONE_SPAWN.yaw
    // The companions start around the clearing, where the book has them setting
    // the net: two in the bushes either side and Gearn already gone to drive —
    // and asleep, because the chapter opens on the island and an `ally` brain
    // follows whoever the leader is.
    this.placeParty()
    for (const id of ['jester', 'gearn', 'kareen'] as const) {
      this.combat.setBrain(id, 'none')
    }

    // ── And the chapter actually opens on the island ───────────────────────
    this.placeFireside()
    this.playerId = 'arthusBoy'
    this.combat.leaderId = 'arthusBoy'
    const arthus = this.combat.get('arthusBoy')!
    arthus.revive()
    arthus.x = FRAME_SPAWN.x
    arthus.z = FRAME_SPAWN.z
    arthus.y = this.options.groundAt(arthus.x, arthus.z)
    arthus.facing = FRAME_SPAWN.yaw
    this.player.yaw = FRAME_SPAWN.yaw
    this.player.reset()

    this.enterBeat(true)
    this.revision++
  }

  /**
   * Stands the household up on the island.
   *
   * Blocking, from `frame.ts::FRAME_MARKS`. The mother and Lena are placed *down
   * the road* rather than in the room — the whole act is a wait for them, and an
   * act that opens with everyone already present has nothing in it.
   */
  private placeFireside(): void {
    for (const id of FIRESIDE) {
      const mark = FRAME_MARKS[id === 'smithFather' ? 'father' : id === 'motherMara' ? 'mother' : id === 'lenaGirl' ? 'lena' : id === 'arthusBoy' ? 'arthus' : 'storyteller']
      const combatant = this.combat.get(id)
      if (!combatant || !mark) {
        continue
      }
      combatant.revive()
      combatant.x = mark.x
      combatant.z = mark.z
      combatant.y = this.options.groundAt(mark.x, mark.z)
      combatant.facing = mark.facing
      // The storyteller is *already* in the chair when the act opens — his mark
      // carries `posture: 'chair'` — and he is the one member of the household
      // who never gets up. Everyone else's mark has no posture and they stand.
      if ('posture' in mark && mark.posture) {
        combatant.sit(mark.posture)
        // Fully seated, not sitting down: this runs at `begin()` and at the
        // epilogue, and both of them are cuts. A man discovered mid-sit on the
        // first frame of a chapter reads as a man who has just been dropped
        // into it, which he has.
        combatant.postureBlend = 1
      } else {
        combatant.stand()
      }
    }
  }

  /** Moves an actor to a mark, in one line, because the frame act does it a lot. */
  /**
   * Stands the camp up: everyone alive, on their marks, round the fire.
   *
   * Revives first. Chapter 1 ends by routing the bandits, which kills them so
   * they stop fighting and drag their wounded off — the manuscript's own ending
   * to that scene. Chapter 2 is the same men a few hours later, so the first
   * thing it does is put them back on their feet.
   */
  private placeCamp(): void {
    const marks: [string, { x: number; z: number; facing: number }][] = [
      ['banditLeader', CAMP_MARKS.brutos],
      ['dorgo', CAMP_MARKS.dorgo],
      ['jergo', CAMP_MARKS.jergo],
      ['bandit-1', CAMP_MARKS.banditA],
      ['bandit-2', CAMP_MARKS.banditB]
    ]
    for (const [id, mark] of marks) {
      const combatant = this.combat.get(id)
      if (!combatant) {
        continue
      }
      combatant.revive()
      combatant.x = mark.x
      combatant.z = mark.z
      combatant.y = this.options.groundAt(mark.x, mark.z)
      combatant.facing = mark.facing
    }
    // The other two are not in this scene. The manuscript has five men at the
    // ambush and names three at the fire; the two it does not name stay parked
    // rather than standing in the background with nothing to do.
    for (const id of ['bandit-3', 'bandit-4']) {
      const combatant = this.combat.get(id)
      if (combatant) {
        combatant.y = PARKED_Y
      }
    }
  }

  /**
   * Moves an actor to a mark, and sits them down if the mark is a seat.
   *
   * A mark carrying a `posture` is a mark *at a piece of furniture*
   * (`frame.ts::FRAME_MARKS` names which), and one without is a spot on the
   * floor. Standing is therefore the default and is applied explicitly rather
   * than left alone: an actor sent from a stool to the doorway has to get up on
   * the way, and forgetting that once is a mother who walks to the door still
   * sitting down.
   */
  /**
   * Sends somebody home, on foot, along an authored route.
   *
   * The last leg is the mark itself, so a stool that moves in `FRAME_MARKS` does
   * not also have to move in `FRAME_ROUTES`. Anyone already walking is
   * re-dispatched from wherever they have got to, which is what a beat replayed
   * by `__story.jumpTo` or a save load looks like.
   */
  private sendHome(id: CastId, route: readonly { x: number; z: number }[], mark: FrameMark): void {
    const combatant = this.combat.get(id)
    if (!combatant) {
      return
    }
    combatant.stand()
    this.walking.set(id, { legs: [...route, { x: mark.x, z: mark.z }], leg: 0, mark })
    this.beginLeg(id)
  }

  /** Points the walker at the leg it is on. */
  private beginLeg(id: CastId): void {
    const walk = this.walking.get(id)
    if (!walk) {
      return
    }
    const leg = walk.legs[walk.leg]
    if (!leg) {
      this.arriveHome(id)
      return
    }
    const last = walk.leg === walk.legs.length - 1
    // Only the final leg needs to end on the mark's own facing; a waypoint is a
    // corner, and turning to the seat's facing at a corner walks them sideways.
    // Tighter radius on the last leg too, because that one ends on furniture.
    this.combat.sendTo(id, leg.x, leg.z, last ? walk.mark.facing : 0, {
      radius: last ? 0.4 : 1.1,
      // A shade under a run. They have been called in to eat; nobody strolls.
      throttle: last ? 0.75 : 1
    })
  }

  /** Puts a walker on their mark and sits them down. */
  private arriveHome(id: CastId): void {
    const walk = this.walking.get(id)
    this.walking.delete(id)
    this.combat.clearErrand(id)
    if (walk) {
      // Snaps the last few centimetres and applies the posture. The distance is
      // under `radius`, so this is not a teleport anybody can see — and it is
      // what guarantees a figure ends up *on* a stool rather than 30 cm beside
      // it, which is the difference `postures.ts` was written to protect.
      this.moveTo(id, walk.mark)
    }
  }

  /**
   * One frame of everybody who is walking in.
   *
   * Polls rather than being called back, because `combat/` may not know what an
   * arrival is for — see `CombatDirector.sendTo`.
   */
  private advanceWalks(dt: number): void {
    if (this.walking.size === 0) {
      return
    }
    for (const [id, walk] of this.walking) {
      const errand = this.combat.errandFor(id)
      if (!errand) {
        // The brain was taken off them by something else — a beat cut, a death.
        // Drop the walk rather than driving a figure nobody is steering.
        this.walking.delete(id)
        continue
      }
      if (errand.done || errand.elapsed > ERRAND_LEG_SECONDS) {
        walk.leg++
        if (walk.leg >= walk.legs.length) {
          this.arriveHome(id)
        } else {
          this.beginLeg(id)
        }
      }
    }
    void dt
  }

  private moveTo(id: string, mark: { x: number; z: number; facing: number; posture?: SeatKind }): void {
    const combatant = this.combat.get(id)
    if (!combatant) {
      return
    }
    combatant.x = mark.x
    combatant.z = mark.z
    combatant.y = this.options.groundAt(mark.x, mark.z)
    combatant.facing = mark.facing
    if (mark.posture) {
      combatant.sit(mark.posture)
    } else {
      combatant.stand()
    }
  }

  private placeParty(): void {
    const spots: Record<string, readonly [number, number]> = {
      jester: [TRAP_CLEARING.x - 4, TRAP_CLEARING.z + 9],
      kareen: [TRAP_CLEARING.x - 6, TRAP_CLEARING.z - 5],
      gearn: [TRAP_CLEARING.x + 11, TRAP_CLEARING.z + 2]
    }
    for (const [id, spot] of Object.entries(spots)) {
      const combatant = this.combat.get(id)
      if (!combatant) {
        continue
      }
      combatant.revive()
      combatant.x = spot[0]
      combatant.z = spot[1]
      combatant.y = this.options.groundAt(combatant.x, combatant.z)
      combatant.facing = Math.atan2(TRAP_CLEARING.x - combatant.x, TRAP_CLEARING.z - combatant.z)
    }
  }

  get state(): StoryState {
    const athalus = this.combat.get(this.playerId)
    const beat = STORY_BEATS[this.index]
    return {
      phase: this.phase,
      beat: this.index,
      beatId: beat?.id ?? '',
      objective: this.phase === 'dialogue' && !this.overTalk ? '' : (beat?.objective ?? ''),
      line: this.lines[this.lineIndex] ?? null,
      frame: this.lines[this.lineIndex]?.frame === true,
      hp: athalus?.hpFraction ?? 0,
      stamina: athalus?.staminaFraction ?? 0,
      foes: this.engagedFoes(),
      aim: this.player.aimCharge,
      aiming: this.player.overTheShoulder,
      weapon: this.player.weaponMode,
      canInteract: this.canInteract,
      needsPointerLock: !this.player.pointerLocked,
      chapter: chapterOf(this.index),
      objectives: this.objectiveList(),
      objectiveAt: this.objectiveAt,
      objectiveDistance: this.objectiveDistance,
      talkTarget: this.talkTarget,
      seat: this.seatPrompt
    }
  }

  /**
   * The last few objectives, current one last.
   *
   * Three, and the number is a reading decision rather than a technical one: a
   * tracker showing the whole chapter is a wall of twenty-four lines nobody
   * reads, and one showing only the current objective gives the player no sense
   * that they are getting anywhere. Two struck-through lines above the live one
   * is enough to feel like progress and short enough to take in at a glance.
   */
  private objectiveList(): { id: string; key: string; done: boolean; distance: number | null }[] {
    const out: { id: string; key: string; done: boolean; distance: number | null }[] = []
    for (let i = Math.max(0, this.index - 6); i <= this.index; i++) {
      const beat = STORY_BEATS[i]
      if (!beat?.objective) {
        continue
      }
      out.push({ id: beat.id, key: beat.objective, done: i < this.index, distance: null })
    }
    // Keep the two most recent finished ones plus the live one.
    const trimmed = out.slice(-3)
    const live = trimmed[trimmed.length - 1]
    if (live && !live.done) {
      live.distance = this.objectiveDistance
    }
    return trimmed
  }

  /**
   * How many hostiles are actually on the player right now.
   *
   * Hostile **to whoever the player currently is** and **near them** — see
   * `CombatDirector.engagedAgainst`. Both halves were wrong before Chapter 2
   * existed and neither showed: the count was hard-coded against the party, and
   * counted the whole world. Playing as a bandit made it report the hunting
   * party asleep in a village 120 m away, as foes, over a fireside chat.
   *
   * It drives two things — the HUD's counter and the camera's crowd pull — and
   * they want the same number, so they read the same method.
   */
  private engagedFoes(): number {
    const player = this.combat.get(this.playerId)
    if (!player) {
      return 0
    }
    return this.combat.engagedAgainst(player.team, player.x, player.z)
  }

  /** Polled by the Vue shell, which copies out of `state` when it changes. */
  get stateRevision(): number {
    return this.revision
  }

  /** Advances the dialogue. The shell calls it on click or on the space bar. */
  advanceLine(): void {
    if (this.lineIndex >= this.lines.length) {
      return
    }
    // Cut the voice here rather than leaving it to the next frame's `speak`.
    // One frame is 16 ms of a sentence continuing over the bubble that replaced
    // it, which is inaudible once and unmistakable when a player clicks through
    // a scene at speed.
    this.startVoice(null)
    this.lineIndex++
    this.lineHeld = 0
    this.revision++
    if (this.lineIndex < this.lines.length) {
      return
    }
    // ── Running out of lines only ends a *dialogue* beat ────────────────────
    //
    // The first version ended whatever beat was running, and it silently broke
    // the chapter's best scene: `boar-chase` is a `survive` beat that carries
    // two lines of barking ("By Athos, how do I keep getting myself into this?"),
    // so the moment those two lines were read the chase was over — the player
    // was teleported past the whole set piece by *reading*.
    //
    // A line in a non-dialogue beat is a bark over gameplay. It finishes and the
    // beat carries on until its own condition is met: a place reached, a timer
    // run down, an encounter resolved.
    //
    // The one exception is an `interact` beat whose interaction has **already
    // fired**. There the dialogue is not a bark, it is the payoff — cutting the
    // rope is followed by the party watching the net go up, and the beat is over
    // when they stop talking about it. `interacted` is what distinguishes that
    // from an interact beat the player has not touched yet.
    // An aside ends by handing the beat back, and must never call `finishBeat` —
    // talking to Kareen while standing in a `dialogue` beat's radius would
    // otherwise skip that beat entirely, which is the chapter advancing because
    // the player said hello to someone.
    if (this.endBanter()) {
      return
    }
    if (this.beat?.kind === 'dialogue' || (this.beat?.kind === 'interact' && this.interacted)) {
      this.finishBeat()
    }
  }

  // ── The beat machine ─────────────────────────────────────────────────────

  private get beat(): Beat | undefined {
    return STORY_BEATS[this.index]
  }

  /**
   * The cut between the two timeframes.
   *
   * A beat that names a different player *is* the cut: the camera snaps to
   * whoever the story is now, the allies follow them instead, and the previous
   * actor is left standing 1.7 km away where they will be needed again. Nothing
   * fades, and it should — a fade is the obvious next improvement and it is a
   * Vue overlay rather than anything in here.
   *
   * Extracted from `enterBeat` because `restore` needs it too: a save made in
   * the middle of the frame act names a beat that does not itself carry a
   * `player`, so loading it has to replay the switch the act *started* with.
   */
  private switchTo(who: CastId): void {
    if (who === this.playerId) {
      return
    }
    // The actor about to be left behind may be in a chair, and `cancelSit`
    // resolves the player by id — so it has to run while that id is still
    // theirs. One line, and the alternative is a nine-year-old left sitting on
    // an island for the rest of the chapter with a state machine still pointed
    // at him.
    this.cancelSit()
    this.playerId = who
    this.combat.leaderId = who
    const arriving = this.combat.get(who)
    if (arriving) {
      this.player.yaw = arriving.facing
      this.player.reset()
    }
    // ── And the cast that is *not* in this act stops thinking ──────────────
    //
    // `allyBrain` follows `leaderId`, and `leaderId` has just moved 1.7 km.
    // Without this the hunting party spends the frame act walking across the
    // ocean toward a nine-year-old — measured, in the browser: eleven seconds
    // after the chapter opened, Jester was 80 m out to sea and still coming.
    //
    // The rule is the act, not the distance: an actor who is not in the scene
    // has no brain, and gets one back when their own act starts.
    // Three acts now, and the third is the one that made this a switch rather
    // than a boolean. Chapter 2 is played as **Brutos**, in a camp 30 m from
    // Nimmerschein — close enough that a hostile brain left running would send
    // four bandits at a village full of allies while the player is standing in
    // the middle of a conversation about crystals.
    const act = who === 'arthusBoy' ? 'island' : who === 'banditLeader' ? 'camp' : 'arlaan'
    const party = act === 'arlaan' ? 'ally' : 'none'
    this.combat.setBrain('jester', party)
    this.combat.setBrain('gearn', party)
    this.combat.setBrain('kareen', act === 'arlaan' ? 'allyArcher' : 'none')
    // The camp's own cast only thinks during the act it is in, and even then it
    // does not think *at* anybody — Chapter 2 has no fight in it. They stand on
    // their marks and talk.
    for (const id of AMBUSHERS) {
      if (id !== who) {
        this.combat.setBrain(id, 'none')
      }
    }
    this.combat.setBrain('dorgo', 'none')
    this.combat.setBrain('jergo', 'none')
  }

  private enterBeat(jumped = false): void {
    const beat = this.beat
    // Belt and braces against restoring a previous beat's script into this one.
    // `checkBeatExit` already refuses to advance while an aside is up, so this
    // should be unreachable — and it is one assignment against a bug that would
    // present as the wrong conversation appearing two beats later.
    this.parkedLines = null
    this.beatTime = 0
    this.canInteract = false
    this.interacted = false
    // ── A beat that starts while somebody is sitting stands them up first ──
    //
    // Before the staging below and before the cut, because both of those move
    // people: a `cancel` that ran afterwards would put the player back on the
    // approach point of a bench in a village 1.7 km from where the beat has
    // just placed them. It is the hard exit rather than the polite one for the
    // reason `advanceSit` gives — a beat is the world insisting.
    this.cancelSit()
    // ── A beat outside the arrival window stops the household walking ──────
    //
    // The three beats below are the whole of the time anybody is on their way
    // in: `frame-call` sets the father off, `frame-sit` the mother and Lena, and
    // `frame-begin` is where they finish. Every other beat — a jump, a save
    // load, the cut to Arlaan — must drop the walks, or a figure keeps steering
    // toward a stool on an island 1.7 km from the scene that is now playing.
    if (beat && !ARRIVAL_BEATS.has(beat.id)) {
      for (const id of this.walking.keys()) {
        this.combat.clearErrand(id)
      }
      this.walking.clear()
    }
    // Before the cut below, so the sky is already right when the camera arrives
    // somewhere else. A beat that snaps the time and then snaps the camera is
    // one cut; the other order is two.
    this.applyBeatTime(jumped)

    // ── The cut ────────────────────────────────────────────────────────────
    //
    // A beat that names a different player *is* the cut between the two
    // timeframes: the camera snaps to whoever the story is now, the allies
    // follow them instead, and the previous actor is left standing 1.7 km away
    // where they will be needed again. Nothing fades, and it should — a fade is
    // the obvious next improvement and it is a Vue overlay rather than anything
    // in here.
    if (beat?.player) {
      this.switchTo(beat.player)
    }
    if (!beat) {
      this.phase = 'complete'
      this.player.setEnabled(false)
      this.combat.enabled = false
      return
    }

    this.lines = beat.script ? (SCRIPT[beat.script as ScriptId] as readonly Line[]) : []
    this.lineIndex = 0
    this.lineHeld = 0
    this.overTalk = beat.overTalk === true

    if (beat.kind === 'dialogue') {
      this.phase = 'dialogue'
      // Combat freezes and input is dropped. Both are `setEnabled`, not a flag
      // the update loop checks, so a held key cannot survive the conversation.
      this.combat.enabled = false
      this.player.setEnabled(false)
    } else {
      this.phase = 'playing'
      this.combat.enabled = true
      this.player.setEnabled(true)
      // ── And whoever is playing gets up ──────────────────────────────────
      //
      // The player sits down at `frame-begin` and again at `epilogue`, and both
      // of those are dialogue beats that hand control back afterwards. Without
      // this the chapter resumes with the player seated, walking round the
      // island in a chair pose — which no beat clears, because a posture is a
      // fact about an actor and nothing else in the layer has an opinion about
      // when it should end.
      this.combat.get(this.playerId)?.stand()
    }

    if (beat.encounter) {
      this.spawnEncounter(beat.encounter)
    }
    // ── The frame act's staging ────────────────────────────────────────────
    //
    // Three moments where somebody moves because the scene says so — and they
    // **walk** now. Each of these used to be a teleport, and the comment that
    // stood here called that "a real limitation": the father did not come in
    // through the door, he *appeared* beside it, and the act read as the scene
    // rebuilding itself between beats rather than as a household arriving.
    //
    // The order is what makes it a scene. The player is sent to fetch each of
    // them in turn, so a dispatch here is always the frame *after* the player
    // has walked out and spoken to somebody — the errand is the answer to the
    // conversation, not a thing that happens on its own.
    if (beat.id === 'frame-call') {
      // Sent when the player leaves the forge, i.e. as a consequence of having
      // just told him. He puts the hammer down and follows them in.
      this.sendHome('smithFather', FRAME_ROUTES.father, FRAME_MARKS.fatherSeat)
    }
    if (beat.id === 'frame-sit') {
      // And the two of them, from up the road. They have the longest walk in
      // the act by a factor of three, which is deliberate: it is what the
      // player's own walk back to the table is *for*. Arriving at the stool
      // first and then waiting would be a loading screen with a chair in it.
      this.sendHome('motherMara', FRAME_ROUTES.mother, FRAME_MARKS.motherSeat)
      this.sendHome('lenaGirl', FRAME_ROUTES.lena, FRAME_MARKS.lenaSeat)
    }
    if (beat.id === 'frame-begin') {
      // And the boy, who is the player up to this beat. He sits last, after his
      // sister, because he is the one who has been running round the house for
      // the whole act getting everybody else into the room.
      this.moveTo('arthusBoy', FRAME_MARKS.arthusSeat)
    }
    if (beat.id === 'epilogue') {
      // Back to the room, and back to being nine years old. Seated on the first
      // frame rather than sitting down: this is a cut from a battlefield 1.7 km
      // and sixty years away, and it should land on a room that has been sitting
      // there the whole time.
      this.placeFireside()
      for (const [id, mark] of [
        ['motherMara', FRAME_MARKS.motherSeat],
        ['lenaGirl', FRAME_MARKS.lenaSeat],
        ['smithFather', FRAME_MARKS.fatherSeat],
        ['arthusBoy', FRAME_MARKS.arthusSeat]
      ] as const) {
        this.moveTo(id, mark)
        const seated = this.combat.get(id)
        if (seated) {
          seated.postureBlend = 1
        }
      }
    }

    // ── Chapter 2's staging ──────────────────────────────────────────────────
    //
    // The camp assembles once, on the beat that opens it. Everyone in it was
    // killed at the end of Chapter 1's ambush — `routBandits` calls `kill()` on
    // all five so they stop fighting — so this is also where they are revived.
    // Without that the chapter opens on five corpses arguing about crystals.
    if (beat.id === 'b2-camp') {
      this.placeCamp()
    }
    if (beat.id === 'b2-ride') {
      // Dorgo goes. He walks out down the track rather than riding — see the
      // note on horses in `camp.ts` — and this is a teleport to the far end of
      // it, which is the same cheat the frame act uses for the father.
      this.moveTo('dorgo', CAMP_MARKS.dorgoLeaving)
    }

    if (beat.id === 'boar-chase') {
      // ── Everyone runs ──────────────────────────────────────────────────────
      //
      // "Before it could get back to its feet they all took to their heels and
      // ran in every direction." The three companions stop being fighters for
      // the length of the chase, and they are thrown clear of the clearing so
      // the player is genuinely alone with the animal.
      //
      // Without this the chase does not exist: left on their brains they hold
      // their ground and shoot the boar down in about eight seconds while the
      // player stands still, which is a set piece that plays itself.
      const scatter: [CastId, number, number][] = [
        ['jester', -19, 14],
        ['gearn', 16, -11],
        ['kareen', -8, -20]
      ]
      for (const [id, dx, dz] of scatter) {
        this.combat.setBrain(id, 'none')
        const companion = this.combat.get(id)
        if (companion) {
          companion.x = TRAP_CLEARING.x + dx
          companion.z = TRAP_CLEARING.z + dz
          companion.y = this.options.groundAt(companion.x, companion.z)
          companion.facing = Math.atan2(TRAP_CLEARING.x - companion.x, TRAP_CLEARING.z - companion.z)
        }
      }
    }
    if (beat.id === 'boar-treed') {
      // Athalus is up the tree: invulnerable and out of the way, which is
      // exactly what the prose says happens.
      const athalus = this.combat.get('athalus')
      if (athalus) {
        athalus.y += 2.6
      }
    }
    if (beat.id === 'boar-kill') {
      // His friends finish it. The player is still up the tree, so this beat is
      // watched rather than fought — which is the chapter, and which is why the
      // objective reads "hold on" rather than "kill it".
      //
      // The brains come back on here and only here. Kareen's arrow is the first
      // to land in the book and she is the one with a bow, so she is the reason
      // this beat resolves at all.
      this.combat.setBrain('jester', 'ally')
      this.combat.setBrain('gearn', 'ally')
      this.combat.setBrain('kareen', 'allyArcher')
      const athalus = this.combat.get('athalus')
      if (athalus) {
        athalus.stance = 'idle'
      }
    }
    if (beat.id === 'recover-kit') {
      const athalus = this.combat.get('athalus')
      if (athalus) {
        athalus.y = this.options.groundAt(athalus.x, athalus.z)
      }
    }
    this.revision++
  }

  private finishBeat(): void {
    const beat = this.beat
    if (beat?.sets) {
      for (const flag of beat.sets) {
        this.flags.add(flag)
      }
    }
    this.index++
    this.enterBeat()
  }

  /**
   * ── The sun for this scene ────────────────────────────────────────────────
   *
   * A beat names a time of day or inherits the last one that did, and the two
   * cases below are not the same operation.
   *
   * **Advancing** into a beat plays its lighting cue as written: a `time` with a
   * `timeBlend` slides, a `time` alone snaps. That is the chapter's own
   * direction and `chapter1.ts` argues each value where it sits.
   *
   * **Arriving** at a beat -- `begin`, `__story.jumpTo`, loading a save, dying
   * and retrying -- has no continuity to preserve and must never blend. It also
   * cannot just read `beat.time`, because most beats do not carry one: the
   * chapter states a time when the light *changes* and says nothing for the runs
   * in between, so jumping to `ambush` (which names 0.66) and jumping to
   * `ambush-over` (which names nothing) would otherwise land in two different
   * chapters' worth of daylight. So an arrival walks **backwards** to the last
   * beat that named a time and snaps to it -- which is exactly the state a
   * player who had walked there would be in.
   */
  private applyBeatTime(jumped: boolean): void {
    const setTimeOfDay = this.options.setTimeOfDay
    if (!setTimeOfDay) {
      return
    }
    if (!jumped) {
      const time = this.beat?.time
      if (time !== undefined) {
        setTimeOfDay(time, this.beat?.timeBlend ?? 0)
      }
      return
    }
    const inherited = timeAtBeat(this.index)
    if (inherited !== undefined) {
      setTimeOfDay(inherited, 0)
    }
  }

  /**
   * ── Speaking a line out loud ──────────────────────────────────────────────
   *
   * Starts (or silences) the voice-over for the line that has just come up, and
   * works out how long the chapter must wait for it.
   *
   * `playStoryLine` resolves the moment the *outcome* is known, not when the
   * clip ends, and the three outcomes are three different holds:
   *
   *   * a **duration** -- the hold becomes the clip plus `VOICE_TAIL`;
   *   * **0**, meaning it is playing but the browser has not decoded a duration
   *     yet -- `voiceWaiting` blocks the auto-advance outright until `onEnded`
   *     fires, because a hold of "unknown" must not be a hold of zero;
   *   * **null** -- nothing is playing (no file, muted, autoplay refused), and
   *     the reading timer rules exactly as it did before any of this existed.
   *
   * The last case is the one that matters most today: **there are no recordings
   * in the repo yet**, so every line takes it, and the chapter must be no
   * different to play than it was. That is why the voice can only ever *extend*
   * the hold, never shorten it.
   *
   * The mouth is re-timed too. `planUtterance` guesses a duration from the text,
   * which is right when it is the only thing anybody has; once a real clip has
   * reported its length the guess is wrong by whatever the speaker's pace is, so
   * `utteranceRate` scales the lip-sync clock to make the two end together.
   * `openAt` is a pure function of `t`, so this is one multiply and no state.
   */
  private startVoice(line: Line | null): void {
    stopStoryLine()
    const token = ++this.voiceToken
    this.voiceHold = 0
    this.voiceWaiting = false
    this.utteranceRate = 1
    if (!line) {
      return
    }
    this.voiceWaiting = true
    void playStoryLine(line, () => {
      if (token !== this.voiceToken) {
        return
      }
      // Finished on its own. Release the block and let the reading timer, which
      // has been running all along, decide when the line goes.
      this.voiceWaiting = false
      this.voiceHold = 0
    }).then(ms => {
      if (token !== this.voiceToken) {
        return
      }
      if (ms === null) {
        this.voiceWaiting = false
        return
      }
      if (ms <= 0) {
        // Playing, length unknown. `voiceWaiting` stays up; `onEnded` clears it.
        return
      }
      this.voiceWaiting = false
      const seconds = ms / 1000
      this.voiceHold = seconds + VOICE_TAIL
      this.utteranceRate = this.utterance.duration > 0 ? this.utterance.duration / seconds : 1
    })
  }

  has(flag: string): boolean {
    return this.flags.has(flag)
  }

  // ── Encounters ───────────────────────────────────────────────────────────

  private spawnEncounter(id: EncounterId): void {
    if (id === 'boarChase' || id === 'boarKill') {
      let boar = this.combat.get('boar')
      if (!boar) {
        boar = new Combatant({ id: 'boar', team: 'beast', stats: STATS.boar!, moveset: 'beast', weapon: null })
        this.combat.add({ id: 'boar', combatant: boar, character: this.boar, brain: 'boar' })
      }
      if (id === 'boarChase') {
        boar.revive()
        // Comes out of the net, which is at the middle of the clearing.
        boar.x = TRAP_CLEARING.x + 1
        boar.z = TRAP_CLEARING.z + 1
        boar.y = this.options.groundAt(boar.x, boar.z)
      }
      return
    }

    // ── The ambush ─────────────────────────────────────────────────────────
    //
    // "Five dark figures with daggers and swords came running" out of the
    // treeline, which in this map is at x ≈ −80. They arrive in a loose line so
    // the player sees five separate shapes rather than one mass — the *arrival*
    // is meant to read as five, and only the fight is meant to read as a wall.
    for (const [i, id] of AMBUSHERS.entries()) {
      const combatant = this.combat.get(id)
      if (!combatant) {
        continue
      }
      combatant.revive()
      const spread = (i - 2) * 4.5
      combatant.x = AMBUSH.x - 17 + Math.abs(spread) * 0.35
      combatant.z = AMBUSH.z + spread
      combatant.y = this.options.groundAt(combatant.x, combatant.z)
      combatant.facing = Math.PI * 0.5
    }
  }

  /**
   * The bandits break, they do not die to the last man.
   *
   * Chapter 1 is explicit: two of them are shot, one is hamstrung, and then the
   * tall one says "we underestimated you", picks up the man on the ground and
   * drags the wounded away into the thicket. Nobody is killed. A fight that ends
   * with five corpses in a meadow is a different chapter about different people.
   */
  private onDeath(id: string): void {
    if ((AMBUSHERS as readonly string[]).includes(id)) {
      const standing = this.combat.aliveAgainst('party')
      if (standing <= 2) {
        this.routBandits()
      }
    }
    if (id === this.playerId) {
      this.phase = 'failed'
      this.player.setEnabled(false)
      this.combat.enabled = false
      this.revision++
    }
  }

  private routBandits(): void {
    for (const id of AMBUSHERS) {
      const combatant = this.combat.get(id)
      if (combatant?.alive) {
        combatant.kill()
      }
    }
  }

  /**
   * Jumps to a beat by id. **Dev only.**
   *
   * A chapter is a linear list of twenty-four beats and the last of them is
   * twenty minutes of play away from the first, so without this the only way to
   * look at the ambush is to play the boar fight. It re-enters the target beat
   * through the same `enterBeat` every other transition uses, so a jump spawns
   * whatever that beat spawns and sets whatever it sets — which is what makes it
   * a jump rather than a corrupt state.
   *
   * It does **not** replay the flags of the beats it skipped, and it says so
   * rather than pretending: a jump past `recover-kit` lands with `armed` unset.
   * That is correct for a debug tool and would be wrong for a save system, which
   * is why this is not one.
   */
  jumpTo(id: string): boolean {
    if (!import.meta.env.DEV) {
      return false
    }
    const index = beatIndex(id)
    if (index < 0) {
      return false
    }
    this.index = index
    this.enterBeat(true)
    return true
  }

  /**
   * ─── Saving the chapter ───────────────────────────────────────────────────
   *
   * A **checkpoint** save: which beat, how the player was doing, and who has
   * said what to them. Loading re-enters that beat through the same `enterBeat`
   * every other transition uses, so the load spawns whatever that beat spawns
   * and stages whoever it stages.
   *
   * ── What it deliberately does not save ──────────────────────────────────
   *
   * Where everybody was standing, how far through a fight they were, which of
   * five bandits had been knocked down. All of that is *within* a beat, and
   * serialising it means serialising fourteen `Combatant`s, their brains, their
   * cooldowns and a boar's charge state — a save format that has to be migrated
   * every time a moveset is tuned.
   *
   * The cost is honest and small: a load puts the player at the start of the
   * beat they saved in, so quick-saving in the middle of the ambush and loading
   * restarts the ambush. For a linear chapter with beats a minute long, that is
   * what a checkpoint is, and the alternative is a save system larger than the
   * chapter it saves.
   */
  snapshot(): StorySnapshot {
    const player = this.combat.get(this.playerId)
    return {
      version: STORY_SAVE_VERSION,
      beatId: this.beat?.id ?? '',
      playerId: this.playerId,
      hp: player ? player.hp / player.stats.maxHp : 1,
      at: player ? { x: player.x, z: player.z, facing: player.facing } : undefined,
      // Sorted, so two saves of the same state are byte-identical — which is
      // what makes "did this actually change" answerable by looking.
      banter: [...this.banterTurns.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    }
  }

  /**
   * Restores a snapshot. Returns false and changes nothing if it cannot.
   *
   * Totally defensive, the same way `sanitiseAppearance` and `sanitiseSettings`
   * are: a save from an older build names a beat that has since been renamed,
   * and the right answer is "that slot will not load" rather than a director
   * sitting on `index = -1` with no beat and no way out.
   */
  restore(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object') {
      return false
    }
    const data = raw as Partial<StorySnapshot>
    if (data.version !== STORY_SAVE_VERSION || typeof data.beatId !== 'string') {
      return false
    }
    const index = beatIndex(data.beatId)
    if (index < 0) {
      return false
    }

    // The act first, then the beat. A save made mid-act names a beat that does
    // not carry a `player` of its own, so the switch has to come from the
    // snapshot — and it has to happen *before* `enterBeat`, which stages the
    // scene around whoever the player currently is.
    if (data.playerId === 'arthusBoy' || data.playerId === 'athalus') {
      this.switchTo(data.playerId)
    }

    this.banterTurns.clear()
    if (Array.isArray(data.banter)) {
      for (const entry of data.banter) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number') {
          this.banterTurns.set(entry[0] as CastId, entry[1])
        }
      }
    }

    this.index = index
    this.enterBeat(true)

    const player = this.combat.get(this.playerId)
    if (player) {
      player.revive()
      // Back where they were standing. `enterBeat` above has already staged
      // everybody else around the beat, so this is the last thing that has to
      // agree with the save — and a beat with no `at` of its own has no other
      // way to put the player anywhere sensible.
      const at = (data as { at?: { x: number; z: number; facing: number } }).at
      if (at && Number.isFinite(at.x) && Number.isFinite(at.z)) {
        player.x = at.x
        player.z = at.z
        player.y = this.options.groundAt(at.x, at.z)
        player.facing = Number.isFinite(at.facing) ? at.facing : player.facing
        this.player.yaw = player.facing
        this.player.reset()
      }
      const fraction = typeof data.hp === 'number' && Number.isFinite(data.hp) ? Math.min(1, Math.max(0.1, data.hp)) : 1
      // Never load into a corpse. A save written on the frame a boar connected
      // would otherwise restore to 2 % health and kill the player again before
      // they had a frame of input — the floor is what makes a bad save
      // survivable rather than a soft lock.
      player.hp = player.stats.maxHp * fraction
    }
    this.revision++
    return true
  }

  /** Puts the player back on their feet at the start of the current beat. */
  retry(): void {
    const athalus = this.combat.get(this.playerId)
    if (!athalus) {
      return
    }
    athalus.revive()
    const beat = this.beat
    if (beat?.at) {
      athalus.x = beat.at.x - 6
      athalus.z = beat.at.z
    }
    athalus.y = this.options.groundAt(athalus.x, athalus.z)
    // Re-entering the beat re-spawns whatever it spawned, which is what makes a
    // retry a retry rather than a resume into an arena that is already empty.
    this.enterBeat(true)
  }

  // ── Per frame ────────────────────────────────────────────────────────────

  update(dt: number): void {
    const beat = this.beat
    const athalus = this.combat.get(this.playerId)
    if (!beat || !athalus) {
      return
    }
    this.beatTime += dt

    // Dialogue auto-advances on a hold timer as well as on input. A player who
    // has put the mouse down should not have the chapter stop; a player who is
    // reading should not have it run away. The timer is generous and any input
    // beats it.
    if (this.lineIndex < this.lines.length) {
      this.lineHeld += dt
      const line = this.lines[this.lineIndex]!
      const seconds = LINE_SECONDS_BASE + (line.de.length + line.en.length) * 0.5 * LINE_SECONDS_PER_CHAR
      // ── A recording is never talked over by the reading timer ────────────
      //
      // `seconds` is a guess made from a character count, and a real speaker
      // does not obey it: the storyteller's long lines run past it and his short
      // ones finish early. So the timer may only ever be *extended* by a clip,
      // never shortened by one -- a line with no recording (which today is all
      // of them) is held for exactly as long as it always was.
      //
      // `voiceWaiting` is the third state: something is playing whose length
      // nobody knows yet, and the only safe hold for that is "not yet".
      if (!this.voiceWaiting && this.lineHeld > Math.max(seconds, this.voiceHold)) {
        this.advanceLine()
      }
    }

    // ── What is in the player's hands ──────────────────────────────────────
    //
    // Pushed into the input layer every frame rather than on a change event,
    // because it is one enum write and the alternative is a subscription that
    // can miss the frame a weapon is sheathed on — which would leave the guard
    // button aiming a bow that is no longer out.
    this.player.weaponMode = this.weaponModeFor(this.playerId)

    this.updateRoofVeil(dt)

    if (this.phase === 'playing' && this.player.takeDraw()) {
      this.toggleDrawn(this.playerId)
    }

    // The household walking in, before the sit and before `combat.update`, for
    // the same reason the sit is here: this writes destinations that the mover
    // then resolves on the same frame rather than one behind.
    this.advanceWalks(dt)

    // ── The sit, before anything reads a position ──────────────────────────
    //
    // Ahead of the intent and ahead of `combat.update`, because the machine
    // writes `athalus.x/z` for the settle slide: written here, the mover skips
    // it (the intent it fills asks for no movement), `c.y = groundAt(c.x, c.z)`
    // resamples the ground under the *new* position, and `settle` draws the
    // figure where it actually is this frame rather than one behind.
    this.advanceSit(dt, athalus)

    if (this.phase === 'playing') {
      // Filled in place, inside the director's own struct. `setPlayerIntent`
      // takes a callback rather than returning the object for the reason the
      // whole combat layer is written to: handing the struct out would let a
      // caller keep it, and an `Intent` that outlives its frame is a player who
      // keeps walking after the conversation starts.
      this.combat.setPlayerIntent(this.playerId, intent => {
        // `fillIntent` runs even while the sit owns the character, and is then
        // overwritten. That is not waste: it is what *drains* the input layer's
        // one-shot latches, so a swing pressed while walking to a bench does not
        // fire the instant the player stands back up. It also keeps the look
        // yaw live, which is the whole point of not calling `setEnabled(false)`
        // — a seated player must still be able to look around.
        this.player.fillIntent(intent, athalus, dt)
        this.overrideSitIntent(intent)
      })
    }

    this.combat.update(dt, this.options.camera.position)
    this.updateSheep(dt, athalus.x, athalus.z)

    // ── Who has the camera ─────────────────────────────────────────────────
    //
    // The conversation rig takes it only for a `dialogue` beat with a speaker
    // who has a body. Both halves of that matter: a *bark* over gameplay
    // ("By Athos, how do I keep getting myself into this?") must not swing the
    // camera off a charging boar, and a `narrator` line is a voice-over card
    // with nobody to shoot — `script.ts` keeps those four aliases bodiless on
    // purpose, and this is the place that depends on it.
    this.speak(dt)
    if (this.dialogueCamera.active) {
      this.dialogueCamera.update(dt, this.shotSpeaker, this.shotFocus, this.shotPartner)
    } else {
      // The camera follows the player, and the crowd count widens the shot.
      this.player.update(dt, athalus.x, athalus.y, athalus.z, this.engagedFoes())
    }

    // ── And the sitter's root, after the pose that needs it ────────────────
    //
    // After `combat.update`, because `CombatDirector.settle` writes the
    // character's transform inside it and this adds to what it wrote — and
    // still before the frame is drawn, because `World.onUpdate` runs ahead of
    // the render. It is the one place the chapter reaches into the scene graph
    // on the combat layer's behalf, and it has to be: the lift depends on the
    // figure's group *scale*, and `combat/` may not know a scene graph exists.
    this.applySeatLift(athalus)

    this.checkBeatExit(beat, athalus.x, athalus.z)
    this.trackObjective(beat, athalus)
    // ── Only while the player can actually walk up to somebody ────────────
    //
    // The prompt is an *invitation to press a key*, and during a conversation
    // that key is bound to advancing the line. Leaving it up meant the "[E]
    // Sprechen" billboard sat over the head of whoever the player happened to
    // be facing for the whole of every dialogue beat — offering a thing that
    // could not be done, over a scene it was competing with. `phase` is already
    // the gate on input (`enterBeat` sets `player.setEnabled(false)` for a
    // dialogue), so the prompt follows the same switch rather than a second one.
    this.talkTarget = this.phase === 'playing' ? this.findTalkTarget(athalus) : null

    // ── Walking up to somebody and talking to them ─────────────────────────
    //
    // Deliberately *after* `checkBeatExit`, which is where an `interact` beat
    // consumes the same key. So standing at the rope with Kareen beside you cuts
    // the rope — the chapter wins the button, and chatting is what the key does
    // when the chapter has no use for it.
    if (this.phase === 'playing' && this.talkTarget && this.player.takeInteract()) {
      this.startBanter(this.talkTarget.id as CastId)
    }

    // ── And sitting down is what the key does after that ───────────────────
    //
    // Last of the three consumers of `takeInteract`, and the order is the
    // priority: the chapter's own interaction wins (`checkBeatExit`), then a
    // person, then a bench. A player standing at the rope with Kareen beside
    // them and a bench behind cuts the rope; the same player with nothing else
    // to do sits down.
    this.updateSeat(athalus)
  }

  // ── Sitting on things ──────────────────────────────────────────────────────

  /**
   * Drops any sit in progress, for whoever is currently the player.
   *
   * The one entry point every non-frame path uses — a beat starting, an aside
   * starting, a load, a retry, the actor switching. It is safe to call when
   * nobody is sitting and safe to call twice, which is what lets it be sprinkled
   * on every path that moves people without any of them having to ask first.
   */
  private cancelSit(): void {
    if (!this.sit.active) {
      return
    }
    const actor = this.sitActorId ? this.combat.get(this.sitActorId) : null
    if (actor) {
      this.sit.cancel(actor)
    } else {
      // The actor is gone, which only a rebuilt cast can do. Ask the machine to
      // let go of *something* rather than leaving it holding a seat forever.
      this.sit.cancel({ x: 0, z: 0, postureBlend: 0, sit: () => {}, stand: () => {} })
    }
    this.sitActorId = null
    this.seatPrompt = null
  }

  /**
   * Raises a seated figure's root so its backside lands on the seat.
   *
   * All of the reasoning is on `seatRootLift`. What is here is the one thing
   * that arithmetic cannot know: which `Character` the sitter is, and therefore
   * what scale it was built at. `cast.ts` puts the boy at 0.68 and the girl at
   * 0.62, which is 10 and 13 centimetres of stool respectively.
   */
  private applySeatLift(player: Combatant): void {
    const seat = this.sit.seat
    if (!seat) {
      return
    }
    const character = this.characters.get(this.playerId)
    if (!character) {
      return
    }
    // `settle` has just written `group.position.y = c.y`; this adds to it.
    // Uniform scale — `cast.ts` says so and says why — so any axis will do.
    character.group.position.y = player.y + seatRootLift(seat.y - player.y, character.group.scale.y, player.postureBlend)
  }

  /**
   * Moves the sit machine on, and takes it away when the world says so.
   *
   * ── The five interruptions, and why each one is here ──────────────────────
   *
   * `SitController` is deliberately ignorant, so *every* rule about when a sit
   * may continue lives in this method. All five drop the posture outright
   * rather than playing the stand-up, because all five are the world insisting
   * rather than the player asking — and 0.85 s of getting up politely out of a
   * chair is 0.85 s of a bandit hitting somebody who cannot move.
   *
   *   * the phase left `playing` — a dialogue beat, a death, the end of the
   *     chapter. `enterBeat` cancels too; this catches the paths that change
   *     phase without going through it.
   *   * an aside started. `startBanter` cancels as well, for the same reason.
   *   * the player died.
   *   * the player was **hit**. Sitting through a blow is the single worst
   *     thing this feature could do, and the ambush is two beats away from
   *     der Treff's benches.
   *   * anything hostile is engaged. Not "was hit" — *is present*: the sit
   *     must end when the fight starts, not when it lands.
   */
  private advanceSit(dt: number, player: Combatant): void {
    if (!this.sit.active) {
      this.lastHp = player.hp
      return
    }
    const hit = player.hp < this.lastHp - 1e-3
    this.lastHp = player.hp
    if (this.phase !== 'playing' || !player.alive || this.parkedLines !== null || hit || this.engagedFoes() > 0) {
      this.sit.cancel(player)
      this.sitActorId = null
      this.seatPrompt = null
      this.revision++
      return
    }
    // Taking the controls back cancels the *walk*, and only the walk. The brief
    // is that E and Esc are what get you out of a seat, so leaning on W while
    // sitting must not shuffle the player off a bench — but before the walk-up
    // has committed anything, a movement key plainly means "no".
    if (this.sit.phase === 'walking' && this.player.moving) {
      this.sit.release(player)
      this.sitActorId = null
      this.seatPrompt = null
      this.revision++
      return
    }
    this.sit.update(dt, player)
  }

  /**
   * Replaces whatever the keys asked for with whatever the seat asks for.
   *
   * Everything a character could be *doing* is cleared rather than left alone:
   * a guard held while walking to a bench would otherwise arrive as a figure
   * sitting down behind a raised shield. The movement fields carry the walk-up,
   * which is the whole of how the seat steers the player — see
   * `SitController`'s header on why that is an intent and not a teleport.
   */
  private overrideSitIntent(intent: Intent): void {
    if (!this.sit.active) {
      return
    }
    this.player.lowerWeapon()
    intent.moveX = this.sit.moveX
    intent.moveZ = this.sit.moveZ
    intent.throttle = this.sit.throttle
    intent.facing = this.sit.facing
    intent.attackLight = false
    intent.attackHeavy = false
    intent.guard = false
    intent.dodge = false
    intent.shoot = false
  }

  /**
   * The seat prompt, and the key that acts on it.
   *
   * One method for both, because the prompt and the key have to agree about
   * *which* seat by construction: resolving the focus twice is how a player
   * ends up sitting on the bench next to the one the label was over.
   */
  private updateSeat(player: Combatant): void {
    if (!this.seats) {
      this.seatPrompt = null
      return
    }

    // ── Already committed ─────────────────────────────────────────────────
    if (this.sit.active) {
      const seat = this.sit.seat
      // Only the settled state gets a prompt. During the walk-up and both
      // blends the player has already told the game what they want, and a label
      // that reads "press E to sit" while the character is walking to a bench
      // to sit down is the game arguing with itself.
      if (seat && this.sit.seated) {
        this.seatSlot.at.x = seat.x
        this.seatSlot.at.y = seat.y + SEAT_PROMPT_LIFT
        this.seatSlot.at.z = seat.z
        this.seatSlot.distance = Math.hypot(seat.x - player.x, seat.z - player.z)
        this.seatSlot.seated = true
        this.seatPrompt = this.seatSlot
      } else {
        this.seatPrompt = null
      }
      // The same key both ways round, and it works from the walk-up onward so
      // "no, never mind" is possible before the character has even arrived.
      if (this.sit.holding && this.player.takeInteract() && this.sit.release(player)) {
        this.revision++
      }
      return
    }

    // ── Free to sit? ──────────────────────────────────────────────────────
    //
    // Gated at least as carefully as the talk interaction, and one condition
    // tighter: `talkTarget !== null` suppresses the seat entirely, so the two
    // prompts are never on screen together and the key is never ambiguous. A
    // person always beats a bench.
    const free =
      this.phase === 'playing' &&
      player.alive &&
      this.parkedLines === null &&
      !this.canInteract &&
      this.talkTarget === null &&
      this.engagedFoes() === 0
    if (!free) {
      this.seatPrompt = null
      return
    }

    // The **camera's** yaw, not the character's: the prompt has to name what
    // the player is looking at, and a third-person figure's facing trails the
    // camera by up to a whole turn. Same rule as `findTalkTarget`.
    const focus = this.seats.find(player.x, player.z, Math.sin(this.player.yaw), Math.cos(this.player.yaw))
    if (!focus) {
      this.seatPrompt = null
      return
    }
    const seat = focus.seat
    this.seatSlot.at.x = seat.x
    this.seatSlot.at.y = seat.y + SEAT_PROMPT_LIFT
    this.seatSlot.at.z = seat.z
    this.seatSlot.distance = focus.distance
    this.seatSlot.seated = false
    this.seatPrompt = this.seatSlot

    if (this.player.takeInteract() && this.sit.request(seat, player.x, player.z)) {
      this.sitActorId = this.playerId
      this.seatPrompt = null
      this.revision++
    }
  }

  /**
   * Escape, offered to the chapter before the pause menu sees it.
   *
   * Returns true when it was used, which is the shell's cue *not* to open the
   * menu — `StoryScene.onWindowKey` asks this first. Without that handshake the
   * one key that means "get me out of this" would stand the player up and open
   * the pause screen over the top of them on the same press.
   *
   * Only ever answers for a sit. Anything else Escape might come to mean in the
   * chapter belongs on its own branch here rather than folded into this one.
   */
  escape(): boolean {
    // The *sitter*, not whoever the story currently calls the player. They are
    // the same person every time Escape can actually reach this — the only
    // thing that separates them is the cut, and the cut cancels — and reading
    // the same field `cancelSit` reads is what keeps that true by construction.
    const player = this.combat.get(this.sitActorId ?? this.playerId)
    if (!player || !this.sit.holding) {
      return false
    }
    if (!this.sit.release(player)) {
      return false
    }
    this.seatPrompt = null
    this.revision++
    return true
  }


  /**
   * Opens a walk-up conversation with `who`.
   *
   * Runs through the *same* machinery as a scripted scene — `phase` goes to
   * `dialogue`, the input layer is switched off, the dialogue camera picks it up
   * and the lip sync plans the line — which is the point. A second, lighter path
   * for "unimportant" dialogue is how you end up with ambient lines that do not
   * move a mouth and do not get a camera, and the difference is visible
   * immediately.
   */
  private startBanter(who: CastId): void {
    const turn = this.banterTurns.get(who) ?? 0
    const line = banterFor(who, turn)
    if (!line) {
      return
    }
    this.banterTurns.set(who, turn + 1)
    // An aside is a conversation, and a conversation is not had from a bench
    // the other person cannot see you on. Cancelled before the phase changes,
    // so `advanceSit`'s own guard never has to be the one that catches it.
    this.cancelSit()
    this.parkedLines = { lines: this.lines, index: this.lineIndex }
    this.lines = [line]
    this.lineIndex = 0
    this.lineHeld = 0
    this.phase = 'dialogue'
    this.combat.enabled = false
    this.player.setEnabled(false)
    this.revision++
  }

  /**
   * Ends a walk-up conversation and gives the beat its script back.
   *
   * Returns true if there was one to end — which is how `advanceLine` tells an
   * aside apart from the chapter running out of lines, without either of them
   * having to know the other exists.
   */
  private endBanter(): boolean {
    if (!this.parkedLines) {
      return false
    }
    this.lines = this.parkedLines.lines
    this.lineIndex = this.parkedLines.index
    this.parkedLines = null
    this.lineHeld = 0
    this.phase = 'playing'
    this.combat.enabled = true
    this.player.setEnabled(true)
    this.revision++
    return true
  }

  /**
   * Runs the mouth and stages the shot for whoever is talking.
   *
   * ── One method because they share every decision ────────────────────────────
   *
   * Who is speaking, whether that speaker has a body, and who they are speaking
   * *to* are the three questions the lip sync and the camera both have to
   * answer, and answering them twice is how the two end up disagreeing — a
   * figure mouthing a line while the camera frames the person they are
   * answering. So they are answered once, here, and both consumers are fed from
   * the same answer.
   */
  private speak(dt: number): void {
    const line = this.lineIndex < this.lines.length ? this.lines[this.lineIndex]! : null

    // ── Re-plan when the line changes ─────────────────────────────────────
    //
    // Compared by identity rather than by index: `lineIndex` returns to 0 on
    // every new beat, so an index compare misses the very first line of every
    // scene — the figure would stand mute through the opening sentence and
    // start moving on the second.
    if (line !== this.plannedFor) {
      this.plannedFor = line
      this.utteranceTime = 0
      this.utterance = line ? planUtterance(storyLine(line, this.locale)) : SILENCE
      // After the utterance is planned: `startVoice` scales it against the
      // clip's real length and needs the planned duration to scale *from*.
      this.startVoice(line)
    } else {
      this.utteranceTime += dt
    }

    const speaker = line ? this.bodyOf(line.who) : null

    // Shut the mouth of whoever was last talking, before opening anyone else's.
    // Without this a figure interrupted mid-word keeps that word's mouth shape
    // for the rest of the chapter — the pose is a vertex write, not an
    // animation, so nothing else will ever put it back.
    if (this.speaking && this.speaking !== speaker) {
      this.characters.get(this.speaking)?.setMouthOpen(0)
    }
    this.speaking = speaker
    if (speaker) {
      this.characters.get(speaker)?.setMouthOpen(openAt(this.utterance, this.utteranceTime * this.utteranceRate))
    }

    // ── The shot ───────────────────────────────────────────────────────────
    if (this.phase !== 'dialogue' || !speaker) {
      if (this.dialogueCamera.active) {
        // Hand back where the shot left off, so gameplay glides out of the
        // scene instead of cutting to the follow camera's old position.
        this.player.seedFrom(this.options.camera.position)
        this.dialogueCamera.end()
      }
      return
    }
    if (!this.fillFocus(speaker, this.shotFocus)) {
      return
    }
    this.shotSpeaker = speaker
    const partner = this.partnerFor(speaker)
    this.shotPartner = partner && this.fillFocus(partner, this.shotPartnerFocus) ? this.shotPartnerFocus : null
    this.dialogueCamera.begin()
  }

  /**
   * The cast member behind a `Speaker`, or null for a voice with no body.
   *
   * `narrator`, `arthus`, `lena`, `smith` and `nidaneVoice` are deliberately not
   * cast ids — see the note in `script.ts`. They are voice-over across a cut,
   * drawn as a fireside card, and they must not move the camera or a jaw.
   */
  private bodyOf(who: Speaker): CastId | null {
    return speakerBody(who, id => this.characters.has(id))
  }

  /**
   * ─── The flock, and what happens to it when the story leaves the island ──
   *
   * The gate is **the camera's distance to the paddock**, not the act.
   *
   * The act would be the obvious test — `playerId === 'arthusBoy'` is the island
   * — and it is subtly wrong in both directions. It is wrong when the frame act
   * cuts to a dialogue two-shot, because the *camera* is what decides whether a
   * sheep is on screen and `DialogueCamera` puts it wherever the shot needs;
   * and it is wrong for `__story.jumpTo`, which is how every one of these beats
   * is actually looked at in a browser and which changes the beat without asking
   * this class anything. Distance is true in every one of those cases and costs
   * two multiplies.
   *
   * `SHEEP_RANGE` is past `cullDistanceFor(1)` (~285 m at bias 1), so by the time
   * the flock is switched off its own LOD ladder has already stopped drawing it
   * — the handoff cannot be seen. Everything past that is 1.7 km of ocean.
   */
  private updateSheep(dt: number, playerX: number, playerZ: number): void {
    const dx = this.options.camera.position.x - SHEEP_PADDOCK.x
    const dz = this.options.camera.position.z - SHEEP_PADDOCK.z
    const near = dx * dx + dz * dz < SHEEP_RANGE * SHEEP_RANGE
    this.sheep.setActive(near)
    if (!near) {
      return
    }
    // Re-read every frame rather than captured: the collision world is rebuilt
    // when placements change, and `options.collision` is a getter for that
    // reason. The flock steers against exactly what the player walks into, which
    // is what keeps a sheep out of the well without a second list of props.
    this.sheep.collision = this.options.collision()
    this.sheep.update(dt, this.options.camera.position, playerX, playerZ, this.phase !== 'loading')
  }

  /**
   * ─── Opening the roof ───────────────────────────────────────────────────
   *
   * `hut-roof` is a real shingled roof over a room the chapter is played
   * *inside*. That is a contradiction the interior has ducked until now by
   * simply not having a roof (`assets/interior.ts` explains at length why the
   * ceiling is cut away: a story camera 2.9 m up in a room 2.9 m to the wall
   * plate is at the roof line, so every indoor beat would be shot through the
   * underside of one).
   *
   * So the roof is solid from outside and dissolves when the player goes in.
   * Two tests, and the second is the one that is easy to forget:
   *
   *   * **the player is in the room** — `HUT_ROOM`, which is the room's own
   *     rectangle plus a metre so the roof is already open by the time they are
   *     under it and stays open while they stand in the doorway;
   *   * **or the conversation is with somebody who is** — a dialogue beat moves
   *     the camera to a two-shot that can sit anywhere, including outside the
   *     wall looking in, and the roof has to be out of the way for that too.
   *     Without this clause the frame act's last three beats are played against
   *     shingles.
   *
   * Eased rather than switched. A roof that pops from solid to a quarter
   * coverage on the frame a foot crosses the threshold is a flicker; 3.5 units
   * a second is about a third of a second across the whole range, which is
   * roughly how long walking through a doorway takes anyway.
   *
   * 0.22 rather than 0: the dither leaves a quarter of the shingles standing,
   * which reads as a roof you are looking *through* rather than as a roof that
   * has been deleted — and it keeps the ridge line in the shot, which is most of
   * what tells the player they are indoors.
   */
  private updateRoofVeil(dt: number): void {
    const player = this.combat.get(this.playerId)
    const inside = (x: number, z: number): boolean =>
      Math.abs(x - HUT_ROOM.x) <= HUT_ROOM.halfX && Math.abs(z - HUT_ROOM.z) <= HUT_ROOM.halfZ

    let open = player ? inside(player.x, player.z) : false
    // ── And when the *lens* is in the room, whoever else is ────────────────
    //
    // The follow camera rides a 5.6 m arm and its spring (`StoryPlayer`) stops
    // it at a *collider*. The hut's walls have one and its roof does not — it
    // cannot: a collider is a ground-anchored box (`collision.ts` sets
    // `baseY = placement.y`), so a box round the roof would be a box across the
    // doorway. So a player standing outside the north wall can still swing the
    // lens up over a 2.86 m wall into the roof space, and see the underside of
    // the shingles and the room through them.
    //
    // Testing the camera as well as the player closes that without a collider:
    // whatever puts the lens indoors, the roof opens for it.
    if (!open) {
      const lens = this.options.camera.position
      open = inside(lens.x, lens.z)
    }
    if (!open && this.phase === 'dialogue') {
      // Whoever is speaking, and whoever they are speaking to. `speakerBody`
      // resolves a script's speaker to an actor id; a line with no body — the
      // narrator — leaves this false, which is right: the narrator is not in the
      // room.
      const line = this.lines[this.lineIndex]
      const speaking = line ? speakerBody(line.who, id => this.combat.get(id) !== null) : null
      const other = speaking ? this.combat.get(speaking) : null
      open = other ? inside(other.x, other.z) : false
    }

    const target = open ? 0.22 : 1
    if (this.roofVeil !== target) {
      const step = dt * 3.5
      this.roofVeil =
        this.roofVeil < target
          ? Math.min(target, this.roofVeil + step)
          : Math.max(target, this.roofVeil - step)
    }
    if (this.roofVeil !== this.roofVeilWritten) {
      this.roofVeilWritten = this.roofVeil
      this.options.setPlacementVeil?.('hut-roof', this.roofVeil)
    }
  }

  /**
   * Head position and facing for the camera, or false if they are not on stage.
   *
   * A parked figure sits at `PARKED_Y` — 400 m underground — and framing one
   * puts the camera in the dark under the map. That is not hypothetical: the
   * whole cast is built during the load and moved into place per act, so at any
   * moment most of them are down there.
   */
  private fillFocus(id: CastId, out: Focus): boolean {
    const character = this.characters.get(id)
    const actor = this.combat.get(id)
    if (!character || !actor || actor.y < PARKED_Y / 2) {
      return false
    }
    character.headPosition(_head)
    out.x = _head.x
    out.y = _head.y
    out.z = _head.z
    out.facing = actor.facing
    return true
  }

  /**
   * Who the speaker is talking to.
   *
   * ── Read off the script, not off the room ──────────────────────────────────
   *
   * The obvious implementation is "the nearest other character", and it picks
   * the wrong person constantly: the fireside has five people in a small room,
   * and the nearest body to the storyteller is whichever grandchild happens to
   * be sitting closest, not the one who just asked him a question.
   *
   * So the partner is the nearest **other bodied speaker in this same scene** —
   * searched backwards first, because the person you are answering is the person
   * who spoke last, and only then forwards for the opening line of a scene,
   * where the partner is whoever answers.
   */
  private partnerFor(speaker: CastId): CastId | null {
    for (let i = this.lineIndex - 1; i >= 0; i--) {
      const other = this.bodyOf(this.lines[i]!.who)
      if (other && other !== speaker) {
        return other
      }
    }
    for (let i = this.lineIndex + 1; i < this.lines.length; i++) {
      const other = this.bodyOf(this.lines[i]!.who)
      if (other && other !== speaker) {
        return other
      }
    }
    // A monologue with the player standing there: shoot it as a two-hander
    // anyway, because the player is in the room and cutting them out of a line
    // addressed to them is worse than a slightly arbitrary reverse.
    return speaker === this.playerId ? null : this.playerId
  }

  /**
   * Where the current objective is and how far away, for the locator.
   *
   * The **distance is measured to the trigger's edge, not to its centre**, and
   * clamped at zero. A locator that reads "4 m" while the player is already
   * standing inside the radius that completes the beat is a locator that is
   * lying about the only thing it exists to say.
   */
  private trackObjective(beat: Beat, player: Combatant): void {
    if (!beat.at || this.phase === 'dialogue') {
      this.objectiveAt = null
      this.objectiveDistance = null
      return
    }
    const centre = beat.at
    _at.set(centre.x, this.options.groundAt(centre.x, centre.z) + 1.1, centre.z)
    this.objectiveAt = { x: _at.x, y: _at.y, z: _at.z }
    const flat = Math.hypot(centre.x - player.x, centre.z - player.z)
    this.objectiveDistance = Math.max(0, flat - centre.radius)
  }

  /**
   * Who the interact key would talk to.
   *
   * ── Aim beats proximity, and that is the whole rule ────────────────────
   *
   * The owner's brief: *"the NPC with the camera pointing at has priority"*.
   * So candidates are scored by **how close they are to the middle of the
   * screen**, not by how close they are to the player — two people standing
   * shoulder to shoulder are the same distance away, and the only thing that
   * can break that tie is where the player is looking.
   *
   * Distance still gates *whether* anybody is a candidate (`TALK_RANGE`) and
   * still breaks a tie between two people the camera covers equally, but it
   * cannot outrank the aim: walking past someone must not steal the prompt from
   * the person you are facing.
   */
  private findTalkTarget(player: Combatant): StoryState['talkTarget'] {
    const forwardX = Math.sin(this.player.yaw)
    const forwardZ = Math.cos(this.player.yaw)
    let best: StoryState['talkTarget'] = null
    let bestScore = -1

    for (const id of this.talkable) {
      const other = this.combat.get(id)
      if (!other || !other.alive || id === this.playerId) {
        continue
      }
      const dx = other.x - player.x
      const dz = other.z - player.z
      const distance = Math.hypot(dx, dz)
      if (distance > TALK_RANGE || distance < 1e-3) {
        continue
      }
      // cos of the angle between the camera's heading and the line to them.
      const facing = (dx * forwardX + dz * forwardZ) / distance
      if (facing < TALK_CONE) {
        continue
      }
      // Aim dominates; distance only separates two equally-centred people.
      const score = facing * 10 - distance * 0.1
      if (score > bestScore) {
        bestScore = score
        // Reuses the one struct rather than allocating a winner per candidate:
        // this runs every frame over nine cast members, and the loop is allowed
        // to change its mind several times before it settles.
        const character = this.characters.get(id)
        if (character) {
          character.headPosition(_head)
        } else {
          _head.set(other.x, other.y + 1.3, other.z)
        }
        this.talkSlot.id = id
        this.talkSlot.nameKey = id as Speaker
        this.talkSlot.distance = distance
        this.talkSlot.at.x = _head.x
        this.talkSlot.at.y = _head.y
        this.talkSlot.at.z = _head.z
        best = this.talkSlot
      }
    }
    return best
  }

  private checkBeatExit(beat: Beat, x: number, z: number): void {
    // An aside freezes the chapter. Without this a `survive` or `timer` beat
    // keeps counting down behind the conversation and can finish *while* it is
    // on screen, which restores the parked lines of a beat that no longer
    // exists — the chapter silently skipping one step because the player stopped
    // to talk to somebody.
    if (this.parkedLines) {
      return
    }
    switch (beat.kind) {
      case 'dialogue':
        // Advanced by `advanceLine`.
        return

      case 'travel': {
        if (!beat.at) {
          this.finishBeat()
          return
        }
        const reached = Math.hypot(x - beat.at.x, z - beat.at.z) < beat.at.radius
        // A talking walk waits for both: arriving early stands the party at the
        // destination until the conversation finishes, which is what people do.
        // `awaitCast` adds a third condition — the room has to have filled up.
        // See the note on the field in `chapter1.ts`; it cannot deadlock,
        // because every leg of every walk carries its own give-up.
        const waiting = beat.awaitCast === true && this.walking.size > 0
        if (reached && !waiting && (!this.overTalk || this.lineIndex >= this.lines.length)) {
          this.finishBeat()
        }
        return
      }

      case 'interact': {
        if (!beat.at) {
          this.finishBeat()
          return
        }
        this.canInteract = Math.hypot(x - beat.at.x, z - beat.at.z) < beat.at.radius
        if (this.canInteract && !this.interacted && this.player.takeInteract()) {
          this.interacted = true
          if (this.lines.length > 0) {
            // The interaction *starts* the dialogue rather than ending the beat,
            // so cutting the rope is followed by the party's reaction to what it
            // did — which is the whole joke of that scene.
            this.phase = 'dialogue'
            this.combat.enabled = false
            this.player.setEnabled(false)
            this.lineIndex = 0
            this.revision++
          } else {
            this.finishBeat()
          }
        }
        return
      }

      case 'survive': {
        if (beat.at && Math.hypot(x - beat.at.x, z - beat.at.z) < beat.at.radius) {
          this.finishBeat()
          return
        }
        if (beat.seconds !== undefined && Number.isFinite(beat.seconds) && this.beatTime > beat.seconds) {
          this.finishBeat()
        }
        return
      }

      case 'combat': {
        if (beat.encounter === 'boarKill') {
          const boar = this.combat.get('boar')
          if (!boar || !boar.alive) {
            this.finishBeat()
          }
          return
        }
        if (this.combat.aliveAgainst('party') === 0) {
          this.finishBeat()
        }
        return
      }

      default:
        return
    }
  }

  /**
   * What the controls mean right now, from what is actually in a hand.
   *
   * Read from `CharacterEquipment.drawn` rather than from the loadout, because
   * a sheathed sword is not a guard you can raise — the distinction between
   * "owns a blade" and "is holding a blade" is exactly what the right mouse
   * button needs to know.
   */
  private weaponModeFor(id: string): WeaponMode {
    const kit = this.equipment.get(id)
    if (!kit) {
      return 'none'
    }
    const drawn = kit.drawn
    if (drawn === 'bow' || drawn === 'crossbow') {
      return 'bow'
    }
    if (drawn === 'mainHand' || drawn === 'twoHand') {
      return 'melee'
    }
    return 'none'
  }

  /**
   * Draws or sheathes, picking the sensible weapon.
   *
   * The order — main hand, then a bow, then a two-hander — is the order the
   * chapter wants: Athalus's dagger is the thing he actually has, and a player
   * who taps the draw key in a fight should get the fast weapon rather than a
   * 1.9 s reach behind their own shoulder. `canDraw` refuses anything the
   * loadout cannot support, so an empty hand is a no-op rather than a pose.
   */
  private toggleDrawn(id: string): void {
    const kit = this.equipment.get(id)
    if (!kit) {
      return
    }
    // Branch on a **local copy**, not on the getter. Guarding on `kit.drawn`
    // itself narrows it to `'sheathed'` for the rest of the function, and the
    // loop below then compares a value TypeScript believes is impossible — even
    // though `setDrawn` has changed it in between. The copy keeps the getter
    // un-narrowed, which is what lets the loop read back what actually happened.
    const current: DrawnState = kit.drawn
    if (current !== 'sheathed') {
      kit.setDrawn('sheathed')
      return
    }
    for (const state of ['mainHand', 'bow', 'twoHand', 'crossbow'] as const) {
      // `setDrawn` ignores an illegal request rather than throwing, so this
      // loop is asking "which of these can this loadout actually do" and taking
      // the first answer.
      kit.setDrawn(state)
      if (kit.drawn === state) {
        return
      }
    }
  }

  /** The bow. Called by the shell when the player looses; needs the camera's aim. */
  shootFromCamera(): void {
    this.player.aimDirection(_aim)
    this.combat.shoot(this.playerId, _aim, 20)
  }

  dispose(): void {
    this.player.detach()
    for (const kit of this.equipment.values()) {
      kit.dispose()
    }
    this.equipment.clear()
    for (const character of this.characters.values()) {
      character.dispose()
    }
    this.characters.clear()
    this.boar.dispose()
    this.sheep.dispose()
    this.combat.dispose()
    this.group.clear()
  }
}

/**
 * How long a line holds before it advances itself.
 *
 * Two seconds plus 45 ms a character, which is about 22 characters a second —
 * comfortably slower than reading speed in either language, so the timer is a
 * floor under an inattentive player rather than a pace anyone has to keep up
 * with. Any click or key beats it.
 */
/**
 * Silence held after a voice clip ends, seconds.
 *
 * A line that vanishes on the speaker's last consonant reads as being cut off.
 * Short enough that a scene does not drag between lines; the reading timer is
 * generous anyway and usually wins for the short ones.
 */
const VOICE_TAIL = 0.45

const LINE_SECONDS_BASE = 2.0
const LINE_SECONDS_PER_CHAR = 0.045

/**
 * Where each companion walks, `[right, forward]` in the player's own frame.
 *
 * All three are **ahead** of the player and out to the side, and that is a
 * camera decision before it is a fiction one: the shot sits 5.4 m behind
 * Athalus, so a companion stationed behind him spends the walk home standing in
 * the lens. Ahead puts them in frame, which is also where people walking with
 * you actually are.
 *
 * The spread is asymmetric on purpose. Jester is closest and on the left because
 * he is the brother and the book keeps them side by side; Gearn is furthest out
 * and furthest forward because he is the fastest of the four and would be; and
 * Kareen is nearly abreast, because a hip-length-haired archer with a bow taller
 * than she is only reads at all in profile.
 */
const STATION: Partial<Record<CastId, readonly [number, number]>> = {
  jester: [-1.7, 1.1],
  gearn: [2.4, 2.0],
  kareen: [1.5, -0.3],
  theodor: [-2.6, 0.6]
}

/**
 * Which stat block an actor uses.
 *
 * The frame's household map to `villager` — a deliberately feeble block that
 * exists so a nine-year-old is not carrying a bandit's reach and hit points.
 * None of them ever fights; the block is there because `Combatant` requires one
 * and a shared default would silently make the wrong claim.
 */
const statsKeyFor = (id: CastId): string => {
  if (id === 'bandit' || id === 'banditLeader' || id === 'theodor') {
    return id
  }
  if (FIRESIDE.includes(id) || id === 'nidane') {
    return 'villager'
  }
  return id
}

const brainFor = (id: CastId): 'none' | 'bandit' | 'ally' | 'allyArcher' => {
  if (id === 'athalus') {
    return 'none'
  }
  if (id === 'bandit' || id === 'banditLeader') {
    return 'bandit'
  }
  if (id === 'kareen') {
    return 'allyArcher'
  }
  // ── The frame's household have no brains, and that is the point ──────────
  //
  // `ally` is the default below and it is wrong for every one of them: it would
  // have an eighty-year-old, a smith, a mother and a seven-year-old form up
  // behind Arthus and follow him round his own kitchen. They are staged by the
  // beats instead (`enterBeat`), which is what a scene is.
  //
  // Nidane is here for the same reason: she stands in a doorway with her arms
  // folded and delivers the last dialogue in the chapter.
  if (id === 'nidane' || FIRESIDE.includes(id)) {
    return 'none'
  }
  return 'ally'
}
