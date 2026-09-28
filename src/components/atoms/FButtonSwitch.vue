<script setup lang="ts" generic="T extends string | number">
// Multi-option paper switch: a parchment strip with an ink border, the active
// option a creased sheet of yellow paper raised off it. Renders one button per option; the active
// one is highlighted. Click events bubble up via `click` so the parent can
// decide whether to actually change the model value (e.g. gating a choice
// behind a rewarded video).

interface Option {
  value: T
}

interface Props {
  modelValue: T
  options: Option[]
}

defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: T): void
  (e: 'click', value: T): void
}>()

const onClick = (value: T) => {
  emit('click', value)
  emit('update:modelValue', value)
}
</script>

<template lang="pug">
  div.button-switch
    //- Periwinkle desk shadow under the strip.
    div.button-switch__shadow(aria-hidden="true")
    //- Parchment strip
    div.button-switch__strip(role="group")
      div.relative.button-wrap(v-for="option in options" :key="option.value")
        button.button-switch__option(
          type="button"
          :class="{ 'is-active': modelValue === option.value }"
          :aria-pressed="modelValue === option.value"
          @click="onClick(option.value)"
        )
          slot(name="default" :option="option" :is-active="modelValue === option.value") {{ option.value }}
        slot(name="hint" :option="option" :is-active="modelValue === option.value")
</template>

<style scoped lang="sass">
@use '@/assets/css/paper' as paper

.button-switch
  --bw: 2.5px
  --ear: clamp(0.45rem, 1.8vw, 0.65rem)
  position: relative
  display: inline-block
  max-width: 100%

.button-switch__shadow
  @include paper.shadow-plate

.button-switch__strip
  position: relative
  display: flex
  border: var(--bw) solid paper.$ink
  background-image: paper.crease(paper.$parchment, paper.$parchment-mid, 170deg, 55%)
  @include paper.dog-ear-clip

  &::after
    @include paper.dog-ear-flap(paper.$parchment-shade)

.button-wrap + .button-wrap
  border-left: 2px dashed rgba(28, 23, 36, 0.25)

.button-switch__option
  position: relative
  display: flex
  align-items: center
  justify-content: center
  min-width: 2.75rem
  min-height: 2.5rem
  height: 100%
  padding: clamp(0.3rem, 1.2vw, 0.5rem) clamp(0.6rem, 2.6vw, 1rem)
  border: 0
  background: none
  color: paper.$ink
  font-weight: 900
  line-height: 1
  font-size: clamp(0.7rem, 2.8vw, 0.9rem)
  cursor: pointer
  touch-action: manipulation
  -webkit-tap-highlight-color: transparent
  transition: transform 90ms ease-out, opacity 90ms ease-out
  opacity: 0.7

  @media (hover: hover)
    &:hover:not(.is-active)
      opacity: 1

  &:active
    transform: translateY(2px)

  &:focus-visible
    outline: 3px solid paper.$blue
    outline-offset: -3px

  &.is-active
    opacity: 1
    background-image: paper.soft-crease(paper.$yellow, paper.$yellow-shade)
    box-shadow: inset 0 0 0 2px paper.$ink
    @include paper.ink-text
</style>
