<script setup lang="ts">
/**
 * The standard HUD chip used by every meta button in the bottom rows
 * (Daily Rewards, Missions, Achievements, Battle Pass, Ad Reward, Settings,
 * Tech Tree, Themes).
 *
 * Exists to kill the copy-pasted `scale-80 sm:scale-100` wrappers that used to
 * live in each of those components. Those transforms shrank the painted chip
 * without shrinking its layout box, so the bottom row reserved full-size gaps
 * around 80%-size buttons and the spacing looked wrong on exactly the screens
 * that could least afford it. Everything here is fluid `clamp()` sizing with a
 * hard 2.5rem floor, so the row is compact on a 320px phone, comfortable on a
 * tablet, and never collapses.
 *
 * Castle Fold look: each chip is a square of folded paper — crease, dog-ear,
 * ink border and a periwinkle desk shadow. `gold` is yellow paper and `slate`
 * is plain parchment.
 *
 * Slots: default = the glyph (SVG / icon component); `badge` = the corner
 * indicator (claim count, reward pill, timer).
 */

interface Props {
  /** Colour family. `gold` is the "there is something to collect" default. */
  tone?: 'gold' | 'blue' | 'green' | 'slate'
  /** Soft glow pulse — used when the button has an unclaimed reward. */
  attention?: boolean
  isDisabled?: boolean
  ariaLabel?: string
}

withDefaults(defineProps<Props>(), {
  tone: 'gold',
  attention: false,
  isDisabled: false
})

defineEmits(['click'])
</script>

<template lang="pug">
  button.f-hud-button(
    type="button"
    :class="[`tone-${tone}`, { 'is-attention': attention, 'is-disabled': isDisabled }]"
    :aria-label="ariaLabel"
    :disabled="isDisabled"
    @click="!isDisabled && $emit('click')"
  )
    span.f-hud-button__shadow(aria-hidden="true")
    span.f-hud-button__body
      slot
    span.f-hud-button__badge(v-if="$slots.badge")
      slot(name="badge")
</template>

<style scoped lang="sass">
@use '@/assets/css/paper' as paper

.f-hud-button
  --bw: 2.5px
  --depth: 4px
  --ear: clamp(0.5rem, 2vw, 0.75rem)
  --hud-from: #{paper.$yellow}
  --hud-to: #{paper.$yellow-shade}
  position: relative
  display: inline-flex
  align-items: center
  justify-content: center
  flex: 0 0 auto
  // Floors keep the tap target legal and the chip visible in any layout.
  min-width: 2.5rem
  min-height: 2.5rem
  width: clamp(2.5rem, 11vw, 3.4rem)
  height: clamp(2.5rem, 11vw, 3.4rem)
  padding: 0
  border: 0
  background: none
  cursor: pointer
  pointer-events: auto
  touch-action: manipulation
  -webkit-tap-highlight-color: transparent
  transition: filter 90ms ease-out

  @media (hover: hover)
    &:hover:not(.is-disabled) .f-hud-button__body
      transform: translateY(-2px)

  &:active:not(.is-disabled) .f-hud-button__body
    transform: translateY(3px)

  &:focus-visible
    outline: 3px solid paper.$blue
    outline-offset: 4px

  &.is-disabled
    opacity: 0.5
    filter: grayscale(0.85)
    cursor: not-allowed

.f-hud-button__shadow
  @include paper.shadow-plate

.f-hud-button__body
  position: relative
  display: flex
  align-items: center
  justify-content: center
  width: 100%
  height: 100%
  border: var(--bw) solid paper.$ink
  background-image: paper.crease(var(--hud-from), var(--hud-to), 135deg, 55%)
  color: #fff
  transition: transform 90ms ease-out
  @include paper.dog-ear-clip

  &::after
    @include paper.dog-ear-flap(var(--hud-to))

  // The glyph fills a consistent fraction of the chip regardless of chip size,
  // so a row of mixed icons reads as one set.
  :slotted(svg), :slotted(img)
    position: relative
    width: 62%
    height: 62%
    pointer-events: none

.f-hud-button__badge
  position: absolute
  top: 0
  right: 0
  z-index: 1
  translate: 30% -30%
  display: flex
  align-items: center
  justify-content: center
  pointer-events: none

// ─── Tones ──────────────────────────────────────────────────────────────────

.tone-blue
  --hud-from: #{paper.$blue}
  --hud-to: #{paper.$blue-shade}

.tone-green
  --hud-from: #{paper.$green}
  --hud-to: #{paper.$green-shade}

.tone-slate
  --hud-from: #{paper.$parchment}
  --hud-to: #{paper.$parchment-shade}

  .f-hud-button__body
    color: paper.$ink

.is-attention
  animation: hud-pulse 1.6s ease-in-out infinite

@keyframes hud-pulse
  0%, 100%
    filter: drop-shadow(0 0 0 rgba(255, 224, 102, 0))
  50%
    filter: drop-shadow(0 0 0.5rem rgba(255, 224, 102, 0.9))
</style>
