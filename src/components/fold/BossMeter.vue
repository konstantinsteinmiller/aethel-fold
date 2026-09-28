<script setup lang="ts">
/**
 * The dragon's remaining strength: one glowing paper gear per weak point.
 * Broken limbs fold their gear flat and grey it out.
 */
import { useI18n } from 'vue-i18n'

defineProps<{ total: number; broken: number; exposed: boolean }>()
const { t } = useI18n()
</script>

<template lang="pug">
  div.boss.flex.items-center(:aria-label="t('fold.hud.boss', { n: total - broken })" role="img")
    span.boss__label.uppercase {{ t('fold.hud.dragon') }}
    span.boss__gear(
      v-for="i in total"
      :key="i"
      :class="{ 'boss__gear--broken': i <= broken, 'boss__gear--next': i === broken + 1 && exposed }"
    )
</template>

<style scoped lang="sass">
.boss
  gap: clamp(0.2rem, 1vw, 0.35rem)
  padding: clamp(0.15rem, 0.8vw, 0.3rem) clamp(0.5rem, 2vw, 0.75rem)
  background: linear-gradient(135deg, #3a3142 0 55%, #2a2331 55% 100%)
  border: 2px solid #1c1724
  border-radius: 999px
  box-shadow: 0 3px 0 rgba(76, 64, 120, 0.45)

.boss__label
  color: #ffd23f
  font-size: clamp(0.55rem, 2.2vw, 0.72rem)
  margin-right: 0.2rem

.boss__gear
  width: clamp(0.9rem, 3.8vw, 1.2rem)
  height: clamp(0.9rem, 3.8vw, 1.2rem)
  border-radius: 50%
  background: radial-gradient(circle at 50% 50%, #fff2a8 0 28%, #ffcf3f 30% 62%, #c8962a 64%)
  border: 2px solid #1c1724
  box-shadow: 0 0 10px rgba(255, 210, 63, 0.75)
  transition: transform 0.35s, filter 0.35s
  &--broken
    filter: grayscale(1) brightness(0.6)
    box-shadow: none
    transform: scaleY(0.35)
  &--next
    animation: boss-pulse 0.6s ease-in-out infinite alternate

@keyframes boss-pulse
  from
    transform: scale(1)
  to
    transform: scale(1.3)
</style>
