import { ref, computed, shallowRef, triggerRef, watch, type ComputedRef, type Ref } from 'vue'
import {
  BLOCK_DEFS, blockDef, GATE_ID, sellRefund, ENHANCED_HP_MUL, ENHANCED_DAMAGE_MUL
} from '@/game/blocks'
import { ENEMY_DEFS, enemyDef } from '@/game/enemies'
import { monsterGore } from '@/game/monsters'
import { pickMonster } from '@/game/monsterSprites'
import { ALLY_DEFS, allyDef, CAVALRY_SQUAD } from '@/game/allies'
import {
  OFFER_SLOTS, shapeDef, shapeCost, rollOffer, rollOffers, SHAPE_BY_ID
} from '@/game/shapes'
import { SEA_SWIM_Y, SEA_STRIKE_Y } from '@/game/world'
import {
  planWave, buildTimeMs, earlyCallBonus, waveReward, isBossWave, SPAWN_FLUSH_AT_MS,
  enemyHpScale
} from '@/game/waves'
import {
  FlawlessTracker, adaptiveFactor, towerPower, type TowerStrength
} from '@/game/difficulty'
import type {
  Block, Enemy, EnemyDef, Ally, Projectile, ProjectileKind,
  WavePlan, Phase, KillTally, RunSnapshot
} from '@/game/types'
import {
  damageMul, fireRateMul, rangeMul, splashMul, chainBonus,
  blockHpMul, gateHpMul, armorBonus, waveRewardMul, coinDropMul,
  waveRepairPct, startWood, startStone, buildHalfWidth, availableBlocks,
  thornsMul, cavalryMul
} from '@/use/useTowerProgress'
import useTowerEconomy from '@/use/useTowerEconomy'
import { difficultyFactor } from '@/use/useUser'
import { getState, setState, removeState } from '@/use/useTowerState'
import { RUN_KEY } from '@/keys'
import { pushFx } from '@/use/useTowerVfx'

/**
 * ─── aethel-fold — simulation ───────────────────────────────────────────────
 *
 * Owns the tower, the enemies, the projectiles and the wave clock. Runs on a
 * fixed 60 Hz accumulator so behaviour is frame-rate independent and a
 * backgrounded tab can't fast-forward the siege on return.
 *
 * PERFORMANCE CONTRACT: the hot collections (`blocks`, `enemies`,
 * `projectiles`) are PLAIN, non-reactive structures. Vue's proxy overhead on a
 * few hundred entities mutated 60×/s is exactly the kind of cost that makes a
 * mobile browser drop frames. Only HUD-relevant SCALARS are refs, and they are
 * written at most once per tick. The renderer reads the plain collections
 * directly via the exported accessors.
 *
 * World space: cell `(c, r)` spans `x ∈ [c-0.5, c+0.5]`, `y ∈ [r, r+1]`, with
 * `y = 0` on the ground and `+y` pointing UP. The Gate sits at `(0, 0)`.
 */

// ─── Tunables ───────────────────────────────────────────────────────────────

const TICK_MS = 1000 / 60
/** Max substeps per rAF — a tab restored after 30 s must not simulate 30 s. */
const MAX_SUBSTEPS = 4
/** How far off-screen (in cells) enemies spawn, measured from the tower edge. */
const SPAWN_MARGIN = 6
/** Gravity for ballistic shells and falling debris, cells/s². */
const GRAVITY = 26
/** A falling block is destroyed once it has dropped this far. */
/** Falling this many cells destroys a block outright; less costs a
 *  proportional slice of its max HP. */
const FALL_KILL_CELLS = 5
/** Crush damage a collapsing block deals to ground enemies beneath it. */
/** How far a crushed boss is shoved away from the tower, in cells. */
const BOSS_KNOCKBACK_CELLS = 2.4
/** Cells of shove applied per second while a knockback is being paid off. */
const KNOCKBACK_SPEED = 11
/** Share of a boss's MAX hp a full-height crush removes. */
const BOSS_CRUSH_PCT = 0.14
/** Radius around the impact point that gets caught, in cells. */
const CRUSH_RADIUS = 0.95
/**
 * Half-width of the GROUND FLOOR, in cells.
 *
 * Fixed at 4 either side of the Gate regardless of the foundation tech, which
 * only widens the rows above. A tower has to be built UP from a bounded
 * footing rather than smeared into a flat wall along the whole ground lane —
 * that is what makes height, collapse and structural support matter at all.
 */
const FOUNDATION_HALF_WIDTH = 4
/** Practical bound on how far an upper floor may reach out from the centre. */
const UPPER_HALF_WIDTH = 22
/** How often the player may swap one offer for a fresh piece, ms. */
const REROLL_COOLDOWN_MS = 10_000

// ─── Live state (plain, non-reactive) ───────────────────────────────────────

/** Grid occupancy, keyed `"c,r"`. */
const blocks = new Map<string, Block>()
/** Secondary index so projectiles / VFX can resolve a block by uid in O(1). */
const blocksByUid = new Map<number, Block>()
const enemies: Enemy[] = []
const projectiles: Projectile[] = []
/** Blocks currently mid-collapse. Kept out of `blocks` so they no longer
 *  occupy their grid cell (the player may rebuild there immediately). */
const debris: Block[] = []
/** Friendly units currently out on a sortie. */
const allies: Ally[] = []

let uidCounter = 1
let clock = 0 // ms since run start, advanced by the fixed step
let accumulator = 0
let plan: WavePlan = { wave: 0, orders: [], total: 0, boss: false }
let spawnCursor = 0
let waveClock = 0 // ms since the wave started
let buildDeadline = 0 // ms remaining in the build phase
let gateUid = -1
let blocksPlacedThisRun = 0
let wavesClearedThisRun = 0

// Per-wave cached tech multipliers. Read ONCE when a wave starts rather than
// per-frame — these are Vue computeds and touching them 60×/s per turret would
// be a needless dependency-tracking cost.
let mDamage = 1
let mFireRate = 1
let mRange = 1
let mSplash = 1
let mChain = 0
let mArmor = 0
let mCoinDrop = 1
let mThorns = 1
let mCavalry = 1

// ─── Reactive HUD surface (scalars only) ────────────────────────────────────

export const phase: Ref<Phase> = ref('build')
export const wave = ref(0)
export const wood = ref(0)
export const stone = ref(0)
export const runCoins = ref(0)

/**
 * Coins EARNED this run, never decremented.
 *
 * `runCoins` is a spendable balance now that blocks cost gold, and a balance
 * that can fall is the wrong thing to feed progression: `useMissions` credits
 * deltas and treats a counter going backwards as the start of a new run, so
 * every purchase would re-baseline and then re-credit the remaining balance
 * against the daily coin mission. Achievements accumulate the same figure.
 */
export const runCoinsEarned = ref(0)
export const kills = ref(0)
export const killsByType: Ref<KillTally> = ref({})

/** What a boss is worth on the leaderboard, in ordinary kills. */
export const BOSS_SCORE = 5

/**
 * The run's leaderboard score: one point per enemy killed since wave 1, five
 * for a boss.
 *
 * DERIVED from the kill tally rather than counted into a ref of its own. The
 * tally is already in the run snapshot, so a resumed siege restores its score
 * for free — a separately-counted score would have needed its own snapshot
 * field, and would have silently reset to zero for every player mid-run at the
 * moment this shipped.
 */
export const runScore: ComputedRef<number> = computed(() => {
  let total = 0
  for (const typeId in killsByType.value) {
    const n = killsByType.value[typeId] ?? 0
    total += n * (enemyDef(typeId).boss ? BOSS_SCORE : 1)
  }
  return total
})
export const enemiesLeft = ref(0)
export const enemiesTotal = ref(0)
export const gateHp = ref(0)
export const gateMaxHp = ref(1)
export const buildTimeLeft = ref(0)
export const blockCount = ref(0)
export const towerHeight = ref(0)
/** 1× / 2× battle-speed toggle (reference image 3). Build phase is unaffected. */
export const gameSpeed = ref(1)
/** Bumped whenever the tower's cell occupancy changes, so the camera's auto-fit
 *  and the build-tray affordability hints can recompute without deep watching. */
export const towerVersion = ref(0)
/**
 * The four build shapes currently on offer.
 *
 * A shallowRef over a plain array: the tray re-renders on identity change,
 * and we always replace the array rather than mutating it in place.
 */
export const offers = shallowRef<string[]>([])

/** Parallel to `offers`: true where that slot holds an ENHANCED shape dealt by
 *  the rewarded-ad button. */
export const offerEnhanced = shallowRef<boolean[]>([false, false, false, false])

/** Milliseconds until the free manual reroll is available again. */
export const rerollReadyIn = ref(0)

/** Live cavalry count, for the HUD button's badge. */
export const allyCount = ref(0)

/** Wave-clear payload for the toast; null while nothing is pending. */
export const lastWaveReward = shallowRef<{
  wave: number; coins: number; wood: number; stone: number; bonusPct: number; tally: KillTally
} | null>(null)

/**
 * What the player currently has standing.
 *
 * Measured, not estimated: the director prices the next wave against this, so
 * anything it gets wrong is felt directly as a wave that is too easy or too
 * mean. Weapon DPS carries the same tech multipliers the weapons themselves
 * use, which is why it is read from the cached multipliers rather than the
 * reactive ones — those are snapshotted at `callWave`.
 */
export const measureTower = (): TowerStrength => {
  let hp = 0
  let dps = 0
  let antiAir = 0
  let height = 0

  for (const b of blocks.values()) {
    hp += b.hp + armorFor(b) * 6
    if (b.r + 1 > height) height = b.r + 1
    const w = blockDef(b.typeId).weapon
    if (!w) continue
    const dmg = w.damage * mDamage * (b.enhanced ? ENHANCED_DAMAGE_MUL : 1)
    const cd = Math.max(120, w.cooldownMs / mFireRate)
    // Splash weapons hit more than one thing, so their real contribution is
    // higher than a naive damage/cooldown suggests.
    const multi = 1 + (w.splash ?? 0) * 0.6 + (w.chain ?? 0) * 0.4
    dps += (dmg / (cd / 1000)) * multi
    if (w.hitsAir) antiAir++
  }

  return { hp, dps, blocks: blocks.size, height, antiAir }
}

/** Current adaptive multiplier, surfaced so the HUD can warn about a spike. */
export const difficultyMul = ref(1)
/** Waves cleared without losing a block, toward the next escalation. */
export const flawlessProgress = ref(0)

const flawless = new FlawlessTracker()
/** Set the moment any block is destroyed during a wave. */
let lostBlockThisWave = false

export const gateHpPct = computed(() => (gateMaxHp.value > 0 ? gateHp.value / gateMaxHp.value : 0))
export const isBossIncoming = computed(() => isBossWave(wave.value + 1))

// ─── Accessors for the renderer ─────────────────────────────────────────────

export const getBlocks = (): Map<string, Block> => blocks
export const getEnemies = (): Enemy[] => enemies
export const getProjectiles = (): Projectile[] => projectiles
export const getDebris = (): Block[] => debris
export const getAllies = (): Ally[] => allies
export const nowMs = (): number => clock

