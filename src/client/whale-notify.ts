/**
 * v0.7.0 小鲸鱼气泡通道（客户端适配器）。
 *
 * 只读：向宿主拉取“已到提醒时间”的任务，交给小鲸鱼插件的气泡钩子显示。
 * 检测不到 `window.__dshWhaleNotify` 时静默降级，不注册任何网络轮询。
 * 去重靠 sessionStorage，同一任务同一时刻只弹一次。
 */

export interface DueTaskItem {
  name: string
  title: string
  scope: 'user' | 'project'
  dueAt?: number
  remindAt?: number
  taskStatus?: string
}

export interface DueFeed {
  items: DueTaskItem[]
  now: number
  whale?: 'auto' | 'off'
}

export interface WhaleHookPayload {
  text?: string
  lines?: Array<{ type: 'text'; text: string }>
  ttlMs?: number
  sound?: boolean
}

export type WhaleHook = (payload: WhaleHookPayload) => boolean

export interface WhaleWindow {
  __dshWhaleNotify?: WhaleHook
  addEventListener?: (type: string, listener: () => void) => void
  removeEventListener?: (type: string, listener: () => void) => void
  document?: { visibilityState?: string }
}

export interface WhaleStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface WhaleNotifierOptions {
  request: (name: string, data: Record<string, unknown>, method?: 'GET' | 'POST') => Promise<unknown>
  win?: WhaleWindow
  storage?: WhaleStorage
  now?: () => number
  intervalMs?: number
  graceMs?: number
}

/** 提醒时刻：显式 remindAt 优先，缺失时退到 dueAt。 */
export function dueTaskAt(task: Pick<DueTaskItem, 'remindAt' | 'dueAt'>): number | undefined {
  const at = task.remindAt ?? task.dueAt
  return Number.isSafeInteger(at) ? at : undefined
}

/** 去重签名：同一任务改期后会得到新签名，允许再次提醒。 */
export function taskSignature(task: DueTaskItem): string {
  return task.scope + ':' + task.name + '@' + (dueTaskAt(task) ?? 0)
}

export const WHALE_POLL_MS = 30_000
export const WHALE_DUE_WINDOW_MS = 30 * 60_000
export const WHALE_MISSING_GRACE_MS = 5 * 60_000
export const WHALE_DEDUPE_TTL_MS = 24 * 60 * 60_000
export const WHALE_DEDUPE_KEY = 'dsh-auto-memory-wh:whale-notified'

/** 工具：从去重表里挑出“到点、在窗口内、还没弹过”的任务。 */
export function selectNotifiable(
  tasks: DueTaskItem[],
  nowMs: number,
  seen: Record<string, number>,
  windowMs = WHALE_DUE_WINDOW_MS,
): DueTaskItem[] {
  const picked: DueTaskItem[] = []
  for (const task of tasks) {
    const at = dueTaskAt(task)
    if (at === undefined) continue
    if (at > nowMs) continue
    if (nowMs - at > windowMs) continue
    if (seen[taskSignature(task)] !== undefined) continue
    picked.push(task)
  }
  return picked
}

/** 读取去重表：坏数据、未来时间、超 TTL 的条目统统丢弃。 */
export function readSeen(storage: WhaleStorage | undefined, nowMs: number, ttlMs = WHALE_DEDUPE_TTL_MS): Record<string, number> {
  if (!storage) return {}
  try {
    const raw = storage.getItem(WHALE_DEDUPE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      if (value > nowMs) continue
      if (nowMs - value > ttlMs) continue
      result[key] = value
    }
    return result
  } catch {
    return {}
  }
}

export function writeSeen(storage: WhaleStorage | undefined, seen: Record<string, number>): void {
  if (!storage) return
  try {
    storage.setItem(WHALE_DEDUPE_KEY, JSON.stringify(seen))
  } catch {
    // 存储被禁用时最坏情况是重复提醒一次，不影响主流程。
  }
}

/** 气泡内容：不包含任务正文，避免把记忆内容带进浮层。 */
export function whaleLines(task: DueTaskItem): Array<{ type: 'text'; text: string }> {
  const scope = task.scope === 'project' ? '项目' : '用户'
  return [
    { type: 'text', text: '⏰ ' + task.title },
    { type: 'text', text: scope + '记忆任务已到提醒时间' },
  ]
}

/** 调用挂件钩子；返回 false 表示钩子不存在、抛错或明确拒绝。 */
export function notifyWhale(hook: WhaleHook | undefined, task: DueTaskItem): boolean {
  if (typeof hook !== 'function') return false
  try {
    return hook({ lines: whaleLines(task), ttlMs: 0, sound: true }) === true
  } catch {
    return false
  }
}

/**
 * 安装轮询。返回清理函数。
 *
 * - 宿主返回 `whale: 'off'` 时立即停止轮询；
 * - 一开始没有钩子也要再看一会儿（挂件是异步加载的），超过 graceMs 才放弃；
 * - 页面重新可见时立即补一次检查。
 */
export function installWhaleNotifier(options: WhaleNotifierOptions): () => void {
  const win = options.win
  if (!win) return () => {}
  const target = win
  const intervalMs = options.intervalMs ?? WHALE_POLL_MS
  const graceMs = options.graceMs ?? WHALE_MISSING_GRACE_MS
  const now = options.now ?? (() => Date.now())
  const startedAt = now()
  let timer: ReturnType<typeof setInterval> | undefined
  let stopped = false

  const hook = (): WhaleHook | undefined => target.__dshWhaleNotify

  function stop(): void {
    if (stopped) return
    stopped = true
    if (timer !== undefined) clearInterval(timer)
    target.removeEventListener?.('visibilitychange', onVisibility)
  }

  function tick(): void {
    if (stopped) return
    const whale = hook()
    if (!whale) {
      // 挂件可能还没加载；等一会儿再放弃，避免误判“没装”。
      if (now() - startedAt > graceMs) stop()
      return
    }
    void options.request('tasks.due', {}, 'POST')
      .then(value => {
        if (stopped) return
        const feed = value as DueFeed
        if (feed?.whale === 'off') {
          stop()
          return
        }
        const items = Array.isArray(feed?.items) ? feed.items : []
        const seen = readSeen(options.storage, now())
        let changed = false
        for (const task of selectNotifiable(items, now(), seen)) {
          if (notifyWhale(whale, task)) {
            seen[taskSignature(task)] = now()
            changed = true
          }
        }
        if (changed) writeSeen(options.storage, seen)
      })
      .catch(() => {
        // 网络/宿主错误留给下一次轮询，不打扰用户。
      })
  }

  function onVisibility(): void {
    if (target.document?.visibilityState === 'visible') tick()
  }

  tick()
  timer = setInterval(tick, intervalMs)
  target.addEventListener?.('visibilitychange', onVisibility)
  return stop
}
