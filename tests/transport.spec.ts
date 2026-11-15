import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../src/store.ts'
import { createLocalEndpoint } from '../src/endpoint.ts'
import { addTrust, generateIdentity, trustEntry, sealChangeset } from '../src/device-identity.ts'
import { createRelayServer, type RelayServer } from '../src/sync-relay.ts'
import { createHttpTransport, TransportError } from '../src/transport.ts'
import { pullFromPeer, pushToPeer } from '../src/sync-flow.ts'

const TOKEN = 'relay-token-for-tests-0123456789'
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const relays: RelayServer[] = []

afterEach(async () => {
  for (const relay of relays.splice(0)) await relay.stop().catch(() => {})
})

async function writeRecord(store: MemoryStore, name: string, body: string, status: 'candidate' | 'verified' = 'candidate') {
  await store.write({ name, description: `${name} description`, body, type: 'reference', status, pinned: false, disabled: false, importance: 0, reads: 0 }, 'user')
}

async function setup(options?: { retentionMs?: number; maxQueuePerRecipient?: number; now?: () => number; records?: string[] }) {
  const dir = await mkdtemp(join(tmpdir(), 'wh-transport-'))
  const a = generateIdentity()
  const b = generateIdentity()
  const c = generateIdentity()
  const trustA = addTrust(addTrust({ version: 1, devices: [] }, trustEntry(b, 'b')), trustEntry(c, 'c'))
  const trustB = addTrust({ version: 1, devices: [] }, trustEntry(a, 'a'))
  const storeA = new MemoryStore(join(dir, 'a'))
  const storeB = new MemoryStore(join(dir, 'b'))
  const storeC = new MemoryStore(join(dir, 'c'))
  const names = options?.records ?? ['alpha', 'beta']
  for (const name of names) { await writeRecord(storeA, name, `${name} body one`); await sleep(2) }
  const endpointA = createLocalEndpoint({ root: join(dir, 'a'), scope: 'user', deviceId: a.deviceId, identity: a, trust: trustA, stateFile: join(dir, 'a-state.json') })
  const endpointB = createLocalEndpoint({ root: join(dir, 'b'), scope: 'user', deviceId: b.deviceId, identity: b, trust: trustB, stateFile: join(dir, 'b-state.json') })
  const endpointC = createLocalEndpoint({ root: join(dir, 'c'), scope: 'user', deviceId: c.deviceId, identity: c, trust: { version: 1, devices: [] }, stateFile: join(dir, 'c-state.json') })
  const relay = createRelayServer({ token: TOKEN, root: join(dir, 'relay'), retentionMs: options?.retentionMs, maxQueuePerRecipient: options?.maxQueuePerRecipient, now: options?.now })
  relays.push(relay)
  const address = await relay.start()
  const transport = createHttpTransport({ baseUrl: address.url, token: TOKEN })
  return { dir, a, b, c, storeA, storeB, storeC, endpointA, endpointB, endpointC, relay, address, transport }
}

