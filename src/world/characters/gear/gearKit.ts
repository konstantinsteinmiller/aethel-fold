import { BufferGeometry, type Color, Vector3 } from 'three'
import { measuredRadius, mergeParts, partRanges } from '../../assets/common'
// The NaN guard lives in `assets/plateau.ts` because that is where it was first
// needed; the whole cliff family imports it from there. Duplicating a NaN guard
// is how NaN guards drift, and this one is specifically written to survive the
// "every comparison against NaN is false" trap — so it is imported, not copied.
import { assertFiniteGeometry } from '../../assets/plateau'
import { assertTriBudget } from '../../geometry/budget'
import { makeRng } from '../../geometry/rng'
import { bakeVertexAO } from '../../geometry/vertexAO'
import { applyVertexAO, jitterColor } from '../../geometry/vertexColor'
// Imported as well as re-exported: this file's own `finishGear` validates with
// `assertOutwardWinding` and takes `SweptPart`s, and a bare `export … from` does
// not bring a name into local scope.
import { assertOutwardWinding, type SweptPart } from '../../geometry/sweep'

/**
 * ─── The equipment kit: one primitive, seven props ──────────────────────────
 *
 * Every piece of gear in this folder is built from a single primitive — a
 * **closed section swept along a C² spline** — and that is deliberate. Seven
 * hand-authored props written seven ways is seven shading solutions, seven
 * winding conventions and seven places for the "bevel every cut" rule to go
 * quietly missing. One primitive means one normal rule, one winding proof and
 * one budget formula:
 *
 *     triangles = (stations − 1) × segments × 2 − segments × (collapsed rings)
 *
 * ── Why a B-spline profile, and why that *is* the bevel ─────────────────────
 *
 * The surface is
 *
 *     P(u, v) = O(u) + secA(v)·eA(u)·A + secB(v)·eB(u)·B
 *
 * where `O`, `eA`, `eB` come from a **uniform cubic B-spline** over authored
 * control points and `secA`/`secB` from a **closed** one. Uniform cubic
 * B-splines are C² everywhere, which is the requirement `plateau.ts` records
 * from the other direction: the toon band edge traces the normal's *derivative*,
 * so a merely-C¹ join renders as a visible ring rather than as a crease. An
 * interpolating spline (Catmull-Rom) would hit the authored numbers exactly and
 * be C¹; this one is C² and misses them by the smoothing.
 *
 * That miss is the point. **Control points are handles, not surface points**,
 * and the radius the curve loses at a tight cluster of them is exactly GDD R2's
 * bevel: there is no hard 90° edge anywhere in this folder because the
 * primitive cannot make one. A crisp edge is authored by putting two control
 * points close together — a *narrow* bevel — and a soft one by spreading them.
 *
 * The consequence for anything that has to fit a body part is that clearances
 * must be **measured on the built mesh**, never derived from the control points.
 * See `minGap` and its two callers (`hat.ts`, `torsoArmour.ts`).
 *
 * ── Normals ─────────────────────────────────────────────────────────────────
 *
 * Central-differenced from the shape function above, never from the tessellated
 * faces (GDD R2 / R3). `∂P/∂v × ∂P/∂u`, then oriented outward against the
 * section's own centre `O(u)` — the same "if it faces inward, negate it" rule
 * `blobGeometry` uses, and the reason a fold in the profile (the hat brim, the
 * armour's rolled collar) does not flip a patch of shading inside out.
 *
 * ── Winding is voted, not assumed ───────────────────────────────────────────
 *
 * Whether the natural quad order `(a,b,c)(b,d,c)` comes out clockwise or
 * counter-clockwise depends on the handedness of `(A, B, path direction)`, which
 * varies per part — the blade sweeps along +Y with A=X, B=Z, the shield board
 * sweeps along +X with A=Y, B=Z. Rather than reason about it seven times, the
 * builder sums `dot(faceNormal, vertexNormal)` over every face and reverses the
 * whole index buffer if that sum is negative.
 *
 * This exists because the body shipped with the opposite bug: `limbMesh` winds
 * inward, `chibiGeometry` renders `FrontSide`, and the figure spent a build
 * rendering the inside of its own skull with an inverted hull painted over the
 * front of it. Nothing threw. `assertOutwardWinding` below is the assertion that
 * would have caught it, and it runs on every model here and in the tests.
 */


