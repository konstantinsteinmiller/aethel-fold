<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'

import useTowerGame, {
  phase, wave, wood, stone, runCoins,
  enemiesLeft, enemiesTotal, gateHpPct, buildTimeLeft, gameSpeed,
  lastWaveReward, isBossIncoming, towerVersion, getBlocks, offers,
  offerEnhanced, rerollReadyIn, allyCount,
  startRun, resumeRun, placeShape, sellBlock, canPlaceShapeAt,
  canAffordShape, callWave, toggleSpeed, step, runSummary, saveRunSnapshot,
  manualReroll, canManualReroll, dealEnhancedOffers, summonCavalry, cavalryCost,
  halfWidthAt, speedBuffLeft, grantSpeedBuff, graceAvailable, continueRun
} from '@/use/useTowerGame'
import {
  setViewport, snapToFit, screenToCell, panBy, zoomAt,
  beginPinch, updatePinch, endPinch, recenter, isManual,
  getZoom, worldToScreenX, worldToScreenY
} from '@/use/useTowerCamera'
import { drawScene, resetDrawnFx, setBuildOverlay } from '@/use/useTowerArt'
import { resetVfx } from '@/use/useTowerVfx'
import { warmAudio } from '@/use/useTowerAudio'
import { warmSpriteProbes } from '@/game/art'
import useTowerProgress, { buildHalfWidth, bestWave } from '@/use/useTowerProgress'
import {
  reportRun, rankFor, boardSize, playerTotal, leaderboardEnabled,
  leaderboardPending, OUTSIDE_BOARD
} from '@/use/useLeaderboard'
import useTowerEconomy from '@/use/useTowerEconomy'
import useMissions, { beginMissionRun } from '@/use/useMissions'
import useAchievements from '@/use/useAchievements'
import useBattlePass from '@/use/useBattlePass'
import { BUILDABLE_BLOCKS, GATE_ID } from '@/game/blocks'
import { OFFER_SLOTS, SHAPE_BY_ID } from '@/game/shapes'
import { ENEMY_DEFS } from '@/game/enemies'
import { earlyCallBonus, planWave, countSiege } from '@/game/waves'
import type { Block } from '@/game/types'

import { getState, setState } from '@/use/useTowerState'
import { DAILY_BONUS_DAY_KEY, ONBOARDED_KEY, TECH_SPOTLIGHT_KEY, TUTORIAL_KEY } from '@/keys'
import useSounds, { useMusic } from '@/use/useSound'
import { useScreenshake } from '@/use/useScreenshake'
import { isGamePaused, isAdShowing } from '@/use/useGamePause'
import { isMobileLandscape } from '@/use/useUser'
import { isCrazyGamesFullRelease } from '@/use/useMatch'
import { spawnCoinExplosion } from '@/use/useCoinExplosion'
import { isInterstitialReady, showMidgameAd } from '@/use/useAds'
import {
  claimReward, canOfferReward, adInFlight, isRewardGated,
  canShowInterstitial, markInterstitialShown
} from '@/use/useAdGate'
import { signalGameplayLoaded } from '@/use/useCrazyGames'
import { syncGameplayLifecycle } from '@/use/useGameplayLifecycle'
import { isAnyModalOpen } from '@/use/useModalState'
import { playFirstStartInterstitial } from '@/use/useFirstStartInterstitial'

import WaveHud from '@/components/game/WaveHud.vue'
import ResourceBar from '@/components/game/ResourceBar.vue'
import BuildTray from '@/components/game/BuildTray.vue'
import BlockInspector from '@/components/game/BlockInspector.vue'
import CallWaveButton from '@/components/game/CallWaveButton.vue'
import ControlHint, { type HintId } from '@/components/game/ControlHint.vue'
import WaveClearToast from '@/components/game/WaveClearToast.vue'
import TutorialOverlay, { type TutorialStep } from '@/components/game/TutorialOverlay.vue'
import TutorialPrompt from '@/components/game/TutorialPrompt.vue'
import FHudButton from '@/components/atoms/FHudButton.vue'
import FHudBadge from '@/components/atoms/FHudBadge.vue'
import FMuteButton from '@/components/atoms/FMuteButton.vue'
import FReward from '@/components/atoms/FReward.vue'
import FButton from '@/components/atoms/FButton.vue'
import FRewardButton from '@/components/atoms/FRewardButton.vue'
import CoinBadge from '@/components/organisms/CoinBadge.vue'
import TreasureChest from '@/components/organisms/TreasureChest.vue'
import DailyRewards from '@/components/organisms/DailyRewards.vue'
import AdRewardButton from '@/components/organisms/AdRewardButton.vue'
import BattlePass from '@/components/organisms/BattlePass.vue'
import AchievementsButton from '@/components/organisms/AchievementsButton.vue'
import MissionsModal from '@/components/organisms/MissionsModal.vue'
import OptionsModal from '@/components/organisms/OptionsModal.vue'
import TechTreeModal from '@/components/organisms/TechTreeModal.vue'
import IconCoin from '@/components/icons/IconCoin.vue'
import IconMovie from '@/components/icons/IconMovie.vue'

const { t } = useI18n()
void useTowerGame // the composable surface is imported directly above
const progress = useTowerProgress()
const { coins, addCoins, spendCoins } = useTowerEconomy()
const { recordRun } = useMissions()
const { recordRun: recordAchievementRun } = useAchievements()
const { awardWaveCleared, awardRunFinished } = useBattlePass()
const { startBattleMusic, stopBattleMusic } = useMusic()
const { playSound } = useSounds()
const { shakeStyle } = useScreenshake()

// ─── Canvas + render loop ───────────────────────────────────────────────────

const canvasRef = ref<HTMLCanvasElement | null>(null)
const topBarRef = ref<HTMLElement | null>(null)
const bottomBarRef = ref<HTMLElement | null>(null)
const trayPerksRef = ref<HTMLElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
let rafId = 0
let lastT = 0
let cssW = 0
let cssH = 0
let dpr = 1

/** HUD insets fed to the camera so auto-fit never frames the tower under the
 *  top bar or behind the build tray. Measured from the real elements rather
 *  than guessed, so a wrapped title or a taller tray is accounted for. */
const measureInsets = (): { top: number; bottom: number } => {
  if (isMobileLandscape.value) {
    return { top: (topBarRef.value?.getBoundingClientRect().height ?? 0) + 8, bottom: 8 }
  }
  // The perk row floats ABOVE the bottom bar (out of flow, so it doesn't
  // stretch it), which means the bar's own rect stops short of the highest
  // thing actually covering the battlefield. Taking the union keeps the Gate
  // from ending up behind the "Reinforced hand" button on a phone.
  const barTop = bottomBarRef.value?.getBoundingClientRect().top ?? window.innerHeight
  const perkTop = trayPerksRef.value?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY
  const coveredFrom = Math.min(barTop, perkTop)
  return {
    top: (topBarRef.value?.getBoundingClientRect().height ?? 0) + 8,
    bottom: Math.max(0, window.innerHeight - coveredFrom) + 8
  }
}

const resize = (): void => {
  const canvas = canvasRef.value
  if (!canvas) return
  // Clamp DPR to 2: past that the pixel cost doubles again for no perceptible
  // gain on a phone, and it is the difference between 60 fps and 40 on mid-tier
  // Android.
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  cssW = window.innerWidth
  cssH = window.innerHeight
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  canvas.style.width = `${cssW}px`
  canvas.style.height = `${cssH}px`
  ctx = canvas.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  const insets = measureInsets()
  setViewport(cssW, cssH, insets.top, insets.bottom)
  snapToFit()
}

const loop = (t: number): void => {
  rafId = requestAnimationFrame(loop)
  const dt = lastT ? Math.min(t - lastT, 120) : 16
  lastT = t

  // The pause gate covers ads, hidden tabs and platform SDK pauses. The render
  // loop keeps running (so the frame under an ad isn't a frozen artefact) but
  // the simulation clock does not advance.
  if (!isGamePaused.value && !showResult.value) step(dt)

  if (ctx) drawScene(ctx, cssW, cssH, dt, dpr)
}

// ─── Build state ────────────────────────────────────────────────────────────

/** Index of the armed offer slot (0-3), or null when nothing is selected. */
const selectedSlot = ref<number | null>(null)
const inspected = ref<Block | null>(null)
const hoverCell = ref<{ c: number; r: number } | null>(null)

/** The shape id in the armed slot. */
const selectedShape = computed<string | null>(() =>
  selectedSlot.value == null ? null : (offers.value[selectedSlot.value] ?? null)
)

/**
 * Every legal ANCHOR cell for the armed shape.
 *
 * Recomputed only when the tower's occupancy or the armed shape changes, never
 * per frame. The scan band is widened by the shape's own footprint so a piece
 * whose anchor sits outside the tower (an L reaching in from the side) is still
 * offered as a candidate.
 */
