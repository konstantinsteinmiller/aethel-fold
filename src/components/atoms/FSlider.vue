<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  modelValue: number
  min?: number
  max?: number
  step?: number
  label?: string
  colorFrom?: string
  colorTo?: string
  trackColor?: string
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: 50,
  min: 0,
  max: 100,
  step: 1,
  colorFrom: '#ff6a5c', // paper red, lit half
  colorTo: '#d8433b', // paper red, shaded half
  trackColor: '#fff6e3' // parchment strip
})

const emit = defineEmits(['update:modelValue'])

const progress = computed(() => {
  return ((props.modelValue - props.min) / (props.max - props.min)) * 100
})

const updateValue = (event: Event) => {
  const target = event.target as HTMLInputElement
  emit('update:modelValue', Number(target.value))
}
</script>

<template lang="pug">
  div.f-slider-container(class="w-full")
    //- Label (Optional)
    div.slider-label(v-if="label") {{ label }}

    //- The thumb travels (100% - thumb) exactly like the native one, so the
    //- painted square never hangs off either end of the strip.
    div.f-slider__row
      //- The track: a strip of parchment with an ink border.
      div.f-slider__track(:style="{ backgroundColor: trackColor }")
        //- Fill: a creased strip of coloured paper laid over it.
        div.f-slider__fill(
          :style="{ \
            width: `calc(var(--fsl-thumb) / 2 + (100% - var(--fsl-thumb)) * ${progress / 100})`, \
            backgroundImage: `linear-gradient(170deg, ${colorFrom} 0 50%, ${colorTo} 50% 100%)` \
          }"
        )

      //- Native Input (Invisible but functional)
      input.f-slider__input(
        type="range"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        :aria-label="label"
        @input="updateValue"
      )

      //- Custom thumb (visual only): a folded paper square.
      div.thumb-visual(
        aria-hidden="true"
        :style="{ left: `calc((100% - var(--fsl-thumb)) * ${progress / 100})` }"
      )
        span.thumb-visual__shadow
        span.thumb-visual__body
</template>

<style scoped lang="sass">
@use '@/assets/css/paper' as paper

.slider-label
  margin-bottom: 0.4rem
  font-weight: 900
  text-transform: uppercase
  letter-spacing: 0.04em
  font-size: clamp(0.75rem, 3.2vw, 1.1rem)
  @include paper.ink-text

.f-slider-container
  // Thumb size drives the row height, the track height AND the left offset, so
  // all three stay in sync at any viewport.
  --fsl-thumb: clamp(2.25rem, 9vw, 2.6rem)
  --bw: 2.5px
  --ear: calc(var(--fsl-thumb) * 0.3)
  padding-block: clamp(0.4rem, 2vw, 1rem)
  -webkit-tap-highlight-color: transparent

.f-slider__row
  position: relative
  display: flex
  align-items: center
  height: var(--fsl-thumb)
  min-height: 2.25rem

.f-slider__track
  position: absolute
  inset-inline: 0
  top: 50%
  height: calc(var(--fsl-thumb) * 0.5)
  border: var(--bw) solid paper.$ink
  border-radius: 0.15rem
  overflow: hidden
  transform: translateY(-50%)
  box-shadow: 0 3px 0 paper.$shadow
  // A faint centre fold along the strip.
  background-image: linear-gradient(to bottom, transparent calc(50% - 1px), rgba(28, 23, 36, 0.12) calc(50% - 1px) 50%, transparent 50%)

.f-slider__fill
  position: relative
  height: 100%
  border-right: 2px solid paper.$ink
  transition: width 75ms linear

.f-slider__input
  position: absolute
  inset: 0
  z-index: 10
  width: 100%
  height: var(--fsl-thumb)
  margin: 0
  opacity: 0
  cursor: pointer
  touch-action: manipulation

.thumb-visual
  position: absolute
  top: 0
  width: var(--fsl-thumb)
  height: var(--fsl-thumb)
  pointer-events: none

.thumb-visual__shadow
  @include paper.shadow-plate(right, 3px)

.thumb-visual__body
  position: absolute
  inset: 0
  border: var(--bw) solid paper.$ink
  background-image: paper.crease(paper.$blue, paper.$blue-shade, 135deg, 50%)
  transition: transform 90ms ease-out
  @include paper.dog-ear-clip

  &::after
    @include paper.dog-ear-flap(paper.$blue-shade)

  .f-slider__row:active &
    transform: translateY(2px)

.f-slider__input:focus-visible ~ .thumb-visual
  outline: 3px solid paper.$blue
  outline-offset: 3px

/* Ensure the native range covers the whole area for better hitboxes */
input[type="range"]
  -webkit-appearance: none
  appearance: none
  background: transparent

  &::-webkit-slider-thumb
    -webkit-appearance: none
    width: var(--fsl-thumb)
    height: var(--fsl-thumb)
    cursor: pointer

  &::-moz-range-thumb
    width: var(--fsl-thumb)
    height: var(--fsl-thumb)
    cursor: pointer
    border: none
    background: transparent
</style>
