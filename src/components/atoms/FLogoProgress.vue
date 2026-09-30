<template lang="pug">
  Transition(name="splash-fade")
    div.splash-backdrop.no-os-ui(v-if="!backdropHidden")

  //- The loading screen. It takes over from index.html's static splash
  //- (same logo, same bar, same place) and stays until the game has drawn its
  //- first frame (`gameReady`), so it covers the real loading — the renderer
  //- chunk and building page 1 — and entertains with tips meanwhile.
  Transition(name="logo-fade")
    div.no-os-ui(
      v-if="!done"
      ref="logoRef"
      class="fixed z-[200] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
    )
      div(class="relative flex flex-col items-center")
        div(:style="sizeStyle")
          //- Inline SVG, sized to the box (`min(vw, vh) * 0.4`, the same box as
          //- index.html's static splash) so it stays crisp from 128 px to 430 px.
          GameLogo(:size="centeredSize")

        //- Paper-strip progress bar: parchment track, creased red paper fill,
        //- ink border — with the percentage beside it.
        div.splash-progress
          div.splash-progress__track(
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="Math.round(progress)"
          )
            div.splash-progress__fill(:style="{ width: `${Math.min(100, Math.max(0, shown))}%` }")
          span.percentage-text {{ Math.round(shown) }}%

        //- A tip every few seconds while it loads (a small paper slip).
        div.splash-tip-slot
          Transition(name="tip-swap" mode="out-in")
            div.splash-tip(v-if="tipKey" :key="tipKey") {{ t(tipKey) }}

        Transition(name="hint-fade")
          div.stuck-hint.mt-4(v-if="showStuckHint") {{ t('loading.tooLong') }}
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import useAssets from '@/use/useAssets'
import GameLogo from '@/components/atoms/GameLogo.vue'
import { BOOT, bootProgress, bootStage, gameReady, staticBootValue } from '@/use/useBoot'
import { stopLoading } from '@/use/useCrazyGames'
import { armFirstLoadInterstitial, notifySplashGone } from '@/use/useFirstLoadInterstitial'

const { t } = useI18n()

const { loadingProgress, preloadAssets } = useAssets()
/**
 * The game route waits for the game's first frame; the benches (`/world` …)
 * have no such signal and use the asset preload as before.
 */
const waitsForGame = typeof window !== 'undefined' && (!window.location.hash || window.location.hash === '#/' || window.location.hash === '#')
const progress = computed(() => (waitsForGame ? bootProgress.value : loadingProgress.value))
/** The bar as drawn: eases toward `progress` and creeps on so it never stalls. */
const shown = ref(staticBootValue())
let barRaf = 0
const barTick = (): void => {
  const target = progress.value
  const cap = Math.min(99, target + 14)
  shown.value = Math.min(100, shown.value + Math.max(0, (target - shown.value) * 0.08) + (shown.value < cap ? 0.06 : 0))
  if (target >= 100) shown.value = Math.max(shown.value, Math.min(100, shown.value + 4))
  if (!done.value) barRaf = requestAnimationFrame(barTick)
}

/** Gameplay tips (i18n) shown one after another while loading. */
const TIPS = ['loading.tip1', 'loading.tip2', 'loading.tip3', 'loading.tip4', 'loading.tip5', 'loading.tip6']
const tipKey = ref('')
let tipTimer: number | null = null
const nextTip = (): void => {
  const i = Math.max(0, TIPS.indexOf(tipKey.value))
  tipKey.value = TIPS[(tipKey.value ? i + 1 : Math.floor(Math.random() * TIPS.length)) % TIPS.length]!
}
/** Keep the logo up at least this long (ms since navigation) so it registers. */
const MIN_SHOW_MS = 1400

void preloadAssets()

