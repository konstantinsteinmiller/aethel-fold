<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import FTabs, { type TabOption } from '@/components/atoms/FTabs.vue'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'
import useSounds from '@/use/useSound'
import { acquireModalOpen } from '@/use/useModalState'

interface Props {
  modelValue: boolean | any
  title?: string
  isClosable?: boolean
  tabs?: TabOption[]
  activeTab?: string | number
}

const props = withDefaults(defineProps<Props>(), {
  isClosable: true,
  tabs: () => []
})

const emit = defineEmits(['update:modelValue', 'update:activeTab'])

// Root is a <Teleport>, so class/style passed by parents can't auto-inherit and
// Vue warns about extraneous attrs. Opt out and forward $attrs explicitly.
defineOptions({ inheritAttrs: false })

const { playSound } = useSounds()

// ─── Header / content overlap ───────────────────────────────────────────────
//
// The ribbon header deliberately overhangs the frame's top edge (that's the
// look). Previously the content slot compensated with a hard-coded
// `pt-6 sm:pt-7 md:pt-9`, which is a guess: it was too small when the title
// wrapped to two lines or the tab row grew, and the first row of content ended
// up UNDER the ribbon.
//
// Now the header's real height is measured with a ResizeObserver and published
// as `--fmodal-header-overlap`. The content slot pads by exactly the amount the
// header actually overhangs, so an overlap is impossible at any viewport, in
// any language, at any font size.
const headerRef = ref<HTMLElement | null>(null)
const headerOverlap = ref(0)
let observer: ResizeObserver | null = null

/** How far the header dips INTO the frame, in px. The header sits above the
 *  frame and is pulled down by this much (see `--fmodal-header-overlap`), so the
 *  content must clear exactly that plus a small breathing gap. */
const HEADER_DIP_RATIO = 0.55
/** The ribbon's folded tails hang below its band by this fraction of the
 *  header's height; the content clears them too (`--fmodal-header-clear`). */
const TAIL_HANG_RATIO = 0.14

const headerClear = ref(0)

const measureHeader = (): void => {
  const el = headerRef.value
  if (!el) { headerOverlap.value = 0; headerClear.value = 0; return }
  const h = el.getBoundingClientRect().height
  headerOverlap.value = h > 0 ? Math.round(h * HEADER_DIP_RATIO) : 0
  // Tabs have no tails; only the ribbon hangs below its own box.
  const hang = props.tabs && props.tabs.length > 0 ? 0 : TAIL_HANG_RATIO
  headerClear.value = h > 0 ? Math.round(h * (HEADER_DIP_RATIO + hang)) : 0
}

const attachObserver = async (): Promise<void> => {
  await nextTick()
  if (!headerRef.value) return
  observer?.disconnect()
  observer = new ResizeObserver(measureHeader)
  observer.observe(headerRef.value)
  measureHeader()
}

// ─── Modal-open signal (CrazyGames gameplayStop/Start) ──────────────────────
// Centralised here so every FModal consumer participates without per-modal
// wiring. Refcounted; held once per open, dropped on close or unmount.
let releaseModalOpen: (() => void) | null = null
const markOpen = (): void => { if (!releaseModalOpen) releaseModalOpen = acquireModalOpen() }
const markClosed = (): void => { releaseModalOpen?.(); releaseModalOpen = null }

watch(() => props.modelValue, (open, prev) => {
  if (open && !prev) playSound('modal-open', 0.07)
  if (open) { markOpen(); void attachObserver() } else { markClosed(); observer?.disconnect() }
})

// Re-measure when the header's content changes (title text, tab set).
watch(() => [props.title, props.tabs?.length], () => { void nextTick(measureHeader) })

onMounted(() => {
  if (props.modelValue) { markOpen(); void attachObserver() }
})
onUnmounted(() => {
  markClosed()
  observer?.disconnect()
  observer = null
})

const close = (): void => emit('update:modelValue', false)
const handleTabChange = (val: string | number): void => emit('update:activeTab', val)
</script>

