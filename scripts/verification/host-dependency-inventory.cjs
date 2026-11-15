// Read-only package metadata inventory for the installed Desktop app.asar.
// Run with ELECTRON_RUN_AS_NODE=1 and the Desktop executable.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const base = 'C:/DeepSeek Harness/resources/app.asar/dsh/node_modules'
const names = ['zod', '@deepseek-ai/cordis', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tools']
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex').toUpperCase()
const packages = names.map(name => {
  const dir = base + '/' + name
  const manifest = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8'))
  const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].find(file => fs.existsSync(dir + '/' + file))
  return { name, version: manifest.version, declaredLicense: manifest.license ?? null, licenseFile: license ?? null, licenseSha256: license ? sha256(fs.readFileSync(dir + '/' + license)) : null }
})
const zod = packages.find(item => item.name === 'zod')
const result = { source: 'locally installed DSH Desktop app.asar package metadata', packages, advisory: { id: 'GHSA-mrhx-c7xc-m3w5', affectedRange: '<4.6.6', url: 'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5', observedZodVersion: zod.version, versionFallsInAffectedRange: /^4\.(?:[0-5]\.|6\.[0-5]$)/.test(zod.version), exploitabilityAssessed: false }, note: 'This is host package inventory, not a claim that WH triggers the advisory.' }
const output = path.join(root, 'docs/evidence', process.argv[2] ?? 'S05-rc6-host-deps')
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(output, 'inventory.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
