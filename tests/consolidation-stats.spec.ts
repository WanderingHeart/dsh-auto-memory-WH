import { describe, expect, it } from 'vitest'
import { ConsolidationStats } from '../src/consolidation-stats.ts'

const run = (overrides: Partial<Parameters<ConsolidationStats['record']>[0]> = {}) => ({
  at: 1_000,
  outcome: 'written' as const,
  created: 1,
  updated: 0,
  superseded: 0,
  skipped: 0,
  ...overrides,
})

describe('consolidation stats (v0.12.2)', () => {
  it('reports the disabled state without runs', () => {
    const stats = new ConsolidationStats()
    expect(stats.snapshot(false)).toEqual({ enabled: false, idleMinutes: 0, runs: 0, lastCreated: 0, lastUpdated: 0, lastSkipped: 0, totals: { written: 0, skipped: 0 } })
  })

  it('carries the idle trigger interval for the panel wording', () => {
    const stats = new ConsolidationStats()
    expect(stats.snapshot(true, 60).idleMinutes).toBe(60)
    expect(stats.snapshot(true, 0).idleMinutes).toBe(0)
    stats.record(run())
    expect(stats.snapshot(true, 120)).toMatchObject({ enabled: true, idleMinutes: 120, runs: 1 })
  })

  it('summarises the last run and keeps totals', () => {
    const stats = new ConsolidationStats()
    stats.record(run({ at: 1_000, created: 2, updated: 1, superseded: 0, skipped: 3 }))
    stats.record(run({ at: 2_000, outcome: 'nothing-written', created: 0, updated: 0, superseded: 0, skipped: 4 }))
    const snapshot = stats.snapshot(true)
    expect(snapshot).toMatchObject({ enabled: true, runs: 2, lastAt: 2_000, lastOutcome: 'nothing-written', lastCreated: 0, lastUpdated: 0, lastSkipped: 4 })
    expect(snapshot.totals).toEqual({ written: 3, skipped: 7 })
  })

  it('records skip reasons for gated or truncated runs', () => {
    const stats = new ConsolidationStats()
    stats.record(run({ outcome: 'skipped', reason: 'too-short', created: 0 }))
    stats.record(run({ outcome: 'parse-error', created: 0 }))
    const snapshot = stats.snapshot(true)
    expect(snapshot.lastOutcome).toBe('parse-error')
    expect(snapshot.lastReason).toBeUndefined()
  })

  it('caps the retained history but keeps cumulative totals', () => {
    const stats = new ConsolidationStats()
    for (let index = 0; index < 60; index += 1) stats.record(run({ at: index, created: 1 }))
    const snapshot = stats.snapshot(true)
    expect(snapshot.runs).toBe(50)
    expect(snapshot.lastAt).toBe(59)
    expect(snapshot.totals.written).toBe(60)
  })
})
