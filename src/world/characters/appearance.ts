import { Color } from 'three'
import type { EyeStyle, MouthStyle } from './face'
import {
  DEFAULT_APPEARANCE,
  type BeardStyle,
  type BuildStyle,
  type BrowStyle,
  type CharacterAppearance,
  type HairStyle,
  type HeadShape,
  type NoseStyle,
  type Sex,
  type SkinTone
} from './equipment'
import { GEAR_SEED_SPACE } from './gear'
import { HAIR_COLOURS, SKIN_TONES, TUNIC_COLOURS } from './variants'

/**
 * ─── What a character *is*, apart from how one is drawn ─────────────────
 *
 * The option lists the creation screen offers, the swatches it paints them with,
 * the repair path anything read from storage goes through, and the two keys that
 * storage lives under. No scene, no camera, no renderer.
 *
 * ── Why it is not in `CreatorScene.ts`, which is where it started ─────────
 *
 * Because the **world** needs it now. `player/chibiBody.ts` builds the figure
 * you walk around as, and it should be the character you designed — which means
 * `World` has to read the roster. `CreatorScene` imports `createRenderer`,
 * `createSky`, `OrbitCameraController`, `Profiler` and a second toon material
 * family, so a world that imported it for `loadAppearance` would drag an entire
 * second scene into the bundle to read nine primitive fields.
 *
 * `professions.ts` already recorded the shape of this problem from the other
 * side — it writes out `NPC_HAIR` by hand rather than import the list from the
 * creator screen, "because this is the three.js side and `CreatorScene` drags a
 * renderer in behind it", and pins the two together with a test. That workaround
 * is what this module removes the need for.
 *
 * `CreatorScene.ts` and the `/characters` screen have since been removed
 * (roadmap #7); the roster and the tests import from here directly.
 */

// ─── The appearance options, and where the UI reads them from ───────────────

/**
 * Every value of each union, in the order the picker shows them.
 *
 * Keyed by the union through a `Record`, exactly as `inventory.ts` derives
 * `ITEM_KINDS` from `ITEM_SLOT`: adding a hair style to `equipment.ts` and
 * forgetting it here is then a **compile error**, not a style the player can
 * never select. A hand-written array would fail silently and look complete.
 */
const SEX_ORDER: Record<Sex, true> = { male: true, female: true }
const HEAD_ORDER: Record<HeadShape, true> = { round: true, oval: true, square: true, heart: true }
// Ordered roughly by how far the mass breaks the head's outline — the six that
// shipped first, then the fifteen added for crowd variety. The `Record` is what
// makes a forgotten style a compile error rather than an option nobody can pick;
// widening `HairStyle` to 21 broke this file exactly as intended.
const HAIR_ORDER: Record<HairStyle, true> = {
  bowl: true,
  short: true,
  ponytail: true,
  braids: true,
  long: true,
  bald: true,
  topknot: true,
  buns: true,
  bun: true,
  plaits: true,
  flowing: true,
  queue: true,
  bob: true,
  tresses: true,
  wild: true,
  swept: true,
  fringe: true,
  bearded: true,
  mane: true,
  coif: true,
  receding: true
}

/**
 * ── The three volume axes ─────────────────────────────────────────────────
 *
 * Same `Record` trick, same reason: `features.ts` also exports `BEARD_STYLES`,
 * `BROW_STYLES` and `NOSE_STYLES` in the order it wants them read, and those
 * lists are the ones the *world* uses — this file drags a renderer in behind it,
 * so `professions.ts` cannot import from here. `characterCreator.test.ts` asserts
 * the two agree, exactly as it already does for `NPC_HAIR`, so a style added to
 * one and not the other is a failing test rather than an option nobody can pick.
 *
 * `none` leads the beard and the nose because it is the shipped face and the
 * default; the rest run shortest-to-longest, which is also least-to-most
 * silhouette.
 */
const BEARD_ORDER: Record<BeardStyle, true> = {
  none: true,
  moustache: true,
  goatee: true,
  cropped: true,
  muttonChops: true,
  full: true,
  forked: true,
  braided: true,
  patriarch: true
}
const BROW_ORDER: Record<BrowStyle, true> = { fine: true, bushy: true }
const NOSE_ORDER: Record<NoseStyle, true> = { none: true, button: true, round: true, hooked: true, broad: true }
const BUILD_ORDER: Record<BuildStyle, true> = { slight: true, average: true, broad: true }

