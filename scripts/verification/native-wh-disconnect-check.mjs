/** Fixed-scope preparation and read-only checks for native renderer disconnect. */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { MemoryStore } from '../../src/store.ts'

const mode = process.argv[2]
if (!['prepare', 'before', 'after'].includes(mode)) throw new Error('Use prepare, before, or after')
const repo = resolve(import.meta.dirname, '../..')
const testRoot = join(repo, '.work', 'S05')
const home = join(testRoot, 'native-real-user-home')
const root = join(home, 'memory-wh')
const profile = join(home, 'profiles', 'desktop')
const backup = join(testRoot, 'native-wh-disconnect-baseline-r74')
const evidence = join(repo, 'docs', 'evidence', 'S05-native-wh-disconnect')
const manifestFile = join(evidence, 'baseline.json')
const sha = data => createHash('sha256').update(data).digest('hex').toUpperCase()
const exists = file => fs.stat(file).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e })
const hashFile = async file => sha(await fs.readFile(file))
async function list(dir, prefix = '') {
  const files = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Linked memory path refused')
    const name = join(prefix, entry.name), file = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await list(file, name))
    else if (entry.isFile()) files.push(name)
    else throw new Error('Unexpected memory entry')
  }
  return files.sort()
}
const store = new MemoryStore(root)
const user = await store.read('native-ui-synthetic', 'user')
const profileBackup = join(testRoot, 'native-desktop-profile-postremove-r65')
const profileMatches = []
for (const name of ['package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) profileMatches.push(await hashFile(join(profile, name)) === await hashFile(join(profileBackup, name)))
const whAbsent = !await exists(join(profile, 'node_modules', 'dsh-auto-memory-wh'))
const credentialsValid = await hashFile(join(home, '.credentials.yaml')) === '9FF947C05D4EDAD0728B1DD929C8C9D02DBB5167382AF51DD20189B2B1708296'
const noLocks = !await exists(join(root, '.wh-writer.lock')) && !await exists(join(root, '_user', 'MEMORY.md.lock')) && !await exists(join(root, '_user', '.wh-transaction.json'))
const userValid = user?.description === '隔离桌面交互验收-r67' && user?.status === 'verified' && user?.disabled === true && user?.body === '仅用于隔离桌面验收的合成记忆；不代表用户真实经历或偏好。'
const invariant = profileMatches.every(Boolean) && whAbsent && credentialsValid && noLocks && userValid
if (mode === 'prepare') {
  if (!invariant || await exists(backup)) throw new Error('Isolated baseline changed or backup already exists')
  const files = await list(root)
  await fs.cp(root, backup, { recursive: true, errorOnExist: true, force: false, dereference: false })
  const entries = []
  for (const name of files) {
    const hash = await hashFile(join(root, name))
    if (hash !== await hashFile(join(backup, name))) throw new Error('Backup hash mismatch')
    entries.push({ path: name.replaceAll('\\', '/'), sha256: hash })
  }
  await fs.mkdir(evidence, { recursive: true })
  await fs.writeFile(manifestFile, JSON.stringify({ root: relative(repo, root), backup: relative(repo, backup), files: entries }, null, 2) + '\n')
  console.log(JSON.stringify({ mode, pass: true, fileCount: entries.length }))
} else {
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
  const backupChecks = [], protectedChecks = []
  for (const item of manifest.files) {
    const backupMatches = item.sha256 === await hashFile(join(backup, item.path))
    backupChecks.push(backupMatches)
    if (item.path !== 'audit.jsonl') protectedChecks.push(item.sha256 === await hashFile(join(root, item.path)))
  }
  const audit = (await fs.readFile(join(root, 'audit.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  const auditSeedPreserved = audit.some(event => event.kind === 'render_attempt' && event.injected?.includes('native-audit-reviewed-r72') && event.excluded?.some(item => item.id.endsWith(':native-ui-synthetic') && item.reason === 'disabled'))
  const pass = invariant && backupChecks.every(Boolean) && protectedChecks.every(Boolean) && auditSeedPreserved
  const result = { mode, pass, backupFilesValid: backupChecks.filter(Boolean).length, backupFileCount: backupChecks.length, protectedFilesUnchanged: protectedChecks.filter(Boolean).length, protectedFileCount: protectedChecks.length, auditEventCount: audit.length, auditSeedPreserved, userValid, profileMatches: profileMatches.every(Boolean), credentialsValid, whAbsent, noLocks }
  await fs.writeFile(join(evidence, `${mode}.json`), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
  if (!pass) process.exitCode = 1
}
