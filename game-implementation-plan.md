# Aethel Fold — implementation plan

Living plan for **Aethel Fold** (`aethel-fold`), the origami pop-up-book siege
game specified in [`aethel-fold-GDD.md`](./aethel-fold-GDD.md). Resume from here
if a session ends: every task has a checkbox, and the **Status log** at the
bottom says what was last touched.

> The previous content of this file was the grass-system plan. That milestone
> shipped; its record lives in [`grass.md`](./grass.md).

---

## 0. Decisions (made up-front so nobody re-litigates them)

| Topic | Decision | Why |
|---|---|---|
| Product | Aethel Fold boots at `/` straight into Page 1 — no main menu (GDD §6). Meadowfall sandbox moves to `/world` (lazy, dev bench). | GDD: "Booting the app drops the player instantly into the tutorial." |
| Code home | `src/fold/` — `logic/` (pure TS, no three/Vue/DOM), `render/` (raw three.js), `audio/` (WebAudio synth), `input/`, `FoldEngine.ts` (glue). Vue HUD in `src/components/fold/`, view `src/views/FoldScene.vue`. | Pure logic is unit-testable headlessly; the renderer only *reads* logic state. |
| Rendering | Raw three.js (same reasoning as GDD.md §0). Custom `PaperMaterial` (GLSL3 `ShaderMaterial`, toon bands + hard spot-lamp shadow + procedural paper grain + MRT normal output) → one composite pass: **Sobel ink outlines on depth+normals** (GDD §10.1), **tilt-shift** blur top/bottom 15 % (GDD §2), warm lamp vignette, grain. | GDD §2/§10 ask for exactly this; MRT gives the normals for free in the colour pass (no second geometry pass). |
| Outlines | Bold, near-black ink (`ink` in the Aethel Fold palette), constant screen width scaled with resolution. | This game's GDD overrides Meadowfall's "never #000" rule — different product, different contract. |
| Lighting | One warm `SpotLight` above the desk (desk lamp), `BasicShadowMap`-sharp shadows, flat unlit-style toon (2 bands). | GDD §2 "warm localized point light from above… sharp hard-edged shadows". Spot, not point: one shadow map instead of six. |
| Hinges | Paper flaps are `Object3D` pivots (the "bones" of GDD §10.2) → shadows & MRT stay correct with zero custom depth materials. | Vertex-shader folding would need a custom depth material per flap. |
| Units | Knights etc. are **paper standees**: extruded die-cut silhouettes whose faces are programmatically drawn vector art (canvas atlas). `/public/images/fold/<name>.webp` overrides a frame automatically when present. | "Tiny 2D paper knights" (GDD §6) + "allow easy image update" (brief). |
| Boss | Fully 3D faceted origami dragon (multi-colour panels, flat facets are *desired* here), hierarchical hinge rig: body, neck×3, head, jaw, wings×2 (3 fold segments each), legs×4, tail×4. | GDD §8 Page 5, reference storyboard. |
| Audio | 100 % procedural WebAudio: paper crease (filtered noise + crackle), cardboard SNAP (sub thump + click), rip, kazoo/party-popper, stamp, gear grind, paper-fire, frog ribbit, tiny "yay!" crowd (formant synth); **procedural sequencer** for pizzicato + glockenspiel, boss brass + snare, the gear-grind drop and the victory chord. Existing `public/audio/sfx/*.ogg` layered where they fit (plastic-torn → rip body, celebration → victory). | GDD §3 soundtrack arc without shipping megabytes of audio; instant start. |
| Save | **One object `aethel_state`** (in-memory `Record<string, any>`) is *the* save payload. `tower_state` is retired: the SaveManager allowlist, CrazyGames/GamePix/Yandex strategies, merge-policy scoring and fresh-user guard all move to `aethel_state` + `__save_meta__`. | Brief: one object in LocalStorage and in SDK cloud saves; correct hydration, never a false "fresh user". |
| Removed | Tower-siege game (`src/game`, `useTower*` except the state blob which becomes `useAethelState`), BattlePass, Achievements, DailyRewards, Missions, AdRewardButton, TreasureChest, coin economy, leaderboard, interstitial/rewarded **triggers** (platform ad plumbing stays dormant for later), Arlaan chapter (voice-over kept → `src/voice/`). | Brief. |
| Fonts | Only `Angry` (angrybirds-regular.ttf) — the global default. | Brief. |
| i18n | Every player-facing string (incl. onomatopoeia SNAP!/STAMP!/CREASE!/RIP!/GROUAAARGH!) under `fold.*` in every locale (`en`, `de`). | Brief + parity test. |

