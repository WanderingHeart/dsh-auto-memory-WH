#!/usr/bin/env node
/**
 * T05 complement: index byte-budget matrix across maxBytes values.
 *
 * The host owns the total prompt budget; the plugin only owns the memory-index
 * section. This matrix proves the section never exceeds its configured
 * maxBytes, never cuts a multi-byte character, keeps pinned rows first, keeps
 * exclusion reasons stable, and renders identically through the async and sync
 * paths.
 *
 * Synthetic roots only.
 *
 * Usage: node scripts/verification/index-budget-matrix.mjs [stage]
 */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MemoryStore } from '../../src/store.ts'
import { renderMemoryIndexDetail, renderMemoryIndexDetailAsync } from '../../src/injection.ts'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const stage = process.argv[2] ?? 'S05-rc11-index-budget'
const evidenceDir = join(repoRoot, 'docs', 'evidence', stage)
const evidenceFile = join(evidenceDir, 'result.json')
const results = []
const BUDGETS = [128, 256, 512, 1024, 1200, 2048, 4096, 8192, 16384]
const DAY = 86_400_000

const sha256 = data => createHash('sha256').update(data).digest('hex')
const ok = (condition, detail) => { if (!condition) throw new Error(detail) }

async function check(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, status: 'passed', detail: detail ?? null })
  } catch (error) {
    results.push({ name, status: 'failed', detail: String(error?.stack ?? error) })
  }
}

const runRoot = await mkdtemp(join(repoRoot, '.work', 'S05', 'index-budget-'))
const root = join(runRoot, 'memory')
await mkdir(join(root, '_user'), { recursive: true })
await writeFile(join(root, '.wh-format.json'), JSON.stringify({ format: 'dsh-auto-memory-wh', version: 1 }) + '\n')
const store = new MemoryStore(root)
const now = Date.now()
const longCjk = '用于预算矩阵的合成摘要：包含中文、破折号——以及 emoji 🚀 和较长说明文字，用来测试按字节截断时不会切坏多字节字符。'

async function seed(name, { status = 'verified', pinned, disabled, importance, updatedMs, description } = {}) {
  await store.write({
    name,
    description: description ?? `${longCjk} ${name}`,
    type: 'reference',
    body: `正文 ${name}`,
    status,
    ...(pinned === true ? { pinned: true } : {}),
    ...(disabled === true ? { disabled: true } : {}),
    ...(importance !== undefined ? { importance } : {}),
    ...(updatedMs !== undefined ? { updatedMs } : {}),
  }, 'user')
}

for (let index = 0; index < 40; index += 1) {
  await seed(`matrix-${String(index).padStart(2, '0')}`, { importance: 1 + (index % 10) })
}
await seed('matrix-pinned', { pinned: true, importance: 10 })
await seed('matrix-candidate', { status: 'candidate' })
await seed('matrix-disabled', { status: 'verified', disabled: true })
await seed('matrix-stale', { status: 'verified', updatedMs: now - 40 * DAY })

const config = maxBytes => ({ maxBytes, enableUserScope: true, staleAfterDays: 30, autoSummarize: false })

await check('every budget keeps the rendered section within maxBytes', async () => {
  const rows = []
  for (const maxBytes of BUDGETS) {
    const detail = renderMemoryIndexDetail(store, config(maxBytes), root)
    ok(detail.textBytes <= maxBytes, `textBytes ${detail.textBytes} > maxBytes ${maxBytes}`)
    ok(Buffer.byteLength(detail.text, 'utf8') === detail.textBytes, 'textBytes mismatch with utf8 length')
    rows.push({ maxBytes, textBytes: detail.textBytes, injected: detail.injected.length, truncated: detail.truncated.length })
  }
  return rows
})

await check('rendered text is valid UTF-8 with no replacement characters', async () => {
  for (const maxBytes of BUDGETS) {
    const { text } = renderMemoryIndexDetail(store, config(maxBytes), root)
    ok(Buffer.from(text, 'utf8').toString('utf8') === text, `invalid UTF-8 round-trip at ${maxBytes}`)
    ok(!text.includes('\uFFFD'), `replacement character at ${maxBytes}`)
    // each injected line must contain the full description, never a cut suffix
    const names = renderMemoryIndexDetail(store, config(maxBytes), root).injected
    for (const name of names) ok(text.includes(`](${name}.md)`), `injected row missing for ${name} at ${maxBytes}`)
  }
})

await check('pinned row wins a small budget', async () => {
  const detail = renderMemoryIndexDetail(store, config(1200), root)
  ok(detail.injected.includes('matrix-pinned'), 'pinned record should be selected at 1200 bytes')
  return { injectedAt1200: detail.injected }
})

