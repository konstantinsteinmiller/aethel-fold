import type { BufferAttribute, BufferGeometry } from 'three'
import { EYE_VERTICES, HEAD, MOUTH_COLUMNS, MOUTH_VERTICES } from './face'

/**
 * ─── Making a chibi mouth move ──────────────────────────────────────────────
 *
 * Eight vertices out of the ~950 in a figure, rewritten in place so a character
 * looks like they are saying the line on screen instead of staring through it.
 *
 * ── Why vertex writes and not any of the three obvious alternatives ──────────
 *
 * **A jaw bone.** The rig has 19 (`rig.ts`) and none of them is a jaw, and
 * adding one is not free: `BONE_NAMES` is the contract the skeleton, the pose
 * tables, `chibiGeometry`'s weighting and four suites all agree on, and a
 * twentieth entry is a skinning-weight change on every vertex of the head for
 * the benefit of eight of them.
 *
 * **Rebuilding with `MouthStyle: 'open'`.** The style already exists and it is
 * exactly the right shape — but a rebuild is measured at **1.4 ms median, 3.1 ms
 * worst** (`Character.lastRebuildMs`), and speech wants four changes a second.
 * That is a 3 ms hitch several times a second during the one scene where the
 * camera is close enough for a hitch to be obvious.
 *
 * **Morph targets.** The correct engine answer and the wrong one here: a morph
 * attribute is a second full copy of the position buffer (another ~11 KB per
 * figure, on 19 of them) plus a shader permutation, to move eight vertices.
 *
 * So: eight vertices, 24 floats, written straight into the attribute and
 * uploaded as a **sub-range** — see `applyMouth`. No allocation, no new
 * material, no new bone, and nothing at all for the characters not talking.
 *
 * ── The outline does not need a second write ────────────────────────────────
 *
 * The outline hull shares every attribute buffer with the body and owns only its
 * own index (`Character.rebuild`), and the face is *excluded from that index*.
 * So the mouth vertices move and the hull neither follows them nor has to: an
 * extruded mouth line would stand off the head and hide the feature it outlines.
 *
 * ── Only LOD0 has a mouth at all ────────────────────────────────────────────
 *
 * `CHIBI_TIERS[0].face` is the only `true` — from LOD1 out (18 m) the face is
 * gone entirely, because `face.ts` measures its five mouths as indistinguishable
 * past ~3 m. A conversation is a close-up, so this is never the tier in view
 * during the scene it exists for; `captureMouth` returning `null` for a
 * faceless tier is the normal case, not an error.
 */

/**
 * How far the mouth travels between shut and a full open vowel, in metres.
 *
 * 20 mm against a mouth 48 mm wide. Anatomically that is a wide "ah" and it is
 * meant to be: this is a stylised head three heads tall, seen in a shot framed
 * to hold two people, and a naturalistic 6 mm jaw drop at that distance is
 * indistinguishable from a closed mouth.
 */
const OPEN_TRAVEL = 0.02

/**
 * How the travel splits between the lower lip and the upper.
 *
 * A jaw hinges — the skull does not move. The upper lip gets the small share it
 * does only because the whole mouth purses slightly on an open vowel, and
 * because a top edge that is perfectly static while the bottom drops reads as a
 * hole opening in the face rather than a mouth.
 */
const BOTTOM_SHARE = 0.78
const TOP_SHARE = 0.22

/**
 * ─── Staying on the surface of a round head ─────────────────────────────────
 *
 * The lips move along the mouth's own **tangent** frame, not along world up:
 * `face.ts` places its decals by walking a frame across the head's surface, so
 * `up` is already tangent to the skull at the mouth (measured on the shipped
 * figure: `upY` 0.833, `upZ` 0.554 — tilted 34° forward). Sliding along a
 * tangent therefore *follows* the head almost exactly, and the only error is the
 * second-order one: a chord of length `d` across a sphere of radius `r` sits
 * `d²/2r` inside it.
 *
 * ── The version that shipped first, and what it cost ────────────────────────
 *
 * This started as a **linear** push — 0.9 of the drop distance — reasoned from
 * "the head recedes about 13 mm over a 16 mm drop, so push back out by most of
 * that". That reasoning is for a straight drop in *world* space and this is not
 * one. Measured in the browser on the storyteller mid-sentence: the lower lip's
 * distance from the head centre went from 246.5 mm to **259.4 mm** on a head of
 * radius 250 — a mouth hovering 9 mm clear of the face, in a shot framed on that
 * face.
 *
 * The honest correction for a 14 mm slide on a 250 mm head is **0.4 mm**. It is
 * kept rather than dropped because it is one multiply and it is the difference
 * between "provably on the surface" and "close enough at these numbers".
 */
