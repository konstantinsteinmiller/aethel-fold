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
  /**
   * Sand with water still in it — the strip at and just below the waterline.
   *
   * A stop of its own rather than `sand` darkened, and rather than a lerp toward
   * `dirt`, which is what the first pass did. Both fail, in opposite directions.
   * A plain multiply keeps sand's hue and reads as sand *in shadow*, so the
   * tideline looked like a cloud passing rather than like wet ground. `dirt` is
   * 15° redder than `sand` and pulls the strip toward mud, which turns a beach
   * into a riverbank — wrong for the sea the storyteller's island sits in, and
   * wrong even for the Arla, whose banks are cut into turf rather than silt.
   *
   * Authored as sand at **0.71 value with the chroma held**, which is close to
   * what water actually does to sand: it fills the air gaps between grains, so
   * the surface stops scattering and goes darker at the same hue instead of
   * greyer. Keeping the chroma is what makes it still read as the same material.
   */
  sandWet: 0x8f8264,
  /**
   * Added — not mixed — into a grass blade's tip, weighted by t².
   *
   * Additive rather than a third stop on a ramp because a blade's base colour is
   * not authored here at all: it is sampled from the *ground the patch stands
   * on*, so the sward can never read as a different green from the terrain under
   * it. What the tip needs on top of that is the sun catching the last few
   * centimetres, which is a small warm addition to whatever green arrived.
   *
   * Dark on purpose. It is added in linear space to a colour that is already
   * near the top of the ramp, so a value that reads "warm" as a swatch arrives as
   * a yellow haze over the whole meadow.
   */
  grassTipWarm: 0x30371f,

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

  // ── Water ────────────────────────────────────────────────────────────────
  //
  // The one family in the world allowed to be *more* saturated than it looks on
  // a swatch, and it is the exception that proves the rule. Every other surface
  // here is opaque and multiplies the key light, so an honest colour arrives
  // blown out (see the notes on the ground and the grass cap). Water is
  // translucent: what reaches the eye is this colour blended over the terrain
  // beneath it at 60–80 % and then banded, so an authored value that already
  // reads correct arrives on screen *muted*. These are pushed accordingly.
  //
  // The depth ramp is three stops rather than two. Two gives a linear wash from
  // edge to middle that reads as tinted glass; the mid stop is what makes a
  // pond read as having a bottom — most of the surface sits in it, and the
  // deep colour is reserved for genuine depth.
  // Pushed hard toward the reference on a second pass. The first set
  // (#7fd4d8 / #3f9dc4 / #255a87) was authored on the same "dull it, it will
  // arrive brighter" instinct the opaque families need, and on translucent
  // water that instinct is backwards twice over: the colour is already being
  // diluted by whatever it is blended over, *and* the aerial-perspective fog
  // desaturates it again with distance. A sea read as grey-teal at 100 m.
  //
  // The three stops are also spread much further apart in hue, not just in
  // value — the reference's tropical read comes from shallow water being
  // genuinely *green*-cyan against a genuinely *blue* deep, and a ramp that
  // only darkens gives one colour at two brightnesses.
  waterShallow: 0x4fdcc4,
  waterMid: 0x159fd6,
  waterDeep: 0x0f4f9e,
  /** Shoreline and crest foam. Dulled off white for the reason `snowLit` is. */
  waterFoam: 0xe4f6fa,
  /** Banded specular glint. Warmer than the foam so highlights read as sun. */
  waterSparkle: 0xf5fcff,
  /**
   * Caustic bands on a shallow bottom. Brighter and greener than `waterShallow`
   * so the cells read as *light* focused through the surface rather than as a
   * lighter patch of water — the difference between the reference's sunlit sand
   * and a mottled paint job.
   */
  waterCaustic: 0xbdf6e4,

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
  needleDeep: 0x1c3527,

  // ── Day / night ──────────────────────────────────────────────────────────
  //
  // A second set of lighting-rig colours the cycle interpolates toward. Every
  // one of these reaches the scene as a *uniform*, never as a rebuilt vertex
  // colour, which is what makes a full cycle cost a handful of float writes
  // instead of regenerating the world four times a minute.
  //
  // Dawn and dusk share one warm set. They are not actually the same colour in
  // life — dawn is cleaner, dusk is dustier — but at this saturation the
  // difference is below what the toon ramp can resolve, and a second set would
  // be two more lerps for a distinction nobody can see.
  /** Sun colour near the horizon. Deep and orange; the ramp banding does the rest. */
  sunLow: 0xff9a4d,
  /**
   * Moonlight. Dim and cool, and deliberately *not* blue-grey: the shadow tint
   * is already periwinkle, so a blue moon on top pushed every night surface to
   * the same hue and the world went monochrome after dusk.
   */
  moon: 0xbcc9e8,

  // ── The two bodies themselves ────────────────────────────────────────────
  //
  // `sun`/`sunLow`/`moon` above are *light* colours — what the rig emits. These
  // three are what the discs in the sky are painted with, and they are separate
  // constants because the two jobs disagree: a light colour is multiplied into
  // every albedo it touches and so is authored well under white (see the note
  // on the ground colours), while a disc is emissive, sits on the sky and is
  // meant to be the brightest thing in frame.
  /**
   * The halo around the sun disc.
   *
   * Warmer and deeper than `sun`, because a halo is the sun's light seen
   * *through* air and air scatters the blue out of it first. It is then lerped
   * toward whatever the sun's own colour is at that moment, so at dawn the
   * halo lands between this and `sunLow` rather than staying pale — the same
   * warming the directional light does, one step behind it.
   */
  sunGlow: 0xffd79a,
  /**
   * The lit face of the moon.
   *
   * Not white, for the reason `snowLit` is not white and then one more: the
   * moon's whole read is its **phase**, and the phase is a terminator crossing
   * the disc. Clip the lit face and the mid band at the terminator clips with
   * it, leaving a shape with two values where it needs three — a flat coin
   * instead of a sphere.
   */
  moonDisc: 0xe4e9f5,
  /**
   * The unlit face. Earthshine, and the reason a crescent still reads as a ball.
   *
   * Periwinkle family (GDD R4 — shadows are never black), and deliberately a
   * little *lighter* than `skyHorizonNight` so the dark limb separates from the
   * sky it sits against instead of cutting a hole in it. A black dark side is
   * indistinguishable from sky, which turns every phase into a disc of the
   * wrong size rather than a sphere lit from one side.
   */
  moonDark: 0x3c4674,
  /** Night sky. Not black — a black zenith kills the silhouette of everything. */
  skyZenithNight: 0x0d1430,
  skyHorizonNight: 0x24304f,
  /** The horizon band at sunrise and sunset. */
  skyHorizonWarm: 0xff9c5c,
  /** Zenith at dawn/dusk: still cool, which is what makes the warm band read. */
  skyZenithWarm: 0x3a5a8c,
  /** Fog follows the horizon, one step lighter, as it does by day. */
  fogNight: 0x2b3757,
  fogWarm: 0xf2b184,
  /** Hemisphere fill at night. Ground stays warmer than sky, as by day. */
  hemiSkyNight: 0x2c3a63,
  hemiGroundNight: 0x2a2b33,

  // ── Clouds ───────────────────────────────────────────────────────────────
  //
  // Two colours per state and no more, because a cloud in this world is shaded
  // the way everything else is: a lit face, a shaded face, and a soft boundary
  // between them. `clouds.ts` derives the boundary from the density itself —
  // thin edges take `cloudLit`, thick cores take `cloudShade` — so these two
  // are the whole palette of a cumulus.
  /**
   * The sunlit top of a cloud.
   *
   * Off-white and faintly warm, not white. The rule that keeps `snowLit` off
   * pure white applies with more force here: a cloud is the largest bright area
   * in the frame, and at 0xffffff it clips to flat paper across half the sky and
   * takes the sun's halo with it — the disc stops being the brightest thing in
   * frame, which is the one job the disc has.
   */
  cloudLit: 0xf4f1ea,
  /**
   * The shaded underside.
   *
   * Periwinkle family, like every other shadow in this world (GDD R4), and
   * light enough to stay clearly *above* `skyZenith` in value. A cloud base
   * darker than the sky behind it reads as a hole rather than as a body, which
   * is the same failure `moonDark` is written to avoid.
   */
  cloudShade: 0xb9c2da,
  /**
   * Dawn and dusk. Clouds are the first thing the low sun reaches and the last
   * thing it leaves, so the warm state is pushed further than the sky's own —
   * `skyHorizonWarm` is a band at the horizon, and this is the whole underside
   * of every cloud in the sky going orange at once.
   */
  cloudLitWarm: 0xffc98e,
  cloudShadeWarm: 0xc98a80,
  /**
   * Night. Barely lighter than `skyZenithNight`, because a moonlit cloud is a
   * silhouette with a rim rather than a lit object — the value gap that makes a
   * daytime cloud read has no light source at night to sustain it.
   */
  cloudLitNight: 0x3b4670,
  cloudShadeNight: 0x1e2748,

  // ── Characters (GDD §6 Phase C) ──────────────────────────────────────────
  //
  // A chibi is three heads tall, so **skin is a third of the silhouette** and
  // behaves like a large flat colour field rather than an accent. It is
  // therefore desaturated well below where a skin tone would normally sit: at
  // full chroma a head this size fights every foliage green on screen and the
  // eye reads the character as a UI element pasted over the world.
  //
  // The lit/base/shadow triple exists because the toon ramp bands *within* an
  // albedo — one colour would give a character two bands where the props get
  // three, and the character would read as flatter than the rocks behind it.
  skinLit: 0xf2cfae,
  skinBase: 0xdbae8a,
  skinShadow: 0xa87b5e,
  /** Tunic: the one saturated field on the figure, so it carries the read. */
  tunicLit: 0x6f97c4,
  tunicBase: 0x4a6d9b,
  tunicShadow: 0x2c4269,
  /** Trousers and sleeves — a neutral that lets the tunic stay the accent. */
  clothLit: 0x9a8f7d,
  clothBase: 0x6f6656,
  clothShadow: 0x413c33,
  /** Hair and boots share a value so the silhouette closes top and bottom. */
  hairBase: 0x4b3a2f,
  hairDark: 0x2a1f19,

  // ── Face ─────────────────────────────────────────────────────────────────
  //
  // At three heads tall the face is the smallest field on the figure and the
  // first place the eye lands, which makes it the one part where **contrast
  // matters more than hue**. All three of these are chosen against `skinBase`
  // rather than against each other.
  //
  // `eyeDark` is deliberately **not black**, and not only because R4 bans it:
  // an eye is a small dark shape on a large light field, so at any distance
  // past a few metres it is the *silhouette* that reads, and a pure black
  // returns a hard-edged hole that flattens the head into a mask. A very dark
  // desaturated indigo keeps the shape while letting the rim light and the
  // periwinkle shadow tint still touch it, so the eye sits *in* the head.
  eyeDark: 0x241f2e,
  /** Catchlight and the sclera wedge. Dulled off-white for the reason
   *  `snowLit` is — a pure white catchlight on a 4 cm feature clips to a flat
   *  dot and stops reading as wet. */
  eyeLight: 0xeae6ee,
  /**
   * Brow and mouth line.
   *
   * A fixed dark warm neutral, **not** derived from the character's hair colour.
   * The original note here claimed it was keyed to the hair so a hair change
   * would carry the face with it; that was never true — the mouth is authored in
   * `face.ts` from this constant and does not read `appearance.hairColour` — and
   * once hair became customisable the claim was actively misleading.
   *
   * It is now **the mouth's colour only** — eyebrows were added later and *are*
   * hair-derived, through `variants.ts::browColour`.
   *
   * The argument that used to sit here for keeping brows off the hair was that a
   * brow tinted to blond vanishes into pale skin. Measured, that was aimed at the
   * wrong pair: blond on the palest skin separates by 0.20–0.24 of authored luma
   * before any correction — three times what this very constant manages for the
   * mouth on the darkest skin (0.060). The real collision is **light hair on
   * mid-to-dark skin**, where the hair ramp's own dark stop lands within 0.009 of
   * `skinTone4`. `browColour` handles it by darkening 70 % toward that stop and
   * then bisecting until separation is ≥ 0.12, calibrated against `eyeDark`.
   *
   * The mouth stays fixed because it is not hair and has no reason to follow it.
   */
  faceLine: 0x3a2b23,

  // ── Skin tones ───────────────────────────────────────────────────────────
  //
  // A customisation ramp, not a second skin colour. `skinBase` above stays the
  // mid stop so nothing that already references it moves; these are the ends of
  // the range a player can slide between, and every one of them is desaturated
  // on the same argument that governs `skinBase` — at three heads tall the face
  // is a large flat field, and a fully-chroma skin tone fights every green in
  // the world. The lit/shadow pair for a chosen tone is derived by the builder,
  // not authored per stop, or a five-stop ramp becomes fifteen constants that
  // drift apart.
  //
  // **`skinTone1` is `skinBase` exactly**, and that is a constraint rather than a
  // coincidence. `DEFAULT_APPEARANCE.skinTone` is 1, and the default figure has
  // to build byte-identically to the one that shipped before customisation
  // existed — so the stop the default lands on cannot be "a similar light tan",
  // it has to be the same number. The first pass authored `#e8c09b` here and the
  // ramp quietly disagreed with the body it was supposed to reproduce, leaving
  // the constant unused while the builder substituted `skinBase` behind it.
  skinTone0: 0xf6ddc2,
  skinTone1: 0xdbae8a,
  skinTone2: 0xc9946b,
  skinTone3: 0x8d5a3c,
  skinTone4: 0x5c3626,

  // ── Equipment materials ──────────────────────────────────────────────────
  //
  // Unlike terrain and foliage these are **small objects held close to camera**,
  // so they carry more contrast than the world's large fields — a sword that is
  // as desaturated as a cliff reads as a grey stick in the hand. The discipline
  // that still applies is the lit end: a blade catches the ramp's top band along
  // its whole length at once, so `steelLit` is well under white or every draw
  // animation flashes.
  steelLit: 0xd2dae2,
  steelBase: 0x97a3b0,
  steelShadow: 0x4e5866,
  /** Pommels, guards, buckles. The one warm accent on an otherwise cool kit. */
  brassLit: 0xd8b45e,
  brassBase: 0xa8842f,
  /** Grips, straps, jerkins. Warmer and duller than `barkBase` so leather next
   *  to a tree reads as worked hide rather than as more wood. */
  leatherLit: 0x9c6f4a,
  leatherBase: 0x6f4c32,
  leatherShadow: 0x40291b,
  /** Bow limbs, hafts, shield boards. Paler than bark — this is seasoned, planed
   *  timber, and it has to separate from the trunk a bow was cut from. */
  woodLit: 0xc39a63,
  woodBase: 0x936b41,
  woodShadow: 0x573c24,
  /** Straw hat. Sits between `grassDry` and `sand` on purpose: a straw hat is
   *  dried grass, and reading as either fresh grass or as stone is the failure. */
  strawLit: 0xe0c98a,
  strawBase: 0xbfa261,
  strawShadow: 0x7d6738,

  // ── Arlaan: the built village ────────────────────────────────────────────
  //
  // Nimmerschein is a timber village inside a palisade, and its whole read at
  // distance is **three fields**: dark oak frame, pale daub panel, warm thatch.
  // They are authored as a triple rather than borrowed from `wood*` because the
  // two jobs pull opposite ways — `woodBase` is *planed* timber and has to
  // separate from a tree trunk, while a house frame is weathered structural oak
  // and has to separate from the daub it holds. Reusing one for both collapsed
  // the frame into the wall at 25 m, which is exactly the distance a village
  // silhouette is read at.
  /** Structural oak: posts, braces, the palisade's stakes, cart timbers. */
  timberLit: 0x8d6c46,
  timberBase: 0x5f462d,
  timberShadow: 0x342517,
  /** Wattle-and-daub infill. Warm off-white — never a neutral grey, or the
   *  village reads as stone and Arlaan stops being a farming country. */
  daubLit: 0xeadfc6,
  daubBase: 0xcfc0a1,
  daubShadow: 0x968769,
  /** Thatch. Sits a band under `strawBase` so a roof separates from a hay pile
   *  standing next to it — the two are literally the same material, and the
   *  only thing telling them apart at range is value. */
  thatchLit: 0xcfae72,
  thatchBase: 0xa98a54,
  thatchShadow: 0x6a5231,
  /** Split shingle, for the smithy and the gate towers — the two roofs that
   *  must not be flammable in a village that keeps a forge lit. */
  shingleLit: 0x8f8578,
  shingleBase: 0x6a6155,
  shingleShadow: 0x3d382f,
  /** Wrought iron: hinges, the forge's tools, a boar spear's socket. Colder and
   *  darker than `steelBase`, so a blade reads as sharpened and a hinge does not. */
  ironLit: 0x7f8894,
  ironBase: 0x545c68,
  ironShadow: 0x2b3038,
  /** The forge fire, and the fire pit at the Treff. The only emissive-looking
   *  field in the world, so it is kept small and never appears as a large area. */
  emberLit: 0xffd487,
  emberBase: 0xef8a3c,
  emberDeep: 0x8e2f14,
  /** Arlaan's arms: a golden griffin on red. The banner over the gate and the
   *  town guards' livery both take these, so they cannot drift apart. */
  arlaanRed: 0x9c2b2e,
  arlaanGold: 0xd8ae4e,

  // ── Arlaan: the wild ─────────────────────────────────────────────────────
  /** The Trollschwein. Coarse dark bristle over a warmer hide, so the beast
   *  reads as an animal rather than as a rock with legs when it is still. */
  boarBristle: 0x3f3226,
  boarHide: 0x6b533b,
  boarSnout: 0x8f6f57,
  /** Tusks and the boar's hooves. Bone, not steel — warm, so a tusk never reads
   *  as a metal weapon in a silhouette full of them. */
  boneLit: 0xe8dcc2,
  boneBase: 0xc4b391,
  boneShadow: 0x7d705a,
  /** Bandit cloth. Deliberately the most desaturated garment field in the
   *  world: five figures breaking out of a treeline have to read as *shapes*
   *  first, and colour is what would make them read as people. */
  banditLit: 0x5a565f,
  banditBase: 0x3d3b3f,
  banditShadow: 0x211f24
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
export const OUTLINE_DARKEN = 0.22
export const OUTLINE_COOL = new Color(0x2a3348)
export const OUTLINE_COOL_MIX = 0.35

/**
 * Exported rather than private because `shading/outlineMaterial.ts` needs the
 * same three numbers for its uniform defaults, and the level editor needs them
 * again to *restore* an outline after highlighting a focused prop. Three copies
 * of `0x2a3348` in three files is exactly the drift GDD §3 exists to prevent —
 * and the failure mode is silent: a prop the editor has touched keeps a
 * near-black outline while every other prop in the scene has the cool one.
 */
export const deriveOutlineColor = (base: Color, target = new Color()): Color =>
  target.copy(base).multiplyScalar(OUTLINE_DARKEN).lerp(OUTLINE_COOL, OUTLINE_COOL_MIX)

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
