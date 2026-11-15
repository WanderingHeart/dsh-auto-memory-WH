/**
 * v1.0.0-rc.3 人物弧光（roadmap 1.7 P3，只读）。
 *
 * 把记忆按“主题成章、章内按时间”串成一条叙事线，回答“这些东西怎么一步步变成现在”。
 * 与 v0.10.0 关系图互补：关系图看“此刻谁和谁相关”，弧光看“时间上怎么演变”。
 *
 * 纪律：
 * - 只读：不写记忆、不合并、不改信任；跨用户层与全部项目 scope 合成一条线。
 * - 不调用模型、不做 embedding：只用已有字段（topic / createdMs / supersededBy / links）
 *   与主题注册表，零 token。
 * - 损坏/符号链接/超大文件一律跳过并计数，不把异常内容当作有效记忆。
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_FILE, errorCode, readRegular } from './storage-safety.ts'
import { INDEX_FILENAME, parseMemory } from './store.ts'
import { readTopicRegistry, UNCLASSIFIED_TOPIC, type TopicEntry } from './topics.ts'
import { USER_SCOPE_DIR, type MemoryRecord, type MemoryScope, type MemoryStatus } from './types.ts'

/** 单次合成的记录上限：弧光是只读视图，宁可截断也不把整棵记忆树读进内存。 */
export const MAX_ARC_RECORDS = 2000

/** 展示用来源标签：用户层固定“个人”，项目层取工作目录名，再退回目录 slug。 */
export function arcOriginLabel(slug: string, cwd?: string): string {
  if (slug === USER_SCOPE_DIR) return '个人'
  if (cwd !== undefined) {
    const trimmed = cwd.replace(/[\\/]+$/u, '')
    const base = trimmed.split(/[\\/]/u).pop()
    if (base !== undefined && base.length > 0) return base
  }
  return slug.replace(/^--/u, '').replace(/--$/u, '') || slug
}

export interface ArcSource {
  name: string
  title?: string
  description: string
  type: string
  scope: MemoryScope
  /** 展示用来源标签（个人 / 工作目录名）。 */
  origin: string
  /** 项目层的完整工作目录（用于悬停提示）；用户层缺省。 */
  originPath?: string
  topic?: string
  status?: MemoryStatus
  createdMs?: number
  updatedMs?: number
  supersededBy?: string
  supersedes?: string
}

/** 弧光里的一个节点：保留展示所需的最小字段，不带正文。 */
export interface ArcEntry {
  /** React key / 定位用：scope:name（跨层同名也不会撞）。 */
  key: string
  name: string
  title: string
  description: string
  type: string
  scope: MemoryScope
  origin: string
  originPath?: string
  /** 缺省 legacy（旧记录未审核）。 */
  status: string
  /** 时间轴锚点（epoch ms）；0 表示时间未知，排在章末。 */
  at: number
  updatedMs?: number
  supersededBy?: string
  supersedes?: string
}

export interface ArcChapter {
  topic: string
  title: string
  note?: string
  records: ArcEntry[]
}

export interface ArcSourceSummary {
  scope: MemoryScope
  slug: string
  label: string
  path?: string
  count: number
}

export interface ArcView {
  chapters: ArcChapter[]
  total: number
  /** 解析失败/读取失败而跳过的文件数。 */
  skipped: number
  /** 是否因 MAX_ARC_RECORDS 截断。 */
  truncated: boolean
  sources: ArcSourceSummary[]
  generatedMs: number
}

export interface ArcScan {
  records: ArcSource[]
  topics: TopicEntry[]
  sources: ArcSourceSummary[]
  skipped: number
  truncated: boolean
}

/** 合并多个 scope 的主题注册表：按先出现的顺序去重（用户层在前）。 */
export function mergeTopics(registries: ReadonlyArray<readonly TopicEntry[]>): TopicEntry[] {
  const seen = new Set<string>()
  const merged: TopicEntry[] = []
  for (const registry of registries) {
    for (const topic of registry) {
      if (seen.has(topic.id)) continue
      seen.add(topic.id)
      merged.push(topic)
    }
  }
  return merged
}

function toEntry(record: ArcSource): ArcEntry {
  return {
    key: `${record.scope}:${record.name}`,
    name: record.name,
    title: (record.title ?? '').trim() || record.name,
    description: record.description,
    type: record.type,
    scope: record.scope,
    origin: record.origin,
    ...(record.originPath !== undefined ? { originPath: record.originPath } : {}),
    status: record.status ?? 'legacy',
    at: record.createdMs ?? record.updatedMs ?? 0,
    ...(record.updatedMs !== undefined ? { updatedMs: record.updatedMs } : {}),
    ...(record.supersededBy !== undefined ? { supersededBy: record.supersededBy } : {}),
    ...(record.supersedes !== undefined ? { supersedes: record.supersedes } : {}),
  }
}

/**
 * 主题成章、章内按时间排序。
 *
 * 章节顺序 = 注册表顺序（用户层注册表在前）→ 未登记主题按名称 → “未归类”永远最后。
 * 只保留有记录的章节：空章只会让人误以为“这里还有东西没读出来”。
 */
