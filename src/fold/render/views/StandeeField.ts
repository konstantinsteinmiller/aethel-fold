/**
 * Instanced paper standees (one draw call for every knight, brute, archer and
 * cheering paper person on the page). Each instance carries its atlas frame
 * in `aFrame`; the matrix does the acting — walk rock, hop, launch spin, the
 * crush that lays it flat on the page, and the "pop up from flat" on spawn.
 */

import {
  BufferGeometry, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, PlaneGeometry
} from 'three'
import type { FrameName, StandeeAtlas } from '../art/standeeArt'
import { createCutoutDepthMaterial, createPaperMaterial, type PaperMaterial } from '../paperMaterial'
import { TMP } from '../paperGeometry'

/** Standee height in page units for size 1 (a knight is ~1 unit tall). */
export const STANDEE_H = 1.3
const STANDEE_W = (STANDEE_H * 128) / 192
/** Backward lean of every upright standee (radians). */
export const STANDEE_LEAN = -0.62

let sharedGeometry: BufferGeometry | null = null
const standeeGeometry = (): BufferGeometry => {
  if (!sharedGeometry) {
    const g = new PlaneGeometry(STANDEE_W, STANDEE_H)
    g.translate(0, STANDEE_H / 2, 0)
    g.userData.shared = true
    sharedGeometry = g
  }
  return sharedGeometry
}

export class StandeeField {
  readonly mesh: InstancedMesh
  readonly material: PaperMaterial
  private readonly frames: InstancedBufferAttribute
  private readonly frameOf: (FrameName | null)[]
  private readonly white = new Color(1, 1, 1)

  constructor(private readonly atlas: StandeeAtlas, readonly capacity: number) {
    this.material = createPaperMaterial({
      map: atlas.texture, atlas: true, alphaTest: 0.5, doubleSided: true, backTint: '#f6efe0', grain: 0.02
    })
    const geo = standeeGeometry().clone()
    this.frames = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
    this.frames.setUsage(DynamicDrawUsage)
    geo.setAttribute('aFrame', this.frames)
    this.mesh = new InstancedMesh(geo, this.material, capacity)
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = false
    this.mesh.frustumCulled = false
    this.mesh.customDepthMaterial = createCutoutDepthMaterial(atlas.texture)
    this.frameOf = new Array<FrameName | null>(capacity).fill(null)
    for (let i = 0; i < capacity; i++) {
      this.hide(i)
      this.mesh.setColorAt(i, this.white)
    }
    this.mesh.instanceColor!.setUsage(DynamicDrawUsage)
  }

  setFrame(i: number, name: FrameName): void {
    if (this.frameOf[i] === name) return
    this.frameOf[i] = name
    const f = this.atlas.frame(name)
    this.frames.setXYZW(i, f.u0, f.v0, f.u1, f.v1)
    this.frames.needsUpdate = true
  }

  hide(i: number): void {
    TMP.m.makeScale(0, 0, 0)
    this.mesh.setMatrixAt(i, TMP.m)
  }

  /**
   * Place an instance: position, yaw (face), roll (rock), pitch (0 standing,
   * −π/2 lying flat), uniform scale and vertical squash.
   */
  place(i: number, x: number, y: number, z: number, yaw: number, roll: number, pitch: number, scale: number, squashY = 1): void {
    // Paper standees lean back toward the lens: seen from a steep desk camera
    // a bolt-upright cut-out would foreshorten to a sliver. Lying-flat poses
    // (pitch ≤ −1.2) are left alone.
    const p = pitch > -1.2 ? pitch + STANDEE_LEAN * (1 + Math.min(0, pitch) / 1.2) : pitch
    TMP.e.set(p, yaw, roll, 'YXZ')
    TMP.q.setFromEuler(TMP.e)
    TMP.p.set(x, y, z)
    TMP.s.set(scale, scale * squashY, scale)
    TMP.m.compose(TMP.p, TMP.q, TMP.s)
    this.mesh.setMatrixAt(i, TMP.m)
  }

  tint(i: number, r: number, g: number, b: number): void {
    TMP.c.setRGB(r, g, b)
    this.mesh.setColorAt(i, TMP.c)
  }

  commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
    ;(this.mesh.customDepthMaterial as { dispose?: () => void } | undefined)?.dispose?.()
    this.mesh.dispose()
  }
}
