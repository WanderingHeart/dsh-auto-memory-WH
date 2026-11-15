/**
 * 任务型记忆(v0.5.0):type='task' 的字段校验、提醒评估与渲染。
 *
 * 设计边界:
 * - 任务仍是**普通记忆文件**:审核、备份、同步、归档全部沿用现有链路;
 *   任务生命周期(taskStatus)与信任状态(status)正交。
 * - 只有 verified + 未停用 + open 的任务才会提醒;候选任务永不提醒
 *   (与 memory_write 的"候选不注入"纪律一致)。
 * - 本模块是纯函数(除 tracker 的内存态),不碰 IO,便于单测与降级复用。
 */
import type { MemoryRecord, TaskStatus } from './types.ts'

/** 合法优先级(1 最高)。 */
export const TASK_PRIORITIES = [1, 2, 3, 4, 5] as const
/** 合法任务状态。 */
export const TASK_STATUSES: readonly TaskStatus[] = ['open', 'done', 'cancelled']
/** 缺省优先级。 */
export const DEFAULT_TASK_PRIORITY = 3
/** “即将到期”窗口:24 小时。 */
export const TASK_SOON_MS = 24 * 60 * 60 * 1000
/** 单次注入最多列出的提醒条数(超出交给面板)。 */
export const MAX_TASK_REMINDERS = 10

/** 任务附加字段(全部可选)。 */
export interface TaskFields {
  dueAt?: number
  remindAt?: number
  priority?: number
  taskStatus?: TaskStatus
}

/** 任务字段的原始输入(工具/API 层,未校验)。 */
export interface TaskFieldInput {
  dueAt?: unknown
  remindAt?: unknown
  priority?: unknown
  taskStatus?: unknown
}

/** 校验错误统一前缀,调用方据此映射到 INVALID_INPUT。 */
export class TaskFieldError extends Error {
  constructor(message: string) {
    super(`INVALID_INPUT: ${message}`)
    this.name = 'TaskFieldError'
  }
}

export function asTaskStatus(value: unknown): TaskStatus | undefined {
  return TASK_STATUSES.find(status => status === value)
}

function asTimestamp(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (value === null) return undefined // 显式 null = 清空该字段
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new TaskFieldError(`${field} 必须是正的毫秒时间戳`)
  return value
}

function asPriority(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 5) throw new TaskFieldError('priority 必须是 1-5 的整数')
  return value
}

export function asTaskFields(value: unknown): TaskFields | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const fields: TaskFields = {}
  const dueAt = asTimestamp(raw.dueAt, 'dueAt')
  const remindAt = asTimestamp(raw.remindAt, 'remindAt')
  const priority = asPriority(raw.priority)
  const taskStatus = asTaskStatus(raw.taskStatus)
  if (dueAt !== undefined) fields.dueAt = dueAt
  if (remindAt !== undefined) fields.remindAt = remindAt
  if (priority !== undefined) fields.priority = priority
  if (taskStatus !== undefined) fields.taskStatus = taskStatus
  return Object.keys(fields).length > 0 ? fields : undefined
}

/**
 * 把工具/API 输入归一为可写字段:null 表示清空(返回 undefined 由调用方删除字段)。
 * 未提供的字段不出现在结果里;非法值抛 TaskFieldError。
 */
export function normalizeTaskInput(input: TaskFieldInput): { fields: TaskFields; clear: Array<keyof TaskFields> } {
  const fields: TaskFields = {}
  const clear: Array<keyof TaskFields> = []
  if (input.dueAt !== undefined) { const value = asTimestamp(input.dueAt, 'dueAt'); if (value === undefined) clear.push('dueAt'); else fields.dueAt = value }
  if (input.remindAt !== undefined) { const value = asTimestamp(input.remindAt, 'remindAt'); if (value === undefined) clear.push('remindAt'); else fields.remindAt = value }
  if (input.priority !== undefined) { const value = asPriority(input.priority); if (value === undefined) clear.push('priority'); else fields.priority = value }
  if (input.taskStatus !== undefined) { const value = asTaskStatus(input.taskStatus); if (value === undefined) throw new TaskFieldError('taskStatus 必须是 open/done/cancelled'); fields.taskStatus = value }
  return { fields, clear }
}

/** 任务是否处于打开状态(缺省 open)。 */
export function isOpenTask(record: Pick<MemoryRecord, 'type' | 'taskStatus'>): boolean {
  return record.type === 'task' && (record.taskStatus ?? 'open') === 'open'
}

/**
 * 任务是否已完成。v0.5.0 起“完成”等于归档删除:
 * 日常用法里完成的任务不需要留在列表里,而且删掉后宿主侧调度也会在下次对账时清掉;
 * 删除走版本化归档(可恢复),同步端会收到墓碑,不会在别的设备上复活。
 */
