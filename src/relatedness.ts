/**
 * v0.7.0 相关性（只读）。
 *
 * 只回答“这两条记忆有多相关、为什么”，不合并、不 supersede、不写盘。
 * 之后 P4 自动合并（仅产候选）与 P2 图谱/三维都复用这里的分数与关系理由。
 */

export type RelatednessScope = 'user' | 'project'

export interface RelatednessRecord {
  name: string
  title?: string
  description: string
  type: string
  scope: RelatednessScope
  body?: string
  updatedMs?: number
  /** 路由层标记：与目标记录属于同一个项目目录。 */
  sameProject?: boolean
}

export interface RelatednessHit {
  name: string
  scope: RelatednessScope
  score: number
  strength: 'weak' | 'strong'
  reasons: string[]
}

export const RELATEDNESS_WEAK = 30
export const RELATEDNESS_STRONG = 60
export const RELATEDNESS_TIME_WINDOW_MS = 7 * 24 * 60 * 60_000
export const DEFAULT_RELATEDNESS_LIMIT = 5

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'are', 'was', 'were',
  'have', 'has', 'had', 'not', 'but', 'you', 'your', 'our', 'its', 'can', 'will',
  '一个', '我们', '可以', '这个', '那个', '以及', '如果', '因为', '所以', '已经', '需要',
])

const CJK = /[\u3400-\u9fff]/

/**
 * v1.0.0-rc.12：词面增强——同义表达归一到同一个隐藏词元 `~<id>`。
 * 只收高置信、跨语言也成立的等价词，避免把“项目/用户”这类泛词变成万能相关。
 */
const SYNONYM_GROUPS: ReadonlyArray<readonly [string, ...string[]]> = [
  ['kaoyan', '考研', '研究生考试', '研究生入学考试'],
  ['review', '复习', '备考'],
  ['reminder', '提醒', '闹钟'],
  ['merge', '合并', '整合'],
  ['release', '发布', '上线', '发行'],
  ['config', '配置', '设置'],
  ['docs', '文档', '说明'],
  ['test', '测试', '用例'],
  ['roadmap', '路线图'],
  ['goal', '目标'],
  ['plan', '计划', '规划'],
  ['policy', '策略', '方针'],
  ['quality', '质量'],
  ['bug', '错误', '缺陷'],
]

/** ASCII 词 + 中文二元组；短词与中英文停用词丢弃，避免“的/是/and”制造假相关。 */
export function tokenize(text: string | undefined): Set<string> {
  if (!text) return new Set<string>()
  const cached = TOKEN_CACHE.get(text)
  if (cached) return cached
  const tokens = new Set<string>()
  const lower = text.toLowerCase()
  for (const match of lower.matchAll(/[a-z0-9][a-z0-9_-]{1,}/g)) {
    const word = match[0]
    if (word.length < 3) continue
    if (STOPWORDS.has(word)) continue
    tokens.add(word)
    // 名称/标题里的连字符与下划线按分隔符再切一次，让 dsh-auto-memory 与 memory-wh 共享 memory。
    if (/[-_]/.test(word)) {
      for (const part of word.split(/[-_]+/)) {
        if (part.length >= 3 && !STOPWORDS.has(part)) tokens.add(part)
      }
    }
  }
  for (const [id, ...words] of SYNONYM_GROUPS) {
    if (words.some(word => lower.includes(word))) tokens.add('~' + id)
  }
  const runs = lower.match(/[\u3400-\u9fff]+/g) ?? []
  for (const run of runs) {
    if (run.length === 1) {
      tokens.add(run)
      continue
    }
    for (let index = 0; index + 1 < run.length; index += 1) {
      const bigram = run.slice(index, index + 2)
      if (STOPWORDS.has(bigram)) continue
      tokens.add(bigram)
    }
  }
  if (TOKEN_CACHE.size > 4096) TOKEN_CACHE.clear()
  TOKEN_CACHE.set(text, tokens)
  return tokens
}

