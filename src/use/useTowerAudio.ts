import { getAudioContext, isAudioSuspended } from '@/use/useAssets'
import { isMobileAudioMuted } from '@/use/useMobileAudioMute'
import useUser from '@/use/useUser'
import useSounds from '@/use/useSound'

/**
 * ─── aethel-fold audio ──────────────────────────────────────────────────────
 *
 * Two sources, one entry point (`playFx`):
 *
 *   SAMPLES   — for the cues where a recorded sound is unmistakably better
 *               (coin pickup, wave-clear fanfare, defeat sting). These route
 *               through the shared `useSound` fast path.
 *   SYNTHESIS — for the combat layer. A tower with a dozen turrets fires
 *               several times a second; sample playback of the same file over
 *               and over sounds like a machine gun, and shipping a dozen
 *               variants of every shot would bloat the download. Instead the
 *               shots, impacts, zaps and explosions are SYNTHESISED per event
 *               with randomised pitch, envelope and filter — so no two are
 *               identical, and the whole combat mix costs zero bytes.
 *
 * Everything runs on the SHARED AudioContext from `useAssets`, which the ad /
 * pause gate suspends. That means the "no game audio during an ad" guarantee
 * covers synthesised sound for free — a suspended context produces silence.
 */

export type FxSound =
  | 'place' | 'sell' | 'shoot' | 'impact' | 'frost' | 'zap' | 'explosion'
  | 'shatter' | 'collapse' | 'hit' | 'throw' | 'enemyDie' | 'bossDie'
  | 'waveStart' | 'bossHorn' | 'waveClear' | 'gateFell'

// ─── Throttling ─────────────────────────────────────────────────────────────
//
// A wave can produce hundreds of events per second. Without a per-cue budget
// the mix turns to mud and the main thread spends real time building oscillator
// graphs. Each cue gets a minimum interval AND a per-window voice cap.

interface Throttle { minGapMs: number; maxPerWindow: number; windowMs: number }

const THROTTLES: Partial<Record<FxSound, Throttle>> = {
  shoot: { minGapMs: 45, maxPerWindow: 7, windowMs: 250 },
  impact: { minGapMs: 40, maxPerWindow: 6, windowMs: 250 },
  hit: { minGapMs: 70, maxPerWindow: 5, windowMs: 300 },
  throw: { minGapMs: 90, maxPerWindow: 4, windowMs: 350 },
  enemyDie: { minGapMs: 60, maxPerWindow: 6, windowMs: 300 },
  shatter: { minGapMs: 55, maxPerWindow: 5, windowMs: 300 },
  explosion: { minGapMs: 70, maxPerWindow: 4, windowMs: 350 },
  frost: { minGapMs: 80, maxPerWindow: 4, windowMs: 300 },
  zap: { minGapMs: 70, maxPerWindow: 4, windowMs: 300 }
}

const lastAt: Partial<Record<FxSound, number>> = {}
const windowHits: Partial<Record<FxSound, number[]>> = {}

const passesThrottle = (id: FxSound): boolean => {
  const t = THROTTLES[id]
  if (!t) return true
  const now = performance.now()
  if (now - (lastAt[id] ?? -Infinity) < t.minGapMs) return false
  const hits = (windowHits[id] ??= [])
  // Drop samples that fell out of the window, then check the cap.
  while (hits.length > 0 && now - hits[0]! > t.windowMs) hits.shift()
  if (hits.length >= t.maxPerWindow) return false
  hits.push(now)
  lastAt[id] = now
  return true
}

// ─── Volume ─────────────────────────────────────────────────────────────────

const { userSoundVolume } = useUser()

/** Master gain for a synthesised voice, folding in the player's SFX slider. */
const vol = (base: number): number =>
  Math.max(0, Math.min(1, base * (userSoundVolume.value ?? 0.7)))

const canPlay = (): boolean => !isAudioSuspended() && !isMobileAudioMuted.value

// ─── Synthesis primitives ───────────────────────────────────────────────────

/** Shared, lazily-built white-noise buffer. Rebuilding noise per shot would be
 *  a needless 0.5 s of Math.random() per second at combat density. */
let noiseBuffer: AudioBuffer | null = null
const getNoise = (ctx: AudioContext): AudioBuffer => {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer
  const len = Math.floor(ctx.sampleRate * 1.2)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  noiseBuffer = buf
  return buf
}

interface NoiseOpts {
  duration: number
  gain: number
  /** Filter sweep, Hz. */
  filterFrom: number
  filterTo: number
  type?: BiquadFilterType
  q?: number
  /** Exponent for the amplitude decay: 1 = linear-ish, 4 = very snappy. */
  decay?: number
}

