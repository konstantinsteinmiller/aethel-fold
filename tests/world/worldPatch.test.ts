import { describe, expect, it } from 'vitest'
import type { Placement } from '@/world/level/types'
import {
  applyPatchToBaseline,
  buildWorldPatch,
  diffPlacements,
  formatWorldPatch,
  type PlacementLike,
  WORLD_PATCH_VERSION
} from '@/world/level/worldPatch'

/**
 * ─── Exporting editor changes as a distributable patch ──────────────────────
 *
 * The property that has to hold is **idempotence**: export a patch, commit it,
 * boot with it applied, export again — and get an empty patch. Every failure
 * mode here is a version of losing that.
 *
 * The obvious export ("write out every placement") passes a naive test and
 * fails this one, because the second export contains the first export's
 * contents and applying both doubles the level. So the tests below are written
 * against the *round trip*, not against the formatting.
 */

const place = (defId: string, x: number, z: number, over: Partial<Placement> = {}): Placement => ({
  id: `p${x}_${z}`,
  defId,
  x,
  y: 0,
  z,
  rotY: 0,
  scale: 1,
  ...over
})

const seed = (defId: string, x: number, z: number, over: Partial<PlacementLike> = {}): PlacementLike => ({
  defId,
  x,
  y: 0,
  z,
  rotY: 0,
  scale: 1,
  ...over
})

describe('diffPlacements', () => {
  it('reports nothing when the level is exactly the baseline', () => {
    const baseline = [seed('slab-step', 0, 0), seed('cliff-spire', 10, 4)]
    const live = [place('slab-step', 0, 0), place('cliff-spire', 10, 4)]

    const diff = diffPlacements(live, baseline)

    expect(diff.added).toHaveLength(0)
    expect(diff.moved).toHaveLength(0)
    expect(diff.deleted).toHaveLength(0)
  })

  it('ignores placement ids entirely', () => {
    // The whole point of a *distributable* patch: two browsers hold different
    // ids for the same prop, so an id-based diff would report every prop in a
    // shared level as both added and deleted.
    const baseline = [seed('slab-step', 0, 0)]
    const live = [place('slab-step', 0, 0, { id: 'totally-different-id' })]

    const diff = diffPlacements(live, baseline)

    expect(diff.added).toHaveLength(0)
    expect(diff.deleted).toHaveLength(0)
  })

  it('reports a new prop as added', () => {
    const diff = diffPlacements([place('slab-step', 0, 0), place('rock-boulder', 5, 5)], [seed('slab-step', 0, 0)])

    expect(diff.added.map(p => p.defId)).toEqual(['rock-boulder'])
    expect(diff.moved).toHaveLength(0)
    expect(diff.deleted).toHaveLength(0)
  })

  it('reports a nudged prop as moved, not as an add plus a delete', () => {
    const diff = diffPlacements([place('slab-step', 3, 0)], [seed('slab-step', 0, 0)])

    expect(diff.moved).toHaveLength(1)
    expect(diff.moved[0]!.to.x).toBe(3)
    // Both halves: the baseline entry the patch has to suppress comes with it.
    expect(diff.moved[0]!.from.x).toBe(0)
    expect(diff.added).toHaveLength(0)
    expect(diff.deleted).toHaveLength(0)
  })

  it('reports a rotation or a rescale in place as moved', () => {
    // Same position, different transform. If only XZ were compared, a prop the
    // user spent an afternoon rotating would export as unchanged.
    const rotated = diffPlacements([place('slab-step', 0, 0, { rotY: 1.2 })], [seed('slab-step', 0, 0)])
    expect(rotated.moved).toHaveLength(1)

    const scaled = diffPlacements([place('slab-step', 0, 0, { scale: 2 })], [seed('slab-step', 0, 0)])
    expect(scaled.moved).toHaveLength(1)
  })

  it('does not call a prop moved when a same-kind prop has travelled across the map', () => {
    const diff = diffPlacements([place('slab-step', 400, 400)], [seed('slab-step', 0, 0)])

    expect(diff.added).toHaveLength(1)
    expect(diff.deleted).toHaveLength(1)
    expect(diff.moved).toHaveLength(0)
  })

  it('reports a removed baseline prop as deleted', () => {
    const diff = diffPlacements([], [seed('slab-step', 0, 0), seed('cliff-spire', 9, 9)])

    expect(diff.deleted).toHaveLength(2)
  })

  it('does not let one baseline prop absorb two live props', () => {
    // A duplicate placed on top of a baseline prop is one match and one add.
    // Matching without consuming would report both as unchanged and silently
    // drop the copy from the export.
    const diff = diffPlacements([place('slab-step', 0, 0), place('slab-step', 0, 0, { id: 'copy' })], [
      seed('slab-step', 0, 0)
    ])

    expect(diff.added).toHaveLength(1)
    expect(diff.deleted).toHaveLength(0)
  })

  it('tolerates float dust in a transform', () => {
    // A prop that round-tripped through JSON must not export as moved by a
    // nanometre, or every export would be full of phantom changes.
    const diff = diffPlacements([place('slab-step', 0.0000001, 0)], [seed('slab-step', 0, 0)])

    expect(diff.moved).toHaveLength(0)
    expect(diff.added).toHaveLength(0)
  })
})

