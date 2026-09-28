<script setup lang="ts">
import { mobileCheck } from '@/utils/function'
import { isMobilePortrait, isMobileLandscape } from '@/use/useUser'
import { isMuted, toggleMute } from '@/use/useCrazyMuteSync'
import { isMobileAudioMuted, toggleMobileAudioMute } from '@/use/useMobileAudioMute'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'
</script>

<template lang="pug">
  div.flex.flex-col.items-end.gap-1
    //- Desktop: volume-based mute (Web Audio gain works here).
    button.mute-btn(
      v-if="!mobileCheck()"
      type="button"
      :aria-pressed="isMuted"
      @click="toggleMute"
    )
      span.mute-btn__shadow(aria-hidden="true")
      span.mute-btn__body
        OrigamiIcon.mute-btn__icon(:name="isMuted ? 'speakerMute' : 'speaker'" tone="blue")
    //- Mobile: hard silence toggle. The OS volume rocker owns the device level,
    //- so this suspends all engine audio + blocks new music/SFX instead of
    //- changing volume — letting players run their own music app.
    button.mute-btn(
      v-else-if="isMobilePortrait || isMobileLandscape"
      type="button"
      :aria-pressed="isMobileAudioMuted"
      @click="toggleMobileAudioMute"
    )
      span.mute-btn__shadow(aria-hidden="true")
      span.mute-btn__body
        OrigamiIcon.mute-btn__icon(:name="isMobileAudioMuted ? 'speakerMute' : 'speaker'" tone="blue")
</template>

<style scoped lang="sass">
@use '@/assets/css/paper' as paper

// Sized deliberately, not by its glyph: a step BELOW the action buttons beside
// it, which is where a rarely-touched toggle belongs, but never under the
// 2.5rem touch floor. A parchment chip, so it reads as quieter than the
// coloured action chips.
.mute-btn
  --bw: 2.5px
  --depth: 3px
  --ear: clamp(0.45rem, 1.8vw, 0.6rem)
  position: relative
  display: inline-flex
  align-items: center
  justify-content: center
  min-width: 2.5rem
  min-height: 2.5rem
  width: clamp(2.5rem, 9.2vw, 2.85rem)
  height: clamp(2.5rem, 9.2vw, 2.85rem)
  padding: 0
  border: 0
  background: none
  cursor: pointer
  pointer-events: auto
  touch-action: manipulation
  -webkit-tap-highlight-color: transparent

  @media (hover: hover)
    &:hover .mute-btn__body
      transform: translateY(-2px)

  &:active .mute-btn__body
    transform: translateY(2px)

  &:focus-visible
    outline: 3px solid paper.$blue
    outline-offset: 4px

.mute-btn__shadow
  @include paper.shadow-plate

.mute-btn__body
  position: relative
  display: flex
  align-items: center
  justify-content: center
  width: 100%
  height: 100%
  border: var(--bw) solid paper.$ink
  background-image: paper.crease(paper.$parchment, paper.$parchment-shade, 135deg, 55%)
  transition: transform 90ms ease-out
  @include paper.dog-ear-clip

  &::after
    @include paper.dog-ear-flap(paper.$parchment-shade)

.mute-btn__icon
  position: relative
  font-size: clamp(1.05rem, 4.4vw, 1.4rem)
</style>
