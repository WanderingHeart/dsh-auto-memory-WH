/**
 * v1.0.0-rc.5 提醒落点相关性路由（roadmap 1.3）与关闭/重开补投。
 * 路由是纯函数；补投只测插件侧可见窗口（宿主真正投递仍属桌面演练）。
 */
import { describe, expect, it } from 'vitest'
import { decideReminderRoute } from '../src/reminder-routing.ts'
import {
  REMINDER_MARKER, REMINDER_TITLE_PREFIX, listDueReminders,
  type ReminderServiceLike, type ReminderTaskView,
} from '../src/reminders.ts'

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0)
const project = (cwd: string, label?: string) => ({ cwd, ...(label ? { label } : {}) })

function fakeService(items: ReminderTaskView[] = []) {
  const service: ReminderServiceLike = {
    async create() { return { id: 'r1' } },
    async edit() {},
    async list() { return { items } },
  }
  return service
}

describe('decideReminderRoute', () => {
  it('keeps the current session by default', () => {
    expect(decideReminderRoute({
      text: '喝水',
      sessionId: 's1',
      currentCwd: 'C:\\Users\\example-user\\Desktop\\dsh-plug-in\\dsh-auto-memory-WH',
    })).toMatchObject({ target: 'current', reason: 'default-current' })
  })

  it('honours explicit route requests and missing sessions', () => {
    expect(decideReminderRoute({ text: 'x', sessionId: 's1', requested: 'current' })).toMatchObject({ target: 'current', reason: 'explicit-current' })
    expect(decideReminderRoute({ text: 'x', sessionId: 's1', requested: 'new' })).toMatchObject({ target: 'new_once', reason: 'explicit-new' })
    expect(decideReminderRoute({ text: 'x' })).toMatchObject({ target: 'new_once', reason: 'no-session' })
    expect(decideReminderRoute({ text: 'x', sessionId: 's1', currentCwd: 'C:\\a', archived: true }))
      .toMatchObject({ target: 'new_once', cwd: 'C:\\a', reason: 'archived-session' })
  })

  it('moves to a new session with the cwd of another known project', () => {
    const decision = decideReminderRoute({
      text: 'dsh-auto-memory-WH 发布前检查',
      sessionId: 's1',
      currentCwd: 'C:\\Users\\example-user\\Documents\\other',
      knownProjects: [project('C:\\Users\\example-user\\Desktop\\dsh-plug-in\\dsh-auto-memory-WH', 'dsh-auto-memory-WH')],
    })
    expect(decision.target).toBe('new_once')
    expect(decision.cwd).toBe('C:\\Users\\example-user\\Desktop\\dsh-plug-in\\dsh-auto-memory-WH')
    expect(decision.reason).toBe('other-project:dsh-auto-memory-WH')
  })

  it('keeps the current session when the text matches its topics', () => {
    expect(decideReminderRoute({
      text: '明天复习考研数学',
      sessionId: 's1',
      currentCwd: 'C:\\Users\\example-user\\Desktop\\dsh-plug-in\\dsh-auto-memory-WH',
      currentTopics: ['考研'],
    })).toMatchObject({ target: 'current', reason: 'default-current' })
  })

  it('asks instead of guessing when other projects and the current topic both match', () => {
    const decision = decideReminderRoute({
      text: 'dsh-auto-memory-WH 的考研计划',
      sessionId: 's1',
      currentCwd: 'C:\\Users\\example-user\\Documents\\other',
      currentTopics: ['考研'],
      knownProjects: [project('C:\\Users\\example-user\\Desktop\\dsh-plug-in\\dsh-auto-memory-WH', 'dsh-auto-memory-WH')],
    })
    expect(decision.target).toBe('ask')
    expect(decision.question).toContain('dsh-auto-memory-WH')
  })

  it('asks when the text names more than one project', () => {
    const decision = decideReminderRoute({
      text: 'auto memory one and auto memory two both need a check',
      sessionId: 's1',
      currentCwd: 'C:\\Users\\example-user\\Documents\\other',
      knownProjects: [project('C:\\work\\auto-memory-one'), project('C:\\work\\auto-memory-two')],
    })
    expect(decision.target).toBe('ask')
    expect(decision.question).toContain('auto-memory-one')
    expect(decision.question).toContain('auto-memory-two')
  })
})

describe('close/reopen catch-up (plugin side)', () => {
  const dueReminder = (id: string, at: number): ReminderTaskView => ({
    id,
    title: REMINDER_TITLE_PREFIX + id,
    prompt: REMINDER_MARKER,
    active: true,
    scheduledAt: new Date(at).toISOString(),
  })

  it('still surfaces a reminder that came due while the app was closed, until the grace window ends', async () => {
    const at = NOW
    const service = fakeService([dueReminder('closed-window', at)])
    // 重开于到点后 5 分钟：仍在 30 分钟宽限内。
    expect((await listDueReminders(service, at + 5 * 60_000)).map(item => item.id)).toEqual(['closed-window'])
    // 重开于到点后 31 分钟：超出宽限，不再补投。
    expect(await listDueReminders(service, at + 31 * 60_000)).toEqual([])
  })
})
