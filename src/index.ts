/**
 * dsh-auto-memory — 把 Claude Code 的 auto-memory 机制移植为 DeepSeek Harness 原生插件。
 *
 * MEMORY.md 索引自动注入系统提示词 + 类型化记忆文件(单文件 + frontmatter)
 * + memory_write/read/list/search/delete 五工具。严格审核、纯文件存储。
 *
 * 插件形态:export const name / inject / Config / apply(严禁 default export,
 * Loader 会折叠默认导出并丢失 inject —— 官方 postmortem 0001)。
 */

import { basename, join, isAbsolute } from 'node:path'
import { PACKAGE_NAME, DEFAULT_DATA_DIRECTORY, MEMORY_TOOL_NAMES } from './identity.ts'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
// 类型层面:使 AssembleContext 的 agent 字段声明合并生效(来自 dsh-agent)
import type {} from '@deepseek-ai/dsh-agent'
import { MemoryStore } from './store.ts'
import { registerMemoryTools } from './tools.ts'
import { inspectCapabilities, registerCompatDiagnostics } from './compat.ts'
import { MEMORY_SECTION } from './prompt.ts'
import { registerInjectionAudit } from './audit.ts'
import { registerConsolidation } from './consolidate.ts'
import { AutoMerger } from './auto-merge.ts'
import { registerMemoryApi } from './memory-api.ts'
import { autoBackupState, runAutoBackup } from './auto-backup.ts'
import { effectiveProjectCwd } from './project-context.ts'
import { renderMemoryIndexDetailAsync } from './injection.ts'
import { createReminder, isMemoryReminder, listDueReminders, reminderItems, type ReminderCreated, type ReminderRequest, type ReminderServiceLike } from './reminders.ts'
import { CompletionTracker } from './completions.ts'
import { decideReminderRoute } from './reminder-routing.ts'
import { listProjects } from './projects.ts'
import { readTopicRegistry } from './topics.ts'
import { editionFeatures, isEdition, type Edition, type EditionFeatures } from './editions.ts'
import { readEditionOverride, saveEditionOverride } from './settings.ts'

export const name = PACKAGE_NAME
export const inject = ['tools', 'systemPrompt']

/** 插件配置(schemastery 声明,默认值写在 schema;用户经 profile patch 覆盖,整表替换)。 */
export interface Config {
  /** 注入索引段(含写入指导)的字节预算。 */
  auditMaxBytes?: number
  auditRetentionDays?: number
  maxBytes: number
  /** Legacy specification alias; normalized before store construction. */
  maxIndexBytes?: number
  /** 记忆根目录;缺省 $DSH_HOME/memory-wh(跟随 $DSH_HOME > ~/.dsh)。 */
  memoryDir?: string
  /** 是否启用用户级作用域(_user 目录注入所有会话)。 */
  enableUserScope: boolean
  /** P1:会话结束自动总结固化(需要可用模型路由;失败静默不影响会话)。 */
  autoSummarize: boolean
  /** 单次固化最多写入的新记忆数。 */
  autoSummarizeMaxMemories: number
  /** 固化模型调用的输出 token 上限。 */
  autoSummarizeMaxTokens: number
  /** v0.2.0 门槛:至少几条真实 USER 输入才触发固化(0 关闭)。 */
  autoSummarizeMinTurns: number
  /** v0.2.0 门槛:转写总字符数下限(0 关闭)。 */
  autoSummarizeMinChars: number
  /** v0.2.0 去重:同 type+scope 且正文/描述归一后相同的候选跳过。 */
  autoSummarizeDedupe: boolean
  /** v0.12.3:会话闲置多少分钟后触发一次固化;0 表示只在会话结束时触发。 */
  autoSummarizeIdleMinutes: number
  /** v1.0.0-rc.2:主题感知的自动合并(同主题≥80 直接合并,可撤销)。 */
  autoMerge: boolean
  /** v0.2.0 自动备份:定期把记忆树复制到 <memoryDir>/.backups/auto(尽力而为,非离线快照)。 */
  autoBackup: boolean
  /** 自动备份最小间隔(小时)。 */
  autoBackupIntervalHours: number
  /** 保留的自动备份份数。 */
  autoBackupKeep: number
  /** #17 固化价值门槛:候选有效分(importance ?? 类型缺省)低于此值直接丢弃,不落盘。 */
  minImportance: number
  /** P1:软淘汰阈值(天)——超过且从未被读取的记忆在索引重建时从注入索引隐藏(文件保留)。0 禁用。 */
  staleAfterDays: number
  /** v0.7.0:小鲸鱼气泡通道;auto=检测到挂件钩子才用,off=只用宿主投递与会话内注入。 */
  notifyWhale: 'auto' | 'off'
  /** v0.11.0:长轮次结束后弹气泡告知“这一轮跑完了”。 */
  notifyDone: boolean
  /** v0.11.0:只有运行时长不少于该秒数的轮次才提示。 */
  notifyDoneMinSeconds: number
  /** v0.12.0:功能档位;三档共用同一份存储,只影响注入预算与可选功能。 */
  edition: Edition
}

