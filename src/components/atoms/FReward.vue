<template lang="pug">
  Transition(name="fade")
    //- Ensure classes with special characters are in parentheses
    div.f-reward.fixed.inset-0.flex.flex-col.items-center.justify-center.touch-none.cursor-pointer(
      v-if="modelValue"
      :class="[isAdShowing ? 'z-0' : 'z-[100]', isCompact ? 'is-compact' : '']"
      @click="handleOverlayClick"
    )
      //- Die-cut paper ribbon header: a strip of red paper with swallow-tailed
      //- ends and folded-back tails, drawn in CSS so it stays crisp at any
      //- size. The slot content (or a fallback "Rewards" label) sits on it.
      div.ribbon-wrap.relative.shrink-0(
        v-if="$slots.ribbon"
        :class="{ 'is-compact': isCompact, 'is-desktop': !isCompact && !isMobilePortrait }"
      )
        div.ribbon-banner
          span.ribbon-tail.is-left(aria-hidden="true")
          span.ribbon-tail.is-right(aria-hidden="true")
          span.ribbon-shadow(aria-hidden="true")
          div.ribbon-body
            div.ribbon-content
              slot(name="ribbon")
                span.font-black.uppercase {{ t('rewards') }}

      //- Content area. In landscape it scrolls inside the remaining height
      //- (min-h-0) so a tall reward block never collides with the inline
      //- "tap to continue" footer below; elsewhere it stays vertically centred.
      div.relative.w-full.flex.flex-col.items-center.justify-center(
        :class="isCompact ? 'flex-1 min-h-0 overflow-y-auto py-1' : 'h-full'"
      )
        slot

      //- Tap-to-continue hint. In landscape it sits INLINE in the flow (shrink-0)
      //- so it can never overlap the centred reward content; otherwise it floats
      //- at the bottom of the viewport.
      Transition(name="fade")
        div.continue-hint.flex.justify-center.animate-pulse.pointer-events-none(
          v-if="showContinue"
          :class="isCompact ? 'is-inline shrink-0' : 'is-floating'"
        )
          div.continue-hint__text
            | {{ isMobile ? t('tapToContinue') : t('clickToContinue') }}
</template>

<script setup lang="ts">
import { computed, useSlots, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { isMobileLandscape, isMobilePortrait, isShortViewport } from '@/use/useUser'

// "Compact" layout = the short-viewport treatment: mobile landscape OR any
// short embed (≤500px tall, e.g. a CG iframe on a Chromebook). In both cases
// the centred desktop layout overflows, so the ribbon shrinks and the
// tap/click-to-continue hint flows INLINE below the content (shrink-0) instead
// of floating absolutely at the bottom — where it otherwise overlapped the
// reward button.
const isCompact = computed(() => isMobileLandscape.value || isShortViewport.value)
// Sink the reward overlay below the ad layer whenever an interstitial/rewarded
// is on screen. GameMonetize (and several other portals) inject their ad
// container at a z-index lower than this modal's z-[100], so without this the
// modal — including its backdrop-blur — paints OVER the playing ad.
import { isAdShowing } from '@/use/useGamePause'

const props = defineProps<{
  modelValue: boolean
  showContinue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'continue'): void
}>()

const { t } = useI18n()
const slots = useSlots()

const isMobile = computed(() => {
  return typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
})

const handleOverlayClick = () => {
  if (props.showContinue) emit('continue')
}

// Desktop shortcut: Space / Enter triggers the same "continue" action
// the overlay click does, but only while the reward is up AND in
// continue-mode. Listener is attached only when the modal becomes
// visible so background views aren't intercepting these keys.
const onContinueKey = (e: KeyboardEvent) => {
  if (!props.modelValue || !props.showContinue) return
  if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'NumpadEnter') return
  // Skip when focus is on a typing target — players might be editing
  // toolbar inputs in the background.
  const t = e.target
  if (t instanceof HTMLElement) {
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
    if (t.isContentEditable) return
  }
  e.preventDefault()
  emit('continue')
}

watch(() => props.modelValue, (open) => {
  if (open) window.addEventListener('keydown', onContinueKey)
  else window.removeEventListener('keydown', onContinueKey)
}, { immediate: true })

onUnmounted(() => {
  window.removeEventListener('keydown', onContinueKey)
})
</script>

<style scoped lang="sass">
@use '@/assets/css/paper' as paper

.f-reward
  // A warm veil over the desk rather than a black one.
  background: radial-gradient(ellipse at 50% 40%, rgba(58, 36, 22, 0.55) 0%, rgba(30, 18, 11, 0.82) 75%)
  backdrop-filter: blur(6px)
  padding: calc(clamp(0.5rem, 3vw, 1rem) + env(safe-area-inset-top, 0px)) calc(clamp(0.5rem, 3vw, 1rem) + env(safe-area-inset-right, 0px)) calc(clamp(0.5rem, 3vw, 1rem) + env(safe-area-inset-bottom, 0px)) calc(clamp(0.5rem, 3vw, 1rem) + env(safe-area-inset-left, 0px))

  &.is-compact
    padding: calc(0.5rem + env(safe-area-inset-top, 0px)) calc(0.5rem + env(safe-area-inset-right, 0px)) calc(0.5rem + env(safe-area-inset-bottom, 0px)) calc(0.5rem + env(safe-area-inset-left, 0px))

