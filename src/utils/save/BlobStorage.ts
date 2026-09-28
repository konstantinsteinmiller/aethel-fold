// ─── BlobStorage ───────────────────────────────────────────────────────────
//
// In-memory mirror of the gameplay-state subset of localStorage. Holds
// allowlisted gameplay key (`aethel_state`) plus the META blob
// (`__save_meta__`) and gives the strategy a single source of truth to
// flush to its remote backend.
//
// Two operating modes:
//
//   persistToRaw=true  (default) — every gameplay write also lands in
//     raw localStorage as its own per-key entry. Module-load reads on
//     a hard reload still surface the prior session's values before
//     the strategy's hydrate completes. Used by LocalStorage / Glitch /
//     itch / GameDistribution where the raw entries either ARE or
//     supplement the persistence layer.
//
//   persistToRaw=false — gameplay state lives ONLY in the in-memory
//     map; gameplay writes never touch raw localStorage. `__save_*`
//     bookkeeping keys (the strategy's manifest, META) live in a
//     separate in-memory shadow. Used by the CrazyGames strategy where
//     `sdk.data` is the sole persistence backend and CG QA explicitly
//     requires that no `aethel_state` / `__save_*` keys appear
//     in raw localStorage. Construction additionally scrubs any
//     leftovers from prior runs that DID mirror to raw, so QA's
//     localStorage panel ends up clean after the next reload.
//
// Bypass routing — developer toggles (`fps`, `debug`, `cheat`,
// `campaign-test`, `full_unlocked`) and SDK scratch (`SDK_DATA_*`,
// `__SafeLocalStorage__*`) flow straight to raw localStorage in BOTH
// modes. Those keys are owned by the developer or the CG SDK and we
// must not interfere with them.

import { isOwnInternalKey, isSdkScratchKey } from './types'
import { isPayloadKey } from './SaveMergePolicy'

/** Developer / debug toggles — touched by hand from DevTools, kept as
 *  their own raw localStorage entries in both modes. */
const DEV_BYPASS_KEYS: ReadonlySet<string> = new Set([
  'fps',
  'debug',
  'cheat',
  'campaign-test',
  'full_unlocked'
])

const isDevBypassKey = (key: string): boolean => DEV_BYPASS_KEYS.has(key)

export interface BlobStorageOptions {
  /**
   * When true (default), gameplay writes mirror per-key into raw
   * localStorage. When false, the in-memory map is the only state
   * surface; the constructor also scrubs any pre-existing payload /
   * `__save_*` keys from raw so the next reload starts clean.
   */
  persistToRaw?: boolean
}

export class BlobStorage {
  private state: Map<string, string> = new Map()
  /** In-memory shadow for `__save_internal__*` and the META blob in
   *  cloud-only mode (`persistToRaw=false`). The strategy uses these
   *  for its own bookkeeping (e.g. the keys-manifest); we hold them
   *  here so reads via the local accessor still work but nothing
   *  leaks into raw localStorage. */
  private internalShadow: Map<string, string> = new Map()
  private readonly persistToRaw: boolean

  // Captured up-front so once SaveManager monkey-patches `setItem` /
  // `getItem` / `removeItem` on the same Storage instance, BlobStorage
  // keeps writing through the ORIGINAL implementations and never
  // recurses into the patched ones.
  private readonly rawGet: (key: string) => string | null
  private readonly rawSet: (key: string, value: string) => void
  private readonly rawRemove: (key: string) => void
  private readonly rawKey: (i: number) => string | null
  private readonly rawLength: () => number

  constructor(private readonly raw: Storage, opts: BlobStorageOptions = {}) {
    this.persistToRaw = opts.persistToRaw ?? true
    this.rawGet = raw.getItem.bind(raw)
    this.rawSet = raw.setItem.bind(raw)
    this.rawRemove = raw.removeItem.bind(raw)
    this.rawKey = raw.key.bind(raw)
    this.rawLength = () => raw.length
    this.seedFromRaw()
    if (!this.persistToRaw) this.scrubRawForCloudOnly()
  }

  /** Pre-populate the in-memory state (and shadow, in cloud-only mode)
   *  from any allowlisted keys already present in raw localStorage at
   *  construction time. Lets the strategy's hydrate read pre-existing
   *  values via `local.get(...)` before the cloud round-trip completes
   *  AND preserves the player's progress across the migration to
   *  cloud-only mode. */
  private seedFromRaw(): void {
    for (let i = 0; i < this.rawLength(); i++) {
      const k = this.rawKey(i)
      if (k == null) continue
      const v = this.rawGet(k)
      if (v == null) continue
      if (isPayloadKey(k)) {
        this.state.set(k, v)
      } else if (!this.persistToRaw && isOwnInternalKey(k)) {
        this.internalShadow.set(k, v)
      }
    }
  }

