import { describe, expect, it } from 'vitest'
import { Color, Triangle, Vector3 } from 'three'
import { CHIBI_BUDGET, buildChibiGeometry } from '@/world/characters/chibiGeometry'
import {
  BROW_COLUMNS,
  BROW_VERTICES,
  DEFAULT_FACE,
  EYE_STYLES,
  EYE_VERTICES,
  FACE_TRIANGLES,
  FACE_VERTICES,
  HEAD,
  MOUTH_STYLES,
  MOUTH_VERTICES,
  appendFace,
  faceMesh,
  type FaceMesh,
  type FaceStyle
} from '@/world/characters/face'
import { DEFAULT_APPEARANCE, type HairStyle, type HeadShape } from '@/world/characters/equipment'
import { limbMesh } from '@/world/characters/limb'
import { BONE_NAMES } from '@/world/characters/rig'
import { HAIRLINE, headWarp, warpVertex } from '@/world/characters/variants'
import { C } from '@/world/art/palette'
import { triangleCount } from '@/world/geometry/budget'

/**
 * ─── The face contract ──────────────────────────────────────────────────────
 *
 * A face fails in ways the body cannot. It is the smallest field on the figure
 * and the first place a player looks, so every one of its failure modes is both
 * subtle in code and glaring on screen:
 *
 * • Weighted *rigidly* to `head` and it shears off the skull when the head
 *   turns — and only when it turns, which reads as a rendering glitch. The
 *   intuitive binding is the broken one; see the note on the binding test and
 *   the measured 49.6 mm in `characterFaceShear.test.ts`.
 * • Placed on the head's *ideal* ellipsoid instead of its built one and it
 *   hovers 15–19 mm off the face, because a 9-gon's facets are that far inside
 *   the ellipsoid they are inscribed in.
 * • Placed 20 mm higher and it is in the hair, because the head's colour ramp
 *   turns the whole upper hemisphere into a bowl cut at y = 1.29.
 * • Wound the wrong way and it disappears under `FrontSide` while *appearing*
 *   in the `BackSide` outline pass as a solid dark plate.
 *
 * None of these throw. All of them look like "the character has no face".
 *
 * ── And once there are fifty faces ──────────────────────────────────────────
 *
 * Ten eye styles and five mouths multiply every one of those failure modes by
 * fifty, and `buildChibiGeometry` only ever builds the *one* combination it was
 * handed — so a suite that checks the default checks 2 % of what ships. Every
 * invariant below therefore runs over the whole cross product, on the canonical
 * head and again through all four head-shape warps.
 *
 * The default's own tests stay separate and stay first: `bright` + `smile` is
 * pinned byte-for-byte by `characterVariants.test.ts`, so it is the one style
 * that is allowed to be checked against absolute numbers rather than against the
 * others.
 */

const { geometry } = buildChibiGeometry()
const face = faceMesh()

const position = geometry.getAttribute('position')
const normal = geometry.getAttribute('normal')
const color = geometry.getAttribute('color')
const skinIndex = geometry.getAttribute('skinIndex')
const skinWeight = geometry.getAttribute('skinWeight')

/** The face is appended last, so it is the tail of every attribute. */
const faceStart = position.count - FACE_VERTICES
const headBone = BONE_NAMES.indexOf('head')
const neckBone = BONE_NAMES.indexOf('neck')

/**
 * The lowest painted hairline any style has, in the head part's own units and
 * then in metres.
 *
 * Derived from `HAIRLINE` rather than written down, because the number moved
 * once already: it was −0.25 while the face's ceiling was the top of the eye,
 * and it is +0.45 now that the face has brows. A test written against
 * `HEAD.hairlineY` measures the ramp's *origin*, which is not a line any
 * character in the game actually has.
 */
const LOWEST_HAIRLINE = Math.min(...Object.values(HAIRLINE))
const LOWEST_HAIRLINE_Y = HEAD.hairlineY + LOWEST_HAIRLINE * (HEAD.top[1] - HEAD.centre[1])

/** Block offsets inside the face. Eyes, then the mouth, then the two brows. */
const MOUTH_START = EYE_VERTICES
const BROW_START = EYE_VERTICES + MOUTH_VERTICES

const HEAD_CENTRE = new Vector3(HEAD.centre[0], HEAD.centre[1], HEAD.centre[2])

/** The head exactly as `chibiGeometry` builds it, rebuilt from `face.ts`'s spec. */
const head = limbMesh({
  from: new Vector3(HEAD.centre[0], HEAD.centre[1], HEAD.centre[2]),
  to: new Vector3(HEAD.top[0], HEAD.top[1], HEAD.top[2]),
  radiusStart: HEAD.radius,
  radiusEnd: HEAD.radius,
  radial: HEAD.radial,
  rings: HEAD.rings,
  capRings: HEAD.capRings,
  crossSection: [1, HEAD.widthScale]
})

const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _closest = new Vector3()
const _triangle = new Triangle()

/**
 * Distance from a point to the head's nearest *triangle*.
 *
 * Closest-point rather than a ray cast on purpose: `face.ts` places vertices by
 * casting a radial ray, so a test that cast the same ray would only prove the
 * code ran. This measures the thing the eye actually judges — the gap between
 * the feature and the skull — by a different method.
 */
const _query = new Vector3()

const gapTo = (surface: Float32Array, index: ArrayLike<number>, point: Vector3): number => {
  // Copied first: `_a`..`_c` below are the triangle corners, and callers hand
  // this function one of them as scratch. Reading a query point that the loop
  // then overwrites returns a flawless distance of zero.
  _query.copy(point)
  let best = Infinity
  for (let i = 0; i < index.length; i += 3) {
    _a.fromArray(surface, index[i]! * 3)
    _b.fromArray(surface, index[i + 1]! * 3)
    _c.fromArray(surface, index[i + 2]! * 3)
    _triangle.set(_a, _b, _c)
    _triangle.closestPointToPoint(_query, _closest)
    best = Math.min(best, _closest.distanceTo(_query))
  }
  return best
}

