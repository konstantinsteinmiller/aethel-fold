import { describe, expect, it } from 'vitest'
import { WATER_PARS_VERTEX_GLSL, WATER_VERTEX_GLSL } from '@/world/water/waterGlsl'
import { WATER_STYLES, waterStyle } from '@/world/water/styles'

/**
 * ─── The water wave's analytic normal, pinned against a numeric oracle ──────
 *
 * `waterWave` in `src/world/water/waterGlsl.ts` displaces the surface as a sum
 * of three Gerstner octaves and hands back a **closed-form** normal for it. This
 * file exists to stop that closed form from being "simplified".
 *
 * ── What is at risk ─────────────────────────────────────────────────────────
 *
 * The normal is the exact cross product of the two tangents of the displaced
 * parameterisation:
 *
 *   N = ( −gx(1−Jzz) − gz·Jxz ,  (1−Jxx)(1−Jzz) − Jxz² ,  −gz(1−Jxx) − gx·Jxz )
 *
 * The widely-published form (GPU Gems 1, ch. 1) is
 *
 *   N ≈ ( −gx , 1 − Jxx − Jzz , −gz )
 *
 * — no `Jxz` cross terms, no `(1−J)` products. A reader who recognises the
 * standard formulation will be tempted to "restore" it, and the shader will
 * still look broadly correct: the two agree exactly at zero steepness and differ
 * by second-order terms elsewhere. **Those second-order terms are the ones that
 * carry the crest/trough asymmetry**, which is the entire reason steepness
 * exists. The failure mode is a sea that displaces like a Gerstner wave and
 * shades like a sine one — subtle, and invisible in a screenshot.
 *
 * A hand-checked reimplementation of the same algebra would drift with it, so
 * the oracle is a **central difference of the displaced surface**: it knows
 * nothing about the derivation and cannot agree with a wrong one.
 *
 * ── Why central differences are legitimate here and banned in the shader ────
 *
 * This is not a double standard, and the asymmetry is worth stating plainly so
 * nobody "fixes" the shader to match the test.
 *
 *   • **In a test** the step `h` is chosen by us, the surface is evaluated at
 *     exactly the points we ask for, and the result is a number compared once.
 *     A finite difference is simply a slower, independent way to compute the
 *     same derivative.
 *   • **In the shader** the only finite difference available is `dFdx`/`dFdy`,
 *     whose step is the screen-space quad — so the "derivative" changes with
 *     camera distance, with resolution and across a triangle edge. The water
 *     shader has already been burned by exactly this class of bug (see the
 *     flow-scroll shear recorded in `waterGlsl.ts`'s header): a gradient that
 *     depends on how the surface happens to be sampled aliases into a grating.
 *     It would also cost a derivative of a value the vertex stage has in closed
 *     form.
 *
 * So: analytic in the shader, numeric in the test, and this file is the bridge.
 *
 * ── If this file fails ──────────────────────────────────────────────────────
 *
 * Look at `src/world/water/waterGlsl.ts` first, not at this file. The TS below
 * is a **mirror** of the GLSL, kept deliberately literal; the `pins` suite at
 * the bottom asserts that the shader still contains the expressions the mirror
 * encodes, so a shader edit fails there with a pointer rather than failing here
 * with a mystery.
 */

// ── The mirror ──────────────────────────────────────────────────────────────
//
// A line-for-line transcription of `waterWave` in
// `src/world/water/waterGlsl.ts` (inside `WATER_PARS_VERTEX_GLSL`), plus the
// `waterTilt` expression from `WATER_VERTEX_GLSL`. It is NOT a second
// implementation to be improved: if the GLSL changes, change this to match, and
// let the numeric oracle below decide whether the new algebra is right.

/** `WATER_DIR_A`, `_B`, `_C` — the three octave bearings, unit length. */
const DIR = [
  [0.94, 0.342],
  [-0.416, 0.909],
  [0.602, -0.799]
] as const
/** The octave weights in `raw = sa * 0.55 + sb * 0.31 + sc * 0.14`. Sum to 1. */
const W = [0.55, 0.31, 0.14] as const
/** The non-harmonic wavenumber scales 1 : 1.93 : 3.71. */
const KS = [1, 1.93, 3.71] as const
/** The per-octave temporal scales 1 : 1.37 : 0.71. */
const WS = [1, 1.37, 0.71] as const
/** `WATER_WK_SUM`. */
const WK_SUM = 0.55 + 0.31 * 1.93 + 0.14 * 3.71
/** `WATER_LOOP_LIMIT`. */
const LOOP_LIMIT = 0.92

