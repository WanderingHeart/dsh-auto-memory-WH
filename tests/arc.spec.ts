import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { arcOriginLabel, buildArcView, mergeTopics, scanArc, MAX_ARC_RECORDS, type ArcSource } from '../src/arc.ts'
import { writeTopicRegistry, type TopicEntry } from '../src/topics.ts'

const NOW = 1_794_000_000_000
const DAY = 86_400_000

const registry: TopicEntry[] = [
  { id: '考研', title: '考研', note: '升学目标、复习进度与阶段计划', createdMs: 1 },
  { id: '身份', title: '身份', createdMs: 1 },
]

function source(over: Partial<ArcSource> = {}): ArcSource {
  return { name: 'alpha', description: 'synthetic', type: 'user', scope: 'user', origin: '个人', ...over }
}

describe('buildArcView (v1.0.0-rc.3 人物弧光)', () => {
  it('orders chapters by the registry, then extra topics, with 未归类 last', () => {
    const view = buildArcView([
      source({ name: 'loose', topic: undefined }),
      source({ name: 'extra-b', topic: 'zeta' }),
      source({ name: 'identity', topic: '身份' }),
      source({ name: 'exam', topic: '考研' }),
      source({ name: 'extra-a', topic: 'alpha' }),
    ], registry, { now: NOW })
    expect(view.chapters.map(chapter => chapter.topic)).toEqual(['考研', '身份', 'alpha', 'zeta', '未归类'])
    expect(view.total).toBe(5)
    expect(view.generatedMs).toBe(NOW)
    expect(view.chapters[0].title).toBe('考研')
    expect(view.chapters[0].note).toContain('升学目标')
    expect(view.chapters[2].note).toContain('不在注册表里')
    expect(view.chapters[4].note).toContain('尚未归类')
  })

  it('sorts each chapter by created time, keeps unknown times last, then by name', () => {
    const view = buildArcView([
      source({ name: 'late', topic: '考研', createdMs: NOW }),
      source({ name: 'unknown-b', topic: '考研' }),
      source({ name: 'early', topic: '考研', createdMs: NOW - 30 * DAY }),
      source({ name: 'unknown-a', topic: '考研' }),
      source({ name: 'middle', topic: '考研', createdMs: NOW - 10 * DAY, updatedMs: NOW }),
    ], registry, { now: NOW })
    expect(view.chapters[0].records.map(entry => entry.name)).toEqual(['early', 'middle', 'late', 'unknown-a', 'unknown-b'])
    expect(view.chapters[0].records[1].updatedMs).toBe(NOW)
    expect(view.chapters[0].records[0].at).toBe(NOW - 30 * DAY)
    expect(view.chapters[0].records[3].at).toBe(0)
  })

  it('falls back to updatedMs for the timeline anchor and keeps supersede links', () => {
    const view = buildArcView([
      source({ name: 'old', topic: '身份', status: 'superseded', createdMs: NOW - DAY, supersededBy: 'new' }),
      source({ name: 'new', topic: '身份', status: 'verified', updatedMs: NOW - 2 * DAY, supersedes: 'old' }),
      source({ name: 'legacy', topic: '身份' }),
    ], registry, { now: NOW })
    const records = view.chapters.find(chapter => chapter.topic === '身份')!.records
    expect(records.map(entry => entry.name)).toEqual(['new', 'old', 'legacy'])
    expect(records[0].supersedes).toBe('old')
    expect(records[1].supersededBy).toBe('new')
    expect(records[2].status).toBe('legacy')
    expect(records[2].title).toBe('legacy')
  })

  it('drops empty chapters and passes scan counters through', () => {
    const view = buildArcView([source({ topic: '考研' })], registry, {
      sources: [{ scope: 'user', slug: '_user', label: '个人', count: 1 }],
      skipped: 2,
      truncated: true,
      now: NOW,
    })
    expect(view.chapters).toHaveLength(1)
    expect(view.skipped).toBe(2)
    expect(view.truncated).toBe(true)
    expect(view.sources[0].label).toBe('个人')
  })

  it('exposes a bounded record cap for the read-only view', () => {
    expect(MAX_ARC_RECORDS).toBe(2000)
  })
})

describe('mergeTopics', () => {
  it('dedupes by id and keeps first-seen order (user registry first)', () => {
    const merged = mergeTopics([
      [{ id: '考研', title: '考研', createdMs: 1 }],
      [{ id: '考研', title: '考研（项目）', note: '重复项', createdMs: 2 }, { id: '项目', title: '项目', createdMs: 3 }],
    ])
    expect(merged.map(topic => topic.id)).toEqual(['考研', '项目'])
    expect(merged[0].title).toBe('考研')
  })
})

