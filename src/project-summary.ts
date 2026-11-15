/** Two-level memory: only a model-authored abstract enters the user scope. */
import { createHash } from 'node:crypto'
import { detectDirectivePattern, type MemoryStore } from './store.ts'
import type { MemoryRecord } from './types.ts'

export type SummaryResult = 'written' | 'unchanged' | 'disabled' | 'missing' | 'invalid' | 'blocked' | 'conflict' | 'failed'

export function cleanUserSummary(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  // Reject rather than truncate: a truncated detail is not an abstraction.
  if (!text || [...text].length > 160 || /[\r\n\x00-\x1f]/u.test(text) || detectDirectivePattern(text)) return null
  // Do not promote obvious private locations, addresses or credentials.
  if (/(?:[a-z]:[\\/]|\\\\|https?:\/\/|(?:^|\s)\/(?:home|Users|tmp|var)\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:api[_ -]?key|password|token|secret|密码|密钥)\s*[:=：])/iu.test(text)) return null
  return text
}

export async function saveUserSummary(store: MemoryStore, source: MemoryRecord, cwd: string, raw: unknown, enabled: boolean): Promise<SummaryResult> {
  if (!enabled || source.scope !== 'project') return 'disabled'
  if (raw === undefined || raw === null || raw === '') return 'missing'
  const summary = cleanUserSummary(raw)
  if (!summary) return 'invalid'
  if (source.type === 'task' || source.disabled || source.status === 'disputed' || source.status === 'superseded') return 'blocked'
  try {
    // Follow replacement ancestry to keep one stable summary when a fact evolves.
    let anchor = source
    const seen = new Set<string>([source.name])
    while (anchor.supersedes && !seen.has(anchor.supersedes)) {
      seen.add(anchor.supersedes)
      const parent = await store.read(anchor.supersedes, 'project', cwd)
      if (!parent) break
      anchor = parent
    }
    const key = createHash('sha256').update(JSON.stringify([cwd, anchor.name])).digest('hex')
    const name = `project-summary-${key.slice(0, 32)}`
    const current = await store.read(name, 'user', cwd)
    if (current && (current.metadata?.projectSummarySource !== key || current.disabled || current.status === 'disputed' || current.status === 'superseded')) return 'blocked'
    if (current?.body === summary && current.type === source.type) return 'unchanged'
    // Do not copy title, body, evidence quotes, local paths or project-only topic ids.
    const written = await store.write({ name, type: source.type, title: summary, description: summary, body: summary,
      importance: source.importance, metadata: { projectSummarySource: key },
      ...(current ? { expectedRevision: current.revision } : { onlyIfAbsent: true }),
    }, 'user', cwd)
    return written ? 'written' : 'conflict'
  } catch {
    // The detailed record is already durable; a failed projection must not lose it.
    return 'failed'
  }
}
