import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { buildMergedBody, mergedDescription, type MergeMemberInput } from './merge.ts'
import { scoreRelated, type RelatednessRecord } from './relatedness.ts'
import type { MemoryRecord, MemoryScope, MemoryType } from './types.ts'
import { UNCLASSIFIED_TOPIC } from './topics.ts'

/** 自动合并门槛（v1.0.0-rc.11）：同主题且相关 ≥ 该值直接合并、提供撤销。 */
export const AUTO_MERGE_SCORE = 60
/** 询问门槛（v1.0.0-rc.11）：同主题或相关性任一达到该值即进询问队列，但只有两者同时达标才自动合并。 */
export const MERGE_ASK_SCORE = 60
const MAX_AUTO_CLUSTERS = 12
const MAX_ASK_PAIRS = 30
const LEDGER_FILENAME = 'auto-merges.json'

export interface MergePlanMember {
  name: string
  title?: string
  description: string
  body: string
  type: MemoryType
}

export interface MergePlan {
  key: string
  topic: string
  score: number
  reasons: string[]
  members: MergePlanMember[]
}

export interface MergeScan {
  auto: MergePlan[]
  ask: MergePlan[]
}

export interface AutoMergeEntry {
  id: string
  at: string
  scope: MemoryScope
  topic: string
  target: string
  sources: string[]
  score: number
}

interface LedgerFile {
  version: 1
  entries: AutoMergeEntry[]
}

function eligible(record: MemoryRecord): boolean {
  // v1.0.0-rc.11：审核已撤销，candidate 与 verified 一样是正常记录；只排除有争议/已取代/停用。
  return record.status !== 'disputed' && record.status !== 'superseded' && record.disabled !== true
    && typeof record.topic === 'string' && record.topic.length > 0 && record.topic !== UNCLASSIFIED_TOPIC
    && record.type !== 'task'
    && record.pinned !== true
}

function memberOf(record: MemoryRecord): MergePlanMember {
  return { name: record.name, title: record.title, description: record.description, body: record.body, type: record.type }
}

function relatednessOf(record: MemoryRecord, scope: MemoryScope, cwd: string | undefined): RelatednessRecord {
  return {
    name: record.name,
    scope,
    type: record.type,
    title: record.title,
    description: record.description,
    body: record.body,
    updatedMs: record.updatedMs,
    sameProject: scope === 'project' && cwd !== undefined,
  }
}

function pairKey(left: string, right: string): string {
  return [left, right].sort().join('\u0000')
}

/**
 * 只读扫描：返回“可直接自动合并”的簇与“需要确认”的配对。
 * 规则（所有者 2026-11-09 再调整）：同主题且相关 ≥60 自动；只剩一项达标（同主题但相关 <60，或跨主题但相关 ≥60）询问；两项都不达标忽略。
 */
export function scanTopicMerges(records: MemoryRecord[], scope: MemoryScope, cwd?: string): MergeScan {
  const usable = records.filter(eligible).slice(0, 500)
  const byName = new Map(usable.map(record => [record.name, record]))
  const related = new Map(usable.map(record => [record.name, relatednessOf(record, scope, cwd)]))

  const autoPairs: Array<{ left: string; right: string; score: number; reasons: string[] }> = []
  const askPairs: Array<{ left: string; right: string; score: number; reasons: string[] }> = []
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const left = usable[i]
      const right = usable[j]
      const sameTopic = left.topic === right.topic
      const { score, reasons } = scoreRelated(related.get(left.name)!, related.get(right.name)!)
      const relatedEnough = score >= MERGE_ASK_SCORE
      if (sameTopic && relatedEnough) {
        autoPairs.push({ left: left.name, right: right.name, score, reasons })
        continue
      }
      if (sameTopic || relatedEnough) askPairs.push({ left: left.name, right: right.name, score, reasons })
    }
  }

  // 自动：连通分量成簇（≥60 的配对传递合并），每簇给最低分作为簇分数
  const parent = new Map<string, string>(usable.map(record => [record.name, record.name]))
  const find = (value: string): string => {
    let root = value
    while (parent.get(root) !== root) root = parent.get(root)!
    parent.set(value, root)
    return root
  }
  const scoreByPair = new Map<string, { score: number; reasons: string[] }>()
  for (const pair of autoPairs) {
    const left = find(pair.left)
    const right = find(pair.right)
    if (left !== right) parent.set(left, right)
    scoreByPair.set(pairKey(pair.left, pair.right), { score: pair.score, reasons: pair.reasons })
  }
  const groups = new Map<string, string[]>()
  for (const record of usable) {
    if (!autoPairs.some(pair => pair.left === record.name || pair.right === record.name)) continue
    const root = find(record.name)
    const list = groups.get(root) ?? []
    list.push(record.name)
    groups.set(root, list)
  }
  const auto: MergePlan[] = []
  for (const names of groups.values()) {
    if (names.length < 2) continue
    const members = names.map(name => byName.get(name)!).sort((a, b) => (b.updatedMs ?? 0) - (a.updatedMs ?? 0))
    const scores: number[] = []
    const reasons = new Set<string>()
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const hit = scoreByPair.get(pairKey(members[i].name, members[j].name))
        if (hit === undefined) continue
        scores.push(hit.score)
        for (const reason of hit.reasons) reasons.add(reason)
      }
    }
    auto.push({
      key: members.map(member => member.name).sort().join('+'),
      topic: members[0].topic!,
      score: scores.length > 0 ? Math.min(...scores) : AUTO_MERGE_SCORE,
      reasons: [...reasons].slice(0, 8),
      members: members.map(memberOf),
    })
  }
  auto.sort((left, right) => right.score - left.score || right.members.length - left.members.length)

  const seen = new Set<string>()
  const ask: MergePlan[] = []
  for (const pair of askPairs.sort((left, right) => right.score - left.score)) {
    const key = pairKey(pair.left, pair.right)
    if (seen.has(key)) continue
    seen.add(key)
    const left = byName.get(pair.left)!
    const right = byName.get(pair.right)!
    ask.push({
      key,
      topic: left.topic!,
      score: pair.score,
      reasons: pair.reasons.slice(0, 8),
      members: [memberOf(left), memberOf(right)],
    })
  }

  return { auto: auto.slice(0, MAX_AUTO_CLUSTERS), ask: ask.slice(0, MAX_ASK_PAIRS) }
}

