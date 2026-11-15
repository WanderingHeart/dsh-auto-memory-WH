import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MemoryFace } from './index.ts'
import { projectPoint, relaxGraph, rotatePoint, seedGraph, type GraphNode, type GraphPoint } from './graph.ts'
import { editionProfile, type Edition, type EditionFeatures } from '../editions.ts'
type Scope = 'user' | 'project'
interface GraphNodeView { name: string; title: string; type: string; scope: string; degree: number }
interface GraphEdgeView { from: string; to: string; score: number }
interface GraphView { nodes: GraphNodeView[]; edges: GraphEdgeView[]; thresholds: { weak: number; strong: number } }
interface Row { name: string; title?: string; description: string; type: string; body?: string; revision: string; status: string; pinned?: boolean; disabled?: boolean; trustReason?: string; supersededBy?: string; supersedes?: string; topic?: string; dueAt?: number; remindAt?: number; priority?: number; taskStatus?: string }
interface ListResult { records: Row[]; total: number; issues: string[]; maxBytes: number; storage: { root: string; rootSource?: string; readOnly: boolean; reason?: string; formatVersion: number | null; lastBackup: string | null }; audit: { degraded: boolean; dropped: number; pending: number; maxBytes: number; retentionDays: number }; schedule?: { available: boolean; mapped: number; lastReconcileAt?: number; lastError?: string }; consolidation?: { enabled: boolean; idleMinutes?: number; runs: number; lastAt?: number; lastOutcome?: string; lastCreated: number; lastUpdated: number; lastSkipped: number; totals?: { written: number; skipped: number } }; edition?: Edition; features?: EditionFeatures }
/** v0.12.0：宿主没给 features（旧 mock/旧宿主）时按全功能渲染，保持既有测试不变。 */
const FULL_FEATURES: EditionFeatures = { reminders: true, autoSummarize: true, autoBackup: true, merge: true, graph: true, importExport: true, migration: true, batch: true }
/** v0.12.1：档位滑条顺序——左低、中、右高。 */
const EDITION_ORDER: Edition[] = ['minimal', 'standard', 'full']
/** v0.12.3：工具栏「总结」浮层里的候选会话。 */
interface SummarySession { id: string; cwd?: string; title?: string; lastActivityAt: number; lines: number }
interface SummaryDiagnostics { captures: number; routes: number; agents: number; autoSummarize: boolean }
const SUMMARY_REASONS: Record<string, string> = {
  'too-short': '这段对话还太短，至少要 2 个用户轮次、600 字符。',
  'nothing-new': '没有新的内容可总结。',
  busy: '这个会话正在总结，请稍候。',
  'llm-unavailable': '当前没有可用的模型服务。',
  'llm-error': '模型调用失败，稍后可在会话结束时自动重试。',
  aborted: '总结被中止。',
  truncated: '输出被截断，这次没有写入；可以调大 autoSummarizeMaxTokens。',
  'parse-error': '模型输出格式不符合要求，这次没有写入。',
  failed: '总结失败，请查看插件日志。',
}
/** 相对时间：面板浮层里只需粗粒度。 */
function relativeActivity(at: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}
/** 宿主有时把会话标题填成“@路径”；面板显示时换成可读的“未命名会话 · 目录名”。 */
function sessionLabel(row: { title?: string; cwd?: string }): string {
  const title = row.title?.trim()
  const pathLike = !title || title.startsWith('@') || /^[A-Za-z]:[\\/]/.test(title) || title.startsWith('\\\\')
  if (!pathLike) return title
  const base = (row.cwd ?? '').split(/[\\/]/).filter(Boolean).pop()
  return base ? `未命名会话 · ${base}` : '未命名会话'
}
interface Archive { id: string; name: string; hash: string; deletedAt: string }
interface AuditView { status: { degraded: boolean; dropped: number }; entries: Array<{ timestamp: string; bytes: number; budget: number; detailsTruncated: boolean; records: Array<{ name: string }>; excluded: Array<{ id: string; reason: string }> }> }
interface DuplicateView { scanned: number; threshold: number; groups: Array<{ similarity: number; members: Row[] }> }
interface QualityIssueView { code: string; severity: string; message: string; hint: string }
interface QualityView { scanned: number; flagged: number; byCode: Record<string, number>; records: Array<{ name: string; scope: string; type: string; status: string; issues: QualityIssueView[] }>; index?: { bytes: number; budget: number; excluded: Array<{ id: string; reason: string }> }; duplicates?: { groups: number; threshold: number } }
interface RelatednessHitView { name: string; scope: string; score: number; strength: 'weak' | 'strong'; reasons: string[] }
interface RelatedView { target: { name: string; scope: string }; items: RelatednessHitView[]; thresholds: { weak: number; strong: number } }
/** v1.0.0-rc.7：JSON 包导入的只读预演结果（与 transfer.ts 的 ImportPlan 对应）。 */
interface ImportPlanView { checksum: string; creates: string[]; updates: string[]; skipped: string[]; conflicts: string[] }
/** v1.0.0-rc.9：面板导入的单文件上限；超过就提示拆包，不进入预演。 */
const MAX_TRANSFER_BYTES = 2 * 1024 * 1024
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} 字节`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
/** v1.0.0-rc.3：人物弧光（只读，按主题成章、章内按时间）。 */
interface ArcEntryView { key: string; name: string; title: string; description: string; type: string; scope: string; origin: string; originPath?: string; status: string; at: number; updatedMs?: number; supersededBy?: string; supersedes?: string }
interface ArcChapterView { topic: string; title: string; note?: string; records: ArcEntryView[] }
interface ArcViewData { chapters: ArcChapterView[]; total: number; skipped: number; truncated: boolean; sources: Array<{ scope: string; slug: string; label: string; path?: string; count: number }>; generatedMs: number }
interface MergeMember { name: string; description: string; type: string; status: string; revision: string; updatedMs: number }
interface MergeCluster { sharedTokens: string[]; suggestedName: string; suggestedType: string; score: number; members: MergeMember[] }
interface MergeView { scanned: number; clusters: MergeCluster[] }
interface MetricsView { metrics: { writes: number; writeErrors: number; lockTimeouts: number; busyErrors: number; avgWriteMs: number; maxWriteMs: number; recoveries: number; backups: number; startedAt: number }; audit: { degraded: boolean; dropped: number; pending: number }; storage: { root: string; readOnly: boolean; formatVersion: number | null } }
interface Draft { row: Row; scope: Scope; sessionId: string; expectedRevision: string | null; body: string }
export type MemoryPageProps = PropsRuntime<'main'> & PropsLocale<'autoMemoryWH'> & MemoryFace
const statusLabels: Record<string, string> = { candidate: '自动记录', verified: '系统确认', legacy: '旧记录', disputed: '有争议', superseded: '已取代' }
// v0.9.0: 任务提醒只存在宿主原生“自动化任务”，面板不再编辑任务字段。
const MEMORY_TYPE_OPTIONS = ['user', 'feedback', 'project', 'reference'] as const
const typeLabels: Record<string, string> = { user: '用户', feedback: '反馈', project: '项目', reference: '参考' }
/** 每页条数（v0.6.0 从 25 收紧到 5，面板更接近“卡片流”）。 */
const PAGE_SIZE = 5
const exclusionLabels: Record<string, string> = { ...statusLabels, disabled: '已静音', stale: '已过期', budget: '超过预算' }
function message(error: unknown): string {
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) return '连接中断，请保留草稿并在恢复连接后重试。'
  return error instanceof Error ? error.message : '操作失败，请重试。'
}
function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
/** v0.8.0：重复与合并统一成一组行，相似度用百分比进度条展示。 */
interface MergeRow { key: string; title: string; members: Array<{ name: string; revision: string; status: string; type: string }>; similarity: number; name: string; type: string }
/** v1.0.0-rc.2：主题感知的自动合并计划与撤销账本。 */
interface AutoMergePlanView { key: string; topic: string; score: number; reasons: string[]; members: Array<{ name: string; title?: string }> }
interface AutoMergeEntryView { id: string; at: string; topic: string; target: string; sources: string[]; score: number }
interface AutoMergeView { auto: AutoMergePlanView[]; ask: AutoMergePlanView[]; entries: AutoMergeEntryView[] }
function idleCadenceLabel(minutes: number | undefined): string {
  const value = minutes ?? 0
  if (value <= 0) return '会话结束时触发一次'
  if (value === 60) return '闲置一小时触发一次'
  if (value % 60 === 0) return `闲置 ${value / 60} 小时触发一次`
  return `闲置 ${value} 分钟触发一次`
}

function sanitizeTargetName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'merged-memory'
}
function RefreshIcon(): ReactNode {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5V5h-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
function GearIcon(): ReactNode {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.8 1.6h2.4l.35 1.55c.3.12.6.27.87.45l1.5-.5 1.2 2.08-1.18 1.05c.02.16.03.33.03.5s-.01.34-.03.5l1.18 1.05-1.2 2.08-1.5-.5c-.27.18-.57.33-.87.45l-.35 1.55H6.8l-.35-1.55a5.3 5.3 0 0 1-.87-.45l-1.5.5-1.2-2.08 1.18-1.05a5.4 5.4 0 0 1-.03-.5c0-.17.01-.34.03-.5L2.88 5.18l1.2-2.08 1.5.5c.27-.18.57-.33.87-.45L6.8 1.6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><circle cx="8" cy="6.5" r="1.7" stroke="currentColor" strokeWidth="1.3" /></svg>
}
function SearchIcon(): ReactNode {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="1.5" /><path d="m10.4 10.4 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
}
/** v0.8.2：设置项统一收进左侧悬浮抽屉，不再堆在页面最下方。 */
type PanelKind = 'storage' | 'archive' | 'audit' | 'metrics' | 'quality' | 'migration'
const panelLabels: Record<PanelKind, string> = { storage: '存储', archive: '归档记录', audit: '组装审计', metrics: '运行指标', quality: '记忆质量体检', migration: '迁移检查' }
function SimilarityBar({ value, label = '相似度' }: { value: number; label?: string }): ReactNode {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return <div className="dam-wh-bar" role="img" aria-label={`${label} ${percent}%`}><div className="dam-wh-bar-track"><div className="dam-wh-bar-fill" style={{ width: `${percent}%` }} /></div><span className="dam-wh-bar-label">{percent}%</span></div>
}

const typeColors: Record<string, string> = { user: '#4f7cff', feedback: '#f2994a', project: '#27ae60', reference: '#9b51e0', task: '#eb5757' }

/** v0.10.0：关系图——自绘 3D 投影，无第三方依赖。 */
function MemoryGraphView({ request, target, onPick, onClose }: { request: MemoryFace['request']; target: { scope: Scope; sessionId?: string }; onPick: (name: string) => void; onClose: () => void }): ReactNode {
  const [view, setView] = useState<GraphView | null>(null)
  const [error, setError] = useState('')
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const nodesRef = useRef<GraphNode[]>([])
  const rotationRef = useRef({ x: -0.22, y: 0.5 })
  const zoomRef = useRef(1)
  const dragRef = useRef<{ x: number; y: number; moved: number } | null>(null)

  useEffect(() => {
    let alive = true
    setError('')
    void (async () => {
      try {
        const result = await request('relatedness.graph', { ...target, threshold: 30 }, 'POST') as GraphView
        if (!alive) return
        setView(result)
        nodesRef.current = relaxGraph(seedGraph(result.nodes), result.edges)
      } catch (failure) {
        if (alive) setError(message(failure))
      }
    })()
    return () => { alive = false }
  }, [request, target])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !view) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let frame = 0
    let running = true
    const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const edgesByKey = view.edges.map(edge => ({ ...edge, fromKey: edge.from, toKey: edge.to }))
    const names = new Set(view.nodes.map(node => node.name))

    const draw = (): void => {
      if (!running) return
      const rect = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      const width = Math.max(300, Math.round(rect.width))
      const height = Math.max(300, Math.round(rect.height))
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.clearRect(0, 0, width, height)
      if (!reduced) rotationRef.current.y += 0.0016
      const rotation = rotationRef.current
      const projected = new Map<string, { x: number; y: number; depth: number; scale: number }>()
      for (const node of nodesRef.current) {
        const point = projectPoint(rotatePoint({ x: node.x, y: node.y, z: node.z }, rotation.x, rotation.y), { width, height, zoom: zoomRef.current })
        projected.set(node.name, point)
      }
      for (const edge of edgesByKey) {
        if (!names.has(edge.from) || !names.has(edge.to)) continue
        const a = projected.get(edge.from)
        const b = projected.get(edge.to)
        if (!a || !b || !a.scale || !b.scale) continue
        const strength = Math.min(1, edge.score / 100)
        ctx.strokeStyle = `rgba(120,140,200,${0.06 + strength * 0.22})`
        ctx.lineWidth = 0.6 + strength * 1.6
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      const ordered = [...nodesRef.current].sort((left, right) => (projected.get(left.name)?.depth ?? 0) - (projected.get(right.name)?.depth ?? 0))
      for (const node of ordered) {
        const point = projected.get(node.name)
        if (!point) continue
        const active = hover?.name === node.name
        const radius = (3 + Math.min(6, node.degree * 0.9)) * (0.7 + point.scale * 0.35)
        ctx.beginPath()
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2)
        ctx.fillStyle = typeColors[node.type] ?? '#8a8f99'
        ctx.globalAlpha = 0.55 + Math.min(0.45, point.scale - 0.4)
        ctx.fill()
        ctx.globalAlpha = 1
        if (active) {
          ctx.strokeStyle = '#1f2328'
          ctx.lineWidth = 1.6
          ctx.stroke()
        }
      }
      frame = window.requestAnimationFrame(draw)
    }
    draw()
    return () => { running = false; window.cancelAnimationFrame(frame) }
  }, [view, hover])

  const pickAt = (clientX: number, clientY: number): string | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const rotation = rotationRef.current
    let best: { name: string; distance: number } | null = null
    for (const node of nodesRef.current) {
      const point = projectPoint(rotatePoint({ x: node.x, y: node.y, z: node.z }, rotation.x, rotation.y), { width: rect.width, height: rect.height, zoom: zoomRef.current })
      const distance = Math.hypot(point.x - (clientX - rect.left), point.y - (clientY - rect.top))
      if (distance <= 14 && (!best || distance < best.distance)) best = { name: node.name, distance }
    }
    return best?.name ?? null
  }

  return <section aria-label="关系图" className="dam-wh-graph">
    <div className="dam-wh-toolbar">
      <strong>关系图</strong>
      <span className="dam-wh-note">{view ? `${view.nodes.length} 条记忆 · ${view.edges.length} 条关联 · 阈值 ${view.thresholds.weak} 分` : '正在计算…'}</span>
      <button className="dam-wh-btn" onClick={onClose}>返回列表</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {view && view.nodes.length === 0 && <p>这个范围还没有可展示的记忆。</p>}
    {view && view.nodes.length > 0 && <>
      <canvas ref={canvasRef} className="dam-wh-graph-canvas"
        onPointerDown={event => { (event.target as HTMLCanvasElement).setPointerCapture?.(event.pointerId); dragRef.current = { x: event.clientX, y: event.clientY, moved: 0 } }}
        onPointerMove={event => {
          const drag = dragRef.current
          if (drag) {
            const dx = event.clientX - drag.x
            const dy = event.clientY - drag.y
            drag.moved += Math.abs(dx) + Math.abs(dy)
            rotationRef.current = { x: Math.max(-1.3, Math.min(1.3, rotationRef.current.x + dy * 0.008)), y: rotationRef.current.y + dx * 0.008 }
            dragRef.current = { x: event.clientX, y: event.clientY, moved: drag.moved }
            return
          }
          const hit = pickAt(event.clientX, event.clientY)
          setHover(hit ? { name: hit, x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY } : null)
        }}
        onPointerUp={event => {
          const drag = dragRef.current
          dragRef.current = null
          if (drag && drag.moved < 6) {
            const hit = pickAt(event.clientX, event.clientY)
            if (hit) onPick(hit)
          }
        }}
        onPointerLeave={() => { dragRef.current = null; setHover(null) }}
        onWheel={event => { event.preventDefault(); zoomRef.current = Math.max(0.5, Math.min(2.2, zoomRef.current - event.deltaY * 0.0012)) }}
      />
      {hover && <p className="dam-wh-graph-hint">{view.nodes.find(node => node.name === hover.name)?.title ?? hover.name}</p>}
      <p className="dam-wh-note">拖拽旋转、滚轮缩放、点击节点跳到该条记忆；颜色按类型区分。该视图只读，不会修改或合并任何记忆。</p>
    </>}
  </section>
}

/**
 * v1.0.0-rc.3：人物弧光——把记忆按主题成章、章内按时间串成一条线。
 *
 * 与关系图互补：关系图看“此刻谁和谁相关”，弧光看“时间上怎么演变”。
 * 跨用户层与全部项目合成，只读；点击条目跳到该条记忆。
 */
function MemoryArcView({ request, target, onPick, onClose }: { request: MemoryFace['request']; target: { scope: Scope; sessionId?: string }; onPick: (entry: ArcEntryView) => void; onClose: () => void }): ReactNode {
  const [view, setView] = useState<ArcViewData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    setError('')
    void (async () => {
      try {
        const result = await request('arc.view', { ...target }, 'POST') as ArcViewData
        if (alive) setView(result)
      } catch (failure) {
        if (alive) setError(message(failure))
      }
    })()
    return () => { alive = false }
  }, [request, target])
  const when = (at: number): string => at > 0 ? new Date(at).toLocaleDateString('zh-CN') : '时间未知'
  return <section aria-label="人物弧光" className="dam-wh-arc">
    <div className="dam-wh-toolbar">
      <strong>人物弧光</strong>
      <span className="dam-wh-note">{view ? `${view.chapters.length} 个篇章 · ${view.total} 条记忆` : '正在整理…'}</span>
      <button className="dam-wh-btn" onClick={onClose}>返回列表</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {view?.truncated && <p role="alert">记录过多，只整理了前 {view.total} 条；弧光是只读视图，不影响存储。</p>}
    {view !== null && view.skipped > 0 && <p className="dam-wh-note">有 {view.skipped} 个文件无法解析或读取，已跳过，未当作有效记忆。</p>}
    {view && view.sources.length > 0 && <p className="dam-wh-note">来源：{view.sources.map(source => `${source.label} ${source.count}`).join(' · ')}</p>}
    {view && view.chapters.length === 0 && <p role="status">记忆库里还没有记录。</p>}
    {view?.chapters.map(chapter => <section key={chapter.topic} className="dam-wh-arc-chapter" aria-label={`篇章 ${chapter.title}`}>
      <h3>{chapter.title} <span className="dam-wh-badge">{chapter.records.length} 条</span></h3>
      {chapter.note && <p className="dam-wh-note">{chapter.note}</p>}
      <ol className="dam-wh-arc-list">{chapter.records.map(entry => <li key={entry.key}>
        <time dateTime={entry.at > 0 ? new Date(entry.at).toISOString() : undefined}>{when(entry.at)}</time>
        <button className="dam-wh-arc-title" onClick={() => onPick(entry)}>{entry.title}</button>
        <span className="dam-wh-badge" title={entry.originPath ?? entry.origin}>{entry.origin}</span>
        <span className="dam-wh-badge">{statusLabels[entry.status] ?? entry.status}</span>
        {entry.supersededBy && <span className="dam-wh-note">被 {entry.supersededBy} 取代</span>}
        {entry.supersedes && <span className="dam-wh-note">取代了 {entry.supersedes}</span>}
        {entry.description && <p className="dam-wh-desc">{entry.description}</p>}
      </li>)}</ol>
    </section>)}
    {view && <p className="dam-wh-note">按主题成章、章内按时间排序，跨用户层与全部项目；只读，不会修改或合并任何记忆。</p>}
  </section>
}
interface MergeHistoryEntry { id: string; target: string; title: string; at: string; kind: string; sources: string[]; body: string; available: boolean; canUndo: boolean }

export function MemoryPage({ request }: MemoryPageProps): ReactNode {
  const [scope, setScope] = useState<Scope>('user')
  const [sessionId, setSessionId] = useState('')
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [type, setType] = useState('')
  const [offset, setOffset] = useState(0), [refresh, setRefresh] = useState(0)
  const [data, setData] = useState<ListResult | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [archives, setArchives] = useState<Archive[] | null>(null)
  const [audit, setAudit] = useState<AuditView | null>(null)
  const [mergeRows, setMergeRows] = useState<MergeRow[] | null>(null)
  const [mergePick, setMergePick] = useState<string[]>([])
  const [mergeNote, setMergeNote] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<MergeHistoryEntry[] | null>(null)
  const [historyError, setHistoryError] = useState('')
  const historyRef = useRef<HTMLDivElement>(null)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const [autoMerge, setAutoMerge] = useState<AutoMergeView | null>(null)
  const [metricsView, setMetricsView] = useState<MetricsView | null>(null)
  const [quality, setQuality] = useState<QualityView | null>(null)
  const [related, setRelated] = useState<{ forName: string; view: RelatedView } | null>(null)
  const [backupNote, setBackupNote] = useState<string | null>(null)
  const [migration, setMigration] = useState<{ legacyFiles: number; targetFiles: number; guidance: string } | null>(null)
  const [backupInfo, setBackupInfo] = useState<{ enabled: boolean; intervalHours: number; keep: number; last: { createdAt: string; files: number } | null } | null>(null)
  const [sessions, setSessions] = useState<Array<{ id: string; cwd: string }>>([])
  const [panel, setPanel] = useState<PanelKind | null>(null)
  const [graphOpen, setGraphOpen] = useState(false)
  const [arcOpen, setArcOpen] = useState(false)
  /** v1.0.0-rc.7：JSON 包导入——文件内容、只读预演与冲突策略。 */
  const [transferPlan, setTransferPlan] = useState<{ pkg: unknown; plan: ImportPlanView; bytes: number; records: number } | null>(null)
  const [transferChoice, setTransferChoice] = useState<'skip' | 'fork'>('skip')
  const [transferNote, setTransferNote] = useState('')
  const [dragging, setDragging] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [editionOpen, setEditionOpen] = useState(false)
  // v0.12.3：工具栏「总结」浮层——列出最近活跃、有未固化内容的会话。
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summarySessions, setSummarySessions] = useState<SummarySession[] | null>(null)
  const [summaryDiag, setSummaryDiag] = useState<SummaryDiagnostics | null>(null)
  const [summaryRunning, setSummaryRunning] = useState<string | null>(null)
  const [summaryNote, setSummaryNote] = useState('')
  /** 上一次列表查询的“过滤条件+页码”快照：只有它变化才清空列表。 */
  const lastListKeyRef = useRef('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const settingsRef = useRef<HTMLDetailsElement>(null)
  const filterRef = useRef<HTMLDetailsElement>(null)
  const editionRef = useRef<HTMLDetailsElement>(null)
  const summaryRef = useRef<HTMLDetailsElement>(null)
  const transferInputRef = useRef<HTMLInputElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 面板相对容器右缘的偏移：让面板悬浮在设置菜单左侧，两者并列。 */
  const [drawerRight, setDrawerRight] = useState(404)
  const refreshButtonRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const editorWasOpenRef = useRef(false)
  const editorFocusPendingRef = useRef(false)
  const returnFocusPendingRef = useRef(false)
  const saveFocusRef = useRef<HTMLElement | null>(null)
  const target = { scope, ...(sessionId ? { sessionId } : {}) }
  useEffect(() => {
    if (!historyOpen) return
    let alive = true
    setHistory(null); setHistoryError('')
    void request('merge.history', { scope, ...(sessionId ? { sessionId } : {}) }, 'POST').then(result => {
      if (alive) setHistory((result as { entries: MergeHistoryEntry[] }).entries)
    }).catch(failure => { if (alive) setHistoryError(message(failure)) })
    return () => { alive = false }
  }, [historyOpen, scope, sessionId, refresh, request])
  useEffect(() => {
    if (!historyOpen) return
    historyRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const outside = (event: MouseEvent): void => {
      const node = event.target as Node
      if (!historyRef.current?.contains(node) && !historyButtonRef.current?.contains(node)) setHistoryOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [historyOpen])
  // v0.6.1:质量体检结果按记录名并入列表,每条下面直接显示,不必再翻到底部
  const qualityIssues = new Map((quality?.records ?? []).map(record => [record.name, record.issues]))
  const reload = useCallback(() => setRefresh(n => n + 1), [])
  /** v0.8.8：打开功能面板时保留设置菜单，并把面板悬浮在菜单左侧（像右键子菜单）。 */
  const openPanel = (next: PanelKind): void => {
    const menu = settingsRef.current?.querySelector('.dam-wh-settings-menu') as HTMLElement | null
    const menuWidth = menu?.getBoundingClientRect().width ?? 300
    setDrawerRight(window.innerWidth < 760 ? 0 : Math.round(menuWidth) + 62)
    setPanel(next)
    if (next === 'archive') void act(async () => { const result = await request('archive.list', target) as { archives: Archive[] }; setArchives(result.archives) }, false)
    else if (next === 'audit') void act(async () => setAudit(await request('audit.events', target) as AuditView), false)
    else if (next === 'metrics') void act(async () => setMetricsView(await request('memory.metrics', target, 'POST') as MetricsView), false)
    else if (next === 'quality') void act(async () => setQuality(await request('quality.report', target, 'POST') as QualityView), false)
    else if (next === 'migration') void act(async () => setMigration(await request('migration.status', {}) as { legacyFiles: number; targetFiles: number; guidance: string }), false)
  }
  /** v0.8.6：设置菜单与展开面板都支持点空白处/Esc 关闭，不再必须点右上角叉。 */
  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      const node = event.target as Node
      const settings = settingsRef.current
      const inSettings = settings?.contains(node) ?? false
      const inDrawer = drawerRef.current?.contains(node) ?? false
      // v0.12.4：工具栏浮层（筛选/档位/总结）互斥——点任何一个按钮或空白处，
      // 先收起所有不包含点击目标的 details，避免两个浮层叠在一起。
      for (const menu of Array.from(document.querySelectorAll<HTMLDetailsElement>('details.dam-wh-filter[open]'))) {
        if (menu.contains(node)) continue
        menu.removeAttribute('open')
        if (menu === filterRef.current) setFilterOpen(false)
        if (menu === editionRef.current) setEditionOpen(false)
        if (menu === summaryRef.current) setSummaryOpen(false)
      }
      if (inSettings || inDrawer) return
      if (settings?.open) {
        settings.removeAttribute('open')
        setSettingsOpen(false)
      }
      setPanel(null)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => { document.removeEventListener('mousedown', onPointerDown) }
  }, [])
  /** v0.8.9：Esc 依次收起打开的新建/重复与合并/筛选/搜索/设置/面板。 */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (historyOpen) { setHistoryOpen(false); historyButtonRef.current?.focus(); return }
      if (draft) { setDraft(null); setRelated(null) }
      if (mergeRows) { setMergeRows(null); setMergePick([]); setAutoMerge(null) }
      if (status) setStatus('')
      if (type) setType('')
      if (searchOpen) setSearchOpen(false)
      if (settingsOpen) {
        settingsRef.current?.removeAttribute('open')
        setSettingsOpen(false)
      }
      if (filterOpen) {
        filterRef.current?.removeAttribute('open')
        setFilterOpen(false)
      }
      if (editionOpen) {
        editionRef.current?.removeAttribute('open')
        setEditionOpen(false)
      }
      if (summaryOpen) {
        summaryRef.current?.removeAttribute('open')
        setSummaryOpen(false)
      }
      if (panel) setPanel(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [historyOpen, draft, mergeRows, status, type, searchOpen, settingsOpen, filterOpen, editionOpen, summaryOpen, panel])
  useEffect(() => {
    if (draft && !editorWasOpenRef.current) editorFocusPendingRef.current = true
    if (!draft && editorWasOpenRef.current) {
      returnFocusPendingRef.current = true
      saveFocusRef.current = null
    }
    editorWasOpenRef.current = !!draft
    if (draft && !busy && editorFocusPendingRef.current) {
      titleInputRef.current?.focus()
      editorFocusPendingRef.current = false
    } else if (draft && !busy && saveFocusRef.current) {
      const previous = saveFocusRef.current
      const destination = previous.isConnected && !previous.hasAttribute('disabled') ? previous : titleInputRef.current
      destination?.focus()
      saveFocusRef.current = null
    }
    if (!draft && !busy && returnFocusPendingRef.current) {
      const previous = returnFocusRef.current
      const destination = previous?.isConnected && !previous.hasAttribute('disabled') ? previous : refreshButtonRef.current
      destination?.focus()
      returnFocusRef.current = null
      returnFocusPendingRef.current = false
    }
  }, [draft, busy])
  const rememberFocus = (): void => {
    const active = document.activeElement
    returnFocusRef.current = active instanceof HTMLElement && active.closest('.dam-wh-root') ? active : null
  }
  useEffect(() => {
    let live = true
    const sync = () => { void request('sessions.active', {}).then(value => {
      if (!live) return
      const active = (value as { sessions: Array<{ id: string; cwd: string }> }).sessions
      setSessions(active)
      setSessionId(current => current && !active.some(item => item.id === current) ? '' : current)
      reload()
    }).catch(error => { if (live) setError(message(error)) }) }
    sync()
    const timer = setInterval(sync, 15_000)
    return () => { live = false; clearInterval(timer) }
  }, [request, reload])
  useEffect(() => {
    let live = true
    // v0.6.0：只有过滤条件/页码变化才清空列表。定时刷新与手动刷新保留旧列表，
    // 否则列表被卸载、页面变矮，浏览器会把滚动位置夹回顶部。
    const key = `${scope}|${sessionId}|${query}|${status}|${type}|${offset}`
    const switched = lastListKeyRef.current !== key
    lastListKeyRef.current = key
    setLoading(true)
    if (switched) setData(null)
    if (scope === 'project' && !sessionId) { setLoading(false); return }
    void request('groups.list', { scope, ...(sessionId ? { sessionId } : {}), query, status, type, offset, limit: PAGE_SIZE }).then(value => { if (live) { setData(value as ListResult); setLoading(false) } }).catch(err => { if (live) { setError(message(err)); setLoading(false) } })
    return () => { live = false }
  }, [request, scope, sessionId, query, status, type, offset, refresh])
  useEffect(() => { setArchives(null); setAudit(null); setMergeRows(null); setMergePick([]); setAutoMerge(null); setQuality(null); setDeleting(null) }, [scope, sessionId])
  useEffect(() => {
    let live = true
    void request('backup.status', {}).then(value => { if (live) setBackupInfo(value as { enabled: boolean; intervalHours: number; keep: number; last: { createdAt: string; files: number } | null }) }).catch(() => {})
    return () => { live = false }
  }, [request])
  async function act(action: () => Promise<void>, refreshList = true): Promise<void> {
    setBusy(true); setError('')
    try { await action(); if (refreshList) reload() } catch (err) { setError(message(err)) } finally { setBusy(false) }
  }
  /** v1.0.0-rc.7：导出可跨端导入的 JSON 包（含校验和）。 */
  async function exportPackage(): Promise<void> {
    const pkg = await request('export.package', target, 'POST')
    download(`wh-${scope}-package.json`, JSON.stringify(pkg, null, 2), 'application/json')
    setTransferNote(`已导出 ${scope === 'user' ? '用户层' : '项目层'} JSON 包`)
  }
  /** 读取选择的文件；优先用 File.text()，旧浏览器退回 FileReader。 */
  async function readTransferFile(file: File): Promise<string> {
    if (typeof file.text === 'function') return file.text()
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
      reader.readAsText(file)
    })
  }
  /** v1.0.0-rc.9：先看体积，过大直接提示拆包；预演展示文件大小与记录数。 */
  async function loadTransferFile(file: File): Promise<void> {
    setTransferPlan(null); setTransferNote('')
    if (file.size > MAX_TRANSFER_BYTES) {
      setTransferNote(`文件 ${formatBytes(file.size)} 超过 ${formatBytes(MAX_TRANSFER_BYTES)} 上限，请拆分包后再导入。`)
      return
    }
    let pkg: unknown
    try { pkg = JSON.parse(await readTransferFile(file)) } catch { setTransferNote('无法读取：文件不是有效的 JSON。请选择面板“导出 JSON 包”生成的文件。'); return }
    if (typeof pkg !== 'object' || pkg === null || !Array.isArray((pkg as { records?: unknown }).records)) {
      setTransferNote('这不是 WH 记忆包：文件里没有 records 列表。请选择面板“导出 JSON 包”生成的文件。')
      return
    }
    try {
      const plan = await request('import.plan', { ...target, package: pkg }, 'POST') as ImportPlanView
      const records = (pkg as { records: unknown[] }).records.length
      setTransferPlan({ pkg, plan, bytes: file.size, records })
      setTransferChoice('skip')
    } catch (err) { setTransferNote(message(err)) }
  }
  async function applyTransfer(): Promise<void> {
    if (!transferPlan) return
    await act(async () => {
      const result = await request('import.apply', { ...target, package: transferPlan.pkg, approvedChecksum: transferPlan.plan.checksum, onConflict: transferChoice }, 'POST') as { created: string[]; updated: string[]; skipped: string[]; conflicts: string[]; forked: string[] }
      setTransferNote(`导入完成：新增 ${result.created.length}、更新 ${result.updated.length}、跳过 ${result.skipped.length}、保留双方 ${result.forked.length}`)
      setTransferPlan(null)
    })
  }
  const edit = (row: Row): void => { rememberFocus(); setRelated(null); void act(async () => {
    const record = await request('memory.read', { ...target, name: row.name }) as Row
    setDraft({ row: record, scope, sessionId, expectedRevision: record.revision, body: record.body ?? '' })
    try {
      const view = await request('relatedness.forRecord', { ...target, name: row.name, limit: 5 }, 'POST') as RelatedView
      setRelated({ forName: row.name, view })
    } catch {
      // 相关性只是辅助信息，算不出来不影响编辑。
    }
  }, false) }
  const save = (): void => { if (!draft) return; const current = draft; saveFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; void act(async () => {
    await request('memory.write', { scope: current.scope, ...(current.sessionId ? { sessionId: current.sessionId } : {}), name: current.row.name, title: current.row.title ?? '', description: current.row.description, type: current.row.type, body: current.body, expectedRevision: current.expectedRevision }, 'POST')
    setDraft(null)
  }) }
  const changeDraft = (patch: Partial<Row>): void => setDraft(previous => previous ? { ...previous, row: { ...previous.row, ...patch } } : null)
  // v0.12.0：档位开关；旧 mock 或旧宿主没有 features 时按全功能渲染。
  const edition: Edition = data?.edition ?? 'full'
  const features = data?.features ?? FULL_FEATURES
  // v0.12.1：拖动滑条即切换档位，服务器写入插件 settings.json 并立即生效。
  async function changeEdition(next: Edition): Promise<void> {
    if (next === edition || busy) return
    setBusy(true)
    setError('')
    try {
      await request('edition.set', { edition: next }, 'POST')
      editionRef.current?.removeAttribute('open')
      setEditionOpen(false)
      reload()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }
  // v0.12.3：打开“总结”时向服务端要最近有未固化内容的会话（最多 3 个）。
  async function loadSummarySessions(): Promise<void> {
    setSummaryNote('')
    try {
      const result = await request('consolidation.sessions', { limit: 3 }, 'GET') as { sessions: SummarySession[]; diagnostics?: SummaryDiagnostics }
      setSummarySessions(result.sessions)
      setSummaryDiag(result.diagnostics ?? null)
    } catch (err) {
      setSummarySessions([])
      setSummaryNote(message(err))
    }
  }
  async function runSummary(id: string): Promise<void> {
    setSummaryRunning(id)
    setSummaryNote('正在总结…')
    try {
      const result = await request('consolidation.run', { sessionId: id }, 'POST') as { ok: boolean; reason?: string }
      const note = result.ok ? '已写入，可在列表里查看。' : (SUMMARY_REASONS[result.reason ?? ''] ?? '没有可写入的内容。')
      await loadSummarySessions() // 会清空提示，所以结束后再写
      setSummaryNote(note)
      reload()
    } catch (err) {
      setSummaryNote(message(err))
    } finally {
      setSummaryRunning(null)
    }
  }
  const editor = draft ? (
    <section aria-label="记忆编辑器" className="dam-wh-group dam-wh-editor">
    <h2>编辑</h2>
    <label className="dam-wh-editor-field">名称 <input className="dam-wh-input" aria-label="记忆名称" disabled={draft.expectedRevision !== null || busy} value={draft.row.name} maxLength={64} onChange={e => changeDraft({ name: e.target.value })} /></label>
    <label className="dam-wh-editor-field">标题 <input className="dam-wh-input" ref={titleInputRef} aria-label="记忆标题" disabled={busy} value={draft.row.title ?? ''} maxLength={160} onChange={e => changeDraft({ title: e.target.value })} /></label>
    <label className="dam-wh-editor-field">类型 <select className="dam-wh-input" aria-label="记忆类型" disabled={busy} value={draft.row.type} onChange={e => changeDraft({ type: e.target.value })}>{MEMORY_TYPE_OPTIONS.map(t => <option key={t} value={t}>{typeLabels[t] ?? t}</option>)}</select></label>
    <label className="dam-wh-editor-field">摘要 <textarea className="dam-wh-textarea dam-wh-editor-summary" aria-label="记忆摘要" disabled={busy} rows={1} value={draft.row.description} maxLength={500} onChange={e => changeDraft({ description: e.target.value })} onFocus={e => e.currentTarget.classList.add('dam-wh-editor--grow')} onBlur={e => e.currentTarget.classList.remove('dam-wh-editor--grow')} /></label>
    <label className="dam-wh-editor-field">正文 <textarea className="dam-wh-textarea dam-wh-editor-body" aria-label="记忆正文" disabled={busy} rows={1} value={draft.body} maxLength={8000} onChange={e => setDraft({ ...draft, body: e.target.value })} onFocus={e => e.currentTarget.classList.add('dam-wh-editor--grow')} onBlur={e => e.currentTarget.classList.remove('dam-wh-editor--grow')} /></label>
    {related && related.forName === draft.row.name && <details open aria-label="相关记忆"><summary>相关记忆（只读）</summary>
    <p className="dam-wh-note">按共享词、显式引用、同项目与时间邻近打分；只作参考，不会自动合并或改写。</p>
    {related.view.items.length === 0
    ? <p role="status">没有达到阈值（{related.view.thresholds.weak} 分）的相关记录。</p>
    : <ul>{related.view.items.map(item => <li key={item.scope + ':' + item.name}><SimilarityBar value={item.score / 100} label="相关度" /><span>{item.strength === 'strong' ? '强相关' : '弱相关'} · {item.name}（{item.scope === 'project' ? '项目' : '用户'}）</span></li>)}</ul>}
    </details>}
    <p className="dam-wh-editor-review">保存后立即生效，并会在下一次会话自动使用。</p>
    <div className="dam-wh-toolbar"><button className="dam-wh-btn dam-wh-btn-primary" disabled={busy} onClick={save}>保存</button><button disabled={busy} onClick={() => setDraft(null)}>取消</button></div>
    </section>
  ) : null

  return <div className="dam-wh-root"
    onDragOver={event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); if (!dragging) setDragging(true) } }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
    onDrop={event => {
      if (!event.dataTransfer?.files.length) return
      event.preventDefault(); setDragging(false)
      const file = event.dataTransfer.files[0]
      if (file) void loadTransferFile(file)
    }}>
    {dragging && <div className="dam-wh-dropzone" aria-hidden="true">松开以预演导入 JSON 包</div>}
    <div className="dam-wh-shell">
    <header className="dam-wh-header"><h1 className="dam-wh-title">持久记忆 WH</h1>
    <div className="dam-wh-header-actions">
      <label className={searchOpen ? 'dam-wh-search dam-wh-search--open' : 'dam-wh-search'}>
        <input ref={searchInputRef} aria-label="搜索记忆" placeholder="搜索记忆" tabIndex={searchOpen ? 0 : -1} value={query} maxLength={256} onChange={event => { setQuery(event.target.value); setOffset(0) }} onKeyDown={event => { if (event.key === 'Escape') setSearchOpen(false) }} />
      </label>
      <button className="dam-wh-icon-btn" aria-label="搜索" title="搜索" onClick={() => { setSearchOpen(open => { const next = !open; if (next) setTimeout(() => searchInputRef.current?.focus(), 0); return next }) }}><SearchIcon /></button>
      <button ref={refreshButtonRef} className="dam-wh-icon-btn" aria-label="刷新" title="刷新" onClick={reload} disabled={busy}><RefreshIcon /></button>
      <details className="dam-wh-settings" ref={settingsRef} onToggle={event => setSettingsOpen((event.target as HTMLDetailsElement).open)}>
        <summary className="dam-wh-icon-btn" aria-label="设置" title="设置"><GearIcon /></summary>
        <div className="dam-wh-settings-menu" role="group" aria-label="设置菜单">
          <button className="dam-wh-btn" disabled={busy} onClick={() => openPanel('storage')}>存储</button>
          <button className="dam-wh-btn" disabled={busy} onClick={() => openPanel('archive')}>查看归档</button>
          <button className="dam-wh-btn" disabled={busy} onClick={() => openPanel('audit')}>查看组装审计</button>
          <button className="dam-wh-btn" disabled={busy} onClick={() => openPanel('metrics')}>运行指标</button>
          <button className="dam-wh-btn" disabled={busy} onClick={() => openPanel('quality')}>质量体检</button>
          {features.autoBackup && <button className="dam-wh-btn" disabled={busy} onClick={() => { void act(async () => { const result = await request('backup.now', {}, 'POST') as { files: number }; setBackupNote(`已备份 ${result.files} 个文件`) }, true) }}>立即备份</button>}
          {features.importExport && <button className="dam-wh-btn" disabled={busy} onClick={() => { void act(async () => {
            const result = await request('export.markdown', target) as { files: Array<{ name: string; content: string; sha256: string; bytes: number }> }
            download(`wh-${scope}-memories.md`, result.files.map(f => `# ${f.name}\n\n${f.content}`).join('\n\n---\n\n'), 'text/markdown;charset=utf-8')
          }) }}>导出此范围的 Markdown</button>}
          {features.importExport && <button className="dam-wh-btn" disabled={busy} onClick={() => { void act(async () => {
            const result = await request('export.markdown', target)
            download(`wh-${scope}-manifest.json`, JSON.stringify(result, null, 2), 'application/json')
          }) }}>导出逐文件清单</button>}
          {features.importExport && <button className="dam-wh-btn" disabled={busy} onClick={() => { void act(async () => { await exportPackage() }) }}>导出 JSON 包</button>}
          {features.importExport && <button className="dam-wh-btn" disabled={busy} onClick={() => transferInputRef.current?.click()}>导入 JSON 包</button>}
          <input ref={transferInputRef} className="dam-wh-hidden-file" type="file" accept=".json,application/json" aria-label="导入 JSON 包文件" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void loadTransferFile(file) }} />
          {features.migration && <button className="dam-wh-btn" disabled={busy} onClick={() => openPanel('migration')}>迁移检查</button>}
          {backupNote && <span className="dam-wh-note">{backupNote}</span>}
          {backupInfo && <span className="dam-wh-note">自动备份：{backupInfo.enabled ? `每 ${backupInfo.intervalHours} 小时，保留 ${backupInfo.keep} 份` : '未开启'}{backupInfo.last ? `；最近 ${new Date(backupInfo.last.createdAt).toLocaleString()}（${backupInfo.last.files} 个文件）` : '；尚无备份'}</span>}
        </div>
      </details>
    </div></header>
    <div className="dam-wh-toolbar">
      <label>范围 <select aria-label="记忆范围" className="dam-wh-select" value={scope} onChange={event => { setScope(event.target.value as Scope); setOffset(0); setError('') }}><option value="user">用户记忆</option><option value="project">项目记忆</option></select></label>
      <label>会话 <select aria-label="项目会话" className="dam-wh-select" value={sessionId} onChange={event => { setSessionId(event.target.value); setOffset(0); setError('') }}><option value="">请选择会话</option>{sessions.map(s => <option key={s.id} value={s.id}>{s.cwd}</option>)}</select></label>
    </div>
    {scope === 'project' && !sessionId && <p role="status">请选择项目会话，服务器会核对它的范围。不会自动使用最近活动的项目。</p>}
    {transferPlan && <section className="dam-wh-transfer" aria-label="导入预览">
      <h2>导入预览</h2>
      <p className="dam-wh-note">文件 {formatBytes(transferPlan.bytes)} · {transferPlan.records} 条记录 · 校验和 {transferPlan.plan.checksum.slice(0, 8)} · 新增 {transferPlan.plan.creates.length} · 更新 {transferPlan.plan.updates.length} · 相同 {transferPlan.plan.skipped.length} · 冲突 {transferPlan.plan.conflicts.length}</p>
      {transferPlan.plan.conflicts.length > 0 && <div className="dam-wh-transfer-conflicts">
        <p>这些本地记录内容不同：{transferPlan.plan.conflicts.join('、')}</p>
        <label><input type="radio" name="dam-wh-transfer-choice" checked={transferChoice === 'skip'} onChange={() => setTransferChoice('skip')} /> 保留本地版本，跳过远端</label>
        <label><input type="radio" name="dam-wh-transfer-choice" checked={transferChoice === 'fork'} onChange={() => setTransferChoice('fork')} /> 两边都留（远端另存为独立版本）</label>
      </div>}
      <div className="dam-wh-toolbar">
        <button className="dam-wh-btn dam-wh-btn-primary" disabled={busy} onClick={() => void applyTransfer()}>应用导入</button>
        <button className="dam-wh-btn" disabled={busy} onClick={() => setTransferPlan(null)}>取消</button>
      </div>
    </section>}
    {transferNote && <p role="status" className="dam-wh-note">{transferNote}</p>}
    {mergeNote && <p role="status" className="dam-wh-note">{mergeNote}</p>}
    {error && <div role="alert" className="dam-wh-evidence">{error} {draft && '未保存的草稿仍保留，请不要关闭编辑器。'}</div>}
    {loading && !data && <p role="status">正在读取…</p>}
    {graphOpen ? <MemoryGraphView request={request} target={target} onPick={name => { setGraphOpen(false); setQuery(name); setOffset(0) }} onClose={() => setGraphOpen(false)} />
      : arcOpen ? <MemoryArcView request={request} target={target} onPick={entry => {
        setArcOpen(false)
        setScope(entry.scope === 'project' ? 'project' : 'user')
        const match = entry.scope === 'project' ? sessions.find(session => entry.originPath !== undefined && session.cwd === entry.originPath) : undefined
        if (match) setSessionId(match.id)
        setStatus('')
        setType('')
        setQuery(entry.name)
        setOffset(0)
      }} onClose={() => setArcOpen(false)} />
      : data && <>
      {data.audit.degraded && <p role="alert">审计已降级，记录可能不完整。请检查存储与锁状态。</p>}
      {data.issues.length > 0 && <p role="alert">有 {data.issues.length} 项文件或存储异常，未将异常内容当作有效记忆。</p>}
      <div className="dam-wh-toolbar">
        <button className="dam-wh-btn" disabled={busy || (draft !== null && draft.expectedRevision !== null) || (data.storage.readOnly && !(draft !== null && draft.expectedRevision === null))} onClick={() => {
          if (draft && draft.expectedRevision === null) { setDraft(null); setRelated(null); return }
          rememberFocus(); setDraft({ row: { name: '', description: '', type: 'reference', status: 'candidate', revision: '' }, scope, sessionId, body: '', expectedRevision: null })
        }}>{draft && draft.expectedRevision === null ? '新增：取消' : '新建'}</button>
        {features.merge && <button className="dam-wh-btn" disabled={busy} onClick={() => {
          if (mergeRows) { setMergeRows(null); setMergePick([]); setAutoMerge(null); setMergeNote(''); return }
          void act(async () => {
          setMergeNote('')
          const [duplicateView, mergeView, autoView] = await Promise.all([
            request('memory.duplicates', { ...target, threshold: 0.8 }, 'POST') as Promise<DuplicateView>,
            request('memory.mergeSuggest', { ...target, minShared: 2 }, 'POST') as Promise<MergeView>,
            request('merge.autoScan', { ...target }, 'POST') as Promise<AutoMergeView>,
          ])
          setAutoMerge({ auto: autoView?.auto ?? [], ask: autoView?.ask ?? [], entries: autoView?.entries ?? [] })
          const rows: MergeRow[] = [
            ...mergeView.clusters.map((cluster, i) => ({ key: `cluster:${i}`, title: `主题簇：${cluster.sharedTokens.join('、')}`, members: cluster.members.map(member => ({ name: member.name, revision: member.revision, status: member.status, type: member.type })), similarity: cluster.score, name: cluster.suggestedName, type: cluster.suggestedType })),
            ...duplicateView.groups.map((group, i) => ({ key: `dup:${i}`, title: `近重复：${group.members[0]?.name ?? ''}`, members: group.members.map(member => ({ name: member.name, revision: member.revision, status: member.status, type: member.type })), similarity: group.similarity, name: sanitizeTargetName(`${group.members[0]?.name ?? 'memory'}-merged`), type: group.members[0]?.type === 'task' ? 'reference' : (group.members[0]?.type ?? 'reference') })),
          ]
          setMergeRows(rows)
          setMergePick(rows.filter(row => row.similarity >= 0.8).map(row => row.key))
        }, false) }}>{mergeRows ? '重复与合并：收起' : '重复与合并'}</button>}
        {features.graph && <button className="dam-wh-btn" disabled={busy} onClick={() => { setGraphOpen(true); setArcOpen(false); setDraft(null); setMergeRows(null); setMergePick([]) }}>关系图</button>}
        {features.graph && <button className="dam-wh-btn" disabled={busy} onClick={() => { setArcOpen(true); setGraphOpen(false); setDraft(null); setMergeRows(null); setMergePick([]) }}>人物弧光</button>}
        <details className="dam-wh-filter" ref={filterRef} onToggle={event => setFilterOpen((event.target as HTMLDetailsElement).open)}><summary className="dam-wh-btn">筛选{type ? ' · 已启用' : ''}</summary>
          <div className="dam-wh-filter-menu">
            <label><span className="dam-wh-visually-hidden">类型</span><select aria-label="筛选类型" value={type} onChange={event => { setType(event.target.value); setOffset(0) }}><option value="">全部类型</option>{MEMORY_TYPE_OPTIONS.map(t => <option key={t} value={t}>{typeLabels[t] ?? t}</option>)}</select></label>
            {type && <button className="dam-wh-btn" disabled={busy} onClick={() => { setType(''); setOffset(0) }}>清除筛选</button>}
          </div>
        </details>
        <details className="dam-wh-filter" ref={editionRef} onToggle={event => setEditionOpen((event.target as HTMLDetailsElement).open)}>
          <summary className="dam-wh-btn">档位</summary>
          <div className="dam-wh-filter-menu dam-wh-edition-menu">
            <p>功能档：{editionProfile(edition).label}</p>
            <input
              className="dam-wh-range"
              type="range"
              min={1}
              max={3}
              step={1}
              aria-label="功能档位"
              disabled={busy}
              value={EDITION_ORDER.indexOf(edition) + 1}
              onChange={event => { void changeEdition(EDITION_ORDER[Number(event.target.value) - 1] ?? 'full') }}
            />
            <div className="dam-wh-range-labels"><span>低</span><span>中</span><span>高</span></div>
            <p className="dam-wh-note">切换立即对面板与 API 生效；自动总结/自动备份的下一次运行按新档执行。记忆数据不变。</p>
          </div>
        </details>
        {features.autoSummarize && <details className="dam-wh-filter" ref={summaryRef} onToggle={event => {
          const open = (event.target as HTMLDetailsElement).open
          setSummaryOpen(open)
          if (open) void loadSummarySessions()
        }}>
          <summary className="dam-wh-btn">总结{summaryRunning ? ' · 进行中' : ''}</summary>
          <div className="dam-wh-filter-menu dam-wh-summary-menu" role="group" aria-label="选择要总结的会话">
            <div className="dam-wh-summary-head">
              <p className="dam-wh-note">选一个最近活跃的会话，立即把尚未摘要的对话整理成记忆。</p>
              <button className="dam-wh-icon-btn" aria-label="刷新总结会话" title="刷新" disabled={summaryRunning !== null} onClick={() => { void loadSummarySessions() }}><RefreshIcon /></button>
            </div>
            {summarySessions === null && <p role="status">正在读取会话…</p>}
            {summarySessions?.length === 0 && <p role="status">没有可总结的活跃会话。只有在宿主内存里、且包含对话内容的会话才会列出。{summaryDiag && `（内存中 ${summaryDiag.captures} 个会话、${summaryDiag.routes} 个有模型路由、${summaryDiag.agents} 个活跃代理）`}</p>}
            {summarySessions?.map(row => <button key={row.id} className="dam-wh-btn dam-wh-summary-row" title={row.cwd} disabled={busy || summaryRunning !== null} onClick={() => { void runSummary(row.id) }}>
              <span className="dam-wh-summary-cwd">{sessionLabel(row)}</span>
              <span className="dam-wh-summary-meta">{summaryRunning === row.id ? '总结中…' : `${relativeActivity(row.lastActivityAt)} · ${row.lines} 行未固化`}</span>
            </button>)}
            {summaryNote && <p className="dam-wh-note" role="status">{summaryNote}</p>}
          </div>
        </details>}
      </div>
      {mergeRows && <section aria-label="重复与合并" className="dam-wh-merge">
        <h2>重复与合并（{mergeRows.length} 组）</h2>
        {mergeRows.length === 0 && <p>未发现可合并的组。</p>}
        {mergeRows.map(row => <article key={row.key}>
          <label><input type="checkbox" aria-label={`选择合并 ${row.title}`} checked={mergePick.includes(row.key)} disabled={busy} onChange={event => setMergePick(previous => event.target.checked ? [...previous, row.key] : previous.filter(key => key !== row.key))} /> {row.title}</label>
          <SimilarityBar value={row.similarity} />
          <ul>{row.members.map(member => <li key={member.name}>{member.name} · {statusLabels[member.status] ?? member.status}</li>)}</ul>
          <p className="dam-wh-note">合并后名称：{row.name}（{typeLabels[row.type] ?? row.type}）</p>
        </article>)}
        {mergeRows.length > 0 && <button className="dam-wh-btn dam-wh-btn-primary" disabled={busy || mergePick.length === 0} onClick={() => {
          void act(async () => {
            const rows = mergeRows.filter(row => mergePick.includes(row.key))
            let merged = 0
            const skipped: string[] = []
            const failures: string[] = []
            for (const row of rows) {
              try {
                const result = await request('memory.merge', { ...target, name: row.name, type: row.type, members: row.members.map(member => ({ name: member.name, revision: member.revision })), confirm: true }, 'POST') as { merged?: string[]; skipped?: string[] }
                merged += result.merged?.length ?? 0
                if (result.skipped?.length) skipped.push(...result.skipped)
              } catch (error) {
                failures.push(`${row.name}：${message(error)}`)
              }
            }
            setMergeRows(null); setMergePick([])
            setMergeNote(failures.length > 0
              ? `已合并 ${merged} 条来源；${failures.length} 组未完成：${failures.join('；')}`
              : skipped.length > 0
                ? `已合并 ${merged} 条来源；${skipped.length} 条已失效或停用的来源被跳过。`
                : `已合并 ${merged} 条来源。`)
          })
        }}>确认合并（{mergePick.length} 组）</button>}
      </section>}
      {mergeRows && autoMerge && <section aria-label="自动合并" className="dam-wh-merge">
        <h2>自动合并（同主题且相关 ≥60%）</h2>
        <p>同主题且相关性 ≥60% 会自动合并为一条记忆，来源标记为被取代；同主题但相关 &lt;60%，或跨主题但相关 ≥60%，只进入下方待确认，撤销即可恢复。</p>
        {autoMerge.auto.length === 0 && <p>没有达到自动合并条件的记录。</p>}
        {autoMerge.auto.map(plan => <article key={plan.key}>
          <strong>主题：{plan.topic} · {Math.round(plan.score)}%</strong>
          <ul>{plan.members.map(member => <li key={member.name} title={member.name}>{member.title ?? member.name}</li>)}</ul>
          <p className="dam-wh-note">{plan.reasons.join('；')}</p>
          <button className="dam-wh-btn" disabled={busy} onClick={() => { void act(async () => {
            await request('merge.autoApply', { ...target, key: plan.key }, 'POST')
            const next = await request('merge.autoScan', { ...target }, 'POST') as AutoMergeView
            setAutoMerge(next)
          }) }}>立即合并</button>
        </article>)}
        <h2>待确认（只满足一项：同主题或相关 ≥60%）</h2>
        {autoMerge.ask.length === 0 && <p>没有需要确认的合并。</p>}
        {autoMerge.ask.map(plan => <article key={plan.key}>
          <strong>{Math.round(plan.score)}% · 主题：{plan.topic}</strong>
          <ul>{plan.members.map(member => <li key={member.name} title={member.name}>{member.title ?? member.name}</li>)}</ul>
          <p className="dam-wh-note">{plan.reasons.join('；')}</p>
          <button className="dam-wh-btn" disabled={busy} onClick={() => { void act(async () => {
            await request('merge.autoApply', { ...target, key: plan.key }, 'POST')
            const next = await request('merge.autoScan', { ...target }, 'POST') as AutoMergeView
            setAutoMerge(next)
          }) }}>合并这一组</button>
        </article>)}
        <div className="dam-wh-history-heading"><h2>最近自动合并（可撤销）</h2><button ref={historyButtonRef} className="dam-wh-btn" aria-expanded={historyOpen} onClick={() => setHistoryOpen(open => !open)}>查看全部合并</button></div>
        {historyOpen && <div ref={historyRef} role="dialog" aria-label="全部合并记忆" className="dam-wh-history-popup">
          <div className="dam-wh-drawer-head"><h2>全部合并记忆</h2><button className="dam-wh-icon-btn" aria-label="关闭合并记录" onClick={() => { setHistoryOpen(false); historyButtonRef.current?.focus() }}>×</button></div>
          <p className="dam-wh-note">当前范围内的自动、手动及历史合并。旧记录可能缺少方式或撤销信息。</p>
          {historyError && <p role="alert">{historyError}</p>}
          {!history && !historyError && <p role="status">正在加载…</p>}
          {history?.length === 0 && <p>还没有合并记录。</p>}
          {history?.map(entry => <article key={entry.id}>
            <strong>{entry.title}</strong>
            <p className="dam-wh-note">{entry.at ? new Date(entry.at).toLocaleString() : '时间未知'} · {entry.kind === 'automatic' ? '自动合并' : '手动 / 历史合并'} · 来源：{entry.sources.join('、')}</p>
            {entry.available ? <details><summary>查看合并内容</summary><pre className="dam-wh-history-body">{entry.body}</pre></details> : <p>合并目标已归档或不存在。</p>}
            {entry.canUndo && <button className="dam-wh-btn" disabled={busy} onClick={() => { void act(async () => {
              await request('merge.undo', { id: entry.id }, 'POST')
              setAutoMerge(await request('merge.autoScan', { ...target }, 'POST') as AutoMergeView)
            }) }}>撤销这次合并</button>}
          </article>)}
        </div>}
        {autoMerge.entries.length === 0 && <p>还没有自动合并记录。</p>}
        {[...autoMerge.entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id)).slice(0, 3).map(entry => <article key={entry.id}>
          <strong>{entry.target}</strong>
          <p className="dam-wh-note">{new Date(entry.at).toLocaleString()} · 主题：{entry.topic} · {Math.round(entry.score)}% · 来源：{entry.sources.join('、')}</p>
          <button className="dam-wh-btn" disabled={busy} onClick={() => { void act(async () => {
            await request('merge.undo', { id: entry.id }, 'POST')
            const next = await request('merge.autoScan', { ...target }, 'POST') as AutoMergeView
            setAutoMerge(next)
          }) }}>撤销这次合并</button>
        </article>)}
      </section>}
      {editor && draft && draft.expectedRevision === null && editor}
      {!data.records.length && <p role="status">此范围或筛选条件下没有记忆。</p>}
      <div className="dam-wh-groups">{data.records.map(row => <article className="dam-wh-group" key={row.name}>
        <div style={{ padding: 14 }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 15 }}>{row.title || row.name}</h2><p className="dam-wh-desc">{row.description}</p>
          <p><span className="dam-wh-badge dam-wh-badge--cand">{statusLabels[row.status] ?? row.status}</span> {row.topic && <span className="dam-wh-badge">主题：{row.topic}</span>} {row.pinned && '置顶'} {row.supersededBy && `被 ${row.supersededBy} 取代`} {row.supersedes && `取代了 ${row.supersedes}`}</p>
          {qualityIssues.get(row.name) && <ul className="dam-wh-note" aria-label={`${row.name} 的质量提示`}>{qualityIssues.get(row.name)!.map(item => <li key={item.code}>{item.severity === 'warn' ? '警告' : '提示'}：{item.message} {item.hint}</li>)}</ul>}
          <div className="dam-wh-toolbar">
            <button className="dam-wh-btn" disabled={busy || (!!draft && draft.row.name !== row.name)} onClick={() => { if (draft?.row.name === row.name) setDraft(null); else edit(row) }}>{draft?.row.name === row.name ? '查看 / 编辑：取消' : '查看 / 编辑'}</button>
            <button className="dam-wh-btn" disabled={busy || data.storage.readOnly} onClick={() => { void act(async () => { await request('memory.patch', { ...target, name: row.name, expectedRevision: row.revision, pinned: !row.pinned }, 'POST') }) }}>{row.pinned ? '取消置顶' : '置顶'}</button>
            {deleting?.name === row.name ? <>
              <span className="dam-wh-note">确认归档？内容可恢复。</span>
              <button className="dam-wh-btn" disabled={busy} onClick={() => { const pending = deleting; void act(async () => { await request('memory.delete', { ...target, name: pending.name, expectedRevision: pending.revision }, 'POST'); setDeleting(null) }) }}>确认归档</button>
              <button className="dam-wh-btn" disabled={busy} onClick={() => setDeleting(null)}>取消</button>
            </> : <button className="dam-wh-btn" disabled={busy || data.storage.readOnly} onClick={() => setDeleting(row)}>移至归档</button>}
          </div>
          {editor && draft && draft.expectedRevision !== null && draft.row.name === row.name && editor}
        </div></article>)}</div>
      {editor && draft && draft.expectedRevision !== null && !data.records.some(record => record.name === draft!.row.name) && <>{editor}</>}
      <div className="dam-wh-toolbar"><button disabled={busy || offset === 0} onClick={() => setOffset(n => Math.max(0, n - PAGE_SIZE))}>上一页</button><span>{data.total} 条 · 第 {Math.floor(offset / PAGE_SIZE) + 1} 页 · 每页 {PAGE_SIZE} 条</span><button disabled={busy || offset + PAGE_SIZE >= data.total} onClick={() => setOffset(n => n + PAGE_SIZE)}>下一页</button></div>
    </>}
    {panel && <aside ref={drawerRef} className="dam-wh-drawer" role="dialog" aria-label={panelLabels[panel]} style={{ right: drawerRight }}>
      <div className="dam-wh-drawer-head"><h2>{panelLabels[panel]}</h2><button className="dam-wh-icon-btn" aria-label="关闭面板" title="关闭" onClick={() => setPanel(null)}>×</button></div>
      <div className="dam-wh-drawer-body">
        {panel === 'storage' && data && <>
          <p>目录：<code>{data.storage.root}</code></p>
          <p>来源：{data.storage.rootSource ?? '插件配置'}；格式：{data.storage.formatVersion ?? '尚未初始化'}；{data.storage.readOnly ? `只读：${data.storage.reason}` : '可写'}</p>
          <p>当前范围最近快照：{data.storage.lastBackup ?? '尚无'}。索引预算：{data.maxBytes} UTF-8 字节。</p>
          <p>审计保留：{data.audit.retentionDays} 天 / {data.audit.maxBytes} 字节；待写：{data.audit.pending}；本进程丢失：{data.audit.dropped}。</p>
          <p>宿主调度：{data.schedule?.available ? '已连接（任务提醒走原生“自动化任务”）' : '不可用：memory_remind 会明确报错'}。</p>
          <p>功能档：{editionProfile(edition).label}（三档共用同一份存储，只影响注入预算与可选功能）。</p>
          <p>自动总结：{data.consolidation?.enabled ? `已开启，${idleCadenceLabel(data.consolidation.idleMinutes)}${data.consolidation.runs > 0 ? `；最近一次 ${data.consolidation.lastAt ? new Date(data.consolidation.lastAt).toLocaleString() : '—'}：写入 ${data.consolidation.lastCreated + data.consolidation.lastUpdated} 条候选，跳过 ${data.consolidation.lastSkipped} 条（累计写入 ${data.consolidation.totals?.written ?? 0}）` : ''}。` : '未开启（config `autoSummarize`）。'}</p>
          {backupInfo && <p>自动备份：{backupInfo.enabled ? `每 ${backupInfo.intervalHours} 小时，保留 ${backupInfo.keep} 份` : '未开启'}{backupInfo.last ? `；最近 ${new Date(backupInfo.last.createdAt).toLocaleString()}（${backupInfo.last.files} 个文件）` : '；尚无备份'}</p>}
          <div className="dam-wh-toolbar"><button className="dam-wh-btn" disabled={busy || !features.autoBackup} onClick={() => { void act(async () => { const result = await request('backup.now', {}, 'POST') as { files: number }; setBackupNote(`已备份 ${result.files} 个文件`) }) }}>立即备份</button>{backupNote && <span className="dam-wh-note">{backupNote}</span>}</div>
        </>}
        {panel === 'archive' && <section aria-label="归档记录"><p>归档仍保留正文；恢复不会覆盖同名新记录。</p>{archives === null && <p role="status">正在读取…</p>}{archives?.length === 0 && <p>暂无归档。</p>}{archives?.map(item => <p key={item.id}>{item.name} · {item.deletedAt} <button disabled={busy} onClick={() => { void act(async () => { await request('archive.restore', { ...target, id: item.id, expectedHash: item.hash }, 'POST'); setArchives(null) }) }}>恢复</button></p>)}</section>}
        {panel === 'audit' && <section aria-label="组装审计">
          <p>选择会话后查看该项目最近 50 次组装尝试；名称列表只显示当前范围。字节数是当次完整片段的总量，不是 token 数。</p>
          {audit === null && <p role="status">正在读取…</p>}
          {audit?.status.degraded && <p role="alert">审计不完整，本进程已丢失 {audit.status.dropped} 条。</p>}
          {audit?.entries.length === 0 && <p>当前没有可显示的记录。</p>}
          {audit?.entries.map((event, i) => <article key={i}><p>{event.timestamp} · {event.bytes} / {event.budget} 字节</p><p>已选：{event.records.map(r => r.name).join('、') || '无'}</p><p>未选：{event.excluded.map(r => `${r.id.slice(r.id.lastIndexOf(':') + 1)}（${exclusionLabels[r.reason] ?? r.reason}）`).join('、') || '无'}{event.detailsTruncated && '；详细名单因长度限制未全部记录'}</p></article>)}
        </section>}
        {panel === 'metrics' && <section aria-label="运行指标">
          {metricsView === null ? <p role="status">正在读取…</p> : <>
            <p>写入 {metricsView.metrics.writes} 次，平均 {metricsView.metrics.avgWriteMs} ms，最长 {metricsView.metrics.maxWriteMs} ms；错误 {metricsView.metrics.writeErrors}（锁超时 {metricsView.metrics.lockTimeouts}、忙 {metricsView.metrics.busyErrors}）；恢复 {metricsView.metrics.recoveries} 次，备份 {metricsView.metrics.backups} 次。</p>
            <p>审计：{metricsView.audit.degraded ? '已降级' : '正常'}（丢弃 {metricsView.audit.dropped}、队列 {metricsView.audit.pending}）；存储：{metricsView.storage.readOnly ? '只读' : '可写'}，格式版本 {metricsView.storage.formatVersion ?? '未知'}。</p>
          </>}
        </section>}
        {panel === 'quality' && <section aria-label="记忆质量体检">
          {quality === null ? <p role="status">正在读取…</p> : <>
            <p>扫描 {quality.scanned} 条，{quality.flagged} 条有提示。只读提示，不会改写任何记忆；优先处理“警告”项。</p>
            <p>阈值：描述 ≤240 字符、正文 ≥40 字符、超过 180 天未更新的记录视为过期。</p>
            {quality.index && <p>索引占用 {quality.index.bytes} / {quality.index.budget} 字节{quality.index.bytes > quality.index.budget ? '（超出预算，注入会被截断）' : ''}{quality.index.excluded.length > 0 ? `，${quality.index.excluded.length} 条被排除` : ''}。保留顺序：pinned → 重要度×时效 → 名称；预算不足时先丢尾部。</p>}
            {quality.index && quality.index.excluded.length > 0 && <details><summary>查看被索引排除的记录</summary><ul>{quality.index.excluded.map(entry => <li key={entry.id}>{entry.id} · {entry.reason}</li>)}</ul><p>被排除的记录仍完整保存在磁盘上，只是不进入索引；归档、修正或提升重要度后可重新纳入。</p></details>}
            {quality.duplicates && <p>近重复 {quality.duplicates.groups} 组（阈值 {Math.round(quality.duplicates.threshold * 100)}%）：用“重复与合并”逐组查看，再归档或改写；流程不会自动合并。</p>}
            {quality.flagged === 0 && <p>未发现需要处理的提示。</p>}
            {quality.records.length > 0 && <p>各条的提示已显示在对应记录下面（“警告”优先处理）。</p>}
          </>}
        </section>}
        {panel === 'migration' && <section aria-label="迁移检查">
          {migration === null ? <p role="status">正在读取…</p> : <p role="status">旧库 {migration.legacyFiles} 条，当前 {migration.targetFiles} 条。{migration.guidance}</p>}
        </section>}
      </div>
    </aside>}
  </div></div>
}
