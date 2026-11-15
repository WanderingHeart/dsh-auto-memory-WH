/**
 * v0.9.0 reminders：任务提醒只存在宿主原生 schedule 的适配层。
 * 断言原则：只测公开函数，用伪造的 ReminderServiceLike 记录调用，不碰宿主内部状态。
 */
import { describe, expect, it } from 'vitest'
import {
  REMINDER_MARKER, REMINDER_TITLE_PREFIX,
  createReminder, deleteReminder, isMemoryReminder, listDueReminders,
  reminderPrompt, reminderTiming, reminderTaskTitle,
  type ReminderServiceLike, type ReminderTaskView,
} from '../src/reminders.ts'

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0)

function fakeService(items: ReminderTaskView[] = []) {
  const created: unknown[] = []
  const edits: unknown[] = []
  const service: ReminderServiceLike = {
    async create(request, actorSessionId) { created.push({ request, actorSessionId }); return { id: 'schedule-1' } },
    async edit(request, actorSessionId) { edits.push({ request, actorSessionId }); return { id: request.id } },
    async list() { return { items } },
  }
  return { service, created, edits }
}

describe('reminderTiming', () => {
  it('uses an absolute ISO time for future dueAt values', () => {
    expect(reminderTiming({ title: 'x', dueAt: NOW + 120_000 }, NOW)).toEqual({ kind: 'at', at: '2026-11-20T12:02:00.000Z' })
  })

  it('falls back to a 60s delivery for past dueAt values instead of failing', () => {
    expect(reminderTiming({ title: 'x', dueAt: NOW - 1 }, NOW)).toEqual({ kind: 'after', after_seconds: 60 })
  })

  it('clamps relative delays to at least 60 seconds', () => {
    expect(reminderTiming({ title: 'x', inSeconds: 5 }, NOW)).toEqual({ kind: 'after', after_seconds: 60 })
    expect(reminderTiming({ title: 'x', inSeconds: 120 }, NOW)).toEqual({ kind: 'after', after_seconds: 120 })
  })

  it('rejects empty titles and conflicting selectors', () => {
    expect(() => reminderTiming({ title: '  ' }, NOW)).toThrow(/标题不能为空/)
    expect(() => reminderTiming({ title: 'x', dueAt: NOW + 1000, inSeconds: 60 }, NOW)).toThrow(/只能给一个/)
    expect(() => reminderTiming({ title: 'x', inSeconds: -1 }, NOW)).toThrow(/必须是正数/)
  })
})

describe('reminder identity', () => {
  it('marks prompts and titles so native-list entries are attributable', () => {
    expect(reminderTaskTitle({ title: '  喝水 ' })).toBe(REMINDER_TITLE_PREFIX + '喝水')
    expect(reminderPrompt({ title: '喝水' })).toBe(`${REMINDER_MARKER}\n喝水`)
    expect(reminderPrompt({ title: '喝水', prompt: ' 一杯 ' })).toBe(`${REMINDER_MARKER}\n喝水\n一杯`)
  })

  it('requires both the title prefix and the prompt marker', () => {
    expect(isMemoryReminder({ id: 'a', title: REMINDER_TITLE_PREFIX + 'x', prompt: REMINDER_MARKER })).toBe(true)
    expect(isMemoryReminder({ id: 'a', title: REMINDER_TITLE_PREFIX + 'x', prompt: 'no marker' })).toBe(false)
    expect(isMemoryReminder({ id: 'a', title: 'user task', prompt: REMINDER_MARKER })).toBe(false)
  })
})

describe('createReminder', () => {
  it('targets the current session by default and returns the host id', async () => {
    const { service, created } = fakeService()
    const result = await createReminder(service, {
      request: { title: '喝水', inSeconds: 90 },
      target: { kind: 'session', sessionId: 'session-abc' },
      actorSessionId: 'session-abc',
    }, NOW)
    expect(result).toMatchObject({ id: 'schedule-1', title: REMINDER_TITLE_PREFIX + '喝水', timing: { kind: 'after', after_seconds: 90 } })
    expect(created[0]).toMatchObject({ actorSessionId: 'session-abc', request: { prompt: `${REMINDER_MARKER}\n喝水` } })
  })

  it('passes cwd to new_once targets and rejects missing session ids', async () => {
    const { service, created } = fakeService()
    await createReminder(service, { request: { title: 'x', inSeconds: 60 }, target: { kind: 'new_once', cwd: 'C:\\project' } }, NOW)
    expect((created[0] as { request: { target: unknown } }).request.target).toEqual({ kind: 'new_once', create: { cwd: 'C:\\project' } })
    await expect(createReminder(service, { request: { title: 'x', inSeconds: 60 }, target: { kind: 'session' } }, NOW)).rejects.toThrow(/缺少当前会话/)
  })

  it('fails loudly when the host returns no id', async () => {
    const service: ReminderServiceLike = { async create() { return {} }, async edit() {}, async list() { return { items: [] } } }
    await expect(createReminder(service, { request: { title: 'x', inSeconds: 60 }, target: { kind: 'new_once' } }, NOW)).rejects.toThrow(/未返回调度 id/)
  })
})

describe('listDueReminders', () => {
  const reminder = (id: string, scheduledAt: string, overrides: Partial<ReminderTaskView> = {}): ReminderTaskView => ({
    id, title: REMINDER_TITLE_PREFIX + id, prompt: REMINDER_MARKER, active: true, scheduledAt, ...overrides,
  })

  it('returns only our marked reminders inside the due window, sorted by time', async () => {
    const { service } = fakeService([
      reminder('late', new Date(NOW - 20 * 60_000).toISOString()),
      reminder('soon', new Date(NOW + 30_000).toISOString()),
      reminder('future', new Date(NOW + 10 * 60_000).toISOString()),
      reminder('stale', new Date(NOW - 45 * 60_000).toISOString()),
      { id: 'foreign', title: '用户自己建的任务', prompt: 'x', active: true, scheduledAt: new Date(NOW).toISOString() },
      reminder('paused', new Date(NOW).toISOString(), { status: 'paused' }),
      reminder('no-time', undefined as unknown as string),
    ])
    const due = await listDueReminders(service, NOW)
    expect(due.map(item => item.id)).toEqual(['late', 'soon'])
    expect(due[0]).toMatchObject({ title: 'late', at: NOW - 20 * 60_000 })
  })

  it('caps the feed at the maximum and tolerates malformed list payloads', async () => {
    const items = Array.from({ length: 30 }, (_, index) => reminder('r' + String(index).padStart(2, '0'), new Date(NOW - index * 1_000).toISOString()))
    const due = await listDueReminders(fakeService(items).service, NOW)
    expect(due).toHaveLength(20)
    const bad: ReminderServiceLike = { async create() {}, async edit() {}, async list() { return null as unknown as object } }
    expect(await listDueReminders(bad, NOW)).toEqual([])
  })
})

describe('deleteReminder', () => {
  it('deletes by id and forwards the acting session', async () => {
    const { service, edits } = fakeService()
    await deleteReminder(service, 'schedule-9', 'session-abc')
    expect(edits[0]).toEqual({ request: { id: 'schedule-9', action: 'delete' }, actorSessionId: 'session-abc' })
  })
})
