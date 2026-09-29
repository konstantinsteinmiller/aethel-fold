/**
 * Aethel Fold's logo, as data: a paper castle popping up out of an open book,
 * over the wordmark on a die-cut red ribbon.
 *
 * One source for every place the logo appears:
 *   - `GameLogo.vue` (the Vue splash) renders `logoSvg()`;
 *   - `index.html`'s static splash carries a copy of `logoSvg({ markOnly: true })`
 *     (it paints before any JS runs, so it cannot import this) — if the mark is
 *     redrawn, regenerate that copy too;
 *   - `scripts/render-logo.mjs` rasterises it to
 *     `public/images/logo/logo_{192x192,512x512}.png` and `logo_256x256.webp`.
 *
 * Drawing rules (same as the game's paper UI): flat facets, each fold a hard
 * change between a lit and a shaded facet; every facet is drawn twice — first
 * in ink at double width so the union gets one clean outer keyline, then in
 * its paper colour with a thin ink stroke that reads as the fold lines. The
 * ink is #1c1724, never #000.
 */

export const LOGO_INK = '#1c1724'

const STONE = '#ece6d8'
const STONE_SHADE = '#cfc5b2'
const RED = '#ff6a5c'
const RED_SHADE = '#d8433b'
const BLUE = '#5f95ff'
const BLUE_SHADE = '#3464d6'
const YELLOW = '#ffe066'
const PAGE = '#fff6e3'
const PAGE_SHADE = '#e7d3a8'
const COVER = '#9b2f33'
const WOOD = '#80552f'

export interface LogoFacet {
  points: string
  fill: string
}

/** Back to front. The castle stands in the book's gutter. */
export const LOGO_FACETS: readonly LogoFacet[] = [
  // The book: cover edge, then the two open pages.
  { points: '10,166 128,186 246,166 246,190 128,210 10,190', fill: COVER },
  { points: '16,158 128,176 128,200 16,182', fill: PAGE },
  { points: '128,176 240,158 240,182 128,200', fill: PAGE_SHADE },
  // Flag poles and flags (behind the roofs).
  { points: '126,22 130,22 130,46 126,46', fill: WOOD },
  { points: '130,22 156,28 130,36', fill: YELLOW },
  { points: '71,46 75,46 75,68 71,68', fill: WOOD },
  { points: '75,46 94,51 75,57', fill: RED },
  { points: '181,46 185,46 185,68 181,68', fill: WOOD },
  { points: '185,46 204,51 185,57', fill: RED_SHADE },
  // Curtain walls between the towers and the keep, crenellated.
  { points: '86,134 100,134 100,178 86,176', fill: STONE_SHADE },
  { points: '156,134 170,134 170,176 156,178', fill: STONE_SHADE },
  { points: '86,126 93,126 93,134 86,134', fill: STONE },
  { points: '163,126 170,126 170,134 163,134', fill: STONE },
  // Left tower: lit face, shaded side, blue roof.
  { points: '56,108 78,108 78,180 56,176', fill: STONE },
  { points: '78,108 90,108 90,178 78,180', fill: STONE_SHADE },
  { points: '50,110 73,60 73,110', fill: BLUE },
  { points: '73,60 96,110 73,110', fill: BLUE_SHADE },
  // Right tower.
  { points: '166,108 178,108 178,180 166,178', fill: STONE },
  { points: '178,108 200,108 200,176 178,180', fill: STONE_SHADE },
  { points: '160,110 183,60 183,110', fill: BLUE },
  { points: '183,60 206,110 183,110', fill: BLUE_SHADE },
  // The keep, its red roof and its door.
  { points: '98,90 136,90 136,184 98,178', fill: STONE },
  { points: '136,90 158,90 158,178 136,184', fill: STONE_SHADE },
  { points: '92,92 128,40 128,92', fill: RED },
  { points: '128,40 164,92 128,92', fill: RED_SHADE },
  { points: '117,182 117,156 127,146 137,156 137,182', fill: WOOD },
  { points: '122,108 132,108 132,122 122,122', fill: LOGO_INK },
  // Windows on the towers.
  { points: '69,124 76,124 76,136 69,136', fill: LOGO_INK },
  { points: '180,124 187,124 187,136 180,136', fill: LOGO_INK }
]

/** The wordmark's ribbon: a band with swallow-tailed ends, shaded below its crease. */
export const LOGO_RIBBON = '10,210 246,210 234,231 246,252 10,252 22,231'
export const LOGO_RIBBON_SHADE = '22,231 234,231 246,252 10,252'
export const LOGO_RIBBON_FILL = RED
export const LOGO_RIBBON_SHADE_FILL = RED_SHADE

const polys = (fill: (f: LogoFacet) => string): string =>
  LOGO_FACETS.map((f) => `<polygon points="${f.points}"${fill(f)}/>`).join('')

/**
 * The whole logo as an SVG string (viewBox 256×256). `markOnly` drops the
 * wordmark (the static splash paints before the 'Angry' font is available).
 */
export const logoSvg = (o: { markOnly?: boolean; font?: string } = {}): string => {
  const font = o.font ?? "'Angry', sans-serif"
  const mark =
    `<g fill="${LOGO_INK}" stroke="${LOGO_INK}" stroke-width="10" stroke-linejoin="round">${polys(() => '')}</g>` +
    `<g stroke="${LOGO_INK}" stroke-width="2.5" stroke-linejoin="round">${polys((f) => ` fill="${f.fill}"`)}</g>`
  const word = o.markOnly
    ? ''
    : `<polygon points="${LOGO_RIBBON}" fill="${RED}" stroke="${LOGO_INK}" stroke-width="10" stroke-linejoin="round"/>` +
      `<polygon points="${LOGO_RIBBON_SHADE}" fill="${RED_SHADE}"/>` +
      `<polygon points="${LOGO_RIBBON}" fill="none" stroke="${LOGO_INK}" stroke-width="4" stroke-linejoin="round"/>` +
      `<text x="128" y="242" text-anchor="middle" style="font-family:${font}" font-size="30" textLength="196" ` +
      `lengthAdjust="spacingAndGlyphs" fill="#ffffff" stroke="${LOGO_INK}" stroke-width="6" stroke-linejoin="round" ` +
      'paint-order="stroke fill">AETHEL FOLD</text>'
  return `<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Aethel Fold" focusable="false">${mark}${word}</svg>`
}
