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

  // ── Pale cliff rock ──────────────────────────────────────────────────────
  //
  // A second rock family — plateaus, sea-stack spires, columnar basalt, slabs.
  // Deliberately *paler and cooler* than `rockBase`, because the whole point of
  // a second family is that a plateau standing next to a boulder reads as a
  // different stone rather than as the same stone at a different size. Warm
  // grey next to pale blue-grey is the cheapest possible geological story.
  //
  // Same authoring discipline as the ground colours: the lit band lands at
  // ~0.95× albedo, so these are duller than the near-white they read as on a
  // swatch. An honest near-white here clips to flat paper the instant the sun
  // hits a flat top, and the flat tops are most of this family's surface area.
  cliffLit: 0xbcc4c8,
  cliffBase: 0x9ba7ae,
  /** Cool, unlike `rockShadow` — this family *is* blue-grey, so the dark end
   *  leaning into the periwinkle shadow tint is the effect, not a mistake. */
  cliffShadow: 0x5d6673,

  // ── Grass cap ────────────────────────────────────────────────────────────
  //
  // The flat green tops. Now *duller and darker* than `grassLit`, which is the
  // opposite of the first pass and the second time this exact trap has caught
  // this palette (see the note on the ground colours above).
  //
  // The reasoning that produced `#93c257` was "a cap has to separate from the
  // meadow it floats above". That is true and it is not an argument for
  // saturation. A cap is a large, *flat*, fully-lit plane, so unlike the rolling
  // ground it takes the ramp's top band across its entire area with no falloff
  // anywhere — it arrives on screen a full band brighter than the same hex does
  // on the terrain, and it came out as poster paint. The separation the cap
  // actually needs is already free: it sits on pale blue-grey stone, so value
  // and hue contrast do the work and the rim light draws the edge.
  grassCapLit: 0x84a75e,
  grassCapBase: 0x627f45,
  /** Under the draped lip and on shelf turf, reached through baked AO. */
  grassCapDeep: 0x36512c,

  // ── Desert sandstone ─────────────────────────────────────────────────────
  //
  // The third rock family: hoodoos, buttes and the banded pillars of the desert
  // reference. Warm terracotta, and held **well** back from the orange it reads
  // as on a swatch — this family is defined by large sunlit vertical faces, so
  // it takes the ramp's top band across most of its area exactly the way the
  // grass cap does (see the note above `grassCapLit`). The first pass authored
  // `#d4794f` and every hoodoo arrived as traffic-cone plastic.
  //
  // The dark end stays *warm* rather than falling to the family's own hue
  // rotated cool: sandstone in shadow is bounce-lit by the sand around it, and
  // a cool shadow here reads as wet slate. The periwinkle band tint (GDD R4) is
  // already supplying all the cool this family can take.
  sandstoneLit: 0xc08a68,
  sandstoneBase: 0xa2664b,
  sandstoneShadow: 0x6b4030,
  /** Sedimentary banding — the paler stripe. Mixed by height, never modelled. */
  sandstoneBand: 0xcaa183,

  // ── Snow ─────────────────────────────────────────────────────────────────
  //
  // Never white. A snow cap is the brightest thing in the world and the only
  // surface guaranteed to sit in the ramp's top band over its whole area, so an
  // authored `#ffffff` clips to flat paper and takes the silhouette with it —
  // the rim light (GDD R5) then has nothing left to draw against. Authored at
  // ~87 % and tinted toward the sky, it still reads as the brightest object on
  // screen while keeping a band edge.
  snowLit: 0xdee6f2,
  snowBase: 0xc3cfe2,
  /** Under the canopy shelves, reached through baked AO. Blue, not grey. */
  snowDeep: 0x8b9cbc,

  // ── Tree ─────────────────────────────────────────────────────────────────
  barkBase: 0x6d5138,
  barkDark: 0x453224,
  /** Ancient oak: greyer and more weathered than young bark, and much darker
   *  in the fissures — an old trunk's identity is its depth of relief. */
  barkOldBase: 0x5d4b3a,
  barkOldDark: 0x2e231a,
  /** Birch: pale, but dulled the same way the snow is, and for the same reason. */
  birchLit: 0xd6d3c4,
  birchBase: 0xb3ae9c,
  /** The dark lenticel bands. Cheap, and the whole reason a birch is a birch. */
  birchMark: 0x4a453d,
  // Canopy runs a touch cooler and darker than the grass so a treeline reads
  // against the field it stands in rather than dissolving into it.
  foliageLit: 0x74a248,
  foliageBase: 0x527d3a,
  /** Clump interior — reached via baked vertex AO, not by modelling. */
  foliageDeep: 0x2c4c2b,
  /** Second broadleaf species + birch: warmer and yellower, so two trees of the
   *  same family standing together read as two species rather than two seeds. */
  foliageWarmLit: 0x93ab4e,
  foliageWarmBase: 0x6f8c37,
  foliageWarmDeep: 0x3c5225,
  /** Conifer needles: darker, cooler and much less saturated than broadleaf —
   *  a pine stand next to an oak stand has to separate on value, not on hue. */
  needleLit: 0x4f7c4a,
  needleBase: 0x365c3c,
  needleDeep: 0x1c3527
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
