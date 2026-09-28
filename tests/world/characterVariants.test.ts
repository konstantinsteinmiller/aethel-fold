import { describe, expect, it } from 'vitest'
import { Color, Ray, Triangle, Vector3 } from 'three'
import { CHIBI_BUDGET, buildChibiGeometry } from '@/world/characters/chibiGeometry'
import {
  type CharacterAppearance,
  DEFAULT_APPEARANCE,
  type HairStyle,
  type HeadShape,
  SOCKETS,
  type Sex,
  type SkinTone
} from '@/world/characters/equipment'
import {
  BROW_MIN_CONTRAST,
  HAIRLINE,
  HAIR_COLOURS,
  SKIN_TONES,
  TUNIC_COLOURS,
  browColour,
  crownHeadroom,
  hairMesh,
  headWarp,
  visibleEars,
  warpVertex
} from '@/world/characters/variants'
import { BROW_VERTICES, FACE_VERTICES, HEAD } from '@/world/characters/face'
import { limbMesh } from '@/world/characters/limb'
import { BONE_NAMES, FIGURE_HEIGHT, boneDefinition } from '@/world/characters/rig'
import { triangleCount } from '@/world/geometry/budget'
import de from '@/i18n/locales/de'
import en from '@/i18n/locales/en'
import { LANGUAGES } from '@/utils/enums'

/**
 * ─── The variant contract ───────────────────────────────────────────────────
 *
 * Customisation fails differently from geometry. A single body either works or
 * visibly does not; 240 bodies fail in *one* combination, on a machine that is
 * not yours, and the failure is a hairstyle that turns inside out on a square
 * head. So the shape of this suite is: build every combination, and assert the
 * invariants that hold for all of them.
 *
 * Two of them are not obvious and are the reason this file exists:
 *
 * • **The default must be bit-identical to the figure that shipped.** Not
 *   "close" — identical, because "close" means a repaint or a shifted hairline
 *   that nobody chose and nobody would notice until it was in a build. The
 *   fingerprint below was taken from the geometry *before* `chibiGeometry.ts`
 *   knew what an appearance was.
 * • **The face has to survive the head shape.** It is placed by ray-casting onto
 *   a head `face.ts` rebuilds from its own mirrored spec, so head shape is a
 *   warp applied after the fact — and if it is not applied to the face too, the
 *   eyes end up floating a centimetre off a narrowed jaw.
 */

const SEXES: readonly Sex[] = ['male', 'female']
const HEADS: readonly HeadShape[] = ['round', 'oval', 'square', 'heart']

/**
 * All twenty-one, written out rather than derived.
 *
 * A list derived from the union would be a list that agrees with itself; this one
 * has to be edited when `equipment.ts` is, and forgetting is a `HairStyle` this
 * file never builds. The order is the order `variants.ts` groups them in — the
 * six that shipped, then the fifteen the city needed.
 */
const HAIRS: readonly HairStyle[] = [
  'bowl',
  'short',
  'ponytail',
  'braids',
  'long',
  'bald',
  'topknot',
  'buns',
  'bun',
  'plaits',
  'flowing',
  'queue',
  'bob',
  'tresses',
  'wild',
  'swept',
  'fringe',
  'bearded',
  'mane',
  'coif',
  'receding'
]
const TONES: readonly SkinTone[] = [0, 1, 2, 3, 4]

const appearance = (overrides: Partial<CharacterAppearance> = {}): CharacterAppearance => ({
  ...DEFAULT_APPEARANCE,
  ...overrides
})

/**
 * Every sex × head × hair, with the skin tone rotating through the ramp.
 *
 * The full product is 840 figures and takes the geometric assertions below with
 * it — the outward-winding check alone is O(triangles) per figure. Tone is the
 * one axis that *cannot* interact with any of them: it is a colour swap with no
 * geometry, no second material and no branch, so 840 builds would be 672 rebuilds
 * of an identical mesh. Rotating it instead keeps all five in the sweep (and the
 * colour tests below hit each one explicitly) at 168 figures.
 */
const combinations: CharacterAppearance[] = []
for (const sex of SEXES) {
  for (const head of HEADS) {
    for (const [index, hair] of HAIRS.entries()) {
      combinations.push(appearance({ sex, head, hair, skinTone: TONES[index % TONES.length]! }))
    }
  }
}

const label = (a: CharacterAppearance): string => `${a.sex}/${a.head}/${a.hair}/tone${a.skinTone}`

/**
 * Where each block of vertices lives in the merged geometry: body, **ears**,
 * hair, face.
 *
 * The ranges come from `ChibiGeometry.blocks` rather than from arithmetic, and
 * that is a change this file needed rather than a tidy-up. It used to derive the
 * hair block as "everything between a hairless build's vertex count and
 * `count − FACE_VERTICES`" — which was exact while hair was the only thing
 * between the body and the face, and became a *lie* the moment ears moved off
 * the hairstyle and onto the body: every hair assertion below would have gone on
 * passing while measuring an ear.
 */
const blocksOf = (a: CharacterAppearance) => buildChibiGeometry(undefined, undefined, a)

const built = combinations.map(a => {
  const chibi = buildChibiGeometry(undefined, undefined, a)
  return { a, geometry: chibi.geometry, blocks: chibi.blocks }
})

// ─── Fingerprint ────────────────────────────────────────────────────────────

