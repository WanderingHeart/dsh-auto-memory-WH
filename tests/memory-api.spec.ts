/** Production routes with a synthetic authenticated carrier; real Desktop auth is a separate gate. */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { MemoryStore } from '../src/store.ts'
import { registerMemoryApi } from '../src/memory-api.ts'
import { renderMemoryIndexDetail } from '../src/prompt.ts'
import type { Config } from '../src/index.ts'
let root: string, store: MemoryStore
let routes: Map<string, (r: Request) => Promise<Response>>
const cwd = 'D:\\synthetic-project', other = 'D:\\another-project'
const sample = { scope: 'project', sessionId: 's1', name: 'alpha', description: 'synthetic description', body: 'synthetic body', type: 'project', expectedRevision: null }
function mount(enableUserScope = true, authenticated = true) {
  routes = new Map()
  const connection = { requestRejection: authenticated ? (r: Request) => r.headers.has('deny') ? 403 : undefined : undefined,
    fetch: { register: (route: { path: string; fetch: (r: Request) => Promise<Response> }) => { routes.set(route.path.split('/').pop()!, route.fetch); return () => {} } } }
  registerMemoryApi({ get: () => connection } as unknown as Context, store, root, { maxBytes: 4096, enableUserScope, resolveProject: id => ({ s1: cwd, s2: other } as Record<string, string>)[id], listProjects: () => [{ id: 's1', cwd }, { id: 's2', cwd: other }, { id: 'stale', cwd }] })
}
async function call(route: string, data: Record<string, unknown>, method = 'POST', headers: Record<string, string> = {}) {
  const url = 'http://local/api/auto-memory-wh/' + route
  const request = method === 'GET' ? new Request(url + '?' + new URLSearchParams(data as Record<string, string>), { headers }) : new Request(url, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) })
  const response = await routes.get(route)!(request)
  return { status: response.status, data: await response.json() as any }
}
beforeEach(async () => { root = await fs.mkdtemp(join(tmpdir(), 'wh-api-')); store = new MemoryStore(root); mount() })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })
describe('WH management boundary', () => {
  it('lists only host-confirmed active project sessions', async () => {
    const active = await call('sessions.active', {}, 'GET')
    expect(active.status).toBe(200)
    expect(active.data.sessions).toEqual([{ id: 's1', cwd }, { id: 's2', cwd: other }])
    expect((await call('sessions.active', { cwd }, 'GET')).status).toBe(400)
    expect((await call('sessions.active', {}, 'GET', { deny: '1' })).status).toBe(403)
  })
  it('requires carrier authentication and fails closed without it', async () => {
    expect((await call('memory.write', sample, 'POST', { deny: '1' })).status).toBe(403)
    mount(true, false)
    expect((await call('memory.write', sample)).status).toBe(503)
    expect(await store.read('alpha', 'project', cwd)).toBeNull()
  })
  it('rejects unknown sessions, arbitrary cwd, status grants and retired bulk/import routes', async () => {
    expect((await call('memory.write', { ...sample, sessionId: 'unknown' })).status).toBe(403)
    expect((await call('memory.write', { ...sample, cwd: other })).status).toBe(400)
    expect((await call('memory.write', { ...sample, status: 'verified' })).status).toBe(400)
    expect([...routes.keys()].some(name => /claude|delete_all|prune/.test(name))).toBe(false)
  })
  it('candidate creation, explicit review, metadata preservation and stale editor conflict', async () => {
    const created = await call('memory.write', sample)
    expect(created.status).toBe(200); expect(created.data.record.status).toBe('candidate')
    const target = { scope: 'project', sessionId: 's1', name: 'alpha', expectedRevision: created.data.record.revision }
    expect((await call('memory.review', { ...target, status: 'verified', confirm: false })).status).toBe(400)
    const reviewed = await call('memory.review', { ...target, status: 'verified', confirm: true })
    expect(reviewed.data.record.status).toBe('verified')
    expect(renderMemoryIndexDetail(store, { maxBytes: 4096, enableUserScope: false } as Config, cwd).injected).toEqual(['alpha'])
    const patched = await call('memory.patch', { ...target, expectedRevision: reviewed.data.record.revision, pinned: true })
    expect(patched.data.record.status).toBe('verified')
    expect((await call('memory.write', { ...sample, body: 'stale replacement', expectedRevision: created.data.record.revision })).status).toBe(409)
    expect((await store.read('alpha', 'project', cwd))?.body).toBe('synthetic body')
    const changed = await call('memory.write', { ...sample, title: 'changed title', expectedRevision: patched.data.record.revision })
    expect(changed.data.record.status).toBe('candidate')
  })
  it('hides superseded records from the default list but keeps them filterable', async () => {
    const created = await call('memory.write', sample)
    const successor = await call('memory.write', { ...sample, name: 'beta', description: 'successor description' })
    await store.supersede('alpha', 'project', cwd, created.data.record.revision, 'beta')
    const listed = await call('groups.list', { scope: 'project', sessionId: 's1' }, 'GET')
    expect(listed.data.records.map((r: { name: string }) => r.name)).toEqual(['beta'])
    const filtered = await call('groups.list', { scope: 'project', sessionId: 's1', status: 'superseded' }, 'GET')
    expect(filtered.data.records.map((r: { name: string }) => r.name)).toEqual(['alpha'])
    expect(successor.status).toBe(200)
  })
  it('enforces user disable and per-project reads, exports and pagination', async () => {
    await call('memory.write', sample); await call('memory.write', { ...sample, name: 'beta' })
    const page = await call('groups.list', { scope: 'project', sessionId: 's1', limit: 1, offset: 1 }, 'GET')
    expect(page.data.total).toBe(2); expect(page.data.records).toHaveLength(1); expect(page.data.records[0].body).toBeUndefined()
    expect((await call('groups.list', { scope: 'project', sessionId: 's2' }, 'GET')).data.total).toBe(0)
    expect((await call('memory.read', { scope: 'project', sessionId: 's2', name: 'alpha' }, 'GET')).status).toBe(404)
    const exported = await call('export.markdown', { scope: 'project', sessionId: 's1' }, 'GET')
    expect(exported.data.files).toHaveLength(2); expect(exported.data.includesAudit).toBe(false)
    expect(exported.data.files[0].bytes).toBe(Buffer.byteLength(exported.data.files[0].content))
    mount(false); expect((await call('groups.list', { scope: 'user' }, 'GET')).status).toBe(403)
  })
  it('archives with CAS and refuses altered archive hash', async () => {
    const created = await call('memory.write', sample)
    const deleted = await call('memory.delete', { scope: 'project', sessionId: 's1', name: 'alpha', expectedRevision: created.data.record.revision })
    expect(deleted.status).toBe(200)
    const archive = (await call('archive.list', { scope: 'project', sessionId: 's1' }, 'GET')).data.archives[0]
    expect(archive.id).toBe(deleted.data.archiveId)
    const restore = { scope: 'project', sessionId: 's1', id: archive.id, expectedHash: archive.hash }
    expect((await call('archive.restore', { ...restore, expectedHash: '0'.repeat(64) })).status).toBe(409)
    expect((await call('archive.restore', restore)).status).toBe(200)
    expect((await store.read('alpha', 'project', cwd))?.body).toBe('synthetic body')
  })
  it('rejects oversized requests without partial writes', async () => {
    expect((await call('memory.write', { ...sample, body: 'x'.repeat(40000) })).status).toBe(413)
    expect(await store.read('alpha', 'project', cwd)).toBeNull()
  })
})

