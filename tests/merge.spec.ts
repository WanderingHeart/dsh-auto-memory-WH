import { describe, expect, it } from 'vitest'
import { buildMergedBody, mergedDescription, suggestMergeClusters } from '../src/merge.ts'
import type { MemoryRecord } from '../src/types.ts'

function record(name: string, body: string, extra: Record<string, unknown> = {}) {
  return { name, title: name, description: body, type: 'reference', status: 'verified', revision: 'a'.repeat(64), updatedMs: 1, body, scope: 'project', ...extra } as unknown as MemoryRecord
}

describe('topic merge suggestions', () => {
  it('clusters records sharing several distinctive tokens', () => {
    const clusters = suggestMergeClusters([
      record('ts-build', 'typescript build pipeline uses esbuild for bundling'),
      record('ts-build-notes', 'typescript build pipeline also bundles tests with esbuild'),
      record('grocery', 'buy milk and eggs for breakfast'),
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.members.map(member => member.name).sort()).toEqual(['ts-build', 'ts-build-notes'])
    expect(clusters[0]!.sharedTokens).toEqual(expect.arrayContaining(['typescript', 'esbuild']))
    expect(clusters[0]!.suggestedName).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(clusters[0]!.suggestedName.length).toBeLessThanOrEqual(64)
  })

  it('does not cluster unrelated records or superseded/disabled members', () => {
    const clusters = suggestMergeClusters([
      record('one', 'deploy kubernetes cluster'),
      record('two', 'deploy kubernetes cluster', { status: 'superseded' }),
      record('three', 'deploy kubernetes cluster', { disabled: true }),
      record('four', 'bake sourdough bread'),
    ])
    expect(clusters).toHaveLength(0)
  })

  it('respects minShared and maxClusters bounds', () => {
    const records = [
      record('a', 'alpha beta gamma delta'),
      record('b', 'alpha beta gamma epsilon'),
      record('c', 'delta epsilon zeta'),
      record('d', 'delta epsilon zeta'),
      record('e', 'unrelated topic only'),
    ]
    const clusters = suggestMergeClusters(records, { minShared: 2 })
    expect(clusters.map(cluster => cluster.members.map(member => member.name).sort())).toEqual(expect.arrayContaining([['a', 'b'], ['c', 'd']]))
    expect(suggestMergeClusters(records, { minShared: 4 })).toHaveLength(0)
    expect(suggestMergeClusters(records, { minShared: 2, maxClusters: 1 })).toHaveLength(1)
  })
})

describe('merge draft construction', () => {
  it('keeps one labeled section per source in order and bounds the description', () => {
    const members = [
      { name: 'first', description: 'first description', body: '  body one  ' },
      { name: 'second', description: 'second description', body: 'body two' },
    ]
    expect(buildMergedBody(members)).toBe('## 来自 first\n\nbody one\n\n## 来自 second\n\nbody two')
    const description = mergedDescription(members)
    expect(description).toContain('合并自 2 条')
    expect(description).toContain('first、second')
    expect(description.length).toBeLessThanOrEqual(500)
  })
})
