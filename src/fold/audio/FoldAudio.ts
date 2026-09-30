/**
 * Aethel Fold sound (aethel-fold-GDD §3): an ASMR-first, fully procedural
 * paper soundscape.
 *
 *   Swiping      — crisp, heavy paper creasing that follows the finger (shhhhkkk)
 *   Popping up   — a bass-boosted cardboard SNAP / THWACK
 *   Defeat       — a sharp paper tear (rip!) and a party-popper / kazoo POP
 *   Boss         — grinding paper gears, a paper roar, crackling paper-fire
 *   Victory      — a resolving orchestral chord and tiny paper people cheering "yay!"
 *
 * Runs on the app's shared AudioContext so the existing pause / ad / mobile
 * mute pipeline (suspendAllAudio) silences it with everything else.
 */

import type { FoldEvent } from '../logic/events'
import { KILL_CRUSH, KILL_FLING, KILL_LAUNCH, KILL_RIDGE, KILL_TEAR } from '../logic/events'
import type { FoldGame } from '../logic/game'
import { BOSS_PHASE_CODES } from '../logic/boss'
import { OUTRO, STARS } from '../logic/config'
import { brass, crackleBuffer, glock, kick, noise, noiseBuffer, roomImpulse, strings, tone, voice, type Bus } from './synth'
import { MusicSequencer, type SongId } from './music'

/** Star ribbon pitches, rising per star (E5, G5, C6). */
const STAR_NOTES = [76, 79, 84] as const

export class FoldAudio {
  readonly ctx: AudioContext
  private readonly master: GainNode
  private readonly sfxGain: GainNode
  private readonly musicGain: GainNode
  private readonly musicFilter: BiquadFilterNode
  private readonly reverbSend: GainNode
  readonly sfx: Bus
  readonly music: MusicSequencer
  // Continuous voices.
  private readonly creaseSrc: AudioBufferSourceNode
  private readonly creaseFilter: BiquadFilterNode
  private readonly creaseGain: GainNode
  private readonly crackleSrc: AudioBufferSourceNode
  private readonly crackleGain: GainNode
  private readonly grindGain: GainNode
  private readonly grindOscs: OscillatorNode[] = []
  private lastDragT = 0
  private lastSpawnSfx = 0
  private lastKillSfx = 0
  private started = false
  /** When each firework voice falls silent (C9b): at most `OUTRO.popVoices` ring at once. */
  private readonly popEnds = new Float64Array(OUTRO.popVoices)
  private sfxVolume = 0.8
  private musicVolume = 0.5

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0.9
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 3
    comp.attack.value = 0.004
    comp.release.value = 0.18
    this.master.connect(comp).connect(ctx.destination)

    const reverb = ctx.createConvolver()
    reverb.buffer = roomImpulse(ctx)
    this.reverbSend = ctx.createGain()
    this.reverbSend.gain.value = 0.16
    this.reverbSend.connect(reverb).connect(this.master)

    this.sfxGain = ctx.createGain()
    this.sfxGain.connect(this.master)
    this.sfxGain.connect(this.reverbSend)
    this.musicFilter = ctx.createBiquadFilter()
    this.musicFilter.type = 'lowpass'
    this.musicFilter.frequency.value = 18000
    this.musicGain = ctx.createGain()
    this.musicGain.connect(this.musicFilter).connect(this.master)
    this.musicFilter.connect(this.reverbSend)
    this.sfx = { ctx, out: this.sfxGain }
    this.music = new MusicSequencer({ ctx, out: this.musicGain })

    // The crease loop: filtered noise + fibre crackle, silent until a fold is dragged.
    this.creaseSrc = ctx.createBufferSource()
    this.creaseSrc.buffer = noiseBuffer(ctx)
    this.creaseSrc.loop = true
    this.creaseFilter = ctx.createBiquadFilter()
    this.creaseFilter.type = 'bandpass'
    this.creaseFilter.frequency.value = 2200
    this.creaseFilter.Q.value = 0.9
    this.creaseGain = ctx.createGain()
    this.creaseGain.gain.value = 0
    this.creaseSrc.connect(this.creaseFilter).connect(this.creaseGain).connect(this.sfxGain)
    this.crackleSrc = ctx.createBufferSource()
    this.crackleSrc.buffer = crackleBuffer(ctx)
    this.crackleSrc.loop = true
    this.crackleGain = ctx.createGain()
    this.crackleGain.gain.value = 0
    const crackleHp = ctx.createBiquadFilter()
    crackleHp.type = 'highpass'
    crackleHp.frequency.value = 1500
    this.crackleSrc.connect(crackleHp).connect(this.crackleGain).connect(this.sfxGain)

