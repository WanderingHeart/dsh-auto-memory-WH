/**
 * v0.9.0:任务提醒只存在宿主原生 `schedule` 服务里,不再写入记忆库。
 *
 * 边界:
 * - 只创建带本插件标记(`记忆提醒：` + `[memory-wh] reminder`)的调度;
 * - 默认投递到创建它的会话,可显式要求新会话;
 * - 宿主没有 schedule 服务时明确报错,不静默落回记忆库;
 * - 读取只返回本插件创建、未结束的调度,绝不动用户自己在“自动化任务”里建的。
 */

/** 标题前缀,用于在原生任务列表里识别本插件创建的提醒。 */
export const REMINDER_TITLE_PREFIX = '记忆提醒：'
/** 正文里的机器标记。 */
export const REMINDER_MARKER = '[memory-wh] reminder'
/** 到点前多少毫秒就允许气泡提醒(轮询间隔 30s,留 60s 余量)。 */
export const REMINDER_AHEAD_MS = 60_000
/** 到点后仍可作为“刚到期”返回的窗口。 */
export const REMINDER_GRACE_MS = 30 * 60_000
/** 一次返回的到期提醒上限。 */
export const MAX_DUE_REMINDERS = 20

export interface ReminderTimingAt {
  kind: 'at'
  at: string
}

export interface ReminderTimingAfter {
  kind: 'after'
  after_seconds: number
}

export type ReminderTiming = ReminderTimingAt | ReminderTimingAfter

export interface ReminderRequest {
  title: string
  prompt?: string
  /** 绝对时点(epoch ms)。 */
  dueAt?: number
  /** 相对时点(秒),与 dueAt 二选一。 */
  inSeconds?: number
  priority?: number
}

export interface ReminderTarget {
  kind: 'session' | 'new_once'
  sessionId?: string
  cwd?: string
}

export interface ReminderCreateInput {
  request: ReminderRequest
  target: ReminderTarget
  actorSessionId?: string
}

export interface ReminderCreated {
  id: string
  title: string
  timing: ReminderTiming
  prompt: string
}

export interface ReminderTaskView {
  id: string
  title?: string
  prompt?: string
  active?: boolean
  scheduledAt?: string
  status?: string
}

export interface ReminderServiceLike {
  create(request: {
    title: string
    prompt: string
    timing: ReminderTiming
    target: { kind: 'session'; sessionId: string } | { kind: 'new_once'; create?: { cwd?: string } }
  }, actorSessionId?: string, signal?: AbortSignal): Promise<unknown>
  edit(request: {
    id: string
    action: 'delete'
  }, actorSessionId?: string): Promise<unknown>
  list(request?: { active?: boolean; limit?: number; offset?: number }): Promise<unknown>
}

export interface ReminderDue {
  id: string
  title: string
  at: number
}

export type ReminderErrorCode = 'REMINDER_UNAVAILABLE' | 'REMINDER_TARGET' | 'REMINDER_INPUT'

