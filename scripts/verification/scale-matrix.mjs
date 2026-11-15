/** Large synthetic libraries: list/read/write and real injection-assembly latency through registerInjectionAudit. */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { MemoryStore, serializeMemory, reviewFingerprint } from '../../src/store.ts'
import { renderMemoryIndexDetailAsync } from '../../src/injection.ts'
import { registerInjectionAudit } from '../../src/audit-log.ts'

const repo = path.resolve(import.meta.dirname, '../..')
const scratch = path.join(repo, '.work', 'S05', `scale-matrix-${Date.now()}`)
const sizes = [100, 500, 2000, 5000]
const cwd = 'C:\\synthetic-project\\scale'
const sessionId = 'synthetic-scale-session'
const config = { maxBytes: 4096, enableUserScope: true, staleAfterDays: 0, auditMaxBytes: 8 * 1024 * 1024, auditRetentionDays: 30 }
const samples = []
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

for (const size of sizes) {
  const root = path.join(scratch, String(size))
  await fs.mkdir(path.join(root, '_user'), { recursive: true })
  await fs.writeFile(path.join(root, '.wh-format.json'), JSON.stringify({ format: 'dsh-auto-memory-wh', version: 1 }))
  const createStart = performance.now()
  for (let i = 0; i < size; i++) {
    const record = {
      name: 'syn-' + String(i).padStart(5, '0'),
      title: '合成记录 ' + i,
      description: ('合成 memory fact 中文 ').repeat(3),
      body: 'Synthetic body. '.repeat(20),
      type: 'reference', scope: 'user', status: 'verified',
      createdMs: 1793664000000, updatedMs: 1793664000000, reviewHash: '',
    }
    record.reviewHash = reviewFingerprint(record)
    await fs.writeFile(path.join(root, '_user', record.name + '.md'), serializeMemory(record))
  }
  const createMs = performance.now() - createStart
  const store = new MemoryStore(root)
  const audit = registerInjectionAudit(store, config, root)

  const coldStart = performance.now()
  const coldText = await audit.textAsync(cwd, sessionId)
  const coldMs = performance.now() - coldStart
  const warm = []
  let warmText = coldText
  for (let i = 0; i < 3; i++) {
    const start = performance.now()
    warmText = await audit.textAsync(cwd, sessionId)
    warm.push(performance.now() - start)
  }
  const detail = await renderMemoryIndexDetailAsync(store, config, cwd, undefined)

  const listStart = performance.now()
  const listed = await store.list('user')
  const listMs = performance.now() - listStart
  const middle = listed[Math.floor(listed.length / 2)]?.name
  const readStart = performance.now()
  const read = await store.read(middle, 'user')
  const readMs = performance.now() - readStart
  const writeStart = performance.now()
  let writeError = null
  try {
    await store.write({ name: 'syn-new-at-' + size, description: 'synthetic', type: 'reference', body: 'synthetic after-load' }, 'user')
  } catch (error) { writeError = String(error?.message ?? error) }
  const writeMs = performance.now() - writeStart
  await audit.flush()
  const journalLeft = await fs.stat(path.join(root, '_user', '.wh-transaction.json')).then(() => true, () => false)

  samples.push({
    size,
    createMs: Math.round(createMs),
    coldAssemblyMs: Math.round(coldMs),
    warmAssemblyMedianMs: Math.round(median(warm)),
    listMs: Math.round(listMs),
    readMs: Math.round(readMs),
    writeMs: Math.round(writeMs),
    writeError,
    journalLeft,
    listCount: listed.length,
    readFound: read?.body?.startsWith('Synthetic body.') ?? false,
    assembledBytes: detail.textBytes,
    assembledRecords: detail.records.length,
    truncatedRecords: detail.truncated.length,
    excludedRecords: detail.excluded.length,
    deterministic: coldText === warmText && warmText === warmText,
    withinBudget: detail.textBytes <= config.maxBytes,
  })
  console.log(JSON.stringify(samples.at(-1)))
}

const report = {
  kind: 'fresh synthetic libraries; assembly measured through registerInjectionAudit (real injection path incl. audit attempt)',
  node: process.version,
  cpu: os.cpus()[0]?.model ?? null,
  platform: process.platform,
  sizes,
  budgetBytes: config.maxBytes,
  samples,
  rssBytes: process.memoryUsage().rss,
  limitations: 'Warm local filesystem, synthetic Chinese/ASCII text, no model call, no UI. Not a cold-boot or token-cost benchmark.',
}
const evidenceDir = path.join(repo, 'docs', 'evidence', 'S05-rc10-scale-matrix')
await fs.mkdir(evidenceDir, { recursive: true })
await fs.writeFile(path.join(evidenceDir, 'result.json'), JSON.stringify(report, null, 2) + '\n')
const ok = samples.every(item => item.deterministic && item.withinBudget && item.listCount === item.size && item.readFound && item.assembledBytes > 0
  && (item.size >= 4096 ? item.writeError !== null && item.journalLeft === false : item.writeError === null))
console.log(JSON.stringify({ ok, rssBytes: report.rssBytes }))
if (!ok) process.exitCode = 1
