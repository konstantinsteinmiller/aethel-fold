import { describe, expect, it } from 'vitest'
import { Color, FogExp2, HemisphereLight, Mesh, Quaternion, ShaderMaterial, Vector3 } from 'three'
import { Celestials } from '@/world/core/celestials'
import { DayCycle } from '@/world/core/dayCycle'
import type { ShadowCascades } from '@/world/core/shadows'
import { C } from '@/world/art/palette'

/**
 * ─── The sun and the moon ───────────────────────────────────────────────────
 *
 * `dayCycle.test.ts` already pins what the *light* does. This file pins the two
 * things that are now drawn, and it exists because all three of the failures it
 * guards against are silent:
 *
 * * a sun placed from the **flipped** light vector jumps back to the east at
 *   dusk and climbs again — the shadows would still be right, so nothing in the
 *   existing suite would notice;
 * * a moon pinned exactly opposite the sun is **full every single night**,
 *   which looks like a deliberate art choice rather than a missing term;
 * * a `blendTo` that takes the long way round runs the sun *backwards* over the
 *   whole afternoon to get from dusk to dawn, which is a five-second shot of
 *   the world un-setting.
 *
 * Everything here is pure arithmetic on vectors. The shaders are not executable
 * in a test, so what is asserted is the term they consume: the moon's phase is
 * `dot(surfaceNormal, sunDirection)`, and at the point of the sphere facing the
 * viewer that normal is `-moonDirection` — so the visible lit fraction is a
 * closed form, and it is checked against the geometry rather than against a
 * screenshot.
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
    get direction() {
      return direction
    }
  }
}

/**
 * Fraction of the moon's *visible* disc that is lit, from the same geometry the
 * shader uses.
 *
 * The viewer is at the origin, the moon at `moonDirection`, the sun at infinity
 * in `sunDirection`. The terminator crosses the visible hemisphere at
 * `dot(N, sun) = 0`, so the lit fraction of the disc is `(1 − m·s) / 2`: 1 when
 * the moon is opposite the sun (full), 0 when it sits on it (new).
 */
const litFraction = (moonDirection: Vector3, sunDirection: Vector3): number =>
  (1 - moonDirection.dot(sunDirection)) / 2

