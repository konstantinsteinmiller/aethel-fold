import { Box3, Color, Mesh, PerspectiveCamera, Scene, Vector2, Vector3 } from 'three'
import { C } from '../art/palette'
import { createLightRig } from '../core/lighting'
import { createRenderer, resizeRenderer } from '../core/renderer'
import { triangleCount } from '../geometry/budget'
import { updateUnitsPerPixel, worldUniforms } from '../shading/globals'
import { createOutlineMaterial } from '../shading/outlineMaterial'
import { createToonMaterial } from '../shading/toonMaterial'
import { buildChibiGeometry } from './chibiGeometry'
import {
  DEFAULT_APPEARANCE,
  type BeardStyle,
  type BrowStyle,
  type CharacterAppearance,
  type HairStyle,
  type ItemKind,
  type NoseStyle,
  type SkinTone
} from './equipment'
import { BEARD_STYLES, BROW_STYLES, NOSE_STYLES } from './features'
import { gearModel } from './gear'
import { sleeveColourForItem } from './gear/garments'

/**
 * ─── Faces bench ────────────────────────────────────────────────────────────
 *
 * `gear/bench.html` and `gear/wardrobe.html`'s third sibling, for the three
 * axes in `features.ts`: beards, brow ridges and noses. Not part of the app and
 * not routed — open `/src/world/characters/faces.html` on the dev server.
 *
 * It exists because the tests for this block can only check the things that are
 * numbers. `tests/world/characterFeatures.test.ts` proves a beard is inside its
 * budget, that its roots are buried in the skull, that its front surface clears
 * the costume and that nothing lands on a face vertex — and every one of those
 * would still pass on a beard that reads as a bib, a nose that reads as a wart
 * or a brow that merges into the hairline. Those are all *shading* failures, and
 * this project has already been bitten by three of them (`variants.ts` records
 * the black bib, the black ball and the two dark wings that read as ears), which
 * is why a page like this exists for every family of models in the folder.
 *
 * Everything is built and lit exactly as the game builds and lights it: the same
 * `buildChibiGeometry`, the world's toon ramp, the cascaded sun, and the
 * inverted hull at 1.6 **screen** pixels — so the outline is judged at the
 * weight it ships at rather than at whatever a bench happens to pick.
 *
 * Query string:
 *   (default)          every beard style, on the reference's own colouring
 *   `?row=nose`        the four noses (and none) instead
 *   `?row=brow`        fine against bushy, on four eye styles
 *   `?beard=patriarch` one figure filling the frame
 *   `?dist=20`         the distance a crowd is actually read at
 *   `?head=1`          aim at the head rather than at the figure's centre —
 *                      which is where all three of these features are, and which
 *                      the whole-figure framing puts in the top sixth of frame
 *   `?yaw=35`          camera orbit, degrees. 0 is face-on; 90 is the −X profile,
 *                      which is where a nose lives.
 *   `?turn=222`        turns the **figures**, not the camera.
 *
 *                      This is not a convenience. `lighting.ts` puts the sun at
 *                      a fixed `(-0.52, 0.62, -0.58)` and the chibi is built
 *                      facing **+Z**, so a bench that only orbits the camera can
 *                      never show a lit face: the front of a character standing
 *                      in bind pose is *always* in its own shadow, which is the
 *                      finding `variants.ts` records twice as the reason a beard
 *                      may not be carried to `hairDark`. 222° is the yaw that
 *                      puts the sun square on the face; pair it with `yaw=138`
 *                      to stand in front of it. The default of 0 is the harder
 *                      case and the right default — judge albedo there, and
 *                      shape here.
 *   `?hair=wild`       the haircut worn with it (default `wild`, the reference's)
 *   `?torso=jerkin`    a costume for the long beards to hang in front of
 *   `?legs=tallBoots`  and something under it
 *   `?hairColour=4`    4 is the ash-grey the reference is built on
 */

const canvas = document.getElementById('bench') as HTMLCanvasElement
const renderer = createRenderer({ canvas, shadows: true })
const scene = new Scene()
scene.background = new Color(C.skyHorizon)

const camera = new PerspectiveCamera(38, 1, 0.05, 120)
const rig = createLightRig(scene, { camera, shadowMaxFar: 24 })
scene.fog = null

const params = new URLSearchParams(location.search)
const row = params.get('row') ?? 'beard'
const only = params.get('beard') as BeardStyle | null
const yaw = ((Number(params.get('yaw') ?? 0) % 360) * Math.PI) / 180
const turn = ((Number(params.get('turn') ?? 0) % 360) * Math.PI) / 180
const hair = (params.get('hair') as HairStyle | null) ?? 'wild'
const torso = params.get('torso') as ItemKind | null
const legs = params.get('legs') as ItemKind | null
const hairColour = Number(params.get('hairColour') ?? 4)

const material = createToonMaterial({ name: 'faces', rimStrength: 0.5, shadowTintMix: 0.32 })
const outlineMaterial = createOutlineMaterial({ pixelWidth: 1.6, name: 'faces-outline' })

