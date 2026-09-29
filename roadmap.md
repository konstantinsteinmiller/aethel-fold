# Aethel Fold — roadmap

Features that would raise **Day-1 retention**, **average playtime**, how easy the game is to **pick up** and how hard it is to **put down**, and the **conversion** of first-time players. They are ordered by expected impact per unit of effort. Each item names the metric it targets, the change to make, and where it goes in this codebase.

Conventions every item must keep:
- New persisted fields go into `aethel_state` through `useFoldProgress` / `setState`. Never add a new localStorage key: the save pipeline only uploads `aethel_state` and `__save_meta__`.
- New player-facing strings go into every locale in `src/i18n/locales/`.
- Gameplay stays in the pure-TS `src/fold/logic`, so it is unit-testable in `tests/fold`.

---

### 1. Star rating per page (3 origami stars)
**Targets:** replay rate, playtime, "one more try".
**Change:**
- Award ★ for clearing a page, ★★ for clearing it with ≤ 1 heart lost, and ★★★ for a *Perfect Page* at or above a per-page score par.
- Show the stars folding in one by one on the page-turn beat, with a rising pitch per star.

**Where:**
- `PageDef.par` in `pages.ts`.
- `GameStats` gets `stars`, computed in `game.ts` where `perfect` is already derived.
- Stored as `fold_stars: Record<pageId, 0..3>` in `useFoldProgress`.
- A `StarRibbon` component driven from `FxLayer`.

### 2. Chapter select as a physical bookshelf
**Targets:** Day-1 retention, conversion (a visible goal).
**Change:**
- After the first victory, the desk shows a shelf of books (on desktop right of the book, on mobile there is a zoom out button that shows the bookshelf in the top right, taping on the current book zooms in on the book again and continues the game). 
- Book 1 is the current one and shows its stars; books 2 and 3 are locked, with silhouettes.
- There is still no main menu: the shelf is part of the desk scene, reached by folding the finished book shut or using the zoom out button.
- After finishing a book, the game automatically zooms out to show the bookshelf and highlights the books in the physical bookshelf, which the player should be able to inspect. 
- Help the player with wordless gestures to find the bookshelves easily.

**Where:**
- A `ShelfView` in `render/views`.
- `FoldEngine.jumpTo` already supports starting on any page.
- Unlock data comes from `pagesCleared` and `wins`.

### 3. Book 3 — "The Sea of Paper" (new fold types)
**Targets:** playtime, retention (content depth).
**Change:**
- Six new pages built from the existing builders plus two new fold kinds:
  - a **boat fold**, which carries the hero across a river lane;
  - a **pleat**, a multi-crease accordion that crushes a column in sequence.
- Boss: a paper kraken whose tentacles are crease weak points.

**Where:**
- `FoldKind` in `types.ts`.
- `folds.ts` gets its snap and trap rules.
- `FoldView` gets its panel geometry.
- The boat model already exists in `models.ts`.
- Lessons: add `boat` and `pleat` to `LESSON_IDS`, so onboarding stays wordless.

### 4. Improved Wordless tutorials
**Targets:** faster onboarding, average session length.
**Change:**
- We have wordless tutorials at the start of the game, but the player needs to see the fold in action 
- before they can copy it. Add a "ghost hand" that demonstrates the fold on first encounter and the close shut click/tap too, then fades out to let the player try.

### 6. Unlockable paper patterns (cosmetics earned by play)
**Targets:** long-term retention, collection drive.
**Change:**
- Stars unlock page papers (washi, graph, newsprint, map), hero variants and confetti shapes.
- Chosen from the cootie-catcher pause's settings face.

**Where:**
- `paintPage` in `art/pageArt.ts` takes a pattern id.
- Standee frames come from `standeeArt.ts`, with overrides already loaded from `/images/fold/units/manifest.json`.
- Store `fold_cosmetics: { owned[], equipped }`.

### 7. Clean up the games routes and README.md and unused code from the previous 3d project like the water scene, the character editor scene
**Targets:** cleanup
**Change:**
- routes and README.md and unused code from the previous 3d project like the water scene, the character editor scene

### 8. Adaptive difficulty ("the book is kind")
**Targets:** Day-1 retention for weaker players, frustration churn.
**Change:**
- After the first crumple on the same page, quietly slow the march by 10% and add half a second of lesson slow-mo when the next column enters a fold.
- After three perfect pages, add one enemy per wave.
- Never show this to the player.
- if the player has lost multiple times before the boss page on page 5, then make the boss fight easier by 
- reducing the speed of incoming enemies or whatever is the mass unit by 20% upfront, reset on first try win.

**Where:**
- A `difficulty` scalar on `FoldGame` that multiplies `ENEMY[].speed` and the wave spawn intervals in `game.ts`.
- Persist the crumple count per page in `fold_run`.

