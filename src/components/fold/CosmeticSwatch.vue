<script setup lang="ts">
/**
 * One paper cosmetic (roadmap #6) as a small swatch: a paper sample for a
 * page paper, the hero's helm and tabard with his accessory, or a confetti
 * chip. Colours come from the game palette, so a swatch matches what the book
 * paints. `locked` draws a flat periwinkle silhouette of the same thing (never
 * black), the way the shelf draws a locked book.
 *
 * Used by the pause's settings face (the picker) and by the unlock cue.
 */
import { computed } from 'vue'
import { cosmeticById } from '@/fold/logic/cosmetics'
import { HEX } from '@/fold/render/palette'

const props = withDefaults(defineProps<{
  id: string
  locked?: boolean
}>(), { locked: false })

const def = computed(() => cosmeticById(props.id))
const kind = computed(() => def.value?.kind ?? 'paper')
const value = computed(() => def.value?.value ?? 'plain')
/** A silhouette is one flat colour: the palette's shadow. */
const sil = (c: string): string => (props.locked ? HEX.shadow : c)
const ink = computed(() => (props.locked ? HEX.shadowDeep : HEX.ink))

/** A page paper as CSS: its stock and its print, from the palette. */
const paperStyle = computed((): Record<string, string> => {
  if (props.locked) return { background: HEX.shadow }
  switch (value.value) {
    case 'graph':
      return {
        backgroundColor: HEX.graphPaper,
        backgroundImage: `linear-gradient(${HEX.graphLine} 1px, transparent 1px), linear-gradient(90deg, ${HEX.graphLine} 1px, transparent 1px)`,
        backgroundSize: '0.42em 0.42em'
      }
    case 'washi':
      return {
        backgroundColor: HEX.washi,
        backgroundImage: `radial-gradient(circle at 50% 100%, transparent 0.18em, ${HEX.washiPrint} 0.19em, ${HEX.washiPrint} 0.23em, transparent 0.24em, transparent 0.34em, ${HEX.washiPrint} 0.35em, ${HEX.washiPrint} 0.39em, transparent 0.4em)`,
        backgroundSize: '0.8em 0.4em'
      }
    case 'newsprint':
      return {
        backgroundColor: HEX.newsprint,
        backgroundImage: `repeating-linear-gradient(${HEX.newsInk} 0 0.06em, transparent 0.06em 0.2em)`,
        backgroundSize: '100% 100%'
      }
    case 'map':
      return {
        backgroundColor: HEX.mapPaper,
        backgroundImage: `repeating-radial-gradient(circle at 30% 60%, transparent 0 0.16em, ${HEX.mapLine} 0.17em 0.2em)`
      }
    default:
      return { backgroundColor: HEX.parchment, backgroundImage: `linear-gradient(135deg, ${HEX.parchmentLight}, ${HEX.parchmentShade})` }
  }
})

/** Confetti chip outline in a 48-unit box. */
const chipPath = computed(() => {
  switch (value.value) {
    case 'stars':
      return 'M24 5l5 12 13 1-10 8 3 13-11-7-11 7 3-13-10-8 13-1z'
    case 'hearts':
      return 'M24 41C12 32 6 25 7 17c1-6 8-9 13-6 2 1 3 3 4 4 1-1 2-3 4-4 5-3 12 0 13 6 1 8-5 15-17 24z'
    case 'cranes':
      return 'M3 22l14 6 6-20 5 20 9-10 8 4-9 2-6 12-12 4-10-2z'
    default:
      return 'M13 9h22v30H13z'
  }
})
const chipTone = computed(() => sil(value.value === 'hearts' ? HEX.c7 : value.value === 'stars' ? HEX.c2 : value.value === 'cranes' ? HEX.c3 : HEX.c1))
</script>

<template lang="pug">
  span.swatch(:class="[`swatch--${kind}`, { 'swatch--locked': locked }]" :data-cosmetic="id")
    //- A page paper: a folded-corner sample of the sheet.
    span.swatch__paper(v-if="kind === 'paper'" :style="paperStyle")
    //- The hero: helm, tabard, and the accessory.
    svg.swatch__svg(v-else-if="kind === 'hero'" viewBox="0 0 48 48" aria-hidden="true" :stroke="ink" stroke-width="2.5" stroke-linejoin="round")
      path(:fill="sil(HEX.heroBlue)" d="M12 46l3-18h18l3 18z")
      path(:fill="sil(HEX.heroSteel)" d="M14 30V16c0-7 5-11 10-11s10 4 10 11v14z")
      rect(x="16" y="16" width="16" height="3.5" rx="1.5" :fill="ink" stroke="none")
      template(v-if="value === 'crown'")
        path(:fill="sil(HEX.gold)" d="M14 11V2l5 5 5-6 5 6 5-5v9z")
      template(v-else)
        path(:fill="sil(HEX.flagYellow)" d="M24 6c-2-4 2-6 8-5-3 2 0 4 2 6-4 0-7 0-10-1z")
      template(v-if="value === 'scarf'")
        path(:fill="sil(HEX.scarfRed)" d="M12 28h24v5H12zM31 32h5l2 12h-5z")
      template(v-if="value === 'sash'")
        path(:fill="sil(HEX.sash)" d="M15 30l4-2 16 16-5 2z")
    //- A confetti chip, with a second one behind it.
    svg.swatch__svg(v-else viewBox="0 0 48 48" aria-hidden="true" :stroke="ink" stroke-width="2.5" stroke-linejoin="round")
      path(:fill="sil(HEX.c4)" :d="chipPath" transform="translate(8 6) rotate(18 24 24) scale(0.7)")
      path(:fill="chipTone" :d="chipPath" transform="translate(4 4) rotate(-10 24 24) scale(0.85)")
</template>

<style scoped lang="sass">
.swatch
  position: relative
  display: inline-flex
  align-items: center
  justify-content: center
  width: 1em
  height: 1em
  line-height: 1

.swatch__paper
  width: 88%
  height: 88%
  border: 2px solid #1c1724
  border-radius: 0.08em
  // The folded-down corner of a paper sample.
  clip-path: polygon(0 0, 72% 0, 100% 28%, 100% 100%, 0 100%)
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35)

.swatch--locked .swatch__paper
  border-color: #4a4078

.swatch__svg
  width: 100%
  height: 100%
  overflow: visible
</style>
