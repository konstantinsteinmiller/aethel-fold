import { Color, type FogExp2, type HemisphereLight, type Mesh, type ShaderMaterial, Vector3 } from 'three'
import { C } from '../art/palette'
import { applyCloudLighting, type CloudUniforms } from './clouds'
import type { ShadowCascades } from './shadows'

/**
 * ─── Day and night ──────────────────────────────────────────────────────────
 *
 * One in-game day in 24 real minutes, with a sun that rises in the east, arcs
 * over and sets in the west, dragging the shadows, the sky, the fog and the
 * ambient with it.
 *
 * ── Everything it touches is a uniform ──────────────────────────────────────
 *
 * That is the whole performance story, and it was the first thing checked
 * rather than the last. The sun's colour and intensity are light properties;
 * the sky is a `ShaderMaterial` with `uZenith`/`uHorizon`; fog is a colour on
 * the scene; the cascades already re-fit every frame regardless. So a full
 * cycle costs **about a dozen float writes per update and zero rebuilds** —
 * no shader recompiles, no geometry regenerated, no vertex colours repainted.
 *
 * That is not a given. The palette's *surface* colours are baked into vertex
 * attributes at generation time, so tinting the world by rewriting them would
 * mean regenerating every asset four times a minute. The cycle deliberately
 * only moves things that live in the lighting rig.
 *
 * ── Where the real saving is ────────────────────────────────────────────────
 *
 * Not in the update. Half of every cycle is night, and a night shadow map is
 * three cascades of draw calls rendering shadows nobody can see: moonlight at
 * this intensity produces contact darkening the toon ramp cannot even band.
 * So the shadow pass is **switched off below the horizon** and back on at
 * first light, which is worth roughly a third of the frame's draw calls for
 * half the day. See `NIGHT_SHADOW_CUTOFF`.
 *
 * ── The sun does not pass overhead ──────────────────────────────────────────
 *
 * Its arc is tilted, so noon puts the sun at ~69° rather than straight up. A
 * sun at the zenith casts every shadow directly under its object, which reads
 * as no shadows at all for the part of the day the player is most likely to be
 * outside in.
 *
 * ─── The public API, for whoever is scripting a scene ───────────────────────
 *
 * This is a contract: `src/world/story/` drives it to force the right sun for a
 * beat, and the perf panel scrubs it. Nothing here allocates.
 *
 * **State you may read every frame**
 *
 * | Member | Meaning |
 * |---|---|
 * | `time` | 0–1, wrapped. 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. |
 * | `timeScale` | Multiplies normal advance. **0 freezes the sky**; `blendTo` still runs. |
 * | `moonAge` | 0–1 through the lunar month. 0 new, 0.5 full. See below. |
 * | `sunDirection` | Unit vector *toward the true sun*, pointing **down at night**. |
 * | `moonDirection` | Unit vector toward the moon. Down while the moon is set. |
 * | `sunColor` | The sun's live colour: `C.sun` warmed toward `C.sunLow` at the horizon. Valid at night too, where it is what the moon is being lit *by*. |
 * | `stats` | Diagnostics — `hour`, `sunElevation`, `moonElevation`, `daylight`, `sunIntensity`, `shadowsEnabled`. |
 * | `blending` | True while a `blendTo` is in flight. |
 * | `blendRemainingSeconds` | Real seconds left of it; 0 when idle. |
 *
 * `sunDirection`, `moonDirection` and `sunColor` are **live objects rewritten in
 * place** on every `apply()` — read them, never keep them. Copy if you need to
 * hold a value across frames.
 *
 * **Commands**
 *
 * - `setTime(t)` — instant jump. Wraps. Non-finite input is ignored (the sky
 *   keeps the time it had) rather than poisoning every downstream comparison.
 *   Cancels any blend in flight.
 * - `blendTo(target, seconds)` — drives `time` to `target` over `seconds` of
 *   **real** time, the shorter way round the clock, easing in and out, then
 *   releases back to normal advance. While it runs it *owns* the clock: normal
 *   advance is suspended, and `timeScale` is ignored — so a chapter that has
 *   frozen the sky (`timeScale = 0`) can still slide it from afternoon to dusk
 *   for a beat and have it stay put afterwards. `seconds <= 0` or a non-finite
 *   argument degrades to `setTime(target)`. Calling it again replaces the blend
 *   in flight; the new one starts from wherever the old one had reached.
 * - `cancelBlend()` — drops the blend where it stands. `time` keeps its current
 *   value and normal advance resumes on the next `update`.
 * - `setMoonAge(age)` — wraps and applies immediately.
 * - `update(delta)` — advance by `delta` real seconds. Services the blend first.
 *
 * Freezing is `timeScale = 0`; restoring is `timeScale = 1`. There is
 * deliberately no `pause()`/`resume()` pair on top of it, because two ways to
 * say the same thing is how one of them ends up stale.
 *
 * ── The moon is not simply the anti-sun ─────────────────────────────────────
 *
 * The *light* still is — see `computeLight` — but the **body** rides its own,
 * slower arc, lagging the sun by `moonAge` of a full turn. That lag is the
 * whole reason the moon has a phase at all: a body pinned exactly opposite the
 * sun is full every single night, and `celestials.ts` derives its lit fraction
 * from the real geometry rather than from a phase parameter, so an anti-solar
 * moon would produce one shape forever. At `moonAge` 0 the moon sits *on* the
 * sun and is new; at 0.5 it is opposite and full.
 */

