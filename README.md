# aethel-fold

A mobile-first 2D build-and-defend game. Stack blocks into a tower, bolt cannons
and lightning coils onto it, and hold off waves of enemies marching in from both
sides. Every block has HP. When one breaks, anything it was holding up
**collapses**. The run ends when the Gate falls — then you spend what you earned
in the tech tree and build a taller, meaner tower.

WIP: [playable demo](https://konstantinsteinmiller.github.io/aethel-fold/)


Built with Vue 3 + TypeScript + Canvas 2D, shipping to CrazyGames, Playgama,
GamePix, GameMonetize, GameDistribution, Glitch.fun, itch.io, Wavedash and
Yandex Games from one codebase.

---

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # 376 unit + integration tests
pnpm type-check   # vue-tsc
pnpm build        # type-check + production build
```

## Highlights

* **No art payload.** Every block, enemy, projectile and background layer is
  drawn procedurally — resolution-independent, crisp at any zoom, and the game
  is interactive the moment the JS parses. Drop-in bitmap overrides are wired
  up and documented in [`art-todo.md`](./art-todo.md).
* **Synthesised combat audio.** Shots, impacts, explosions and collapses are
  generated per event with randomised pitch and filter sweeps, so a 40-turret
  tower never sounds like a loop. See [`sound-todo.md`](./sound-todo.md).
* **One save object.** All persisted state lives in a single in-memory
  `tower_state` record written to exactly one localStorage key, which the
  platform save layer mirrors to the SDK cloud store as one object.
* **Fully responsive.** 320×658 portrait through desktop fullscreen, with a
  purpose-built landscape-phone layout and safe-area insets throughout. No
  fixed pixel sizing in the UI — everything is `clamp()` / `vw` / `vh` / `%`.
* **21 languages**, key-parity enforced by a test.

## How it plays

| Phase | What happens |
|---|---|
| **Build** | You are dealt four **Tetris-like shapes** — dominoes, L-bends, 2×2 squares, a cannon already mounted on its plinth. Tap one, tap a highlighted slot to drop it, and that slot rerolls. Some shapes come capped with a roof, which is cheap and sturdy but seals that column for good. A swap button on each tile trades one offer for a fresh draw, on a shared 10-second charge. The ground floor is capped at four cells either side of the Gate, so height has to come from actually building upward. A timer counts down to the wave — calling it early converts the unused seconds into a coin bonus (up to +40%). |
| **Battle** | Enemies walk in from both sides, fly over the top, and — from wave 12 — swim in from the lake and breach to bite the base. From wave 11 **bombers** cruise above your crown and drop bombs and molotovs straight down, so building high stops being safety. From wave 14 they bring **siege engines**: rams that ignore your walls and drive at the Gate, ballistas and catapults that stand off and shell you, towers that unload troops three rows up, trebuchets parked 20 cells out — beyond every weapon you own — and an ironclad ram that arrows simply bounce off. The answer to the ones you cannot reach is **cavalry**, bought with gold mid-battle, who ride out at whichever side is worst. Weapon blocks fire automatically. You can keep building. 1×/2× speed toggle. |
| **Wave clear** | Coins land in your wallet immediately, resources pay out, economy blocks yield, repair bays patch their neighbours, and you're back in Build. Anything still on fire keeps burning into the build phase. |
| **Defeat** | The Gate falls. Bank the run's coins, spend them in the tech tree, build again. |

Controls: tap a tray tile then tap the field to place · hover (or long-press) a
tile for its resource cost · long-press a placed block to inspect it · drag to
pan · pinch or scroll to zoom · Space calls the wave · `1`–`4` arm an offer ·
`F` toggles battle speed · `Esc` deselects.

Four axes of threat, each punishing a different lazy tower: **ground** units
chew the base, **air** goes for the crown — divers close to melee range from
wave 9, bombers hold station above it and drop from wave 11 — **sea creatures**
surface from the lake to strike your lowest blocks from wave 12 (while submerged
they cannot be shot at all, and only the wake gives them away), and **siege
engines** from wave 14 break the rules infantry follow, several of them from
ranges no block can reach.

Every threat has a specific answer, and one of them invalidates a whole weapon:
arrows bounce off the ironclad ram, so a tower built entirely out of cheap
Archery blocks has nothing for it. The tech tree has no level cap on any stat
node, so a run can specialise all the way down one line if you can afford it.

## Architecture

```
src/game/          pure, testable domain — no Vue, no DOM
  types.ts         Block / Enemy / Projectile / WavePlan / RunSnapshot
  blocks.ts        14-block catalogue with costs, HP, weapon specs
  shapes.ts        polyomino build shapes + the 4-slot lane-locked offer deck
  world.ts         shared world geometry (waterline, swim depth)
  enemies.ts       11 enemy types across ground / air / sea
  waves.ts         seeded, deterministic wave director
  tech.ts          28-node tech DAG + effect accumulation
  art.ts           palettes + drop-in bitmap probing

src/use/           reactive layer (module-level singletons)
  useTowerState    the single `tower_state` blob + debounced persistence
  useTowerGame     the simulation — fixed 60 Hz accumulator
  useTowerArt      the renderer — layered, sprite-cached, culled
  useTowerVfx      pooled particles, floating text, decals, quality tiers
  useTowerAudio    sample + synthesis cue router with per-cue throttling
  useTowerCamera   spring-damped pan/zoom with auto-fit
  useTowerProgress tech levels, lifetime stats, derived combat modifiers
  useTowerEconomy  coins

src/platforms/     platform registry, CSP, capability gates, resolvers
src/utils/save/    SaveManager, BlobStorage, 8 cloud strategies
src/components/    F-* design system + game HUD + modals
```

**Performance contract:** the hot collections (`blocks`, `enemies`,
`projectiles`) are plain non-reactive structures — Vue's proxy overhead on a few
hundred entities mutated 60×/s is exactly what drops frames on a phone. Only
HUD scalars are refs. Block bodies are cached into offscreen canvases per
(type, damage stage, zoom bucket); particles live in typed arrays with a
free-list; quality auto-degrades across three tiers off a rolling FPS average.

## Save & cloud hydration

Everything persists inside one object:

```text
tower_state = {
  ts_coins, ts_tech, ts_best_wave, ts_runs, ts_total_kills, ...
  ts_run: {                                    // resumable siege
    wave, wood, stone,
    blocks: [[c, r, type, hp, roof], ...],
    offers: [shapeId x4]                       // so a reload can't reroll your hand
  }
  ts_user_language, ts_user_difficulty, ...    // settings
}
```

The load order is load-bearing and is what stops a returning player from being
rendered as a fresh install:

1. `main.ts` **awaits** the platform SDK init before `saveManager.init()`.
2. It **awaits** `saveManager.init()` before importing `App.vue`, so the whole
   module graph evaluates against hydrated storage.
3. `reloadTowerState()` runs **before** the `saveDataVersion` bump, so every
   composable's watcher re-reads the hydrated blob rather than the stale one.
4. If hydrate didn't return data **and** local looks fresh, `SaveManager` retries
   3× at 1 s spacing before letting the app boot.
5. Hard checkpoints (wave cleared, run ended, tech bought) call `flushSaveNow()`
   to bypass both debounces.

`tests/save/TowerStateCloudHydrate.test.ts` covers all of it end to end,
including transient-SDK-failure recovery, corrupt-blob degradation, and a
full write → cold-boot → read round trip.

## Building for platforms

```bash
pnpm build:crazy-web        pnpm build:playgama
pnpm build:gamepix          pnpm build:gamemonetize
pnpm build:game-distribution pnpm build:glitch
pnpm build:itch             pnpm build:wavedash
pnpm build:yandex
```

Each mode reads its `.env.<platform>` file, DCEs the other platforms' SDK glue,
and emits a per-platform CSP.

## Docs

| File | Contents |
|---|---|
| [`game-implementation-plan.md`](./game-implementation-plan.md) | Full design + architecture decisions + execution checklist |
| [`retention-roadmap.md`](./retention-roadmap.md) | 20 prioritised retention / conversion features |
| [`art-todo.md`](./art-todo.md) | Drop-in bitmap override manifest |
| [`sound-todo.md`](./sound-todo.md) | Audio cue map + what's worth commissioning |
