<script setup lang="ts">
// ─── AdsBlockedModal ────────────────────────────────────────────────────
//
// Shown when the player tapped a "watch ad" button and:
//   1. The active ad provider returned `false` (no reward granted), AND
//   2. That provider has detected an ad-blocker is interfering with its
//      ad-fetch chain.
//
// Same component services every ad backend the game ships with
// (CrazyGames, GameDistribution, LevelPlay-on-native, Noop) — each
// provider populates its own `isAdsBlocked` ref via SDK-specific
// detection (CG's `sdk.ad.hasAdblock()`, GD's SDK_ERROR `Blocked:`
// pattern, etc.) and `useAds.showRewardedAd()` is the single seam that
// flips the modal-visible flag. Mounted unconditionally in App.vue;
// visibility is purely reactive on the flag.
//
// Wording is kid-safe because aethel-fold targets ages 6+. No mention
// of "ad blocker brand X", no urging to disable site-wide — just a
// gentle "we couldn't show your ad, please allow ads here to earn the
// reward". Adult-audience games can swap copy via a simple text edit.

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { dismissAdsBlockedModal, isAdsBlockedModalShown } from '@/use/useAds'
import FButton from '@/components/atoms/FButton.vue'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'

const { t } = useI18n()

// Hostname surfaced to the player so they know which site to allowlist.
// Falls back gracefully when running in a non-browser context (SSR,
// Node tests, Workers) where `window.location` is not a string.
const host = computed(() => {
  try {
    return window.location.host || 'this game'
  } catch {
    return 'this game'
  }
})
</script>

<template lang="pug">
  Teleport(to="body")
    Transition(
      name="ads-blocked-modal"
      enter-active-class="transition-opacity duration-200 ease-out"
      leave-active-class="transition-opacity duration-150 ease-in"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    )
      //- z-[150]: must sit ABOVE every win/lose reward overlay (FReward
      //- z-[100]) and in-game menu (UpgradesModal z-[101], FSpeechBubble
      //- z-[100]) so the ad-blocker explainer is never buried under the
      //- screen that triggered the rewarded tap. Stays below the boot
      //- loader (FLogoProgress z-[200]), which never coexists with it.
      div.ads-blocked.fixed.inset-0.flex.items-center.justify-center(
        class="z-[150]"
        v-if="isAdsBlockedModalShown"
        @click="dismissAdsBlockedModal"
      )
        //- Backdrop: a warm veil over the desk.
        div.ads-blocked__veil.absolute.inset-0

        //- Card: a parchment sheet with a dog-ear, lifted off the desk.
        div.ads-blocked__card(@click.stop)
          span.ads-blocked__shadow(aria-hidden="true")
          div.ads-blocked__sheet
            div.ads-blocked__scroll
              OrigamiIcon.ads-blocked__icon(name="hand" tone="white")
              h2.ads-blocked__title {{ t('adsBlocked.title') }}
              p.ads-blocked__body {{ t('adsBlocked.body') }}
              p.ads-blocked__allow
                | {{ t('adsBlocked.allowPrefix') }}
                |
                span.ads-blocked__host {{ host }}
                |
                | {{ t('adsBlocked.allowSuffix') }}

              FButton(
                :label="t('adsBlocked.gotIt')"
                type="primary"
                size="lg"
                block
                @click="dismissAdsBlockedModal"
              )
</template>

<style scoped lang="sass">
@use '@/assets/css/paper' as paper

.ads-blocked
  padding: calc(clamp(0.75rem, 4vw, 1rem) + env(safe-area-inset-top, 0px)) calc(clamp(0.75rem, 4vw, 1rem) + env(safe-area-inset-right, 0px)) calc(clamp(0.75rem, 4vw, 1rem) + env(safe-area-inset-bottom, 0px)) calc(clamp(0.75rem, 4vw, 1rem) + env(safe-area-inset-left, 0px))

.ads-blocked__veil
  background: radial-gradient(ellipse at 50% 40%, rgba(58, 36, 22, 0.55) 0%, rgba(30, 18, 11, 0.82) 75%)
  backdrop-filter: blur(3px)

.ads-blocked__card
  --bw: 3px
  --ear: clamp(1rem, 4.4vw, 1.6rem)
  --depth: 6px
  position: relative
  width: 100%
  max-width: min(28rem, 100%)
  max-height: 100%
  display: flex

.ads-blocked__shadow
  @include paper.shadow-plate

.ads-blocked__sheet
  position: relative
  display: flex
  width: 100%
  max-height: calc(100dvh - 2rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))
  border: var(--bw) solid paper.$ink
  background-image: linear-gradient(to right, transparent calc(50% - 1px), rgba(76, 64, 120, 0.1) calc(50% - 1px) 50%, transparent 50%), paper.crease(paper.$parchment, paper.$parchment-mid, 135deg, 50%)
  color: paper.$ink
  text-align: center
  @include paper.dog-ear-clip

  &::after
    @include paper.dog-ear-flap(paper.$parchment-shade)

// Scrolls inside the sheet (not the sheet itself) so the dog-ear stays put.
.ads-blocked__scroll
  flex: 1 1 auto
  min-height: 0
  overflow-y: auto
  padding: clamp(1rem, 5vw, 1.5rem)
  @include paper.paper-scrollbar

.ads-blocked__icon
  margin: 0 auto 0.5rem
  font-size: clamp(2.5rem, 12vw, 3.25rem)

.ads-blocked__title
  margin-bottom: 0.5rem
  font-size: clamp(1.25rem, 5.5vw, 1.6rem)
  font-weight: 900
  line-height: 1.15
  @include paper.ink-text

.ads-blocked__body
  margin-bottom: 0.75rem
  font-size: clamp(0.9rem, 3.6vw, 1rem)
  line-height: 1.35

.ads-blocked__allow
  margin-bottom: 1.1rem
  font-size: clamp(0.8rem, 3.2vw, 0.9rem)
  line-height: 1.35
  opacity: 0.85

.ads-blocked__host
  font-weight: 900
  color: paper.$red-shade
</style>
