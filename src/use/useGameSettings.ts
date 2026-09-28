import { ref, watch } from 'vue'
import type { GrassDetailSetting } from '@/world/grass/config'

/**
 * ─── Player-facing settings ─────────────────────────────────────────────────
 *
 * The graphics and audio the player chose, held in one place and persisted.
 *
 * ── Why this is not `World.settings` ────────────────────────────────────────
 *
 * `World` already has a `settings` object, and it is a *different thing*: it is
 * the live state of the renderer, it contains developer A/B switches nobody
 * should ship a UI for (`frustumCullInstances`, `hierarchical`, `occlusion`),
 * and — the part that matters — **it does not survive the world being
 * rebuilt**. Walking from `/story` to `/characters` and back constructs a new
 * `World`, and every choice the player made would be gone.
 *
 * So the player's choices live here, outlive any `World`, and are *pushed into*
 * whichever world is currently mounted by `applyTo`. The renderer stays the
 * authority on what is possible; this stays the authority on what was asked
 * for.
 *
 * ── Why `fpsMonitor` is a setting and not a dev flag ────────────────────────
 *
 * The perf panel is a dev surface and self-gates behind a code word. The little
 * FPS readout is not the same thing: players on the low end genuinely want to
 * see whether the stutter they feel is real, and asking them to type a code
 * word is not an answer. It defaults **off**, because a permanent number in the
 * corner of a story game is chrome competing with the scene.
 */

export interface GameSettings {
  // ── Graphics ──────────────────────────────────────────────────────────────
  grassDetail: GrassDetailSetting
  /** 0.6–1.0. Below 1 renders smaller and upscales — the cheapest real lever. */
  renderScale: number
  shadows: boolean
  outlines: boolean
  wind: boolean
  /** Let the engine drive quality from measured GPU time. */
  adaptiveQuality: boolean
  /** The small frames-per-second readout. Not the developer perf panel. */
  fpsMonitor: boolean
  // ── Audio ─────────────────────────────────────────────────────────────────
  /** 0–1. Multiplies all three of the ones below. */
  masterVolume: number
  musicVolume: number
  effectsVolume: number
  /**
   * Spoken dialogue — the chapter's voice-over (`world/story/speech.ts`).
   *
   * Its own slider rather than a share of `effectsVolume`, because it is the one
   * channel a player turns down for a reason that has nothing to do with volume:
   * they would rather read the German than hear a placeholder read it to them.
   * Folding that into effects would cost them the boar as well.
   *
   * Defaults to **1** while music and effects sit below it. Dialogue is the
   * content in a story chapter, not a layer over it, and a line the player
   * cannot hear over the wind is a line they did not get.
   */
  voiceVolume: number
  muted: boolean
}

export const DEFAULT_SETTINGS: GameSettings = {
  grassDetail: 'auto',
  renderScale: 1,
  shadows: true,
  outlines: true,
  wind: true,
  adaptiveQuality: true,
  fpsMonitor: false,
  masterVolume: 0.8,
  musicVolume: 0.6,
  effectsVolume: 0.9,
  voiceVolume: 1,
  muted: false
}

export const SETTINGS_KEY = 'world.settings.v1'

const GRASS_LEVELS: readonly GrassDetailSetting[] = ['auto', 'ultra', 'high', 'medium', 'low', 'minimum', 'off']

