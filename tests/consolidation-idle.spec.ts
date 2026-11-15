import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { registerConsolidation, type ConsolidationOptions } from '../src/consolidate.ts'
import { MemoryStore } from '../src/store.ts'

type Handler = (...args: unknown[]) => unknown

const bus = () => {
  const handlers = new Map<string, Handler[]>()
  return {
    on(name: string, handler: Handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler])
    },
    emit(name: string, ...args: unknown[]) {
      for (const handler of handlers.get(name) ?? []) handler(...args)
    },
  }
}

const candidateJson = JSON.stringify([
  { name: 'idle-note', title: '闲置固化', description: '会话闲置后固化的记录', type: 'project', body: '正文', userSummary: '用户有项目调试经验。' },
])

const llmStub = () => {
  const calls: GenerateOptions[] = []
  return {
    calls,
    llm: {
      async *stream(request: GenerateOptions) {
        calls.push(request)
        yield { type: 'block-start' as const, index: 0, blockType: 'text' as const }
        yield { type: 'text-delta' as const, index: 0, text: candidateJson }
        yield { type: 'finish' as const, reason: 'stop' as const }
      },
    },
  }
}

const options = (overrides: Partial<ConsolidationOptions> = {}): ConsolidationOptions => ({
  autoSummarize: true,
  autoSummarizeMaxMemories: 5,
  autoSummarizeMaxTokens: 512,
  autoSummarizeMinTurns: 1,
  autoSummarizeMinChars: 0,
  autoSummarizeDedupe: true,
  autoSummarizeIdleMinutes: 60,
  enableUserScope: true,
  minImportance: 0,
  ...overrides,
})

const userEvent = (text: string) => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const assistantEvent = (text: string) => ({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } })

