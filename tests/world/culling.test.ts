import { Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { classifySphere, INSIDE, INTERSECTS, OUTSIDE } from '@/world/lod/InstancedLodField'

/**
 * The hierarchy's whole benefit rests on `classifySphere` returning INSIDE for
 * cells that are fully contained — that's the case that skips every per-instance
 * plane test. A version that only ever returned INTERSECTS would still render
 * correctly and quietly cost exactly as much as the flat sweep it replaced, so
 * the distinction is pinned here rather than left to a profiler reading.
 */
const frustumFor = (camera: PerspectiveCamera): Frustum => {
  camera.updateMatrixWorld()
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  return new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  )
}

describe('classifySphere', () => {
  const camera = new PerspectiveCamera(55, 16 / 9, 0.5, 1000)
  camera.position.set(0, 0, 0)
  camera.lookAt(new Vector3(0, 0, -1))
  const frustum = frustumFor(camera)

  it('reports a small sphere well inside the frustum as INSIDE', () => {
    expect(classifySphere(frustum, 0, 0, -50, 1)).toBe(INSIDE)
  })

  it('reports a sphere behind the camera as OUTSIDE', () => {
    expect(classifySphere(frustum, 0, 0, 50, 1)).toBe(OUTSIDE)
  })

  it('reports a sphere straddling the near plane as INTERSECTS', () => {
    // Centred just past the near plane but large enough to cross it.
    expect(classifySphere(frustum, 0, 0, -1, 5)).toBe(INTERSECTS)
  })

  it('reports a sphere straddling a side plane as INTERSECTS', () => {
    // At 50 m the 55° vertical FOV at 16:9 gives a half-width of ~46 m, so a
    // sphere centred at −44 with radius 10 spans −54…−34 and crosses the edge.
    // (−30 with radius 10 is *fully* inside — an easy expectation to get wrong,
    // which is exactly why the geometry is spelled out here.)
    expect(classifySphere(frustum, -44, 0, -50, 10)).toBe(INTERSECTS)
    expect(classifySphere(frustum, -30, 0, -50, 10)).toBe(INSIDE)
  })

  it('reports a sphere entirely off to one side as OUTSIDE', () => {
    expect(classifySphere(frustum, -500, 0, -50, 5)).toBe(OUTSIDE)
  })

  it('never claims INSIDE for a sphere that a straight intersection test rejects', () => {
    // Cross-check against three's own predicate over a grid of positions: any
    // sphere three calls non-intersecting must not be classified INSIDE.
    for (let x = -80; x <= 80; x += 20) {
      for (let z = -140; z <= 40; z += 20) {
        const result = classifySphere(frustum, x, 0, z, 6)
        if (result === INSIDE) {
          // A fully-inside sphere is by definition intersecting.
          expect(frustum.intersectsSphere({ center: new Vector3(x, 0, z), radius: 6 } as never)).toBe(true)
        }
      }
    }
  })
})
