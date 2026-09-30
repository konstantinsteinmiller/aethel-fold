import { describe, expect, it } from 'vitest'
import { FoldGame } from '@/fold/logic/game'
import { ALMOST, CRUMPLE_TIME, HERO_HP, SECOND_CHANCE } from '@/fold/logic/config'
import { spawnEnemy } from '@/fold/logic/entities'
import type { FoldEventType } from '@/fold/logic/events'
import type { PageId } from '@/fold/logic/types'

// Roadmap #19: the rewarded second chance. The logic is pure: the view only
// switches the offer on (`setSecondChance`) and answers it (`restoreHeart` /
// `declineSecondChance`); whether an ad exists is none of the game's business.

const ALL_LEARNED = {
  swipe: true, stamp: true, shield: true, launch: true, ridge: true, spread: true, peel: true, crease: true, core: true,
  frog: true, crush: true, sling: true, leaper: true, ballista: true, shelf: true
}

const game = (page: PageId = 2, on = true): FoldGame => {
  const g = new FoldGame({ seed: 7, learned: ALL_LEARNED })
  g.startRun(page)
  g.setSecondChance(on)
  return g
}

const seen: FoldEventType[] = []
const step = (g: FoldGame, seconds: number): void => {
  for (let t = 0; t < seconds; t += 1 / 60) {
    g.update(1 / 60)
    for (let i = 0; i < g.events.count; i++) seen.push(g.events.items[i]!.type)
    g.events.clear()
  }
}
const drain = (g: FoldGame): void => {
  for (let i = 0; i < g.events.count; i++) seen.push(g.events.items[i]!.type)
  g.events.clear()
}

/** Take every heart (the same private door a knight at the gate uses). */
const loseAllHearts = (g: FoldGame): void => {
  const hurt = (g as unknown as { hurtHero(x: number, z: number): void }).hurtHero.bind(g)
  for (let k = 0; k < HERO_HP; k++) {
    g.hero.invuln = 0
    hurt(0, 5)
  }
  drain(g)
}

const settle = (g: FoldGame): void => {
  step(g, 3)
  seen.length = 0
}