interface Wave {
  /** Unitless height in [-1, 1]; the shader multiplies by `uWaveAmplitude`. */
  raw: number
  /** ∂raw/∂x, ∂raw/∂z — likewise unitless in amplitude. */
  grad: [number, number]
  /** Horizontal bunching, in metres, already scaled by the clamped `qa`. */
  offset: [number, number]
  /** (Jxx, Jzz, Jxz), already scaled by the clamped `qa`. */
  jac: [number, number, number]
  /** The steepness product actually used, after the loop clamp. */
  qa: number
}

const waterWave = (
  p: readonly [number, number],
  qaWanted: number,
  waveLength: number,
  waveSpeed: number,
  time: number
): Wave => {
  const k = 6.28318531 / Math.max(waveLength, 0.05)
  const w = 6.28318531 * waveSpeed
  // The loop clamp: on the SUMMED steepness, not per octave.
  const qa = Math.min(qaWanted, LOOP_LIMIT / (WK_SUM * k))

  let raw = 0
  const grad: [number, number] = [0, 0]
  const offset: [number, number] = [0, 0]
  const jac: [number, number, number] = [0, 0, 0]

  for (let i = 0; i < 3; i++) {
    const d = DIR[i]!
    const ki = k * KS[i]!
    // Phase read at the REST position — that is what keeps the tangents
    // analytic, and the only formulation with a closed-form normal at all.
    const phase = (d[0] * p[0] + d[1] * p[1]) * ki + time * (w * WS[i]!)
    const s = Math.sin(phase)
    const c = Math.cos(phase)
    raw += s * W[i]!
    grad[0] += d[0] * (c * W[i]! * ki)
    grad[1] += d[1] * (c * W[i]! * ki)
    offset[0] += d[0] * (c * W[i]!) * qa
    offset[1] += d[1] * (c * W[i]!) * qa
    const a = qa * (W[i]! * ki) * s
    jac[0] += a * d[0] * d[0]
    jac[1] += a * d[1] * d[1]
    jac[2] += a * d[0] * d[1]
  }
  return { raw, grad, offset, jac, qa }
}

/** The displaced surface point (x, y, z), as the vertex stage builds it. */
const surfacePoint = (
  p: readonly [number, number],
  steep: number,
  amplitude: number,
  waveLength: number,
  waveSpeed: number,
  time: number
): [number, number, number] => {
  const wave = waterWave(p, steep * amplitude, waveLength, waveSpeed, time)
  return [p[0] + wave.offset[0], wave.raw * amplitude, p[1] + wave.offset[1]]
}

/**
 * The closed form under test, mirroring `waterTilt` in `WATER_VERTEX_GLSL`.
 * The shader adds `N − (0,1,0)` to the baked normal rather than writing `N`, so
 * a river ribbon on a slope keeps its own orientation; that is a different
 * concern from whether `N` itself is right, which is what this returns.
 */
const analyticNormal = (
  p: readonly [number, number],
  steep: number,
  amplitude: number,
  waveLength: number,
  waveSpeed: number,
  time: number
): [number, number, number] => {
  const wave = waterWave(p, steep * amplitude, waveLength, waveSpeed, time)
  const gx = wave.grad[0] * amplitude
  const gz = wave.grad[1] * amplitude
  const [jxx, jzz, jxz] = wave.jac
  return [-gx * (1 - jzz) - gz * jxz, (1 - jxx) * (1 - jzz) - jxz * jxz, -gz * (1 - jxx) - gx * jxz]
}

const normalise = (v: readonly [number, number, number]): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

/**
 * The oracle: `N = B × T` from central-differenced tangents of the *displaced*
 * surface. Deliberately ignorant of the algebra above — see the file header for
 * why a finite difference is right here and wrong in the shader.
 */
