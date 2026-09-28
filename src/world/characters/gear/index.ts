import type { ItemKind, SkinTone } from '../equipment'
import {
  buildBroadsword,
  buildDagger,
  buildHuntingBow,
  buildQuiver,
  buildScrantis,
  buildScrantisPair,
  buildWarAxe
} from './arlaanArms'
import { buildBow } from './bow'
import { buildCrossbow } from './crossbow'
import type { GearModel } from './gearKit'
import { buildGreatsword } from './greatsword'
import { buildHat } from './hat'
import { buildShield } from './shield'
import { buildSword } from './sword'
import { buildTorsoArmour } from './torsoArmour'
import {
  buildApronSmock,
  buildDress,
  buildHoodedRobe,
  buildJerkin,
  buildMantle,
  buildPinafore,
  buildRobe,
  buildRoughTunic,
  buildTabard
} from './garments'
import { buildCoif, buildFlatCap, buildHelmet, buildHood, buildOfficialCap } from './headwear'
import { buildTallBoots, buildWanderersCoat } from './wanderer'
import { buildHose, buildLooseTrousers, buildPlateLegs, buildRolledTrousers } from './legGarments'

/**
 * ─── Equipment models: the frame every item is authored in ──────────────────
 *
 * Seven procedural props, one per `ItemKind` in `equipment.ts`, each inside its
 * budget from `EQUIPMENT_BUDGET`. They are **parented, not skinned** — a sword
 * has no business deforming — so an item costs one draw call, no per-frame CPU,
 * and no extra shader program.
 *
 * ── THE CONVENTION ──────────────────────────────────────────────────────────
 *
 * Set by `ITEM_FORWARD_AXIS` in `equipment.ts`, which these models implement.
 * All seven share one object-space frame, and that is the whole point: the
 * socket table is six rotations, and it can only stay six rotations if "cant by
 * 0.55 rad about Z" means the same thing to every item that hangs there.
 *
 *   1. **The grip is the origin.** `(0, 0, 0)` is the point that coincides with
 *      the socket — the middle of the fist on a sword's grip, the middle of the
 *      shield's grip bar, the middle of the bow's riser, the `headTop` socket
 *      for the hat, the hips joint for the armour. `GearModel.grip` returns it
 *      anyway, so the attachment layer never has to *trust* this paragraph.
 *   2. **−Y runs along the item, away from the hand — point-down.** The sword's
 *      and greatsword's tip, the crossbow's nose (and the direction its bolt
 *      flies), the shield's point. The bow is gripped in its middle and is
 *      symmetric about it, so it has no end to hang down.
 *   3. **+Z is the item's front** where it has one: the shield's boss, the
 *      bow's back (the face toward the target), a blade's leading edge.
 *   4. **±Z is the broad axis of the three items that hang from a frozen,
 *      Z-canted socket** — the sword's and greatsword's guard, the crossbow's
 *      prod, the bow's riser-to-string depth — so their portrait view is from
 *      −X. The shield is the exception and is broad on ±X, because its front is
 *      unambiguous and clause 3 outranks clause 4 when the two can't both hold.
 *
 * ── The two items that are worn rather than held ────────────────────────────
 *
 * The hat and the torso armour are not gripped, so clause 2 does not apply to
 * them: both are authored **+Y up in the body's own frame**, because their
 * anchor is a bone and their fit is measured against the body's geometry.
 *
 *   * **The hat's origin is `SOCKETS.headTop`, which is the head's *centre* at
 *     y = 1.29 — not the crown at 1.56.** It is authored around that origin
 *     deliberately: the centre is the point `face.ts` casts from, and a hat's
 *     inner crown has to be built against the head's *built* 9-gon surface.
 *     See `hat.ts` for the measurement.
 *   * The armour's origin is the hips joint, `rig.ts`'s y = 0.62.
 *
 * ── Where the convention still costs the animation layer something ──────────
 *
 * Recorded here rather than absorbed into the models, because absorbing it
 * would make one item's frame a lie:
 *
 *   * **The shield and the bow need different wrist rolls.** Both hang off
 *     `SOCKETS.handL`. The bow's grip runs along its ±Y; the shield's grip bar
 *     runs along its ±X, because a shield's enarme bar lies *across* the forearm
 *     and a bow's riser lies along it. That is anatomy, not a convention error.
 *   * **Aiming the crossbow is two rotations, not one.** Its bolt flies −Y and
 *     its prod spans ±Z, so pitching it forward puts the prod vertical and it
 *     needs a roll about its own axis afterwards. Authoring the prod on ±X would
 *     save that roll and cost the shared `backOver` socket it uses with the
 *     greatsword: that socket cants 0.55 rad **about Z**, which leaves ±Z in the
 *     cant's plane and swings ±X out of it.
 *
 * ── Costs ───────────────────────────────────────────────────────────────────
 *
 * Shape is authored; `seed` only varies albedo (see `finishGear`), so a party of
 * four carrying "the same" sword does not carry four identical vertex buffers'
 * worth of the same highlight. Every model ships a single tier: unlike a world
 * prop these are never at 200 m — the LOD ladder in GDD §4.1 exists for things
 * that recede, and a held item does not.
 */

