#!/usr/bin/env node
/**
 * DSH host-compatibility probe.
 *
 * Answers the question that used to require a full DSH restart: "will the
 * memory plugin still load on this host version, and if not, which exact
 * exemption or reinstall does the profile need?"
 *
 * It reads the repository manifest (the policy), the packaged host version and
 * the profile's installed plugin, then evaluates the declared engines window
 * with the same semver rules as @deepseek-ai/dsh-app-boot (includePrerelease).
 *
 * Usage:
 *   node scripts/verification/host-compat-check.mjs [profile=desktop] [stage=S05-v020-compat]
 *
 * Run it with the packaged Electron runtime (`ELECTRON_RUN_AS_NODE=1`) when
 * the host `semver` package is only reachable inside app.asar.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const profileName = process.argv[2] ?? 'desktop'
const stage = process.argv[3] ?? 'S05-v020-compat'
const hostRoot = 'C:/DeepSeek Harness/resources/app.asar/dsh'
const checks = []

function check(id, ok, detail) {
  checks.push({ id, ok, detail })
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

const manifest = readJson(join(repo, 'package.json'))
const range = manifest?.engines?.dsh
check('range-declared', typeof range === 'string' && range.length > 0, range ?? null)

let hostVersion = null
try {
  hostVersion = readJson(join(hostRoot, 'package.json')).version
  check('host-version-read', true, hostVersion)
} catch (error) {
  check('host-version-read', false, String(error))
}

let semver = null
try {
  semver = createRequire(join(hostRoot, 'package.json'))('semver')
} catch (error) {
  // Fall back to the profile's pnpm store copy if the host one is not
  // reachable (plain node rather than Electron's node).
  try {
    semver = createRequire(import.meta.url)('semver')
  } catch {
    check('semver-available', false, String(error))
  }
}
if (semver) check('semver-available', true, null)

let rangeMatch = null
if (semver && hostVersion && range) {
  rangeMatch = semver.satisfies(hostVersion, range, { includePrerelease: true })
  check('host-version-in-declared-window', rangeMatch, { hostVersion, range })
}

const profileDir = join(homedir(), '.dsh', 'profiles', profileName)
let profileManifest = null
try {
  profileManifest = readJson(join(profileDir, 'package.json'))
  const bundles = Array.isArray(profileManifest?.dsh?.profile?.bundles) ? profileManifest.dsh.profile.bundles : []
  check('profile-bundle-listed', bundles.includes('dsh-auto-memory-wh'), bundles)
} catch (error) {
  check('profile-bundle-listed', false, String(error))
}

let installed = null
try {
  installed = readJson(join(profileDir, 'node_modules', 'dsh-auto-memory-wh', 'package.json'))
  check('installed-package-present', true, { version: installed.version, engines: installed?.engines?.dsh ?? null })
  if (hostVersion && installed?.engines?.dsh && semver) {
    check(
      'installed-window-covers-host',
      semver.satisfies(hostVersion, installed.engines.dsh, { includePrerelease: true }),
      { installed: installed.version, engines: installed.engines.dsh, hostVersion },
    )
  }
} catch (error) {
  check('installed-package-present', false, String(error))
}

let exemptions = null
try {
  exemptions = readJson(join(profileDir, 'compatibility.json'))
} catch {
  exemptions = null
}
check('version-exemptions-readable', true, exemptions)

let installedVersion = null
try {
  installedVersion = readJson(join(profileDir, 'node_modules', 'dsh-auto-memory-wh', 'package.json')).version
} catch {
  installedVersion = null
}

const needsExemption = rangeMatch === false && installedVersion !== null
check(
  'no-action-needed',
  (rangeMatch === true && checks.every((entry) => entry.ok)) || (rangeMatch === false && Boolean(exemptions && exemptions[`dsh-auto-memory-wh@${installedVersion}`])),
  {
    recommendation: rangeMatch === true
      ? 'load expected'
      : needsExemption
        ? `grant: dsh plugin allow-version dsh-auto-memory-wh@${installedVersion} ${hostVersion}`
        : 'reinstall a compatible candidate',
  },
)

const pass = checks.every((entry) => entry.ok)
const report = {
  pass,
  at: new Date().toISOString(),
  profileName,
  hostVersion,
  declaredRange: range ?? null,
  installedVersion,
  installedEngines: installed?.engines?.dsh ?? null,
  hostVersionInDeclaredWindow: rangeMatch,
  exemptions,
  checks,
  boundary:
    'Read-only probe. It predicts the app-boot compatibility decision; it does not load the plugin UI. A declared window only promises that the bundle is attempted, not that every host API still behaves identically.',
}
const evidenceDir = join(repo, 'docs', 'evidence', stage)
mkdirSync(evidenceDir, { recursive: true })
const out = join(evidenceDir, 'host-compat.json')
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(`host compat: ${pass ? 'PASS' : 'FAIL'} (host ${hostVersion}, declared ${range})`)
for (const entry of checks) console.log(`${entry.ok ? 'PASS' : 'FAIL'} ${entry.id}`)
console.log(`evidence: ${out}`)
process.exit(pass ? 0 : 1)
