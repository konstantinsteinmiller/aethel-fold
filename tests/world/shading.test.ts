import { describe, expect, it } from 'vitest'
import { Color, type WebGLProgramParametersWithUniforms } from 'three'
import { SURFACE_FRAGMENT_GLSL, SURFACE_PARS_FRAGMENT_GLSL } from '@/world/shading/glsl'
import { BARK_RIM, FOLIAGE_RIM, ToonMaterial, createToonMaterial } from '@/world/shading/toonMaterial'
import { C, RIM_POWER, RIM_STRENGTH } from '@/world/art/palette'
import { createTreeAsset } from '@/world/assets/tree'
import { createPineAsset } from '@/world/assets/pine'
import { createBirchAsset } from '@/world/assets/birch'
import { createOldOakAsset } from '@/world/assets/oldOak'
import { createShrubAsset } from '@/world/assets/shrub'
import { createDeadTreeAsset } from '@/world/assets/deadTree'
import { createStumpAsset } from '@/world/assets/stump'
import type { WorldAsset } from '@/world/assets/types'

/**
 * ─── The foliage rim, as a contract ─────────────────────────────────────────
 *
 * The bug these pin: every canopy in the world was ringed in a near-white
 * additive that followed the *mesh outline* rather than the light, and read as
 * moulded shiny plastic. Measured on a spruce at 11 m against sky, a canopy
 * whose interior is `rgb(8,54,17)` reached `rgb(90,114,112)` on its sun edge and
 * `rgb(72,91,90)` on its **shaded** edge — the two sides of the tree were within
 * a few values of each other, which is what "the rim doesn't know where the sun
 * is" looks like on screen.
 *
 * It was specific to foliage because of GDD R3: `blendNormalsToSphere` makes a
 * clump shade as a sphere, so `N·V` reaches 0 all the way round the silhouette
 * and a view-only fresnel therefore has nowhere it does *not* fire.
 *
 * Three properties keep the fix honest, and each maps to a way it could
 * silently come undone:
 *
 * 1. **The default must stay a pure view fresnel.** Every other family in the
 *    world (rock 0.5, plateau 0.55, structures 0.4, characters, grass 0.15,
 *    terrain 0.18) shares this program, and `mix(1.0, x, 0.0)` is exactly 1.0 —
 *    so a zero default means their pixels are bit-identical. Verified in the
 *    browser too: a full-scene A/B with no foliage in frame produced two
 *    byte-identical JPEGs.
 * 2. **`clone()` must carry the new options.** `InstancedLodField` clones the
 *    asset's material once per tier; a clone that dropped them would restore the
 *    old wrapping rim on LOD1..3 — i.e. on almost every tree in a forest.
 * 3. **`onBeforeCompile` must bind the uniform.** A declared-but-unbound uniform
 *    reads as 0 with no error and no warning, which would look exactly like the
 *    fix not being there.
 */

/** The rim uniforms are `protected` on the class; tests read them by shape. */
interface RimView {
  uRimColor: { value: Color }
  uRimPower: { value: number }
  uRimStrength: { value: number }
  uRimWrap: { value: number }
}

const rim = (material: ToonMaterial): RimView => material as unknown as RimView

