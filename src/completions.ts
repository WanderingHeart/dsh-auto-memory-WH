/**
 * v0.11.0 完成通知：宿主侧跟踪“一轮运行”的时长，供客户端气泡轮询。
 *
 * 只读观察：不写记忆、不改变任务或会话状态；服务不可用时调用方自然拿到空列表。
 * 阈值只为过滤掉“一两句话就回完”的短轮次，避免每个回复都弹气泡。
 */

export interface CompletionEvent {
  /** 稳定 id：同一会话的同一轮次始终相同，供客户端去重。 */
  id: string
  sessionId: string
  startedAt: number
  endedAt: number
  durationMs: number
}

export interface CompletionTrackerOptions {
  /** 只报告运行时长不少于该值的轮次（默认 60 秒）。 */
  minDurationMs?: number
  /** 环形缓冲最多保留多少条（默认 20）。 */
  maxEvents?: number
  /** 可注入时钟，测试用。 */
  now?: () => number
}

export function completionId(sessionId: string, startedAt: number): string {
  return `${sessionId}@${startedAt}`
}

export function completionMessage(event: Pick<CompletionEvent, 'durationMs'>): string {
  const minutes = Math.max(1, Math.round(event.durationMs / 60_000))
  return `✅ 这一轮跑完了，用时约 ${minutes} 分钟`
}

export class CompletionTracker {
  private readonly running = new Map<string, number>()
  private readonly events: CompletionEvent[] = []
  private readonly minDurationMs: number
  private readonly maxEvents: number
  private readonly now: () => number

  constructor(options: CompletionTrackerOptions = {}) {
    this.minDurationMs = options.minDurationMs ?? 60_000
    this.maxEvents = options.maxEvents ?? 20
    this.now = options.now ?? (() => Date.now())
  }

  /** 记录一次状态变化；running→idle 且超过阈值时返回新完成的轮次。 */
  status(sessionId: string, status: 'running' | 'idle'): CompletionEvent | undefined {
    if (!sessionId) return undefined
    if (status === 'running') {
      if (!this.running.has(sessionId)) this.running.set(sessionId, this.now())
      return undefined
    }
    const startedAt = this.running.get(sessionId)
    if (startedAt === undefined) return undefined
    this.running.delete(sessionId)
    const endedAt = this.now()
    const durationMs = Math.max(0, endedAt - startedAt)
    if (durationMs < this.minDurationMs) return undefined
    const event: CompletionEvent = {
      id: completionId(sessionId, startedAt),
      sessionId,
      startedAt,
      endedAt,
      durationMs,
    }
    this.events.push(event)
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents)
    return event
  }

  /** 最近完成的轮次（新的在前）。 */
  pending(): CompletionEvent[] {
    return [...this.events].reverse()
  }

  /** 会话被销毁时清掉起点，避免下一轮把旧起点当成本轮开始。 */
  forget(sessionId: string): void {
    this.running.delete(sessionId)
  }
}
