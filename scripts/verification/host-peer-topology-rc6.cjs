// Read-only comparison of rc.6 profile peers with packaged DSH modules.
// Run through the Desktop executable with ELECTRON_RUN_AS_NODE=1.
const fs = require('node:fs'), path = require('node:path')
const root = path.resolve(__dirname, '../..')
const profile = path.join(root, '.work/S05/installation-home/profiles/wh-s05')
const installed = JSON.parse(fs.readFileSync(path.join(profile, 'node_modules/dsh-auto-memory-wh/package.json'), 'utf8'))
if (installed.version !== '0.1.0-rc.6') throw new Error('Unexpected installed version')
const host = 'C:/DeepSeek Harness/resources/app.asar/dsh/node_modules/'
const peers = Object.entries(installed.peerDependencies).map(([name, wanted]) => {
  const local = path.join(profile, 'node_modules', ...name.split('/'))
  const packaged = JSON.parse(fs.readFileSync(host + name + '/package.json', 'utf8'))
  const rangeMatches = name === '@deepseek-ai/cordis' ? /^4\./.test(packaged.version) : wanted.split(' || ').includes(packaged.version)
  return { name, wanted, profileLocalPresent: fs.existsSync(local), packagedHostVersion: packaged.version, rangeMatches }
})
const result = { installedVersion: installed.version, peers, allProfileLocalMissing: peers.every(item => !item.profileLocalPresent), allPackagedVersionsMatch: peers.every(item => item.rangeMatches), scope: 'Package metadata only; actual installed load is tested separately.' }
const dir = path.join(root, 'docs/evidence/S05-rc6-host-deps')
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, 'peer-topology.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ peers: peers.length, allProfileLocalMissing: result.allProfileLocalMissing, allPackagedVersionsMatch: result.allPackagedVersionsMatch }))
if (peers.length !== 8 || !result.allProfileLocalMissing || !result.allPackagedVersionsMatch) process.exitCode = 1