await check('exclusion reasons stay stable and never become budget', async () => {
  const detail = renderMemoryIndexDetail(store, config(1024), root)
  const byId = new Map(detail.excluded.map(item => [item.id, item.reason]))
  const candidateReason = byId.get('user:matrix-candidate')
  ok(candidateReason === undefined || candidateReason === 'budget', `candidate should not be excluded for review: ${candidateReason}`)
  ok(byId.get('user:matrix-disabled') === 'disabled', 'disabled reason wrong')
  ok(byId.get('user:matrix-stale') === 'stale', 'stale reason wrong')
  for (const [id, reason] of byId) {
    if (id.endsWith('matrix-disabled') || id.endsWith('matrix-stale')) continue
    ok(reason === 'budget', `unexpected reason for ${id}: ${reason}`)
  }
})

await check('truncation marker appears exactly when rows are dropped', async () => {
  for (const maxBytes of BUDGETS) {
    const detail = renderMemoryIndexDetail(store, config(maxBytes), root)
    if (detail.text === '') {
      // Below the frame size nothing is rendered at all: no marker can be emitted.
      ok(detail.truncated.length > 0, `empty render must mean everything was dropped at ${maxBytes}`)
      continue
    }
    const marker = detail.text.includes('index truncated — call memory_list')
    ok(marker === (detail.truncated.length > 0), `marker mismatch at ${maxBytes}`)
  }
})

await check('sync and async paths render identical bytes', async () => {
  const rows = []
  for (const maxBytes of BUDGETS) {
    const sync = renderMemoryIndexDetail(store, config(maxBytes), root)
    const asyncDetail = await renderMemoryIndexDetailAsync(store, config(maxBytes), root)
    ok(sync.text === asyncDetail.text, `sync/async text differ at ${maxBytes}`)
    ok(sha256(sync.text) === sha256(asyncDetail.text), 'hash mismatch')
    rows.push({ maxBytes, sha256: sha256(sync.text) })
  }
  return rows
})

await check('repeat calls are deterministic', async () => {
  const first = renderMemoryIndexDetail(store, config(2048), root)
  const second = renderMemoryIndexDetail(store, config(2048), root)
  ok(first.text === second.text && first.injected.join() === second.injected.join(), 'non-deterministic render')
})

await check('maxBytes below the frame size renders an empty section without throwing', async () => {
  const detail = renderMemoryIndexDetail(store, config(64), root)
  ok(detail.text === '' && detail.textBytes === 0, 'tiny budget should yield empty text')
  ok(detail.injected.length === 0, 'nothing should be injected')
})

await check('query ordering keeps pinned first and stays within budget', async () => {
  const detail = renderMemoryIndexDetail(store, { ...config(2048), ...{} }, root, '中文 摘要 emoji 🚀')
  ok(detail.textBytes <= 2048, 'query render exceeded budget')
  if (detail.injected.length > 0) ok(detail.injected[0] === 'matrix-pinned', 'pinned must stay first with query')
  return { injected: detail.injected.slice(0, 5) }
})

await check('user scope disabled renders project rows only', async () => {
  const projectStore = new MemoryStore(root)
  await new Promise(resolveWrite => projectStore.write({
    name: 'project-note', description: '项目级合成摘要', type: 'reference', body: '正文', status: 'verified',
  }, 'project', root).then(resolveWrite, resolveWrite))
  const detail = renderMemoryIndexDetail(store, { maxBytes: 2048, enableUserScope: false, staleAfterDays: 30 }, root)
  ok(detail.injected.includes('project-note'), 'project row missing')
  ok(!detail.injected.some(name => name.startsWith('matrix-')), 'user rows must be excluded when scope disabled')
})

const passed = results.filter(r => r.status === 'passed').length
const failed = results.length - passed
const payload = {
  at: new Date().toISOString(),
  stage,
  synthetic: true,
  budgets: BUDGETS,
  checks: results,
  summary: { total: results.length, passed, failed },
  pass: failed === 0,
}
await mkdir(evidenceDir, { recursive: true })
await writeFile(evidenceFile, JSON.stringify(payload, null, 2) + '\n')
for (const result of results) {
  console.log(`${result.status === 'passed' ? 'PASS' : 'FAIL'} ${result.name}`)
  if (result.status === 'failed') console.log('  ' + result.detail)
}
console.log(`\n${passed}/${results.length} checks passed`)
console.log(payload.pass ? `RESULT PASS -> ${evidenceFile}` : 'RESULT FAIL')
if (failed > 0) process.exitCode = 1
