import { Color, Vector3 } from 'three'
import { C } from '../art/palette'
import type { CharacterAppearance, HairStyle, HeadShape, Sex } from './equipment'
import { HEAD } from './face'
import { limbMesh } from './limb'

/**
 * ─── Character variants ─────────────────────────────────────────────────────
 *
 * Everything that makes one chibi look like a different person: head shape,
 * hair, build, skin tone, hair colour, tunic colour. `chibiGeometry.ts` asks
 * this file three questions — what colour, what proportions, what extra
 * geometry — and is otherwise unchanged.
 *
 * ── What actually distinguishes a chibi at 10–40 m ──────────────────────────
 *
 * The figure is three heads tall and read from the middle distance, so the head
 * is a *third* of the silhouette and everything below the neck is a quarter of
 * that. The world's camera is 55°, so at 20 m one pixel of a 1080-line frame is
 * **19 mm of character** and the whole 0.52 m head is 27 px. That number decided
 * every trade here:
 *
 * • **Head shape is the strongest lever**, so it is a real change of volume —
 *   +28 mm of width on `square` against −33 mm on `oval`, and ±16 mm of crown
 *   height — and it costs **zero triangles**, because it is a warp of the head
 *   that is already there (see `HeadWarp`).
 * • **Hair is second, and only if it breaks the outline.** Twenty-one styles,
 *   sixteen of them modelled and five *painted*, because 10 mm of hair thickness
 *   on a 0.5 m head is half a pixel and a mesh for it would be 50 triangles of
 *   nothing. What decides which is which — and what decides the whole set — is
 *   *which direction* a style breaks the head's convex hull and *how far*; see
 *   the table above `hairSpecs`.
 * • **Sex is carried by the torso**, not by anatomy. See `BUILDS`.
 * • **Skin tone is a colour swap.** No geometry, no second material, no third
 *   program (GDD §5.2 — characters already fork two via `USE_SKINNING`).
 *
 * ── The two things that break first ─────────────────────────────────────────
 *
 * 1. **The face is glued to the head by a ray-cast in `face.ts`**, against a
 *    `HEAD` spec that mirrors the head's `PartSpec`. So the head's *build*
 *    parameters — radius, `radial`, `capRings`, `crossSection`, both joints —
 *    may never vary. Head shape is therefore expressed as a **post-build warp**
 *    applied to the head, the hair *and the face*, so the cast still runs
 *    against the surface `face.ts` believes in and the features ride the warp
 *    with the skull rather than sliding off it.
 * 2. **There is already a hairline**, and it is the head part's colour ramp
 *    (skin below `HEAD.hairlineY`, hair above). A hair *mesh* that disagrees
 *    with it gives the figure two hairlines a few centimetres apart. So strand
 *    roots are `hair.base` exactly — the same value the skull is painted above
 *    the line — and the line itself moves per style through `HAIRLINE`, in the
 *    head part's own parameter space so nothing about the geometry changes.
 */

// ─── Colour ─────────────────────────────────────────────────────────────────

/**
 * A base albedo and the dark stop that goes with it.
 *
 * Stop 0 of every ramp below is the **authored** pair from the palette, not a
 * derived one — that is what keeps the default appearance bit-for-bit identical
 * to the figure that shipped before customisation existed. Only the stops the
 * palette does not author are derived.
 */
export interface ColourStop {
  base: Color
  dark: Color
}

/**
 * Darkening rule for a derived stop.
 *
 * Measured against the two pairs the palette *does* author: `hairBase → hairDark`
 * is ×0.33 in linear space and `tunicBase → tunicShadow` is ×0.37, both with a
 * slight lift toward blue. So one multiply plus a 5 % pull toward `shadowTint`
 * reproduces both to within a couple of percent, and it satisfies R4 by
 * construction — a derived dark can never reach black because it is always
 * mixed with the periwinkle tint.
 */
const SHADOW_DARKEN = 0.35
const SHADOW_TINT_PULL = 0.05

const deriveDark = (base: Color): Color => base.clone().multiplyScalar(SHADOW_DARKEN).lerp(C.shadowTint, SHADOW_TINT_PULL)

/**
 * The skin ramp a player slides along.
 *
 * **Stop 1 is `skinBase`, not `skinTone1`.** The palette's own note says
 * `skinBase` "stays the mid stop so nothing that already references it moves",
 * and `DEFAULT_APPEARANCE.skinTone` is 1 — but `skinTone1` (#e8c09b) is a
 * visibly lighter colour than `skinBase` (#dbae8a), so taking the ramp
 * literally would repaint the default character. The two cannot both hold;
 * shipping the default unchanged wins, and the discrepancy is reported rather
 * than papered over. `skinTone1` is currently unused.
 */
export const SKIN_TONES: readonly Color[] = [C.skinTone0, C.skinBase, C.skinTone2, C.skinTone3, C.skinTone4]

/**
 * Hair colours. Every base is a palette entry, per GDD §3 — there is no hex
 * literal anywhere in `src/world/`, and a hair ramp is not a good enough reason
 * to start.
 */
export const HAIR_COLOURS: readonly ColourStop[] = [
  // Authored. The default, and the value the boots share (see `bodyPalette`).
  { base: C.hairBase, dark: C.hairDark },
  { base: C.sandstoneBase, dark: deriveDark(C.sandstoneBase) },
  { base: C.strawBase, dark: deriveDark(C.strawBase) },
  { base: C.rockShadow, dark: deriveDark(C.rockShadow) },
  { base: C.birchBase, dark: deriveDark(C.birchBase) }
]

/**
 * Tunic colours.
 *
 * The tunic is "the one saturated field on the figure, so it carries the read"
 * (palette §Characters), which means these have to separate from the *world*
 * rather than from each other: a tunic in `grassBase` is camouflage. Every stop
 * here is either a character colour or an equipment material — families authored
 * for objects held near the camera, with more contrast than the terrain.
 */
export const TUNIC_COLOURS: readonly ColourStop[] = [
  // Authored. The default.
  { base: C.tunicBase, dark: C.tunicShadow },
  { base: C.sandstoneBase, dark: deriveDark(C.sandstoneBase) },
  { base: C.needleBase, dark: deriveDark(C.needleBase) },
  { base: C.leatherBase, dark: C.leatherShadow },
  { base: C.cliffBase, dark: deriveDark(C.cliffBase) },
  { base: C.brassBase, dark: deriveDark(C.brassBase) }
]

/** Wraps rather than clamps, so a UI that increments an index cycles for free. */
const pick = <T>(list: readonly T[], index: number): T => {
  const size = list.length
  const safe = Number.isFinite(index) ? ((Math.trunc(index) % size) + size) % size : 0
  return list[safe]!
}

// ─── Eyebrow colour ─────────────────────────────────────────────────────────

const _srgb = new Color()
const _probe = new Color()

/**
 * Relative luminance in the space the palette was **authored** in.
 *
 * `Color` holds linear-sRGB, where every dark albedo in this project sits near
 * 0.015 and a threshold would be a statement about colour management rather than
 * about what the eye sees. The same function the R4 tests use.
 */
const authoredLuma = (colour: Color): number => {
  _srgb.copy(colour).convertLinearToSRGB()
  return 0.2126 * _srgb.r + 0.7152 * _srgb.g + 0.0722 * _srgb.b
}

/**
 * How far a brow is carried from the hair's base toward its own dark stop.
 *
 * A brow is hair, so it starts as the hair colour — but hair on the skull is a
 * large field lit by the ramp's top band while a brow is a 30 mm line lying flat
 * on skin, and at equal albedo the brow reads *lighter* than the hair it is
 * supposed to belong to. Most of the way to the dark stop puts it back.
 */
const BROW_DARKEN = 0.7