describe('arcOriginLabel', () => {
  it('uses 个人 for the user scope and the cwd basename for projects', () => {
    expect(arcOriginLabel('_user')).toBe('个人')
    expect(arcOriginLabel('--C-Users-example-user-Work-demo--', 'C:\\Users\\example-user\\Work\\demo')).toBe('demo')
    expect(arcOriginLabel('--C-Users-example-user-Work-demo--', 'C:\\Users\\example-user\\Work\\demo\\')).toBe('demo')
    expect(arcOriginLabel('--plain-slug--')).toBe('plain-slug')
  })
})

describe('scanArc', () => {
  let root: string

  function memory(over: { name: string; created?: number; topic?: string; status?: string; supersedes?: string; supersededBy?: string }): string {
    const lines = ['---', `name: ${over.name}`, 'description: synthetic description', 'type: user']
    if (over.created !== undefined) lines.push(`created: ${over.created}`)
    if (over.topic !== undefined) lines.push(`topic: ${over.topic}`)
    if (over.status !== undefined) lines.push(`status: ${over.status}`)
    if (over.supersedes !== undefined) lines.push(`supersedes: ${over.supersedes}`)
    if (over.supersededBy !== undefined) lines.push(`supersededBy: ${over.supersededBy}`)
    lines.push('---', '', 'synthetic body')
    return lines.join('\n')
  }

  beforeEach(async () => {
    root = await fsp.mkdtemp(join(tmpdir(), 'wh-arc-'))
    await fsp.mkdir(join(root, '_user'), { recursive: true })
    await writeTopicRegistry(join(root, '_user'), registry)
    await fsp.writeFile(join(root, '_user', 'kaoyan-plan.md'), memory({ name: 'kaoyan-plan', created: NOW - 20 * DAY, topic: '考研', status: 'disputed', supersedes: 'kaoyan-old' }), 'utf8')
    await fsp.writeFile(join(root, '_user', 'loose-note.md'), memory({ name: 'loose-note' }), 'utf8')
    await fsp.writeFile(join(root, '_user', 'MEMORY.md'), 'index, not a record', 'utf8')
    await fsp.writeFile(join(root, '_user', 'broken.md'), 'not frontmatter at all', 'utf8')

    const projectDir = join(root, '--C-Users-example-user-Work-demo--')
    await fsp.mkdir(projectDir, { recursive: true })
    await fsp.writeFile(join(projectDir, '.wh-project.json'), JSON.stringify({ version: 1, cwd: 'C:\\Users\\example-user\\Work\\demo' }), 'utf8')
    await writeTopicRegistry(projectDir, [{ id: '身份', title: '身份', createdMs: 2 }])
    await fsp.writeFile(join(projectDir, 'identity-note.md'), memory({ name: 'identity-note', created: NOW - DAY, topic: '身份', status: 'candidate' }), 'utf8')
  })

  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }) })

  it('collects the user scope plus every project scope, skipping indexes and broken files', async () => {
    const scan = await scanArc(root)
    expect(scan.records.map(record => record.name).sort()).toEqual(['identity-note', 'kaoyan-plan', 'loose-note'])
    expect(scan.skipped).toBe(1)
    expect(scan.truncated).toBe(false)
    expect(scan.topics.map(topic => topic.id)).toEqual(['考研', '身份'])
    expect(scan.sources).toEqual([
      { scope: 'user', slug: '_user', label: '个人', count: 2 },
      { scope: 'project', slug: '--C-Users-example-user-Work-demo--', label: 'demo', path: 'C:\\Users\\example-user\\Work\\demo', count: 1 },
    ])
    const plan = scan.records.find(record => record.name === 'kaoyan-plan')!
    expect(plan).toMatchObject({ topic: '考研', status: 'disputed', origin: '个人', supersedes: 'kaoyan-old', createdMs: NOW - 20 * DAY })
    expect(plan.scope).toBe('user')
    const identity = scan.records.find(record => record.name === 'identity-note')!
    expect(identity).toMatchObject({ scope: 'project', origin: 'demo', originPath: 'C:\\Users\\example-user\\Work\\demo', topic: '身份', status: 'candidate' })
  })

  it('falls back to the directory slug when a project has no marker', async () => {
    const plain = join(root, '--plain-slug--')
    await fsp.mkdir(plain, { recursive: true })
    await fsp.writeFile(join(plain, 'note.md'), memory({ name: 'plain-note' }), 'utf8')
    const scan = await scanArc(root)
    expect(scan.sources.find(item => item.slug === '--plain-slug--')).toMatchObject({ label: 'plain-slug', scope: 'project' })
    expect(scan.sources.find(item => item.slug === '--plain-slug--')?.path).toBeUndefined()
  })

  it('returns an empty view for a missing memory root', async () => {
    const scan = await scanArc(join(root, 'does-not-exist'))
    expect(scan.records).toEqual([])
    expect(scan.topics).toEqual([])
    expect(scan.sources).toEqual([])
    expect(scan.skipped).toBe(0)
  })
})
