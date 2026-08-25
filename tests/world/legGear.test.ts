import { type BufferGeometry, Color, Matrix4, Ray, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  type BoneWeights,
  buildChibiGeometry,
  CHIBI_BUDGET,
  emptyBoneWeights,
  JOINT_BLEND,
  legBoneWeights
} from '@/world/characters/chibiGeometry'
import {
  DRAWN_SOCKET,
  DEFAULT_APPEARANCE,
  EQUIPMENT_BUDGET,
  ITEM_SLOT,
  STOW_SOCKET,
  type Sex
} from '@/world/characters/equipment'
import { GARMENT_BUILDERS, type GarmentKind } from '@/world/characters/gear/garments'
import { windingDisagreements } from '@/world/characters/gear/gearKit'
import {
  LEG_GARMENT_BUDGET,
  LEG_GARMENT_BUILDERS,
  LEG_GARMENT_COLOURWAYS,
  legGarmentMargin,
  type LegGarmentKind
} from '@/world/characters/gear/legGarments'
import { ANKLE_Y, HIPS_Y, KNEE_Y, legPairTriangles, THIGH_Y } from '@/world/characters/gear/legKit'
import { RUN, WALK, applyBank, applyGait, applyJump } from '@/world/characters/poses'
import { BONE_NAMES, boneDefinition } from '@/world/characters/rig'
import { buildSkeleton } from '@/world/characters/skeleton'
import { triangleCount } from '@/world/geometry/budget'

/**
 * ─── Leg garments ───────────────────────────────────────────────────────────
 *
 * Four models that **replace** the body's thigh and shin parts. None of it needs
 * WebGL — a leg garment's whole contract is geometric — and the two things that
 * can go wrong with it are both invisible to the eye that authored them:
 *
 *   1. **A hole.** The legs are gone, so a gap between the garment and the pelvis
 *      above it or the foot below it is the sky visible through the character.
 *      This is worse than the torso's version of the same problem in two ways:
 *      there are **four** closures rather than two, and the seams *move* — the
 *      thigh sweeps through 60° of a run where the chest turns through 10.
 *   2. **A crossed midline.** The substitution splits left from right by the sign
 *      of x, so an inboard surface that reaches past x = 0 is skinned to the
 *      opposite thigh. That does not error, does not fail a budget, and tears the
 *      crotch open on the first stride.
 *
 * Every assertion is written so a NaN lands in the **failing** branch, per
 * `plateau.ts`: a range check against NaN is false, so a test written the obvious
 * way silently inverts into one that can never fail.
 */

const KINDS = Object.keys(LEG_GARMENT_BUILDERS) as LegGarmentKind[]

const build = (kind: LegGarmentKind, seed = 1) => LEG_GARMENT_BUILDERS[kind]({ seed })
const models = new Map(KINDS.map(kind => [kind, build(kind)]))

const THIGH_L = BONE_NAMES.indexOf('thigh.L')
const THIGH_R = BONE_NAMES.indexOf('thigh.R')
const SHIN_L = BONE_NAMES.indexOf('shin.L')
const SHIN_R = BONE_NAMES.indexOf('shin.R')
const FOOT_L = BONE_NAMES.indexOf('foot.L')
const FOOT_R = BONE_NAMES.indexOf('foot.R')
const HIPS = BONE_NAMES.indexOf('hips')

/**
 * Relative luminance in the space the palette was **authored** in.
 *
 * `THREE.Color` holds linear-sRGB, where every dark albedo in this project sits
 * near 0.015 — a linear threshold would be a test about colour management rather
 * than about GDD R4, which is a statement about the authored value.
 */
const authoredLuma = (r: number, g: number, b: number): number => {
  const srgb = new Color(r, g, b).convertLinearToSRGB()
  return 0.2126 * srgb.r + 0.7152 * srgb.g + 0.0722 * srgb.b
}

const darkestColour = (geometry: BufferGeometry): number => {
  const colour = geometry.getAttribute('color')
  let darkest = 1
  for (let i = 0; i < colour.count; i++) {
    const luma = authoredLuma(colour.getX(i), colour.getY(i), colour.getZ(i))
    // Positive test, so a NaN colour fails here rather than sliding past.
    if (!(luma >= darkest)) {
      darkest = luma
    }
  }
  return darkest
}

/**
 * Connected, closed components of an indexed mesh.
 *
 * Vertices are welded by position first, because a *merged* model does not share
 * vertices between parts — so a leg garment, which is geometrically two closed
 * solids, has to be recognised as two rather than as one open one. Integer keys
 * rather than `toFixed`: a coordinate of −1e−9 formats as "-0.000000" and +1e−9 as
 * "0.000000", which leaves every pole unwelded.
 */
const componentsOf = (index: ArrayLike<number>, rest: ArrayLike<number>): { faces: number[]; closed: boolean }[] => {
  const vertexCount = rest.length / 3
  const welded = new Int32Array(vertexCount)
  const byPosition = new Map<string, number>()
  for (let i = 0; i < vertexCount; i++) {
    const key = `${Math.round(rest[i * 3]! * 1e6)}:${Math.round(rest[i * 3 + 1]! * 1e6)}:${Math.round(rest[i * 3 + 2]! * 1e6)}`
    const seen = byPosition.get(key)
    if (seen === undefined) {
      byPosition.set(key, i)
      welded[i] = i
    } else {
      welded[i] = seen
    }
  }
  const parent = new Int32Array(vertexCount)
  for (let i = 0; i < vertexCount; i++) {
    parent[i] = i
  }
  const find = (x: number): number => {
    let root = x
    while (parent[root]! !== root) {
      root = parent[root]!
    }
    return root
  }
  const join = (x: number, y: number): void => {
    const a = find(x)
    const b = find(y)
    if (a !== b) {
      parent[a] = b
    }
  }
  for (let f = 0; f < index.length; f += 3) {
    join(welded[index[f]!]!, welded[index[f + 1]!]!)
    join(welded[index[f + 1]!]!, welded[index[f + 2]!]!)
  }
  const groups = new Map<number, number[]>()
  for (let f = 0; f < index.length; f += 3) {
    const key = find(welded[index[f]!]!)
    const list = groups.get(key)
    if (list) {
      list.push(f)
    } else {
      groups.set(key, [f])
    }
  }
  const out: { faces: number[]; closed: boolean }[] = []
  for (const faces of groups.values()) {
    const edges = new Map<string, number>()
    for (const f of faces) {
      const tri = [welded[index[f]!]!, welded[index[f + 1]!]!, welded[index[f + 2]!]!]
      if (tri[0] === tri[1] || tri[1] === tri[2] || tri[2] === tri[0]) {
        continue
      }
      for (let e = 0; e < 3; e++) {
        const u = tri[e]!
        const v = tri[(e + 1) % 3]!
        const key = u < v ? `${u}:${v}` : `${v}:${u}`
        edges.set(key, (edges.get(key) ?? 0) + 1)
      }
    }
    let closed = true
    for (const count of edges.values()) {
      if (count !== 2) {
        closed = false
      }
    }
    out.push({ faces, closed })
  }
  return out
}

