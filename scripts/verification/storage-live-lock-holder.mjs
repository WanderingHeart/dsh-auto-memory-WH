/** Live cross-process lock holder: timeout must not steal a writer's lock. */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { MemoryStore } from '../../src/store.ts'
import { releaseStaleLock } from '../../src/maintenance.ts'
import { sha256 } from '../../src/storage-safety.ts'

const repo = resolve(import.meta.dirname, '../..')
const record = body => ({ name: 'sample', description: 'synthetic live lock holder', type: 'reference', body })
const exists = file => fs.stat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })

async function holder() {
  const [, , , root, ready, release] = process.argv
  await withFileLock(join(root, '.wh-writer'), async () => {
    await fs.writeFile(ready, String(process.pid))
    for (let i = 0; i < 2500; i++) {
      if (await exists(release)) return
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error('Holder release timeout')
  })
}

async function waitFor(file, limitMs = 5000) {
  const deadline = Date.now() + limitMs
  while (Date.now() < deadline) {
    if (await exists(file)) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${file}`)
}

async function parent() {
  const base = join(repo, '.work', 'S05', 'live-lock-holder')
  await fs.mkdir(base, { recursive: true })
  const run = join(base, `run-${Date.now()}-${randomUUID()}`)
  const root = join(run, 'memory')
  const ready = join(run, 'holder.ready')
  const release = join(run, 'holder.release')
  await fs.mkdir(run)
  const store = new MemoryStore(root)
  await store.write(record('baseline'), 'user')
  const file = join(root, '_user', 'sample.md')
  const before = sha256(await fs.readFile(file))
  const child = spawn(process.execPath, [import.meta.filename, '--holder', root, ready, release], { cwd: repo, windowsHide: true })
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  const childDone = new Promise((resolveDone, reject) => {
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolveDone() : reject(new Error(`Holder exited ${code}: ${stderr.slice(0, 1000)}`)))
  })
  const killTimer = setTimeout(() => child.kill(), 25_000)
  let timeoutError = ''; let elapsedMs = 0; let readBlocked = false; let reclaimBlocked = false
  let lockStable = false; let failedWriteUnchanged = false; let lockOwnerMatches = false
  try {
    await waitFor(ready)
    const lock = join(root, '.wh-writer.lock')
    const lockBytes = await fs.readFile(lock)
    lockOwnerMatches = lockBytes.toString('utf8').trim() === (await fs.readFile(ready, 'utf8')).trim()
    try { await store.read('sample', 'user') }
    catch (error) { readBlocked = /recovery|required|busy/i.test(String(error?.message)) }
    try { await releaseStaleLock({ root, lock: '.wh-writer.lock', expectedHash: sha256(lockBytes), writersStopped: true }) }
    catch (error) { reclaimBlocked = /owner is alive/i.test(String(error?.message)) }
    const started = Date.now()
    try { await store.write(record('contender'), 'user') }
    catch (error) { timeoutError = String(error?.message) }
    elapsedMs = Date.now() - started
    lockStable = sha256(await fs.readFile(lock)) === sha256(lockBytes)
    failedWriteUnchanged = sha256(await fs.readFile(file)) === before
  } finally {
    await fs.writeFile(release, '')
    try { await childDone } finally { clearTimeout(killTimer) }
  }
  await store.write(record('after-release'), 'user')
  const final = await store.read('sample', 'user')
  const noRootLock = !await exists(join(root, '.wh-writer.lock'))
  const noJournal = !await exists(join(root, '_user', '.wh-transaction.json'))
  const pass = lockOwnerMatches && readBlocked && reclaimBlocked && /timed out waiting for the writer lock/.test(timeoutError)
    && elapsedMs >= 9_000 && elapsedMs <= 15_000 && lockStable && failedWriteUnchanged
    && final?.body === 'after-release' && noRootLock && noJournal
  const evidence = { kind: 'fresh synthetic root; live child holds writer lock across contender timeout', run: relative(repo, run), node: process.version, lockOwnerMatches, readBlocked, reclaimBlocked, timedOut: /timed out waiting for the writer lock/.test(timeoutError), elapsedMs, lockStable, failedWriteUnchanged, finalBody: final?.body, noRootLock, noJournal, pass }
  const evidenceDir = join(repo, 'docs', 'evidence', 'S05-live-lock-holder')
  await fs.mkdir(evidenceDir, { recursive: true })
  await fs.writeFile(join(evidenceDir, 'result.json'), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify({ pass, readBlocked, reclaimBlocked, timedOut: evidence.timedOut, elapsedMs, lockStable, failedWriteUnchanged, finalBody: final?.body, noRootLock, noJournal }))
  if (!pass) process.exitCode = 1
}

if (process.argv[2] === '--holder') await holder()
else await parent()
