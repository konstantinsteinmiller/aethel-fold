import type { EyeStyle, MouthStyle } from './face'
import type { BoneName } from './rig'

/**
 * ─── Character appearance and equipment: the contract ───────────────────────
 *
 * Every part of the customisation and equipment feature is written against this
 * file: the body builder that varies head, hair and build; the prop generators
 * that make the weapons; the attachment layer that hangs them off bones; the
 * animation that carries and draws them; and the creation screen that edits it
 * all. It is defined here, once, so none of the five has to know anything about
 * the other four.
 *
 * ── Two facts about the rig that everything here depends on ─────────────────
 *
 * 1. **The character faces +Z.** (`face.ts` places the face down +Z, and
 *    `Character.measureMotion` derives facing the same way.)
 * 2. **+X is the character's LEFT.** `shoulder.L` sits at x = +0.09 in the bind
 *    pose, `shoulder.R` at −0.09.
 *
 * Together those mean the character's **right hip is at negative X**, which is
 * the opposite of the reflex when reading a socket table. Getting it backwards
 * puts every sword on the wrong side of every character, and it does so
 * symmetrically enough that it looks deliberate. Sockets below are therefore
 * commented with the side they land on rather than only with their numbers.
 */

// ─── Appearance ─────────────────────────────────────────────────────────────

export type Sex = 'male' | 'female'

/**
 * Head shapes. The head is a third of the silhouette, so this is the single
 * strongest customisation lever — far stronger than any facial feature at this
 * scale, because at 20 m the outline is all that survives.
 */
export type HeadShape = 'round' | 'oval' | 'square' | 'heart'

/**
 * Hair. Named by silhouette rather than by style, because that is what actually
 * distinguishes them at a distance: a "bob" and a "bowl" differ by 3 cm of
 * outline and read as the same character across a field.
 *
 * Twenty-one of them, because the world wants a city of 100+ people who do not
 * look alike, and hair is the second-strongest lever after head shape. They are
 * chosen for **outline separation** rather than for hairdressing variety — which
 * direction the mass breaks the head's convex hull (up, back, out, forward,
 * down), how far, and whether it is symmetric. `variants.ts` carries the
 * per-style geometry and the argument for each; read that before adding a
 * twenty-second.
 */
export type HairStyle =
  | 'bowl'
  | 'short'
  | 'ponytail'
  | 'braids'
  | 'long'
  | 'bald'
  | 'topknot'
  | 'buns'
  | 'bun'
  | 'plaits'
  | 'flowing'
  | 'queue'
  | 'bob'
  | 'tresses'
  | 'wild'
  | 'swept'
  | 'fringe'
  | 'bearded'
  | 'mane'
  | 'coif'
  | 'receding'

/**
 * Facial hair, as its own axis.
 *
 * **Not a `HairStyle`.** `HairStyle` already has a `bearded` entry and it works,
 * but it is *one* axis: a character could have a beard or a haircut and never
 * both, which makes "grey mane plus a beard to the sternum" — an entirely
 * ordinary person — inexpressible. Splitting it is the fix, and it is free for
 * everything that already exists because `'none'` is the default and emits
 * nothing.
 *
 * Eight shapes plus none, spread by which direction they break the outline
 * rather than by barbering. `features.ts` carries the table and the argument for
 * each; read that before adding a ninth.
 */
export type BeardStyle =
  | 'none'
  | 'moustache'
  | 'goatee'
  | 'cropped'
  | 'muttonChops'
  | 'full'
  | 'forked'
  | 'braided'
  | 'patriarch'

/**
 * Whether the brow is the face's own decal or a ridge standing off the
 * forehead.
 *
 * Two values and no range, which is the honest count: `face.ts` already derives
 * a brow per eye style and varies its tilt, its width and its height, so the
 * intermediate settings of a "brow weight" slider all already ship. What is
 * missing is the one thing a decal cannot be — *thick* — and thickness on this
 * figure is a bit, not a dial. See `features.ts`.
 */
export type BrowStyle = 'fine' | 'bushy'

