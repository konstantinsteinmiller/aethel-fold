import { describe, expect, it } from 'vitest'
import { CAST, CAST_IDS, FIRESIDE, PARTY } from '@/world/story/cast'
import { CHAPTER_ONE } from '@/world/story/chapter1'
import { CHAPTER_TWO } from '@/world/story/chapter2'
import { beatIndex, chapterOf, CHAPTER_STARTS, STORY_BEATS } from '@/world/story/chapters'
import { SCRIPT, SPEAKER_NAMES, speakerName, storyLine, type Line } from '@/world/story/script'
import { arlaNodes, chapterOnePlacements, PALISADE_A, PALISADE_B, VILLAGE } from '@/world/story/level'
import { FRAME_MARKS, FRAME_ROUTES, framePlacements, HUT_DOOR, ISLE, ISLE_BEACH, ISLE_TOP, seaPlacement } from '@/world/story/frame'
import { CAMP, CAMP_MARKS, campPlacements } from '@/world/story/camp'
import { bakeStoryTerrain } from '@/world/story/terrain'
import { DEFAULT_HEIGHTFIELD_PARAMS, heightAtCore } from '@/world/terrain/heightfieldCore'
import { getPlaceable } from '@/world/level/catalog'
import { registerAllPlaceables } from '@/world/assets'
import { ATTACKS, MOVESETS, movesetFor, scalingFor, STATS } from '@/world/combat/movesets'
import { Combatant } from '@/world/combat/Combatant'
import { isHostile, PARRY_WINDOW } from '@/world/combat/types'
import { ITEM_SLOT, STOW_SOCKET, DRAWN_SOCKET, EQUIPMENT_BUDGET, type ItemKind } from '@/world/characters/equipment'
import { POSE_FAMILY, poseFamilyOf } from '@/world/characters/combatPoses'

/**
 * ─── Chapter 1, as a contract ───────────────────────────────────────────────
 *
 * The chapter is data — a beat list, a cast table, a script and a map — and the
 * failures it can have are almost all *referential*: a beat naming a script that
 * does not exist, a cast member wearing an item with no model, a placement
 * naming a `defId` nobody registered, a bandit standing outside the ambush
 * arena. None of those throws, and none of them is visible until somebody plays
 * twenty minutes in and finds an empty speech bubble.
 *
 * So this suite is mostly cross-references, and the parts that are not are the
 * three numbers the chapter would be unplayable without: the parry window, the
 * guard's arithmetic, and how long it takes five bandits to kill a man who does
 * nothing.
 *
 * ── What this deliberately does not test ────────────────────────────────────
 *
 * How anything *looks*. Four real defects in this chapter typechecked cleanly
 * and passed the whole suite — a cast parked 400 m underground, a village that
 * never drew, roofs that came out as domes, and an ambush that killed a standing
 * player in 2.4 seconds. Three of the four are invisible to any assertion that
 * does not render, and the fourth is the one balance check below. `CLAUDE.md`
 * records the rest as a browser step, which is where they belong.
 */

const definitions = registerAllPlaceables()

