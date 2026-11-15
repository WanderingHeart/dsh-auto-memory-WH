import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../src/store.ts'
import { applyChangeset, buildChangeset, changesetChecksum, verifyChangeset } from '../src/sync.ts'

const cwd = 'C:/synthetic-sync-project'
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('sync changeset v1', () => {
  let rootA: string
  let rootB: string
  let a: MemoryStore
  let b: MemoryStore
  beforeEach(async () => {
    rootA = await mkdtemp(join(tmpdir(), 'wh-sync-a-'))
    rootB = await mkdtemp(join(tmpdir(), 'wh-sync-b-'))
    a = new MemoryStore(rootA)
    b = new MemoryStore(rootB)
    await a.write({ name: 'alpha', description: 'alpha one', body: 'alpha body one', type: 'reference', status: 'verified' }, 'project', cwd)
    await a.write({ name: 'beta', description: 'beta one', body: 'beta body one', type: 'user' }, 'project', cwd)
    await sleep(5)
  })
  it('exports upserts since a cursor and imports them as candidates', async () => {
    const built = await buildChangeset(a, { scope: 'project', cwd, since: 0, deviceId: 'device-a' })
    expect(built.upserts.map(record => record.name).sort()).toEqual(['alpha', 'beta'])
    expect(built.checksum).toMatch(/^[0-9a-f]{64}$/)
    const applied = await applyChangeset(b, verifyChangeset(JSON.parse(JSON.stringify(built))), { cwd, approvedChecksum: built.checksum })
    expect(applied.created.sort()).toEqual(['alpha', 'beta'])
    expect((await b.read('alpha', 'project', cwd))?.status).toBe('candidate')
    expect((await b.read('beta', 'project', cwd))?.body).toBe('beta body one')
  })
  it('is idempotent for unchanged content', async () => {
    const built = await buildChangeset(a, { scope: 'project', cwd, since: 0, deviceId: 'device-a' })
    await applyChangeset(b, built, { cwd, approvedChecksum: built.checksum })
    const again = await applyChangeset(b, built, { cwd, approvedChecksum: built.checksum })
    expect(again.skipped.sort()).toEqual(['alpha', 'beta'])
    expect(again.created).toEqual([])
  })
  it('propagates updates after the cursor', async () => {
    const first = await buildChangeset(a, { scope: 'project', cwd, since: 0, deviceId: 'device-a' })
    await applyChangeset(b, first, { cwd, approvedChecksum: first.checksum })
    await sleep(5)
    const current = (await a.read('beta', 'project', cwd))!
    await a.write({ name: 'beta', description: 'beta two', body: 'beta body two', type: 'user', expectedRevision: current.revision }, 'project', cwd)
    const second = await buildChangeset(a, { scope: 'project', cwd, since: first.until, deviceId: 'device-a' })
    expect(second.upserts.map(record => record.name)).toContain('beta')
    const applied = await applyChangeset(b, second, { cwd, approvedChecksum: second.checksum })
    expect(applied.updated).toContain('beta')
    expect((await b.read('beta', 'project', cwd))?.body).toBe('beta body two')
  })
  it('propagates deletions as archives', async () => {
    const first = await buildChangeset(a, { scope: 'project', cwd, since: 0, deviceId: 'device-a' })
    await applyChangeset(b, first, { cwd, approvedChecksum: first.checksum })
    await sleep(5)
    const current = (await a.read('beta', 'project', cwd))!
    await a.deleteVersioned('beta', 'project', cwd, current.revision!)
    const second = await buildChangeset(a, { scope: 'project', cwd, since: first.until, deviceId: 'device-a' })
    expect(second.deletions.map(entry => entry.name)).toEqual(['beta'])
    const applied = await applyChangeset(b, second, { cwd, approvedChecksum: second.checksum })
    expect(applied.archived).toEqual(['beta'])
    expect(await b.read('beta', 'project', cwd)).toBeNull()
    expect((await b.listArchive('project', cwd)).some(entry => entry.name === 'beta.md')).toBe(true)
  })
  it('refuses to overwrite reviewed content unless explicitly remote-wins', async () => {
    const built = await buildChangeset(a, { scope: 'project', cwd, since: 0, deviceId: 'device-a' })
    const local = await b.write({ name: 'alpha', description: 'local reviewed', body: 'local body', type: 'reference', status: 'verified' }, 'project', cwd)
    const refused = await applyChangeset(b, built, { cwd, approvedChecksum: built.checksum })
    expect(refused.conflicts).toContain('alpha')
    expect((await b.read('alpha', 'project', cwd))?.body).toBe('local body')
    const forced = await applyChangeset(b, built, { cwd, approvedChecksum: built.checksum, onConflict: 'remote' })
    expect(forced.updated).toContain('alpha')
    expect((await b.read('alpha', 'project', cwd))?.body).toBe('alpha body one')
    expect(local?.status).toBe('verified')
  })
  it('refuses to overwrite a locally edited candidate (rc.11)', async () => {
    const built = await buildChangeset(a, { scope: 'project', cwd, since: 0, deviceId: 'device-a' })
    await sleep(5)
    await b.write({ name: 'alpha', description: 'local candidate', body: 'local candidate body', type: 'reference' }, 'project', cwd)
    const refused = await applyChangeset(b, built, { cwd, approvedChecksum: built.checksum })
    expect(refused.conflicts).toContain('alpha')
    expect((await b.read('alpha', 'project', cwd))?.body).toBe('local candidate body')
  })
  it('rejects tampered and unsupported changesets', async () => {
    const built = await buildChangeset(a, { scope: 'project', cwd, since: 0, deviceId: 'device-a' })
    expect(() => verifyChangeset({ ...built, version: 2 })).toThrow(/不支持的变更集版本/)
    const tampered = { ...built, upserts: built.upserts.map(record => record.name === 'alpha' ? { ...record, body: 'tampered' } : record) }
    expect(() => verifyChangeset(tampered)).toThrow(/校验和不匹配/)
    expect(changesetChecksum({ format: built.format, version: built.version, deviceId: built.deviceId, scope: built.scope, since: built.since, until: built.until, upserts: built.upserts, deletions: built.deletions })).toBe(built.checksum)
  })
  it('carries topics in changesets', async () => {
    await a.write({ name: 'gamma', description: 'gamma sync', body: 'gamma body', type: 'reference', topic: '身份' }, 'project', cwd)
    const built = await buildChangeset(a, { scope: 'project', cwd, since: 0, deviceId: 'device-a' })
    expect(built.upserts.find(record => record.name === 'gamma')?.topic).toBe('身份')
    await applyChangeset(b, built, { cwd, approvedChecksum: built.checksum })
    expect((await b.read('gamma', 'project', cwd))?.topic).toBe('身份')
  })
  it('forks a reviewed conflict when asked to keep both sides', async () => {
    const built = await buildChangeset(a, { scope: 'project', cwd, since: 0, deviceId: 'device-a' })
    await b.write({ name: 'alpha', description: 'local reviewed', body: 'local body', type: 'reference', status: 'verified' }, 'project', cwd)
    const forked = await applyChangeset(b, built, { cwd, approvedChecksum: built.checksum, onConflict: 'fork' })
    expect(forked.conflicts).toEqual([])
    expect(forked.forked).toHaveLength(1)
    expect((await b.read(forked.forked[0], 'project', cwd))?.body).toBe('alpha body one')
    expect((await b.read('alpha', 'project', cwd))?.body).toBe('local body')
  })
})
