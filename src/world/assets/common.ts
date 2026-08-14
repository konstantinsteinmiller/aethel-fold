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