/**
 * The nose, which this face has never had.
 *
 * `'none'` is the shipped figure and stays the default: at three heads tall with
 * a toon ramp, a face made of two dark shapes and a mouth is a legitimate and
 * deliberate look, and every character authored before this existed is that
 * face. The four shapes are for the ones that want a profile.
 */
export type NoseStyle = 'none' | 'button' | 'round' | 'hooked' | 'broad'

/** Index into the palette's `skinTone0..4` ramp. */
export type SkinTone = 0 | 1 | 2 | 3 | 4

export interface CharacterAppearance {
  sex: Sex
  head: HeadShape
  hair: HairStyle
  /**
   * Facial hair, independent of the haircut above it.
   *
   * The three fields below it are the *volume* half of the face — beard, brow
   * ridge, nose — against `eyes` and `mouth`, which are the decal half. They are
   * separate axes because they are separately true of a person, and because
   * every one of them defaults to the value that emits no geometry: an
   * appearance blob written before they existed deserialises to exactly the
   * figure it drew.
   */
  beard: BeardStyle
  brows: BrowStyle
  nose: NoseStyle
  /**
   * Ten eyes and five mouths — 50 faces, all at **identical topology** (38
   * triangles, 50 vertices, every combination). That is structural, not a budget
   * dodge: `chibiGeometry` appends the face last and three suites locate it as
   * `position.count − FACE_VERTICES`, so a style with its own vertex count would
   * hand those tests the wrong block.
   *
   * They carry the close-up, not the distance. Measured at true pixel size: 50
   * distinct faces at 1.3–2.2 m, ~5 at 8 m, ~3 at 20 m where only eye *spacing*
   * survives. Hair, head shape and colour are what separate a crowd across a
   * square.
   */
  eyes: EyeStyle
  mouth: MouthStyle
  skinTone: SkinTone
  /** Index into `HAIR_COLOURS`. Kept separate from skin so they vary freely. */
  hairColour: number
  /** Index into `TUNIC_COLOURS`, for the default (unarmoured) torso. */
  tunicColour: number
  /**
   * Which colourway this character's *clothing* is cut from.
   *
   * Every builder in `gear/` already takes a `seed` and every garment already
   * carries a table of five or six colourways — a judge's forest robe, a mage's
   * woad one, a priest's madder one, all from `buildRobe`. Nothing was passing a
   * seed, so all of it collapsed to index 1 and a hundred robed NPCs wore one
   * robe. This is the field that was missing.
   *
   * It belongs in the *appearance* rather than in the loadout because it is not
   * a property of the item — a robe is a robe — it is a property of the person
   * wearing it, it has to survive changing what they wear, and it has to be
   * saved with them. `gearSeed` and `tunicColour` are deliberately separate:
   * `tunicColour` is the bare torso, `gearSeed` is what a garment does *instead*.
   *
   * Any integer. The builders reduce it modulo their own table, so the usable
   * space is however many colourways that garment has, and callers never have to
   * know which.
   */
  gearSeed: number
}

export const DEFAULT_APPEARANCE: CharacterAppearance = {
  sex: 'male',
  head: 'round',
  hair: 'bowl',
  // The three absent values. Any other default would repaint every character
  // that has ever been saved, and `characterVariants.test.ts` hashes the shipped
  // figure — so this is enforced rather than intended.
  beard: 'none',
  brows: 'fine',
  nose: 'none',
  eyes: 'bright',
  mouth: 'smile',
  skinTone: 1,
  hairColour: 0,
  tunicColour: 0,
  // 1, not 0: every builder's own default is `seed = 1`, so the figure a caller
  // gets from `DEFAULT_APPEARANCE` is the one every wardrobe sheet and every
  // existing test was authored against.
  gearSeed: 1
}

// ─── Equipment ──────────────────────────────────────────────────────────────

/**
 * What a piece of equipment *is*. Distinct from where it currently sits — a
 * sword is a `sword` whether it is on the hip or in the hand, and conflating the
 * two is what produces a state machine with a case per (item × location).
 */
