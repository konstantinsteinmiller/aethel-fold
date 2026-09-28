# Game Design Document: Aethel-Fold

## 1. Executive Summary
**Title:** Aethel-Fold
**Platform:** Mobile Portrait (Optimized for 720x1280, Samsung Galaxy S9+)
**Genre:** Spatial Action / Puzzle-Brawler
**Theme:** Castle (Origami / Pop-up Book Transformation)
**Art Style:** Cel-shaded, Toon, Tilt-Shift Miniature
**Target Session Length:** 10-15 minutes (Seamless "Page Flipping" progression)
**Core Vision:** A highly tactile, ASMR-driven experience where players interact with a living pop-up book. You don't just attack a castle; you fold the battlefield to destroy enemies, and eventually dismantle a transforming origami castle-dragon piece by piece.

---

## 2. Visuals & Art Direction
*Reference Material: `concept5-transform-origami_2.jpg`*

*   **Viewport & Camera:** Forced portrait mode. The camera is positioned in a steep isometric angle looking down at a wooden desk.
*   **Tilt-Shift Effect:** The top 15% and bottom 15% of the screen have a slight gaussian blur, mimicking a macro lens looking at tabletop miniatures. 
*   **Textures & Outlines:** Everything uses a flat, unlit cel-shaded shader with bold, thick black outlines. The base terrain is unbleached parchment with subtle paper grain. 
*   **Colors:** Pastel base terrain with highly saturated, contrasting primary colors for interactive elements (e.g., the multi-colored boss dragon featuring bright reds, blues, greens, and yellows).
*   **Lighting:** A warm, localized point light from above (mimicking a desk lamp) casting sharp, hard-edged shadows to emphasize the 3D depth of the folded paper.
*   **VFX / Particles:**
    *   No fire or realistic smoke. 
    *   Explosions are bursts of multi-colored rectangular confetti.
    *   Magic/Energy (like the boss core) is represented by glowing 2D toon-style gears radiating warm yellow light from inside paper folds.

---

## 3. Audio Design & Soundscapes
The audio must heavily rely on ASMR (Autonomous Sensory Meridian Response) triggers to create an intensely satisfying tactile loop.

*   **SFX (The Juice):**
    *   *Swiping:* Crisp, heavy paper creasing sounds (`shhhhhkkk`).
    *   *Popping Up:* A highly satisfying, bass-boosted cardboard *SNAP* or *THWACK*.
    *   *Defeating Enemies:* A sharp paper-tear sound (`rip!`) followed by a festive kazoo/party-popper *POP* for the confetti.
*   **Soundtrack Arc:**
    *   *Early Levels:* Light, curious pizzicato strings (plucked violins) and glockenspiel. Very toy-like and rhythmic.
    *   *Boss Reveal (Castle Unfolding):* A sudden drop in music, replaced by the deep, heavy grinding of massive paper gears. 
    *   *Boss Fight:* The pizzicato strings return but are joined by a driving, triumphant brass section and fast-paced snare drum, maintaining the "miniature" feel but raising the stakes.
    *   *Victory:* A grand, resolving orchestral chord with cheering "yay!" sound effects (high-pitched, like tiny paper people).

---

## 4. Core Mechanics & Controls (Mobile-First)
All controls are gesture-based, single-handed, and localized to the lower 60% of the screen where thumbs naturally rest.

1.  **Swipe to Fold (Offense/Defense):** Blue dotted lines with arrows appear on the flat paper. Swiping along them folds the paper on a 3D hinge. 
    *   *Use:* Pops up castle walls to block arrows, or folds the ground to flip enemy knights into the air.
2.  **Pinch to Open / Spread to Flatten (Dismantle):** Used to rip open enemy defenses or boss armor.
    *   *Use:* When an enemy tower has a visible crease, pulling two fingers apart tears the tower flat, destroying it.
3.  **Tap to Stamp (Execution):** 
    *   *Use:* Tapping a folded structure rapidly flattens it with extreme force, crushing trapped enemies underneath for bonus points.

---

## 5. The "Juice" & Player Feedback
To ensure insanely high retention from the first second, every action must over-deliver on feedback.
*   **Hit-Stop:** When tapping to "Stamp" a large enemy, the game freezes completely for 0.1 seconds (3 frames) at the moment of impact before completing the animation.
*   **Screen Shake:** A sharp, low-amplitude, high-frequency vertical screen shake occurs whenever a structure SNAPS into place or is stamped flat.
*   **Haptics:** 
    *   Light, continuous vibration while dragging a fold.
    *   Hard, sharp haptic burst on a SNAP or Stamp.