const fnv = (bytes: Uint8Array): number => {
  let hash = 0x811c9dc5 >>> 0
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

const hashOf = (array: Float32Array | Uint16Array | Uint32Array): number =>
  fnv(new Uint8Array(array.buffer, array.byteOffset, array.byteLength))

/**
 * FNV-1a over the raw bytes of every attribute of `buildChibiGeometry()`.
 *
 * A hash rather than a stored copy of the arrays: 737 vertices is ~140 kB of
 * JSON fixture, and a fixture that large gets regenerated when it fails instead
 * of being read.
 *
 * ── Re-baselined a second time, and this one moved every hash ───────────────
 *
 * The first re-baseline was a *lift*: `MOUTH_SPECS.smile.lift` went 1.5 → 4.5 mm
 * to clear the head’s front-centre vertex column, which was splitting every
 * shipped character’s mouth into two ticks. It moved positions and nothing else,
 * and the fact that every other hash held was the evidence it did only what it
 * claimed.
 *
 * This one is the opposite kind and is stated as such: **the default figure has
 * grown three features**, so the vertex count, the triangle count and all six
 * hashes move together, and none of them can cross-check the others.
 *
 *   * **Hands** (192 tris, 96 a side). The forearm used to end in a 55 mm ball
 *     that the file itself called a mitten; it now ends in a 68 mm wrist with a
 *     palm, a thumb and one finger break on it.
 *   * **Ears** (60). They existed before, but as a *hairstyle’s* geometry, and
 *     `bowl` — the default — was one of the styles that did not draw them. So
 *     the default character had no ears at all. They belong to the body now and
 *     a haircut may only cover them (`EAR_COVER`).
 *   * **Brows** (12), in the character’s hair colour, plus the 10 mm the painted
 *     hairline had to move up to leave room for one (`HAIRLINE`’s floor).
 *
 * The guard is doing its job either way: it exists to catch drift nobody chose,
 * and the way to keep it useful is to write down what *was* chosen. 692 → 956.
 */
const SHIPPED = {
  vertices: 737,
  indices: 2868,
  triangles: 956,
  position: 2507032972,
  normal: 2612394379,
  color: 2314543055,
  skinIndex: 2157463671,
  skinWeight: 3198118101,
  index: 2774058643
} as const

describe('the default appearance is the figure that shipped', () => {
  it('is byte-identical, attribute by attribute', () => {
    const { geometry } = buildChibiGeometry()
    expect(geometry.getAttribute('position').count).toBe(SHIPPED.vertices)
    expect(triangleCount(geometry)).toBe(SHIPPED.triangles)
    for (const name of ['position', 'normal', 'color', 'skinIndex', 'skinWeight'] as const) {
      const array = geometry.getAttribute(name).array as Float32Array | Uint16Array
      expect(hashOf(array), name).toBe(SHIPPED[name])
    }
    const index = geometry.index!.array as Uint32Array
    expect(index.length).toBe(SHIPPED.indices)
    expect(hashOf(index), 'index').toBe(SHIPPED.index)
  })

  it('is what an explicit DEFAULT_APPEARANCE builds', () => {
    const implicit = buildChibiGeometry().geometry
    const explicit = buildChibiGeometry(undefined, undefined, DEFAULT_APPEARANCE).geometry
    for (const name of ['position', 'normal', 'color', 'skinIndex', 'skinWeight'] as const) {
      expect(hashOf(explicit.getAttribute(name).array as Float32Array), name).toBe(
        hashOf(implicit.getAttribute(name).array as Float32Array)
      )
    }
  })

  it('adds no geometry for a painted hairstyle', () => {
    // Five of the twenty-one are the head's own colour ramp slid to a different
    // height. If any ever grows a mesh, the ramp and the mesh both draw a
    // hairline.
    //
    // **Ears are no longer part of this arithmetic**, which is the point of
    // having moved them: four of the five now show a pair because they do not
    // cover them, `coif` covers them because a linen cap tied under the chin
    // does, and none of that is a decision the *style* makes any more.
    //
    // `coif` is in the list and is not simply "the ramp at a height": it is also
    // the only style besides `bald` that moves `HAIR_VOLUME`. That is still zero
    // triangles, because the head volume is a warp of a head that already exists.
    for (const hair of ['bowl', 'short', 'bald', 'coif', 'receding'] as const) {
      const chibi = buildChibiGeometry(undefined, undefined, appearance({ hair }))
      expect(chibi.blocks.face - chibi.blocks.hair, `${hair} hair vertices`).toBe(0)
      expect(triangleCount(chibi.geometry), hair).toBe(SHIPPED.triangles - (hair === 'coif' ? 60 : 0))
    }
  })

  it('builds the same bytes twice, for every style', () => {
    // Determinism is not free here: `hairSpecs` allocates a fresh array of specs
    // per call and `limbMesh` runs a fresh central difference for every ring, so
    // "same input, same bytes" is an assertion about the whole hair path and not
    // just about a cache.
    for (const hair of HAIRS) {
      const a = appearance({ sex: 'female', head: 'heart', hair, skinTone: 3 })
      const first = buildChibiGeometry(undefined, undefined, a).geometry
      const second = buildChibiGeometry(undefined, undefined, a).geometry
      for (const name of ['position', 'normal', 'color', 'skinIndex', 'skinWeight'] as const) {
        expect(hashOf(second.getAttribute(name).array as Float32Array), `${label(a)} ${name}`).toBe(
          hashOf(first.getAttribute(name).array as Float32Array)
        )
      }
    }
  })
})

// ─── Every combination ──────────────────────────────────────────────────────

/**
 * Relative luminance in the space the palette was authored in — the same
 * argument, and the same function, as `characterFace.test.ts`. R4 bans *black*,
 * and black is a statement about the authored value, not about the linear one.
 */
const authoredLuma = (r: number, g: number, b: number): number => {
  const srgb = new Color(r, g, b).convertLinearToSRGB()
  return 0.2126 * srgb.r + 0.7152 * srgb.g + 0.0722 * srgb.b
}

const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _edge1 = new Vector3()
const _edge2 = new Vector3()
const _geoNormal = new Vector3()
const _average = new Vector3()

describe('every sex × head × hair builds', () => {
  it('covers all 168 of them, and all 21 styles', () => {
    expect(built.length).toBe(SEXES.length * HEADS.length * HAIRS.length)
    expect(built.length).toBe(168)
    expect(new Set(HAIRS).size, 'no duplicate style').toBe(21)
    expect(new Set(built.map(b => b.a.skinTone)).size, 'every tone appears').toBe(TONES.length)
  })

  it('stays inside the GDD §4.1 budget', () => {
    for (const { a, geometry } of built) {
      const tris = triangleCount(geometry)
      expect(tris, label(a)).toBeLessThanOrEqual(CHIBI_BUDGET)
      // And is a whole figure, not a body that lost its limbs to a bad index.
      expect(tris, label(a)).toBeGreaterThan(600)
    }
  })

  it('costs what the GDD row says, style by style', () => {
    /**
     * The per-style **hair mesh** cost, in triangles, and separately the ears.
     *
     * Written down because a city of 100+ NPCs turns this table into a *budget*:
     * a style that costs 120 on a tenth of a crowd is 1 200 triangles and a style
     * that costs 60 on half of it is 3 000. It is also the only thing standing
     * between "fifteen more haircuts" and a quiet doubling of the character row.
     *
     * **Ears are out of it now**, and splitting them out is what the table was
     * missing: the old version folded 60 tris of ear into nine of the styles, so
     * `ponytail` read as 120 when its tail is 60, `short` read as 60 when its
     * mesh is nothing at all, and the worst-case style was not the one the number
     * said it was. Ears are a property of the *body* (30 each, on every style
     * that does not cover them), so they belong in the figure's base cost.
     *
     * With that untangled the worst hair mesh is **`wild` and `mane`**, not
     * `ponytail`: 120 and 112 triangles of spikes and volume against a tail of 60.
     */
    const HAIR_COST: Record<HairStyle, number> = {
      bowl: 0,
      short: 0,
      ponytail: 60,
      braids: 80,
      long: 64,
      bald: 0,
      topknot: 60,
      buns: 72,
      bun: 36,
      plaits: 60,
      flowing: 56,
      queue: 40,
      bob: 60,
      tresses: 80,
      wild: 120,
      swept: 40,
      fringe: 36,
      bearded: 36,
      mane: 112,
      coif: 0,
      receding: 0
    }
    /** 30 a side, and which sides is `EAR_COVER`'s call, not the style's. */
    const EAR_COST: Record<HairStyle, number> = {} as Record<HairStyle, number>
    for (const hair of HAIRS) {
      const ears = visibleEars(hair)
      EAR_COST[hair] = ears === 'both' ? 60 : ears === 'right' ? 30 : 0
    }

    const BARE = SHIPPED.triangles - 60
    let worst = 0
    let worstAt: HairStyle = 'bowl'
    for (const hair of HAIRS) {
      const tris = triangleCount(buildChibiGeometry(undefined, undefined, appearance({ hair })).geometry)
      expect(tris - BARE - EAR_COST[hair], hair).toBe(HAIR_COST[hair])
      if (tris > worst) {
        worst = tris
        worstAt = hair
      }
    }
    // The number `CHIBI_BUDGET` was raised to 1060 for. Three styles tie for it:
    // 120 of spikes with no ears (`wild`), or 60 of tail plus 60 of ear
    // (`ponytail`, `topknot`).
    expect(worst, 'worst-case figure').toBe(1016)
    expect(['wild', 'ponytail', 'topknot'], `worst style is ${worstAt}`).toContain(worstAt)
    // The hair-only worst is unchanged and must stay so: `features.ts` added
    // three axes and none of them touched a hairstyle. What the ceiling covers
    // now is the *product* — see the beard row in `characterFeatures.test.ts`,
    // which is where the 1356 worst case is asserted.
    expect(CHIBI_BUDGET - worst, 'headroom above the worst hair-only figure').toBe(364)
  })

  it('emits only finite floats', () => {
    for (const { a, geometry } of built) {
      for (const name of ['position', 'normal', 'color', 'skinWeight'] as const) {
        const array = geometry.getAttribute(name).array as ArrayLike<number>
        let bad = 0
        for (let i = 0; i < array.length; i++) {
          // Positive test: every comparison against NaN is false, so a range
          // check would pass on the exact bug it exists to catch.
          if (!Number.isFinite(array[i]!)) {
            bad++
          }
        }
        expect(bad, `${label(a)} ${name}`).toBe(0)
      }
    }
  })

  it('carries unit-length normals', () => {
    // The head-shape warp transforms normals by the inverse transpose of its
    // Jacobian, which does not preserve length — a missing `normalize()` there
    // would light a warped head as if it were lit through gauze.
    for (const { a, geometry } of built) {
      const normal = geometry.getAttribute('normal')
      let unnormalised = 0
      for (let i = 0; i < normal.count; i++) {
        const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))
        if (!(Math.abs(length - 1) < 2e-3)) {
          unnormalised++
        }
      }
      expect(unnormalised, label(a)).toBe(0)
    }
  })

  it('winds every triangle outward', () => {
    // Measured against the vertex normals, which are authored analytically and
    // therefore known-good. Inward winding is invisible on a closed convex body
    // right up until something depends on facing — and two things do: the
    // `FrontSide` body material and the `BackSide` outline hull.
    for (const { a, geometry } of built) {
      const position = geometry.getAttribute('position')
      const normal = geometry.getAttribute('normal')
      const index = geometry.index!
      let inverted = 0
      let degenerate = 0
      for (let t = 0; t < index.count; t += 3) {
        const ia = index.getX(t)
        const ib = index.getX(t + 1)
        const ic = index.getX(t + 2)
        _a.set(position.getX(ia), position.getY(ia), position.getZ(ia))
        _b.set(position.getX(ib), position.getY(ib), position.getZ(ib))
        _c.set(position.getX(ic), position.getY(ic), position.getZ(ic))
        _geoNormal.crossVectors(_edge1.subVectors(_b, _a), _edge2.subVectors(_c, _a))
        // The pole ring of every spherical cap collapses to a point, so a fifth
        // of the triangles on the figure have zero area by construction and no
        // meaningful facing. Counted rather than ignored.
        if (_geoNormal.lengthSq() < 1e-14) {
          degenerate++
          continue
        }
        _geoNormal.normalize()
        _average
          .set(normal.getX(ia), normal.getY(ia), normal.getZ(ia))
          .add(_b.set(normal.getX(ib), normal.getY(ib), normal.getZ(ib)))
          .add(_c.set(normal.getX(ic), normal.getY(ic), normal.getZ(ic)))
        if (_geoNormal.dot(_average) <= 0) {
          inverted++
        }
      }
      expect(inverted, label(a)).toBe(0)
      expect(degenerate / (index.count / 3), `${label(a)} degenerate share`).toBeLessThan(0.35)
    }
  })

  it('never paints a vertex black (R4)', () => {
    for (const { a, geometry } of built) {
      const color = geometry.getAttribute('color')
      let darkest = 1
      for (let i = 0; i < color.count; i++) {
        darkest = Math.min(darkest, authoredLuma(color.getX(i), color.getY(i), color.getZ(i)))
      }
      expect(darkest, label(a)).toBeGreaterThan(0.02)
    }
  })

  it('gives every vertex weights that sum to one, on bones that exist', () => {
    for (const { a, geometry } of built) {
      const weights = geometry.getAttribute('skinWeight')
      const indices = geometry.getAttribute('skinIndex')
      let wrong = 0
      for (let i = 0; i < weights.count; i++) {
        const sum = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i)
        if (Math.abs(sum - 1) > 1e-4) {
          wrong++
        }
        for (const value of [indices.getX(i), indices.getY(i), indices.getZ(i), indices.getW(i)]) {
          if (!Number.isInteger(value) || value < 0 || value >= BONE_NAMES.length) {
            wrong++
          }
        }
      }
      expect(wrong, label(a)).toBe(0)
    }
  })

  it('stands on the ground and stays three heads tall', () => {
    for (const { a, geometry, blocks } of built) {
      const position = geometry.getAttribute('position')
      let minY = Infinity
      let bodyMax = -Infinity
      let hairMax = -Infinity
      for (let i = 0; i < position.count; i++) {
        minY = Math.min(minY, position.getY(i))
        // Body, then ears, then hair, then the face. The ears are counted with
        // the **body** here, and they have to be: they belong to the head and
        // they are not an allowance a hairstyle may spend.
        if (i < blocks.hair) {
          bodyMax = Math.max(bodyMax, position.getY(i))
        } else if (i < blocks.face) {
          hairMax = Math.max(hairMax, position.getY(i))
        }
      }
      expect(minY, `${label(a)} feet`).toBeGreaterThan(-0.02)
      expect(minY, `${label(a)} feet`).toBeLessThan(0.06)
      // 18 mm, stated: head shape moves the crown and nothing else may. It is
      // 1.2 % of the figure, and the alternative — letting a head shape change
      // the character's height — is a different feature wearing this one's name.
      //
      // Measured on the **body**, which is what "three heads tall" is about. Hair
      // is held separately below, against the skull rather than against
      // `FIGURE_HEIGHT`: `oval` alone already spends 15.6 of the 18 mm, so a hair
      // rule written against the figure would mean something different on each of
      // the four heads.
      expect(bodyMax, `${label(a)} crown`).toBeGreaterThan(FIGURE_HEIGHT - 0.018)
      expect(bodyMax, `${label(a)} crown`).toBeLessThan(FIGURE_HEIGHT + 0.018)
      if (hairMax > -Infinity) {
        expect(hairMax - bodyMax, `${label(a)} hair above the skull`).toBeLessThanOrEqual(crownHeadroom(a.hair))
      }
    }
  })

  it('spends the crown allowance only where it was argued for', () => {
    // The counter-test to the one above: an allowance nobody uses is a rule that
    // has quietly stopped applying. `topknot` exists *because* it goes up, so if
    // it ever stops, the 50 mm it was granted has to go back.
    const rise = (hair: HairStyle): number => {
      const { geometry, blocks } = blocksOf(appearance({ hair }))
      const position = geometry.getAttribute('position')
      let bodyMax = -Infinity
      let hairMax = -Infinity
      for (let i = 0; i < position.count; i++) {
        if (i < blocks.hair) bodyMax = Math.max(bodyMax, position.getY(i))
        else if (i < blocks.face) hairMax = Math.max(hairMax, position.getY(i))
      }
      return hairMax === -Infinity ? 0 : hairMax - bodyMax
    }
    // Up is the one direction nothing else uses, so it has to be worth a pixel.
    expect(rise('topknot'), 'topknot rises').toBeGreaterThan(0.035)
    expect(rise('mane'), 'mane clears the pole').toBeGreaterThan(0.008)
    for (const hair of HAIRS) {
      if (hair === 'topknot' || hair === 'mane') {
        continue
      }
      expect(rise(hair), `${hair} does not raise the crown`).toBeLessThanOrEqual(0)
    }
  })
})

