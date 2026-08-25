import { describe, expect, it } from 'vitest'
import {
  placeableProgress,
  placeableTotal,
  registerAllPlaceables,
  registerPlaceablesIncremental
} from '@/world/assets'
import { getPlaceable } from '@/world/level/catalog'

/**
 * ─── Draining the catalogue a slice at a time ───────────────────────────────
 *
 * Generating all 34 placeables is ~500 ms on a desktop and 2.4–4 s under a 4×
 * CPU throttle, which is a freeze either way. `World` drains it under a frame
 * budget instead, so this suite pins the properties that make that safe.
 *
 * It lives in its own file on purpose: the drain cursor is module state, and
 * `assets.test.ts` calls `registerAllPlaceables()` at import time — sharing a
 * module registry would leave the cursor at the end before the first assertion
 * ran. Vitest gives each test file its own, so this one starts from zero.
 *
 * The ordering below matters and the tests are deliberately not independent:
 * there is exactly one catalogue per module instance, and regenerating it per
 * test would cost a full 500 ms build each time to observe the same state
 * machine. They read as one scenario walked forward.
 */
describe('incremental placeable generation', () => {
  it('knows how many rows exist without building any of them', () => {
    // The whole point of the factory array: asking for the count must not
    // trigger 500 ms of geometry.
    expect(placeableTotal()).toBeGreaterThanOrEqual(20)
    expect(placeableProgress()).toBe(0)
  })

  it('always makes progress, however small the budget', () => {
    // A zero budget is the degenerate case that decides whether the budget is a
    // stopping rule or a permission slip. Checked *after* a row rather than
    // before, it still yields one — checked before, this loop would never end.
    expect(registerPlaceablesIncremental(0)).toBe(false)
    expect(placeableProgress()).toBe(1)
  })

  it('registers each row as it is built, not in a batch at the end', () => {
    // A prop that exists but is not in the catalogue is invisible to the editor
    // palette, so a partial drain has to leave a *usable* partial catalogue.
    expect(getPlaceable('plateau-wide')).toBeTruthy()
  })

  it('reports completion only once every row exists', () => {
    let slices = 0
    while (!registerPlaceablesIncremental(0)) {
      slices++
      expect(slices, 'drain did not converge').toBeLessThan(500)
    }
    expect(slices).toBeGreaterThan(1)
    expect(placeableProgress()).toBe(placeableTotal())
  })

  it('resumes rather than restarts when the blocking form is called after a drain', () => {
    const definitions = registerAllPlaceables()
    expect(definitions).toHaveLength(placeableTotal())
    const ids = definitions.map(definition => definition.id)
    // The failure this catches is `registerAllPlaceables` rebuilding from row 0
    // and pushing a second copy of every definition onto the same array.
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is idempotent once complete', () => {
    const before = registerAllPlaceables().length
    expect(registerPlaceablesIncremental(0)).toBe(true)
    expect(registerAllPlaceables()).toHaveLength(before)
    expect(placeableProgress()).toBe(placeableTotal())
  })
})