describe('where the sun actually is', () => {
  it('rises in the east at 0.25 and sets in the west at 0.75', () => {
    const cycle = new DayCycle(rig().targets)

    cycle.setTime(0.25)
    expect(cycle.sunDirection.x).toBeGreaterThan(0.99)
    expect(Math.abs(cycle.sunDirection.y)).toBeLessThan(0.02)

    cycle.setTime(0.75)
    expect(cycle.sunDirection.x).toBeLessThan(-0.99)
    expect(Math.abs(cycle.sunDirection.y)).toBeLessThan(0.02)
  })

  it('is highest at noon', () => {
    const cycle = new DayCycle(rig().targets)
    const elevationAt = (t: number) => {
      cycle.setTime(t)
      return cycle.sunDirection.y
    }
    const noon = elevationAt(0.5)
    expect(noon).toBeGreaterThan(elevationAt(0.4))
    expect(noon).toBeGreaterThan(elevationAt(0.6))
    // Tilted, so noon is ~69° and not the zenith — the reason shadows exist at
    // midday at all.
    expect(noon).toBeGreaterThan(0.85)
    expect(noon).toBeLessThan(0.99)
  })

  it('keeps pointing below the horizon at night while the light points up', () => {
    // The whole reason `sunDirection` was split out of the light vector. A sun
    // disc placed from the light would teleport across the sky at dusk.
    const harness = rig()
    const cycle = new DayCycle(harness.targets)
    cycle.setTime(0)
    expect(cycle.sunDirection.y).toBeLessThan(-0.85)
    expect(harness.direction.y).toBeGreaterThan(0.85)
    // Flipped, not recomputed: exactly antiparallel.
    expect(harness.direction.y).toBeCloseTo(-cycle.sunDirection.y, 12)
    expect(harness.direction.x).toBeCloseTo(-cycle.sunDirection.x, 12)
  })

  it('leaves the lighting untouched — same direction, colour and shadow state', () => {
    // The refactor that exposed the sun must not have moved the rig by a float.
    const harness = rig()
    const cycle = new DayCycle(harness.targets)
    for (const t of [0, 0.2, 0.25, 0.5, 0.62, 0.75, 0.9]) {
      cycle.setTime(t)
      const angle = (t - 0.25) * Math.PI * 2
      const expected = {
        x: Math.cos(angle),
        y: Math.sin(angle) * Math.cos(0.36),
        z: Math.sin(angle) * Math.sin(0.36)
      }
      const length = Math.hypot(expected.x, expected.y, expected.z)
      const night = expected.y / length < -0.04
      const sign = night ? -1 : 1
      expect(harness.direction.x, `t=${t}`).toBeCloseTo((sign * expected.x) / length, 12)
      expect(harness.direction.y, `t=${t}`).toBeCloseTo((sign * expected.y) / length, 12)
      expect(harness.direction.z, `t=${t}`).toBeCloseTo((sign * expected.z) / length, 12)
    }
  })

  it('warms the disc colour exactly as it warms the light', () => {
    const harness = rig()
    const cycle = new DayCycle(harness.targets)
    cycle.setTime(0.3)
    // By day the key light *is* the disc colour, to the last bit.
    expect(cycle.sunColor.getHex()).toBe(harness.lights[0]!.color.getHex())

    cycle.setTime(0.5)
    const noon = cycle.sunColor.clone()
    cycle.setTime(0.26)
    const low = cycle.sunColor.clone()
    expect(low.r / Math.max(low.b, 1e-4)).toBeGreaterThan(noon.r / Math.max(noon.b, 1e-4))

    // And it survives the night, because it is what lights the moon. A sun
    // colour that fell to moonlight after dusk would light the moon with itself.
    cycle.setTime(0)
    expect(cycle.sunColor.r + cycle.sunColor.g + cycle.sunColor.b).toBeGreaterThan(0.5)
  })
})

describe('the moon has a phase', () => {
  it('is new when it sits on the sun and full when it is opposite', () => {
    const cycle = new DayCycle(rig().targets)

    cycle.setMoonAge(0)
    cycle.setTime(0.4)
    expect(litFraction(cycle.moonDirection, cycle.sunDirection)).toBeCloseTo(0, 6)

    cycle.setMoonAge(0.5)
    expect(litFraction(cycle.moonDirection, cycle.sunDirection)).toBeCloseTo(1, 6)

    cycle.setMoonAge(0.25)
    expect(litFraction(cycle.moonDirection, cycle.sunDirection)).toBeCloseTo(0.5, 6)
  })

  it('holds its phase across the night, whatever the hour', () => {
    // The phase is set by where the moon is in its *month*, not by where the
    // pair happens to be in the sky — a moon that changed shape between dusk
    // and dawn would be the giveaway that the term is wrong.
    const cycle = new DayCycle(rig().targets)
    cycle.setMoonAge(0.34)
    const at = (t: number) => {
      cycle.setTime(t)
      return litFraction(cycle.moonDirection, cycle.sunDirection)
    }
    const dusk = at(0.78)
    expect(at(0.9)).toBeCloseTo(dusk, 6)
    expect(at(0.0)).toBeCloseTo(dusk, 6)
    expect(at(0.18)).toBeCloseTo(dusk, 6)
  })

  it('is not the anti-sun — the shape changes from night to night', () => {
    // If the moon were pinned opposite the sun this would be 1.0 forever.
    const cycle = new DayCycle(rig().targets, { startMoonAge: 0, startTime: 0 })
    const day = cycle.dayLengthSeconds
    const shapes: number[] = []
    for (let night = 0; night < 4; night++) {
      shapes.push(litFraction(cycle.moonDirection, cycle.sunDirection))
      cycle.update(day)
    }
    // Four consecutive midnights, four different moons.
    for (let i = 1; i < shapes.length; i++) {
      expect(Math.abs(shapes[i]! - shapes[i - 1]!), `night ${i}`).toBeGreaterThan(0.1)
    }
  })

  it('ages a full month over the month, and only on normal advance', () => {
    const cycle = new DayCycle(rig().targets, { startMoonAge: 0 })
    cycle.update(cycle.dayLengthSeconds * 8)
    expect(cycle.moonAge).toBeCloseTo(0, 6)

    // A cut to another hour is not a claim about the calendar: a chapter that
    // jumps between six beats of one evening must not walk the moon through
    // half a month while doing it.
    cycle.setMoonAge(0.2)
    cycle.setTime(0.8)
    cycle.setTime(0.1)
    cycle.blendTo(0.3, 5)
    cycle.update(5)
    expect(cycle.moonAge).toBeCloseTo(0.2, 6)
  })

  it('rises later each night, which is what gives it the phase', () => {
    const cycle = new DayCycle(rig().targets, { startMoonAge: 0.5 })
    cycle.setTime(0.75)
    const full = cycle.moonDirection.y
    // A full moon rises as the sun sets.
    expect(Math.abs(full)).toBeLessThan(0.05)

    cycle.setMoonAge(0.625)
    // An eighth of a turn later in the month is an eighth of a turn behind in
    // the sky, so at the same hour it has not risen yet.
    expect(cycle.moonDirection.y).toBeLessThan(-0.5)
  })
})

