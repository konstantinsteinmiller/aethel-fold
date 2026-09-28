import { Color, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { CHIBI_BUDGET, buildChibiGeometry } from '@/world/characters/chibiGeometry'
import {
  BEARD_STYLE_OPTIONS,
  BROW_STYLE_OPTIONS,
  NOSE_STYLE_OPTIONS,
  copyAppearance,
  randomAppearance,
  sanitiseAppearance
} from '@/world/characters/CreatorScene'
import {
  DEFAULT_APPEARANCE,
  type BeardStyle,
  type CharacterAppearance,
  type HairStyle,
  type ItemKind,
  type NoseStyle
} from '@/world/characters/equipment'
import { BEARD_STYLES, BROW_STYLES, hasMoustache, NOSE_STYLES } from '@/world/characters/features'
import { FACE_VERTICES, HEAD } from '@/world/characters/face'
import { gearModel } from '@/world/characters/gear'
import { NPC_BEARDS, NPC_HAIR, NPC_NOSES, PROFESSION_IDS, professionAppearance } from '@/world/characters/professions'
import { boneDefinition } from '@/world/characters/rig'
import { BROW_MIN_CONTRAST, SKIN_TONES, beardStops } from '@/world/characters/variants'

/**
 * ─── The beard, the brow ridge and the nose ─────────────────────────────────
 *
 * `features.ts` is the first thing on this figure that is a *volume* rather than
 * a decal, and everything that can go wrong with it is geometric: a mass buried
 * in the skull, a mass floating off it, a mass inside the character's own coat,
 * a mass sitting on top of the mouth. Every one of those renders as something
 * plausible and wrong, and none of them throws.
 *
 * What this file cannot check is whether any of it *looks* right — a beard that
 * reads as a bib and a nose that reads as a wart both pass every assertion here.
 * That is `src/world/characters/faces.html`'s job, and the reason it exists.
 */

const build = (patch: Partial<CharacterAppearance> = {}) =>
  buildChibiGeometry(CHIBI_BUDGET, 'test/features', { ...DEFAULT_APPEARANCE, ...patch })

const triangles = (patch: Partial<CharacterAppearance> = {}): number => build(patch).geometry.getIndex()!.count / 3

/** Every vertex of the feature block, in bind-pose world space. */
const featurePoints = (patch: Partial<CharacterAppearance>): Vector3[] => {
  const built = build(patch)
  const position = built.geometry.getAttribute('position')
  const out: Vector3[] = []
  for (let i = built.blocks.features; i < built.blocks.face; i++) {
    out.push(new Vector3(position.getX(i), position.getY(i), position.getZ(i)))
  }
  return out
}

/**
 * Signed clearance outside the head's **ideal** surface, in its own
 * cross-section space. Negative is buried.
 *
 * The ideal ellipsoid rather than the built 9-gon, which sits up to 6 % inside
 * it: every threshold below is stated against the ideal for the reason
 * `variants.ts` states its own numbers there — the built surface depends on the
 * tessellation, and a test that moved when `radial` changed would be testing the
 * mesh rather than the shape.
 */
const outsideSkull = (p: Vector3): number => {
  const s = p.y - HEAD.centre[1]
  const top = HEAD.top[1] - HEAD.centre[1]
  const radius =
    s <= 0
      ? Math.sqrt(Math.max(0, HEAD.radius ** 2 - s * s))
      : s >= top
        ? Math.sqrt(Math.max(0, HEAD.radius ** 2 - (s - top) ** 2))
        : HEAD.radius
  return Math.hypot(p.z, p.x / HEAD.widthScale) - radius
}

const ALL: Partial<CharacterAppearance>[] = [
  ...BEARD_STYLES.map(beard => ({ beard })),
  ...NOSE_STYLES.map(nose => ({ nose })),
  ...BROW_STYLES.map(brows => ({ brows }))
]

// ─── The default figure did not move ────────────────────────────────────────

describe('the three axes default to nothing', () => {
  it('leaves the shipped figure at exactly the triangles it had', () => {
    expect(DEFAULT_APPEARANCE.beard).toBe('none')
    expect(DEFAULT_APPEARANCE.brows).toBe('fine')
    expect(DEFAULT_APPEARANCE.nose).toBe('none')
    expect(triangles()).toBe(956)
  })

  it('emits an empty feature block, so the hair block still ends at the face', () => {
    const { blocks } = build()
    expect(blocks.features, 'features start').toBe(blocks.face)
    expect(blocks.hair).toBeLessThanOrEqual(blocks.features)
  })

  it('reloads an appearance written before any of them existed', () => {
    // Exactly the blob an older build wrote: no `beard`, `brows` or `nose` key.
    const legacy = {
      sex: 'female',
      head: 'oval',
      hair: 'braids',
      eyes: 'sleepy',
      mouth: 'grin',
      skinTone: 3,
      hairColour: 2,
      tunicColour: 4,
      gearSeed: 2
    }
    const repaired = sanitiseAppearance(legacy)
    expect(repaired.beard).toBe('none')
    expect(repaired.brows).toBe('fine')
    expect(repaired.nose).toBe('none')
    // And the fields it *did* carry are untouched.
    expect(repaired.hair).toBe('braids')
    expect(repaired.eyes).toBe('sleepy')
  })

  it('round-trips every style through the sanitiser', () => {
    for (const patch of ALL) {
      const appearance = { ...DEFAULT_APPEARANCE, ...patch }
      expect(sanitiseAppearance(appearance), JSON.stringify(patch)).toEqual(appearance)
      expect(copyAppearance(appearance)).toEqual(appearance)
    }
  })

  it('rejects a style that is not in the union', () => {
    expect(sanitiseAppearance({ beard: 'mutton', nose: 'aquiline', brows: 'heavy' }).beard).toBe('none')
    expect(sanitiseAppearance({ nose: 'aquiline' }).nose).toBe('none')
    expect(sanitiseAppearance({ brows: 'heavy' }).brows).toBe('fine')
  })
})

// ─── Every style builds, and builds correctly ───────────────────────────────

describe.each(ALL)('feature %o', patch => {
  it('emits only finite floats', () => {
    // `Number.isFinite`, per the project's own recurring check: a comparison
    // against NaN is false, so the obvious guards silently pass.
    const built = build(patch)
    for (const name of ['position', 'normal', 'color', 'skinWeight'] as const) {
      const attribute = built.geometry.getAttribute(name)
      for (let i = 0; i < attribute.count * attribute.itemSize; i++) {
        expect(Number.isFinite(attribute.array[i]), `${name}[${i}]`).toBe(true)
      }
    }
  })

  it('carries unit-length authored normals', () => {
    const built = build(patch)
    const normal = built.geometry.getAttribute('normal')
    for (let i = built.blocks.features; i < built.blocks.face; i++) {
      const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))
      expect(length, `vertex ${i}`).toBeCloseTo(1, 5)
    }
  })

  it('carries skin weights that sum to one', () => {
    const built = build(patch)
    const weight = built.geometry.getAttribute('skinWeight')
    for (let i = built.blocks.features; i < built.blocks.face; i++) {
      expect(weight.getX(i) + weight.getY(i) + weight.getZ(i) + weight.getW(i), `vertex ${i}`).toBeCloseTo(1, 5)
    }
  })

  it('rides the skull rather than claiming weight 1 on the head', () => {
    // The lesson `face.ts` paid 49.6 mm of slide for, applied to a third thing
    // glued to the head: below the hairline every strand vertex is the skull's
    // own 50/50 head-and-neck blend.
    const built = build(patch)
    const weight = built.geometry.getAttribute('skinWeight')
    const position = built.geometry.getAttribute('position')
    for (let i = built.blocks.features; i < built.blocks.face; i++) {
      if (position.getY(i) < HEAD.hairlineY) {
        expect(weight.getX(i), `vertex ${i} head share`).toBeCloseTo(0.5, 5)
        expect(weight.getY(i), `vertex ${i} neck share`).toBeCloseTo(0.5, 5)
      }
    }
  })

  it('lands in the outline hull, not in the face decal block', () => {
    const built = build(patch)
    const hull = built.outlineGeometry.getIndex()!
    const body = built.geometry.getIndex()!
    // The hull is the index prefix that ends where the face begins, so a feature
    // vertex is in it iff the block sits before the face — which is the whole
    // reason the block is appended where it is.
    expect(built.blocks.features).toBeLessThanOrEqual(built.blocks.face)
    let inHull = 0
    for (let i = 0; i < hull.count; i++) {
      const v = hull.getX(i)
      if (v >= built.blocks.features && v < built.blocks.face) {
        inHull++
      }
    }
    const total = built.blocks.face - built.blocks.features
    expect(inHull > 0 || total === 0, 'features are in the outline hull').toBe(true)
    expect(hull.count).toBeLessThanOrEqual(body.count)
  })

  it('is deterministic', () => {
    const a = build(patch).geometry.getAttribute('position').array
    const b = build(patch).geometry.getAttribute('position').array
    expect(Array.from(a)).toEqual(Array.from(b))
  })
})

