import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { registerMemoryApi } from '../src/memory-api.ts'
import type { ManagementConfig } from '../src/management-api.ts'
import { MemoryStore } from '../src/store.ts'
import { writeTopicRegistry } from '../src/topics.ts'

let root: string, store: MemoryStore
let routes: Map<string, (r: Request) => Promise<Response>>

const cwd = 'D:\\synthetic-arc'

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
  root = await fs.mkdtemp(join(tmpdir(), 'wh-arc-api-'))
  store = new MemoryStore(root)
  await store.write({ name: 'kaoyan-plan', title: '考研计划', description: '复习进度', type: 'user', body: 'secret body', status: 'verified', topic: '考研' }, 'user')
  await store.write({ name: 'loose-note', description: '未归类的一条', type: 'user', body: 'synthetic' }, 'user')
  await writeTopicRegistry(join(root, '_user'), [{ id: '考研', title: '考研', createdMs: 1 }])
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe('arc.view route (v1.0.0-rc.3)', () => {
  it('builds the read-only arc across the user scope without leaking bodies', async () => {
    mount()
    const response = await call('arc.view', { scope: 'user' })
    expect(response.status).toBe(200)
    const view = response.data as { chapters: Array<{ topic: string; title: string; records: Array<Record<string, unknown>> }>; total: number; sources: Array<{ label: string }> }
    expect(view.total).toBe(2)
    expect(view.chapters.map(chapter => chapter.topic)).toEqual(['考研', '未归类'])
    expect(view.chapters[0].records[0].name).toBe('kaoyan-plan')
    expect(view.chapters[0].records[0].status).toBe('verified')
    expect(view.sources[0].label).toBe('个人')
    expect(JSON.stringify(view)).not.toContain('secret body')
  })

  it('accepts the panel scope/session parameters it does not need', async () => {
    mount()
    const response = await call('arc.view', { scope: 'project', sessionId: 's1' })
    expect(response.status).toBe(200)
    expect((response.data as { total: number }).total).toBe(2)
  })

  it('rejects unsupported fields', async () => {
    mount()
    const response = await call('arc.view', { scope: 'user', threshold: 30 })
    expect(response.status).toBe(400)
    expect(response.data.code).toBe('INVALID_INPUT')
  })

  it('is gated by the graph feature (full edition)', async () => {
    mount({ edition: 'minimal' })
    const response = await call('arc.view', { scope: 'user' })
    expect(response.status).toBe(403)
    expect(response.data.code).toBe('EDITION_DISABLED')
  })
})