describe('colour choices reach the mesh', () => {
  const paints = (a: CharacterAppearance, target: Color): number => {
    const color = buildChibiGeometry(undefined, undefined, a).geometry.getAttribute('color')
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

  it('paints every skin tone', () => {
    for (let tone = 0; tone < SKIN_TONES.length; tone++) {
      expect(paints(appearance({ skinTone: tone as SkinTone }), SKIN_TONES[tone]!), `tone ${tone}`).toBeGreaterThan(20)
    }
  })

  it('paints every hair and tunic colour', () => {
    for (let i = 0; i < HAIR_COLOURS.length; i++) {
      expect(paints(appearance({ hairColour: i }), HAIR_COLOURS[i]!.base), `hair ${i}`).toBeGreaterThan(20)
    }
    for (let i = 0; i < TUNIC_COLOURS.length; i++) {
      expect(paints(appearance({ tunicColour: i }), TUNIC_COLOURS[i]!.base), `tunic ${i}`).toBeGreaterThan(5)
    }
  })

  it('leaves the boots alone when the hair changes', () => {
    // `hairBase`/`hairDark` are shared with the boots in the palette so the
    // silhouette closes top and bottom. That sharing becomes a bug the instant
    // hair is customisable, and it is the kind that ships.
    const blond = appearance({ hairColour: 2, hair: 'bald' })
    const { geometry } = buildChibiGeometry(undefined, undefined, blond)
    const position = geometry.getAttribute('position')
    const color = geometry.getAttribute('color')
    let boots = 0
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) < 0.12) {
        const luma = authoredLuma(color.getX(i), color.getY(i), color.getZ(i))
        // Boot colours are the darkest authored values on the figure; blond is
        // nowhere near them.
        expect(luma, 'boot vertex').toBeLessThan(0.3)
        boots++
      }
    }
    expect(boots).toBeGreaterThan(20)
  })

  it('does not repaint the default skin', () => {
    // `DEFAULT_APPEARANCE.skinTone` is 1 and the palette's `skinTone1` is a
    // visibly lighter colour than `skinBase`. Stop 1 of the ramp is `skinBase`
    // so the shipped character is unchanged — see the note in `variants.ts`.
    expect(SKIN_TONES[DEFAULT_APPEARANCE.skinTone]!.getHex()).toBe(new Color(0xdbae8a).getHex())
  })
})

