/**
 * The procedural soundtrack (aethel-fold-GDD §3 "Soundtrack Arc"):
 *
 *   paper    — pages 1–2: a bouncy "paper theatre" folk tune, oom-pah
 *              pizzicato under a call-and-response glockenspiel.
 *   toy      — the previous early-page theme (light pizzicato + glockenspiel),
 *              kept for reference; no page plays it now.
 *   siege    — the same palette with a woodblock and a minor turn.
 *   drop     — the boss reveal: the music drops out to a low drone (the gear
 *              grind is a sound effect laid over it).
 *   boss     — pizzicato returns, joined by a driving brass section and a
 *              fast snare, still "miniature" but the stakes are up.
 *   victory  — a bright fanfare loop after the resolving chord.
 *   finale   — a hushed music-box version before the last fold.
 *
 * A lookahead scheduler (Chris Wilson's pattern) places notes ~150 ms ahead
 * on the audio clock; `tick()` is called once per animation frame.
 */

import { brass, glock, hat, kick, pizz, snare, tone, woodblock, type Bus } from './synth'

export type SongId = 'paper' | 'toy' | 'siege' | 'drop' | 'boss' | 'victory' | 'finale' | 'silent'

interface Song {
  bpm: number
  /** Called for every 16th note. */
  step(b: Bus, t: number, s: number, bar: number): void
}

// Chord roots/tones per bar (MIDI).
const C = [48, 52, 55]
const Am = [45, 48, 52]
const F = [41, 45, 48]
const G = [43, 47, 50]
const Dm = [50, 53, 57]
const Bb = [46, 50, 53]
const Fh = [53, 57, 60]
const Ch = [48, 52, 55]
const A = [45, 49, 52]
const E = [40, 44, 47]

const TOY_CHORDS = [C, Am, F, G, C, Am, F, G]
// Glockenspiel melody, one entry per 8th note (null = rest), 8 bars.
const TOY_MELODY: (number | null)[] = [
  76, null, 79, 76, 72, null, 74, null,
  72, null, 76, 72, 69, null, null, null,
  72, 74, 76, null, 77, 76, 74, null,
  71, null, 74, null, 79, null, null, null,
  76, null, 79, 81, 79, null, 76, null,
  72, null, 76, 74, 72, null, 69, null,
  69, 72, 77, null, 76, 74, 72, null,
  74, null, 71, null, 72, null, null, null
]

const SIEGE_CHORDS = [Am, F, C, G, Am, F, E, E]
const SIEGE_MELODY: (number | null)[] = [
  69, null, 72, 76, 74, null, 72, null,
  69, null, 65, null, 69, 72, null, null,
  72, null, 76, 79, 77, 76, 74, null,
  71, null, 74, null, 71, null, null, null,
  69, 71, 72, null, 76, null, 74, 72,
  69, null, 72, 77, 76, null, 72, null,
  68, null, 71, 74, 76, null, 74, null,
  71, null, 68, null, 64, null, null, null
]

const BOSS_CHORDS = [Dm, Bb, Fh, Ch, Dm, Bb, Ch, A]
const BOSS_BRASS: (number | null)[] = [
  74, null, null, 77, 81, null, 79, 77,
  74, null, null, null, 70, null, 72, null,
  77, null, null, 81, 84, null, 81, 79,
  76, null, null, null, 72, null, 76, null,
  74, null, null, 77, 81, null, 82, 81,
  79, null, 77, null, 74, null, 70, null,
  72, null, 76, 79, 76, null, 72, null,
  73, null, 76, null, 81, null, null, null
]

const VICTORY_CHORDS = [C, F, G, C]
const VICTORY_MELODY: (number | null)[] = [
  72, null, 76, null, 79, null, 84, null,
  81, null, 77, null, 81, 84, null, null,
  79, null, 77, 76, 74, null, 79, null,
  76, null, 79, null, 84, null, null, null
]