describe('buildWorldPatch', () => {
  const baseline = [seed('slab-step', 0, 0), seed('cliff-spire', 10, 4)]

  it('produces an empty delta for an untouched world', () => {
    const built = buildWorldPatch({
      live: [place('slab-step', 0, 0), place('cliff-spire', 10, 4)],
      baseline,
      removedScatter: [],
      mode: 'delta'
    })

    expect(built.patch.placements).toHaveLength(0)
    expect(built.patch.removedScatter).toHaveLength(0)
    expect(built.patch.version).toBe(WORLD_PATCH_VERSION)
  })

  it('carries only the changes in delta mode', () => {
    const built = buildWorldPatch({
      live: [place('slab-step', 0, 0), place('cliff-spire', 10, 4), place('rock-stone', 22, 3)],
      baseline,
      removedScatter: ['tree0:100:200'],
      mode: 'delta'
    })

    expect(built.patch.placements.map(p => p.defId)).toEqual(['rock-stone'])
    expect(built.added).toBe(1)
    expect(built.patch.removedScatter).toEqual(['tree0:100:200'])
  })

  it('carries everything in full mode, including what the baseline already had', () => {
    const built = buildWorldPatch({
      live: [place('slab-step', 0, 0), place('cliff-spire', 10, 4), place('rock-stone', 22, 3)],
      baseline,
      removedScatter: [],
      mode: 'full'
    })

    expect(built.patch.placements).toHaveLength(3)
  })

  it('sorts, so re-exporting an unchanged world produces the same file', () => {
    const live = [place('rock-stone', 22, 3), place('slab-step', 0, 0)]
    const shuffled = [place('slab-step', 0, 0), place('rock-stone', 22, 3)]

    const a = buildWorldPatch({ live, baseline: [], removedScatter: ['b', 'a'], mode: 'full' })
    const b = buildWorldPatch({ live: shuffled, baseline: [], removedScatter: ['a', 'b'], mode: 'full' })

    expect(formatWorldPatch(a, 'full')).toBe(formatWorldPatch(b, 'full'))
  })

  it('encodes a deleted starting prop as a removal, not as silence', () => {
    const built = buildWorldPatch({
      live: [place('slab-step', 0, 0)],
      baseline,
      removedScatter: [],
      mode: 'delta'
    })

    expect(built.patch.removedPlacements.map(p => p.defId)).toEqual(['cliff-spire'])
  })

  it('encodes a moved starting prop as both a removal and an addition', () => {
    // One entry would leave the original standing on a fresh install and put
    // the moved copy beside it — two props where the user has one.
    const built = buildWorldPatch({
      live: [place('slab-step', 3, 1), place('cliff-spire', 10, 4)],
      baseline,
      removedScatter: [],
      mode: 'delta'
    })

    expect(built.moved).toBe(1)
    expect(built.patch.placements).toHaveLength(1)
    expect(built.patch.placements[0]!.x).toBe(3)
    expect(built.patch.removedPlacements).toHaveLength(1)
    expect(built.patch.removedPlacements[0]!.x).toBe(0)
  })
})

