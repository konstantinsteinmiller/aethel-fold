import { BufferAttribute, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ensureColorAttribute } from '../geometry/vertexColor'

/**
 * Shared tail end of every asset generator.
 *
 * `mergeGeometries` is strict: every input must carry the *same* attribute set,
 * or it returns null and three logs a wall of red. Parts arrive here from
 * different builders (a lofted tube has UVs, a blob doesn't; a trunk has no
 * wind weight until it's painted), so they're normalised first.
 */

/** Attributes every asset tier ships with. Nothing else — there are no textures. */
const REQUIRED = ['position', 'normal', 'color', 'aWind'] as const

export const normalizeAssetGeometry = (geometry: BufferGeometry): BufferGeometry => {
  // No prop textures anywhere in the world (GDD §5.2), so UVs are dead weight
  // in the vertex buffer — and their presence on some parts and not others is
  // the usual reason a merge silently fails.
  geometry.deleteAttribute('uv')
  geometry.deleteAttribute('uv1')
  geometry.deleteAttribute('uv2')

  ensureColorAttribute(geometry)

  if (!geometry.getAttribute('aWind')) {
    geometry.setAttribute('aWind', new BufferAttribute(new Float32Array(geometry.getAttribute('position').count), 1))
  }

  return geometry
}

export const mergeParts = (parts: BufferGeometry[], name: string): BufferGeometry => {
  for (const part of parts) {
    normalizeAssetGeometry(part)
    for (const attribute of REQUIRED) {
      if (!part.getAttribute(attribute)) {
        throw new Error(`[world] ${name}: part is missing "${attribute}" before merge`)
      }
    }
  }

  const merged = mergeGeometries(parts, false)
  if (!merged) {
    throw new Error(`[world] ${name}: geometry merge failed — mismatched attributes`)
  }
  merged.computeBoundingSphere()
  merged.computeBoundingBox()
  return merged
}

/**
 * Object-space reach: the distance from the origin to the furthest vertex of
 * **any** tier.
 *
 * This is what `WorldAsset.radius` is supposed to be, and hand-deriving it from
 * the shape description reliably under-reports. Measured across the catalogue,
 * ten of twenty-nine props published a radius short of their own mesh — from
 * 0.5 % on a plateau to **27.7 % on the grass-capped boulder** — because the
 * derivation misses whatever the generator adds *after* it: the section's area
 * inflation, a lump field's peak, a grass cap's 1.03 rim lap, a canopy clump's
 * outermost lobe.
 *
 * The consequence is not cosmetic. The radius drives instanced frustum culling,
 * so a prop whose radius is 27 % short is dropped while a quarter of it is still
 * inside the frustum — it vanishes at the screen edge as the camera pans, which
 * reads as a streaming failure rather than as a culling one.
 *
 * Every tier is measured, not just LOD0. Tiers are size-corrected against *each
 * other* (§4.3), never against the published radius, so the tier that pokes out
 * furthest is routinely a coarse one — the ancient oak's LOD0 reaches 11.11 m
 * and one of its coarse tiers reaches 11.29 m.
 */
export const measuredRadius = (tiers: readonly BufferGeometry[]): number => {
  let furthest = 0
  for (const geometry of tiers) {
    const position = geometry.getAttribute('position')
    const array = position.array as ArrayLike<number>
    for (let i = 0; i < position.count; i++) {
      const x = array[i * 3]!
      const y = array[i * 3 + 1]!
      const z = array[i * 3 + 2]!
      const distanceSq = x * x + y * y + z * z
      if (distanceSq > furthest) {
        furthest = distanceSq
      }
    }
  }
  return Math.sqrt(furthest)
}

/** Vertex range of each part inside the merged buffer, in merge order. */
export const partRanges = (parts: BufferGeometry[]): { start: number; count: number }[] => {
  const ranges: { start: number; count: number }[] = []
  let cursor = 0
  for (const part of parts) {
    const count = part.getAttribute('position').count
    ranges.push({ start: cursor, count })
    cursor += count
  }
  return ranges
}