const clamp = (value: unknown, low: number, high: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

/**
 * Repairs a stored blob, totally.
 *
 * Every branch produces usable settings rather than throwing — the same rule
 * `characters/appearance.ts::sanitiseAppearance` is written to, and for the same
 * reason: a settings screen that will not open because of a key from an older
 * build is a far worse failure than a player finding one slider back at its
 * default.
 */
export const sanitiseSettings = (raw: unknown): GameSettings => {
  const out = { ...DEFAULT_SETTINGS }
  if (!raw || typeof raw !== 'object') {
    return out
  }
  const data = raw as Record<string, unknown>
  if (typeof data.grassDetail === 'string' && (GRASS_LEVELS as string[]).includes(data.grassDetail)) {
    out.grassDetail = data.grassDetail as GrassDetailSetting
  }
  out.renderScale = clamp(data.renderScale, 0.6, 1, DEFAULT_SETTINGS.renderScale)
  out.shadows = bool(data.shadows, DEFAULT_SETTINGS.shadows)
  out.outlines = bool(data.outlines, DEFAULT_SETTINGS.outlines)
  out.wind = bool(data.wind, DEFAULT_SETTINGS.wind)
  out.adaptiveQuality = bool(data.adaptiveQuality, DEFAULT_SETTINGS.adaptiveQuality)
  out.fpsMonitor = bool(data.fpsMonitor, DEFAULT_SETTINGS.fpsMonitor)
  out.masterVolume = clamp(data.masterVolume, 0, 1, DEFAULT_SETTINGS.masterVolume)
  out.musicVolume = clamp(data.musicVolume, 0, 1, DEFAULT_SETTINGS.musicVolume)
  out.effectsVolume = clamp(data.effectsVolume, 0, 1, DEFAULT_SETTINGS.effectsVolume)
  out.voiceVolume = clamp(data.voiceVolume, 0, 1, DEFAULT_SETTINGS.voiceVolume)
  out.muted = bool(data.muted, DEFAULT_SETTINGS.muted)
  return out
}

const load = (): GameSettings => {
  // `localStorage` throws outright in a sandboxed iframe — see
  // `useKeybindings.ts` and `editor/toggle.ts`, which guard the same way.
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SETTINGS_KEY)
    return sanitiseSettings(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export const settings = ref<GameSettings>(load())

watch(
  settings,
  value => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(value))
      }
    } catch {
      // Session-only. See the note in `useKeybindings.ts::persist`.
    }
  },
  { deep: true }
)

/**
 * Adopts the grass level from the key the old floating panel used.
 *
 * `world.grassDetail` was `WorldSettingsPanel`'s private storage before a
 * settings screen existed. A player who had turned grass down would otherwise
 * open the new screen and find it back on `auto`, so it is read once, adopted if
 * the new setting is still untouched, and deleted.
 *
 * ── Why it lives here and not in the panel that wrote it ────────────────────
 *
 * Because it used to run on that panel's `onMounted`, and the panel is no longer
 * mounted on `/story` — its controls moved into the pause screen's graphics
 * menu. A player who only ever opens the chapter would have silently lost the
 * setting. Module scope runs on every route exactly once, which is what a
 * one-time migration actually wants.
 */
const LEGACY_GRASS_KEY = 'world.grassDetail'

const migrateLegacyGrass = (): void => {
  // Guarded because `localStorage` throws outright in a sandboxed iframe, which
  // is how several of the portals this ships to serve games.
  try {
    if (typeof localStorage === 'undefined') {
      return
    }
    const stored = localStorage.getItem(LEGACY_GRASS_KEY)
    if (!stored) {
      return
    }
    localStorage.removeItem(LEGACY_GRASS_KEY)
    // Only adopt it if the new setting is still at its default: a player who has
    // already used the settings screen has said something more recent than this.
    if (settings.value.grassDetail === 'auto' && (GRASS_LEVELS as readonly string[]).includes(stored)) {
      setSetting('grassDetail', stored as GrassDetailSetting)
    }
  } catch {
    // Nothing to do. The player keeps the default rather than their old choice.
  }
}

export const setSetting = <K extends keyof GameSettings>(key: K, value: GameSettings[K]): void => {
  settings.value = { ...settings.value, [key]: value }
}

// Run *after* `setSetting` is initialised. `const` arrow functions are in the
// temporal dead zone until their declaration is evaluated, so calling this any
// earlier in the module throws a ReferenceError at import time — which
// typecheck does not catch and which takes the whole app down on boot.
migrateLegacyGrass()

export const resetSettings = (): void => {
  settings.value = { ...DEFAULT_SETTINGS }
}

/**
 * What the renderer is actually told.
 *
 * Structural rather than importing `World`, so this file stays free of three.js
 * and can be unit-tested without a canvas — the same seam `combat/` and
 * `story/` are built on.
 */
export interface SettingsTarget {
  applySettings(partial: {
    grassDetail?: GrassDetailSetting
    renderScale?: number
    shadows?: boolean
    outlines?: boolean
    wind?: boolean
    adaptiveQuality?: boolean
  }): void
}

/**
 * Pushes the player's choices into a world.
 *
 * Called once when a world mounts and again on every change. Deliberately
 * pushes **all six** every time rather than diffing: `World.applySettings`
 * already early-outs on an unchanged value, so a diff here would be a second
 * copy of a comparison that exists downstream, and the failure mode of getting
 * that copy wrong is a setting that silently stops applying.
 */
export const applySettingsTo = (target: SettingsTarget): void => {
  const value = settings.value
  target.applySettings({
    grassDetail: value.grassDetail,
    renderScale: value.renderScale,
    shadows: value.shadows,
    outlines: value.outlines,
    wind: value.wind,
    adaptiveQuality: value.adaptiveQuality
  })
}