const numericNormal = (
  p: readonly [number, number],
  steep: number,
  amplitude: number,
  waveLength: number,
  waveSpeed: number,
  time: number,
  h = 1e-4
): [number, number, number] => {
  const at = (x: number, z: number) => surfacePoint([x, z], steep, amplitude, waveLength, waveSpeed, time)
  const px = at(p[0] + h, p[1])
  const mx = at(p[0] - h, p[1])
  const pz = at(p[0], p[1] + h)
  const mz = at(p[0], p[1] - h)
  const t: [number, number, number] = [(px[0] - mx[0]) / (2 * h), (px[1] - mx[1]) / (2 * h), (px[2] - mx[2]) / (2 * h)]
  const b: [number, number, number] = [(pz[0] - mz[0]) / (2 * h), (pz[1] - mz[1]) / (2 * h), (pz[2] - mz[2]) / (2 * h)]
  return normalise([b[1] * t[2] - b[2] * t[1], b[2] * t[0] - b[0] * t[2], b[0] * t[1] - b[1] * t[0]])
}

/** Scattered, irrationally-spaced sample points — never on a lattice. */
const SAMPLES: [number, number][] = []
for (let i = 0; i < 40; i++) {
  SAMPLES.push([Math.sin(i * 2.399) * 37 + i * 1.7, Math.cos(i * 1.117) * 23 - i * 0.9])
}

describe('waterWave: the closed-form normal is the normal of the surface it displaces', () => {
  const cases = [
    { name: 'sea preset', steep: 0.78, amplitude: 0.16, waveLength: 11, waveSpeed: 0.42 },
    { name: 'river preset', steep: 0.45, amplitude: 0.055, waveLength: 1.9, waveSpeed: 1.1 },
    // Not presets: what the editor's sliders can reach. **These two are the
    // ones that catch the simplification, and it is worth knowing why.**
    // Verified by mutating the mirror to the GPU Gems form and re-running: the
    // river, the editor drag and the clamp case all fail, and the *sea* case
    // passes. The sea's summed steepness is only 0.119, so its second-order
    // terms sit inside the 0.99999 tolerance — the preset the reference art
    // cares most about is the one least able to prove the formula. Do not drop
    // these as "not shipping values".
    { name: 'steep editor drag', steep: 1, amplitude: 0.6, waveLength: 4, waveSpeed: 0.5 },
    { name: 'against the loop clamp', steep: 1, amplitude: 40, waveLength: 3, waveSpeed: 0.5 }
  ]

  for (const c of cases) {
    it(`${c.name}: analytic matches the central-difference oracle`, () => {
      for (const t of [0, 3.7, 91.2]) {
        for (const p of SAMPLES) {
          const analytic = normalise(analyticNormal(p, c.steep, c.amplitude, c.waveLength, c.waveSpeed, t))
          const numeric = numericNormal(p, c.steep, c.amplitude, c.waveLength, c.waveSpeed, t)
          const dot = analytic[0] * numeric[0] + analytic[1] * numeric[1] + analytic[2] * numeric[2]
          expect(dot).toBeGreaterThan(0.99999)
        }
      }
    })
  }

  it('rejects the GPU Gems approximation, so this suite is not vacuous', () => {
    // The dropped terms have to actually matter at a magnitude the editor can
    // reach, or the assertions above would pass for the wrong formula too.
    let worst = 1
    for (const p of SAMPLES) {
      const wave = waterWave(p, 1 * 0.6, 4, 0.5, 3.7)
      const gx = wave.grad[0] * 0.6
      const gz = wave.grad[1] * 0.6
      const [jxx, jzz] = wave.jac
      const approx = normalise([-gx, 1 - jxx - jzz, -gz])
      const numeric = numericNormal(p, 1, 0.6, 4, 0.5, 3.7)
      worst = Math.min(worst, approx[0] * numeric[0] + approx[1] * numeric[1] + approx[2] * numeric[2])
    }
    expect(worst).toBeLessThan(0.99999)
  })

  it('at zero steepness it is exactly the height-field normal, bit for bit', () => {
    // This is what keeps a pond bit-exact still: every Gerstner term carries
    // `qa` as a factor, so at `steepness = 0` the shader's position and normal
    // are the ones it produced before Gerstner existed. Measured in the browser
    // as motion[pond] = 0.0000; asserted here as exact float equality.
    for (const p of SAMPLES) {
      const wave = waterWave(p, 0, 11, 0.42, 12.5)
      expect(wave.jac).toEqual([0, 0, 0])
      expect(wave.offset[0]).toBe(0)
      expect(wave.offset[1]).toBe(0)
      const n = analyticNormal(p, 0, 0.16, 11, 0.42, 12.5)
      expect(n[0]).toBe(-wave.grad[0] * 0.16)
      expect(n[1]).toBe(1)
      expect(n[2]).toBe(-wave.grad[1] * 0.16)
    }
  })
})