/**
 * Minimum authored-luma separation between a brow and the skin it lies on.
 *
 * **Calibrated against the figure rather than chosen.** On the darkest skin tone
 * the shipped eye (`eyeDark`) separates by 0.109 and the shipped mouth
 * (`faceLine`) by 0.060 — so 0.12 is "at least as legible as the eye that has
 * always shipped", and the mouth is the feature on this face that is genuinely
 * marginal, not the brow.
 */
export const BROW_MIN_CONTRAST = 0.12

/** R4's floor, restated as luma: a brow may be pushed dark, never to black. */
const BROW_LUMA_FLOOR = 0.05

/**
 * Scales `colour` in linear space until its **authored** luma reaches `target`.
 *
 * Bisection rather than a gamma-corrected multiply: authored luma is a linear
 * function of the sRGB components and the sRGB transfer curve has a linear toe,
 * so there is no closed form that stays exact near black. It is monotone in the
 * scale, which is all bisection needs, and it preserves hue and saturation
 * exactly — the brow stays recognisably the character's hair colour, only darker.
 * Runs once per body build, never in an update path.
 */
const toAuthoredLuma = (colour: Color, target: number): Color => {
  let low = 0
  let high = 1
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2
    _probe.copy(colour).multiplyScalar(mid)
    if (authoredLuma(_probe) > target) {
      high = mid
    } else {
      low = mid
    }
  }
  return colour.multiplyScalar((low + high) / 2)
}

/**
 * ─── The eyebrow's colour, and the argument the palette used to make ─────────
 *
 * `palette.ts` kept `faceLine` fixed on the grounds that "a brow tinted to match
 * blond hair disappears into the skin". Measured across the whole 5 hair × 5 skin
 * product, that specific fear does not hold and the opposite one does:
 *
 *   * The **palest skin** is authored-luma 0.880. The two light hair colours sit
 *     at 0.641 (`strawBase`) and 0.681 (`birchBase`), so blond-on-pale separates
 *     by 0.24 and 0.20 *before* any darkening — three times the separation the
 *     shipped mouth has on the darkest skin (0.060).
 *   * What actually collides is **light hair on mid or dark skin**. At the hair
 *     ramp's own dark stop, `rockShadow` on `skinTone4` separates by **0.009**
 *     and `strawBase` on `skinTone3` by **0.015**. Those are invisible, and no
 *     amount of taste fixes them because they are a property of the pair.
 *
 * So the brow is the hair colour in its own shadow, and then **guaranteed** to
 * clear the skin under it by `BROW_MIN_CONTRAST`. It is only ever pushed
 * *darker*: every hair colour here has room below every skin tone (the tightest
 * target is 0.119, well clear of R4), and a brow lighter than the skin reads as a
 * highlight rather than as hair.
 */
export const browColour = (appearance: CharacterAppearance): Color => {
  const hair = pick(HAIR_COLOURS, appearance.hairColour)
  const skin = pick(SKIN_TONES, appearance.skinTone)
  const brow = hair.base.clone().lerp(hair.dark, BROW_DARKEN)
  const skinLuma = authoredLuma(skin)
  if (Math.abs(authoredLuma(brow) - skinLuma) >= BROW_MIN_CONTRAST) {
    return brow
  }
  return toAuthoredLuma(brow, Math.max(BROW_LUMA_FLOOR, skinLuma - BROW_MIN_CONTRAST))
}

/**
 * The same guarantee, factored out, because a beard needs it for a different
 * reason and at a different strength.
 *
 * A brow is a 7 mm line lying flat on skin and reads by albedo alone, so it is
 * carried most of the way to its dark stop. A **beard is a mass** — 284 mm
 * across on `full`, hanging 200 mm off the jaw on `patriarch` — and the same
 * darkening is the exact failure `hairSpecs` records twice: at `hairDark` the
 * chin wedge "rendered as a black bib" and the mane "as a black ball", because
 * `hairDark` is `hairBase × 0.33` in linear space and the front of a figure in
 * this world faces away from the sun.
 *
 * So the beard starts a quarter of the way down instead of seven tenths, and
 * then takes the *same* floor: it must still clear the skin it is next to by
 * `BROW_MIN_CONTRAST`, or a light-haired character on mid skin has a beard that
 * is only visible where it leaves the head's outline. That pair — light hair on
 * mid or dark skin — is the one `browColour` measured as actually colliding, and
 * a beard covers far more of that skin than a brow does.
 */
const BEARD_DARKEN = 0.25

export interface BeardStops {
  /** The mass's lit end, guaranteed to clear the wearer's skin. */
  base: Color
  /** Its own shadow, and the value a binding or a braid's cord is drawn in. */
  dark: Color
}

export const beardStops = (appearance: CharacterAppearance): BeardStops => {
  const hair = pick(HAIR_COLOURS, appearance.hairColour)
  const skin = pick(SKIN_TONES, appearance.skinTone)
  const base = hair.base.clone().lerp(hair.dark, BEARD_DARKEN)
  const skinLuma = authoredLuma(skin)
  if (Math.abs(authoredLuma(base) - skinLuma) < BROW_MIN_CONTRAST) {
    toAuthoredLuma(base, Math.max(BROW_LUMA_FLOOR, skinLuma - BROW_MIN_CONTRAST))
  }
  return { base, dark: hair.dark.clone() }
}

/**
 * The wearer's skin, for the one feature that is made of it.
 *
 * `bodyPalette` already returns this and four other colours; a nose wants the
 * one and building the other four to get it would tie the feature block to the
 * tunic, which it has nothing to do with.
 */
export const skinColour = (appearance: CharacterAppearance): Color => pick(SKIN_TONES, appearance.skinTone).clone()

export interface BodyPalette {
  skin: Color
  hair: Color
  hairDark: Color
  tunic: Color
  tunicShadow: Color
}

/**
 * The five colours the body is painted from.
 *
 * **The boots are not in here.** `hairBase`/`hairDark` do double duty in the
 * palette — "hair and boots share a value so the silhouette closes top and
 * bottom" — and that coincidence stops being one the moment hair is
 * customisable: a blond character with blond boots is a bug that looks like a
 * feature. The shin and foot parts keep the literal palette entries.
 */
export const bodyPalette = (appearance: CharacterAppearance): BodyPalette => {
  const hair = pick(HAIR_COLOURS, appearance.hairColour)
  const tunic = pick(TUNIC_COLOURS, appearance.tunicColour)
  return {
    skin: pick(SKIN_TONES, appearance.skinTone),
    hair: hair.base,
    hairDark: hair.dark,
    tunic: tunic.base,
    tunicShadow: tunic.dark
  }
}

// ─── Build ──────────────────────────────────────────────────────────────────

export interface BuildProfile {
  /** Torso radius at the hips joint. */
  hipRadius: number
  /** Torso radius at the chest joint. */
  chestRadius: number
  /** `[depth, width]` — see the note in `face.ts` on which index is which. */
  torsoCrossSection: readonly [number, number]
  /** Multiplies every arm and leg radius. Not the neck, not the head. */
  limbScale: number
}

