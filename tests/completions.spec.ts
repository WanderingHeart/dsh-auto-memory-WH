/**
 * v0.11.0 完成通知（宿主侧跟踪器）：只观察运行时长，超阈值才产出事件。
 */
import { describe, expect, it } from 'vitest'
import { CompletionTracker, completionId, completionMessage } from '../src/completions.ts'

const NOW = Date.UTC(2026, 10, 9, 4, 0, 0)

function tracker(options: ConstructorParameters<typeof CompletionTracker>[0] = {}) {
  let clock = NOW
  const instance = new CompletionTracker({ ...options, now: () => clock })
  return { instance, advance: (ms: number) => { clock += ms }, at: () => clock }
}

describe('completion tracking', () => {
  it('ignores idle without a matching running start', () => {
    const { instance } = tracker()
    expect(instance.status('session-a', 'idle')).toBeUndefined()
    expect(instance.pending()).toEqual([])
  })

  it('reports a run that lasted at least the threshold', () => {
    const { instance, advance } = tracker()
    expect(instance.status('session-a', 'running')).toBeUndefined()
    advance(90_000)
    const event = instance.status('session-a', 'idle')
    expect(event).toMatchObject({ sessionId: 'session-a', durationMs: 90_000 })
    expect(event?.id).toBe(completionId('session-a', NOW))
    expect(instance.pending()).toEqual([event])
  })

  it('drops runs shorter than the threshold but still clears the start', () => {
    const { instance, advance } = tracker()
    instance.status('session-a', 'running')
    advance(59_000)
    expect(instance.status('session-a', 'idle')).toBeUndefined()
    expect(instance.pending()).toEqual([])
    advance(1_000)
    expect(instance.status('session-a', 'idle')).toBeUndefined()
  })

  it('honours a custom minimum duration', () => {
    const { instance, advance } = tracker({ minDurationMs: 10_000 })
    instance.status('session-a', 'running')
    advance(10_000)
    expect(instance.status('session-a', 'idle')?.durationMs).toBe(10_000)
  })

  it('keeps the earliest start when running arrives twice', () => {
    const { instance, advance } = tracker()
    instance.status('session-a', 'running')
    advance(30_000)
    instance.status('session-a', 'running')
    advance(60_000)
    expect(instance.status('session-a', 'idle')?.durationMs).toBe(90_000)
  })

  it('returns newest first and caps the ring buffer', () => {
    const { instance, advance } = tracker({ maxEvents: 2, minDurationMs: 1_000 })
    for (const id of ['a', 'b', 'c']) {
      instance.status(id, 'running')
      advance(5_000)
      instance.status(id, 'idle')
    }
    expect(instance.pending().map(event => event.sessionId)).toEqual(['c', 'b'])
  })

  it('forgets a disposed session start', () => {
    const { instance, advance } = tracker()
    instance.status('session-a', 'running')
    instance.forget('session-a')
    advance(120_000)
    expect(instance.status('session-a', 'idle')).toBeUndefined()
  })

  it('renders a short human message', () => {
    expect(completionMessage({ durationMs: 61_000 })).toBe('✅ 这一轮跑完了，用时约 1 分钟')
    expect(completionMessage({ durationMs: 12 * 60_000 })).toBe('✅ 这一轮跑完了，用时约 12 分钟')
  })
})
