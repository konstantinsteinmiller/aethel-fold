<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import useTowerEconomy from '@/use/useTowerEconomy'
import useSounds from '@/use/useSound.ts'
import { spawnCoinExplosion } from '@/use/useCoinExplosion'
import IconCoin from '@/components/icons/IconCoin.vue'
// Persist through the unified `aethel-fold_state` blob — getState/setState write
// the chest's collected-at key into the single in-memory record that the
// SaveManager mirrors to localStorage AND the active platform SDK's cloud save.
import { getState, setState } from '@/use/useTowerState'
import { CHEST_KEY } from '@/keys'

interface Props {
  /** Element where the coin explosion VFX flies to (the coin badge). */
  targetEl?: HTMLElement | null
}

const props = withDefaults(defineProps<Props>(), {
  targetEl: null
})

const { addCoins } = useTowerEconomy()
const { playSound } = useSounds()

const SMALL_READY_AT_MS = 3 * 60 * 1000
const BIG_READY_AT_MS = 10 * 60 * 1000
const SMALL_REWARD = 25
const BIG_REWARD = 100

const STORAGE_KEY = CHEST_KEY

const readStoredAt = () => {
  const v = getState<unknown>(STORAGE_KEY)
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? n : 0
}

const lastCollectedAt = ref(readStoredAt())
const tickNow = ref(Date.now())
let tickIntervalId: number | null = null

const elapsedMs = computed(() => Math.max(0, tickNow.value - lastCollectedAt.value))

type Phase = 'cooldown' | 'small' | 'big'
const phase = computed<Phase>(() => {
  if (elapsedMs.value < SMALL_READY_AT_MS) return 'cooldown'
  if (elapsedMs.value < BIG_READY_AT_MS) return 'small'
  return 'big'
})

const isReady = computed(() => phase.value !== 'cooldown')
const currentReward = computed(() => (phase.value === 'big' ? BIG_REWARD : SMALL_REWARD))

const remainingMs = computed(() => {
  if (phase.value === 'cooldown') return SMALL_READY_AT_MS - elapsedMs.value
  if (phase.value === 'small') return BIG_READY_AT_MS - elapsedMs.value
  return 0
})

const timeDisplay = computed(() => {
  const totalSec = Math.ceil(remainingMs.value / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})

const cooldownRingPct = computed(() => {
  if (phase.value !== 'cooldown') return 0
  return remainingMs.value / SMALL_READY_AT_MS
})

const rootEl = ref<HTMLElement | null>(null)

const onClick = () => {
  if (!isReady.value) return
  const reward = currentReward.value
  addCoins(reward)
  playSound('reward-continue', 0.06)
  if (rootEl.value && props.targetEl) {
    spawnCoinExplosion({ sourceEl: rootEl.value, targetEl: props.targetEl })
  }
  lastCollectedAt.value = Date.now()
  setState(STORAGE_KEY, lastCollectedAt.value)
}

onMounted(() => {
  tickIntervalId = window.setInterval(() => {
    tickNow.value = Date.now()
    const stored = readStoredAt()
    if (stored !== lastCollectedAt.value) lastCollectedAt.value = stored
  }, 1000)
})
onUnmounted(() => {
  if (tickIntervalId !== null) clearInterval(tickIntervalId)
})
</script>

<template lang="pug">
  div.treasure-chest.pointer-events-auto.cursor-pointer.relative(
    ref="rootEl"
    :class="{ 'is-ready': isReady, 'is-big': phase === 'big' }"
    @click="onClick"
  )
    //- Programmatic chest art (SVG). The cooldown overlay sits inside the
    //- same SVG so a clipPath built from the chest body + lid can mask it
    //- to the icon's silhouette — the overlay shrinks within the chest
    //- outline rather than as a separate ring around it.
    svg(
      viewBox="0 0 64 64"
      class="block w-12 h-12 sm:w-14 sm:h-14 chest-svg"
    )
      defs
        linearGradient(id="chestBody" x1="0" y1="0" x2="0" y2="1")
          stop(offset="0" stop-color="#a05a2c")
          stop(offset="1" stop-color="#5a2e10")
        linearGradient(id="chestLid" x1="0" y1="0" x2="0" y2="1")
          stop(offset="0" stop-color="#c0732e")
          stop(offset="1" stop-color="#7d4017")
        clipPath(id="chestClip")
          rect(x="6" y="28" width="52" height="28" rx="3")
          path(d="M6 28 Q32 8 58 28 Z")
      rect(x="6" y="28" width="52" height="28" rx="3" fill="url(#chestBody)" stroke="#2a1607" stroke-width="2")
      path(d="M6 28 Q32 8 58 28 Z" fill="url(#chestLid)" stroke="#2a1607" stroke-width="2")
      rect(x="26" y="34" width="12" height="14" rx="2" fill="#fcd34d" stroke="#5a3408" stroke-width="1.5")
      circle(cx="32" cy="40" r="2" fill="#5a3408")
      rect(x="6" y="38" width="52" height="3" fill="#3a1d09" opacity="0.6")
      rect(x="6" y="50" width="52" height="3" fill="#3a1d09" opacity="0.6")

      //- Cooldown overlay: 0.5-opacity black, clipped to the chest outline
      //- via `chestClip`. The rect drains from the top down — at start it
      //- covers the whole chest, at full cooldown it's gone.
      rect(
        v-if="phase === 'cooldown'"
        x="0"
        :y="64 * (1 - cooldownRingPct)"
        width="64"
        :height="64 * cooldownRingPct"
        fill="rgba(0,0,0,0.5)"
        clip-path="url(#chestClip)"
        style="transition: y 0.3s linear, height 0.3s linear"
      )

    //- Status label: a countdown while it fills, the payout once it is ready.
    //- Both sit in the same slot so the chest's footprint never jumps.
    div.chest-label
      span.chest-timer(v-if="!isReady") {{ timeDisplay }}
      span.chest-payout(v-else :class="{ 'is-big': phase === 'big' }")
        IconCoin(class="chest-payout__coin")
        span.chest-payout__value +{{ currentReward }}
</template>

<style scoped lang="sass">
.treasure-chest
  width: 3rem
  height: 3rem
  position: relative

@media (min-width: 640px)
  .treasure-chest
    width: 3.5rem
    height: 3.5rem

.chest-svg
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6))