## 1. Coordinate system & page contract

* Page sheet: **10 × 14** units, x ∈ [-5, 5] (left→right), z ∈ [-7, 7] (top/enemy → bottom/player). y = up off the paper.
* Hero stands at z = 5.6; the **breach line** is z = 5.0.
* Camera: steep isometric (≈58° pitch) from +z; `fitCamera()` solves distance so the whole sheet + margin fits any aspect (portrait → sheet fills width; landscape → desk + stacked layers visible at the sides = GDD §7 curiosity loop).
* Thick paper **layer stack** under every page (visible at the edges), the next page's art faintly printed on the layer below.

## 2. Mechanics (GDD §4 + storyboard)

| Mechanic | Gesture (touch) | Gesture (mouse) | Effect |
|---|---|---|---|
| **Swipe to Fold** (wall) | drag along the blue dotted arrow | drag | flap follows the finger (light continuous haptic), release past 45 % → **SNAP**: pop-up tower/wall rises, knights on the flap are **launched toward the lens** → confetti burst. Wall blocks the lane, auto-lowers after `hold`. |
| **Valley** (Page 2) | drag along the strip | drag | two panels rise into a V; everyone inside is **trapped** |
| **Tap to Stamp** | tap a raised wall / valley | click | slam flat with extreme force → crush everything under it (+bonus). **Hit-stop 0.1 s** on brutes, sharp vertical shake, hard haptic. |
| **Launch fold** (Page 3) | drag | drag | flap flips 180° and flings the catapult back up the page onto the archers |
| **Ridge / shape terrain** (Page 3) | drag | drag | the ground folds into a mountain ∧ that closes a lane; the march re-routes into your traps |
| **Spread to Flatten** (Page 4, boss wings) | two fingers apart on a glowing crease | press + drag outward (or wheel) | the tear follows the fingers; at 100 % **RIP** — tower/gate/drawbridge tears flat, crew destroyed |
| **Shield fold** (Pages 3–5) | drag the line in front of the hero | drag | paper shield pops up; blocks arrows, boulders and dragon paper-fire |
| **Crease** (boss legs) | swipe along the glowing crease | drag | the limb folds backward — **CREASE!** |
| **Peel** (Page 4 → 5) | drag the dog-eared corner | drag | peels the page back to reveal the castle-core layer beneath |
| **Frog fold** (Page 6) | final dotted line | drag | the flat dragon sheet folds into a tiny paper frog; ribbon **VICTORY** drops |

Health: the hero has **3 hearts**. Enemy breach, arrow, boulder or paper-fire = −1. At 0 the page **crumples into a ball**, is thrown away and a fresh sheet drops in (zero load time, GDD §9).

## 3. Pages (GDD §8)

