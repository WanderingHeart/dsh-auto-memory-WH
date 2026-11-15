import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const root = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const version = positional[0] ?? manifest.version
if (!/^\d+\.\d+\.\d+(?:-rc\.[0-9]+)?$/.test(version)) throw new Error(`Expected a release or rc candidate version, got ${version}`)
if (manifest.version !== version) throw new Error(`Manifest version ${manifest.version} does not match requested ${version}`)
const rcMatch = version.match(/rc\.([0-9]+)/)
const stage = rcMatch ? `S05-rc${rcMatch[1]}` : `S05-${version}`
const auditToken = version
const withHost = process.argv.includes('--with-host')
const skipBuild = process.argv.includes('--skip-build')
const skipStorage = process.argv.includes('--skip-storage')
const withConcurrency = process.argv.includes('--with-concurrency')
const node = process.execPath
const npmCli = path.join(path.dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js')
if (!fs.existsSync(npmCli)) throw new Error(`npm CLI not found at ${npmCli}`)
const desktop = String.raw`C:\DeepSeek Harness\DeepSeek Harness.exe`
const tarball = path.join(root, '.work', `dsh-auto-memory-wh-${version}.tgz`)
const acceptanceDir = path.join(root, 'docs/evidence', `${stage}-acceptance`)
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/TOKEN|SECRET|PASSWORD|COOKIE|DSH_SESSION/i.test(key)))
const hostEnv = { ...baseEnv, ELECTRON_RUN_AS_NODE: '1' }