// ─── Where the masses are allowed to be ─────────────────────────────────────

describe('every mass is rooted inside the skull', () => {
  /**
   * ── 25 mm, and the two shallow ones are shallow on purpose ────────────────
   *
   * `hairSpecs` roots every strand 40 mm or more inside the skull, and for a
   * mass that *erupts through* the jaw that is right: the head-shape warp scales
   * the skull by up to 1.06, so a root sitting on the surface opens a seam on
   * exactly the head shapes that need it least to.
   *
   * The moustache and the brow ridge are different, and had to be: both **lie
   * on** the surface rather than growing out of it, so their axes run a few
   * millimetres inside it along their whole length and it is their *end caps*
   * that are buried. Measured, the deepest vertex is 28.2 mm in for the
   * moustache and 28.9 mm for the ridge, against 150–244 mm for every beard
   * mass. 25 mm is the floor both of them clear, and burying them further is
   * exactly the bug that made the first moustache render as two grey pebbles.
   */
  it.each(BEARD_STYLES.filter(style => style !== 'none'))('%s', beard => {
    const deepest = Math.min(...featurePoints({ beard }).map(outsideSkull))
    expect(deepest, 'deepest vertex, metres outside the skull').toBeLessThan(-0.025)
  })

  it('the brow ridge and every nose too', () => {
    for (const patch of [{ brows: 'bushy' as const }, ...NOSE_STYLES.filter(n => n !== 'none').map(nose => ({ nose }))]) {
      const deepest = Math.min(...featurePoints(patch).map(outsideSkull))
      expect(deepest, JSON.stringify(patch)).toBeLessThan(-0.025)
    }
  })
})

