import type { Placement } from '../level/types'
import type { RiverNode, WaterPlacement } from '../water/types'
import { PALISADE_RUN } from '../assets/village'

/**
 * ─── The map of Chapter 1 ───────────────────────────────────────────────────
 *
 * Everything in the chapter happens along one east–west line, and the layout is
 * built around that line rather than around a region:
 *
 * ```
 *   west                                                              east
 *   ─────────────────────────────────────────────────────────────────────►
 *   forest        the Arla      open field        palisade    Nimmerschein
 *   x < -105      x = -96       -90 … -40         x = -38      x = 0
 *   ▲             ▲             ▲                              ▲
 *   the trap      the bridge    the ambush                     the Treff,
 *   (-165, 25)    (-96, 4)      (-64, 2)                       the smithy
 * ```
 *
 * That is the chapter's own shape: they hunt in the deep woods, come out at the
 * river, cross it, rest in the open "only a few paces off the path", are jumped
 * from the treeline, and run the last fifty paces to a gate with a nineteen-
 * year-old sitting in front of it. Laying it out on a line means the player is
 * always walking *toward* the village and the camera always has the village on
 * the horizon, which is the whole reason the ambush has any tension: you can see
 * where safety is.
 *
 * ── Distances, and why they are what they are ───────────────────────────────
 *
 *   | leg                | metres | at a jog | in the book         |
 *   |--------------------|-------:|---------:|---------------------|
 *   | trap → river       |     75 |     21 s | "hours" of walking  |
 *   | bridge → ambush    |     32 |      9 s | a conversation      |
 *   | ambush → gate      |     26 |      7 s | "fifty paces"       |
 *
 * The last row is the one that is honest: fifty paces is about 38 m and this is
 * 26, which is close. The first is compressed by a factor of roughly forty, and
 * that is not a compromise to apologise for — the manuscript covers it in two
 * paragraphs of dialogue about a mad king, and the game covers it in the same
 * two paragraphs of dialogue while you walk. Padding it to a realistic distance
 * would add nothing but walking.
 *
 * ── The forest is not in this file ──────────────────────────────────────────
 *
 * There are no forest trees below, and that is deliberate: `World` already
 * scatters three species of tree, two boulders and two stones per terrain chunk,
 * procedurally and infinitely, and the story simply raises their clear radius so
 * they stop at the palisade. Hand-placing a forest would be forty thousand
 * placements to reproduce something the engine gives away — and it would not
 * stream.
 *
 * What *is* placed by hand is everything the scatter cannot know about: the
 * village, the bridge, the treeline the bandits come out of, and the ring of old
 * oaks around the trap clearing.
 */

// ─── Landmarks ──────────────────────────────────────────────────────────────

export const VILLAGE = { x: 0, z: 0 }
/** Half-axes of the palisade ring. Not a circle — a village follows its ground. */
export const PALISADE_A = 38
export const PALISADE_B = 30
/** The west gate, which is the one Chapter 1 walks through. */
export const WEST_GATE = { x: -PALISADE_A, z: 0 }
export const SOUTH_GATE = { x: 0, z: -PALISADE_B }
export const TREFF = { x: -9, z: -13 }
export const MARKET = { x: 1, z: 7 }
export const SMITHY = { x: 15, z: 7 }
export const BOWYER = { x: -15, z: -5 }
export const BRIDGE = { x: -96, z: 4 }
export const AMBUSH = { x: -64, z: 2 }
export const TRAP_CLEARING = { x: -165, z: 25 }
/** Where the party leaves the deep wood and first sees the river. */
export const FOREST_EDGE = { x: -108, z: 10 }

/** The Arla's channel centre. The bridge spans it. */
export const RIVER_X = -96

let counter = 0
const place = (defId: string, x: number, z: number, rotY = 0, scale = 1): Placement => ({
  id: `story-${++counter}`,
  defId,
  x,
  y: 0,
  z,
  rotY,
  scale
})

