import {
  DEFAULT_APPEARANCE,
  EMPTY_LOADOUT,
  type BeardStyle,
  type BrowStyle,
  type CharacterAppearance,
  type EquipmentLoadout,
  type HairStyle,
  type ItemKind,
  type NoseStyle,
  type Sex,
  type SkinTone
} from './equipment'
import { GEAR_SEED_SPACE } from './gear'
import { HAIR_COLOURS, SKIN_TONES, TUNIC_COLOURS } from './variants'
import type { EyeStyle, MouthStyle } from './face'

/**
 * ─── Who the people in a town are ───────────────────────────────────────────
 *
 * `gear/` builds nine torso garments, four leg garments, six hats and five
 * weapons, each in five or six colourways. That is the vocabulary. This is the
 * sentence: eighteen named roles a level designer can place, each of which reads
 * as a *person with a job* at twenty metres.
 *
 * ── Why a table and not a saved character ───────────────────────────────────
 *
 * A city wants a hundred NPCs and none of them is worth authoring by hand. The
 * roster in `roster.ts` is for the handful who have names — a quest giver, the
 * player — and it stores a full appearance blob each. A crowd cannot work that
 * way: a hundred blobs is a hundred things to keep migrating as the unions grow,
 * and it makes "another guard" a copy-paste rather than a click.
 *
 * So a crowd NPC is **two numbers**: a profession and a seed. Everything else —
 * hair, face, skin, build, which colourway of the tabard, whether they are
 * carrying anything — is *derived*, deterministically, from those two. That
 * makes a spawn 30 bytes on disk, makes "a different farmer" a matter of
 * incrementing an integer, and makes the whole crowd reproducible: the same
 * level file yields the same town on every machine, which a `Math.random()` at
 * spawn time would not.
 *
 * ── What varies and what does not ───────────────────────────────────────────
 *
 * The **outfit is fixed** by the profession, because that is the whole point of
 * one: a guard whose tabard varied would stop being a guard. What varies with
 * the seed is the *person wearing it* — face, hair, skin, build — plus the
 * garment's colourway **within the set this role is allowed**, which is what
 * keeps eight guards from being one guard eight times without turning any of
 * them into a mage.
 */

export type Profession =
  | 'judge'
  | 'mayor'
  | 'knight'
  | 'townGuard'
  | 'recruit'
  | 'mage'
  | 'mageApprentice'
  | 'hunter'
  | 'farmer'
  | 'fisher'
  | 'mineWorker'
  | 'harbourWorker'
  | 'dayWorker'
  | 'weaver'
  | 'tavernOwner'
  | 'shopOwner'
  | 'housewife'
  | 'maid'
  // ── From out of town ──────────────────────────────────────────────────────
  //
  // The eighteen above are a *town*: every one of them has a trade and a house
  // in it. These two do not, and they are the reason `gear/wanderer.ts` exists —
  // a road coat and a pair of tall boots are not a tradesman's kit, and a
  // stranger who reads as one is a stranger nobody notices arriving.
  | 'wanderer'
  | 'ranger'

export interface ProfessionOutfit {
  /** Palette label. The editor is a dev tool, so this stays untranslated. */
  label: string
  torso: ItemKind | null
  legs: ItemKind | null
  head: ItemKind | null
  mainHand: ItemKind | null
  offHand: ItemKind | null
  back: ItemKind | null
  /**
   * The colourways this role reads as, as indices into the garment's own table.
   *
   * Not "any of them". `ROBE_WAYS` holds a judge's forest-and-gold at 0 and a
   * mage's woad at 1, so a judge free to roll its own seed is a judge who is
   * sometimes a mage. Listing more than one is what stops eight guards being one
   * guard eight times.
   */
  seeds: readonly number[]
  /**
   * Forced where the role names it — a housewife, a maid — and null where it
   * does not, in which case the seed decides. Set it only when the *word* is
   * gendered, not from an assumption about who does the job: a town guard, a
   * farmer and a mage are all `null` here on purpose.
   */
  sex: Sex | null
  /** Hair styles that suit the role. Empty means "any of them". */
  hair?: readonly HairStyle[]
  /**
   * Beards that suit the role, on the roles where facial hair is part of the
   * costume rather than part of the person.
   *
   * Absent — the normal case — means the seed rolls freely over `NPC_BEARDS`,
   * gated by sex. Present means this role *is* its beard: a wanderer with a
   * three-day stubble is a different character from a wanderer with a beard to
   * his sternum, and only one of them is the one being placed.
   */
  beard?: readonly BeardStyle[]
}

