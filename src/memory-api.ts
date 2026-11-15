/**
 * 宿主半的 Web API:浏览器面板经 Connection 认证围栏读写记忆。
 *
 * 形态(源码调研结论,见 internal research notes):
 * - `ctx.connection.fetch.register` 注册路由(dsh 认证围栏内,loopback 默认);
 * - 路径用点号分段(/api/auto-memory/memories.list)避开网关的两段认领形状;
 * - 机会式获取 connection:非 web 组合(headless/测试栈)没有该服务,静默 no-op;
 * - 事件白名单硬编码:浏览器侧靠操作后 refetch 刷新,不做推送。
 *
 * 作用域定位:项目层目录由 cwd 派生(projectKey 单向),因此:
 * - list 扫描 memoryDir 下全部目录(用户级 + 每个项目 slug),全局只读总览;
 * - 写/删操作由浏览器带 ?cwd=(从当前会话快照取得),走 store 原生路径。
 */

import type { Context } from '@deepseek-ai/cordis'
import { API_BASE } from './identity.ts'
// 类型:Connection 服务(fetch 路由注册面)
import type {} from '@deepseek-ai/dsh-client-connection'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { MemoryStore, INDEX_FILENAME, isStale, memoryScore, parseMemory, projectKey } from './store.ts'
import { normalizeName } from './store.ts'
import { descriptionSimilarity } from './matching.ts'
import { scanClaudeMemory, annotateClaudeImport, runClaudeImport, revokeClaudeImports } from './import-claude.ts'
import type { ImportTarget } from './import-claude.ts'
import { readAudit, aggregateAudit } from './audit.ts'
import { renderAgentsExport, trustedForExport } from './export-agents.ts'
import { indexByteBudget } from './prompt.ts'
import { homedir } from 'node:os'
import type { MemoryEvidence, MemoryRecord, MemoryScope, MemoryStatus, MemoryType } from './types.ts'
import { USER_SCOPE_DIR } from './types.ts'

/** 面板条目(浏览器可见的字段子集)。 */
export interface PanelMemory {
  name: string
  title?: string
  description: string
  type: MemoryType
  pinned: boolean
  disabled: boolean
  /** 软淘汰命中:文件仍存在,但重建索引时不会进入注入(面板需与"生效"区分)。 */
  stale: boolean
  /** 可信状态(缺省 = 信任态;disputed/superseded 不注入)。 */
  status?: MemoryStatus
  /** #19 谱系:本条被哪条记忆取代(仅 superseded 态;面板跳转后继)。 */
  supersededBy?: string
  /** #19 谱系:本条取代了哪条旧记忆(徽章 tooltip 展示)。 */
  supersedes?: string
  /** 证据链(固化产物附带;面板验证决策的依据)。 */
  evidence?: MemoryEvidence
  /** 创建时间(体检的年龄计算/面板 tooltip)。 */
  createdMs?: number
  reads: number
  updatedMs?: number
  bytes: number
  /** 导入溯源(仅来源种类;完整 slug/file 不回显给浏览器)。 */
  importedFrom?: 'claude-code'
}

/** 一组记忆(用户级或某个项目 slug)。 */
export interface PanelGroup {
  key: string
  scope: MemoryScope
  /** 项目目录名(--slug--);用户层为 _user。 */
  slug: string
  /** 该组是否对应当前会话的工作区(可执行写/删操作)。 */
  current?: boolean
  memories: PanelMemory[]
  indexBytes: number
  indexText: string | null
}

const BASE = API_BASE

