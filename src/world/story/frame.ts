import type { Placement } from '../level/types'
import type { WaterPlacement } from '../water/types'

/**
 * ─── The storyteller's island ───────────────────────────────────────────────
 *
 * The frame story of `Chroniken von Arlaan` is told **decades after** the
 * chapter it contains, by a man who was there, to two grandchildren who were
 * not. The manuscript never says where — only that there is a house, a smithy
 * attached to it, a road outside, and a river close enough that the mother walks
 * back from it carrying two full pails.
 *
 * So the "where" is a design decision, and this is it: a small island, a long
 * way from Arlaan, with a hamlet of four houses on it.
 *
 * ── Why an island, and why 1.7 km away ──────────────────────────────────────
 *
 * The two timeframes have to be **unmistakably different places**. They share
 * one infinite heightfield and one art direction, so if they also shared a
 * landscape the player would spend the frame act wondering whether they were
 * still in Nimmerschein. An island solves it in one image: you cannot walk here
 * from Arlaan, and the horizon says so from every angle.
 *
 * The distance is set by the engine rather than by taste. Detailed terrain
 * streams to a 190 m radius and `FOG_DENSITY` buries anything past ~170 m, so
 * two places 1 700 m apart can never appear in one frame under any camera the
 * story can produce. Anything closer and a tall shot from the island could catch
 * Nimmerschein's palisade on the skyline sixty years before it was built.
 *
 * ── What the mainland on the horizon is ─────────────────────────────────────
 *
 * Past the sea's edge the terrain returns to its own procedural shape, which
 * reads from the island as a fogged coastline. That is free and it is *correct*:
 * the storyteller is an old man on a small island somewhere off a continent he
 * once crossed on foot, and a horizon with land on it says that better than an
 * empty one.
 */

/** Centre of the island, in world space. See the header on the distance. */
export const ISLE = { x: 1400, z: 900 }

/** Where the hut stands, and which way its door faces. */
export const HUT = { x: ISLE.x + 4, z: ISLE.z - 2 }
/**
 * Just outside the doorway — where the boy runs in from, and shouts down the
 * road from.
 *
 * `HUT.z + 6.6`, not `+ 4.4`: the south wall is at `HUT.z + 5.4` now that the
 * room is 10.8 m deep, and the old figure is 1 m *inside* it. A "shout down the
 * road" beat whose mark is in the middle of the kitchen is a beat the player
 * completes by standing still.
 */
export const HUT_DOOR = { x: HUT.x, z: HUT.z + 6.6 }

// ─── The room, as numbers everything else derives from ──────────────────────

/**
 * Interior half-extents. The walls stand *on* these lines; `ROOM_WALL` is their
 * half-thickness, so the inside face of a wall is `ROOM_HALF_X - ROOM_WALL`.
 *
 * Exported-by-being-here rather than by convention: `room()` and `FRAME_MARKS`
 * below both read them, and a chair placed against a wall that has moved is the
 * single most likely thing to break when this room is next resized.
 */
const ROOM_HALF_X = 6.4
const ROOM_HALF_Z = 5.4
const ROOM_WALL = 0.12
/** Half-width of the doorway in the south wall. */
const DOOR_HALF = 1.0

/**
 * The room as a world-space rectangle, for anything that needs to ask whether
 * somebody is inside it.
 *
 * `StoryDirector` is the only caller and it asks once a frame, to decide whether
 * the roof should be see-through. Published from here rather than measured there
 * because the room's dimensions live in this file and a "am I indoors" test
 * built on a second copy of them is a test that silently stops agreeing the
 * first time a wall moves.
 *
 * Generous by a metre on every side: the test wants to be true a pace *before*
 * the player crosses the threshold, so the roof is already open by the time they
 * are under it, and still true while they stand in the doorway talking.
 */
export const HUT_ROOM = {
  x: HUT.x,
  z: HUT.z,
  halfX: ROOM_HALF_X + 1,
  halfZ: ROOM_HALF_Z + 1
} as const

