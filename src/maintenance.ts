/** Offline maintenance only. These capabilities are deliberately not exposed as model tools. */
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, relative, sep } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { migrationRecordIssue, parseMemory, projectKey, renderIndexBody, INDEX_FILENAME } from './store.ts'
import { PLUGIN_VERSION } from './identity.ts'
import { absoluteRoot, assertNoLinksSync, decodeImage, durableWrite, errorCode, FORMAT_FILE, image, inside, JOURNAL, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, PROJECT_FILE, readRegular, recoverScope, ROOT_LOCK, safeRelative, sha256, type FileImage } from './storage-safety.ts'

export interface Selection { includeAudit: boolean; includeArchive: boolean }
export interface InventoryEntry { path: string; bytes: number; hash: string; kind: 'record' | 'index' | 'audit' | 'archive' | 'format' | 'mapping' | 'excluded' | 'unknown' }
export interface Inventory { root: string; entries: InventoryEntry[]; issues: string[]; scopes: string[]; digest: string }
export interface MigrationPlan {
  format: 'wh-migration-plan'; version: 1; id: string; created: string
  source: string; target: string; backup: string; selection: Selection
  projectMappings: Record<string, string>; inventory: Inventory; hash: string
}
export interface Snapshot {
  format: 'wh-snapshot'; version: 1; id: string; created: string
  pluginVersion: string; hostBuild: string; source: string; selection: Selection
  inventoryDigest: string; files: FileImage[]
}
const scopeName = (name: string): boolean => name === '_user' || /^--[A-Za-z0-9._~\-]+--$/.test(name)
const exists = async (file: string): Promise<boolean> => fs.lstat(file).then(() => true, error => { if (errorCode(error) === 'ENOENT') return false; throw error })
const digest = (value: unknown): string => sha256(JSON.stringify(value))
const selectionCheck = (s: Selection): void => { if (typeof s?.includeAudit !== 'boolean' || typeof s?.includeArchive !== 'boolean') throw new Error('Explicit audit/archive selections required') }

export function disjoint(...paths: string[]): void {
  const canonical = paths.map(absoluteRoot)
  for (let i = 0; i < canonical.length; i++) for (let j = i + 1; j < canonical.length; j++) {
    const a = canonical[i]!.toLowerCase(), b = canonical[j]!.toLowerCase()
    if (a === b || a.startsWith(b + sep) || b.startsWith(a + sep)) throw new Error('Source, target and backup must not overlap')
  }
  for (const file of canonical) assertNoLinksSync(file)
}

