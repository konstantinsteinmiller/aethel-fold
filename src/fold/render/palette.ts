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