const legalSlots = computed<Array<[number, number]>>(() => {
  const shapeId = selectedShape.value
  if (!shapeId) return []
  void towerVersion.value
  const def = SHAPE_BY_ID[shapeId]
  if (!def) return []

  let shapeW = 1
  let shapeH = 1
  for (const [dx, dy] of def.cells) {
    if (dx + 1 > shapeW) shapeW = dx + 1
    if (dy + 1 > shapeH) shapeH = dy + 1
  }

  // Scan the widest row the tower can ever reach: the foundation is capped
  // narrower than the upper floors, so scanning `buildHalfWidth` alone would
  // still be right, but taking the max keeps this correct if either cap moves.
  const halfW = Math.max(buildHalfWidth.value, halfWidthAt(0))
  let maxR = 0
  for (const b of getBlocks().values()) if (b.r > maxR) maxR = b.r

  const out: Array<[number, number]> = []
  for (let c = -halfW; c <= halfW - shapeW + 1; c++) {
    for (let r = 0; r <= maxR + 1; r++) {
      if (canPlaceShapeAt(shapeId, c, r)) out.push([c, r])
    }
  }
  void shapeH
  return out
})

// Publish the build overlay to the renderer whenever any input changes.
watch(
  [selectedShape, hoverCell, legalSlots, inspected],
  () => {
    const hover = hoverCell.value
    const shapeId = selectedShape.value
    const valid = !!(shapeId && hover
      && canPlaceShapeAt(shapeId, hover.c, hover.r) && canAffordShape(shapeId))
    setBuildOverlay({
      selectedShape: shapeId,
      hoverC: hover?.c ?? null,
      hoverR: hover?.r ?? null,
      hoverValid: valid,
      slots: legalSlots.value,
      inspectC: inspected.value?.c ?? null,
      inspectR: inspected.value?.r ?? null
    })
  },
  { immediate: true, deep: false }
)

// ─── Pointer handling ───────────────────────────────────────────────────────
//
// One handler set drives tap-to-place, tap-to-inspect, drag-to-pan,
// pinch-to-zoom and long-press-to-inspect. Tap vs drag is decided by a movement
// threshold, so a slightly shaky finger still places a block instead of
// silently nudging the camera two pixels.

const TAP_SLOP_PX = 10
const LONG_PRESS_MS = 450

const pointers = new Map<number, { x: number; y: number }>()
let downX = 0
let downY = 0
let downAt = 0
let lastX = 0
let lastY = 0
let moved = false
let panning = false
let longPressFired = false
let longPressTimer: ReturnType<typeof setTimeout> | null = null

const clearLongPress = (): void => {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
}

const onPointerDown = (e: PointerEvent): void => {
  // In a portal iframe the frame does not hold keyboard focus on load, and the
  // `preventDefault` below cancels the implicit focus transfer a click would
  // otherwise cause — so claim focus explicitly, or Space/Enter never arrive.
  try { window.focus() } catch { /* a cross-origin parent may refuse */ }
  e.preventDefault()

  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  try { canvasRef.value?.setPointerCapture(e.pointerId) } catch { /* ignore */ }

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    beginPinch(Math.hypot(a!.x - b!.x, a!.y - b!.y))
    clearLongPress()
    panning = false
    return
  }

  downX = lastX = e.clientX
  downY = lastY = e.clientY
  downAt = performance.now()
  moved = false
  panning = false
  longPressFired = false

  // Long-press opens the inspector for an existing block. The press itself is
  // never destructive — selling lives behind the inspector's own button.
  clearLongPress()
  longPressTimer = setTimeout(() => {
    longPressTimer = null
    if (moved) return
    const cell = screenToCell(downX, downY)
    const block = getBlocks().get(`${cell.c},${cell.r}`)
    if (!block) return
    longPressFired = true
    inspected.value = block
    selectedSlot.value = null
    playSound('modal-open', 0.05)
  }, LONG_PRESS_MS)
}

const onPointerMove = (e: PointerEvent): void => {
  if (!pointers.has(e.pointerId)) {
    // Mouse hover with no button held: preview the placement cell.
    if (e.pointerType === 'mouse' && selectedShape.value) {
      hoverCell.value = screenToCell(e.clientX, e.clientY)
    }
    return
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

  if (pointers.size >= 2) {
    const [a, b] = [...pointers.values()]
    updatePinch(
      Math.hypot(a!.x - b!.x, a!.y - b!.y),
      (a!.x + b!.x) / 2,
      (a!.y + b!.y) / 2
    )
    return
  }

  if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) > TAP_SLOP_PX) {
    moved = true
    panning = true
    clearLongPress()
  }
  if (panning) {
    // Per-frame delta, so the world tracks the finger 1:1.
    panBy(e.clientX - lastX, e.clientY - lastY)
    markHintDone('camera')
  }
  lastX = e.clientX
  lastY = e.clientY
  if (selectedShape.value) hoverCell.value = screenToCell(e.clientX, e.clientY)
}

const onPointerUp = (e: PointerEvent): void => {
  const wasSingle = pointers.size === 1
  pointers.delete(e.pointerId)
  if (pointers.size < 2) endPinch()
  clearLongPress()

  if (!wasSingle || moved || longPressFired) { panning = false; return }

  const cell = screenToCell(e.clientX, e.clientY)

  if (selectedSlot.value != null) {
    tryPlace(cell.c, cell.r)
    return
  }

  // Nothing armed: tap a block to inspect it, tap empty space to dismiss.
  inspected.value = getBlocks().get(`${cell.c},${cell.r}`) ?? null
}

const onWheel = (e: WheelEvent): void => {
  zoomAt(e.deltaY < 0 ? 1.12 : 0.89, e.clientX, e.clientY)
  markHintDone('camera')
}

const tryPlace = (c: number, r: number): void => {
  const slot = selectedSlot.value
  const shapeId = selectedShape.value
  if (slot == null || !shapeId) return

  if (!canPlaceShapeAt(shapeId, c, r) || !canAffordShape(shapeId)) {
    // A short negative click is better feedback than silence — it confirms the
    // tap registered and the placement was rejected, not missed.
    playSound('obstacle-hit', 0.03)
    return
  }
  if (!placeShape(slot, c, r)) return

  markHintDone('placeBlock')
  completeTutorialStep('place')
  // The slot has already rerolled to a new piece. Keep it armed only if the
  // replacement is affordable — otherwise the player would be left holding a
  // shape they cannot place, with the ghost stuck red under their finger.
  const next = offers.value[slot]
  if (!next || !canAffordShape(next)) selectedSlot.value = null
  if (phase.value === 'build') saveRunSnapshot()
}

const onSelectSlot = (slot: number | null): void => {
  selectedSlot.value = slot
  inspected.value = null
  if (slot != null) {
    markHintDone('selectBlock')
    completeTutorialStep('pick')
  }
}

// ─── Control hints ──────────────────────────────────────────────────────────
//
// One hint at a time, chosen by "what does the player most need to know now",
// each retiring permanently the first time the action is performed.

const hintsDone = ref<Set<HintId>>(new Set())
const onboarded = ref(getState<boolean>(ONBOARDED_KEY, false) === true)

const markHintDone = (id: HintId): void => {
  if (hintsDone.value.has(id)) return
  const next = new Set(hintsDone.value)
  next.add(id)
  hintsDone.value = next
}

const activeHint = computed<HintId | null>(() => {
  // Never nag a veteran, and never talk over a result screen.
  if (onboarded.value || showResult.value || isAnyModalOpen.value) return null
  if (phase.value === 'defeat') return null
  if (!hintsDone.value.has('selectBlock') && selectedSlot.value == null) return 'selectBlock'
  if (!hintsDone.value.has('placeBlock') && selectedSlot.value != null) return 'placeBlock'
  if (!hintsDone.value.has('callWave') && phase.value === 'build' && wave.value === 0) return 'callWave'
  if (!hintsDone.value.has('camera') && wave.value >= 1) return 'camera'
  return null
})

// After the second wave the player has seen every primer that matters; persist
// that so a returning player is never re-onboarded.
watch(wave, (w) => {
  if (w >= 2 && !onboarded.value) {
    onboarded.value = true
    setState(ONBOARDED_KEY, true)
  }
})

// ─── Result flow ────────────────────────────────────────────────────────────

const showResult = ref(false)
const showOptions = ref(false)
const showTech = ref(false)
const isAdInFlight = ref(false)
const twoXUsed = ref(false)
const firstRunBonusActive = ref(false)
const summary = ref(runSummary())

