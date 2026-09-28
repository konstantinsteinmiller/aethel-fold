# Castle Fold — roadmap

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
- After the first victory, the desk shows a shelf of books. Book 1 is the current one and shows its stars; books 2 and 3 are locked, with silhouettes.
- There is still no main menu: the shelf is part of the desk scene, reached by folding the finished book shut.

**Where:**
- A `ShelfView` in `render/views`.
- `FoldEngine.jumpTo` already supports starting on any page.
- Unlock data comes from `pagesCleared` and `wins`.

### 3. Book 2 — "The Sea of Paper" (new fold types)
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

### 4. Endless "Scrapbook" mode
**Targets:** hard-to-put-down, average session length.
**Change:**
- After victory, unlock a single page that re-randomises its fold layout every wave. Enemy mix and speed ramp with the wave count.
- Best wave is tracked, and a run ends on the third heart.

**Where:**
- A `generatePage(seed, wave)` in `logic/pages.ts` built from the same builders.
- `rng.ts` is already seeded.
- Store `fold_endless_best`.

### 5. Daily Fold (one seeded page per day)
**Targets:** D1/D7 retention (a reason to return tomorrow).
**Change:**
- One seeded page per UTC day, the same for every player, with one attempt for a score and one practice retry.
- Show a streak counter in the HUD corner.
- Keep this separate from the removed daily-login rewards: there are no currencies, only a streak and the day's best.

**Where:**
- The seed is `yyyymmdd`, fed into item 4's generator.
- Store `fold_daily: { day, best, streak }`.
- On CrazyGames and GamePix, submit to their leaderboard APIs through the existing plugin layer.

### 6. Unlockable paper patterns (cosmetics earned by play)
**Targets:** long-term retention, collection drive.
**Change:**
- Stars unlock page papers (washi, graph, newsprint, map), hero variants and confetti shapes.
- Chosen from the cootie-catcher pause's settings face.

**Where:**
- `paintPage` in `art/pageArt.ts` takes a pattern id.
- Standee frames come from `standeeArt.ts`, with overrides already loaded from `/images/fold/units/manifest.json`.
- Store `fold_cosmetics: { owned[], equipped }`.

### 7. First-session funnel instrumentation
**Targets:** conversion (you cannot improve what you do not measure).
**Change:**
- Log these events:
  - `boot_ms`, `first_input_ms`
  - `lesson_start` / `lesson_done` per lesson, with time-to-complete
  - `page_start`, `page_clear`, `page_fail` with hearts and score
  - `victory`, `quit_page`
- Send them to the platform SDK's analytics where one exists, or buffer them in-session.

**Where:**
- A `useFunnel` singleton composable fed from `FoldScene.vue`'s existing `onEvent` hook (`pageIntro`, `pageCleared` and `lesson` start/done are already routed there).
- Exempt from i18n.

### 8. Adaptive difficulty ("the book is kind")
**Targets:** Day-1 retention for weaker players, frustration churn.
**Change:**
- After two crumples on the same page, quietly slow the march by 10% and add half a second of lesson slow-mo when the next column enters a fold.
- After three perfect pages, add one enemy per wave.
- Never show this to the player.

**Where:**
- A `difficulty` scalar on `FoldGame` that multiplies `ENEMY[].speed` and the wave spawn intervals in `game.ts`.
- Persist the crumple count per page in `fold_run`.

### 9. "Almost!" moment on failure
**Targets:** hard-to-put-down (turns a fail into an instant retry).
**Change:**
- When the page crumples, show for 1.2 s how close the player was: enemies remaining, and "2 soldiers from a clear!". Then offer a big *Try again* that re-drops the page with no delay.

**Where:**
- `FxLayer` word variant plus i18n `fold.fx.almost`.
- `pageEnemyCount` and the live enemy count already exist, so this needs no new logic.

### 10. Combo ladder with escalating juice
**Targets:** playtime, "feel", shareability.
**Change:**
- Combos ×3/×5/×8 step up the music (add a counter-melody layer), spawn a bigger confetti burst and briefly boost the tilt-shift.
- A ×8 triggers a one-shot "PAPER STORM!" slow-mo.

**Where:**
- `music.ts` layer gates.
- `Effects.ts` burst scale.
- `compositeShader` `uFocus`.
- Thresholds in `config.ts`.

### 11. Ghost replay of your best page
**Targets:** replay rate, mastery.
**Change:**
- Record fold inputs (fold id, time, progress curve) on a best-score run. On replay, show a translucent paper hand performing them.
- A run is under 2 KB, so it fits in the save.

**Where:**
- `GestureRecognizer` already produces discrete intents.
- Record them in `FoldEngine`, store them in `fold_ghosts[pageId]`, and replay them through the existing `GhostHand` component.

### 12. Share card on victory
**Targets:** conversion through virality (jury and social).
**Change:**
- "Share" renders the final frog, score, stars and time to a 1080×1350 image with the book frame, then uses the Web Share API or a download fallback.

**Where:**
- `FoldRenderer.renderTo` already produces snapshots for transitions; composite that snapshot with a 2D canvas overlay in `art/canvas.ts`.

### 13. Instant-start optimisation pass (under 1.5 s to first fold)
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
- A colour-blind-safe highlight (swap the pulsing yellow for a cyan/white dashed outline).
- A "hold to fold" alternative to swiping.
- A slow-mode toggle at 0.75× time.
- Larger HUD text.
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

### 18. Save-slot reassurance and cross-device continuity
**Targets:** retention (players who switch device must not look like a "fresh user").
**Change:**
- Show a small "Saved ✓" paper tag after each checkpoint.
- On cloud builds, show a one-time "Welcome back — page 4" ribbon when hydration restores a later page than local storage had.

**Where:**
- `useSaveStatus` already exposes save state.
- `progressRevision` in `useFoldProgress` already fires on late hydration: hook the ribbon to it.

### 19. Rewarded "second chance" (post-jury monetisation)
**Targets:** conversion to revenue once the game leaves the jury build.
**Change:**
- On the third heart lost, offer a rewarded ad that restores one heart once per page.
- Cap it with the existing rewarded throttle (`useRewardedThrottle`).
- Keep it off for the jury build.

**Where:**
- `useAds`, the platform plugins, and a new `FoldScene` crumple interstitial state.
- The flag is a new `VITE_APP_REWARDED` env var in the `.env.*.example` templates.

### 20. Level editor for community pages
**Targets:** long tail, content velocity.
**Change:**
- A DEV route that lays out folds and lanes on the page grid with drag handles, then exports a `PageDef` JSON.
- Later: shareable page codes.

**Where:**
- Reuse the page builders in `pages.ts` as the serialisation target.
- The project already has a Vite dev-plugin pattern for editor writes (`virtual:campaign-overrides`).