function majorityType(members: MergePlanMember[]): MemoryType {
  const counts = new Map<MemoryType, number>()
  for (const member of members) counts.set(member.type, (counts.get(member.type) ?? 0) + 1)
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0][0]
}

function mergedName(topic: string): string {
  const ascii = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${ascii.length >= 2 ? ascii : 'topic'}-merged-${Date.now().toString(36)}`
}

function memberInput(member: MergePlanMember): MergeMemberInput {
  return { name: member.name, title: member.title, description: member.description, body: member.body }
}

/** 自动合并执行器：写合并记录、标记来源 superseded、维护可撤销账本。 */
export class AutoMerger {
  private readonly store: import('./store.ts').MemoryStore
  private readonly ledgerPath: string

  constructor(store: import('./store.ts').MemoryStore, memoryRoot: string) {
    this.store = store
    this.ledgerPath = join(memoryRoot, LEDGER_FILENAME)
  }

  async scan(scope: MemoryScope, cwd?: string): Promise<MergeScan> {
    return scanTopicMerges(await this.store.list(scope, cwd), scope, cwd)
  }

  async apply(plan: MergePlan, scope: MemoryScope, cwd?: string): Promise<AutoMergeEntry> {
    if (plan.members.length < 2) throw new Error('merge plan needs at least two members')
    const target = mergedName(plan.topic)
    const inputs = plan.members.map(memberInput)
    const title = `合并：${(plan.members[0].title ?? plan.members[0].name).slice(0, 40)}`
    await this.store.write(
      {
        name: target,
        title,
        description: mergedDescription(inputs).slice(0, 500),
        type: majorityType(plan.members),
        body: buildMergedBody(inputs),
        topic: plan.topic,
        status: 'verified',
      },
      scope,
      cwd,
    )
    for (const member of plan.members) {
      const record = await this.store.read(member.name, scope, cwd)
      if (record === null) continue
      await this.store.write(
        {
          name: record.name,
          title: record.title,
          description: record.description,
          type: record.type,
          body: record.body,
          topic: record.topic,
          status: 'superseded',
          supersededBy: target,
          ...(record.pinned === true ? { pinned: true } : {}),
        },
        scope,
        cwd,
      )
    }
    const entry: AutoMergeEntry = {
      id: `am-${Date.now().toString(36)}`,
      at: new Date().toISOString(),
      scope,
      topic: plan.topic,
      target,
      sources: plan.members.map(member => member.name),
      score: plan.score,
    }
    await this.appendLedger(entry)
    return entry
  }

  async list(): Promise<AutoMergeEntry[]> {
    return (await this.readLedger()).entries
  }

  async undo(id: string): Promise<AutoMergeEntry | null> {
    const ledger = await this.readLedger()
    const entry = ledger.entries.find(item => item.id === id)
    if (entry === undefined) return null
    for (const name of entry.sources) {
      const record = await this.store.read(name, entry.scope)
      if (record === null) continue
      await this.store.write(
        {
          name: record.name,
          title: record.title,
          description: record.description,
          type: record.type,
          body: record.body,
          topic: record.topic,
          status: 'verified',
        },
        entry.scope,
      )
    }
    await this.store.delete(entry.target, entry.scope)
    ledger.entries = ledger.entries.filter(item => item.id !== id)
    await this.writeLedger(ledger)
    return entry
  }

  private async readLedger(): Promise<LedgerFile> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.ledgerPath, 'utf8')) as Partial<LedgerFile>
      if (!Array.isArray(parsed.entries)) return { version: 1, entries: [] }
      return {
        version: 1,
        entries: parsed.entries.filter((entry): entry is AutoMergeEntry =>
          typeof entry?.id === 'string' && typeof entry.target === 'string' && Array.isArray(entry.sources)),
      }
    } catch {
      return { version: 1, entries: [] }
    }
  }

  private async writeLedger(ledger: LedgerFile): Promise<void> {
    await fs.mkdir(join(this.ledgerPath, '..'), { recursive: true })
    const tmp = `${this.ledgerPath}.tmp`
    await fs.writeFile(tmp, `${JSON.stringify(ledger, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await fs.rename(tmp, this.ledgerPath)
  }

  private async appendLedger(entry: AutoMergeEntry): Promise<void> {
    const ledger = await this.readLedger()
    ledger.entries.push(entry)
    if (ledger.entries.length > 100) ledger.entries = ledger.entries.slice(-100)
    await this.writeLedger(ledger)
  }
}