/**
 * ─── The primitive now lives in `geometry/sweep.ts` ─────────────────────────
 *
 * Moved, not copied, and re-exported from here so every existing import in this
 * folder and in the suites still resolves. The move happened when the village
 * generators in `assets/` needed the same swept section for beams, stakes and
 * cart shafts: `assets/` must not import from `characters/`, and a second beam
 * builder would have been a second winding convention and a second normal rule.
 *
 * What stayed in this file is what is specific to *equipment*: the clearance
 * measurement two garments fit themselves with, and `finishGear`, which is the
 * merge/occlude/validate/budget tail every model in this folder shares.
 */
export {
  assertOutwardWinding,
  circleSection,
  clearingSection,
  paintPart,
  type Section,
  splineAt,
  splineLoopAt,
  splineSection,
  sweep,
  type SweepOptions,
  type SweptPart,
  windingDisagreements
} from '../../geometry/sweep'


// ─── Clearance ──────────────────────────────────────────────────────────────

// Module-level scratch — nothing in `src/world/` allocates in a loop. These are
// this file's own, deliberately: the sweep's scratch moved to `geometry/sweep.ts`
// with it, and sharing a `Vector3` across two modules that can both be mid-loop
// is the kind of aliasing bug that only shows up as a wrong number.
const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _query = new Vector3()
const _closest = new Vector3()
const _edge0 = new Vector3()
const _edge1 = new Vector3()
const _diff = new Vector3()

/** Closest point on triangle (a, b, c) to `p`. Ericson, *RTCD* §5.1.5. */
const closestOnTriangle = (p: Vector3, a: Vector3, b: Vector3, c: Vector3, out: Vector3): Vector3 => {
  _edge0.subVectors(b, a)
  _edge1.subVectors(c, a)
  _diff.subVectors(p, a)
  const d1 = _edge0.dot(_diff)
  const d2 = _edge1.dot(_diff)
  if (d1 <= 0 && d2 <= 0) {
    return out.copy(a)
  }
  _diff.subVectors(p, b)
  const d3 = _edge0.dot(_diff)
  const d4 = _edge1.dot(_diff)
  if (d3 >= 0 && d4 <= d3) {
    return out.copy(b)
  }
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    return out.copy(a).addScaledVector(_edge0, d1 / (d1 - d3))
  }
  _diff.subVectors(p, c)
  const d5 = _edge0.dot(_diff)
  const d6 = _edge1.dot(_diff)
  if (d6 >= 0 && d5 <= d6) {
    return out.copy(c)
  }
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    return out.copy(a).addScaledVector(_edge1, d2 / (d2 - d6))
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return out.copy(b).addScaledVector(_edge1.subVectors(c, b), w)
  }
  const denominator = 1 / (va + vb + vc)
  return out
    .copy(a)
    .addScaledVector(_edge0, vb * denominator)
    .addScaledVector(_edge1, vc * denominator)
}

export interface Surface {
  position: ArrayLike<number>
  index: ArrayLike<number>
}

/**
 * Smallest distance from any vertex of `from` to any triangle of `to`, and back.
 *
 * Measured **both ways**, which is not paranoia: a one-way vertex-to-triangle
 * probe misses the case where the *other* surface's vertex pokes up between two
 * of this one's, which is precisely the geometry a 9-gon head inside a 9-gon hat
 * produces. This is the same measurement `characterFace.test.ts` makes with
 * `gapToHead`, generalised so the hat and the armour can both use it.
 *
 * Not signed. A caller that needs to know which side it is on must establish
 * that separately — both users here know the hat and the armour enclose the
 * body, and assert the enclosure by construction.
 */
export const minGap = (from: Surface, to: Surface): number => {
  let best = Number.POSITIVE_INFINITY
  const probe = (source: Surface, target: Surface): void => {
    const count = source.position.length / 3
    for (let i = 0; i < count; i++) {
      _query.set(source.position[i * 3]!, source.position[i * 3 + 1]!, source.position[i * 3 + 2]!)
      for (let f = 0; f < target.index.length; f += 3) {
        _a.fromArray(target.position as number[], target.index[f]! * 3)
        _b.fromArray(target.position as number[], target.index[f + 1]! * 3)
        _c.fromArray(target.position as number[], target.index[f + 2]! * 3)
        closestOnTriangle(_query, _a, _b, _c, _closest)
        const distance = _closest.distanceTo(_query)
        if (distance < best) {
          best = distance
        }
      }
    }
  }
  probe(from, to)
  probe(to, from)
  return best
}

