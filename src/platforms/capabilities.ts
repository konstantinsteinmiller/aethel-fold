// ─── Platform capability resolver ───────────────────────────────────────────
//
// Pure function. Takes the build-time platform flags + the runtime hostname
// + Glitch's license-status ref and returns every capability gate App.vue
// previously inlined as a `computed`. The extraction collapses the nested
// `(isCrazyWeb && isCrazyGamesUrl()) || isNotPlatformBuild` patterns into
// a single source of truth — adding a new platform now means adding ONE
// arm here, not editing five computeds in App.vue.
//
// All functions are pure: they take the inputs they need explicitly, no
// module-level state, no Vue, no `window` reads. Vue components wrap the
// call in `computed()` so reactivity flows correctly.

export interface PlatformFlags {
  isCrazyWeb: boolean
  isWaveDash: boolean
  isItch: boolean
  isGlitch: boolean
  isGameDistribution: boolean
  isPlaygama: boolean
  isGamepix: boolean
  isGameMonetize: boolean
  isYandex: boolean
  /** Optional so older call sites and tests that predate Poki still type-check. */
  isPoki?: boolean
}

export type GlitchLicenseStatus = 'pending' | 'ok' | 'denied'

export interface CapabilitiesInput {
  flags: PlatformFlags
  hostname: string
  /**
   * Origin of the parent frame, when the game is embedded in an iframe.
   * Caller fills this with `window.location.ancestorOrigins?.[0] ?? document.referrer`.
   * Empty string when not iframed. Required so the Glitch detection can match
   * "embedded on glitch.fun via a CDN iframe" (where `hostname` is the CDN's,
   * not glitch.fun's). Optional in the input for backwards-compatibility with
   * non-iframe contexts; defaults to '' when omitted.
   */
  parentOrigin?: string
  glitchLicenseStatus: GlitchLicenseStatus
}

export interface ResolvedCapabilities {
  /** True when no platform flag is set — plain web / dev / `pnpm dev`. */
  isNotPlatformBuild: boolean
  /** Per-platform "render the game" gates: flag + matching hostname,
   *  OR the dev escape hatch (isNotPlatformBuild). */
  allowedToShowOnCrazyGames: boolean
  allowedToShowOnWaveDash: boolean
  allowedToShowOnItch: boolean
  allowedToShowOnGlitch: boolean
  allowedToShowOnGameDistribution: boolean
  /** Playgama's Technical Requirements forbid runtime URL gating — so the
   *  arm is flag-only (always render when the build flag is set, no
   *  hostname check). */
  allowedToShowOnPlaygama: boolean
  /** GamePix runs the iframe on gamepix.com (or partner portals embedding
   *  it). Hostname-gated like CrazyGames / GameDistribution. */
  allowedToShowOnGamepix: boolean
  /** Always true on GameMonetize builds — it's an ad distribution network
   *  embedded across many partner domains, so a hostname gate would block
   *  legitimate embeds. Flag-only, like Playgama. */
  allowedToShowOnGameMonetize: boolean
  /** Always true on Yandex builds — Yandex Games' technical requirements
   *  explicitly forbid URL-based gating ("no technical ways of restricting
   *  gameplay based on the URL"). Flag-only, like Playgama / GameMonetize. */
  allowedToShowOnYandex: boolean
  /** Always true on Poki builds: Poki serves the game from its own CDN domains, flag-only like Playgama. */
  allowedToShowOnPoki: boolean
  /** True when Glitch was selected but their license API rejected the player. */
  isGlitchDenied: boolean
  /** True when the build targets a platform AND the license check has settled.
   *  Used by the "this game is currently only available on …" gate so the
   *  copy doesn't flash up before we know whether Glitch will let us in. */
  showOnlyAvailableText: boolean
}

