/** Read-only checks before and after the isolated native UI edit/review/mute cycle. */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { MemoryStore } from '../../src/store.ts'

const mode = process.argv[2]
if (!['before', 'after'].includes(mode)) throw new Error('Use before or after')
const repo = resolve(import.meta.dirname, '../..')
const testRoot = join(repo, '.work', 'S05')
const home = join(testRoot, 'native-real-user-home')
const root = join(home, 'memory-wh')
const profile = join(home, 'profiles', 'desktop')
const memoryBackup = join(testRoot, 'native-wh-ui-memory-baseline-r67')
const profileBackup = join(testRoot, 'native-desktop-profile-postremove-r65')
const recordFile = join(root, '_user', 'native-ui-synthetic.md')
const indexFile = join(root, '_user', 'MEMORY.md')
const store = new MemoryStore(root)
const expectedBody = '仅用于隔离桌面验收的合成记忆；不代表用户真实经历或偏好。'
const expectedDescription = '隔离桌面交互验收-r67'
const sha = data => createHash('sha256').update(data).digest('hex').toUpperCase()
const exists = file => fs.stat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })
const record = await store.read('native-ui-synthetic', 'user')
const records = await store.list('user')
const recordHash = sha(await fs.readFile(recordFile))
const indexHash = sha(await fs.readFile(indexFile))
const formatHash = sha(await fs.readFile(join(root, '.wh-format.json')))
const baselineRecordHash = sha(await fs.readFile(join(memoryBackup, '_user', 'native-ui-synthetic.md')))
const baselineIndexHash = sha(await fs.readFile(join(memoryBackup, '_user', 'MEMORY.md')))
const baselineFormatHash = sha(await fs.readFile(join(memoryBackup, '.wh-format.json')))
const profileMatches = {}
for (const name of ['package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
  profileMatches[name] = sha(await fs.readFile(join(profile, name))) === sha(await fs.readFile(join(profileBackup, name)))
}
const whAbsent = !await exists(join(profile, 'node_modules', 'dsh-auto-memory-wh'))
const credentialsHash = sha(await fs.readFile(join(home, '.credentials.yaml')))
const noLocks = !await exists(join(root, '.wh-writer.lock')) && !await exists(join(root, '_user', 'MEMORY.md.lock')) && !await exists(join(root, '_user', '.wh-transaction.json'))
const base = { mode, root: relative(repo, root), recordCount: records.length, recordHash, indexHash, formatHash, baselineRecordHash, baselineIndexHash, baselineFormatHash, profileMatches, whAbsent, credentialsHash, noLocks }
const beforePass = record?.body === expectedBody && record?.description === '隔离桌面测试记录' && record?.status === 'candidate' && !record?.pinned && !record?.disabled
  && records.length === 1 && recordHash === baselineRecordHash && indexHash === baselineIndexHash && formatHash === baselineFormatHash
  && Object.values(profileMatches).every(Boolean) && whAbsent && noLocks
const afterPass = record?.body === expectedBody && record?.description === expectedDescription && record?.status === 'verified' && record?.pinned === true && record?.disabled === true
  && records.length === 1 && recordHash !== baselineRecordHash && indexHash === baselineIndexHash && store.readIndexSync('user') === null
  && formatHash === baselineFormatHash && Object.values(profileMatches).every(Boolean) && whAbsent && noLocks
  && credentialsHash === '9FF947C05D4EDAD0728B1DD929C8C9D02DBB5167382AF51DD20189B2B1708296'
const result = { ...base, recordState: record ? { name: record.name, description: record.description, status: record.status, pinned: record.pinned === true, disabled: record.disabled === true, bodyMatchesSyntheticSeed: record.body === expectedBody } : null, pass: mode === 'before' ? beforePass : afterPass }
const out = join(repo, 'docs', 'evidence', 'S05-native-wh-interactions')
await fs.mkdir(out, { recursive: true })
await fs.writeFile(join(out, `${mode}.json`), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ mode, pass: result.pass, recordState: result.recordState, whAbsent, profileMatches: Object.values(profileMatches).every(Boolean), noLocks }))
if (!result.pass) process.exitCode = 1