// ─── Grid helpers ───────────────────────────────────────────────────────────

const key = (c: number, r: number): string => `${c},${r}`
const blockAt = (c: number, r: number): Block | undefined => blocks.get(key(c, r))

/** Effective max HP for a block type, after tech. The Gate gets its own
 *  multiplier on top so investing in it is a distinct, legible choice. */
/** A gable is structure, not decoration: a roofed block is twice the block. */
const ROOF_HP_MUL = 2

/**
 * Damage divisor for hits that land on the roof itself.
 *
 * Expressed as a divisor rather than as triple flat armour on purpose. Armour
 * here is SUBTRACTED, and the wooden roofed shapes carry none at all — tripling
 * zero would have given the player a roof that does nothing against the one
 * thing a roof is for, which is bombers.
 */
const ROOF_TOP_DEFENSE_DIV = 3

/**
 * Is this hit coming down on top of the block?
 *
 * A cell spans `r` to `r + 1`. Anything originating at or above its top face
 * is over it; a grunt swinging at the wall stands at the block's own height or
 * below and gets none of the roof's protection.
 */
const isTopSide = (b: Block, fromY: number | undefined): boolean =>
  fromY !== undefined && fromY >= b.r + 0.85

const maxHpFor = (typeId: string, enhanced = false, roof = false): number => {
  const def = blockDef(typeId)
  let base = def.hp * blockHpMul.value
  if (typeId === GATE_ID) base *= gateHpMul.value
  if (enhanced) base *= ENHANCED_HP_MUL
  if (roof) base *= ROOF_HP_MUL
  return Math.round(base)
}

const armorFor = (b: Block): number => (blockDef(b.typeId).armor ?? 0) + mArmor

/** Bounds of the standing tower — drives camera auto-fit and the run summary. */
export const towerBounds = (): { minC: number; maxC: number; maxR: number } => {
  let minC = 0, maxC = 0, maxR = 0
  for (const b of blocks.values()) {
    if (b.c < minC) minC = b.c
    if (b.c > maxC) maxC = b.c
    if (b.r > maxR) maxR = b.r
  }
  return { minC, maxC, maxR }
}

const syncTowerStats = (): void => {
  blockCount.value = blocks.size
  towerHeight.value = towerBounds().maxR + 1
  towerVersion.value++
}

// ─── Placement ──────────────────────────────────────────────────────────────

/**
 * Is `(c, r)` a legal build slot right now? A cell qualifies when it is empty,
 * inside the buildable column range, at or above ground, and either sits ON the
 * ground (row 0 rests on solid earth) or touches an existing block orthogonally.
 *
 * Diagonal-only contact is deliberately NOT enough: it would let players draw
 * unsupported staircases into the sky, and the collapse rule would then fire
 * constantly on contact with reality.
 */
/**
 * Buildable half-width for a given row.
 *
 * ONLY the ground floor is capped — at four cells either side of the Gate,
 * widened from there by the foundation tech. Every floor above it is free.
 *
 * That asymmetry is the whole point. Capping every row produced exactly one
 * shape, a rectangle that grew straight up, because there was never a reason to
 * build anything else. Capping the FOOTPRINT alone turns the interesting
 * question into what you do with the space above it: arms cantilevered out over
 * the approach to put archers where the enemies are, split towers, wings that
 * shelter the Gate from a bomb run.
 *
 * The risk that keeps this honest is `resolveOrphans`: anything the Gate can no
 * longer reach falls and takes damage on landing, so a clever overhang is a bet,
 * not free real estate.
 *
 * `UPPER_HALF_WIDTH` is a sanity bound rather than a design constraint — it
 * stops the legal-slot scan and the camera's auto-fit from walking off into
 * infinity if someone sets out to build a mile-wide shelf.
 */
export const halfWidthAt = (r: number): number =>
  r === 0 ? Math.min(FOUNDATION_HALF_WIDTH, buildHalfWidth.value) : UPPER_HALF_WIDTH

export const canPlaceAt = (c: number, r: number): boolean => {
  if (r < 0) return false
  if (Math.abs(c) > halfWidthAt(r)) return false
  if (blocks.has(key(c, r))) return false
  // A gable seals its column: nothing may sit on a roofed block. This is what
  // makes roofed shapes a real trade rather than a free upgrade.
  if (r > 0 && blockAt(c, r - 1)?.roof) return false
  if (r === 0) return true
  return (
    blocks.has(key(c - 1, r)) ||
    blocks.has(key(c + 1, r)) ||
    blocks.has(key(c, r - 1)) ||
    blocks.has(key(c, r + 1))
  )
}

/**
 * Can `shapeId` be dropped with its bottom-left cell at `(c, r)`?
 *
 * Every cell must be empty, in range, above ground and not sealed under a roof.
 * Support is evaluated for the shape AS A WHOLE: at least one of its cells must
 * rest on the ground or touch the existing tower. Requiring every cell to be
 * individually supported would make L-bends and overhangs — the entire reason
 * shapes are interesting — impossible to place.
 */
export const canPlaceShapeAt = (shapeId: string, c: number, r: number): boolean => {
  const def = SHAPE_BY_ID[shapeId]
  if (!def) return false
  if (phase.value === 'defeat') return false

  const own = new Set<string>()
  for (const [dx, dy] of def.cells) own.add(key(c + dx, r + dy))
  const roofs = new Set(def.roofs ?? [])

  let supported = false
  for (let i = 0; i < def.cells.length; i++) {
    const [dx, dy] = def.cells[i]!
    const cc = c + dx
    const rr = r + dy
    if (rr < 0) return false
    if (Math.abs(cc) > halfWidthAt(rr)) return false
    if (blocks.has(key(cc, rr))) return false
    if (rr > 0 && blockAt(cc, rr - 1)?.roof) return false
    // A gable needs open sky above it. The seal already stops anything being
    // built ON a roof; without this the same illegal stack could be made from
    // underneath, tucking a pitched roof inside the block above it.
    if (roofs.has(i) && (blocks.has(key(cc, rr + 1)) || own.has(key(cc, rr + 1)))) return false

    if (rr === 0) { supported = true; continue }
    // Neighbours that belong to the shape itself don't count as support.
    for (const nk of [key(cc - 1, rr), key(cc + 1, rr), key(cc, rr - 1), key(cc, rr + 1)]) {
      if (!own.has(nk) && blocks.has(nk)) { supported = true; break }
    }
  }
  return supported
}

/** Can the player pay for `shapeId` right now? */
export const canAffordShape = (shapeId: string): boolean => {
  const cost = shapeCost(shapeId)
  return wood.value >= cost.wood && stone.value >= cost.stone && runCoins.value >= cost.coins
}

/**
 * Place the shape held in offer slot `slotIndex` with its bottom-left cell at
 * `(c, r)`. Charges the whole shape, then rerolls that slot so the hand is
 * always four live choices.
 */
export const placeShape = (slotIndex: number, c: number, r: number): boolean => {
  const shapeId = offers.value[slotIndex]
  if (!shapeId) return false
  if (!canPlaceShapeAt(shapeId, c, r) || !canAffordShape(shapeId)) return false

  const def = shapeDef(shapeId)
  const cost = shapeCost(shapeId)
  wood.value -= cost.wood
  stone.value -= cost.stone
  runCoins.value -= cost.coins

  const enhanced = offerEnhanced.value[slotIndex] === true
  const roofs = new Set(def.roofs ?? [])
  def.cells.forEach(([dx, dy, typeId], i) => {
    spawnBlock(typeId, c + dx, r + dy, roofs.has(i), undefined, enhanced)
  })

  blocksPlacedThisRun += def.cells.length
  syncTowerStats()
  rerollOffer(slotIndex)
  pushFx({ kind: 'place', x: c, y: r + 0.5, palette: blockDef(def.cells[0]![2]).palette })
  return true
}

/** Reroll one offer slot, avoiding duplicates with the other three. */
export const rerollOffer = (slotIndex: number): void => {
  const next = offers.value.slice()
  const others = next.filter((_, i) => i !== slotIndex)
  next[slotIndex] = rollOffer(slotIndex, wave.value, availableBlocks.value, others)
  offers.value = next
  // A rerolled slot loses its enhanced status — the reinforcement came with the
  // specific piece the ad dealt, not with the slot.
  const flags = offerEnhanced.value.slice()
  flags[slotIndex] = false
  offerEnhanced.value = flags
}

/**
 * The player's own reroll, on a 10 s cooldown.
 *
 * Without it a bad hand is a dead ten seconds: four structure pieces you can't
 * afford, or a fourth wooden domino when what you need is a gun. The cooldown
 * keeps it from becoming a slot machine you spin until you get the piece you
 * wanted — you get one swap, so it has to be the right one.
 */
export const canManualReroll = (): boolean => rerollReadyIn.value <= 0
export const manualReroll = (slotIndex: number): boolean => {
  if (!canManualReroll()) return false
  if (slotIndex < 0 || slotIndex >= OFFER_SLOTS) return false
  rerollOffer(slotIndex)
  rerollReadyIn.value = REROLL_COOLDOWN_MS
  return true
}

/** Replace the whole hand with four ENHANCED shapes (the rewarded-ad payout). */
export const dealEnhancedOffers = (): void => {
  offers.value = rollOffers(wave.value, availableBlocks.value)
  offerEnhanced.value = [true, true, true, true]
}

/** Deal a fresh hand of four. */
const dealOffers = (): void => {
  offers.value = rollOffers(wave.value, availableBlocks.value)
  offerEnhanced.value = [false, false, false, false]
}

/**
 * Buying a tech unlock should put the new piece in front of the player
 * immediately — waiting for the deck to cycle makes the purchase feel inert.
 * Only the two FREE lanes are rerolled; the structure and weapon lanes are left
 * alone so a deliberate pick is never yanked out from under the player.
 *
 * The watch source is a SORTED STRING, not the Set itself. `availableBlocks` is
 * a computed that rebuilds its Set whenever `tower_state` changes identity —
 * which is every persisted write, including the run snapshot saved after each
 * placement. Watching the Set by reference therefore rerolled two of the
 * player's offers on essentially every action; watching its contents fires only
 * when the unlocked set has genuinely changed.
 */
const unlockedKey = computed(() => [...availableBlocks.value].sort().join(','))

watch(unlockedKey, () => {
  if (offers.value.length !== OFFER_SLOTS) return
  rerollOffer(2)
  rerollOffer(3)
})

export const canAfford = (typeId: string): boolean => {
  const cost = blockDef(typeId).cost
  return wood.value >= (cost.wood ?? 0)
    && stone.value >= (cost.stone ?? 0)
    && runCoins.value >= (cost.coins ?? 0)
}

/** Attempt to place `typeId` at `(c, r)`. Returns false (and changes nothing)
 *  if the slot is illegal or the player can't pay. */
/** Create a block in the grid. Shared by shape placement, the gate and the
 *  snapshot restore, so every path produces identically-shaped instances. */
