import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { PACKAGE_NAME, PLUGIN_ID, API_BASE, LOCALE_NAMESPACE, MEMORY_SECTION_NAME } from '../../src/identity.ts'
const stage = process.argv[2] || 'S02'
if (!/^S[0-9]+(?:-(?:rc[0-9]+|\d+\.\d+\.\d+))$/.test(stage)) throw new Error('Invalid stage')
const stageBase = stage.split('-')[0]
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')
const manifest = JSON.parse(read('package.json'))
const lock = JSON.parse(read('package-lock.json'))
const patch = parse(read('cordis.patch.yml'))
const host = await import(new URL('../../lib/index.js', import.meta.url).href)
const client = read('lib/client.js')
let moduleDefinition
vm.runInNewContext(client, { window: { __ModuleLoader__: { load: definition => { moduleDefinition = definition } } } }, { timeout: 3000 })
assert.equal(manifest.name, PACKAGE_NAME)
assert.equal(lock.name, PACKAGE_NAME)
assert.equal(lock.packages[''].name, PACKAGE_NAME)
assert.equal(lock.version, manifest.version)
assert.deepEqual(lock.packages[''].peerDependencies, manifest.peerDependencies)
assert.equal(patch[0].insert[0].name, PACKAGE_NAME)
assert.equal(patch[0].insert[0].id, PLUGIN_ID)
assert.equal(host.name, PACKAGE_NAME)
assert.equal(moduleDefinition.id, PACKAGE_NAME)
assert.equal(typeof moduleDefinition.factory, 'function')
assert.ok(client.includes(API_BASE))
assert.ok(client.includes(LOCALE_NAMESPACE))
assert.ok(read('lib/index.js').includes(API_BASE))
assert.ok(read('lib/index.js').includes(MEMORY_SECTION_NAME))
assert.equal(manifest.private, false)
assert.ok(!fs.existsSync(path.join(root, '.github/workflows/publish.yml')))
const pack = JSON.parse(read(`docs/evidence/${stage}/package.json`))[0]
assert.equal(pack.name, PACKAGE_NAME)
assert.equal(pack.version, manifest.version)
const allowed = /^(lib\/[a-zA-Z0-9_.-]+|package\.json|cordis\.patch\.yml|LICENSE|UPSTREAM\.md|THIRD_PARTY_NOTICES\.md|CHANGELOG\.md|docs\/(?:storage-recovery|trust-ui|configuration)\.md|README(?:\.zh)?\.md)$/
for (const item of pack.files) assert.match(item.path, allowed)
for (const item of ['LICENSE', 'UPSTREAM.md', 'THIRD_PARTY_NOTICES.md', 'lib/index.js', 'lib/client.js', 'cordis.patch.yml', ...(['S03', 'S04', 'S05'].includes(stageBase) ? ['lib/maintenance-cli.js', 'docs/storage-recovery.md', ...(['S04', 'S05'].includes(stageBase) ? ['docs/trust-ui.md', 'docs/configuration.md'] : [])] : [])]) {
  assert.ok(pack.files.some(f => f.path === item), 'Missing package file: ' + item)
}
const result = { status: 'passed', packageName: PACKAGE_NAME, version: manifest.version, bundleId: moduleDefinition.id, packageFiles: pack.files.map(f => f.path), integrity: pack.integrity, note: 'Checks package and bundle registration contracts; does not execute the client factory or validate real UI rendering.' }
fs.writeFileSync(path.join(root, `docs/evidence/${stage}/package-smoke.json`), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))

