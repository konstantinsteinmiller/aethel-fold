import { Box3, Color, Mesh, PerspectiveCamera, Scene, Vector2, Vector3 } from 'three'
import { C } from '../../art/palette'
import { createLightRig } from '../../core/lighting'
import { createRenderer, resizeRenderer } from '../../core/renderer'
import { triangleCount } from '../../geometry/budget'
import { updateUnitsPerPixel, worldUniforms } from '../../shading/globals'
import { createOutlineMaterial } from '../../shading/outlineMaterial'
import { createToonMaterial } from '../../shading/toonMaterial'
import { buildChibiGeometry } from '../chibiGeometry'
import { EQUIPMENT_BUDGET, type ItemKind } from '../equipment'
import { windingDisagreements } from './gearKit'
import { GEAR_BUILDERS, hatHeadClearance, torsoArmourMargin } from './index'

/**
 * ─── Gear bench ─────────────────────────────────────────────────────────────
 *
 * A dev-only page for looking at the seven equipment models under the world's
 * *real* shading — the same toon ramp, the same cascaded sun, the same
 * inverted-hull outline at 1.6 screen px. Not part of the app and not routed:
 * open `/src/world/characters/gear/bench.html` on the dev server.
 *
 * It exists because a triangle count and a winding assertion cannot see the
 * things that actually go wrong with a held prop: a blade whose painted fuller
 * lands in the same toon band as its flats, a brim whose underside falls into
 * the shadow band as a black disc, an outline that reads as a sticker at this
 * scale. Every one of those passes every test in `tests/world/gear.test.ts`.
 *
 * Query string:
 *   (default)        the contact sheet, all seven, read from −X
 *   `?item=sword`    one model filling the frame
 *   `&spin=1`        three-quarter view instead of the flat portrait
 *   `&body=1`        the chibi body, aligned to the item's own anchor
 */

const canvas = document.getElementById('bench') as HTMLCanvasElement
const renderer = createRenderer({ canvas, shadows: true })
const scene = new Scene()
scene.background = new Color(C.skyHorizon)

const camera = new PerspectiveCamera(38, 1, 0.05, 60)
const rig = createLightRig(scene, { camera, shadowMaxFar: 24 })
// The bench frames props at half a metre, not a valley. At the world's density
// the whole contact sheet would sit behind 30 cm of haze.
scene.fog = null

const params = new URLSearchParams(location.search)
const single = params.get('item') as ItemKind | null
const spin = params.get('spin') === '1'

const material = createToonMaterial({ name: 'gear-bench', rimStrength: 0.5, shadowTintMix: 0.32 })
const outlineMaterial = createOutlineMaterial({ pixelWidth: 1.6, name: 'gear-bench-outline' })

const KINDS = Object.keys(GEAR_BUILDERS) as ItemKind[]
const report: string[] = []
const bounds = new Box3()
const _size = new Vector3()

const add = (kind: ItemKind, z: number): number => {
  const model = GEAR_BUILDERS[kind]({ seed: 1 })
  const mesh = new Mesh(model.geometry, material)
  // Spread along **Z**, viewed from −X. The row has to run across the viewing
  // axis, and −X is the viewing axis because that is the portrait bearing every
  // item is authored for (see `index.ts`).
  mesh.position.set(0, 0, z)
  mesh.castShadow = true
  scene.add(mesh)

  // The same inverted hull the world uses (GDD R6), so the outline is judged at
  // the weight it will actually ship at rather than at whatever a debug view
  // happens to draw.
  const hull = new Mesh(model.geometry, outlineMaterial)
  hull.position.copy(mesh.position)
  scene.add(hull)

  model.geometry.computeBoundingBox()
  bounds.union(model.geometry.boundingBox!.clone().translate(mesh.position))

  report.push(
    `${kind}: ${triangleCount(model.geometry)}/${EQUIPMENT_BUDGET[kind]} tris, ` +
      `${model.geometry.getAttribute('position').count} verts, r=${model.radius.toFixed(3)} m, ` +
      `winding ${windingDisagreements(model.geometry)} bad`
  )
  return model.radius
}

if (single) {
  add(single, 0)
} else {
  // A row, every item parked with its **grip on the origin plane** — the honest
  // way to compare seven props whose origins all mean the same thing. It also
  // makes the point-down convention visible at a glance: six of the seven hang
  // below the line.
  let z = 0
  for (const kind of KINDS) {
    const radius = add(kind, z)
    z += radius * 1.05 + 0.12
  }
}

if (params.get('body') === '1') {
  const body = new Mesh(buildChibiGeometry().geometry, material)
  // Aligned to whatever the item's anchor is, so the fit can be judged rather
  // than guessed: the hat's origin is the head's centre (1.29) and the armour's
  // is the hips joint (0.62). Anything held sits at the right hand (0.60).
  const anchor = single === 'hat' ? 1.29 : single === 'torsoArmour' ? 0.62 : 0.6
  body.position.set(0, -anchor, 0)
  body.castShadow = true
  scene.add(body)
  body.geometry.computeBoundingBox()
  bounds.union(body.geometry.boundingBox!.clone().translate(body.position))
}

bounds.getSize(_size)
const center = bounds.getCenter(new Vector3())
// `view=z` looks along +Z instead of +X — the shield's portrait bearing, since
// it is the one item broad on X (see `index.ts`, clause 4).
const view = params.get('view') ?? 'x'
const across = view === 'z' || view === 'pz' ? _size.x : _size.z
const reach = Math.max(across * 0.62, _size.y) * 1.6 + 0.1
const lift = spin ? reach * 0.28 : 0
const swing = spin ? reach * 0.55 : 0
if (view === 'z') {
  camera.position.set(center.x + swing, center.y + lift, center.z - reach)
} else if (view === 'pz') {
  camera.position.set(center.x + swing, center.y + lift, center.z + reach)
} else {
  camera.position.set(center.x - reach, center.y + lift, center.z + swing)
}
camera.lookAt(center)

const _buffer = new Vector2()

const resize = (): void => {
  const width = window.innerWidth
  const height = window.innerHeight
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  resizeRenderer(renderer, width, height)
  updateUnitsPerPixel(camera.fov, renderer.getDrawingBufferSize(_buffer).y)
  rig.onProjectionChanged()
}
window.addEventListener('resize', resize)
resize()

const tick = (time: number): void => {
  worldUniforms.uTime.value = time / 1000
  rig.follow(center)
  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

const panel = document.getElementById('report')
if (panel) {
  const fit = torsoArmourMargin(GEAR_BUILDERS.torsoArmour().geometry)
  panel.textContent = [
    ...report,
    `hat clearance vs built head: ${(hatHeadClearance(GEAR_BUILDERS.hat().geometry) * 1000).toFixed(2)} mm`,
    `armour margin: ${(fit.margin * 1000).toFixed(2)} mm at y=${fit.atY.toFixed(3)}, breaches ${fit.breaches}`
  ].join('\n')
}
