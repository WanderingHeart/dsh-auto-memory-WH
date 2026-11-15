/**
 * v0.11.0 客户端完成通知：长轮次结束后用小鲸鱼气泡提示“这一轮跑完了”。
 *
 * 只依赖可选的 window.__dshWhaleNotify；没有小鲸鱼时静默（不注册定时器、不报错）。
 * 去重按宿主给的 id，跨页面刷新保留在 sessionStorage。
 */
import { completionMessage, type CompletionEvent } from '../completions.ts'
import type { WhaleHook, WhaleStorage, WhaleWindow } from './whale-notify.ts'

export type CompletionItem = CompletionEvent

export interface CompletionFeed {
  enabled?: boolean
  minSeconds?: number
  items?: CompletionItem[]
}

export interface CompletionNotifierOptions {
  request: (name: string, data: Record<string, unknown>, method?: 'GET' | 'POST') => Promise<unknown>
  win?: WhaleWindow
  storage?: WhaleStorage
  now?: () => number
  intervalMs?: number
  /** 页面加载后多久仍没有钩子就放弃（毫秒）。 */
  graceMs?: number
  /** 最近一次轮询时间（无钩子时用于宽松放弃）。 */
  startedAt?: number
}

export const COMPLETION_POLL_MS = 15_000
export const COMPLETION_GRACE_MS = 2 * 60_000
export const COMPLETION_DEDUPE_KEY = 'dsh-auto-memory-wh:completion-notified'
export const COMPLETION_DEDUPE_TTL_MS = 24 * 60 * 60_000

export function completionLines(item: CompletionItem): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: completionMessage(item) }]
}

export function selectUnseenCompletions(items: CompletionItem[] | undefined, seen: Record<string, number>): CompletionItem[] {
  if (!Array.isArray(items)) return []
  return items.filter(item => typeof item?.id === 'string' && item.id.length > 0 && seen[item.id] === undefined)
}

export function readCompletionSeen(storage: WhaleStorage | undefined, nowMs: number, ttlMs = COMPLETION_DEDUPE_TTL_MS): Record<string, number> {
  if (!storage) return {}
  let raw: string | null = null
  try {
    raw = storage.getItem(COMPLETION_DEDUPE_KEY)
  } catch {
    return {}
  }
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const seen: Record<string, number> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    if (value > nowMs || nowMs - value > ttlMs) continue
    seen[key] = value
  }
  return seen
}

export function writeCompletionSeen(storage: WhaleStorage | undefined, seen: Record<string, number>): void {
  if (!storage) return
  try {
    storage.setItem(COMPLETION_DEDUPE_KEY, JSON.stringify(seen))
  } catch {
    // sessionStorage 满或被禁用时放弃去重，不影响下次提醒。
  }
}

export function notifyCompletion(hook: WhaleHook | undefined, item: CompletionItem): boolean {
  if (typeof hook !== 'function') return false
  try {
    return hook({ lines: completionLines(item), ttlMs: 8000, sound: true }) === true
  } catch {
    return false
  }
}

function seenHook(win: WhaleWindow | undefined): WhaleHook | undefined {
  const candidate = (win as unknown as { __dshWhaleNotify?: unknown } | undefined)?.__dshWhaleNotify
  return typeof candidate === 'function' ? (candidate as WhaleHook) : undefined
}

/**
 * 安装轮询；返回清理函数。没有 window 或始终没有小鲸鱼钩子时不注册定时器。
 */
export function installCompletionNotifier(options: CompletionNotifierOptions): () => void {
  if (!options.win) return () => {}
  const target = options.win
  const now = options.now ?? (() => Date.now())
  const intervalMs = options.intervalMs ?? COMPLETION_POLL_MS
  const graceMs = options.graceMs ?? COMPLETION_GRACE_MS
  const startedAt = options.startedAt ?? now()
  let stopped = false
  let timer: ReturnType<typeof setInterval> | undefined
  let seen = readCompletionSeen(options.storage, now())

  const stop = (): void => {
    stopped = true
    if (timer !== undefined) clearInterval(timer)
  }

  const tick = async (): Promise<void> => {
    if (stopped) return
    const hook = seenHook(target)
    if (!hook) {
      if (now() - startedAt > graceMs) stop()
      return
    }
    let feed: CompletionFeed
    try {
      feed = (await options.request('completion.pending', {}, 'POST')) as CompletionFeed
    } catch {
      return
    }
    if (stopped) return
    if (feed?.enabled === false) {
      stop()
      return
    }
    for (const item of selectUnseenCompletions(feed?.items, seen)) {
      if (!notifyCompletion(hook, item)) continue
      seen = { ...seen, [item.id]: now() }
    }
    writeCompletionSeen(options.storage, seen)
  }

  void tick()
  timer = setInterval(() => void tick(), intervalMs)
  return stop
}