const gapToHead = (point: Vector3): number => gapTo(head.position, head.index, point)

/** Outward normal of the head's smooth ellipsoid at a point on it. */
const idealNormal = (point: Vector3, out: Vector3): Vector3 =>
  out.set(point.x / (HEAD.widthScale * HEAD.widthScale), point.y - HEAD.centre[1], point.z).normalize()

/**
 * Relative luminance in the space the palette was *authored* in.
 *
 * `THREE.Color` holds linear-sRGB, and in linear space every dark albedo in this
 * project sits near 0.015 — `hairDark`, which the boots have shipped with since
 * the figure existed, is 0.0154. A linear threshold of 0.02 would therefore fail
 * on the body, not on the face, and would be a test about colour management
 * rather than about R4. R4 bans *black*, and black is a statement about the
 * authored value.
 */
const authoredLuma = (r: number, g: number, b: number): number => {
  const srgb = new Color(r, g, b).convertLinearToSRGB()
  return 0.2126 * srgb.r + 0.7152 * srgb.g + 0.0722 * srgb.b
}

describe('the head, as face.ts believes it to be', () => {
  it('matches the head the chibi geometry actually ships', () => {
    // `face.ts` mirrors the head's `PartSpec` rather than importing it, to keep
    // its footprint in `chibiGeometry.ts` to a single call. This is the pin.
    let maxX = 0
    let maxZ = 0
    let maxY = -Infinity
    for (let i = 0; i < position.count; i++) {
      maxY = Math.max(maxY, position.getY(i))
      const y = position.getY(i)
      if (y > HEAD.hairlineY - 0.002 && y < HEAD.hairlineY + 0.002) {
        maxX = Math.max(maxX, position.getX(i))
        maxZ = Math.max(maxZ, position.getZ(i))
      }
    }
    // Depth is the full radius; width is the squashed one. If these two ever
    // swap, `crossSection` has been re-read as front-to-back and every feature
    // is 6 % off across the face.
    expect(maxZ).toBeCloseTo(HEAD.radius, 4)
    const widest = Math.max(...Array.from({ length: HEAD.radial }, (_, k) => Math.abs(Math.sin((k / HEAD.radial) * Math.PI * 2))))
    expect(maxX).toBeCloseTo(HEAD.widthScale * HEAD.radius * widest, 4)
    // Crown = cap centre + radius + axis.
    expect(maxY).toBeCloseTo(HEAD.top[1] + HEAD.radius, 4)
  })
})

describe('the face is on the figure', () => {
  it('adds exactly the triangles it claims', () => {
    expect(face.index.length / 3).toBe(FACE_TRIANGLES)
    expect(face.position.length / 3).toBe(FACE_VERTICES)
  })

  it('stays inside the GDD §4.1 budget for a chibi human', () => {
    // 654 body + 38 face = 692 at the time of writing. The body's own count is
    // deliberately not asserted here — it belongs to `chibi.test.ts`, and
    // pinning it from the face suite would fail the wrong file when a limb
    // changes. What the face owes is the ceiling and its own share of it.
    expect(triangleCount(geometry)).toBeLessThanOrEqual(CHIBI_BUDGET)
    expect(triangleCount(geometry)).toBeGreaterThan(FACE_TRIANGLES + 400)
  })

  it('reached the shipped geometry, in every palette colour it uses', () => {
    // Proves the hook in `chibiGeometry.ts` fires. Asserting the tail vertex
    // count alone would pass on an empty append.
    const wanted = [C.eyeDark, C.eyeLight, C.faceLine]
    const found = wanted.map(() => 0)
    for (let i = faceStart; i < position.count; i++) {
      for (let w = 0; w < wanted.length; w++) {
        const target = wanted[w]!
        if (
          Math.abs(color.getX(i) - target.r) < 1e-5 &&
          Math.abs(color.getY(i) - target.g) < 1e-5 &&
          Math.abs(color.getZ(i) - target.b) < 1e-5
        ) {
          found[w] = found[w]! + 1
        }
      }
    }
    expect(found[0], 'eyeDark vertices').toBeGreaterThan(20)
    expect(found[1], 'eyeLight vertices').toBe(8)
    expect(found[2], 'faceLine vertices').toBe(8)
  })
})

describe('the face is bound to the head', () => {
  /**
   * The face adopts the skull's binding rather than asserting weight 1 on
   * `head`, and the difference is not academic.
   *
   * Weight 1 is the intuitive choice — "the face is part of the head" — and it
   * is what this suite originally asserted. But the head part's lower cap, which
   * is the whole of where a face sits, is inside `chibiGeometry`'s ramp toward
   * `neck` at up to a 50/50 split. A rigid face on a blended skull separates the
   * moment the head bone turns, and `poses.ts` turns it in every state (gait
   * counter-roll, turn lean, jump crouch, idle sway).
   *
   * Measured with weight 1: **49.6 mm of slide at 25° of head yaw** on a 250 mm
   * head. So the invariant is *not* "weight 1" — it is "the same weights as the
   * surface underneath", which the shear test below measures directly.
   */
  it('binds every face vertex to head and neck only, blended like the skull', () => {
    let wrong = 0
    let anyBlended = 0
    for (let i = faceStart; i < position.count; i++) {
      const primary = skinIndex.getX(i)
      const secondary = skinIndex.getY(i)
      const sum = skinWeight.getX(i) + skinWeight.getY(i)
      if (primary !== headBone) wrong++
      else if (secondary !== headBone && secondary !== neckBone) wrong++
      else if (Math.abs(sum - 1) > 1e-5) wrong++
      else if (skinWeight.getZ(i) !== 0 || skinWeight.getW(i) !== 0) wrong++
      if (skinWeight.getY(i) > 0.01) anyBlended++
    }
    expect(wrong).toBe(0)
    // If nothing blends, the fix has been reverted and the shear is back.
    expect(anyBlended).toBeGreaterThan(0)
  })

  it('leaves the joint blending on the body alone', () => {
    // The face rides the skull's blend; the body must still have its own.
    let blended = 0
    for (let i = 0; i < faceStart; i++) {
      if (skinWeight.getY(i) > 0.05) {
        blended++
      }
    }
    expect(blended / faceStart).toBeGreaterThan(0.15)
  })
})

