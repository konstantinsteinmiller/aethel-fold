import type { BufferGeometry } from 'three'

/**
 * Triangle budgets are a contract, not a guideline (GDD §4.1). Every generator
 * ends with `assertTriBudget`, so an asset that quietly grows past its tier
 * fails loudly at boot in dev instead of silently costing 4 ms on a phone six
 * weeks later.
 */

export const triangleCount = (geometry: BufferGeometry): number => {
  const index = geometry.index
  if (index) {
    return index.count / 3
  }
  return geometry.getAttribute('position').count / 3
}

/** Filled in by `src/world/assets/index.ts` so the perf panel can show budgets. */
export const budgetLedger: { name: string; tris: number; budget: number }[] = []

export const assertTriBudget = (geometry: BufferGeometry, budget: number, name: string): BufferGeometry => {
  const tris = triangleCount(geometry)
  budgetLedger.push({ name, tris, budget })

  if (tris > budget) {
    const message = `[world] ${name} is ${tris} tris, budget is ${budget} (GDD §4.1)`
    if (import.meta.env.DEV) {
      throw new Error(message)
    }
    console.warn(message)
  }
  return geometry
}
