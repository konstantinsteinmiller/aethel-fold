import { prependBaseUrl } from '@/utils/function'

/**
 * ─── Art contract ───────────────────────────────────────────────────────────
 *
 * 3d-world ships with ZERO gameplay bitmaps: every block, enemy and
 * background layer is drawn procedurally in `useTowerArt.ts` from the palettes
 * below. That keeps the download tiny, makes the art resolution-independent
 * (crisp at any DPR and any zoom), and means the game is playable the instant
 * the JS parses.
 *
 * When real art arrives, it drops in with NO code change: `spriteFor()` probes
 * `/public/images/<folder>/<id>.webp` and, if the image decodes, the renderer
 * blits it instead of drawing. Paths are catalogued in `art-todo.md`.
 */

// ─── Palettes ───────────────────────────────────────────────────────────────
//
// Each palette is the full material description for one drawable: a base ramp
// (dark → mid → light) plus an accent used for fixtures, glows and trim. The
// renderer derives bevels, rim light and ambient occlusion from these, so a
// palette swap restyles the whole object coherently.

export interface Palette {
  /** Deepest shadow tone. */
  dark: string
  /** Body / mid tone. */
  mid: string
  /** Lit face. */
  light: string
  /** Fixture / trim / glow colour. */
  accent: string
  /** Secondary accent, used for details (bolts, rivets, eyes). */
  accent2: string
  /** RGB triplet for particle debris from this material. */
  debris: [number, number, number]
}