/**
 * The island's shape, as four radii.
 *
 * `story/terrain.ts` reads these and nothing else does, so the shape and the
 * placements below cannot drift apart: the hut's floor sits at `ISLE_TOP` and
 * the shoreline is wherever the profile crosses `SEA_LEVEL`, both derived from
 * the same numbers.
 */
export const ISLE_TOP = 6.0
export const ISLE_FLAT = 46
export const ISLE_SHOULDER = 64
export const ISLE_BEACH = 84
export const SEA_LEVEL = 2.0
/**
 * Half-extent of the seabed, as a **square**, matching the water plane.
 *
 * A disc was the first version and it left the water's rectangular corners
 * standing over natural terrain, so the sea had four wedges of hillside poking
 * up through it. Shaping the same rectangle the water covers is the fix, and it
 * is why this is not a radius.
 */
export const SEA_HALF = 172
/** Where the shaped seabed blends back into the world's own terrain. */
export const SEA_FADE = 212

let counter = 0
const place = (defId: string, x: number, z: number, rotY = 0, scale = 1, lift = 0): Placement => ({
  id: `frame-${++counter}`,
  defId,
  x: ISLE.x + x,
  y: 0,
  z: ISLE.z + z,
  rotY,
  scale,
  ...(lift !== 0 ? { lift } : {})
})

const wobble = (n: number): number => {
  const v = Math.sin(n * 12.9898) * 43758.5453
  return v - Math.floor(v)
}

/**
 * ─── The room ───────────────────────────────────────────────────────────────
 *
 * Interior 12.8 × 10.8 m with a 2.0 m doorway in the south wall, four glazed
 * bays and a shingled roof over the lot. It was 6.4 × 5.4 with a 1.2 m door and
 * neither of the other two; `assets/interior.ts` carries the argument for each
 * of those three changes, and the short version is that the old room was sized
 * from the blocking rather than from being walked around in — with the
 * furniture in it there were two disconnected pockets of clear floor about
 * 2 m × 1.5 m, and a household of five stood inside the table.
 *
 * ── How a wall is made now ──────────────────────────────────────────────────
 *
 * Out of the same three slab lengths and one new one, laid end to end:
 *
 * ```
 *   north (z = −5.4)   [ 6.4 ][ 6.4 ]                        12.8
 *   south (z = +5.4)   [2.6][2.8 win][ door 2.0 ][2.8 win][2.6]
 *   east  (x = +6.4)   [2.8 win][ 5.4 ][2.6]                  10.8
 *   west  (x = −6.4)   [2.6][ 5.4 ][2.8 win]                  10.8
 * ```
 *
 * Every run sums to the room's own dimension, and the arithmetic is written out
 * in the placements below because it is the one thing here that fails silently:
 * a wall run half a metre short leaves a slot you can see the meadow through and
 * walk out of, and nothing in the type system knows.
 *
 * Local coordinates are relative to `HUT`, and the room is axis-aligned on
 * purpose — a rotated room means every piece of furniture inside it carries the
 * same rotation, and one of them will eventually not.
 */