export type ItemKind =
  | 'sword'
  | 'greatsword'
  | 'bow'
  | 'crossbow'
  // ── Profession wardrobe ───────────────────────────────────────────────────
  //
  // Nine torso garments and six head items, chosen for **silhouette spread**
  // rather than one per profession — eighteen near-identical tubes would read as
  // one costume in eighteen dyes. A profession is a garment × dye × hair × hat,
  // and the garments are the axis that survives distance.
  //
  // Every torso garment replaces the body's torso (`ITEM_SLOT` → `'torso'`), so
  // it costs its wearer **zero draw calls and zero programs**. Head items do
  // not — see the note on `EQUIPMENT_BUDGET`.
  | 'shield'
  | 'hat'
  | 'torsoArmour'
  | 'robe'
  | 'hoodedRobe'
  | 'tabard'
  | 'apronSmock'
  | 'dress'
  | 'pinafore'
  | 'jerkin'
  | 'roughTunic'
  | 'mantle'
  // ── The road kit ──────────────────────────────────────────────────────────
  //
  // Two items rather than a family, and they go together: everything above is a
  // *townsperson's*, because that is what the eighteen professions asked for.
  // Somebody who arrives from somewhere else needs a coat that is not a
  // tradesman's and a boot that is not a shoe. See `gear/wanderer.ts`.
  | 'wanderersCoat'
  | 'coif'
  | 'hood'
  | 'flatCap'
  | 'officialCap'
  | 'helmet'
  // ── Legs ──────────────────────────────────────────────────────────────────
  //
  // Four, not five: a padded chausse was costed and cut. The width window is
  // bounded below by the leg it replaces (≥182 mm outboard or rays pass through
  // the crotch) and above by the midline (~218 mm), so a padded leg lands 11 mm
  // off the loose trouser — 0.2 px at 20 m. It is a dye of it instead.
  | 'hose'
  | 'looseTrousers'
  | 'plateLegs'
  | 'rolledTrousers'
  | 'tallBoots'

/**
 * Where an item lives on the character when it is **not** in use.
 *
 * A slot is a *role*, not a socket. The stow socket for a role is fixed
 * (`STOW_SOCKET`), which is what lets the animation layer ask "is anything on
 * the back" without enumerating item kinds.
 */
export type EquipSlot = 'mainHand' | 'offHand' | 'back' | 'head' | 'torso' | 'legs'

export const EQUIP_SLOTS: readonly EquipSlot[] = ['mainHand', 'offHand', 'back', 'head', 'torso', 'legs']

/**
 * The two slots whose item is **not** worn on the body but *is* the body.
 *
 * A torso garment replaces the chibi's torso part and a leg garment replaces its
 * thighs and shins — they are rebuilt into the merged skinned mesh rather than
 * parented to a bone, which is why both cost their wearer zero draw calls and
 * zero programs, and why neither has a socket. Anything in this set must be
 * closed at both ends and must overlap its neighbours: once the body part is
 * gone, a gap is a hole straight through the character.
 */
export const BODY_SLOTS: readonly EquipSlot[] = ['torso', 'legs']

/** Which slots an item kind is allowed to occupy. */
export const ITEM_SLOT: Record<ItemKind, EquipSlot> = {
  sword: 'mainHand',
  greatsword: 'back',
  bow: 'back',
  crossbow: 'back',
  shield: 'offHand',
  hat: 'head',
  torsoArmour: 'torso',
  robe: 'torso',
  hoodedRobe: 'torso',
  tabard: 'torso',
  apronSmock: 'torso',
  dress: 'torso',
  pinafore: 'torso',
  jerkin: 'torso',
  roughTunic: 'torso',
  mantle: 'torso',
  wanderersCoat: 'torso',
  coif: 'head',
  hood: 'head',
  flatCap: 'head',
  officialCap: 'head',
  helmet: 'head',
  hose: 'legs',
  looseTrousers: 'legs',
  plateLegs: 'legs',
  rolledTrousers: 'legs',
  tallBoots: 'legs'
}

