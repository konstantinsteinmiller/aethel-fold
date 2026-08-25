import { describe, expect, it } from 'vitest'
import { Color, FogExp2, HemisphereLight, Mesh, ShaderMaterial } from 'three'
import { DayCycle } from '@/world/core/dayCycle'
import type { ShadowCascades } from '@/world/core/shadows'

/**
 * ─── The cycle, and what it must not cost ───────────────────────────────────
 *
 * Two kinds of assertion here, and the second matters as much as the first.
 *
 * **It has to look right**: the sun rises in the east and sets in the west,
 * light and shadow follow it, the horizon goes warm at dawn and dusk, and
 * night is dark without being black.
 *
 * **It has to stay cheap**: everything the cycle touches is a uniform or a
 * light property. The moment something in here starts rebuilding geometry or
 * repainting vertex colours, a 24-minute day becomes a 24-minute stutter — and
 * that regression is invisible in a screenshot, which is exactly why it is
 * pinned below rather than left to review.
 */

const rig = () => {
  const lights = [
    { color: new Color(), intensity: 0, castShadow: true },
    { color: new Color(), intensity: 0, castShadow: true }
  ]
  let direction = { x: 0, y: 0, z: 0 }
  const cascades = {
    setDirection: (d: { x: number; y: number; z: number }) => {
      direction = { x: d.x, y: d.y, z: d.z }
    },
    setColor: (c: Color) => lights.forEach(l => l.color.copy(c)),
    setIntensity: (v: number) => lights.forEach(l => (l.intensity = v)),
    setShadowsEnabled: (on: boolean) => lights.forEach(l => (l.castShadow = on))
  } as unknown as ShadowCascades

  const fill = new HemisphereLight(0xffffff, 0xffffff, 1)
  const fog = new FogExp2(0xffffff, 0.0085)
  const sky = new Mesh(
    undefined,
    new ShaderMaterial({
      uniforms: { uZenith: { value: new Color() }, uHorizon: { value: new Color() } }
    })
  )

  return {
    targets: { cascades, fill, fog, sky },
    lights,
    fill,
    fog,
    sky,
    get direction() {
      return direction
    }
  }
}

const skyColors = (harness: ReturnType<typeof rig>) => {
  const uniforms = (harness.sky.material as ShaderMaterial).uniforms
  return {
    zenith: uniforms.uZenith!.value as Color,
    horizon: uniforms.uHorizon!.value as Color
  }
}

describe('sun path', () => {
  it('runs a 24-minute day by default', () => {
    const harness = rig()
    const cycle = new DayCycle(harness.targets)
    expect(cycle.dayLengthSeconds).toBe(24 * 60)

    cycle.setTime(0)
    cycle.update(12 * 60)
    // Half a day of real time is half a day of game time.
    expect(cycle.time).toBeCloseTo(0.5, 5)
    expect(cycle.stats.hour).toBeCloseTo(12, 3)
  })

  it('rises in the east and sets in the west', () => {
    const harness = rig()
    const cycle = new DayCycle(harness.targets)

    cycle.setTime(0.25)
    const sunrise = { ...harness.direction }
    cycle.setTime(0.75)
    const sunset = { ...harness.direction }

    // Opposite sides of the sky on the east–west axis, both near the horizon.
    expect(sunrise.x).toBeGreaterThan(0.9)
    expect(sunset.x).toBeLessThan(-0.9)
    expect(Math.abs(sunrise.y)).toBeLessThan(0.1)
    expect(Math.abs(sunset.y)).toBeLessThan(0.1)
  })

  it('climbs high at noon without passing overhead', () => {
    const harness = rig()
    const cycle = new DayCycle(harness.targets)
    cycle.setTime(0.5)
    // High enough for short shadows, tilted enough that they still exist. A sun
    // at the zenith casts every shadow directly under its object, which reads
    // as no shadows at all.
    expect(cycle.stats.sunElevation).toBeGreaterThan(0.85)
    expect(cycle.stats.sunElevation).toBeLessThan(0.99)
  })

  it('puts the sun below the horizon at midnight', () => {
    const harness = rig()
    const cycle = new DayCycle(harness.targets)
    cycle.setTime(0)
    expect(cycle.stats.sunElevation).toBeLessThan(-0.85)
  })

  it('points the light at the moon once the sun is down', () => {
    // One directional light all cycle, flipped — not a second light. Two would
    // double the shadow cost of a scene already spending most of its draws on
    // shadows.
    const harness = rig()
    const cycle = new DayCycle(harness.targets)
    cycle.setTime(0)
    // The sun is far below; the light must still come from *above*.
    expect(harness.direction.y).toBeGreaterThan(0.5)
  })
})

