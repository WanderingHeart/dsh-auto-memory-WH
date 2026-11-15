/**
 * v1.0.0-rc.5:提醒落点的相关性路由(roadmap 1.3)。
 *
 * 边界(与路线图登记一致):
 * - 默认仍投递创建提醒的会话;
 * - 只按“提醒文字里能读到的证据”改落点:命中另一个已知项目 → 新会话并带该项目 cwd;
 * - 同时命中本会话和其他项目 → 不猜,交回调用方先询问;
 * - 不自动新开会话、不静默改 target;任何改落点都带 reason。
 */
import { tokenize } from './relatedness.ts'

export type ReminderRouteTarget = 'current' | 'new_once' | 'ask'
export type ReminderRouteRequest = 'auto' | 'current' | 'new'

export interface KnownProject {
  cwd: string
  label?: string
}

export interface ReminderRouteInput {
  /** 提醒标题与附注拼成的可读文本。 */
  text: string
  sessionId?: string
  currentCwd?: string
  /** 当前 scope 主题注册表里的标题,用来判断“和本会话主题相关”。 */
  currentTopics?: string[]
  requested?: ReminderRouteRequest
  knownProjects?: KnownProject[]
  /** 会话已归档时宿主无法投递,直接降级新会话。 */
  archived?: boolean
}

export interface ReminderRouteDecision {
  target: ReminderRouteTarget
  cwd?: string
  reason: string
  question?: string
}

const normalizePath = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

const labelOf = (project: KnownProject): string => {
  const explicit = project.label?.trim()
  if (explicit) return explicit
  const segments = project.cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  return segments[segments.length - 1] ?? project.cwd
}

const sharedTokens = (left: Set<string>, right: Set<string>): number => {
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return shared
}

/** 项目名/路径里的连字符与下划线按分隔符处理，避免整串被当成一个 token。 */
const tokensOf = (value: string): Set<string> => tokenize(value.replace(/[-_]+/g, ' '))

/** 项目名整串命中,或至少两个项目名 token 同时命中(避免把 “memory” 这种通用词当项目)。 */
function mentions(text: string, textTokens: Set<string>, project: KnownProject): boolean {
  const label = labelOf(project)
  if (label.length >= 3 && text.toLowerCase().includes(label.toLowerCase())) return true
  const labelTokens = tokensOf(label)
  return labelTokens.size >= 2 && sharedTokens(labelTokens, textTokens) >= 2
}

export function decideReminderRoute(input: ReminderRouteInput): ReminderRouteDecision {
  const requested = input.requested ?? 'auto'
  const projects = (input.knownProjects ?? []).filter(project => typeof project.cwd === 'string' && project.cwd.length > 0)
  const current = input.currentCwd ? normalizePath(input.currentCwd) : undefined
  const others = projects.filter(project => normalizePath(project.cwd) !== current)
  const textTokens = tokensOf(input.text)
  const matched = others.filter(project => mentions(input.text, textTokens, project))

  if (requested === 'new') {
    const explicit = matched[0]
    return {
      target: 'new_once',
      ...(explicit ? { cwd: explicit.cwd } : {}),
      reason: explicit ? `explicit-new:${labelOf(explicit)}` : 'explicit-new',
    }
  }
  if (!input.sessionId) return { target: 'new_once', reason: 'no-session' }
  if (requested === 'current') return { target: 'current', reason: 'explicit-current' }
  if (input.archived) {
    return {
      target: 'new_once',
      ...(input.currentCwd ? { cwd: input.currentCwd } : {}),
      reason: 'archived-session',
    }
  }

  const contextTokens = tokensOf([input.currentCwd ?? '', ...(input.currentTopics ?? [])].join(' '))
  const currentHit = sharedTokens(textTokens, contextTokens) > 0

  if (matched.length === 1) {
    if (currentHit) {
      return {
        target: 'ask',
        reason: `ambiguous:${labelOf(matched[0])}`,
        question: `这条提醒同时和本会话以及“${labelOf(matched[0])}”有关。要在本会话提醒，还是新开一个会话？`,
      }
    }
    return { target: 'new_once', cwd: matched[0].cwd, reason: `other-project:${labelOf(matched[0])}` }
  }
  if (matched.length > 1) {
    return {
      target: 'ask',
      reason: 'ambiguous-projects',
      question: `这条提醒提到了多个项目（${matched.map(labelOf).join('、')}）。要在本会话提醒，还是新开一个会话？`,
    }
  }
  return { target: 'current', reason: 'default-current' }
}
