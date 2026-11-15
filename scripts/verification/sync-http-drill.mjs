import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MemoryStore } from '../../src/store.ts'
import { createLocalEndpoint } from '../../src/endpoint.ts'
import { addTrust, generateIdentity, trustEntry } from '../../src/device-identity.ts'
import { createRelayServer } from '../../src/sync-relay.ts'
import { createHttpTransport, TransportError } from '../../src/transport.ts'
import { pullFromPeer, pushToPeer } from '../../src/sync-flow.ts'

const repo = 'C:/Users/example-user/Desktop/dsh-plug-in/dsh-auto-memory-WH'
const stage = process.argv[2] ?? 'S05-v040-transport'
const base = join(repo, '.work/S05/http-relay-drill', String(Date.now()))
const token = 'drill-relay-token-0123456789abcdef'
const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const writeSynthetic = (store, name, status) => store.write({ name, description: `${name} 中继演练`, body: `${name} 仅隔离演练`, type: 'reference', status, pinned: false, disabled: false, importance: 0, reads: 0 }, 'user')

await mkdir(base, { recursive: true })
let relay = null
let smallRelay = null
try {
  const a = generateIdentity()
  const b = generateIdentity()
  const trustA = addTrust({ version: 1, devices: [] }, trustEntry(b, 'device-b'))
  const trustB = addTrust({ version: 1, devices: [] }, trustEntry(a, 'device-a'))
  const storeA = new MemoryStore(join(base, 'memory-a'))
  const storeB = new MemoryStore(join(base, 'memory-b'))
  await writeSynthetic(storeA, 'relay-alpha', 'verified')
  await sleep(3)
  await writeSynthetic(storeA, 'relay-beta', 'candidate')
  const endpointA = createLocalEndpoint({ root: join(base, 'memory-a'), scope: 'user', deviceId: a.deviceId, identity: a, trust: trustA, stateFile: join(base, 'a-state.json') })
  const endpointB = createLocalEndpoint({ root: join(base, 'memory-b'), scope: 'user', deviceId: b.deviceId, identity: b, trust: trustB, stateFile: join(base, 'b-state.json') })

  relay = createRelayServer({ token, root: join(base, 'relay') })
  const address = await relay.start()
  check('relay-listening', address.url.startsWith('http://127.0.0.1:') && address.port > 0, address.url)

  const transportA = createHttpTransport({ baseUrl: address.url, token })
  const transportB = createHttpTransport({ baseUrl: address.url, token })
  const health = await transportA.stats()
  check('health-empty-queue', health.queued === 0, `queued=${health.queued}`)

  const pushed = await pushToPeer(endpointA, transportA, b.deviceId)
  check('push-publishes-changeset', pushed.published && pushed.records === 2, `records=${pushed.records} id=${pushed.messageId}`)
  check('push-cursor-advances', (await endpointA.state())?.sentCursor === pushed.until, `sentCursor=${(await endpointA.state())?.sentCursor}`)

  const pulled = await pullFromPeer(endpointB, transportB)
  const alpha = await storeB.read('relay-alpha', 'user')
  check('pull-applies-and-acks', pulled.applied.length === 1 && pulled.acked === 1 && pulled.remaining === 0, `acked=${pulled.acked}`)
  check('applied-as-candidate', pulled.applied[0]?.created === 2 && alpha?.status === 'candidate', `status=${alpha?.status}`)
  check('queue-drained', (await relay.stats()).queued === 0, `queued=${(await relay.stats()).queued}`)

  const retryEnvelope = endpointA.seal(await endpointA.changes(0), b.deviceId)
  const firstPublish = await transportA.publish(retryEnvelope)
  const secondPublish = await transportA.publish(retryEnvelope)
  check('idempotent-publish', firstPublish.duplicate === false && secondPublish.duplicate === true && secondPublish.id === firstPublish.id, `id=${firstPublish.id}`)
  const drained = await pullFromPeer(endpointB, transportB)
  check('duplicate-drained', drained.acked === 1 && (await relay.stats()).queued === 0, `acked=${drained.acked}`)

  let badTokenCode = ''
  try { await createHttpTransport({ baseUrl: address.url, token: 'wrong-token-0123456789' }).stats() } catch (error) { badTokenCode = error instanceof TransportError ? error.code : String(error) }
  check('wrong-token-rejected', badTokenCode === 'TRANSPORT_UNAUTHORIZED', badTokenCode)

  const intact = endpointA.seal(await endpointA.changes(0), b.deviceId)
  const raw = Buffer.from(intact.ciphertext, 'base64')
  raw[Math.floor(raw.length / 2)] ^= 0xff
  await transportA.publish({ ...intact, ciphertext: raw.toString('base64') })
  const poisoned = await pullFromPeer(endpointB, transportB)
  check('bad-envelope-stays-queued', poisoned.failed.length === 1 && poisoned.acked === 0 && poisoned.remaining === 1, `failed=${poisoned.failed.length}`)

  await sleep(3)
  await writeSynthetic(storeB, 'relay-gamma', 'candidate')
  const reverse = await pushToPeer(endpointB, transportB, a.deviceId)
  const appliedAtA = await pullFromPeer(endpointA, transportA)
  check('reverse-direction', reverse.published && appliedAtA.applied[0]?.created === 1, `records=${reverse.records}`)

  await sleep(3)
  await writeSynthetic(storeA, 'relay-epsilon', 'candidate')
  const restarted = createRelayServer({ token, root: join(base, 'relay') })
  await relay.stop()
  relay = restarted
  const restartedAddress = await restarted.start()
  await pushToPeer(endpointA, createHttpTransport({ baseUrl: restartedAddress.url, token }), b.deviceId)
  const persisted = await pullFromPeer(endpointB, createHttpTransport({ baseUrl: restartedAddress.url, token }))
  check('restart-persists-queue', persisted.applied.length === 1 && persisted.acked === 1, `applied=${persisted.applied.length} failed=${persisted.failed.length}`)

  smallRelay = createRelayServer({ token, root: join(base, 'relay-small'), maxQueuePerRecipient: 1 })
  const smallAddress = await smallRelay.start()
  const smallTransport = createHttpTransport({ baseUrl: smallAddress.url, token })
  await smallTransport.publish(endpointA.seal(await endpointA.changes(0), b.deviceId))
  await sleep(3)
  await writeSynthetic(storeA, 'relay-delta', 'candidate')
  let fullCode = ''
  try { await smallTransport.publish(endpointA.seal(await endpointA.changes(0), b.deviceId)) } catch (error) { fullCode = error instanceof TransportError ? error.code : String(error) }
  check('queue-full-backpressure', fullCode === 'TRANSPORT_BACKPRESSURE', fullCode)

  const evidence = {
    stage,
    at: new Date().toISOString(),
    pass: checks.every(item => item.ok),
    relay: { transport: 'wh-sync-relay', version: 1, bind: '127.0.0.1', auth: 'shared bearer token' },
    devices: { a: a.deviceId, b: b.deviceId },
    checks,
    boundary: [
      '合成数据与临时目录；不涉及真实记忆。',
      '中继只在本机回环地址监听；未验证局域网/公网、TLS、反向代理。',
      '认证是共享 bearer token，不是每设备授权；token 只在本进程内存与请求头中。',
      '队列文件保存信封密文，不含明文记忆；目录权限由调用方负责。',
      '无法解密的毒消息会留在队列中等待人工清理；演练中随临时目录一起删除。',
      '未测试大并发、跨机器时钟偏差、移动网络抖动。',
    ],
  }
  const out = join(repo, 'docs/evidence', stage)
  await mkdir(out, { recursive: true })
  await writeFile(join(out, 'http-relay.json'), JSON.stringify(evidence, null, 2))
  console.log(`RESULT ${evidence.pass ? 'PASS' : 'FAIL'} -> ${join(out, 'http-relay.json')}`)
  process.exit(evidence.pass ? 0 : 1)
} finally {
  if (relay) await relay.stop().catch(() => {})
  if (smallRelay) await smallRelay.stop().catch(() => {})
  if (process.env.WH_KEEP_DRILL !== '1') await rm(base, { recursive: true, force: true })
}