// ─── The per-model contract ─────────────────────────────────────────────────

describe.each(KINDS)('leg garment: %s', kind => {
  const model = () => models.get(kind)!

  it('stays inside its budget, and is not trivially small', () => {
    expect(triangleCount(model().geometry)).toBeLessThanOrEqual(LEG_GARMENT_BUDGET[kind])
    // A model that lost a leg would sail through a ceiling check on its own — and
    // this is the one family in the folder where losing exactly half the model is
    // a plausible bug, because it is built as two parts from one profile.
    expect(triangleCount(model().geometry)).toBeGreaterThan(LEG_GARMENT_BUDGET[kind] * 0.55)
  })

  it('costs exactly what the sweep formula says, for two legs', () => {
    // Not a tautology: it is what catches a collapsed ring that failed to
    // collapse. `dropDegenerateFaces` charges `segments` triangles for a band that
    // ends on an apex and `2 × segments` for one that does not, so an end row
    // whose extent is 1e−9 instead of 0 costs 16 triangles and — much worse —
    // leaves a pinhole where the closure was meant to be.
    const stations = triangleCount(model().geometry) / 32 + 2
    expect(triangleCount(model().geometry)).toBe(legPairTriangles(stations))
  })

  it('carries every attribute the toon material reads', () => {
    for (const name of ['position', 'normal', 'color', 'aWind']) {
      expect(model().geometry.getAttribute(name), name).toBeTruthy()
    }
    expect(model().geometry.index).toBeTruthy()
  })

  it('emits only finite floats', () => {
    for (const name of ['position', 'normal', 'color']) {
      const array = model().geometry.getAttribute(name).array as ArrayLike<number>
      let bad = 0
      for (let i = 0; i < array.length; i++) {
        if (!Number.isFinite(array[i]!)) {
          bad++
        }
      }
      expect(bad, name).toBe(0)
    }
  })

  it('carries unit-length authored normals', () => {
    const normal = model().geometry.getAttribute('normal')
    let unnormalised = 0
    for (let i = 0; i < normal.count; i++) {
      const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))
      if (!(Math.abs(length - 1) < 2e-3)) {
        unnormalised++
      }
    }
    expect(unnormalised).toBe(0)
  })

  it('winds every face outward', () => {
    // The body shipped with the opposite of this and nothing caught it: its
    // normals were analytic and outward, its budget was fine, its floats were
    // finite, and it still rendered the inside of its own skull. Facing is
    // invisible to every attribute-level check, so it needs its own — and the
    // *right* leg is the case that matters here, because its section is mirrored
    // in X, which reverses the natural handedness of the sweep.
    expect(windingDisagreements(model().geometry)).toBe(0)
  })

  it('is two closed solids — every component, every edge shared exactly twice', () => {
    const components = componentsOf(
      model().geometry.index!.array as ArrayLike<number>,
      model().geometry.getAttribute('position').array as ArrayLike<number>
    )
    // Exactly two, and that is the assertion rather than "at least one": one
    // component means the legs met somewhere, which is the midline failure this
    // whole family is authored around.
    expect(components.length).toBe(2)
    for (const [i, component] of components.entries()) {
      expect(component.closed, `component ${i} of ${components.length}`).toBe(true)
    }
  })

  it('is never black, in any colourway (GDD R4)', () => {
    for (let seed = 1; seed <= LEG_GARMENT_COLOURWAYS[kind]; seed++) {
      expect(darkestColour(build(kind, seed).geometry), `seed ${seed}`).toBeGreaterThan(0.06)
    }
  })

  it('grips at the origin, and bounds itself honestly', () => {
    expect(model().grip).toEqual([0, 0, 0])
    const position = model().geometry.getAttribute('position')
    let furthest = 0
    for (let i = 0; i < position.count; i++) {
      furthest = Math.max(furthest, Math.hypot(position.getX(i), position.getY(i), position.getZ(i)))
    }
    expect(model().radius).toBeGreaterThanOrEqual(furthest - 1e-6)
    // And is not padded: an inflated radius silently disables culling.
    expect(model().radius).toBeLessThan(furthest * 1.02 + 1e-6)
  })

  it('is deterministic in shape and in colour for a given seed', () => {
    const again = build(kind, 1)
    for (const name of ['position', 'normal', 'color']) {
      const a = model().geometry.getAttribute(name).array as ArrayLike<number>
      const b = again.geometry.getAttribute(name).array as ArrayLike<number>
      expect(b.length, name).toBe(a.length)
      let mismatched = 0
      for (let i = 0; i < a.length; i++) {
        if (!(a[i] === b[i])) {
          mismatched++
        }
      }
      expect(mismatched, name).toBe(0)
    }
  })

  it('varies albedo with the seed but never shape', () => {
    const other = build(kind, 2)
    const positionA = model().geometry.getAttribute('position').array as ArrayLike<number>
    const positionB = other.geometry.getAttribute('position').array as ArrayLike<number>
    let moved = 0
    for (let i = 0; i < positionA.length; i++) {
      if (!(positionA[i] === positionB[i])) {
        moved++
      }
    }
    // Shape is authored. A trouser whose proportions varied by seed would only
    // clear the body for one of them.
    expect(moved).toBe(0)

    const colorA = model().geometry.getAttribute('color').array as ArrayLike<number>
    const colorB = other.geometry.getAttribute('color').array as ArrayLike<number>
    let differing = 0
    for (let i = 0; i < colorA.length; i++) {
      if (colorA[i] !== colorB[i]) {
        differing++
      }
    }
    expect(differing).toBeGreaterThan(colorA.length * 0.5)
  })
})