/** A `Surface` view of a built geometry, for `minGap`. */
export const surfaceOf = (geometry: BufferGeometry): Surface => ({
  position: geometry.getAttribute('position').array as ArrayLike<number>,
  index: geometry.index!.array as ArrayLike<number>
})

// ─── The tail every generator shares ────────────────────────────────────────

export interface GearModel {
  /** Vertex colours baked, normals authored, wound outward. */
  geometry: BufferGeometry
  /**
   * Object-space point that should coincide with the socket.
   *
   * Always the origin — see the convention in `index.ts`. It is returned anyway
   * so the attachment layer never has to *trust* that convention: a model that
   * ever returns something else is a bug in the model, not a variant the socket
   * table has to absorb.
   */
  grip: [number, number, number]
  /** Object-space bounding radius about the grip. Measured, not derived. */
  radius: number
  name: string
}

/** Every model's grip. Shared so a typo cannot make one item disagree. */
export const GRIP_AT_ORIGIN: [number, number, number] = [0, 0, 0]

export interface FinishOptions {
  name: string
  budget: number
  parts: SweptPart[]
  /** Deep colour each part's ambient occlusion resolves toward. Never black. */
  deep: Color[]
  /** AO strength per part. 0 skips the part. */
  aoAmount?: number[]
  aoSamples?: number
  /**
   * Per-vertex albedo jitter, seeded.
   *
   * This is the whole of what a gear generator's `seed` does, and it is not
   * decoration: a party of four carrying the *identical* sword is the single
   * loudest "this is instanced" tell, and it is much louder on a prop held a
   * metre from the lens than on a tree at 40 m. Shape stays authored — a sword
   * whose proportions varied by seed would stop being *the* sword.
   */
  seed?: number
  jitter?: number
}

/**
 * Merge, occlude, validate, budget.
 *
 * ── Gear *does* carry baked AO, and the body does not ───────────────────────
 *
 * `chibiGeometry.ts` refuses AO because it is baked in bind pose and walks out
 * into open air the moment a limb moves. None of that applies here: equipment is
 * **parented, not skinned** (`equipment.ts`), so a sword is rigid and the contact
 * shade under its guard is in the same place in every frame of every animation.
 * It is the ordinary prop argument (GDD R1) and it buys the crevices this budget
 * cannot model.
 *
 * Ordered validate-then-budget for the reason `plateau.ts` gives: a part full of
 * NaN has a perfectly valid triangle count, so budgeting first reports success
 * on a black model.
 */
export const finishGear = (options: FinishOptions): GearModel => {
  const { name, budget, parts, deep, aoAmount, aoSamples = 12, seed = 1, jitter = 0.035 } = options
  const geometries = parts.map(part => part.geometry)
  const ranges = partRanges(geometries)
  const merged = mergeParts(geometries, name)

  const radius = measuredRadius([merged])
  const ao = bakeVertexAO(merged, {
    samples: aoSamples,
    // Scaled to the prop, not to the world: a hat's cavity and a sword's guard
    // notch are centimetres, and a metre-long ray finds nothing but sky.
    maxDistance: radius * 0.45,
    strength: 0.85,
    power: 1.2
  })
  for (let i = 0; i < ranges.length; i++) {
    const amount = aoAmount ? aoAmount[i]! : 0.7
    if (amount > 0) {
      applyVertexAO(merged, ao, deep[i]!, amount, ranges[i])
    }
  }

  if (jitter > 0) {
    jitterColor(merged, makeRng(seed), jitter)
  }

  merged.computeBoundingSphere()
  assertFiniteGeometry(merged, name)
  assertOutwardWinding(merged, name)
  assertTriBudget(merged, budget, name)

  return { geometry: merged, grip: [...GRIP_AT_ORIGIN], radius, name }
}

