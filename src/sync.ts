import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { PLUGIN_VERSION } from './identity.ts'
import type { MemoryRecord, MemoryScope, MemoryType, TaskStatus } from './types.ts'
import type { MemoryStore, MemoryWriteInput } from './store.ts'
import { canonicalJson, sharedForkName } from './transfer.ts'

export const SYNC_FORMAT = 'wh-sync-changeset'
export const SYNC_VERSION = 1
export const MAX_SYNC_BYTES = 8 * 1024 * 1024
export const MAX_SYNC_RECORDS = 5000

export interface SyncRecord {
  name: string
  title?: string
  description: string
  type: MemoryType
  body: string
  status?: string
  pinned?: boolean
  disabled?: boolean
  importance?: number
  reviewHash?: string
  supersedes?: string
  supersededBy?: string
  createdMs?: number
  updatedMs?: number
  /** v1.0.0-rc.2 主题大类；旧端忽略时只是失去章节归属。 */
  topic?: string
  /** v0.5.0 任务字段(加法扩展,旧端忽略即失去任务语义但正文仍可用)。 */
  dueAt?: number
  remindAt?: number
  priority?: number
  taskStatus?: TaskStatus
}

export interface SyncDeletion { name: string; archiveId: string; deletedAtMs: number }

export interface Changeset {
  format: typeof SYNC_FORMAT
  version: typeof SYNC_VERSION
  deviceId: string
  scope: MemoryScope
  since: number
  until: number
  producer: { name: string; version: string }
  upserts: SyncRecord[]
  deletions: SyncDeletion[]
  checksum: string
}

export interface SyncState {
  deviceId: string
  scope: MemoryScope
  /** Receive watermark: changesets at or before this point were already applied. */
  cursor: number
  /** Send watermark: the last `until` published to peers; absent means "never sent". */
  sentCursor?: number
  updatedAt: string
}

export class SyncError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function mapRecord(record: MemoryRecord): SyncRecord {
  return {
    name: record.name,
    title: record.title,
    description: record.description,
    type: record.type,
    body: record.body,
    status: record.status ?? 'candidate',
    pinned: record.pinned === true,
    disabled: record.disabled === true,
    importance: record.importance,
    reviewHash: record.reviewHash,
    supersedes: record.supersedes,
    supersededBy: record.supersededBy,
    createdMs: record.createdMs,
    updatedMs: record.updatedMs,
    topic: record.topic,
    dueAt: record.dueAt,
    remindAt: record.remindAt,
    priority: record.priority,
    taskStatus: record.taskStatus,
  }
}

export function changesetChecksum(parts: Omit<Changeset, 'checksum' | 'producer'>): string {
  return createHash('sha256').update(canonicalJson(parts)).digest('hex')
}

export async function buildChangeset(
  store: Pick<MemoryStore, 'list' | 'listArchive'>,
  options: { scope: MemoryScope; cwd?: string; since: number; deviceId: string },
): Promise<Changeset> {
  const since = Math.max(0, Math.floor(options.since))
  // The watermark is exclusive: `until` names the newest included change, so a
  // retry built from `since = until` carries only strictly newer changes and
  // never re-publishes the same tail record forever.
  const records = await store.list(options.scope, options.cwd)
  const upserts = records
    .filter(record => (record.updatedMs ?? record.createdMs ?? 0) > since)
    .map(mapRecord)
    .sort((a, b) => a.name.localeCompare(b.name))
  const deletions = (await store.listArchive(options.scope, options.cwd))
    .map(entry => ({ name: entry.name.replace(/\.md$/, ''), archiveId: entry.id, deletedAtMs: Date.parse(entry.deletedAt) }))
    .filter(entry => Number.isFinite(entry.deletedAtMs) && entry.deletedAtMs > since)
    .sort((a, b) => a.name.localeCompare(b.name))
  const until = Math.max(since, ...upserts.map(record => record.updatedMs ?? record.createdMs ?? 0), ...deletions.map(entry => entry.deletedAtMs))
  const base = {
    format: SYNC_FORMAT,
    version: SYNC_VERSION,
    deviceId: options.deviceId,
    scope: options.scope,
    since,
    until,
    upserts,
    deletions,
  } as const
  return { ...base, producer: { name: 'dsh-auto-memory-wh', version: PLUGIN_VERSION }, checksum: changesetChecksum(base) }
}

