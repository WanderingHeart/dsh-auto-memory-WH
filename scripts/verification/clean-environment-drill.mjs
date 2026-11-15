import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const home = join(repo, '.work', 'S05', 'release-final-stable101')
const profile = 'wh-release-final'
const memoryRoot = join(home, 'memory-wh')
const evidenceDir = join(repo, 'docs', 'evidence', 'S05-release')
const evidencePath = join(evidenceDir, 'clean-env-drill.json')
const cli = 'C:\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd'

const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

function runIsolated(phase, extra = []) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    join(repo, 'scripts', 'verification', 'isolated-cli.ps1'),
    '-Phase', phase, '-TestHome', 'release-final-stable101', '-Profile', profile,
    ...extra,
  ], { cwd: repo, encoding: 'utf8', timeout: 900_000 })
  if (result.status !== 0) throw new Error(`isolated-cli ${phase} failed: ${result.stderr || result.stdout}`)
  return result.stdout + result.stderr
}

function installedVersion() {
  const manifest = join(home, 'profiles', profile, 'node_modules', 'dsh-auto-memory-wh', 'package.json')
  if (!existsSync(manifest)) return null
  return JSON.parse(readFileSync(manifest, 'utf8')).version
}

function install(version) {
  const tgz = join(repo, '.work', `dsh-auto-memory-wh-${version}.tgz`)
  if (!existsSync(tgz)) throw new Error(`missing candidate ${tgz}`)
  runIsolated('Install', ['-Package', tgz, '-AllowDownload'])
  const installed = installedVersion()
  if (installed !== version) throw new Error(`expected ${version}, installed ${installed}`)
  return installed
}

function listFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === '.backups' || entry === '.archive' || entry === 'node_modules') continue
      files.push(...listFiles(full))
    } else if (!entry.endsWith('.lock') && entry !== 'audit.jsonl' && !entry.endsWith('.tmp')) {
      files.push(full)
    }
  }
  return files
}

function digest() {
  const root = memoryRoot
  const lines = listFiles(root).sort().map(file => {
    const rel = relative(root, file).replace(/\\/g, '/')
    return `${rel}:${createHash('sha256').update(readFileSync(file)).digest('hex')}`
  })
  return { sha256: createHash('sha256').update(lines.join('\n')).digest('hex'), files: lines.length }
}

function seedMemory() {
  if (existsSync(join(memoryRoot, 'MEMORY.md'))) return false
  mkdirSync(join(memoryRoot, '_user'), { recursive: true })
  writeFileSync(join(memoryRoot, '.wh-format.json'), JSON.stringify({ format: 'dsh-auto-memory-wh', version: 1 }, null, 2) + '\n')
  const records = [
    ['clean-alpha', 'Synthetic alpha', 'Synthetic deterministic record written by the clean-environment drill.', 'verified'],
    ['clean-beta', 'Synthetic beta', 'Second synthetic record used to verify that upgrades never rewrite memory files.', 'candidate'],
  ]
  for (const [name, title, description, status] of records) {
    const frontmatter = [
      '---',
      `name: ${name}`,
      `title: ${title}`,
      `description: ${description}`,
      'type: reference',
      ...(status === 'verified' ? ['status: verified', `reviewHash: ${createHash('sha256').update(JSON.stringify([name, title, description, 'reference', `Body of ${name}.`])).digest('hex')}`] : []),
      `created: ${Date.now() - 60_000}`,
      `updated: ${Date.now() - 60_000}`,
      '---',
      '',
      `Body of ${name}.`,
      '',
    ].join('\n')
    writeFileSync(join(memoryRoot, '_user', `${name}.md`), frontmatter)
  }
  writeFileSync(join(memoryRoot, 'MEMORY.md'), '# Memory index\n\n')
  return true
}

const startedAt = new Date().toISOString()
const before = { version: installedVersion(), digest: null }

// 1. Fresh profile: install the previous release, seed synthetic data, then upgrade/roll back.
if (!existsSync(join(home, 'profiles', profile, 'package.json'))) runIsolated('Initialize')
seedMemory()
const seeded = digest()
check('memory-seeded', seeded.files >= 4, `${seeded.files} files`)

const installed120 = install('1.0.0')
const digest120 = digest()
check('install-1.0.0', installed120 === '1.0.0', installed120)
check('data-readable-after-install', digest120.sha256 === seeded.sha256, digest120.sha256.slice(0, 16))

const installed121 = install('1.0.1')
const digest121 = digest()
check('upgrade-1.0.1', installed121 === '1.0.1', installed121)
check('memory-unchanged-by-upgrade', digest121.sha256 === digest120.sha256, digest121.sha256.slice(0, 16))

const rolledBack = install('1.0.0')
const digestRollback = digest()
check('rollback-1.0.0', rolledBack === '1.0.0', rolledBack)
check('memory-unchanged-by-rollback', digestRollback.sha256 === digest120.sha256, digestRollback.sha256.slice(0, 16))

const restored = install('1.0.1')
check('restore-final-candidate', restored === '1.0.1' && digest().sha256 === seeded.sha256, restored)

const dsh = spawnSync('powershell.exe', ['-NoProfile', '-Command', `& '${cli}' --version`], { encoding: 'utf8' })
const dshVersion = `${dsh.stdout ?? ''}\n${dsh.stderr ?? ''}`.match(/\d+\.\d+\.\d+(?:-[\w.]+)?/)?.[0] ?? ''
check('dsh-version-recorded', dshVersion.length > 0, dshVersion)

mkdirSync(evidenceDir, { recursive: true })
const report = {
  stage: 'S05-release',
  kind: 'clean-environment-drill',
  pass: checks.every(item => item.ok),
  at: startedAt,
  finishedAt: new Date().toISOString(),
  environment: {
    isolatedHome: '.work/S05/release-final-stable101',
    profile,
    dshVersion,
    memoryRoot: '.work/S05/release-final-stable101/memory-wh',
  },
  versions: { seededBeforeInstall: before.version, installed: '1.0.0', upgraded: '1.0.1', rolledBack: '1.0.0' },
  digests: {
    seeded: seeded.sha256,
    afterInstall: digest120.sha256,
    afterUpgrade: digest121.sha256,
    afterRollback: digestRollback.sha256,
    files: seeded.files,
  },
  checks,
  boundary: [
    'Synthetic memory tree: two user records and a placeholder index, no real data.',
    'Install/upgrade/rollback go through dsh plugin add with the same tgz that would be published.',
    'Does not boot the UI; this run verifies CLI installation and data preservation only.',
    'Fresh logical profile: isolated DSH_HOME and pnpm store, no API keys or real profile; not a fresh Windows user or VM.',
  ],
}
writeFileSync(evidencePath, JSON.stringify(report, null, 2) + '\n')
console.log(`\n${report.pass ? 'PASS' : 'FAIL'} clean-environment drill`)
console.log(`evidence: ${evidencePath}`)
if (!report.pass) process.exitCode = 1
