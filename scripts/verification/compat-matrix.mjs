import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const evidenceDir = join(repo, 'docs', 'evidence', 'S05-release')
const cli = 'C:\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd'

function parse(value) {
  const match = String(value).trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!match) return null
  return { main: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? '' }
}

function compare(left, right) {
  const a = parse(left)
  const b = parse(right)
  if (!a || !b) throw new Error(`cannot compare ${left} and ${right}`)
  for (let index = 0; index < 3; index += 1) {
    if (a.main[index] !== b.main[index]) return a.main[index] - b.main[index]
  }
  if (!a.pre && !b.pre) return 0
  if (!a.pre) return 1
  if (!b.pre) return -1
  const leftParts = a.pre.split('.')
  const rightParts = b.pre.split('.')
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const l = leftParts[index]
    const r = rightParts[index]
    if (l === undefined) return -1
    if (r === undefined) return 1
    const ln = Number(l)
    const rn = Number(r)
    const bothNumeric = Number.isFinite(ln) && Number.isFinite(rn)
    if (bothNumeric) {
      if (ln !== rn) return ln - rn
    } else if (l !== r) {
      return l < r ? -1 : 1
    }
  }
  return 0
}

function satisfiesAnd(version, part) {
  return part.split(/\s+/).filter(Boolean).every(token => {
    if (token.startsWith('^')) {
      const base = token.slice(1)
      const parsed = parse(base)
      const upper = `${parsed.main[0] + 1}.0.0`
      return compare(version, base) >= 0 && compare(version, upper) < 0
    }
    if (token.startsWith('>=')) return compare(version, token.slice(2)) >= 0
    if (token.startsWith('<=')) return compare(version, token.slice(2)) <= 0
    if (token.startsWith('>')) return compare(version, token.slice(1)) > 0
    if (token.startsWith('<')) return compare(version, token.slice(1)) < 0
    return compare(version, token) === 0
  })
}

function satisfies(version, range) {
  return range.split('||').map(part => part.trim()).filter(Boolean).some(part => satisfiesAnd(version, part))
}

const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
const dshRange = manifest.engines?.dsh ?? ''
const nodeRange = manifest.engines?.node ?? ''

const dsh = spawnSync('powershell.exe', ['-NoProfile', '-Command', `& '${cli}' --version`], { encoding: 'utf8' })
const dshVersion = `${dsh.stdout ?? ''}\n${dsh.stderr ?? ''}`.match(/\d+\.\d+\.\d+(?:-[\w.]+)?/)?.[0] ?? ''
check('dsh-version-detected', dshVersion.length > 0, dshVersion)
check('declared-dsh-range-parseable', dshRange.length > 0, dshRange)
check('installed-dsh-satisfies-range', dshVersion.length > 0 && satisfies(dshVersion, dshRange), `${dshVersion} vs ${dshRange}`)
check('node-satisfies-range', satisfies(process.versions.node, nodeRange), `${process.versions.node} vs ${nodeRange}`)

const desktopExe = 'C:\\DeepSeek Harness\\DeepSeek Harness.exe'
const rcMatch = manifest.version.match(/rc\.([0-9]+)/)
const hostStage = rcMatch ? `S05-rc${rcMatch[1]}` : `S05-${manifest.version}`
const peerStage = `${hostStage}-host-deps`
const peerCheck = spawnSync(desktopExe, [
  '--expose-internals',
  join(repo, 'scripts', 'verification', 'installed-peer-topology.cjs'),
  manifest.version,
  peerStage,
], {
  cwd: repo,
  encoding: 'utf8',
  timeout: 180_000,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
})
const peerLog = `${peerCheck.stdout ?? ''}\n${peerCheck.stderr ?? ''}`.trim()
const peerEvidencePath = join(repo, 'docs', 'evidence', peerStage, 'peer-topology.json')
let peerEvidence = null
try {
  peerEvidence = JSON.parse(readFileSync(peerEvidencePath, 'utf8'))
} catch {
  peerEvidence = null
}
check(
  'installed-peer-topology',
  peerCheck.status === 0 && peerEvidence?.status === 'passed',
  peerEvidence
    ? `${peerEvidence.installedVersion} · ${peerEvidence.peerCount} peers · host ${peerEvidence.hostVersion}`
    : peerLog.slice(-400),
)

const isolatedMemory = join(repo, '.work', 'S05', 'installation-home')
check('isolated-home-present', existsSync(isolatedMemory), '.work/S05/installation-home')

const matrix = [
  {
    dshVersion,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    status: 'measured',
    evidence: ['S05-0.12.1-acceptance', 'S05-0.12.1', 'S05-release/clean-env-drill'],
  },
  {
    dshVersion: '0.2.1-rc.5',
    node: '22.19.0',
    platform: 'win32-x64',
    status: 'declared-minimum (not measured here)',
    evidence: [],
  },
]

mkdirSync(evidenceDir, { recursive: true })
const report = {
  stage: 'S05-release',
  kind: 'compat-matrix',
  pass: checks.every(item => item.ok),
  at: new Date().toISOString(),
  plugin: { name: manifest.name, version: manifest.version },
  ranges: { dsh: dshRange, node: nodeRange },
  peers: (peerEvidence?.peers ?? []).map(item => ({ name: item.name, wanted: item.wanted, hostVersion: item.packagedHostVersion, hostResolvable: item.hostResolve.resolved })),
  peerCheckExit: peerCheck.status,
  rows: matrix,
  secondDshVersion: null,
  checks,
  boundary: [
    'Only the installed DSH version is measured; the declared minimum row is not executed here.',
    'Plugin peer dependencies are provided by the host profile; the isolated peer check covers the pinned profile.',
    'UI acceptance for a second DSH version still needs a machine with that version installed.',
  ],
}
writeFileSync(join(evidenceDir, 'compat-matrix.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`\n${report.pass ? 'PASS' : 'FAIL'} compat matrix`)
console.log(`evidence: ${join(evidenceDir, 'compat-matrix.json')}`)
if (!report.pass) process.exitCode = 1