const room = (): Placement[] => {
  const ox = HUT.x - ISLE.x
  const oz = HUT.z - ISLE.z
  const at = (x: number, z: number): [number, number] => [ox + x, oz + z]

  const out: Placement[] = []
  const QUARTER = Math.PI * 0.5

  // ── Shell ────────────────────────────────────────────────────────────────
  out.push(place('hut-floor', ...at(0, 0)))
  out.push(place('hut-rafters', ...at(0, 0)))
  out.push(place('hut-roof', ...at(0, 0)))

  // North, the hearth wall: two 6.4 m runs, 12.8 m, unbroken.
  out.push(place('hut-wall-long', ...at(-3.2, -ROOM_HALF_Z)))
  out.push(place('hut-wall-long', ...at(3.2, -ROOM_HALF_Z)))

  // South, the door wall. From the middle out: the 2.0 m opening, then a glazed
  // bay each side of it (1.0 → 3.8), then a flank to the corner (3.8 → 6.4).
  //
  // The windows flank the *door* rather than sitting at the corners, which is
  // both what a real facade does and what the room needs: the two of them light
  // the table, and a corner window would light the chest.
  for (const side of [-1, 1] as const) {
    out.push(place('hut-window-bay', ...at(side * (DOOR_HALF + 1.4), ROOM_HALF_Z)))
    out.push(place('hut-glass', ...at(side * (DOOR_HALF + 1.4), ROOM_HALF_Z)))
    out.push(place('hut-wall-flank', ...at(side * (DOOR_HALF + 2.8 + 1.3), ROOM_HALF_Z)))
  }

  // East and west. A quarter turn takes a slab authored along X onto Z, so
  // these three add up along the room's 10.8 m depth: a bay (2.8), a side slab
  // (5.4) and a flank (2.6). The two walls are mirrored so the bays end up
  // diagonally opposite — the hearth is on the north wall and a window directly
  // across from another window would put the only two bright rectangles in the
  // room in one line behind the storyteller's head.
  for (const side of [-1, 1] as const) {
    const x = side * ROOM_HALF_X
    // `side` also flips the order along Z: the bay goes to the north end on the
    // east wall and to the south end on the west.
    out.push(place('hut-window-bay', ...at(x, side * -4.0), QUARTER))
    out.push(place('hut-glass', ...at(x, side * -4.0), QUARTER))
    out.push(place('hut-wall-side', ...at(x, side * 0.1), QUARTER))
    out.push(place('hut-wall-flank', ...at(x, side * 4.1), QUARTER))
  }

  // ── Furniture ────────────────────────────────────────────────────────────
  //
  // The hearth on the back wall, because the storyteller sits by it and because
  // the wall paint above it is authored sooted (`interior.ts`) — putting it
  // anywhere else would leave the soot over nothing. Its own half-depth is
  // 0.42, so it sits exactly against the wall's inside face.
  out.push(place('hut-hearth', ...at(-2.8, -ROOM_HALF_Z + ROOM_WALL + 0.42)))
  // And the chair, in front of it and facing the door — his back to the fire,
  // which is where an old man sits and is also the only blocking that lets the
  // dialogue camera shoot him with the hearth behind his head.
  out.push(place('hut-chair', ...at(-2.8, -3.5), 0.08))

  // The bed against the west wall. **The cushion is on it**, and it is the frame
  // act's first objective, so it is placed where a child can see it from the
  // door rather than tucked behind the hearth. Rotated a quarter turn, so its
  // length runs along the wall; that also puts the cushion (authored at local
  // x = −0.52) at `z + 0.52` in world terms, which is what `chapter1.ts` aims
  // the trigger at.
  out.push(place('hut-bed', ...at(-ROOM_HALF_X + ROOM_WALL + 0.68, 1.4), QUARTER))
  // The dresser on the east wall.
  out.push(place('hut-shelf', ...at(ROOM_HALF_X - ROOM_WALL - 0.23, -1.2), -QUARTER))

  // The table, a little south and east of centre — where a household actually
  // puts one: off the fire's hearthstone, out of the door's traffic, and in the
  // light of both south windows.
  const table: [number, number] = [0.4, 0.0]
  out.push(place('hut-table', ...at(...table)))
  out.push(place('hut-wine', ...at(...table), 0.4, 1, 0.61))
  // Six stools, not four. The household is five and the player is a sixth, and
  // the point of the act is that everybody sits down.
  for (const [dx, dz, yaw] of [
    [-1.0, 1.05, 0.1],
    [0.35, 1.2, 0.0],
    [1.7, 1.0, -0.2],
    [1.75, -1.0, Math.PI + 0.15],
    [0.35, -1.2, Math.PI],
    [-1.05, -0.95, Math.PI - 0.1]
  ] as const) {
    out.push(place('hut-stool', ...at(table[0] + dx, table[1] + dz), yaw))
  }

  // The chest by the door — the smith drops his hammer into it on the way in,
  // so it has to be the first thing on his right as he comes through.
  out.push(place('hut-chest', ...at(2.9, ROOM_HALF_Z - ROOM_WALL - 0.5), -0.12))
  // The work block with the count's engraved dagger on it. Arthus uses that
  // dagger as his argument that his father has time to listen.
  out.push(place('hut-workblock', ...at(-3.6, ROOM_HALF_Z - ROOM_WALL - 0.6), 0.3))
  // Two pails, set down inside the door — *beside* it now, not in it. They have
  // colliders since the room grew (see `assets/index.ts`), and a pail with a
  // collider standing in a doorway is a pail the player gets stuck behind.
  out.push(place('hut-pail', ...at(-1.9, 4.55), 0.5))
  out.push(place('hut-pail', ...at(-2.4, 4.3), -0.8))

  // ── What is on the walls ─────────────────────────────────────────────────
  //
  // Everything above stands on the floor and none of it is over 1.6 m, so
  // without these the room is 2.9 m of blank daub above shoulder height on all
  // four sides. `interior.ts` argues for each piece; the placement rule is that
  // they hang between 1.6 m and 2.4 m, on the inside face of a wall, facing in.
  //
  // A wall piece is authored in its own XY plane facing +Z, so the yaw that puts
  // it on a wall is the yaw that turns +Z into that wall's inward normal, and
  // `lift` raises it from the floor. The `y` a placement resolves to is the
  // *terrain* under it, so `lift` is measured from the ground rather than from
  // the floorboards — which stand 0.1 m proud of it (`hut-floor`).
  const INSIDE_N = -ROOM_HALF_Z + ROOM_WALL + 0.02
  // The portrait, on the north wall behind the chair. That is the one wall the
  // dialogue camera looks at all act: the storyteller faces the door, so every
  // reverse angle on him has this over his shoulder — which is the whole reason
  // a painting of a man who is not in the room is worth 560 triangles.
  out.push(place('hut-portrait', ...at(-4.9, INSIDE_N), 0, 1, 2.0))
  // The pelt and the antlers, the other side of the hearth. Spread wide: two
  // trophies side by side read as a pair of objects, and one at each end of a
  // 12.8 m wall reads as a wall somebody has been hanging things on for sixty
  // years.
  out.push(place('hut-pelt', ...at(1.5, INSIDE_N), 0, 1, 1.78))
  out.push(place('hut-antlers', ...at(4.5, INSIDE_N), 0, 1, 2.05))
  // The hammers on the east wall, between the dresser and the door, where the
  // smith reaches for them.
  out.push(place('hut-hammers', ...at(ROOM_HALF_X - ROOM_WALL - 0.02, 1.9), -QUARTER, 1, 1.72))

  return out
}

