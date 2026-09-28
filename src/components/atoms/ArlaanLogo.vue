<script setup lang="ts">
import { computed } from 'vue'

/**
 * ─── The mark: a golden griffin on a red field ──────────────────────────────
 *
 * The repo's brand was still the 2D tower-siege game's — a gothic "Tower Siege"
 * wordmark baked into `images/logo/logo_256x256.webp`, plus three pulsing CSS
 * boxes in `index.html` standing in for a tower. Both described a game that is
 * no longer what boots. This is the replacement: Arlaan's arms.
 *
 * The device is not invented. The manuscript states them outright —
 * `storyline-current.md` §4.1: *"Arlaan — südliches Königreich … Wappen:
 * **goldener Greif auf rotem Grund**"* — and the two colours already exist in
 * the 3D palette (`C.arlaanRed`, `C.arlaanGold`), where they paint the banner
 * over Nimmerschein's gate and the town guards' livery. So the splash, the
 * gate banner and a guard's surcoat are the same two colours by construction,
 * which is the entire reason to use the arms rather than draw a title card.
 *
 * ── Why an inline SVG component and not a bitmap ────────────────────────────
 *
 * A raster logo has to be authored at every size the game shows it at, and this
 * one is shown at `min(vw, vh) * 0.4` — i.e. 128 px on a phone and 430 px on a
 * desktop, continuously. The old `<img>` solved that by shipping a 256² webp
 * and letting the browser upscale it, which is why the splash logo was visibly
 * soft on anything above a 640 px viewport. A component also costs no request
 * on the critical path (it is part of the splash chunk), and it can be recoloured
 * for a light background without a second file — see `monochrome` below.
 *
 * ── Why these colours are hex literals here ─────────────────────────────────
 *
 * GDD §3 forbids hex literals *in `src/world/`*, and the right-looking move is
 * to import `C.arlaanRed` / `C.arlaanGold` from `art/palette.ts`. Rejected:
 * that module imports `three`'s `Color`, and this component is mounted by
 * `FLogoProgress` before the renderer chunk is even requested. Importing the
 * palette would drag three.js into the splash's chunk to read two numbers —
 * i.e. it would delay the loading screen in order to draw the loading screen.
 * The values are duplicated with the palette's names in the comments instead;
 * if the arms are ever restyled, `palette.ts` is the file to grep for.
 *
 * ── Why the drawing looks the way it does ───────────────────────────────────
 *
 *  * **Flat fills, no gradients, no filters** (GDD §2 R1/R8). Three golds, not
 *    a ramp: `GOLD_LIT` on the wing coverts and the breast, `GOLD` on the body,
 *    wings and head, `GOLD_DARK` on the haunches and tail. That is the same
 *    three-band toon ramp the 3D game shades every object with, flattened to 2D,
 *    and it is what stops the figure reading as a flat sticker without adding a
 *    single gradient stop. The bands also run bright-at-the-top to
 *    dark-at-the-base, which is a second, purely tonal way of reading the
 *    figure once the shapes stop resolving.
 *  * **The griffin is *displayed* (wings raised, symmetric), not *rampant*.**
 *    Heraldically a rampant griffin is the more usual charge for arms and it
 *    was the first attempt. It failed the small-size test: an asymmetric mass
 *    inside a symmetric shield reads as a smudge leaning to one side once the
 *    mark is under ~96 px, which is the band a browser tab icon and a portal
 *    thumbnail live in. A displayed pose puts the two heaviest shapes — the wings —
 *    on the shield's own axis, so the silhouette survives the downscale. The
 *    head stays in profile facing dexter, which is what keeps it a bird of prey
 *    rather than an owl.
 *  * **Both wings and both body halves are one authored path plus a mirror**
 *    (`MIRROR`, a reflection about x = 128). Hand-authoring the second half is
 *    how a symmetric mark ends up 2 px off, and the two halves meet exactly on
 *    the centre line so their union has no seam.
 *  * **Feather count is 4, and the notches are 17 view-box units deep.** The
 *    first pass used five shallower primaries; at a 64 px render 1 unit is
 *    0.25 px, so its ~8-unit notches came out at 2 px and aliased into a grey
 *    fringe along the wing. Four notches at 17 units survive the downscale as a
 *    serration, which is what a wing is supposed to look like there.
 *  * **The head sits high, and the beak is short.** Not a style choice — a
 *    measurement. Each wing's leading edge crosses the head's band on its way
 *    down to the shoulder, and both shapes carry a 6-unit keyline, so anything
 *    less than ~12 units of clearance closes up and the beak welds itself to
 *    the wing. The first pass had a long beak reaching x = 90 with 6 units of
 *    gap and the whole left side rendered as one blob. Raising the crown to
 *    y = 26 and stopping the beak at x = 94 buys 11 units, i.e. ~5 units of
 *    visible red at the tightest point. Moving the head is the fix; shrinking
 *    the wings is not, because the wings are what carries the mark at 64 px.
 *  * **The keyline is the inverted hull, in 2D.** Every figure path is drawn
 *    twice: once filled *and* stroked in `KEYLINE` with a round join, then again
 *    on top with its real fill and no stroke. The first pass fattens each shape
 *    by half the stroke width, so what survives is a clean outline around the
 *    *union* of the parts and no seams between them — stroking the group
 *    directly would have outlined every internal facet boundary.
 *    `KEYLINE` itself is GDD §2 R6's rule applied to `arlaanRed`: base × 0.22
 *    (#22090a), shifted cool. Never `#000`.
 *  * **The keyline is *not* screen-space.** R6 pins outlines to 1.6 screen px
 *    because in the 3D world an outline is a depth cue that must not thicken as
 *    you walk up to a rock. A logo is the opposite case: it is reproduced from
 *    16 px to 1024 px and its outline is part of the drawing, so it scales with
 *    the art. No `vector-effect` here, deliberately.
 *  * **The eye is a hole, not a dark dot** (an even-odd subpath on the head).
 *    A filled dot needs a colour, and in `monochrome` there is only one, so the
 *    eye would have vanished into the skull exactly when the mark has the least
 *    other information to go on.
 *
 * ── Why the wordmark is pinned with `textLength` ────────────────────────────
 *
 * The stack is system-serif — no webfont, because a logo that needs a network
 * round-trip to be itself is worse than one that doesn't. The cost is that the
 * face resolves to Georgia on Windows, Times on macOS and Liberation/Nimbus on
 * Linux, whose cap widths differ by ~12 %, so a lockup tuned on one machine
 * comes out either overflowing the shield or floating inside it on the next.
 * `textLength` + `lengthAdjust="spacing"` pins both lines to the shield's own
 * 168-unit width and lets the browser distribute the difference into the
 * tracking, which is the one thing that *should* differ between faces. Note
 * there is no `letter-spacing`: with `textLength` present it double-applies.
 *
 * The stack is applied as an **inline style, not a `font-family` attribute**.
 * `App.vue` ships an unscoped `* { font-family: 'Angry', sans-serif }`, and a
 * CSS rule — even a bare `*` — outranks an SVG presentation attribute. With the
 * attribute form the wordmark rendered in the 2D tower game's cartoon face with
 * no error anywhere; it was only visible by opening the splash and looking.
 *
 * The wordmark is gold on the assumption of a dark ground, because that is
 * every surface it ships on (the `index.html` splash, `FLogoProgress`'s
 * backdrop, and the scene's night sky, all #0a1224). `monochrome` exists for
 * the other case: it drops the field to an outline and paints the whole mark in
 * `currentColor`, so a caller on a light background gets a usable one-colour
 * stamp instead of low-contrast gold on white.
 */

