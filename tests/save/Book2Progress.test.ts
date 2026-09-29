import { describe, expect, it } from 'vitest'
import { computeMeta } from '@/utils/save/SaveMergePolicy'
import { STATE_KEY } from '@/use/useAethelState'

const reader = (state: Record<string, unknown>) => ({
  get: (k: string) => (k === STATE_KEY ? JSON.stringify(state) : null)
})

describe('book 2 progress in the merge score', () => {
  it('a save deep into book 2 beats one that only finished book 1', () => {
    const book1Only = computeMeta(reader({ fold_cleared: 6, fold_wins: 1, fold_page: 1 }))
    const intoBook2 = computeMeta(reader({ fold_cleared: 6, fold_wins: 1, fold_cleared2: 3, fold_book: 2, fold_page: 4 }))
    expect(intoBook2.progressScore).toBeGreaterThan(book1Only.progressScore)
  })

  it('a book 2 win counts like a book 1 win', () => {
    const one = computeMeta(reader({ fold_cleared: 6, fold_wins: 1 }))
    const both = computeMeta(reader({ fold_cleared: 6, fold_wins: 1, fold_cleared2: 6, fold_wins2: 1 }))
    expect(both.progressScore - one.progressScore).toBe(6 * 1000 + 5000)
  })
})
