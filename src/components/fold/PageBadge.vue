<script setup lang="ts">
/**
 * Top-left page badge: the page number on a folded paper tab and the page's
 * name underneath (StageBadge pattern: Template + fluid Tailwind sizing).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'

const props = defineProps<{
  page: number
  total: number
  nameKey: string
  boss?: boolean
}>()

const { t } = useI18n()
const name = computed(() => t(`fold.page.${props.nameKey}`))
</script>

<template lang="pug">
  div.page-badge.relative.flex.items-center(
    :class="{ 'page-badge--boss': boss }"
    :aria-label="t('fold.hud.page', { n: page, total })"
  )
    div.page-badge__num.relative.flex.items-center.justify-center
      OrigamiIcon.page-badge__icon(name="book" :tone="boss ? 'red' : 'paper'")
      span.page-badge__digit.game-text {{ page }}
    div.page-badge__text.flex.flex-col.leading-tight.min-w-0
      span.page-badge__label.uppercase {{ t('fold.hud.page', { n: page, total }) }}
      span.page-badge__name.truncate {{ name }}
</template>

<style scoped lang="sass">
.page-badge
  gap: clamp(0.3rem, 1.4vw, 0.55rem)
  padding: clamp(0.2rem, 0.9vw, 0.35rem) clamp(0.55rem, 2.4vw, 0.9rem) clamp(0.2rem, 0.9vw, 0.35rem) clamp(0.25rem, 1vw, 0.4rem)
  background: linear-gradient(135deg, #fff6e3 0 55%, #efe0bd 55% 100%)
  border: 2px solid #1c1724
  border-radius: 0.55rem 0.2rem 0.55rem 0.55rem
  box-shadow: 0 4px 0 rgba(76, 64, 120, 0.45)
  max-width: min(46vw, 15rem)
  min-height: 2.6rem
  clip-path: polygon(0 0, calc(100% - 0.7rem) 0, 100% 0.7rem, 100% 100%, 0 100%)
  &::after
    content: ''
    position: absolute
    top: 0
    right: 0
    width: 0.7rem
    height: 0.7rem
    background: linear-gradient(225deg, transparent 50%, #d9c49a 50%)
    border-left: 2px solid #1c1724
    border-bottom: 2px solid #1c1724
    border-bottom-left-radius: 0.15rem
  &--boss
    background: linear-gradient(135deg, #ffe7e0 0 55%, #f7c9bd 55% 100%)

.page-badge__num
  width: clamp(2rem, 8vw, 2.6rem)
  height: clamp(2rem, 8vw, 2.6rem)
  flex-shrink: 0

.page-badge__icon
  position: absolute
  inset: 0
  font-size: clamp(2rem, 8vw, 2.6rem)

.page-badge__digit
  position: relative
  z-index: 1
  color: #fff
  font-size: clamp(0.95rem, 3.8vw, 1.2rem)
  line-height: 1
  transform: translateY(-6%)

.page-badge__label
  color: #3a3142
  font-size: clamp(0.55rem, 2.3vw, 0.72rem)
  letter-spacing: 0.06em

.page-badge__name
  color: #1c1724
  font-size: clamp(0.72rem, 3vw, 0.95rem)
</style>
