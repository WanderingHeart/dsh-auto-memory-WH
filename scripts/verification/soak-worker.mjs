// One sustained-load worker for soak-mixed-load.mjs.
// Usage: node soak-worker.mjs <unique|churn> <memoryRoot> <workerId> <durationMs>

import { MemoryStore } from '../../src/store.ts'

const [mode, root, workerIdArg, durationArg] = process.argv.slice(2)
if (!mode || !root) throw new Error('usage: node soak-worker.mjs <unique|churn> <memoryRoot> <workerId> <durationMs>')
const workerId = Number(workerIdArg ?? '0')
const durationMs = Number(durationArg ?? '60000')
const deadline = Date.now() + durationMs
const maxUniqueWrites = Number(process.env.SOAK_MAX_UNIQUE_WRITES ?? '0')

const store = new MemoryStore(root, { staleAfterDays: 0 })
const stats = { workerId, mode, writes: 0, conflicts: 0, timeouts: 0, busy: 0, errors: 0, lastError: null }

let n = 0
while (Date.now() < deadline) {
  if (mode === 'unique' && maxUniqueWrites > 0 && stats.writes >= maxUniqueWrites) break
  // A failed attempt must retry the same logical write; otherwise timing-out
  // writes leave gaps in the unique sequence and the load becomes unverifiable.
  const attempt = n + 1
  try {
    if (mode === 'unique') {
      await store.write({ name: `soak-${workerId}-${attempt}`, description: `soak unique ${workerId}`, type: 'reference', status: 'verified', body: `worker ${workerId} write ${attempt}` }, 'user')
    } else {
      const current = await store.read('soak-churn', 'user')
      const base = { name: 'soak-churn', description: `soak churn ${workerId}`, type: 'reference', status: 'verified', body: `churn-${workerId}-${attempt}` }
      await store.write(current ? { ...base, expectedRevision: current.revision } : base, 'user')
    }
    n = attempt
    stats.writes++
    // Model human-paced writes: without a think time the single-writer lock is
    // held back-to-back and every concurrent read is rejected as "storage busy".
    await new Promise(resolve => setTimeout(resolve, mode === 'unique' ? 200 : 50))
  } catch (error) {
    const message = String(error?.message ?? error)
    if (/timed out waiting for the writer lock/i.test(message)) {
      stats.timeouts++
      await new Promise(resolve => setTimeout(resolve, 40 + Math.random() * 120))
    } else if (/storage busy or recovery required/i.test(message)) {
      stats.busy++
      await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 90))
    } else if (/conflict|changed since/i.test(message)) {
      stats.conflicts++
      await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 60))
    } else {
      stats.errors++
      if (!stats.lastError) stats.lastError = message.slice(0, 300)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
}

console.log(JSON.stringify(stats))
