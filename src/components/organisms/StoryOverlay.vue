<template lang="pug">
  div(class="pointer-events-none absolute inset-0 z-30 select-none")
    //- ── The curtain ────────────────────────────────────────────────────────
    //-
    //- Held over the canvas until the world's props actually exist. See the
    //- `settling` prop below: without it the chapter opens on a meadow with no
    //- buildings in it and the whole hamlet — the storyteller's hut included —
    //- fades up over the next second, which reads as a bug because it is one.
    transition(name="curtain")
      div(
        v-if="settling"
        class="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-slate-950"
      )
        p(class="text-[11px] font-semibold uppercase tracking-[0.35em] text-amber-200/70") {{ t('story.chapter', { n: 1 }) }}
        p(class="text-2xl tracking-wide text-slate-100") {{ t('story.chapterOneTitle') }}

    //- ── Vitals, bottom-left ────────────────────────────────────────────────
    //- Only while there is something to fight. A permanent health bar over a
    //- walk-and-talk is chrome the scene has to compete with.
    transition(name="fade")
      div(
        v-if="showVitals"
        class="absolute bottom-6 left-6 w-56 space-y-1.5"
      )
        div(class="h-3 overflow-hidden rounded-full bg-slate-950/70 ring-1 ring-white/10")
          div(
            class="h-full rounded-full bg-gradient-to-r from-rose-600 to-rose-400 transition-[width] duration-200"
            :style="{ width: `${Math.round(state.hp * 100)}%` }"
          )
        div(class="h-2 overflow-hidden rounded-full bg-slate-950/70 ring-1 ring-white/10")
          div(
            class="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-[width] duration-100"
            :style="{ width: `${Math.round(state.stamina * 100)}%` }"
          )
        div(
          v-if="state.foes > 0"
          class="pt-0.5 text-[11px] tracking-wide text-slate-300"
        ) {{ t('story.foes', { n: state.foes }) }}

    //- The objective banner used to be a pill across the top-centre here.
    //- `ObjectiveTracker` now shows the same objective on the right-hand side
    //- with the two before it struck through, which is strictly more
    //- information in a place that is not over the middle of the scene.
    //- Showing both was the same sentence twice.
    //-
    //- `objectiveText` below is *not* dead: the failure card reads it, because
    //- "you died doing X" has to name X and the tracker is behind the card.

    //- ── Bow draw ───────────────────────────────────────────────────────────
    //- A ring round the reticle rather than a bar: the draw is a thing you do
    //- while looking at a target, so its readout has to live where the eye is.
    div(
      v-if="state.aim > 0.01"
      class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
    )
      svg(width="64" height="64" viewBox="0 0 64 64" class="opacity-90")
        circle(cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="3")
        circle(
          cx="32" cy="32" r="26" fill="none"
          :stroke="state.aim >= 0.55 ? '#fbbf24' : 'rgba(255,255,255,0.55)'"
          stroke-width="3"
          stroke-linecap="round"
          :stroke-dasharray="`${state.aim * 163.4} 163.4`"
          transform="rotate(-90 32 32)"
        )

    //- ── Interact prompt ────────────────────────────────────────────────────
    transition(name="fade")
      div(
        v-if="state.canInteract"
        class="absolute inset-x-0 bottom-32 flex justify-center px-4"
      )
        div(class="flex items-center gap-2 rounded-full bg-slate-950/75 px-4 py-2 text-sm text-slate-100 backdrop-blur-sm ring-1 ring-amber-300/30")
          kbd(class="rounded bg-white/15 px-2 py-0.5 text-xs font-semibold") E
          | {{ t('story.interact') }}

    //- ── Dialogue ───────────────────────────────────────────────────────────
    //- Two presentations, because the book has two timeframes. A fireside line
    //- is a card across the bottom of the screen with the world dimmed behind
    //- it; a line spoken in Arlaan is a plate at the foot of the frame with the
    //- speaker named. Drawing both the same way would collapse sixty years.
    transition(name="rise")
      div(
        v-if="state.line"
        class="pointer-events-auto absolute inset-x-0 bottom-0 flex justify-center px-4 pb-6"
        @click="onAdvance"
      )
        div(
          class="w-full max-w-3xl rounded-2xl px-6 py-5 backdrop-blur-md ring-1 transition-colors"
          :class="state.frame ? 'bg-amber-950/80 ring-amber-400/25' : 'bg-slate-950/80 ring-white/10'"
        )
          div(
            v-if="!state.frame"
            class="mb-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-amber-300/90"
          ) {{ speaker }}
          p(
            class="whitespace-pre-line text-[15px] leading-relaxed"
            :class="state.frame ? 'italic text-amber-100/90' : 'text-slate-100'"
          ) {{ text }}
          div(class="mt-3 flex justify-end text-[11px] text-slate-400") {{ t('story.advance') }}

    //- ── Pointer-lock prompt ────────────────────────────────────────────────
    transition(name="fade")
      div(
        v-if="state.needsPointerLock && state.phase === 'playing'"
        class="absolute inset-0 flex items-center justify-center"
      )
        div(class="rounded-2xl bg-slate-950/70 px-8 py-6 text-center backdrop-blur-sm ring-1 ring-white/10")
          p(class="text-base text-slate-100") {{ t('story.clickToPlay') }}
          //- There used to be a hardcoded control list here — "Shift heavy
          //- attack · Hold F to draw the bow" — and it was wrong within a day of
          //- the controls being reworked, because nothing links a sentence in a
          //- locale file to the binding table it describes. `ControlsOverlay`
          //- draws the same information from `useKeybindings`, so it follows a
          //- rebind and cannot drift. One source, bottom right.

    //- ── Death ──────────────────────────────────────────────────────────────
    transition(name="fade")
      div(
        v-if="state.phase === 'failed'"
        class="pointer-events-auto absolute inset-0 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm"
      )
        div(class="max-w-md rounded-2xl bg-slate-900/90 px-8 py-7 text-center ring-1 ring-white/10")
          p(class="text-lg text-slate-100") {{ t('story.fallen') }}
          //- Names what the player was in the middle of. The tracker that
          //- normally says so is behind this card, and "retry" is a much
          //- easier button to press when it is clear what is being retried.
          p(
            v-if="objectiveText"
            class="mt-2 text-sm text-slate-400"
          ) {{ objectiveText }}
          button(
            type="button"
            class="mt-5 rounded-full bg-amber-500 px-6 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400"
            @click="emit('retry')"
          ) {{ t('story.retry') }}

    //- ── Chapter complete ───────────────────────────────────────────────────
    transition(name="fade")
      div(
        v-if="state.phase === 'complete'"
        class="pointer-events-auto absolute inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm"
      )
        div(class="max-w-lg rounded-2xl bg-slate-900/90 px-9 py-8 text-center ring-1 ring-white/10")
          p(class="text-[11px] uppercase tracking-[0.3em] text-amber-300/80") {{ t('story.chapter', { n: 1 }) }}
          h2(class="mt-2 text-2xl font-semibold text-slate-50") {{ t('story.chapterOneTitle') }}
          p(class="mt-4 text-sm text-slate-300") {{ t('story.chapterComplete') }}
          button(
            type="button"
            class="mt-6 rounded-full bg-amber-500 px-6 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400"
            @click="emit('restart')"
          ) {{ t('story.playAgain') }}
