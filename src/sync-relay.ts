import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { verifyEnvelope, type SyncEnvelope } from './device-identity.ts'
import { isValidMessageId, isValidRelayDeviceId, messageIdFor, MAX_ENVELOPE_BYTES } from './transport.ts'

/**
 * Reference relay for the WH sync envelope.
 *
 * The relay is deliberately dumb: it authenticates the caller with a shared
 * bearer token, validates the envelope structure, stores the opaque bytes per
 * recipient, and hands them out in arrival order. It never decrypts, never
 * inspects memory bodies, and never sees plaintext. Delivery is
 * at-least-once + idempotent (the message id is the envelope digest), and the
 * receiver must ack a message before it leaves the queue.
 *
 * This is a self-hosted, loopback/LAN relay for the owner's own devices; it is
 * not a hosted service and it does not do per-device authorization or TLS.
 */

export interface RelayOptions {
  /** Shared bearer token; at least 16 characters. */
  token: string
  /** Queue persistence directory (created on start). */
  root: string
  /** Bind address; defaults to 127.0.0.1. */
  host?: string
  /** Defaults to 0 (ephemeral port). */
  port?: number
  /** Messages older than this are dropped; defaults to 7 days. */
  retentionMs?: number
  /** Per-recipient queue bound; defaults to 500. */
  maxQueuePerRecipient?: number
  /** Request body bound; defaults to 16 MiB (envelope limit + JSON/base64 overhead). */
  maxBodyBytes?: number
  now?: () => number
}

export interface RelayAddress { host: string; port: number; url: string }

export interface RelayStats {
  published: number
  duplicates: number
  pulled: number
  acked: number
  rejected: number
  expired: number
  queued: number
}

export interface RelayServer {
  start(): Promise<RelayAddress>
  stop(): Promise<void>
  address(): RelayAddress | null
  stats(): Promise<RelayStats>
}

interface StoredMessage {
  id: string
  recipient: string
  sender: string
  receivedAt: string
  receivedAtMs: number
  envelope: SyncEnvelope
}

interface RelayErrorShape { status: number; code: string; message: string }