/**
 * ─── The round trip ─────────────────────────────────────────────────────────
 *
 * Everything above tests one half. This tests the loop the feature actually
 * lives in: edit in the browser, export, commit, reboot with the patch applied,
 * export again. A patch that is not stable across that loop cannot be
 * distributed — it either loses the previous session's work or duplicates it.
 */
describe('export → commit → reboot → export', () => {
  const starting = [seed('slab-step', 0, 0), seed('cliff-spire', 10, 4), seed('plateau-wide', -6, -3)]

  /** One boot: seed the world from the patch, and export what it now holds. */
  const reboot = (patch: ReturnType<typeof buildWorldPatch>['patch'], mode: 'delta' | 'full' = 'delta') => {
    const seeded = applyPatchToBaseline(starting, patch)
    // `seedLevel` mints ids on the way in, which is what the editor would hold.
    const live: Placement[] = seeded.map((prop, i) => ({ id: `fresh${i}`, ...prop }))
    return {
      live,
      next: buildWorldPatch({ live, baseline: starting, removedScatter: patch.removedScatter, mode })
    }
  }

  it('produces a byte-identical patch on the second export', () => {
    const edited: Placement[] = [
      ...starting.map((prop, i) => ({ id: `p${i}`, ...prop })),
      place('rock-stone', 40, 40)
    ]
    const first = buildWorldPatch({ live: edited, baseline: starting, removedScatter: ['tree1:5:5'], mode: 'delta' })

    const second = reboot(first.patch).next

    expect(formatWorldPatch(second, 'delta')).toBe(formatWorldPatch(first, 'delta'))
  })

  it('does not duplicate the props it added', () => {
    const edited: Placement[] = [
      ...starting.map((prop, i) => ({ id: `p${i}`, ...prop })),
      place('rock-stone', 40, 40)
    ]
    const first = buildWorldPatch({ live: edited, baseline: starting, removedScatter: [], mode: 'delta' })

    const once = reboot(first.patch)
    const twice = reboot(once.next.patch)

    expect(once.live).toHaveLength(starting.length + 1)
    expect(twice.live).toHaveLength(starting.length + 1)
  })

  it('does not lose work from an earlier session', () => {
    // The bug this exists to prevent: export A adds a prop, export B (a later
    // session that changed something else) diffs against a baseline that
    // already contains A's prop, so A's prop is not in B — and since B replaces
    // the file, A's prop is gone from the shipped world.
    const sessionA: Placement[] = [
      ...starting.map((prop, i) => ({ id: `p${i}`, ...prop })),
      place('rock-stone', 40, 40)
    ]
    const patchA = buildWorldPatch({ live: sessionA, baseline: starting, removedScatter: [], mode: 'delta' })

    const booted = reboot(patchA.patch)
    const sessionB: Placement[] = [...booted.live, place('rock-boulder', -40, -40)]
    const patchB = buildWorldPatch({ live: sessionB, baseline: starting, removedScatter: [], mode: 'delta' })

    expect(patchB.patch.placements.map(p => p.defId).sort()).toEqual(['rock-boulder', 'rock-stone'])
  })

  it('keeps a deleted starting prop deleted after a reboot', () => {
    const withoutSpire: Placement[] = starting
      .filter(prop => prop.defId !== 'cliff-spire')
      .map((prop, i) => ({ id: `p${i}`, ...prop }))
    const patch = buildWorldPatch({ live: withoutSpire, baseline: starting, removedScatter: [], mode: 'delta' })

    const booted = reboot(patch.patch)

    expect(booted.live.some(prop => prop.defId === 'cliff-spire')).toBe(false)
    expect(booted.live).toHaveLength(starting.length - 1)
  })

  it('keeps a moved starting prop in one place, not two', () => {
    const moved: Placement[] = [
      place('slab-step', 5, 2),
      ...starting.slice(1).map((prop, i) => ({ id: `p${i}`, ...prop }))
    ]
    const patch = buildWorldPatch({ live: moved, baseline: starting, removedScatter: [], mode: 'delta' })

    const booted = reboot(patch.patch)
    const slabs = booted.live.filter(prop => prop.defId === 'slab-step')

    expect(slabs).toHaveLength(1)
    expect(slabs[0]!.x).toBe(5)
  })

  it('round-trips a full export as a replacement for the starting level', () => {
    // Full mode suppresses every starting prop and lists the scene. Booting it
    // must give back exactly that scene, and re-exporting must be stable.
    const scene: Placement[] = [place('rock-stone', 1, 1), place('rock-boulder', 2, 2)]
    const full = buildWorldPatch({ live: scene, baseline: starting, removedScatter: [], mode: 'full' })

    const booted = reboot(full.patch, 'full')

    expect(booted.live.map(p => p.defId).sort()).toEqual(['rock-boulder', 'rock-stone'])
    expect(formatWorldPatch(booted.next, 'full')).toBe(formatWorldPatch(full, 'full'))
  })

  it('carries scatter tombstones through unchanged', () => {
    // Tombstones are a delta against the generator, which never changes, so
    // they are simply restated. What would be wrong is dropping one or listing
    // it twice.
    const first = buildWorldPatch({
      live: starting.map((prop, i) => ({ id: `p${i}`, ...prop })),
      baseline: starting,
      removedScatter: ['tree0:1:2', 'stone1:3:4'],
      mode: 'delta'
    })

    const second = reboot(first.patch).next

    expect(second.patch.removedScatter).toEqual(['stone1:3:4', 'tree0:1:2'])
  })
})

