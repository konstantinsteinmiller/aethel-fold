import { ref } from 'vue'
import { prependBaseUrl } from '@/utils/function'

// 3d-world draws all gameplay art programmatically (Canvas 2D) and uses
// inline SVG for HUD icons, so the preloader only has to decode two pieces of
// UI chrome. SFX decode on first play (see `useSound.ts`) and are warmed on an
// idle slot after first paint; the splash exits as soon as the bundle parses.

const loadingProgress = ref(100)
const areAllAssetsLoaded = ref(true)

export const resourceCache = {
  images: new Map<string, HTMLImageElement>(),
  audio: new Map<string, HTMLAudioElement>(),
  audioBuffers: new Map<string, AudioBuffer>()
}

let sharedAudioCtx: AudioContext | null = null
let resumeListenerArmed = false
/** Counts every active reason the audio layer should be globally
 *  silent. The single driver is now `useGamePauseAudio`, which holds one
 *  slot for the whole `isGamePaused` gate (ad mid-show, tab hidden,
 *  platform SDK pause, app modal). Each `suspendAllAudio()` increments,
 *  each `resumeAllAudio()` decrements; the AudioContext only resumes when
 *  the counter hits 0 — so an overlapping suspend (e.g. modal opened
 *  during an ad) can never re-unmute early. */
let suspendDepth = 0

export const getAudioContext = (): AudioContext | null => {
  if (sharedAudioCtx) return sharedAudioCtx
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext
  if (!Ctor) return null
  try {
    sharedAudioCtx = new Ctor() as AudioContext
  } catch {
    return null
  }
  armResumeOnGesture()
  return sharedAudioCtx
}

/** True while engine audio is globally suspended (an ad is on-screen, the
 *  tab is hidden, etc.). SFX entry points (`useSound`) read this to refuse
 *  starting a new one-shot during an ad — so nothing leaks past the mute. */
export const isAudioSuspended = (): boolean => suspendDepth > 0

const armResumeOnGesture = (): void => {
  if (resumeListenerArmed) return
  resumeListenerArmed = true
  const resume = () => {
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended' && suspendDepth === 0) {
      void sharedAudioCtx.resume()
    }
  }
  window.addEventListener('pointerdown', resume, { once: true })
  window.addEventListener('keydown', resume, { once: true })
}

/** Bookkeeping for HTMLAudio elements (music, fallback SFX path) so
 *  the suspend/resume helpers can pause + restart them alongside the
 *  Web Audio context. Loops register on creation in useSound. */
const trackedAudioElements = new Set<HTMLAudioElement>()
const pausedByGlobalSuspend = new WeakSet<HTMLAudioElement>()

export const registerHtmlAudio = (el: HTMLAudioElement) => {
  trackedAudioElements.add(el)
}
export const unregisterHtmlAudio = (el: HTMLAudioElement) => {
  trackedAudioElements.delete(el)
  pausedByGlobalSuspend.delete(el)
}

/** Suspend all engine audio — Web Audio context goes to `suspended`
 *  and any registered HTMLAudio element is paused (and remembered so a
 *  later resume can restart only the ones we actually paused). Stacks:
 *  multiple `suspendAllAudio()` calls require matching `resume` calls
 *  before audio plays again. */
export const suspendAllAudio = (): void => {
  suspendDepth += 1
  if (sharedAudioCtx && sharedAudioCtx.state === 'running') {
    void sharedAudioCtx.suspend()
  }
  for (const el of trackedAudioElements) {
    if (!el.paused) {
      pausedByGlobalSuspend.add(el)
      try { el.pause() } catch { /* ignore */ }
    }
  }
}

export const resumeAllAudio = (): void => {
  suspendDepth = Math.max(0, suspendDepth - 1)
  if (suspendDepth > 0) return
  if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
    void sharedAudioCtx.resume()
  }
  for (const el of trackedAudioElements) {
    if (pausedByGlobalSuspend.has(el)) {
      pausedByGlobalSuspend.delete(el)
      void el.play().catch(() => { /* autoplay blocked / element gone */ })
    }
  }
}

