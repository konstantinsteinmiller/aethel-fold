<template lang="pug">
  transition(name="pop")
    div(
      v-if="target"
      class="billboard pointer-events-none absolute z-20 select-none"
      :style="anchor"
    )
      div(class="flex -translate-x-1/2 -translate-y-full flex-col items-center gap-1 pb-2")
        div(class="billboard-text rounded bg-slate-950/65 px-2 py-0.5 text-[11px] font-medium leading-snug text-white ring-1 ring-white/15 backdrop-blur-[2px]")
          | {{ target.name }}

        div(
          class="billboard-text flex items-center gap-1.5 rounded-full bg-slate-950/65 px-2 py-[3px] text-[11px] font-semibold text-white ring-1 ring-amber-200/45 backdrop-blur-[2px]"
          :class="target.focused ? '' : 'opacity-60'"
        )
          KeyCap(:code="interactKey" tone="prompt")
          span {{ t('story.talk') }}

        //- The stem. Points at the head the label is standing on, so two NPCs
        //- close together stay tellable apart when their labels overlap.
        div(class="h-2 w-px bg-amber-200/70")
</template>

<!--
  The "[E] Talk" prompt that appears over an NPC the player can speak to.

  ── Why this is HTML and not a sprite in the scene ──────────────────────────

  A three.js sprite would sit in the world and sort against it for free, which is
  the one thing this has to fake (see `screen.onScreen`). Everything else it
  would cost: a texture per name in two languages, re-baked on a language change;
  no access to `vue-i18n`; its own material and therefore its own program, in a
  scene already at 27 (GDD §5 asks for ~14); and text that is either blurry at
  distance or a 512-pixel atlas.

  The prompt is also *chrome* rather than scenery — it is the same category of
  thing as the objective tracker and the controls panel, and it belongs in the
  same layer as them.

  ── Contract ────────────────────────────────────────────────────────────────

  `target` is null when there is nobody to talk to; the transition handles the
  appearance. `screen` is the projection of the NPC's **head** (see
  `world/story/project.ts`), in the same origin-top-left, unclamped, viewport-
  normalised space the objective locator uses.

  The host must mount this inside the element the canvas fills — every position
  here is a percentage of the offset parent.
-->

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import KeyCap from '@/components/atoms/KeyCap.vue'
import { bindingFor } from '@/use/useKeybindings'
import type { ScreenPoint } from '@/world/story/project'

const props = defineProps<{
  target: { name: string; focused: boolean } | null
  screen: ScreenPoint | null
}>()

const { t } = useI18n()

/**
 * The interact key, read live so a rebind is reflected in the prompt.
 *
 * A prompt that says `[E]` after the player has moved interact to `F` is worse
 * than no prompt: it is a confident instruction that does not work.
 */
const interactKey = computed(() => bindingFor('interact'))

/**
 * Where the label sits.
 *
 * Clamped into the viewport with a margin, because an NPC at the very edge of
 * the screen would otherwise put half the label outside it. Unlike the objective
 * locator, there is no arrow here and nothing to point with — a prompt for
 * somebody you cannot see is not useful, so the host stops passing a target once
 * they leave the frame and this only ever has to survive the last few pixels.
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

// The label tracks a moving head every frame, so it must not also be animating
// its own position — a CSS transition on `left`/`top` here fights the projection
// and the prompt lags a walking NPC by a visible fraction of a second.
.billboard
  transition: none

// ── Why the prompt is white on dark and not black on amber ──────────────────
//
// This label is drawn *over the scene*, so its background is whatever the world
// happens to put behind it — and the world here is a sunlit meadow at 0.58 of
// the day cycle. The old pill was `bg-amber-300` with `text-slate-900` and a
// `bg-white/12` key cap: amber-300 (#fcd34d) against white gives a contrast
// ratio of **1.34:1**, i.e. the key letter was effectively invisible, and the
// amber pill itself sat on dry grass of almost its own luminance.
//
// Dark translucent panel + white text is the only combination that holds
// against *both* a bright sky and a dark treeline, and the shadow below is what
// keeps the glyph edges readable where the panel's own alpha lets a light
// background through. Amber survives as the ring and the key cap's border,
// which is where it was doing its real job — saying "this one is interactive".
.billboard-text
  text-shadow: 0 1px 2px rgba(2, 6, 23, 0.9), 0 0 6px rgba(2, 6, 23, 0.55)
</style>
