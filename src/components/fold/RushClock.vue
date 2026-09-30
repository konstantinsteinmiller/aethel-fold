<script setup lang="ts">
/**
 * The Dragon Rush clock (roadmap #16): takes the score tag's place in the HUD
 * centre during a rush (a rush's score is never banked, its time is). A paper
 * stopwatch tag with the running time, the par under it; the tag turns from
 * gold to red once the clock passes par.
 *
 * `tenths` is the clock in whole tenths of a second: the scene only writes it
 * when it changes, so this re-renders ten times a second at most.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'
import { formatRushTime } from '@/fold/logic/rush'

const props = defineProps<{ tenths: number; par: number; best: number }>()
const { t } = useI18n()
const time = computed(() => formatRushTime(props.tenths / 10))
const par = computed(() => formatRushTime(props.par).replace(/\.0$/, ''))
const over = computed(() => props.tenths / 10 > props.par)
</script>

<template lang="pug">
  div.rush-clock.flex.flex-col.items-center(
    role="timer"
    data-testid="rush-clock"
    :aria-label="t('fold.rush.clock', { time, par })"
  )
    div.rush-clock__tag.flex.items-center(:class="{ 'rush-clock__tag--over': over }")
      OrigamiIcon.rush-clock__icon(name="clock" :tone="over ? 'red' : 'blue'")
      span.rush-clock__value.game-text {{ time }}
    div.rush-clock__par {{ t('fold.rush.par') }} {{ par }}
</template>

<style scoped lang="sass">
.rush-clock
  min-width: 0

.rush-clock__tag
  gap: clamp(0.25rem, 1.2vw, 0.45rem)
  padding: clamp(0.2rem, 0.9vw, 0.35rem) clamp(0.5rem, 2.4vw, 0.9rem)
  background: linear-gradient(135deg, #ffe066 0 50%, #f4b73a 50% 100%)
  border: 2px solid #1c1724
  border-radius: 0.4rem
  box-shadow: 0 4px 0 rgba(76, 64, 120, 0.45)
  min-height: 2.3rem
  &--over
    background: linear-gradient(135deg, #ff8a7e 0 50%, #e0453b 50% 100%)

.rush-clock__icon
  font-size: clamp(1.1rem, 4.6vw, 1.5rem)

.rush-clock__value
  color: #fff
  font-size: clamp(1.05rem, 4.6vw, 1.5rem)
  line-height: 1
  font-variant-numeric: tabular-nums
  // Wide enough for "0:00.0" so the tag never jitters as digits change.
  min-width: 4.2ch
  text-align: center

.rush-clock__par
  margin-top: 0.15rem
  padding: 0 0.45rem
  font-size: clamp(0.55rem, 2.2vw, 0.7rem)
  color: #fff6e3
  text-shadow: 1px 1px 0 #1c1724, -1px 1px 0 #1c1724, 1px -1px 0 #1c1724, -1px -1px 0 #1c1724
</style>