describe('the face is on the head, not near it', () => {
  it('sits on the built surface — not on the ideal ellipsoid it is inscribed in', () => {
    // The ideal surface is up to 19 mm outside the real one in the eye region.
    // This is the assertion that would have caught eyes floating off the face.
    let minGap = Infinity
    let maxGap = -Infinity
    for (let i = faceStart; i < position.count; i++) {
      const gap = gapToHead(_a.set(position.getX(i), position.getY(i), position.getZ(i)))
      minGap = Math.min(minGap, gap)
      maxGap = Math.max(maxGap, gap)
    }
    // Lower bound: enough to never z-fight at any distance the player sees a
    // face from. Upper bound: the eye's dome apex plus its catchlight.
    expect(minGap, 'closest face vertex to the skull').toBeGreaterThan(0.001)
    expect(maxGap, 'furthest face vertex from the skull').toBeLessThan(0.006)
  })

  it('keeps every feature below the hairline', () => {
    // The head's colour ramp makes everything above the line hair. A feature
    // that crosses it is a dark shape drawn on a dark bowl cut.
    //
    // **The line is the style's, not `HEAD.hairlineY`.** It used to be safe to
    // read the ramp's origin at y = 1.29 as "the hairline", because every style
    // sat at or above it and the face's ceiling was 13 mm below. Neither holds:
    // the brows put the face's ceiling 11 mm higher, and `HAIRLINE`'s floor moved
    // to +0.35 to make room. Testing against 1.29 now tests a line no character
    // in the game has.
    let above = 0
    let highest = -Infinity
    for (let i = faceStart; i < position.count; i++) {
      highest = Math.max(highest, position.getY(i))
      if (position.getY(i) >= LOWEST_HAIRLINE_Y) {
        above++
      }
    }
    expect(above).toBe(0)
    // And with real clearance, not by a micron — the fringe has to read as a
    // fringe above the brows rather than as an eyelid on them.
    expect(LOWEST_HAIRLINE_Y - highest).toBeGreaterThan(0.008)
  })

  it('faces forward and is left-right symmetric', () => {
    let behind = 0
    let sumX = 0
    for (let i = faceStart; i < position.count; i++) {
      if (position.getZ(i) <= 0) {
        behind++
      }
      sumX += position.getX(i)
    }
    expect(behind, 'face vertices on the back of the head').toBe(0)
    // The mouth is centred and the eyes mirror, so x sums to zero. A single
    // mis-mirrored feature moves this well clear of the tolerance.
    // 1e-4 rather than exact zero: the placement ray-casts against the head, so
    // the two sides agree to float precision, not bit-for-bit. A single
    // mis-mirrored feature moves this by ~0.01.
    expect(Math.abs(sumX)).toBeLessThan(1e-4)
  })
})

describe('the face is shaded like the head it sits on', () => {
  it('emits only finite floats', () => {
    for (const attribute of [position, normal, color, skinWeight]) {
      const array = attribute.array as ArrayLike<number>
      let bad = 0
      for (let i = faceStart * attribute.itemSize; i < array.length; i++) {
        // Positive test: every comparison against NaN is false, so a range check
        // would pass on the exact bug it exists to catch.
        if (!Number.isFinite(array[i]!)) {
          bad++
        }
      }
      expect(bad).toBe(0)
    }
  })

  it('carries unit-length normals', () => {
    let unnormalised = 0
    for (let i = faceStart; i < normal.count; i++) {
      const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))
      if (!(Math.abs(length - 1) < 2e-3)) {
        unnormalised++
      }
    }
    expect(unnormalised).toBe(0)
  })

  it('points its normals outward, close to the ones the head uses', () => {
    // The blend toward the head's normal (GDD R3) means a face normal can never
    // be far from it. A feature normal that drifted past ~25° would be shading
    // itself as a separate object — the failure the blend exists to prevent —
    // and one that inverted would light the eye from inside the skull.
    let worst = 1
    for (let i = faceStart; i < normal.count; i++) {
      idealNormal(_a.set(position.getX(i), position.getY(i), position.getZ(i)), _b)
      _c.set(normal.getX(i), normal.getY(i), normal.getZ(i))
      worst = Math.min(worst, _b.dot(_c))
    }
    expect(worst).toBeGreaterThan(0.9)
  })

  it('winds every face triangle outward', () => {
    // Backwards winding hides the feature under `FrontSide` and *shows* it in
    // the `BackSide` outline pass — a dark plate where an eye should be.
    const index = geometry.index!
    let inverted = 0
    for (let t = 0; t < index.count; t += 3) {
      const ia = index.getX(t)
      if (ia < faceStart) {
        continue
      }
      const ib = index.getX(t + 1)
      const ic = index.getX(t + 2)
      _a.set(position.getX(ia), position.getY(ia), position.getZ(ia))
      _b.set(position.getX(ib), position.getY(ib), position.getZ(ib))
      _c.set(position.getX(ic), position.getY(ic), position.getZ(ic))
      _triangle.set(_a, _b, _c)
      _triangle.getNormal(_closest)
      idealNormal(_a, _b)
      if (_closest.dot(_b) <= 0) {
        inverted++
      }
    }
    expect(inverted).toBe(0)
  })

  it('never paints a face vertex black (R4)', () => {
    let darkest = 1
    for (let i = faceStart; i < color.count; i++) {
      darkest = Math.min(darkest, authoredLuma(color.getX(i), color.getY(i), color.getZ(i)))
    }
    expect(darkest).toBeGreaterThan(0.02)
  })
})

// ─── Every style, not just the shipped one ──────────────────────────────────

const STYLES: FaceStyle[] = []
for (const eyes of EYE_STYLES) {
  for (const mouth of MOUTH_STYLES) {
    STYLES.push({ eyes, mouth })
  }
}

