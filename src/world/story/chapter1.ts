import type { CastId } from './cast'
import { HUT, HUT_DOOR } from './frame'
import type { ScriptId } from './script'
import { AMBUSH, BRIDGE, SMITHY, TRAP_CLEARING, TREFF, WEST_GATE } from './level'

/**
 * ─── Chapter 1 as a sequence of beats ───────────────────────────────────────
 *
 * A flat, ordered list. Not a graph, not a state machine with edges, not a
 * scripting language — a list, played from the top, one at a time.
 *
 * ── Why flat ────────────────────────────────────────────────────────────────
 *
 * Because the chapter is. *Die Trollschweinjagd* has no branch in it: the trap
 * fails, the boar picks Athalus, they kill it, they carry it home arguing about
 * the King, they are ambushed, they win, they reach the gate, they get told off
 * by his mother. Every one of those happens once and in that order.
 *
 * A graph would let the chapter express things the chapter does not contain, and
 * the cost of that expressiveness is real: a save is a beat index and a set of
 * flags here, against a graph traversal and a visited set; a bug is "beat 7 did
 * not advance" against "which of eleven edges was taken"; and a designer reading
 * this file sees the chapter in the order a reader sees it.
 *
 * The day a chapter branches, this becomes a list per branch and something above
 * it chooses. That is a smaller change than starting with a graph.
 *
 * ── The five kinds ──────────────────────────────────────────────────────────
 *
 * Deliberately few. Everything in the chapter is one of:
 *
 *   * **`dialogue`** — lines play, the player waits. Combat is frozen.
 *   * **`travel`** — walk to a place. The party follows; dialogue may run over
 *     the top of it (that is what `overTalk` is for, and it is what makes the
 *     walk home a conversation rather than a loading corridor).
 *   * **`combat`** — an encounter is spawned and the beat ends when it resolves.
 *   * **`interact`** — stand somewhere and press the key. Picking up a dropped
 *     bow, climbing a tree, laying a carcass down.
 *   * **`survive`** — like combat, but the win condition is *time* or a place
 *     rather than a body count. The boar chase is this and nothing else would
 *     do: the chapter is explicit that Athalus does not beat the animal, he gets
 *     up a tree and his friends shoot it.
 */

export type BeatKind = 'dialogue' | 'travel' | 'combat' | 'interact' | 'survive'

