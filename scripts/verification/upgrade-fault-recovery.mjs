#!/usr/bin/env node
/**
 * Real upgrade fault-recovery drill.
 *
 * Upgrades the installed candidate from rc.10 to rc.11 on a copy of the isolated
 * installation home, kills the upgrade process mid-flight, then verifies memory
 * is untouched and re-runs the upgrade to completion. Finally loads the upgraded
 * bundle through the packaged host lifecycle probe.
 *
 * Synthetic data only. Never touches the real user home.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const repo = process.cwd()
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const stage = arg('stage', 'S05-rc11-upgrade-fault')
const sourceHome = path.resolve(arg('source-home', '.work/S05/installation-home'))
const drillHome = path.resolve(arg('drill-home', '.work/S05/upgrade-fault-home'))
const profile = 'wh-s05'
const rc10 = path.resolve('.work/dsh-auto-memory-wh-0.1.0-rc.10.tgz')
const rc11 = path.resolve('.work/dsh-auto-memory-wh-0.1.0-rc.11.tgz')
const electron = 'C:/DeepSeek Harness/DeepSeek Harness.exe'
const cli = 'C:/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'
const evidenceDir = path.resolve('docs/evidence', stage)
const artifacts = path.resolve('.work/S05/upgrade-fault-artifacts')
const store = path.join(drillHome, 'pnpm-store')
const memoryRoot = path.join(drillHome, 'memory-wh')
const moduleDir = path.join(drillHome, 'profiles', profile, 'node_modules', 'dsh-auto-memory-wh')

for (const [label, p] of [['rc10 tarball', rc10], ['rc11 tarball', rc11], ['source home', sourceHome]]) {
  if (!fs.existsSync(p)) throw new Error(`${label} missing: ${p}`)
}
fs.mkdirSync(evidenceDir, { recursive: true })
fs.mkdirSync(artifacts, { recursive: true })

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
function fingerprint(root) {
  const files = {}
  const issues = []
  const walk = (dir, rel) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name)
      const st = fs.lstatSync(p)
      if (st.isDirectory()) { walk(p, `${rel}${name}/`); continue }
      if (/\.(lock|tmp)$/.test(name) || name === '.wh-transaction.json') { issues.push(`${rel}${name}`); continue }
      files[`${rel}${name}`] = sha256(fs.readFileSync(p))
    }
  }
  walk(root, '')
  return { files, issues, count: Object.keys(files).length }
}
function installedVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(moduleDir, 'package.json'), 'utf8')).version } catch { return null }
}
function cliEnv() {
  // DSH_HOME must point at the drill copy; otherwise the CLI edits the real home.
  return { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: drillHome }
}
function runAdd(label) {
  const before = installedVersion()
  const started = Date.now()
  const r = spawnSync(electron, [cli, 'plugin', '--profile', profile, 'add', rc11, '--ignore-scripts', '--offline', '--store-dir', store], {
    cwd: drillHome, env: cliEnv(), encoding: 'utf8', timeout: 180000,
  })
  return {
    label, command: 'dsh plugin add rc.11', exit: r.status, ms: Date.now() - started,
    before, after: installedVersion(),
    stdout: (r.stdout || '').slice(-4000), stderr: (r.stderr || '').slice(-4000),
  }
}
async function killDuring(label, delayMs) {
  const before = installedVersion()
  const started = Date.now()
  const child = spawn(electron, [cli, 'plugin', '--profile', profile, 'add', rc11, '--ignore-scripts', '--offline', '--store-dir', store], {
    cwd: drillHome, env: cliEnv(), stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  let err = ''
  child.stdout.on('data', (b) => { out += b })
  child.stderr.on('data', (b) => { err += b })
  const closed = new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ code: null, signal: 'close-timeout' }), 20000)
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }) })
  })
  await new Promise((resolve) => setTimeout(resolve, delayMs))
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8' })
  const { code, signal } = await closed
  await new Promise((resolve) => setTimeout(resolve, 500))
  return {
    label, command: `kill after ${delayMs}ms`, delayMs, pid: child.pid, exit: code, signal, ms: Date.now() - started,
    before, after: installedVersion(),
    stdout: out.slice(-3000), stderr: err.slice(-3000),
  }
}
function copyHome() {
  fs.rmSync(drillHome, { recursive: true, force: true })
  fs.cpSync(sourceHome, drillHome, { recursive: true })
  const modulesYaml = path.join(drillHome, 'profiles', profile, 'node_modules', '.modules.yaml')
  const text = fs.readFileSync(modulesYaml, 'utf8')
  fs.writeFileSync(modulesYaml, text.split('installation-home').join('upgrade-fault-home'))
}
function cleanupAfterFault() {
  // pnpm may leave temp store entries; the next install must still succeed.
  fs.rmSync(path.join(drillHome, 'profiles', profile, 'node_modules', '.pnpm'), { recursive: true, force: true })
}
function assertMemoryUnchanged(step, base) {
  const now = fingerprint(memoryRoot)
  const changed = []
  for (const [k, v] of Object.entries(base.files)) if (now.files[k] !== v) changed.push(k)
  const extra = Object.keys(now.files).filter((k) => !(k in base.files))
  return { step, count: now.count, changed, extra, issues: now.issues, ok: changed.length === 0 && now.issues.length === 0 }
}

const result = { stage, at: new Date().toISOString(), home: drillHome, steps: [], checks: [] }
const check = (id, ok, detail) => result.checks.push({ id, ok: !!ok, detail })

copyHome()
result.baseVersion = installedVersion()
const baseFingerprint = fingerprint(memoryRoot)
result.baseFingerprint = { count: baseFingerprint.count, issues: baseFingerprint.issues }
check('copied-home', !!result.baseVersion, `version=${result.baseVersion}`)

function forceInstall(tgz, label) {
  const rm = spawnSync(electron, [cli, 'plugin', '--profile', profile, 'remove', 'dsh-auto-memory-wh', '--store-dir', store], {
    cwd: drillHome, env: cliEnv(), encoding: 'utf8', timeout: 180000,
  })
  const add = spawnSync(electron, [cli, 'plugin', '--profile', profile, 'add', tgz, '--ignore-scripts', '--offline', '--store-dir', store], {
    cwd: drillHome, env: cliEnv(), encoding: 'utf8', timeout: 180000,
  })
  return {
    step: label, removeExit: rm.status, addExit: add.status, version: installedVersion(),
    stdout: (add.stdout || '').slice(-2000), stderr: ((add.stderr || '') + (rm.stderr || '')).slice(-1500),
  }
}

// Step 1: ensure the drill starts from rc.10 (real downgrade).
if (result.baseVersion !== '0.1.0-rc.10') {
  result.steps.push(forceInstall(rc10, 'install-rc10'))
  check('start-at-rc10', installedVersion() === '0.1.0-rc.10', `version=${installedVersion()}`)
}

// Step 2: kill the upgrade mid-flight (early), verify nothing moved.
result.steps.push(await killDuring('kill-early', 450))
check('memory-after-kill-early', !!assertMemoryUnchanged('kill-early', baseFingerprint).ok, JSON.stringify(assertMemoryUnchanged('kill-early', baseFingerprint)))

// Step 3: recover by re-running the same upgrade to completion.
result.steps.push(runAdd('recover-1'))
check('recovered-version', installedVersion() === '0.1.0-rc.11', `version=${installedVersion()}`)
check('memory-after-recover-1', !!assertMemoryUnchanged('recover-1', baseFingerprint).ok, JSON.stringify(assertMemoryUnchanged('recover-1', baseFingerprint)))

// Step 4: a half-upgrade can lose the installed bundle entirely. Simulate that
// state, then verify the same upgrade command repairs it without touching memory.
fs.rmSync(moduleDir, { recursive: true, force: true })
check('module-missing-after-fault', installedVersion() === null, 'bundle directory removed')
check('memory-with-module-missing', !!assertMemoryUnchanged('module-missing', baseFingerprint).ok, JSON.stringify(assertMemoryUnchanged('module-missing', baseFingerprint)))
result.steps.push(runAdd('recover-2'))
check('recovered-version-2', installedVersion() === '0.1.0-rc.11', `version=${installedVersion()}`)
check('memory-after-recover-2', !!assertMemoryUnchanged('recover-2', baseFingerprint).ok, JSON.stringify(assertMemoryUnchanged('recover-2', baseFingerprint)))

// Step 5: packaged host load against the upgraded bundle.
const lifecycle = spawnSync(electron, [
  'scripts/verification/installed-active-session-lifecycle.cjs', '0.1.0-rc.11', 'S05-rc11-fault',
  'upgrade-fault-home', profile,
], { cwd: repo, env: cliEnv(), encoding: 'utf8', timeout: 180000 })
result.steps.push({ step: 'host-lifecycle', exit: lifecycle.status, stdout: (lifecycle.stdout || '').slice(-3000), stderr: (lifecycle.stderr || '').slice(-3000) })
check('host-loads-upgraded-bundle', lifecycle.status === 0, `exit=${lifecycle.status}`)

result.pass = result.checks.every((c) => c.ok)
result.finalVersion = installedVersion()
result.finalFingerprint = { count: fingerprint(memoryRoot).count, issues: fingerprint(memoryRoot).issues }
fs.writeFileSync(path.join(evidenceDir, 'upgrade-fault.json'), JSON.stringify(result, null, 2))
fs.writeFileSync(path.join(artifacts, 'last-run.json'), JSON.stringify(result, null, 2))
for (const c of result.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.id}${c.detail ? ` (${String(c.detail).slice(0, 180)})` : ''}`)
console.log(`RESULT ${result.pass ? 'PASS' : 'FAIL'} -> ${path.join(evidenceDir, 'upgrade-fault.json')}`)
process.exit(result.pass ? 0 : 1)
