import type { CharacterAppearance, EquipmentLoadout } from '../characters/equipment'
import { DEFAULT_APPEARANCE, EMPTY_LOADOUT } from '../characters/equipment'

/**
 * ─── The cast of Chapter 1 ──────────────────────────────────────────────────
 *
 * Fourteen named people, authored one at a time. That is the opposite of how
 * `npc/` builds a crowd — a crowd NPC is a profession and a seed, and everything
 * about them is derived — and the two are not in competition: `professions.ts`
 * says so itself, that the derived path is "for the hundred who have no names"
 * and the roster is "for the handful who do".
 *
 * These are the handful. Every one of them is spoken of in the manuscript, most
 * of them have lines, and four of them the player will spend the whole chapter
 * looking at from behind while they carry a dead boar.
 *
 * ── The distinguishability problem, stated properly ─────────────────────────
 *
 * `equipment.ts` measures what actually survives distance on this figure: fifty
 * distinct faces at 1.3–2.2 m, about five at 8 m, about three at 20 m — where
 * only eye *spacing* is left. Hair is gone by 40 m. So a cast told apart by face
 * and hair colour is a cast that is told apart in cutscenes and nowhere else,
 * and Chapter 1 is mostly a walk.
 *
 * What survives is **outline**, and outline here has exactly four levers, used
 * in this order of strength:
 *
 *   1. **What they carry.** The largest non-body shape on a chibi. `arlaanArms`
 *      gives the four leads a chain, a disc, a tall arc and — for Athalus — very
 *      nearly nothing, which are four different *kinds* of shape rather than
 *      four sizes of the same one.
 *   2. **Height.** A uniform scale on the group, 0.94 to 1.07. Seven percent
 *      sounds small and is not: standing together, the tallest is a whole
 *      head-height above the shortest, which is the single fastest read in a
 *      group shot and the one the book actually specifies (Athalus is "about six
 *      and a half feet", Jester is "more slightly built", Kareen is "the slower
 *      one").
 *   3. **Garment silhouette.** A robe, a coat, a jerkin and a smock have
 *      different hems; `gear/garments.ts` chose its nine for exactly that spread.
 *   4. **Hair mass and where it breaks the head's hull.** Kareen's falls to her
 *      hips, Theodor's is receding, Gearn's stands up. Three directions.
 *
 * Colour is *fifth*, not first, and is used to reinforce a decision the outline
 * has already made rather than to make one.
 *
 * ── Everything below is from the manuscript ─────────────────────────────────
 *
 * Where the book gives a detail it is used verbatim, including the ones that are
 * inconvenient: Theodor's hair is thinning at nineteen, Kareen dresses like a
 * boy, Gearn's axe is the biggest thing anyone is carrying and he is the fastest
 * of them, Athalus has the weakest kit of the four. Where the book is silent the
 * choice is noted as a choice.
 */

export type CastId =
  // ── The hunting party ─────────────────────────────────────────────────────
  | 'athalus'
  | 'jester'
  | 'gearn'
  | 'kareen'
  // ── Nimmerschein ──────────────────────────────────────────────────────────
  | 'theodor'
  | 'nidane'
  | 'roland'
  | 'lothar'
  | 'gart'
  | 'lara'
  | 'galiana'
  | 'jonas'
  // ── The road ──────────────────────────────────────────────────────────────
  | 'banditLeader'
  | 'bandit'
  // ── Chapter 2, the camp ───────────────────────────────────────────────────
  | 'dorgo'
  | 'jergo'
  // ── The fireside, sixty years later ───────────────────────────────────────
  //
  // The frame story's household. They are a *different time and place* from
  // everyone above — an island, decades after the war — and they are in the same
  // table because they are cast: named people with lines, authored one at a
  // time, which is exactly what this file is for.
  | 'storyteller'
  | 'arthusBoy'
  | 'lenaGirl'
  | 'smithFather'
  | 'motherMara'

