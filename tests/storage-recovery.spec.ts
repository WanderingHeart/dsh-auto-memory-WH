import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { MemoryStore, projectKey, serializeMemory } from '../src/store.ts'
import { applyMigration, createBackup, inventoryRoot, planMigration, recoverTransactions, releaseStaleLock, restoreBackup, verifySnapshot } from '../src/maintenance.ts'
import { FORMAT_FILE, JOURNAL, ROOT_LOCK, sha256, safeRelative } from '../src/storage-safety.ts'

let base: string, root: string, store: MemoryStore
const record = (name = 'sample', body = '合成记录 🧠\n[[related]]') => ({ name, description: 'synthetic only', type: 'reference' as const, body })
const selection = { includeAudit: false, includeArchive: true }
const worker = fileURLToPath(new URL('./fixtures/storage-worker.mjs', import.meta.url))
async function runChild(args: string[]): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, ...args], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''; child.stderr.on('data', data => { stderr += data })
    child.on('error', reject); child.on('exit', code => { if (code !== 0 && code !== 71) reject(new Error(stderr)); else resolve(code) })
  })
}
async function rawTree(folder: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  async function walk(dir: string, prefix = ''): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const key = prefix + entry.name
      if (entry.isDirectory()) await walk(join(dir, entry.name), key + '/')
      else result[key] = sha256(await fs.readFile(join(dir, entry.name)))
    }
  }
  await walk(folder); return result
}
beforeEach(async () => { base = await fs.mkdtemp(join(tmpdir(), 'wh-s03-')); root = join(base, 'data'); store = new MemoryStore(root) })
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(base, { recursive: true, force: true }) })