/** A filtered noise burst — the backbone of impacts, explosions and debris. */
const noiseBurst = (ctx: AudioContext, o: NoiseOpts): void => {
  const src = ctx.createBufferSource()
  src.buffer = getNoise(ctx)
  src.playbackRate.value = 0.85 + Math.random() * 0.3

  const filter = ctx.createBiquadFilter()
  filter.type = o.type ?? 'lowpass'
  filter.Q.value = o.q ?? 1
  const now = ctx.currentTime
  filter.frequency.setValueAtTime(o.filterFrom, now)
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.filterTo), now + o.duration)

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(o.gain, now)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + o.duration)

  src.connect(filter).connect(gain).connect(ctx.destination)
  src.start(now)
  src.stop(now + o.duration + 0.02)
}

interface ToneOpts {
  freq: number
  toFreq?: number
  duration: number
  gain: number
  type?: OscillatorType
  delay?: number
  /** Optional lowpass to take the edge off a raw saw/square. */
  filter?: number
}

/** A single pitched voice with an exponential envelope. */
const tone = (ctx: AudioContext, o: ToneOpts): void => {
  const now = ctx.currentTime + (o.delay ?? 0)
  const osc = ctx.createOscillator()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.freq, now)
  if (o.toFreq && o.toFreq !== o.freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.toFreq), now + o.duration)
  }

  const gain = ctx.createGain()
  // 4 ms attack avoids the click a hard start would produce.
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), now + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + o.duration)

  let node: AudioNode = osc
  if (o.filter) {
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = o.filter
    osc.connect(f)
    node = f
  }
  node.connect(gain).connect(ctx.destination)
  osc.start(now)
  osc.stop(now + o.duration + 0.02)
}

// ─── Cue definitions ────────────────────────────────────────────────────────

const { playSound } = useSounds()

/** Cues that map cleanly onto a shipped sample: `[file, volumeRatio]`. */
const SAMPLE_CUES: Partial<Record<FxSound, [string, number]>> = {
  waveClear: ['celebration-1', 0.09],
  gateFell: ['lose', 0.11],
  sell: ['coin-pickup', 0.05],
  bossDie: ['celebration-3', 0.1]
}

/** Synthesise one cue. Every voice randomises pitch/length slightly so a
 *  sustained barrage never sounds looped. */