/**
 * The hamlet, the road and the shore.
 *
 * Four houses including the storyteller's own, so the island reads as somewhere
 * people live rather than as a diorama with one building on it. The other three
 * are ordinary `house-cottage` — the frame's present tense is peacetime and
 * nothing about it should look defended, which is why there is no palisade here
 * and why that absence is worth noticing next to Nimmerschein.
 */
const hamlet = (): Placement[] => {
  const out: Placement[] = []

  // ── The forge, and the cottage shell that used to be here ────────────────
  //
  // There was a `house-cottage` at (4, −12) — a shell standing just north of
  // the room so the hut read as part of a building from outside, while the room
  // itself stayed open to the camera. It is gone, because the room has a roof
  // of its own now (`hut-roof`) and the shell was a second, smaller, thatched
  // building overlapping the real one's north wall.
  //
  // What stands there instead is the **forge**, out to the east, which the
  // manuscript needs and the island did not have: the father is at it when the
  // act opens and walks in from it with a hammer still in his hand. It is a
  // plain cottage with an anvil and a wood pile outside rather than
  // `house-smithy`, which is two storeys with a jetty and is *Athalus's* house
  // sixty years earlier and four hundred miles away.
  out.push(place('house-cottage', 17, -1, -0.35))
  out.push(place('village-anvil', 12.8, 1.6, 0.5))
  out.push(place('village-logpile', 13.6, -6.2, 0.2, 1.05))
  out.push(place('house-barn', -13, -9, 1.5))

  // Three neighbours down the road, turned to face it.
  const neighbours: [number, number, number, string][] = [
    [-16, 12, 0.1, 'house-cottage-b'],
    [-3, 20, Math.PI + 0.08, 'house-cottage'],
    [17, 14, -0.2, 'house-long']
  ]
  for (const [x, z, yaw, def] of neighbours) {
    out.push(place(def, x, z, yaw, 0.94 + wobble(x * 3 + z) * 0.12))
  }

  // The road past the door, marked by fence runs — the same way Arlaan's road
  // is marked, because it is the same world sixty years on.
  for (let i = 0; i < 5; i++) {
    const z = 7 + i * 8
    out.push(place('village-fence', -9 + Math.sin(i) * 1.2, z, 0.05 + Math.sin(i * 0.7) * 0.06))
  }

  // ── The yard ─────────────────────────────────────────────────────────────
  //
  // Every one of these moved outward when the room doubled, and three of them
  // had to: the room now spans x ∈ [−2.4, 10.4] and z ∈ [−7.4, 3.4] in island
  // coordinates, and the well at (10, 3), the bench at (8.4, 1.2) and the log
  // pile at (8.5, −8) were **inside it**. A prop inside a room is not a
  // placement bug that shows up as a warning; it is a well in the middle of
  // somebody's kitchen, and the only thing that finds it is looking.
  out.push(place('village-well', 14.5, 6.5, 0.4))
  out.push(place('village-cart', 16, -6, 1.9))
  out.push(place('village-haystack', -19, -2, 0, 0.95))
  out.push(place('village-bench', 12.6, 5.2, -1.1))
  out.push(place('village-crates', 15.5, 8.4, 0.7))

  // ── The shore ────────────────────────────────────────────────────────────
  //
  // A ring of stones and driftwood-scale trees at the shoulder of the island,
  // which is where the ground turns from meadow to beach. It exists to give the
  // island an *edge* — without it the plateau just fades into the water and the
  // whole landmass reads as a sandbank.
  for (let i = 0; i < 26; i++) {
    const angle = (i / 26) * Math.PI * 2
    const r = 52 + wobble(i * 31) * 10
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r
    out.push(place(i % 3 === 0 ? 'rock-boulder' : 'rock-stone', x, z, wobble(i) * 6.28, 0.7 + wobble(i * 7) * 0.9))
  }
  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2 + 0.3
    const r = 38 + wobble(i * 17) * 9
    out.push(
      place(
        i % 3 === 0 ? 'tree-pine' : i % 2 === 0 ? 'tree-birch' : 'tree-crown',
        Math.cos(angle) * r,
        Math.sin(angle) * r,
        wobble(i * 3) * 6.28,
        0.8 + wobble(i * 23) * 0.35
      )
    )
  }

  return out
}

