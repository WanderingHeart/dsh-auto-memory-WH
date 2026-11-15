import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { PROJECT_FILE } from './storage-safety.ts'
import { projectKey } from './store.ts'

const ARCHIVE_ROOT = '_archive'
const INTERNAL_FILES = new Set(['MEMORY.md', '.wh-transaction.json', PROJECT_FILE])

export interface ProjectSummary {
  directory: string
  cwd: string | null
  records: number
  latestModifiedMs: number | null
}

export interface ProjectInventory {
  root: string
  projects: ProjectSummary[]
  skipped: Array<{ directory: string; reason: string }>
}

const SKIP_DIRECTORIES = new Set(['_user', '.backups', 'node_modules'])

function isScopeDirectory(name: string): boolean {
  return !name.startsWith('_') && !SKIP_DIRECTORIES.has(name)
}

/**
 * Read-only inventory of project scopes under a memory root. Never follows links and never
 * writes. A directory without a valid `.wh-project.json` is not a project scope.
 */
export function listProjects(root: string): ProjectInventory {
  const skipped: ProjectInventory['skipped'] = []
  let names: string[]
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && isScopeDirectory(entry.name))
      .map(entry => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { root, projects: [], skipped }
    throw error
  }

  const projects: ProjectSummary[] = []
  for (const name of names) {
    const directory = join(root, name)
    const marker = join(directory, PROJECT_FILE)
    let cwd: string | null = null
    try {
      const parsed = JSON.parse(readFileSync(marker, 'utf8')) as { version?: unknown; cwd?: unknown }
      if (parsed.version !== 1 || typeof parsed.cwd !== 'string' || parsed.cwd.length === 0) throw new Error('invalid project marker')
      cwd = parsed.cwd
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      skipped.push({ directory: name, reason: error instanceof Error ? error.message : 'invalid project marker' })
      continue
    }

    let records = 0
    let latestModifiedMs: number | null = null
    try {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'MEMORY.md') continue
        records += 1
        const modified = statSync(join(directory, entry.name)).mtimeMs
        if (latestModifiedMs === null || modified > latestModifiedMs) latestModifiedMs = modified
      }
    } catch (error) {
      skipped.push({ directory: name, reason: error instanceof Error ? error.message : 'unreadable project directory' })
      continue
    }
    projects.push({ directory: name, cwd, records, latestModifiedMs })
  }

  projects.sort((a, b) => (b.latestModifiedMs ?? 0) - (a.latestModifiedMs ?? 0) || a.directory.localeCompare(b.directory))
  return { root, projects, skipped }
}

export interface RemapOptions {
  root: string
  fromCwd?: string
  fromDirectory?: string
  toCwd: string
  writersStopped: boolean
}

export interface RemapResult {
  fromDirectory: string
  toDirectory: string
  fromCwd: string
  toCwd: string
  records: number
}

function samePath(a: string, b: string): boolean {
  return resolve(a) === resolve(b)
}

function readProjectMarker(directory: string): { cwd: string } {
  const parsed = JSON.parse(readFileSync(join(directory, PROJECT_FILE), 'utf8')) as { version?: unknown; cwd?: unknown }
  if (parsed.version !== 1 || typeof parsed.cwd !== 'string' || parsed.cwd.length === 0) throw new Error('invalid project marker')
  return { cwd: parsed.cwd }
}