/**
 * ── The eighteen ────────────────────────────────────────────────────────────
 *
 * Read as a spread rather than a list: three that carry authority (robe, mantle,
 * plate), three under arms, four in cloth that has been worked in, and the rest
 * in what a town actually wears. Every one of them differs from its nearest
 * neighbour in at least **two** of silhouette, headwear and dye — one is not
 * enough at the distance a crowd is read at.
 */
export const PROFESSIONS: Record<Profession, ProfessionOutfit> = {
  // ── Authority ────────────────────────────────────────────────────────────
  judge: {
    label: 'Judge',
    torso: 'robe',
    legs: 'hose',
    head: 'officialCap',
    mainHand: null,
    offHand: null,
    back: null,
    // Forest wool with gold at the collar. `ROBE_WAYS[0]`, authored for exactly
    // this — and deliberately alone, because the alternatives are a mage and a
    // priest.
    seeds: [0],
    sex: null,
    hair: ['receding', 'short', 'bun', 'coif']
  },
  mayor: {
    label: 'Mayor',
    torso: 'mantle',
    legs: 'hose',
    head: 'officialCap',
    mainHand: null,
    offHand: null,
    back: null,
    seeds: [1, 3],
    sex: null,
    hair: ['receding', 'short', 'bun', 'bearded']
  },
  knight: {
    label: 'Knight',
    torso: 'torsoArmour',
    legs: 'plateLegs',
    head: 'helmet',
    mainHand: 'sword',
    offHand: 'shield',
    back: null,
    // Plate has no cloth table; the seed still moves the leg harness and the
    // helmet's trim, which is the difference between two knights in a line.
    seeds: [0, 1, 2, 3],
    sex: null
  },

  // ── Under arms ───────────────────────────────────────────────────────────
  townGuard: {
    label: 'Town guard',
    torso: 'tabard',
    legs: 'hose',
    head: 'helmet',
    mainHand: 'sword',
    offHand: null,
    back: null,
    // A town's livery is one or two dyes, not five. Two, so a gate with four
    // guards on it is not four identical men.
    seeds: [0, 2],
    sex: null
  },
  recruit: {
    label: 'Recruit',
    torso: 'jerkin',
    legs: 'hose',
    head: 'coif',
    mainHand: 'sword',
    offHand: null,
    back: null,
    seeds: [1, 3, 4],
    sex: null,
    hair: ['short', 'bowl', 'wild', 'ponytail']
  },
  hunter: {
    label: 'Hunter',
    torso: 'jerkin',
    legs: 'looseTrousers',
    head: 'hood',
    mainHand: null,
    offHand: null,
    back: 'bow',
    seeds: [0, 2],
    sex: null,
    hair: ['ponytail', 'queue', 'wild', 'bearded']
  },

  // ── The two who read as magic ────────────────────────────────────────────
  mage: {
    label: 'Mage',
    torso: 'robe',
    legs: 'hose',
    head: 'hood',
    mainHand: null,
    offHand: null,
    back: null,
    // `ROBE_WAYS[1]` is the woad the wardrobe sheet calls the mage.
    seeds: [1],
    sex: null,
    hair: ['long', 'bearded', 'mane', 'bun']
  },
  mageApprentice: {
    label: 'Mage apprentice',
    torso: 'hoodedRobe',
    legs: 'hose',
    head: null,
    mainHand: null,
    offHand: null,
    back: null,
    seeds: [1, 2, 4],
    sex: null,
    hair: ['bowl', 'short', 'braids', 'ponytail']
  },

  // ── Worked-in cloth ──────────────────────────────────────────────────────
  farmer: {
    label: 'Farmer',
    torso: 'roughTunic',
    legs: 'rolledTrousers',
    head: 'hat',
    mainHand: null,
    offHand: null,
    back: null,
    seeds: [0, 3, 5],
    sex: null
  },
  fisher: {
    label: 'Fisher',
    torso: 'roughTunic',
    legs: 'rolledTrousers',
    head: 'flatCap',
    mainHand: null,
    offHand: null,
    back: null,
    seeds: [1, 4],
    sex: null
  },
  mineWorker: {
    label: 'Mine worker',
    torso: 'roughTunic',
    legs: 'looseTrousers',
    head: 'coif',
    mainHand: null,
    offHand: null,
    back: null,
    seeds: [2, 5],
    sex: null,
    hair: ['short', 'wild', 'bald', 'bearded']
  },
  harbourWorker: {
    label: 'Harbour worker',
    torso: 'roughTunic',
    legs: 'rolledTrousers',
    head: null,
    mainHand: null,
    offHand: null,
    back: null,
    seeds: [2, 3],
    sex: null,
    hair: ['short', 'queue', 'bald', 'wild']
  },
  dayWorker: {
    label: 'Day worker',
    torso: 'roughTunic',
    legs: 'looseTrousers',
    head: null,
    mainHand: null,
    offHand: null,
    back: null,
    seeds: [0, 1, 4],
    sex: null
  },

  // ── Trade ────────────────────────────────────────────────────────────────
  weaver: {
    label: 'Weaver',
    torso: 'apronSmock',
    legs: 'hose',
    head: null,
    mainHand: null,
    offHand: null,
    back: null,
    seeds: [1, 4],
    sex: null,
    hair: ['bun', 'plaits', 'short']
  },
  tavernOwner: {
    label: 'Tavern owner',
    torso: 'apronSmock',
    legs: 'looseTrousers',
    head: 'flatCap',
    mainHand: null,
    offHand: null,
    back: null,
    seeds: [0, 2, 5],
    sex: null,
    hair: ['bearded', 'receding', 'bun', 'short']
  },
  shopOwner: {
    label: 'Shop owner',
    torso: 'jerkin',
    legs: 'hose',
    head: 'flatCap',
    mainHand: null,
    offHand: null,
    back: null,
    seeds: [0, 2],
    sex: null
  },

  // ── Household ────────────────────────────────────────────────────────────
  housewife: {
    label: 'Housewife',
    torso: 'dress',
    legs: null,
    head: null,
    mainHand: null,
    offHand: null,
    back: null,
    seeds: [0, 1, 3, 5],
    sex: 'female',
    hair: ['bun', 'plaits', 'braids', 'long']
  },
  maid: {
    label: 'Maid',
    torso: 'pinafore',
    legs: null,
    head: 'coif',
    mainHand: null,
    offHand: null,
    back: null,
    seeds: [0, 2, 4],
    sex: 'female',
    hair: ['braids', 'plaits', 'bun', 'ponytail']
  },

  // ── From out of town ──────────────────────────────────────────────────────
  wanderer: {
    label: 'Wanderer',
    torso: 'wanderersCoat',
    legs: 'tallBoots',
    head: null,
    mainHand: null,
    offHand: null,
    // A greatsword on the back, and it is what makes the silhouette read at
    // 20 m: nobody else in the eighteen carries anything across their shoulders,
    // so the diagonal above the shoulder line is unique before the coat is.
    back: 'greatsword',
    // Grey wool and brass. `COAT_WAYS[1]` and `BOOT_WAYS[1]` are the pair this
    // role was designed around; 3 is the undyed journeyman's, which is the same
    // person a season later.
    seeds: [1, 3],
    sex: null,
    // Unkempt, or long, or tied back on the road. Never a coif and never a
    // fashionable cut: this is somebody who has not been near a barber.
    hair: ['wild', 'mane', 'long', 'swept', 'queue', 'receding'],
    // The role *is* its beard. Three long ones and nothing shorter — a
    // clean-shaven wanderer in a road coat is a merchant.
    beard: ['patriarch', 'forked', 'braided', 'full']
  },
  ranger: {
    label: 'Ranger',
    torso: 'wanderersCoat',
    legs: 'tallBoots',
    head: 'hood',
    mainHand: null,
    offHand: null,
    back: 'bow',
    // Forest and undyed — the two ways in the coat's table that are not grey,
    // which is the whole difference between this role and the one above it at
    // any distance where the bow and the greatsword are one dark diagonal.
    seeds: [0, 2],
    sex: null,
    hair: ['queue', 'ponytail', 'short', 'swept', 'braids'],
    beard: ['cropped', 'goatee', 'none', 'muttonChops']
  }
}