/**
 * ─── Where the sheep are ────────────────────────────────────────────────────
 *
 * A strip of yard south-east of the door, 9 × 18 m. It is here rather than
 * anywhere else for four reasons, and they are all in the numbers above:
 *
 * * **It is the first thing you see.** `chapter1.ts::FRAME_SPAWN` puts the boy
 *   at `HUT_DOOR + (0.6, 9.5)` — island-local (4.6, 14.1) — facing the door,
 *   which is the middle of this rectangle. The chapter opens standing in it.
 * * **It is empty.** Nothing in `hamlet()` is inside island-local x ∈ [2, 11],
 *   z ∈ [6, 24]. The nearest neighbours are the bench at x ≥ 11.65, the
 *   neighbour cottage whose 3.05 m half-extent reaches only x ≤ 0.1, and the
 *   long house at x ≥ 12.1. The margins are 0.65 m, 1.9 m and 1.1 m.
 * * **It is off the road.** The fence runs that mark it stand at x ≈ −8, seven
 *   metres west of this rectangle's west edge.
 * * **It is flat.** `story/terrain.ts` holds the plateau at `ISLE_TOP` inside
 *   `ISLE_FLAT` = 46 m, and this rectangle's far corner is 26.4 m out.
 *
 * The room is *not* inside it — the paddock starts 1.6 m south of the south wall
 * — but `HUT_ROOM` is handed to the flock as a keep-out anyway, and that is not
 * belt-and-braces. The room's walls are colliders and its **doorway is a 2 m
 * hole in the south wall**, so an animal steered by prop collision alone can
 * walk into the kitchen; and this rectangle is exactly the kind of number that
 * gets nudged north one day by somebody who has forgotten the door is there.
 */
