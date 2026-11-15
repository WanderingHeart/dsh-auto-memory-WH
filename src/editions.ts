/**
 * v0.12.0 版本分级（roadmap 1.5）：三档配置开关，不分叉存储格式。
 *
 * 三档读同一份 memory-wh；差异只在注入预算、可选功能与后台任务，
 * 不改变信任状态与审核语义。默认 full，保持既有行为不变。
 */

export type Edition = 'minimal' | 'standard' | 'full'

export const EDITIONS: readonly Edition[] = ['minimal', 'standard', 'full']

export interface EditionFeatures {
  /** `memory_remind` 工具与原生提醒入口。 */
  reminders: boolean
  /** 会话结束自动固化（写入仍是 candidate）。 */
  autoSummarize: boolean
  /** 定时把记忆树复制到 .backups/auto。 */
  autoBackup: boolean
  /** 近重复与合并（duplicates / mergeSuggest / merge）。 */
  merge: boolean
  /** 关系图（relatedness.graph 与面板）。 */
  graph: boolean
  /** 导出套装 / 导入 / Markdown 导出。 */
  importExport: boolean
  /** 迁移检查（migration.status）。 */
  migration: boolean
  /** 批量审核 / 批量操作。 */
  batch: boolean
}

export interface EditionProfile {
  edition: Edition
  label: string
  note: string
  /** 建议的索引注入预算（字节）；实际仍以配置 maxBytes 为准。 */
  maxBytes: number
  /** 建议的审计保留预算（字节）。 */
  auditMaxBytes: number
  features: EditionFeatures
}

const MINIMAL_FEATURES: EditionFeatures = {
  reminders: false,
  autoSummarize: false,
  autoBackup: false,
  merge: false,
  graph: false,
  importExport: false,
  migration: false,
  batch: false,
}

const STANDARD_FEATURES: EditionFeatures = {
  ...MINIMAL_FEATURES,
  reminders: true,
  autoSummarize: true,
  autoBackup: true,
  merge: true,
  importExport: true,
  migration: true,
}

const FULL_FEATURES: EditionFeatures = {
  ...STANDARD_FEATURES,
  graph: true,
  batch: true,
}

export const EDITION_PROFILES: Record<Edition, EditionProfile> = {
  minimal: {
    edition: 'minimal',
    label: '低功能版',
    note: '只保留索引注入与五工具；关闭自动固化、备份、合并、图谱与导入导出。',
    maxBytes: 2048,
    auditMaxBytes: 262144,
    features: MINIMAL_FEATURES,
  },
  standard: {
    edition: 'standard',
    label: '中功能版',
    note: '日常可用：提醒、低噪声自动固化、备份、合并与迁移；不含关系图和批量操作。',
    maxBytes: 4096,
    auditMaxBytes: 1048576,
    features: STANDARD_FEATURES,
  },
  full: {
    edition: 'full',
    label: '全功能版',
    note: '当前开发线的完整能力（含关系图与批量操作）。',
    maxBytes: 4096,
    auditMaxBytes: 1048576,
    features: FULL_FEATURES,
  },
}

export function isEdition(value: unknown): value is Edition {
  return value === 'minimal' || value === 'standard' || value === 'full'
}

export function editionProfile(edition: Edition): EditionProfile {
  return EDITION_PROFILES[edition] ?? EDITION_PROFILES.full
}

export function editionFeatures(edition: Edition): EditionFeatures {
  return { ...editionProfile(edition).features }
}
