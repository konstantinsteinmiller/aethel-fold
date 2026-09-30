<script setup lang="ts">
/**
 * The Almost! moment's rewarded Try again (roadmap #9), for `AlmostRetry`'s
 * `action` slot. Ad builds only (`REWARDED_ADS`): FoldScene imports it lazily
 * behind that build constant, so the jury build doesn't even ship the chunk.
 * The movie mark says "a video first"; the words stay the plain button's.
 */
import { useI18n } from 'vue-i18n'
import FButton from '@/components/atoms/FButton.vue'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'

defineProps<{
  /** The ad is on screen: ignore taps. */
  busy: boolean
}>()
const emit = defineEmits<{
  (e: 'watch'): void
}>()
const { t } = useI18n()
const watch = (): void => emit('watch')
</script>

<template lang="pug">
  FButton(
    type="success"
    size="xl"
    data-testid="almost-retry-ad"
    :attention="!busy"
    :is-disabled="busy"
    :aria-label="t('fold.ads.tryAgain')"
    @click="watch"
  )
    span.flex.items-center.justify-center.gap-2
      OrigamiIcon(name="movie" tone="white")
      span {{ t('fold.hud.tryAgain') }}
</template>
