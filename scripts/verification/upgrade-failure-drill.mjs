// Offline upgrade-failure drill for the isolated wh-s05 profile.
//
// Scenario: a working candidate is installed in a throw-away copy of the
// isolated installation home. The drill then forces a local failure (a
// truncated tarball), removes the plugin, retries a failing install while
// uninstalled, and finally reinstalls the candidate. The memory directory must
// be byte-identical after every step.
//
// Run: node scripts/verification/upgrade-failure-drill.mjs [stage]
//   stage defaults to S05-0.1.0-upgrade-failure (evidence/docs/evidence/<stage>/drill.json)

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const stage = process.argv[2] ?? 'S05-0.1.0-upgrade-failure'
if (!/^S05-(?:rc\d+|\d+\.\d+\.\d+)-[a-z0-9-]+$/.test(stage)) throw new Error(`invalid stage: ${stage}`)

const drillHomeName = 'upgrade-failure-drill'
const artifactsRoot = path.join(root, '.work/S05', `${drillHomeName}-artifacts`)
const drillRoot = path.join(root, '.work/S05', drillHomeName)
const drillHome = drillRoot
const sourceHome = path.join(root, '.work/S05/installation-home')
const profileDir = path.join(drillHome, 'profiles/wh-s05')
const pluginDir = path.join(profileDir, 'node_modules/dsh-auto-memory-wh')
const memoryDir = path.join(drillHome, 'memory-wh')
const cliScript = path.join(root, 'scripts/verification/isolated-cli.ps1')
const corruptTgz = path.join(artifactsRoot, 'corrupt-candidate.tgz')
const evidenceDir = path.join(root, 'docs/evidence', stage)
const evidenceFile = path.join(evidenceDir, 'drill.json')

function assertUnderDrill(p) {
  const resolved = path.resolve(p)
  if (!resolved.startsWith(drillRoot + path.sep) && resolved !== drillRoot) {
    throw new Error(`refusing to touch path outside drill root: ${resolved}`)
  }
  return resolved
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

function fingerprint(dir) {
  const files = walkFiles(dir).map((full) => {
    const data = fs.readFileSync(full)
    return { path: path.relative(dir, full).replaceAll('\\', '/'), size: data.length, sha256: sha256(data) }
  })
  const aggregate = sha256(files.map((f) => `${f.path}\u0000${f.sha256}`).join('\n'))
  return { aggregate, fileCount: files.length, files }
}

function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function installedVersion() {
  return readJsonIfExists(path.join(pluginDir, 'package.json'))?.version ?? null
}

function profileDependency() {
  return readJsonIfExists(path.join(profileDir, 'package.json'))?.dependencies?.['dsh-auto-memory-wh'] ?? null
}

function memoryState() {
  return {
    fingerprint: fingerprint(memoryDir),
    journal: fs.existsSync(path.join(memoryDir, '.wh-transaction.json')),
    locks: walkFiles(memoryDir).filter((f) => f.endsWith('.lock')).map((f) => path.relative(memoryDir, f)),
  }
}

function snapshotState() {
  return { installedVersion: installedVersion(), profileDependency: profileDependency(), ...memoryState() }
}

function runIsolated(phase, pkg) {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cliScript, '-Phase', phase, '-TestHome', drillHomeName, '-Profile', 'wh-s05']
  if (pkg) args.push('-Package', pkg)
  const started = Date.now()
  const result = spawnSync('powershell', args, { cwd: root, encoding: 'utf8', timeout: 300000, windowsHide: true })
  const tail = (text, n = 1200) => (text ?? '').trim().split(/\r?\n/).slice(-n).join('\n')
  return {
    phase,
    package: pkg ? path.relative(root, pkg).replaceAll('\\', '/') : null,
    exitCode: result.status,
    elapsedMs: Date.now() - started,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
  }
}

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

function memoryUnchanged(baseline, label) {
  const now = memoryState()
  check(`${label}: memory bytes unchanged`, now.fingerprint.aggregate === baseline.fingerprint.aggregate, `${now.fingerprint.fileCount} files`)
  check(`${label}: no transaction journal`, now.journal === false)
  check(`${label}: no leftover lock file`, now.locks.length === 0, now.locks.join(', '))
  return now
}

// --- prepare a throw-away copy of the isolated home -------------------------
const resolvedDrillHome = assertUnderDrill(drillHome)
if (fs.existsSync(resolvedDrillHome)) fs.rmSync(resolvedDrillHome, { recursive: true, force: true })
fs.mkdirSync(drillRoot, { recursive: true })
fs.mkdirSync(artifactsRoot, { recursive: true })
fs.cpSync(sourceHome, drillHome, { recursive: true })
const expectedVersion = installedVersion()
if (!expectedVersion) throw new Error('the copied profile has no installed candidate')
const candidateTgz = path.join(root, `.work/dsh-auto-memory-wh-${expectedVersion}.tgz`)
if (!fs.existsSync(candidateTgz)) throw new Error(`the candidate tarball is required under .work: ${candidateTgz}`)