const HEAD_RADIUS = HEAD.radius

/**
 * How much less the corners open than the middle.
 *
 * A mouth is hinged at its corners. At 0.85 the outermost column still travels
 * 15 % of the way, which keeps the shape a mouth rather than a rectangle with a
 * sagging middle.
 */
const CORNER_PIN = 0.85

/**
 * The position attribute, or null if it is not one this can write to.
 *
 * `getAttribute` is typed as possibly returning an `InterleavedBufferAttribute`,
 * which has no `updateRanges` of its own — the sub-range upload lives on the
 * shared buffer underneath it. `chibiGeometry` builds plain, non-interleaved
 * attributes and always has, so rather than write a second upload path for a
 * case that does not occur, this bails and the character simply does not talk.
 */
const positionOf = (geometry: BufferGeometry): BufferAttribute | null => {
  const attribute = geometry.getAttribute('position')
  if (!attribute || (attribute as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) {
    return null
  }
  return attribute as BufferAttribute
}

/**
 * Everything needed to open one character's mouth, measured once.
 *
 * Captured from the built geometry rather than re-derived from `MOUTH_SPECS`, so
 * it stays correct for whichever of the five mouth styles the character was
 * built with, and stays correct if those specs are ever retuned.
 */
export interface MouthRig {
  /** Index of the first mouth vertex in the position attribute. */
  readonly start: number
  /** The 8 built positions, flat xyz. The pose is always written from these. */
  readonly base: Float32Array
  /** Face-local up at the mouth: the axis the lips separate along. */
  readonly upX: number
  readonly upY: number
  readonly upZ: number
  /** Face-local outward normal. Recovered as right x up, signed to face +Z. */
  readonly outX: number
  readonly outY: number
  readonly outZ: number
  /** Last amount written, so an unchanged mouth costs one compare. */
  open: number
  /**
   * The upload window, reused.
   *
   * One long-lived object pushed into `updateRanges` each time rather than
   * `addUpdateRange`, which allocates a fresh `{ start, count }` per call — and
   * this runs in the frame loop, where GDD section 5 allows no allocation.
   */
  readonly range: { start: number; count: number }
}

/**
 * Measures a character's mouth, or returns null if this geometry has no face.
 *
 * @param faceStart `ChibiBlocks.face` — the first vertex of the face block.
 */
export const captureMouth = (geometry: BufferGeometry, faceStart: number): MouthRig | null => {
  const attribute = positionOf(geometry)
  if (!attribute) {
    return null
  }
  const start = faceStart + EYE_VERTICES
  if (start + MOUTH_VERTICES > attribute.count) {
    // A tier built without a face. `CHIBI_TIERS[1..3].face` is false, and the
    // block offsets on those tiers point past the end of a shorter buffer.
    return null
  }

  const base = new Float32Array(MOUTH_VERTICES * 3)
  for (let i = 0; i < MOUTH_VERTICES; i++) {
    base[i * 3] = attribute.getX(start + i)
    base[i * 3 + 1] = attribute.getY(start + i)
    base[i * 3 + 2] = attribute.getZ(start + i)
  }
  return frameFrom(start, base)
}

/**
 * Derives the mouth's own axes from the eight vertices.
 *
 * ── Read out of the shape, not rebuilt from the spec ────────────────────────
 *
 * `face.ts::addMouth` emits column by column, top then bottom, so `up` is the
 * mean of the four top-minus-bottom vectors and `right` runs from the first
 * column to the last. Taking them from the vertices rather than reconstructing
 * the mouth's frame means this file never has to know how `face.ts` orients a
 * decal on the head — only the order it emits them in, which is the one thing
 * that module documents as load-bearing.
 *
 * Every degenerate case returns null rather than a rig with a NaN axis in it.
 * A NaN would propagate into the position buffer on the first write, and a
 * skinned mesh with one NaN vertex does not render a broken mouth — it fails
 * its bounding-sphere test and **the whole character disappears**.
 */
const frameFrom = (start: number, base: Float32Array): MouthRig | null => {
  let upX = 0
  let upY = 0
  let upZ = 0
  for (let c = 0; c < MOUTH_COLUMNS; c++) {
    const top = c * 6
    const bottom = top + 3
    upX += base[top]! - base[bottom]!
    upY += base[top + 1]! - base[bottom + 1]!
    upZ += base[top + 2]! - base[bottom + 2]!
  }
  let length = Math.hypot(upX, upY, upZ)
  if (!(length > 1e-9)) {
    return null
  }
  upX /= length
  upY /= length
  upZ /= length

  const last = (MOUTH_COLUMNS - 1) * 6
  let rightX = base[last]! - base[0]!
  let rightY = base[last + 1]! - base[1]!
  let rightZ = base[last + 2]! - base[2]!
  length = Math.hypot(rightX, rightY, rightZ)
  if (!(length > 1e-9)) {
    return null
  }
  rightX /= length
  rightY /= length
  rightZ /= length

  let outX = rightY * upZ - rightZ * upY
  let outY = rightZ * upX - rightX * upZ
  let outZ = rightX * upY - rightY * upX
  length = Math.hypot(outX, outY, outZ)
  if (!(length > 1e-9)) {
    return null
  }
  outX /= length
  outY /= length
  outZ /= length
  // The rig faces +Z (`rig.ts`), so the face's outward normal does too. Which
  // way round the cross product lands depends on the emit order, and guessing
  // wrong turns the bulge into a dent that swallows the lower lip.
  if (outZ < 0) {
    outX = -outX
    outY = -outY
    outZ = -outZ
  }

  return { start, base, upX, upY, upZ, outX, outY, outZ, open: 0, range: { start: 0, count: 0 } }
}

/**
 * Writes the mouth at `amount` — 0 shut, 1 a full open vowel.
 *
 * Always written *from* `base`, never accumulated onto the previous pose: an
 * incremental version drifts, and the drift is a mouth that slides off the chin
 * over the course of a long conversation.
 *
 * Returns true if anything was written.
 */
export const applyMouth = (rig: MouthRig, geometry: BufferGeometry, amount: number): boolean => {
  const wanted = amount > 0 ? (amount < 1 ? amount : 1) : 0
  if (Math.abs(wanted - rig.open) < 1e-4) {
    return false
  }
  const attribute = positionOf(geometry)
  if (!attribute || rig.start + MOUTH_VERTICES > attribute.count) {
    // The geometry was swapped under us — an equip mid-sentence. `Character`
    // drops the rig on rebuild, so this is belt and braces against the one
    // ordering where a write lands between the swap and the drop.
    return false
  }
  rig.open = wanted

  const travel = wanted * OPEN_TRAVEL
  const { start, base, upX, upY, upZ, outX, outY, outZ } = rig

  for (let c = 0; c < MOUTH_COLUMNS; c++) {
    // −1 at the left corner, +1 at the right. Quadratic, so the pin bites hardest
    // at the corners and does nothing in the middle — the same falloff
    // `face.ts::addMouth` already uses to carry a smile.
    const t = (c / (MOUTH_COLUMNS - 1)) * 2 - 1
    const hinge = 1 - CORNER_PIN * t * t

    for (let row = 0; row < 2; row++) {
      // `dy` is positive up: row 0 is the top edge and rises, row 1 drops.
      const dy = (row === 0 ? TOP_SHARE : -BOTTOM_SHARE) * travel * hinge
      // Outward for either direction — a chord cuts inside the sphere whichever
      // way along it you slide. See the header.
      const bulge = (dy * dy) / (2 * HEAD_RADIUS)
      const i = c * 2 + row
      const b = i * 3
      attribute.setXYZ(
        start + i,
        base[b]! + upX * dy + outX * bulge,
        base[b + 1]! + upY * dy + outY * bulge,
        base[b + 2]! + upZ * dy + outZ * bulge
      )
    }
  }

  // Upload eight vertices, not the whole figure. `updateRanges` is emptied by the
  // renderer after each upload, so the window is re-pushed every time; the
  // explicit truncate covers the frame that is written but never drawn, which
  // would otherwise leave a stale duplicate behind.
  rig.range.start = start * attribute.itemSize
  rig.range.count = MOUTH_VERTICES * attribute.itemSize
  attribute.updateRanges.length = 0
  attribute.updateRanges.push(rig.range)
  attribute.needsUpdate = true
  return true
}
