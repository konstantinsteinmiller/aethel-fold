import { CylinderGeometry, Group, Mesh, MeshBasicMaterial, type Object3D } from 'three'
import { C } from '../art/palette'
import type { PlacementBrush } from '../editor/LevelEditor'
import { PROFESSIONS, type Profession } from '../characters/professions'
import { FIGURE_HEIGHT } from '../characters/rig'
import type { Crowd } from './Crowd'
import { NpcStore, saveSpawns, type NpcSpawn } from './spawns'

/**
 * ─── Placing people ─────────────────────────────────────────────────────────
 *
 * The editor tool. Implements `PlacementBrush`, so it borrows the level
 * editor's crosshair rather than growing a second raycaster — see
 * `LevelEditor.setBrush` for that argument.
 *
 * ── Why the preview is a post and not a person ──────────────────────────────
 *
 * The obvious preview is the figure itself, translucent. It is the wrong one.
 * Building a character to preview it is a ~1.4 ms body rebuild *per profession
 * change*, and the ghost follows the crosshair every frame — so it would either
 * rebuild constantly or be stale. Worse, it answers the wrong question: what a
 * designer is judging while placing a crowd is **where people are and which way
 * they face**, not what this particular farmer's hair looks like. A capped post
 * at figure height with a nose on it answers exactly that, costs one draw, and
 * never needs rebuilding.
 *
 * The real figure appears the moment the click lands, because `Crowd` picks up
 * the store's revision on its next search.
 */

/** Radius of the marker post. Narrow enough to see the ground around it. */
const POST_RADIUS = 0.16
/** How close a click has to be to an existing spawn to mean *that one*. */
const PICK_RADIUS = 0.9

export class NpcBrush implements PlacementBrush {
  /** Add this to the editor's group. Holds the preview and nothing else. */
  readonly group = new Group()

  private readonly store: NpcStore
  private readonly crowd: Crowd | null
  private readonly marker: Object3D
  private readonly nose: Mesh
  private profession: Profession | null = null
  /**
   * The seed the next spawn will get.
   *
   * Incremented on every placement, so clicking eight times along a wall
   * produces eight different guards rather than the same guard eight times. It
   * is *not* random: the whole point of `professions.ts` deriving a person from
   * an integer is that the same level file yields the same town, and a random
   * seed at placement time would put a different person in the diff every run.
   */
  private nextSeed = 0

  constructor(store: NpcStore, crowd: Crowd | null = null) {
    this.store = store
    this.crowd = crowd
    this.group.name = 'npc-brush'

    const material = new MeshBasicMaterial({
      color: C.skyHorizon,
      transparent: true,
      opacity: 0.45,
      // Without this the preview writes depth and punches a hole through
      // whatever it overlaps, which reads as the spawn already being placed.
      depthWrite: false,
      fog: false
    })
    const post = new Mesh(new CylinderGeometry(POST_RADIUS, POST_RADIUS * 1.2, FIGURE_HEIGHT, 10, 1, false), material)
    post.position.y = FIGURE_HEIGHT / 2
    post.castShadow = false
    post.receiveShadow = false

    // A wedge on the +Z face, because a spawn has a *facing* and a plain
    // cylinder cannot show one. `rotationY` from the editor's wheel turns the
    // whole marker, so which way the villager will look is visible before the
    // click rather than discovered afterwards.
    this.nose = new Mesh(new CylinderGeometry(0, POST_RADIUS * 0.9, POST_RADIUS * 2.4, 4, 1, false), material)
    this.nose.rotation.x = Math.PI / 2
    this.nose.position.set(0, FIGURE_HEIGHT * 0.72, POST_RADIUS * 1.4)
    this.nose.castShadow = false
    this.nose.receiveShadow = false

    const marker = new Group()
    marker.add(post)
    marker.add(this.nose)
    marker.visible = false
    this.marker = marker
    this.group.add(marker)
  }

  /** Which role the next click places, or null to put the tool away. */
  select(profession: Profession | null): void {
    this.profession = profession
    if (!profession) {
      this.marker.visible = false
    }
  }

  selected(): Profession | null {
    return this.profession
  }

  place(x: number, y: number, z: number, rotationY: number): string | null {
    if (!this.profession) {
      return null
    }
    const spawn = this.store.add({
      profession: this.profession,
      x,
      y,
      z,
      facingDeg: (rotationY * 180) / Math.PI,
      seed: this.nextSeed++
    })
    saveSpawns(this.store)
    // The crowd searches on a throttle; a spawn placed under the crosshair has
    // to stand up now, not up to 0.4 s later.
    this.crowd?.invalidate()
    return `${PROFESSIONS[spawn.profession].label} #${spawn.seed}`
  }

  /**
   * Removes the nearest spawn within `PICK_RADIUS` of the crosshair.
   *
   * Nearest rather than first, and radius-limited rather than "whatever is
   * closest": a click on empty ground must fall through to the placement list,
   * or the NPC tool would swallow every attempt to delete the platform the
   * villagers are standing on.
   */
  removeAt(x: number, _y: number, z: number, valid: boolean): boolean {
    if (!this.profession || !valid) {
      return false
    }
    let best: NpcSpawn | null = null
    let bestSq = PICK_RADIUS * PICK_RADIUS
    for (const spawn of this.store.view()) {
      const dx = spawn.x - x
      const dz = spawn.z - z
      const distanceSq = dx * dx + dz * dz
      if (distanceSq <= bestSq) {
        bestSq = distanceSq
        best = spawn
      }
    }
    if (!best) {
      return false
    }
    this.store.remove(best.id)
    saveSpawns(this.store)
    this.crowd?.invalidate()
    return true
  }

  preview(x: number, y: number, z: number, valid: boolean, rotationY: number): void {
    const show = valid && this.profession !== null
    this.marker.visible = show
    if (!show) {
      return
    }
    this.marker.position.set(x, y, z)
    this.marker.rotation.y = rotationY
  }

  onDeselect(): void {
    this.marker.visible = false
  }

  dispose(): void {
    this.marker.traverse(node => {
      const mesh = node as Mesh
      mesh.geometry?.dispose()
    })
    // One shared material across both meshes — disposed once, from the nose,
    // rather than once per mesh in the traverse above.
    ;(this.nose.material as MeshBasicMaterial).dispose()
    this.group.removeFromParent()
  }
}
