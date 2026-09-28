<template lang="pug">
  transition(name="pop")
    div(
      v-if="target"
      class="billboard pointer-events-none absolute z-20 select-none"
      :style="anchor"
    )
      div(class="flex -translate-x-1/2 -translate-y-full flex-col items-center gap-1 pb-2")
        //- Unseated: the offer. One pill, no name row — a bench has no name,
        //- and "Bench" over every bench in the square is furniture labelling
        //- rather than an interaction prompt.
        div(
          v-if="!target.seated"
          class="billboard-text flex items-center gap-1.5 rounded-full bg-slate-950/65 px-2 py-[3px] text-[11px] font-semibold text-white ring-1 ring-amber-200/45 backdrop-blur-[2px]"
        )
          KeyCap(:code="interactKey" tone="prompt")
          span {{ t('story.sit') }}

        //- Seated: the way out. Sentence-shaped rather than a key cap plus a
        //- verb, because it names *two* keys and one of them (Escape) is not
        //- rebindable — a row of two caps would imply it is.
        div(
          v-else
          class="billboard-text rounded-full bg-slate-950/65 px-2.5 py-[3px] text-[11px] font-medium text-white/90 ring-1 ring-white/15 backdrop-blur-[2px]"
        )
          | {{ standHint }}

        //- The stem, pointing down at the seat the label belongs to.
        div(class="h-2 w-px bg-amber-200/70")
</template>

<!--
  The "[E] Sit" prompt over a bench, chair or stool, and the "press E or Esc to
  stand" hint once the player is in one.

  ── Why this is not `NpcBillboard.vue` with two more props ──────────────────

  They look alike and they are not the same component. `NpcBillboard` is a
  *name plate* with a prompt under it: its first row is who somebody is, its
  stem exists so two NPCs standing shoulder to shoulder can still be told apart
  when their labels overlap, and its `focused` prop is there for a future
  second, dimmed label. None of that has a meaning for a bench. Folding the two
  together would mean a `name` that is always null, a `focused` that is always
  true, and a `seated` branch that the NPC case can never take — three optional
  props and two `v-if`s inside a component whose entire documented purpose is
  the name row.

  What *is* shared is the styling, and it is shared by being copied rather than
  extracted: the pill classes and `.billboard-text` below are `NpcBillboard`'s,
  and the long argument for why they are white-on-dark with an amber ring
  instead of black-on-amber lives there and is not repeated here. If that
  argument ever changes, both files change — which is the honest cost of two
  small components over one component with a mode switch, and cheaper than the
  alternative reading of it.

  ── Contract ────────────────────────────────────────────────────────────────

  `target` is null when there is nothing to sit on and nothing to get out of;
  `seated` picks which of the two states is drawn. `screen` is the projection of
  the seat's own anchor raised half a metre, in the origin-top-left, unclamped,
  viewport-normalised space `world/core/project.ts` produces.

  The host must mount this inside the element the canvas fills — every position
  here is a percentage of the offset parent.
-->

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import KeyCap from '@/components/atoms/KeyCap.vue'
import { bindingFor, keyLabel } from '@/use/useKeybindings'
import type { ScreenPoint } from '@/world/core/project'

const props = defineProps<{
  target: { seated: boolean } | null
  screen: ScreenPoint | null
}>()

const { t } = useI18n()

/**
 * The interact key, read live so a rebind is reflected in the prompt.
 *
 * Same reasoning as the talk prompt's: a prompt that says `[E]` after the
 * player has moved interact to `F` is worse than no prompt, because it is a
 * confident instruction that does not work.
 */
const interactKey = computed(() => bindingFor('interact'))

/**
 * The seated hint, with the live binding interpolated into the sentence.
 *
 * `story.seated` is `'Press {key} or Esc to stand'`, so the *label* is needed
 * rather than the code — resolved exactly as `KeyCap` resolves it, through
 * `keyLabel`, so the word in the sentence is the word on the cap.
 */
const standHint = computed(() => {
  const resolved = keyLabel(interactKey.value)
  const label = resolved.i18n ? t(resolved.i18n) : (resolved.text ?? '')
  return t('story.seated', { key: label })
})

/**
 * Where the label sits.
 *
 * Clamped into the viewport with a margin, for the talk prompt's reason: a seat
 * at the very edge of the screen would otherwise put half the label outside it.
 * There is no arrow here and nothing to point with, so the host stops passing a
 * target the moment the seat leaves the frame and this only ever has to survive
 * the last few pixels.
 */
const anchor = computed(() => {
  const point = props.screen
  if (!point) {
    return { display: 'none' }
  }
  return {
    left: `${Math.min(94, Math.max(6, point.x * 100))}%`,
    top: `${Math.min(96, Math.max(8, point.y * 100))}%`
  }
})
</script>

<style scoped lang="sass">
.pop-enter-active,
.pop-leave-active
  transition: opacity 140ms ease, transform 140ms ease

.pop-enter-from,
.pop-leave-to
  opacity: 0
  transform: translateY(4px) scale(0.94)

// The label tracks a point the camera is orbiting every frame, so it must not
// also be animating its own position — a CSS transition on `left`/`top` here
// fights the projection and the prompt lags a turning camera visibly.
.billboard
  transition: none

// White on dark, with a shadow under the glyphs. `NpcBillboard.vue` carries the
// measurement behind that choice — amber-300 on white is 1.34:1 — and this is
// drawn over the same sunlit meadow at the same time of day.
.billboard-text
  text-shadow: 0 1px 2px rgba(2, 6, 23, 0.9), 0 0 6px rgba(2, 6, 23, 0.55)
</style>
