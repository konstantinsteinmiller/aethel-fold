import { Box3, Color, Mesh, PerspectiveCamera, Scene, Vector2, Vector3 } from 'three'
import { C } from '../../art/palette'
import { createLightRig } from '../../core/lighting'
import { createRenderer, resizeRenderer } from '../../core/renderer'
import { triangleCount } from '../../geometry/budget'
import { updateUnitsPerPixel, worldUniforms } from '../../shading/globals'
import { createOutlineMaterial } from '../../shading/outlineMaterial'
import { createToonMaterial } from '../../shading/toonMaterial'
import { buildChibiGeometry, CHIBI_BUDGET } from '../chibiGeometry'
import { type CharacterAppearance, DEFAULT_APPEARANCE, type HairStyle, type SkinTone } from '../equipment'
import { GARMENT_BUILDERS, type GarmentKind, sleeveColourFor } from './garments'
import { LEG_GARMENT_BUDGET, LEG_GARMENT_BUILDERS, type LegGarmentKind } from './legGarments'

/**
 * ─── Leg bench ──────────────────────────────────────────────────────────────
 *
 * `wardrobe.html`'s sibling for the four models in `legGarments.ts`. Not part of
 * the app and not routed: open `/src/world/characters/gear/legs.html` on the dev
 * server.
 *
 * It exists because the two questions a leg garment has to answer cannot be
 * answered by a test. The first is whether four of them are four *people* at the
 * distance the world is read at — the geometry suite can prove the set is
 * distinct in millimetres and has nothing to say about whether that is a
 * silhouette. The second is the **long hem**: four torso garments in
 * `garments.ts` fall between the knee and mid-thigh, and what a leg garment does
 * under one of them is a question about two solids the tests only check for
 * clearance, not for whether the result reads.
 *
 * The figures are built the way the game will build them —
 * `substituteLegs(buildChibiGeometry(…, torsoGarment), legGarment)` — and drawn
 * with the world's own toon ramp, cascaded sun and 1.6 screen-pixel inverted
 * hull, so the outline is judged at the weight it ships at. They are **not
 * skinned here**: a static bind-pose lineup is what a silhouette comparison
 * wants, and the posed cases are covered by the ray tests in
 * `tests/world/legGear.test.ts`, which check something a screenshot cannot.
 *
 * Query string:
 *   (default)          the four leg garments bare, then the four under a robe
 *   `?dist=20`         the distance the crowd is actually read at
 *   `?item=plateLegs`  one figure filling the frame
 *   `?hem=dress`       every leg garment under one long-hemmed torso garment
 *   `?bare=1`          no torso garment at all, so the whole leg is visible
 *   `?back=1`          from behind
 *   `?side=1`          from the character's left — where the poleyn reads
 *   `?fov=55`          the world's own camera, for a distance judgement
 *   `?seed=3`          a different colourway for every model
 *   `?skin=3`          the skin tone the rolled trousers' bare calf is painted at
 */

const canvas = document.getElementById('bench') as HTMLCanvasElement
const renderer = createRenderer({ canvas, shadows: true })
const scene = new Scene()
scene.background = new Color(C.skyHorizon)

const params = new URLSearchParams(location.search)
// 38° frames a lineup; **55° is the world's own camera** (`World.ts`), and it is the
// only honest setting for a distance judgement — at 20 m it resolves 51.9 px per
// metre against the bench default's 78.4, so a lineup shot at 38° flatters the set
// by half again.
const camera = new PerspectiveCamera(Number(params.get('fov') ?? 38), 1, 0.05, 120)
const rig = createLightRig(scene, { camera, shadowMaxFar: 24 })
scene.fog = null

const seed = Number(params.get('seed') ?? 1)
const skinTone = Number(params.get('skin') ?? DEFAULT_APPEARANCE.skinTone) as SkinTone
const back = params.get('back') === '1'
const side = params.get('side') === '1'
const hair = (params.get('hair') as HairStyle | null) ?? DEFAULT_APPEARANCE.hair
const only = params.get('item') as LegGarmentKind | null
const hemParam = params.get('hem') as GarmentKind | null
const bare = params.get('bare') === '1'

const material = createToonMaterial({ name: 'legs', rimStrength: 0.5, shadowTintMix: 0.32 })
const outlineMaterial = createOutlineMaterial({ pixelWidth: 1.6, name: 'legs-outline' })

const LEG_KINDS = Object.keys(LEG_GARMENT_BUILDERS) as LegGarmentKind[]

/** The four torso garments whose hem falls below the knee. */
const LONG_HEMS: GarmentKind[] = ['robe', 'hoodedRobe', 'dress', 'pinafore']

const report: string[] = []
const bounds = new Box3()
const _size = new Vector3()