1. **The Border** — swipe. 3 waves of knights, 3 wall lines. Lesson `swipe` on wave 1 (slow-mo + ghost hand, GDD §6 0:00–0:02).
2. **The Ravine** — stamp. A valley strip across the middle + 2 walls; brutes (too heavy to launch) must be trapped and stamped. Lessons `stamp`.
3. **The Siege** — archers shoot paper arrows (shield line, lesson `shield`), catapults on launch flaps (lesson `launch`), a ridge fold funnels a lane (lesson `ridge`), knights keep marching.
4. **The Castle Gates** — static castle: 2 archer towers + gate + drawbridge with glowing creases (lesson `spread`), knights sally from the gate until it is torn. Exit = **layer peel** (lesson `peel`).
5. **The Boss** — rumble → gears glow → castle unfolds into the **origami dragon** (music drop + gear grind + GROUAAARGH!). Loop: breath (raise the shield), stomp (knights spill), expose a weak point → crease legs (lesson `crease`), spread wings (lesson `core`), neck last → collapse into a flat sheet.
6. **Victory** — one last dotted line → frog fold → die-cut VICTORY ribbon, massive confetti, tiny paper people cheering "yay!". Run summary (score, best, time, hits) + Play again.

Pages flow with **zero downtime**: clearing a page folds its pop-ups flat and immediately turns the page (GDD §7).

## 4. Juice (GDD §5)

* Hit-stop 0.1 s on stamping big enemies; global slow-mo for lessons.
* Sharp, low-amplitude, high-frequency vertical shake on SNAP / Stamp (respects the "reduce motion" setting).
* Haptics: light continuous while dragging a fold, sharp burst on SNAP/Stamp (`navigator.vibrate`, setting toggle).
* Bouncy toon score pops (+100) — pooled DOM, Angry font, scale-up + rotate + fade.
* Confetti: instanced rectangular paper chips (one draw call), physics + flutter.
* Glowing 2D toon gears (billboard sprites, additive) for magic/energy.
* Speed lines on launch, dust puffs (paper flecks) on stamp, shock ring on snap, pulsing yellow highlight on actionable outlines (GDD §9).
* Onomatopoeia comic words (SNAP!, FOLD!, STAMP!, CREASE!, RIP!, GROUAAARGH!) — i18n, DOM, bouncy.

## 5. UI (GDD §9 + brief)

* HUD (safe-area aware, fluid `clamp()`/vw/vh sizing, portrait + landscape):
  * top-left: `PageBadge` (page n/6 + name) and `HeartsBadge` (3 origami hearts);
  * top-centre: `ScoreBadge`;
  * top-right: `SettingsButton` (folded paper gear) + `FMuteButton` (origami speaker).
* Pause = the screen folds like a **cootie catcher** (four triangular flaps close in) → origami `FModal` with Resume / Restart page / Restart game / Settings (music, sfx, haptics, shake, quality, language).
* Victory panel on the die-cut ribbon (`FReward` restyled) + Play again.
* All F-components restyled as folded paper (crease highlight, dog-ear corners, offset paper shadow), fluid sizes, minimum sizes so nothing collapses to 0, FModal header never overlaps content. Origami SVG icons replace emoji/raster icons.
* `FLogoProgress` → Aethel Fold crane logo; the static splash in `index.html` hands over on the first rendered frame.

## 6. Save — `aethel_state`

```
aethel_state = {
  v: 1,
  page: 1..6,            // resume point (a reload drops you back on this page)
  runScore, runTime, runHits,      // current run, checkpointed at page start
  bestScore, bestTime, wins, runs,
  lessons: { swipe: true, stamp: false, … },   // wordless lessons already learned
  settings: { music, sfx, haptics, shake, quality, lang },
  stats: { knights, brutes, launched, stamped, torn, folds, … },
  updatedAt
}
```

* `src/use/useAethelState.ts` replaces `useTowerState` (same debounced-persist API: `getState/setState/…`), STATE_KEY = `aethel_state`.
* SaveManager allowlist → `aethel_state` + `__save_meta__`; CrazyGames, GamePix and Yandex strategies mirror that one key; merge-policy `progressScore` = pages cleared × 1000 + wins × 5000 + lessons × 50 + runs; boot fresh-guard looks inside `aethel_state`.
* The game reads state only after `SaveManager.init()` resolved and re-reads on `saveDataVersion` (cloud recovery), so a slow SDK never yields a "fresh user".
* Verified by unit tests (strategy + manager + composable round-trip) **and** Playwright e2e with a fake CrazyGames SDK (remote data survives a reload, local storage stays clean) plus Chrome-MCP manual verification.