// ─── The head shape ─────────────────────────────────────────────────────────

/** The canonical head, built exactly as `chibiGeometry` and `face.ts` build it. */
const canonicalHead = () =>
  limbMesh({
    from: new Vector3(HEAD.centre[0], HEAD.centre[1], HEAD.centre[2]),
    to: new Vector3(HEAD.top[0], HEAD.top[1], HEAD.top[2]),
    radiusStart: HEAD.radius,
    radiusEnd: HEAD.radius,
    radial: HEAD.radial,
    rings: HEAD.rings,
    capRings: HEAD.capRings,
    crossSection: [1, HEAD.widthScale]
  })

/** Signed volume by the divergence theorem. `limbMesh` winds inward, hence abs. */
const meshVolume = (position: Float32Array, index: ArrayLike<number>): number => {
  let sum = 0
  for (let i = 0; i < index.length; i += 3) {
    _a.fromArray(position, index[i]! * 3)
    _b.fromArray(position, index[i + 1]! * 3)
    _c.fromArray(position, index[i + 2]! * 3)
    sum += _a.dot(_edge1.crossVectors(_b, _c))
  }
  return Math.abs(sum) / 6
}

const warpedHead = (a: CharacterAppearance): Float32Array => {
  const head = canonicalHead()
  const warp = headWarp(a)
  const out = new Float32Array(head.position)
  const normal = new Vector3()
  const point = new Vector3()
  for (let i = 0; i < out.length / 3; i++) {
    point.fromArray(out, i * 3)
    normal.fromArray(head.normal, i * 3)
    warpVertex(warp, point, normal)
    point.toArray(out, i * 3)
  }
  return out
}

describe('the head shape', () => {
  const head = canonicalHead()
  const roundVolume = meshVolume(head.position, head.index)

  it('holds the head volume across every shape and hairstyle', () => {
    // A head that changes size changes the *character's* size, and "three heads
    // tall" is the name of the style. ±7 % is what the four shapes need to be
    // distinguishable at 20 m; more than that and they read as three characters
    // of different ages rather than one character with four faces.
    for (const headShape of HEADS) {
      for (const hair of HAIRS) {
        const a = appearance({ head: headShape, hair })
        const ratio = meshVolume(warpedHead(a), head.index) / roundVolume
        expect(ratio, `${headShape}/${hair}`).toBeGreaterThan(0.93)
        expect(ratio, `${headShape}/${hair}`).toBeLessThan(1.07)
      }
    }
  })

  it('actually changes the cross-section, or it is not a lever', () => {
    // The counter-test to the one above: a warp tuned until it preserved volume
    // perfectly would preserve it by doing nothing.
    const widthAt = (a: CharacterAppearance, y: number): number => {
      const position = warpedHead(a)
      let widest = 0
      for (let i = 0; i < position.length / 3; i++) {
        if (Math.abs(position[i * 3 + 1]! - y) < 0.02) {
          widest = Math.max(widest, Math.abs(position[i * 3]!))
        }
      }
      return widest * 2
    }
    const round = widthAt(appearance({ head: 'round' }), 1.3)
    const square = widthAt(appearance({ head: 'square' }), 1.3)
    const oval = widthAt(appearance({ head: 'oval' }), 1.3)
    // 20 mm is about one screen pixel at 20 m on a 0.52 m head, so the spread
    // between the extremes has to be several times that to survive the distance.
    expect(square - round, 'square is broader').toBeGreaterThan(0.02)
    expect(round - oval, 'oval is narrower').toBeGreaterThan(0.02)

    // Heart: temples wide, jaw narrow. Measured as a ratio so it cannot be
    // satisfied by a head that is simply bigger.
    const heart = appearance({ head: 'heart' })
    const heartRatio = widthAt(heart, 1.41) / widthAt(heart, 1.18)
    const roundRatio = widthAt(appearance({ head: 'round' }), 1.41) / widthAt(appearance({ head: 'round' }), 1.18)
    expect(heartRatio / roundRatio, 'heart tapers to the jaw').toBeGreaterThan(1.05)
  })

  it('never inverts', () => {
    // Every scale in the warp must stay positive over the whole height a head,
    // its hair and its face occupy. A profile that crossed zero would turn the
    // skull inside out at one band and shade the rest from the inside.
    for (const headShape of HEADS) {
      for (const hair of HAIRS) {
        const warp = headWarp(appearance({ head: headShape, hair }))
        for (let y = 0.99; y <= 1.6; y += 0.005) {
          const point = new Vector3(0.2, y, 0.2)
          const normal = new Vector3(1, 0, 0)
          warpVertex(warp, point, normal)
          expect(point.x, `${headShape}/${hair} @ ${y.toFixed(2)}`).toBeGreaterThan(0)
          expect(point.z, `${headShape}/${hair} @ ${y.toFixed(2)}`).toBeGreaterThan(0)
          expect(Number.isFinite(normal.x + normal.y + normal.z)).toBe(true)
        }
      }
    }
  })
})

// ─── The face survives it ───────────────────────────────────────────────────

const _closest = new Vector3()
const _triangle = new Triangle()
const _query = new Vector3()

const gapTo = (position: Float32Array, index: ArrayLike<number>, point: Vector3): number => {
  _query.copy(point)
  let best = Infinity
  for (let i = 0; i < index.length; i += 3) {
    _a.fromArray(position, index[i]! * 3)
    _b.fromArray(position, index[i + 1]! * 3)
    _c.fromArray(position, index[i + 2]! * 3)
    _triangle.set(_a, _b, _c)
    _triangle.closestPointToPoint(_query, _closest)
    best = Math.min(best, _closest.distanceTo(_query))
  }
  return best
}

const _ray = new Ray()
const _hit = new Vector3()

/**
 * Is a point **inside** the skull?
 *
 * Distance to a surface is unsigned, and on this figure that is not a detail: a
 * hair strand is deliberately rooted 40–140 mm *inside* the head, so "12 mm from
 * the skull" is two completely different facts depending on which side it is on.
 * One of them is a seam somebody can see and the other is buried geometry nobody
 * will ever look at. An early version of the hairline check below counted the
 * buried ones and failed a style that was correct.
 *
 * Ray-parity rather than a radius comparison, because the skull is a *built*
 * 9-gon whose facets sit up to 15 mm inside the ellipsoid it approximates
 * (`HAT_CLEARANCE` says the same thing about hats), and 15 mm is inside the band
 * the hairline check cares about. The direction is arbitrary but fixed and
 * irrational-ish, so it cannot run along an edge; the cap poles contribute
 * zero-area triangles that the intersection test misses, and the surface stays
 * closed without them.
 */
const insideHead = (position: Float32Array, index: ArrayLike<number>, point: Vector3): boolean => {
  _ray.origin.copy(point)
  _ray.direction.set(0.7213, 0.5341, 0.4405).normalize()
  let crossings = 0
  for (let i = 0; i < index.length; i += 3) {
    _a.fromArray(position, index[i]! * 3)
    _b.fromArray(position, index[i + 1]! * 3)
    _c.fromArray(position, index[i + 2]! * 3)
    if (_ray.intersectTriangle(_a, _b, _c, false, _hit)) {
      crossings++
    }
  }
  return crossings % 2 === 1
}

/** Distance past the skull's surface: positive outside, negative inside. */
const signedGapTo = (position: Float32Array, index: ArrayLike<number>, point: Vector3): number => {
  const distance = gapTo(position, index, point)
  return insideHead(position, index, point) ? -distance : distance
}

