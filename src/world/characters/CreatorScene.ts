import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  Vector3,
  type WebGLRenderer
} from 'three'
import type { EyeStyle, MouthStyle } from './face'
import { C } from '../art/palette'
import { createLightRig, type LightRig } from '../core/lighting'
import { OrbitCameraController } from '../core/OrbitCameraController'
import { createRenderer, resizeRenderer } from '../core/renderer'
import { createSky } from '../core/sky'
import { Profiler } from '../perf/Profiler'
import { updateUnitsPerPixel, worldUniforms } from '../shading/globals'
import { createToonMaterial, type ToonMaterial } from '../shading/toonMaterial'
import { Character } from './Character'
import { CharacterEquipment, variantOf } from './CharacterEquipment'
import {
  DEFAULT_APPEARANCE,
  EQUIP_SLOTS,
  type CharacterAppearance,
  type EquipmentLoadout,
  type HairStyle,
  type HeadShape,
  type ItemKind,
  type Sex,
  type SkinTone
} from './equipment'
import { GEAR_BUILDERS, GEAR_SEED_SPACE, gearModel } from './gear'
import { emptyLoadout } from './inventory'
import { FIGURE_HEIGHT } from './rig'
import { HAIR_COLOURS, SKIN_TONES, TUNIC_COLOURS } from './variants'

