/** Backup/check fixed isolated native memory root before seeding an audit event. */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const mode = process.argv[2]
if (!['backup', 'verify'].includes(mode)) throw new Error('Use backup or verify')
const repo = resolve(import.meta.dirname, '../..')
const testRoot = join(repo, '.work', 'S05')
const root = join(testRoot, 'native-real-user-home', 'memory-wh')
const backup = join(testRoot, 'native-audit-memory-baseline-r72')
const evidence = join(repo, 'docs', 'evidence', 'S05-native-audit-readiness')
const manifestFile = join(evidence, 'memory-baseline.json')
const hash = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase()
const list = async (dir, prefix = '') => {
  const files = []
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error('Linked memory path refused')
    const name = join(prefix, item.name), file = join(dir, item.name)
    if (item.isDirectory()) files.push(...await list(file, name))
    else if (item.isFile()) files.push(name)
    else throw new Error('Unexpected memory entry')
  }
  return files.sort()
}
const original = await list(root)
if (mode === 'backup') {
  if (await fs.stat(backup).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e })) throw new Error('Backup already exists')
  await fs.cp(root, backup, { recursive: true, errorOnExist: true, force: false, dereference: false })
  const files = []
  for (const name of original) {
    const sha256 = hash(await fs.readFile(join(root, name)))
    if (sha256 !== hash(await fs.readFile(join(backup, name)))) throw new Error('Backup hash mismatch')
    files.push({ path: name.replaceAll('\\', '/'), sha256 })
  }
  await fs.mkdir(evidence, { recursive: true })
  await fs.writeFile(manifestFile, JSON.stringify({ root: relative(repo, root), backup: relative(repo, backup), files }, null, 2) + '\n')
  console.log(JSON.stringify({ mode, pass: true, fileCount: files.length }))
} else {
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
  const unchanged = []
  for (const item of manifest.files) unchanged.push(item.sha256 === hash(await fs.readFile(join(root, item.path))) && item.sha256 === hash(await fs.readFile(join(backup, item.path))))
  const pass = unchanged.every(Boolean)
  console.log(JSON.stringify({ mode, pass, originalFilesUnchanged: unchanged.filter(Boolean).length, originalFileCount: unchanged.length, currentFileCount: original.length }))
  if (!pass) process.exitCode = 1
}