describe('blendTo takes the shorter way round the clock', () => {
  const samples = (from: number, to: number, seconds: number, steps: number, timeScale = 1) => {
    const cycle = new DayCycle(rig().targets)
    cycle.timeScale = timeScale
    cycle.setTime(from)
    cycle.blendTo(to, seconds)
    const out: number[] = []
    for (let i = 0; i < steps; i++) {
      cycle.update(seconds / steps)
      out.push(cycle.time)
    }
    return { cycle, out }
  }

  it('goes forward through midnight from 0.95 to 0.05', () => {
    const { cycle, out } = samples(0.95, 0.05, 10, 20)
    for (const t of out) {
      // Never anywhere near noon: the long way round would pass straight
      // through 0.5, re-lighting the whole world on the way.
      expect(t >= 0.94 || t <= 0.06, `sample ${t}`).toBe(true)
    }
    expect(cycle.time).toBeCloseTo(0.05, 6)
    expect(cycle.blending).toBe(false)
  })

  it('goes backward through midnight from 0.05 to 0.95', () => {
    const { cycle, out } = samples(0.05, 0.95, 10, 20)
    for (const t of out) {
      expect(t >= 0.94 || t <= 0.06, `sample ${t}`).toBe(true)
    }
    expect(cycle.time).toBeCloseTo(0.95, 6)
  })

  it('takes the direct route when it is already the short one', () => {
    const { cycle, out } = samples(0.3, 0.6, 8, 16)
    for (const t of out) {
      expect(t).toBeGreaterThanOrEqual(0.3 - 1e-9)
      expect(t).toBeLessThanOrEqual(0.6 + 1e-9)
    }
    // Monotone: no easing overshoot.
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!).toBeGreaterThanOrEqual(out[i - 1]! - 1e-9)
    }
    expect(cycle.time).toBeCloseTo(0.6, 6)
  })

  it('runs even with the sky frozen, and leaves it frozen there', () => {
    // Story mode boots with `timeScale = 0`. If the blend respected it, every
    // scripted sun move would be a no-op that never finishes.
    const { cycle } = samples(0.58, 0.8, 4, 8, 0)
    expect(cycle.time).toBeCloseTo(0.8, 6)
    cycle.update(600)
    expect(cycle.time).toBeCloseTo(0.8, 6)
  })

  it('releases back to normal advance when it finishes', () => {
    const { cycle } = samples(0.2, 0.3, 4, 8)
    expect(cycle.blending).toBe(false)
    cycle.update(cycle.dayLengthSeconds * 0.1)
    expect(cycle.time).toBeCloseTo(0.4, 5)
  })

  it('reports how long it has left', () => {
    const cycle = new DayCycle(rig().targets)
    cycle.setTime(0.1)
    expect(cycle.blendRemainingSeconds).toBe(0)
    cycle.blendTo(0.4, 10)
    expect(cycle.blending).toBe(true)
    cycle.update(4)
    expect(cycle.blendRemainingSeconds).toBeCloseTo(6, 6)
    cycle.update(6)
    expect(cycle.blendRemainingSeconds).toBe(0)
  })

  it('eases in and out rather than starting at full speed', () => {
    const { out } = samples(0, 0.4, 10, 10)
    // First tenth moves less than the middle tenth.
    expect(out[0]!).toBeLessThan(0.04 * 0.6)
    expect(out[5]! - out[4]!).toBeGreaterThan(out[0]!)
  })

  it('is cancelled by a jump and by cancelBlend', () => {
    const cycle = new DayCycle(rig().targets)
    cycle.setTime(0.2)
    cycle.blendTo(0.7, 10)
    cycle.setTime(0.9)
    expect(cycle.blending).toBe(false)
    cycle.update(1)
    // Normal advance from where the jump left it, not the blend resuming.
    expect(cycle.time).toBeGreaterThan(0.9)

    cycle.blendTo(0.1, 10)
    cycle.update(2)
    const held = cycle.time
    cycle.cancelBlend()
    expect(cycle.blending).toBe(false)
    cycle.timeScale = 0
    cycle.update(100)
    expect(cycle.time).toBe(held)
  })

  it('degrades to a jump for a zero or nonsense duration', () => {
    const cycle = new DayCycle(rig().targets)
    cycle.setTime(0.2)
    cycle.blendTo(0.6, 0)
    expect(cycle.time).toBeCloseTo(0.6, 9)
    expect(cycle.blending).toBe(false)
    cycle.blendTo(0.9, Number.NaN)
    expect(cycle.time).toBeCloseTo(0.9, 9)
  })
})