describe('rewarded second chance (#19)', () => {
  it('is off unless the view switches it on: the jury build crumples on the third heart as before', () => {
    const g = game(2, false)
    settle(g)
    loseAllHearts(g)
    expect(g.phase).toBe('crumple')
    expect(g.defeated).toBe(true)
    expect(g.lastChance).toBe(0)
    expect(seen).not.toContain('lastChance')
  })

  it('holds the world on the last heart with the offer up', () => {
    const g = game()
    settle(g)
    spawnEnemy(g.enemies, 'knight', 0, 0, 0, 0)
    loseAllHearts(g)
    expect(g.hero.hp).toBe(0)
    expect(g.phase).toBe('play')
    expect(g.lastChance).toBe(SECOND_CHANCE.window)
    expect(g.secondChanceUsed).toBe(true)
    expect(seen).toContain('heroDown')
    expect(seen).toContain('lastChance')
    expect(g.acceptsInput()).toBe(false)
    const zs = g.enemies.filter((e) => e.state !== 'dead').map((e) => e.z)
    const phaseTime = g.phaseTime
    const runTime = g.runTime
    step(g, 1)
    expect(g.enemies.filter((e) => e.state !== 'dead').map((e) => e.z)).toEqual(zs)
    expect(g.phaseTime).toBe(phaseTime)
    expect(g.runTime).toBe(runTime)
    expect(g.lastChance).toBeCloseTo(SECOND_CHANCE.window - 1, 1)
  })

  it('restoreHeart gives one heart back, the grace, and play carries on', () => {
    const g = game()
    settle(g)
    loseAllHearts(g)
    g.projectiles[0]!.alive = true
    expect(g.restoreHeart()).toBe(true)
    drain(g)
    expect(seen).toContain('heartRestored')
    expect(g.hero.hp).toBe(SECOND_CHANCE.hearts)
    expect(g.hero.invuln).toBe(ALMOST.grace)
    expect(g.hero.mood).toBe('walk')
    expect(g.lastChance).toBe(0)
    expect(g.projectiles.every((p) => !p.alive)).toBe(true)
    expect(g.acceptsInput()).toBe(true)
    const t = g.phaseTime
    step(g, 0.5)
    expect(g.phaseTime).toBeGreaterThan(t)
    expect(g.phase).toBe('play')
    // Nothing open: a second call does nothing.
    expect(g.restoreHeart()).toBe(false)
  })

  it('is offered once per page: the next last heart crumples straight away', () => {
    const g = game()
    settle(g)
    loseAllHearts(g)
    g.restoreHeart()
    step(g, ALMOST.grace + 0.5)
    seen.length = 0
    loseAllHearts(g)
    expect(g.phase).toBe('crumple')
    expect(seen).not.toContain('lastChance')
  })

  it('a retry of the same page does not bring it back; the next page does', () => {
    const g = game()
    settle(g)
    loseAllHearts(g)
    g.declineSecondChance()
    step(g, CRUMPLE_TIME + 0.1)
    expect(g.tryAgain()).toBe(true)
    step(g, 2)
    loseAllHearts(g)
    expect(g.phase).toBe('crumple')
    // A fresh page after the continue is spent: still the same page.
    step(g, ALMOST.autoRetry + 1)
    step(g, 2)
    loseAllHearts(g)
    expect(g.phase).toBe('crumple')
    expect(g.lastChance).toBe(0)
    // Another page: offered again.
    const h = new FoldGame({ seed: 7, learned: ALL_LEARNED })
    h.startRun(2)
    h.setSecondChance(true)
    step(h, 3)
    loseAllHearts(h)
    h.declineSecondChance()
    h.loadPage(3)
    expect(h.secondChanceUsed).toBe(false)
    step(h, 3)
    loseAllHearts(h)
    expect(h.lastChance).toBe(SECOND_CHANCE.window)
  })

  it('declining crumples into the Almost! moment with its Try again', () => {
    const g = game()
    settle(g)
    loseAllHearts(g)
    expect(g.declineSecondChance()).toBe(true)
    drain(g)
    expect(seen).toContain('crumple')
    expect(g.phase).toBe('crumple')
    expect(g.defeated).toBe(true)
    expect(g.lastChance).toBe(0)
    expect(g.declineSecondChance()).toBe(false)
    step(g, CRUMPLE_TIME + 0.1)
    expect(g.tryAgain()).toBe(true)
    expect(g.hero.hp).toBe(HERO_HP)
  })

  it('left alone, the offer runs out and the page crumples', () => {
    const g = game()
    settle(g)
    loseAllHearts(g)
    step(g, SECOND_CHANCE.window - 0.2)
    expect(g.phase).toBe('play')
    step(g, 0.4)
    expect(g.phase).toBe('crumple')
    expect(g.defeated).toBe(true)
  })

  it('the offer waits while the game is paused (menu or ad) and a late reward still lands', () => {
    const g = game()
    settle(g)
    loseAllHearts(g)
    g.paused = true
    step(g, SECOND_CHANCE.window + 2)
    expect(g.lastChance).toBe(SECOND_CHANCE.window)
    // The ad's pause may not have lifted yet when the reward is granted.
    expect(g.restoreHeart()).toBe(true)
    g.paused = false
    step(g, 0.2)
    expect(g.phase).toBe('play')
    expect(g.hero.hp).toBe(1)
  })

  it('a pause-menu restart during the offer is an ordinary forfeit', () => {
    const g = game()
    settle(g)
    loseAllHearts(g)
    g.forfeitPage()
    expect(g.phase).toBe('crumple')
    expect(g.defeated).toBe(false)
    expect(g.lastChance).toBe(0)
  })

  it('is never offered in a Dragon Rush', () => {
    const g = new FoldGame({ seed: 7, learned: ALL_LEARNED })
    g.startRun({ mode: 'dragonRush', book: 1 })
    g.setSecondChance(true)
    step(g, 2)
    loseAllHearts(g)
    expect(g.phase).toBe('crumple')
    expect(g.lastChance).toBe(0)
  })
})
