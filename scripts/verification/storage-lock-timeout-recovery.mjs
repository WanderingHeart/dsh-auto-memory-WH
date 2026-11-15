/** Multi-process writes beyond the 10s writer-lock wait boundary: timeout is expected, retry must recover without corruption. */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { MemoryStore } from '../../src/store.ts'

const repo = resolve(import.meta.dirname, '../..')
const work = join(repo, '.work', 'S05', 'lock-timeout')

const LOCK_TIMEOUT = /timed out waiting for the writer lock/

function delay(ms) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

async function worker() {
  const [, , , mode, root, barrier, id, roundsText] = process.argv
  const rounds = Number(roundsText)
  for (let i = 0; i < 1000; i++) {
    if (await fs.stat(barrier).then(() => true, () => false)) break
    if (i === 999) throw new Error('Worker barrier timeout')
    await delay(10)
  }
  const store = new MemoryStore(root)
  let lockTimeouts = 0
  if (mode === 'unique') {
    for (let i = 0; i < rounds; i++) {
      const name = `load-${id}-${String(i).padStart(3, '0')}`
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          await store.write({ name, description: 'synthetic lock recovery', type: 'reference', body: `synthetic-${id}-${i}` }, 'user')
          break
        } catch (error) {
          if (!LOCK_TIMEOUT.test(String(error?.message)) || attempt === 7) throw error
          lockTimeouts++
          await delay(200 + attempt * 100 + Math.floor(Math.random() * 100))
        }
      }
    }
    console.log(JSON.stringify({ mode, id, written: rounds, lockTimeouts }))
    return
  }
  if (mode === 'churn') {
    let successes = 0
    let conflicts = 0
    for (let round = 0; round < rounds; round++) {
      let done = false
      for (let attempt = 0; attempt < 8 && !done; attempt++) {
        try {
          const current = await store.read('shared', 'user')
          if (!current?.revision) throw new Error('Missing shared baseline')
          try {
            await store.write({ name: 'shared', description: 'synthetic lock recovery', type: 'reference', body: `churn-${id}-${round}`, expectedRevision: current.revision }, 'user')
            successes++
            done = true
          } catch (error) {
            if (!/Revision conflict/.test(String(error?.message))) throw error
            conflicts++
          }
        } catch (error) {
          if (!LOCK_TIMEOUT.test(String(error?.message)) || attempt === 7) throw error
          lockTimeouts++
          await delay(200 + attempt * 100 + Math.floor(Math.random() * 100))
        }
      }
      if (!done) throw new Error(`Churn worker ${id} exhausted retries at round ${round}`)
    }
    console.log(JSON.stringify({ mode, id, written: successes, conflicts, lockTimeouts }))
    return
  }
  throw new Error('Unknown worker mode')
}

