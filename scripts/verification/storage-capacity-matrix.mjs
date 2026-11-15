/** Synthetic ENOSPC at each transaction phase; no physical disk filling. */
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { MemoryStore } from '../../src/store.ts'
import { recoverTransactions } from '../../src/maintenance.ts'

const repo = resolve(import.meta.dirname, '../..')
const base = join(repo, '.work', 'S05', 'capacity-matrix', `run-${Date.now()}`)
await fs.mkdir(base, { recursive: true })
const sha = data => createHash('sha256').update(data).digest('hex')
const record = body => ({ name: 'sample', description: 'synthetic capacity test', type: 'reference', body })
const results = []
for (const point of ['prepared', 'mutated', 'committed']) {
  const root = join(base, point)
  const store = new MemoryStore(root)
  await store.write(record('baseline'), 'user')
  const file = join(root, '_user', 'sample.md')
  const before = sha(await fs.readFile(file))
  const failing = new MemoryStore(root, { fault: at => { if (at === point) throw Object.assign(new Error(`synthetic ENOSPC at ${point}`), { code: 'ENOSPC' }) } })
  let error
  try { await failing.write(record('changed'), 'user') }
  catch (caught) { error = { message: caught.message, code: caught.code ?? null } }
  let readBeforeRecovery
  try { readBeforeRecovery = { body: (await store.read('sample', 'user'))?.body ?? null } }
  catch (caught) { readBeforeRecovery = { error: caught.message } }
  const journalBeforeRecovery = await fs.readFile(join(root, '_user', '.wh-transaction.json')).then(data => sha(data)).catch(caught => caught.code === 'ENOENT' ? null : Promise.reject(caught))
  const recovery = await recoverTransactions(root, true)
  const after = sha(await fs.readFile(file))
  const finalBody = (await store.read('sample', 'user'))?.body ?? null
  const journalAfterRecovery = await fs.stat(join(root, '_user', '.wh-transaction.json')).then(() => true).catch(caught => caught.code === 'ENOENT' ? false : Promise.reject(caught))
  const pass = !!error && error.code === 'ENOSPC' && !journalAfterRecovery && (point === 'committed'
    ? journalBeforeRecovery !== null && !!readBeforeRecovery.error && recovery._user === 'committed' && finalBody === 'changed' && after !== before
    : journalBeforeRecovery === null && recovery._user === 'none' && readBeforeRecovery.body === 'baseline' && finalBody === 'baseline' && after === before)
  results.push({ point, error, before, readBeforeRecovery, journalBeforeRecovery, recovery, after, finalBody, journalAfterRecovery, pass })
}
const output = { base, kind: 'synthetic fault hook, not actual disk full', results, pass: results.every(item => item.pass) }
const evidenceDir = join(repo, 'docs', 'evidence', 'S05-rc6-capacity')
await fs.mkdir(evidenceDir, { recursive: true })
await fs.writeFile(join(evidenceDir, 'matrix.json'), JSON.stringify(output, null, 2) + '\n')
console.log(JSON.stringify({ pass: output.pass, results: results.map(item => ({ point: item.point, pass: item.pass, recovery: item.recovery._user, finalBody: item.finalBody })) }))
if (!output.pass) process.exitCode = 1
