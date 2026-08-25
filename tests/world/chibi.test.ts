import { describe, expect, it } from 'vitest'
import { Bone, BufferAttribute, BufferGeometry, Color, Matrix4, Ray, Vector3 } from 'three'
import {
  CHIBI_BUDGET,
  buildChibiGeometry,
  emptyBoneWeights,
  legBoneWeights,
  skinLegGeometry
} from '@/world/characters/chibiGeometry'
import { DEFAULT_APPEARANCE } from '@/world/characters/equipment'
import { FACE_TRIANGLES } from '@/world/characters/face'
import { limbMesh } from '@/world/characters/limb'
import { RUN, WALK, applyBank, applyGait, applyJump } from '@/world/characters/poses'
import { buildSkeleton } from '@/world/characters/skeleton'
import { BONE_NAMES, BIND_POSE, FIGURE_HEIGHT, boneDefinition } from '@/world/characters/rig'
import { C } from '@/world/art/palette'
import { triangleCount } from '@/world/geometry/budget'

/**
 * ─── The character contract ─────────────────────────────────────────────────
 *
 * A skinned mesh fails differently from a prop. Its failures are silent and
 * total: an inverse bind computed before the world matrices are current
 * collapses the whole figure to a point, weights that don't sum to one shrink
 * limbs toward the origin as they rotate, and a `skinIndex` off by one animates
 * the wrong body part. None of these throw, and all of them look like "the
 * character didn't load".
 */

const { geometry } = buildChibiGeometry()

describe('chibi geometry', () => {
  it('stays inside the GDD §4.1 budget for a chibi human', () => {
    expect(triangleCount(geometry)).toBeLessThanOrEqual(CHIBI_BUDGET)
    // And is not trivially small — a figure that lost its limbs would pass a
    // ceiling check on its own.
    expect(triangleCount(geometry)).toBeGreaterThan(400)
  })

  it('spends its budget where the row says it does', () => {
    // The ceiling used to be written here as a literal 700 and the figure was
    // 692, so the two moved together twice without anyone restating what the
    // gap was for. Broken out instead, because the split is the argument for
    // the ceiling: 192 of the 264 added since is **hands**, and a crowd pays for
    // hands once per townsperson.
    //
    //   654  body without hands (torso, neck, head, arms, legs, feet)
    //   192  two hands, 96 each — see `HAND_PARTS`
    //    60  two ears, 30 each
    //    50  face: 32 eyes, 6 mouth, 12 brows
    //   ---
    //   956  the default figure
    const withEars = buildChibiGeometry(undefined, undefined, { ...DEFAULT_APPEARANCE, hair: 'bowl' })
    const noEars = buildChibiGeometry(undefined, undefined, { ...DEFAULT_APPEARANCE, hair: 'coif' })
    expect(triangleCount(withEars.geometry), 'default figure').toBe(956)
    // `coif` is the one style that is painted *and* covers the ears, so the
    // difference is the ears and nothing else.
    expect(triangleCount(withEars.geometry) - triangleCount(noEars.geometry), 'two ears').toBe(60)
    expect(FACE_TRIANGLES, 'face').toBe(50)
    expect(triangleCount(withEars.geometry) - FACE_TRIANGLES - 60, 'body with hands').toBe(846)
  })

  it('carries every attribute a skinned toon mesh needs', () => {
    for (const name of ['position', 'normal', 'color', 'skinIndex', 'skinWeight']) {
      expect(geometry.getAttribute(name), name).toBeTruthy()
    }
    expect(geometry.index).toBeTruthy()
  })

  it('emits only finite floats', () => {
    for (const name of ['position', 'normal', 'color', 'skinWeight']) {
      const array = geometry.getAttribute(name).array as ArrayLike<number>
      let bad = 0
      for (let i = 0; i < array.length; i++) {
        // Positive test: every comparison against NaN is false, so a range check
        // would pass on the exact bug it exists to catch.
        if (!Number.isFinite(array[i]!)) {
          bad++
        }
      }
      expect(bad, name).toBe(0)
    }
  })

  it('carries unit-length normals', () => {
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

  it('gives every vertex weights that sum to one', () => {
    // Weights that sum to less than one pull a vertex toward the origin in
    // proportion to the shortfall — limbs visibly shrink as they rotate away
    // from bind pose, and only as they rotate, which reads as a modelling bug.
    const weights = geometry.getAttribute('skinWeight')
    let wrong = 0
    for (let i = 0; i < weights.count; i++) {
      const sum = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i)
      if (Math.abs(sum - 1) > 1e-4) {
        wrong++
      }
    }
    expect(wrong).toBe(0)
  })

  it('indexes only bones that exist', () => {
    const indices = geometry.getAttribute('skinIndex')
    let out = 0
    for (let i = 0; i < indices.count; i++) {
      for (const value of [indices.getX(i), indices.getY(i), indices.getZ(i), indices.getW(i)]) {
        if (!Number.isInteger(value) || value < 0 || value >= BONE_NAMES.length) {
          out++
        }
      }
    }
    expect(out).toBe(0)
  })

  it('actually blends at joints rather than assigning limbs whole', () => {
    // A rig with every vertex at weight 1 is rigid: elbows hinge like a doll's
    // and the mesh tears open on the inside of the bend.
    const weights = geometry.getAttribute('skinWeight')
    let blended = 0
    for (let i = 0; i < weights.count; i++) {
      if (weights.getY(i) > 0.05) {
        blended++
      }
    }
    expect(blended / weights.count).toBeGreaterThan(0.15)
  })

  it('stands on the ground and is three heads tall', () => {
    const position = geometry.getAttribute('position')
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 0; i < position.count; i++) {
      minY = Math.min(minY, position.getY(i))
      maxY = Math.max(maxY, position.getY(i))
    }
    // Feet at the origin plane, give or take the sole's rounding.
    expect(minY).toBeGreaterThan(-0.02)
    expect(minY).toBeLessThan(0.06)
    // Tight on purpose. At one decimal this passed on a head that spanned
    // 0.89–1.59 m — a 0.70 m balloon that swallowed the neck and overshot the
    // figure's own stated height by 3 cm.
    expect(maxY).toBeGreaterThan(FIGURE_HEIGHT - 0.02)
    expect(maxY).toBeLessThan(FIGURE_HEIGHT + 0.02)
  })
})

