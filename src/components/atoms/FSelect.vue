<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'

interface Option {
  value: string | number
  label: string
}

interface Props {
  modelValue: string | number
  options: Option[]
  placeholder?: string
  label?: string
  maxHeight?: string
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'SELECT...',
  // Fluid default: a third of the short axis, never taller than 16rem.
  maxHeight: 'clamp(8rem, 40dvh, 16rem)'
})

const emit = defineEmits(['update:modelValue'])

const isOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

const selectedLabel = computed(() => {
  const option = props.options.find(opt => opt.value === props.modelValue)
  return option ? option.label : props.placeholder
})

const toggle = () => (isOpen.value = !isOpen.value)

const selectOption = (value: string | number) => {
  emit('update:modelValue', value)
  isOpen.value = false
}

// Close when clicking outside
const handleClickOutside = (event: MouseEvent) => {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    isOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', handleClickOutside))
onUnmounted(() => document.removeEventListener('click', handleClickOutside))
</script>

<template lang="pug">
  div.f-select(ref="dropdownRef" :class="{ 'is-open': isOpen }")
    //- Label (Optional)
    div.f-select__label(v-if="label") {{ label }}

    //- The trigger: a parchment sheet with a dog-ear, like FButton.
    button.f-select__trigger(
      type="button"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      @click="toggle"
    )
      span.f-select__shadow(aria-hidden="true")
      span.f-select__body
        span.f-select__value {{ selectedLabel }}
        OrigamiIcon.f-select__arrow(name="right" tone="red")

    //- The dropdown: a parchment list with an ink border.
    transition(name="fsel-unfold")
      div.f-select__menu(v-if="isOpen")
        div.f-select__scroll(
          role="listbox"
          :style="{ maxHeight: maxHeight }"
        )
          div.f-select__option(
            v-for="option in options"
            :key="option.value"
            role="option"
            :aria-selected="modelValue === option.value"
            :class="{ 'is-selected': modelValue === option.value }"
            @click="selectOption(option.value)"
          ) {{ option.label }}
</template>

<style scoped lang="sass">
@use '@/assets/css/paper' as paper

// Fluid metrics so the control reads the same on a 320px phone and a 4K
// desktop; the `min-height` floor guarantees a legal touch target.
.f-select
  --bw: 3px
  --depth: 4px
  --ear: clamp(0.55rem, 2vw, 0.8rem)
  position: relative
  width: 100%
  font-weight: 900

.f-select__label
  margin: 0 0 0.3rem 0.25rem
  font-size: clamp(0.75rem, 3.2vw, 1.1rem)
  text-transform: uppercase
  letter-spacing: 0.04em
  @include paper.ink-text

.f-select__trigger
  position: relative
  display: block
  width: 100%
  padding: 0
  border: 0
  background: none
  cursor: pointer
  user-select: none
  touch-action: manipulation
  -webkit-tap-highlight-color: transparent

  @media (hover: hover)
    &:hover .f-select__body
      transform: translateY(-2px)

  &:active .f-select__body
    transform: translateY(3px)

  &:focus-visible
    outline: 3px solid paper.$blue
    outline-offset: 4px

.f-select__shadow
  @include paper.shadow-plate

.f-select__body
  position: relative
  display: flex
  align-items: center
  justify-content: space-between
  gap: 0.5rem
  min-height: 2.75rem
  min-width: clamp(6rem, 40vw, 9rem)
  padding: clamp(0.4rem, 1.8vw, 0.75rem) calc(clamp(0.6rem, 3vw, 1.1rem) + var(--ear) * 0.5) clamp(0.4rem, 1.8vw, 0.75rem) clamp(0.6rem, 3vw, 1.1rem)
  border: var(--bw) solid paper.$ink
  background-image: paper.soft-crease(paper.$parchment, paper.$parchment-mid)
  color: paper.$ink
  transition: transform 90ms ease-out
  @include paper.dog-ear-clip

  &::after
    @include paper.dog-ear-flap(paper.$parchment-shade)

.f-select__value
  min-width: 0
  overflow: hidden
  text-overflow: ellipsis
  white-space: nowrap
  text-transform: uppercase
  letter-spacing: 0.03em
  font-size: clamp(0.75rem, 3vw, 1.05rem)

.f-select__arrow
  font-size: clamp(0.9rem, 3.4vw, 1.15rem)
  transform: rotate(90deg)
  transition: transform 180ms ease-out

  .f-select.is-open &
    transform: rotate(-90deg)

.f-select__menu
  position: absolute
  z-index: 1
  left: 0
  right: 0
  margin-top: 0.6rem
  border: var(--bw) solid paper.$ink
  background-image: paper.crease(paper.$parchment, paper.$parchment-mid, 160deg, 50%)
  box-shadow: 0 5px 0 paper.$shadow, 0 0.75rem 1.5rem paper.$shadow-soft
  transform-origin: top center

.f-select__scroll
  overflow-y: auto
  padding: 0.35rem
  @include paper.paper-scrollbar

.f-select__option
  position: relative
  display: flex
  align-items: center
  min-height: 2.5rem
  margin-bottom: 0.25rem
  padding: 0.35rem clamp(0.6rem, 2.6vw, 0.9rem)
  border: 2px solid transparent
  color: paper.$ink
  text-transform: uppercase
  letter-spacing: 0.03em
  font-size: clamp(0.75rem, 3vw, 1rem)
  cursor: pointer
  transition: background-color 90ms ease-out, transform 90ms ease-out

  &:last-child
    margin-bottom: 0

  @media (hover: hover)
    &:hover:not(.is-selected)
      background-color: paper.$parchment-shade

  &:active
    transform: translateY(2px)

  &.is-selected
    border-color: paper.$ink
    background-image: paper.soft-crease(paper.$blue, paper.$blue-shade)
    @include paper.ink-text

// Unfold downward from the trigger.
.fsel-unfold-enter-active, .fsel-unfold-leave-active
  transition: transform 180ms ease-out, opacity 140ms ease-out

.fsel-unfold-enter-from, .fsel-unfold-leave-to
  opacity: 0
  transform: perspective(40rem) rotateX(-35deg) scaleY(0.4)
</style>
