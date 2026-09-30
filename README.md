# Aethel Fold

A 3D origami pop-up-book castle siege. A paper army marches across the pages of
a storybook, and you are the hand that folds it: swipe the dotted creases to
raise walls and snap ravines shut, tap to stamp, spread to rip the castle
towers flat. Then the castle unfolds into an origami dragon, and the last fold
turns it into a frog.

Spec: [`aethel-fold-GDD.md`](./aethel-fold-GDD.md) · player-facing blurb and
controls: [`description.md`](./description.md) · what comes next:
[`roadmap.md`](./roadmap.md).

Built with Vue 3 + TypeScript + raw three.js, shipping to CrazyGames, Playgama,
GamePix, GameMonetize, GameDistribution, Poki, Glitch.fun, itch.io, Wavedash
and Yandex Games from one codebase.

---

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:2050 — boots straight into page 1
pnpm test         # unit + integration tests (vitest)
pnpm test:e2e     # Playwright: gameplay, persistence, cloud hydration, responsive
pnpm type-check   # vue-tsc
pnpm build        # type-check + production build
```

`pnpm test:e2e` starts two dev servers: `:2050` for the plain web build and
`:2051` for the CrazyGames build, which runs against a fake SDK. On a machine
short on memory, `E2E_PLAIN_ONLY=1 pnpm test:e2e gameplay persistence
responsive` skips the second server. The first run needs a Chromium; in the
cloud container it is found through `PLAYWRIGHT_BROWSERS_PATH`.

DEV builds expose `window.__fold`:

| Call | What it does |
| --- | --- |
| `jumpTo(page)` | Jump straight to a page |
| `clearPage()` | Win the current page |
| `fastForward(seconds)` | Advance the simulation |
| `state()` | A plain-object snapshot of the game |
| `screenOf(x, z)` | Page coordinates → screen pixels, for scripted gestures |

## Highlights

- **Every mechanic in the GDD:**
  - swipe-to-fold walls, shields, ravine traps, launch flaps and hill ridges
  - tap-to-stamp
  - two-finger spread (or drag / scroll) to tear towers
  - the layer peel
  - a five-weak-point origami dragon
  - the frog finale and the VICTORY ribbon
- **Wordless onboarding.** The first time a fold appears, time slows to a near
  stop and a paper hand demonstrates it. The lesson ends the moment you copy it.
  There is no main menu: the game boots into page 1.
- **The look.**
  - A single MRT pass renders colour and normal+id.
  - One composite shader draws constant-width Sobel ink outlines, a pulsing
    yellow highlight on everything actionable, tilt-shift, the lamp vignette and
    paper grain.
  - Two-band toon shading with periwinkle (never black) shadows, under a desk
    lamp with PCF shadows.
- **Juice:**
  - hit-stop, camera kick and shake, haptics
  - pooled score pops and comic words
  - confetti, glowing gears and paper fire
  - crumple-on-third-hit, page turns with zero downtime
  - a procedural soundtrack that builds from pizzicato to boss brass, plus
    synthesised ASMR paper foley
- **Zero per-frame allocation** in the logic, render and input hot paths.
  Standees are one instanced draw; adaptive render scale.
- **One save object.** See below.
- **Fully responsive.**
  - 320×658 portrait through desktop fullscreen, with safe-area insets.
  - The camera re-fits the book per aspect ratio.
  - UI sizes come from `clamp()` / `vw` / `vh`.
- **Only the Angry font**, and every player-facing string goes through vue-i18n.

## Architecture

```
src/fold/
  logic/           pure TS — no three.js, no Vue; fully unit-tested
    config.ts      dimensions, timings, scores, enemy table
    pages.ts       the six pages, authored with builder helpers
    folds.ts       fold state machine (grab → drag → snap → stamp → lower)
    boss.ts        dragon FSM and weak points
    lessons.ts     wordless onboarding controller
    game.ts        FoldGame: waves, enemies, projectiles, tears, hearts,
                   combos, hit-stop, time scale, page flow, finale
    events.ts      pooled event queue (logic → view/audio/UI)
  input/gestures.ts pointer events → game intents (fold, tap, spread, tear, peel)
  render/          three.js view layer
    FoldRenderer   MRT target, composite, adaptive scale, snapshots
    paperMaterial  toon paper shader (grain, periwinkle shadow tint, dither)
    compositeShader Sobel ink + highlight + tilt-shift + vignette
    views/         Book, Page, Fold, Standee field, Units, Castle, Dragon,
                   Finale, Sheet (turn / peel / crumple), Effects
    art/           procedural page paintings and the standee atlas
  audio/           WebAudio synth SFX + lookahead music sequencer
  FoldEngine.ts    owns the loop: input → logic → view → audio

