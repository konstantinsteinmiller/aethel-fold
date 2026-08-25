<template lang="pug">
  //- Full-size layer rather than a positioned card: the anchor arrives in
  //- normalised device coordinates, so the card is translated inside a box that
  //- is exactly the canvas, and neither side has to know the other's CSS.
  .fc-layer(v-if="editorMode" ref="layer")
    .fc-card(ref="card" :class="{ held: focus.held, scatter: focus.scatter }")
      .fc-head
        span.fc-label {{ focus.label }}
        span.fc-dist {{ distanceLabel }}
      .fc-meta
        span.fc-id {{ focus.defId }}
        span.fc-tris(v-if="focus.tris") {{ focus.tris }} tris
        span.fc-tag(v-if="focus.scatter") scattered
        span.fc-tag.held-tag(v-else-if="focus.held") in hand
      .fc-nums(v-if="!focus.scatter")
        span ⟳ {{ focus.rotationDeg }}°
        span ⤢ {{ focus.scale.toFixed(2) }}×
        span ↕ {{ focus.liftMetres.toFixed(2) }} m
      .fc-acts
        button.fc-act(
          :disabled="!focus.movable"
          :title="moveTitle"
          @click="focusMove"
          @pointerdown.stop
        ) {{ focus.held ? 'Drop' : 'Move' }} #[b F]
        button.fc-act.danger(
          title="Delete this object (X)"
          @click="focusDelete"
          @pointerdown.stop
        ) Delete #[b X]
        template(v-if="!focus.scatter")
          button.fc-act(title="Rotate 90° left (Q)" @click="focusRotate(-90)" @pointerdown.stop) ⟲
          button.fc-act(title="Rotate 90° right (E)" @click="focusRotate(90)" @pointerdown.stop) ⟳
          button.fc-act(title="Shrink one step (−)" @click="focusScale(-1)" @pointerdown.stop) −
          button.fc-act(title="Grow one step (+)" @click="focusScale(1)" @pointerdown.stop) +
          button.fc-act(title="Duplicate and pick up the copy (C)" @click="focusDuplicate" @pointerdown.stop) Copy #[b C]
      .fc-note(v-if="focus.scatter && !focus.movable")
        | No catalogue equivalent — this one can only be deleted.
</template>

<!--
  The focus billboard: what the crosshair is on, floating over it.

  ── Why this component exists at all ────────────────────────────────────────

  The editor's verbs were reachable only as key bindings. That is fine once you
  know them and useless before: nothing on screen said a tree could be deleted,
  so the feature was invisible to anyone who had not read the source. The card
  is the discoverability layer — every button here is also a shortcut, and the
  shortcut is printed on the button.

  ── The split that makes it affordable ──────────────────────────────────────

  Identity comes from `editorFocus`, a `ref`, written only when the focus
  *changes* or the focused prop is edited — a few times a second at most.

  Position comes from `editorFocusScreen`, a plain module object mutated every
  frame by the scene, read here from this component's own `requestAnimationFrame`
  and written straight to `style.transform`. It never touches a Vue proxy.

  That is not micro-optimisation. A HUD tracking a moving object updates at frame
  rate, and routing that through reactivity would put a Vue patch pass on the
  render loop — the exact coupling GDD §0 keeps three.js and Vue apart to avoid.
  The rAF also only runs while editor mode is on, because the whole layer is
  `v-if`-gated and the loop starts and stops with it.

  Deliberately NOT internationalised: a dev tool behind a code word, which the
  project i18n rule exempts along with the perf overlay.
-->

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import {
  editorFocus,
  editorFocusScreen,
  editorMode,
  focusDelete,
  focusDuplicate,
  focusMove,
  focusRotate,
  focusScale
} from '@/world/editor'

const layer = useTemplateRef<HTMLElement>('layer')
const card = useTemplateRef<HTMLElement>('card')

const focus = computed(() => editorFocus.value)

/**
 * Distance readout, held outside the reactive payload.
 *
 * It changes every frame as you walk, so it is written by the rAF into a `ref`
 * only when the rounded metre count actually changes — a number that only takes
 * ~40 distinct values over the card's whole useful range costs one Vue patch per
 * metre travelled rather than one per frame.
 */
const distance = ref(0)
const distanceLabel = computed(() => (distance.value > 0 ? `${distance.value} m` : ''))

const moveTitle = computed(() =>
  focus.value.movable
    ? focus.value.held
      ? 'Put this down where you are aiming (F or G)'
      : focus.value.scatter
        ? 'Take this out of the scatter and pick up its catalogue equivalent (F)'
        : 'Pick this up (F)'
    : 'This species has no catalogue equivalent to become'
)

/**
 * Layer size, cached.
 *
 * The anchor is in NDC, so turning it into pixels needs the layer's box. Reading
 * `getBoundingClientRect` inside the rAF would force layout on every frame; a
 * `ResizeObserver` gives the same number for free.
 */
let layerWidth = 0
let layerHeight = 0
let observer: ResizeObserver | null = null

let rafId: number | null = null
/** Last written transform, so an unchanged frame does no DOM work at all. */
let lastTransform = ''
let lastVisible: boolean | null = null

