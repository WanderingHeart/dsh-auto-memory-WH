import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { MemoryStore } from '../src/store.ts'
import { registerMemoryTools } from '../src/memory-tools.ts'
import { renderMemoryIndexDetail } from '../src/prompt.ts'
import { appendAudit, getAuditStatus, readAudit, registerInjectionAudit } from '../src/audit-log.ts'
import type { Config } from '../src/index.ts'
let root: string, store: MemoryStore, ctx: Context | undefined
const cwd = 'D:\\synthetic-A', cwdB = 'D:\\synthetic-B'
const config = { maxBytes: 4096, enableUserScope: true, staleAfterDays: 0 } as Config
const record = { name: 'alpha', description: '中文 synthetic fact', body: 'body only', type: 'project' as const }
beforeEach(async () => { root = await fs.mkdtemp(join(tmpdir(), 'wh-s04-')); store = new MemoryStore(root) })
afterEach(async () => { if (ctx) await ctx.fiber.dispose(); ctx = undefined; await fs.rm(root, { recursive: true, force: true }) })
describe('S04 strict native trust and budget', () => {
  it('refuses automatic injection from unknown future storage formats', async () => {
    await store.write({ ...record, status: 'verified' }, 'project', cwd)
    const marker = join(root, '.wh-format.json')
    const raw = JSON.stringify({ format: 'dsh-auto-memory-wh', version: 99 })
    await fs.writeFile(marker, raw)
    const detail = renderMemoryIndexDetail(store, config, cwd)
    expect(detail.text).toBe(''); expect(detail.issues.length).toBeGreaterThan(0)
    expect(await fs.readFile(marker, 'utf8')).toBe(raw)
  })
  it('new, legacy and externally changed records never inherit trust from cache', async () => {
    await store.write(record, 'project', cwd)
    expect((await store.read('alpha', 'project', cwd))?.status).toBe('candidate')
    expect(renderMemoryIndexDetail(store, config, cwd).text).toContain('alpha')
    const approved = await store.write({ ...record, status: 'verified' }, 'project', cwd)
    expect(approved?.reviewHash).toMatch(/^[a-f0-9]{64}$/)
    const file = join(store.dir('project', cwd), 'alpha.md')
    const original = await fs.readFile(file, 'utf8')
    await fs.writeFile(file, original.replace('body only', 'changed outside plugin'))
    await fs.writeFile(join(store.dir('project', cwd), 'MEMORY.md'), '[forged](forged.md)')
    expect((await store.read('alpha', 'project', cwd))?.status).toBe('candidate')
    expect(renderMemoryIndexDetail(store, config, cwd).text).toContain('alpha')
    await fs.writeFile(file, original.replace(/^reviewHash:.*\r?\n/m, ''))
    expect((await store.read('alpha', 'project', cwd))?.trustReason).toBe('review-hash-missing-or-changed')
  })
  it('semantic edits reset the trust state while the record stays injectable', async () => {
    await store.write({ ...record, status: 'verified' }, 'user')
    await store.write({ ...record, pinned: true }, 'user')
    expect((await store.read('alpha', 'user'))?.status).toBe('verified')
    await store.write({ ...record, title: 'new meaning' }, 'user')
    expect((await store.read('alpha', 'user'))?.status).toBe('candidate')
    expect(renderMemoryIndexDetail(store, config, cwd).text).toContain('alpha')
  })
  it('full escaped prompt respects every tiny/multibyte budget and gives distinct cross-scope ids', async () => {
    for (const scope of ['user', 'project'] as const) await store.write({ ...record, title: '<script>{{bad}}[link]', description: '中文🙂'.repeat(40), status: 'verified' }, scope, cwd)
    for (const maxBytes of [0, 1, 64, 255, 512, 1023, 2048, 4096]) {
      const detail = renderMemoryIndexDetail(store, { ...config, maxBytes }, cwd)
      expect(Buffer.byteLength(detail.text)).toBeLessThanOrEqual(maxBytes)
      expect(detail.textBytes).toBe(Buffer.byteLength(detail.text))
      expect(detail.text).not.toContain('<script>'); expect(detail.text).not.toContain('{{bad}}'); expect(detail.text).not.toContain('\uFFFD')
    }
    const full = renderMemoryIndexDetail(store, config, cwd)
    expect(new Set(full.records.map(r => r.id)).size).toBe(2)
    expect(full.records.every(r => /^[a-f0-9]{64}$/.test(r.revision))).toBe(true)
    expect(renderMemoryIndexDetail(store, { ...config, enableUserScope: false }, cwdB).text).toBe('')
  })
})
describe('S04 model tool boundary', () => {
  async function tools(enabled = true) {
    ctx = new Context(); await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, {}); registerMemoryTools(ctx, store, enabled)
    const exec = { agent: { session: { header: { cwd }, id: 'synthetic' } } } as any
    return (name: string, args: object, context = exec) => ctx!.tools.get(name)!.execute(args as never, context)
  }
  it('model cannot grant verification or bypass scope, revision or bulk limits', async () => {
    const run = await tools()
    await expect(run('memory_write', { ...record, status: 'verified' })).rejects.toThrow(/unknown field/)
    await expect(run('memory_write', record, {})).rejects.toThrow(/SCOPE_DENIED/)
    await run('memory_write', record)
    await expect(run('memory_write', { ...record, body: 'overwrite' })).rejects.toThrow(/revision/)
    const read = await run('memory_read', { name: 'alpha' }) as any
    expect(read.status).toBe('candidate')
    await run('memory_write', { ...record, body: 'changed', expectedRevision: read.revision })
    await expect(run('memory_delete', { name: 'alpha', expectedRevision: read.revision })).rejects.toThrow(/Revision conflict/)
    expect((await run('memory_search', { query: '中文' }) as any).matches).toHaveLength(1)
    expect((await run('memory_list', { scope: 'user' }) as any).total).toBe(0)
    expect(ctx!.tools.schemas().map(s => s.name)).not.toContain('memory_delete_all')
  })
  it('disabled user scope is enforced for reads/searches and writes', async () => {
    const run = await tools(false)
    for (const [name, args] of [['memory_write', record], ['memory_list', {}], ['memory_search', { query: 'x' }], ['memory_read', { name: 'alpha' }]] as const) await expect(run(name, { ...args, scope: 'user' })).rejects.toThrow(/SCOPE_DENIED/)
  })
  it('supports cross-session relevance and explicit name sorting in memory_list', async () => {
    const day = 86_400_000
    await store.write({ name: 'aaa-old', description: 'old', body: 'b', type: 'project', status: 'verified', lastReadMs: Date.now() - 120 * day }, 'project', cwd)
    await store.write({ name: 'zzz-new', description: 'new', body: 'b', type: 'project', status: 'verified', lastReadMs: Date.now() }, 'project', cwd)
    const run = await tools()
    const relevance = await run('memory_list', { sort: 'relevance' }) as any
    expect(relevance.memories.map((memory: { name: string }) => memory.name)).toEqual(['zzz-new', 'aaa-old'])
    const byName = await run('memory_list', { sort: 'name' }) as any
    expect(byName.memories.map((memory: { name: string }) => memory.name)).toEqual(['aaa-old', 'zzz-new'])
    await expect(run('memory_list', { sort: 'bogus' })).rejects.toThrow(/sort/)
  })
})
describe('S04 bounded audit', () => {
  it('records each attempt without raw paths, session, body or query', async () => {
    await store.write({ ...record, status: 'verified' }, 'project', cwd)
    const audit = registerInjectionAudit(store, config, root, () => 'secret-question')
    audit.text(cwd, 'secret-session'); audit.text(cwd, 'secret-session'); await audit.flush()
    const entries = await readAudit(root)
    expect(entries).toHaveLength(2); expect(entries[0].eventId).not.toBe(entries[1].eventId)
    const raw = await fs.readFile(join(root, 'audit.jsonl'), 'utf8')
    for (const secret of [cwd, 'secret-session', 'body only', 'secret-question']) expect(raw).not.toContain(secret)
    expect(entries.every(e => e.kind === 'render_attempt')).toBe(true)
  })
  it('rotates by bytes/age, repairs malformed tail, and exposes failures', async () => {
    await store.write(record, 'user')
    const entry = { ts: Date.now(), sessionId: 'hash', cwd: 'hash', injected: ['alpha'], truncated: [], bytes: 1 }
    await fs.writeFile(join(root, 'audit.jsonl'), JSON.stringify({ ...entry, ts: 1 }) + '\ninvalid-tail')
    for (let i = 0; i < 20; i++) await appendAudit(root, { ...entry, eventId: String(i) }, { maxBytes: 512, retentionDays: 1 })
    expect((await fs.stat(join(root, 'audit.jsonl'))).size).toBeLessThanOrEqual(512)
    expect((await readAudit(root)).every(e => e.ts > 1)).toBe(true)
    expect(getAuditStatus(root).repairedLines).toBeGreaterThan(0)
    await appendAudit(root, { ...entry, injected: ['x'.repeat(1000)] }, { maxBytes: 512 })
    expect(getAuditStatus(root)).toMatchObject({ degraded: true, dropped: 1, pending: 0 })
    await appendAudit(root, entry)
    expect(getAuditStatus(root).lastError).toBeNull()
  })
})