// ─── The leg garment ────────────────────────────────────────────────────────

/**
 * ─── Trousers replace the legs; they do not cover them ──────────────────────
 *
 * The same mechanism `torsoGarment` uses, and the same reason: an overlay on a
 * skinned body has to be skinned too, and a shell that follows one end of a
 * limb parts company with a body that follows both. So the two leg `PartSpec`s
 * are **not emitted at all** and the garment is built into the merged mesh in
 * their place, for zero extra draw calls and zero extra programs.
 *
 * What is different from the torso, and what these tests exist for:
 *
 *   * **A torso is one bone pair; the legs are two chains of three.** The weight
 *     rule is `legBoneWeights` rather than a scalar, it can return three bones
 *     near the crotch, and it has to reproduce the *body's own* rule everywhere
 *     the body has geometry — otherwise the trouser and the boot below it move
 *     differently and the ankle opens.
 *   * **Removing them removes twice as much.** The torso is 96 triangles in one
 *     place; the legs are 144 in four, and what is left below is the boot. A gap
 *     between a trouser hem and a boot is a hole straight through the character.
 *
 * The garment used here is synthetic — two capsules, 36 triangles each. That is
 * on purpose: this suite is about the *substitution*, and a test that imported
 * the real trousers would fail whenever the trousers changed and would say
 * nothing about whether the mechanism is sound.
 */
const HIPS_Y = boneDefinition('hips').head[1]

