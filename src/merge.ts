import type { MemoryRecord, MemoryType } from './types.ts'
import { tokenize } from './duplicates.ts'

export interface MergeSuggestionMember {
  name: string
  description: string
  type: string
  status: string
  revision: string
  updatedMs: number
}

export interface MergeCluster {
  sharedTokens: string[]
  suggestedName: string
  suggestedType: MemoryType
  score: number
  members: MergeSuggestionMember[]
}

export interface MergeOptions {
  minShared?: number
  maxClusters?: number
  maxRecords?: number
  maxTokensPerRecord?: number
}

/** Tokens too common to indicate a topic: pronouns, fillers and plugin vocabulary. */
const STOP = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'only', 'also', 'have', 'has', 'not', 'but', 'are', 'was', 'were', 'will', 'can', 'may', 'should', 'would', 'could', 'about', 'when', 'where', 'which', 'what', 'how', 'their', 'they', 'them', 'then', 'than', 'there', 'these', 'those', 'its', 'use', 'used', 'using', 'project', 'memory', 'note', 'notes', 'record', 'records',
  '用户', '项目', '记忆', '记录', '内容', '使用', '需要', '进行', '可以', '这个', '那个', '一个', '以及', '或者', '如果', '因为', '所以', '但是', '并且', '已经', '没有', '通过', '相关',
])

function significantTokens(record: MemoryRecord, cap: number): Set<string> {
  const set = new Set<string>()
  for (const token of tokenize([record.title ?? '', record.description ?? '', record.body ?? ''].join(' '))) {
    const t = token.trim()
    if (t.length < 2 || STOP.has(t) || /^\d+$/.test(t)) continue
    set.add(t)
    if (set.size >= cap) break
  }
  return set
}

function slug(value: string): string {
  const ascii = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (ascii.length >= 3) return ascii.slice(0, 48)
  return `merged-${Date.now().toString(36)}`
}

function typeOf(members: MemoryRecord[]): MemoryType {
  const counts = new Map<string, number>()
  for (const member of members) counts.set(member.type, (counts.get(member.type) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0] as MemoryType
}

/**
 * Read-only topic clustering. Unlike near-duplicate detection it does not compare whole bodies:
 * it groups records that share several distinctive tokens (keywords/entities), then proposes a
 * merged candidate name and type. Nothing is written here.
 */
export function suggestMergeClusters(records: MemoryRecord[], options: MergeOptions = {}): MergeCluster[] {
  const minShared = Math.max(1, Math.min(6, options.minShared ?? 2))
  const maxClusters = Math.max(1, Math.min(100, options.maxClusters ?? 20))
  const maxRecords = Math.max(2, Math.min(2000, options.maxRecords ?? 500))
  const maxTokens = Math.max(3, Math.min(40, options.maxTokensPerRecord ?? 16))
  const usable = records.filter(r => r.status !== 'superseded' && !r.disabled).slice(0, maxRecords)
  if (usable.length < 2) return []

  const tokens = new Map(usable.map(r => [r.name, significantTokens(r, maxTokens)]))
  const index = new Map<string, string[]>()
  for (const [name, set] of tokens) for (const token of set) { const list = index.get(token) ?? []; list.push(name); index.set(token, list) }
  const total = usable.length
  // A token shared by most records says little about a topic.
  const maxShare = total <= 2 ? 2 : total <= 4 ? total - 1 : Math.max(2, Math.floor(total * 0.6))
  const informative = new Set([...index.entries()].filter(([, list]) => list.length >= 2 && list.length <= maxShare).map(([token]) => token))

  const parent = new Map<string, string>(usable.map(r => [r.name, r.name]))
  const find = (x: string): string => { let root = x; while (parent.get(root) !== root) root = parent.get(root)!; parent.set(x, root); return root }
  const union = (a: string, b: string): void => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }
  const byName = new Map(usable.map(r => [r.name, r]))
  const pairShared = new Map<string, number>()
  for (const [token, list] of index) {
    if (!informative.has(token) || list.length > 60) continue
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const key = [list[i], list[j]].sort().join('\\u0000')
      pairShared.set(key, (pairShared.get(key) ?? 0) + 1)
    }
  }
  for (const [key, count] of pairShared) if (count >= minShared) { const [left, right] = key.split('\\u0000'); union(left, right) }

  const groups = new Map<string, string[]>()
  for (const record of usable) {
    const root = find(record.name)
    const list = groups.get(root) ?? []
    list.push(record.name)
    groups.set(root, list)
  }
  const clusters: MergeCluster[] = []
  for (const names of groups.values()) {
    if (names.length < 2) continue
    const shared = [...informative].filter(token => names.every(name => tokens.get(name)!.has(token))).sort((a, b) => b.length - a.length || a.localeCompare(b)).slice(0, 8)
    if (shared.length < minShared) continue
    const members = names.map(name => byName.get(name)!)
    const suggestedType = typeOf(members)
    const anchor = members.slice().sort((a, b) => (b.updatedMs ?? 0) - (a.updatedMs ?? 0))[0]
    clusters.push({
      sharedTokens: shared,
      suggestedName: `${slug(shared[0])}-merged`,
      suggestedType,
      score: shared.length / Math.sqrt(members.length),
      members: members.map(member => ({ name: member.name, description: member.description, type: member.type, status: member.status ?? 'legacy', revision: member.revision ?? '', updatedMs: member.updatedMs ?? 0 })),
    })
  }
  return clusters.sort((a, b) => b.score - a.score || b.members.length - a.members.length).slice(0, maxClusters)
}

export interface MergeMemberInput {
  name: string
  title?: string
  description: string
  body: string
}

/** Deterministic merged body: one section per source, sources kept in the given order. */
export function buildMergedBody(members: MergeMemberInput[]): string {
  return members.map(member => `## 来自 ${member.name}\n\n${member.body.trim()}`).join('\n\n')
}

export function mergedDescription(members: MergeMemberInput[]): string {
  const names = members.map(member => member.name).join('、')
  const first = members[0]?.description ?? ''
  return `合并自 ${members.length} 条相关记忆（${names}）。${first}`.slice(0, 500)
}
