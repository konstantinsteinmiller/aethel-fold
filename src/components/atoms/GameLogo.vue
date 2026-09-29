<script setup lang="ts">
/**
 * The splash logo: a paper castle popping up out of an open book, over the
 * wordmark on a die-cut red ribbon. The drawing itself lives in `logoArt.ts`
 * (one source for this component, `index.html`'s static splash and the
 * rasterised icons in `public/images/logo/`); see that file for the rules.
 *
 * The markup is our own static string (no user input), so `v-html` is safe.
 * The title is a proper noun, so it is not routed through vue-i18n.
 */
import { computed } from 'vue'
import { logoSvg } from './logoArt'

interface Props {
  /** Rendered size in px, square. Overridden by any width/height utility the
   *  caller puts on the element. */
  size?: number
  /** Hide the wordmark and show only the castle. */
  markOnly?: boolean
}

const props = withDefaults(defineProps<Props>(), { size: 256, markOnly: false })
const markup = computed(() => logoSvg({ markOnly: props.markOnly }))
</script>

<template lang="pug">
  div.game-logo(:style="{ width: `${size}px`, height: `${size}px` }" v-html="markup")
</template>

<style scoped lang="sass">
.game-logo
  :deep(svg)
    display: block
    width: 100%
    height: 100%
</style>
