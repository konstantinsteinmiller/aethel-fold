import {
  type BufferGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type Mesh,
  type Object3D
} from 'three'
import type { OutlineMaterial } from '../shading/outlineMaterial'
import type { ToonMaterial } from '../shading/toonMaterial'

/**
 * ─── One draw for every hat in the town ─────────────────────────────────────
 *
 * Socketed gear — a hat, a sword, a shield — is two draws per item per wearer,
 * and forty town guards wear *the same helmet*: literally the same
 * `BufferGeometry`, because `gearModel` caches per kind and colourway. This
 * draws each distinct item once for everyone carrying it.
 *
 * ── What it is actually worth ───────────────────────────────────────────────
 *
 * A/B'd inside one build (`?gearinst=0` / `?gearinst=1`) on a guard-heavy town
 * of 56 spawns — the worst case, because guards and knights carry two and three
 * socketed items where a mage carries none:
 *
 *   | figures | gear          | draws | tris   | programs |
 *   |--------:|---------------|------:|-------:|---------:|
 *   |       0 | —             |   132 | 126.0k |       19 |
 *   |       8 | per-character |   202 | 168.2k |       25 |
 *   |       8 | **instanced** |   190 | 172.1k |       22 |
 *   |      12 | per-character |   232 | 187.3k |       25 |
 *   |      12 | **instanced** |   206 | 192.2k |       22 |
 *   |      16 | instanced     |   218 | 213.0k |       22 |
 *
 * **−12 draws at eight figures, −26 at twelve, and −3 programs at any size.**
 * The programs are the part that does not depend on crowd size and does not go
 * away: GDD §5.2 calls shader compilation the top cause of first-play jank.
 *
 * The shape of the win is the thing to understand. Batches are a **fixed** cost
 * — 20 to 22 draws whatever the crowd is doing — and each extra figure then
 * costs only its body and shadow. Measured marginal cost per figure: **7.25
 * draws** from 0→8, **4.0** from 8→12, **3.0** from 12→16. Per-character gear
 * is flat at ~8.3. So this is worth least at the crowd size the draw budget
 * currently allows and worth more at every size above it.
 *
 * It did **not** double the crowd budget, which is what was predicted before it
 * was measured. `DEFAULT_CROWD_BUDGET` stays at eight, and the note there says
 * why.
 *
 * ── Where the remaining dilution is ─────────────────────────────────────────
 *
 * Thirty-six items resolve to only **ten** batches, and they would resolve to
 * about four if the wearer's `gearSeed` did not also vary their *hardware*. It
 * does: `gearModel(kind, seed)` gives two guards in different livery two
 * different helmets, so they cannot share a batch. Whether steel should take a
 * dye at all is a look decision, not a performance one, so it is recorded here
 * rather than taken — the price of the current answer is roughly twelve draws.
 *
 * ── Why gear can be instanced when the body cannot ──────────────────────────
 *
 * A body is skinned: every vertex is a weighted blend of bone matrices, so two
 * characters in different poses cannot share a draw however identical their
 * geometry. Gear is **parented, not skinned** (`CharacterEquipment` is explicit
 * about this) — a sword is rigid and its whole pose is one matrix. That is
 * exactly what an `InstancedMesh` takes, so the thing that makes gear cheap to
 * attach is the same thing that makes it cheap to batch.
 *
 * ── How the transform gets here ─────────────────────────────────────────────
 *
 * The item's object stays parented to its bone and keeps its socket offset and
 * grip rotation — none of that logic moves. It is simply made **invisible** and
 * its `matrixWorld` is copied into the batch each frame. That is the whole
 * mechanism, and it is deliberate: socketing, the draw/stow handover and the
 * grip rotation are subtle, measured code, and an instancer that re-derived them
 * would be a second implementation to keep in step.
 *
 * `updateWorldMatrix(true, false)` on each item is what makes the matrix *this*
 * frame's rather than last frame's. Three only refreshes the graph inside
 * `render()`, which runs after this — without the explicit walk, gear would
 * trail the hand holding it by one frame, which at a run is a visibly detached
 * sword.
 *
 * ── Repacked wholesale, not spliced ─────────────────────────────────────────
 *
 * Every frame every live item is written from index 0. The alternative — a free
 * list with stable slots — buys nothing here: the crowd is tens of items, not
 * thousands, and a stable index would still need the matrix rewritten every
 * frame because the wearer is moving. `InstancedLodField` reaches the same
 * conclusion for the same reason.
 */