export const PALETTES: Record<string, Palette> = {
  // ── Blocks ───────────────────────────────────────────────────────────────
  wood: { dark: '#6b3f1d', mid: '#a9682f', light: '#d99a53', accent: '#4a2a12', accent2: '#f0c185', debris: [169, 104, 47] },
  brace: { dark: '#5d3a1b', mid: '#97602c', light: '#c98d4b', accent: '#3a2410', accent2: '#e8bb7d', debris: [151, 96, 44] },
  stone: { dark: '#4a5058', mid: '#767e88', light: '#a8b2bd', accent: '#333940', accent2: '#c9d3dd', debris: [118, 126, 136] },
  gate: { dark: '#2a2140', mid: '#4b3d70', light: '#7a63ad', accent: '#c9a227', accent2: '#ffe9a8', debris: [75, 61, 112] },
  archer: { dark: '#4d3a20', mid: '#8a6a3a', light: '#c2995a', accent: '#2f7d5a', accent2: '#7ef0bb', debris: [138, 106, 58] },
  cannon: { dark: '#2f3338', mid: '#565c64', light: '#868e98', accent: '#d0761f', accent2: '#ffcf7a', debris: [86, 92, 100] },
  mortar: { dark: '#3a3a44', mid: '#5f5f6e', light: '#8d8da0', accent: '#c0453a', accent2: '#ff9a7a', debris: [95, 95, 110] },
  tesla: { dark: '#1e2c44', mid: '#33507a', light: '#5680bd', accent: '#57e2ff', accent2: '#ccf7ff', debris: [51, 80, 122] },
  frost: { dark: '#1f3a48', mid: '#356577', light: '#5d9db4', accent: '#8ef0ff', accent2: '#e6fdff', debris: [53, 101, 119] },
  spikes: { dark: '#3d3a35', mid: '#6d6862', light: '#a5a099', accent: '#8a6a3a', accent2: '#e8e2d6', debris: [109, 104, 98] },
  bombard: { dark: '#33302c', mid: '#5c564e', light: '#8c8478', accent: '#c98a2a', accent2: '#ffd98a', debris: [92, 86, 78] },
  repair: { dark: '#204035', mid: '#356b52', light: '#57a37c', accent: '#ffe08a', accent2: '#fff6d6', debris: [53, 107, 82] },
  sawmill: { dark: '#59401f', mid: '#8d6a34', light: '#bf9553', accent: '#9fd45a', accent2: '#e2ffb0', debris: [141, 106, 52] },
  quarry: { dark: '#403f47', mid: '#6a6875', light: '#9a97a8', accent: '#d3b06a', accent2: '#ffeab8', debris: [106, 104, 117] },
  mint: { dark: '#4b3a15', mid: '#836424', light: '#b9903c', accent: '#ffd93c', accent2: '#fff3b0', debris: [131, 100, 36] },

  // ── Enemies ──────────────────────────────────────────────────────────────
  grunt: { dark: '#4a1f22', mid: '#8d3238', light: '#c04b52', accent: '#2a1012', accent2: '#ffcf6b', debris: [141, 50, 56] },
  runner: { dark: '#4a3a12', mid: '#8f7020', light: '#c39c33', accent: '#231b08', accent2: '#ffe08a', debris: [143, 112, 32] },
  slinger: { dark: '#20402f', mid: '#376b4f', light: '#529b74', accent: '#12241a', accent2: '#b8f0d0', debris: [55, 107, 79] },
  brute: { dark: '#3a1f4a', mid: '#63348d', light: '#8d52c0', accent: '#1c0f24', accent2: '#e0b8ff', debris: [99, 52, 141] },
  bomber: { dark: '#4a2a10', mid: '#8d4f1c', light: '#c4762e', accent: '#ff5a2a', accent2: '#ffd0a0', debris: [141, 79, 28] },
  bat: { dark: '#241f3a', mid: '#3f376b', light: '#61549b', accent: '#ff5ad0', accent2: '#ffc0ef', debris: [63, 55, 107] },
  bulwark: { dark: '#1f303f', mid: '#37536b', light: '#527c9b', accent: '#c9a227', accent2: '#ffe9a8', debris: [55, 83, 107] },
  golem: { dark: '#2a2620', mid: '#514838', light: '#7d7055', accent: '#ff7a1f', accent2: '#ffd08a', debris: [81, 72, 56] },
  wyvern: { dark: '#2d1a3a', mid: '#57306e', light: '#8a4fa8', accent: '#ff9a3c', accent2: '#ffe0b0', debris: [87, 48, 110] },
  bombardier: { dark: '#3a3020', mid: '#6a5936', light: '#9b8552', accent: '#4a5560', accent2: '#cfd8e2', debris: [106, 89, 54] },
  firebug: { dark: '#3d1a12', mid: '#7a3418', light: '#b45a24', accent: '#ff8a2a', accent2: '#ffe0a0', debris: [122, 52, 24] },
  eel: { dark: '#123040', mid: '#1f5a68', light: '#2f8a94', accent: '#7ef0d0', accent2: '#d8fff4', debris: [31, 90, 104] },
  // Slate, so the fin cutting the surface reads as iron-grey against the water
  // rather than as another green eel.
  shark: { dark: '#1b2c3a', mid: '#3f5c74', light: '#6d8ba6', accent: '#c9d8e4', accent2: '#eef4f8', debris: [63, 92, 116] },
  kraken: { dark: '#1a1030', mid: '#332055', light: '#553a85', accent: '#b06bff', accent2: '#e8d0ff', debris: [51, 32, 85] },
  seadrake: { dark: '#12332f', mid: '#2f7f74', light: '#57b0a2', accent: '#c9503a', accent2: '#ffd76a', debris: [47, 127, 116] },

  // ── Siege engines ────────────────────────────────────────────────────────
  // Timber-and-iron tones, deliberately close to one another: engines should
  // read as one category of threat that the player answers the same way.
  ram: { dark: '#3a2614', mid: '#6b4522', light: '#9c6a38', accent: '#8a8f96', accent2: '#d6dae0', debris: [107, 69, 34] },
  // Cold, hard iron rather than timber — the palette itself says "arrows will
  // not do anything here" before the player has read a single tooltip.
  ironRam: { dark: '#22262c', mid: '#454c56', light: '#727c8a', accent: '#b9c2cd', accent2: '#eef2f7', debris: [69, 76, 86] },
  ballista: { dark: '#3d2c18', mid: '#705027', light: '#a37a42', accent: '#b8bcc4', accent2: '#eef1f5', debris: [112, 80, 39] },
  catapult: { dark: '#382412', mid: '#68431f', light: '#9a6733', accent: '#c07a2a', accent2: '#ffd08a', debris: [104, 67, 31] },
  siegeTower: { dark: '#33291a', mid: '#5e4a2c', light: '#8c7044', accent: '#9a3a2e', accent2: '#e8a08a', debris: [94, 74, 44] },
  trebuchet: { dark: '#2e2314', mid: '#574024', light: '#856439', accent: '#6a8fbf', accent2: '#cfe2ff', debris: [87, 64, 36] },

  // ── Allies ───────────────────────────────────────────────────────────────
  // Deliberately the brightest, coolest palette on the field: a friendly unit
  // must never be mistaken for something you are supposed to shoot.
  cavalry: { dark: '#123a5e', mid: '#1f6aa8', light: '#42a3e0', accent: '#ffd93c', accent2: '#fff3b0', debris: [31, 106, 168] },

  // ── Projectiles / effects ────────────────────────────────────────────────
  bolt: { dark: '#5b4326', mid: '#a07a45', light: '#e0c089', accent: '#ffffff', accent2: '#ffe9b0', debris: [224, 192, 137] },
  ball: { dark: '#14161a', mid: '#2c3138', light: '#565c66', accent: '#ffb03a', accent2: '#fff0c0', debris: [44, 49, 56] },
  fire: { dark: '#7a2200', mid: '#e05a10', light: '#ffb43a', accent: '#fff3c0', accent2: '#ffffff', debris: [224, 90, 16] },
  smoke: { dark: '#2b2b2f', mid: '#55555c', light: '#8a8a94', accent: '#b8b8c2', accent2: '#d8d8e0', debris: [85, 85, 92] },
  spark: { dark: '#a05a00', mid: '#ffb03a', light: '#fff0c0', accent: '#ffffff', accent2: '#ffffff', debris: [255, 176, 58] },
  coin: { dark: '#8a6410', mid: '#e0a81c', light: '#ffe066', accent: '#fff8d0', accent2: '#ffffff', debris: [224, 168, 28] },
  blood: { dark: '#3a0a0e', mid: '#7a1620', light: '#b02a36', accent: '#d8505c', accent2: '#ff8a94', debris: [122, 22, 32] }
}

