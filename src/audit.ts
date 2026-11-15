import type { MemoryStore } from './store.ts'
import type { AuditEntry } from './audit-log.ts'
export { AUDIT_FILENAME, appendAudit, readAudit, registerInjectionAudit, getAuditStatus } from './audit-log.ts'
export type { AuditEntry } from './audit-log.ts'

/** 单个工作区的注入统计(按 cwd 聚合;面板"按项目"视图)。 */
export interface AuditProjectStats {
  /** 工作区绝对路径(空串归为 unknown)。 */
  cwd: string
  /** 该工作区出现过的会话数(去重)。 */
  sessions: number
  /** 注入事件数。 */
  injections: number
  /** 平均注入段字节。 */
  avgBytes: number
  /** 在该工作区注入过/被截断过的记忆条数(去重)。 */
  memories: number
  /** 截断事件总数。 */
  truncated: number
  /** 最近一次注入时刻。 */
  lastTs: number
}

/** 统计聚合(audit.stats API 的载荷形状)。 */
export interface AuditStats {
  /** 审计覆盖的会话数(按 sessionId 去重)。 */
  sessions: number
  /** 注入事件总数(条目数)。 */
  injections: number
  /** 平均注入段字节(概览指标;无事件为 0)。 */
  avgBytes: number
  /** 逐记忆注入统计:注入次数降序,同频按名称;truncatedCount 是被预算挤出的次数。
   *  scope(0.9.1):该记忆当前所在作用域(user/project/both=两层同名/missing=已删除)。 */
  memories: Array<{ name: string; injectedCount: number; truncatedCount: number; lastTs: number; scope: 'user' | 'project' | 'both' | 'missing' }>
  /** 按工作区聚合(注入次数降序):回答"哪个项目在吃预算/被截断"。 */
  projects: AuditProjectStats[]
  /** 最近 sessionsLimit 个注入事件(时间线视图,ts 升序)。 */
  timeline: Array<{ ts: number; sessionId: string; cwd: string; count: number; bytes: number; truncated: number }>
}

/**
 * 聚合审计统计(内存计算;条目量级 = 会话数 × 集合变化数,常态很小)。
 * store 用于标注每条记忆的作用域(0.9.1:用户级/项目级在注入榜上可分辨)——
 * 传 undefined 则跳过标注(UI 兼容旧宿主)。
 */
export function aggregateAudit(entries: AuditEntry[], sessionsLimit = 50, store?: MemoryStore): AuditStats {
  const perSession = new Map<string, number>()
  const perMemory = new Map<string, { injectedCount: number; truncatedCount: number; lastTs: number }>()
  const perProject = new Map<string, {
    sessions: Set<string>
    injections: number
    bytes: number
    names: Set<string>
    truncated: number
    lastTs: number
  }>()
  for (const entry of entries) {
    perSession.set(entry.sessionId, (perSession.get(entry.sessionId) ?? 0) + 1)
    // 按工作区聚合:空 cwd 归为 unknown(无会话上下文的裸组装不会产生审计行,
    // 但历史数据/手改可能留下空串)
    const cwdKey = entry.cwd.length > 0 ? entry.cwd : 'unknown'
    const project = perProject.get(cwdKey) ?? {
      sessions: new Set<string>(), injections: 0, bytes: 0, names: new Set<string>(), truncated: 0, lastTs: 0,
    }
    project.sessions.add(entry.sessionId)
    project.injections += 1
    project.bytes += entry.bytes
    project.truncated += entry.truncated.length
    project.lastTs = Math.max(project.lastTs, entry.ts)
    for (const name of entry.injected) project.names.add(name)
    for (const name of entry.truncated) project.names.add(name)
    perProject.set(cwdKey, project)
    for (const name of entry.injected) {
      const current = perMemory.get(name) ?? { injectedCount: 0, truncatedCount: 0, lastTs: 0 }
      current.injectedCount += 1
      current.lastTs = Math.max(current.lastTs, entry.ts)
      perMemory.set(name, current)
    }
    // 截断名单同样计入(被挤出注入的记忆才是有信息量的那部分——注入榜在
    // 注入集合稳定的会话里全是同分,截断次数才是区分度)
    for (const name of entry.truncated) {
      const current = perMemory.get(name) ?? { injectedCount: 0, truncatedCount: 0, lastTs: 0 }
      current.truncatedCount += 1
      perMemory.set(name, current)
    }
  }
  const avgBytes = entries.length === 0
    ? 0
    : Math.round(entries.reduce((sum, entry) => sum + entry.bytes, 0) / entries.length)
  // 作用域标注(0.9.1):反查 store 判断每条被统计的记忆在哪个层。
  // 项目层 cwd 不定(审计行各带 cwd,但同名记忆跨项目可能多处存在)——
  // 取统计里出现过的全部 cwd 逐个查,任一命中即算 project。
  const memories: AuditStats['memories'] = [...perMemory.entries()]
    .map(([name, m]) => ({ name, ...m, scope: 'missing' as const }))
    .sort((a, b) => b.injectedCount - a.injectedCount || a.name.localeCompare(b.name))
  if (store !== undefined) {
    const cwds = [...new Set(entries.map(e => e.cwd).filter(c => c.length > 0))]
    // 同步走 readIndexSync(注入热路径同款),从索引行解析记忆名集合
    const namesInIndex = (scope: 'user' | 'project', cwd?: string): Set<string> => {
      const index = store.readIndexSync(scope, cwd) ?? ''
      return new Set([...index.matchAll(/\]\(([^)\s]+)\.md\)/g)].map(m => m[1]!))
    }
    for (const m of memories) {
      const inUser = namesInIndex('user').has(m.name)
      const inProject = cwds.some(cwd => namesInIndex('project', cwd).has(m.name))
      m.scope = inUser && inProject ? 'both' : inUser ? 'user' : inProject ? 'project' : 'missing'
    }
  }
  const projects: AuditStats['projects'] = [...perProject.entries()]
    .map(([cwd, project]) => ({
      cwd,
      sessions: project.sessions.size,
      injections: project.injections,
      avgBytes: project.injections === 0 ? 0 : Math.round(project.bytes / project.injections),
      memories: project.names.size,
      truncated: project.truncated,
      lastTs: project.lastTs,
    }))
    .sort((a, b) => b.injections - a.injections || b.lastTs - a.lastTs || a.cwd.localeCompare(b.cwd))
  return {
    sessions: perSession.size,
    injections: entries.length,
    avgBytes,
    memories,
    projects,
    timeline: entries.slice(-sessionsLimit).map(entry => ({
      ts: entry.ts,
      sessionId: entry.sessionId,
      cwd: entry.cwd,
      count: entry.injected.length,
      bytes: entry.bytes,
      truncated: entry.truncated.length,
    })),
  }
}
