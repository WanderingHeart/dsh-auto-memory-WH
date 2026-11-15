// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryPage, type MemoryPageProps } from '../src/client/ManagementPage.tsx'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let container: HTMLDivElement, root: Root
const record = { name: 'alpha', title: 'Alpha', description: 'synthetic', body: '<script>unsafe()</script>', type: 'reference', status: 'candidate', revision: 'a'.repeat(64) }
const listing = { records: [record], total: 1, issues: [], maxBytes: 4096, storage: { root: 'synthetic', formatVersion: 1, readOnly: false, lastBackup: null }, audit: { degraded: false, dropped: 0, pending: 0, maxBytes: 1048576, retentionDays: 7 }, consolidation: { enabled: true, idleMinutes: 60, runs: 3, lastAt: 1794000000000, lastOutcome: 'written', lastCreated: 2, lastUpdated: 0, lastSkipped: 1, totals: { written: 7, skipped: 4 } } }
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function setup(failure?: string, mergeSkipped: string[] = []) {
  const request = vi.fn(async (name: string, _data: unknown, _method?: string): Promise<unknown> => {
    if (name === 'sessions.active') return { sessions: [{ id: 's1', cwd: 'synthetic-project' }] }
    if (name === 'groups.list') return listing
    if (name === 'memory.read') return record
    if (name === 'archive.list') return { archives: [{ id: 'archive-1', name: 'old', hash: 'b'.repeat(64), deletedAt: 'synthetic' }] }
    if (name === 'audit.events') return { status: { degraded: false, dropped: 0 }, entries: [{ timestamp: 'synthetic-time', bytes: 478, budget: 4096, records: [{ name: 'alpha' }], excluded: [] }] }
    if (name === 'memory.duplicates') return { scanned: 2, threshold: 0.8, groups: [{ similarity: 0.9, members: [record, { ...record, name: 'beta', title: 'Beta' }] }] }
    if (name === 'merge.autoScan') return {
      auto: [],
      ask: [{
        key: 'ask-1', topic: '考研', score: 16, reasons: ['同主题 +5'],
        members: [
          { name: 'reference-kaoyan-plan', title: '考研一年阶段计划', description: '', body: '', type: 'reference' },
          { name: 'topic-merged-mw96pe31', title: '合并：考研目标：华中科技大学', description: '', body: '', type: 'reference' },
        ],
      }],
      entries: [],
    }
    if (name === 'memory.mergeSuggest') return { scanned: 2, clusters: [{ sharedTokens: ['typescript'], suggestedName: 'typescript-merged', suggestedType: 'reference', score: 1, members: [{ name: 'alpha', description: 'synthetic', type: 'reference', status: 'candidate', revision: 'a'.repeat(64), updatedMs: 1 }, { name: 'beta', description: 'synthetic two', type: 'reference', status: 'candidate', revision: 'b'.repeat(64), updatedMs: 2 }] }] }
    if (name === 'memory.metrics') return { metrics: { writes: 3, writeErrors: 1, lockTimeouts: 1, busyErrors: 0, avgWriteMs: 20, maxWriteMs: 60, recoveries: 0, backups: 1, startedAt: 1 }, audit: { degraded: false, dropped: 0, pending: 0 }, storage: { root: '/synthetic', readOnly: false, formatVersion: 1 } }
    if (name === 'quality.report') return { scanned: 3, flagged: 2, byCode: { 'name-generic': 2, 'body-short': 1 }, thresholds: { descriptionMax: 240, bodyMin: 40, staleDays: 180, sectionsMax: 4 }, index: { bytes: 5000, budget: 4096, excluded: [{ id: 'memo', reason: 'budget' }] }, duplicates: { groups: 1, threshold: 0.8 }, records: [{ name: 'alpha', scope: 'user', type: 'reference', status: 'verified', issues: [{ code: 'name-generic', severity: 'warn', message: '名称过于通用，难以检索。', hint: '用主题化 kebab-case 名称。' }, { code: 'body-short', severity: 'info', message: '正文 20 字符，可能缺少原因或边界。', hint: '正文写结论、原因与边界。' }] }] }
    if (name === 'relatedness.forRecord') return { target: { name: 'alpha', scope: 'user' }, items: [{ name: 'beta', scope: 'user', score: 72, strength: 'strong', reasons: ['记录之间显式引用 +40', '标题/名称共享关键词 +17'] }], thresholds: { weak: 30, strong: 60 } }
    if (name === 'relatedness.graph') return { nodes: [{ name: 'alpha', title: 'Alpha', type: 'reference', scope: 'user', degree: 1 }, { name: 'beta', title: 'Beta', type: 'reference', scope: 'user', degree: 1 }], edges: [{ from: 'alpha', to: 'beta', score: 80 }], thresholds: { weak: 30, strong: 60 } }
    if (name === 'arc.view') return {
      chapters: [
        { topic: '考研', title: '考研', note: '升学目标', records: [
          { key: 'user:kaoyan-start', name: 'kaoyan-start', title: '考研启动', description: '决定考华科', type: 'user', scope: 'user', origin: '个人', status: 'verified', at: 1793000000000, supersedes: 'kaoyan-old' },
          { key: 'user:kaoyan-plan', name: 'kaoyan-plan', title: '复习计划', description: '基础阶段', type: 'user', scope: 'user', origin: '个人', status: 'candidate', at: 1794000000000 },
        ] },
        { topic: '未归类', title: '未归类', note: '尚未归类', records: [
          { key: 'project:loose', name: 'loose-note', description: 'synthetic loose', type: 'reference', scope: 'project', origin: 'demo', originPath: 'C:\\work\\demo', status: 'legacy', at: 0 },
        ] },
      ],
      total: 3, sources: [{ scope: 'user', slug: '_user', label: '个人', count: 2 }], skipped: 0, truncated: false, generatedMs: 1,
    }
    if (name === 'backup.status') return { enabled: true, intervalHours: 24, keep: 5, last: { createdAt: '2026-11-06T00:00:00.000Z', files: 9 } }
    if (name === 'export.markdown') return { format: 'wh-markdown-export', version: 1, scope: 'user', files: [{name:'alpha.md',content:'synthetic',bytes:9,sha256:'synthetic-hash'}] }
    if (name === 'export.package') return { format: 'wh-memory-export', version: 1, scope: 'user', checksum: 'abc123def456', records: [] }
    if (name === 'import.plan') return { checksum: 'abc123def456', creates: ['new-one'], updates: [], skipped: [], conflicts: ['alpha'] }
    if (name === 'import.apply') return { created: ['new-one'], updated: [], skipped: [], conflicts: [], forked: ['alpha-shared-123456'] }
    if (name === 'memory.merge') return { ok: true, target: 'merged', merged: ['alpha'], skipped: mergeSkipped }
    if (name === 'memory.write' && failure) throw new Error(failure)
    return { ok: true }
  })
  const props = { request, projectSessions: () => [{ id: 's1', cwd: 'synthetic-project' }] } as unknown as MemoryPageProps
  await act(async () => root.render(<MemoryPage {...props} />))
  return request
}
function button(text: string): HTMLButtonElement { const el = Array.from(container.querySelectorAll('button')).find(b => b.textContent === text || b.getAttribute('aria-label') === text); if (!el) throw new Error('Button missing: ' + text); return el }
async function click(text: string) { await act(async () => button(text).click()) }
async function dropFile(file: File) {
  const root = container.querySelector('.dam-wh-root') as HTMLElement
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { files: [file], types: ['Files'] } })
  await act(async () => { root.dispatchEvent(event) })
}
async function field(label: string, value: string) {
  const el = container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })) })
}
describe('actual React management interactions', () => {
  it('moves keyboard focus into the editor and restores it after discarding', async () => {
    await setup()
    const open = button('查看 / 编辑')
    open.focus()
    await click('查看 / 编辑')
    expect(document.activeElement).toBe(container.querySelector('[aria-label="记忆标题"]'))
    await click('取消')
    expect(document.activeElement).toBe(open)
    const create = button('新建')
    create.focus()
    await click('新建')
    expect(document.activeElement).toBe(container.querySelector('[aria-label="记忆标题"]'))
    await click('取消')
    expect(document.activeElement).toBe(create)
  })
  it('shows the supersede chain and keeps only save/cancel in the editor', async () => {
    const original = listing.records
    listing.records = [{ ...record, status: 'verified', supersededBy: 'alpha-new', supersedes: 'alpha-old' }] as unknown as typeof listing.records
    try {
      await setup()
      expect(container.textContent).toContain('被 alpha-new 取代')
      expect(container.textContent).toContain('取代了 alpha-old')
      await click('查看 / 编辑')
      const editor = container.querySelector('[aria-label="记忆编辑器"]') as HTMLElement
      const labels = Array.from(editor.querySelectorAll('.dam-wh-toolbar button')).map(item => item.textContent)
      expect(labels).toEqual(['保存', '取消'])
    } finally {
      listing.records = original
    }
  })
  it('keeps refresh and settings as icon buttons with a compact menu', async () => {
    await setup()
    const refresh = button('刷新')
    expect(refresh.getAttribute('title')).toBe('刷新')
    expect(refresh.textContent).toBe('')
    const settings = container.querySelector('summary[aria-label="设置"]')
    expect(settings).not.toBeNull()
    const menu = settings!.closest('details')!
    expect(menu.textContent).toContain('质量体检')
    expect(menu.textContent).toContain('查看归档')
    expect(menu.textContent).toContain('导出逐文件清单')
  })
  it('merges duplicate and topic groups in one click without a second confirmation', async () => {
    const request = await setup()
    await click('重复与合并')
    const section = container.querySelector('[aria-label="重复与合并"]')
    expect(section).not.toBeNull()
    expect(section!.textContent).not.toContain('已默认勾选')
    expect(section!.querySelector('[aria-label="相似度 90%"]')).not.toBeNull()
    expect(section!.textContent).toContain('typescript-merged')
    expect(section!.textContent).toContain('alpha-merged')
    expect(request).toHaveBeenCalledWith('memory.duplicates', expect.objectContaining({ scope: 'user', threshold: 0.8 }), 'POST')
    expect(request).toHaveBeenCalledWith('memory.mergeSuggest', expect.objectContaining({ scope: 'user', minShared: 2 }), 'POST')
    const confirm = vi.fn(() => { throw new Error('unexpected confirmation dialog') })
    vi.stubGlobal('confirm', confirm)
    await click('确认合并（2 组）')
    expect(confirm).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledWith('memory.merge', expect.objectContaining({ name: 'typescript-merged', confirm: true }), 'POST')
    expect(request).toHaveBeenCalledWith('memory.merge', expect.objectContaining({ name: 'alpha-merged', confirm: true }), 'POST')
    expect(container.querySelector('[aria-label="重复与合并"]')).toBeNull()
    expect(container.textContent).toContain('已合并 2 条来源。')
  })
  it('reports skipped stale members after merging', async () => {
    await setup(undefined, ['ts-build'])
    await click('重复与合并')
    vi.stubGlobal('confirm', vi.fn(() => { throw new Error('unexpected confirmation dialog') }))
    await click('确认合并（2 组）')
    expect(container.querySelector('[aria-label="重复与合并"]')).toBeNull()
    expect(container.textContent).toContain('2 条已失效或停用的来源被跳过')
  })
  it('shows Chinese titles instead of record slugs in the pending merge list (rc.12)', async () => {
    await setup()
    await click('重复与合并')
    const section = container.querySelector('[aria-label="自动合并"]') as HTMLElement
    expect(section.textContent).toContain('考研一年阶段计划')
    expect(section.textContent).toContain('合并：考研目标：华中科技大学')
    expect(section.textContent).not.toContain('reference-kaoyan-plan')
  })
  it('merges a pending group in one click without a confirmation dialog', async () => {
    const request = await setup()
    await click('重复与合并')
    const confirm = vi.fn(() => { throw new Error('unexpected confirmation dialog') })
    vi.stubGlobal('confirm', confirm)
    await click('合并这一组')
    expect(confirm).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledWith('merge.autoApply', expect.objectContaining({ key: 'ask-1' }), 'POST')
  })
  it('collapses the merge section from the same toolbar button', async () => {
    await setup()
    await click('重复与合并')
    expect(container.querySelector('[aria-label="重复与合并"]')).not.toBeNull()
    await click('重复与合并：收起')
    expect(container.querySelector('[aria-label="重复与合并"]')).toBeNull()
    expect(button('重复与合并')).not.toBeNull()
  })
  it('removes a disposed project selection and accepts a newly active session', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval')
    const request = await setup()
    const original = request.getMockImplementation()!
    let active = [{ id: 's1', cwd: 'synthetic-project' }]
    request.mockImplementation(async (name, data, method) => name === 'sessions.active' ? { sessions: active } : original(name, data, method))
    await field('记忆范围', 'project'); await field('项目会话', 's1')
    const sync = interval.mock.calls.find(([, delay]) => delay === 15_000)?.[0] as (() => void) | undefined
    expect(sync).toBeDefined()
    active = []
    await act(async () => sync!())
    const selector = container.querySelector('[aria-label="项目会话"]') as HTMLSelectElement
    expect(selector.value).toBe('')
    expect(selector.options).toHaveLength(1)
    expect(container.textContent).toContain('请选择项目会话')
    expect(request.mock.calls.filter(([name, data]) => name === 'groups.list' && (data as any).scope === 'project').length).toBe(1)
    active = [{ id: 's2', cwd: 'synthetic-project' }]
    await act(async () => sync!())
    expect(selector.options).toHaveLength(2)
    expect(selector.options[1].value).toBe('s2')
    expect(selector.value).toBe('')
    await field('项目会话', 's2')
    expect(request).toHaveBeenCalledWith('groups.list', expect.objectContaining({ scope: 'project', sessionId: 's2' }))
  })
  it('retries an interrupted save with the original revision and unchanged draft after reconnect', async () => {
    const request = await setup()
    const original = request.getMockImplementation()!
    let offline = true
    request.mockImplementation(async (name, data, method) => {
      if (name === 'memory.write' && offline) throw new TypeError('Failed to fetch')
      return original(name, data, method)
    })
    await click('查看 / 编辑'); await field('记忆正文', 'draft retained across outage')
    const saveButton = button('保存')
    saveButton.focus()
    await click('保存')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('连接中断，请保留草稿')
    expect((container.querySelector('[aria-label="记忆正文"]') as HTMLTextAreaElement).value).toBe('draft retained across outage')
    expect(document.activeElement).toBe(saveButton)
    offline = false
    await click('保存')
    const writes = request.mock.calls.filter(([name]) => name === 'memory.write')
    expect(writes).toHaveLength(2)
    expect(writes[1]).toEqual(writes[0])
    expect(writes[1][1]).toEqual(expect.objectContaining({ expectedRevision: record.revision, body: 'draft retained across outage', scope: 'user' }))
    expect(container.querySelector('[aria-label="记忆编辑器"]')).toBeNull()
    expect([button('查看 / 编辑'), button('刷新')]).toContain(document.activeElement)
  })
  it('retains an open draft when a read-only refresh fails before a blocked save', async () => {
    const request = await setup()
    const original = request.getMockImplementation()!
    let blockReads = false
    let blockWrites = false
    request.mockImplementation(async (name, data, method) => {
      if ((name === 'groups.list' && blockReads) || (name === 'memory.write' && blockWrites)) throw new TypeError('Failed to fetch')
      return original(name, data, method)
    })
    await click('查看 / 编辑'); await field('记忆摘要', 'preflight-only draft')
    blockReads = true
    await click('刷新')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('连接中断')
    expect((container.querySelector('[aria-label="记忆摘要"]') as HTMLTextAreaElement).value).toBe('preflight-only draft')
    blockReads = false
    blockWrites = true
    await click('保存')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('未保存的草稿仍保留')
    expect((container.querySelector('[aria-label="记忆摘要"]') as HTMLTextAreaElement).value).toBe('preflight-only draft')
    expect(request.mock.calls.filter(([name]) => name === 'memory.write')).toHaveLength(1)
  })
  it('restores the save control after an asynchronous connection failure', async () => {
    const request = await setup()
    const original = request.getMockImplementation()!
    let rejectWrite: ((error: Error) => void) | undefined
    request.mockImplementation((name, data, method) => name === 'memory.write'
      ? new Promise((_resolve, reject) => { rejectWrite = reject })
      : original(name, data, method))
    await click('查看 / 编辑')
    const saveButton = button('保存')
    saveButton.focus()
    await act(async () => { saveButton.click(); await Promise.resolve() })
    expect(saveButton.disabled).toBe(true)
    await act(async () => { rejectWrite!(new TypeError('Failed to fetch')); await Promise.resolve() })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('连接中断')
    expect(saveButton.disabled).toBe(false)
    expect(document.activeElement).toBe(saveButton)
  })
  it.each(['登录已失效', 'FORBIDDEN: session disposed'])('keeps draft and original scope on access failure: %s', async failure => {
    const request = await setup(failure)
    await click('查看 / 编辑'); await field('记忆正文', 'access failure draft')
    await field('记忆范围', 'project'); await field('项目会话', 's1')
    await click('保存')
    expect((container.querySelector('[aria-label="记忆正文"]') as HTMLTextAreaElement).value).toBe('access failure draft')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(failure)
    expect(request).toHaveBeenCalledWith('memory.write', expect.objectContaining({ scope: 'user', expectedRevision: record.revision }), 'POST')
    expect(container.querySelector('[aria-label="记忆编辑器"]')).not.toBeNull()
  })
  it('starts exactly one download per explicit export action', async () => {
    const downloads: string[]=[]
    vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:synthetic')
    vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
    vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this: HTMLAnchorElement){downloads.push(this.download)})
    await setup(); await click('导出此范围的 Markdown')
    expect(downloads).toEqual(['wh-user-memories.md'])
    await click('导出逐文件清单')
    expect(downloads).toEqual(['wh-user-memories.md','wh-user-manifest.json'])
  })
  it('downloads the JSON package through a POST request', async () => {
    const downloads: string[] = []
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download) })
    const request = await setup()
    await click('导出 JSON 包')
    expect(request).toHaveBeenCalledWith('export.package', expect.objectContaining({ scope: 'user' }), 'POST')
    expect(downloads).toEqual(['wh-user-package.json'])
  })
  it('previews a JSON package import and applies the chosen conflict strategy', async () => {
    const request = await setup()
    const input = container.querySelector('[aria-label="导入 JSON 包文件"]') as HTMLInputElement
    const file = new File([JSON.stringify({ format: 'wh-memory-export', records: [] })], 'pkg.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    const preview = container.querySelector('[aria-label="导入预览"]')
    expect(preview).not.toBeNull()
    expect(preview!.textContent).toContain('新增 1')
    expect(preview!.textContent).toContain('冲突 1')
    expect(preview!.textContent).toContain('alpha')
    expect((request.mock.calls.find(call => call[0] === 'import.plan')?.[1] as { package?: unknown }).package).toEqual({ format: 'wh-memory-export', records: [] })
    const forkLabel = Array.from(container.querySelectorAll('[aria-label="导入预览"] label')).find(label => label.textContent?.includes('两边都留'))
    expect(forkLabel).not.toBeUndefined()
    await act(async () => { (forkLabel!.querySelector('input') as HTMLInputElement).click() })
    await click('应用导入')
    const apply = request.mock.calls.find(call => call[0] === 'import.apply')
    expect(apply?.[1]).toMatchObject({ approvedChecksum: 'abc123def456', onConflict: 'fork' })
    expect(container.textContent).toContain('导入完成：新增 1')
    expect(container.querySelector('[aria-label="导入预览"]')).toBeNull()
  })
  it('rejects a dropped file that is not a WH memory package with a readable message', async () => {
    const request = await setup()
    await dropFile(new File(['111'], 'x.json', { type: 'application/json' }))
    expect(container.textContent).toContain('这不是 WH 记忆包')
    expect(container.querySelector('[aria-label="导入预览"]')).toBeNull()
    expect(request.mock.calls.some(call => call[0] === 'import.plan')).toBe(false)
  })
  it('accepts a dropped JSON package and shows its size and record count', async () => {
    const request = await setup()
    const pkg = { format: 'wh-memory-export', version: 1, scope: 'user', checksum: 'abc123def456', records: [{ name: 'a', body: 'x'.repeat(1400) }, { name: 'b' }] }
    await dropFile(new File([JSON.stringify(pkg)], 'pkg.json', { type: 'application/json' }))
    const preview = container.querySelector('[aria-label="导入预览"]')
    expect(preview).not.toBeNull()
    expect(preview!.textContent).toContain('2 条记录')
    expect(preview!.textContent).toMatch(/\d+(\.\d+)? (字节|KB)/)
    expect((request.mock.calls.find(call => call[0] === 'import.plan')?.[1] as { package?: unknown }).package).toEqual(pkg)
  })
  it('rejects a JSON package above the 2 MB panel limit before previewing', async () => {
    const request = await setup()
    await dropFile(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.json', { type: 'application/json' }))
    expect(container.textContent).toContain('超过 2.0 MB 上限')
    expect(container.querySelector('[aria-label="导入预览"]')).toBeNull()
    expect(request.mock.calls.some(call => call[0] === 'import.plan')).toBe(false)
  })
  it.each(['REVISION_CONFLICT: 内容已变化', '网络断开'])('preserves draft after %s', async failure => {
    const request = await setup(failure)
    await click('查看 / 编辑'); await field('记忆正文', 'unsaved new body')
    await click('保存')
    expect((container.querySelector('[aria-label="记忆正文"]') as HTMLTextAreaElement).value).toBe('unsaved new body')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(failure)
    expect(request).toHaveBeenCalledWith('memory.write', expect.objectContaining({ body: 'unsaved new body', expectedRevision: record.revision }), 'POST')
  })
  it('saves edits without a review step', async () => {
    const request = await setup()
    await click('查看 / 编辑')
    expect(container.querySelector('script')).toBeNull()
    // v0.8.2：正文只在 textarea 中编辑，不再提供纯文本预览
    expect((container.querySelector('[aria-label="记忆正文"]') as HTMLTextAreaElement).value).toBe(record.body)
    // v1.0.0-rc.10：撤销人工审核，保存直接生效
    expect(container.textContent).not.toContain('保存即表示')
    expect(container.textContent).not.toContain('待审核')
    await field('记忆标题', 'Changed')
    await click('保存')
    expect(request).toHaveBeenCalledWith('memory.write', expect.objectContaining({ title: 'Changed' }), 'POST')
    const write = request.mock.calls.find(call => call[0] === 'memory.write')?.[1] as Record<string, unknown>
    expect(write.approve).toBeUndefined()
    expect(container.querySelector('[aria-label="记忆编辑器"]')).toBeNull()
  })
  it('opens the editor inside the edited record instead of the page bottom', async () => {
    await setup()
    await click('查看 / 编辑')
    expect(container.querySelector('article [aria-label="记忆编辑器"]')).not.toBeNull()
    expect(container.querySelector('article .dam-wh-editor')).not.toBeNull()
    await click('取消')
    await click('新建')
    expect(container.querySelector('article [aria-label="记忆编辑器"]')).toBeNull()
    expect(container.querySelector('[aria-label="记忆编辑器"]')).not.toBeNull()
  })
  it('closes the editor from the row toggle', async () => {
    await setup()
    await click('查看 / 编辑')
    expect(container.querySelector('[aria-label="记忆编辑器"]')).not.toBeNull()
    await click('查看 / 编辑：取消')
    expect(container.querySelector('[aria-label="记忆编辑器"]')).toBeNull()
  })
  it('requires explicit project selection and preserves the editor original target', async () => {
    const request = await setup('keep draft')
    await click('查看 / 编辑'); await field('记忆范围', 'project')
    expect(container.textContent).toContain('请选择项目会话')
    expect(request.mock.calls.filter(([name, payload]) => name === 'groups.list' && (payload as any).scope === 'project')).toHaveLength(0)
    await field('项目会话', 's1'); await click('保存')
    expect(request).toHaveBeenCalledWith('memory.write', expect.objectContaining({ scope: 'user' }), 'POST')
  })
  it('shows archives/audit until scope changes and confirms archive with revision', async () => {
    const request = await setup()
    await click('查看归档'); expect(container.querySelector('[aria-label="归档记录"]')?.textContent).toContain('old')
    await click('查看组装审计'); expect(container.textContent).toContain('478 / 4096 字节')
    await click('移至归档')
    expect(request.mock.calls.some(([name]) => name === 'memory.delete')).toBe(false)
    await click('确认归档')
    expect(request).toHaveBeenCalledWith('memory.delete', { scope: 'user', name: 'alpha', expectedRevision: record.revision }, 'POST')
    await field('记忆范围', 'project'); expect(container.querySelector('[aria-label="归档记录"]')).toBeNull()
  })
  it('shows automatic backup status', async () => {
    await setup()
    expect(container.textContent).toContain('自动备份：每 24 小时')
    expect(container.textContent).toContain('（9 个文件）')
  })
  it('shows process metrics on demand', async () => {
    await setup()
    await click('运行指标')
    const section = container.querySelector('[aria-label="运行指标"]')
    expect(section?.textContent).toContain('写入 3 次')
    expect(section?.textContent).toContain('锁超时 1')
    expect(section?.textContent).toContain('可写')
  })
  it('marks records for merge without merging until the single confirmation', async () => {
    const request = await setup()
    await click('重复与合并')
    const section = container.querySelector('[aria-label="重复与合并"]')
    expect(section?.textContent).toContain('alpha')
    expect(section?.textContent).toContain('beta')
    expect(request.mock.calls.some(([name]) => name === 'memory.merge')).toBe(false)
  })
  it('no longer offers batch review controls', async () => {
    await setup()
    expect(container.textContent).not.toContain('批量审核')
    expect(container.textContent).not.toContain('批量通过审核')
    expect(container.querySelector('[aria-label="选择 alpha"]')).toBeNull()
    expect(Array.from(container.querySelectorAll('button')).some(item => item.textContent === '未审核')).toBe(false)
  })
  it('no longer offers task as a memory type or renders task controls', async () => {
    await setup()
    const filter = container.querySelector('[aria-label="筛选类型"]') as HTMLSelectElement
    expect(Array.from(filter.options).map(option => option.value)).not.toContain('task')
    await click('查看 / 编辑')
    expect(container.querySelector('[aria-label="任务截止时间"]')).toBeNull()
    expect(container.querySelector('[aria-label="任务优先级"]')).toBeNull()
  })
})