</template>

<!--
  The whole of Chapter 1's interface.

  One component rather than six, and that is a deliberate reading of how much
  this actually is: a health bar, a stamina bar, an objective line, a draw ring,
  a prompt and a dialogue plate. Split across files they would be six components
  that all take the same `state` prop and none of which is reused anywhere — and
  the thing a reader wants to know about a HUD is what is on screen *at once*,
  which a single template answers and six files do not.

  It takes a plain snapshot object, never the director. `StoryDirector` owns a
  `CombatDirector`, which owns `Character`s, which own skeletons and skinned
  meshes and their buffers; handing it to Vue would deep-proxy every one of them
  and drop the world to a slideshow (GDD §0). The shell polls a revision counter
  and copies out a flat struct — the same discipline every panel in this project
  follows.
-->

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StoryState } from '@/world/story/StoryDirector'
import { speakerName, storyLine } from '@/world/story/script'

const props = defineProps<{
  state: StoryState
  /**
   * True until the placeable catalogue has drained and the chapter's props are
   * in the batch.
   *
   * `World` generates the catalogue a slice at a time *after* the first frame —
   * see `generatePlaceablesOnce`, which explains at length why the blocking
   * version is worse — and it re-resolves the chapter's placements only once, on
   * the frame the drain finishes. That is right for the sandbox, where the
   * player is looking at terrain either way. It is wrong for a chapter that
   * opens *inside a room*: for the ~30 frames of the drain the island has no
   * hut, no neighbours and no well, and then all of it appears at once.
   *
   * So the curtain stays up for those frames. It costs nothing anyone can see —
   * the drain is deliberately budgeted so the loop keeps turning underneath —
   * and it is the difference between "the world was loading" and "the building
   * arrived late".
   */
  settling?: boolean
}>()
const emit = defineEmits<{ advance: []; retry: []; restart: [] }>()

const { t, locale } = useI18n()

/**
 * The line's text, in the language the player is actually reading.
 *
 * Not `t()`. The chapter's prose lives beside the chapter as content in two
 * languages — see the header of `story/script.ts` for why forty lines of a
 * novel do not go through a 21-locale UI bundle — so this asks the script for
 * the German or the English and everything *around* it stays translated.
 */
const text = computed(() => (props.state.line ? storyLine(props.state.line, locale.value) : ''))
const speaker = computed(() => (props.state.line ? speakerName(props.state.line.who, locale.value) : ''))

const objectiveText = computed(() => (props.state.objective ? t(`story.objective.${props.state.objective}`) : ''))

// Vitals appear when there is a fight or when the player has been hurt, and
// disappear again once both are false. A bar that is always up is a bar the
// player stops reading.
const showVitals = computed(
  () => props.state.phase === 'playing' && (props.state.foes > 0 || props.state.hp < 0.999)
)

const onAdvance = (): void => {
  emit('advance')
}
</script>

<style scoped lang="sass">
.fade-enter-active,
.fade-leave-active
  transition: opacity 260ms ease

.fade-enter-from,
.fade-leave-to
  opacity: 0

.rise-enter-active,
.rise-leave-active
  transition: opacity 200ms ease, transform 200ms ease

.rise-enter-from,
.rise-leave-to
  opacity: 0
  transform: translateY(10px)

// Slower than `fade`, and only on the way out: the curtain is never faded *in*,
// it is simply there from the first frame, and a leave long enough to read as a
// reveal is what stops the world snapping on.
.curtain-leave-active
  transition: opacity 420ms ease

.curtain-leave-to
  opacity: 0
</style>
