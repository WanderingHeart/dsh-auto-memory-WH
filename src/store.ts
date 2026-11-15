/**
 * 记忆存储层:类型化记忆文件 CRUD + MEMORY.md 索引维护。
 *
 * 关键设计决策(依据源码调研与对抗性审查,见 internal research notes):
 * 1. **必须用 node:fs 而非 ctx.fs**——默认部署的 fs-sandbox 可写根不含 $DSH_HOME,
 *    走 ctx.fs 会抛 FS_SANDBOX_DENIED;官方先例 skill-filesystem 访问 $DSH_HOME
 *    下的文件同样直接用 node:fs。
 * 2. **并发写用 @deepseek-ai/dsh-atomic-write**(writeFileAtomic + withFileLock),
 *    跨进程文件锁,Windows 兼容由官方包处理;残留锁须显式离线恢复。
 * 3. **MEMORY.md 是派生物**:真相源是记忆文件集;每次写入/删除后全量重建索引,
 *    删空时直接移除索引文件(保证"无记忆不出段")。
 * 4. **不写自定义会话事件**——第三方事件类型会导致会话 resume 拒读。审计走独立 audit.jsonl。
 * 5. **frontmatter 用 yaml 包解析**(skill-filesystem 同款)。
 * 6. **任何单个畸形/恶意文件都不得砖掉存储操作**:解析失败一律跳过(含不可归一化
 *    的 name),symlink 条目跳过(防止目录外内容被吸进索引注入系统提示词)。
 */