const spawnBlock = (
  typeId: string, c: number, r: number, roof = false, hp?: number, enhanced = false
): Block => {
  const maxHp = maxHpFor(typeId, enhanced, roof)
  const block: Block = {
    uid: uidCounter++,
    c, r,
    typeId,
    roof,
    enhanced,
    hp: hp ?? maxHp,
    maxHp,
    cd: 0,
    flash: 0,
    bornAt: clock,
    recoil: 0,
    aim: 0
  }
  blocks.set(key(c, r), block)
  blocksByUid.set(block.uid, block)
  return block
}

/** Place a SINGLE block. Retained for the gate, the snapshot restore and unit
 *  tests; the player always goes through `placeShape`. */
export const placeBlock = (typeId: string, c: number, r: number): boolean => {
  if (phase.value === 'defeat') return false
  if (!canPlaceAt(c, r) || !canAfford(typeId)) return false

  const def = blockDef(typeId)
  wood.value -= def.cost.wood ?? 0
  stone.value -= def.cost.stone ?? 0
  runCoins.value -= def.cost.coins ?? 0
  spawnBlock(typeId, c, r)
  blocksPlacedThisRun++
  syncTowerStats()
  pushFx({ kind: 'place', x: c, y: r + 0.5, palette: def.palette })
  return true
}

/** Sell a placed block for half its cost. The Gate can never be sold.
 *  Returns the refund, or null when the sale is rejected. */
export const sellBlock = (c: number, r: number): { wood: number; stone: number; coins: number } | null => {
  const b = blockAt(c, r)
  if (!b || b.typeId === GATE_ID) return null
  const refund = sellRefund(b.typeId)
  wood.value += refund.wood
  stone.value += refund.stone
  runCoins.value += refund.coins
  removeBlock(b, false)
  resolveOrphans()
  syncTowerStats()
  pushFx({ kind: 'sell', x: c, y: r + 0.5 })
  return refund
}

/** Remove a block from the grid. `violent` routes it through the destruction
 *  VFX + TNT detonation; a sale is quiet. */
const removeBlock = (b: Block, violent: boolean): void => {
  blocks.delete(key(b.c, b.r))
  blocksByUid.delete(b.uid)
  if (!violent) return

  const def = blockDef(b.typeId)
  pushFx({ kind: 'shatter', x: b.c, y: b.r + 0.5, palette: def.palette })

  const boom = def.utility?.deathExplosion
  if (boom) {
    // TNT pays off here: a nearly-free block that converts its own death into
    // a large area denial. Damages enemies only — chaining through the player's
    // own tower would make it a trap rather than a tool.
    pushFx({ kind: 'explosion', x: b.c, y: b.r + 0.5, radius: boom.radius })
    damageEnemiesInRadius(b.c, b.r + 0.5, boom.radius, boom.damage)
  }
}

/**
 * Flood-fill support from the ground row and set anything unreachable falling.
 * Runs after every destruction. Cascades naturally: a collapsing block is
 * removed from `blocks`, and the NEXT call (fired when it lands) re-checks —
 * which is what produces the domino effect when a tower is undermined.
 */
const resolveOrphans = (): void => {
  if (blocks.size === 0) return

  // Support is flood-filled from the GATE, orthogonally. Anything the Gate can
  // no longer reach through a chain of blocks is unsupported — that is what
  // makes undermining a tower a real tactic rather than a chip-damage race.
  //
  // Ground-row blocks are an exception: they are standing on the earth, so they
  // stay put even when the chain to the Gate is cut. They cannot fall anywhere.
  const reachable = new Set<string>()
  const stack: Block[] = []

  const gate = blocksByUid.get(gateUid)
  if (gate) {
    reachable.add(key(gate.c, gate.r))
    stack.push(gate)
  }

  while (stack.length > 0) {
    const b = stack.pop()!
    const neighbours = [
      blockAt(b.c - 1, b.r), blockAt(b.c + 1, b.r),
      blockAt(b.c, b.r - 1), blockAt(b.c, b.r + 1)
    ]
    for (const n of neighbours) {
      if (!n) continue
      const k = key(n.c, n.r)
      if (reachable.has(k)) continue
      reachable.add(k)
      stack.push(n)
    }
  }

  let collapsed = 0
  for (const b of [...blocks.values()]) {
    if (b.r === 0) continue // resting on the ground; nowhere to fall
    if (reachable.has(key(b.c, b.r))) continue
    blocks.delete(key(b.c, b.r))
    blocksByUid.delete(b.uid)
    b.falling = {
      dy: 0,
      vy: 0,
      rot: 0,
      // A little spin so a collapse reads as tumbling rubble rather than a
      // freight elevator. There is deliberately NO horizontal drift: these
      // blocks land back on the grid, and a block that drifted a third of a
      // cell sideways would land in a column it never fell down.
      vrot: (Math.random() - 0.5) * 3.2,
      dx: 0,
      vx: 0,
      fromRow: b.r
    }
    debris.push(b)
    collapsed++
  }

  if (collapsed > 0) {
    pushFx({ kind: 'collapse', x: 0, y: 0, count: collapsed })
  }
}

/**
 * Where a block falling down column `c` from `fromRow` comes to rest.
 *
 * Scans downward for the first occupied cell and returns the row above it, or
 * row 0 if the column is clear all the way to the ground. Other blocks that are
 * mid-fall in the same column are ignored: they are resolved in the same tick
 * from the bottom up, so by the time a higher one lands the one below it has
 * already occupied its cell.
 */
const landingRowFor = (c: number, fromRow: number): number => {
  for (let r = fromRow - 1; r >= 0; r--) {
    if (blocks.has(key(c, r))) return r + 1
  }
  return 0
}

// ─── Damage ─────────────────────────────────────────────────────────────────

const damageBlock = (b: Block, amount: number, fromY?: number): void => {
  // Armour is flat and floored at 1 damage, so a swarm of chip damage still
  // eventually eats a stone wall — armour buys time, never immunity. The roof's
  // divisor sits inside that same floor, for the same reason.
  let dealt = amount - armorFor(b)
  if (b.roof && isTopSide(b, fromY)) dealt /= ROOF_TOP_DEFENSE_DIV
  dealt = Math.max(1, dealt)
  b.hp -= dealt
  b.flash = 1
  pushFx({ kind: 'blockHit', x: b.c, y: b.r + 0.5, amount: dealt })

  if (b.hp > 0) return

  const wasGate = b.typeId === GATE_ID
  // One crate is enough: the streak asks for an UNTOUCHED wave, because a tower
  // that never loses a block is one the current curve cannot threaten.
  lostBlockThisWave = true
  removeBlock(b, true)
  resolveOrphans()
  syncTowerStats()

  if (wasGate) endRun()
}

/**
 * Apply damage to an enemy.
 *
 * `source` is the projectile kind that carried the damage, when there was one.
 * Melee (cavalry lances, spiked walls) and falling debris pass nothing, so an
 * arrow-proof engine still dies to those — the immunity is a statement about
 * arrows, not about being invincible.
 */
/**
 * What this individual bleeds.
 *
 * Read from the DESIGN bound to it, not from its type: a grunt is a Grumpling
 * or a Rattlejack depending on its uid, and one of those is a skeleton.
 * Machines shed sparks and scrap; anything with no design falls back to blood.
 */
const goreOf = (e: Enemy): string => {
  const def = enemyDef(e.typeId)
  if (def.siege) return 'metal'
  const mid = pickMonster(def.monster, e.uid)
  return mid ? monsterGore(mid) : 'blood'
}

const damageEnemy = (e: Enemy, amount: number, fromX: number, source?: ProjectileKind): void => {
  if (e.dying > 0) return
  const def = enemyDef(e.typeId)

  // Absolute immunity, checked before armour: the round hits, and does nothing.
  // It is drawn as a deflect rather than silently swallowed, because a player
  // who cannot see WHY their damage stopped just thinks the game is broken.
  if (source && def.immuneTo?.includes(source)) {
    pushFx({ kind: 'deflect', x: e.x, y: e.y })
    return
  }

  let dealt = amount
  // Frontal armour: only the side the enemy is facing (its travel direction)
  // is protected, so flanking fire — or simply out-ranging it — bypasses this.
  if (def.frontArmorPct && Math.sign(fromX - e.x) === e.dir) {
    dealt *= 1 - def.frontArmorPct
  }
  e.hp -= dealt
  e.flash = 1
  pushFx({
    kind: 'enemyHit', x: e.x, y: e.y, amount: Math.round(dealt),
    gore: goreOf(e),
    // Spray AWAY from whatever landed the hit.
    dir: Math.sign(e.x - fromX) || 1
  })
  if (e.hp <= 0) killEnemy(e)
}

/**
 * Test seam: damage a block directly.
 *
 * The collapse rules are the hardest part of the simulation to get right and
 * the easiest to break silently, so they need to be exercisable without
 * routing damage through an enemy that has to walk there first.
 */
export const damageBlockForTest = (b: Block, amount: number, fromY?: number): void => {
  damageBlock(b, amount, fromY)
}

const damageEnemiesInRadius = (
  x: number, y: number, radius: number, amount: number, source?: ProjectileKind
): void => {
  const r2 = radius * radius
  for (const e of enemies) {
    if (e.dying > 0) continue
    const dx = e.x - x
    const dy = e.y - y
    const d2 = dx * dx + dy * dy
    if (d2 > r2) continue
    // Linear falloff — a direct hit is meaningfully better than a graze, which
    // makes aiming splash at the densest cluster the correct instinct.
    const falloff = 1 - Math.sqrt(d2) / radius
    damageEnemy(e, amount * (0.4 + 0.6 * falloff), x, source)
  }
}

const killEnemy = (e: Enemy): void => {
  const def = enemyDef(e.typeId)
  e.dying = 320
  e.hp = 0
  kills.value++
  killsByType.value[e.typeId] = (killsByType.value[e.typeId] ?? 0) + 1
  triggerRef(killsByType)

  const drop = Math.max(1, Math.round(def.coins * mCoinDrop))
  runCoins.value += drop
  runCoinsEarned.value += drop
  pushFx({ kind: 'enemyDie', x: e.x, y: e.y, palette: def.palette, coins: drop, boss: !!def.boss })
}

// ─── Enemy AI ───────────────────────────────────────────────────────────────

/**
 * The block a ground enemy will bump into: the first occupied ground-row cell
 * along its travel direction. The Gate at (0, 0) guarantees this exists for as
 * long as the run does, so callers never have to handle "nothing to attack".
 */
const groundFrontier = (e: Enemy): Block | undefined => {
  let best: Block | undefined
  for (const b of blocks.values()) {
    if (b.r !== 0) continue
    if (e.dir === 1) {
      // Walking right: the leftmost block still ahead of us.
      if (b.c + 0.5 < e.x) continue
      if (!best || b.c < best.c) best = b
    } else {
      if (b.c - 0.5 > e.x) continue
      if (!best || b.c > best.c) best = b
    }
  }
  return best
}