/**
 * Deterministic jitter, so a village is not a grid and is the same village every
 * time. The same hash `village.ts` uses for its stakes — one wobble function
 * for the whole chapter, because two would drift and produce two different
 * kinds of randomness in one scene.
 */
const wobble = (n: number): number => {
  const v = Math.sin(n * 12.9898) * 43758.5453
  return v - Math.floor(v)
}

// ─── The palisade ───────────────────────────────────────────────────────────

/**
 * A ring of `palisade-run` segments around an ellipse, with a gap at each gate.
 *
 * Stepping by **arc length** rather than by angle is what stops the segments
 * overlapping at the ends of the ellipse and gapping at its sides — an ellipse's
 * angular parameter is not its arc, and a wall built by even angles is visibly
 * bunched at two points and open at two others.
 */
const palisadeRing = (): Placement[] => {
  const out: Placement[] = []
  const samples = 720
  // Arc length of the ellipse, sampled.
  const xs: number[] = []
  const zs: number[] = []
  const lengths: number[] = [0]
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * Math.PI * 2
    const x = VILLAGE.x + Math.cos(t) * PALISADE_A
    const z = VILLAGE.z + Math.sin(t) * PALISADE_B
    xs.push(x)
    zs.push(z)
    if (i > 0) {
      lengths.push(lengths[i - 1]! + Math.hypot(x - xs[i - 1]!, z - zs[i - 1]!))
    }
  }
  const perimeter = lengths[samples]!
  const count = Math.round(perimeter / PALISADE_RUN)
  const step = perimeter / count

  // Gates, as arc-length windows to skip. A gate is 10 m of opening plus the
  // width of its own towers, so the window is generous — a palisade segment
  // standing inside a gate tower is the most obvious possible placement bug.
  const gateWindows: { at: number; half: number }[] = []
  const arcAt = (targetX: number, targetZ: number): number => {
    let best = 0
    let bestD = Number.POSITIVE_INFINITY
    for (let i = 0; i <= samples; i++) {
      const d = Math.hypot(xs[i]! - targetX, zs[i]! - targetZ)
      if (d < bestD) {
        bestD = d
        best = lengths[i]!
      }
    }
    return best
  }
  gateWindows.push({ at: arcAt(WEST_GATE.x, WEST_GATE.z), half: 8.5 })
  gateWindows.push({ at: arcAt(SOUTH_GATE.x, SOUTH_GATE.z), half: 8.5 })

  let cursor = 0
  for (let i = 0; i < count; i++) {
    const s = (i + 0.5) * step
    let skip = false
    for (const gate of gateWindows) {
      let d = Math.abs(s - gate.at)
      d = Math.min(d, perimeter - d)
      if (d < gate.half) {
        skip = true
        break
      }
    }
    if (skip) {
      continue
    }
    // Position and tangent at arc length `s`.
    while (cursor < samples && lengths[cursor + 1]! < s) {
      cursor++
    }
    const x = xs[cursor]!
    const z = zs[cursor]!
    const nx = xs[Math.min(samples, cursor + 1)]!
    const nz = zs[Math.min(samples, cursor + 1)]!
    // The run is authored along X, so its yaw is the tangent's own bearing.
    const yaw = Math.atan2(nx - x, nz - z) + Math.PI * 0.5
    out.push(place('palisade-run', x, z, yaw))
  }

  // The gates themselves, facing outward.
  out.push(place('palisade-gate', WEST_GATE.x, WEST_GATE.z, Math.PI * 0.5))
  out.push(place('palisade-gate', SOUTH_GATE.x, SOUTH_GATE.z, 0))
  return out
}

// ─── Inside the walls ───────────────────────────────────────────────────────

/**
 * Nimmerschein: "a middling village with a little under 500 souls".
 *
 * Five hundred souls is about a hundred and twenty households, which nobody is
 * going to model and nobody needs to: what the player sees is a market square, a
 * street to it from the gate, the smithy on the far side, the Treff off to one
 * side, and enough roofs behind those to imply the rest. Twenty-two buildings do
 * that. A hundred and twenty would cost thirty thousand triangles at LOD0 and
 * would say exactly the same thing.
 *
 * The **street from the west gate to the market is the spine**, and every house
 * near it is turned to face it. That is the one placement rule that matters
 * indoors: a village where the buildings are rotated at random reads as a
 * scattering of huts, and one where they address a street reads as a town.
 */