/**
 * Instances a batch starts with, and the factor it grows by.
 *
 * An `InstancedMesh` cannot be resized, so growing means building a new one.
 * Eight is the default crowd budget, so the common case allocates once and never
 * again; doubling keeps a market square from reallocating per villager.
 */
const INITIAL_CAPACITY = 8

interface Batch {
  mesh: InstancedMesh
  outline: InstancedMesh | null
  /** The `instanceMatrix` array, shared with `outline`. Written directly. */
  matrices: Float32Array
  capacity: number
  /** Live instances this frame. Reset to 0 at the top of every `update`. */
  count: number
}

interface Entry {
  /** The invisible carrier parented to the bone. Its `matrixWorld` is the pose. */
  object: Object3D
  geometry: BufferGeometry
}

export interface GearInstancerOptions {
  /** The shared gear toon material. One per scene — see `CharacterEquipment`. */
  material: ToonMaterial
  /** The shared outline material, or null to draw gear without a hull. */
  outline: OutlineMaterial | null
  castShadow?: boolean
}

export class GearInstancer {
  /** Add this to the scene. Every batch lives under it. */
  readonly group = new Group()

  private readonly material: ToonMaterial
  private readonly outlineMaterial: OutlineMaterial | null
  private readonly castShadow: boolean

  /**
   * Keyed by **geometry identity**, not by item kind.
   *
   * That is the correct key and a kind is not: `gearModel` hands back the same
   * buffer for two variants a model does not actually vary on — a sword ignores
   * skin tone — so keying by kind-and-variant would split one batch in two that
   * draw the same triangles. Keying by the object about to be drawn cannot get
   * that wrong.
   */
  private readonly batches = new Map<BufferGeometry, Batch>()
  private readonly entries = new Map<number, Entry>()
  private nextHandle = 1

  constructor(options: GearInstancerOptions) {
    this.material = options.material
    this.outlineMaterial = options.outline
    this.castShadow = options.castShadow ?? true
    this.group.name = 'gear-instances'
    this.group.userData.perfTag = 'npc'
  }

  /** Live batches. One or two draws each — the number to judge this by. */
  get batchCount(): number {
    return this.batches.size
  }

  /** Items currently drawn through a batch. */
  get instanceCount(): number {
    return this.entries.size
  }

  /**
   * Takes over drawing for `object`, which must already carry its geometry.
   *
   * The caller keeps ownership of the object and its place in the bone
   * hierarchy; this only hides it and starts copying its matrix. Returns a
   * handle for `release`.
   */
  register(object: Mesh): number {
    const handle = this.nextHandle++
    // The carrier still has to be *in* the graph for its world matrix to mean
    // anything — it is hidden, not detached.
    object.visible = false
    this.entries.set(handle, { object, geometry: object.geometry })
    this.batchFor(object.geometry)
    return handle
  }

  release(handle: number): void {
    const entry = this.entries.get(handle)
    if (!entry) {
      return
    }
    this.entries.delete(handle)
    // The batch is deliberately kept. A villager who takes a hat off is very
    // likely to be followed by one putting the same hat on, and an empty batch
    // costs one `InstancedMesh` with `count = 0`, which three skips entirely.
    entry.object.visible = true
  }

  /**
   * Writes every live item's world matrix into its batch.
   *
   * Call once per frame **after** the characters have posed and **before**
   * render.
   */
  update(): void {
    for (const batch of this.batches.values()) {
      batch.count = 0
    }

    for (const entry of this.entries.values()) {
      // This frame's pose, not last frame's — see the header.
      entry.object.updateWorldMatrix(true, false)
      let batch = this.batchFor(entry.geometry)
      if (batch.count >= batch.capacity) {
        this.grow(entry.geometry, batch.capacity * 2)
        // `grow` replaces the batch object, so re-read it before writing.
        batch = this.batches.get(entry.geometry)!
      }
      entry.object.matrixWorld.toArray(batch.matrices, batch.count * 16)
      batch.count++
    }

    for (const batch of this.batches.values()) {
      batch.mesh.count = batch.count
      batch.mesh.visible = batch.count > 0
      batch.mesh.instanceMatrix.needsUpdate = true
      // Invalidated, not recomputed here: three recomputes a null sphere inside
      // its own frustum test, so a batch that ends up culled anyway never pays
      // for one. Without this the sphere is whatever the instances happened to
      // span on the frame it was first computed, and a crowd that walked away
      // would keep drawing.
      batch.mesh.boundingSphere = null
      if (batch.outline) {
        batch.outline.count = batch.count
        batch.outline.visible = batch.count > 0
        // `instanceMatrix` is the *same object* as the mesh's, so flagging it
        // twice is one upload, not two.
        batch.outline.instanceMatrix.needsUpdate = true
        batch.outline.boundingSphere = null
      }
    }
  }