describe('surface GLSL', () => {
  it('declares the rim wrap uniform', () => {
    expect(SURFACE_PARS_FRAGMENT_GLSL).toContain('uniform float uRimWrap;')
  })

  it('gates the fresnel on the key light direction', () => {
    // View-space `N·L` against three's own directional light struct — the same
    // index CSM's `lights_fragment_begin` uses for its cascade select.
    expect(SURFACE_FRAGMENT_GLSL).toContain('directionalLights[0].direction')
    expect(SURFACE_FRAGMENT_GLSL).toMatch(/mix\(1\.0, smoothstep\(.*\), uRimWrap\)/)
  })

  it('guards the gate on NUM_DIR_LIGHTS so an unlit permutation still compiles', () => {
    expect(SURFACE_FRAGMENT_GLSL).toContain('#if NUM_DIR_LIGHTS > 0')
    expect(SURFACE_FRAGMENT_GLSL).toContain('#endif')
  })

  it('still adds a rim — R5 is mandatory, this was never a removal', () => {
    expect(SURFACE_FRAGMENT_GLSL).toContain('outgoingLight += uRimColor *')
  })

  it('adds no #define, so it cannot fork a program (GDD §5.2)', () => {
    // NUM_DIR_LIGHTS is three's own and every lit material already forks on it
    // identically. Anything else here would be a new program.
    const defines = SURFACE_FRAGMENT_GLSL.match(/#(?:if|ifdef|ifndef|define)[^\n]*/g) ?? []
    expect(defines).toEqual(['#if NUM_DIR_LIGHTS > 0'])
  })
})

describe('ToonMaterial rim options', () => {
  it('defaults to the project rim, ungated — every non-foliage family is untouched', () => {
    const material = createToonMaterial({ name: 'probe' })
    expect(rim(material).uRimWrap.value).toBe(0)
    expect(rim(material).uRimPower.value).toBe(RIM_POWER)
    expect(rim(material).uRimStrength.value).toBe(RIM_STRENGTH)
    expect(rim(material).uRimColor.value.getHex()).toBe(C.rim.getHex())
  })

  it('copies rimColor rather than aliasing the caller’s Color', () => {
    const source = new Color(0x112233)
    const material = createToonMaterial({ rimColor: source })
    source.setHex(0xffffff)
    expect(rim(material).uRimColor.value.getHex()).toBe(0x112233)
  })

  it('carries rimColor and rimWrap through clone() — the per-tier trap', () => {
    const material = createToonMaterial({ name: 'probe', ...FOLIAGE_RIM })
    const copy = material.clone()
    expect(rim(copy).uRimWrap.value).toBe(FOLIAGE_RIM.rimWrap)
    expect(rim(copy).uRimPower.value).toBe(FOLIAGE_RIM.rimPower)
    expect(rim(copy).uRimStrength.value).toBe(FOLIAGE_RIM.rimStrength)
    expect(rim(copy).uRimColor.value.getHex()).toBe(FOLIAGE_RIM.rimColor.getHex())
    // …and its own uniform object, or the tiers could not fade independently.
    expect(rim(copy).uRimColor.value).not.toBe(rim(material).uRimColor.value)
  })

  it('binds uRimWrap into the shader — an unbound uniform silently reads 0', () => {
    const material = createToonMaterial({ ...FOLIAGE_RIM })
    const shader = {
      uniforms: {},
      vertexShader: '#include <clipping_planes_pars_vertex>\n#include <project_vertex>',
      fragmentShader:
        '#include <clipping_planes_pars_fragment>\n#include <clipping_planes_fragment>\n#include <opaque_fragment>'
    } as unknown as WebGLProgramParametersWithUniforms
    material.onBeforeCompile(shader)
    expect(shader.uniforms.uRimWrap).toBe(rim(material).uRimWrap)
    expect(shader.fragmentShader).toContain('uniform float uRimWrap;')
  })

  it('keeps one program per shading family — rim options are not in the cache key', () => {
    const plain = createToonMaterial({ name: 'a' })
    const foliage = createToonMaterial({ name: 'b', ...FOLIAGE_RIM })
    expect(foliage.customProgramCacheKey()).toBe(plain.customProgramCacheKey())
  })
})

describe('the rim presets', () => {
  it('tighten and dim the rim rather than removing it', () => {
    expect(FOLIAGE_RIM.rimStrength).toBeGreaterThan(0)
    expect(FOLIAGE_RIM.rimStrength).toBeLessThan(RIM_STRENGTH)
    // A higher exponent is a *narrower* band: quarter strength moves from 94 %
    // of a sphere's screen radius to 97 %.
    expect(FOLIAGE_RIM.rimPower).toBeGreaterThan(RIM_POWER)
    expect(BARK_RIM.rimPower).toBeGreaterThan(RIM_POWER)
    expect(BARK_RIM.rimStrength).toBeLessThan(0.46)
  })

  it('leaves a rim on the unlit side — a backlit tree must still have an edge', () => {
    for (const preset of [FOLIAGE_RIM, BARK_RIM]) {
      expect(preset.rimWrap).toBeGreaterThan(0)
      expect(preset.rimWrap).toBeLessThan(1)
    }
  })

  it('tints away from near-white, which is what read as specular', () => {
    for (const preset of [FOLIAGE_RIM, BARK_RIM]) {
      expect(preset.rimColor.getHex()).not.toBe(C.rim.getHex())
      // Strictly less bright than the sky rim in every channel, and no longer
      // blue-dominant — the old additive raised a canopy's blue channel ~4×.
      expect(preset.rimColor.r).toBeLessThan(C.rim.r)
      expect(preset.rimColor.g).toBeLessThan(C.rim.g)
      expect(preset.rimColor.b).toBeLessThan(C.rim.b)
    }
    expect(FOLIAGE_RIM.rimColor.g).toBeGreaterThan(FOLIAGE_RIM.rimColor.r)
  })
})

describe('flora assets use the matte rim', () => {
  const canopies: [string, () => WorldAsset][] = [
    ['tree', () => createTreeAsset()],
    ['pine', () => createPineAsset()],
    ['birch', () => createBirchAsset()],
    ['old-oak', () => createOldOakAsset()],
    ['shrub', () => createShrubAsset()]
  ]
  const wood: [string, () => WorldAsset][] = [
    ['deadwood', () => createDeadTreeAsset()],
    ['stump', () => createStumpAsset()]
  ]

  for (const [name, make] of canopies) {
    it(`${name} carries FOLIAGE_RIM`, () => {
      const view = rim(make().material)
      expect(view.uRimWrap.value).toBe(FOLIAGE_RIM.rimWrap)
      expect(view.uRimPower.value).toBe(FOLIAGE_RIM.rimPower)
      expect(view.uRimStrength.value).toBe(FOLIAGE_RIM.rimStrength)
      expect(view.uRimColor.value.getHex()).toBe(FOLIAGE_RIM.rimColor.getHex())
    })
  }

  for (const [name, make] of wood) {
    it(`${name} carries BARK_RIM`, () => {
      const view = rim(make().material)
      expect(view.uRimWrap.value).toBe(BARK_RIM.rimWrap)
      expect(view.uRimPower.value).toBe(BARK_RIM.rimPower)
      expect(view.uRimStrength.value).toBe(BARK_RIM.rimStrength)
      expect(view.uRimColor.value.getHex()).toBe(BARK_RIM.rimColor.getHex())
    })
  }
})