// ── Leaderboard ──
// Everything here degrades to "not shown". A board that is unset, unreachable
// or still loading must never keep the player on the defeat screen.
// The headline number is the player's BEST, with its rank — a rank computed
// from a weak run would drop every time they played badly, which reads as the
// board punishing them for playing. Showing the record standing, with this
// run's score beside it, makes "I did not beat it" the obvious reading and
// leaves the reason to play again on screen.
const bestScoreValue = computed(() => Math.max(progress.bestScore.value, summary.value.score))
const isRecordRun = computed(
  () => summary.value.score > 0 && summary.value.score >= bestScoreValue.value
)
const rankValue = computed(() => rankFor(bestScoreValue.value))
const rankPending = computed(() => leaderboardPending.value && rankValue.value === 0)
const showRank = computed(
  () => leaderboardEnabled && bestScoreValue.value > 0 && (rankPending.value || rankValue.value !== 0)
)
/** Formatted in script, not in the template: `#{…}` is Pug's own interpolation
 *  syntax, so a literal `#` in front of a mustache is a parse error. */
const rankDisplay = computed(() => {
  if (rankPending.value) return '…'
  if (rankValue.value === OUTSIDE_BOARD) return `#${boardSize().toLocaleString()}+`
  return `#${rankValue.value.toLocaleString()}`
})

const rewardCoinRef = ref<HTMLElement | null>(null)
const coinBadgeRef = ref<InstanceType<typeof CoinBadge> | null>(null)
const coinBadgeEl = computed<HTMLElement | null>(() => coinBadgeRef.value?.rootEl ?? null)

const todayKey = (): string => new Date().toISOString().slice(0, 10)

const twoXAvailable = computed(() =>
  !twoXUsed.value && summary.value.coins > 0 && canOfferReward.value
)

const RESULT_INTERSTITIAL_DELAY_MS = 600
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Show an interstitial, if one is due.
 *
 * Two gates: the provider must actually have inventory, and at least 120 s must
 * have passed since the last one. Every interstitial in the game goes through
 * here — the end of a wave and the defeat screen — so the pacing rule lives in
 * one place instead of each call site guessing.
 */
const maybeShowInterstitial = async (): Promise<void> => {
  if (!isInterstitialReady.value) return
  if (!canShowInterstitial()) return
  markInterstitialShown()
  await wait(RESULT_INTERSTITIAL_DELAY_MS)
  await showMidgameAd()
}

/**
 * Present the defeat screen.
 *
 * Ad ordering is deliberate: the interstitial is requested and AWAITED before
 * the result screen is revealed. Revealing first made the defeat sting play for
 * a beat and then get cut off the instant the ad covered the screen — a QA
 * finding that is easy to reintroduce by "simplifying" this function.
 *
 * The defeat sound is NOT played here. `endRun()` already emits a `gateFell`
 * FX event and the audio bus plays the sting the moment the Gate breaks;
 * playing it again here stacked two copies of the same sample.
 */
const presentDefeat = async (): Promise<void> => {
  const s = runSummary()
  summary.value = s
  twoXUsed.value = false
  stopBattleMusic()

  // Feed the run into every meta system BEFORE the screen renders, so the
  // numbers the player sees already include this run.
  //
  // The dailies have already been credited up to the last wave clear; this
  // catches the partial wave the player died in. It is a delta credit, so the
  // overlap costs nothing. Achievements are LIFETIME totals with a `runs`
  // counter, so they must be fed exactly once — here, and nowhere else.
  const run = { waves: s.wavesCleared, kills: s.kills, coins: s.coinsEarned, height: s.height, blocks: s.blocksPlaced }
  recordRun(run)
  recordAchievementRun(run)
  awardRunFinished()
  progress.recordRunEnd({
    wave: s.wave,
    kills: s.kills,
    score: s.score,
    wavesCleared: s.wavesCleared,
    height: s.height,
    blocks: s.blocks,
    blocksPlaced: s.blocksPlaced
  })
  // `recordRunEnd` has already folded this run into the stored best, so
  // `bestScore` is now the highest the player has ever managed — which is both
  // the number the board holds and the number the rank belongs to. Never
  // awaited: a slow or dead endpoint must not hold up the defeat screen.
  void reportRun(progress.bestScore.value, Math.max(s.wave, 1))
  firstRunBonusActive.value = getState<string>(DAILY_BONUS_DAY_KEY, '') !== todayKey()

  await maybeShowInterstitial()

  showResult.value = true
  void grantRunCoins()
}

const grantRunCoins = async (): Promise<void> => {
  const total = summary.value.coins
  if (total <= 0) return
  addCoins(total)
  await nextTick()
  const el = rewardCoinRef.value
  if (el && coinBadgeEl.value) {
    spawnCoinExplosion({
      sourceEl: el,
      targetEl: coinBadgeEl.value,
      count: Math.min(40, 12 + Math.round(total / 6))
    })
  }
}

const onTwoX = async (): Promise<void> => {
  if (adInFlight.value || !twoXAvailable.value) return
  const bonus = summary.value.coins
  await claimReward(() => {
    addCoins(bonus)
    twoXUsed.value = true
    const el = rewardCoinRef.value
    if (el && coinBadgeEl.value) {
      spawnCoinExplosion({ sourceEl: el, targetEl: coinBadgeEl.value, count: 26 })
    }
  })
}

const consumeFirstRunBonus = (): void => {
  if (!firstRunBonusActive.value) return
  firstRunBonusActive.value = false
  setState(DAILY_BONUS_DAY_KEY, todayKey())
}

/** Wipe the battlefield and start a fresh siege. */
const startFreshRun = (): void => {
  beginMissionRun()
  showResult.value = false
  selectedSlot.value = null
  inspected.value = null
  resetVfx()
  resetDrawnFx()
  startRun()
  progress.recordRunStart()
  snapToFit()
  startBattleMusic()
}

/**
 * "Defend again" — start a fresh siege from the result screen.
 *
 * Deliberately NOT behind a rewarded video, on any build. This is the way OUT
 * of a finished run: gating it means a player whose ad fails to fill is stuck
 * staring at the defeat screen with no way back into the game. The rewarded
 * placements are the 2× payout and the reinforced hand — things the player can
 * decline and carry on without.
 */
const onRebuild = (): void => {
  if (adInFlight.value) return
  consumeFirstRunBonus()
  startFreshRun()
}

/** "Upgrade!" — jump straight into the tech tree with the run's coins banked. */
const onUpgrade = (): void => {
  if (adInFlight.value) return
  consumeFirstRunBonus()
  showResult.value = false
  showTech.value = true
}

// Closing the tech tree after a defeat should drop the player into a new siege
// rather than back onto an empty battlefield. This path is deliberately NOT
// gated: the player left the result screen through "Upgrade!", so charging an
// ad for the restart they never asked for would be a trap.
watch(showTech, (open, wasOpen) => {
  if (!open && wasOpen && phase.value === 'defeat') startFreshRun()
})

watch(phase, (p, prev) => {
  if (p === 'defeat' && prev !== 'defeat') void presentDefeat()
  if (p === 'battle' && prev === 'build') {
    startBattleMusic()
    // Building during a battle is allowed, but the inspector's range circle is
    // clutter once the shooting starts.
    inspected.value = null
  }
})

/** Suppresses the wave-clear toast while a post-wave interstitial is on screen. */
const toastHeld = ref(false)

// A cleared wave feeds the battle pass, and is the natural interstitial beat:
// the player has just finished something and has not yet started the next
// thing. The ad is awaited BEFORE the wave-clear toast is allowed to run its
// animation, so the reward readout is never covered mid-flight. The 120 s floor
// in `useAdGate` keeps a fast run from stacking one break onto another.
watch(lastWaveReward, async (r) => {
  if (!r) return
  awardWaveCleared()
  // Daily missions tick here, not only at the end of the run. A wave clear is
  // the natural checkpoint: the player has just finished something, the numbers
  // are settled, and it is the moment they are most likely to open the panel.
  feedMissions()
  toastHeld.value = true
  await maybeShowInterstitial()
  toastHeld.value = false
})

// ─── First-stage tutorial ───────────────────────────────────────────────────
//
// The FIRST STAGE ONLY. Four beats, one line each, each pointing at the thing
// it is talking about — and then never again, for this player, on any device
// the save syncs to.
//
// It is deliberately not a difficulty setting or a replayable help screen: a
// player who needs it needs it once, and a player who does not is insulted by
// it. Everything after stage one is taught by the game being hard.

const TUTORIAL_STEPS: TutorialStep[] = ['gate', 'pick', 'place', 'call']

// Three states, only one of which is persisted.
//
//   not answered  → the offer box beside the tower
//   running       → the coach marks
//   answered      → nothing, ever again
//
// Only the ANSWER is written to `ts_tutorial`, and it goes through
// `setState`, which the SaveManager mirrors to whichever backend the build
// actually has — the platform SDK's cloud store on CrazyGames / Playgama /
// Yandex, plain localStorage everywhere else. So a player who skips on their
// phone is not asked again on their desktop.
const tutorialDone = ref(getState<boolean>(TUTORIAL_KEY, false) === true)
/** In-memory: the player tapped Start. Never persisted — an interrupted
 *  tutorial should offer itself again next session, not resume mid-step. */
