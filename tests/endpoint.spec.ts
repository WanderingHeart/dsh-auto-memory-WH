import { describe, it, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../src/store.ts'
import { createLocalEndpoint } from '../src/endpoint.ts'
import { addTrust, generateIdentity, trustEntry } from '../src/device-identity.ts'

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'wh-endpoint-'))
  const a = generateIdentity()
  const b = generateIdentity()
  const trustB = addTrust({ version: 1, devices: [] }, trustEntry(a, 'a'))
  const trustA = addTrust({ version: 1, devices: [] }, trustEntry(b, 'b'))
  const storeA = new MemoryStore(join(dir, 'a'))
  const storeB = new MemoryStore(join(dir, 'b'))
  await storeA.write({ name: 'alpha', description: 'alpha', body: 'A1', type: 'reference', status: 'verified', pinned: false, disabled: false, importance: 0, reads: 0 }, 'user')
  await storeA.write({ name: 'beta', description: 'beta', body: 'B1', type: 'reference', status: 'candidate', pinned: false, disabled: false, importance: 0, reads: 0 }, 'user')
  const endpointA = createLocalEndpoint({ root: join(dir, 'a'), scope: 'user', deviceId: a.deviceId, identity: a, trust: trustA, stateFile: join(dir, 'a-state.json') })
  const endpointB = createLocalEndpoint({ root: join(dir, 'b'), scope: 'user', deviceId: b.deviceId, identity: b, trust: trustB, stateFile: join(dir, 'b-state.json') })
  return { dir, a, b, endpointA, endpointB, storeA, storeB }
}

describe('local sync endpoint', () => {
  it('exports, seals, opens and applies with cursor advancement', async () => {
    const { endpointA, endpointB, b, storeB } = await setup()
    const changes = await endpointA.changes()
    expect(changes.upserts).toHaveLength(2)
    expect(await endpointA.state()).toBeNull()
    const envelope = endpointA.seal(changes, b.deviceId)
    const applied = await endpointB.apply(envelope)
    expect(applied.created.sort()).toEqual(['alpha', 'beta'])
    expect((await storeB.read('alpha', 'user'))?.status).toBe('candidate')
    const state = await endpointB.state()
    expect(state?.cursor).toBe(changes.until)
    expect(state?.deviceId).toBe(b.deviceId)
  })

  it('is idempotent when the same envelope is applied twice', async () => {
    const { endpointA, endpointB, b } = await setup()
    const envelope = endpointA.seal(await endpointA.changes(), b.deviceId)
    await endpointB.apply(envelope)
    const again = await endpointB.apply(envelope)
    expect(again.created).toHaveLength(0)
    expect(again.skipped.sort()).toEqual(['alpha', 'beta'])
  })

  it('refuses envelopes from an untrusted sender and wrong recipient', async () => {
    const { endpointA, endpointB, b } = await setup()
    const envelope = endpointA.seal(await endpointA.changes(), b.deviceId)
    const other = createLocalEndpoint({ root: join(tmpdir(), 'nope'), scope: 'user', deviceId: generateIdentity().deviceId, identity: generateIdentity(), trust: { version: 1, devices: [] } })
    await expect(other.apply(envelope)).rejects.toThrow(/收件人不是本设备|未在信任列表/)
  })

  it('reports a verified conflict unless remote wins is explicit', async () => {
    const { endpointA, endpointB, b, storeB } = await setup()
    await storeB.write({ name: 'alpha', description: 'local edit', body: 'LOCAL', type: 'reference', status: 'verified', pinned: true, disabled: false, importance: 0, reads: 0 }, 'user')
    const envelope = endpointA.seal(await endpointA.changes(), b.deviceId)
    const manual = await endpointB.apply(envelope)
    expect(manual.conflicts).toContain('alpha')
    expect((await storeB.read('alpha', 'user'))?.body).toBe('LOCAL')
    const remote = await endpointB.apply(envelope, { onConflict: 'remote' })
    expect(remote.updated).toContain('alpha')
    const after = await storeB.read('alpha', 'user')
    expect(after?.body).toBe('A1')
    expect(after?.status).toBe('candidate')
  })

  it('reports a trust error when sealing to an unknown recipient', async () => {
    const { endpointA } = await setup()
    const changes = await endpointA.changes()
    expect(() => endpointA.seal(changes, 'dev-ffffffffffffffff')).toThrow(/不在信任列表/)
  })
})
