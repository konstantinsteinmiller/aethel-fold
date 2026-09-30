<script setup lang="ts">
/**
 * The wordless teacher (GDD §6 0:01): "A floating, stylized white hand cursor
 * mimics a swipe motion along the curve." It performs every gesture the game
 * needs — swipe, tap, two-finger spread, corner drag — exactly where the
 * player should do it. A one-line hint sits under it for players who read.
 *
 * Driven imperatively once per frame by the scene (`update`), so following a
 * shaking camera costs a few style writes, not a Vue render.
 *
 * On a lesson's first encounter (roadmap #4) the logic runs a demonstration
 * (`lesson.demo`): the hand then drops its CSS loop and is posed from the
 * demo's progress instead, so it moves in lockstep with the ghost flap the 3D
 * view draws from the same numbers — sweep, glide, press — and fades with it.
 *
 * The hand's points are on the page plane, at a 3D point (`world`: a book on
 * the desk shelf) or on the HUD's shelf zoom button (`zoom`, resolved by the
 * host's `anchor` callback) — then it sits above the HUD.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'
import type { LessonState } from '@/fold/logic/lessons'
import type { ScreenPoint } from '@/fold/render/GameView'

const props = defineProps<{
  touch: boolean
  /** Hold to fold is on (roadmap #14): the hint names the press-and-hold instead of the swipe. */
  hold?: boolean
}>()
/** Lessons whose gesture hold to fold replaces. */
const HOLD_HINT: Readonly<Record<string, string>> = {
  swipe: 'fold.hint.hold',
  shield: 'fold.hint.hold',
  launch: 'fold.hint.hold',
  ridge: 'fold.hint.hold',
  frog: 'fold.hint.hold',
  peel: 'fold.hint.holdPeel',
  crease: 'fold.hint.holdCrease',
  spread: 'fold.hint.holdCrease',
  core: 'fold.hint.holdCrease',
  sling: 'fold.hint.slingTap'
}
const { t } = useI18n()

const root = ref<HTMLDivElement | null>(null)
const visible = ref(false)
const gesture = ref<'swipe' | 'tap' | 'spread' | 'drag'>('swipe')
const lessonId = ref<string | null>(null)
const step = ref(0)
const hud = ref(false)
const hint = ref(false)
const demo = ref(false)
/** The demo is a press and hold (hold to fold): no trail, the ring fills as the paper folds. */
const holding = ref(false)
const a: ScreenPoint = { x: 0, y: 0, visible: false }
const b: ScreenPoint = { x: 0, y: 0, visible: false }
const tp: ScreenPoint = { x: 0, y: 0, visible: false }
let lastRev = -1

const hintText = computed(() => {
  const id = lessonId.value
  if (!id) return ''
  const held = props.hold ? HOLD_HINT[id] : undefined
  if (held) return t(held)
  if (id === 'spread' || id === 'core') return t(props.touch ? 'fold.hint.spreadTouch' : 'fold.hint.spreadMouse')
  if (id === 'shelf') return t(step.value === 0 ? 'fold.hint.shelfZoom' : 'fold.hint.shelf')
  return t(`fold.hint.${id}`)
})

const update = (
  lesson: LessonState,
  project: (x: number, y: number, z: number, out: ScreenPoint) => ScreenPoint,
  anchor?: (name: 'zoom', out: ScreenPoint) => boolean
): void => {
  const show = !!lesson.id && lesson.showHand
  if (show !== visible.value) visible.value = show
  const d = lesson.demo
  const on = show && d.phase !== 'off'
  if (on !== demo.value) demo.value = on
  const held = on && d.kind === 'hold'
  if (held !== holding.value) holding.value = held
  if (!show || !root.value) return
  if (lesson.rev !== lastRev) {
    lastRev = lesson.rev
    gesture.value = lesson.hand.gesture
    lessonId.value = lesson.id
    step.value = lesson.step
    hud.value = lesson.hand.anchor === 'zoom'
    hint.value = lesson.hint
  }
  const h = lesson.hand
  if (h.anchor === 'zoom') {
    if (!anchor?.('zoom', a)) a.x = a.y = -9999
    b.x = a.x
    b.y = a.y
  } else {
    const y = h.anchor === 'world' ? h.y : 0
    project(h.ax, y, h.az, a)
    project(h.bx, y, h.bz, b)
  }
  const s = root.value.style
  s.setProperty('--ax', `${a.x}px`)
  s.setProperty('--ay', `${a.y}px`)
  s.setProperty('--bx', `${b.x}px`)
  s.setProperty('--by', `${b.y}px`)
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  s.setProperty('--len', `${len}px`)
  s.setProperty('--ang', `${Math.atan2(b.y - a.y, b.x - a.x)}rad`)

  if (!on) return
  // Where the demo's finger is: taps and spreads stay on A; swipes and drags
  // travel A → B, then (stamp) glide on to the tap point.
  let hx = a.x
  let hy = a.y
  if (h.gesture === 'swipe' || h.gesture === 'drag') {
    hx += (b.x - a.x) * d.hand
    hy += (b.y - a.y) * d.hand
    if (d.glide > 0) {
      project(d.tx, 0, d.tz, tp)
      hx += (tp.x - hx) * d.glide
      hy += (tp.y - hy) * d.glide
    }
  }
  s.setProperty('--hx', `${hx}px`)
  s.setProperty('--hy', `${hy}px`)
  s.setProperty('--p', `${d.hand}`)
  s.setProperty('--press', `${d.press}`)
  s.setProperty('--fold', `${d.fold}`)
  s.setProperty('--alpha', `${Math.max(0, d.alpha)}`)
}