/**
 * Sex, at three heads tall.
 *
 * Everything that distinguishes an adult male from an adult female body at this
 * scale is either **the torso** or is smaller than a pixel at 20 m. So this is
 * three numbers and no triangles:
 *
 * • **Shoulder-to-hip.** Male tapers *down* (chest 0.17 → hips 0.15, a width
 *   ratio of 1.13); female tapers *up* (chest 0.150 → hips 0.163, ratio 0.92).
 *   The sign of the taper is the cue, not its magnitude.
 * • **Chest depth.** The male torso is a barrel — `crossSection[0]` (depth) at
 *   1.15 against 1.08 — which is what carries the difference in profile, where
 *   the A-pose arms are not in the way.
 * • **Limb mass**, 6 % thinner.
 *
 * **What was considered and cut**: a smaller female head. It is free (the head
 * is a warp), and it is wrong twice — the head is the unit "three heads tall" is
 * measured in, so scaling it changes the figure's read rather than its sex; and
 * scaled *together* with narrower shoulders it holds the head-to-shoulder ratio
 * constant, cancelling the one cue it was added to support.
 *
 * **What does not read, honestly**: the shoulder line itself. The A-pose puts
 * the upper arm at x = ±0.17 with a 0.062 radius, so the outline at the
 * shoulders is the *arm*, not the torso, from directly in front. The taper reads
 * in three-quarter, from behind, and at the waist — which is most of the time a
 * player sees a character in this world, but not all of it.
 *
 * `male` is the shipped figure, unchanged, because it is the default.
 */
export const BUILDS: Record<Sex, BuildProfile> = {
  male: { hipRadius: 0.15, chestRadius: 0.17, torsoCrossSection: [1.15, 0.85], limbScale: 1 },
  female: { hipRadius: 0.163, chestRadius: 0.15, torsoCrossSection: [1.08, 0.9], limbScale: 0.94 }
}

// ─── Head shape ─────────────────────────────────────────────────────────────

/** Centre of the head *volume* — midway between the part's two joints. */
const HEAD_CENTRE_Y = (HEAD.centre[1] + HEAD.top[1]) / 2
/** Half its height: the cap radius plus half the 20 mm axis. */
const HEAD_HALF_HEIGHT = HEAD.radius + (HEAD.top[1] - HEAD.centre[1]) / 2

/** Quadratic in `h`, the normalised height through the head (−1 chin, +1 crown). */
type Profile = readonly [number, number, number]

const profile = (k: Profile, h: number): number => k[0] + k[1] * h + k[2] * h * h
const profileSlope = (k: Profile, h: number): number => k[1] + 2 * k[2] * h

/**
 * A shape change applied to the head **after** it is built.
 *
 * Not a change to the head's `PartSpec`, and that is the whole design. `face.ts`
 * ray-casts every feature onto a head it rebuilds from its own mirrored `HEAD`
 * constants; change the radius or the tessellation and the mirror goes stale and
 * the face slides off the skull. A warp leaves the built surface exactly as
 * `face.ts` believes it to be, and is then applied to the head, the hair *and*
 * the face together — so the features ride the shape change instead of being
 * invalidated by it.
 *
 * The map, in head-local space, is separable:
 *
 *     x' = x · width(h)      z' = z · depth(h)      y' = cy + (y − cy) · height
 *
 * with `h = (y − cy) / halfHeight`. Normals come from the **inverse transpose**
 * of its Jacobian in closed form (GDD R3 — never `computeVertexNormals`, never a
 * difference): a non-uniform scale shaded with un-transformed normals is the
 * classic error that makes a squashed head light like a round one, and the toon
 * ramp's banding makes it obvious rather than subtle.
 */
export interface HeadWarp {
  /** True when the warp is exactly the identity, so callers can skip it. */
  identity: boolean
  centreY: number
  halfHeight: number
  height: number
  width: Profile
  depth: Profile
}

/**
 * The four head shapes.
 *
 * Volume is held within ±7 % of round and the crown within 18 mm of
 * `FIGURE_HEIGHT`, because both of those are what "three heads tall" means —
 * a head that changes size changes the *character's* size, which is a different
 * feature. Within that box the shapes are pushed as far as they go:
 *
 * • **round** — the identity. The shipped head. Must stay exactly 1/0/0.
 * • **oval** — 33 mm narrower and 16 mm taller, with the width peaking just
 *   above centre and falling to 0.85 at the chin: an egg, not a cylinder.
 * • **square** — 28 mm broader, and *widened toward both poles* (the `h²` term),
 *   which is what flattens the crown: the canonical radius still goes to zero at
 *   the top, so the apex stays an apex, but the shoulder of the profile squares
 *   off. 16 mm shorter, which is where the extra width is paid for — the two
 *   extremes are deliberately symmetric about `FIGURE_HEIGHT`.
 * • **heart** — width peaks at h ≈ +0.45 (the temples, 1.06) and falls to 0.85
 *   at the jaw. The face sits at h ≈ −0.26, so the eyes come 5 % closer together
 *   on a heart face and 7 % further apart on a square one, for free.
 */
const HEAD_SHAPES: Record<HeadShape, { height: number; width: Profile; depth: Profile }> = {
  round: { height: 1, width: [1, 0, 0], depth: [1, 0, 0] },
  oval: { height: 1.06, width: [0.93, 0.05, -0.03], depth: [0.97, 0.02, -0.015] },
  square: { height: 0.94, width: [1.06, 0, 0.1], depth: [1.03, 0, 0.07] },
  heart: { height: 1, width: [1.04, 0.09, -0.1], depth: [1, 0.04, -0.05] }
}

/**
 * Volume the *hair* contributes to the head, removed when there is none.
 *
 * Only `bald` differs, and it is the answer to "a bald head must still read as a
 * head, not as a face on a sphere". A painted bowl cut is drawn on a skull that
 * was sized to sit *inside* hair; strip the hair and leave the ball and you get
 * exactly the sphere that warning is about. So bald narrows 2.5 % and deepens
 * 2.5 % — a cranium with an occiput rather than a ball — and, like every style
 * that does not cover them, it shows both ears (see `EAR_COVER`).
 *
 * **Height stays at 1.** It is tempting to dome the crown, and it composes with
 * the head shape: `oval` is already 1.06, and 1.03 on top of it put the crown
 * 27 mm proud of `FIGURE_HEIGHT`. Hair may change the head's shape; it may not
 * change the figure's height. The width/depth pair is volume-neutral to 0.06 %,
 * so composing it with any head shape cannot walk that budget either.
 */
const NO_VOLUME_CHANGE = { height: 1, width: 1, depth: 1 } as const

const HAIR_VOLUME: Record<HairStyle, { height: number; width: number; depth: number }> = {
  bowl: NO_VOLUME_CHANGE,
  short: NO_VOLUME_CHANGE,
  ponytail: NO_VOLUME_CHANGE,
  braids: NO_VOLUME_CHANGE,
  long: NO_VOLUME_CHANGE,
  bald: { height: 1, width: 0.975, depth: 1.025 },
  topknot: NO_VOLUME_CHANGE,
  buns: NO_VOLUME_CHANGE,
  bun: NO_VOLUME_CHANGE,
  plaits: NO_VOLUME_CHANGE,
  flowing: NO_VOLUME_CHANGE,
  queue: NO_VOLUME_CHANGE,
  bob: NO_VOLUME_CHANGE,
  tresses: NO_VOLUME_CHANGE,
  wild: NO_VOLUME_CHANGE,
  swept: NO_VOLUME_CHANGE,
  fringe: NO_VOLUME_CHANGE,
  bearded: NO_VOLUME_CHANGE,
  mane: NO_VOLUME_CHANGE,
  /**
   * The second style that uses this lever, and the only one that uses it to make
   * a head *bigger* in any axis.
   *
   * A coif is a linen cap tied under the chin, and what it does to a head is
   * flatten it front-to-back and push the volume out at the temples. So 7 %
   * broader and 6.5 % shallower — 33 mm of extra width, 33 mm off the depth, and
   * no mesh at all (see `hairSpecs`). It warps the face along with the skull, so
   * a coif also sets the eyes 7 % further apart: free, and one more thing that is
   * different about the person wearing it.
   *
   * **`height` is 1 and cannot be anything else.** Flattening the crown is the
   * obvious third term, and it composes with the head shape: 0.98 on top of
   * `square`'s own 0.94 put the crown at 1.5395, which is 20 mm *under*
   * `FIGURE_HEIGHT` and outside the 18 mm the figure is held to. Hair may change
   * the head's shape; it may not change the figure's height, in either direction.
   *
   * The product is 1.00003, so it is volume-neutral for the same reason `bald`'s
   * is: composing it with `square` (already 1.06 wide) must not walk the head
   * outside the ±7 % the shape test allows.
   */
  coif: { height: 1, width: 1.09, depth: 0.9174 },
  receding: NO_VOLUME_CHANGE
}