describe('nothing non-finite gets through', () => {
  // Comparisons against NaN are all false, so the obvious guards downstream
  // silently pass and the sky simply stops being drawn (CLAUDE.md).
  it('ignores a non-finite time, phase or delta', () => {
    const cycle = new DayCycle(rig().targets)
    cycle.setTime(0.42)

    cycle.setTime(Number.NaN)
    expect(cycle.time).toBeCloseTo(0.42, 9)
    cycle.blendTo(Number.POSITIVE_INFINITY, 5)
    expect(cycle.time).toBeCloseTo(0.42, 9)
    cycle.setMoonAge(Number.NaN)
    expect(Number.isFinite(cycle.moonAge)).toBe(true)
    cycle.update(Number.NaN)
    expect(cycle.time).toBeCloseTo(0.42, 9)

    expect(Number.isFinite(cycle.sunDirection.x + cycle.sunDirection.y + cycle.sunDirection.z)).toBe(true)
    expect(Number.isFinite(cycle.moonDirection.x + cycle.moonDirection.y + cycle.moonDirection.z)).toBe(true)
  })

  it('survives a non-finite start time and month', () => {
    const cycle = new DayCycle(rig().targets, {
      startTime: Number.NaN,
      startMoonAge: Number.NaN,
      lunarMonthDays: 0
    })
    expect(Number.isFinite(cycle.time)).toBe(true)
    cycle.update(cycle.dayLengthSeconds * 0.5)
    expect(Number.isFinite(cycle.moonAge)).toBe(true)
    expect(Number.isFinite(cycle.moonDirection.y)).toBe(true)
  })
})