/** No mkdir, lock acquisition, index refresh or metadata normalization in the planning path. */
export async function inventoryRoot(source: string, selection: Selection): Promise<Inventory> {
  selectionCheck(selection)
  const root = absoluteRoot(source); assertNoLinksSync(root)
  const entries: InventoryEntry[] = [], issues: string[] = [], scopes: string[] = []
  const names = new Set<string>(); let bytes = 0; let count = 0
  async function walk(folder: string, depth: number): Promise<void> {
    if (depth > 5) throw new Error('Storage tree is too deep')
    for (const item of (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (++count > MAX_FILES * 2) throw new Error('Too many inventory entries')
      const filename = join(folder, item.name)
      const rel = relative(root, filename).split(sep).join('/')
      try { safeRelative(rel); assertNoLinksSync(filename) } catch { issues.push('unsafe-path: ' + rel); continue }
      const folded = rel.normalize('NFKC').toLowerCase()
      if (names.has(folded)) issues.push('case-or-unicode-conflict: ' + rel)
      names.add(folded)
      if (item.isSymbolicLink()) { issues.push('link: ' + rel); continue }
      if (item.isDirectory()) {
        if (depth === 0 && scopeName(item.name)) scopes.push(item.name)
        if (item.name === '.backups') { entries.push({ path: rel, bytes: 0, hash: '', kind: 'excluded' }); continue }
        if (!(depth === 0 && scopeName(item.name)) && !(depth === 1 && item.name === '.archive')) issues.push('unknown-directory: ' + rel)
        await walk(filename, depth + 1); continue
      }
      if (!item.isFile()) { issues.push('non-regular-file: ' + rel); continue }
      // Locks are synchronization state, never snapshot content. Only known lock locations are omitted.
      if (rel === ROOT_LOCK + '.lock' || rel === 'audit.jsonl.lock' || (depth === 1 && item.name === INDEX_FILENAME + '.lock' && scopeName(rel.split('/')[0]!))) continue
      if (item.name === JOURNAL || item.name.endsWith('.tmp')) { issues.push('recovery-required: ' + rel); continue }
      const data = await readRegular(filename)
      bytes += data.length
      if (bytes > MAX_TOTAL_BYTES || entries.length >= MAX_FILES) throw new Error('Inventory exceeds size limit')
      let kind: InventoryEntry['kind'] = 'unknown'
      const parts = rel.split('/')
      if (depth === 0 && rel === FORMAT_FILE) {
        kind = 'format'
        try { const f = JSON.parse(data.toString('utf8')); if (f.format !== 'dsh-auto-memory-wh' || f.version !== 1) issues.push('unsupported-format: ' + rel) } catch { issues.push('invalid-format: ' + rel) }
      } else if (rel === 'audit.jsonl') kind = selection.includeAudit ? 'audit' : 'excluded'
      else if (parts.length === 3 && scopeName(parts[0]!) && parts[1] === '.archive') kind = selection.includeArchive ? 'archive' : 'excluded'
      else if (parts.length === 2 && scopeName(parts[0]!)) {
        if (item.name === PROJECT_FILE) {
          kind = 'mapping'
          try { const mapping = JSON.parse(data.toString('utf8')); if (mapping.version !== 1 || !isOrdinaryAbsolute(mapping.cwd) || projectKey(mapping.cwd) !== parts[0]) issues.push('invalid-project-mapping: ' + rel) } catch { issues.push('invalid-project-mapping: ' + rel) }
        } else if (item.name === INDEX_FILENAME) kind = 'index'
        else if (/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(item.name)) {
          kind = 'record'
          const record = parseMemory(data.toString('utf8'), parts[0] === '_user' ? 'user' : 'project')
          if (!record || record.name + '.md' !== item.name) issues.push('invalid-record: ' + rel)
          const issue = migrationRecordIssue(data.toString('utf8'))
          if (issue) issues.push(issue + ': ' + rel)
        }
      }
      if (kind === 'unknown') issues.push('unknown-file: ' + rel)
      entries.push({ path: rel, bytes: data.length, hash: sha256(data), kind })
    }
  }
  await walk(root, 0)
  return { root, entries, issues, scopes, digest: digest({ entries, issues, scopes }) }
}

export async function planMigration(args: { source: string; target: string; backup: string; selection: Selection; projectMappings?: Record<string, string> }): Promise<MigrationPlan> {
  const source = absoluteRoot(args.source), target = absoluteRoot(args.target), backup = absoluteRoot(args.backup)
  disjoint(source, target, backup)
  const inventory = await inventoryRoot(source, args.selection)
  const projectMappings = { ...args.projectMappings }
  for (const scope of inventory.scopes.filter(s => s !== '_user')) {
    if (inventory.entries.some(e => e.path === scope + '/' + PROJECT_FILE && e.kind === 'mapping')) {
      const stored = JSON.parse((await readRegular(inside(source, scope + '/' + PROJECT_FILE))).toString('utf8')).cwd
      if (projectMappings[scope] && absoluteRoot(projectMappings[scope]!).toLowerCase() !== absoluteRoot(stored).toLowerCase()) inventory.issues.push('project-mapping-conflict: ' + scope)
      projectMappings[scope] ??= stored
    }
    const cwd = projectMappings[scope]
    if (!cwd || !isOrdinaryAbsolute(cwd) || projectKey(cwd) !== scope) inventory.issues.push('project-mapping-required: ' + scope)
  }
  if (await exists(target)) inventory.issues.push('target-exists')
  if (await exists(backup)) inventory.issues.push('backup-exists')
  const base = { format: 'wh-migration-plan' as const, version: 1 as const, id: randomUUID(), created: new Date().toISOString(), source, target, backup, selection: args.selection, projectMappings, inventory }
  return { ...base, hash: digest(base) }
}
function isOrdinaryAbsolute(value: string): boolean { try { absoluteRoot(value); return true } catch { return false } }

async function withOfflineLock<T>(root: string, stopped: boolean, operation: () => Promise<T>): Promise<T> {
  if (stopped !== true) throw new Error('Offline maintenance requires writersStopped=true; stop all writers first')
  assertNoLinksSync(root)
  const scopes = (await fs.readdir(root, { withFileTypes: true })).filter(e => e.isDirectory() && scopeName(e.name)).map(e => e.name).sort()
  async function lockScope(index: number): Promise<T> {
    if (index === scopes.length) return withFileLock(join(root, 'audit.jsonl'), operation)
    const dir = inside(root, scopes[index]!)
    return withFileLock(join(dir, INDEX_FILENAME), () => lockScope(index + 1))
  }
  return withFileLock(join(root, ROOT_LOCK), () => lockScope(0), { waitMs: 2000 })
}

async function makeSnapshot(inv: Inventory, selection: Selection, id: string = randomUUID(), created = new Date().toISOString(), hostBuild = 'not-specified'): Promise<Snapshot> {
  const files: FileImage[] = []
  for (const item of inv.entries) {
    if (item.kind === 'excluded') continue
    const data = await readRegular(inside(inv.root, item.path))
    if (sha256(data) !== item.hash) throw new Error('Source changed; create a new plan')
    files.push(image(item.path, data))
  }
  if ((await inventoryRoot(inv.root, selection)).digest !== inv.digest) throw new Error('Source changed during snapshot')
  return { format: 'wh-snapshot', version: 1, id, created, pluginVersion: PLUGIN_VERSION, hostBuild, source: inv.root, selection, inventoryDigest: inv.digest, files }
}

export async function verifySnapshot(file: string, expectedHash: string): Promise<Snapshot> {
  const raw = await readRegular(file, MAX_TOTAL_BYTES * 2)
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || sha256(raw) !== expectedHash) throw new Error('Snapshot checksum mismatch')
  const snapshot = JSON.parse(raw.toString('utf8')) as Snapshot
  if (snapshot.format !== 'wh-snapshot' || snapshot.version !== 1 || !Array.isArray(snapshot.files) || snapshot.files.length > MAX_FILES) throw new Error('Unsupported snapshot')
  const paths = new Set<string>(); let size = 0
  for (const item of snapshot.files) {
    const key = safeRelative(item.path).normalize('NFKC').toLowerCase()
    if (paths.has(key)) throw new Error('Duplicate snapshot path')
    const decoded = decodeImage(item)
    paths.add(key); size += decoded.length
    if (item.path === FORMAT_FILE) {
      const marker = JSON.parse(decoded.toString('utf8'))
      if (marker.format !== 'dsh-auto-memory-wh' || marker.version !== 1) throw new Error('Unsupported snapshot storage version')
    }
    if (size > MAX_TOTAL_BYTES) throw new Error('Snapshot exceeds size limit')
    const parts = item.path.split('/')
    if (!(item.path === FORMAT_FILE || item.path === 'audit.jsonl'
      || (scopeName(parts[0]!) && parts.length === 2 && (/^[a-zA-Z0-9-]+\.md$/.test(parts[1]!) || parts[1] === PROJECT_FILE))
      || (scopeName(parts[0]!) && parts.length === 3 && parts[1] === '.archive' && /^[a-f0-9-]{36}\.json$/.test(parts[2]!)))) throw new Error('Unrecognized snapshot path')
  }
  return snapshot
}

