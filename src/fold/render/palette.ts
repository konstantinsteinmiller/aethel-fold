/**
 * Aethel Fold palette (aethel-fold-GDD §2).
 *
 * "Pastel base terrain with highly saturated, contrasting primary colors for
 * interactive elements." Everything that draws — materials, canvas painters,
 * VFX, the UI — takes its colours from here. No hex literals elsewhere in
 * `src/fold/render`.
 */

export const HEX = {
  // Desk & lamp
  deskDark: '#5b3a24',
  desk: '#8a5a36',
  deskLight: '#b07a4a',
  deskGrain: '#6d4429',
  lamp: '#ffe2b0',
  lampWarm: '#ffc774',
  // Winter (roadmap #17): the lamp turns to a crisp, cool winter daylight, so
  // snow reads white instead of cream (the warm lamp multiplies blue by ~0.7).
  lampWinter: '#e8eeff',
  shadow: '#6c6aa8',          // periwinkle-violet: shadows are never black
  shadowDeep: '#4a4078',
  // Night mode (the desk lamp's secret, roadmap #15): the room falls to a
  // periwinkle dusk (a multiply, never black), the lamp keeps a warm pool.
  night: '#6a6aa6',
  nightLamp: '#fff0d2',

  // Paper
  parchment: '#f4e7c9',
  parchmentLight: '#fbf3df',
  parchmentShade: '#e3d0a6',
  parchmentEdge: '#cdb47f',
  paperWhite: '#fffaf0',
  underlayer: '#d9c49a',
  underlayerInk: '#9b7f52',
  blueprint: '#8fb3d9',
  bookCover: '#9b2f33',
  bookCoverDark: '#6e1f27',
  bookGold: '#e0b64f',

  // Ink
  ink: '#1c1724',
  inkSoft: '#3a3142',

  // Terrain (pastel)
  meadow: '#bfdd8f',
  meadowDark: '#94c26a',
  meadowLight: '#d8ecb0',
  forest: '#6fae5c',
  forestDark: '#4f8b45',
  road: '#e9d2a2',
  roadDark: '#d4b67d',
  water: '#9fd0ee',
  waterDark: '#6fb0dd',
  waterLight: '#d3ecfa',
  rock: '#c9bfae',
  rockDark: '#a39684',
  ravine: '#8c6f4c',
  snow: '#fbfbff',

  // Interactive (saturated)
  guide: '#2f8cff',
  guideGlow: '#8fd0ff',
  highlight: '#ffd23f',
  highlightHot: '#fff08a',
  danger: '#ff4b3e',

  // Heroes & enemies
  heroBlue: '#3f73e0',
  heroBlueDark: '#244a9e',
  heroSteel: '#dfe7f2',
  enemyRed: '#e0453b',
  enemyRedDark: '#9e2a28',
  enemySteel: '#c6ccd6',
  steelDark: '#7d8594',
  skin: '#f6c9a0',
  skinShade: '#e2a67c',
  wood: '#b8844f',
  woodDark: '#80552f',
  gold: '#f4c542',
  goldDark: '#c8962a',
  stone: '#d7cfc0',
  stoneDark: '#aa9f8d',
  stoneLight: '#ece6d8',
  roofRed: '#e05a45',
  roofRedDark: '#a93c33',
  roofBlue: '#4d7fd6',
  flagYellow: '#ffd23f',

  // Dragon (GDD: bright reds, blues, greens and yellows)
  dragonRed: '#ec3f32',
  dragonRedDark: '#b72a25',
  dragonBlue: '#2f73e8',
  dragonBlueDark: '#1f4fb0',
  dragonGreen: '#3fb45a',
  dragonGreenDark: '#2b8342',
  dragonYellow: '#f7c93a',
  dragonOrange: '#f58a2f',
  gear: '#ffcf3f',
  gearGlow: '#fff2a8',

  // Frog
  frog: '#5cc65a',
  frogDark: '#3b9442',
  frogBelly: '#d8f0a0',

  // The outro's cheering crowd (C9b): chibi paper people in pastel clothes.
  pastelPink: '#ffc2d4',
  pastelPinkDark: '#ec93b0',
  pastelMint: '#b4ecd0',
  pastelMintDark: '#7fcfa8',
  pastelSky: '#b6d6fb',
  pastelSkyDark: '#82afe8',
  pastelLemon: '#fff0a8',
  pastelLemonDark: '#f0cf62',
  pastelLilac: '#dcc8ff',
  pastelLilacDark: '#b49ae8',
  blush: '#ff9fb5',            // rosy cheeks
  tongue: '#ff7f93',
  hairBrown: '#9a6440',
  hairGold: '#f2c35a',
  straw: '#f5d98a',
  strawDark: '#d9b55e',
  // Book 3's outro (the dolphins and the paper boats): pastel sea folk. The
  // dolphins are periwinkle, not sea blue, so they read against the sea they leap from.
  dolphin: '#a9b6f4',
  dolphinDark: '#7f8fdc',
  dolphinBelly: '#f2f4ff',
  boatSail: '#fff6e2',
  boatHull: '#ffb8a8',
  boatHullDark: '#ec8f82',

  // Paper patterns (roadmap #6) — pale stocks, so lanes, folds and standees stay the loudest thing on the page.
  washi: '#f6e6d6',          // kozo paper, faintly rosy
  washiFibre: '#d9b9a4',
  washiPrint: '#c98a8a',     // the faded seigaiha waves
  graphPaper: '#eef0e6',     // engineer's pad: a cool off-white
  graphLine: '#9cc3dc',
  newsprint: '#e7e1d0',      // grey-beige pulp
  newsInk: '#6e6a66',        // soft grey type and halftone (never black)
  mapPaper: '#ecd9ad',       // old survey sheet
  mapLine: '#b0875a',        // contour lines

  // Seasons (roadmap #17)
  duskOrange: '#f29a4a',     // Halloween: the warm half of the dusk wash
  duskPurple: '#7b5aa6',     // …and the cool half; shadows stay periwinkle
  pumpkin: '#f28a2e',
  pumpkinDark: '#c9621c',
  pumpkinStem: '#5f8a3a',
  bat: '#4b3b66',            // bats are plum paper, never black
  batWing: '#6a5690',
  snowShade: '#dfe6f4',      // Winter: the blue shade on drifts
  // Winter, made to survive the warm lamp: a cool blue-white paper and snow
  // banks with a periwinkle-blue edge (never black), so snow reads as snow and
  // not as more parchment under the desk light.
  snowPaper: '#dfeaf7',
  snowBank: '#f6faff',
  snowEdge: '#9fb8dc',
  iceBlue: '#bcd8f0',
  scarfRed: '#e0473f',       // the hero's knitted scarf
  scarfRedDark: '#a8322e',
  sash: '#8a4fc0',           // the hero's royal sash
  sashDark: '#5e3390',

  // Book 3 — the Sea of Paper (roadmap #3): pastel sea and sand for the
  // terrain; the kraken below.
  sea: '#8fc6e8',
  seaDeep: '#5f9ed3',
  seaFoam: '#e4f4fb',
  sand: '#efdcae',
  sandDark: '#d6bb82',
  kelp: '#7fb28a',
  // The kraken is "scary but cute": soft pastel coral with periwinkle brows
  // and teal spots, big white eyes with deep-sea-blue pupils — menacing by
  // its size and posture, never by a grim palette.
  kraken: '#ff9f8e',
  krakenDark: '#e8796d',
  krakenLight: '#ffc9bd',
  krakenSucker: '#fff1e8',
  krakenEye: '#fffdf8',
  krakenPupil: '#2f4a6e',
  krakenBrow: '#6b62b5',
  krakenBeak: '#ffd479',
  krakenTeal: '#7fd1c8',
  inkJet: '#4b3f7a',          // the kraken's ink is plum-violet paper, never black
  lighthouse: '#e8554a',
  lighthouseDark: '#a93a34',
  fish: '#ff8f4a',
  fishDark: '#d8612a',
  fishBelly: '#ffe0b0',
  chartPaper: '#eae6d2',      // sea-chart paper (a cosmetic): a cool cream
  chartLine: '#86aac4',       // its rhumb lines and soundings
  sailorNavy: '#2b4a8e',      // the sailor hero's cap and collar
  sailorWhite: '#f7f9ff',

  // Confetti
  c1: '#ff5a5f',
  c2: '#ffd23f',
  c3: '#3fc1ff',
  c4: '#6ee07a',
  c5: '#b57bff',
  c6: '#ff9a3c',
  c7: '#ff7ac8',
  c8: '#ffffff'
} as const

export type PaletteKey = keyof typeof HEX

/** Confetti draws from the saturated set so bursts read as festive paper chips. */
export const CONFETTI_KEYS: readonly PaletteKey[] = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']

/** Parse a palette hex into linear-ish sRGB floats (0…1) without three.js. */
export const rgb = (key: PaletteKey): [number, number, number] => {
  const h = HEX[key]
  const n = parseInt(h.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export const css = (key: PaletteKey, alpha = 1): string => {
  if (alpha >= 1) return HEX[key]
  const [r, g, b] = rgb(key)
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`
}