const synth = (ctx: AudioContext, id: FxSound): void => {
  const r = Math.random()

  switch (id) {
    case 'place':
      // Woody knock: a short low thud plus a click transient.
      tone(ctx, { freq: 190 + r * 40, toFreq: 90, duration: 0.11, gain: vol(0.16), type: 'triangle' })
      noiseBurst(ctx, { duration: 0.055, gain: vol(0.09), filterFrom: 2600, filterTo: 500 })
      break

    case 'shoot':
      // Snappy launch: a fast downward chirp with an airy noise tail.
      tone(ctx, { freq: 720 + r * 260, toFreq: 200, duration: 0.075, gain: vol(0.075), type: 'square', filter: 2400 })
      noiseBurst(ctx, { duration: 0.06, gain: vol(0.05), filterFrom: 5200, filterTo: 900, type: 'bandpass', q: 1.2 })
      break

    case 'impact':
      noiseBurst(ctx, { duration: 0.075, gain: vol(0.075), filterFrom: 4200, filterTo: 700 })
      tone(ctx, { freq: 300 + r * 120, toFreq: 140, duration: 0.06, gain: vol(0.05), type: 'triangle' })
      break

    case 'hit':
      // Melee thump against wood.
      tone(ctx, { freq: 150 + r * 50, toFreq: 70, duration: 0.1, gain: vol(0.1), type: 'triangle' })
      noiseBurst(ctx, { duration: 0.07, gain: vol(0.06), filterFrom: 1800, filterTo: 300 })
      break

    case 'throw':
      noiseBurst(ctx, { duration: 0.16, gain: vol(0.05), filterFrom: 900, filterTo: 2400, type: 'bandpass', q: 2 })
      break

    case 'frost':
      // Glassy: a high sine pair plus filtered shimmer.
      tone(ctx, { freq: 1450 + r * 300, toFreq: 780, duration: 0.24, gain: vol(0.06), type: 'sine' })
      tone(ctx, { freq: 2180 + r * 340, toFreq: 1200, duration: 0.2, gain: vol(0.035), type: 'sine', delay: 0.02 })
      noiseBurst(ctx, { duration: 0.28, gain: vol(0.035), filterFrom: 6000, filterTo: 2200, type: 'highpass' })
      break

    case 'zap':
      // Electric: a hard saw drop over a bright noise crackle.
      tone(ctx, { freq: 2400 + r * 700, toFreq: 260, duration: 0.15, gain: vol(0.075), type: 'sawtooth', filter: 5200 })
      noiseBurst(ctx, { duration: 0.19, gain: vol(0.075), filterFrom: 8000, filterTo: 1400, type: 'bandpass', q: 0.7 })
      tone(ctx, { freq: 90, toFreq: 50, duration: 0.14, gain: vol(0.07), type: 'sine' })
      break

    case 'explosion':
      // Sub thump + wide-band body + a long, dark tail.
      tone(ctx, { freq: 120, toFreq: 34, duration: 0.42, gain: vol(0.22), type: 'sine' })
      noiseBurst(ctx, { duration: 0.36, gain: vol(0.17), filterFrom: 3200, filterTo: 180 })
      noiseBurst(ctx, { duration: 0.75, gain: vol(0.07), filterFrom: 900, filterTo: 90, decay: 3 })
      break

    case 'shatter':
      // Splintering: a bright noise crack plus two detuned wood clacks.
      noiseBurst(ctx, { duration: 0.2, gain: vol(0.1), filterFrom: 6500, filterTo: 900, type: 'bandpass', q: 0.9 })
      tone(ctx, { freq: 420 + r * 200, toFreq: 130, duration: 0.13, gain: vol(0.06), type: 'triangle' })
      tone(ctx, { freq: 300 + r * 160, toFreq: 100, duration: 0.16, gain: vol(0.05), type: 'triangle', delay: 0.035 })
      break

    case 'collapse':
      // The signature moment: deep rumble under a long gravel wash.
      tone(ctx, { freq: 72, toFreq: 26, duration: 1.1, gain: vol(0.24), type: 'sine' })
      noiseBurst(ctx, { duration: 1.0, gain: vol(0.14), filterFrom: 1600, filterTo: 110 })
      noiseBurst(ctx, { duration: 0.55, gain: vol(0.09), filterFrom: 4200, filterTo: 600, type: 'bandpass', q: 0.6 })
      break

    case 'enemyDie':
      tone(ctx, { freq: 340 + r * 180, toFreq: 90, duration: 0.16, gain: vol(0.06), type: 'sawtooth', filter: 1600 })
      noiseBurst(ctx, { duration: 0.13, gain: vol(0.05), filterFrom: 2400, filterTo: 400 })
      break

    case 'waveStart': {
      // Rising perfect-fifth fanfare — three quick notes, unmistakably "go".
      const root = 320
      for (const [i, mult] of [1, 1.335, 2].entries()) {
        tone(ctx, {
          freq: root * mult, duration: 0.28, gain: vol(0.075),
          type: 'square', filter: 2200, delay: i * 0.085
        })
      }
      break
    }

    case 'bossHorn': {
      // Detuned low brass stack — heavy, slightly dissonant, arriving slow.
      for (const [i, f] of [98, 99.5, 147, 196].entries()) {
        tone(ctx, {
          freq: f, toFreq: f * 0.94, duration: 1.5, gain: vol(0.1),
          type: 'sawtooth', filter: 900, delay: i * 0.02
        })
      }
      noiseBurst(ctx, { duration: 1.2, gain: vol(0.06), filterFrom: 400, filterTo: 80 })
      break
    }

    default:
      break
  }
}

/**
 * Play one gameplay cue. Safe to call from the render loop at any density —
 * throttling, mute gating and ad suspension are all handled here.
 */
export const playFx = (id: FxSound): void => {
  if (!canPlay()) return
  if (!passesThrottle(id)) return

  const sample = SAMPLE_CUES[id]
  if (sample) {
    playSound(sample[0], sample[1], 0.94 + Math.random() * 0.12)
    return
  }

  const ctx = getAudioContext()
  if (!ctx) return
  // A context that has never been unlocked by a gesture stays suspended; the
  // shared `armResumeOnGesture` in useAssets resumes it on the first tap, so we
  // simply skip until then rather than queueing a backlog of silent voices.
  if (ctx.state !== 'running') return

  try {
    synth(ctx, id)
  } catch {
    // A browser refusing to allocate more nodes is not worth interrupting a
    // frame for — the visual feedback carries the moment on its own.
  }
}

/** Warm the synthesis path (build the noise buffer) so the first explosion of
 *  a session doesn't pay for a 1.2 s buffer fill mid-frame. */
export const warmAudio = (): void => {
  const ctx = getAudioContext()
  if (ctx) getNoise(ctx)
}