describe('and enough of every mass is outside it to be seen', () => {
  /**
   * The fraction of a block's vertices that are outside the skull, which is the
   * honest form of "does it show".
   *
   * A maximum would not be: below the chin at y = 1.04 the skull has run out, so
   * *any* vertex hanging under the jaw is trivially "outside" and a beard made
   * entirely of buried geometry with one exposed tip would pass. A fraction
   * catches the failure this is here for — the first moustache had 4 of its 48
   * vertices outside the head and rendered as two pebbles.
   *
   * Measured: 17 % for the brow ridge (the thinnest thing here, and half of it
   * is the buried root), 33 % for mutton chops, 34–61 % for everything else.
   */
  const fractionOutside = (patch: Partial<CharacterAppearance>): number => {
    const points = featurePoints(patch)
    return points.filter(p => outsideSkull(p) > 0).length / points.length
  }

  it.each(BEARD_STYLES.filter(style => style !== 'none'))('%s', beard => {
    expect(fractionOutside({ beard }), 'share of the block outside the skull').toBeGreaterThan(0.3)
  })

  it('a bushy brow stands proud of the forehead', () => {
    expect(fractionOutside({ brows: 'bushy' })).toBeGreaterThan(0.15)
    expect(Math.max(...featurePoints({ brows: 'bushy' }).map(outsideSkull))).toBeGreaterThan(0.005)
  })

  it('every nose stands proud of the face', () => {
    for (const nose of NOSE_STYLES.filter(n => n !== 'none')) {
      expect(fractionOutside({ nose }), nose).toBeGreaterThan(0.3)
      expect(Math.max(...featurePoints({ nose }).map(outsideSkull)), nose).toBeGreaterThan(0.02)
    }
  })
})