/**
 * Drawn state of the weapons.
 *
 * **One enum for the whole character, not a boolean per slot.** A character
 * cannot hold a greatsword and a bow at once, and modelling it per slot invites
 * exactly that: two independent booleans have four states, two of which are
 * nonsense and both of which are reachable. This has only the states that exist.
 */
export type DrawnState = 'sheathed' | 'mainHand' | 'twoHand' | 'bow' | 'crossbow'

export interface EquipmentLoadout {
  mainHand: ItemKind | null
  offHand: ItemKind | null
  back: ItemKind | null
  head: ItemKind | null
  torso: ItemKind | null
  legs: ItemKind | null
  drawn: DrawnState
}

export const EMPTY_LOADOUT: EquipmentLoadout = {
  mainHand: null,
  offHand: null,
  back: null,
  head: null,
  torso: null,
  legs: null,
  drawn: 'sheathed'
}

// ─── Sockets ────────────────────────────────────────────────────────────────

/**
 * An attachment point: a bone plus a fixed offset in that bone's space.
 *
 * Items are **parented to a bone and offset**, never skinned. A sword has no
 * business deforming, and skinning it would put it through the same joint blend
 * the body uses — so the tip would lag the hilt every time the wrist turned.
 * Parenting also means an item costs one draw call and no per-frame CPU: the
 * bone matrix the skeleton already computes carries it for free.
 */
export interface Socket {
  bone: BoneName
  /** Metres, in the bone's local space. */
  position: readonly [number, number, number]
  /** Euler XYZ in radians, applied in that order. */
  rotation: readonly [number, number, number]
}

/**
 * ─── The model axis convention, which is not optional ───────────────────────
 *
 * **Every held item is authored with its grip at the origin and its length
 * running along −Y**, i.e. point-down, and its "front" facing +Z.
 *
 * This was left unstated in the first pass and the two sides promptly
 * disagreed: the gear models authored +Y as the tip, and measured against these
 * sockets a sheathed sword spanned 0.528–1.031 m — standing up the ribcage
 * (hips are at 0.62, shoulders at 1.02) instead of hanging down the thigh, with
 * the greatsword's hilt landing at the small of the back.
 *
 * The rotations below are the ones that read correctly for −Y, and the reason
 * the *models* move rather than the sockets is asymmetry of cost: the hand
 * sockets are **animated**, so a carry pose absorbs a tip-down default for
 * free, while `hipR` / `backOver` / `backFlat` are frozen numbers that several
 * agents build against and nobody may quietly retune.
 */
export const ITEM_FORWARD_AXIS = 'minusY' as const

export type SocketName =
  | 'handR'
  | 'handL'
  | 'hipR'
  | 'backOver'
  | 'backFlat'
  | 'headTop'

/**
 * The socket table.
 *
 * Numbers are offsets from the **bone head** in bind pose (see `rig.ts`), so
 * they are small and readable rather than absolute world positions that would
 * silently rot if the rig's proportions changed.
 */