/**
 * Flyers pick the HIGHEST block they can reach, biased toward the side they
 * came from. That's their whole design purpose: a player who stacks all their
 * defence at ground level has nothing pointed at the roof.
 */
/**
 * A siege engine's target.
 *
 * `targetsGate` engines (the ram) drive past the frontier and swing at the Gate
 * itself — a tower that walled its flanks but left the centre thin has no
 * answer. `ladderHeight` engines let their crew strike blocks several rows up,
 * so height alone stops being safety.
 */
const siegeTarget = (e: Enemy): Block | undefined => {
  const def = enemyDef(e.typeId)
  const siege = def.siege
  if (siege?.targetsGate) {
    const gate = blocksByUid.get(gateUid)
    if (gate) return gate
  }
  if (siege?.ladderHeight) {
    // Reach up the frontier column: prefer the highest block it can climb to,
    // which is what makes a siege tower feel like it is scaling the wall.
    const front = groundFrontier(e)
    if (!front) return undefined
    let best = front
    for (let r = 1; r <= siege.ladderHeight; r++) {
      const b = blockAt(front.c, r)
      if (b) best = b
    }
    return best
  }
  return groundFrontier(e)
}

const airTarget = (e: Enemy): Block | undefined => {
  let best: Block | undefined
  let bestScore = -Infinity
  for (const b of blocks.values()) {
    const score = b.r * 2 - Math.abs(b.c - e.x) * 0.35
    if (score > bestScore) { bestScore = score; best = b }
  }
  return best
}

/**
 * Highest occupied row in the tower, for a bomber's cruise altitude.
 *
 * A bomber holds station above the CROWN, not above its current target — using
 * the target's own row would let it drift down as it chews through the top of
 * the tower and end up inside anti-air range, which is exactly the thing this
 * enemy exists not to do.
 */
const crownRow = (): number => {
  let top = 0
  for (const b of blocks.values()) if (b.r > top) top = b.r
  return top
}

/** Drop one round from a bomber onto the tower below it. */
const dropOrdnance = (e: Enemy, def: EnemyDef, target: Block): void => {
  const run = def.bombRun!
  // A short lead so the round lands where the target IS rather than trailing
  // behind the bomber's own motion.
  const flight = Math.max(0.5, Math.sqrt(Math.max(0.2, e.y - (target.r + 0.5)) * 2 / GRAVITY))
  projectiles.push({
    uid: uidCounter++,
    kind: run.ordnance,
    x: e.x,
    y: e.y - 0.25,
    vx: e.dir * def.speed * flight * 0.35,
    vy: 0,
    damage: def.damage,
    splash: run.splash,
    ballistic: true,
    targetUid: -1,
    life: 6000,
    slowPct: 0,
    slowMs: 0,
    sourceUid: -1,
    hostile: true,
    burnMs: run.burnMs,
    burnDps: run.burnDps,
    trail: []
  })
  pushFx({ kind: 'bombDrop', x: e.x, y: e.y, fire: run.ordnance === 'fire' })
}

const stepEnemies = (dt: number): void => {
  const dtSec = dt / 1000

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i]!
    const def = enemyDef(e.typeId)

    if (e.dying > 0) {
      e.dying -= dt
      if (e.dying <= 0) enemies.splice(i, 1)
      continue
    }

    if (e.flash > 0) e.flash = Math.max(0, e.flash - dt / 160)
    if (e.slowMs > 0) {
      e.slowMs -= dt
      if (e.slowMs <= 0) e.slowPct = 0
    }
    e.phase += dtSec * (2.5 + def.speed)

    // Pay off any owed shove before the AI gets a say, so a knocked-back boss
    // visibly slides out instead of teleporting — and cannot walk during it.
    if (e.knockback) {
      const stepCells = Math.sign(e.knockback) * Math.min(Math.abs(e.knockback), KNOCKBACK_SPEED * dtSec)
      e.x += stepCells
      e.knockback -= stepCells
      if (Math.abs(e.knockback) < 0.01) e.knockback = 0
      continue
    }

    if (def.siege) e.spin = (e.spin ?? 0) + dtSec * def.speed * 2.6

    const target = def.movement === 'air'
      ? airTarget(e)
      : def.siege
        ? siegeTarget(e)
        : groundFrontier(e)
    if (!target) { e.targetUid = -1; continue }

    // ── Bombers ──
    // They never enter contact. A bomber flies to a station `altitude` cells
    // above the tower's CROWN and drops from there, so a player who answered
    // every previous flyer by putting the good blocks high up now has to point
    // something upward instead.
    if (def.bombRun) {
      const run = def.bombRun
      const stationY = crownRow() + 1 + run.altitude
      const toX = target.c - e.x
      const toY = stationY - e.y
      const speed = def.speed * (1 - e.slowPct)

      // Climb to station and close the horizontal gap independently, so a
      // bomber rising past the tower never clips through its crown.
      if (Math.abs(toY) > 0.05) {
        e.y += Math.sign(toY) * Math.min(Math.abs(toY), speed * dtSec * 1.4)
      }
      if (Math.abs(toX) > 0.06) {
        e.x += Math.sign(toX) * Math.min(Math.abs(toX), speed * dtSec)
      }
      e.y += Math.sin(e.phase * 1.3) * 0.006

      const overhead = Math.abs(target.c - e.x) < 0.55 && Math.abs(stationY - e.y) < 0.9
      e.targetUid = overhead ? target.uid : -1
      if (overhead) {
        e.cd -= dt
        if (e.cd <= 0) {
          e.cd = def.attackCooldownMs
          dropOrdnance(e, def, target)
        }
      }
      continue
    }

    const tx = target.c
    const ty = def.movement === 'air' ? target.r + 0.5 : e.y
    const dx = tx - e.x
    const dy = ty - e.y
    const dist = def.movement === 'air'
      ? Math.hypot(dx, dy) - 0.5
      : Math.abs(dx) - 0.5

    // ── Sea creatures ──
    // Two states, driven by `surfaced` (0 = submerged, 1 = fully reared up).
    // Submerged they are untouchable (see `pickTarget`), which is the whole
    // threat: a tower with no low, fast coverage simply cannot answer them
    // until they are already in its face.
    if (def.movement === 'sea') {
      const inRange = dist <= def.reach
      const rate = dt / (def.surfaceMs ?? 500)
      e.surfaced = Math.max(0, Math.min(1, (e.surfaced ?? 0) + (inRange ? rate : -rate)))
      // Rise out of the water as `surfaced` climbs; sink back if they lose reach.
      e.y = SEA_SWIM_Y + (SEA_STRIKE_Y - SEA_SWIM_Y) * e.surfaced

      if (!inRange) {
        const speed = def.speed * (1 - e.slowPct)
        e.targetUid = -1
        e.x += Math.sign(dx || e.dir) * speed * dtSec
        continue
      }
      // Mid-rise: winding up, not yet biting.
      if (e.surfaced < 1) { e.targetUid = target.uid; continue }

      e.targetUid = target.uid
      e.cd -= dt
      if (e.cd <= 0) {
        e.cd = def.attackCooldownMs
        damageBlock(target, def.damage, e.y)
        pushFx({
          kind: 'enemyAttack',
          x: e.x, y: e.y,
          tx: target.c, ty: target.r + 0.5,
          ranged: false,
          gore: goreOf(e)
        })
      }
      continue
    }

    // A standoff engine's "reach" IS its parking distance.
    const stopAt = def.siege?.standoff ?? def.reach

    if (dist > stopAt) {
      // Travel. `slowPct` is the frost tower's whole contribution, so it must
      // apply to the actual displacement, not just an animation speed.
      const speed = def.speed * (1 - e.slowPct)
      e.targetUid = -1
      if (def.movement === 'air') {
        const len = Math.hypot(dx, dy) || 1
        e.x += (dx / len) * speed * dtSec
        e.y += (dy / len) * speed * dtSec
        // Gentle bobbing so flight reads as flight.
        e.y += Math.sin(e.phase * 1.6) * 0.012
      } else {
        e.x += Math.sign(dx || e.dir) * speed * dtSec
      }
      continue
    }

    // In contact.
    e.targetUid = target.uid

    // Standoff siege: parks at `standoff` cells and lobs. Its shot splashes,
    // and crucially NOTHING in the tower reaches a trebuchet at 20 cells — the
    // only answer is to ride out and kill it.
    if (def.siege?.standoff) {
      e.cd -= dt
      if (e.cd <= 0) {
        e.cd = def.attackCooldownMs
        const splash = def.siege.splash ?? 0
        if (splash > 0) {
          pushFx({ kind: 'explosion', x: target.c, y: target.r + 0.5, radius: splash })
          damageBlocksInRadius(target.c, target.r + 0.5, splash, def.damage)
        } else {
          damageBlock(target, def.damage, e.y)
        }
        pushFx({
          kind: 'siegeShot',
          x: e.x, y: e.y,
          tx: target.c, ty: target.r + 0.5
        })
      }
      continue
    }

    if (def.suicide) {
      pushFx({ kind: 'explosion', x: e.x, y: e.y, radius: def.suicide.radius })
      // Bombers hit EVERY block in the blast, which is what makes them the
      // answer to a wall of cheap wood — one of them opens a real hole.
      damageBlocksInRadius(e.x, e.y, def.suicide.radius, def.suicide.damage)
      killEnemy(e)
      continue
    }

    e.cd -= dt
    if (e.cd <= 0) {
      e.cd = def.attackCooldownMs
      damageBlock(target, def.damage, e.y)
      applyThorns(target, e)
      pushFx({
        kind: 'enemyAttack',
        x: e.x, y: e.y,
        tx: target.c, ty: target.r + 0.5,
        ranged: def.reach > 2,
        gore: goreOf(e)
      })
    }
  }

  enemiesLeft.value = enemies.reduce((n, e) => n + (e.dying > 0 ? 0 : 1), 0)
    + Math.max(0, plan.orders.length - spawnCursor)
}

/**
 * Reflect a spiked wall's damage back at whatever just bit it.
 *
 * Deliberately NOT reduced by the attacker's armour: this is the wall, not a
 * weapon, so a Bulwark's frontal plating is irrelevant. Ranged attackers are
 * immune for the obvious reason — they never touched it.
 */
const applyThorns = (block: Block, attacker: Enemy): void => {
  const thorns = blockDef(block.typeId).utility?.thorns
  if (!thorns) return
  if (enemyDef(attacker.typeId).reach > 2) return
  damageEnemy(attacker, thorns * mThorns, block.c)
  pushFx({ kind: 'thorns', x: attacker.x, y: attacker.y })
}

/**
 * Set blocks alight.
 *
 * Burn is deliberately additive in DURATION but not in rate: a second molotov
 * on the same block refreshes the timer and takes the higher tick rate rather
 * than stacking two fires, so a cluster of firebugs is dangerous without being
 * an instant delete.
 */