describe('consolidation idle trigger (v0.12.3)', () => {
  let root: string | undefined

  afterEach(async () => {
    vi.useRealTimers()
    if (root !== undefined) await rm(root, { recursive: true, force: true })
    root = undefined
  })

  const setup = async (overrides: Partial<ConsolidationOptions> = {}, useRegistry = false) => {
    root = await mkdtemp(join(tmpdir(), 'dsh-auto-memory-idle-'))
    const events = bus()
    const stub = llmStub()
    const ctx = {
      on: (name: string, handler: Handler) => { events.on(name, handler) },
      get: (name: string) => (name === 'llm' ? stub.llm : undefined),
      logger: { info: vi.fn(), warn: vi.fn() },
      effect: vi.fn(),
    } as unknown as Context
    const store = new MemoryStore(root)
    const session = { id: 's1', header: { cwd: root, delegationDepth: 0 } }
    const agent = { session, options: { provider: 'provider-a', model: 'model-a', subagentDepth: 0 } }
    const handle = useRegistry
      ? (() => {
          const registryCtx = {
            on: (name: string, handler: Handler) => { events.on(name, handler) },
            get: (name: string) => (name === 'llm' ? stub.llm : undefined),
            agents: { get: (id: string) => (id === 's1' ? agent : undefined) },
            logger: { info: vi.fn(), warn: vi.fn() },
            effect: vi.fn(),
          } as unknown as Context
          return registerConsolidation(registryCtx, store, options(overrides))
        })()
      : registerConsolidation(ctx, store, options(overrides))
    return { root, events, stub, store, handle, session, agent }
  }

  it('consolidates once after the idle window while the session stays open', async () => {
    vi.useFakeTimers()
    const { events, stub, store, handle, session, agent, root: cwd } = await setup()

    events.emit('agent/created', { agent })
    events.emit('session/event', session, userEvent('帮我记住：周末去西湖'))
    events.emit('session/event', session, assistantEvent('好的，已记下'))

    await vi.advanceTimersByTimeAsync(3_599_000)
    expect(stub.calls).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(2_000)
    await handle.flush()

    expect(stub.calls).toHaveLength(1)
    expect(await store.list('project', cwd)).toHaveLength(1)
    expect((await store.list('user', cwd))[0]?.body).toBe('用户有项目调试经验。')
    expect(handle.stats()).toMatchObject({ enabled: true, idleMinutes: 60, runs: 1, lastOutcome: 'written' })

    // Disposal after an idle run must not consolidate the same transcript again.
    events.emit('agent/disposed', { agent })
    await handle.flush()
    expect(stub.calls).toHaveLength(1)
    expect(handle.stats().runs).toBe(1)
  })

  it('restarts the idle window when the conversation continues', async () => {
    vi.useFakeTimers()
    const { events, stub, handle, session, agent } = await setup()

    events.emit('agent/created', { agent })
    events.emit('session/event', session, userEvent('第一条'))

    await vi.advanceTimersByTimeAsync(1_800_000)
    events.emit('session/event', session, assistantEvent('回复'))
    await vi.advanceTimersByTimeAsync(1_800_000)
    expect(stub.calls).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1_800_001)
    await handle.flush()
    expect(stub.calls).toHaveLength(1)
  })

  it('does not arm the timer when idleMinutes is 0', async () => {
    vi.useFakeTimers()
    const { events, stub, handle, session, agent } = await setup({ autoSummarizeIdleMinutes: 0 })

    events.emit('agent/created', { agent })
    events.emit('session/event', session, userEvent('只在结束时固化'))
    await vi.advanceTimersByTimeAsync(3_600_000)
    await handle.flush()
    expect(stub.calls).toHaveLength(0)
    expect(handle.stats().idleMinutes).toBe(0)
  })

  it('falls back to the live agent registry when agent/created was missed', async () => {
    vi.useFakeTimers()
    // 插件晚于会话恢复加载:没有 agent/created,只有宿主注册表。
    const { events, stub, store, handle, session, root: cwd } = await setup({}, true)

    events.emit('session/event', session, userEvent('帮我记住:明天交报告'))

    // 没有 agent/created;路由由 resolveRoute 从宿主注册表补取(这里的 session/event 已经触发过)。
    expect(handle.diagnostics()).toMatchObject({ captures: 1, routes: 1, agents: 0, autoSummarize: true })
    const rows = handle.recent(3)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 's1', cwd })
    expect(await handle.summarize('s1' as never)).toEqual({ ok: true })
    expect(stub.calls).toHaveLength(1)
    expect(await store.list('project', cwd)).toHaveLength(1)
    expect((await store.list('user', cwd))[0]?.body).toBe('用户有项目调试经验。')
  })

  it('falls back to the session request header when agent/created was missed', async () => {
    vi.useFakeTimers()
    // 插件晚于会话恢复加载:没有 agent/created,注册表也查不到,只有会话日志里的请求头。
    const { events, stub, store, handle, root: cwd } = await setup()
    const session = {
      id: 's2',
      header: { cwd, delegationDepth: 0 },
      requestHeader: () => ({ config: { provider: 'provider-b', model: 'model-b' } }),
    }

    events.emit('session/event', session, userEvent('帮我记住:周五开组会'))

    expect(handle.diagnostics()).toMatchObject({ captures: 1, routes: 1, agents: 0, autoSummarize: true })
    expect(handle.recent(3).map(row => row.id)).toEqual(['s2'])
    expect(await handle.summarize('s2' as never)).toEqual({ ok: true })
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]).toMatchObject({ provider: 'provider-b', model: 'model-b' })
    expect(await store.list('project', cwd)).toHaveLength(1)
    expect((await store.list('user', cwd))[0]?.body).toBe('用户有项目调试经验。')
  })

  it('survives a host registry that throws for unknown sessions', async () => {
    vi.useFakeTimers()
    // 注册表对未知会话抛错时,面板查询不能变成 IO_ERROR;请求头兜底仍要能列出会话。
    root = await mkdtemp(join(tmpdir(), 'dsh-auto-memory-idle-'))
    const events = bus()
    const stub = llmStub()
    const ctx = {
      on: (name: string, handler: Handler) => { events.on(name, handler) },
      get: (name: string) => (name === 'llm' ? stub.llm : undefined),
      agents: {
        get: () => { throw new Error('unknown session') },
        list: () => { throw new Error('unknown registry') },
      },
      logger: { info: vi.fn(), warn: vi.fn() },
      effect: vi.fn(),
    } as unknown as Context
    const store = new MemoryStore(root)
    const session = {
      id: 's3',
      header: { cwd: root, delegationDepth: 0 },
      requestHeader: () => ({ config: { provider: 'provider-c', model: 'model-c' } }),
    }
    const handle = registerConsolidation(ctx, store, options())

    events.emit('session/event', session, userEvent('帮我记住:下周一交材料'))

    expect(() => handle.diagnostics()).not.toThrow()
    expect(handle.diagnostics()).toMatchObject({ captures: 1, routes: 1, agents: 0 })
    expect(handle.recent(3).map(row => row.id)).toEqual(['s3'])
    expect(await handle.summarize('s3' as never)).toEqual({ ok: true })
    expect(stub.calls).toHaveLength(1)
  })

  it('lists pending sessions and summarizes one on demand', async () => {    vi.useFakeTimers()
    const { events, stub, store, handle, session, agent, root: cwd } = await setup()

    events.emit('agent/created', { agent })
    events.emit('session/event', session, userEvent('帮我记住：明天交报告'))

    const rows = handle.recent(3)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 's1', lines: 1 })

    // 手动触发不等待闲置窗口；成功后再点应得到“没有新内容”。
    expect(await handle.summarize('s1' as never)).toEqual({ ok: true })
    expect(stub.calls).toHaveLength(1)
    expect(await store.list('project', cwd)).toHaveLength(1)
    expect((await store.list('user', cwd))[0]?.body).toBe('用户有项目调试经验。')
    expect(handle.recent(3)).toHaveLength(0)
    expect(await handle.summarize('s1' as never)).toEqual({ ok: false, reason: 'nothing-new' })
    expect(await handle.summarize('missing' as never)).toEqual({ ok: false, reason: 'unknown-session' })
  })

  it('lists sessions straight from the host session store without any event capture', async () => {
    vi.useFakeTimers()
    // 插件晚于会话恢复加载、且 session/event 未送达时,面板仍应能从宿主的
    // 会话日志重建对话(0.12.6 修复:总结不再依赖事件缓冲)。
    root = await mkdtemp(join(tmpdir(), 'dsh-auto-memory-idle-'))
    const events = bus()
    const stub = llmStub()
    const live = {
      id: 's4',
      header: { cwd: root, delegationDepth: 0 },
      requestHeader: () => ({ config: { provider: 'provider-d', model: 'model-d' } }),
      snapshotEvents: () => [
        { type: 'user/message', time: Date.now() - 5_000, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我记住:周三体检' }] } },
        { type: 'assistant/message', time: Date.now() - 4_000, data: { message: { content: [{ type: 'text', text: '好的' }] } } },
      ],
    }
    const sessions = { list: () => [live], get: (id: string) => (id === 's4' ? live : undefined) }
    const ctx = {
      on: (name: string, handler: Handler) => { events.on(name, handler) },
      get: (name: string) => (name === 'llm' ? stub.llm : name === 'sessions' ? sessions : undefined),
      logger: { info: vi.fn(), warn: vi.fn() },
      effect: vi.fn(),
    } as unknown as Context
    const store = new MemoryStore(root)
    const handle = registerConsolidation(ctx, store, options())

    // 没有任何 session/event。
    expect(handle.diagnostics()).toMatchObject({ captures: 1, routes: 1, autoSummarize: true })
    const rows = handle.recent(3)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 's4', lines: 2, title: '帮我记住:周三体检' })
    expect(await handle.summarize('s4' as never)).toEqual({ ok: true })
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]).toMatchObject({ provider: 'provider-d', model: 'model-d' })
    expect(await store.list('project', root)).toHaveLength(1)
    expect((await store.list('user', root))[0]?.body).toBe('用户有项目调试经验。')
    // 固化后不再列出,再次总结得到 nothing-new。
    expect(handle.recent(3)).toHaveLength(0)
    expect(await handle.summarize('s4' as never)).toEqual({ ok: false, reason: 'nothing-new' })
  })
})