export interface DayCycleOptions {
  /** Real seconds per in-game day. 24 minutes by default. */
  dayLengthSeconds?: number
  /** Starting time of day, 0–1. 0 is midnight, 0.5 is noon. */
  startTime?: number
  /** Tilt of the sun's arc, radians. 0 would pass straight overhead. */
  tilt?: number
  /** Peak sun intensity, at noon. */
  sunIntensity?: number
  /** Moonlight intensity, at its peak. */
  moonIntensity?: number
  fillIntensityDay?: number
  fillIntensityNight?: number
  /** Where the moon starts in its month. 0 new, 0.5 full. */
  startMoonAge?: number
  /** In-game days per lunar month. See `LUNAR_MONTH_DAYS`. */
  lunarMonthDays?: number
}

export interface DayCycleTargets {
  cascades: ShadowCascades
  fill: HemisphereLight
  fog: FogExp2
  sky: Mesh
}

/**
 * Sun elevation below which the shadow pass is switched off.
 *
 * Slightly *below* the horizon rather than at it, so shadows are already
 * running by the time the first warm light lands on anything — switching them
 * on at exactly 0 makes the world's shadows appear in one frame at sunrise,
 * which is far more visible than the shadows themselves.
 */
const NIGHT_SHADOW_CUTOFF = -0.04

const TAU = Math.PI * 2

/**
 * In-game days in a lunar month.
 *
 * **Eight, not 29.53.** A day here is 24 real minutes, so an honest synodic
 * month is close to twelve hours of play — the moon would be the same shape
 * every session anybody actually has, which is the *always full* failure with
 * extra arithmetic. At eight the phase moves about a third per real hour: a
 * long session sees the moon change, two sessions a week apart see different
 * moons, and no two consecutive nights look alike.
 *
 * The price is honest and stated here rather than discovered: the moon now
 * rises three in-game hours later each day, so on the nights around a new moon
 * the sky has no moon in it at all. That is what the real one does; it is only
 * surprising at this speed.
 */
const LUNAR_MONTH_DAYS = 8

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Scratch. Module level — the update path allocates nothing (GDD §5.2).
 *
 * `_light` is the vector handed to the cascades: the sun's, flipped below the
 * horizon. It is a *copy* of `sunDirection` rather than `sunDirection` itself
 * because the sun disc has to keep pointing at the real sun while the light
 * points at the moon — before `celestials.ts` existed there was only ever one
 * consumer and the negation could happen in place.
 */
