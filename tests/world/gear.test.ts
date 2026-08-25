import { BufferAttribute, Color, Euler, Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { GEAR_BUILDERS, hatHeadClearance, torsoArmourMargin } from '@/world/characters/gear'
import { splineAt, windingDisagreements } from '@/world/characters/gear/gearKit'
import {
  EQUIPMENT_BUDGET,
  HAT_CLEARANCE,
  ITEM_FORWARD_AXIS,
  type ItemKind,
  SOCKETS,
  type SocketName
} from '@/world/characters/equipment'
import { buildSkeleton } from '@/world/characters/skeleton'
import { triangleCount } from '@/world/geometry/budget'

/**
 * ─── The equipment contract ─────────────────────────────────────────────────
 *
 * Seven procedural props that hang off a skeleton. Most of what can go wrong
 * with them is invisible to the eye that authored them and loud to everyone
 * else's: a mesh that renders its own far surface, a model whose bounding radius
 * under-reports and pops out of the frustum, a hat that clips the skull at four
 * bearings out of nine.
 *
 * Every assertion here is written so that a NaN lands in the **failing** branch.
 * `plateau.ts` records why: a range check against NaN is false, so a test
 * written the obvious way silently inverts into one that can never fail — and
 * that had already happened once in this project, to two assertions at the same
 * time, over data that shipped a solid black cap to a screenshot.
 */

const KINDS = Object.keys(GEAR_BUILDERS) as ItemKind[]

const models = new Map<ItemKind, ReturnType<(typeof GEAR_BUILDERS)[ItemKind]>>()
for (const kind of KINDS) {
  models.set(kind, GEAR_BUILDERS[kind]({ seed: 1 }))
}
const modelOf = (kind: ItemKind) => models.get(kind)!

/**
 * Relative luminance in the space the palette was **authored** in.
 *
 * Copied in spirit from `characterFace.test.ts`, and the reasoning is worth
 * restating because it inverts the obvious test. `THREE.Color` holds
 * linear-sRGB, and in linear space every dark albedo in this project sits near
 * 0.015 — `leatherShadow`, which every grip in this folder wraps itself in, is
 * 0.026 linear. A linear threshold of 0.02 would therefore fail on perfectly
 * legal leather while passing anything that happened to be a slightly lighter
 * black. GDD R4 bans *black*, and black is a statement about the authored value,
 * not about the working space it is converted into.
 */
const authoredLuma = (r: number, g: number, b: number): number => {
  const srgb = new Color(r, g, b).convertLinearToSRGB()
  return 0.2126 * srgb.r + 0.7152 * srgb.g + 0.0722 * srgb.b
}

describe.each(KINDS)('%s', kind => {
  const model = modelOf(kind)
  const geometry = model.geometry

  it('stays inside its EQUIPMENT_BUDGET, and is not trivially small', () => {
    expect(triangleCount(geometry)).toBeLessThanOrEqual(EQUIPMENT_BUDGET[kind])
    // A model that lost a part would sail through a ceiling check on its own.
    // 55 % of budget is well under every item's real count (81–86 %) and well
    // over what any single part costs.
    expect(triangleCount(geometry)).toBeGreaterThan(EQUIPMENT_BUDGET[kind] * 0.55)
  })

  it('carries every attribute the toon material reads', () => {
    // No `skinIndex`/`skinWeight` on purpose: equipment is parented, not
    // skinned, and adding them would put a sword through the same joint blend
    // the body uses. `aWind` is present but zero — it is what lets a prop share
    // the world's material without forking a program.
    for (const name of ['position', 'normal', 'color', 'aWind']) {
      expect(geometry.getAttribute(name), name).toBeTruthy()
    }
    expect(geometry.index).toBeTruthy()
  })

  it('emits only finite floats', () => {
    for (const name of ['position', 'normal', 'color']) {
      const array = geometry.getAttribute(name).array as ArrayLike<number>
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
    const normal = geometry.getAttribute('normal')
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
    // finite, and it still rendered the inside of its own skull with the
    // inverted hull painted over the front. Facing is invisible to every
    // attribute-level check, so it needs its own.
    expect(windingDisagreements(geometry)).toBe(0)
  })

  it('has no near-black vertex colour (GDD R4)', () => {
    const color = geometry.getAttribute('color')
    let darkest = 1
    for (let i = 0; i < color.count; i++) {
      const luma = authoredLuma(color.getX(i), color.getY(i), color.getZ(i))
      // Positive test, so a NaN colour fails here rather than sliding past.
      if (!(luma >= darkest)) {
        darkest = luma
      }
    }
    // `leatherShadow` is the darkest thing this folder paints, at 0.176
    // authored. 0.06 is comfortably below it and comfortably above black, so
    // this fails on an AO bake that resolved toward black rather than toward a
    // palette colour — which is the mistake it exists to catch.
    expect(darkest).toBeGreaterThan(0.06)
  })

  it('grips at the origin, and bounds itself honestly', () => {
    expect(model.grip).toEqual([0, 0, 0])

    const position = geometry.getAttribute('position')
    let furthest = 0
    for (let i = 0; i < position.count; i++) {
      furthest = Math.max(furthest, Math.hypot(position.getX(i), position.getY(i), position.getZ(i)))
    }
    // The grip is inside the model's own bounding sphere — trivially true given
    // the convention, and asserted anyway because the convention is the thing
    // under test.
    expect(new Vector3(...model.grip).length()).toBeLessThanOrEqual(model.radius)
    // The radius actually bounds every vertex. `assets/common.ts` records that
    // ten of twenty-nine world props published a radius short of their own mesh
    // — up to 27.7 % — because it was derived from the shape description rather
    // than measured, and the consequence was props vanishing at the screen edge.
    expect(model.radius).toBeGreaterThanOrEqual(furthest - 1e-6)
    // And is not padded: an inflated radius silently disables culling.
    expect(model.radius).toBeLessThan(furthest * 1.02 + 1e-6)
  })

  it('is deterministic in shape and in colour for a given seed', () => {
    const again = GEAR_BUILDERS[kind]({ seed: 1 })
    for (const name of ['position', 'normal', 'color']) {
      const a = geometry.getAttribute(name).array as ArrayLike<number>
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
    const other = GEAR_BUILDERS[kind]({ seed: 7 })
    const positionA = geometry.getAttribute('position').array as ArrayLike<number>
    const positionB = other.geometry.getAttribute('position').array as ArrayLike<number>
    let moved = 0
    for (let i = 0; i < positionA.length; i++) {
      if (!(positionA[i] === positionB[i])) {
        moved++
      }
    }
    // Shape is authored. A sword whose proportions varied by seed would stop
    // being *the* sword, and the socket table's offsets would only fit one of
    // them.
    expect(moved).toBe(0)

    const colorA = geometry.getAttribute('color').array as ArrayLike<number>
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

describe('the frame every model shares', () => {
  const extentsOf = (kind: ItemKind) => {
    const position = modelOf(kind).geometry.getAttribute('position')
    const box = { minY: Infinity, maxY: -Infinity, maxX: 0, maxZ: 0, minZ: 0, maxZSigned: 0 }
    for (let i = 0; i < position.count; i++) {
      box.minY = Math.min(box.minY, position.getY(i))
      box.maxY = Math.max(box.maxY, position.getY(i))
      box.maxX = Math.max(box.maxX, Math.abs(position.getX(i)))
      box.maxZ = Math.max(box.maxZ, Math.abs(position.getZ(i)))
      box.minZ = Math.min(box.minZ, position.getZ(i))
      box.maxZSigned = Math.max(box.maxZSigned, position.getZ(i))
    }
    return box
  }

  it('hangs every held item point-down along −Y (ITEM_FORWARD_AXIS)', () => {
    // This is the clause the first pass got backwards, and the failure was not
    // subtle: sheathed at `hipR`, a tip-up sword spanned 0.528–1.031 m above the
    // feet — standing up the ribcage (hips 0.62, shoulders 1.02) instead of
    // hanging down the thigh.
    expect(ITEM_FORWARD_AXIS).toBe('minusY')
    for (const kind of ['sword', 'greatsword', 'crossbow', 'shield'] as ItemKind[]) {
      const box = extentsOf(kind)
      expect(Math.abs(box.minY), kind).toBeGreaterThan(box.maxY * 1.4)
    }
    // The bow is gripped in the middle of its riser and is symmetric about it,
    // so it has no end to hang down.
    const bow = extentsOf('bow')
    expect(bow.maxY).toBeCloseTo(-bow.minY, 2)
  })

  it('keeps the worn items +Y up, in the body’s own frame', () => {
    // The hat and the armour are anchored to bones, not fists, and their fit is
    // measured against body geometry — so they are authored the way the body is.
    for (const kind of ['hat', 'torsoArmour'] as ItemKind[]) {
      const box = extentsOf(kind)
      expect(box.maxY, kind).toBeGreaterThan(Math.abs(box.minY))
    }
  })

  it('keeps the Z-canted items thin on X and broad on Z', () => {
    // `hipR` and `backOver` cant about Z, so a guard or a prod on ±Z stays in
    // the plane the socket tilts in while one on ±X swings out of it. All three
    // of these hang from those two sockets.
    for (const kind of ['sword', 'greatsword', 'bow', 'crossbow'] as ItemKind[]) {
      const box = extentsOf(kind)
      expect(box.maxZ, kind).toBeGreaterThan(box.maxX * 1.4)
    }
  })

  it('faces the shield board +Z, broad on X, with its point below the grip', () => {
    const box = extentsOf('shield')
    // Boss and board stand off in +Z, and nothing reaches meaningfully behind
    // the grip bar, because the hand is the rearmost thing on the model.
    expect(box.maxZSigned).toBeGreaterThan(0.08)
    expect(box.minZ).toBeGreaterThan(-0.02)
    // Broad across X — the one item where "front is +Z" and "broad is ±Z"
    // cannot both hold, and the front wins.
    expect(box.maxX).toBeGreaterThan(box.maxZ)
    // A heater hangs its point well below the hand.
    expect(box.minY).toBeLessThan(-0.15)
  })
})

describe('hung on the sockets it was authored for', () => {
  /** World-space AABB of a model placed at a socket, in bind pose. */
  const spanAt = (kind: ItemKind, socketName: SocketName) => {
    const socket = SOCKETS[socketName]
    const { root, byName } = buildSkeleton()
    root.updateMatrixWorld(true)

    const bone = byName.get(socket.bone)!
    const local = new Matrix4()
      .makeRotationFromEuler(new Euler(socket.rotation[0], socket.rotation[1], socket.rotation[2], 'XYZ'))
      .setPosition(socket.position[0], socket.position[1], socket.position[2])
    const world = new Matrix4().multiplyMatrices(bone.matrixWorld, local)

    const position = modelOf(kind).geometry.getAttribute('position')
    const point = new Vector3()
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(world)
      minY = Math.min(minY, point.y)
      maxY = Math.max(maxY, point.y)
    }
    return { minY, maxY }
  }

  it('hangs the sheathed sword down the thigh, not up the ribcage', () => {
    const span = spanAt('sword', 'hipR')
    // Hips are at y = 0.62 and shoulders at 1.02 (`rig.ts`). The hilt must stay
    // at or below the hip line and the tip must reach down the leg. Before the
    // flip this measured 0.528–1.031 m — the whole weapon above the hips.
    expect(span.maxY).toBeLessThan(0.76)
    expect(span.minY).toBeLessThan(0.2)
    expect(span.minY).toBeGreaterThan(-0.05)
  })

  it('slings the greatsword hilt over the shoulder, not into the small of the back', () => {
    const span = spanAt('greatsword', 'backOver')
    // Chest bone at 0.95; the pommel should stand proud of the shoulder line.
    expect(span.maxY).toBeGreaterThan(1.05)
    // And the tip should not drag on the ground.
    expect(span.minY).toBeGreaterThan(0.1)
  })
})

describe('fit against the body it hangs on', () => {
  it('clears the built head by at least HAT_CLEARANCE, without hovering', () => {
    const clearance = hatHeadClearance(modelOf('hat').geometry)
    // Measured on the head that is *built* — a 9-gon over 10 rings whose facets
    // sit up to 15 mm inside the ellipsoid it is shaded as. A hat sized to the
    // ideal surface passes this by 15 mm of nothing and clips in the browser.
    expect(clearance).toBeGreaterThanOrEqual(HAT_CLEARANCE)
    // And is not a parasol balanced above the head: `HAT_CLEARANCE`'s own
    // docstring asks for "enough to read as a hat sitting on hair, not enough to
    // hover".
    expect(clearance).toBeLessThan(HAT_CLEARANCE * 2)
  })

  it('encloses the built torso everywhere the armour covers it', () => {
    const fit = torsoArmourMargin(modelOf('torsoArmour').geometry)
    // Not one body vertex outside the shell, over the covered band.
    expect(fit.breaches).toBe(0)
    // And enough margin that a couple of degrees of spine counter-rotation does
    // not push the tunic through the plate.
    expect(fit.margin).toBeGreaterThan(0.008)
    expect(fit.margin).toBeLessThan(0.04)
  })
})

describe('the assertions themselves', () => {
  it('reports a reversed index buffer as entirely mis-wound', () => {
    // The point of this test is that `windingDisagreements` is capable of
    // failing. An assertion that cannot fail is worse than no assertion, and the
    // NaN episode in the cliff family is this project's own proof: two checks
    // ran over bad data for a whole build and both passed.
    const source = modelOf('sword').geometry
    const flipped = source.clone()
    const index = source.index!
    const reversed = new Uint32Array(index.count)
    for (let f = 0; f < index.count; f += 3) {
      reversed[f] = index.getX(f)
      reversed[f + 1] = index.getX(f + 2)
      reversed[f + 2] = index.getX(f + 1)
    }
    flipped.setIndex(new BufferAttribute(reversed, 1))

    expect(windingDisagreements(source)).toBe(0)
    expect(windingDisagreements(flipped)).toBe(triangleCount(flipped))
  })

  it('interpolates a profile spline at its ends and approximates between', () => {
    // The whole authoring model rests on this asymmetry: a stated tip height is
    // exact, and every interior control point is a handle whose lost radius is
    // the bevel. If the spline ever started interpolating everything, every
    // crease in the folder would go hard (GDD R2).
    const values = [0, 1, 1, 0]
    expect(splineAt(values, 0)).toBeCloseTo(0, 12)
    expect(splineAt(values, 1)).toBeCloseTo(0, 12)
    expect(splineAt(values, 0.5)).toBeGreaterThan(0.5)
    expect(splineAt(values, 0.5)).toBeLessThan(1)
    // Total: sampling outside [0, 1] returns the endpoint rather than NaN, which
    // is what keeps the central differences finite at a collapsed ring.
    expect(splineAt(values, -3)).toBe(splineAt(values, 0))
    expect(splineAt(values, 4)).toBe(splineAt(values, 1))
  })
})