export const SOCKETS: Record<SocketName, Socket> = {
  /** Grip in the right fist. The hand bone is the last in the arm chain, so a
   *  held item hangs from it with no further joint between it and the world. */
  handR: { bone: 'hand.R', position: [0, -0.02, 0.03], rotation: [0, 0, 0] },
  handL: { bone: 'hand.L', position: [0, -0.02, 0.03], rotation: [0, 0, 0] },
  /**
   * Sheathed one-hander, on the character's **right** hip — which is −X.
   *
   * ── The hilt has to stand clear of the body, and it is measured ────────────
   *
   * The first numbers here (`[-0.13, -0.02, -0.05]`, cant −0.35 about Z) buried
   * the grip and the pommel *inside* the hip. Measured, by skinning the body and
   * taking the signed distance from every one of the sword's 134 vertices to the
   * body surface across 97 sampled poses (bind, idle, walk, run at three banks,
   * jump): the deepest sword vertex sat **46.7 mm inside** the male figure and
   * **51.5 mm inside** the female one, and in both cases the deepest vertex was
   * in the hilt. Only a sliver of the guard was ever outside the tunic.
   *
   * Three things were wrong with it and they pull against each other:
   *
   *   * **The Z cant of −0.35 leans the *hilt inboard*.** With the blade at −Y a
   *     negative cant swings the tip outboard of the thigh — which is what it is
   *     for — and by the same rotation it swings the pommel 46 mm *toward the
   *     belly*. At the old socket the pommel's axis sat at x = −0.084 against a
   *     torso 127 mm wide at the hips (147 mm on the female build): fully inside.
   *   * **Halving the cant alone puts the blade through the thigh**, because the
   *     tip then hangs at the socket's own x and `thigh.R` reaches x = −0.175.
   *   * **Pushing the socket outboard alone runs into the arm.** The right hand
   *     swings through x ≈ −0.30 with a 43 mm palm (a 55 mm mitten, when this was
   *     measured — the hand is narrower, so the clearance held), so past −0.20 the
   *     pommel starts catching the forearm at the top of a stride.
   *
   * So the outboard offset carries what the cant used to, and the numbers below
   * are the best point in that window rather than a preference: searched over
   * 324 combinations of offset and cant, scored on both builds across the same
   * 97 poses. The worst signed clearance of the **whole sword** — hilt included,
   * and the hilt is what sets it — is **+8.3 mm (male) / +9.1 mm (female)**,
   * against −46.7 / −51.5 before. `tests/world/combatPoses.test.ts` asserts it.
   *
   * The blade did not pay for it: the tip's world x now spans −0.296…−0.229
   * where it used to span −0.322…−0.254, so it hangs *closer* to the thigh than
   * before while the pommel stands 56 mm further out (x = −0.199, was −0.143).
   * The +0.02 of Z is the belt hanging the scabbard slightly forward of the hip
   * joint, which is where a belt hangs one.
   */
  hipR: { bone: 'hips', position: [-0.185, 0, 0.02], rotation: [0.15, 0, -0.17] },
  /**
   * Slung across the back, canted. For a greatsword and a crossbow — anything
   * whose mass wants to sit diagonally so it does not read as a plank.
   */
  backOver: { bone: 'chest', position: [0, 0.06, -0.12], rotation: [0.1, 0, 0.55] },
  /**
   * Flat against the back, near-vertical. For a bow, which is a thin arc and
   * reads best hugging the spine rather than cutting across it.
   */
  backFlat: { bone: 'chest', position: [0.04, 0.04, -0.13], rotation: [0.05, 0, 0.12] },
  /**
   * Hats. **This is the centre of the head volume (y ≈ 1.29), not the crown**
   * (y ≈ 1.56) — an earlier comment here said "crown" and was wrong.
   *
   * The centre is the right anchor precisely because it is the point `face.ts`
   * casts its rays *from*: a hat's inner crown has to be built against the
   * head's **built** 9-gon surface, not its ideal ellipsoid (see
   * `HAT_CLEARANCE`), and the only way to do that is to cast from the same
   * origin. Anchoring at the crown instead would make every hat's geometry
   * carry a 0.27 m offset that exists solely to undo this socket.
   */
  headTop: { bone: 'head', position: [0, 0.15, 0], rotation: [0, 0, 0] }
}

/** Where each item kind sits when stowed. */
export const STOW_SOCKET: Record<ItemKind, SocketName | null> = {
  sword: 'hipR',
  greatsword: 'backOver',
  bow: 'backFlat',
  crossbow: 'backOver',
  // A shield is carried, never stowed — see the note on `offHand` carriage in
  // the animation layer. Slinging it on the back as well would need a fourth
  // back socket and would collide with everything already there.
  shield: 'handL',
  hat: 'headTop',
  torsoArmour: null,
  robe: null,
  hoodedRobe: null,
  tabard: null,
  apronSmock: null,
  dress: null,
  pinafore: null,
  jerkin: null,
  roughTunic: null,
  mantle: null,
  wanderersCoat: null,
  coif: 'headTop',
  hood: 'headTop',
  flatCap: 'headTop',
  officialCap: 'headTop',
  helmet: 'headTop',
  hose: null,
  looseTrousers: null,
  plateLegs: null,
  rolledTrousers: null,
  tallBoots: null
}