const _light = new Vector3()
const _color = new Color()
const _zenith = new Color()
const _horizon = new Color()

export class DayCycle {
  /** Time of day in `[0,1)`. 0 is midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. */
  time: number

  /** Multiplies the passage of time. 0 freezes the sky; useful for screenshots. */
  timeScale = 1

  /**
   * Where the moon is in its month. 0 is new, 0.5 full. Advanced by `update`.
   *
   * Read freely; write through `setMoonAge`, which wraps it and re-applies —
   * assigning the field leaves the sky showing last frame's moon until
   * something else calls `apply`.
   */
  moonAge: number

  /**
   * Unit vector toward the **true sun**, which points *below the horizon at
   * night*. Not the light direction — see `computeLight`.
   *
   * Live: rewritten in place on every `apply()`. Copy it if you need to keep it.
   */
  readonly sunDirection = new Vector3()

  /** Unit vector toward the moon. Live, same caveat as `sunDirection`. */
  readonly moonDirection = new Vector3()

  /**
   * The sun's own colour right now — `C.sun` lerped toward `C.sunLow` by how
   * near the horizon it is.
   *
   * Maintained at night as well, when the *light* has become the moon's, because
   * this is also what the moon is lit by: a moon shaded with moonlight would be
   * lit by itself. Live, same caveat as `sunDirection`.
   */
  readonly sunColor = new Color()

  /** Diagnostics for the perf panel. */
  readonly stats = {
    /** Hours, 0–24, for a HUD that wants to say "06:32". */
    hour: 0,
    sunElevation: 0,
    moonElevation: 0,
    /** 0 fully night, 1 fully day — the same ramp the sky and fog blend on. */
    daylight: 0,
    sunIntensity: 0,
    shadowsEnabled: true
  }

  private readonly dayLength: number
  private readonly lunarMonth: number
  // ── Blend state ──────────────────────────────────────────────────────────
  //
  // Four numbers rather than a nullable object, so starting a blend allocates
  // nothing and `update` can test one of them. `blendDuration > 0` *is* the
  // "a blend is running" flag.
  private blendDuration = 0
  private blendElapsed = 0
  private blendFrom = 0
  private blendSpan = 0
  private readonly tilt: number
  private readonly sunIntensity: number
  private readonly moonIntensity: number
  private readonly fillDay: number
  private readonly fillNight: number
  private readonly targets: DayCycleTargets
  private shadowsEnabled = true

  constructor(targets: DayCycleTargets, options: DayCycleOptions = {}) {
    const {
      dayLengthSeconds = 24 * 60,
      startTime = 0.3,
      tilt = 0.36,
      sunIntensity = 2.15,
      moonIntensity = 0.28,
      fillIntensityDay = 0.85,
      fillIntensityNight = 0.3,
      // A waxing gibbous on the first night: the moon is up and obviously *not*
      // a disc, so the phase is visible from the first evening a player sees.
      // Starting at 0.5 would hide the whole feature behind a full moon that
      // looks exactly like the flat disc it replaced.
      startMoonAge = 0.34,
      lunarMonthDays = LUNAR_MONTH_DAYS
    } = options

    this.targets = targets
    this.dayLength = dayLengthSeconds
    this.tilt = tilt
    this.sunIntensity = sunIntensity
    this.moonIntensity = moonIntensity
    this.fillDay = fillIntensityDay
    this.fillNight = fillIntensityNight
    // Guarded at the door rather than at every use. A NaN start time would make
    // every `elevation < cutoff` comparison false — shadows on, at midnight,
    // with no error anywhere (CLAUDE.md: comparisons against NaN are all false).
    this.time = Number.isFinite(startTime) ? startTime - Math.floor(startTime) : 0
    this.moonAge = Number.isFinite(startMoonAge) ? startMoonAge - Math.floor(startMoonAge) : 0
    // A zero-length month would divide by zero into the moon's arc angle and
    // put the body at NaN, which three silently renders as nothing at all.
    this.lunarMonth = Number.isFinite(lunarMonthDays) && lunarMonthDays > 0 ? lunarMonthDays : LUNAR_MONTH_DAYS

    this.apply()
  }

