#!/usr/bin/env node
/**
 * T09 complement: concurrent index readers next to live writers.
 *
 * The host may assemble the prompt while another window is saving. This probe
 * keeps four async render loops running against a memory root that two writer
 * processes mutate, and asserts:
 *   - the rendered section never exceeds maxBytes and never contains U+FFFD;
 *   - renders are either a valid section or an explicit empty "storage busy"
 *     window (never a partial/corrupt section);
 *   - readers never throw, and the final render is complete again;
 *   - no lock/journal/temp leftovers remain.
 *
 * Synthetic roots only. Usage: node concurrent-index-readers.mjs [seconds]
 */
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

import { MemoryStore } from '../../src/store.ts'
import { renderMemoryIndexDetail, renderMemoryIndexDetailAsync } from '../../src/injection.ts'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const stage = process.argv[3] ?? 'S05-rc11-concurrent-readers'
const seconds = Number(process.argv[2] ?? '60')
const evidenceDir = join(repoRoot, 'docs', 'evidence', stage)
const evidenceFile = join(evidenceDir, 'result.json')
const MAX_BYTES = 4096
const results = []
const ok = (condition, detail) => { if (!condition) throw new Error(detail) }

async function check(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, status: 'passed', detail: detail ?? null })
  } catch (error) {
    results.push({ name, status: 'failed', detail: String(error?.stack ?? error) })
  }
}

const runRoot = await mkdtemp(join(repoRoot, '.work', 'S05', 'concurrent-readers-'))
const root = join(runRoot, 'memory')
await mkdir(join(root, '_user'), { recursive: true })
await writeFile(join(root, '.wh-format.json'), JSON.stringify({ format: 'dsh-auto-memory-wh', version: 1 }) + '\n')
const store = new MemoryStore(root)

for (let index = 0; index < 30; index += 1) {
  await store.write({
    name: `seed-${String(index).padStart(2, '0')}`,
    description: `并发读取基线摘要 ${index}：中文、破折号——emoji 🚀 与说明文字`,
    type: 'reference',
    body: `正文 seed-${index}`,
    status: 'verified',
  }, 'user')
}

const durationMs = seconds * 1000
const stats = { renders: 0, empty: 0, maxTextBytes: 0, invalidUtf8: 0, overBudget: 0, byteMismatch: 0, errors: [], syncMismatch: 0 }

function runWriter(mode, id) {
  return new Promise(resolveWorker => {
    const child = spawn(process.execPath, [join(repoRoot, 'scripts', 'verification', 'soak-worker.mjs'), mode, root, String(id), String(durationMs)], {
      cwd: repoRoot,
      env: { ...process.env, SOAK_MAX_UNIQUE_WRITES: '400' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', chunk => { out += chunk.toString() })
    child.stderr.on('data', chunk => { out += chunk.toString() })
    child.on('exit', code => resolveWorker({ mode, id, code, out: out.trim().slice(-2000) }))
  })
}

const writers = [runWriter('unique', 0), runWriter('unique', 1), runWriter('churn', 0), runWriter('churn', 1)]
const deadline = Date.now() + durationMs + 10_000

async function reader(id) {
  while (Date.now() < deadline) {
    try {
      const detail = await renderMemoryIndexDetailAsync(store, { maxBytes: MAX_BYTES, enableUserScope: true, staleAfterDays: 0 }, root)
      stats.renders += 1
      if (detail.textBytes > MAX_BYTES) stats.overBudget += 1
      if (detail.textBytes > stats.maxTextBytes) stats.maxTextBytes = detail.textBytes
      if (detail.text === '') stats.empty += 1
      else {
        if (Buffer.from(detail.text, 'utf8').toString('utf8') !== detail.text) stats.invalidUtf8 += 1
        if (detail.text.includes('\uFFFD')) stats.invalidUtf8 += 1
        if (detail.textBytes !== Buffer.byteLength(detail.text, 'utf8')) stats.byteMismatch += 1
      }
      if (id === 0) {
        const sync = renderMemoryIndexDetail(store, { maxBytes: MAX_BYTES, enableUserScope: true, staleAfterDays: 0 }, root)
        // A concurrent commit may land between the async and sync renders; a
        // difference here is expected and only counted as information.
        if (sync.text !== detail.text) stats.syncMismatch += 1
      }
    } catch (error) {
      stats.errors.push(String(error))
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 25))
  }
}

await Promise.all([...writers, ...[0, 1, 2, 3].map(reader)])
const final = await renderMemoryIndexDetailAsync(store, { maxBytes: MAX_BYTES, enableUserScope: true, staleAfterDays: 0 }, root)
const records = store.scanSync('user')
const leftoverLocks = (await readdir(join(root, '_user'))).filter(name => name.endsWith('.lock'))
const rootEntries = await readdir(root)
const leftoverJournal = rootEntries.includes('.wh-transaction.json') || (await readdir(join(root, '_user'))).includes('.wh-transaction.json')

const payload = { at: new Date().toISOString(), stage, seconds, synthetic: true, stats, final: { textBytes: final.textBytes, injected: final.injected.length, issues: final.issues }, recordCount: records.records.length, leftoverLocks, leftoverJournal, writers }

await check('readers never exceeded the byte budget', async () => {
  ok(stats.overBudget === 0, `overBudget=${stats.overBudget}`)
  ok(stats.maxTextBytes <= MAX_BYTES, `maxTextBytes=${stats.maxTextBytes}`)
  return { maxTextBytes: stats.maxTextBytes, renders: stats.renders }
})

await check('every async section is byte-accurate with no cut characters', async () => {
  ok(stats.invalidUtf8 === 0, `invalidUtf8=${stats.invalidUtf8}`)
  ok(stats.byteMismatch === 0, `byteMismatch=${stats.byteMismatch}`)
  ok(stats.renders > 0 && stats.empty < stats.renders, 'all renders were empty; writers may not have run')
  return { empty: stats.empty, renders: stats.renders, syncObservedNewerCommit: stats.syncMismatch }
})

await check('no reader threw', async () => {
  ok(stats.errors.length === 0, `errors=${stats.errors.slice(0, 3).join(' | ')}`)
})

await check('final render is complete and within budget', async () => {
  ok(final.textBytes <= MAX_BYTES, `final textBytes=${final.textBytes}`)
  ok(final.text !== '' && final.injected.length > 0, 'final render is empty')
  ok(final.issues.every(issue => !issue.includes('storage-unavailable')), `final issues=${final.issues.join(',')}`)
  return { textBytes: final.textBytes, injected: final.injected.length }
})

await check('storage is clean after the concurrent run', async () => {
  ok(leftoverLocks.length === 0, `locks=${leftoverLocks}`)
  ok(leftoverJournal === false, 'journal left behind')
  ok(records.issues.length === 0, `scan issues=${records.issues.join(',')}`)
  ok(records.records.length > 30, `records=${records.records.length}`)
})

const passed = results.filter(r => r.status === 'passed').length
const failed = results.length - passed
payload.checks = results
payload.summary = { total: results.length, passed, failed }
payload.pass = failed === 0
await mkdir(evidenceDir, { recursive: true })
await writeFile(evidenceFile, JSON.stringify(payload, null, 2) + '\n')
for (const result of results) {
  console.log(`${result.status === 'passed' ? 'PASS' : 'FAIL'} ${result.name}`)
  if (result.status === 'failed') console.log('  ' + result.detail)
}
console.log(`\n${passed}/${results.length} checks passed`)
console.log(payload.pass ? `RESULT PASS -> ${evidenceFile}` : 'RESULT FAIL')
if (failed > 0) process.exitCode = 1
