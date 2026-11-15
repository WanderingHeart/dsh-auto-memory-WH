/**
 * v0.6.0 记忆质量体检:纯函数,不做任何写入。
 *
 * 目标不是给记忆打分排名,而是把“写得不准、写得臃肿、过期未处理”的问题
 * 变成面板上可逐条处理的提示。所有阈值都写在这里,便于后续用真实一周使用
 * 记录调整(roadmap 1.8 第 7 项)。
 */
import type { MemoryRecord } from './types.ts'

export type QualityCode =
  | 'title-missing'
  | 'description-long'
  | 'body-short'
  | 'name-generic'
  | 'task-missing-due'
  | 'task-overdue'
  | 'stale-record'
  | 'body-many-sections'

export interface QualityIssue {
  code: QualityCode
  severity: 'info' | 'warn'
  message: string
  hint: string
}

export interface QualityRecord {
  name: string
  scope: string
  type: string
  status: string
  issues: QualityIssue[]
}

export interface QualityReport {
  scanned: number
  flagged: number
  byCode: Partial<Record<QualityCode, number>>
  records: QualityRecord[]
  thresholds: { descriptionMax: number; bodyMin: number; staleDays: number; sectionsMax: number }
}

/** v0.6.0:索引占用与排除原因(由宿主注入回调计算,质量体检只展示)。 */
export interface QualityIndexUsage {
  bytes: number
  budget: number
  excluded: Array<{ id: string; reason: string }>
}

export interface QualityReportWithIndex extends QualityReport {
  index?: QualityIndexUsage
  /** v0.6.0:近重复组数(阈值 0.8),把“体检发现”与处理入口串起来。 */
  duplicates?: { groups: number; threshold: number }
}

/** 只有 description 会进入索引,超过这个长度会挤占其他记忆的预算。 */
export const DESCRIPTION_MAX = 240
/** 正文少于这个长度通常缺少“原因”或“边界”,后续会话难以复用。 */
export const BODY_MIN = 40
/** 半年未更新的 verified 记录提示复核一次,避免“过期事实”长期注入。 */
export const STALE_DAYS = 180
/** 单条记录超过这个二级标题数,通常意味着混了多个主题,应拆分。 */
export const SECTIONS_MAX = 4

const THRESHOLDS = { descriptionMax: DESCRIPTION_MAX, bodyMin: BODY_MIN, staleDays: STALE_DAYS, sectionsMax: SECTIONS_MAX }

/** 通用名不可检索:同一作用域里无法一眼看出它讲什么。 */
const GENERIC_NAMES = new Set(['note', 'notes', 'memo', 'misc', 'todo', 'temp', 'tmp', 'test', 'stuff', 'info', 'other', 'untitled'])

/** 名字是否是“通用名”(大小写/空白不敏感);也供自动固化的价值门槛复用。 */
export function isGenericName(name: string): boolean {
  return GENERIC_NAMES.has(name.trim().toLowerCase())
}

const issue = (code: QualityCode, severity: 'info' | 'warn', message: string, hint: string): QualityIssue => ({ code, severity, message, hint })

/** 检查一条记录;caller 决定是否展示。纯函数,不读时钟以外的东西。 */
export function lintRecord(record: MemoryRecord, nowMs: number): QualityIssue[] {
  const found: QualityIssue[] = []
  if (!record.title?.trim() && record.type !== 'task') {
    found.push(issue('title-missing', 'info', '缺少标题。', '标题会出现在索引与管理面板,建议写清楚主题。'))
  }
  if (record.description.length > DESCRIPTION_MAX) {
    found.push(issue('description-long', 'warn', `描述 ${record.description.length} 字符,超过 ${DESCRIPTION_MAX}。`, '描述会进入索引;请把细节移到正文,只留一句结论。'))
  }
  const body = record.body.trim()
  if (record.type !== 'task' && body.length < BODY_MIN && record.status !== 'superseded') {
    found.push(issue('body-short', 'info', `正文 ${body.length} 字符,可能缺少原因或边界。`, '正文写“结论 + 原因 + 边界”,未来会话才用得上。'))
  }
  if (GENERIC_NAMES.has(record.name.toLowerCase())) {
    found.push(issue('name-generic', 'warn', '名称过于通用,难以检索。', '用主题化 kebab-case 名称,例如 dsh-plugin-release-cadence。'))
  }
  if (record.type === 'task') {
    if (record.taskStatus !== 'done' && record.taskStatus !== 'cancelled' && record.dueAt === undefined) {
      found.push(issue('task-missing-due', 'warn', '任务没有截止时间。', '任务需要 dueAt(或 remindAt)才会进入提醒;补一个时间或改回普通记忆。'))
    }
    const remindAt = record.remindAt ?? record.dueAt
    if (record.taskStatus !== 'done' && record.taskStatus !== 'cancelled' && remindAt !== undefined && remindAt < nowMs - 7 * 86_400_000) {
      found.push(issue('task-overdue', 'info', '任务已逾期超过 7 天。', '标记完成/取消,或把时间改到未来;长期未处理的任务会一直出现在提醒段。'))
    }
  }
  if (record.status !== 'disputed' && record.status !== 'superseded' && record.disabled !== true
    && record.updatedMs !== undefined && record.pinned !== true && nowMs - record.updatedMs > STALE_DAYS * 86_400_000) {
    found.push(issue('stale-record', 'info', `已有 ${STALE_DAYS} 天未更新。`, '确认仍然成立后补一条更新理由,或标记为 superseded;过期事实会误导后续会话。'))
  }
  const sections = (record.body.match(/^## /gm) ?? []).length
  if (sections > SECTIONS_MAX) {
    found.push(issue('body-many-sections', 'info', `正文有 ${sections} 个二级标题,可能混了多个主题。`, '拆成多条记录,让每条只表达一个决策。'))
  }
  return found
}

/** 汇总一个范围的体检结果;warn 排前面,同严重度按名称排序,结果稳定可测。 */
export function qualityReport(records: readonly MemoryRecord[], nowMs: number, limit = 100): QualityReport {
  const byCode: Partial<Record<QualityCode, number>> = {}
  const rows: QualityRecord[] = []
  for (const record of records) {
    const issues = lintRecord(record, nowMs)
    if (issues.length === 0) continue
    for (const item of issues) byCode[item.code] = (byCode[item.code] ?? 0) + 1
    rows.push({ name: record.name, scope: record.scope, type: record.type, status: record.status ?? 'legacy', issues })
  }
  const weight = (row: QualityRecord): number => row.issues.filter(item => item.severity === 'warn').length
  rows.sort((a, b) => weight(b) - weight(a) || a.name.localeCompare(b.name, 'en'))
  return { scanned: records.length, flagged: rows.length, byCode, records: rows.slice(0, limit), thresholds: THRESHOLDS }
}
