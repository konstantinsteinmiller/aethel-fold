import { describe, expect, it } from 'vitest'
import {
  advanceClouds,
  CLOUD_FUNCTIONS_GLSL,
  CLOUD_LAYERS,
  CLOUD_UNIFORMS_GLSL,
  applyCloudLighting,
  cloudCoverageAt,
  createCloudUniforms
} from '@/world/core/clouds'
import { createSky } from '@/world/core/sky'
import { C } from '@/world/art/palette'
import type { ShaderMaterial } from 'three'

/**
 * ─── The sky's weather, as a contract ───────────────────────────────────────
 *
 * Clouds are drawn entirely in a fragment shader, so most of what matters about
 * them cannot be asserted here at all — whether they *look* like clouds is a
 * question for a browser, and it was answered in one.
 *
 * What this suite pins is the part that is arithmetic, and it is the part with
 * teeth: the projection divides by `dir.y`, the layers must not collapse onto
 * one another, and the whole field is driven by uniform objects that are shared
 * by reference between three materials. Each of those has a silent failure —
 * a NaN in a uniform shades the entire sky black with no error anywhere, and a
 * broken share leaves the sun blazing through a cloud that is drawn over it.
 *
 * ── What `cloudCoverageAt` is ───────────────────────────────────────────────
 *
 * A CPU mirror of the GLSL, which nothing in the render path uses. It exists so
 * the *properties* below can be checked without a GL context. It is a mirror and
 * mirrors drift, so nothing here asserts a value it produces against a constant
 * — only that it responds the way the shader is written to.
 */