export interface Beat {
  id: string
  kind: BeatKind
  /**
   * Who the player *is* for this beat. Carried forward when omitted.
   *
   * Two people, and the switch between them is the chapter's whole structure:
   * you are **Arthus**, nine years old, for the frame act on the island, and
   * **Athalus** for the story he is being told. Nothing else about a beat
   * changes — the same camera, the same intent struct, the same director — which
   * is what makes the cut cost one field instead of a second game mode.
   */
  player?: CastId
  /** Lines to play. For `travel`, played *while* walking — see `overTalk`. */
  script?: ScriptId
  /**
   * i18n key under `story.objective.*` for the HUD line.
   *
   * Chrome, so unlike the dialogue this **is** in all 21 locales: an objective
   * is functional text of exactly the kind machine translation is good at.
   */
  objective?: string
  /** `travel` and `interact`: where. */
  at?: { x: number; z: number; radius: number }
  /** `travel`: the lines run over the walk instead of stopping it. */
  overTalk?: boolean
  /** `combat` / `survive`: which encounter to raise. */
  encounter?: EncounterId
  /** `survive`: seconds, or `Infinity` when the exit is a place. */
  seconds?: number
  /**
   * Story flags this beat sets on completion.
   *
   * A string set rather than typed fields, because they are read by exactly one
   * thing (the director's own switch) and adding one should not be a change to
   * an interface three files import.
   */
  sets?: readonly string[]
  /**
   * -- Where the sun is for this scene ---------------------------------------
   *
   * Time of day in `[0,1)`, the same units `DayCycle` uses: 0 is midnight, 0.25
   * sunrise, 0.5 noon, 0.75 sunset. Omitted means *carry on from the last beat
   * that named one*, which is the common case -- a scene and the scene after it
   * are usually the same afternoon.
   *
   * -- Why the chapter drives the sun at all ---------------------------------
   *
   * Because the sandbox's clock and a told story want opposite things from the
   * same system. `DayCycle` runs a full day in 24 real minutes, which is right
   * for a world you wander: the light is different every time you come back to
   * a place. Applied to a chapter it is nonsense -- the sun crosses **15 degrees
   * per real minute**, so a twenty-minute playthrough of *Die Trollschweinjagd*
   * would leave the trap at dawn, kill the boar before breakfast and reach the
   * gate somewhere in the following night. The hunt would take a week.
   *
   * So story mode freezes the natural advance and the beats become the only
   * thing that moves the sun. That is not a workaround: a scene's light is a
   * property of the scene, in the same way its dialogue is, and the manuscript
   * is explicit about it -- the four of them agree to roast the boar "that
   * evening", and Nidane is in the doorway when they get home.
   *
   * -- `timeBlend`, and the difference between a walk and a cut --------------
   *
   * Real seconds to slide there. **Omitted or 0 snaps**, and that is the right
   * answer for a *cut*: `prologue` crosses sixty years and `epilogue` comes back
   * across them, and blending either one would render a sunrise time-lapse where
   * the story means "somewhere else, long ago".
   *
   * A number is for a scene that *contains* the passage of time. The walk home
   * is the whole afternoon and it is an `overTalk` travel beat, so its sun slides
   * across 25 seconds underneath a conversation about a mad king -- which is the
   * only place in the chapter where a player can watch the light change and read
   * it as the day going, rather than as the sky glitching.
   */
  time?: number
  /** Real seconds to slide to `time`. Omitted or 0 snaps -- see above. */
  timeBlend?: number
  /**
   * Hold this beat until everybody who was sent somewhere has arrived.
   *
   * Only `travel` beats honour it, and only one beat in the story sets it. The
   * frame act dispatches the household on foot (`StoryDirector.sendHome`), and
   * the walks are genuinely slower than a player who knows where they are going
   * — so the beat that ends the act has to wait for the room to fill rather
   * than for the player to sit down.
   *
   * There is no deadlock to worry about: every leg of every walk carries its own
   * give-up (`ERRAND_LEG_SECONDS`), so the set this waits on always empties.
   */
  awaitCast?: boolean
}

export type EncounterId = 'boarChase' | 'boarKill' | 'ambush'

/**
 * The chapter.
 *
 * Reading it top to bottom is reading the chapter — which is the property this
 * file exists to have.
 */