function relayError(status: number, code: string, message: string): RelayErrorShape {
  return { status, code, message }
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

export function createRelayServer(options: RelayOptions): RelayServer {
  if (options.token.trim().length < 16) throw new Error('relay token must be at least 16 characters')
  if (!options.root || options.root.trim().length === 0) throw new Error('relay root is required')
  const token = options.token
  const root = options.root
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 0
  const retentionMs = options.retentionMs ?? 7 * DAY
  const maxQueuePerRecipient = options.maxQueuePerRecipient ?? 500
  const maxBodyBytes = options.maxBodyBytes ?? 16 * 1024 * 1024
  const nowMs = options.now ?? (() => Date.now())

  const counters = { published: 0, duplicates: 0, pulled: 0, acked: 0, rejected: 0, expired: 0 }
  let listening: RelayAddress | null = null
  const sockets = new Set<import('node:net').Socket>()

  function queueDir(recipient: string): string {
    return join(root, 'queue', recipient)
  }

  async function listFiles(recipient: string): Promise<string[]> {
    try {
      const names = await readdir(queueDir(recipient))
      return names.filter(name => name.endsWith('.json')).map(name => join(queueDir(recipient), name))
    } catch { return [] }
  }

  async function readStored(file: string): Promise<StoredMessage | null> {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as StoredMessage
      if (!isValidMessageId(parsed.id) || typeof parsed.receivedAtMs !== 'number' || !parsed.envelope) return null
      return parsed
    } catch { return null }
  }

  async function writeAtomic(file: string, text: string): Promise<void> {
    const temp = `${file}.tmp-${randomUUID()}`
    await writeFile(temp, text, 'utf8')
    try { await rename(temp, file) } catch (error) { await rm(temp, { force: true }); throw error }
  }

  async function prune(recipient: string): Promise<void> {
    const cutoff = nowMs() - retentionMs
    for (const file of await listFiles(recipient)) {
      const stored = await readStored(file)
      if (!stored || stored.receivedAtMs < cutoff) {
        await rm(file, { force: true })
        counters.expired += 1
      }
    }
  }

  async function readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      size += buffer.length
      if (size > maxBodyBytes) throw relayError(413, 'BODY_TOO_LARGE', '请求体超过中继上限。')
      chunks.push(buffer)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  function authorized(request: IncomingMessage): boolean {
    const header = request.headers.authorization
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
    const given = Buffer.from(header.slice('Bearer '.length), 'utf8')
    const expected = Buffer.from(token, 'utf8')
    if (given.length !== expected.length) return false
    return timingSafeEqual(given, expected)
  }

  function send(response: ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload)
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body, 'utf8') })
    response.end(body)
  }

  function sendError(response: ServerResponse, error: RelayErrorShape): void {
    counters.rejected += 1
    send(response, error.status, { error: { code: error.code, message: error.message } })
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!authorized(request)) { send(response, 401, { error: { code: 'UNAUTHORIZED', message: '中继鉴权失败。' } }); return }
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'relay.local'}`)

      if (request.method === 'GET' && url.pathname === '/v1/health') {
        const queued = await countQueued()
        send(response, 200, { ok: true, queued, retentionMs })
        return
      }

      if (request.method === 'POST' && url.pathname === '/v1/messages') {
        const text = await readBody(request)
        let envelope: SyncEnvelope
        try {
          const body = JSON.parse(text) as { envelope?: unknown }
          envelope = verifyEnvelope(body.envelope)
        } catch { throw relayError(400, 'INVALID_ENVELOPE', '信封结构无效。'); }
        const recipient = envelope.recipient.deviceId
        const sender = envelope.sender.deviceId
        if (!isValidRelayDeviceId(recipient) || !isValidRelayDeviceId(sender)) throw relayError(400, 'INVALID_ENVELOPE', '信封设备 id 非法。')
        if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > MAX_ENVELOPE_BYTES) throw relayError(413, 'ENVELOPE_TOO_LARGE', '信封超过传输层上限。')
        const id = messageIdFor(envelope)
        await mkdir(queueDir(recipient), { recursive: true })
        const file = join(queueDir(recipient), `${id}.json`)
        const existing = await readFile(file, 'utf8').then(() => true).catch(() => false)
        if (existing) {
          counters.duplicates += 1
          send(response, 200, { id, duplicate: true })
          return
        }
        await prune(recipient)
        const queued = (await listFiles(recipient)).length
        if (queued >= maxQueuePerRecipient) throw relayError(429, 'QUEUE_FULL', '收件人队列已满，请先拉取并确认。')
        const receivedAtMs = nowMs()
        const stored: StoredMessage = { id, recipient, sender, receivedAt: new Date(receivedAtMs).toISOString(), receivedAtMs, envelope }
        await writeAtomic(file, JSON.stringify(stored))
        counters.published += 1
        send(response, 200, { id, duplicate: false })
        return
      }

      if (request.method === 'GET' && url.pathname === '/v1/messages') {
        const recipient = url.searchParams.get('recipient')
        if (!isValidRelayDeviceId(recipient)) throw relayError(400, 'INVALID_RECIPIENT', 'recipient 必须是 WH 设备 id。')
        const rawLimit = Number(url.searchParams.get('limit') ?? '50')
        const limit = Number.isSafeInteger(rawLimit) ? Math.min(Math.max(1, rawLimit), 200) : 50
        await prune(recipient)
        const stored = (await Promise.all((await listFiles(recipient)).map(readStored)))
          .filter((item): item is StoredMessage => item !== null)
          .sort((left, right) => left.receivedAtMs - right.receivedAtMs || left.id.localeCompare(right.id))
          .slice(0, limit)
        counters.pulled += stored.length
        send(response, 200, { messages: stored.map(item => ({ id: item.id, recipient: item.recipient, sender: item.sender, receivedAt: item.receivedAt, envelope: item.envelope })) })
        return
      }

      if (request.method === 'POST' && url.pathname === '/v1/ack') {
        const text = await readBody(request)
        const body = JSON.parse(text) as { recipient?: unknown; ids?: unknown }
        if (!isValidRelayDeviceId(body.recipient)) throw relayError(400, 'INVALID_RECIPIENT', 'recipient 必须是 WH 设备 id。')
        if (!Array.isArray(body.ids) || body.ids.length > 500) throw relayError(400, 'INVALID_ACK', 'ids 必须是最多 500 个消息 id 的数组。')
        let acked = 0
        for (const id of body.ids) {
          if (!isValidMessageId(id)) continue
          const file = join(queueDir(body.recipient), `${id}.json`)
          try { await unlink(file); acked += 1 } catch { /* already gone */ }
        }
        counters.acked += acked
        send(response, 200, { acked })
        return
      }

      send(response, 404, { error: { code: 'NOT_FOUND', message: '未知中继路由。' } })
    } catch (error) {
      const shape = error && typeof error === 'object' && 'status' in error && 'code' in error
        ? error as RelayErrorShape
        : relayError(500, 'RELAY_ERROR', '中继内部错误。')
      if (shape.status === 500) send(response, 500, { error: { code: shape.code, message: shape.message } })
      else sendError(response, shape)
    }
  }

  async function countQueued(): Promise<number> {
    try {
      const recipients = await readdir(join(root, 'queue'))
      let total = 0
      for (const recipient of recipients) total += (await listFiles(recipient)).length
      return total
    } catch { return 0 }
  }

  const server: Server = createServer((request, response) => { void handle(request, response) })
  server.on('connection', socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  return {
    async start(): Promise<RelayAddress> {
      await mkdir(join(root, 'queue'), { recursive: true })
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => { server.off('error', reject); resolve() })
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('relay failed to bind')
      const boundHost = host === '0.0.0.0' ? '127.0.0.1' : host
      listening = { host: boundHost, port: address.port, url: `http://${boundHost}:${address.port}` }
      return listening
    },
    async stop(): Promise<void> {
      // Keep-alive connections from a fetch client would otherwise hold close()
      // open, so drop them before waiting for the server to shut down.
      const closed = new Promise<void>(resolve => server.close(() => resolve()))
      server.closeAllConnections?.()
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      await closed
      listening = null
    },
    address(): RelayAddress | null {
      return listening
    },
    async stats(): Promise<RelayStats> {
      return { ...counters, queued: await countQueued() }
    },
  }
}

/** Digest helper exported for drills that want to assert idempotent publish. */
export function relayMessageDigest(envelope: SyncEnvelope): string {
  return createHash('sha256').update(JSON.stringify(envelope)).digest('hex')
}