/**
 * The base face every figure on this page varies from.
 *
 * Grey hair (`hairColour: 4`, `birchBase`) because that is the hardest case the
 * beard's colour rule has to survive — `beardStops` guarantees a beard clears the
 * skin it lies next to by `BROW_MIN_CONTRAST`, and ash on pale skin is where that
 * guarantee is doing the most work.
 */
const base = (): CharacterAppearance => ({
  ...DEFAULT_APPEARANCE,
  hair,
  hairColour,
  skinTone: 1 as SkinTone,
  tunicColour: torso ? (sleeveColourForItem(torso, DEFAULT_APPEARANCE.gearSeed) ?? 0) : 0
})

const report: string[] = []
const bounds = new Box3()
const _size = new Vector3()

const place = (label: string, appearance: CharacterAppearance, x: number): void => {
  const garment = torso ? gearModel(torso, appearance.gearSeed, appearance.skinTone).geometry : null
  const trousers = legs ? gearModel(legs, appearance.gearSeed, appearance.skinTone).geometry : null
  // The shipped budget, not a bench-only one: a style that busts `CHIBI_BUDGET`
  // has to fail here as loudly as it does in the game.
  const built = buildChibiGeometry(undefined, `faces/${label}`, appearance, garment, trousers)

  const body = new Mesh(built.geometry, material)
  body.position.set(x, 0, 0)
  body.rotation.y = turn
  body.castShadow = true
  scene.add(body)

  const hull = new Mesh(built.outlineGeometry, outlineMaterial)
  hull.position.copy(body.position)
  hull.rotation.y = turn
  scene.add(hull)

  built.geometry.computeBoundingBox()
  // Union the *unrotated* box: a turned figure's box is wider by its own depth,
  // which would walk the framing every time `turn` changed and make two shots
  // impossible to compare.
  bounds.union(built.geometry.boundingBox!.clone().translate(body.position))

  const featureTris = (built.blocks.face - built.blocks.features) === 0 ? 0 : blockTriangles(built)
  report.push(`${label}: ${triangleCount(built.geometry)} tris (${featureTris} of them features)`)
}

/**
 * Triangles in the feature block alone.
 *
 * Counted off the index rather than off the vertex count: a strand's vertices
 * and its triangles are not in a fixed ratio (`limbMesh` shares a seam column),
 * so `(face − features) × 2` would be wrong by the seam on every style.
 */
const blockTriangles = (built: ReturnType<typeof buildChibiGeometry>): number => {
  const index = built.geometry.getIndex()!
  const { features, face } = built.blocks
  let count = 0
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i)
    if (a >= features && a < face) {
      count++
    }
  }
  return count
}

const SPACING = 0.78

if (only) {
  place(only, { ...base(), beard: only, brows: 'bushy', nose: 'round' }, 0)
} else if (row === 'nose') {
  let x = -((NOSE_STYLES.length - 1) * SPACING) / 2
  for (const nose of NOSE_STYLES) {
    place(nose, { ...base(), nose, beard: 'none' }, x)
    x += SPACING
  }
} else if (row === 'brow') {
  const eyes = ['bright', 'sleepy', 'sharp', 'weary'] as const
  const cells: [BrowStyle, (typeof eyes)[number]][] = []
  for (const brows of BROW_STYLES) {
    for (const eye of eyes) {
      cells.push([brows, eye])
    }
  }
  let x = -((cells.length - 1) * SPACING) / 2
  for (const [brows, eye] of cells) {
    place(`${brows}/${eye}`, { ...base(), brows, eyes: eye, nose: 'round' }, x)
    x += SPACING
  }
} else {
  let x = -((BEARD_STYLES.length - 1) * SPACING) / 2
  for (const beard of BEARD_STYLES) {
    place(beard, { ...base(), beard, brows: 'bushy', nose: 'round' }, x)
    x += SPACING
  }
}

bounds.getSize(_size)
const center = bounds.getCenter(new Vector3())
if (params.get('head') === '1') {
  // The head's own centre (`rig.ts`: 1.29), not the figure's. Every feature on
  // this page lives within 250 mm of it.
  center.y = 1.27
}
const explicit = params.get('dist')
const reach = explicit ? Number(explicit) : Math.max(_size.x * 0.62, _size.y) * 1.55 + 0.4
camera.position.set(
  center.x - Math.sin(yaw) * reach,
  center.y + reach * 0.06,
  center.z + Math.cos(yaw) * reach
)
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

// After the first frame — `renderer.info` is filled in *by* rendering, so a
// panel written at module scope reports zero draws and zero programs.
setTimeout(() => {
  const panel = document.getElementById('report')
  if (panel) {
    panel.textContent = [
      ...report,
      `row ${row}, hair ${hair}, hairColour ${hairColour}${torso ? `, torso ${torso}` : ''}${legs ? `, legs ${legs}` : ''}`,
      `camera ${reach.toFixed(1)} m at yaw ${((yaw * 180) / Math.PI).toFixed(0)}°, figures turned ${((turn * 180) / Math.PI).toFixed(0)}°`,
      `draw calls ${renderer.info.render.calls}, programs ${renderer.info.programs?.length ?? 0}`
    ].join('\n')
  }
}, 500)

export type _Unused = NoseStyle