describe('quality report', () => {
  it('renders lint results and does not modify records', async () => {
    const request = await setup()
    await click('质量体检')
    expect(request).toHaveBeenCalledWith('quality.report', { scope: 'user' }, 'POST')
    const section = container.querySelector('[aria-label="记忆质量体检"]')
    expect(section).not.toBeNull()
    expect(section!.textContent).toContain('扫描 3 条')
    expect(container.textContent).toContain('名称过于通用')
    expect(container.querySelector('[aria-label="alpha 的质量提示"]')).not.toBeNull()
    expect(section!.textContent).toContain('只读提示')
    expect(section!.textContent).toContain('索引占用 5000 / 4096 字节（超出预算，注入会被截断），1 条被排除')
    expect(section!.textContent).toContain('查看被索引排除的记录')
    expect(section!.textContent).toContain('memo · budget')
    expect(section!.textContent).toContain('近重复 1 组')
    expect(request).not.toHaveBeenCalledWith('memory.write', expect.anything(), expect.anything())
  })
})

describe('pagination and refresh (v0.6.0)', () => {
  it('requests five records per page and pages by five', async () => {
    const originalTotal = listing.total
    listing.total = 12
    try {
      const request = await setup()
      expect(request).toHaveBeenCalledWith('groups.list', expect.objectContaining({ offset: 0, limit: 5 }))
      expect(container.textContent).toContain('每页 5 条')
      await click('下一页')
      expect(request).toHaveBeenCalledWith('groups.list', expect.objectContaining({ offset: 5, limit: 5 }))
      expect(container.textContent).toContain('第 2 页')
    } finally { listing.total = originalTotal }
  })

  it('keeps the current list mounted while a refresh is in flight', async () => {
    const request = await setup()
    const implementation = request.getMockImplementation()!
    let release: (() => void) | null = null
    request.mockImplementation(async (name, data, method) => {
      if (name === 'groups.list') await new Promise<void>(resolve => { release = resolve })
      return implementation(name, data, method)
    })
    await click('刷新')
    // 刷新过程中列表不应被卸载（否则页面变矮、滚动位置被夹回顶部）
    expect(container.textContent).toContain('Alpha')
    await act(async () => { release?.() })
  })
})