const village = (): Placement[] => {
  const out: Placement[] = []

  // ── The street from the west gate ─────────────────────────────────────────
  //
  // Houses in two rows facing each other across a 9 m street, running east from
  // the gate to the market square.
  const streetHouses: { x: number; z: number; side: 1 | -1; def: string }[] = [
    { x: -30, z: 6.5, side: 1, def: 'house-cottage' },
    { x: -30, z: -6.5, side: -1, def: 'house-cottage-b' },
    { x: -21, z: 7.5, side: 1, def: 'house-cottage-b' },
    { x: -21, z: -7.0, side: -1, def: 'house-long' },
    { x: -12, z: 7.0, side: 1, def: 'house-cottage' },
    { x: -12, z: -8.0, side: -1, def: 'house-cottage-b' }
  ]
  for (const house of streetHouses) {
    // The ridge runs along the building's X, so a house facing the street
    // (north or south) has its ridge along the street: yaw 0. The wobble is
    // ±4°, which is what stops a row reading as a terrace.
    out.push(place(house.def, house.x, house.z, (wobble(house.x * 3 + house.z) - 0.5) * 0.14, 0.94 + wobble(house.x) * 0.14))
  }

  // ── The market square ─────────────────────────────────────────────────────
  out.push(place('village-well', MARKET.x - 5, MARKET.z + 2))
  out.push(place('village-stall', MARKET.x - 2, MARKET.z + 8, 0.06))
  out.push(place('village-stall', MARKET.x + 5, MARKET.z + 7.6, -0.1))
  out.push(place('village-stall', MARKET.x + 1.5, MARKET.z - 5, Math.PI + 0.08))
  out.push(place('village-cart', MARKET.x + 8, MARKET.z + 1, 2.2))
  out.push(place('village-crates', MARKET.x - 7, MARKET.z + 6.5, 0.9))
  out.push(place('village-crates', MARKET.x + 9.5, MARKET.z + 4, -1.4, 0.9))
  out.push(place('village-barrel', MARKET.x - 6.2, MARKET.z + 5.2))
  out.push(place('village-barrel', MARKET.x - 6.9, MARKET.z + 4.3, 1.1, 0.94))
  out.push(place('village-trough', MARKET.x - 3.4, MARKET.z + 0.4, 0.2))

  // ── Athalus's house: the smithy, and its yard ────────────────────────────
  //
  // Turned to face the square, because it is the building the chapter ends
  // inside and the player has to be able to find it from the gate. Its forge
  // annex is on its −X gable, so the yard is on the square's side.
  out.push(place('house-smithy', SMITHY.x, SMITHY.z, Math.PI * 0.5))
  out.push(place('village-anvil', SMITHY.x - 4.6, SMITHY.z - 1.2, 0.4))
  out.push(place('village-trough', SMITHY.x - 5.6, SMITHY.z - 4.0, 1.5))
  out.push(place('village-logpile', SMITHY.x - 3.0, SMITHY.z + 5.5, 0.2, 1.1))
  out.push(place('village-logpile', SMITHY.x - 1.4, SMITHY.z + 5.7, 0.15, 0.95))
  out.push(place('village-crates', SMITHY.x - 6.2, SMITHY.z + 2.4, 0.5))

  // ── The bowyer's: Kareen's house and workshop in one ─────────────────────
  out.push(place('house-long', BOWYER.x, BOWYER.z, Math.PI * 0.5 + 0.05))
  out.push(place('village-staverack', BOWYER.x + 4.2, BOWYER.z - 2.4, Math.PI * 0.5))
  out.push(place('village-logpile', BOWYER.x + 4.6, BOWYER.z + 1.8, 1.4, 0.85))

  // ── Der Treff ─────────────────────────────────────────────────────────────
  //
  // "A small square with benches and a fire pit." Four benches round the fire,
  // not facing it square-on — a ring of benches at exact 90° intervals reads as
  // a meeting room, and this is where four teenagers agree to roast a pig.
  out.push(place('village-firepit', TREFF.x, TREFF.z))
  const benchRing = [0.4, 1.9, 3.5, 5.1]
  for (const [i, angle] of benchRing.entries()) {
    const r = 2.5 + wobble(i * 7) * 0.5
    out.push(place('village-bench', TREFF.x + Math.cos(angle) * r, TREFF.z + Math.sin(angle) * r, -angle + Math.PI * 0.5))
  }
  out.push(place('village-logpile', TREFF.x + 4.2, TREFF.z - 2.6, 0.7, 0.8))
  out.push(place('house-cottage', TREFF.x - 6, TREFF.z - 6, 0.3))

  // ── The rest of the village ───────────────────────────────────────────────
  //
  // Placed on a loose ring inside the wall so the player never sees open ground
  // between the last house and the palisade, which is what would make the wall
  // read as a fence round a field.
  const ring: { angle: number; radius: number; def: string }[] = [
    { angle: 0.55, radius: 26, def: 'house-cottage' },
    { angle: 1.05, radius: 22, def: 'house-cottage-b' },
    { angle: 1.55, radius: 20, def: 'house-barn' },
    { angle: 2.15, radius: 24, def: 'house-cottage' },
    { angle: 2.75, radius: 27, def: 'house-cottage-b' },
    { angle: 3.75, radius: 26, def: 'house-cottage' },
    { angle: 4.2, radius: 22, def: 'house-long' },
    { angle: 4.75, radius: 20, def: 'house-barn' },
    { angle: 5.3, radius: 24, def: 'house-cottage-b' },
    { angle: 5.85, radius: 27, def: 'house-cottage' }
  ]
  for (const [i, entry] of ring.entries()) {
    const x = VILLAGE.x + Math.cos(entry.angle) * entry.radius * (PALISADE_A / 38)
    const z = VILLAGE.z + Math.sin(entry.angle) * entry.radius * (PALISADE_B / 38)
    // Every outer house turns its back to the wall, i.e. faces the centre.
    const yaw = Math.atan2(-x, -z) + Math.PI * 0.5 + (wobble(i * 11) - 0.5) * 0.3
    out.push(place(entry.def, x, z, yaw, 0.92 + wobble(i * 3) * 0.16))
  }

  // ── Yards: fences, hay, and the smallholdings against the wall ───────────
  const yards: { x: number; z: number; yaw: number }[] = [
    { x: 24, z: -16, yaw: 0.35 },
    { x: 24, z: -12, yaw: 0.35 },
    { x: -24, z: 17, yaw: 1.9 },
    { x: -20.5, z: 18.6, yaw: 1.9 }
  ]
  for (const yard of yards) {
    out.push(place('village-fence', yard.x, yard.z, yard.yaw))
  }
  out.push(place('village-haystack', 27, -19, 0, 1.1))
  out.push(place('village-haystack', 30, -16.5, 0, 0.86))
  out.push(place('village-haystack', -25, 21, 0, 0.95))
  out.push(place('village-cart', -28, 14, 1.1))

  return out
}