const igniteBlocksInRadius = (
  x: number, y: number, radius: number, burnMs: number, burnDps: number
): void => {
  const r2 = radius * radius
  for (const b of blocks.values()) {
    const dx = b.c - x
    const dy = b.r + 0.5 - y
    if (dx * dx + dy * dy > r2) continue
    b.burnMs = Math.max(b.burnMs ?? 0, burnMs)
    b.burnDps = Math.max(b.burnDps ?? 0, burnDps)
  }
}

/**
 * Tick every burning block.
 *
 * Damage is applied on a fixed 500 ms cadence rather than per frame: a burn
 * that chipped fractional HP sixty times a second would spam the hit FX into
 * mush and make the damage numbers unreadable.
 */
const BURN_TICK_MS = 500
let burnAccum = 0

const stepBurning = (dt: number): void => {
  burnAccum += dt
  const ticks = Math.floor(burnAccum / BURN_TICK_MS)
  if (ticks <= 0) {
    // Still run the clock down so a fire visibly expires between ticks.
    for (const b of blocks.values()) {
      if (b.burnMs && b.burnMs > 0) b.burnMs = Math.max(0, b.burnMs - dt)
    }
    return
  }
  burnAccum -= ticks * BURN_TICK_MS

  // Snapshot: `damageBlock` can destroy blocks and trigger a collapse, which
  // mutates the map we would otherwise be iterating.
  const burning: Block[] = []
  for (const b of blocks.values()) {
    if (b.burnMs && b.burnMs > 0) burning.push(b)
  }

  for (const b of burning) {
    if (!blocksByUid.has(b.uid)) continue
    const elapsed = Math.min(b.burnMs ?? 0, ticks * BURN_TICK_MS)
    b.burnMs = Math.max(0, (b.burnMs ?? 0) - ticks * BURN_TICK_MS)
    const dmg = (b.burnDps ?? 0) * (elapsed / 1000)
    if (dmg <= 0) continue
    damageBlock(b, dmg)
    if (b.burnMs <= 0) b.burnDps = 0
  }
}

/** `y` is both the centre of the blast and where it came from. */
const damageBlocksInRadius = (x: number, y: number, radius: number, amount: number): void => {
  const r2 = radius * radius
  // Snapshot first: `damageBlock` can mutate the map (destruction + collapse).
  const hits: Block[] = []
  for (const b of blocks.values()) {
    const dx = b.c - x
    const dy = b.r + 0.5 - y
    if (dx * dx + dy * dy <= r2) hits.push(b)
  }
  for (const b of hits) {
    if (!blocksByUid.has(b.uid)) continue // already destroyed by an earlier hit
    damageBlock(b, amount, y)
  }
}

// ─── Allies ─────────────────────────────────────────────────────────────────

/** Coin price of one sortie. */
export const cavalryCost = (): number => ALLY_DEFS.cavalry!.cost

/**
 * Send a squad of riders out of the Gate.
 *
 * They pick a side by threat: whichever side holds the most valuable standoff
 * engine, falling back to whichever side has more enemies. Riding out at the
 * wrong siege engine is a wasted 40 coins, and the player should not have to
 * micromanage that — the decision the game wants from them is *whether* to
 * spend, not which pixel to click.
 */
export const summonCavalry = (): boolean => {
  if (phase.value === 'defeat') return false

  // Score each side; standoff engines dominate because they are the reason
  // cavalry exists at all.
  let leftScore = 0
  let rightScore = 0
  for (const e of enemies) {
    if (e.dying > 0) continue
    const def = enemyDef(e.typeId)
    const weight = def.siege?.standoff ? 100 + def.siege.standoff * 5 : 1
    if (e.x < 0) leftScore += weight
    else rightScore += weight
  }
  const dir: 1 | -1 = rightScore >= leftScore ? 1 : -1

  const def = ALLY_DEFS.cavalry!
  const hp = Math.round(def.hp * mCavalry)
  for (let i = 0; i < CAVALRY_SQUAD; i++) {
    allies.push({
      uid: uidCounter++,
      typeId: def.id,
      // Fan out slightly so a squad reads as three riders, not one sprite.
      x: dir * (0.8 + i * 0.55),
      y: def.scale / 2,
      hp,
      maxHp: hp,
      dir,
      cd: 0,
      targetUid: -1,
      flash: 0,
      phase: Math.random() * 6.28,
      dying: 0,
      life: def.lifeMs
    })
  }
  allyCount.value = allies.length
  pushFx({ kind: 'cavalryOut', x: 0, y: 0.5, dir })
  return true
}

const stepAllies = (dt: number): void => {
  const dtSec = dt / 1000

  for (let i = allies.length - 1; i >= 0; i--) {
    const a = allies[i]!
    const def = allyDef(a.typeId)

    if (a.dying > 0) {
      a.dying -= dt
      if (a.dying <= 0) allies.splice(i, 1)
      continue
    }

    a.life -= dt
    if (a.life <= 0) {
      // The sortie is over; the riders withdraw rather than dying on the field.
      a.dying = 280
      pushFx({ kind: 'allyLeave', x: a.x, y: a.y })
      continue
    }

    if (a.flash > 0) a.flash = Math.max(0, a.flash - dt / 160)
    a.phase += dtSec * 5

    // Target the most valuable thing on their side: siege engines first, then
    // whatever is nearest.
    let target: Enemy | null = null
    let bestScore = -Infinity
    for (const e of enemies) {
      if (e.dying > 0) continue
      const ed = enemyDef(e.typeId)
      if (ed.movement === 'air') continue // horses cannot reach flyers
      if (ed.movement === 'sea') continue
      if (Math.sign(e.x) !== a.dir && Math.abs(e.x) > 1) continue
      const score = (ed.siege ? 1000 : 0) - Math.abs(e.x - a.x)
      if (score > bestScore) { bestScore = score; target = e }
    }

    if (!target) {
      // Nothing left on this flank — patrol outward rather than idling.
      a.targetUid = -1
      a.x += a.dir * def.speed * 0.5 * dtSec
      continue
    }

    const dx = target.x - a.x
    if (Math.abs(dx) - 0.5 > def.reach) {
      a.targetUid = -1
      a.x += Math.sign(dx) * def.speed * dtSec
      continue
    }

    a.targetUid = target.uid
    a.cd -= dt
    if (a.cd <= 0) {
      a.cd = def.attackCooldownMs
      damageEnemy(target, def.damage * mCavalry, a.x)
      pushFx({ kind: 'allyStrike', x: a.x, y: a.y, tx: target.x, ty: target.y })
    }
  }

  allyCount.value = allies.reduce((n, a) => n + (a.dying > 0 ? 0 : 1), 0)
}

/** Enemies fight back: any melee enemy in contact with a rider hits it. */
const stepAllyCombat = (dt: number): void => {
  if (allies.length === 0) return
  for (const e of enemies) {
    if (e.dying > 0) continue
    const def = enemyDef(e.typeId)
    if (def.movement !== 'ground') continue
    for (const a of allies) {
      if (a.dying > 0) continue
      if (Math.abs(a.x - e.x) > 0.9) continue
      // Reuse the enemy's own attack clock so a unit cannot hit the tower and
      // a rider in the same beat.
      e.cd -= dt * 0.5
      if (e.cd <= 0) {
        e.cd = def.attackCooldownMs
        a.hp -= def.damage
        a.flash = 1
        if (a.hp <= 0) {
          a.dying = 280
          pushFx({ kind: 'allyDown', x: a.x, y: a.y })
        }
      }
      break
    }
  }
}

// ─── Turrets ────────────────────────────────────────────────────────────────

const pickTarget = (
  b: Block, range: number, hitsAir: boolean, mode: string, kind?: ProjectileKind
): Enemy | null => {
  const bx = b.c
  const by = b.r + 0.5
  const r2 = range * range
  let best: Enemy | null = null
  let bestScore = -Infinity

  for (const e of enemies) {
    if (e.dying > 0) continue
    const def = enemyDef(e.typeId)
    if (!hitsAir && def.movement === 'air') continue
    // Never lock onto something this weapon cannot hurt. Without this an
    // Archery block would happily empty its quiver into an ironclad ram while
    // the rest of the wave walked past it.
    if (kind && def.immuneTo?.includes(kind)) continue
    // A submerged sea creature is under the water and cannot be shot. It only
    // becomes a target once it has broken the surface to strike.
    if (def.movement === 'sea' && (e.surfaced ?? 0) < 0.35) continue
    const dx = e.x - bx
    const dy = e.y - by
    const d2 = dx * dx + dy * dy
    if (d2 > r2) continue

    let score: number
    if (mode === 'strongest') score = e.maxHp - Math.sqrt(d2) * 0.01
    else if (mode === 'lowest-hp') score = -e.hp
    else score = -d2 // nearest
    if (score > bestScore) { bestScore = score; best = e }
  }
  return best
}

const stepTurrets = (dt: number): void => {
  for (const b of blocks.values()) {
    if (b.flash > 0) b.flash = Math.max(0, b.flash - dt / 160)
    if (b.recoil > 0) b.recoil = Math.max(0, b.recoil - dt / 120)

    const def = blockDef(b.typeId)
    const w = def.weapon
    if (!w) continue

    if (b.cd > 0) {
      b.cd -= dt
      continue
    }

    const range = w.range * mRange
    const target = pickTarget(b, range, w.hitsAir, w.targeting, w.projectile)
    if (!target) continue

    const bx = b.c
    const by = b.r + 0.5
    b.aim = Math.atan2(target.y - by, target.x - bx)
    b.cd = w.cooldownMs / mFireRate
    b.recoil = 1
    const damage = w.damage * mDamage * (b.enhanced ? ENHANCED_DAMAGE_MUL : 1)

    if (w.projectile === 'zap') {
      fireLightning(b, target, damage, (w.chain ?? 0) + mChain, range)
    } else if (w.projectile === 'shell') {
      fireShell(b, target, damage, (w.splash ?? 0) * mSplash)
    } else {
      fireDirect(b, target, w.projectile, w.speed, damage,
        (w.splash ?? 0) * mSplash, w.slowPct ?? 0, w.slowMs ?? 0)
    }

    pushFx({ kind: 'muzzle', x: bx, y: by, angle: b.aim, palette: def.palette, weapon: b.typeId })
  }
}

const fireDirect = (
  b: Block, target: Enemy, kind: Projectile['kind'], speed: number,
  damage: number, splash: number, slowPct: number, slowMs: number
): void => {
  const bx = b.c
  const by = b.r + 0.5
  // Lead the target by its travel over the projectile's flight time, so fast
  // runners aren't systematically missed by slow cannonballs.
  const flight = Math.hypot(target.x - bx, target.y - by) / speed
  const def = enemyDef(target.typeId)
  const leadX = target.x + def.speed * (1 - target.slowPct) * target.dir * flight * 0.6
  const ang = Math.atan2(target.y - by, leadX - bx)

  projectiles.push({
    uid: uidCounter++,
    kind,
    x: bx + Math.cos(ang) * 0.45,
    y: by + Math.sin(ang) * 0.45,
    vx: Math.cos(ang) * speed,
    vy: Math.sin(ang) * speed,
    damage,
    splash,
    ballistic: false,
    targetUid: target.uid,
    life: 4000,
    slowPct,
    slowMs,
    sourceUid: b.uid,
    trail: []
  })
}

