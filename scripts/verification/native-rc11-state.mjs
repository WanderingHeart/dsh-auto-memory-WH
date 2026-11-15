/**
 * Read-only before/after state check for the isolated rc.11 native desktop run.
 *
 * Usage:
 *   node scripts/verification/native-rc11-state.mjs before
 *   node scripts/verification/native-rc11-state.mjs after
 *
 * `before` snapshots the isolated home before the desktop app is launched.
 * `after` runs after the app exits and the candidate plugin is removed, and
 * asserts that the reviewed, pinned and muted synthetic record survived the
 * UI cycle, that the muted record stays out of the index, and that removal
 * left no WH module in the isolated desktop profile.
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { MemoryStore } from '../../src/store.ts'

const mode = process.argv[2]
if (!['before', 'after'].includes(mode)) throw new Error('Use before or after')

const repo = resolve(import.meta.dirname, '../..')
const testRoot = join(repo, '.work', 'S05')
const home = join(testRoot, 'native-real-user-home')
const root = join(home, 'memory-wh')
const profile = join(home, 'profiles', 'desktop')
const stateDir = join(testRoot, 'native-rc11-state')
const evidenceDir = join(repo, 'docs', 'evidence', 'S05-rc11-native')
const snapshotFile = join(stateDir, 'before.json')
const recordFile = join(root, '_user', 'native-ui-synthetic.md')
const indexFile = join(root, '_user', 'MEMORY.md')
const auditFile = join(root, 'audit.jsonl')
const credentialsFile = join(home, '.credentials.yaml')
const expectedName = 'native-ui-synthetic'
const expectedDescription = 'rc11-原生验收'
const archiveRecordName = 'rc11-archive-synthetic'

const sha = (data) => createHash('sha256').update(data).digest('hex').toUpperCase()
const exists = (file) => fs.stat(file).then(() => true, (error) => { if (error.code === 'ENOENT') return false; throw error })
const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'))
const readAuditLines = async () => {
  if (!await exists(auditFile)) return []
  const text = await fs.readFile(auditFile, 'utf8')
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

const store = new MemoryStore(root)
const record = await store.read(expectedName, 'user')
if (!record) throw new Error(`Missing synthetic record ${expectedName}`)
const rows = await store.list('user')
const auditLines = await readAuditLines()
const credentialsHash = sha(await fs.readFile(credentialsFile))
const recordHash = exists(recordFile).then((ok) => ok ? fs.readFile(recordFile).then(sha) : null)
const indexHash = exists(indexFile).then((ok) => ok ? fs.readFile(indexFile).then(sha) : null)
const whModule = join(profile, 'node_modules', 'dsh-auto-memory-wh')
const profileManifest = await readJson(join(profile, 'package.json'))
const snapshot = {
  mode,
  root: relative(repo, root),
  record: { name: record.name, description: record.description, body: record.body, status: record.status, pinned: Boolean(record.pinned), disabled: Boolean(record.disabled), revision: record.revision },
  recordHash: await recordHash,
  indexHash: await indexHash,
  credentialsHash,
  auditLines: auditLines.length,
  whAbsent: !await exists(whModule),
  profileHasWh: Object.hasOwn(profileManifest.dependencies ?? {}, 'dsh-auto-memory-wh'),
  rows: rows.map((row) => ({ name: row.name, status: row.status, pinned: Boolean(row.pinned), disabled: Boolean(row.disabled) })),
}

await fs.mkdir(stateDir, { recursive: true })
await fs.mkdir(evidenceDir, { recursive: true })

if (mode === 'before') {
  await fs.writeFile(snapshotFile, JSON.stringify(snapshot, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify({ ok: true, snapshot: relative(repo, snapshotFile), ...snapshot }, null, 2))
  process.exit(0)
}

const before = await readJson(snapshotFile)
const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
check('record still exists', Boolean(record), record?.name)
check('description reflects the rc.11 UI edit', record.description === expectedDescription, record.description)
check('body content was not altered by the UI cycle', record.body === before.record.body, undefined)
check('record was reviewed in the panel', record.status === 'verified', record.status)
check('record was pinned in the panel', Boolean(record.pinned), String(record.pinned))
check('record was muted in the panel', Boolean(record.disabled), String(record.disabled))
check('record revision changed', record.revision !== before.record.revision, record.revision)
const rowsAfter = await store.list('user')
check('archive-created record was restored', rowsAfter.some((row) => row.name === archiveRecordName), archiveRecordName)
check('muted record is not in the rendered index', !(await exists(indexFile)) || !(await fs.readFile(indexFile, 'utf8')).includes(expectedName), 'index excludes muted record')
const auditAfter = await readAuditLines()
check('audit log stays parseable and does not lose events', auditAfter.length >= before.auditLines, `${before.auditLines} -> ${auditAfter.length}`)
const newAttempts = auditAfter.slice(before.auditLines).filter((event) => event.kind === 'render_attempt')
check('any new render attempt is plugin-versioned rc.11', newAttempts.every((event) => event.pluginVersion === '0.1.0-rc.11'), newAttempts.map((event) => event.pluginVersion).join(','))
check('no lock or journal left behind', !await exists(join(root, '.wh-writer.lock')) && !await exists(join(root, '_user', 'MEMORY.md.lock')) && !await exists(join(root, '_user', '.wh-transaction.json')), 'clean')
check('plugin module removed from isolated profile', !await exists(whModule), 'absent')
const manifestAfter = await readJson(join(profile, 'package.json'))
check('profile no longer declares the plugin', !Object.hasOwn(manifestAfter.dependencies ?? {}, 'dsh-auto-memory-wh'), 'absent')
check('credentials fingerprint unchanged', sha(await fs.readFile(credentialsFile)) === before.credentialsHash, undefined)
const projectDirs = (await fs.readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name !== '_user' && !entry.name.startsWith('.'))
const projectRecordPresent = projectDirs.some((entry) => exists(join(root, entry.name, 'native-audit-reviewed-r72.md')))
check('project scope record untouched', await projectRecordPresent, undefined)

const result = { mode, pass: checks.every((item) => item.pass), checks, snapshotAfter: { root: relative(repo, root), record: { description: record.description, status: record.status, pinned: Boolean(record.pinned), disabled: Boolean(record.disabled), revision: record.revision }, auditLines: auditAfter.length } }
const evidenceFile = join(evidenceDir, 'after.json')
await fs.writeFile(evidenceFile, JSON.stringify(result, null, 2) + '\n', 'utf8')
console.log(JSON.stringify({ ...result, evidence: relative(repo, evidenceFile) }, null, 2))
if (!result.pass) process.exit(1)
