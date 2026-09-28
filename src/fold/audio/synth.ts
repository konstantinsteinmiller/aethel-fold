/**
 * A tiny synthesis toolkit on top of WebAudio: noise buffers, envelopes and
 * a handful of instruments (pizzicato, glockenspiel, brass, snare, kick,
 * formant voice). Everything is procedural — Castle Fold ships no music files.
 */

export interface Bus {
  ctx: AudioContext
  out: AudioNode
}

let whiteNoise: AudioBuffer | null = null
let crackleNoise: AudioBuffer | null = null

export const noiseBuffer = (ctx: AudioContext): AudioBuffer => {
  if (whiteNoise && whiteNoise.sampleRate === ctx.sampleRate) return whiteNoise
  const len = ctx.sampleRate * 2
  const b = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  whiteNoise = b
  return b
}

/** Sparse impulsive clicks — the "crackle" of paper fibres. */
export const crackleBuffer = (ctx: AudioContext): AudioBuffer => {
  if (crackleNoise && crackleNoise.sampleRate === ctx.sampleRate) return crackleNoise
  const len = ctx.sampleRate * 2
  const b = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = b.getChannelData(0)
  let i = 0
  while (i < len) {
    i += Math.floor(ctx.sampleRate * (0.002 + Math.random() * 0.02))
    const amp = Math.pow(Math.random(), 2) * (Math.random() < 0.5 ? -1 : 1)
    const w = 20 + Math.floor(Math.random() * 80)
    for (let k = 0; k < w && i + k < len; k++) d[i + k] = amp * Math.exp(-k / (w * 0.25)) * (Math.random() * 2 - 1)
  }
  crackleNoise = b
  return b
}

export const env = (g: GainNode, t: number, a: number, peak: number, d: number, sustain = 0, r = 0.02): number => {
  const p = g.gain
  p.cancelScheduledValues(t)
  p.setValueAtTime(0.0001, t)
  p.linearRampToValueAtTime(peak, t + a)
  if (sustain > 0) {
    p.exponentialRampToValueAtTime(Math.max(0.0001, peak * sustain), t + a + d)
    p.setTargetAtTime(0.0001, t + a + d, r)
    return t + a + d + r * 5
  }
  p.exponentialRampToValueAtTime(0.0001, t + a + d)
  return t + a + d
}

export const noise = (
  b: Bus, t: number, dur: number, gain: number,
  filter: BiquadFilterType, freq: number, q = 1, freqEnd?: number, crackle = false, rate = 1
): void => {
  const { ctx } = b
  const src = ctx.createBufferSource()
  src.buffer = crackle ? crackleBuffer(ctx) : noiseBuffer(ctx)
  src.playbackRate.value = rate
  const f = ctx.createBiquadFilter()
  f.type = filter
  f.frequency.setValueAtTime(freq, t)
  if (freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur)
  f.Q.value = q
  const g = ctx.createGain()
  src.connect(f).connect(g).connect(b.out)
  const end = env(g, t, Math.min(0.004, dur * 0.2), gain, dur)
  src.start(t, Math.random() * 1.5)
  src.stop(end + 0.05)
}

export const tone = (
  b: Bus, t: number, type: OscillatorType, f0: number, f1: number, dur: number, gain: number, attack = 0.002
): void => {
  const { ctx } = b
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(f0, t)
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur)
  const g = ctx.createGain()
  o.connect(g).connect(b.out)
  const end = env(g, t, attack, gain, dur)
  o.start(t)
  o.stop(end + 0.05)
}

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)

// ─── Instruments ───────────────────────────────────────────────────────────

/** Plucked violin (pizzicato): bright saw through a fast-closing lowpass. */
export const pizz = (b: Bus, t: number, midi: number, vel = 1, dur = 0.22): void => {
  const { ctx } = b
  const f = mtof(midi)
  const o = ctx.createOscillator()
  o.type = 'sawtooth'
  o.frequency.value = f
  const o2 = ctx.createOscillator()
  o2.type = 'triangle'
  o2.frequency.value = f * 1.003
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 3
  lp.frequency.setValueAtTime(Math.min(9000, f * 9), t)
  lp.frequency.exponentialRampToValueAtTime(Math.max(120, f * 1.4), t + dur * 0.8)
  const g = ctx.createGain()
  o.connect(lp)
  o2.connect(lp)
  lp.connect(g).connect(b.out)
  const end = env(g, t, 0.003, 0.16 * vel, dur)
  o.start(t)
  o2.start(t)
  o.stop(end + 0.05)
  o2.stop(end + 0.05)
}

/** Glockenspiel: inharmonic sine partials with a long ring. */
export const glock = (b: Bus, t: number, midi: number, vel = 1, dur = 1.1): void => {
  const { ctx } = b
  const f = mtof(midi)
  const partials: [number, number][] = [[1, 1], [2.76, 0.4], [5.4, 0.22], [8.93, 0.1]]
  for (const [ratio, amp] of partials) {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = f * ratio
    const g = ctx.createGain()
    o.connect(g).connect(b.out)
    const end = env(g, t, 0.001, 0.09 * vel * amp, dur / Math.sqrt(ratio))
    o.start(t)
    o.stop(end + 0.05)
  }
}

