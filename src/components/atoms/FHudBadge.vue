<script setup lang="ts">
/**
 * The small corner indicator used inside `FHudButton`'s `badge` slot —
 * a claim count, a reward amount, or a countdown. Fluidly sized so it stays
 * legible on a 320 px phone without swallowing the chip it sits on.
 * Aethel Fold look: a small creased paper tag with an ink border.
 */
interface Props {
  tone?: 'red' | 'blue' | 'gold' | 'green'
}
withDefaults(defineProps<Props>(), { tone: 'red' })
</script>

<template lang="pug">
  span.f-hud-badge(:class="`tone-${tone}`")
    slot
</template>

<style scoped lang="sass">
@use '@/assets/css/paper' as paper

.f-hud-badge
  --tag-from: #{paper.$red}
  --tag-to: #{paper.$red-shade}
  display: inline-flex
  align-items: center
  justify-content: center
  gap: 0.15em
  min-width: clamp(1rem, 4vw, 1.25rem)
  min-height: clamp(1rem, 4vw, 1.25rem)
  padding-inline: 0.35em
  border: 2px solid paper.$ink
  border-radius: 0.2em
  background-image: paper.crease(var(--tag-from), var(--tag-to), 160deg, 55%)
  font-weight: 900
  line-height: 1
  font-size: clamp(0.6rem, 2.4vw, 0.75rem)
  white-space: nowrap
  box-shadow: 0 2px 0 paper.$shadow
  @include paper.ink-text-thin

  // Both element types, deliberately. `IconCoin` is an `<img>` while every
  // other icon in the set is an inline `<svg>`, and an `svg`-only rule let the
  // coin fall through to its intrinsic 128×128 — a giant gold disc bursting out
  // of the badge and shoving the rest of the HUD row off screen.
  :slotted(svg),
  :slotted(img)
    flex: 0 0 auto
    width: 1em
    height: 1em
    object-fit: contain

.tone-blue
  --tag-from: #{paper.$blue}
  --tag-to: #{paper.$blue-shade}
.tone-gold
  --tag-from: #{paper.$yellow}
  --tag-to: #{paper.$yellow-shade}
.tone-green
  --tag-from: #{paper.$green}
  --tag-to: #{paper.$green-shade}
</style>
