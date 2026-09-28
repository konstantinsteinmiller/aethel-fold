<script setup lang="ts">
/**
 * Three origami hearts (GDD §9: dying = taking 3 hits). A lost heart tears
 * off with a little hop so the loss reads even in peripheral vision.
 */
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'

const props = defineProps<{ hp: number; max: number }>()
const { t } = useI18n()
const lost = ref(-1)
watch(() => props.hp, (now, before) => {
  if (before !== undefined && now < before) {
    lost.value = now
    setTimeout(() => {
      if (lost.value === now) lost.value = -1
    }, 700)
  }
})
</script>

<template lang="pug">
  div.hearts.flex.items-center(role="img" :aria-label="t('fold.hud.hearts', { n: hp, max })")
    span.hearts__slot(
      v-for="i in max"
      :key="i"
      :class="{ 'hearts__slot--lost': i - 1 === lost, 'hearts__slot--empty': i > hp }"
    )
      OrigamiIcon(:name="i <= hp ? 'heart' : 'heartEmpty'")
</template>

<style scoped lang="sass">
.hearts
  gap: clamp(0.15rem, 0.8vw, 0.3rem)
  padding: clamp(0.15rem, 0.7vw, 0.3rem) clamp(0.3rem, 1.4vw, 0.5rem)
  background: rgba(255, 246, 227, 0.88)
  border: 2px solid #1c1724
  border-radius: 999px
  box-shadow: 0 3px 0 rgba(76, 64, 120, 0.4)
  min-height: 2.1rem

.hearts__slot
  display: block
  font-size: clamp(1.25rem, 5vw, 1.6rem)
  transition: transform 0.25s cubic-bezier(.34, 1.56, .64, 1), opacity 0.25s
  &--empty
    opacity: 0.55
  &--lost
    animation: heart-tear 0.7s ease-out

@keyframes heart-tear
  0%
    transform: translateY(0) rotate(0)
  25%
    transform: translateY(-40%) rotate(-18deg)
  60%
    transform: translateY(10%) rotate(14deg)
  100%
    transform: translateY(0) rotate(0)

@media (prefers-reduced-motion: reduce)
  .hearts__slot--lost
    animation: none
</style>
