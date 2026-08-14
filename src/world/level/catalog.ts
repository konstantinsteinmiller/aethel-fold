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

export const registerPlaceable = (definition: PlaceableDefinition): PlaceableDefinition => {
  if (definitions.has(definition.id)) {
    // Ids are persisted in placements, so a silent overwrite would make saved
    // levels load the wrong prop.
    throw new Error(`[world] duplicate placeable id "${definition.id}"`)
  }
  definitions.set(definition.id, definition)
  return definition
}

export const getPlaceable = (id: string): PlaceableDefinition | undefined => definitions.get(id)

export const allPlaceables = (): PlaceableDefinition[] => [...definitions.values()]

export const placeablesByCategory = (category: PlaceableCategory): PlaceableDefinition[] =>
  allPlaceables().filter(definition => definition.category === category)

export const clearPlaceables = (): void => definitions.clear()