describe('the face rides the head shape', () => {
  const head = canonicalHead()

  it('stays on the skull for every shape', () => {
    for (const headShape of HEADS) {
      for (const hair of HAIRS) {
        const a = appearance({ head: headShape, hair })
        const geometry = buildChibiGeometry(undefined, undefined, a).geometry
        const position = geometry.getAttribute('position')
        const surface = warpedHead(a)
        let minGap = Infinity
        let maxGap = -Infinity
        for (let i = position.count - FACE_VERTICES; i < position.count; i++) {
          const gap = gapTo(surface, head.index, _a.set(position.getX(i), position.getY(i), position.getZ(i)))
          minGap = Math.min(minGap, gap)
          maxGap = Math.max(maxGap, gap)
        }
        // Proud of the skull by enough to never z-fight, close enough never to
        // read as a decal hovering. The upper bound is the warped eye dome plus
        // its catchlight: the warp scales the lift by up to 1.19 on `square`.
        expect(minGap, `${headShape}/${hair} closest`).toBeGreaterThan(0.001)
        expect(maxGap, `${headShape}/${hair} furthest`).toBeLessThan(0.008)
      }
    }
  })

  it('keeps every feature in skin, below the hairline', () => {
    for (const hair of HAIRS) {
      for (const headShape of HEADS) {
        const a = appearance({ head: headShape, hair })
        const warp = headWarp(a)
        const geometry = buildChibiGeometry(undefined, undefined, a).geometry
        const position = geometry.getAttribute('position')
        // The colour ramp is keyed to the *pre-warp* height, so the hairline
        // lands at the warped image of `hairlineY` — **plus the style's own
        // offset**, which is the whole point of `HAIRLINE` and which this
        // assertion used to leave out. With fifteen more styles, six of which
        // slide the line down onto the brow, "the default line is clear of the
        // eyes" stopped being the question worth asking.
        const line = warp.centreY + (HEAD.hairlineY + HAIRLINE[hair] * 0.02 - warp.centreY) * warp.height
        let highest = -Infinity
        for (let i = position.count - FACE_VERTICES; i < position.count; i++) {
          highest = Math.max(highest, position.getY(i))
        }
        // 5 mm. The floor is `long`'s shipped −0.25, which every low-hairline
        // style shares, and on `square` (height 0.94) it leaves 7.5 mm between
        // the line and the top of the eye dome. Anything lower paints hair onto
        // an eyelid.
        expect(line - highest, `${headShape}/${hair}`).toBeGreaterThan(0.005)
      }
    }
  })

  it('is still left-right symmetric after the warp', () => {
    for (const headShape of HEADS) {
      const geometry = buildChibiGeometry(undefined, undefined, appearance({ head: headShape })).geometry
      const position = geometry.getAttribute('position')
      let sumX = 0
      for (let i = position.count - FACE_VERTICES; i < position.count; i++) {
        sumX += position.getX(i)
      }
      expect(Math.abs(sumX), headShape).toBeLessThan(1e-4)
    }
  })
})

// ─── Hair ───────────────────────────────────────────────────────────────────