const name = (style: FaceStyle): string => `${style.eyes}/${style.mouth}`

/** Built once — 50 faces, each of which ray-casts 50 vertices onto 162 triangles. */
const BUILT: { style: FaceStyle; mesh: FaceMesh }[] = STYLES.map(style => ({ style, mesh: faceMesh(style) }))

/** The shipped face, whose absolute numbers every other style is held to. */
const shipped = faceMesh(DEFAULT_FACE)

const highestY = (mesh: FaceMesh): number => {
  let highest = -Infinity
  for (let i = 0; i < mesh.position.length; i += 3) {
    highest = Math.max(highest, mesh.position[i + 1]!)
  }
  return highest
}

describe('every eye and mouth style', () => {
  it('covers all fifty combinations', () => {
    expect(EYE_STYLES.length, 'eye styles').toBe(10)
    expect(MOUTH_STYLES.length, 'mouth styles').toBe(5)
    expect(new Set(EYE_STYLES).size).toBe(EYE_STYLES.length)
    expect(new Set(MOUTH_STYLES).size).toBe(MOUTH_STYLES.length)
    expect(BUILT.length).toBe(50)
  })

  /**
   * The load-bearing one.
   *
   * `chibiGeometry` appends the face last and three suites — this one,
   * `characterFaceShear`, `characterVariants` — locate the face as
   * `count − FACE_VERTICES`. A style with its own vertex count would hand all
   * three the wrong block of the buffer and they would keep passing, on the
   * wrong data.
   *
   * It is also the entire budget argument: `assertTriBudget` sees only the
   * combination that happened to be built, so a per-style triangle count means
   * the ceiling is checked on whichever face the caller picked. Constant
   * topology makes the worst case over 240 combinations equal to the worst case
   * over hairstyles, which the next test measures.
   */
  it('is the same 50 vertices and 38 triangles, whichever style is picked', () => {
    for (const { style, mesh } of BUILT) {
      expect(mesh.position.length / 3, `${name(style)} vertices`).toBe(FACE_VERTICES)
      expect(mesh.index.length / 3, `${name(style)} triangles`).toBe(FACE_TRIANGLES)
      expect(mesh.normal.length, `${name(style)} normals`).toBe(mesh.position.length)
      expect(mesh.color.length, `${name(style)} colours`).toBe(mesh.position.length)
      expect(mesh.along.length, `${name(style)} along`).toBe(FACE_VERTICES)
    }
  })

  it('leaves the worst figure in the game inside CHIBI_BUDGET', () => {
    // Measured here rather than asserted from a comment: the face is style-
    // independent (above), so the worst case over 240 (eye × mouth × hair ×
    // head) combinations is the worst case over hair and head alone — which is
    // what this loop actually builds. Head shape is a warp and adds nothing, but
    // it costs nothing to prove that too.
    const hairs: HairStyle[] = ['bowl', 'short', 'ponytail', 'braids', 'long', 'bald']
    const heads: HeadShape[] = ['round', 'oval', 'square', 'heart']
    let worst = 0
    let worstAt = ''
    for (const hair of hairs) {
      for (const shape of heads) {
        const built = buildChibiGeometry(CHIBI_BUDGET, 'budget/probe', { ...DEFAULT_APPEARANCE, hair, head: shape })
        const total = triangleCount(built.geometry)
        if (total > worst) {
          worst = total
          worstAt = `${hair}/${shape}`
        }
      }
    }
    expect(worst, `worst figure (${worstAt})`).toBeLessThanOrEqual(CHIBI_BUDGET)
    // And the face is a known, fixed share of it — so a hair change that eats
    // the remaining headroom fails here rather than in whichever scene happened
    // to pick that style.
    expect(worst - FACE_TRIANGLES, `body+hair at ${worstAt}`).toBeLessThanOrEqual(CHIBI_BUDGET - FACE_TRIANGLES)
  })

  it('emits only finite floats, unit normals and non-black colours', () => {
    for (const { style, mesh } of BUILT) {
      for (const [what, array] of [
        ['position', mesh.position],
        ['normal', mesh.normal],
        ['colour', mesh.color],
        ['along', mesh.along]
      ] as const) {
        let bad = 0
        for (let i = 0; i < array.length; i++) {
          if (!Number.isFinite(array[i]!)) bad++
        }
        expect(bad, `${name(style)} ${what}`).toBe(0)
      }

      let worstNormal = 0
      let darkest = 1
      for (let i = 0; i < FACE_VERTICES; i++) {
        const length = Math.hypot(mesh.normal[i * 3]!, mesh.normal[i * 3 + 1]!, mesh.normal[i * 3 + 2]!)
        worstNormal = Math.max(worstNormal, Math.abs(length - 1))
        darkest = Math.min(darkest, authoredLuma(mesh.color[i * 3]!, mesh.color[i * 3 + 1]!, mesh.color[i * 3 + 2]!))
      }
      expect(worstNormal, `${name(style)} normal length`).toBeLessThan(2e-3)
      // R4, in the space the palette was authored in — see `authoredLuma`. The
      // `open` mouth is the one style that mixes two palette entries, and it is
      // the one this would catch going too dark.
      expect(darkest, `${name(style)} darkest vertex`).toBeGreaterThan(0.02)
    }
  })

  it('winds every triangle outward and points every normal out of the skull', () => {
    for (const { style, mesh } of BUILT) {
      let inverted = 0
      for (let t = 0; t < mesh.index.length; t += 3) {
        _a.fromArray(mesh.position, mesh.index[t]! * 3)
        _b.fromArray(mesh.position, mesh.index[t + 1]! * 3)
        _c.fromArray(mesh.position, mesh.index[t + 2]! * 3)
        _triangle.set(_a, _b, _c)
        _triangle.getNormal(_closest)
        idealNormal(_a, _b)
        if (_closest.dot(_b) <= 0) inverted++
      }
      expect(inverted, `${name(style)} inward-wound triangles`).toBe(0)

      let worst = 1
      for (let i = 0; i < FACE_VERTICES; i++) {
        idealNormal(_a.fromArray(mesh.position, i * 3), _b)
        _c.fromArray(mesh.normal, i * 3)
        worst = Math.min(worst, _b.dot(_c))
      }
      expect(worst, `${name(style)} worst normal vs the head's`).toBeGreaterThan(0.9)
    }
  })

  it('sits on the built surface, on the front of the head', () => {
    for (const { style, mesh } of BUILT) {
      let minGap = Infinity
      let maxGap = -Infinity
      let behind = 0
      for (let i = 0; i < FACE_VERTICES; i++) {
        const gap = gapToHead(_a.fromArray(mesh.position, i * 3))
        minGap = Math.min(minGap, gap)
        maxGap = Math.max(maxGap, gap)
        if (mesh.position[i * 3 + 2]! <= 0) behind++
      }
      expect(behind, `${name(style)} vertices on the back of the head`).toBe(0)
      expect(minGap, `${name(style)} closest to the skull`).toBeGreaterThan(0.001)
      expect(maxGap, `${name(style)} furthest from the skull`).toBeLessThan(0.006)
    }
  })

  /**
   * No style may put a lid, a corner or a catchlight above the shipped one.
   *
   * The hairline is only 13 mm above `bright`'s upper lid and the fringe has to
   * read as a fringe, so the honest constraint is not "below y = 1.29" — it is
   * "no higher than the face that was art-directed against that fringe". Held to
   * a tenth of a millimetre because the specs were authored to hit it exactly:
   * `close` and `tall` both come within 0.5 mm of `bright` on purpose.
   */
  it('never rises above the shipped face, so the fringe still clears it', () => {
    const ceiling = highestY(shipped)
    expect(LOWEST_HAIRLINE_Y - ceiling, 'the shipped face').toBeGreaterThan(0.008)
    for (const { style, mesh } of BUILT) {
      expect(highestY(mesh) - ceiling, `${name(style)} above the shipped lid`).toBeLessThan(1e-4)
    }
  })

  /**
   * Mirror symmetry, vertex by vertex rather than by a sum.
   *
   * The sum test the shipped face has is cheap and catches a mis-mirrored
   * *feature*, but it cannot see two errors that cancel — and with asymmetric
   * shape terms (roll, lid slant) authored per eye, two cancelling errors is
   * exactly the shape a sign mistake takes. So every vertex must have a partner
   * at −x with the same y and z, to a tolerance that only float noise fits in.
   */
  it('is a mirror of itself, vertex for vertex', () => {
    for (const { style, mesh } of BUILT) {
      let unpaired = 0
      let worst = 0
      let sumX = 0
      for (let i = 0; i < FACE_VERTICES; i++) {
        const x = mesh.position[i * 3]!
        const y = mesh.position[i * 3 + 1]!
        const z = mesh.position[i * 3 + 2]!
        sumX += x
        let best = Infinity
        for (let j = 0; j < FACE_VERTICES; j++) {
          const d = Math.hypot(mesh.position[j * 3]! + x, mesh.position[j * 3 + 1]! - y, mesh.position[j * 3 + 2]! - z)
          best = Math.min(best, d)
        }
        worst = Math.max(worst, best)
        if (best > 1e-6) unpaired++
      }
      expect(unpaired, `${name(style)} vertices with no mirror partner (worst ${worst})`).toBe(0)
      expect(Math.abs(sumX), `${name(style)} sum of x`).toBeLessThan(1e-4)
    }
  })

  /**
   * The skull's binding, for every style.
   *
   * Not a restatement of the shipped face's test: a style moves its eyes up to
   * 19 mm sideways and 6 mm vertically across the head's lower cap, which is
   * precisely the band where the head/neck ramp is steepest. If any of that
   * escaped the ray-cast's `along` — say by a spec drifting off the cap — the
   * weights would quietly go rigid and the 49.6 mm shear would come back for
   * that style alone.
   */
  it('takes the skull\'s own weights, whichever style it is', () => {
    for (const { style } of BUILT) {
      const sink = {
        positions: [] as number[],
        normals: [] as number[],
        colors: [] as number[],
        skinIndices: [] as number[],
        skinWeights: [] as number[],
        indices: [] as number[],
        headBone,
        neckBone,
        jointBlend: 0.3,
        eyes: style.eyes,
        mouth: style.mouth
      }
      appendFace(sink)
      expect(sink.positions.length / 3, `${name(style)} appended vertices`).toBe(FACE_VERTICES)
      expect(sink.indices.length / 3, `${name(style)} appended triangles`).toBe(FACE_TRIANGLES)

      let wrong = 0
      let blended = 0
      for (let i = 0; i < FACE_VERTICES; i++) {
        const primary = sink.skinIndices[i * 4]!
        const secondary = sink.skinIndices[i * 4 + 1]!
        const w0 = sink.skinWeights[i * 4]!
        const w1 = sink.skinWeights[i * 4 + 1]!
        if (primary !== headBone) wrong++
        else if (secondary !== neckBone) wrong++
        else if (Math.abs(w0 + w1 - 1) > 1e-5) wrong++
        else if (sink.skinWeights[i * 4 + 2] !== 0 || sink.skinWeights[i * 4 + 3] !== 0) wrong++
        if (w1 > 0.01) blended++
      }
      expect(wrong, `${name(style)} badly bound vertices`).toBe(0)
      // Every style sits on the head's lower cap, which is inside the ramp — so
      // "nothing blends" means the binding went rigid, not that the style is
      // higher up the skull.
      expect(blended, `${name(style)} vertices sharing weight with the neck`).toBeGreaterThan(0)
    }
  })
})