async function ensureSpace(parent: string, required: number): Promise<void> {
  const stat = await fs.statfs(parent)
  if (stat.bavail * stat.bsize < required + 1024 * 1024) throw new Error('Insufficient free space for snapshot and staging')
}

async function createNewDirectory(dir: string): Promise<void> {
  assertNoLinksSync(dir)
  // Parent must exist: typoed or unintended directory trees are not created implicitly.
  await fs.mkdir(dir, { mode: 0o700 })
}

export async function createBackup(args: { source: string; destination: string; selection: Selection; writersStopped: boolean; hostBuild?: string }): Promise<{ file: string; hash: string }> {
  const root = absoluteRoot(args.source), target = absoluteRoot(args.destination)
  disjoint(root, target)
  return withOfflineLock(root, args.writersStopped, async () => {
    const inv = await inventoryRoot(root, args.selection)
    if (inv.issues.length) throw new Error('Backup inventory requires review: ' + inv.issues.join('; '))
    await ensureSpace(dirname(target), inv.entries.reduce((n, e) => n + e.bytes, 0) * 3)
    const snapshot = await makeSnapshot(inv, args.selection, undefined, undefined, args.hostBuild)
    const raw = JSON.stringify(snapshot)
    await createNewDirectory(target)
    const file = join(target, 'snapshot.json')
    await durableWrite(file, raw)
    await verifySnapshot(file, sha256(raw))
    return { file, hash: sha256(raw) }
  })
}