describe('transactional storage and archives', () => {
  it('initializes only new stores; an unmarked legacy root stays byte-exact', async () => {
    await fs.mkdir(join(root, '_user'), { recursive: true }); await fs.writeFile(join(root, '_user', 'old.md'), serializeMemory(record('old')))
    const before = await rawTree(root)
    await expect(store.write(record(), 'user')).rejects.toThrow(/migration plan/)
    expect(await rawTree(root)).toEqual(before)
  })
  it('retains unknown metadata during edits and rejects stale revisions', async () => {
    await store.write(record(), 'user')
    const file = join(root, '_user', 'sample.md')
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('---\n', '---\nfutureMetadata:\n  nested: kept\n'))
    const before = (await store.read('sample', 'user'))!
    await store.write({ ...record('sample', 'changed'), expectedRevision: before.revision }, 'user')
    expect((await store.read('sample', 'user'))!.metadata).toEqual({ futureMetadata: { nested: 'kept' } })
    await expect(store.write({ ...record('sample', 'stale'), expectedRevision: before.revision }, 'user')).rejects.toThrow(/Revision conflict/)
    expect((await store.read('sample', 'user'))!.body).toBe('changed')
  })
  it('archives exact bytes, excludes deleted records, restores without overwriting newer content', async () => {
    await store.write({ ...record(), status: 'verified', supersedes: 'related' }, 'user')
    const file = join(root, '_user', 'sample.md'), original = await fs.readFile(file)
    expect(await store.delete('sample', 'user')).toBe(true)
    expect(await store.list('user')).toEqual([]); expect(store.readIndexSync('user')).toBeNull()
    const [archive] = await store.listArchive('user')
    expect(archive!.hash).toBe(sha256(original))
    await store.restoreArchived(archive!.id, 'user'); expect(await fs.readFile(file)).toEqual(original)
    await expect(store.restoreArchived(archive!.id, 'user')).rejects.toThrow(/conflict/)
  })
  it('batch clear retains a complete pre-batch snapshot and each archived file', async () => {
    await store.write(record('one'), 'user'); await store.write(record('two'), 'user')
    expect(await store.clear('user')).toBe(2)
    expect((await store.listArchive('user')).length).toBe(2)
    const names = await fs.readdir(join(root, '_user', '.backups'))
    const backup = JSON.parse(await fs.readFile(join(root, '_user', '.backups', names[0]!), 'utf8'))
    expect(backup.files.map((f: { path: string }) => f.path).sort()).toEqual(['_user/MEMORY.md', '_user/one.md', '_user/two.md'])
    const [listed] = await store.listBackups('user')
    const target = join(base, 'pre-clear')
    await restoreBackup({ file: listed!.file, expectedHash: listed!.hash, destination: target })
    expect((await new MemoryStore(target).list('user')).map(r => r.name)).toEqual(['one', 'two'])
  })
  it.each(['prepared', 'mutated'] as const)('a failure at %s restores the entire prior scope', async point => {
    await store.write(record(), 'user'); const before = await rawTree(root)
    const failing = new MemoryStore(root, { fault: at => { if (at === point) throw Object.assign(new Error('synthetic disk full'), { code: 'ENOSPC' }) } })
    await expect(failing.delete('sample', 'user')).rejects.toThrow(/disk full/)
    expect(await rawTree(root)).toEqual(before)
    expect((await store.read('sample', 'user'))!.body).toBe(record().body)
  })
  it('a committed-but-not-cleaned transaction retains new data after recovery', async () => {
    await store.write(record(), 'user')
    const failing = new MemoryStore(root, { fault: at => { if (at === 'committed') throw new Error('synthetic cleanup failure') } })
    await expect(failing.write(record('sample', 'committed body'), 'user')).rejects.toThrow(/cleanup/)
    await expect(store.read('sample', 'user')).rejects.toThrow(/recovery/)
    expect(store.readIndexSync('user')).toBeNull()
    expect(await recoverTransactions(root, true)).toEqual({ _user: 'committed' })
    expect((await store.read('sample', 'user'))!.body).toBe('committed body')
  })
  it.each(['prepared', 'mutated', 'committed'] as const)('abrupt child exit at %s recovers the correct state and allows a later write', async point => {
    await store.write(record(), 'user')
    const file = join(root, '_user', 'sample.md')
    const old = await fs.readFile(file)
    const oldIndex = await fs.readFile(join(root, '_user', 'MEMORY.md'))
    expect(await runChild([root, 'sample', `crash-${point}`])).toBe(71)
    await expect(store.read('sample', 'user')).rejects.toThrow(/recovery/)
    expect(store.readIndexSync('user')).toBeNull()
    expect(await fs.stat(join(root, '_user', JOURNAL))).toBeDefined()
    for (const lock of [ROOT_LOCK + '.lock', '_user/MEMORY.md.lock']) {
      const hash = sha256(await fs.readFile(join(root, lock)))
      await releaseStaleLock({ root, lock, expectedHash: hash, writersStopped: true })
    }
    expect(await recoverTransactions(root, true)).toEqual({ _user: point === 'committed' ? 'committed' : 'rolled-back' })
    await expect(fs.stat(join(root, '_user', JOURNAL))).rejects.toMatchObject({ code: 'ENOENT' })
    if (point === 'committed') {
      expect((await store.read('sample', 'user'))!.body).toBe('interrupted replacement')
      expect(await fs.readFile(file)).not.toEqual(old)
    } else {
      expect(await fs.readFile(file)).toEqual(old)
      expect(await fs.readFile(join(root, '_user', 'MEMORY.md'))).toEqual(oldIndex)
    }
    expect(await runChild([root, `after-${point}`, 'normal'])).toBe(0)
    expect((await store.list('user')).map(item => item.name)).toEqual([`after-${point}`, 'sample'])
    expect(store.readIndexSync('user')).toContain(`after-${point}`)
  }, 15_000)
  it('concurrent processes keep every independent write and a consistent index', async () => {
    await store.write(record('seed'), 'user')
    await Promise.all(['alpha', 'beta', 'gamma', 'delta'].map(name => runChild([root, name, 'normal'])))
    expect((await store.list('user')).map(r => r.name)).toEqual(['alpha', 'beta', 'delta', 'gamma', 'seed'])
    for (const name of ['alpha', 'beta', 'gamma', 'delta']) expect(store.readIndexSync('user')).toContain(name)
  }, 20_000)
  it('live and unreadable lock owners are never reclaimed; wrong hashes reject', async () => {
    await fs.mkdir(root); const lock = ROOT_LOCK + '.lock'; await fs.writeFile(join(root, lock), String(process.pid) + '\n')
    const hash = sha256(await fs.readFile(join(root, lock)))
    await expect(releaseStaleLock({ root, lock, expectedHash: hash, writersStopped: true })).rejects.toThrow(/alive/)
    await expect(releaseStaleLock({ root, lock, expectedHash: '0'.repeat(64), writersStopped: true })).rejects.toThrow(/changed/)
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('permission denied'), { code: 'EPERM' }) })
    await expect(releaseStaleLock({ root, lock, expectedHash: hash, writersStopped: true })).rejects.toThrow(/permission/)
    expect(await fs.readFile(join(root, lock), 'utf8')).toBe(String(process.pid) + '\n')
  })
  it('rejects device names and raw path traversal without creating external files', async () => {
    for (const name of ['../escape', 'con', 'nul', 'com1']) await expect(store.write(record(name), 'user')).rejects.toThrow()
    for (const name of ['../x', 'a\\b', 'C:/escape', 'a:stream', 'x.']) expect(() => safeRelative(name)).toThrow()
    await expect(fs.stat(join(base, 'escape.md'))).rejects.toThrow()
  })
  it('rejects a directory junction on reads, writes and offline scans', async () => {
    const outside = join(base, 'outside'); await fs.mkdir(outside); await fs.writeFile(join(outside, 'sentinel.md'), 'unchanged')
    await fs.mkdir(root); await fs.symlink(outside, join(root, '_user'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(store.write(record(), 'user')).rejects.toThrow(/links|junction/)
    await expect(store.list('user')).rejects.toThrow(/links|junction/)
    expect((await inventoryRoot(root, selection)).issues.length).toBeGreaterThan(0)
    expect(await fs.readFile(join(outside, 'sentinel.md'), 'utf8')).toBe('unchanged')
  })
  it('rejects colliding project slugs instead of mixing projects', async () => {
    const first = join(base, 'a-b'), second = join(base, 'a', 'b')
    expect(projectKey(first)).toBe(projectKey(second))
    await store.write(record(), 'project', first)
    await expect(store.write(record('other'), 'project', second)).rejects.toThrow(/collision/)
    await expect(store.read('sample', 'project', second)).rejects.toThrow(/collision/)
    expect((await store.read('sample', 'project', first))!.body).toBe(record().body)
  })
  it('retains the journal if rollback itself is denied, then recovers when permissions return', async () => {
    await store.write(record(), 'user')
    const originalOpen = fs.open.bind(fs)
    const failing = new MemoryStore(root, { fault: at => {
      if (at === 'mutated') {
        vi.spyOn(fs, 'open').mockImplementation(((...args: Parameters<typeof fs.open>) => {
          if (String(args[0]).includes('sample.md.') && args[1] === 'wx') throw Object.assign(new Error('synthetic access denied'), { code: 'EACCES' })
          return originalOpen(...args)
        }) as typeof fs.open)
        throw new Error('synthetic failure')
      }
    } })
    await expect(failing.delete('sample', 'user')).rejects.toThrow(/rollback failed/)
    vi.restoreAllMocks()
    await expect(store.list('user')).rejects.toThrow(/recovery/)
    expect(await recoverTransactions(root, true)).toEqual({ _user: 'rolled-back' })
    expect((await store.read('sample', 'user'))!.body).toBe(record().body)
  })
  it('refuses malformed recovery journals without changing records', async () => {
    await store.write(record(), 'user'); const file = join(root, '_user', 'sample.md'), old = await fs.readFile(file)
    await fs.writeFile(join(root, '_user', JOURNAL), '{bad')
    await expect(recoverTransactions(root, true)).rejects.toThrow()
    expect(await fs.readFile(file)).toEqual(old)
  })
})