describe('the nose stays in the window between the mouth and the eyes', () => {
  it.each(NOSE_STYLES.filter(n => n !== 'none'))('%s', nose => {
    const points = featurePoints({ nose })
    const minY = Math.min(...points.map(p => p.y))
    const maxY = Math.max(...points.map(p => p.y))
    const maxX = Math.max(...points.map(p => Math.abs(p.x)))
    // Measured on the shipped face across the ten eye styles: the mouth tops out
    // at 1.1690 and the eyes bottom out at 1.1978 with their inner corners at
    // |x| ≈ 0.037. `features.ts` states the window this holds it to.
    expect(minY, 'nose bottom').toBeGreaterThan(1.155)
    expect(maxY, 'nose top').toBeLessThan(1.245)
    expect(maxX, 'nose half-width').toBeLessThan(0.045)
  })
})

describe('nothing swallows a face feature', () => {
  /** The nearest feature vertex to any vertex of the eyes or the mouth. */
  const nearestFaceGap = (patch: Partial<CharacterAppearance>): number => {
    const built = build(patch)
    const position = built.geometry.getAttribute('position')
    const faceStart = position.count - FACE_VERTICES
    let nearest = Infinity
    for (let f = faceStart; f < position.count; f++) {
      const fx = position.getX(f)
      const fy = position.getY(f)
      const fz = position.getZ(f)
      for (let i = built.blocks.features; i < built.blocks.face; i++) {
        nearest = Math.min(
          nearest,
          Math.hypot(fx - position.getX(i), fy - position.getY(i), fz - position.getZ(i))
        )
      }
    }
    return nearest
  }

  it.each(BEARD_STYLES.filter(style => style !== 'none'))('%s frames the face rather than covering it', beard => {
    // `bearded`'s own note sets the bar for a beard with no moustache: "the
    // nearest face vertex is 59 mm away, measured, so it frames the mouth and
    // does not swallow it". `muttonChops` is the only such style here and it
    // measures 119 mm, twice that.
    //
    // A style **with** a moustache is a different question and needs its own
    // floor: a moustache lies *on* the lip, that is what one is for, and every
    // one here comes to 8.9–10.5 mm of the mouth's own vertices. 6 mm is the
    // floor that says "beside the mouth, never through it" — under it the two
    // masses interpenetrate and the mouth stops reading as a mouth.
    const floor = hasMoustache(beard) ? 0.006 : 0.02
    expect(nearestFaceGap({ beard }), `${beard} nearest face vertex`).toBeGreaterThan(floor)
  })

  it('the nose clears the eyes and the mouth', () => {
    for (const nose of NOSE_STYLES.filter(n => n !== 'none')) {
      expect(nearestFaceGap({ nose }), nose).toBeGreaterThan(0.012)
    }
  })
})

// ─── The long beards against the costume ────────────────────────────────────

