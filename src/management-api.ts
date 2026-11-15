import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { API_BASE, PLUGIN_VERSION } from './identity.ts'
import { MemoryStore, normalizeName } from './store.ts'
import type { MemoryRecord, MemoryScope, MemoryType } from './types.ts'
import { appendAudit, getAuditStatus, readAudit } from './audit-log.ts'
import { projectIdentity } from './injection.ts'
import { errorCode, FORMAT_FILE, inside, readRegular, sha256 } from './storage-safety.ts'
import { findNearDuplicateGroups } from './duplicates.ts'
import { autoBackupState, runAutoBackup } from './auto-backup.ts'
import { buildMergedBody, mergedDescription, suggestMergeClusters } from './merge.ts'
import type { AutoMergeEntry, MergePlan, MergeScan } from './auto-merge.ts'
import { metricsSnapshot } from './metrics.ts'
import { applyImport, buildExportPackage, planImport, verifyExportPackage } from './transfer.ts'
import { applyChangeset, buildChangeset, verifyChangeset } from './sync.ts'
import { qualityReport, type QualityIndexUsage } from './quality.ts'
import type { ConsolidationSnapshot } from './consolidation-stats.ts'
import type { ConsolidationDiagnostics, ConsolidationRunOutcome, ConsolidationSessionInfo } from './consolidate.ts'
import { listProjects } from './projects.ts'
import { editionFeatures, isEdition, type Edition, type EditionFeatures } from './editions.ts'
import {
  DEFAULT_RELATEDNESS_LIMIT,
  RELATEDNESS_STRONG,
  RELATEDNESS_WEAK,
  buildGraph,
  rankRelated,
  type RelatednessRecord,
} from './relatedness.ts'
import { buildArcView, scanArc } from './arc.ts'

const MEMORY_TYPES: MemoryType[] = ['user', 'feedback', 'project', 'reference']