// ─── The two floors ─────────────────────────────────────────────────────────

describe('a leg garment is never narrower than the leg it replaces', () => {
  const BUILDS: Record<Sex, { limbScale: number; hipRadius: number; crossSection: readonly [number, number] }> = {
    male: { limbScale: 1, hipRadius: 0.15, crossSection: [1.15, 0.85] },
    female: { limbScale: 0.94, hipRadius: 0.163, crossSection: [1.08, 0.9] }
  }

  it.each(KINDS)('%s', kind => {
    for (const sex of ['male', 'female'] as Sex[]) {
      const shape = BUILDS[sex]
      const fit = legGarmentMargin(models.get(kind)!.geometry, shape.limbScale, shape.hipRadius, shape.crossSection)
      // Zero, and it is measured against the leg surface **re-derived at a 5 mm
      // pitch** rather than against the body's own vertices: `chibiGeometry`
      // builds a thigh with `rings: 1, capRings: 1`, so it has rings at four
      // heights and none at all across the mid-thigh — which is exactly where the
      // tightest bearing turns out to be.
      expect(fit.breaches, `${kind}/${sex}: leg samples outside the garment`).toBe(0)
      expect(
        fit.margin,
        `${kind}/${sex} at (${fit.at.map(n => n.toFixed(3)).join(', ')})`
      ).toBeGreaterThan(0)
      // And not a bell tent: past ~45 mm proud of the leg the figure stops reading
      // as a person in trousers.
      expect(fit.margin, `${kind}/${sex}`).toBeLessThan(0.045)
    }
  })
})

describe('a leg garment never crosses the midline', () => {
  it.each(KINDS)('%s', kind => {
    const fit = legGarmentMargin(models.get(kind)!.geometry)
    // The substitution splits left from right by the sign of x. A surface that
    // reaches past 0 is skinned to the opposite thigh, and 5 mm is the margin
    // that survives the spline's own approximation of the widest row.
    expect(fit.midlineClearance, kind).toBeGreaterThan(0.005)
  })

  it.each(KINDS)('%s keeps each leg entirely on its own side', kind => {
    const position = models.get(kind)!.geometry.getAttribute('position')
    let straddling = 0
    for (let i = 0; i < position.count; i++) {
      // Positive test, so a NaN counts as a straddle rather than sliding past.
      if (!(Math.abs(position.getX(i)) > 0.002)) {
        straddling++
      }
    }
    expect(straddling, kind).toBe(0)
  })
})

// ─── The skinning rule ──────────────────────────────────────────────────────

describe('what every vertex of every model does under the substitution rule', () => {
  // `legBoneWeights` belongs to `chibiGeometry.ts`, not here. What is asserted is
  // that **these models** sit inside the domain it is correct on — which is a
  // statement about the geometry, and is the reason `LEG_SECTION` is asymmetric.
  const skin: BoneWeights = emptyBoneWeights()

  it('weights every vertex to leg bones alone, summing to one', () => {
    const allowed = new Set([HIPS, THIGH_L, THIGH_R, SHIN_L, SHIN_R, FOOT_L, FOOT_R])
    for (const kind of KINDS) {
      const position = models.get(kind)!.geometry.getAttribute('position')
      for (let i = 0; i < position.count; i++) {
        // Models are authored in the hips-joint frame; the rule is called with
        // bind-pose **world** coordinates at both of its call sites in
        // `chibiGeometry.ts`, so the joint goes back on here.
        legBoneWeights(position.getX(i), position.getY(i) + HIPS_Y, position.getZ(i), skin)
        let total = 0
        for (let slot = 0; slot < 4; slot++) {
          if (skin.weight[slot]! === 0) {
            continue
          }
          expect(allowed.has(skin.index[slot]!), `${kind} vertex ${i} slot ${slot}`).toBe(true)
          expect(skin.weight[slot]!, `${kind} vertex ${i} slot ${slot}`).toBeGreaterThan(0)
          total += skin.weight[slot]!
        }
        expect(total, `${kind} vertex ${i}`).toBeCloseTo(1, 9)
      }
    }
  })

  it('keeps every vertex overwhelmingly on its own leg', () => {
    // The rule blends across a 12 mm band about x = 0 rather than splitting on the
    // sign, so a garment that reaches the midline does not *tear*. It does take a
    // share of the other leg, and through a stride the two thighs are 60° apart —
    // so the innermost sliver of cloth on the widest garment has to be
    // **overwhelmingly** its own leg's, not merely mostly.
    //
    // Measured: the closest any model comes to the midline is 7.8 mm (hose) to
    // 11.3 mm (plate legs), which is inside the band, and the worst minority share
    // that produces is a few per cent. That is the section's 8 % of inboard
    // asymmetry doing its job — without it the widest garment reaches x = 0, where
    // the share is 50 % and the cloth follows the average of two legs.
    for (const kind of KINDS) {
      const position = models.get(kind)!.geometry.getAttribute('position')
      let closest = Number.POSITIVE_INFINITY
      let worstShare = 0
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i)
        legBoneWeights(x, position.getY(i) + HIPS_Y, position.getZ(i), skin)
        const wrong = x >= 0 ? [THIGH_R, SHIN_R, FOOT_R] : [THIGH_L, SHIN_L, FOOT_L]
        let share = 0
        for (let slot = 0; slot < 4; slot++) {
          if (wrong.includes(skin.index[slot]!)) {
            share += skin.weight[slot]!
          }
        }
        worstShare = Math.max(worstShare, share)
        closest = Math.min(closest, Math.abs(x))
      }
      expect(worstShare, `${kind}, closest to the midline ${(closest * 1000).toFixed(1)} mm`).toBeLessThan(0.1)
      expect(closest, kind).toBeGreaterThan(0.005)
    }
  })

  it('rides the body own joints at the knee and the ankle', () => {
    // The seams that weld a leg garment to what is left of the figure, read back
    // out of the rule the substitution actually uses.
    const weightOn = (y: number, bone: number): number => {
      legBoneWeights(0.1, y, 0, skin)
      let sum = 0
      for (let slot = 0; slot < 4; slot++) {
        if (skin.index[slot] === bone) {
          sum += skin.weight[slot]!
        }
      }
      return sum
    }
    // The knee is an even split between thigh and shin.
    expect(weightOn(KNEE_Y, THIGH_L)).toBeCloseTo(0.5, 6)
    expect(weightOn(KNEE_Y, SHIN_L)).toBeCloseTo(0.5, 6)
    // Mid-thigh and mid-shin are one bone each.
    expect(weightOn(0.47, THIGH_L)).toBeCloseTo(1, 6)
    expect(weightOn(0.2, SHIN_L)).toBeCloseTo(1, 6)
    // The ankle closure rides the foot, which is what keeps the hem on the shoe.
    expect(weightOn(ANKLE_Y, FOOT_L)).toBeCloseTo(0.5, 6)
    expect(weightOn(ANKLE_Y - 0.05, FOOT_L)).toBeCloseTo(0.5, 6)
    // And the hip closure is rigid to the **pelvis**, not half-rigid to a swinging
    // leg — the one place the rule deliberately differs from the thigh part it
    // replaces, and the reason the HIP_ROWS apex stays buried through a stride.
    expect(weightOn(THIGH_Y + JOINT_BLEND * (THIGH_Y - KNEE_Y), HIPS)).toBeCloseTo(1, 3)
  })
})