const PAPER_CHORDS = [Fh, Ch, Dm, Bb, Fh, Ch, Bb, Ch]
const PAPER_MELODY: (number | null)[] = [
  77, null, 81, 84, 81, null, 77, null,
  79, null, 76, null, 72, null, null, null,
  74, 77, 81, null, 79, 77, 74, null,
  70, null, 74, 77, 74, null, null, null,
  81, null, 84, 86, 84, 81, 77, null,
  79, 81, 79, 76, 72, null, 76, null,
  77, null, 74, 70, 74, 77, 82, null,
  79, null, 76, null, 77, null, null, null
]

const arp = (ch: number[], s: number): number => {
  const pattern = [0, 1, 2, 1, 0, 2, 1, 2]
  const i = pattern[(s >> 1) % pattern.length]!
  return ch[i]! + (s % 8 >= 4 ? 12 : 12)
}

const SONGS: Record<Exclude<SongId, 'silent'>, Song> = {
  paper: {
    bpm: 112,
    step(b, t, s, bar) {
      const ch = PAPER_CHORDS[bar % PAPER_CHORDS.length]!
      // Oom-pah: bass pizz on beats 1 and 3, chord pizz on 2 and 4.
      if (s % 8 === 0) pizz(b, t, ch[0]! - 12, 1.1, 0.34)
      if (s % 8 === 4) {
        pizz(b, t, ch[1]!, 0.6, 0.14)
        pizz(b, t, ch[2]!, 0.6, 0.14)
      }
      const m = PAPER_MELODY[((bar % 8) * 8 + (s >> 1)) % PAPER_MELODY.length]
      if (s % 2 === 0 && m) glock(b, t, m, 0.72, 1)
      if (s % 4 === 2) woodblock(b, t, bar % 2 === 0 ? 84 : 86, 0.28)
      if (bar % 8 >= 4 && s % 2 === 1) hat(b, t, 0.18)
    }
  },
  toy: {
    bpm: 108,
    step(b, t, s, bar) {
      const ch = TOY_CHORDS[bar % TOY_CHORDS.length]!
      // Pizzicato arpeggio on 8ths, bass pizz on beats 1 and 3.
      if (s % 2 === 0) pizz(b, t, arp(ch, s), 0.8, 0.18)
      if (s % 8 === 0) pizz(b, t, ch[0]! - 12, 1.1, 0.35)
      if (s % 16 === 12) pizz(b, t, ch[1]! - 12, 0.7, 0.25)
      const m = TOY_MELODY[((bar % 8) * 8 + (s >> 1)) % TOY_MELODY.length]
      if (s % 2 === 0 && m) glock(b, t, m, 0.75, 1.1)
      if (s % 4 === 2) woodblock(b, t, 84, 0.25)
    }
  },
  siege: {
    bpm: 116,
    step(b, t, s, bar) {
      const ch = SIEGE_CHORDS[bar % SIEGE_CHORDS.length]!
      if (s % 2 === 0) pizz(b, t, arp(ch, s), 0.85, 0.16)
      if (s % 4 === 0) pizz(b, t, ch[0]! - 12, 1, 0.28)
      const m = SIEGE_MELODY[((bar % 8) * 8 + (s >> 1)) % SIEGE_MELODY.length]
      if (s % 2 === 0 && m) glock(b, t, m, 0.65, 0.9)
      if (s % 4 === 2) woodblock(b, t, 79, 0.35)
      if (s % 8 === 4) snare(b, t, 0.25)
      if (s % 2 === 1) hat(b, t, 0.3)
    }
  },
  drop: {
    bpm: 60,
    step(b, t, s) {
      // A low drone, breathing slowly.
      if (s === 0) tone(b, t, 'sine', 55, 52, 3.8, 0.12, 0.8)
      if (s === 8) tone(b, t, 'sine', 82.4, 80, 2, 0.04, 0.5)
    }
  },
  boss: {
    bpm: 132,
    step(b, t, s, bar) {
      const ch = BOSS_CHORDS[bar % BOSS_CHORDS.length]!
      // Driving pizzicato 8ths, kick on 1 & 3, snare on 2 & 4 with 16th fills.
      if (s % 2 === 0) pizz(b, t, ch[s % 4 === 0 ? 0 : 2]! + 12, 0.95, 0.14)
      if (s % 2 === 1 && bar % 2 === 1) pizz(b, t, ch[1]! + 12, 0.5, 0.1)
      if (s % 8 === 0) kick(b, t, 0.9)
      if (s % 8 === 4) snare(b, t, 0.75)
      if (bar % 4 === 3 && s >= 12) snare(b, t, 0.4 + (s - 12) * 0.12)
      if (s % 2 === 1) hat(b, t, 0.45)
      if (s === 0) for (const n of ch) brass(b, t, n + 12, 0.8, 0.35)
      const m = BOSS_BRASS[((bar % 8) * 8 + (s >> 1)) % BOSS_BRASS.length]
      if (s % 2 === 0 && m) brass(b, t, m, 0.75, 0.22)
      if (s % 4 === 0 && bar % 2 === 0) glock(b, t, ch[2]! + 24, 0.35, 0.5)
    }
  },
  victory: {
    bpm: 100,
    step(b, t, s, bar) {
      const ch = VICTORY_CHORDS[bar % VICTORY_CHORDS.length]!
      if (s % 2 === 0) pizz(b, t, arp(ch, s), 0.7, 0.2)
      if (s % 8 === 0) pizz(b, t, ch[0]! - 12, 1, 0.4)
      const m = VICTORY_MELODY[((bar % 4) * 8 + (s >> 1)) % VICTORY_MELODY.length]
      if (s % 2 === 0 && m) {
        glock(b, t, m + 12, 0.6, 1)
        if (bar % 2 === 0) brass(b, t, m, 0.45, 0.3)
      }
      if (s % 8 === 4) snare(b, t, 0.2)
    }
  },
  finale: {
    bpm: 84,
    step(b, t, s, bar) {
      const ch = TOY_CHORDS[bar % 4]!
      if (s % 4 === 0) glock(b, t, arp(ch, s) + 12, 0.45, 1.3)
      if (s === 0) pizz(b, t, ch[0]! - 12, 0.6, 0.5)
    }
  }
}