describe('applyPatchToBaseline', () => {
  it('returns the baseline untouched for an empty patch', () => {
    const starting = [seed('slab-step', 0, 0), seed('cliff-spire', 10, 4)]

    expect(applyPatchToBaseline(starting, { placements: [], removedPlacements: [] })).toEqual(starting)
  })

  it('removes one of two identical props, not both', () => {
    // Two slabs stacked at the same spot and one removal entry: taking away
    // both would delete a prop the patch never mentioned.
    const starting = [seed('slab-step', 0, 0), seed('slab-step', 0, 0)]

    const result = applyPatchToBaseline(starting, {
      placements: [],
      removedPlacements: [seed('slab-step', 0, 0)]
    })

    expect(result).toHaveLength(1)
  })

  it('ignores a removal that matches nothing', () => {
    // A patch written against an older starting level. Better to apply the rest
    // than to throw away the whole thing.
    const starting = [seed('slab-step', 0, 0)]

    const result = applyPatchToBaseline(starting, {
      placements: [seed('rock-stone', 9, 9)],
      removedPlacements: [seed('cliff-spire', 99, 99)]
    })

    expect(result.map(p => p.defId)).toEqual(['slab-step', 'rock-stone'])
  })
})

describe('formatWorldPatch', () => {
  const built = buildWorldPatch({
    live: [place('slab-step', 1.23456, 7.89123, { rotY: 0.5, scale: 1.25 })],
    baseline: [],
    removedScatter: ['tree0:123:456'],
    mode: 'delta'
  })

  it('emits a module the loader can import', () => {
    const source = formatWorldPatch(built, 'delta')

    expect(source).toContain("import type { WorldPatch } from './worldPatch'")
    expect(source).toContain('export const WORLD_PATCH: WorldPatch = {')
    expect(source).toContain(`version: ${WORLD_PATCH_VERSION},`)
    expect(source).toContain('"tree0:123:456"')
  })

  it('rounds transforms to millimetres', () => {
    const source = formatWorldPatch(built, 'delta')

    expect(source).toContain('x: 1.235')
    expect(source).toContain('z: 7.891')
    // And not the float64 tail.
    expect(source).not.toContain('1.23456')
  })

  it('omits placement ids', () => {
    // They are minted per browser. Shipping them would put one machine's
    // bookkeeping into a file every machine reads.
    expect(formatWorldPatch(built, 'delta')).not.toContain('id:')
  })

  it('matches what the dev-server endpoint accepts', () => {
    // The Vite middleware gates on these three markers before overwriting a
    // file in `src/`. If the formatter's shape drifts from that gate, every
    // export silently falls back to the clipboard.
    const source = formatWorldPatch(built, 'delta')

    expect(source.includes("import type { WorldPatch } from './worldPatch'")).toBe(true)
    expect(source.includes('export const WORLD_PATCH: WorldPatch = {')).toBe(true)
    expect(source.includes('removedScatter:')).toBe(true)
  })
})

