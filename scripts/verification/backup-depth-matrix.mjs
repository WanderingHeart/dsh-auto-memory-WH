// Backup depth matrix: multi-scope snapshots, restore determinism, selection and mapping.
// Usage: node backup-depth-matrix.mjs

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { MemoryStore, projectKey } from '../../src/store.ts'
import { appendAudit } from '../../src/audit-log.ts'
import { createBackup, restoreBackup, verifySnapshot } from '../../src/maintenance.ts'

const repo = process.cwd()
const base = path.join(repo, '.work', 'S05', 'backup-depth', 'run-' + Date.now())
const source = path.join(base, 'source')
const projectCwd = path.join(base, 'project-alpha')
fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(projectCwd, { recursive: true })

const installedVersion = JSON.parse(fs.readFileSync(path.join(repo, '.work/S05/installation-home/profiles/wh-s05/node_modules/dsh-auto-memory-wh/package.json'), 'utf8')).version
const hostBuild = 'S05-' + installedVersion + '-test'

const checks = []
function check(name, ok, detail) { checks.push({ name, ok, detail }); if (!ok) console.error('FAIL ' + name + (detail ? ' :: ' + detail : '')) }
const sha = value => createHash('sha256').update(value).digest('hex')

function treeHashes(dir, skipIndex = false) {
  const map = new Map()
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      const rel = path.relative(dir, full).split(path.sep).join('/')
      if (skipIndex && path.basename(rel) === 'MEMORY.md') continue
      map.set(rel, sha(fs.readFileSync(full)))
    }
  }
  walk(dir)
  return map
}

// Seed: user scope, project scope, audit trail and one archived record.
const store = new MemoryStore(source, { staleAfterDays: 0 })
const seeds = [
  { name: 'user-alpha', description: 'first user record', type: 'reference', status: 'verified' },
  { name: 'user-beta', description: 'second user record', type: 'reference', status: 'verified' },
  { name: 'user-gamma', description: 'third user record', type: 'reference', status: 'candidate' },
]
for (const seed of seeds) await store.write({ ...seed, body: `body of ${seed.name}\n` }, 'user')
const projectSeeds = [
  { name: 'project-one', description: 'project record one', type: 'project', status: 'verified' },
  { name: 'project-two', description: 'project record two', type: 'project', status: 'verified' },
]
const projectRecords = []
for (const seed of projectSeeds) projectRecords.push(await store.write({ ...seed, body: `body of ${seed.name}\n` }, 'project', projectCwd))
const projectScope = projectKey(projectCwd)
check('project scope directory created', fs.existsSync(path.join(source, projectScope)))

await appendAudit(source, { ts: Date.now() - 1000, sessionId: 'sess-backup', cwd: projectCwd, injected: ['user:user-alpha'], truncated: [], bytes: 128 })
await appendAudit(source, { ts: Date.now(), sessionId: 'sess-backup', cwd: projectCwd, injected: [], truncated: [], bytes: 0 })
const gamma = await store.read('user-gamma', 'user')
const archived = await store.deleteVersioned('user-gamma', 'user', undefined, gamma.revision)
check('archive produced by versioned delete', Boolean(archived))

// Snapshot with audit and archive, then checksum-verify it.
const first = await createBackup({ source, destination: path.join(base, 'backup-a'), selection: { includeAudit: true, includeArchive: true }, writersStopped: true, hostBuild })
check('backup reports a sha256 checksum', /^[a-f0-9]{64}$/.test(first.hash))
const snapshot = await verifySnapshot(first.file, first.hash)
check('snapshot identity fields', snapshot.format === 'wh-snapshot' && snapshot.version === 1 && snapshot.pluginVersion === installedVersion && snapshot.hostBuild === hostBuild, JSON.stringify({ format: snapshot.format, version: snapshot.version, plugin: snapshot.pluginVersion, build: snapshot.hostBuild }))
check('snapshot source path is the absolute source root', snapshot.source === source, snapshot.source)
check('snapshot includes user, project and audit entries', snapshot.files.some(f => f.path === '_user/user-alpha.md') && snapshot.files.some(f => f.path === projectScope + '/project-one.md') && snapshot.files.some(f => f.path === 'audit.jsonl'), snapshot.files.map(f => f.path).join(','))
check('snapshot selection recorded', snapshot.selection.includeAudit === true && snapshot.selection.includeArchive === true)
check('snapshot embeds per-file hashes', snapshot.files.every(file => /^[a-f0-9]{64}$/.test(file.hash)))

// Restore twice: content must match the snapshot and both restores must be identical.
const restoreA = path.join(base, 'restore-a')
const restoredA = await restoreBackup({ file: first.file, expectedHash: first.hash, destination: restoreA })
const restoredTree = treeHashes(restoreA)
check('restore reports the same file count as the snapshot', restoredA.files === snapshot.files.length, `${restoredA.files}/${snapshot.files.length}`)
const mismatched = snapshot.files.filter(file => path.basename(file.path) !== 'MEMORY.md' && restoredTree.get(file.path) !== file.hash)
check('restored non-index files match snapshot hashes', mismatched.length === 0, mismatched.map(f => f.path).join(','))
check('restore rebuilds the format marker and project mapping file', fs.existsSync(path.join(restoreA, '.wh-format.json')) && fs.existsSync(path.join(restoreA, projectScope, '.wh-project.json')))

