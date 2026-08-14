import { Vector3 } from 'three'
import {
  DEFAULT_HEIGHTFIELD_PARAMS,
  type HeightfieldParams,
  heightAtCore,
  normalAtCore
} from './heightfieldCore'

/**
 * ─── The heightfield ────────────────────────────────────────────────────────
 *
 * Main-thread face of `heightfieldCore`. The maths lives there, three.js-free,
 * so the terrain worker can run the identical function without dragging a
 * second copy of three into its bundle — see that file's notes.
 *
 * This wrapper exists because the rest of the world wants `Vector3`s and a
 * stateful object: the camera's ground clamp, scatter placement, the level
 * editor's aim march and the player's collision all sample it every frame.
 *
 * The function is pure and continuous, which is what makes the chunked LOD work
 * at all: every tier samples the *same* field, so a 6×6 chunk and a 24×24 chunk
 * describe the same hill, and normals come from its analytic gradient rather
 * than from the tessellated mesh — mesh normals depend on tessellation, so a
 * coarse chunk would shade differently from a fine one and the terrain would
 * flash a new lighting solution at every LOD boundary.
 */

const _sample = new Vector3()
const _normalOut = new Float32Array(3)

export interface HeightfieldOptions {
  seed?: number
  /** Peak-to-trough range of the large hills, in metres. */
  amplitude?: number
  /** Metres per unit of the primary noise. Larger = broader hills. */
  featureSize?: number
  /** Radius of the damped starting area. */
  plainRadius?: number
}

export class Heightfield {
  /** Passed to the worker verbatim, so both sides generate the same world. */
  readonly params: HeightfieldParams

  constructor(options: HeightfieldOptions = {}) {
    this.params = {
      seed: options.seed ?? DEFAULT_HEIGHTFIELD_PARAMS.seed,
      amplitude: options.amplitude ?? DEFAULT_HEIGHTFIELD_PARAMS.amplitude,
      featureSize: options.featureSize ?? DEFAULT_HEIGHTFIELD_PARAMS.featureSize,
      plainRadius: options.plainRadius ?? DEFAULT_HEIGHTFIELD_PARAMS.plainRadius
    }
  }

  get seed(): number {
    return this.params.seed
  }

  heightAt(x: number, z: number): number {
    return heightAtCore(x, z, this.params)
  }

  normalAt(x: number, z: number, out: Vector3, epsilon = 0.75): Vector3 {
    normalAtCore(x, z, this.params, _normalOut, 0, epsilon)
    return out.set(_normalOut[0]!, _normalOut[1]!, _normalOut[2]!)
  }

  /** 0 = flat, 1 = vertical. */
  slopeAt(x: number, z: number): number {
    this.normalAt(x, z, _sample)
    return 1 - Math.max(0, _sample.y)
  }
}
