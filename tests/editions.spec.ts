/**
 * v0.12.0 版本分级：三档功能开关、API 门禁与向后兼容。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { MemoryStore } from '../src/store.ts'
import { registerMemoryApi } from '../src/memory-api.ts'
import type { ManagementConfig } from '../src/management-api.ts'
import { EDITION_PROFILES, editionFeatures, editionProfile, isEdition, type Edition } from '../src/editions.ts'

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
    resolveProject: () => undefined,
    listProjects: () => [],
    ...overrides,
  })
}

async function call(route: string, data: Record<string, unknown>, method: 'GET' | 'POST' = 'POST') {
  const query = method === 'GET' ? '?' + new URLSearchParams(Object.entries(data).map(([k, v]) => [k, String(v)])).toString() : ''
  const request = new Request('http://local/api/auto-memory-wh/' + route + query, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(data) })
  const response = await routes.get(route)!(request)
  return { status: response.status, data: await response.json() as Record<string, unknown> }
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'wh-edition-'))
  store = new MemoryStore(root)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('editions', () => {
  it('describes three tiers reading the same store with different budgets', () => {
    expect(Object.keys(EDITION_PROFILES)).toEqual(['minimal', 'standard', 'full'])
    expect(editionProfile('minimal').maxBytes).toBeLessThan(editionProfile('standard').maxBytes)
    expect(editionProfile('full').maxBytes).toBe(editionProfile('standard').maxBytes)
    expect(isEdition('minimal')).toBe(true)
    expect(isEdition('enterprise')).toBe(false)
  })

  it('gates optional features per tier without changing trust semantics', () => {
    expect(editionFeatures('minimal')).toEqual({
      reminders: false, autoSummarize: false, autoBackup: false, merge: false,
      graph: false, importExport: false, migration: false, batch: false,
    })
    const standard = editionFeatures('standard')
    expect(standard).toMatchObject({ reminders: true, merge: true, importExport: true, migration: true })
    expect(standard).toMatchObject({ graph: false, batch: false })
    expect(editionFeatures('full')).toMatchObject({ graph: true, batch: true })
  })

  it('returns a fresh feature object so callers cannot mutate the profiles', () => {
    const a = editionFeatures('full')
    a.graph = false
    expect(editionFeatures('full').graph).toBe(true)
  })
})

describe('edition API fence', () => {
  it('reports the edition and feature flags through groups.list', async () => {
    await mount({ edition: 'standard' })
    const result = await call('groups.list', { scope: 'user' }, 'GET')
    expect(result.status).toBe(200)
    expect(result.data.edition).toBe('standard')
    expect(result.data.features).toMatchObject({ graph: false, merge: true })
  })

  it('defaults to full when no edition is configured', async () => {
    await mount()
    const result = await call('groups.list', { scope: 'user' }, 'GET')
    expect(result.data.edition).toBe('full')
    expect(result.data.features).toMatchObject({ graph: true, batch: true })
  })

  it('rejects graph, merge, export and migration in the minimal tier', async () => {
    await mount({ edition: 'minimal' })
    for (const [route, payload] of [
      ['relatedness.graph', { scope: 'user' }],
      ['memory.duplicates', { scope: 'user' }],
      ['memory.mergeSuggest', { scope: 'user' }],
      ['export.package', { scope: 'user' }],
      ['import.plan', { scope: 'user', package: {} }],
    ] as const) {
      const result = await call(route, payload)
      expect(result.status, route).toBe(403)
      expect(result.data.code, route).toBe('EDITION_DISABLED')
    }
    const migration = await call('migration.status', {}, 'GET')
    expect(migration.status).toBe(403)
  })

  it('allows graph in the full tier and keeps it out of standard', async () => {
    await mount({ edition: 'full' })
    const full = await call('relatedness.graph', { scope: 'user' })
    expect(full.status).toBe(200)
    expect(full.data).toHaveProperty('nodes')

    await mount({ edition: 'standard' })
    const standard = await call('relatedness.graph', { scope: 'user' })
    expect(standard.status).toBe(403)
    expect(standard.data.code).toBe('EDITION_DISABLED')
  })
})

describe('runtime edition switching (v0.12.1)', () => {
  it('applies the new tier immediately and reports it through groups.list', async () => {
    let current: Edition = 'full'
    let currentFeatures = editionFeatures(current)
    await mount({
      edition: () => current,
      features: () => currentFeatures,
      setEdition: next => {
        current = next
        currentFeatures = editionFeatures(next)
        return { edition: current, features: currentFeatures }
      },
    })
    const switched = await call('edition.set', { edition: 'minimal' })
    expect(switched.status).toBe(200)
    expect(switched.data).toMatchObject({ ok: true, edition: 'minimal' })
    const list = await call('groups.list', { scope: 'user' }, 'GET')
    expect(list.data.edition).toBe('minimal')
    expect(list.data.features).toMatchObject({ merge: false, graph: false })
    const graph = await call('relatedness.graph', { scope: 'user' })
    expect(graph.status).toBe(403)
    expect(graph.data.code).toBe('EDITION_DISABLED')
  })

  it('rejects unknown editions and hosts without a runtime setter', async () => {
    await mount()
    const invalid = await call('edition.set', { edition: 'enterprise' })
    expect(invalid.status).toBe(400)
    expect(invalid.data.code).toBe('INVALID_INPUT')
    const unsupported = await call('edition.set', { edition: 'minimal' })
    expect(unsupported.status).toBe(400)
    expect(unsupported.data.code).toBe('EDITION_DISABLED')
  })
})

describe('manual consolidation routes (v0.12.3)', () => {
  const run = vi.fn(async (sessionId: string) => sessionId === 'missing' ? { ok: false as const, reason: 'unknown-session' as const } : { ok: true as const })

  beforeEach(() => {
    run.mockClear()
  })

  const sessions = () => [
    { id: 's1', cwd: root, lastActivityAt: 1_700_000_000_000, lines: 4 },
  ]

  it('lists candidate sessions and runs a summary for one', async () => {
    await mount({ features: () => editionFeatures('full'), consolidationSessions: limit => sessions().slice(0, limit), consolidationRun: run })
    const list = await call('consolidation.sessions', { limit: 3 }, 'GET')
    expect(list.status).toBe(200)
    expect(list.data).toEqual({ sessions: sessions() })

    const ok = await call('consolidation.run', { sessionId: 's1' })
    expect(ok.status).toBe(200)
    expect(ok.data).toEqual({ ok: true })
    expect(run).toHaveBeenCalledWith('s1')

    const missing = await call('consolidation.run', { sessionId: 'missing' })
    expect(missing.status).toBe(404)
    expect(missing.data.code).toBe('NOT_FOUND')
  })

  it('hides both routes when the tier has no autoSummarize', async () => {
    await mount({ features: () => editionFeatures('minimal') })
    const list = await call('consolidation.sessions', {}, 'GET')
    expect(list.status).toBe(403)
    expect(list.data.code).toBe('EDITION_DISABLED')
    const runResult = await call('consolidation.run', { sessionId: 's1' })
    expect(runResult.status).toBe(403)
  })
})
