/**
 * v0.6.0 质量体检与检索可解释性。
 * 纯函数 + API + 工具三条入口都要过一遍(用户要求“每个涉及的功能都要过一遍”)。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { MemoryStore } from '../src/store.ts'
import { registerMemoryApi } from '../src/memory-api.ts'
import { registerMemoryTools } from '../src/memory-tools.ts'
import type { ManagementConfig } from '../src/management-api.ts'
import { lintRecord, qualityReport, DESCRIPTION_MAX, SECTIONS_MAX, STALE_DAYS } from '../src/quality.ts'
import type { MemoryRecord } from '../src/types.ts'

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0)
const cwd = join(tmpdir(), 'wh-test-projects', 'synthetic-quality')

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    name: 'release-cadence',
    title: 'Release cadence',
    description: 'ship one minor per acceptance round',
    body: 'Decision: one minor per acceptance round.\nReason: isolated verification catches regressions before the next version.',
    type: 'project',
    scope: 'project',
    status: 'verified',
    updatedMs: NOW - 10 * 86_400_000,
    ...overrides,
  }
}

describe('quality: lintRecord', () => {
  it('keeps a well-written verified record clean', () => {
    expect(lintRecord(record(), NOW)).toEqual([])
  })

  it('flags long descriptions, short bodies and generic names', () => {
    const codes = lintRecord(record({ name: 'memo', title: '', description: 'x'.repeat(DESCRIPTION_MAX + 1), body: 'short' }), NOW).map(item => item.code)
    expect(codes).toContain('description-long')
    expect(codes).toContain('body-short')
    expect(codes).toContain('name-generic')
    expect(codes).toContain('title-missing')
  })

  it('requires a due time for open tasks and reports stale open ones', () => {
    const missing = lintRecord(record({ name: 'no-due', type: 'task', taskStatus: 'open' }), NOW).map(item => item.code)
    expect(missing).toContain('task-missing-due')
    const overdue = lintRecord(record({ name: 'late', type: 'task', taskStatus: 'open', dueAt: NOW - 8 * 86_400_000 }), NOW).map(item => item.code)
    expect(overdue).toContain('task-overdue')
    // 已完成/取消的任务不再提示截止相关项。
    const done = lintRecord(record({ name: 'done', type: 'task', taskStatus: 'done' }), NOW).map(item => item.code)
    expect(done).not.toContain('task-missing-due')
    expect(done).not.toContain('task-overdue')
  })

  it('suggests updating long-stale content unless pinned', () => {
    const stale = record({ updatedMs: NOW - (STALE_DAYS + 1) * 86_400_000 })
    expect(lintRecord(stale, NOW).map(item => item.code)).toContain('stale-record')
    expect(lintRecord({ ...stale, pinned: true }, NOW).map(item => item.code)).not.toContain('stale-record')
    // rc.11：candidate 与 verified 一样会注入，因此同样提示过期。
    expect(lintRecord({ ...stale, status: 'candidate' }, NOW).map(item => item.code)).toContain('stale-record')
    expect(lintRecord({ ...stale, status: 'superseded' }, NOW).map(item => item.code)).not.toContain('stale-record')
  })

  it('flags records that likely mix several topics', () => {
    const body = Array.from({ length: SECTIONS_MAX + 1 }, (_, index) => `## Topic ${index}\ncontent`).join('\n\n')
    expect(lintRecord(record({ body }), NOW).map(item => item.code)).toContain('body-many-sections')
  })
})

describe('quality: qualityReport', () => {
  it('aggregates by code, counts flagged rows and puts warnings first', () => {
    const report = qualityReport([
      record(),
      record({ name: 'memo', description: 'd', body: 'b' }),
      record({ name: 'notes', title: '', description: 'x'.repeat(DESCRIPTION_MAX + 1), body: 'y'.repeat(80) }),
    ], NOW)
    expect(report.scanned).toBe(3)
    expect(report.flagged).toBe(2)
    expect(report.byCode['name-generic']).toBe(2)
    expect(report.byCode['description-long']).toBe(1)
    // notes 有 warn(描述过长),排在 memo 前。
    expect(report.records[0].name).toBe('notes')
    expect(report.thresholds.descriptionMax).toBe(DESCRIPTION_MAX)
  })

  it('respects the row limit while keeping the totals', () => {
    const many = Array.from({ length: 5 }, (_, index) => record({ name: `memo-${index}`, description: 'd', body: 'b' }))
    const report = qualityReport(many, NOW, 2)
    expect(report.flagged).toBe(5)
    expect(report.records).toHaveLength(2)
  })
})

describe('quality: management API', () => {
  let root: string
  let store: MemoryStore
  let indexUsage: () => Promise<{ bytes: number; budget: number; excluded: Array<{ id: string; reason: string }> }>
  const routes = new Map<string, (r: Request) => Promise<Response>>()

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'wh-quality-'))
    store = new MemoryStore(root)
    routes.clear()
    indexUsage = async () => ({ bytes: 1234, budget: 4096, excluded: [{ id: 'excluded-one', reason: 'budget' }] })
    const connection = {
      requestRejection: () => undefined,
      fetch: { register: (route: { path: string; fetch: (r: Request) => Promise<Response> }) => { routes.set(route.path.split('/').pop()!, route.fetch); return () => {} } },
    }
    registerMemoryApi({ get: () => connection } as unknown as Context, store, root, { maxBytes: 4096, enableUserScope: true, resolveProject: () => cwd, listProjects: () => [{ id: 's1', cwd }], indexUsage: () => indexUsage() } as unknown as ManagementConfig)
  })
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

  async function call(route: string, data: Record<string, unknown>) {
    const response = await routes.get(route)!(new Request('http://local/api/auto-memory-wh/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }))
    return { status: response.status, data: await response.json() as any }
  }

  it('reports issues for one scope without modifying records', async () => {
    await store.write({ name: 'memo', description: 'd', body: 'b', type: 'project', status: 'verified' }, 'project', cwd)
    const before = await store.read('memo', 'project', cwd)
    const result = await call('quality.report', { scope: 'project', sessionId: 's1' })
    expect(result.status).toBe(200)
    expect(result.data.scanned).toBe(1)
    expect(result.data.flagged).toBe(1)
    expect(result.data.records[0].issues.map((item: { code: string }) => item.code)).toContain('name-generic')
    expect((await store.read('memo', 'project', cwd))!.revision).toBe(before!.revision)
    expect(result.data.index).toEqual({ bytes: 1234, budget: 4096, excluded: [{ id: 'excluded-one', reason: 'budget' }] })
    expect(result.data.duplicates).toEqual({ groups: 0, threshold: 0.8 })
  })

  it('omits index usage when the host cannot compute it', async () => {
    indexUsage = async () => { throw new Error('no index') }
    await store.write({ name: 'kept', description: 'd', body: 'short', type: 'project', status: 'verified' }, 'project', cwd)
    const result = await call('quality.report', { scope: 'project', sessionId: 's1' })
    expect(result.status).toBe(200)
    expect(result.data.index).toBeUndefined()
    expect(result.data.scanned).toBe(1)
  })

  it('reports near-duplicate group count', async () => {
    await store.write({ name: 'dup-a', description: 'same words', body: 'alpha beta gamma delta', type: 'project', status: 'verified' }, 'project', cwd)
    await store.write({ name: 'dup-b', description: 'same words', body: 'alpha beta gamma delta', type: 'project', status: 'verified' }, 'project', cwd)
    const result = await call('quality.report', { scope: 'project', sessionId: 's1' })
    expect(result.status).toBe(200)
    expect(result.data.duplicates.groups).toBe(1)
  })

  it('rejects an unknown scope with a 400', async () => {
    const result = await call('quality.report', { scope: 'galaxy' })
    expect(result.status).toBe(400)
    expect(result.data.code).toBe('INVALID_INPUT')
  })
})

describe('quality: search explains where it matched', () => {
  let root: string
  let ctx: Context | undefined
  beforeEach(async () => { root = await fs.mkdtemp(join(tmpdir(), 'wh-quality-search-')); ctx = new Context() })
  afterEach(async () => { if (ctx) await ctx.fiber.dispose(); await fs.rm(root, { recursive: true, force: true }) })

  it('returns the matching field names alongside the score', async () => {
    const store = new MemoryStore(root)
    await ctx!.plugin(SystemPrompt, {})
    await ctx!.plugin(ToolRuntime, {})
    registerMemoryTools(ctx!, store, false)
    await store.write({ name: 'release-cadence', title: 'Release cadence', description: 'ship one minor per acceptance', body: 'isolated verification catches regressions before the next version', type: 'project' }, 'project', cwd)
    const exec = { agent: { session: { header: { cwd }, id: 'synthetic-quality' } } } as any
    const byName = await ctx!.tools.get('memory_search')!.execute({ query: 'cadence', limit: 3 } as never, exec) as { matches: Array<{ name: string; matchedIn: string[] }> }
    expect(byName.matches[0].name).toBe('release-cadence')
    expect(byName.matches[0].matchedIn).toContain('name')
    const byBody = await ctx!.tools.get('memory_search')!.execute({ query: 'regressions', limit: 3 } as never, exec) as { matches: Array<{ matchedIn: string[] }> }
    expect(byBody.matches[0].matchedIn).toContain('body')
  })
})
