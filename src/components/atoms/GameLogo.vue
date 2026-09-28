<script setup lang="ts">
/**
 * ─── The placeholder mark: a paper crane and "CASTLE FOLD" ──────────────────
 *
 * The splash logo: an origami crane folded from Castle Fold's paper colours —
 * blue wings and body, red neck and tail, a yellow beak — under a bold ink
 * keyline, over the wordmark on a die-cut strip of red paper. Flat facets, no
 * gradients: each fold is a hard change between a lit and a shaded facet.
 * `index.html`'s static splash carries a copy of the same crane geometry
 * (without the wordmark, because the `Angry` font is not loaded before the app
 * boots) so the handover static splash → Vue splash shows the same drawing in
 * the same place.
 *
 * ── Keyline, then colour ────────────────────────────────────────────────────
 *
 * Every facet is drawn twice: first filled *and* stroked in the ink colour at
 * double width, so the union of the parts gets one clean outer outline, then
 * filled in its paper colour with a thin stroke that reads as the fold lines.
 * The ink is Castle Fold's #1c1724, never `#000`.
 *
 * ── The wordmark's font ─────────────────────────────────────────────────────
 *
 * Set as an inline style rather than a `font-family` attribute: `App.vue` ships
 * an unscoped `* { font-family: 'Angry', sans-serif }`, and any CSS rule
 * outranks an SVG presentation attribute. It is the same face either way here,
 * but the inline style keeps it correct if that global rule ever changes.
 */

interface Props {
  /** Rendered size in px, square. Overridden by any width/height utility the
   *  caller puts on the element (CSS beats presentation attributes). */
  size?: number
  /** Hide the wordmark and show only the crane. */
  markOnly?: boolean
}

withDefaults(defineProps<Props>(), { size: 256, markOnly: false })

const KEYLINE = '#1c1724'

interface Facet {
  points: string
  fill: string
}

/** Paper colours: lit / shaded side of each fold. */
const BLUE = '#5f95ff'
const BLUE_SHADE = '#3464d6'
const RED = '#ff6a5c'
const RED_SHADE = '#d8433b'
const YELLOW = '#ffe066'
const PARCHMENT = '#fff6e3'

/** Back to front: wings behind, then neck and tail, then the body on top. */
const FACETS: readonly Facet[] = [
  // Left wing — two facets split along its centre fold.
  { points: '60,30 112,122 90,128', fill: BLUE_SHADE },
  { points: '60,30 128,122 112,122', fill: BLUE },
  // Right wing, lit from the other side so the pair does not read as a mirror.
  { points: '196,30 144,122 166,128', fill: BLUE },
  { points: '196,30 128,122 144,122', fill: BLUE_SHADE },
  // Neck, rising to the left, and the head folded down into a beak.
  { points: '90,130 106,134 40,64', fill: RED },
  { points: '36,60 52,66 28,94', fill: YELLOW },
  // Tail, rising to the right.
  { points: '166,130 150,134 226,70', fill: RED_SHADE },
  // Body — a kite split down the keel.
  { points: '84,128 128,118 128,178', fill: PARCHMENT },
  { points: '128,118 172,128 128,178', fill: '#e7d3a8' }
]

/** The wordmark's ribbon: a band with swallow-tailed ends, and the shaded
 *  lower half below its lengthwise crease. */
const RIBBON = '10,202 246,202 234,226 246,250 10,250 22,226'
const RIBBON_SHADE = '22,226 234,226 246,250 10,250'

const WORD_STYLE = { fontFamily: "'Angry', sans-serif" } as const
</script>

<template lang="pug">
  //- The title is a proper noun, so it is not routed through vue-i18n.
  svg(
    :width="size"
    :height="size"
    viewBox="0 0 256 256"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Castle Fold"
    focusable="false"
  )
    //- Keyline pass: one clean outline around the union of the facets.
    g(:fill="KEYLINE" :stroke="KEYLINE" stroke-width="10" stroke-linejoin="round")
      polygon(v-for="(f, i) in FACETS" :key="`k${i}`" :points="f.points")

    //- Colour pass: the thin stroke is the fold lines.
    g(:stroke="KEYLINE" stroke-width="2.5" stroke-linejoin="round")
      polygon(v-for="(f, i) in FACETS" :key="`f${i}`" :points="f.points" :fill="f.fill")

    template(v-if="!markOnly")
      //- The ribbon behind the wordmark: red paper, creased, ink-outlined.
      polygon(:points="RIBBON" :fill="RED" :stroke="KEYLINE" stroke-width="10" stroke-linejoin="round")
      polygon(:points="RIBBON_SHADE" :fill="RED_SHADE")
      polygon(:points="RIBBON" fill="none" :stroke="KEYLINE" stroke-width="4" stroke-linejoin="round")

      text(
        x="128"
        y="239"
        text-anchor="middle"
        :style="WORD_STYLE"
        font-size="34"
        textLength="196"
        lengthAdjust="spacingAndGlyphs"
        fill="#ffffff"
        :stroke="KEYLINE"
        stroke-width="6"
        stroke-linejoin="round"
        paint-order="stroke fill"
      ) CASTLE FOLD
</template>