// ─── Active one-shot SFX registry ─────────────────────────────────────────
// Transient one-shot SFX (the Web Audio fast path in `useSound`) play on the
// shared AudioContext and aren't HTMLAudio elements, so the suspend gate only
// FREEZES them via `ctx.suspend()`. On an early gate-drop they'd resume and
// tail audibly under an ad. We track them so an ad can hard-STOP them outright.
const activeOneShotSources = new Set<AudioBufferSourceNode>()

/** Register a one-shot Web Audio source so `killOneShotSfx()` can stop it.
 *  Auto-removes itself when the source finishes. */
export const registerOneShotSource = (source: AudioBufferSourceNode): void => {
  activeOneShotSources.add(source)
  source.addEventListener('ended', () => activeOneShotSources.delete(source), { once: true })
}

/**
 * Hard-stop EVERY in-flight one-shot SFX so nothing tails into an ad — called
 * right before an interstitial / rewarded ad is requested. Covers:
 *   • Web Audio one-shots  (stopped outright), and
 *   • non-looping tracked HTMLAudio (the decode-fallback one-shots) — paused
 *     AND dropped from the auto-resume set so the gate's resume can't restart
 *     them under or after the ad.
 * Intentionally leaves the bg music (HTMLAudio with `loop=true` → owned by
 * `forceStopMusic`) and the gameplay Web Audio LOOP (owned by the scene's
 * pause watcher) alone, so each is restored by its proper lifecycle.
 */
export const killOneShotSfx = (): void => {
  for (const s of [...activeOneShotSources]) {
    try { s.stop() } catch { /* already ended */ }
    activeOneShotSources.delete(s)
  }
  for (const el of trackedAudioElements) {
    if (el.loop) continue // bg music — forceStopMusic owns its stop/restart
    pausedByGlobalSuspend.delete(el)
    if (!el.paused) { try { el.pause() } catch { /* ignore */ } }
  }
}

// Visibility-driven suspend used to live here (`armVisibilitySuspend`). It
// moved into the unified pause gate: `useGamePause` owns the
// `visibilitychange` listener (flipping `isVisibilityHidden`) and
// `useGamePauseAudio` suspends/resumes audio off that gate for ALL builds —
// so there is one suspend driver instead of two overlapping ones.

// ⚠️ TEMP TEST HARNESS (remove before commit) — exposes the live audio state
// so the Chrome MCP can assert "no sound during the fake interstitial". Reads
// the module-private AudioContext + tracked-element registry that aren't
// otherwise observable from the page. Paired with `window.__testInterstitial`
// / `window.__audioDebug` in `useAds.ts`.
export const __audioDebugSnapshot = () => ({
  audioCtxState: sharedAudioCtx ? sharedAudioCtx.state : 'none',
  suspendDepth,
  trackedAudioCount: trackedAudioElements.size,
  trackedAudioPaused: [...trackedAudioElements].map((e) => e.paused),
  anyTrackedAudioPlaying: [...trackedAudioElements].some((e) => !e.paused),
  activeOneShotSfx: activeOneShotSources.size
})

export const getCachedImage = (src: string): HTMLImageElement => {
  // Route every bitmap src through `prependBaseUrl` so the URL matches
  // the build's base. Critical for wavedash (and any other build that
  // ships with `--base=./`) where the CDN serves the bundle under a
  // hashed path prefix — bare `/images/foo.webp` 404s against the CDN
  // root, but `<base>/images/foo.webp` hits the build folder. Cache
  // keys off the prefixed URL so multiple callers (one passing the
  // leading slash, another not) still hit the same entry after the
  // helper's normalisation.
  const prefixed = prependBaseUrl(src)
  const existing = resourceCache.images.get(prefixed)
  if (existing) return existing
  const img = new Image()
  img.src = prefixed
  resourceCache.images.set(prefixed, img)
  return img
}

const pendingDecodes = new Map<string, Promise<AudioBuffer | null>>()