describe('hair', () => {
  const head = canonicalHead()

  /**
   * How far past the skull's own surface each hair vertex reaches.
   *
   * Measured on the *hair block of the built geometry* rather than on
   * `hairMesh` alone, so it also proves the append in `chibiGeometry` fires and
   * carries the warp — an empty append would otherwise pass every colour test in
   * this file.
   */
  const outsideTheSkull = (a: CharacterAppearance) => {
    const { geometry, blocks } = blocksOf(a)
    const position = geometry.getAttribute('position')
    const surface = warpedHead(a)
    const start = blocks.hair
    const end = blocks.face
    let behind = 0
    let leftOf = 0
    let rightOf = 0
    let furthest = 0
    let vertices = 0
    for (let i = start; i < end; i++) {
      vertices++
      const gap = signedGapTo(surface, head.index, _query.set(position.getX(i), position.getY(i), position.getZ(i)))
      furthest = Math.max(furthest, gap)
      // Only points genuinely clear of the skull count toward a silhouette — a
      // vertex 2 mm proud of it changes no outline anyone can see, and a buried
      // one changes none at all.
      if (gap < 0.015) {
        continue
      }
      // Which side of the head, for a point already known to be outside it. The
      // thresholds used to be ±0.25 / −0.26, which is the *round* skull's own
      // half-extent — so they silently stopped classifying anything once a head
      // shape narrowed the skull under them: on `oval` the braids' widest vertex
      // lands at 0.247 and counted as neither side. Being outside the skull is
      // what makes a vertex a silhouette; these only have to say which way.
      if (position.getZ(i) < -0.18) behind++
      if (position.getX(i) > 0.12) leftOf++
      if (position.getX(i) < -0.12) rightOf++
    }
    return { behind, leftOf, rightOf, furthest, vertices }
  }

  it('reaches the shipped geometry at all', () => {
    for (const hair of HAIRS) {
      const a = appearance({ hair })
      const mesh = hairMesh(a)
      const { vertices } = outsideTheSkull(a)
      expect(vertices, hair).toBe(mesh ? mesh.position.length / 3 : 0)
    }
  })

  /**
   * Which direction each modelled style breaks the head's convex outline, and
   * how far past the skull it has to get to count.
   *
   * **This is the whole contract of a hairstyle in this project.** A style that
   * does not leave the skull's own silhouette is 60–120 triangles of nothing and
   * should be a colour ramp instead — that is what `bowl`, `short`, `bald`,
   * `coif` and `receding` are, and they are checked separately for carrying no
   * mesh at all. Everything modelled has to earn it, in a direction stated here
   * rather than inferred from whatever the numbers happen to do.
   *
   * `reach` is metres past the skull surface, on the worst of the four head
   * shapes. 40 mm is two pixels at 20 m, which is the floor for "a silhouette
   * somebody can see"; the actual measured values are two to ten times that
   * except where noted.
   */
  const BREAKS: Partial<Record<HairStyle, { reach: number; behind?: number; left?: number; right?: number }>> = {
    ponytail: { reach: 0.06, behind: 4 },
    braids: { reach: 0.05, left: 2, right: 2 },
    long: { reach: 0.03 },
    // Up. Its rise above the crown is asserted separately — that is the part
    // nothing else does.
    topknot: { reach: 0.06 },
    buns: { reach: 0.06, left: 2, right: 2 },
    bun: { reach: 0.06, behind: 2 },
    plaits: { reach: 0.15, left: 2, right: 2 },
    flowing: { reach: 0.3 },
    queue: { reach: 0.25 },
    bob: { reach: 0.08, left: 2, right: 2 },
    tresses: { reach: 0.15 },
    wild: { reach: 0.08 },
    // One side only: +X carries the lobe, −X carries nothing but an ear.
    swept: { reach: 0.08, left: 2 },
    fringe: { reach: 0.06 },
    bearded: { reach: 0.1 },
    mane: { reach: 0.1, left: 2, right: 2 }
  }

  it('breaks the outline where the style says it does', () => {
    for (const [hair, wanted] of Object.entries(BREAKS) as [HairStyle, { reach: number; behind?: number; left?: number; right?: number }][]) {
      // Worst of the four head shapes: a style that reads on `round` and vanishes
      // inside `square`'s 28 mm of extra width is a style that fails on a quarter
      // of the crowd.
      let furthest = Infinity
      let behind = Infinity
      let leftOf = Infinity
      let rightOf = Infinity
      for (const headShape of HEADS) {
        const measured = outsideTheSkull(appearance({ hair, head: headShape }))
        furthest = Math.min(furthest, measured.furthest)
        behind = Math.min(behind, measured.behind)
        leftOf = Math.min(leftOf, measured.leftOf)
        rightOf = Math.min(rightOf, measured.rightOf)
      }
      expect(furthest, `${hair} reach`).toBeGreaterThan(wanted.reach)
      if (wanted.behind !== undefined) expect(behind, `${hair} behind the head`).toBeGreaterThanOrEqual(wanted.behind)
      if (wanted.left !== undefined) expect(leftOf, `${hair} on +X`).toBeGreaterThanOrEqual(wanted.left)
      if (wanted.right !== undefined) expect(rightOf, `${hair} on −X`).toBeGreaterThanOrEqual(wanted.right)
    }
  })

  it('leaves the painted styles unmodelled', () => {
    // At 20 m a 10 mm shell over the skull is half a pixel. All five carry **no
    // hair mesh at all** now — the ears they used to carry were never hair, and
    // conflating the two is what let three of these styles look "modelled".
    for (const hair of ['bowl', 'short', 'bald', 'coif', 'receding'] as const) {
      expect(outsideTheSkull(appearance({ hair })).vertices, hair).toBe(0)
    }
  })

  it('shows ears on exactly the styles that do not cover them', () => {
    /**
     * Written out rather than read from `variants.ts`, because a table checked
     * against itself proves nothing. This is the *intent*, and it is now stated
     * the way round the feature is built: **a character has ears**, and a
     * hairstyle with mass at the temples covers them. Eleven do. `swept` covers
     * one, which is half of what makes it asymmetric.
     *
     * `bowl` is the entry that changed, and it changed the default character.
     * Its painted hairline sits at the head's equator and the ear's highest
     * vertex is 0.8 mm below it, so the hair does not reach the ear — listing it
     * as covered was the old opt-*in* table's default showing through.
     */
    const EXPECTED: Record<HairStyle, 'both' | 'right' | 'none'> = {
      bowl: 'both',
      short: 'both',
      ponytail: 'both',
      braids: 'none',
      long: 'none',
      bald: 'both',
      topknot: 'both',
      buns: 'none',
      bun: 'both',
      plaits: 'none',
      flowing: 'none',
      queue: 'both',
      bob: 'none',
      tresses: 'none',
      wild: 'none',
      swept: 'right',
      fringe: 'both',
      bearded: 'both',
      mane: 'none',
      receding: 'both',
      coif: 'none'
    }
    // Found in the **ear block**, and cross-checked by colour: an ear is the
    // only geometry outside the body block painted in skin. A count alone cannot
    // tell a left ear from a right one, and `swept` is the style where that is
    // the entire point.
    for (const hair of HAIRS) {
      const a = appearance({ hair })
      const { geometry, blocks } = blocksOf(a)
      const position = geometry.getAttribute('position')
      const color = geometry.getAttribute('color')
      const skin = SKIN_TONES[a.skinTone]!
      let left = 0
      let right = 0
      for (let i = blocks.ears; i < blocks.hair; i++) {
        const isSkin =
          Math.abs(color.getX(i) - skin.r) < 1e-5 && Math.abs(color.getY(i) - skin.g) < 1e-5 && Math.abs(color.getZ(i) - skin.b) < 1e-5
        expect(isSkin, `${hair}: ear vertex ${i} is not skin`).toBe(true)
        if (position.getX(i) > 0.05) left++
        if (position.getX(i) < -0.05) right++
      }
      // 24 vertices an ear, and nothing else may be in this block.
      expect(blocks.hair - blocks.ears, `${hair} ear vertices`).toBe(
        EXPECTED[hair] === 'both' ? 48 : EXPECTED[hair] === 'right' ? 24 : 0
      )
      const seen = left > 0 && right > 0 ? 'both' : right > 0 ? 'right' : left > 0 ? 'left' : 'none'
      expect(seen, hair).toBe(EXPECTED[hair])
      expect(seen, `${hair} matches variants.ts`).toBe(visibleEars(hair))
    }
  })

  it('does not draw a second hairline', () => {
    /**
     * A strand root must be the same value the skull is painted above the line.
     * Two hairlines a few centimetres apart is the failure this prevents, and it
     * is invisible in code and glaring on screen — a previous ponytail shipped
     * with one and it was only caught in a browser.
     *
     * The criterion is **a band, not a height**. It used to be "every hair vertex
     * above y = 1.32", which worked while every style hung *downward* against the
     * skull and stops working the moment one goes up: `topknot`'s tip is 250 mm
     * clear of the head at y = 1.60 and is `hairDark` on purpose, because a knot
     * is in its own shadow. What actually draws a false line is geometry **lying
     * against** the skull — 0.5 to 22 mm outside it — above the painted hairline,
     * in a colour the skull there is not. So that is what is measured, per style
     * and per hair colour, and the styles are placed so that nothing but a root
     * ever lands in the band (`bun` sits on the nape and `fringe` juts 25 mm
     * further than it first did for exactly this reason).
     */
    for (const hair of HAIRS) {
      for (let colour = 0; colour < HAIR_COLOURS.length; colour++) {
        const a = appearance({ hair, hairColour: colour })
        const warp = headWarp(a)
        const { geometry, blocks } = blocksOf(a)
        const position = geometry.getAttribute('position')
        const color = geometry.getAttribute('color')
        const surface = warpedHead(a)
        const base = HAIR_COLOURS[colour]!.base
        const start = blocks.hair
        const end = blocks.face
        const line = warp.centreY + (HEAD.hairlineY + HAIRLINE[hair] * 0.02 - warp.centreY) * warp.height
        for (let i = start; i < end; i++) {
          if (position.getY(i) <= line) {
            continue
          }
          const gap = signedGapTo(surface, head.index, _query.set(position.getX(i), position.getY(i), position.getZ(i)))
          if (gap < 0.0005 || gap > 0.022) {
            continue
          }
          const distance = Math.hypot(color.getX(i) - base.r, color.getY(i) - base.g, color.getZ(i) - base.b)
          expect(distance, `${hair}/${colour} at y=${position.getY(i).toFixed(3)}, gap ${(gap * 1000).toFixed(1)} mm`).toBeLessThan(1e-5)
        }
      }
    }
  })

  it('still checks the styles the rule was written for', () => {
    // The band criterion above is only worth anything if the styles it was
    // written for actually put vertices in the band. They do, and this is what
    // stops a future style from passing by floating clear of the head entirely.
    for (const hair of ['ponytail', 'long', 'mane'] as const) {
      const a = appearance({ hair })
      const warp = headWarp(a)
      const { geometry, blocks } = blocksOf(a)
      const position = geometry.getAttribute('position')
      const surface = warpedHead(a)
      const start = blocks.hair
      const end = blocks.face
      const line = warp.centreY + (HEAD.hairlineY + HAIRLINE[hair] * 0.02 - warp.centreY) * warp.height
      let inBand = 0
      for (let i = start; i < end; i++) {
        if (position.getY(i) <= line) continue
        const gap = signedGapTo(surface, head.index, _query.set(position.getX(i), position.getY(i), position.getZ(i)))
        if (gap > 0.0005 && gap < 0.022) inBand++
      }
      expect(inBand, `${hair} meets the skull above the line`).toBeGreaterThan(0)
    }
  })

  it('never puts hair on a face', () => {
    /**
     * The failure the fringe, the swept lobe and the beard are all one bad number
     * away from: a mass that overhangs the brow by 5 mm too much covers an eye,
     * and a beard 20 mm too high swallows the mouth. Both look like a modelling
     * choice rather than a bug, on a face that is 38 triangles wide.
     *
     * 30 mm is the bar. The eyes are 84 mm apart and the mouth is 48 mm wide, so
     * anything closer than that is inside a feature rather than beside it. The
     * measured worst case is `mane` at 56 mm, and the three styles that reach for
     * the face — `fringe` 60, `bearded` 59, `swept` 83 — all clear it.
     */
    for (const hair of HAIRS) {
      for (const headShape of HEADS) {
        const a = appearance({ hair, head: headShape })
        const { geometry, blocks } = blocksOf(a)
        const position = geometry.getAttribute('position')
        const start = blocks.hair
        const end = blocks.face
        let closest = Infinity
        for (let i = start; i < end; i++) {
          for (let f = blocks.face; f < position.count - BROW_VERTICES; f++) {
            closest = Math.min(
              closest,
              Math.hypot(position.getX(f) - position.getX(i), position.getY(f) - position.getY(i), position.getZ(f) - position.getZ(i))
            )
          }
        }
        if (closest < Infinity) {
          expect(closest, `${headShape}/${hair}`).toBeGreaterThan(0.03)
        }
      }
    }
  })

  it('binds hair the way the skull is bound, not rigidly to the head', () => {
    // Weight 1 on `head` is what a strand obviously wants and it is wrong for
    // the same reason it was wrong for the face: the skull it overlaps is ramped
    // toward `neck`, so the two slide apart the moment the head turns and the
    // cranium erupts through the back of its own hair — 44 mm at 25° of yaw,
    // measured.
    //
    // Checked on every style that has geometry below the hairline, not just on
    // `long`. The styles that hang furthest — `flowing` and `queue` reach the
    // waist, `bearded` and `tresses` the collarbone — are the ones with the
    // longest lever on that error, and they were all added after the rule was.
    const headBone = BONE_NAMES.indexOf('head')
    const neckBone = BONE_NAMES.indexOf('neck')
    let styles = 0
    for (const hair of HAIRS) {
      const { geometry, blocks } = blocksOf(appearance({ hair }))
      const position = geometry.getAttribute('position')
      const weights = geometry.getAttribute('skinWeight')
      const indices = geometry.getAttribute('skinIndex')
      const start = blocks.hair
      const end = blocks.face
      let blended = 0
      let below = 0
      for (let i = start; i < end; i++) {
        // Below the hairline, where the mass overlaps the skull it must not part
        // company with.
        if (position.getY(i) > 1.28) {
          continue
        }
        below++
        if (indices.getX(i) === headBone && indices.getY(i) === neckBone && weights.getY(i) > 0.4) {
          blended++
        }
      }
      if (below === 0) {
        continue
      }
      styles++
      expect(blended, `${hair}: hair vertices sharing the skull blend`).toBe(below)
    }
    expect(styles, 'styles with hair below the hairline').toBeGreaterThan(10)
  })
})

