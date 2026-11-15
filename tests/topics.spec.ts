import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  bestMatchingTopic,
  ensureTopicForText,
  findTopicByTitle,
  normalizeTopicId,
  readTopicRegistry,
  topicIdFromTitle,
  UNCLASSIFIED_TOPIC,
  upsertTopic,
  writeTopicRegistry,
  type TopicEntry,
} from '../src/topics.ts'
import { MemoryStore } from '../src/store.ts'
import { applyConsolidationCandidates } from '../src/consolidate.ts'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'wh-topics-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('topic registry (v1.0.0-rc.2)', () => {
  it('accepts ascii and Chinese ids, rejects empty/invalid ones', () => {
    expect(normalizeTopicId('kaoyan')).toBe('kaoyan')
    expect(normalizeTopicId(' memory plugin ')).toBe('memory-plugin')
    expect(normalizeTopicId('考研')).toBe('考研')
    expect(normalizeTopicId('')).toBeUndefined()
    expect(normalizeTopicId('-bad')).toBeUndefined()
    expect(normalizeTopicId('a'.repeat(40))).toBeUndefined()
  })

  it('derives ids from titles and reuses an existing topic by title', () => {
    expect(topicIdFromTitle('Memory Plugin')).toBe('memory-plugin')
    expect(topicIdFromTitle('考研安排')).toBe('考研安排')
    const first = upsertTopic([], { title: '考研', note: '升学目标与复习安排' })
    expect(first.created).toBe(true)
    expect(first.entry).toMatchObject({ id: '考研', title: '考研' })
    const again = upsertTopic(first.topics, { title: '考研' })
    expect(again.created).toBe(false)
    expect(findTopicByTitle(again.topics, '考研')?.id).toBe('考研')
  })

  it('round-trips the registry and ignores malformed entries', async () => {
    const dir = join(root, '_user')
    const entry: TopicEntry = { id: 'kaoyan', title: '考研', createdMs: 1 }
    await writeTopicRegistry(dir, [entry, { ...entry }, { id: '../bad', title: 'x', createdMs: 2 } as TopicEntry])
    const loaded = await readTopicRegistry(dir)
    expect(loaded.map(topic => topic.id)).toEqual(['kaoyan'])

    await fs.writeFile(join(dir, 'topics.json'), '{not json', 'utf8')
    expect(await readTopicRegistry(dir)).toEqual([])
  })
})

describe('memory record topic (v1.0.0-rc.2)', () => {
  it('serializes, parses and preserves topic across a metadata update', async () => {
    const store = new MemoryStore(root)
    const written = await store.write(
      { name: 'kaoyan-goal', title: '考研目标', description: '目标院校', type: 'user', body: '华中科技大学', topic: 'kaoyan' },
      'user',
    )
    expect(written?.topic).toBe('kaoyan')
    expect((await store.read('kaoyan-goal', 'user'))?.topic).toBe('kaoyan')

    // 不带 topic 的更新必须继承，而不是清掉
    const updated = await store.write(
      { name: 'kaoyan-goal', title: '考研目标', description: '目标院校', type: 'user', body: '华中科技大学（自动化）' },
      'user',
    )
    expect(updated?.topic).toBe('kaoyan')

    // 显式空串 → 清除（迁移/修数据用）
    const cleared = await store.write(
      { name: 'kaoyan-goal', title: '考研目标', description: '目标院校', type: 'user', body: '华中科技大学（自动化）', topic: '' },
      'user',
    )
    expect(cleared?.topic).toBeUndefined()
  })

  it('rejects an invalid topic id on write', async () => {
    const store = new MemoryStore(root)
    await expect(
      store.write({ name: 'bad-topic', description: 'x', type: 'user', body: 'x', topic: '../escape' }, 'user'),
    ).rejects.toThrow(/Invalid memory topic/)
  })
})

describe('automatic topic assignment for summarized records (v1.0.0-rc.2)', () => {
  it('picks the topic whose title/note words appear in the candidate text', () => {
    const topics: TopicEntry[] = [
      { id: '考研', title: '考研', note: '升学目标与复习安排', createdMs: 1 },
      { id: '记忆插件', title: '记忆插件', note: '项目实现与验收', createdMs: 2 },
    ]
    expect(bestMatchingTopic(topics, 'USER: 我准备考研，华中科技大学')?.id).toBe('考研')
    expect(bestMatchingTopic(topics, 'USER: 记忆插件的自动合并要可撤销')?.id).toBe('记忆插件')
    expect(bestMatchingTopic(topics, 'USER: 今天晚饭吃什么')).toBeUndefined()
  })

  it('falls back to the unclassified topic when nothing matches and the store exists', async () => {
    const store = new MemoryStore(root)
    // 先让 store 建立 .wh-format.json，再谈注册表兜底
    await store.write({ name: 'seed', description: 'seed', type: 'user', body: 'seed' }, 'user')
    const dir = store.dir('user')
    await writeTopicRegistry(dir, [{ id: '考研', title: '考研', createdMs: 1 }])
    expect(await ensureTopicForText(dir, 'USER: 今天晚饭吃什么')).toBe(UNCLASSIFIED_TOPIC)
    expect((await readTopicRegistry(dir)).map(topic => topic.id)).toContain(UNCLASSIFIED_TOPIC)
    expect(await ensureTopicForText(dir, 'USER: 考研初试安排')).toBe('考研')
  })

  it('does not create topics.json before the store has initialized its marker', async () => {
    const dir = join(root, '_user')
    expect(await ensureTopicForText(dir, 'USER: 无主题')).toBe(UNCLASSIFIED_TOPIC)
    await expect(fs.access(join(dir, 'topics.json'))).rejects.toThrow()
  })

  it('classifies newly summarized records by matching the scope topic registry', async () => {
    const store = new MemoryStore(root)
    const cwd = 'C:/synthetic/topic-assignment'
    await store.write({ name: 'seed', description: 'seed', type: 'project', body: 'seed' }, 'project', cwd)
    await writeTopicRegistry(store.dir('project', cwd), [
      { id: '考研', title: '考研', note: '升学目标与复习安排', createdMs: 1 },
    ])
    await applyConsolidationCandidates({
      store,
      cwd,
      candidates: [{ name: 'kaoyan-progress', title: '考研进度', description: '高数复习到不定积分', type: 'reference', body: '考研数学：高数复习到不定积分', importance: 8 }],
      options: { enableUserScope: true, minImportance: 1, autoSummarizeMaxMemories: 5, autoSummarizeDedupe: true },
      sessionId: 'synthetic-session',
      transcript: 'USER: 我考研数学复习到不定积分了',
    })
    expect((await store.read('kaoyan-progress', 'project', cwd))?.topic).toBe('考研')
  })
})
