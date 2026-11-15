import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AutoMerger, scanTopicMerges } from '../src/auto-merge.ts'
import { MemoryStore } from '../src/store.ts'
import type { MemoryRecord } from '../src/types.ts'

let root: string
let store: MemoryStore

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'wh-auto-merge-'))
  store = new MemoryStore(root)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function record(overrides: Partial<MemoryRecord> & Pick<MemoryRecord, 'name' | 'title' | 'description' | 'body'>): MemoryRecord {
  // rc.11：撤销审核后新记录默认是 candidate；扫描必须同样处理。
  return { type: 'user', scope: 'user', status: 'candidate', ...overrides }
}

async function seed(name: string, title: string, description: string, body: string, topic: string): Promise<void> {
  const written = await store.write({ name, title, description, type: 'user', body, topic }, 'user')
  await store.review(name, 'user', undefined, written!.revision!, 'verified')
}

describe('topic-aware merge scan (v1.0.0-rc.11)', () => {
  it('auto-merges same-topic high pairs and asks for cross-topic high pairs', () => {
    const records: MemoryRecord[] = [
      record({ name: 'kaoyan-goal', title: '考研目标', description: '目标院校', body: '华中科技大学（参考 kaoyan-plan）', topic: 'kaoyan' }),
      record({ name: 'kaoyan-plan', title: '考研目标', description: '目标院校', body: '华中科技大学（参考 kaoyan-goal）', topic: 'kaoyan' }),
      record({ name: 'project-alpha', title: '项目定位', description: '项目方向', body: '机器人导航（参考 project-beta）', topic: 'project' }),
      record({ name: 'project-beta', title: '项目定位', description: '项目方向', body: '机器人导航（参考 project-alpha）', topic: 'ideas' }),
      record({ name: 'quiet-note', title: '独立记录', description: '无关内容', body: '天气记录', topic: 'life' }),
    ]
    const scan = scanTopicMerges(records, 'user')
    expect(scan.auto).toHaveLength(1)
    expect(scan.auto[0].topic).toBe('kaoyan')
    expect(scan.auto[0].members.map(member => member.name).sort()).toEqual(['kaoyan-goal', 'kaoyan-plan'])
    expect(scan.auto[0].score).toBeGreaterThanOrEqual(80)

    expect(scan.ask).toHaveLength(1)
    expect(scan.ask[0].members.map(member => member.name).sort()).toEqual(['project-alpha', 'project-beta'])
    // 跨主题即使 ≥80 也只进询问队列，绝不自动合并
    expect(scan.ask[0].score).toBeGreaterThanOrEqual(80)
  })

  it('auto-merges same-topic pairs in the 60–79 band without asking', () => {
    const records: MemoryRecord[] = [
      record({ name: 'merge-a', title: '合并测试', description: '同主题合并', body: 'alpha beta', topic: 'kaoyan', updatedMs: 1_000 }),
      record({ name: 'merge-b', title: '合并测试', description: '同主题合并', body: 'alpha beta gamma', topic: 'kaoyan', updatedMs: 1_000 }),
    ]
    const scan = scanTopicMerges(records, 'user')
    expect(scan.auto).toHaveLength(1)
    expect(scan.auto[0].score).toBeGreaterThanOrEqual(60)
    expect(scan.auto[0].score).toBeLessThan(80)
    expect(scan.ask).toHaveLength(0)
  })

  it('asks when only one of topic or relatedness reaches 60', () => {
    const weakSameTopic: MemoryRecord[] = [
      record({ name: 'weak-a', title: '天气', description: '晴天', body: 'sunny weather forecast', topic: 'life', updatedMs: 1_000 }),
      record({ name: 'weak-b', title: '做饭', description: '意面', body: 'pasta tomato recipe', topic: 'life', updatedMs: 1_000 }),
    ]
    const sameScan = scanTopicMerges(weakSameTopic, 'user')
    expect(sameScan.auto).toHaveLength(0)
    expect(sameScan.ask).toHaveLength(1)
    expect(sameScan.ask[0].score).toBeLessThan(60)

    const crossTopic: MemoryRecord[] = [
      record({ name: 'merge-a', title: '合并测试', description: '同主题合并', body: 'alpha beta', topic: 'kaoyan', updatedMs: 1_000 }),
      record({ name: 'merge-b', title: '合并测试', description: '同主题合并', body: 'alpha beta gamma', topic: 'ideas', updatedMs: 1_000 }),
    ]
    const crossScan = scanTopicMerges(crossTopic, 'user')
    expect(crossScan.auto).toHaveLength(0)
    expect(crossScan.ask).toHaveLength(1)
    expect(crossScan.ask[0].score).toBeGreaterThanOrEqual(60)
    expect(crossScan.ask[0].score).toBeLessThan(80)
  })

  it('ignores pairs where neither topic nor relatedness reaches 60', () => {
    const records: MemoryRecord[] = [
      record({ name: 'quiet-a', title: '天气', description: '晴天', body: 'sunny weather forecast', topic: 'life', updatedMs: 1_000 }),
      record({ name: 'quiet-b', title: '做饭', description: '意面', body: 'pasta tomato recipe', topic: 'cooking', updatedMs: 1_000 }),
    ]
    const scan = scanTopicMerges(records, 'user')
    expect(scan.auto).toHaveLength(0)
    expect(scan.ask).toHaveLength(0)
  })

  it('excludes superseded, pinned, tasks and records without a topic', () => {
    const base = { title: '考研目标', description: '目标院校', body: '华中科技大学（参考 kaoyan-b）' }
    const records: MemoryRecord[] = [
      record({ name: 'kaoyan-a', ...base, topic: 'kaoyan' }),
      record({ name: 'kaoyan-b', ...base, body: '华中科技大学（参考 kaoyan-a）', topic: 'kaoyan' }),
      record({ name: 'kaoyan-c', ...base, body: '华中科技大学（参考 kaoyan-a）', topic: 'kaoyan', status: 'superseded' }),
      record({ name: 'kaoyan-d', ...base, body: '华中科技大学（参考 kaoyan-a）', topic: 'kaoyan', pinned: true }),
      record({ name: 'kaoyan-e', ...base, body: '华中科技大学（参考 kaoyan-a）', topic: 'kaoyan', type: 'task' }),
      record({ name: 'kaoyan-f', ...base, body: '华中科技大学（参考 kaoyan-a）' }),
    ]
    const scan = scanTopicMerges(records, 'user')
    const names = scan.auto.flatMap(plan => plan.members.map(member => member.name)).sort()
    expect(names).toEqual(['kaoyan-a', 'kaoyan-b'])
  })
})

