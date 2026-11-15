/**
 * Read-only distribution audit of a local candidate tarball.
 * Usage: node scripts/verification/candidate-distribution-audit.mjs 0.1.0 [--public]
 * Checks tarball hygiene, version consistency, repo-vs-tarball hashes,
 * accidental secrets/absolute paths, repack determinism, production audit,
 * whether the host bundle imports zod directly, and (with --public) that the
 * manifest is publishable and the README no longer claims a private-only build.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const candidate = process.argv[2] ?? 'rc.11'
if (!/^(?:rc\.\d+|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.test(candidate)) throw new Error('Candidate must look like rc.11 or a version such as 1.0.0-rc.1')
const publicRelease = process.argv.includes('--public')
const version = /^\d/.test(candidate) ? candidate : `0.1.0-${candidate}`
const stage = /^\d/.test(candidate) ? candidate : `0.1.0-${candidate}`
const evidenceDir = path.join(repo, 'docs', 'evidence', `S05-${stage}-distribution`)
const archive = path.join(repo, '.work', `dsh-auto-memory-wh-${version}.tgz`)
const sha = data => crypto.createHash('sha256').update(data).digest('hex').toUpperCase()
const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const runNpm = (args, options = {}) => execFileSync(process.execPath, [npmCli, ...args], { encoding: 'utf8', windowsHide: true, ...options })
const tarList = () => execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).map(s => s.replace(/^package\//, ''))
const tarFile = name => execFileSync('tar', ['-xOzf', archive, `package/${name}`], { windowsHide: true })
const manifest = JSON.parse(tarFile('package.json').toString('utf8'))
const files = tarList().sort()

const textExtensions = /\.(?:js|mjs|cjs|json|md|yml|yaml|txt|ts|d\.ts)$/
const textFiles = files.filter(name => textExtensions.test(name))
const content = new Map(textFiles.map(name => [name, tarFile(name).toString('utf8')]))

const forbidden = [
  ['absolute Windows user path', /C:\\+Users\\+/i],
  ['workspace path leakage', /dsh-plug-in/i],
  ['private key block', /BEGIN [A-Z ]*PRIVATE KEY/],
  ['API-key-like literal', /\bsk-[A-Za-z0-9]{12,}/],
  ['bearer token literal', /Bearer\s+[A-Za-z0-9._-]{12,}/],
  ['credential assignment', /(?:password|passwd|secret|api[_-]?key)\s*[:=]\s*['"][^'"\s]{6,}/i],
]
const suspicious = []
for (const [label, pattern] of forbidden) {
  for (const [name, text] of content) if (pattern.test(text)) suspicious.push({ file: name, pattern: label })
}
// rc.11 cleaned the last accepted finding (README.zh.md machine-specific path);
// keep the empty list explicit so any new finding fails the audit.
const knownFindings = []
const contentFindings = suspicious.map(item => ({
  ...item,
  ...(knownFindings.find(known => known.file === item.file && known.pattern === item.pattern) ?? { accepted: false }),
}))
const unreviewedContentFindings = contentFindings.filter(item => item.accepted === false)

const shipCritical = ['lib/index.js', 'lib/client.js', 'lib/index.d.ts', 'lib/maintenance-cli.js', 'LICENSE', 'UPSTREAM.md', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'cordis.patch.yml', 'docs/storage-recovery.md', 'docs/trust-ui.md', 'docs/configuration.md']
const hashMismatches = []
for (const name of shipCritical) {
  if (!files.includes(name)) { hashMismatches.push({ file: name, problem: 'missing from tarball' }); continue }
  const local = fs.readFileSync(path.join(repo, name))
  if (sha(local) !== sha(tarFile(name))) hashMismatches.push({ file: name, problem: 'repo differ from tarball' })
}

const repoManifest = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'))
const lock = JSON.parse(fs.readFileSync(path.join(repo, 'package-lock.json'), 'utf8'))
const changelog = fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8')
const bundle = fs.readFileSync(path.join(repo, 'lib/index.js'), 'utf8')
const bundleCode = bundle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); const bundleVersionLiterals = [...new Set([...bundleCode.matchAll(/\d+\.\d+\.\d+(?:-rc\.\d+)?/g)].map(m => m[0]))]
const versionConsistency = {
  tarballManifest: manifest.version,
  repoManifest: repoManifest.version,
  lockTop: lock.version,
  lockRoot: lock.packages[''].version,
  changelogMentions: changelog.slice(0, 1200).includes(version),
  bundleVersionLiterals,
  consistent: manifest.version === version && repoManifest.version === version && lock.version === version
    && lock.packages[''].version === version && changelog.slice(0, 1200).includes(version)
    && bundleVersionLiterals.length === 1 && bundleVersionLiterals[0] === version,
}

const exportsTargets = Object.entries(manifest.exports ?? {}).flatMap(([key, value]) => {
  const targets = typeof value === 'string' ? [value] : Object.values(value).filter(item => typeof item === 'string')
  return targets.map(target => ({ key, target: target.replace(/^\.\//, ''), present: files.includes(target.replace(/^\.\//, '')) }))
})
const exportsOk = exportsTargets.every(item => item.present)

const allowed = /^(lib\/[a-zA-Z0-9_.-]+|package\.json|cordis\.patch\.yml|LICENSE|UPSTREAM\.md|THIRD_PARTY_NOTICES\.md|CHANGELOG\.md|docs\/(?:storage-recovery|trust-ui|configuration)\.md|README(?:\.zh)?\.md)$/
const unexpectedFiles = files.filter(name => !allowed.test(name))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-repack-'))
let repack
try {
  const packRaw = runNpm(['pack', '--ignore-scripts', '--pack-destination', tmp, '--json'], { cwd: repo })
  const packed = JSON.parse(packRaw)[0]
  const repackArchive = path.join(tmp, packed.filename)
  const repackList = execFileSync('tar', ['-tzf', repackArchive], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).map(s => s.replace(/^package\//, ''))
  const repackHashes = Object.fromEntries(repackList.map(name => [name, sha(execFileSync('tar', ['-xOzf', repackArchive, `package/${name}`], { windowsHide: true }))]))
  const originalHashes = Object.fromEntries(files.map(name => [name, sha(tarFile(name))]))
  repack = {
    sameFileSet: repackList.slice().sort().join('\n') === files.join('\n'),
    tgzSha256Stable: sha(fs.readFileSync(repackArchive)) === sha(fs.readFileSync(archive)),
    differingFiles: Object.keys(originalHashes).filter(name => originalHashes[name] !== repackHashes[name]),
  }
} catch (error) {
  repack = { error: String(error.message ?? error) }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

let audit
try {
  const raw = runNpm(['audit', '--omit=dev', '--json'], { cwd: repo })
  const parsed = JSON.parse(raw)
  audit = { total: parsed.metadata?.vulnerabilities?.total ?? null, severities: parsed.metadata?.vulnerabilities ?? null }
} catch (error) {
  try {
    const parsed = JSON.parse(String(error.stdout ?? ''))
    audit = { total: parsed.metadata?.vulnerabilities?.total ?? null, severities: parsed.metadata?.vulnerabilities ?? null }
  } catch { audit = { error: String(error.message ?? error).slice(0, 300) } }
}

const result = {
  candidate: { name: manifest.name, version: manifest.version, archiveSha256: sha(fs.readFileSync(archive)), fileCount: files.length, files },
  manifest: {
    private: manifest.private, license: manifest.license, type: manifest.type, main: manifest.main, types: manifest.types, engines: manifest.engines,
    exportsTargets, exportsOk, unexpectedFiles, forbiddenManifestFields: ['publishConfig', 'repository', 'homepage'].filter(key => key in manifest),
  },
  versionConsistency,
  repoVsTarball: { checked: shipCritical.length, mismatches: hashMismatches },
  suspiciousContent: contentFindings,
  repackDeterminism: repack,
  productionAudit: audit,
  hostBundle: { importsZodDirectly: /(?:from\s+"zod"|require\("zod"\)|from\s+'zod')/.test(bundle) },
  limits: [
    'Local tarball and working tree only; does not scan vulnerabilities inside host-provided packages',
    'Does not determine complete legal obligations',
    'Secret scan is pattern-based and cannot prove absence',
  ],
}
const readmeCombined = `${content.get('README.md') ?? ''}\n${content.get('README.zh.md') ?? ''}`
const publicChecks = publicRelease ? [
  { name: 'manifest-not-private', ok: manifest.private === false },
  { name: 'license-mit', ok: manifest.license === 'MIT' },
  { name: 'name-unscoped', ok: /^[a-z0-9][a-z0-9._-]*$/.test(manifest.name) },
  { name: 'readme-no-private-claim', ok: !/private local build|private:true|仍是私有本地版本/i.test(readmeCombined) },
  { name: 'release-process-doc-present', ok: fs.existsSync(path.join(repo, 'docs', 'attachments', 'release.md')) },
] : []
result.publicRelease = { requested: publicRelease, checks: publicChecks, pass: publicRelease ? publicChecks.every(item => item.ok) : null }
result.pass = !unexpectedFiles.length && exportsOk && versionConsistency.consistent && !hashMismatches.length && !unreviewedContentFindings.length
  && repack.sameFileSet === true && repack.tgzSha256Stable === true && !repack.differingFiles?.length && audit.total === 0 && !result.hostBundle.importsZodDirectly
  && (!publicRelease || result.publicRelease.pass === true)
mkdirSync(evidenceDir)
fs.writeFileSync(path.join(evidenceDir, 'audit.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ pass: result.pass, files: files.length, findings: contentFindings, hashMismatches: hashMismatches.length, unexpectedFiles, repack, audit, versionConsistency }, null, 2))
if (!result.pass) process.exitCode = 1

function mkdirSync(dir) { fs.mkdirSync(dir, { recursive: true }) }