/** 词元缓存：构图会对同一段文本反复求交，缓存后 500 条记录的构图从秒级降到毫秒级。 */
const TOKEN_CACHE = new Map<string, Set<string>>()

/** 重叠系数：交集大小 / 较短集合大小，短记录与长记录也能公平比较。 */
export function overlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  if (shared === 0) return 0
  return shared / Math.min(left.size, right.size)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 正文/描述里直接写了对方的 name（或 [[name]] 形式）。 */
export function mentions(text: string | undefined, name: string): boolean {
  if (!text || name.length < 4) return false
  return mentionPattern(name)?.test(text) ?? false
}

function mentionPattern(name: string): RegExp | undefined {
  return name.length < 4 ? undefined : new RegExp('(^|[^a-z0-9_-])' + escapeRegExp(name) + '($|[^a-z0-9_-])', 'i')
}

/** 是否具有中文/英文的有效文本（用于空正文测试与面板空态）。 */
export function hasWords(text: string | undefined): boolean {
  return tokenize(text).size > 0
}

function prepareRelated(record: RelatednessRecord) {
  return {
    record,
    text: [record.name, record.title, record.description, record.body].join('\n'),
    mention: mentionPattern(record.name),
    titleTokens: tokenize([record.title, record.name].join(' ')),
    descriptionTokens: tokenize(record.description),
    bodyTokens: tokenize(record.body),
  }
}

type PreparedRelated = ReturnType<typeof prepareRelated>

function relatedScore(left: PreparedRelated, right: PreparedRelated, reasons?: string[]): number {
  const target = left.record, candidate = right.record
  let score = 0
  if (right.mention?.test(left.text) || left.mention?.test(right.text)) {
    score += 40
    reasons?.push('记录之间显式引用 +40')
  }

  const titleOverlap = overlap(left.titleTokens, right.titleTokens)
  if (titleOverlap > 0) {
    const points = Math.round(25 * titleOverlap)
    score += points
    reasons?.push('标题/名称共享关键词 +' + points)
  }

  const descOverlap = overlap(left.descriptionTokens, right.descriptionTokens)
  if (descOverlap > 0) {
    const points = Math.round(15 * descOverlap)
    score += points
    reasons?.push('描述内容相近 +' + points)
  }

  const bodyOverlap = overlap(left.bodyTokens, right.bodyTokens)
  if (bodyOverlap > 0) {
    const points = Math.round(15 * bodyOverlap)
    score += points
    reasons?.push('正文内容相近 +' + points)
  }

  if (target.sameProject && candidate.sameProject) {
    score += 10
    reasons?.push('同一项目 +10')
  }
  if (target.type === candidate.type) {
    score += 5
    reasons?.push('类型相同 +5')
  }
  if (target.scope === candidate.scope) {
    score += 5
    reasons?.push('作用域相同 +5')
  }
  if (
    target.updatedMs !== undefined && candidate.updatedMs !== undefined
    && Math.abs(target.updatedMs - candidate.updatedMs) <= RELATEDNESS_TIME_WINDOW_MS
  ) {
    score += 5
    reasons?.push('更新时间接近 +5')
  }

  return Math.min(100, score)
}

export function scoreRelated(target: RelatednessRecord, candidate: RelatednessRecord): { score: number; reasons: string[] } {
  const reasons: string[] = []
  return { score: relatedScore(prepareRelated(target), prepareRelated(candidate), reasons), reasons }
}

const compareRelated = (left: { name: string; score: number }, right: { name: string; score: number }) =>
  right.score - left.score || left.name.localeCompare(right.name, 'en')

/**
 * 排序并截断。低于 RELATEDNESS_WEAK 的不返回——面板宁可不展示，也不给人“什么都相关”的错觉。
 */
