/** Windows-only synthetic permission-combination matrix. Never point this at a real DSH home. */
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { MemoryStore } from '../../src/store.ts'
import { recoverTransactions } from '../../src/maintenance.ts'
import { appendAudit, readAudit, getAuditStatus } from '../../src/audit-log.ts'

const repo = resolve(import.meta.dirname, '../..')
const base = join(repo, '.work', 'S05', 'storage-acl-matrix', `run-${Date.now()}`)
const evidenceDir = join(repo, 'docs', 'evidence', 'S05-rc10-acl-matrix')
if (process.platform !== 'win32') throw new Error('Windows only')
const ic = (...args) => execFileSync('icacls', args, { encoding: 'utf8', windowsHide: true })
const attrib = (...args) => execFileSync('attrib', args, { encoding: 'utf8', windowsHide: true })
const sha = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex')
const exists = async file => fs.stat(file).then(() => true, () => false)
const permissionError = error => {
  const code = error?.code ?? error?.cause?.code ?? null
  return code === 'EPERM' || code === 'EACCES' ? code : null
}
const ownerSid = (() => {
  const csv = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).trim()
  const sid = csv.match(/S-1-[0-9-]+/)?.[0]
  if (!sid) throw new Error('Cannot identify current SID')
  return sid
})()

async function scenario(name, body) {
  const dir = join(base, name)
  const root = join(dir, 'memory')
  await fs.mkdir(root, { recursive: true })
  const store = new MemoryStore(root)
  await store.write({ name: 'sample', description: 'synthetic permission test', type: 'reference', body: 'synthetic baseline' }, 'user')
  const scope = join(root, '_user')
  const file = join(scope, 'sample.md')
  const journal = join(scope, '.wh-transaction.json')
  const savedAcl = join(dir, 'acl-before.txt')
  const afterAcl = join(dir, 'acl-after.txt')
  ic(root, '/save', savedAcl)
  const result = { name, baselineHash: await sha(file) }
  try {
    await body({ result, root, store, scope, file, journal })
  } catch (error) {
    result.harnessError = { message: String(error?.message ?? error) }
  } finally {
    try { attrib('-R', file, join(root, 'audit.jsonl')) } catch { /* best effort */ }
    try { ic(root, '/remove:d', `*${ownerSid}`, '/T', '/C', '/Q') } catch { /* no deny applied */ }
    try {
      ic(root, '/save', afterAcl)
      result.acl = { before: await sha(savedAcl), after: await sha(afterAcl) }
      result.acl.restored = result.acl.before === result.acl.after
    } catch (error) { result.acl = { error: String(error?.message ?? error), restored: false } }
  }
  return result
}

const results = []

// S1: read-only record file. The transaction cannot replace it, so the failure must
// surface as "Recovery required" with the journal retained; after clearing the
// attribute maintenance must roll the scope back to the baseline byte-for-byte.
results.push(await scenario('file-readonly', async ({ result, root, store, file, journal }) => {
  attrib('+R', file)
  try { await store.write({ name: 'sample', description: 'synthetic permission test', type: 'reference', body: 'synthetic changed' }, 'user'); result.write = 'unexpected-success' }
  catch (error) { result.write = { message: error.message, code: error.code ?? null, cause: error.cause?.code ?? null } }
  result.during = { journal: await exists(journal), hash: await sha(file) }
  attrib('-R', file)
  result.recovery = await recoverTransactions(root, true).catch(error => ({ error: error.message }))
  result.after = { journal: await exists(journal), hash: await sha(file), body: (await store.read('sample', 'user'))?.body ?? null }
  result.pass = result.write !== 'unexpected-success' && permissionError({ code: result.write.cause ?? result.write.code }) !== null
    && result.during.journal === true && result.during.hash === result.baselineHash
    && result.after.journal === false && result.after.hash === result.baselineHash && result.after.body === 'synthetic baseline'
}))

// S2: deny write on the memory root while a read still works. Lock/format creation
// fails before any journal exists; nothing in the store may change.
results.push(await scenario('root-deny-write', async ({ result, root, store, file, journal }) => {
  ic(root, '/deny', `*${ownerSid}:(WD,AD)`)
  try { await store.write({ name: 'sample', description: 'synthetic permission test', type: 'reference', body: 'synthetic changed' }, 'user'); result.write = 'unexpected-success' }
  catch (error) { result.write = { message: error.message, code: error.code ?? null, cause: error.cause?.code ?? null } }
  result.during = { journal: await exists(journal), hash: await sha(file), read: (await store.read('sample', 'user'))?.body ?? null }
  ic(root, '/remove:d', `*${ownerSid}`)
  result.recovery = await recoverTransactions(root, true)
  result.after = { journal: await exists(journal), hash: await sha(file), body: (await store.read('sample', 'user'))?.body ?? null }
  result.pass = result.write !== 'unexpected-success' && permissionError({ code: result.write.cause ?? result.write.code }) !== null
    && result.during.journal === false && result.during.hash === result.baselineHash && result.during.read === 'synthetic baseline'
    && result.after.journal === false && result.after.hash === result.baselineHash && result.after.body === 'synthetic baseline'
}))

