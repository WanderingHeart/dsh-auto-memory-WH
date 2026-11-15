import type { SyncEndpoint } from './endpoint.ts'
import type { Changeset } from './sync.ts'
import type { SyncTransport } from './transport.ts'

/**
 * Glue between the endpoint (envelope + memory apply) and a transport (queue).
 *
 * Push is cursor based: only changes newer than the last successfully published
 * `until` are sealed, and the send watermark advances only after the transport
 * accepted (or deduplicated) the envelope. A crashed push therefore retries the
 * same envelope, which the transport deduplicates by digest.
 *
 * Pull is at-least-once: every message is applied, successful ones are acked,
 * and failed ones stay queued for manual retry — a poison envelope must never be
 * deleted silently.
 */

export interface PushResult {
  recipient: string
  published: boolean
  since: number
  until: number
  records: number
  changeset: Changeset
  messageId?: string
  duplicate?: boolean
}

export async function pushToPeer(endpoint: SyncEndpoint, transport: SyncTransport, recipient: string): Promise<PushResult> {
  if (typeof recipient !== 'string' || !/^dev-[0-9a-f]{16}$/.test(recipient)) throw new Error('recipient must be a WH device id')
  const state = await endpoint.state()
  const since = state && state.deviceId === endpoint.deviceId ? state.sentCursor ?? 0 : 0
  const changeset = await endpoint.changes(since)
  const records = changeset.upserts.length + changeset.deletions.length
  if (records === 0) return { recipient, published: false, since, until: changeset.until, records: 0, changeset }
  const envelope = endpoint.seal(changeset, recipient)
  const published = await transport.publish(envelope)
  await endpoint.recordSent(changeset.until)
  return { recipient, published: true, since, until: changeset.until, records, changeset, messageId: published.id, duplicate: published.duplicate }
}

export interface PulledMessage {
  id: string
  until: number
  created: number
  updated: number
  skipped: number
  conflicts: number
  archived: number
}

export interface PullResult {
  applied: PulledMessage[]
  failed: Array<{ id: string; error: string }>
  acked: number
  remaining: number
}

export async function pullFromPeer(
  endpoint: SyncEndpoint,
  transport: SyncTransport,
  options?: { limit?: number; onConflict?: 'manual' | 'remote' | 'fork' },
): Promise<PullResult> {
  const messages = await transport.pull(endpoint.deviceId, { limit: options?.limit })
  const applied: PulledMessage[] = []
  const failed: Array<{ id: string; error: string }> = []
  const ackIds: string[] = []
  for (const message of messages) {
    try {
      const result = await endpoint.apply(message.envelope, { onConflict: options?.onConflict })
      applied.push({
        id: message.id,
        until: result.until,
        created: result.created.length,
        updated: result.updated.length,
        skipped: result.skipped.length,
        conflicts: result.conflicts.length,
        archived: result.archived.length,
      })
      ackIds.push(message.id)
    } catch (error) {
      failed.push({ id: message.id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  const acked = ackIds.length === 0 ? { acked: 0 } : await transport.ack(endpoint.deviceId, ackIds)
  return { applied, failed, acked: acked.acked, remaining: Math.max(0, messages.length - acked.acked) }
}