export class MusicSequencer {
  private song: SongId = 'silent'
  private pending: SongId | null = null
  private pendingAt = 0
  private nextTime = 0
  private stepIdx = 0
  private bar = 0
  private running = false

  constructor(private readonly bus: Bus) {}

  start(): void {
    this.running = true
    this.nextTime = this.bus.ctx.currentTime + 0.1
  }

  stop(): void {
    this.running = false
  }

  /** Switch songs; `delay` seconds lets a one-shot (the victory chord) ring first. */
  play(id: SongId, delay = 0): void {
    if (id === this.song && this.pending === null) return
    this.pending = id
    this.pendingAt = this.bus.ctx.currentTime + delay
  }

  get current(): SongId {
    return this.song
  }

  tick(): void {
    if (!this.running) return
    const ctx = this.bus.ctx
    if (ctx.state !== 'running') {
      this.nextTime = ctx.currentTime + 0.05
      return
    }
    const horizon = ctx.currentTime + 0.15
    if (this.nextTime < ctx.currentTime - 0.3) this.nextTime = ctx.currentTime + 0.02
    while (this.nextTime < horizon) {
      // Switch on the next bar line (or immediately into silence/drop).
      if (this.pending !== null && this.nextTime >= this.pendingAt && (this.stepIdx === 0 || this.pending === 'drop' || this.pending === 'silent' || this.song === 'silent' || this.song === 'drop')) {
        this.song = this.pending
        this.pending = null
        this.stepIdx = 0
        this.bar = 0
      }
      const s = this.song
      const bpm = s === 'silent' ? 120 : SONGS[s].bpm
      const stepDur = 60 / bpm / 4
      if (s !== 'silent') SONGS[s].step(this.bus, this.nextTime, this.stepIdx, this.bar)
      this.nextTime += stepDur
      this.stepIdx++
      if (this.stepIdx >= 16) {
        this.stepIdx = 0
        this.bar++
      }
    }
  }
}