## 7. Performance budget

* Target: ≤ 60 draw calls typical, ≤ 90 on the boss page; ≤ 12 programs. Instancing for knights, confetti, arrows, trees.
* **Measured** (session 3, per frame, main pass + shadow pass + composite, 412×860):

  | Page | Draw calls |
  | --- | --- |
  | 1 | 52 |
  | 2 | 56 |
  | 3 | 58–80 |
  | 4 | 68–88 |
  | 5 (dragon) | 123 |
  | 6 | 46 |

  * Programs: 16–22. The paper material's variants (atlas, cutout, double-sided) compile separately.
  * GPU memory reaches a plateau after one full 1→6 cycle (about 31 geometries, 17 textures) and stays flat over repeated cycles.
  * Page 5 is the outlier: 22 separately animated dragon parts cast shadows, plus the fallen castle pieces. Fallen pieces now leave the shadow pass and empty projectile meshes are hidden (138 → 123).
  * Next step if needed: merge the dragon's rigid sub-parts per bone, or drop small parts from `castShadow`.
* Zero per-frame allocation in logic + render update paths (pooled entities/events).
* Adaptive render scale (DPR cap 2, floor 0.6) driven by frame-time p95; composite pass at full res, MSAA only on desktop.
* Hot path: `index.html` splash → `main.ts` → `FoldScene` chunk (three + fold) → Page 1 built synchronously, pages 2–6 built on idle after first frame; locale chunk lazy; audio synthesised on first gesture.

## 8. Task list

