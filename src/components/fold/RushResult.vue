<script setup lang="ts">
/**
 * The Dragon Rush result (roadmap #16): the DRAGON RUSH ribbon, then a paper
 * card with the time against the par and the best, a badge for a new best or
 * a run under par, and the way on — rush again, or back to the story (the
 * saved page, exactly as it was left).
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FButton from '@/components/atoms/FButton.vue'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'
import PaperRibbon from '@/components/fold/PaperRibbon.vue'
import type { BookId } from '@/fold/logic/types'
import { formatRushTime } from '@/fold/logic/rush'

const props = defineProps<{
  open: boolean
  book: BookId
  time: number
  par: number
  /** The best before this run (0 = none). */
  best: number
  newBest: boolean
}>()
const emit = defineEmits<{
  (e: 'again'): void
  (e: 'back'): void
}>()
const { t } = useI18n()
const showCard = ref(false)
watch(() => props.open, (o) => {
  showCard.value = false
  if (o) setTimeout(() => (showCard.value = true), 700)
}, { immediate: true })

const timeText = computed(() => formatRushTime(props.time))
const parText = computed(() => formatRushTime(props.par).replace(/\.0$/, ''))
/** The best to show: this run if it is the new best. */
const bestText = computed(() => {
  const b = props.newBest ? props.time : props.best
  return b > 0 ? formatRushTime(b) : t('fold.rush.none')
})
const underPar = computed(() => props.time <= props.par)
</script>

<template lang="pug">
  div.rush-result(v-if="open" role="dialog" :aria-label="t('fold.rush.title')" data-testid="rush-result")
    div.rush-result__ribbon
      PaperRibbon(size="xl") {{ t('fold.rush.title') }}
    transition(name="card")
      div.rush-result__card(v-if="showCard")
        div.rush-result__icon
          OrigamiIcon(name="dragon" :tone="book === 2 ? 'blue' : 'red'")
        div.rush-result__stats
          div.rush-result__stat.rush-result__stat--main
            OrigamiIcon(name="clock" tone="blue")
            span.rush-result__label {{ t('fold.rush.time') }}
            span.rush-result__value(data-testid="rush-time") {{ timeText }}
          div.rush-result__stat
            OrigamiIcon(name="star" tone="yellow")
            span.rush-result__label {{ t('fold.rush.par') }}
            span.rush-result__value {{ parText }}
          div.rush-result__stat
            OrigamiIcon(name="trophy" tone="yellow")
            span.rush-result__label {{ t('fold.rush.best') }}
            span.rush-result__value(data-testid="rush-best") {{ bestText }}
        div.rush-result__badges
          div.rush-result__badge(v-if="newBest" data-testid="rush-new-best") {{ t('fold.rush.newBest') }}
          div.rush-result__badge.rush-result__badge--par(v-if="underPar") {{ t('fold.rush.underPar') }}
          div.rush-result__note(v-else) {{ t('fold.rush.overPar', { par: parText }) }}
        FButton(type="success" size="lg" block :attention="true" data-testid="rush-again" @click="emit('again')")
          span.flex.items-center.justify-center.gap-2
            OrigamiIcon(name="restart" tone="white")
            span {{ t('fold.rush.again') }}
        FButton(type="secondary" size="sm" block data-testid="rush-back" @click="emit('back')")
          span.flex.items-center.justify-center.gap-2
            OrigamiIcon(name="book" tone="white")
            span {{ t('fold.rush.back') }}
</template>

<style scoped lang="sass">
.rush-result
  position: absolute
  inset: 0
  z-index: 40
  display: flex
  flex-direction: column
  align-items: center
  justify-content: flex-start
  // Under the HUD strip (`--hud-h`), like the victory card.
  padding: calc(var(--hud-h, 0px) + clamp(0.3rem, 1.5vh, 0.8rem)) calc(0.75rem + env(safe-area-inset-right, 0px)) calc(0.75rem + env(safe-area-inset-bottom, 0px)) calc(0.75rem + env(safe-area-inset-left, 0px))
  pointer-events: none
  gap: clamp(0.6rem, 2vh, 1rem)
  overflow-y: auto

.rush-result__ribbon
  flex: none
  display: flex
  justify-content: center
  max-width: 100%
  animation: ribbon-drop 1s cubic-bezier(.3, 1.6, .5, 1) both

@keyframes ribbon-drop
  0%
    transform: translateY(-160%) rotate(-6deg)
  60%
    transform: translateY(8%) rotate(3deg)
  100%
    transform: translateY(0) rotate(0)

