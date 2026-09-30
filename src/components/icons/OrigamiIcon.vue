<script setup lang="ts">
/**
 * Origami icon set — every glyph is folded paper: two-tone facets (a lit and a
 * shaded side of each crease) under a bold ink outline, so icons match the
 * Aethel Fold look instead of generic line icons. Colour comes from the
 * `tone` prop (paper colours) and the whole icon scales with font-size (1em).
 */
import { computed } from 'vue'

export type OrigamiName =
  | 'gear' | 'speaker' | 'speakerMute' | 'heart' | 'heartEmpty' | 'crane' | 'star' | 'close'
  | 'play' | 'restart' | 'book' | 'hand' | 'trophy' | 'clock' | 'frog' | 'check' | 'pause'
  | 'left' | 'right' | 'plus' | 'minus' | 'vibrate' | 'shake' | 'quality' | 'globe' | 'music' | 'shelf' | 'dragon' | 'movie'
  | 'fish' | 'kraken' | 'skip'

const props = withDefaults(defineProps<{
  name: OrigamiName
  /** Main paper colour; the shaded facet is derived. */
  tone?: 'red' | 'blue' | 'yellow' | 'green' | 'paper' | 'white' | 'ink' | 'purple'
  title?: string
}>(), { tone: 'paper', title: undefined })

const PAPER: Record<string, [string, string]> = {
  red: ['#ff6a5c', '#d8433b'],
  blue: ['#5f95ff', '#3464d6'],
  yellow: ['#ffe066', '#f4b73a'],
  green: ['#7fdc7a', '#45a64a'],
  paper: ['#fff6e3', '#e7d3a8'],
  white: ['#ffffff', '#e4e9f2'],
  ink: ['#3a3142', '#1c1724'],
  purple: ['#b88cff', '#8653e0']
}

const c = computed(() => PAPER[props.tone] ?? PAPER.paper!)
const lit = computed(() => c.value[0])
const dark = computed(() => c.value[1])
</script>

