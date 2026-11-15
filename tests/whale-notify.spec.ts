/**
 * v0.7.0 小鲸鱼气泡通道（客户端适配器）：
 * 只读到期任务、sessionStorage 去重、检测不到钩子时静默降级。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WHALE_DEDUPE_KEY,
  WHALE_DUE_WINDOW_MS,
  WHALE_POLL_MS,
  dueTaskAt,
  installWhaleNotifier,
  notifyWhale,
  readSeen,
  selectNotifiable,
  taskSignature,
  whaleLines,
  writeSeen,
  type DueTaskItem,
  type WhaleHook,
  type WhaleHookPayload,
  type WhaleStorage,
  type WhaleWindow,
} from '../src/client/whale-notify.ts'

const NOW = Date.UTC(2026, 10, 9, 4, 0, 0)

function task(overrides: Partial<DueTaskItem> = {}): DueTaskItem {
  return { name: 'ship-report', title: 'Ship report', scope: 'user', remindAt: NOW - 60_000, dueAt: NOW - 60_000, taskStatus: 'open', ...overrides }
}

function memoryStorage(): WhaleStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) } }
}

function fakeWindow(hook?: WhaleHook): { win: WhaleWindow; emit: (type: string) => void; listeners: Map<string, Array<() => void>> } {
  const listeners = new Map<string, Array<() => void>>()
  const win: WhaleWindow = {
    document: { visibilityState: 'visible' },
    addEventListener: (type, listener) => { listeners.set(type, [...(listeners.get(type) ?? []), listener]) },
    removeEventListener: (type, listener) => { listeners.set(type, (listeners.get(type) ?? []).filter(item => item !== listener)) },
    ...(hook === undefined ? {} : { __dshWhaleNotify: hook }),
  }
  return { win, listeners, emit: type => { for (const listener of listeners.get(type) ?? []) listener() } }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('due task selection', () => {
  it('only selects tasks that are due, inside the window, and not already seen', () => {
    const tasks = [
      task({ name: 'due-now' }),
      task({ name: 'future', remindAt: NOW + 1, dueAt: NOW + 1 }),
      task({ name: 'too-old', remindAt: NOW - WHALE_DUE_WINDOW_MS - 1, dueAt: NOW - WHALE_DUE_WINDOW_MS - 1 }),
      task({ name: 'no-time', remindAt: undefined, dueAt: undefined }),
    ]
    const seen = { [taskSignature(tasks[0]!)]: NOW - 1 }
    expect(selectNotifiable(tasks, NOW, {}).map(item => item.name)).toEqual(['due-now'])
    expect(selectNotifiable(tasks, NOW, seen)).toEqual([])
  })

  it('treats remindAt as authoritative and falls back to dueAt', () => {
    expect(dueTaskAt({ remindAt: 5, dueAt: 9 })).toBe(5)
    expect(dueTaskAt({ dueAt: 9 })).toBe(9)
    expect(dueTaskAt({ remindAt: Number.NaN, dueAt: 9 })).toBe(undefined)
    expect(dueTaskAt({})).toBe(undefined)
  })

  it('uses scope, name and reminder time as the signature so a rescheduled task notifies again', () => {
    expect(taskSignature(task())).toBe('user:ship-report@' + (NOW - 60_000))
    expect(taskSignature(task({ scope: 'project' }))).not.toBe(taskSignature(task()))
    expect(taskSignature(task({ remindAt: NOW - 30_000 }))).not.toBe(taskSignature(task()))
  })
})

describe('dedupe storage', () => {
  it('round-trips entries and prunes expired or malformed values', () => {
    const storage = memoryStorage()
    writeSeen(storage, { fresh: NOW - 1_000, stale: NOW - 25 * 60 * 60_000 })
    expect(readSeen(storage, NOW)).toEqual({ fresh: NOW - 1_000 })
    storage.setItem(WHALE_DEDUPE_KEY, '{not json')
    expect(readSeen(storage, NOW)).toEqual({})
    storage.setItem(WHALE_DEDUPE_KEY, JSON.stringify({ future: NOW + 10_000, bad: 'x' }))
    expect(readSeen(storage, NOW)).toEqual({})
  })

  it('tolerates a storage that throws', () => {
    const storage: WhaleStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(readSeen(storage, NOW)).toEqual({})
    expect(() => writeSeen(storage, { a: NOW })).not.toThrow()
  })
})

describe('whale hook', () => {
  it('renders a title-and-scope bubble without the body', () => {
    expect(whaleLines(task({ title: 'Ship report' }))).toEqual([
      { type: 'text', text: '⏰ Ship report' },
      { type: 'text', text: '用户记忆任务已到提醒时间' },
    ])
    expect(whaleLines(task({ scope: 'project' }))[1]!.text).toBe('项目记忆任务已到提醒时间')
  })

  it('returns false when the hook is missing, throws, or does not accept the payload', () => {
    expect(notifyWhale(undefined, task())).toBe(false)
    expect(notifyWhale(() => { throw new Error('boom') }, task())).toBe(false)
    expect(notifyWhale(() => false, task())).toBe(false)
    const calls: unknown[] = []
    expect(notifyWhale(payload => { calls.push(payload); return true }, task())).toBe(true)
    expect(calls[0]).toMatchObject({ ttlMs: 0, sound: true })
  })
})

describe('installWhaleNotifier', () => {
  it('polls tasks.due, notifies once per signature, and notifies again after a reschedule', async () => {
    const storage = memoryStorage()
    const hook = vi.fn((_payload: WhaleHookPayload) => true)
    const request = vi.fn(async () => ({ items: [task()], now: NOW, whale: 'auto' }))
    const { win } = fakeWindow(hook)
    const stop = installWhaleNotifier({ request, win, storage, now: () => NOW })

    await vi.advanceTimersByTimeAsync(0)
    expect(request).toHaveBeenCalledWith('tasks.due', {}, 'POST')
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook.mock.calls[0]![0]).toMatchObject({ ttlMs: 0, sound: true })

    await vi.advanceTimersByTimeAsync(WHALE_POLL_MS)
    expect(hook).toHaveBeenCalledTimes(1)

    request.mockResolvedValue({ items: [task({ remindAt: NOW - 30_000, dueAt: NOW - 30_000 })], now: NOW, whale: 'auto' })
    await vi.advanceTimersByTimeAsync(WHALE_POLL_MS)
    expect(hook).toHaveBeenCalledTimes(2)
    stop()
  })

  it('stops polling when the host reports notifyWhale=off', async () => {
    const request = vi.fn(async () => ({ items: [task()], now: NOW, whale: 'off' }))
    const { win } = fakeWindow(vi.fn(() => true))
    installWhaleNotifier({ request, win, storage: memoryStorage(), now: () => NOW })
    await vi.advanceTimersByTimeAsync(0)
    expect(request).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(WHALE_POLL_MS * 3)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does nothing while the whale hook is absent and gives up after the grace period', async () => {
    const request = vi.fn(async () => ({ items: [task()], now: NOW, whale: 'auto' }))
    const { win } = fakeWindow()
    installWhaleNotifier({ request, win, storage: memoryStorage(), now: () => NOW, graceMs: 60_000 })
    await vi.advanceTimersByTimeAsync(0)
    expect(request).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(240_000)
    expect(request).not.toHaveBeenCalled()
  })

  it('swallows request failures and retries on the next tick', async () => {
    const hook = vi.fn(() => true)
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [task()], now: NOW, whale: 'auto' })
    const { win } = fakeWindow(hook)
    installWhaleNotifier({ request, win, storage: memoryStorage(), now: () => NOW })
    await vi.advanceTimersByTimeAsync(0)
    expect(hook).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(WHALE_POLL_MS)
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('checks again when the page becomes visible', async () => {
    const request = vi.fn(async () => ({ items: [], now: NOW, whale: 'auto' }))
    const { win, emit } = fakeWindow(vi.fn(() => true))
    installWhaleNotifier({ request, win, storage: memoryStorage(), now: () => NOW })
    await vi.advanceTimersByTimeAsync(0)
    expect(request).toHaveBeenCalledTimes(1)
    emit('visibilitychange')
    await vi.advanceTimersByTimeAsync(0)
    expect(request).toHaveBeenCalledTimes(2)
  })
})