describe('related memories (v0.7.0)', () => {
  it('shows scored related records in the editor', async () => {
    await setup()
    await click('查看 / 编辑')
    const section = container.querySelector('[aria-label="相关记忆"]')
    expect(section).not.toBeNull()
    expect(section!.textContent).toContain('强相关 · beta')
    expect(section!.querySelector('[aria-label="相关度 72%"]')).not.toBeNull()
    // v0.8.2：只展示进度条与结论，不再展示分数构成明细
    expect(section!.textContent).not.toContain('记录之间显式引用 +40')
    expect(section!.textContent).toContain('只作参考')
  })

  it('renders the empty state when nothing passes the threshold', async () => {
    const request = await setup()
    const implementation = request.getMockImplementation()!
    request.mockImplementation(async (name, data, method) => name === 'relatedness.forRecord'
      ? { target: { name: 'alpha', scope: 'user' }, items: [], thresholds: { weak: 30, strong: 60 } }
      : implementation(name, data, method))
    await click('查看 / 编辑')
    expect(container.textContent).toContain('没有达到阈值（30 分）的相关记录')
  })

  it('keeps editing usable when the relatedness request fails', async () => {
    const request = await setup()
    const implementation = request.getMockImplementation()!
    request.mockImplementation(async (name, data, method) => {
      if (name === 'relatedness.forRecord') throw new Error('offline')
      return implementation(name, data, method)
    })
    await click('查看 / 编辑')
    expect(container.querySelector('[aria-label="记忆编辑器"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="相关记忆"]')).toBeNull()
  })
})