// NOTE: `plattformText` (the "available on <hostname>" display string) used
// to live here as a `flags.isXxx` ternary, which baked EVERY platform's
// hostname into every bundle as string literals — Rollup can't tree-shake
// runtime-flag branches. Yandex's moderator flags any non-Yandex hostname
// string in the submitted bundle as "Service storage URL detected", so the
// ternary now lives directly in `App.vue` keyed on `import.meta.env.VITE_APP_*`
// literals. Vite folds those at build time, and Rollup eliminates the dead
// arms (and their hostname strings) per build. See `App.vue` for the new
// site of truth.

// ─── Build-time platform constants ──────────────────────────────────────────
// Module-top-level constants. Vite replaces `import.meta.env.VITE_APP_X` with
// the literal env value at parse time, so each `IS_X_BUILD` becomes a concrete
// `true` or `false` at the binding site. Rollup constant-folds top-level
// constants across modules far more aggressively than inline conditions
// inside function bodies (the latter has the obfuscator's stringArray phase
// running before esbuild has a chance to fold mid-function ternaries / IFs).
// Use these constants — not `flags.isXxx` or inline `import.meta.env...===` —
// to gate URL-helper calls so dead branches DCE and their hostname strings
// don't end up in the bundle (the "Service storage URL detected" rejection
// trigger on Yandex moderation).
const IS_CRAZY_BUILD = import.meta.env.VITE_APP_CRAZY_WEB === 'true'
const IS_WAVEDASH_BUILD = import.meta.env.VITE_APP_WAVEDASH === 'true'
const IS_ITCH_BUILD = import.meta.env.VITE_APP_ITCH === 'true'
const IS_GLITCH_BUILD = import.meta.env.VITE_APP_GLITCH === 'true'
const IS_GD_BUILD = import.meta.env.VITE_APP_GAME_DISTRIBUTION === 'true'
const IS_GAMEPIX_BUILD = import.meta.env.VITE_APP_GAMEPIX === 'true'

// ─── Hostname matchers ──────────────────────────────────────────────────────
// Kept separate so each platform's URL detection lives next to the other
// platform-specific code in this file rather than spread across App.vue.

const isCrazyGamesUrl = (hostname: string): boolean =>
  hostname.includes('crazygames')

const isWaveDashUrl = (hostname: string): boolean =>
  hostname.includes('wavedash')

const isItchUrl = (hostname: string): boolean =>
  hostname.includes('itch') || hostname.includes('itch.io') || hostname.includes('itch.zone')

const isGlitchUrl = (hostname: string, parentOrigin: string): boolean => {
  if (hostname.includes('glitch.fun')) return true
  // Glitch hosts the game bundle on a CDN and embeds it in an iframe whose
  // parent is glitch.fun, so the iframe's own hostname won't match. Accept
  // the parent frame's origin as proof of embed.
  return /(^|\/\/)([^/]+\.)?glitch\.fun(\/|$)/.test(parentOrigin || '')
}

const isGameDistUrl = (hostname: string): boolean =>
  hostname.includes('gamedistribution.com')

const isGamepixUrl = (hostname: string): boolean =>
  hostname.includes('gamepix.com')

// ─── Resolver ───────────────────────────────────────────────────────────────

