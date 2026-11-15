/** Bounded Windows multi-process writer exercise against a fresh synthetic root. */
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { MemoryStore } from '../../src/store.ts'

const repo = resolve(import.meta.dirname, '../..')
const work = join(repo, '.work', 'S05', 'multiprocess-contention')
const record = (name, body, expectedRevision) => ({ name, description: 'synthetic multi-process lock test', type: 'reference', body, ...(expectedRevision ? { expectedRevision } : {}) })

async function worker() {
  const [, , , mode, root, barrier, id, revision] = process.argv
  for (let i = 0; i < 1000; i++) {
    if (await fs.stat(barrier).then(() => true, () => false)) break
    if (i === 999) throw new Error('Worker barrier timeout')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  const store = new MemoryStore(root)
  if (mode === 'unique') {
    for (let i = 0; i < 6; i++) await store.write(record(`worker-${id}-${i}`, `synthetic-${id}-${i}`), 'user')
    console.log(JSON.stringify({ mode, id, written: 6 }))
  } else if (mode === 'contested') {
    try {
      await store.write(record('shared', `winner-${id}`, revision), 'user')
      console.log(JSON.stringify({ mode, id, result: 'written' }))
    } catch (error) {
      if (!/Revision conflict/.test(String(error?.message))) throw error
      console.log(JSON.stringify({ mode, id, result: 'revision-conflict' }))
    }
  } else throw new Error('Unknown worker mode')
}

function runWorker(mode, root, barrier, id, revision = '') {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [import.meta.filename, '--worker', mode, root, barrier, String(id), revision], { cwd: repo, windowsHide: true })
    let stdout = ''; let stderr = ''
    const timeout = setTimeout(() => child.kill(), 30_000)
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.on('error', error => { clearTimeout(timeout); reject(error) })
    child.on('exit', code => {
      clearTimeout(timeout)
      if (code !== 0) return reject(new Error(`Worker ${mode}/${id} exited ${code}: ${stderr.slice(0, 1000)}`))
      try { resolvePromise(JSON.parse(stdout.trim().split('\n').at(-1))) }
      catch (error) { reject(new Error(`Invalid worker result: ${stdout.slice(0, 1000)}`, { cause: error })) }
    })
  })
}

async function parent() {
  await fs.mkdir(work, { recursive: true })
  const run = join(work, `run-${Date.now()}-${randomUUID()}`)
  const root = join(run, 'memory')
  await fs.mkdir(run)
  const uniqueBarrier = join(run, 'unique.go')
  const uniqueRuns = Array.from({ length: 4 }, (_, id) => runWorker('unique', root, uniqueBarrier, id))
  await fs.writeFile(uniqueBarrier, '')
  const unique = await Promise.all(uniqueRuns)
  const store = new MemoryStore(root)
  const names = Array.from({ length: 4 }, (_, id) => Array.from({ length: 6 }, (_, i) => `worker-${id}-${i}`)).flat()
  const records = await Promise.all(names.map(name => store.read(name, 'user')))
  const uniquePresent = records.every((item, i) => item?.body === `synthetic-${Math.floor(i / 6)}-${i % 6}`)
  const initial = await store.write(record('shared', 'baseline'), 'user')
  if (!initial?.revision) throw new Error('Missing optimistic revision')
  const contestedBarrier = join(run, 'contested.go')
  const contestedRuns = [0, 1].map(id => runWorker('contested', root, contestedBarrier, id, initial.revision))
  await fs.writeFile(contestedBarrier, '')
  const contested = await Promise.all(contestedRuns)
  const final = await store.read('shared', 'user')
  const list = await store.list('user')
  const lockFiles = [join(root, '.wh-writer.lock'), join(root, '_user', 'MEMORY.md.lock'), join(root, '_user', '.wh-transaction.json')]
  const leftoverLocks = []
  for (const file of lockFiles) if (await fs.stat(file).then(() => true, () => false)) leftoverLocks.push(relative(root, file))
  const winner = contested.find(item => item.result === 'written')
  const pass = uniquePresent && unique.every(item => item.written === 6) && list.length === 25
    && contested.filter(item => item.result === 'written').length === 1
    && contested.filter(item => item.result === 'revision-conflict').length === 1
    && final?.body === `winner-${winner?.id}` && leftoverLocks.length === 0
  const evidence = { kind: 'fresh synthetic root, four concurrent processes, six unique writes each, then two contending revisions', run: relative(repo, run), node: process.version, unique, uniquePresent, recordCount: list.length, contested, finalBody: final?.body, leftoverLocks, pass }
  const evidenceDir = join(repo, 'docs', 'evidence', 'S05-multiprocess-contention')
  await fs.mkdir(evidenceDir, { recursive: true })
  await fs.writeFile(join(evidenceDir, 'result.json'), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify({ pass, uniqueWrites: names.length, recordCount: list.length, contested, leftoverLocks }))
  if (!pass) process.exitCode = 1
}

if (process.argv[2] === '--worker') await worker()
else await parent()
