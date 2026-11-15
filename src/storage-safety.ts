import { promises as fs, lstatSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { PLUGIN_VERSION } from './identity.ts'

export const FORMAT_FILE = '.wh-format.json'
export const ROOT_LOCK = '.wh-writer'
export const JOURNAL = '.wh-transaction.json'
export const PROJECT_FILE = '.wh-project.json'
export const MAX_FILE_BYTES = 1024 * 1024
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024
export const MAX_FILES = 4096
export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')
export const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException)?.code

/** No lexical aliases, ADS, device filenames or link traversal in managed paths. */
export function safeRelative(value: string): string {
  if (!value || isAbsolute(value) || value.includes('\\') || value.includes('\0')) throw new Error('Unsafe relative path')
  for (const part of value.split('/')) {
    if (!part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) throw new Error('Unsafe path component')
  }
  return value
}

export function absoluteRoot(value: string): string {
  if (!isAbsolute(value) || value.includes('\0') || /^\\\\[?.]/.test(value)) throw new Error('An ordinary absolute path is required')
  const root = resolve(value)
  if (root === parse(root).root) throw new Error('Filesystem root is not a data directory')
  const tail = root.slice(parse(root).root.length).split(sep).join('/')
  safeRelative(tail)
  return root
}

export function assertNoLinksSync(value: string): void {
  let current = resolve(value)
  for (;;) {
    try { if (lstatSync(current).isSymbolicLink()) throw new Error('Symbolic links/junctions are not allowed in storage paths') }
    catch (error) { if (errorCode(error) !== 'ENOENT') throw error }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}

export function inside(root: string, value: string): string {
  const result = resolve(root, safeRelative(value))
  const rel = relative(root, result)
  if (rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) throw new Error('Path escapes root')
  assertNoLinksSync(result)
  return result
}

export async function readRegular(file: string, max = MAX_FILE_BYTES): Promise<Buffer> {
  assertNoLinksSync(file)
  const before = await fs.lstat(file)
  if (!before.isFile() || before.size > max) throw new Error('Expected a bounded regular file')
  const handle = await fs.open(file, 'r')
  try {
    const actual = await handle.stat()
    if (!actual.isFile() || actual.dev !== before.dev || actual.ino !== before.ino || actual.size > max) throw new Error('File changed during open')
    const data = await handle.readFile()
    const after = await handle.stat()
    assertNoLinksSync(file)
    if (data.length > max || actual.size !== after.size || actual.mtimeMs !== after.mtimeMs) throw new Error('File changed during read')
    return data
  } finally { await handle.close() }
}

/** Flush contents before same-directory replacement. Directory fsync is best effort on Windows. */
export async function durableWrite(file: string, data: string | Buffer): Promise<void> {
  assertNoLinksSync(file)
  await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 })
  assertNoLinksSync(file)
  const temp = file + '.' + randomUUID() + '.tmp'
  const handle = await fs.open(temp, 'wx', 0o600)
  try {
    try { await handle.writeFile(data); await handle.sync() } finally { await handle.close() }
    assertNoLinksSync(file); await fs.rename(temp, file)
  }
  catch (error) { await fs.rm(temp, { force: true }); throw error }
  try { const dir = await fs.open(dirname(file), 'r'); try { await dir.sync() } finally { await dir.close() } } catch { /* Windows may not support directory fsync. */ }
}

export interface FileImage { path: string; bytes: number; hash: string; data: string }
export function image(path: string, data: Buffer): FileImage { return { path, bytes: data.length, hash: sha256(data), data: data.toString('base64') } }
export function decodeImage(item: FileImage): Buffer {
  safeRelative(item.path)
  if (typeof item.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.data)) throw new Error('Invalid encoded file')
  const data = Buffer.from(item.data, 'base64')
  if (data.length !== item.bytes || data.length > MAX_FILE_BYTES || sha256(data) !== item.hash) throw new Error('File checksum mismatch')
  return data
}

export async function captureScope(dir: string): Promise<FileImage[]> {
  assertNoLinksSync(dir)
  const result: FileImage[] = []
  let total = 0
  for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
    if (!entry.name.toLowerCase().endsWith('.md')) continue
    const data = await readRegular(inside(dir, entry.name))
    total += data.length
    if (total > MAX_TOTAL_BYTES || result.length >= MAX_FILES) throw new Error('Scope exceeds transaction limit')
    result.push(image(entry.name, data))
  }
  return result
}

export type FaultPoint = 'prepared' | 'mutated' | 'committed'
export type FaultHook = (point: FaultPoint) => Promise<void> | void
interface Transaction { version: 1; id: string; state: 'prepared' | 'committed'; before: FileImage[]; archives: string[] }
const context = new AsyncLocalStorage<{ root: string; dir: string; journal: Transaction }>()

export function assertReadable(root: string, dir: string): void {
  assertNoLinksSync(dir)
  if (context.getStore()?.dir === dir) return
  for (const file of [join(root, ROOT_LOCK + '.lock'), join(dir, JOURNAL)]) {
    try { lstatSync(file); throw new Error('Storage busy or recovery required; retry after maintenance') }
    catch (error) { if (errorCode(error) !== 'ENOENT') throw error }
  }
}

