// Offline snapshot/backup/restore failure matrix plus archive and stale-lock
// maintenance paths, on a synthetic root under .work/S05.
//
// Run: node scripts/verification/snapshot-restore-matrix.mjs [stage]
//   stage defaults to S05-rc11-snapshot-restore-matrix
// Evidence: docs/evidence/<stage>/matrix.json

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MemoryStore } from '../../src/store.ts'
import { appendAudit } from '../../src/audit-log.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const stage = process.argv[2] ?? 'S05-rc11-snapshot-restore-matrix'
if (!/^S05-(?:rc\d+|\d+\.\d+\.\d+)-[a-z0-9-]+$/.test(stage)) throw new Error(`invalid stage: ${stage}`)

const base = path.join(root, '.work/S05/snapshot-restore-matrix', `run-${Date.now()}`)
const memory = path.join(base, 'memory')
const cli = path.join(root, 'lib/maintenance-cli.js')
const evidenceDir = path.join(root, 'docs/evidence', stage)
const projectCwd = 'C:\\work\\snapshot-demo'

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function walk(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

function fileHashes(dir) {
  const map = new Map()
  for (const file of walk(dir)) map.set(path.relative(dir, file).replaceAll('\\', '/'), sha256(fs.readFileSync(file)))
  return map
}

let requestSeq = 0
function runCli(command, request) {
  const requests = path.join(base, 'requests')
  fs.mkdirSync(requests, { recursive: true })
  const requestFile = path.join(requests, `${String(++requestSeq).padStart(2, '0')}-${command}.json`)
  fs.writeFileSync(requestFile, JSON.stringify(request, null, 2))
  const proc = spawnSync(process.execPath, [cli, command, requestFile], { cwd: root, encoding: 'utf8' })
  let json = null
  try { json = JSON.parse(proc.stdout) } catch {}
  return { exitCode: proc.status, stdout: (proc.stdout ?? '').trim(), stderr: (proc.stderr ?? '').trim(), json, errorText: json?.error ?? (proc.stderr ?? '').trim() }
}

// --- synthetic root --------------------------------------------------------
fs.mkdirSync(memory, { recursive: true })
const store = new MemoryStore(memory)
const uAlpha = await store.write({ name: 'u-alpha', description: '用户作用域合成记录', type: 'reference', body: '用户记录正文，用于快照往返。', status: 'verified' }, 'user')
const pBeta = await store.write({ name: 'p-beta', description: '项目作用域合成记录', type: 'project', body: '项目记录正文。', status: 'verified' }, 'project', projectCwd)
const uArch = await store.write({ name: 'u-archived', description: '待归档的合成记录', type: 'reference', body: '归档正文。', status: 'verified' }, 'user')
if (!uAlpha || !pBeta || !uArch) throw new Error('synthetic records could not be created')
const archived = await store.deleteVersioned('u-archived', 'user', undefined, uArch.revision)
for (const injected of [['p-beta'], ['u-alpha', 'p-beta']]) {
  await appendAudit(memory, {
    kind: 'render_attempt', pluginVersion: '0.1.0-rc.11', ts: Date.now(),
    sessionId: 'snapshot-matrix', cwd: projectCwd, injected, truncated: [], bytes: 256,
  })
}
record('setup: user and project records written', (await store.list('user')).some(r => r.name === 'u-alpha') && (await store.list('project', projectCwd)).some(r => r.name === 'p-beta'))
record('setup: archived record present', (await store.listArchive('user')).some(a => a.id === archived.archiveId))
record('setup: two audit events written', fs.existsSync(path.join(memory, 'audit.jsonl')))

// --- backup / verify / restore round trip ---------------------------------
const backupDir = path.join(base, 'backup')
const backup = runCli('backup', { source: memory, destination: backupDir, selection: { includeAudit: true, includeArchive: true }, writersStopped: true })
record('backup succeeds', backup.exitCode === 0 && Boolean(backup.json?.file), backup.errorText)
const snapshotFile = backup.json?.file
const snapshotHash = backup.json?.hash
record('backup hash is sha256', /^[a-f0-9]{64}$/.test(snapshotHash ?? ''), snapshotHash)

const verify = runCli('verify', { file: snapshotFile, expectedHash: snapshotHash })
record('verify accepts the good snapshot', verify.exitCode === 0 && verify.json?.verified === true, verify.errorText)
const verifyWrong = runCli('verify', { file: snapshotFile, expectedHash: '0'.repeat(64) })
record('verify rejects a wrong hash', verifyWrong.exitCode !== 0 && /checksum mismatch/i.test(verifyWrong.errorText), verifyWrong.errorText)

const restoredDir = path.join(base, 'restored')
const restore = runCli('restore', { file: snapshotFile, expectedHash: snapshotHash, destination: restoredDir })
record('restore succeeds', restore.exitCode === 0 && restore.json?.files > 0, restore.errorText)

const sourceHashes = fileHashes(memory)
const restoredHashes = fileHashes(restoredDir)
const mismatches = []
for (const [rel, hash] of sourceHashes) {
  if (rel.endsWith('/MEMORY.md') || rel === 'MEMORY.md') continue
  if (restoredHashes.get(rel) !== hash) mismatches.push(rel)
}
record('restored non-index bytes are identical', mismatches.length === 0, mismatches.join(', ') || `${sourceHashes.size} files compared (indexes excluded)`)

const restoredStore = new MemoryStore(restoredDir)
const restoredUser = await restoredStore.list('user')
const restoredProject = await restoredStore.list('project', projectCwd)
record('restored user record is readable', restoredUser.some(r => r.name === 'u-alpha' && r.body.includes('用户记录正文')), restoredUser.map(r => r.name).join(','))
record('restored project record is readable', restoredProject.some(r => r.name === 'p-beta'), restoredProject.map(r => r.name).join(','))
record('restored archive entry is readable', (await restoredStore.listArchive('user')).some(a => a.id === archived.archiveId))
record('restored user index lists the record', fs.readFileSync(path.join(restoredDir, '_user/MEMORY.md'), 'utf8').includes('u-alpha'))
record('restored audit is readable', (await (await import('../../src/audit-log.ts')).readAudit(restoredDir)).length === 2)

const restoreAgain = runCli('restore', { file: snapshotFile, expectedHash: snapshotHash, destination: restoredDir })
record('restore refuses an existing destination', restoreAgain.exitCode !== 0 && /must not exist/i.test(restoreAgain.errorText), restoreAgain.errorText)

// --- negative snapshot mutations ------------------------------------------
const original = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'))
const mutantsDir = path.join(base, 'mutants')
fs.mkdirSync(mutantsDir, { recursive: true })

function writeMutant(name, mutate, { rawOverride } = {}) {
  const snapshot = structuredClone(original)
  if (mutate) mutate(snapshot)
  const raw = rawOverride ?? JSON.stringify(snapshot)
  const file = path.join(mutantsDir, `${name}.json`)
  fs.writeFileSync(file, raw)
  return { file, hash: sha256(Buffer.from(raw)) }
}

function expectFailure(name, mutant, pattern, { restore = false } = {}) {
  const verified = runCli('verify', { file: mutant.file, expectedHash: mutant.hash })
  let ok = verified.exitCode !== 0 && (!pattern || pattern.test(verified.errorText))
  let observed = verified.errorText
  if (restore) {
    const dest = path.join(base, 'negative', `${name}-dest`)
    const restored = runCli('restore', { file: mutant.file, expectedHash: mutant.hash, destination: dest })
    ok = ok && restored.exitCode !== 0 && !fs.existsSync(dest)
    observed = `${verified.errorText} | restore: ${restored.errorText}`
  }
  record(`mutant rejected: ${name}`, ok, observed)
}

expectFailure('wrong-version', writeMutant('wrong-version', (s) => { s.version = 2 }), /Unsupported snapshot/)
expectFailure('duplicate-path', writeMutant('duplicate-path', (s) => { s.files.push(structuredClone(s.files[0])) }), /Duplicate snapshot path/)
expectFailure('path-traversal', writeMutant('path-traversal', (s) => { s.files[0].path = '../evil.md' }), /Unsafe path component|Unsafe relative path/, { restore: true })
expectFailure('unknown-path', writeMutant('unknown-path', (s) => { s.files[0].path = 'user/notes.txt' }), /Unrecognized snapshot path/)
expectFailure('bad-format-marker', writeMutant('bad-format-marker', (s) => {
  const item = s.files.find(f => f.path === '.wh-format.json')
  const data = Buffer.from(JSON.stringify({ format: 'not-wh', version: 1 }) + '\n')
  item.data = data.toString('base64'); item.bytes = data.length; item.hash = sha256(data)
}), /Unsupported snapshot storage version/)
expectFailure('invalid-json', writeMutant('invalid-json', null, { rawOverride: '{"format":"wh-snapshot","version":1' }), /JSON|Unexpected|Expected/)
expectFailure('tampered-bytes', writeMutant('tampered-bytes', null, {
  rawOverride: (() => { const raw = JSON.stringify(original); return raw.replace('"data":"', '"data":"A') })(),
}), /checksum mismatch|Invalid encoded file/i)

// --- archive list/restore through the CLI ---------------------------------
const archiveList = runCli('archive-list', { root: restoredDir, scope: 'user' })
record('archive-list returns the deleted record', archiveList.exitCode === 0 && Array.isArray(archiveList.json) && archiveList.json.some(a => a.id === archived.archiveId), archiveList.errorText)

const archiveNoStop = runCli('archive-restore', { root: restoredDir, id: archived.archiveId, scope: 'user' })
record('archive-restore requires writersStopped', archiveNoStop.exitCode !== 0 && /Stop writers/i.test(archiveNoStop.errorText), archiveNoStop.errorText)

const archiveRestore = runCli('archive-restore', { root: restoredDir, id: archived.archiveId, scope: 'user', writersStopped: true })
const afterRestore = await restoredStore.list('user')
record('archive-restore restores the record', archiveRestore.exitCode === 0 && afterRestore.some(r => r.name === 'u-archived' && r.body.includes('归档正文')), archiveRestore.errorText)

// --- stale-lock release through the CLI -----------------------------------
const lockPath = path.join(restoredDir, '.wh-writer.lock')
const deadPid = 999999
try { process.kill(deadPid, 0); throw new Error(`pid ${deadPid} is alive; cannot use it as a dead owner`) } catch (error) { if (error.code !== 'ESRCH') throw error }
fs.writeFileSync(lockPath, `${deadPid}\n`)
const lockHash = sha256(fs.readFileSync(lockPath))

const unlockNoStop = runCli('unlock', { root: restoredDir, lock: '.wh-writer.lock', expectedHash: lockHash })
record('unlock requires writersStopped', unlockNoStop.exitCode !== 0 && /Stop all writers/i.test(unlockNoStop.errorText), unlockNoStop.errorText)

const unlockWrongHash = runCli('unlock', { root: restoredDir, lock: '.wh-writer.lock', expectedHash: '0'.repeat(64), writersStopped: true })
record('unlock rejects a changed lock', unlockWrongHash.exitCode !== 0 && /changed since inspection/i.test(unlockWrongHash.errorText), unlockWrongHash.errorText)

const unlockUnknown = runCli('unlock', { root: restoredDir, lock: 'other/MEMORY.md.lock', expectedHash: lockHash, writersStopped: true })
record('unlock rejects an unrecognized lock name', unlockUnknown.exitCode !== 0 && /recognized writer lock/i.test(unlockUnknown.errorText), unlockUnknown.errorText)

const aliveLock = path.join(restoredDir, 'audit.jsonl.lock')
fs.writeFileSync(aliveLock, `${process.pid}\n`)
const unlockAlive = runCli('unlock', { root: restoredDir, lock: 'audit.jsonl.lock', expectedHash: sha256(fs.readFileSync(aliveLock)), writersStopped: true })
record('unlock refuses a live owner', unlockAlive.exitCode !== 0 && /owner is alive/i.test(unlockAlive.errorText), unlockAlive.errorText)
fs.unlinkSync(aliveLock)

const unlock = runCli('unlock', { root: restoredDir, lock: '.wh-writer.lock', expectedHash: lockHash, writersStopped: true })
record('unlock releases a dead-owner lock', unlock.exitCode === 0 && !fs.existsSync(lockPath), unlock.errorText)
const writeAfterUnlock = await restoredStore.write({ name: 'u-after-unlock', description: '解锁后写入', type: 'reference', body: '锁释放后的写入。', status: 'candidate' }, 'user')
record('write succeeds after lock release', Boolean(writeAfterUnlock), JSON.stringify(writeAfterUnlock)?.slice(0, 80))

const malformedLock = path.join(restoredDir, '.wh-writer.lock')
fs.writeFileSync(malformedLock, 'not-a-pid\n')
const unlockMalformed = runCli('unlock', { root: restoredDir, lock: '.wh-writer.lock', expectedHash: sha256(fs.readFileSync(malformedLock)), writersStopped: true })
record('unlock rejects malformed lock content', unlockMalformed.exitCode !== 0 && /Malformed lock/i.test(unlockMalformed.errorText), unlockMalformed.errorText)
fs.unlinkSync(malformedLock)

// --- evidence -------------------------------------------------------------
const passed = results.every(r => r.ok)
fs.mkdirSync(evidenceDir, { recursive: true })
fs.writeFileSync(path.join(evidenceDir, 'matrix.json'), `${JSON.stringify({
  stage,
  status: passed ? 'passed' : 'failed',
  generatedAt: new Date().toISOString(),
  base: path.relative(root, base).replaceAll('\\', '/'),
  snapshot: { file: path.relative(root, snapshotFile).replaceAll('\\', '/'), hash: snapshotHash, files: original.files.length },
  boundary: [
    'synthetic root and snapshot; no real user memory, model call, DSH profile or native window',
    'filesystem failures are not injected here; only malformed snapshots and CLI refusals',
    'restore rebuilds indexes from records; non-index bytes are compared, indexes are validated by re-reading the store',
  ],
  results,
}, null, 2)}\n`)
console.log(`\nRESULT ${passed ? 'PASS' : 'FAIL'} -> ${path.relative(root, path.join(evidenceDir, 'matrix.json'))}`)
process.exit(passed ? 0 : 1)