// ─── ...and through the head-shape warp ─────────────────────────────────────

/**
 * `chibiGeometry` applies `warpVertex` to the head, the hair *and* the face
 * after they are built, so a style is only correct if it is correct after that
 * map. The warp scales laterally by up to 1.06 and vertically by up to 1.06,
 * which moves a wide-set eye further out than any style spec does on its own.
 *
 * The head is rebuilt and warped here rather than mocked, so this measures the
 * same gap the player sees rather than the intent behind it.
 */
const warpedSurface = (shape: HeadShape): Float32Array => {
  const warp = headWarp({ ...DEFAULT_APPEARANCE, head: shape })
  const out = new Float32Array(head.position)
  const p = new Vector3()
  const n = new Vector3(0, 1, 0)
  for (let i = 0; i < out.length; i += 3) {
    p.set(out[i]!, out[i + 1]!, out[i + 2]!)
    n.set(0, 1, 0)
    warpVertex(warp, p, n)
    out[i] = p.x
    out[i + 1] = p.y
    out[i + 2] = p.z
  }
  return out
}

describe('every style survives every head shape', () => {
  const shapes: HeadShape[] = ['round', 'oval', 'square', 'heart']

  it('stays on the skull and under the hairline after the warp', () => {
    const scratch = new Vector3()
    const scratchNormal = new Vector3()
    for (const shape of shapes) {
      const warp = headWarp({ ...DEFAULT_APPEARANCE, head: shape })
      const surface = warpedSurface(shape)
      // The colour ramp is keyed to the *pre-warp* height, so the hairline lands
      // at the warped image of the lowest line any style draws.
      const line = warp.centreY + (LOWEST_HAIRLINE_Y - warp.centreY) * warp.height
      for (const { style, mesh } of BUILT) {
        let minGap = Infinity
        let maxGap = -Infinity
        let highest = -Infinity
        for (let i = 0; i < FACE_VERTICES; i++) {
          scratch.fromArray(mesh.position, i * 3)
          scratchNormal.fromArray(mesh.normal, i * 3)
          warpVertex(warp, scratch, scratchNormal)
          highest = Math.max(highest, scratch.y)
          const gap = gapTo(surface, head.index, scratch)
          minGap = Math.min(minGap, gap)
          maxGap = Math.max(maxGap, gap)
        }
        expect(minGap, `${shape} ${name(style)} closest`).toBeGreaterThan(0.001)
        expect(maxGap, `${shape} ${name(style)} furthest`).toBeLessThan(0.008)
        expect(line - highest, `${shape} ${name(style)} under the hairline`).toBeGreaterThan(0.008)
      }
    }
  })

  it('stays mirror-symmetric and outward-wound after the warp', () => {
    const scratch = new Vector3()
    const scratchNormal = new Vector3()
    const warped = new Float32Array(FACE_VERTICES * 3)
    const warpedNormals = new Float32Array(FACE_VERTICES * 3)
    for (const shape of shapes) {
      const warp = headWarp({ ...DEFAULT_APPEARANCE, head: shape })
      for (const { style, mesh } of BUILT) {
        let sumX = 0
        for (let i = 0; i < FACE_VERTICES; i++) {
          scratch.fromArray(mesh.position, i * 3)
          scratchNormal.fromArray(mesh.normal, i * 3)
          warpVertex(warp, scratch, scratchNormal)
          scratch.toArray(warped, i * 3)
          scratchNormal.toArray(warpedNormals, i * 3)
          sumX += scratch.x
        }
        expect(Math.abs(sumX), `${shape} ${name(style)} sum of x`).toBeLessThan(1e-4)

        let inverted = 0
        let worstNormal = 0
        for (let t = 0; t < mesh.index.length; t += 3) {
          _a.fromArray(warped, mesh.index[t]! * 3)
          _b.fromArray(warped, mesh.index[t + 1]! * 3)
          _c.fromArray(warped, mesh.index[t + 2]! * 3)
          _triangle.set(_a, _b, _c)
          _triangle.getNormal(_closest)
          // The warped surface is no longer the canonical ellipsoid, so the
          // reference is the warped *vertex* normal — which is exactly what the
          // shader shades with, and which the winding must agree with.
          _b.fromArray(warpedNormals, mesh.index[t]! * 3)
          if (_closest.dot(_b) <= 0) inverted++
          worstNormal = Math.max(worstNormal, Math.abs(_b.length() - 1))
        }
        expect(inverted, `${shape} ${name(style)} inward-wound after the warp`).toBe(0)
        expect(worstNormal, `${shape} ${name(style)} warped normal length`).toBeLessThan(2e-3)
      }
    }
  })
})