const tick = (): void => {
  rafId = requestAnimationFrame(tick)
  const element = card.value
  if (!element) {
    return
  }

  // Hidden whenever the anchor is off screen *or* nothing is focused. Both
  // states have to be checked here rather than with a `v-if`, because the
  // anchor moves without the identity changing — a `v-if` on `onScreen` would
  // mount and unmount the card as you turn.
  const visible = editorFocusScreen.onScreen && editorFocus.value.id !== ''
  if (visible !== lastVisible) {
    lastVisible = visible
    element.style.opacity = visible ? '1' : '0'
    element.style.pointerEvents = visible ? 'auto' : 'none'
  }
  if (!visible) {
    return
  }

  const x = (editorFocusScreen.x * 0.5 + 0.5) * layerWidth
  const y = (-editorFocusScreen.y * 0.5 + 0.5) * layerHeight
  // Rounded to whole pixels: sub-pixel translation on a text panel is what makes
  // a HUD shimmer, and the anchor is a world position so it never sits still.
  const transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, -100%)`
  if (transform !== lastTransform) {
    lastTransform = transform
    element.style.transform = transform
  }

  const metres = Math.round(editorFocusScreen.distance)
  if (metres !== distance.value) {
    distance.value = metres
  }
}

const start = (): void => {
  if (rafId !== null) {
    return
  }
  const host = layer.value
  if (!host) {
    // The `v-if` has not put the layer in the DOM yet. Retry rather than give
    // up: bailing here once is a card that never appears for the rest of the
    // session, with nothing to say why.
    if (editorMode.value) {
      requestAnimationFrame(start)
    }
    return
  }
  layerWidth = host.clientWidth
  layerHeight = host.clientHeight
  observer = new ResizeObserver(() => {
    layerWidth = host.clientWidth
    layerHeight = host.clientHeight
  })
  observer.observe(host)
  lastTransform = ''
  lastVisible = null
  rafId = requestAnimationFrame(tick)
}

const stop = (): void => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  observer?.disconnect()
  observer = null
}

// Keyed off the mode rather than `onMounted`, because the layer element only
// exists while the mode is on — and starting the loop against a null ref is how
// this would silently never run.
watch(
  editorMode,
  on => {
    if (!on) {
      stop()
      return
    }
    // After the `v-if` has put the layer in the DOM.
    requestAnimationFrame(start)
  },
  { immediate: true }
)

onBeforeUnmount(stop)
</script>

<style scoped lang="sass">
// Sits above the canvas and below the panels, and passes every pointer event
// through except on the card itself — the crosshair has to keep working.
.fc-layer
  position: absolute
  inset: 0
  z-index: 35
  pointer-events: none
  overflow: hidden

.fc-card
  position: absolute
  top: 0
  left: 0
  min-width: 11rem
  max-width: 17rem
  padding: 0.4rem 0.5rem
  border: 1px solid #445068
  border-radius: 5px
  background: rgba(14, 18, 28, 0.86)
  backdrop-filter: blur(3px)
  color: #cfd9ee
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace
  font-size: 0.66rem
  line-height: 1.35
  opacity: 0
  // Opacity only. A transition on `transform` would smear the card behind the
  // prop it names every time the camera moves.
  transition: opacity 0.12s ease-out
  // Cheap insurance against the card overlapping its own prop's outline.
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45)

  // Cyan for something aimed at, warm gold for something carried — the same
  // two colours the scene-side outline highlight uses, so the card and the
  // silhouette never disagree about which state you are in.
  border-color: #5fd0d8
  &.held
    border-color: #e8c98f
  &.scatter
    border-color: #8fd6a2

.fc-head
  display: flex
  align-items: baseline
  justify-content: space-between
  gap: 0.5rem
.fc-label
  font-weight: 700
  color: #eaf1ff
.fc-dist
  flex: 0 0 auto
  color: #7f8ea8

.fc-meta
  display: flex
  flex-wrap: wrap
  align-items: center
  gap: 0.3rem
  margin-top: 0.1rem
  color: #8fa0c0
.fc-tris
  color: #a9b8d4
.fc-tag
  padding: 0 0.25rem
  border-radius: 2px
  background: #21402c
  color: #9fe0b4
  &.held-tag
    background: #40361f
    color: #e8c98f

.fc-nums
  display: flex
  gap: 0.55rem
  margin-top: 0.15rem
  color: #9aa9c4

.fc-acts
  display: flex
  flex-wrap: wrap
  gap: 0.22rem
  margin-top: 0.35rem
.fc-act
  flex: 0 0 auto
  padding: 0.16rem 0.34rem
  border: 1px solid #445068
  border-radius: 3px
  background: #2a3040
  color: #cfd9ee
  font: inherit
  cursor: pointer
  b
    color: #8fd6a2
    font-weight: 700
  &:hover:not(:disabled)
    background: #343c50
  &:disabled
    opacity: 0.4
    cursor: not-allowed
  &.danger
    border-color: #6b3d3d
    background: #3a2626
    color: #e8b4b4
    &:hover
      background: #4a2f2f

.fc-note
  margin-top: 0.25rem
  color: #7f8ea8
</style>