const tutorialActive = ref(false)
const tutorialIndex = ref(0)
/** Rect of the element the current beat points at, in screen space. */
const tutorialRect = ref<{ x: number; y: number; w: number; h: number } | null>(null)

/** True while the first stage is still the right moment to teach anything. */
const inFirstStage = computed(() =>
  !tutorialDone.value
  && wave.value <= 1
  && !showResult.value
  && !isAnyModalOpen.value
)

const tutorialStep = computed<TutorialStep | null>(() => {
  if (!inFirstStage.value || !tutorialActive.value) return null
  return TUTORIAL_STEPS[tutorialIndex.value] ?? null
})

/** The offer is up until the player answers it one way or the other. */
const showTutorialPrompt = computed(() => inFirstStage.value && !tutorialActive.value)

/**
 * Where the offer box sits: beside the tower's footprint, level with the Gate.
 *
 * Projected from world space rather than pinned to a screen corner, so it reads
 * as pointing AT the tower and follows the camera when the player pans — but
 * flipped to the other side when the preferred one has no room. On a portrait
 * phone the tower sits near the middle of a 400 px-wide screen, and a box
 * anchored to its right simply runs off the edge.
 */
const PROMPT_WIDTH_PX = 190
const PROMPT_MARGIN_PX = 10

const tutorialPromptPos = computed(() => {
  void tutorialTick.value
  const half = halfWidthAt(0) + 1.2
  const right = worldToScreenX(half)
  const left = worldToScreenX(-half)
  const vw = typeof window === 'undefined' ? 1024 : window.innerWidth

  // Prefer the right of the tower; take the left when the box would be clipped.
  const fitsRight = right + PROMPT_WIDTH_PX + PROMPT_MARGIN_PX <= vw
  const onRight = fitsRight || left - PROMPT_WIDTH_PX - PROMPT_MARGIN_PX < 0
  const rawX = onRight ? right : left - PROMPT_WIDTH_PX

  return {
    // Clamped as a last resort: on a very narrow screen NEITHER side fits, and
    // a box half off the edge is worse than one overlapping the tower.
    x: Math.round(Math.max(
      PROMPT_MARGIN_PX,
      Math.min(rawX, vw - PROMPT_WIDTH_PX - PROMPT_MARGIN_PX)
    )),
    y: Math.round(worldToScreenY(1.2)),
    onRight
  }
})

const startTutorial = (): void => {
  tutorialActive.value = true
  tutorialIndex.value = 0
  measureTutorialTarget()
}

/** Persist the answer — completed and skipped are the same answer. */
const finishTutorial = (): void => {
  tutorialDone.value = true
  tutorialActive.value = false
  setState(TUTORIAL_KEY, true)
}

const advanceTutorial = (): void => {
  tutorialIndex.value++
  if (tutorialIndex.value >= TUTORIAL_STEPS.length) finishTutorial()
}

/** Advance when the player performs the step's action, not on a Next tap. */
const completeTutorialStep = (step: TutorialStep): void => {
  if (tutorialStep.value !== step) return
  advanceTutorial()
}

/**
 * Measure whatever the current beat is pointing at.
 *
 * Polled rather than observed: the targets are a canvas rect, a tray tile and a
 * HUD button that all move as the layout settles, and three ResizeObservers
 * plus a canvas-to-screen projection is a lot of machinery for four beats that
 * only ever run once.
 */
const measureTutorialTarget = (): void => {
  const step = tutorialStep.value
  if (!step) { tutorialRect.value = null; return }

  const fromEl = (sel: string): { x: number; y: number; w: number; h: number } | null => {
    const el = document.querySelector(sel)
    if (!el) return null
    const b = el.getBoundingClientRect()
    if (b.width <= 0 || b.height <= 0) return null
    return { x: b.x, y: b.y, w: b.width, h: b.height }
  }

  if (step === 'pick') { tutorialRect.value = fromEl('.build-tray__scroll'); return }
  if (step === 'call') { tutorialRect.value = fromEl('.call-wave__btn'); return }

  // `gate` and `place` point at the battlefield, which lives on the canvas —
  // so the rect is projected from world space rather than read from the DOM.
  const size = Math.max(48, getZoom())
  const gx = worldToScreenX(0)
  const gy = worldToScreenY(0.5)
  if (step === 'gate') {
    tutorialRect.value = { x: gx - size / 2, y: gy - size / 2, w: size, h: size }
    return
  }
  // `place`: the two cells flanking the Gate, which is where the first piece
  // can actually go.
  tutorialRect.value = {
    x: worldToScreenX(-1.5),
    y: gy - size / 2,
    w: size * 3,
    h: size
  }
}

/** Bumped by the poll below so the screen-space positions recompute. */
const tutorialTick = ref(0)
let tutorialTimer = 0

// NOT `immediate`. `tutorialStep` reads `showResult`, which is declared further
// down — an immediate watcher evaluates the computed during setup and dies in
// the temporal dead zone. The first measurement happens on mount instead, by
// which time every ref exists and the layout is real.
watch(tutorialStep, () => { measureTutorialTarget() })

// ─── Early-call bonus preview ───────────────────────────────────────────────

const callBonusPct = computed(() =>
  phase.value === 'build' ? Math.round((earlyCallBonus(buildTimeLeft.value) - 1) * 100) : 0
)

const onCallWave = (): void => {
  markHintDone('callWave')
  completeTutorialStep('call')
  selectedSlot.value = null
  callWave()
}

/**
 * Push the live run totals into the daily missions.
 *
 * `recordRun` credits deltas, so calling this often is free and calling it
 * twice for the same state is a no-op — which is what lets it run on a wave
 * clear, on the panel opening, and at the end of the run without any of them
 * having to know about the others.
 */
const feedMissions = (): void => {
  const s = runSummary()
  recordRun({
    waves: s.wavesCleared,
    kills: s.kills,
    coins: s.coinsEarned,
    height: s.height,
    blocks: s.blocksPlaced
  })
}

/**
 * Sell the block the inspector is open on.
 *
 * The inspector closes either way: after a sale the block is gone, and if the
 * sale was refused (the Gate cannot be sold) leaving the panel open on a button
 * that does nothing is worse than closing it.
 */
const onSellInspected = (): void => {
  const b = inspected.value
  inspected.value = null
  if (!b) return
  if (!sellBlock(b.c, b.r)) {
    playSound('obstacle-hit', 0.03)
    return
  }
  playSound('coin-pickup', 0.05)
}

/**
 * "3× coins" — triple the wave payout for a rewarded video.
 *
 * The wave's base payout has already been banked by `completeWave`, so this
 * grants the remaining 2× rather than the full amount. The figure is captured
 * BEFORE the ad plays: the next wave can complete while a video is on screen,
 * and paying out against whatever `lastWaveReward` had become by then would
 * either short-change the player or quietly overpay them.
 */
const onTripleWave = async (): Promise<void> => {
  const base = lastWaveReward.value?.coins ?? 0
  if (base <= 0 || adInFlight.value) return
  await claimReward(() => {
    addCoins(base * 2)
    playSound('level-up', 0.07)
    const el = coinBadgeEl.value
    if (el) spawnCoinExplosion({ sourceEl: el, targetEl: el, count: 24 })
  })
}

/**
 * Buy the 2x speed buff with a rewarded video.
 *
 * Five minutes, not one wave: a per-wave charge would have the player watching
 * an ad every ninety seconds, which is the kind of pacing portals reject. It
 * also extends rather than replaces, so a second video mid-buff never costs the
 * player time they already paid for.
 */
const onBuySpeed = async (): Promise<void> => {
  if (adInFlight.value) return
  await claimReward(() => {
    grantSpeedBuff()
    playSound('level-up', 0.07)
  })
}

// ─── Reinforced hand (rewarded) ─────────────────────────────────────────────

/**
 * Swap the whole hand for four reinforced shapes.
 *
 * Offered during the build phase only — mid-battle it would be a "pay to undo
 * a bad wave" button, which is exactly the pattern portals reject.
 */
/**
 * What the hand costs where there is no video to charge for it.
 *
 * Off-portal `claimReward` grants immediately, which would leave the reinforced
 * hand a free, unlimited button — and a free reroll into four better blocks is
 * not a perk, it is the build phase solved. Run coins are the right price:
 * the same currency the good blocks cost, so taking the hand is a real trade
 * against a mortar rather than a tap.
 */
const ENHANCED_HAND_COINS = 20

const onEnhancedHand = async (): Promise<void> => {
  if (adInFlight.value) return
  if (!isRewardGated) {
    if (runCoins.value < ENHANCED_HAND_COINS) return
    runCoins.value -= ENHANCED_HAND_COINS
  }
  await claimReward(() => {
    dealEnhancedOffers()
    selectedSlot.value = null
    playSound('level-up', 0.07)
  })
}

