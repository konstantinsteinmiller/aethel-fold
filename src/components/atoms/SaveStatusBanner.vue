<script setup lang="ts">
// Two-purpose corner banner:
//   1. Offline mode — when the strategy is in failed-retrying / failed-final,
//      tell the player their progress is saved locally but cloud is paused,
//      and offer a "Retry" button.
//   2. Conflict-merge bonus — when a hydrate detected a higher cloud save
//      and we restored it, show the bonus coins so the loss-of-local feels
//      like a gain instead of a punishment. Auto-dismisses after a few sec.
//
// Tap-to-dismiss for both states. Mounted from App.vue.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  acknowledgeBonus,
  bonusCoinsAwarded,
  hasBonusToShow,
  isOfflineMode,
  retryInFlight,
  retrySync
} from '@/use/useSaveStatus'
import { isCrazyWeb } from '@/use/useUser'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'

const { t } = useI18n()

const dismissed = ref(false)

const offlineDismissed = ref(false)
watch(isOfflineMode, (on) => {
  if (!on) offlineDismissed.value = false
})

// Auto-dismiss the bonus after 6 seconds so it doesn't linger forever.
let bonusTimer: ReturnType<typeof setTimeout> | null = null
watch(bonusCoinsAwarded, (n) => {
  if (n > 0) {
    if (bonusTimer) clearTimeout(bonusTimer)
    bonusTimer = setTimeout(() => acknowledgeBonus(), 6_000)
  }
})
onUnmounted(() => {
  if (bonusTimer) clearTimeout(bonusTimer)
})

// The offline banner says "Playing offline. Your progress is saved here." —
// only TRUE for builds with a local fallback (LocalStorage / Glitch / itch / GD
// / GamePix, all `persistToRaw: true`). CrazyGames is CLOUD-ONLY
// (`persistToRaw: false`), so there is no local save and the message would be a
// lie; the strategy also goes `failed-retrying` whenever `sdk.data` is
// unreachable — which is ALWAYS the case off-portal (localhost / preview),
// flashing a scary banner during dev. The retry ladder still heals silently
// underneath, and CG doesn't mandate an offline notice, so suppress the banner
// on CG entirely. The "cloud save restored" bonus banner is unaffected.
const showOffline = computed(() => isOfflineMode.value && !offlineDismissed.value && !isCrazyWeb)
const showBonus = computed(() => hasBonusToShow.value && !dismissed.value)

const onRetry = async (e: Event) => {
  e.stopPropagation()
  await retrySync()
}

const onDismissOffline = () => {
  offlineDismissed.value = true
}
const onDismissBonus = () => {
  acknowledgeBonus()
  dismissed.value = true
}

// Reset per-show dismiss flag so a future bonus can show again.
watch(hasBonusToShow, (on) => {
  if (on) dismissed.value = false
})
</script>

<template lang="pug">
  div.save-banner
    //- Bonus banner — a creased sheet of green paper, celebratory
    div.save-banner__card.is-bonus(
      v-if="showBonus"
      @click="onDismissBonus"
    )
      OrigamiIcon.save-banner__icon(name="star" tone="yellow")
      div.save-banner__text
        div.save-banner__title {{ t('saveStatus.restoredTitle') }}
        div.save-banner__body {{ t('saveStatus.restoredBody', { n: bonusCoinsAwarded }) }}
      span.save-banner__tap {{ t('saveStatus.tap') }}

    //- Offline banner — a parchment note, informational
    div.save-banner__card.is-offline(
      v-else-if="showOffline"
    )
      OrigamiIcon.save-banner__icon(name="globe" tone="blue")
      div.save-banner__text
        div.save-banner__title {{ t('saveStatus.pausedTitle') }}
        div.save-banner__body {{ t('saveStatus.pausedBody') }}
      button.save-banner__retry(
        type="button"
        :disabled="retryInFlight"
        @click="onRetry"
      ) {{ retryInFlight ? '…' : t('saveStatus.retry') }}
      button.save-banner__dismiss(
        type="button"
        @click="onDismissOffline"
        :aria-label="t('saveStatus.dismiss')"
      )
        OrigamiIcon(name="close" tone="red")
</template>

<style scoped lang="sass">
@use '@/assets/css/paper' as paper