### A. Cleanup & infrastructure
- [x] A1 Remove Arlaan chapter; extract voice-over into `src/voice/` (background agent).
- [x] A2 Remove tower game (`src/game`, `useTower*`, `GameScene`, `components/game`, MonsterLab route) and its tests.
- [x] A3 Remove BattlePass, Achievements, DailyRewards, Missions, AdRewardButton, TreasureChest, CoinBadge/coin economy, leaderboard/identity, reward buttons; drop their tests and i18n keys.
- [x] A4 `useAethelState` + save pipeline on `aethel_state` (allowlist, strategies, merge policy, fresh-guard, keys.ts, useUser settings, i18n locale key).
- [x] A5 `.env.example` + per-platform `.env.<mode>` templates with **empty** keys/ids (game ids, title_id, test_install_id, tokens).
- [x] A6 Fonts: only Angry; remove other font stacks (Georgia in logo, monospace in editor only stays debug-only).
- [x] A7 Router: `/` → FoldScene; `/world` Meadowfall bench (lazy). The `/characters` and `/water` benches were removed (roadmap #7).
- [x] A8 Rename product strings/meta: title, manifest, package scripts (`aethel-fold`), README.

### B. Logic (`src/fold/logic`, pure TS)
- [x] B1 `math.ts`, `types.ts`
- [x] B2 `config.ts` (dimensions, timings, scores, tuning)
- [x] B3 `pages.ts` (6 pages authored with builder helpers)
- [x] B4 `events.ts` (pooled event queue)
- [x] B5 `folds.ts` (fold state machine + drag/snap/stamp/lower dynamics)
- [x] B6 enemies — pools in `entities.ts`, behaviour in `game.ts` (march/lanes/re-route/blocked/trapped/launched/crushed/breach; archers, catapults)
- [x] B7 projectiles — pools in `entities.ts`, flight/blocking in `game.ts` (arrows, boulders, fling, paper-fire; shield blocking)
- [x] B8 tears — `TearState` in `types.ts`, pull/tear in `game.ts` (spread targets)
- [x] B9 `boss.ts` (dragon FSM, weak points, attacks)
- [x] B10 `lessons.ts` (wordless onboarding controller: slow-mo, ghost-hand script, completion)
- [x] B11 `game.ts` (FoldGame top-level FSM, waves, hearts, scoring, combos, hit-stop, time scale, page flow, crumple/drop, peel, finale)
- [x] B12 `gestures.ts` (swipe/drag, tap, two-finger spread, single-pointer tear, peel; screen→page via injected projector)

### C. Rendering (`src/fold/render`)
- [x] C1 `FoldRenderer` (renderer, MRT target, adaptive scale, resize, dispose)
- [x] C2 `PaperMaterial` + composite shader (Sobel ink, tilt-shift, vignette, grain, flash/fade uniforms)
- [x] C3 `palette.ts` (Aethel Fold colours) + `camera.ts` (fit, shake, focus)
- [x] C4 Desk (wood planks, lamp pool), page sheet + layer stack, painted page art per theme (canvas texture)
- [x] C5 Fold flaps (hinge pivots), dotted guide lines + arrows (animated), pop-up tower/wall/shield structures, valley panels, launch flap, ridge
- [x] C6 Standee atlas (knight, brute, archer, catapult crew, hero, tiny cheering people) — vector drawings + `/images/fold/*` overrides; instanced standee field
- [x] C7 Castle (Page 4/5) with tearable towers/gate/drawbridge
- [x] C8 Origami dragon rig + animations (unfold, idle breathe, rear, breath, stomp, limb fold, collapse)
- [x] C9 Paper frog + fold sequence
- [x] C10 VFX: confetti, speed lines, dust flecks, shock ring, glow gears, paper-fire, arrows/boulders, landing markers, highlight pulse
- [x] C11 Transitions: page turn (snapshot + curl), crumple ball + throw, fresh page drop, layer peel
- [x] C12 Trees/props: pop-up pines, bushes, flags, river strip, bridge

### D. Audio (`src/fold/audio`)
- [x] D1 Synth SFX bank (crease loop, snap, rip, pop/kazoo, stamp, thunk, whoosh, arrow, boulder, gear grind, fire, roar, ribbit, yay, page turn, crumple)
- [x] D2 Procedural music: pizzicato+glock, drop/grind, boss brass+snare, victory chord; ducking & transitions
- [x] D3 Wire to settings/mute/pause (existing suspend/resume pipeline)

### E. UI
- [x] E1 Origami icon set — one named-icon component `src/components/icons/OrigamiIcon.vue`
- [x] E2 Restyle F-components (FButton, FIconButton, FHudButton, FHudBadge, FModal, FSelect, FSlider, FSwitch, FTabs, FMuteButton, FLogoProgress, FReward, SaveStatusBanner) — fluid, min sizes, no custom scale hacks, header never overlaps
- [x] E3 HUD components (`PageBadge`, `HeartsBadge`, `ScoreBadge`, `BossMeter`, `CootieCatcherPause` (pause + settings + confirm faces, replaces a separate settings modal), `FxLayer` (score pops + comic words, pooled), `GhostHand` (lessons + idle hint), `VictoryPanel`)
- [x] E4 `FoldScene.vue` (canvas, input, HUD, pause gate, lifecycle signals to platform SDKs)
- [x] E5 i18n `fold.*` in en + de; prune dead namespaces

### F. Verification
- [x] F1 Unit tests: logic (gestures, folds, enemies, projectiles, tears, boss, lessons, game flow, scoring), `useAethelState` + SaveManager hydration (LocalStorage, CrazyGames, GamePix, Yandex, Glitch) — remove tower/meta tests.
- [x] F2 Playwright e2e (`tests/e2e`): boot → lesson → swipe snaps a wall; stamp; reload resumes page; fake-SDK remote hydration; responsive screenshots (320×658 portrait, 658×320 landscape, tablet, desktop); pause menu; victory flow via debug jump.
- [x] F3 Real-browser session: play each page, console clean, perf numbers, hydration check.
  - The chrome-devtools MCP cannot launch in the cloud container: it wants `/opt/google/chrome` and refuses to run as root.
  - The same checks ran through Playwright on the bundled Chromium instead: all pages cycled three times with a clean console, the per-frame counters above, and the hydration e2e.
  - To use the MCP locally, point it at a Chrome with `--executable-path`.
- [x] F4 `pnpm type-check`, `pnpm test`, `pnpm build` green.

### G. Docs
- [x] G1 `description.md` (short ≤150, long ≤500, how to play, controls)
- [x] G2 `roadmap.md` (≥15 retention/playtime/conversion features with implementation notes)
- [x] G3 `CLAUDE.md` / README updated for Aethel Fold

---

## Status log

* **Session 1** — explored `src` (platform/save layer, UI/i18n, world engine, tower/meta systems); wrote this plan; B1 done; A1 delegated.
* **Session 2** — built the whole game: logic, gestures, renderer and all views, audio, HUD and UI, the aethel_state save pipeline and i18n; removed the tower, meta and Arlaan code; visually verified every page, transition, the boss, the finale and the victory flow with headless SwiftShader screenshots at portrait, landscape and desktop sizes.
* **Session 3** — ported the save and platform tests to `aethel_state`. This found and fixed two bugs:
  * `checkpoint()` now flushes immediately;
  * a CrazyGames manifest from a pre-port build no longer wedges the retry loop.

  Also in this session:
  * Playwright e2e is 21/21 green: gameplay, persistence, fake-SDK cloud hydration and 6-viewport HUD overlap.
  * Blank `.env.*.example` templates for every platform mode.
  * Splash, title, manifest and package renamed to Aethel Fold.
  * Wrote `description.md` and `roadmap.md` (20 items); rewrote the README and CLAUDE.md.
  * `pnpm type-check` is clean, `pnpm test` gives 1976/1976, and `pnpm build` passes. The hot path is about 275 kB gzipped; the world, lab and character chunks are lazy.
* **Session 4** — player feedback pass.
  * **Fixes**
    * The pause ribbon was clipped at every viewport. It now uses a shared `PaperRibbon` (outlined with drop-shadows so the notched ends keep their ink) that sits outside the card's scroller.
    * The victory ribbon no longer covers the HUD.
    * The landscape pause menu uses two columns.
  * **Look**
    * Ink width went from 2.1 to 1.4 CSS px. The Sobel thresholds now sit above low-poly facet angles, and the ink is tinted by the colour it outlines.
    * Flat fold flaps borrow the page's outline id, so they no longer draw boxes. Standee strokes went from 4.2 to 3.2.
    * Boulder and breath telegraphs are no-ink (id 127).
  * **Tutorial:** new `crush` lesson (fold a wall back down onto the knights bashing it).
  * **Book 2 "The Homefront"** (GDD §11)
    * Books are modelled as `BookId` × `PageId`; `pageDef(book, page)` replaces the old page-5/page-6 special cases, which now key off `page.exit`.
    * Runner and leaper enemies, the keep's sling (logic in `game.ts`, `SlingView`, gesture mode `sling`), rearming launch flaps, and catapults on book 1 pages 2 and 4.
    * Four new page themes, the keep, the windmill, tents and apple trees, a crane finale, and printed story captions (`CaptionLabel`, `fold.story.*`).
    * The bookshelf in the pause menu, and the book choice on the victory card.
  * **Save:** book 2 progress lives in `aethel_state` (`fold_book`, `fold_cleared2`, `fold_best2`, `fold_wins2`) and counts in the merge score.
  * **Baseline repairs**
    * `checkpoint()` flushes again.
    * A cancelled gesture no longer snaps a fold.
    * The lesson hand appears on the frame the lesson starts.
    * `__fold.fastForward` exists again.
    * The cloud-hydration e2e reads raw storage correctly.
  * **Verification:** `pnpm type-check` is clean, `pnpm test` passes 2000/2000 (a bot clears every page of both books), and Playwright passes 25/25 (including 4 new book-2 specs).
* **Session 5** — credibility and castle pass.
  * **Spawning:** enemies spawn in front of structures (`PageDef.spawnZ`; dragon stomps land in front of the castle core).
  * **Page turns:** pop-ups rise with the page turn and peel (`PageView.riser`, `hold`/`setRise`/`release`, driven by `GameView`).
  * **Props:** kept clear of launch-flap swing.
  * **Player castle:** on every page (`playerCastleGeometry`, `CASTLE` in config), with the hero on the keep.
  * **Ballistas:** a new `FoldKind` with bolts (`fireBallista`, `boltStep`, `KILL_BOLT`), a `ballista` lesson and idle hints.
  * **Sling**
    * Attention cues.
    * It now appears on book 1 page 4, with its lesson on wave 3.
    * Sling body hits on the dragon (`Boss.slingHits`, the `bossHit` event).
  * **Logo:** a new logo from `logoArt.ts`, rasterised by `scripts/render-logo.mjs`.
  * **Loading screen**
    * It now covers the real load: the static splash's bar is live from the first paint (`public/boot.js`).
    * Boot milestones go through `useBoot.ts`, and `FLogoProgress` waits for the first game frame and cycles gameplay tips.
  * **Name:** the game is named **Aethel Fold** everywhere.
* **Session 6**
  * **HUD:** the page badge is clamped to its HUD column. Book 2's label is shortened to "Book 2", with the full label kept in the aria-label. It no longer overlaps a five-digit score in German portrait; a new e2e check covers 320–412 px.
  * **Mute button:** one volume mute on every device. The pre-mute volumes are kept in `aethel_state` (`user_muted_volumes`) and restored on the next tap, also after a reload. The old mobile hard-suspend mode is retired, and a stored flag from it is released at load.
  * **Castle bailey:** the decorative bailey unfolds past the page edge (`castleBaileyGeometry`), and the desk props below the book were moved aside for it.
  * **Save key:** the save was already `aethel_state`; only two stale comments still said `tower_state`, and they are fixed.
* **Session 7** — roadmap #9 and #8.
  * **"Almost!" moment:** a defeat's `crumple` event carries the enemies left (`FoldGame.enemiesLeft()`; on the dragon's page, weak points left, c = 1). `FxLayer.almost` prints ALMOST! over the plural `fold.fx.almost` count for 2 s, then `AlmostRetry` shows a big Try again (an `action` slot, so an ad build can swap in a rewarded variant). Try again (`FoldGame.tryAgain`) drops the page back as it was with full hearts and a short grace, for `ALMOST.penalty` of the points gathered on it, once per page attempt; after that, or if nobody taps within `ALMOST.autoRetry`, a fresh page drops as before. A pause-menu restart skips the moment.
  * **"The book is kind":** `src/fold/logic/difficulty.ts` turns a memory of the run (crumples per page, perfect streak, sticky boss ease) into `FoldGame.difficulty` (enemy speed and wave pacing, sim time), `extraPerWave`, and a 0.5 s fold slow-mo after a crumple. Tuning is `DIFFICULTY` in `config.ts`. The memory lives in `aethel_state.fold_run` (`saveKindness`/`readKindness` in `useFoldProgress`).