const appearance = (torso: GarmentKind | null): CharacterAppearance => ({
  ...DEFAULT_APPEARANCE,
  hair,
  skinTone,
  // `chibiGeometry` paints the upper arms from `tunicColour`, so a garment worn
  // without it arrives with sleeves in whatever colour the character last had —
  // the trap `garmentKit.ts` records as "a green dress with blue sleeves".
  tunicColour: torso ? sleeveColourFor(torso, seed) : DEFAULT_APPEARANCE.tunicColour
})

const place = (label: string, legs: LegGarmentKind | null, torso: GarmentKind | null, x: number): void => {
  const legModel = legs ? LEG_GARMENT_BUILDERS[legs]({ seed, skinTone }) : null
  const torsoModel = torso ? GARMENT_BUILDERS[torso]({ seed }) : null
  // The budget is passed explicitly, and that is temporary. `buildChibiGeometry`
  // adds `slotBudget('legs')` itself — which is **0** until an `ItemKind` maps to
  // the `legs` slot in `equipment.ts`, so a leg garment busts the body's own
  // ceiling and throws in dev. Adding the model's own allowance here is what a
  // declared row will do for free; see `LEG_GARMENT_BUDGET`.
  const budget = CHIBI_BUDGET + (legs ? LEG_GARMENT_BUDGET[legs] : 0)
  const built = buildChibiGeometry(
    budget,
    `legs/${label}`,
    appearance(torso),
    torsoModel?.geometry ?? null,
    legModel?.geometry ?? null
  )

  const body = new Mesh(built.geometry, material)
  body.position.set(x, 0, 0)
  body.castShadow = true
  scene.add(body)

  // The hull already carries the substituted legs: `buildChibiGeometry` appends a
  // body garment *before* the outline cut, because a leg garment **is** the
  // silhouette of the bottom third of the figure and a hull without it would
  // outline the hips and the feet and nothing between them.
  const hull = new Mesh(built.outlineGeometry, outlineMaterial)
  hull.position.copy(body.position)
  scene.add(hull)

  body.geometry.computeBoundingBox()
  bounds.union(body.geometry.boundingBox!.clone().translate(body.position))

  report.push(
    `${label}: ${triangleCount(body.geometry)} tris on the figure` +
      (legModel ? ` (legs ${triangleCount(legModel.geometry)})` : ' (body legs)')
  )
}

const SPACING = 0.78

if (only) {
  place(only, only, hemParam, 0)
} else if (hemParam) {
  let x = -((LEG_KINDS.length + 1) * SPACING) / 2
  place(`none/${hemParam}`, null, hemParam, x)
  x += SPACING
  for (const kind of LEG_KINDS) {
    place(`${kind}/${hemParam}`, kind, hemParam, x)
    x += SPACING
  }
} else if (bare) {
  let x = -((LEG_KINDS.length + 1 - 1) * SPACING) / 2
  place('none', null, null, x)
  x += SPACING
  for (const kind of LEG_KINDS) {
    place(kind, kind, null, x)
    x += SPACING
  }
} else {
  // The default lineup: the four bare, then the four under the longest hem in the
  // wardrobe, which is what the interaction question is actually about.
  const columns = LEG_KINDS.length * 2 + 1
  let x = -((columns - 1) * SPACING) / 2
  place('none', null, null, x)
  x += SPACING
  for (const kind of LEG_KINDS) {
    place(kind, kind, null, x)
    x += SPACING
  }
  for (const kind of LEG_KINDS) {
    place(`${kind}/pinafore`, kind, LONG_HEMS[3]!, x)
    x += SPACING
  }
}

bounds.getSize(_size)
const center = bounds.getCenter(new Vector3())
const explicit = params.get('dist')
const reach = explicit ? Number(explicit) : Math.max(_size.x * 0.62, _size.y) * 1.55 + 0.4
if (side) {
  camera.position.set(center.x + reach, center.y + reach * 0.06, center.z)
} else {
  camera.position.set(center.x, center.y + reach * 0.06, center.z + (back ? -reach : reach))
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

// Read after the first frame, not before it: `renderer.info` is filled in *by*
// rendering, so a panel written at module scope reports zero draws and zero
// programs — which is exactly the number this bench exists to check.
setTimeout(() => {
  const panel = document.getElementById('report')
  if (panel) {
    panel.textContent = [
      ...report,
      `seed ${seed}, skin ${skinTone}, hair ${hair}, camera ${reach.toFixed(1)} m${back ? ', from behind' : ''}`,
      `draw calls ${renderer.info.render.calls}, programs ${renderer.info.programs?.length ?? 0}`
    ].join('\n')
  }
}, 500)