.fade-enter-active, .fade-leave-active
  transition: opacity 0.4s ease

.fade-enter-from, .fade-leave-to
  opacity: 0

// ─── Continue hint ──────────────────────────────────────────────────────────

.continue-hint
  &.is-inline
    padding-block: 0.25rem

  &.is-floating
    position: absolute
    left: 0
    right: 0
    bottom: calc(clamp(1.5rem, 7dvh, 3rem) + env(safe-area-inset-bottom, 0px))

.continue-hint__text
  font-weight: 900
  text-transform: uppercase
  letter-spacing: 0.1em
  font-size: clamp(0.8rem, 2.6vw, 1.5rem)
  @include paper.ink-text

  .is-inline &
    font-size: clamp(0.7rem, 2.4vh, 0.9rem)

// ─── Paper ribbon ────────────────────────────────────────────────────────────

.ribbon-wrap
  --bw: 3px
  --notch: clamp(0.8rem, 3.6vw, 1.4rem)
  --tail: clamp(1.4rem, 6vw, 2.6rem)
  position: relative
  // The tails stick out of the band on both sides; keep them on screen.
  width: min(80vw, 30rem)
  margin-bottom: clamp(1rem, 5dvh, 2.5rem)
  padding-inline: calc(var(--tail) * 0.7)

  &.is-compact
    width: min(62vw, 21.25rem)
    margin-top: -0.25rem
    margin-bottom: 0.25rem

  &.is-desktop
    @media (min-height: 501px)
      width: min(70vw, 22.5rem)

.ribbon-banner
  position: relative
  width: 100%
  filter: drop-shadow(0 0.35rem 0.5rem rgba(20, 12, 8, 0.35))

// clip-path deletes borders along a cut, so each die-cut piece is an ink
// silhouette with the paper inset inside it by the border width.
$band: polygon(0 0, 100% 0, calc(100% - var(--notch)) 50%, 100% 100%, 0 100%, var(--notch) 50%)
$band-inner: polygon(0 0, 100% 0, calc(100% - var(--notch) + var(--bw) * 0.5) 50%, 100% 100%, 0 100%, calc(var(--notch) - var(--bw) * 0.5) 50%)

.ribbon-shadow
  position: absolute
  inset: 0
  background-color: paper.$shadow
  transform: translateY(5px)
  clip-path: $band

.ribbon-body
  position: relative
  z-index: 1
  display: flex
  align-items: center
  justify-content: center
  min-height: clamp(2.5rem, 10vw, 4rem)
  padding: clamp(0.35rem, 1.6vw, 0.75rem) calc(var(--notch) + clamp(0.5rem, 3vw, 1.5rem))
  background-color: paper.$ink
  clip-path: $band

  // Red paper with a lengthwise crease.
  &::before
    content: ''
    position: absolute
    inset: var(--bw)
    background-image: linear-gradient(to bottom, paper.$red 0 52%, paper.$red-shade 52% 100%)
    clip-path: $band-inner

// Folded-back tails, hanging lower behind each end of the band.
.ribbon-tail
  position: absolute
  top: 32%
  bottom: -18%
  width: var(--tail)
  background-color: paper.$ink

  &::before
    content: ''
    position: absolute
    inset: var(--bw)
    background-color: paper.$red-shade

  &.is-left
    left: calc(var(--tail) * -0.7)
    &, &::before
      clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 45% 50%)

  &.is-right
    right: calc(var(--tail) * -0.7)
    &, &::before
      clip-path: polygon(0 0, 100% 0, 55% 50%, 100% 100%, 0 100%)

.ribbon-content
  position: relative
  display: flex
  align-items: center
  justify-content: center
  text-align: center
  font-size: clamp(1rem, 4.4vw, 1.9rem)
  line-height: 1.1
  // Slot content inherits white, ink-outlined lettering.
  @include paper.ink-text

  .is-compact &
    font-size: clamp(0.85rem, 3.6vh, 1.2rem)

// Landscape phone: the banner is decoration and the short axis is the scarce
// one, so it shrinks further (the old 43vw / 238px cap, in rem).
//
// `.is-compact` is always on in mobile landscape and is a compound selector,
// so it outranks a bare `.ribbon-wrap` here however far down the file it sits.
// This has to match the compound form too or it loses silently.
@media (orientation: landscape) and (max-height: 500px)
  .ribbon-wrap,
  .ribbon-wrap.is-compact
    width: min(43vw, 15rem)

  .ribbon-body
    min-height: 2.25rem
    padding-block: 0.2rem

// Short but not landscape-mobile (e.g. CG iframe in landscape with the
// portal chrome bar visible — ~700–860 px viewport). Cap the ribbon tighter so
// the roulette overlay's chrome fits the viewport. CG QA caught the overflow
// 2026-05-05.
@media (orientation: landscape) and (min-height: 501px) and (max-height: 860px)
  .ribbon-wrap.is-desktop
    width: min(50vw, 20rem)
</style>