/**
 * Mortar: solve the ballistic arc that lands on the target's position.
 *
 * We fix the flight TIME rather than the muzzle speed — picking a time that
 * scales with distance gives a consistently readable, lazy arc at every range,
 * whereas a fixed speed produces a flat line up close and a silly lob far away.
 */
const fireShell = (b: Block, target: Enemy, damage: number, splash: number): void => {
  const bx = b.c
  const by = b.r + 0.5
  const dx = target.x - bx
  const dy = target.y - by
  const flight = Math.max(0.75, Math.min(2.2, Math.abs(dx) / 7 + 0.7))
  const vx = dx / flight
  const vy = dy / flight + 0.5 * GRAVITY * flight

  projectiles.push({
    uid: uidCounter++,
    kind: 'shell',
    x: bx, y: by,
    vx, vy,
    damage,
    splash,
    ballistic: true,
    targetUid: -1,
    life: flight * 1000 + 400,
    slowPct: 0,
    slowMs: 0,
    sourceUid: b.uid,
    trail: []
  })
}

/**
 * Tesla: hitscan with forking. Damage lands the same frame; the renderer draws
 * the polyline from the `lightning` FX payload. Each fork jumps to the nearest
 * not-yet-struck enemy within a shrinking radius and deals 70 % of the previous
 * link's damage.
 */
const fireLightning = (b: Block, first: Enemy, damage: number, forks: number, range: number): void => {
  const points: number[] = [b.c, b.r + 0.5]
  let current: Enemy | null = first
  let dmg = damage
  const struck = new Set<number>()

  for (let i = 0; i <= forks && current; i++) {
    points.push(current.x, current.y)
    struck.add(current.uid)
    damageEnemy(current, dmg, b.c)
    dmg *= 0.7

    const from = current
    let next: Enemy | null = null
    let bestD2 = (range * 0.55) * (range * 0.55)
    for (const e of enemies) {
      if (e.dying > 0 || struck.has(e.uid)) continue
      const dx = e.x - from.x
      const dy = e.y - from.y
      const d2 = dx * dx + dy * dy
      if (d2 < bestD2) { bestD2 = d2; next = e }
    }
    current = next
  }

  pushFx({ kind: 'lightning', x: b.c, y: b.r + 0.5, points })
}

const stepProjectiles = (dt: number): void => {
  const dtSec = dt / 1000

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]!
    p.life -= dt
    if (p.life <= 0) { projectiles.splice(i, 1); continue }

    if (p.ballistic) p.vy -= GRAVITY * dtSec

    p.x += p.vx * dtSec
    p.y += p.vy * dtSec

    // Ring buffer of trail samples, capped so a long-lived shell can't grow
    // an unbounded array in the hot path.
    p.trail.push(p.x, p.y)
    if (p.trail.length > 16) p.trail.splice(0, p.trail.length - 16)

    let detonate = false

    if (p.hostile) {
      // Dropped ordnance detonates on the first block it touches, or on the
      // ground if the player's tower has a hole in it. Checking the cell it is
      // passing through — rather than a radius sweep — keeps a bomb from
      // punching through the crown and exploding inside the tower.
      const cell = blockAt(Math.round(p.x), Math.floor(p.y))
      if (cell || p.y <= 0.3) detonate = true
    } else if (p.ballistic) {
      // Shells detonate on the ground, which is why they cannot touch flyers.
      if (p.y <= 0.25) detonate = true
    } else {
      const target = enemies.find((e) => e.uid === p.targetUid && e.dying <= 0)
      if (target) {
        const dx = target.x - p.x
        const dy = target.y - p.y
        if (dx * dx + dy * dy < 0.2) detonate = true
        // Re-home slightly so a projectile can't orbit a strafing target.
        const len = Math.hypot(p.vx, p.vy) || 1
        const ang = Math.atan2(dy, dx)
        p.vx += (Math.cos(ang) * len - p.vx) * Math.min(1, dtSec * 6)
        p.vy += (Math.sin(ang) * len - p.vy) * Math.min(1, dtSec * 6)
      } else if (p.y <= 0.15 || Math.abs(p.x) > 60) {
        // Target died mid-flight — the round still lands and can still splash.
        detonate = true
      }
    }

    if (!detonate) continue

    if (p.hostile) {
      // Enemy ordnance hurts the TOWER, never the wave that dropped it.
      const fire = p.kind === 'fire'
      pushFx({
        kind: fire ? 'firebomb' : 'explosion',
        x: p.x, y: p.y, radius: Math.max(0.6, p.splash), kindOf: p.kind
      })
      damageBlocksInRadius(p.x, p.y, Math.max(0.5, p.splash), p.damage)
      if (p.burnMs && p.burnDps) {
        igniteBlocksInRadius(p.x, p.y, Math.max(0.5, p.splash), p.burnMs, p.burnDps)
      }
      projectiles.splice(i, 1)
      continue
    }

    if (p.splash > 0) {
      pushFx({ kind: 'explosion', x: p.x, y: p.y, radius: p.splash, kindOf: p.kind })
      damageEnemiesInRadius(p.x, p.y, p.splash, p.damage, p.kind)
    } else {
      const target = enemies.find((e) => e.uid === p.targetUid && e.dying <= 0)
      if (target) damageEnemy(target, p.damage, p.x, p.kind)
      pushFx({
        kind: 'impact', x: p.x, y: p.y, kindOf: p.kind,
        // Debris throws along the round's own line of travel; a radial puff
        // reads as a decal stamped on the scene rather than as a hit.
        angle: Math.atan2(p.vy, p.vx)
      })
    }

    if (p.slowPct > 0) {
      const r = Math.max(p.splash, 0.6)
      for (const e of enemies) {
        if (e.dying > 0) continue
        if (Math.hypot(e.x - p.x, e.y - p.y) > r) continue
        e.slowPct = Math.max(e.slowPct, p.slowPct)
        e.slowMs = Math.max(e.slowMs, p.slowMs)
      }
    }

    projectiles.splice(i, 1)
  }
}

/**
 * Advance falling rubble, and settle whatever has landed.
 *
 * Orphaned blocks are NOT deleted: they fall until something stops them, take
 * damage in proportion to how far they fell, and rejoin the tower if they
 * survive. That turns a collapse from a pure loss into a consequence the player
 * can build around — a tall spire that loses its stem drops onto the mass below
 * and dents it, and a short one barely notices.
 *
 * `FALL_KILL_CELLS` is the whole scale: falling that far destroys a block
 * outright, and anything less costs a proportional slice of its max HP.
 */
const stepDebris = (dt: number): void => {
  const dtSec = dt / 1000

  // Settle from the BOTTOM up. A stack falling down one column has to land in
  // order, or the upper block resolves against a cell its neighbour has not
  // taken yet and the two end up inside each other.
  debris.sort((a, b) => (a.r + a.falling!.dy) - (b.r + b.falling!.dy))

  for (let i = 0; i < debris.length; i++) {
    const b = debris[i]!
    const f = b.falling!
    f.vy -= GRAVITY * dtSec
    f.dy += f.vy * dtSec
    f.rot += f.vrot * dtSec

    const fromRow = f.fromRow ?? b.r
    const landRow = landingRowFor(b.c, fromRow)
    const currentRow = b.r + f.dy
    if (currentRow > landRow) continue

    // ── Landed ──
    const fallCells = Math.max(0, fromRow - landRow)
    const impact = Math.min(1, fallCells / FALL_KILL_CELLS)

    crushEnemiesAt(b.c, landRow + 0.5, impact)
    triggerImpactFx(b, landRow, impact)

    debris.splice(i, 1)
    i--

    if (impact >= 1 || blocks.has(key(b.c, landRow))) {
      // Destroyed by the fall, or the cell was taken while it was in the air.
      pushFx({ kind: 'shatter', x: b.c, y: landRow + 0.5, palette: blockDef(b.typeId).palette })
      continue
    }

    // Survived — put it back in the tower at the row it came to rest on.
    b.r = landRow
    b.hp = Math.max(1, b.hp - b.maxHp * impact)
    b.flash = 1
    b.falling = undefined
    blocks.set(key(b.c, b.r), b)
    blocksByUid.set(b.uid, b)
  }

  if (debris.length === 0) return
  // A landed block can support — or orphan — others, so the graph is re-checked
  // once per tick rather than once per landing.
  syncTowerStats()
}

/**
 * Resolve what a landing block does to whatever is standing under it.
 *
 * A falling wall is lethal. Anything short of a boss caught beneath it dies
 * outright, regardless of HP — a block dropping on you is not a damage roll,
 * and the tower losing that block is already the price. It turns a collapse
 * from a pure loss into a trade the player can aim: undermine your own overhang
 * over a packed lane and it pays for itself.
 *
 * A boss is too big to squash. It takes a share of its MAX hp — percentage, so
 * the mechanic stays relevant against a health pool that grows every ten waves —
 * and is SHOVED CLEAR of the tower rather than pinned. Killing a boss with
 * falling masonry would trivialise the one fight the run is built around;
 * knocking it back buys the player the seconds they actually needed, and it
 * walks straight back in.
 */
const crushEnemiesAt = (x: number, y: number, impact: number): void => {
  const r2 = CRUSH_RADIUS * CRUSH_RADIUS
  // Snapshot: `killEnemy` mutates kill tallies and FX, and `damageEnemy` can
  // remove an enemy outright.
  const caught: Enemy[] = []
  for (const e of enemies) {
    if (e.dying > 0) continue
    const dx = e.x - x
    const dy = e.y - y
    if (dx * dx + dy * dy > r2) continue
    caught.push(e)
  }

  for (const e of caught) {
    if (e.dying > 0) continue
    const def = enemyDef(e.typeId)

    if (!def.boss) {
      pushFx({ kind: 'crush', x: e.x, y: e.y, palette: def.palette, boss: false })
      killEnemy(e)
      continue
    }

    // Away from the tower's centre column, so the shove always opens ground
    // between the boss and the Gate. A boss standing exactly on the centre is
    // pushed back the way it came.
    const away: 1 | -1 = e.x > 0 ? 1 : e.x < 0 ? -1 : (-e.dir as 1 | -1)
    e.knockback = away * BOSS_KNOCKBACK_CELLS
    e.targetUid = -1
    pushFx({ kind: 'crush', x: e.x, y: e.y, palette: def.palette, boss: true })
    damageEnemy(e, e.maxHp * BOSS_CRUSH_PCT * (0.45 + 0.55 * impact), x)
  }
}

/** Dust and a thump proportional to how hard the block hit. */
const triggerImpactFx = (b: Block, landRow: number, impact: number): void => {
  pushFx({
    kind: 'blockLand',
    x: b.c,
    y: landRow + 0.5,
    impact,
    palette: blockDef(b.typeId).palette
  })
}

// ─── Wave lifecycle ─────────────────────────────────────────────────────────

