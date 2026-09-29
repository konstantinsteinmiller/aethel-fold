<script setup lang="ts">
/**
 * A die-cut paper ribbon with swallow-tailed ends (pause title, VICTORY).
 *
 * Why it's built like this:
 *   - The notched shape is a `clip-path` on the inner band, which would cut
 *     a CSS border off along the diagonals. The ink outline comes from four
 *     hard `drop-shadow`s on the *wrapper* instead, so it follows the notches.
 *   - Everything is sized in `em` off one fluid font size, so the notches,
 *     padding and outline stay in proportion from a 320 px phone to 4K.
 *   - The band sizes to its text (`inline-flex`) but never exceeds its
 *     container; long translations ellipsize instead of overflowing.
 */
withDefaults(defineProps<{ size?: 'md' | 'xl'; tone?: 'red' | 'blue' }>(), { size: 'md', tone: 'red' })
</script>

<template lang="pug">
  div.ribbon(:class="[`ribbon--${size}`, `ribbon--${tone}`]")
    div.ribbon__band
      span.ribbon__text.game-text
        slot
</template>

<style scoped lang="sass">
.ribbon
  --ink: #1c1724
  --edge: 0.09em
  display: inline-flex
  max-width: 100%
  min-width: 0
  font-size: clamp(1.05rem, 4.2vw + 0.2vh, 1.55rem)
  filter: drop-shadow(var(--edge) 0 0 var(--ink)) drop-shadow(calc(var(--edge) * -1) 0 0 var(--ink)) drop-shadow(0 var(--edge) 0 var(--ink)) drop-shadow(0 calc(var(--edge) * -1) 0 var(--ink)) drop-shadow(0 0.22em 0 rgba(76, 64, 120, 0.5))
  &--xl
    // The short side decides, so a landscape phone doesn't get a wall of ribbon.
    font-size: clamp(1.6rem, 9.5vmin, 3.8rem)
    --edge: 0.06em

.ribbon__band
  --notch: 0.85em
  min-width: 0
  max-width: 100%
  padding: 0.28em calc(var(--notch) + 0.7em) 0.34em
  clip-path: polygon(0 0, 100% 0, calc(100% - var(--notch)) 50%, 100% 100%, 0 100%, var(--notch) 50%)
  text-align: center
  line-height: 1.15
.ribbon--red .ribbon__band
  background: linear-gradient(180deg, #ff6a5c 0 54%, #d8433b 54% 100%)
.ribbon--blue .ribbon__band
  background: linear-gradient(180deg, #5f95ff 0 54%, #3464d6 54% 100%)

.ribbon__text
  display: block
  color: #fff
  white-space: nowrap
  overflow: hidden
  text-overflow: ellipsis
.ribbon--xl .ribbon__text
  color: #ffe066
  letter-spacing: 0.08em
  -webkit-text-stroke: 0.06em #1c1724
  paint-order: stroke fill
  text-shadow: 0 0.1em 0 #1c1724
</style>