const scaleProfile = (k: Profile, factor: number): Profile => [k[0] * factor, k[1] * factor, k[2] * factor]

const isIdentity = (k: Profile): boolean => k[0] === 1 && k[1] === 0 && k[2] === 0

export const headWarp = (appearance: CharacterAppearance): HeadWarp => {
  const shape = HEAD_SHAPES[appearance.head]
  const volume = HAIR_VOLUME[appearance.hair]
  const width = scaleProfile(shape.width, volume.width)
  const depth = scaleProfile(shape.depth, volume.depth)
  const height = shape.height * volume.height
  return {
    // Exact equality, not a tolerance: this flag decides whether the default
    // figure takes the warp path at all, and "close to identity" is a repaint.
    identity: height === 1 && isIdentity(width) && isIdentity(depth),
    centreY: HEAD_CENTRE_Y,
    halfHeight: HEAD_HALF_HEIGHT,
    height,
    width,
    depth
  }
}

/**
 * Warps one vertex in place — position **and** normal, together, because the
 * normal transform needs the *pre-warp* position and doing them in two passes is
 * how that gets lost.
 */
export const warpVertex = (warp: HeadWarp, position: Vector3, normal: Vector3): void => {
  const x = position.x
  const y = position.y
  const z = position.z
  const h = (y - warp.centreY) / warp.halfHeight
  const a = profile(warp.width, h)
  const b = profile(warp.depth, h)
  const c = warp.height
  // d(scale)/dy, not d(scale)/dh — the Jacobian wants it per metre.
  const da = profileSlope(warp.width, h) / warp.halfHeight
  const db = profileSlope(warp.depth, h) / warp.halfHeight

  // n' = J⁻ᵀ n. J is [[a, x·da, 0], [0, c, 0], [0, z·db, b]], so the inverse
  // transpose is lower-triangular with the shear landing entirely in y — which
  // is the term that tilts a normal on a head whose width changes with height.
  // Drop it and a heart-shaped jaw shades as if it were still round.
  const nx = normal.x / a
  const nz = normal.z / b
  const ny = normal.y / c - (x * da * normal.x) / (a * c) - (z * db * normal.z) / (b * c)
  normal.set(nx, ny, nz).normalize()

  position.set(x * a, warp.centreY + (y - warp.centreY) * c, z * b)
}

// ─── Hairline ───────────────────────────────────────────────────────────────

/**
 * Where the head part's skin→hair ramp lands, per style, **in the head part's
 * own `along` parameter** rather than in metres.
 *
 * `along` is `(y − 1.29) / 0.02` for the head — one unit is the 20 mm axis
 * between its two joints, and the ramp spans exactly one unit. Expressing the
 * offset here means the default is a literal zero, and `(t − 0) / 1` is `t` in
 * IEEE-754, so the shipped figure comes out bit-identical rather than
 * bit-nearly-identical.
 *
 * `bald` is 0.25 and unused: its ramp runs skin → skin, so there is no line to
 * place. It sits on the floor with the rest so that the invariant "no style's
 * line comes within 5 mm of a face vertex" can be asserted over *all* of them
 * rather than over all-but-one.
 *
 * ── The floor moved from −0.25 to +0.25, and the brow is why ────────────────
 *
 * The old floor was set by the **eyelid**: the ramp starts at `1.29 + 0.02·t`,
 * the highest face vertex was the top of the eye dome at 1.277, and −0.25 put
 * the line at 1.285 with 8 mm of clearance. Anything lower painted hair onto an
 * eyelid.
 *
 * The face now has brows, and a brow's highest vertex sits at 1.2875 — 10.5 mm
 * above the old ceiling, because there was no band between the eye and the
 * hairline for one to go in (see `BROW_CEILING` in `face.ts`, which is derived
 * from *this* number rather than the other way round). So the floor is +0.45,
 * a line at 1.299, and it is now set by the brow.
 *
 * What it costs: **14 mm of forehead on the nine styles that sat on the floor,
 * and 9 mm on `bowl` and `braids`.** The note that used to live here says 5 mm of hairline is
 * a quarter of a pixel at 20 m; this is under one. It is on the right side of
 * the trade the other way too — at +25 mm the painted hair retreats far enough
 * that a figure reads as balding with a tuft (measured on `ponytail`, in
 * three-quarter view at 7 m), and +5 mm is a fifth of that.
 */
export const HAIRLINE: Record<HairStyle, number> = {
  bowl: 0.45,
  // +35 mm: a crop shows forehead, and the fringe stops well above the eyes.
  short: 1.75,
  // +10 mm: pulled back off the face, but only just. At +25 mm the painted hair
  // retreated far enough up the skull that the figure read as balding with a
  // tuft rather than as hair tied back — measured in three-quarter view at 7 m.
  ponytail: 0.5,
  braids: 0.45,
  // The floor. Long hair sits as low on the brow as anything on this figure may.
  long: 0.45,
  bald: 0.45,

  // ── The fifteen added for the city ────────────────────────────────────────
  //
  // +0.25 is the floor and it is not a taste decision — see the note above.
  // Every style that wants hair low on the brow shares that one value rather
  // than inventing a lower one, and it is keyed to the *pre-warp* height so it
  // means the same thing on all four head shapes.

  // +25 mm: swept up into the knot, so the temples clear.
  topknot: 1.25,
  // +10 mm: drawn back into the coils, like the ponytail it is a cousin of.
  buns: 0.5,
  // +20 mm: pulled back tight, which is the front-facing half of this style —
  // from directly ahead a nape bun *is* its hairline and nothing else.
  bun: 1,
  plaits: 0.5,
  flowing: 0.45,
  // +25 mm: the same tight pull as `bun`. `queue` is read from behind and `bun`
  // from the side, so they share a front.
  queue: 1.25,
  bob: 0.45,
  tresses: 0.45,
  wild: 0.45,
  swept: 0.45,
  // +25 mm, which is the opposite of what a heavy fringe looks like it wants and
  // is set by the mesh rather than by taste. The fringe's lower rim comes to rest
  // at y 1.3054, a few millimetres outside the skull — and it carries the mix
  // toward `hairDark`, so with the line at 1.29 it laid a dark seam across a
  // brow the skull had already painted `hair`. Raising the line to 1.315 puts the
  // rim *below* it, where dark hair against skin is simply a fringe. The temples
  // then show 25 mm of forehead, which is what hair swept into a fringe does.
  fringe: 1.25,
  // +60 mm. A beard is an *old man*, and the hairline is half of what says so.
  bearded: 3,
  mane: 0.45,
  coif: 0.45,
  // +80 mm, the highest on the figure: the line clears the crown's shoulder and
  // leaves a 170 mm cap of hair on top of a 310 mm field of forehead. At +60 it
  // was 25 mm from `short`, which is 1.3 px at 20 m and therefore not a style.
  receding: 4
}