const restoreB = path.join(base, 'restore-b')
await restoreBackup({ file: first.file, expectedHash: first.hash, destination: restoreB })
const treeB = treeHashes(restoreB)
const sameTree = restoredTree.size === treeB.size && [...restoredTree].every(([rel, hash]) => treeB.get(rel) === hash)
check('two restores of the same snapshot are byte-identical', sameTree, `${restoredTree.size}/${treeB.size}`)

let existingError = null
try { await restoreBackup({ file: first.file, expectedHash: first.hash, destination: restoreA }) } catch (error) { existingError = String(error?.message ?? error) }
check('restore refuses an existing destination', /must not exist/.test(existingError ?? ''), existingError)

let tamperError = null
const tampered = path.join(base, 'backup-a', 'snapshot.json')
const raw = fs.readFileSync(tampered, 'utf8')
fs.writeFileSync(tampered, raw + ' ')
try { await verifySnapshot(tampered, first.hash) } catch (error) { tamperError = String(error?.message ?? error) }
check('tampered snapshot fails the checksum check', /checksum mismatch/.test(tamperError ?? ''), tamperError)
fs.writeFileSync(tampered, raw)

// Selection without audit or archive must exclude both from the snapshot.
const second = await createBackup({ source, destination: path.join(base, 'backup-b'), selection: { includeAudit: false, includeArchive: false }, writersStopped: true })
const snapshotB = await verifySnapshot(second.file, second.hash)
check('excluded selection omits audit and archive', !snapshotB.files.some(f => f.path === 'audit.jsonl' || f.path.includes('/.archive/')), snapshotB.files.map(f => f.path).join(','))
check('excluded selection keeps records', snapshotB.files.some(f => f.path === '_user/user-alpha.md'))

// Project mapping: the correct cwd is accepted, a foreign cwd is rejected.
const mapped = path.join(base, 'restore-mapped')
await restoreBackup({ file: second.file, expectedHash: second.hash, destination: mapped, projectMappings: { [projectScope]: projectCwd } })
const mappedTree = treeHashes(mapped)
check('mapped restore keeps project record bytes', snapshotB.files.filter(f => f.path.startsWith(projectScope + '/') && path.basename(f.path) !== 'MEMORY.md').every(f => mappedTree.get(f.path) === f.hash))
let mappingError = null
try { await restoreBackup({ file: second.file, expectedHash: second.hash, destination: path.join(base, 'restore-bad-mapping'), projectMappings: { [projectScope]: path.join(base, 'project-beta') } }) } catch (error) { mappingError = String(error?.message ?? error) }
check('foreign project mapping is rejected', /Project mapping required|projectKey|Cannot rebuild/.test(mappingError ?? ''), mappingError)

// Five repeated cycles: snapshot file sets and hashes are stable when nothing changes.
const cycleSignatures = []
for (let i = 0; i < 5; i++) {
  const cycle = await createBackup({ source, destination: path.join(base, 'cycle-' + i), selection: { includeAudit: true, includeArchive: true }, writersStopped: true })
  const cycleSnapshot = await verifySnapshot(cycle.file, cycle.hash)
  cycleSignatures.push(cycleSnapshot.files.map(f => f.path + ':' + f.hash).sort().join('|'))
}
check('five backups have identical file content signatures', new Set(cycleSignatures).size === 1)

// Restore after the source is gone: a backup is the only remaining copy.
const restoreAfterDelete = path.join(base, 'restore-after-delete')
fs.rmSync(source, { recursive: true, force: true })
await restoreBackup({ file: first.file, expectedHash: first.hash, destination: restoreAfterDelete })
const recovered = new MemoryStore(restoreAfterDelete, { staleAfterDays: 0 })
const recoveredRecords = await recovered.list('user')
check('restore works after the source root is deleted', recoveredRecords.length === 2, String(recoveredRecords.length))
check('restored records are readable', (await recovered.read('user-alpha', 'user'))?.body.includes('body of user-alpha'))
const recoveredProject = await recovered.list('project', projectCwd)
check('restored project records remain readable', recoveredProject.length === 2, String(recoveredProject.length))

const pass = checks.every(item => item.ok)
const result = {
  pass, stage: 'S05-rc11-backup-depth', at: new Date().toISOString(),
  checks, source, snapshot: { file: first.file, hash: first.hash, files: snapshot.files.length, hostBuild: snapshot.hostBuild },
  restored: { files: restoredA.files, treeSize: restoredTree.size }, cycles: cycleSignatures.length,
  boundary: 'Synthetic records on Windows, offline backups, no platform crash or partially written disk images; restore is exercised through the public maintenance API.',
}
const outDir = path.join(repo, 'docs', 'evidence', 'S05-rc11-backup-depth')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'matrix.json'), JSON.stringify(result, null, 2) + '\n')
console.log(`RESULT ${pass ? 'PASS' : 'FAIL'} -> docs/evidence/S05-rc11-backup-depth/matrix.json`)
if (!pass) process.exitCode = 1