const EYE_ORDER: Record<EyeStyle, true> = {
  bright: true, wide: true, close: true, tall: true, small: true,
  almond: true, sleepy: true, sharp: true, soft: true, weary: true
}
const MOUTH_ORDER: Record<MouthStyle, true> = {
  smile: true, neutral: true, frown: true, grin: true, open: true
}

export const SEXES = Object.keys(SEX_ORDER) as Sex[]
export const HEAD_SHAPES = Object.keys(HEAD_ORDER) as HeadShape[]
export const HAIR_STYLES = Object.keys(HAIR_ORDER) as HairStyle[]
export const BEARD_STYLE_OPTIONS = Object.keys(BEARD_ORDER) as BeardStyle[]
export const BROW_STYLE_OPTIONS = Object.keys(BROW_ORDER) as BrowStyle[]
export const NOSE_STYLE_OPTIONS = Object.keys(NOSE_ORDER) as NoseStyle[]
export const BUILD_STYLE_OPTIONS = Object.keys(BUILD_ORDER) as BuildStyle[]
export const EYE_STYLE_OPTIONS = Object.keys(EYE_ORDER) as EyeStyle[]
export const MOUTH_STYLE_OPTIONS = Object.keys(MOUTH_ORDER) as MouthStyle[]

/**
 * ── The swatches are the builder's own ramps, not a copy of them ────────────
 *
 * `#rrggbb`, in sRGB, read straight out of `variants.ts`. That file is the one
 * place that decides what `skinTone: 3` or `tunicColour: 5` *is*; a second list
 * here would be a set of colours that look right until somebody reorders a ramp,
 * and then the panel shows one colour while the figure wears another — a drift
 * with no error and no test that can see it from the outside.
 *
 * Deriving them also means the picker's length is the ramp's length: five skin
 * stops, five hair, six tunic today, and whatever they become tomorrow, with no
 * edit here and none in `CharacterCreator.vue`.
 */
const css = (color: Color): string => `#${color.getHexString()}`

export const SKIN_TONE_SWATCHES: readonly string[] = SKIN_TONES.map(css)
export const HAIR_COLOUR_SWATCHES: readonly string[] = HAIR_COLOURS.map(stop => css(stop.base))
export const TUNIC_COLOUR_SWATCHES: readonly string[] = TUNIC_COLOURS.map(stop => css(stop.base))

// ─── Persistence ────────────────────────────────────────────────────────────

/**
 * Its own key.
 *
 * Not the level editor's `world_editor_*`, not the sculptor's
 * `world_sculpt_delta`, not the water editor's, and not the inventory's
 * `world.characterInventory.v1`: those are either owner-only dev state a player
 * must never inherit, or a different piece of player state with its own
 * lifetime. Sharing a key means whichever writes last wins, silently.
 *
 * Versioned, because the appearance unions are expected to grow. A future `.v2`
 * can be introduced without having to guess what a `.v1` blob meant.
 */
export const APPEARANCE_KEY = 'world.characterAppearance.v1'

const isSex = (value: unknown): value is Sex => typeof value === 'string' && (SEXES as string[]).includes(value)
const isHeadShape = (value: unknown): value is HeadShape =>
  typeof value === 'string' && (HEAD_SHAPES as string[]).includes(value)
const isHairStyle = (value: unknown): value is HairStyle =>
  typeof value === 'string' && (HAIR_STYLES as string[]).includes(value)
const isEyeStyle = (value: unknown): value is EyeStyle =>
  typeof value === 'string' && (EYE_STYLE_OPTIONS as string[]).includes(value)
const isMouthStyle = (value: unknown): value is MouthStyle =>
  typeof value === 'string' && (MOUTH_STYLE_OPTIONS as string[]).includes(value)
const isBeardStyle = (value: unknown): value is BeardStyle =>
  typeof value === 'string' && (BEARD_STYLE_OPTIONS as string[]).includes(value)
const isBrowStyle = (value: unknown): value is BrowStyle =>
  typeof value === 'string' && (BROW_STYLE_OPTIONS as string[]).includes(value)
const isNoseStyle = (value: unknown): value is NoseStyle =>
  typeof value === 'string' && (NOSE_STYLE_OPTIONS as string[]).includes(value)
