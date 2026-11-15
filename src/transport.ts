import { createHash } from 'node:crypto'
import { canonicalJson } from './transfer.ts'
import type { SyncEnvelope } from './device-identity.ts'

/**
 * Carrier contract for the encrypted sync envelope.
 *
 * A transport moves opaque `wh-sync-envelope` bytes between devices and never
 * inspects the ciphertext. Authentication, replay protection, recipient
 * binding and tamper detection all live in the envelope, so a transport only
 * has to provide: authenticated delivery, at-least-once delivery, an 8 MiB
 * message bound, and idempotent publish (the same envelope may be re-sent
 * after a timeout).
 */
export const TRANSPORT_FORMAT = 'wh-sync-relay'
export const TRANSPORT_VERSION = 1
export const MAX_ENVELOPE_BYTES = 12 * 1024 * 1024
export const DEFAULT_PULL_LIMIT = 50
export const MAX_PULL_LIMIT = 200
export const DEFAULT_TRANSPORT_TIMEOUT_MS = 10_000

export type TransportErrorCode =
  | 'TRANSPORT_UNAUTHORIZED'
  | 'TRANSPORT_UNAVAILABLE'
  | 'TRANSPORT_TIMEOUT'
  | 'TRANSPORT_REJECTED'
  | 'TRANSPORT_BACKPRESSURE'
  | 'TRANSPORT_BAD_RESPONSE'

export class TransportError extends Error {
  code: TransportErrorCode
  status?: number
  serverCode?: string
  constructor(code: TransportErrorCode, message: string, details: { status?: number; serverCode?: string; cause?: unknown } = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause })
    this.name = 'TransportError'
    this.code = code
    this.status = details.status
    this.serverCode = details.serverCode
  }
}

export interface RelayMessage {
  id: string
  recipient: string
  sender: string
  receivedAt: string
  envelope: SyncEnvelope
}

export interface PublishResult { id: string; duplicate: boolean }
export interface AckResult { acked: number }
export interface TransportStats { queued: number }

export interface SyncTransport {
  publish(envelope: SyncEnvelope): Promise<PublishResult>
  pull(recipient: string, options?: { limit?: number }): Promise<RelayMessage[]>
  ack(recipient: string, ids: string[]): Promise<AckResult>
  stats(): Promise<TransportStats>
}

/** Deterministic message id: retries of the same envelope collapse to one queued message. */
export function messageIdFor(envelope: SyncEnvelope): string {
  return `msg-${createHash('sha256').update(canonicalJson(envelope)).digest('hex').slice(0, 32)}`
}

const MESSAGE_ID = /^msg-[0-9a-f]{32}$/
const DEVICE_ID = /^dev-[0-9a-f]{16}$/

export function isValidMessageId(id: unknown): id is string {
  return typeof id === 'string' && MESSAGE_ID.test(id)
}

export function isValidRelayDeviceId(id: unknown): id is string {
  return typeof id === 'string' && DEVICE_ID.test(id)
}

function envelopeBytes(envelope: SyncEnvelope): number {
  return Buffer.byteLength(JSON.stringify(envelope), 'utf8')
}

export interface HttpTransportOptions {
  /** Relay base URL, e.g. http://127.0.0.1:7411 (no trailing path). */
  baseUrl: string
  /** Shared bearer token; the relay compares it in constant time. */
  token: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

interface RequestOptions { method: 'GET' | 'POST'; path: string; body?: unknown; timeoutMs: number }

function parseErrorBody(text: string): { code?: string; message?: string } {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } }
    return {
      code: typeof parsed.error?.code === 'string' ? parsed.error.code : undefined,
      message: typeof parsed.error?.message === 'string' ? parsed.error.message : undefined,
    }
  } catch { return {} }
}

