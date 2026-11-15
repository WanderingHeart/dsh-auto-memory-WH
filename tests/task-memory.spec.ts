/**
 * v0.5.0 任务型记忆:存储/工具/API/同步/导入导出全链路。
 * 断言原则同 store.spec:优先重新读磁盘或走公开入口,不查对象内部状态。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { INDEX_FILENAME, MemoryStore, type MemoryWriteInput } from '../src/store.ts'
import { registerMemoryTools, type MemoryToolsOptions } from '../src/memory-tools.ts'
import { registerMemoryApi } from '../src/memory-api.ts'
import type { ManagementConfig } from '../src/management-api.ts'
import { renderMemoryIndexDetail } from '../src/prompt.ts'
import { buildChangeset, changesetChecksum, verifyChangeset, applyChangeset } from '../src/sync.ts'
import { buildExportPackage, verifyExportPackage, applyImport } from '../src/transfer.ts'
import { isRemindableTask } from '../src/tasks.ts'
import type { MemoryRecord } from '../src/types.ts'

const cwd = 'D:\\synthetic-task'
const later = Date.UTC(2026, 10, 20, 9, 0, 0)
const remind = Date.UTC(2026, 10, 20, 8, 0, 0)

let root: string
let store: MemoryStore
let ctx: Context | undefined
let routes: Map<string, (r: Request) => Promise<Response>>
let taskChanges = vi.fn()

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'wh-task-'))
  store = new MemoryStore(root)
  routes = new Map()
  taskChanges = vi.fn()
  const connection = {
    requestRejection: (r: Request) => r.headers.has('deny') ? 403 : undefined,
    fetch: { register: (route: { path: string; fetch: (r: Request) => Promise<Response> }) => { routes.set(route.path.split('/').pop()!, route.fetch); return () => {} } },
  }
  registerMemoryApi({ get: () => connection } as unknown as Context, store, root, { maxBytes: 4096, enableUserScope: true, resolveProject: (id: string) => ({ s1: cwd } as Record<string, string>)[id], listProjects: () => [{ id: 's1', cwd }], onTaskChange: () => taskChanges() } as unknown as ManagementConfig)
})

afterEach(async () => {
  if (ctx) await ctx.fiber.dispose()
  ctx = undefined
  await fs.rm(root, { recursive: true, force: true })
})

async function call(route: string, data: Record<string, unknown>, method = 'POST') {
  const request = method === 'GET'
    ? new Request('http://local/api/auto-memory-wh/' + route + '?' + new URLSearchParams(data as Record<string, string>))
    : new Request('http://local/api/auto-memory-wh/' + route, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
  const response = await routes.get(route)!(request)
  return { status: response.status, data: await response.json() as any }
}

async function tools(options: MemoryToolsOptions = {}) {
  ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  registerMemoryTools(ctx, store, true, options)
  const exec = { agent: { session: { header: { cwd }, id: 'synthetic-task' } } } as any
  return (name: string, args: object) => ctx!.tools.get(name)!.execute(args as never, exec)
}

function taskInput(overrides: Record<string, unknown> = {}): MemoryWriteInput {
  return { name: 'ship-report', title: 'Ship report', description: 'deliver the report', type: 'task', body: 'details', dueAt: later, remindAt: remind, priority: 2, taskStatus: 'open', ...overrides } as unknown as MemoryWriteInput
}

describe('store: task fields', () => {
  it('round-trips every task field through the frontmatter', async () => {
    const written = await store.write(taskInput(), 'project', cwd)
    expect(written).not.toBeNull()
    const read = await store.read('ship-report', 'project', cwd)
    expect(read).toMatchObject({ type: 'task', dueAt: later, remindAt: remind, priority: 2, taskStatus: 'open' })
    const raw = await fs.readFile(join(store.dir('project', cwd), 'ship-report.md'), 'utf8')
    expect(raw).toContain(`dueAt: ${later}`)
    expect(raw).toContain(`remindAt: ${remind}`)
    expect(raw).toContain('priority: 2')
    expect(raw).toContain('taskStatus: open')
  })

  it('inherits task fields on content edits and clears them on request', async () => {
    await store.write(taskInput(), 'project', cwd)
    const first = (await store.read('ship-report', 'project', cwd))!
    const edited = await store.write({ name: 'ship-report', title: 'Ship report', description: 'deliver the report', type: 'task', body: 'new details', expectedRevision: first.revision }, 'project', cwd)
    expect(edited).toMatchObject({ dueAt: later, remindAt: remind, priority: 2, taskStatus: 'open' })
    expect(edited!.status).toBe('candidate')
    const second = (await store.read('ship-report', 'project', cwd))!
    const cleared = await store.write({ name: 'ship-report', title: 'Ship report', description: 'deliver the report', type: 'task', body: 'new details', expectedRevision: second.revision, clearTaskFields: ['dueAt', 'remindAt', 'priority', 'taskStatus'] }, 'project', cwd)
    expect(cleared?.dueAt).toBeUndefined()
    expect(cleared?.remindAt).toBeUndefined()
    expect(cleared?.priority).toBeUndefined()
    expect(cleared?.taskStatus).toBeUndefined()
    const raw = await fs.readFile(join(store.dir('project', cwd), 'ship-report.md'), 'utf8')
    expect(raw).not.toContain('dueAt:')
    expect(raw).not.toContain('remindAt:')
  })

  it('drops task fields from non-task records and rejects invalid values', async () => {
    const plain = await store.write({ name: 'plain-fact', description: 'a fact', type: 'project', body: 'body', dueAt: later, priority: 1 }, 'project', cwd)
    expect(plain?.dueAt).toBeUndefined()
    expect(plain?.priority).toBeUndefined()
    expect(await fs.readFile(join(store.dir('project', cwd), 'plain-fact.md'), 'utf8')).not.toContain('dueAt:')
    await expect(store.write(taskInput({ name: 'bad-due', dueAt: 0 }), 'project', cwd)).rejects.toThrow(/Invalid task dueAt/)
    await expect(store.write(taskInput({ name: 'bad-due-2', dueAt: 'tomorrow' as never }), 'project', cwd)).rejects.toThrow(/Invalid task dueAt/)
    await expect(store.write(taskInput({ name: 'bad-priority', priority: 9 }), 'project', cwd)).rejects.toThrow(/Invalid task priority/)
    await expect(store.write(taskInput({ name: 'bad-status', taskStatus: 'someday' as never }), 'project', cwd)).rejects.toThrow(/Invalid task status/)
  })

  it('keeps tasks out of the injection index; tasks remind without review', async () => {
    await store.write(taskInput(), 'project', cwd)
    expect(isRemindableTask((await store.read('ship-report', 'project', cwd))!)).toBe(true)
    await store.write({ ...taskInput(), status: 'verified' }, 'project', cwd)
    const verified = (await store.read('ship-report', 'project', cwd))!
    expect(verified.status).toBe('verified')
    expect(isRemindableTask(verified)).toBe(true)
    await store.write({ name: 'plain-fact', description: 'a fact', type: 'project', body: 'body' }, 'project', cwd)
    const index = await fs.readFile(join(store.dir('project', cwd), INDEX_FILENAME), 'utf8')
    expect(index).toContain('plain-fact.md')
    expect(index).not.toContain('ship-report.md')
    const injected = renderMemoryIndexDetail(store, { maxBytes: 4096, enableUserScope: false } as unknown as Parameters<typeof renderMemoryIndexDetail>[1], cwd)
    expect(injected.injected).toEqual(['plain-fact'])
    expect(injected.text).not.toContain('ship-report')
  })

  it('review() still updates a legacy record without touching its schedule fields', async () => {
    const created = (await store.write(taskInput({ status: undefined }), 'project', cwd))!
    expect(created.status).toBe('candidate')
    const reviewed = await store.review('ship-report', 'project', cwd, created.revision!, 'verified')
    expect(reviewed).toMatchObject({ status: 'verified', dueAt: later, remindAt: remind, priority: 2 })
    expect(isRemindableTask((await store.read('ship-report', 'project', cwd))!)).toBe(true)
  })
})

describe('model tools: reminders live in the native scheduler (v0.9.0)', () => {
  it('rejects the claim that a task is a memory record', async () => {
    const run = await tools()
    await expect(run('memory_write', taskInput())).rejects.toThrow(/invalid arguments: "type"/)
  })

  it('reports REMINDER_UNAVAILABLE when the host has no schedule service', async () => {
    const run = await tools()
    await expect(run('memory_remind', { title: '喝水' })).rejects.toThrow(/REMINDER_UNAVAILABLE/)
  })

  it('creates a reminder for the current session and cwd', async () => {
    const calls: Array<Record<string, unknown>> = []
    const run = await tools({ remind: async input => { calls.push(input as unknown as Record<string, unknown>); return { id: 'r1', title: input.title, timing: { kind: 'after', after_seconds: 60 }, prompt: 'p' } } })
    const created = await run('memory_remind', { title: '喝水', inSeconds: 90, prompt: '一趟' }) as { id: string; timing: unknown }
    expect(created.id).toBe('r1')
    expect(calls[0]).toMatchObject({ title: '喝水', inSeconds: 90, prompt: '一趟', sessionId: 'synthetic-task', cwd })
    await expect(run('memory_remind', { title: 'x', inSeconds: 60, dueAt: later })).rejects.toThrow(/mutually exclusive/)
  })

  it('delivers into a new session when asked', async () => {
    const calls: Array<Record<string, unknown>> = []
    const run = await tools({ remind: async input => { calls.push(input as unknown as Record<string, unknown>); return { id: 'r2', title: input.title, timing: { kind: 'after', after_seconds: 60 }, prompt: 'p' } } })
    await run('memory_remind', { title: '新会话', newSession: true })
    expect(calls[0]!.newSession).toBe(true)
  })

  it('asks instead of creating when the routing evidence is ambiguous', async () => {
    const calls: Array<Record<string, unknown>> = []
    const run = await tools({
      remind: async input => { calls.push(input as unknown as Record<string, unknown>); return { id: 'r3', title: input.title, timing: { kind: 'after', after_seconds: 60 }, prompt: 'p' } },
      routeReminder: () => ({ target: 'ask', reason: 'ambiguous:x', question: '本会话还是新会话？' }),
    })
    const result = await run('memory_remind', { title: 'x', inSeconds: 60 }) as { id?: string; needsConfirmation?: boolean; question?: string }
    expect(result).toMatchObject({ needsConfirmation: true, question: '本会话还是新会话？' })
    expect(result.id).toBeUndefined()
    expect(calls).toHaveLength(0)
  })

  it('follows a routed other-project cwd into a new session', async () => {
    const calls: Array<Record<string, unknown>> = []
    const run = await tools({
      remind: async input => { calls.push(input as unknown as Record<string, unknown>); return { id: 'r4', title: input.title, timing: { kind: 'after', after_seconds: 60 }, prompt: 'p' } },
      routeReminder: () => ({ target: 'new_once', cwd: 'D:\\other-project', reason: 'other-project:other' }),
    })
    await run('memory_remind', { title: 'x', inSeconds: 60 })
    expect(calls[0]).toMatchObject({ newSession: true, cwd: 'D:\\other-project', sessionId: 'synthetic-task' })
  })

  it('lists plugin reminders with times in the machine local time zone', async () => {
    const run = await tools({ listReminders: () => [
      { id: 'r2', title: '记忆提醒：刷牙', scheduledAt: '2026-11-09T14:30:00.000Z', active: true },
      { id: 'r1', title: '记忆提醒：发布检查', scheduledAt: '2026-11-09T05:52:00.000Z', active: true },
    ] })
    const listed = await run('memory_reminders', {}) as { timeZone: string; reminders: Array<{ id: string; title?: string; localTime?: string; scheduledAt?: string }> }
    expect(listed.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(listed.reminders.map(item => item.id)).toEqual(['r1', 'r2'])
    expect(listed.reminders[0]).toMatchObject({ title: '发布检查', scheduledAt: '2026-11-09T05:52:00.000Z' })
    expect(listed.reminders[0]!.localTime).toBeTruthy()
    expect(listed.reminders[0]!.localTime).not.toBe(listed.reminders[0]!.scheduledAt)
  })

  it('reports REMINDER_UNAVAILABLE when listing without a host schedule service', async () => {
    const run = await tools()
    await expect(run('memory_reminders', {})).rejects.toThrow(/REMINDER_UNAVAILABLE/)
  })
})

describe('management API: task fields', () => {
  it('rejects task writes and task fields over the API', async () => {
    const base = { scope: 'project', sessionId: 's1', name: 'ship-report', description: 'deliver the report', body: 'details', type: 'task', expectedRevision: null }
    const created = await call('memory.write', base)
    expect(created.status).toBe(400)
    expect(created.data.error).toMatch(/类型或审核选项无效/)
    const plain = await call('memory.write', { ...base, type: 'project', dueAt: later })
    expect(plain.status).toBe(400)
  })

  it('keeps legacy task records readable and listed', async () => {
    await store.write({ ...taskInput(), status: 'verified' }, 'project', cwd)
    const listed = await call('groups.list', { scope: 'project', sessionId: 's1' }, 'GET')
    expect(listed.status).toBe(200)
    expect((listed.data.records as Array<Record<string, unknown>>).map(record => record.name)).toContain('ship-report')
    const read = await call('memory.read', { scope: 'project', sessionId: 's1', name: 'ship-report' }, 'GET')
    expect(read.data).toMatchObject({ type: 'task', dueAt: later, taskStatus: 'open' })
  })
})

describe('sync and transfer keep task fields additive', () => {
  it('builds/verifies/applies changesets containing task fields', async () => {
    await store.write({ ...taskInput(), status: 'verified' }, 'project', cwd)
    const set = await buildChangeset(store, { scope: 'project', cwd, since: 0, deviceId: 'dev-aaaa' })
    expect(set.upserts[0]).toMatchObject({ type: 'task', dueAt: later, remindAt: remind, priority: 2, taskStatus: 'open' })
    expect(() => verifyChangeset({ ...set, checksum: undefined })).toThrow()
    expect(() => verifyChangeset(set)).not.toThrow()
    const targetRoot = await fs.mkdtemp(join(tmpdir(), 'wh-task-apply-'))
    const target = new MemoryStore(targetRoot)
    const result = await applyChangeset(target, set, { cwd, approvedChecksum: set.checksum })
    expect(result.created).toEqual(['ship-report'])
    const applied = (await target.read('ship-report', 'project', cwd))!
    expect(applied).toMatchObject({ type: 'task', dueAt: later, remindAt: remind, priority: 2, taskStatus: 'open', status: 'candidate' })
    await fs.rm(targetRoot, { recursive: true, force: true })
  })

  it('rejects task fields on non-task records and invalid values', () => {
    const base = { format: 'wh-sync-changeset', version: 1, deviceId: 'dev-aaaa', scope: 'project', since: 0, until: 1, upserts: [], deletions: [], producer: { name: 'dsh-auto-memory-wh', version: '0.5.0' } }
    expect(() => verifyChangeset({ ...base, upserts: [{ name: 'x', description: 'd', type: 'project', body: 'b', dueAt: later }], checksum: changesetChecksum({ ...base, upserts: [{ name: 'x', description: 'd', type: 'project', body: 'b', dueAt: later }] } as never) })).toThrow(/type=task/)
    expect(() => verifyChangeset({ ...base, upserts: [{ name: 'x', description: 'd', type: 'task', body: 'b', priority: 9 }], checksum: changesetChecksum({ ...base, upserts: [{ name: 'x', description: 'd', type: 'task', body: 'b', priority: 9 }] } as never) })).toThrow(/priority/)
  })

  it('exports and imports task fields without losing them', async () => {
    const record = (await store.write({ ...taskInput(), status: 'verified' }, 'project', cwd))!
    const pkg = buildExportPackage([record], { scope: 'project' })
    expect(pkg.records[0]).toMatchObject({ type: 'task', dueAt: later, remindAt: remind, priority: 2, taskStatus: 'open' })
    const verified = verifyExportPackage(JSON.parse(JSON.stringify(pkg)))
    expect(verified.records[0]).toMatchObject({ dueAt: later, taskStatus: 'open' })
    const targetRoot = await fs.mkdtemp(join(tmpdir(), 'wh-task-import-'))
    const target = new MemoryStore(targetRoot)
    const applied = await applyImport(target, verified, { cwd, approvedChecksum: verified.checksum })
    expect(applied.created).toEqual(['ship-report'])
    expect(await target.read('ship-report', 'project', cwd)).toMatchObject({ dueAt: later, remindAt: remind, priority: 2, taskStatus: 'open' })
    await fs.rm(targetRoot, { recursive: true, force: true })
  })
})