describe('a long beard hangs in front of the chest, not inside it', () => {
  /**
   * ── The claim, and why it is stated as a front-most point ─────────────────
   *
   * A beard past the collar rests **on** a costume, so most of it is *supposed*
   * to be inside one: the back half of the mass is behind the wool and that is
   * correct and invisible. What must not happen is the **front** face going in
   * too, because a mass entirely inside a garment is not ugly, it is *gone* —
   * a `patriarch` that renders as a beard stopping at the collar for no visible
   * reason, which is what the first pass did on every dressed figure.
   *
   * Stated as "the beard's front-most vertex is in front of the garment's" and
   * not per-height-band, and that is a measurement decision rather than a
   * weakening: the mass has 8 radial samples, so only two of them land near the
   * midline per ring and a per-band maximum picks up a *back* vertex wherever
   * the front ones fall outside the band. Six of the four styles' bands came out
   * negative for exactly that reason while the geometry was correct.
   *
   * `mantle` is excluded and is the one garment none of these clears: its cape
   * reaches z = 0.354 at the shoulder, 70 mm in front of any beard here. A caped
   * mayor with a beard to the sternum wears the beard under the cape. Fixing it
   * would mean floating every beard 120 mm off every other costume in the game.
   */
  const CHEST: readonly ItemKind[] = ['jerkin', 'roughTunic', 'robe', 'tabard', 'dress', 'torsoArmour']
  const hipsY = boneDefinition('hips').head[1]

  /** The front-most point of a garment over the chest, in bind-pose world space. */
  const garmentFront = (kind: ItemKind): number => {
    const position = gearModel(kind, 1).geometry.getAttribute('position')
    let front = -Infinity
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i) + hipsY
      if (Math.abs(position.getX(i)) > 0.09 || y < 0.85 || y > 1.05) {
        continue
      }
      front = Math.max(front, position.getZ(i))
    }
    return front
  }

  const fronts = new Map(CHEST.map(kind => [kind, garmentFront(kind)]))

  it.each(['full', 'patriarch', 'forked', 'braided'] as BeardStyle[])('%s', beard => {
    const points = featurePoints({ beard })
    const onChest = points.filter(p => p.y <= 1.05)
    expect(onChest.length, 'the beard reaches the chest at all').toBeGreaterThan(4)

    const beardFront = Math.max(...onChest.map(p => p.z))
    for (const [kind, garment] of fronts) {
      expect(beardFront, `${beard} front against ${kind}`).toBeGreaterThan(garment)
    }
    // And it reaches below the collar, which is the other half of "on the chest":
    // every garment here closes its gorget by y = 1.118.
    expect(Math.min(...points.map(p => p.y)), `${beard} lowest point`).toBeLessThan(1.0)
  })

  it('the short beards stop above the chest, which is what makes them short', () => {
    for (const beard of ['goatee', 'cropped', 'muttonChops'] as BeardStyle[]) {
      const lowest = Math.min(...featurePoints({ beard }).map(p => p.y))
      expect(lowest, `${beard} lowest point`).toBeGreaterThan(1.0)
    }
  })
})

// ─── The old `bearded` hairstyle yields ─────────────────────────────────────

describe('`hair: "bearded"` and the beard axis never both emit', () => {
  it('leaves the legacy style byte-identical when the axis is off', () => {
    // Every saved character and four of the eighteen professions wear it.
    const legacy = build({ hair: 'bearded' })
    expect(legacy.blocks.features).toBe(legacy.blocks.face)
    expect(triangles({ hair: 'bearded' })).toBe(956 + 36)
  })

  it('drops the legacy chin wedge when the axis is on', () => {
    // Two masses on one chin read as a beard with a lump in it, and the inner one
    // is invisible — 36 triangles nobody can see.
    const withAxis = triangles({ hair: 'bearded', beard: 'full' })
    const bowlWithAxis = triangles({ hair: 'bowl', beard: 'full' })
    expect(withAxis - bowlWithAxis, 'the legacy wedge is gone').toBe(0)
  })
})

// ─── The budget ─────────────────────────────────────────────────────────────

describe('the whole product fits the GDD row', () => {
  it('costs what the budget note says, axis by axis', () => {
    const bare = triangles()
    const priced: Record<string, number> = {
      moustache: 60,
      goatee: 96,
      cropped: 180,
      muttonChops: 60,
      full: 204,
      patriarch: 216,
      braided: 228,
      forked: 250
    }
    for (const [beard, cost] of Object.entries(priced)) {
      expect(triangles({ beard: beard as BeardStyle }) - bare, beard).toBe(cost)
    }
    expect(triangles({ brows: 'bushy' }) - bare, 'bushy brows').toBe(60)
    for (const nose of NOSE_STYLES.filter(n => n !== 'none')) {
      expect(triangles({ nose }) - bare, nose).toBe(30)
    }
  })

  /**
   * The exhaustive one, and the only test in the repo that needs its own
   * timeout.
   *
   * It builds a full chibi for every (hair x beard x nose x brow) combination —
   * several hundred figures — because the claim is about the *worst* of them and
   * there is no way to know which that is without building it. In isolation the
   * file runs in 13 s; under the full suite's parallel load the same test sat at
   * 29.2 s against vitest's 30 s default and then began timing out for real once
   * two more suites joined the pool.
   *
   * Raised rather than sampled: taking a random subset would turn a proof that
   * *no* combination exceeds `CHIBI_BUDGET` into a chance that the one which
   * does was not drawn, and the whole point of the assertion is the "no".
   */
  it('has 24 triangles of headroom over the worst figure', { timeout: 120_000 }, () => {
    let worst = 0
    let worstAt = ''
    for (const hair of NPC_HAIR) {
      for (const beard of BEARD_STYLES) {
        for (const nose of NOSE_STYLES) {
          for (const brows of BROW_STYLES) {
            for (const sex of ['male', 'female'] as const) {
              const count = triangles({ hair, beard, nose, brows, sex })
              if (count > worst) {
                worst = count
                worstAt = `${sex} ${hair} + ${beard} + ${nose} + ${brows}`
              }
            }
          }
        }
      }
    }
    expect(worst, `worst figure is ${worstAt}`).toBe(1356)
    expect(CHIBI_BUDGET - worst, 'headroom').toBe(24)
    expect(worstAt).toContain('forked')
  })
})