.save-banner
  position: fixed
  z-index: 40
  left: calc(clamp(0.5rem, 2vw, 1rem) + env(safe-area-inset-left, 0px))
  right: calc(clamp(0.5rem, 2vw, 1rem) + env(safe-area-inset-right, 0px))
  bottom: calc(clamp(0.5rem, 2vw, 1rem) + env(safe-area-inset-bottom, 0px))
  pointer-events: none
  // The cards are clip-pathed (dog-ear), which would swallow their own
  // shadow — so the desk shadow is a drop-shadow on the wrapper.
  filter: drop-shadow(0 4px 0 #{paper.$shadow})

  @media (min-width: 640px)
    left: auto
    width: min(24rem, 100%)

.save-banner__card
  --bw: 2.5px
  --ear: clamp(0.6rem, 2.4vw, 0.9rem)
  position: relative
  display: flex
  align-items: center
  gap: clamp(0.5rem, 2.4vw, 0.75rem)
  min-height: 3rem
  padding: clamp(0.45rem, 1.8vw, 0.65rem) calc(clamp(0.6rem, 2.6vw, 0.9rem) + var(--ear) * 0.4) clamp(0.45rem, 1.8vw, 0.65rem) clamp(0.6rem, 2.6vw, 0.9rem)
  border: var(--bw) solid paper.$ink
  pointer-events: auto
  @include paper.dog-ear-clip

  &::after
    @include paper.dog-ear-flap(var(--card-shade))

  & + &
    margin-top: 0.5rem

  &.is-bonus
    --card-shade: #{paper.$green-shade}
    cursor: pointer
    background-image: paper.soft-crease(paper.$green, paper.$green-shade)
    @include paper.ink-text-thin

  &.is-offline
    --card-shade: #{paper.$parchment-shade}
    background-image: paper.soft-crease(paper.$parchment, paper.$parchment-mid)
    color: paper.$ink

.save-banner__icon
  position: relative
  flex: 0 0 auto
  font-size: clamp(1.4rem, 5vw, 1.75rem)

.save-banner__text
  position: relative
  flex: 1 1 auto
  min-width: 0

.save-banner__title
  font-weight: 900
  font-size: clamp(0.8rem, 3vw, 0.95rem)
  line-height: 1.2

  .is-bonus &
    text-shadow: paper.$ink-outline

.save-banner__body
  font-size: clamp(0.7rem, 2.6vw, 0.8rem)
  line-height: 1.25

.save-banner__tap
  position: relative
  flex: 0 0 auto
  font-size: clamp(0.65rem, 2.4vw, 0.75rem)
  opacity: 0.9

.save-banner__retry
  position: relative
  flex: 0 0 auto
  min-width: 2.5rem
  min-height: 2.5rem
  padding: 0.25rem clamp(0.5rem, 2.2vw, 0.75rem)
  border: 2px solid paper.$ink
  background-image: paper.soft-crease(paper.$yellow, paper.$yellow-shade)
  box-shadow: 0 3px 0 paper.$shadow
  font-weight: 900
  font-size: clamp(0.7rem, 2.6vw, 0.8rem)
  text-transform: uppercase
  cursor: pointer
  transition: transform 90ms ease-out, box-shadow 90ms ease-out
  @include paper.ink-text-thin

  @media (hover: hover)
    &:hover:not(:disabled)
      transform: translateY(-1px)
      box-shadow: 0 4px 0 paper.$shadow

  &:active:not(:disabled)
    transform: translateY(2px)
    box-shadow: 0 1px 0 paper.$shadow

  &:disabled
    opacity: 0.55
    cursor: default

  &:focus-visible
    outline: 3px solid paper.$blue
    outline-offset: 2px

.save-banner__dismiss
  position: relative
  flex: 0 0 auto
  display: inline-flex
  align-items: center
  justify-content: center
  min-width: 2.5rem
  min-height: 2.5rem
  padding: 0
  border: 0
  background: none
  font-size: clamp(0.9rem, 3.4vw, 1.1rem)
  cursor: pointer

  &:active
    transform: translateY(2px)

  &:focus-visible
    outline: 3px solid paper.$blue
    outline-offset: 2px
</style>