/**
 * How far a style's **hair** may rise above the crown of the same head with no
 * hair on it, in metres.
 *
 * Stated against the skull rather than against `FIGURE_HEIGHT` because the head
 * shape gets there first: `oval` is 1.06 tall, which already puts the bare crown
 * at 1.5756 — 15.6 mm of the 18 mm the figure is allowed. Measuring hair against
 * `FIGURE_HEIGHT` would therefore make "may hair change the figure's height?"
 * mean something different on each of the four heads, and on `oval` it would mean
 * "no, not by anything". Against the skull it means the same thing everywhere,
 * and the figure's own height stays pinned separately by the body.
 *
 * **Zero for nineteen of the twenty-one.** Hair may change the head's shape; it
 * may not change the figure's height (the note on `HAIR_VOLUME` says the same
 * thing about the warp, and `long` was rooted 60 mm lower than its author first
 * wanted for exactly this). Two exceptions, both earned:
 *
 * • **`topknot`, 50 mm.** Up is the only direction on this figure that nothing
 *   else uses — every other mesh breaks the hull sideways, backward or forward,
 *   and `bald`/`coif` move the crown by millimetres. A crowd read from a
 *   downward-looking orbit needs one break that survives every bearing. 18 mm of
 *   knot on a 0.52 m head is one pixel at 20 m and is not a silhouette; 43 mm
 *   (measured, worst head shape) is two and a half, and it arrives 125 mm behind
 *   the crown, so it reads as an ornament on the head rather than as a taller
 *   person. That is 2.9 % of the figure.
 * • **`mane`, 20 mm.** Not a design choice — an ellipsoid that encloses the skull
 *   at the temples necessarily clears it at the pole. 14 mm, measured.
 */
export const crownHeadroom = (hair: HairStyle): number => (hair === 'topknot' ? 0.05 : hair === 'mane' ? 0.02 : 0)

// ─── Hair geometry ──────────────────────────────────────────────────────────

/**
 * One swept part of a hairstyle. Built with `limbMesh` for the same reason the
 * body is: analytic normals from the radius profile, spherical caps that *are*
 * the profile so there is no cut to bevel (GDD R1/R3), and one shading solution
 * shared with everything else on the figure.
 */
export interface StrandSpec {
  from: readonly [number, number, number]
  to: readonly [number, number, number]
  radiusStart: number
  radiusEnd: number
  radial: number
  rings: number
  capRings: number
  crossSection?: readonly [number, number]
  colorStart: Color
  colorEnd: Color
}

export interface HairMesh {
  position: Float32Array
  normal: Float32Array
  color: Float32Array
  /**
   * The head part's `along` at each vertex's height.
   *
   * The skin weights are derived from this and nothing else, so hair adopts the
   * **skull's own binding** at every height — the lesson `face.ts` paid 49.6 mm
   * to learn, applied to a second thing glued to the head. The alternative,
   * weight 1 on `head`, is what a strand "obviously" wants, and it means a
   * long-hair mass rigid to the head and a skull blended toward the neck slide
   * ~44 mm apart at 25° of head yaw — the skull erupts through the back of its
   * own hair. A tail that follows a head turn at 50 % instead of 100 % is
   * invisible at 20 m; that is not.
   */
  along: Float32Array
  index: Uint32Array
}

/** `along` per metre of height, from the head part's 20 mm axis. */
const ALONG_PER_METRE = 1 / (HEAD.top[1] - HEAD.centre[1])

// ─── Ears ───────────────────────────────────────────────────────────────────

/**
 * ─── Ears belong to the head, not to the haircut ────────────────────────────
 *
 * They used to be a strand appended by `hairSpecs`, so *every style decided
 * whether the character had ears at all* — which meant a bowl cut produced a
 * person with no ears rather than a person whose ears are covered, and adding a
 * twenty-second style meant remembering to grow a pair. They are now emitted by
 * the body (`chibiGeometry`), and a hairstyle's only say is the negative one
 * below: whether its own mass would be sitting where an ear is.
 *
 * That inversion is the whole change. `EAR_COVER` reads as "what this haircut
 * hides", so the default for anything new is **two ears**, and a style only
 * appears here if it has geometry at the temples.
 *
 * They stay the cheapest thing on the figure that says "head" rather than
 * "ball" — 30 triangles each, 30 mm proud of the skull, in the outline hull so
 * they get the 1.6 px rim that draws them.
 *
 * `right` is the character's right, at **−X** (see the rig note in
 * `equipment.ts`); it exists for `swept`, whose whole point is that the two sides
 * of the head are not the same.
 */
export type EarVisibility = 'both' | 'right' | 'none'

/**
 * Which ears each style leaves showing. Absent from this table means "both",
 * which is the point of writing it as a partial record.
 *
 * The eleven that hide something are exactly the eleven with mass at the
 * temples, and each would otherwise poke an ear straight through its own hair.
 * **`bowl` is no longer one of them**, and that is the one visible change to a
 * shipped figure: the painted bowl cut's hairline sits at the head's equator
 * (y = 1.29) and the ear's highest vertex reaches 1.2892, so the hair does not
 * cover the ear — it stops 0.8 mm above it. Listing `bowl` as covered was the
 * old table's opt-*in* default showing through, not a measurement, and it left
 * the game's default character earless.
 */
const EAR_COVER: Partial<Record<HairStyle, EarVisibility>> = {
  braids: 'none',
  long: 'none',
  buns: 'none',
  plaits: 'none',
  flowing: 'none',
  bob: 'none',
  tresses: 'none',
  wild: 'none',
  // One lobe over the character's left temple; the right side carries nothing,
  // which is half of what makes this style asymmetric.
  swept: 'right',
  mane: 'none',
  // A linen cap tied under the chin. The one *painted* style that covers them.
  coif: 'none'
}

/** Which ears a style leaves showing. Everything not in `EAR_COVER` shows both. */
export const visibleEars = (hair: HairStyle): EarVisibility => EAR_COVER[hair] ?? 'both'

/**
 * One ear, on `side` (+1 is the character's left, at +X).
 *
 * Rooted 65 mm inside the skull so no seam can open at any head shape, and
 * reaching 30 mm proud of it. Flattened to a quarter of its height in depth —
 * `crossSection` here is [depth, height], the axis being ±X. The numbers are the
 * measured ones from when ears were a hair strand and are unchanged; only who
 * decides to emit them has moved.
 */
const earSpec = (side: 1 | -1, skin: Color): StrandSpec => ({
  from: [side * 0.2, 1.245, -0.012],
  to: [side * 0.238, 1.252, -0.012],
  radiusStart: 0.034,
  radiusEnd: 0.024,
  radial: 5,
  rings: 1,
  capRings: 1,
  crossSection: [0.5, 1.3],
  colorStart: skin,
  colorEnd: skin
})

/**
 * The ears, as a mesh in the same shape `hairMesh` returns.
 *
 * Deliberately the same struct: `chibiGeometry` appends both blocks through one
 * loop, so ears get the head-shape warp and the **skull's own skin weights at
 * their height** for free — the 49.6 mm-of-slide lesson `face.ts` paid for,
 * which applies to anything glued to the head and which a separate append path
 * would be free to get wrong.
 */
export const earMesh = (appearance: CharacterAppearance): HairMesh | null => {
  const ears = visibleEars(appearance.hair)
  if (ears === 'none') {
    return null
  }
  const skin = pick(SKIN_TONES, appearance.skinTone)
  return buildStrands(ears === 'both' ? [earSpec(1, skin), earSpec(-1, skin)] : [earSpec(-1, skin)])
}

