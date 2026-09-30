# Aethel Fold — outstanding features

Work that was deferred or left unfinished for the game-jam submission (30 Sep 2026).
Each entry says what exists, what is missing and where it plugs in. Status as of the
submission build; update or delete entries as they land.

---

## Cutscenes

### Book 3 boss outro (dolphins + boat people) — not started
- **Exists:** the boss outro for books 1–2 (`src/fold/logic/cutscene.ts` runner,
  `src/fold/logic/outros.ts` scripts keyed by `BookId`, `src/fold/render/views/OutroView.ts`).
  Book 3 has no script, so after the kraken it goes straight to the victory card.
- **Missing:**
  - `OUTRO_BOOK3` in `OUTROS`: leaping/spinning dolphins in the sea plus people waving from
    paper boats, with the same pooled fireworks.
  - New `CutActor` kinds (dolphin, boat) with rows in `OutroView`'s `ACTORS` table, an
    animation field for swimming/leaping arcs, and a `crowdSpot` line-up along the water.
  - Atlas frames (8 free cells): cute style matching the kraken — rounded chunky origami
    bodies, big glossy eyes with a paper highlight, happy smiles, pastel sea palette tokens.
    Boat people: chibi (big round heads, rosy cheeks, open mouths, pastel clothes).
    Painted deferred, never on the boot path.
- **Budget:** same as books 1–2 (+2–3 draw calls, ≤220 particles, zero per-frame allocation).

### Intro cutscene — kraken peek still a placeholder
- **Exists:** 15 s first-launch intro (`logic/intro.ts`, `IntroView.ts`), skippable,
  plays once. The 3 s sea-monster peek uses a placeholder silhouette in `SeaPeekView.ts`.
- **Missing:** swap in the real kraken via `setSeaPeekFactory(ctx => new KrakenPeek(...))`
  using `KrakenView`'s rig (asleep/eyes pose), without touching `IntroView`.

### One cutscene runner for intro and outro — not done
- **Exists:** the outro uses `CutsceneRunner` (`logic/cutscene.ts`); the intro has its own
  timeline (`INTRO_BEATS` in `logic/intro.ts`).
- **Missing:** feed `INTRO_BEATS` to `CutsceneRunner` and delete the intro's private runner.

### Outro polish
- Crowd reads small on phones; some edge standees stand partly behind page trees.
- Fireworks read as confetti puffs from the steep camera; bigger/higher bursts would help.
- The one extra shader program the outro camera reveals should be pre-warmed
  (`FoldEngine.prewarm`) to avoid a first-frame hitch on low-end phones.
- Intro runs longer than 15 s real time below ~20 fps (clock follows capped frame time).

---

## Features in progress at submission time

These were being built when the submission was cut; check `git log` / branches to see if
they have landed since.

### Shield-bearer enemy (C12)
- Slow enemy (0.5× knight speed) with a big front shield: ballista bolts are blocked and
  consumed without damage; sling stones hurt it; folds, stamp, pleat, boat, tears kill it.
- Heavy use in Book 3 (escorting columns so folds/boat/pleat matter), 1–2 appearances in
  Book 2 (later pages), none in Book 1. Pars recomputed with the existing rule.
- Cute chibi look with a large round paper shield; frames painted deferred; "BLOCKED!" word
  on first block (i18n).

### Poki platform build (C13)
- `src/platforms/poki` plugin: SDK load + CSP, `init` (graceful on adblock),
  `gameLoadingFinished`, `gameplayStart/Stop`, `commercialBreak` → interstitial,
  `rewardedBreak` → rewarded. `.env.poki.example` with ads on, Poki in the `adFlags` matrix.
  (`build:poki` already exists in `package.json`.)
- Needs a check in Poki's QA tool once built.

---

## Needs playtesting / known risks (built, but unverified by humans)
- **Star pars** were tuned against a frame-perfect bot; ★★★ may be too hard. Book 3 page 3
  par is only just reachable by the bot.
- **Dragon/Kraken Rush par times** (65 / 60 / 60 s) come from bot runs only.
- **Book 3 boat/pleat relevance:** the bot rarely needs them (sling + ballista clear first);
  the shield-bearer is meant to fix this.
- **Page 3 (Siege) balance:** catapult flaps now re-arm after 5 s (for the fling secret).
- **Winter skin** is now strongly cool/blue; Halloween untested by eye on real devices.
- **Ghost-hand "tap to close" demo** may shimmer (dithered ghost over the real flap) on
  real GPUs; only checked under SwiftShader.
- **Shader precompile** (`compileAsync`) path is untested on a real GPU; the 1.5 s
  first-fold target still needs measuring on a mid-range Android phone.
- **Slow mode:** enemies step at full animation speed while moving at 0.75×.
- **Ads (ad builds only):** a player can skip the rewarded Try-again video and still get the
  plain retry. Second chance is *not offered* on non-ad builds (roadmap said "otherwise free";
  confirm intent).
- **Kraken "hurt":** the "CREASE!" word covers its face.
- **Shelf:** stars-per-page card is small on the smallest phones; ribbon/shelf spacing is
  measured at page clear, not every frame (wrong briefly after a resize).

## Deliberately not built
- Roadmap #20 level editor (roadmap says don't implement).
- Roadmap #21 art override pipeline (owner runs it locally; see the assessment in the
  session notes: fix `loadOverrides` wiring, per-pose names, palette-snap step, bigger atlas,
  KTX2 before drawing any art).
