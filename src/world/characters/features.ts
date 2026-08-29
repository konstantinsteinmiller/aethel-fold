import type { Color } from 'three'
import type { BeardStyle, BrowStyle, CharacterAppearance, NoseStyle } from './equipment'
import {
  beardStops,
  buildStrands,
  FULL_STRAND_DETAIL,
  type HairMesh,
  skinColour,
  type StrandDetail,
  type StrandSpec
} from './variants'

/**
 * ─── The features that are volumes, not decals ──────────────────────────────
 *
 * A beard, a brow ridge and a nose. `face.ts` owns everything on this figure
 * that is a *patch pressed onto the skull* — eyes, mouth, the brow line — and it
 * is very good at it; but a patch cannot leave the surface, and all three of
 * these are the head's outline changing shape. This file is the other half.
 *
 * ── Why a beard is not a hairstyle, which is the whole reason this exists ────
 *
 * `HairStyle` has carried a `bearded` entry since the crowd landed, and it works:
 * one chin mass, 36 triangles, measured. What it cannot do is be worn *with* a
 * haircut. Hair and beard were one axis, so the twenty-one styles were really
 * twenty modelled haircuts plus one beard-and-no-haircut, and a character with a
 * full beard **and** a head of hair was not expressible at all. That is not a
 * missing style, it is a missing dimension — the reference this was built from
 * (a grey-maned smith with a beard to his sternum, heavy brows and a bulbous
 * nose) needs three of them at once.
 *
 * So `beard`, `brows` and `nose` are their own fields on `CharacterAppearance`,
 * `hair: 'bearded'` keeps working exactly as it did, and the two compose: a
 * character who sets both gets the new beard and the old style drops its chin
 * wedge rather than growing two (see `hairSpecs`). Every default is the *absent*
 * value, so every figure that existed before this file is byte-for-byte the one
 * it was.
 *
 * ── They are strands, and that is not a shortcut ────────────────────────────
 *
 * Every mass here is `limbMesh` between two joints, exactly like the hair, and
 * goes through `buildStrands` so it arrives in the same struct the hair and the
 * ears do. That buys four things that would each have to be re-derived by a
 * bespoke path, and three of them are things this project has already paid for
 * once:
 *
 *   1. **Analytic normals from the radius profile** (GDD R3) and spherical caps
 *      that *are* the profile, so there is no cut to bevel (GDD R1).
 *   2. **The head-shape warp**, applied by `chibiGeometry` to the whole block —
 *      a beard on a square jaw is a wider beard, for nothing.
 *   3. **The skull's own skin weights at each vertex's height**, never weight 1
 *      on `head`. `variants.ts::HairMesh.along` records what the alternative
 *      costs: 44 mm of slide at 25° of head yaw, i.e. the skull erupting through
 *      the back of its own hair. A chin that carries half neck and half head is
 *      exactly what a beard hanging off it wants.
 *   4. **Membership of the outline hull.** These are appended before
 *      `bodyIndexCount`, unlike the face, because all three change the
 *      silhouette and the face does not. A nose is 3 px of profile at 8 m and
 *      every one of them is the 1.6 px rim.
 *
 * ── The one thing they do *not* inherit: the hat tuck ───────────────────────
 *
 * `appendHeadStrands` can clip a block inside a worn hat, and the hair and the
 * ears both want that — a topknot through a straw brim was measured at 81 mm.
 * This block is passed `headwear: null` on purpose. The tuck pulls a vertex back
 * along the ray from the head's centre until it is inside the shell, so a hood —
 * whose shell reaches the jaw — would pull a beard **into** the character's own
 * chest, and any hat at all would flatten a nose into the skull. Nothing here is
 * ever underneath headwear: a beard grows in front of a hood, and a nose is in
 * front of everything.
 */

// ─── Beards ─────────────────────────────────────────────────────────────────