export type { GearModel } from './gearKit'
export {
  buildBroadsword,
  buildDagger,
  buildHuntingBow,
  buildQuiver,
  buildScrantis,
  buildScrantisPair,
  buildWarAxe
} from './arlaanArms'
export { buildBow } from './bow'
export { buildCrossbow } from './crossbow'
export { buildGreatsword } from './greatsword'
export { buildHat, hatHeadClearance } from './hat'
export { buildShield } from './shield'
export { buildSword } from './sword'
export { buildTorsoArmour, torsoArmourMargin } from './torsoArmour'
export {
  buildApronSmock,
  buildDress,
  buildHoodedRobe,
  buildJerkin,
  buildMantle,
  buildPinafore,
  buildRobe,
  buildRoughTunic,
  buildTabard
} from './garments'
export { buildCoif, buildFlatCap, buildHelmet, buildHood, buildOfficialCap } from './headwear'
export { buildTallBoots, buildWanderersCoat, WANDERER_BUDGET, WANDERER_WAYS } from './wanderer'
/**
 * ── The leg garments, which are not in `GEAR_BUILDERS` yet ──────────────────
 *
 * Re-exported so they are reachable, and **absent from the table below**, which
 * is not an oversight: `GEAR_BUILDERS` is `Record<ItemKind, …>` and no `ItemKind`
 * maps to the `legs` slot yet. Adding one is four rows in `equipment.ts` per
 * kind — `ItemKind`, `ITEM_SLOT` (→ `'legs'`), `STOW_SOCKET`/`DRAWN_SOCKET`
 * (both `null`, as for every body slot) and `EQUIPMENT_BUDGET` — and the numbers
 * to copy are in `legGarments.ts::LEG_GARMENT_BUDGET`. Until they land,
 * `chibiGeometry`'s `slotBudget('legs')` is 0 and a leg garment is charged
 * against the body's own ceiling, which it overruns loudly in dev.
 */
export {
  buildHose,
  buildLooseTrousers,
  buildPlateLegs,
  buildRolledTrousers,
  LEG_GARMENT_BUDGET,
  LEG_GARMENT_BUILDERS,
  legGarmentMargin,
  type LegGarmentKind
} from './legGarments'

/**
 * What a builder may be told about the person who is going to wear the thing.
 *
 * Two fields, and they are not symmetric. **`seed` varies the item**: which of a
 * garment's five or six authored colourways it is cut from, and the albedo
 * jitter `finishGear` applies. **`skinTone` varies the *body showing through*
 * it** — only `rolledTrousers` has any, and only because a rolled cuff leaves a
 * bare calf. A builder that ignores `skinTone` is the normal case, not an
 * omission.
 */
export interface GearOptions {
  seed?: number
  skinTone?: SkinTone
}

export type GearBuilder = (options?: GearOptions) => GearModel

/**
 * Every item kind's generator, keyed the way `equipment.ts` keys everything
 * else. Exhaustive by type: adding an `ItemKind` without a model is a compile
 * error rather than an empty hand at runtime.
 */
