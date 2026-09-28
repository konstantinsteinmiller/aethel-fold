<script setup lang="ts">
import { computed } from 'vue'
import OrigamiIcon, { type OrigamiName } from '@/components/icons/OrigamiIcon.vue'

/**
 * Square icon button.
 *
 * Like `FButton`, the old `scale-70 / 80 / 110` transform ladder is gone: it
 * shrank the painted button without shrinking its layout box (leaving phantom
 * gaps) and it decoupled the tap target from the visible pixels. The button is
 * now a real fluid square with an explicit `min-height` floor of 2.5rem (40 px)
 * so it stays tappable and can never be collapsed to zero.
 *
 * Castle Fold look: a square of folded paper (crease + dog-ear, ink border,
 * periwinkle desk shadow) carrying an `OrigamiIcon` glyph.
 */

interface Props {
  icon?: 'close' | 'left' | 'right' | 'plus' | 'minus' | 'recenter'
  imgSrc?: string
  /** Accessible label — required whenever the button has no visible text. */
  ariaLabel?: string
  type?: 'danger' | 'primary' | 'secondary' | 'neutral'
  size?: 'sm' | 'md' | 'lg'
  isDisabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  icon: 'close',
  type: 'danger',
  size: 'md',
  isDisabled: false
})

const emit = defineEmits(['click'])

/** Public `icon` names → origami glyphs. `recenter` has no folded twin, so it
 *  uses the looping `restart` arrow. */
const glyph = computed<OrigamiName>(() => {
  switch (props.icon) {
    case 'left': return 'left'
    case 'right': return 'right'
    case 'plus': return 'plus'
    case 'minus': return 'minus'
    case 'recenter': return 'restart'
    default: return 'close'
  }
})

type Tone = 'red' | 'blue' | 'yellow' | 'green' | 'paper' | 'white' | 'ink' | 'purple'

const theme = computed<{ from: string, to: string, glyph: Tone }>(() => {
  switch (props.type) {
    case 'secondary':
      return { from: '#5f95ff', to: '#3464d6', glyph: 'white' }
    case 'primary':
      return { from: '#ffe066', to: '#f4b73a', glyph: 'white' }
    case 'neutral':
      return { from: '#fff6e3', to: '#e7d3a8', glyph: props.icon === 'close' ? 'red' : 'blue' }
    default:
      return { from: '#ff6a5c', to: '#d8433b', glyph: 'white' }
  }
})

const sizeVars = computed<Record<string, string>>(() => {
  switch (props.size) {
    case 'sm':
      return {
        '--fib-size': 'clamp(2.5rem, 8.5vw, 2.75rem)',
        '--fib-glyph': 'clamp(0.95rem, 3.6vw, 1.2rem)',
        '--ear': 'clamp(0.45rem, 1.6vw, 0.6rem)'
      }
    case 'lg':
      return {
        '--fib-size': 'clamp(3rem, 12vw, 4rem)',
        '--fib-glyph': 'clamp(1.35rem, 5.5vw, 2rem)',
        '--ear': 'clamp(0.6rem, 2.4vw, 0.9rem)'
      }
    default:
      return {
        '--fib-size': 'clamp(2.5rem, 10vw, 3.25rem)',
        '--fib-glyph': 'clamp(1.1rem, 4.4vw, 1.55rem)',
        '--ear': 'clamp(0.5rem, 2vw, 0.75rem)'
      }
  }
})

const styleVars = computed(() => ({
  ...sizeVars.value,
  '--fib-from': theme.value.from,
  '--fib-to': theme.value.to
}))
</script>

<template lang="pug">
  button.f-icon-button(
    type="button"
    :style="styleVars"
    :class="{ 'is-disabled': isDisabled }"
    :aria-label="ariaLabel"
    :disabled="isDisabled"
    @click="!isDisabled && emit('click')"
  )
    span.f-icon-button__shadow(aria-hidden="true")
    span.f-icon-button__body
      img.f-icon-button__img(v-if="imgSrc" :src="imgSrc" alt="" draggable="false")
      OrigamiIcon.f-icon-button__glyph(v-else :name="glyph" :tone="theme.glyph")
</template>

<style scoped lang="sass">
@use '@/assets/css/paper' as paper

.f-icon-button
  --bw: 3px
  --depth: 4px
  position: relative
  display: inline-flex
  align-items: center
  justify-content: center
  flex: 0 0 auto
  // A hard floor so the control survives any parent layout.
  min-width: 2.5rem
  min-height: 2.5rem
  width: var(--fib-size)
  height: var(--fib-size)
  padding: 0
  border: 0
  background: none
  cursor: pointer
  touch-action: manipulation
  -webkit-tap-highlight-color: transparent
  transition: filter 90ms ease-out

  @media (hover: hover)
    &:hover:not(.is-disabled) .f-icon-button__body
      transform: translateY(-2px)

  &:active:not(.is-disabled) .f-icon-button__body
    transform: translateY(3px)

  &:focus-visible
    outline: 3px solid paper.$blue
    outline-offset: 4px

  &.is-disabled
    opacity: 0.5
    filter: grayscale(0.85)
    cursor: not-allowed

.f-icon-button__shadow
  @include paper.shadow-plate

.f-icon-button__body
  position: relative
  display: flex
  align-items: center
  justify-content: center
  width: 100%
  height: 100%
  border: var(--bw) solid paper.$ink
  background-image: paper.crease(var(--fib-from), var(--fib-to), 135deg, 55%)
  transition: transform 90ms ease-out
  @include paper.dog-ear-clip

  &::after
    @include paper.dog-ear-flap(var(--fib-to))

.f-icon-button__glyph
  position: relative
  font-size: var(--fib-glyph)

.f-icon-button__img
  width: calc(var(--fib-glyph) * 1.35)
  height: calc(var(--fib-glyph) * 1.35)
  object-fit: contain
  pointer-events: none
</style>