describe('what the two bodies cost', () => {
  const bodies = (celestials: Celestials) => {
    const [sun, moon] = celestials.group.children as Mesh[]
    return { sun: sun!, moon: moon! }
  }

  it('is two meshes and nothing else', () => {
    // The budget is +2 draw calls and +2 programs. A separate glow mesh, a
    // second disc for the moon's dark side or a halo sprite would each be
    // another draw on a frame that is already at its ceiling in the village.
    const celestials = new Celestials()
    expect(celestials.group.children).toHaveLength(2)
    const { sun, moon } = bodies(celestials)
    for (const body of [sun, moon]) {
      expect(body.renderOrder).toBe(-999)
      expect(body.frustumCulled).toBe(false)
      expect(body.castShadow).toBe(false)
      expect(body.receiveShadow).toBe(false)
      const material = body.material as ShaderMaterial
      expect(material.depthWrite).toBe(false)
      expect(material.fog).toBe(false)
      expect(material.transparent).toBe(true)
    }
    // The dome is −1000, so both draw after the sky and before the world.
    expect(sun.renderOrder).toBeGreaterThan(-1000)
    celestials.dispose()
  })

  it('registers a perf tag on the root', () => {
    const celestials = new Celestials()
    expect(celestials.group.userData.perfTag).toBe('celestials')
    celestials.dispose()
  })

  it('draws neither of them when there is nothing to see', () => {
    const celestials = new Celestials()
    const cycle = new DayCycle(rig().targets, { startMoonAge: 0 })
    const { sun, moon } = bodies(celestials)

    // Noon: the sun is up, and the moon is both down and washed out.
    cycle.setTime(0.5)
    celestials.update(cycle, new Quaternion())
    expect(sun.visible).toBe(true)
    expect(moon.visible).toBe(false)

    // Midnight with a full moon: the sun is well down, the moon is up.
    cycle.setMoonAge(0.5)
    cycle.setTime(0)
    celestials.update(cycle, new Quaternion())
    expect(sun.visible).toBe(false)
    expect(moon.visible).toBe(true)

    // A new moon at midnight is on the far side of the world with the sun.
    cycle.setMoonAge(0)
    celestials.update(cycle, new Quaternion())
    expect(moon.visible).toBe(false)
    celestials.dispose()
  })
})

