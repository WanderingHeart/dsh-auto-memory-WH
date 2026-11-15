/**
 * v0.11.0 客户端完成通知：只读轮询、sessionStorage 去重、没有小鲸鱼时静默。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMPLETION_DEDUPE_KEY,
  COMPLETION_DEDUPE_TTL_MS,
  COMPLETION_POLL_MS,
  completionLines,
  installCompletionNotifier,
  notifyCompletion,
  readCompletionSeen,
  selectUnseenCompletions,
  writeCompletionSeen,
  type CompletionItem,
} from '../src/client/completion-notify.ts'
import type { WhaleHook, WhaleStorage, WhaleWindow } from '../src/client/whale-notify.ts'

const NOW = Date.UTC(2026, 10, 9, 4, 0, 0)

function item(overrides: Partial<CompletionItem> = {}): CompletionItem {
  return { id: 'session-a@1', sessionId: 'session-a', startedAt: NOW - 90_000, endedAt: NOW, durationMs: 90_000, ...overrides }
}

function memoryStorage(): WhaleStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) } }
}

function fakeWindow(hook?: WhaleHook): WhaleWindow {
  return hook === undefined ? {} : { __dshWhaleNotify: hook }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('completion selection', () => {
  it('selects events not yet seen', () => {
    expect(selectUnseenCompletions([item(), item({ id: 'b' })], { b: NOW })).toEqual([item()])
    expect(selectUnseenCompletions(undefined, {})).toEqual([])
  })

  it('renders a single-line completion message', () => {
    expect(completionLines(item())).toEqual([{ type: 'text', text: '✅ 这一轮跑完了，用时约 2 分钟' }])
  })

  it('notifies through the hook with sound and a short ttl', () => {
    const hook = vi.fn(() => true)
    expect(notifyCompletion(hook, item())).toBe(true)
    expect(hook).toHaveBeenCalledWith({
      lines: [{ type: 'text', text: '✅ 这一轮跑完了，用时约 2 分钟' }],
      ttlMs: 8000,
      sound: true,
    })
    expect(notifyCompletion(() => false, item())).toBe(false)
    expect(notifyCompletion(undefined, item())).toBe(false)
  })
})

describe('completion dedupe storage', () => {
  it('round-trips seen ids and drops stale entries', () => {
    const storage = memoryStorage()
    writeCompletionSeen(storage, { a: NOW - COMPLETION_DEDUPE_TTL_MS - 1, b: NOW - 1_000 })
    expect(readCompletionSeen(storage, NOW)).toEqual({ b: NOW - 1_000 })
  })

  it('survives malformed or missing storage', () => {
    const storage = memoryStorage()
    storage.setItem(COMPLETION_DEDUPE_KEY, 'not json')
    expect(readCompletionSeen(storage, NOW)).toEqual({})
    expect(readCompletionSeen(undefined, NOW)).toEqual({})
  })
})

describe('installCompletionNotifier', () => {
  it('does nothing without a whale hook and stops after the grace period', async () => {
    const request = vi.fn(async () => ({ enabled: true, items: [item()] }))
    const stop = installCompletionNotifier({ request, win: fakeWindow(), now: () => Date.now(), graceMs: 1_000 })
    await flush()
    expect(request).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2_000)
    await flush()
    expect(request).not.toHaveBeenCalled()
    stop()
  })

  it('notifies once and dedupes the same event on later polls', async () => {
    const hook = vi.fn(() => true)
    const request = vi.fn(async () => ({ enabled: true, items: [item()] }))
    const storage = memoryStorage()
    const stop = installCompletionNotifier({ request, win: fakeWindow(hook), storage, now: () => Date.now() })
    await flush()
    expect(hook).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(COMPLETION_POLL_MS)
    await flush()
    expect(hook).toHaveBeenCalledTimes(1)
    stop()
  })

  it('notifies a new event after the first one was seen', async () => {
    const hook = vi.fn(() => true)
    let items = [item()]
    const request = vi.fn(async () => ({ enabled: true, items }))
    const stop = installCompletionNotifier({ request, win: fakeWindow(hook), storage: memoryStorage(), now: () => Date.now() })
    await flush()
    items = [item(), item({ id: 'b', sessionId: 'session-b' })]
    vi.advanceTimersByTime(COMPLETION_POLL_MS)
    await flush()
    expect(hook).toHaveBeenCalledTimes(2)
    stop()
  })

  it('stops polling when the host reports the feature disabled', async () => {
    const hook = vi.fn(() => true)
    const request = vi.fn(async () => ({ enabled: false, items: [] }))
    installCompletionNotifier({ request, win: fakeWindow(hook), now: () => Date.now() })
    await flush()
    vi.advanceTimersByTime(COMPLETION_POLL_MS * 3)
    await flush()
    expect(request).toHaveBeenCalledTimes(1)
    expect(hook).not.toHaveBeenCalled()
  })

  it('keeps polling after a failed request', async () => {
    const hook = vi.fn(() => true)
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ enabled: true, items: [item()] })
    installCompletionNotifier({ request, win: fakeWindow(hook), storage: memoryStorage(), now: () => Date.now() })
    await flush()
    expect(hook).not.toHaveBeenCalled()
    vi.advanceTimersByTime(COMPLETION_POLL_MS)
    await flush()
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when no window is available', async () => {
    const request = vi.fn(async () => ({ enabled: true, items: [item()] }))
    const stop = installCompletionNotifier({ request })
    await flush()
    expect(request).not.toHaveBeenCalled()
    stop()
  })
})