export type ConfigInput = Omit<Config, 'maxBytes'> & { maxBytes?: number }

export const Config = z.object({
  // Do not set this default in the schema: it would hide a legacy alias.
  auditMaxBytes: z.number().default(1048576),
  auditRetentionDays: z.number().default(7),
  maxBytes: z.number(),
  maxIndexBytes: z.number(),
  memoryDir: z.string(),
  enableUserScope: z.boolean().default(true),
  autoSummarize: z.boolean().default(true),
  autoSummarizeMaxMemories: z.number().default(5),
  autoSummarizeMaxTokens: z.number().default(2048),
  autoSummarizeMinTurns: z.number().default(2),
  autoSummarizeMinChars: z.number().default(600),
  autoSummarizeDedupe: z.boolean().default(true),
  autoSummarizeIdleMinutes: z.number().default(60),
  autoMerge: z.boolean().default(true),
  autoBackup: z.boolean().default(false),
  autoBackupIntervalHours: z.number().default(24),
  autoBackupKeep: z.number().default(5),
  minImportance: z.number().default(4),
  staleAfterDays: z.number().default(0),
  notifyWhale: z.union([z.const('auto'), z.const('off')]).default('auto'),
  notifyDone: z.boolean().default(true),
  notifyDoneMinSeconds: z.number().default(60),
  edition: z.union([z.const('minimal'), z.const('standard'), z.const('full')]).default('full'),
})

export function normalizeConfig(input: ConfigInput): Config {
  if (input.maxBytes !== undefined && input.maxIndexBytes !== undefined && input.maxBytes !== input.maxIndexBytes) {
    throw new Error('maxBytes and maxIndexBytes disagree; keep one value or make them equal')
  }
  const maxBytes = input.maxBytes ?? input.maxIndexBytes ?? 4096
  // S04 budgets cover the entire escaped fragment; zero disables injection.
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 65536) {
    throw new Error('maxBytes must be a safe integer between 0 and 65536 bytes')
  }
  if (input.memoryDir !== undefined && (input.memoryDir.trim().length === 0 || !isAbsolute(input.memoryDir))) {
    throw new Error('memoryDir must be an explicit absolute path')
  }
  for (const [key, value, min, max] of [['auditMaxBytes', input.auditMaxBytes ?? 1048576, 4096, 4194304], ['auditRetentionDays', input.auditRetentionDays ?? 7, 1, 365]] as const) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid ' + key)
  }
  for (const [key, value, min, max] of [['autoSummarizeMinTurns', input.autoSummarizeMinTurns ?? 2, 0, 40], ['autoSummarizeMinChars', input.autoSummarizeMinChars ?? 600, 0, 24000], ['autoSummarizeIdleMinutes', input.autoSummarizeIdleMinutes ?? 60, 0, 1440]] as const) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid ' + key)
  }
  for (const [key, value, min, max] of [['autoBackupIntervalHours', input.autoBackupIntervalHours ?? 24, 1, 720], ['autoBackupKeep', input.autoBackupKeep ?? 5, 1, 50]] as const) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid ' + key)
  }
  if (input.notifyWhale !== undefined && input.notifyWhale !== 'auto' && input.notifyWhale !== 'off') {
    throw new Error('notifyWhale must be "auto" or "off"')
  }
  const notifyDoneMinSeconds = input.notifyDoneMinSeconds ?? 60
  if (!Number.isSafeInteger(notifyDoneMinSeconds) || notifyDoneMinSeconds < 10 || notifyDoneMinSeconds > 3600) {
    throw new Error('notifyDoneMinSeconds must be an integer between 10 and 3600')
  }
  if (input.edition !== undefined && !isEdition(input.edition)) {
    throw new Error('edition must be "minimal", "standard" or "full"')
  }
  return { ...input, maxBytes, notifyDoneMinSeconds }
}

