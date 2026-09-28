<script setup lang="ts">
import { computed } from 'vue'

/**
 * The primary CTA button.
 *
 * Sizing is FLUID, not scaled. The previous implementation applied Tailwind
 * `scale-60 / 75 / 80 / 90 / 110 / 120 / 125` transforms to a fixed-size body,
 * which had three problems: the transform did not affect layout (so buttons
 * overlapped their neighbours at large sizes and left dead gaps at small ones),
 * the border/shadow scaled with it (going blurry or hairline), and hit targets
 * drifted away from the painted pixels.
 *
 * Every dimension is now a `clamp(min, preferred-in-vw/vh, max)`, so the button
 * grows smoothly from a 320 px phone to a 4K desktop while never collapsing
 * below a comfortable 44 px touch target.
 */

interface Props {
  label?: string
  type?: 'primary' | 'secondary' | 'danger' | 'success'
  variant?: 'default' | 'brawl'
  isDisabled?: boolean
  colorFrom?: string
  colorTo?: string
  shadowColor?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  attention?: boolean
  /** Stretch to the container's width. Off by default so a button in a row
   *  sizes to its content instead of fighting its siblings. */
  block?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  label: '',
  type: 'primary',
  variant: 'default',
  size: 'md',
  attention: false,
  block: false
})

defineEmits(['click'])

// Paper colours (lit → shaded half of the crease). `colorFrom` / `colorTo`
// still override the two halves; `shadowColor` overrides the drop plate, which
// otherwise is the periwinkle desk shadow — never black.
const PAPER_SHADOW = 'rgba(76, 64, 120, 0.45)'

const theme = computed(() => {
  switch (props.type) {
    case 'secondary':
      return {
        from: props.colorFrom ?? '#5f95ff',
        to: props.colorTo ?? '#3464d6',
        shadow: props.shadowColor ?? PAPER_SHADOW
      }
    case 'danger':
      return {
        from: props.colorFrom ?? '#ff6a5c',
        to: props.colorTo ?? '#d8433b',
        shadow: props.shadowColor ?? PAPER_SHADOW
      }
    case 'success':
      return {
        from: props.colorFrom ?? '#7fdc7a',
        to: props.colorTo ?? '#45a64a',
        shadow: props.shadowColor ?? PAPER_SHADOW
      }
    default:
      return {
        from: props.colorFrom ?? '#ffe066',
        to: props.colorTo ?? '#f4b73a',
        shadow: props.shadowColor ?? PAPER_SHADOW
      }
  }
})

/**
 * Per-size fluid metrics. The `vw` term is what makes the button responsive;
 * the min/max clamp keeps it usable at both extremes. `--fbtn-min-h` is never
 * below 2.5rem (40px) for `sm` and 2.75rem (44px) elsewhere — the touch
 * target floor — so no parent layout can crush the control out of existence.
 * `--ear` is the folded top-right corner.
 */
const sizeVars = computed<Record<string, string>>(() => {
  switch (props.size) {
    case 'sm':
      return {
        '--fbtn-font': 'clamp(0.7rem, 2.6vw, 0.95rem)',
        '--fbtn-px': 'clamp(0.7rem, 2.8vw, 1.1rem)',
        '--fbtn-py': 'clamp(0.3rem, 1.2vw, 0.5rem)',
        '--fbtn-min-w': 'clamp(3.5rem, 18vw, 6rem)',
        '--fbtn-min-h': '2.5rem',
        '--ear': 'clamp(0.45rem, 1.6vw, 0.65rem)'
      }
    case 'lg':
      return {
        '--fbtn-font': 'clamp(1rem, 4.2vw, 1.6rem)',
        '--fbtn-px': 'clamp(1.2rem, 5vw, 2.3rem)',
        '--fbtn-py': 'clamp(0.55rem, 2.2vw, 0.95rem)',
        '--fbtn-min-w': 'clamp(6.5rem, 34vw, 12rem)',
        '--fbtn-min-h': '3rem',
        '--ear': 'clamp(0.65rem, 2.4vw, 1.05rem)'
      }
    case 'xl':
      return {
        '--fbtn-font': 'clamp(1.15rem, 5vw, 2rem)',
        '--fbtn-px': 'clamp(1.5rem, 6vw, 2.9rem)',
        '--fbtn-py': 'clamp(0.65rem, 2.6vw, 1.15rem)',
        '--fbtn-min-w': 'clamp(8rem, 42vw, 15rem)',
        '--fbtn-min-h': '3.25rem',
        '--ear': 'clamp(0.75rem, 2.8vw, 1.25rem)'
      }
    default:
      return {
        '--fbtn-font': 'clamp(0.85rem, 3.4vw, 1.25rem)',
        '--fbtn-px': 'clamp(0.95rem, 4vw, 1.7rem)',
        '--fbtn-py': 'clamp(0.45rem, 1.8vw, 0.75rem)',
        '--fbtn-min-w': 'clamp(5rem, 26vw, 9rem)',
        '--fbtn-min-h': '2.75rem',
        '--ear': 'clamp(0.55rem, 2vw, 0.85rem)'
      }
  }
})