export function verifyChangeset(input: unknown): Changeset {
  if (!input || typeof input !== 'object') throw new SyncError('INVALID_CHANGESET', '变更集必须是 JSON 对象。')
  const set = input as Partial<Changeset>
  if (set.format !== SYNC_FORMAT) throw new SyncError('UNSUPPORTED_FORMAT', '不是 WH 同步变更集。')
  if (set.version !== SYNC_VERSION) throw new SyncError('UNSUPPORTED_VERSION', `不支持的变更集版本：${String(set.version)}。`)
  if (set.scope !== 'user' && set.scope !== 'project') throw new SyncError('INVALID_CHANGESET', 'scope 必须是 user 或 project。')
  if (typeof set.deviceId !== 'string' || set.deviceId.length < 1 || set.deviceId.length > 64) throw new SyncError('INVALID_CHANGESET', 'deviceId 非法。')
  if (!Number.isFinite(set.since) || !Number.isFinite(set.until) || (set.until as number) < (set.since as number)) throw new SyncError('INVALID_CHANGESET', '游标区间非法。')
  if (!Array.isArray(set.upserts) || !Array.isArray(set.deletions)) throw new SyncError('INVALID_CHANGESET', 'upserts/deletions 必须是数组。')
  if (set.upserts.length + set.deletions.length > MAX_SYNC_RECORDS) throw new SyncError('QUOTA_EXCEEDED', '变更集记录数超限。')
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_SYNC_BYTES) throw new SyncError('QUOTA_EXCEEDED', '变更集超过大小上限。')
  const seen = new Set<string>()
  for (const record of set.upserts as SyncRecord[]) {
    if (!record || typeof record.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.name) || record.name.length > 64) throw new SyncError('INVALID_RECORD', '非法记录名。')
    if (seen.has(record.name)) throw new SyncError('DUPLICATE_RECORD', `重复记录：${record.name}。`)
    seen.add(record.name)
    if (typeof record.description !== 'string' || record.description.length > 500) throw new SyncError('INVALID_RECORD', `${record.name} 的 description 非法。`)
    if (typeof record.body !== 'string' || record.body.length > 8000) throw new SyncError('INVALID_RECORD', `${record.name} 的 body 非法。`)
    if (!['user', 'feedback', 'project', 'reference', 'task'].includes(record.type)) throw new SyncError('INVALID_RECORD', `${record.name} 的 type 非法。`)
    const hasTask = record.dueAt !== undefined || record.remindAt !== undefined || record.priority !== undefined || record.taskStatus !== undefined
    if (hasTask && record.type !== 'task') throw new SyncError('INVALID_RECORD', `${record.name} 的任务字段要求 type=task。`)
    for (const field of ['dueAt', 'remindAt'] as const) {
      const value = record[field]
      if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)) throw new SyncError('INVALID_RECORD', `${record.name} 的 ${field} 非法。`)
    }
    if (record.priority !== undefined && (!Number.isSafeInteger(record.priority) || record.priority < 1 || record.priority > 5)) throw new SyncError('INVALID_RECORD', `${record.name} 的 priority 非法。`)
    if (record.taskStatus !== undefined && !['open', 'done', 'cancelled'].includes(record.taskStatus)) throw new SyncError('INVALID_RECORD', `${record.name} 的 taskStatus 非法。`)
    if (record.topic !== undefined && (typeof record.topic !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,31}$/u.test(record.topic))) throw new SyncError('INVALID_RECORD', `${record.name} 的 topic 非法。`)
  }
  for (const deletion of set.deletions as SyncDeletion[]) {
    if (!deletion || typeof deletion.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(deletion.name)) throw new SyncError('INVALID_RECORD', '非法删除记录名。')
    if (!seen.has(deletion.name)) seen.add(deletion.name)
  }
  const parts = {
    format: set.format, version: set.version, deviceId: set.deviceId, scope: set.scope,
    since: set.since, until: set.until, upserts: set.upserts, deletions: set.deletions,
  } as Omit<Changeset, 'checksum' | 'producer'>
  if (changesetChecksum(parts) !== set.checksum) throw new SyncError('CHECKSUM_MISMATCH', '变更集校验和不匹配。')
  return input as Changeset
}

export function sameContent(local: MemoryRecord, remote: SyncRecord): boolean {
  return local.description === remote.description && local.body === remote.body && local.type === remote.type && (local.title ?? '') === (remote.title ?? '')
    // v0.5.0:任务字段变化也算内容变化(否则只改截止时间会被当作无变化跳过)
    && (local.dueAt ?? 0) === (remote.dueAt ?? 0) && (local.remindAt ?? 0) === (remote.remindAt ?? 0)
    && (local.priority ?? 0) === (remote.priority ?? 0) && (local.taskStatus ?? 'open') === (remote.taskStatus ?? 'open')
}

