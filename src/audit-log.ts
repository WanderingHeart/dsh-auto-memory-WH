import { promises as fs, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { assertNoLinksSync, durableWrite, errorCode, FORMAT_FILE, readRegular, sha256 } from './storage-safety.ts'
import { renderMemoryIndexDetail, renderMemoryIndexDetailAsync, projectIdentity, type InjectionReference, type InjectionDetail } from './injection.ts'
import type { Config } from './index.ts'
import type { MemoryStore } from './store.ts'
import { PLUGIN_VERSION } from './identity.ts'

export const AUDIT_FILENAME = 'audit.jsonl'
export interface AuditEntry {
  ts: number; sessionId: string; cwd: string; injected: string[]; truncated: string[]; bytes: number
  schemaVersion?: 1; eventId?: string; kind?: 'render_attempt' | 'merge_apply'; pluginVersion?: string; timestamp?: string; target?: string; sources?: string[]
  budget?: number; records?: InjectionReference[]; excluded?: Array<{ id: string; reason: string }>
  detailsTruncated?: boolean; issues?: string[]; queryPolicy?: string
}
interface AuditState { chain: Promise<void>; pending: number; written: number; dropped: number; emptyAttempts: number; lastError: string | null; repairedLines: number }
const states = new Map<string, AuditState>()
const stateFor = (root: string): AuditState => {
  let state = states.get(root)
  if (!state) { state = { chain: Promise.resolve(), pending: 0, written: 0, dropped: 0, emptyAttempts: 0, lastError: null, repairedLines: 0 }; states.set(root, state) }
  return state
}
export function getAuditStatus(root: string) {
  const { chain: _chain, ...status } = stateFor(root)
  return { ...status, degraded: status.dropped > 0 || status.lastError !== null, countersSince: 'process-start', maxBytes: 1_048_576, retentionDays: 7 }
}
export function appendAudit(root: string, entry: AuditEntry, options: { maxBytes?: number; retentionDays?: number } = {}): Promise<void> {
  const state = stateFor(root), maxBytes = options.maxBytes ?? 1_048_576, retentionDays = options.retentionDays ?? 7
  if (state.pending >= 256) { state.dropped++; state.lastError = 'QUEUE_FULL'; return Promise.resolve() }
  state.pending++
  state.chain = state.chain.then(async () => {
    assertNoLinksSync(root)
    const marker = JSON.parse((await readRegular(join(root, FORMAT_FILE))).toString('utf8'))
    if (marker.format !== 'dsh-auto-memory-wh' || marker.version !== 1) throw new Error('READ_ONLY')
    const file = join(root, AUDIT_FILENAME)
    await withFileLock(file, async () => {
      let raw = ''
      try { raw = (await readRegular(file, 8 * 1024 * 1024)).toString('utf8') } catch (error) { if (errorCode(error) !== 'ENOENT') throw error }
      const lines: string[] = []
      for (const line of raw.split('\n')) {
        if (!line) continue
        try { const event = JSON.parse(line); if (typeof event.ts === 'number' && event.ts >= Date.now() - retentionDays * 86_400_000) lines.push(line) }
        catch { state.repairedLines++ }
      }
      const next = JSON.stringify(entry)
      if (Buffer.byteLength(next) + 1 > maxBytes) throw new Error('EVENT_TOO_LARGE')
      lines.push(next)
      let bytes = lines.reduce((n, line) => n + Buffer.byteLength(line) + 1, 0)
      while (bytes > maxBytes && lines.length > 1) bytes -= Buffer.byteLength(lines.shift()!) + 1
      await durableWrite(file, lines.join('\n') + '\n')
      state.written++; state.lastError = null
    })
  }).catch(error => { state.dropped++; state.lastError = errorCode(error) ?? (/lock/.test(String(error)) ? 'LOCK_TIMEOUT' : 'IO_ERROR') })
    .finally(() => { state.pending-- })
  return state.chain
}
export async function readAudit(root: string): Promise<AuditEntry[]> {
  let raw: string
  try { raw = (await readRegular(join(root, AUDIT_FILENAME), 8 * 1024 * 1024)).toString('utf8') }
  catch (error) { if (errorCode(error) === 'ENOENT') return []; throw error }
  const entries: AuditEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    try {
      const e = JSON.parse(line)
      if (typeof e.ts === 'number' && typeof e.sessionId === 'string' && Array.isArray(e.injected)) entries.push({ ...e, cwd: typeof e.cwd === 'string' ? e.cwd : '', injected: e.injected.filter((v: unknown) => typeof v === 'string'), truncated: Array.isArray(e.truncated) ? e.truncated.filter((v: unknown) => typeof v === 'string') : [], bytes: typeof e.bytes === 'number' ? e.bytes : 0 })
    } catch { /* A partial trailing line does not hide valid events. The next append repairs it. */ }
  }
  return entries
}
export function registerInjectionAudit(store: MemoryStore, config: Config, root: string, getQueryText?: (sessionId: string) => string | undefined) {
  const queries = new Map<string, string>()
  function queryFor(sessionId: string | undefined): string | undefined {
    if (sessionId && !queries.has(sessionId)) {
      const query = getQueryText?.(sessionId)?.trim()
      if (query) queries.set(sessionId, query.slice(0, 4096))
    }
    return sessionId ? queries.get(sessionId) : undefined
  }
  function record(detail: InjectionDetail, cwd: string | undefined, sessionId: string | undefined): string {
      if (!sessionId || !cwd) return detail.text
      const state = stateFor(root)
      if (!detail.text) state.emptyAttempts++
      if (!existsSync(join(root, FORMAT_FILE))) return detail.text
      const now = Date.now()
      void appendAudit(root, {
        schemaVersion: 1, eventId: randomUUID(), kind: 'render_attempt', pluginVersion: PLUGIN_VERSION, ts: now, timestamp: new Date(now).toISOString(),
        sessionId: sha256(sessionId), cwd: projectIdentity(cwd), injected: detail.injected.slice(0, 128), truncated: detail.truncated.slice(0, 128), bytes: detail.textBytes,
        budget: config.maxBytes, records: detail.records.slice(0, 128), excluded: detail.excluded.slice(0, 128), issues: detail.issues.slice(0, 32),
        detailsTruncated: detail.records.length > 128 || detail.excluded.length > 128 || detail.issues.length > 32,
        queryPolicy: 'first-nonempty-per-session-v1',
      }, { maxBytes: config.auditMaxBytes, retentionDays: config.auditRetentionDays })
      return detail.text
  }
  return {
    text(cwd: string | undefined, sessionId: string | undefined): string {
      return record(renderMemoryIndexDetail(store, config, cwd, queryFor(sessionId)), cwd, sessionId)
    },
    async textAsync(cwd: string | undefined, sessionId: string | undefined, signal?: AbortSignal): Promise<string> {
      const query = queryFor(sessionId)
      const cancelled = (): InjectionDetail => ({ text: '', injected: [], truncated: [], textBytes: 0, records: [], excluded: [], issues: ['assembly-aborted'], policy: 'strict-review-v1' })
      if (signal?.aborted) return record(cancelled(), cwd, sessionId)
      try {
        const detail = await renderMemoryIndexDetailAsync(store, config, cwd, query)
        return record(signal?.aborted ? cancelled() : detail, cwd, sessionId)
      }
      catch { return record(signal?.aborted ? cancelled() : { text: '', injected: [], truncated: [], textBytes: 0, records: [], excluded: [], issues: ['async-render-failed'], policy: 'strict-review-v1' }, cwd, sessionId) }
    },
    cleanup(sessionId: string) { queries.delete(sessionId) },
    flush: () => stateFor(root).chain,
  }
}