/** Resume only our own empty/partial staging. Any unexpected content stops recovery. */
async function materialize(stage: string, snapshot: Snapshot, rebuilt: boolean, projectMappings: Record<string, string> = {}): Promise<void> {
  if (!await exists(stage)) await createNewDirectory(stage)
  assertNoLinksSync(stage)
  const expected = new Map(snapshot.files.map(item => [item.path, decodeImage(item)]))
  if (rebuilt) {
    expected.set(FORMAT_FILE, Buffer.from(JSON.stringify({ format: 'dsh-auto-memory-wh', version: 1 }) + '\n'))
    const byScope = new Map<string, ReturnType<typeof parseMemory>[]>()
    for (const item of snapshot.files) {
      const parts = item.path.split('/')
      if (parts.length !== 2 || !scopeName(parts[0]!)) continue
      const key = parts[0]!
      if (!byScope.has(key)) byScope.set(key, [])
      if (parts[1] === PROJECT_FILE) continue
      if (parts[1] === INDEX_FILENAME) { expected.delete(item.path); continue }
      const record = parseMemory(decodeImage(item).toString('utf8'), key === '_user' ? 'user' : 'project')
      if (record === null || record.name + '.md' !== parts[1]) throw new Error('Cannot rebuild an invalid or misnamed record')
      const issue = migrationRecordIssue(decodeImage(item).toString('utf8'))
      if (issue) throw new Error('Restore record requires review: ' + issue)
      byScope.get(key)!.push(record)
    }
    for (const [scope, records] of byScope) {
      if (scope !== '_user') {
        const previous = expected.get(scope + '/' + PROJECT_FILE)
        const cwd = projectMappings[scope] ?? (previous ? JSON.parse(previous.toString('utf8')).cwd : undefined)
        if (!cwd || !isOrdinaryAbsolute(cwd) || projectKey(cwd) !== scope) throw new Error('Project mapping required for restore: ' + scope)
        if (!previous) expected.set(scope + '/' + PROJECT_FILE, Buffer.from(JSON.stringify({ version: 1, cwd }) + '\n'))
      }
      const valid = records.filter((r): r is NonNullable<typeof r> => r !== null)
      if (valid.length) expected.set(scope + '/' + INDEX_FILENAME, Buffer.from(renderIndexBody(valid)))
    }
  }
  async function checkExisting(folder: string): Promise<void> {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name); assertNoLinksSync(file)
      if (entry.isDirectory()) await checkExisting(file)
      else {
        const rel = relative(stage, file).split(sep).join('/')
        const data = expected.get(rel)
        if (!data || sha256(await readRegular(file)) !== sha256(data)) throw new Error('Staging conflict; preserve files for review')
      }
    }
  }
  await checkExisting(stage)
  for (const [name, data] of expected) {
    const file = inside(stage, name)
    if (!await exists(file)) await durableWrite(file, data)
    if (sha256(await readRegular(file)) !== sha256(data)) throw new Error('Staged file verification failed')
  }
}

export async function restoreBackup(args: { file: string; expectedHash: string; destination: string; projectMappings?: Record<string, string> }): Promise<{ destination: string; files: number }> {
  const target = absoluteRoot(args.destination), file = absoluteRoot(args.file)
  disjoint(dirname(file), target)
  const snapshot = await verifySnapshot(file, args.expectedHash)
  disjoint(snapshot.source, target)
  if (await exists(target)) throw new Error('Restore destination must not exist; current data is never overwritten')
  await ensureSpace(dirname(target), snapshot.files.reduce((n, f) => n + f.bytes, 0) * 3)
  const stage = target + '.restore-' + randomUUID()
  await materialize(stage, snapshot, true, args.projectMappings)
  if (await exists(target)) throw new Error('Restore target appeared; staging retained')
  await fs.rename(stage, target)
  return { destination: target, files: snapshot.files.length }
}

