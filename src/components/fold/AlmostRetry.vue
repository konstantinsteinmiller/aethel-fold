<script setup lang="ts">
/**
 * The "Almost!" moment's big Try-again button (roadmap #9). It appears ~2 s
 * after a crumple, under the ALMOST! word FxLayer prints, and re-drops the
 * page where it was with full hearts (the simulation takes the point
 * penalty). Left alone, the simulation drops a fresh page by itself.
 *
 * The button is the default content of the `action` slot, and emits `retry`
 * through the slot's `retry` prop, so a build with an ad provider can pass
 * its own rewarded variant without touching this component or FoldScene's
 * flow.
 */
import { useI18n } from 'vue-i18n'
import FButton from '@/components/atoms/FButton.vue'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'

defineProps<{
  open: boolean
}>()
const emit = defineEmits<{
  (e: 'retry'): void
}>()
const { t } = useI18n()
const retry = (): void => emit('retry')
</script>

<template lang="pug">
  transition(name="almost")
    div.almost-retry(v-if="open" role="group" :aria-label="t('fold.hud.almost')")
      slot(name="action" :retry="retry")
        FButton(type="success" size="xl" :attention="true" data-testid="almost-retry" @click="retry")
          span.flex.items-center.justify-center.gap-2
            OrigamiIcon(name="restart" tone="white")
            span {{ t('fold.hud.tryAgain') }}
</template>

<style scoped lang="sass">
// Bottom middle, above the safe area; the page is gone (crumpled), so the
// desk is free, and the HUD strip at the top is never reached.
.almost-retry
  position: absolute
  left: 50%
  bottom: calc(clamp(1.5rem, 14vh, 7rem) + env(safe-area-inset-bottom, 0px))
  z-index: 30
  transform: translateX(-50%)
  max-width: calc(100vw - 2rem - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px))
  display: flex
  justify-content: center

.almost-enter-active
  transition: transform 0.35s cubic-bezier(.3, 1.6, .5, 1), opacity 0.2s ease-out
.almost-leave-active
  transition: opacity 0.15s ease-in
.almost-enter-from
  opacity: 0
  transform: translate(-50%, 40%) scale(0.7)
.almost-leave-to
  opacity: 0

@media (max-height: 520px) and (orientation: landscape)
  .almost-retry
    bottom: calc(clamp(0.75rem, 8vh, 2rem) + env(safe-area-inset-bottom, 0px))
</style>