describe('waterWave: the loop clamp', () => {
  /**
   * The clamp never binds for a shipped preset, so nothing in the running app
   * exercises it — which is exactly why it needs a test. It is the only thing
   * standing between an editor slider and a folded, NaN-normalled surface.
   */
  it('binds on the summed steepness, not per octave', () => {
    const waveLength = 2
    const k = 6.28318531 / waveLength
    const limit = LOOP_LIMIT / (WK_SUM * k)
    // A steepness whose largest single octave is comfortably safe...
    const qa = 0.9 / (0.14 * 3.71 * k)
    expect(qa * 0.14 * 3.71 * k).toBeLessThan(1)
    // ...while the sum across all three has already folded.
    expect(qa * WK_SUM * k).toBeGreaterThan(1)
    const wave = waterWave([3, 5], qa, waveLength, 0.5, 2)
    expect(wave.qa).toBeCloseTo(limit, 12)
    expect(wave.qa * WK_SUM * k).toBeCloseTo(LOOP_LIMIT, 10)
  })

  it('keeps N.y away from zero for every bearing mix, so normalize never sees 0', () => {
    // At a summed steepness of exactly 1 the trochoid cusps: N is the zero
    // vector there and `normalize` returns NaN, which spreads to the whole
    // triangle. 0.92 is the margin that buys.
    let worst = Number.POSITIVE_INFINITY
    for (let i = 0; i < 3000; i++) {
      const p: [number, number] = [Math.sin(i * 0.731) * 90, Math.cos(i * 0.317) * 90]
      const waveLength = 0.5 + (i % 17) * 0.8
      const n = analyticNormal(p, 1, 25, waveLength, 0.6, i * 0.037)
      worst = Math.min(worst, n[1])
    }
    expect(worst).toBeGreaterThan(0.05)
  })

  it('never binds for a shipped preset', () => {
    for (const style of Object.values(WATER_STYLES)) {
      const k = 6.28318531 / Math.max(style.waveLength, 0.05)
      expect(style.steepness * style.waveAmplitude).toBeLessThan(LOOP_LIMIT / (WK_SUM * k))
    }
  })
})

describe('waterWave: what the displacement actually does', () => {
  /**
   * The point of steepness, as a number.
   *
   * Gerstner does not change the height *function* — the elevation is still the
   * same sum of sines of the rest position. It changes how much **surface area**
   * each part of that function gets. The area element of the horizontal map is
   * `det(∂X/∂p) = (1−Jxx)(1−Jzz) − Jxz²`, which is exactly `N.y` from the closed
   * form, so this doubles as a second, independent check on that term.
   *
   * "Sharp crests, broad troughs" therefore reads: small area element where the
   * elevation is high.
   */
  const areaStats = (steep: number, amplitude: number, waveLength: number) => {
    const span = waveLength * 6
    const n = 220
    let sumArea = 0
    let sumHeightArea = 0
    let sumHeight = 0
    let aboveArea = 0
    const rows: { h: number; a: number }[] = []
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const wave = waterWave([(i / n) * span, (j / n) * span], steep * amplitude, waveLength, 0.42, 0)
        const h = wave.raw * amplitude
        const a = (1 - wave.jac[0]) * (1 - wave.jac[1]) - wave.jac[2] * wave.jac[2]
        sumArea += a
        sumHeightArea += h * a
        sumHeight += h
        rows.push({ h, a })
      }
    }
    const parametricMean = sumHeight / rows.length
    for (const r of rows) {
      if (r.h > parametricMean) aboveArea += r.a
    }
    return { drop: sumHeightArea / sumArea - parametricMean, areaAbove: aboveArea / sumArea }
  }

  it('gives the sea preset less area on its crests than in its troughs', () => {
    const flat = areaStats(0, 0.16, 11)
    const gerstner = areaStats(0.78, 0.16, 11)
    // With no horizontal displacement the area element is exactly 1 everywhere,
    // so the two means coincide and half the area sits above the mean.
    expect(flat.drop).toBeCloseTo(0, 12)
    expect(flat.areaAbove).toBeCloseTo(0.5, 2)
    // With it, the surface bunches into the crests: the area-weighted mean level
    // drops (measured: 3.2 mm) and under half the area is above it (48.4 %).
    expect(gerstner.drop).toBeLessThan(-0.002)
    expect(gerstner.areaAbove).toBeLessThan(flat.areaAbove - 0.01)
  })

  it('scales monotonically with steepness', () => {
    const drops = [0, 0.25, 0.5, 0.78, 1].map(q => areaStats(q, 0.16, 11).drop)
    for (let i = 1; i < drops.length; i++) expect(drops[i]!).toBeLessThan(drops[i - 1]!)
  })

  it('bounds the waterline breathing that the aShore damping exists to remove', () => {
    // |offset| <= qa, because the octave weights sum to exactly 1. The damping's
    // neglected Jacobian term is |d0|*|grad(sigma)| <= qa / foamWidth, and the
    // shader's comment claims that is under a degree of normal error. Pin the
    // arithmetic, so raising an amplitude or narrowing a foam band cannot
    // silently invalidate the claim.
    const sea = waterStyle('sea')
    const qa = sea.steepness * sea.waveAmplitude
    let peak = 0
    for (const p of SAMPLES) {
      for (const t of [0, 0.9, 2.3, 7.1]) {
        const wave = waterWave(p, qa, sea.waveLength, sea.waveSpeed, t)
        peak = Math.max(peak, Math.hypot(wave.offset[0], wave.offset[1]))
      }
    }
    expect(peak).toBeLessThanOrEqual(qa + 1e-9)
    expect(qa / sea.foamWidth).toBeLessThan(0.09)
    // And a vertex on the waterline, where aShore is 0, does not move at all.
    expect(waterWave([12, -4], qa * 0, sea.waveLength, sea.waveSpeed, 3.3).offset).toEqual([0, 0])
  })
})