defineExpose({ update })
</script>

<template lang="pug">
  div.ghost(ref="root" v-show="visible" :class="[`ghost--${gesture}`, { 'ghost--hint': hint, 'ghost--demo': demo, 'ghost--hold': holding, 'ghost--hud': hud }]" aria-hidden="true")
    //- Trail: a soft dotted track from A to B (not for a press and hold: the finger doesn't travel).
    div.ghost__trail(v-if="(gesture === 'swipe' || gesture === 'drag') && !holding")
    //- Tap ripple (looping), or the demo's press ring (posed by the logic).
    div.ghost__ripple(v-if="gesture === 'tap' && !demo")
    div.ghost__press(v-if="demo")
    //- The hand(s).
    div.ghost__hand.ghost__hand--one
      OrigamiIcon(name="hand")
    div.ghost__hand.ghost__hand--two(v-if="gesture === 'spread'")
      OrigamiIcon(name="hand")
  div.ghost-hint(v-if="visible && hintText" :class="{ 'ghost-hint--soft': hint }") {{ hintText }}
</template>

<style scoped lang="sass">
.ghost
  position: absolute
  inset: 0
  pointer-events: none
  z-index: 14
  --ax: 50vw
  --ay: 50vh
  --bx: 50vw
  --by: 40vh

.ghost__hand
  position: absolute
  left: 0
  top: 0
  font-size: clamp(2.6rem, 11vw, 4rem)
  filter: drop-shadow(0 6px 0 rgba(28, 23, 36, 0.35)) drop-shadow(0 0 12px rgba(143, 208, 255, 0.9))
  transform-origin: 30% 10%
  will-change: transform

.ghost--swipe .ghost__hand--one,
.ghost--drag .ghost__hand--one
  animation: ghost-swipe 1.45s cubic-bezier(.55, .05, .35, 1) infinite

.ghost--tap .ghost__hand--one
  animation: ghost-tap 0.9s ease-in-out infinite

.ghost--spread .ghost__hand--one
  animation: ghost-spread-a 1.3s ease-in-out infinite
.ghost--spread .ghost__hand--two
  animation: ghost-spread-b 1.3s ease-in-out infinite

.ghost--hint
  opacity: 0.75

// Pointing at a HUD button: above the HUD strip (still never catching a touch).
.ghost--hud
  z-index: 25

.ghost__trail
  position: absolute
  left: var(--ax)
  top: var(--ay)
  width: var(--len)
  height: 0
  border-top: 0.35rem dotted rgba(143, 208, 255, 0.95)
  transform-origin: 0 50%
  transform: rotate(var(--ang))
  filter: drop-shadow(0 0 6px rgba(47, 140, 255, 0.9))
  animation: ghost-trail 1.45s ease-in-out infinite

.ghost__ripple
  position: absolute
  left: var(--ax)
  top: var(--ay)
  width: clamp(3rem, 14vw, 5rem)
  height: clamp(3rem, 14vw, 5rem)
  margin: calc(clamp(3rem, 14vw, 5rem) / -2) 0 0 calc(clamp(3rem, 14vw, 5rem) / -2)
  border: 0.3rem solid rgba(255, 210, 63, 0.95)
  border-radius: 50%
  animation: ghost-ripple 0.9s ease-out infinite

@keyframes ghost-swipe
  0%
    opacity: 0
    transform: translate(var(--ax), var(--ay)) scale(1.15)
  12%
    opacity: 1
    transform: translate(var(--ax), var(--ay)) scale(0.95)
  70%
    opacity: 1
    transform: translate(var(--bx), var(--by)) scale(0.95)
  85%
    opacity: 0
    transform: translate(var(--bx), var(--by)) scale(1.15)
  100%
    opacity: 0
    transform: translate(var(--bx), var(--by)) scale(1.15)

@keyframes ghost-trail
  0%, 10%
    opacity: 0
  30%, 70%
    opacity: 0.85
  100%
    opacity: 0

