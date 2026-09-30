<script setup lang="ts">
/**
 * The star ribbon (roadmap #1): on a cleared page a paper band drops in under
 * the HUD strip and the origami stars fold into their slots one by one, on the
 * page-turn beat, each a step higher in pitch (FoldAudio.stars shares the
 * timing through `STARS` in config.ts). Unearned slots stay as flat, faded
 * paper so the player sees what was missed.
 *
 * Driven from FxLayer (`play(n)` on `pageCleared`). Everything is CSS
 * animation on elements rendered once — no per-frame work, no allocation, and
 * `pointer-events: none`, so it never holds up the page turn or a fold.
 */
import { ref } from 'vue'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'
import { STARS } from '@/fold/logic/config'

const root = ref<HTMLDivElement | null>(null)
const SLOTS = [0, 1, 2] as const

const timing = {
  '--delay': `${STARS.revealDelay}s`,
  '--step': `${STARS.revealStep}s`,
  '--total': `${STARS.revealDelay + 3 * STARS.revealStep + STARS.revealHold}s`
}

/** Fold in `n` (0…3) stars. Restarts cleanly if a previous ribbon is still up. */
const play = (n: number): void => {
  const el = root.value
  if (!el) return
  const earned = Math.max(0, Math.min(3, Math.round(n)))
  el.dataset.stars = String(earned)
  el.classList.remove('is-on')
  void el.offsetWidth
  el.classList.add('is-on')
}

/** Take the ribbon down at once (a new run, a jump). */
const clear = (): void => {
  root.value?.classList.remove('is-on')
}

defineExpose({ play, clear })
</script>

<template lang="pug">
  div.star-ribbon(ref="root" aria-hidden="true" data-stars="0" :style="timing")
    div.star-ribbon__band
      span.star-ribbon__slot(v-for="i in SLOTS" :key="i" :style="{ '--i': i }" :data-slot="i")
        OrigamiIcon.star-ribbon__blank(name="star" tone="paper")
        OrigamiIcon.star-ribbon__star(name="star" tone="yellow")
</template>

<style scoped lang="sass">
// Sits just under the HUD strip (`--hud-h`, set by FoldScene), over the top
// edge of the page where the enemies come in — empty while the page turns.
.star-ribbon
  position: absolute
  left: 50%
  top: calc(var(--hud-h, 3.5rem) + clamp(0.2rem, 1.6vh, 0.8rem))
  transform: translate(-50%, -140%)
  opacity: 0
  pointer-events: none
  z-index: 16
  &.is-on
    animation: star-ribbon var(--total) cubic-bezier(.3, 1.4, .5, 1) forwards

.star-ribbon__band
  display: flex
  align-items: center
  gap: clamp(0.3rem, 1.6vw, 0.7rem)
  padding: clamp(0.2rem, 0.9vh, 0.4rem) clamp(0.9rem, 4.5vw, 1.6rem)
  background: linear-gradient(170deg, #fff6e3 0 55%, #ecdcb6 55% 100%)
  border: 3px solid #1c1724
  border-radius: 0.35rem
  box-shadow: 0 5px 0 rgba(76, 64, 120, 0.5)
  // Die-cut notched ends, like the victory ribbon.
  clip-path: polygon(0 0, 100% 0, calc(100% - 0.7rem) 50%, 100% 100%, 0 100%, 0.7rem 50%)

.star-ribbon__slot
  position: relative
  display: block
  // Height-aware so a landscape phone keeps the band thin.
  width: clamp(1.7rem, min(9vw, 11vh), 3rem)
  height: clamp(1.7rem, min(9vw, 11vh), 3rem)
  perspective: 12rem

.star-ribbon__slot :deep(.origami-icon)
  position: absolute
  inset: 0
  width: 100%
  height: 100%

.star-ribbon__blank
  opacity: 0.35

// Each earned star folds up out of the band, flat → upright, then settles.
.star-ribbon__star
  opacity: 0
  transform-origin: 50% 100%
  transform: rotateX(-90deg) scale(0.6)

@for $n from 1 through 3
  .star-ribbon.is-on[data-stars='#{$n}'] .star-ribbon__slot:nth-child(-n + #{$n}) .star-ribbon__star
    animation: star-fold 0.42s cubic-bezier(.3, 1.8, .5, 1) forwards
    animation-delay: calc(var(--delay) + var(--i) * var(--step))

@keyframes star-fold
  0%
    opacity: 1
    transform: rotateX(-90deg) scale(0.6)
  55%
    opacity: 1
    transform: rotateX(12deg) scale(1.25)
  100%
    opacity: 1
    transform: rotateX(0) scale(1)

// Drops in just before the first star, hangs, then lifts away.
@keyframes star-ribbon
  0%
    opacity: 0
    transform: translate(-50%, -140%)
  12%
    opacity: 1
    transform: translate(-50%, 6%)
  18%
    transform: translate(-50%, 0)
  88%
    opacity: 1
    transform: translate(-50%, 0)
  100%
    opacity: 0
    transform: translate(-50%, -60%)

@keyframes star-fade
  from
    opacity: 0
  to
    opacity: 1
    transform: none

// Short landscape (a phone on its side): the strip between the HUD and the
// page is thinner than the band, and the turning sheet rises through it. The
// desk right of the book is empty (the book spans ~±34vh around the centre and
// turns leftward), so the ribbon hangs in the middle of that column instead.
@media (orientation: landscape) and (max-height: 500px) and (min-aspect-ratio: 3/2)
  .star-ribbon
    left: calc(75% + 17vh)
    top: calc(var(--hud-h, 3.5rem) + clamp(0.4rem, 3vh, 1rem))
  .star-ribbon__band
    gap: clamp(0.25rem, 1.2vw, 0.5rem)
    padding: clamp(0.2rem, 0.9vh, 0.4rem) clamp(0.9rem, 2.4vw, 1.2rem)
  .star-ribbon__slot
    width: clamp(1.5rem, 9vh, 2.4rem)
    height: clamp(1.5rem, 9vh, 2.4rem)

@media (prefers-reduced-motion: reduce)
  .star-ribbon.is-on
    animation-timing-function: linear
  .star-ribbon.is-on .star-ribbon__star
    animation-name: star-fade !important
</style>
