<script setup lang="ts">
/**
 * DOM juice layer: bouncy toon score numbers (GDD §5 "floating, bouncy toon
 * numbers (+100) pop out of defeated enemies, scaling up quickly and fading
 * out with a slight rotation") and comic onomatopoeia (SNAP!, STAMP!, RIP!,
 * GROUAAARGH! …).
 *
 * Imperative and pooled on purpose: dozens of pops a second must not churn
 * Vue's virtual DOM. Elements are created once and recycled round-robin.
 *
 * The `almost` variant is the big two-line word of the "Almost!" moment on a
 * crumple (roadmap #9): ALMOST! over how close the player was, held ~2 s.
 *
 * `stars` drives the StarRibbon (roadmap #1): a cleared page's origami stars
 * fold in one by one on the page-turn beat. `unlocked` follows it with the
 * wordless "new paper!" card (roadmap #6) when those stars unlocked a cosmetic.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import StarRibbon from '@/components/fold/StarRibbon.vue'
import UnlockCue from '@/components/fold/UnlockCue.vue'

const POP_POOL = 28
const WORD_POOL = 8

const root = ref<HTMLDivElement | null>(null)
const ribbon = ref<InstanceType<typeof StarRibbon> | null>(null)
const cue = ref<InstanceType<typeof UnlockCue> | null>(null)
const pops: HTMLDivElement[] = []
const words: HTMLDivElement[] = []
let almostEl: HTMLDivElement | null = null
let almostTitle: HTMLSpanElement | null = null
let almostLine: HTMLSpanElement | null = null
let popIdx = 0
let wordIdx = 0
const { t } = useI18n()

onMounted(() => {
  const el = root.value
  if (!el) return
  for (let i = 0; i < POP_POOL; i++) {
    const d = document.createElement('div')
    d.className = 'fx-pop'
    el.appendChild(d)
    pops.push(d)
  }
  for (let i = 0; i < WORD_POOL; i++) {
    const d = document.createElement('div')
    d.className = 'fx-word'
    el.appendChild(d)
    words.push(d)
  }
  almostEl = document.createElement('div')
  almostEl.className = 'fx-word fx-almost'
  almostTitle = document.createElement('span')
  almostTitle.className = 'fx-almost__title'
  almostLine = document.createElement('span')
  almostLine.className = 'fx-almost__line'
  almostEl.append(almostTitle, almostLine)
  el.appendChild(almostEl)
})

onBeforeUnmount(() => {
  pops.length = 0
  words.length = 0
  almostEl = almostTitle = almostLine = null
})

const restart = (d: HTMLDivElement, cls: string): void => {
  d.classList.remove('is-on')
  void d.offsetWidth
  d.classList.add('is-on')
  d.dataset.tone = cls
}

/** "+250" at a screen point. `mult` ≥ 150 draws it bigger and golden. */
const pop = (x: number, y: number, points: number, mult = 100): void => {
  const d = pops[popIdx++ % POP_POOL]
  if (!d) return
  const big = mult >= 150 || points >= 500
  d.textContent = `+${points.toLocaleString()}`
  d.style.left = `${x}px`
  d.style.top = `${y}px`
  d.style.setProperty('--rot', `${(Math.random() - 0.5) * 24}deg`)
  d.style.setProperty('--drift', `${(Math.random() - 0.5) * 40}px`)
  d.style.fontSize = big ? 'clamp(1.4rem, 6.4vw, 2.3rem)' : 'clamp(1.05rem, 4.6vw, 1.6rem)'
  restart(d, big ? 'gold' : 'white')
}

/** A comic word (i18n key under fold.fx) at a screen point. */
const word = (key: string, x: number, y: number, size = 1, tone = 'default', params: Record<string, unknown> = {}): void => {
  const d = words[wordIdx++ % WORD_POOL]
  if (!d) return
  d.textContent = t(`fold.fx.${key}`, params)
  d.style.left = `${x}px`
  d.style.top = `${y}px`
  d.style.setProperty('--size', String(size))
  d.style.setProperty('--rot', `${(Math.random() - 0.5) * 16}deg`)
  restart(d, tone)
}

/**
 * The "Almost!" moment: ALMOST! and "N soldiers from a clear!" (or, on the
 * dragon's page, "N weak points to go!") in the middle of the empty desk.
 * `n` comes from the simulation's crumple event.
 */
const almost = (n: number, boss = false): void => {
  const d = almostEl
  if (!d || !almostTitle || !almostLine) return
  almostTitle.textContent = t('fold.fx.almostTitle')
  const left = Math.max(0, Math.round(n))
  almostLine.textContent = left > 0 ? t(boss ? 'fold.fx.almostBoss' : 'fold.fx.almost', { n: left }, left) : ''
  d.style.setProperty('--rot', `${(Math.random() - 0.5) * 6}deg`)
  restart(d, 'almost')
}

/** Drop the Almost! word early (the page is back). */
const clearAlmost = (): void => {
  almostEl?.classList.remove('is-on')
}

/** A cleared page's stars (1…3) fold into the ribbon. */
const stars = (n: number): void => {
  ribbon.value?.play(n)
}

/** Cosmetics the page's stars just unlocked: the "new paper!" card, after the ribbon. */
const unlocked = (ids: readonly string[]): void => {
  cue.value?.play(ids)
}

