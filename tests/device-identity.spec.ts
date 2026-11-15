import { describe, it, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  IdentityError,
  addTrust,
  deviceIdFromPublicKey,
  generateIdentity,
  loadIdentity,
  loadTrust,
  openEnvelope,
  removeTrust,
  saveIdentity,
  saveTrust,
  sealChangeset,
  trustEntry,
  verifyEnvelope,
} from '../src/device-identity.ts'

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'wh-identity-'))
}

const changeset = { format: 'wh-sync-changeset', version: 1, deviceId: 'dev-a', scope: 'user', upserts: [{ name: 'alpha', body: 'A' }], deletions: [], checksum: 'x' }

describe('device identity', () => {
  it('creates a persistent identity whose device id matches the signing key', async () => {
    const dir = await tempDir()
    const identity = generateIdentity()
    expect(identity.deviceId).toMatch(/^dev-[0-9a-f]{16}$/)
    expect(identity.deviceId).toBe(deviceIdFromPublicKey(identity.signPublicKey))
    const file = join(dir, 'identity.json')
    await saveIdentity(file, identity)
    const loaded = await loadIdentity(file)
    expect(loaded.deviceId).toBe(identity.deviceId)
    expect(loaded.encPublicKey).toBe(identity.encPublicKey)
  })

  it('adds and removes trusted devices', async () => {
    const dir = await tempDir()
    const store = { version: 1 as const, devices: [] }
    const a = generateIdentity()
    const b = generateIdentity()
    const withA = addTrust(store, trustEntry(a, 'laptop'))
    const withBoth = addTrust(withA, trustEntry(b))
    expect(withBoth.devices.map(device => device.deviceId).sort()).toEqual([a.deviceId, b.deviceId].sort())
    const file = join(dir, 'trust.json')
    await saveTrust(file, withBoth)
    expect((await loadTrust(file)).devices).toHaveLength(2)
    expect(removeTrust(withBoth, a.deviceId).devices.map(device => device.deviceId)).toEqual([b.deviceId])
    expect((await loadTrust(join(dir, 'missing.json'))).devices).toEqual([])
  })

  it('seals a changeset for a trusted peer and opens it', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const envelope = sealChangeset(changeset, a, trustEntry(b))
    expect(envelope.format).toBe('wh-sync-envelope')
    expect(envelope.recipient.deviceId).toBe(b.deviceId)
    expect(verifyEnvelope(envelope)).toBe(envelope)
    const opened = openEnvelope(envelope, b, { version: 1 as const, devices: [trustEntry(a)] })
    expect(opened).toEqual(changeset)
  })

  it('rejects envelopes from untrusted senders before decrypting', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const envelope = sealChangeset(changeset, a, trustEntry(b))
    expect(() => openEnvelope(envelope, b, { version: 1 as const, devices: [] })).toThrowError(/未在信任列表/)
  })

  it('rejects envelopes addressed to another device', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const c = generateIdentity()
    const envelope = sealChangeset(changeset, a, trustEntry(b))
    expect(() => openEnvelope(envelope, c, { version: 1 as const, devices: [trustEntry(a)] })).toThrowError(/收件人不是本设备/)
  })

  it('rejects a tampered ciphertext or signature', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    const trust = { version: 1 as const, devices: [trustEntry(a)] }
    const envelope = sealChangeset(changeset, a, trustEntry(b))
    const raw = Buffer.from(envelope.ciphertext, 'base64')
    raw[0] ^= 0xff
    const tampered = { ...envelope, ciphertext: raw.toString('base64') }
    expect(() => openEnvelope(tampered, b, trust)).toThrow(IdentityError)
    const badSignature = { ...envelope, signature: Buffer.alloc(64).toString('base64') }
    expect(() => openEnvelope(badSignature, b, trust)).toThrow(/签名校验失败/)
  })

  it('rejects malformed envelopes and key mismatches', () => {
    expect(() => verifyEnvelope({ format: 'other' })).toThrow(/不是 WH 同步信封/)
    expect(() => verifyEnvelope({ format: 'wh-sync-envelope', version: 2 })).toThrow(/不支持的信封版本/)
    const a = generateIdentity()
    const b = generateIdentity()
    const envelope = sealChangeset(changeset, a, trustEntry(b))
    const wrongKey = { ...envelope, sender: { ...envelope.sender, encPublicKey: b.encPublicKey } }
    expect(() => openEnvelope(wrongKey, b, { version: 1 as const, devices: [trustEntry(a)] })).toThrow(/公钥与信任记录不一致/)
  })
})
