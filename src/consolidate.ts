/**
 * P1:会话结束自动固化(consolidation)。
 *
 * 流程(全部挂点来自源码调研,见 internal research notes eventsCompaction 报告):
 * 1. 会话进行中:监听 `session/event`(fire-and-forget),把人类输入与模型回复的
 *    文本以轻量摘要形式累积进内存缓冲(不读 deprecated 的 snapshotEvents/eventAt,
 *    不写任何自定义会话事件)。
 * 2. `agent/disposed` 时(session 仍活、agent.options 路由可用——官方最佳挂点):
 *    过滤 subagent(header.delegationDepth > 0),用 ctx.llm.stream 后台调用
 *    (BlockAssembler 消费),让模型从缓冲中提取"值得跨会话保留的新事实"。
 * 3. 候选经 sanitize(normalizeName/类型/scope/截断)与查重(同名跳过)后,
 *    走 store.write 写入——完整复用 P0 的锁/原子写/安全层。
 *
 * 安全边界:
 * - 一切失败静默(ctx.logger.warn),绝不影响会话与 resume;
 * - LLM 输出不可信:逐项校验,坏项丢弃;
 * - emit 监听不被 await:active 集合 + ctx.effect teardown 排空在途 Promise
 *   (command-compact 模式),插件卸载/进程优雅退出时不截断写入;
 * - 已知限制(接受):进程崩溃时未固化的缓冲丢失,已有记忆不受影响。
 */

import { saveUserSummary, type SummaryResult } from './project-summary.ts'
import type { Context } from '@deepseek-ai/cordis'
import { effectiveProjectCwd } from './project-context.ts'
// 类型:SessionEvent(事件判别联合)与 Agent/AgentOptions 的声明合并
import type {} from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { MemoryStore } from './store.ts'
import { normalizeName, asMemoryType, DEFAULT_IMPORTANCE } from './store.ts'
import { decideConsolidationAction, detectContradictions, words } from './matching.ts'
import { isGenericName } from './quality.ts'
import { ensureTopicForText } from './topics.ts'
import { ConsolidationStats, type ConsolidationSnapshot } from './consolidation-stats.ts'
import { collectInstructionDigest } from './instructions.ts'
import type { MemoryEvidence, MemoryRecord, MemoryScope, MemoryStatus, MemoryType } from './types.ts'

// dsh-subagent 在 AgentOptions 上声明的字段(此处同样声明合并,不引入对
// dsh-subagent 的依赖;SessionHeader.delegationDepth 官方类型已有,无需重复声明)
declare module '@deepseek-ai/dsh-agent' {
  interface AgentOptions {
    /** Delegation depth: zero for a top-level agent and parent depth + 1 for a child. */
    subagentDepth?: number
  }
}

// 0.2.x(session format v4)起,注入消息只接受 producer-owned 的 source kind:
// 旧的 { kind: 'plugin', plugin: '…' } 已从 MessageSourceMap 移除,既过不了 0.2.x 的
// 类型检查,v4 的持久消息准入也会在运行时拒绝
// (SessionFormatError: format v4 message requires a producer-owned source kind)。
// 本插件按官方 merge-extensible 惯例声明自己的 kind(session-format-v3-to-v4 的迁移
// 说明与 docs/api-reports.md 都以此为准;tool-skill 的 'skill-catalog'、
// dsh-skill 的 'skill-invocation' 同理)。
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-auto-memory-wh': { kind: 'dsh-auto-memory-wh' }
  }
}

/** 固化配置(index.ts Config 的子集)。 */
export interface ConsolidationOptions {
  autoSummarize: boolean
  autoSummarizeMaxMemories: number
  autoSummarizeMaxTokens: number
  /** v0.2.0 门槛:至少包含几条真实 USER 输入才值得固化。0 关闭。 */
  autoSummarizeMinTurns: number
  /** v0.2.0 门槛:转写总字符数低于此值直接跳过。0 关闭。 */
  autoSummarizeMinChars: number
  /** v0.2.0 去重:同 type+scope 且正文/描述归一后相同的新候选跳过。 */
  autoSummarizeDedupe: boolean
  /** v0.12.3:会话闲置多少分钟后触发一次固化;0 表示只在会话结束时触发。 */
  autoSummarizeIdleMinutes: number
  enableUserScope: boolean
  /** v1.0.0-rc.2:一次固化成功应用后回调(用于触发主题感知的自动合并);不得抛错。 */
  onConsolidated?: () => void
  /** #17 候选有效分(importance ?? DEFAULT_IMPORTANCE[type])低于此值丢弃;0 禁用。 */
  minImportance: number
}

/** 一条固化候选(LLM 输出的一个元素,sanitize 前)。 */
export interface RawCandidate {
  /** One short cross-project abstraction, not a copy of project details. */
  userSummary?: unknown
  name?: unknown
  title?: unknown
  description?: unknown
  type?: unknown
  body?: unknown
  scope?: unknown
  importance?: unknown
  /** 支撑该事实的转写逐字摘录(1.0.0;宽松校验,坏值只丢 evidence 不丢整条)。 */
  evidence?: unknown
}

/** sanitize 后的可写候选。 */
export interface SanitizedCandidate {
  name: string
  title?: string
  description: string
  type: MemoryType
  body: string
  scope: MemoryScope
  /** 重要度 1-10(固化模型显式打分;非法或缺省时回退类型缺省,由 store 兜底)。 */
  importance?: number
  /** 可信状态:candidate 默认;指令注入模式命中降级 disputed(1.0.0)。 */
  status: MemoryStatus
  /** 证据链(sessionId 来自固化调用点;quote 为 LLM 摘录,两者齐备才落)。 */
  evidence?: MemoryEvidence
}

// ---------- 纯函数(可测) ----------

const USER_MAX_CHARS = 2000
const ASSISTANT_MAX_CHARS = 500
const MAX_TURNS = 40
const MAX_BUFFER_CHARS = 24_000

/** 从一条会话事件提取捕获文本;不关心的事件返回 null。 */
export function captureText(kind: 'user' | 'assistant', message: { content: unknown } | undefined): string | null {
  if (message === undefined || !Array.isArray(message.content)) return null
  const text = message.content
    .filter((block): block is { type: 'text'; text: string } =>
      typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
  if (text.length === 0) return null
  const cap = kind === 'user' ? USER_MAX_CHARS : ASSISTANT_MAX_CHARS
  return text.length > cap ? `${text.slice(0, cap)}…` : text
}

/** 追加一行到缓冲并执行容量控制(丢最旧)。 */
export function appendCapped(lines: string[], line: string): string[] {
  const next = [...lines, line]
  while (next.length > MAX_TURNS || next.join('\n').length > MAX_BUFFER_CHARS) {
    if (next.length <= 1) break
    next.shift()
  }
  return next
}

/** 从 LLM 输出文本中提取 JSON 数组(容错:截取首个 [ 到最后一个 ]);失败返回 null。 */
export function parseCandidates(raw: string): RawCandidate[] | null {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown
    return Array.isArray(parsed) ? (parsed as RawCandidate[]) : null
  } catch {
    return null
  }
}

