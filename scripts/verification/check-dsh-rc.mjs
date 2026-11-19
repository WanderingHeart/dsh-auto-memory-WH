import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const version = process.argv[2]
if (!['0.2.2-rc.4', '0.2.2-rc.5'].includes(version)) {
  throw new Error('Specify exactly 0.2.2-rc.4 or 0.2.2-rc.5')
}
const repo = fileURLToPath(new URL('../../', import.meta.url))
const work = join(repo, '.work')
mkdirSync(work, { recursive: true })
const cwd = mkdtempSync(join(work, 'dsh-' + version + '-'))
console.log(`DSH ${version} isolated regression: ${cwd}`)
for (const file of ['src', 'tests', 'scripts', 'evals', 'tsconfig.json', 'tsdown.config.ts', 'vitest.config.ts', 'cordis.patch.yml']) {
  cpSync(join(repo, file), join(cwd, file), { recursive: true })
}
const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
const baseline = JSON.parse(readFileSync(join(repo, 'package-lock.json'), 'utf8')).packages
const hostPackages = [
  ...Object.keys(manifest.peerDependencies).filter(name => name.startsWith('@deepseek-ai/dsh-')),
  ...Object.keys(manifest.devDependencies).filter(name => name.startsWith('@deepseek-ai/dsh-client-')),
]
const pins = Object.fromEntries(hostPackages.map(name => [name, version]))
pins['@deepseek-ai/cordis'] = '4.1.0'
// Keep direct non-host tooling aligned with the baseline, but resolve a fresh
// graph: npm cannot safely reuse the old host's locked peer graph for this RC.
for (const group of [manifest.dependencies, manifest.devDependencies]) {
  for (const name of Object.keys(group)) {
    if (!(name in pins)) group[name] = baseline[`node_modules/${name}`].version
  }
}
Object.assign(manifest.devDependencies, pins)
// Both candidates' services use the newer schema types (including Volatile).
manifest.dependencies['@deepseek-ai/schemastery'] = '3.19.0'
pins['@deepseek-ai/schemastery'] = '3.19.0'
manifest.private = true
writeFileSync(join(cwd, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')

const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Run via npm run check:dsh -- <version>')
function run(...args) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run(npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline')
for (const [name, expected] of Object.entries(pins)) {
  const actual = JSON.parse(readFileSync(join(cwd, 'node_modules', name, 'package.json'), 'utf8')).version
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, installed ${actual}`)
}
run(npmCli, 'run', 'check')
run('--input-type=module', '-e', "const m = await import('./lib/index.js'); if (!m.apply || !m.inject) throw new Error('bad entry exports')")