  /** Real seconds per in-game day. */
  get dayLengthSeconds(): number {
    return this.dayLength
  }

  /** True while a `blendTo` is in flight. */
  get blending(): boolean {
    return this.blendDuration > 0
  }

  /** Real seconds left of the blend in flight, or 0. */
  get blendRemainingSeconds(): number {
    return this.blendDuration > 0 ? this.blendDuration - this.blendElapsed : 0
  }

  /**
   * Jumps to a time of day, 0–1. For the debug panel, for tests, and for a
   * chapter that opens at a stated hour.
   *
   * Cancels a blend in flight — a jump and a slide are two answers to the same
   * question, and the last one asked wins.
   */
  setTime(time: number): void {
    if (!Number.isFinite(time)) {
      return
    }
    this.blendDuration = 0
    this.time = time - Math.floor(time)
    this.apply()
  }

  /**
   * Slides the clock to `time` over `seconds` of **real** time, the shorter way
   * round.
   *
   * ── Why the shorter way ───────────────────────────────────────────────────
   *
   * A beat that ends at dusk and the next that opens at first light is a blend
   * from 0.95 to 0.05, and the naïve `target - current` runs it *backwards*
   * through the whole afternoon: the sun climbs back over the sky, the shadow
   * pass switches on, everything goes gold and then blue again. Taking the
   * signed distance modulo one turn makes that 0.1 forward through midnight,
   * which is both shorter and the direction the world is supposed to move.
   *
   * Exactly antipodal targets (a span of ±0.5, dawn to dusk) are ambiguous and
   * resolve backwards, because `Math.round` breaks its own tie upward. Any
   * chapter that cares should ask for 0.49 or 0.51.
   *
   * ── Why it ignores `timeScale` ────────────────────────────────────────────
   *
   * The caller who freezes the sky (`timeScale = 0`, which is what story mode
   * does at boot) is exactly the caller who then wants to move it deliberately.
   * Scaling the blend by the thing that stopped the clock would make every such
   * blend a no-op that never completes. `seconds` is therefore wall time, and
   * the blend runs whatever `timeScale` says.
   */
  blendTo(time: number, seconds: number): void {
    if (!Number.isFinite(time)) {
      return
    }
    const target = time - Math.floor(time)
    if (!Number.isFinite(seconds) || seconds <= 0) {
      this.setTime(target)
      return
    }
    // Signed distance on a circle of circumference 1, folded into (−0.5, 0.5].
    let span = target - this.time
    span -= Math.round(span)
    this.blendFrom = this.time
    this.blendSpan = span
    this.blendDuration = seconds
    this.blendElapsed = 0
  }

  /** Drops a blend where it stands. `time` keeps whatever it had reached. */
  cancelBlend(): void {
    this.blendDuration = 0
  }

  /** Sets the phase of the moon. 0 new, 0.5 full. Wraps, and applies at once. */
  setMoonAge(age: number): void {
    if (!Number.isFinite(age)) {
      return
    }
    this.moonAge = age - Math.floor(age)
    this.apply()
  }

