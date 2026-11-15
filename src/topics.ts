/**
 * v1.0.0-rc.2 主题大类（topic）注册表。
 *
 * 每个 scope 目录一份 `topics.json`：主题 id + 展示名 + 一句话说明。
 * 记录的 `topic` 字段只存 id；id 由模型在写入/总结时从注册表中选择或提议，
 * 因此“同主题”是语义判断，而不是词法标签。
 */

import { mkdir, readFile, rename, writeFile, chmod, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { FORMAT_FILE } from './storage-safety.ts'

export const TOPIC_REGISTRY_FILENAME = 'topics.json'
export const TOPIC_REGISTRY_VERSION = 1
export const MAX_TOPICS = 64

/** 主题 id：字母/数字/汉字开头，允许 `-`、`_`，最长 32——中文主题直接可用（如 `考研`）。 */
export const TOPIC_ID_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,31}$/u

export interface TopicEntry {
  id: string
  /** 人类可读名称（面板显示、模型选择时提供）。 */
  title: string
  /** 一句话范围，帮助模型区分相近主题；可缺省。 */
  note?: string
  createdMs: number
}

interface TopicRegistryFile {
  version: number
  topics: TopicEntry[]
}

export function normalizeTopicId(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  const compact = trimmed.replace(/\s+/g, '-').replace(/-+/g, '-')
  if (!TOPIC_ID_RE.test(compact)) return undefined
  return compact
}

/** 从展示名生成 id：ASCII 转 kebab，中文保留原字（去掉空白与标点）。 */
export function topicIdFromTitle(title: string): string | undefined {
  const trimmed = title.trim()
  if (trimmed.length === 0) return undefined
  const ascii = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return normalizeTopicId(ascii.slice(0, 32))
}

export function findTopicByTitle(topics: readonly TopicEntry[], title: string): TopicEntry | undefined {
  const wanted = title.trim().toLowerCase()
  if (wanted.length === 0) return undefined
  return topics.find(topic => topic.title.trim().toLowerCase() === wanted)
}

/**
 * 注册一个主题：同名复用；id 冲突且标题不同时加序号。
 * 返回新数组与最终条目，便于调用方回写注册表并给记录赋 id。
 */
export function upsertTopic(
  topics: readonly TopicEntry[],
  input: { title: string; note?: string },
  now = Date.now(),
): { topics: TopicEntry[]; entry: TopicEntry; created: boolean } {
  const existing = findTopicByTitle(topics, input.title)
  if (existing !== undefined) return { topics: [...topics], entry: existing, created: false }
  const base = topicIdFromTitle(input.title)
  if (base === undefined) throw new Error('Invalid topic title')
  let id = base
  let suffix = 2
  while (topics.some(topic => topic.id === id)) {
    id = `${base.slice(0, 28)}-${suffix}`
    suffix += 1
  }
  if (topics.length >= MAX_TOPICS) throw new Error('Too many topics')
  const entry: TopicEntry = {
    id,
    title: input.title.trim(),
    ...(input.note !== undefined && input.note.trim().length > 0 ? { note: input.note.trim().slice(0, 200) } : {}),
    createdMs: now,
  }
  return { topics: [...topics, entry], entry, created: true }
}

/** 读注册表；缺失/损坏/重复 id 都按“空表或去重后的有效条目”处理，不砖存储。 */
export async function readTopicRegistry(dir: string): Promise<TopicEntry[]> {
  let raw: string
  try {
    raw = await readFile(join(dir, TOPIC_REGISTRY_FILENAME), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  try {
    const parsed = JSON.parse(raw) as Partial<TopicRegistryFile>
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.topics)) return []
    const seen = new Set<string>()
    const topics: TopicEntry[] = []
    for (const item of parsed.topics as unknown[]) {
      if (item === null || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const id = typeof record.id === 'string' ? normalizeTopicId(record.id) : undefined
      const title = typeof record.title === 'string' ? record.title.trim() : ''
      if (id === undefined || title.length === 0 || seen.has(id)) continue
      seen.add(id)
      topics.push({
        id,
        title: title.slice(0, 80),
        ...(typeof record.note === 'string' && record.note.trim().length > 0 ? { note: record.note.trim().slice(0, 200) } : {}),
        createdMs: typeof record.createdMs === 'number' && Number.isSafeInteger(record.createdMs) ? record.createdMs : Date.now(),
      })
    }
    return topics.slice(0, MAX_TOPICS)
  } catch {
    return []
  }
}

export async function writeTopicRegistry(dir: string, topics: readonly TopicEntry[]): Promise<void> {
  await mkdir(dir, { recursive: true })
  const payload: TopicRegistryFile = { version: TOPIC_REGISTRY_VERSION, topics: [...topics] }
  const target = join(dir, TOPIC_REGISTRY_FILENAME)
  const temp = `${target}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  await chmod(temp, 0o600).catch(() => undefined)
  await rename(temp, target)
}

/** v1.0.0-rc.2：自动总结写入时无法命中主题的兜底主题；不参与自动合并（待人工归类）。 */
export const UNCLASSIFIED_TOPIC = '未归类'

/**
 * 用主题的展示名/说明与文本做词面匹配，选出最可能的主题。
 * 这是自动总结写入路径的兜底：没有模型判断时，宁可落到“未归类”，也不静默留空。
 */
export function bestMatchingTopic(topics: readonly TopicEntry[], text: string): TopicEntry | undefined {
  if (topics.length === 0) return undefined
  const haystack = text.toLowerCase()
  let best: { topic: TopicEntry; score: number } | undefined
  for (const topic of topics) {
    if (topic.id === UNCLASSIFIED_TOPIC) continue
    const words = `${topic.title} ${topic.note ?? ''}`
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .map(word => word.trim())
      .filter(word => word.length >= 2)
    let score = 0
    for (const word of new Set(words)) if (haystack.includes(word)) score += word.length
    if (score === 0) continue
    if (best === undefined || score > best.score) best = { topic, score }
  }
  return best?.topic
}

/**
 * 保证一段新文本有主题：命中注册表则复用，否则创建/复用“未归类”。
 * 返回主题 id，并回写注册表（仅在需要新增时）。
 */
export async function ensureTopicForText(dir: string, text: string): Promise<string> {
  const topics = await readTopicRegistry(dir)
  const matched = bestMatchingTopic(topics, text)
  if (matched !== undefined) return matched.id
  const fallback = topics.find(topic => topic.id === UNCLASSIFIED_TOPIC)
  if (fallback !== undefined) return fallback.id
  // 存储目录尚未初始化（没有 .wh-format.json）时不能先写 topics.json：
  // store 的迁移校验会把“非空但无标记”的目录当成未迁移数据。此时只返回兜底 id，
  // 等 store 建好标记后，下一次写入会把兜底主题补进注册表。
  let initialized = false
  try {
    await access(join(dirname(dir), FORMAT_FILE))
    initialized = true
  } catch {
    initialized = false
  }
  if (!initialized) return UNCLASSIFIED_TOPIC
  const next = upsertTopic(topics, { title: UNCLASSIFIED_TOPIC, note: '自动归类未命中，请在面板中改到合适主题' })
  await writeTopicRegistry(dir, next.topics)
  return next.entry.id
}
