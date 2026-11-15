import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { registerMemoryApi } from '../src/memory-api.ts'
import type { ManagementConfig } from '../src/management-api.ts'
import { MemoryStore } from '../src/store.ts'

let root: string, store: MemoryStore
let routes: Map<string, (r: Request) => Promise<Response>>

const cwd = 'D:\\synthetic-auto-merge'
const plan = { key: 'ask-1', topic: '考研', score: 62, reasons: ['描述内容相近'], members: [
  { name: 'alpha', description: 'a', body: 'a', type: 'user' as const },
  { name: 'beta', description: 'b', body: 'b', type: 'user' as const },
] }
const applied: unknown[] = []

function mount(config: Partial<ManagementConfig> = {}) {
  routes = new Map()
  const connection = {
    requestRejection: () => undefined,
    fetch: { register: (route: { path: string; fetch: (r: Request) => Promise<Response> }) => { routes.set(route.path.split('/').pop()!, route.fetch); return () => {} } },
  }
  registerMemoryApi({ get: () => connection } as unknown as Context, store, root, {
    maxBytes: 4096,
    enableUserScope: true,
    resolveProject: () => cwd,
    listProjects: () => [{ id: 's1', cwd }],
    ...config,
  } as ManagementConfig)
}

async function call(route: string, data: Record<string, unknown>) {
  const request = new Request('http://local/api/auto-memory-wh/' + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  })
  const response = await routes.get(route)!(request)
  return { status: response.status, data: await response.json() as Record<string, unknown> }
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'wh-auto-merge-api-'))
  store = new MemoryStore(root)
  applied.length = 0
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe('auto merge routes (v1.0.0-rc.2)', () => {
  it('applies an ask plan when the panel sends its key', async () => {
    mount({
      autoMerge: {
        scan: async () => ({ auto: [], ask: [plan] }),
        apply: async (candidate, scope, cwdValue) => { applied.push({ candidate, scope, cwdValue }); return { id: 'm1', at: '2026-11-09T00:00:00.000Z', scope, topic: candidate.topic, target: '考研-merged', sources: ['alpha', 'beta'], score: candidate.score } },
        list: async () => [],
        undo: async () => null,
      },
    })
    const response = await call('merge.autoApply', { scope: 'user', key: 'ask-1' })
    expect(response.status).toBe(200)
    expect(response.data.applied).toHaveLength(1)
    expect(applied).toHaveLength(1)
    expect((applied[0] as { candidate: { key: string } }).candidate.key).toBe('ask-1')
  })

  it('rejects an unknown merge key', async () => {
    mount({
      autoMerge: {
        scan: async () => ({ auto: [], ask: [plan] }),
        apply: async () => { throw new Error('must not apply') },
        list: async () => [],
        undo: async () => null,
      },
    })
    const response = await call('merge.autoApply', { scope: 'user', key: 'gone' })
    expect(response.status).toBe(404)
  })

  it('accepts a topic id when creating a record', async () => {
    mount()
    const response = await call('memory.write', {
      scope: 'user', name: 'kaoyan-note', title: '考研安排', description: '复习进度', type: 'user', body: '高数到不定积分', expectedRevision: null, topic: '考研',
    })
    expect(response.status).toBe(200)
    expect((await store.read('kaoyan-note', 'user'))?.topic).toBe('考研')
  })
})
