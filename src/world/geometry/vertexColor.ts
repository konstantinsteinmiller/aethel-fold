import type { BufferGeometry } from 'three'
import { BufferAttribute, Color, Vector3 } from 'three'

/**
 * ─── Vertex colour painting ─────────────────────────────────────────────────
 *
 * With no prop textures anywhere in the world (GDD §5.2), the colour attribute
 * carries everything: base albedo, the AO bake, sun-bleaching on upward faces,
 * and the deep-interior tint on foliage. These helpers compose onto whatever is
 * already in the attribute, so a generator reads as a stack of paint passes.
 *
 * Colours written here are in the renderer's linear working space — a
 * `THREE.Color` built from an sRGB hex has already been converted, so just
 * read `.r/.g/.b` off it and don't "correct" anything by hand.
 */

const _v = new Vector3()
const _c = new Color()

/** Creates the colour attribute (white) if the geometry doesn't have one yet. */
export const ensureColorAttribute = (geometry: BufferGeometry): BufferAttribute => {
  const existing = geometry.getAttribute('color') as BufferAttribute | undefined
  if (existing) {
    return existing
  }
  const count = geometry.getAttribute('position').count
  const array = new Float32Array(count * 3).fill(1)
  const attribute = new BufferAttribute(array, 3)
  geometry.setAttribute('color', attribute)
  return attribute
}

/** Flat base coat. Every paint stack starts here. */
export const paintUniform = (geometry: BufferGeometry, color: Color): BufferGeometry => {
  const attribute = ensureColorAttribute(geometry)
  const array = attribute.array as Float32Array
  for (let i = 0; i < attribute.count; i++) {
    array[i * 3] = color.r
    array[i * 3 + 1] = color.g
    array[i * 3 + 2] = color.b
  }
  attribute.needsUpdate = true
  return geometry
}

/**
 * Vertical gradient in object space. Roots darker than crowns, rock bases
 * dirtier than tops — the cheapest possible "this object sits in a world"
 * signal, and it survives all four LOD tiers unchanged.
 */
export const paintByHeight = (
  geometry: BufferGeometry,
  low: Color,
  high: Color,
  options: { min?: number; max?: number; curve?: number } = {}
): BufferGeometry => {
  const position = geometry.getAttribute('position')
  const attribute = ensureColorAttribute(geometry)
  const array = attribute.array as Float32Array

  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const { min = box.min.y, max = box.max.y, curve = 1 } = options
  const span = max - min || 1

  for (let i = 0; i < position.count; i++) {
    let t = (position.getY(i) - min) / span
    t = t < 0 ? 0 : t > 1 ? 1 : t
    if (curve !== 1) {
      t = t ** curve
    }
    _c.copy(low).lerp(high, t)
    array[i * 3] = _c.r
    array[i * 3 + 1] = _c.g
    array[i * 3 + 2] = _c.b
  }
  attribute.needsUpdate = true
  return geometry
}

/**
 * Sun-bleaching: mix `top` into faces that point up, by `normal.y ^ power`.
 *
 * This is doing the job a sky-light bounce would do in a PBR renderer, for
 * free, and it's most of why the rocks don't read as grey blobs.
 */
export const paintByUpness = (geometry: BufferGeometry, top: Color, amount = 0.5, power = 2): BufferGeometry => {
  const normal = geometry.getAttribute('normal')
  const attribute = ensureColorAttribute(geometry)
  const array = attribute.array as Float32Array

  for (let i = 0; i < normal.count; i++) {
    const up = Math.max(0, normal.getY(i))
    const t = up ** power * amount
    _c.setRGB(array[i * 3]!, array[i * 3 + 1]!, array[i * 3 + 2]!).lerp(top, t)
    array[i * 3] = _c.r
    array[i * 3 + 1] = _c.g
    array[i * 3 + 2] = _c.b
  }
  attribute.needsUpdate = true
  return geometry
}

/**
 * Bakes an accessibility array from `bakeVertexAO` into the colour attribute by
 * pulling occluded vertices toward `deep` rather than toward black — a black
 * multiply desaturates into mud and fights the no-black-shadows rule (GDD R4).
 *
 * `range` restricts the write to a slice of vertices. That exists because AO is
 * baked on the *merged* asset — so a canopy actually occludes the trunk beneath
 * it — but the two parts must then resolve toward different deep colours, or
 * the trunk picks up the foliage's green in its crevices.
 */
export const applyVertexAO = (
  geometry: BufferGeometry,
  ao: Float32Array,
  deep: Color,
  amount = 1,
  range?: { start: number; count: number }
): BufferGeometry => {
  const attribute = ensureColorAttribute(geometry)
  const array = attribute.array as Float32Array
  const limit = Math.min(attribute.count, ao.length)
  const start = range ? Math.max(0, range.start) : 0
  const count = range ? Math.min(limit, range.start + range.count) : limit

  for (let i = start; i < count; i++) {
    const t = (1 - ao[i]!) * amount
    _c.setRGB(array[i * 3]!, array[i * 3 + 1]!, array[i * 3 + 2]!).lerp(deep, t)
    array[i * 3] = _c.r
    array[i * 3 + 1] = _c.g
    array[i * 3 + 2] = _c.b
  }
  attribute.needsUpdate = true
  return geometry
}

/**
 * Radial tint from a point — foliage clumps get their deep interior colour this
 * way on the LOD tiers that are too coarse for a meaningful AO bake.
 */
export const paintRadial = (
  geometry: BufferGeometry,
  center: Vector3,
  inner: Color,
  outer: Color,
  radius: number
): BufferGeometry => {
  const position = geometry.getAttribute('position')
  const attribute = ensureColorAttribute(geometry)
  const array = attribute.array as Float32Array
  const invRadius = 1 / (radius || 1)

  for (let i = 0; i < position.count; i++) {
    _v.fromBufferAttribute(position, i).sub(center)
    let t = _v.length() * invRadius
    t = t < 0 ? 0 : t > 1 ? 1 : t
    _c.copy(inner).lerp(outer, t)
    array[i * 3] = _c.r
    array[i * 3 + 1] = _c.g
    array[i * 3 + 2] = _c.b
  }
  attribute.needsUpdate = true
  return geometry
}

/**
 * Per-vertex hue/value jitter. Two identical instanced trees side by side are
 * the fastest way to make a forest look procedurally generated; a couple of
 * percent of noise in the albedo breaks it up before instance-level tinting
 * even gets involved.
 */
export const jitterColor = (geometry: BufferGeometry, rng: () => number, amount = 0.05): BufferGeometry => {
  const attribute = ensureColorAttribute(geometry)
  const array = attribute.array as Float32Array
  for (let i = 0; i < attribute.count; i++) {
    const k = 1 + (rng() * 2 - 1) * amount
    array[i * 3] = Math.min(1, array[i * 3]! * k)
    array[i * 3 + 1] = Math.min(1, array[i * 3 + 1]! * k)
    array[i * 3 + 2] = Math.min(1, array[i * 3 + 2]! * k)
  }
  attribute.needsUpdate = true
  return geometry
}