// ─── Poses ──────────────────────────────────────────────────────────────────

const poseMatrices = (apply: (built: ReturnType<typeof buildSkeleton>) => void): Matrix4[] => {
  const built = buildSkeleton()
  apply(built)
  built.root.updateMatrixWorld(true)
  return built.skeleton.bones.map((bone, i) => new Matrix4().multiplyMatrices(bone.matrixWorld, built.skeleton.boneInverses[i]!))
}

/**
 * Bind pose, walk and run at four phases each with the bank at both extremes, and
 * the jump at four phases.
 *
 * Bind pose alone is emphatically not the test here. A torso garment's seams move
 * by the spine's counter-rotation; a **leg** garment's seams are the hip and the
 * knee, which sweep through tens of degrees every stride, and the closure that
 * holds in bind pose is the easy case.
 */
const seamPoses = (): { label: string; matrices: Matrix4[] }[] => {
  const list = [{ label: 'bind', matrices: poseMatrices(() => {}) }]
  for (let step = 0; step < 4; step++) {
    for (const bank of [-0.35, 0.35]) {
      for (const [name, weight] of [
        ['walk', 0],
        ['run', 1]
      ] as const) {
        list.push({
          label: `${name} ${step}/4 bank ${bank}`,
          matrices: poseMatrices(built => {
            applyGait(built.byName, step / 4, WALK, RUN, weight)
            applyBank(built.byName, bank)
          })
        })
      }
    }
    list.push({
      label: `jump ${step}/4`,
      matrices: poseMatrices(built => {
        applyJump(built.byName, step / 4)
      })
    })
  }
  return list
}

const POSES = seamPoses()

interface Soup {
  rest: Float32Array
  index: Uint32Array
  boneA: Uint16Array
  boneB: Uint16Array
  weightA: Float32Array
  weightB: Float32Array
}

const soupOf = (geometry: BufferGeometry): Soup => {
  const position = geometry.getAttribute('position')
  const skinIndex = geometry.getAttribute('skinIndex')
  const skinWeight = geometry.getAttribute('skinWeight')
  const source = geometry.getIndex()!
  const rest = new Float32Array(position.count * 3)
  const boneA = new Uint16Array(position.count)
  const boneB = new Uint16Array(position.count)
  const weightA = new Float32Array(position.count)
  const weightB = new Float32Array(position.count)
  for (let i = 0; i < position.count; i++) {
    rest[i * 3] = position.getX(i)
    rest[i * 3 + 1] = position.getY(i)
    rest[i * 3 + 2] = position.getZ(i)
    boneA[i] = skinIndex.getX(i)
    boneB[i] = skinIndex.getY(i)
    weightA[i] = skinWeight.getX(i)
    weightB[i] = skinWeight.getY(i)
  }
  const index = new Uint32Array(source.count)
  for (let i = 0; i < source.count; i++) {
    index[i] = source.getX(i)
  }
  return { rest, index, boneA, boneB, weightA, weightB }
}

const skinSoup = (soup: Soup, matrices: Matrix4[], out: Float32Array): void => {
  const point = new Vector3()
  const accumulated = new Vector3()
  for (let i = 0; i < soup.boneA.length; i++) {
    accumulated.set(0, 0, 0)
    if (soup.weightA[i]! !== 0) {
      point.fromArray(soup.rest, i * 3).applyMatrix4(matrices[soup.boneA[i]!]!).multiplyScalar(soup.weightA[i]!)
      accumulated.add(point)
    }
    if (soup.weightB[i]! !== 0) {
      point.fromArray(soup.rest, i * 3).applyMatrix4(matrices[soup.boneB[i]!]!).multiplyScalar(soup.weightB[i]!)
      accumulated.add(point)
    }
    out[i * 3] = accumulated.x
    out[i * 3 + 1] = accumulated.y
    out[i * 3 + 2] = accumulated.z
  }
}

const plainBody = (): BufferGeometry => buildChibiGeometry().geometry