describe('header, filters and side drawer (v0.8.2)', () => {
  it('reveals the search field from the header icon and hides it on Escape', async () => {
    const request = await setup()
    expect(container.querySelector('.dam-wh-search--open')).toBeNull()
    await click('搜索')
    expect(container.querySelector('.dam-wh-search--open')).not.toBeNull()
    await field('搜索记忆', 'alpha')
    expect(request).toHaveBeenCalledWith('groups.list', expect.objectContaining({ query: 'alpha' }))
    const input = container.querySelector('[aria-label="搜索记忆"]') as HTMLInputElement
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(container.querySelector('.dam-wh-search--open')).toBeNull()
  })

  it('keeps only the type filter inside the popover beside the toolbar', async () => {
    const request = await setup()
    const details = container.querySelector('details.dam-wh-filter') as HTMLDetailsElement
    expect(details.querySelector('[aria-label="筛选状态"]')).toBeNull()
    expect(details.querySelector('[aria-label="筛选类型"]')).not.toBeNull()
    await field('筛选类型', 'project')
    expect(request).toHaveBeenCalledWith('groups.list', expect.objectContaining({ type: 'project' }))
    await click('清除筛选')
    expect(request).toHaveBeenLastCalledWith('groups.list', expect.objectContaining({ type: '' }))
  })

  // v1.0.0-rc.10：撤销人工审核，“未审核”筛选入口一并移除
  it('no longer offers a pending-review filter', async () => {
    await setup()
    expect(Array.from(container.querySelectorAll('button')).some(item => item.textContent === '未审核')).toBe(false)
    expect(container.textContent).not.toContain('待审核')
  })

  // v0.8.9：新建按钮在同一位置切换为“新增：取消”，点击即完全丢弃草稿
  it('toggles a fresh draft and discards it without saving', async () => {
    const request = await setup()
    await click('新建')
    expect(button('新增：取消')).not.toBeNull()
    expect(container.querySelector('[aria-label="记忆编辑器"]')).not.toBeNull()
    await click('新增：取消')
    expect(container.querySelector('[aria-label="记忆编辑器"]')).toBeNull()
    expect(button('新建')).not.toBeNull()
    expect(request.mock.calls.some(([name]) => name === 'memory.write')).toBe(false)
  })

  it('closes the filter and a fresh draft with Escape', async () => {
    await setup()
    const details = container.querySelector('details.dam-wh-filter') as HTMLDetailsElement
    const summary = details.querySelector('summary') as HTMLElement
    await act(async () => { summary.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(details.open).toBe(true)
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(details.open).toBe(false)
    await click('新建')
    expect(container.querySelector('[aria-label="记忆编辑器"]')).not.toBeNull()
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(container.querySelector('[aria-label="记忆编辑器"]')).toBeNull()
  })

  it('opens settings views in a left side drawer instead of the page bottom', async () => {
    await setup()
    await click('存储')
    const drawer = container.querySelector('aside[role="dialog"]')
    expect(drawer?.getAttribute('aria-label')).toBe('存储')
    expect(drawer!.textContent).toContain('synthetic')
    expect(container.textContent).not.toContain('存储与审计状态')
    await click('关闭面板')
    expect(container.querySelector('aside[role="dialog"]')).toBeNull()
  })

  // v0.8.8：点设置项时保留菜单，面板悬浮在菜单左侧（像右键子菜单）
  it('keeps the settings menu open and floats the panel beside it', async () => {
    await setup()
    const summary = container.querySelector('summary[aria-label="设置"]') as HTMLElement
    await act(async () => {
      summary.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const details = container.querySelector('details.dam-wh-settings') as HTMLDetailsElement
    expect(details.open).toBe(true)
    await click('存储')
    expect(details.open).toBe(true)
    const drawer = container.querySelector('aside[role="dialog"]') as HTMLElement
    expect(drawer).not.toBeNull()
    expect(drawer.getAttribute('style') ?? '').toContain('right')
  })

  it('uses a bare 编辑 heading with no plain-text preview block', async () => {
    await setup()
    await click('查看 / 编辑')
    expect(container.querySelector('.dam-wh-editor h2')?.textContent).toBe('编辑')
    expect(container.querySelector('.dam-wh-editor pre')).toBeNull()
  })

  // v0.8.6：抽屉改为锚定面板右上角，且点空白处/Esc 可以关闭
  it('anchors the drawer under the header and closes it on an outside click', async () => {
    await setup()
    await click('存储')
    const drawer = container.querySelector('aside[role="dialog"]') as HTMLElement
    expect(drawer).not.toBeNull()
    expect(drawer.parentElement?.className ?? '').not.toContain('dam-wh-root')
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(container.querySelector('aside[role="dialog"]')).toBeNull()
  })

  it('closes the settings menu when clicking outside it', async () => {
    await setup()
    const summary = container.querySelector('summary[aria-label="设置"]') as HTMLElement
    await act(async () => {
      summary.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const details = container.querySelector('details.dam-wh-settings') as HTMLDetailsElement
    expect(details.open).toBe(true)
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(details.open).toBe(false)
  })
  it('renders the 3D relationship graph from the settings menu', async () => {
    const request = await setup()
    const entry = button('关系图')
    expect(entry.closest('.dam-wh-toolbar')).not.toBeNull()
    await click('关系图')
    const section = container.querySelector('[aria-label="关系图"]')
    expect(section).not.toBeNull()
    expect(section!.textContent).toContain('2 条记忆 · 1 条关联 · 阈值 30 分')
    expect(section!.querySelector('canvas.dam-wh-graph-canvas')).not.toBeNull()
    expect(request).toHaveBeenCalledWith('relatedness.graph', expect.objectContaining({ scope: 'user', threshold: 30 }), 'POST')
    await click('返回列表')
    expect(container.querySelector('[aria-label="关系图"]')).toBeNull()
  })
  it('renders the read-only life arc as topic chapters in time order', async () => {
    const request = await setup()
    await click('人物弧光')
    const arc = container.querySelector('[aria-label="人物弧光"]')
    expect(arc).not.toBeNull()
    expect(arc!.textContent).toContain('2 个篇章 · 3 条记忆')
    expect(arc!.textContent).toContain('来源：个人 2')
    const chapters = Array.from(arc!.querySelectorAll('section.dam-wh-arc-chapter'))
    expect(chapters.map(chapter => chapter.querySelector('h3')!.textContent)).toEqual(['考研 2 条', '未归类 1 条'])
    const titles = Array.from(chapters[0].querySelectorAll('button.dam-wh-arc-title')).map(entry => entry.textContent)
    expect(titles).toEqual(['考研启动', '复习计划'])
    expect(chapters[0].textContent).toContain('取代了 kaoyan-old')
    expect(chapters[1].textContent).toContain('时间未知')
    expect(chapters[1].textContent).toContain('demo')
    expect(request).toHaveBeenCalledWith('arc.view', expect.objectContaining({ scope: 'user' }), 'POST')
    await click('复习计划')
    expect(container.querySelector('[aria-label="人物弧光"]')).toBeNull()
    expect(request).toHaveBeenCalledWith('groups.list', expect.objectContaining({ query: 'kaoyan-plan' }))
    await click('人物弧光')
    await click('返回列表')
    expect(container.querySelector('[aria-label="人物弧光"]')).toBeNull()
  })
  it('hides graph, merge and batch entries in the minimal edition', async () => {
    const request = await setup()
    request.mockImplementation(async (name: string) => {
      if (name === 'groups.list') {
        return {
          ...listing,
          edition: 'minimal',
          features: { reminders: false, autoSummarize: false, autoBackup: false, merge: false, graph: false, importExport: false, migration: false, batch: false },
        }
      }
      return listing
    })
    await click('刷新')
    expect(container.textContent).not.toContain('关系图')
    expect(container.textContent).not.toContain('人物弧光')
    expect(container.textContent).not.toContain('重复与合并')
    expect(container.querySelector('[aria-label="选择 alpha"]')).toBeNull()
  })
  it('shows the configured edition label in the storage drawer', async () => {
    const request = await setup()
    request.mockImplementation(async (name: string) => {
      if (name === 'groups.list') return { ...listing, edition: 'standard' }
      return listing
    })
    await click('刷新')
    const summary = container.querySelector('details.dam-wh-settings > summary') as HTMLElement
    await act(async () => { summary.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await click('存储')
    const drawer = container.querySelector('[role="dialog"][aria-label="存储"]')
    expect(drawer).not.toBeNull()
    expect(drawer!.textContent).toContain('功能档：中功能版')
    expect(drawer!.textContent).toContain('自动总结：已开启，闲置一小时触发一次')
  })
  it('switches edition from the toolbar slider and hides the disabled entries', async () => {
    let current: 'minimal' | 'standard' | 'full' = 'full'
    const fullFeatures = { reminders: true, autoSummarize: true, autoBackup: true, merge: true, graph: true, importExport: true, migration: true, batch: true }
    const minimalFeatures = { reminders: false, autoSummarize: false, autoBackup: false, merge: false, graph: false, importExport: false, migration: false, batch: false }
    const request = await setup()
    request.mockImplementation(async (name: string, data?: any) => {
      if (name === 'groups.list') return { ...listing, edition: current, features: current === 'minimal' ? minimalFeatures : fullFeatures }
      if (name === 'edition.set') { current = data.edition; return { ok: true, edition: current, features: minimalFeatures } }
      return listing
    })
    await click('刷新')
    const summary = Array.from(container.querySelectorAll('summary')).find(item => item.textContent === '档位') as HTMLElement
    expect(summary).toBeTruthy()
    await act(async () => { summary.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(container.querySelector('[aria-label="功能档位"]')).not.toBeNull()
    await field('功能档位', '1')
    expect(request).toHaveBeenCalledWith('edition.set', { edition: 'minimal' }, 'POST')
    await click('刷新')
    const labels = Array.from(container.querySelectorAll('button')).map(item => item.textContent)
    expect(labels).not.toContain('关系图')
    expect(labels).not.toContain('重复与合并')
  })
  it('closes toolbar popovers on outside click and keeps only one open', async () => {
    const request = await setup()
    request.mockImplementation(async (name: string) => {
      if (name === 'consolidation.sessions') return { sessions: [], diagnostics: { captures: 2, routes: 1, agents: 1, autoSummarize: true } }
      return listing
    })
    await click('刷新')
    const find = (label: string) => Array.from(container.querySelectorAll('summary')).find(item => item.textContent === label) as HTMLElement
    const summaryOf = (el: HTMLElement) => el.closest('details') as HTMLDetailsElement

    const summarize = find('总结')
    await act(async () => { summarize.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(summaryOf(summarize).open).toBe(true)
    expect(container.textContent).toContain('内存中 2 个会话')

    // 点另一个工具栏按钮:之前的浮层收起,避免两个浮层重叠。
    const edition = find('档位')
    await act(async () => { edition.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(summaryOf(summarize).open).toBe(false)
    await act(async () => { edition.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(summaryOf(edition).open).toBe(true)

    // 点空白处:剩下的浮层也收起。
    await act(async () => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(summaryOf(edition).open).toBe(false)
  })

  it('shows a readable label when the host titles a session with a path', async () => {
    const request = await setup()
    request.mockImplementation(async (name: string) => {
      if (name === 'consolidation.sessions') return { sessions: [{ id: 's9', cwd: 'C:\\Users\\x\\auto-memory', title: '@C:\\Users\\x\\auto-memory', lastActivityAt: Date.now() - 60_000, lines: 2 }] }
      return listing
    })
    await click('刷新')
    const summary = Array.from(container.querySelectorAll('summary')).find(item => item.textContent === '总结') as HTMLElement
    await act(async () => { summary.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const row = container.querySelector('button.dam-wh-summary-row') as HTMLButtonElement
    expect(row.textContent).toContain('未命名会话 · auto-memory')
    expect(row.textContent).not.toContain('C:\\Users\\x\\auto-memory')
  })

  it('summarizes a recent session from the toolbar popover', async () => {
    const request = await setup()
    request.mockImplementation(async (name: string) => {
      if (name === 'consolidation.sessions') return { sessions: [{ id: 's1', cwd: 'C:\\Users\\x\\project', title: '帮我记住周三体检', lastActivityAt: Date.now() - 120_000, lines: 3 }] }
      if (name === 'consolidation.run') return { ok: true }
      return listing
    })
    await click('刷新')
    const summary = Array.from(container.querySelectorAll('summary')).find(item => item.textContent === '总结') as HTMLElement
    expect(summary).toBeTruthy()
    await act(async () => { summary.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(request).toHaveBeenCalledWith('consolidation.sessions', { limit: 3 }, 'GET')
    const row = container.querySelector('button.dam-wh-summary-row') as HTMLButtonElement
    expect(row.textContent).toContain('帮我记住周三体检')
    expect(row.textContent).not.toContain('C:\\Users\\x\\project')
    expect(row.getAttribute('title')).toBe('C:\\Users\\x\\project')
    expect(row.textContent).toContain('3 行未固化')
    const refreshSummary = container.querySelector('button[aria-label="刷新总结会话"]') as HTMLButtonElement
    expect(refreshSummary).toBeTruthy()
    const callsBeforeRefresh = request.mock.calls.filter(call => call[0] === 'consolidation.sessions').length
    await act(async () => { refreshSummary.click() })
    expect(request.mock.calls.filter(call => call[0] === 'consolidation.sessions').length).toBe(callsBeforeRefresh + 1)
    await act(async () => { row.click() })
    expect(request).toHaveBeenCalledWith('consolidation.run', { sessionId: 's1' }, 'POST')
    expect(container.textContent).toContain('已写入，可在列表里查看。')
  })
})

describe('merge history popup (1.0.1)', () => {
  it('shows only the newest three automatic merges and all history on demand', async () => {
    const request = await setup()
    const original = request.getMockImplementation()!
    const entries = Array.from({ length: 5 }, (_, i) => ({ id: `am-${i}`, target: `merged-${i}`, at: `2026-11-${10+i}T00:00:00Z`, topic: 'test', score: 80, sources: ['a','b'] }))
    request.mockImplementation(async (name, payload, method) => {
      if (name === 'merge.autoScan') return { auto: [], ask: [], entries }
      if (name === 'merge.history') return { entries: [...entries.map(e => ({ ...e, title: e.target, kind: 'automatic', body: 'merged text', available: true, canUndo: true })), { id: 'manual', title: 'Manual history', target: 'manual', at: '', kind: 'historical', sources: ['c','d'], body: 'manual text', available: true, canUndo: false }] }
      return original(name, payload, method)
    })
    await click('重复与合并')
    const section = container.querySelector('[aria-label="自动合并"]')!
    expect(section.textContent).toContain('merged-4')
    expect(section.textContent).toContain('merged-2')
    expect(section.textContent).not.toContain('merged-0')
    expect(section.textContent!.indexOf('merged-4')).toBeLessThan(section.textContent!.indexOf('merged-3'))
    await click('查看全部合并')
    const popup = container.querySelector('[role="dialog"][aria-label="全部合并记忆"]')!
    expect(popup.textContent).toContain('merged-0')
    expect(popup.textContent).toContain('Manual history')
    await act(async () => popup.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(container.querySelector('[aria-label="全部合并记忆"]')).not.toBeNull()
    await act(async () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(container.querySelector('[aria-label="全部合并记忆"]')).toBeNull()
    await click('查看全部合并'); await click('关闭合并记录')
    expect(container.querySelector('[aria-label="全部合并记忆"]')).toBeNull()
    await click('查看全部合并')
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(container.querySelector('[aria-label="全部合并记忆"]')).toBeNull()
    expect(container.querySelector('[aria-label="自动合并"]')).not.toBeNull()
  })
})