// ─── Colour ─────────────────────────────────────────────────────────────────

describe('a beard is never black and never invisible', () => {
  const srgbLuma = (colour: Color): number => {
    const s = colour.clone().convertLinearToSRGB()
    return 0.2126 * s.r + 0.7152 * s.g + 0.0722 * s.b
  }

  it('clears GDD R4 on every hair × skin pair', () => {
    for (let hairColour = 0; hairColour < 5; hairColour++) {
      for (let skinTone = 0; skinTone < 5; skinTone++) {
        const stops = beardStops({ ...DEFAULT_APPEARANCE, hairColour, skinTone: skinTone as 0 | 1 | 2 | 3 | 4 })
        expect(srgbLuma(stops.base), `hair ${hairColour} skin ${skinTone}`).toBeGreaterThan(0.06)
        expect(srgbLuma(stops.dark), `hair ${hairColour} skin ${skinTone} dark`).toBeGreaterThan(0.06)
      }
    }
  })

  it('separates from the skin it lies next to, on all 25 pairs', () => {
    // The pair `browColour` measured as actually colliding — light hair on mid or
    // dark skin — and a beard covers far more of that skin than a brow does.
    // Read off `SKIN_TONES` rather than a table of numbers: a ramp that is
    // reordered has to move this test with it, and a hand-copied table would not.
    //
    // Six of the 25 pairs land *exactly* on `BROW_MIN_CONTRAST`, which is the
    // guarantee doing its work — those are the ones where the hair's own shade
    // would have collided and `beardStops` pushed it darker until it did not.
    for (let hairColour = 0; hairColour < SKIN_TONES.length; hairColour++) {
      for (let skinTone = 0; skinTone < SKIN_TONES.length; skinTone++) {
        const stops = beardStops({ ...DEFAULT_APPEARANCE, hairColour, skinTone: skinTone as 0 | 1 | 2 | 3 | 4 })
        expect(
          Math.abs(srgbLuma(stops.base) - srgbLuma(SKIN_TONES[skinTone]!)),
          `hair ${hairColour} on skin ${skinTone}`
        ).toBeGreaterThanOrEqual(BROW_MIN_CONTRAST - 1e-4)
      }
    }
  })

  it('is lighter than the hair on the same head, never darker than its own dark stop', () => {
    for (let hairColour = 0; hairColour < 5; hairColour++) {
      const stops = beardStops({ ...DEFAULT_APPEARANCE, hairColour })
      expect(srgbLuma(stops.base), `hair ${hairColour}`).toBeGreaterThan(srgbLuma(stops.dark))
    }
  })
})

// ─── The lists agree ────────────────────────────────────────────────────────

