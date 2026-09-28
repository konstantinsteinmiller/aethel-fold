import { describe, expect, it } from 'vitest'
import { Color, FogExp2, HemisphereLight, Mesh, ShaderMaterial } from 'three'
import { DayCycle } from '@/world/core/dayCycle'
import type { ShadowCascades } from '@/world/core/shadows'
import { CHAPTER_ONE } from '@/world/story/chapter1'
import { CHAPTER_TWO } from '@/world/story/chapter2'
import { beatIndex, STORY_BEATS, timeAtBeat } from '@/world/story/chapters'

/**
 * ─── The chapter's lighting script, as a contract ───────────────────────────
 *
 * The story drives the sun. `World` freezes the cycle in story mode — its
 * comment records the session that rolled from 0.58 to 0.84 while the player was
 * still setting the trap — and from then on a beat's `time` is the only thing
 * that moves it. That makes the beat list a *lighting script*, and this suite
 * treats it as one.
 *
 * ── Why this is worth a suite at all ────────────────────────────────────────
 *
 * Because every failure mode here is silent in the ways this project has learned
 * to distrust. A beat that names 1.3 does not throw — `DayCycle.setTime` wraps
 * it, and the scene is simply lit at the wrong hour. A beat that names a time
 * two beats too late is a scene that plays out at noon and then jumps to dusk
 * for its reaction shot. Nothing typechecks differently, no budget moves, and
 * the only symptom is a chapter that reads oddly to somebody who does not know
 * why. That is the same shape as the four defects listed in `CLAUDE.md`.
 *
 * ── What this cannot test ───────────────────────────────────────────────────
 *
 * Whether the light *looks* right. Whether 0.745 puts the sun on the rim of the
 * hills behind Nimmerschein rather than behind the palisade is a question for a
 * browser and an eye, and it is answered there.
 */
describe('the chapter drives the sun', () => {
  const timed = STORY_BEATS.filter(beat => beat.time !== undefined)

  it('states a time on the first beat, so nothing is ever lit by a default', () => {
    // The inheritance rule walks backwards, so a story whose opening beat names
    // nothing would light its own first scene from whatever the cycle happened
    // to be constructed with. `frame-run-in` names 0.70 for exactly this reason.
    expect(STORY_BEATS[0]?.time).toBeDefined()
    expect(timeAtBeat(0)).toBe(STORY_BEATS[0]?.time)
  })

  it('keeps every stated time inside the clock', () => {
    // `setTime` wraps rather than throwing, so 1.05 is a perfectly quiet way to
    // light a scene at 1:12 in the morning.
    for (const beat of timed) {
      expect(beat.time, beat.id).toBeGreaterThanOrEqual(0)
      expect(beat.time, beat.id).toBeLessThan(1)
    }
  })

  it('never asks for a blend it cannot make sense of', () => {
    for (const beat of STORY_BEATS) {
      if (beat.timeBlend === undefined) {
        continue
      }
      // A blend on a beat that names no time is a line with no effect, and the
      // most likely reason for one is a `time` that was meant to be there.
      expect(beat.time, `${beat.id} blends toward nothing`).toBeDefined()
      expect(beat.timeBlend, beat.id).toBeGreaterThan(0)
      // Longer than the beat it is attached to and the player never sees it
      // finish. 30 s is already the longest scene in the chapter.
      expect(beat.timeBlend, beat.id).toBeLessThanOrEqual(30)
    }
  })

  /**
   * The one arithmetic trap in `DayCycle.blendTo`, pinned at the call site.
   *
   * A blend takes the shorter way round the clock, so a pair exactly half a day
   * apart is a coin toss — the chapter would slide forward through the night on
   * one build and backward through noon on the next, and both are legal. The
   * cycle's own author flagged it; this is the assertion that stops the chapter
   * from ever writing one.
   */
  it('never blends between two times half a day apart', () => {
    let previous = STORY_BEATS[0]?.time
    for (const beat of STORY_BEATS) {
      if (beat.time === undefined) {
        continue
      }
      if (beat.timeBlend !== undefined && previous !== undefined) {
        const apart = Math.abs(beat.time - previous)
        const shortest = Math.min(apart, 1 - apart)
        expect(Math.abs(shortest - 0.5), `${beat.id} is antipodal to the beat before it`).toBeGreaterThan(0.01)
      }
      previous = beat.time
    }
  })

  it('inherits the last stated time rather than reading a beat that states none', () => {
    // `ambush` states 0.66; `ambush-over` is the reaction shot in the same
    // meadow thirty seconds later and states nothing. Arriving at either — a
    // save, a retry, `__story.jumpTo` — must light the same meadow.
    const ambush = beatIndex('ambush')
    const over = beatIndex('ambush-over')
    expect(over).toBe(ambush + 1)
    expect(STORY_BEATS[over]?.time).toBeUndefined()
    expect(timeAtBeat(over)).toBe(0.66)
  })

  it('resolves a time for every beat in the story', () => {
    // Not a tautology: it fails the moment a chapter is prepended whose opening
    // beats state nothing, which is the one way the walk-back can run off the
    // front of the list.
    for (let i = 0; i < STORY_BEATS.length; i++) {
      expect(timeAtBeat(i), STORY_BEATS[i]?.id).toBeDefined()
    }
  })

  it('clamps a jump past the end of the story to the last stated time', () => {
    expect(timeAtBeat(STORY_BEATS.length + 50)).toBe(timeAtBeat(STORY_BEATS.length - 1))
  })

  /**
   * ── The arc, as the manuscript states it ─────────────────────────────────
   *
   * These are the four places the book says what time it is, and they are the
   * reason the numbers are the numbers. Pinned as *relations* rather than as
   * literals: re-timing the whole chapter half an hour later is a legitimate
   * edit and should not fail a suite, but re-timing the walk home to before the
   * hunt is not.
   */
  it('tells the story in the order the day goes', () => {
    const at = (id: string): number => {
      const time = timeAtBeat(beatIndex(id))
      expect(time, id).toBeDefined()
      return time as number
    }

    // The hunt is a morning. The trap, then the boar, then the butchering.
    expect(at('prologue')).toBeGreaterThan(0.25) // after sunrise
    expect(at('boar-loose')).toBeGreaterThan(at('prologue'))
    expect(at('haul')).toBeGreaterThan(at('boar-loose'))
    expect(at('haul')).toBeLessThan(0.5) // and still before noon

    // The walk home is the afternoon, and the ambush is late in it.
    expect(at('walk-to-river')).toBeGreaterThan(0.5)
    expect(at('ambush')).toBeGreaterThan(at('walk-to-river'))

    // "They agree to roast it that evening" — the sun is on the rim.
    expect(at('to-treff')).toBeGreaterThan(0.72)
    expect(at('to-treff')).toBeLessThan(0.78)

    // And Nidane is waiting in the doorway, which is a thing mothers do at dusk.
    expect(at('to-home')).toBeGreaterThan(0.75)
  })

  it('cuts between the two timeframes rather than dissolving', () => {
    // A cut across sixty years that blends its sky is a time-lapse: it says
    // "some hours later" over a line that means "long ago, and somewhere else".
    // Both crossings snap, and that is a deliberate property of the chapter.
    for (const id of ['prologue', 'epilogue']) {
      const beat = STORY_BEATS[beatIndex(id)]
      expect(beat?.time, id).toBeDefined()
      expect(beat?.timeBlend, `${id} must snap`).toBeUndefined()
    }
  })

  it('comes back from the story after dark', () => {
    // The frame act leaves the sun on the rim and the epilogue returns to full
    // dark: the whole evening went while the old man talked, and the window is
    // what tells the player so. If these two ever converge the scene loses the
    // only line it does not speak.
    const begun = timeAtBeat(beatIndex('frame-begin')) as number
    const back = timeAtBeat(beatIndex('epilogue')) as number
    expect(back).toBeGreaterThan(begun + 0.05)
  })

  it('plays chapter two at night, where the moon is the light', () => {
    for (const beat of CHAPTER_TWO) {
      if (beat.time === undefined) {
        continue
      }
      // Past sunset (0.75) and before sunrise (0.25) — i.e. genuinely dark, and
      // therefore below `NIGHT_SHADOW_CUTOFF` where the shadow pass is off.
      expect(beat.time > 0.8 || beat.time < 0.2, beat.id).toBe(true)
    }
    expect(CHAPTER_TWO[0]?.time).toBeDefined()
  })

  it('lights every chapter-one beat by day or dusk, never by moonlight', () => {
    // Chapter 1 ends at dusk and never runs into the night — a beat that did
    // would lose its shadow pass mid-scene, which is the one lighting change in
    // this project that is a step rather than a ramp.
    for (const beat of CHAPTER_ONE) {
      if (beat.time === undefined) {
        continue
      }
      expect(beat.time, beat.id).toBeGreaterThan(0.25)
      expect(beat.time, beat.id).toBeLessThan(0.85)
    }
  })
})