/**
 * ─── How a held item is *oriented* in the fist ──────────────────────────────
 *
 * `SOCKETS.handR` / `handL` say **where** the grip sits — one point, identity
 * rotation, shared by everything held. That was wrong the moment more than one
 * thing could be held, and it showed: with the item frame running its length
 * along −Y (`ITEM_FORWARD_AXIS`), an identity grip points every blade *down the
 * hand*, and the carry pose then swung it out to horizontal, so a drawn sword
 * stuck out sideways like a baton.
 *
 * Four things cannot share one grip:
 *
 *   • a **sword** is carried blade-**up**, emerging from the thumb side of the
 *     fist — that is the ready carry, and it is what stops the point dragging
 *     along the ground or sweeping the person beside you;
 *   • a **greatsword** likewise, but the second hand is on the same grip;
 *   • a **crossbow** must aim **forward**, level, because its length *is* its
 *     aim line;
 *   • a **bow** stands across the fist, gripped at the riser.
 *
 * So orientation is per kind, applied on top of the socket. Keeping it out of
 * `SOCKETS` is deliberate: the socket is a property of the *skeleton* and is
 * shared by the stow sockets nobody may retune, while this is a property of the
 * *item*, and adding a fifth weapon should not require inventing a fifth socket.
 *
 * ── The hand's own axes, which every number below is measured against ───────
 *
 * The bind pose gives every bone an identity rotation (`skeleton.ts` writes
 * translations only), so `hand.R`'s local frame **is** world-axis-aligned at
 * bind, and `chibiGeometry.ts` builds the hand in it: the fingers run down the
 * arm (−Y-ish), the thumb stands **+Z**, and the palm's broad axis is Z with its
 * flats facing ±X. A fist therefore closes around an axis along **hand-local
 * Z** — perpendicular to the fingers, in the plane of the palm — and a handle
 * emerges on the **thumb side, +Z**. That is the bore `chibiGeometry.ts`'s
 * closed fist is built around, and it is why three of the four entries below are
 * a quarter turn rather than a half one: the item's length has to *cross* the
 * hand, not continue it.
 *
 * ── Measured, at the carry pose, on the shipped rig ─────────────────────────
 *
 * Each row is the world direction the item's own axis ends up in once
 * `applyCarry` has posed the arm, at a stand and at a full run:
 *
 *   | kind       | axis           | at rest                  | at a run     |
 *   |------------|----------------|--------------------------|--------------|
 *   | sword      | blade (−Y)     | 24.1° off vertical, up   | 37.9°, up    |
 *   | greatsword | blade (−Y)     | 38.3°, up over the left  | 42.7°        |
 *   | bow        | upper limb(+Y) | 52.1° off vertical       | 32.6°        |
 *   | crossbow   | bolt (−Y)      | 1.7° above horizontal    | 3.1°         |
 *
 * The half-turn this table shipped with (`[π, 0, 0]` for the swords) was
 * measured and rejected before it ever rendered: π about X takes −Y to +Y, which
 * points the blade **back up the forearm** — the guard lands inside the wrist and
 * the blade exits through the elbow. Blade-up is a *quarter* turn, not a half.
 *
 * Euler XYZ, radians, applied after the socket's own rotation.
 */