describe('offline migration and backups', () => {
  async function legacy() {
    await fs.mkdir(join(root, '_user'), { recursive: true })
    const bytes = serializeMemory({ ...record(), status: 'disputed', metadata: { future: { retained: true } }, supersedes: 'previous' }).replace(/\n/g, '\r\n')
    await fs.writeFile(join(root, '_user', 'sample.md'), bytes)
    await fs.writeFile(join(root, '_user', 'MEMORY.md'), 'obsolete index')
    return { source: root, target: join(base, 'target'), backup: join(base, 'backup'), selection }
  }
  it('dry run has zero source/target writes and copies byte-exact records with verified recovery rehearsal', async () => {
    const args = await legacy(), before = await rawTree(base)
    const plan = await planMigration(args)
    expect(plan.inventory.issues).toEqual([]); expect(await rawTree(base)).toEqual(before)
    const result = await applyMigration(plan, { approvedPlanHash: plan.hash, writersStopped: true })
    expect(result.status).toMatch(/copied-and-verified/)
    const original = await fs.readFile(join(root, '_user', 'sample.md'))
    expect(await fs.readFile(join(args.target, '_user', 'sample.md'))).toEqual(original)
    expect(await fs.readFile(join(args.backup, 'restore-rehearsal', '_user', 'sample.md'))).toEqual(original)
    expect(await fs.readFile(join(root, '_user', 'MEMORY.md'), 'utf8')).toBe('obsolete index')
    const targetStore = new MemoryStore(args.target)
    expect((await targetStore.read('sample', 'user'))!.metadata).toEqual({ future: { retained: true } })
    expect(targetStore.readIndexSync('user')).not.toBe('obsolete index')
    expect(await fs.stat(join(args.target, FORMAT_FILE))).toBeDefined()
    await targetStore.write(record('newer'), 'user')
    expect((await applyMigration(plan, { approvedPlanHash: plan.hash, writersStopped: true })).status).toMatch(/already-completed/)
    expect((await targetStore.read('newer', 'user'))!.body).toBe(record().body)
  })
  it.each(['backed-up', 'staged', 'renamed'] as const)('resumes safely after interruption at %s', async phase => {
    const plan = await planMigration(await legacy())
    await expect(applyMigration(plan, { approvedPlanHash: plan.hash, writersStopped: true, fault: at => { if (at === phase) throw new Error('synthetic interruption') } })).rejects.toThrow(/interruption/)
    await applyMigration(plan, { approvedPlanHash: plan.hash, writersStopped: true })
    expect(await fs.readFile(join(plan.target, '_user', 'sample.md'))).toEqual(await fs.readFile(join(root, '_user', 'sample.md')))
  })
  it('rejects stale plans, missing stop confirmation and plan tampering before any target write', async () => {
    const plan = await planMigration(await legacy())
    await expect(applyMigration(plan, { approvedPlanHash: plan.hash, writersStopped: false })).rejects.toThrow(/stop|Stop/)
    await expect(applyMigration({ ...plan, target: join(base, 'other') }, { approvedPlanHash: plan.hash, writersStopped: true })).rejects.toThrow(/hash/)
    await fs.appendFile(join(root, '_user', 'sample.md'), '\nchanged')
    await expect(applyMigration(plan, { approvedPlanHash: plan.hash, writersStopped: true })).rejects.toThrow(/Source changed/)
    await expect(fs.stat(plan.target)).rejects.toThrow()
  })
  it('lists malformed, unknown and unsupported files as blockers', async () => {
    const args = await legacy()
    await fs.writeFile(join(root, '_user', 'bad.md'), 'bad yaml')
    await fs.writeFile(join(root, 'config.json'), '{"syntheticSecret":"not-a-real-secret"}')
    await fs.writeFile(join(root, '_user', 'future.md'), serializeMemory({ ...record('future'), metadata: { schemaVersion: 99 } }))
    await fs.writeFile(join(root, '_user', 'bad-trust.md'), serializeMemory(record('bad-trust')).replace('---\n', '---\nstatus: nonsense\n'))
    const plan = await planMigration(args)
    expect(plan.inventory.issues.join(' ')).toMatch(/invalid-record/)
    expect(plan.inventory.issues.join(' ')).toMatch(/unknown-file/)
    expect(plan.inventory.issues.join(' ')).toMatch(/unsupported-record-version/)
    expect(plan.inventory.issues.join(' ')).toMatch(/invalid-trust-status/)
    await expect(applyMigration(plan, { approvedPlanHash: plan.hash, writersStopped: true })).rejects.toThrow(/unresolved/)
    const { hash: _hash, ...basePlan } = plan
    const edited = { ...basePlan, inventory: { ...plan.inventory, issues: [] } }
    const editedHash = sha256(JSON.stringify(edited))
    await expect(applyMigration({ ...edited, hash: editedHash }, { approvedPlanHash: editedHash, writersStopped: true })).rejects.toThrow(/Current source has unresolved/)
  })
  it('requires an explicit project path mapping and rejects overlapping paths', async () => {
    const args = await legacy(), cwd = join(base, 'project'), scope = projectKey(cwd)
    await fs.mkdir(join(root, scope)); await fs.writeFile(join(root, scope, 'project.md'), serializeMemory(record('project')))
    expect((await planMigration(args)).inventory.issues.join(' ')).toMatch(/mapping-required/)
    expect((await planMigration({ ...args, projectMappings: { [scope]: cwd } })).inventory.issues).toEqual([])
    await expect(planMigration({ ...args, target: join(root, 'nested') })).rejects.toThrow(/overlap/)
  })
  it('backs up the selected archive/audit set; verifies before restore and never overwrites current data', async () => {
    await store.write(record(), 'user'); await store.delete('sample', 'user')
    await fs.writeFile(join(root, 'audit.jsonl'), '{"synthetic":true}\n')
    const saved = await createBackup({ source: root, destination: join(base, 'snapshot'), selection, writersStopped: true })
    const snapshot = await verifySnapshot(saved.file, saved.hash)
    expect(snapshot.files.some(f => f.path.includes('.archive/'))).toBe(true)
    expect(snapshot.files.some(f => f.path === 'audit.jsonl')).toBe(false)
    const dest = join(base, 'restored')
    await restoreBackup({ file: saved.file, expectedHash: saved.hash, destination: dest })
    expect((await new MemoryStore(dest).listArchive('user')).length).toBe(1)
    await expect(restoreBackup({ file: saved.file, expectedHash: saved.hash, destination: root })).rejects.toThrow(/overlap/)
    await fs.appendFile(saved.file, ' ')
    await expect(restoreBackup({ file: saved.file, expectedHash: saved.hash, destination: join(base, 'corrupt') })).rejects.toThrow(/checksum/)
  })
  it('rejects malicious paths even when an attacker recomputes the outer checksum', async () => {
    await store.write(record(), 'user')
    const saved = await createBackup({ source: root, destination: join(base, 'snapshot'), selection, writersStopped: true })
    const snapshot = JSON.parse(await fs.readFile(saved.file, 'utf8')); snapshot.files[0].path = '../escape.md'
    const raw = JSON.stringify(snapshot); await fs.writeFile(saved.file, raw)
    await expect(verifySnapshot(saved.file, sha256(raw))).rejects.toThrow(/Unsafe/)
    await expect(fs.stat(join(base, 'escape.md'))).rejects.toThrow()
  })
  it('refuses insufficient space before creating backup output', async () => {
    await store.write(record(), 'user')
    vi.spyOn(fs, 'statfs').mockResolvedValue({ bavail: 0, bsize: 4096 } as never)
    await expect(createBackup({ source: root, destination: join(base, 'no-space'), selection, writersStopped: true })).rejects.toThrow(/space/)
    await expect(fs.stat(join(base, 'no-space'))).rejects.toThrow()
  })
})