export const PROFESSION_IDS = Object.keys(PROFESSIONS) as Profession[]

/**
 * `hasOwnProperty`, not `in`.
 *
 * `in` walks the prototype chain, so `'constructor'`, `'toString'` and
 * `'__proto__'` all answered yes — and a stored spawn with
 * `profession: 'constructor'` would then pass sanitisation and hand
 * `PROFESSIONS['constructor']` to the crowd, which is `Object` and has no
 * `torso`. Caught by the test, not by reading it.
 */
export const isProfession = (value: unknown): value is Profession =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROFESSIONS, value)

/**
 * ─── Deriving a person from two numbers ─────────────────────────────────────
 *
 * A 32-bit integer hash, not `Math.random()`, and that is the whole point: the
 * same level file has to produce the same town on every machine and after every
 * reload, or a designer who places a crowd and comes back tomorrow finds
 * different people standing in it.
 *
 * `Math.imul` keeps the multiply in 32 bits — plain `*` on numbers this size
 * loses the low bits to the float mantissa, and the low bits are the ones being
 * used.
 */
const hash = (a: number, b: number): number => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13) ^ b, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** A stable index into a list from a seed and a salt. Never negative, never NaN. */
const pick = <T>(list: readonly T[], seed: number, salt: number): T =>
  list[hash(seed, salt) % list.length]!

