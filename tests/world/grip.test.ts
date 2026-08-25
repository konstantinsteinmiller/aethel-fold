import { describe, expect, it } from 'vitest'
import { type Bone, Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { applyCarry } from '@/world/characters/combatPoses'
import { applyGait, RUN, WALK } from '@/world/characters/poses'
import { buildSkeleton } from '@/world/characters/skeleton'
import { CHIBI_BUDGET, buildChibiGeometry, type HandGrips } from '@/world/characters/chibiGeometry'
import { CharacterEquipment, type EquipmentHost } from '@/world/characters/CharacterEquipment'
import { gearModel } from '@/world/characters/gear'
import { BONE_NAMES, type BoneName, boneDefinition } from '@/world/characters/rig'
import {
  DEFAULT_APPEARANCE,
  type DrawnState,
  GRIP_ROTATION,
  type ItemKind,
  SOCKETS
} from '@/world/characters/equipment'

/**
 * ─── The grip: how an item sits in a fist, and how the fist closes on it ────
 *
 * Two halves of one defect, reported from a screenshot: **a drawn sword stuck
 * out sideways from the hand like a baton, through a hand that was the same open
 * shape whether it was holding something or not.**
 *
 * They have one cause between them. `SOCKETS.handR/handL` carry an identity
 * rotation shared by everything held, and with the item frame running its length
 * along −Y that points every blade *down the hand* — so the carry pose, which
 * folds the elbow to a right angle, swings it out to horizontal. And the hand
 * has no finger bones, so nothing about the pose could close it around the hilt
 * even if the hilt were in the right place.
 *
 * So there are three things to assert and they are separable:
 *
 * 1. **`GRIP_ROTATION` reaches the mesh.** A table nothing consumes is the state
 *    this feature was found in; the assertion is on the item's *world direction*
 *    at the carry pose, not on the table's contents.
 * 2. **The fist closes per hand, on the right hands.** A character with a sword
 *    and no shield has one closed fist and one open hand.
 * 3. **The bore clears what passes through it**, on both builds and both of the
 *    two items whose grip is fattest.
 */

const rig = (): Map<BoneName, Bone> => {
  const { byName, root } = buildSkeleton()
  root.updateMatrixWorld(true)
  return byName
}

const gripQuaternion = (kind: ItemKind): Quaternion => {
  const grip = GRIP_ROTATION[kind]
  return new Quaternion().setFromEuler(new Euler(grip[0], grip[1], grip[2], 'XYZ'))
}

/** The world direction of an item's local `axis` once the arm is posed. */
const itemAxis = (
  kind: ItemKind,
  side: 'L' | 'R',
  drawn: DrawnState,
  effort: number,
  axis: Vector3
): Vector3 => {
  const bones = rig()
  applyGait(bones, 0.25, WALK, RUN, effort)
  applyCarry(bones, drawn, effort)
  const hand = bones.get(`hand.${side}` as BoneName)!
  hand.updateWorldMatrix(true, false)
  const world = new Quaternion().setFromRotationMatrix(hand.matrixWorld).multiply(gripQuaternion(kind))
  return axis.clone().applyQuaternion(world).normalize()
}

const DOWN_THE_ITEM = new Vector3(0, -1, 0)
const UP_THE_ITEM = new Vector3(0, 1, 0)
const ITEM_FRONT = new Vector3(0, 0, 1)
const ITEM_LEFT = new Vector3(-1, 0, 0)

// ── 1. The grip reaches the item ────────────────────────────────────────────

describe('a drawn item is oriented by its own grip, not by the fist alone', () => {
  it('carries a sword blade-up, and the identity grip it replaced did not', () => {
    // The report was a screenshot, so the assertion is the thing the screenshot
    // showed: which way the blade points in the world.
    for (const effort of [0, 0.5, 1]) {
      const blade = itemAxis('sword', 'R', 'mainHand', effort, DOWN_THE_ITEM)
      expect(blade.y, `sword blade at effort ${effort}`).toBeGreaterThan(0.7)
    }
    // …and it is the grip that does it. With the identity rotation this table
    // shipped with, the same pose puts the blade 19° *below* horizontal and
    // pointing across the character — the baton.
    const bones = rig()
    applyGait(bones, 0.25, WALK, RUN, 0)
    applyCarry(bones, 'mainHand', 0)
    const hand = bones.get('hand.R')!
    hand.updateWorldMatrix(true, false)
    const bare = DOWN_THE_ITEM.clone().applyQuaternion(new Quaternion().setFromRotationMatrix(hand.matrixWorld))
    expect(bare.y).toBeLessThan(0)
    expect(bare.z).toBeGreaterThan(0.8)
  })

  it('carries a greatsword blade-up too, clear of the head', () => {
    for (const effort of [0, 1]) {
      const blade = itemAxis('greatsword', 'R', 'twoHand', effort, DOWN_THE_ITEM)
      expect(blade.y, `greatsword blade at effort ${effort}`).toBeGreaterThan(0.7)
    }
    // The blade is a metre long and it leans back over the left shoulder, so the
    // one thing worth checking beyond its direction is that it misses the skull.
    const bones = rig()
    applyGait(bones, 0.25, WALK, RUN, 0)
    applyCarry(bones, 'twoHand', 0)
    const hand = bones.get('hand.R')!
    hand.updateWorldMatrix(true, false)
    const grip = new Vector3(...SOCKETS.handR.position).applyMatrix4(hand.matrixWorld)
    const blade = itemAxis('greatsword', 'R', 'twoHand', 0, DOWN_THE_ITEM)
    const head = new Vector3(...boneDefinition('head').head).setY(1.29)
    // Closest approach of the blade's ray to the head's centre, against a 0.25 m
    // skull. Measured: 388 mm, so it clears by 138 mm.
    const toHead = head.clone().sub(grip)
    const along = Math.max(0, toHead.dot(blade))
    const miss = toHead.sub(blade.clone().multiplyScalar(along)).length()
    expect(miss).toBeGreaterThan(0.3)
  })

  it('aims a crossbow forward and lays its prod level', () => {
    for (const effort of [0, 1]) {
      // The bolt flies down the item's −Y and the carry pose points the forearm
      // at it, so this is the property identity already had and must not lose.
      const bolt = itemAxis('crossbow', 'R', 'crossbow', effort, DOWN_THE_ITEM)
      expect(Math.abs(bolt.y), `crossbow bolt at effort ${effort}`).toBeLessThan(0.12)
      expect(bolt.z, `crossbow bolt at effort ${effort}`).toBeGreaterThan(0.85)
      // The prod spans ±Z and identity stood it vertical — a bow bolted sideways
      // onto a stick. The quarter turn is about the aim line, so it levels the
      // prod without moving the bolt.
      const prod = itemAxis('crossbow', 'R', 'crossbow', effort, ITEM_FRONT)
      expect(Math.abs(prod.y), `crossbow prod at effort ${effort}`).toBeLessThan(0.45)
      // …and the bolt rail, the −X face, ends up on top.
      const rail = itemAxis('crossbow', 'R', 'crossbow', effort, ITEM_LEFT)
      expect(rail.y, `crossbow rail at effort ${effort}`).toBeGreaterThan(0.85)
    }
  })

  it('stands a bow across the fist rather than along the forearm', () => {
    // A bow is gripped at the riser with the stave running through the fist, so
    // its length has to leave on the hand's own grip axis. The check that it does
    // is that the upper limb is *up* — with the identity grip the stave lay along
    // the forearm and the bow read as a sliver stuck to the arm.
    for (const effort of [0, 1]) {
      const limb = itemAxis('bow', 'L', 'bow', effort, UP_THE_ITEM)
      expect(limb.y, `bow upper limb at effort ${effort}`).toBeGreaterThan(0.55)
    }
  })

  it('leaves the shield alone, because a shield is worn and not gripped', () => {
    // `applyShield` aims the plate by forearm pronation against a normal authored
    // in the identity frame. A grip rotation here would have to be undone there.
    expect(GRIP_ROTATION.shield).toEqual([0, 0, 0])
  })

  it('never turns an item on a stow socket', () => {
    // The hip and back sockets are frozen numbers several agents build against —
    // `equipment.ts` records the 324-combination search that set `hipR` — and a
    // quarter turn there stands a sheathed sword out of its scabbard sideways.
    const host = bareHost()
    const equipment = new CharacterEquipment(host, { outline: false, castShadow: false, drawDuration: 0 })
    equipment.equip('mainHand', 'sword')
    const object = equipment.objectAt('mainHand')!
    expect(equipment.socketAt('mainHand')).toBe('hipR')
    const stowed = new Quaternion().setFromEuler(
      new Euler(SOCKETS.hipR.rotation[0], SOCKETS.hipR.rotation[1], SOCKETS.hipR.rotation[2], 'XYZ')
    )
    expect(object.quaternion.angleTo(stowed)).toBeLessThan(1e-6)

    equipment.setDrawn('mainHand')
    expect(equipment.socketAt('mainHand')).toBe('handR')
    expect(object.quaternion.angleTo(gripQuaternion('sword'))).toBeLessThan(1e-6)
    equipment.dispose()
  })
})

// ── 2. The fist ─────────────────────────────────────────────────────────────

/**
 * The smallest thing that satisfies `EquipmentHost`, plus a record of every
 * `setFists` call.
 *
 * A bare skeleton rather than a `Character`: the point of the interface is that
 * the state machine can be driven without building a body, and a test that
 * builds one cannot tell whether the *equipment* asked for the right fists or
 * whether the body happened to agree.
 */
const bareHost = () => {
  const { byName, root, skeleton } = buildSkeleton()
  root.updateMatrixWorld(true)
  const calls: [boolean, boolean][] = []
  const host = {
    bone: (name: BoneName) => byName.get(name) ?? null,
    group: root,
    body: { skeleton } as never,
    setFists: (left: boolean, right: boolean) => {
      calls.push([left, right])
    },
    calls
  }
  return host as unknown as EquipmentHost & { calls: [boolean, boolean][] }
}

describe('a hand closes only on what it is actually gripping', () => {
  const fistsFor = (loadout: {
    mainHand?: ItemKind
    offHand?: ItemKind
    back?: ItemKind
    drawn: DrawnState
  }): [boolean, boolean] => {
    const host = bareHost()
    const equipment = new CharacterEquipment(host, { outline: false, castShadow: false, drawDuration: 0 })
    equipment.setLoadout({
      mainHand: loadout.mainHand ?? null,
      offHand: loadout.offHand ?? null,
      back: loadout.back ?? null,
      head: null,
      torso: null,
      legs: null,
      drawn: loadout.drawn
    })
    equipment.dispose()
    return host.calls.length > 0 ? host.calls[host.calls.length - 1]! : [false, false]
  }

  it('closes one fist for a sword and leaves the other hand open', () => {
    expect(fistsFor({ mainHand: 'sword', drawn: 'mainHand' })).toEqual([false, true])
  })

  it('closes both for a greatsword, because both hands are on the haft', () => {
    // `linkOffHand` gives the support hand the leading hand's own orientation, so
    // the same haft runs down both bores.
    expect(fistsFor({ back: 'greatsword', drawn: 'twoHand' })).toEqual([true, true])
  })

  it('closes the bow hand and not the draw hand', () => {
    expect(fistsFor({ back: 'bow', drawn: 'bow' })).toEqual([true, false])
  })

  it('closes neither for a crossbow', () => {
    // Its tiller lies along the forearm rather than across the fist (identity
    // grip, held like a torch), so it crosses no bore; the support hand cups the
    // fore-end from underneath.
    expect(fistsFor({ back: 'crossbow', drawn: 'crossbow' })).toEqual([false, false])
  })

  it('keeps the shield hand open even while the other is on a sword', () => {
    // A strapped shield is worn, not gripped: the forearm carries it and the
    // fingers lie on a strap.
    expect(fistsFor({ mainHand: 'sword', offHand: 'shield', drawn: 'mainHand' })).toEqual([false, true])
  })

  it('opens both again when the weapon is put away', () => {
    expect(fistsFor({ mainHand: 'sword', drawn: 'sheathed' })).toEqual([false, false])
  })

  it('asks for a rebuild only when the answer changes', () => {
    const host = bareHost()
    const equipment = new CharacterEquipment(host, { outline: false, castShadow: false, drawDuration: 0 })
    equipment.equip('mainHand', 'sword')
    equipment.setDrawn('mainHand')
    const afterDraw = host.calls.length
    // Equipping a hat, changing nothing about either hand.
    equipment.equip('head', 'hat')
    expect(host.calls.length).toBe(afterDraw)
    equipment.setDrawn('sheathed')
    expect(host.calls.length).toBe(afterDraw + 1)
    equipment.dispose()
  })

  it('does nothing at all to a host that cannot rebuild its body', () => {
    // A monster rig, or a bare `SkinnedMesh`: it wears the sword and simply does
    // not get a hand that closes.
    const { byName, root } = buildSkeleton()
    root.updateMatrixWorld(true)
    const host = { bone: (n: BoneName) => byName.get(n) ?? null, group: root, body: {} as never }
    const equipment = new CharacterEquipment(host as unknown as EquipmentHost, {
      outline: false,
      castShadow: false,
      drawDuration: 0
    })
    expect(() => equipment.setLoadout({
      mainHand: 'sword',
      offHand: null,
      back: null,
      head: null,
      torso: null,
      legs: null,
      drawn: 'mainHand'
    })).not.toThrow()
    equipment.dispose()
  })
})

// ── 3. The fist's geometry ──────────────────────────────────────────────────

const build = (grips: HandGrips, sex: 'male' | 'female' = 'male') =>
  buildChibiGeometry(CHIBI_BUDGET, 'grip-test', { ...DEFAULT_APPEARANCE, sex }, null, null, grips)

const triangles = (geometry: { getIndex(): { count: number } | null }): number => {
  const index = geometry.getIndex()
  if (!index) {
    throw new Error('expected an indexed geometry')
  }
  return index.count / 3
}

describe('the closed fist', () => {
  it('costs less than the open hand it replaces', () => {
    // The agent that built the hands flagged 192 triangles — 19 % of the figure —
    // as the first thing a coarse tier should attack, so a fist that cost more
    // would be a bad trade at crowd scale. It is 90 against the open hand's 96:
    // 60 for the swept barrel and 30 for the thumb across it.
    const open = triangles(build({ L: false, R: false }).geometry)
    const one = triangles(build({ L: false, R: true }).geometry)
    const both = triangles(build({ L: true, R: true }).geometry)
    expect(open - one).toBe(6)
    expect(open - both).toBe(12)
    expect(both).toBeLessThan(CHIBI_BUDGET)
  })

  it('leaves the open figure byte-identical', () => {
    // `characterVariants` hashes the default figure. A closed hand is an
    // *addition*, and the open hand it does not replace may not move by a ULP.
    const a = build({ L: false, R: false }).geometry.getAttribute('position')
    const b = buildChibiGeometry().geometry.getAttribute('position')
    expect(a.count).toBe(b.count)
    for (let i = 0; i < a.count * 3; i++) {
      expect((a.array as Float32Array)[i]).toBe((b.array as Float32Array)[i])
    }
  })

  it('winds every triangle outward', () => {
    // `limbMesh` winds inward and this file reverses it; the fist is authored
    // rather than swept from `limbMesh`, so it has to be checked on its own.
    const { geometry } = build({ L: true, R: true })
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    const index = geometry.getIndex()!
    const a = new Vector3()
    const b = new Vector3()
    const c = new Vector3()
    const face = new Vector3()
    const authored = new Vector3()
    let inward = 0
    for (let i = 0; i < index.count; i += 3) {
      const ia = index.getX(i)
      const ib = index.getX(i + 1)
      const ic = index.getX(i + 2)
      a.set(position.getX(ia), position.getY(ia), position.getZ(ia))
      b.set(position.getX(ib), position.getY(ib), position.getZ(ib))
      c.set(position.getX(ic), position.getY(ic), position.getZ(ic))
      face.copy(b).sub(a).cross(c.clone().sub(a))
      authored.set(
        normal.getX(ia) + normal.getX(ib) + normal.getX(ic),
        normal.getY(ia) + normal.getY(ib) + normal.getY(ic),
        normal.getZ(ia) + normal.getZ(ib) + normal.getZ(ic)
      )
      if (face.dot(authored) < 0) {
        inward++
      }
    }
    expect(inward).toBe(0)
  })

  it('has unit normals everywhere and no NaN', () => {
    const normal = build({ L: true, R: true }).geometry.getAttribute('normal')
    for (let i = 0; i < normal.count; i++) {
      const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))
      expect(Number.isFinite(length)).toBe(true)
      expect(Math.abs(length - 1)).toBeLessThan(1e-4)
    }
  })

  it('weights the fist to the hand, ramping to the forearm at the wrist', () => {
    // The barrel straddles the wrist, so its heel has to blend toward the forearm
    // exactly as the open palm's start cap does. Anything weighted 1.0 to `hand`
    // all the way through would tear at the wrist the first time it turned.
    const { geometry } = build({ L: false, R: true })
    const open = build({ L: false, R: false }).geometry
    const index = geometry.getAttribute('skinIndex')
    const weight = geometry.getAttribute('skinWeight')
    const handBone = BONE_NAMES.indexOf('hand.R')
    const foreBone = BONE_NAMES.indexOf('forearm.R')
    let blended = 0
    let onHand = 0
    for (let i = 0; i < index.count; i++) {
      if (index.getX(i) !== handBone) {
        continue
      }
      onHand++
      const other = index.getY(i)
      const share = weight.getY(i)
      expect(Math.abs(weight.getX(i) + share - 1)).toBeLessThan(1e-5)
      expect(share).toBeGreaterThanOrEqual(0)
      // Never more than an even split — that is what "reaches 50/50 at the joint"
      // means, and a weight above it would make the hand follow the forearm.
      expect(share).toBeLessThanOrEqual(0.5 + 1e-6)
      if (share > 0) {
        expect(other === foreBone || other === handBone).toBe(true)
        blended++
      }
    }
    expect(onHand).toBeGreaterThan(0)
    expect(blended).toBeGreaterThan(0)
    // The fist has vertices the open hand does not, so it must not simply
    // reproduce the open hand's block.
    expect(geometry.getAttribute('position').count).not.toBe(open.getAttribute('position').count)
  })

  /**
   * The bore's inner surface, as triangles, in bind-pose world space.
   *
   * Found by geometry rather than by index arithmetic: the bore is the only part
   * of the figure whose authored normals point *at* the hand's grip axis, so it
   * identifies itself and the test cannot drift out of step with the order
   * `buildChibiGeometry` appends things in.
   */
  const boreTriangles = (side: 'L' | 'R', sex: 'male' | 'female') => {
    const { geometry } = build({ L: side === 'L', R: side === 'R' }, sex)
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    const index = geometry.getIndex()!
    const wrist = new Vector3(...boneDefinition(`hand.${side}`).head)
    const socket = SOCKETS[side === 'L' ? 'handL' : 'handR']
    const origin = wrist.clone().add(new Vector3(...socket.position))
    const out: Vector3[][] = []
    const point = (i: number) => new Vector3(position.getX(i), position.getY(i), position.getZ(i))
    for (let i = 0; i < index.count; i += 3) {
      const ia = index.getX(i)
      const ib = index.getX(i + 1)
      const ic = index.getX(i + 2)
      let inward = 0
      for (const j of [ia, ib, ic]) {
        const p = point(j)
        // Radial offset from the bore axis, which runs along Z through the
        // socket. Anything further out than the fist's own radius is some other
        // part of the body that happens to face this way — the torso does, from
        // half a metre off.
        const radial = new Vector3(p.x - origin.x, p.y - origin.y, 0)
        if (radial.length() > 0.05 || Math.abs(p.z - origin.z) > 0.09) {
          continue
        }
        radial.normalize()
        const n = new Vector3(normal.getX(j), normal.getY(j), normal.getZ(j))
        // Inward-facing there means "this is the tunnel".
        if (n.dot(radial) < -0.5) {
          inward++
        }
      }
      if (inward === 3) {
        out.push([point(ia), point(ib), point(ic)])
      }
    }
    return { triangles: out, origin }
  }

  const distanceToTriangle = (p: Vector3, tri: Vector3[]): number => {
    // Point-to-triangle, the standard closest-point construction. Exact, because
    // the number this test reports is a clearance and a bounding approximation
    // would report the wrong one.
    const [a, b, c] = tri as [Vector3, Vector3, Vector3]
    const ab = b.clone().sub(a)
    const ac = c.clone().sub(a)
    const ap = p.clone().sub(a)
    const d1 = ab.dot(ap)
    const d2 = ac.dot(ap)
    if (d1 <= 0 && d2 <= 0) return p.distanceTo(a)
    const bp = p.clone().sub(b)
    const d3 = ab.dot(bp)
    const d4 = ac.dot(bp)
    if (d3 >= 0 && d4 <= d3) return p.distanceTo(b)
    const vc = d1 * d4 - d3 * d2
    if (vc <= 0 && d1 >= 0 && d3 <= 0 && d1 - d3 > 1e-20) {
      return p.distanceTo(a.clone().addScaledVector(ab, d1 / (d1 - d3)))
    }
    const cp = p.clone().sub(c)
    const d5 = ab.dot(cp)
    const d6 = ac.dot(cp)
    if (d6 >= 0 && d5 <= d6) return p.distanceTo(c)
    const vb = d5 * d2 - d1 * d6
    if (vb <= 0 && d2 >= 0 && d6 <= 0 && d2 - d6 > 1e-20) {
      return p.distanceTo(a.clone().addScaledVector(ac, d2 / (d2 - d6)))
    }
    const va = d3 * d6 - d5 * d4
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0 && d4 - d3 + (d5 - d6) > 1e-20) {
      return p.distanceTo(b.clone().addScaledVector(c.clone().sub(b), (d4 - d3) / (d4 - d3 + (d5 - d6))))
    }
    const total = va + vb + vc
    if (!(Math.abs(total) > 1e-20)) {
      // Degenerate triangle: fall back to the nearest corner rather than dividing
      // by an area of zero, which is where this returned NaN and quietly poisoned
      // the running minimum.
      return Math.min(p.distanceTo(a), p.distanceTo(b), p.distanceTo(c))
    }
    const denominator = 1 / total
    const v = vb * denominator
    const w = vc * denominator
    return p.distanceTo(a.clone().addScaledVector(ab, v).addScaledVector(ac, w))
  }

  it('closes around the hilt rather than through it, on both builds', () => {
    // ── The number the whole design is for ───────────────────────────────────
    //
    // The fist is a hollow barrel about the hand's grip axis and the item passes
    // *through* it, so what has to be true is a clearance and not an overlap.
    // Measured here as a real point-to-triangle distance from every vertex of the
    // item that lies inside the fist's span to the bore's inner surface.
    //
    // The greatsword is the binding case at 22.1 mm of grip radius against the
    // sword's 17.1; `FIST_BORE` is not scaled by `limbScale`, because a smaller
    // character holds the same sword — the wall thins instead.
    for (const sex of ['male', 'female'] as const) {
      const { triangles: bore, origin } = boreTriangles('R', sex)
      expect(bore.length, `${sex} bore`).toBeGreaterThan(4)
      const zs = bore.flat().map(p => p.z)
      const from = Math.min(...zs)
      const to = Math.max(...zs)

      for (const kind of ['sword', 'greatsword'] as const) {
        const model = gearModel(kind)
        const position = model.geometry.getAttribute('position')
        // Item space → the hand's, so the item's length runs down the bore.
        const grip = gripQuaternion(kind)
        let worst = Infinity
        const p = new Vector3()
        for (let i = 0; i < position.count; i++) {
          p.set(position.getX(i), position.getY(i), position.getZ(i)).applyQuaternion(grip)
          p.add(origin)
          // Only what is actually inside the fist. The guard and the pommel stand
          // outside it and are supposed to.
          if (p.z < from + 0.002 || p.z > to - 0.002) {
            continue
          }
          for (const tri of bore) {
            worst = Math.min(worst, distanceToTriangle(p, tri))
          }
        }
        // Measured: **10.44 mm on the sword and 5.65 mm on the greatsword**, and
        // identical on both builds — `FIST_BORE` is the one dimension of the hand
        // that `limbScale` does not touch, so a smaller character's wall thins
        // rather than her bore closing on the hilt.
        expect(worst, `${kind} on the ${sex} build`).toBeGreaterThan(0.003)
        expect(worst, `${kind} on the ${sex} build`).toBeLessThan(0.02)
      }
    }
  })

  it('leaves the guard outside the fist rather than swallowing it', () => {
    // The fist's span was set against the shipped models rather than centred on
    // the socket: the sword's quillons reach the bore axis 28 mm out the thumb
    // side of it, and the fist's rim stops short of that so the crossguard sits
    // proud of the knuckles instead of half-buried in them.
    const { triangles: bore, origin } = boreTriangles('R', 'male')
    // Both in socket-relative coordinates, along the bore.
    const rim = Math.max(...bore.flat().map(p => p.z)) - origin.z
    const model = gearModel('sword')
    const position = model.geometry.getAttribute('position')
    const grip = gripQuaternion('sword')
    const p = new Vector3()
    let guard = Infinity
    for (let i = 0; i < position.count; i++) {
      p.set(position.getX(i), position.getY(i), position.getZ(i)).applyQuaternion(grip)
      // The quillons are the only thing on the sword more than 60 mm off its own
      // axis within a hand's reach of the grip.
      if (Math.hypot(p.x, p.y) > 0.06 && Math.abs(p.z) < 0.09) {
        guard = Math.min(guard, p.z)
      }
    }
    expect(Number.isFinite(guard)).toBe(true)
    expect(guard).toBeGreaterThan(rim)
    // …and not so far past it that there is a hand's width of bare grip showing.
    expect(guard - rim).toBeLessThan(0.025)
  })
})