<template lang="pug">
  svg.origami-icon(
    viewBox="0 0 48 48"
    :aria-hidden="title ? undefined : 'true'"
    :role="title ? 'img' : undefined"
    stroke="#1c1724"
    stroke-width="3"
    stroke-linejoin="round"
    stroke-linecap="round"
  )
    title(v-if="title") {{ title }}
    //- ── Settings: a folded paper gear ──
    template(v-if="name === 'gear'")
      path(:fill="lit" d="M24 4l4 6 7-2 1 7 7 2-3 6 5 5-6 3 1 7-7 0-2 7-6-4-6 4-2-7-7 0 1-7-6-3 5-5-3-6 7-2 1-7 7 2z")
      path(:fill="dark" stroke="none" d="M24 4l4 6 7-2 1 7 7 2-3 6 5 5-6 3 1 7-7 0-2 7-6-4V4z" opacity=".55")
      circle(cx="24" cy="24" r="6.5" fill="#fff6e3")
    //- ── Speaker (sound on / muted) ──
    template(v-else-if="name === 'speaker' || name === 'speakerMute'")
      path(:fill="lit" d="M6 18h8l12-10v32L14 30H6z")
      path(:fill="dark" stroke="none" d="M14 18l12-10v32L14 30z" opacity=".5")
      template(v-if="name === 'speaker'")
        path(fill="none" d="M32 17c3 4 3 10 0 14")
        path(fill="none" d="M37 12c6 7 6 17 0 24")
      template(v-else)
        path(fill="none" stroke="#e0453b" stroke-width="4" d="M32 18l12 12M44 18L32 30")
    //- ── Heart (full / empty) ──
    template(v-else-if="name === 'heart' || name === 'heartEmpty'")
      path(
        :fill="name === 'heart' ? '#ff5a5f' : '#efe4c8'"
        d="M24 42L6 24c-5-6-2-15 6-16 5 0 9 3 12 7 3-4 7-7 12-7 8 1 11 10 6 16z"
      )
      path(
        stroke="none"
        :fill="name === 'heart' ? '#c02a2a' : '#d9c49a'"
        opacity=".6"
        d="M24 15c3-4 7-7 12-7 8 1 11 10 6 16L24 42z"
      )
      path(fill="none" stroke="#1c1724" stroke-width="2" opacity=".5" d="M24 15v27")
    //- ── Crane (logo mark) ──
    template(v-else-if="name === 'crane'")
      path(:fill="lit" d="M4 14l18 12 2 6z")
      path(:fill="dark" d="M44 12L26 26l-2 6z")
      path(:fill="lit" d="M22 26l2 6 2-6 4 4-6 8-6-8z")
      path(:fill="dark" d="M30 30l10-12 2 2-10 12z")
      path(:fill="lit" d="M18 30L10 22l-2 2 8 10z")
    //- ── Star ──
    template(v-else-if="name === 'star'")
      path(:fill="lit" d="M24 4l6 13 14 2-10 10 3 14-13-7-13 7 3-14L4 19l14-2z")
      path(:fill="dark" stroke="none" opacity=".55" d="M24 4l6 13 14 2-10 10 3 14-13-7z")
    //- ── Close: two crossed paper strips ──
    template(v-else-if="name === 'close'")
      path(:fill="lit" d="M10 14l4-4 24 24-4 4z")
      path(:fill="dark" d="M34 10l4 4-24 24-4-4z")
    //- ── Play ──
    template(v-else-if="name === 'play'")
      path(:fill="lit" d="M14 8l26 16-26 16z")
      path(:fill="dark" stroke="none" opacity=".5" d="M14 24h26L14 40z")
    //- ── Pause ──
    template(v-else-if="name === 'pause'")
      path(:fill="lit" d="M12 8h9v32h-9zM27 8h9v32h-9z")
    //- ── Restart: a folded arrow looping back ──
    template(v-else-if="name === 'restart'")
      path(:fill="lit" d="M24 8a16 16 0 1 1-15 22l6-2a10 10 0 1 0 9-14v6L12 11l12-9z")
      path(:fill="dark" stroke="none" opacity=".45" d="M24 8v6a10 10 0 0 1 10 10h6A16 16 0 0 0 24 8z")
    //- ── Book / page ──
    template(v-else-if="name === 'book'")
      path(:fill="lit" d="M6 10c6-2 12-2 18 2v28c-6-4-12-4-18-2z")
      path(:fill="dark" d="M42 10c-6-2-12-2-18 2v28c6-4 12-4 18-2z")
    //- ── Bookshelf: three standing books on a board ──
    template(v-else-if="name === 'shelf'")
      path(:fill="lit" d="M7 12h9v26H7z")
      path(:fill="dark" d="M18 8h9v30h-9z")
      path(fill="#e4e9f2" d="M30 14l7-2 6 24-7 2z")
      path(fill="none" d="M4 40h40")
    //- ── Hand (ghost hand cursor) ──
    template(v-else-if="name === 'hand'")
      path(
        fill="#ffffff"
        d="M18 6c2-1 5 0 5 3v12l2-1c2-1 4 0 4 2v1c2-1 4 0 4 2v1c2-1 5 0 5 3v8c0 7-5 11-12 11h-2c-5 0-8-2-10-6l-6-10c-1-2 0-4 2-4 2-1 3 0 4 2l2 3V9c0-2 1-3 2-3z"
      )
      path(fill="none" stroke-width="2" opacity=".45" d="M23 21v8M29 23v7M33 25v6")
    //- ── Trophy ──
    template(v-else-if="name === 'trophy'")
      path(:fill="lit" d="M14 6h20v10c0 6-4 10-10 10s-10-4-10-10z")
      path(:fill="dark" stroke="none" opacity=".55" d="M24 6h10v10c0 6-4 10-10 10z")
      path(fill="none" d="M14 10H7c0 7 4 10 8 10M34 10h7c0 7-4 10-8 10")
      path(:fill="dark" d="M20 26h8v6h-8zM14 38h20v4H14zM17 32h14l3 6H14z")
    //- ── Dragon (Dragon Rush): a folded head in profile, horn and wing ──
    template(v-else-if="name === 'dragon'")
      path(:fill="dark" d="M10 30L4 12l14 10z")
      path(:fill="lit" d="M8 32l14-14 22 10-12 4-4 8z")
      path(:fill="dark" stroke="none" opacity=".55" d="M22 18l22 10-12 4z")
      path(:fill="lit" d="M20 20l-2-12 8 9z")
      path(fill="none" d="M34 30l-2 4")
      circle(cx="28" cy="24" r="2" fill="#1c1724" stroke="none")
    //- ── Kraken (book 3's rush): a chunky coral dome, big eyes under angry brows, stubby curling arms ──
    template(v-else-if="name === 'kraken'")
      path(fill="#ff9f8e" d="M9 30V20C9 10 16 4 24 4s15 6 15 16v10z")
      path(fill="#e8796d" stroke="none" opacity=".6" d="M24 4c8 0 15 6 15 16v10H24z")
      path(fill="#ff9f8e" d="M10 29c-4 3-6 8-3 12 2-3 4-5 7-6zM19 30c-1 5-1 9 2 12 1-4 2-7 4-9zM29 30c1 5 1 9-2 12-1-4-2-7-4-9zM38 29c4 3 6 8 3 12-2-3-4-5-7-6z")
      circle(cx="18" cy="19" r="5" fill="#fffdf8")
      circle(cx="30" cy="19" r="5" fill="#fffdf8")
      circle(cx="18" cy="20" r="2.6" fill="#2f4a6e" stroke="none")
      circle(cx="30" cy="20" r="2.6" fill="#2f4a6e" stroke="none")
      path(fill="#6b62b5" d="M12 12l9 3-1 2-9-3zM36 12l-9 3 1 2 9-3z")
    //- ── Fish (book 3's finale): a folded diamond with a notched tail ──
    template(v-else-if="name === 'fish'")
      path(fill="#ff8f4a" d="M44 24L30 12 14 20 4 10v28l10-10 16 8z")
      path(fill="#d8612a" stroke="none" opacity=".7" d="M44 24L30 36 14 28z")
      circle(cx="33" cy="21" r="2.5" fill="#fff")
      circle(cx="33" cy="21" r="1.2" fill="#1c1724" stroke="none")
    //- ── Movie (a rewarded video, ad builds only): a folded clapperboard with a play mark ──
    template(v-else-if="name === 'movie'")
      path(:fill="lit" d="M6 18h36v22H6z")
      path(:fill="dark" stroke="none" opacity=".5" d="M24 18h18v22H24z")
      path(fill="#fff6e3" d="M5 10l34-6 2 8-34 6z")
      path(fill="#1c1724" stroke="none" d="M12 9l6-1-3 8-6 1zM24 7l6-1-3 8-6 1z")
      path(fill="#fff6e3" d="M20 23l11 6-11 6z")
    //- ── Clock ──
    template(v-else-if="name === 'clock'")
      path(:fill="lit" d="M24 4l14 6 6 14-6 14-14 6-14-6-6-14 6-14z")
      path(:fill="dark" stroke="none" opacity=".5" d="M24 4l14 6 6 14H24z")
      path(fill="none" d="M24 13v11l7 5")
    //- ── Frog ──
    template(v-else-if="name === 'frog'")
      path(fill="#5cc65a" d="M24 12l14 10-4 14H14l-4-14z")
      path(fill="#3b9442" stroke="none" opacity=".7" d="M24 12l14 10-4 14H24z")
      path(fill="#5cc65a" d="M10 22l-6 12 10 2zM38 22l6 12-10 2z")
      circle(cx="18" cy="15" r="4" fill="#fff")
      circle(cx="30" cy="15" r="4" fill="#fff")
      circle(cx="18" cy="15" r="1.5" fill="#1c1724" stroke="none")
      circle(cx="30" cy="15" r="1.5" fill="#1c1724" stroke="none")
    //- ── Check ──
    template(v-else-if="name === 'check'")
      path(:fill="lit" d="M6 24l6-6 8 8 16-16 6 6-22 22z")
      path(:fill="dark" stroke="none" opacity=".5" d="M20 26l16-16 6 6-22 22z")
    //- ── Arrows ──
    template(v-else-if="name === 'left'")
      path(:fill="lit" d="M30 6L12 24l18 18z")
      path(:fill="dark" stroke="none" opacity=".5" d="M12 24l18 18V24z")
    template(v-else-if="name === 'right'")
      path(:fill="lit" d="M18 6l18 18-18 18z")
      path(:fill="dark" stroke="none" opacity=".5" d="M36 24L18 42V24z")
    //- ── Skip: two folded arrows and a bar (the outro's fast-forward) ──
    template(v-else-if="name === 'skip'")
      path(:fill="lit" d="M6 10l15 14-15 14z")
      path(:fill="lit" d="M20 10l15 14-15 14z")
      path(:fill="dark" stroke="none" opacity=".5" d="M6 24h15L6 38zM20 24h15L20 38z")
      path(:fill="dark" d="M36 10h6v28h-6z")
    template(v-else-if="name === 'plus'")
      path(:fill="lit" d="M20 6h8v14h14v8H28v14h-8V28H6v-8h14z")
    template(v-else-if="name === 'minus'")
      path(:fill="lit" d="M6 20h36v8H6z")
    //- ── Settings row glyphs ──
    template(v-else-if="name === 'vibrate'")
      path(:fill="lit" d="M16 6h16v36H16z")
      path(:fill="dark" stroke="none" opacity=".5" d="M24 6h8v36h-8z")
      path(fill="none" d="M10 16l-4 4 4 4-4 4 4 4M38 16l4 4-4 4 4 4-4 4")
    template(v-else-if="name === 'shake'")
      path(:fill="lit" d="M8 14h28v22H8z")
      path(fill="none" d="M40 12v26M44 16v18M4 12v26")
    template(v-else-if="name === 'quality'")
      path(:fill="lit" d="M6 36l12-18 8 10 6-8 10 16z")
      path(:fill="dark" stroke="none" opacity=".5" d="M18 18l8 10 6-8 10 16H18z")
      circle(cx="34" cy="12" r="4" fill="#ffd23f")
    template(v-else-if="name === 'globe'")
      path(:fill="lit" d="M24 4l14 6 6 14-6 14-14 6-14-6-6-14 6-14z")
      path(fill="none" d="M4 24h40M24 4c-8 10-8 30 0 40M24 4c8 10 8 30 0 40")
    template(v-else-if="name === 'music'")
      path(:fill="lit" d="M18 10l20-4v26a6 6 0 1 1-4-6V14l-12 3v19a6 6 0 1 1-4-6z")
</template>

<style scoped lang="sass">
.origami-icon
  width: 1em
  height: 1em
  display: block
  overflow: visible
  flex-shrink: 0
</style>
