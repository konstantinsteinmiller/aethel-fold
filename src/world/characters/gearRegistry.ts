import { registerItemGeometry } from './CharacterEquipment'
import { type ItemKind, ITEM_SLOT } from './equipment'
import { gearModel } from './gear'

/**
 * ─── Wiring the gear models into the attachment layer ───────────────────────
 *
 * `CharacterEquipment` deliberately does **not** import `gear/`. It holds a
 * registry of `kind → () => BufferGeometry` and falls back to a grey placeholder
 * billet for anything unregistered, so the attachment layer can be tested,
 * reasoned about and reused by a monster rig without dragging seven weapon
 * generators in behind it.
 *
 * The cost of that separation is that *somebody* has to introduce them, and the
 * first pass had nobody doing it: every character in the world wore placeholder
 * billets while the real models sat unreferenced, with only a DEV warning to say
 * so. The character creator then bridged them inline, which fixed the creator
 * screen and left the world still wearing billets — a seam that looks fixed from
 * whichever screen you happen to be looking at.
 *
 * So the bridge lives here, in one place, and runs from `Character`'s
 * constructor: every character needs it, no character can be built without going
 * through there, and a screen that forgets to call it cannot exist.
 *
 * The direction of the dependency is the one that scales — the *provider*
 * registers itself with the registry, rather than the registry knowing its
 * providers. Adding an eighth item is a row in `GEAR_BUILDERS` and nothing here.
 */

let installed = false

/**
 * Idempotent. Called from `Character`'s constructor, so the cost is one boolean
 * on every character after the first; `gearModel` caches per kind, so the actual
 * geometry is still built lazily, once, when something is first equipped.
 */
export const installGear = (): void => {
  if (installed) {
    return
  }
  installed = true
  for (const kind of Object.keys(ITEM_SLOT) as ItemKind[]) {
    // The wearer's variant goes straight through to `gearModel`, which owns the
    // cache and knows which kinds a skin tone actually changes. That split is
    // the point: this bridge stays two lines however many options a model grows,
    // and `CharacterEquipment` never learns that colourways exist.
    registerItemGeometry(kind, variant => gearModel(kind, variant.seed, variant.skinTone).geometry)
  }
}
