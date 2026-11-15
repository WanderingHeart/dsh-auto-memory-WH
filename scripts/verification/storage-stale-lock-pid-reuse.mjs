/**
 * T11 complement: stale-writer-lock identity combinations (PID reuse).
 *
 * The packaged atomic-write library never reads the lock file content and never
 * removes an existing lock on its own; a contender backs off until its
 * `waitMs` deadline and then fails. This probe pins that behavior for four
 * synthetic lock contents so an operator knows exactly what to do:
 *
 *   root-lock-live-pid     lock contains the PID of a live, unrelated process
 *   root-lock-dead-pid     lock contains the PID of a process that already exited
 *   root-lock-garbage      lock contains text that is not a PID at all
 *   scope-lock-live-pid    the same, on the per-scope MEMORY.md lock
 *
 * Expected in every blocked case: a bounded wait of about the store's 10s
 * writer-lock wait, the exact "timed out waiting for the writer lock" error,
 * no record change, no journal/tmp leftovers, and the foreign lock preserved.
 * After the operator removes the lock, a normal write succeeds, proving the
 * recovery path is manual by design.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { MemoryStore } from '../../src/store.ts'

const repo = resolve(import.meta.dirname, '../..')
const base = join(repo, '.work', 'S05', 'stale-lock-identity', 'run-' + Date.now())
const evidenceDir = join(repo, 'docs', 'evidence', 'S05-rc11-stale-lock')
const rootLockWaitMs = 10_000 // withScopeTransaction passes { waitMs: 10_000 } to the root lock
const scopeLockWaitMs = 2_000 // the inner MEMORY.md lock uses the library default wait
const sha = (data) => createHash('sha256').update(data).digest('hex')

const exists = (file) => fs.stat(file).then(() => true, (error) => { if (error.code === 'ENOENT') return false; throw error })
const readText = (file) => fs.readFile(file, 'utf8')
const waitExit = (child) => new Promise((resolveExit) => child.once('exit', resolveExit))
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

async function spawnSleeper(ms) {
  const child = spawn(process.execPath, ['-e', `setTimeout(() => process.exit(0), ${ms})`], { stdio: 'ignore' })
  await sleep(300)
  return child
}

const scenarios = []
async function scenario(name, run) {
  const root = join(base, name, 'memory')
  await fs.mkdir(join(root, '_user'), { recursive: true })
  const store = new MemoryStore(root)
  const initial = await store.write({ name: 'lock-target', description: 'synthetic lock target', type: 'reference', body: 'initial body' }, 'user')
  const recordFile = join(root, '_user', 'lock-target.md')
  const initialHash = sha(await readText(recordFile))
  const lockPath = name.startsWith('scope-')
    ? join(root, '_user', 'MEMORY.md.lock')
    : join(root, '.wh-writer.lock')
  const cleanup = async () => { await fs.rm(lockPath, { force: true }) }
  const state = { name, root: relative(repo, root), lock: relative(repo, lockPath), initialRevision: initial.revision }
  try {
    state.steps = await run({ store, root, lockPath, recordFile, initialHash, initial })
  } finally {
    await cleanup()
  }
  state.passed = state.steps.every((step) => step.pass)
  scenarios.push(state)
}

async function blockedWrite({ store, root, lockPath, recordFile, initialHash, initial }, expectedWaitMs) {
  const started = Date.now()
  let error = null
  try {
    await store.write({ name: 'lock-target', description: 'synthetic lock target', type: 'reference', body: 'updated body', expectedRevision: initial.revision }, 'user')
  } catch (caught) {
    error = caught
  }
  const elapsedMs = Date.now() - started
  const entries = await fs.readdir(join(root, '_user'))
  return [
    { name: 'write was refused', pass: error !== null, detail: error === null ? 'write unexpectedly succeeded' : undefined },
    { name: 'refusal is a bounded writer-lock timeout', pass: error?.message?.includes('timed out waiting for the writer lock') ?? false, detail: error?.message },
    { name: 'waited about the lock window for this lock level', pass: elapsedMs >= expectedWaitMs - 1_200 && elapsedMs <= expectedWaitMs + 6_000, detail: `${elapsedMs} ms (expected about ${expectedWaitMs} ms)` },
    { name: 'record body unchanged', pass: sha(await readText(recordFile)) === initialHash, detail: undefined },
    { name: 'foreign lock preserved', pass: await exists(lockPath), detail: undefined },
    { name: 'no transaction journal or tmp file', pass: !entries.some((entry) => entry.endsWith('.tmp') || entry.includes('transaction')), detail: entries.join(',') },
  ]
}

async function manualRecovery({ store, root, lockPath, initial }) {
  await fs.rm(lockPath, { force: true })
  const updated = await store.write({ name: 'lock-target', description: 'synthetic lock target', type: 'reference', body: 'updated body', expectedRevision: initial.revision }, 'user')
  const reloaded = await store.read('lock-target', 'user')
  const entries = await fs.readdir(join(root, '_user')).catch(() => [])
  return [
    { name: 'write succeeds after operator removes the lock', pass: updated !== null && reloaded?.body === 'updated body', detail: reloaded?.body },
    { name: 'no lock left after the recovery write', pass: !await exists(lockPath), detail: undefined },
    { name: 'no leftover tmp file after recovery', pass: !entries.some((entry) => entry.endsWith('.tmp')), detail: entries.join(',') },
  ]
}

await scenario('root-lock-live-pid', async (context) => {
  const child = await spawnSleeper(20_000)
  await fs.writeFile(context.lockPath, `${child.pid}\n`, 'utf8')
  try {
    return [...await blockedWrite(context, rootLockWaitMs), ...await manualRecovery(context)]
  } finally {
    child.kill()
    await waitExit(child)
  }
})

await scenario('root-lock-dead-pid', async (context) => {
  const child = await spawnSleeper(400)
  const deadPid = child.pid
  await waitExit(child)
  await fs.writeFile(context.lockPath, `${deadPid}\n`, 'utf8')
  return [...await blockedWrite(context, rootLockWaitMs), ...await manualRecovery(context)]
})

await scenario('root-lock-garbage', async (context) => {
  await fs.writeFile(context.lockPath, 'not-a-pid from a crashed writer\n', 'utf8')
  return [...await blockedWrite(context, rootLockWaitMs), ...await manualRecovery(context)]
})

await scenario('scope-lock-live-pid', async (context) => {
  const child = await spawnSleeper(20_000)
  await fs.writeFile(context.lockPath, `${child.pid}\n`, 'utf8')
  try {
    return [...await blockedWrite(context, scopeLockWaitMs), ...await manualRecovery(context)]
  } finally {
    child.kill()
    await waitExit(child)
  }
})

const pass = scenarios.every((item) => item.passed)
const result = {
  pass,
  lockWaitMs: { root: rootLockWaitMs, scope: scopeLockWaitMs },
  boundary: 'Synthetic roots only; the packaged atomic-write library treats any existing lock as owned until its deadline and never removes it; recovery is a manual operator action. The root lock waits 10s (withScopeTransaction option) while the inner MEMORY.md lock waits the library default 2s.',
  scenarios,
}
await fs.mkdir(evidenceDir, { recursive: true })
const evidenceFile = join(evidenceDir, 'result.json')
await fs.writeFile(evidenceFile, JSON.stringify(result, null, 2) + '\n', 'utf8')
console.log(JSON.stringify({ ...result, evidence: relative(repo, evidenceFile), base: relative(repo, base) }, null, 2))
if (!pass) process.exit(1)