export const GRIP_ROTATION: Record<ItemKind, readonly [number, number, number]> = (() => {
  const level: readonly [number, number, number] = [0, 0, 0]
  /**
   * −90° about X: the item's length (−Y) goes to the hand's **+Z**, the thumb
   * side, so the blade leaves the fist through the grip opening and the pommel
   * out of the little-finger side. The blade's edges (item ±Z) land on ±Y — fore
   * and aft of the forearm — and its flats (±X) stay on the hand's ±X, which is
   * the palm's own normal. That is the hammer grip: flats against the palm,
   * edges square to the knuckles.
   *
   * Measured for the guard, which is the part that can end up inside the arm:
   * the sword's quillons sit 36 mm out the thumb side of the socket, and the
   * nearest quillon tip clears the forearm's bind axis by 49 mm against a 34 mm
   * wrist — 15 mm of air, and it passes *in front of* the arm rather than
   * through it because the socket itself stands 30 mm forward of the wrist.
   */
  const bladeUp: readonly [number, number, number] = [-Math.PI * 0.5, 0, 0]
  const table = {} as Record<ItemKind, readonly [number, number, number]>
  for (const kind of Object.keys(ITEM_SLOT) as ItemKind[]) {
    table[kind] = level
  }
  table.sword = bladeUp
  table.greatsword = bladeUp
  /**
   * The bow takes the *opposite* quarter turn, because its length runs both ways
   * from the riser and the limb that has to point **up** is +Y, not −Y. Same
   * bore: the riser crosses the fist on hand-local Z and the string clears the
   * hand entirely (it stands 57 mm off the riser axis against a fist 38 mm in
   * radius).
   *
   * It is the one item whose carry the grip cannot straighten: with the riser on
   * the bore, its tilt is whatever angle `BOW_HAND` leaves the bore at, and that
   * is 52° off vertical at a stand. Fixing it is a change to the *arm* pose —
   * and to the draw's `turnAxis`, which is measured against it — not to this
   * table.
   */
  table.bow = [Math.PI * 0.5, 0, 0]
  /**
   * ── The crossbow's quarter turn is about its **aim line**, not across it ────
   *
   * Level was right for its aim and wrong for its prod, and the two are
   * independent. Its length *is* its aim, its tiller lies **along** the forearm
   * (`CROSSBOW_MAIN` holds it like a torch rather than wrapping it), and identity
   * put the bolt at (0.292, 0.030, 0.956) — 1.7° above horizontal, straight down
   * the carry pose's own line, which is exactly right. But the prod spans the
   * item's ±Z and identity landed that on the hand's ±Z, which at this carry is
   * **vertical**: the bow arms stood up like a longbow's, and on screen it read
   * as a bow bolted sideways onto a stick.
   *
   * A quarter turn about **Y** — the aim line itself — leaves the bolt exactly
   * where it was and rolls the prod level. Measured at rest: bolt unmoved to
   * three figures; prod 18° off horizontal; the bolt rail (the −X face) up.
   *
   * ── It was measured, rejected, and then taken ──────────────────────────────
   *
   * Worth recording, because the first measurement said no. `backOver` slings the
   * crossbow unrolled, so the item's orientation at the handover is the sling's
   * and the hand has to arrive a further 90° round — on top of the draw's own
   * 95.7° turn. Measured then: the sheathe's worst single-frame arm step went
   * from 49° to **173.7°** at a run. What made that survivable was not this
   * table: it was the antipodal guard on `reachGripEased`'s orientation ease,
   * which is where the flip actually lived. With that in, the same roll measures
   * **0.90 rad** of worst step and `elbowStability` 0.673 — both *better* than
   * the 1.32 / 0.68 the crossbow had before any of this — and re-searching one
   * hinge key brings the step to 0.80.
   */
  table.crossbow = [0, Math.PI * 0.5, 0]
  /**
   * The shield stays level, and that is not an omission. It is **worn, not
   * gripped** — `applyShield` carries it on the forearm under a strap and aims
   * its plate by forearm pronation against `SHIELD_NORMAL_LOCAL`, which is
   * authored in this same identity frame. A grip rotation here would have to be
   * undone there, and it would roll the board's top edge sideways.
   */
  return table
})()

/** Where each item kind sits when drawn. Null = this kind is never held. */
export const DRAWN_SOCKET: Record<ItemKind, SocketName | null> = {
  sword: 'handR',
  greatsword: 'handR',
  bow: 'handL',
  crossbow: 'handR',
  shield: 'handL',
  hat: null,
  torsoArmour: null,
  robe: null,
  hoodedRobe: null,
  tabard: null,
  apronSmock: null,
  dress: null,
  pinafore: null,
  jerkin: null,
  roughTunic: null,
  mantle: null,
  wanderersCoat: null,
  coif: null,
  hood: null,
  flatCap: null,
  officialCap: null,
  helmet: null,
  hose: null,
  looseTrousers: null,
  plateLegs: null,
  rolledTrousers: null,
  tallBoots: null
}

