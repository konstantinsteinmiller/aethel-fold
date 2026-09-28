<script setup lang="ts">
/**
 * Score on a paper tag, counting up with a bounce whenever points land.
 * The displayed value eases toward the real score so big combos "roll".
 */
import { onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ score: number; best: number }>()
const { t } = useI18n()
const shown = ref(props.score)
const bump = ref(0)
let raf = 0

const tick = (): void => {
  const diff = props.score - shown.value
  if (Math.abs(diff) < 1) {
    shown.value = props.score
    raf = 0
    return
  }
  shown.value += diff * 0.18 + Math.sign(diff)
  raf = requestAnimationFrame(tick)
}

watch(() => props.score, (now, before) => {
  if (now > (before ?? 0)) bump.value++
  if (!raf) raf = requestAnimationFrame(tick)
})
onUnmounted(() => cancelAnimationFrame(raf))
</script>

<template lang="pug">
  div.score.flex.flex-col.items-center(:aria-label="t('fold.hud.score') + ': ' + score")
    div.score__tag.flex.items-baseline(:key="bump")
      span.score__label.uppercase {{ t('fold.hud.score') }}
      span.score__value.game-text {{ Math.round(shown).toLocaleString() }}
    div.score__best(v-if="best > 0") {{ t('fold.hud.best') }} {{ best.toLocaleString() }}
</template>

<style scoped lang="sass">
.score
  min-width: 0

.score__tag
  gap: clamp(0.3rem, 1.3vw, 0.5rem)
  padding: clamp(0.2rem, 0.9vw, 0.35rem) clamp(0.6rem, 2.6vw, 1rem)
  background: linear-gradient(135deg, #ffe066 0 50%, #f4b73a 50% 100%)
  border: 2px solid #1c1724
  border-radius: 0.4rem
  box-shadow: 0 4px 0 rgba(76, 64, 120, 0.45)
  min-height: 2.3rem
  align-items: center
  animation: score-bump 0.32s cubic-bezier(.34, 1.56, .64, 1)

.score__label
  color: #3a3142
  font-size: clamp(0.55rem, 2.2vw, 0.72rem)
  letter-spacing: 0.05em

.score__value
  color: #fff
  font-size: clamp(1.05rem, 4.6vw, 1.5rem)
  line-height: 1
  font-variant-numeric: tabular-nums

.score__best
  margin-top: 0.15rem
  padding: 0 0.45rem
  font-size: clamp(0.55rem, 2.2vw, 0.7rem)
  color: #fff6e3
  text-shadow: 1px 1px 0 #1c1724, -1px 1px 0 #1c1724, 1px -1px 0 #1c1724, -1px -1px 0 #1c1724

@keyframes score-bump
  0%
    transform: translateY(0)
  35%
    transform: translateY(-14%) rotate(-2deg)
  100%
    transform: translateY(0)

@media (prefers-reduced-motion: reduce)
  .score__tag
    animation: none
</style>