.rush-result__card
  pointer-events: auto
  width: min(92vw, 22rem)
  padding: clamp(0.8rem, 2.5vh, 1.2rem) clamp(1rem, 4vw, 1.5rem)
  background: linear-gradient(160deg, #fff6e3 0 60%, #f3e3bf 60% 100%)
  border: 3px solid #1c1724
  border-radius: 0.9rem
  box-shadow: 0 8px 0 rgba(76, 64, 120, 0.5)
  display: flex
  flex-direction: column
  gap: clamp(0.45rem, 1.5vh, 0.75rem)

.rush-result__icon
  align-self: center
  font-size: clamp(2.4rem, 10vw, 3.2rem)
  margin-top: calc(clamp(2.4rem, 10vw, 3.2rem) * -0.7)

.rush-result__stats
  display: grid
  grid-template-columns: 1fr 1fr
  gap: clamp(0.35rem, 1.2vh, 0.6rem)

.rush-result__stat
  display: grid
  grid-template-columns: auto 1fr
  grid-template-rows: auto auto
  column-gap: 0.4rem
  align-items: center
  padding: 0.35rem 0.55rem
  background: rgba(255, 255, 255, 0.55)
  border: 2px solid #1c1724
  border-radius: 0.5rem
  :deep(.origami-icon)
    grid-row: span 2
    font-size: clamp(1.3rem, 5.5vw, 1.8rem)
  &--main
    grid-column: span 2

.rush-result__label
  color: #3a3142
  font-size: clamp(0.6rem, 2.5vw, 0.75rem)

.rush-result__value
  color: #1c1724
  font-size: clamp(0.95rem, 4vw, 1.25rem)
  font-variant-numeric: tabular-nums

.rush-result__stat--main .rush-result__value
  font-size: clamp(1.3rem, 6vw, 1.8rem)

.rush-result__badges
  display: flex
  flex-wrap: wrap
  justify-content: center
  gap: 0.4rem

.rush-result__badge
  padding: 0.2rem 0.8rem
  background: linear-gradient(135deg, #ffe066 0 50%, #f4b73a 50% 100%)
  border: 2px solid #1c1724
  border-radius: 999px
  color: #1c1724
  font-size: clamp(0.8rem, 3.4vw, 1rem)
  animation: badge-pulse 0.9s ease-in-out infinite alternate
  &--par
    background: linear-gradient(135deg, #7fdc7a 0 50%, #45a64a 50% 100%)

.rush-result__note
  color: #3a3142
  font-size: clamp(0.75rem, 3.2vw, 0.9rem)

@keyframes badge-pulse
  from
    transform: rotate(-3deg)
  to
    transform: rotate(3deg) translateY(-8%)

.card-enter-active
  transition: transform 0.45s cubic-bezier(.34, 1.4, .64, 1), opacity 0.3s
.card-enter-from
  transform: translateY(30%) rotate(4deg)
  opacity: 0

@media (prefers-reduced-motion: reduce)
  .rush-result__badge, .rush-result__ribbon
    animation: none

// Short landscape: ribbon beside the card, like the victory card.
@media (max-height: 520px) and (orientation: landscape)
  .rush-result
    flex-direction: row
    align-items: center
    justify-content: center
  .rush-result__ribbon
    flex: 0 1 auto
    min-width: 0
    max-width: 38vw
    // "DRAGON RUSH" is long: a smaller band, so it never ellipsizes.
    :deep(.ribbon--xl)
      font-size: clamp(0.95rem, 6.2vmin, 2rem)
  .rush-result__icon
    display: none
  .rush-result__card
    flex: 0 1 auto
    min-width: 0
    width: min(52vw, 26rem)
    max-height: 100%
    overflow-y: auto
    gap: 0.4rem
    padding: 0.55rem 0.8rem
  .rush-result__stats
    grid-template-columns: repeat(3, minmax(0, 1fr))
  .rush-result__stat--main
    grid-column: auto
  .rush-result__stat
    grid-template-columns: 1fr
    justify-items: center
    padding: 0.1rem 0.3rem
    :deep(.origami-icon)
      display: none
  .rush-result__label
    font-size: 0.6rem
  .rush-result__value, .rush-result__stat--main .rush-result__value
    font-size: clamp(0.85rem, 5.5vh, 1.1rem)
  .rush-result__badge
    padding: 0.05rem 0.6rem
    font-size: 0.75rem
</style>