*   **Visual Pop:** Floating, bouncy toon numbers (+100) pop out of defeated enemies, scaling up quickly and fading out with a slight rotation.

---

## 6. Wordless Onboarding & First-Second Hook
*The game has NO MAIN MENU. Booting the app drops the player instantly into the tutorial.*

*   **0:00 (Launch):** Camera looks down at a flat parchment page on a wood desk. Tiny 2D paper knights march downward from the top.
*   **0:01 (Prompt):** Time slows down. A thick, glowing blue dotted line appears in front of the knights, curving upwards. A floating, stylized white hand cursor mimics a swipe motion along the curve.
*   **0:02 (Action):** The player swipes. The screen shakes slightly. A massive paper castle tower SNAPS upward from the crease, launching the knights towards the camera lens in a burst of confetti.
*   **0:03 (Transition):** A giant hand (or just a page-turn animation) grabs the bottom right corner of the screen and flips the entire level over like a page in a book, revealing Level 2.

---

## 7. Retention Engine
*   **Zero Downtime:** There are no "Level Complete" screens that require button presses. Finishing a level instantly triggers the "Page Turn" animation.
*   **Continuous Escalation:** The player goes from folding simple walls to folding entire topographies.
*   **Curiosity Loop:** The player can see thick, folded paper layers at the edges of the screen, teasing that the current "flat" level has massive hidden depth waiting to be unfolded.

---

## 8. Story Arc (30-60 Minute Game Jam Scope)
The entire game takes place over 6 "Pages" (Levels).

*   **Page 1 (The Border):** Introduces "Swipe to Fold". Pop up towers to defeat basic knights.
*   **Page 2 (The Ravine):** Introduces "Tap to Stamp". Fold the ground into a V-shape to trap enemies, then Tap to stamp the fold flat, crushing them.
*   **Page 3 (The Siege):** Combines mechanics. Enemies fire paper arrows. Fold walls to block arrows, fold the ground to launch catapults back at them.
*   **Page 4 (The Castle Gates):** The player arrives at the massive, static enemy castle. They must use "Spread to Flatten" to tear down the outer gates and drawbridge.
*   **Page 5 (The Boss - Castle Core Transformation):** 
    *   *Phase 1:* The static castle begins to rumble. Glowing gears appear. The castle unfolds itself outward (as seen in the reference image) into a massive, screen-filling Origami Dragon.
    *   *Phase 2:* The Dragon breathes paper-fire. The player must Swipe to fold shields, then quickly Pinch/Spread glowing weak points on the Dragon's limbs to fold them backward, crippling it.
*   **Page 6 (Victory):** The Dragon is reduced to a single flat sheet of paper. A dotted line appears. The player swipes one last time, folding the fearsome dragon into a tiny, harmless paper frog. A beautiful die-cut ribbon drops down saying "VICTORY" with massive confetti bursts.

---

## 9. UI / UX Design
*   **Minimalist & Diegetic:** No traditional UI overlays. 
*   **Indicators:** Actionable areas glow with a pulsing yellow highlight along the black outline.
*   **Settings/Pause:** A tiny, folded paper gear icon in the top right corner. Tapping it folds the screen down into a pause menu (like an origami cootie catcher).
*   **Restart:** Dying (taking 3 hits) simply crumples the paper level up into a ball and instantly throws a fresh page down. Zero load times.

---

## 10. Implementation Plan (1-Day Coding Agent Guide)
**Agent Directives:**
1.  **Asset Generation:** Create a basic unlit shader with edge-detection (Sobel filter) for the toon outlines. Build primitive planes and cubes for the paper pieces. Apply distinct vertex colors.
2.  **Rigging:** Rig the planes with simple bone joints acting as paper hinges. 
3.  **Input System:** Implement a gesture recognizer (Swipe vector detection, Pinch-to-zoom logic mapped to specific object colliders).
4.  **Game State:** Build a simple state machine: `Level Intro -> Wait for Input -> Check Win State -> Page Turn Animation -> Next Level`.
5.  **Boss Logic:** For the Dragon, use a sequence of predefined animations. Expose hitboxes on specific bones (limbs) that, when swiped, trigger a "fold damage" animation state.