export interface CastMember {
  id: CastId
  /**
   * Uniform scale on the character group.
   *
   * **Uniform, never per-axis.** A non-uniform scale does not preserve normals,
   * and every normal in `src/world/` is authored rather than derived (GDD R3) —
   * so a squashed character would be a character whose shading no longer matches
   * its shape, silently, on the one object the player looks at most.
   */
  scale: number
  appearance: CharacterAppearance
  loadout: EquipmentLoadout
  /**
   * One line on what makes this person legible at 20 m, for whoever changes it
   * next. Not player-facing — the dialogue is in `script.ts`.
   */
  read: string
}

const look = (overrides: Partial<CharacterAppearance>): CharacterAppearance => ({
  ...DEFAULT_APPEARANCE,
  ...overrides
})

const kit = (overrides: Partial<EquipmentLoadout>): EquipmentLoadout => ({
  ...EMPTY_LOADOUT,
  ...overrides
})

/** Hair colour indices, named. See `variants.ts::HAIR_COLOURS`. */
const HAIR = {
  darkBrown: 0,
  auburn: 1,
  blond: 2,
  grey: 3,
  white: 4,
  darkBlond: 5
} as const

export const CAST: Record<CastId, CastMember> = {
  // ══════════════════════════════════════════════════════════════════════════
  // The four
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Athalus — eighteen, the smith's son, and the one the boar picks.
   *
   * The book: shoulder-length dark blond hair, blue-green eyes, about six and a
   * half feet, a smith's build — broad shoulders, heavy upper arms, hands too
   * big for fine work. Prays to Athos almost daily. Good with a sword and
   * carrying neither sword nor, by the time we meet him, bow.
   *
   * So he is **the tallest and the broadest and is carrying the least**, and
   * that combination is his read: at any distance he is the big silhouette with
   * nothing on its back. It is also the chapter's whole setup — he is treed by a
   * boar because he threw away the only two things he had.
   */
  athalus: {
    id: 'athalus',
    scale: 1.07,
    appearance: look({
      sex: 'male',
      // "Broad shoulders, heavy upper arms, a muscled chest, big hands with
      // thick fingers — he can barely manage fine work." A smith's son who has
      // been at a hammer since he could lift one. He is the broadest figure in
      // the chapter and the heaviest-limbed, and against Jester's `slight` that
      // is 30 mm of chest outline between two boys the book puts side by side.
      build: 'broad',
      // Square: the heaviest jaw in the four, which is what carries a smith's
      // build on a figure whose shoulders are only 40 mm wider than anyone's.
      head: 'square',
      // Shoulder-length, swept back off the face. The mass breaks the head's
      // hull *backwards*, which is the one direction none of the other three use.
      hair: 'swept',
      beard: 'none',
      brows: 'bushy',
      nose: 'broad',
      eyes: 'sharp',
      mouth: 'neutral',
      skinTone: 2,
      hairColour: HAIR.darkBlond,
      tunicColour: 3,
      gearSeed: 3
    }),
    loadout: kit({
      torso: 'jerkin',
      legs: 'looseTrousers',
      // The hunting kit and nothing else. The bow is on his back for the walk
      // home — his friends picked it up for him after the boar went down.
      back: 'bow',
      mainHand: 'dagger',
      drawn: 'sheathed'
    }),
    read: 'Tallest and broadest; empty hands; the only long dark-blond head in the group.'
  },

  /**
   * Jester — seventeen, adopted at four, and the reason "brother" is not a
   * figure of speech in this book.
   *
   * The book: more slightly built than Athalus because his work in the forge is
   * *grinding* rather than hammering; two six-leaved steel scrantis always on
   * his belt; steadier and more diplomatic than the other three; takes reading
   * lessons from Fernando the state bookkeeper and is bad at them.
   *
   * He is the one who sees the bandits first, and the chapter is careful to note
   * that this is because he was sitting facing the treeline with a bad feeling.
   */
  jester: {
    id: 'jester',
    scale: 0.98,
    appearance: look({
      sex: 'male',
      // "More slightly built than Athalus, because his work in the forge is
      // mostly *grinding*." The book gives the reason as well as the fact, which
      // is unusually generous, so it is taken literally: same trade, same house,
      // same age, different tool — and therefore a different body.
      build: 'slight',
      head: 'oval',
      // Forward over the brow. Reads as the youngest of the four, which he is.
      hair: 'fringe',
      beard: 'none',
      brows: 'fine',
      nose: 'button',
      eyes: 'wide',
      mouth: 'smile',
      skinTone: 1,
      // ── Not dark brown, and this is a *fix* rather than a preference ───────
      //
      // Three of the four leads were authored `darkBrown` — Jester, Gearn and
      // Kareen — and the book only asks for it on Kareen ("long brown hair
      // almost to her hips"). On the other two it was a default nobody chose.
      // Combined with the two changes below it produced a real defect: from
      // behind, which is how the player spends the whole chapter looking at
      // them, Jester was a slight figure in a rough tunic with a bow on his back
      // and brown hair, i.e. **a second Kareen**, and playtesting said exactly
      // that. Auburn is free in this group (Theodor's thinning red is at the
      // gate, never on screen beside them) and the book is silent, so it is
      // taken.
      hairColour: HAIR.auburn,
      tunicColour: 2,
      gearSeed: 1
    }),
    loadout: kit({
      // The grinder's apron, not a rough tunic. Kareen wears the rough tunic and
      // the book gives it to her by implication ("a loose shirt"); it gives
      // Jester a *trade*, and `apronSmock`'s hem is the one garment silhouette
      // in the nine that says workshop. It is also the strongest of the four
      // levers in the header — garment outline — spent on the one pair of
      // figures that needed separating.
      torso: 'apronSmock',
      legs: 'hose',
      // **No bow.** The book gives him two scrantis and no bow; the bow was an
      // invention, and it was the single largest shape on his back — the same
      // shape, in the same place, as the one thing Kareen is defined by. His
      // brain is `ally` (melee) and his `bowDamage` was never read, so this
      // costs the chapter nothing and buys back the whole rear silhouette.
      mainHand: 'scrantis',
      // "Two six-leaved folded scrantis of steel, always on his belt." The third
      // rides on the right hip (`SHEATHED_AT.scrantis = 'hipR'`), opposite the
      // pair. Sheathed rather than drawn: a drawn scrantis takes the sword
      // family's carry pose (`POSE_FAMILY`), and the chapter is mostly four
      // teenagers walking home — a permanent guard would read as a different
      // scene.
      belt: 'scrantisPair',
      drawn: 'sheathed'
    }),
    read: "Slight, in a smith's apron, auburn; chain on the right hip, a folded pair on the left, and nothing on his back."
  },

  /**
   * Gearn — the fastest of them, the funniest, and the one telling this story
   * sixty years later.
   *
   * The book: quickest on his feet, an incorrigible show-off and skirt-chaser, a
   * superb storyteller who does the voices. Weaknesses: drink, and a card game
   * called Gomidon. Carries a two-bladed berserker axe whose head is an ell
   * across with a half-moon notch top and bottom.
   *
   * **He is the frame story's narrator** (§1.3 of the bible), which is why he
   * gets the loudest silhouette in the group: the reader is going to spend three
   * books listening to him, and the axe over his shoulder is how you learn to
   * pick him out on page one.
   */
  gearn: {
    id: 'gearn',
    scale: 1.0,
    appearance: look({
      sex: 'male',
      // The book calls him the quickest of the four and nothing about his build.
      // Average is the honest reading: he is fast because he is not carrying
      // anything, and the axe over his shoulder is doing all the silhouette work
      // he needs.
      build: 'average',
      head: 'round',
      // Up. The third direction, after Athalus's back and Jester's forward.
      hair: 'wild',
      beard: 'none',
      brows: 'fine',
      nose: 'round',
      eyes: 'almond',
      mouth: 'grin',
      skinTone: 1,
      hairColour: HAIR.darkBrown,
      tunicColour: 5,
      // The warmest colourway in the jerkin table. He dresses to be looked at
      // and the book is not subtle about it.
      gearSeed: 5
    }),
    loadout: kit({
      torso: 'jerkin',
      legs: 'rolledTrousers',
      back: 'warAxe',
      drawn: 'sheathed'
    }),
    read: 'A disc of iron standing above one shoulder. Nothing else in the world has that outline.'
  },

  /**
   * Kareen — seventeen, the bowyer's daughter, and the best shot in Nimmerschein
   * after her father.
   *
   * The book: long brown hair almost to her hips, green eyes, slim; **dresses
   * like a boy** — plain trousers and a loose shirt, usually found in the bowyer's
   * shop, which is also the house. Two hours of self-imposed practice a day. She
   * is the one who puts the first arrow into the boar, and hers is the highest
   * kill count of anyone in the manuscript.
   *
   * Note what is *not* here: no dress, no pinafore, nothing that would make her
   * the girl of the group at a glance. That is the book's characterisation and
   * changing it to make her more instantly identifiable would be reading it
   * backwards — her identifier is the bow and the hair, both of which are longer
   * than anyone else's.
   */
  kareen: {
    id: 'kareen',
    scale: 0.94,
    appearance: look({
      sex: 'female',
      // "A slim figure." Stated outright, and it suits an archer whose whole
      // discipline is two hours a day of draw and release rather than lifting.
      build: 'slight',
      head: 'heart',
      // To the hips. The largest hair mass in the cast by a wide margin, and the
      // only one that breaks the *body's* outline rather than the head's.
      hair: 'long',
      beard: 'none',
      brows: 'fine',
      nose: 'button',
      eyes: 'bright',
      mouth: 'smile',
      skinTone: 1,
      hairColour: HAIR.darkBrown,
      tunicColour: 4,
      gearSeed: 4
    }),
    loadout: kit({
      torso: 'roughTunic',
      legs: 'looseTrousers',
      back: 'huntingBow',
      belt: 'quiver',
      drawn: 'sheathed'
    }),
    read: 'A bow taller than she is, hip-length hair, and a quiver on the left hip.'
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Nimmerschein
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Theodor — nineteen, on the gate, and delighted about the pig.
   *
   * The book: tall, **thinning red hair**, trained village militia with a
   * broadsword and a shield, no archer, the weakest fighter of the group and the
   * first to run out of wind. His sister is Lara. He dies in Chapter 18 and
   * Gearn never tells her.
   *
   * `receding` is in the hair table and it is exactly right for a nineteen-year-
   * old who is losing it — which is a strange enough detail for an author to
   * have written down that it is plainly deliberate, so it is kept.
   */
  theodor: {
    id: 'theodor',
    scale: 1.05,
    appearance: look({
      sex: 'male',
      // Tall and militia-trained, and carrying a shield — but with the smallest
      // stamina pool in the cast (`movesets.ts`), because the book says he loses
      // his wind fastest. Broad and unfit is a real shape and it is his.
      build: 'broad',
      head: 'oval',
      hair: 'receding',
      beard: 'cropped',
      brows: 'fine',
      nose: 'hooked',
      eyes: 'bright',
      mouth: 'grin',
      skinTone: 0,
      hairColour: HAIR.auburn,
      tunicColour: 0,
      gearSeed: 0
    }),
    loadout: kit({
      // A tabard is livery, and Theodor is the only person in the chapter
      // standing a watch. It is what tells the player, before he speaks, that
      // the gate is guarded.
      torso: 'tabard',
      legs: 'hose',
      head: 'coif',
      mainHand: 'broadsword',
      offHand: 'shield',
      drawn: 'sheathed'
    }),
    read: 'Livery, a coif, and a shield — the only round board in the village.'
  },

  /**
   * Nidane — Athalus's mother, and the chapter's last word.
   *
   * "Strict to the point of being a fury if you broke one of her rules; had to
   * decide everything; you do not want to know what happened if you disagreed
   * with her in a board game. But a good mother — even if she had an unusual
   * fondness for rat-like pets."
   */
  nidane: {
    id: 'nidane',
    scale: 0.96,
    appearance: look({
      sex: 'female',
      build: 'average',
      head: 'oval',
      hair: 'bun',
      beard: 'none',
      brows: 'bushy',
      nose: 'hooked',
      eyes: 'small',
      mouth: 'neutral',
      skinTone: 1,
      hairColour: HAIR.grey,
      tunicColour: 2,
      gearSeed: 2
    }),
    loadout: kit({ torso: 'pinafore', legs: 'hose' }),
    read: 'A pinafore and a bun, arms folded, standing in a doorway.'
  },

  /**
   * Roland — the village smith, an elder of the council, and Athalus's father.
   *
   * Apprenticed with the dwarves at Draturo and did it in one year instead of
   * two; knows the secret of dwarven steel and the rudiments of gemstone magic.
   * Turned down an invitation to Tri'Idona as a young man. None of that is
   * visible in Chapter 1 and none of it should be — he is a big man in a leather
   * apron who is annoyed that the work is piling up.
   */
  roland: {
    id: 'roland',
    scale: 1.06,
    appearance: look({
      sex: 'male',
      // Athalus's father, and where Athalus's build came from.
      build: 'broad',
      head: 'square',
      hair: 'receding',
      beard: 'patriarch',
      brows: 'bushy',
      nose: 'broad',
      eyes: 'sharp',
      mouth: 'neutral',
      skinTone: 2,
      hairColour: HAIR.grey,
      tunicColour: 3,
      gearSeed: 3
    }),
    loadout: kit({ torso: 'apronSmock', legs: 'looseTrousers' }),
    read: "The biggest man in the village, in a smith's apron, with a beard to his chest."
  },

  /** Lothar — the bowyer. Kareen's father, and the reason her bow is what it is. */
  lothar: {
    id: 'lothar',
    scale: 1.0,
    appearance: look({
      sex: 'male',
      // A bowyer works sitting down with a drawknife.
      build: 'slight',
      head: 'oval',
      hair: 'queue',
      beard: 'goatee',
      brows: 'fine',
      nose: 'hooked',
      eyes: 'small',
      mouth: 'neutral',
      skinTone: 1,
      hairColour: HAIR.grey,
      tunicColour: 4,
      gearSeed: 4
    }),
    loadout: kit({ torso: 'jerkin', legs: 'hose', back: 'huntingBow' }),
    read: 'The other longbow in the village, on an older back.'
  },

  /** Gart — the innkeeper, an elder, father of Gearn and Galiana. */
  gart: {
    id: 'gart',
    scale: 1.02,
    appearance: look({
      sex: 'male',
      // The innkeeper. Gearn in thirty years, which is the joke — so the same
      // face on a heavier frame.
      build: 'broad',
      head: 'round',
      hair: 'bald',
      beard: 'full',
      brows: 'bushy',
      nose: 'round',
      eyes: 'bright',
      mouth: 'grin',
      skinTone: 1,
      hairColour: HAIR.grey,
      tunicColour: 1,
      gearSeed: 1
    }),
    loadout: kit({ torso: 'apronSmock', legs: 'hose' }),
    read: 'Bald, bearded, aproned. Gearn in thirty years, which is the joke.'
  },

  /**
   * Lara — Theodor's sister, and the person Gearn is trying to impress for the
   * whole of Chapter 1 without her being on the page.
   *
   * "Red-haired … he was always boasting about what a beautiful head of curls
   * this young lady had, and how her lovely eyes sparkled when she listened to
   * him."
   */
  lara: {
    id: 'lara',
    scale: 0.95,
    appearance: look({
      sex: 'female',
      build: 'slight',
      head: 'heart',
      hair: 'tresses',
      beard: 'none',
      brows: 'fine',
      nose: 'button',
      eyes: 'bright',
      mouth: 'smile',
      skinTone: 0,
      hairColour: HAIR.auburn,
      tunicColour: 1,
      gearSeed: 1
    }),
    loadout: kit({ torso: 'dress', legs: 'hose' }),
    read: 'The one head of red curls in Nimmerschein.'
  },

  /** Galiana — Gearn's sister. The book gives her a yellow dress and Jester's attention. */
  galiana: {
    id: 'galiana',
    scale: 0.96,
    appearance: look({
      sex: 'female',
      build: 'slight',
      head: 'oval',
      hair: 'braids',
      beard: 'none',
      brows: 'fine',
      nose: 'none',
      eyes: 'wide',
      mouth: 'smile',
      skinTone: 1,
      hairColour: HAIR.blond,
      tunicColour: 5,
      // The yellow one. `gearSeed` is what picks a garment's colourway, and the
      // dress table's warm way is the closest thing this palette has to yellow.
      gearSeed: 5
    }),
    loadout: kit({ torso: 'dress', legs: 'hose' }),
    read: 'The yellow dress, braided. Jester looks at her and says nothing.'
  },

  /**
   * Jonas — the woodcutter, "talks a great deal when the day is long", and drunk
   * enough two nights ago to announce that he watched the King's battalions
   * shell the barrier from the treeline. He is right, and nobody quite believes
   * him.
   */
  jonas: {
    id: 'jonas',
    scale: 1.03,
    appearance: look({
      sex: 'male',
      // A woodcutter, and the second axe in the village.
      build: 'broad',
      head: 'square',
      hair: 'mane',
      beard: 'muttonChops',
      brows: 'bushy',
      nose: 'broad',
      eyes: 'sleepy',
      mouth: 'grin',
      skinTone: 2,
      hairColour: HAIR.darkBrown,
      tunicColour: 3,
      gearSeed: 0
    }),
    loadout: kit({ torso: 'roughTunic', legs: 'rolledTrousers', back: 'warAxe' }),
    read: "A second axe in the village, on a woodcutter — which is what makes Gearn's read as a weapon."
  },

  // ══════════════════════════════════════════════════════════════════════════
  // The road
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * The bandit leader — "a tall man", the one Athalus cannot reach past, and the
   * only one of the five who speaks: *"We underestimated you."*
   *
   * He is a head taller than his men and carries the same short sword, which is
   * how you tell him apart while five figures are running at you: the group is
   * uniform on purpose, and he is the exception in *height* rather than in kit.
   */
  banditLeader: {
    id: 'banditLeader',
    scale: 1.06,
    appearance: look({
      sex: 'male',
      // A head taller than his men and heavier with it — the two cues are
      // stacked deliberately, because in a fight where five figures are
      // deliberately identical the leader has to be readable in one glance.
      build: 'broad',
      head: 'square',
      hair: 'wild',
      beard: 'forked',
      brows: 'bushy',
      nose: 'hooked',
      eyes: 'small',
      mouth: 'neutral',
      skinTone: 3,
      hairColour: HAIR.darkBrown,
      tunicColour: 3,
      gearSeed: 2
    }),
    loadout: kit({
      torso: 'wanderersCoat',
      legs: 'tallBoots',
      head: 'hood',
      mainHand: 'sword',
      drawn: 'mainHand'
    }),
    read: 'A head taller than the other four, hooded, in a road coat.'
  },

  /**
   * The rank and file. **One entry, four figures**, and the sameness is the
   * point: Chapter 1 describes them only as "five dark shapes with daggers and
   * swords", they are never named, two of them are shot before they arrive, and
   * they drag their wounded away and vanish into the thicket.
   *
   * The story director varies their seed so they are not literally one man four
   * times — see `professionAppearance`'s argument for why a seed is enough — but
   * their *outline* is deliberately identical. A group that reads as a wall is
   * more frightening than four individuals, and it is what the prose describes.
   */
  bandit: {
    id: 'bandit',
    scale: 0.99,
    appearance: look({
      sex: 'male',
      // Average, and identical across all four. See the note on this entry: the
      // rank and file are meant to read as a wall.
      build: 'average',
      head: 'round',
      hair: 'coif',
      beard: 'cropped',
      brows: 'bushy',
      nose: 'round',
      eyes: 'small',
      mouth: 'neutral',
      skinTone: 2,
      hairColour: HAIR.darkBrown,
      tunicColour: 3,
      gearSeed: 2
    }),
    loadout: kit({
      torso: 'jerkin',
      legs: 'tallBoots',
      head: 'hood',
      mainHand: 'sword',
      drawn: 'mainHand'
    }),
    read: 'Four of one shape. Hooded, dark, short swords already out.'
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Chapter 2 — the camp
  //
  // Two named bandits, and they exist because Chapter 2 is a *conversation*.
  // Chapter 1's five were a wall on purpose (see the note on `bandit` above);
  // here the same gang sits round a fire and argues, and an argument needs
  // faces you can tell apart while they are talking.
  //
  // Both are built against the leader rather than against each other, because
  // Brutos is the constant in every shot: he is hooded, bearded, broad and a
  // head taller. So the two who talk to him are **bare-headed** — the only
  // uncovered heads in the camp — and then differ from each other on the
  // strongest lever left, which is hair and beard rather than colour.
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * **Dorgo** — the one with the ruined leg.
   *
   * "Ich darf stets nur ein Bein belasten und muss mich mit einem Stock
   * abstützen." The stick is the read the manuscript gives him and it is the one
   * cue this cannot use: there is no staff in `ItemKind`, and adding one to give
   * a man a limp the engine cannot animate would be a prop standing in for a
   * behaviour.
   *
   * So he is read the other way — **the only bald head in the chapter**, under
   * the longest beard in it. Slight, because he has been laid up since the
   * ambush; older-looking than Brutos, which is why he is the one who says the
   * quiet part out loud about greed.
   */
  dorgo: {
    id: 'dorgo',
    scale: 0.97,
    appearance: look({
      sex: 'male',
      build: 'slight',
      head: 'oval',
      hair: 'bald',
      beard: 'patriarch',
      brows: 'bushy',
      nose: 'hooked',
      eyes: 'weary',
      mouth: 'frown',
      skinTone: 2,
      hairColour: HAIR.grey,
      tunicColour: 3,
      gearSeed: 4
    }),
    // A dagger and nothing else. He is not going to be doing any fighting, and
    // an unarmed man in a bandit camp reads as a prisoner.
    loadout: kit({
      torso: 'jerkin',
      legs: 'tallBoots',
      mainHand: 'dagger'
    }),
    read: 'The only bald head in the camp, and the longest beard on it.'
  },

  /**
   * **Jergo** — the one who grew up in Largon and listened to magicians.
   *
   * The chapter's one piece of world-building comes out of his mouth: what a
   * crystal is, what a gemstone is, and why you cannot recharge the one. He is
   * a bandit who reads, and the scene turns on Brutos being surprised by him.
   *
   * So he is the **only beardless face** among them, and the youngest-looking:
   * out of place, which is exactly what the scene says about him.
   */
  jergo: {
    id: 'jergo',
    scale: 0.95,
    appearance: look({
      sex: 'male',
      build: 'slight',
      head: 'round',
      hair: 'short',
      beard: 'none',
      brows: 'fine',
      nose: 'button',
      eyes: 'wide',
      mouth: 'neutral',
      skinTone: 1,
      hairColour: HAIR.darkBrown,
      tunicColour: 2,
      gearSeed: 1
    }),
    loadout: kit({
      torso: 'jerkin',
      legs: 'tallBoots',
      mainHand: 'dagger'
    }),
    read: 'The only shaved face among them, and the only one who looks nervous.'
  },

  // ══════════════════════════════════════════════════════════════════════════
  // The fireside
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * The storyteller — **Gearn, sixty years on**.
   *
   * The story bible settles this outright (§1.3): the old man telling the story
   * is Gearn. Everything about him here is therefore his own row above, aged:
   * the same round head, the same grin, the same skin, the same dark hair gone
   * white. He is heavier than he was — `broad` against Gearn's `average` — which
   * is the one thing sixty peaceful years does to a man who liked drink and
   * cards, and his own father Gart is the joke that set it up.
   *
   * He carries nothing. The axe is long gone, and an old man with a berserker
   * axe in his lap would be a different, much worse scene.
   */
  storyteller: {
    id: 'storyteller',
    // Shorter than Gearn was, by 4 %. People shrink, and standing next to a
    // nine-year-old it is the difference between an old man and a big one.
    scale: 0.96,
    appearance: look({
      sex: 'male',
      head: 'round',
      // The wild hair, thinned and gone back. `receding` on `white` reads as
      // eighty from any distance the frame act is played at.
      hair: 'receding',
      beard: 'patriarch',
      brows: 'bushy',
      nose: 'round',
      eyes: 'almond',
      mouth: 'grin',
      build: 'broad',
      skinTone: 1,
      hairColour: HAIR.white,
      tunicColour: 5,
      gearSeed: 5
    }),
    loadout: kit({ torso: 'mantle', legs: 'hose' }),
    read: 'The only white head and the only beard to the chest. Sitting down, always.'
  },

  /**
   * Arthus — nine, and **the player** for the whole frame act.
   *
   * "His shaggy brown hair hung in his face, but his green eyes were full of
   * anticipation." Named after King Arthus IV rather than the Arthus II of the
   * story, which his father corrects him about at the end of the chapter.
   *
   * Playing him is the frame's whole argument: you are the one asking for the
   * story, and then you are the one in it.
   */
  arthusBoy: {
    id: 'arthusBoy',
    // A nine-year-old against a grown man. 0.68 is roughly the real ratio and it
    // is the single loudest thing in the room — no adult in the cast is near it.
    scale: 0.68,
    appearance: look({
      sex: 'male',
      head: 'round',
      // Shaggy, in his face. The book says so twice.
      hair: 'wild',
      beard: 'none',
      brows: 'fine',
      nose: 'button',
      eyes: 'wide',
      mouth: 'grin',
      build: 'slight',
      skinTone: 1,
      hairColour: HAIR.darkBrown,
      tunicColour: 2,
      gearSeed: 2
    }),
    loadout: kit({ torso: 'roughTunic', legs: 'rolledTrousers' }),
    read: 'Two thirds the height of anyone else in the room, and moving.'
  },

  /** Lena — his sister, younger, and the one who is sent to fetch their mother. */
  lenaGirl: {
    id: 'lenaGirl',
    scale: 0.62,
    appearance: look({
      sex: 'female',
      head: 'heart',
      hair: 'plaits',
      beard: 'none',
      brows: 'fine',
      nose: 'button',
      eyes: 'bright',
      mouth: 'smile',
      build: 'slight',
      skinTone: 1,
      hairColour: HAIR.blond,
      tunicColour: 5,
      gearSeed: 5
    }),
    loadout: kit({ torso: 'dress', legs: 'hose' }),
    read: 'Smaller than Arthus and the only plaits on the island.'
  },

  /**
   * The father: a broad-shouldered smith who comes in with a hammer in his right
   * hand and puts it straight into the chest.
   *
   * He has just finished an engraved dagger for the count, which is why he has
   * days free — and which is the detail that dates the frame: the war is over,
   * and the best work a village smith gets now is decorative.
   */
  smithFather: {
    id: 'smithFather',
    scale: 1.06,
    appearance: look({
      sex: 'male',
      head: 'square',
      hair: 'short',
      beard: 'full',
      brows: 'bushy',
      nose: 'broad',
      eyes: 'sharp',
      mouth: 'neutral',
      build: 'broad',
      skinTone: 2,
      hairColour: HAIR.darkBrown,
      tunicColour: 3,
      gearSeed: 3
    }),
    loadout: kit({ torso: 'apronSmock', legs: 'looseTrousers' }),
    read: "The biggest figure on the island, in a smith's apron. Roland's echo, deliberately."
  },

  /** The mother, who arrives last carrying a full pail of water in each hand. */
  motherMara: {
    id: 'motherMara',
    scale: 0.97,
    appearance: look({
      sex: 'female',
      head: 'oval',
      hair: 'bun',
      beard: 'none',
      brows: 'fine',
      nose: 'button',
      eyes: 'bright',
      mouth: 'smile',
      build: 'average',
      skinTone: 1,
      hairColour: HAIR.auburn,
      tunicColour: 4,
      gearSeed: 4
    }),
    loadout: kit({ torso: 'apronSmock', legs: 'hose' }),
    read: 'An apron and a bun, walking up the road with both hands full.'
  }
}

export const CAST_IDS = Object.keys(CAST) as CastId[]

/**
 * The frame story's household — the people at the fireside, sixty years after
 * everything else in this file.
 *
 * Kept as its own list so the director can place, park and switch the two casts
 * without knowing which is which: they are 1.7 km apart and never share a frame.
 */
export const FIRESIDE: readonly CastId[] = ['storyteller', 'arthusBoy', 'lenaGirl', 'smithFather', 'motherMara']

/** The four the chapter follows. Order is the order they are introduced. */
export const PARTY: readonly CastId[] = ['athalus', 'jester', 'gearn', 'kareen']

export const isCastId = (value: unknown): value is CastId =>
  typeof value === 'string' && value in CAST