// pnpm records the absolute store path in .modules.yaml; a copied profile
// would otherwise refuse every operation with ERR_PNPM_UNEXPECTED_STORE.
// The store itself is copied too, so only the recorded path needs rebasing.
const modulesYaml = path.join(profileDir, 'node_modules/.modules.yaml')
fs.writeFileSync(modulesYaml, fs.readFileSync(modulesYaml, 'utf8').replaceAll('installation-home', drillHomeName))

// truncated tarball = a local, deterministic "invalid package" failure
const candidateBytes = fs.readFileSync(candidateTgz)
fs.writeFileSync(corruptTgz, candidateBytes.subarray(0, Math.min(2048, candidateBytes.length)))

const baseline = snapshotState()
check('base: copied profile has the candidate installed', baseline.installedVersion === expectedVersion, String(baseline.installedVersion))
check('base: memory has synthetic files', baseline.fingerprint.fileCount > 0, `${baseline.fingerprint.fileCount} files`)

const steps = []

// 1) update attempt with a truncated tarball: invalid archive.
const stepTruncated = runIsolated('Install', corruptTgz)
steps.push(stepTruncated)
check('A truncated tarball attempt fails', stepTruncated.exitCode !== 0, `exit=${stepTruncated.exitCode}`)
check('A installed version stays the candidate', installedVersion() === expectedVersion, String(installedVersion()))
check('A profile dependency stays on the candidate', (profileDependency() ?? '').includes(expectedVersion), String(profileDependency()))
memoryUnchanged(baseline, 'A')

// 2) remove the plugin: memory must survive.
const stepRemove = runIsolated('Remove')
steps.push(stepRemove)
check('B remove succeeds', stepRemove.exitCode === 0, `exit=${stepRemove.exitCode}`)
check('B installed module removed', installedVersion() === null, String(installedVersion()))
memoryUnchanged(baseline, 'B')

// 3) install attempt while uninstalled still fails and keeps memory.
const stepRemoveFail = runIsolated('Install', corruptTgz)
steps.push(stepRemoveFail)
check('C install-while-removed fails', stepRemoveFail.exitCode !== 0, `exit=${stepRemoveFail.exitCode}`)
check('C still uninstalled', installedVersion() === null, String(installedVersion()))
memoryUnchanged(baseline, 'C')

// 4) restore the working candidate.
const stepRestore = runIsolated('Install', candidateTgz)
steps.push(stepRestore)
check('D reinstall candidate succeeds', stepRestore.exitCode === 0, `exit=${stepRestore.exitCode}`)
check('D version is the candidate', installedVersion() === expectedVersion, String(installedVersion()))
memoryUnchanged(baseline, 'D')

// 5) one more failing attempt after the restore: the profile must keep working.
const stepRetryFail = runIsolated('Install', corruptTgz)
steps.push(stepRetryFail)
check('E second failing attempt fails', stepRetryFail.exitCode !== 0, `exit=${stepRetryFail.exitCode}`)
check('E version still the candidate', installedVersion() === expectedVersion, String(installedVersion()))
memoryUnchanged(baseline, 'E')

const finalState = memoryState()
const passed = checks.every((c) => c.ok)
fs.mkdirSync(evidenceDir, { recursive: true })
fs.writeFileSync(
  evidenceFile,
  `${JSON.stringify(
    {
      stage,
      status: passed ? 'passed' : 'failed',
      generatedAt: new Date().toISOString(),
      boundary: [
        'offline, isolated copy of .work/S05/installation-home, synthetic memory only',
        `failure mode is local: a 2048-byte truncated copy of the candidate tarball (${expectedVersion})`,
        'does not exercise real DSH upgrade, native window, model calls or real user memory',
        'a successful reinstall proves memory is preserved across failed upgrade/remove attempts, not that a real upgrade is safe',
      ],
      base: {
        installedVersion: baseline.installedVersion,
        profileDependency: baseline.profileDependency,
        memoryAggregate: baseline.fingerprint.aggregate,
        memoryFiles: baseline.fingerprint.files.map((f) => `${f.path} ${f.sha256}`),
      },
      checks,
      steps,
      final: {
        installedVersion: installedVersion(),
        profileDependency: profileDependency(),
        memoryAggregate: finalState.fingerprint.aggregate,
        memoryFileCount: finalState.fingerprint.fileCount,
        journal: finalState.journal,
        locks: finalState.locks,
      },
    },
    null,
    2,
  )}\n`,
)
console.log(`\nRESULT ${passed ? 'PASS' : 'FAIL'} -> ${path.relative(root, evidenceFile)}`)
process.exit(passed ? 0 : 1)