// 指令注入检测的实现已下沉 store.write 单点(覆盖 memory_write 直写路径,
// 审查确认只挂固化会被绕过);此处转出口保持固化路径调用方与测试兼容。
import { detectDirectivePattern } from './store.ts'
export { detectDirectivePattern }

/**
 * 闲聊抑制(#17):候选正文是否为纯寒暄——强问候信号命中且剥掉问候后无实质内容。
 * 纪律(对齐 DIRECTIVE_PATTERNS 的 40% 误报教训;对抗审查实测首版中文误报 45% 后重设计):
 * - 强问候信号 = 句首问候(无 ——JS  对 CJK 是死分支)或句中感谢/道别/裸应答;
 * - 实质内容判定分语言:拉丁侧任何 >=3 字符 token;CJK 侧不依赖闭集词表
 *   (审查实测:两字词闭集对 函数/异常/线程/内存 大量漏列、3 字词条对 bigram
 *   分词器是死代码、无标点中英混排 glue 成混合 token 全漏)——改为长度门槛:
 *   剥掉句首问候与句尾客套后,剩余 CJK 字符 >=6 即有实质(自我介绍/偏好/
 *   技术问句天然过线;只有真·纯寒暄被拦,宁漏勿误)。
 */
const GREETING_PATTERNS: RegExp[] = [
  /^(?:你好|您好|hi|hello|hey|早上好|晚上好|下午好)/i,
  /(?:谢谢|感谢|thanks|thank you|多谢|再见|晚安|回头见|bye)/i,
  /^(?:好的|嗯+|哦+|ok|okay|got it|明白|收到)[。.!!~s]*$/i,
]

/** 纯函数:候选正文是否命中闲聊抑制(强问候 AND 剥问候后无实质内容)。 */
export function isChitchat(text: string): boolean {
  const greeting = GREETING_PATTERNS.some(pattern => pattern.test(text))
  if (!greeting) return false
  const stripped = text
    .replace(/^(?:你好|您好|hi|hello|hey|早上好|晚上好|下午好)[,，!！。~s]*/i, '')
    .replace(/(?:谢谢|感谢|多谢|辛苦了|再见|晚安|回头见)(啦|了|呢)?[。.!!~s]*$/g, '')
    .replace(/(?:thanks|thank[s!]you|bye|hello|hi|got it|ok)[!.~s]*/gi, '')
    .trim()
  if (/[a-z][a-z0-9-]{2,}/i.test(stripped)) return false
  const cjkCount = (stripped.match(/[一-鿿]/g) ?? []).length
  if (cjkCount >= 6) return false
  return true
}

/**
 * sanitize 单条候选:字段类型校验、name 归一化(不可归一化即丢弃)、
 * type 收窄、scope guard、长度截断;1.0.0 起统一标可信状态
 * (默认 candidate;正文命中指令注入模式则 disputed——store.write 单点
 * 还会再查一次 description,双保险幂等)。evidence 走调用点传入的
 * sessionId + LLM 摘录。返回 null 表示丢弃。
 */
export function sanitizeCandidate(raw: RawCandidate, enableUserScope: boolean, opts?: { sessionId?: string; transcript?: string }): SanitizedCandidate | null {
  try {
    const name = normalizeName(String(raw.name ?? ''))
    const description = String(raw.description ?? '').trim().slice(0, 160)
    const body = String(raw.body ?? '').trim().slice(0, 2000)
    const title = typeof raw.title === 'string' && raw.title.trim().length > 0 ? raw.title.trim().slice(0, 80) : undefined
    if (description.length === 0 || body.length === 0) return null
    const type = asMemoryType(String(raw.type ?? 'reference'))
    // v0.5.0:任务必须由用户/面板显式创建(带截止时间与提醒),自动固化不得凭空造任务
    if (type === 'task') return null
    const scope: MemoryScope = raw.scope === 'user' ? (enableUserScope ? 'user' : 'project') : 'project'
    const importance = typeof raw.importance === 'number' && Number.isSafeInteger(raw.importance)
      ? Math.min(10, Math.max(1, raw.importance)) : undefined
    // 可信状态:候选一律有主——默认 candidate;指令注入模式命中降级 disputed
    // (store.write 单点还有二次校验,此处前置判定让候选对象自洽可测)。
    const disputed = detectDirectivePattern(body) || detectDirectivePattern(description)
    const status: MemoryStatus = disputed ? 'disputed' : 'candidate'
    let quote = typeof raw.evidence === 'string' && raw.evidence.trim().length > 0
      ? raw.evidence.trim().slice(0, 400)
      : undefined
    // 逐字引用对照(审查 minor:prompt 压力下模型会伪造引用)——转写可得时,
    // 摘录的前 40 字符(空白归一)必须真实出现在转写里,否则视为幻觉引用丢弃
    // (宽松:只丢 evidence 不丢整条,与"坏值只丢字段"纪律一致)
    const transcript = opts?.transcript
    if (quote !== undefined && transcript !== undefined) {
      const probe = quote.replace(/\s+/g, ' ').slice(0, 40)
      if (probe.length > 0 && !transcript.replace(/\s+/g, ' ').includes(probe)) quote = undefined
    }
    const sessionId = opts?.sessionId
    const evidence = quote !== undefined && sessionId !== undefined && sessionId.length > 0
      ? { sessionId, quote }
      : undefined
    return {
      name, title, description, type, body, scope, status,
      ...(evidence !== undefined ? { evidence } : {}),
      ...(importance !== undefined ? { importance } : {}),
    }
  } catch {
    return null
  }
}

// ---------- v0.2.0 策略:门槛、去重、可单独测试的批量应用 ----------

/** 会话是否值得固化(纯函数)。门槛取“真实 USER 轮数”与“转写总字符”。 */
export interface ConsolidationGate {
  ok: boolean
  userTurns: number
  chars: number
  reason?: 'too-few-turns' | 'too-short'
}

export function shouldConsolidate(lines: readonly string[], opts: { minTurns: number; minChars: number }): ConsolidationGate {
  const userTurns = lines.reduce((count, line) => count + (line.startsWith('USER: ') ? 1 : 0), 0)
  const chars = lines.join('\n\n').length
  if (opts.minTurns > 0 && userTurns < opts.minTurns) return { ok: false, userTurns, chars, reason: 'too-few-turns' }
  if (opts.minChars > 0 && chars < opts.minChars) return { ok: false, userTurns, chars, reason: 'too-short' }
  return { ok: true, userTurns, chars }
}