export const loadAudioBuffer = async (src: string): Promise<AudioBuffer | null> => {
  const cached = resourceCache.audioBuffers.get(src)
  if (cached) return cached
  const existing = pendingDecodes.get(src)
  if (existing) return existing

  const ctx = getAudioContext()
  if (!ctx) return null

  const promise = (async () => {
    try {
      const res = await fetch(src)
      if (!res.ok) return null
      const arrayBuffer = await res.arrayBuffer()
      const buffer = await ctx.decodeAudioData(arrayBuffer)
      resourceCache.audioBuffers.set(src, buffer)
      return buffer
    } catch (e) {
      console.warn(`[assets] decodeAudioData failed for ${src}`, e)
      return null
    } finally {
      pendingDecodes.delete(src)
    }
  })()
  pendingDecodes.set(src, promise)
  return promise
}

// ─── Critical image preload ────────────────────────────────────────────
// The only bitmaps on the critical path are UI chrome. Gameplay art is
// procedural, so there is nothing else to block first paint on.
const CRITICAL_IMAGE_SRCS: ReadonlyArray<string> = [
  // Splash logo — decoded before the splash mounts so FLogoProgress never
  // paints a blank box on the first frame.
  '/images/logo/logo_256x256.webp',
  // Result-screen ribbon. Small, and needed the moment a siege ends.
  '/images/bg/parchment-ribbon_553x188.webp'
]

/** Block until `img.complete && naturalWidth > 0` (success) or `error`
 *  fires (failure). Cached images that already decoded resolve
 *  synchronously on the next microtask. */
const decodeImage = (src: string): Promise<void> => {
  const img = getCachedImage(src)
  if (img.complete && img.naturalWidth > 0) return Promise.resolve()
  return new Promise<void>(resolve => {
    const done = () => {
      img.removeEventListener('load', done)
      img.removeEventListener('error', done)
      resolve()
    }
    img.addEventListener('load', done, { once: true })
    img.addEventListener('error', done, { once: true })
  })
}

// ─── Off-hot-path background warm-up ───────────────────────────────────────
// Runs ONCE, after the splash has hidden (hot path done + first paint).
//
// 3d-world draws every block, enemy and background layer procedurally, so
// there is no gameplay art to decode here — the only deferred work is the SFX
// buffer decode. Doing it on an idle slot means the first explosion of a
// session doesn't pay a decode cost mid-frame, without delaying first paint.
let backgroundWarmStarted = false

const runBackgroundWarmup = (): void => {
  if (backgroundWarmStarted) return
  backgroundWarmStarted = true
  void (async () => {
    try {
      const sp = await import('@/use/useSoundPreload')
      await sp.preloadGameplaySounds()
    } catch { /* non-critical — sounds still decode on first play */ }
  })()
}

export default () => {
  const preloadAssets = async (): Promise<void> => {
    // ── HOT PATH ──
    // 3d-world has NO gameplay bitmaps: blocks, enemies, projectiles and the
    // whole background are drawn from code. The only critical images are the
    // splash logo and the result-screen ribbon, and the renderer chunk itself.
    //
    // So the "loading" phase is effectively just the JS parse, which is exactly
    // the fast-start behaviour portals grade on. Everything else (SFX decode,
    // drop-in art probing) defers to `runBackgroundWarmup()` after first paint.
    loadingProgress.value = 0
    areAllAssetsLoaded.value = false

    const tasks = CRITICAL_IMAGE_SRCS.map(decodeImage)
    let done = 0
    for (const task of tasks) {
      task.then(() => {
        done += 1
        loadingProgress.value = Math.round((done / tasks.length) * 100)
      })
    }
    // `allSettled` swallows individual failures so a 404 on one bitmap can
    // never strand the splash screen.
    await Promise.allSettled(tasks)
    loadingProgress.value = 100
    areAllAssetsLoaded.value = true
    scheduleBackgroundWarmup()
  }

  return {
    loadingProgress,
    areAllAssetsLoaded,
    preloadAssets,
    resourceCache
  }
}

/** Schedule the off-hot-path warm-up on the first idle slot (rIC), falling back
 *  to a short timeout. Runs after the current frame so first paint isn't hit. */
const scheduleBackgroundWarmup = (): void => {
  if (typeof window === 'undefined') { runBackgroundWarmup(); return }
  const ric = (window as any).requestIdleCallback as
    | ((cb: () => void, opts?: { timeout: number }) => number)
    | undefined
  if (typeof ric === 'function') ric(() => runBackgroundWarmup(), { timeout: 3000 })
  else setTimeout(runBackgroundWarmup, 0)
}
