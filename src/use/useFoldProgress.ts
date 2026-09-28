import { ref, watch, type Ref } from 'vue'
import {
  BEST_KEY, CLEARED_KEY, LESSONS_KEY, PAGE_KEY, RUN_KEY, RUNS_KEY, SETTINGS_KEY, STATS_KEY, WINS_KEY
} from '@/keys'
import { aethelState, getState, setState, setStates } from '@/use/useAethelState'
import { saveDataVersion, flushSaveNow } from '@/use/useSaveStatus'
import type { LessonId, PageId } from '@/fold/logic/types'
import { emptyStats, type GameStats } from '@/fold/logic/game'

/**
 * Castle Fold progress — a module-level singleton view over the fields of
 * `aethel_state` that belong to the game (see `src/keys.ts`).
 *
 * Every ref here is re-read whenever the blob is replaced (`aethelState`
 * identity change) and whenever a cloud hydrate lands (`saveDataVersion`), so
 * a player whose SDK save arrives late is never left playing as a fresh user.
 */

export type Quality = 'auto' | 'high' | 'low'

export interface FoldSettings {
  haptics: boolean
  shake: boolean
  quality: Quality
}

export interface RunCheckpoint {
  score: number
  hits: number
  time: number
}

export interface Records {
  score: number
  /** Fastest full run in seconds (0 = never won). */
  time: number
}

const DEFAULT_SETTINGS: FoldSettings = { haptics: true, shake: true, quality: 'auto' }

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : fallback
}

const asPage = (v: unknown): PageId => {
  const n = Math.round(num(v, 1))
  return (n >= 1 && n <= 6 ? n : 1) as PageId
}

const obj = <T extends object>(v: unknown, fallback: T): T =>
  v && typeof v === 'object' && !Array.isArray(v) ? { ...fallback, ...(v as Partial<T>) } : { ...fallback }

const readSettings = (): FoldSettings => {
  const s = obj<FoldSettings>(getState(SETTINGS_KEY), DEFAULT_SETTINGS)
  if (s.quality !== 'auto' && s.quality !== 'high' && s.quality !== 'low') s.quality = 'auto'
  s.haptics = s.haptics !== false
  s.shake = s.shake !== false
  return s
}

const readCheckpoint = (): RunCheckpoint | null => {
  const v = getState<unknown>(RUN_KEY)
  if (!v || typeof v !== 'object') return null
  const r = v as Partial<RunCheckpoint>
  return { score: Math.max(0, num(r.score)), hits: Math.max(0, num(r.hits)), time: Math.max(0, num(r.time)) }
}

export const resumePage: Ref<PageId> = ref(asPage(getState(PAGE_KEY)))
export const pagesCleared: Ref<number> = ref(Math.max(0, Math.min(6, num(getState(CLEARED_KEY)))))
export const records: Ref<Records> = ref(obj<Records>(getState(BEST_KEY), { score: 0, time: 0 }))
export const wins: Ref<number> = ref(num(getState(WINS_KEY)))
export const runs: Ref<number> = ref(num(getState(RUNS_KEY)))
export const lessons: Ref<Partial<Record<LessonId, boolean>>> = ref(obj(getState(LESSONS_KEY), {}))
export const lifetime: Ref<GameStats> = ref(obj<GameStats>(getState(STATS_KEY), emptyStats()))
export const foldSettings: Ref<FoldSettings> = ref(readSettings())
export const runCheckpoint: Ref<RunCheckpoint | null> = ref(readCheckpoint())
/** Bumped when a cloud hydrate replaced the progress under a running game. */
export const progressRevision = ref(0)

const refresh = (): void => {
  resumePage.value = asPage(getState(PAGE_KEY))
  pagesCleared.value = Math.max(0, Math.min(6, num(getState(CLEARED_KEY))))
  records.value = obj<Records>(getState(BEST_KEY), { score: 0, time: 0 })
  wins.value = num(getState(WINS_KEY))
  runs.value = num(getState(RUNS_KEY))
  lessons.value = obj(getState(LESSONS_KEY), {})
  lifetime.value = obj<GameStats>(getState(STATS_KEY), emptyStats())
  foldSettings.value = readSettings()
  runCheckpoint.value = readCheckpoint()
}

watch(aethelState, refresh, { deep: false })
watch(saveDataVersion, () => {
  refresh()
  progressRevision.value++
})

/** Is there anything worth resuming (a run past page 1)? */
export const hasProgress = (): boolean => resumePage.value > 1 || pagesCleared.value > 0 || wins.value > 0

// ─── Writers ───────────────────────────────────────────────────────────────

/** A new run starts on page 1. */
export const startNewRun = (): void => {
  setStates({
    [PAGE_KEY]: 1,
    [RUN_KEY]: { score: 0, hits: 0, time: 0 },
    [RUNS_KEY]: runs.value + 1
  })
}

/**
 * Checkpoint at the start of a page: a reload resumes here with this score.
 * `cleared` is the highest page finished so far.
 */
export const checkpoint = (page: PageId, run: RunCheckpoint, cleared: number): void => {
  setStates({
    [PAGE_KEY]: page,
    [RUN_KEY]: { score: Math.round(run.score), hits: run.hits, time: Math.round(run.time * 10) / 10 },
    [CLEARED_KEY]: Math.max(pagesCleared.value, Math.min(6, cleared))
  })
}

export const learnLesson = (id: LessonId): void => {
  if (lessons.value[id]) return
  setState(LESSONS_KEY, { ...lessons.value, [id]: true })
}

export const addStats = (delta: Partial<GameStats>): void => {
  const next = { ...lifetime.value }
  let changed = false
  for (const [k, v] of Object.entries(delta)) {
    if (typeof v !== 'number' || v === 0) continue
    const key = k as keyof GameStats
    next[key] = (next[key] ?? 0) + v
    changed = true
  }
  if (changed) setState(STATS_KEY, next)
}

/** The run is won: bank records and reset the resume point to a fresh book. */
export const recordVictory = (score: number, time: number): { newBest: boolean; newFastest: boolean } => {
  const r = records.value
  const newBest = score > r.score
  const newFastest = time > 0 && (r.time === 0 || time < r.time)
  setStates({
    [BEST_KEY]: { score: Math.max(r.score, Math.round(score)), time: newFastest ? Math.round(time * 10) / 10 : r.time },
    [WINS_KEY]: wins.value + 1,
    [CLEARED_KEY]: 6,
    [PAGE_KEY]: 1,
    [RUN_KEY]: { score: 0, hits: 0, time: 0 }
  })
  void flushSaveNow()
  return { newBest, newFastest }
}

/** Keep the best score even for runs that never finish. */
export const bankScore = (score: number): void => {
  if (score <= records.value.score) return
  setState(BEST_KEY, { ...records.value, score: Math.round(score) })
}

export const setFoldSetting = <K extends keyof FoldSettings>(key: K, value: FoldSettings[K]): void => {
  setState(SETTINGS_KEY, { ...foldSettings.value, [key]: value })
}

export { flushSaveNow }
