// ─── CSP generator ──────────────────────────────────────────────────────────
//
// Pure function. Takes the loaded env (as `loadEnv()` returns from Vite)
// and produces the Content-Security-Policy string the build-time meta tag
// uses. Lifted out of `vite.config.ts` so per-platform CSP shape can be
// unit-tested without spinning up Vite.
//
// Adding a new platform:
//   1. If it has its own host whitelist, add an entry under `PLATFORM_HOSTS`.
//   2. If it needs script-src `'unsafe-inline'` / `'unsafe-eval'` / `https:`,
//      check `env.VITE_APP_<PLATFORM>` and push into `scriptSrcExtra`.
//   3. If its bidder waterfall pulls in a long tail of partner CDNs, mirror
//      the GameDistribution pattern (open the relevant directives to `https:`).
//   4. Otherwise no change to this file is needed — `'self'` + the BASE_HOSTS
//      cover the rest.

/** Hosts allowed across every build mode (the platform stays itself when
 *  loaded standalone, and the SDK from each portal can reach its API).
 *  Keep this list short — add platform-specific hosts to PLATFORM_HOSTS. */
const BASE_HOSTS: ReadonlyArray<string> = [
  'https://*.crazygames.com',
  'https://sdk.crazygames.com',
  'https://wavedash.com',
  'https://*.wavedash.com',
  'https://itch.io',
  'https://*.itch.io',
  'https://glitch.fun',
  'https://*.glitch.fun',
  'https://gamedistribution.com',
  'https://*.gamedistribution.com',
  'https://playgama.com',
  'https://*.playgama.com',
  'https://bridge.playgama.com',
  'https://gamepix.com',
  'https://*.gamepix.com',
  'https://integration.gamepix.com',
  'https://gamemonetize.com',
  'https://*.gamemonetize.com',
  'https://api.gamemonetize.com',
  'https://html5.gamemonetize.com',
  // Yandex Games — telemetry / ads beacon through *.yandex.ru / .com / .net,
  // and the iframe wrapper itself is on yandex.com/games (yandex.ru/games /
  // .com.tr for regional TLDs). The SDK is loaded via the RELATIVE `/sdk.js`
  // path which Yandex's wrapper auto-routes to their backing CDN — we MUST NOT
  // list explicit `*.s3.yandex.*` hosts here. Yandex's moderation scanner
  // greps the submitted bundle for hardcoded S3 URLs and rejects the draft
  // with "Service storage URL detected" if it finds any. The wildcard
  // `https://*.yandex.net` already covers multi-level subdomains like
  // `sdk.games.s3.yandex.net` at request time, so connectivity isn't impacted.
  'https://yandex.ru',
  'https://*.yandex.ru',
  'https://yandex.com',
  'https://*.yandex.com',
  'https://yandex.net',
  'https://*.yandex.net',
  'https://an.yandex.ru',
  'https://www.clarity.ms',
  'https://api.jsonbin.io'
]

/** GameDistribution-specific partner ad-tech / analytics CDNs. The GD SDK
 *  loads these at runtime; only ship the long whitelist on GD builds so the
 *  other platforms keep tight CSPs. */
const GD_PARTNER_HOSTS: ReadonlyArray<string> = [
  'https://*.gamemonkey.org',
  'https://*.improvedigital.com',
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
  'https://imasdk.googleapis.com',
  'https://*.2mdn.net',
  'https://*.googlesyndication.com',
  'https://*.doubleclick.net',
  'https://*.googletagservices.com',
  'https://*.googletagmanager.com',
  'https://*.google-analytics.com',
  'https://*.googleadservices.com',
  'https://www.google.com',
  'https://www.gstatic.com',
  'https://fundingchoicesmessages.google.com',
  'https://*.adnxs.com',
  'https://*.adsafeprotected.com',
  'https://*.adform.net',
  'https://*.amazon-adsystem.com',
  'https://*.casalemedia.com',
  'https://*.criteo.com',
  'https://*.criteo.net',
  'https://*.openx.net',
  'https://*.pubmatic.com',
  'https://*.rubiconproject.com'
]

/** CrazyGames ad-stack hosts. The portal's `rafvertizing.js` (loaded from
 *  `*.crazygames.com`, already in BASE_HOSTS) injects Google Publisher Tag
 *  + a header-bidding waterfall into our iframe. Without these hosts the
 *  CG QA dev console fills with `Refused to connect / load script`
 *  violations. The list is grown empirically — when CG QA reports a new
 *  blocked URL, add the host (or a wildcard) here.
 *
 *  History:
 *    • 2026-05-04: initial — Google ad stack + common header bidders.
 *    • 2026-05-04 (later): added `*.creativecdn.com` (RTB House),
 *      `*.crwdcntrl.net` (Lotame DMP), `*.openxcdn.net` (OpenX CDN —
 *      separate from `*.openx.net`). All three surfaced after GPT
 *      itself was unblocked and started loading downstream partner
 *      tags. */
