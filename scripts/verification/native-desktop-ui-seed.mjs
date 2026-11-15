/** One synthetic user-scope memory for the isolated native Desktop UI. */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { MemoryStore } from '../../src/store.ts'

const repo = resolve(import.meta.dirname, '../..')
const root = join(repo, '.work', 'S05', 'native-real-user-home', 'memory-wh')
const profile = join(repo, '.work', 'S05', 'native-real-user-home', 'profiles', 'desktop', 'package.json')
if (!await fs.stat(profile).then(() => true, () => false)) throw new Error('Isolated Desktop profile is missing')
if (await fs.stat(root).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })) throw new Error('Synthetic UI memory root already exists; refusing to overwrite')
const store = new MemoryStore(root)
const name = 'native-ui-synthetic'
const body = '仅用于隔离桌面验收的合成记忆；不代表用户真实经历或偏好。'
await store.write({ name, description: '隔离桌面测试记录', type: 'reference', body }, 'user')
const read = await store.read(name, 'user')
const file = join(root, '_user', `${name}.md`)
const hash = createHash('sha256').update(await fs.readFile(file)).digest('hex')
const pass = read?.body === body && (await store.list('user')).length === 1
const result = { kind: 'synthetic isolated Desktop UI seed', root: relative(repo, root), name, fileSha256: hash, recordCount: (await store.list('user')).length, pass }
const out = join(repo, 'docs', 'evidence', 'S05-native-wh-ui')
await fs.mkdir(out, { recursive: true })
await fs.writeFile(join(out, 'seed.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
if (!pass) process.exitCode = 1
