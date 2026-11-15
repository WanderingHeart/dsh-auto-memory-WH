// Read-only peer resolution check for the installed wh-s05 candidate.
// Run through the Desktop executable with ELECTRON_RUN_AS_NODE=1.
// Usage: <Desktop.exe> installed-peer-topology.cjs <expectedVersion> <evidenceStage>
// Proves the static "unmet peer" state is intentional: peers are absent from the
// profile but resolve from the packaged host, which loads them for the plugin.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

const repo = path.resolve(__dirname, '../..')
const expectedVersion = process.argv[2]
const stage = process.argv[3]
if (!expectedVersion || !stage) throw new Error('Usage: installed-peer-topology.cjs <expectedVersion> <evidenceStage>')
if (!/^S05-(?:rc[0-9]+|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-host-deps$/.test(stage)) throw new Error('Evidence stage must look like S05-rc10-host-deps or S05-1.0.0-rc.1-host-deps')
const profile = path.join(repo, '.work/S05/installation-home/profiles/wh-s05')
const installed = JSON.parse(fs.readFileSync(path.join(profile, 'node_modules/dsh-auto-memory-wh/package.json'), 'utf8'))
assert.equal(installed.version, expectedVersion, `installed ${installed.version} != expected ${expectedVersion}`)

const hostBase = 'C:/DeepSeek Harness/resources/app.asar/dsh'
const hostModules = hostBase + '/node_modules'
const resolveFrom = (dir, name) => {
  try {
    const resolved = require.resolve(name, { paths: [dir] })
    const meta = JSON.parse(fs.readFileSync(path.join(hostModules, ...name.split('/'), 'package.json'), 'utf8'))
    return { resolved: true, path: resolved.replace(/\\/g, '/'), version: meta.version }
  } catch (error) {
    return { resolved: false, error: String(error.code ?? error.message) }
  }
}

const hostDsh = JSON.parse(fs.readFileSync(path.join(hostBase, 'package.json'), 'utf8')).version
let semver = null
try { semver = require('C:/DeepSeek Harness/resources/app.asar/dsh/node_modules/semver') } catch { semver = null }
const enginesDsh = typeof installed.engines?.dsh === 'string' ? installed.engines.dsh : null
const enginesMatch = enginesDsh && semver ? semver.satisfies(hostDsh, enginesDsh, { includePrerelease: true }) : null
const peers = Object.entries(installed.peerDependencies).map(([name, wanted]) => {
  const localPath = path.join(profile, 'node_modules', ...name.split('/'))
  const meta = JSON.parse(fs.readFileSync(path.join(hostModules, ...name.split('/'), 'package.json'), 'utf8'))
  const rangeMatches = name === '@deepseek-ai/cordis' ? /^4\./.test(meta.version) : wanted.split(' || ').includes(meta.version)
  return {
    name,
    wanted,
    profileLocalPresent: fs.existsSync(localPath),
    packagedHostVersion: meta.version,
    rangeMatches,
    hostResolve: resolveFrom(hostBase, name),
    profileResolve: resolveFrom(profile, name),
  }
})

const result = {
  status: 'running',
  installedVersion: installed.version,
  hostVersion: hostDsh,
  enginesDsh,
  enginesMatch,
  compatibilitySource: enginesDsh ? 'engines.dsh' : 'peerDependencies',
  peerCount: peers.length,
  allProfileLocalMissing: peers.every(item => !item.profileLocalPresent),
  allPackagedVersionsMatch: peers.every(item => item.rangeMatches),
  allHostResolvable: peers.every(item => item.hostResolve.resolved),
  profileResolveConfounded: true,
  peers,
  scope: 'Peer metadata plus module resolution in the packaged Electron Node runtime; no plugin load or model call.',
  note: 'Package-manager / static checks report unmet peers because the host supplies them. Peers are absent from the profile node_modules and resolve from the packaged host, which is the intended topology. Resolution started from the profile path can still walk up into the repository node_modules of this test workspace, so profile-side resolution is recorded for reference and not asserted.',
}
try {
  assert.equal(peers.length, 8)
  const compatible = enginesDsh ? enginesMatch === true : result.allPackagedVersionsMatch
  assert.ok(result.allProfileLocalMissing && compatible && result.allHostResolvable)
  result.status = 'passed'
} catch (error) {
  result.status = 'failed'
  result.error = error.message
  process.exitCode = 1
}
const dir = path.join(repo, 'docs/evidence', stage)
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, 'peer-topology.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ status: result.status, version: result.installedVersion, peers: peers.length, hostResolvable: peers.filter(item => item.hostResolve.resolved).length, profileResolvable: peers.filter(item => item.profileResolve.resolved).length }))
