import { createHash } from 'node:crypto'
import { PLUGIN_VERSION } from './identity.ts'
import type { MemoryRecord, MemoryScope, MemoryStatus, MemoryType, TaskStatus } from './types.ts'
import type { MemoryWriteInput } from './store.ts'

export const EXPORT_FORMAT = 'wh-memory-export'
export const EXPORT_VERSION = 1
export const MAX_EXPORT_BYTES = 4 * 1024 * 1024
export const MAX_EXPORT_RECORDS = 2000

export class TransferError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export interface ExportRecord {
  name: string
  title?: string
  description: string
  type: MemoryType
  scope: MemoryScope
  body: string
  status?: MemoryStatus
  pinned?: boolean
  disabled?: boolean
  importance?: number
  reviewHash?: string
  supersedes?: string
  supersededBy?: string
  createdMs?: number
  updatedMs?: number
  metadata?: Record<string, unknown>
  /** v1.0.0-rc.2 主题大类；旧包缺省表示未归类。 */
  topic?: string
  /** v0.5.0 任务字段(加法扩展;旧包导入后任务字段缺失,正文仍保留)。 */
  dueAt?: number
  remindAt?: number
  priority?: number
  taskStatus?: TaskStatus
}

export interface ExportPackage {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  createdAt: string
  producer: { name: string; version: string }
  scope: MemoryScope
  records: ExportRecord[]
  checksum: string
}

export interface ImportPlan {
  checksum: string
  creates: string[]
  updates: string[]
  skipped: string[]
  conflicts: string[]
}

/** 同一份远端内容在本地留下的“保留双方”副本名（确定性，便于幂等与核对）。 */
export function sharedForkName(name: string, record: { title?: string; description: string; body: string; type: string; topic?: string }): string {
  const digest = createHash('sha256')
    .update(canonicalJson({ title: record.title ?? '', description: record.description, body: record.body, type: record.type, topic: record.topic ?? '' }))
    .digest('hex')
    .slice(0, 6)
  const base = name.slice(0, 48).replace(/-+$/, '')
  return `${base}-shared-${digest}`
}