export interface ManagementConfig {
  maxBytes: number; enableUserScope?: boolean; staleAfterDays?: number; homeDir?: string
  resolveProject?: (sessionId: string) => string | undefined
  listProjects?: () => Array<{ id: string; cwd: string }>
  rootSource?: string; auditMaxBytes?: number; auditRetentionDays?: number
  autoBackup?: { enabled: boolean; intervalHours: number; keep: number }
  legacyMemoryDir?: string
  /** v0.5.0:宿主调度可用性(不可用时面板显示降级提示)。 */
  scheduleStatus?: () => { available: boolean; mapped: number }
  /** v0.6.0:索引占用估算(没有它时质量体检省略 index 字段)。 */
  indexUsage?: (cwd?: string) => Promise<QualityIndexUsage>
  /** v0.7.0:小鲸鱼气泡通道开关;off 时不返回到期任务,也不触发客户端轮询。 */
  notifyWhale?: 'auto' | 'off'
  /** v0.9.0:到期提醒来自宿主原生 schedule(任务不再存在记忆库)。 */
  dueReminders?: () => Promise<Array<{ id: string; title: string; at: number }>>
  /** v0.11.0:长轮次完成事件(由宿主跟踪运行时长,客户端气泡轮询)。 */
  recentCompletions?: () => CompletionEventView[]
  /** v0.11.0:完成通知开关与最短时长。 */
  notifyDone?: boolean
  notifyDoneMinSeconds?: number
  /** v0.12.2:自动固化的运行摘要(只统计数量,不含对话内容)。 */
  consolidation?: () => ConsolidationSnapshot
  consolidationSessions?: (limit: number) => ConsolidationSessionInfo[]
  consolidationRun?: (sessionId: string) => Promise<ConsolidationRunOutcome>
  consolidationDiagnostics?: () => ConsolidationDiagnostics
  /** v0.12.0:功能档位;可传函数以支持面板运行时切换。 */
  edition?: Edition | (() => Edition)
  /** v0.12.0:当前档位的功能开关;可传函数以支持面板运行时切换。 */
  features?: EditionFeatures | (() => EditionFeatures)
  /** v0.12.1:面板切换档位;仅当插件支持运行时切换时提供。 */
  setEdition?: (edition: Edition) => { edition: Edition; features: EditionFeatures }
  /** v1.0.0-rc.4:主题感知的自动合并(同主题≥60 自动、提供撤销);未注入时不显示入口。 */
  autoMerge?: {
    scan: (scope: MemoryScope, cwd?: string) => Promise<MergeScan>
    apply: (plan: MergePlan, scope: MemoryScope, cwd?: string) => Promise<AutoMergeEntry>
    list: () => Promise<AutoMergeEntry[]>
    undo: (id: string) => Promise<AutoMergeEntry | null>
  }
}
export interface CompletionEventView {
  id: string; sessionId: string; startedAt: number; endedAt: number; durationMs: number
}
class ApiError extends Error {
  readonly code: string; readonly status: number
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status }
}
const revision = (value: unknown): string => { if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new ApiError('INVALID_INPUT', '需要先读取当前修订版本。'); return value }
const string = (value: unknown, max: number, allowEmpty = false): string => { if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw new ApiError('INVALID_INPUT', '输入为空或超过长度限制。'); return value }
function keys(body: Record<string, unknown>, allowed: string[]): void { if (Object.keys(body).some(key => !allowed.includes(key))) throw new ApiError('INVALID_INPUT', '包含不支持的字段。') }
const common = ['scope', 'sessionId']
export function registerMemoryApi(ctx: Context, store: MemoryStore, root: string, config: ManagementConfig): void {
  const connection = ctx.get('connection')
  if (!connection) return
  // v0.12.0:档位只影响可选功能与预算提示,不改存储格式与审核语义。
  // v0.12.1:支持面板运行时切换——读侧用函数取值,避免缓存旧档位。
  const currentEdition = (): Edition => (typeof config.edition === 'function' ? config.edition() : (config.edition ?? 'full'))
  const currentFeatures = (): EditionFeatures => {
    if (typeof config.features === 'function') return config.features()
    if (config.features) return config.features
    return editionFeatures(currentEdition())
  }
  const requireFeature = (enabled: boolean, label: string): void => {
    if (!enabled) throw new ApiError('EDITION_DISABLED', `当前为「${currentEdition()}」档，未启用${label}。`, 403)
  }
  const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
  const scopeOf = (data: Record<string, unknown>): { scope: MemoryScope; cwd?: string } => {
    if (data.scope !== 'user' && data.scope !== 'project') throw new ApiError('INVALID_INPUT', '请选择用户或项目范围。')
    if (data.scope === 'user') {
      if (config.enableUserScope === false) throw new ApiError('SCOPE_DENIED', '用户记忆已在配置中关闭。', 403)
      return { scope: 'user' }
    }
    const sessionId = string(data.sessionId, 256)
    const cwd = config.resolveProject?.(sessionId)
    if (!cwd) throw new ApiError('SCOPE_DENIED', '宿主尚未确认此会话的项目范围；请先在该会话中运行一次。', 403)
    return { scope: 'project', cwd }
  }
  const storage = async (scope: MemoryScope, cwd?: string) => {
    let marker: { format?: string; version?: number } | undefined
    try { marker = JSON.parse((await readRegular(join(root, FORMAT_FILE))).toString('utf8')) } catch (error) { if (errorCode(error) !== 'ENOENT') return { root, readOnly: true, reason: '格式标记无法读取', formatVersion: null, lastBackup: null } }
    const entries = await fs.readdir(root).catch(error => { if (errorCode(error) === 'ENOENT') return []; throw error })
    const readOnly = marker ? marker.format !== 'dsh-auto-memory-wh' || marker.version !== 1 : entries.length > 0
    const backupDir = inside(store.dir(scope, cwd), '.backups')
    let latest = 0
    for (const name of await fs.readdir(backupDir).catch(error => { if (errorCode(error) === 'ENOENT') return []; throw error })) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue
      latest = Math.max(latest, (await fs.lstat(inside(backupDir, name))).mtimeMs)
    }
    return { root, rootSource: config.rootSource ?? 'plugin configuration', formatVersion: marker?.version ?? null, readOnly, reason: readOnly ? '请先完成迁移或检查格式兼容性' : null, lastBackup: latest ? new Date(latest).toISOString() : null }
  }
  function route(name: string, method: 'GET' | 'POST', allowed: string[], handler: (data: Record<string, unknown>) => Promise<unknown>): void {
    const dispose = connection!.fetch.register({ path: `${API_BASE}/${name}`, methods: [method], requestBody: 'buffered', fetch: async request => {
      try {
        // Refuse an incompatible carrier instead of assuming localhost implies authorization.
        if (typeof connection!.requestRejection !== 'function') throw new ApiError('INCOMPATIBLE_SCHEMA', '宿主认证接口尚不可用。', 503)
        const denied = connection!.requestRejection(request)
        if (denied) throw new ApiError('SCOPE_DENIED', '请求未通过宿主认证。', denied)
        let data: Record<string, unknown>
        if (method === 'GET') data = Object.fromEntries(new URL(request.url).searchParams)
        else {
          if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError('INVALID_INPUT', '需要 JSON 请求。')
          const raw = await request.text()
          if (Buffer.byteLength(raw) > 32_768) throw new ApiError('QUOTA_EXCEEDED', '请求过大。', 413)
          data = JSON.parse(raw)
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError('INVALID_INPUT', '请求必须为对象。')
        }
        keys(data, allowed)
        return json(await handler(data))
      } catch (error) {
        if (error instanceof ApiError) return json({ error: error.message, code: error.code }, error.status)
        if (/Revision conflict|Restore conflict/.test(String(error))) return json({ code: 'REVISION_CONFLICT', error: '内容已变化，未覆盖当前版本。请保留草稿并重新读取。' }, 409)
        if (/NOT_FOUND/.test(String(error))) return json({ code: 'NOT_FOUND', error: '记录不存在。' }, 404)
        if (/writer lock|Storage busy|recovery/.test(String(error))) return json({ code: 'READ_ONLY', error: '存储忙碌或需要恢复，本次操作未确认完成。' }, 503)
        // 兜底不再完全静默:把真实异常写进宿主日志,面板只看到通用文案。
        const logger = (ctx as unknown as { logger?: { warn?: (message: string) => void } }).logger
        logger?.warn?.('[dsh-auto-memory-wh] management ' + name + ' failed: ' + (error instanceof Error ? (error.stack ?? error.message) : String(error)))
        return json({ code: 'IO_ERROR', error: '操作失败。请检查存储状态；草稿应保留。' }, 400)
      }
    } })
    if (typeof ctx.effect === 'function') ctx.effect(function* () { yield dispose }, 'WH management ' + name)
  }
  route('sessions.active', 'GET', [], async () => ({ sessions: (config.listProjects?.() ?? []).filter(item => config.resolveProject?.(item.id) === item.cwd) }))
  route('groups.list', 'GET', [...common, 'offset', 'limit', 'status', 'type', 'query'], async data => {
    const { scope, cwd } = scopeOf(data)
    const offset = Number(data.offset ?? 0), limit = Number(data.limit ?? 25)
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ApiError('INVALID_INPUT', '分页参数无效。')
    const query = String(data.query ?? '').slice(0, 256).toLowerCase()
    const all = (await store.list(scope, cwd)).filter(r => (data.status ? data.status === (r.status ?? 'legacy') : (r.status ?? 'legacy') !== 'superseded') && (!data.type || data.type === r.type) && (!query || `${r.name} ${r.title ?? ''} ${r.description}`.toLowerCase().includes(query)))
    return { records: all.slice(offset, offset + limit).map(({ body: _body, metadata: _meta, origin: _origin, ...record }) => ({ ...record, status: record.status ?? 'legacy' })), total: all.length, offset, limit,
      issues: store.scanSync(scope, cwd).issues, storage: await storage(scope, cwd), audit: { ...getAuditStatus(root), maxBytes: config.auditMaxBytes ?? 1048576, retentionDays: config.auditRetentionDays ?? 7 }, maxBytes: config.maxBytes,
      schedule: config.scheduleStatus?.() ?? { available: false, mapped: 0 },
      consolidation: config.consolidation?.(),
      edition: currentEdition(), features: currentFeatures() }
  })
  route('schedule.status', 'GET', [], async () => ({ ...(config.scheduleStatus?.() ?? { available: false, mapped: 0 }) }))
  route('edition.set', 'POST', ['edition'], async data => {
    if (!isEdition(data.edition)) throw new ApiError('INVALID_INPUT', '档位必须是 minimal、standard 或 full。')
    if (!config.setEdition) throw new ApiError('EDITION_DISABLED', '当前插件不支持运行时切换档位。', 400)
    const next = config.setEdition(data.edition)
    return { ok: true, edition: next.edition, features: next.features, restartRequired: false }
  })
  // 面板“总结”浮层:最近有未固化内容的会话(最多 3 个,服务端排序)
  route('consolidation.sessions', 'GET', ['limit'], async data => {
    requireFeature(currentFeatures().autoSummarize, '自动总结')
    const raw = Number(data.limit ?? 3)
    const limit = Number.isSafeInteger(raw) && raw > 0 && raw <= 10 ? raw : 3
    return { sessions: config.consolidationSessions?.(limit) ?? [], diagnostics: config.consolidationDiagnostics?.() }
  })
  route('consolidation.run', 'POST', ['sessionId'], async data => {
    requireFeature(currentFeatures().autoSummarize, '自动总结')
    const sessionId = String(data.sessionId ?? '')
    if (sessionId.length === 0 || sessionId.length > 200) throw new ApiError('INVALID_INPUT', '会话无效。')
    if (!config.consolidationRun) throw new ApiError('EDITION_DISABLED', '当前插件不支持手动总结。', 400)
    const outcome = await config.consolidationRun(sessionId)
    if (!outcome.ok && outcome.reason === 'unknown-session') throw new ApiError('NOT_FOUND', '该会话已结束或没有可总结的内容。', 404)
    return { ok: outcome.ok, reason: outcome.ok ? undefined : outcome.reason }
  })
  route('memory.read', 'GET', [...common, 'name'], async data => {
    const { scope, cwd } = scopeOf(data), record = await store.read(string(data.name, 64), scope, cwd)
    if (!record) throw new ApiError('NOT_FOUND', '记录不存在。', 404)
    return { ...record, status: record.status ?? 'legacy' }
  })
  route('memory.write', 'POST', [...common, 'name', 'title', 'description', 'type', 'body', 'expectedRevision', 'approve', 'topic'], async data => {
    const { scope, cwd } = scopeOf(data), name = normalizeName(string(data.name, 64))
    const current = await store.read(name, scope, cwd)
    if (current) revision(data.expectedRevision)
    else if (data.expectedRevision !== null) throw new ApiError('REVISION_CONFLICT', '新建记录必须明确使用空版本。', 409)
    if (!MEMORY_TYPES.includes(String(data.type) as MemoryType) || (data.approve !== undefined && typeof data.approve !== 'boolean')) throw new ApiError('INVALID_INPUT', '类型或审核选项无效。')
    const type = String(data.type) as MemoryType
    const result = await store.write({ name, title: data.title === undefined ? undefined : string(data.title, 160, true), description: string(data.description, 500), body: string(data.body, 8000, true), type,
      ...(data.topic === undefined ? {} : { topic: string(data.topic, 64, true) }),
      ...(data.approve === true ? { status: 'verified' as const } : {}), expectedRevision: current ? String(data.expectedRevision) : undefined, onlyIfAbsent: !current }, scope, cwd)
    if (!result) throw new ApiError('REVISION_CONFLICT', '记录已存在或状态不允许覆盖。', 409)
    return { ok: true, record: result }
  })
  route('memory.duplicates', 'POST', [...common, 'threshold'], async data => {
    requireFeature(currentFeatures().merge, '近重复与合并')
    const { scope, cwd } = scopeOf(data)
    const threshold = data.threshold === undefined ? 0.8 : Number(data.threshold)
    if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 1) throw new ApiError('INVALID_INPUT', '相似度阈值需在 0.5 到 1 之间。')
    const records = (await store.list(scope, cwd)).filter(record => record.status !== 'superseded' && record.disabled !== true)
    const groups = findNearDuplicateGroups(records.map(record => ({
      name: record.name, title: record.title, description: record.description, type: record.type,
      status: record.status, revision: record.revision ?? '', updatedMs: record.updatedMs, body: record.body,
    })), { threshold }).map(group => ({
      similarity: group.similarity,
      members: group.members.map(({ name, title, description, type, status, revision, updatedMs }) => ({ name, title, description, type, status: status ?? 'legacy', revision, updatedMs })),
    }))
    return { scanned: records.length, threshold, groups }
  })
  route('memory.mergeSuggest', 'POST', [...common, 'minShared'], async data => {
    requireFeature(currentFeatures().merge, '近重复与合并')
    const { scope, cwd } = scopeOf(data)
    const minShared = data.minShared === undefined ? 2 : Number(data.minShared)
    if (!Number.isInteger(minShared) || minShared < 1 || minShared > 6) throw new ApiError('INVALID_INPUT', '共享关键词数需在 1 到 6 之间。')
    const records = (await store.list(scope, cwd)).filter(record => record.status !== 'superseded' && record.disabled !== true)
    return { scanned: records.length, minShared, clusters: suggestMergeClusters(records, { minShared }) }
  })
  route('memory.merge', 'POST', [...common, 'name', 'type', 'members', 'confirm'], async data => {
    requireFeature(currentFeatures().merge, '近重复与合并')
    const { scope, cwd } = scopeOf(data)
    if (data.confirm !== true) throw new ApiError('INVALID_INPUT', '需要明确确认合并。')
    const name = normalizeName(string(data.name, 64))
    const type = string(data.type, 32)
    if (!MEMORY_TYPES.includes(type as MemoryType)) throw new ApiError('INVALID_INPUT', '记忆类型无效。')
    if (!Array.isArray(data.members) || data.members.length < 2 || data.members.length > 20) throw new ApiError('INVALID_INPUT', '请选择 2 到 20 条同范围记录。')
    const seen = new Set<string>()
    const members: Array<{ record: MemoryRecord; revision: string }> = []
    const skipped: string[] = []
    for (const raw of data.members) {
      if (!raw || typeof raw !== 'object') throw new ApiError('INVALID_INPUT', '成员格式无效。')
      const entry = raw as Record<string, unknown>
      const memberName = normalizeName(string(entry.name, 64))
      const memberRevision = revision(entry.revision)
      if (memberName === name) throw new ApiError('INVALID_INPUT', '目标名称不能与任一来源相同。')
      if (seen.has(memberName)) throw new ApiError('INVALID_INPUT', '成员重复。')
      seen.add(memberName)
      const record = await store.read(memberName, scope, cwd)
      if (!record || record.status === 'superseded' || record.disabled === true) { skipped.push(memberName); continue }
      if (record.revision !== memberRevision) throw new ApiError('CONFLICT', '记录已变化，请刷新后重试。', 409)
      members.push({ record, revision: memberRevision })
    }
    if (members.length < 2) return { ok: true, target: null, merged: [], skipped }
    const body = buildMergedBody(members.map(member => ({ name: member.record.name, title: member.record.title, description: member.record.description, body: member.record.body })))
    if (Buffer.byteLength(body, 'utf8') > 60_000) throw new ApiError('INVALID_INPUT', '合并后的正文过长，请减少来源。')
    const target = await store.write({
      name, description: mergedDescription(members.map(member => ({ name: member.record.name, title: member.record.title, description: member.record.description, body: member.record.body }))),
      title: `合并：${members[0].record.title ?? members[0].record.name}`, body, type: type as MemoryType, status: 'candidate',
    }, scope, cwd)
    const merged: string[] = []
    for (const member of members) {
      const current = await store.read(member.record.name, scope, cwd)
      if (!current || current.status === 'superseded') continue
      await store.supersede(member.record.name, scope, cwd, current.revision ?? '', name)
      merged.push(member.record.name)
    }
    if (data.sessionId && typeof data.sessionId === 'string' && cwd) {
      await appendAudit(root, {
        ts: Date.now(), sessionId: data.sessionId, cwd, injected: merged, truncated: [], bytes: Buffer.byteLength(body, 'utf8'),
        schemaVersion: 1, eventId: randomUUID(), kind: 'merge_apply', pluginVersion: PLUGIN_VERSION, timestamp: new Date().toISOString(), target: name, sources: merged,
      })
    }
    return { ok: true, target, merged, skipped }
  })
  route('merge.autoScan', 'POST', [...common], async data => {
    requireFeature(currentFeatures().merge, '近重复与合并')
    const { scope, cwd } = scopeOf(data)
    if (!config.autoMerge) return { auto: [], ask: [], entries: [] }
    const scan = await config.autoMerge.scan(scope, cwd)
    return { ...scan, entries: await config.autoMerge.list() }
  })
  route('merge.autoApply', 'POST', [...common, 'key'], async data => {
    requireFeature(currentFeatures().merge, '近重复与合并')
    const { scope, cwd } = scopeOf(data)
    if (!config.autoMerge) throw new ApiError('EDITION_DISABLED', '自动合并未启用。', 403)
    const scan = await config.autoMerge.scan(scope, cwd)
    const plans = data.key === undefined ? scan.auto : [...scan.auto, ...scan.ask].filter(plan => plan.key === String(data.key))
    if (data.key !== undefined && plans.length === 0) throw new ApiError('NOT_FOUND', '该合并计划已过期，请重新扫描。', 404)
    const applied: AutoMergeEntry[] = []
    for (const plan of plans) applied.push(await config.autoMerge.apply(plan, scope, cwd))
    return { ok: true, applied }
  })
  route('merge.undo', 'POST', ['id'], async data => {
    requireFeature(currentFeatures().merge, '近重复与合并')
    if (!config.autoMerge) throw new ApiError('EDITION_DISABLED', '自动合并未启用。', 403)
    const id = string(data.id, 64)
    const undone = await config.autoMerge.undo(id)
    if (undone === null) throw new ApiError('NOT_FOUND', '没有找到这条自动合并记录。', 404)
    return { ok: true, undone }
  })
  route('memory.metrics', 'POST', [...common], async data => {
    const { scope, cwd } = scopeOf(data)
    return { metrics: metricsSnapshot(), audit: getAuditStatus(root), storage: await storage(scope, cwd) }
  })
  // v0.6.0:质量体检只读,不修改任何记录;面板据此逐条处理。
  route('quality.report', 'POST', [...common], async data => {
    const { scope, cwd } = scopeOf(data)
    const records = await store.list(scope, cwd)
    const report = qualityReport(records, Date.now())
    // 近重复需要 revision 作为稳定标识;list() 读盘时总会算,这里只排除理论上的缺省。
    const identifiable = records.filter((record): record is MemoryRecord & { revision: string } => record.revision !== undefined)
    const duplicates = findNearDuplicateGroups(identifiable, { threshold: 0.8 }).length
    const base = { ...report, duplicates: { groups: duplicates, threshold: 0.8 } }
    if (!config.indexUsage) return base
    try {
      return { ...base, index: await config.indexUsage(cwd) }
    } catch {
      // 索引占用算不出来不影响体检本身。
      return base
    }
  })
  /**
   * v0.7.0:到期任务只读馈送(小鲸鱼气泡通道用)。
   *
   * 只返回“已经到点”的 verified/open 任务,不返回正文,也不触发审核或提醒状态变更。
   * 同时扫描用户作用域和所有已知项目目录——气泡是宿主级通道,不应依赖当前打开的会话。
   */
  route('tasks.due', 'POST', [], async () => {
    const now = Date.now()
    if ((config.notifyWhale ?? 'auto') === 'off') return { items: [], now, whale: 'off' }
    // v0.9.0:任务只存在宿主原生 schedule,这里直接读宿主任务,不再扫描记忆库。
    if (config.dueReminders) {
      const due = await config.dueReminders()
      return { items: due.map(item => ({ name: item.id, title: item.title, scope: 'user' as const, dueAt: item.at, remindAt: item.at, taskStatus: 'open' as const })), now, whale: 'auto' }
    }
    return { items: [], now, whale: 'auto' }
  })
  /**
   * v0.11.0:长轮次完成馈送(小鲸鱼气泡通道用)。
   *
   * 只返回最近“跑完且超过阈值”的轮次;不读正文、不写记忆、不改变任何状态。
   * 关闭开关时返回 enabled:false,客户端据此停止轮询。
   */
  route('completion.pending', 'POST', [], async () => {
    const enabled = config.notifyDone !== false
    return {
      enabled,
      minSeconds: config.notifyDoneMinSeconds ?? 60,
      items: enabled && config.recentCompletions ? config.recentCompletions() : [],
    }
  })
  route('relatedness.forRecord', 'POST', [...common, 'name', 'limit'], async data => {
    const { scope, cwd } = scopeOf(data)
    const name = typeof data.name === 'string' ? data.name : ''
    if (!name) throw new ApiError('INVALID_INPUT', '缺少记录名称。')
    const target = await store.read(name, scope, cwd)
    if (!target) throw new ApiError('NOT_FOUND', '记录不存在。', 404)
    const limit = Math.max(1, Math.min(20, Number(data.limit ?? DEFAULT_RELATEDNESS_LIMIT) || DEFAULT_RELATEDNESS_LIMIT))
    const toRelated = (record: MemoryRecord, recordScope: MemoryScope, sameProject: boolean): RelatednessRecord => ({
      name: record.name,
      ...(record.title !== undefined ? { title: record.title } : {}),
      description: record.description,
      type: record.type,
      scope: recordScope,
      ...(record.body !== undefined ? { body: record.body } : {}),
      ...(record.updatedMs !== undefined ? { updatedMs: record.updatedMs } : {}),
      sameProject,
    })
    const candidates: RelatednessRecord[] = []
    if (config.enableUserScope !== false) {
      for (const record of await store.list('user')) candidates.push(toRelated(record, 'user', false))
    }
    if (scope === 'project' && cwd) {
      for (const record of await store.list('project', cwd)) candidates.push(toRelated(record, 'project', true))
    }
    return {
      target: { name: target.name, scope },
      items: rankRelated(toRelated(target, scope, scope === 'project'), candidates, limit),
      thresholds: { weak: RELATEDNESS_WEAK, strong: RELATEDNESS_STRONG },
    }
  })
  route('relatedness.graph', 'POST', [...common, 'threshold', 'limit'], async data => {
    requireFeature(currentFeatures().graph, '关系图')
    const { scope, cwd } = scopeOf(data)
    const threshold = Math.max(0, Math.min(100, Number(data.threshold ?? RELATEDNESS_WEAK) || RELATEDNESS_WEAK))
    const toRelated = (record: MemoryRecord, recordScope: MemoryScope, sameProject: boolean): RelatednessRecord => ({
      name: record.name,
      ...(record.title !== undefined ? { title: record.title } : {}),
      description: record.description,
      type: record.type,
      scope: recordScope,
      ...(record.body !== undefined ? { body: record.body } : {}),
      ...(record.updatedMs !== undefined ? { updatedMs: record.updatedMs } : {}),
      sameProject,
    })
    const records: RelatednessRecord[] = []
    if (config.enableUserScope !== false) {
      for (const record of await store.list('user')) records.push(toRelated(record, 'user', false))
    }
    if (scope === 'project' && cwd) {
      for (const record of await store.list('project', cwd)) records.push(toRelated(record, 'project', true))
    }
    return buildGraph(records, { threshold })
  })
  /**
   * v1.0.0-rc.3:人物弧光(roadmap 1.7 P3)——按主题成章、章内按时间串成一条叙事线。
   *
   * 只读:跨用户层与全部项目 scope 合成,不写记忆、不合并、不改信任,也不调用模型。
   * 门控复用 graph 档位(与关系图同在 full 档),不额外增加功能键。
   */
  route('arc.view', 'POST', [...common], async () => {
    requireFeature(currentFeatures().graph, '人物弧光')
    const scan = await scanArc(root)
    return buildArcView(scan.records, scan.topics, {
      sources: scan.sources,
      skipped: scan.skipped,
      truncated: scan.truncated,
    })
  })
  route('backup.status', 'GET', [], async () => {
    const settings = config.autoBackup ?? { enabled: false, intervalHours: 24, keep: 5 }
    const state = await autoBackupState(root, settings)
    return { ...settings, ...state }
  })
  route('backup.now', 'POST', [], async () => {
    const settings = config.autoBackup ?? { enabled: false, intervalHours: 24, keep: 5 }
    try {
      return await runAutoBackup(root, settings, config.rootSource ?? 'not-specified')
    } catch (error) {
      throw new ApiError('IO_ERROR', '备份失败：' + String(error), 400)
    }
  })
  route('migration.status', 'GET', [], async () => {
    requireFeature(currentFeatures().migration, '迁移检查')
    const count = async (dir: string): Promise<number> => {
      try {
        let total = 0
        const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true })
        for (const entry of entries) if (entry.isFile() && entry.name.endsWith('.md')) total += 1
        return total
      } catch { return 0 }
    }
    const legacyFiles = config.legacyMemoryDir ? await count(config.legacyMemoryDir) : 0
    const targetFiles = await count(root)
    const guidance = legacyFiles > 0 && targetFiles === 0
      ? '发现旧库。关闭 DSH 后运行 maintenance-cli 的 inventory → plan → apply，或按用户指南手动迁移；不要直接覆盖目标目录。'
      : targetFiles > 0
        ? '目标目录已有记录；再次迁移前请先备份并人工确认计划。'
        : '未发现旧库，无需迁移。'
    return { legacyPath: config.legacyMemoryDir ?? null, legacyFiles, targetFiles, guidance }
  })
  route('memory.review', 'POST', [...common, 'name', 'expectedRevision', 'status', 'confirm'], async data => {
    const { scope, cwd } = scopeOf(data)
    if (data.confirm !== true || !['verified', 'candidate', 'disputed'].includes(String(data.status))) throw new ApiError('INVALID_INPUT', '需要明确确认审核决定。')
    const record = await store.review(string(data.name, 64), scope, cwd, revision(data.expectedRevision), data.status as 'verified' | 'candidate' | 'disputed')
    return { ok: true, record }
  })
  route('memory.supersede', 'POST', [...common, 'name', 'expectedRevision', 'successor', 'confirm'], async data => {
    const { scope, cwd } = scopeOf(data)
    if (data.confirm !== true) throw new ApiError('INVALID_INPUT', '需要明确确认取代关系。')
    const result = await store.supersede(string(data.name, 64), scope, cwd, revision(data.expectedRevision), string(data.successor, 64))
    return { ok: true, source: result.source, successor: result.successor }
  })
  route('memory.patch', 'POST', [...common, 'name', 'expectedRevision', 'pinned', 'disabled', 'topic'], async data => {
    const { scope, cwd } = scopeOf(data), current = await store.read(string(data.name, 64), scope, cwd)
    if (!current) throw new ApiError('NOT_FOUND', '记录不存在。', 404)
    for (const key of ['pinned', 'disabled']) if (data[key] !== undefined && typeof data[key] !== 'boolean') throw new ApiError('INVALID_INPUT', '开关必须是布尔值。')
    const patched = await store.write({ ...current, origin: undefined, status: undefined, expectedRevision: revision(data.expectedRevision), ...(data.pinned !== undefined ? { pinned: data.pinned as boolean } : {}), ...(data.disabled !== undefined ? { disabled: data.disabled as boolean } : {}), ...(data.topic !== undefined ? { topic: string(data.topic, 64, true) } : {}) }, scope, cwd)
    if (!patched) throw new ApiError('REVISION_CONFLICT', '记录在修改前已变化,请刷新后重试。', 409)
    return { ok: true, record: patched }
  })
  route('memory.delete', 'POST', [...common, 'name', 'expectedRevision'], async data => {
    const { scope, cwd } = scopeOf(data), name = string(data.name, 64)
    const result = await store.deleteVersioned(name, scope, cwd, revision(data.expectedRevision))
    return { ok: true, ...result }
  })
  route('archive.list', 'GET', common, async data => { const { scope, cwd } = scopeOf(data); return { archives: await store.listArchive(scope, cwd) } })
  route('archive.restore', 'POST', [...common, 'id', 'expectedHash'], async data => {
    const { scope, cwd } = scopeOf(data), id = string(data.id, 36)
    await store.restoreArchived(id, scope, cwd, revision(data.expectedHash))
    return { ok: true }
  })
  route('audit.events', 'GET', ['sessionId', 'scope'], async data => {
    const { scope, cwd } = scopeOf(data)
    const selectedCwd = cwd ?? (typeof data.sessionId === 'string' ? config.resolveProject?.(data.sessionId) : undefined)
    const entries = selectedCwd ? (await readAudit(root)).filter(e => e.kind === 'render_attempt' && e.cwd === projectIdentity(selectedCwd)).slice(-50) : []
    return { status: getAuditStatus(root), entries: entries.map(e => ({ timestamp: e.timestamp, kind: e.kind, bytes: e.bytes, budget: e.budget, detailsTruncated: e.detailsTruncated,
      records: e.records?.filter(r => scope === 'user' ? r.scope === 'user' : r.scope.startsWith('project:')),
      excluded: e.excluded?.filter(r => r.id.startsWith(scope + ':')) })) }
  })
  route('sync.changes', 'POST', [...common, 'since'], async data => {
    const { scope, cwd } = scopeOf(data)
    return buildChangeset(store, { scope, cwd, since: typeof data.since === 'number' ? data.since : 0, deviceId: typeof data.deviceId === 'string' ? data.deviceId : 'unknown-device' })
  })
  route('sync.apply', 'POST', [...common, 'changeset', 'approvedChecksum', 'onConflict'], async data => {
    const set = verifyChangeset(data.changeset)
    if (typeof data.approvedChecksum !== 'string') throw new ApiError('INVALID_INPUT', '需要一个明确的变更集校验和。', 400)
    const cwd = typeof data.sessionId === 'string' ? config.resolveProject?.(data.sessionId) : undefined
    return applyChangeset(store, set, { cwd, approvedChecksum: data.approvedChecksum, onConflict: data.onConflict === 'remote' ? 'remote' : data.onConflict === 'fork' ? 'fork' : 'manual' })
  })
  route('export.package', 'POST', common, async data => {
    requireFeature(currentFeatures().importExport, '导入导出')
    const { scope, cwd } = scopeOf(data)
    return buildExportPackage(await store.list(scope, cwd), { scope })
  })
  route('import.plan', 'POST', [...common, 'package'], async data => {
    requireFeature(currentFeatures().importExport, '导入导出')
    const pkg = verifyExportPackage(data.package)
    const cwd = typeof data.sessionId === 'string' ? config.resolveProject?.(data.sessionId) : undefined
    return planImport(pkg, await store.list(pkg.scope, cwd))
  })
  route('import.apply', 'POST', [...common, 'package', 'approvedChecksum', 'onConflict'], async data => {
    requireFeature(currentFeatures().importExport, '导入导出')
    const pkg = verifyExportPackage(data.package)
    if (typeof data.approvedChecksum !== 'string') throw new ApiError('INVALID_INPUT', '需要一个明确的导入校验和。', 400)
    const cwd = typeof data.sessionId === 'string' ? config.resolveProject?.(data.sessionId) : undefined
    return applyImport(store, pkg, { cwd, approvedChecksum: data.approvedChecksum, onConflict: data.onConflict === 'fork' ? 'fork' : data.onConflict === 'skip' ? 'skip' : 'reject' })
  })
  route('export.markdown', 'GET', common, async data => {
    requireFeature(currentFeatures().importExport, '导入导出')
    const { scope, cwd } = scopeOf(data), records = await store.list(scope, cwd)
    const files = []
    let bytes = 0
    for (const record of records) {
      const raw = await readRegular(inside(store.dir(scope, cwd), record.name + '.md'))
      if (sha256(raw) !== record.revision) throw new ApiError('REVISION_CONFLICT', '导出期间记录发生变化，请重试。', 409)
      if ((bytes += raw.length) > 2 * 1024 * 1024) throw new ApiError('QUOTA_EXCEEDED', '本地导出超过 2 MiB，请使用离线备份。')
      files.push({ name: record.name + '.md', sha256: sha256(raw), bytes: raw.length, content: raw.toString('utf8') })
    }
    if (JSON.stringify((await store.list(scope, cwd)).map(r => r.revision)) !== JSON.stringify(records.map(r => r.revision))) throw new ApiError('REVISION_CONFLICT', '导出期间记录发生变化，请重试。', 409)
    return { format: 'wh-markdown-export', version: 1, scope, includesAudit: false, includesArchive: false, files }
  })
}