/**
 * Vertical clearance between the top of the skull and the inside of a hat brim,
 * in metres.
 *
 * The head is an **ellipsoid flattened front-to-back** (`crossSection [1, 0.94]`
 * on a 0.25 m radius), and it is *built* as a 9-gon whose facets sit up to 15 mm
 * inside that ellipsoid. A hat sized to the ideal ellipsoid therefore floats;
 * one sized to the facets clips through the crown at four bearings out of nine.
 * Hats must be built against the same **built** surface the face is, and this is
 * the margin left on top of that — enough to read as a hat sitting on hair, not
 * enough to hover.
 */
export const HAT_CLEARANCE = 0.012

// ─── Triangle budgets (GDD §4.1) ────────────────────────────────────────────

/**
 * Equipment is **held near the camera**, which is the whole argument for these
 * numbers being generous next to a boulder's 180.
 *
 * The user asked for "ultra-HD" models. Taken literally that is incompatible
 * with this project — GDD §1 is explicit that the look is low-poly with detail
 * carried by silhouette, authored normals and vertex colour, and a 20 000-tri
 * sword would not look better here, it would look *foreign*: smooth where
 * everything around it is faceted-then-bevelled, and lit by a toon ramp that
 * cannot reward the extra geometry.
 *
 * So it is read as "the top of this project's quality bar": every edge bevelled,
 * normals authored, no silhouette approximated by a flat quad, and budgets set
 * by what the *silhouette* needs rather than by what a distant prop can afford.
 * A sword gets more triangles than a boulder because it is a metre from the lens
 * and its outline is read every frame.
 */
export const EQUIPMENT_BUDGET: Record<ItemKind, number> = {
  sword: 200,
  greatsword: 280,
  bow: 220,
  crossbow: 300,
  shield: 240,
  hat: 180,
  torsoArmour: 260,
  // Garments run larger than the cuirass because a hem, a hood or a free-hanging
  // panel is silhouette, and silhouette is the only thing that survives 20 m.
  // They are still cheap where it counts: a garment replaces the torso, so a
  // hundred townspeople cost ~90 000 triangles and **no extra draw calls**.
  //
  // Headwear is the opposite and the numbers below understate it: measured with
  // shadows on, a hatted figure is 8 draws against a bare-headed 4 — mesh plus
  // outline hull, each again in the shadow pass. A hundred hatted NPCs is ~800
  // draws against GDD §5.2's cap of 180 for the whole view, so a crowd needs an
  // instanced field per hat kind or headwear dropped past a distance. Making the
  // hat smaller does not help.
  robe: 300,
  hoodedRobe: 370,
  tabard: 375,
  apronSmock: 330,
  dress: 300,
  pinafore: 370,
  jerkin: 260,
  roughTunic: 240,
  mantle: 405,
  // The road coat. `garments.ts`'s dearest silhouette minus its hanging panel:
  // 16 stations at 10 segments, with the crossed straps costing nothing because
  // they are paint. See `gear/wanderer.ts::WANDERER_BUDGET`.
  wanderersCoat: 450,
  coif: 200,
  hood: 250,
  flatCap: 180,
  officialCap: 215,
  helmet: 215,
  // Legs are two limbs but a smaller share of the outline than a torso, and
  // they displace 144 triangles of body — so the *net* cost is ~236 per wearer.
  // Measured separation is 28 mm at best and 9 mm at worst, i.e. 1.4 px and
  // 0.5 px at 20 m: four silhouettes at conversation, two at 8 m, one at 20 m.
  // Legs are therefore the first thing a crowd should drop past ~15 m.
  hose: 345,
  looseTrousers: 345,
  plateLegs: 380,
  rolledTrousers: 380,
  // The dearest leg garment in the project, and the fold under the knee is why:
  // a profile that turns 180° needs a ring on each face of the turn, and rings
  // on a leg are paid for twice because there are two legs.
  tallBoots: 445
}
