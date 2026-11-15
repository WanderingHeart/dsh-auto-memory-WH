// Sustained mixed-load soak across several processes.
// Usage: node soak-mixed-load.mjs [minutes] [uniqueWorkers] [churnWorkers]
// Writes docs/evidence/S05-rc11-soak/result.json

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { MemoryStore } from '../../src/store.ts'
import { renderMemoryIndexDetail } from '../../src/injection.ts'

const minutes = Number(process.argv[2] ?? '10')
const uniqueWorkers = Number(process.argv[3] ?? '2')
const churnWorkers = Number(process.argv[4] ?? '2')
const durationMs = Math.round(minutes * 60_000)
const repo = process.cwd()
const runRoot = path.join(repo, '.work', 'S05', 'soak-load', 'run-' + Date.now())
const memoryRoot = path.join(runRoot, 'memory')
fs.mkdirSync(memoryRoot, { recursive: true })

const config = { maxBytes: 4096, enableUserScope: true, staleAfterDays: 0, memoryDir: memoryRoot }
const store = new MemoryStore(memoryRoot, { staleAfterDays: 0 })

function runWorker(mode, id) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(repo, 'scripts', 'verification', 'soak-worker.mjs'), mode, memoryRoot, String(id), String(durationMs)], { cwd: repo, env: { ...process.env, SOAK_MAX_UNIQUE_WRITES: process.env.SOAK_MAX_UNIQUE_WRITES ?? '120' } })
    let out = ''
    let err = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { err += chunk })
    child.on('close', code => {
      let stats = null
      const lines = out.trim().split(/\r?\n/).filter(Boolean)
      try { stats = JSON.parse(lines.at(-1)) } catch {}
      resolve({ code, mode, id, stats, stderr: err.slice(0, 800) })
    })
  })
}

const samples = []
const startedAt = Date.now()
const workers = []
for (let i = 0; i < uniqueWorkers; i++) workers.push(runWorker('unique', i))
for (let i = 0; i < churnWorkers; i++) workers.push(runWorker('churn', i))

let sampling = true
const sampleEveryMs = Math.max(2000, Math.min(30_000, Math.round(durationMs / 6)))
async function readState() {
  let lastError = null
  for (let attempt = 1; attempt <= 40; attempt++) {
    try {
      const t0 = performance.now()
      const records = await store.list('user')
      const listMs = Math.round(performance.now() - t0)
      const t1 = performance.now()
      const detail = renderMemoryIndexDetail(store, config, memoryRoot)
      const indexMs = Math.round(performance.now() - t1)
      return { records, detail, listMs, indexMs, attempts: attempt }
    } catch (error) {
      lastError = String(error?.message ?? error)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  throw new Error(lastError)
}
const sampler = (async () => {
  while (sampling) {
    await new Promise(resolve => setTimeout(resolve, sampleEveryMs))
    if (!sampling) break
    try {
      const state = await readState()
      samples.push({ atMs: Date.now() - startedAt, listMs: state.listMs, indexMs: state.indexMs, records: state.records.length, textBytes: state.detail.textBytes, injected: state.detail.injected.length, attempts: state.attempts, rss: process.memoryUsage().rss })
    } catch (error) {
      samples.push({ atMs: Date.now() - startedAt, error: String(error?.message ?? error).slice(0, 300) })
    }
  }
})()

const results = await Promise.all(workers)
sampling = false
await sampler

const checks = []
function check(name, ok, detail) { checks.push({ name, ok, detail }); if (!ok) console.error('FAIL ' + name + (detail ? ' :: ' + detail : '')) }

for (const worker of results) {
  check(`worker ${worker.mode}#${worker.id} exited cleanly`, worker.code === 0, worker.stderr)
  check(`worker ${worker.mode}#${worker.id} reported no errors`, worker.stats && worker.stats.errors === 0, JSON.stringify(worker.stats))
}
const finalState = await readState()
const records = finalState.records
const byName = new Map(records.map(record => [record.name, record]))
const uniqueStats = results.filter(worker => worker.mode === 'unique')
const churnStats = results.filter(worker => worker.mode === 'churn')
for (const worker of uniqueStats) {
  const writes = worker.stats?.writes ?? 0
  let found = 0
  for (let n = 1; n <= writes; n++) if (byName.has(`soak-${worker.id}-${n}`)) found++
  check(`unique worker #${worker.id} records all present (${writes})`, found === writes, `${found}/${writes}`)
}
const churn = byName.get('soak-churn')
check('churn record exists', Boolean(churn))
check('churn body well formed', Boolean(churn && /^churn-\d+-\d+$/.test(churn.body)), churn?.body)
check('list count matches unique writes + churn', records.length === uniqueStats.reduce((sum, worker) => sum + (worker.stats?.writes ?? 0), 0) + (churn ? 1 : 0), `records=${records.length}`)

const scan = store.scanSync('user')
check('user scan reports no issues', scan.issues.length === 0, scan.issues.join(','))
const leftovers = []
for (const candidate of ['.wh-writer.lock', '_user/.wh-transaction.json', '_user/MEMORY.md.lock']) {
  if (fs.existsSync(path.join(memoryRoot, candidate))) leftovers.push(candidate)
}
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.tmp$/i.test(entry.name) || /\.journal$/i.test(entry.name)) leftovers.push(path.relative(memoryRoot, full))
  }
}
walk(memoryRoot)
check('no leftover locks, journals or tmp files', leftovers.length === 0, leftovers.join(','))

const detail = finalState.detail
check('index assembly stays within budget', detail.textBytes <= config.maxBytes && detail.injected.length > 0, `bytes=${detail.textBytes} injected=${detail.injected.length}`)
check('sampling produced at least one clean sample', samples.length > 0 && samples.some(sample => !sample.error), JSON.stringify(samples.at(-1)))

const pass = checks.every(item => item.ok)
const result = {
  pass, stage: 'S05-rc11-soak', at: new Date().toISOString(),
  durationMinutes: minutes, durationMs, workers: { unique: uniqueWorkers, churn: churnWorkers },
  checks, samples, workerStats: results.map(({ code, mode, id, stats, stderr }) => ({ code, mode, id, stats, stderr })),
  final: {
    records: records.length, churn,
    uniqueWrites: uniqueStats.reduce((sum, worker) => sum + (worker.stats?.writes ?? 0), 0),
    conflicts: churnStats.reduce((sum, worker) => sum + (worker.stats?.conflicts ?? 0), 0),
    timeouts: results.reduce((sum, worker) => sum + (worker.stats?.timeouts ?? 0), 0),
    busyRetries: results.reduce((sum, worker) => sum + (worker.stats?.busy ?? 0), 0),
    indexBytes: detail.textBytes, injected: detail.injected.length, leftOver: leftovers,
    root: memoryRoot,
  },
  boundary: 'Synthetic root on Windows, processes on one machine, no model calls; slower or larger real stores are out of scope.',
}
const outDir = path.join(repo, 'docs', 'evidence', 'S05-rc11-soak')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(`RESULT ${pass ? 'PASS' : 'FAIL'} -> docs/evidence/S05-rc11-soak/result.json`)
if (!pass) process.exitCode = 1