// First-load interstitial — kept ON for GamePix only. GameDistribution and
// GameMonetize were intentionally removed: the post-splash ad placement on
// those networks was producing borderline-incidental-click impressions (the
// player taps "play" expecting the game and lands on an ad), so we keep the
// midgame between-rounds interstitial as the sole placement on those builds.
// GamePix portal QA still requires the post-load ad, so its arm stays.
// Every env read is a static literal so Rollup DCEs the entire branch (helper
// module included) on other platform builds — same pattern as the Playgama /
// GamePix loading signals further down.
if (import.meta.env.VITE_APP_GAMEPIX === 'true') {
  armFirstLoadInterstitial()
}

const done = ref(false)
const backdropHidden = ref(false)
const showStuckHint = ref(false)
let stuckHintId: number | null = null

const viewportSize = ref(Math.min(window.innerWidth, window.innerHeight))
const logoRef = ref<HTMLElement | null>(null)

const onResize = () => {
  viewportSize.value = Math.min(window.innerWidth, window.innerHeight)
}

let settleFallbackId: number | null = null

onMounted(() => {
  window.addEventListener('resize', onResize)

  const staticSplash = document.getElementById('static-splash')
  if (staticSplash) {
    staticSplash.classList.add('hidden')
    setTimeout(() => staticSplash.remove(), 500)
  }

  bootStage(BOOT.app)
  barRaf = requestAnimationFrame(barTick)
  // First tip once the logo has been seen, then one every few seconds.
  tipTimer = window.setTimeout(function cycle() {
    nextTip()
    tipTimer = window.setTimeout(cycle, 3200)
  }, 700)

  // Hard fallback so the splash always clears, even if the game never
  // reports its first frame (offline / blocked chunk / WebGL trouble).
  settleFallbackId = window.setTimeout(() => {
    if (!done.value) done.value = true
  }, waitsForGame ? 20000 : 4000)
  stuckHintId = window.setTimeout(() => {
    if (!done.value) showStuckHint.value = true
  }, 10000)
})
onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  if (settleFallbackId !== null) clearTimeout(settleFallbackId)
  if (stuckHintId !== null) clearTimeout(stuckHintId)
  if (tipTimer !== null) clearTimeout(tipTimer)
  cancelAnimationFrame(barRaf)
})

const centeredSize = computed(() => Math.floor(viewportSize.value * 0.4))
const sizeStyle = computed(() => ({
  width: `${centeredSize.value}px`,
  height: `${centeredSize.value}px`
}))

// `immediate: true` fires the handler with the current value the moment
// the watcher is set up. Without it, an asset loader that already reports
// 100% (instant boots, especially on localhost) never trips the watcher
// and the splash sits around for the full 4s `settleFallbackId` window.
const finish = (): void => {
  if (done.value) return
  // Let the bar visibly reach 100 %, and never flash the logo for a blink.
  const wait = Math.max(250, MIN_SHOW_MS - performance.now())
  setTimeout(() => {
    shown.value = 100
    done.value = true
    if (tipTimer !== null) clearTimeout(tipTimer)
  }, wait)
}
watch([progress, gameReady], ([val, ready]) => {
  if (waitsForGame ? ready : val >= 100) finish()
}, { immediate: true })

let cgLoadSignaled = false
const signalGameReadyToCG = () => {
  if (cgLoadSignaled) return
  cgLoadSignaled = true
  try { stopLoading() } catch (e) { console.warn('[FLogoProgress] CG ready-to-play failed', e) }
}

// Playgama's `game_ready` is certification-mandatory — fire it on the same
// splash-resolved edge as CG's loadingStop. The plugin guards the message
// internally so it fires once even if the watcher re-triggers.
//
// Gate uses the inline `import.meta.env.VITE_APP_*` literal (NOT the
// `isPlaygama` re-export from `useUser`) so Rollup can statically
// eliminate the dynamic-import branch on non-Playgama builds. The
// cross-module constant propagation isn't reliable enough for the
// re-exported `const` to be recognised as a build-time literal, and
// without DCE every build picks up a ~5 KB lazy `playgamaPlugin` chunk
// it never loads. Same pattern in `main.ts`.
let playgamaLoadSignaled = false
const signalGameReadyToPlaygama = () => {
  if (playgamaLoadSignaled) return
  if (import.meta.env.VITE_APP_PLAYGAMA !== 'true') return
  playgamaLoadSignaled = true
  void import('@/utils/playgamaPlugin').then(({ playgamaGameLoadingStop }) => {
    try { playgamaGameLoadingStop() }
    catch (e) { console.warn('[FLogoProgress] Playgama game_ready failed', e) }
  })
}

