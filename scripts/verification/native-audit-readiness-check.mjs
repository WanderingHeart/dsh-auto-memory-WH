/** Read-only evidence for the isolated native audit session and WH event. */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { MemoryStore } from '../../src/store.ts'

const mode = process.argv[2] ?? 'before'
if (!['before', 'after'].includes(mode)) throw new Error('Use before or after')
const repo = resolve(import.meta.dirname, '../..')
const testRoot = join(repo, '.work', 'S05')
const home = join(testRoot, 'native-real-user-home')
const root = join(home, 'memory-wh')
const pointer = JSON.parse(await fs.readFile(join(testRoot, 'native-audit-session-pointer-r72.json'), 'utf8'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase()
const exists = file => fs.stat(file).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e })
const store = new MemoryStore(root)
const project = await store.read('native-audit-reviewed-r72', 'project', pointer.cwd)
const user = await store.read('native-ui-synthetic', 'user')
const auditFile = join(root, 'audit.jsonl')
const events = (await fs.readFile(auditFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
// DSH's workspace slug is host-defined; locate only the fixed session ID under the isolated home.
const sessionMatches = []
for (const workspace of await fs.readdir(join(home, 'sessions'))) {
  for (const folder of [pointer.id, `session-${pointer.id}`]) {
    const file = join(home, 'sessions', workspace, folder, 'session.v4.jsonl.zstd')
    if (await exists(file)) sessionMatches.push(file)
  }
}
const sessionEvents = sessionMatches.length === 1 ? zstdDecompressSync(await fs.readFile(sessionMatches[0])).toString('utf8').trim().split('\n').map(line => JSON.parse(line)) : []
const sessionValid = sessionMatches.length === 1 && sessionEvents[0]?.type === 'session' && sessionEvents[0]?.id === pointer.id && sessionEvents[0]?.cwd === pointer.cwd && sessionEvents.some(item => item.type === 'user/message' && JSON.stringify(item).includes('WH 原生隔离审计合成会话 r72'))
const oldSessionBackup = join(testRoot, 'native-audit-session-baseline-r72')
const oldSessionChecks = []
for (const workspace of await fs.readdir(oldSessionBackup)) {
  for (const session of await fs.readdir(join(oldSessionBackup, workspace))) {
    const relative = join(workspace, session, 'session.v4.jsonl.zstd')
    oldSessionChecks.push(sha(await fs.readFile(join(home, 'sessions', relative))) === sha(await fs.readFile(join(oldSessionBackup, relative))))
  }
}
const baseline = JSON.parse(await fs.readFile(join(repo, 'docs/evidence/S05-native-audit-readiness/memory-baseline.json'), 'utf8'))
const originalMemoryChecks = []
for (const item of baseline.files) originalMemoryChecks.push(sha(await fs.readFile(join(root, item.path))) === item.sha256 && sha(await fs.readFile(join(testRoot, 'native-audit-memory-baseline-r72', item.path))) === item.sha256)
const profile = join(home, 'profiles', 'desktop')
const profileBackup = join(testRoot, 'native-desktop-profile-postremove-r65')
const profileChecks = []
for (const file of ['package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) profileChecks.push(sha(await fs.readFile(join(profile, file))) === sha(await fs.readFile(join(profileBackup, file))))
const whAbsent = !await exists(join(profile, 'node_modules', 'dsh-auto-memory-wh'))
const auditValid = (mode === 'before' ? events.length === 1 : events.length >= 1) && events.some(event => event.kind === 'render_attempt' && event.pluginVersion === '0.1.0-rc.8' && event.sessionId?.toUpperCase() === sha(pointer.id) && event.cwd?.toUpperCase() === sha(pointer.cwd) && event.injected?.includes('native-audit-reviewed-r72') && event.excluded?.some(item => item.id.endsWith(':native-ui-synthetic') && item.reason === 'disabled'))
const memoryValid = project?.status === 'verified' && project?.body === 'Synthetic fact.' && user?.status === 'verified' && user?.disabled === true && user?.description === '隔离桌面交互验收-r67' && store.readIndexSync('project', pointer.cwd)?.includes('native-audit-reviewed-r72') === true && store.readIndexSync('user') === null
const credentialsValid = sha(await fs.readFile(join(home, '.credentials.yaml'))) === '9FF947C05D4EDAD0728B1DD929C8C9D02DBB5167382AF51DD20189B2B1708296'
const noLocks = !await exists(join(root, '.wh-writer.lock')) && !await exists(join(root, '_user', 'MEMORY.md.lock'))
const pass = sessionValid && auditValid && memoryValid && credentialsValid && whAbsent && noLocks && oldSessionChecks.every(Boolean) && originalMemoryChecks.every(Boolean) && profileChecks.every(Boolean)
const result = { mode, pass, sessionValid, auditValid, memoryValid, credentialsValid, whAbsent, noLocks, originalSessionFilesUnchanged: oldSessionChecks.filter(Boolean).length, originalSessionFiles: oldSessionChecks.length, originalMemoryFilesUnchanged: originalMemoryChecks.filter(Boolean).length, originalMemoryFiles: originalMemoryChecks.length, profileFilesUnchanged: profileChecks.filter(Boolean).length, profileFiles: profileChecks.length, auditEventCount: events.length, projectRecord: project?.name, excludedMutedUserRecord: events.some(event => event.excluded?.some(item => item.id.endsWith(':native-ui-synthetic') && item.reason === 'disabled')) }
const out = join(repo, 'docs', 'evidence', 'S05-native-audit-readiness', mode === 'before' ? 'postseed.json' : 'postui.json')
await fs.writeFile(out, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
if (!pass) process.exitCode = 1