/**
 * The styles, as geometry.
 *
 * ── The one test a style has to pass ────────────────────────────────────────
 *
 * **It has to change the outline, and in a direction something else does not.**
 * At 20 m one pixel is 19 mm of character and the whole head is 27 px, so a
 * hairstyle is a handful of pixels of shape; a bob and a bowl differ by 3 cm of
 * outline and read as the same person across a field. What survives is *where the
 * hull is broken* — up, back, out, forward, down past the shoulders — *how far*,
 * and *whether it is symmetric*. Everything else is hairdressing.
 *
 * So the twenty-one are spread over that space rather than over fashion, and the
 * six painted ones are painted because 10 mm of hair thickness on a 0.5 m head is
 * half a pixel and a shell for it would be 50 triangles of nothing:
 *
 * | direction broken | styles |
 * |---|---|
 * | nothing (paint + head volume) | `bowl` `short` `bald` `coif` `receding` |
 * | up | `topknot` |
 * | back, compact | `bun` |
 * | back, hanging | `ponytail` |
 * | back, to the shoulders | `long` |
 * | back, to the waist | `flowing` (mass) `queue` (rope) |
 * | out at the temples | `buns` (compact) `plaits` (projecting) |
 * | down beside the face | `braids` (thin) `bob` (jaw flare) `tresses` (to the collarbone) |
 * | forward | `fringe` |
 * | all round | `mane` |
 * | jagged, asymmetric | `wild` |
 * | one side only | `swept` |
 * | below the chin | `bearded` |
 *
 * ── Every strand is rooted inside the skull ─────────────────────────────────
 *
 * Not against it: *inside* it, by 40 mm or more, so that no head shape — the warp
 * scales width by up to 1.06 and depth by up to 1.07 — can open a seam where a
 * strand leaves the head. The cost is nothing, because the buried end is hidden
 * by the skull it is buried in, and the alternative is a gap that appears on one
 * of four head shapes and is invisible on the other three.
 *
 * `colorStart` is therefore always `hair` exactly: the root sits where the skull
 * is already painted hair, and a root in any other value draws the figure a
 * second hairline a few centimetres from its first. `colorEnd` is `hairDark` at
 * the far end, which is where a mass is in its own shadow.
 */