<template lang="pug">
  //- Teleport to body so `position: fixed` isn't trapped by an ancestor
  //- transform, which would promote that ancestor to a containing block.
  Teleport(to="body")
    //- The root carries no transition of its own (the veil fades and the sheet
    //- unfolds, see the styles), so the durations are given explicitly.
    Transition(
      name="fmodal-unfold"
      appear
      :duration="{ enter: 360, leave: 200 }"
    )
      div.f-modal(
        v-if="modelValue"
        v-bind="$attrs"
        :style="{ '--fmodal-header-overlap': headerOverlap + 'px', '--fmodal-header-clear': headerClear + 'px' }"
        role="dialog"
        aria-modal="true"
      )
        //- Backdrop: a warm veil over the desk.
        div.f-modal__backdrop(@click="isClosable && close()")

        div.f-modal__container(:class="{ 'has-header': (tabs && tabs.length > 0) || title }")
          //- Header (die-cut paper ribbon or tab bar). Lives IN the layout flow
          //- so it can never be pushed above the viewport's top edge, and is
          //- inset on both sides so it can never reach the close chip.
          div.f-modal__header(
            v-if="(tabs && tabs.length > 0) || title"
            ref="headerRef"
          )
            FTabs(
              v-if="tabs && tabs.length > 0"
              :model-value="activeTab"
              :options="tabs"
              @update:model-value="handleTabChange"
            )
            div.f-modal__ribbon(v-else-if="title")
              span.f-modal__ribbon-tail.is-left(aria-hidden="true")
              span.f-modal__ribbon-tail.is-right(aria-hidden="true")
              span.f-modal__ribbon-shadow(aria-hidden="true")
              span.f-modal__ribbon-body
                span.f-modal__ribbon-text {{ title }}

          //- Frame
          div.f-modal__frame-wrap
            span.f-modal__frame-shadow(aria-hidden="true")
            //- Close chip. First in tab order, but outside .f-modal__frame on purpose: the frame is
            //- clip-pathed (dog-ear) and would cut off the overhanging corner.
            button.f-modal__close(
              v-if="isClosable"
              type="button"
              aria-label="Close"
              @click="close"
            )
              span.f-modal__close-shadow(aria-hidden="true")
              span.f-modal__close-body
                OrigamiIcon.f-modal__close-icon(name="close" tone="white")
            div.f-modal__frame
              //- Scrollable content. Top padding is the MEASURED header
              //- overhang plus a gap — never a guess.
              div.f-modal__content
                slot

              //- Footer — pinned, collapses out of layout when empty.
              div.f-modal__footer
                slot(name="footer")

</template>

<style scoped lang="sass">
@use '@/assets/css/paper' as paper

.f-modal
  // Close chip size — also the inset that keeps the ribbon clear of it.
  --fmodal-close: clamp(2.5rem, 8.5vw, 2.9rem)
  // How far the chip overhangs the frame's corner.
  --fmodal-close-out: 0.28
  // The ribbon's tails: width, and how far each one sticks out of the band.
  --fmodal-tail: clamp(1.1rem, 5vw, 2rem)
  --fmodal-tail-out: 0.7
  position: fixed
  inset: 0
  z-index: 50
  display: flex
  align-items: center
  justify-content: center
  padding: calc(clamp(0.4rem, 2vw, 1rem) + env(safe-area-inset-top, 0px)) calc(clamp(0.4rem, 2vw, 1rem) + env(safe-area-inset-right, 0px)) calc(clamp(0.4rem, 2vw, 1rem) + env(safe-area-inset-bottom, 0px)) calc(clamp(0.4rem, 2vw, 1rem) + env(safe-area-inset-left, 0px))

.f-modal__backdrop
  position: absolute
  inset: 0
  background: radial-gradient(ellipse at 50% 40%, rgba(58, 36, 22, 0.55) 0%, rgba(30, 18, 11, 0.82) 75%)
  backdrop-filter: blur(3px)

.f-modal__container
  position: relative
  display: flex
  flex-direction: column
  width: 100%
  max-width: min(42rem, 96vw)
  max-height: 100%
  // Room for the close chip's overhang, so it never leaves the viewport.
  padding-top: calc(var(--fmodal-close) * var(--fmodal-close-out))
  padding-right: calc(var(--fmodal-close) * var(--fmodal-close-out))
  transform-origin: 50% 0
  // Explicit `min-height: 0` chain so the content can scroll inside 100dvh.
  min-height: 0

  // With a header the ribbon/tabs already sit above the frame's top edge.
  &.has-header
    padding-top: 0

.f-modal__header
  position: relative
  z-index: 20
  display: flex
  flex-shrink: 0
  justify-content: center
  // Keep the ribbon (and its tails) out of the close chip's corner at any
  // title length, in any language.
  padding-inline: calc(var(--fmodal-close) * 0.85 + var(--fmodal-tail) * var(--fmodal-tail-out))
  // The ribbon dips into the frame by HEADER_DIP_RATIO of its own height; the
  // negative margin removes that dip from the layout flow so the frame starts
  // underneath it.
  margin-bottom: calc(var(--fmodal-header-overlap, 0px) * -1)