export async function applyMigration(plan: MigrationPlan, options: { approvedPlanHash: string; writersStopped: boolean; fault?: (phase: 'backed-up' | 'staged' | 'renamed') => void | Promise<void> }): Promise<{ status: string; target: string; backupHash: string }> {
  const { hash, ...base } = plan
  if (plan.format !== 'wh-migration-plan' || plan.version !== 1 || !/^[a-f0-9-]{36}$/.test(plan.id) || digest(base) !== hash || options.approvedPlanHash !== hash) throw new Error('Plan hash mismatch')
  if (plan.inventory.issues.length) throw new Error('Plan has unresolved issues: ' + plan.inventory.issues.join('; '))
  disjoint(plan.source, plan.target, plan.backup)
  const logFile = plan.target + '.migration-' + plan.id + '.json'
  const stage = plan.target + '.staging-' + plan.id
  disjoint(plan.source, stage, plan.backup)
  return withOfflineLock(plan.source, options.writersStopped, async () => {
    const now = await inventoryRoot(plan.source, plan.selection)
    if (now.issues.length) throw new Error('Current source has unresolved issues: ' + now.issues.join('; '))
    if (now.digest !== plan.inventory.digest) throw new Error('Source changed; create and approve a new plan')
    let log: { version: number; planHash: string; phase: string; backupHash: string; targetDigest?: string }
    if (await exists(logFile)) {
      log = JSON.parse((await readRegular(logFile)).toString('utf8'))
      if (log.version !== 1 || log.planHash !== hash) throw new Error('Migration journal mismatch')
      if (log.phase === 'completed') return { status: 'already-completed; target left unchanged', target: plan.target, backupHash: log.backupHash }
    } else {
      if (await exists(plan.target) || await exists(plan.backup) || await exists(stage)) throw new Error('Migration target/backup/staging already exists')
      await ensureSpace(dirname(plan.target), now.entries.reduce((n, f) => n + f.bytes, 0) * 5)
      await ensureSpace(dirname(plan.backup), now.entries.reduce((n, f) => n + f.bytes, 0) * 2)
      log = { version: 1, planHash: hash, phase: 'planned', backupHash: '' }
      await durableWrite(logFile, JSON.stringify(log))
    }
    const snapshot = await makeSnapshot(now, plan.selection, plan.id, plan.created)
    const raw = JSON.stringify(snapshot), backupHash = sha256(raw)
    const backupFile = join(plan.backup, 'snapshot.json')
    if (!await exists(plan.backup)) await createNewDirectory(plan.backup)
    if (await exists(backupFile)) await verifySnapshot(backupFile, backupHash)
    else await durableWrite(backupFile, raw)
    await verifySnapshot(backupFile, backupHash)
    log.backupHash = backupHash
    await durableWrite(logFile, JSON.stringify(log))
    await options.fault?.('backed-up')
    if (await exists(plan.target)) {
      if (log.phase !== 'ready' || (await inventoryRoot(plan.target, plan.selection)).digest !== log.targetDigest) throw new Error('Unexpected target; refusing overwrite')
    } else {
      // Raw backup restore rehearsal includes old indexes, proving every selected byte round-trips.
      const rehearsal = join(plan.backup, 'restore-rehearsal')
      await materialize(rehearsal, snapshot, false)
      await materialize(stage, snapshot, true, plan.projectMappings)
      log.phase = 'ready'; log.targetDigest = (await inventoryRoot(stage, plan.selection)).digest
      await durableWrite(logFile, JSON.stringify(log))
      await options.fault?.('staged')
      if ((await inventoryRoot(plan.source, plan.selection)).digest !== plan.inventory.digest) throw new Error('Source changed before target commit')
      if (await exists(plan.target)) throw new Error('Target appeared; staging retained')
      await fs.rename(stage, plan.target)
      await options.fault?.('renamed')
    }
    log.phase = 'completed'
    await durableWrite(logFile, JSON.stringify(log))
    return { status: 'copied-and-verified; configuration not switched', target: plan.target, backupHash }
  })
}

/** Operator supplies the inspected hash and stops all writers. EPERM is never treated as death. */
export async function releaseStaleLock(args: { root: string; lock: string; expectedHash: string; writersStopped: boolean }): Promise<void> {
  if (args.writersStopped !== true) throw new Error('Stop all writers before lock recovery')
  const root = absoluteRoot(args.root)
  const allowed = args.lock === ROOT_LOCK + '.lock' || args.lock === 'audit.jsonl.lock'
    || (args.lock.split('/').length === 2 && scopeName(args.lock.split('/')[0]!) && args.lock.endsWith('/MEMORY.md.lock'))
  if (!allowed) throw new Error('Not a recognized writer lock')
  const file = inside(root, args.lock), raw = await readRegular(file)
  if (sha256(raw) !== args.expectedHash) throw new Error('Lock changed since inspection')
  const text = raw.toString('utf8').trim()
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) throw new Error('Malformed lock requires manual review')
  try { process.kill(Number(text), 0); throw new Error('Lock owner is alive') }
  catch (error) { if (errorCode(error) !== 'ESRCH') throw error }
  if (sha256(await readRegular(file)) !== args.expectedHash) throw new Error('Lock changed during inspection')
  await fs.unlink(file)
}

export async function recoverTransactions(rootPath: string, writersStopped: boolean): Promise<Record<string, string>> {
  const root = absoluteRoot(rootPath)
  return withOfflineLock(root, writersStopped, async () => {
    const result: Record<string, string> = {}
    for (const item of await fs.readdir(root, { withFileTypes: true })) if (item.isDirectory() && scopeName(item.name)) result[item.name] = await recoverScope(inside(root, item.name))
    return result
  })
}