const steps = []
function record(name, ok, exitCode, ms, tail) {
  steps.push({ name, ok, exitCode, ms, tail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} (${ms} ms)`)
  if (!ok && tail) console.log(tail.split(/\r?\n/).slice(-25).join('\n'))
}

function run(name, command, args, options = {}) {
  const started = Date.now()
  let ok = true
  let code = 0
  let tail = ''
  try {
    const output = execFileSync(command, args, {
      cwd: root,
      env: options.env ?? baseEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeout ?? 20 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    })
    tail = output
  } catch (error) {
    ok = false
    code = typeof error.status === 'number' ? error.status : 1
    tail = `${error.stdout ?? ''}\n${error.stderr ?? ''}\n${error.message}`
  }
  record(name, ok, code, Date.now() - started, tail)
  return ok
}

if (!fs.existsSync(desktop) && withHost) throw new Error(`Desktop executable not found at ${desktop}`)

// The host probes read the version installed in the isolated profile; fail fast with instructions.
const profileManifest = path.join(root, '.work/S05/installation-home/profiles/wh-s05/node_modules/dsh-auto-memory-wh/package.json')
if (withHost) {
  if (!fs.existsSync(profileManifest)) throw new Error(`Installed candidate not found at ${profileManifest}; run scripts/verification/isolated-cli.ps1 first`)
  const installed = JSON.parse(fs.readFileSync(profileManifest, 'utf8')).version
  if (installed !== version) throw new Error(`wh-s05 has ${installed}, not ${version}; reinstall the candidate before --with-host`)
}

run('typecheck', node, [path.join(npmCli), 'run', 'typecheck'])
if (!skipBuild) run('build', node, [path.join(npmCli), 'run', 'build'])
run('unit', node, [path.join(npmCli), 'test'])
run('edition-matrix', node, [path.join(root, 'scripts/verification/edition-matrix.mjs'), `S05-${version}-edition`])

let pack = null
{
  const started = Date.now()
  let ok = true
  let tail = ''
  try {
    fs.mkdirSync(path.join(root, '.work'), { recursive: true })
    fs.mkdirSync(acceptanceDir, { recursive: true })
    fs.rmSync(tarball, { force: true })
    const output = execFileSync(node, [npmCli, 'pack', '--ignore-scripts', '--pack-destination', path.join(root, '.work'), '--json'], { cwd: root, env: baseEnv, encoding: 'utf8', timeout: 10 * 60 * 1000 })
    pack = JSON.parse(output.replace(/^\uFEFF/, ''))[0]
    fs.writeFileSync(path.join(root, 'docs/evidence', stage, 'package.json'), output.replace(/^\uFEFF/, ''))
    fs.writeFileSync(path.join(root, 'docs/evidence', stage, 'hashes.json'), JSON.stringify({
      version,
      archive: pack.filename,
      size: pack.size,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(tarball)).digest('hex'),
      shasum: pack.shasum,
      integrity: pack.integrity,
      files: pack.entryCount,
    }, null, 2) + '\n')
  } catch (error) {
    ok = false
    tail = `${error.stdout ?? ''}\n${error.stderr ?? ''}\n${error.message}`
  }
  record('pack', ok, ok ? 0 : 1, Date.now() - started, tail)
}

if (pack) {
  run('package-smoke', node, [path.join(root, 'scripts/verification/package-smoke.mjs'), stage])
  run('distribution', node, [path.join(root, 'scripts/verification/candidate-distribution-audit.mjs'), auditToken])
  run('license', node, [path.join(root, 'scripts/verification/runtime-license-audit.mjs'), auditToken])
}

if (!skipStorage) {
  const stagePrefix = stage
  run('storage-format', node, [path.join(root, 'scripts/verification/legacy-unknown-fields-matrix.mjs'), `${stagePrefix}-legacy-unknown`])
  run('storage-budget', node, [path.join(root, 'scripts/verification/index-budget-matrix.mjs'), `${stagePrefix}-index-budget`])
  run('storage-paths', node, [path.join(root, 'scripts/verification/path-unicode-matrix.mjs'), `${stagePrefix}-path-unicode`])
  run('storage-snapshot', node, [path.join(root, 'scripts/verification/snapshot-restore-matrix.mjs'), `${stagePrefix}-snapshot-restore-matrix`])
  run('storage-audit', node, [path.join(root, 'scripts/verification/audit-resilience-matrix.mjs'), `${stagePrefix}-audit-resilience`])
  // backup-depth-matrix and scale-matrix keep their versioned evidence paths.
  run('storage-backup', node, [path.join(root, 'scripts/verification/backup-depth-matrix.mjs')])
  run('storage-scale', node, [path.join(root, 'scripts/verification/scale-matrix.mjs')])
  run('storage-upgrade', node, [path.join(root, 'scripts/verification/upgrade-failure-drill.mjs'), `${stagePrefix}-upgrade-failure`])
  if (withConcurrency) run('storage-concurrency', node, [path.join(root, 'scripts/verification/concurrent-index-readers.mjs'), '60', `${stagePrefix}-concurrent-readers`])
}

if (withHost) {
  const probe = path.join(root, 'scripts/verification/host-audit-bridge-probe.cjs')
  run('host-audit-lifecycle', desktop, [probe, '--installed-version', version, '--lifecycle'], { env: hostEnv })
  run('host-policy-matrix', desktop, [probe, '--installed-version', version, '--policy-matrix'], { env: hostEnv })
  run('host-session-lifecycle', desktop, [path.join(root, 'scripts/verification/installed-active-session-lifecycle.cjs'), version, `${stage}-lifecycle`], { env: hostEnv })
  run('host-peer-topology', desktop, [path.join(root, 'scripts/verification/installed-peer-topology.cjs'), version, `${stage}-host-deps`], { env: hostEnv })
  run('host-dependency-inventory', desktop, [path.join(root, 'scripts/verification/host-dependency-inventory.cjs'), `${stage}-host-deps`], { env: hostEnv })
}

const pass = steps.every((step) => step.ok) && (!withHost || Boolean(pack))
const result = {
  version,
  stage,
  withHost,
  at: new Date().toISOString(),
  archive: pack ? path.join('.work', pack.filename) : null,
  sha256: pack ? crypto.createHash('sha256').update(fs.readFileSync(tarball)).digest('hex') : null,
  steps,
  pass,
}
fs.mkdirSync(acceptanceDir, { recursive: true })
fs.writeFileSync(path.join(acceptanceDir, 'summary.json'), JSON.stringify(result, null, 2) + '\n')
console.log(`\n${pass ? 'ACCEPTANCE PASS' : 'ACCEPTANCE FAIL'} — ${version}${withHost ? ' (with host probes)' : ''}`)
console.log(`summary: docs/evidence/${stage}-acceptance/summary.json`)
if (!pass) process.exit(1)