/**
 * One grace continue per run: rebuild the tower exactly as it stood and go back
 * into the build phase for the wave that beat them.
 *
 * Restores from the same snapshot the resume-after-reload path uses, so it is
 * the real layout and the real resources rather than an approximation. The
 * result screen is dismissed only if the restore actually succeeded.
 */
const onContinueRun = async (): Promise<void> => {
  if (adInFlight.value || !graceAvailable.value) return
  await claimReward(() => {
    if (!continueRun()) return
    showResult.value = false
    selectedSlot.value = null
    inspected.value = null
    resetVfx()
    resetDrawnFx()
    playSound('level-up', 0.07)
  })
}

const enhancedHandOffered = computed(() =>
  phase.value === 'build' && !offerEnhanced.value.some(Boolean)
)

// ─── Cavalry ────────────────────────────────────────────────────────────────

const cavalryPrice = computed(() => cavalryCost())
const canAffordCavalry = computed(() => coins.value >= cavalryPrice.value)

const onCavalry = (): void => {
  if (!canAffordCavalry.value) {
    playSound('obstacle-hit', 0.03)
    return
  }
  if (!spendCoins(cavalryPrice.value)) return
  summonCavalry()
  playSound('barricade', 0.05)
}

/**
 * Siege engines in the current wave.
 *
 * Standoff engines out-range most of the tower, so the cavalry button only
 * earns its screen space once there is something worth riding out to; the
 * counter is meant to read as an answer to a threat, not as a shop item.
 */
const siegeIncoming = computed(() => {
  void towerVersion.value
  return countSiege(planWave(wave.value))
})

const cavalryOffered = computed(() => phase.value === 'battle' && siegeIncoming.value > 0)

// ─── Manual reroll ──────────────────────────────────────────────────────────

const rerollSeconds = computed(() => Math.ceil(rerollReadyIn.value / 1000))
const rerollReady = computed(() => rerollReadyIn.value <= 0)

/**
 * Trade one offered shape for a new draw.
 *
 * Without this a run could deadlock into four unaffordable or useless offers;
 * the 10 s cooldown is what stops it becoming a free "reroll until perfect".
 */
const onReroll = (slot: number): void => {
  if (!canManualReroll()) {
    playSound('obstacle-hit', 0.03)
    return
  }
  if (manualReroll(slot)) {
    if (selectedSlot.value === slot) selectedSlot.value = null
    playSound('barricade', 0.04)
  }
}

// ─── Tech spotlight (one-shot) ──────────────────────────────────────────────

const techSpotlightSeen = ref(getState<boolean>(TECH_SPOTLIGHT_KEY, false) === true)
const showTechSpotlight = computed(() =>
  !techSpotlightSeen.value && progress.affordableCount.value > 0 && !showResult.value
)
const openTech = (): void => {
  showTech.value = true
  if (!techSpotlightSeen.value) {
    techSpotlightSeen.value = true
    setState(TECH_SPOTLIGHT_KEY, true)
  }
}

// ─── Keyboard ───────────────────────────────────────────────────────────────

const onKey = (e: KeyboardEvent): void => {
  const tgt = e.target
  if (tgt instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(tgt.tagName)) return

  if (e.code === 'Escape') {
    selectedSlot.value = null
    inspected.value = null
    return
  }
  if (e.repeat) return

  if ((e.code === 'Space' || e.code === 'Enter') && phase.value === 'build' && !showResult.value) {
    e.preventDefault()
    onCallWave()
    return
  }
  if (e.code === 'KeyF' && phase.value === 'battle') {
    toggleSpeed()
    return
  }
  // 1-4 arm the matching offer slot — the desktop speed-build path.
  const digit = Number(e.key)
  if (Number.isInteger(digit) && digit >= 1 && digit <= OFFER_SLOTS) {
    onSelectSlot(digit - 1)
  }
}

// ─── CrazyGames gameplay lifecycle ──────────────────────────────────────────
//
// The scene only reports whether play is live; `useCrazyGames` decides which
// events that turns into, because WHICH events to send is a platform contract
// and not a view concern (and was untestable while it lived here).
const isLiveGameplay = computed(
  () => phase.value !== 'defeat'
    && !showResult.value
    && !isAnyModalOpen.value
    && !isAdShowing.value
)
watch(isLiveGameplay, syncGameplayLifecycle, { immediate: true })

// ─── Boot ───────────────────────────────────────────────────────────────────

let booting = false

/**
 * Enter the game.
 *
 * A persisted `ts_run` snapshot is RESUMED rather than discarded — a player who
 * reloads mid-siege (or opens the game on another device after a cloud sync)
 * gets their tower back. This is also the visible half of the hydration
 * guarantee: had the cloud read silently failed, the player would land on an
 * empty foundation, which is exactly the "treated as a fresh user" bug the save
 * layer's boot-sanity guard exists to prevent.
 */
const boot = async (): Promise<void> => {
  if (booting) return
  booting = true
  try {
    // Moderation-mandated first-play interstitial on the networks that require
    // it; a no-op fast path everywhere else.
    await playFirstStartInterstitial()
    if (!resumeRun()) {
      startRun()
      progress.recordRunStart()
    }
    beginMissionRun()
    await nextTick()
    resize()
    snapToFit()
    startBattleMusic()
    // Loading is genuinely finished here: the run is resumed or started, the
    // canvas is sized, and the first frame is about to draw.
    signalGameplayLoaded()
  } finally {
    booting = false
  }
}

const fireCoinExplosion = (sourceEl: HTMLElement): void => {
  if (coinBadgeEl.value) spawnCoinExplosion({ sourceEl, targetEl: coinBadgeEl.value })
}

const onOrientationChange = (): void => { setTimeout(resize, 250) }

let insetTimer = 0

onMounted(() => {
  void boot()
  window.addEventListener('resize', resize)
  window.addEventListener('orientationchange', onOrientationChange)
  window.addEventListener('keydown', onKey)
  rafId = requestAnimationFrame(loop)

  // Warm the audio synthesis path and probe for drop-in art on an idle slot, so
  // neither competes with the first frame.
  const idle = (window as any).requestIdleCallback as ((cb: () => void, o?: any) => number) | undefined
  const warm = (): void => {
    warmAudio()
    warmSpriteProbes(
      BUILDABLE_BLOCKS.map((d) => d.id).concat(GATE_ID),
      Object.keys(ENEMY_DEFS)
    )
  }
  if (typeof idle === 'function') idle(warm, { timeout: 2500 })
  else setTimeout(warm, 400)

  // The HUD's height changes as its content does (a wrapped title, a tray that
  // gains a row). Re-measuring on a 1 s cadence is two `getBoundingClientRect`
  // reads — cheaper and far more robust than observing a dozen elements.
  insetTimer = window.setInterval(() => {
    if (cssW === 0) return
    const insets = measureInsets()
    setViewport(cssW, cssH, insets.top, insets.bottom)
  }, 1000)

  // The tutorial's spotlight tracks a camera that is still easing into place,
  // so it re-measures on a short cadence while it is up — and not at all once
  // it is finished, which for all but the first run is immediately.
  measureTutorialTarget()
  // Both the coach-mark spotlight and the offer box are positioned in screen
  // space from a camera that is still easing, so they re-measure on a short
  // cadence — and not at all once the tutorial is answered, which for every
  // run after the first is immediately.
  tutorialTimer = window.setInterval(() => {
    if (tutorialDone.value) return
    tutorialTick.value++
    if (tutorialStep.value) measureTutorialTarget()
  }, 250)
})

onUnmounted(() => {
  cancelAnimationFrame(rafId)
  window.removeEventListener('resize', resize)
  window.removeEventListener('orientationchange', onOrientationChange)
  window.removeEventListener('keydown', onKey)
  clearInterval(insetTimer)
  clearInterval(tutorialTimer)
  clearLongPress()
  stopBattleMusic()
  // A tab close mid-build must never cost the player their tower.
  saveRunSnapshot()
})
</script>