// GamePix's `gameLoaded` is the analogous certification-critical edge —
// the toolkit's pause/resume self-test requires a complete
// `customLoading → gameLoading(0..100) → gameLoaded` chain or
// `processLoadingEvent` dies on every pause click. The plugin guards the
// `gameLoaded` fire internally so re-triggering is harmless. Same
// `import.meta.env` literal pattern as the Playgama branch above so
// non-GamePix builds DCE the dynamic-import entirely.
let gamepixLoadSignaled = false
const signalGameReadyToGamepix = () => {
  if (gamepixLoadSignaled) return
  if (import.meta.env.VITE_APP_GAMEPIX !== 'true') return
  gamepixLoadSignaled = true
  void import('@/utils/gamepixPlugin').then(({ gamePixGameLoadingStop }) => {
    try { gamePixGameLoadingStop() }
    catch (e) { console.warn('[FLogoProgress] GamePix gameLoaded failed', e) }
  })
}

// Yandex's `LoadingAPI.ready()` is certification-mandatory — fire it on the
// same splash-resolved edge as CG / Playgama / GamePix. Cert text: "At the
// moment when the user can start playing the game, the LoadingAPI.ready()
// method from Game Ready must be called." The plugin guards the call
// internally so re-triggering is harmless. Same `import.meta.env` literal
// pattern as the platform branches above so non-Yandex builds DCE the
// dynamic-import entirely.
let yandexLoadSignaled = false
const signalGameReadyToYandex = () => {
  if (yandexLoadSignaled) return
  if (import.meta.env.VITE_APP_YANDEX !== 'true') return
  yandexLoadSignaled = true
  void import('@/utils/yandexPlugin').then(({ yandexLoadingReady }) => {
    try { yandexLoadingReady() }
    catch (e) { console.warn('[FLogoProgress] Yandex LoadingAPI.ready failed', e) }
  })
}

// Poki's `gameLoadingFinished()` — same splash-resolved edge, once (the
// plugin guards it too, and holds gameplayStart until it has gone out).
let pokiLoadSignaled = false
const signalGameReadyToPoki = () => {
  if (pokiLoadSignaled) return
  if (import.meta.env.VITE_APP_POKI !== 'true') return
  pokiLoadSignaled = true
  void import('@/utils/pokiPlugin').then(({ pokiGameLoadingFinished }) => pokiGameLoadingFinished())
    .catch((e) => console.warn('[FLogoProgress] Poki gameLoadingFinished failed', e))
}

watch(done, (isDone) => {
  if (isDone) {
    setTimeout(() => {
      backdropHidden.value = true
      signalGameReadyToCG()
      signalGameReadyToPlaygama()
      signalGameReadyToPoki()
      signalGameReadyToGamepix()
      signalGameReadyToYandex()
      // Triggers the GamePix first-load interstitial (no-op on other builds
      // — the orchestrator was never armed). GD / GameMonetize used to share
      // this fire but were removed above; their first-load ad is gone, the
      // midgame placement is the only ad on those builds now. Runs alongside
      // the platform `game_ready` / `gameLoaded` signals so the ad lands
      // immediately once the splash is gone and the SDK is fillable.
      notifySplashGone()
    }, 150)
  }
})
</script>

<style scoped lang="sass">
.no-os-ui
  caret-color: transparent
  user-select: none
  -webkit-user-select: none
  -webkit-touch-callout: none
  -webkit-tap-highlight-color: transparent

  &, & *
    -webkit-user-drag: none

