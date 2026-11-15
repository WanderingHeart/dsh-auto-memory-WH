/** Windows-only, synthetic storage ACL recovery probe. Never point this at a real DSH home. */
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { MemoryStore } from '../../src/store.ts'
import { recoverTransactions } from '../../src/maintenance.ts'

const repo = resolve(import.meta.dirname, '../..')
const base = join(repo, '.work', 'S05', 'storage-acl', `run-${Date.now()}`)
const root = join(base, 'data')
const scope = join(root, '_user')
const evidence = join(base, 'result.json')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const command = (...args) => execFileSync('icacls', args, { encoding: 'utf8', windowsHide: true })
const stat = async file => { try { return hash(await fs.readFile(file)) } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
const record = body => ({ name: 'sample', description: 'synthetic only', type: 'reference', body })
const result = { base, platform: process.platform, phase: 'start' }
if (process.platform !== 'win32') throw new Error('Windows only')
await fs.mkdir(base, { recursive: true })
const store = new MemoryStore(root)
await store.write(record('synthetic baseline'), 'user')
const file = join(scope, 'sample.md')
const index = join(scope, 'MEMORY.md')
result.before = { record: await stat(file), index: await stat(index), body: (await store.read('sample', 'user')).body }
const csv = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).trim()
const sid = csv.match(/S-1-[0-9-]+/)?.[0]
if (!sid) throw new Error('Cannot identify current SID')
const beforeAcl = join(base, 'acl-before.txt')
const afterAcl = join(base, 'acl-after.txt')
command(scope, '/save', beforeAcl)
let denied = false
try {
  const faulted = new MemoryStore(root, { fault: point => {
    if (point === 'prepared') {
      command(scope, '/deny', `*${sid}:(WD,AD)`)
      denied = true
    }
  } })
  try { await faulted.write(record('synthetic changed'), 'user'); result.write = 'unexpected-success' }
  catch (error) { result.write = { message: error.message, code: error.code ?? null, cause: error.cause?.code ?? null } }
  result.duringDenial = { record: await stat(file), index: await stat(index), journal: await stat(join(scope, '.wh-transaction.json')) }
  try { await store.read('sample', 'user'); result.readDuringDenial = 'unexpected-success' }
  catch (error) { result.readDuringDenial = error.message }
} finally {
  if (denied) command(scope, '/remove:d', `*${sid}`)
  command(scope, '/save', afterAcl)
  result.acl = { before: await stat(beforeAcl), after: await stat(afterAcl) }
  await fs.writeFile(evidence, JSON.stringify(result, null, 2) + '\n')
}
try { result.recovery = await recoverTransactions(root, true) }
catch (error) { result.recovery = { error: error.message } }
result.after = { record: await stat(file), index: await stat(index), journal: await stat(join(scope, '.wh-transaction.json')) }
try { result.after.body = (await store.read('sample', 'user'))?.body ?? null }
catch (error) { result.after.readError = error.message }
result.pass = result.write !== 'unexpected-success' && result.readDuringDenial !== 'unexpected-success' && result.duringDenial.record === result.before.record && result.duringDenial.index === result.before.index && result.duringDenial.journal !== null && result.recovery?._user === 'rolled-back' && result.before.record === result.after.record && result.before.index === result.after.index && result.after.journal === null && result.before.body === result.after.body && result.acl.before === result.acl.after
await fs.writeFile(evidence, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
if (!result.pass) process.exitCode = 1
