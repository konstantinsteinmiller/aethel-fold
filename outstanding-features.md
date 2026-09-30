# Aethel Fold — outstanding features

Work that was deferred or left unfinished for the game-jam submission (30 Sep 2026).
Each entry says what exists, what is missing and where it plugs in. Status as of the
submission build; update or delete entries as they land.

The cutscene work (Book 3's dolphin outro, the kraken intro peek, one cutscene runner, the
outro polish) and the features that were in progress at submission (C12 shield-bearer, C13 Poki)
have landed; see the status log in `game-implementation-plan.md`.

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
- **Cutscenes on real GPUs / slow phones:** the intro and outros now run on the real clock (capped
  at 0.25 s per frame, so below ~4 fps they still stretch); the camera-facing firework rings, the
  dolphins' leap arcs and spins, and the kraken peek were only checked under SwiftShader at 390×844,
  658×320 and 320×658. The dolphins' paper spray adds up to 20 chips on top of the fireworks' 196.
- **Kraken "hurt" word:** "CREASE!"/"RIP!" now sit beside the hurt arm (below the beak for the core),
  clear of the face; not yet checked by a human in a real fight at every aspect.
- **Shelf:** stars-per-page card is small on the smallest phones; ribbon/shelf spacing is
  measured at page clear, not every frame (wrong briefly after a resize).

## Deliberately not built
- Roadmap #20 level editor (roadmap says don't implement).
- Roadmap #21 art override pipeline (owner runs it locally; see the assessment in the
  session notes: fix `loadOverrides` wiring, per-pose names, palette-snap step, bigger atlas,
  KTX2 before drawing any art).
