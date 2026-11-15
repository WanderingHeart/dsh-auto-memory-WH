import fs from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MemoryStore } from '../../src/store.ts'
import { createLocalEndpoint } from '../../src/endpoint.ts'
import { addTrust, generateIdentity, trustEntry, openEnvelope, IdentityError } from '../../src/device-identity.ts'

const repo = 'C:/Users/example-user/Desktop/dsh-plug-in/dsh-auto-memory-WH'
const stage = process.argv[2] ?? 'S05-v040-sync'
const base = join(repo, '.work/S05/sync-envelope-drill', String(Date.now()))
const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

await mkdir(base, { recursive: true })
try {
  const a = generateIdentity()
  const b = generateIdentity()
  const storeA = new MemoryStore(join(base, 'a'))
  const storeB = new MemoryStore(join(base, 'b'))
  await storeA.write({ name: 'alpha', description: 'alpha', body: 'A1', type: 'reference', status: 'verified', pinned: false, disabled: false, importance: 0, reads: 0 }, 'user')
  await storeA.write({ name: 'beta', description: 'beta', body: 'B1', type: 'reference', status: 'candidate', pinned: false, disabled: false, importance: 0, reads: 0 }, 'user')
  const endpointA = createLocalEndpoint({ root: join(base, 'a'), scope: 'user', deviceId: a.deviceId, identity: a, trust: addTrust({ version: 1, devices: [] }, trustEntry(b, 'b')), stateFile: join(base, 'a-state.json') })
  const endpointB = createLocalEndpoint({ root: join(base, 'b'), scope: 'user', deviceId: b.deviceId, identity: b, trust: addTrust({ version: 1, devices: [] }, trustEntry(a, 'a')), stateFile: join(base, 'b-state.json') })

  const changes = await endpointA.changes()
  check('changes-exported', changes.upserts.length === 2 && typeof changes.checksum === 'string', `${changes.upserts.length} upserts`)

  const envelope = endpointA.seal(changes, b.deviceId)
  check('envelope-sealed', envelope.format === 'wh-sync-envelope' && envelope.recipient.deviceId === b.deviceId)

  const applied = await endpointB.apply(envelope)
  check('applied-as-candidate', applied.created.length === 2 && (await storeB.read('alpha', 'user'))?.status === 'candidate', `created=${applied.created.length}`)

  const stateB = await endpointB.state()
  check('cursor-advanced', stateB?.cursor === changes.until, `${stateB?.cursor}`)

  const replay = await endpointB.apply(envelope)
  check('replay-idempotent', replay.created.length === 0 && replay.skipped.length === 2, `skipped=${replay.skipped.length}`)

  await storeB.write({ name: 'alpha', description: 'local edit', body: 'LOCAL', type: 'reference', status: 'verified', pinned: true, disabled: false, importance: 0, reads: 0 }, 'user')
  const conflict = await endpointB.apply(envelope)
  check('verified-conflict-reported', conflict.conflicts.includes('alpha') && (await storeB.read('alpha', 'user'))?.body === 'LOCAL', conflict.conflicts.join(','))

  const remote = await endpointB.apply(envelope, { onConflict: 'remote' })
  const after = await storeB.read('alpha', 'user')
  check('remote-wins-downgrades', remote.updated.includes('alpha') && after?.body === 'A1' && after?.status === 'candidate', `${after?.status}`)

  const tampered = { ...envelope, ciphertext: Buffer.from(envelope.ciphertext, 'base64').subarray(0, 24).toString('base64') }
  let tamperCode = ''
  try { await endpointB.apply(tampered) } catch (error) { tamperCode = error instanceof IdentityError ? error.code : String(error) }
  check('tamper-rejected', tamperCode === 'BAD_SIGNATURE' || tamperCode === 'INVALID_ENVELOPE', tamperCode)

  let untrustedCode = ''
  const stranger = generateIdentity()
  try { openEnvelope(envelope, stranger, { version: 1, devices: [] }) } catch (error) { untrustedCode = error instanceof IdentityError ? error.code : String(error) }
  check('untrusted-recipient-rejected', untrustedCode === 'WRONG_RECIPIENT', untrustedCode)

  const evidence = {
    stage,
    at: new Date().toISOString(),
    pass: checks.every(item => item.ok),
    checks,
    boundary: [
      '协议适配桩的本地实现；没有真实传输、账号、服务端或跨设备发现。',
      '身份/信任/游标均为本地文件；私钥明文 JSON。',
      '冲突语义沿用 r132：本地已验证且内容不同默认保留本地，显式 remote 才覆盖。',
      '合成数据与临时目录；不涉及真实记忆。',
    ],
  }
  const out = join(repo, 'docs/evidence', stage)
  await mkdir(out, { recursive: true })
  await writeFile(join(out, 'envelope-drill.json'), JSON.stringify(evidence, null, 2))
  console.log(`RESULT ${evidence.pass ? 'PASS' : 'FAIL'} -> ${join(out, 'envelope-drill.json')}`)
  process.exitCode = evidence.pass ? 0 : 1
} finally {
  if (process.env.WH_KEEP_DRILL !== '1') await rm(base, { recursive: true, force: true })
}
