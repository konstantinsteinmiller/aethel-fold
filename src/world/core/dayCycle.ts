import { Color, type FogExp2, type HemisphereLight, type Mesh, type ShaderMaterial, Vector3 } from 'three'
import { C } from '../art/palette'
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

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Scratch. Module level — the update path allocates nothing (GDD §5.2). */
const _sun = new Vector3()
const _color = new Color()
const _zenith = new Color()
const _horizon = new Color()

export class DayCycle {
  /** Time of day in `[0,1)`. 0 is midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. */
  time: number

  /** Multiplies the passage of time. 0 freezes the sky; useful for screenshots. */
  timeScale = 1

  /** Diagnostics for the perf panel. */
  readonly stats = {
    /** Hours, 0–24, for a HUD that wants to say "06:32". */
    hour: 0,
    sunElevation: 0,
    sunIntensity: 0,
    shadowsEnabled: true
  }

  private readonly dayLength: number
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
      fillIntensityNight = 0.3
    } = options

    this.targets = targets
    this.dayLength = dayLengthSeconds
    this.tilt = tilt
    this.sunIntensity = sunIntensity
    this.moonIntensity = moonIntensity
    this.fillDay = fillIntensityDay
    this.fillNight = fillIntensityNight
    this.time = startTime - Math.floor(startTime)

    this.apply()
  }

  /** Real seconds per in-game day. */
  get dayLengthSeconds(): number {
    return this.dayLength
  }

  /** Jumps to a time of day, 0–1. For the debug panel and for tests. */
  setTime(time: number): void {
    this.time = time - Math.floor(time)
    this.apply()
  }

  update(delta: number): void {
    if (this.timeScale === 0) {
      return
    }
    this.time += (delta * this.timeScale) / this.dayLength
    this.time -= Math.floor(this.time)
    this.apply()
  }

  /**
   * Direction the light travels *from*, i.e. toward the sun.
   *
   * Below the horizon this is the **moon**: the vector is flipped rather than a
   * second light being added, so night keeps one directional light and one
   * shadow pass. Two lights would double the shadow cost of a scene that is
   * already spending two thirds of its draw calls on shadows.
   */
  private computeLight(): { elevation: number; isNight: boolean } {
    const angle = (this.time - 0.25) * TAU
    const sin = Math.sin(angle)
    const cos = Math.cos(angle)
    _sun.set(cos, sin * Math.cos(this.tilt), sin * Math.sin(this.tilt)).normalize()

    const elevation = _sun.y
    const isNight = elevation < NIGHT_SHADOW_CUTOFF
    if (isNight) {
      _sun.negate()
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

    cascades.setDirection(_sun)

    if (isNight) {
      _color.copy(C.moon)
      // Ramped by how far below the horizon, so moonlight fades in rather than
      // switching on the instant the sun clears the other way.
      const night = smoothstep(-0.04, -0.16, elevation)
      cascades.setIntensity(this.moonIntensity * night)
    } else {
      _color.copy(C.sun).lerp(C.sunLow, warm)
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

    // Fog tracks the horizon — aerial perspective is the sky seen through air,
    // so a fog colour that disagrees with the horizon is the fastest way to
    // make distance read as haze pasted over the world.
    fog.color.copy(C.fogNight).lerp(C.fog, day).lerp(C.fogWarm, golden * 0.8)

    this.stats.hour = this.time * 24
    this.stats.sunElevation = elevation
    this.stats.sunIntensity = isNight ? this.moonIntensity : this.sunIntensity * day
    this.stats.shadowsEnabled = this.shadowsEnabled
  }
}