export function isCompletedTask(record: Pick<MemoryRecord, 'type' | 'taskStatus'>): boolean {
  return record.type === 'task' && record.taskStatus === 'done'
}

/** 是否可提醒:task + 未争议/未取代 + 未停用 + open。 */
export function isRemindableTask(record: MemoryRecord): boolean {
  return isOpenTask(record) && record.status !== 'disputed' && record.status !== 'superseded' && record.disabled !== true
}

/** 实际提醒时点:remindAt 优先,其次 dueAt。 */
export function taskReminderAt(record: Pick<MemoryRecord, 'remindAt' | 'dueAt'>): number | undefined {
  return record.remindAt ?? record.dueAt
}

/** 优先级(缺省 3;非法值回退缺省,读取路径永不抛错)。 */
export function taskPriority(record: Pick<MemoryRecord, 'priority'>): number {
  return record.priority !== undefined && Number.isSafeInteger(record.priority) && record.priority >= 1 && record.priority <= 5 ? record.priority : DEFAULT_TASK_PRIORITY
}

export type TaskBucket = 'overdue' | 'due' | 'soon' | 'later' | 'none'

/** 提醒分桶:overdue(已过截止)/due(提醒时点已到)/soon(24h 内)/later/none。 */
export function taskBucket(record: MemoryRecord, nowMs: number): TaskBucket {
  const reminderAt = taskReminderAt(record)
  if (reminderAt !== undefined && reminderAt <= nowMs) return record.dueAt !== undefined && record.dueAt < nowMs ? 'overdue' : 'due'
  if (record.dueAt !== undefined && record.dueAt <= nowMs + TASK_SOON_MS) return 'soon'
  return record.dueAt !== undefined || reminderAt !== undefined ? 'later' : 'none'
}

/** 一条用于注入/面板的提醒条目。 */
export interface TaskReminder {
  name: string
  title?: string
  description: string
  dueAt?: number
  remindAt?: number
  priority: number
  bucket: TaskBucket
}

/**
 * 收集需要提醒的任务:已到提醒时点(含逾期)或 24h 内到期。
 * 排序:逾期/已到在前 → 提醒时点升序 → 优先级升序 → 名称。
 */
export function collectTaskReminders(records: readonly MemoryRecord[], nowMs: number, limit = MAX_TASK_REMINDERS): TaskReminder[] {
  const rank: Record<TaskBucket, number> = { overdue: 0, due: 1, soon: 2, later: 3, none: 4 }
  return records
    .filter(isRemindableTask)
    .map(record => ({ record, bucket: taskBucket(record, nowMs) }))
    .filter(item => item.bucket === 'overdue' || item.bucket === 'due' || item.bucket === 'soon')
    .sort((a, b) => rank[a.bucket] - rank[b.bucket]
      || (taskReminderAt(a.record) ?? a.record.dueAt ?? Number.MAX_SAFE_INTEGER) - (taskReminderAt(b.record) ?? b.record.dueAt ?? Number.MAX_SAFE_INTEGER)
      || taskPriority(a.record) - taskPriority(b.record)
      || a.record.name.localeCompare(b.record.name, 'en'))
    .slice(0, limit)
    .map(({ record, bucket }) => ({
      name: record.name,
      ...(record.title !== undefined ? { title: record.title } : {}),
      description: record.description,
      ...(record.dueAt !== undefined ? { dueAt: record.dueAt } : {}),
      ...(record.remindAt !== undefined ? { remindAt: record.remindAt } : {}),
      priority: taskPriority(record),
      bucket,
    }))
}

/** 已展示提醒的签名:同一会话内同一任务同一时点只展示一次。 */
export function reminderSignature(reminder: TaskReminder): string {
  return `${reminder.name}@${reminder.remindAt ?? reminder.dueAt ?? 0}#${reminder.bucket === 'soon' ? 'soon' : 'due'}`
}

/**
 * 会话级提醒去重器:每个会话记住已展示的条目,避免每一轮 step 重复注入。
 * 会话销毁时调用 cleanup;进程重启后状态自然清空(重新提醒一次,符合预期)。
 */
export class TaskReminderTracker {
  private readonly seen = new Map<string, Set<string>>()
  select(sessionId: string | undefined, records: readonly MemoryRecord[], nowMs: number): TaskReminder[] {
    const reminders = collectTaskReminders(records, nowMs)
    if (!sessionId) return reminders
    let set = this.seen.get(sessionId)
    if (!set) { set = new Set(); this.seen.set(sessionId, set) }
    const fresh = reminders.filter(reminder => !set!.has(reminderSignature(reminder)))
    for (const reminder of fresh) set.add(reminderSignature(reminder))
    return fresh
  }
  cleanup(sessionId: string): void { this.seen.delete(sessionId) }
  size(): number { return this.seen.size }
}
