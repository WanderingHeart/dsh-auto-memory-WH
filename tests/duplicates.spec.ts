import { describe, expect, it } from 'vitest'
import { findNearDuplicateGroups, normalizeForCompare, similarity, tokenize } from '../src/duplicates.ts'

function record(name: string, body: string, extra: Record<string, unknown> = {}) {
  return { name, title: name, description: body, type: 'reference', status: 'candidate', revision: 'a'.repeat(64), body, ...extra }
}

describe('near-duplicate detection', () => {
  it('normalizes case, markdown and punctuation', () => {
    expect(normalizeForCompare('**Uses Python 3.12** for THIS project.')).toBe('uses python 3 12 for this project')
    expect(similarity(tokenize('uses python 3.12 for this project'), tokenize('uses python 3.12 for this project'))).toBe(1)
  })

  it('groups identical and near-identical bodies', () => {
    const groups = findNearDuplicateGroups([
      record('alpha', 'uses python 3.12 for this project'),
      record('beta', 'uses python 3.12 for this project.'),
      record('gamma', 'uses python 3.13 for this project'),
    ], { threshold: 0.7 })
    expect(groups).toHaveLength(1)
    expect(groups[0]!.members.map(member => member.name)).toEqual(['alpha', 'beta', 'gamma'])
    expect(groups[0]!.similarity).toBeGreaterThanOrEqual(0.7)
  })

  it('keeps different types apart by default and groups them when asked', () => {
    const records = [record('alpha', 'shared body text'), record('beta', 'shared body text', { type: 'user' })]
    expect(findNearDuplicateGroups(records)).toHaveLength(0)
    expect(findNearDuplicateGroups(records, { sameTypeOnly: false })).toHaveLength(1)
  })

  it('does not group unrelated records', () => {
    expect(findNearDuplicateGroups([record('alpha', 'uses python for parsing'), record('beta', 'grocery list for the weekend')], { threshold: 0.8 })).toHaveLength(0)
  })

  it('groups Chinese near-duplicates via character bigrams', () => {
    const groups = findNearDuplicateGroups([
      record('alpha', '隔离桌面验收的合成记忆，不代表真实偏好'),
      record('beta', '隔离桌面验收的合成记忆，不代表用户真实偏好'),
      record('gamma', '今天晚饭吃面条'),
    ], { threshold: 0.7 })
    expect(groups).toHaveLength(1)
    expect(groups[0]!.members.map(member => member.name)).toEqual(['alpha', 'beta'])
  })

  it('caps how many records a single scan compares', () => {
    const records = Array.from({ length: 5 }, (_, index) => record(`r${index}`, 'identical body text'))
    const groups = findNearDuplicateGroups(records, { maxRecords: 2 })
    expect(groups).toHaveLength(1)
    expect(groups[0]!.members).toHaveLength(2)
  })
})
