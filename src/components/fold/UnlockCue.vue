<script setup lang="ts">
/**
 * "New paper!" without words (roadmap #6): when a page clear's stars unlock a
 * cosmetic, a paper sample card — taped at the top like a swatch pinned into
 * the book — drops in where the star ribbon hung, just after it lifts away,
 * with the new swatch(es) and a sparkle, then folds away again. It says
 * nothing: the swatch is the message, and the picker on the pause's settings
 * face is where it goes.
 *
 * Driven from FxLayer (`play(ids)` right after the StarRibbon's `play`). CSS
 * animation on elements rendered once per cue; `pointer-events: none`.
 */
import { ref } from 'vue'
import CosmeticSwatch from '@/components/fold/CosmeticSwatch.vue'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'
import { STARS } from '@/fold/logic/config'

/** At most this many swatches on one card (a big jump in stars can unlock more). */
const MAX = 3

const root = ref<HTMLDivElement | null>(null)
const ids = ref<string[]>([])

const timing = {
  // Right after the ribbon: its last star plus its hang.
  '--delay': `${STARS.revealDelay + 3 * STARS.revealStep + STARS.revealHold}s`
}

const play = (unlocked: readonly string[]): void => {
  const el = root.value
  if (!el || unlocked.length === 0) return
  ids.value = unlocked.slice(-MAX)
  el.classList.remove('is-on')
  void el.offsetWidth
  el.classList.add('is-on')
}

const clear = (): void => {
  root.value?.classList.remove('is-on')
}

defineExpose({ play, clear })
</script>

<template lang="pug">
  div.unlock-cue(ref="root" aria-hidden="true" :style="timing" data-testid="unlock-cue" :data-count="ids.length")
    div.unlock-cue__card
      span.unlock-cue__tape
      span.unlock-cue__sample(v-for="id in ids" :key="id")
        CosmeticSwatch(:id="id")
      OrigamiIcon.unlock-cue__spark(name="star" tone="yellow")
</template>

<style scoped lang="sass">
// Hangs where the star ribbon did (under the HUD strip), after it has gone.
.unlock-cue
  position: absolute
  left: 50%
  top: calc(var(--hud-h, 3.5rem) + clamp(0.2rem, 1.6vh, 0.8rem))
  transform: translate(-50%, -160%)
  opacity: 0
  pointer-events: none
  z-index: 16
  &.is-on
    animation: unlock-drop 2.2s cubic-bezier(.3, 1.4, .5, 1) var(--delay) forwards

.unlock-cue__card
  position: relative
  display: flex
  align-items: center
  gap: clamp(0.3rem, 1.4vw, 0.55rem)
  padding: clamp(0.35rem, 1.2vh, 0.55rem) clamp(0.55rem, 2.6vw, 0.9rem)
  background: linear-gradient(160deg, #fffaf0 0 60%, #f3e3bf 60% 100%)
  border: 3px solid #1c1724
  border-radius: 0.3rem
  box-shadow: 0 5px 0 rgba(76, 64, 120, 0.5)
  transform: rotate(-4deg)

// A strip of tape holding the sample in.
.unlock-cue__tape
  position: absolute
  left: 50%
  top: -0.55rem
  width: 2.4rem
  height: 0.9rem
  transform: translateX(-50%) rotate(3deg)
  background: rgba(255, 240, 138, 0.8)
  border: 1.5px solid rgba(28, 23, 36, 0.35)

.unlock-cue__sample
  display: inline-flex
  font-size: clamp(2rem, min(10vw, 12vh), 3rem)

.unlock-cue__spark
  position: absolute
  right: -0.7rem
  top: -0.7rem
  width: clamp(1.2rem, min(6vw, 7vh), 1.8rem)
  height: clamp(1.2rem, min(6vw, 7vh), 1.8rem)
  animation: unlock-spark 0.9s ease-in-out infinite alternate

@keyframes unlock-drop
  0%
    opacity: 0
    transform: translate(-50%, -160%)
  14%
    opacity: 1
    transform: translate(-50%, 8%)
  22%
    transform: translate(-50%, 0)
  86%
    opacity: 1
    transform: translate(-50%, 0)
  100%
    opacity: 0
    transform: translate(-50%, -70%)

@keyframes unlock-spark
  from
    transform: rotate(-15deg) scale(0.85)
  to
    transform: rotate(20deg) scale(1.15)

// Short landscape: the same column as the star ribbon (right of the book),
// sized into the room above the desk bookshelf (`--ribbon-room`).
@media (orientation: landscape) and (max-height: 500px) and (min-aspect-ratio: 3/2)
  .unlock-cue
    left: calc(75% + 17vh)
    top: calc(var(--hud-h, 3.5rem) + clamp(0.25rem, 2vh, 0.6rem))
  .unlock-cue__sample
    font-size: min(clamp(1.5rem, 9vh, 2.4rem), max(1.1rem, calc(var(--ribbon-room, 100vh) - 2.2rem)))

@media (prefers-reduced-motion: reduce)
  .unlock-cue.is-on
    animation-timing-function: linear
  .unlock-cue__spark
    animation: none
</style>
