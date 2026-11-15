import { beforeEach, describe, expect, it } from 'vitest'
import { metricsSnapshot, recordBackup, recordRecovery, recordWrite, resetMetrics } from '../src/metrics.ts'

describe('process metrics', () => {
  beforeEach(() => resetMetrics())
  it('tracks writes, errors and averages', () => {
    recordWrite(10)
    recordWrite(30)
    recordWrite(20, new Error('Revision conflict: reload before editing'))
    const snapshot = metricsSnapshot()
    expect(snapshot.writes).toBe(3)
    expect(snapshot.writeErrors).toBe(1)
    expect(snapshot.avgWriteMs).toBe(20)
    expect(snapshot.maxWriteMs).toBe(30)
    expect(snapshot.lockTimeouts).toBe(0)
    expect(snapshot.busyErrors).toBe(0)
  })
  it('classifies lock timeouts and busy/recovery errors', () => {
    recordWrite(10500, new Error('atomic-write: timed out waiting for the writer lock at C:\\x.lock'))
    recordWrite(3, new Error('Storage busy or recovery required; retry after maintenance'))
    const snapshot = metricsSnapshot()
    expect(snapshot.lockTimeouts).toBe(1)
    expect(snapshot.busyErrors).toBe(1)
  })
  it('counts recoveries and backups', () => {
    recordRecovery(2)
    recordBackup()
    expect(metricsSnapshot()).toMatchObject({ recoveries: 2, backups: 1 })
  })
})