const isBuildStyle = (value: unknown): value is BuildStyle =>
  typeof value === 'string' && (BUILD_STYLE_OPTIONS as string[]).includes(value)

/** Rounds and clamps into `[0, length)`. Never NaN — see `sanitiseAppearance`. */
const clampIndex = (value: number, length: number): number => {
  if (!Number.isFinite(value)) {
    return 0
  }
  const index = Math.floor(value)
  return index < 0 ? 0 : index >= length ? length - 1 : index
}

/**
 * Narrows a swatch index to the `SkinTone` union.
 *
 * `SkinTone` is `0 | 1 | 2 | 3 | 4` — the ramp's indices, spelled as a union so
 * a stray 7 is a type error rather than a black head. A `v-for` index is a plain
 * `number`, so the picker needs one place that does the clamp *and* the narrow;
 * doing it inline would be a cast in a template, where nothing can check it.
 */
export const asSkinTone = (index: number): SkinTone => clampIndex(index, SKIN_TONE_SWATCHES.length) as SkinTone

/**
 * Repairs anything that comes back from storage.
 *
 * Total, like `sanitiseInventory`: every branch produces a valid appearance
 * rather than throwing. A creation screen that will not open because a key from
 * an older build is still in `localStorage` is a far worse failure than a
 * player finding themselves back on the default head.
 *
 * Fields are only *overridden* when they are present and valid, so a blob
 * written by an older build that never knew about `hairColour` keeps the
 * default rather than being reset to index 0.
 */
export const sanitiseAppearance = (raw: unknown): CharacterAppearance => {
  const appearance: CharacterAppearance = { ...DEFAULT_APPEARANCE }
  if (!raw || typeof raw !== 'object') {
    return appearance
  }
  const data = raw as Record<string, unknown>

  if (isSex(data.sex)) {
    appearance.sex = data.sex
  }
  if (isHeadShape(data.head)) {
    appearance.head = data.head
  }
  if (isHairStyle(data.hair)) {
    appearance.hair = data.hair
  }
  // A save written before faces were customisable has neither key, and falls
  // through to the shipped `bright` + `smile` — which is what that build drew.
  if (isEyeStyle(data.eyes)) {
    appearance.eyes = data.eyes
  }
  if (isMouthStyle(data.mouth)) {
    appearance.mouth = data.mouth
  }
  // A save written before the face had volume has none of these three keys and
  // falls through to `none` / `fine` / `none` — which is precisely the face that
  // build drew, so an old character reloads unchanged rather than sprouting a
  // beard. Same rule as `eyes`/`mouth` and `gearSeed` above, and the reason all
  // three defaults are the absent value.
  if (isBeardStyle(data.beard)) {
    appearance.beard = data.beard
  }
  if (isBrowStyle(data.brows)) {
    appearance.brows = data.brows
  }
  if (isNoseStyle(data.nose)) {
    appearance.nose = data.nose
  }
  // Same rule again, and the same reason: `average` reproduces the shipped
  // torso exactly, so a blob written before builds existed reloads as the body
  // it was drawn with rather than gaining or losing mass.
  if (isBuildStyle(data.build)) {
    appearance.build = data.build
  }
  if (typeof data.skinTone === 'number') {
    appearance.skinTone = clampIndex(data.skinTone, SKIN_TONE_SWATCHES.length) as SkinTone
  }
  if (typeof data.hairColour === 'number') {
    appearance.hairColour = clampIndex(data.hairColour, HAIR_COLOUR_SWATCHES.length)
  }
  if (typeof data.tunicColour === 'number') {
    appearance.tunicColour = clampIndex(data.tunicColour, TUNIC_COLOUR_SWATCHES.length)
  }
  // A save written before garments had colourways has no key and falls through
  // to `DEFAULT_APPEARANCE.gearSeed`, which is 1 — the single colourway every
  // one of those characters was actually wearing.
  if (typeof data.gearSeed === 'number') {
    appearance.gearSeed = clampIndex(data.gearSeed, GEAR_SEED_SPACE)
  }
  return appearance
}

/**
 * Reads the stored appearance, guarded per the convention in
 * `editor/toggle.ts`: `localStorage` throws outright in a sandboxed iframe,
 * which is how several of the portals this ships to serve games.
 */
export const loadAppearance = (): CharacterAppearance => {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(APPEARANCE_KEY)
    return sanitiseAppearance(raw ? JSON.parse(raw) : null)
  } catch {
    return sanitiseAppearance(null)
  }
}