const hairSpecs = (appearance: CharacterAppearance, hair: Color, hairDark: Color): StrandSpec[] => {
  const specs: StrandSpec[] = []

  /**
   * How far a strand's far end is carried toward `hairDark`.
   *
   * 1 for the five that shipped, and it is right for them: a ponytail, a braid
   * and a long mass all hang *away* from the head into their own shadow, and the
   * dark end is the last 100 mm of a 300 mm strand.
   *
   * It is wrong for a small mass, and that is a measured finding rather than a
   * preference. `hairDark` is `hairBase × 0.33` in linear space, so on a strand
   * short enough that the far end is most of what you can see, a third of the
   * albedo *is* the style. Rendered at 2.6 m the first pass had a topknot and a
   * set of spikes that read as black antennae and a beard that read as a black
   * bib — not hair in shadow, ink. Anything under ~150 mm therefore mixes only
   * part of the way, and the two masses that press flat against the skull
   * (`buns`, `wild`) do not darken at all: a coil against the head has no far
   * end to be in shadow.
   */
  const strand = (
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    radiusStart: number,
    radiusEnd: number,
    radial: number,
    rings: number,
    capRings: number,
    crossSection?: readonly [number, number],
    endMix = 1
  ): StrandSpec => ({
    from,
    to,
    radiusStart,
    radiusEnd,
    radial,
    rings,
    capRings,
    crossSection,
    colorStart: hair,
    // `endMix === 1` hands back the palette's own `hairDark` object rather than a
    // clone of it, so the five shipped styles keep the exact bytes they had.
    colorEnd: endMix === 1 ? hairDark : hair.clone().lerp(hairDark, endMix)
  })

  switch (appearance.hair) {
    case 'bowl':
    case 'short':
    case 'bald':
    case 'coif':
    case 'receding':
      // Painted. `bowl` is the default and must emit **nothing**, or the shipped
      // figure stops being byte-identical.
      break
    case 'ponytail':
      specs.push(
        // Root above the hairline where the skull is already hair-coloured, so
        // the join needs no seam.
        //
        // The first pass ran 1.435 → 1.16 at z −0.175 → −0.30 and **it did not
        // read**: rendered at 7 m in three-quarter view the tail was entirely
        // inside the skull's own silhouette, because the skull reaches z = −0.25
        // at its equator and the tail only cleared that below y = 1.20, where it
        // was already 28 mm thick. 812 triangles of nothing. It is now rooted
        // 15 mm further back and hangs 90 mm lower and 63 mm further out, which
        // puts ~50 mm of tail outside the skull at the equator and 120 mm of it
        // below — a ponytail rather than a bun.
        strand([0, 1.44, -0.19], [0, 1.1, -0.35], 0.062, 0.03, 6, 1, 2, [1, 0.85])
      )
      break
    case 'braids':
      for (const side of [1, -1] as const) {
        specs.push(strand([side * 0.21, 1.36, -0.02], [side * 0.24, 1.06, -0.04], 0.048, 0.032, 5, 2, 1))
      }
      break
    case 'long':
      specs.push(
        // A closed mass behind the head rather than an open shell. An open shell
        // would show its inside face through the outline pass, which draws
        // `BackSide`; a solid one shares the skull's own hair colour where they
        // overlap and reads as one volume.
        //
        // `crossSection` is [front-back, width] for this near-vertical axis. The
        // depth term is set by the skull, not by taste: the mass has to stay
        // behind the skull's back surface all the way down or a skin-coloured
        // patch of cranium shows through the hair. At y = 1.29 the skull reaches
        // z = −0.250 and the mass reaches −0.256.
        //
        // `from` is 1.34 and not 1.40 because the *start cap* extends a full
        // `radiusStart` back up the axis — a 0.215 m cap on a joint at 1.40 put
        // the top of the hair at 1.614, 54 mm proud of a figure whose whole
        // proportion is named after its height. It costs nothing: everything
        // above the hairline is already hair-coloured skull.
        strand([0, 1.34, -0.075], [0, 1.09, -0.11], 0.215, 0.15, 8, 2, 1, [0.86, 1.2])
      )
      break

    // ── Up ───────────────────────────────────────────────────────────────────
    case 'topknot':
      specs.push(
        // The only style that breaks the hull upward, which is why it is worth
        // the crown headroom it takes: 43 mm on the worst head shape, measured
        // (see `crownHeadroom`).
        //
        // Rooted at y 1.45 / z −0.05, which is 157 mm inside the skull, and aimed
        // up-and-back so the knot erupts through the crown's rear shoulder rather
        // than standing on the apex. Two reasons it is
        // canted rather than vertical: a vertical knot on the apex is the one
        // place a hat's inner crown lands (`HAT_CLEARANCE`), and a mass directly
        // over the head foreshortens to nothing under this world's downward-
        // looking orbit camera, where a canted one keeps its length.
        //
        // `rings: 1` is load-bearing, not thrift. The lateral samples of
        // `limbMesh` land at `i/rings`, so rings = 1 puts the only non-cap ring at
        // the *tip* — and every vertex between the buried root and the tip
        // therefore belongs to the root cap and carries `hair` exactly. Give it
        // two rings and a half-dark vertex lands in the eruption, which is a
        // value step across the crown that no other style has.
        //
        // The far joint is at z −0.175 and not −0.135 for a measured reason: at
        // −0.135 the tip ring came to rest 15.8 mm outside a skull the hairline
        // paints `hair`, carrying the mix toward `hairDark`. 40 mm further back
        // the whole ring stands 29 mm clear and the knot reads as a mass with an
        // edge instead of as a seam on the crown.
        strand([0, 1.45, -0.05], [0, 1.535, -0.175], 0.058, 0.067, 6, 1, 2, [1, 0.92], 0.5)
      )
      break

    // ── Out at the temples ───────────────────────────────────────────────────
    case 'buns':
      for (const side of [1, -1] as const) {
        // Plaits coiled over the ears — the 15th-century "templers", and the one
        // period style that is also a clean silhouette: two balls at ear height
        // take the head from 470 mm wide to 614, which is 7 px at 20 m and
        // survives from the front, the side and behind.
        //
        // The axis is ±X, so `crossSection` scales [Z, Y] here: 1.1 on both rounds
        // the coil out of the flattened profile a horizontal `limbMesh` would
        // otherwise inherit.
        //
        // **`endMix` is 0**, and that is what lets the coils sit at ear height at
        // all. Their far ring reaches 71 mm above its own axis, which puts its top
        // vertex 12.7 mm outside a skull the hairline paints `hair` — outside the
        // *built* 9-gon, which sits up to 6 % inside the ellipsoid it approximates,
        // so the ideal-surface arithmetic said buried and the mesh said otherwise.
        // Carrying `hairDark` there draws a second hairline; carrying `hair` draws
        // a coil. The first pass dodged it by dropping the coils 20 mm onto the
        // cheek, where they read at 2.6 m as earmuffs.
        specs.push(strand([side * 0.195, 1.245, -0.015], [side * 0.232, 1.245, -0.015], 0.072, 0.075, 6, 1, 1, [1.1, 1.1], 0))
      }
      break
    case 'plaits':
      for (const side of [1, -1] as const) {
        // The same axis as `buns` taken to its extreme: plaits that project
        // *outward and down* rather than coiling. 384 mm of half-width against
        // the skull's 235 — the widest silhouette on the figure, and the only one
        // that is unmistakable in a crowd from directly in front.
        //
        // Rooted at y 1.36, above the painted line at 1.30, so the plait leaves
        // the head through hair. At 1.275 it left through the *cheek*, and two
        // dark wings growing out of bare skin read at 2.6 m as ears rather than
        // as hair — the same detachment `swept` had, from the same cause.
        specs.push(strand([side * 0.185, 1.36, -0.02], [side * 0.355, 1.21, -0.07], 0.058, 0.04, 5, 1, 1, undefined, 0.6))
      }
      break

    // ── Back ─────────────────────────────────────────────────────────────────
    case 'bun':
      specs.push(
        // A nape bun: 88 mm proud of the back of the skull and nothing else.
        // Against `ponytail` it is compact where the tail hangs; against `long`
        // it is 36 triangles where the mass is 64. Flattened to 0.85 in Y so it
        // reads as coiled rather than as a ball stuck on.
        //
        // It sits at y 1.24 and not 1.29 for a measurable reason: the far ring
        // carries `hairDark`, and 48 mm higher its upper vertices came to rest
        // 0.5–22 mm outside a skull that is painted `hair` there — two vertices
        // of a second hairline, on the one style whose whole silhouette is at the
        // back of the head. On the nape, where a bun belongs, the ring tops out
        // at 1.2995, below the painted line at 1.31, and the question does not
        // arise.
        strand([0, 1.26, -0.19], [0, 1.24, -0.245], 0.062, 0.07, 6, 1, 1, [1, 0.85])
      )
      break
    case 'flowing':
      specs.push(
        // `long` taken to the waist. It ends at y 0.686, which is 255 mm below
        // where `long` ends — 13 px at 20 m, and the largest single silhouette
        // difference any two styles here have.
        //
        // The taper is what keeps it off the arms: 224 mm of half-width at the
        // crown narrowing to 132 at the hem, so at y 0.95 it is 9 mm wider than
        // the torso and 32 mm behind it, and the A-pose upper arm at x 0.19
        // never meets it.
        strand([0, 1.33, -0.07], [0, 0.8, -0.13], 0.2, 0.115, 7, 2, 1, [0.8, 1.15])
      )
      break
    case 'queue':
      specs.push(
        // The same length as `flowing` and a fortieth of the volume: a plait
        // hanging clear of the back. It only leaves the skull's own silhouette
        // below y 1.11, and everything after that is 340 mm of rope against the
        // tunic — a line rather than a mass, which is the whole distinction.
        //
        // It hangs at z −0.235 rather than −0.18 because the torso's back surface
        // is at −0.196: a queue any closer is *inside* the body it is supposed to
        // hang against, and disappears entirely from the side.
        strand([0, 1.36, -0.155], [0, 0.8, -0.235], 0.045, 0.028, 5, 2, 1, [1, 0.9])
      )
      break

    // ── Down beside the face ─────────────────────────────────────────────────
    case 'bob':
      for (const side of [1, -1] as const) {
        // A page cut, as two lobes rather than as a shell.
        //
        // A shell was tried on paper and cannot work with this primitive: the bob
        // and the skull are both ellipsoids on the same axis, so a shell either
        // encloses the skull everywhere (which is `mane`) or nowhere. Two lobes
        // beside the head give the read the shell was for — the outline keeps its
        // full width down to the jaw instead of tapering to the neck, so the head
        // is a trapezoid rather than a circle — for half the triangles.
        //
        // 290 mm of half-width at y 1.13 against the skull's 181 there. The lobes
        // end at y 1.056, just below the head, so the jaw line is where the hair
        // stops.
        specs.push(strand([side * 0.185, 1.3, -0.01], [side * 0.215, 1.13, -0.025], 0.07, 0.075, 5, 1, 1))
      }
      break
    case 'tresses':
      for (const side of [1, -1] as const) {
        // Two locks brought *forward* over the shoulders — the only style that
        // fills the gap between head and shoulders, which is otherwise the one
        // piece of empty silhouette every figure in this world shares.
        //
        // They come inward as they fall (x 0.175 → 0.155) and forward
        // (z 0.03 → 0.115), which is what keeps them off the A-pose upper arm:
        // at y 0.95 the arm spans z ±0.059 and the lock starts at z 0.065.
        specs.push(strand([side * 0.175, 1.29, 0.03], [side * 0.155, 0.95, 0.115], 0.065, 0.05, 5, 2, 1))
      }
      break

    // ── Forward ──────────────────────────────────────────────────────────────
    case 'fringe':
      specs.push(
        // A heavy forelock, and the only mass on the figure that breaks the hull
        // forward: 87 mm proud of the brow, which in profile turns the head from
        // a circle into a circle with a brow.
        //
        // Its lower rim stops at y 1.3054 and the top of the eye dome is at 1.277,
        // so the nearest face vertex is 39 mm away (measured) — a fringe that
        // overhangs the brow rather than one that covers a face the whole design
        // is built around. `HAIRLINE` is +25 mm rather than 0 to keep that rim
        // below the painted line; see the note there.
        //
        // **It is a mass, not a lens, and that is the second attempt.** The first
        // was 75 mm across the axis and 0.62 of that in section, and at 2.6 m it
        // read as a *visor*: a thin dark wedge lying on the forehead, with skin
        // above and below it, attached to nothing. A fringe has to be as thick as
        // the hair it is part of, so it is 105 mm at the root now and spreads to
        // 420 mm across the brow — `crossSection` is [X, up-and-forward] for this
        // axis, so 2.0 does the spreading and 0.7 keeps it a forelock, not a horn.
        strand([0, 1.42, 0.02], [0, 1.36, 0.25], 0.105, 0.09, 6, 1, 1, [2, 0.7], 0.5)
      )
      break

    // ── All round ────────────────────────────────────────────────────────────
    case 'mane':
      specs.push(
        // The one style that is *volume* rather than a direction: 327 mm of
        // half-width against the skull's 235, so the head reads 39 % wider from
        // every bearing at once. Against `long`, which reaches 258, it is 69 mm
        // broader on each side — 7 px at 20 m.
        //
        // `radial: 8, capRings: 3` and not 7/2: this is the largest single surface
        // on the figure after the torso, and at 2.6 m a heptagonal profile on a
        // 650 mm mass reads as a helmet rather than as hair. Eight sides and a
        // three-ring cap is the most tessellation that fits under the 120-triangle
        // ceiling the worst-case style already sets.
        //
        // The face and forehead protrude through the front of it, and that is
        // correct rather than a leak: the mass front peaks at the same height the
        // skull's does, so an ellipsoid cannot cover one and expose the other.
        // What shows through above the hairline is the skull's own hair-coloured
        // crown, and the rim where they meet is an internal crease, which the
        // inverted hull does not draw.
        //
        // The second joint is at y 1.26, **below** the painted hairline at 1.285,
        // and that is deliberate: it is the only ring carrying the dark end, and
        // above the line it would sit against a hair-coloured skull and read as a
        // second hairline.
        //
        // It darkens only 45 % of the way, and that is the one place the rule at
        // `strand` had to be applied to a *large* mass. The widest ring is the
        // lower joint, so everything below it — most of the mane's visible area —
        // carries `colorEnd`. At the full `hairDark` the whole head rendered as a
        // black ball at 2.6 m even from the lit side, which is the same failure
        // the spikes and the beard had for the opposite reason.
        strand([0, 1.33, -0.05], [0, 1.26, -0.05], 0.243, 0.262, 8, 1, 3, [0.9, 1.25], 0.45)
      )
      break

    // ── Jagged ───────────────────────────────────────────────────────────────
    case 'wild':
      // Four spikes, none of them mirrored. Asymmetry is a silhouette class of
      // its own here — every other style on the figure is symmetric about x = 0,
      // so an unkempt head is recognisable in a crowd before any of its
      // individual spikes are.
      //
      // Each is rooted 100 mm or more inside the skull and erupts through it, so
      // the four appear at four different heights on the cranium rather than
      // radiating from one point.
      specs.push(
        strand([0.07, 1.4, -0.02], [0.245, 1.47, 0.02], 0.06, 0.03, 5, 1, 1, undefined, 0),
        strand([-0.09, 1.375, 0.02], [-0.2, 1.5, -0.06], 0.062, 0.028, 5, 1, 1, undefined, 0),
        strand([0.02, 1.36, -0.08], [0.05, 1.41, -0.32], 0.06, 0.03, 5, 1, 1, undefined, 0),
        strand([-0.03, 1.42, -0.03], [0.09, 1.47, 0.24], 0.058, 0.028, 5, 1, 1, undefined, 0)
      )
      break
    case 'swept':
      specs.push(
        // One lobe, over the character's **left** temple (+X — see the rig note),
        // with the right ear left showing. The lobe stands 93 mm clear of the
        // skull at jaw height and the other side carries nothing but an ear, so
        // the two halves of the outline differ by about that much — which is the
        // cue. That it also looks like a side parting at conversational distance
        // is a bonus, not the design.
        //
        // Rooted at x 0.03 / y 1.40 — near the *centre* of the crown, not at the
        // temple. From the temple it left the skull below the hairline and read at
        // 2.6 m as a dark flap floating beside the head, attached to nothing. From
        // the crown it leaves through hair and reads as hair swept to one side.
        strand([0.03, 1.4, 0.02], [0.215, 1.13, 0.045], 0.11, 0.075, 5, 2, 1, [0.8, 1], 0.7)
      )
      break

    // ── Below the chin ───────────────────────────────────────────────────────
    case 'bearded':
      // ── Yields to the beard axis, and only to it ─────────────────────────
      //
      // `appearance.beard` (`features.ts`) is the general answer to facial hair
      // and this entry is the special one that predates it. They must not both
      // emit: two masses hanging off the same chin at two different radii read
      // as a beard with a lump in it, and the *inner* one is invisible, so it is
      // 36 triangles nobody can see.
      //
      // The style is not removed and the hairline it sets (+60 mm — "a beard is
      // an old man, and the hairline is half of what says so") is not touched,
      // because `professions.ts` names `bearded` in four roles and every saved
      // character wearing it must keep the figure it had. With
      // `beard: 'none'` — the default, and what all of those carry — this branch
      // is byte-for-byte what it always was.
      if (appearance.beard !== 'none') {
        break
      }
      specs.push(
        // The only mass below the head, and the only one that changes the
        // *figure's* outline rather than the head's: it fills the notch between
        // jaw and chest that every other chibi here has.
        //
        // Rooted at y 1.16 / z 0.09, which is inside the skull, and the cap runs
        // back up inside it — so the beard grows out of the jaw instead of being
        // stuck to it. The nearest face vertex is 59 mm away, measured, so it
        // frames the mouth and does not swallow it.
        //
        // Broad rather than pointed (234 mm across the chin, `crossSection[1]` at
        // 1.5) and only 35 % of the way to `hairDark`. The first pass was a narrow
        // 55 %-dark wedge and rendered as a black bib: the whole front of a figure
        // in this world faces away from the sun, so a mass that faces the camera
        // has nothing but its own albedo left to read with.
        //
        // It is weighted like the rest of the hair — the skull's own blend, half
        // head and half neck below the hairline — which happens to be exactly what
        // a beard wants, because the chin it hangs off carries those same weights.
        strand([0, 1.16, 0.09], [0, 1.06, 0.185], 0.09, 0.078, 6, 1, 1, [0.8, 1.5], 0.35)
      )
      break
  }

  return specs
}