/**
 * ─── And the cycle actually goes where the chapter asks ─────────────────────
 *
 * The contract above is about the *script*. This is the one assertion that the
 * script and the machine agree: a beat's number, handed to the object the scene
 * hands it to, puts the sun where the beat meant.
 */
describe('the beat list against a real DayCycle', () => {
  /**
   * A cycle wired to real three.js targets, at one time of day.
   *
   * The same rig `dayCycle.test.ts` builds, and real objects rather than stubs
   * for the reason that file gives: the cycle's whole performance story is that
   * it only ever writes a light property or a uniform, and a stub cannot fail
   * when something starts writing geometry instead.
   */
  const cycleAt = (time: number): DayCycle => {
    const cascades = {
      setDirection: () => {},
      setColor: () => {},
      setIntensity: () => {},
      setShadowsEnabled: () => {}
    } as unknown as ShadowCascades
    const sky = new Mesh(
      undefined,
      new ShaderMaterial({
        uniforms: { uZenith: { value: new Color() }, uHorizon: { value: new Color() } }
      })
    )
    return new DayCycle(
      { cascades, fill: new HemisphereLight(0xffffff, 0xffffff, 1), fog: new FogExp2(0xffffff, 0.0085), sky },
      { startTime: time }
    )
  }

  it('puts the sun up for the hunt and down for the bandits', () => {
    const hunt = cycleAt(timeAtBeat(beatIndex('haul')) as number)
    expect(hunt.stats.sunElevation).toBeGreaterThan(0)

    const camp = cycleAt(timeAtBeat(beatIndex('b2-camp')) as number)
    expect(camp.stats.sunElevation).toBeLessThan(0)
    // And therefore with the shadow pass off — the saving `dayCycle.ts` exists
    // to take, and the reason Chapter 2 is cheap to draw.
    expect(camp.stats.shadowsEnabled).toBe(false)
  })

  it('has the sun near the horizon when the boar is carried in', () => {
    // "That evening." Low, but not yet set: the difference between a warm scene
    // and a dark one is about 0.02 here, which is why the beat says 0.745.
    const treff = cycleAt(timeAtBeat(beatIndex('to-treff')) as number)
    expect(treff.stats.sunElevation).toBeGreaterThan(0)
    expect(treff.stats.sunElevation).toBeLessThan(0.2)
  })
})