describe('light and shadow follow the sun', () => {
  it('brightens from dawn to noon and dims to dusk', () => {
    const harness = rig()
    const cycle = new DayCycle(harness.targets)
    const at = (t: number) => {
      cycle.setTime(t)
      return harness.lights[0]!.intensity
    }
    const dawn = at(0.26)
    const noon = at(0.5)
    const dusk = at(0.74)
    expect(noon).toBeGreaterThan(dawn)
    expect(noon).toBeGreaterThan(dusk)
    expect(dawn).toBeGreaterThan(0)
  })

  it('warms the sun toward the horizon', () => {
    const harness = rig()
    const cycle = new DayCycle(harness.targets)
    cycle.setTime(0.5)
    const noon = harness.lights[0]!.color.clone()
    cycle.setTime(0.26)
    const low = harness.lights[0]!.color.clone()
    // Golden hour: redder and less blue than noon.
    expect(low.r / Math.max(low.b, 1e-4)).toBeGreaterThan(noon.r / Math.max(noon.b, 1e-4))
  })

  it('keeps every cascade at the same intensity', () => {
    // CSM splits one light into N. A cascade left behind shows up as a hard
    // brightness step sweeping across the world as the camera moves.
    const harness = rig()
    const cycle = new DayCycle(harness.targets)
    cycle.setTime(0.4)
    expect(harness.lights[0]!.intensity).toBe(harness.lights[1]!.intensity)
    expect(harness.lights[0]!.color.getHex()).toBe(harness.lights[1]!.color.getHex())
  })

  it('switches the shadow pass off at night and on by day', () => {
    // The whole performance case for the feature. Shadows are two thirds of
    // this scene's draw calls, and half of every cycle is night.
    const harness = rig()
    const cycle = new DayCycle(harness.targets)

    cycle.setTime(0.5)
    expect(harness.lights.every(l => l.castShadow)).toBe(true)
    expect(cycle.stats.shadowsEnabled).toBe(true)

    cycle.setTime(0)
    expect(harness.lights.every(l => l.castShadow)).toBe(false)
    expect(cycle.stats.shadowsEnabled).toBe(false)

    cycle.setTime(0.35)
    expect(harness.lights.every(l => l.castShadow)).toBe(true)
  })

  it('has shadows running before the first warm light lands', () => {
    // Switching them on at exactly the horizon makes every shadow in the world
    // appear in one frame, which is far more visible than the shadows are.
    const harness = rig()
    const cycle = new DayCycle(harness.targets)
    cycle.setTime(0.25)
    expect(cycle.stats.shadowsEnabled).toBe(true)
  })
})

describe('sky, fog and ambient', () => {
  it('darkens the sky at night without going black', () => {
    const harness = rig()
    const cycle = new DayCycle(harness.targets)
    cycle.setTime(0.5)
    const noon = skyColors(harness).zenith.clone()
    cycle.setTime(0)
    const night = skyColors(harness).zenith.clone()

    const luma = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
    expect(luma(night)).toBeLessThan(luma(noon) * 0.5)
    // A black zenith kills the silhouette of everything under it.
    expect(luma(night)).toBeGreaterThan(0.002)
  })

  it('warms the horizon at dawn and dusk, and only then', () => {
    const harness = rig()
    const cycle = new DayCycle(harness.targets)
    const warmth = (t: number) => {
      cycle.setTime(t)
      const h = skyColors(harness).horizon
      return h.r - h.b
    }
    const dawn = warmth(0.25)
    const noon = warmth(0.5)
    const midnight = warmth(0)
    expect(dawn).toBeGreaterThan(noon)
    expect(dawn).toBeGreaterThan(midnight)
  })

  it('keeps fog agreeing with the horizon', () => {
    // Aerial perspective is the sky seen through air. A fog colour that
    // disagrees with the horizon reads as haze pasted over the world.
    const harness = rig()
    const cycle = new DayCycle(harness.targets)
    for (const t of [0, 0.25, 0.5, 0.75]) {
      cycle.setTime(t)
      const horizon = skyColors(harness).horizon
      const fog = harness.fog.color
      const luma = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
      expect(Math.abs(luma(fog) - luma(horizon)), `t=${t}`).toBeLessThan(0.45)
    }
  })

  it('lowers the ambient at night but leaves a floor', () => {
    const harness = rig()
    const cycle = new DayCycle(harness.targets)
    cycle.setTime(0.5)
    const day = harness.fill.intensity
    cycle.setTime(0)
    const night = harness.fill.intensity
    expect(night).toBeLessThan(day)
    // Stylised world, not a simulation of being unable to see.
    expect(night).toBeGreaterThan(0.1)
  })
})

describe('cost', () => {
  it('allocates nothing on the update path', () => {
    // The cycle runs every frame forever. A `new Color()` in here is a garbage
    // collection every few seconds on the hottest loop in the game (GDD §5.2).
    const harness = rig()
    const cycle = new DayCycle(harness.targets)

    const zenithBefore = skyColors(harness).zenith
    const horizonBefore = skyColors(harness).horizon
    const fogBefore = harness.fog.color
    const colorBefore = harness.lights[0]!.color

    for (let i = 0; i < 400; i++) {
      cycle.update(1)
    }

    // Same objects, written in place — not replaced. A replaced uniform value
    // also breaks three's shared-uniform wiring.
    expect(skyColors(harness).zenith).toBe(zenithBefore)
    expect(skyColors(harness).horizon).toBe(horizonBefore)
    expect(harness.fog.color).toBe(fogBefore)
    expect(harness.lights[0]!.color).toBe(colorBefore)
  })

  it('can be frozen for a screenshot', () => {
    const harness = rig()
    const cycle = new DayCycle(harness.targets)
    cycle.setTime(0.4)
    cycle.timeScale = 0
    cycle.update(600)
    expect(cycle.time).toBeCloseTo(0.4, 6)
  })

  it('wraps cleanly across midnight', () => {
    const harness = rig()
    const cycle = new DayCycle(harness.targets)
    cycle.setTime(0.99)
    cycle.update(24 * 60 * 0.02)
    expect(cycle.time).toBeGreaterThanOrEqual(0)
    expect(cycle.time).toBeLessThan(1)
  })
})
