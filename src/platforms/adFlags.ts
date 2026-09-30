// ─── Aethel Fold ad flags (roadmap #9, #17, #19) ────────────────────────────
//
// The jury build ships with no ads at all. The ad placements the roadmap asks
// for (interstitials on page clear / boss clear / crumple, a rewarded Try
// again, a rewarded second heart) exist only behind two build flags, and each
// flag is honoured only on a build whose platform actually has an ad SDK:
//
//   VITE_APP_INTERSTITIALS=true   interstitials (#17)
//   VITE_APP_REWARDED=true        the rewarded Try again (#9) and second chance (#19)
//
// "Has an ad SDK" means `resolveAdProvider` returns a real provider for the
// build: CrazyGames, GameDistribution, Playgama, GamePix, GameMonetize and
// Yandex. Itch.io, Glitch, Wavedash and the plain web / jury build resolve to
// the Noop provider, so the flags are forced off there even if an `.env` sets
// them by mistake.
//
// The constants below compare `import.meta.env.*` literals at module top
// level, which Vite replaces with string literals, so on a build without ads
// they fold to `false` and every `if (REWARDED_ADS)` / `INTERSTITIAL_ADS ?`
// arm (and the lazily imported ad UI behind it) is dead code.

/** The env keys of the platforms whose builds carry an ad SDK. */
export const AD_PLATFORM_ENV_KEYS = [
  'VITE_APP_CRAZY_WEB',
  'VITE_APP_GAME_DISTRIBUTION',
  'VITE_APP_PLAYGAMA',
  'VITE_APP_GAMEPIX',
  'VITE_APP_GAME_MONETIZE',
  'VITE_APP_YANDEX'
] as const

export interface AdFlags {
  /** The build targets a platform with an ad SDK. */
  adPlatform: boolean
  /** Rewarded placements: the Almost! Try again (#9) and the second chance (#19). */
  rewarded: boolean
  /** Interstitials on page clear, boss clear and crumple (#17). */
  interstitials: boolean
}

/** Pure form of the build constants below, for an env map (tests, tooling). */
export const resolveAdFlags = (env: Readonly<Record<string, string | undefined>>): AdFlags => {
  const adPlatform = AD_PLATFORM_ENV_KEYS.some((k) => env[k] === 'true')
  return {
    adPlatform,
    rewarded: adPlatform && env.VITE_APP_REWARDED === 'true',
    interstitials: adPlatform && env.VITE_APP_INTERSTITIALS === 'true'
  }
}

const IS_AD_PLATFORM_BUILD =
  import.meta.env.VITE_APP_CRAZY_WEB === 'true' ||
  import.meta.env.VITE_APP_GAME_DISTRIBUTION === 'true' ||
  import.meta.env.VITE_APP_PLAYGAMA === 'true' ||
  import.meta.env.VITE_APP_GAMEPIX === 'true' ||
  import.meta.env.VITE_APP_GAME_MONETIZE === 'true' ||
  import.meta.env.VITE_APP_YANDEX === 'true'

/** Build constant: rewarded placements are compiled in (an ad platform with `VITE_APP_REWARDED`). */
export const REWARDED_ADS: boolean = IS_AD_PLATFORM_BUILD && import.meta.env.VITE_APP_REWARDED === 'true'
/** Build constant: interstitials are compiled in (an ad platform with `VITE_APP_INTERSTITIALS`). */
export const INTERSTITIAL_ADS: boolean = IS_AD_PLATFORM_BUILD && import.meta.env.VITE_APP_INTERSTITIALS === 'true'
/** Either placement: the playtime clock the grace period reads only runs then. */
export const ANY_FOLD_ADS: boolean = REWARDED_ADS || INTERSTITIAL_ADS
