<template lang="pug">
  //- Kept a <div> (not a <button>) so a parent's button order is unchanged;
  //- role/tabindex/keys give it the same accessibility as one.
  div.f-switch(
    role="switch"
    tabindex="0"
    :aria-checked="modelValue"
    :class="{ 'is-on': modelValue }"
    @click="toggle"
    @keydown.enter.prevent="toggle"
    @keydown.space.prevent="toggle"
  )
    span.f-switch__label
      slot
    //- A strip of paper: red when off, green when on, with a folded parchment
    //- square sliding along it.
    span.f-switch__track(aria-hidden="true")
      span.f-switch__knob
</template>

<script setup lang="ts">
interface Props {
  modelValue: boolean
}

const props = defineProps<Props>()
const emit = defineEmits(['update:modelValue'])

const toggle = () => {
  emit('update:modelValue', !props.modelValue)
}
</script>

<style lang="sass" scoped>
@use '@/assets/css/paper' as paper

.f-switch
  --bw: 2.5px
  --fsw-h: clamp(2rem, 7vw, 2.25rem)
  --fsw-w: calc(var(--fsw-h) * 1.8)
  --fsw-knob: calc(var(--fsw-h) - var(--bw) * 2 - 0.3rem)
  display: flex
  align-items: center
  gap: clamp(0.5rem, 2.4vw, 0.75rem)
  min-height: 2.5rem
  cursor: pointer
  user-select: none
  touch-action: manipulation
  -webkit-tap-highlight-color: transparent

  &:focus-visible
    outline: 3px solid paper.$blue
    outline-offset: 4px

.f-switch__label
  font-size: clamp(0.8rem, 3vw, 0.95rem)
  text-transform: uppercase
  letter-spacing: 0.03em
  @include paper.ink-text

.f-switch__track
  position: relative
  flex: 0 0 auto
  width: var(--fsw-w)
  min-width: 3.5rem
  height: var(--fsw-h)
  border: var(--bw) solid paper.$ink
  border-radius: 0.2rem
  background-image: paper.crease(paper.$red, paper.$red-shade, 170deg, 50%)
  box-shadow: 0 3px 0 paper.$shadow
  transition: background-image 160ms ease-out

  .f-switch.is-on &
    background-image: paper.crease(paper.$green, paper.$green-shade, 170deg, 50%)

.f-switch__knob
  position: absolute
  top: 50%
  left: 0.15rem
  width: var(--fsw-knob)
  height: var(--fsw-knob)
  border: 2px solid paper.$ink
  background-image: paper.crease(paper.$parchment, paper.$parchment-shade, 135deg, 50%)
  box-shadow: 0 2px 0 paper.$shadow
  transform: translate(0, -50%)
  transition: left 180ms ease-out

  .f-switch.is-on &
    left: calc(100% - var(--fsw-knob) - 0.15rem)

  .f-switch:active &
    transform: translate(0, calc(-50% + 1px))
</style>