/** Take the star ribbon (and an unlock card) down (a new run or a jump). */
const clearStars = (): void => {
  ribbon.value?.clear()
  cue.value?.clear()
}

defineExpose({ pop, word, almost, clearAlmost, stars, unlocked, clearStars })
</script>

<template lang="pug">
  div.fx-layer(ref="root" aria-hidden="true")
    StarRibbon(ref="ribbon")
    UnlockCue(ref="cue")
</template>

<style scoped lang="sass">
.fx-layer
  position: absolute
  inset: 0
  pointer-events: none
  overflow: hidden
  z-index: 15

.fx-layer :deep(.fx-pop)
  position: absolute
  transform: translate(-50%, -50%) scale(0)
  opacity: 0
  color: #fff
  white-space: nowrap
  font-variant-numeric: tabular-nums
  text-shadow: 2px 2px 0 #1c1724, -2px 2px 0 #1c1724, 2px -2px 0 #1c1724, -2px -2px 0 #1c1724, 0 4px 0 rgba(76, 64, 120, 0.55)
  will-change: transform, opacity
  &[data-tone='gold']
    color: #ffe066
  &.is-on
    animation: fx-pop 0.95s cubic-bezier(.2, .9, .3, 1) forwards

.fx-layer :deep(.fx-word)
  position: absolute
  transform: translate(-50%, -50%) scale(0)
  opacity: 0
  white-space: nowrap
  font-size: calc(clamp(1.6rem, 8vw, 3.2rem) * var(--size, 1))
  color: #ffd23f
  -webkit-text-stroke: 0.08em #1c1724
  paint-order: stroke fill
  text-shadow: 0 0.12em 0 #1c1724, 0 0.2em 0 rgba(76, 64, 120, 0.5)
  letter-spacing: 0.02em
  will-change: transform, opacity
  &[data-tone='snap']
    color: #ffd23f
  &[data-tone='stamp']
    color: #ff6a5c
  &[data-tone='rip']
    color: #fff6e3
  &[data-tone='crease']
    color: #ffe066
  &[data-tone='roar']
    color: #ff5a3a
    letter-spacing: 0.06em
  &[data-tone='good']
    color: #7fdc7a
  &[data-tone='combo']
    color: #b88cff
  &.is-on
    animation: fx-word 1.05s cubic-bezier(.2, .9, .3, 1) forwards

// Centred above the Try-again button, clear of the HUD strip.
.fx-layer :deep(.fx-almost)
  left: 50%
  top: 40%
  display: flex
  flex-direction: column
  align-items: center
  gap: 0.15em
  max-width: calc(100vw - 2rem)
  text-align: center
  white-space: normal
  color: #ffd23f
  &.is-on
    animation: fx-almost 2s cubic-bezier(.2, .9, .3, 1) forwards

@media (max-height: 520px) and (orientation: landscape)
  .fx-layer :deep(.fx-almost)
    top: 46%

.fx-layer :deep(.fx-almost__title)
  // Height-aware too: on a landscape phone it must stay under the HUD strip.
  font-size: calc(clamp(1.7rem, min(12vw, 14vh), 4.4rem) * var(--size, 1))
  line-height: 1

.fx-layer :deep(.fx-almost__line)
  font-size: clamp(0.95rem, min(5.4vw, 6.5vh), 2rem)
  line-height: 1.1
  color: #fff6e3
  &:empty
    display: none

@keyframes fx-almost
  0%
    opacity: 0
    transform: translate(-50%, -50%) scale(0.1) rotate(0)
  10%
    opacity: 1
    transform: translate(-50%, -55%) scale(1.2) rotate(var(--rot))
  20%
    transform: translate(-50%, -55%) scale(0.95) rotate(var(--rot))
  28%
    transform: translate(-50%, -56%) scale(1) rotate(var(--rot))
  85%
    opacity: 1
    transform: translate(-50%, -58%) scale(1) rotate(var(--rot))
  100%
    opacity: 0
    transform: translate(-50%, -75%) scale(0.96) rotate(var(--rot))

@keyframes fx-pop
  0%
    opacity: 0
    transform: translate(-50%, -50%) scale(0.2) rotate(0)
  18%
    opacity: 1
    transform: translate(-50%, -80%) scale(1.25) rotate(var(--rot))
  35%
    transform: translate(-50%, -95%) scale(0.95) rotate(var(--rot))
  100%
    opacity: 0
    transform: translate(calc(-50% + var(--drift)), -260%) scale(1) rotate(calc(var(--rot) * 1.6))

@keyframes fx-word
  0%
    opacity: 0
    transform: translate(-50%, -50%) scale(0.1) rotate(0)
  14%
    opacity: 1
    transform: translate(-50%, -60%) scale(1.3) rotate(var(--rot))
  28%
    transform: translate(-50%, -60%) scale(0.92) rotate(var(--rot))
  40%
    transform: translate(-50%, -62%) scale(1.04) rotate(var(--rot))
  78%
    opacity: 1
  100%
    opacity: 0
    transform: translate(-50%, -110%) scale(1) rotate(var(--rot))

@media (prefers-reduced-motion: reduce)
  .fx-layer :deep(.fx-pop.is-on), .fx-layer :deep(.fx-word.is-on)
    animation-duration: 0.6s
  .fx-layer :deep(.fx-almost.is-on)
    animation-duration: 2s
</style>
