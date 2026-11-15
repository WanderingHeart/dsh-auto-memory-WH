/**
 * 自动固化的运行摘要（v0.12.2）。
 *
 * 只记录“最近一次发生了什么、累计写入/跳过多少条”，不保存对话内容；
 * 供面板“存储”抽屉展示，帮助判断自动总结是否值得继续开启。
 */

export type ConsolidationOutcome =
  | 'written'
  | 'nothing-written'
  | 'skipped'
  | 'truncated'
  | 'parse-error'
  | 'llm-error'
  | 'failed'

export interface ConsolidationRun {
  at: number
  outcome: ConsolidationOutcome
  reason?: string
  created: number
  updated: number
  superseded: number
  skipped: number
}

export interface ConsolidationSnapshot {
  enabled: boolean
  /** 闲置触发间隔(分钟);0 表示只在会话结束时触发。 */
  idleMinutes: number
  runs: number
  lastAt?: number
  lastOutcome?: ConsolidationOutcome
  lastReason?: string
  lastCreated: number
  lastUpdated: number
  lastSkipped: number
  totals: { written: number; skipped: number }
}

const HISTORY_LIMIT = 50

export class ConsolidationStats {
  private readonly history: ConsolidationRun[] = []
  private written = 0
  private skipped = 0

  record(run: ConsolidationRun): void {
    this.written += run.created + run.updated + run.superseded
    this.skipped += run.skipped
    this.history.push(run)
    if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT)
  }

  snapshot(enabled: boolean, idleMinutes = 0): ConsolidationSnapshot {
    const last = this.history[this.history.length - 1]
    const totals = { written: this.written, skipped: this.skipped }
    if (last === undefined) return { enabled, idleMinutes, runs: 0, lastCreated: 0, lastUpdated: 0, lastSkipped: 0, totals }
    return {
      enabled,
      idleMinutes,
      runs: this.history.length,
      lastAt: last.at,
      lastOutcome: last.outcome,
      ...(last.reason === undefined ? {} : { lastReason: last.reason }),
      lastCreated: last.created,
      lastUpdated: last.updated,
      lastSkipped: last.skipped,
      totals,
    }
  }
}