function runWorker(args, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [import.meta.filename, '--worker', ...args], { cwd: repo, windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(`Worker ${args[0]}/${args[2]} exited ${code}: ${stderr.slice(0, 1200)}`))
      try { resolvePromise(JSON.parse(stdout.trim().split('\n').at(-1))) }
      catch (error) { reject(new Error(`Invalid worker result: ${stdout.slice(0, 1200)}`, { cause: error })) }
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
  const uniqueEach = 45
  const uniqueStart = performance.now()
  const uniqueBarrier = join(run, 'unique.go')
  const uniqueRuns = Array.from({ length: uniqueWorkers }, (_, id) => runWorker(['unique', root, uniqueBarrier, String(id), String(uniqueEach)], 300_000))
  await fs.writeFile(uniqueBarrier, '')
  const unique = await Promise.all(uniqueRuns)
  const uniqueMs = performance.now() - uniqueStart

  const names = Array.from({ length: uniqueWorkers }, (_, id) => Array.from({ length: uniqueEach }, (_, i) => `load-${id}-${String(i).padStart(3, '0')}`)).flat()
  const records = await Promise.all(names.map(name => store.read(name, 'user')))
  const uniquePresent = records.every((item, index) => item?.body === `synthetic-${Math.floor(index / uniqueEach)}-${index % uniqueEach}`)

  await store.write({ name: 'shared', description: 'synthetic lock recovery', type: 'reference', body: 'baseline' }, 'user')
  const churnWorkers = 2
  const churnEach = 12
  const churnStart = performance.now()
  const churnBarrier = join(run, 'churn.go')
  const churnRuns = Array.from({ length: churnWorkers }, (_, id) => runWorker(['churn', root, churnBarrier, String(id), String(churnEach)], 300_000))
  await fs.writeFile(churnBarrier, '')
  const churn = await Promise.all(churnRuns)
  const churnMs = performance.now() - churnStart

  const final = await store.read('shared', 'user')
  const list = await store.list('user')
  const lockCandidates = [join(root, '.wh-writer.lock'), join(root, '_user', '.wh-transaction.json')]
  const leftoverLocks = []
  for (const file of lockCandidates) if (await fs.stat(file).then(() => true, () => false)) leftoverLocks.push(relative(root, file))
  const uniqueLockTimeouts = unique.reduce((sum, item) => sum + item.lockTimeouts, 0)
  const churnLockTimeouts = churn.reduce((sum, item) => sum + item.lockTimeouts, 0)
  const churnSuccesses = churn.reduce((sum, item) => sum + item.written, 0)
  const churnConflicts = churn.reduce((sum, item) => sum + item.conflicts, 0)
  const contentionIntegrity = uniquePresent && unique.every(item => item.written === uniqueEach)
    && churnSuccesses === churnWorkers * churnEach && /^churn-[01]-\d+$/.test(String(final?.body))

  // Deterministic stale-lock phase: a lock file that outlives the 10s writer wait must fail cleanly and recover after release.
  const staleLock = join(root, '.wh-writer.lock')
  const holdMs = 11_500
  await fs.writeFile(staleLock, '999999\n', { flag: 'wx' })
  const holder = (async () => { await delay(holdMs); await fs.rm(staleLock, { force: true }) })()
  let staleLockTimeouts = 0
  let staleLockWrote = false
  const staleStart = performance.now()
  for (let attempt = 0; attempt < 5 && !staleLockWrote; attempt++) {
    try {
      await store.write({ name: 'stale-lock-recovery', description: 'synthetic stale lock', type: 'reference', body: 'recovered-after-timeout' }, 'user')
      staleLockWrote = true
    } catch (error) {
      if (!LOCK_TIMEOUT.test(String(error?.message)) || attempt === 4) throw error
      staleLockTimeouts++
      await delay(300)
    }
  }
  await holder
  const staleElapsedMs = Math.round(performance.now() - staleStart)
  const staleRecord = await store.read('stale-lock-recovery', 'user')
  const staleLockLeft = await fs.stat(staleLock).then(() => true, () => false)
  const afterStaleList = await store.list('user')

  const pass = contentionIntegrity && list.length === uniqueWorkers * uniqueEach + 1
    && leftoverLocks.length === 0
    && staleLockWrote && staleLockTimeouts >= 1 && !staleLockLeft
    && staleRecord?.body === 'recovered-after-timeout' && afterStaleList.length === list.length + 1
  const evidence = {
    kind: `fresh synthetic root; ${uniqueWorkers} processes x ${uniqueEach} unique writes and ${churnWorkers} x ${churnEach} churn rounds, then a deterministic 11.5s stale writer lock with retry`,
    run: relative(repo, run),
    node: process.version,
    uniqueWritingMs: Math.round(uniqueMs),
    churnMs: Math.round(churnMs),
    uniqueLockTimeouts,
    churnLockTimeouts,
    churnSuccesses,
    churnConflicts,
    recordCount: list.length,
    uniquePresent,
    finalBody: final?.body ?? null,
    leftoverLocks,
    staleLockTimeouts,
    staleLockElapsedMs: staleElapsedMs,
    staleLockWrote,
    staleLockLeft,
    pass,
    limitations: 'Synthetic local warm filesystem; the timeout phase uses an operator-created lock file, not a crashed process. Not a soak test and not a real DSH home.',
  }
  const evidenceDir = join(repo, 'docs', 'evidence', 'S05-rc10-lock-timeout')
  await fs.mkdir(evidenceDir, { recursive: true })
  await fs.writeFile(join(evidenceDir, 'result.json'), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify({ pass, uniqueMs: evidence.uniqueWritingMs, churnMs: evidence.churnMs, uniqueLockTimeouts, churnLockTimeouts, recordCount: list.length, churnConflicts, leftoverLocks }))
  if (!pass) process.exitCode = 1
}

if (process.argv[2] === '--worker') await worker()
else await main()