// ─── The ribbon: a die-cut strip of red paper with swallow-tailed ends ──────
//
// clip-path deletes borders along a cut, so every die-cut piece is two layers:
// an ink silhouette and the paper inset inside it by the border width.

.f-modal__ribbon
  --notch: clamp(0.55rem, 2.4vw, 0.95rem)
  --bw: 3px
  position: relative
  max-width: 100%

.f-modal__ribbon-shadow
  position: absolute
  inset: 0
  background-color: paper.$shadow
  transform: translateY(4px)
  clip-path: polygon(0 0, 100% 0, calc(100% - var(--notch)) 50%, 100% 100%, 0 100%, var(--notch) 50%)

.f-modal__ribbon-body
  position: relative
  z-index: 1
  display: flex
  align-items: center
  justify-content: center
  min-height: 2.25rem
  padding: clamp(0.3rem, 1.4vw, 0.6rem) calc(var(--notch) + clamp(0.7rem, 4vw, 2rem))
  background-color: paper.$ink
  clip-path: polygon(0 0, 100% 0, calc(100% - var(--notch)) 50%, 100% 100%, 0 100%, var(--notch) 50%)

  // The red paper, inset by the ink width, with a lengthwise crease.
  &::before
    content: ''
    position: absolute
    inset: var(--bw)
    background-image: linear-gradient(to bottom, paper.$red 0 52%, paper.$red-shade 52% 100%)
    clip-path: polygon(0 0, 100% 0, calc(100% - var(--notch) + var(--bw) * 0.5) 50%, 100% 100%, 0 100%, calc(var(--notch) - var(--bw) * 0.5) 50%)

// The folded-back tails, hanging lower behind each end of the band.
.f-modal__ribbon-tail
  position: absolute
  top: 30%
  bottom: -14%
  width: var(--fmodal-tail)
  background-color: paper.$ink

  &::before
    content: ''
    position: absolute
    inset: var(--bw)
    background-color: paper.$red-shade

  &.is-left
    left: calc(var(--fmodal-tail) * var(--fmodal-tail-out) * -1)
    clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 45% 50%)

    &::before
      clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 45% 50%)

  &.is-right
    right: calc(var(--fmodal-tail) * var(--fmodal-tail-out) * -1)
    clip-path: polygon(0 0, 100% 0, 55% 50%, 100% 100%, 0 100%)

    &::before
      clip-path: polygon(0 0, 100% 0, 55% 50%, 100% 100%, 0 100%)

.f-modal__ribbon-text
  position: relative
  font-weight: 900
  text-transform: uppercase
  letter-spacing: 0.05em
  text-align: center
  font-size: clamp(0.95rem, 4.4vw, 1.85rem)
  line-height: 1.15
  overflow-wrap: anywhere
  @include paper.ink-text

// ─── The frame: a parchment sheet ───────────────────────────────────────────

.f-modal__frame-wrap
  --bw: 3px
  --ear: clamp(1rem, 4.4vw, 1.9rem)
  --depth: 6px
  position: relative
  display: flex
  flex: 1 1 auto
  flex-direction: column
  // `min-height: 0` lets the inner scroll container actually scroll instead of
  // stretching the frame to fit its content.
  min-height: 0

.f-modal__frame-shadow
  @include paper.shadow-plate(left)

.f-modal__frame
  position: relative
  display: flex
  flex: 1 1 auto
  flex-direction: column
  min-height: 0
  border: var(--bw) solid paper.$ink
  // An unfolded sheet: a faint vertical centre fold, soft creases across two
  // corners, and the diagonal fold between the lit and shaded halves.
  background-image: linear-gradient(to right, transparent calc(50% - 1px), rgba(76, 64, 120, 0.1) calc(50% - 1px) 50%, transparent 50%), linear-gradient(135deg, transparent calc(100% - 2.6rem), rgba(76, 64, 120, 0.16) calc(100% - 2.6rem) calc(100% - 2.6rem + 1px), transparent calc(100% - 2.6rem + 1px)), linear-gradient(45deg, transparent 0 2.2rem, rgba(76, 64, 120, 0.14) 2.2rem calc(2.2rem + 1px), transparent calc(2.2rem + 1px)), paper.crease(paper.$parchment, paper.$parchment-mid, 135deg, 50%)
  color: paper.$ink
  @include paper.dog-ear-clip(left)

  &::after
    @include paper.dog-ear-flap(paper.$parchment-shade, left)