describe('where the bodies are put', () => {
  it('places both on the sky sphere, in the direction the cycle says', () => {
    const celestials = new Celestials()
    const cycle = new DayCycle(rig().targets, { startMoonAge: 0.5 })
    const [sun, moon] = celestials.group.children as Mesh[]

    cycle.setTime(0.3)
    celestials.update(cycle, new Quaternion())
    const radius = sun!.position.length()
    // Inside the 900 m dome, outside anything the terrain will ever build.
    expect(radius).toBeGreaterThan(700)
    expect(radius).toBeLessThan(900)
    // Same direction as the cycle's vector, to the float.
    expect(sun!.position.x / radius).toBeCloseTo(cycle.sunDirection.x, 6)
    expect(sun!.position.y / radius).toBeCloseTo(cycle.sunDirection.y, 6)

    cycle.setTime(0)
    celestials.update(cycle, new Quaternion())
    expect(moon!.position.length()).toBeCloseTo(radius, 6)
    expect(moon!.position.y / radius).toBeCloseTo(cycle.moonDirection.y, 6)
    celestials.dispose()
  })

  it('billboards the sun against the camera', () => {
    const celestials = new Celestials()
    const cycle = new DayCycle(rig().targets)
    const [sun] = celestials.group.children as Mesh[]
    const camera = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.1)

    cycle.setTime(0.5)
    celestials.update(cycle, camera)
    expect(sun!.quaternion.equals(camera)).toBe(true)
    celestials.dispose()
  })

  it('takes its colour from the cycle, never from a literal', () => {
    const celestials = new Celestials()
    const cycle = new DayCycle(rig().targets)
    const [sun] = celestials.group.children as Mesh[]
    const uniforms = ((sun!.material as ShaderMaterial).uniforms) as Record<string, { value: Color }>

    cycle.setTime(0.5)
    celestials.update(cycle, new Quaternion())
    expect(uniforms.uCore!.value.getHex()).toBe(cycle.sunColor.getHex())
    const noonHalo = uniforms.uHalo!.value.clone()

    cycle.setTime(0.26)
    celestials.update(cycle, new Quaternion())
    expect(uniforms.uCore!.value.getHex()).toBe(cycle.sunColor.getHex())
    // The halo warms with the disc rather than staying pale.
    const low = uniforms.uHalo!.value
    expect(low.r / Math.max(low.b, 1e-4)).toBeGreaterThan(noonHalo.r / Math.max(noonHalo.b, 1e-4))
    celestials.dispose()
  })

  it('lights the moon with the true sun and warms it at the horizon', () => {
    const celestials = new Celestials()
    const cycle = new DayCycle(rig().targets, { startMoonAge: 0.5 })
    const [, moon] = celestials.group.children as Mesh[]
    const uniforms = (moon!.material as ShaderMaterial).uniforms

    cycle.setTime(0)
    celestials.update(cycle, new Quaternion())
    const sunUniform = uniforms.uSunDirection!.value as Vector3
    // The *true* sun, pointing down at midnight — not the flipped light vector,
    // which would show a new moon where there is a full one.
    expect(sunUniform.y).toBeCloseTo(cycle.sunDirection.y, 9)
    expect(sunUniform.y).toBeLessThan(0)

    const high = (uniforms.uLit!.value as Color).clone()
    // The moon low over the horizon reddens like the sun does, for the same
    // reason and by less.
    cycle.setTime(0.75)
    celestials.update(cycle, new Quaternion())
    const low = uniforms.uLit!.value as Color
    expect(low.r / Math.max(low.b, 1e-4)).toBeGreaterThan(high.r / Math.max(high.b, 1e-4))
    // Never all the way to the sun's own orange — a moon that warm reads as a
    // second sun.
    expect(low.b).toBeGreaterThan(C.sunLow.b)
    celestials.dispose()
  })

  it('allocates nothing on the update path', () => {
    // Every frame, forever. A `new Color()` in here is a collection every few
    // seconds on the hottest loop in the game (GDD §5.2).
    const celestials = new Celestials()
    const cycle = new DayCycle(rig().targets, { startMoonAge: 0.5 })
    const [sun, moon] = celestials.group.children as Mesh[]
    const sunUniforms = (sun!.material as ShaderMaterial).uniforms
    const moonUniforms = (moon!.material as ShaderMaterial).uniforms

    const core = sunUniforms.uCore!.value
    const halo = sunUniforms.uHalo!.value
    const sunDirection = moonUniforms.uSunDirection!.value
    const lit = moonUniforms.uLit!.value
    const sunPosition = sun!.position

    const camera = new Quaternion()
    for (let i = 0; i < 400; i++) {
      cycle.update(3)
      celestials.update(cycle, camera)
    }

    // Written in place, not replaced — a replaced uniform value also breaks
    // three's shared-uniform wiring.
    expect(sunUniforms.uCore!.value).toBe(core)
    expect(sunUniforms.uHalo!.value).toBe(halo)
    expect(moonUniforms.uSunDirection!.value).toBe(sunDirection)
    expect(moonUniforms.uLit!.value).toBe(lit)
    expect(sun!.position).toBe(sunPosition)
    celestials.dispose()
  })

  it('hides both rather than drawing a NaN', () => {
    // three renders a body at an undefined position as nothing at all, with no
    // warning — so the gate is here, where it can be seen, rather than left to
    // a comparison that is silently false.
    const celestials = new Celestials()
    const [sun, moon] = celestials.group.children as Mesh[]
    sun!.visible = true
    moon!.visible = true
    celestials.update(
      {
        sunDirection: new Vector3(Number.NaN, 1, 0),
        moonDirection: new Vector3(0, -1, 0),
        sunColor: new Color(),
        stats: { daylight: 1 }
      },
      new Quaternion()
    )
    expect(sun!.visible).toBe(false)
    expect(moon!.visible).toBe(false)
    celestials.dispose()
  })
})