/**
 * ─── /characters — the creation stage ───────────────────────────────────────
 *
 * One character, lit, on a plain plinth, turning slowly. Nothing else is in the
 * frame on purpose: this screen exists so a player can judge a *silhouette*, and
 * at three heads tall the silhouette is the entire read — the head is a third of
 * it, which is why head shape and hair are the two strongest levers in the panel
 * and why the figure has to be visible from every bearing to be judged at all.
 * That is the turntable's whole job; a fixed three-quarter view hides exactly
 * the difference between a ponytail and braids.
 *
 * Same division of labour as `WaterLab` and `World` (GDD §0): Vue owns the DOM,
 * three owns the canvas, and the only things crossing between them are
 * primitives. `setAppearance` takes a `CharacterAppearance` — six primitive
 * fields — and **copies them field by field** into a plain object it owns. The
 * same goes for the loadout. Neither caller's object is ever retained: the
 * caller is a Vue component, and one `ref` instead of a `shallowRef` on its side
 * would be enough to hand this a reactive proxy that the frame loop then reads
 * every frame. Copying makes that impossible from here rather than depending on
 * the component getting it right.
 *
 * ── The backdrop is a plinth, not a ground plane ────────────────────────────
 *
 * A ground plane would need terrain, terrain colour and a horizon to not look
 * like a mistake. A 2.3 m disc under the feet gives the one thing the figure
 * actually needs from the environment — something for its own shadow to land on,
 * which is what stops a lit character from reading as a sticker over the sky.
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

/** A uniformly random appearance. Used by the panel's "surprise me". */
export const randomAppearance = (random: () => number = Math.random): CharacterAppearance => {
  const pick = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))]!
  return {
    sex: pick(SEXES),
    head: pick(HEAD_SHAPES),
    hair: pick(HAIR_STYLES),
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

/**
 * What the preview offers: one item for each of the four slots a player can see
 * the effect of at a glance.
 *
 * Not all seven kinds. `greatsword`, `bow` and `crossbow` all live in the same
 * `back` slot and all read as "something diagonal behind the shoulder" on a
 * turntable, so offering three of them costs three more buttons and three more
 * strings in 21 languages to show one silhouette. The four here each change a
 * *different* part of the outline: the crown, the torso, the right hip and the
 * left arm.
 */
export const PREVIEW_ITEMS: readonly ItemKind[] = ['hat', 'torsoArmour', 'sword', 'shield']

/**
 * ── The gear bridge that used to live here ──────────────────────────────────
 *
 * This screen carried its own copy of `gearRegistry.ts`, from before that file
 * existed, and the note on it said to delete this and call theirs the day it
 * did. That day has come and this is the deletion, because the duplicate had
 * stopped being harmless: the registry now hands each factory the *wearer's*
 * variant, and a second registration that ignored it would overwrite the real
 * bridge with one that dressed every character in colourway 1 — visible only on
 * whichever screen happened to construct its scene last.
 *
 * `Character`'s constructor calls `installGear()`, so there is nothing to do
 * here at all.
 */

/** Field by field, so a Vue proxy is never retained. Same rule as appearance. */
const copyLoadoutInto = (from: EquipmentLoadout, into: EquipmentLoadout): EquipmentLoadout => {
  for (const slot of EQUIP_SLOTS) {
    into[slot] = from[slot]
  }
  into.drawn = from.drawn
  return into
}

// ─── The plinth ─────────────────────────────────────────────────────────────

/**
 * 1.15 m, not 1.5.
 *
 * At the 3.3 m framing a 3 m disc runs past both edges of the frame and its far
 * rim sits above the figure's knees, so it stops reading as a plinth and starts
 * reading as a hill the character is standing on. Small enough that the whole
 * rim is in shot is what makes it read as a stage — the shadow running off the
 * edge is correct and helps, because that is what tells you it *is* an edge.
 */
const PLINTH_RADIUS = 1.15
const PLINTH_HEIGHT = 0.16
/** Rim bevel. No hard 90° edge exists in this world (GDD R2). */
const PLINTH_BEVEL = 0.035
const PLINTH_RADIAL = 32

/**
 * A bevelled disc: top face, top bevel, side, bottom bevel, bottom face.
 *
 * Normals are **authored from the shape** (GDD R3) — +Y on the flat, radial on
 * the side, and the 45° blend on each bevel — never `computeVertexNormals`,
 * which would average the flat into the bevel and lose the crisp band edge that
 * makes the rim read as a rim rather than as a smear.
 *
 * Wound outward, which is asserted in `characterCreator.test.ts` — that is what
 * this is exported for. The body upstream of this file spent a while rendering
 * its own far surface for exactly this reason (see `chibiGeometry.ts`), so a new
 * closed surface in this folder does not get to assume it.
 */
export const buildPlinth = (): BufferGeometry => {
  const radial = PLINTH_RADIAL
  const top = 0
  const bottom = -PLINTH_HEIGHT
  const inner = PLINTH_RADIUS - PLINTH_BEVEL
  const diagonal = Math.SQRT1_2

  // Ring: [radius, y, normalRadial, normalY, colour]
  const rings: { radius: number; y: number; nr: number; ny: number; color: Color }[] = [
    { radius: inner, y: top, nr: 0, ny: 1, color: C.cliffLit },
    { radius: PLINTH_RADIUS, y: top - PLINTH_BEVEL, nr: diagonal, ny: diagonal, color: C.cliffBase },
    { radius: PLINTH_RADIUS, y: bottom + PLINTH_BEVEL, nr: 1, ny: 0, color: C.cliffBase },
    { radius: inner, y: bottom, nr: diagonal, ny: -diagonal, color: C.cliffShadow }
  ]

  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, color: Color): number => {
    const index = positions.length / 3
    positions.push(x, y, z)
    normals.push(nx, ny, nz)
    colors.push(color.r, color.g, color.b)
    return index
  }

  // Centres first, so the two fans can address them by a constant.
  const topCentre = push(0, top, 0, 0, 1, 0, C.cliffLit)
  const bottomCentre = push(0, bottom, 0, 0, -1, 0, C.cliffShadow)

  const ringStart: number[] = []
  for (const ring of rings) {
    ringStart.push(positions.length / 3)
    for (let k = 0; k < radial; k++) {
      const angle = (k / radial) * Math.PI * 2
      const sin = Math.sin(angle)
      const cos = Math.cos(angle)
      push(
        ring.radius * sin,
        ring.y,
        ring.radius * cos,
        ring.nr * sin,
        ring.ny,
        ring.nr * cos,
        ring.color
      )
    }
  }

  // ── Winding ───────────────────────────────────────────────────────────────
  //
  // A point at angle θ is `(r·sinθ, y, r·cosθ)`, so increasing θ runs
  // counter-clockwise seen from +Y and counter-clockwise seen from *outside* the
  // side wall. Front faces are CCW seen from the direction the normal points, so
  // the top fan and the side quads take θ in order and the bottom fan reverses.
  for (let k = 0; k < radial; k++) {
    const next = (k + 1) % radial
    indices.push(topCentre, ringStart[0]! + k, ringStart[0]! + next)
    for (let ring = 0; ring < rings.length - 1; ring++) {
      const upper = ringStart[ring]!
      const lower = ringStart[ring + 1]!
      indices.push(upper + k, lower + k, lower + next)
      indices.push(upper + k, lower + next, upper + next)
    }
    const last = ringStart[rings.length - 1]!
    indices.push(bottomCentre, last + next, last + k)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  geometry.setIndex(new BufferAttribute(new Uint16Array(indices), 1))
  geometry.computeBoundingSphere()
  return geometry
}

// ─── The scene ──────────────────────────────────────────────────────────────

/** Radians per second the stage turns. ~14 s for a full revolution: slow enough
 *  to read a silhouette at every bearing, fast enough that you don't wait. */
const SPIN_RATE = 0.45

/**
 * ─── The stage key light ────────────────────────────────────────────────────
 *
 * The world's sun sits at a horizontal bearing of −138°; the orbit camera starts
 * at +34°. **172° apart** — so on a fixed stage the figure is backlit, always,
 * and the turntable does not fix it, it only decides which quarter of the spin
 * you get. Measured on the first pass: the front of the tunic — the one
 * saturated field on the figure (palette §Characters) and a colour this screen
 * exists to let a player *choose* — arrived as near-black whatever they picked.
 *
 * That is fine in the world, where the player drives the camera and can simply
 * walk round. It is not fine on a portrait stage.
 *
 * So the key is re-aimed for this scene, and **only its bearing moves**: the
 * elevation is the world's 38.5° to the degree, so the shading is the shading
 * the character will have out there. The new bearing is 79°, which is 45° off
 * the camera's — a three-quarter key over the viewer's left shoulder. 45°
 * rather than 0° because a key aligned with the camera is flat frontal light
 * and a chibi's whole read is its form; 45° rather than 90° because the width
 * of the window in which the figure's front is both *visible* and *lit* is
 * 180° minus this offset, and at 90° the player would spend half the turntable
 * looking at a silhouette again.
 *
 * `setDirection` is the rig's own supported API — the day/night cycle drives the
 * world's sun through it every frame. Nothing in `lighting.ts` is touched.
 */
const STAGE_SUN = new Vector3(0.766, 0.62, 0.143).normalize()

/** What the camera orbits: mid-chest, so the head is not at the frame's edge. */
const FOCUS_Y = FIGURE_HEIGHT * 0.55
/**
 * Where the camera settles.
 *
 * At a 38° vertical FOV this shows 2·3.3·tan(19°) = 2.27 m of height, so a
 * 1.56 m figure fills about seventy per cent of the frame with headroom above
 * and the plinth at the bottom edge. Judged on a phone as well as a desktop: the
 * panel takes the lower half of a portrait screen, and a figure framed for a
 * 16:9 canvas is a thumbnail on what is left.
 */
const START_DISTANCE = 3.3

export class CreatorScene {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera: PerspectiveCamera
  readonly controller: OrbitCameraController
  readonly profiler: Profiler

  /**
   * Milliseconds the last appearance change spent rebuilding the body.
   *
   * Exposed rather than logged because it is the number that decides whether
   * this screen can rebuild per change at all — see `setAppearance`.
   */
  lastRebuildMs = 0

  private readonly sky: Mesh
  private readonly lights: LightRig
  private readonly plinth: Mesh
  private readonly plinthMaterial: ToonMaterial
  /** Owns the spin, so `Character.update` keeps owning its own `rotation.y`. */
  private readonly turntable = new Group()
  private readonly character: Character
  private readonly equipment: CharacterEquipment
  private readonly appearance: CharacterAppearance = { ...DEFAULT_APPEARANCE }
  private readonly loadout: EquipmentLoadout = emptyLoadout()

  private element: HTMLElement | null = null
  private spinning = true
  private rafId: number | null = null
  private lastTime = 0
  private width = 1
  private height = 1
  private running = false
  private orbitDistance = 0
  private pendingDistance: number | null = START_DISTANCE

  constructor(canvas: HTMLCanvasElement, appearance: CharacterAppearance = DEFAULT_APPEARANCE) {
    this.renderer = createRenderer({ canvas })
    // A narrow lens: a wide one at this range gives the head the barrel
    // distortion of a phone selfie, which fights the proportions the rig is
    // built on more than any customisation option can correct.
    this.camera = new PerspectiveCamera(38, 1, 0.1, 60)
    this.controller = new OrbitCameraController(this.camera, {
      minDistance: 1.7,
      maxDistance: 6,
      // Never below the plinth and never straight down: both are views in which
      // the silhouette this screen exists for cannot be judged.
      minPitch: -0.05,
      maxPitch: 1.05
    })
    this.profiler = new Profiler(this.renderer)

    this.sky = createSky(60)
    this.scene.add(this.sky)
    this.profiler.registerRoot(this.sky, 'sky')

    // Before any material is constructed: `ToonMaterial` enrols itself in the
    // active cascade set inside its constructor, so one built before the rig
    // exists renders with no direct light at all.
    //
    // Intensities are the world's, untouched: the whole point of judging a
    // character here is that it looks here the way it will look out there, and
    // the ~2:1 key-to-fill ratio is what the toon bands are authored against.
    this.lights = createLightRig(this.scene, { camera: this.camera, shadowMaxFar: 24 })
    this.lights.cascades.setDirection(STAGE_SUN)

    this.plinthMaterial = createToonMaterial({ wind: false, name: 'creator-plinth' })
    this.plinth = new Mesh(buildPlinth(), this.plinthMaterial)
    this.plinth.name = 'creator/plinth'
    // Receives but never casts: it is the bottom of the world here, and a disc
    // casting into the empty space below it costs a cascade for nothing.
    this.plinth.receiveShadow = true
    this.plinth.castShadow = false
    this.plinth.userData.perfTag = 'plinth'
    this.scene.add(this.plinth)
    this.profiler.registerRoot(this.plinth, 'plinth')

    this.turntable.name = 'creator/turntable'
    this.scene.add(this.turntable)

    // A **stable** ledger name. `assertTriBudget` replaces its row by name, so
    // this screen contributes exactly one row however many times the player
    // clicks; a name varying with the appearance would grow the perf panel a
    // fresh row per option and turn it into a scrolling history.
    this.character = new Character({ perfTag: 'character', geometryName: 'chibi/creator' })
    this.turntable.add(this.character.group)
    this.profiler.registerRoot(this.character.group, 'character')

    // After the light rig, because the shared gear material is created on first
    // use and `ToonMaterial` enrols with the cascades in its constructor.
    // Instant draws: a creation screen is not watching a swing, and a 0.45 s
    // animation between a click and the thing you clicked for reads as lag.
    this.equipment = new CharacterEquipment(this.character, {
      drawDuration: 0,
      variant: variantOf(appearance)
    })

    copyAppearance(appearance, this.appearance)
    this.rebuildBody()

    this.controller.setFocus(0, FOCUS_Y, 0)
  }

  attach(element: HTMLElement): void {
    this.element = element
    this.controller.attach(element)
    this.applyPendingZoom()
  }

  /**
   * Applies a new appearance and rebuilds the body.
   *
   * **Measured, per change**: the whole figure — 19 bones, 12 limb volumes and
   * the face patch — builds in well under a millisecond on this machine, which
   * is what makes rebuilding on every click the right answer instead of a
   * diffing scheme with its own failure modes. The panel is discrete controls,
   * so there is no pointer-move stream to debounce in the first place; if a
   * continuous slider is ever added, debounce *it* rather than making this
   * cleverer.
   *
   * The early-out is not a performance measure — it is what stops a repaint of
   * the panel (which re-emits the same appearance) from throwing away a
   * perfectly good geometry and its GPU buffers once a frame.
   */
  setAppearance(next: CharacterAppearance): void {
    if (appearanceEquals(next, this.appearance)) {
      return
    }
    copyAppearance(next, this.appearance)
    // Before the body rebuild, not after: changing `gearSeed` or `skinTone`
    // re-fetches every worn mesh, and a garment is *part of* the body — asking
    // for the rebuild first would merge the old colourway and then throw it away.
    this.equipment.setVariant(variantOf(this.appearance))
    this.rebuildBody()
  }

  /** A copy — the caller is Vue, and it must not hold the scene's own object. */
  getAppearance(): CharacterAppearance {
    return copyAppearance(this.appearance)
  }

  /**
   * Dresses the figure.
   *
   * Whole-loadout rather than per-slot, because `CharacterEquipment.setLoadout`
   * settles the drawn state against what is actually equipped — apply a sword
   * and a "drawn" flag in two calls and the first one is briefly illegal, which
   * that layer resolves by silently sheathing.
   *
   * **Preview only, and not persisted.** `inventory.ts` owns what a player
   * *has*, behind an ownership model (`acquire` before `equip`); a creation
   * screen letting you try a shield on is not the same act as being given one,
   * and writing this into `world.characterInventory.v1` would be exactly that.
   */
  setLoadout(next: EquipmentLoadout): void {
    copyLoadoutInto(next, this.loadout)
    this.equipment.setLoadout(this.loadout)
  }

  getLoadout(): EquipmentLoadout {
    return this.equipment.loadout()
  }

  setSpinning(on: boolean): void {
    this.spinning = on
  }

  /** Faces the figure at the camera again, for when the player has spun away. */
  resetSpin(): void {
    this.turntable.rotation.y = 0
  }

  /**
   * Delegated to `Character`, which owns the rebuild since torso armour started
   * substituting for the torso rather than covering it.
   *
   * It has to be one path. The armour is *in* the merged geometry now, so a
   * screen that re-pointed the body itself on every appearance click would throw
   * the armour away the moment the player changed their hair — with no error
   * anywhere, just a breastplate turning back into a tunic.
   */
  private rebuildBody(): void {
    this.character.setAppearance(this.appearance)
    this.lastRebuildMs = this.character.lastRebuildMs
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)

    const changed = resizeRenderer(this.renderer, this.width, this.height, 1)
    this.camera.aspect = this.width / this.height
    this.camera.updateProjectionMatrix()

    if (changed) {
      // The outline is a constant 1.6 *screen* pixels (GDD R6), which is a world
      // width derived from this. Skip it and the outline is the width the last
      // canvas size implied.
      const bufferHeight = this.renderer.getContext().drawingBufferHeight
      updateUnitsPerPixel(this.camera.fov, bufferHeight)
      this.lights.onProjectionChanged()
    }
  }

  start(): void {
    if (this.running) {
      return
    }
    this.running = true
    this.lastTime = performance.now()
    const tick = (now: number): void => {
      this.rafId = requestAnimationFrame(tick)
      this.frame(now)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  stop(): void {
    this.running = false
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  /**
   * The controller's orbit distance is private and starts at its own 14 m
   * default, which on a 1.56 m figure is a speck. `WaterLab` set the precedent
   * for reaching it read-only: one synthetic notch through the wheel handler the
   * controller already exposes, sized from the *measured* distance so it lands
   * within a per cent and the damping absorbs the rest.
   *
   * `orbitDistance` is measured at the end of a frame, so nothing is known
   * before the first one and the request waits. Seeding it from the camera's
   * position instead — which is what a first attempt did — reads 0.86 m, because
   * before any `update` the camera is still at the origin and the focus is at
   * chest height. The notch is then sized from *that*, the controller multiplies
   * its own untouched 14 m by the same factor, and the camera settles on the
   * far clamp: a correct-looking screen with the figure at half size.
   */
  private applyPendingZoom(): void {
    const element = this.element
    const target = this.pendingDistance
    if (!element || target === null || this.orbitDistance <= 0.01) {
      return
    }
    this.pendingDistance = null
    // Inverse of the controller's `exp(deltaY · 0.0014)` zoom.
    element.dispatchEvent(
      new WheelEvent('wheel', { deltaY: Math.log(target / this.orbitDistance) / 0.0014, cancelable: true })
    )
  }

  private frame(now: number): void {
    const delta = Math.min(0.05, (now - this.lastTime) / 1000)
    this.lastTime = now

    this.profiler.beginFrame(this.renderer)
    worldUniforms.uTime.value += delta

    if (this.spinning) {
      this.turntable.rotation.y += delta * SPIN_RATE
    }

    // Re-pinned every frame, and deliberately. The controller travels its focus
    // on WASD — correct for a world you walk through, wrong for a stage, where
    // it would slide the figure out of frame the first time a player used the
    // keyboard. Pinning is a read-only way to neutralise it that leaves drag,
    // pinch and wheel exactly as they are.
    this.controller.setFocus(0, FOCUS_Y, 0)
    this.applyPendingZoom()
    this.controller.update(delta)
    this.orbitDistance = this.camera.position.distanceTo(this.controller.focus)
    this.camera.updateMatrixWorld()
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert()
    this.lights.follow(this.controller.focus)
    this.sky.position.copy(this.camera.position)

    // Zero speed, so this settles into the breathing idle rather than a stride.
    this.character.update(delta)
    // One comparison when nothing is in flight — and with `drawDuration: 0`
    // nothing ever is. Called anyway rather than skipped, so the day this scene
    // wants an animated draw it is already wired.
    this.equipment.update(delta)

    this.renderer.render(this.scene, this.camera)
    this.profiler.endFrame(this.renderer, now)
  }

  dispose(): void {
    this.stop()
    this.controller.detach()
    this.element = null

    // Detaches the gear. Its geometry and materials are **module-level and
    // shared** — one sword for every character in the game — so `disposeGearCache`
    // is deliberately not called: this screen did not allocate them and the
    // world may still be holding them.
    this.equipment.dispose()

    // `Character.dispose` frees the body geometry and both materials; the
    // outline's index is this file's to free because this file is what put it
    // there.
    this.character.outline?.geometry.dispose()
    this.character.dispose()
    this.plinth.geometry.dispose()
    this.plinthMaterial.dispose()
    this.sky.geometry.dispose()
    ;(this.sky.material as { dispose(): void }).dispose()
    this.lights.dispose()
    this.profiler.dispose()
    this.renderer.dispose()
  }
}
