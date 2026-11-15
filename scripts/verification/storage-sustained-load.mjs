/** Sustained multi-process load on a fresh synthetic root: many unique writes plus repeated revision churn. */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { MemoryStore } from '../../src/store.ts'

const repo = resolve(import.meta.dirname, '../..')
const work = join(repo, '.work', 'S05', 'sustained-load')

async function worker() {
  const [, , , mode, root, barrier, id, roundsText] = process.argv
  const rounds = Number(roundsText)
  for (let i = 0; i < 1000; i++) {
    if (await fs.stat(barrier).then(() => true, () => false)) break
    if (i === 999) throw new Error('Worker barrier timeout')
    await new Promise(resolvePromise => setTimeout(resolvePromise, 10))
  }
  const store = new MemoryStore(root)
  if (mode === 'unique') {
    for (let i = 0; i < rounds; i++) {
      await store.write({ name: `load-${id}-${String(i).padStart(3, '0')}`, description: 'synthetic sustained load', type: 'reference', body: `synthetic-${id}-${i}` }, 'user')
    }
    console.log(JSON.stringify({ mode, id, written: rounds }))
    return
  }
  if (mode === 'churn') {
    let successes = 0
    let conflicts = 0
    for (let round = 0; round < rounds; round++) {
      let done = false
      for (let attempt = 0; attempt < 5 && !done; attempt++) {
        const current = await store.read('shared', 'user')
        if (!current?.revision) throw new Error('Missing shared baseline')
        try {
          await store.write({ name: 'shared', description: 'synthetic sustained load', type: 'reference', body: `churn-${id}-${round}`, expectedRevision: current.revision }, 'user')
          successes++
          done = true
        } catch (error) {
          if (!/Revision conflict/.test(String(error?.message))) throw error
          conflicts++
        }
      }
      if (!done) throw new Error(`Churn worker ${id} exhausted retries at round ${round}`)
    }
    console.log(JSON.stringify({ mode, id, written: successes, conflicts }))
    return
  }
  throw new Error('Unknown worker mode')
}

function runWorker(args, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [import.meta.filename, '--worker', ...args], { cwd: repo, windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.on('error', error => { clearTimeout(timeout); reject(error) })
    child.on('exit', code => {
      clearTimeout(timeout)
      if (code !== 0) return reject(new Error(`Worker ${args.slice(0, 1)}/${args[2]} exited ${code}: ${stderr.slice(0, 1000)}`))
      try { resolvePromise(JSON.parse(stdout.trim().split('\n').at(-1))) }
      catch (error) { reject(new Error(`Invalid worker result: ${stdout.slice(0, 1000)}`, { cause: error })) }
    })
  })
}

async function main() {
  await fs.mkdir(work, { recursive: true })
  const run = join(work, `run-${Date.now()}-${randomUUID()}`)
  const root = join(run, 'memory')
  await fs.mkdir(run)
  const store = new MemoryStore(root)

  const uniqueWorkers = 2
  const uniqueEach = 30
  const uniqueStart = performance.now()
  const uniqueBarrier = join(run, 'unique.go')
  const uniqueRuns = Array.from({ length: uniqueWorkers }, (_, id) => runWorker(['unique', root, uniqueBarrier, String(id), String(uniqueEach)], 120_000))
  await fs.writeFile(uniqueBarrier, '')
  const unique = await Promise.all(uniqueRuns)
  const uniqueMs = performance.now() - uniqueStart

  const names = Array.from({ length: uniqueWorkers }, (_, id) => Array.from({ length: uniqueEach }, (_, i) => `load-${id}-${String(i).padStart(3, '0')}`)).flat()
  const records = await Promise.all(names.map(name => store.read(name, 'user')))
  const uniquePresent = records.every((item, index) => item?.body === `synthetic-${Math.floor(index / uniqueEach)}-${index % uniqueEach}`)

  await store.write({ name: 'shared', description: 'synthetic sustained load', type: 'reference', body: 'baseline' }, 'user')
  const churnWorkers = 2
  const churnEach = 10
  const churnStart = performance.now()
  const churnBarrier = join(run, 'churn.go')
  const churnRuns = Array.from({ length: churnWorkers }, (_, id) => runWorker(['churn', root, churnBarrier, String(id), String(churnEach)], 180_000))
  await fs.writeFile(churnBarrier, '')
  const churn = await Promise.all(churnRuns)
  const churnMs = performance.now() - churnStart

  const final = await store.read('shared', 'user')
  const list = await store.list('user')
  const lockFiles = [join(root, '.wh-writer.lock'), join(root, '_user', 'MEMORY.md.lock'), join(root, '_user', '.wh-transaction.json')]
  const leftoverLocks = []
  for (const file of lockFiles) if (await fs.stat(file).then(() => true, () => false)) leftoverLocks.push(relative(root, file))
  const churnSuccesses = churn.reduce((sum, item) => sum + item.written, 0)
  const churnConflicts = churn.reduce((sum, item) => sum + item.conflicts, 0)
  const pass = uniquePresent && unique.every(item => item.written === uniqueEach) && list.length === uniqueWorkers * uniqueEach + 1
    && churnSuccesses === churnWorkers * churnEach && /^churn-[01]-\d+$/.test(String(final?.body))
    && leftoverLocks.length === 0
  const evidence = {
    kind: `fresh synthetic root; ${uniqueWorkers} processes x ${uniqueEach} unique writes, then ${churnWorkers} processes x ${churnEach} revision-churn rounds with retry`,
    run: relative(repo, run),
    node: process.version,
    uniqueWritingMs: Math.round(uniqueMs),
    churnMs: Math.round(churnMs),
    uniqueRecords: uniqueWorkers * uniqueEach,
    recordCount: list.length,
    uniquePresent,
    churnSuccesses,
    churnConflicts,
    finalBody: final?.body ?? null,
    leftoverLocks,
    pass,
    limitations: 'Synthetic local warm filesystem; not a 24/7 soak, not a UI latency measurement, and not a real DSH home.',
  }
  const evidenceDir = join(repo, 'docs', 'evidence', 'S05-rc10-sustained-load')
  await fs.mkdir(evidenceDir, { recursive: true })
  await fs.writeFile(join(evidenceDir, 'result.json'), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify({ pass, uniqueMs: evidence.uniqueWritingMs, churnMs: evidence.churnMs, recordCount: list.length, churnSuccesses, churnConflicts, leftoverLocks }))
  if (!pass) process.exitCode = 1
}

if (process.argv[2] === '--worker') await worker()
else await main()
