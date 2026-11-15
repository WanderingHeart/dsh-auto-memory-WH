/**
 * In-process counters for the v0.3.0 concurrency observability surface.
 * Counters are monotonic per process and intentionally cheap: they never block a write.
 */
export interface MetricsSnapshot {
  startedAt: number
  writes: number
  writeErrors: number
  lockTimeouts: number
  busyErrors: number
  totalWriteMs: number
  maxWriteMs: number
  avgWriteMs: number
  recoveries: number
  backups: number
}

interface State {
  startedAt: number
  writes: number
  writeErrors: number
  lockTimeouts: number
  busyErrors: number
  totalWriteMs: number
  maxWriteMs: number
  recoveries: number
  backups: number
}

const fresh = (): State => ({ startedAt: Date.now(), writes: 0, writeErrors: 0, lockTimeouts: 0, busyErrors: 0, totalWriteMs: 0, maxWriteMs: 0, recoveries: 0, backups: 0 })
let state: State = fresh()

export function recordWrite(durationMs: number, error?: unknown): void {
  const duration = Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0
  state.writes++
  state.totalWriteMs += duration
  if (duration > state.maxWriteMs) state.maxWriteMs = duration
  if (error === undefined) return
  state.writeErrors++
  const text = error instanceof Error ? error.message : String(error)
  if (/timed out waiting for the writer lock/i.test(text)) state.lockTimeouts++
  if (/Storage busy or recovery required|recovery required|LOCK_TIMEOUT/i.test(text)) state.busyErrors++
}

export function recordRecovery(count = 1): void { state.recoveries += Math.max(0, Math.round(count)) }
export function recordBackup(count = 1): void { state.backups += Math.max(0, Math.round(count)) }

export function metricsSnapshot(): MetricsSnapshot {
  return {
    ...state,
    avgWriteMs: state.writes === 0 ? 0 : Math.round(state.totalWriteMs / state.writes),
  }
}

/** Test-only reset; production code never calls this. */
export function resetMetrics(): void { state = fresh() }