/** A trouser leg: a tube from inside the pelvis to inside the boot. */
const trouserLeg = (side: 1 | -1): { position: number[]; normal: number[]; color: number[]; index: number[] } => {
  const part = limbMesh({
    // Hips-joint frame, which is what `buildChibiGeometry` expects: y = 0 is the
    // hips joint. 70 mm up into the pelvis and past the thigh cap's own pole,
    // and down to 70 mm above the ground, inside the boot.
    //
    // ── Three things the differential test below forced, in order ──────────
    //
    // Every one of them is a requirement a *real* leg garment inherits, which is
    // most of why this fixture is worth having:
    //
    //   * **Fatter than the leg it replaces** — 98 mm against the thigh's 85,
    //     90 against the shin's 72.
    //   * **Two cap rings, not one.** A single-ring cap is a *cone*: a hem sized
    //     to the shin at the ankle ring is already 3 mm inside it 30 mm further
    //     down.
    //   * **Rings down the leg.** This is the one that is not obvious and it cost
    //     the most: at `rings: 1` the tube has no vertices between the hip and
    //     the ankle, so under linear blend skinning it is a straight chord from
    //     one to the other and **does not bend at the knee at all**. It opened
    //     7 054 rays' worth of hole across the walk and the run. Five rings put a
    //     ring within 12 mm of the knee joint and close it.
    from: new Vector3(side * 0.09, 0.07, 0),
    to: new Vector3(side * 0.1, -0.55, 0),
    radiusStart: 0.098,
    radiusEnd: 0.09,
    radial: 6,
    rings: 5,
    capRings: 2
  })
  const index: number[] = []
  // `limbMesh` winds inward and gear winds outward — `buildChibiGeometry` does
  // not reverse a garment, so the reversal belongs here, exactly as `finishGear`
  // does it for the real models.
  for (let i = 0; i < part.index.length; i += 3) {
    index.push(part.index[i]!, part.index[i + 2]!, part.index[i + 1]!)
  }
  const color: number[] = []
  for (let i = 0; i < part.position.length / 3; i++) {
    // Anything not near-black; R4 is asserted on the merged figure elsewhere.
    color.push(0.35, 0.28, 0.2)
  }
  return { position: [...part.position], normal: [...part.normal], color, index }
}

const trousers = (): BufferGeometry => {
  const position: number[] = []
  const normal: number[] = []
  const color: number[] = []
  const index: number[] = []
  for (const side of [1, -1] as const) {
    const leg = trouserLeg(side)
    const base = position.length / 3
    position.push(...leg.position)
    normal.push(...leg.normal)
    color.push(...leg.color)
    for (const value of leg.index) {
      index.push(base + value)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(color), 3))
  geometry.setIndex(new BufferAttribute(new Uint32Array(index), 1))
  return geometry
}