describe('auto merge apply and undo (v1.0.0-rc.2)', () => {
  it('writes a verified merged record, supersedes sources and restores them on undo', async () => {
    await seed('kaoyan-goal', '考研目标', '目标院校', '华中科技大学（参考 kaoyan-plan）', 'kaoyan')
    await seed('kaoyan-plan', '考研目标', '目标院校', '华中科技大学（参考 kaoyan-goal）', 'kaoyan')

    const merger = new AutoMerger(store, root)
    const scan = await merger.scan('user')
    expect(scan.auto).toHaveLength(1)

    const entry = await merger.apply(scan.auto[0], 'user')
    const merged = await store.read(entry.target, 'user')
    expect(merged).not.toBeNull()
    expect(merged!.status).toBe('verified')
    expect(merged!.topic).toBe('kaoyan')
    expect(merged!.body).toContain('## 来自 kaoyan-goal')
    expect((await store.read('kaoyan-goal', 'user'))!.status).toBe('superseded')
    expect((await store.read('kaoyan-goal', 'user'))!.supersededBy).toBe(entry.target)

    // 合并后同主题的高相关对已不再出现（来源均 superseded）
    expect((await merger.scan('user')).auto).toHaveLength(0)
    expect(await merger.list()).toHaveLength(1)

    const undone = await merger.undo(entry.id)
    expect(undone?.target).toBe(entry.target)
    expect((await store.read('kaoyan-goal', 'user'))!.status).toBe('verified')
    expect(await store.read(entry.target, 'user')).toBeNull()
    expect(await merger.list()).toHaveLength(0)
  })
})