export const SHEEP_PADDOCK = {
  x: ISLE.x + 6.5,
  z: ISLE.z + 15,
  halfX: 4.5,
  halfZ: 9
} as const

/** Everything the frame act places. Resolved against the terrain by `World`. */
export const framePlacements = (): Placement[] => {
  counter = 0
  return [...room(), ...hamlet()]
}

/**
 * The sea.
 *
 * A pool rather than a river, and a **square** one matching `SEA_HALF`, so its
 * edge and the shaped seabed are the same rectangle — see that constant. Its
 * surface sits at `SEA_LEVEL`, which is 4 m below the island's plateau, so the
 * shore is a real slope rather than a painted line.
 */
export const seaPlacement = (): WaterPlacement => ({
  id: 'frame-sea',
  kind: 'pool',
  styleId: 'sea',
  x: ISLE.x,
  y: SEA_LEVEL,
  z: ISLE.z,
  rotY: 0,
  halfX: SEA_HALF,
  halfZ: SEA_HALF,
  nodes: []
})

/**
 * Where each frame character stands when the act begins, and where they end up.
 *
 * Blocking, not decoration. The storyteller is in the chair by the hearth with
 * his back to the fire so he faces the door; the boy comes in through it; the
 * father is outside at the forge and walks in during the act; the mother and
 * Lena are down the road and arrive last, which is the thing the whole scene is
 * waiting for.
 *
 * ── The seats are seats now ─────────────────────────────────────────────────
 *
 * Each `*Seat` names a `posture` as well as a position, and `StoryDirector`
 * hands it to `Combatant.sit`. The four adults take a piece of furniture that is
 * actually at that spot — the chair for the old man, stools at the table for the
 * parents — and the two children sit on the floor, which is what children do at
 * a fireside and is also the honest answer to there being six people and one
 * chair. `combat/postures.ts` carries the three clips.
 *
 * The furniture and these marks are two lists of the same numbers, and that is a
 * real hazard: a stool moved 30 cm in `room()` leaves somebody sitting beside
 * it. They are kept adjacent in this file for that reason, and every seat below
 * names the prop it belongs to.
 */