// ─── Outside the walls ──────────────────────────────────────────────────────

/**
 * The road, the treeline, the bridge and the trap.
 *
 * The **treeline** is the only hand-placed forest in the chapter, and it exists
 * for one shot: the bandits come out of it. Scatter would put trees there too,
 * but it would put them in a cloud with no edge, and "five dark figures came
 * running out of the bushes at the edge of the wood" needs an edge.
 */
const outside = (): Placement[] => {
  const out: Placement[] = []

  // ── The treeline the ambush comes out of ─────────────────────────────────
  //
  // A dense broken line at x ≈ −80, from z = −26 to z = +30. Broken rather than
  // straight: a hedge reads as planted, and this is supposed to be where the
  // wood happens to stop.
  for (let i = 0; i < 26; i++) {
    const t = i / 25
    const z = -26 + t * 56
    const x = -80 + Math.sin(t * 7.3) * 3.4 + (wobble(i * 5) - 0.5) * 3
    const species = i % 5 === 0 ? 'tree-oak-ancient' : i % 3 === 0 ? 'tree-crown' : 'tree-birch'
    out.push(place(species, x, z, wobble(i) * 6.28, 0.85 + wobble(i * 13) * 0.4))
  }
  // A second, sparser rank behind it, so the wood has depth rather than being a
  // painted flat.
  for (let i = 0; i < 14; i++) {
    const t = i / 13
    out.push(
      place(
        i % 2 === 0 ? 'tree-pine' : 'tree-crown',
        -88 - wobble(i * 17) * 6,
        -24 + t * 52 + (wobble(i * 3) - 0.5) * 4,
        wobble(i * 7) * 6.28,
        0.9 + wobble(i * 23) * 0.35
      )
    )
  }

  // ── The bridge over the Arla ─────────────────────────────────────────────
  //
  // Rotated a quarter turn: the deck is authored along X and the river runs
  // north–south, so the crossing is east–west.
  out.push(place('bridge-arla', BRIDGE.x, BRIDGE.z, 0))
  // Two fence runs as the approach rails on the near bank, which is what makes
  // the bridge read as part of a road rather than as a plank in a field.
  out.push(place('village-fence', BRIDGE.x + 6.5, BRIDGE.z + 2.4, 0))
  out.push(place('village-fence', BRIDGE.x + 6.5, BRIDGE.z - 2.4, 0))

  // ── The far bank and the deep wood ───────────────────────────────────────
  for (let i = 0; i < 22; i++) {
    const angle = (i / 22) * Math.PI * 2
    const r = 16 + wobble(i * 31) * 26
    out.push(
      place(
        i % 4 === 0 ? 'tree-oak-ancient' : i % 2 === 0 ? 'tree-crown' : 'tree-birch',
        FOREST_EDGE.x - 12 + Math.cos(angle) * r,
        FOREST_EDGE.z + Math.sin(angle) * r * 0.8,
        wobble(i * 3) * 6.28,
        0.9 + wobble(i * 41) * 0.4
      )
    )
  }

  // ── The trap clearing ─────────────────────────────────────────────────────
  //
  // A ring of old oaks with a gap on the east side, so the boar's charge has one
  // way out and the player can see where it goes. **The tree Athalus climbs** is
  // the single ancient oak in the middle of the gap — placed on its own, at full
  // scale, because the chapter's first set piece is a man in it.
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2
    // The gap: skip the three trees on the eastern arc.
    if (Math.cos(angle) > 0.72) {
      continue
    }
    const r = 17 + wobble(i * 19) * 5
    out.push(
      place(
        i % 3 === 0 ? 'tree-oak-ancient' : 'tree-crown',
        TRAP_CLEARING.x + Math.cos(angle) * r,
        TRAP_CLEARING.z + Math.sin(angle) * r,
        wobble(i * 11) * 6.28,
        1.0 + wobble(i * 29) * 0.3
      )
    )
  }
  out.push(place('tree-oak-ancient', TRAP_CLEARING.x + 6.5, TRAP_CLEARING.z - 3.5, 0.6, 1.25))

  // ── The net, which is the whole reason the chapter opens here ────────────
  //
  // The party spends the opening beat discussing a net they have just set, and
  // the boar comes through it. Until it was modelled there was nothing at that
  // spot at all, so the first thing the chapter showed a player was four people
  // talking about an empty patch of grass.
  //
  // It stands **across the gap in the ring of oaks** — the eastern arc, where
  // `Math.cos(angle) > 0.72` skips three trees — because that gap is the one way
  // out of the clearing and a trap set anywhere else is a trap the animal walks
  // around. `hunt-net` is authored along its own X, so a quarter turn stands it
  // across the opening rather than in line with it.
  //
  // Two more, angled back from the first, so the trap has *wings*: a single 5 m
  // panel in a 34 m clearing is a fence somebody abandoned, and the funnel is
  // what makes it read as something the four of them spent the morning on. They
  // are the reason the guy ropes on this prop run 5.5 m — the wings' ropes reach
  // back into the treeline, which is what the dialogue means by tying it off.
  out.push(place('hunt-net', TRAP_CLEARING.x + 15.5, TRAP_CLEARING.z + 1.5, Math.PI * 0.5))
  out.push(place('hunt-net', TRAP_CLEARING.x + 13.6, TRAP_CLEARING.z + 7.4, Math.PI * 0.5 + 0.62, 0.96))
  out.push(place('hunt-net', TRAP_CLEARING.x + 13.2, TRAP_CLEARING.z - 4.6, Math.PI * 0.5 - 0.68, 1.02))
  // Two boulders as cover in the clearing, which is what makes the charge
  // dodgeable in more than one way.
  out.push(place('rock-boulder', TRAP_CLEARING.x - 5, TRAP_CLEARING.z + 6, 1.2, 1.3))
  out.push(place('rock-boulder', TRAP_CLEARING.x + 2, TRAP_CLEARING.z + 9, 2.4, 1.0))

  // ── The road ──────────────────────────────────────────────────────────────
  //
  // Marked by fence runs and the odd stone rather than by a texture — there are
  // no prop textures in this world (GDD R8) and the terrain's own palette does
  // not carry a road. Posts every 12 m read as a way, which is all that is
  // needed to keep a player walking east.
  for (let x = -88; x < WEST_GATE.x - 4; x += 12) {
    out.push(place('village-fence', x, 7.5 + Math.sin(x * 0.07) * 1.5, 0.06))
    out.push(place('village-fence', x, -6.5 + Math.sin(x * 0.05) * 1.4, -0.04))
  }
  out.push(place('rock-stone', -70, 5.5, 1.1, 1.2))
  out.push(place('rock-stone', -52, -3.2, 0.4, 0.9))
  out.push(place('rock-boulder', AMBUSH.x - 8, AMBUSH.z - 9, 0.9, 1.1))

  return out
}

