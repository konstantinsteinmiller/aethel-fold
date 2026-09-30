<script setup lang="ts">
/**
 * A book's origami stars (roadmap #1): one star per rated page slot, lit for
 * each star earned — or, `compact`, a single star and "earned/max". Used by
 * the pause bookshelf and the victory card; the 3D shelf reads the same
 * `starsForBook` selector.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'
import type { BookStars } from '@/use/useFoldProgress'

const props = withDefaults(defineProps<{
  stars: BookStars
  compact?: boolean
}>(), { compact: false })

const { t } = useI18n()
const label = computed(() => t('fold.a11y.stars', { n: props.stars.earned, max: props.stars.max }))
</script>

<template lang="pug">
  span.star-tally(role="img" :aria-label="label" :data-earned="stars.earned")
    template(v-if="compact")
      OrigamiIcon.star-tally__icon(name="star" :tone="stars.earned > 0 ? 'yellow' : 'paper'")
      span.star-tally__count {{ stars.earned }}/{{ stars.max }}
    template(v-else)
      span.star-tally__page(v-for="(s, p) in stars.pages" :key="p")
        OrigamiIcon.star-tally__pip(v-for="k in 3" :key="k" name="star" :tone="k <= s ? 'yellow' : 'paper'" :class="{ 'star-tally__pip--off': k > s }")
</template>

<style scoped lang="sass">
.star-tally
  display: inline-flex
  align-items: center
  flex-wrap: wrap
  justify-content: center
  gap: clamp(0.15rem, 1vw, 0.4rem)
  color: #1c1724
  line-height: 1

.star-tally__icon
  font-size: clamp(1.1rem, 4.4vw, 1.4rem)

.star-tally__count
  font-size: clamp(0.8rem, 3.2vw, 1rem)
  font-variant-numeric: tabular-nums
  white-space: nowrap

// One group of three per page.
.star-tally__page
  display: inline-flex
  gap: 0.05rem

.star-tally__pip
  font-size: clamp(0.8rem, 3.4vw, 1.05rem)
  &--off
    opacity: 0.4
</style>