/**
 * ── Chosen for silhouette direction, the same rule the hairstyles are ───────
 *
 * `variants.ts` states the test a hairstyle has to pass — *it has to change the
 * outline, in a direction something else does not* — and a beard is measured the
 * same way, on the same figure, at the same 19 mm per pixel. The head is a third
 * of a 1.56 m silhouette and the jaw is the bottom quarter of that, so the axes
 * available below the mouth are: **how far down**, **how far out at the cheeks**,
 * **whether the chin carries mass or only the jawline**, and **whether the tip
 * is one thing or two**.
 *
 * | direction broken             | style         |
 * |------------------------------|---------------|
 * | upper lip only               | `moustache`   |
 * | chin, narrow, down           | `goatee`      |
 * | chin and jaw, close-trimmed  | `cropped`     |
 * | cheeks, out, chin bare       | `muttonChops` |
 * | chin and jaw, to the collar  | `full`        |
 * | to the sternum, one mass     | `patriarch`   |
 * | to the sternum, split tip    | `forked`      |
 * | to the sternum, a rope       | `braided`     |
 *
 * The three long ones are deliberately three, because at 20 m a beard's *length*
 * is the only thing about it that survives and a single long beard would make
 * that a binary. They differ where a beard actually differs: `patriarch` is
 * 300 mm across and the widest mass on the figure, `forked` is the same length
 * with a notch cut out of the tip, and `braided` is 100 mm across — a rope, and
 * the only one whose outline is narrower than the head above it.
 */
