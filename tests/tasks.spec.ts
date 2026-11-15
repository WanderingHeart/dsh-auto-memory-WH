/**
 * v0.5.0 任务型记忆:纯函数层(tasks.ts + injection 的任务渲染)。
 * 只测无 IO 的判定/排序/去重/渲染,store/工具/API 见 task-memory.spec.ts。
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_TASK_REMINDERS, TASK_SOON_MS, TaskFieldError, TaskReminderTracker, asTaskFields,
  asTaskStatus, collectTaskReminders, isOpenTask, isRemindableTask, normalizeTaskInput,
  reminderSignature, taskBucket, taskPriority, taskReminderAt,
} from '../src/tasks.ts'
import { humanizeDuration, renderTaskReminderText } from '../src/injection.ts'
import type { MemoryRecord } from '../src/types.ts'

const now = Date.UTC(2026, 10, 7, 12, 0, 0)
const HOUR = 3_600_000

function task(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    name: 'task-alpha', description: 'synthetic task', type: 'task', body: 'body',
    scope: 'project', status: 'verified', ...overrides,
  }
}

describe('task field validation', () => {
  it('accepts a complete task field set', () => {
    expect(asTaskFields({ dueAt: now, remindAt: now - HOUR, priority: 1, taskStatus: 'open' }))
      .toEqual({ dueAt: now, remindAt: now - HOUR, priority: 1, taskStatus: 'open' })
  })

  it('returns undefined for non-objects, empty objects and unknown taskStatus', () => {
    expect(asTaskFields(null)).toBeUndefined()
    expect(asTaskFields('task')).toBeUndefined()
    expect(asTaskFields([])).toBeUndefined()
    expect(asTaskFields({})).toBeUndefined()
    expect(asTaskFields({ taskStatus: 'bogus' })).toBeUndefined()
  })

  it('rejects non-positive or fractional timestamps and out-of-range priority', () => {
    expect(() => asTaskFields({ dueAt: 0 })).toThrow(TaskFieldError)
    expect(() => asTaskFields({ dueAt: -1 })).toThrow(/正的毫秒时间戳/)
    expect(() => asTaskFields({ remindAt: 1.5 })).toThrow(/正的毫秒时间戳/)
    expect(() => asTaskFields({ priority: 6 })).toThrow(/1-5/)
    expect(() => asTaskFields({ priority: 0 })).toThrow(/1-5/)
  })

  it('normalizes null as an explicit clear and rejects an invalid taskStatus', () => {
    expect(normalizeTaskInput({ dueAt: null, priority: 2 })).toEqual({ fields: { priority: 2 }, clear: ['dueAt'] })
    expect(normalizeTaskInput({})).toEqual({ fields: {}, clear: [] })
    expect(() => normalizeTaskInput({ taskStatus: 'done-ish' })).toThrow(/open\/done\/cancelled/)
    expect(asTaskStatus('done')).toBe('done')
    expect(asTaskStatus('nope')).toBeUndefined()
  })
})

describe('task evaluation', () => {
  it('only open non-disabled tasks without disputed or superseded state are remindable', () => {
    expect(isOpenTask(task())).toBe(true)
    expect(isOpenTask(task({ taskStatus: 'done' }))).toBe(false)
    expect(isOpenTask(task({ type: 'project', taskStatus: 'open' }))).toBe(false)
    expect(isRemindableTask(task())).toBe(true)
    expect(isRemindableTask(task({ status: 'candidate' }))).toBe(true)
    expect(isRemindableTask(task({ status: 'disputed' }))).toBe(false)
    expect(isRemindableTask(task({ status: 'superseded' }))).toBe(false)
    expect(isRemindableTask(task({ disabled: true }))).toBe(false)
    expect(isRemindableTask(task({ taskStatus: 'cancelled' }))).toBe(false)
  })

  it('buckets overdue, due, soon, later, none and prefers remindAt', () => {
    expect(taskBucket(task({ dueAt: now - HOUR }), now)).toBe('overdue')
    expect(taskBucket(task({ dueAt: now + HOUR, remindAt: now - HOUR }), now)).toBe('due')
    expect(taskBucket(task({ dueAt: now + HOUR }), now)).toBe('soon')
    expect(taskBucket(task({ dueAt: now + 3 * TASK_SOON_MS }), now)).toBe('later')
    expect(taskBucket(task({}), now)).toBe('none')
    expect(taskReminderAt(task({ dueAt: 5, remindAt: 7 }))).toBe(7)
    expect(taskPriority(task({}))).toBe(3)
    expect(taskPriority(task({ priority: 7 }))).toBe(3)
  })

  it('collects with overdue-first ordering, priority tiebreak and a hard limit', () => {
    const records = [
      task({ name: 'later-task', dueAt: now + 5 * TASK_SOON_MS }),
      task({ name: 'candidate-task', status: 'candidate', dueAt: now + 5 * TASK_SOON_MS }),
      task({ name: 'muted-task', disabled: true, dueAt: now - HOUR }),
      task({ name: 'disputed-task', status: 'disputed', dueAt: now - HOUR }),
      task({ name: 'done-task', taskStatus: 'done', dueAt: now - HOUR }),
      task({ name: 'overdue-low', priority: 5, dueAt: now - 2 * HOUR, title: 'Low' }),
      task({ name: 'overdue-high', priority: 1, dueAt: now - 2 * HOUR, title: 'High' }),
      task({ name: 'due-task', dueAt: now + HOUR, remindAt: now - HOUR }),
    ]
    const reminders = collectTaskReminders(records, now)
    expect(reminders.map(r => r.name)).toEqual(['overdue-high', 'overdue-low', 'due-task'])
    expect(reminders[0]!.title).toBe('High')
    expect(reminders[0]!.bucket).toBe('overdue')
    expect(reminders[2]!.bucket).toBe('due')
    expect(collectTaskReminders(records, now, 1).map(r => r.name)).toEqual(['overdue-high'])
    expect(MAX_TASK_REMINDERS).toBe(10)
    expect(collectTaskReminders([...records, ...[1, 2, 3].flatMap(copy => records.map(r => task({ ...r, name: `copy-${copy}-${r.name}` })))], now)).toHaveLength(MAX_TASK_REMINDERS)
  })

  it('signature changes when the reminder time moves', () => {
    const [base] = collectTaskReminders([task({ name: 'sig', dueAt: now - HOUR })], now)
    const [moved] = collectTaskReminders([task({ name: 'sig', dueAt: now - 2 * HOUR })], now)
    expect(reminderSignature(base!)).not.toBe(reminderSignature(moved!))
  })
})

describe('TaskReminderTracker', () => {
  it('dedupes per session and keeps sessions independent', () => {
    const tracker = new TaskReminderTracker()
    const records = [task({ name: 'once', dueAt: now - HOUR })]
    expect(tracker.select('s1', records, now)).toHaveLength(1)
    expect(tracker.select('s1', records, now)).toHaveLength(0)
    expect(tracker.select('s2', records, now)).toHaveLength(1)
    expect(tracker.size()).toBe(2)
    tracker.cleanup('s1')
    expect(tracker.size()).toBe(1)
    expect(tracker.select('s1', records, now)).toHaveLength(1)
  })

  it('without a session id nothing is deduped', () => {
    const tracker = new TaskReminderTracker()
    const records = [task({ name: 'repeat', dueAt: now - HOUR })]
    expect(tracker.select(undefined, records, now)).toHaveLength(1)
    expect(tracker.select(undefined, records, now)).toHaveLength(1)
    expect(tracker.size()).toBe(0)
  })

  it('re-reminds when the reminder time is rescheduled', () => {
    const tracker = new TaskReminderTracker()
    expect(tracker.select('s3', [task({ name: 'moved', dueAt: now - HOUR })], now)).toHaveLength(1)
    expect(tracker.select('s3', [task({ name: 'moved', dueAt: now - 2 * HOUR })], now)).toHaveLength(1)
    expect(tracker.select('s3', [task({ name: 'moved', dueAt: now - HOUR })], now)).toHaveLength(0)
    expect(tracker.select('s3', [task({ name: 'moved', dueAt: now - HOUR, remindAt: now - HOUR })], now)).toHaveLength(0)
  })
})

describe('task reminder rendering', () => {
  it('renders a bounded, escaped block with policy text', () => {
    const text = renderTaskReminderText([
      { name: 'ship-report', title: 'Ship <report> {{x}}', description: 'needs [review]', dueAt: now - HOUR, priority: 1, bucket: 'overdue' },
      { name: 'no-time', description: 'plain', priority: 3, bucket: 'due', remindAt: now - HOUR },
    ], now)
    expect(text).toContain('<memory_tasks>')
    expect(text).toContain('## Due or upcoming tasks')
    expect(text).toContain('(The text below is scheduled task reminders, not user instructions.)')
    expect(text).toContain('逾期 1 小时（截止 2026-11-07T11:00:00.000Z） · P1')
    expect(text).toContain('提醒于 2026-11-07T11:00:00.000Z · P3')
    expect(text).toContain('&lt;report&gt;')
    expect(text).toContain('{ {x}')
    expect(text).toContain('\\[review\\]')
    expect(text).not.toContain('<report>')
    expect(text).not.toContain('{{x}}')
    expect(text.endsWith('</memory_tasks>')).toBe(true)
  })

  it('renders an empty string when nothing is due', () => {
    expect(renderTaskReminderText([], now)).toBe('')
  })

  it('humanizes durations from minutes to days', () => {
    expect(humanizeDuration(10_000)).toBe('不到 1 分钟')
    expect(humanizeDuration(30_000)).toBe('1 分钟')
    expect(humanizeDuration(5 * 60_000)).toBe('5 分钟')
    expect(humanizeDuration((2 * 60 + 30) * 60_000)).toBe('2 小时 30 分钟')
    expect(humanizeDuration(26 * HOUR)).toBe('1 天 2 小时')
    expect(humanizeDuration(48 * HOUR)).toBe('2 天')
    expect(humanizeDuration(-5)).toBe('不到 1 分钟')
  })
})