// ─── What the styles are actually for ───────────────────────────────────────

/**
 * The set exists to make a hundred NPCs not look like one NPC, and at this scale
 * the only cues that carry are *spacing* and *dark area* (see the note in
 * `face.ts`). Those are design assertions, not correctness ones, and they are
 * here because they are the first thing a well-meaning tidy-up would flatten:
 * ten styles that all sit within 3 mm of each other would pass every test above.
 */
describe('the styles are actually distinguishable', () => {
  const eyeMetrics = EYE_STYLES.map(eyes => {
    const mesh = faceMesh({ eyes, mouth: 'neutral' })
    let innerGap = Infinity
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    // The eyes are the first `EYE_VERTICES`. That used to be spelled
    // `FACE_VERTICES − 8` — "everything but the mouth" — which was the same
    // number until the brows landed behind the mouth and quietly joined the
    // eyes' bounding box, inflating this style's "dark area" by a brow.
    for (let i = 0; i < EYE_VERTICES; i++) {
      const x = mesh.position[i * 3]!
      const y = mesh.position[i * 3 + 1]!
      if (x > 0) innerGap = Math.min(innerGap, x)
      minX = Math.min(minX, Math.abs(x))
      maxX = Math.max(maxX, Math.abs(x))
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
    return { eyes, innerGap: innerGap * 2, width: maxX - minX, height: maxY - minY }
  })

  it('spreads the inter-ocular gap, which is the cue that survives distance', () => {
    const gaps = eyeMetrics.map(m => m.innerGap)
    const spread = Math.max(...gaps) - Math.min(...gaps)
    // 30 mm on a 470 mm-wide head. Below ~20 mm the styles stop being separable
    // people at street range and become the same face with a different squint.
    expect(spread, `inter-ocular spread ${(spread * 1000).toFixed(1)} mm`).toBeGreaterThan(0.028)
  })

  it('spreads the dark area, which is the other one', () => {
    const areas = eyeMetrics.map(m => m.width * m.height)
    expect(Math.max(...areas) / Math.min(...areas), 'largest eye area / smallest').toBeGreaterThan(2)
  })

  it('gives every mouth a distinct silhouette', () => {
    const shapes = MOUTH_STYLES.map(mouth => {
      const mesh = faceMesh({ eyes: 'bright', mouth })
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (let i = MOUTH_START; i < MOUTH_START + MOUTH_VERTICES; i++) {
        minX = Math.min(minX, mesh.position[i * 3]!)
        maxX = Math.max(maxX, mesh.position[i * 3]!)
        minY = Math.min(minY, mesh.position[i * 3 + 1]!)
        maxY = Math.max(maxY, mesh.position[i * 3 + 1]!)
      }
      return { mouth, width: maxX - minX, height: maxY - minY }
    })
    // Width spread carries the read past 8 m; height carries `open`.
    const widths = shapes.map(s => s.width)
    const heights = shapes.map(s => s.height)
    expect(Math.max(...widths) - Math.min(...widths), 'mouth width spread').toBeGreaterThan(0.02)
    expect(Math.max(...heights) / Math.min(...heights), 'mouth height ratio').toBeGreaterThan(1.5)
  })

  /**
   * The eye's vertex layout, which these two tests read directly.
   *
   * Per eye: [0] centre, [1..12] rim at φ = 0°, 30° … 330°, [13..16] catchlight,
   * [17..20] lower-lid wedge. The first eye is the character's left (+x), so its
   * corner at φ = 90° is the one *away* from the nose.
   *
   * Read by index rather than by "highest vertex" on purpose: a rolled eye moves
   * its extremes onto a neighbouring vertex, which is what made the first attempt
   * at this measurement report the tilt backwards.
   */
  const OUTER_CORNER = 4
  const INNER_CORNER = 10
  const OUTER_LID = 2
  const INNER_LID = 12
  const heightAt = (mesh: FaceMesh, vertex: number): number => mesh.position[vertex * 3 + 1]!

  it('tilts the eyes it says it tilts, and only those', () => {
    // `roll` is the cue that separates `sharp` from `weary` at 3 m, and it is
    // mirrored per side — if it were not, both eyes would tilt the same way and
    // the character would read as having a broken neck rather than an expression.
    const tilt = (eyes: (typeof EYE_STYLES)[number]): number => {
      const mesh = faceMesh({ eyes, mouth: 'neutral' })
      const left = heightAt(mesh, OUTER_CORNER) - heightAt(mesh, INNER_CORNER)
      // The second eye's rim runs the other way, so its corners swap indices.
      const right = heightAt(mesh, 21 + INNER_CORNER) - heightAt(mesh, 21 + OUTER_CORNER)
      // Mirrored means the two eyes tilt by the same amount, not opposite ones.
      expect(left, `${eyes} tilts its two eyes differently`).toBeCloseTo(right, 6)
      return left
    }
    for (const eyes of ['almond', 'sleepy', 'sharp'] as const) {
      expect(tilt(eyes) * 1000, `${eyes} outer corner above inner, mm`).toBeGreaterThan(3)
    }
    for (const eyes of ['soft', 'weary'] as const) {
      expect(tilt(eyes) * 1000, `${eyes} outer corner below inner, mm`).toBeLessThan(-3)
    }
    for (const eyes of ['bright', 'wide', 'small'] as const) {
      expect(Math.abs(tilt(eyes)) * 1000, `${eyes} should be level, mm`).toBeLessThan(1.5)
    }
  })

  it('keeps the lid slant that used to stand in for a brow', () => {
    // The lid slant predates the brows and is kept because it is free, because
    // it survives to ranges a 6 mm brow does not, and because a brow drawn over
    // a level lid on a scowling face reads as two features disagreeing.
    // Positive here means the lid is higher on the outside: a scowl.
    const slant = (eyes: (typeof EYE_STYLES)[number]): number => {
      const mesh = faceMesh({ eyes, mouth: 'neutral' })
      return heightAt(mesh, OUTER_LID) - heightAt(mesh, INNER_LID)
    }
    expect(slant('sharp') * 1000, 'sharp lid, mm').toBeGreaterThan(6)
    expect(slant('almond') * 1000, 'almond lid, mm').toBeGreaterThan(3)
    expect(slant('soft') * 1000, 'soft lid, mm').toBeLessThan(-3)
    expect(slant('weary') * 1000, 'weary lid, mm').toBeLessThan(-3)
    expect(Math.abs(slant('bright')) * 1000, 'bright should be level, mm').toBeLessThan(0.5)
  })

  it('keeps the default face the shipped one', () => {
    // If this ever needs changing, `characterVariants.test.ts`'s byte hash of
    // the whole figure needs changing with it — and that is the point of pinning
    // it here as well: the two must be decided together.
    expect(DEFAULT_FACE.eyes).toBe('bright')
    expect(DEFAULT_FACE.mouth).toBe('smile')
    const implicit = faceMesh()
    for (let i = 0; i < shipped.position.length; i++) {
      expect(implicit.position[i]).toBe(shipped.position[i])
    }
  })
})

// ─── Brows ──────────────────────────────────────────────────────────────────

/**
 * ─── The four ways a brow on this face goes wrong ───────────────────────────
 *
 * A brow is 12 triangles in the one place on this head where there is no room
 * for it — 13 mm between the top of the eye and the painted hair, before the
 * hairline was moved. Every failure mode is a placement failure, and every one
 * of them looks deliberate on screen:
 *
 * • **Too high** and the painted hairline lands on it, so the character has a
 *   fringe growing out of their eyebrows. Guarded by the hairline tests above,
 *   which now measure against the *style's* line rather than the ramp's origin.
 * • **Too low** and it merges with the lash line into one thick dark shape,
 *   which is the lid slant that was already free — 12 triangles for nothing.
 * • **The wrong colour** and it either vanishes into the skin (a straw brow on
 *   `skinTone3` separates by 0.015 of luma at the hair ramp's own dark stop) or
 *   goes to ink and breaks R4.
 * • **Mis-mirrored.** The tilt is asymmetric per style, which is exactly the
 *   shape a sign error takes, and two cancelling sign errors survive the
 *   sum-of-x check the rest of the face relies on.
 */
describe('the brows', () => {
  const browsOf = (mesh: FaceMesh): { x: number; y: number }[] => {
    const out: { x: number; y: number }[] = []
    for (let i = BROW_START; i < FACE_VERTICES; i++) {
      out.push({ x: mesh.position[i * 3]!, y: mesh.position[i * 3 + 1]! })
    }
    return out
  }

  it('adds exactly two of them, at the tail of the face', () => {
    expect(BROW_VERTICES).toBe(16)
    expect(BROW_START + BROW_VERTICES).toBe(FACE_VERTICES)
    const brows = browsOf(faceMesh())
    expect(brows.filter(v => v.x > 0)).toHaveLength(8)
    expect(brows.filter(v => v.x < 0)).toHaveLength(8)
  })

  it('sits above the eye and below the lowest hairline, for every style', () => {
    for (const eyes of EYE_STYLES) {
      const mesh = faceMesh({ eyes, mouth: 'smile' })
      // Vertex-to-vertex rather than to the rim as a curve: the brow's lowest
      // corner is over the eye's *corner*, where the lid has already dropped, so
      // a bare y comparison reports an overlap that is not there.
      let nearest = Infinity
      for (let b = BROW_START; b < FACE_VERTICES; b++) {
        for (let e = 0; e < EYE_VERTICES; e++) {
          nearest = Math.min(
            nearest,
            Math.hypot(
              mesh.position[b * 3]! - mesh.position[e * 3]!,
              mesh.position[b * 3 + 1]! - mesh.position[e * 3 + 1]!,
              mesh.position[b * 3 + 2]! - mesh.position[e * 3 + 2]!
            )
          )
        }
      }
      // Measured 7.5–10.6 mm across the ten. 5 mm is the floor: below it the two
      // shapes touch at some head shape and read as one.
      expect(nearest, `${eyes}: brow to eye`).toBeGreaterThan(0.005)

      let highest = -Infinity
      for (const v of browsOf(mesh)) {
        highest = Math.max(highest, v.y)
      }
      expect(LOWEST_HAIRLINE_Y - highest, `${eyes}: brow under the hairline`).toBeGreaterThan(0.008)
    }
  })

  it('tilts with the expression the eye already carries', () => {
    // The brow is derived from the eye spec, so this is the assertion that the
    // derivation has the right *sign* — a scowl whose brows arch upward at the
    // nose is a face at war with itself, and it is one minus sign away.
    const tilt = (eyes: (typeof EYE_STYLES)[number]): number => {
      const brows = browsOf(faceMesh({ eyes, mouth: 'neutral' }))
      const left = brows.filter(v => v.x > 0).sort((a, b) => a.x - b.x)
      // On the character's left the outer end is the one at larger x.
      const outer = (left[left.length - 1]!.y + left[left.length - 2]!.y) / 2
      const inner = (left[0]!.y + left[1]!.y) / 2
      // And it must be mirrored, not copied: the right brow's outer end is at
      // smaller x, and the two must rise by the same amount.
      const right = brows.filter(v => v.x < 0).sort((a, b) => a.x - b.x)
      const outerR = (right[0]!.y + right[1]!.y) / 2
      const innerR = (right[right.length - 1]!.y + right[right.length - 2]!.y) / 2
      expect(outer - inner, `${eyes} mirrors its brows`).toBeCloseTo(outerR - innerR, 6)
      return outer - inner
    }
    expect(tilt('sharp') * 1000, 'sharp: outer end up, mm').toBeGreaterThan(6)
    expect(tilt('sleepy') * 1000, 'sleepy: outer end up, mm').toBeGreaterThan(2)
    expect(tilt('soft') * 1000, 'soft: outer end down, mm').toBeLessThan(-4)
    expect(tilt('weary') * 1000, 'weary: outer end down, mm').toBeLessThan(-4)
    for (const eyes of ['bright', 'wide', 'small', 'tall'] as const) {
      expect(Math.abs(tilt(eyes)) * 1000, `${eyes}: level, mm`).toBeLessThan(1)
    }
  })

  it('is wider than the eye it sits over and tapers outward', () => {
    // A constant-width bar over an eye is a censor stripe; the taper is what
    // makes it a brow. Measured on the built strip, not on the spec.
    const mesh = faceMesh()
    // Columns are emitted top-then-bottom, so the pair for column `i` is at
    // `2i` and `2i + 1`. Grouping by x instead would find eight columns, not
    // four: a walk of (dx, ±half) on a sphere lands the two at slightly
    // different x, which is the exponential map doing its job.
    const columns: { x: number; thickness: number }[] = []
    for (let i = 0; i < BROW_COLUMNS; i++) {
      const top = BROW_START + i * 2
      const bottom = top + 1
      columns.push({
        x: mesh.position[top * 3]!,
        thickness: Math.abs(mesh.position[top * 3 + 1]! - mesh.position[bottom * 3 + 1]!)
      })
    }
    // Column 0 is the inner end on the character's left brow, which is emitted
    // first; thickness peaks at the inner third, i.e. column 1.
    expect(columns[1]!.thickness, 'inner third is the thickest').toBeGreaterThan(columns[3]!.thickness)
    expect(columns[3]!.thickness / columns[1]!.thickness, 'outer tip tapers to a point').toBeLessThan(0.5)

    const eyeXs: number[] = []
    for (let i = 0; i < EYE_VERTICES / 2; i++) {
      eyeXs.push(mesh.position[i * 3]!)
    }
    const browSpan = Math.abs(columns[3]!.x - columns[0]!.x)
    expect(browSpan, 'brow is wider than the eye').toBeGreaterThan(Math.max(...eyeXs) - Math.min(...eyeXs))
  })
})
