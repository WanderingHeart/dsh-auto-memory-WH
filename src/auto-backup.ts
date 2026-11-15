import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { recordBackup } from './metrics.ts'

export interface AutoBackupSettings { intervalHours: number; keep: number }
export interface AutoBackupEntry { dir: string; createdAt: string; files: number; bytes: number }
export interface AutoBackupState { last: AutoBackupEntry | null; due: boolean; existing: AutoBackupEntry[] }

const AUTO_DIR = join('.backups', 'auto')
const SKIPPED = new Set(['.wh-writer.lock', 'audit.jsonl.lock', 'MEMORY.md.lock'])

function sha256(data: Buffer): string { return createHash('sha256').update(data).digest('hex') }

async function autoRoot(root: string): Promise<string> { return join(root, AUTO_DIR) }

async function entries(root: string): Promise<AutoBackupEntry[]> {
  const dir = await autoRoot(root)
  let names: string[]
  try { names = await readdir(dir) } catch { return [] }
  const result: AutoBackupEntry[] = []
  for (const name of names.filter(name => name.startsWith('auto-'))) {
    const path = join(dir, name)
    try {
      const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')) as { createdAt: string; files: Array<{ bytes: number }> }
      result.push({ dir: path, createdAt: manifest.createdAt, files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0) })
    } catch { /* incomplete or foreign directory is ignored */ }
  }
  return result.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function autoBackupState(root: string, settings: AutoBackupSettings, now = Date.now()): Promise<AutoBackupState> {
  const existing = await entries(root)
  const last = existing[0] ?? null
  const due = last === null || now - Date.parse(last.createdAt) >= settings.intervalHours * 3_600_000
  return { last, due, existing }
}

async function collect(root: string, dir: string, out: string[]): Promise<void> {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (dir === root && item.name === '.backups') continue
    const path = join(dir, item.name)
    if (item.isDirectory()) { await collect(root, path, out); continue }
    if (!item.isFile() || SKIPPED.has(item.name) || item.name.endsWith('.tmp') || item.name === '.wh-transaction.json') continue
    out.push(relative(root, path))
  }
}

/** Best-effort copy of the memory tree. Not an offline snapshot: concurrent writers may interleave files. */
export async function runAutoBackup(root: string, settings: AutoBackupSettings, hostBuild = 'not-specified', now = new Date()): Promise<AutoBackupEntry> {
  const files: string[] = []
  await collect(root, root, files)
  files.sort()
  const createdAt = now.toISOString()
  const dir = join(await autoRoot(root), 'auto-' + createdAt.replace(/[:.]/g, '-'))
  await mkdir(dir, { recursive: true })
  const manifest: Array<{ path: string; bytes: number; sha256: string }> = []
  for (const path of files) {
    const data = await readFile(join(root, path))
    const target = join(dir, ...path.split(sep))
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, data)
    manifest.push({ path: path.split(sep).join('/'), bytes: data.length, sha256: sha256(data) })
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ createdAt, hostBuild, files: manifest }, null, 2))
  const existing = await entries(root)
  const stale = existing.filter(entry => entry.dir !== dir).slice(Math.max(0, settings.keep - 1))
  for (const entry of stale) await rm(entry.dir, { recursive: true, force: true })
  recordBackup(1)
  return { dir, createdAt, files: manifest.length, bytes: manifest.reduce((sum, file) => sum + file.bytes, 0) }
}

export async function autoBackupStatus(root: string, settings: AutoBackupSettings, now = Date.now()): Promise<AutoBackupState> {
  return autoBackupState(root, settings, now)
}

export async function pruneAutoBackups(root: string, keep: number): Promise<string[]> {
  const existing = await entries(root)
  const stale = existing.slice(Math.max(0, keep))
  for (const entry of stale) await rm(entry.dir, { recursive: true, force: true })
  return stale.map(entry => entry.dir)
}

export async function ensureAutoRoot(root: string): Promise<void> {
  await mkdir(join(root, AUTO_DIR), { recursive: true })
}

export async function autoBackupMtime(root: string): Promise<number | null> {
  try { return (await stat(join(root, AUTO_DIR))).mtimeMs } catch { return null }
}