export const CHAPTER_ONE: readonly Beat[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // The frame act — the storyteller's island, sixty years later
  //
  // Played as Arthus. It is a scene about *waiting*: the old man will not start
  // until the household is assembled, so the act is four small errands that add
  // up to everyone being in the room. That is the manuscript's own shape — the
  // chapter opens with a boy who has already sent his sister to fetch his
  // mother and cannot sit still — and it is why none of these beats is a fight.
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'frame-run-in',
    kind: 'travel',
    player: 'arthusBoy',
    objective: 'frameRunIn',
    // Mid-afternoon, an hour or so before the sun goes. The frame act is a
    // household coming in off a working day to eat, and the light through the
    // window has to say so from the opening shot -- a room lit at noon reads as
    // the middle of a morning nobody in it has any business standing around in.
    time: 0.7,
    // Beside the old man's chair, not on it: a nine-year-old arrives at speed
    // and stops short, and a trigger radius centred on the target would have him
    // standing inside his grandfather. The chair is at (−2.8, −3.5) in the
    // doubled room; this is a pace short of it and off to the door side.
    at: { x: HUT.x - 2.4, z: HUT.z - 2.1, radius: 2.6 }
  },
  { id: 'frame-ask', kind: 'dialogue', script: 'frameAsk' },
  {
    id: 'frame-cushion',
    kind: 'interact',
    objective: 'frameCushion',
    // The bed against the west wall. `frame.ts` places it in line with the door
    // for exactly this reason: it has to be findable without a marker. The
    // cushion sits at the bed's local x = −0.52, and the bed carries a quarter
    // turn, so it ends up half a metre toward the door from the bed's own mark.
    at: { x: HUT.x - 5.4, z: HUT.z + 1.7, radius: 2.2 },
    script: 'frameCushion',
    sets: ['cushionFetched']
  },
  {
    id: 'frame-father',
    kind: 'travel',
    objective: 'frameFather',
    // ── Out to the forge, because that is where he is ────────────────────
    //
    // This used to be the chest *inside* the house, and the father was
    // teleported to it the moment the beat began — so the errand read as
    // "walk four metres and your father materialises". He now stays at his
    // forge until somebody fetches him, which is the whole point of the act:
    // it is a scene about a boy assembling a household, and an errand you can
    // complete without leaving the room is not an errand.
    //
    // `FRAME_MARKS.father` is the anvil at (+12.4, +1.5); this stops a couple of
    // paces short of it, on the side he is facing.
    at: { x: HUT.x + 10.6, z: HUT.z + 2.6, radius: 2.6 },
    script: 'frameFather',
    overTalk: true
  },
  {
    id: 'frame-call',
    kind: 'travel',
    objective: 'frameCall',
    // ── And down the road to the other two ───────────────────────────────
    //
    // Also moved out of the house. Shouting from the doorway was what the beat
    // used to be, and it worked only because the mother and the daughter were
    // teleported to within earshot the instant it started — from thirty metres
    // away, in silence, while the player was looking at them.
    //
    // They are at (−12, +32) and (−10.5, +33.5); this mark is a few paces short
    // of both, so the player arrives beside them rather than inside them. It is
    // the longest walk in the act, and it is the one that makes the room feel
    // like it has an outside.
    at: { x: HUT.x - 9.4, z: HUT.z + 29.5, radius: 3.2 },
    script: 'frameCall',
    overTalk: true
  },
  {
    id: 'frame-sit',
    kind: 'travel',
    objective: 'frameSit',
    // A stool at the table. The act ends by sitting down, which is the only
    // thing left to do once there is nobody to wait for — and it is a *sit* now
    // rather than a stand-near: `StoryDirector` seats the household on this beat
    // and the next, from the postures on `FRAME_MARKS`.
    at: { x: HUT.x + 0.5, z: HUT.z + 1.3, radius: 2.0 },
    // ── And it does not end until they are all in ────────────────────────
    //
    // The player walks back from the road while the mother and the daughter
    // walk up it, and whoever is quicker is not fixed: a player who sprints
    // straight back beats them to the table by several seconds. Without this
    // the old man starts his story to a half-empty room and two figures walk in
    // through the door during his opening line.
    //
    // "Nobody left to wait for" is the act's one dramatic condition, so it is a
    // condition on the beat rather than an accident of pacing.
    awaitCast: true
  },
  // The old man starts as the sun touches the rim. He has been waiting for the
  // household and, in the manuscript, for the light -- a story told in daylight
  // is a conversation, and one told at dusk is a story. Ten seconds, over his
  // opening lines, so the room warms while he clears his throat.
  {
    id: 'frame-begin',
    kind: 'dialogue',
    script: 'frameBegin',
    sets: ['storyBegun'],
    time: 0.745,
    timeBlend: 10
  },

  // ── The cut into Arlaan ──────────────────────────────────────────────────
  // Sixty years back and an hour after sunrise. **Snapped, not blended**: this
  // is a cut, and a cut that dissolves its sky is a time-lapse -- it would say
  // "some hours later" over a line that means "long ago, and somewhere else".
  { id: 'prologue', kind: 'dialogue', player: 'athalus', script: 'prologue', time: 0.3 },

  // ── The trap ─────────────────────────────────────────────────────────────
  {
    id: 'trap-brief',
    kind: 'dialogue',
    script: 'trapBriefing',
    objective: 'trapListen'
  },
  {
    id: 'trap-position',
    kind: 'travel',
    objective: 'trapPosition',
    // The west side of the clearing, opposite the gap the boar will come
    // through. Standing here is what puts the sprung net between the player and
    // the animal, which is the read the whole set piece needs.
    at: { x: TRAP_CLEARING.x - 8, z: TRAP_CLEARING.z + 4, radius: 3.2 },
    sets: ['inPosition']
  },
  {
    id: 'trap-cut',
    kind: 'interact',
    objective: 'trapCut',
    at: { x: TRAP_CLEARING.x - 8, z: TRAP_CLEARING.z + 4, radius: 4 },
    script: 'trapSprung'
  },

  // ── The boar ─────────────────────────────────────────────────────────────
  {
    id: 'boar-loose',
    kind: 'dialogue',
    // The trap took the morning. Twelve seconds of sun under the moment it goes
    // wrong, which is also the last unhurried thing that happens for a while.
    time: 0.36,
    timeBlend: 12,
    script: 'boarLoose'
  },
  {
    id: 'boar-chase',
    kind: 'survive',
    encounter: 'boarChase',
    objective: 'reachOak',
    script: 'boarChase',
    // The exit is the oak, not a timer. `Infinity` says so out loud rather than
    // leaving a number nobody can read the intent of.
    seconds: Number.POSITIVE_INFINITY,
    at: { x: TRAP_CLEARING.x + 6.5, z: TRAP_CLEARING.z - 3.5, radius: 3.4 }
  },
  {
    id: 'boar-treed',
    kind: 'dialogue',
    script: 'treed',
    sets: ['upTheTree']
  },
  {
    id: 'boar-kill',
    kind: 'combat',
    encounter: 'boarKill',
    objective: 'shootBoar'
  },
  {
    id: 'boar-down',
    kind: 'dialogue',
    script: 'boarDown'
  },
  {
    id: 'recover-kit',
    kind: 'interact',
    objective: 'recoverKit',
    // Where Athalus dropped them, running. Deliberately *behind* the player's
    // path to the oak, so recovering them is a walk back across the arena they
    // just survived — which is the moment the fight is over.
    at: { x: TRAP_CLEARING.x - 11, z: TRAP_CLEARING.z + 9, radius: 3.5 },
    sets: ['armed']
  },
  {
    id: 'haul',
    kind: 'dialogue',
    // Butchering it and lashing it to a pole is most of what is left of the
    // morning. Near noon by the time they pick it up.
    time: 0.47,
    timeBlend: 14,
    script: 'hauling'
  },

  // ── The walk home ────────────────────────────────────────────────────────
  {
    id: 'walk-to-river',
    kind: 'travel',
    objective: 'walkHome',
    at: { x: BRIDGE.x - 14, z: BRIDGE.z + 4, radius: 6 },
    script: 'kingTalk',
    overTalk: true,
    // The chapter's one honest time-lapse. The book covers this leg in two
    // paragraphs of argument about the King and the map covers it in 75 m, so
    // the sun is what carries the "hours" the text claims -- 25 seconds of it,
    // under a conversation, which is long enough to be felt and too slow to be
    // caught. See the note on `timeBlend`.
    time: 0.56,
    timeBlend: 25
  },
  {
    id: 'cross-bridge',
    kind: 'travel',
    objective: 'crossBridge',
    at: { x: BRIDGE.x + 12, z: BRIDGE.z - 1, radius: 5 },
    script: 'bridge',
    overTalk: true
  },

  // ── The ambush ───────────────────────────────────────────────────────────
  {
    id: 'rest',
    kind: 'travel',
    objective: 'rest',
    at: { x: AMBUSH.x, z: AMBUSH.z, radius: 4.5 },
    // Late afternoon. They stop because they have been walking all day, and the
    // light is the only thing on screen that can say that.
    time: 0.63,
    timeBlend: 12
  },
  {
    id: 'rest-talk',
    kind: 'dialogue',
    script: 'restStop'
  },
  {
    id: 'ambush',
    kind: 'combat',
    encounter: 'ambush',
    objective: 'fightBandits',
    // Six seconds, and only 0.03 of a day -- the sun barely moves. What it buys
    // is the shadows lengthening across the meadow as the treeline empties, and
    // the fight starting a little darker than the rest it interrupted. A bigger
    // jump here would read as the sky reacting to the ambush.
    time: 0.66,
    timeBlend: 6
  },
  {
    id: 'ambush-over',
    kind: 'dialogue',
    script: 'banditsBroken',
    sets: ['ambushSurvived']
  },

  // ── The gate ─────────────────────────────────────────────────────────────
  {
    id: 'run-to-gate',
    kind: 'travel',
    objective: 'reachGate',
    at: { x: WEST_GATE.x - 6, z: WEST_GATE.z, radius: 5 },
    time: 0.7,
    timeBlend: 8
  },
  {
    id: 'theodor',
    kind: 'dialogue',
    script: 'theodor'
  },

  // ── Nimmerschein ─────────────────────────────────────────────────────────
  {
    id: 'to-treff',
    kind: 'travel',
    objective: 'toTreff',
    at: { x: TREFF.x, z: TREFF.z + 3, radius: 4 },
    // "They agree to roast it that evening." The sun is on the rim as they carry
    // the boar in, which is the one line of the manuscript this file can render
    // literally.
    time: 0.745,
    timeBlend: 10
  },
  {
    id: 'treff-talk',
    kind: 'dialogue',
    script: 'treff',
    sets: ['boarDelivered']
  },
  {
    id: 'to-home',
    kind: 'travel',
    objective: 'goHome',
    at: { x: SMITHY.x - 6.5, z: SMITHY.z - 1, radius: 3.5 },
    // Dusk. Nidane is in the doorway because it is late and they are not back,
    // and a mother waiting at noon is a mother with nothing to worry about.
    time: 0.785,
    timeBlend: 8
  },
  {
    id: 'home',
    kind: 'dialogue',
    script: 'home'
  },
  /**
   * And back to the fireside.
   *
   * `player: 'arthusBoy'` is what closes the bracket: the chapter ends where it
   * started, in the same room, as the same boy, with the wine three quarters
   * down and a question about whether the piglet was as good as he imagines.
   */
  {
    id: 'epilogue',
    kind: 'dialogue',
    player: 'arthusBoy',
    script: 'epilogue',
    sets: ['chapterComplete'],
    // Snapped, like `prologue`, and for the same reason -- but this one also does
    // a piece of storytelling the text cannot. The frame act left the sun on the
    // rim at 0.745 and comes back to 0.83: full dark, the fire the only light in
    // the room. The whole evening went while he talked, and the player is told
    // that by the window rather than by a line.
    time: 0.83
  }
]