describe('a leg garment replaces the legs', () => {
  const plain = () => buildChibiGeometry().geometry
  // Default budget on purpose. `LEG_GARMENT_BUDGET` is 0 until an `ItemKind`
  // declares `ITEM_SLOT[kind] === 'legs'`, so this fixture is charged against the
  // body's own ceiling — and it fits, because omitting the legs frees 144: the
  // trousered figure is 956 − 144 + 216 = **1028** against `CHIBI_BUDGET`'s 1060.
  const trousered = () => buildChibiGeometry(undefined, 'chibi/trousered', undefined, null, trousers()).geometry

  it('stops emitting the thigh and shin parts, and keeps the feet', () => {
    const before = plain()
    const after = trousered()
    // Four parts of 36 triangles / 28 vertices removed; two capsules of 108 / 70
    // added. Not "hidden", not draw-ranged out — never built.
    expect(triangleCount(before) - triangleCount(after), 'triangles').toBe(4 * 36 - 2 * 108)
    expect(
      before.getAttribute('position').count - after.getAttribute('position').count,
      'vertices'
    ).toBe(4 * 28 - 2 * 70)

    // The clearest evidence the *parts* are gone rather than merely reweighted:
    // the two colours only they were painted in leave the figure with them.
    const paints = (geometry: BufferGeometry, target: Color): number => {
      const color = geometry.getAttribute('color')
      let hits = 0
      for (let i = 0; i < color.count; i++) {
        if (
          Math.abs(color.getX(i) - target.r) < 1e-5 &&
          Math.abs(color.getY(i) - target.g) < 1e-5 &&
          Math.abs(color.getZ(i) - target.b) < 1e-5
        ) {
          hits++
        }
      }
      return hits
    }
    // `clothShadow` is the knee and the boot shaft, and nothing else on the body.
    expect(paints(before, C.clothShadow), 'knees before').toBeGreaterThan(10)
    expect(paints(after, C.clothShadow), 'knees after').toBe(0)
    // The boots' own colour survives, because the feet do.
    expect(paints(after, C.hairDark), 'boot toes after').toBeGreaterThan(5)
  })

  it('weights the garment by the body’s own rule, down the whole leg', () => {
    // The claim that makes the substitution safe: a garment vertex and a body
    // vertex at the same place get the same weights, so under linear blend
    // skinning they undergo the same affine map and cannot slide apart.
    //
    // Checked two ways, because neither alone says it:
    //
    //   * against a **transcription** of the joint blend, swept down the leg at
    //     5 mm. A formula against a formula, and worth having precisely because
    //     the leg parts are `rings: 1` — the body has vertices at exactly two
    //     parameters per part and nothing in between, and a garment has geometry
    //     all the way down;
    //   * against the body's **emitted** weights where it has any, which is the
    //     only version that catches a change to either side.
    const smoothstep = (k: number): number => k * k * (3 - 2 * k)
    const clamp = (k: number): number => (k < 0 ? 0 : k > 1 ? 1 : k)
    const BLEND = 0.3

    /** The joint blend from `buildChibiGeometry`, written out from scratch. */
    const bodyWeights = (part: 'thigh' | 'shin', side: 'L' | 'R', t: number): Map<string, number> => {
      const parent = part === 'thigh' ? 'hips' : `thigh.${side}`
      const child = part === 'thigh' ? `shin.${side}` : `foot.${side}`
      let other = parent
      let weight = 0
      if (t < BLEND) {
        other = parent
        weight = 0.5 * (1 - smoothstep(clamp(t / BLEND)))
      } else if (t > 1 - BLEND) {
        other = child
        weight = 0.5 * smoothstep(clamp((t - (1 - BLEND)) / BLEND))
      }
      const out = new Map<string, number>()
      out.set(`${part}.${side}`, 1 - weight)
      out.set(other, (out.get(other) ?? 0) + weight)
      return out
    }

    const segment = (from: (typeof BONE_NAMES)[number], to: (typeof BONE_NAMES)[number]) => {
      const head = boneDefinition(from).head
      const tail = boneDefinition(to).head
      const axis = new Vector3(tail[0] - head[0], tail[1] - head[1], tail[2] - head[2])
      const length = axis.length()
      return { head: new Vector3(head[0], head[1], head[2]), axis: axis.divideScalar(length), length }
    }

    const scratch = emptyBoneWeights()
    const compare = (point: Vector3, wanted: Map<string, number>, where: string): void => {
      legBoneWeights(point.x, point.y, point.z, scratch)
      const got = new Map<string, number>()
      for (let slot = 0; slot < 4; slot++) {
        if (scratch.weight[slot]! === 0) continue
        const name = BONE_NAMES[scratch.index[slot]!]!
        got.set(name, (got.get(name) ?? 0) + scratch.weight[slot]!)
      }
      for (const name of new Set([...got.keys(), ...wanted.keys()])) {
        expect(got.get(name) ?? 0, `${where}: ${name}`).toBeCloseTo(wanted.get(name) ?? 0, 3)
      }
    }

    // ── Swept down both legs, 5 mm at a time, 60 mm out in +Z ───────────────
    //
    // **+Z, not +X.** Both leg axes lie in the x–y plane, so a Z offset is
    // exactly perpendicular to them and the sample's projection is still `t`.
    // Offsetting in x instead shifts `t` by 8 ‰ at the hip, because the thigh's
    // axis is 2.1° off vertical — which is the same effect the note at the end
    // of this test is about, arriving where it was not wanted.
    const point = new Vector3()
    let swept = 0
    for (const side of ['L', 'R'] as const) {
      for (const part of ['thigh', 'shin'] as const) {
        const bone =
          part === 'thigh' ? segment(`thigh.${side}`, `shin.${side}`) : segment(`shin.${side}`, `foot.${side}`)
        for (let t = 0; t <= 1 + 1e-9; t += 0.005 / bone.length) {
          const clamped = Math.min(1, t)
          point.copy(bone.head).addScaledVector(bone.axis, clamped * bone.length)
          point.z += 0.06
          compare(point, bodyWeights(part, side, clamped), `${part}.${side} t=${clamped.toFixed(3)}`)
          swept++
        }
      }
    }
    expect(swept, 'samples down the legs').toBeGreaterThan(200)

    // ── And against the body's own vertices, where it has any ────────────────
    //
    // Only the two rings per part that sit *on* the part (`t = 0` and `t = 1`).
    // Everything else is a spherical cap: `limbMesh` runs one 70 mm past each
    // joint and `chibiGeometry` **clamps** the blend parameter there, so the
    // thigh's end-cap pole — 70 mm below the knee, buried inside the shin — is
    // weighted 50/50 thigh/shin where a positional rule reads 96 % shin. That is
    // a real disagreement and the positional answer is the more honest one; it
    // is skipped rather than absorbed into a loose tolerance, which is what would
    // have hidden it.
    const body = plain()
    const position = body.getAttribute('position')
    const skinIndex = body.getAttribute('skinIndex')
    const skinWeight = body.getAttribute('skinWeight')
    const legBones = new Set(
      (['thigh.L', 'thigh.R', 'shin.L', 'shin.R'] as const).map(name => BONE_NAMES.indexOf(name))
    )
    /** How far along its own part a body vertex sits, from its position alone. */
    const parameterOnOwnPart = (bone: number, x: number, y: number, z: number): number => {
      const name = BONE_NAMES[bone]!
      const child = (name.startsWith('thigh')
        ? `shin.${name.slice(-1)}`
        : `foot.${name.slice(-1)}`) as (typeof BONE_NAMES)[number]
      const own = segment(name as (typeof BONE_NAMES)[number], child)
      return (
        ((x - own.head.x) * own.axis.x + (y - own.head.y) * own.axis.y + (z - own.head.z) * own.axis.z) / own.length
      )
    }

    let checked = 0
    let worst = 0
    for (let i = 0; i < position.count; i++) {
      const self = skinIndex.getX(i)
      if (!legBones.has(self)) continue
      const x = position.getX(i)
      const y = position.getY(i)
      const z = position.getZ(i)
      if (Math.abs(x) < 0.02) continue
      const t = parameterOnOwnPart(self, x, y, z)
      if (t < -1e-6 || t > 1 + 1e-6) continue
      legBoneWeights(x, y, z, scratch)
      const wanted = new Map<number, number>()
      wanted.set(self, skinWeight.getX(i))
      const other = skinIndex.getY(i)
      wanted.set(other, (wanted.get(other) ?? 0) + skinWeight.getY(i))
      for (let slot = 0; slot < 4; slot++) {
        if (scratch.weight[slot]! === 0) continue
        worst = Math.max(worst, Math.abs(scratch.weight[slot]! - (wanted.get(scratch.index[slot]!) ?? 0)))
      }
      checked++
    }
    expect(checked, 'body vertices compared').toBeGreaterThan(40)
    // **1.6 ‰, and it is not slack — it is the knee, and it is irreducible.**
    //
    // The body knows which part a vertex belongs to by construction; a
    // positional rule has to decide. The thigh's axis and the shin's are not
    // collinear (`thigh.L` → `shin.L` runs 2.1° off vertical, `shin.L` →
    // `foot.L` is dead vertical), so a vertex sitting *on* the knee joint but
    // 70 mm out to one side projects to `t = 0.990` on the thigh rather than to
    // 1.000, and gets 0.4985 of shin where the body wrote 0.5000. Bounded rather
    // than removed: removing it would mean the garment carrying its own "which
    // segment" tag, which is a rig the gear module would have to author against.
    expect(worst, 'worst weight disagreement with the body').toBeLessThan(0.002)
  })

  it('skins a leg-framed geometry on its own, in the body’s space', () => {
    // The legs' `skinTorsoGeometry`: for a paper-doll preview or a test that
    // wants the garment skinned without a body around it. The trap it exists to
    // close is the **frame** — gear is authored with y = 0 at the hips joint and
    // skinning needs bind-pose world space, and getting it wrong does not error:
    // every vertex simply lands somewhere else down the leg and takes the wrong
    // weights.
    const source = trousers()
    const skinned = skinLegGeometry(source)
    const before = source.getAttribute('position')
    const after = skinned.getAttribute('position')
    expect(after.count).toBe(before.count)
    for (let i = 0; i < before.count; i++) {
      // Float32 round-trip, so 6 decimals rather than exact.
      expect(after.getY(i), `vertex ${i}`).toBeCloseTo(before.getY(i) + boneDefinition('hips').head[1], 6)
    }
    const weights = skinned.getAttribute('skinWeight')
    for (let i = 0; i < weights.count; i++) {
      const sum = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i)
      expect(sum, `vertex ${i} weights`).toBeCloseTo(1, 6)
    }
    // Shared, not copied — the same argument `skinTorsoGeometry` makes: a
    // translation does not rotate a normal or change a colour.
    expect(skinned.getAttribute('normal')).toBe(source.getAttribute('normal'))
    expect(skinned.getIndex()).toBe(source.getIndex())
  })

  it('is continuous across the midline and sums to one everywhere', () => {
    // The band is the one place the rule is *not* the body's, so it needs its
    // own guard: it must be smooth (a step would tear a crotch), symmetric, and
    // it must never leak weight.
    const scratch = emptyBoneWeights()
    const total = (x: number, y: number): number => {
      legBoneWeights(x, y, 0, scratch)
      return scratch.weight.reduce((sum, w) => sum + w, 0)
    }
    let previous: number[] | null = null
    for (let x = -0.06; x <= 0.06 + 1e-9; x += 0.002) {
      expect(total(x, 0.45), `sum at x=${x.toFixed(3)}`).toBeCloseTo(1, 6)
      legBoneWeights(x, 0.45, 0, scratch)
      const bundle = [...BONE_NAMES.keys()].map(() => 0)
      for (let slot = 0; slot < 4; slot++) {
        bundle[scratch.index[slot]!] = bundle[scratch.index[slot]!]! + scratch.weight[slot]!
      }
      if (previous) {
        for (let b = 0; b < bundle.length; b++) {
          // A smoothstep's steepest slope is 1.5 / width, so over a 24 mm band
          // sampled every 2 mm no share may move by more than 0.125. A hard
          // side split would show up here as a single step of 0.5.
          expect(Math.abs(bundle[b]! - previous[b]!), `bone ${BONE_NAMES[b]} steps at x=${x.toFixed(3)}`).toBeLessThan(0.13)
        }
      }
      previous = bundle
    }
    // Symmetric about the midline: mirror x and the left/right shares swap.
    legBoneWeights(0, 0.45, 0, scratch)
    const left = scratch.index.findIndex((b, i) => b === BONE_NAMES.indexOf('thigh.L') && scratch.weight[i]! > 0)
    const right = scratch.index.findIndex((b, i) => b === BONE_NAMES.indexOf('thigh.R') && scratch.weight[i]! > 0)
    expect(left, 'left thigh present at the midline').toBeGreaterThanOrEqual(0)
    expect(right, 'right thigh present at the midline').toBeGreaterThanOrEqual(0)
    expect(scratch.weight[left]!).toBeCloseTo(scratch.weight[right]!, 9)
  })

  it('welds to the pelvis above rather than swinging with the leg', () => {
    // The one place the rule deliberately leaves the thigh part's own: above the
    // thigh joint it ramps to *pure* hips, because what a waistband is welded to
    // up there is the torso, and the torso is weight 1 on `hips`.
    const scratch = emptyBoneWeights()
    legBoneWeights(0.09, HIPS_Y + 0.09, 0, scratch)
    expect(scratch.index[0]).toBe(BONE_NAMES.indexOf('hips'))
    expect(scratch.weight[0]).toBeCloseTo(1, 6)
    // And both sides agree there, so a bridging waistband cannot shear.
    const mirrored = emptyBoneWeights()
    legBoneWeights(-0.09, HIPS_Y + 0.09, 0, mirrored)
    expect(mirrored.index[0]).toBe(scratch.index[0])
    expect(mirrored.weight[0]).toBeCloseTo(scratch.weight[0]!, 9)
  })

  it('opens no hole the legs were closing, in any pose', () => {
    // The differential test the torso substitution earned, aimed at the legs.
    // Absolute solidity is not the claim — the figure has genuine air between
    // its thighs — so what must hold is that **every ray the plain body stops,
    // the trousered one stops too**, over the bands the substitution can affect:
    // the pelvis where the trouser meets the torso, the thigh and shin it
    // replaces outright, and the ankle where it meets the boot.
    const soupOf = (geometry: BufferGeometry) => {
      const position = geometry.getAttribute('position')
      const skinIndex = geometry.getAttribute('skinIndex')
      const skinWeight = geometry.getAttribute('skinWeight')
      const source = geometry.getIndex()!
      const rest = new Float32Array(position.count * 3)
      for (let i = 0; i < position.count; i++) {
        rest[i * 3] = position.getX(i)
        rest[i * 3 + 1] = position.getY(i)
        rest[i * 3 + 2] = position.getZ(i)
      }
      const index = new Uint32Array(source.count)
      for (let i = 0; i < source.count; i++) index[i] = source.getX(i)
      // All four slots, not two: a leg garment is the first thing on this figure
      // that uses three bones, and a two-slot reader would silently drop a third
      // of a crotch vertex's transform and report holes that are not there.
      return { rest, index, skinIndex, skinWeight }
    }
    const skin = (soup: ReturnType<typeof soupOf>, matrices: Matrix4[], out: Float32Array): void => {
      const point = new Vector3()
      const accumulated = new Vector3()
      for (let i = 0; i < soup.skinIndex.count; i++) {
        accumulated.set(0, 0, 0)
        for (const [bone, weight] of [
          [soup.skinIndex.getX(i), soup.skinWeight.getX(i)],
          [soup.skinIndex.getY(i), soup.skinWeight.getY(i)],
          [soup.skinIndex.getZ(i), soup.skinWeight.getZ(i)],
          [soup.skinIndex.getW(i), soup.skinWeight.getW(i)]
        ] as const) {
          if (weight === 0) continue
          point.fromArray(soup.rest, i * 3).applyMatrix4(matrices[bone]!).multiplyScalar(weight)
          accumulated.add(point)
        }
        out[i * 3] = accumulated.x
        out[i * 3 + 1] = accumulated.y
        out[i * 3 + 2] = accumulated.z
      }
    }
    const poseMatrices = (apply: (built: ReturnType<typeof buildSkeleton>) => void): Matrix4[] => {
      const built = buildSkeleton()
      apply(built)
      built.root.updateMatrixWorld(true)
      return built.skeleton.bones.map((bone, i) =>
        new Matrix4().multiplyMatrices(bone.matrixWorld, built.skeleton.boneInverses[i]!)
      )
    }
    const poses = [{ label: 'bind', matrices: poseMatrices(() => {}) }]
    for (let step = 0; step < 4; step++) {
      for (const bank of [-0.35, 0.35]) {
        for (const [label, weight] of [
          ['walk', 0],
          ['run', 1]
        ] as const) {
          poses.push({
            label: `${label} ${step}/4 bank ${bank}`,
            matrices: poseMatrices(built => {
              applyGait(built.byName, step / 4, WALK, RUN, weight)
              applyBank(built.byName, bank)
            })
          })
        }
      }
      poses.push({ label: `jump ${step}/4`, matrices: poseMatrices(built => applyJump(built.byName, step / 4)) })
    }

    const bare = soupOf(plain())
    const dressed = soupOf(trousered())
    const barePosed = new Float32Array(bare.rest.length)
    const dressedPosed = new Float32Array(dressed.rest.length)

    const ray = new Ray()
    const a = new Vector3()
    const b = new Vector3()
    const c = new Vector3()
    const hit = new Vector3()
    const blocked = (positions: Float32Array, index: Uint32Array): boolean => {
      for (let f = 0; f < index.length; f += 3) {
        a.fromArray(positions, index[f]! * 3)
        b.fromArray(positions, index[f + 1]! * 3)
        c.fromArray(positions, index[f + 2]! * 3)
        if (ray.intersectTriangle(a, b, c, false, hit)) return true
      }
      return false
    }

    let cast = 0
    let holes = 0
    let first = ''
    for (const pose of poses) {
      skin(bare, pose.matrices, barePosed)
      skin(dressed, pose.matrices, dressedPosed)
      for (let bearing = 0; bearing < 8; bearing++) {
        const theta = (bearing / 8) * Math.PI * 2
        const dx = Math.sin(theta)
        const dz = Math.cos(theta)
        for (let side = -25; side <= 25; side++) {
          const offset = side * 0.01
          for (let y = 0.02; y <= 0.72; y += 0.02) {
            ray.origin.set(Math.cos(theta) * offset - dx * 3, y, -Math.sin(theta) * offset - dz * 3)
            ray.direction.set(dx, 0, dz)
            cast++
            if (blocked(barePosed, bare.index) && !blocked(dressedPosed, dressed.index)) {
              holes++
              if (!first) first = `${pose.label} at y=${y.toFixed(3)}, offset ${offset.toFixed(3)}, bearing ${bearing}`
            }
          }
        }
      }
    }
    expect(cast).toBeGreaterThan(200_000)
    expect(holes, first).toBe(0)
  }, 180_000)
})