/**
 * The figure with the legs substituted, as `chibiGeometry.ts` builds it.
 *
 * The budget is passed explicitly and that is **temporary**: `buildChibiGeometry`
 * adds `slotBudget('legs')` of its own, which is 0 until an `ItemKind` maps to the
 * `legs` slot in `equipment.ts`. Until the rows land, a leg garment is charged
 * against the body's own ceiling and overruns it. Adding the model's own allowance
 * here is exactly what a declared row will do for free, and the contract suite at
 * the bottom of this file fails the day the two disagree.
 */
const trousered = (kind: LegGarmentKind): BufferGeometry =>
  buildChibiGeometry(
    CHIBI_BUDGET + LEG_GARMENT_BUDGET[kind],
    `chibi/${kind}`,
    DEFAULT_APPEARANCE,
    null,
    models.get(kind)!.geometry
  ).geometry

// ─── Solidity, the test that earns the substitution ─────────────────────────

/** Faces bucketed by height, so a horizontal ray tests ~40 triangles, not 900. */
interface Slabs {
  min: number
  size: number
  buckets: number[][]
}

const slabsOf = (positions: Float32Array, index: Uint32Array, size = 0.02): Slabs => {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 1; i < positions.length; i += 3) {
    min = Math.min(min, positions[i]!)
    max = Math.max(max, positions[i]!)
  }
  const count = Math.max(1, Math.ceil((max - min) / size) + 1)
  const buckets: number[][] = Array.from({ length: count }, () => [])
  for (let f = 0; f < index.length; f += 3) {
    let low = Number.POSITIVE_INFINITY
    let high = Number.NEGATIVE_INFINITY
    for (let k = 0; k < 3; k++) {
      const y = positions[index[f + k]! * 3 + 1]!
      low = Math.min(low, y)
      high = Math.max(high, y)
    }
    const from = Math.max(0, Math.floor((low - min) / size))
    const to = Math.min(count - 1, Math.floor((high - min) / size))
    for (let b = from; b <= to; b++) {
      buckets[b]!.push(f)
    }
  }
  return { min, size, buckets }
}

const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _hit = new Vector3()

const blockedAtHeight = (ray: Ray, y: number, positions: Float32Array, index: Uint32Array, slabs: Slabs): boolean => {
  const bucket = slabs.buckets[Math.floor((y - slabs.min) / slabs.size)]
  if (!bucket) {
    return false
  }
  for (const f of bucket) {
    _a.fromArray(positions, index[f]! * 3)
    _b.fromArray(positions, index[f + 1]! * 3)
    _c.fromArray(positions, index[f + 2]! * 3)
    if (ray.intersectTriangle(_a, _b, _c, false, _hit)) {
      return true
    }
  }
  return false
}

describe('no leg garment opens a hole the legs were closing, in any pose', () => {
  // A **differential** test rather than an absolute one, and that is the point:
  // the shipped figure already has slots the substitution did not create (a 16 mm
  // one above each shoulder), so "no ray passes through the trousered figure"
  // would fail on a fault none of these introduced. What must hold is that every
  // ray the plain body stops, the trousered one stops too.
  //
  // The band is everything the substitution can touch — from below the sole to
  // above the hip dome — which is a much bigger span than a torso garment's two
  // narrow bands, because the whole leg is what changed.
  const BAND = [-0.06, 0.72]

  const plainSoup = soupOf(plainBody())
  const plainPosed = new Float32Array(plainSoup.rest.length)

  it.each(KINDS)(
    '%s',
    kind => {
      const dressedSoup = soupOf(trousered(kind))
      const dressedPosed = new Float32Array(dressedSoup.rest.length)
      const ray = new Ray()

      let cast = 0
      let holes = 0
      let firstHole = ''
      for (const pose of POSES) {
        skinSoup(plainSoup, pose.matrices, plainPosed)
        skinSoup(dressedSoup, pose.matrices, dressedPosed)
        const plainSlabs = slabsOf(plainPosed, plainSoup.index)
        const dressedSlabs = slabsOf(dressedPosed, dressedSoup.index)
        for (let bearing = 0; bearing < 8; bearing++) {
          const theta = (bearing / 8) * Math.PI * 2
          const dx = Math.sin(theta)
          const dz = Math.cos(theta)
          for (let side = -26; side <= 26; side++) {
            const offset = side * 0.01
            for (let y = BAND[0]!; y <= BAND[1]! + 1e-9; y += 0.01) {
              ray.origin.set(Math.cos(theta) * offset - dx * 3, y, -Math.sin(theta) * offset - dz * 3)
              ray.direction.set(dx, 0, dz)
              cast++
              if (
                blockedAtHeight(ray, y, plainPosed, plainSoup.index, plainSlabs) &&
                !blockedAtHeight(ray, y, dressedPosed, dressedSoup.index, dressedSlabs)
              ) {
                holes++
                if (!firstHole) {
                  firstHole = `${pose.label} at y=${y.toFixed(3)}, offset ${offset.toFixed(3)}, bearing ${bearing}`
                }
              }
            }
          }
        }
      }

      expect(cast).toBeGreaterThan(300_000)
      expect(holes, firstHole).toBe(0)
    },
    240_000
  )
})

/**
 * The radius out to which a **leg** is solid, minimised over poses.
 *
 * The absolute companion to the differential test, and the one that states the
 * invariant a hole violates directly: march outward from the leg's own axis and
 * you must not leave the figure and come back.
 *
 * The probe **rides the leg** rather than sitting in world space, and it has to:
 * a thigh swings through 60° of a run, so a ray cast from a fixed point leaves the
 * limb entirely at the extremes of a stride and reports a hole that is really a
 * camera in the wrong place. Origin and direction are carried by the same
 * two-bone blend the garment is skinned with, which is what makes the measurement
 * about the mesh rather than about the pose.
 *
 * Bearings are offset by a fraction of a step because the section's `v = 0` vertex
 * sits exactly on +Z: a ray straight down that bearing passes through a vertex and
 * is counted by both triangles sharing it, which flips the parity.
 */
const LEG_BANDS = [
  { name: 'thigh', low: 0.4, high: 0.56, cap: 0.06 },
  { name: 'knee', low: 0.3, high: 0.38, cap: 0.055 },
  { name: 'shin', low: 0.12, high: 0.28, cap: 0.055 }
]