// ─── Ears ───────────────────────────────────────────────────────────────────

describe('ears', () => {
  const head = canonicalHead()

  it('binds to the skull, warps with it, and stands proud of it', () => {
    // Everything glued to the head has to satisfy the same three things, and
    // each has been paid for separately on this figure: the **warp** (or an ear
    // floats beside a narrowed skull), the **skull's own weights** at its height
    // (weight 1 on `head` measured 49.6 mm of slide on the face and 44 mm on
    // hair), and enough **reach** past the skull to be a silhouette at all.
    const headBone = BONE_NAMES.indexOf('head')
    const neckBone = BONE_NAMES.indexOf('neck')
    for (const headShape of HEADS) {
      const a = appearance({ head: headShape })
      const { geometry, blocks } = blocksOf(a)
      const position = geometry.getAttribute('position')
      const indices = geometry.getAttribute('skinIndex')
      const weights = geometry.getAttribute('skinWeight')
      const surface = warpedHead(a)
      expect(blocks.hair - blocks.ears, `${headShape} ear vertices`).toBe(48)

      let furthest = 0
      let blended = 0
      for (let i = blocks.ears; i < blocks.hair; i++) {
        furthest = Math.max(
          furthest,
          signedGapTo(surface, head.index, _query.set(position.getX(i), position.getY(i), position.getZ(i)))
        )
        if (indices.getX(i) === headBone && indices.getY(i) === neckBone && weights.getY(i) > 0.4) {
          blended++
        }
      }
      // 30 mm proud on the round head; the warp scales it with the skull, so the
      // floor is stated against the narrowest of the four rather than the widest.
      expect(furthest, `${headShape} ear reach`).toBeGreaterThan(0.02)
      // Every ear vertex sits below the hairline, so every one of them is inside
      // the skull's ramp toward the neck.
      expect(blended, `${headShape} ears sharing the skull blend`).toBe(48)
    }
  })

  it('is a mirrored pair wherever both are shown', () => {
    const { geometry, blocks } = blocksOf(appearance())
    const position = geometry.getAttribute('position')
    let sumX = 0
    for (let i = blocks.ears; i < blocks.hair; i++) {
      sumX += position.getX(i)
    }
    expect(Math.abs(sumX), 'ears sum to zero in x').toBeLessThan(1e-6)
  })
})

// ─── Hands ──────────────────────────────────────────────────────────────────

describe('hands', () => {
  /** Everything on the arm below the elbow, on the character's left. */
  const leftHand = (a: CharacterAppearance) => {
    const { geometry, blocks } = blocksOf(a)
    const position = geometry.getAttribute('position')
    const points: Vector3[] = []
    for (let i = 0; i < blocks.ears; i++) {
      if (position.getX(i) > 0.2 && position.getY(i) < 0.72) {
        points.push(new Vector3(position.getX(i), position.getY(i), position.getZ(i)))
      }
    }
    return points
  }

  it('puts a wrist narrower than the palm on the end of the forearm', () => {
    // The cue that says "there is a hand here" before any finger resolves, and
    // the one the old fattened end cap could not give: it was 110 mm across
    // against a 100 mm forearm, so the arm simply thickened and stopped.
    const points = leftHand(appearance())
    const wrist = boneDefinition('hand.L').head
    const spanAt = (y: number, band: number): number => {
      let low = Infinity
      let high = -Infinity
      for (const p of points) {
        if (Math.abs(p.y - y) > band) continue
        low = Math.min(low, p.z)
        high = Math.max(high, p.z)
      }
      return high - low
    }
    // 20 mm above the hand joint is forearm; 40 mm below it is palm.
    const forearm = spanAt(wrist[1] + 0.02, 0.008)
    const palm = spanAt(wrist[1] - 0.04, 0.008)
    expect(forearm, 'wrist width').toBeGreaterThan(0.03)
    expect(palm / forearm, 'palm wider than the wrist').toBeGreaterThan(1.15)
  })

  it('stands a thumb clear of the palm, forward, on both hands', () => {
    // +Z on both sides, because a hanging hand's palm faces the thigh — so the
    // thumb points forward and the little finger back. Getting this mirrored
    // would put one thumb behind the character, symmetrically enough to look
    // deliberate.
    const { geometry, blocks } = blocksOf(appearance())
    const position = geometry.getAttribute('position')
    let leftFront = -Infinity
    let rightFront = -Infinity
    for (let i = 0; i < blocks.ears; i++) {
      if (position.getY(i) > 0.72) continue
      if (position.getX(i) > 0.2) leftFront = Math.max(leftFront, position.getZ(i))
      if (position.getX(i) < -0.2) rightFront = Math.max(rightFront, position.getZ(i))
    }
    expect(leftFront, 'left thumb reaches forward').toBeGreaterThan(0.06)
    expect(leftFront, 'thumbs mirror').toBeCloseTo(rightFront, 6)
  })

  it('contains the grip socket, so a hilt passes through the fist', () => {
    // `SOCKETS.handR/handL` put a held item's grip 20 mm below and 30 mm in
    // front of the hand bone. If the palm sits beside that point rather than
    // around it, every sword in the game is held in mid-air next to a hand.
    const points = leftHand(appearance())
    const wrist = boneDefinition('hand.L').head
    const socket = new Vector3(wrist[0] + SOCKETS.handL.position[0], wrist[1] + SOCKETS.handL.position[1], wrist[2] + SOCKETS.handL.position[2])
    let nearest = Infinity
    for (const p of points) {
      nearest = Math.min(nearest, p.distanceTo(socket))
    }
    // Enclosed, not touched: the nearest surface vertex is **9.1 mm** away,
    // which on a palm 85 mm across and 46 mm thick puts the socket well inside
    // it, in every direction, which is what the four counts below say directly.
    expect(nearest, 'nearest hand vertex to the grip').toBeGreaterThan(0.008)
    let below = 0
    let above = 0
    let front = 0
    let back = 0
    for (const p of points) {
      if (p.y < socket.y) below++
      else above++
      if (p.z > socket.z) front++
      else back++
    }
    for (const [side, count] of [
      ['below', below],
      ['above', above],
      ['in front of', front],
      ['behind', back]
    ] as const) {
      expect(count, `hand vertices ${side} the grip`).toBeGreaterThan(5)
    }
  })

  it('does not reach further outboard than the mitten it replaced', () => {
    // The sheathed sword's hip socket was searched against a body with a 55 mm
    // ball on the end of each arm, and it settled on 8.3 mm of clearance. A
    // wider hand would eat that, silently, in a file this one does not own.
    const points = leftHand(appearance())
    const wrist = boneDefinition('hand.L').head
    let outermost = -Infinity
    for (const p of points) {
      outermost = Math.max(outermost, p.x)
    }
    expect(outermost - wrist[0], 'hand past the wrist joint, outboard').toBeLessThan(0.055)
  })

  it('is rigid to the hand bone at the fingers and blended at the wrist', () => {
    // The fingers start 40 mm out along the hand and there are no finger bones,
    // so they are weight 1 on `hand`. The ordinary part rule would have given
    // their roots a 50/50 split with the *forearm*, and a fingertip that follows
    // the wrist half way through every wrist turn is a hand that folds.
    const { geometry, blocks } = blocksOf(appearance())
    const position = geometry.getAttribute('position')
    const indices = geometry.getAttribute('skinIndex')
    const weights = geometry.getAttribute('skinWeight')
    const handBone = BONE_NAMES.indexOf('hand.L')
    const forearmBone = BONE_NAMES.indexOf('forearm.L')
    let rigid = 0
    let blended = 0
    for (let i = 0; i < blocks.ears; i++) {
      if (indices.getX(i) !== handBone) continue
      if (weights.getX(i) > 0.999) rigid++
      else if (indices.getY(i) === forearmBone && weights.getY(i) > 0.05) blended++
    }
    expect(rigid, 'fingers rigid to the hand').toBeGreaterThan(40)
    expect(blended, 'palm blended toward the forearm').toBeGreaterThan(10)
  })
})