  /** Cloud-only mode: drop every gameplay key and our own bookkeeping
   *  from raw localStorage. The values are already in `state` /
   *  `internalShadow` (seeded just above), so the player keeps their
   *  progress across the cleanup. SDK scratch and dev toggles are
   *  deliberately left alone — they're owned by their respective
   *  lifecycles. */
  private scrubRawForCloudOnly(): void {
    const toRemove: string[] = []
    for (let i = 0; i < this.rawLength(); i++) {
      const k = this.rawKey(i)
      if (k == null) continue
      if (isSdkScratchKey(k)) continue
      if (isDevBypassKey(k)) continue
      if (isPayloadKey(k) || isOwnInternalKey(k)) toRemove.push(k)
    }
    for (const k of toRemove) this.rawRemove(k)
  }

  // ─── API ──────────────────────────────────────────────────────────────────

  /** Read a key. Allowlisted gameplay keys come from the in-memory map;
   *  bookkeeping keys come from the shadow in cloud-only mode and from
   *  raw otherwise; everything else passes straight through to raw. */
  get(key: string): string | null {
    if (isDevBypassKey(key) || isSdkScratchKey(key)) return this.rawGet(key)
    if (isOwnInternalKey(key)) {
      if (!this.persistToRaw) return this.internalShadow.get(key) ?? null
      return this.rawGet(key)
    }
    if (isPayloadKey(key)) {
      const v = this.state.get(key)
      if (v !== undefined) return v
      // Fallback for keys not yet in the map (legacy raw entries).
      // In cloud-only mode raw was scrubbed at construction, so this
      // falls through to null.
      const raw = this.rawGet(key)
      if (raw != null) this.state.set(key, raw)
      return raw
    }
    return this.rawGet(key)
  }

  /** Write a key. Returns `true` when the value actually changed,
   *  `false` for no-op writes. SaveManager uses the boolean to skip
   *  forwarding unchanged writes to the strategy. */
  set(key: string, value: string): boolean {
    if (isDevBypassKey(key) || isSdkScratchKey(key)) {
      const prev = this.rawGet(key)
      if (prev === value) return false
      this.rawSet(key, value)
      return true
    }
    if (isOwnInternalKey(key)) {
      if (!this.persistToRaw) {
        if (this.internalShadow.get(key) === value) return false
        this.internalShadow.set(key, value)
        return true
      }
      const prev = this.rawGet(key)
      if (prev === value) return false
      this.rawSet(key, value)
      return true
    }
    if (isPayloadKey(key)) {
      if (this.state.get(key) === value) return false
      this.state.set(key, value)
      if (this.persistToRaw) this.rawSet(key, value)
      return true
    }
    const prev = this.rawGet(key)
    if (prev === value) return false
    this.rawSet(key, value)
    return true
  }

  /** Remove a key. Returns `true` when something was actually removed. */
  remove(key: string): boolean {
    if (isDevBypassKey(key) || isSdkScratchKey(key)) {
      const had = this.rawGet(key) !== null
      this.rawRemove(key)
      return had
    }
    if (isOwnInternalKey(key)) {
      if (!this.persistToRaw) {
        const had = this.internalShadow.has(key)
        this.internalShadow.delete(key)
        return had
      }
      const had = this.rawGet(key) !== null
      this.rawRemove(key)
      return had
    }
    if (isPayloadKey(key)) {
      const had = this.state.has(key)
      this.state.delete(key)
      if (this.persistToRaw) this.rawRemove(key)
      return had
    }
    const had = this.rawGet(key) !== null
    this.rawRemove(key)
    return had
  }

  /** All allowlisted gameplay keys currently held, sorted
   *  alphabetically — Glitch's checksum requires sorted keys, and CG
   *  benefits from a deterministic order too. */
  keys(): string[] {
    return [...this.state.keys()].sort()
  }

  /** Drop every allowlisted gameplay key. Bypass keys (dev toggles, SDK
   *  scratch) are untouched so DevTools-set flags survive a `clear()`. */
  clear(): void {
    if (this.state.size === 0 && this.internalShadow.size === 0) return
    const stateKeys = [...this.state.keys()]
    this.state.clear()
    this.internalShadow.clear()
    if (this.persistToRaw) {
      for (const k of stateKeys) this.rawRemove(k)
    }
  }
}