describe('the crowd and the water in a patch', () => {
  /**
   * Neither is a diff, and that is the whole design.
   *
   * Props have a shipped baseline — `buildStartingLevel` puts them in the world
   * before any patch is applied — so a patch of props has to say what *changed*
   * or a re-export would duplicate them. There is no starting crowd and no
   * starting water: a fresh install has none, so "what changed" and "what is
   * there" are the same list, and expressing them as diffs would mean a
   * `removedNpcs` array that is always empty.
   */
  const npcs = [
    { profession: 'townGuard', x: 4, y: 0, z: -2, facingDeg: 90, seed: 3 },
    { profession: 'farmer', x: -1.5, y: 0.25, z: 8, facingDeg: 0, seed: 11 }
  ]
  const water = [
    {
      id: 'w1',
      kind: 'pool',
      styleId: 'pond',
      x: -34.929,
      y: 9.864,
      z: 28.779,
      rotY: 0,
      halfX: 6,
      halfZ: 6,
      nodes: []
    },
    {
      id: 'w2',
      kind: 'river',
      styleId: 'river',
      x: 0,
      y: 0,
      z: 0,
      rotY: 0,
      halfX: 0,
      halfZ: 0,
      nodes: [
        { x: 0, y: 3, z: 0, halfWidth: 2.5 },
        { x: 8, y: 2.2, z: 4, halfWidth: 2.5 }
      ]
    }
  ]

  const built = buildWorldPatch({ live: [], baseline: [], removedScatter: [], npcs, water, mode: 'delta' })

  it('carries both through a delta with no placements at all', () => {
    // A level whose only change is a lake still has a change worth writing. The
    // panel's "there is something to export" flag reads these counts, and
    // without them the export button looked like it would do nothing.
    expect(built.npcs).toBe(2)
    expect(built.water).toBe(2)
    expect(built.patch.npcs).toHaveLength(2)
    expect(built.patch.water).toHaveLength(2)
  })

  it('carries both through a full export too', () => {
    const full = buildWorldPatch({ live: [], baseline: [], removedScatter: [], npcs, water, mode: 'full' })
    expect(full.patch.npcs).toHaveLength(2)
    expect(full.patch.water).toHaveLength(2)
  })

  it('sorts the crowd so a re-export with nothing changed produces no diff', () => {
    const shuffled = buildWorldPatch({
      live: [],
      baseline: [],
      removedScatter: [],
      npcs: [...npcs].reverse(),
      water,
      mode: 'delta'
    })
    expect(formatWorldPatch(shuffled, 'delta')).toBe(formatWorldPatch(built, 'delta'))
  })

  it('does not alias the editor’s own arrays', () => {
    // `waterPlacements()` hands out copies, but the patch must not depend on
    // that: a patch holding the live array would let a later edit rewrite an
    // export that had already been formatted.
    expect(built.patch.water).not.toBe(water)
    expect(built.patch.npcs).not.toBe(npcs)
  })

  it('emits both as valid, re-readable source', () => {
    const source = formatWorldPatch(built, 'delta')
    expect(source.includes('npcs: [')).toBe(true)
    expect(source.includes('water: [')).toBe(true)
    expect(source.includes('profession: "townGuard"')).toBe(true)
    expect(source.includes('styleId: "pond"')).toBe(true)
    // A river's nodes have to survive as nodes, or the spline is lost and the
    // body loads as an unbuildable one-node draft.
    expect(source.includes('halfWidth: 2.5')).toBe(true)
    // Still the shape the dev-server endpoint gates on.
    expect(source.includes('export const WORLD_PATCH: WorldPatch = {')).toBe(true)
    // Trailing-comma discipline: `removedScatter` used to close the object and
    // now has two fields after it. A missing comma there is a syntax error in a
    // generated file, which is the one failure a formatter test must catch.
    expect(source.includes('  ]\n}')).toBe(true)
  })

  it('omits nothing when neither is given', () => {
    // Older callers pass neither. Both come out as empty arrays rather than
    // `undefined`, so the generated file is uniform and a loader never has to
    // branch on a missing key.
    const bare = buildWorldPatch({ live: [], baseline: [], removedScatter: [], mode: 'delta' })
    expect(bare.patch.npcs).toEqual([])
    expect(bare.patch.water).toEqual([])
    expect(bare.npcs).toBe(0)
    expect(bare.water).toBe(0)
  })
})
