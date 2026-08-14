import { Color } from 'three'

/**
 * ─── The palette ────────────────────────────────────────────────────────────
 *
 * Single source of colour truth for the 3D world (GDD §3). Nothing in
 * `src/world/` may contain a hex literal — a restyle has to be one edit here,
 * or the look drifts the moment a second asset is added.
 *
 * Colours are authored in sRGB (the numbers below are what you'd type into a
 * colour picker). `THREE.Color` with `ColorManagement` enabled converts them to
 * linear-sRGB working space on assignment, which is what the shader wants.
 */

/** Authored sRGB hex values. Read these in docs/tools; use `C.*` in code. */
export const HEX = {
  // ── Lighting rig ─────────────────────────────────────────────────────────
  sun: 0xfff3d6,
  hemiSky: 0xa8d8f0,
  hemiGround: 0xc9b98e,
  /** Band-0 tint. Shadows fall to this, never to black (GDD R4). */
  shadowTint: 0x6b7bb5,
  /** Fresnel rim colour (GDD R5). */
  rim: 0xdff1ff,

  // ── Atmosphere ───────────────────────────────────────────────────────────
  skyZenith: 0x5fa8d8,
  skyHorizon: 0xdceef7,
  /** Lighter + bluer than the horizon on purpose — that's aerial perspective. */
  fog: 0xcfe4f0,

  // ── Ground ───────────────────────────────────────────────────────────────
  //
  // Deliberately duller and darker than they look on a swatch. Albedo here is
  // multiplied by ~1.0 of combined key + fill, so anything that reads "correct"
  // as a flat colour arrives on screen fully saturated and blown out — the first
  // pass used #9ccc55/#7aab45 and the ground came out as flat lime poster paint.
  // BotW's meadows are far greyer than memory insists.
  grassLit: 0x8fb861,
  grassBase: 0x6e934c,
  grassShadow: 0x455f3f,
  /** Sun-bleached patches. The warm end of the grass range — without a warm
   *  tone to swing against, every noise octave only changes brightness and the
   *  ground stays one flat colour no matter how much variation you add. */
  grassDry: 0xa3a663,
  dirt: 0x8f6a49,
  sand: 0xc7b489,

  // ── Rock ─────────────────────────────────────────────────────────────────
  rockBase: 0x9b9d99,
  /** Mixed in by how much a face points up — sun-bleached tops. */
  rockWarm: 0xb8ab95,
  // Warm-neutral rather than blue: the periwinkle shadow tint is already
  // pushing the dark end cool, and a cool base on top of it turned every
  // boulder into slate.
  rockShadow: 0x62615c,

  // ── Tree ─────────────────────────────────────────────────────────────────
  barkBase: 0x6d5138,
  barkDark: 0x453224,
  // Canopy runs a touch cooler and darker than the grass so a treeline reads
  // against the field it stands in rather than dissolving into it.
  foliageLit: 0x74a248,
  foliageBase: 0x527d3a,
  /** Clump interior — reached via baked vertex AO, not by modelling. */
  foliageDeep: 0x2c4c2b
} as const

export type PaletteKey = keyof typeof HEX

/** Cached `Color` instances. Never mutate these — clone first. */
export const C: Record<PaletteKey, Color> = Object.fromEntries(
  Object.entries(HEX).map(([k, v]) => [k, new Color(v)])
) as Record<PaletteKey, Color>

// ─── Shading constants that travel with the palette ─────────────────────────

/** How much `shadowTint` is mixed into the darkest band (GDD R4). */
export const SHADOW_TINT_MIX = 0.35

/** Fresnel exponent for the mandatory rim light (GDD R5). */
export const RIM_POWER = 3.2

/** Rim intensity. Deliberately subtle — it should read as light, not as a halo. */
export const RIM_STRENGTH = 0.45

/**
 * Outline colour is derived, not authored: base × 0.22 shifted cool (GDD R6).
 * Deriving it keeps every outline in the world automatically consistent with
 * whatever the object's albedo is, including after a palette change.
 */
const OUTLINE_DARKEN = 0.22
const OUTLINE_COOL = new Color(0x2a3348)

export const deriveOutlineColor = (base: Color, target = new Color()): Color =>
  target.copy(base).multiplyScalar(OUTLINE_DARKEN).lerp(OUTLINE_COOL, 0.35)

/**
 * exp² fog density.
 *
 * Tuned to the *world radius*, not to the cull distance: at 0.0055 the far edge
 * of a 384 m world was only 66 % fogged, so the terrain's boundary was plainly
 * visible as a hard line against the sky with trees hanging off it. At 0.0085 it
 * reaches ~89 % by 170 m, which buries the edge while still leaving mid-distance
 * hills readable. Raise the world size and this comes back down.
 */
export const FOG_DENSITY = 0.0085
