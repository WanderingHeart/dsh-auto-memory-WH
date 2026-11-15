import { MemoryStore } from './store.ts'
import { applyChangeset, buildChangeset, loadSyncState, saveSyncState, verifyChangeset, type ApplyChangesetResult, type Changeset, type SyncState } from './sync.ts'
import { openEnvelope, sealChangeset, verifyEnvelope, type DeviceIdentity, type SyncEnvelope, type TrustStore } from './device-identity.ts'
import type { MemoryScope } from './types.ts'

/**
 * Minimal endpoint contract used by sync carriers (U 盘/网盘/浏览器扩展/移动端).
 * A carrier only needs to move opaque `Changeset`/`SyncEnvelope` bytes and to
 * persist one cursor per peer pair; it never reads memory bodies.
 */
export interface SyncEndpoint {
  readonly deviceId: string
  readonly scope: MemoryScope
  /** Build the incremental changeset since the persisted cursor (or an explicit watermark). */
  changes(since?: number): Promise<Changeset>
  /** Sign and encrypt a changeset for one trusted recipient. */
  seal(changeset: Changeset, recipient: string): SyncEnvelope
  /** Verify a received envelope and apply it; advances the persisted cursor on success. */
  apply(envelope: SyncEnvelope, options?: { onConflict?: 'manual' | 'remote' | 'fork' }): Promise<ApplyChangesetResult>
  /** Current persisted state (cursor watermark). */
  state(): Promise<SyncState | null>
  /** Remember that changes up to `until` were published, so a retry does not resend them. */
  recordSent(until: number): Promise<void>
}

export interface LocalEndpointOptions {
  root: string
  scope: MemoryScope
  deviceId: string
  identity: DeviceIdentity
  trust: TrustStore
  cwd?: string
  stateFile?: string
}

export function createLocalEndpoint(options: LocalEndpointOptions): SyncEndpoint {
  const store = new MemoryStore(options.root)
  return {
    deviceId: options.identity.deviceId,
    scope: options.scope,
    async changes(since?: number): Promise<Changeset> {
      let watermark = since
      if (watermark === undefined && options.stateFile) {
        const state = await loadSyncState(options.stateFile)
        if (state && state.deviceId === options.deviceId) watermark = state.cursor
      }
      return buildChangeset(store, { scope: options.scope, cwd: options.cwd, deviceId: options.deviceId, since: watermark ?? 0 })
    },
    seal(changeset: Changeset, recipient: string): SyncEnvelope {
      const target = options.trust.devices.find(device => device.deviceId === recipient)
      if (!target) throw new Error(`收件人不在信任列表中：${recipient}`)
      return sealChangeset(changeset, options.identity, target)
    },
    async apply(envelope: SyncEnvelope, applyOptions?: { onConflict?: 'manual' | 'remote' | 'fork' }): Promise<ApplyChangesetResult> {
      const verified = verifyEnvelope(envelope)
      const changeset = verifyChangeset(openEnvelope(verified, options.identity, options.trust))
      const result = await applyChangeset(store, changeset, { approvedChecksum: changeset.checksum, onConflict: applyOptions?.onConflict, cwd: options.cwd })
      if (options.stateFile) {
        // Applying a peer's changeset must not erase our own send watermark.
        const previous = await loadSyncState(options.stateFile)
        const next: SyncState = { deviceId: options.deviceId, scope: options.scope, cursor: changeset.until, updatedAt: new Date().toISOString() }
        if (previous && previous.deviceId === options.deviceId && typeof previous.sentCursor === 'number') next.sentCursor = previous.sentCursor
        await saveSyncState(options.stateFile, next)
      }
      return result
    },
    async state(): Promise<SyncState | null> {
      return options.stateFile ? loadSyncState(options.stateFile) : null
    },
    async recordSent(until: number): Promise<void> {
      if (!options.stateFile) return
      if (!Number.isFinite(until)) throw new Error('发送游标必须是有限数字。')
      const sequence = Math.max(0, Math.floor(until))
      const previous = await loadSyncState(options.stateFile)
      const own = previous && previous.deviceId === options.deviceId ? previous : null
      await saveSyncState(options.stateFile, {
        deviceId: options.deviceId,
        scope: options.scope,
        cursor: own?.cursor ?? 0,
        sentCursor: Math.max(own?.sentCursor ?? 0, sequence),
        updatedAt: new Date().toISOString(),
      })
    },
  }
}