describe('waterWave: the mirror still matches the shader', () => {
  /**
   * Without these, the mirror above could drift from the GLSL and every test in
   * this file would keep passing while shading nothing that ships. They are
   * deliberately literal string pins: a shader edit fails *here*, next to a
   * comment naming the file to look at, instead of failing as a wrong number in
   * a normal comparison.
   */
  it('pins the octave table the mirror transcribes', () => {
    for (const line of [
      'const vec2 WATER_DIR_A = vec2(0.940, 0.342);',
      'const vec2 WATER_DIR_B = vec2(-0.416, 0.909);',
      'const vec2 WATER_DIR_C = vec2(0.602, -0.799);',
      'const float WATER_WK_SUM = 0.55 + 0.31 * 1.93 + 0.14 * 3.71;',
      'const float WATER_LOOP_LIMIT = 0.92;',
      'raw = sa * 0.55 + sb * 0.31 + sc * 0.14;',
      'float aa = qa * (0.55 * k) * sa;'
    ]) {
      expect(WATER_PARS_VERTEX_GLSL, `src/world/water/waterGlsl.ts no longer contains: ${line}`).toContain(line)
    }
  })

  it('pins the clamp to the summed form', () => {
    expect(
      WATER_PARS_VERTEX_GLSL,
      'the loop clamp in waterGlsl.ts changed shape — re-derive it before editing this test'
    ).toContain('float qa = min(qaWanted, WATER_LOOP_LIMIT / (WATER_WK_SUM * k));')
  })

  it('pins the exact cross product, including the terms GPU Gems drops', () => {
    for (const line of [
      '-waterSlope.x * (1.0 - waterJac.y) - waterSlope.y * waterJac.z,',
      '(1.0 - waterJac.x) * (1.0 - waterJac.y) - waterJac.z * waterJac.z - 1.0,',
      '-waterSlope.y * (1.0 - waterJac.x) - waterSlope.x * waterJac.z'
    ]) {
      expect(
        WATER_VERTEX_GLSL,
        `waterTilt in waterGlsl.ts no longer contains "${line}" — if the cross terms were dropped, that is the bug this suite exists for`
      ).toContain(line)
    }
  })

  it('pins the steepness gates', () => {
    expect(WATER_VERTEX_GLSL).toContain('float waterShoreDamp = clamp(aShore, 0.0, 1.0);')
    expect(WATER_VERTEX_GLSL).toContain('float waterSteep = uSteepness * uWaveAmplitude * waterShoreDamp * waterFlat;')
  })
})