@keyframes ghost-tap
  0%, 100%
    transform: translate(var(--ax), calc(var(--ay) - 1.2rem)) scale(1.05)
  45%
    transform: translate(var(--ax), var(--ay)) scale(0.88)

@keyframes ghost-ripple
  0%, 40%
    opacity: 0
    transform: scale(0.3)
  50%
    opacity: 1
  100%
    opacity: 0
    transform: scale(1.4)

@keyframes ghost-spread-a
  0%, 15%
    opacity: 0.2
    transform: translate(calc(var(--ax) - 0.4rem), var(--ay)) rotate(-20deg) scale(0.9)
  60%, 80%
    opacity: 1
    transform: translate(calc(var(--ax) - clamp(3rem, 14vw, 5rem)), calc(var(--ay) + 0.6rem)) rotate(-30deg) scale(0.9)
  100%
    opacity: 0
    transform: translate(calc(var(--ax) - clamp(3rem, 14vw, 5rem)), calc(var(--ay) + 0.6rem)) rotate(-30deg) scale(1)

@keyframes ghost-spread-b
  0%, 15%
    opacity: 0.2
    transform: translate(calc(var(--ax) + 0.4rem), var(--ay)) rotate(20deg) scaleX(-1) scale(0.9)
  60%, 80%
    opacity: 1
    transform: translate(calc(var(--ax) + clamp(3rem, 14vw, 5rem)), calc(var(--ay) + 0.6rem)) rotate(30deg) scaleX(-1) scale(0.9)
  100%
    opacity: 0
    transform: translate(calc(var(--ax) + clamp(3rem, 14vw, 5rem)), calc(var(--ay) + 0.6rem)) rotate(30deg) scaleX(-1) scale(1)

.ghost-hint
  position: absolute
  left: 50%
  bottom: calc(clamp(1rem, 4.5vh, 2.2rem) + env(safe-area-inset-bottom, 0px))
  transform: translateX(-50%)
  max-width: min(92vw, 30rem)
  padding: clamp(0.35rem, 1.4vw, 0.55rem) clamp(0.8rem, 3.4vw, 1.2rem)
  background: linear-gradient(135deg, #fff6e3 0 55%, #efe0bd 55% 100%)
  border: 2px solid #1c1724
  border-radius: 0.6rem
  box-shadow: 0 4px 0 rgba(76, 64, 120, 0.45)
  color: #1c1724
  font-size: clamp(0.8rem, 3.6vw, 1.1rem)
  text-align: center
  pointer-events: none
  z-index: 14
  animation: hint-in 0.35s cubic-bezier(.34, 1.56, .64, 1)
  &--soft
    opacity: 0.85

@keyframes hint-in
  from
    transform: translate(-50%, 60%)
    opacity: 0
  to
    transform: translate(-50%, 0)
    opacity: 1

// Demonstration: no CSS loop, the logic poses everything (--hx/--hy, --p, --press, --alpha).
.ghost--demo
  --hx: 50vw
  --hy: 50vh
  --p: 0
  --press: 0
  --alpha: 0
  --reach: clamp(3rem, 14vw, 5rem)
  .ghost__hand, .ghost__trail
    animation: none
  .ghost__hand--one
    opacity: var(--alpha)
    transform: translate(var(--hx), var(--hy)) scale(calc(1 - var(--press) * 0.14))
  .ghost__trail
    opacity: calc(var(--alpha) * 0.7)
  &.ghost--spread .ghost__hand--one
    transform: translate(calc(var(--hx) - 0.4rem - var(--p) * var(--reach)), calc(var(--hy) + var(--p) * 0.6rem)) rotate(-25deg) scale(0.9)
  &.ghost--spread .ghost__hand--two
    opacity: var(--alpha)
    transform: translate(calc(var(--hx) + 0.4rem + var(--p) * var(--reach)), calc(var(--hy) + var(--p) * 0.6rem)) rotate(25deg) scaleX(-1) scale(0.9)

.ghost__press
  position: absolute
  left: var(--hx)
  top: var(--hy)
  width: var(--reach)
  height: var(--reach)
  margin: calc(var(--reach) / -2) 0 0 calc(var(--reach) / -2)
  border: 0.3rem solid rgba(255, 210, 63, 0.95)
  border-radius: 50%
  opacity: calc(var(--press) * var(--alpha))
  transform: scale(calc(0.4 + var(--press) * 0.9))

// Press and hold (roadmap #14): the finger stays down, a second ring fills with the fold.
.ghost--hold
  --fold: 0
  .ghost__press
    opacity: calc(var(--alpha) * (0.35 + var(--press) * 0.65))
    transform: scale(calc(0.45 + var(--fold) * 0.85))
    border-style: dashed

@media (prefers-reduced-motion: reduce)
  .ghost__hand, .ghost__trail, .ghost__ripple
    animation-duration: 2.4s !important
</style>
