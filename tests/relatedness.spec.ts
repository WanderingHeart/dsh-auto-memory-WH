/**
 * v0.7.0 相关性（只读）：打分、理由、排序与 API 契约。
 *
 * 断言原则：纯函数直接测；API 走 registerMemoryApi 的假 connection。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { MemoryStore } from '../src/store.ts'
import { registerMemoryApi } from '../src/memory-api.ts'
import type { ManagementConfig } from '../src/management-api.ts'
import {
  DEFAULT_RELATEDNESS_LIMIT,
  RELATEDNESS_STRONG,
  RELATEDNESS_WEAK,
  hasWords,
  mentions,
  overlap,
  rankRelated,
  scoreRelated,
  tokenize,
  type RelatednessRecord,
} from '../src/relatedness.ts'

const userCwd = 'D:\\synthetic-related-user'
const projectCwd = 'D:\\synthetic-related-project'

function record(overrides: Partial<RelatednessRecord> = {}): RelatednessRecord {
  return {
    name: 'alpha',
    title: 'Memory deploy pipeline',
    description: 'deploys the memory store to staging',
    type: 'reference',
    scope: 'user',
    ...overrides,
  }
}

describe('tokenize and overlap', () => {
  it('keeps ascii words, drops short words and stopwords, and builds CJK bigrams', () => {
    const tokens = tokenize('The memory-store deploy AND a 中文记忆测试')
    expect(tokens.has('memory-store')).toBe(true)
    expect(tokens.has('deploy')).toBe(true)
    expect(tokens.has('the')).toBe(false)
    expect(tokens.has('and')).toBe(false)
    expect(tokens.has('记忆')).toBe(true)
    expect(tokens.has('忆测')).toBe(true)
    expect(tokenize(undefined).size).toBe(0)
  })

  it('measures overlap against the shorter side', () => {
    expect(overlap(new Set(['a', 'b']), new Set(['a', 'b', 'c']))).toBe(1)
    expect(overlap(new Set(['a']), new Set(['b']))).toBe(0)
    expect(overlap(new Set(), new Set(['a']))).toBe(0)
  })

  it('adds canonical synonym tokens and splits dashed names (rc.12)', () => {
    expect(tokenize('考研').has('~kaoyan')).toBe(true)
    expect(tokenize('研究生考试').has('~kaoyan')).toBe(true)
    expect(tokenize('备考').has('~review')).toBe(true)
    expect(tokenize('memory-wh').has('memory')).toBe(true)
    expect(tokenize('memory').has('~kaoyan')).toBe(false)
  })

  it('recognises explicit name mentions with word boundaries only', () => {
    expect(mentions('see [[merge-policy]] for details', 'merge-policy')).toBe(true)
    expect(mentions('merge-policy-v2 is different', 'merge-policy')).toBe(false)
    expect(mentions('nothing here', 'merge-policy')).toBe(false)
    expect(mentions('see tab here', 'tab')).toBe(false)
  })
})

describe('scoreRelated', () => {
  it('rewards an explicit reference, similar text, same type/scope and close timestamps', () => {
    const target = record({ body: 'links to [[beta]] when the pipeline runs', updatedMs: 1_500 })
    const candidate = record({ name: 'beta', description: 'deploys the memory store to staging', body: 'same content', updatedMs: 1_000 })
    const { score, reasons } = scoreRelated(target, { ...candidate, updatedMs: 2_000 })
    expect(score).toBeGreaterThanOrEqual(RELATEDNESS_STRONG)
    expect(reasons).toContain('记录之间显式引用 +40')
    expect(reasons).toContain('类型相同 +5')
    expect(reasons).toContain('作用域相同 +5')
    expect(reasons).toContain('更新时间接近 +5')
  })

  it('marks same-project pairs and rejects unrelated text', () => {
    const left = record({ scope: 'project', sameProject: true })
    const right = record({ name: 'beta', scope: 'project', sameProject: true })
    expect(scoreRelated(left, right).reasons).toContain('同一项目 +10')
    const unrelated = record({ name: 'gamma', title: 'Garlic noodles', description: 'cooking recipe with basil', body: 'boil water', type: 'feedback', updatedMs: 10 * 24 * 60 * 60_000 })
    expect(scoreRelated(left, unrelated).score).toBeLessThan(RELATEDNESS_WEAK)
  })
})

describe('rankRelated', () => {
  it('drops below-threshold, empty and self records, then sorts by score and slices', () => {
    const target = record({ body: 'deploys the memory store to staging', updatedMs: 1_000 })
    const strong = record({ name: 'beta', description: 'deploys the memory store to staging now', body: 'deploys the memory store to staging', updatedMs: 1_000 })
    const weak = record({ name: 'gamma', title: 'Other notes', description: 'memory store notes', type: 'feedback' })
    const empty = record({ name: 'empty', title: undefined, description: '', body: undefined })
    const self = record({ name: 'alpha' })
    const hits = rankRelated(target, [weak, strong, empty, self], DEFAULT_RELATEDNESS_LIMIT)
    expect(hits.map(hit => hit.name)).toEqual(['beta'])
    expect(hits[0]!.strength).toBe('strong')
    expect(hasWords(empty.description)).toBe(false)
  })

  it('caps output at the requested limit and reports weak items when they reach the threshold', () => {
    const target = record()
    const candidates = ['one', 'two', 'three', 'four', 'five'].map((name, index) => record({
      name,
      description: 'deploys the memory store to staging',
      title: 'Memory deploy ' + name,
      updatedMs: 1_000 + index,
    }))
    const hits = rankRelated(target, candidates, 2)
    expect(hits).toHaveLength(2)
    expect(hits.every(hit => hit.score >= RELATEDNESS_WEAK)).toBe(true)
  })

  it('handles 500 mixed-language records quickly', () => {
    const target = record({ title: '记忆部署流水线', description: '把记忆部署到测试环境' })
    const candidates = Array.from({ length: 500 }, (_, index) => record({
      name: 'candidate-' + index,
      title: index % 2 === 0 ? '记忆部署流水线' : 'unrelated cooking notes',
      description: index % 2 === 0 ? '把记忆部署到测试环境' : 'garlic basil noodles',
      body: 'body text for candidate ' + index,
    }))
    const started = performance.now()
    const hits = rankRelated(target, candidates, 5)
    expect(performance.now() - started).toBeLessThan(500)
    expect(hits.length).toBeGreaterThan(0)
  })
})

describe('relatedness.forRecord API', () => {
  let root: string
  let store: MemoryStore
  let routes: Map<string, (r: Request) => Promise<Response>>

  async function mount(overrides: Partial<ManagementConfig> = {}): Promise<void> {
    routes = new Map()
    const connection = {
      requestRejection: () => undefined,
      fetch: { register: (route: { path: string; fetch: (r: Request) => Promise<Response> }) => { routes.set(route.path.split('/').pop()!, route.fetch); return () => {} } },
    }
    registerMemoryApi({ get: () => connection } as unknown as Context, store, root, {
      maxBytes: 4096,
      enableUserScope: true,
      resolveProject: (id: string) => ({ s1: projectCwd } as Record<string, string>)[id],
      listProjects: () => [{ id: 's1', cwd: projectCwd }],
      ...overrides,
    })
  }

  async function call(route: string, data: Record<string, unknown>) {
    const request = new Request('http://local/api/auto-memory-wh/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
    const response = await routes.get(route)!(request)
    return { status: response.status, data: await response.json() as Record<string, unknown> }
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'wh-related-'))
    store = new MemoryStore(root)
    await mount()
    await store.write({ name: 'deploy-pipeline', title: 'Memory deploy pipeline', description: 'deploys the memory store to staging', type: 'reference', body: 'see [[deploy-checklist]]' }, 'user')
    await store.write({ name: 'deploy-checklist', title: 'Memory deploy checklist', description: 'staging deploy steps for the memory store', type: 'reference', body: 'run the deploy then verify' }, 'user')
    await store.write({ name: 'cooking-notes', title: 'Garlic noodles', description: 'boil water and add basil', type: 'feedback', body: 'recipe' }, 'user')
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('returns ranked related records with reasons and thresholds', async () => {
    const result = await call('relatedness.forRecord', { scope: 'user', name: 'deploy-pipeline' })
    expect(result.status).toBe(200)
    const items = result.data.items as Array<Record<string, unknown>>
    expect(items[0]!.name).toBe('deploy-checklist')
    expect(items[0]!.strength).toBe('strong')
    expect((items[0]!.reasons as string[]).join('\n')).toContain('显式引用')
    expect(items.some(item => item.name === 'cooking-notes')).toBe(false)
    expect(result.data.thresholds).toEqual({ weak: RELATEDNESS_WEAK, strong: RELATEDNESS_STRONG })
  })

  it('rejects a missing target and a request without scope', async () => {
    const missing = await call('relatedness.forRecord', { scope: 'user', name: 'does-not-exist' })
    expect(missing.status).toBe(404)
    const noScope = await call('relatedness.forRecord', { name: 'deploy-pipeline' })
    expect(noScope.status).toBe(400)
  })

  it('honours a custom limit and excludes the target itself', async () => {
    const result = await call('relatedness.forRecord', { scope: 'user', name: 'deploy-pipeline', limit: 1 })
    const items = result.data.items as Array<Record<string, unknown>>
    expect(items).toHaveLength(1)
    expect(items[0]!.name).not.toBe('deploy-pipeline')
  })

  it('returns a graph of nodes and edges for the whole scope', async () => {
    const result = await call('relatedness.graph', { scope: 'user' })
    expect(result.status).toBe(200)
    const nodes = result.data.nodes as Array<Record<string, unknown>>
    const edges = result.data.edges as Array<Record<string, unknown>>
    expect(nodes.map(each => each.name).sort()).toEqual(['cooking-notes', 'deploy-checklist', 'deploy-pipeline'])
    expect(edges).toHaveLength(1)
    expect(edges[0]!.score).toBeGreaterThanOrEqual(RELATEDNESS_WEAK)
    expect(result.data.thresholds).toEqual({ weak: RELATEDNESS_WEAK, strong: RELATEDNESS_STRONG })
  })
})