const legSolidRadius = (geometry: BufferGeometry, poses: { label: string; matrices: Matrix4[] }[]) => {
  const soup = soupOf(geometry)
  const components = componentsOf(soup.index, soup.rest)
  const posedPositions = new Float32Array(soup.rest.length)
  const blend = new Matrix4()
  const ray = new Ray()
  const skin: BoneWeights = emptyBoneWeights()
  const worst = new Map<string, { radius: number; where: string }>()

  for (const pose of poses) {
    skinSoup(soup, pose.matrices, posedPositions)
    for (const band of LEG_BANDS) {
      for (let y = band.low; y <= band.high + 1e-9; y += 0.02) {
        for (const side of [1, -1]) {
          const axisX = side * (y >= KNEE_Y ? 0.09 + 0.01 * ((THIGH_Y - y) / (THIGH_Y - KNEE_Y)) : 0.1)
          legBoneWeights(axisX, y, 0, skin)
          for (let e = 0; e < 16; e++) {
            let sum = 0
            for (let slot = 0; slot < 4; slot++) {
              sum += skin.weight[slot]! * pose.matrices[skin.index[slot]!]!.elements[e]!
            }
            blend.elements[e] = sum
          }
          for (let bearing = 0; bearing < 12; bearing++) {
            const theta = ((bearing + 0.371) / 12) * Math.PI * 2
            ray.origin.set(axisX, y, 0).applyMatrix4(blend)
            ray.direction.set(Math.sin(theta), 0, Math.cos(theta)).transformDirection(blend)

            const crossings = components.map(() => [] as number[])
            for (let ci = 0; ci < components.length; ci++) {
              if (!components[ci]!.closed) {
                continue
              }
              for (const f of components[ci]!.faces) {
                _a.fromArray(posedPositions, soup.index[f]! * 3)
                _b.fromArray(posedPositions, soup.index[f + 1]! * 3)
                _c.fromArray(posedPositions, soup.index[f + 2]! * 3)
                if (ray.intersectTriangle(_a, _b, _c, false, _hit)) {
                  crossings[ci]!.push(_hit.distanceTo(ray.origin))
                }
              }
            }
            const insideAt = (radius: number): boolean => {
              for (const list of crossings) {
                let above = 0
                for (const distance of list) {
                  if (distance > radius) {
                    above++
                  }
                }
                if (above % 2 === 1) {
                  return true
                }
              }
              return false
            }
            let solid = band.cap
            for (let radius = 0.02; radius <= band.cap + 1e-9; radius += 0.005) {
              if (!insideAt(radius)) {
                solid = radius
                break
              }
            }
            const current = worst.get(band.name)
            if (!current || solid < current.radius) {
              worst.set(band.name, {
                radius: solid,
                where: `${pose.label}, y=${y.toFixed(2)}, side ${side > 0 ? 'L' : 'R'}, bearing ${bearing}`
              })
            }
          }
        }
      }
    }
  }
  return worst
}

describe('every leg stays solid out from its own axis, in every pose', () => {
  const plainSolid = legSolidRadius(plainBody(), POSES)

  it.each(KINDS)(
    '%s',
    kind => {
      const solid = legSolidRadius(trousered(kind), POSES)
      for (const band of LEG_BANDS) {
        const dressed = solid.get(band.name)!
        const bare = plainSolid.get(band.name)!
        // Never worse than the leg it replaces. Self-adjusting on purpose, so a
        // future change to the body cannot quietly move the goalposts.
        expect(
          dressed.radius,
          `${kind} ${band.name}: dressed ${dressed.where} vs plain ${bare.where}`
        ).toBeGreaterThanOrEqual(bare.radius - 1e-9)
        // The floor is the **plain figure's own** number rather than a constant,
        // and that is not a dodge. At the deepest phase of a run the hip is past
        // 60° and the knee past 90°, and the probe's origin — which rides the same
        // two-bone blend the joint carries — sits on the *chord* of that bend
        // rather than inside the limb. Measured, the plain body reports 0.02 at
        // the thigh and 0.035 at the knee there, so an absolute floor of 0.05
        // would be a test about linear blend skinning and not about these models.
        // What is left is still enough to catch a NaN and an empty mesh.
        expect(bare.radius, `${band.name} plain at ${bare.where}`).toBeGreaterThanOrEqual(0.02)
      }
    },
    240_000
  )
})