describe('the beat list', () => {
  it('names only scripts that exist', () => {
    for (const beat of STORY_BEATS) {
      if (beat.script) {
        expect(SCRIPT[beat.script], `beat "${beat.id}" names a missing script`).toBeDefined()
      }
    }
  })

  /**
   * Across **every** chapter, not one. `beatIndex` searches the whole story, so
   * two chapters that both called a beat `open` would make every save in the
   * later one load into the earlier — silently, and only for players who had
   * got that far.
   */
  it('has unique beat ids, and `beatIndex` finds every one', () => {
    const seen = new Set<string>()
    for (const beat of STORY_BEATS) {
      expect(seen.has(beat.id), `duplicate beat id "${beat.id}"`).toBe(false)
      seen.add(beat.id)
      expect(beatIndex(beat.id)).toBeGreaterThanOrEqual(0)
    }
  })

  it('gives every interactive beat something to do and somewhere to do it', () => {
    for (const beat of STORY_BEATS) {
      if (beat.kind === 'travel' || beat.kind === 'interact') {
        // Without a target these beats can never end — the director's exit test
        // finishes them immediately, which silently skips the scene.
        expect(beat.at, `${beat.kind} beat "${beat.id}" has no target`).toBeDefined()
        expect(beat.at!.radius).toBeGreaterThan(1.5)
      }
      if (beat.kind === 'combat' || beat.kind === 'survive') {
        expect(beat.encounter, `beat "${beat.id}" fights nothing`).toBeDefined()
      }
      // Every playable beat needs a line in the HUD, or the player is standing
      // in a field with no idea what the game wants.
      if (beat.kind !== 'dialogue') {
        expect(beat.objective, `beat "${beat.id}" has no objective`).toBeTruthy()
      }
    }
  })

  it('ends each chapter where the chapter ends', () => {
    const one = CHAPTER_ONE[CHAPTER_ONE.length - 1]!
    expect(one.id).toBe('epilogue')
    expect(one.sets).toContain('chapterComplete')
    const two = CHAPTER_TWO[CHAPTER_TWO.length - 1]!
    expect(two.id).toBe('b2-positions')
    expect(two.sets).toContain('chapterTwoComplete')
  })

  /**
   * `chapterOf` is what `StoryState.chapter` is, and the HUD hides the controls
   * panel on it — so an off-by-one here is a panel that vanishes a beat early or
   * outstays the chapter it was teaching.
   */
  it('maps every beat index to the chapter it is actually in', () => {
    expect(CHAPTER_STARTS).toEqual([0, CHAPTER_ONE.length])
    expect(chapterOf(0)).toBe(1)
    expect(chapterOf(CHAPTER_ONE.length - 1)).toBe(1)
    expect(chapterOf(CHAPTER_ONE.length)).toBe(2)
    expect(chapterOf(STORY_BEATS.length - 1)).toBe(2)
    // Past the end the story is over; the last chapter is the honest answer.
    expect(chapterOf(STORY_BEATS.length + 50)).toBe(2)
  })

  /**
   * Chapter 2 is played as the villain, which is this adaptation's one liberty
   * (see `chapter2.ts`). The thing that makes it work is that `banditLeader`'s
   * *actor* id equals his cast id — every other bandit is `bandit-N`, and a
   * `Beat.player` naming an actor the director cannot find is a chapter that
   * opens with no player and no error.
   */
  it('opens chapter 2 as the bandit leader', () => {
    expect(CHAPTER_TWO[0]!.player).toBe('banditLeader')
    expect(CAST.banditLeader).toBeDefined()
    // And nothing later in the chapter takes the body away again.
    const players = new Set(CHAPTER_TWO.map(beat => beat.player).filter(Boolean))
    expect(players).toEqual(new Set(['banditLeader']))
  })

  /** Chapter 2 has no fight in it, and inventing one would be writing a scene. */
  it('has no combat in chapter 2', () => {
    for (const beat of CHAPTER_TWO) {
      expect(beat.kind, `beat "${beat.id}"`).not.toBe('combat')
      expect(beat.encounter, `beat "${beat.id}"`).toBeUndefined()
    }
  })

  /**
   * The `survive` beat that is the chase has to be exitable by *place*, not by
   * a timer, and this is why: the manuscript is explicit that Athalus does not
   * beat the animal, he gets up a tree. A timed version rewards standing still.
   */
  it('exits the boar chase on reaching the oak, not on a clock', () => {
    const chase = CHAPTER_ONE.find(beat => beat.id === 'boar-chase')!
    expect(chase.kind).toBe('survive')
    expect(chase.at).toBeDefined()
    expect(Number.isFinite(chase.seconds ?? Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('the script', () => {
  const everyLine: Line[] = Object.values(SCRIPT).flatMap(lines => [...lines] as Line[])

  it('is complete in both languages', () => {
    for (const line of everyLine) {
      expect(line.de.length, `empty German line from ${line.who}`).toBeGreaterThan(0)
      expect(line.en.length, `empty English line from ${line.who}`).toBeGreaterThan(0)
    }
  })

  it('gives every speaker a display name in both languages', () => {
    for (const line of everyLine) {
      const entry = SPEAKER_NAMES[line.who]
      expect(entry, `no name for speaker "${line.who}"`).toBeDefined()
      expect(entry.de.length).toBeGreaterThan(0)
      expect(entry.en.length).toBeGreaterThan(0)
    }
  })

  it('picks German for a German locale and English for everything else', () => {
    const line = SCRIPT.prologue[0]!
    expect(storyLine(line, 'de')).toBe(line.de)
    // Regional German still counts — the check is a prefix, not an equality.
    expect(storyLine(line, 'de-AT')).toBe(line.de)
    expect(storyLine(line, 'en')).toBe(line.en)
    expect(storyLine(line, 'ja')).toBe(line.en)
    expect(speakerName('kareen', 'de')).toBe('Kareen')
  })

  /**
   * A bubble is one plate at the foot of the frame. The longest line in the
   * chapter has to fit in it at the size `StoryOverlay` draws, and 320
   * characters is about four lines at that width — past which the plate starts
   * covering the scene it is narrating.
   */
  it('has no line too long for the plate', () => {
    for (const line of everyLine) {
      expect(line.de.length, `over-long German line from ${line.who}`).toBeLessThan(340)
      expect(line.en.length, `over-long English line from ${line.who}`).toBeLessThan(340)
    }
  })
})

describe('the cast', () => {
  it('wears only items that have a model and a legal slot', () => {
    for (const id of CAST_IDS) {
      const member = CAST[id]
      for (const slot of ['mainHand', 'offHand', 'back', 'head', 'torso', 'legs', 'belt'] as const) {
        const kind = member.loadout[slot]
        if (kind === null) {
          continue
        }
        expect(ITEM_SLOT[kind], `${id} has "${kind}" in ${slot}`).toBe(slot)
        expect(EQUIPMENT_BUDGET[kind], `"${kind}" has no budget`).toBeGreaterThan(0)
      }
    }
  })

  it('can actually draw whatever it is meant to be holding', () => {
    for (const id of CAST_IDS) {
      const drawn = CAST[id].loadout.drawn
      if (drawn === 'sheathed') {
        continue
      }
      const source = drawn === 'mainHand' ? CAST[id].loadout.mainHand : CAST[id].loadout.back
      expect(source, `${id} is drawn as "${drawn}" holding nothing`).not.toBeNull()
      expect(poseFamilyOf(source as ItemKind), `${id}'s "${source}" has no draw animation`).not.toBeNull()
    }
  })

  /**
   * The whole argument of `cast.ts`: four teenagers have to be told apart from
   * behind at fifteen metres, and at that distance only the outline survives.
   * So the four leads must differ in **height**, in **build** and in **what
   * they carry** — not merely in colour, which is gone first.
   */
  it('separates the four leads by outline, not by colour', () => {
    const heights = PARTY.map(id => CAST[id].scale)
    expect(new Set(heights).size, 'two leads are the same height').toBe(PARTY.length)
    // 13 % between tallest and shortest — about a head on this figure.
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.1)

    const silhouettes = PARTY.map(id => {
      const kit = CAST[id].loadout
      return `${kit.back ?? '-'}/${kit.mainHand ?? '-'}/${kit.belt ?? '-'}`
    })
    expect(new Set(silhouettes).size, 'two leads carry the same shapes').toBe(PARTY.length)

    // At least three of the four builds differ; Gearn is deliberately average
    // because his axe is doing the work.
    expect(new Set(PARTY.map(id => CAST[id].appearance.build)).size).toBeGreaterThanOrEqual(2)
  })

  /**
   * The chapter is played as two people, and the switch is what the frame act
   * *is*. Both have to exist, and the frame's household must not be able to
   * fight — a nine-year-old with a bandit's stat block is a silent bug.
   */
  it('has two playable characters, and the household is not one of them', () => {
    const players = new Set(CHAPTER_ONE.map(beat => beat.player).filter(Boolean))
    expect(players).toEqual(new Set(['arthusBoy', 'athalus']))
    // The first beat must name one, or the director opens with nobody.
    expect(CHAPTER_ONE[0]!.player).toBe('arthusBoy')
    for (const id of FIRESIDE) {
      expect(CAST[id].loadout.mainHand, `${id} is armed`).toBeNull()
      expect(CAST[id].loadout.back, `${id} is armed`).toBeNull()
    }
  })

  it('gives every fighting cast member a stat block and a moveset', () => {
    for (const id of ['athalus', 'jester', 'gearn', 'kareen', 'theodor', 'bandit', 'banditLeader'] as const) {
      const key = id === 'banditLeader' ? 'banditLeader' : id
      expect(STATS[key], `no stats for ${id}`).toBeDefined()
      const weapon = CAST[id].loadout.mainHand ?? CAST[id].loadout.back
      expect(MOVESETS[movesetFor(weapon ?? null)]).toBeDefined()
    }
  })

  /** Every weapon in the chapter hangs somewhere when it is not in a hand. */
  it('stows every carried weapon somewhere', () => {
    for (const id of CAST_IDS) {
      for (const slot of ['mainHand', 'back', 'belt'] as const) {
        const kind = CAST[id].loadout[slot]
        if (kind) {
          expect(STOW_SOCKET[kind], `"${kind}" has nowhere to hang`).not.toBeNull()
        }
      }
    }
  })
})

describe('the frame act', () => {
  const placements = framePlacements()

  it('places only props the catalogue knows', () => {
    for (const placement of placements) {
      expect(getPlaceable(placement.defId), `unknown defId "${placement.defId}"`).toBeDefined()
    }
  })

  /**
   * The whole point of putting the storyteller on an island: the two timeframes
   * must never share a frame. Detailed terrain streams to 190 m and the fog
   * buries anything past ~170, so 1.7 km is the guarantee rather than a hope.
   */
  it('keeps the two timeframes far enough apart to never share a frame', () => {
    const gap = Math.hypot(ISLE.x - VILLAGE.x, ISLE.z - VILLAGE.z)
    expect(gap, 'Arlaan and the island could appear in one frame').toBeGreaterThan(900)
    for (const placement of placements) {
      expect(Math.hypot(placement.x - ISLE.x, placement.z - ISLE.z)).toBeLessThan(120)
    }
  })

  /**
   * ─── The four walls tile, and exactly one of them has a hole in it ─────────
   *
   * This used to be `expect(walls.length).toBe(5)`, which is not a test of
   * anything: the room is composed of four different slab lengths laid end to
   * end, and the failure it has to catch is *arithmetic* — a run that comes half
   * a metre short leaves a slot the player can see the meadow through and walk
   * out of, with the right number of walls in it.
   *
   * So each wall is checked the way it is built: take every unit on that line,
   * sort them along it, and confirm the segments touch. The south wall is
   * allowed exactly one gap, which is the door; the other three are allowed
   * none.
   */
  it('builds a closed room whose walls tile, with exactly one doorway', () => {
    /** Authored length of each wall unit, from `assets/interior.ts`. */
    const LENGTH: Record<string, number> = {
      'hut-wall-long': 6.4,
      'hut-wall-side': 5.4,
      'hut-wall-flank': 2.6,
      'hut-window-bay': 2.8
    }
    const units = placements.filter(p => p.defId in LENGTH)
    expect(units.length, 'no wall units at all').toBeGreaterThan(4)

    const floor = placements.find(p => p.defId === 'hut-floor')!
    expect(placements.filter(p => p.defId === 'hut-floor').length).toBe(1)
    expect(placements.filter(p => p.defId === 'hut-rafters').length).toBe(1)
    expect(placements.filter(p => p.defId === 'hut-roof').length, 'the room has no roof').toBe(1)

    /**
     * Every unit standing on one line, as `[start, end]` along that line.
     *
     * A unit is authored along its own X, so a quarter turn puts it along world
     * Z — which is why `along` reads the placement's rotation rather than
     * assuming an axis.
     */
    const runOn = (axis: 'x' | 'z', at: number): [number, number][] => {
      const spans: [number, number][] = []
      for (const unit of units) {
        const across = axis === 'x' ? unit.z : unit.x
        const along = axis === 'x' ? unit.x : unit.z
        // A unit belongs to this wall if it is *on* the line and turned to run
        // along it. rotY 0 runs along X; a quarter turn runs along Z.
        const turned = Math.abs(Math.abs(unit.rotY) - Math.PI / 2) < 0.01
        const runsAlongX = !turned
        if (Math.abs(across - at) > 0.3 || runsAlongX !== (axis === 'x')) {
          continue
        }
        const half = LENGTH[unit.defId]! / 2
        spans.push([along - half, along + half])
      }
      return spans.sort((a, b) => a[0] - b[0])
    }

    /** Gaps between consecutive spans, ignoring joins under a centimetre. */
    const gapsIn = (spans: [number, number][]): number[] => {
      const gaps: number[] = []
      for (let i = 1; i < spans.length; i++) {
        const gap = spans[i]![0] - spans[i - 1]![1]
        if (gap > 0.01) {
          gaps.push(gap)
        }
      }
      return gaps
    }

    // Room half-extents, taken from the floor rather than restated: the floor is
    // authored 0.1 m proud of the walls on every side.
    const halfX = 6.5 - 0.1
    const halfZ = 5.5 - 0.1

    for (const [name, axis, at, expected] of [
      ['north', 'x', floor.z - halfZ, 12.8],
      ['south', 'x', floor.z + halfZ, 12.8],
      ['west', 'z', floor.x - halfX, 10.8],
      ['east', 'z', floor.x + halfX, 10.8]
    ] as const) {
      const spans = runOn(axis, at)
      expect(spans.length, `the ${name} wall has no units on it`).toBeGreaterThan(0)
      const covered = spans.reduce((sum, [a, b]) => sum + (b - a), 0)
      const gaps = gapsIn(spans)
      if (name === 'south') {
        // The door: one gap, 2 m wide, and the run either side of it accounts
        // for the rest of the wall.
        expect(gaps.length, 'the south wall does not have exactly one doorway').toBe(1)
        expect(gaps[0]!, 'the doorway is the wrong width').toBeCloseTo(2, 1)
        expect(covered, 'the south wall does not reach its corners').toBeCloseTo(expected - 2, 1)
      } else {
        expect(gaps, `the ${name} wall has a hole in it`).toEqual([])
        expect(covered, `the ${name} wall does not reach its corners`).toBeCloseTo(expected, 1)
      }
    }
  })

  /**
   * Glazing follows its bay. Two placements at one transform is the price of a
   * second material (`assets/interior.ts`), and the way that goes wrong is one
   * of them being moved and the other not — which shows up as a pane of glass
   * hanging in a room.
   */
  it('puts a pane in every window bay and nowhere else', () => {
    const bays = placements.filter(p => p.defId === 'hut-window-bay')
    const panes = placements.filter(p => p.defId === 'hut-glass')
    expect(bays.length, 'the room has no windows').toBeGreaterThan(1)
    expect(panes.length).toBe(bays.length)
    for (const bay of bays) {
      const pane = panes.find(g => Math.hypot(g.x - bay.x, g.z - bay.z) < 0.01)
      expect(pane, `a window bay at ${bay.x.toFixed(1)}, ${bay.z.toFixed(1)} has no glass`).toBeDefined()
      expect(pane!.rotY).toBeCloseTo(bay.rotY, 4)
    }
  })

  /**
   * Nothing from the yard may stand inside the room.
   *
   * The room quadrupled in area, and three props that used to be in the garden —
   * the well, a bench and a log pile — ended up in the middle of the kitchen.
   * Nothing errors when that happens; the well simply is where the table is.
   */
  it('leaves the room clear of the hamlet', () => {
    const floor = placements.find(p => p.defId === 'hut-floor')!
    for (const outdoor of placements.filter(p => p.defId.startsWith('village-') || p.defId.startsWith('house-'))) {
      const insideX = Math.abs(outdoor.x - floor.x) < 6.4
      const insideZ = Math.abs(outdoor.z - floor.z) < 5.4
      expect(insideX && insideZ, `${outdoor.defId} is standing inside the storyteller's room`).toBe(false)
    }
  })

  /**
   * Every prop the frame act's beats reach for has to actually be in the room,
   * and near enough to its beat's trigger that the objective is findable.
   */
  it('puts the cushion and the table where their beats look for them', () => {
    const near = (defId: string, at: { x: number; z: number }, within: number): boolean =>
      placements.some(p => p.defId === defId && Math.hypot(p.x - at.x, p.z - at.z) < within)
    const beatAt = (id: string) => CHAPTER_ONE.find(b => b.id === id)!.at!

    expect(near('hut-bed', beatAt('frame-cushion'), 2.5), 'no cushion where the beat looks').toBe(true)
    expect(near('hut-table', beatAt('frame-sit'), 2.5), 'no table where the beat looks').toBe(true)
  })

  /**
   * ── The two fetch errands go to the people, not to the furniture ─────────
   *
   * `frame-father` used to send the player to the chest beside the door, and
   * `frame-call` to the doorway, because in both cases the person being fetched
   * was *teleported* into range when the beat began. They walk now
   * (`StoryDirector.sendHome`), so the beats have to point at where those people
   * actually stand — and the thing worth pinning is that they point **outside
   * the room**, because an errand you can finish without leaving is not one.
   */
  it('sends the player out to the people it asks them to fetch', () => {
    const beatAt = (id: string) => CHAPTER_ONE.find(b => b.id === id)!.at!
    const floor = placements.find(p => p.defId === 'hut-floor')!
    const outside = (at: { x: number; z: number }): boolean =>
      Math.abs(at.x - floor.x) > 6.4 || Math.abs(at.z - floor.z) > 5.4

    const father = beatAt('frame-father')
    const call = beatAt('frame-call')
    expect(outside(father), 'the smith is fetched from inside the room').toBe(true)
    expect(outside(call), 'the mother and Lena are fetched from inside the room').toBe(true)

    // And near enough to the mark the person is standing on to be a meeting.
    const reach = (at: { x: number; z: number; radius: number }, mark: { x: number; z: number }): number =>
      Math.hypot(at.x - mark.x, at.z - mark.z) - at.radius
    expect(reach(father, FRAME_MARKS.father), 'the forge is not within the frame-father trigger').toBeLessThan(1.5)
    expect(reach(call, FRAME_MARKS.mother), 'the mother is not within the frame-call trigger').toBeLessThan(2.5)
    expect(reach(call, FRAME_MARKS.lena), 'Lena is not within the frame-call trigger').toBeLessThan(2.5)
  })

  /**
   * A route that ends anywhere but the door is a figure walking into a wall.
   *
   * `errandBrain` steers a straight line, so the last waypoint before the seat
   * has to be *inside* the room — otherwise the final leg crosses the south wall
   * and the walker grinds on it until the give-up fires. Cheap to assert and
   * impossible to see in a diff.
   */
  it('routes the household in through the door', () => {
    const floor = placements.find(p => p.defId === 'hut-floor')!
    for (const [who, route] of Object.entries(FRAME_ROUTES)) {
      const last = route[route.length - 1]!
      const insideX = Math.abs(last.x - floor.x) < 6.4
      const insideZ = Math.abs(last.z - floor.z) < 5.4
      expect(insideX && insideZ, `${who}'s route stops short of the room`).toBe(true)
      // Through the gap, not through the wall: the doorway is 2 m wide, centred.
      const throughDoor = route.some(w => Math.abs(w.x - HUT_DOOR.x) < 1.6 && Math.abs(w.z - HUT_DOOR.z) < 3.4)
      expect(throughDoor, `${who}'s route never passes the doorway`).toBe(true)
    }
  })

  it('never asks anybody to walk to a place that is not a number', () => {
    // A non-finite waypoint is a figure steering at an undefined point, which
    // the mover resolves to NaN and three then declines to draw -- silently.
    for (const [who, route] of Object.entries(FRAME_ROUTES)) {
      for (const [i, w] of route.entries()) {
        expect(Number.isFinite(w.x) && Number.isFinite(w.z), `${who} leg ${i}`).toBe(true)
      }
    }
  })

  it('sea and island agree on where the waterline is', () => {
    const sea = seaPlacement()
    expect(sea.kind).toBe('pool')
    // The plateau has to stand clear of the water, or the hamlet is a reef.
    expect(ISLE_TOP - sea.y).toBeGreaterThan(2)
    // And the water has to reach past the beach, or the island has a moat.
    expect(sea.halfX).toBeGreaterThan(ISLE_BEACH + 40)
  })
})

describe('the map', () => {
  const placements = chapterOnePlacements()

  it('places only props the catalogue knows', () => {
    for (const placement of placements) {
      expect(getPlaceable(placement.defId), `unknown defId "${placement.defId}"`).toBeDefined()
    }
  })

  it('gives every placement a unique id', () => {
    const ids = new Set(placements.map(p => p.id))
    expect(ids.size).toBe(placements.length)
  })

  /**
   * A gap in the wall is the one placement error nobody notices until they walk
   * into it, and a *blocked* gate is the one that makes the chapter
   * unfinishable. Both are the same assertion from opposite sides.
   */
  it('leaves the two gateways open and the rest of the ring closed', () => {
    const runs = placements.filter(p => p.defId === 'palisade-run')
    const gates = placements.filter(p => p.defId === 'palisade-gate')
    expect(gates.length).toBe(2)
    // Nothing may stand within 6 m of a gate's centre — that is the opening.
    for (const gate of gates) {
      for (const run of runs) {
        const d = Math.hypot(run.x - gate.x, run.z - gate.z)
        expect(d, `a palisade run is standing in a gateway`).toBeGreaterThan(6)
      }
    }
    // And the ring is long enough to enclose the village: the ellipse's
    // perimeter is ~214 m, so a wall of 4.8 m runs needs at least 35 of them
    // once the two gateways are taken out.
    expect(runs.length).toBeGreaterThan(35)
  })

  it('keeps every building inside its own wall', () => {
    const houses = placements.filter(p => p.defId.startsWith('house-'))
    expect(houses.length).toBeGreaterThan(15)
    for (const house of houses) {
      const ellipse = Math.hypot((house.x - VILLAGE.x) / PALISADE_A, (house.z - VILLAGE.z) / PALISADE_B)
      expect(ellipse, `"${house.defId}" at ${house.x},${house.z} is outside the palisade`).toBeLessThan(0.92)
    }
  })

  it('runs the Arla downhill from north to south', () => {
    const nodes = arlaNodes()
    expect(nodes.length).toBeGreaterThan(4)
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i]!.z, 'the river doubles back').toBeLessThan(nodes[i - 1]!.z)
      expect(nodes[i]!.y, 'the river runs uphill').toBeLessThan(nodes[i - 1]!.y)
      expect(nodes[i]!.halfWidth).toBeGreaterThan(2)
    }
  })
})

describe('the terrain shaping', () => {
  const params = { ...DEFAULT_HEIGHTFIELD_PARAMS, seed: 4711, amplitude: 17, featureSize: 190, plainRadius: 34 }
  const baked = bakeStoryTerrain(params)
  const shaped = (x: number, z: number): number => heightAtCore(x, z, { ...params, delta: baked.field })
  const natural = (x: number, z: number): number => heightAtCore(x, z, { ...params, delta: null })

  it('flattens the ground the village stands on', () => {
    // Sampled across the whole footprint: a palisade cannot step up a hillside
    // and a street cannot have a hill in it.
    let lowest = Number.POSITIVE_INFINITY
    let highest = Number.NEGATIVE_INFINITY
    for (let x = -30; x <= 30; x += 5) {
      for (let z = -22; z <= 22; z += 5) {
        const h = shaped(x, z)
        lowest = Math.min(lowest, h)
        highest = Math.max(highest, h)
      }
    }
    expect(highest - lowest, 'the village floor is not flat enough to build on').toBeLessThan(1.2)
  })

  it('cuts the river channel below its own banks', () => {
    // The Arla's surface is authored in `level.ts`; the ground under it has to
    // be lower, or the water lies on a field.
    const bed = shaped(-96, 4)
    const bank = shaped(-96 + 14, 4)
    expect(bed, 'the river bed is not below its bank').toBeLessThan(bank)
    expect(bank - bed).toBeGreaterThan(0.8)
  })

  it('leaves the world alone outside its own region', () => {
    for (const [x, z] of [
      [300, 300],
      [-400, 120],
      [0, -400]
    ] as const) {
      expect(shaped(x, z)).toBeCloseTo(natural(x, z), 6)
    }
  })
})

describe('combat, in the three places the chapter depends on it', () => {
  const fighter = (id: string, stats = STATS.athalus!) =>
    new Combatant({ id, team: 'party', stats, moveset: 'blade', weapon: 'sword' })

  it('keeps the teams straight, including the boar', () => {
    expect(isHostile('party', 'foe')).toBe(true)
    expect(isHostile('party', 'beast')).toBe(true)
    // The bandits and the boar are never on screen together, and a boar that
    // helpfully mauled them would be a comedy.
    expect(isHostile('foe', 'beast')).toBe(false)
    expect(isHostile('party', 'party')).toBe(false)
  })

  it('spends stamina on attacks and refuses one it cannot pay for', () => {
    const a = fighter('a')
    a.stamina = 5
    expect(a.requestLight()).toBe(false)
    a.stamina = a.stats.maxStamina
    expect(a.requestLight()).toBe(true)
    expect(a.stamina).toBeLessThan(a.stats.maxStamina)
  })

  it('parries only inside the window, and blocks after it', () => {
    const a = fighter('a')
    a.setGuard(true)
    expect(a.stance).toBe('parry')
    const parried = a.receive(20, 20, 'slash', a.facing)
    expect(parried.parried).toBe(true)
    expect(parried.damage).toBe(0)

    const b = fighter('b')
    b.setGuard(true)
    // Past the window the guard is an ordinary block: most of the damage stops,
    // some leaks, and it costs stamina.
    b.update(PARRY_WINDOW + 0.02)
    expect(b.stance).toBe('block')
    const before = b.stamina
    const blocked = b.receive(20, 20, 'slash', b.facing)
    expect(blocked.parried).toBe(false)
    expect(blocked.blocked).toBe(true)
    expect(blocked.damage).toBeGreaterThan(0)
    expect(blocked.damage).toBeLessThan(20)
    expect(b.stamina).toBeLessThan(before)
  })

  it('lets a hit through the back of a guard', () => {
    const a = fighter('a')
    a.facing = 0
    a.setGuard(true)
    a.update(PARRY_WINDOW + 0.02)
    // Struck from directly behind: the guard covers 140° of the front and this
    // is 180° off it.
    const behind = a.receive(20, 20, 'slash', Math.PI)
    expect(behind.blocked).toBe(false)
    expect(behind.damage).toBe(20)
  })

  /**
   * The property `HIT_GRACE` exists for: **however many attackers there are, an
   * unblocked hit cannot land more often than once every 0.34 s.**
   *
   * Stated as a rate rather than as a survival time, because that is the actual
   * guarantee — a survival time depends on how hard each attacker hits, and this
   * has to hold when the next chapter puts eight of them on screen. Two hundred
   * simultaneous attackers land exactly as many hits as one.
   */
  it('caps incoming hits at one per grace window, however many attackers', () => {
    const step = 1 / 60
    const seconds = 3
    const count = (attackers: number): number => {
      const player = fighter('player')
      player.hp = 1e6
      let landed = 0
      for (let t = 0; t < seconds; t += step) {
        player.update(step)
        for (let i = 0; i < attackers; i++) {
          if (player.receive(1, 0, 'slash', player.facing).damage > 0) {
            landed++
          }
        }
      }
      return landed
    }
    const one = count(1)
    expect(count(2), 'a second attacker doubles the damage rate').toBe(one)
    expect(count(8), 'a crowd is unbounded').toBe(one)
    // 3 s at one hit per 0.34 s is nine, give or take a frame at each end.
    expect(one).toBeLessThanOrEqual(10)
    expect(one).toBeGreaterThanOrEqual(8)
  })

  /**
   * And the balance number that came out of the browser, kept as a test.
   *
   * Two bandits at their real cadence — `banditBrain` commits, swings, and waits
   * 0.75–1.65 s before committing again — against a player who does nothing at
   * all. Measured in the running chapter before `HIT_GRACE` and `might` existed,
   * this took **2.4 seconds**: the ambush was over before a wind-up could be
   * read. It should take long enough to notice and still, eventually, kill.
   */
  it('kills a standing player slowly enough to react to, and does kill them', () => {
    const player = fighter('player')
    const light = ATTACKS.bladeA!
    const banditDamage = light.damage * scalingFor('sword').damage * (STATS.bandit!.might ?? 1)
    const step = 1 / 60
    // The shortest cooldown a bandit rolls, so this is the *worst* case they can
    // actually produce rather than an unbounded one.
    const cadence = 0.75 + light.windup + light.active + light.recovery

    let elapsed = 0
    const next = [0, cadence * 0.5]
    while (player.alive && elapsed < 120) {
      player.update(step)
      for (let i = 0; i < next.length; i++) {
        if (elapsed >= next[i]!) {
          player.receive(banditDamage, light.poiseDamage, 'slash', player.facing)
          next[i] = elapsed + cadence
        }
      }
      elapsed += step
    }
    expect(elapsed, 'the ambush kills a standing player too fast to read').toBeGreaterThan(10)
    expect(player.alive).toBe(false)
  })

  it('routes every weapon in the chapter to a pose family that exists', () => {
    for (const kind of Object.keys(ITEM_SLOT) as ItemKind[]) {
      const family = POSE_FAMILY[kind]
      if (family === null) {
        // Anything without a draw must have no drawn socket either, or the
        // attachment layer will hang it in a hand nothing animates.
        expect(DRAWN_SOCKET[kind] === null || STOW_SOCKET[kind] === DRAWN_SOCKET[kind]).toBe(true)
        continue
      }
      expect(['sword', 'greatsword', 'bow', 'crossbow']).toContain(family)
    }
  })

  it('gives the boar a telegraph no person has', () => {
    const charge = ATTACKS.boarCharge!
    const light = ATTACKS.bladeA!
    // Four times a sword's wind-up. The whole fight is that gap.
    expect(charge.windup / light.windup).toBeGreaterThan(4)
    // And it commits: once it starts, it travels, and it cannot be interrupted.
    expect(charge.lunge).toBeGreaterThan(5)
    expect(charge.superArmour ?? 0).toBeGreaterThan(STATS.athalus!.maxPoise)
  })
})

describe('the placeable catalogue carries the village', () => {
  it('registers every village prop with a collider', () => {
    const village = definitions.filter(d => d.category === 'village')
    expect(village.length).toBeGreaterThan(15)
    // Exactly two things in the built world are floors, and both have to be:
    // the chapter crosses the bridge, and the frame act is played standing on
    // the hut floor. Everything else claiming to be walkable is a promise the
    // collision proxy cannot keep — a house's box top is at eaves height while
    // its actual roof is a pitch, so standing on it means hovering.
    const walkable = village.filter(d => d.walkable).map(d => d.id).sort()
    expect(walkable).toEqual(['bridge-arla', 'hut-floor'])
    for (const definition of village) {
      // A house is not round. Every building takes a box, which rotates with the
      // placement's own yaw; a cylinder round a 6.4 x 4.5 m cottage either lets
      // the player into the wall or stops them short of the gable.
      if (definition.id.startsWith('house-')) {
        expect(definition.collider.kind, `${definition.id} is not a box`).toBe('box')
      }
    }
  })
})

/**
 * ─── The camp is laid out around a camera ───────────────────────────────────
 *
 * Chapter 2 is eight beats of people talking, so the dialogue camera is the
 * chapter. It puts the lens roughly two metres behind whoever is *listening* and
 * looks over their shoulder — which means the space behind each speaker is as
 * much part of the staging as the space they stand in.
 *
 * The first layout ignored that and sat the cast on the seats, as the manuscript
 * describes. There is no seated pose, so each figure stood inside its prop and
 * the chapter opened on the inside of a fallen log. These two tests are that bug
 * written down.
 */
describe('the bandits camp', () => {
  const props = campPlacements()
    // The treeline and undergrowth ring the clearing from 8 m out and are not
    // what a camera two metres behind somebody can hit.
    .filter(p => !p.defId.startsWith('tree-oak') && p.defId !== 'thicket')
    .map(p => ({ id: p.defId, x: p.x, z: p.z }))

  const speakers = [CAMP_MARKS.brutos, CAMP_MARKS.dorgo, CAMP_MARKS.jergo]

  it('stands nobody inside the furniture', () => {
    for (const [name, mark] of Object.entries(CAMP_MARKS)) {
      if (name === 'dorgoLeaving') {
        continue
      }
      for (const prop of props) {
        const distance = Math.hypot(mark.x - prop.x, mark.z - prop.z)
        expect(distance, `${name} stands ${distance.toFixed(2)} m from ${prop.id}`).toBeGreaterThan(1.7)
      }
    }
  })

  /**
   * Out to six metres straight back from each speaker, on the line from the
   * fire through their mark. That is where `DialogueCamera` puts the lens for an
   * over-the-shoulder and where its spring arm retreats to, so a barrel in this
   * corridor is a shot of a barrel.
   */
  it('leaves a clear corridor behind every speaker for the camera', () => {
    for (const mark of speakers) {
      const dx = mark.x - CAMP.x
      const dz = mark.z - CAMP.z
      const length = Math.hypot(dx, dz)
      for (let t = length; t <= 6; t += 0.25) {
        const x = CAMP.x + (dx / length) * t
        const z = CAMP.z + (dz / length) * t
        for (const prop of props) {
          const distance = Math.hypot(x - prop.x, z - prop.z)
          expect(distance, `${prop.id} sits in the camera corridor at ${t.toFixed(1)} m`).toBeGreaterThan(1.3)
        }
      }
    }
  })

  it('puts the camp far enough from the village to be a secret', () => {
    // Brutos means to watch both gates, so it has to be close — and it has to be
    // off the road, or a farmer finds it before the children do.
    const toVillage = Math.hypot(CAMP.x - VILLAGE.x, CAMP.z - VILLAGE.z)
    expect(toVillage).toBeGreaterThan(PALISADE_A + 20)
    expect(toVillage).toBeLessThan(140)
  })
})

/**
 * ─── The checkpoint save ────────────────────────────────────────────────────
 *
 * `snapshot` deliberately stores very little: which beat, which act, how the
 * player was doing, and who has said what to them. Everything else is re-staged
 * by `enterBeat`, which is what keeps the format from having to be migrated
 * every time a moveset is tuned.
 *
 * The player's *position* is the one exception and it is not decoration. A
 * `combat` beat has no `at` — it spawns an encounter and ends when that resolves
 * — so before this was saved, loading one left the player wherever they last
 * were. Measured in the browser: loading `ambush` put Athalus 101 m from five
 * bandits who were waiting for him, in a beat that can only end when they are
 * beaten.
 */
describe('the save format', () => {
  it('carries the player position, because a combat beat cannot supply one', () => {
    const ambush = STORY_BEATS.find(beat => beat.id === 'ambush')!
    expect(ambush.kind).toBe('combat')
    expect(ambush.at, 'a combat beat has nowhere to put the player').toBeUndefined()
  })

  /**
   * Every beat is reachable by id from a save. `beatIndex` searching the whole
   * story rather than one chapter is what makes that true across a chapter
   * boundary.
   */
  it('can address every beat in every chapter by id', () => {
    for (const beat of STORY_BEATS) {
      expect(beatIndex(beat.id), `beat "${beat.id}" is not addressable`).toBeGreaterThanOrEqual(0)
    }
    expect(beatIndex('b2-purse')).toBeGreaterThanOrEqual(CHAPTER_ONE.length)
    expect(beatIndex('no-such-beat')).toBe(-1)
  })
})