const CG_PARTNER_HOSTS: ReadonlyArray<string> = [
  'https://securepubads.g.doubleclick.net',
  'https://*.doubleclick.net',
  'https://*.googletagservices.com',
  'https://*.googletagmanager.com',
  'https://*.googlesyndication.com',
  'https://*.googleadservices.com',
  'https://*.google-analytics.com',
  'https://*.2mdn.net',
  'https://imasdk.googleapis.com',
  'https://www.google.com',
  'https://www.gstatic.com',
  'https://*.adsrvr.org',
  'https://*.amazon-adsystem.com',
  'https://api.rlcdn.com',
  'https://*.adnxs.com',
  'https://*.adsafeprotected.com',
  'https://*.adform.net',
  'https://*.casalemedia.com',
  'https://*.creativecdn.com',
  'https://*.criteo.com',
  'https://*.criteo.net',
  'https://*.crwdcntrl.net',
  'https://*.openx.net',
  'https://*.openxcdn.net',
  'https://*.pubmatic.com',
  'https://*.rubiconproject.com'
]

/** Yandex Direct / AdFox / Yandex Ad Exchange hosts. Lifted verbatim from
 *  Yandex's official ad-platform CSP example (yandex.com/support/partner/
 *  en/web/adplatform/csp-configuration). The first four are SEPARATE root
 *  domains from yandex.{ru,com,net} (already in BASE_HOSTS), so the existing
 *  yandex.* wildcards do NOT cover them. Without these hosts the rewarded /
 *  fullscreen ad chain breaks at the IMA-equivalent layer with no SDK error
 *  surfaced — the ad slot just stays empty.
 *  - yastatic.net           : static assets (creative templates, fonts, JS)
 *  - *.adfox.ru             : adfox ad server
 *  - *.yandexadexchange.net : Yandex's RTB ad exchange + nested ad frames
 *  - yandexadexchange.net   : root, hit directly by frame-src
 *  - verify.yandex.ru is already covered by `*.yandex.ru` in BASE_HOSTS. */
const YANDEX_PARTNER_HOSTS: ReadonlyArray<string> = [
  'https://yastatic.net',
  'https://*.adfox.ru',
  'https://yandexadexchange.net',
  'https://*.yandexadexchange.net'
]

/**
 * Poki: the SDK v2 script (game-cdn.poki.com) and its ad / telemetry / CDN
 * origins. Poki mediates ads through IMA and partner bidders, so the build is
 * also an ad-waterfall build below (open `https:` on the ad directives).
 */
const POKI_PARTNER_HOSTS: ReadonlyArray<string> = [
  'https://game-cdn.poki.com',
  'https://*.poki.com',
  'https://*.poki.io',
  'https://*.poki-gdn.com',
  'https://imasdk.googleapis.com',
  'https://*.doubleclick.net',
  'https://*.googlesyndication.com'
]

const CONNECT_BASE_EXTRA: ReadonlyArray<string> = [
  'https://*.sentry.io',
  'wss://*.wavedash.com',
  'wss://0.peerjs.com',
  'https://0.peerjs.com',
  'https://getpantry.cloud',
  'https://*.getpantry.cloud'
]

const CSP_DIRECTIVES = [
  'default-src', 'script-src', 'style-src', 'img-src',
  'connect-src', 'frame-src', 'media-src', 'font-src'
] as const

/**
 * Build the full CSP string for the given build env. Mirrors what
 * vite.config.ts used to do inline; intended to be called from there at
 * `transformIndexHtml` time.
 */