/** 列出一个目录组(读文件,畸形/符号链接跳过——与 store.list 同纪律)。 */
async function readGroup(
  dir: string,
  scope: MemoryScope,
  slug: string,
  staleAfterDays: number,
  now: number,
): Promise<PanelGroup> {
  const group: PanelGroup = { key: slug, scope, slug, memories: [], indexBytes: 0, indexText: null }
  let entries
  try {
    // withFileTypes + isFile:与 store.list 同纪律排除 symlink/目录(审查确认
    // 旧实现可把 memoryDir 外的 symlink 内容读进面板)
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return group
  }
  const records: Array<{ record: MemoryRecord, bytes: number }> = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const file = join(dir, entry.name)
    const raw = await fsp.readFile(file, 'utf8').catch(() => null)
    if (raw === null) continue
    if (entry.name.toLowerCase() === INDEX_FILENAME.toLowerCase()) {
      group.indexBytes = Buffer.byteLength(raw, 'utf8')
      // 面板预览截断:超大索引不应把数倍体积的 JSON 推给浏览器(审查确认)
      group.indexText = raw.length > 0 ? raw.slice(0, 8192) : null
      continue
    }
    const record = parseMemory(raw, scope)
    if (record === null) continue
    records.push({ record, bytes: Buffer.byteLength(raw, 'utf8') })
  }
  // 排序口径与 renderIndexBody 完全一致:pinned → 三因子分(importance×recency)
  // → name。面板顺序=模型看到的索引顺序,置顶以下的"为什么这条在前面"可解释。
  records.sort((a, b) => {
    const pa = a.record.pinned === true ? 0 : 1
    const pb = b.record.pinned === true ? 0 : 1
    if (pa !== pb) return pa - pb
    const sa = memoryScore(a.record, now)
    const sb = memoryScore(b.record, now)
    if (sa !== sb) return sb - sa
    return a.record.name < b.record.name ? -1 : a.record.name > b.record.name ? 1 : 0
  })
  for (const { record, bytes } of records) {
    group.memories.push({
      name: record.name,
      ...(record.title !== undefined ? { title: record.title } : {}),
      description: record.description,
      type: record.type,
      pinned: record.pinned === true,
      disabled: record.disabled === true,
      stale: isStale(record, staleAfterDays, now),
      ...(record.status !== undefined ? { status: record.status } : {}),
      ...(record.supersededBy !== undefined ? { supersededBy: record.supersededBy } : {}),
      ...(record.supersedes !== undefined ? { supersedes: record.supersedes } : {}),
      ...(record.evidence !== undefined ? { evidence: record.evidence } : {}),
      ...(record.createdMs !== undefined ? { createdMs: record.createdMs } : {}),
      reads: record.reads ?? 0,
      ...(record.updatedMs !== undefined ? { updatedMs: record.updatedMs } : {}),
      ...(record.origin !== undefined ? { importedFrom: record.origin.kind } : {}),
      bytes,
    })
  }
  return group
}

/** 全量记录扫描(health.report 用):与 readGroup 同纪律(symlink 排除/坏文件跳过),但保留完整记录。 */
async function scanAllRecords(rootDir: string): Promise<Array<{ record: MemoryRecord, scope: MemoryScope, slug: string }>> {
  const out: Array<{ record: MemoryRecord, scope: MemoryScope, slug: string }> = []
  const scanDir = async (dir: string, scope: MemoryScope, slug: string): Promise<void> => {
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch { return }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      if (entry.name.toLowerCase() === INDEX_FILENAME.toLowerCase()) continue
      const raw = await fsp.readFile(join(dir, entry.name), 'utf8').catch(() => null)
      if (raw === null) continue
      const record = parseMemory(raw, scope)
      if (record === null) continue
      out.push({ record, scope, slug })
    }
  }
  await scanDir(join(rootDir, USER_SCOPE_DIR), 'user', USER_SCOPE_DIR)
  let entries: string[] = []
  try {
    entries = await fsp.readdir(rootDir)
  } catch { return out }
  for (const entry of entries.sort()) {
    if (!entry.startsWith('--') || !entry.endsWith('--') || entry === USER_SCOPE_DIR) continue
    await scanDir(join(rootDir, entry), 'project', entry)
  }
  return out
}

/** 记忆体检报告(1.0.0 可信记忆;三榜,面板 HealthSection 渲染)。 */
export interface HealthReport {
  /** 待验证:status=candidate 的记忆(固化产物,引导用户升级 verified)。 */
  unverified: Array<{ name: string, scope: MemoryScope, slug: string, hasEvidence: boolean }>
  /** 僵尸:零引用且超过 30 天(从未被任何会话召回过——沉淀即遗忘)。 */
  zombies: Array<{ name: string, scope: MemoryScope, slug: string, ageDays: number }>
  /** 矛盾嫌疑:跨层同名 + 同层近重复(description 相似度 ≥0.9)。 */
  conflicts: Array<{ kind: 'cross-scope' | 'near-duplicate', a: { name: string, scope: MemoryScope }, b: { name: string, scope: MemoryScope } }>
}