describe('skeleton', () => {
  it('orders bones to match the geometry it will be indexed by', () => {
    // `skinIndex` is an index into `skeleton.bones`. If these two orders ever
    // disagree the character animates, correctly, with the wrong limbs.
    const { skeleton } = buildSkeleton()
    expect(skeleton.bones.map(bone => bone.name)).toEqual([...BONE_NAMES])
  })

  it('reproduces the bind pose in world space', () => {
    const { skeleton, root } = buildSkeleton()
    root.updateMatrixWorld(true)
    const world = new Vector3()
    for (const bone of skeleton.bones) {
      world.setFromMatrixPosition(bone.matrixWorld)
      const expected = boneDefinition(bone.name as (typeof BONE_NAMES)[number]).head
      expect(world.x, bone.name).toBeCloseTo(expected[0], 5)
      expect(world.y, bone.name).toBeCloseTo(expected[1], 5)
      expect(world.z, bone.name).toBeCloseTo(expected[2], 5)
    }
  })

  it('computes inverse binds that are not degenerate', () => {
    // `calculateInverses` on bones whose world matrices were never updated
    // yields all-zero matrices — a perfectly valid value that collapses the
    // entire figure to the origin, silently.
    const { skeleton } = buildSkeleton()
    for (const inverse of skeleton.boneInverses) {
      const determinant = inverse.determinant()
      expect(Number.isFinite(determinant)).toBe(true)
      expect(Math.abs(determinant)).toBeGreaterThan(1e-6)
    }
  })

  it('parents every bone except the root', () => {
    const { byName } = buildSkeleton()
    for (const definition of BIND_POSE) {
      const bone = byName.get(definition.name)!
      if (definition.parent === null) {
        expect(bone.parent).toBeNull()
      } else {
        expect((bone.parent as Bone).name).toBe(definition.parent)
      }
    }
  })
})
// The gait suite that used to live here has moved to `gait.test.ts` and been
// rewritten. It asserted rotation *signs* — including `shin.rotation.x <= 0` —
// which passed on a rig whose knees bent forwards, because the test was written
// from the same wrong assumption as the code. The replacement asserts where the
// foot ends up in world space, which no mirror error survives.