/** Brass stab: detuned saws, filter envelope that opens then settles. */
export const brass = (b: Bus, t: number, midi: number, vel = 1, dur = 0.5): void => {
  const { ctx } = b
  const f = mtof(midi)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 1.4
  lp.frequency.setValueAtTime(f * 1.2, t)
  lp.frequency.linearRampToValueAtTime(f * 6, t + 0.06)
  lp.frequency.exponentialRampToValueAtTime(f * 2.5, t + dur)
  const g = ctx.createGain()
  lp.connect(g).connect(b.out)
  for (const det of [-7, 0, 6]) {
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = f
    o.detune.value = det
    o.connect(lp)
    o.start(t)
    o.stop(t + dur + 0.15)
  }
  env(g, t, 0.03, 0.07 * vel, dur, 0.6, 0.06)
}

/** String pad (for the victory chord). */
export const strings = (b: Bus, t: number, midi: number, vel = 1, dur = 2): void => {
  const { ctx } = b
  const f = mtof(midi)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = f * 4
  const g = ctx.createGain()
  lp.connect(g).connect(b.out)
  for (const det of [-9, -3, 4, 10]) {
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = f
    o.detune.value = det
    o.connect(lp)
    o.start(t)
    o.stop(t + dur + 0.6)
  }
  const p = g.gain
  p.setValueAtTime(0.0001, t)
  p.linearRampToValueAtTime(0.045 * vel, t + 0.25)
  p.setValueAtTime(0.045 * vel, t + dur)
  p.exponentialRampToValueAtTime(0.0001, t + dur + 0.5)
}

export const kick = (b: Bus, t: number, vel = 1): void => {
  tone(b, t, 'sine', 140, 42, 0.22, 0.5 * vel, 0.001)
  noise(b, t, 0.02, 0.12 * vel, 'lowpass', 1800)
}

export const snare = (b: Bus, t: number, vel = 1): void => {
  noise(b, t, 0.14, 0.22 * vel, 'bandpass', 1900, 0.7)
  tone(b, t, 'triangle', 210, 160, 0.08, 0.14 * vel)
}

export const hat = (b: Bus, t: number, vel = 1): void => {
  noise(b, t, 0.035, 0.06 * vel, 'highpass', 7000, 0.8)
}

export const woodblock = (b: Bus, t: number, midi: number, vel = 1): void => {
  tone(b, t, 'sine', mtof(midi), mtof(midi) * 0.98, 0.07, 0.16 * vel, 0.001)
  noise(b, t, 0.012, 0.05 * vel, 'bandpass', mtof(midi) * 2, 4)
}

/**
 * Tiny formant voice (the paper people): a buzzy source through two vowel
 * formants, with pitch glide and vibrato. vowel: 'a' | 'e' | 'o' | 'i'.
 */
export const voice = (
  b: Bus, t: number, f0: number, f1: number, dur: number, vowel: 'a' | 'e' | 'o' | 'i' | 'u', gain = 0.08
): void => {
  const { ctx } = b
  const F: Record<string, [number, number]> = { a: [850, 1610], e: [610, 1900], o: [570, 840], i: [390, 2300], u: [440, 1020] }
  const [fa, fb] = F[vowel]!
  const src = ctx.createOscillator()
  src.type = 'sawtooth'
  src.frequency.setValueAtTime(f0, t)
  src.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur)
  const vib = ctx.createOscillator()
  vib.frequency.value = 7 + Math.random() * 3
  const vibG = ctx.createGain()
  vibG.gain.value = f0 * 0.03
  vib.connect(vibG).connect(src.frequency)
  const g = ctx.createGain()
  const b1 = ctx.createBiquadFilter()
  b1.type = 'bandpass'
  b1.frequency.value = fa * (f0 > 500 ? 1.35 : 1)
  b1.Q.value = 6
  const b2 = ctx.createBiquadFilter()
  b2.type = 'bandpass'
  b2.frequency.value = fb * (f0 > 500 ? 1.35 : 1)
  b2.Q.value = 8
  src.connect(b1).connect(g)
  src.connect(b2).connect(g)
  g.connect(b.out)
  const p = g.gain
  p.setValueAtTime(0.0001, t)
  p.linearRampToValueAtTime(gain, t + 0.03)
  p.setValueAtTime(gain, t + dur * 0.7)
  p.exponentialRampToValueAtTime(0.0001, t + dur)
  src.start(t)
  vib.start(t)
  src.stop(t + dur + 0.05)
  vib.stop(t + dur + 0.05)
}

/** Procedural small-room impulse response for a warm desk reverb. */
export const roomImpulse = (ctx: AudioContext, seconds = 0.9, decay = 3): AudioBuffer => {
  const len = Math.floor(ctx.sampleRate * seconds)
  const b = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
  }
  return b
}