import { promises as fsp, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'
import type { MemoryEvidence, MemoryOrigin, MemoryRecord, MemoryScope, MemoryStatus, MemoryType, TaskStatus } from './types.ts'
import { USER_SCOPE_DIR } from './types.ts'
import { recordWrite } from './metrics.ts'
import { absoluteRoot, archiveFile, assertNoLinksSync, assertReadable, decodeImage, durableWrite, errorCode, inside, MAX_FILE_BYTES, MAX_TOTAL_BYTES, PROJECT_FILE, readRegular, sha256, withScopeTransaction, type FaultHook } from './storage-safety.ts'

const MEMORY_TYPES: readonly MemoryType[] = ['user', 'feedback', 'project', 'reference', 'task'] as const

/** 索引文件名(派生物,随写入重建;删空时移除)。 */
export const INDEX_FILENAME = 'MEMORY.md'

/** 大小写不敏感文件系统(NTFS/APFS)上与索引文件冲突的保留名。 */
const RESERVED_NAMES = new Set(['memory', 'con', 'prn', 'aux', 'nul', ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`)])

/**
 * 把会话 cwd 编码为文件系统安全的项目目录名。
 * 照抄官方算法(packages/session/session-persistence-jsonl/src/format.ts projectKey):
 * `/` `\` `:` 折叠为 `-`,非 [A-Za-z0-9._-] 字符转 `~XXXX` 大写十六进制,
 * 去前导 `-`,空串用 `root`,限长 251,整体包成 `--<slug>--`。
 * 与 $DSH_HOME/sessions 的目录命名一致(如 `--D-a-b--`)。
 */
export function projectKey(cwd: string): string {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

/**
 * 归一化模型提供的记忆名:压缩为纯 kebab-case。
 * 只放行 [a-z0-9-],从根上消除路径攻击面(文件名即 `${name}.md`)。
 * `memory` 为保留字(大小写不敏感文件系统上与 MEMORY.md 撞名,写入会被静默销毁)。
 */
export function normalizeName(input: string): string {
  const slug = input.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`memory name must normalize to kebab-case [a-z0-9-] (got: ${JSON.stringify(input)})`)
  }
  if (RESERVED_NAMES.has(slug)) {
    throw new Error(`memory name "${slug}" is reserved (collides with the ${INDEX_FILENAME} index on case-insensitive filesystems); pick a more specific name`)
  }
  return slug
}

/** 校验并收窄记忆类型。 */
export function asMemoryType(raw: string): MemoryType {
  const hit = MEMORY_TYPES.find(t => t === raw)
  if (!hit) throw new Error(`invalid memory type: ${JSON.stringify(raw)} (expected one of ${MEMORY_TYPES.join('/')})`)
  return hit
}

/** Historical export name retained for audit callers. Lock reclamation is explicit offline maintenance. */
export async function withLockRecovery<T>(lockTarget: string, operation: () => Promise<T>): Promise<T> {
  // A timeout or EPERM is not proof of death. Offline maintenance handles stale locks.
  assertNoLinksSync(lockTarget)
  return withFileLock(lockTarget, operation)
}

/** 解析 frontmatter(参考 skill-filesystem parseFrontmatter,容忍 CRLF)。 */
function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return undefined
  const start = firstLineEnd + 1
  let lineStart = start
  for (;;) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      const parsed = parseYaml(raw.slice(start, lineStart)) as unknown
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
      return {
        data: parsed as Record<string, unknown>,
        body: raw.slice(nextNewline < 0 ? raw.length : nextNewline + 1),
      }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
}

/** Migration is stricter than the legacy tolerant reader; no silent trust/version repair. */
export function migrationRecordIssue(raw: string): string | undefined {
  try {
    const fm = parseFrontmatter(raw)
    if (!fm) return 'invalid-frontmatter'
    if (fm.data.schemaVersion !== undefined && fm.data.schemaVersion !== 1) return 'unsupported-record-version'
    if (fm.data.status !== undefined && !['candidate', 'verified', 'disputed', 'superseded'].includes(String(fm.data.status))) return 'invalid-trust-status'
    if (fm.data.origin !== undefined && parseOrigin(fm.data.origin) === undefined) return 'unrecognized-origin'
    return undefined
  } catch { return 'invalid-frontmatter' }
}

/**
 * 解析导入溯源块;任何字段缺失/非法一律返回 undefined(按"无来源"处理,
 * 即不可撤销——fail-closed 方向:宁可撤销不了,也不能删错记忆)。
 */
export function parseOrigin(value: unknown): MemoryOrigin | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (raw.kind !== 'claude-code') return undefined
  // 路径型标识限长:前端/面板永不回显该字段,但坏数据不应无限膨胀 frontmatter
  if (typeof raw.slug !== 'string' || raw.slug.length === 0 || raw.slug.length > 512) return undefined
  if (typeof raw.file !== 'string' || raw.file.length === 0 || raw.file.length > 512) return undefined
  if (typeof raw.imported !== 'number' || !Number.isSafeInteger(raw.imported) || raw.imported <= 0) return undefined
  if (typeof raw.hash !== 'string' || !/^[0-9a-f]{16}$/.test(raw.hash)) return undefined
  return { kind: 'claude-code', slug: raw.slug, file: raw.file, importedMs: raw.imported, hash: raw.hash }
}

/**
 * 导入内容指纹(纯函数):type + 清洗后 description/body 的 sha256 前 16 位。
 * 写入路径全量继承导入时的值;撤销导入时与当前内容重算值比对,不等即视为
 * "导入后被改过"。长度 16 hex 足够(撤销是单机、按条比对,无碰撞压力)。
 */
export function contentFingerprint(fields: Pick<MemoryRecord, 'description' | 'type' | 'body'>): string {
  return createHash('sha256')
    .update(`${fields.type}\n${fields.description.trim()}\n${fields.body.trim()}`)
    .digest('hex')
    .slice(0, 16)
}

export function reviewFingerprint(fields: Pick<MemoryRecord, 'name' | 'title' | 'description' | 'type' | 'body'>): string {
  return sha256(JSON.stringify([fields.name, fields.title?.trim() ?? '', fields.description.trim(), fields.type, fields.body.trim()]))
}

/**
 * 解析单个记忆文件内容;任何畸形(含不可归一化的 name)一律返回 null,
 * 绝不抛错——单个坏文件不得砖掉 list/write/delete(审查确认的 major 修复)。
 * 生命周期元数据(created/updated/lastRead/reads,毫秒)非法时静默忽略。
 * @param raw - 文件全文
 * @param scope - 所属作用域(由目录位置决定,文件内不存)
 */
export function parseMemory(raw: string, scope: MemoryScope): MemoryRecord | null {
  try {
    const fm = parseFrontmatter(raw)
    if (!fm) return null
    const { name, description, type, title, created, updated, lastRead, reads, pinned, importance, disabled, origin, status, evidence, supersededBy, supersedes, reviewHash, dueAt, remindAt, priority, taskStatus, notifySessionId, topic } = fm.data
    if (typeof name !== 'string' || typeof description !== 'string' || description.trim().length === 0) return null
    const parsedType = type === undefined ? 'reference' : asMemoryType(String(type))
    const asMs = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
    const asCount = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
    const asImportance = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 10 ? value : undefined
    // v0.5.0 任务字段:非法值静默丢弃(与生命周期元数据同款容错,坏 YAML 不砖存储)
    const asTaskDue = (value: unknown): number | undefined => asMs(value)
    const asPriority = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 5 ? value : undefined
    const asTaskStatus = (value: unknown): TaskStatus | undefined =>
      value === 'open' || value === 'done' || value === 'cancelled' ? value : undefined
    // v0.6.2 提醒目标会话:宿主 session id;格式不对就静默丢弃(桥接会回退 new_once)
    const asNotifySession = (value: unknown): string | undefined =>
      typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : undefined
    // v1.0.0-rc.2 主题 id:非法值静默丢弃(旧文件/手改 YAML 不砖存储),由面板/迁移补
    const asTopic = (value: unknown): string | undefined =>
      typeof value === 'string' && /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,31}$/u.test(value) ? value : undefined
    const parsedOrigin = parseOrigin(origin)
    // 可信状态:非法枚举回退 undefined(未审核旧状态)——手改 YAML 写错不砖存储(现纪律)
    let parsedStatus = status === 'candidate' || status === 'verified' || status === 'disputed' || status === 'superseded'
      ? (status as MemoryStatus)
      : undefined
    let trustReason: string | undefined
    if (parsedStatus === 'verified' && reviewHash !== reviewFingerprint({ name: normalizeName(name), description, type: parsedType, body: fm.body, title: typeof title === 'string' ? title : undefined })) {
      parsedStatus = 'candidate'; trustReason = 'review-hash-missing-or-changed'
    }
    // 证据链:两个成分都合法才保留(半截证据比没证据更骗人)
    const evidenceRaw = (evidence !== null && typeof evidence === 'object' && !Array.isArray(evidence)) ? evidence as Record<string, unknown> : null
    const parsedEvidence = evidenceRaw !== null
      && typeof evidenceRaw.sessionId === 'string' && evidenceRaw.sessionId.length > 0
      && typeof evidenceRaw.quote === 'string' && evidenceRaw.quote.length > 0
      ? { sessionId: evidenceRaw.sessionId.slice(0, 128), quote: evidenceRaw.quote.slice(0, 400) }
      : undefined
    // #19 谱系指针:kebab-case 名(≤64;与 normalizeName 同形状但不复用——
    // 它抛异常且保留字 memory 会炸 parse,这里静默丢字段)
    const asLineage = (value: unknown): string | undefined =>
      typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 64 ? value : undefined
    return {
      revision: sha256(raw),
      ...(typeof reviewHash === 'string' ? { reviewHash } : {}),
      ...(trustReason ? { trustReason } : {}),
      metadata: Object.fromEntries(Object.entries(fm.data).filter(([key]) => !['reviewHash', 'name', 'description', 'type', 'title', 'created', 'updated', 'lastRead', 'reads', 'pinned', 'importance', 'disabled', 'origin', 'status', 'evidence', 'supersededBy', 'supersedes', 'dueAt', 'remindAt', 'priority', 'taskStatus', 'notifySessionId', 'topic'].includes(key))),
      name: normalizeName(name),
      title: typeof title === 'string' && title.trim().length > 0 ? title.trim() : undefined,
      description: description.trim(),
      type: parsedType,
      body: fm.body.trim(),
      scope,
      ...(pinned === true ? { pinned: true } : {}),
      ...(disabled === true ? { disabled: true } : {}),
      ...(asImportance(importance) !== undefined ? { importance: asImportance(importance) } : {}),
      ...(parsedStatus !== undefined ? { status: parsedStatus } : {}),
      ...(parsedEvidence !== undefined ? { evidence: parsedEvidence } : {}),
      ...(asLineage(supersededBy) !== undefined ? { supersededBy: asLineage(supersededBy)! } : {}),
      ...(asLineage(supersedes) !== undefined ? { supersedes: asLineage(supersedes)! } : {}),
      ...(parsedOrigin !== undefined ? { origin: parsedOrigin } : {}),
      createdMs: asMs(created),
      updatedMs: asMs(updated),
      lastReadMs: asMs(lastRead),
      reads: asCount(reads),
      ...(asTaskDue(dueAt) !== undefined ? { dueAt: asTaskDue(dueAt) } : {}),
      ...(asTaskDue(remindAt) !== undefined ? { remindAt: asTaskDue(remindAt) } : {}),
      ...(asPriority(priority) !== undefined ? { priority: asPriority(priority) } : {}),
      ...(asTaskStatus(taskStatus) !== undefined ? { taskStatus: asTaskStatus(taskStatus) } : {}),
      ...(asNotifySession(notifySessionId) !== undefined ? { notifySessionId: asNotifySession(notifySessionId)! } : {}),
      ...(asTopic(topic) !== undefined ? { topic: asTopic(topic)! } : {}),
    }
  } catch {
    return null // 坏 name/type 等统一跳过,与契约一致
  }
}

/** 序列化一条记忆为文件内容(frontmatter 由 yaml.stringify 正确转义特殊字符)。 */
export function serializeMemory(record: Omit<MemoryRecord, 'scope'>): string {
  const frontmatter = stringifyYaml({
    ...record.metadata,
    name: record.name,
    ...(record.title !== undefined ? { title: record.title } : {}),
    description: record.description,
    type: record.type,
    ...(record.topic !== undefined ? { topic: record.topic } : {}),
    ...(record.status === 'verified' && record.reviewHash ? { reviewHash: record.reviewHash } : {}),
    ...(record.pinned === true ? { pinned: true } : {}),
    ...(record.disabled === true ? { disabled: true } : {}),
    ...(record.importance !== undefined ? { importance: record.importance } : {}),
    // 可信状态与证据链(1.0.0):status 缺省为未审核旧记录，不自动注入;evidence 整块进出
    ...(record.status !== undefined ? { status: record.status } : {}),
    ...(record.evidence !== undefined ? { evidence: { sessionId: record.evidence.sessionId, quote: record.evidence.quote } } : {}),
    // #19 演化谱系(扁平两个 string;与 status 同款条件落盘)
    ...(record.supersededBy !== undefined ? { supersededBy: record.supersededBy } : {}),
    ...(record.supersedes !== undefined ? { supersedes: record.supersedes } : {}),
    // 导入溯源(嵌套块):字段名短、YAML 正确转义;缺省即普通记忆
    ...(record.origin !== undefined ? {
      origin: {
        kind: record.origin.kind,
        slug: record.origin.slug,
        file: record.origin.file,
        imported: record.origin.importedMs,
        hash: record.origin.hash,
      },
    } : {}),
    ...(record.createdMs !== undefined ? { created: record.createdMs } : {}),
    ...(record.updatedMs !== undefined ? { updated: record.updatedMs } : {}),
    ...(record.lastReadMs !== undefined ? { lastRead: record.lastReadMs } : {}),
    ...(record.reads !== undefined ? { reads: record.reads } : {}),
    // v0.5.0 任务字段:仅 type='task' 的语义字段,缺省不落盘
    ...(record.dueAt !== undefined ? { dueAt: record.dueAt } : {}),
    ...(record.remindAt !== undefined ? { remindAt: record.remindAt } : {}),
    ...(record.priority !== undefined ? { priority: record.priority } : {}),
    ...(record.taskStatus !== undefined ? { taskStatus: record.taskStatus } : {}),
    ...(record.notifySessionId !== undefined ? { notifySessionId: record.notifySessionId } : {}),
  }).trimEnd()
  return `---\n${frontmatter}\n---\n\n${record.body.trim()}\n`
}

/**
 * 覆盖写入时的元数据合并(纯函数,便于测试):
 * 首次写入生成 created/updated;更新保留 created 与读取计数,刷新 updated。
 */
export function mergeLifecycleMeta(existing: MemoryRecord | null, now: number): LifecycleMeta {
  return {
    createdMs: existing?.createdMs ?? now,
    updatedMs: now,
    ...(existing?.lastReadMs !== undefined ? { lastReadMs: existing.lastReadMs } : {}),
    ...(existing?.reads !== undefined ? { reads: existing.reads } : {}),
  }
}

/** 生命周期元数据子集。 */
export interface LifecycleMeta {
  createdMs: number
  updatedMs: number
  lastReadMs?: number
  reads?: number
}

/**
 * 渲染索引正文(一行一条)。排序:pinned 优先 → 三因子分(importance×recency,
 * 天粒度衰减保证当日稳定,不破坏 KV 前缀缓存)→ name 字典序稳定 tiebreak。
 */
export function renderIndexBody(records: MemoryRecord[]): string {
  const now = Date.now()
  // 软停用(#10):不注入但文件保留——与软淘汰同款"隐藏不删除"语义;
  // memory_list 与 memory_read 仍可见/可读,取消停用即恢复注入
  // 可信状态过滤(1.0.0):disputed(争议)与 superseded(被取代)不注入——
  // 与 disabled 同款"隐藏不删除"语义,文件保留、面板可见、可恢复;
  // v1.0.0-rc.10:撤销人工审核,candidate/legacy 与 verified 一样进入派生索引
  const visible = records.filter(record =>
    record.disabled !== true
    && record.status !== 'disputed'
    && record.status !== 'superseded'
    // v0.5.0:任务不进入“长期事实”索引段,由到期提醒段/面板单独呈现
    && record.type !== 'task')
  const ordered = [...visible].sort((a, b) => {
    const pa = a.pinned === true ? 0 : 1
    const pb = b.pinned === true ? 0 : 1
    if (pa !== pb) return pa - pb
    const sa = memoryScore(a, now)
    const sb = memoryScore(b, now)
    if (sa !== sb) return sb - sa
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
  // v0.6.1:自动标题来自描述时(两者相同)索引仍显示名字,避免“标题+描述”重复
  const label = (r: MemoryRecord): string => r.title !== undefined && r.title.trim() !== r.description.trim() ? r.title : r.name
  const lines = ordered.map(r => `- [${label(r)}](${r.name}.md)${r.pinned === true ? ' 📌' : ''} — ${r.description}`)
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

/** 判断路径是否为符号链接(读路径防护:防目录外内容被吸进索引注入系统提示词)。 */
function isSymlink(file: string): boolean {
  try {
    return lstatSync(file).isSymbolicLink()
  } catch {
    return false // 不存在按非链接处理,由调用方的存在性语义兜底
  }
}

/** 判断一条记忆是否"陈旧零引用"(软淘汰候选;纯函数,可测)。 */
export function isStale(record: MemoryRecord, staleAfterDays: number, nowMs: number): boolean {
  if (staleAfterDays <= 0) return false
  if (record.pinned === true) return false // 置顶保护:信任锚点,永不软淘汰
  if ((record.reads ?? 0) > 0) return false // 被读过的不淘汰
  const updated = record.updatedMs ?? record.createdMs
  if (updated === undefined) return false // 无生命周期元数据的旧文件不参与
  return nowMs - updated > staleAfterDays * 86_400_000
}

// ---------- P0.5 安全包:写入脱敏与协议标签防护 ----------

/** 高置信密钥/敏感串模式(曾在本项目亲历泄漏形态:ghp_/npm_/sk-)。 */
const SECRET_PATTERNS: readonly { kind: string; re: RegExp }[] = [
  { kind: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { kind: 'npm-token', re: /\bnpm_[A-Za-z0-9]{20,}\b/g },
  // sk- 要求至少一位数字,避免误杀 sk-button-primary 等 kebab 命名(审查确认的误杀面)
  { kind: 'openai-key', re: /\bsk-(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{20,}\b/g },
  // 认证 scheme 大小写不敏感(RFC 7235),真值部分需含 JWT 头或 =/(+ 拦 Basic base64)
  { kind: 'bearer', re: /\bbearer\s+(?:eyJ[A-Za-z0-9_-]{10,}|[A-Za-z0-9_\-]{16,}[=+/][A-Za-z0-9_\-=/+]{10,})/gi },
  { kind: 'slack-token', re: /\bxox[bposa]-[0-9A-Za-z-]{10,}\b/g },
  { kind: 'google-key', re: /\bAIza[0-9A-Za-z_\-]{30,}\b/g },
  { kind: 'phone', re: /\b1[3-9]\d{9}\b/g },
  { kind: 'id-card', re: /\b\d{17}[\dXx]\b/g },
]

/**
 * GB11643 身份证校验位验证:18 位号码仅当末位与加权模 11 校验相符才算真身份证。
 * 纯长度匹配会把订单号/雪花 ID 等任意 18 位数字一并误杀(#7)。
 */
function isValidIdCard(candidate: string): boolean {
  if (!/^\d{17}[\dXx]$/.test(candidate)) return false
  const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] as const
  const CHECKS = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'] as const
  let sum = 0
  for (let i = 0; i < 17; i++) sum += Number(candidate[i]) * WEIGHTS[i]
  return candidate[17].toUpperCase() === CHECKS[sum % 11]
}

/**
 * 写入前脱敏(纯函数,可测):把高置信密钥/手机号/身份证替换为 [REDACTED:kind]。
 * 应用于 description/body——所有写路径(工具/固化/面板)都经 store.write,单点拦截。
 */
export function redactSecrets(text: string): string {
  let out = text
  for (const { kind, re } of SECRET_PATTERNS) {
    out = out.replace(re, match => (kind === 'id-card' && !isValidIdCard(match) ? match : `[REDACTED:${kind}]`))
  }
  return out
}

/**
 * 入库前剥离注入协议标签字样(防闭合逃逸伪造)。匹配放宽到容忍空白/大小写/
 * 属性变体(LLM 分词器对这些变体的容忍度远高于词法精确匹配——审查确认
 * 单空格即可穿透精确形式)。转义后壳永远只有一层,内容无法闭壳。
 */
export function stripMemoryTags(text: string): string {
  return text
    .replace(/<\s*\/?\s*memory_context[^>]*>/gi, match => match.replace(/[<>]/g, ch => (ch === '<' ? '&lt;' : '&gt;')))
}

/** 写入内容统一清洗(脱敏 + 协议标签防护)。 */
/**
 * 指令注入模式检测(1.0.0 可信记忆;所有写入路径的单点防线,审查确认
 * 只挂固化路径会被 memory_write 直写绕过)。
 *
 * 词表纪律(对抗审查实测校准,漏报优于误报——误报会把合法记忆静默踢出
 * 注入):每条必须"指令动词+对象"结构齐全。裸名词("系统提示词"作为研究
 * 对象)与裸动词("扮演缓存角色")都不算——40% 误报的教训。
 */
const DIRECTIVE_PATTERNS: RegExp[] = [
  /\b(?:ignore|disregard|forget)\b[^.]{0,40}\b(?:previous|prior|above|all)\b[^.]{0,20}\b(?:instructions?|prompts?|rules?)/i,
  /\byou\s+are\s+now\b/i,
  /\b(?:reveal|show|print|output|leak|expose)\b[^.]{0,30}\b(?:system|developer)\s+(?:prompt|message|instructions?)\b/i,
  /(?:忽略|无视)[^.]{0,20}(?:之前|上面|以上)[^.]{0,20}(?:指令|提示|规则)/,
  /(?:输出|泄露|打印)[^.]{0,15}系统提示词/,
]

/** 纯函数:文本是否命中指令注入模式(检测 body 与 description;title 过短误报高不查)。 */
export function detectDirectivePattern(text: string): boolean {
  return DIRECTIVE_PATTERNS.some(pattern => pattern.test(text))
}

function sanitizeContent(text: string): string {
  return stripMemoryTags(redactSecrets(text))
}

/**
 * v0.6.1 自动标题:没有显式标题时取描述首句(压缩空白、截断 60 字符),
 * 描述为空则用名字的可读形式。标题只影响展示与审核指纹,不改变记忆语义。
 */
export function deriveTitle(description: string, name: string): string {
  const firstLine = description.trim().split(/\r?\n/, 1)[0] ?? ''
  const source = firstLine.replace(/\s+/g, ' ').trim() || name.replace(/[-_]+/g, ' ')
  return source.length > 60 ? `${source.slice(0, 59).trimEnd()}…` : source
}

// ---------- P0.5 三因子排序(Generative Agents 公式的免 embedding 版) ----------

/** 各类型缺省重要度(1-10;固化时 LLM 可显式覆盖)。 */
export const DEFAULT_IMPORTANCE: Readonly<Record<MemoryType, number>> = {
  feedback: 8,
  user: 7,
  project: 6,
  reference: 4,
  task: 6,
}

/**
 * 三因子评分(纯函数):importance × recency(0.995^天,天粒度取整保证当日稳定,
 * 不破坏 KV 前缀缓存)。relevance 需查询上下文,仅用于读取场景,不进注入排序。
 */
export function memoryScore(record: MemoryRecord, nowMs: number): number {
  const importance = record.importance ?? DEFAULT_IMPORTANCE[record.type]
  const anchor = record.lastReadMs ?? record.updatedMs ?? record.createdMs
  if (anchor === undefined) return importance // 无时间锚的旧文件:只看重要度
  const days = Math.max(0, Math.floor((nowMs - anchor) / 86_400_000))
  return importance * Math.pow(0.995, days)
}

/**
 * 描述相似度(Jaccard 词集,含 CJK bigram):固化防回声的查重依据。
 * 0.7.0 起算法单一实现点在 matching.ts,此处再导出以兼容既有导入。
 */
export { descriptionSimilarity } from './matching.ts'

/**
 * 记忆存储:管理 memoryDir 下两层目录。
 * 布局:memoryDir/--<project-slug>--/*.md 与 memoryDir/_user/*.md(各含 MEMORY.md)。
 */
/** write 入参:origin 只提供来源三要素,内容指纹由 store 清洗后计算。 */
export interface MemoryWriteInput extends Omit<MemoryRecord, 'scope' | 'origin'> {
  /** Optional optimistic concurrency token; stale edits fail inside the writer lock. */
  expectedRevision?: string
  /** 导入桥专用:目标层已有同名记忆时放弃写入(锁内判定,返回 null)。 */
  onlyIfAbsent?: boolean
  origin?: Omit<MemoryOrigin, 'hash'>
  /** v0.5.0:显式清空任务字段(否则 undefined 会继承旧值)。 */
  clearTaskFields?: Array<'dueAt' | 'remindAt' | 'priority' | 'taskStatus' | 'notifySessionId'>
}

export class MemoryStore {
  constructor(rootDir: string, options?: { staleAfterDays?: number; fault?: FaultHook }) {
    this.rootDir = absoluteRoot(rootDir)
    this.staleAfterDays = options?.staleAfterDays ?? 0
    this.fault = options?.fault
  }

  private readonly rootDir: string
  private readonly fault?: FaultHook
  private mutate<T>(scope: MemoryScope, cwd: string | undefined, operation: () => Promise<T>, bulk = false): Promise<T> {
    const dir = this.dir(scope, cwd)
    return withScopeTransaction(this.rootDir, dir, async () => {
      if (scope === 'project') {
        // Check again under the writer lock; two colliding project slugs cannot race to claim it.
        this.dir(scope, cwd)
        const file = join(dir, PROJECT_FILE)
        try { await readRegular(file) }
        catch (error) { if (errorCode(error) !== 'ENOENT') throw error; await durableWrite(file, JSON.stringify({ version: 1, cwd: resolve(cwd!) }) + '\n') }
      }
      return operation()
    }, { bulk, fault: this.fault })
  }
  /** 软淘汰阈值(天);0 = 禁用。索引重建时评估:陈旧零引用的记忆从索引隐藏(文件保留)。 */
  private readonly staleAfterDays: number

  /** 作用域对应目录;project 作用域必须携带会话 cwd(绝不静默回退 process.cwd())。 */
  dir(scope: MemoryScope, cwd?: string): string {
    if (scope !== 'user' && scope !== 'project') throw new Error('Invalid memory scope')
    if (scope === 'user') return join(this.rootDir, USER_SCOPE_DIR)
    if (cwd === undefined) throw new Error('project scope requires a session cwd (refusing to fall back to process.cwd())')
    const dir = join(this.rootDir, projectKey(cwd))
    assertNoLinksSync(dir)
    try {
      assertNoLinksSync(join(dir, PROJECT_FILE))
      const mapping = JSON.parse(readFileSync(join(dir, PROJECT_FILE), 'utf8'))
      const canonical = (s: string): string => process.platform === 'win32' ? resolve(s).toLowerCase() : resolve(s)
      if (mapping.version !== 1 || typeof mapping.cwd !== 'string' || canonical(mapping.cwd) !== canonical(cwd)) throw new Error('Project directory collision: explicit remapping required')
    } catch (error) { if (errorCode(error) !== 'ENOENT') throw error }
    return dir
  }

  /** 列出指定作用域全部记忆(畸形文件与 symlink 跳过;按 name 稳定排序)。 */
  async list(scope: MemoryScope, cwd?: string): Promise<MemoryRecord[]> {
    const dir = this.dir(scope, cwd)
    assertReadable(this.rootDir, dir)
    let dirents
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return []
      throw error
    }
    const records: MemoryRecord[] = []
    for (const dirent of dirents) {
      if (!dirent.isFile() || !dirent.name.endsWith('.md')) continue
      if (dirent.name.toLowerCase() === INDEX_FILENAME.toLowerCase()) continue
      const file = join(dir, dirent.name)
      if (isSymlink(file)) continue
      const raw = await readRegular(file).then(data => data.toString('utf8'))
      const record = raw === null ? null : parseMemory(raw, scope)
      if (record) records.push(record)
    }
    return records.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  /** 读单条记忆;不存在/为 symlink/畸形返回 null。 */
  async read(name: string, scope: MemoryScope, cwd?: string): Promise<MemoryRecord | null> {
    assertReadable(this.rootDir, this.dir(scope, cwd))
    const file = join(this.dir(scope, cwd), `${normalizeName(name)}.md`)
    if (isSymlink(file)) return null
    const raw = await readRegular(file).then(data => data.toString('utf8')).catch(error => { if (errorCode(error) === 'ENOENT') return null; throw error })
    return raw === null ? null : parseMemory(raw, scope)
  }

  /** 按优先级在多个作用域检索 name。 */
  async findIn(name: string, scopes: readonly MemoryScope[], cwd?: string): Promise<MemoryRecord | null> {
    for (const scope of scopes) {
      const record = await this.read(name, scope, cwd)
      if (record !== null) return record
    }
    return null
  }

  /** 合并两层作用域的全部记忆(用户级在前)。 */
  async listAll(cwd?: string): Promise<MemoryRecord[]> {
    return [...await this.list('user'), ...await this.list('project', cwd)]
  }

  /**
   * 写入(同名覆盖=更新),并在文件锁内重建该作用域索引。
   * 锁对象是索引文件:同一 workspace 的写/删串行化,跨进程安全;
   * 根锁与作用域恢复日志串行化修改;残留锁通过离线维护处理。
   */
  async write(record: MemoryWriteInput, scope: MemoryScope, cwd?: string): Promise<MemoryRecord | null> {
    const started = Date.now()
    let failure: unknown
    try {
      return await this.writeInternal(record, scope, cwd)
    } catch (error) {
      failure = error
      throw error
    } finally {
      recordWrite(Date.now() - started, failure)
    }
  }

  private async writeInternal(record: MemoryWriteInput, scope: MemoryScope, cwd?: string): Promise<MemoryRecord | null> {
    if (normalizeName(record.name) !== record.name) throw new Error('Store writes require a canonical memory name')
    if (Buffer.byteLength(JSON.stringify(record), 'utf8') > MAX_FILE_BYTES / 2) throw new Error('Record exceeds write size limit')
    const dir = this.dir(scope, cwd)
    const file = join(dir, `${record.name}.md`)
    // withFileLock 要求父目录已存在,先建目录再取锁
    let written: MemoryRecord | undefined
    await this.mutate(scope, cwd, async () => {
      // 锁内读旧记录拿生命周期基线(created/读取计数跨更新保留)
      const raw = await readRegular(file).then(data => data.toString('utf8')).catch(error => { if (errorCode(error) === 'ENOENT') return null; throw error })
      const existing = raw === null ? null : parseMemory(raw, scope)
      if (raw !== null && existing === null) throw new Error('Existing malformed record cannot be overwritten')
      if (record.expectedRevision !== undefined && record.expectedRevision !== existing?.revision) throw new Error('Revision conflict: reload before editing')
      // onlyIfAbsent(导入桥):同名判定下沉锁内,杜绝锁外快照的 TOCTOU
      // (导入期间并发写入的同名记忆会被覆盖);命中即放弃本次写入,返回 null
      // 固化候选显式带 status(sanitize 恒带 candidate)不允许复活 superseded
      // 文件(审查 major:同名候选 create 路径会覆写 superseded 文件使其重新
      // 注入)——superseded 只能经用户面板 restore 离开
      if (record.onlyIfAbsent === true && existing !== null) return
      // 可信状态与证据链(1.0.0,审查后统一单点语义):
      // - 调用方显式传 status → 按传入值(面板 verify/dispute/restore 是唯一
      //   人工流转入口;固化候选自带 candidate/disputed)
      // - 调用方未传且内容相对 existing **发生变化** → 信任重评:
      //   verified/candidate 降回 candidate(内容变了,旧验证不覆盖新内容);
      //   undefined(旧文件)改为 candidate;disputed/superseded 保留(fail-closed)
      //   同时旧 evidence 失效(逐字引用罩不住新内容)
      // - 内容未变(纯 echo 刷新/置顶停用等元数据写) → 原样继承,verified
      //   不被常规流量冲掉(审查 major:复述刷新剥验证)
      // - 注入扫描在 store 单点:body/description 命中指令注入模式 → disputed。
      //   只挂固化路径会被 memory_write 直写绕过(审查 major:guard 整体可绕)
      const pinned = record.pinned ?? existing?.pinned
      const disabled = record.disabled ?? existing?.disabled
      const importance = record.importance ?? existing?.importance
      // v0.5.0 任务字段:更新时缺省继承(纯内容更新/置顶停用不得清掉任务元数据);
      // clearTaskFields 显式清空,优先于继承(含“取消截止时间”这类编辑)
      const cleared = record.clearTaskFields ?? []
      const dueAt = cleared.includes('dueAt') ? undefined : record.dueAt ?? existing?.dueAt
      const remindAt = cleared.includes('remindAt') ? undefined : record.remindAt ?? existing?.remindAt
      const priority = cleared.includes('priority') ? undefined : record.priority ?? existing?.priority
      const taskStatus = cleared.includes('taskStatus') ? undefined : record.taskStatus ?? existing?.taskStatus
      const notifySessionId = cleared.includes('notifySessionId') ? undefined : record.notifySessionId ?? existing?.notifySessionId
      if (notifySessionId !== undefined && !/^[A-Za-z0-9_-]{1,80}$/.test(notifySessionId)) throw new Error('Invalid task notifySessionId: expected a host session id')
      for (const [field, value] of [['dueAt', dueAt], ['remindAt', remindAt]] as const) {
        if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new Error(`Invalid task ${field}: expected a positive epoch-ms integer`)
      }
      if (priority !== undefined && (!Number.isSafeInteger(priority) || priority < 1 || priority > 5)) throw new Error('Invalid task priority: expected 1-5')
      if (taskStatus !== undefined && taskStatus !== 'open' && taskStatus !== 'done' && taskStatus !== 'cancelled') throw new Error('Invalid task status')
      // 安全包:所有写入路径统一过脱敏 + 协议标签防护(单点拦截,含 title——
      // title 进索引行即注入内容,绕过即穿透壳/泄密,审查 blocker)
      const description = sanitizeContent(record.description)
      const body = sanitizeContent(record.body)
      // v0.6.1:标题缺省时自动生成,不要求用户先起名(取描述首句,必要时退回名字)
      const explicitTitle = record.title ?? existing?.title
      const title = explicitTitle ?? deriveTitle(description, record.name)
      // v1.0.0-rc.2 主题：更新时缺省继承；显式传空串表示清除（仅迁移/修数据用）
      const topic = record.topic === '' ? undefined : record.topic ?? existing?.topic
      if (topic !== undefined && !/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,31}$/u.test(topic)) throw new Error('Invalid memory topic: expected a topic id')
      const contentChanged = existing !== null
        && (existing.description !== description || existing.body !== body || existing.type !== record.type || (existing.title ?? '') !== (title === undefined ? '' : sanitizeContent(title)))
      // #19 superseded 复活守卫(审查 major):固化候选(sanitize 恒带 status
      // 'candidate')不允许覆写 superseded 文件——create 路径的同名候选会把它
      // 复活重新注入,与谱系语义矛盾。superseded 只能经用户面板显式 restore
      // 离开(显式传其它 status)。放在内容计算后:面板 restore 传 'candidate'
      // 是显式传值(record.status !== undefined),不受此守卫影响——守卫只拦
      // "status === 'candidate' 且内容变化"的固化形态。
      if (existing?.status === 'superseded' && record.status === 'candidate' && contentChanged) return
      let status = record.status ?? existing?.status ?? 'candidate'
      if (record.status === undefined && contentChanged) {
        if (existing?.status === 'verified' || existing?.status === 'candidate') status = 'candidate'
      }
      if (record.status === undefined && (detectDirectivePattern(body) === true || detectDirectivePattern(description) === true)) status = 'disputed'
      // evidence.quote 是自由文本(固化模型提供),与 description/body 同过
      // sanitizeContent 单点清洗;内容变化且调用方未带新证据 → 旧证据失效
      const evidenceSource = record.evidence ?? (contentChanged ? undefined : existing?.evidence)
      const evidence: MemoryEvidence | undefined = evidenceSource !== undefined
        ? { sessionId: evidenceSource.sessionId, quote: sanitizeContent(evidenceSource.quote) }
        : undefined
      // #19 谱系指针继承(防面板整条重写剥链——toggleFlag/setStatus 不带谱系字段);
      // 离开 superseded 态(显式传非 superseded 的 status)时清 supersededBy(链只活在被取代态)
      const supersededBy = status === 'superseded' ? (record.supersededBy ?? existing?.supersededBy) : undefined
      const supersedes = record.supersedes ?? existing?.supersedes
      // 导入溯源:首次导入按清洗后内容算指纹;后续任何写入(工具/固化/面板
      // 置顶停用)原样继承首次指纹,绝不重算——指纹只标记"导入瞬间的内容",
      // 撤销时用它判定这条是否已被改过。内容更新不重算 ≠ 指纹失效,比对时
      // 当前内容重算值自然对不上,落进"已修改,保留"分支。
      const origin: MemoryOrigin | undefined = record.origin !== undefined
        ? { ...record.origin, hash: contentFingerprint({ description, type: record.type, body }) }
        : existing?.origin
      // origin/onlyIfAbsent 是 write 入参专用字段,不落盘;先剥离再展开
      const fields: Omit<MemoryRecord, 'scope' | 'origin'> = { ...record }
      // 清空字段必须先从未归一化的拷贝里删掉,否则下面的展开会把旧值带回 next
      for (const field of cleared) delete (fields as Record<string, unknown>)[field]
      delete (fields as MemoryRecord & { clearTaskFields?: unknown }).clearTaskFields
      const next: MemoryRecord = {
        ...fields,
        metadata: { ...existing?.metadata, ...record.metadata },
        ...(pinned === true ? { pinned: true } : {}),
        ...(disabled === true ? { disabled: true } : {}),
        ...(importance !== undefined ? { importance } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(evidence !== undefined ? { evidence } : {}),
        ...(supersededBy !== undefined ? { supersededBy } : {}),
        ...(supersedes !== undefined ? { supersedes } : {}),
        ...(title !== undefined ? { title: sanitizeContent(title) } : {}),
        ...(dueAt !== undefined ? { dueAt } : {}),
        ...(remindAt !== undefined ? { remindAt } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(taskStatus !== undefined ? { taskStatus } : {}),
        ...(notifySessionId !== undefined ? { notifySessionId } : {}),
        ...(topic !== undefined ? { topic } : {}),
        description,
        body,
        ...(origin !== undefined ? { origin } : {}),
        ...mergeLifecycleMeta(existing, Date.now()),
        // 显式传入的时间戳优先(导入桥保留 Claude 原始 modified;
        // 现有写入路径不传,行为不变——mergeLifecycleMeta 的 now 语义照旧)
        ...(record.createdMs !== undefined ? { createdMs: record.createdMs } : {}),
        ...(record.updatedMs !== undefined ? { updatedMs: record.updatedMs } : {}),
        scope,
      }
      // v1.0.0-rc.2:清除主题时不能把空串落盘（fields 展开会带回入参）
      if (topic === undefined) delete (next as MemoryRecord & { topic?: string }).topic
      // 非任务类型不得携带任务字段(类型切换时清理,保持文件语义单一)
      if (next.type !== 'task') {
        delete next.dueAt
        delete next.remindAt
        delete next.priority
        delete next.taskStatus
        delete next.notifySessionId
      }
      // 内部指令字段不进入记录本体(避免经 API/工具回显再次进入写入路径)
      delete (next as MemoryRecord & { clearTaskFields?: unknown }).clearTaskFields
      written = next
      next.reviewHash = status === 'verified' ? (record.status === 'verified' ? reviewFingerprint(next) : existing?.reviewHash) : undefined
      const serialized = serializeMemory(next)
      next.revision = sha256(serialized)
      await writeFileAtomic(file, serialized, { mode: 0o600, dirMode: 0o700 })
      await this.rebuildIndex(scope, cwd)
    })
    // onlyIfAbsent 命中(锁内提前 return)时 written 未赋值 → null 表示未写入
    return written ?? null
  }

  /**
   * 记录一次读取(遗忘策略的引用计数):锁内重写 frontmatter 的 reads/lastRead。
   * best-effort:任何失败只放弃计数,绝不让 memory_read 因计数而失败。
   */
  async touch(name: string, scope: MemoryScope, cwd?: string): Promise<void> {
    try {
      const dir = this.dir(scope, cwd)
      const file = join(dir, `${normalizeName(name)}.md`)
      if (!(await fsp.stat(file).then(() => true, () => false))) return
      await this.mutate(scope, cwd, async () => {
        const record = parseMemory(await fsp.readFile(file, 'utf8').catch(() => ''), scope)
        if (record === null) return
        // 仅当旧记录当前处于"零引用超龄"隐藏态(本次计数会使其复活)才重建索引;
        // 行为决策(非纯优化,审查修正注释):仅在旧记录处于"零引用超龄"隐藏态
        // (本次计数会使其复活)时才重建索引。lastReadMs 是三因子排序锚点,
        // 若每次 touch 都重建,注入段文本会随每次 memory_read 抖动、打击 KV
        // 前缀缓存——故接受"排序到下次 write/delete/refresh 才生效"的延迟。
        const visibilityWillChange = isStale(record, this.staleAfterDays, Date.now())
        const touched: MemoryRecord = {
          ...record,
          reads: (record.reads ?? 0) + 1,
          lastReadMs: Date.now(),
        }
        await writeFileAtomic(file, serializeMemory(touched), { mode: 0o600, dirMode: 0o700 })
        if (visibilityWillChange) await this.rebuildIndex(scope, cwd)
      })
    } catch {
      // 计数失败静默:索引/读取不受影响
    }
  }

  /** Archive a whole scope atomically, retaining a separate pre-batch snapshot. */
  async clear(scope: MemoryScope, cwd?: string): Promise<number> {
    const dir = this.dir(scope, cwd)
    return this.mutate(scope, cwd, async () => {
      let removed = 0
      for (const name of await fsp.readdir(dir)) {
        if (!name.toLowerCase().endsWith('.md') || name.toLowerCase() === INDEX_FILENAME.toLowerCase()) continue
        if (await archiveFile(dir, name)) removed++
      }
      await this.rebuildIndex(scope, cwd)
      return removed
    }, true)
  }

  async refreshIndex(scope: MemoryScope, cwd?: string): Promise<void> {
    const dir = this.dir(scope, cwd)
    if (!await fsp.lstat(dir).then(() => true, error => { if (errorCode(error) === 'ENOENT') return false; throw error })) return
    await this.mutate(scope, cwd, () => this.rebuildIndex(scope, cwd))
  }

  /** Deleted bytes and metadata remain in .archive, excluded from normal reads. */
  async delete(name: string, scope: MemoryScope, cwd?: string): Promise<boolean> {
    const filename = normalizeName(name) + '.md'
    return this.mutate(scope, cwd, async () => {
      const removed = await archiveFile(this.dir(scope, cwd), filename)
      if (removed) await this.rebuildIndex(scope, cwd)
      return removed
    })
  }

  async deleteIf(name: string, scope: MemoryScope, cwd: string | undefined, predicate: (record: MemoryRecord) => boolean): Promise<boolean> {
    return this.mutate(scope, cwd, async () => {
      const record = await this.read(name, scope, cwd)
      if (record === null || !predicate(record)) return false
      const removed = await archiveFile(this.dir(scope, cwd), normalizeName(name) + '.md')
      if (removed) await this.rebuildIndex(scope, cwd)
      return removed
    })
  }

  /** Re-evaluate selection under the lock; any failure rolls the entire scope back. */
  async prune(olderThanDays: number, scope: MemoryScope, cwd?: string, now = Date.now()): Promise<number> {
    if (!Number.isSafeInteger(olderThanDays) || olderThanDays < 1) throw new Error('Invalid prune age')
    return this.mutate(scope, cwd, async () => {
      let removed = 0
      for (const record of await this.list(scope, cwd)) {
        const updated = record.updatedMs ?? record.createdMs
        if (updated === undefined || Math.floor((now - updated) / 86_400_000) < olderThanDays) continue
        if (await archiveFile(this.dir(scope, cwd), record.name + '.md')) removed++
      }
      await this.rebuildIndex(scope, cwd)
      return removed
    }, true)
  }

  async listArchive(scope: MemoryScope, cwd?: string): Promise<Array<{ id: string; name: string; deletedAt: string; hash: string }>> {
    const dir = this.dir(scope, cwd)
    assertReadable(this.rootDir, dir)
    const archive = inside(dir, '.archive')
    const names = await fsp.readdir(archive).catch(error => { if (errorCode(error) === 'ENOENT') return []; throw error })
    const result = []
    for (const name of names.sort()) {
      if (!/^[0-9a-f-]{36}\.json$/.test(name)) throw new Error('Unexpected archive entry')
      const item = JSON.parse((await readRegular(inside(archive, name), MAX_FILE_BYTES * 2)).toString('utf8'))
      if (item.version !== 1 || name !== item.id + '.json' || typeof item.deletedAt !== 'string') throw new Error('Invalid archive')
      decodeImage(item.file)
      result.push({ id: item.id, name: item.file.path, deletedAt: item.deletedAt, hash: item.file.hash })
    }
    return result
  }

  async listBackups(scope: MemoryScope, cwd?: string): Promise<Array<{ file: string; hash: string }>> {
    const dir = this.dir(scope, cwd)
    assertReadable(this.rootDir, dir)
    const backup = inside(dir, '.backups')
    const names = await fsp.readdir(backup).catch(error => { if (errorCode(error) === 'ENOENT') return []; throw error })
    const result = []
    for (const name of names.sort()) {
      if (!/^[0-9a-f-]{36}\.json$/.test(name)) throw new Error('Unexpected backup entry')
      const file = inside(backup, name)
      result.push({ file, hash: sha256(await readRegular(file, MAX_TOTAL_BYTES * 2)) })
    }
    return result
  }

  /** Human-management path: compare the exact reviewed revision under the writer lock. */
  async review(name: string, scope: MemoryScope, cwd: string | undefined, expectedRevision: string, status: MemoryStatus): Promise<MemoryRecord> {
    const current = await this.read(name, scope, cwd)
    if (!current) throw new Error('NOT_FOUND')
    const result = await this.write({ ...current, origin: undefined, status, expectedRevision }, scope, cwd)
    if (!result) throw new Error('Review rejected')
    return result
  }

  /**
   * 标记一条记录被同 scope 的另一条取代：来源转 superseded 并写 supersededBy 回链，
   * 继任者补 supersedes 前链；两条记录都保留，可沿链恢复。不做删除、不自动合并。
   */
  async supersede(name: string, scope: MemoryScope, cwd: string | undefined, expectedRevision: string, successorName: string): Promise<{ source: MemoryRecord; successor: MemoryRecord }> {
    const canonical = normalizeName(name)
    const successor = normalizeName(successorName)
    if (successor === canonical) throw new Error('Cannot supersede a record with itself')
    const source = await this.read(canonical, scope, cwd)
    if (!source) throw new Error('NOT_FOUND')
    if (source.revision !== expectedRevision) throw new Error('Revision conflict: reload before superseding')
    if (source.status === 'superseded' || source.supersededBy !== undefined) throw new Error('Record is already superseded')
    const target = await this.read(successor, scope, cwd)
    if (!target) throw new Error('SUCCESSOR_NOT_FOUND')
    if (target.status === 'superseded' || target.supersededBy !== undefined) throw new Error('Successor is itself superseded')

    await this.write({ ...source, origin: undefined, status: 'superseded', supersededBy: successor, expectedRevision }, scope, cwd)
    await this.write({ ...target, origin: undefined, supersedes: canonical, expectedRevision: target.revision }, scope, cwd)
    const updatedSource = await this.read(canonical, scope, cwd)
    const updatedTarget = await this.read(successor, scope, cwd)
    if (!updatedSource || !updatedTarget) throw new Error('Supersede write not visible')
    return { source: updatedSource, successor: updatedTarget }
  }

  async deleteVersioned(name: string, scope: MemoryScope, cwd: string | undefined, expectedRevision: string): Promise<{ archiveId: string }> {
    return this.mutate(scope, cwd, async () => {
      const record = await this.read(name, scope, cwd)
      if (!record) throw new Error('NOT_FOUND')
      if (record.revision !== expectedRevision) throw new Error('Revision conflict: reload before deleting')
      const before = new Set((await this.listArchive(scope, cwd)).map(a => a.id))
      await archiveFile(this.dir(scope, cwd), normalizeName(name) + '.md')
      await this.rebuildIndex(scope, cwd)
      const archive = (await this.listArchive(scope, cwd)).find(a => !before.has(a.id))
      if (!archive) throw new Error('Archive not found after deletion')
      return { archiveId: archive.id }
    })
  }

  /** Read current source records, never trust a cached/hand-edited MEMORY.md for injection. */
  scanSync(scope: MemoryScope, cwd?: string): { records: MemoryRecord[]; issues: string[] } {
    const records: MemoryRecord[] = [], issues: string[] = []
    try {
      const dir = this.dir(scope, cwd)
      assertReadable(this.rootDir, dir)
        const markerFile = inside(this.rootDir, '.wh-format.json')
        const markerStat = lstatSync(markerFile)
        if (!markerStat.isFile() || markerStat.size > 4096) throw new Error('INCOMPATIBLE_SCHEMA')
        const marker = JSON.parse(readFileSync(markerFile, 'utf8'))
        if (marker.format !== 'dsh-auto-memory-wh' || marker.version !== 1) throw new Error('INCOMPATIBLE_SCHEMA')
      let total = 0
      const entries = readdirSync(dir, { withFileTypes: true })
      if (entries.length > 8192) throw new Error('QUOTA_EXCEEDED')
      for (const entry of entries) {
        if (!entry.name.endsWith('.md') || entry.name.toLowerCase() === INDEX_FILENAME.toLowerCase()) continue
        if (!entry.isFile()) { issues.push('unsafe-file'); continue }
        const file = inside(dir, entry.name), stat = lstatSync(file)
        if (stat.size > MAX_FILE_BYTES || (total += stat.size) > MAX_TOTAL_BYTES) throw new Error('QUOTA_EXCEEDED')
        const raw = readFileSync(file, 'utf8')
        const record = parseMemory(raw, scope)
        if (!record || record.name + '.md' !== entry.name) { issues.push('invalid-record'); continue }
        records.push(record)
      }
      return { records, issues }
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return { records: [], issues: [] }
      return { records: [], issues: ['storage-unavailable'] }
    }
  }

  /** Bounded concurrent source scan used by the asynchronous prompt assembly path. */
  async scanAsync(scope: MemoryScope, cwd?: string): Promise<{ records: MemoryRecord[]; issues: string[] }> {
    let directoryListed = false
    try {
      const dir = this.dir(scope, cwd)
      assertReadable(this.rootDir, dir)
      const markerFile = inside(this.rootDir, '.wh-format.json')
      const markerBytes = await readRegular(markerFile, 4096)
      const marker = JSON.parse(markerBytes.toString('utf8'))
      if (marker.format !== 'dsh-auto-memory-wh' || marker.version !== 1) throw new Error('INCOMPATIBLE_SCHEMA')
      const entries = await fsp.readdir(dir, { withFileTypes: true })
      directoryListed = true
      if (entries.length > 8192) throw new Error('QUOTA_EXCEEDED')
      const selected = entries.filter(entry => entry.name.endsWith('.md') && entry.name.toLowerCase() !== INDEX_FILENAME.toLowerCase())
      const items: Array<{ record?: MemoryRecord; issue?: string; bytes?: number }> = Array(selected.length)
      let next = 0
      const workers = await Promise.allSettled(Array.from({ length: Math.min(16, selected.length) }, async () => {
        for (;;) {
          const index = next++
          if (index >= selected.length) return
          const entry = selected[index]
          if (!entry.isFile()) { items[index] = { issue: 'unsafe-file' }; continue }
          const data = await readRegular(inside(dir, entry.name), MAX_FILE_BYTES)
          const record = parseMemory(data.toString('utf8'), scope)
          items[index] = record && record.name + '.md' === entry.name
            ? { record, bytes: data.length } : { issue: 'invalid-record', bytes: data.length }
        }
      }))
      const failure = workers.find((worker): worker is PromiseRejectedResult => worker.status === 'rejected')
      if (failure) throw failure.reason
      const total = items.reduce((sum, item) => sum + (item.bytes ?? 0), 0)
      if (total > MAX_TOTAL_BYTES) throw new Error('QUOTA_EXCEEDED')
      assertReadable(this.rootDir, dir)
      const currentMarker = await readRegular(markerFile, 4096)
      if (!currentMarker.equals(markerBytes)) throw new Error('INCOMPATIBLE_SCHEMA')
      const currentEntries = await fsp.readdir(dir)
      const beforeNames = entries.map(entry => entry.name).sort()
      if (currentEntries.length !== beforeNames.length || currentEntries.sort().some((name, index) => name !== beforeNames[index])) throw new Error('STORAGE_CHANGED')
      return { records: items.flatMap(item => item.record ? [item.record] : []), issues: items.flatMap(item => item.issue ? [item.issue] : []) }
    } catch (error) {
      if (!directoryListed && errorCode(error) === 'ENOENT') return { records: [], issues: [] }
      return { records: [], issues: ['storage-unavailable'] }
    }
  }

  /** Never overwrite a newer record. Raw bytes, unknown metadata and trust are retained. */
  async restoreArchived(id: string, scope: MemoryScope, cwd?: string, expectedHash?: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid archive ID')
    const dir = this.dir(scope, cwd)
    await this.mutate(scope, cwd, async () => {
      const item = JSON.parse((await readRegular(inside(dir, '.archive/' + id + '.json'), MAX_FILE_BYTES * 2)).toString('utf8'))
      if (item.version !== 1 || item.id !== id || !/^[a-z0-9-]+\.md$/.test(item.file?.path)) throw new Error('Invalid archive')
      if (expectedHash !== undefined && item.file.hash !== expectedHash) throw new Error('Restore conflict: archive changed')
      const data = decodeImage(item.file)
      if (parseMemory(data.toString('utf8'), scope) === null) throw new Error('Malformed archive requires manual review')
      const file = inside(dir, item.file.path)
      if (await fsp.lstat(file).then(() => true, error => { if (errorCode(error) === 'ENOENT') return false; throw error })) throw new Error('Restore conflict: current record exists')
      await durableWrite(file, data)
      await this.rebuildIndex(scope, cwd)
      // Retain archive as recovery history; a repeated restore conflicts instead of duplicating.
    })
  }

  /** Derived index is part of the same scope transaction. */
  private async rebuildIndex(scope: MemoryScope, cwd?: string): Promise<void> {
    const dir = this.dir(scope, cwd)
    const records = await this.list(scope, cwd)
    const visible = records.filter(record => !isStale(record, this.staleAfterDays, Date.now()))
    const indexFile = join(dir, INDEX_FILENAME)
    if (visible.length === 0) {
      await fsp.rm(indexFile, { force: true })
      return
    }
    await writeFileAtomic(indexFile, renderIndexBody(visible), { mode: 0o600, dirMode: 0o700 })
  }

  /**
   * 同步读取索引正文(供系统提示词 text 函数;索引有 maxBytes 预算,直接读盘成本可忽略,
   * 不做缓存——mtime/size 缓存在粗时间戳文件系统上会注入陈旧索引,审查确认为隐患)。
   * 文件缺失/symlink/损坏返回 null。
   */
  readIndexSync(scope: MemoryScope, cwd?: string): string | null {
    const scan = this.scanSync(scope, cwd)
    const text = renderIndexBody(scan.records.filter(r => !isStale(r, this.staleAfterDays, Date.now())))
    return text.trim() ? text : null
  }
}