describe('merge suggestions and merge apply', () => {
  async function seed() {
    for (const [name, body] of [['ts-build', 'typescript build pipeline uses esbuild bundling'], ['ts-build-notes', 'typescript build pipeline also bundles tests with esbuild']] as const) {
      await store.write({ name, description: body, body, type: 'reference', status: 'verified' }, 'project', cwd)
    }
    const first = (await store.read('ts-build', 'project', cwd))!
    const second = (await store.read('ts-build-notes', 'project', cwd))!
    return [{ name: first.name, revision: first.revision }, { name: second.name, revision: second.revision }]
  }
  it('suggests clusters and requires confirmation', async () => {
    const members = await seed()
    const suggest = await call('memory.mergeSuggest', { scope: 'project', sessionId: 's1', minShared: 2 })
    expect(suggest.status).toBe(200)
    expect(suggest.data.clusters).toHaveLength(1)
    expect(suggest.data.clusters[0].suggestedName).toBeTruthy()
    const refused = await call('memory.merge', { scope: 'project', sessionId: 's1', name: 'ts-merged', type: 'reference', members })
    expect(refused.status).toBe(400)
    expect(await store.read('ts-merged', 'project', cwd)).toBeNull()
  })
  it('creates a candidate target, supersedes sources and writes an audit event', async () => {
    const members = await seed()
    const applied = await call('memory.merge', { scope: 'project', sessionId: 's1', name: 'ts-merged', type: 'reference', members, confirm: true })
    expect(applied.status).toBe(200)
    expect(applied.data.target.status).toBe('candidate')
    const first = (await store.read('ts-build', 'project', cwd))!
    const second = (await store.read('ts-build-notes', 'project', cwd))!
    expect(first).toMatchObject({ status: 'superseded', supersededBy: 'ts-merged' })
    expect(second).toMatchObject({ status: 'superseded', supersededBy: 'ts-merged' })
    const merged = (await store.read('ts-merged', 'project', cwd))!
    expect(merged.body).toContain('## 来自 ts-build')
    expect(merged.body).toContain('## 来自 ts-build-notes')
    expect(merged.status).toBe('candidate')
    const audit = await (await import('../src/audit-log.ts')).readAudit(root)
    expect(audit.some(entry => entry.kind === 'merge_apply' && entry.target === 'ts-merged')).toBe(true)
  })
  it('ignores superseded records when scanning for duplicates and clusters', async () => {
    await seed()
    const first = (await store.read('ts-build', 'project', cwd))!
    await store.supersede('ts-build', 'project', cwd, first.revision!, 'ts-build-notes')
    const duplicates = await call('memory.duplicates', { scope: 'project', sessionId: 's1', threshold: 0.8 })
    expect(duplicates.status).toBe(200)
    expect(duplicates.data.groups).toHaveLength(0)
    const suggest = await call('memory.mergeSuggest', { scope: 'project', sessionId: 's1', minShared: 2 })
    expect(suggest.status).toBe(200)
    expect(suggest.data.clusters).toHaveLength(0)
  })
  it('skips stale superseded members instead of aborting the whole merge', async () => {
    await seed()
    const stale = (await store.read('ts-build', 'project', cwd))!
    await store.supersede('ts-build', 'project', cwd, stale.revision!, 'ts-build-notes')
    const notes = (await store.read('ts-build-notes', 'project', cwd))!
    const applied = await call('memory.merge', { scope: 'project', sessionId: 's1', name: 'ts-merged', type: 'reference', members: [{ name: stale.name, revision: stale.revision }, { name: notes.name, revision: notes.revision }], confirm: true })
    expect(applied.status).toBe(200)
    expect(applied.data.target).toBeNull()
    expect(applied.data.skipped).toContain('ts-build')
    expect(await store.read('ts-merged', 'project', cwd)).toBeNull()
  })
  it('merges the active members when one source is already superseded', async () => {
    await seed()
    await store.write({ name: 'ts-build-extra', description: 'typescript build pipeline extra notes', body: 'typescript build pipeline extra notes', type: 'reference', status: 'verified' }, 'project', cwd)
    const extra = (await store.read('ts-build-extra', 'project', cwd))!
    const first = (await store.read('ts-build', 'project', cwd))!
    await store.supersede('ts-build', 'project', cwd, first.revision!, 'ts-build-notes')
    const notes = (await store.read('ts-build-notes', 'project', cwd))!
    const applied = await call('memory.merge', { scope: 'project', sessionId: 's1', name: 'ts-merged', type: 'reference', members: [{ name: first.name, revision: first.revision }, { name: notes.name, revision: notes.revision }, { name: extra.name, revision: extra.revision }], confirm: true })
    expect(applied.status).toBe(200)
    expect(applied.data.target).not.toBeNull()
    expect(applied.data.merged.sort()).toEqual(['ts-build-extra', 'ts-build-notes'])
    expect(applied.data.skipped).toContain('ts-build')
  })
})