export const BEARD_STYLES: readonly BeardStyle[] = [
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

/**
 * Which styles carry a moustache, as geometry.
 *
 * A separate table rather than a field on each spec because it is a *fact about
 * the style* that two other systems ask about: the creator screen's summary and
 * the mouth. A moustache is the only thing on this figure that can cover the
 * mouth, and `face.ts` places the mouth at y 1.1537–1.1690 — so a style in this
 * set has to be authored knowing that it either frames those 15 mm or swallows
 * them, and has to say which.
 *
 * `muttonChops` is the one real beard without one, and it is the style whose
 * whole read is that the middle of the face is bare — a moustache on it would
 * fill in exactly the gap it exists to make.
 */
const MOUSTACHED: ReadonlySet<BeardStyle> = new Set<BeardStyle>([
  'moustache',
  'goatee',
  'cropped',
  'full',
  'forked',
  'braided',
  'patriarch'
])

export const hasMoustache = (beard: BeardStyle): boolean => MOUSTACHED.has(beard)

/**
 * How far a beard's far end is carried toward the hair's dark stop.
 *
 * **0.3, and it is the number `bearded` paid for.** `variants.ts` records what
 * happens at the full dark stop: "the first pass was a narrow 55 %-dark wedge and
 * rendered as a black bib", because `hairDark` is `hairBase × 0.33` in linear
 * space and the whole front of a figure in this world faces away from the sun —
 * a mass pointed at the camera has nothing but its own albedo left to read with.
 * Every mass here is bigger than that wedge was, so every one of them takes the
 * conservative end of that finding.
 */
const BEARD_END_MIX = 0.3

/** A moustache is small and lies on lit skin, so it may go a little further. */
const MOUSTACHE_END_MIX = 0.45

/**
 * The beard masses, in the same bind-pose world space `rig.ts` and `variants.ts`
 * use — feet at y = 0, the figure facing +Z, **+X the character's left**.
 *
 * The numbers below are authored against the head's *built* surface rather than
 * against its ideal ellipsoid, measured once and recorded here so nothing has to
 * re-derive them:
 *
 *   | y      | front z | half-width x |
 *   |--------|---------|--------------|
 *   | 1.0400 |  0.0000 | 0.0000 (pole)|
 *   | 1.0590 |  0.0957 | 0.0886       |
 *   | 1.1132 |  0.1768 | 0.1636       |
 *   | 1.1943 |  0.2310 | 0.2138       |
 *   | 1.2900 |  0.2500 | 0.2314       |
 *
 * and against the two things a long beard can end up inside: the **neck**
 * (z = 0.070 at y = 1.06, 0.080 at 1.14) and the **torso's shoulder dome**
 * (z = 0.1955 at y = 0.95, falling to 0.1382 at 1.07 and closing at 1.12).
 * A beard that hangs at z < 0.20 below the jaw is inside the chest, and being
 * inside the chest is invisible rather than wrong-looking, which is worse.
 *
 * Every root is buried **inside the skull**, by 40 mm or more, for the reason
 * `hairSpecs` gives: the head-shape warp scales the skull by up to 1.06 and a
 * root sitting on the surface opens a seam on exactly the head shapes that need
 * it least to.
 */
const beardSpecs = (
  style: BeardStyle,
  hair: Color,
  hairDark: Color,
  moustache: Color,
  /**
   * Whether to emit the parts of a beard that are *shape within the mass*
   * rather than the mass itself: the moustache, the sideburns, and `forked`'s
   * two tines. False past LOD1 — see `FeatureScope`.
   */
  detail = true
): StrandSpec[] => {
  const specs: StrandSpec[] = []

  const strand = (
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    radiusStart: number,
    radiusEnd: number,
    radial: number,
    rings: number,
    capRings: number,
    crossSection?: readonly [number, number],
    endMix = BEARD_END_MIX,
    colour = hair
  ): StrandSpec => ({
    from,
    to,
    radiusStart,
    radiusEnd,
    radial,
    rings,
    capRings,
    crossSection,
    colorStart: colour,
    colorEnd: colour.clone().lerp(hairDark, endMix)
  })

  /**
   * The moustache, as two sweeps from under the nose out over the corners of the
   * mouth.
   *
   * Two rather than one because a single bar across the lip is a bar across the
   * lip: the shape that says *moustache* at this scale is the pair of tips
   * leaving the face's outline on either side, and one strand through the
   * midline cannot make them without also making a straight leading edge. Each
   * is rooted at x = ±0.010 — inside the other one, so the two overlap at the
   * philtrum and there is no gap on the midline whatever the head shape does.
   *
   * ── It follows the face, and the first pass did not ─────────────────────
   *
   * Rooted at z = 0.213 against the skull's own 0.2193 at that height: **6 mm
   * inside, not 70**. The first pass rooted it at z = 0.15 — the depth every
   * beard mass here is rooted at, which is right for something that erupts
   * *through* the jaw and completely wrong for something that lies *on* the lip.
   * Rendered at 1.5 m it was two grey pebbles floating either side of the nose,
   * because the only part of each strand outside the head was its last
   * centimetre. The axis now stays within a few millimetres of the surface along
   * its whole length (measured sag at the mid-span: 1 mm inside), so all of it
   * shows.
   *
   * `crossSection` is `[forward, vertical]` for this near-lateral axis, and the
   * second slot is the one that matters: over 1 it is a walrus, under it a
   * pencil line. Nothing here goes below 1.15 — a moustache that does not stand
   * proud of the lip is a mouth with a shadow over it, which `face.ts` already
   * draws for free.
   */
  const moustachePair = (droop: number, spread: number, thickness: number, height = 1.3): void => {
    if (!detail) {
      return
    }
    for (const side of [1, -1] as const) {
      specs.push(
        strand(
          [side * 0.01, 1.171, 0.213],
          [side * spread, 1.171 - droop, 0.195],
          thickness,
          thickness * 0.72,
          5,
          1,
          1,
          [0.8, height],
          MOUSTACHE_END_MIX,
          moustache
        )
      )
    }
  }

  /**
   * The sideburns: a pair of masses down the cheek, joining the hairline above
   * to the beard below.
   *
   * ── Why the beard's own mass cannot reach the cheek ─────────────────────
   *
   * Every beard here is a capsule about a near-vertical axis, so its
   * cross-section in XZ is an **ellipse centred on that axis** while the head's
   * is an ellipse centred on the *midline*. At jaw height (y = 1.16) the head
   * reaches z = 0.214 at x = 0 and the beard's front reaches 0.113 there: the
   * mass is entirely inside the skull until well below the mouth, which is why
   * the first render had a beard whose top edge was a horizontal line under the
   * lip — a chin curtain, not a full beard. Growing the mass until it clears the
   * cheek makes it clear the chin by 90 mm as well, and that is a bucket.
   *
   * Two small masses whose own axes are *at* the cheek solve it for 60
   * triangles, and they are the same trick `muttonChops` is made of. They are
   * visible over their lower 60 % and buried above it — which is not a
   * compromise, it is what a sideburn looks like: it thickens downward into the
   * beard and disappears into the hair at the temple.
   */
  const cheekPair = (thickness = 0.04): void => {
    if (!detail) {
      return
    }
    for (const side of [1, -1] as const) {
      specs.push(strand([side * 0.138, 1.183, 0.1], [side * 0.104, 1.095, 0.172], thickness, thickness * 1.45, 5, 1, 1, [1, 0.95]))
    }
  }

  switch (style) {
    case 'none':
      break

    // ── Upper lip only ──────────────────────────────────────────────────────
    case 'moustache':
      // A full walrus and nothing else, which is a real face and also the
      // control case for the six styles that carry one: everything below the lip
      // is bare, so whatever this reads as is the moustache alone.
      moustachePair(0.03, 0.082, 0.021, 1.45)
      break

    // ── Chin, narrow, down ──────────────────────────────────────────────────
    case 'goatee':
      moustachePair(0.014, 0.062, 0.015, 1.15)
      specs.push(
        // 108 mm across against `full`'s 284, and it starts *below* the mouth
        // rather than at the jaw: a goatee's read is the bare cheek beside it,
        // so the mass has to stay inside the face's own outline and change only
        // the chin. It reaches y = 1.006 with its cap, 34 mm below the head's
        // own pole — enough to break the jaw's curve and no more.
        strand([0, 1.165, 0.115], [0, 1.05, 0.2], 0.05, 0.036, 6, 1, 1, [0.9, 1.1])
      )
      break

    // ── Chin and jaw, close-trimmed ─────────────────────────────────────────
    case 'cropped':
      moustachePair(0.018, 0.07, 0.016, 1.2)
      cheekPair(0.034)
      specs.push(
        // The length step between `goatee` and `full`, and the commonest real
        // beard there is: chin *and* jaw, cut close, ending at the jawline
        // instead of below it. One mass at 216 mm across against `goatee`'s 108
        // and `full`'s 284.
        //
        // ── What this slot used to be, and why it is not that ────────────────
        //
        // A `chinstrap` was authored here first — two straps from the ears to
        // the point of the chin — and measured out of the set. Two things killed
        // it, and the second is the one that generalises: a chord between two
        // points on a 0.25 m sphere subtending more than ~57° sags further than
        // a 30 mm strand's own radius, so a jawline built from straight tubes is
        // *buried* mid-span and visible only at its two ends unless it is split
        // into three segments a side — 180 triangles for a strap. And a strap
        // pushed far enough out to survive the sag stands 72 mm off the jaw,
        // which is not a strap, it is a hoop. Against that, a chinstrap's whole
        // read is the outline *not* changing, which fails the one test a style
        // here has to pass.
        strand([0, 1.195, 0.05], [0, 1.09, 0.165], 0.095, 0.066, 6, 1, 2, [0.85, 1.3])
      )
      break

    // ── Cheeks, out, chin bare ──────────────────────────────────────────────
    case 'muttonChops':
      // Out instead of down, and stopping at the jaw instead of turning under
      // it: the only style here that makes the *head* wider rather than the
      // figure longer, and the only one that leaves the chin bare.
      //
      // The tips sit 3 mm inside the skull's own surface at that height and are
      // carried out by their own radius, which is the whole of how far they
      // stand: 33 mm proud at the cheek against a head 470 mm wide. Authored
      // further out (the first pass put the axis 45 mm proud) they read as two
      // lumps stuck on the sides of the face rather than as hair growing out of
      // it — the same detachment `swept` was measured to have, from the same
      // cause.
      for (const side of [1, -1] as const) {
        specs.push(strand([side * 0.11, 1.245, 0.02], [side * 0.155, 1.135, 0.1], 0.032, 0.036, 5, 1, 1, [0.8, 0.95]))
      }
      break

    // ── Chin and jaw, to the collar ─────────────────────────────────────────
    case 'full':
      moustachePair(0.024, 0.076, 0.019, 1.35)
      cheekPair(0.04)
      specs.push(
        // The mass `bearded` always wanted to be, an axis-length longer, and the
        // shortest style that hangs clear of the jaw rather than on it.
        //
        // 284 mm across at its widest (`crossSection[1]` at 1.45 on a 0.098
        // radius) against the head's own 470: broad enough to read as a mass
        // rather than as a wedge, narrow enough that the jaw is still visible
        // behind it in three-quarter view.
        strand([0, 1.205, 0.03], [0, 1.05, 0.185], 0.115, 0.077, 7, 2, 2, [0.85, 1.4])
      )
      break

    // ── To the sternum ──────────────────────────────────────────────────────
    //
    // ── THE MEASUREMENT THE THREE LONG STYLES ARE BUILT ON ───────────────────
    //
    // A beard past the collar has to lie **in front of the chest**, and the
    // chest is not the torso — it is whatever the character is wearing. Sampled
    // near the midline (|x| < 80 mm) over the seven torso garments, the front
    // surface a beard has to clear is:
    //
    //   | y    | front z | set by            |
    //   |------|---------|-------------------|
    //   | 0.90 |  0.242  | jerkin            |
    //   | 0.95 |  0.234  | mantle            |
    //   | 1.00 |  0.227  | dress             |
    //   | 1.02 |  0.226  | jerkin            |
    //   | 1.06 |  0.208  | torsoArmour       |
    //   | 1.08 |  0.166  | dress             |
    //
    // The first pass here ignored it and hung every long beard on the torso's
    // own 0.1955 — so on a dressed figure the mass was *inside the costume* from
    // y = 1.06 down, and a `patriarch` rendered as a beard that stopped at the
    // collar for no visible reason. Being inside is the worst failure available
    // here precisely because it is invisible rather than ugly.
    //
    // So each of the three hangs forward as it descends, and it is the mass's
    // **own radius** that carries its front surface clear rather than the axis:
    // the axis stays near the costume (a beard rests on a chest, it does not
    // float off one) and the front face stands 30–40 mm proud of it. The back
    // half is inside the garment, which is correct and invisible.
    //
    // The **mantle's cape** is the one thing none of them clears: it reaches
    // z = 0.354 at the shoulder, which is 100 mm in front of any beard here.
    // A caped mayor with a beard to the sternum wears the beard under the cape.
    // Stated rather than fixed — the alternative is a beard that floats 120 mm
    // off every other costume in the game to suit one of them.
    case 'patriarch':
      moustachePair(0.032, 0.086, 0.022, 1.5)
      cheekPair(0.044)
      specs.push(
        // The largest single volume on this figure after the head, and the whole
        // reason the beard is its own axis. Its cap reaches y = 0.844 — 196 mm
        // below the chin, a third of a head-height, and 76 mm below the chest
        // joint — with the front face at z = 0.281 against the jerkin's 0.242.
        strand([0, 1.215, 0.02], [0, 0.93, 0.215], 0.125, 0.078, 8, 2, 2, [0.8, 1.35])
      )
      break
    case 'forked':
      moustachePair(0.03, 0.082, 0.021, 1.45)
      cheekPair(0.042)
      specs.push(
        // The same reach as `patriarch` and a different *tip*, which is the one
        // thing about a long beard that still reads once its length has been
        // established. A shared upper mass, then two tines that diverge to
        // x = ±0.095 — a notch 190 mm wide at the bottom of a 1.56 m figure,
        // which is 10 px at 20 m and the only symmetric silhouette break below
        // the chin anything here makes.
        strand([0, 1.205, 0.03], [0, 1.06, 0.16], 0.115, 0.08, 7, 1, 2, [0.8, 1.28])
      )
      if (detail) {
        specs.push(
          strand([0.035, 1.09, 0.16], [0.095, 0.955, 0.245], 0.05, 0.04, 5, 1, 1, [0.85, 1]),
          strand([-0.035, 1.09, 0.16], [-0.095, 0.955, 0.245], 0.05, 0.04, 5, 1, 1, [0.85, 1])
        )
      }
      break
    case 'braided':
      moustachePair(0.026, 0.078, 0.02, 1.4)
      cheekPair(0.036)
      specs.push(
        // A rope. 130 mm across at the widest against `patriarch`'s 294, and the
        // only beard here **narrower than the face above it** — so from directly
        // in front the outline steps *in* below the jaw, where every other style
        // steps out. That is the cue; the two bindings are what makes it a plait
        // rather than a spike.
        strand([0, 1.19, 0.055], [0, 1.06, 0.175], 0.078, 0.05, 6, 1, 1, [0.9, 1.05]),
        strand([0, 1.06, 0.178], [0, 0.95, 0.235], 0.042, 0.046, 6, 2, 1, [0.9, 1.05])
      )
      // The bindings: two flattened collars, `hairDark` at both ends because a
      // binding is a cord and not the hair it holds. `capRings: 0` leaves them
      // open — they are rings threaded onto a rope that is already there, so a
      // cap would be a disc inside the braid.
      if (detail) {
        specs.push(
          strand([0, 1.075, 0.177], [0, 1.058, 0.186], 0.046, 0.046, 6, 1, 0, [0.75, 1], 1, hairDark),
          strand([0, 0.982, 0.226], [0, 0.965, 0.235], 0.043, 0.043, 6, 1, 0, [0.75, 1], 1, hairDark)
        )
      }
      break
  }

  return specs
}

// ─── Brows ──────────────────────────────────────────────────────────────────

/**
 * ── Why a brow needs a second, geometric form at all ────────────────────────
 *
 * `face.ts` already draws brows and they are good ones: 12 triangles, derived
 * from the eye they sit over rather than authored, coloured so they clear the
 * skin under them by a measured margin. What they cannot be is *heavy*. A decal
 * has no thickness, so its only lever is area, and area on a brow is width — a
 * wider brow reads as a longer brow, never as a bushier one.
 *
 * A heavy brow is a **shape change on the profile**: at three-quarter and at
 * side-on it is the ridge standing out of the forehead, and it lands in the
 * outline hull where the decal cannot. That is the whole of what `bushy` adds,
 * and it is why it is one bit rather than a range: the intermediate values are
 * the decal, which already ships.
 *
 * The tuft sits *over* the decal rather than replacing it. Two reasons, and the
 * second is the one that decided it: the decal is per eye style and carries the
 * expression (`browPlacement` derives its tilt from `lidSlant` and `roll`), so
 * replacing it would flatten ten faces into one; and the decal's dark line
 * emerging from under the tuft's lower edge is the shadow a real brow casts,
 * which the toon ramp will not draw on its own.
 */
export const BROW_STYLES: readonly BrowStyle[] = ['fine', 'bushy']

/**
 * One brow ridge, on `side` (+1 is the character's **left**, at +X).
 *
 * ── It follows the forehead, because a chord across it does not ────────────
 *
 * The forehead's front surface at the brow band runs z = 0.249 at x = 0.020 out
 * to z = 0.215 at x = 0.120 — 34 mm of fall over 100 mm of width. A tuft
 * authored at one depth is therefore *buried at the nose end and floating at the
 * temple*, which is exactly what the first pass rendered as: a dark stick over
 * the outer half of each eye and nothing over the inner half. The axis now runs
 * 0.242 → 0.207, a chord whose worst sag against that curve is 6.5 mm — well
 * inside the mass's own 17 mm radius, so every millimetre of its length stands
 * proud.
 *
 * Long enough to cover the widest eye the ten styles offer (|x| to 0.1077 on
 * `sleepy`), and rooted 19 mm inside at the inner end so it fades into the bridge
 * of the nose rather than ending in a visible cap.
 *
 * `crossSection` is `[forward-and-inboard, vertical]` for this near-lateral
 * axis, so 0.62 in the second slot is what keeps it a **ridge** rather than a
 * sausage: 30 mm tall against 46 mm of forward mass. Left round it tops out
 * above the painted hairline at y = 1.299 and reads as the fringe reaching the
 * eyes rather than as a brow.
 *
 * ── Twice the first pass's mass, and it is the difference between a brow and
 *    a twig ────────────────────────────────────────────────────────────────
 *
 * The radii started at 11 → 16.5 mm, which is a *decal's* thickness given
 * volume, and rendered at 1.5 m as two dark sticks standing off the forehead
 * with daylight under them. A brow ridge is not a thicker line, it is the
 * forehead changing shape, so the mass has to be big enough that its lower edge
 * sits on the skin rather than floating over it: 16 → 24 mm, rooted 38 mm inside
 * the skull instead of 98, and 5 mm lower so its underside lands on the decal
 * `face.ts` draws rather than above it.
 *
 * The colour is the **beard's**, not `browColour`'s. `browColour` carries the
 * hair seven tenths of the way to its dark stop because a 7 mm line lying on
 * skin reads by albedo alone; a ridge reads by shape, and at that darkening it
 * came out near-black on grey hair — the same "black bib" failure `variants.ts`
 * records for the chin wedge, on a smaller mass. Matching the beard is also what
 * a face does.
 */
const browSpec = (side: 1 | -1, colour: Color): StrandSpec => ({
  from: [side * 0.02, 1.2835, 0.242],
  to: [side * 0.115, 1.2885, 0.207],
  radiusStart: 0.017,
  radiusEnd: 0.025,
  radial: 5,
  rings: 1,
  capRings: 1,
  crossSection: [0.95, 0.68],
  colorStart: colour,
  colorEnd: colour
})

// ─── Noses ──────────────────────────────────────────────────────────────────

/**
 * ── The one feature the face could never have ───────────────────────────────
 *
 * `face.ts` mentions a nose four times and never draws one, and it is right not
 * to: a nose has no flat form. Every other feature on this head is a dark shape
 * on light skin — an eye, a mouth, a brow — and reads because of its albedo. A
 * nose is the same colour as the face it is on. It reads by **shading and
 * outline** or it does not read at all, which makes it the one feature that is
 * geometry-or-nothing.
 *
 * That also makes it the cheapest characterful thing on the figure: 30 triangles
 * of skin-coloured volume, no new colour, no new material, and it lands in the
 * outline hull so the 1.6 px rim draws its profile from the side.
 *
 * ── The window it has to fit in ─────────────────────────────────────────────
 *
 * Measured on the shipped face, across the ten eye styles:
 *
 *   * the **mouth** tops out at y = 1.1690 and is 47 mm wide,
 *   * the **eyes** bottom out at y = 1.1978 and their inner corners come to
 *     |x| ≈ 0.037 on the closest-set style,
 *   * the head's front surface runs z = 0.1768 at y = 1.1132 to z = 0.2310 at
 *     y = 1.1943.
 *
 * So a nose lives in y ∈ [1.172, 1.228] and |x| ≤ 0.042 — 56 mm of height and
 * 84 mm of width at the very widest, which is `broad`. Everything below is
 * inside that box, and `tests/world/characterFeatures.test.ts` holds it there.
 */
export const NOSE_STYLES: readonly NoseStyle[] = ['none', 'button', 'round', 'hooked', 'broad']

interface NoseSpec {
  /** Root, buried in the skull. */
  from: readonly [number, number, number]
  /** Tip. */
  to: readonly [number, number, number]
  radiusStart: number
  radiusEnd: number
  crossSection: readonly [number, number]
}

/**
 * The four shapes, spread over the two things a nose at this scale can say.
 *
 * **How far it comes out** and **which way it points** — that is the whole
 * vocabulary at 30 triangles, and it is more than enough, because the nose is
 * the only thing on the face with a profile at all. Width is a third lever and a
 * weak one: it is invisible face-on against a 470 mm head and only shows in the
 * shadow the nose casts on its own cheek, which the toon ramp bands rather than
 * graduates.
 *
 * `crossSection` is `[width (X), vertical]` for this near-Z axis — the frame
 * `limbMesh` picks for an axis within 26° of +Z — so the first slot is the one
 * that widens a nostril and the second is the one that makes a beak.
 */
const NOSES: Record<Exclude<NoseStyle, 'none'>, NoseSpec> = {
  /** Small, upturned, and the one that suits a young or a female face. 18 mm proud. */
  button: {
    from: [0, 1.2, 0.12],
    to: [0, 1.192, 0.238],
    radiusStart: 0.016,
    radiusEnd: 0.0195,
    crossSection: [1.15, 0.9]
  },
  /** The reference's nose: bulbous, level, and the widest tip in the set. */
  round: {
    from: [0, 1.212, 0.11],
    to: [0, 1.188, 0.243],
    radiusStart: 0.019,
    radiusEnd: 0.026,
    crossSection: [1.2, 0.95]
  },
  /**
   * Aquiline. The bridge starts high and the tip drops below it, so the
   * *profile* has a break in it — which is the only nose shape that reads from
   * the side at 8 m, where the tip's own diameter is under two pixels.
   */
  hooked: {
    from: [0, 1.222, 0.1],
    to: [0, 1.178, 0.246],
    radiusStart: 0.015,
    radiusEnd: 0.0185,
    crossSection: [0.95, 1.15]
  },
  /** Flat and wide: the full 84 mm of the window, and only 21 mm of projection. */
  broad: {
    from: [0, 1.208, 0.115],
    to: [0, 1.191, 0.233],
    radiusStart: 0.021,
    radiusEnd: 0.028,
    crossSection: [1.5, 0.78]
  }
}

const noseSpec = (style: Exclude<NoseStyle, 'none'>, skin: Color): StrandSpec => {
  const nose = NOSES[style]
  return {
    from: nose.from,
    to: nose.to,
    radiusStart: nose.radiusStart,
    radiusEnd: nose.radiusEnd,
    radial: 5,
    rings: 1,
    capRings: 1,
    crossSection: nose.crossSection,
    // Skin at both ends. A nose is not a second material and it is not tinted:
    // GDD §3 allows exactly the palette, the ramp does the shading, and a nose
    // painted a shade of its own is the "stuck-on" failure `face.ts` describes
    // for a patch lit by its own geometry.
    colorStart: skin,
    colorEnd: skin
  }
}

// ─── The block ──────────────────────────────────────────────────────────────

/**
 * Beard, brows and nose as one mesh, in the struct `hairMesh` and `earMesh`
 * return, or `null` when the character has none of the three.
 *
 * **One block, not three.** `chibiGeometry` appends it through the same
 * `appendHeadStrands` the hair goes through, and each extra call is another
 * `blocks` boundary for three test suites to locate and another place the warp
 * or the weights could be passed differently. They also belong together by the
 * only property that matters downstream: all three ride the skull, none of them
 * is ever tucked under a hat, and all three are in the outline hull.
 *
 * Returns `null` for the default appearance, which is what keeps the shipped
 * figure byte-identical — `appendHeadStrands` takes an early return on it and
 * not one vertex moves.
 */
/**
 * How much of the block a coarse LOD tier still wants.
 *
 * The two middle values exist because the three axes here do **not** fall off at
 * the same range, and neither does a beard's own anatomy:
 *
 *   * `'beard'` — a brow ridge and a nose are 20–40 mm of relief and resolve to
 *     nothing past about 8 m, while a beard is *silhouette*: `patriarch` is
 *     294 mm across on a 470 mm head, still 6 px wide at 45 m. LOD1 keeps the
 *     beard and drops the other two.
 *   * `'beardMass'` — inside a beard the same split happens again. The **main
 *     mass** is the silhouette; the moustache (30 mm), the sideburns (a strip
 *     down the cheek) and `forked`'s two tines are *shape within* it, and at
 *     LOD2's 45 m the whole head is 13 px, so a 30 mm moustache is 1.5 px and
 *     the notch between two tines is 4. LOD2 keeps the mass alone, which takes
 *     `forked` from 250 triangles to about 90 without changing the outline a
 *     crowd is read by.
 *
 * See `CHIBI_TIERS` for which tier asks for which.
 */
export type FeatureScope = 'all' | 'beard' | 'beardMass' | 'none'

export const featureMesh = (
  appearance: CharacterAppearance,
  scope: FeatureScope = 'all',
  detail: StrandDetail = FULL_STRAND_DETAIL
): HairMesh | null => {
  if (scope === 'none') {
    return null
  }
  const specs: StrandSpec[] = []

  if (appearance.beard !== 'none') {
    const beard = beardStops(appearance)
    specs.push(...beardSpecs(appearance.beard, beard.base, beard.dark, beard.base, scope !== 'beardMass'))
  }
  if (scope === 'all') {
    if (appearance.brows === 'bushy') {
      const colour = beardStops(appearance).base
      specs.push(browSpec(1, colour), browSpec(-1, colour))
    }
    if (appearance.nose !== 'none') {
      specs.push(noseSpec(appearance.nose, skinColour(appearance)))
    }
  }

  return buildStrands(specs, detail)
}