describe('the three lists of styles agree everywhere', () => {
  it('the creation screen offers exactly the union', () => {
    expect([...BEARD_STYLE_OPTIONS].sort()).toEqual([...BEARD_STYLES].sort())
    expect([...NOSE_STYLE_OPTIONS].sort()).toEqual([...NOSE_STYLES].sort())
    expect([...BROW_STYLE_OPTIONS].sort()).toEqual([...BROW_STYLES].sort())
  })

  it('the crowd can grow every one of them', () => {
    // `NPC_BEARDS` is written out rather than imported from `features.ts` — the
    // world side cannot import the creator screen, which drags a renderer in —
    // so this is what stops the two drifting.
    expect([...NPC_BEARDS].sort()).toEqual([...BEARD_STYLES].sort())
    expect([...NPC_NOSES].sort()).toEqual([...NOSE_STYLES].sort())
    expect(NPC_BEARDS.length).toBe(new Set(NPC_BEARDS).size)
  })

  it('every style a profession rolls is a real one', () => {
    for (let seed = 0; seed < 64; seed++) {
      for (const id of PROFESSION_IDS) {
        const appearance = professionAppearance(id, seed)
        expect(BEARD_STYLES, `${id}:${seed}`).toContain(appearance.beard)
        expect(NOSE_STYLES, `${id}:${seed}`).toContain(appearance.nose)
        expect(BROW_STYLES, `${id}:${seed}`).toContain(appearance.brows)
      }
    }
  })
})

// ─── The crowd ──────────────────────────────────────────────────────────────

describe('the crowd grows facial hair the way `professions.ts` says', () => {
  it('never on the feminine build', () => {
    for (let seed = 0; seed < 300; seed++) {
      for (const id of PROFESSION_IDS) {
        const appearance = professionAppearance(id, seed)
        if (appearance.sex === 'female') {
          expect(appearance.beard, `${id}:${seed}`).toBe('none')
        }
      }
    }
  })

  it('on about two masculine townspeople in five', () => {
    let male = 0
    let bearded = 0
    for (let seed = 0; seed < 400; seed++) {
      const appearance = professionAppearance('farmer', seed)
      if (appearance.sex === 'male') {
        male++
        if (appearance.beard !== 'none') {
          bearded++
        }
      }
    }
    expect(male).toBeGreaterThan(100)
    expect(bearded / male, 'beard rate among masculine farmers').toBeGreaterThan(0.28)
    expect(bearded / male, 'beard rate among masculine farmers').toBeLessThan(0.52)
  })

  it('gives the wanderer one every time, and always a long one', () => {
    for (let seed = 0; seed < 200; seed++) {
      const appearance = professionAppearance('wanderer', seed)
      if (appearance.sex === 'female') {
        continue
      }
      expect(['patriarch', 'forked', 'braided', 'full'], `seed ${seed}`).toContain(appearance.beard)
    }
  })

  it('stays deterministic in (profession, seed)', () => {
    for (let seed = 0; seed < 32; seed++) {
      for (const id of PROFESSION_IDS) {
        expect(professionAppearance(id, seed)).toEqual(professionAppearance(id, seed))
      }
    }
  })

  it('spreads the three axes rather than collapsing them', () => {
    const beards = new Set<BeardStyle>()
    const noses = new Set<NoseStyle>()
    for (let seed = 0; seed < 200; seed++) {
      const appearance = professionAppearance('dayWorker', seed)
      beards.add(appearance.beard)
      noses.add(appearance.nose)
    }
    expect(beards.size, 'distinct beards among 200 day workers').toBeGreaterThan(6)
    expect(noses.size, 'distinct noses').toBe(NOSE_STYLES.length)
  })
})

describe('"surprise me" is not a town of bearded women', () => {
  it('never beards a feminine roll, and shaves some of the masculine ones', () => {
    let sequence = 0
    const random = (): number => {
      sequence = (sequence * 1664525 + 1013904223) >>> 0
      return sequence / 0x100000000
    }
    let female = 0
    let femaleBearded = 0
    let male = 0
    let maleShaved = 0
    for (let i = 0; i < 600; i++) {
      const appearance = randomAppearance(random)
      if (appearance.sex === 'female') {
        female++
        if (appearance.beard !== 'none') {
          femaleBearded++
        }
      } else {
        male++
        if (appearance.beard === 'none') {
          maleShaved++
        }
      }
    }
    expect(female).toBeGreaterThan(100)
    expect(male).toBeGreaterThan(100)
    expect(femaleBearded / female, 'bearded feminine rolls').toBeLessThan(0.12)
    expect(maleShaved / male, 'clean-shaven masculine rolls').toBeGreaterThan(0.25)
  })
})

// A hair style is still a hair style: nothing here widened `HairStyle`.
export type _Unused = HairStyle
