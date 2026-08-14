import { ref, computed, watch, type Ref } from 'vue'
import useTowerEconomy from '@/use/useTowerEconomy'
import { saveDataVersion, flushSaveNow } from '@/use/useSaveStatus'
import { getState, setState } from '@/use/useTowerState'
import { BATTLE_PASS_KEY } from '@/keys'

/**
 * Lightweight battle pass for 3d-world. 30 tiers, 100 xp per tier.
 *   - clear a wave  → +12 xp
 *   - finish a run  → +25 xp
 * Each level grants a coin payout on a linear ramp 30 → 600 across the
 * 30 stages. Unclaimed levels stay unclaimed until the player taps them
 * in the modal — they don't expire just because the next level unlocks.
 * State persists inside the consolidated `tower_state` blob.
 */

export const BP_TOTAL_STAGES = 30
export const BP_XP_PER_STAGE = 100
export const BP_SEASON_DAYS = 30

/** XP for clearing one wave — the steady drip that makes a long siege pay. */
export const BP_XP_WAVE_CLEARED = 12
/** XP for finishing a run, win or lose — the participation floor so a bad
 *  siege still moves the bar. */
export const BP_XP_RUN_FINISHED = 25

const STORAGE_KEY = BATTLE_PASS_KEY

interface BattlePassState {
  xp: number
  unlockedStages: number
  claimedStages: number[]
  seasonStartedAt: string | null
}

const defaultState = (): BattlePassState => ({
  xp: 0,
  unlockedStages: 0,
  claimedStages: [],
  seasonStartedAt: null
})

const daysUntilSeasonReset = (startedAt: string | null): number | null => {
  if (!startedAt) return null
  const start = new Date(startedAt).getTime()
  const now = Date.now()
  const elapsed = Math.floor((now - start) / (1000 * 60 * 60 * 24))
  return Math.max(0, BP_SEASON_DAYS - elapsed)
}

const isSeasonExpired = (startedAt: string | null): boolean => {
  if (!startedAt) return false
  return daysUntilSeasonReset(startedAt) === 0
}

const loadState = (): BattlePassState => {
  const parsed = getState<Partial<BattlePassState> | null>(STORAGE_KEY, null)
  if (
    parsed
    && typeof parsed.xp === 'number'
    && typeof parsed.unlockedStages === 'number'
    && Array.isArray(parsed.claimedStages)
  ) {
    const loaded: BattlePassState = {
      xp: parsed.xp,
      unlockedStages: Math.max(0, Math.min(BP_TOTAL_STAGES, parsed.unlockedStages)),
      claimedStages: parsed.claimedStages.filter(
        (n): n is number => typeof n === 'number' && n >= 1 && n <= BP_TOTAL_STAGES
      ),
      seasonStartedAt: parsed.seasonStartedAt ?? null
    }
    if (isSeasonExpired(loaded.seasonStartedAt)) return defaultState()
    return loaded
  }
  return defaultState()
}

const state: Ref<BattlePassState> = ref(loadState())

watch(saveDataVersion, () => {
  state.value = loadState()
})

const saveState = () => {
  setState(STORAGE_KEY, state.value)
}

export const bpCoinReward = (stage: number): number => {
  // Coins are scarce in the new economy (~40 on a good early run), so a
  // battle-pass level pays a gentle ramp (10 → 120 across 30 levels) instead of
  // the old 30 → 600 that would dwarf in-run earnings.
  const clamped = Math.max(1, Math.min(BP_TOTAL_STAGES, stage))
  const raw = 10 + ((clamped - 1) * 110) / (BP_TOTAL_STAGES - 1)
  return Math.round(raw / 5) * 5
}

const { addCoins } = useTowerEconomy()

const addXp = (amount: number) => {
  if (amount <= 0) return
  if (isSeasonExpired(state.value.seasonStartedAt)) {
    state.value = defaultState()
    saveState()
  }
  if (state.value.unlockedStages >= BP_TOTAL_STAGES) return
  if (!state.value.seasonStartedAt) {
    state.value.seasonStartedAt = new Date().toISOString().slice(0, 10)
  }
  state.value.xp += amount
  while (
    state.value.xp >= BP_XP_PER_STAGE
    && state.value.unlockedStages < BP_TOTAL_STAGES
    ) {
    state.value.xp -= BP_XP_PER_STAGE
    state.value.unlockedStages += 1
  }
  if (state.value.unlockedStages >= BP_TOTAL_STAGES) state.value.xp = 0
  saveState()
}

const awardWaveCleared = () => addXp(BP_XP_WAVE_CLEARED)
const awardRunFinished = () => addXp(BP_XP_RUN_FINISHED)
/** Grant an arbitrary XP amount (e.g. a daily-mission claim). Guards NaN. */
const awardXp = (amount: number) => addXp(Number(amount) || 0)

export interface ClaimResult {
  stage: number
  coins: number
}

const claimStage = (stage: number): ClaimResult | null => {
  if (stage < 1 || stage > BP_TOTAL_STAGES) return null
  if (stage > state.value.unlockedStages) return null
  if (state.value.claimedStages.includes(stage)) return null
  const coins = bpCoinReward(stage)
  addCoins(coins)
  state.value.claimedStages = [...state.value.claimedStages, stage]
  saveState()
  // Discrete reward claim — flush immediately so the claim (and its coins)
  // survive an instant reload instead of riding the coin throttle.
  void flushSaveNow()
  return { stage, coins }
}

const currentXp = computed(() => state.value.xp)
const unlockedStages = computed(() => state.value.unlockedStages)
const claimedStages = computed(() => state.value.claimedStages)
const isMaxed = computed(() => state.value.unlockedStages >= BP_TOTAL_STAGES)

const pendingClaimCount = computed(() => {
  let n = 0
  for (let i = 1; i <= state.value.unlockedStages; i++) {
    if (!state.value.claimedStages.includes(i)) n++
  }
  return n
})

const hasUnclaimedReward = computed(() => pendingClaimCount.value > 0)

const daysUntilReset = computed(() => daysUntilSeasonReset(state.value.seasonStartedAt))

const isStageClaimed = (stage: number): boolean => state.value.claimedStages.includes(stage)
const isStageUnlocked = (stage: number): boolean => stage <= state.value.unlockedStages

export default function useBattlePass() {
  return {
    state,
    currentXp,
    unlockedStages,
    claimedStages,
    isMaxed,
    hasUnclaimedReward,
    pendingClaimCount,
    daysUntilReset,
    isStageClaimed,
    isStageUnlocked,
    bpCoinReward,
    awardWaveCleared,
    awardRunFinished,
    awardXp,
    claimStage
  }
}