export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined)
    return `{${entries.map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function exportChecksum(records: ExportRecord[], scope: MemoryScope): string {
  return createHash('sha256').update(canonicalJson({ format: EXPORT_FORMAT, version: EXPORT_VERSION, scope, records })).digest('hex')
}

export function buildExportPackage(records: MemoryRecord[], options: { scope: MemoryScope; now?: number }): ExportPackage {
  const scope = options.scope
  const mapped: ExportRecord[] = records.filter(record => record.scope === scope).sort((a, b) => a.name.localeCompare(b.name)).map(record => ({
    name: record.name,
    title: record.title,
    description: record.description,
    type: record.type,
    scope: record.scope,
    body: record.body,
    status: record.status ?? 'candidate',
    pinned: record.pinned === true,
    disabled: record.disabled === true,
    importance: record.importance,
    topic: record.topic,
    reviewHash: record.reviewHash,
    supersedes: record.supersedes,
    supersededBy: record.supersededBy,
    createdMs: record.createdMs,
    updatedMs: record.updatedMs,
    ...(record.dueAt !== undefined ? { dueAt: record.dueAt } : {}),
    ...(record.remindAt !== undefined ? { remindAt: record.remindAt } : {}),
    ...(record.priority !== undefined ? { priority: record.priority } : {}),
    ...(record.taskStatus !== undefined ? { taskStatus: record.taskStatus } : {}),
  }))
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    createdAt: new Date(options.now ?? Date.now()).toISOString(),
    producer: { name: 'dsh-auto-memory-wh', version: PLUGIN_VERSION },
    scope,
    records: mapped,
    checksum: exportChecksum(mapped, scope),
  }
}

export function verifyExportPackage(input: unknown): ExportPackage {
  if (!input || typeof input !== 'object') throw new TransferError('INVALID_PACKAGE', '导入包必须是 JSON 对象。')
  const pkg = input as Partial<ExportPackage>
  if (pkg.format !== EXPORT_FORMAT) throw new TransferError('UNSUPPORTED_FORMAT', '不是 WH 导出包。')
  if (pkg.version !== EXPORT_VERSION) throw new TransferError('UNSUPPORTED_VERSION', `不支持的导出包版本：${String(pkg.version)}。`)
  if (pkg.scope !== 'user' && pkg.scope !== 'project') throw new TransferError('INVALID_PACKAGE', 'scope 必须是 user 或 project。')
  if (!Array.isArray(pkg.records)) throw new TransferError('INVALID_PACKAGE', 'records 必须是数组。')
  if (pkg.records.length > MAX_EXPORT_RECORDS) throw new TransferError('QUOTA_EXCEEDED', `记录数超过上限 ${MAX_EXPORT_RECORDS}。`)
  const bytes = Buffer.byteLength(JSON.stringify(input), 'utf8')
  if (bytes > MAX_EXPORT_BYTES) throw new TransferError('QUOTA_EXCEEDED', `导入包超过 ${MAX_EXPORT_BYTES} 字节。`)
  const seen = new Set<string>()
  for (const record of pkg.records as ExportRecord[]) {
    if (!record || typeof record !== 'object') throw new TransferError('INVALID_RECORD', '记录必须是对象。')
    if (typeof record.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.name)) throw new TransferError('INVALID_RECORD', `非法记录名：${String(record.name)}。`)
    if (record.name.length > 64) throw new TransferError('INVALID_RECORD', `记录名过长：${record.name}。`)
    if (seen.has(record.name)) throw new TransferError('DUPLICATE_RECORD', `重复记录：${record.name}。`)
    seen.add(record.name)
    if (typeof record.description !== 'string' || record.description.length > 500) throw new TransferError('INVALID_RECORD', `${record.name} 的 description 非法。`)
    if (typeof record.body !== 'string' || record.body.length > 8000) throw new TransferError('INVALID_RECORD', `${record.name} 的 body 非法。`)
    if (!['user', 'feedback', 'project', 'reference', 'task'].includes(record.type)) throw new TransferError('INVALID_RECORD', `${record.name} 的 type 非法。`)
    if (record.scope !== pkg.scope) throw new TransferError('INVALID_RECORD', `${record.name} 的 scope 与包 scope 不一致。`)
    const hasTask = record.dueAt !== undefined || record.remindAt !== undefined || record.priority !== undefined || record.taskStatus !== undefined
    if (hasTask && record.type !== 'task') throw new TransferError('INVALID_RECORD', `${record.name} 的任务字段要求 type=task。`)
    for (const field of ['dueAt', 'remindAt'] as const) {
      const value = record[field]
      if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)) throw new TransferError('INVALID_RECORD', `${record.name} 的 ${field} 非法。`)
    }
    if (record.priority !== undefined && (!Number.isSafeInteger(record.priority) || record.priority < 1 || record.priority > 5)) throw new TransferError('INVALID_RECORD', `${record.name} 的 priority 非法。`)
    if (record.taskStatus !== undefined && !['open', 'done', 'cancelled'].includes(record.taskStatus)) throw new TransferError('INVALID_RECORD', `${record.name} 的 taskStatus 非法。`)
    if (record.topic !== undefined && (typeof record.topic !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,31}$/u.test(record.topic))) throw new TransferError('INVALID_RECORD', `${record.name} 的 topic 非法。`)
  }
  const expected = exportChecksum(pkg.records as ExportRecord[], pkg.scope)
  if (expected !== pkg.checksum) throw new TransferError('CHECKSUM_MISMATCH', '导入包校验和不匹配，文件可能被修改或损坏。')
  return pkg as ExportPackage
}

function sameContent(a: MemoryRecord, b: ExportRecord): boolean {
  return a.description === b.description && a.body === b.body && a.type === b.type && (a.title ?? '') === (b.title ?? '')
    && (a.dueAt ?? 0) === (b.dueAt ?? 0) && (a.remindAt ?? 0) === (b.remindAt ?? 0)
    && (a.priority ?? 0) === (b.priority ?? 0) && (a.taskStatus ?? 'open') === (b.taskStatus ?? 'open')
}

export function planImport(pkg: ExportPackage, existing: MemoryRecord[]): ImportPlan {
  const byName = new Map(existing.map(record => [record.name, record]))
  const plan: ImportPlan = { checksum: pkg.checksum, creates: [], updates: [], skipped: [], conflicts: [] }
  for (const record of pkg.records) {
    const current = byName.get(record.name)
    if (!current) { plan.creates.push(record.name); continue }
    if (sameContent(current, record)) { plan.skipped.push(record.name); continue }
    // v1.0.0-rc.11：不再用“是否审核过”判断权威性。内容不同且远端不比本地新（含时间相同）就视为冲突，
    // 避免导入静默覆盖本地改动；只有远端明确更新（updatedMs 更大）才直接更新。
    const localMs = current.updatedMs ?? 0
    const remoteMs = record.updatedMs ?? 0
    if (current.status === 'disputed' || current.status === 'superseded' || remoteMs <= localMs) {
      plan.conflicts.push(record.name)
      continue
    }
    plan.updates.push(record.name)
  }
  return plan
}

export interface ImportApplyResult { created: string[]; updated: string[]; skipped: string[]; conflicts: string[]; forked: string[] }

export async function applyImport(
  store: { write: (input: MemoryWriteInput, scope: MemoryScope, cwd?: string) => Promise<MemoryRecord | null>; read: (name: string, scope: MemoryScope, cwd?: string) => Promise<MemoryRecord | null> },
  pkg: ExportPackage,
  options: { cwd?: string; approvedChecksum: string; onConflict?: 'skip' | 'reject' | 'fork' },
): Promise<ImportApplyResult> {
  if (pkg.checksum !== options.approvedChecksum) throw new TransferError('CHECKSUM_MISMATCH', '批准的校验和与导入包不一致。')
  const existing = (await Promise.all(pkg.records.map(record => store.read(record.name, pkg.scope, options.cwd)))).filter((record): record is MemoryRecord => Boolean(record))
  const plan = planImport(pkg, existing)
  const fork = options.onConflict === 'fork'
  if (plan.conflicts.length > 0 && options.onConflict !== 'skip' && !fork) {
    throw new TransferError('IMPORT_CONFLICT', `以下本地记录内容不同，需先选择处理方式（跳过或两边都留）：${plan.conflicts.join(', ')}。`)
  }
  const byName = new Map(existing.map(record => [record.name, record]))
  const result: ImportApplyResult = { created: [], updated: [], skipped: [...plan.skipped], conflicts: fork ? [] : [...plan.conflicts], forked: [] }
  for (const record of pkg.records) {
    const current = byName.get(record.name)
    if (plan.skipped.includes(record.name)) continue
    if (plan.conflicts.includes(record.name)) {
      if (!fork) continue
      const forkName = sharedForkName(record.name, record)
      if (await store.read(forkName, pkg.scope, options.cwd)) { result.skipped.push(forkName); continue }
      await store.write({
        name: forkName,
        title: record.title === undefined ? undefined : `${record.title}（另一端的版本）`,
        description: record.description,
        type: record.type,
        body: record.body,
        status: 'candidate',
        pinned: false,
        disabled: false,
        ...(record.topic !== undefined ? { topic: record.topic } : {}),
        ...(record.type === 'task' ? {
          ...(record.dueAt !== undefined ? { dueAt: record.dueAt } : {}),
          ...(record.remindAt !== undefined ? { remindAt: record.remindAt } : {}),
          ...(record.priority !== undefined ? { priority: record.priority } : {}),
          ...(record.taskStatus !== undefined ? { taskStatus: record.taskStatus } : {}),
        } : {}),
      }, pkg.scope, options.cwd)
      result.forked.push(forkName)
      continue
    }
    await store.write({
      name: record.name,
      title: record.title,
      description: record.description,
      type: record.type,
      body: record.body,
      status: 'candidate',
      pinned: false,
      disabled: false,
      expectedRevision: current?.revision,
      ...(record.topic !== undefined ? { topic: record.topic } : {}),
      ...(record.type === 'task' ? {
        ...(record.dueAt !== undefined ? { dueAt: record.dueAt } : {}),
        ...(record.remindAt !== undefined ? { remindAt: record.remindAt } : {}),
        ...(record.priority !== undefined ? { priority: record.priority } : {}),
        ...(record.taskStatus !== undefined ? { taskStatus: record.taskStatus } : {}),
      } : {}),
    }, pkg.scope, options.cwd)
    if (current) result.updated.push(record.name)
    else result.created.push(record.name)
  }
  return result
}
