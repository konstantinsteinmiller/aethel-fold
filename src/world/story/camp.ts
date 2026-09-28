import type { Placement } from '../level/types'

/**
 * ─── The bandits' camp ──────────────────────────────────────────────────────
 *
 * Chapter 2 happens *"nicht weit von Nimmerschein entfernt"* and the manuscript
 * says nothing else about the place. What it does say is what has to be in it:
 * horses stamping impatiently, food to be split between men, a fire they are
 * sitting around, and a leader with room to pace in a circle while he thinks.
 *
 * ── Sited off the road, between the ambush and the west gate ────────────────
 *
 * Not arbitrary. Brutos's plan is to watch **both gates** until the children
 * come out, so the camp has to be near enough to Nimmerschein to run a watch on
 * it and far enough into the wood that a farmer on the road never finds it.
 * `AMBUSH` is where they were beaten a few hours ago at x = -64; the camp is
 * 40 m north of the road and a little further out, which is the distance a group
 * with two wounded men would actually have managed.
 *
 * ── Built from the village kit, with nothing new ────────────────────────────
 *
 * A camp is a fire, things to sit on, and stolen goods stacked where they can be
 * loaded quickly. Every one of those already exists as a placeable: `village-
 * firepit`, `tree-log` and `tree-stump` to sit on, `village-crates` and
 * `village-barrel` for the loot, a `village-cart` to put it on, and a
 * `village-staverack` for the weapons.
 *
 * There are **no horses**, and their absence is deliberate rather than lazy: the
 * manuscript has them stamping, Dorgo is *lifted* onto one, and he rides out at
 * the end of the chapter. A horse is a rigged, animated quadruped — the boar is
 * the only one in the project and it took a creature module of its own. A
 * stationary horse-shaped prop standing where a horse should walk away is worse
 * than a cart and a tether post, so the chapter is staged around the cart, and
 * Dorgo leaves down the track on foot with the camera behind him.
 *
 * That is a real departure from the page and it is the only one in the chapter's
 * staging. It is written here rather than hidden because the day somebody builds
 * a horse, this comment is the list of what to put back.
 */

/**
 * Centre of the camp clearing, in world space.
 *
 * ── Sited on two measurements, not on taste ────────────────────────────────
 *
 * **Flatness.** Twelve props stand on this ground and five people stand on
 * marks between them, so relief across the clearing shows up immediately as
 * barrels at angles and a fire on a slope. Sampled across an 18 m disc at eight
 * candidate sites, this one has **1.47 m** of relief against 4.4–5.4 m
 * everywhere else nearby — it is the one genuinely flat clearing in this wood.
 *
 * **Distance from Nimmerschein.** The first site was 85 m out, which put the
 * village's own hand-placed props in frame for most of the chapter: measured on
 * the perf panel, `level` alone was **55 draw calls of 219**, against a scene
 * budget of 180 for everything (GDD §5.2). At 118 m the village is past the
 * point where its buildings hold a tier that costs anything.
 *
 * It is still "nicht weit von Nimmerschein" — a quarter of an hour's walk — and
 * still east of the Arla (`RIVER_X`), which matters: they ambushed the party on
 * the road on this side of the river a few hours ago and did not cross it
 * dragging two wounded men.
 */
export const CAMP = { x: -74, z: -92 }

/** Where the fire is, and therefore what every mark below is measured from. */
export const CAMP_FIRE = { x: CAMP.x, z: CAMP.z }

/**
 * The track out of the camp toward the Drachenschinder road.
 *
 * Dorgo rides for it at the end of the chapter and Brutos's men take it to the
 * far gate, so it is the one direction the clearing is deliberately open in.
 */
export const CAMP_TRACK = { x: CAMP.x - 15, z: CAMP.z - 9 }

/**
 * Where Brutos's watch post is: the treeline looking back at the west gate.
 *
 * The chapter ends by walking to it, which is the beat that turns a conversation
 * into a threat — the last thing the player does as Brutos is stand in the trees
 * and look at the village they spent Chapter 1 defending.
 */
export const CAMP_WATCH = { x: -52, z: -19 }

/**
 * Marks the cast stand on. Keyed rather than positional, so a beat reads.
 *
 * ── Laid out around the camera, not around the fire ─────────────────────────
 *
 * The obvious arrangement is the one the manuscript describes: men *sitting* on
 * the log and the stumps round the fire. It was built that way first and it does
 * not work, for a reason that is nothing to do with taste — **there is no seated
 * pose**. `placeFireside` has the same limitation and gets away with it because
 * the frame act's household stands at a table. Here the seats are separate
 * props, so a figure on a seat's mark stands *inside* it, and the dialogue
 * camera — which places itself two metres behind the listener — then places
 * itself inside a fallen log. Measured: Dorgo's first mark was 0.81 m from the
 * log's centre and the opening shot of the chapter was the inside of it.
 *
 * So the seats stay where a camp's seats go and the **people stand in the gaps
 * between them**, on three bearings 130 degrees apart with nothing behind them
 * out to six metres. That is the corridor the camera needs, and every mark and
 * corridor here is checked against every prop in `campPlacements`.
 *
 * It also reads better than it sounds: men who have just been beaten and are
 * arguing about it are on their feet.
 */
