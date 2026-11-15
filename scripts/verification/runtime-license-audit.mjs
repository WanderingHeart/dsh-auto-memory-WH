/** Read-only audit of a local candidate tarball and the disposable wh-s05 profile. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const repo = resolve(import.meta.dirname, '../..')
const candidate = process.argv[2] ?? 'rc.11'
if (!/^(?:rc\.\d+|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.test(candidate)) throw new Error('Candidate must look like rc.11 or a version such as 1.0.0-rc.1')
const stage = /^\d/.test(candidate) ? candidate : `0.1.0-${candidate}`
const version = /^\d/.test(candidate) ? candidate : `0.1.0-${candidate}`; const archive = join(repo, '.work', `dsh-auto-memory-wh-${version}.tgz`)
const installed = join(repo, '.work', 'S05', 'installation-home', 'profiles', 'wh-s05', 'node_modules')
const evidenceDir = join(repo, 'docs', 'evidence', `S05-${stage}-licenses`)
const sha = data => createHash('sha256').update(data).digest('hex').toUpperCase()
const archiveFile = name => execFileSync('tar', ['-xOzf', archive, `package/${name}`], { windowsHide: true })
const manifest = JSON.parse(archiveFile('package.json').toString('utf8'))
const expectedVersion = version
if (manifest.name !== 'dsh-auto-memory-wh' || manifest.version !== expectedVersion) throw new Error('Unexpected candidate package')
const packageFiles = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).map(s => s.replace(/^package\//, '')).sort()
const expected = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'UPSTREAM.md', 'lib/index.js', 'lib/client.js', 'package.json']
for (const file of expected) if (!packageFiles.includes(file)) throw new Error(`Missing ${file}`)
const hostCode = archiveFile('lib/index.js').toString('utf8')
const browserCode = archiveFile('lib/client.js').toString('utf8')
const expectedDeps = [
  ['@deepseek-ai/cosmokit', '1.8.6', 'MIT'],
  ['@deepseek-ai/schemastery', '3.18.5', 'MIT'],
  ['@standard-schema/spec', '1.1.0', 'MIT'],
  ['yaml', '2.9.1', 'ISC'],
]
const dependencies = expectedDeps.map(([name, version, license]) => {
  const path = join(installed, ...name.split('/'))
  const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
  if (pkg.version !== version || pkg.license !== license) throw new Error(`Changed runtime dependency: ${name}`)
  const bytes = readFileSync(join(path, 'LICENSE'))
  const line = bytes.toString('utf8').split(/\r?\n/).find(s => /copyright|^©/i.test(s))
  if (!line) throw new Error(`Missing copyright line: ${name}`)
  return { name, version, declaredLicense: license, licenseSha256: sha(bytes), copyrightLine: line.trim(), installedLicenseIncluded: true }
})
const lockfile = JSON.parse(readFileSync(join(repo, 'package-lock.json'), 'utf8'))
const notices = readFileSync(join(repo, 'THIRD_PARTY_NOTICES.md'), 'utf8')
const lockEntries = Object.entries(lockfile.packages).filter(([path]) => path.startsWith('node_modules/'))
const noticeRows = [...notices.matchAll(/^\| (node_modules\/[^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)]
const noticeMap = new Map(noticeRows.map(([, path, version, license]) => [path.trim(), { version: version.trim(), license: license.trim() }]))
const lockNoticeMismatches = lockEntries.filter(([path, info]) => {
  const row = noticeMap.get(path)
  return !row || row.version !== info.version || row.license !== info.license
}).map(([path]) => path)
const staleNoticeRows = [...noticeMap.keys()].filter(path => !lockfile.packages[path])
const runtimeNoticeMismatches = dependencies.filter(dep =>
  !notices.includes(`| ${dep.name} | ${dep.version} | ${dep.declaredLicense} | \`${dep.licenseSha256}\` |`)
).map(dep => dep.name)
const result = {
  candidate: { name: manifest.name, version: manifest.version, archiveSha256: sha(readFileSync(archive)), fileCount: packageFiles.length,
    licenseSha256: sha(archiveFile('LICENSE')), noticesSha256: sha(archiveFile('THIRD_PARTY_NOTICES.md')),
    upstreamSha256: sha(archiveFile('UPSTREAM.md')), runtimeDependencyDirectoriesEmbedded: packageFiles.some(s => s.startsWith('node_modules/')) },
  dependencies,
  noticeConsistency: { lockEntries: lockEntries.length, noticeRows: noticeRows.length, lockNoticeMismatches, staleNoticeRows, runtimeNoticeMismatches },
  bundleReferences: {
    schemasteryExternalImport: /^import .* from "@deepseek-ai\/schemastery"/m.test(hostCode),
    yamlExternalImport: /^import .* from "yaml"/m.test(hostCode),
    reactHostRequire: /require\("react"\)/.test(browserCode),
  },
  limits: ['Local package and installed profile only', 'Does not determine complete legal obligations', 'Does not scan vulnerabilities', 'Does not prove absence of copied third-party source inside bundles'],
}
result.pass = !result.candidate.runtimeDependencyDirectoriesEmbedded && Object.values(result.bundleReferences).every(Boolean)
  && lockEntries.length === noticeRows.length && noticeMap.size === noticeRows.length
  && !lockNoticeMismatches.length && !staleNoticeRows.length && !runtimeNoticeMismatches.length
mkdirSync(evidenceDir, { recursive: true })
writeFileSync(join(evidenceDir, 'audit.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
if (!result.pass) process.exitCode = 1