export const GEAR_BUILDERS: Record<ItemKind, GearBuilder> = {
  sword: buildSword,
  greatsword: buildGreatsword,
  bow: buildBow,
  crossbow: buildCrossbow,
  // ── The arms of Arlaan ────────────────────────────────────────────────────
  //
  // Six rows and nothing else — which is the whole payoff of this table being
  // exhaustive by type. Adding a weapon is a row in `ItemKind`, four rows in the
  // socket and budget tables, and this. Forgetting any of them is a compile
  // error rather than a character walking around holding a grey billet.
  scrantis: buildScrantis,
  scrantisPair: buildScrantisPair,
  warAxe: buildWarAxe,
  huntingBow: buildHuntingBow,
  broadsword: buildBroadsword,
  dagger: buildDagger,
  quiver: buildQuiver,
  shield: buildShield,
  hat: buildHat,
  torsoArmour: buildTorsoArmour,
  // ── The profession wardrobe ───────────────────────────────────────────────
  robe: buildRobe,
  hoodedRobe: buildHoodedRobe,
  tabard: buildTabard,
  apronSmock: buildApronSmock,
  dress: buildDress,
  pinafore: buildPinafore,
  jerkin: buildJerkin,
  roughTunic: buildRoughTunic,
  mantle: buildMantle,
  wanderersCoat: buildWanderersCoat,
  coif: buildCoif,
  hood: buildHood,
  flatCap: buildFlatCap,
  officialCap: buildOfficialCap,
  helmet: buildHelmet,
  hose: buildHose,
  looseTrousers: buildLooseTrousers,
  plateLegs: buildPlateLegs,
  rolledTrousers: buildRolledTrousers,
  tallBoots: buildTallBoots
}

/**
 * The kinds whose geometry actually depends on the wearer's skin.
 *
 * Exactly one, and it is a list rather than a `try it and see` because the cache
 * key below is built from it: including `skinTone` for every kind would give a
 * sword five identical copies per seed, which is five times the vertex buffers
 * for no visible difference. `legGarments.ts` explains why the rolled cuff is
 * the exception — the calf below it is bare, so it is painted from the body.
 *
 * A second such kind is one row here and nothing else.
 */
const SKIN_DEPENDENT: ReadonlySet<ItemKind> = new Set<ItemKind>(['rolledTrousers'])

/**
 * Cached models, keyed by kind, seed, and — for the one kind it changes —
 * skin tone.
 *
 * Generation is a few milliseconds per item and the result is immutable, so the
 * attachment layer can ask for a model per character without the cost being per
 * character: a hundred villagers in the same colourway of the same jerkin share
 * one vertex buffer, and they only stop sharing when they actually look
 * different.
 *
 * The seed is folded into the cache key **already reduced**, because the
 * builders reduce it modulo their own colourway table anyway: without this,
 * `seed = 7` and `seed = 12` would be two entries holding two identical robes.
 * `WAY_COUNT` is the widest table in the folder, so the fold is lossless.
 */
const cache = new Map<string, GearModel>()

/**
 * The number of distinct colourways to keep per kind.
 *
 * **Six**, because six is the largest authored table in the folder — `SMOCK`,
 * `DRESS`, `TUNIC` and `HOSE` all have six; everything else has four or five.
 * Folding smaller would make two seeds collide that the builder would have
 * separated; folding larger caches duplicates. Asserted against every table in
 * `professionGear.test.ts`, so growing a table without raising this is a test
 * failure rather than a colourway nobody can reach.
 */
export const GEAR_SEED_SPACE = 6

export const gearModel = (kind: ItemKind, seed = 1, skinTone: SkinTone = 1): GearModel => {
  const folded = ((Math.round(seed) % GEAR_SEED_SPACE) + GEAR_SEED_SPACE) % GEAR_SEED_SPACE
  const key = SKIN_DEPENDENT.has(kind) ? `${kind}:${folded}:${skinTone}` : `${kind}:${folded}`
  const existing = cache.get(key)
  if (existing) {
    return existing
  }
  const model = GEAR_BUILDERS[kind]({ seed: folded, skinTone })
  cache.set(key, model)
  return model
}