  update(delta: number): void {
    if (!Number.isFinite(delta)) {
      return
    }

    // ── The blend owns the clock while it runs ───────────────────────────────
    //
    // Before the `timeScale` gate, deliberately: see `blendTo`. Normal advance
    // is suspended for the duration rather than added on top, or a blend into a
    // moving sky would arrive somewhere other than where it was aimed.
    if (this.blendDuration > 0) {
      this.blendElapsed = Math.min(this.blendDuration, this.blendElapsed + Math.max(0, delta))
      const t = this.blendFrom + this.blendSpan * smoothstep(0, 1, this.blendElapsed / this.blendDuration)
      this.time = t - Math.floor(t)
      if (this.blendElapsed >= this.blendDuration) {
        this.blendDuration = 0
      }
      this.apply()
      return
    }

    if (this.timeScale === 0) {
      return
    }
    const days = (delta * this.timeScale) / this.dayLength
    this.time += days
    this.time -= Math.floor(this.time)
    // The moon only ages on *normal* advance. A `setTime` is a cut to another
    // hour of the same night and a `blendTo` is the camera holding on one, and
    // neither is a claim about how much of the month has gone by — a chapter
    // that cuts between six beats would otherwise walk the moon through half a
    // month while the script says it is still the same evening.
    this.moonAge += days / this.lunarMonth
    this.moonAge -= Math.floor(this.moonAge)
    this.apply()
  }

  /**
   * Places both bodies and works out the direction the light travels *from*,
   * i.e. toward the sun.
   *
   * Below the horizon that is the **moon**: the vector is flipped rather than a
   * second light being added, so night keeps one directional light and one
   * shadow pass. Two lights would double the shadow cost of a scene that is
   * already spending two thirds of its draw calls on shadows.
   *
   * ── The flip is in `_light`, not in `sunDirection` ──────────────────────────
   *
   * It used to be in place, and there was nothing wrong with that while the
   * only consumer was the rig. `celestials.ts` needs the *un*flipped vector:
   * the sun disc has to set in the west rather than teleport to the east at
   * dusk, and the moon's phase is `dot(surfaceNormal, sunDirection)` — fed the
   * flipped vector it would show a full moon at new and a new moon at full,
   * which is the kind of bug that looks like art direction.
   *
   * ── The moonlight and the moon disagree, on purpose ────────────────────────
   *
   * The light stays exactly anti-solar; the body lags by `moonAge` of a turn
   * (see the header). So on a waxing night the moonlight arrives from a
   * different quarter of the sky than the moon is in. Two reasons that is the
   * right trade and not an oversight: the shadow pass is *off* below the
   * horizon, so there is no cast shadow pointing the wrong way to give it away,
   * and the alternative — pointing the light at the body — would put the key
   * light near the horizon or under it on half the nights, which is a black
   * screen rather than a stylised night.
   */
  private computeLight(): { elevation: number; isNight: boolean } {
    const angle = (this.time - 0.25) * TAU
    const sin = Math.sin(angle)
    const cos = Math.cos(angle)
    const tiltCos = Math.cos(this.tilt)
    const tiltSin = Math.sin(this.tilt)
    this.sunDirection.set(cos, sin * tiltCos, sin * tiltSin).normalize()

    // The moon runs the same arc, `moonAge` of a turn behind — behind rather
    // than ahead because the sky angle increases westward, so lagging it is
    // what makes the moon rise *later* each night, as it does.
    const moonAngle = angle - this.moonAge * TAU
    const moonSin = Math.sin(moonAngle)
    this.moonDirection.set(Math.cos(moonAngle), moonSin * tiltCos, moonSin * tiltSin).normalize()

    const elevation = this.sunDirection.y
    const isNight = elevation < NIGHT_SHADOW_CUTOFF
    _light.copy(this.sunDirection)
    if (isNight) {
      _light.negate()
    }
    return { elevation, isNight }
  }