<template lang="pug">
  div.scene
    canvas.scene__canvas(
      ref="canvasRef"
      :style="shakeStyle"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel.prevent="onWheel"
      @contextmenu.prevent
    )

    //- ── HUD overlay ───────────────────────────────────────────────────────
    //- Non-interactive by default; individual controls opt back in.
    div.scene__hud
      //- Top bar: wave status (left), resources (centre), wallet (right).
      div.scene__top(ref="topBarRef")
        WaveHud(
          :wave="wave"
          :enemies-left="enemiesLeft"
          :enemies-total="enemiesTotal"
          :gate-hp-pct="gateHpPct"
          :phase="phase"
          :best-wave="bestWave"
        )
        ResourceBar(:wood="wood" :stone="stone" :coins="runCoins")
        div.scene__wallet
          CoinBadge(ref="coinBadgeRef")
          TreasureChest(:target-el="coinBadgeEl")

      //- Wave-clear payout toast, centred under the top bar.
      div.scene__toast
        WaveClearToast(
          :reward="toastHeld ? null : lastWaveReward"
          @triple="onTripleWave"
        )

      //- Control primer.
      div.scene__hint
        ControlHint(:hint="activeHint")

      //- Recenter appears only while the player has panned away.
      Transition(name="fade")
        button.scene__recenter(
          v-if="isManual"
          type="button"
          :aria-label="t('hud.recenter')"
          @click="recenter"
        )
          svg(viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round")
            path(d="M12 3v3M12 18v3M3 12h3M18 12h3")
            circle(cx="12" cy="12" r="4")

      //- Block inspector (bottom-left, above the meta row).
      div.scene__inspector
        BlockInspector(
          :block="inspected"
          @sell="onSellInspected"
          @close="inspected = null"
        )

      //- ── Bottom bar ────────────────────────────────────────────────────
      div.scene__bottom(ref="bottomBarRef")
        //- Meta buttons.
        div.scene__meta
          FMuteButton
          FHudButton(
            tone="slate"
            :aria-label="t('options.title')"
            @click="showOptions = true"
          )
            svg(viewBox="0 0 24 24" fill="currentColor")
              path(d="M12 4 a1 1 0 0 1 1 1 v1.6 a6 6 0 0 1 1.8 0.7 l1.1 -1.1 a1 1 0 0 1 1.4 1.4 l -1.1 1.1 a6 6 0 0 1 0.7 1.8 H18 a1 1 0 1 1 0 2 h-1.6 a6 6 0 0 1 -0.7 1.8 l1.1 1.1 a1 1 0 0 1 -1.4 1.4 l-1.1 -1.1 a6 6 0 0 1 -1.8 0.7 V18 a1 1 0 1 1 -2 0 v -1.6 a6 6 0 0 1 -1.8 -0.7 l-1.1 1.1 a1 1 0 0 1 -1.4 -1.4 l1.1 -1.1 a6 6 0 0 1 -0.7 -1.8 H6 a1 1 0 1 1 0 -2 h1.6 a6 6 0 0 1 0.7 -1.8 L7.2 7.6 a1 1 0 0 1 1.4 -1.4 l1.1 1.1 a6 6 0 0 1 1.8 -0.7 V5 a1 1 0 0 1 1 -1 Z M12 9 a3 3 0 1 0 0 6 a3 3 0 0 0 0 -6 Z")
          //DailyRewards(@coins-awarded="fireCoinExplosion")
          MissionsModal(@opened="feedMissions" @coins-awarded="fireCoinExplosion")
          //AchievementsButton(@coins-awarded="fireCoinExplosion")
          //AdRewardButton(@coins-awarded="fireCoinExplosion")
          //BattlePass(@coins-awarded="fireCoinExplosion")

        //- Build tray.
        div.scene__tray
          //- Rewarded perks that act on the hand sit directly above it, so the
          //- thing they change is always in view when the player taps them.
          div.scene__tray-perks(ref="trayPerksRef")
            FRewardButton(
              v-if="enhancedHandOffered"
              tone="gold"
              size="sm"
              :label="t('blocks.enhancedHand')"
              :coin-cost="ENHANCED_HAND_COINS"
              :coins="runCoins"
              @click="onEnhancedHand"
            )
            button.scene__cavalry(
              v-if="cavalryOffered"
              type="button"
              :class="{ 'is-poor': !canAffordCavalry }"
              :aria-label="t('allies.cavalry')"
              @click="onCavalry"
            )
              svg.scene__cavalry-icon(viewBox="0 0 24 24" fill="currentColor")
                path(d="M6 19l1-6 4-3 2-5 3 2-1 4 4 3-1 5h-2l1-4-3-2-3 3-1 3z")
                path(d="M15 4l3 1-1 2z")
              span.scene__cavalry-label {{ t('allies.cavalry') }}
              span.scene__cavalry-cost
                IconCoin(class="scene__cavalry-coin")
                | {{ cavalryPrice }}
              FHudBadge(v-if="allyCount > 0" tone="green") {{ allyCount }}

          BuildTray(
            :selected="selectedSlot"
            :offers="offers"
            :enhanced="offerEnhanced"
            :wood="wood"
            :stone="stone"
            :coins="runCoins"
            :reroll-ready="rerollReady"
            :reroll-seconds="rerollSeconds"
            @select="onSelectSlot"
            @reroll="onReroll"
          )

        //- Tech tree, themes, and the wave control.
        div.scene__right
          div.scene__right-buttons
            div.scene__tech-wrap
              span.scene__spotlight(v-if="showTechSpotlight") {{ t('tech.spotlight') }}
              FHudButton(
                tone="green"
                :attention="showTechSpotlight"
                :aria-label="t('tech.title')"
                @click="openTech"
              )
                svg(viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round")
                  circle(cx="12" cy="4" r="2")
                  circle(cx="5" cy="13" r="2")
                  circle(cx="19" cy="13" r="2")
                  circle(cx="12" cy="20" r="2")
                  path(d="M12 6 L5 11 M12 6 L19 11 M5 15 L12 18 M19 15 L12 18")
                template(#badge)
                  FHudBadge(v-if="progress.affordableCount.value > 0" tone="red") {{ progress.affordableCount.value }}

          CallWaveButton(
            :phase="phase"
            :time-left="buildTimeLeft"
            :bonus-pct="callBonusPct"
            :speed="gameSpeed"
            :boss-incoming="isBossIncoming"
            :speed-buff-left="speedBuffLeft"
            @call="onCallWave"
            @toggle-speed="toggleSpeed"
            @buy-speed="onBuySpeed"
          )

    //- ── Defeat screen ─────────────────────────────────────────────────────
    FReward(
      v-model="showResult"
      :show-continue="false"
    )
      template(#ribbon)
        span.scene__ribbon {{ t('result.towerFell') }}

      div.result
        div.result__headline
          span.result__wave {{ t('result.reachedWave', { n: summary.wave }) }}

        //- The record sits BESIDE the payout rather than on a line of its own.
        //- `rewardCoinRef` stays wrapped tightly around the coin so the payout
        //- explosion still originates on the coin and not on the whole row.
        div.result__payout
          span.result__record(v-if="summary.wave >= bestWave && summary.wave > 0") {{ t('result.newRecord') }}
          div.result__coins(ref="rewardCoinRef")
            IconCoin(class="result__coin-icon")
            span.result__coin-value +{{ summary.coins }}

        //- Score, and where it stands. One strip, two cells: they stay side by
        //- side at every width because both are short, and the rank cell simply
        //- drops out when there is no board to rank against.
        div.result__stats
          div.result__stat
            span.result__stat-label {{ t('result.bestLabel') }}
            span.result__stat-value {{ bestScoreValue.toLocaleString() }}
            //- This run, beside the record it did or did not beat. Hidden on a
            //- record run, where the two numbers are the same one.
            span.result__stat-note(v-if="!isRecordRun") {{ t('result.scoreCurrent', { n: summary.score.toLocaleString() }) }}
          div.result__stat(v-if="showRank")
            span.result__stat-label {{ t('result.rankLabel') }}
            span.result__stat-value {{ rankDisplay }}
            span.result__stat-note(v-if="playerTotal > 0") {{ t('result.rankOf', { n: playerTotal.toLocaleString() }) }}

        //- 2× rewarded video.
        FRewardButton(
          v-if="twoXAvailable"
          tone="gold"
          :label="firstRunBonusActive ? t('result.firstRunDouble') : t('result.double')"
          @click="onTwoX"
        )

        //- One grace continue per run. Offered ABOVE the restart CTAs so it
        //- reads as the alternative to ending the run rather than a variant of
        //- restarting it.
        FRewardButton(
          v-if="graceAvailable"
          tone="green"
          :label="t('result.continueRun')"
          @click="onContinueRun"
        )

        //- The two CTAs from reference image 2.
        div.result__actions
          FButton(size="md" :is-disabled="adInFlight" @click="onUpgrade") {{ t('result.upgrade') }}
          //- No movie badge: restarting is the way OUT of a finished run, and a
          //- player who cannot get past it because an ad will not fill is stuck
          //- on the defeat screen. `free` keeps the reward-button styling and
          //- disabled handling while dropping the video affordance.
          FRewardButton(
            tone="blue"
            free
            :label="t('result.defendAgain')"
            @click="onRebuild"
          )

    //- The opt-in offer, beside the tower. Never auto-starts.
    TutorialPrompt(
      v-if="showTutorialPrompt"
      :x="tutorialPromptPos.x"
      :y="tutorialPromptPos.y"
      :on-right="tutorialPromptPos.onRight"
      @start="startTutorial"
      @skip="finishTutorial"
    )

    //- First-stage coach marks. Outside `.scene__ui` so its dim layer covers
    //- the whole screen rather than sitting inside the HUD's stacking context.
    TutorialOverlay(
      :step="tutorialStep"
      :target="tutorialRect"
      @next="advanceTutorial"
      @skip="finishTutorial"
    )

    OptionsModal(:is-open="showOptions" @close="showOptions = false")
    TechTreeModal(v-model="showTech")
</template>

<style scoped lang="sass">
.scene
  position: relative
  width: 100vw
  height: 100vh
  height: 100dvh
  overflow: hidden
  background-color: #0a1224

.scene__canvas
  position: absolute
  inset: 0
  display: block
  // The canvas owns every gesture; the browser must not steal them for
  // scrolling, pull-to-refresh or double-tap zoom.
  touch-action: none

.scene__hud
  position: absolute
  inset: 0
  pointer-events: none
  display: flex
  flex-direction: column

// ─── Top bar ────────────────────────────────────────────────────────────────

.scene__top
  display: flex
  align-items: flex-start
  justify-content: space-between
  gap: clamp(0.25rem, 2vw, 0.75rem)
  padding: calc(clamp(0.3rem, 1.6vw, 0.6rem) + env(safe-area-inset-top, 0px)) calc(clamp(0.3rem, 1.6vw, 0.6rem) + env(safe-area-inset-right, 0px)) 0 calc(clamp(0.3rem, 1.6vw, 0.6rem) + env(safe-area-inset-left, 0px))

.scene__wallet
  display: flex
  flex-direction: column
  align-items: flex-end
  // The chest hangs a payout / countdown chip below itself, out of flow. The
  // gap has to clear that chip or the next thing in the column sits on top of
  // it — and the chest is nudged in from the right edge so the chip, which is
  // wider than the chest, is not clipped by the viewport.
  gap: clamp(0.6rem, 3vw, 1rem)
  padding-right: clamp(0.15rem, 1.2vw, 0.4rem)
  padding-bottom: clamp(0.9rem, 3.6vw, 1.2rem)
  pointer-events: auto

.scene__toast
  display: flex
  justify-content: center
  margin-top: clamp(0.3rem, 1.6vw, 0.6rem)

.scene__hint
  display: flex
  justify-content: center
  margin-top: clamp(0.3rem, 1.6vw, 0.6rem)
  padding-inline: 0.5rem

.scene__recenter
  position: absolute
  top: 50%
  right: calc(clamp(0.4rem, 2vw, 0.8rem) + env(safe-area-inset-right, 0px))
  translate: 0 -50%
  display: flex
  align-items: center
  justify-content: center
  width: 2.5rem
  height: 2.5rem
  min-width: 2.5rem
  min-height: 2.5rem
  padding: 0
  border: 2px solid rgba(255, 255, 255, 0.25)
  border-radius: 999px
  background-color: rgba(8, 14, 28, 0.72)
  color: #cfe4ff
  cursor: pointer
  pointer-events: auto
  -webkit-tap-highlight-color: transparent

  svg
    width: 55%
    height: 55%

  &:active
    scale: 0.92

// ─── Inspector ──────────────────────────────────────────────────────────────

.scene__inspector
  position: absolute
  left: calc(clamp(0.35rem, 2vw, 0.7rem) + env(safe-area-inset-left, 0px))
  // Sits above the bottom bar. The bar's height varies with content, so anchor
  // from a generous constant rather than chasing it every frame.
  bottom: calc(clamp(7.5rem, 24vh, 10rem) + env(safe-area-inset-bottom, 0px))
  pointer-events: auto

// ─── Bottom bar ─────────────────────────────────────────────────────────────

.scene__bottom
  margin-top: auto
  display: grid
  // meta | tray | wave control.
  //
  // `1fr auto 1fr` — NOT `auto 1fr auto`. With the tray in the flexible middle
  // column its centre followed the midpoint between the meta cluster and the
  // wave control, so whenever those two had different widths (which is most of
  // the time — the meta row grows and shrinks with claimable rewards) the hand
  // drifted off-centre and, at some sizes, ended up hard against the right edge
  // over the battlefield. Sizing the tray to its content and letting the two
  // side columns split whatever is left pins it to the middle of the SCREEN.
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)
  grid-template-areas: 'meta tray right'
  align-items: end
  gap: clamp(0.25rem, 1.6vw, 0.7rem)
  padding: 0 calc(clamp(0.35rem, 2vw, 0.7rem) + env(safe-area-inset-right, 0px)) calc(clamp(0.35rem, 2vw, 0.7rem) + env(safe-area-inset-bottom, 0px)) calc(clamp(0.35rem, 2vw, 0.7rem) + env(safe-area-inset-left, 0px))

.scene__meta
  grid-area: meta
  justify-self: start
  display: flex
  flex-wrap: wrap
  align-items: flex-end
  gap: clamp(0.15rem, 1vw, 0.35rem)
  max-width: 40vw
  pointer-events: auto

.scene__tray
  position: relative
  grid-area: tray
  display: flex
  flex-direction: column
  align-items: center
  justify-content: flex-end
  min-width: 0
  pointer-events: auto

// Floated ABOVE the tray rather than stacked on top of it. In flow these two
// controls added ~46 px to a bottom bar that already owns a third of a phone
// screen; out of flow they cost nothing and still sit right next to the hand
// they act on.
.scene__tray-perks
  position: absolute
  bottom: calc(100% + 0.25rem)
  left: 50%
  translate: -50% 0
  display: flex
  flex-wrap: wrap
  align-items: center
  justify-content: center
  gap: clamp(0.2rem, 1.2vw, 0.45rem)
  max-width: 100%

// ─── Cavalry ────────────────────────────────────────────────────────────────

.scene__cavalry
  position: relative
  display: inline-flex
  align-items: center
  gap: clamp(0.2rem, 1.2vw, 0.4rem)
  // Tap-target floor; the control must never shrink below a thumb.
  min-height: 2.25rem
  padding: clamp(0.2rem, 1.2vw, 0.4rem) clamp(0.4rem, 2.4vw, 0.8rem)
  border: 2px solid #0f1a30
  border-radius: clamp(0.5rem, 2.4vw, 0.9rem)
  background-image: linear-gradient(to bottom, #ff9d55, #e0632a)
  color: #fff
  cursor: pointer
  touch-action: manipulation
  -webkit-tap-highlight-color: transparent
  transition: transform 100ms ease-out, filter 100ms ease-out

  &:active
    transform: translateY(2px) scale(0.96)

  &.is-poor
    filter: grayscale(0.75) brightness(0.68)

.scene__cavalry-icon
  width: clamp(1.1rem, 4.4vw, 1.5rem)
  height: clamp(1.1rem, 4.4vw, 1.5rem)
  flex: 0 0 auto

.scene__cavalry-label
  font-weight: 900
  text-transform: uppercase
  font-size: clamp(0.6rem, 2.6vw, 0.85rem)
  line-height: 1
  text-shadow: 2px 2px 0 #000
  // Vanishes on the narrowest phones, where the icon plus price already says it.
  @media (max-width: 22rem)
    display: none

.scene__cavalry-cost
  display: inline-flex
  align-items: center
  gap: 0.15em
  font-weight: 900
  font-size: clamp(0.6rem, 2.6vw, 0.85rem)
  line-height: 1
  text-shadow: 2px 2px 0 #000

.scene__cavalry-coin
  width: 1em
  height: 1em

.scene__right
  grid-area: right
  justify-self: end
  display: flex
  flex-direction: column
  align-items: flex-end
  gap: clamp(0.25rem, 1.4vw, 0.5rem)
  pointer-events: auto

// On a phone the three columns leave the tray about 130–230 px. Four tap-sized
// tiles plus their chrome need ~250, so two of the four offers end up outside
// the scroll area — invisible, with nothing to suggest they are there. The hand
// is the core decision of the build phase and has to be visible in full, so
// below this width the tray takes a row of its own.
//
// The meta cluster keeps its full width in this layout ON PURPOSE: constrained
// to 29vw it wrapped to three rows and the bottom bar grew to 44% of a 659 px
// screen, which is worse than the problem it was solving. One wide row of small
// buttons is shorter than three narrow ones.
//
// Restricted to PORTRAIT because a landscape phone turns the tray into a
// vertical rail, where a full-width row would eat the short axis instead.
@media (max-width: 37rem) and (orientation: portrait)
  .scene__bottom
    grid-template-columns: minmax(0, 1fr) auto
    grid-template-areas: 'tray tray' 'meta right'
    justify-items: stretch
    row-gap: clamp(0.15rem, 1vw, 0.35rem)
    column-gap: clamp(0.15rem, 1vw, 0.4rem)

  .scene__meta
    max-width: none
    flex-wrap: nowrap
    // Tighter than the desktop gap: with five controls sharing this row on a
    // phone, the spacing between them is the cheapest width to give back.
    gap: clamp(0.1rem, 0.7vw, 0.25rem)
    // The cluster is the one thing here that may scroll: every button in it
    // opens a modal the player can also reach later, unlike the offers.
    overflow-x: auto
    overscroll-behavior-x: contain
    scrollbar-width: none

    &::-webkit-scrollbar
      display: none

.scene__right-buttons
  display: flex
  align-items: flex-end
  gap: clamp(0.15rem, 1vw, 0.35rem)

.scene__tech-wrap
  position: relative
  display: flex
  align-items: center

.scene__spotlight
  position: absolute
  right: 100%
  margin-right: 0.4rem
  padding: 0.15em 0.5em
  border: 2px solid #0f1a30
  border-radius: 0.5rem
  background-image: linear-gradient(to bottom, #ffcd00, #f7a000)
  color: #fff
  font-weight: 900
  text-transform: uppercase
  white-space: nowrap
  font-size: clamp(0.5rem, 2.2vw, 0.68rem)
  text-shadow: 2px 2px 0 #000
  animation: spotlight-pulse 1.2s ease-in-out infinite

@keyframes spotlight-pulse
  0%, 100%
    opacity: 1
  50%
    opacity: 0.6

// ─── Portrait phone ─────────────────────────────────────────────────────────
//
// The narrowest supported viewport is 320×658. There the three-column bottom
// bar cannot fit side by side, so it becomes two stacked rows: the tray takes a
// full-width row of its own (it is the primary control) and the buttons share
// the row beneath it.
@media (max-width: 30rem)
  .scene__bottom
    grid-template-columns: minmax(0, 1fr) auto
    grid-template-areas: "tray tray" "meta right"
    gap: clamp(0.25rem, 1.6vw, 0.5rem)

  .scene__tray
    grid-area: tray

  .scene__meta
    grid-area: meta
    max-width: none
    flex: 1

  .scene__right
    grid-area: right
    flex-direction: row
    align-items: center

  .scene__inspector
    bottom: calc(11rem + env(safe-area-inset-bottom, 0px))

// ─── Landscape phone ────────────────────────────────────────────────────────
//
// Vertical space is the scarce resource, but the hand STAYS in the bottom bar.
//
// It used to fly out to a right-hand rail here, on the theory that a vertical
// strip costs no height. Two things were wrong with that. The rail's media
// query is not gated on touch while the component's rail LAYOUT is (it keys off
// `isMobileLandscape`, which needs a mobile UA), so any short desktop or portal
// embed got the absolute positioning without the vertical stacking — a
// horizontal tray floating in the middle of the battlefield. And a control that
// changes corner depending on the viewport is one the player has to hunt for.
//
// It is compact here instead: the tile cap follows the short axis (see
// `BuildTray.tileSize`) so a full hand still costs a thin strip of height.
@media (orientation: landscape) and (max-height: 30rem)
  // Every millimetre of the short axis the bar gives back is battlefield.
  .scene__bottom
    padding-bottom: calc(0.2rem + env(safe-area-inset-bottom, 0px))
    gap: 0.2rem

  .scene__right
    flex-direction: row
    align-items: flex-end

  .scene__inspector
    bottom: calc(3.75rem + env(safe-area-inset-bottom, 0px))

  .scene__recenter
    top: auto
    bottom: calc(3.5rem + env(safe-area-inset-bottom, 0px))
    right: calc(5.5rem + env(safe-area-inset-right, 0px))
    translate: none

// ─── Result screen ──────────────────────────────────────────────────────────

.scene__ribbon
  color: #fff
  font-weight: 900
  font-style: italic
  text-transform: uppercase
  font-size: clamp(0.8rem, 3.6vw, 1.4rem)

.result
  display: flex
  flex-direction: column
  align-items: center
  gap: clamp(0.4rem, 2vw, 0.9rem)
  width: 100%
  max-width: 26rem

.result__headline
  display: flex
  flex-direction: column
  align-items: center
  gap: 0.15rem

.result__wave
  color: #fff
  font-weight: 900
  text-transform: uppercase
  text-align: center
  font-size: clamp(1rem, 5vw, 1.9rem)
  text-shadow: 3px 3px 0 #000

.result__payout
  // `1fr auto 1fr`, so the coin stays centred on the SCREEN and the record
  // hangs off its left rather than shoving it sideways. Same reasoning as the
  // bottom bar's tray column.
  display: grid
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)
  align-items: center
  gap: clamp(0.35rem, 2vw, 0.8rem)
  width: 100%

.result__record
  grid-column: 1
  justify-self: end
  text-align: right
  color: #ffd93c
  font-weight: 900
  text-transform: uppercase
  font-size: clamp(0.65rem, 3vw, 0.95rem)
  text-shadow: 2px 2px 0 #000
  animation: spotlight-pulse 1.1s ease-in-out infinite

.result__coins
  grid-column: 2
  display: flex
  align-items: center
  gap: 0.4rem

.result__coin-icon
  width: clamp(1.3rem, 6vw, 2rem)
  height: clamp(1.3rem, 6vw, 2rem)
  color: #ffd93c

.result__coin-value
  color: #ffd93c
  font-weight: 900
  font-size: clamp(1.2rem, 6vw, 2.2rem)
  text-shadow: 3px 3px 0 #000

// ── Score / rank strip ──
// Two cells on one row at every width. Both values are short (a score is three
// or four digits, a rank four or five), so stacking them would waste the one
// axis the defeat screen is actually short of — height, on a phone in
// landscape, where four CTAs already have to fit underneath.
.result__stats
  display: flex
  align-items: stretch
  justify-content: center
  gap: clamp(0.4rem, 2.5vw, 0.9rem)
  width: 100%
  padding: clamp(0.3rem, 1.6vw, 0.55rem) clamp(0.5rem, 3vw, 1rem)
  border-radius: 0.75rem
  background: rgba(8, 14, 28, 0.5)
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.08)

.result__stat
  display: flex
  flex-direction: column
  align-items: center
  justify-content: center
  gap: 0.05rem
  // Equal halves, so the divider sits dead centre whatever the numbers are.
  flex: 1 1 0
  min-width: 0

  & + &
    border-left: 2px solid rgba(255, 255, 255, 0.1)
    padding-left: clamp(0.4rem, 2.5vw, 0.9rem)

.result__stat-label
  color: rgba(214, 228, 255, 0.72)
  font-weight: 800
  text-transform: uppercase
  letter-spacing: 0.04em
  font-size: clamp(0.55rem, 2.6vw, 0.78rem)

.result__stat-value
  color: #fff
  font-weight: 900
  line-height: 1.05
  font-size: clamp(1rem, 4.6vw, 1.6rem)
  text-shadow: 2px 2px 0 #000
  // Tabular figures stop the rank jittering sideways when it updates from a
  // derived guess to the number the server returned.
  font-variant-numeric: tabular-nums
  white-space: nowrap

.result__stat-note
  color: rgba(214, 228, 255, 0.6)
  font-weight: 700
  font-size: clamp(0.5rem, 2.3vw, 0.7rem)
  white-space: nowrap
  overflow: hidden
  text-overflow: ellipsis
  max-width: 100%

.result__twox
  display: inline-flex
  align-items: center
  gap: 0.35em

.result__twox-icon
  width: 1.1em
  height: 1.1em

.result__actions
  display: flex
  flex-wrap: wrap
  align-items: center
  justify-content: center
  gap: clamp(0.35rem, 2vw, 0.75rem)
  width: 100%

// Mobile landscape has ~390px of height to hold a headline, the payout and
// four CTAs. Every size above is driven by `vw` — the LONG axis here — so the
// defaults open up widest exactly where there is least room, and the bottom
// row of buttons falls past the edge. Drive the same values off the short axis.
@media (orientation: landscape) and (max-height: 500px)
  .result
    // 0.3rem left the dialog ~9px taller than a 764x385 Chromebook embed, which
    // is not a cut-off button but IS a scrollbar over the defeat screen. The
    // gap is the cheapest place to find it: the alternative was dropping the
    // "(137 this run)" note, which is the half of the strip that tells the
    // player why to press Defend Again.
    gap: 0.08rem

  .result__wave
    font-size: clamp(0.95rem, 4vh, 1.3rem)

  .result__coin-icon
    width: 1.5rem
    height: 1.5rem

  .result__coin-value
    font-size: 1.5rem

  // Same reasoning as everything above it: drive the strip off the SHORT axis
  // in landscape, or it opens up widest exactly where there is least room.
  .result__stats
    padding: 0.14rem 0.6rem
    border-radius: 0.55rem

  .result__stat-label
    font-size: 0.6rem

  .result__stat-value
    font-size: clamp(0.9rem, 3.4vh, 1.2rem)

  .result__stat-note
    font-size: 0.55rem

// Tablets and anything wider: the dialog stops being width-constrained, so the
// strip can breathe instead of staying phone-tight inside a 26rem column.
@media (min-width: 48rem) and (orientation: portrait)
  .result
    max-width: 30rem

  .result__stats
    padding: 0.6rem 1.2rem

  .result__stat-value
    font-size: 1.7rem

.fade-enter-active, .fade-leave-active
  transition: opacity 220ms ease
.fade-enter-from, .fade-leave-to
  opacity: 0
</style>
