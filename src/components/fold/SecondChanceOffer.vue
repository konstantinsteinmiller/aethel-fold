<script setup lang="ts">
/**
 * The rewarded second chance (roadmap #19): the last heart has gone and the
 * world holds still while this card offers a video for one heart back. Ad
 * builds only (`REWARDED_ADS`; lazily imported by FoldScene behind it). Once
 * per page. The strip under the title runs down with the offer's window and
 * stops while the game is paused; left alone, or on "No thanks", the page
 * crumples as it always did.
 */
import { useI18n } from 'vue-i18n'
import FButton from '@/components/atoms/FButton.vue'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'

defineProps<{
  open: boolean
  /** Length of the offer (s): the countdown strip's run. */
  seconds: number
  /** The game is paused (menu or ad): the strip waits too. */
  paused: boolean
  /** The ad is on screen: ignore taps. */
  busy: boolean
}>()
const emit = defineEmits<{
  (e: 'watch'): void
  (e: 'skip'): void
}>()
const { t } = useI18n()
</script>

<template lang="pug">
  transition(name="chance")
    div.second-chance(v-if="open" role="dialog" :aria-label="t('fold.ads.secondChance')" data-testid="second-chance")
      div.second-chance__head
        p.second-chance__title {{ t('fold.ads.secondChance') }}
        div.second-chance__timer(aria-hidden="true")
          div.second-chance__fill(:class="{ 'is-paused': paused }" :style="{ animationDuration: `${seconds}s` }")
      div.second-chance__row
        FButton(
          type="success"
          size="lg"
          data-testid="second-chance-watch"
          :attention="!busy"
          :is-disabled="busy"
          :aria-label="t('fold.ads.secondChanceWatch')"
          @click="emit('watch')"
        )
          span.flex.items-center.justify-center.gap-2
            OrigamiIcon(name="movie" tone="white")
            OrigamiIcon(name="heart")
            span +1
        button.second-chance__skip(type="button" data-testid="second-chance-skip" :disabled="busy" @click="emit('skip')") {{ t('fold.ads.noThanks') }}
</template>

<style scoped lang="sass">
// Bottom middle over the held page (a modal moment, like the pause menu): never
// up into the HUD strip, inside the safe area, and never wider than the screen.
.second-chance
  position: absolute
  left: 50%
  bottom: calc(clamp(1rem, 10vh, 5rem) + env(safe-area-inset-bottom, 0px))
  z-index: 32
  transform: translateX(-50%)
  width: max-content
  max-width: calc(100vw - 2rem - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px))
  display: flex
  flex-direction: column
  align-items: center
  gap: clamp(0.3rem, 1.2vh, 0.6rem)
  padding: clamp(0.5rem, 1.8vh, 0.9rem) clamp(0.75rem, 3vw, 1.25rem)
  background: #fff6e3
  border: 3px solid #3a3142
  border-radius: 0.9rem
  box-shadow: 0 6px 0 rgba(76, 64, 120, 0.45)

.second-chance__head
  display: flex
  flex-direction: column
  align-items: stretch
  gap: clamp(0.3rem, 1.2vh, 0.6rem)

.second-chance__title
  margin: 0
  color: #3a3142
  font-size: clamp(1.1rem, 4.5vw, 1.6rem)
  line-height: 1.1
  text-align: center

.second-chance__timer
  width: 100%
  height: 0.4rem
  border-radius: 0.2rem
  background: #e7d3a8
  overflow: hidden

.second-chance__fill
  height: 100%
  background: #ff6a5c
  transform-origin: left center
  animation-name: chance-run
  animation-timing-function: linear
  animation-fill-mode: forwards
  &.is-paused
    animation-play-state: paused

.second-chance__row
  display: flex
  flex-wrap: wrap
  align-items: center
  justify-content: center
  gap: clamp(0.4rem, 2vw, 0.9rem)

.second-chance__skip
  min-height: 44px
  padding: 0 0.75rem
  border: 0
  background: transparent
  color: #3a3142
  font-family: inherit
  font-size: clamp(0.85rem, 3.4vw, 1.05rem)
  text-decoration: underline
  cursor: pointer

@keyframes chance-run
  from
    transform: scaleX(1)
  to
    transform: scaleX(0)

.chance-enter-active
  transition: transform 0.3s cubic-bezier(.3, 1.6, .5, 1), opacity 0.2s ease-out
.chance-leave-active
  transition: opacity 0.15s ease-in
.chance-enter-from
  opacity: 0
  transform: translate(-50%, 30%) scale(0.8)
.chance-leave-to
  opacity: 0

// Short landscape: one row (title and strip beside the buttons), so the card stays low.
@media (max-height: 520px) and (orientation: landscape)
  .second-chance
    flex-direction: row
    bottom: calc(clamp(0.4rem, 3vh, 1rem) + env(safe-area-inset-bottom, 0px))
    padding: 0.35rem 0.8rem
    gap: 0.8rem
  .second-chance__title
    font-size: clamp(1rem, 5vh, 1.3rem)
  .second-chance__row
    flex-wrap: nowrap
</style>