export const paletteFor = (key: string): Palette => PALETTES[key] ?? PALETTES.wood!

// ─── Palette lookup ─────────────────────────────────────────────────────────
//
// A single flat lookup. There is deliberately no re-skinning layer: cosmetic
// block themes were removed because they fought the one thing the renderer has
// to guarantee — that a player can tell a cannon from a crate at a glance while
// forty enemies are on screen. Palette identity IS the readability.

/** Palette for a drawable. */
export const themedPalette = (key: string): Palette => paletteFor(key)

// ─── Drop-in bitmap overrides ───────────────────────────────────────────────
//
// Probing is lazy and one-shot per id: the first `spriteFor()` call kicks off an
// `Image` load; until (and unless) it decodes, the renderer's procedural path
// runs. A 404 marks the id as "procedural forever" so we never re-request it.

type ProbeState = 'idle' | 'loading' | 'ready' | 'missing'

interface Probe {
  state: ProbeState
  img: HTMLImageElement | null
}

const probes = new Map<string, Probe>()

/** Folder layout the art pipeline should target. */
export const ART_FOLDERS = {
  block: 'images/blocks',
  enemy: 'images/enemies',
  prop: 'images/props',
  bg: 'images/bg'
} as const

export type ArtKind = keyof typeof ART_FOLDERS

/**
 * Return a decoded override bitmap for `(kind, id)` or null when none exists.
 * Never throws, never blocks — a missing file simply means "keep drawing it".
 */
export const spriteFor = (kind: ArtKind, id: string): HTMLImageElement | null => {
  const cacheKey = `${kind}/${id}`
  let probe = probes.get(cacheKey)

  if (!probe) {
    probe = { state: 'loading', img: null }
    probes.set(cacheKey, probe)
    const img = new Image()
    img.decoding = 'async'
    img.addEventListener('load', () => {
      // A zero-size decode is as good as missing.
      if (img.naturalWidth > 0) { probe!.state = 'ready'; probe!.img = img }
      else probe!.state = 'missing'
    }, { once: true })
    img.addEventListener('error', () => { probe!.state = 'missing' }, { once: true })
    img.src = prependBaseUrl(`${ART_FOLDERS[kind]}/${id}.webp`)
  }

  return probe.state === 'ready' ? probe.img : null
}

/** Kick off override probing for everything the scene might draw, on an idle
 *  slot after first paint. Purely opportunistic — nothing waits on it. */
export const warmSpriteProbes = (blockIds: string[], enemyIds: string[]): void => {
  for (const id of blockIds) spriteFor('block', id)
  for (const id of enemyIds) spriteFor('enemy', id)
}

// ─── Colour helpers ─────────────────────────────────────────────────────────

/** Mix two hex colours. `t = 0` → a, `t = 1` → b. */
export const mixHex = (a: string, b: string, t: number): string => {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `rgb(${r},${g},${bl})`
}

/** Hex → `rgba()` with an explicit alpha. */
export const withAlpha = (hex: string, alpha: number): string => {
  const p = parseInt(hex.slice(1), 16)
  return `rgba(${(p >> 16) & 255},${(p >> 8) & 255},${p & 255},${alpha})`
}
