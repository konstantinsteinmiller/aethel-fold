/**
 * The intro's sea peek with the real kraken (roadmap #12 × book 3): for its
 * three seconds the paper sea pops up behind the page's top edge, the
 * kraken's crown and sleepy eyes break the surface, it blinks awake, rises
 * with its stubby arms unfurling, peers left and right at the battle, and
 * sinks back — a teaser for the Sea of Paper.
 *
 * It is `KrakenView`'s own rig (the head, face, arms and materials of the
 * book-3 boss page), posed by a puppet boss instead of a fight: the rig's
 * `surface` pose, whose clock we set from `pose.rise`, plus the view's `look`
 * (the head turned) and `sleepy` (eyelids down). The timing stays in pure
 * logic (`seaPeekPose`); this only draws. `IntroView` never changes: the
 * actor comes through `setSeaPeekFactory`, and is only built when the intro
 * plays.
 *
 * Draw cost while it is up: the paper sea (1 mesh) and the kraken rig (head,
 * face parts, the arms' one instanced mesh) — about the placeholder's, and no
 * new program (the rig's materials are the boss page's). Allocation-free.
 */

import { Group, Mesh, type BufferGeometry } from 'three'
import { createBoss } from '../../logic/boss'
import { KRAKEN } from '../../logic/config'
import type { SeaPeekPose } from '../../logic/intro'
import { clamp01, smoothstep } from '../../logic/math'
import { createPaperMaterial, type PaperMaterial } from '../paperMaterial'
import { DESK_Y } from './BookView'
import { KrakenView } from './KrakenView'
import { MONSTER_Z, seaGeometry, type SeaPeekActor, type SeaPeekContext } from './SeaPeekView'

/** The whole peek, next to the page (far behind its top edge: a size up reads at a glance). */
const PEEK_SCALE = 0.95
/** How deep the kraken hides under the paper sea before it rises (rig units). */
const DEEP = 2.9
/** How high it stands at the top of its rise (its eyes clear the tallest wave). */
const TOP = 0.75

export class KrakenPeek implements SeaPeekActor {
  readonly group = new Group()
  private readonly sea: Mesh
  private readonly seaGeo: BufferGeometry
  private readonly seaMat: PaperMaterial
  private readonly kraken: KrakenView
  /** The puppet the rig reads: a kraken boss held in its `surface` pose. */
  private readonly puppet = { boss: createBoss('kraken') }

  constructor(ctx: SeaPeekContext) {
    this.seaMat = createPaperMaterial({ vertexColors: true, grain: 0.05, doubleSided: true })
    this.seaGeo = seaGeometry()
    this.sea = new Mesh(this.seaGeo, this.seaMat)
    this.sea.receiveShadow = true
    this.group.add(this.sea)
    this.kraken = new KrakenView(ctx.sprites, ctx.overlay)
    // The rig stands between the sea's rows, not on the boss page's spot.
    this.kraken.group.position.set(0, -DEEP, MONSTER_Z)
    this.kraken.group.userData.perfTag = 'fold.intro.seaPeek.kraken'
    this.group.add(this.kraken.group)
    this.group.scale.setScalar(PEEK_SCALE)
    this.group.visible = false
    this.group.userData.perfTag = 'fold.intro.seaPeek'
    const b = this.puppet.boss
    b.phase = 'surface'
    b.timing = 1
  }

  update(pose: Readonly<SeaPeekPose>, time: number, dt: number): void {
    const on = pose.on && (pose.sea > 0.002 || pose.rise > 0.002)
    this.group.visible = on
    if (!on) return
    this.group.position.set(pose.x, DESK_Y, pose.z)
    // The paper sea stands up like a pop-up strip.
    this.sea.scale.set(1, Math.max(0.001, pose.sea), 1)
    const r = pose.rise
    const k = this.kraken
    // Up from the deep: first the crown and the sleepy eyes, then the whole head with its arms.
    const peek = smoothstep(0, 0.45, r)
    k.group.position.y = -DEEP + (DEEP + TOP) * peek
    // Its arms unfurl in the second half of the rise (the rig's own surfacing pose).
    const b = this.puppet.boss
    b.phaseTime = KRAKEN.surface * clamp01((r - 0.4) / 0.6)
    // Asleep while it floats up, it blinks awake near the top; sinking, it stays awake.
    const sinking = pose.time > 1.5
    k.sleepy = sinking ? 0 : 1 - smoothstep(0.55, 0.8, r)
    // It peers around at the battle, left and right, once awake.
    k.look = Math.sin(pose.time * 2.2) * 0.5 * smoothstep(0.7, 0.95, r) + pose.sway
    k.update(this.puppet, time, dt)
    k.group.visible = r > 0.002
  }

  dispose(): void {
    this.seaGeo.dispose()
    this.seaMat.dispose()
    this.kraken.dispose()
  }
}