// ─── Eyebrows ───────────────────────────────────────────────────────────────

describe('the brow colour', () => {
  const luma = (colour: Color): number => {
    const srgb = colour.clone().convertLinearToSRGB()
    return 0.2126 * srgb.r + 0.7152 * srgb.g + 0.0722 * srgb.b
  }

  it('clears the skin under it on every hair × skin pair', () => {
    /**
     * ── The palette's stated fear, and the one that is actually true ─────────
     *
     * `palette.ts` kept `faceLine` fixed because "a brow tinted to match blond
     * hair disappears into the skin". Measured over the whole 5 × 5 product that
     * is the wrong pair: blond on the palest skin separates by 0.20–0.24 of
     * authored luma before any darkening, three times what the *shipped mouth*
     * manages on the darkest skin (0.060).
     *
     * What actually collides is **light hair on mid or dark skin** — at the hair
     * ramp's own dark stop, `rockShadow` on `skinTone3` separates by 0.009 and
     * `strawBase` on `skinTone2` by 0.015. Those are invisible, which is why
     * `browColour` guarantees the separation rather than hoping for it.
     */
    let worst = Infinity
    let where = ''
    for (let hair = 0; hair < HAIR_COLOURS.length; hair++) {
      for (const tone of TONES) {
        const brow = browColour(appearance({ hairColour: hair, skinTone: tone }))
        const separation = Math.abs(luma(brow) - luma(SKIN_TONES[tone]!))
        if (separation < worst) {
          worst = separation
          where = `hair ${hair} on tone ${tone}`
        }
        // R4: never black, and the floor is checked on the *authored* value for
        // the reason every other R4 assertion in this repo is.
        expect(luma(brow), `hair ${hair} tone ${tone} is not ink`).toBeGreaterThan(0.02)
      }
    }
    expect(worst, `worst brow contrast at ${where}`).toBeGreaterThanOrEqual(BROW_MIN_CONTRAST - 1e-6)
  })

  it('is the hair colour where it can be, not a fixed neutral', () => {
    // The other half: a guarantee met by painting every brow the same dark brown
    // would pass the test above and defeat the feature. The five hair colours
    // have to produce five visibly different brows on the default skin.
    const brows = HAIR_COLOURS.map((_, i) => browColour(appearance({ hairColour: i })))
    const lumas = brows.map(luma).sort((a, b) => a - b)
    expect(lumas[lumas.length - 1]! - lumas[0]!, 'spread across the hair ramp').toBeGreaterThan(0.25)
    for (let i = 1; i < lumas.length; i++) {
      expect(lumas[i]! - lumas[i - 1]!, 'adjacent brows differ').toBeGreaterThan(0.01)
    }
    // And it is *hair*, not the mouth's neutral: the hue follows the ramp.
    //
    // Checked only where hue means something. Stop 3 is `rockShadow`, a grey at
    // 4 % saturation, and hue on a near-neutral is numerically wild — the 5 %
    // pull toward `shadowTint` that `deriveDark` applies swings it half the
    // wheel while moving the colour by nothing anybody can see.
    for (let i = 0; i < HAIR_COLOURS.length; i++) {
      const hairHsl = new Color().copy(HAIR_COLOURS[i]!.base).getHSL({ h: 0, s: 0, l: 0 })
      if (hairHsl.s < 0.1) continue
      const browHsl = brows[i]!.getHSL({ h: 0, s: 0, l: 0 })
      expect(Math.abs(browHsl.h - hairHsl.h), `hair ${i} hue`).toBeLessThan(0.02)
      expect(browHsl.s, `hair ${i} keeps its chroma`).toBeGreaterThan(0.1)
    }
  })

  it('reaches the figure, in the face block, under the eyes', () => {
    for (let hair = 0; hair < HAIR_COLOURS.length; hair++) {
      const a = appearance({ hairColour: hair })
      const { geometry, blocks } = blocksOf(a)
      const color = geometry.getAttribute('color')
      const position = geometry.getAttribute('position')
      const target = browColour(a)
      let painted = 0
      for (let i = blocks.face; i < position.count; i++) {
        if (
          Math.abs(color.getX(i) - target.r) < 1e-5 &&
          Math.abs(color.getY(i) - target.g) < 1e-5 &&
          Math.abs(color.getZ(i) - target.b) < 1e-5
        ) {
          painted++
        }
      }
      expect(painted, `hair ${hair} brow vertices`).toBe(BROW_VERTICES)
    }
  })
})

// ─── The names a player reads ───────────────────────────────────────────────

/**
 * Every style needs a label in every language, and there is no type that says so.
 *
 * A missing key does not throw, does not warn in production and does not fail a
 * type-check: it ships as the literal string `characters.hairStyles.topknot` in
 * the middle of somebody's character-creation screen, in their language, and the
 * only way to find it is to switch to that language and look. It is asserted
 * here as well as in `characterCreator.test.ts` — that file checks the *picker's*
 * list against English, and the picker's list is derived from a `Record`
 * somewhere else, which is exactly the sort of indirection that lets a style go
 * unlabelled in every language while every test stays green.
 *
 * ── Two languages, and the count is derived rather than written down ────────
 *
 * The game shipped 21 locales as a tower-defence game and ships **English and
 * German** now; the other 19 bundles were deleted. This block used to name
 * all 21 and assert `toHaveLength(21)`, and when they were deleted the file
 * stopped *collecting* — 1400 lines of geometry assertions that have nothing to
 * do with i18n went dark because of an import at the top.
 *
 * So the roster is now checked against `LANGUAGES` (`utils/enums.ts`), the list
 * the language picker itself is built from. Adding a language fails this test
 * with "missing a bundle" instead of shipping an unlabelled picker, and removing
 * one cannot break the file again.
 */
const BUNDLES: Record<string, unknown> = { de, en }

const hairStyleLabels = (bundle: unknown): Record<string, unknown> => {
  const characters = (bundle as { characters?: { hairStyles?: Record<string, unknown> } }).characters
  return characters?.hairStyles ?? {}
}

describe('hair style labels', () => {
  it('has a bundle for every language the picker offers', () => {
    for (const language of LANGUAGES) {
      expect(BUNDLES[language], `${language} is offered but missing a bundle`).toBeDefined()
    }
    expect(Object.keys(BUNDLES).sort()).toEqual([...LANGUAGES].sort())
  })

  it('names every style in every language', () => {
    for (const [locale, bundle] of Object.entries(BUNDLES)) {
      const labels = hairStyleLabels(bundle)
      for (const hair of HAIRS) {
        const value = labels[hair]
        expect(typeof value, `${locale}.characters.hairStyles.${hair}`).toBe('string')
        expect((value as string).length, `${locale}.characters.hairStyles.${hair} is empty`).toBeGreaterThan(0)
      }
    }
  })

  it('carries no label for a style that no longer exists', () => {
    // The other half of the same bug. A stale key is a translation somebody paid
    // for that nothing renders, and it hides the fact that a style was removed.
    for (const [locale, bundle] of Object.entries(BUNDLES)) {
      expect(Object.keys(hairStyleLabels(bundle)).sort(), locale).toEqual([...HAIRS].sort())
    }
  })

  it('does not leave a language reading English', () => {
    // Twenty-one bundles is enough that "translated" quietly becomes "copied".
    // Not every language has to differ from English on every word — `id` and `nl`
    // legitimately share a few — but a whole bundle that matches English is a
    // bundle nobody translated.
    const english = hairStyleLabels(en)
    for (const [locale, bundle] of Object.entries(BUNDLES)) {
      if (locale === 'en') {
        continue
      }
      const labels = hairStyleLabels(bundle)
      const same = HAIRS.filter(hair => labels[hair] === english[hair]).length
      expect(same, `${locale} copied English`).toBeLessThan(HAIRS.length)
    }
  })
})
