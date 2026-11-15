// Offline audit-log resilience matrix: size rotation, retention pruning,
// malformed-line repair, oversized event/file, queue saturation.
//
// Run: node scripts/verification/audit-resilience-matrix.mjs [stage]
// Evidence: docs/evidence/<stage>/result.json

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendAudit, getAuditStatus, readAudit } from '../../src/audit-log.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const stage = process.argv[2] ?? 'S05-rc11-audit-resilience'
if (!/^S05-(?:rc\d+|\d+\.\d+\.\d+)-[a-z0-9-]+$/.test(stage)) throw new Error(`invalid stage: ${stage}`)

const base = path.join(root, '.work/S05/audit-resilience', `run-${Date.now()}`)
const evidenceDir = path.join(root, 'docs/evidence', stage)
const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

function makeRoot(name) {
  const dir = path.join(base, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '.wh-format.json'), `${JSON.stringify({ format: 'dsh-auto-memory-wh', version: 1 })}\n`)
  return dir
}
function auditPath(dir) { return path.join(dir, 'audit.jsonl') }
function lines(dir) {
  if (!fs.existsSync(auditPath(dir))) return []
  return fs.readFileSync(auditPath(dir), 'utf8').split('\n').filter(Boolean)
}
function entry(seq, ts = Date.now(), extra = {}) {
  return {
    kind: 'render_attempt', pluginVersion: '0.1.0-rc.11', ts,
    sessionId: `session-${seq}`, cwd: 'C:\\work\\audit-demo',
    injected: [`record-${seq}`], truncated: [], bytes: 128, ...extra,
  }
}
function parseable(list) {
  return list.every(line => { try { JSON.parse(line); return true } catch { return false } })
}

// --- size rotation keeps newest lines and respects maxBytes ---------------
{
  const dir = makeRoot('rotation')
  for (let i = 1; i <= 20; i++) await appendAudit(dir, entry(i), { maxBytes: 1200, retentionDays: 7 })
  const kept = lines(dir)
  const raw = fs.readFileSync(auditPath(dir))
  record('rotation: file stays within maxBytes', raw.length <= 1200, `${raw.length} bytes`)
  record('rotation: older lines are dropped', kept.length < 20 && kept.length > 0, `${kept.length}/20 lines`)
  record('rotation: newest line retained', kept.at(-1)?.includes('session-20'), kept.at(-1)?.slice(0, 60))
  record('rotation: all retained lines parse', parseable(kept))
  record('rotation: readAudit returns the retained lines', (await readAudit(dir)).length === kept.length, `${(await readAudit(dir)).length}`)
}

// --- retention drops expired events even when budget allows --------------
{
  const dir = makeRoot('retention')
  await appendAudit(dir, entry(1, Date.now() - 30 * 86_400_000), { maxBytes: 4096, retentionDays: 7 })
  await appendAudit(dir, entry(2), { maxBytes: 4096, retentionDays: 7 })
  const kept = lines(dir)
  record('retention: expired event removed', kept.length === 1 && kept[0]?.includes('session-2'), `${kept.length} line(s)`)
  record('retention: readAudit agrees', (await readAudit(dir)).length === 1)
}

// --- malformed lines are counted and repaired on next append -------------
{
  const dir = makeRoot('corrupt-line')
  await appendAudit(dir, entry(1), { maxBytes: 4096 })
  fs.appendFileSync(auditPath(dir), 'this-is-not-json\n')
  await appendAudit(dir, entry(2), { maxBytes: 4096 })
  const status = getAuditStatus(dir)
  const kept = lines(dir)
  record('corrupt line: repair counted', status.repairedLines >= 1, `repairedLines=${status.repairedLines}`)
  record('corrupt line: file rewritten as valid JSON lines', parseable(kept) && kept.length === 2, `${kept.length} lines`)
  record('corrupt line: readAudit skips garbage', (await readAudit(dir)).length === 2)
}

// --- oversized single event is rejected without touching the file --------
{
  const dir = makeRoot('oversized-event')
  const huge = entry(1, Date.now(), { injected: Array.from({ length: 80 }, (_, i) => `record-${i}-${'x'.repeat(60)}`) })
  await appendAudit(dir, huge, { maxBytes: 600 })
  const status = getAuditStatus(dir)
  record('oversized event: append reports a failure', status.lastError !== null, String(status.lastError))
  record('oversized event: nothing written', lines(dir).length === 0, `${lines(dir).length} lines`)
  record('oversized event: status degraded', status.degraded === true)
}

// --- an audit file above the 8MB read cap fails closed -------------------
{
  const dir = makeRoot('oversized-file')
  fs.writeFileSync(auditPath(dir), `${'{"ts":1}\n'.repeat(1_000_000)}`)
  await appendAudit(dir, entry(1), { maxBytes: 1_048_576 })
  const status = getAuditStatus(dir)
  const before = fs.statSync(auditPath(dir)).size
  record('oversized file: append fails closed', status.lastError !== null, String(status.lastError))
  record('oversized file: file left untouched', before > 8 * 1024 * 1024, `${before} bytes`)
  record('oversized file: status degraded', status.degraded === true)
}

// --- queue saturation drops instead of growing unbounded ----------------
{
  const dir = makeRoot('queue-full')
  const pending = Array.from({ length: 300 }, (_, i) => appendAudit(dir, entry(i + 1), { maxBytes: 1_048_576 }))
  await Promise.all(pending)
  const status = getAuditStatus(dir)
  record('queue full: some appends dropped', status.dropped > 0, `dropped=${status.dropped} written=${status.written}`)
  record('queue full: accepted plus dropped equals attempts', status.written + status.dropped === 300, `${status.written}+${status.dropped}`)
  record('queue full: status degraded', status.degraded === true)
  record('queue full: written file parses', parseable(lines(dir)))
}

// --- missing audit file is created, malformed-only file reads as empty ---
{
  const dir = makeRoot('create')
  await appendAudit(dir, entry(1), { maxBytes: 4096 })
  record('missing file: created on first append', fs.existsSync(auditPath(dir)) && lines(dir).length === 1)
  const only = makeRoot('only-garbage')
  fs.writeFileSync(auditPath(only), 'garbage\nmore-garbage\n')
  record('garbage-only file: readAudit returns empty', (await readAudit(only)).length === 0)
  record('garbage-only file: file is preserved for review', fs.readFileSync(auditPath(only), 'utf8').includes('garbage'))
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
    'synthetic audit roots; no plugin host, model call or real profile',
    'retention/rotation use explicit maxBytes/retentionDays per append; deployed defaults are 1MB/7d',
    'queue saturation is process-local; cross-process locking is covered by the storage/lock probes',
  ],
  results,
}, null, 2)}\n`)
console.log(`\nRESULT ${passed ? 'PASS' : 'FAIL'} -> ${path.relative(root, path.join(evidenceDir, 'result.json'))}`)
process.exit(passed ? 0 : 1)