interface Props {
  /** Rendered size in px, square. Overridden by any width/height utility the
   *  caller puts on the element — CSS beats presentation attributes — which is
   *  how `FLogoProgress` fills its fluid box with `w-full h-full`. */
  size?: number
  /** One-colour stamp: the field becomes an outline and every part of the
   *  figure paints in `currentColor`. For light grounds and for anywhere the
   *  two-colour arms would fight the surrounding UI. */
  monochrome?: boolean
}

const props = withDefaults(defineProps<Props>(), { size: 256, monochrome: false })

// `C.arlaanRed` / `C.arlaanGold` in `src/world/art/palette.ts`. See the header
// for why they are copied rather than imported.
const RED = '#9c2b2e'
const GOLD = '#d8ae4e'
// The lit and shadow bands of the same gold — the toon ramp's two other stops.
const GOLD_LIT = '#eccb7f'
const GOLD_DARK = '#a4762f'
// GDD §2 R6: base × 0.22, shifted cool. Not black.
const KEYLINE = '#1b0c11'

const SERIF = "Georgia, 'Times New Roman', 'Liberation Serif', 'Nimbus Roman', serif"
/** Inline, not a `font-family` attribute. `App.vue` carries an unscoped
 *  `* { font-family: 'Angry', sans-serif }`, and *any* CSS rule outranks an
 *  SVG presentation attribute — so the attribute form silently rendered the
 *  wordmark in the tower game's cartoon face. An inline style outranks the
 *  rule back. */
const wordStyle = { fontFamily: SERIF } as const

/** Reflection about the vertical centre line of the 256-unit view box. */
const MIRROR = 'matrix(-1 0 0 1 256 0)'

/** Heater shield. Square top with a 6-unit corner radius, straight flanks to
 *  the waist, then two cubics into the point — one path, so the outline is one
 *  stroke. */
const SHIELD =
  'M 50 12 H 206 A 6 6 0 0 1 212 18 V 96 C 212 146 176 176 128 194 ' +
  'C 80 176 44 146 44 96 V 18 A 6 6 0 0 1 50 12 Z'

type Tone = 'base' | 'lit' | 'dark'

/** A drawn part of the griffin. `mirror` emits a second, reflected copy — used
 *  for everything that straddles the axis; the halves are authored to end
 *  exactly on x = 128 so the join is invisible. */
interface Part {
  d: string
  tone: Tone
  mirror?: boolean
}