describe('the cloud field', () => {
  const up = { x: 0, y: 1, z: 0 }

  it('is gone below the horizon, where the projection would divide by zero', () => {
    const u = createCloudUniforms()
    expect(cloudCoverageAt(u, { x: 1, y: -0.5, z: 0 })).toBe(0)
    expect(cloudCoverageAt(u, { x: 1, y: 0, z: 0 })).toBe(0)
    // And still gone a little way *above* it, which is what stops the noise
    // being sampled at the coordinates that alias.
    expect(cloudCoverageAt(u, { x: 1, y: 0.02, z: 0 })).toBe(0)
  })

  it('never returns a non-finite coverage, including straight down and at zero length', () => {
    const u = createCloudUniforms()
    for (const dir of [
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1e-9, y: 1e-9, z: 1e-9 }
    ]) {
      const v = cloudCoverageAt(u, dir)
      expect(Number.isFinite(v), JSON.stringify(dir)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('clouds over as the weather dial is turned up', () => {
    // Averaged over the sky rather than sampled at one direction: coverage at a
    // single point is noise, and the property that matters is that the *sky*
    // gets cloudier. Monotonic, because the dial biases the density threshold —
    // if it were ever wired to opacity instead this would still pass, so the
    // sample at 0 and 1 below is what pins the ends.
    const mean = (cover: number): number => {
      const u = createCloudUniforms()
      u.uCloudCover.value = cover
      let total = 0
      let n = 0
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2
        for (const y of [0.35, 0.6, 0.9]) {
          total += cloudCoverageAt(u, { x: Math.cos(a), y, z: Math.sin(a) })
          n++
        }
      }
      return total / n
    }
    const clear = mean(0)
    const mid = mean(0.5)
    const overcast = mean(1)
    expect(mid).toBeGreaterThan(clear)
    expect(overcast).toBeGreaterThan(mid)
    // The ends have to actually reach somewhere: a dial whose extremes are 0.3
    // and 0.4 is not a weather control.
    expect(clear).toBeLessThan(0.25)
    expect(overcast).toBeGreaterThan(0.75)
  })

  it('goes away entirely when the master opacity is zero', () => {
    const u = createCloudUniforms()
    u.uCloudCover.value = 1
    u.uCloudOpacity.value = 0
    expect(cloudCoverageAt(u, up)).toBe(0)
  })

  /**
   * The reason there are three layers rather than one field.
   *
   * If every layer moved at the same rate the sky would be one texture sliding
   * across a dome, and no amount of octaves fixes that. The speeds must stay
   * distinct, and the table must stay ordered high-and-fast to low-and-slow so
   * the parallax runs the way a sky does.
   */
  it('moves its three layers at three different speeds', () => {
    const speeds = CLOUD_LAYERS.map(layer => layer.speed)
    expect(new Set(speeds).size).toBe(speeds.length)
    for (let i = 1; i < CLOUD_LAYERS.length; i++) {
      expect(CLOUD_LAYERS[i]!.speed, CLOUD_LAYERS[i]!.name).toBeLessThan(CLOUD_LAYERS[i - 1]!.speed)
      // Higher layers are further away, so they are projected onto a higher
      // plane. Same ordering, and it is what makes them parallax rather than
      // slide as one.
      expect(CLOUD_LAYERS[i]!.height, CLOUD_LAYERS[i]!.name).toBeLessThan(CLOUD_LAYERS[i - 1]!.height)
    }
  })

  it('gives each layer a distinct shape, not just a distinct speed', () => {
    // Identical thresholds and scales would make the layers the same cloud at
    // three sizes. The cirrus in particular has to be anisotropic — a stretched
    // domain is the whole of what makes it read as cirrus and not as small
    // cumulus.
    const cirrus = CLOUD_LAYERS[0]!
    expect(cirrus.name).toBe('cirrus')
    expect(Math.abs(cirrus.scale[0] - cirrus.scale[1])).toBeGreaterThan(0.5)
    const signatures = CLOUD_LAYERS.map(l => `${l.threshold}/${l.softness}/${l.scale[0]}x${l.scale[1]}`)
    expect(new Set(signatures).size).toBe(signatures.length)
  })

  it('advances time, and wraps it before float precision goes', () => {
    const u = createCloudUniforms()
    advanceClouds(u, 1)
    const after = u.uCloudTime.value
    expect(after).toBeGreaterThan(0)
    // A float that has been adding a small number for an hour loses the
    // precision the noise lattice needs, and the clouds visibly quantise.
    u.uCloudTime.value = 4095.99
    advanceClouds(u, 10_000)
    expect(u.uCloudTime.value).toBeLessThan(4096)
    expect(u.uCloudTime.value).toBeGreaterThanOrEqual(0)
  })

  it('refuses a non-finite delta or wind rather than poisoning the uniform', () => {
    // One NaN here is a NaN in a uniform, which shades the whole sky black and
    // reports nothing anywhere.
    const u = createCloudUniforms()
    advanceClouds(u, Number.NaN)
    advanceClouds(u, 1, Number.NaN)
    advanceClouds(u, Number.POSITIVE_INFINITY)
    expect(Number.isFinite(u.uCloudTime.value)).toBe(true)
    expect(u.uCloudTime.value).toBe(0)
  })

  it('moves faster with more wind', () => {
    const calm = createCloudUniforms()
    const gale = createCloudUniforms()
    advanceClouds(calm, 10, 0.25)
    advanceClouds(gale, 10, 4)
    expect(gale.uCloudTime.value).toBeGreaterThan(calm.uCloudTime.value)
  })
})

describe('cloud lighting follows the day cycle', () => {
  it('lands on the day, night and golden palette entries at the ends of the ramp', () => {
    const u = createCloudUniforms()

    applyCloudLighting(u, 1, 0, { x: 0, y: 1, z: 0 })
    expect(u.uCloudLit.value.getHex()).toBe(C.cloudLit.getHex())
    expect(u.uCloudShade.value.getHex()).toBe(C.cloudShade.getHex())

    applyCloudLighting(u, 0, 0, { x: 0, y: -1, z: 0 })
    expect(u.uCloudLit.value.getHex()).toBe(C.cloudLitNight.getHex())

    applyCloudLighting(u, 1, 1, { x: 1, y: 0, z: 0 })
    expect(u.uCloudLit.value.getHex()).toBe(C.cloudLitWarm.getHex())
  })

  it('keeps the lit face brighter than the shaded one at every hour', () => {
    // A cloud whose underside is lighter than its top is not a cloud, and the
    // three-lerp ramp above is exactly the shape that could invert if one of
    // the six palette entries were re-picked without the other five.
    const u = createCloudUniforms()
    for (let day = 0; day <= 1; day += 0.125) {
      for (const golden of [0, 0.5, 1]) {
        applyCloudLighting(u, day, golden, { x: 0, y: 0.2, z: 0 })
        const lit = u.uCloudLit.value
        const shade = u.uCloudShade.value
        const luma = (c: { r: number; g: number; b: number }): number => c.r * 0.299 + c.g * 0.587 + c.b * 0.114
        expect(luma(lit), `day ${day} golden ${golden}`).toBeGreaterThan(luma(shade))
      }
    }
  })

  it('carries the sun direction through for the sunlit half of the sky', () => {
    const u = createCloudUniforms()
    applyCloudLighting(u, 1, 0.4, { x: 0.6, y: 0.3, z: -0.7 })
    expect(u.uCloudSun.value.x).toBeCloseTo(0.6, 6)
    expect(u.uCloudSun.value.y).toBeCloseTo(0.3, 6)
    expect(u.uCloudSun.value.z).toBeCloseTo(-0.7, 6)
  })
})

describe('the shader chunk', () => {
  it('declares every uniform it uses, and every uniform the factory creates', () => {
    // A uniform used but not declared is a shader that fails to compile, which
    // in three is a console warning and a black material — not an exception.
    // A uniform declared but never created is silently zero.
    const declared = [...CLOUD_UNIFORMS_GLSL.matchAll(/uniform \w+ (\w+);/g)].map(m => m[1])
    const created = Object.keys(createCloudUniforms())
    expect([...declared].sort()).toEqual([...created].sort())
    for (const name of created) {
      expect(
        CLOUD_FUNCTIONS_GLSL.includes(name) || name === 'uCloudOpacity',
        `${name} is created but never read by the shader`
      ).toBe(true)
    }
  })

  it('emits one composite block per layer, with that layers numbers', () => {
    for (const layer of CLOUD_LAYERS) {
      expect(CLOUD_FUNCTIONS_GLSL, layer.name).toContain(`-- ${layer.name} --`)
      expect(CLOUD_FUNCTIONS_GLSL, layer.name).toContain(layer.speed.toFixed(3))
    }
  })

  it('contains no unresolved placeholder or stray interpolation', () => {
    // The chunk is assembled by string replacement, and a placeholder that
    // survives is GLSL that will not compile.
    // Every name the chunk is assembled from. One of these surviving is an
    // undeclared identifier in GLSL, which three reports as a console warning
    // and a material that draws nothing -- it does not throw, so this list is
    // the only thing standing between a typo and a black sky. `DENSITY_CONTRAST`
    // is here because it did exactly that: `replace` took the occurrence in the
    // comment and left the one in the code.
    for (const name of [
      'PLACEHOLDER',
      'HORIZON_LOW',
      'HORIZON_HIGH',
      'COVER_BIAS',
      'DENSITY_CONTRAST',
      'LAYERS_PLACEHOLDER'
    ]) {
      expect(CLOUD_FUNCTIONS_GLSL, name).not.toContain(name)
    }
    expect(CLOUD_FUNCTIONS_GLSL).not.toContain('${')
    // Backticks inside a chunk end the template literal that carries it. This
    // has now cost two debugging rounds; it is cheaper to assert.
    expect(CLOUD_FUNCTIONS_GLSL).not.toContain('`')
    expect(CLOUD_UNIFORMS_GLSL).not.toContain('`')
  })
})

describe('the sky shares its cloud uniforms', () => {
  it('hands the same objects to the material it draws with', () => {
    // Shared by reference is the whole mechanism: it is what lets the sun and
    // the moon be occluded by the cloud the sky is drawing without a second
    // copy of the noise. A `clone()` anywhere in this path breaks it silently —
    // the sky would still have weather and the sun would simply never dim.
    const sky = createSky(100)
    const uniforms = (sky.material as ShaderMaterial).uniforms
    expect(uniforms.uCloudTime).toBe(sky.clouds.uCloudTime)
    expect(uniforms.uCloudCover).toBe(sky.clouds.uCloudCover)
    expect(uniforms.uCloudLit).toBe(sky.clouds.uCloudLit)

    advanceClouds(sky.clouds, 1)
    expect(uniforms.uCloudTime!.value).toBe(sky.clouds.uCloudTime.value)
    expect(uniforms.uCloudTime!.value).toBeGreaterThan(0)
  })

  it('still keeps the dome a mesh the three existing call sites can use', () => {
    // `createSky` gained a property rather than a wrapper object precisely so
    // `CreatorScene` and `WaterLab` did not have to change. If this ever stops
    // being a Mesh, both of them break at runtime and neither has a test.
    const sky = createSky(60)
    expect(sky.isMesh).toBe(true)
    expect(sky.name).toBe('sky')
    expect(sky.renderOrder).toBe(-1000)
    expect(sky.userData.perfTag).toBe('sky')
  })
})