* **Session 8** — roadmap #1, star rating per page.
  * **Rule** (`src/fold/logic/stars.ts`): ★ clear, ★★ at most one heart lost, ★★★ a Perfect Page with at least the page's par gathered on it (perfect bonus included). A page finished after a Try-again continue is capped at ★: the continue exists because every heart was lost. A fresh drop (auto-retry, a spent continue, a pause-menu restart) is a new attempt. The finale is unrated, so each book has 15 stars.
  * **Pars:** every `PageDef` goes through `withPar`, so `par = floor50(Σ enemy base + Σ tears + perfect bonus [+ boss + 5 weak points] + skill)`. Skill is `STARS.parSkill` (0.35) × the enemy base, or a flat `STARS.bossSkill` (2500) on the dragon's page. The numbers were measured against the frame-perfect bot, whose natural skill share runs from 0.36 to 0.9. A bot test keeps every rated page reachable.
  * **Game:** `pageCleared` carries the stars as `c`; there are `FoldGame.pageStars` and `continuedThisPage`, and `GameStats.stars` is the sum over the run.
  * **Save:** stars are stored as `aethel_state.fold_stars` (`{ b1p3: 2 }`) through `recordStars` in `useFoldProgress`, before the page-clear checkpoint's `flushSaveNow`. Selectors: `starsOf`, `starsForBook`, `totalStars`, for the pause shelf, the victory card and the coming 3D shelf. In the merge score each star is worth 25 (at most 750, below one cleared page), and `carryStars` folds the losing side's per-page bests into the winning blob in the CrazyGames and Glitch strategies, so a merge never loses a star.
  * **Look/sound:** `StarRibbon` (inside `FxLayer`, CSS only) drops under the HUD strip and folds the stars in one by one. `FoldAudio.stars` rings a rising E5–G5–C6, plus a sparkle for ★★★, on the same `STARS.reveal*` timing. `StarTally` shows each book's stars on the pause bookshelf and the victory card.
  * **Verification:** `pnpm type-check` is clean and `pnpm test` passes 2054/2054. e2e passes gameplay 8/8, persistence 4/4, book2 4/4 (one run timed out once on the victory-card click and passed on rerun), responsive 12/12 (including new star-ribbon checks at 320×658 and 658×320) and cloud-hydration 5/5.