export const resolveCapabilities = (input: CapabilitiesInput): ResolvedCapabilities => {
  const { flags, hostname, glitchLicenseStatus } = input
  const parentOrigin = input.parentOrigin ?? ''

  const isNotPlatformBuild =
    !flags.isCrazyWeb && !flags.isWaveDash && !flags.isItch && !flags.isGlitch && !flags.isGameDistribution && !flags.isPlaygama && !flags.isGamepix && !flags.isGameMonetize && !flags.isYandex && !flags.isPoki

  // Each `allowedToShowOnX` gate is wrapped in an `import.meta.env.VITE_APP_X`
  // env-literal `if`-block (NOT a ternary — empirically esbuild folds
  // if-statement constant conditions but leaves ternaries' false-equality
  // chains alone when the obfuscator runs after). This makes the URL-helper
  // call (and its embedded hostname string like `'crazygames'`, `'wavedash'`,
  // `'glitch.fun'`, ...) reachable ONLY from a build that actually targets
  // that platform; on every other build the `if` body is dead code and the
  // helper tree-shakes if no other build path references it. Yandex's
  // moderator rejects any non-Yandex hostname string in the submitted bundle
  // ("Service storage URL detected"), so this gating is what keeps the
  // Yandex build clean. Same posture as `resolveAdProvider`.
  let allowedToShowOnCrazyGames = isNotPlatformBuild
  if (IS_CRAZY_BUILD) {
    allowedToShowOnCrazyGames = (flags.isCrazyWeb && isCrazyGamesUrl(hostname)) || isNotPlatformBuild
  }

  let allowedToShowOnWaveDash = isNotPlatformBuild
  if (IS_WAVEDASH_BUILD) {
    allowedToShowOnWaveDash = (flags.isWaveDash && isWaveDashUrl(hostname)) || isNotPlatformBuild
  }

  let allowedToShowOnItch = isNotPlatformBuild
  if (IS_ITCH_BUILD) {
    allowedToShowOnItch = (flags.isItch && isItchUrl(hostname)) || isNotPlatformBuild
  }

  let allowedToShowOnGlitch = isNotPlatformBuild
  let isGlitchDenied = false
  if (IS_GLITCH_BUILD) {
    allowedToShowOnGlitch = (flags.isGlitch && isGlitchUrl(hostname, parentOrigin) && glitchLicenseStatus === 'ok') || isNotPlatformBuild
    isGlitchDenied = flags.isGlitch && glitchLicenseStatus === 'denied'
  }

  let allowedToShowOnGameDistribution = isNotPlatformBuild
  if (IS_GD_BUILD) {
    allowedToShowOnGameDistribution = (flags.isGameDistribution && isGameDistUrl(hostname)) || isNotPlatformBuild
  }

  // Playgama's Technical Requirements forbid runtime URL gating — flag-only.
  const allowedToShowOnPlaygama = flags.isPlaygama || isNotPlatformBuild

  let allowedToShowOnGamepix = isNotPlatformBuild
  if (IS_GAMEPIX_BUILD) {
    allowedToShowOnGamepix = (flags.isGamepix && isGamepixUrl(hostname)) || isNotPlatformBuild
  }

  // GameMonetize: NO hostname check (ad distribution network embedded across
  // many partner domains). Flag only, like Playgama.
  const allowedToShowOnGameMonetize = flags.isGameMonetize || isNotPlatformBuild

  // Yandex: NO hostname check — Yandex's technical requirements explicitly
  // forbid runtime URL gating. Flag only, like Playgama / GameMonetize.
  const allowedToShowOnYandex = flags.isYandex || isNotPlatformBuild

  // Poki: no hostname check (its CDN domains vary). Flag only.
  const allowedToShowOnPoki = !!flags.isPoki || isNotPlatformBuild

  const anyPlatform =
    flags.isCrazyWeb || flags.isWaveDash || flags.isItch || flags.isGlitch || flags.isGameDistribution || flags.isPlaygama || flags.isGamepix || flags.isGameMonetize || flags.isYandex || !!flags.isPoki
  const showOnlyAvailableText = anyPlatform && glitchLicenseStatus !== 'pending'

  // `plattformText` moved to App.vue (env-literal ladder) so per-platform
  // hostname strings tree-shake per build. See the comment above the
  // `ResolvedCapabilities` interface for context.

  return {
    isNotPlatformBuild,
    allowedToShowOnCrazyGames,
    allowedToShowOnWaveDash,
    allowedToShowOnItch,
    allowedToShowOnGlitch,
    allowedToShowOnGameDistribution,
    allowedToShowOnPlaygama,
    allowedToShowOnGamepix,
    allowedToShowOnGameMonetize,
    allowedToShowOnYandex,
    allowedToShowOnPoki,
    isGlitchDenied,
    showOnlyAvailableText
  }
}
