import { beforeEach, describe, expect, it } from 'vitest'
import {
  allPlaceables,
  catalogRevision,
  clearPlaceables,
  getPlaceable,
  placeableCount,
  registerPlaceable
} from '@/world/level/catalog'
import type { PlaceableDefinition } from '@/world/level/types'

/**
 * ─── A palette that arrives after the panel does ────────────────────────────
 *
 * These pin the mechanism behind a bug that was invisible in every automated
 * check and total in practice: **the level editor's palette was empty for the
 * entire session on any reload with editor mode already on.**
 *
 * The cause was a change made somewhere else entirely. Placeable generation used
 * to happen during `new World()`; it was 77 % of a 660 ms boot, so it moved off
 * the critical path and now drains a slice per frame over ~30 frames *after* the
 * first render (AAA-graphics §11d). `LevelEditorPanel` read the catalogue on
 * mount and on each switch-*on* of editor mode — both correct before the drain
 * existed, and both now guaranteed to fire against an empty registry, because
 * editor mode is persisted and so is never switched on during a restored
 * session.
 *
 * The failure mode is the reason this is worth a test rather than a comment: no
 * error, no warning, a perfectly functional panel with nothing in it, and a
 * workaround (type the code word twice) that nobody would ever guess.
 *
 * So the catalogue publishes a revision, and the editor façade re-reads the
 * palette once it stops moving.
 */

const definition = (id: string): PlaceableDefinition =>
  ({
    id,
    label: id,
    category: 'rock',
    // The registry stores whatever it is handed and never dereferences the
    // asset, so a stub keeps this test free of geometry generation.
    asset: { name: id, perfTag: 'test', tiers: [], material: null, outline: null, outlineMaxTier: -1, radius: 1, distanceScale: 1 },
    collider: { kind: 'none' },
    walkable: false
  }) as unknown as PlaceableDefinition

describe('placeable catalogue revision', () => {
  beforeEach(() => {
    clearPlaceables()
  })

  it('bumps on every registration', () => {
    const before = catalogRevision()
    registerPlaceable(definition('a'))
    const afterOne = catalogRevision()
    registerPlaceable(definition('b'))
    const afterTwo = catalogRevision()

    expect(afterOne).toBeGreaterThan(before)
    expect(afterTwo).toBeGreaterThan(afterOne)
  })

  it('bumps on clear, so a teardown cannot leave a stale palette on screen', () => {
    registerPlaceable(definition('a'))
    const before = catalogRevision()
    clearPlaceables()
    expect(catalogRevision()).toBeGreaterThan(before)
    expect(placeableCount()).toBe(0)
  })

  /**
   * The whole point of the counter: it has to be *monotonic*, because the
   * consumer compares it against a remembered value rather than subscribing.
   * A revision that reset on clear would compare equal to a value seen before
   * the clear and the palette would never be re-read.
   */
  it('never runs backwards, even across a clear', () => {
    const seen: number[] = [catalogRevision()]
    registerPlaceable(definition('a'))
    seen.push(catalogRevision())
    clearPlaceables()
    seen.push(catalogRevision())
    registerPlaceable(definition('b'))
    seen.push(catalogRevision())

    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThan(seen[i - 1]!)
    }
  })

  /**
   * The scenario, replayed: a consumer that read the catalogue once while it was
   * empty must be able to tell — from the integer alone — that it is now stale.
   */
  it('lets a consumer that read an empty catalogue detect that it filled up', () => {
    const seenRevision = catalogRevision()
    const seenPalette = allPlaceables()
    expect(seenPalette).toHaveLength(0)

    // …the drain runs, one definition per frame…
    for (const id of ['a', 'b', 'c']) {
      registerPlaceable(definition(id))
    }

    expect(catalogRevision()).not.toBe(seenRevision)
    expect(allPlaceables()).toHaveLength(3)
    expect(getPlaceable('b')?.id).toBe('b')
  })

  it('still refuses a duplicate id, and does not bump for the attempt', () => {
    registerPlaceable(definition('a'))
    const before = catalogRevision()
    expect(() => registerPlaceable(definition('a'))).toThrow(/duplicate/)
    expect(catalogRevision()).toBe(before)
  })
})
