import fs from 'node:fs'
import path from 'node:path'
import { MemoryStore } from '../../src/store.ts'
import { applyChangeset, buildChangeset, verifyChangeset } from '../../src/sync.ts'

const repo = path.resolve(import.meta.dirname, '../..')
const drill = path.join(repo, '.work/S05/sync-offline-drill')
const out = path.join(repo, 'docs/evidence/S05-v040-sync')
fs.rmSync(drill, { recursive: true, force: true })
for (const name of ['a', 'b']) fs.mkdirSync(path.join(drill, name), { recursive: true })
fs.mkdirSync(out, { recursive: true })
const cwd = 'C:/synthetic-sync-offline'
const a = new MemoryStore(path.join(drill, 'a'))
const b = new MemoryStore(path.join(drill, 'b'))
const checks = []
const check = (name, ok, detail) => { checks.push({ name, ok: ok === true, detail }); if (!ok) throw new Error(`FAIL ${name}`) }

await a.write({ name: 'alpha', description: 'alpha base', body: 'alpha body base', type: 'reference', status: 'verified' }, 'project', cwd)
await a.write({ name: 'beta', description: 'beta base', body: 'beta body base', type: 'user' }, 'project', cwd)
const first = await buildChangeset(a, { scope: 'project', cwd, since: 0, deviceId: 'device-a' })
const firstApply = await applyChangeset(b, verifyChangeset(JSON.parse(JSON.stringify(first))), { cwd, approvedChecksum: first.checksum })
check('initial-push', firstApply.created.sort().join(',') === 'alpha,beta', firstApply)
check('imported-as-candidate', (await b.read('alpha', 'project', cwd))?.status === 'candidate')

const bAlpha = (await b.read('alpha', 'project', cwd))
await b.write({ name: 'alpha', description: 'alpha reviewed on B', body: 'alpha body reviewed on B', type: 'reference', status: 'verified', expectedRevision: bAlpha.revision }, 'project', cwd)

await new Promise(resolve => setTimeout(resolve, 5))
const aAlpha = (await a.read('alpha', 'project', cwd))
await a.write({ name: 'alpha', description: 'alpha changed on A', body: 'alpha body changed on A', type: 'reference', status: 'verified', expectedRevision: aAlpha.revision }, 'project', cwd)
await a.write({ name: 'gamma', description: 'gamma new on A', body: 'gamma body', type: 'reference', status: 'verified' }, 'project', cwd)
const second = await buildChangeset(a, { scope: 'project', cwd, since: first.until, deviceId: 'device-a' })
const conflicted = await applyChangeset(b, second, { cwd, approvedChecksum: second.checksum })
check('offline-conflict-detected', conflicted.conflicts.includes('alpha'), conflicted)
check('unrelated-create-flows', conflicted.created.includes('gamma'), conflicted)
check('reviewed-content-kept', (await b.read('alpha', 'project', cwd))?.body === 'alpha body reviewed on B')

const resolved = await applyChangeset(b, second, { cwd, approvedChecksum: second.checksum, onConflict: 'remote' })
check('explicit-remote-wins', resolved.updated.includes('alpha') && (await b.read('alpha', 'project', cwd))?.body === 'alpha body changed on A', resolved)
check('resolved-loses-trust', (await b.read('alpha', 'project', cwd))?.status === 'candidate')

await b.write({ name: 'delta', description: 'delta from B', body: 'delta body', type: 'reference', status: 'verified' }, 'project', cwd)
const back = await buildChangeset(b, { scope: 'project', cwd, since: second.until, deviceId: 'device-b' })
check('b-changeset-has-delta', back.upserts.some(record => record.name === 'delta'), back.upserts.map(record => record.name))
const backApply = await applyChangeset(a, back, { cwd, approvedChecksum: back.checksum })
check('b-to-a-applied', backApply.created.includes('delta') && (await a.read('delta', 'project', cwd))?.body === 'delta body', backApply)

const evidence = {
  pass: checks.every(item => item.ok),
  at: new Date().toISOString(),
  tool: 'scripts/verification/sync-offline-drill.mjs',
  deviceA: 'device-a', deviceB: 'device-b',
  cursors: { first: first.until, second: second.until, back: back.until },
  checks,
  boundary: 'File-based synthetic drill; transport/auth/encryption are out of scope; conflicts require an explicit remote-wins choice or manual merge.',
}
fs.writeFileSync(path.join(out, 'offline-drill.json'), JSON.stringify(evidence, null, 2))
console.log(`RESULT ${evidence.pass ? 'PASS' : 'FAIL'} -> ${path.join(out, 'offline-drill.json')}`)
if (!evidence.pass) process.exit(1)