/** 归一化正文/描述用于重复比较:大小写、空白、常见标点不敏感。 */
function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[。.,，;；:：!！?？"'“”‘’`*_#>()[\]-]+/g, '')
    .trim()
}

/** 同 type+scope 且正文或描述归一后相同 → 视为重复(纯函数)。 */
export function findDuplicateCandidate(candidate: SanitizedCandidate, existingList: readonly MemoryRecord[]): MemoryRecord | undefined {
  const body = normalizeForCompare(candidate.body)
  const description = normalizeForCompare(candidate.description)
  return existingList.find(record =>
    record.type === candidate.type && record.scope === candidate.scope
    && (normalizeForCompare(record.body) === body || normalizeForCompare(record.description) === description))
}

/** 一次固化批次的去留统计(便于日志与评估语料断言)。 */
export interface ConsolidationTally {
  written: number
  created: string[]
  updated: string[]
  superseded: string[]
  duplicate: string[]
  chitchat: string[]
  lowImportance: string[]
  /** v0.6.0 价值门槛:通用名(notes/todo/misc 等)不可检索,直接丢弃。 */
  lowQuality: string[]
  invalid: number
  summaries: Array<{ name: string; result: SummaryResult }>
}

/**
 * 把一批已解析的候选应用到 store。保留原有“更新替换/矛盾取代/价值门槛/闲聊抑制”
 * 语义,v0.2.0 增加 create 前的同内容去重;抽成独立函数以便评估语料直接驱动。
 */
export async function applyConsolidationCandidates(args: {
  store: MemoryStore
  cwd: string
  candidates: readonly RawCandidate[]
  options: Pick<ConsolidationOptions, 'enableUserScope' | 'minImportance' | 'autoSummarizeMaxMemories' | 'autoSummarizeDedupe'>
  sessionId: string
  transcript: string
}): Promise<ConsolidationTally> {
  const tally: ConsolidationTally = {
    written: 0, created: [], updated: [], superseded: [], duplicate: [], chitchat: [], lowImportance: [], lowQuality: [], invalid: 0, summaries: [],
  }
  const summarize = async (name: string, raw: RawCandidate): Promise<void> => {
    const source = await args.store.read(name, 'project', args.cwd)
    if (source) tally.summaries.push({ name, result: await saveUserSummary(args.store, source, args.cwd, raw.userSummary, args.options.enableUserScope) })
  }
  // v1.0.0-rc.2：自动写入的记录也要有主题；注册表词面匹配兜底，未命中落“未归类”。
  const topicOf = (candidate: SanitizedCandidate): Promise<string> =>
    ensureTopicForText(args.store.dir(candidate.scope, args.cwd), [candidate.name, candidate.title ?? '', candidate.description, candidate.body].join('\n'))
  for (const raw of args.candidates) {
    if (tally.written >= args.options.autoSummarizeMaxMemories) break
    const candidate = sanitizeCandidate(raw, args.options.enableUserScope, { sessionId: args.sessionId, transcript: args.transcript })
    if (candidate === null) {
      tally.invalid += 1
      continue
    }
    const existingAll = (await args.store.listAll(args.cwd)).filter(record => record.scope === candidate.scope)
    // 同一性判定(0.7.0):name 锚定/精确同名/描述复述 → 更新;无匹配 → 新建。
    const decision = decideConsolidationAction(candidate, existingAll)
    if (decision.action === 'create') {
      // v1.0.0-rc.2：新记录必须带主题——命中注册表则复用，否则落到“未归类”待人工调整。
      const effectiveImportance = candidate.importance ?? DEFAULT_IMPORTANCE[candidate.type]
      if (effectiveImportance < args.options.minImportance) {
        tally.lowImportance.push(candidate.name)
        continue
      }
      if (isChitchat(candidate.body)) {
        tally.chitchat.push(candidate.name)
        continue
      }
      if (args.options.autoSummarizeDedupe) {
        const duplicate = findDuplicateCandidate(candidate, existingAll)
        if (duplicate !== undefined) {
          tally.duplicate.push(candidate.name)
          if (candidate.scope === 'project') await summarize(duplicate.name, raw)
          continue
        }
      }
      // v0.6.0 价值门槛:通用名(notes/todo/misc 等)既不可检索,也无法被后续
      // 更新/合并稳定锚定——宁可不写,让模型下次用有信息量的名字重试。
      if (isGenericName(candidate.name)) {
        tally.lowQuality.push(candidate.name)
        continue
      }
    }
    if (decision.action === 'update') {
      // #19 矛盾检测(演化谱系):强信号命中 → 新记忆先落盘(带 supersedes 指针),
      // 旧记忆转 superseded(带 supersededBy 回链);次序不可反。
      const contradictions = detectContradictions(candidate, decision.target)
      if (contradictions.length > 0) {
        // 新记忆必须用不同的文件名——同名会原地覆写旧文件。
        const baseName = candidate.name.length > 61 ? candidate.name.slice(0, 61) : candidate.name
        let newName = candidate.name === decision.target.name ? `${baseName}-v2` : candidate.name
        let attempt = 2
        while (existingAll.some(r => r.name === newName)) {
          attempt += 1
          newName = `${baseName}-v${String(attempt)}`
        }
        await args.store.write({ ...candidate, name: newName, supersedes: decision.target.name, topic: await topicOf(candidate) }, candidate.scope, args.cwd)
        try {
          const old = await args.store.read(decision.target.name, decision.target.scope, args.cwd)
          if (old !== null) {
            await args.store.write({
              name: old.name,
              ...(old.title !== undefined ? { title: old.title } : {}),
              description: old.description,
              type: old.type,
              body: old.body,
              pinned: old.pinned,
              disabled: old.disabled,
              status: 'superseded',
              supersededBy: newName,
            }, decision.target.scope, args.cwd)
          }
        } catch {
          // 半链(新已写、旧未标):不中止本批剩余候选——near-duplicate 兜底。
        }
        if (candidate.scope === 'project') await summarize(newName, raw)
        tally.superseded.push(newName)
        tally.written += 1
        continue
      }
      // update 分支不传 status/evidence:由 store.write 单点判定状态继承/降级。
      await args.store.write({
        name: decision.target.name,
        title: candidate.title ?? undefined,
        description: candidate.description,
        type: candidate.type,
        body: candidate.body,
        ...(candidate.importance !== undefined ? { importance: candidate.importance } : {}),
      }, decision.target.scope, args.cwd)
      if (candidate.scope === 'project') await summarize(decision.target.name, raw)
      tally.updated.push(decision.target.name)
      tally.written += 1
      continue
    }
    await args.store.write({ ...candidate, topic: await topicOf(candidate) }, candidate.scope, args.cwd)
    if (candidate.scope === 'project') await summarize(candidate.name, raw)
    tally.created.push(candidate.name)
    tally.written += 1
  }
  return tally
}

