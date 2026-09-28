<script setup lang="ts">
/**
 * Page 6 finale (GDD §8): "A beautiful die-cut ribbon drops down saying
 * 'VICTORY' with massive confetti bursts." The ribbon drops with a bounce;
 * under it the run summary is printed on a paper card, then Play again.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FButton from '@/components/atoms/FButton.vue'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'

const props = defineProps<{
  open: boolean
  score: number
  best: number
  time: number
  hits: number
  newBest: boolean
}>()
const emit = defineEmits<{ (e: 'again'): void }>()
const { t } = useI18n()
const showCard = ref(false)

watch(() => props.open, (o) => {
  showCard.value = false
  if (o) setTimeout(() => (showCard.value = true), 900)
})

const timeText = computed(() => {
  const s = Math.max(0, Math.round(props.time))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})
</script>

<template lang="pug">
  div.victory(v-if="open" role="dialog" :aria-label="t('fold.victory.title')")
    div.victory__ribbon
      span.victory__word {{ t('fold.victory.title') }}
    transition(name="card")
      div.victory__card(v-if="showCard")
        div.victory__frog
          OrigamiIcon(name="frog")
        p.victory__subtitle {{ hits === 0 ? t('fold.victory.flawless') : t('fold.victory.subtitle') }}
        div.victory__stats
          div.victory__stat
            OrigamiIcon(name="star" tone="yellow")
            span.victory__stat-label {{ t('fold.victory.score') }}
            span.victory__stat-value {{ score.toLocaleString() }}
          div.victory__stat
            OrigamiIcon(name="trophy" tone="yellow")
            span.victory__stat-label {{ t('fold.victory.best') }}
            span.victory__stat-value {{ best.toLocaleString() }}
          div.victory__stat
            OrigamiIcon(name="clock" tone="blue")
            span.victory__stat-label {{ t('fold.victory.time') }}
            span.victory__stat-value {{ timeText }}
          div.victory__stat
            OrigamiIcon(name="heart")
            span.victory__stat-label {{ t('fold.victory.hits') }}
            span.victory__stat-value {{ hits }}
        div.victory__record(v-if="newBest") {{ t('fold.victory.newBest') }}
        FButton(type="success" size="lg" block :attention="true" @click="emit('again')")
          span.flex.items-center.justify-center.gap-2
            OrigamiIcon(name="restart" tone="white")
            span {{ t('fold.victory.playAgain') }}
</template>

<style scoped lang="sass">
.victory
  position: absolute
  inset: 0
  z-index: 40
  display: flex
  flex-direction: column
  align-items: center
  justify-content: flex-start
  padding: calc(clamp(0.5rem, 2vh, 1rem) + env(safe-area-inset-top, 0px)) calc(0.75rem + env(safe-area-inset-right, 0px)) calc(0.75rem + env(safe-area-inset-bottom, 0px)) calc(0.75rem + env(safe-area-inset-left, 0px))
  pointer-events: none
  gap: clamp(0.6rem, 2vh, 1rem)
  overflow-y: auto

// A die-cut ribbon with swallow-tailed ends, dropping on strings.
.victory__ribbon
  position: relative
  margin-top: clamp(0.5rem, 3vh, 2rem)
  padding: clamp(0.5rem, 2vh, 0.9rem) clamp(2.4rem, 12vw, 4.5rem)
  background: linear-gradient(180deg, #ff6a5c 0 52%, #d8433b 52% 100%)
  border: 3px solid #1c1724
  clip-path: polygon(0 0, 100% 0, 92% 50%, 100% 100%, 0 100%, 8% 50%)
  filter: drop-shadow(0 8px 0 rgba(76, 64, 120, 0.5))
  animation: ribbon-drop 1.1s cubic-bezier(.3, 1.6, .5, 1) both
  min-width: min(80vw, 22rem)
  text-align: center

.victory__word
  color: #ffe066
  font-size: clamp(2rem, 11vw, 4rem)
  letter-spacing: 0.08em
  -webkit-text-stroke: 0.06em #1c1724
  paint-order: stroke fill
  text-shadow: 0 0.1em 0 #1c1724

@keyframes ribbon-drop
  0%
    transform: translateY(-160%) rotate(-6deg)
  60%
    transform: translateY(8%) rotate(3deg)
  80%
    transform: translateY(-3%) rotate(-1deg)
  100%
    transform: translateY(0) rotate(0)

.victory__card
  pointer-events: auto
  width: min(92vw, 24rem)
  padding: clamp(0.8rem, 2.5vh, 1.2rem) clamp(1rem, 4vw, 1.5rem)
  background: linear-gradient(160deg, #fff6e3 0 60%, #f3e3bf 60% 100%)
  border: 3px solid #1c1724
  border-radius: 0.9rem
  box-shadow: 0 8px 0 rgba(76, 64, 120, 0.5)
  display: flex
  flex-direction: column
  gap: clamp(0.5rem, 1.6vh, 0.8rem)

.victory__frog
  align-self: center
  font-size: clamp(2.6rem, 11vw, 3.6rem)
  margin-top: calc(clamp(2.6rem, 11vw, 3.6rem) * -0.7)
  animation: frog-hop 1.6s ease-in-out infinite

@keyframes frog-hop
  0%, 60%, 100%
    transform: translateY(0)
  70%
    transform: translateY(-30%) scaleY(1.08)
  82%
    transform: translateY(0) scaleY(0.92)

.victory__subtitle
  text-align: center
  color: #1c1724
  font-size: clamp(0.9rem, 3.8vw, 1.15rem)

.victory__stats
  display: grid
  grid-template-columns: 1fr 1fr
  gap: clamp(0.35rem, 1.2vh, 0.6rem)

.victory__stat
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

.victory__stat-label
  color: #3a3142
  font-size: clamp(0.6rem, 2.5vw, 0.75rem)

.victory__stat-value
  color: #1c1724
  font-size: clamp(0.95rem, 4vw, 1.25rem)
  font-variant-numeric: tabular-nums

.victory__record
  align-self: center
  padding: 0.2rem 0.8rem
  background: linear-gradient(135deg, #ffe066 0 50%, #f4b73a 50% 100%)
  border: 2px solid #1c1724
  border-radius: 999px
  color: #1c1724
  font-size: clamp(0.8rem, 3.4vw, 1rem)
  animation: record-pulse 0.9s ease-in-out infinite alternate

@keyframes record-pulse
  from
    transform: rotate(-3deg)
  to
    transform: rotate(3deg) translateY(-8%)

.card-enter-active
  transition: transform 0.45s cubic-bezier(.34, 1.4, .64, 1), opacity 0.3s
.card-enter-from
  transform: translateY(30%) rotate(4deg)
  opacity: 0

@media (max-height: 520px) and (orientation: landscape)
  .victory
    flex-direction: row
    align-items: center
    justify-content: center
  .victory__ribbon
    margin-top: 0
  .victory__stats
    grid-template-columns: repeat(4, 1fr)
  .victory__card
    width: min(58vw, 30rem)
</style>