describe('http sync transport', () => {
  it('round-trips an envelope through the relay', async () => {
    const { endpointA, endpointB, b, storeB, relay, transport } = await setup()
    const pushed = await pushToPeer(endpointA, transport, b.deviceId)
    expect(pushed.published).toBe(true)
    expect(pushed.records).toBe(2)
    expect(pushed.messageId).toMatch(/^msg-[0-9a-f]{32}$/)
    const pulled = await pullFromPeer(endpointB, transport)
    expect(pulled.applied).toHaveLength(1)
    expect(pulled.applied[0]?.created).toBe(2)
    expect(pulled.acked).toBe(1)
    expect(pulled.remaining).toBe(0)
    expect((await storeB.read('alpha', 'user'))?.body).toBe('alpha body one')
    expect((await relay.stats()).queued).toBe(0)
  })

  it('rejects a wrong bearer token', async () => {
    const { address, endpointA, b } = await setup()
    const bad = createHttpTransport({ baseUrl: address.url, token: 'wrong-token-0123456789' })
    const envelope = endpointA.seal(await endpointA.changes(0), b.deviceId)
    await expect(bad.publish(envelope)).rejects.toMatchObject({ code: 'TRANSPORT_UNAUTHORIZED' })
  })

  it('treats a repeated publish as the same message', async () => {
    const { endpointA, b, transport } = await setup()
    const envelope = endpointA.seal(await endpointA.changes(0), b.deviceId)
    const first = await transport.publish(envelope)
    const second = await transport.publish(envelope)
    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(second.id).toBe(first.id)
  })

  it('applies backpressure when the recipient queue is full', async () => {
    const { endpointA, endpointB, b, storeA, transport } = await setup({ maxQueuePerRecipient: 1 })
    await transport.publish(endpointA.seal(await endpointA.changes(0), b.deviceId))
    await sleep(3)
    await writeRecord(storeA, 'gamma', 'gamma body one')
    const second = endpointA.seal(await endpointA.changes(0), b.deviceId)
    await expect(transport.publish(second)).rejects.toMatchObject({ code: 'TRANSPORT_BACKPRESSURE', status: 429 })
    await pullFromPeer(endpointB, transport)
    const retry = await transport.publish(second)
    expect(retry.duplicate).toBe(false)
  })

  it('refuses an envelope larger than the transport bound', async () => {
    const { endpointA, b, transport } = await setup()
    const envelope = endpointA.seal(await endpointA.changes(0), b.deviceId)
    const oversized = { ...envelope, ciphertext: 'A'.repeat(13 * 1024 * 1024) }
    await expect(transport.publish(oversized)).rejects.toThrow(/上限/)
  })

  it('drops messages older than the retention window', async () => {
    let clock = Date.now()
    const { endpointA, endpointB, b, relay, transport } = await setup({ retentionMs: 1_000, now: () => clock })
    await pushToPeer(endpointA, transport, b.deviceId)
    clock += 5_000
    const pulled = await pullFromPeer(endpointB, transport)
    expect(pulled.applied).toHaveLength(0)
    expect(pulled.acked).toBe(0)
    const stats = await relay.stats()
    expect(stats.expired).toBeGreaterThanOrEqual(1)
    expect(stats.queued).toBe(0)
  })

  it('ignores unknown message ids in ack', async () => {
    const { endpointA, endpointB, b, relay, transport } = await setup()
    const pushed = await pushToPeer(endpointA, transport, b.deviceId)
    const messages = await transport.pull(b.deviceId)
    expect(messages).toHaveLength(1)
    const acked = await transport.ack(b.deviceId, [pushed.messageId!, `msg-${'0'.repeat(32)}`])
    expect(acked.acked).toBe(1)
    expect((await relay.stats()).queued).toBe(0)
  })

  it('isolates queues per recipient', async () => {
    const { endpointA, c, transport } = await setup()
    await pushToPeer(endpointA, transport, c.deviceId)
    expect(await transport.pull(c.deviceId)).toHaveLength(1)
    const other = generateIdentity()
    expect(await transport.pull(other.deviceId)).toHaveLength(0)
  })

  it('persists queued messages across a relay restart', async () => {
    const { dir, endpointA, endpointB, b, relay, transport, address } = await setup()
    await pushToPeer(endpointA, transport, b.deviceId)
    await relay.stop()
    const restarted = createRelayServer({ token: TOKEN, root: join(dir, 'relay') })
    relays.push(restarted)
    const restartedAddress = await restarted.start()
    expect(restartedAddress.url).not.toBe(address.url)
    const restartedTransport = createHttpTransport({ baseUrl: restartedAddress.url, token: TOKEN })
    const pulled = await pullFromPeer(endpointB, restartedTransport)
    expect(pulled.applied).toHaveLength(1)
    expect(pulled.acked).toBe(1)
  })

  it('does not resend changes that were already published', async () => {
    const { endpointA, b, storeA, transport } = await setup()
    const first = await pushToPeer(endpointA, transport, b.deviceId)
    expect(first.records).toBe(2)
    await sleep(3)
    await writeRecord(storeA, 'gamma', 'gamma body one')
    const second = await pushToPeer(endpointA, transport, b.deviceId)
    expect(second.published).toBe(true)
    expect(second.records).toBe(1)
    const third = await pushToPeer(endpointA, transport, b.deviceId)
    expect(third.published).toBe(false)
    expect(third.records).toBe(0)
  })

  it('keeps a poison message queued when apply fails', async () => {
    const { a, b, endpointA, endpointB, storeA, transport } = await setup({ records: ['alpha'] })
    const changeset = await endpointA.changes(0)
    const poisoned = { ...changeset, checksum: 'deadbeef' }
    const envelope = sealChangeset(poisoned, a, trustEntry(b))
    await transport.publish(envelope)
    const first = await pullFromPeer(endpointB, transport)
    expect(first.failed).toHaveLength(1)
    expect(first.acked).toBe(0)
    expect(first.remaining).toBe(1)
    expect(await storeA.read('alpha', 'user')).not.toBeNull()
    const second = await pullFromPeer(endpointB, transport)
    expect(second.failed).toHaveLength(1)
    expect(second.acked).toBe(0)
  })

  it('surfaces a transport error subclass with a stable code', async () => {
    const { address } = await setup()
    const unreachable = createHttpTransport({ baseUrl: `${address.url}-closed`, token: TOKEN, timeoutMs: 500 })
    await expect(unreachable.stats()).rejects.toBeInstanceOf(TransportError)
  })
})