  private batchFor(geometry: BufferGeometry): Batch {
    const existing = this.batches.get(geometry)
    if (existing) {
      return existing
    }
    const batch = this.build(geometry, INITIAL_CAPACITY)
    this.batches.set(geometry, batch)
    return batch
  }

  /**
   * Rebuilds a batch at a larger capacity, carrying the instances already
   * written this frame across.
   *
   * The copy matters: `update` grows mid-loop, and without it every item packed
   * before the growth would be dropped for that frame — a batch that briefly
   * drew only its newest member.
   */
  private grow(geometry: BufferGeometry, capacity: number): void {
    const old = this.batches.get(geometry)
    const fresh = this.build(geometry, capacity)
    if (old) {
      fresh.matrices.set(old.matrices.subarray(0, old.count * 16))
      fresh.count = old.count
      this.destroy(old)
    }
    this.batches.set(geometry, fresh)
  }

  private build(geometry: BufferGeometry, capacity: number): Batch {
    // Cloned so this instancer owns the `aFade` attribute. The clone shares the
    // source's attribute buffers, so it is a descriptor rather than a second
    // copy of the vertices — the same trick `InstancedLodField` uses.
    const instanced = geometry.clone()
    const fadeArray = new Float32Array(capacity)
    // Solid, always. Gear does not crossfade — an item is either in the scene or
    // it is not — but **both** the toon and the outline shader declare `aFade`
    // under `USE_INSTANCING` and read it unconditionally. Leaving it at the
    // zero-filled default draws every hat fully transparent, which looks exactly
    // like the instancer silently not working.
    fadeArray.fill(1)
    const fade = new InstancedBufferAttribute(fadeArray, 1)
    fade.setUsage(DynamicDrawUsage)
    instanced.setAttribute('aFade', fade)

    const mesh = new InstancedMesh(instanced, this.material, capacity)
    mesh.name = 'gear/instances'
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.count = 0
    mesh.visible = false
    mesh.castShadow = this.castShadow
    mesh.receiveShadow = true
    // ── Culled, unlike `InstancedLodField`'s batches ────────────────────────
    //
    // That field turns culling off because its bounding sphere would have to be
    // recomputed from thousands of instances every repack. This one has tens,
    // and turning culling off measurably cost: A/B'd in one build on a
    // guard-heavy crowd, uncullable batches drew **173.3k triangles against
    // 168.2k** for per-character gear — every hat in the town drawing whether or
    // not it was on screen, which ate most of the draw-call win.
    //
    // `update` nulls `boundingSphere` after packing; three recomputes it from
    // the live `instanceMatrix` on the next frustum test, which is 36 sphere
    // unions and is not measurable.
    mesh.frustumCulled = true
    mesh.userData.perfTag = 'npc'
    this.group.add(mesh)

    let outline: InstancedMesh | null = null
    if (this.outlineMaterial) {
      outline = new InstancedMesh(instanced, this.outlineMaterial, capacity)
      outline.name = 'gear/instances/outline'
      // Shared, not copied: same GPU memory, bound twice, one update feeds both
      // draws.
      outline.instanceMatrix = mesh.instanceMatrix
      outline.count = 0
      outline.visible = false
      // A hull is a shell a few pixels outside the item, so its shadow would
      // fight the item's own along every silhouette edge.
      outline.castShadow = false
      outline.receiveShadow = false
      outline.frustumCulled = true
      outline.renderOrder = 1
      outline.userData.perfTag = 'npc'
      this.group.add(outline)
    }

    return {
      mesh,
      outline,
      matrices: mesh.instanceMatrix.array as Float32Array,
      capacity,
      count: 0
    }
  }

  private destroy(batch: Batch): void {
    this.group.remove(batch.mesh)
    if (batch.outline) {
      this.group.remove(batch.outline)
      batch.outline.dispose()
    }
    // `InstancedMesh.dispose` frees the instance buffers; the geometry disposed
    // after it is the *cloned descriptor*, not the shared source — so this frees
    // the `aFade` attribute and leaves every character's copy of the item's
    // vertices intact.
    const descriptor = batch.mesh.geometry
    batch.mesh.dispose()
    descriptor.dispose()
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      entry.object.visible = true
    }
    this.entries.clear()
    for (const batch of this.batches.values()) {
      this.destroy(batch)
    }
    this.batches.clear()
    this.group.removeFromParent()
  }
}