function taskFieldsOf(record: SyncRecord): Partial<MemoryWriteInput> {
  if (record.type !== 'task') return {}
  return {
    ...(record.dueAt !== undefined ? { dueAt: record.dueAt } : {}),
    ...(record.remindAt !== undefined ? { remindAt: record.remindAt } : {}),
    ...(record.priority !== undefined ? { priority: record.priority } : {}),
    ...(record.taskStatus !== undefined ? { taskStatus: record.taskStatus } : {}),
  }
}

export interface ApplyChangesetResult {
  created: string[]
  updated: string[]
  skipped: string[]
  conflicts: string[]
  forked: string[]
  archived: string[]
  deletionSkipped: string[]
  until: number
}

export async function applyChangeset(
  store: MemoryStore,
  set: Changeset,
  options: { cwd?: string; approvedChecksum: string; onConflict?: 'manual' | 'remote' | 'fork' },
): Promise<ApplyChangesetResult> {
  if (set.checksum !== options.approvedChecksum) throw new SyncError('CHECKSUM_MISMATCH', '批准的校验和与变更集不一致。')
  const result: ApplyChangesetResult = { created: [], updated: [], skipped: [], conflicts: [], forked: [], archived: [], deletionSkipped: [], until: set.until }
  for (const remote of set.upserts) {
    const local = await store.read(remote.name, set.scope, options.cwd)
    if (!local) {
      await store.write({ name: remote.name, title: remote.title, description: remote.description, type: remote.type, body: remote.body, status: 'candidate', pinned: false, disabled: remote.disabled === true, ...(remote.topic !== undefined ? { topic: remote.topic } : {}), ...taskFieldsOf(remote) } as MemoryWriteInput, set.scope, options.cwd)
      result.created.push(remote.name)
      continue
    }
    if (local.revision && remote.updatedMs && sameContent(local, remote)) { result.skipped.push(remote.name); continue }
    // v1.0.0-rc.11：冲突以“内容不同且远端不比本地新”为准，不再依赖 verified 审核标记。
    const localMs = local.updatedMs ?? 0
    const remoteMs = remote.updatedMs ?? 0
    const conflict = local.status === 'disputed' || local.status === 'superseded' || remoteMs <= localMs
    if (conflict && options.onConflict !== 'remote') {
      if (options.onConflict === 'fork') {
        const forkName = sharedForkName(remote.name, remote)
        if (await store.read(forkName, set.scope, options.cwd)) { result.skipped.push(forkName); continue }
        await store.write({
          name: forkName,
          title: remote.title === undefined ? undefined : `${remote.title}（另一端的版本）`,
          description: remote.description,
          type: remote.type,
          body: remote.body,
          status: 'candidate',
          pinned: false,
          disabled: false,
          ...(remote.topic !== undefined ? { topic: remote.topic } : {}),
          ...taskFieldsOf(remote),
        } as MemoryWriteInput, set.scope, options.cwd)
        result.forked.push(forkName)
        continue
      }
      result.conflicts.push(remote.name)
      continue
    }
    await store.write({ name: remote.name, title: remote.title, description: remote.description, type: remote.type, body: remote.body, status: 'candidate', pinned: false, disabled: remote.disabled === true, expectedRevision: local.revision, ...(remote.topic !== undefined ? { topic: remote.topic } : {}), ...taskFieldsOf(remote) } as MemoryWriteInput, set.scope, options.cwd)
    result.updated.push(remote.name)
  }
  for (const deletion of set.deletions) {
    const local = await store.read(deletion.name, set.scope, options.cwd)
    if (!local) { result.deletionSkipped.push(deletion.name); continue }
    if (!local.revision || (local.updatedMs ?? 0) >= (deletion.deletedAtMs ?? 0)) { result.conflicts.push(deletion.name); continue }
    await store.deleteVersioned(deletion.name, set.scope, options.cwd, local.revision)
    result.archived.push(deletion.name)
  }
  return result
}

export async function loadSyncState(file: string): Promise<SyncState | null> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as SyncState
    if (typeof parsed.deviceId !== 'string' || !Number.isFinite(parsed.cursor)) return null
    const normalized: SyncState = { deviceId: parsed.deviceId, scope: parsed.scope, cursor: parsed.cursor, updatedAt: parsed.updatedAt }
    if (typeof parsed.sentCursor === 'number' && Number.isFinite(parsed.sentCursor) && parsed.sentCursor >= 0) normalized.sentCursor = parsed.sentCursor
    return normalized
  } catch { return null }
}

export async function saveSyncState(file: string, state: SyncState): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(state, null, 2))
}