.f-modal__content
  flex: 1 1 auto
  min-height: 0
  overflow-y: auto
  overscroll-behavior: contain
  color: paper.$ink
  text-align: center
  // The measured header overhang (plus the ribbon tails) plus a breathing gap.
  // This is the fix for the "header overlaps the content" bug — it is derived,
  // not guessed.
  padding-top: calc(var(--fmodal-header-clear, var(--fmodal-header-overlap, 0px)) + clamp(0.6rem, 2.4vw, 1.1rem))
  padding-bottom: clamp(0.4rem, 1.6vw, 0.75rem)
  padding-inline: clamp(0.6rem, 3vw, 1.5rem)
  @include paper.paper-scrollbar

  // Without a header nothing dips in, but the dog-ear and the close chip still
  // occupy the top corners.
  .f-modal__container:not(.has-header) &
    padding-top: calc(var(--fmodal-close) * 0.75)

.f-modal__footer
  flex-shrink: 0
  display: flex
  flex-wrap: wrap
  justify-content: center
  gap: clamp(0.4rem, 2.4vw, 1rem)
  padding-top: clamp(0.3rem, 1.2vw, 0.5rem)
  padding-bottom: clamp(0.5rem, 1.8vw, 0.9rem)
  padding-inline: clamp(0.5rem, 3vw, 1.5rem)

  &:empty
    display: none

// ─── Close chip: a red origami square at the frame's top-right corner ───────

.f-modal__close
  --bw: 2.5px
  --ear: clamp(0.45rem, 1.8vw, 0.65rem)
  position: absolute
  top: 0
  right: 0
  z-index: 30
  translate: calc(var(--fmodal-close-out) * 100%) calc(var(--fmodal-close-out) * -100%)
  width: var(--fmodal-close)
  height: var(--fmodal-close)
  min-width: 2.5rem
  min-height: 2.5rem
  padding: 0
  border: 0
  background: none
  cursor: pointer
  touch-action: manipulation
  -webkit-tap-highlight-color: transparent

  @media (hover: hover)
    &:hover .f-modal__close-body
      transform: translateY(-2px)

  &:active .f-modal__close-body
    transform: translateY(3px)

  &:focus-visible
    outline: 3px solid paper.$blue
    outline-offset: 3px

.f-modal__close-shadow
  @include paper.shadow-plate

.f-modal__close-body
  position: relative
  display: flex
  align-items: center
  justify-content: center
  width: 100%
  height: 100%
  border: var(--bw) solid paper.$ink
  background-image: paper.crease(paper.$red, paper.$red-shade, 135deg, 55%)
  transition: transform 90ms ease-out
  @include paper.dog-ear-clip

  &::after
    @include paper.dog-ear-flap(paper.$red-shade)

.f-modal__close-icon
  position: relative
  font-size: 52%

// ─── Enter / leave: the veil fades, the sheet unfolds from its top edge ─────

.f-modal.fmodal-unfold-enter-active
  .f-modal__backdrop
    transition: opacity 240ms ease-out
  .f-modal__container
    transition: transform 360ms cubic-bezier(0.2, 0.8, 0.3, 1), opacity 200ms ease-out

.f-modal.fmodal-unfold-leave-active
  .f-modal__backdrop
    transition: opacity 200ms ease-in
  .f-modal__container
    transition: transform 200ms ease-in, opacity 180ms ease-in

.f-modal.fmodal-unfold-enter-from, .f-modal.fmodal-unfold-leave-to
  .f-modal__backdrop
    opacity: 0
  .f-modal__container
    opacity: 0
    transform: perspective(60rem) rotateX(-18deg) scaleY(0.2)

@media (prefers-reduced-motion: reduce)
  .f-modal.fmodal-unfold-enter-from, .f-modal.fmodal-unfold-leave-to
    .f-modal__container
      transform: none

// ─── Short viewports (landscape phone, embedded iframe) ─────────────────────
// Claim the full short axis so the header is never pushed off-screen and the
// dead space above the modal collapses.
@media (max-height: 520px)
  .f-modal
    --fmodal-close: 2.5rem
    align-items: stretch
    padding-block: calc(0.3rem + env(safe-area-inset-top, 0px)) calc(0.3rem + env(safe-area-inset-bottom, 0px))

  .f-modal__container
    max-width: min(46rem, 98vw)
    max-height: 100%

  .f-modal__frame-wrap
    --ear: clamp(0.8rem, 3vh, 1.2rem)

  .f-modal__ribbon-body
    min-height: 2rem
    padding-block: 0.2rem

  .f-modal__ribbon-text
    font-size: clamp(0.85rem, 3.4vh, 1.2rem)
</style>