/**
 * 组装给固化模型的指令(含已有记忆名以避免重复)。
 * instructionsDigest(0.7.2):工作区指令链(AGENTS.md/CLAUDE.md)摘要——固化
 * 模型看不到基线消息(转写只含 user/assistant 文本),喂摘要使其知悉指令链
 * 已记载的约束,避免把"代码注释用中文"这类稳定约束再固化成记忆(分诊规则:
 * 人写稳定约束→AGENTS.md,模型动态事实→记忆,同一事实只落一处)。
 */
export function buildConsolidationPrompt(existingNames: string[], transcript: string, maxMemories: number, instructionsDigest?: string): string {
  const known = existingNames.length > 0 ? existingNames.join(', ') : '(none)'
  const instructions = instructionsDigest !== undefined && instructionsDigest.trim().length > 0
    ? `The workspace instruction files below are ALREADY injected into every session of this
user. NEVER persist anything they record — that would duplicate a constraint the user
maintains by hand in AGENTS.md/CLAUDE.md:

<workspace-instructions>
${instructionsDigest}
</workspace-instructions>

`
    : ''
  return `You are the memory-consolidation step of a coding agent. Below is a transcript
summary of a session that just ended. Extract NEW facts worth persisting across
sessions for this user, following these rules:

${instructions}- Persist: who the user is (role, expertise, durable preferences); corrections or
  confirmations about how to work; ongoing goals/constraints with absolute dates;
  external resources worth returning to.
- Do NOT persist: one-off task details, anything recoverable from the codebase or
  AGENTS.md, session-specific context, anything the workspace instructions above
  already record.
- Existing memories (do not duplicate them): ${known}
- If a fact UPDATES an existing memory, output it with that memory's EXACT
  existing name — reusing the name replaces the old version; a new name
  creates a duplicate.
- Output AT MOST ${maxMemories} items. If nothing is worth persisting, output [].
- "importance" is 1-10: 8-10 = identity/durable preferences, 5-7 = project facts
  worth keeping, 1-4 = marginal references. Be conservative, not everything is 9.

Return ONLY a JSON array, each element exactly:
{"name":"kebab-case-id","title":"short human heading","description":"one line <=160 chars","type":"user|feedback|project|reference","body":"the fact in markdown; for feedback include **Why:** and **How to apply:** lines","scope":"project","userSummary":"one short cross-project abstraction, or null if none is useful","importance":5,"evidence":"1-2 sentence VERBATIM quote from the transcript that supports this fact"}
"evidence" must be copied word-for-word from the transcript above — do not
paraphrase. If you cannot quote a supporting line, do not output that item.
Types classify CONTENT, not scope: user, feedback, project and reference all work in both scopes.
Use scope "project" for detailed facts tied to this project, environment and experience.
For EVERY project candidate provide userSummary: a single concise sentence (at most 160 characters)
that preserves its cross-project value without project-only instructions, paths, credentials,
VM configuration, addresses or implementation details. Keep full details in body.
Example: body says the user completed an Ackermann car project using a dedicated VM;
userSummary says "用户之前完成过阿克曼小车项目". Do not claim completion if it is only planned.
The plugin automatically saves this abstract in user scope with the SAME type.
Use null only when there is no useful cross-project fact; never invent a fact to fill the field.
Use scope "user" for already general, short facts of ANY of the four types. Do not output
an extra user candidate for the same project fact: userSummary supplies that layer.
Write "name" in kebab-case English; write title/description/body in the SAME
language as the transcript (a Chinese transcript gets Chinese memories —
the user will read them).

<transcript>
${transcript}
</transcript>`
}

// ---------- 会话缓冲 ----------

/** 固化只需要会话头与请求头;用具名形状避免把整个 Session 类型搬进选项。 */
interface SessionRef {
  header: { cwd?: string }
  requestHeader?: () => { config?: { provider?: string; model?: string } } | undefined
}

/** 面板需要的不只是 header/requestHeader:直接读宿主会话日志来重建对话。 */
interface LiveSessionLike extends SessionRef {
  id: string
  header: { cwd?: string; delegationDepth?: number }
  events?: readonly SessionEventLike[]
  snapshotEvents?: () => readonly SessionEventLike[]
}

interface SessionEventLike {
  type: string
  time: number
  data: unknown
}

interface SessionCapture {
  cwd: string | undefined
  lines: string[]
  /** 最近一次捕获到对话内容的时间(面板“最近活跃会话”排序用)。 */
  lastAt: number
  /** 该会话的请求头来源(provider/model 的进程内兜底,见 resolveRoute)。 */
  session?: SessionRef
}

/** 手动“立即总结”可见的候选会话。 */
export interface ConsolidationSessionInfo {
  id: string
  cwd?: string
  /** 会话标题:取第一条真实用户输入的首行(宿主会话名不在插件可见范围内)。 */
  title?: string
  lastActivityAt: number
  /** 尚未固化的行数。 */
  lines: number
}

/** 一次固化尝试的结果(手动触发需要给面板明确反馈)。 */
export type ConsolidationRunOutcome =
  | { ok: true }
  | { ok: false; reason: 'busy' | 'nothing-new' | 'unknown-session' | 'llm-unavailable' | 'llm-error' | 'aborted' | 'truncated' | 'parse-error' | 'failed' | 'too-short' }

/** 面板空状态用的进程内诊断计数(不含对话内容)。 */
export interface ConsolidationDiagnostics {
  /** 进程内有缓冲行的会话数。 */
  captures: number
  /** 已知 provider/model 路由的会话数。 */
  routes: number
  /** 宿主注册表里的活跃 agent 数。 */
  agents: number
  /** 自动总结是否开启。 */
  autoSummarize: boolean
}

/** 挂载自动固化监听(autoSummarize=false 时 no-op)。 */
/**
 * 挂载自动固化监听(autoSummarize=false 时 no-op)。
 * 返回会话通道供注入侧使用(#18 相关性截断):getQueryText 取该会话最近的
 * 真实 USER 文本(词集原料),flush 等在途固化落盘。
 */
