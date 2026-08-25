import {
  DEFAULT_APPEARANCE,
  EMPTY_LOADOUT,
  type CharacterAppearance,
  type EquipmentLoadout,
  type HairStyle,
  type ItemKind,
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
  gear: 149
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
  return {
    ...DEFAULT_APPEARANCE,
    sex: outfit.sex ?? (hash(n, SALT.sex) % 2 === 0 ? 'male' : 'female'),
    head: pick(HEADS, n, SALT.head),
    hair: pick(hair, n, SALT.hair),
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