describe('every leg garment buries its four closures inside its neighbours, in every pose', () => {
  // The structural version of the same claim, and the one that produces a number.
  //
  // Every part of this figure is a **closed** solid, so if the garment's volume
  // and its neighbour's volume intersect, their union has no crack between them
  // whatever the viewing angle. The strongest statement of that is about the
  // *closures themselves*: each leg ends in a collapsed ring, and a collapsed ring
  // that is outside its neighbour is a visible cone tip sticking out of the hip or
  // the shoe. Buried, it cannot be seen at all — which is the whole reason the
  // profile ends where it does rather than at the joint.
  //
  // The neighbours are found by connected component rather than named, because
  // that is what makes the parity test valid: the figure is a *union* of
  // overlapping solids, and parity over the whole index buffer counts a thigh's
  // surface inside the pelvis as a boundary crossing.
  const ownerOf = (geometry: BufferGeometry, faces: number[]): number =>
    geometry.getAttribute('skinIndex').getX(geometry.index!.getX(faces[0]!))

  const apexSkin: BoneWeights = emptyBoneWeights()

  it.each(KINDS)(
    '%s',
    kind => {
      const built = buildChibiGeometry(
        CHIBI_BUDGET + LEG_GARMENT_BUDGET[kind],
        `chibi/${kind}`,
        DEFAULT_APPEARANCE,
        null,
        models.get(kind)!.geometry
      )
      const dressed = built.geometry
      const soup = soupOf(dressed)
      const components = componentsOf(soup.index, soup.rest)
      const legCount = models.get(kind)!.geometry.getAttribute('position').count
      // **Not the tail of the buffer.** `chibiGeometry` appends body → substituted
      // garments → ears → hair → face, so the garment block ends where the ears
      // begin. Taking it off the end instead picks up hair and face vertices, and
      // the "topmost vertex of the left leg" comes out somewhere on the skull —
      // which fails this test for a reason that has nothing to do with the leg.
      const garmentFrom = built.blocks.ears - legCount

      const torso = components.find(component => ownerOf(dressed, component.faces) === HIPS)
      const feet = components.filter(component => {
        const owner = ownerOf(dressed, component.faces)
        return owner === FOOT_L || owner === FOOT_R
      })
      expect(torso, `${kind}: no torso component`).toBeTruthy()

      // The four closures: the highest and lowest vertex of each leg.
      const apexes: { name: string; index: number; into: { faces: number[] } }[] = []
      const ankles: { name: string; index: number; side: number }[] = []
      for (const side of [1, -1]) {
        let top = -1
        let bottom = -1
        for (let i = garmentFrom; i < built.blocks.ears; i++) {
          if (Math.sign(soup.rest[i * 3]!) !== side) {
            continue
          }
          if (top < 0 || soup.rest[i * 3 + 1]! > soup.rest[top * 3 + 1]!) {
            top = i
          }
          if (bottom < 0 || soup.rest[i * 3 + 1]! < soup.rest[bottom * 3 + 1]!) {
            bottom = i
          }
        }
        apexes.push({ name: `${side > 0 ? 'L' : 'R'} hip apex`, index: top, into: torso! })
        ankles.push({ name: `${side > 0 ? 'L' : 'R'} ankle apex`, index: bottom, side })
      }
      expect(feet.length, `${kind}: feet`).toBe(2)

      const posed = new Float32Array(soup.rest.length)
      const probe = new Vector3()
      const ray = new Ray()

      /** Parity over one component alone: odd crossings means inside it. */
      const insideComponent = (point: Vector3, faces: number[]): boolean => {
        ray.origin.copy(point)
        ray.direction.set(0.5121, 0.6042, 0.6104).normalize()
        let crossings = 0
        for (const f of faces) {
          _a.fromArray(posed, soup.index[f]! * 3)
          _b.fromArray(posed, soup.index[f + 1]! * 3)
          _c.fromArray(posed, soup.index[f + 2]! * 3)
          if (ray.intersectTriangle(_a, _b, _c, false, _hit)) {
            crossings++
          }
        }
        return crossings % 2 === 1
      }

      for (const pose of POSES) {
        skinSoup(soup, pose.matrices, posed)
        for (const apex of apexes) {
          probe.fromArray(posed, apex.index * 3)
          expect(insideComponent(probe, apex.into.faces), `${kind} ${apex.name} at ${pose.label}`).toBe(true)
        }
      }

      // ── The ankle closure is the one that cannot be buried, and says so ────
      //
      // The `foot` part is the only neighbour down there and its start ball is
      // **smaller than the shin cap the substitution removes** (0.060 against
      // 0.072), so an apex inside the foot leaves that shell unclosed. The apex
      // therefore sits below the foot rather than inside it, and what is asserted
      // is the honest weaker claim: it is rigid to the same 50/50 shin/foot blend
      // the ankle joint itself carries — so this is pose-invariant and one check
      // covers every pose — and it is within a shin-cap radius of that joint, i.e.
      // no further out than the part it replaces reached, plus the 12 mm of
      // rounding the tip needs.
      const ankle = boneDefinition('foot.L').head
      for (const closure of ankles) {
        const x = soup.rest[closure.index * 3]!
        // `soup.rest` is already bind-pose **world** space — the substitution adds
        // the hips joint on the way in — so no second translation here.
        const y = soup.rest[closure.index * 3 + 1]!
        const z = soup.rest[closure.index * 3 + 2]!
        const distance = Math.hypot(x - closure.side * ankle[0], y - ankle[1], z)
        expect(distance, `${kind} ${closure.name} from the ankle joint`).toBeLessThan(0.072 + 0.014)
        legBoneWeights(x, y, z, apexSkin)
        const foot = closure.side > 0 ? FOOT_L : FOOT_R
        let onFoot = 0
        for (let slot = 0; slot < 4; slot++) {
          if (apexSkin.index[slot] === foot) {
            onFoot += apexSkin.weight[slot]!
          }
        }
        expect(onFoot, `${kind} ${closure.name} foot blend`).toBeCloseTo(0.5, 6)
      }
    },
    240_000
  )
})

// ─── The interaction with the long-hemmed torso garments ────────────────────

