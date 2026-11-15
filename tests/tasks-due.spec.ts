/**
 * v0.9.0 tasks.due：只读到期提醒馈送（小鲸鱼气泡通道的数据源）。
 * 数据来自宿主原生调度（config.dueReminders），不再读记忆库里的任务。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { MemoryStore } from '../src/store.ts'
import { registerMemoryApi } from '../src/memory-api.ts'
import type { ManagementConfig } from '../src/management-api.ts'

let root: string
let store: MemoryStore
let routes: Map<string, (r: Request) => Promise<Response>>

async function mount(overrides: Partial<ManagementConfig> = {}): Promise<void> {
  routes = new Map()
  const connection = {
    requestRejection: (r: Request) => r.headers.has('deny') ? 403 : undefined,
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

async function call(route: string, data: Record<string, unknown>) {
  const request = new Request('http://local/api/auto-memory-wh/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
  const response = await routes.get(route)!(request)
  return { status: response.status, data: await response.json() as Record<string, unknown> }
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'wh-due-'))
  store = new MemoryStore(root)
  await mount()
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('tasks.due', () => {
  it('maps host reminders into feed items ordered as the host returned them', async () => {
    const at = Date.now() - 60_000
    await mount({ dueReminders: async () => [{ id: 'r1', title: '喝水', at }, { id: 'r2', title: '开会', at: at + 1_000 }] })
    const result = await call('tasks.due', {})
    expect(result.status).toBe(200)
    const items = result.data.items as Array<Record<string, unknown>>
    expect(items).toEqual([
      { name: 'r1', title: '喝水', scope: 'user', dueAt: at, remindAt: at, taskStatus: 'open' },
      { name: 'r2', title: '开会', scope: 'user', dueAt: at + 1_000, remindAt: at + 1_000, taskStatus: 'open' },
    ])
    expect(result.data.whale).toBe('auto')
  })

  it('returns an empty feed when the host adapter is not wired', async () => {
    const result = await call('tasks.due', {})
    expect(result.data).toMatchObject({ items: [], whale: 'auto' })
  })

  it('honours notifyWhale=off by returning no items and the off marker', async () => {
    await mount({ notifyWhale: 'off', dueReminders: async () => [{ id: 'r1', title: '喝水', at: Date.now() }] })
    const result = await call('tasks.due', {})
    expect(result.data).toMatchObject({ items: [], whale: 'off' })
  })

  it('rejects requests that fail the host authorization fence', async () => {
    const denied = new Request('http://local/api/auto-memory-wh/tasks.due', { method: 'POST', headers: { 'content-type': 'application/json', deny: '1' }, body: '{}' })
    const response = await routes.get('tasks.due')!(denied)
    expect(response.status).toBe(403)
  })
})

describe('completion.pending', () => {
  it('returns recent completions with the configured threshold', async () => {
    const at = Date.now() - 5_000
    await mount({
      notifyDone: true,
      notifyDoneMinSeconds: 90,
      recentCompletions: () => [{ id: 'session-a@1', sessionId: 'session-a', startedAt: at - 90_000, endedAt: at, durationMs: 90_000 }],
    })
    const result = await call('completion.pending', {})
    expect(result.status).toBe(200)
    expect(result.data).toMatchObject({
      enabled: true,
      minSeconds: 90,
      items: [{ id: 'session-a@1', sessionId: 'session-a', durationMs: 90_000 }],
    })
  })

  it('reports disabled and withholds items when notifyDone is off', async () => {
    await mount({
      notifyDone: false,
      recentCompletions: () => [{ id: 'session-a@1', sessionId: 'session-a', startedAt: 1, endedAt: 2, durationMs: 1 }],
    })
    const result = await call('completion.pending', {})
    expect(result.data).toMatchObject({ enabled: false, items: [] })
  })

  it('returns an empty list when no adapter is wired', async () => {
    const result = await call('completion.pending', {})
    expect(result.data).toMatchObject({ enabled: true, items: [] })
  })
})