export const saveAppearance = (appearance: CharacterAppearance): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(sanitiseAppearance(appearance)))
    }
  } catch {
    // Storage full or blocked. The choice still applies for this session, which
    // is strictly better than refusing to accept it.
  }
}

/**
 * Every field of an appearance, derived from the default rather than listed.
 *
 * Same argument as `HAIR_ORDER` above, one level up: a hand-written field list
 * here is the thing that goes stale when the interface grows. It already had —
 * `eyes` and `mouth` were added to `CharacterAppearance` and this copy was not
 * updated, so `CreatorScene.setAppearance` copied a face-less appearance into its
 * own object and the figure kept the shipped `bright` + `smile` whatever was
 * chosen, while `appearanceEquals` (which *did* list them) reported a difference
 * that the copy could never resolve. Derived, that is impossible: a new field is
 * copied and compared the day it is added.
 *
 * `DEFAULT_APPEARANCE` is a plain module-level constant, so this iterates a real
 * object's own keys and reads only primitives out of `from` — no proxy is ever
 * retained, which is the reason a copy exists at all (GDD §0).
 */
const APPEARANCE_FIELDS = Object.keys(DEFAULT_APPEARANCE) as (keyof CharacterAppearance)[]

/** Field-by-field, so a reactive proxy handed in by Vue is never retained. */
export const copyAppearance = (
  from: CharacterAppearance,
  into: CharacterAppearance = { ...DEFAULT_APPEARANCE }
): CharacterAppearance => {
  const target = into as unknown as Record<string, unknown>
  for (const field of APPEARANCE_FIELDS) {
    target[field] = from[field]
  }
  return into
}

export const appearanceEquals = (a: CharacterAppearance, b: CharacterAppearance): boolean =>
  APPEARANCE_FIELDS.every(field => a[field] === b[field])

/**
 * A random appearance. Used by the panel's "surprise me".
 *
 * Uniform in every field but one — see `beard`, which is the only place a flat
 * roll produces a result a player would read as broken rather than as a
 * surprise.
 */
export const randomAppearance = (random: () => number = Math.random): CharacterAppearance => {
  const pick = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))]!
  const sex = pick(SEXES)
  return {
    sex,
    head: pick(HEAD_SHAPES),
    hair: pick(HAIR_STYLES),
    // ── The one field that is not a flat roll ───────────────────────────────
    //
    // Two things go wrong with a uniform roll over nine styles and they pull in
    // opposite directions, so one probability fixes both: only one roll in nine
    // is clean-shaven, which is a town where nobody shaves; and one in nine
    // lands a beard to the sternum on a feminine build, which reads as a bug
    // rather than as a surprise. The beard is therefore rolled in two steps —
    // whether at all, then which — and the first step is the only place in this
    // function that looks at another field.
    beard: random() < (sex === 'female' ? 0.05 : 0.6) ? pick(BEARD_STYLE_OPTIONS.slice(1)) : 'none',
    brows: pick(BROW_STYLE_OPTIONS),
    nose: pick(NOSE_STYLE_OPTIONS),
    build: pick(BUILD_STYLE_OPTIONS),
    // Rolled too — a city of a hundred that all share one face is the thing the
    // ten eyes and five mouths exist to prevent.
    eyes: pick(EYE_STYLE_OPTIONS),
    mouth: pick(MOUTH_STYLE_OPTIONS),
    skinTone: Math.min(SKIN_TONE_SWATCHES.length - 1, Math.floor(random() * SKIN_TONE_SWATCHES.length)) as SkinTone,
    hairColour: Math.min(HAIR_COLOUR_SWATCHES.length - 1, Math.floor(random() * HAIR_COLOUR_SWATCHES.length)),
    tunicColour: Math.min(TUNIC_COLOUR_SWATCHES.length - 1, Math.floor(random() * TUNIC_COLOUR_SWATCHES.length)),
    // Rolled as well, and it is the field that does the most work in a crowd:
    // every garment carries five or six authored colourways, so this is what
    // separates a square full of guards in the same tabard into a square full of
    // guards. See `gearSeed` in `equipment.ts`.
    gearSeed: Math.min(GEAR_SEED_SPACE - 1, Math.floor(random() * GEAR_SEED_SPACE))
  }
}

// ─── Equipment ──────────────────────────────────────────────────────────────