// ── 4. The two halves agree ─────────────────────────────────────────────────

describe('the attachment layer and the pose layer use the same grip', () => {
  it('puts the item where the pose layer thinks it is', () => {
    // `combatPoses` bakes its own copy of `GRIP_ROTATION` for the draw path and
    // the support hand. If the two ever disagreed the item would sit correctly
    // and the second hand would grip air a quarter turn away, which is a failure
    // no single-layer test can see.
    const host = bareHost()
    const equipment = new CharacterEquipment(host, { outline: false, castShadow: false, drawDuration: 0 })
    equipment.equip('back', 'greatsword')
    equipment.setDrawn('twoHand')
    const object = equipment.objectAt('back')!
    object.updateWorldMatrix(true, false)

    const bones = new Map<BoneName, Bone>()
    for (const name of BONE_NAMES) {
      const bone = host.bone(name)
      if (bone) {
        bones.set(name, bone)
      }
    }
    const hand = bones.get('hand.R')!
    hand.updateWorldMatrix(true, false)
    const expected = new Matrix4()
      .compose(
        new Vector3(...SOCKETS.handR.position),
        gripQuaternion('greatsword'),
        new Vector3(1, 1, 1)
      )
      .premultiply(hand.matrixWorld)
    const got = object.matrixWorld
    for (let i = 0; i < 16; i++) {
      expect(Math.abs(got.elements[i]! - expected.elements[i]!)).toBeLessThan(1e-6)
    }
    equipment.dispose()
  })
})
