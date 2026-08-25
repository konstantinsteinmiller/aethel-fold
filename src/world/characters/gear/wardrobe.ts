import { Box3, Color, Mesh, PerspectiveCamera, Scene, Vector2, Vector3 } from 'three'
import { C } from '../../art/palette'
import { createLightRig } from '../../core/lighting'
import { createRenderer, resizeRenderer } from '../../core/renderer'
import { triangleCount } from '../../geometry/budget'
import { updateUnitsPerPixel, worldUniforms } from '../../shading/globals'
import { createOutlineMaterial } from '../../shading/outlineMaterial'
import { createToonMaterial } from '../../shading/toonMaterial'
import { buildChibiGeometry } from '../chibiGeometry'
import { DEFAULT_APPEARANCE, type CharacterAppearance, type HairStyle } from '../equipment'
import { GARMENT_BUILDERS, type GarmentKind, sleeveColourFor } from './garments'
import { HEADWEAR_BUILDERS, type HeadwearKind } from './headwear'

/**
 * ─── Wardrobe bench ─────────────────────────────────────────────────────────
 *
 * `bench.html`'s sibling, for the fourteen models in `garments.ts` and
 * `headwear.ts`. Not part of the app and not routed: open
 * `/src/world/characters/gear/wardrobe.html` on the dev server.
 *
 * It exists for the reason that bench does, and more so. A torso garment is not a
 * prop you can judge on its own — it **is** the figure's torso, so the only
 * question worth asking about it is what the *whole character* looks like at the
 * distance the world is read at. Every one of these passes the geometric contract
 * in `tests/world/professionGear.test.ts`; none of that says whether a farmer and
 * a tavern keeper are two people at 20 m.
 *
 * The figures are built the way the game builds them —
 * `buildChibiGeometry(budget, name, appearance, garment)` with the garment
 * substituted for the torso — and drawn with the world's own toon ramp, cascaded
 * sun and 1.6 screen-pixel inverted hull, so the outline is judged at the weight
 * it ships at.
 *
 * They are **not skinned here**: a static bind-pose lineup is what a silhouette
 * comparison wants, and the posed cases are covered by the ray tests, which check
 * something a screenshot cannot.
 *
 * Query string:
 *   (default)          all nine garments, then five hats on a neutral tunic
 *   `?dist=20`         the distance the crowd is actually read at
 *   `?item=dress`      one figure filling the frame
 *   `?back=1`          from behind — the cowl, the cape and the tabard's back panel
 *   `?seed=3`          a different colourway for every model
 *   `?hair=ponytail`   the hair styles headwear does not clear
 */

const canvas = document.getElementById('bench') as HTMLCanvasElement
const renderer = createRenderer({ canvas, shadows: true })
const scene = new Scene()
scene.background = new Color(C.skyHorizon)

const camera = new PerspectiveCamera(38, 1, 0.05, 120)
const rig = createLightRig(scene, { camera, shadowMaxFar: 24 })
scene.fog = null

const params = new URLSearchParams(location.search)
const seed = Number(params.get('seed') ?? 1)
const back = params.get('back') === '1'
const hair = (params.get('hair') as HairStyle | null) ?? DEFAULT_APPEARANCE.hair
const only = params.get('item')

const material = createToonMaterial({ name: 'wardrobe', rimStrength: 0.5, shadowTintMix: 0.32 })
const outlineMaterial = createOutlineMaterial({ pixelWidth: 1.6, name: 'wardrobe-outline' })

/**
 * The appearance a garment should be worn with.
 *
 * `tunicColour` is not cosmetic here: `chibiGeometry` paints the upper arms from
 * it, so a garment worn without it arrives with sleeves in whatever colour the
 * character last had. Screenshotted before this existed — two woad-blue shoulder
 * caps on a moss-green dress — and it is the reason `sleeveColourFor` exists.
 */
const appearance = (sex: CharacterAppearance['sex'], garment: GarmentKind): CharacterAppearance => ({
  ...DEFAULT_APPEARANCE,
  sex,
  hair,
  tunicColour: sleeveColourFor(garment, seed)
})

/** Which build each garment is cut for. Only a proportion change; both are legal. */
const FEMININE: GarmentKind[] = ['dress', 'pinafore']

const GARMENTS = Object.keys(GARMENT_BUILDERS) as GarmentKind[]
const HATS = Object.keys(HEADWEAR_BUILDERS) as HeadwearKind[]

const report: string[] = []
const bounds = new Box3()
const _size = new Vector3()

/** The `headTop` socket in bind pose: head bone at 1.14 plus the socket's 150 mm. */
const HEAD_TOP_Y = 1.29

const place = (label: string, garment: GarmentKind, hat: HeadwearKind | null, x: number): void => {
  const model = GARMENT_BUILDERS[garment]({ seed })
  // Default budget on purpose: `buildChibiGeometry` adds the garment allowance
  // itself, so this is the ceiling `Character.rebuild` actually ships with — and
  // a garment that busts it should fail on this page too.
  const built = buildChibiGeometry(
    undefined,
    `wardrobe/${label}`,
    appearance(FEMININE.includes(garment) ? 'female' : 'male', garment),
    model.geometry
  )

  const body = new Mesh(built.geometry, material)
  body.position.set(x, 0, 0)
  body.castShadow = true
  scene.add(body)

  const hull = new Mesh(built.outlineGeometry, outlineMaterial)
  hull.position.copy(body.position)
  scene.add(hull)

  built.geometry.computeBoundingBox()
  bounds.union(built.geometry.boundingBox!.clone().translate(body.position))

  let total = triangleCount(built.geometry)
  if (hat) {
    const worn = HEADWEAR_BUILDERS[hat]({ seed })
    const cap = new Mesh(worn.geometry, material)
    cap.position.set(x, HEAD_TOP_Y, 0)
    cap.castShadow = true
    scene.add(cap)
    const capHull = new Mesh(worn.geometry, outlineMaterial)
    capHull.position.copy(cap.position)
    scene.add(capHull)
    worn.geometry.computeBoundingBox()
    bounds.union(worn.geometry.boundingBox!.clone().translate(cap.position))
    total += triangleCount(worn.geometry)
  }

  report.push(`${label}: ${total} tris on the figure`)
}

const SPACING = 0.78

if (only) {
  if ((GARMENT_BUILDERS as Record<string, unknown>)[only]) {
    place(only, only as GarmentKind, null, 0)
  } else {
    place(only, 'roughTunic', only as HeadwearKind, 0)
  }
} else {
  let x = -((GARMENTS.length + HATS.length - 1) * SPACING) / 2
  for (const garment of GARMENTS) {
    place(garment, garment, null, x)
    x += SPACING
  }
  // The hats on one neutral body, so the only variable is the hat.
  for (const hat of HATS) {
    place(hat, 'roughTunic', hat, x)
    x += SPACING
  }
}

bounds.getSize(_size)
const center = bounds.getCenter(new Vector3())
// Framed on the row's width unless a distance is asked for. 20 m is the far end
// of the range GDD §1 says the world is read at.
const explicit = params.get('dist')
const reach = explicit ? Number(explicit) : Math.max(_size.x * 0.62, _size.y) * 1.55 + 0.4
camera.position.set(center.x, center.y + reach * 0.06, center.z + (back ? -reach : reach))
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
      `seed ${seed}, hair ${hair}, camera ${reach.toFixed(1)} m${back ? ', from behind' : ''}`,
      `draw calls ${renderer.info.render.calls}, programs ${renderer.info.programs?.length ?? 0}`
    ].join('\n')
  }
}, 500)