  private apply(): void {
    const { elevation, isNight } = this.computeLight()
    const { cascades, fill, fog, sky } = this.targets

    // How far above the horizon, shaped. Full daylight is reached a little way
    // up rather than at 0, which is what gives sunrise its length.
    const day = smoothstep(-0.04, 0.22, elevation)
    // Warmth peaks at the horizon and is gone by mid-morning.
    const warm = 1 - smoothstep(0.02, 0.3, elevation)
    // The golden band only exists while the sun is *near* the horizon, from
    // either side — it has to fade back out at night, not stay lit.
    const golden = warm * smoothstep(-0.18, 0.02, elevation)

    cascades.setDirection(_light)

    // The sun's own colour, kept even after the rig has switched to moonlight —
    // it is what the moon disc is lit *by*, and it is the same one lerp the
    // key light does below, so the disc and the light can never drift apart.
    this.sunColor.copy(C.sun).lerp(C.sunLow, warm)

    if (isNight) {
      _color.copy(C.moon)
      // Ramped by how far below the horizon, so moonlight fades in rather than
      // switching on the instant the sun clears the other way.
      const night = smoothstep(-0.04, -0.16, elevation)
      cascades.setIntensity(this.moonIntensity * night)
    } else {
      // Exactly the disc's colour, because it is the same object's worth of
      // arithmetic done once above rather than twice with a chance to diverge.
      _color.copy(this.sunColor)
      cascades.setIntensity(this.sunIntensity * day)
    }
    cascades.setColor(_color)

    // ── The saving ─────────────────────────────────────────────────────────
    //
    // Toggled, not tapered: a shadow pass either runs or it does not, and at
    // moonlight intensity the result is below what the toon ramp can band.
    const wantShadows = elevation >= NIGHT_SHADOW_CUTOFF
    if (wantShadows !== this.shadowsEnabled) {
      this.shadowsEnabled = wantShadows
      cascades.setShadowsEnabled(wantShadows)
    }

    // Hemisphere fill. Night keeps a floor under it — a world lit only by a
    // dim moon is a black screen, and this is a stylised world, not a
    // simulation of being unable to see.
    fill.intensity = this.fillNight + (this.fillDay - this.fillNight) * day
    fill.color.copy(C.hemiSkyNight).lerp(C.hemiSky, day)
    fill.groundColor.copy(C.hemiGroundNight).lerp(C.hemiGround, day)

    // Sky: night → day, then the warm band pushed in on top. Two lerps rather
    // than a three-way blend because the golden hour is an *addition* to
    // whatever the sky is doing, not a third state it passes through.
    _zenith.copy(C.skyZenithNight).lerp(C.skyZenith, day).lerp(C.skyZenithWarm, golden * 0.75)
    _horizon.copy(C.skyHorizonNight).lerp(C.skyHorizon, day).lerp(C.skyHorizonWarm, golden)

    const material = sky.material as ShaderMaterial
    ;(material.uniforms.uZenith!.value as Color).copy(_zenith)
    ;(material.uniforms.uHorizon!.value as Color).copy(_horizon)

    // ── The clouds are lit by the same three numbers ───────────────────────
    //
    // `day` and `golden` are already shaped for the sky above, and handing the
    // clouds the *same* two is the whole point: a second copy of this ramp is a
    // second thing to re-tune, and the failure it produces is a cloud lit for a
    // different hour than the sky behind it — which reads as the cloud not
    // being in the sky at all.
    //
    // Guarded on the uniform existing rather than on a flag, because a sky
    // without clouds is a real configuration: `dayCycle.test.ts` builds a
    // material carrying only `uZenith` and `uHorizon`, and the character
    // creator's dome is 60 m across with no weather in it.
    if (material.uniforms.uCloudLit) {
      applyCloudLighting(material.uniforms as unknown as CloudUniforms, day, golden, this.sunDirection)
    }

    // Fog tracks the horizon — aerial perspective is the sky seen through air,
    // so a fog colour that disagrees with the horizon is the fastest way to
    // make distance read as haze pasted over the world.
    fog.color.copy(C.fogNight).lerp(C.fog, day).lerp(C.fogWarm, golden * 0.8)

    this.stats.hour = this.time * 24
    this.stats.sunElevation = elevation
    this.stats.moonElevation = this.moonDirection.y
    this.stats.daylight = day
    this.stats.sunIntensity = isNight ? this.moonIntensity : this.sunIntensity * day
    this.stats.shadowsEnabled = this.shadowsEnabled
  }
}