### 9. "Almost!" moment on failure
**Targets:** hard-to-put-down (turns a fail into an instant retry).
**Change:**
- When the page crumples, show for 2 s how close the player was: enemies remaining, and "2 soldiers from a clear!". 
- Then offer a big *MovieIcon Try again* rewarded ad(normal button without rewarded ad and MovieIcon for the first 3 minutes of the first-time players game, only for AdProvider builds, not adding the rewarded ad for Itch.io for example) 
- that re-drops the page with no delay and continues with 3 hearts, but this reduces the points gathered for this page.

**Where:**
- `FxLayer` word variant plus i18n `fold.fx.almost`.
- `pageEnemyCount` and the live enemy count already exist, so this needs no new logic.


### 12. Intro cutscene (15 s, skippable)
**Targets:** hookness factor
**Change:** 
- Intro cutscene with a short ~15 second skippable introduction to the gameplay showing of folding the folds to kill enemy paper units and 
- using ballistas and slingshots to kill units and the origami dragon flying over the battlefield spitting fire, then flying off.
- The cutscene also shows off the new Kraken boss from Book 3 as a short peak from the sea in the background, but he does nothing yet, disappears after 3 seconds.


### 13. Instant-start optimisation pass (under 1.5 s to first fold ideally)
**Targets:** conversion, especially on platform portals where the first 5 s decide the bounce.
**Change:**
- Compress the standee atlas to KTX2/Basis.
- Precompile the paper shader programs during the splash with `renderer.compileAsync`.
- Stream in the page-2+ art after first input.
- Budget: the first fold is possible under 1.5 s on a mid-range Android device.

**Where:**
- `FoldEngine.scheduleWarm` already defers work, so extend it.
- Measure with the `boot_ms` / `first_input_ms` events from item 7.

### 14. Accessibility options
**Targets:** reach, retention for players who would otherwise bounce.
**Change:**
- A "hold to fold" alternative to swiping.
- A slow-mode toggle at 0.75× time.
- Already done: reduced motion (camera shake off), and haptics are toggleable.

**Where:**
- `foldSettings` gains `highlightMode`, `holdToFold` and `slowMode`.
- `compositeShader` highlight colour uniforms.
- `gestures.ts` long-press path.

### 15. Page-specific secrets (discoverable easter eggs)
**Targets:** hard-to-put-down, word of mouth.
**Change:**
- Each page hides one interaction: fold the river flap three times to launch a paper boat; tap the desk lamp to toggle night mode; fold the hero's banner to make them wave.
- A "secrets found 2/6" counter on the shelf.

**Where:**
- Tap targets on `BookView` desk props.
- New events in `events.ts`.
- Store `fold_secrets: string[]`.

### 16. Boss rematch ("Dragon Rush")
**Targets:** playtime and mastery for completers.
**Change:**
- After victory, a time-attack mode against the dragon alone, with faster attack cadence and a par time.
- It reuses the whole boss FSM and adds only a timer and a `BOSS` timing multiplier.

**Where:**
- `boss.ts` timings read through a multiplier.
- `FoldGame.startRun({ mode: 'dragonRush' })` that starts on page 5's boss phase.

### 17. Seasonal page skins
**Targets:** returning players (D30), platform featuring.
**Change:**
- Halloween (pumpkin towers, bat standees) and Winter (snow paper, scarf hero), switched on by date.
- These are art swaps only: the logic is untouched.

**Where:**
- `paintPage` theme variants.
- `/public/images/fold/units/manifest.json` overrides, a pipeline that already exists.

### 17. Interstitial ads for AdProvider builds
- **Targets:** monetization
- **Change:** 
- Interstitial ads on page clear, boss clear, and crumple. Only for AdProvider builds, 
- 121s between interstitial ads, no interstitials before 3 min, not for Itch.io or other non-ad builds.


### 19. Rewarded "second chance" (post-jury monetisation)
**Targets:** conversion to revenue once the game leaves the jury build.
**Change:**
- On the third heart lost, offer a rewarded ad that restores one heart once per page.
- Cap it with the existing rewarded throttle (`useRewardedThrottle`).
- Keep it off for the jury build.
- might be doubled with the existing "almost!" moment on failure, but the rewarded ad is only offered once per page, only for AdProvider builds, otherwise free.

**Where:**
- `useAds`, the platform plugins, and a new `FoldScene` crumple interstitial state.
- The flag is a new `VITE_APP_REWARDED` env var in the `.env.*.example` templates.

### 20. Level editor for community pages (don't need yet, don't implement)
**Targets:** long tail, content velocity.
**Change:**
- A DEV route that lays out folds and lanes on the page grid with drag handles, then exports a `PageDef` JSON.
- Later: shareable page codes.

**Where:**
- Reuse the page builders in `pages.ts` as the serialisation target.
- The project already has a Vite dev-plugin pattern for editor writes (`virtual:campaign-overrides`).