describe('a leg garment under a long hem', () => {
  /**
   * The four torso garments with a hem below `HEM_FLOOR`, and the height of each.
   *
   * The `mantle` is **not** one of them, which is worth stating because it looks
   * like one: its cape falls to 0.824 but its *body* hem is at 0.578, above every
   * leg. A mantle shows the whole leg.
   */
  const LONG_HEMS: GarmentKind[] = ['robe', 'hoodedRobe', 'dress', 'pinafore']

  const hemOf = (kind: GarmentKind): number => {
    const position = GARMENT_BUILDERS[kind]({ seed: 1 }).geometry.getAttribute('position')
    let low = Number.POSITIVE_INFINITY
    for (let i = 0; i < position.count; i++) {
      low = Math.min(low, position.getY(i) + HIPS_Y)
    }
    return low
  }

  /** Farthest hit on `geometry` along a horizontal bearing through the figure's axis. */
  const shellAt = (geometry: BufferGeometry, y: number, dx: number, dz: number): number => {
    const position = geometry.getAttribute('position')
    const index = geometry.index!
    const array = position.array as ArrayLike<number>
    const ray = new Ray()
    ray.origin.set(0, y - HIPS_Y, 0)
    ray.direction.set(dx, 0, dz)
    let shell = -1
    for (let f = 0; f < index.count; f += 3) {
      _a.fromArray(array as number[], index.getX(f) * 3)
      _b.fromArray(array as number[], index.getX(f + 1) * 3)
      _c.fromArray(array as number[], index.getX(f + 2) * 3)
      if (ray.intersectTriangle(_a, _b, _c, false, _hit)) {
        shell = Math.max(shell, Math.hypot(_hit.x, _hit.z))
      }
    }
    return shell
  }

  it.each(LONG_HEMS)('%s hangs clear of every leg garment above its hem', hem => {
    const skirt = GARMENT_BUILDERS[hem]({ seed: 1 }).geometry
    const hemY = hemOf(hem)
    // The four are 0.358–0.432, i.e. between the knee (0.33) and mid-thigh. Every
    // one therefore hides the whole thigh and shows the whole shin.
    expect(hemY).toBeGreaterThan(KNEE_Y)
    expect(hemY).toBeLessThan(0.45)

    for (const kind of KINDS) {
      const legs = models.get(kind)!.geometry
      let worst = Number.POSITIVE_INFINITY
      let where = ''
      // Only the band the two share: from the hem up to where the skirt's own
      // waist takes over.
      for (let y = hemY + 0.01; y <= 0.56; y += 0.01) {
        for (let bearing = 0; bearing < 16; bearing++) {
          const theta = ((bearing + 0.371) / 16) * Math.PI * 2
          const dx = Math.sin(theta)
          const dz = Math.cos(theta)
          const cloth = shellAt(skirt, y, dx, dz)
          const leg = shellAt(legs, y, dx, dz)
          if (cloth < 0 || leg < 0) {
            continue
          }
          if (cloth - leg < worst) {
            worst = cloth - leg
            where = `${kind} under ${hem} at y=${y.toFixed(2)}, bearing ${bearing}`
          }
        }
      }
      // Positive means the leg garment is inside the skirt at every bearing and
      // every height they share, so it is *hidden* rather than poking through.
      // This is the assertion that decides the interaction: the right behaviour
      // is neither to suppress the legs nor to accept an overlap, it is to size
      // them so the question never arises — and 15 mm is what the four hems leave
      // once the widest leg garment (the rolled trouser's turn-up) is accounted
      // for.
      expect(worst, where).toBeGreaterThan(0.008)
    }
  })

  it('leaves most of a leg garment visible under even the longest hem', () => {
    // The other half of the interaction, and the reason suppression is the wrong
    // answer. The hems sit at 0.358–0.432 against a leg garment that spans
    // −0.042 to 0.692: **44–52 %** of it is below the lowest hem in the wardrobe,
    // and that half is the shin — which is where the plate greave, the bare calf
    // and the ankle gather all live. Hiding the legs under a robe would hide the
    // half that reads.
    const legs = models.get('hose')!.geometry.getAttribute('position')
    let low = Number.POSITIVE_INFINITY
    let high = Number.NEGATIVE_INFINITY
    for (let i = 0; i < legs.count; i++) {
      low = Math.min(low, legs.getY(i) + HIPS_Y)
      high = Math.max(high, legs.getY(i) + HIPS_Y)
    }
    for (const hem of LONG_HEMS) {
      const visible = (hemOf(hem) - low) / (high - low)
      expect(visible, hem).toBeGreaterThan(0.4)
    }
  })
})

// ─── The contract rows these models need ────────────────────────────────────

describe('the contract rows these models need', () => {
  // `equipment.ts` is not this module's to edit, so the budgets and the slot
  // mapping live next to the models. These assertions are written to pass **both
  // before and after** the rows land: while a kind is absent they assert nothing
  // about it, and the moment it appears they assert it agrees. That is what stops
  // the two copies from drifting in the interval.
  const declaredBudget = (kind: string): number | undefined => (EQUIPMENT_BUDGET as Record<string, number | undefined>)[kind]
  const declaredSlot = (kind: string): string | undefined => (ITEM_SLOT as Record<string, string | undefined>)[kind]
  const declaredStow = (kind: string): string | null | undefined =>
    (STOW_SOCKET as Record<string, string | null | undefined>)[kind]
  const declaredDrawn = (kind: string): string | null | undefined =>
    (DRAWN_SOCKET as Record<string, string | null | undefined>)[kind]

  it('agrees with EQUIPMENT_BUDGET wherever a row already exists', () => {
    for (const kind of KINDS) {
      const declared = declaredBudget(kind)
      if (declared !== undefined) {
        expect(declared, kind).toBe(LEG_GARMENT_BUDGET[kind])
      }
    }
  })

  it('puts every leg garment in the legs slot with no socket', () => {
    for (const kind of KINDS) {
      const slot = declaredSlot(kind)
      if (slot !== undefined) {
        expect(slot, kind).toBe('legs')
        // A body slot has no socket, because there is nothing to parent: the
        // geometry is merged into the skinned mesh.
        expect(declaredStow(kind), kind).toBeNull()
        expect(declaredDrawn(kind), kind).toBeNull()
      }
    }
  })

  it('names four models and enough colourways to dress a town', () => {
    expect(KINDS.length).toBe(4)
    let total = 0
    for (const kind of KINDS) {
      expect(LEG_GARMENT_COLOURWAYS[kind], kind).toBeGreaterThanOrEqual(4)
      total += LEG_GARMENT_COLOURWAYS[kind]
    }
    expect(total).toBeGreaterThanOrEqual(20)
  })

  it('costs the crowd what the budget note claims', () => {
    // The numbers in `legGarments.ts`'s header, asserted so they cannot rot.
    const bare = triangleCount(buildChibiGeometry().geometry)
    // The body's own thigh and shin parts: `limbMesh` with `radial: 6, rings: 1,
    // capRings: 1` is four rings, three bands, 36 triangles — twice per leg.
    const dressedHose = triangleCount(trousered('hose'))
    expect(bare - (dressedHose - triangleCount(models.get('hose')!.geometry))).toBe(144)
    // So the dearest garment is +236 net per wearer, in the same draw calls and
    // the same two programs.
    expect(Math.max(...KINDS.map(kind => LEG_GARMENT_BUDGET[kind])) - 144).toBe(236)
    const dressed = triangleCount(trousered('plateLegs'))
    expect(dressed - bare).toBe(triangleCount(models.get('plateLegs')!.geometry) - 144)
  })
})
