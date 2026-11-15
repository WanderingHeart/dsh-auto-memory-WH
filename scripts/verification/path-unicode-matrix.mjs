// Offline path/name normalization, unicode content, foreign-file scan and
// index-budget/exclusion semantics on synthetic roots.
//
// Run: node scripts/verification/path-unicode-matrix.mjs [stage]
// Evidence: docs/evidence/<stage>/result.json

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MemoryStore } from '../../src/store.ts'
import { renderMemoryIndexDetail } from '../../src/injection.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const stage = process.argv[2] ?? 'S05-rc11-path-unicode'
if (!/^S05-(?:rc\d+|\d+\.\d+\.\d+)-[a-z0-9-]+$/.test(stage)) throw new Error(`invalid stage: ${stage}`)

const base = path.join(root, '.work/S05/path-unicode-matrix', `run-${Date.now()}`)
const evidenceDir = path.join(root, 'docs/evidence', stage)
const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
function makeRoot(name) {
  const dir = path.join(base, name, 'memory')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
async function rejection(promise) {
  try { await promise; return null } catch (error) { return error instanceof Error ? error.message : String(error) }
}

const projectCwd = 'C:\\work\\path-demo'
const config = { maxBytes: 1200, enableUserScope: true, staleAfterDays: 0 }

// --- canonical name enforcement and flat file layout ---------------------
{
  const memory = makeRoot('names')
  const store = new MemoryStore(memory)
  const first = await store.write({ name: 'case-one', description: '第一次写入', type: 'reference', body: 'body', status: 'verified' }, 'user')
  const second = await store.write({ name: 'case-one', description: '第二次写入', type: 'reference', body: 'body2', status: 'verified' }, 'user')
  record('name: repeated canonical write reuses one file', first && second && (await store.list('user')).length === 1, fs.readdirSync(path.join(memory, '_user')).filter(n => n.endsWith('.md')).join(','))
  record('name: second write replaced the first', (await store.read('case-one', 'user'))?.description === '第二次写入')
  for (const bad of ['Case-One', '../evil', 'a/b', '中文记录', 'CON', 'n' + 'a'.repeat(80)]) {
    const message = await rejection(store.write({ name: bad, description: 'x', type: 'reference', body: 'x' }, 'user'))
    record(`name: non-canonical ${JSON.stringify(bad).slice(0, 18)} is rejected`, Boolean(message), message)
  }
  record('name: no file escaped the scope directory', !fs.existsSync(path.join(base, 'names', 'evil.md')) && !fs.existsSync(path.join(memory, 'evil.md')))
  record('name: rejected writes created no extra record files', fs.readdirSync(path.join(memory, '_user')).filter(n => n.endsWith('.md') && n !== 'MEMORY.md').length === 1, fs.readdirSync(path.join(memory, '_user')).join(','))
  const traversalRead = await store.read('../evil', 'user')
  record('name: traversal-shaped read does not escape', traversalRead === null)
  const created = fs.readdirSync(path.join(memory, '_user'))
  record('name: only flat .md files were created', created.every(n => !n.includes('/') && !n.includes('\\')), created.join(','))
}

// --- unicode description/body round-trip ---------------------------------
{
  const memory = makeRoot('unicode')
  const store = new MemoryStore(memory)
  const body = '---\n# 标题\nname: evil\n正文含 : 与 \\ 与 emoji 🚀 与表格 |a|b|。\n'
  const description = '中文摘要 — 含破折号、emoji 🚀 与 URL https://example.invalid/x'
  const created = await store.write({ name: 'unicode-content', description, type: 'reference', body, status: 'verified' }, 'user')
  const read = await store.read('unicode-content', 'user')
  record('unicode: description round-trips', read?.description === description)
  record('unicode: body round-trips (parser trims one trailing newline)', read?.body === body.replace(/\n$/, ''))
  record('unicode: file parses on disk', created?.name === 'unicode-content')
  const detail = renderMemoryIndexDetail(store, config, projectCwd)
  record('unicode: index contains the record', detail.text.includes('unicode-content') || detail.text.includes('中文摘要'), `${detail.textBytes} bytes`)
  record('unicode: index text is valid utf8', Buffer.from(detail.text, 'utf8').toString('utf8') === detail.text)
}

// --- foreign/broken files in a scope directory ---------------------------
{
  const memory = makeRoot('foreign')
  const store = new MemoryStore(memory)
  await store.write({ name: 'valid-one', description: '有效记录', type: 'reference', body: 'ok', status: 'verified' }, 'user')
  const dir = path.join(memory, '_user')
  const front = (name) => `---\nname: ${name}\ndescription: 外部文件\ntype: reference\n---\nbody\n`
  fs.writeFileSync(path.join(dir, '记忆.md'), front('记忆'))
  fs.writeFileSync(path.join(dir, 'note with space.md'), front('note with space'))
  fs.writeFileSync(path.join(dir, 'broken.md'), 'not frontmatter\n')
  fs.writeFileSync(path.join(dir, 'con.md'), front('con'))
  fs.writeFileSync(path.join(dir, 'MEMORY.MD'), '# fake index\n')
  const failClosed = store.scanSync('user')
  record('foreign: device-name file (con.md) makes the sync scan fail closed', failClosed.records.length === 0 && failClosed.issues.includes('storage-unavailable'), JSON.stringify(failClosed.issues))
  const listedWhileBlocked = await store.list('user')
  record('foreign: list still returns readable records while scan is blocked', listedWhileBlocked.some(r => r.name === 'valid-one'), listedWhileBlocked.map(r => r.name).join(','))
  const blockedDetail = renderMemoryIndexDetail(store, config, projectCwd)
  record('foreign: fail-closed scan injects nothing (no silent partial index)', blockedDetail.injected.length === 0 && blockedDetail.textBytes === 0 && blockedDetail.issues.includes('user:storage-unavailable'), JSON.stringify(blockedDetail.issues))
  fs.unlinkSync(path.join(dir, 'con.md'))
  const scan = store.scanSync('user')
  record('foreign: valid record parses once device-name file is gone', scan.records.some(r => r.name === 'valid-one'))
  record('foreign: malformed files reported as invalid-record', scan.issues.filter(issue => issue === 'invalid-record').length >= 3, `${scan.issues.length} issue(s)`)
  record('foreign: uppercase index file is not a record', !scan.records.some(r => r.name.toLowerCase() === 'memory'))
  const listed = await store.list('user')
  record('foreign: list returns the valid record without throwing', listed.some(r => r.name === 'valid-one'), `${listed.length}`)
  const detail = renderMemoryIndexDetail(store, config, projectCwd)
  record('foreign: index still renders the valid record', detail.injected.includes('valid-one'), detail.injected.join(','))
  record('foreign: issues are surfaced in the detail', detail.issues.length >= 3, `${detail.issues.length} issue(s)`)
  record('foreign: broken files did not corrupt the index', !detail.text.includes('not frontmatter'))
}

// --- budget, pinned priority, trust exclusions ---------------------------
{
  const memory = makeRoot('budget')
  const store = new MemoryStore(memory)
  const long = (i) => `第${i}条：${'用于预算测试的较长摘要内容。'.repeat(6)}`
  for (let i = 1; i <= 10; i++) await store.write({ name: `bulk-${i}`, description: long(i), type: 'reference', body: 'x', status: 'verified' }, 'user')
  await store.write({ name: 'pin-one', description: long('pinned'), type: 'reference', body: 'x', status: 'verified', pinned: true }, 'user')
  await store.write({ name: 'cand-one', description: long('candidate'), type: 'reference', body: 'x' }, 'user')
  await store.write({ name: 'muted-one', description: long('muted'), type: 'reference', body: 'x', status: 'verified', disabled: true }, 'user')
  const detail = renderMemoryIndexDetail(store, config, projectCwd)
  record('budget: text stays within maxBytes', detail.textBytes <= config.maxBytes, `${detail.textBytes}/${config.maxBytes}`)
  record('budget: pinned record survives the budget', detail.injected.includes('pin-one'), detail.injected.join(','))
  record('budget: some records are truncated', detail.truncated.length > 0, `${detail.truncated.length} truncated`)
  record('budget: truncation is reported as reason=budget', detail.excluded.some(e => e.reason === 'budget'))
  record('budget: candidate is no longer excluded for review', !detail.excluded.some(e => e.id.endsWith(':cand-one') && e.reason === 'candidate'), JSON.stringify(detail.excluded.filter(e => e.id.includes('cand-one'))))
  record('budget: disabled record is excluded as disabled', detail.excluded.some(e => e.id.endsWith(':muted-one') && e.reason === 'disabled'), JSON.stringify(detail.excluded.filter(e => e.id.includes('muted-one'))))
  record('budget: injected ids match rendered lines', detail.records.length === detail.injected.length)
}

// --- evidence -------------------------------------------------------------
const passed = results.every(r => r.ok)
fs.mkdirSync(evidenceDir, { recursive: true })
fs.writeFileSync(path.join(evidenceDir, 'result.json'), `${JSON.stringify({
  stage,
  status: passed ? 'passed' : 'failed',
  generatedAt: new Date().toISOString(),
  base: path.relative(root, base).replaceAll('\\', '/'),
  boundary: [
    'synthetic roots and records; no real profile, native window or model call',
    'name normalization is slug-based; CJK names are rejected rather than transliterated',
    'index budget uses an explicit 1200-byte limit, not the deployed default',
  ],
  results,
}, null, 2)}\n`)
console.log(`\nRESULT ${passed ? 'PASS' : 'FAIL'} -> ${path.relative(root, path.join(evidenceDir, 'result.json'))}`)
process.exit(passed ? 0 : 1)
