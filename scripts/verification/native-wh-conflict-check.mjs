/** Fixed-scope synthetic conflict probe for the isolated native Desktop profile. */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { MemoryStore } from '../../src/store.ts'

const mode = process.argv[2]
if (!['rehearse', 'before', 'bump', 'after'].includes(mode)) throw new Error('Use rehearse, before, bump, or after')
const repo = resolve(import.meta.dirname, '../..')
const testRoot = join(repo, '.work', 'S05')
const home = join(testRoot, 'native-real-user-home')
const root = join(home, 'memory-wh')
const profile = join(home, 'profiles', 'desktop')
const name = 'native-ui-synthetic'
const recordFile = join(root, '_user', `${name}.md`)
const indexFile = join(root, '_user', 'MEMORY.md')
const evidenceDir = join(repo, 'docs', 'evidence', 'S05-native-wh-conflict')
const expectedBody = '仅用于隔离桌面验收的合成记忆；不代表用户真实经历或偏好。'
const expectedDescription = '隔离桌面交互验收-r67'
const expectedRecordHash = 'E16DD6055DB560CC981CA53CA666D95E7668F9BABA48EA25BD52B7E57D716CC4'
const expectedCredentialsHash = '9FF947C05D4EDAD0728B1DD929C8C9D02DBB5167382AF51DD20189B2B1708296'
const sha = data => createHash('sha256').update(data).digest('hex').toUpperCase()
const hashFile = async file => sha(await fs.readFile(file))
const exists = file => fs.stat(file).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e })
const store = new MemoryStore(root)
for (const path of [testRoot, home, root, join(root, '_user'), profile, recordFile, indexFile]) {
  if ((await fs.lstat(path)).isSymbolicLink()) throw new Error(`Refusing linked path: ${path}`)
}
const record = await store.read(name, 'user')
const currentHash = await hashFile(recordFile)
const indexHash = await hashFile(indexFile)
const credentialsHash = await hashFile(join(home, '.credentials.yaml'))
const expectedIndexHash = sha('')
const profileBackup = join(testRoot, 'native-desktop-profile-postremove-r65')
const profileMatches = {}
for (const file of ['package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
  profileMatches[file] = await hashFile(join(profile, file)) === await hashFile(join(profileBackup, file))
}
const moduleFile = join(profile, 'node_modules', 'dsh-auto-memory-wh', 'package.json')
const whInstalled = await exists(moduleFile)
const noLocks = !await exists(join(root, '.wh-writer.lock')) && !await exists(join(root, '_user', 'MEMORY.md.lock')) && !await exists(join(root, '_user', '.wh-transaction.json'))
const baseline = record?.body === expectedBody && record?.description === expectedDescription && record?.status === 'verified' && record?.pinned === true && record?.disabled === true && currentHash === expectedRecordHash && indexHash === expectedIndexHash && credentialsHash === expectedCredentialsHash && noLocks
const saveEvidence = async (kind, value) => { await fs.mkdir(evidenceDir, { recursive: true }); await fs.writeFile(join(evidenceDir, `${kind}.json`), JSON.stringify(value, null, 2) + '\n') }

if (mode === 'rehearse') {
  if (!baseline || whInstalled || !Object.values(profileMatches).every(Boolean)) throw new Error('Rehearsal requires unchanged isolated baseline')
  const rehearsal = await fs.mkdtemp(join(testRoot, 'native-conflict-rehearsal-r69-'))
  await fs.mkdir(join(rehearsal, '_user'))
  for (const [src, dest] of [[join(root, '.wh-format.json'), join(rehearsal, '.wh-format.json')], [indexFile, join(rehearsal, '_user', 'MEMORY.md')], [recordFile, join(rehearsal, '_user', `${name}.md`)]]) await fs.copyFile(src, dest)
  const copyStore = new MemoryStore(rehearsal)
  const old = await copyStore.read(name, 'user')
  await copyStore.write({ ...old, origin: undefined, status: undefined, expectedRevision: old.revision, pinned: false }, 'user')
  let conflict = false
  try { await copyStore.write({ ...old, origin: undefined, status: undefined, expectedRevision: old.revision, description: '未保存的冲突草稿-r69' }, 'user') }
  catch (error) { conflict = /Revision conflict/.test(String(error)) }
  const latest = await copyStore.read(name, 'user')
  const pass = conflict && latest?.pinned !== true && latest?.description === expectedDescription && latest?.status === 'verified' && latest?.disabled === true && copyStore.readIndexSync('user') === null
  await saveEvidence('rehearsal', { pass, staleWriteRejected: conflict, latestState: latest ? { description: latest.description, status: latest.status, pinned: latest.pinned, disabled: latest.disabled } : null })
  console.log(JSON.stringify({ mode, pass, staleWriteRejected: conflict }))
  if (!pass) process.exitCode = 1
} else if (mode === 'before') {
  const pass = baseline && !whInstalled && Object.values(profileMatches).every(Boolean)
  await saveEvidence('before', { pass, baseline, whInstalled, profileMatches, noLocks, recordHash: currentHash, indexHash, credentialsHash })
  console.log(JSON.stringify({ mode, pass, baseline, whInstalled, noLocks }))
  if (!pass) process.exitCode = 1
} else if (mode === 'bump') {
  const module = whInstalled ? JSON.parse(await fs.readFile(moduleFile, 'utf8')) : null
  const manifest = JSON.parse(await fs.readFile(join(profile, 'package.json'), 'utf8'))
  if (!baseline || module?.version !== '0.1.0-rc.8' || !manifest.dependencies?.['dsh-auto-memory-wh'] || !manifest.dsh?.profile?.bundles?.includes('dsh-auto-memory-wh')) throw new Error('Refusing to change anything outside the expected installed synthetic profile')
  const updated = await store.write({ ...record, origin: undefined, status: undefined, expectedRevision: record.revision, pinned: false }, 'user')
  const updatedHash = await hashFile(recordFile)
  const pass = updated?.pinned !== true && updated?.description === expectedDescription && updated?.status === 'verified' && updated?.disabled === true && updated?.body === expectedBody && updatedHash !== currentHash && store.readIndexSync('user') === null
  await saveEvidence('bump', { pass, recordHashBefore: currentHash, recordHashAfter: updatedHash, state: updated ? { description: updated.description, status: updated.status, pinned: updated.pinned, disabled: updated.disabled } : null })
  console.log(JSON.stringify({ mode, pass, status: pass ? 'synthetic-revision-bumped' : 'unexpected-state' }))
  if (!pass) process.exitCode = 1
} else {
  const bump = JSON.parse(await fs.readFile(join(evidenceDir, 'bump.json'), 'utf8'))
  const pass = bump.pass === true && record?.body === expectedBody && record?.description === expectedDescription && record?.status === 'verified' && record?.pinned !== true && record?.disabled === true && currentHash === bump.recordHashAfter && indexHash === expectedIndexHash && store.readIndexSync('user') === null && credentialsHash === expectedCredentialsHash && !whInstalled && Object.values(profileMatches).every(Boolean) && noLocks
  await saveEvidence('after', { pass, recordState: record ? { description: record.description, status: record.status, pinned: record.pinned, disabled: record.disabled, bodyMatchesSeed: record.body === expectedBody } : null, recordHash: currentHash, indexHash, credentialsHash, whInstalled, profileMatches, noLocks })
  console.log(JSON.stringify({ mode, pass, recordState: record ? { description: record.description, status: record.status, pinned: record.pinned, disabled: record.disabled } : null, whInstalled, noLocks }))
  if (!pass) process.exitCode = 1
}
