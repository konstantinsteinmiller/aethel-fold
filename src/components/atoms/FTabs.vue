<script setup lang="ts">
export interface TabOption {
  label: string
  value: string | number
  /** Optional image icon shown instead of the label. */
  icon?: string
}

interface Props {
  modelValue: string | number
  options: TabOption[]
}

defineProps<Props>()
const emit = defineEmits(['update:modelValue'])

const selectTab = (value: string | number): void => {
  emit('update:modelValue', value)
}
</script>

<template lang="pug">
  //- The row scrolls horizontally rather than wrapping: on a 320px phone with
  //- four tabs, wrapping would push the modal content down and the previous
  //- fixed padding compensation would no longer clear the header.
  div.f-tabs(role="tablist")
    button.f-tabs__tab(
      v-for="tab in options"
      :key="tab.value"
      type="button"
      role="tab"
      :aria-selected="modelValue === tab.value"
      :class="{ 'is-active': modelValue === tab.value }"
      @click="selectTab(tab.value)"
    )
      span.f-tabs__shadow(aria-hidden="true")
      span.f-tabs__body
        img.f-tabs__icon(v-if="tab.icon" :src="tab.icon" :alt="tab.label" draggable="false")
        span.f-tabs__label(v-else) {{ tab.label }}
</template>

<style scoped lang="sass">
@use '@/assets/css/paper' as paper

// Paper tabs: parchment slips tucked behind the active one, which is a creased
// sheet of red paper with a dog-ear, raised and outlined in ink.
.f-tabs
  display: flex
  align-items: flex-end
  justify-content: center
  gap: clamp(0.1rem, 0.6vw, 0.25rem)
  max-width: 100%
  padding-inline: clamp(0.25rem, 2vw, 1rem)
  // Room for the raised active tab and its shadow inside the scroller.
  padding-top: 0.35rem
  overflow-x: auto
  overflow-y: hidden
  scrollbar-width: none

  &::-webkit-scrollbar
    display: none

.f-tabs__tab
  --bw: 3px
  --ear: clamp(0.45rem, 1.8vw, 0.7rem)
  --tab-from: #{paper.$parchment-mid}
  --tab-to: #{paper.$parchment-shade}
  position: relative
  flex: 0 0 auto
  // Floor so a tab can never render as an invisible sliver.
  min-width: 3.25rem
  min-height: 2.5rem
  padding: 0
  border: 0
  background: none
  cursor: pointer
  transition: translate 140ms ease-out
  -webkit-tap-highlight-color: transparent

  @media (hover: hover)
    &:hover:not(.is-active)
      translate: 0 -0.12rem

  &:active
    translate: 0 2px

  &:focus-visible
    outline: 3px solid paper.$blue
    outline-offset: 2px

  &.is-active
    --tab-from: #{paper.$red}
    --tab-to: #{paper.$red-shade}
    z-index: 10
    translate: 0 -0.3rem

.f-tabs__shadow
  position: absolute
  inset: 0
  background-color: paper.$shadow
  transform: translateY(3px)
  @include paper.dog-ear-clip

.f-tabs__body
  position: relative
  display: flex
  align-items: center
  justify-content: center
  min-height: 2.5rem
  padding: clamp(0.2rem, 1vw, 0.4rem) calc(clamp(0.6rem, 3.2vw, 1.35rem) + var(--ear) * 0.3) clamp(0.2rem, 1vw, 0.4rem) clamp(0.6rem, 3.2vw, 1.35rem)
  border: var(--bw) solid paper.$ink
  background-image: paper.crease(var(--tab-from), var(--tab-to), 150deg, 56%)
  color: paper.$ink
  @include paper.dog-ear-clip

  &::after
    @include paper.dog-ear-flap(var(--tab-to))

  .f-tabs__tab.is-active &
    @include paper.ink-text

.f-tabs__label
  font-weight: 900
  text-transform: uppercase
  letter-spacing: 0.05em
  white-space: nowrap
  font-size: clamp(0.65rem, 2.9vw, 1rem)

.f-tabs__icon
  width: clamp(1.15rem, 5vw, 1.75rem)
  height: clamp(1.15rem, 5vw, 1.75rem)
  object-fit: contain
  pointer-events: none
</style>