export function buildArcView(
  records: readonly ArcSource[],
  topics: readonly TopicEntry[],
  options: { sources?: readonly ArcSourceSummary[]; skipped?: number; truncated?: boolean; now?: number } = {},
): ArcView {
  const byId = new Map<string, TopicEntry>()
  for (const topic of topics) if (!byId.has(topic.id)) byId.set(topic.id, topic)
  const groups = new Map<string, ArcEntry[]>()
  for (const record of records) {
    const topic = (record.topic ?? '').trim() || UNCLASSIFIED_TOPIC
    const list = groups.get(topic) ?? []
    list.push(toEntry(record))
    groups.set(topic, list)
  }

  const order: string[] = []
  for (const id of byId.keys()) if (groups.has(id)) order.push(id)
  const extras = [...groups.keys()]
    .filter(id => !byId.has(id) && id !== UNCLASSIFIED_TOPIC)
    .sort((left, right) => left.localeCompare(right, 'zh'))
  order.push(...extras)
  if (groups.has(UNCLASSIFIED_TOPIC)) order.push(UNCLASSIFIED_TOPIC)

  const chapters: ArcChapter[] = order.map(id => {
    const entries = groups.get(id) ?? []
    entries.sort((left, right) => {
      const leftAt = left.at > 0 ? left.at : Number.MAX_SAFE_INTEGER
      const rightAt = right.at > 0 ? right.at : Number.MAX_SAFE_INTEGER
      return leftAt - rightAt || left.name.localeCompare(right.name, 'en') || left.key.localeCompare(right.key)
    })
    const topic = byId.get(id)
    const note = id === UNCLASSIFIED_TOPIC
      ? '尚未归类的记忆；可在主题注册表里补一个主题。'
      : topic?.note ?? '这个主题不在注册表里（旧数据或手写 topic）。'
    return {
      topic: id,
      title: topic?.title ?? id,
      note,
      records: entries,
    }
  })

  return {
    chapters,
    total: records.length,
    skipped: options.skipped ?? 0,
    truncated: options.truncated ?? false,
    sources: [...(options.sources ?? [])],
    generatedMs: options.now ?? Date.now(),
  }
}

function toSource(record: MemoryRecord, origin: string, originPath: string | undefined): ArcSource {
  return {
    name: record.name,
    ...(record.title !== undefined ? { title: record.title } : {}),
    description: record.description,
    type: record.type,
    scope: record.scope,
    origin,
    ...(originPath !== undefined ? { originPath } : {}),
    ...(record.topic !== undefined ? { topic: record.topic } : {}),
    ...(record.status !== undefined ? { status: record.status } : {}),
    ...(record.createdMs !== undefined ? { createdMs: record.createdMs } : {}),
    ...(record.updatedMs !== undefined ? { updatedMs: record.updatedMs } : {}),
    ...(record.supersededBy !== undefined ? { supersededBy: record.supersededBy } : {}),
    ...(record.supersedes !== undefined ? { supersedes: record.supersedes } : {}),
  }
}

interface ScanState {
  records: ArcSource[]
  skipped: number
  truncated: boolean
}

/** 读一个 scope 目录下全部记录（symlink/坏文件跳过并计数），返回读到的条数。 */
async function scanScopeDir(
  dir: string,
  scope: MemoryScope,
  origin: string,
  originPath: string | undefined,
  state: ScanState,
): Promise<number> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 0
    throw error
  }
  const files = entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md') && entry.name.toLowerCase() !== INDEX_FILENAME.toLowerCase())
    .map(entry => entry.name)
    .sort()
  let count = 0
  for (const name of files) {
    if (state.records.length >= MAX_ARC_RECORDS) {
      state.truncated = true
      break
    }
    let raw: Buffer
    try {
      raw = await readRegular(join(dir, name))
    } catch {
      state.skipped += 1
      continue
    }
    const record = parseMemory(raw.toString('utf8'), scope)
    if (record === null) {
      state.skipped += 1
      continue
    }
    state.records.push(toSource(record, origin, originPath))
    count += 1
  }
  return count
}

async function readProjectCwd(dir: string): Promise<string | undefined> {
  try {
    const raw = await readRegular(join(dir, PROJECT_FILE), 64 * 1024)
    const parsed = JSON.parse(raw.toString('utf8')) as { version?: unknown; cwd?: unknown }
    if (parsed.version === 1 && typeof parsed.cwd === 'string' && parsed.cwd.length > 0) return parsed.cwd
  } catch {
    // 缺少映射文件时退回目录名，不影响只读视图。
  }
  return undefined
}

/**
 * 扫描记忆根目录的全部 scope（用户层 + 每个 `--slug--` 项目目录），
 * 同时收集各 scope 的主题注册表。只读，不跟随符号链接。
 */
export async function scanArc(rootDir: string): Promise<ArcScan> {
  const state: ScanState = { records: [], skipped: 0, truncated: false }
  const registries: TopicEntry[][] = []
  const sources: ArcSourceSummary[] = []

  const userDir = join(rootDir, USER_SCOPE_DIR)
  registries.push(await readTopicRegistry(userDir))
  const userCount = await scanScopeDir(userDir, 'user', arcOriginLabel(USER_SCOPE_DIR), undefined, state)
  if (userCount > 0) sources.push({ scope: 'user', slug: USER_SCOPE_DIR, label: arcOriginLabel(USER_SCOPE_DIR), count: userCount })

  let names: string[] = []
  try {
    names = (await fs.readdir(rootDir, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && entry.name.startsWith('--') && entry.name.endsWith('--'))
      .map(entry => entry.name)
      .sort()
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }
  for (const slug of names) {
    if (slug === USER_SCOPE_DIR) continue
    const dir = join(rootDir, slug)
    const cwd = await readProjectCwd(dir)
    const origin = arcOriginLabel(slug, cwd)
    registries.push(await readTopicRegistry(dir))
    const count = await scanScopeDir(dir, 'project', origin, cwd, state)
    if (count > 0) sources.push({ scope: 'project', slug, label: origin, ...(cwd !== undefined ? { path: cwd } : {}), count })
  }

  return { records: state.records, topics: mergeTopics(registries), sources, skipped: state.skipped, truncated: state.truncated }
}
