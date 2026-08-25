import type { PlaceableCategory, PlaceableDefinition } from './types'

/**
 * The placeable registry.
 *
 * Asset modules register into it at build time; the editor palette and the
 * collision system both read out of it. Keeping it a plain module singleton
 * (not a Vue store) is deliberate — it lives on the three.js side of the
 * Vue/three split (GDD §0) and the editor panel copies out of it rather than
 * proxying it.
 */

const definitions = new Map<string, PlaceableDefinition>()

/**
 * Monotonic registration counter.
 *
 * A plain integer, deliberately — this is the three.js side of GDD §0, so it
 * cannot be a `ref`. Consumers poll it, exactly as they poll `levelRevision()`.
 *
 * It exists because the catalogue is no longer populated at boot. Placeable
 * generation was 77 % of a 660 ms boot and now drains over ~30 frames *after*
 * the first render (AAA-graphics §11d) — which is long after the editor panel
 * mounts. The panel used to read the palette once on mount and once on each
 * switch-*on* of editor mode, and that was correct until the drain existed:
 * with the mode already on at boot (it is persisted), neither ever fired against
 * a full catalogue, so the palette stayed **permanently empty for the whole
 * session** and the only way out was to type the code word twice.
 */
let revision = 0

export const registerPlaceable = (definition: PlaceableDefinition): PlaceableDefinition => {
  if (definitions.has(definition.id)) {
    // Ids are persisted in placements, so a silent overwrite would make saved
    // levels load the wrong prop.
    throw new Error(`[world] duplicate placeable id "${definition.id}"`)
  }
  definitions.set(definition.id, definition)
  revision++
  return definition
}

/** Bumps whenever the catalogue gains or loses a definition. See `revision`. */
export const catalogRevision = (): number => revision

export const placeableCount = (): number => definitions.size

export const getPlaceable = (id: string): PlaceableDefinition | undefined => definitions.get(id)

export const allPlaceables = (): PlaceableDefinition[] => [...definitions.values()]

export const placeablesByCategory = (category: PlaceableCategory): PlaceableDefinition[] =>
  allPlaceables().filter(definition => definition.category === category)

export const clearPlaceables = (): void => {
  definitions.clear()
  revision++
}