/** Beat ids, so the director's switch cannot drift from the list above. */
export type BeatId = (typeof CHAPTER_ONE)[number]['id']

/**
 * Index of a beat **within Chapter 1**.
 *
 * The director does not use this — it walks the whole story through
 * `chapters.ts::beatIndex`, which searches every chapter. Kept because three
 * suites address Chapter 1's beats directly and reading a chapter's own file
 * should not require knowing how many chapters there are.
 */
export const chapterOneBeatIndex = (id: string): number => CHAPTER_ONE.findIndex(beat => beat.id === id)

/**
 * Where the chapter starts the player, and facing which way.
 *
 * The trap clearing, looking east down the gap the boar will come through. The
 * first thing on screen is therefore the arena and the way into it, which is the
 * whole of what an opening shot has to establish.
 */
export const CHAPTER_ONE_SPAWN = {
  x: TRAP_CLEARING.x - 13,
  z: TRAP_CLEARING.z + 7,
  yaw: Math.PI * 0.42
}

/**
 * Where the *chapter* starts: outside the hut door, as a nine-year-old, at a
 * run.
 *
 * Down the road rather than at the threshold, so the first thing the player does
 * is cover ground and the first thing they see is the house they are running
 * into. Facing north, up the road, which is also the direction the mother and
 * Lena will come from later — the opening shot establishes the one bit of
 * geography the act uses.
 */
export const FRAME_SPAWN = {
  x: HUT_DOOR.x + 0.6,
  z: HUT_DOOR.z + 9.5,
  yaw: Math.PI
}