async function validateFormat(root: string): Promise<void> {
  const file = join(root, FORMAT_FILE)
  try {
    const value = JSON.parse((await readRegular(file)).toString('utf8'))
    if (value.format !== 'dsh-auto-memory-wh' || value.version !== 1) throw new Error('Unsupported storage format; read-only until reviewed')
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
    // Only new/empty roots initialize automatically. Existing legacy records require migration.
    const entries = (await fs.readdir(root)).filter(name => name !== ROOT_LOCK + '.lock')
    for (const name of entries) {
      const target = inside(root, name)
      const stat = await fs.lstat(target)
      if (!stat.isDirectory() || (await fs.readdir(target)).length !== 0) throw new Error('Unmarked existing data requires a migration plan')
    }
    await durableWrite(file, JSON.stringify({ format: 'dsh-auto-memory-wh', version: 1 }) + '\n')
  }
}

async function rollback(dir: string, tx: Transaction): Promise<void> {
  const keep = new Set(tx.before.map(item => item.path))
  for (const item of tx.before) await durableWrite(inside(dir, item.path), decodeImage(item))
  for (const item of await captureScope(dir)) if (!keep.has(item.path)) await fs.unlink(inside(dir, item.path))
  for (const id of tx.archives) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid archive ID in journal')
    await fs.rm(inside(dir, '.archive/' + id + '.json'), { force: true })
  }
}

/** Caller holds root + scope locks. Prepared operations roll back; committed ones finish cleanup. */
export async function recoverScope(dir: string): Promise<'none' | 'rolled-back' | 'committed'> {
  let tx: Transaction
  try { tx = JSON.parse((await readRegular(join(dir, JOURNAL), MAX_TOTAL_BYTES * 2)).toString('utf8')) }
  catch (error) { if (errorCode(error) === 'ENOENT') return 'none'; throw error }
  if (tx.version !== 1 || !['prepared', 'committed'].includes(tx.state) || !Array.isArray(tx.before) || tx.before.length > MAX_FILES || !Array.isArray(tx.archives)) throw new Error('Invalid recovery journal')
  const seen = new Set<string>(); let total = 0
  for (const item of tx.before) {
    if (item.path.includes('/') || !item.path.toLowerCase().endsWith('.md') || seen.has(item.path.toLowerCase())) throw new Error('Invalid recovery path')
    seen.add(item.path.toLowerCase()); total += decodeImage(item).length
  }
  if (total > MAX_TOTAL_BYTES) throw new Error('Oversized recovery journal')
  if (tx.state === 'prepared') await rollback(dir, tx)
  await fs.unlink(join(dir, JOURNAL))
  return tx.state === 'prepared' ? 'rolled-back' : 'committed'
}

export async function withScopeTransaction<T>(root: string, dir: string, operation: () => Promise<T>, options: { bulk?: boolean; fault?: FaultHook } = {}): Promise<T> {
  assertNoLinksSync(root)
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  return withFileLock(join(root, ROOT_LOCK), async () => {
    await validateFormat(root)
    assertNoLinksSync(dir)
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    return withFileLock(join(dir, 'MEMORY.md'), async () => {
      await recoverScope(dir)
      const tx: Transaction = { version: 1, id: randomUUID(), state: 'prepared', before: await captureScope(dir), archives: [] }
      if (options.bulk) {
        const files = tx.before.map(item => ({ ...item, path: basename(dir) + '/' + item.path }))
        try { files.push(image(basename(dir) + '/' + PROJECT_FILE, await readRegular(join(dir, PROJECT_FILE)))) } catch (error) { if (errorCode(error) !== 'ENOENT') throw error }
        await durableWrite(inside(dir, '.backups/' + tx.id + '.json'), JSON.stringify({ format: 'wh-snapshot', version: 1, id: tx.id, created: new Date().toISOString(), pluginVersion: PLUGIN_VERSION, hostBuild: 'not-specified', source: root, selection: { includeAudit: false, includeArchive: false }, inventoryDigest: sha256(JSON.stringify(files)), files }))
      }
      await durableWrite(join(dir, JOURNAL), JSON.stringify(tx))
      return context.run({ root, dir, journal: tx }, async () => {
        try {
          await options.fault?.('prepared')
          const result = await operation()
          await options.fault?.('mutated')
          // Flush all changed active files before marking the transaction committed.
          const beforeHashes = new Map(tx.before.map(item => [item.path, item.hash]))
          for (const item of await captureScope(dir)) {
            if (beforeHashes.get(item.path) === item.hash) continue
            const fd = await fs.open(inside(dir, item.path), 'r+')
            try { await fd.sync() } finally { await fd.close() }
          }
          tx.state = 'committed'
          try { await durableWrite(join(dir, JOURNAL), JSON.stringify(tx)) } catch (error) { tx.state = 'prepared'; throw error }
          await options.fault?.('committed')
          await fs.unlink(join(dir, JOURNAL))
          return result
        } catch (error) {
          if (tx.state === 'prepared') {
            try { await rollback(dir, tx); await fs.unlink(join(dir, JOURNAL)) }
            catch { throw new Error('Recovery required: transaction rollback failed; journal retained', { cause: error }) }
          }
          throw error
        }
      })
    })
  }, { waitMs: 10_000 })
}

export async function archiveFile(dir: string, filename: string): Promise<boolean> {
  const state = context.getStore()
  if (state?.dir !== dir) throw new Error('Archive requires a scope transaction')
  let data: Buffer
  try { data = await readRegular(inside(dir, filename)) } catch (error) { if (errorCode(error) === 'ENOENT') return false; throw error }
  const id = randomUUID()
  state.journal.archives.push(id)
  await durableWrite(join(dir, JOURNAL), JSON.stringify(state.journal))
  await durableWrite(inside(dir, '.archive/' + id + '.json'), JSON.stringify({ version: 1, id, deletedAt: new Date().toISOString(), file: image(filename, data) }))
  await fs.unlink(inside(dir, filename))
  return true
}