export function createHttpTransport(options: HttpTransportOptions): SyncTransport {
  if (!/^https?:\/\//.test(options.baseUrl)) throw new Error('relayUrl must start with http:// or https://')
  const base = options.baseUrl.replace(/\/+$/, '')
  const token = options.token
  if (token.trim().length < 16) throw new Error('relay token must be at least 16 characters')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TRANSPORT_TIMEOUT_MS
  const doFetch = options.fetchImpl ?? fetch

  async function request(input: RequestOptions): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), input.timeoutMs)
    try {
      const response = await doFetch(`${base}${input.path}`, {
        method: input.method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: controller.signal,
      })
      const text = await response.text()
      if (!response.ok) {
        const error = parseErrorBody(text)
        if (response.status === 401 || response.status === 403) throw new TransportError('TRANSPORT_UNAUTHORIZED', error.message ?? '中继拒绝鉴权。', { status: response.status, serverCode: error.code })
        if (response.status === 429) throw new TransportError('TRANSPORT_BACKPRESSURE', error.message ?? '中继队列已满。', { status: response.status, serverCode: error.code })
        if (response.status >= 500) throw new TransportError('TRANSPORT_UNAVAILABLE', error.message ?? '中继不可用。', { status: response.status, serverCode: error.code })
        throw new TransportError('TRANSPORT_REJECTED', error.message ?? '中继拒绝了请求。', { status: response.status, serverCode: error.code })
      }
      if (text.length === 0) return {}
      try { return JSON.parse(text) } catch { throw new TransportError('TRANSPORT_BAD_RESPONSE', '中继返回了非 JSON 响应。', { status: response.status }) }
    } catch (error) {
      if (error instanceof TransportError) throw error
      if (controller.signal.aborted) throw new TransportError('TRANSPORT_TIMEOUT', `中继请求超时（${input.timeoutMs} ms）。`, { cause: error })
      throw new TransportError('TRANSPORT_UNAVAILABLE', '无法连接同步中继。', { cause: error })
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async publish(envelope: SyncEnvelope): Promise<PublishResult> {
      if (envelopeBytes(envelope) > MAX_ENVELOPE_BYTES) throw new TransportError('TRANSPORT_REJECTED', '信封超过传输层大小上限。')
      const response = await request({ method: 'POST', path: '/v1/messages', body: { envelope }, timeoutMs })
      const parsed = response as { id?: unknown; duplicate?: unknown }
      if (!isValidMessageId(parsed.id)) throw new TransportError('TRANSPORT_BAD_RESPONSE', '中继未返回有效消息 id。')
      return { id: parsed.id, duplicate: parsed.duplicate === true }
    },
    async pull(recipient: string, pullOptions?: { limit?: number }): Promise<RelayMessage[]> {
      if (!isValidRelayDeviceId(recipient)) throw new Error('recipient must be a WH device id')
      const limit = Math.min(Math.max(1, pullOptions?.limit ?? DEFAULT_PULL_LIMIT), MAX_PULL_LIMIT)
      const response = await request({ method: 'GET', path: `/v1/messages?recipient=${encodeURIComponent(recipient)}&limit=${limit}`, timeoutMs })
      const parsed = response as { messages?: unknown }
      if (!Array.isArray(parsed.messages)) throw new TransportError('TRANSPORT_BAD_RESPONSE', '中继未返回消息列表。')
      return parsed.messages.map((raw): RelayMessage => {
        const message = raw as Partial<RelayMessage>
        if (!isValidMessageId(message.id) || typeof message.sender !== 'string' || typeof message.receivedAt !== 'string' || !message.envelope || typeof message.envelope !== 'object') {
          throw new TransportError('TRANSPORT_BAD_RESPONSE', '中继消息结构无效。')
        }
        return { id: message.id, recipient, sender: message.sender, receivedAt: message.receivedAt, envelope: message.envelope as SyncEnvelope }
      })
    },
    async ack(recipient: string, ids: string[]): Promise<AckResult> {
      if (!isValidRelayDeviceId(recipient)) throw new Error('recipient must be a WH device id')
      const valid = ids.filter(isValidMessageId)
      if (valid.length === 0) return { acked: 0 }
      const response = await request({ method: 'POST', path: '/v1/ack', body: { recipient, ids: valid }, timeoutMs })
      const parsed = response as { acked?: unknown }
      if (typeof parsed.acked !== 'number' || !Number.isSafeInteger(parsed.acked)) throw new TransportError('TRANSPORT_BAD_RESPONSE', '中继未返回确认数量。')
      return { acked: parsed.acked }
    },
    async stats(): Promise<TransportStats> {
      const response = await request({ method: 'GET', path: '/v1/health', timeoutMs })
      const parsed = response as { queued?: unknown }
      return { queued: typeof parsed.queued === 'number' ? parsed.queued : 0 }
    },
  }
}
