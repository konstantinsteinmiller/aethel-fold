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

* **Session 10** — roadmap #2, chapter select as a physical bookshelf on the desk.
  * **Logic** (`src/fold/logic/shelf.ts`, pure): one slot per book plus the coming book 3 (`SHELF.slots`), each `current` / `open` / `locked` / `coming` with its stars per rated page. The unlock rule `bookUnlockedBy` (book n opens once n − 1 is won, or n was already played) now also backs `useFoldProgress.bookUnlocked`. `shelfTarget` picks the glowing slot: the current book mid-run, the newly unlocked unwon book after a win. `slotAnchor` / `shelfToWorld` place the books from `SHELF` in `config.ts`, shared by the view and the ghost hand. Adding a slot kind later (Dragon Rush #16) or an `extras` object on the top board (secrets counter #15) needs no new plumbing; book 3 (#3) turns its silhouette into a book as soon as it is in `BOOKS`.
  * **Game:** `FoldGame.shelf` with the input API `setShelfProgress`, `setShelfInView`, `canOpenShelf`, `openShelf`, `closeShelf`, `toggleShelf`, `shelfTap` and `foldShut`, and the events `shelf`, `shelfSelect`, `shelfBook`. Out at the shelf the world's time target is 0 (sim time freezes, eased); folds keep settling in real time, `runTime`/`idle` and a cleared page's turn timer wait. The shelf appears after the first win; the victory page turns to it by itself after `SHELF.afterVictory` (6 s, once), and a right-to-left sweep across the won book (`gestures.ts` mode `shut`) folds it shut and goes there too. First tap on a book pulls it out, the second opens it: the current book closes the shelf and play continues (`shelfBook` b = 1), another book comes back to `FoldScene` as `shelfBook` b = 0 → `pickBook` → `startNewRun` + `FoldEngine.newRun` (the existing path). Mid-run the current book comes out pre-selected, so one tap goes back; tapping the open book on the desk goes back too. Locked books shake.
  * **Lesson `shelf`** (appended to `LESSON_IDS`, codes stable): out at the shelf the ghost hand taps the glowing book, then taps it again (tap demo); opening any book from the shelf learns it. On a page intro while unlearned it points the way once (`SHELF.cueTime`, no slow-mo, gives way as soon as an enemy is half-way down): at the HUD zoom button (`HandCue.anchor = 'zoom'`, resolved by `FoldScene`) or straight at the shelf where it is in view (`anchor = 'world'`, with height).
  * **View:** `ShelfView` — a leaning cardboard shelf, one box per book with one canvas texture each (spine art: number, frog/crane emblem, star sticker `x/15`, a ribbon on the current book; locked books are periwinkle silhouettes with a padlock, the coming book a dashed silhouette with "?"), and a star card that rises from a pulled-out book with its stars per page (`art/shelfArt.ts`, wordless). Each book has its own paper id and uses the highlight bit for the glow. `group.visible = false` while the shelf is not in the picture. Picking is view-level (`GameView.pickShelf`: nearest projected spine, or `SHELF_DESK`) and `FoldEngine` routes taps to the game's shelf API (every pointer while out at the shelf, and presses on a book where the play camera already shows it).
  * **Camera:** `DeskCamera` solves two poses on resize — `book` as before, and `shelf` (the shelf plus the upper right of the book, hung under the HUD, pitch lowered to 49°) — and glides between them in real time (`setShelf`, `shelfK`). `shelfInView` (judged against a fixed reference frame, so a HUD height change can't flip it) decides whether the zoom button is needed. The desk plane is subdivided: at the shelf pose's lower pitch the single 90-unit triangle pair inked its own diagonal.
  * **HUD:** the zoom button sits under mute + settings in the right column (`.hud-right` is now a column), only where the shelf isn't already on screen (portrait phones, tablets); it turns into "back to the book" while out. The victory card hides while the camera is at the shelf. Escape closes the shelf. The pause menu's 2D bookshelf face stays as the accessible fallback, and the victory card keeps its book buttons.
  * **Desk props:** crane and pencil moved clear of the shelf.
  * **Cost:** +8 draw calls while the shelf is shown (4 meshes × colour + shadow pass; +10 with the star card), 0 before the first win or when out of view (measured at 1280×720: 55 → 63). Nothing allocates per frame.
  * **Verification:** `pnpm type-check` is clean and `pnpm test` passes 2082/2082 (15 new in `tests/fold/shelf.test.ts`). e2e with `E2E_PLAIN_ONLY=1`: gameplay 8/8, book2 4/4, responsive 17/17 (4 new zoom-button checks at 320×658, 390×844, 658×320, 844×390), persistence 4/4, the new shelf spec 5/5; cloud-hydration 5/5 without the flag. book2's victory-card test failed twice in a full rerun: Playwright waited for the pulsing `attention` button to be "stable" while real frames ran the victory clock on until the shelf turned in and removed the card. It now clicks with `force` and passed 4/4 twice.

* **Session 11** — roadmap #14 (accessibility options) and #13 (instant-start pass).
  * **Settings:** `FoldSettings` in `aethel_state.fold_settings` gains `holdToFold`, `slowMode` and `highlightMode` (`standard` / `steady` / `bold`; `HIGHLIGHT_MODES` in `logic/types.ts`). Old saves read the defaults, garbled values are sanitised. Three new rows on the pause's settings face (switches for hold and slow, a select for highlight), strings in en and de; an e2e checks all nine rows fit without overlap at 320×658 and 658×320.
  * **Hold to fold** (`gestures.ts`): a still press of `HOLD_MS` (260 ms) on a ready fold (`FoldGame.pickFold`), a tear or exposed core, the boss crease or the peel corner takes hold, and holding carries it through in `HOLD_FOLD_MS` (650 ms), driven by `GestureRecognizer.frame(now)` on the real clock from `FoldEngine.frame`. Lifting early releases exactly like ending a swipe there (spring back below the snap threshold). Accessible equivalents: the two-finger spread becomes a hold on the crease; the sling becomes a tap where the stone should land (`FoldGame.slingAt`, only in this mode, only for taps that stamped or shot nothing); stamping and the ballista stay taps. No fold kind needs a gesture to unfold (lowering is automatic), so there is no "hold again". Swipes keep working. The ghost hand's hint names the hold (`fold.hint.hold*`, `slingTap`); its demo still shows the swipe. A unit test holds every fold in both books and covers all six kinds.
  * **Slow mode:** `FoldGame.worldScale` (`SLOW_MODE_SCALE` 0.75) multiplies sim time after `timeScale`, so it stacks with lesson slow-mo and the kind book's pacing; the player's own folds (dragging, snapping, stamping) and hit-stop stay on the real clock. Unit-tested: march ratio 0.75, product with difficulty and with a lesson crawl, hit-stop length unchanged, snap frames unchanged.
  * **Highlight:** composite uniforms `uHlSteady` (holds the pulse at a bright constant) and `uHlBand` (a halo band around every actionable silhouette: palette highlight inside, ink rim outside, width constant in CSS px through `FoldRenderer.setHighlight`). Bold = steady + band. No new colours.
  * **Boot telemetry** (`useBoot.ts`): `boot_ms` (navigation start → first frame rendered with input attached, marked from `FoldScene.onFrame`), `first_input_ms` (first press, `EngineHooks.onFirstInput`), the splash precompile time and path, and a timestamp per `BOOT` milestone. In memory only (no storage key; there is no generic analytics hook to feed); DEV console lines `[boot] …` and `window.__fold.boot()`. Unit test plus a gameplay e2e.
  * **Instant start:**
    * `main.ts` starts fetching the game chunk (`prefetchGame` in the router) at the top of the boot, so the three.js download and parse overlap the save hydrate and app mount.
    * `FoldEngine.prewarm()` runs behind the splash before `start()`: it dispatches the boot events (page 1 is built) and, where `KHR_parallel_shader_compile` exists, `compileAsync`s the whole scene into the MRT plus the composite and overlay (capped at 2 s). Without the extension (SwiftShader, some older browsers) a pre-frame compile only blocks the main thread longer, so it is skipped and the programs page 1 hasn't drawn (marchers, effects, shelf) are issued with plain `compile` in the first idle warm-up.
    * `scheduleWarm` now waits for the first press (or 6 s untouched) before any warm-up, then paints the atlas frames page 1 doesn't need and the next page in idle time.
    * The standee atlas paints only book 1's frames at boot; the crowd and book 2's runners and leapers (`DEFERRED`) are painted at idle, or at once on a book-2 `pageIntro` or on `victory`, before they can be seen. The cut-out now reuses one pair of scratch canvases. Measured in headless Chromium: 9.6 → 3.5 ms at boot (41 → 14 ms at 4× CPU throttle), the deferred part 3 ms (15 ms).
    * Shelf art was already lazy (spines paint only when the shelf is shown); there is no book 2 art beyond the atlas frames.
    * KTX2/Basis: not applicable. Every texture is painted on a canvas at runtime and no atlas image ships on the hot path (`public/images/fold/units/manifest.json` lists no images, and nothing calls `StandeeAtlas.loadOverrides`), so there is nothing to transcode and no transcoder was added.
    * Numbers (production build, `vite preview`, headless Chromium on SwiftShader, 412×860, 6 warm runs each, interleaved): `boot_ms` median 934 → 890 ms unthrottled and 2050 → 1990 ms at 4× CPU throttle. The change is within this machine's noise. SwiftShader JIT-compiles shaders per draw state at the first draw, which no precompile can move, and it has no parallel compile, so the splash-time `compileAsync` only pays off on real GPUs. The first frame (~400–500 ms here, mostly that JIT) is the bulk of `boot_ms` on this rig.
  * **StarRibbon vs shelf:** in short landscape with a book won, `FoldScene` sets `--ribbon-room` (HUD bottom → the shelf top as drawn, `GameView.shelfTop`, computed from `ShelfView.extras`) on each page clear, and the ribbon's stars shrink to fit above the shelf. A new responsive e2e checks it at 658×320 and 844×390. The old "star ribbon stays clear of the HUD" check was flaky at 658×320 (it measured after a fixed 1.5 s, and SwiftShader's frame rate decided how far the CSS animation had got). It now freezes the ribbon mid-hang (`settleRibbon` in the e2e helpers) and passed 9/9 in a row.
  * **Verification:** `pnpm type-check` is clean; `pnpm test` 2105/2105 (18 new in `tests/fold/accessibility.test.ts`, 3 in `bootTelemetry.test.ts`, 2 new settings-hydrate cases). e2e with `E2E_PLAIN_ONLY=1`: gameplay 10/10, responsive 21/21, shelf 5/5, persistence 5/5, book2 4/4; cloud-hydration 5/5 without the flag.

* **Session 12** — roadmap #16 (Dragon Rush), #15 (page secrets), and the hold-to-fold demo fix.
  * **Boss timing multiplier** (`boss.ts`): `Boss.timing` (default 1, kept by `resetBoss`) and `bossTiming(b, key)` = `BOSS[key] × timing` for the paced timings (`BOSS_PACED`: rumble, unfold, roar, idle range, breath charge, breath, stomp; the breath and stomp strike points scale too). The player's windows (exposed, hurt, collapse) keep their length. `bossClock(b)` gives the views (`DragonView`, `CastleView`) authored seconds, so a faster dragon plays the same moves faster. Proof of "1 = no change": a golden trace (every boss phase change, breath, stomp, heart lost and clear, with frame, timer and aim, both books, with and without the bot) recorded from the code before the multiplier existed, and replayed bit-for-bit in `tests/fold/rush.test.ts`.
  * **Dragon Rush** (`logic/rush.ts`, `RUSH` in config): `FoldGame.startRun({ mode: 'dragonRush', book })` (the positional form still works) starts on the book's dragon page (`bossPageOf`; both books' boss is the dragon — book 2's with `bossPace` 0.85 and its runner/leaper stomps), with `RUSH.timing` 0.7. The clock (`FoldGame.rush`) runs in real time on the dragon page (hit-stop included; pauses and the shelf not; slow mode slows the world, not the clock) and stops when the last weak point breaks; the collapse then ends in `rushOver` with `rushDone` instead of stars and the finale. A rush reads and writes no kindness memory (difficulty 1, no extra marchers, no crumple count, no boss ease), no checkpoint, no stars, no banked score. A defeat offers the Almost! Try again as a quick retry that always drops a fresh dragon and a fresh clock (`RUSH.autoRetry` 4 s by itself). Par: 65 s (book 1) and 60 s (book 2) — the frame-perfect bot takes 47–48.5 s and 44.4–45.2 s over eight seeds (it lost twice to the book-1 dragon); a test keeps it ≥ 20 % under par.
  * **Entry points:** a Dragon Rush button on the victory card, and one folded dragon figurine per book on the shelf's top board (`ShelfSlotKind 'rush'`, slots after the books, `hidden` until that book is won). Tapped like a book: the first tap hops it up and raises a card with the best time (stopwatch) and the par (pennant), the second starts the rush inside the game (no host round-trip). The HUD's score tag becomes `RushClock` (turns red past par); `RushResult` shows time, par, best, "New best!" / "Under par!", Rush again, and Back to the story (the saved page, as the save has it). A new best goes to `aethel_state.fold_rush` (`{ b1: 58.3 }`) with `flushSaveNow`.
  * **Page secrets** (`logic/secrets.ts`, `SECRET` in config): twelve, one per page; never required, never highlighted, no lesson or hand. Triggers are pure logic on the input API — `tap` (never eats the tap), fold snaps, sling impacts, and `tapLamp` for the desk. A tap target standing off the page (hero, windmill, tree, frog) is mapped by the view to where it appears (`secrets.spotX/Z`, like the tear anchors). A find emits `secret` (a = code, b = 1 the first time ever); the first time pays `SECRET.bonus` (250), kept out of the page's star rating; a replay only shows off. Saved as `aethel_state.fold_secrets` (id list) through `recordSecret` (flushed). Book 3 adds six entries to `SECRETS`; every counter derives from the list.

    | Book · page | Secret | Trigger | Reward |
    |---|---|---|---|
    | 1 · 1 (desk) | lamp | tap the desk lamp behind the book (any page) | night mode on/off (periwinkle dusk, warm pool; `fold_settings.night`) |
    | 1 · 2 Ravine | boat | fold the ravine three times on one visit | a paper boat sails down it, AHOY! |
    | 1 · 3 Siege | fling | flip both catapult flaps within 1.2 s | fireworks over the battlement, DOUBLE FLING! |
    | 1 · 4 Gates | moat | a sling stone into the moat | splash |
    | 1 · 5 Core | nap | tap the castle core 3× before the dragon wakes | ZZZ… |
    | 1 · 6 Frog | hop | tap the folded frog 3× | a big spinning hop |
    | 2 · 1 Home | wave | tap the hero 3× | he waves (cheer), HELLO! |
    | 2 · 2 Orchard | apples | tap the big apple tree by the keep 3× | apples fall, PLOP! |
    | 2 · 3 Mill | whirl | tap the windmill 3× | the sails whirl, WHOOSH! |
    | 2 · 4 Camp | campfire | tap the enemy campfire 3× | sparks, CRACKLE! |
    | 2 · 5 Return | bonk | a sling stone on the dragon before it wakes | BONK! |
    | 2 · 6 Crane | flap | tap the folded crane 3× | a loop with fast wingbeats |

  * **Counters:** a standing card with a sparkle and "found/12" on the shelf's top board (`ShelfView.extras`), and "Secrets found: N/12" on the pause bookshelf face.
  * **Night mode:** composite uniforms `uNight` (eased by `GameView`), `uNightTint`/`uNightLamp` from the new palette tokens `night` and `nightLamp`, the pool centred on the page. The HUD is untouched.
  * **Desk lamp:** `deskLampGeometry` at `DESK_LAMP` (behind the page's top edge, right of centre — on screen at every aspect, never over the page), picked in screen space (`GameView.pickLamp`) and routed by `FoldEngine` like the shelf. Its own paper id, never the highlight bit.
  * **Merge:** `carryStars` now also carries the union of found secrets and the faster rush per book into the winning blob.
  * **Hold-to-fold demo (C5 fix):** a `hold` demo choreography (`lessons.ts`): the hand lands on the flap and stays; after `DEMO_HOLD_WAIT` (the gesture's `HOLD_MS`) the ghost folds up steadily over `DEMO_HOLD_FOLD` (`HOLD_FOLD_MS`). `FoldGame.holdToFold` (set with the gesture setting) switches the demo of every lesson whose hint names the hold (`HOLD_DEMO_LESSONS`); `GhostHand` drops the trail and fills a dashed press ring with the fold.
  * **e2e plumbing:** `E2E_PLAIN_ONLY=1` is now implemented in `playwright.config.ts` (the plain server only), and `E2E_PORT` / `E2E_CG_PORT` move the servers to private ports.
  * **Cost:** the shelf gains up to three meshes (two figurines, the counter card): up to +6 draws while it is shown, 0 when out of view. The lamp is one mesh (+2 draws). Nothing new allocates per frame.
  * **Verification:** `pnpm type-check` is clean; `pnpm test` 2156/2156 (41 new: 15 in `tests/fold/rush.test.ts`, 17 in `tests/fold/secrets.test.ts`, 7 in `tests/save/SecretsRush.test.ts`, 2 hold-demo cases in `demo.test.ts`). e2e with `E2E_PLAIN_ONLY=1` on a private port: gameplay 11/11 (new: the lamp secret, night mode across a reload), book2 4/4, shelf 7/7 (new: Dragon Rush from the victory card to the result and back to the story; from the shelf figurine, with a loss and the quick retry), persistence 5/5, responsive 25/25 (new: rush clock and result card at 320×658 and 658×320); cloud-hydration 5/5 without the flag. First responsive run: the rush-card check measured mid drop-in and waited on the pulsing button being "stable"; fixed in the test, then 25/25.

* **Session 13** — roadmap #6 (unlockable paper cosmetics), #17 (seasonal page skins), and three C6 follow-ups.
  * **Logic** (`logic/cosmetics.ts`, pure): `COSMETICS` — page papers, hero variants and confetti cuts, each unlocked by the star total over every book (30 in books 1–2). Defaults are always owned and never stored.

    | Stars | Unlocks |
    |---|---|
    | 0 | parchment paper, classic hero, square confetti (defaults) |
    | 3 | graph paper |
    | 5 | star confetti |
    | 8 | hero scarf |
    | 11 | washi paper |
    | 14 | heart confetti |
    | 17 | hero royal sash |
    | 20 | newsprint paper |
    | 23 | crane confetti |
    | 26 | old-map paper |
    | 30 | hero crown (every page at ★★★) |

    `readCosmetics` sanitises (unknown ids dropped; an equipped item that isn't owned falls back to its default), plus `unlockedBy`, `newUnlocks`, `withUnlocks`, `equip`, `mergeCosmetics`, `nextUnlock`.
  * **Seasons** (`logic/seasons.ts`, pure): `seasonFor(date)` by local calendar day — Halloween 15 Oct–2 Nov, Winter 10 Dec–6 Jan (inclusive, the window wraps the year); `activeSeason(date, enabled, override)`. Art only: nothing in the game reads it.
  * **Save:** `aethel_state.fold_cosmetics = { owned, equipped: { paper, hero, confetti } }` through `useFoldProgress` (`cosmetics`, `unlockCosmetics`, `equipCosmetic`; an equip is flushed). A page clear calls `unlockCosmetics` right after `recordStars`, before the checkpoint's flush. At boot and on a late hydrate, stars from another device unlock quietly (no cue). `fold_settings.seasonal` (default on; old saves read on). Merge: `carryStars` also carries the union of owned; the winner keeps its equipped items where the union owns them. No new localStorage key.
  * **Page papers** (`paintPage(page, { paper, season })`): each paper has its own palette stock (`washi`, `graphPaper`, `newsprint`, `mapPaper`) and a pale print under the illustration (grid, seigaiha waves and kozo fibres, columns of grey type, contours and a graticule), plus a faint veil of it on top (≤ 0.12 alpha), so lanes, folds and marchers keep their contrast. The paper motifs draw from a second random stream, so the page's layout is the same on every paper. The under-flap layer carries the same motif (fibres, type lines, contours or a finer grid) in place of the blueprint grid, so a raised flap shows the paper it was cut from.
  * **Seasonal skins:** Halloween: a plum-to-pumpkin dusk wash, printed pumpkins and bats and two cobwebs, all off the lanes (`offLane`); every cone-roofed tower of the player's castle becomes a carved pumpkin with a gold face (`seasonCastleGeometry`, one extra mesh on the castle material); six plum paper bat standees in slow loops beside the page's long edges (`BatsView`, one instanced draw on the atlas, no shadow). Winter: snow paper (plain paper prints on snow white, a snow veil, drifts and flakes off the lanes), snow caps on the castle's roofs, keep, towers and walls, snow on the scenery (upward facets and pine caps, `snowyGeometry`), and a scarf on the hero whatever he wears. New palette tokens only (`duskOrange`, `duskPurple`, `pumpkin*`, `bat*`, `snowShade`, `iceBlue`, `scarfRed*`, `sash*`); shadows stay periwinkle and ink stays ink.
  * **Hero and confetti:** the hero's five atlas cells are painted in the equipped look (scarf, sash, crown instead of the plume) at boot in place of the classic ones, at the same cost; `StandeeAtlas.setHero` repaints them (0.9 ms). The Halloween bats have their own two cells, painted only by the idle warm-up after the first press (`paintSeason`), never at boot. `Effects` builds all four confetti cuts up front (squares, stars, hearts, cranes; about the classic chip's size) and swaps the one instanced mesh's geometry: the same material and program.
  * **Repainting without a hitch:** `FoldEngine.setLook` → `GameView.setLook` swaps the confetti at once; the rest runs in `applyLook` from a `requestIdleCallback`: hero and bat cells, a hidden prebuilt page reprinted (like the warm-up that built it), and the page in play reprinted only while the game is paused. Equips and the seasonal switch happen on the pause's settings face, so the ~15–30 ms reprint lands behind the menu. Otherwise (the DEV `setSeason` mid-play) the page in play keeps its paper until the next page is built, and the next pause reprints it.
  * **UI:** the settings face gains a "Seasonal decorations" switch and a "Paper & style" picker: the star total, and a row of swatches per kind (`CosmeticSwatch`, palette colours; locked ones are periwinkle silhouettes with a star badge, never black), names in en and de. The unlock cue (`UnlockCue`, in `FxLayer`): a taped paper sample with the new swatch(es) and a sparkle drops in where the star ribbon hung, right after it lifts, then folds away; wordless.
  * **DEV:** `?season=halloween|winter|none` (before or inside the hash), `__fold.setSeason(s | null)`, `__fold.equip(id)`, `__fold.look()`, and `__fold.boot().paint` (atlas paint times: boot, deferred, season, hero).
  * **C6 follow-ups:** (1) Home: a tap within `SECRET.heroClear` (0.6) of the hero secret's reach counts for his wave and no longer looses a ballista bolt past him; the rim and everywhere else still fire (`tapOnSpot`, unit-tested). (2) The Siege's catapult flaps were single-use, so a missed "fling" couldn't be tried again on the same visit. They now re-arm (5 s, like book 2's); a unit test misses once, waits for both flaps to come back by themselves, and finds it. Page 3 gets a little more forgiving (more launches available); every star and bot test passes unchanged. (3) `GameView.shelfTop` now includes the shown figurines and the secrets card on the top board (their world bounds), so in short landscape the star ribbon, and the unlock card, which uses the same `--ribbon-room`, fit above them.
  * **Cost:** Halloween +3 draw calls (castle dress + its shadow, the bat flock), Winter +2, programs unchanged (measured at 412×860 on page 1: 54 / 57 / 56 draws, 20 programs). Nothing new allocates per frame.
  * **Boot budget** (headless Chromium, SwiftShader, dev build, median of 9): standee atlas at boot 4.0 ms before → 3.8 ms after (crown and winter scarf: 3.3 ms; the same 15 cells); deferred frames 4.2 → 2.7 ms; the bats 0.1–0.4 ms, off the boot path (e2e asserts `atlasSeason` = 0 until the first press). `paintPage` for page 1 takes ~15–20 ms plain and ~13–25 ms on every paper and season. A long benchmark loop hit 0.7–9 s GC stalls from its own piled-up canvases, on every look alike; in the game one page lives at a time.
  * **Verification:** `pnpm type-check` is clean; `pnpm test` 2190/2190 (34 new: 12 in `tests/fold/cosmetics.test.ts`, 7 in `seasons.test.ts`, 4 in `pageArt.test.ts` — every page × paper × season and every hero look painted into a recording canvas that fails on any non-finite number, 8 in `tests/save/Cosmetics.test.ts`, 3 C6 cases in `secrets.test.ts`; 3 expected settings objects in `AethelStateCloudHydrate.test.ts` gained `seasonal: true`). e2e on a private port with `E2E_PLAIN_ONLY=1`: the new cosmetics spec 4/4 (equip paper, confetti and hero on the settings face, the page reprinted behind the menu, kept across a reload; the unlock card after a page clear; `?season=` screenshots of none, Halloween and Winter with the page's mean colour compared and the bats waiting for the first press; the seasonal switch off and on under a pinned October date), responsive 27/27 (new: the picker at 320×658 and 658×320; the settings face has 10 rows; the ribbon-vs-shelf check now runs with the rush figurine standing), gameplay 11/11, book2 4/4, shelf 7/7, persistence 5/5; cloud-hydration 5/5 without the flag.

* **Session 14** — roadmap #3: Book 3, "The Sea of Paper" (GDD §13, written first).
  * **Book 3** (`BookId` 3, `BOOKS[3]`, `BOOK_COUNT` 3, `asBookId`): unlocked by winning book 2 (`bookUnlockedBy`, unchanged rule); its shelf slot is a real book with a paper-boat emblem on a sea-blue spine; winning book 2 moves the bookmark to book 3. The keep, sling and both ballistas stand on every fighting page; the top of each page is the sea the enemy wades out of (no structure across the top, so lanes spawn at the top edge). No new enemy type — the boat and the pleat already change how a column is answered; a sea enemy would have cost atlas frames and a rule without a new decision.

    | Page | Theme | Mechanics | Enemies | Par | Secret |
    |---|---|---|---|---|---|
    | 1 The Harbour | harbour | boat (lesson), walls | knights, runners, a brute | 4050 | regatta: sail the boat 3× |
    | 2 The Tide Flats | marsh | pleat (lesson), walls | knight columns, runners, brutes | 4750 | tidepool: a sling stone in the pool |
    | 3 The Lighthouse | lighthouse | boat, pleat, shield, launch flap | archers, catapult, knights, runners, brute, leaper | 5050 | beacon: tap the lighthouse 3× |
    | 4 The Shipyard | shipyard | boat, pleat, two launch flaps, shield, walls | catapults, leapers, runners, brutes, knights | 8500 | shipshape: boat + pleat together |
    | 5 The Deep | deep | the kraken; shield, walls | slam boarders (knight, runner, brute) | 16000 | tickle: tap its eyes 3× asleep |
    | 6 Calm Water | finale | fold the kraken into a fish | — | 2000 (unrated) | jump: tap the fish 3× |

  * **Boat** (`folds.ts`): the fold's line is a channel (`depth` = half-width); marchers in it wade at `BOAT.wade` (½) of their pace. The dock flap (the first `BOAT.dock` units; the only place `pickFold` takes hold) folds into a paper boat; `up`, it sails out and back over `BOAT.voyage` sim seconds (`sail`, `boatAlong`), and everyone marching in the water within `BOAT.reach` of its bow capsizes (`boatReaches`, `KILL_CAPSIZE`, a growing multi-kill chain, `capsize` event). Leapers in the air pass over. Then it unfolds at the dock and cools down. (The roadmap's "carries the hero across" became "clears the crossing": the hero never leaves his keep.)
  * **Pleat**: an accordion strip down a lane in `creases` (4) sections. Section k is shut once `t·n ≥ k+1` (`pleatShut`); while dragged, `t` follows the finger (the gesture's progress runs the strip's length, `0.85 × len`), so sections shut as the finger passes them; released past the threshold, the rest shut at a steady `PLEAT.sectionTime` each (never two in a frame). Each newly shut section crushes whoever stands on it (`pleatSectionAt`, a stamp crush with the chain's multi-kill bonus, `pleat` event); springing back crushes nothing. Shut, it waits `PLEAT.hold`, unfolds, cools down.
  * **Kraken** (`logic/kraken.ts`, pure): its own machine on the shared `Boss` record (`kind: 'kraken'`, `resetBoss(b, kind)` swaps the weak-point layout in place): dormant (eyes above the water) → surface → roar → idle ⇄ (inkCharge → ink | slam) → exposed (a tentacle lies across the page, crease glowing) → hurt … → collapse → flat. `stepKraken` returns flags; the game carries out the ink (blocked by a raised shield like the breath; `bossBreath` with b = 1), the slam (boarders spilled at `KRAKEN.slamZ`, in front of the mantle, on the lane under the slam; `bossStomp`) and the page clear (`bossBeaten`, now shared with the dragon). Weak points: four tentacle creases, then the mantle's core; sling stones on the mantle flinch it, three bare the next weak point, one during the ink charge chokes it. New `BossPhase` codes are appended (`surface`, `inkCharge`, `ink`, `slam`). Paced timings are `KRAKEN[key] × timing` (`krakenTiming`, `krakenClock`), so book 3's **Kraken Rush** is the reserved rush slot: par 60 s (bot 43.0–44.1 s over eight seeds); a kraken figurine on the shelf's top board (rush figurines moved to x −0.45 / 0.5 / 1.45, the secrets card to −1.55). The book 1/2 golden boss traces are unchanged; a new kraken trace test proves timing 1 is bit-for-bit the un-multiplied machine.
  * **Views**: `FoldView` — the boat's dock panel lifts and shrinks as `paperBoatGeometry` grows at the dock, then rides the channel; the pleat is 2 × n half-panels posed as ∧ sections bunching toward the fixed bottom edge (they cast no shadow: see cost); both get demo ghosts. `KrakenView` — a faceted mantle and eight five-segment arms as two instanced meshes (every arm; the exposed arm again in a highlighted material), a crease strip, siphon and weak-point glows; anchors and the siphon feed `GameView` through `PageView.boss` (dragon or kraken). `FinaleView` 'fish' (the kraken's violet sheet folds into a leaping paper fish). Five new painters (`harbour`, `marsh`, `lighthouse`, `shipyard`, `deep`: sea along the top, roads from the beach, channels with stepping stones and a pier, pleat crease notation, a boat-crease dock flap), a lighthouse model with a flashing lamp, coastal props kept out of the sea. Palette tokens only (`sea*`, `sand*`, `kraken*`, `inkJet` — plum ink, never black, `lighthouse*`, `fish*`, `chart*`, `sailor*`). Ink and fire jets now reuse one options object (`Effects.flame` no longer allocates per frame).
  * **Lessons**: `boat` and `pleat` appended to `LESSON_IDS` (codes stable), triggered by a column wading the channel / two marchers on the strip, with swipe demos on the flap (hold demos with hold to fold), freeze rules, completion on the snap, idle hints; the hint strings are in en and de.
  * **Secrets**: six appended (`regatta`, `tidepool`, `beacon`, `shipshape`, `tickle`, `jump`); every counter reads 18.
  * **Cosmetics decision**: stars now total 45. The old thresholds stay exactly as they were (books 1–2 still unlock everything they did; `owned` never shrinks), and book 3 adds three unlocks above them: sea-chart paper (35 ★: rhumb lines and soundings, under-flap print too), the sailor hero (40 ★: cap and collar, repainted by `setHero` only when equipped) and fish confetti (45 ★). Swatches and names in both locales.
  * **Save**: `fold_cleared3`, `fold_best3`, `fold_wins3` inside `aethel_state` (no new localStorage key); `asBook`/`savedBook` accept 3; the merge score counts book 3's pages and win (`maxStage` too); `b3p<n>` star keys, the `b3` rush best and book 3's secrets flow through `readStarRecord`, `carryStars` and the refs; `recordVictory(book)` moves the bookmark to the next book. DEV: `__fold.jumpTo(page, 3)`, `__fold.startRush(3)`.
  * **UI**: pause bookshelf with three rows (book 3 locked until book 2 is won), victory card (fish, book 3's lines, "Book 3: The Sea of Paper" after book 2, Kraken Rush), rush result title, boss meter "Kraken", fish and kraken origami icons.
  * **The kraken's look** (owner's art direction, "scary but cute"): a chunky rounded dome head (7 large facets a ring, pastel coral with teal spots), oversized eyes (white, glossy deep-sea-blue pupil, paper highlight), heavy periwinkle brows that fold down into a glare in the telegraph and lift into a surprised, sad look when hurt (the face tips toward the lens), a small pouty beak that opens for the ink (the jet leaves from it), stubby curling arms of chunky domed segments with rows of paper suction cups (geometry, not a texture: the arms share the props' instanced program). A cheeky squash-and-stretch idle bob; before every attack it rears up 16 % bigger and higher, glaring, its eyes glinting. Palette tokens only (`kraken*`: coral, light, sucker, eye, pupil, brow, beak, teal); the ink stays plum. The icon, the shelf figurine and the rush card follow. Before/after shots (idle, telegraph, exposed, hurt) at 390×844 and 320×658 are in the session's scratch area.
  * **Cost** (412×860, SwiftShader, main + shadow + composite, one frame after 3 s): book 3 pages 72 / 84 / 98 / 115 draws, the kraken page 81 (the dragon pages: 147 book 1, 153 book 2; the busiest book 1–2 page, 1·4: 117), the finale 50; 20–22 programs (unchanged from books 1–2: the kraken's arms, the snow and the fish confetti all reuse existing material variants). Pleat panels cast no shadow, which saved 16 draws on a pleat page (131 → 115 on the Shipyard).
  * **Winter made visible** (owner's request; roadmap #17 follow-up, all books): the warm lamp multiplied blue by ~0.7, so any snow read as cream. In Winter the desk lamp now eases to a crisp cool daylight (`lampWinter`, `paperGlobals.uLampColor`, restored warm on dispose), and the page is snowed over: a cool snow-paper veil (`snowPaper`, 0.6) painted on its own sheet with the lanes and boat channels cut out of it (roads, bridges and water keep their contrast), deep snow banks along both long edges and ~50 drifts over the meadows, each a bright bank with a periwinkle-blue edge and underside (`snowBank`, `snowEdge`; never on a lane, a channel or the sea), and bolder printed flakes. Thicker caps: the castle's roofs (most of each cone), heaped tops on the keep, towers and walls, the house roofs; every prop and pop-up (tower, walls, shields: `FoldView.setWinter`, a geometry swap) snows on facets facing up to 55° and gets a thick cap on the pine's tiers and the tower's roof. Falling snow (`SnowView`): 180 paper flakes, one instanced draw, no shadow, ink-free (id 127), in the confetti's material variant; 60 on the "fast" graphics setting, 45 falling slowly with reduced motion; hidden at the shelf; zero per-frame allocation. Measured (412×860, the page's middle): the mean colour moved by ~120 against ~33 before, blue minus red by ~110 against ~20, and 73 % of the pixels read as snow (plain parchment: 0 %; the old Winter: ~0 %); the cosmetics e2e now asserts all three. Cost: Winter is +3 draws on every page (castle dress and its shadow, and the snow), +1 over before; no new program.

  * **Verification**: `pnpm type-check` clean; `pnpm test` 2242/2242 (new: 38 in `tests/fold/book3.test.ts` — boat and pleat rules, the kraken machine, timing ×1 trace, pars, the bot clearing all six pages at ★★★ and the whole book to VICTORY, lessons, secrets; 9 in `tests/save/Book3Progress.test.ts`; the hold-to-fold test now covers every fold kind of all three books; 4 in `tests/fold/winter.test.ts`). e2e (`E2E_PLAIN_ONLY=1`, private port): book3 6/6 (new), gameplay 11/11, book2 4/4, shelf 7/7, persistence 5/5, cosmetics 4/4, responsive 29/29 (new: the three-book pause shelf at 320×658 and 658×320); cloud-hydration 5/5 without the flag.

* **Session 15** — roadmap #17 (interstitials), #9 (rewarded Try again) and #19 (rewarded second chance), all behind a build flag and off for the jury. **The jury build is the itch.io build** (`pnpm build:itch`, `.env.itch.example`); ads are off there, so A3's "no ads" still holds for it. Other platforms are unchanged: ads only where an ad SDK exists.
  * **Flags** (`src/platforms/adFlags.ts`): `VITE_APP_INTERSTITIALS` and `VITE_APP_REWARDED`, honoured only on platforms with an ad SDK (CrazyGames — full release only, GameDistribution, Playgama, GamePix, GameMonetize, Yandex). Itch.io (the jury build), plain web, Glitch and Wavedash ignore them. The build constants compare `import.meta.env` literals, so on those builds the ad paths fold away: the jury (itch.io) bundle has no ad-UI chunk and none of the pacing code (checked by grepping the `vite build --mode itch` output, with both flags forced on; the plain default build likewise). Every `.env.*.example` states both flags.
  * **Policy** (`src/use/ads/foldAdPolicy.ts`, pure): no ad of any kind before 180 s of lifetime playtime (`aethel_state.fold_playtime`, counted only while live and only by ad builds, through `useFoldProgress.addPlaytime`); ≥ 121 s between interstitials, and a watched rewarded ad restarts that gap. An interstitial is requested on page clear, boss clear (the dragon or kraken page's `pageCleared`) or a story crumple, and shown at the next calm point — the next page's intro 0.2 s after it drops (the sheet has landed, and no wave has marched yet: every page's `introDelay` is ≥ 0.4 s, which a unit test pins), or the crumple between the ball going and the Try again coming up — never during a lesson, a fold or sling in the hand, the shelf, the pause, a second-chance hold or a rush (Dragon or Kraken Rush: both are `mode: 'dragonRush'`); a request that finds no calm in 8 s, or has no fill, is dropped. The ad holds `isAdShowing`, which pauses the sim, mutes audio and sends the platform its gameplayStop/Start.
  * **#19** (`FoldGame.setSecondChance` / `restoreHeart` / `declineSecondChance`, events `lastChance` / `heartRestored`, `SECOND_CHANCE` in config): with the offer switched on by the view, the last heart holds the world (phase clock included, inputs off) for 6 s real time; a watched ad gives one heart back with the Try-again grace, anything else crumples as before. Once per page (a retry of the same page doesn't bring it back), never in a rush. Capped by `useRewardedThrottle` through `isRewardedReady`.
  * **#9**: after the grace the Almost! Try again becomes a movie-marked rewarded button (`RewardedRetry` in `AlmostRetry`'s `action` slot) when the retry is a real continue; a skip or no fill falls back to the plain button. **One ad per death:** after a second-chance offer (taken or not) or a crumple interstitial, that death's Try again is plain, and a turned-down offer suppresses the crumple interstitial.
  * **UI:** `SecondChanceOffer` (title, a countdown strip that stops with the pause, "+1 heart" video button, "No thanks"), one row in short landscape; `OrigamiIcon` gains `movie`. Strings `fold.ads.*` in en and de. Both components are lazily imported behind `REWARDED_ADS`.
  * **Tests:** `pnpm type-check` clean; `pnpm test` 2257/2257 (new: `tests/fold/secondChance.test.ts` 10, `tests/platforms/foldAdPolicy.test.ts`, `foldAdFlags.test.ts` (the per-template matrix and the build constants), `useFoldAds.test.ts` 10, `tests/ui/foldAdsUi.test.ts` 3 — FoldScene mounted with a stand-in engine: the jury (itch.io) config, flags forced on, and the plain default config both render only the plain button and no card even with a provider claiming ads are ready). e2e `ads.spec.ts` (third dev server on `E2E_ADS_PORT`, CrazyGames full release + both flags, fake SDK recording `requestAd`): the plain default build shows no ad UI; interstitial after a page clear with the game paused under it, and none inside the 121 s gap; nothing inside the grace; second chance → heart back → rewarded Try again → 3 hearts; both cards inside 320×658 and 658×320 and clear of the HUD. e2e on private ports: ads 6/6 (twice), gameplay + persistence 16/16, responsive 27/27 (`the rush clock and result card fit at 658×320` failed once and passed on rerun; untouched by this change), cloud-hydration 5/5 without the flag.
  * **Merged with Session 14 (Book 3)**: book-agnostic as written. The kraken's ink reaches the hero through the same `hurtHero`, so the kraken page's last heart gets the second-chance offer like any story page; Kraken Rush is `mode: 'dragonRush'`, so no offer and no interstitial there; the calm-point rule (intro only, never boss / lesson / rush) covers the kraken page and the boat and pleat folds (`dragging`); every Book 3 page's `introDelay` (≥ 0.4 s) passes the intro-window test. Two new cases in `secondChance.test.ts` (kraken ink takes the last heart → offer → `restoreHeart` carries on; never in a Kraken Rush); `boat`/`pleat` added to its all-learned set. Owner clarification folded in: the jury build is the itch.io build, and `foldAdsUi.test.ts` / `foldAdFlags.test.ts` now pin the itch config (flags forced on) plus the plain default. After the merge: `pnpm type-check` clean; `pnpm test` 2313/2313; e2e (private ports, `E2E_PLAIN_ONLY=1`): gameplay 11/11, book3 6/6, persistence 5/5, responsive 29/29; ads 6/6 (`E2E_ADS=1`; a later rerun had one failure, the next two runs 6/6); cloud-hydration 5/5 without the flag. `vite build --mode itch` and the plain build with both flags forced on: no ad-UI chunk, no ad test ids.

* **Session 16** — C13: the Poki build ("the Poki build also shows ads").
  * **Plugin** (`src/utils/pokiPlugin.ts`, `src/platforms/poki`, `src/use/ads/PokiProvider.ts` + stub aliased over it on every other build): injects `game-cdn.poki.com/scripts/v2/poki-sdk.js`, `PokiSDK.init()` in parallel with boot (a rejection — the ad-blocker case — is logged and the game carries on; rewarded breaks then report unavailable). `gameLoadingFinished()` once, on FLogoProgress's splash-resolved edge (the same one as CG `loadingStop`, Playgama `game_ready`, GamePix `gameLoaded`, Yandex `ready`). `gameplayStart/Stop` from `useGameplayLifecycle`'s fan-out, paired in the plugin (never repeated, a start held until loading has finished). `commercialBreak(onStart)` is the interstitial and `rewardedBreak()` the rewarded ad (true only on `true`; false / throw → false); both stop gameplay first, and `useAds`' `isAdShowing` gate pauses the sim and mutes the audio for the break.
  * **Live play, all portals:** FoldScene's `live` now also excludes a crumpling page and a second-chance hold (it already excluded the pause, ads, shelf, victory and rush result cards), so every portal's gameplayStop brackets game-over. An intro or outro cutscene added later must join `live` the same way.
  * **Decisions:** Poki throttles commercial breaks itself and asks games to call them at every natural break; we keep our 3-minute first-time grace and 121 s gap on top (the owner's rule; stricter than Poki's never violates it, at a small revenue cost). No site-lock (Poki serves from several CDN domains): the render gate is flag-only. Saves: `LocalStorageStrategy`. The Poki CSP carries only Poki's and its ad partners' origins, so no other portal's hostname appears anywhere in the bundle; `getPlattformText()` is empty; there are no outbound links.
  * **Config:** `.env.poki.example` (ads on), `VITE_APP_POKI` in `.env.example`, Poki in `AD_PLATFORM_ENV_KEYS`, `build:poki` (already in `package.json`, same shape as the other zip builds).
  * **Tests:** `tests/platforms/poki.test.ts` (17: init once / rejected / script blocked, gameLoadingFinished once, start/stop pairing and hold, lifecycle fan-out, break mapping with false and throwing results, provider readiness, resolver, localStorage save, CSP without other portals, no site-lock, no portal text); the flag matrix gains `.env.poki.example`. e2e `poki.spec.ts` (fake PokiSDK, E2E_POKI=1 on E2E_POKI_PORT): boot order and pairing around the pause, a commercialBreak after a page clear with the game paused, the second chance through rewardedBreak. Results: type-check clean, `pnpm test` 2276/2276; e2e poki 3/3, ads 6/6, gameplay 11/11 (private ports). `vite build --mode poki` bundles the SDK URL and all five Poki calls, with no other portal hostname in index.html; the itch build has no ad call site (commercialBreak, rewardedBreak, requestAd, the ad test ids and chunks all absent).

* **Session 17 (C9b)** — boss outro cutscene after each story boss, books 1–2 (merged after Book 3 and the ads session: interstitials are never polled while the outro or the intro plays, and FoldScene's `live` (platform gameplayStart/Stop, Poki included) is false during either; book 3 has no outro script yet, so its victory card shows straight away; the dolphin outro is deferred).
  * **Placement:** the finale fold (frog / crane, `FINALE_TIME`) → `victory` (the host records the win and `flushSaveNow`s it, as before) → the outro starts in the same frame, after that event → the victory card waits for the outro's end → `SHELF.afterVictory` (6 s) after the *card* the camera turns to the shelf. So the outro never fights the finale's fold (finished) or the card (held back), and a skip or a reload mid-outro never loses the win. Dragon Rush never gets there (`rushOver` and its own result card); `startOutro` also refuses a rush.
  * **Logic** (`logic/cutscene.ts`, pure, reusable for the C9 intro): `CutsceneRunner` plays a `CutScript` — a timeline of beats `camera` (a framing relative to the play pose: zoom, orbit, pitch, focus shift, duration), `crowd` (actor, page edge, count, stagger), `fireworks` (count, gap, page rectangle, tint), `cheer`, `end` — in real time. Events: `outro` (a = 1 start / 0 end, b = 1 skipped), `outroBeat` (a = beat index, b = 1 fired by the skip), `firework` (a = slot, b = 0 launch / 1 burst, c = tint, x/z). Fixed pools: the crowd (`OUTRO.crowdCap` 24, laid out by `crowdSpot` along the page edges, seeded), the fuses (16) and `FireworkPool` (4 slots, 2 in lite mode; a slot stays busy for rise + linger = 2 s; a launch past the cap is dropped and counted). `skip()` (after `OUTRO.skipAfter` 0.5 s, so the finale's own swipe can't skip it) stands the whole crowd up at once, drops pending and rising fireworks, leaves out the cheers and camera beats still to come. `loadPage` stops it (a new run, a jump, a rush). `lite` (low quality or reduced motion) halves each volley and spaces it for two slots. Scripts (`logic/outros.ts`, keyed by `BookId`): book 1 — villagers left, soldiers right, farmers flanking the castle, kids under the story line, three volleys, two cheers, a pull-back with an orbit right then left, home at 5.9 s, end at 7.2 s; book 2 — guards and home folk, cool/warm/gold volleys, the orbit the other way. `validateScript` checks order, one `end` last and the crowd cap.
  * **Game:** `FoldGame.outro`, `skipOutro()` (not while paused), the shelf can't open (nor the book be folded shut) while it plays, its end resets `phaseTime` so the shelf's clock starts with the card, cheer beats make the hero cheer on his keep.
  * **Look:** the crowd is cute chibi paper people (`standeeArt`, the 8 old `person*` cells repainted as `cheerVillager/Soldier/Farmer/Kid` 0/1): big round heads on small bodies, big shiny ink eyes with a paper-white highlight and a glint, rosy cheeks, open happy mouths with a tongue, pastel palette-token clothes (new `pastel*`, `blush`, `tongue`, `hair*`, `straw*` tokens). Pose 0 waves (one arm up, the soldier with a pennant); pose 1 is the hooray (both arms up, the bonnet, straw hat or party hat tossed in the air, the soldier's helmet hops). Still `DEFERRED` (never on the boot path): painted by the idle warm-up, or at once on a boss or finale page's intro (under the page turn) and on `victory`. `OutroView` draws them with one `StandeeField` (its own paper id, so they are inked), shown only on the victory page: each pops up from flat, then hops and waves on its own rhythm, and a `cheer` beat throws every arm (and hat) up with a bigger hop; reduced motion keeps a third of the hop. The old 18-person victory ring in `UnitsView` (which built a template string and an array every frame) is gone.
  * **Fireworks:** paper confetti/spark bursts through the shared confetti mesh (`Effects.fireworkBurst` / `chip`, positional and allocation-free, id 127) — rocket trails at 30 chips/s, a shell burst of 40 chips (22 lite) that falls slowly and never settles; new `cool` / `warm` palettes. Pops and launch fwips in `FoldAudio` with a 3-voice cap (`OUTRO.popVoices`); cheer beats play a smaller "yay!".
  * **Camera:** `DeskCamera.setCut` glides a framing on top of the pose with a smootherstep in real time (reduced motion: a third); identity outside a cutscene, home on the end (0.6 s after a skip) and on any page intro.
  * **UI:** a wordless skip button (`OrigamiIcon` `skip`, `aria-label` `fold.hud.skip` in en and de) bottom right inside the safe area; a tap anywhere on the page, Enter or Space skip too. The shelf zoom button waits for the card.
  * **Cost** (412×860, headless Chromium + SwiftShader, dev build, A/B within one build): the crowd +2 draw calls (colour + shadow), 0 programs (it shares the standee program); the fireworks 0 draws and 0 programs (the confetti mesh is always drawn); the camera's pull-back brings one more desk object into view (+1 draw, +1 program, compiled then; measured with the crowd suppressed). Victory frame 41 → 44 draws, 18 → 19 programs; 0 when not on the victory page. Particles: firework chips at most `fireworkParticleCap` = 4 × (40 + 9) = 196 (lite 2 × (22 + 9) = 62; a unit test holds ≤ `OUTRO.maxParticles` 220); measured peak of all live chips (the victory confetti included) from 2 s into the outro to its end: 128 (auto) and 52 (low quality), at most 4 and 2 fireworks at once, 0 dropped. Allocation: V8's sampling heap profiler over 20 whole outros after 30 warm-ups in Node (runner + `OutroView` + `Effects` + `DeskCamera`, 9,600 frames): no object, array or closure per frame from the outro code; what it samples is `Math.random` results boxed inside `fireworkBurst` and the trails (the same as the existing `Effects.burst`) and event-time work (the crowd laid out on a beat).
  * **Tests touched:** three shelf unit tests now skip or wait out the outro; the e2e victory flows (gameplay, book2, shelf) skip it with `skipOutro` (helpers), and their card waits go from 5 s to 15 s (the container ran at 0.2–0.7 fps under load).
  * **Verification:** `pnpm type-check` is clean; `pnpm test` 2208/2208 (18 new in `tests/fold/outro.test.ts`: script validity and lookup, beat order and timing, the seeded crowd, skip rules, `stop`, pool caps and the particle budget, no drop in either mode, victory before outro, the shelf held back, pause, never in a rush, a new run clears it, lite mode). e2e with `E2E_PLAIN_ONLY=1` on a private port: the new outro spec 5/5 (book 1: saved win → crowd and fireworks → a tap skips → card → reload keeps the win; book 2 at low quality with the skip button; never in a rush; no HUD overlap at 320×658 and 658×320), gameplay 11/11, book2 4/4, shelf 7/7, persistence 5/5, responsive 27/27 (the cosmetics picker at 320×658 failed once with "element is not attached" and passed on rerun; it doesn't touch the outro); cloud-hydration 5/5 without the flag. On the first run, before the timeouts were raised, 3 card checks failed under load (the card needs its 900 ms timer plus a frame).

* **Session 18 (C9)** — roadmap #12, the first-launch intro cutscene (~15 s, skippable; merged after Book 3 and C9b: its sea peek is still the placeholder, the kraken peek is deferred).
  * **Decision (vs. "boot straight into page 1" and instant start):** the intro plays only on the very first launch — nothing in `aethel_state` yet (no run, lesson, page, star, secret or win) and `fold_intro` unset. It *is* the boot's first picture: page 1 is built and compiled behind it and frozen (its game is never updated, its page hidden), so a tap anywhere drops the player onto page 1 at once, with no load; left alone it ends there by itself after 15 s. Either way `fold_intro: true` is written (inside `aethel_state`, flushed) and it never plays again; the settings face has "Watch the intro again". Returning players, and anyone with any progress, boot straight into their page with nothing built. A late cloud hydrate that brings a returning player's save ends the intro and jumps to their page.
  * **Timeline** (`logic/intro.ts`, `INTRO_BEATS`: plain `{ id, at, dur, kind, target, min }` data any runner can read): 0 s the demo page pops up and knights march on · 2.0 the tower line snaps and launches the centre column · 3.0 the ditch folds and traps the left column · 3.9 stamp: crushed · 4.4 the right ballista flips open · 5.2 a bolt pierces the right column · 5.7 the standing tower is slammed down on the knights bashing it · 6.4 a second bolt · 6.9 a sling stone into the knights in the ditch · 8.0–12.6 the origami dragon swoops in from beyond the top edge, glides down the page breathing paper fire, banks off right · 11.4–14.4 the sea peek · 15.0 page 1. Input beats act inside a window on the frame their condition holds (enough knights on the flap, someone to crush), or at its end; a guard shoots anyone who nears the castle. Unit-tested on five seeds: every beat lands, every knight falls before the dragon, the hero keeps 3 hearts.
  * **How it runs:** `IntroDirector` drives a *separate* `FoldGame` on its own page def (`GameOptions.page`, `INTRO_PAGE`) through the public input API only; none of its events reach the hooks, so nothing is saved. `IntroView` adds one group to the engine's scene — existing views: `PageView`, `UnitsView`, `ProjectilesView`, and `DragonView` posed by `dragonPose` through a `{ boss, hero }` puppet (`DragonView.update` now takes `Pick<FoldGame, 'boss' | 'hero'>`) — and borrows the desk, lamp, camera, effects, atlas and sprites. `FoldEngine.startIntro/skipIntro`; `onIntroEnd`. Warm-up is deferred until it ends; the objects are disposed in idle time after the skip.
  * **Sea peek hook:** `SeaPeekView.ts` defines `SeaPeekActor { group, update(pose, time, dt), dispose }`; `setSeaPeekFactory(ctx => new KrakenPeek(…))` swaps Book 3's kraken in for the placeholder (paper waves and a folded mantle with four curling tentacles, water/dragonBlue tones). The pose (`seaPeekPose`: `sea`, `rise`, `x`, `z`, `sway`, `time`) stays in pure logic.
  * **Skip affordance:** `IntroSkip.vue`, a round paper fast-forward tab whose gold ring fills over the intro, in the HUD strip's right column (the HUD is hidden, not unmounted, so the layout and camera framing never move). i18n: `fold.intro.skip`, `fold.settings.replayIntro` (en, de).
  * **Telemetry:** `boot_ms` unchanged (the intro's first frame takes input). `first_input_ms` stays "the first press" — in an intro session usually the skip tap. New: `intro` (`none` / `playing` / `skipped` / `watched`) and `intro_end_ms` (page 1 took over).
  * **Automation:** an automated DEV browser (`navigator.webdriver`) never sees the intro unless the URL asks: `?intro=1` (the policy), `?intro=0` (never), `?intro=force` (DEV: always). Every existing spec keeps booting into page 1 unchanged.
  * **Cost** (390×844, SwiftShader in a loaded container, so counters rather than timings): draw calls 70–79 during the intro, 119 while the dragon flies (dragon page: 123), page 1 alone 54; programs unchanged (19–21). Building the intro (first launch only, behind the splash): 33–112 ms, mostly painting the demo page; the skip: < 1 ms. Returning players: nothing built. No per-frame allocation in the director, the view or the engine's intro path.
  * **Verification:** `pnpm type-check` clean; `pnpm test` 2215/2215 (25 new in `tests/fold/intro.test.ts`). e2e on a private port, spec by spec with `E2E_PLAIN_ONLY=1`: intro 6/6 (new), gameplay 11/11, book2 4/4, shelf 7/7, responsive 27/27, persistence 5/5, cosmetics 4/4 (one screenshot timeout under load on the first run, green on rerun); cloud-hydration 6/6 without the flag (new: a hydrate during the intro ends it and lands on the saved page 3).