/** Which slot each salt belongs to. Distinct so two fields never move together. */
const SALT = {
  sex: 11,
  head: 23,
  hair: 37,
  hairColour: 53,
  eyes: 71,
  mouth: 89,
  skin: 103,
  tunic: 127,
  gear: 149,
  // Four more, and they are prime and distinct for the reason the eight above
  // are: two fields that share a salt move together, so every farmer with a
  // square head would also have the same nose.
  beard: 163,
  beardRoll: 181,
  brows: 197,
  nose: 211
} as const

const HEADS = ['round', 'oval', 'square', 'heart'] as const
const EYES: readonly EyeStyle[] = ['bright', 'wide', 'close', 'tall', 'small', 'almond', 'sleepy', 'sharp', 'soft', 'weary']
const MOUTHS: readonly MouthStyle[] = ['smile', 'neutral', 'frown', 'grin', 'open']
/**
 * Every hairstyle, for the roles that do not name their own.
 *
 * Written out rather than imported from the creator screen: this is the
 * three.js side and `CreatorScene` drags a renderer in behind it. The test
 * asserts the two lists agree, so a style added to one and not the other is a
 * failure rather than a haircut no NPC can have.
 */
export const NPC_HAIR: readonly HairStyle[] = [
  'bowl',
  'short',
  'ponytail',
  'braids',
  'long',
  'bald',
  'topknot',
  'buns',
  'bun',
  'plaits',
  'flowing',
  'queue',
  'bob',
  'tresses',
  'wild',
  'swept',
  'fringe',
  'bearded',
  'mane',
  'coif',
  'receding'
]

/**
 * Every beard, for the roles that do not name their own.
 *
 * Written out here rather than imported from `features.ts`'s `BEARD_STYLES` for
 * the reason `NPC_HAIR` is written out rather than imported from
 * `CreatorScene`: this list is a *casting* decision and that one is the union.
 * They happen to agree today and `npc.test.ts` asserts they do, so a style added
 * to the union and forgotten here is a failing test rather than a beard nobody
 * in the world can grow.
 */
export const NPC_BEARDS: readonly BeardStyle[] = [
  'none',
  'moustache',
  'goatee',
  'cropped',
  'muttonChops',
  'full',
  'forked',
  'braided',
  'patriarch'
]

/** Noses, likewise. `none` is in it: a face without one is a face this world draws. */
export const NPC_NOSES: readonly NoseStyle[] = ['none', 'button', 'round', 'hooked', 'broad']

const NPC_BROWS: readonly BrowStyle[] = ['fine', 'bushy']

/**
 * How often a crowd NPC who *may* have a beard has one.
 *
 * ── Two in five, and neither extreme is a town ──────────────────────────────
 *
 * A flat roll over the nine styles leaves one person in nine clean-shaven, which
 * is a town where every man has a beard and only one of them shaves. Rolling
 * `'none'` at its natural weight *and* keeping the eight others is the same
 * thing. So the decision is split in two — whether at all, then which — exactly
 * as `CreatorScene.randomAppearance` splits it, and for the same reason.
 *
 * 0.4 rather than 0.5 because a beard is 60–190 triangles and a crowd pays for
 * it per head: at 0.4, a hundred townspeople cost about 5 500 triangles of
 * facial hair, which is under 6 % of the crowd and buys the single largest
 * silhouette difference available between two people in the same costume.
 */