const cacheTechMultipliers = (): void => {
  mDamage = damageMul.value
  mFireRate = fireRateMul.value
  mRange = rangeMul.value
  mSplash = splashMul.value
  mChain = chainBonus.value
  mArmor = armorBonus.value
  mCoinDrop = coinDropMul.value
  mThorns = thornsMul.value
  mCavalry = cavalryMul.value
}

/** Start the next wave immediately. Called by the Call Wave button and by the
 *  build timer running out. */
export const callWave = (): void => {
  if (phase.value !== 'build') return
  cacheTechMultipliers()

  const next = wave.value + 1
  // Price the wave against what is actually standing, then apply the streak
  // penalty for coasting. Both are folded into the single `difficulty` scalar
  // the director already understands, so composition rules are untouched.
  const adaptive = adaptiveFactor(next, towerPower(measureTower()))
  const dynamic = adaptive * flawless.multiplier
  const mul = difficultyFactor() * dynamic
  difficultyMul.value = Math.round(mul * 100) / 100
  // Toughness takes a SOFTENED share of the dynamic terms, not the whole of
  // them. `adaptive` and the flawless streak already multiply the wave's head
  // count; feeding them into per-enemy HP at full strength multiplies the same
  // response twice, and the curve goes vertical the moment a player has a good
  // run — which is exactly the player it should be rewarding.
  waveHpMul = difficultyFactor() * Math.pow(dynamic, 0.45)
  lostBlockThisWave = false
  plan = planWave(next, mul)
  spawnCursor = 0
  waveClock = 0
  wave.value = next
  enemiesTotal.value = plan.total
  enemiesLeft.value = plan.total
  // The unused build time becomes a coin bonus, so an early call is a real
  // decision rather than a dead button.
  pendingBonus = earlyCallBonus(buildTimeLeft.value)
  phase.value = 'battle'
  lastWaveReward.value = null
  pushFx({ kind: 'waveStart', x: 0, y: 0, wave: next, boss: plan.boss })
}

let pendingBonus = 1

/**
 * This wave's ENEMY-TOUGHNESS scalar.
 *
 * Deliberately not the same number the wave director uses for composition —
 * see the derivation in `callWave`.
 */
let waveHpMul = 1

/** Put one enemy of `typeId` on the field, entering from `side`. */
const spawnEnemy = (typeId: string, side: 1 | -1): void => {
  const def = enemyDef(typeId)
  const bounds = towerBounds()
  const edge = side === 1 ? bounds.minC - SPAWN_MARGIN : bounds.maxC + SPAWN_MARGIN
  // The FULL wave scalar, not just the user's difficulty setting. This line
  // used to read `difficultyFactor()` alone, which meant the adaptive
  // difficulty — the whole system that measures the player's tower and prices
  // the wave against it — moved enemy COUNTS and never enemy toughness.
  const hp = Math.max(1, Math.round(def.hp * waveHpMul * enemyHpScale(wave.value)))
  // Bombers enter already at cruising height rather than climbing from the
  // dive lane — a bomber that spawned low would take its first pass THROUGH
  // the anti-air it exists to fly over.
  const spawnY = def.bombRun
    ? crownRow() + 1 + def.bombRun.altitude
    : def.movement === 'air'
      ? 2.4 + Math.random() * 2.2
      : def.movement === 'sea'
        ? SEA_SWIM_Y
        : def.scale / 2
  enemies.push({
    uid: uidCounter++,
    typeId: def.id,
    x: edge,
    y: spawnY,
    hp,
    maxHp: hp,
    dir: side,
    cd: 0,
    targetUid: -1,
    slowMs: 0,
    slowPct: 0,
    flash: 0,
    phase: Math.random() * 6.28,
    dying: 0,
    surfaced: def.movement === 'sea' ? 0 : undefined
  })
}

const stepSpawns = (dt: number): void => {
  waveClock += dt
  // Past the flush point the remaining queue is released at once. A wave that
  // is still trickling in after a minute and a half has stopped asking the
  // player anything — they have made every decision it has, and are watching a
  // queue drain. Better to hand them the rest and let the fight end.
  const flush = waveClock >= SPAWN_FLUSH_AT_MS
  while (spawnCursor < plan.orders.length
    && (flush || plan.orders[spawnCursor]!.atMs <= waveClock)) {
    const order = plan.orders[spawnCursor]!
    spawnCursor++
    spawnEnemy(order.typeId, order.side)
  }
}

/**
 * Put arbitrary enemies on the field, for development and review only.
 *
 * Reaching wave 24 by hand to look at one siege engine is not a reasonable ask,
 * and the alternative — poking `getEnemies()` from the console — silently fails
 * during development, because an HMR-versioned dynamic import hands back a
 * second, inert copy of this singleton. Going through an exported function on
 * the live module is the only way that reliably works.
 */
export const debugSpawn = (typeIds: string[]): void => {
  let side: 1 | -1 = 1
  for (const id of typeIds) {
    spawnEnemy(id, side)
    side = side === 1 ? -1 : 1
  }
  enemiesLeft.value = enemies.reduce((n, e) => n + (e.dying > 0 ? 0 : 1), 0)
}

const completeWave = (): void => {
  const base = waveReward(wave.value)
  const mul = waveRewardMul.value * pendingBonus

  let coins = Math.round(base.coins * mul)
  let gainedWood = Math.round(base.wood * mul)
  let gainedStone = Math.round(base.stone * mul)

  // Economy blocks pay out, and repair blocks patch their neighbours. Both
  // happen at the wave boundary so their value is legible: you SEE the numbers
  // move the moment the field clears.
  for (const b of blocks.values()) {
    const def = blockDef(b.typeId)
    if (def.economy) {
      gainedWood += def.economy.wood ?? 0
      gainedStone += def.economy.stone ?? 0
      coins += def.economy.coins ?? 0
    }
    const repair = def.utility?.repairPerWave
    if (repair) {
      for (const n of [blockAt(b.c - 1, b.r), blockAt(b.c + 1, b.r), blockAt(b.c, b.r - 1), blockAt(b.c, b.r + 1)]) {
        if (n) n.hp = Math.min(n.maxHp, n.hp + repair)
      }
    }
  }

  // Global between-wave repair from the tech tree, as a fraction of max HP.
  const globalRepair = waveRepairPct.value
  if (globalRepair > 0) {
    for (const b of blocks.values()) {
      b.hp = Math.min(b.maxHp, b.hp + b.maxHp * globalRepair)
    }
  }

  wood.value += gainedWood
  stone.value += gainedStone
  wavesClearedThisRun++

  // Surviving a wave pays into the WALLET immediately, not into the run tally.
  //
  // Kill drops stay in `runCoins` and are banked at the end of the run (where
  // the 2× rewarded ad can double them), but the wave reward has to land now:
  // a player who clears four waves and then loses should not discover they
  // earned nothing. The coin badge ticking up mid-run is the feedback that
  // makes "survive one more wave" feel paid.
  if (coins > 0) {
    useTowerEconomy().addCoins(coins)
    pushFx({ kind: 'coinPayout', x: 0, y: 0, amount: coins })
  }

  flawless.recordWave(lostBlockThisWave)
  flawlessProgress.value = flawless.progress

  lastWaveReward.value = {
    wave: wave.value,
    coins,
    wood: gainedWood,
    stone: gainedStone,
    bonusPct: Math.round((pendingBonus - 1) * 100),
    tally: { ...killsByType.value }
  }

  phase.value = 'build'
  buildTimeLeft.value = buildTimeMs(wave.value + 1)
  buildDeadline = buildTimeLeft.value
  syncGateRefs()
  saveRunSnapshot()
  pushFx({ kind: 'waveClear', x: 0, y: 0, wave: wave.value })
}

const syncGateRefs = (): void => {
  const gate = blocksByUid.get(gateUid)
  gateHp.value = gate ? Math.max(0, gate.hp) : 0
  gateMaxHp.value = gate ? gate.maxHp : 1
}

/**
  * The tower as it stood at the START of the wave that killed it.
  *
  * `endRun` drops the resume snapshot from storage so the next boot does not
  * restore a run whose gate is already rubble — but that snapshot is exactly
  * what a continue needs, so it is kept in memory for the length of the defeat
  * screen and nowhere else. It deliberately does not survive a reload: a grace
  * chance is for the run you are looking at.
  */
let graceSnapshot: RunSnapshot | null = null
let graceUsed = false

/** Is a continue on the table? One per run, and only if there is a wave to go back to. */
export const graceAvailable = ref(false)

/**
 * Rebuild the tower as it was and re-enter the build phase for the wave that
 * killed it.
 *
 * Restores from the same snapshot the resume path uses, so it recovers the
 * exact layout, resources and wave — not an approximation of them.
 */
export const continueRun = (): boolean => {
  if (!graceSnapshot || graceUsed) return false
  setState(RUN_KEY, graceSnapshot)
  const ok = resumeRun()
  if (!ok) return false
  graceUsed = true
  graceAvailable.value = false
  graceSnapshot = null
  return true
}

const endRun = (): void => {
  phase.value = 'defeat'
  // Consolation floor. A run that ends on wave 1 with no kills would otherwise
  // pay literally nothing, which reads as the game being broken rather than as
  // a hard loss — and it is exactly the run a new player is most likely to have.
  const floor = 5 + wavesClearedThisRun * 4
  if (runCoins.value < floor) {
    runCoinsEarned.value += floor - runCoins.value
    runCoins.value = floor
  }
  // The run is over — drop the resume snapshot so the next boot starts fresh
  // rather than restoring a tower whose gate is already rubble. Hold it in
  // memory first, though: it is what a grace continue rebuilds from.
  graceSnapshot = getState<RunSnapshot | null>(RUN_KEY, null)
  graceAvailable.value = !graceUsed && !!graceSnapshot?.blocks?.length
  removeState(RUN_KEY)
  pushFx({ kind: 'gateFell', x: 0, y: 0 })
}

// ─── Persistence ────────────────────────────────────────────────────────────

/** Serialise the live siege into `ts_run`. Called at every build-phase entry
 *  (cheap: a few hundred 4-tuples) so a reload resumes the exact tower. */
export const saveRunSnapshot = (): void => {
  if (phase.value === 'defeat') return
  const snapshot: RunSnapshot = {
    wave: wave.value,
    wood: wood.value,
    stone: stone.value,
    runCoins: runCoins.value,
    kills: kills.value,
    killsByType: { ...killsByType.value },
    blocks: [...blocks.values()].map(
      (b) => [
        b.c, b.r, b.typeId, Math.round(b.hp), b.roof ? 1 : 0, b.enhanced ? 1 : 0
      ] as [number, number, string, number, 0 | 1, 0 | 1]
    ),
    // Persisted so a reload can't be used to reroll a hand the player dislikes.
    offers: offers.value.slice(),
    startedAt: Date.now()
  }
  setState(RUN_KEY, snapshot)
}

export const hasSavedRun = (): boolean => {
  const snap = getState<RunSnapshot | null>(RUN_KEY, null)
  return !!snap && Array.isArray(snap.blocks) && snap.blocks.length > 0
}

