/**
 * Fixed-capacity pools for enemies and projectiles. Slots are recycled; the
 * renderer keys its views by slot index and uses `serial` to notice that a
 * slot was reused for a new entity.
 */

import { ENEMY, HERO_HP, HERO_X, HERO_Z } from './config'
import type { Enemy, EnemyType, Hero, Projectile, ProjectileType } from './types'

export const MAX_ENEMIES = 72
export const MAX_PROJECTILES = 48

export const createEnemyPool = (): Enemy[] => {
  const out: Enemy[] = []
  for (let i = 0; i < MAX_ENEMIES; i++) {
    out.push({
      id: i, type: 'knight', state: 'dead',
      x: 0, z: 0, y: 0, vx: 0, vy: 0, vz: 0,
      lane: -1, tx: 0, speed: 0, hp: 0, age: 0, cool: 0, phase: 0, spin: 0,
      size: 1, fold: -1, windup: 0, towardLens: false, serial: 0
    })
  }
  return out
}

export const createProjectilePool = (): Projectile[] => {
  const out: Projectile[] = []
  for (let i = 0; i < MAX_PROJECTILES; i++) {
    out.push({
      id: i, alive: false, type: 'arrow',
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, tx: 0, tz: 0,
      age: 0, life: 0, owner: -1, stuck: false, serial: 0
    })
  }
  return out
}

export const createHero = (): Hero => ({
  x: HERO_X, z: HERO_Z, hp: HERO_HP, maxHp: HERO_HP, invuln: 0, mood: 'idle', moodTimer: 0, rev: 0
})

let serialCounter = 1

/** Claim a free enemy slot, or -1 if the pool is full. */
export const spawnEnemy = (
  pool: Enemy[], type: EnemyType, x: number, z: number, lane: number, jitter: number
): number => {
  for (let i = 0; i < pool.length; i++) {
    const e = pool[i]!
    if (e.state !== 'dead') continue
    const t = ENEMY[type]
    e.type = type
    e.state = t.speed > 0 ? 'march' : 'stand'
    e.x = x
    e.z = z
    e.y = 0
    e.vx = 0
    e.vy = 0
    e.vz = 0
    e.lane = lane
    // `tx` doubles as the personal lateral offset from the lane centre so a
    // column reads as a crowd, not a queue of clones.
    e.tx = jitter
    e.speed = t.speed * (0.94 + Math.abs(jitter) * 0.12)
    e.hp = t.hp
    e.age = 0
    e.cool = 0
    e.phase = Math.abs(jitter) * 7
    e.spin = 0
    e.size = t.size
    e.fold = -1
    e.windup = 0
    e.towardLens = false
    e.serial = serialCounter++
    return i
  }
  return -1
}

export const spawnProjectile = (
  pool: Projectile[], type: ProjectileType,
  x: number, y: number, z: number, vx: number, vy: number, vz: number,
  tx: number, tz: number, life: number, owner: number
): number => {
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i]!
    if (p.alive) continue
    p.alive = true
    p.type = type
    p.x = x
    p.y = y
    p.z = z
    p.vx = vx
    p.vy = vy
    p.vz = vz
    p.tx = tx
    p.tz = tz
    p.age = 0
    p.life = life
    p.owner = owner
    p.stuck = false
    p.serial = serialCounter++
    return i
  }
  return -1
}

/** Enemy counts as "on the board" for wave/page completion. */
export const isAlive = (e: Enemy): boolean =>
  e.state === 'march' || e.state === 'blocked' || e.state === 'trapped' || e.state === 'stand'

/** Anything still animating (flying, being crushed) — the slot is not free yet. */
export const isActive = (e: Enemy): boolean => e.state !== 'dead'

export const resetPools = (enemies: Enemy[], projectiles: Projectile[]): void => {
  for (const e of enemies) e.state = 'dead'
  for (const p of projectiles) p.alive = false
}
