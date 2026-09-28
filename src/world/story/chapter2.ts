import { CAMP_MARKS, CAMP_TRACK, CAMP_WATCH } from './camp'
import type { Beat } from './chapter1'

/**
 * ─── Chapter 2 as a sequence of beats ───────────────────────────────────────
 *
 * *Brutos.* Same shape as Chapter 1 — a flat, ordered list, played from the top
 * — and the reasoning in `chapter1.ts` for why it is a list rather than a graph
 * applies unchanged. What is different is who you are and what you do.
 *
 * ── You play the villain, and the manuscript does not ───────────────────────
 *
 * Chapter 2 has no protagonist in it. It is four men in a wood arguing about
 * gold, and the reader watches. That is a perfectly good chapter and it is not a
 * playable one, so this adaptation makes the one change it needs: for the length
 * of the chapter **the player is Brutos**.
 *
 * `Beat.player` already carries that — it is the same field that makes you nine
 * years old for Chapter 1's frame act, and nothing else about a beat changes.
 * The camera, the intent struct and the director are the same ones.
 *
 * ── What the player actually does ───────────────────────────────────────────
 *
 * Not much, and that is the design. There is no fight in this chapter and there
 * should not be one — inventing a brawl to give the villain something to do
 * would be the adaptation writing a scene the book does not contain. What the
 * player does is *cross the camp*: to Dorgo to be complained at, to Jergo to be
 * surprised by him, out to the pacing mark to think, back to hand over the purse,
 * and finally out to the treeline to look at Nimmerschein.
 *
 * That last walk is the point of playing it at all. Chapter 1 ends with the
 * party safe inside the gate; Chapter 2 ends with the player standing in the
 * trees looking at that gate, having just given the order. Reading it is not the
 * same as being made to walk there.
 */
export const CHAPTER_TWO: readonly Beat[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // The camp — a few hours after the ambush, the same evening
  // ══════════════════════════════════════════════════════════════════════════
  {
    // Opens on the narrator's card over a camp the player has never seen, then
    // hands them a body. The card is doing real work: it is the only thing that
    // tells the player they are somewhere else, as somebody else, and it is
    // Gearn's voice sixty years later — he is still the one telling this.
    id: 'b2-camp',
    kind: 'dialogue',
    player: 'banditLeader',
    script: 'banditsCamp',
    objective: 'banditsCamp',
    // -- The chapter is at night, and that is a fact about the story ---------
    //
    // "A few hours after the ambush, the same evening." Chapter 1 ends at 0.785,
    // dusk, with Nidane in a doorway; this opens well past it. Snapped, like
    // every cut in this story -- and this one is also the only place in either
    // chapter where the **moon** is the light. Four men round a fire arguing
    // about gold is a scene lit by the fire and by nothing else, and the
    // difference between that and the same scene at noon is the whole reason
    // the sky is worth driving from a beat list.
    time: 0.9
  },
  {
    // Across the fire to Jergo. A `travel` beat rather than another dialogue,
    // because the scene needs the player to have *moved* before the chapter's
    // one piece of world-building arrives — otherwise the crystal lore is a wall
    // of text delivered from a standing start.
    id: 'b2-gold',
    kind: 'travel',
    script: 'banditsGold',
    objective: 'banditsGold',
    overTalk: true,
    at: { x: CAMP_MARKS.jergo.x + 1.6, z: CAMP_MARKS.jergo.z + 1.4, radius: 2.2 }
  },
  {
    id: 'b2-jergo',
    kind: 'dialogue',
    script: 'banditsJergo',
    objective: 'banditsJergo'
  },
  {
    // "Brutos ging unruhig im Kreis herum und dachte angestrengt nach." The
    // pacing is in the book and it is the one moment the chapter gives its
    // villain an interior life, so it is a beat the player performs rather than
    // a line they read.
    id: 'b2-pace',
    kind: 'travel',
    objective: 'banditsPace',
    at: { x: CAMP_MARKS.pacing.x, z: CAMP_MARKS.pacing.z, radius: 1.8 }
  },
  {
    id: 'b2-plan',
    kind: 'dialogue',
    script: 'banditsPlan',
    objective: 'banditsPlan'
  },
  {
    // The purse. An `interact` beat, so the order is something the player hands
    // over rather than something they watch being handed over — the chapter's
    // single decisive act, and the only one it has.
    id: 'b2-purse',
    kind: 'interact',
    script: 'banditsOrders',
    objective: 'banditsPurse',
    at: { x: CAMP_MARKS.dorgo.x, z: CAMP_MARKS.dorgo.z, radius: 2.4 },
    sets: ['ordersGiven']
  },
  {
    // Dorgo goes. He walks rather than rides — see the note on horses in
    // `camp.ts` — and the beat exists so the player watches him leave, which is
    // what makes the seven hired men feel like a thing that is now coming.
    id: 'b2-ride',
    kind: 'travel',
    objective: 'banditsRide',
    at: { x: CAMP_TRACK.x + 4, z: CAMP_TRACK.z + 3, radius: 3 },
    // Dorgo walks off down the track and the night gets older behind him. Ten
    // seconds, which at this hour is almost entirely the moon climbing -- the
    // sun is nowhere and the shadow pass is off (see `NIGHT_SHADOW_CUTOFF`), so
    // what actually moves on screen is the moon and the sky's own darkening.
    time: 0.94,
    timeBlend: 10
  },
  {
    // Out to the treeline, and the chapter's last image: Nimmerschein's west
    // gate, seen from the wood, by the man who has just put a price on the four
    // children behind it.
    id: 'b2-positions',
    kind: 'travel',
    script: 'banditsPositions',
    objective: 'banditsPositions',
    overTalk: true,
    at: { x: CAMP_WATCH.x, z: CAMP_WATCH.z, radius: 4 },
    // The last image: the west gate seen from the wood, in the small hours, by
    // the man who has just put a price on the four children behind it. The moon
    // is high and behind the player here, which puts the village in the only
    // light there is.
    time: 0.97,
    timeBlend: 10,
    sets: ['chapterTwoComplete']
  }
]