export const CAMP_MARKS = {
  /** Brutos, north of the fire, with the open side of the clearing behind him. */
  brutos: { x: CAMP.x + 0.89, z: CAMP.z + 2.44, facing: Math.PI },
  /** Dorgo, south-west, the fallen log he got up from a couple of paces behind. */
  dorgo: { x: CAMP.x - 2.44, z: CAMP.z - 0.89, facing: Math.PI * 0.39 },
  /** Jergo, south-east, half out of the firelight until he is asked. */
  jergo: { x: CAMP.x + 1.3, z: CAMP.z - 2.25, facing: Math.PI * 1.83 },
  /** The two silent men, out by the cart with the food. */
  banditA: { x: CAMP.x + 5.2, z: CAMP.z - 3.38, facing: Math.PI * 1.3 },
  banditB: { x: CAMP.x + 4.45, z: CAMP.z - 4.6, facing: Math.PI * 1.25 },
  /** Where Brutos paces to while he thinks. Clear of everything, by design. */
  pacing: { x: CAMP.x - 0.93, z: CAMP.z + 3.48, facing: Math.PI * 1.15 },
  /** Dorgo's mark once he has his orders and has started down the track. */
  dorgoLeaving: { x: CAMP_TRACK.x + 2.5, z: CAMP_TRACK.z + 1.5, facing: Math.PI * 1.2 }
} as const

let counter = 0
const place = (defId: string, x: number, z: number, rotY = 0, scale = 1): Placement => ({
  id: `camp-${++counter}`,
  defId,
  x: CAMP.x + x,
  y: 0,
  z: CAMP.z + z,
  rotY,
  scale
})

/**
 * Everything standing in the camp.
 *
 * ── The ring is deliberately incomplete ─────────────────────────────────────
 *
 * Seats round three sides of the fire and nothing on the fourth. That gap is
 * where the player arrives from and where the camera lives for most of the
 * chapter, and a closed ring would put a log through every over-the-shoulder in
 * the scene. It also reads correctly: men who expect to leave in a hurry do not
 * box themselves in.
 */
export const campPlacements = (): Placement[] => {
  counter = 0
  const out: Placement[] = []

  // ── The fire, and the seats round it ─────────────────────────────────────
  //
  // Pushed out to 3.4–4.2 m rather than ringing the fire tightly, because the
  // people stand *inside* that ring — see the note on `CAMP_MARKS`. Every one of
  // these is at a bearing that misses all three speakers' camera corridors.
  out.push(place('village-firepit', 0, 0))
  // Dorgo's log, long side to the fire so it reads as a bench.
  out.push(place('tree-log', -3.57, 1.3, Math.PI * 0.42))
  out.push(place('tree-stump', 2.94, 1.7, 0.4, 1.05))
  out.push(place('tree-stump', -1.23, -3.38, 1.9, 0.95))
  out.push(place('tree-stump-notched', -3.22, 2.7, 2.6))

  // ── The loot, stacked to be loaded ───────────────────────────────────────
  //
  // One corner rather than scattered: these are men who moved camp this morning
  // and expect to move it again before the week is out.
  out.push(place('village-cart', 6.89, -1.22, Math.PI * 0.42))
  out.push(place('village-crates', 5.78, 0.51, 0.7))
  out.push(place('village-crates', 7.14, -2.6, 2.2, 0.9))
  out.push(place('village-barrel', 7.15, 1.92, 0))
  out.push(place('village-barrel', 7.42, 3.0, 0.9, 0.92))
  out.push(place('village-staverack', 3.98, 3.34, Math.PI * 0.1))
  out.push(place('village-logpile', -3.2, 5.54, Math.PI * 0.6))

  // ── No hand-placed treeline ──────────────────────────────────────────────
  //
  // There was one: ten oaks and six thickets ringing the clearing, to close it
  // in. It cost **73 draw calls in the `level` tag** against a scene budget of
  // 180 for everything, because a hand-placed prop is batched per `defId` per
  // 48 m cell and those sixteen were three oak species and a thicket the
  // *scatter* is already drawing, densely, in this exact wood — the same
  // silhouettes, paid for twice, once instanced and once not.
  //
  // So the clearing is closed by the scatter instead, and the only thing this
  // file does about it is ask for a hole: `StoryScene` clears scatter within
  // 8.5 m of `CAMP`, which is the seating ring plus a pace. Everything from
  // there out is procedural wood at no extra cost, and it varies with the seed
  // rather than being the same ten trees every time.
  return out
}