// Back to front: tail, haunches, body, wings, coverts, breast, head.
const FIGURE: ReadonlyArray<Part> = [
  // Lion tail, on the axis, running past the paws into the shield's point so
  // it is not swallowed by them. Drawn first — it passes behind the haunches.
  { d: 'M 122 124 L 134 124 L 132 152 L 140 158 L 128 180 L 116 158 L 124 152 Z', tone: 'dark' },
  // Lion haunch, thigh and paw. Right half; mirrored for the left.
  { d: 'M 128 106 L 148 112 L 158 128 L 152 148 L 165 154 L 163 166 L 141 164 L 136 138 L 128 132 Z', tone: 'dark', mirror: true },
  // Chest and flank, shoulder down to the belly. Its shoulder is authored to
  // land within a keyline's width of the wing root so the two read as one mass.
  { d: 'M 128 56 L 145 76 L 149 100 L 154 118 L 144 130 L 128 126 Z', tone: 'base', mirror: true },
  // Raised wing: leading edge out to the tip, then four primaries back in.
  { d: 'M 146 104 L 152 78 L 164 60 L 174 46 L 186 37 L 196 32 L 197 54 L 178 52 L 187 69 L 169 66 L 177 83 L 159 81 L 167 98 Z', tone: 'base', mirror: true },
  // Coverts — the lit band along the wing's leading edge.
  { d: 'M 152 78 L 164 60 L 174 46 L 186 37 L 196 32 L 184 46 L 176 56 L 166 71 L 155 88 Z', tone: 'lit', mirror: true },
  // Breast plate, so the body is not one flat slab at large sizes.
  { d: 'M 128 60 L 140 76 L 141 92 L 128 98 Z', tone: 'lit', mirror: true },
  // Eagle head in profile facing dexter: flat crown, hooked beak, and a
  // concave nape notch — without the notch the skull runs into the chest in
  // one convex sweep and the bird reads as a goose. The eye is cut out of the
  // same path as an even-odd subpath.
  {
    d:
      'M 136 36 L 128 26 L 117 26 L 109 32 L 99 35 L 94 47 L 102 43 L 108 47 L 112 55 L 122 61 L 137 59 L 131 46 Z ' +
      'M 116.5 39 a 4.5 4.5 0 1 0 9 0 a 4.5 4.5 0 1 0 -9 0 Z',
    tone: 'base'
  }
]

/** `FIGURE` with every mirrored part expanded into its two copies. Built once
 *  at module scope — the geometry is constant, so there is nothing to make
 *  reactive. */
const PARTS: ReadonlyArray<{ d: string, tone: Tone, t?: string }> = FIGURE.flatMap(
  (p) => (p.mirror ? [{ d: p.d, tone: p.tone }, { d: p.d, tone: p.tone, t: MIRROR }] : [{ d: p.d, tone: p.tone }])
)

const fieldFill = computed(() => (props.monochrome ? 'none' : RED))
const fieldStroke = computed(() => (props.monochrome ? 'currentColor' : KEYLINE))
const wordFill = computed(() => (props.monochrome ? 'currentColor' : GOLD))

const toneFill = (tone: Tone): string => {
  if (props.monochrome) return 'currentColor'
  if (tone === 'lit') return GOLD_LIT
  if (tone === 'dark') return GOLD_DARK
  return GOLD
}
</script>

<template lang="pug">
  //- The title is a proper noun, so it is not routed through vue-i18n — the
  //- game is called this in both shipped locales.
  svg(
    :width="size"
    :height="size"
    viewBox="0 0 256 256"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Chroniken von Arlaan"
    focusable="false"
  )
    path(
      :d="SHIELD"
      :fill="fieldFill"
      :stroke="fieldStroke"
      stroke-width="6"
      stroke-linejoin="round"
    )

    //- Keyline pass — see the header. Filled *and* stroked in the outline
    //- colour so the union of the parts gets one clean outline; the colour
    //- pass below covers everything except the fattening.
    g(
      v-if="!monochrome"
      :fill="KEYLINE"
      :stroke="KEYLINE"
      stroke-width="6"
      stroke-linejoin="round"
      fill-rule="evenodd"
    )
      path(v-for="(p, i) in PARTS" :key="`k${i}`" :d="p.d" :transform="p.t")

    g(fill-rule="evenodd")
      path(v-for="(p, i) in PARTS" :key="`f${i}`" :d="p.d" :transform="p.t" :fill="toneFill(p.tone)")

    //- `:style`, not a `font-family` attribute — see the header. `App.vue`
    //- ships an unscoped `* { font-family: 'Angry' }`, and any CSS rule beats
    //- a presentation attribute.
    text(
      x="128"
      y="218"
      text-anchor="middle"
      :style="wordStyle"
      font-size="18"
      font-weight="700"
      textLength="168"
      lengthAdjust="spacing"
      :fill="wordFill"
    ) CHRONIKEN VON
    text(
      x="128"
      y="251"
      text-anchor="middle"
      :style="wordStyle"
      font-size="34"
      font-weight="700"
      textLength="156"
      lengthAdjust="spacing"
      :fill="wordFill"
    ) ARLAAN
</template>
