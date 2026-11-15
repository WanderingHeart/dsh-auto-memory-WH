import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../src/store.ts'
import { applyImport, buildExportPackage, planImport, verifyExportPackage, TransferError } from '../src/transfer.ts'

describe('memory export/import package', () => {
  let root: string
  let store: MemoryStore
  const cwd = 'C:/synthetic-transfer-project'
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wh-transfer-'))
    store = new MemoryStore(root)
    await store.write({ name: 'alpha', title: 'Alpha', description: 'alpha description', body: 'alpha body', type: 'reference', status: 'verified' }, 'project', cwd)
    await store.write({ name: 'beta', description: 'beta description', body: 'beta body', type: 'user' }, 'project', cwd)
  })
  it('round-trips records and keeps trust states in the package only', async () => {
    const records = await store.list('project', cwd)
    const pkg = buildExportPackage(records, { scope: 'project' })
    expect(pkg.records).toHaveLength(2)
    expect(pkg.records.find(record => record.name === 'alpha')?.status).toBe('verified')
    const parsed = verifyExportPackage(JSON.parse(JSON.stringify(pkg)))
    expect(parsed.checksum).toBe(pkg.checksum)
    const targetRoot = await mkdtemp(join(tmpdir(), 'wh-transfer-target-'))
    try {
      const target = new MemoryStore(targetRoot)
      const result = await applyImport(target, parsed, { cwd, approvedChecksum: parsed.checksum })
      expect(result.created).toEqual(['alpha', 'beta'])
      const imported = (await target.read('alpha', 'project', cwd))!
      expect(imported.status).toBe('candidate')
      expect(imported.body).toBe('alpha body')
    } finally {
      await rm(targetRoot, { recursive: true, force: true })
    }
  })
  it('rejects tampered checksums and unknown versions', () => {
    const pkg = buildExportPackage([], { scope: 'user' })
    expect(() => verifyExportPackage({ ...pkg, checksum: 'f'.repeat(64) })).toThrow(TransferError)
    expect(() => verifyExportPackage({ ...pkg, version: 2 })).toThrow(/不支持的导出包版本/)
    expect(() => verifyExportPackage({ ...pkg, format: 'other' })).toThrow(/不是 WH 导出包/)
  })
  it('rejects duplicate and malformed records', () => {
    const base = buildExportPackage([], { scope: 'user' })
    const record = { name: 'dup', description: 'd', body: 'b', type: 'reference', scope: 'user' }
    const dup = { ...base, records: [record, record] }
    dup.checksum = (buildExportPackage([], { scope: 'user' }) as { checksum: string }).checksum
    expect(() => verifyExportPackage(dup)).toThrow(/重复记录/)
    const bad = { ...base, records: [{ ...record, name: '../evil' }] }
    expect(() => verifyExportPackage(bad)).toThrow(/非法记录名/)
  })
  it('plans create/update/skip/conflict and refuses to overwrite local changes without a strategy', async () => {
    const records = await store.list('project', cwd)
    const pkg = buildExportPackage(records, { scope: 'project' })
    const alpha = (await store.read('alpha', 'project', cwd))!
    const changed = { ...pkg, records: pkg.records.map(record => record.name === 'alpha' ? { ...record, body: 'changed body' } : record) }
    changed.checksum = (await import('../src/transfer.ts')).exportChecksum(changed.records, changed.scope)
    const plan = planImport(changed, records)
    expect(plan.conflicts).toEqual(['alpha'])
    await expect(applyImport(store, changed, { cwd, approvedChecksum: changed.checksum })).rejects.toThrow(/本地记录内容不同/)
    const skipped = planImport(pkg, records)
    expect(skipped.skipped.sort()).toEqual(['alpha', 'beta'])
    const result = await applyImport(store, changed, { cwd, approvedChecksum: changed.checksum, onConflict: 'skip' })
    expect(result.conflicts).toEqual(['alpha'])
    expect((await store.read('alpha', 'project', cwd))?.body).toBe('alpha body')
    expect(alpha.status).toBe('verified')
  })
  it('forks reviewed conflicts into a candidate instead of overwriting', async () => {
    const pkg = buildExportPackage(await store.list('project', cwd), { scope: 'project' })
    const changed = { ...pkg, records: pkg.records.map(record => record.name === 'alpha' ? { ...record, body: 'changed body' } : record) }
    changed.checksum = (await import('../src/transfer.ts')).exportChecksum(changed.records, changed.scope)
    const result = await applyImport(store, changed, { cwd, approvedChecksum: changed.checksum, onConflict: 'fork' })
    expect(result.conflicts).toEqual([])
    expect(result.forked).toHaveLength(1)
    const fork = (await store.read(result.forked[0], 'project', cwd))!
    expect(fork.body).toBe('changed body')
    expect(fork.status).toBe('candidate')
    expect((await store.read('alpha', 'project', cwd))?.body).toBe('alpha body')
    const again = await applyImport(store, changed, { cwd, approvedChecksum: changed.checksum, onConflict: 'fork' })
    expect(again.forked).toEqual([])
    expect(again.skipped).toContain(result.forked[0])
  })
  it('treats a locally edited candidate as a conflict and a strictly newer remote as an update (rc.11)', async () => {
    const pkg = buildExportPackage(await store.list('project', cwd), { scope: 'project' })
    await new Promise(resolve => setTimeout(resolve, 5))
    await store.write({ name: 'beta', description: 'beta description', body: 'local candidate edit', type: 'user' }, 'project', cwd)
    const localPlan = planImport(pkg, await store.list('project', cwd))
    expect(localPlan.conflicts).toContain('beta')

    const newer = {
      ...pkg,
      records: pkg.records.map(record => record.name === 'beta' ? { ...record, body: 'remote newer edit', updatedMs: Date.now() + 60_000 } : record),
    }
    newer.checksum = (await import('../src/transfer.ts')).exportChecksum(newer.records, newer.scope)
    const remotePlan = planImport(newer, await store.list('project', cwd))
    expect(remotePlan.updates).toContain('beta')
  })
  it('carries topics across the package boundary', async () => {
    await store.write({ name: 'gamma', description: 'gamma description', body: 'gamma body', type: 'reference', topic: '考研' }, 'project', cwd)
    const pkg = verifyExportPackage(JSON.parse(JSON.stringify(buildExportPackage(await store.list('project', cwd), { scope: 'project' }))))
    expect(pkg.records.find(record => record.name === 'gamma')?.topic).toBe('考研')
    const targetRoot = await mkdtemp(join(tmpdir(), 'wh-transfer-topic-'))
    try {
      const target = new MemoryStore(targetRoot)
      await applyImport(target, pkg, { cwd, approvedChecksum: pkg.checksum })
      expect((await target.read('gamma', 'project', cwd))?.topic).toBe('考研')
    } finally {
      await rm(targetRoot, { recursive: true, force: true })
    }
  })
  it('rejects malformed topics in packages', () => {
    const pkg = buildExportPackage([], { scope: 'user' })
    const record = { name: 'bad-topic', description: 'd', body: 'b', type: 'reference', scope: 'user', topic: 'bad topic!' }
    expect(() => verifyExportPackage({ ...pkg, records: [record as never] })).toThrow(/topic 非法/)
  })
})