export interface ConsolidationHandle {
  /** 最近 N 条真实 USER 输入拼接(无缓冲/未捕获 → undefined;截断防词集膨胀)。 */
  getQueryText: (sessionId: string) => string | undefined
  /** 等待在途固化落盘(测试用)。 */
  flush: () => Promise<void>
  /** 会话清理钩子(注入侧同会话清冻结词集时一并调)。 */
  cleanup: (sessionId: string) => void
  /** 自动固化的运行摘要(不保存对话内容,供面板观测)。 */
  stats: () => ConsolidationSnapshot
  /** 最近有未固化内容的会话(最多 limit 个,按活动时间倒序)。 */
  recent: (limit: number) => ConsolidationSessionInfo[]
  /** 面板“立即总结”:对指定会话跑一次固化(跳过等待,但仍过门槛)。 */
  summarize: (sessionId: SessionId) => Promise<ConsolidationRunOutcome>
  /** 面板空状态诊断:说明为什么没有候选会话(只计数,不读正文)。 */
  diagnostics: () => ConsolidationDiagnostics
}

export function registerConsolidation(ctx: Context, store: MemoryStore, options: ConsolidationOptions): ConsolidationHandle {
  const captures = new Map<string, SessionCapture>()
  const stats = new ConsolidationStats()
  // autoSummarize=false 时无固化,但仍保留 USER 捕获(#18 相关性截断的词集源,
  // 与固化开关解耦——注入侧的相关性不应依赖后台总结是否开启)
  const active = new Set<Promise<unknown>>()
  // teardown 时中止在途 LLM 调用(否则排空只能干等截断输出;审查 minor 修复)
  const abort = new AbortController()

  // v0.12.3 闲置触发:会话头不含 provider/model,路由只能在 agent/created 时取;
  // 计时器按根会话记录,只在该会话有真实对话活动时重置(注入消息不算)。
  const routes = new Map<string, { provider: string; model: string; cwd?: string }>()
  // 见过的会话引用(可能没有可固化行,例如只有工具事件):请求头是 provider/model 的兜底来源。
  const sessionRefs = new Map<string, SessionRef>()
  // 已交给模型的缓冲行数:闲置触发先跑过一段,会话结束时只固化新增部分,避免重复候选。
  const consumed = new Map<string, number>()
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const idleMs = Math.max(0, options.autoSummarizeIdleMinutes) * 60_000
  // 同一会话不允许两个固化同时跑(闲置到点与会话结束/手动点击可能撞车)。
  const running = new Set<string>()

  // 插件可能晚于宿主恢复会话才加载,agent/created 会错过;面板查询/闲置到点时
  // 再从宿主注册表补一次路由,避免“有缓冲却没有候选会话”。
  const liveAgentRoute = (sessionId: string): { provider: string; model: string; cwd?: string } | undefined => {
    try {
      const registry = (ctx as unknown as { agents?: { get?: (id: string) => unknown } }).agents
      const agent = registry?.get?.(sessionId) as
        | { options?: { provider?: string; model?: string }; session?: { header: { cwd?: string } } }
        | undefined
      const provider = agent?.options?.provider
      const model = agent?.options?.model
      if (provider === undefined || model === undefined) return undefined
      const route = { provider, model, cwd: effectiveProjectCwd(ctx, agent?.session) }
      routes.set(sessionId, route)
      return route
    } catch {
      // 注册表对已结束/未知会话可能直接抛错;路由是可选增强,不能拖垮面板查询。
      return undefined
    }
  }
  // 插件晚于会话启动时 agent/created 会错过;请求头(request/header)与最后一次请求的
  // EpochHeader 都带 provider/model,是比 agent 注册表更稳的进程内来源。
  const headerRoute = (sessionId: string): { provider: string; model: string; cwd?: string } | undefined => {
    try {
      const ref = sessionRefs.get(sessionId) ?? captures.get(sessionId)?.session
      const config = ref?.requestHeader?.()?.config
      const provider = config?.provider
      const model = config?.model
      if (provider === undefined || model === undefined) return undefined
      const route = { provider, model, cwd: captures.get(sessionId)?.cwd ?? effectiveProjectCwd(ctx, ref) }
      routes.set(sessionId, route)
      return route
    } catch {
      return undefined
    }
  }
  const resolveRoute = (sessionId: string): { provider: string; model: string; cwd?: string } | undefined =>
    routes.get(sessionId) ?? headerRoute(sessionId) ?? liveAgentRoute(sessionId)

  const clearIdle = (sessionId: string): void => {
    const timer = idleTimers.get(sessionId)
    if (timer !== undefined) {
      clearTimeout(timer)
      idleTimers.delete(sessionId)
    }
  }

  const remainingLines = (sessionId: string, cap: SessionCapture): string[] =>
    cap.lines.slice(consumed.get(sessionId) ?? 0)

  // 闲置与会话结束共用的固化主体。sessionId 是 abort/请求归属,provider/model 来自
  // agent 创建时记录的会话路由(闲置触发时没有 agent 对象可读)。
  const consolidate = async (
    sessionId: SessionId,
    cap: SessionCapture,
    provider: string,
    model: string,
    cwd: string,
  ): Promise<ConsolidationRunOutcome> => {
    if (running.has(sessionId)) return { ok: false, reason: 'busy' }
    running.add(sessionId)
    try {
      return await consolidateOnce(sessionId, cap, provider, model, cwd)
    } finally {
      running.delete(sessionId)
    }
  }

  const consolidateOnce = async (
    sessionId: SessionId,
    cap: SessionCapture,
    provider: string,
    model: string,
    cwd: string,
  ): Promise<ConsolidationRunOutcome> => {
    // v0.2.0 门槛:短会话/纯问答不值得花一次模型调用;0 表示关闭对应门槛。
    // 按整段缓冲判门槛:闲置触发过早跳过时,会话继续增长后结束仍有机会固化。
    const gate = shouldConsolidate(cap.lines, { minTurns: options.autoSummarizeMinTurns, minChars: options.autoSummarizeMinChars })
    if (!gate.ok) {
      ctx.logger.info(`[dsh-auto-memory-wh] consolidation skipped: ${gate.reason} (turns=${gate.userTurns} chars=${gate.chars})`)
      stats.record({ at: Date.now(), outcome: 'skipped', reason: gate.reason, created: 0, updated: 0, superseded: 0, skipped: 0 })
      return { ok: false, reason: 'too-short' }
    }
    const lines = remainingLines(sessionId, cap)
    if (lines.length === 0) return { ok: false, reason: 'nothing-new' } // 这一段已经固化过,不重复调用模型
    // 机会式获取 llm 服务:autoSummarize 部署(base)必有;无服务的组合(如测试栈)静默跳过
    const llm = ctx.get('llm')
    if (llm === undefined) return { ok: false, reason: 'llm-unavailable' }
    // 交给模型即视为已消费:同一段话不会在闲置窗口与会话结束各固化一遍。
    // llm-error 例外(下面提前 return),留给会话结束重试一次。
    const markConsumed = (): void => { consumed.set(sessionId, cap.lines.length) }
    try {
      const existing = await store.listAll(cwd)
      // 工作区指令链摘要(0.7.2):固化模型看不到基线消息,喂摘要防重复固化;
      // 读取失败静默降级为无摘要,绝不影响固化本身
      const digest = await collectInstructionDigest(cwd, resolveDshHome())
      const prompt = buildConsolidationPrompt(
        existing.map(r => r.name),
        lines.join('\n\n'),
        options.autoSummarizeMaxMemories,
        digest,
      )
      const assembler = new BlockAssembler()
      const request: GenerateOptions = {
        provider,
        model,
        messages: [createUserMessage({
          content: [{ type: 'text', text: prompt }],
          source: { kind: 'dsh-auto-memory-wh' },
        })],
        maxTokens: options.autoSummarizeMaxTokens,
        sessionId,
        signal: abort.signal,
      }
      for await (const chunk of llm.stream(request)) assembler.push(chunk)
      // finish 是 getter 属性(非方法);失败/中止以终止分片形式返回,不是异常
      const finish = assembler.finish
      if (finish.kind === 'error') {
        ctx.logger.warn('[dsh-auto-memory-wh] consolidation llm failed')
        stats.record({ at: Date.now(), outcome: 'llm-error', created: 0, updated: 0, superseded: 0, skipped: 0 })
        return { ok: false, reason: 'llm-error' } // 不消费:留给会话结束重试一次
      }
      if (finish.kind === 'aborted') return { ok: false, reason: 'aborted' } // teardown 中止属正常,不告警
      if (finish.kind === 'max-tokens') {
        // 审查 minor:evidence 抬高输出体积后截断边际变窄——截断会让
        // parseCandidates 找不到尾 ] 而整批丢弃,必须与"模型格式错误"可区分
        ctx.logger.warn('[dsh-auto-memory-wh] consolidation output truncated at max_tokens; raising autoSummarizeMaxTokens is recommended')
        stats.record({ at: Date.now(), outcome: 'truncated', created: 0, updated: 0, superseded: 0, skipped: 0 })
        markConsumed()
        return { ok: false, reason: 'truncated' }
      }
      const text = assembler.blocks()
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text)
        .join('\n')
      const candidates = parseCandidates(text)
      if (candidates === null) {
        ctx.logger.warn('[dsh-auto-memory-wh] consolidation output was not a JSON array; skipped')
        stats.record({ at: Date.now(), outcome: 'parse-error', created: 0, updated: 0, superseded: 0, skipped: 0 })
        markConsumed()
        return { ok: false, reason: 'parse-error' }
      }
      const tally = await applyConsolidationCandidates({
        store,
        cwd,
        candidates,
        options,
        sessionId,
        transcript: lines.join('\n\n'),
      })
      for (const item of tally.summaries) {
        if (['missing', 'invalid', 'failed', 'conflict'].includes(item.result)) ctx.logger.warn(`[dsh-auto-memory-wh] user abstract ${item.result} for ${item.name}; project detail retained`)
      }
      markConsumed()
      const skipped = tally.duplicate.length + tally.chitchat.length + tally.lowImportance.length + tally.lowQuality.length + tally.invalid
      stats.record({
        at: Date.now(),
        outcome: tally.written > 0 ? 'written' : 'nothing-written',
        created: tally.created.length,
        updated: tally.updated.length,
        superseded: tally.superseded.length,
        skipped,
      })
      if (tally.written > 0) {
        ctx.logger.info(`[dsh-auto-memory-wh] consolidated ${tally.written} memor${tally.written === 1 ? 'y' : 'ies'} (created=${tally.created.length} updated=${tally.updated.length} superseded=${tally.superseded.length})`)
      } else if (tally.duplicate.length + tally.chitchat.length + tally.lowImportance.length + tally.lowQuality.length > 0) {
        ctx.logger.info(`[dsh-auto-memory-wh] consolidation wrote nothing (duplicate=${tally.duplicate.length} chitchat=${tally.chitchat.length} low-importance=${tally.lowImportance.length} low-quality=${tally.lowQuality.length})`)
      }
      try { options.onConsolidated?.() } catch { /* 回调失败不影响固化结果 */ }
      return { ok: true }
    } catch (error) {
      ctx.logger.warn(`[dsh-auto-memory-wh] consolidation failed: ${String(error)}`)
      stats.record({ at: Date.now(), outcome: 'failed', created: 0, updated: 0, superseded: 0, skipped: 0 })
      return { ok: false, reason: 'failed' }
    }
  }

  const track = (task: Promise<unknown>): void => {
    const tracked = task.finally(() => { active.delete(tracked) })
    active.add(tracked)
  }

  /** 闲置到点:只在有未固化内容时真的调用模型;没有新内容就静默结束,等下次活动重新计时。 */
  const fireIdle = (sessionId: SessionId): void => {
    idleTimers.delete(sessionId)
    const cap = captures.get(sessionId)
    const route = resolveRoute(sessionId)
    if (cap === undefined || route === undefined) return
    if (remainingLines(sessionId, cap).length === 0) return
    const cwd = route.cwd ?? cap.cwd
    if (cwd === undefined) return
    track(consolidate(sessionId, cap, route.provider, route.model, cwd))
  }

  const scheduleIdle = (sessionId: SessionId): void => {
    if (!options.autoSummarize || idleMs <= 0 || resolveRoute(sessionId) === undefined) return
    clearIdle(sessionId)
    const timer = setTimeout(() => { fireIdle(sessionId) }, idleMs)
    timer.unref?.()
    idleTimers.set(sessionId, timer)
  }

  ctx.on('session/event', (session, event) => {
    // 子代理会话不单独固化,也不进“最近活跃会话”列表(与 agent/created 的 depth 判断一致)。
    if ((session.header.delegationDepth ?? 0) > 0) return
    sessionRefs.set(session.id, session as unknown as SessionRef)
    if (String(event.type) === 'working-directory/change') {
      // Do not carry one project's transcript or relevance terms into another.
      clearIdle(session.id)
      captures.delete(session.id)
      consumed.delete(session.id)
      return
    }
    // 任何会话事件都算“有活动”:长工具回合里没有消息事件,但工具开始/结束
    // 会重置闲置计时,避免在回合进行中固化半段对话。
    scheduleIdle(session.id)
    // 请求头/路由事件带 provider/model:插件晚于会话恢复加载时,agent/created 可能
    // 已经错过,但下一次请求的 header 仍会经过这里。
    const routeData = event.data as {
      header?: { config?: { provider?: string; model?: string } }
      provider?: string
      model?: string
    }
    const provider = routeData?.header?.config?.provider ?? routeData?.provider
    const model = routeData?.header?.config?.model ?? routeData?.model
    if (typeof provider === 'string' && typeof model === 'string') {
      routes.set(session.id, { provider, model, cwd: effectiveProjectCwd(ctx, session) })
    }
    if (event.type === 'user/message') {
      const message = event.data
      // 只捕获真实人类输入(插件注入的上下文不含持久价值)
      if (message.source?.kind !== 'user') return
      const text = captureText('user', message as { content: unknown })
      if (text === null) return
      const cap = captures.get(session.id) ?? { cwd: effectiveProjectCwd(ctx, session), lines: [], lastAt: Date.now() }
      cap.session = session as unknown as SessionRef
      cap.cwd = effectiveProjectCwd(ctx, session) ?? cap.cwd
      cap.lastAt = Date.now()
      cap.lines = appendCapped(cap.lines, `USER: ${text}`)
      captures.set(session.id, cap)
    } else if (event.type === 'assistant/message') {
      if (!options.autoSummarize) return // 固化关:只留 USER 捕获(词集),ASSISTANT 不需要
      const text = captureText('assistant', event.data.message as { content: unknown })
      if (text === null) return
      const cap = captures.get(session.id) ?? { cwd: effectiveProjectCwd(ctx, session), lines: [], lastAt: Date.now() }
      cap.session = session as unknown as SessionRef
      cap.cwd = effectiveProjectCwd(ctx, session) ?? cap.cwd
      cap.lastAt = Date.now()
      cap.lines = appendCapped(cap.lines, `ASSISTANT: ${text}`)
      captures.set(session.id, cap)
    }
  })

  // 闲置触发需要 provider/model,而会话头里没有;只能记在 agent 创建时。
  ctx.on('agent/created', ({ agent }) => {
    try {
      const depth = Math.max(agent.session.header.delegationDepth ?? 0, agent.options?.subagentDepth ?? 0)
      if (depth > 0) return // 子代理不单独固化
      const provider = agent.options?.provider
      const model = agent.options?.model
      if (provider === undefined || model === undefined) return
      routes.set(agent.session.id, { provider, model, cwd: effectiveProjectCwd(ctx, agent.session) })
    } catch {
      // 形状异常的宿主实现不应中断插件其它监听;请求头兜底仍会补路由。
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    const sessionId = agent.session.id
    clearIdle(sessionId)
    const cap = captures.get(sessionId)
    if (cap === undefined) return
    // 固化关:autoSummarize 分支整体跳过,但缓冲保留到 session/disposed
    // (#18 词集源生命周期与固化解耦,不能在此取走)
    if (!options.autoSummarize) return
    // 无论是否固化都取走缓冲:subagent 的捕获也会在此清理,否则常驻进程
    // 的 captures Map 随子代理会话无界增长(审查 major 修复)
    captures.delete(sessionId)
    // 过滤 subagent:固化只针对根会话(child 的内容会在父会话流中体现)
    const depth = Math.max(agent.session.header.delegationDepth ?? 0, agent.options?.subagentDepth ?? 0)
    const route = resolveRoute(sessionId)
    if (depth > 0) {
      consumed.delete(sessionId)
      routes.delete(sessionId)
      return
    }
    const provider = agent.options?.provider ?? route?.provider
    const model = agent.options?.model ?? route?.model
    const cwd = effectiveProjectCwd(ctx, agent.session) ?? cap.cwd
    if (provider === undefined || model === undefined || cwd === undefined) {
      consumed.delete(sessionId)
      routes.delete(sessionId)
      return
    }
    track(consolidate(sessionId, cap, provider, model, cwd))
    // consolidate 在第一个 await 前已同步取走剩余行,之后可以清理映射
    consumed.delete(sessionId)
    routes.delete(sessionId)
  })

  // 会话离开 live store 时兜底清理缓冲(agent/disposed 未覆盖的关闭路径)
  ctx.on('session/disposed', session => {
    clearIdle(session.id)
    captures.delete(session.id)
    sessionRefs.delete(session.id)
    routes.delete(session.id)
    consumed.delete(session.id)
  })

  // teardown:先中止在途 LLM 调用,再排空(emit 监听不被 await,优雅退出靠这里兜底)
  ctx.effect(function* () {
    yield async () => {
      for (const timer of idleTimers.values()) clearTimeout(timer)
      idleTimers.clear()
      abort.abort()
      await Promise.allSettled([...active])
    }
  }, 'dsh-auto-memory-wh consolidation')

  /** 宿主会话服务(机会式获取;不可见时退回进程内缓冲)。 */
  const sessionStore = (): { list?: () => unknown[]; get?: (id: string) => unknown } | undefined => {
    try {
      return (ctx as unknown as {
        get?: (name: string) => { list?: () => unknown[]; get?: (id: string) => unknown } | undefined
      }).get?.('sessions')
    } catch {
      return undefined
    }
  }

  /**
   * 从仍在内存里的会话日志重建可固化文本。
   * 这是“总结”的可靠来源:插件晚于会话恢复加载、或 session/event 未送达时,
   * 缓冲为空,但宿主内存里的会话日志始终完整。
   */
  const transcriptOf = (session: LiveSessionLike): { lines: string[]; lastAt: number; cwd?: string } | undefined => {
    let events: readonly SessionEventLike[]
    try {
      events = session.snapshotEvents?.() ?? session.events ?? []
    } catch {
      return undefined
    }
    let lines: string[] = []
    let lastAt = 0
    for (const event of events) {
      try {
        if (event.type === 'user/message') {
          const data = event.data as { source?: { kind?: string }; content: unknown }
          if (data?.source?.kind !== 'user') continue
          const text = captureText('user', data)
          if (text === null) continue
          lines = appendCapped(lines, `USER: ${text}`)
          lastAt = Math.max(lastAt, event.time)
        } else if (event.type === 'assistant/message' && options.autoSummarize) {
          const data = event.data as { message?: { content: unknown }; content: unknown }
          const text = captureText('assistant', data?.message ?? data)
          if (text === null) continue
          lines = appendCapped(lines, `ASSISTANT: ${text}`)
          lastAt = Math.max(lastAt, event.time)
        }
      } catch {
        // 单条事件形状异常不影响整段对话的重建。
      }
    }
    if (lines.length === 0) return undefined
    let cwd: string | undefined
    try {
      cwd = effectiveProjectCwd(ctx, session as never)
    } catch {
      cwd = session.header?.cwd
    }
    return { lines, lastAt: lastAt || Date.now(), cwd: cwd ?? session.header?.cwd }
  }

  /**
   * 面板候选会话的标题:取第一条真实 USER 输入的首行并截断。
   * 宿主的会话名只存在于客户端状态,插件侧不可见;用首句命名既稳定又接近用户认知。
   */
  const deriveSessionTitle = (lines: readonly string[]): string | undefined => {
    for (const line of lines) {
      if (!line.startsWith('USER: ')) continue
      const text = line.slice('USER: '.length).replace(/\s+/g, ' ').trim()
      if (text.length === 0) continue
      return text.length > 24 ? `${text.slice(0, 24)}…` : text
    }
    return undefined
  }

  /** 会话请求头里的模型路由(直接读 live 会话,不依赖事件流)。 */
  const routeOf = (session: LiveSessionLike): { provider: string; model: string; cwd?: string } | undefined => {
    try {
      const config = session.requestHeader?.()?.config
      if (typeof config?.provider !== 'string' || typeof config?.model !== 'string') return undefined
      const route = { provider: config.provider, model: config.model, cwd: session.header?.cwd }
      routes.set(session.id, route)
      return route
    } catch {
      return undefined
    }
  }

  /**
   * 面板“总结”浮层的候选会话:宿主内存里、有对话内容、且拿得到模型路由的会话。
   * 优先读会话服务(重启后仍可用);服务不可见时退回事件缓冲。
   */
  const recent = (limit: number): ConsolidationSessionInfo[] => {
    if (!options.autoSummarize) return []
    const rows: ConsolidationSessionInfo[] = []
    const store = sessionStore()
    if (store?.list !== undefined) {
      let sessions: unknown[] = []
      try {
        sessions = store.list()
      } catch {
        sessions = []
      }
      for (const raw of sessions) {
        const session = raw as LiveSessionLike
        try {
          if (typeof session?.id !== 'string') continue
          if ((session.header?.delegationDepth ?? 0) > 0) continue
          const transcript = transcriptOf(session)
          if (transcript === undefined) continue
          const pending = transcript.lines.length - (consumed.get(session.id) ?? 0)
          if (pending <= 0) continue
          rows.push({
            id: session.id,
            cwd: transcript.cwd ?? session.header?.cwd,
            title: deriveSessionTitle(transcript.lines),
            lastActivityAt: transcript.lastAt,
            lines: pending,
          })
        } catch {
          // 单个会话形状异常不应清空整个列表。
        }
      }
    } else {
      for (const [id, cap] of captures) {
        if (resolveRoute(id) === undefined) continue
        const lines = remainingLines(id, cap).length
        if (lines === 0) continue
        rows.push({ id, cwd: cap.cwd, title: deriveSessionTitle(cap.lines), lastActivityAt: cap.lastAt, lines })
      }
    }
    rows.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    return rows.slice(0, Math.max(0, limit))
  }

  /** 面板“立即总结”:不等待闲置窗口,但仍然过门槛、仍然只固化未消费的行。 */
  const summarize = async (sessionId: SessionId): Promise<ConsolidationRunOutcome> => {
    const store = sessionStore()
    let live: LiveSessionLike | undefined
    try {
      live = store?.get?.(sessionId) as LiveSessionLike | undefined
    } catch {
      live = undefined
    }
    if (live !== undefined) {
      if ((live.header?.delegationDepth ?? 0) > 0) return { ok: false, reason: 'unknown-session' }
      const transcript = transcriptOf(live)
      if (transcript === undefined) return { ok: false, reason: 'nothing-new' }
      const route = resolveRoute(sessionId) ?? routeOf(live)
      if (route === undefined) return { ok: false, reason: 'llm-unavailable' }
      const cwd = route.cwd ?? transcript.cwd
      if (cwd === undefined) return { ok: false, reason: 'unknown-session' }
      const cap: SessionCapture = {
        cwd,
        lines: transcript.lines,
        lastAt: transcript.lastAt,
        session: live,
      }
      return consolidate(sessionId, cap, route.provider, route.model, cwd)
    }
    const cap = captures.get(sessionId)
    const route = resolveRoute(sessionId)
    if (cap === undefined || route === undefined) return { ok: false, reason: 'unknown-session' }
    const cwd = route.cwd ?? cap.cwd
    if (cwd === undefined) return { ok: false, reason: 'unknown-session' }
    return consolidate(sessionId, cap, route.provider, route.model, cwd)
  }

  const agentCount = (): number => {
    try {
      return ((ctx as unknown as { agents?: { list?: () => unknown[] } }).agents?.list?.() ?? []).length
    } catch {
      return 0
    }
  }

  /** 宿主内存里的根会话数(诊断用;服务不可见时退回缓冲数量)。 */
  const liveRootSessions = (): LiveSessionLike[] => {
    const store = sessionStore()
    if (store?.list === undefined) return []
    try {
      return store.list().filter((raw): raw is LiveSessionLike => {
        const session = raw as LiveSessionLike
        return typeof session?.id === 'string' && (session.header?.delegationDepth ?? 0) === 0
      })
    } catch {
      return []
    }
  }

  /** 面板空状态诊断:说明“没有可总结的会话”是没缓冲、没路由还是没活跃 agent。 */
  const diagnostics = (): ConsolidationDiagnostics => {
    const sessions = liveRootSessions()
    return {
      captures: sessions.length > 0 ? sessions.length : captures.size,
      // 能解析出模型路由的会话数(顺带把请求头/注册表来源的结果写回缓存)。
      routes: sessions.length > 0
        ? sessions.filter(session => resolveRoute(session.id) ?? routeOf(session)).length
        : [...captures.keys()].filter(sessionId => resolveRoute(sessionId) !== undefined).length,
      agents: agentCount(),
      autoSummarize: options.autoSummarize,
    }
  }

  return {
    // 词集原料:最近 6 条 USER 行(剥前缀),拼接截 1200 字符防词集膨胀
    getQueryText: sessionId => {
      const cap = captures.get(sessionId)
      if (cap === undefined) return undefined
      const userLines = cap.lines.filter(line => line.startsWith('USER: ')).slice(-6)
      if (userLines.length === 0) return undefined
      return userLines.map(line => line.slice('USER: '.length)).join('\n').slice(0, 1200)
    },
    flush: () => Promise.allSettled([...active]).then(() => undefined),
    cleanup: sessionId => {
      clearIdle(sessionId)
      captures.delete(sessionId)
      sessionRefs.delete(sessionId)
      consumed.delete(sessionId)
    },
    stats: () => stats.snapshot(options.autoSummarize, options.autoSummarizeIdleMinutes),
    recent,
    summarize,
    diagnostics,
  }
}

// probe 1793306596