export class ReminderError extends Error {
  readonly code: ReminderErrorCode
  constructor(code: ReminderErrorCode, message: string) {
    super(message)
    this.name = 'ReminderError'
    this.code = code
  }
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined

/** 把相对/绝对时点换算成宿主接受的 timing。过去时点用 after 补投,避免 `at` 拒绝。 */
export function reminderTiming(request: ReminderRequest, nowMs = Date.now()): ReminderTiming {
  const title = request.title.trim()
  if (!title) throw new ReminderError('REMINDER_INPUT', '提醒标题不能为空。')
  if (request.dueAt !== undefined && request.inSeconds !== undefined) {
    throw new ReminderError('REMINDER_INPUT', 'dueAt 与 inSeconds 只能给一个。')
  }
  if (request.dueAt !== undefined) {
    if (!Number.isSafeInteger(request.dueAt)) throw new ReminderError('REMINDER_INPUT', 'dueAt 必须是毫秒时间戳。')
    if (request.dueAt <= nowMs) return { kind: 'after', after_seconds: 60 }
    return { kind: 'at', at: new Date(request.dueAt).toISOString() }
  }
  const seconds = request.inSeconds ?? 60
  if (!Number.isFinite(seconds) || seconds <= 0) throw new ReminderError('REMINDER_INPUT', 'inSeconds 必须是正数。')
  return { kind: 'after', after_seconds: Math.max(60, Math.round(seconds)) }
}

/** 正文:标记 + 标题说明,便于在原生列表里辨认来源。 */
export function reminderPrompt(request: ReminderRequest): string {
  const title = request.title.trim()
  const extra = request.prompt?.trim()
  return extra ? `${REMINDER_MARKER}\n${title}\n${extra}` : `${REMINDER_MARKER}\n${title}`
}

export function reminderTaskTitle(request: ReminderRequest): string {
  return `${REMINDER_TITLE_PREFIX}${request.title.trim()}`.slice(0, 120)
}

/** 是否本插件创建的调度(标题前缀 + 正文标记都必须命中)。 */
export function isMemoryReminder(task: ReminderTaskView): boolean {
  return typeof task.title === 'string' && task.title.startsWith(REMINDER_TITLE_PREFIX)
    && typeof task.prompt === 'string' && task.prompt.includes(REMINDER_MARKER)
}

/** 读取宿主 list 的 items,容忍缺失字段。 */
export function reminderItems(value: unknown): ReminderTaskView[] {
  const record = asRecord(value)
  const items = record?.items
  if (!Array.isArray(items)) return []
  return items.flatMap((item) => {
    const entry = asRecord(item)
    if (!entry || typeof entry.id !== 'string') return []
    return [{
      id: entry.id,
      ...(typeof entry.title === 'string' ? { title: entry.title } : {}),
      ...(typeof entry.prompt === 'string' ? { prompt: entry.prompt } : {}),
      ...(typeof entry.active === 'boolean' ? { active: entry.active } : {}),
      ...(typeof entry.scheduledAt === 'string' ? { scheduledAt: entry.scheduledAt } : {}),
      ...(typeof entry.status === 'string' ? { status: entry.status } : {}),
    }]
  })
}

/** 把已创建调度的返回值收敛成 {id}。 */
export function createdReminderId(value: unknown): string {
  const record = asRecord(value)
  const id = record?.id
  if (typeof id !== 'string' || !id) throw new ReminderError('REMINDER_INPUT', '宿主未返回调度 id。')
  return id
}

export async function createReminder(
  service: ReminderServiceLike,
  input: ReminderCreateInput,
  nowMs = Date.now(),
): Promise<ReminderCreated> {
  const timing = reminderTiming(input.request, nowMs)
  const title = reminderTaskTitle(input.request)
  const prompt = reminderPrompt(input.request)
  const target = input.target.kind === 'session'
    ? { kind: 'session' as const, sessionId: requireSession(input.target.sessionId) }
    : { kind: 'new_once' as const, ...(input.target.cwd ? { create: { cwd: input.target.cwd } } : {}) }
  const created = await service.create({ title, prompt, timing, target }, input.actorSessionId)
  const id = createdReminderId(created)
  return { id, title, timing, prompt }
}

function requireSession(sessionId: string | undefined): string {
  if (!sessionId) throw new ReminderError('REMINDER_TARGET', '缺少当前会话 id,无法投递到本会话。')
  return sessionId
}

export async function deleteReminder(service: ReminderServiceLike, id: string, actorSessionId?: string): Promise<void> {
  await service.edit({ id, action: 'delete' }, actorSessionId)
}

/**
 * 返回“现在该冒泡”的提醒:到点前 60s 内,或到点后 30 分钟内。
 * 只认本插件标记,按到点时间升序,最多 20 条。
 */
export async function listDueReminders(
  service: ReminderServiceLike,
  nowMs = Date.now(),
  options: { aheadMs?: number; graceMs?: number; limit?: number } = {},
): Promise<ReminderDue[]> {
  const aheadMs = options.aheadMs ?? REMINDER_AHEAD_MS
  const graceMs = options.graceMs ?? REMINDER_GRACE_MS
  const limit = Math.min(options.limit ?? MAX_DUE_REMINDERS, MAX_DUE_REMINDERS)
  // 一次性任务触发后会立刻变成 ended；只看 active 会让客户端轮询错过它。
  const items = reminderItems(await service.list({ limit: 500 }))
  const due: ReminderDue[] = []
  for (const item of items) {
    if (item.status === 'paused' || item.status === 'inactive') continue
    if (!isMemoryReminder(item)) continue
    const scheduledAt = item.scheduledAt ? Date.parse(item.scheduledAt) : Number.NaN
    if (!Number.isFinite(scheduledAt)) continue
    if (scheduledAt > nowMs + aheadMs) continue
    if (scheduledAt < nowMs - graceMs) continue
    due.push({ id: item.id, title: (item.title ?? '').slice(REMINDER_TITLE_PREFIX.length), at: scheduledAt })
  }
  due.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  return due.slice(0, limit)
}
