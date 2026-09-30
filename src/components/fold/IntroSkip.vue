<script setup lang="ts">
/**
 * The intro's wordless skip affordance (roadmap #12): a round paper
 * fast-forward tab whose gold ring fills as the intro runs. It sits where the
 * pause button lives (the HUD strip's right column, which the camera keeps
 * clear of the page), because the HUD is hidden while the intro plays — so it
 * never covers the page or other UI. A tap anywhere skips (the canvas takes
 * the tap itself); the tab is a real button too (keyboard, screen readers:
 * its label is i18n'd).
 */
import { useI18n } from 'vue-i18n'
import { HEX } from '@/fold/render/palette'

defineProps<{
  open: boolean
  /** Seconds the intro runs when nobody taps (the ring's fill time). */
  duration: number
}>()
const emit = defineEmits<{ (e: 'skip'): void }>()
const { t } = useI18n()

const ink = HEX.ink
const paper = HEX.paperWhite
const paperShade = HEX.parchmentShade
const gold = HEX.highlight
const shadow = HEX.shadowDeep
</script>

<template lang="pug">
  transition(name="intro-skip")
    div.intro-skip(v-if="open" data-testid="intro")
      button.intro-skip__tab(
        type="button"
        data-testid="intro-skip"
        :aria-label="t('fold.intro.skip')"
        :title="t('fold.intro.skip')"
        @click.stop="emit('skip')"
      )
        svg.intro-skip__ring(viewBox="0 0 48 48" aria-hidden="true")
          circle.intro-skip__track(cx="24" cy="24" r="21")
          circle.intro-skip__fill(cx="24" cy="24" r="21" :style="{ animationDuration: `${duration}s` }")
          //- Two folded paper chevrons: fast forward.
          path.intro-skip__chev(d="M13 14l11 10-11 10z")
          path.intro-skip__chev(d="M24 14l11 10-11 10z")
          path.intro-skip__crease(d="M13 24h11M24 24h11")
</template>

<style scoped lang="sass">
.intro-skip
  position: absolute
  inset: 0
  z-index: 25
  pointer-events: none

.intro-skip__tab
  position: absolute
  // The HUD strip's padding: where the pause button is when the HUD shows.
  top: calc(clamp(0.35rem, 1.6vh, 0.75rem) + env(safe-area-inset-top, 0px))
  right: calc(clamp(0.4rem, 2vw, 0.9rem) + env(safe-area-inset-right, 0px))
  width: clamp(2.6rem, 11vw, 3.3rem)
  height: clamp(2.6rem, 11vw, 3.3rem)
  padding: 0
  border: 2px solid v-bind(ink)
  border-radius: 50%
  background: v-bind(paper)
  box-shadow: 0 4px 0 v-bind(shadow)
  pointer-events: auto
  cursor: pointer
  animation: intro-skip-breathe 1.6s ease-in-out infinite
  &:focus-visible
    outline: 3px solid v-bind(gold)
    outline-offset: 2px

.intro-skip__ring
  width: 100%
  height: 100%
  display: block

.intro-skip__track
  fill: none
  stroke: v-bind(paperShade)
  stroke-width: 4

.intro-skip__fill
  fill: none
  stroke: v-bind(gold)
  stroke-width: 4
  stroke-linecap: round
  // 2πr = 131.9: the ring fills over the intro's length.
  stroke-dasharray: 132
  stroke-dashoffset: 132
  transform: rotate(-90deg)
  transform-origin: 24px 24px
  animation-name: intro-skip-fill
  animation-timing-function: linear
  animation-fill-mode: forwards

.intro-skip__chev
  fill: v-bind(ink)
  stroke: v-bind(ink)
  stroke-width: 1.5
  stroke-linejoin: round

.intro-skip__crease
  stroke: v-bind(paper)
  stroke-width: 1.2
  opacity: 0.6

@keyframes intro-skip-fill
  to
    stroke-dashoffset: 0

@keyframes intro-skip-breathe
  0%, 100%
    transform: scale(1)
  50%
    transform: scale(1.07)

@media (prefers-reduced-motion: reduce)
  .intro-skip__tab
    animation: none

// Landscape phones: as small as the HUD's buttons there.
@media (max-height: 520px) and (orientation: landscape)
  .intro-skip__tab
    width: clamp(2.3rem, 11vh, 2.9rem)
    height: clamp(2.3rem, 11vh, 2.9rem)

.intro-skip-leave-active
  transition: opacity 0.18s ease-in
.intro-skip-leave-to
  opacity: 0
</style>
