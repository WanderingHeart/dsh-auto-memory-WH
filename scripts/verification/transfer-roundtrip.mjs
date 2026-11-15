import fs from 'node:fs'
import path from 'node:path'
import { MemoryStore } from '../../src/store.ts'
import { applyImport, buildExportPackage, planImport, verifyExportPackage } from '../../src/transfer.ts'

const repo = path.resolve(import.meta.dirname, '../..')
const drill = path.join(repo, '.work/S05/transfer-drill')
const out = path.join(repo, 'docs/evidence/S05-v030-transfer')
fs.rmSync(drill, { recursive: true, force: true })
fs.mkdirSync(path.join(drill, 'source'), { recursive: true })
fs.mkdirSync(path.join(drill, 'target'), { recursive: true })
fs.mkdirSync(out, { recursive: true })

const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: ok === true, detail }); if (!ok) throw new Error(`FAIL ${name}`) }
const source = new MemoryStore(path.join(drill, 'source'))
const target = new MemoryStore(path.join(drill, 'target'))
const samples = [
  { name: 'transfer-alpha', description: 'verified transfer sample', body: 'alpha body 中文', type: 'reference', status: 'verified', pinned: true },
  { name: 'transfer-beta', description: 'candidate transfer sample', body: 'beta body', type: 'user' },
  { name: 'transfer-gamma', description: 'disabled transfer sample', body: 'gamma body', type: 'reference', status: 'verified', disabled: true },
]
for (const sample of samples) await source.write(sample, 'user')

const pkg = buildExportPackage(await source.list('user'), { scope: 'user' })
check('package-format', pkg.format === 'wh-memory-export' && pkg.version === 1 && pkg.records.length === 3, { format: pkg.format, version: pkg.version, records: pkg.records.length })
const file = path.join(out, 'package.json')
fs.writeFileSync(file, JSON.stringify(pkg, null, 2))
const parsed = verifyExportPackage(JSON.parse(fs.readFileSync(file, 'utf8')))
check('checksum-stable', parsed.checksum === pkg.checksum && /^[0-9a-f]{64}$/.test(pkg.checksum), parsed.checksum)
const plan = planImport(parsed, [])
check('plan-creates-all', plan.creates.length === 3 && plan.updates.length === 0 && plan.conflicts.length === 0, plan)
const applied = await applyImport(target, parsed, { approvedChecksum: parsed.checksum })
check('applied-all', applied.created.length === 3 && applied.conflicts.length === 0, applied)
for (const sample of samples) {
  const record = await target.read(sample.name, 'user')
  check(`imported-${sample.name}`, Boolean(record) && record.status === 'candidate' && record.body === sample.body && record.disabled !== true && record.pinned !== true, record ? { status: record.status, disabled: record.disabled, pinned: record.pinned } : null)
}
const tampered = { ...parsed, records: parsed.records.map(record => record.name === 'transfer-alpha' ? { ...record, body: 'tampered' } : record) }
let tamperRejected = false
try { verifyExportPackage(tampered) } catch { tamperRejected = true }
check('tamper-rejected', tamperRejected)
const second = await applyImport(target, parsed, { approvedChecksum: parsed.checksum })
check('reapply-skips', second.skipped.length === 3 && second.created.length === 0, second)

const evidence = {
  pass: checks.every(item => item.ok),
  at: new Date().toISOString(),
  tool: 'scripts/verification/transfer-roundtrip.mjs',
  checks,
  checksum: pkg.checksum,
  records: pkg.records.length,
  boundary: 'Synthetic user-scope records; import always resets trust to candidate and clears pinned/disabled; project scope and conflicts covered by tests/transfer.spec.ts.',
}
fs.writeFileSync(path.join(out, 'roundtrip.json'), JSON.stringify(evidence, null, 2))
console.log(`RESULT ${evidence.pass ? 'PASS' : 'FAIL'} -> ${path.join(out, 'roundtrip.json')}`)
if (!evidence.pass) process.exit(1)