export const buildCsp = (env: Record<string, string>): string => {
  const isGameDistribution = env.VITE_APP_GAME_DISTRIBUTION === 'true'
  const isGlitch = env.VITE_APP_GLITCH === 'true'
  const isCrazyWeb = env.VITE_APP_CRAZY_WEB === 'true'
  const isPlaygama = env.VITE_APP_PLAYGAMA === 'true'
  const isGamepix = env.VITE_APP_GAMEPIX === 'true'
  const isGameMonetize = env.VITE_APP_GAME_MONETIZE === 'true'
  const isYandex = env.VITE_APP_YANDEX === 'true'
  const isPoki = env.VITE_APP_POKI === 'true'

  // Playgama / GamePix / GameMonetize / Yandex run an ad-waterfall like GD —
  // open the same directives so partner creatives / bidders (the Google-IMA
  // bidder chain on most, Yandex Direct on Yandex) aren't refused.
  const adWaterfallBuild = isGameDistribution || isPlaygama || isGamepix || isGameMonetize || isYandex || isPoki

  // Yandex's moderator rejects any third-party "service storage" URL it finds
  // anywhere in the bundle — including the CSP meta tag. `BASE_HOSTS` contains
  // a number of legacy storage-service entries (api.jsonbin.io, getpantry.cloud,
  // peerjs, ...) that other portals' integrations once whitelisted but that no
  // runtime code on this project actually uses. We can't safely delete them
  // from BASE_HOSTS without auditing every other platform, so on Yandex builds
  // we substitute a MINIMAL host list of just Yandex-related origins. Other
  // builds keep the legacy whitelist untouched.
  const hosts: string[] = isYandex
    ? [
      'https://yandex.ru',
      'https://*.yandex.ru',
      'https://yandex.com',
      'https://*.yandex.com',
      'https://yandex.net',
      'https://*.yandex.net',
      'https://an.yandex.ru',
      ...YANDEX_PARTNER_HOSTS
    ]
    : isPoki
      // Poki: only Poki's own and its ad partners' origins — no other portal's
      // hostnames anywhere in the bundle (the legacy BASE_HOSTS list names them all).
      ? [...POKI_PARTNER_HOSTS]
      : [
        ...BASE_HOSTS,
        ...(isGameDistribution ? GD_PARTNER_HOSTS : []),
        ...(isCrazyWeb ? CG_PARTNER_HOSTS : [])
      ]

  /**
   * The leaderboard Worker, derived from the build's own env rather than
   * hard-coded, so pointing a build at a different endpoint updates the policy
   * with it and there is no way to ship a URL the CSP then refuses.
   *
   * Skipped on Yandex: their moderator flags third-party storage endpoints, and
   * the minimal host list above exists precisely to keep them out. A Yandex
   * build simply has no board (`VITE_LEADERBOARD_URL` unset there), and the
   * client treats that as "feature off".
   */
  const leaderboardHost = ((): string[] => {
    if (isYandex) return []
    const raw = env.VITE_LEADERBOARD_URL ?? ''
    if (!raw) return []
    try {
      return [new URL(raw).origin]
    } catch {
      return []
    }
  })()

  // Per-directive extras — mode-driven openings beyond `'self'` + hosts.
  const scriptSrcExtra: string[] = []
  if (isGlitch) scriptSrcExtra.push('\'unsafe-inline\'')
  if (adWaterfallBuild) scriptSrcExtra.push('https:', '\'unsafe-inline\'', '\'unsafe-eval\'')

  const extras: Record<string, string[]> = {
    'script-src': scriptSrcExtra,
    // GD's IAB TCF v2 consent wall pulls Google Fonts CSS at runtime —
    // open style-src to https: for GD only. Playgama's bridge mediates
    // creatives the same way.
    'style-src': adWaterfallBuild ? ['https:', '\'unsafe-inline\''] : ['\'unsafe-inline\''],
    // GD ad creatives come from arbitrary CDNs — open img-src to https:
    // for that build type only. CG ad pixels arrive from the partner host
    // list above plus `data:` for inline beacons.
    'img-src': adWaterfallBuild ? ['data:', 'https:', 'blob:'] : ['data:'],
    'connect-src': [
      // CONNECT_BASE_EXTRA includes getpantry.cloud / peerjs / sentry — all
      // third-party services. Yandex's moderator flags every "service storage"
      // URL it finds, so omit the extras entirely on Yandex builds (the
      // open `https:` / `wss:` added below for ad-waterfall builds still
      // covers what's actually needed at runtime).
      ...(isYandex || isPoki ? [] : CONNECT_BASE_EXTRA),
      // GD / Playgama partner analytics / ad telemetry beacons.
      ...(adWaterfallBuild ? ['https:', 'wss:'] : []),
      ...leaderboardHost
    ],
    // GD / Playgama ads + CG rich-media creatives render in nested iframes
    // from partner domains; CG specifically pulls TheTradeDesk/2mdn
    // creatives into nested frames.
    'frame-src': adWaterfallBuild || isCrazyWeb ? ['https:'] : [],
    // CG / Playgama video ads (IMA / partner stitchers) render via blob URLs.
    'media-src': adWaterfallBuild || isCrazyWeb ? ['https:', 'blob:'] : [],
    // The consent wall + many partner CDNs serve webfonts.
    'font-src': adWaterfallBuild ? ['https:', 'data:'] : ['data:']
  }

  return CSP_DIRECTIVES.map(dir => {
    const directiveExtras = extras[dir] ?? []
    return `${dir} 'self' ${hosts.join(' ')} ${directiveExtras.join(' ')}`.trim()
  }).join('; ')
}