.is-ready .chest-svg
  animation: chest-bob 1s ease-in-out infinite alternate

@keyframes chest-bob
  from
    transform: translateY(0)
  to
    transform: translateY(-3px)

.is-big .chest-svg
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6)) drop-shadow(0 0 8px rgba(255, 160, 0, 0.8))

// ─── Status label ───────────────────────────────────────────────────────────
//
// The countdown and the payout share one slot, centred under the chest, so the
// chest's footprint never jumps when it becomes ready.
//
// The payout chip is built in the same language as the rest of the HUD — dark
// outline, vertical gradient, drop shadow, outlined text. The previous version
// was a flat slab of raw `auraColor` with a stray `mr-4` on the value, which
// left a third of the chip empty and shoved the number off-centre.
.chest-label
  position: absolute
  top: calc(100% + 0.15rem)
  left: 50%
  translate: -50% 0
  display: flex
  justify-content: center
  // The chip is wider than the chest; letting it size itself and centre keeps
  // it from shunting the wallet column around.
  white-space: nowrap
  pointer-events: none

.chest-timer
  display: inline-block
  padding: 0.05em 0.4em
  border-radius: 999px
  background-color: rgba(10, 16, 30, 0.72)
  color: #cfdcf0
  font-weight: 900
  font-size: clamp(0.5rem, 2.1vw, 0.66rem)
  line-height: 1.5
  letter-spacing: 0.04em
  text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.8)

.chest-payout
  display: inline-flex
  align-items: center
  justify-content: center
  gap: 0.2em
  padding: 0.1em 0.45em
  border: 2px solid #2a1c06
  border-radius: 999px
  background-image: linear-gradient(to bottom, #cfd9e6, #93a3b8)
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.45)
  line-height: 1

  // The 10-minute chest is the one worth waiting for, so it gets the gold
  // treatment and the aura; the 3-minute one stays quiet silver.
  &.is-big
    background-image: linear-gradient(to bottom, #ffd85c, #f0a01c)
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.45), 0 0 12px rgba(255, 170, 30, 0.75)

.chest-payout__coin
  flex: 0 0 auto
  width: clamp(0.5rem, 2.1vw, 0.7rem)
  height: clamp(0.5rem, 2.1vw, 0.7rem)
  color: #fff6d0
  filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.5))

.chest-payout__value
  color: #fff
  font-weight: 900
  font-size: clamp(0.5rem, 2.1vw, 0.68rem)
  line-height: 1.4
  text-shadow: 1.5px 1.5px 0 rgba(0, 0, 0, 0.75)
</style>
