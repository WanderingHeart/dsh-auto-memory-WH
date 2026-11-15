import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isEdition, type Edition } from './editions.ts'

/** v0.12.1:插件级设置文件,与记忆记录分开存放;只保存运行开关,不保存记忆内容。 */
export const SETTINGS_FILENAME = 'settings.json'

export interface PluginSettings {
  version: 1
  /** 面板切换后的功能档位;缺省时回落到插件配置。 */
  edition?: Edition
}

export function settingsPath(root: string): string {
  return join(root, SETTINGS_FILENAME)
}

export function loadSettings(root: string): PluginSettings {
  const file = settingsPath(root)
  if (!existsSync(file)) return { version: 1 }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown; edition?: unknown }
    const settings: PluginSettings = { version: 1 }
    if (isEdition(parsed.edition)) settings.edition = parsed.edition
    return settings
  } catch {
    // 坏文件按“没有设置”处理,绝不阻断插件加载。
    return { version: 1 }
  }
}

export function saveSettings(root: string, patch: Partial<PluginSettings>): PluginSettings {
  const next: PluginSettings = { ...loadSettings(root), ...patch, version: 1 }
  const file = settingsPath(root)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, file)
  return next
}

export function readEditionOverride(root: string): Edition | undefined {
  return loadSettings(root).edition
}

export function saveEditionOverride(root: string, edition: Edition): void {
  saveSettings(root, { edition })
}