    // Gear grind for the castle transformation.
    this.grindGain = ctx.createGain()
    this.grindGain.gain.value = 0
    const grindLp = ctx.createBiquadFilter()
    grindLp.type = 'lowpass'
    grindLp.frequency.value = 380
    grindLp.Q.value = 4
    this.grindGain.connect(this.sfxGain)
    grindLp.connect(this.grindGain)
    for (const f of [41, 43.5, 82.5]) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = f
      o.connect(grindLp)
      this.grindOscs.push(o)
    }
  }

  /** Start the always-on voices (must follow a user gesture on iOS). */
  start(): void {
    if (this.started) return
    this.started = true
    const t = this.ctx.currentTime
    this.creaseSrc.start(t)
    this.crackleSrc.start(t)
    for (const o of this.grindOscs) o.start(t)
    this.music.start()
  }

  setVolumes(sfx: number, music: number): void {
    this.sfxVolume = sfx
    this.musicVolume = music
    const t = this.ctx.currentTime
    this.sfxGain.gain.setTargetAtTime(Math.max(0, sfx), t, 0.05)
    this.musicGain.gain.setTargetAtTime(Math.max(0, music) * 0.55, t, 0.05)
  }

  /** Muffle the music (pause menu, lesson focus). */
  muffle(amount: number): void {
    const t = this.ctx.currentTime
    this.musicFilter.frequency.setTargetAtTime(18000 * Math.pow(1 - amount, 2) + 380 * amount, t, 0.08)
  }

  song(id: SongId): void {
    this.music.play(id)
  }

  // ─── Continuous feedback ─────────────────────────────────────────────────

  /** Called by the gesture layer on each drag tick with progress 0…1. */
  dragTick(progress: number, kind: 'fold' | 'tear' | 'peel'): void {
    const t = this.ctx.currentTime
    this.lastDragT = t
    const base = kind === 'tear' ? 900 : kind === 'peel' ? 1600 : 1400
    this.creaseFilter.frequency.setTargetAtTime(base + progress * (kind === 'tear' ? 3200 : 2600), t, 0.02)
    this.creaseFilter.Q.value = kind === 'tear' ? 2.2 : 0.9
    this.creaseGain.gain.setTargetAtTime(0.1 + progress * 0.14, t, 0.015)
    this.crackleGain.gain.setTargetAtTime(kind === 'tear' ? 0.55 + progress * 0.4 : 0.25 + progress * 0.3, t, 0.015)
  }

  /** Per frame: let the crease voice fall silent when the finger stops. */
  update(): void {
    const t = this.ctx.currentTime
    if (t - this.lastDragT > 0.07) {
      this.creaseGain.gain.setTargetAtTime(0, t, 0.04)
      this.crackleGain.gain.setTargetAtTime(0, t, 0.04)
    }
    this.music.tick()
  }

  // ─── One-shots ───────────────────────────────────────────────────────────

  private get now(): number {
    return this.ctx.currentTime + 0.005
  }

  private r(k = 0.06): number {
    return 1 + (Math.random() - 0.5) * 2 * k
  }

  snap(big = false): void {
    const b = this.sfx
    const t = this.now
    const p = this.r()
    // Sub thump (bass-boosted cardboard), click transient, woody thwack body.
    tone(b, t, 'sine', 160 * p, 42, big ? 0.3 : 0.22, big ? 0.85 : 0.7, 0.001)
    noise(b, t, 0.012, 0.5, 'highpass', 3500)
    noise(b, t, 0.05, 0.4, 'bandpass', 950 * p, 2.2)
    tone(b, t, 'triangle', 330 * p, 250, 0.07, 0.22)
    noise(b, t + 0.01, 0.09, 0.18, 'bandpass', 2600, 1.2, 1400, true)
  }

  stamp(heavy: boolean): void {
    const b = this.sfx
    const t = this.now
    tone(b, t, 'sine', 120, 32, heavy ? 0.45 : 0.32, heavy ? 1 : 0.8, 0.001)
    noise(b, t, 0.1, 0.55, 'lowpass', 2200, 0.8, 500)
    noise(b, t, 0.2, 0.3, 'bandpass', 3000, 1, 1200, true)
    if (heavy) {
      tone(b, t + 0.02, 'square', 70, 38, 0.18, 0.18)
      noise(b, t, 0.35, 0.22, 'bandpass', 600, 0.7, 200)
    }
  }

  rip(size = 1): void {
    const b = this.sfx
    const t0 = this.now
    // A tear is a rapid train of fibre-snaps sweeping up in pitch.
    const grains = Math.round(14 + size * 12)
    const dur = 0.28 + size * 0.22
    for (let i = 0; i < grains; i++) {
      const k = i / grains
      const t = t0 + k * dur + Math.random() * 0.01
      noise(b, t, 0.014 + Math.random() * 0.02, (0.22 + Math.random() * 0.2) * size, 'bandpass', 700 + k * 3400 + Math.random() * 400, 1.8)
    }
    noise(b, t0, dur, 0.12 * size, 'highpass', 1800, 0.7, 5200, true)
  }

  pop(): void {
    const b = this.sfx
    const t = this.now
    const p = this.r(0.12)
    noise(b, t, 0.03, 0.4, 'bandpass', 1700 * p, 1.5)
    tone(b, t, 'sine', 700 * p, 180, 0.05, 0.3)
    // Party kazoo: a buzzy saw with a formant, bending up.
    voice(b, t + 0.02, 300 * p, 420 * p, 0.16, 'u', 0.05)
  }

  kazoo(): void {
    const t = this.now
    voice(this.sfx, t, 360, 520, 0.22, 'o', 0.06)
    voice(this.sfx, t + 0.02, 540, 780, 0.2, 'u', 0.03)
  }

  thunk(): void {
    const b = this.sfx
    const t = this.now
    noise(b, t, 0.04, 0.35, 'lowpass', 1300)
    tone(b, t, 'sine', 230, 110, 0.07, 0.35)
  }

  whoosh(dur = 0.3, high = 2400): void {
    noise(this.sfx, this.now, dur, 0.16, 'bandpass', high, 1.2, 500)
  }

  twang(): void {
    const t = this.now
    tone(this.sfx, t, 'sawtooth', 190, 140, 0.16, 0.08)
    this.whoosh(0.22, 3000)
  }

  creak(): void {
    const t = this.now
    for (let i = 0; i < 5; i++) tone(this.sfx, t + i * 0.05, 'sawtooth', 90 + Math.random() * 40, 70, 0.05, 0.05)
  }

  tap(): void {
    noise(this.sfx, this.now, 0.03, 0.12, 'bandpass', 3200, 2)
  }

  springBack(): void {
    const t = this.now
    noise(this.sfx, t, 0.12, 0.12, 'bandpass', 2600, 1, 900)
    tone(this.sfx, t, 'triangle', 420, 300, 0.08, 0.05)
  }

  unfoldSoft(): void {
    noise(this.sfx, this.now, 0.18, 0.08, 'bandpass', 1500, 1, 700, true)
  }

  crumple(): void {
    const b = this.sfx
    const t0 = this.now
    for (let i = 0; i < 40; i++) {
      const k = i / 40
      noise(b, t0 + k * 0.7 + Math.random() * 0.02, 0.03, 0.18 + k * 0.2, 'bandpass', 1200 + Math.random() * 3000, 1.4)
    }
    noise(b, t0 + 0.55, 0.5, 0.25, 'bandpass', 1800, 1, 400)
  }

  pageTurn(): void {
    const b = this.sfx
    const t = this.now
    noise(b, t, 0.95, 0.2, 'lowpass', 400, 0.8, 3200)
    noise(b, t + 0.6, 0.35, 0.14, 'bandpass', 2400, 1, 800, true)
    tone(b, t + 1.2, 'sine', 110, 60, 0.12, 0.35)
  }

  pageDrop(): void {
    const b = this.sfx
    const t = this.now
    for (let i = 0; i < 6; i++) noise(b, t + i * 0.1, 0.07, 0.07, 'bandpass', 1200 + i * 200, 1)
    tone(b, t + 0.75, 'sine', 130, 48, 0.2, 0.55)
    noise(b, t + 0.75, 0.2, 0.2, 'lowpass', 1500, 0.8, 300)
  }

  heroHit(): void {
    const b = this.sfx
    const t = this.now
    tone(b, t, 'sine', 180, 60, 0.2, 0.5)
    voice(b, t + 0.02, 560, 360, 0.3, 'o', 0.09)
    noise(b, t, 0.2, 0.15, 'bandpass', 2600, 1, 900, true)
    glock(b, t + 0.1, 76, 0.5, 0.4)
    glock(b, t + 0.2, 72, 0.5, 0.5)
  }

  yay(count = 7): void {
    const t = this.now
    for (let i = 0; i < count; i++) {
      const f = 620 + Math.random() * 520
      voice(this.sfx, t + Math.random() * 0.18, f, f * 1.25, 0.55 + Math.random() * 0.25, i % 2 ? 'e' : 'a', 0.04)
    }
    for (let i = 0; i < 14; i++) noise(this.sfx, t + 0.1 + Math.random() * 0.8, 0.02, 0.08, 'bandpass', 1400 + Math.random() * 800, 1.5)
  }

  /**
   * A voice for a firework sound, if one is free (the cap keeps a volley from
   * piling up nodes on a small phone). Claims it until `dur` from now.
   */
  private popVoice(dur: number): boolean {
    const t = this.ctx.currentTime
    for (let i = 0; i < this.popEnds.length; i++) {
      if (this.popEnds[i]! > t) continue
      this.popEnds[i] = t + dur
      return true
    }
    return false
  }

  /** A paper rocket: a soft rising fwip. */
  fireworkLaunch(): void {
    if (!this.popVoice(0.3)) return
    const t = this.now
    noise(this.sfx, t, 0.28, 0.07, 'bandpass', 900 * this.r(0.1), 1.6, 3600)
  }

  /** A small paper firework: a crisp pop and a sprinkle of crackle. */
  fireworkPop(): void {
    if (!this.popVoice(0.45)) return
    const b = this.sfx
    const t = this.now
    const p = this.r(0.15)
    noise(b, t, 0.025, 0.32, 'bandpass', 2100 * p, 1.4)
    tone(b, t, 'sine', 520 * p, 150, 0.08, 0.22)
    noise(b, t + 0.06, 0.35, 0.09, 'highpass', 2600, 0.8, 5200, true)
  }

  roar(): void {
    const b = this.sfx
    const t = this.now
    voice(b, t, 150, 92, 1.4, 'a', 0.22)
    voice(b, t + 0.05, 225, 140, 1.3, 'o', 0.12)
    noise(b, t, 1.4, 0.3, 'bandpass', 500, 1.2, 180)
    noise(b, t, 1.2, 0.2, 'bandpass', 2500, 1, 1200, true)
    tone(b, t, 'sine', 70, 40, 1.2, 0.5)
  }

  fire(): void {
    const b = this.sfx
    const t = this.now
    noise(b, t, 1.2, 0.35, 'lowpass', 600, 0.7, 2600)
    noise(b, t, 1.2, 0.25, 'bandpass', 3000, 0.8, 1500, true)
  }

  stomp(): void {
    const b = this.sfx
    const t = this.now
    tone(b, t, 'sine', 95, 30, 0.55, 1, 0.001)
    noise(b, t, 0.35, 0.45, 'lowpass', 900, 0.8, 120)
    noise(b, t + 0.03, 0.4, 0.2, 'bandpass', 2400, 1, 800, true)
  }

  crease(): void {
    const b = this.sfx
    const t = this.now
    noise(b, t, 0.3, 0.45, 'bandpass', 900, 1.4, 3800, true)
    tone(b, t + 0.05, 'sine', 140, 45, 0.3, 0.75)
    voice(b, t + 0.1, 330, 520, 0.35, 'i', 0.08)
  }

  ribbit(): void {
    const t = this.now
    for (let i = 0; i < 2; i++) {
      const s = t + i * 0.14
      const b = this.sfx
      const { ctx } = b
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(260, s)
      o.frequency.linearRampToValueAtTime(190, s + 0.1)
      const am = ctx.createOscillator()
      am.frequency.value = 38
      const amG = ctx.createGain()
      amG.gain.value = 0.5
      const g = ctx.createGain()
      g.gain.value = 0
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 750
      bp.Q.value = 3
      am.connect(amG).connect(g.gain)
      o.connect(bp).connect(g).connect(b.out)
      g.gain.setValueAtTime(0.0001, s)
      g.gain.linearRampToValueAtTime(0.18, s + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.11)
      o.start(s)
      am.start(s)
      o.stop(s + 0.14)
      am.stop(s + 0.14)
    }
  }

  chime(up = true): void {
    const t = this.now
    const notes = up ? [72, 76, 79, 84] : [84, 79, 76]
    notes.forEach((n, i) => glock(this.sfx, t + i * 0.07, n, 0.6, 0.8))
  }

  /**
   * The star ribbon's beats (roadmap #1): one bright paper "tink" per star
   * earned, each a step higher, timed to StarRibbon's fold-in (both read
   * `STARS.revealDelay` / `revealStep`). A third star gets a sparkle on top.
   * Scheduled once on `pageCleared`, never per frame.
   */
  stars(n: number): void {
    const t = this.now + STARS.revealDelay
    const count = Math.max(0, Math.min(3, Math.round(n)))
    for (let i = 0; i < count; i++) {
      const at = t + i * STARS.revealStep
      const midi = STAR_NOTES[i]!
      glock(this.sfx, at, midi, 0.85, 1)
      glock(this.sfx, at + 0.012, midi + 12, 0.3, 0.5)
      noise(this.sfx, at, 0.05, 0.05, 'highpass', 5200, 0.8)
    }
    if (count === 3) {
      const at = t + 3 * STARS.revealStep
      for (let i = 0; i < 4; i++) glock(this.sfx, at + i * 0.05, 91 + i * 2, 0.35, 0.6)
    }
  }

  victoryChord(): void {
    const b = this.sfx
    const t = this.now
    // Suspension resolving to C major, brass on top, timpani underneath.
    for (const n of [48, 55, 60, 65]) strings(b, t, n, 1, 0.9)
    for (const n of [48, 55, 60, 64, 67, 72]) strings(b, t + 0.9, n, 1.1, 2.6)
    for (const [n, dt] of [[67, 0], [72, 0.15], [76, 0.3], [79, 0.9]] as const) brass(b, t + dt, n, 1, dt < 0.8 ? 0.2 : 1.6)
    for (let i = 0; i < 12; i++) kick(b, t + 0.6 + i * 0.025, 0.25)
    kick(b, t + 0.9, 1)
    for (const [n, dt] of [[84, 1], [88, 1.1], [91, 1.2], [96, 1.35]] as const) glock(b, t + dt, n, 0.7, 1.4)
  }

  grind(on: boolean): void {
    const t = this.ctx.currentTime
    this.grindGain.gain.setTargetAtTime(on ? 0.3 : 0, t, on ? 0.4 : 0.25)
    if (on) {
      for (let i = 0; i < 24; i++) noise(this.sfx, t + i * 0.085, 0.02, 0.08, 'bandpass', 2400 + Math.random() * 600, 3)
    }
  }

  // ─── Event mapping ───────────────────────────────────────────────────────

  onEvent(e: FoldEvent, game: FoldGame): void {
    const t = this.ctx.currentTime
    switch (e.type) {
      case 'foldGrab':
        this.unfoldSoft()
        break
      case 'foldSnap': {
        const k = game.folds[e.a]?.def.kind
        this.snap(k === 'ridge' || e.b >= 3)
        if (k === 'launch') this.whoosh(0.5, 1800)
        break
      }
      case 'foldStamp':
        this.stamp(e.c === 1)
        break
      case 'foldRelease':
        this.springBack()
        break
      case 'foldLower':
        this.unfoldSoft()
        break
      case 'foldBreak':
        this.rip(0.8)
        break
      case 'lensHit':
        this.pop()
        break
      case 'kill':
        if (t - this.lastKillSfx < 0.04) break
        this.lastKillSfx = t
        if (e.c === KILL_CRUSH) {
          this.rip(0.5)
          this.pop()
        } else if (e.c === KILL_TEAR || e.c === KILL_FLING) {
          this.rip(0.6)
          this.pop()
        } else if (e.c === KILL_RIDGE) this.kazoo()
        else if (e.c === KILL_LAUNCH) this.whoosh(0.25, 2800)
        break
      case 'tear':
        this.rip(1.6)
        this.snap(true)
        this.kazoo()
        break
      case 'tearPull':
        break
      case 'blocked':
        if (e.c === 3) this.stamp(false)
        else this.thunk()
        break
      case 'impact':
        if (e.b === 2) this.stomp()
        else if (e.b === 4 || e.b === 5) this.thunk()
        if (e.b === 5 && e.c > 0) this.pop()
        break
      case 'shoot':
        if (e.c === 1) this.twang()
        else this.creak()
        break
      case 'heroHit':
        this.heroHit()
        break
      case 'crumple':
        this.crumple()
        break
      case 'pageDrop':
        this.pageDrop()
        break
      case 'pageTurn':
        this.pageTurn()
        break
      case 'peelStart':
        this.unfoldSoft()
        break
      case 'peelDone':
        this.pageTurn()
        break
      case 'pageCleared':
        this.chime(true)
        this.yay(5)
        this.stars(e.c)
        break
      case 'spawn':
        if (t - this.lastSpawnSfx > 0.25) {
          this.lastSpawnSfx = t
          noise(this.sfx, this.now, 0.06, 0.05, 'bandpass', 2000, 1.2, 3000)
        }
        break
      case 'lesson':
        if (e.b === 1) this.chime(true)
        break
      // The desk bookshelf: a soft swish out and back, a book sliding out, a locked one's knock.
      case 'shelf':
        this.whoosh(0.3, e.a ? 900 : 1400)
        break
      case 'shelfSelect':
        if (e.b) this.unfoldSoft()
        else this.thunk()
        break
      case 'shelfBook':
        if (!e.b) this.pageTurn()
        break
      case 'combo':
        glock(this.sfx, this.now, 72 + Math.min(12, e.b * 2), 0.6, 0.6)
        break
      case 'bossPhase': {
        const ph = BOSS_PHASE_CODES[e.a]
        if (ph === 'rumble') {
          this.music.play('drop')
          this.grind(true)
        } else if (ph === 'unfold') {
          this.grind(true)
          this.snap(true)
        } else if (ph === 'roar') {
          this.grind(false)
          this.roar()
          this.music.play('boss')
        } else if (ph === 'breathCharge') {
          noise(this.sfx, this.now, 1.8, 0.14, 'bandpass', 300, 1, 1600)
        } else if (ph === 'collapse') {
          this.crumple()
          this.music.play('drop')
        } else if (ph === 'exposed') {
          this.chime(true)
        }
        break
      }
      case 'bossBreath':
        this.fire()
        break
      case 'bossStomp':
        this.stomp()
        break
      case 'bossHurt':
        this.crease()
        break
      case 'frog':
        this.snap()
        break
      case 'victory':
        this.victoryChord()
        this.yay(9)
        this.music.play('victory', 3.2)
        break
      case 'tap':
        this.tap()
        break
      case 'firework':
        if (e.b === 1) this.fireworkPop()
        else this.fireworkLaunch()
        break
      case 'outroBeat':
        // The crowd's cheer beats (C9b): a smaller "yay!" than the victory's.
        if (e.b === 0 && game.outro.script?.beats[e.a]?.kind === 'cheer') this.yay(5)
        break
      case 'secret':
        // A found secret: a bright little glissando, a sparkle on top the first time (roadmap #15).
        this.chime(true)
        if (e.b) for (let i = 0; i < 4; i++) glock(this.sfx, this.now + 0.3 + i * 0.05, 91 + i * 2, 0.35, 0.6)
        break
      case 'night':
        // The lamp's switch.
        this.tap()
        this.thunk()
        break
      case 'rushStart':
        this.whoosh(0.5, 2200)
        break
      case 'rushDone':
        this.victoryChord()
        this.music.play('victory', 3.2)
        break
      case 'bossHit':
        this.thunk()
        if (e.c) this.roar()
        break
      case 'ballistaFire':
        this.twang()
        this.whoosh(0.3, 3000)
        break
      case 'slingGrab':
        this.creak()
        break
      case 'slingFire':
        this.twang()
        this.whoosh(0.45, 1600)
        break
      case 'slingCancel':
        this.springBack()
        break
      case 'slingReady':
        this.tap()
        break
      case 'leap':
        if (t - this.lastSpawnSfx > 0.12) {
          this.lastSpawnSfx = t
          // A paper spring: a quick rising boing.
          this.whoosh(e.c ? 0.3 : 0.14, e.c ? 3400 : 2600)
        }
        break
      case 'pageIntro':
        this.music.play(e.a >= 5 ? (e.a === 6 ? 'finale' : 'drop') : e.a >= 3 ? 'siege' : 'toy')
        break
    }
  }

  get volumes(): { sfx: number; music: number } {
    return { sfx: this.sfxVolume, music: this.musicVolume }
  }

  dispose(): void {
    try {
      this.creaseSrc.stop()
      this.crackleSrc.stop()
      for (const o of this.grindOscs) o.stop()
    } catch {
      /* never started */
    }
    this.music.stop()
    this.master.disconnect()
  }
}
