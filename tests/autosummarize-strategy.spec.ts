/**
 * v0.2.0 autoSummarize 策略纯函数测试:门槛与去重。
 */

import { describe, expect, it } from 'vitest'
import { findDuplicateCandidate, shouldConsolidate, type SanitizedCandidate } from '../src/consolidate.ts'
import type { MemoryRecord } from '../src/types.ts'

function candidate(overrides: Partial<SanitizedCandidate> = {}): SanitizedCandidate {
  return {
    name: 'alpha',
    description: 'A fact',
    type: 'project',
    body: 'The fact body.',
    scope: 'project',
    status: 'candidate',
    ...overrides,
  }
}

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    name: 'alpha',
    description: 'A fact',
    type: 'project',
    body: 'The fact body.',
    scope: 'project',
    status: 'verified',
    created: 1,
    updated: 1,
    revision: 'rev',
    ...overrides,
  } as MemoryRecord
}

describe('shouldConsolidate', () => {
  const lines = ['USER: hello', 'ASSISTANT: hi', 'USER: please remember this preference']

  it('passes when both thresholds are met', () => {
    const gate = shouldConsolidate(lines, { minTurns: 2, minChars: 10 })
    expect(gate.ok).toBe(true)
    expect(gate.userTurns).toBe(2)
    expect(gate.chars).toBeGreaterThan(10)
  })

  it('skips too-few-turns', () => {
    const gate = shouldConsolidate(['USER: only one'], { minTurns: 2, minChars: 0 })
    expect(gate.ok).toBe(false)
    expect(gate.reason).toBe('too-few-turns')
    expect(gate.userTurns).toBe(1)
  })

  it('skips too-short transcripts', () => {
    const gate = shouldConsolidate(lines, { minTurns: 0, minChars: 10_000 })
    expect(gate.ok).toBe(false)
    expect(gate.reason).toBe('too-short')
  })

  it('zero thresholds disable the gate', () => {
    expect(shouldConsolidate([], { minTurns: 0, minChars: 0 }).ok).toBe(true)
  })

  it('counts only USER turns, not assistant lines', () => {
    expect(shouldConsolidate(['ASSISTANT: long reply', 'USER: one'], { minTurns: 2, minChars: 0 }).userTurns).toBe(1)
  })
})

describe('findDuplicateCandidate', () => {
  it('matches identical body in the same type and scope', () => {
    expect(findDuplicateCandidate(candidate(), [record()])?.name).toBe('alpha')
  })

  it('normalizes case, whitespace and punctuation', () => {
    const next = candidate({ body: 'the FACT   body!!' })
    expect(findDuplicateCandidate(next, [record()])?.name).toBe('alpha')
  })

  it('does not match a different type', () => {
    expect(findDuplicateCandidate(candidate({ type: 'user' }), [record()])).toBeUndefined()
  })

  it('does not match a different scope', () => {
    expect(findDuplicateCandidate(candidate({ scope: 'user' }), [record()])).toBeUndefined()
  })

  it('matches on identical description even when bodies differ', () => {
    expect(findDuplicateCandidate(candidate({ body: 'Different body.' }), [record()])?.name).toBe('alpha')
  })

  it('returns undefined for unrelated records', () => {
    expect(findDuplicateCandidate(candidate({ description: 'Other', body: 'Other body.' }), [record()])).toBeUndefined()
  })
})