export function rankRelated(
  target: RelatednessRecord,
  candidates: RelatednessRecord[],
  limit = DEFAULT_RELATEDNESS_LIMIT,
): RelatednessHit[] {
  const hits: RelatednessHit[] = []
  for (const candidate of candidates) {
    if (candidate.name === target.name && candidate.scope === target.scope) continue
    if (!hasWords(candidate.title) && !hasWords(candidate.description) && !hasWords(candidate.body)) continue
    const { score, reasons } = scoreRelated(target, candidate)
    if (score < RELATEDNESS_WEAK) continue
    hits.push({
      name: candidate.name,
      scope: candidate.scope,
      score,
      strength: score >= RELATEDNESS_STRONG ? 'strong' : 'weak',
      reasons,
    })
  }
  hits.sort(compareRelated)
  return hits.slice(0, Math.max(0, limit))
}

/** 供测试/面板判断“这条记录有没有可展示的相关项”。 */
export function isRelatednessCandidate(record: RelatednessRecord): boolean {
  return hasWords(record.title) || hasWords(record.description) || hasWords(record.body) || CJK.test(record.name)
}

export interface RelatednessGraphNode {
  name: string
  title: string
  type: string
  scope: string
  degree: number
}

export interface RelatednessGraphEdge {
  from: string
  to: string
  score: number
}

export interface RelatednessGraph {
  nodes: RelatednessGraphNode[]
  edges: RelatednessGraphEdge[]
  thresholds: { weak: number; strong: number }
}

/**
 * 面板“关系图”的只读数据：节点是记录，边是相关性评分。
 * 每条记录只保留最强的若干个邻居，避免 500 条时变成毛球；同一对记录只保留一条边（取高分）。
 */
export function buildGraph(
  records: RelatednessRecord[],
  options: { neighbors?: number; threshold?: number } = {},
): RelatednessGraph {
  const threshold = Math.max(0, options.threshold ?? RELATEDNESS_WEAK)
  const neighbors = Math.max(1, options.neighbors ?? 6)
  const nodes = records.map(record => ({
    name: record.name,
    title: (record.title ?? '').trim() || record.name,
    type: record.type,
    scope: record.scope,
    degree: 0,
  }))
  const byKey = new Map<string, RelatednessGraphEdge>()
  // Prepare text, token sets and literal mention patterns once per record.
  // Keep the original candidate filter, stable tie order, and top-N selection.
  const prepared = records.map(prepareRelated)
  const candidates = prepared.filter(({ record, descriptionTokens, bodyTokens }) =>
    hasWords(record.title) || descriptionTokens.size > 0 || bodyTokens.size > 0)
  for (const left of prepared) {
    const target = left.record
    const hits: Pick<RelatednessHit, 'name' | 'scope' | 'score'>[] = []
    for (const right of candidates) {
      const { name, scope } = right.record
      if (name === target.name && scope === target.scope) continue
      const score = relatedScore(left, right)
      if (score >= RELATEDNESS_WEAK) hits.push({ name, scope, score })
    }
    hits.sort(compareRelated)
    for (const hit of hits.slice(0, neighbors)) {
      if (hit.score < threshold) continue
      const a = target.scope + ':' + target.name
      const b = hit.scope + ':' + hit.name
      const key = a < b ? a + '|' + b : b + '|' + a
      const existing = byKey.get(key)
      if (!existing || hit.score > existing.score) {
        byKey.set(key, { from: target.scope + ':' + target.name, to: hit.scope + ':' + hit.name, score: hit.score })
      }
    }
  }
  const degree = new Map<string, number>()
  for (const edge of byKey.values()) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
  }
  const keyToName = new Map(records.map(record => [record.scope + ':' + record.name, record.name]))
  for (const node of nodes) {
    node.degree = degree.get(node.scope + ':' + node.name) ?? 0
  }
  const edges = [...byKey.values()]
    .map(edge => ({ from: keyToName.get(edge.from) ?? edge.from, to: keyToName.get(edge.to) ?? edge.to, score: edge.score }))
    .sort((left, right) => right.score - left.score)
  return { nodes, edges, thresholds: { weak: RELATEDNESS_WEAK, strong: RELATEDNESS_STRONG } }
}
