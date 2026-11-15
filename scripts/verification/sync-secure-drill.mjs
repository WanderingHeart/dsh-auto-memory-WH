import fs from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MemoryStore } from '../../src/store.ts'
import { buildChangeset, verifyChangeset, applyChangeset } from '../../src/sync.ts'
import {
  addTrust,
  generateIdentity,
  loadIdentity,
  loadTrust,
  openEnvelope,
  saveIdentity,
  saveTrust,
  sealChangeset,
  trustEntry,
  IdentityError,
} from '../../src/device-identity.ts'

const repo = 'C:/Users/example-user/Desktop/dsh-plug-in/dsh-auto-memory-WH'
const stage = process.argv[2] ?? 'S05-v040-sync'
const base = join(repo, '.work/S05/sync-secure-drill', String(Date.now()))
const memoryA = join(base, 'memory-a')
const memoryB = join(base, 'memory-b')
const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

await mkdir(base, { recursive: true })
try {
  const identityA = generateIdentity()
  const identityB = generateIdentity()
  const idA = join(base, 'identity-a.json')
  const idB = join(base, 'identity-b.json')
  const trustA = join(base, 'trust-a.json')
  const trustB = join(base, 'trust-b.json')
  await saveIdentity(idA, identityA)
  await saveIdentity(idB, identityB)
  await saveTrust(trustA, addTrust({ version: 1, devices: [] }, trustEntry(identityB, 'device-b')))
  await saveTrust(trustB, addTrust({ version: 1, devices: [] }, trustEntry(identityA, 'device-a')))
  check('identities-created', (await loadIdentity(idA)).deviceId === identityA.deviceId)
  check('trust-persisted', (await loadTrust(trustB)).devices.some(device => device.deviceId === identityA.deviceId))

  const storeA = new MemoryStore(memoryA)
  await storeA.write({ name: 'secure-alpha', description: '安全演练 α', body: 'ALPHA 仅隔离演练', type: 'reference', status: 'verified', pinned: false, disabled: false, importance: 0, reads: 0 }, 'user')
  await storeA.write({ name: 'secure-beta', description: '安全演练 β', body: 'BETA 仅隔离演练', type: 'reference', status: 'candidate', pinned: false, disabled: false, importance: 0, reads: 0 }, 'user')
  const changeset = await buildChangeset(storeA, { deviceId: identityA.deviceId, scope: 'user', since: 0 })
  check('changeset-built', changeset.upserts.length === 2 && typeof changeset.checksum === 'string', `${changeset.upserts.length} upserts`)

  const envelope = sealChangeset(changeset, identityA, trustEntry(identityB))
  const opened = openEnvelope(envelope, identityB, await loadTrust(trustB))
  check('envelope-roundtrip', JSON.stringify(opened) === JSON.stringify(changeset))

  const storeB = new MemoryStore(memoryB)
  const verified = verifyChangeset(opened)
  const applied = await applyChangeset(storeB, verified, { approvedChecksum: verified.checksum })
  const beta = await storeB.read('secure-beta', 'user')
  check('applied-as-candidate', applied.created.length === 2 && beta?.status === 'candidate', `created=${applied.created.length} status=${beta?.status}`)

  const tampered = { ...envelope, ciphertext: Buffer.from(envelope.ciphertext, 'base64').subarray(0, 20).toString('base64') }
  let tamperCode = ''
  try { openEnvelope(tampered, identityB, await loadTrust(trustB)) } catch (error) { tamperCode = error instanceof IdentityError ? error.code : String(error) }
  check('tamper-rejected', tamperCode === 'BAD_SIGNATURE' || tamperCode === 'INVALID_ENVELOPE', tamperCode)

  let untrustedCode = ''
  try { openEnvelope(envelope, identityB, { version: 1, devices: [] }) } catch (error) { untrustedCode = error instanceof IdentityError ? error.code : String(error) }
  check('untrusted-sender-rejected', untrustedCode === 'UNTRUSTED_SENDER', untrustedCode)

  let wrongRecipient = ''
  const identityC = generateIdentity()
  try { openEnvelope(envelope, identityC, await loadTrust(trustB)) } catch (error) { wrongRecipient = error instanceof IdentityError ? error.code : String(error) }
  check('wrong-recipient-rejected', wrongRecipient === 'WRONG_RECIPIENT', wrongRecipient)

  const evidence = {
    stage,
    at: new Date().toISOString(),
    pass: checks.every(item => item.ok),
    checks,
    boundary: [
      '合成数据与临时目录；不涉及真实记忆。',
      '身份/信任文件均为本地文件；没有传输层、没有网络服务。',
      '身份私钥以明文 JSON 保存并由调用方负责权限；未使用 OS keychain。',
      '信封签名覆盖发送方身份、收件人、nonce 与密文；不覆盖文件系统元数据。',
    ],
  }
  const out = join(repo, 'docs/evidence', stage)
  await mkdir(out, { recursive: true })
  await writeFile(join(out, 'secure-drill.json'), JSON.stringify(evidence, null, 2))
  console.log(`RESULT ${evidence.pass ? 'PASS' : 'FAIL'} -> ${join(out, 'secure-drill.json')}`)
  process.exit(evidence.pass ? 0 : 1)
} finally {
  if (process.env.WH_KEEP_DRILL !== '1') await rm(base, { recursive: true, force: true })
}