* **Session 9** — roadmap #4, demonstrated wordless lessons.
  * **Logic** (`lessons.ts`): `LessonState.demo` holds the demonstration: phase (`off`/`show`/`fade`), choreography (`swipe`, `swipeTap` = swipe up then tap shut, `tap` = press it shut, `pull` = drag and let go), what the ghost copies (`fold`, `tear`, `sling`, `peel` or `none`) with its index, the loop clock, and the pose (`fold`, `hand`, `glide`, `press`, `alpha`), all from the pure `sampleDemo`. `startDemo`, `stepDemo` and `cancelDemo` drive it.
  * **Game:** `beginDemo` runs on a lesson's first encounter and again when stamp or ballista moves to its tap step. The demo steps in real time and loops until the player acts. Any input (`touched`, `pullWeak`) cancels it with a 0.22 s fade. It never touches folds, enemies, stats or time: the lesson's own slow-mo and freeze run unchanged (a unit test runs one seed with and without demos and compares frame by frame). Once a step's demo has been seen through (`demoSeen`, per session), later encounters show only the hand. Across sessions the persisted `learned` decides, because a learned lesson never starts again. With reduced motion (the shake setting off, or `prefers-reduced-motion`, via `FoldEngine.setShake`) the demo plays once and then leaves the plain hand. `GameOptions.demos: false` turns it off.
  * **View:** `FoldView.ghost(t, alpha)` draws a guide-blue, ink-free (id 127), dithered copy of the flap, plus the wall's pop-up. It shares the real geometry, is built on first use, and is posed by the same `posePanels` as the real flap. `PageView` drives it for `demo.on === 'fold'`. The sling cup follows the demo's pull (in place of the idle tug), the tear cracks open to 60 %, and the peel corner lifts 30 %. `GhostHand` drops its CSS loop during a demo and is posed from the same numbers (`--hx`/`--hy`, `--press`, `--alpha`, with a press ring), so hand and paper move in lockstep. Ballista, crease and core demo the hand only.
  * **StarRibbon:** in short landscape (`max-height: 500px`, aspect ≥ 3/2) the band hangs in the empty desk column right of the book instead of over the top of the page. The responsive e2e now also checks it against the book's projected corners, at 844×390 too.
  * **Verification:** `pnpm type-check` is clean and `pnpm test` passes 2067/2067 (13 new in `tests/fold/demo.test.ts`). e2e with `E2E_PLAIN_ONLY=1` passes gameplay 8/8 (the swipe-lesson test now asserts the demo and that it clears), responsive 13/13 and book2 4/4.