export function apply(ctx: Context, input: ConfigInput): void {
  // Fail visible, not silent: if a host update renamed/removed a plugin-facing
  // capability, expose a read-only diagnostic instead of half-registering the
  // engine. Memory files are never touched on this path.
  const compatIssues = inspectCapabilities(ctx)
  if (compatIssues.length > 0) {
    registerCompatDiagnostics(ctx, compatIssues)
    return
  }
  const config = normalizeConfig(input)
  const rootDir = config.memoryDir ?? join(resolveDshHome(), DEFAULT_DATA_DIRECTORY)
  // v0.12.1:面板切换过的档位写在插件自己的 settings.json,优先于配置;仅影响功能与预算。
  let edition: Edition = readEditionOverride(rootDir) ?? config.edition
  let features = editionFeatures(edition)
  const setEdition = (next: Edition): { edition: Edition; features: EditionFeatures } => {
    if (!isEdition(next)) throw new Error('edition must be "minimal", "standard" or "full"')
    edition = next
    features = editionFeatures(next)
    saveEditionOverride(rootDir, next)
    return { edition, features }
  }
  const conflicts = MEMORY_TOOL_NAMES.filter(tool => ctx.tools.get(tool) !== undefined)
  if (conflicts.length > 0) {
    throw new Error('Another memory plugin already owns these tools: ' + conflicts.join(', ') + '. Disable it in this profile before loading WH.')
  }
  const store = new MemoryStore(rootDir, { staleAfterDays: config.staleAfterDays })
  // v1.0.0-rc.4:主题感知自动合并。同主题且相关≥60 直接合并为 verified 记录并保留撤销账本;
  // 跨主题≥80 只进面板询问队列。启动后与每次固化成功后各跑一次(去抖)。
  const autoMerger = new AutoMerger(store, rootDir)
  let autoMergeTimer: ReturnType<typeof setTimeout> | null = null
  let autoMergeRunning = false
  const runAutoMergeNow = async (): Promise<void> => {
    if (!config.autoMerge || !features.merge || autoMergeRunning) return
    autoMergeRunning = true
    try {
      const scan = await autoMerger.scan('user')
      for (const plan of scan.auto) {
        await autoMerger.apply(plan, 'user')
        console.info('[dsh-auto-memory-wh] auto-merged ' + plan.members.map(member => member.name).join(', '))
      }
    } catch (error) {
      console.warn('[dsh-auto-memory-wh] automatic merge skipped: ' + String(error))
    } finally {
      autoMergeRunning = false
    }
  }
  const scheduleAutoMerge = (delayMs: number): void => {
    if (!config.autoMerge || !features.merge) return
    if (autoMergeTimer !== null) clearTimeout(autoMergeTimer)
    autoMergeTimer = setTimeout(() => { autoMergeTimer = null; void runAutoMergeNow() }, delayMs)
    autoMergeTimer.unref?.()
  }
  ctx.effect(function* () {
    yield () => { if (autoMergeTimer !== null) clearTimeout(autoMergeTimer) }
  }, 'WH automatic merge')

  const projectSessions = new Map<string, string>()
  // v0.9.0:任务提醒只存在宿主原生 schedule(“自动化任务”);本插件不再把记忆任务同步过去。
  // 服务缺失时 memory_remind 明确报 REMINDER_UNAVAILABLE,面板的鲸鱼气泡也自动跳过。
  const getSchedule = () => (ctx as unknown as { get(name: string, strict?: boolean): unknown }).get('schedule', false) as ReminderServiceLike | undefined
  const remind = async (input: ReminderRequest & { sessionId?: string; cwd?: string; newSession?: boolean }): Promise<ReminderCreated> => {
    const service = getSchedule()
    if (!service) throw new Error('REMINDER_UNAVAILABLE: host schedule service is not available in this profile')
    return createReminder(service, {
      request: {
        title: input.title,
        ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
        ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt }),
        ...(input.inSeconds === undefined ? {} : { inSeconds: input.inSeconds }),
      },
      target: input.newSession
        ? { kind: 'new_once', ...(input.cwd ? { cwd: input.cwd } : {}) }
        : { kind: 'session', sessionId: input.sessionId ?? '' },
      ...(input.sessionId === undefined ? {} : { actorSessionId: input.sessionId }),
    })
  }
  const dueReminders = async () => {
    const service = getSchedule()
    return service ? listDueReminders(service) : []
  }
  // v1.0.0-rc.8：只读列出本插件创建的提醒；时间由工具层按本机时区渲染。
  const listMemoryReminders = async () => {
    const service = getSchedule()
    if (!service) return []
    return reminderItems(await service.list({ limit: 200 })).filter(isMemoryReminder)
  }
  // v0.11.0:只观察运行时长;完成事件留在内存环形缓冲里,重启即清空(气泡本来就是即时提示)。
  const completions = new CompletionTracker({ minDurationMs: config.notifyDoneMinSeconds * 1000 })
  if (config.notifyDone) {
    ctx.on('agent/status', payload => {
      const id = payload?.agent?.id
      const status = payload?.status
      if (typeof id !== 'string' || (status !== 'running' && status !== 'idle')) return
      completions.status(id, status)
    })
  }
  ctx.on('agent/created', ({ agent }): undefined => {
    const cwd = effectiveProjectCwd(ctx, agent.session)
    if (cwd) projectSessions.set(agent.session.id, cwd)
  })
  ctx.on('session/event', (session, event) => {
    if (String(event.type) !== 'working-directory/change' || !projectSessions.has(session.id)) return
    const cwd = effectiveProjectCwd(ctx, session)
    if (cwd) projectSessions.set(session.id, cwd)
    else projectSessions.delete(session.id)
  })
  ctx.on('session/disposed', session => {
    projectSessions.delete(session.id)
    completions.forget(session.id)
  })
  // v1.0.0-rc.5:提醒落点的相关性路由(roadmap 1.3)。只读项目清单与当前 scope 的主题注册表;
  // 读不到就退回“默认本会话”,绝不因为路由失败丢掉提醒。
  const routeReminder = async (input: { text: string; sessionId?: string; currentCwd?: string; requested: 'auto' | 'current' | 'new' }) => {
    let knownProjects: Array<{ cwd: string; label: string }> = []
    try {
      knownProjects = listProjects(rootDir).projects.flatMap(project => project.cwd ? [{ cwd: project.cwd, label: basename(project.cwd) }] : [])
    } catch {
      knownProjects = []
    }
    let currentTopics: string[] = []
    if (input.currentCwd) {
      try {
        currentTopics = (await readTopicRegistry(store.dir('project', input.currentCwd))).map(topic => topic.title)
      } catch {
        currentTopics = []
      }
    }
    return decideReminderRoute({ ...input, knownProjects, currentTopics })
  }
  registerMemoryTools(ctx, store, config.enableUserScope, { remind, routeReminder, listReminders: listMemoryReminders, enableRemind: () => features.reminders })

  // P2-2:Web 面板 API(宿主半路由)。connection 服务由 web-app 组合提供,
  // 加载顺序晚于本插件——用 inject 回调等待服务就绪再注册(非 web 组合永不回调)。
  // 回调使用框架给的 fiber ctx 注册,依赖消失时路由 effect 随作用域自动回收。
  ctx.inject(['connection'], fiberCtx => {
    registerMemoryApi(fiberCtx, store, rootDir, {
      maxBytes: config.maxBytes,
      enableUserScope: config.enableUserScope,
      resolveProject: sessionId => projectSessions.get(sessionId),
      listProjects: () => [...projectSessions].map(([id, cwd]) => ({ id, cwd })),
      staleAfterDays: config.staleAfterDays,
      rootSource: config.memoryDir ? 'explicit memoryDir' : 'isolated WH default',
      auditMaxBytes: config.auditMaxBytes,
      auditRetentionDays: config.auditRetentionDays,
      scheduleStatus: () => ({ available: getSchedule() !== undefined, mapped: 0 }),
      notifyWhale: config.notifyWhale,
      dueReminders,
      recentCompletions: () => completions.pending(),
      consolidation: () => consolidation.stats(),
      consolidationSessions: limit => consolidation.recent(limit),
      consolidationRun: sessionId => consolidation.summarize(sessionId as Parameters<typeof consolidation.summarize>[0]),
    consolidationDiagnostics: () => consolidation.diagnostics(),
      autoMerge: {
        scan: (scope, cwd) => autoMerger.scan(scope, cwd),
        apply: (plan, scope, cwd) => autoMerger.apply(plan, scope, cwd),
        list: () => autoMerger.list(),
        undo: id => autoMerger.undo(id),
      },
      notifyDone: config.notifyDone,
      notifyDoneMinSeconds: config.notifyDoneMinSeconds,
      edition: () => edition,
      features: () => features,
      setEdition,
      indexUsage: async cwd => {
        const detail = await renderMemoryIndexDetailAsync(store, config, cwd)
        return { bytes: detail.textBytes, budget: config.maxBytes, excluded: detail.excluded }
      },
      autoBackup: { enabled: config.autoBackup && features.autoBackup, intervalHours: config.autoBackupIntervalHours, keep: config.autoBackupKeep },
      legacyMemoryDir: join(resolveDshHome(), 'memory'),
    })
  })

  // v0.2.0:非离线自动备份(尽力而为)。写入是逐文件原子的,但跨文件不保证同一时刻;
  // 需要精确快照时仍应使用 maintenance-cli 的 backup(要求 writersStopped=true)。
  if (config.autoBackup && features.autoBackup) {
    const settings = { intervalHours: config.autoBackupIntervalHours, keep: config.autoBackupKeep }
    ctx.effect(function* () {
      const tick = (): void => {
        if (!features.autoBackup) return
        void autoBackupState(rootDir, settings)
          .then(state => state.due ? runAutoBackup(rootDir, settings, 'automatic') : null)
          .catch(error => console.warn('[auto-memory-wh] automatic backup skipped: ' + String(error)))
      }
      const first = setTimeout(tick, 5_000)
      const timer = setInterval(tick, 15 * 60_000)
      yield () => { clearTimeout(first); clearInterval(timer) }
    }, 'WH automatic backup')
  }

  // P1:会话结束自动固化(autoSummarize=false 或低功能档时 no-op);
  // 同时把会话捕获查询器交给注入侧(#18 相关性截断的词集来源)
  const consolidation = registerConsolidation(ctx, store, {
    autoSummarize: config.autoSummarize && features.autoSummarize,
    autoSummarizeMaxMemories: config.autoSummarizeMaxMemories,
    autoSummarizeMaxTokens: config.autoSummarizeMaxTokens,
    autoSummarizeMinTurns: config.autoSummarizeMinTurns,
    autoSummarizeMinChars: config.autoSummarizeMinChars,
    autoSummarizeDedupe: config.autoSummarizeDedupe,
  autoSummarizeIdleMinutes: config.autoSummarizeIdleMinutes,
    enableUserScope: config.enableUserScope,
    minImportance: config.minImportance,
    onConsolidated: () => scheduleAutoMerge(2_000),
  })
  scheduleAutoMerge(20_000)

  // P1:软淘汰——每个会话首次打开时刷新一次索引,过期条目不注入。
  if (config.staleAfterDays > 0) {
    const refreshed = new Set<string>()
    ctx.on('agent/created', ({ agent }): undefined => {
      const cwd = effectiveProjectCwd(ctx, agent.session)
      if (cwd === undefined) return
      if (refreshed.has(agent.session.id)) return
      refreshed.add(agent.session.id)
      store.refreshIndex('project', cwd).catch(() => {
        console.warn('[auto-memory-wh] index refresh requires storage review')
      })
      if (config.enableUserScope) store.refreshIndex('user').catch(() => {
        console.warn('[auto-memory-wh] index refresh requires storage review')
      })
    })
    ctx.on('session/disposed', session => { refreshed.delete(session.id) })
  }

  // #20:注入审计(只记录"注入了哪些名字",与注入同源,不二次计算)
  const audit = registerInjectionAudit(store, config, rootDir, consolidation.getQueryText)
  ctx.effect(function* () {
    yield () => audit.flush()
  }, 'WH audit shutdown')

  ctx.systemPrompt.section({ name: MEMORY_SECTION, order: 4000, text: '' })
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const text = await audit.textAsync(effectiveProjectCwd(ctx, context.agent?.session), context.agent?.session.id, context.signal)
    return { ...assembled, sections: assembled.sections.map(section => section.name === MEMORY_SECTION ? { ...section, text: context.signal?.aborted ? '' : text } : section) }
  })

  ctx.on('session/disposed', session => {
    audit.cleanup(session.id)
    consolidation.cleanup(session.id)
  })
}