.splash-progress
  position: absolute
  top: calc(100% + clamp(0.5rem, 2.5vmin, 1.25rem))
  left: 50%
  display: flex
  align-items: center
  gap: clamp(0.4rem, 1.6vmin, 0.75rem)
  width: clamp(10rem, 44vmin, 22rem)
  transform: translateX(-50%)

.splash-progress__track
  position: relative
  flex: 1 1 auto
  min-width: 6rem
  height: clamp(0.9rem, 3vmin, 1.4rem)
  border: 3px solid #1c1724
  border-radius: 0.15rem
  overflow: hidden
  // A parchment strip with a faint lengthwise fold.
  background: linear-gradient(to bottom, #fff6e3 0 50%, #f4e7c9 50% 100%)
  box-shadow: 0 4px 0 rgba(76, 64, 120, 0.45)

.splash-progress__fill
  height: 100%
  border-right: 2px solid #1c1724
  // Red paper, creased along its length.
  background: linear-gradient(to bottom, #ff6a5c 0 52%, #d8433b 52% 100%)
  transition: width 0.2s ease-out

.percentage-text
  flex: 0 0 auto
  min-width: 3ch
  color: #fff
  font-size: clamp(0.9rem, 4vmin, 1.35rem)
  font-weight: 900
  text-shadow: 2px 0 0 #1c1724, -2px 0 0 #1c1724, 0 2px 0 #1c1724, 0 -2px 0 #1c1724, 1.5px 1.5px 0 #1c1724, -1.5px 1.5px 0 #1c1724, 1.5px -1.5px 0 #1c1724, -1.5px -1.5px 0 #1c1724

.splash-backdrop
  position: fixed
  inset: 0
  z-index: 150
  // Matches the inline splash in index.html, so the handover static HTML →
  // Vue splash is one continuous colour: warm desk light over dark wood.
  background: radial-gradient(circle at 50% 38%, #8a5a36 0%, #3a2416 70%)

.splash-fade-leave-active
  transition: opacity 0.4s ease-out
  pointer-events: none

.splash-fade-leave-to
  opacity: 0

.logo-fade-leave-active
  transition: opacity 0.35s ease-out, transform 0.35s ease-out
  pointer-events: none

.logo-fade-leave-to
  opacity: 0
  transform: translate(-50%, -50%) scale(0.85)

.splash-tip-slot
  position: absolute
  top: calc(100% + clamp(2.6rem, 9vmin, 4rem))
  left: 50%
  transform: translateX(-50%)
  width: min(86vw, 26rem)
  display: flex
  justify-content: center

// A tip printed on a small slip of paper, tilted a touch.
.splash-tip
  padding: clamp(0.35rem, 1.2vmin, 0.55rem) clamp(0.7rem, 2.6vmin, 1rem)
  background: linear-gradient(135deg, #fff6e3 0 60%, #f3e3bf 60% 100%)
  border: 2px solid #1c1724
  border-radius: 0.4rem
  box-shadow: 0 4px 0 rgba(76, 64, 120, 0.45)
  color: #1c1724
  font-size: clamp(0.78rem, 2.8vmin, 1rem)
  text-align: center
  line-height: 1.3
  transform: rotate(-1.2deg)

.tip-swap-enter-active, .tip-swap-leave-active
  transition: opacity 0.25s ease, transform 0.25s ease
.tip-swap-enter-from
  opacity: 0
  transform: translateY(8px) rotate(-4deg)
.tip-swap-leave-to
  opacity: 0
  transform: translateY(-8px) rotate(2deg)

.stuck-hint
  // Clears the progress strip hanging below the logo box.
  margin-top: clamp(6rem, 18vmin, 8rem)
  color: #fff6e3
  font-size: clamp(0.8rem, 3vmin, 0.95rem)
  text-align: center
  max-width: 80vw
</style>