// ─── Run lifecycle ──────────────────────────────────────────────────────────

const clearWorld = (): void => {
  blocks.clear()
  blocksByUid.clear()
  enemies.length = 0
  projectiles.length = 0
  debris.length = 0
  allies.length = 0
  allyCount.value = 0
  spawnCursor = 0
  waveClock = 0
  plan = { wave: 0, orders: [], total: 0, boss: false }
}

const spawnGate = (hp?: number): void => {
  const gate = spawnBlock(GATE_ID, 0, 0, false, hp)
  gateUid = gate.uid
  syncGateRefs()
}

/** Begin a brand-new siege. */
export const startRun = (): void => {
  clock = 0
  accumulator = 0
  clearWorld()
  wave.value = 0
  wood.value = startWood.value
  stone.value = startStone.value
  runCoins.value = 0
  runCoinsEarned.value = 0
  graceSnapshot = null
  graceUsed = false
  graceAvailable.value = false
  kills.value = 0
  killsByType.value = {}
  triggerRef(killsByType)
  blocksPlacedThisRun = 0
  wavesClearedThisRun = 0
  pendingBonus = 1
  // The streak penalty is earned within a run and dies with it — carrying a
  // trebled wave 1 into a fresh attempt would be indefensible.
  flawless.reset()
  flawlessProgress.value = 0
  difficultyMul.value = 1
  lostBlockThisWave = false
  lastWaveReward.value = null
  cacheTechMultipliers()
  spawnGate()
  syncTowerStats()
  dealOffers()
  rerollReadyIn.value = 0
  phase.value = 'build'
  buildTimeLeft.value = buildTimeMs(1)
  buildDeadline = buildTimeLeft.value
  saveRunSnapshot()
}

/** Restore the persisted siege. Returns false when there is nothing to resume,
 *  so the caller can fall back to `startRun()`. */
export const resumeRun = (): boolean => {
  const snap = getState<RunSnapshot | null>(RUN_KEY, null)
  if (!snap || !Array.isArray(snap.blocks) || snap.blocks.length === 0) return false

  clock = 0
  accumulator = 0
  clearWorld()
  cacheTechMultipliers()

  wave.value = Math.max(0, Math.floor(snap.wave) || 0)
  wood.value = Math.max(0, Math.floor(snap.wood) || 0)
  stone.value = Math.max(0, Math.floor(snap.stone) || 0)
  runCoins.value = Math.max(0, Math.floor(snap.runCoins) || 0)
  // A resumed run has no record of what was already spent, so the best
  // available floor for the progression feed is the balance it resumes with.
  runCoinsEarned.value = runCoins.value
  kills.value = Math.max(0, Math.floor(snap.kills) || 0)
  killsByType.value = { ...(snap.killsByType ?? {}) }
  triggerRef(killsByType)
  blocksPlacedThisRun = 0
  wavesClearedThisRun = 0
  pendingBonus = 1

  let gateRestored = false
  for (const tuple of snap.blocks) {
    if (!Array.isArray(tuple) || tuple.length < 4) continue
    const [c, r, typeId, hp, roof, enhanced] = tuple
    if (typeof c !== 'number' || typeof r !== 'number' || typeof typeId !== 'string') continue
    if (!BLOCK_DEFS[typeId]) continue
    if (typeId === GATE_ID) {
      spawnGate(Math.max(1, Number(hp) || 1))
      gateRestored = true
      continue
    }
    const isEnhanced = enhanced === 1
    const maxHp = maxHpFor(typeId, isEnhanced, roof === 1)
    // Clamp HP to the CURRENT max: a tech purchase between sessions should
    // raise the ceiling, never leave a block sitting above it.
    const restored = spawnBlock(
      typeId, c, r, roof === 1,
      Math.max(1, Math.min(maxHp, Number(hp) || maxHp)),
      isEnhanced
    )
    restored.bornAt = -9999 // skip the pop-in animation for restored blocks
  }

  // A snapshot without a gate is corrupt — rebuild one rather than booting an
  // unwinnable run.
  if (!gateRestored) spawnGate()
  // The restored layout may reference a narrower build width than the player
  // now has, or (after a corrupt write) contain floating blocks — settle it.
  resolveOrphans()
  syncTowerStats()

  // Restore the exact hand the player was looking at. Anything the snapshot
  // doesn't cover (an older save, a shape since removed from the catalogue) is
  // filled with a fresh roll rather than left blank.
  const saved = Array.isArray(snap.offers) ? snap.offers : []
  const restoredOffers = saved.filter((id) => typeof id === 'string' && SHAPE_BY_ID[id])
  offers.value = restoredOffers.length === OFFER_SLOTS ? restoredOffers : rollOffers(wave.value, availableBlocks.value)

  phase.value = 'build'
  buildTimeLeft.value = buildTimeMs(wave.value + 1)
  buildDeadline = buildTimeLeft.value
  return true
}

/** Stats for the run-summary screen. */
export const runSummary = () => ({
  wave: wave.value,
  wavesCleared: wavesClearedThisRun,
  kills: kills.value,
  /** Leaderboard score — see `runScore`. */
  score: runScore.value,
  killsByType: { ...killsByType.value },
  coins: runCoins.value,
  // What the run EARNED, before anything was spent on blocks. Progression
  // (daily missions, lifetime-coin achievements) has to read this rather than
  // the balance, or spending gold would look like the counter running
  // backwards — which the mission feed interprets as a brand-new run.
  coinsEarned: runCoinsEarned.value,
  height: towerHeight.value,
  blocks: blockCount.value,
  blocksPlaced: blocksPlacedThisRun
})

// ─── Fixed-step driver ──────────────────────────────────────────────────────

const fixedStep = (dt: number): void => {
  clock += dt
  if (rerollReadyIn.value > 0) rerollReadyIn.value = Math.max(0, rerollReadyIn.value - dt)

  if (phase.value === 'build') {
    buildDeadline -= dt
    buildTimeLeft.value = Math.max(0, buildDeadline)
    if (buildDeadline <= 0) callWave()
    // Turrets still cool down and debris still settles between waves, so the
    // build phase never looks frozen.
    stepTurrets(dt)
    stepDebris(dt)
    stepAllies(dt)
    stepBurning(dt)
    return
  }

  if (phase.value === 'defeat') {
    // Let the collapse finish playing out under the defeat screen.
    stepDebris(dt)
    stepProjectiles(dt)
    return
  }

  stepSpawns(dt)
  stepEnemies(dt)
  stepAllies(dt)
  stepAllyCombat(dt)
  stepTurrets(dt)
  stepProjectiles(dt)
  stepDebris(dt)
  stepBurning(dt)
  syncGateRefs()

  const allSpawned = spawnCursor >= plan.orders.length
  // `enemies.length`, not "every enemy is dying".
  //
  // A dying enemy is still on screen for the length of its death animation, so
  // completing the wave the instant the last one STARTED dying put the
  // wave-clear toast over a corpse that was still fading out. Waiting for the
  // array to drain costs a few hundred milliseconds and removes the overlap.
  const noneAlive = enemies.length === 0
  // Fires are deliberately NOT part of this check: a molotov is meant to keep
  // eating the crown into the build phase, and holding the wave open for it
  // would just deny the player their payout while they watch it burn.
  if (allSpawned && noneAlive && projectiles.length === 0) completeWave()
}

// ─── Double speed ───────────────────────────────────────────────────────────
//
// 2× is a TIMED BUFF bought with a rewarded video, not a free toggle. It is
// worth paying for because it compresses the part of a wave the player has
// already solved — once the tower is built and the shooting starts, the
// decisions are made and the rest is watching. Five minutes covers several
// waves, so one video is a real purchase rather than a per-wave tax.

/** How long one purchase of 2× lasts, ms. */
export const SPEED_BUFF_MS = 5 * 60 * 1000

/** Remaining 2× time, ms. Drives the HUD countdown. */
export const speedBuffLeft = ref(0)
export const isSpeedBuffed = computed(() => speedBuffLeft.value > 0)

/** Grant (or extend) the 2× buff. Called after the rewarded video completes. */
export const grantSpeedBuff = (): void => {
  // Extends rather than replaces: a player who watches a second video part-way
  // through the first buff must not lose the time they already paid for.
  speedBuffLeft.value = Math.min(SPEED_BUFF_MS * 2, speedBuffLeft.value + SPEED_BUFF_MS)
  gameSpeed.value = 2
}

/**
 * Tick the buff down.
 *
 * Uses REAL elapsed time, not simulated time — the buff is five minutes of the
 * player's life, and running it off the accelerated clock would make it expire
 * twice as fast precisely because they bought it.
 */
const stepSpeedBuff = (realDt: number): void => {
  if (speedBuffLeft.value <= 0) {
    if (gameSpeed.value !== 1) gameSpeed.value = 1
    return
  }
  speedBuffLeft.value = Math.max(0, speedBuffLeft.value - realDt)
  if (speedBuffLeft.value <= 0) gameSpeed.value = 1
}

/** Turn 2× off (or back on) without spending the remaining buff time. */
export const toggleSpeed = (): void => {
  if (!isSpeedBuffed.value) {
    gameSpeed.value = 1
    return
  }
  gameSpeed.value = gameSpeed.value === 1 ? 2 : 1
}

/**
 * Advance the simulation by `dtMs` of real time. Accumulates into fixed 60 Hz
 * substeps (capped) so physics is deterministic regardless of display refresh
 * rate and a long stall can't teleport the siege forward.
 */
export const step = (dtMs: number): void => {
  if (dtMs <= 0) return
  // Real elapsed time, before the speed multiplier — the buff is five minutes
  // of the player's life, not five minutes of simulated siege.
  stepSpeedBuff(dtMs)
  const scaled = dtMs * (phase.value === 'battle' ? gameSpeed.value : 1)
  accumulator += Math.min(scaled, TICK_MS * MAX_SUBSTEPS)
  let steps = 0
  while (accumulator >= TICK_MS && steps < MAX_SUBSTEPS * 2) {
    fixedStep(TICK_MS)
    accumulator -= TICK_MS
    steps++
  }
}

export default function useTowerGame() {
  return {
    phase, wave, wood, stone, runCoins, kills, killsByType,
    enemiesLeft, enemiesTotal, gateHp, gateMaxHp, gateHpPct,
    buildTimeLeft, blockCount, towerHeight, gameSpeed, towerVersion,
    lastWaveReward, isBossIncoming, offers, offerEnhanced,
    rerollReadyIn, allyCount,
    startRun, resumeRun, hasSavedRun, saveRunSnapshot,
    placeBlock, placeShape, sellBlock, canPlaceAt, canPlaceShapeAt,
    canAfford, canAffordShape, rerollOffer, manualReroll, canManualReroll,
    dealEnhancedOffers, summonCavalry, cavalryCost,
    callWave, toggleSpeed, step, runSummary, towerBounds, blockAt, halfWidthAt
  }
}

export { blockAt, ENEMY_DEFS }