export const FRAME_MARKS = {
  /** In the chair at (−2.8, −3.5), facing the door. */
  storyteller: { x: HUT.x - 2.8, z: HUT.z - 3.42, facing: 0.08, posture: 'chair' },
  arthus: { x: HUT.x + 0.4, z: HUT.z + 9.5, facing: Math.PI },
  /** At the forge, east of the house — outside the room, which +9.5 no longer was. */
  father: { x: HUT.x + 12.4, z: HUT.z + 1.5, facing: -Math.PI * 0.5 },
  mother: { x: HUT.x - 12, z: HUT.z + 32, facing: -0.4 },
  lena: { x: HUT.x - 10.5, z: HUT.z + 33.5, facing: -0.4 },
  /** The stool at the table's north-east corner. */
  motherSeat: { x: HUT.x + 2.1, z: HUT.z + 1.0, facing: Math.PI * 0.78, posture: 'stool' },
  /** The stool at its south-east corner. */
  fatherSeat: { x: HUT.x + 2.15, z: HUT.z - 1.0, facing: -Math.PI * 0.72, posture: 'stool' },
  /**
   * On the floor at the old man's feet, both of them, on the hearth side of the
   * chair where the light is.
   *
   * Not stools. There are six stools and they would fit, and it would be the
   * wrong scene: the act is a story being told to two children, and two children
   * sitting on the boards looking up is the whole picture. It is also why
   * `postures.ts` has a third clip.
   */
  lenaSeat: { x: HUT.x - 1.85, z: HUT.z - 2.55, facing: -Math.PI * 0.78, posture: 'floor' },
  arthusSeat: { x: HUT.x - 3.75, z: HUT.z - 2.45, facing: Math.PI * 0.76, posture: 'floor' }
} as const

/**
 * ─── The ways in ────────────────────────────────────────────────────────────
 *
 * How the household actually gets to the table, as a list of waypoints each.
 *
 * ── Why this is a route and not a destination ───────────────────────────────
 *
 * `errandBrain` steers a straight line and lets the mover slide along whatever
 * it hits. That is enough to cross a room and nowhere near enough to get into
 * one: the door is a 2 m gap in the **south** wall at `HUT.z + 5.4`, the smith's
 * forge is off the **east** end of the house, and the mother and the daughter
 * are thirty metres down the road to the south-west. A straight line from any
 * of those three to a stool at the table goes through a wall, and what the
 * player would see is somebody walking on the spot against the outside of the
 * house until the give-up timer fired.
 *
 * So the route is authored, and it is authored *here* — beside the room whose
 * walls make it necessary — rather than in the director. If this room is ever
 * resized these waypoints are wrong in exactly the same way the furniture marks
 * above are wrong, and they are the same edit.
 *
 * ── The shape of every route ────────────────────────────────────────────────
 *
 * Out into the open, to the door, through it, then to the seat. The waypoint
 * *outside* the door is the one that matters: without it the father cuts the
 * south-east corner of the building, and the mother arrives at the threshold
 * already turning for her stool and clips the door frame.
 *
 * The last leg is the seat itself and is not repeated here — the director reads
 * it from `FRAME_MARKS`, so a stool that moves does not also have to be moved in
 * this table.
 */
export const FRAME_ROUTES = {
  /**
   * The smith, from the forge. East, so he goes round the south-east corner
   * rather than through the end wall.
   */
  father: [
    { x: HUT.x + 9.5, z: HUT.z + 8.2 },
    { x: HUT.x + 1.4, z: HUT.z + 8.0 },
    { x: HUT.x, z: HUT.z + 4.2 }
  ],
  /** Up the road from the south-west, then in. */
  mother: [
    { x: HUT.x - 4.5, z: HUT.z + 14 },
    { x: HUT.x - 0.6, z: HUT.z + 8.0 },
    { x: HUT.x + 0.2, z: HUT.z + 4.2 }
  ],
  /**
   * A pace behind her mother the whole way, and offset, so the two of them do
   * not walk the same line and grind against each other in the doorway — the
   * mover resolves actor-against-actor and two figures sharing a waypoint stand
   * shoving in a 2 m gap.
   */
  lena: [
    { x: HUT.x - 3.2, z: HUT.z + 15.4 },
    { x: HUT.x + 0.7, z: HUT.z + 9.2 },
    { x: HUT.x - 0.4, z: HUT.z + 4.4 }
  ]
} as const satisfies Record<string, readonly { x: number; z: number }[]>