const BEARD_RATE = 0.4
/** Out of the hash's 32-bit range, so the comparison is integer. */
const BEARD_THRESHOLD = BEARD_RATE * 0x100000000

/**
 * Which beard, given the role and the seed.
 *
 * **Two paths, and a role that names its own beards does not take the rate.**
 * `BEARD_RATE` exists to keep an *unnamed* crowd from being a town where
 * everybody has a beard; a role that lists its own has already made that
 * decision, and applying the rate on top of it silently overrides the list —
 * which is what shipped first, and which gave the wanderer at seed 0 a bare
 * chin under a road coat. A role that wants some of its people clean-shaven puts
 * `'none'` in its own list, as the ranger does.
 *
 * The sex gate is applied by the caller and is *not* overridable, because it is
 * about the silhouette rather than about the costume — see the note there.
 */
const rolledBeard = (outfit: ProfessionOutfit, n: number): BeardStyle => {
  if (outfit.beard && outfit.beard.length > 0) {
    return pick(outfit.beard, n, SALT.beard)
  }
  if (hash(n, SALT.beardRoll) >= BEARD_THRESHOLD) {
    return 'none'
  }
  return pick(GROWABLE_BEARDS, n, SALT.beard)
}

/** `NPC_BEARDS` without `'none'`, so the two-step roll cannot land on it twice. */
const GROWABLE_BEARDS: readonly BeardStyle[] = NPC_BEARDS.filter(style => style !== 'none')

/**
 * The face, hair, build and colouring of one NPC.
 *
 * Deterministic in `(profession, seed)`. The outfit is *not* here — that is
 * `professionLoadout` — except for `gearSeed`, which is, because it is a fact
 * about the person's clothes rather than about which clothes they are.
 */
export const professionAppearance = (profession: Profession, seed: number): CharacterAppearance => {
  const outfit = PROFESSIONS[profession]
  const n = Math.floor(seed)
  const hair = outfit.hair && outfit.hair.length > 0 ? outfit.hair : NPC_HAIR
  const sex = outfit.sex ?? (hash(n, SALT.sex) % 2 === 0 ? 'male' : 'female')
  return {
    ...DEFAULT_APPEARANCE,
    sex,
    head: pick(HEADS, n, SALT.head),
    hair: pick(hair, n, SALT.hair),
    // ── Facial hair ─────────────────────────────────────────────────────────
    //
    // Gated on sex and rolled in two steps. The gate is not a statement about
    // who may have a beard — it is that this figure is read at 20 m and its
    // *silhouette* is all that survives, so a beard is one of the two or three
    // cues the crowd has for a build it otherwise cannot show (see `BUILDS`,
    // which is three numbers and no triangles). A role that names its own
    // beards overrides the roll but not the gate.
    beard: sex === 'female' ? 'none' : rolledBeard(outfit, n),
    // Ungated, both of them. A heavy brow and a nose are not a build cue and
    // they are what stop a hundred faces being one face at conversation range,
    // which is where a player actually talks to somebody.
    brows: pick(NPC_BROWS, n, SALT.brows),
    nose: pick(NPC_NOSES, n, SALT.nose),
    eyes: pick(EYES, n, SALT.eyes),
    mouth: pick(MOUTHS, n, SALT.mouth),
    skinTone: (hash(n, SALT.skin) % SKIN_TONES.length) as SkinTone,
    hairColour: hash(n, SALT.hairColour) % HAIR_COLOURS.length,
    tunicColour: hash(n, SALT.tunic) % TUNIC_COLOURS.length,
    // From the role's own allowed set, never the full space — see `seeds`.
    gearSeed: outfit.seeds[hash(n, SALT.gear) % outfit.seeds.length]! % GEAR_SEED_SPACE
  }
}

/** What they are wearing and carrying. Fixed by the role, not by the seed. */
export const professionLoadout = (profession: Profession): EquipmentLoadout => {
  const outfit = PROFESSIONS[profession]
  return {
    ...EMPTY_LOADOUT,
    torso: outfit.torso,
    legs: outfit.legs,
    head: outfit.head,
    mainHand: outfit.mainHand,
    offHand: outfit.offHand,
    back: outfit.back,
    // Sheathed, always. A town square where everyone stands with a drawn sword
    // is a battle, not a town — and drawing is an *animation*, so a spawn that
    // started drawn would pop into the guard pose on its first frame.
    drawn: 'sheathed'
  }
}