src/views/FoldScene.vue   canvas + HUD + pause + lifecycle signals to SDKs
src/components/fold/      PageBadge, HeartsBadge, ScoreBadge, BossMeter,
                          FxLayer, GhostHand, CootieCatcherPause, VictoryPanel
src/components/atoms|molecules  F-* design system (origami-styled)
src/use/                  module-level singleton composables
src/platforms/, src/utils/save/  platform registry, SaveManager, strategies
src/voice/                voice-over system (kept for later use)
src/world/                Meadowfall 3D world (lazy dev bench, route /#/world)
```

### Unit art overrides

Unit art can be replaced without touching code:

1. Drop a transparent PNG or WebP (about 2:3, figure standing on the bottom edge) into
   `public/images/fold/units/`.
2. List it in that folder's `manifest.json`, for example
   `{ "units": ["knight.png", "hero0.webp"] }`.

The file name picks the frame. `knight.png` replaces every knight pose, and
`knight1.png` replaces only that pose; the frame names are the `FrameName`
values in `src/fold/render/art/standeeArt.ts`. The game adds the white die-cut
margin itself. Anything not listed keeps its procedural vector drawing.

## Save & cloud hydration

Everything persists inside one object:

```text
aethel_state = {
  fold_page, fold_cleared, fold_run: { score, hits, time },   // resumable run
  fold_best, fold_wins, fold_runs, fold_lessons, fold_stats,  // progress
  fold_settings: { haptics, shake, quality },
  user_sound_volume, user_music_volume, user_language, mobile_mute,
  __save_internal__rewarded_history
}
```

On plain web builds that is exactly one localStorage key. Cloud strategies
upload `aethel_state` plus `__save_meta__` and nothing else. The load order is
what stops a returning player from being treated as a fresh install:

1. `main.ts` **awaits** the platform SDK init before `saveManager.init()`.
2. It **awaits** `saveManager.init()` before importing `App.vue`, so the whole
   module graph evaluates against hydrated storage.
3. `reloadAethelState()` runs **before** the `saveDataVersion` bump, so every
   composable re-reads the hydrated blob. A late cloud answer bumps
   `progressRevision`, and the scene jumps to the restored page.
4. If hydration returned nothing **and** local storage looks fresh,
   `SaveManager` retries before letting the app boot.
5. Hard checkpoints (page start, page cleared, victory) call `flushSaveNow()`.

Covered by:
- `tests/save/AethelStateCloudHydrate.test.ts`, plus a test per strategy;
- in a real browser, `tests/e2e/cloud-hydration.spec.ts`, which runs a fake
  CrazyGames SDK through returning-player, slow-SDK, transient-failure and
  new-player boots.

## Building for platforms

```bash
pnpm build:crazy-web         pnpm build:playgama
pnpm build:gamepix           pnpm build:gamemonetize
pnpm build:game-distribution pnpm build:glitch
pnpm build:itch              pnpm build:wavedash
pnpm build:yandex            pnpm build:poki
```

Each mode reads `.env.<mode>`. That file is git-ignored: copy it from the
committed `.env.<mode>.example`, in which every game id, title id, install id and
token is deliberately blank. The build then strips the other platforms' SDK
glue and emits a per-platform CSP. The jury build ships **no ads** of any kind.
Ads (`VITE_APP_INTERSTITIALS`, `VITE_APP_REWARDED`) exist only on the builds
with an ad SDK: CrazyGames, GameDistribution, Playgama, GamePix, GameMonetize,
Yandex and Poki (`commercialBreak` / `rewardedBreak`; saves stay in
localStorage).

## Docs

| File | Contents |
|---|---|
| [`aethel-fold-GDD.md`](./aethel-fold-GDD.md) | The game design document (the contract) |
| [`game-implementation-plan.md`](./game-implementation-plan.md) | Architecture decisions, task checklist, status log |
| [`description.md`](./description.md) | Store blurb, how to play, controls |
| [`roadmap.md`](./roadmap.md) | 20 prioritised retention / playtime / conversion features |
| [`voice-over-workflow.md`](./voice-over-workflow.md) | The retained voice-over pipeline |