// S3: deny directory listing (RD) on the scope. Listing must fail loudly instead of
// returning an empty library, while a direct known-file read still succeeds; removing
// the denial restores listing.
results.push(await scenario('scope-deny-read', async ({ result, root, store, scope, file }) => {
  ic(scope, '/deny', `*${ownerSid}:(RD)`)
  try { result.list = await store.list('user') }
  catch (error) { result.list = { error: error.message, code: error.code ?? null, cause: error.cause?.code ?? null } }
  try { result.read = (await store.read('sample', 'user'))?.body ?? null }
  catch (error) { result.read = { error: error.message, code: error.code ?? null, cause: error.cause?.code ?? null } }
  ic(scope, '/remove:d', `*${ownerSid}`)
  result.after = { list: (await store.list('user')).length, body: (await store.read('sample', 'user'))?.body ?? null, hash: await sha(file) }
  result.recovery = await recoverTransactions(root, true)
  result.pass = !Array.isArray(result.list) && permissionError(result.list) !== null && result.read === 'synthetic baseline'
    && result.after.list === 1 && result.after.body === 'synthetic baseline' && result.after.hash === result.baselineHash
}))

// S3b: deny write on the scope directory. The journal/lock cannot be created there,
// so the write must fail before mutating anything; after clearing the deny a normal
// write must succeed and recovery must find no retained journal.
results.push(await scenario('scope-deny-write', async ({ result, root, store, scope, file, journal }) => {
  ic(scope, '/deny', `*${ownerSid}:(WD,AD)`)
  try { await store.write({ name: 'sample', description: 'synthetic permission test', type: 'reference', body: 'synthetic changed' }, 'user'); result.write = 'unexpected-success' }
  catch (error) { result.write = { message: error.message, code: error.code ?? null, cause: error.cause?.code ?? null } }
  result.during = { journal: await exists(journal), hash: await sha(file) }
  ic(scope, '/remove:d', `*${ownerSid}`)
  result.recovery = await recoverTransactions(root, true)
  await store.write({ name: 'sample', description: 'synthetic permission test', type: 'reference', body: 'synthetic recovered-write' }, 'user')
  result.after = { journal: await exists(journal), body: (await store.read('sample', 'user'))?.body ?? null }
  result.pass = result.write !== 'unexpected-success' && permissionError({ code: result.write.cause ?? result.write.code }) !== null
    && result.during.journal === false && result.during.hash === result.baselineHash
    && result.after.journal === false && result.after.body === 'synthetic recovered-write'
}))

// S3c: deny directory enumeration on the memory root. Normal memory operations
// address known scope paths, so list/read/write must keep working; the deny would
// only bite a root-level scan. This row records that boundary explicitly.
results.push(await scenario('root-deny-read', async ({ result, root, store, file, journal }) => {
  ic(root, '/deny', `*${ownerSid}:(RD)`)
  try { result.list = await store.list('user') }
  catch (error) { result.list = { error: error.message, code: error.code ?? null, cause: error.cause?.code ?? null } }
  try { result.read = (await store.read('sample', 'user'))?.body ?? null }
  catch (error) { result.read = { error: error.message, code: error.code ?? null, cause: error.cause?.code ?? null } }
  try { await store.write({ name: 'sample', description: 'synthetic permission test', type: 'reference', body: 'synthetic after-root-rd-deny' }, 'user'); result.write = 'success' }
  catch (error) { result.write = { message: error.message, code: error.code ?? null, cause: error.cause?.code ?? null } }
  result.during = { journal: await exists(journal) }
  ic(root, '/remove:d', `*${ownerSid}`)
  result.recovery = await recoverTransactions(root, true)
  result.after = { list: (await store.list('user')).length, body: (await store.read('sample', 'user'))?.body ?? null }
  result.pass = Array.isArray(result.list) && result.list.length === 1 && result.read === 'synthetic baseline'
    && result.write === 'success' && result.during.journal === false
    && result.after.list === 1 && result.after.body === 'synthetic after-root-rd-deny'
}))


// caller; status reports degradation, and clearing the attribute lets appends resume.
{
  const root = join(base, 'audit-readonly', 'memory')
  await fs.mkdir(root, { recursive: true })
  const store = new MemoryStore(root)
  await store.write({ name: 'sample', description: 'synthetic permission test', type: 'reference', body: 'synthetic baseline' }, 'user')
  const auditFile = join(root, 'audit.jsonl')
  const entry = n => ({ ts: Date.now(), sessionId: 'synthetic-' + n, cwd: 'synthetic', injected: [], truncated: [], bytes: 0 })
  const result = { name: 'audit-readonly' }
  await appendAudit(root, entry(1), {})
  attrib('+R', auditFile)
  try {
    await appendAudit(root, entry(2), {})
    result.degraded = getAuditStatus(root)
  } catch (error) { result.appendError = { message: error.message, code: error.code ?? null } }
  attrib('-R', auditFile)
  await appendAudit(root, entry(3), {})
  result.after = getAuditStatus(root)
  result.events = (await readAudit(root)).length
  result.pass = !result.appendError && result.degraded?.dropped >= 1 && result.degraded?.lastError !== null
    && result.after?.lastError === null && result.after?.written >= 2 && result.events === 2
  results.push(result)
}

const pass = results.every(item => item.pass === true && item.acl?.restored !== false)
const output = {
  kind: 'synthetic permission combinations on fresh roots; not a real DSH home',
  platform: process.platform,
  run: base.replace(repo + '\\', ''),
  results: results.map(item => ({ name: item.name, pass: item.pass, acl: item.acl ?? null, write: item.write ?? null, harnessError: item.harnessError ?? null, recovery: item.recovery ?? null })),
  pass,
}
await fs.mkdir(evidenceDir, { recursive: true })
await fs.writeFile(join(evidenceDir, 'matrix.json'), JSON.stringify({ ...output, results }, null, 2) + '\n')
console.log(JSON.stringify(output, null, 2))
if (!pass) process.exitCode = 1