const styleVars = computed(() => ({
  ...sizeVars.value,
  '--fbtn-from': theme.value.from,
  '--fbtn-to': theme.value.to,
  '--fbtn-shadow': theme.value.shadow
}))
</script>

<template lang="pug">
  button.f-button(
    type="button"
    :style="styleVars"
    :class="[\
      variant === 'brawl' ? 'is-brawl' : '',\
      block ? 'is-block' : '',\
      attention ? 'attention-bounce' : '',\
      isDisabled ? 'is-disabled' : ''\
    ]"
    :disabled="isDisabled"
    @click="!isDisabled && $emit('click')"
  )
    //- The paper's shadow on the desk, clipped to the same dog-eared outline.
    span.f-button__shadow(aria-hidden="true")
    //- The folded sheet: crease across the face, dog-ear top-right (::after).
    span.f-button__body
      span.f-button__text
        slot {{ label }}
</template>

<style scoped lang="sass">
@use '@/assets/css/paper' as paper

.f-button
  --bw: 3px
  --depth: 4px
  position: relative
  display: inline-flex
  align-items: center
  justify-content: center
  // Floors that guarantee the control can never be collapsed to nothing by a
  // flex/grid parent — the "invisible button" failure mode.
  min-width: var(--fbtn-min-w)
  min-height: var(--fbtn-min-h)
  padding: 0
  border: 0
  background: none
  cursor: pointer
  touch-action: manipulation
  -webkit-tap-highlight-color: transparent
  transition: filter 90ms ease-out

  &.is-block
    display: flex
    width: 100%

  @media (hover: hover)
    &:hover:not(.is-disabled) .f-button__body
      transform: translateY(-2px)
    &:hover:not(.is-disabled) .f-button__shadow
      transform: translateY(calc(var(--depth) + 1px))

  // Pressed: the sheet is pushed down onto the desk, so its shadow shrinks.
  &:active:not(.is-disabled) .f-button__body
    transform: translateY(3px)

  &:focus-visible
    outline: 3px solid paper.$blue
    outline-offset: 4px

  &.is-disabled
    opacity: 0.55
    filter: grayscale(0.85)
    cursor: not-allowed

  &.is-brawl
    transform: skewX(-8deg)

    .f-button__text
      transform: skewX(8deg)
      letter-spacing: -0.01em

.f-button__shadow
  @include paper.shadow-plate
  background-color: var(--fbtn-shadow)
  transition: transform 90ms ease-out

.f-button__body
  position: relative
  display: flex
  align-items: center
  justify-content: center
  width: 100%
  min-height: var(--fbtn-min-h)
  padding: var(--fbtn-py) calc(var(--fbtn-px) + var(--ear) * 0.25) var(--fbtn-py) var(--fbtn-px)
  border: var(--bw) solid paper.$ink
  background-image: paper.soft-crease(var(--fbtn-from), var(--fbtn-to))
  transition: transform 90ms ease-out
  @include paper.dog-ear-clip

  &::after
    @include paper.dog-ear-flap(var(--fbtn-to))

.f-button__text
  position: relative
  display: block
  font-weight: 900
  text-transform: uppercase
  font-size: var(--fbtn-font)
  line-height: 1.15
  white-space: nowrap
  @include paper.ink-text

.attention-bounce
  animation: fbtn-bounce 0.6s infinite alternate

@keyframes fbtn-bounce
  from
    translate: 0 0
  to
    translate: 0 -0.3rem
</style>