/** 聚合体检三榜(纯函数便于测试;conflicts 的两两比对按 scope 分组、每组限 200 条)。 */
export function buildHealthReport(entries: Array<{ record: MemoryRecord, scope: MemoryScope, slug: string }>, now = Date.now()): HealthReport {
  const report: HealthReport = { unverified: [], zombies: [], conflicts: [] }
  for (const { record, scope, slug } of entries) {
    if (record.status === 'candidate') {
      report.unverified.push({ name: record.name, scope, slug, hasEvidence: record.evidence !== undefined })
    }
    const ageDays = record.createdMs !== undefined ? Math.floor((now - record.createdMs) / 86_400_000) : 0
    if ((record.reads ?? 0) === 0 && ageDays > 30 && record.status !== 'disputed' && record.status !== 'superseded') {
      report.zombies.push({ name: record.name, scope, slug, ageDays })
    }
  }
  // 跨层同名:user 层与项目层同名(findIn 的优先级语义让两者命运取决于查询
  // 顺序——这正是容易"看着像一条实际是两条"的矛盾温床)
  const userNames = new Set(entries.filter(e => e.scope === 'user').map(e => e.record.name))
  const seenProject = new Set<string>()
  for (const { record, scope } of entries) {
    if (scope !== 'project') continue
    if (userNames.has(record.name) && !seenProject.has(record.name)) {
      seenProject.add(record.name)
      report.conflicts.push({ kind: 'cross-scope', a: { name: record.name, scope: 'user' }, b: { name: record.name, scope: 'project' } })
    }
  }
  // 同层近重复:O(n²) 有界(每 scope 截 200 条;描述相似度阈值 0.9 收紧——
  // 0.7 是"同义改写=更新"的合并线,0.9 以上才是"两条并存讲同一件事"的嫌疑)
  const byScope = new Map<string, Array<{ record: MemoryRecord, scope: MemoryScope, slug: string }>>()
  for (const e of entries) {
    const key = `${e.scope} ${e.slug}`
    const list = byScope.get(key) ?? []
    if (list.length < 200) list.push(e)
    byScope.set(key, list)
  }
  let reported = 0
  for (const list of byScope.values()) {
    for (let i = 0; i < list.length && reported < 20; i++) {
      for (let j = i + 1; j < list.length && reported < 20; j++) {
        const a = list[i]!, b = list[j]!
        if (descriptionSimilarity(a.record.description, b.record.description) >= 0.9) {
          report.conflicts.push({ kind: 'near-duplicate', a: { name: a.record.name, scope: a.scope }, b: { name: b.record.name, scope: b.scope } })
          reported += 1
        }
      }
    }
  }
  return report
}

/** 扫描记忆根目录的全部组(用户级在前,项目组按目录名序)。 */
export async function scanGroups(rootDir: string, staleAfterDays = 0): Promise<PanelGroup[]> {
  const now = Date.now()
  const groups: PanelGroup[] = [await readGroup(join(rootDir, USER_SCOPE_DIR), 'user', USER_SCOPE_DIR, staleAfterDays, now)]
  let entries: string[]
  try {
    entries = await fsp.readdir(rootDir)
  } catch {
    return groups
  }
  for (const entry of entries.sort()) {
    if (!entry.startsWith('--') || !entry.endsWith('--')) continue
    if (entry === USER_SCOPE_DIR) continue
    groups.push(await readGroup(join(rootDir, entry), 'project', entry, staleAfterDays, now))
  }
  return groups.filter(group => group.memories.length > 0 || group.indexText !== null)
}

/**
 * 解析条目级导入目标({slug,file} 数组)。undefined → [];畸形 → null(调用方
 * 400)。与 slugs 校验同款 fail-closed 纪律:静默降级成"全部撤销"是最坏方向。
 */
function parseImportTargets(value: unknown): ImportTarget[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const targets: ImportTarget[] = []
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
    const item = raw as { slug?: unknown, file?: unknown }
    if (typeof item.slug !== 'string' || item.slug.length === 0 || item.slug.length > 512) return null
    if (typeof item.file !== 'string' || item.file.length === 0 || item.file.length > 512) return null
    targets.push({ slug: item.slug, file: item.file })
  }
  return targets
}

export { registerMemoryApi } from './management-api.ts'
