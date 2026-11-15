/** Independent identity; upstream provenance remains in LICENSE and UPSTREAM.md. */
export const PACKAGE_NAME = 'dsh-auto-memory-wh'
/**
 * Release version. Must equal package.json "version"; tests/version.spec.ts
 * fails when they diverge, so release bumps cannot leave audit/snapshot
 * records claiming an older candidate.
 */
export const PLUGIN_VERSION = '1.0.0'
export const PLUGIN_ID = 'auto-memory-wh'
export const API_BASE = '/api/auto-memory-wh'
export const LOCALE_NAMESPACE = 'autoMemoryWH'
export const MEMORY_SECTION_NAME = 'memory-wh:index'
/** v0.5.0 到期任务提醒段(与长期事实索引分开,便于独立降级/静音)。 */
export const TASK_SECTION_NAME = 'memory-wh:tasks'
export const DEFAULT_DATA_DIRECTORY = 'memory-wh'
export const MEMORY_TOOL_NAMES = [
  'memory_write', 'memory_read', 'memory_list', 'memory_search', 'memory_delete',
] as const