const _from = new Vector3()
const _to = new Vector3()
const _colour = new Color()

/**
 * Sweeps a list of strands into one block.
 *
 * Shared by the hair and the ears because they are the same problem: geometry
 * glued to the head, which must carry the head part's `along` at its own height
 * so the skull's binding comes with it, and which must be **outward-wound**,
 * unlike `limbMesh`'s own inward winding. That reversal is the same one
 * `chibiGeometry` applies to the body, done here so the caller can append either
 * block verbatim. Winding is not cosmetic on this figure: the body material is
 * `FrontSide` and the outline is `BackSide`, so an inward-wound strand renders
 * its own far surface and its inverted hull draws *in front of* the character.
 */
export const buildStrands = (specs: readonly StrandSpec[]): HairMesh | null => {
  if (specs.length === 0) {
    return null
  }

  const position: number[] = []
  const normal: number[] = []
  const color: number[] = []
  const along: number[] = []
  const index: number[] = []

  for (const spec of specs) {
    const part = limbMesh({
      from: _from.set(spec.from[0], spec.from[1], spec.from[2]),
      to: _to.set(spec.to[0], spec.to[1], spec.to[2]),
      radiusStart: spec.radiusStart,
      radiusEnd: spec.radiusEnd,
      radial: spec.radial,
      rings: spec.rings,
      capRings: spec.capRings,
      crossSection: spec.crossSection
    })

    const base = position.length / 3
    for (let i = 0; i < part.along.length; i++) {
      const y = part.position[i * 3 + 1]!
      position.push(part.position[i * 3]!, y, part.position[i * 3 + 2]!)
      normal.push(part.normal[i * 3]!, part.normal[i * 3 + 1]!, part.normal[i * 3 + 2]!)

      const t = part.along[i]!
      const clamped = t < 0 ? 0 : t > 1 ? 1 : t
      _colour.copy(spec.colorStart).lerp(spec.colorEnd, clamped)
      color.push(_colour.r, _colour.g, _colour.b)

      along.push((y - HEAD.centre[1]) * ALONG_PER_METRE)
    }

    for (let i = 0; i < part.index.length; i += 3) {
      index.push(base + part.index[i]!, base + part.index[i + 2]!, base + part.index[i + 1]!)
    }
  }

  return {
    position: new Float32Array(position),
    normal: new Float32Array(normal),
    color: new Float32Array(color),
    along: new Float32Array(along),
    index: new Uint32Array(index)
  }
}

/** Builds a style's geometry, or `null` for the painted styles. */
export const hairMesh = (appearance: CharacterAppearance): HairMesh | null => {
  const palette = bodyPalette(appearance)
  return buildStrands(hairSpecs(appearance, palette.hair, palette.hairDark))
}