/** Everything the chapter places by hand, resolved against the terrain later. */
export const chapterOnePlacements = (): Placement[] => {
  counter = 0
  return [...palisadeRing(), ...village(), ...outside()]
}

// ─── The Arla ───────────────────────────────────────────────────────────────

/**
 * "A river some two dozen feet wide, running fast from north to south through
 * the whole of Arlaan."
 *
 * Two dozen feet is 7.3 m, so the channel is authored at 3.6 m of half-width and
 * the bridge (7.2 m of span) lands its abutments on the banks rather than in the
 * water. The nodes wander — a river that is a straight line is a canal, and
 * Nimmerschein's whole prosperity rests on this one being navigable by a man
 * with a boat, a horse and a cart on it.
 *
 * `y` is the **surface** height at each node and is not derived from the terrain:
 * the story's own sculpt (`terrain.ts`) cuts the channel to sit 0.55 m below the
 * surrounding ground, so the water is authored at that level and the banks come
 * to it rather than the other way round.
 */
export const arlaNodes = (): RiverNode[] => {
  const nodes: RiverNode[] = []
  for (let i = 0; i <= 10; i++) {
    const t = i / 10
    const z = 130 - t * 260
    nodes.push({
      x: RIVER_X + Math.sin(t * 5.1) * 5.5,
      z,
      // Running south: 3.4 m of fall over 260 m, which is a fast river in
      // stylised terms and matches "the Arla flows quite fast".
      y: RIVER_SURFACE_Y + t * -3.4,
      halfWidth: 3.4 + Math.sin(t * 3.3) * 0.6
    })
  }
  return nodes
}

/** Surface height of the Arla at the bridge, in world units. */
export const RIVER_SURFACE_Y = 1.7

export const arlaPlacement = (): WaterPlacement => ({
  id: 'story-arla',
  kind: 'river',
  styleId: 'river',
  x: RIVER_X,
  y: RIVER_SURFACE_Y,
  z: 0,
  rotY: 0,
  halfX: 0,
  halfZ: 0,
  nodes: arlaNodes()
})