/** Rewrite the project mapping atomically so a moved/renamed working directory keeps its scope. */
export function remapProject(options: RemapOptions): RemapResult {
  if (options.writersStopped !== true) throw new Error('Stop writers before remapping a project')
  if (typeof options.toCwd !== 'string' || !isAbsolute(options.toCwd)) throw new Error('toCwd must be an absolute path')

  const root = options.root
  const fromDirectory = options.fromDirectory
    ? options.fromDirectory
    : options.fromCwd ? projectKey(options.fromCwd) : undefined
  if (!fromDirectory) throw new Error('fromCwd or fromDirectory is required')

  const sourceDir = join(root, fromDirectory)
  if (!existsSync(sourceDir)) throw new Error('Project scope not found')
  const marker = readProjectMarker(sourceDir)
  if (options.fromCwd !== undefined && !samePath(marker.cwd, options.fromCwd)) {
    throw new Error('Project mapping does not match the requested cwd')
  }
  if (samePath(marker.cwd, options.toCwd)) {
    throw new Error('Project target is already mapped')
  }

  const toDirectory = projectKey(options.toCwd)
  const targetDir = join(root, toDirectory)
  if (existsSync(targetDir) && !samePath(targetDir, sourceDir)) throw new Error('Project directory collision: target already exists')

  let records = 0
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'MEMORY.md') records += 1
  }

  if (!samePath(targetDir, sourceDir)) renameSync(sourceDir, targetDir)
  const markerPath = join(targetDir, PROJECT_FILE)
  const temporary = `${markerPath}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify({ version: 1, cwd: options.toCwd }, null, 2) + '\n')
  renameSync(temporary, markerPath)
  return { fromDirectory, toDirectory, fromCwd: marker.cwd, toCwd: options.toCwd, records }
}

export interface MergeOptions {
  root: string
  fromCwd?: string
  fromDirectory?: string
  intoCwd: string
  intoDirectory?: string
  writersStopped: boolean
  skipIdentical?: boolean
}

export interface MergeResult {
  fromDirectory: string
  intoDirectory: string
  copied: number
  skippedIdentical: number
  skippedInternal: number
  removedSource: boolean
}

function resolveScope(root: string, cwd: string | undefined, directory: string | undefined, label: string): { directory: string; cwd: string; dir: string } {
  const directoryName = directory ?? (cwd === undefined ? undefined : projectKey(cwd))
  if (!directoryName) throw new Error(`${label}: fromCwd/fromDirectory is required`)
  const dir = join(root, directoryName)
  if (!existsSync(dir)) throw new Error('Project scope not found')
  const marker = readProjectMarker(dir)
  if (cwd !== undefined && !samePath(marker.cwd, cwd)) throw new Error('Project mapping does not match the requested cwd')
  return { directory: directoryName, cwd: marker.cwd, dir }
}

function sameBytes(a: string, b: string): boolean {
  try {
    return readFileSync(a).equals(readFileSync(b))
  } catch {
    return false
  }
}

function isInternal(name: string): boolean {
  return INTERNAL_FILES.has(name) || name.endsWith('.lock') || name.endsWith('.tmp')
}

/**
 * Merge one project scope into another. Copies first, verifies the destination bytes, and only
 * then removes the source; collisions abort before deletion. `skipIdentical` skips byte-identical
 * duplicates and still rejects any differing collision.
 */
export function mergeProjects(options: MergeOptions): MergeResult {
  if (options.writersStopped !== true) throw new Error('Stop writers before merging project scopes')
  if (typeof options.intoCwd !== 'string' || !isAbsolute(options.intoCwd)) throw new Error('intoCwd must be an absolute path')

  const source = resolveScope(options.root, options.fromCwd, options.fromDirectory, 'merge')
  const target = resolveScope(options.root, options.intoCwd, options.intoDirectory, 'merge')
  if (samePath(source.dir, target.dir)) throw new Error('Cannot merge a project scope into itself')

  let copied = 0
  let skippedIdentical = 0
  let skippedInternal = 0
  const pending: Array<{ from: string; to: string }> = []

  const walk = (fromDir: string, toDir: string): void => {
    for (const entry of readdirSync(fromDir, { withFileTypes: true })) {
      const from = join(fromDir, entry.name)
      const to = join(toDir, entry.name)
      if (entry.isDirectory()) {
        mkdirSync(to, { recursive: true })
        walk(from, to)
        continue
      }
      if (isInternal(entry.name)) {
        skippedInternal += 1
        continue
      }
      if (existsSync(to)) {
        if (options.skipIdentical && sameBytes(from, to)) {
          skippedIdentical += 1
          continue
        }
        throw new Error(`Project merge collision on ${entry.name}`)
      }
      copyFileSync(from, to)
      pending.push({ from, to })
      copied += 1
    }
  }
  walk(source.dir, target.dir)

  for (const pair of pending) {
    if (!sameBytes(pair.from, pair.to)) throw new Error('Project merge verification failed')
  }
  rmSync(source.dir, { recursive: true, force: true })
  return { fromDirectory: source.directory, intoDirectory: target.directory, copied, skippedIdentical, skippedInternal, removedSource: true }
}

export interface ArchiveOptions {
  root: string
  fromCwd?: string
  fromDirectory?: string
  writersStopped: boolean
}

export interface ArchiveResult {
  fromDirectory: string
  archiveDirectory: string
  records: number
}

/**
 * Retire a project scope by moving it under `<root>/_archive/projects/`. The moved directory keeps
 * its marker and records; restore by moving it back and updating `.wh-project.json` if needed.
 */
export function archiveProject(options: ArchiveOptions): ArchiveResult {
  if (options.writersStopped !== true) throw new Error('Stop writers before archiving a project scope')
  const source = resolveScope(options.root, options.fromCwd, options.fromDirectory, 'archive')

  let records = 0
  for (const entry of readdirSync(source.dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'MEMORY.md') records += 1
  }

  const archiveRoot = join(options.root, ARCHIVE_ROOT, 'projects')
  mkdirSync(archiveRoot, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const archiveDirectory = `${source.directory}-${stamp}`
  const archivePath = join(archiveRoot, archiveDirectory)
  if (existsSync(archivePath)) throw new Error('Project archive path already exists')
  renameSync(source.dir, archivePath)
  return { fromDirectory: source.directory, archiveDirectory, records }
}