describe('process metrics route', () => {
  it('reports in-process write counters and storage snapshot', async () => {
    await store.write({ name: 'metrics-one', description: 'metrics sample', body: 'metrics sample body', type: 'reference', status: 'verified' }, 'project', cwd)
    const res = await call('memory.metrics', { scope: 'project', sessionId: 's1' })
    expect(res.status).toBe(200)
    expect(res.data.metrics.writes).toBeGreaterThanOrEqual(1)
    expect(res.data.metrics.avgWriteMs).toBeGreaterThanOrEqual(0)
    expect(res.data.audit).toMatchObject({ degraded: false })
    expect(res.data.storage.root).toBe(root)
  })
})

describe('transfer routes', () => {
  it('exports a checksummed package and plans an import', async () => {
    await store.write({ name: 'wire-alpha', description: 'wire sample', body: 'wire body', type: 'reference', status: 'verified' }, 'project', cwd)
    const exported = await call('export.package', { scope: 'project', sessionId: 's1' })
    expect(exported.status).toBe(200)
    expect(exported.data.format).toBe('wh-memory-export')
    expect(exported.data.checksum).toMatch(/^[0-9a-f]{64}$/)
    const planned = await call('import.plan', { scope: 'project', sessionId: 's1', package: exported.data })
    expect(planned.status).toBe(200)
    expect(planned.data.skipped).toContain('wire-alpha')
    const refused = await call('import.apply', { scope: 'project', sessionId: 's1', package: exported.data })
    expect(refused.status).toBe(400)
  })
  it('can keep both sides when an import conflicts with reviewed content', async () => {
    await store.write({ name: 'wire-alpha', description: 'wire sample', body: 'wire body', type: 'reference', status: 'verified' }, 'project', cwd)
    const exported = await call('export.package', { scope: 'project', sessionId: 's1' })
    const { exportChecksum } = await import('../src/transfer.ts')
    const changed = { ...exported.data, records: (exported.data.records as Array<Record<string, unknown>>).map(record => record.name === 'wire-alpha' ? { ...record, body: 'wire body from another device' } : record) }
    changed.checksum = exportChecksum(changed.records as never, 'project')
    const forked = await call('import.apply', { scope: 'project', sessionId: 's1', package: changed, approvedChecksum: changed.checksum, onConflict: 'fork' })
    expect(forked.status).toBe(200)
    expect(forked.data.conflicts).toEqual([])
    expect(forked.data.forked).toHaveLength(1)
    expect((await store.read('wire-alpha', 'project', cwd))?.body).toBe('wire body')
    expect((await store.read(forked.data.forked[0], 'project', cwd))?.body).toBe('wire body from another device')
  })
})
